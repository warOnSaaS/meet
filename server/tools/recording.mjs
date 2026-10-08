// Recording: one browser in the call (the person who asked for it) records the composed call view (a canvas
// of everyone's video plus everyone's sound, mixed) with MediaRecorder. Nothing is recorded until everyone in
// the call has seen the notice; each person agrees or says no, and anyone who says no (or has not answered)
// is left out of the picture and the sound. The file goes to the person's own disk, or to the team's
// S3-compatible storage through a presigned URL (the file never passes through this server).
import { readSettings, publicView, ownerOf } from '../settings.mjs';
import { presign } from '../s3.mjs';

const ASK_MS = 45000; // after this long, people who have not answered are left out and recording starts

export function recordingTools(H) {
  const { fail, str, bool, MEETING, meetingRow, me, requireHost, requireIn, now, id } = H;
  const REC = str('Recording id (defaults to the meeting\'s latest)');

  async function current(ctx, m, rid) {
    const r = rid
      ? await ctx.db.get('SELECT * FROM meet_recordings WHERE id = ? AND meeting_id = ?', [rid, m.id])
      : await ctx.db.get('SELECT * FROM meet_recordings WHERE meeting_id = ? ORDER BY started_at DESC LIMIT 1', [m.id]);
    return r ?? null;
  }

  async function status(ctx, m, r, mine) {
    if (!r) return { meeting: m.id, recording: null, state: 'off' };
    const inCall = new Set((await ctx.db.all("SELECT participant_id FROM meet_peers WHERE meeting_id = ? AND kind = 'browser'", [m.id])).map((x) => x.participant_id));
    const people = await ctx.db.all("SELECT id, display_name FROM meeting_participants WHERE meeting_id = ? AND status = 'admitted' ORDER BY joined_at", [m.id]);
    const answers = new Map((await ctx.db.all('SELECT * FROM meet_recording_consents WHERE recording_id = ?', [r.id])).map((c) => [c.participant_id, c]));
    // Asking turns into recording once everyone in the call answered, or after ASK_MS.
    if (r.consent_state === 'asking') {
      const waiting = people.filter((p) => inCall.has(p.id) && !answers.has(p.id));
      if (!waiting.length || now() - Number(r.started_at) > ASK_MS) {
        await ctx.db.run("UPDATE meet_recordings SET consent_state = 'recording', recording_at = ? WHERE id = ? AND consent_state = 'asking'", [now(), r.id]);
        r = { ...r, consent_state: 'recording', recording_at: now() };
        await ctx.room.changed(m.id, 'recording');
      }
    }
    const answer = (pid) => answers.get(pid)?.answer ?? 'pending';
    return {
      meeting: m.id, recording: r.id, state: r.consent_state,
      started_by: r.started_by_name ?? null, asked_at: new Date(Number(r.started_at)).toISOString(),
      recording_at: r.recording_at ? new Date(Number(r.recording_at)).toISOString() : null,
      recorder: r.recorder_pid,
      // Only these people are in the picture and the sound.
      included: people.filter((p) => answer(p.id) === 'agree').map((p) => p.id),
      people: people.map((p) => ({ participant: p.id, name: p.display_name, answer: answer(p.id), in_call: inCall.has(p.id) })),
      you: mine ? { participant: mine.id, answer: answer(mine.id), recorder: r.recorder_pid === mine.id } : null,
      saved: r.storage ? { where: r.storage, size_bytes: Number(r.size_bytes ?? 0), duration_s: r.duration_s, mime: r.mime } : null,
      storage_ready: publicView(await readSettings(ctx, ownerOf(ctx, m))).storage_ready,
    };
  }

  const recOut = (r) => ({ id: r.id, state: r.consent_state, started_by: r.started_by_name, asked_at: new Date(Number(r.started_at)).toISOString(), stopped_at: r.stopped_at ? new Date(Number(r.stopped_at)).toISOString() : null, where: r.storage ?? null, size_bytes: r.size_bytes == null ? null : Number(r.size_bytes), duration_s: r.duration_s, mime: r.mime });
  const keyOf = (ctx, m, r) => `meet/${m.team_id ?? 'default'}/${m.id}/${r.id}.${/mp4/.test(r.mime ?? '') ? 'mp4' : 'webm'}`;

  const tools = [
    {
      name: 'meet.start_recording', scope: 'write', confirm: 'human', events: ['meet.recording.asked'],
      description: 'Ask everyone in the call to agree to recording. Every screen shows a notice that has to be answered; recording starts once everyone answered (or after 45 s), and anyone who said no or did not answer is left out of the picture and the sound. Host or co-host only. Each answer is stored (ROADMAP F11).',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireHost(ctx, m);
        const r0 = await current(ctx, m);
        if (r0 && ['asking', 'recording'].includes(r0.consent_state)) fail('already', 'A recording is already running in this meeting.', 409);
        const mine = await me(ctx, m);
        // The recorder is the person who asked, or (when an agent asked) the host in the call.
        const recorder = mine?.status === 'admitted' ? mine : await ctx.db.get("SELECT p.* FROM meeting_participants p JOIN meet_peers r ON r.participant_id = p.id WHERE p.meeting_id = ? AND p.role IN ('host', 'cohost') AND p.status = 'admitted' LIMIT 1", [m.id]);
        if (!recorder) fail('no_recorder', 'A host has to be in the call to record it: the recording is made in their browser.', 409);
        const rid = id('rec_');
        await ctx.db.run("INSERT INTO meet_recordings (id, meeting_id, consent_state, started_by, started_by_name, started_at, recorder_pid) VALUES (?, ?, 'asking', ?, ?, ?, ?)", [rid, m.id, mine?.id ?? ctx.caller.user?.id ?? null, mine?.display_name ?? ctx.caller.user?.name ?? 'The host', now(), recorder.id]);
        await ctx.room.changed(m.id, 'recording');
        return status(ctx, m, await current(ctx, m, rid), mine);
      },
    },
    {
      name: 'meet.answer_recording', scope: 'write', confirm: 'none', events: ['meet.recording.consent'],
      description: 'Your answer to the recording notice: agree to be recorded, or not. If you say no, you are left out of the picture and the sound. You can change your answer while it records.',
      input: { type: 'object', required: ['meeting', 'agree'], properties: { meeting: MEETING, agree: bool('true: you are in the recording. false: you are left out.'), shown_at: str('When you saw the notice, ISO 8601 (defaults to now)') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        if (!p) fail('forbidden', 'Join the meeting first.', 403);
        const r = await current(ctx, m);
        if (!r || !['asking', 'recording'].includes(r.consent_state)) fail('no_recording', 'Nothing is being recorded.', 409);
        const shown = Math.min(now(), Date.parse(a.shown_at ?? '') || now());
        const answer = a.agree ? 'agree' : 'decline';
        const up = await ctx.db.run('UPDATE meet_recording_consents SET answer = ?, answered_at = ? WHERE recording_id = ? AND participant_id = ?', [answer, now(), r.id, p.id]);
        if (!up.changes) await ctx.db.run('INSERT INTO meet_recording_consents (recording_id, participant_id, answer, answered_at, notice_shown_at) VALUES (?, ?, ?, ?, ?)', [r.id, p.id, answer, now(), shown]);
        await ctx.room.changed(m.id, 'recording');
        return status(ctx, m, r, p);
      },
    },
    {
      name: 'meet.recording_status', scope: 'read', confirm: 'none', events: [],
      description: 'Whether the call is being recorded: asking, recording or stopped; who agreed, who said no, who is being asked; which browser records; and where the file was saved.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, recording: REC } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        return status(ctx, m, await current(ctx, m, a.recording), p);
      },
    },
    {
      name: 'meet.stop_recording', scope: 'write', confirm: 'none', events: ['meet.recording.stopped'],
      description: 'Stop the recording. The browser that recorded it then saves the file to its disk or to the team\'s storage.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const r = await current(ctx, m);
        if (!r || !['asking', 'recording'].includes(r.consent_state)) fail('no_recording', 'Nothing is being recorded.', 409);
        const mine = await me(ctx, m);
        if (mine?.id !== r.recorder_pid) await requireHost(ctx, m);
        await ctx.db.run("UPDATE meet_recordings SET consent_state = 'stopped', stopped_at = ? WHERE id = ?", [now(), r.id]);
        await ctx.room.changed(m.id, 'recording');
        return { stopped: r.id };
      },
    },
    {
      name: 'meet.recording_upload_url', scope: 'write', confirm: 'none', events: [],
      description: 'A one-hour link to upload the recording straight to the team\'s S3-compatible storage (set in Settings). For the browser that recorded it.',
      input: { type: 'object', required: ['meeting', 'mime'], properties: { meeting: MEETING, recording: REC, mime: str('video/webm or video/mp4') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const r = await current(ctx, m, a.recording);
        if (!r) fail('no_recording', 'No recording.', 404);
        const mine = await me(ctx, m);
        if (mine?.id !== r.recorder_pid) await requireHost(ctx, m);
        const s = await readSettings(ctx, ownerOf(ctx, m));
        if (!publicView(s).storage_ready) fail('not_set_up', 'No storage is set up for recordings (Settings). Save it to your disk instead.', 409);
        const mime = /mp4/.test(a.mime) ? 'video/mp4' : 'video/webm';
        await ctx.db.run('UPDATE meet_recordings SET mime = ? WHERE id = ?', [mime, r.id]);
        const key = keyOf(ctx, m, { ...r, mime });
        return { url: presign(s, 'PUT', key, { contentType: mime }), method: 'PUT', headers: { 'content-type': mime }, key, expires_in_s: 3600 };
      },
    },
    {
      name: 'meet.save_recording', scope: 'write', confirm: 'none', events: ['meet.recording.saved'],
      description: 'Record where the finished recording went (your disk, or the team\'s storage), its size and length, so the meeting lists it.',
      input: { type: 'object', required: ['meeting', 'where'], properties: { meeting: MEETING, recording: REC, where: { type: 'string', enum: ['disk', 'storage'] }, size_bytes: { type: 'integer' }, duration_s: { type: 'integer' }, mime: str('video/webm or video/mp4') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const r = await current(ctx, m, a.recording);
        if (!r) fail('no_recording', 'No recording.', 404);
        const mine = await me(ctx, m);
        if (mine?.id !== r.recorder_pid) await requireHost(ctx, m);
        const key = a.where === 'storage' ? keyOf(ctx, m, { ...r, mime: a.mime ?? r.mime }) : null;
        await ctx.db.run("UPDATE meet_recordings SET storage = ?, file_id = ?, size_bytes = ?, duration_s = ?, mime = ?, consent_state = CASE WHEN consent_state IN ('asking', 'recording') THEN 'stopped' ELSE consent_state END, stopped_at = COALESCE(stopped_at, ?) WHERE id = ?", [a.where, key, a.size_bytes ?? null, a.duration_s ?? null, a.mime ?? r.mime ?? 'video/webm', now(), r.id]);
        await ctx.room.changed(m.id, 'recording');
        return recOut(await current(ctx, m, r.id));
      },
    },
    {
      name: 'meet.list_recordings', scope: 'read', confirm: 'none', events: [],
      description: 'The meeting\'s recordings: when, who asked, where each was saved, size and length. Recordings saved to someone\'s disk are listed but only they have the file.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireIn(ctx, m);
        const rows = await ctx.db.all('SELECT * FROM meet_recordings WHERE meeting_id = ? ORDER BY started_at', [m.id]);
        return { recordings: rows.map(recOut) };
      },
    },
    {
      name: 'meet.get_recording', scope: 'read', confirm: 'none', events: [],
      description: 'One recording, with a one-hour download link when it is in the team\'s storage, and who agreed to be in it.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, recording: REC } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireIn(ctx, m);
        const r = await current(ctx, m, a.recording);
        if (!r) fail('no_recording', 'No recording.', 404);
        const consents = await ctx.db.all('SELECT c.participant_id, p.display_name, c.answer, c.notice_shown_at, c.answered_at FROM meet_recording_consents c LEFT JOIN meeting_participants p ON p.id = c.participant_id WHERE c.recording_id = ?', [r.id]);
        const out = { ...recOut(r), consents: consents.map((c) => ({ participant: c.participant_id, name: c.display_name, answer: c.answer, notice_shown_at: new Date(Number(c.notice_shown_at)).toISOString(), answered_at: new Date(Number(c.answered_at)).toISOString() })) };
        if (r.storage === 'storage' && r.file_id) {
          const s = await readSettings(ctx, ownerOf(ctx, m));
          if (publicView(s).storage_ready) out.download_url = presign(s, 'GET', r.file_id);
        }
        return out;
      },
    },
    {
      name: 'meet.delete_recording', scope: 'delete', confirm: 'none', events: ['meet.recording.deleted'],
      description: 'Delete a recording: the file in the team\'s storage and the record of it. Host only. A copy saved to someone\'s disk is theirs to delete. Consent answers are kept as proof.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, recording: REC } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireHost(ctx, m);
        const r = await current(ctx, m, a.recording);
        if (!r) fail('no_recording', 'No recording.', 404);
        let removed = false;
        if (r.storage === 'storage' && r.file_id) {
          const s = await readSettings(ctx, ownerOf(ctx, m));
          const res = await fetch(presign(s, 'DELETE', r.file_id), { method: 'DELETE' }).catch(() => null);
          removed = !!res && (res.ok || res.status === 404);
          if (!removed) fail('storage', 'The storage did not delete the file. Try again.', 502);
        }
        await ctx.db.run("UPDATE meet_recordings SET consent_state = 'deleted', storage = NULL, file_id = NULL WHERE id = ?", [r.id]);
        await ctx.room.changed(m.id, 'recording');
        return { deleted: r.id, file_removed: removed };
      },
    },
  ];
  for (const t of tools) t.test = 'test/e2e/recording.test.mjs';
  return { tools };
}

export const RECORDING_TITLES = {
  'meet.start_recording': 'Start recording', 'meet.answer_recording': 'Answer the recording notice', 'meet.recording_status': 'Recording status',
  'meet.stop_recording': 'Stop recording', 'meet.recording_upload_url': 'Get an upload link for a recording', 'meet.save_recording': 'Save a recording',
  'meet.list_recordings': 'List recordings', 'meet.get_recording': 'Get a recording', 'meet.delete_recording': 'Delete a recording',
};
