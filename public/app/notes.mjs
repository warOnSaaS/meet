// AI notes inside the call: the notice and each person's answer, live captions, the transcript, and the
// notes (summary, decisions, action items) with buttons that send them to other apps. Every button calls a
// tool. Each person's own device writes down their own microphone (notes/transcriber.mjs); lines go to the
// others over the call's encrypted channel (channel.mjs) as captions, and to the meeting's transcript through
// meet.add_transcript while notes are on.
import { callTool } from './api.mjs';
import { esc, icon, toast, copyText } from './dom.mjs';
import { SecureChannel } from './channel.mjs';
import { Transcriber, detectEngine, ENGINE_LABEL, whisperStats } from './notes/transcriber.mjs';

const CAPTION_MS = 9000;

export class Notes {
  constructor(call) {
    this.call = call;
    this.status = null;
    this.timeline = new Map(); // id -> segment
    this.metrics = []; // captions that reached this screen: { id, from, speech_end, arrived, run_ms }
    this.notes = null;
    this.captions = true;
    this.own = null; // my own transcriber
    this.helping = new Map(); // pid -> transcriber writing for someone whose device cannot
    this.state = 'off';
    this.engine = null;
  }

  get mid() { return this.call.meeting.id; }

  async init() {
    this.channel = new SecureChannel(this.call.signal, this.call.media.e2ee_key);
    this.call.channel = this.channel;
    this.channel.on('cap', (seg, from) => this.received(seg, from));
    this.engine = await detectEngine();
    await this.load();
    if (this.status?.on || this.status?.segments) await this.loadTranscript();
  }

  async load() {
    try { this.status = await callTool('meet.notes_status', { meeting: this.mid }); }
    catch { return; }
    if (this.status.notes_written_at && (!this.notes || this.notes.written_at !== this.status.notes_written_at)) this.notes = await callTool('meet.get_notes', { meeting: this.mid }).catch(() => this.notes);
    await this.reconcile();
    this.call.render();
  }

  async loadTranscript() {
    const r = await callTool('meet.get_transcript', { meeting: this.mid }).catch(() => null);
    for (const s of r?.segments ?? []) this.add({ ...s, start_at: Date.parse(s.start_at), end_at: Date.parse(s.end_at), name: s.speaker, pid: s.participant });
  }

  get mine() { return this.status?.you; }

  // Start or stop the transcribers this device should run, from the latest status.
  async reconcile() {
    const s = this.status;
    const on = !!s?.on;
    const want = on && this.mine?.answer === 'include' && this.call.audioOn && this.call.local.mic && this.call.canPublish();
    const by = this.mine?.written_by;
    const ownEngine = by === 'self' ? this.engine : by === 'server' ? 'server' : null;
    if (on && this.mine?.answer === 'pending' && !this.asked) this.ask();
    if (!want || !ownEngine) { this.own?.stop(); this.own = null; }
    else if (!this.own || this.own.track !== this.call.local.mic || this.own.engine !== ownEngine) {
      this.own?.stop();
      this.own = this.makeTranscriber(this.call.local.mic, ownEngine, { pid: this.call.me.id, name: this.call.me.display_name });
    }
    // Write for people whose devices cannot, when the status says this device is their helper.
    const helpFor = new Set(on && /^whisper/.test(this.engine) ? s.helping : []);
    for (const [pid, t] of this.helping) if (!helpFor.has(pid) || t.track !== this.call.remoteFor(pid, 'mic')) { t.stop(); this.helping.delete(pid); }
    for (const pid of helpFor) {
      if (this.helping.has(pid)) continue;
      const track = this.call.remoteFor(pid, 'mic');
      const person = s.people.find((p) => p.participant === pid);
      if (track && person) this.helping.set(pid, this.makeTranscriber(track, this.engine, { pid, name: person.name, helper: true }));
    }
    this.state = !on ? 'off' : this.own?.state ?? (this.mine?.answer === 'exclude' ? 'excluded' : this.mine?.answer === 'pending' ? 'asking' : !this.call.audioOn ? 'muted' : 'waiting');
  }

  makeTranscriber(track, engine, who) {
    const t = new Transcriber({
      track, engine,
      server: async (wav, start, end) => (await callTool('meet.transcribe_audio', { meeting: this.mid, audio_base64: wav, start_at: String(Math.round(start)), end_at: String(Math.round(end)) })).text,
      onState: (st, p) => {
        t.state = st;
        if (!who.helper) { this.state = st; this.progress = p; }
        if (st === 'error') toast(p?.message ?? 'Notes stopped on this device.');
        this.call.render();
      },
      onSegment: (seg) => this.spoke(seg, who, engine === 'server'),
    });
    t.start().catch((e) => { t.state = 'error'; this.state = 'error'; toast(e.message); this.call.render(); });
    return t;
  }

