// AI notes: each person's own device writes down what they say (live captions for everyone), the transcript
// is kept with the meeting while notes are on, and meet.summarise turns it into a summary, decisions and
// action items, which go to the CRM, the board, Chat and email through those apps' own tools.
//
// Consent (ROADMAP F11, docs/RECORDING-CONSENT.md): notes are off by default; turning them on shows and speaks
// a notice to everyone; nobody's microphone is written down until that person says yes; anyone can leave
// their own voice out at any time; every answer is stored with when the notice was shown.
import { scriptedNotes, modelNotes, notesText, SCRIPTED_LABEL } from '../notes/summary.mjs';
import { readSettings, writeSettings, publicView, ownerOf, FIELDS } from '../settings.mjs';

export const ENGINES = ['whisper-webgpu', 'whisper-wasm', 'web-speech', 'none'];
const MAX_SEG = 2000;

export function notesTools(H) {
  const { fail, str, bool, MEETING, meetingRow, me, isOwner, requireHost, requireIn, requireMember, joinUrl, now, id } = H;

  // Who may read a meeting's transcript and notes: anyone admitted to it, its owner, or (inside wOS) any
  // member of its team, the same people who can open it.
  async function requireReader(ctx, m) {
    const p = await me(ctx, m);
    if (p && (p.status === 'admitted' || (p.status === 'left' && p.joined_at))) return p;
    if (isOwner(ctx, m)) return null;
    if (ctx.teamId && ctx.caller.user && m.team_id === ctx.teamId) return null;
    fail('forbidden', 'Only people in this meeting can read its notes.', 403);
  }

  const toMs = (v) => {
    if (v == null) return null;
    const t = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  async function consents(ctx, m) {
    return ctx.db.all('SELECT * FROM meet_notes_consents WHERE meeting_id = ?', [m.id]);
  }

  // Who writes down whose words. Your own device first. If it cannot, a helper: another person in the call
  // whose device can, and who already hears you, decrypted, as part of the call (the host first). If nobody
  // can and the team set a speech service, your device sends your audio to this server, which asks it.
  function assign(people, cons, inCall, serverReady) {
    const byPid = new Map(cons.map((c) => [c.participant_id, c]));
    const capable = people.filter((p) => inCall.has(p.id) && /^whisper/.test(byPid.get(p.id)?.engine ?? '')).sort((a, b) => (a.role === 'host' ? -1 : b.role === 'host' ? 1 : 0));
    const out = {};
    for (const p of people) {
      const c = byPid.get(p.id);
      if (c?.answer !== 'include') continue;
      if (c.engine && c.engine !== 'none') out[p.id] = 'self';
      else if (capable.find((h) => h.id !== p.id)) out[p.id] = `helper:${capable.find((h) => h.id !== p.id).id}`;
      else if (serverReady) out[p.id] = 'server';
      else out[p.id] = null;
    }
    return out;
  }

  async function status(ctx, m, mine) {
    const people = await ctx.db.all("SELECT * FROM meeting_participants WHERE meeting_id = ? AND status = 'admitted' ORDER BY joined_at", [m.id]);
    const cons = await consents(ctx, m);
    const inCall = new Set((await ctx.db.all("SELECT participant_id FROM meet_peers WHERE meeting_id = ? AND kind = 'browser'", [m.id])).map((r) => r.participant_id));
    const s = publicView(await readSettings(ctx, ownerOf(ctx, m)));
    const by = assign(people, cons, inCall, s.transcribe_ready);
    const c = (pid) => cons.find((x) => x.participant_id === pid);
    const notes = await ctx.db.get('SELECT written_at, model, scripted FROM meeting_notes WHERE meeting_id = ?', [m.id]);
    const segs = await ctx.db.get('SELECT COUNT(*) AS n FROM meet_segments WHERE meeting_id = ?', [m.id]);
    return {
      meeting: m.id,
      on: !!m.notes_on,
      started_by: m.notes_by ?? null,
      started_at: m.notes_started_at ? new Date(Number(m.notes_started_at)).toISOString() : null,
      send_to: m.notes_targets ? JSON.parse(m.notes_targets) : null,
      you: mine ? { participant: mine.id, answer: c(mine.id)?.answer ?? 'pending', engine: c(mine.id)?.engine ?? null, written_by: by[mine.id] ?? null } : null,
      people: people.map((p) => ({ participant: p.id, name: p.display_name, answer: c(p.id)?.answer ?? 'pending', engine: c(p.id)?.engine ?? null, written_by: by[p.id] ?? null, in_call: inCall.has(p.id) })),
      // For a helper's screen: whose audio this device writes down as well as its own.
      helping: mine ? Object.entries(by).filter(([, v]) => v === `helper:${mine.id}`).map(([pid]) => pid) : [],
      segments: Number(segs?.n ?? 0),
      notes_written_at: notes?.written_at ? new Date(Number(notes.written_at)).toISOString() : null,
      model: s.notes_model_ready ? { ready: true, label: s.notes_model.value } : { ready: false, label: SCRIPTED_LABEL },
      server_transcribe: s.transcribe_ready,
      in_suite: !!ctx.callTool,
    };
  }

  async function segmentsOf(ctx, m, after = null) {
    const rows = await ctx.db.all(`SELECT * FROM meet_segments WHERE meeting_id = ?${after != null ? ' AND start_at > ?' : ''} ORDER BY start_at, created_at LIMIT 5000`, after != null ? [m.id, after] : [m.id]);
    return rows.map((r) => ({ id: r.id.startsWith(`${m.id}:`) ? r.id.slice(m.id.length + 1) : r.id, participant: r.participant_id, speaker: r.speaker, start_at: Number(r.start_at), end_at: Number(r.end_at), text: r.text, engine: r.engine, written_by: r.written_by }));
  }

  const iso = (t) => new Date(Number(t)).toISOString();
  const segOut = (s) => ({ ...s, start_at: iso(s.start_at), end_at: iso(s.end_at) });

  async function saveSegment(ctx, m, who, seg, writer, engine) {
    const text = String(seg.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEG);
    if (!text) return false;
    const start = toMs(seg.start_at) ?? now();
    const end = Math.max(start, toMs(seg.end_at) ?? start);
    const sid = `${m.id}:${String(seg.id || id('sg_')).slice(0, 64)}`; // ids are the client's, kept apart per meeting
    if (await ctx.db.get('SELECT id FROM meet_segments WHERE id = ?', [sid])) return false;
    await ctx.db.run('INSERT INTO meet_segments (id, meeting_id, participant_id, speaker, start_at, end_at, text, engine, written_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [sid, m.id, who.id, who.display_name, start, end, text, engine, writer, now()]);
    return true;
  }

  async function writeNotes(ctx, m, by = null) {
    const segs = await segmentsOf(ctx, m);
    const settings = await readSettings(ctx, ownerOf(ctx, m));
    let n;
    if (settings.notes_model_url && settings.notes_model) {
      try { n = await modelNotes({ title: m.title, segments: segs, settings }); }
      catch (e) { n = { ...scriptedNotes({ title: m.title, segments: segs }), warning: `The notes model failed (${e.message.slice(0, 160)}), so the script wrote these instead.` }; }
    } else n = scriptedNotes({ title: m.title, segments: segs });
    const row = [n.summary, JSON.stringify(n.decisions), JSON.stringify(n.action_items), by, n.model, n.scripted ? 1 : 0, now()];
    const up = await ctx.db.run('UPDATE meeting_notes SET summary = ?, decisions = ?, action_items = ?, written_by_agent_id = ?, model = ?, scripted = ?, written_at = ? WHERE meeting_id = ?', [...row, m.id]);
    if (!up.changes) await ctx.db.run('INSERT INTO meeting_notes (summary, decisions, action_items, written_by_agent_id, model, scripted, written_at, meeting_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [...row, m.id]);
    return { ...(await readNotes(ctx, m)), ...(n.warning ? { warning: n.warning } : {}) };
  }

  async function readNotes(ctx, m) {
    const r = await ctx.db.get('SELECT * FROM meeting_notes WHERE meeting_id = ?', [m.id]);
    if (!r?.written_at) return null;
    return {
      meeting: m.id, title: m.title, summary: r.summary, decisions: JSON.parse(r.decisions || '[]'), action_items: JSON.parse(r.action_items || '[]'),
      model: r.model, scripted: !!r.scripted, written_at: iso(r.written_at), sent: r.sent ? JSON.parse(r.sent) : {}, link: joinUrl(ctx, m),
    };
  }

  async function notesOrWrite(ctx, m) {
    return (await readNotes(ctx, m)) ?? writeNotes(ctx, m, ctx.caller.user?.id ?? null);
  }

  async function markSent(ctx, m, where, what) {
    const r = await ctx.db.get('SELECT sent FROM meeting_notes WHERE meeting_id = ?', [m.id]);
    const sent = r?.sent ? JSON.parse(r.sent) : {};
    sent[where] = { at: new Date().toISOString(), ...what };
    await ctx.db.run('UPDATE meeting_notes SET sent = ? WHERE meeting_id = ?', [JSON.stringify(sent), m.id]);
  }

  // Another app's tool, as the person asking (inside wOS: call.callTool, with their scopes and audit).
  const APPS = { crm: 'The CRM', board: 'The board', chat: 'Chat', email: 'Email' };
  async function other(ctx, tool, input) {
    if (!ctx.callTool) fail('needs_suite', 'Sending notes to the CRM, the board, Chat or email works inside wOS, where those apps live. Here you can copy the notes or download them.', 409);
    try { return await ctx.callTool(tool, input); }
    catch (e) {
      const app = APPS[tool.split('.')[0]] ?? tool.split('.')[0];
      if (e.code === 'no_tool' || e.status === 404) fail('app_off', `${app} is off for this team. Turn it on in Settings, Apps.`, 409);
      fail(e.code ?? 'other_app', `${app} said: ${e.message}`, e.status ?? 502);
    }
  }

  const linked = (m, app) => {
    const [a, kind, ...rest] = String(m.linked_record ?? '').split(':');
    return a === app ? { kind, id: rest.join(':') } : null;
  };

  const SEND = { type: 'object', description: 'Where the notes go when the meeting ends (each is optional)', properties: { crm: str('A CRM record: crm:deal:<id or name>, crm:contact:..., crm:org:...; or "linked" for the meeting\'s own record'), board: str('The board client to add action items to'), chat: str('A Chat channel to post the notes in'), email: bool('Email the notes to everyone in the meeting who is on the team') }, additionalProperties: false };

  const tools = [
    {
      name: 'meet.start_notes', scope: 'write', confirm: 'human', events: ['meet.notes.started'],
      description: 'Turn on AI notes. Everyone in the call sees and hears a notice, and each person\'s own device writes down only what that person says, once they agree. Words are kept with the meeting while notes are on. Host or co-host only.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, send_to: SEND } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireHost(ctx, m);
        const mine = await me(ctx, m);
        const by = mine?.display_name ?? ctx.caller.user?.name ?? 'The host';
        await ctx.db.run('UPDATE meetings SET notes_on = 1, notes_by = ?, notes_started_at = ?, notes_targets = ? WHERE id = ?', [by, now(), a.send_to ? JSON.stringify(a.send_to) : m.notes_targets ?? null, m.id]);
        // Everyone is asked again, every time notes are turned on.
        await ctx.db.run("UPDATE meet_notes_consents SET answer = 'pending', answered_at = NULL, notice_shown_at = NULL WHERE meeting_id = ?", [m.id]);
        await ctx.room.broadcast(m.id, 'notes-notice', { by });
        await ctx.room.changed(m.id, 'notes');
        return status(ctx, await meetingRow(ctx, m.id), mine);
      },
    },
    {
      name: 'meet.stop_notes', scope: 'write', confirm: 'none', events: ['meet.notes.stopped'],
      description: 'Turn AI notes off. Nothing more is written down; what was written stays with the meeting until the host deletes it.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireHost(ctx, m);
        await ctx.db.run('UPDATE meetings SET notes_on = 0 WHERE id = ?', [m.id]);
        await ctx.room.changed(m.id, 'notes');
        return { on: false };
      },
    },
    {
      name: 'meet.answer_notes', scope: 'write', confirm: 'none', events: ['meet.notes.consent'],
      description: 'Your answer to the notes notice: include your voice in the notes, or leave it out. Change it any time. Also says how your device writes down your words (engine), so the call can find a helper when it cannot.',
      input: { type: 'object', required: ['meeting', 'include'], properties: { meeting: MEETING, include: bool('true: your words go in the notes. false: your microphone is never written down.'), engine: { type: 'string', enum: ENGINES, description: 'How your device transcribes: whisper-webgpu, whisper-wasm (both on this device), web-speech (the browser\'s speech service), none (cannot)' }, shown_at: str('When you saw the notice, ISO 8601 (defaults to now)') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        if (!p) fail('forbidden', 'Join the meeting first.', 403);
        const answer = a.include ? 'include' : 'exclude';
        const shown = toMs(a.shown_at) ?? now();
        const had = await ctx.db.get('SELECT * FROM meet_notes_consents WHERE meeting_id = ? AND participant_id = ?', [m.id, p.id]);
        const engine = a.engine ?? had?.engine ?? null;
        if (had) await ctx.db.run('UPDATE meet_notes_consents SET answer = ?, engine = ?, answered_at = ?, notice_shown_at = COALESCE(notice_shown_at, ?) WHERE meeting_id = ? AND participant_id = ?', [answer, engine, now(), Math.min(shown, now()), m.id, p.id]);
        else await ctx.db.run('INSERT INTO meet_notes_consents (meeting_id, participant_id, answer, engine, notice_shown_at, answered_at) VALUES (?, ?, ?, ?, ?, ?)', [m.id, p.id, answer, engine, Math.min(shown, now()), now()]);
        await ctx.room.changed(m.id, 'notes');
        return { answer, engine };
      },
    },
    {
      name: 'meet.notes_status', scope: 'read', confirm: 'none', events: [],
      description: 'Whether notes are on, who turned them on, each person\'s answer and how their words are written down (their own device, a helper in the call, or the server), and which model writes the notes.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireReader(ctx, m);
        return status(ctx, m, p);
      },
    },
    {
      name: 'meet.add_transcript', scope: 'write', confirm: 'none', events: ['meet.transcript.added'],
      description: 'Add lines to the transcript: what you said, written down by your own device (or, as a helper, what someone you write for said). Only while notes are on and only for people who agreed.',
      input: { type: 'object', required: ['meeting', 'segments'], properties: { meeting: MEETING, segments: { type: 'array', maxItems: 50, items: { type: 'object', required: ['text', 'start_at'], properties: { id: str('Your id for this line, so sending it twice keeps one'), participant: str('Whose words (defaults to you)'), start_at: str('When they started speaking, ISO 8601 or milliseconds'), end_at: str('When they stopped'), text: str('What they said'), engine: { type: 'string', enum: ENGINES } }, additionalProperties: false } } } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        if (!p) fail('forbidden', 'Join the meeting first.', 403);
        if (!m.notes_on) fail('notes_off', 'Notes are off in this meeting.', 409);
        const st = await status(ctx, m, p);
        let saved = 0;
        for (const seg of (a.segments ?? []).slice(0, 50)) {
          const pid = seg.participant || p.id;
          const person = st.people.find((x) => x.participant === pid);
          if (!person || person.answer !== 'include') continue; // never write down someone who did not agree
          if (pid !== p.id && person.written_by !== `helper:${p.id}`) continue;
          const who = pid === p.id ? p : await ctx.db.get('SELECT * FROM meeting_participants WHERE id = ?', [pid]);
          if (await saveSegment(ctx, m, who, seg, p.id, seg.engine ?? (pid === p.id ? person.engine : 'helper'))) saved++;
        }
        return { saved };
      },
    },
    {
      name: 'meet.transcribe_audio', scope: 'write', confirm: 'none', events: ['meet.transcript.added'],
      description: 'For a device that cannot transcribe: send a short clip of your own speech (WAV, under 30 s) and the team\'s speech service writes it down. Only when the team set one up, and only while notes are on and you agreed.',
      input: { type: 'object', required: ['meeting', 'audio_base64', 'start_at'], properties: { meeting: MEETING, audio_base64: str('The clip, base64'), mime: str('audio/wav (default)'), start_at: str('When the clip starts, ISO 8601 or milliseconds'), end_at: str('When it ends') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        if (!p) fail('forbidden', 'Join the meeting first.', 403);
        if (!m.notes_on) fail('notes_off', 'Notes are off in this meeting.', 409);
        const c = await ctx.db.get('SELECT answer FROM meet_notes_consents WHERE meeting_id = ? AND participant_id = ?', [m.id, p.id]);
        if (c?.answer !== 'include') fail('no_consent', 'You left your voice out of the notes.', 403);
        const s = await readSettings(ctx, ownerOf(ctx, m));
        if (!s.transcribe_url) fail('not_set_up', 'No speech service is set up for this team (Settings, Notes).', 409);
        const audio = Buffer.from(String(a.audio_base64), 'base64');
        if (audio.length > 1.5e6) fail('too_big', 'Send clips under 30 seconds.', 413);
        const form = new FormData();
        form.append('file', new Blob([audio], { type: a.mime || 'audio/wav' }), 'clip.wav');
        form.append('model', s.transcribe_model || 'whisper-1');
        const r = await fetch(`${s.transcribe_url.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: s.transcribe_key ? { authorization: `Bearer ${s.transcribe_key}` } : {}, body: form });
        if (!r.ok) fail('speech_service', `The speech service answered ${r.status}.`, 502);
        const text = String((await r.json()).text ?? '').trim();
        const seg = { start_at: a.start_at, end_at: a.end_at, text };
        const saved = text ? await saveSegment(ctx, m, p, seg, 'server', 'server') : false;
        return { text, saved };
      },
    },
    {
      name: 'meet.get_transcript', scope: 'read', confirm: 'none', events: [],
      description: 'Read a meeting\'s transcript: who said what and when, in order. Pass after (a time) to get only newer lines.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, after: str('Only lines that start after this time, ISO 8601 or milliseconds') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const segs = await segmentsOf(ctx, m, toMs(a.after));
        const t0 = Number(m.started_at ?? segs[0]?.start_at ?? 0);
        const clock = (t) => { const s = Math.max(0, Math.round((t - t0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
        return { meeting: m.id, title: m.title, language: 'en', notes_on: !!m.notes_on, segments: segs.map(segOut), text: segs.map((s) => `[${clock(s.start_at)}] ${s.speaker}: ${s.text}`).join('\n') };
      },
    },
    {
      name: 'meet.summarise', scope: 'write', confirm: 'none', events: ['meet.notes.written'],
      description: 'Write the meeting notes from the transcript: a summary, decisions and action items. Uses the team\'s model when one is set (Settings, Notes); otherwise a labelled script writes demo notes. Runs by itself when the meeting ends.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const n = await writeNotes(ctx, m, ctx.caller.user?.id ?? null);
        await ctx.room.changed(m.id, 'notes');
        return n;
      },
    },
    {
      name: 'meet.get_notes', scope: 'read', confirm: 'none', events: [],
      description: 'Read the meeting notes (summary, decisions, action items), which model wrote them, and where they were sent.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        return (await readNotes(ctx, m)) ?? { meeting: m.id, summary: null, message: 'No notes yet. Call meet.summarise to write them.' };
      },
    },
    {
      name: 'meet.notes_to_crm', scope: 'write', confirm: 'none', events: ['meet.notes.sent'],
      description: 'Save the notes as a meeting activity on a CRM record (the meeting\'s linked deal, contact or organization, or the one you name). Writes the notes first if needed. Inside wOS.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, record: str('crm:deal:<id or name>, crm:contact:..., or crm:org:... (defaults to the meeting\'s linked record)') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const ref = a.record && a.record !== 'linked' ? (() => { const [, kind, ...r] = a.record.split(':'); return a.record.startsWith('crm:') ? { kind, id: r.join(':') } : { kind: 'deal', id: a.record }; })() : linked(m, 'crm');
        if (!ref?.id) fail('bad_input', 'Say which CRM record (crm:deal:..., crm:contact:... or crm:org:...), or link the meeting to one.');
        const field = { deal: 'deal', contact: 'contact', org: 'org', organization: 'org' }[ref.kind] ?? 'deal';
        const n = await notesOrWrite(ctx, m);
        const mins = m.started_at ? Math.max(1, Math.round(((m.ended_at ?? now()) - m.started_at) / 60000)) : undefined;
        const r = await other(ctx, 'crm.log_activity', { type: 'meeting', subject: `Meeting notes: ${m.title}`.slice(0, 200), body: notesText(n, { link: n.link }), [field]: ref.id, ...(mins ? { duration_min: mins } : {}) });
        await markSent(ctx, m, 'crm', { record: `crm:${field}:${ref.id}` });
        return { sent: true, to: `crm:${field}:${ref.id}`, result: r };
      },
    },
    {
      name: 'meet.notes_to_board', scope: 'write', confirm: 'none', events: ['meet.notes.sent'],
      description: 'Add each action item from the notes as a task on the board, for a client, with its owner and due day when the notes name them. Inside wOS.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, client: str('The board client the tasks are for (defaults to the one chosen when notes were turned on)'), assign: bool('Assign each task to the person the notes name (default on); off leaves them unassigned') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const client = a.client || JSON.parse(m.notes_targets || '{}').board || (linked(m, 'board')?.kind === 'client' ? linked(m, 'board').id : null);
        if (!client) fail('bad_input', 'Say which board client the action items are for.');
        const n = await notesOrWrite(ctx, m);
        if (!n.action_items.length) return { sent: false, tasks: [], message: 'The notes have no action items.' };
        const tasks = [];
        for (const it of n.action_items) {
          const r = await other(ctx, 'board.add_task', { client, title: it.text.slice(0, 140), details: `From the meeting "${m.title}" (${n.link}).${n.scripted ? ` ${SCRIPTED_LABEL}.` : ''}`, ...(a.assign !== false && it.owner ? { assignee: it.owner } : { assignee: 'nobody' }) });
          tasks.push({ title: it.text, owner: it.owner, result: r });
        }
        await markSent(ctx, m, 'board', { client, tasks: tasks.length });
        return { sent: true, client, tasks };
      },
    },
    {
      name: 'meet.notes_to_chat', scope: 'write', confirm: 'none', events: ['meet.notes.sent'],
      description: 'Post the notes in a Chat channel: the channel the meeting started from, or the one you name. Inside wOS.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, channel: str('Channel name or id (defaults to the channel the call started in)') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const channel = a.channel || JSON.parse(m.notes_targets || '{}').chat || linked(m, 'chat')?.id;
        if (!channel) fail('bad_input', 'Say which Chat channel to post the notes in.');
        const n = await notesOrWrite(ctx, m);
        const r = await other(ctx, 'chat.post_message', { channel, body: notesText(n, { title: m.title, link: n.link }) });
        await markSent(ctx, m, 'chat', { channel });
        return { sent: true, channel, result: r };
      },
    },
    {
      name: 'meet.notes_to_email', scope: 'write', confirm: 'none', events: ['meet.notes.sent'],
      description: 'Email the notes to the people in the meeting who are on the team (or the members you name), through the Email app. Guests are not emailed. Inside wOS.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, to: { type: 'array', items: { type: 'string' }, description: 'Team members (email or id); defaults to every team member who joined' } } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireReader(ctx, m);
        const to = a.to?.length ? a.to : [...new Set((await ctx.db.all("SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND user_id IS NOT NULL AND joined_at IS NOT NULL AND kind = 'person'", [m.id])).map((r) => r.user_id))];
        if (!to.length) fail('bad_input', 'Nobody on the team joined this meeting. Say who to email.');
        const n = await notesOrWrite(ctx, m);
        const sent = [];
        for (const who of to.slice(0, 50)) {
          await other(ctx, 'email.send_alert', { to: who, title: `Meeting notes: ${m.title}`.slice(0, 200), body: notesText(n, { link: n.link }), app: 'meet', ref: m.id });
          sent.push(who);
        }
        await markSent(ctx, m, 'email', { to: sent.length });
        return { sent: true, to: sent };
      },
    },
    {
      name: 'meet.delete_transcript', scope: 'delete', confirm: 'none', events: ['meet.transcript.deleted'],
      description: 'Delete a meeting\'s transcript and notes. Host only. The consent records stay, as proof of what people agreed to.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireHost(ctx, m);
        await ctx.db.run('DELETE FROM meet_segments WHERE meeting_id = ?', [m.id]);
        await ctx.db.run('DELETE FROM meeting_notes WHERE meeting_id = ?', [m.id]);
        await ctx.room.changed(m.id, 'notes');
        return { deleted: true };
      },
    },
    {
      name: 'meet.get_settings', scope: 'read', confirm: 'none', events: [],
      description: 'The notes model, speech service and recording storage this team (or, standalone, you) set up. Keys are never shown, only whether they are set.',
      input: { type: 'object', properties: {} },
      async handler(ctx) {
        requireMember(ctx);
        const s = publicView(await readSettings(ctx, ownerOf(ctx, null)));
        return { ...s, fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.about])) };
      },
    },
    {
      name: 'meet.set_settings', scope: 'admin', confirm: 'none', events: ['meet.settings.changed'],
      description: 'Set the model that writes notes (any OpenAI-compatible address, model and key), a speech service for devices that cannot transcribe, and S3-compatible storage for recordings. Empty clears a value. Keys are stored encrypted.',
      input: { type: 'object', properties: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, str(f.about)])) },
      async handler(ctx, a) {
        requireMember(ctx);
        await writeSettings(ctx, ownerOf(ctx, null), a);
        return publicView(await readSettings(ctx, ownerOf(ctx, null)));
      },
    },
  ];

  for (const t of tools) t.test = 'test/unit/notes.test.mjs';

  // When a meeting ends with notes taken: write them, and send them where the host chose.
  async function onEnded(ctx, m) {
    const n = await ctx.db.get('SELECT COUNT(*) AS n FROM meet_segments WHERE meeting_id = ?', [m.id]);
    if (!Number(n?.n)) return null;
    await writeNotes(ctx, m, ctx.caller.user?.id ?? null);
    const to = JSON.parse(m.notes_targets || 'null');
    const results = {};
    if (to) {
      const by = Object.fromEntries(tools.map((t) => [t.name, t]));
      const jobs = [];
      if (to.crm) jobs.push(['crm', by['meet.notes_to_crm'].handler(ctx, { meeting: m.id, record: to.crm })]);
      if (to.board) jobs.push(['board', by['meet.notes_to_board'].handler(ctx, { meeting: m.id, client: to.board })]);
      if (to.chat) jobs.push(['chat', by['meet.notes_to_chat'].handler(ctx, { meeting: m.id, channel: to.chat })]);
      if (to.email) jobs.push(['email', by['meet.notes_to_email'].handler(ctx, { meeting: m.id })]);
      for (const [k, p] of jobs) { try { await p; results[k] = 'sent'; } catch (e) { results[k] = e.message; } }
    }
    return { written: true, sent: results };
  }

  return { tools, onEnded };
}

export const NOTES_TITLES = {
  'meet.start_notes': 'Turn notes on', 'meet.stop_notes': 'Turn notes off', 'meet.answer_notes': 'Answer the notes notice',
  'meet.notes_status': 'Notes status', 'meet.add_transcript': 'Add to the transcript', 'meet.transcribe_audio': 'Transcribe a clip on the server',
  'meet.get_transcript': 'Get the transcript', 'meet.summarise': 'Write meeting notes', 'meet.get_notes': 'Read meeting notes',
  'meet.notes_to_crm': 'Save notes to the CRM', 'meet.notes_to_board': 'Add action items to the board', 'meet.notes_to_chat': 'Post notes in Chat',
  'meet.notes_to_email': 'Email the notes', 'meet.delete_transcript': 'Delete the transcript and notes', 'meet.get_settings': 'Read Meetings settings',
  'meet.set_settings': 'Change Meetings settings',
};
