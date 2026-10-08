// The call screen: tiles, the control bar, and the side panel (people, chat, call info). It connects media
// through one of three engines, chosen by the room plan the server sends:
//   p2p      everyone straight to everyone (media/p2p.mjs)
//   hosts    computers in the call forward the media, encrypted end to end (media/sfu.mjs)
//   livekit  a LiveKit media server (media/livekit.mjs)
// and shows a plain message when the room is full ("capped").
import { callTool, mediaJoin, getTicket, getMediaBase } from './api.mjs';
import { Signal } from './signal.mjs';
import { esc, icon, toast, initials, copyText } from './dom.mjs';
import { Notes } from './notes.mjs';
import { Recording } from './record.mjs';
import { Whiteboard } from './board.mjs';

const SPEAK_LEVEL = 0.03;
// Webinar viewers hear and see speakers this much later (a receive buffer, 1 to 3 s as decided): smoother
// playback, and room for the longer paths of a broadcast tree.
export const VIEWER_DELAY_MS = 2000;

export class Call {
  constructor({ root, meeting, participant, media, local, prefs, onExit }) {
    Object.assign(this, { root, meeting, me: participant, media, onExit });
    this.local = { mic: local.mic ?? null, cam: local.cam ?? null, screen: null };
    this.audioOn = !!prefs.audio && !!this.local.mic;
    this.videoOn = !!prefs.video && !!this.local.cam;
    this.people = [];
    this.waiting = 0;
    this.remote = new Map(); // `${peer}:${source}` -> { track, receiver }
    this.levels = new Map(); // pid -> { level, at }
    this.peerTrouble = new Map(); // peer -> reason
    this.layout = participant.layout ?? 'grid';
    this.panel = null;
    this.chat = [];
    this.chatSeen = 0;
    this.requests = [];
    this.tiles = new Map(); // key -> element
    this.audios = new Map(); // `${peer}` -> <audio>
    this.timings = { t0: performance.now() };
  }

  // ------------------------------------------------------------ start and stop

  async start() {
    this.renderFrame();
    if (this.local.mic) this.local.mic.enabled = this.audioOn;
    if (!this.videoOn && this.local.cam) { this.local.cam.stop(); this.local.cam = null; }
    // Tell the room what we start with, so others draw us right.
    callTool('meet.set_my_media', { meeting: this.meeting.id, audio: this.audioOn, video: this.videoOn }).catch(() => {});
    const j = await mediaJoin({ ticket: getTicket() });
    this.peer = j.peer;
    this.signal = new Signal({ media: getMediaBase(), token: j.token, cursor: j.cursor, ws: j.ws, onGone: () => this.gone(), onState: (s) => { this.signalMode = s; } });
    this.signal.on('plan', (p) => this.applyPlan(p));
    this.signal.on('changed', (b) => this.onChanged(b));
    this.signal.on('cmd', (b) => this.onCmd(b));
    this.signal.on('ended', (b) => this.exit(`The meeting was ended by ${b?.by ?? 'the host'}.`, true));
    this.signal.on('peer-left', (b) => { this.peerTrouble.delete(b.peer); this.render(); });
    this.signal.start();
    if (j.plan) await this.applyPlan(j.plan);
    await Promise.all([this.loadPeople(), this.loadChat(), this.loadStatus()]);
    // AI notes and the call's encrypted channel (captions, whiteboard).
    this.notes = new Notes(this);
    await this.notes.init().catch((e) => console.warn('[meet] notes', e.message));
    this.recording = new Recording(this);
    await this.recording.load();
    this.whiteboard = new Whiteboard(this);
    await this.whiteboard.load();
    this.levelT = setInterval(() => this.pollLevels(), 250);
    this.statT = setInterval(() => this.refreshTrouble(), 3000);
    window.addEventListener('pagehide', this.onHide = () => { navigator.sendBeacon?.(`${getMediaBase()}/leave?token=` + encodeURIComponent(j.token)); });
    this.timings.joined = performance.now();
  }

  async stopMedia() {
    clearInterval(this.levelT); clearInterval(this.statT);
    this.notes?.stop();
    this.recording?.stop();
    this.whiteboard?.stop();
    if (this.onHide) window.removeEventListener('pagehide', this.onHide);
    this.ro?.disconnect();
    await this.engine?.stop().catch(() => {});
    this.engine = null;
    for (const t of [this.local.mic, this.local.cam, this.local.screen]) t?.stop();
    for (const a of this.audios.values()) { a.srcObject = null; a.remove(); }
    this.signal?.close();
    this.audioCtx?.close().catch(() => {});
  }

  async leave() {
    if ((this.recording?.rec || this.recording?.done) && !confirm('Your recording is not saved yet. Leave anyway and lose it?')) return;
    this.leaving = true;
    await callTool('meet.leave', { meeting: this.meeting.id }).catch(() => {});
    await this.exit('You left the meeting.');
  }

  async exit(message) {
    if (this.exited) return;
    this.exited = true;
    await this.stopMedia();
    this.onExit?.(message);
  }

  gone() {
    // The server dropped this connection (removed, ended, or we were away too long).
    if (!this.exited) this.exit(this.removed ? 'The host removed you from this meeting.' : 'You were disconnected from the call.');
  }

  // ------------------------------------------------------------ the plan and engines

  async applyPlan(plan) {
    if (!plan || (this.plan && plan.version <= this.plan.version)) return;
    const before = Object.keys(this.plan?.peers ?? {}).sort().join();
    this.plan = plan;
    if (Object.keys(plan.peers ?? {}).sort().join() !== before) this.onChanged({ what: 'participants' });
    const mode = plan.mode;
    let want = null;
    if ((mode === 'p2p' || mode === 'capped') && plan.p2p.includes(this.peer)) want = 'p2p';
    else if (mode === 'hosts' && plan.assign?.[this.peer]) want = 'hosts';
    else if (mode === 'livekit') want = 'livekit';
    const canPublish = this.canPublish();
    if (this.engine && this.engine.kind !== want) {
      await this.engine.stop().catch(() => {});
      this.engine = null;
      for (const k of [...this.remote.keys()]) this.trackGone(k);
    }
    if (want && !this.engine) {
      const cbs = {
        signal: this.signal, me: this.peer, local: { ...this.local, mic: this.audioOn ? this.local.mic : this.local.mic }, ice: this.media.ice_servers,
        e2eeKey: this.media.e2ee_key, canPublish,
        onTrack: (x) => this.onTrack(x), onTrackGone: (x) => this.trackGone(`${x.peer}:${x.source}`),
        onPeerState: (peer, s, reason) => { if (s === 'failed') this.peerTrouble.set(peer, reason); else this.peerTrouble.delete(peer); this.render(); },
        onEvent: (ev, d) => this.onEngineEvent(ev, d),
      };
      if (want === 'p2p') { const { P2PEngine } = await import('./media/p2p.mjs'); this.engine = new P2PEngine(cbs); }
      if (want === 'hosts') { const { SfuEngine } = await import('./media/sfu.mjs'); this.engine = new SfuEngine(cbs); }
      if (want === 'livekit') { const { LiveKitEngine } = await import('./media/livekit.mjs'); this.engine = new LiveKitEngine(cbs); }
    }
    try {
      // In a webinar, viewers connect only to people who speak; two viewers have nothing to send each other.
      const isViewer = (p) => this.meeting.kind === 'webinar' && plan.peers?.[p]?.role === 'viewer';
      if (want === 'p2p') await this.engine.update(plan.p2p.filter((p) => p === this.peer || !(isViewer(p) && isViewer(this.peer))));
      else if (this.engine) await this.engine.update(plan);
      this.engine?.setCanPublish?.(canPublish);
    } catch (e) { console.warn('[meet] media', e); toast(e.message); }
    this.render();
  }