  // A line this device wrote down: show it, send it to the others encrypted, and keep it with the meeting.
  async spoke(seg, who, savedByServer) {
    const line = { ...seg, pid: who.pid, name: who.name };
    this.add(line);
    this.channel.send('cap', line).catch(() => {});
    if (!savedByServer) {
      // Kept with the meeting; tried again when the connection drops for a moment (the line's id keeps it single).
      const line = { id: seg.id, participant: who.pid, start_at: String(seg.start_at), end_at: String(seg.end_at), text: seg.text, engine: seg.engine };
      for (let i = 0; i < 5; i++) {
        try { await callTool('meet.add_transcript', { meeting: this.mid, segments: [line] }); break; }
        catch (e) { if (e.code !== 'offline' && e.code !== 'server') { console.warn('[meet] transcript', e.message); break; } await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); }
      }
    }
  }

  received(seg, from) {
    if (!seg?.id || this.timeline.has(seg.id)) return;
    this.metrics.push({ id: seg.id, from, pid: seg.pid, speech_end: seg.speech_end, arrived: Math.round(performance.timeOrigin + performance.now()), run_ms: seg.run_ms });
    this.add(seg);
  }

  add(seg) {
    if (this.timeline.has(seg.id)) return;
    this.timeline.set(seg.id, seg);
    this.call.render();
  }

  lines() { return [...this.timeline.values()].sort((a, b) => a.start_at - b.start_at); }

  ask() {
    this.asked = true;
    this.shownAt = new Date().toISOString();
    const d = this.call.root.querySelector('#notesdlg');
    if (!d) return;
    d.innerHTML = `<h3>Notes are on</h3>
      <p>${esc(this.status.started_by ?? 'The host')} turned on AI notes. If you agree, your device writes down what you say, and your words are kept with this meeting so the team gets a summary and action items.</p>
      <p class="ui-mute">How: ${esc(ENGINE_LABEL[this.engine] ?? this.engine)}. You can change your answer any time, or leave the call.</p>
      <div class="ui-dialog-a"><button class="ui-btn is-ghost" data-tool="meet.answer_notes" data-act="notes-out">Leave my voice out</button><button class="ui-btn is-accent" data-tool="meet.answer_notes" data-act="notes-in">Include my voice</button></div>`;
    if (!d.open) try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }

  async answer(include) {
    const d = this.call.root.querySelector('#notesdlg');
    if (d?.open) d.close();
    await callTool('meet.answer_notes', { meeting: this.mid, include, engine: this.engine, ...(this.shownAt ? { shown_at: this.shownAt } : {}) });
    toast(include ? 'Your voice is in the notes.' : 'Your voice is left out of the notes.');
    await this.load();
  }

  // ------------------------------------------------------------ drawing

  marker() {
    if (!this.status?.on) return '';
    return `<span class="ui-chip is-soft meet-notes-on" title="Notes are on: words of people who agreed are written down"><span class="ui-dot meet-live"></span> Notes on</span>`;
  }

  captionsHtml() {
    if (!this.status?.on && !this.timeline.size) return '';
    if (!this.captions) return '';
    const now = Date.now();
    const recent = this.lines().filter((s) => now - s.end_at < CAPTION_MS).slice(-3);
    if (!recent.length) return '';
    return `<div class="meet-captions" aria-live="polite">${recent.map((s) => `<p><b>${esc(s.name)}</b> ${esc(s.text)}</p>`).join('')}</div>`;
  }

  panelHtml() {
    const s = this.status;
    const host = this.call.amHost();
    if (!s) return '<p class="ui-empty">Loading notes…</p>';
    const mine = s.you;
    const stateWord = { loading: `Loading the speech model${this.progress?.total ? ` (${Math.round((this.progress.loaded / this.progress.total) * 100)}%)` : ''}…`, listening: 'Listening', muted: 'Paused while you are muted', excluded: 'Your voice is left out', asking: 'Waiting for your answer', waiting: 'Starting…', error: 'Stopped on this device', off: '' }[this.state] ?? '';
    const writtenBy = mine?.written_by === 'self' ? ENGINE_LABEL[this.engine] : mine?.written_by === 'server' ? ENGINE_LABEL.server : mine?.written_by?.startsWith('helper:') ? `${ENGINE_LABEL.helper}: ${esc(s.people.find((p) => `helper:${p.participant}` === mine.written_by)?.name ?? 'someone')}` : mine?.answer === 'include' ? 'Nobody can yet: this device cannot, and there is no helper or speech service' : '';
    const head = s.on
      ? `<div class="meet-notes-h"><span class="ui-dot meet-live"></span><span><b>Notes are on</b><br><span class="ui-mute">Turned on by ${esc(s.started_by ?? 'the host')}. Only people who agreed are written down.</span></span></div>`
      : `<div class="meet-notes-h"><span class="ui-dot"></span><span><b>Notes are off</b><br><span class="ui-mute">${host ? 'Turn them on and everyone is asked first. Each person\'s own device writes down their words.' : 'The host can turn on AI notes. You will be asked first.'}</span></span></div>`;
    const hostA = host ? `<p class="meet-side-a">${s.on ? '<button class="ui-btn is-quiet is-sm" data-tool="meet.stop_notes" data-act="notes-stop">Turn notes off</button>' : '<button class="ui-btn is-accent is-sm" data-tool="meet.start_notes" data-act="notes-start">Turn notes on</button>'}</p>` : '';
    const me = s.on && mine ? `<h3 class="meet-side-sub">Your voice</h3>
      <div class="meet-notes-me"><span>${mine.answer === 'include' ? 'Included' : mine.answer === 'exclude' ? 'Left out' : 'Not answered yet'}${stateWord ? ` · ${esc(stateWord)}` : ''}</span>
      ${mine.answer === 'include' ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.answer_notes" data-act="notes-out">Leave my voice out</button>' : '<button class="ui-btn is-ghost is-sm" data-tool="meet.answer_notes" data-act="notes-in">Include my voice</button>'}</div>
      ${writtenBy ? `<p class="ui-hint">Written down by: ${writtenBy}</p>` : ''}` : '';
    const people = s.on ? `<h3 class="meet-side-sub">Everyone</h3><ul class="meet-plist">${s.people.map((p) => `<li class="meet-nrow"><span>${esc(p.name)}</span><span class="ui-chip ${p.answer === 'include' ? 'is-good' : 'is-outline'}">${p.answer === 'include' ? 'Included' : p.answer === 'exclude' ? 'Left out' : 'Asked'}</span></li>`).join('')}</ul>` : '';
    const lines = this.lines();
    const transcript = lines.length ? `<h3 class="meet-side-sub">Transcript <span class="ui-badge is-quiet">${lines.length}</span></h3><ol class="meet-transcript">${lines.map((l) => `<li><span class="meet-tr-h"><b>${esc(l.name)}</b> <time class="ui-mute">${new Date(l.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time></span><span>${esc(l.text)}</span></li>`).join('')}</ol>` : s.on ? '<p class="ui-empty">Nothing said yet. Lines show here a moment after someone stops talking.</p>' : '';
    const n = this.notes?.summary ? this.notes : null;
    const notes = n ? `<h3 class="meet-side-sub">Notes ${n.scripted ? '<span class="ui-chip is-outline">Demo notes (a script, not AI)</span>' : `<span class="ui-chip is-outline">${esc(n.model)}</span>`}</h3>
      <div class="meet-notes-b"><p>${esc(n.summary)}</p>
      ${n.decisions.length ? `<p class="ui-label">Decisions</p><ul>${n.decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      ${n.action_items.length ? `<p class="ui-label">Action items</p><ul>${n.action_items.map((a) => `<li>${esc(a.text)}${a.owner || a.due ? ` <span class="ui-mute">(${esc([a.owner, a.due].filter(Boolean).join(', '))})</span>` : ''}</li>`).join('')}</ul>` : ''}</div>` : '';
    const canWrite = lines.length || s.segments;
    const del = host && s.segments ? '<button class="ui-btn is-ghost is-sm is-danger" data-tool="meet.delete_transcript" data-act="notes-delete">Delete transcript and notes</button>' : '';
    const write = canWrite ? `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.summarise" data-act="notes-write">${n ? 'Write the notes again' : 'Write notes now'}</button>${n ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.get_notes" data-act="notes-copy">Copy notes</button>' : ''}</p>${!s.model.ready ? '<p class="ui-hint">No model is set up, so a short script writes demo notes. Set a model in Settings to have AI write them.</p>' : ''}` : '';
    const linked = this.call.meeting.linked_record ?? '';
    const send = n ? (s.in_suite ? `<h3 class="meet-side-sub">Send the notes</h3><div class="meet-send">
        <form data-tool="meet.notes_to_crm" data-act="send-crm"><label class="ui-sr" for="n-crm">CRM record</label><input class="ui-input" id="n-crm" name="record" placeholder="crm:deal:Acme Dental" value="${esc(linked.startsWith('crm:') ? linked : '')}"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_crm">Save to CRM</button></form>
        <form data-tool="meet.notes_to_board" data-act="send-board"><label class="ui-sr" for="n-board">Board client</label><input class="ui-input" id="n-board" name="client" placeholder="Client on the board"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_board">Add tasks</button></form>
        <form data-tool="meet.notes_to_chat" data-act="send-chat"><label class="ui-sr" for="n-chat">Chat channel</label><input class="ui-input" id="n-chat" name="channel" placeholder="general" value="${esc(linked.startsWith('chat:') ? linked.split(':').pop() : '')}"><button class="ui-btn is-sm" type="submit" data-tool="meet.notes_to_chat">Post in Chat</button></form>
        <p><button class="ui-btn is-sm" data-tool="meet.notes_to_email" data-act="send-email">Email everyone on the team who joined</button></p>
      </div>` : '<p class="ui-hint">Inside wOS, the notes go to the CRM, the board, Chat and email in one click.</p>') : '';
    return `${head}${hostA}${me}${notes}${write}${send}${transcript}${people}${del ? `<p class="meet-side-a">${del}</p>` : ''}`;
  }

  async onAct(a, el) {
    const mid = this.mid;
    if (a === 'notes-start') { await callTool('meet.start_notes', { meeting: mid }); toast('Notes are on. Everyone is asked first.'); return this.load(); }
    if (a === 'notes-stop') { await callTool('meet.stop_notes', { meeting: mid }); return this.load(); }
    if (a === 'notes-in') return this.answer(true);
    if (a === 'notes-out') return this.answer(false);
    if (a === 'notes-write') { toast('Writing the notes…'); this.notes = await callTool('meet.summarise', { meeting: mid }); if (this.notes.warning) toast(this.notes.warning); return this.call.render(); }
    if (a === 'notes-delete') {
      if (!confirm('Delete this meeting\'s transcript and notes for everyone? This cannot be undone.')) return;
      await callTool('meet.delete_transcript', { meeting: mid }); this.timeline.clear(); this.notes = null; toast('Transcript and notes deleted'); return this.load();
    }
    if (a === 'notes-copy') { const n = await callTool('meet.get_notes', { meeting: mid }); await copyText(plain(n)); return toast('Notes copied'); }
    if (a === 'send-email') { const r = await callTool('meet.notes_to_email', { meeting: mid }); return toast(`Emailed ${r.to.length} ${r.to.length === 1 ? 'person' : 'people'}`); }
    if (a === 'captions') { this.captions = !this.captions; return this.call.render(); }
  }

  async onSubmit(form) {
    const f = new FormData(form);
    const mid = this.mid;
    const act = form.dataset.act;
    if (act === 'send-crm') { const r = await callTool('meet.notes_to_crm', { meeting: mid, record: String(f.get('record') || '').trim() || 'linked' }); toast(`Saved to ${r.to}`); }
    if (act === 'send-board') { const r = await callTool('meet.notes_to_board', { meeting: mid, client: String(f.get('client') || '').trim() || undefined }); toast(r.sent ? `Added ${r.tasks.length} ${r.tasks.length === 1 ? 'task' : 'tasks'} for ${r.client}` : r.message); }
    if (act === 'send-chat') { const r = await callTool('meet.notes_to_chat', { meeting: mid, channel: String(f.get('channel') || '').trim() || undefined }); toast(`Posted in ${r.channel}`); }
  }

  // For tests and the report.
  snapshot() {
    return { state: this.state, engine: this.engine, status: this.status, lines: this.lines(), metrics: this.metrics, whisper: { ...whisperStats }, channel: this.channel?.stats, notes: this.notes };
  }

  stop() { this.own?.stop(); for (const t of this.helping.values()) t.stop(); this.helping.clear(); }
}

function plain(n) {
  const out = [n.title ? `Meeting notes: ${n.title}` : 'Meeting notes', n.scripted ? '(Demo notes, a script, not AI)' : '', '', n.summary];
  if (n.decisions?.length) out.push('', 'Decisions:', ...n.decisions.map((d) => `- ${d}`));
  if (n.action_items?.length) out.push('', 'Action items:', ...n.action_items.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ''}`));
  return out.join('\n');
}

export const notesIcon = () => icon('notes');
