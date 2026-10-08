// Recording in the browser. One browser records (the person who asked): it draws the call onto a canvas
// (everyone who agreed: their camera, or their initials, and any screen they share) and mixes their sound,
// and MediaRecorder turns that into a video file. People who said no, or have not answered, are not drawn
// and not heard. When it stops, the file goes to that person's disk, or straight to the team's S3-compatible
// storage through a one-hour upload link from meet.recording_upload_url.
import { callTool } from './api.mjs';
import { esc, icon, toast, initials } from './dom.mjs';

const W = 1280, H = 720, FPS = 24;
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];

export class Recording {
  constructor(call) {
    this.call = call;
    this.status = null;
    this.rec = null; // the recorder, in the recording browser only
    this.done = null; // { blob, mime, duration_s, recording } after it stops, until saved
  }

  get mid() { return this.call.meeting.id; }

  async load() {
    try { this.status = await callTool('meet.recording_status', { meeting: this.mid }); } catch { return; }
    this.reconcile();
    this.call.render();
  }

  reconcile() {
    const s = this.status;
    const live = s && ['asking', 'recording'].includes(s.state);
    if (live && s.you?.answer === 'pending' && this.asked !== s.recording) this.ask();
    if (!live) this.closeAsk();
    const iRecord = live && s.state === 'recording' && s.you?.recorder;
    if (iRecord && !this.rec) this.start();
    if (this.rec) this.rec.include(new Set(s?.included ?? []));
    if (this.rec && (!s || s.state !== 'recording' || s.recording !== this.rec.id)) this.finish();
  }

  ask() {
    this.asked = this.status.recording;
    this.shownAt = new Date().toISOString();
    const d = this.call.root.querySelector('#recdlg');
    if (!d) return;
    d.innerHTML = `<h3>Record this call?</h3>
      <p>${esc(this.status.started_by ?? 'The host')} wants to record this call: the video and sound of everyone who agrees. Anyone who says no is left out of the picture and the sound.</p>
      <p class="ui-mute">You can change your answer while it records, turn your camera or microphone off, or leave.</p>
      <div class="ui-dialog-a"><button class="ui-btn is-ghost" data-tool="meet.answer_recording" data-act="rec-no">Leave me out</button><button class="ui-btn is-accent" data-tool="meet.answer_recording" data-act="rec-yes">Record me</button></div>`;
    if (!d.open) try { d.showModal(); } catch { d.setAttribute('open', ''); }
  }

  closeAsk() { const d = this.call.root.querySelector('#recdlg'); if (d?.open) d.close(); }

  async answer(agree) {
    this.closeAsk();
    this.status = await callTool('meet.answer_recording', { meeting: this.mid, agree, ...(this.shownAt ? { shown_at: this.shownAt } : {}) });
    toast(agree ? 'You are in the recording.' : 'You are left out of the recording.');
    this.reconcile();
    this.call.render();
  }

  start() {
    try {
      this.rec = new Compositor(this.call, this.status.recording);
      this.rec.include(new Set(this.status.included));
      this.rec.start();
    } catch (e) { this.rec = null; toast(`This browser cannot record: ${e.message}`); }
  }

  async finish() {
    const r = this.rec;
    this.rec = null;
    this.done = await r.stop();
    this.call.render();
  }

  marker() {
    const s = this.status;
    if (!s || !['asking', 'recording'].includes(s.state)) return '';
    return s.state === 'recording'
      ? '<span class="ui-chip is-bad meet-rec-on" title="This call is being recorded"><span class="ui-dot is-bad"></span> Recording</span>'
      : '<span class="ui-chip is-soft meet-rec-on" title="Everyone is being asked about recording"><span class="ui-dot is-warn"></span> Asking to record</span>';
  }

  moreItems() {
    if (!this.call.amHost()) return [];
    const live = ['asking', 'recording'].includes(this.status?.state);
    return [live ? ['rec-stop', 'meet.stop_recording', 'Stop recording', 'record'] : ['rec-start', 'meet.start_recording', 'Record the call', 'record']];
  }

  notice() {
    if (!this.done) return '';
    const mb = (this.done.blob.size / 1e6).toFixed(1);
    return `<div class="ui-notice"><span>Your recording is ready: ${mb} MB, ${fmtDur(this.done.duration_s)}. Save it before you leave.</span>
      <button class="ui-btn is-accent is-sm" data-tool="meet.save_recording" data-act="rec-download">${icon('download', 16)} Download</button>
      ${this.status?.storage_ready ? '<button class="ui-btn is-sm" data-tool="meet.recording_upload_url" data-act="rec-upload">Save to team storage</button>' : ''}</div>`;
  }