  canPublish() {
    return !(this.meeting.kind === 'webinar' && this.myRole() === 'viewer');
  }

  myRole() { return this.people.find((p) => p.id === this.me.id)?.role ?? this.me.role; }
  amHost() { return ['host', 'cohost'].includes(this.myRole()); }

  onTrack({ peer, source, track, receiver }) {
    const key = `${peer}:${source}`;
    this.remote.set(key, { track, receiver });
    this.applyDelay(receiver);
    if (track.kind === 'audio') {
      let a = this.audios.get(peer);
      if (!a) { a = document.createElement('audio'); a.autoplay = true; a.dataset.peer = peer; this.root.querySelector('#audios').append(a); this.audios.set(peer, a); }
      a.srcObject = new MediaStream([track]);
      a.play().catch(() => this.needsTap());
    }
    track.onmute = track.onunmute = () => this.render();
    if (!this.timings.firstRemote) this.timings.firstRemote = performance.now();
    if (track.kind === 'audio') this.notes?.reconcile().catch(() => {});
    this.render();
  }

  trackGone(key) {
    const x = this.remote.get(key);
    this.remote.delete(key);
    const [peer, source] = key.split(':');
    if (source === 'mic' && x?.track.kind === 'audio') { const a = this.audios.get(peer); if (a) { a.srcObject = null; a.remove(); this.audios.delete(peer); } }
    this.render();
  }

  isViewer() { return this.meeting.kind === 'webinar' && this.myRole() === 'viewer'; }

  applyDelay(receiver) {
    if (!receiver || !('jitterBufferTarget' in receiver)) return;
    try { receiver.jitterBufferTarget = this.isViewer() ? VIEWER_DELAY_MS : null; } catch {}
  }