  infoRow() {
    const s = this.status;
    if (!s || s.state === 'off') return 'Off. Recording starts only after everyone in the call is asked, and leaves out anyone who says no.';
    const yes = s.people.filter((p) => p.answer === 'agree').length, no = s.people.filter((p) => p.answer === 'decline').length, wait = s.people.filter((p) => p.answer === 'pending' && p.in_call).length;
    if (s.state === 'asking') return `Asking everyone: ${yes} agreed, ${no} said no, ${wait} still deciding.`;
    if (s.state === 'recording') return `Recording ${yes} ${yes === 1 ? 'person' : 'people'}${no ? `, ${no} left out` : ''}${wait ? `, ${wait} still deciding (left out until they agree)` : ''}.`;
    if (s.saved) return `Last recording saved to ${s.saved.where === 'disk' ? 'a disk' : 'team storage'} (${(s.saved.size_bytes / 1e6).toFixed(1)} MB).`;
    return 'Stopped.';
  }

  async onAct(a) {
    const mid = this.mid;
    if (a === 'rec-start') { this.status = await callTool('meet.start_recording', { meeting: mid }); toast('Asking everyone first. Recording starts when they have answered.'); this.reconcile(); return this.call.render(); }
    if (a === 'rec-stop') { await callTool('meet.stop_recording', { meeting: mid }); return this.load(); }
    if (a === 'rec-yes') return this.answer(true);
    if (a === 'rec-no') return this.answer(false);
    if (a === 'rec-download' && this.done) {
      const d = this.done;
      const ext = /mp4/.test(d.mime) ? 'mp4' : 'webm';
      const url = URL.createObjectURL(d.blob);
      const el = Object.assign(document.createElement('a'), { href: url, download: `${this.call.meeting.title.replace(/[^\w -]+/g, '').trim() || 'meeting'} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.${ext}` });
      document.body.append(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      await callTool('meet.save_recording', { meeting: mid, recording: d.recording, where: 'disk', size_bytes: d.blob.size, duration_s: d.duration_s, mime: d.mime });
      this.done = null; toast('Saved to your downloads'); return this.load();
    }
    if (a === 'rec-upload' && this.done) {
      const d = this.done;
      toast('Uploading…');
      const u = await callTool('meet.recording_upload_url', { meeting: mid, recording: d.recording, mime: d.mime });
      // Straight to the team's bucket with a presigned link; the file does not pass through the app's server.
      const r = await fetch(u.url, { method: u.method, headers: u.headers, body: d.blob });
      if (!r.ok) throw new Error(`The storage refused the upload (${r.status}). Download it instead.`);
      await callTool('meet.save_recording', { meeting: mid, recording: d.recording, where: 'storage', size_bytes: d.blob.size, duration_s: d.duration_s, mime: d.mime });
      this.done = null; toast('Saved to team storage'); return this.load();
    }
  }

  snapshot() { return { status: this.status, recording: !!this.rec, included: this.rec ? [...this.rec.included] : null, frames: this.rec?.frames ?? 0, done: this.done ? { size: this.done.blob.size, mime: this.done.mime, duration_s: this.done.duration_s } : null }; }

  stop() { if (this.rec) this.rec.stop().catch(() => {}); }
}

const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

// Draws the call onto a canvas and mixes the sound of the people included.
class Compositor {
  constructor(call, id) {
    this.call = call;
    this.id = id;
    this.included = new Set();
    this.videos = new Map(); // track id -> <video>
    this.sources = new Map(); // track id -> audio source node
    this.frames = 0;
    const mime = TYPES.find((t) => globalThis.MediaRecorder?.isTypeSupported?.(t));
    if (!mime || !HTMLCanvasElement.prototype.captureStream) throw new Error('no MediaRecorder or canvas capture');
    this.mime = mime.split(';')[0];
    this.canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.g = this.canvas.getContext('2d');
    this.ac = new AudioContext();
    this.dest = this.ac.createMediaStreamDestination();
    // A silent source keeps the audio track running when nobody included is talking.
    const quiet = this.ac.createConstantSource(); const g0 = this.ac.createGain(); g0.gain.value = 0; quiet.connect(g0).connect(this.dest); quiet.start();
    const stream = new MediaStream([this.canvas.captureStream(FPS).getVideoTracks()[0], this.dest.stream.getAudioTracks()[0]]);
    this.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    this.chunks = [];
    this.mr.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
  }

  include(set) { this.included = set; this.syncAudio(); }

  start() {
    this.t0 = performance.now();
    this.mr.start(1000);
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    this.timer = setInterval(() => this.draw(), 1000 / FPS);
  }

  // Who is in the picture: everyone included who is in the call, their camera and any screen they share.
  tracks() {
    const c = this.call;
    const out = [];
    for (const p of c.people) {
      if (!this.included.has(p.id) || !(p.in_call || p.id === c.me.id)) continue;
      const mine = p.id === c.me.id;
      const cam = mine ? (c.videoOn ? c.local.cam : null) : (p.video_on ? c.remoteFor(p.id, 'cam') : null);
      const screen = mine ? c.local.screen : (p.sharing ? c.remoteFor(p.id, 'screen') : null);
      const mic = mine ? (c.audioOn ? c.local.mic : null) : c.remoteFor(p.id, 'mic');
      out.push({ p, cam, screen, mic, mine });
    }
    return out;
  }

  syncAudio() {
    const want = new Map(this.tracks().filter((x) => x.mic && x.mic.readyState === 'live').map((x) => [x.mic.id, x.mic]));
    for (const [id, node] of this.sources) if (!want.has(id)) { node.disconnect(); this.sources.delete(id); }
    for (const [id, t] of want) if (!this.sources.has(id)) { const n = this.ac.createMediaStreamSource(new MediaStream([t])); n.connect(this.dest); this.sources.set(id, n); }
  }

  video(track) {
    let v = this.videos.get(track.id);
    if (!v) { v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }); v.srcObject = new MediaStream([track]); v.play().catch(() => {}); this.videos.set(track.id, v); }
    return v;
  }

  draw() {
    const g = this.g;
    g.fillStyle = '#111113'; g.fillRect(0, 0, W, H);
    const list = this.tracks();
    if (this.frames % FPS === 0) this.syncAudio();
    const share = list.find((x) => x.screen);
    const tiles = list.map((x) => ({ ...x, track: x.cam }));
    let area = { x: 0, y: 0, w: W, h: H };
    if (share) {
      this.fit(this.video(share.screen), 0, 0, W, H - 150, true);
      area = { x: 0, y: H - 140, w: W, h: 140 };
    }
    const n = Math.max(1, tiles.length);
    const cols = share ? n : Math.ceil(Math.sqrt(n));
    const rows = share ? 1 : Math.ceil(n / cols);
    const gap = 8, tw = (area.w - gap * (cols + 1)) / cols, th = (area.h - gap * (rows + 1)) / rows;
    tiles.forEach((t, i) => {
      const x = area.x + gap + (i % cols) * (tw + gap), y = area.y + gap + Math.floor(i / cols) * (th + gap);
      g.fillStyle = '#222226'; g.fillRect(x, y, tw, th);
      if (t.track && t.track.readyState === 'live') this.fit(this.video(t.track), x, y, tw, th, false); // not mirrored: others see you the right way round
      else { g.fillStyle = '#e8e8ea'; g.font = `600 ${Math.round(Math.min(tw, th) / 4)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(t.p.display_name), x + tw / 2, y + th / 2); }
      g.font = '500 18px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const label = t.p.display_name; const lw = g.measureText(label).width + 16;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 8, y + th - 34, lw, 26); g.fillStyle = '#fff'; g.fillText(label, x + 16, y + th - 15);
    });
    if (!tiles.length) { g.fillStyle = '#a1a1aa'; g.font = '500 24px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Nobody in the call has agreed to be recorded yet', W / 2, H / 2); }
    this.frames++;
  }

  // Cover (cameras) or contain (screens) the box with the video.
  fit(v, x, y, w, h, contain, mirror) {
    if (!v.videoWidth) return;
    const r = v.videoWidth / v.videoHeight, br = w / h;
    let sw = v.videoWidth, sh = v.videoHeight, sx = 0, sy = 0, dx = x, dy = y, dw = w, dh = h;
    if (contain) { if (r > br) { dh = w / r; dy = y + (h - dh) / 2; } else { dw = h * r; dx = x + (w - dw) / 2; } }
    else if (r > br) { sw = sh * br; sx = (v.videoWidth - sw) / 2; } else { sh = sw / br; sy = (v.videoHeight - sh) / 2; }
    const g = this.g;
    if (mirror) { g.save(); g.translate(dx + dw, dy); g.scale(-1, 1); g.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh); g.restore(); }
    else g.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  async stop() {
    clearInterval(this.timer);
    const done = new Promise((res) => { this.mr.onstop = res; });
    if (this.mr.state !== 'inactive') this.mr.stop();
    await done;
    for (const v of this.videos.values()) v.srcObject = null;
    this.ac.close().catch(() => {});
    return { blob: new Blob(this.chunks, { type: this.mime }), mime: this.mime, duration_s: Math.round((performance.now() - this.t0) / 1000), recording: this.id };
  }
}