  // The host let me speak (or made me a viewer again): ask for the microphone and camera now, the first
  // time (the browser asks the person), and start or stop sending.
  async roleChanged() {
    const can = this.canPublish();
    for (const x of this.remote.values()) this.applyDelay(x.receiver);
    if (can && !this.local.mic && !this.local.cam) {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
        this.local.mic = st.getAudioTracks()[0] ?? null; this.local.cam = st.getVideoTracks()[0] ?? null;
      } catch { toast('The browser blocked the microphone or camera. Allow them with the icon in the address bar.'); }
      this.audioOn = !!this.local.mic; this.videoOn = !!this.local.cam;
      for (const src of ['mic', 'cam']) if (this.local[src]) await this.engine?.setTrack(src, this.local[src]);
      callTool('meet.set_my_media', { meeting: this.meeting.id, audio: this.audioOn, video: this.videoOn }).catch(() => {});
    }
    await this.engine?.setCanPublish?.(can);
    if (this.meeting.kind === 'webinar') toast(can ? 'The host let you speak. Your microphone is on.' : 'You are watching again.');
    this.render();
  }

  needsTap() {
    if (this.tapShown) return;
    this.tapShown = true;
    const n = document.createElement('button');
    n.className = 'ui-btn is-accent meet-tap'; n.dataset.tool = 'none'; n.dataset.why = 'lets the browser play sound; browsers need one tap first';
    n.textContent = 'Tap to hear the call';
    n.onclick = () => { for (const a of this.audios.values()) a.play().catch(() => {}); n.remove(); };
    this.root.querySelector('.meet-stage').append(n);
  }

  onEngineEvent(ev, d) {
    if (ev === 'levels') { const t = Date.now(); for (const x of d ?? []) { const pid = this.plan?.peers?.[x.owner]?.pid; if (pid) this.levels.set(pid, { level: 0.2, at: t }); } }
    if (ev === 'failover') { this.lastFailover = d; }
    if (ev === 'host-lost') toast('A computer carrying the call left. Moving you to another one.');
    if (ev === 'disconnected') toast('Lost the media server. Reconnecting…');
  }

  // ------------------------------------------------------------ data from tools

  async loadPeople() {
    try {
      const r = await callTool('meet.list_participants', { meeting: this.meeting.id });
      this.people = r.participants;
      const before = this.waiting;
      this.waiting = r.waiting;
      if (this.amHost() && this.waiting > before) {
        const w = await callTool('meet.list_waiting', { meeting: this.meeting.id }).catch(() => ({ waiting: [] }));
        this.waitingList = w.waiting;
        const last = w.waiting.at(-1);
        if (last) toast(`${last.display_name} is waiting to join`);
      } else if (this.amHost() && this.waiting) {
        this.waitingList = (await callTool('meet.list_waiting', { meeting: this.meeting.id }).catch(() => ({ waiting: [] }))).waiting;
      } else this.waitingList = [];
      const mine = this.people.find((p) => p.id === this.me.id);
      if (mine && this.lastRole && mine.role !== this.lastRole) this.roleChanged();
      if (mine) this.lastRole = mine.role;
      // Hosts hear about raised hands.
      const hands = new Set(this.people.filter((p) => p.hand_raised && p.id !== this.me.id).map((p) => p.id));
      if (this.amHost()) for (const id of hands) if (!this.hands?.has(id)) toast(`${this.people.find((p) => p.id === id).display_name} raised their hand`);
      this.hands = hands;
    } catch (e) { if (e.code === 'forbidden') return this.exit('You are no longer in this meeting.'); }
    this.render();
  }

  async loadChat() {
    const after = this.chat.at(-1)?.id ?? 0;
    const r = await callTool('meet.list_chat', { meeting: this.meeting.id, after }).catch(() => ({ messages: [] }));
    if (!r.messages.length) return;
    this.chat.push(...r.messages);
    if (this.panel === 'chat') this.chatSeen = this.chat.length;
    else if (r.messages.some((m) => m.participant !== this.me.id)) toast(`${r.messages.at(-1).name}: ${r.messages.at(-1).body.slice(0, 80)}`);
    this.render();
  }

  async loadStatus() {
    const s = await callTool('meet.room_status', { meeting: this.meeting.id }).catch(() => null);
    if (!s) return;
    this.status = s;
    this.meeting = { ...this.meeting, ...s.meeting };
    this.requests = s.requests ?? [];
    this.render();
  }

  onChanged(b) {
    if (this.leaving || this.exited) return;
    clearTimeout(this.chT?.[b.what]);
    this.chT ??= {};
    this.chT[b.what] = setTimeout(() => {
      if (b.what === 'participants' || b.what === 'waiting') this.loadPeople();
      if (b.what === 'chat') this.loadChat();
      if (b.what === 'meeting') this.loadStatus();
      if (b.what === 'notes' || (b.what === 'participants' && this.notes?.status?.on)) this.notes?.load();
      if (b.what === 'board') this.whiteboard?.load();
      if (b.what === 'recording' || (b.what === 'participants' && this.recording?.status?.state === 'recording')) this.recording?.load();
    }, 60);
  }

  async onCmd(b) {
    if (b.to_pid !== this.me.id) return;
    if (b.removed) { this.removed = true; return this.exit('The host removed you from this meeting.'); }
    if (b.set_media) {
      if (b.set_media.audio === false && this.audioOn) { this.setMic(false, true); if (b.by) toast(`${b.by} muted you`); }
      if (b.set_media.audio === true && !this.audioOn) this.setMic(true, true);
      if (b.set_media.video === false && this.videoOn) this.setCam(false, true);
      if (b.set_media.video === true && !this.videoOn) this.setCam(true, true);
    }
    if (b.request?.kind === 'screen_share') { this.requests = [...this.requests.filter((r) => r.id !== b.request.id), b.request]; this.render(); }
    if (b.stop_share && this.local.screen) this.stopShare(true);
    if (b.layout && b.layout !== this.layout) { this.layout = b.layout; this.render(); }
  }

  // ------------------------------------------------------------ my media

  async setMic(on, fromServer = false) {
    if (on && !this.local.mic) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); this.local.mic = s.getAudioTracks()[0]; await this.engine?.setTrack('mic', this.local.mic); }
      catch { toast('The browser blocked the microphone. Allow it with the icon in the address bar.'); return; }
    }
    this.audioOn = on;
    if (this.local.mic) this.local.mic.enabled = on;
    if (!fromServer) await callTool('meet.set_my_media', { meeting: this.meeting.id, audio: on }).catch((e) => toast(e.message));
    await this.notes?.reconcile().catch(() => {});
    this.render();
  }

  async setCam(on, fromServer = false) {
    if (on && !this.local.cam) {
      try { const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } }); this.local.cam = s.getVideoTracks()[0]; }
      catch { toast('The browser blocked the camera, or it is busy.'); return; }
      await this.engine?.setTrack('cam', this.local.cam);
    }
    if (!on && this.local.cam) { this.local.cam.stop(); this.local.cam = null; await this.engine?.setTrack('cam', null); }
    this.videoOn = on;
    if (!fromServer) await callTool('meet.set_my_media', { meeting: this.meeting.id, video: on }).catch((e) => toast(e.message));
    this.render();
  }

  // Choosing a screen is the browser's picker, which only the person can use (ROADMAP 3.3).
  async startShare() {
    let s;
    try { s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false }); }
    catch { return; }
    const t = s.getVideoTracks()[0];
    t.contentHint = 'detail';
    this.local.screen = t;
    t.onended = () => this.stopShare();
    await this.engine?.setTrack('screen', t);
    this.requests = this.requests.filter((r) => r.kind !== 'screen_share');
    await callTool('meet.set_sharing', { meeting: this.meeting.id, sharing: true }).catch((e) => toast(e.message));
    this.render();
  }

  async stopShare(fromServer = false) {
    const t = this.local.screen;
    this.local.screen = null;
    t?.stop();
    await this.engine?.setTrack('screen', null);
    if (!fromServer) await callTool('meet.set_sharing', { meeting: this.meeting.id, sharing: false }).catch(() => {});
    this.render();
  }

  // ------------------------------------------------------------ who is speaking

  async pollLevels() {
    const t = Date.now();
    // Mine, from the microphone itself.
    if (this.local.mic && this.audioOn) {
      if (!this.analyser || this.analyserTrack !== this.local.mic) {
        try {
          this.audioCtx ??= new AudioContext();
          const src = this.audioCtx.createMediaStreamSource(new MediaStream([this.local.mic]));
          this.analyser = this.audioCtx.createAnalyser(); this.analyser.fftSize = 512;
          src.connect(this.analyser); this.analyserTrack = this.local.mic; this.buf = new Float32Array(512);
        } catch {}
      }
      if (this.analyser) {
        this.analyser.getFloatTimeDomainData(this.buf);
        let sum = 0; for (const v of this.buf) sum += v * v;
        const rms = Math.sqrt(sum / this.buf.length);
        if (rms > SPEAK_LEVEL) this.levels.set(this.me.id, { level: rms, at: t });
      }
    }
    // Others, from what the browser receives (direct calls and the media server).
    for (const [key, x] of this.remote) {
      if (!key.endsWith(':mic') || !x.receiver?.getSynchronizationSources) continue;
      const lvl = x.receiver.getSynchronizationSources()[0]?.audioLevel ?? 0;
      const pid = this.plan?.peers?.[key.split(':')[0]]?.pid;
      if (pid && lvl > SPEAK_LEVEL) this.levels.set(pid, { level: lvl, at: t });
    }
    const speaking = new Set([...this.levels].filter(([, v]) => t - v.at < 700).map(([pid]) => pid));
    let loudest = null;
    for (const [pid, v] of this.levels) if (t - v.at < 700 && (!loudest || v.level > loudest.level)) loudest = { pid, level: v.level };
    // The big tile changes only after someone else talks for a moment, so it does not flicker.
    if (loudest && loudest.pid !== this.me.id && loudest.pid !== this.active) {
      if (this.candidate?.pid === loudest.pid) { if (t - this.candidate.since > 800) { this.active = loudest.pid; this.candidate = null; } }
      else this.candidate = { pid: loudest.pid, since: t };
    }
    const key = [...speaking].sort().join(',') + '|' + this.active;
    if (key !== this.speakingKey) { this.speakingKey = key; this.speaking = speaking; this.render(); }
    this.renderCaptions();
  }

  async refreshTrouble() {
    if (this.engine?.kind !== 'p2p') return;
    // A direct connection that failed is shown on that person's tile and in one plain sentence.
    this.render();
  }

  // ------------------------------------------------------------ rendering

  renderFrame() {
    this.root.innerHTML = `<div class="meet-call" data-panel="">
      <header class="meet-call-top"><div class="meet-call-t"><b>${esc(this.meeting.title)}</b><span class="ui-mute meet-mode" id="mode"></span></div><div class="meet-call-tr" id="topr"></div></header>
      <div class="meet-notices" id="notices"></div>
      <div class="meet-body">
        <section class="meet-stage" id="stage" aria-label="Call"></section>
        <aside class="meet-side" id="side" aria-label="Side panel"></aside>
      </div>
      <nav class="ui-callbar meet-bar" id="bar" aria-label="Call controls"></nav>
      <div id="audios" hidden></div>
      <dialog class="ui-dialog meet-dlg" id="notesdlg" aria-label="Notes notice"></dialog>
      <dialog class="ui-dialog meet-dlg" id="recdlg" aria-label="Recording notice"></dialog>
      <div class="meet-more" id="more" hidden></div>
    </div>`;
    this.root.removeAttribute('aria-busy');
    this.root.querySelector('#bar').addEventListener('click', (e) => this.onBar(e));
    this.root.querySelector('#side').addEventListener('click', (e) => this.onSide(e));
    this.root.querySelector('#side').addEventListener('submit', (e) => this.onSideSubmit(e));
    this.root.querySelector('#notices').addEventListener('click', (e) => this.onNotice(e));
    for (const id of ['#notesdlg', '#recdlg']) {
      this.root.querySelector(id).addEventListener('click', (e) => this.onSide(e));
      this.root.querySelector(id).addEventListener('cancel', (e) => e.preventDefault()); // answer it; Escape does not count as an answer
    }
    this.root.querySelector('#more').addEventListener('click', (e) => this.onMore(e));
  }

  render() {
    if (this.exited || !this.root.querySelector('.meet-call')) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.renderNow());
  }

  renderNow() {
    const root = this.root.querySelector('.meet-call');
    if (!root || this.exited) return;
    root.dataset.panel = this.panel ?? '';
    root.dataset.layout = this.layout;
    this.root.querySelector('#mode').textContent = modeLabel(this.plan, this.engine);
    const topr = this.markers();
    const tr = this.root.querySelector('#topr');
    if (tr.innerHTML !== topr) tr.innerHTML = topr;
    this.renderNotices();
    this.renderStage();
    this.whiteboard?.renderHead();
    this.renderBar();
    this.renderSide();
  }

  peersOf(pid) { return Object.entries(this.plan?.peers ?? {}).filter(([, v]) => v.pid === pid && v.kind === 'browser').map(([k]) => k); }

  remoteFor(pid, source) {
    for (const peer of this.peersOf(pid)) { const x = this.remote.get(`${peer}:${source}`); if (x) return x.track; }
    return null;
  }

  // What tiles to show: everyone in the call; a shared screen gets its own tile.
  tileList() {
    const inCall = this.people.filter((p) => p.id === this.me.id || p.in_call);
    const list = [];
    for (const p of inCall) {
      const mine = p.id === this.me.id;
      const cam = mine ? (this.videoOn ? this.local.cam : null) : (p.video_on ? this.remoteFor(p.id, 'cam') : null);
      if (this.meeting.kind === 'webinar' && p.role === 'viewer') continue;
      list.push({ key: `${p.id}:cam`, pid: p.id, p, track: cam, mine, audio: mine ? this.audioOn : p.audio_on });
      const scr = mine ? this.local.screen : (p.sharing ? this.remoteFor(p.id, 'screen') : null);
      if (scr) list.push({ key: `${p.id}:screen`, pid: p.id, p, track: scr, mine, screen: true });
    }
    return list;
  }

  renderStage() {
    const stage = this.root.querySelector('#stage');
    const list = this.tileList();
    const screen = list.find((t) => t.screen);
    const big = this.layout === 'speaker' || screen ? (screen ?? list.find((t) => t.pid === this.active && !t.mine) ?? list.find((t) => !t.mine) ?? list[0]) : null;
    let main = stage.querySelector('.meet-main');
    let grid = stage.querySelector('.ui-calls');
    if (!grid) {
      stage.innerHTML = '<div class="meet-main"></div><div class="ui-calls"></div><div class="meet-cap" id="captions"></div>';
      main = stage.querySelector('.meet-main'); grid = stage.querySelector('.ui-calls');
    }
    stage.classList.toggle('has-big', !!big);
    grid.classList.toggle('is-strip', !!big);
    grid.dataset.n = String(list.length - (big ? 1 : 0));
    const keep = new Set();
    for (const t of list) {
      keep.add(t.key);
      let el = this.tiles.get(t.key);
      if (!el) { el = this.makeTile(t); this.tiles.set(t.key, el); }
      this.updateTile(el, t);
      const parent = t === big ? main : grid;
      if (el.parentElement !== parent) parent.append(el);
    }
    for (const [k, el] of this.tiles) if (!keep.has(k)) { el.querySelector('video').srcObject = null; el.remove(); this.tiles.delete(k); }
    // Keep tile order stable: me first, then by join order.
    for (const t of list) { const el = this.tiles.get(t.key); if (el.parentElement === grid) grid.append(el); }
    this.fit();
    this.renderCaptions();
    // Tell the engine what we look at, so only those streams are sent to us.
    const owners = (pred) => list.filter(pred).flatMap((t) => this.peersOf(t.pid));
    this.engine?.setView?.({ visible: owners((t) => !t.mine && t !== big), big: big && !big.mine ? this.peersOf(big.pid)[0] ?? null : null });
  }

  // Size the grid so tiles are as large as the stage allows: try each column count, keep the biggest tile.
  fit() {
    const grid = this.root.querySelector('#stage .ui-calls');
    if (!grid) return;
    if (!this.ro) { this.ro = new ResizeObserver(() => this.fit()); this.ro.observe(this.root.querySelector('#stage')); }
    const n = grid.children.length;
    if (grid.classList.contains('is-strip') || !n) { grid.style.gridTemplateColumns = ''; return; }
    const cs = getComputedStyle(grid);
    const W = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const gap = parseFloat(cs.columnGap) || 8;
    const [a, b] = (getComputedStyle(grid.children[0]).aspectRatio || '16 / 10').split('/').map(Number);
    const ratio = a && b ? a / b : 1.6;
    let best = { w: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * ratio);
      if (w > best.w) best = { w, cols };
    }
    const tw = Math.max(80, Math.floor(best.w));
    const v = `repeat(${best.cols}, ${tw}px)`;
    if (grid.style.gridTemplateColumns !== v) grid.style.gridTemplateColumns = v;
  }

  makeTile(t) {
    const el = document.createElement('div');
    el.className = 'ui-tile';
    el.dataset.key = t.key;
    el.innerHTML = `<video autoplay playsinline muted></video><span class="ui-avatar">${esc(initials(t.p.display_name))}</span><span class="ui-tile-n"></span><span class="ui-tile-tag"></span>`;
    return el;
  }

  updateTile(el, t) {
    const v = el.querySelector('video');
    const live = t.track && t.track.readyState === 'live' && (t.mine || !t.track.muted);
    if (live && v.srcObject?.getVideoTracks()[0] !== t.track) { v.srcObject = new MediaStream([t.track]); v.play().catch(() => {}); }
    if (!live && v.srcObject) v.srcObject = null;
    el.classList.toggle('has-video', !!live);
    el.classList.toggle('is-mine', t.mine && !t.screen);
    el.classList.toggle('is-screen', !!t.screen);
    el.classList.toggle('is-muted', !t.screen && !t.audio);
    el.classList.toggle('is-agent', t.p.kind === 'agent');
    el.classList.toggle('is-speaking', !t.screen && !!this.speaking?.has(t.pid));
    const trouble = !t.mine && this.peersOf(t.pid).some((pr) => this.peerTrouble.has(pr));
    el.classList.toggle('is-trouble', trouble);
    const name = t.screen ? `${t.mine ? 'Your' : `${t.p.display_name}'s`} screen` : `${t.p.display_name}${t.mine ? ' (you)' : ''}`;
    const n = el.querySelector('.ui-tile-n');
    if (n.textContent !== name) n.textContent = name;
    const tag = el.querySelector('.ui-tile-tag');
    const tagHtml = trouble ? '<span class="ui-chip is-bad">Can\'t connect</span>' : t.p.hand_raised && !t.screen ? `<span class="ui-chip is-soft">${icon('hand', 13)} Hand up</span>` : t.p.kind === 'agent' ? '<span class="ui-chip is-soft">Agent</span>' : '';
    if (tag.innerHTML !== tagHtml) tag.innerHTML = tagHtml;
  }

  renderNotices() {
    const out = [];
    const p = this.plan;
    if (this.isViewer()) out.push(`<div class="ui-notice is-quiet"><span>You are watching${this.meeting.kind === 'webinar' ? ' a webinar' : ''}. Raise your hand to ask to speak.</span></div>`);
    if (p && p.capped?.includes(this.peer)) out.push(`<div class="ui-notice"><span>${esc(p.message ?? 'This call is full.')}</span></div>`);
    else if (p?.message && this.amHost()) out.push(`<div class="ui-notice is-quiet"><span>${esc(p.message)}</span></div>`);
    if (this.peerTrouble.size) {
      const names = [...this.peerTrouble.keys()].map((pr) => p?.peers?.[pr]?.name).filter(Boolean);
      const reason = [...this.peerTrouble.values()][0];
      out.push(`<div class="ui-notice is-quiet"><span>Can't connect to ${esc(names.join(', ') || 'someone')}. ${esc(reason ?? '')}</span></div>`);
    }
    for (const r of this.requests.filter((x) => x.kind === 'screen_share')) {
      if (this.local.screen) continue;
      out.push(`<div class="ui-notice"><span>${esc(r.body?.by ?? 'The host')} asked you to share your screen. You pick what to share.</span><button class="ui-btn is-accent is-sm" data-tool="meet.set_sharing" data-act="share">Share screen</button><button class="ui-btn is-ghost is-sm" data-tool="none" data-why="hides the request on this screen" data-act="dismiss" data-id="${esc(r.id)}">Not now</button></div>`);
    }
    if (this.amHost() && this.waiting && this.panel !== 'people') out.push(`<div class="ui-notice is-quiet"><span>${this.waiting} waiting to join.</span><button class="ui-btn is-sm" data-tool="meet.admit" data-act="admit-all">Let everyone in</button><button class="ui-btn is-ghost is-sm" data-tool="none" data-why="opens the people panel" data-act="see-waiting">See who</button></div>`);
    out.push(this.recording?.notice() ?? '');
    const html = out.join('');
    const el = this.root.querySelector('#notices');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  renderBar() {
    const me = this.people.find((p) => p.id === this.me.id);
    const hand = !!me?.hand_raised;
    const canPub = this.canPublish();
    const unread = Math.max(0, this.chat.length - this.chatSeen);
    const b = (act, tool, pressed, label, ic, extra = '') => `<button data-act="${act}" ${tool === 'none' ? `data-tool="none" data-why="${esc(extra)}"` : `data-tool="${tool}"`} ${pressed == null ? '' : `aria-pressed="${pressed}"`} aria-label="${esc(label)}" title="${esc(label)}">${ic}</button>`;
    const html = [
      canPub ? b('mic', 'meet.set_my_media', this.audioOn, this.audioOn ? 'Mute' : 'Unmute', icon(this.audioOn ? 'mic' : 'mic-off')) : '',
      canPub ? b('cam', 'meet.set_my_media', this.videoOn, this.videoOn ? 'Turn camera off' : 'Turn camera on', icon(this.videoOn ? 'cam' : 'cam-off')) : '',
      canPub && navigator.mediaDevices?.getDisplayMedia ? b('share', 'meet.set_sharing', this.local.screen ? true : null, this.local.screen ? 'Stop sharing' : 'Share screen', icon('screen')).replace('<button', `<button class="${this.local.screen ? 'is-on' : ''}"`) : '',
      b('hand', 'meet.raise_hand', hand ? true : null, hand ? 'Lower hand' : 'Raise hand', icon('hand')).replace('<button', `<button class="meet-hide-sm ${hand ? 'is-on' : ''}"`),
      b('layout', 'meet.set_layout', null, this.layout === 'grid' ? 'Speaker view' : 'Grid view', icon(this.layout === 'grid' ? 'speaker' : 'grid')).replace('<button', '<button class="meet-hide-sm"'),
      `<span class="meet-bar-sep" aria-hidden="true"></span>`,
      b('people', 'none', null, 'People', `${icon('people')}${this.amHost() && this.waiting ? `<span class="meet-dot">${this.waiting}</span>` : ''}`, 'opens the people panel'),
      b('chat', 'none', null, 'Chat', `${icon('chat')}${unread && this.panel !== 'chat' ? `<span class="meet-dot">${unread}</span>` : ''}`, 'opens the chat panel'),
      b('notes', 'none', null, this.notes?.status?.on ? 'Notes (on)' : 'Notes', `${icon('notes')}${this.notes?.status?.on ? '<span class="meet-dot is-rec"></span>' : ''}`, 'opens the notes panel'),
      b('more', 'none', this.moreOpen ? true : null, 'More', icon('more'), 'opens more call options'),
      `<button class="is-leave" data-act="leave" data-tool="meet.leave">Leave</button>`,
    ].join('');
    const bar = this.root.querySelector('#bar');
    if (bar.innerHTML !== html) bar.innerHTML = html;
  }

  renderSide() {
    const side = this.root.querySelector('#side');
    if (!this.panel) { if (side.innerHTML) side.innerHTML = ''; return; }
    const tab = (k, label) => `<button role="tab" aria-selected="${this.panel === k}" data-tool="none" data-why="switches the side panel" data-panel="${k}">${label}</button>`;
    const head = `<div class="meet-side-h"><div class="ui-tabs" role="tablist">${tab('people', `People <span class="ui-badge is-quiet">${this.people.filter((p) => p.in_call || p.id === this.me.id).length}</span>`)}${tab('chat', 'Chat')}${tab('notes', 'Notes')}${tab('info', 'Details')}</div><button class="ui-x" data-tool="none" data-why="closes the side panel" data-act="close" aria-label="Close">×</button></div>`;
    let body = '';
    if (this.panel === 'people') body = this.peopleHtml();
    if (this.panel === 'chat') body = this.chatHtml();
    if (this.panel === 'info') body = this.infoHtml();
    if (this.panel === 'notes') body = this.notes?.panelHtml() ?? '<p class="ui-empty">Loading notes…</p>';
    const html = head + `<div class="meet-side-b">${body}</div>`;
    if (side.dataset.html === html) return;
    // Keep what someone is typing (the chat box, the notes forms) and where they scrolled.
    const drafts = [...side.querySelectorAll('input[id]')].map((i) => [i.id, i.value]);
    const focused = document.activeElement?.closest?.('#side') ? document.activeElement.id : null;
    const scroll = side.querySelector('.meet-side-b')?.scrollTop ?? 0;
    const atEnd = (() => { const b = side.querySelector('.meet-side-b'); return !b || b.scrollTop + b.clientHeight >= b.scrollHeight - 8; })();
    side.innerHTML = html;
    side.dataset.html = html;
    for (const [id, v] of drafts) { const i = side.querySelector(`#${id}`); if (i && v) i.value = v; }
    if (focused) side.querySelector(`#${focused}`)?.focus();
    const list = side.querySelector('.meet-chatlist');
    if (list) list.scrollTop = list.scrollHeight;
    const sb = side.querySelector('.meet-side-b');
    if (sb) sb.scrollTop = this.panel === 'notes' && atEnd && this.panelWas === 'notes' ? sb.scrollHeight : scroll;
    this.panelWas = this.panel;
  }

  peopleHtml() {
    const host = this.amHost();
    const webinar = this.meeting.kind === 'webinar';
    const row = (p) => {
      const mine = p.id === this.me.id;
      const chips = [p.role === 'host' ? 'Host' : p.role === 'cohost' ? 'Co-host' : webinar && p.role === 'speaker' ? 'Speaker' : webinar && p.role === 'viewer' ? 'Viewer' : '', p.is_guest && !webinar ? 'Guest' : '', p.kind === 'agent' ? 'Agent' : '', !p.in_call && !mine ? 'Not connected' : ''].filter(Boolean);
      const acts = host && !mine && p.role !== 'host' ? `<div class="meet-prow-a ${webinar && p.hand_raised ? 'is-on' : ''}">
        ${p.audio_on ? `<button class="ui-btn is-ghost is-sm" data-tool="meet.mute_participant" data-act="mute" data-pid="${p.id}">Mute</button>` : ''}
        ${webinar ? (p.role === 'viewer' ? `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="speaker" data-pid="${p.id}">Let speak</button>` : `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="viewer" data-pid="${p.id}">Make viewer</button>`)
          : `<button class="ui-btn is-ghost is-sm" data-tool="meet.set_role" data-act="role" data-role="${p.role === 'cohost' ? (p.is_guest ? 'guest' : 'member') : 'cohost'}" data-pid="${p.id}">${p.role === 'cohost' ? 'Remove co-host' : 'Make co-host'}</button>`}
        <button class="ui-btn is-ghost is-sm" data-tool="meet.request_screen_share" data-act="ask-share" data-pid="${p.id}">Ask to share</button>
        <button class="ui-btn is-ghost is-sm is-danger" data-tool="meet.remove_participant" data-act="remove" data-pid="${p.id}">Remove</button>
      </div>` : '';
      return `<li class="meet-prow"><span class="ui-avatar is-sm">${esc(initials(p.display_name))}</span><div class="meet-prow-m"><span>${esc(p.display_name)}${mine ? ' (you)' : ''}</span><span class="meet-prow-c">${chips.map((c) => `<span class="ui-chip is-outline">${c}</span>`).join('')}${p.hand_raised ? `<span class="ui-chip is-soft">${icon('hand', 12)} Hand up</span>` : ''}</span></div><span class="meet-prow-i ${p.audio_on ? '' : 'is-off'}" title="${p.audio_on ? 'Mic on' : 'Muted'}">${icon(p.audio_on ? 'mic' : 'mic-off', 16)}</span>${acts}</li>`;
    };
    const waiting = host && this.waitingList?.length ? `<h3 class="meet-side-sub">Waiting <span class="ui-badge">${this.waitingList.length}</span></h3><ul class="meet-plist">${this.waitingList.map((w) => `<li class="meet-prow"><span class="ui-avatar is-sm">${esc(initials(w.display_name))}</span><div class="meet-prow-m"><span>${esc(w.display_name)}</span><span class="meet-prow-c">${w.is_guest ? '<span class="ui-chip is-outline">Guest</span>' : ''}</span></div><div class="meet-prow-a is-on"><button class="ui-btn is-sm" data-tool="meet.admit" data-act="admit" data-pid="${w.id}">Let in</button><button class="ui-btn is-ghost is-sm" data-tool="meet.deny" data-act="deny" data-pid="${w.id}">Deny</button></div></li>`).join('')}</ul><p><button class="ui-btn is-quiet is-sm" data-tool="meet.admit" data-act="admit-all">Let everyone in</button></p>` : '';
    // Webinar: speakers first, then raised hands, then everyone watching.
    const rank = (p) => (!webinar ? 0 : p.role !== 'viewer' ? 0 : p.hand_raised ? 1 : 2);
    const inCall = this.people.filter((p) => p.in_call || p.id === this.me.id).sort((a, b) => rank(a) - rank(b));
    const away = this.people.filter((p) => !p.in_call && p.id !== this.me.id);
    const all = host ? `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.mute_participant" data-act="mute-all">Mute everyone</button><button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button></p>` : `<p class="meet-side-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button></p>`;
    return `${waiting}${all}<h3 class="meet-side-sub">In the call</h3><ul class="meet-plist">${inCall.map(row).join('')}</ul>${away.length ? `<h3 class="meet-side-sub">Joined earlier</h3><ul class="meet-plist">${away.map(row).join('')}</ul>` : ''}`;
  }

  chatHtml() {
    const msgs = this.chat.map((m) => `<li class="meet-cmsg ${m.participant === this.me.id ? 'is-mine' : ''}"><span class="meet-cmsg-h"><b>${esc(m.name)}</b> <span class="ui-mute">${new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></span><span class="meet-cmsg-b">${linkify(esc(m.body))}</span></li>`).join('');
    return `<ul class="meet-chatlist">${msgs || '<li class="ui-empty">Messages here are seen by everyone in the call.</li>'}</ul>
      <form class="ui-composer meet-composer" data-tool="meet.send_chat" id="chatform"><label class="ui-sr" for="chatbox">Message</label><input id="chatbox" name="body" autocomplete="off" placeholder="Message everyone" maxlength="4000"><button class="ui-btn is-accent is-sm" type="submit" data-tool="meet.send_chat">Send</button></form>`;
  }

  infoHtml() {
    const s = this.status;
    const host = this.amHost();
    const m = this.meeting;
    const hosts = (s?.hosts ?? []).map((h) => `<li>${icon('computer', 16)} ${esc(h.name)}: ${h.carrying ? `carrying ${h.load ?? 0} of about ${h.capacity ?? '?'} people` : esc(h.status)}${h.upload_mbps ? `, ${h.upload_mbps} Mbit/s up` : ''}</li>`).join('');
    return `<dl class="ui-kv meet-kv">
        <dt>Link</dt><dd class="meet-link"><code>${esc(m.join_url)}</code></dd>
        <dt>Carried</dt><dd>${esc(s?.summary ?? modeLabel(this.plan, this.engine))}</dd>
        <dt>People</dt><dd>${s?.people_in_call ?? ''} in the call${s?.limit ? `, room for about ${s.limit}` : ''}</dd>
        <dt>Waiting room</dt><dd>${m.waiting_room ? 'On' : 'Off'}</dd>
        <dt>Locked</dt><dd>${m.locked ? 'Yes, nobody new can join' : 'No'}</dd>
        <dt>Recording</dt><dd>${esc(this.recording?.infoRow() ?? 'Off.')}</dd>
      </dl>
      ${hosts ? `<h3 class="meet-side-sub">Computers carrying the call</h3><ul class="meet-hosts">${hosts}</ul>` : ''}
      <div class="meet-side-a is-col">
        <button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">${icon('link', 16)} Copy invite</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.add_host" data-act="add-host">${icon('computer', 16)} Help carry this call</button>
        ${host ? `<button class="ui-btn is-quiet is-sm" data-tool="meet.lock" data-act="lock">${icon('lock', 16)} ${m.locked ? 'Unlock meeting' : 'Lock meeting'}</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.set_waiting_room" data-act="waiting-room">${m.waiting_room ? 'Turn waiting room off' : 'Turn waiting room on'}</button>
        <button class="ui-btn is-quiet is-sm" data-tool="meet.update" data-act="webinar">${m.kind === 'webinar' ? 'Switch to a normal meeting' : 'Switch to webinar mode'}</button>
        <button class="ui-btn is-danger is-sm" data-tool="meet.end" data-act="end">End for everyone</button>` : ''}
      </div>
      <div id="hostcmd"></div>`;
  }

  // ------------------------------------------------------------ actions

  async onBar(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    try {
      if (a === 'mic') await this.setMic(!this.audioOn);
      if (a === 'cam') await this.setCam(!this.videoOn);
      if (a === 'share') this.local.screen ? await this.stopShare() : await this.startShare();
      if (a === 'hand') { const me = this.people.find((p) => p.id === this.me.id); await callTool('meet.raise_hand', { meeting: this.meeting.id, raised: !me?.hand_raised }); }
      if (a === 'layout') { this.layout = this.layout === 'grid' ? 'speaker' : 'grid'; this.render(); await callTool('meet.set_layout', { meeting: this.meeting.id, layout: this.layout }); }
      if (a === 'people' || a === 'chat' || a === 'info' || a === 'notes') this.openPanel(this.panel === a ? null : a);
      if (a === 'more') { this.moreOpen = !this.moreOpen; this.renderMore(); this.render(); }
      if (a === 'leave') await this.leave();
    } catch (err) { toast(err.message); }
  }

  openPanel(p) {
    this.panel = p;
    if (p === 'chat') { this.chatSeen = this.chat.length; setTimeout(() => this.root.querySelector('#chatbox')?.focus(), 30); }
    if (p === 'info') this.loadStatus();
    if (p === 'people') this.loadPeople();
    this.render();
  }

  async onSide(e) {
    const t = e.target.closest('[data-panel]');
    if (t && t.tagName === 'BUTTON') return this.openPanel(t.dataset.panel);
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act, pid = b.dataset.pid, mid = this.meeting.id;
    try {
      if (a.startsWith('rec-')) { b.disabled = true; try { return await this.recording?.onAct(a); } finally { b.disabled = false; } }
      if (/^(notes-|send-|captions$)/.test(a)) { b.disabled = true; try { return await this.notes?.onAct(a, b); } finally { b.disabled = false; } }
      if (a === 'close') return this.openPanel(null);
      if (a === 'admit') await callTool('meet.admit', { meeting: mid, participant: pid });
      if (a === 'admit-all') await callTool('meet.admit', { meeting: mid, all: true });
      if (a === 'deny') await callTool('meet.deny', { meeting: mid, participant: pid });
      if (a === 'mute') await callTool('meet.mute_participant', { meeting: mid, participant: pid });
      if (a === 'mute-all') { await callTool('meet.mute_participant', { meeting: mid, all: true }); toast('Everyone else is muted'); }
      if (a === 'role') await callTool('meet.set_role', { meeting: mid, participant: pid, role: b.dataset.role });
      if (a === 'ask-share') { await callTool('meet.request_screen_share', { meeting: mid, participant: pid }); toast('Asked. They pick what to share.'); }
      if (a === 'remove') await callTool('meet.remove_participant', { meeting: mid, participant: pid });
      if (a === 'invite') { const r = await callTool('meet.invite', { meeting: mid }); await copyText(r.message); toast('Invite copied'); }
      if (a === 'lock') await callTool('meet.lock', { meeting: mid, locked: !this.meeting.locked });
      if (a === 'waiting-room') await callTool('meet.set_waiting_room', { meeting: mid, on: !this.meeting.waiting_room });
      if (a === 'webinar') await callTool('meet.update', { meeting: mid, kind: this.meeting.kind === 'webinar' ? 'meeting' : 'webinar' });
      if (a === 'end') { await callTool('meet.end', { meeting: mid }); await this.exit('You ended the meeting for everyone.'); }
      if (a === 'add-host') {
        const r = await callTool('meet.add_host', { meeting: mid });
        this.root.querySelector('#hostcmd').innerHTML = `<div class="ui-card meet-hostcmd"><p>Run this on a computer that is plugged in and has a good connection. It forwards the call without seeing it.</p><pre class="meet-cmd"><code>${esc(r.command)}</code></pre><p class="ui-hint">${esc(r.needs)}</p></div>`;
        await copyText(r.command);
        toast('Command copied');
      }
      if (['lock', 'waiting-room', 'webinar'].includes(a)) await this.loadStatus();
    } catch (err) { toast(err.message); }
  }

  async onSideSubmit(e) {
    if (e.target.dataset.act?.startsWith('send-')) {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try { await this.notes?.onSubmit(e.target); } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
      return;
    }
    if (e.target.id !== 'chatform') return;
    e.preventDefault();
    const box = e.target.querySelector('#chatbox');
    const body = box.value.trim();
    if (!body) return;
    box.value = '';
    try { await callTool('meet.send_chat', { meeting: this.meeting.id, body }); await this.loadChat(); }
    catch (err) { box.value = body; toast(err.message); }
  }

  async onNotice(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'share') await this.startShare();
    if (b.dataset.act === 'dismiss') { this.requests = this.requests.filter((r) => r.id !== b.dataset.id); this.render(); }
    if (b.dataset.act === 'admit-all') await callTool('meet.admit', { meeting: this.meeting.id, all: true }).catch((err) => toast(err.message));
    if (b.dataset.act === 'see-waiting') this.openPanel('people');
    if (b.dataset.act?.startsWith('rec-')) { b.disabled = true; try { await this.recording?.onAct(b.dataset.act); } catch (err) { toast(err.message); } finally { b.disabled = false; } }
  }

  // What everyone must be able to see while it is happening: notes on, recording.
  markers() {
    return [this.recording?.marker() ?? '', this.notes?.marker() ?? ''].join('');
  }

  renderCaptions() {
    const el = this.root.querySelector('#captions');
    if (!el) return;
    const html = this.notes?.captionsHtml() ?? '';
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // The More menu: things used less often, and on a phone the ones the bar has no room for.
  moreItems() {
    const me = this.people.find((p) => p.id === this.me.id);
    const hand = !!me?.hand_raised;
    const item = (act, tool, label, ic, why = '') => `<button class="meet-more-i" data-act="${act}" ${tool === 'none' ? `data-tool="none" data-why="${esc(why)}"` : `data-tool="${tool}"`}>${icon(ic, 18)}<span>${esc(label)}</span></button>`;
    return [
      item('hand', 'meet.raise_hand', hand ? 'Lower hand' : 'Raise hand', 'hand'),
      item('layout', 'meet.set_layout', this.layout === 'grid' ? 'Speaker view' : 'Grid view', this.layout === 'grid' ? 'speaker' : 'grid'),
      ...(this.recording?.moreItems() ?? []).map((x) => item(...x)),
      ...(this.whiteboard?.moreItems() ?? []).map((x) => item(...x)),
      item('captions', 'none', this.notes?.captions ? 'Hide captions' : 'Show captions', 'captions', 'shows or hides captions on this screen only'),
      item('info', 'none', 'Call details', 'info', 'opens call details'),
    ].join('');
  }

  renderMore() {
    const el = this.root.querySelector('#more');
    if (!el) return;
    el.hidden = !this.moreOpen;
    if (this.moreOpen) el.innerHTML = `<div class="meet-more-in" role="menu">${this.moreItems()}</div>`;
  }

  async onMore(e) {
    const b = e.target.closest('button[data-act]');
    if (e.target === e.currentTarget || b) { this.moreOpen = false; this.renderMore(); this.render(); }
    if (!b) return;
    const a = b.dataset.act;
    try {
      if (a === 'hand' || a === 'layout') return this.onBar({ target: b });
      if (a === 'captions') return this.notes?.onAct('captions');
      if (a === 'info') return this.openPanel('info');
      if (a.startsWith('rec-')) await this.recording?.onAct(a);
      if (a.startsWith('wb-')) await this.whiteboard?.onAct(a);
    } catch (err) { toast(err.message); }
  }

  // ------------------------------------------------------------ for tests and the parity report

  view() {
    const tiles = [...this.root.querySelectorAll('.ui-tile')].map((el) => {
      const v = el.querySelector('video');
      return { key: el.dataset.key, name: el.querySelector('.ui-tile-n').textContent, video: !!v.srcObject, w: v.videoWidth, h: v.videoHeight, t: v.currentTime, frames: v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0, speaking: el.classList.contains('is-speaking'), muted: el.classList.contains('is-muted') };
    });
    // rtp: the RTP time of the last audio packet received, so a test can tell sound is arriving right now.
    const audio = [...this.audios.values()].map((a) => ({ peer: a.dataset.peer, playing: !a.paused, t: a.currentTime, rtp: this.remote.get(`${a.dataset.peer}:mic`)?.receiver?.getSynchronizationSources?.()[0]?.rtpTimestamp ?? null }));
    return { tiles, audio };
  }

  async snapshot() {
    const { tiles, audio } = this.view();
    return { peer: this.peer, mode: this.plan?.mode, engine: this.engine?.kind ?? null, signal: this.signalMode, tiles, audio, stats: await this.engine?.stats?.(), timings: this.timings, failover: this.lastFailover ?? null };
  }
}

function modeLabel(plan, engine) {
  if (!plan) return 'Connecting…';
  if (plan.mode === 'p2p') return 'Direct connection';
  if (plan.mode === 'capped') return engine ? 'Direct connection' : 'Call is full';
  if (plan.mode === 'hosts') return `Carried by ${plan.hosts.length} ${plan.hosts.length === 1 ? 'computer' : 'computers'} · encrypted`;
  if (plan.mode === 'livekit') return 'Media server';
  return '';
}

const linkify = (s) => s.replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
