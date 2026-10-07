// wOS Meetings screens: home (start, schedule, your meetings), the join page (name, camera check, join),
// the waiting room, and the call itself (call.mjs). Every action calls a tool through callTool; the only
// other traffic is the call's media under /media.
import { callTool, setTicket, ToolFailed } from './api.mjs';
import { esc, icon, toast, initials, copyText, fmtWhen } from './dom.mjs';

const app = document.getElementById('app');
const REPO = 'https://github.com/warOnSaaS/meet';
const state = { who: null };
window.meetState = state;

route().catch(showError);
window.addEventListener('popstate', () => route().catch(showError));

async function route() {
  state.who = await callTool('meet.whoami').catch(() => ({ user: null, can_start: false }));
  const p = location.pathname;
  const m = /^\/m\/([^/?#]+)/.exec(p);
  if (m) return joinPage(decodeURIComponent(m[1]));
  return homePage();
}

function showError(e) {
  console.error(e);
  app.innerHTML = `<main class="meet-center"><div class="ui-card meet-narrow"><h1 class="meet-h">Something went wrong</h1><p class="ui-mute">${esc(e.message ?? String(e))}</p><p><a class="ui-btn is-quiet" href="/">Back to start</a></p></div></main>`;
  app.removeAttribute('aria-busy');
}

function topBar() {
  const u = state.who?.user;
  const right = u
    ? `<span class="ui-avatar is-sm" aria-hidden="true">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</span><span class="hide-sm">${esc(u.name)}</span><a class="ui-btn is-ghost is-sm" href="/auth/signout">Sign out</a>`
    : state.who?.signin_available ? `<a class="ui-btn is-quiet is-sm" href="/auth/github?next=${encodeURIComponent(location.pathname + location.search)}">${icon('github')} Sign in with GitHub</a>` : '';
  return `<header class="ui-top meet-top"><a class="ui-brand meet-brand" href="/">${icon('video')}<span>Meetings</span></a><div class="meet-top-r">${right}</div></header>`;
}

// ---------------------------------------------------------------- home

async function homePage() {
  const w = state.who;
  const signedIn = !!w.user;
  const flash = new URLSearchParams(location.search).get('signin');
  const flashMsg = { failed: 'GitHub sign-in did not finish. Try again.', unavailable: 'GitHub sign-in is not set up on this server. See docs/SELF-HOSTING.md.', 'not-on-team': 'That GitHub account is not on this team.' }[flash];
  app.innerHTML = `${topBar()}
  <main class="meet-home">
    ${flashMsg ? `<div class="ui-notice is-quiet">${esc(flashMsg)}</div>` : ''}
    <section class="meet-hero">
      <h1 class="meet-h1">Video meetings for small teams</h1>
      <p class="meet-lead">Start a call, send the link, talk. Guests join from a browser with no account. Small calls go straight between people; bigger ones are carried by a computer in the call, encrypted so it cannot see or hear them.</p>
      <div class="meet-actions">
        ${w.can_start ? `<button class="ui-btn is-accent is-lg" data-tool="meet.create" id="start">${icon('video')} Start a meeting</button>` : signedIn ? '' : w.signin_available ? `<a class="ui-btn is-accent is-lg" href="/auth/github">${icon('github')} Sign in to start a meeting</a>` : ''}
        <form class="meet-joinform" data-tool="meet.get" id="joinform">
          <label class="ui-sr" for="joinlink">Meeting link or code</label>
          <input class="ui-input" id="joinlink" name="link" placeholder="Paste a meeting link" autocomplete="off">
          <button class="ui-btn is-quiet" type="submit">Join</button>
        </form>
      </div>
    </section>
    ${signedIn ? `<section class="meet-section">
      <div class="meet-section-h"><h2 class="meet-h2">Your meetings</h2><div class="meet-section-a"><button class="ui-btn is-quiet is-sm" data-tool="meet.export" id="export">Export</button><button class="ui-btn is-quiet is-sm" data-tool="meet.doctor" id="doctor">Check calls</button></div></div>
      <div id="mine" class="meet-list"><p class="ui-empty">Loading…</p></div>
      <form class="ui-card meet-schedule" data-tool="meet.schedule" id="schedule">
        <h3 class="meet-h3">Schedule a meeting</h3>
        <div class="ui-fields">
          <label class="ui-field is-wide"><span class="ui-label">Title</span><input class="ui-input" name="title" required placeholder="Weekly stand-up" maxlength="140"></label>
          <label class="ui-field"><span class="ui-label">Starts</span><input class="ui-input" name="starts_at" type="datetime-local" required></label>
          <label class="ui-field"><span class="ui-label">Length</span><select class="ui-select" name="duration_min"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">90 minutes</option></select></label>
          <label class="ui-check is-wide"><input type="checkbox" name="waiting_room" checked> Waiting room: guests wait until you let them in</label>
        </div>
        <div class="meet-form-a"><button class="ui-btn is-accent" type="submit">Schedule</button></div>
      </form>
      <div id="doctorout"></div>
    </section>` : ''}
    <section class="meet-section meet-ways">
      <div class="ui-card"><h3 class="meet-h3">Use it here</h3><p class="ui-mute">Sign in with GitHub and start meetings on this server. Calls of up to 4 people need nothing else.</p></div>
      <div class="ui-card"><h3 class="meet-h3">Host it yourself, free</h3><p class="ui-mute">One command on your own server: <code>docker compose up</code>. Add a media server for big calls with <code>--profile meetings</code>. AGPL-3.0.</p><p><a class="ui-btn is-quiet is-sm" href="${REPO}" rel="noopener">${icon('github')} Get the code</a></p></div>
    </section>
  </main>`;
  app.removeAttribute('aria-busy');

  document.getElementById('start')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const m = await callTool('meet.create', { title: signedIn ? `${w.user.name}'s meeting` : 'Meeting' });
      const u = new URL(m.host_link);
      history.pushState({}, '', u.pathname + u.search);
      await route();
    } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
  });
  document.getElementById('joinform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get('link').toString().trim();
    if (!v) return;
    try {
      const m = await callTool('meet.get', { meeting: v });
      const u = new URL(m.join_url);
      history.pushState({}, '', u.pathname);
      await route();
    } catch (err) { toast(err.message); }
  });
  if (!signedIn) return;
  const sch = document.getElementById('schedule');
  const d = new Date(Date.now() + 864e5); d.setMinutes(0, 0, 0);
  sch.starts_at.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  sch.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(sch);
    try {
      await callTool('meet.schedule', { title: f.get('title'), starts_at: new Date(f.get('starts_at')).toISOString(), duration_min: Number(f.get('duration_min')), waiting_room: f.get('waiting_room') === 'on' });
      sch.reset();
      toast('Scheduled. Copy the invite from the list.');
      loadMine();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('export').addEventListener('click', async () => {
    try {
      const data = await callTool('meet.export');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'meetings-export.json' });
      a.click();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('doctor').addEventListener('click', async (e) => {
    const out = document.getElementById('doctorout');
    e.currentTarget.disabled = true;
    out.innerHTML = '<p class="ui-mute">Checking…</p>';
    try {
      const r = await callTool('meet.doctor');
      out.innerHTML = `<div class="ui-card meet-doctor"><h3 class="meet-h3">${esc(r.summary)}</h3><ul class="meet-checks">${r.checks.map((c) => `<li><span class="ui-chip ${c.ok ? 'is-good' : 'is-bad'}">${c.ok ? 'ok' : 'fix'}</span> <b>${esc(c.name)}</b>: ${esc(c.said)}${c.fix ? `<br><span class="ui-hint">${esc(c.fix)}</span>` : ''}</li>`).join('')}</ul></div>`;
    } catch (err) { out.innerHTML = `<div class="ui-notice is-quiet">${esc(err.message)}</div>`; }
    e.currentTarget.disabled = false;
  });
  loadMine();
}

async function loadMine() {
  const el = document.getElementById('mine');
  if (!el) return;
  const { meetings } = await callTool('meet.list');
  if (!meetings.length) { el.innerHTML = '<p class="ui-empty">No meetings yet. Start one, or schedule one below.</p>'; return; }
  el.innerHTML = meetings.map((m) => `<div class="meet-row" data-id="${esc(m.id)}">
    <div class="meet-row-m"><b>${esc(m.title)}</b><span class="ui-mute">${m.status === 'live' ? '<span class="ui-chip is-good">Live</span>' : esc(m.starts_at ? fmtWhen(m.starts_at) : 'Not scheduled')}${m.kind === 'webinar' ? ' · webinar' : ''}</span></div>
    <div class="meet-row-a">
      <button class="ui-btn is-quiet is-sm" data-tool="meet.invite" data-act="invite">Copy invite</button>
      <a class="ui-btn is-sm" href="${esc(new URL(m.join_url).pathname)}">Join</a>
      ${m.status === 'scheduled' ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.cancel" data-act="cancel">Cancel</button>' : ''}
    </div></div>`).join('');
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    try {
      if (b.dataset.act === 'invite') { const r = await callTool('meet.invite', { meeting: id }); await copyText(r.message); toast('Invite copied'); }
      if (b.dataset.act === 'cancel') { await callTool('meet.cancel', { meeting: id }); toast('Cancelled'); loadMine(); }
    } catch (err) { toast(err.message); }
  };
}

// ---------------------------------------------------------------- join

const ticketKey = (mid) => `meet:ticket:${mid}`;
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

async function joinPage(token) {
  const qs = new URLSearchParams(location.search);
  if (qs.get('hk')) return hostLinkPage(token, qs.get('hk'));
  // A ticket from earlier in this tab (a reload) keeps your place.
  let m = await callTool('meet.get', { meeting: token });
  const saved = store.get(ticketKey(m.id));
  if (saved) { setTicket(saved); m = await callTool('meet.get', { meeting: token }); }
  if (m.status === 'ended') return endedPage('This meeting has ended.');
  if (m.you?.status === 'removed') return endedPage('The host removed you from this meeting.');

  const hostKey = qs.get('host');
  const name = m.you?.display_name ?? state.who.user?.name ?? store.get('meet:name') ?? '';
  const prefs = { audio: store.get('meet:audio') !== '0', video: store.get('meet:video') !== '0' };
  // Webinar viewers are not asked for the camera and microphone until the host lets them speak.
  const viewer = m.kind === 'webinar' && !hostKey && !m.you_host && !['speaker', 'cohost', 'host'].includes(m.you?.role);
  app.innerHTML = `${topBar()}
  <main class="meet-pre ${viewer ? 'is-viewer' : ''}">
    ${viewer ? `<div class="meet-pre-v"><div class="ui-tile meet-preview is-cam-off"><span class="ui-avatar">${icon('people', 28)}</span></div><p class="ui-hint meet-perm">You join as a viewer. If the host lets you speak, your browser will ask for your microphone and camera then.</p></div>` : `<div class="meet-pre-v">
      <div class="ui-tile meet-preview ${prefs.video ? '' : 'is-cam-off'}" id="preview"><video autoplay playsinline muted></video><span class="ui-avatar">${esc(initials(name || '?'))}</span><span class="ui-tile-n">${esc(name || 'You')}</span></div>
      <div class="ui-callbar">
        <button data-tool="none" data-why="chooses whether you join with the microphone on; nothing is sent before you join" id="pmic" aria-pressed="${prefs.audio}" aria-label="Microphone">${icon(prefs.audio ? 'mic' : 'mic-off')}</button>
        <button data-tool="none" data-why="chooses whether you join with the camera on; nothing is sent before you join" id="pcam" aria-pressed="${prefs.video}" aria-label="Camera">${icon(prefs.video ? 'cam' : 'cam-off')}</button>
      </div>
      <p class="ui-hint meet-perm" id="perm"></p>
    </div>`}
    <form class="meet-pre-f" data-tool="meet.join" id="jf">
      <p class="ui-label">${m.kind === 'webinar' ? 'Webinar' : 'Meeting'}</p>
      <h1 class="meet-h">${esc(m.title)}</h1>
      <p class="ui-mute">${m.status === 'live' ? 'Happening now.' : m.starts_at ? `Starts ${esc(fmtWhen(m.starts_at))}.` : ''} ${m.waiting_room && !hostKey && !m.you_host ? 'The host lets people in.' : ''}</p>
      <label class="ui-field"><span class="ui-label">Your name</span><input class="ui-input" name="name" value="${esc(name)}" required maxlength="60" autocomplete="name" placeholder="Your name"></label>
      <button class="ui-btn is-accent is-lg is-block" type="submit">${hostKey || m.you_host ? 'Start the meeting' : 'Join'}</button>
      ${!state.who.user && state.who.signin_available ? `<p class="ui-hint">Have an account? <a href="/auth/github?next=${encodeURIComponent(location.pathname + location.search)}">Sign in with GitHub</a>.</p>` : ''}
    </form>
  </main>`;
  app.removeAttribute('aria-busy');

  // Camera and microphone: the browser asks the person. Only they can answer (ROADMAP 3.3).
  const local = { stream: null, mic: null, cam: null };
  const video = app.querySelector('#preview video');
  const perm = document.getElementById('perm');
  async function getMedia() {
    if (viewer) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } } });
      local.mic = s.getAudioTracks()[0] ?? null;
      local.cam = s.getVideoTracks()[0] ?? null;
      perm.textContent = '';
    } catch (e) {
      // Try audio alone (no camera, or the camera is busy).
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); local.mic = s.getAudioTracks()[0]; } catch {}
      perm.textContent = e.name === 'NotAllowedError' ? 'The browser blocked the camera or microphone. Allow them with the icon in the address bar, then reload. You can still join and listen.' : 'No camera found. You can still join.';
    }
    if (local.mic) local.mic.enabled = prefs.audio;
    if (local.cam && !prefs.video) { local.cam.stop(); local.cam = null; }
    video.srcObject = local.cam ? new MediaStream([local.cam]) : null;
  }
  const mediaReady = getMedia();
  const pmic = document.getElementById('pmic');
  const pcam = document.getElementById('pcam');
  if (pmic) pmic.onclick = () => { prefs.audio = !prefs.audio; if (local.mic) local.mic.enabled = prefs.audio; pmic.setAttribute('aria-pressed', prefs.audio); pmic.innerHTML = icon(prefs.audio ? 'mic' : 'mic-off'); store.set('meet:audio', prefs.audio ? '1' : '0'); };
  if (pcam) pcam.onclick = async () => {
    prefs.video = !prefs.video;
    pcam.setAttribute('aria-pressed', prefs.video); pcam.innerHTML = icon(prefs.video ? 'cam' : 'cam-off'); store.set('meet:video', prefs.video ? '1' : '0');
    document.getElementById('preview').classList.toggle('is-cam-off', !prefs.video);
    if (!prefs.video && local.cam) { local.cam.stop(); local.cam = null; video.srcObject = null; }
    if (prefs.video && !local.cam) { try { const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } }); local.cam = s.getVideoTracks()[0]; video.srcObject = new MediaStream([local.cam]); } catch { perm.textContent = 'The camera is blocked or busy.'; } }
  };

  document.getElementById('jf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type=submit]');
    btn.disabled = true;
    const nm = new FormData(e.currentTarget).get('name').toString().trim();
    store.set('meet:name', nm);
    try {
      let r = await callTool('meet.join', { meeting: m.id, name: nm, ...(hostKey ? { host_key: hostKey } : {}) });
      setTicket(r.ticket);
      store.set(ticketKey(m.id), r.ticket);
      if (hostKey) history.replaceState({}, '', location.pathname); // the host key is spent; keep it out of the address bar
      if (r.participant.status === 'waiting') r = await waitingRoom(m, r);
      if (!r) return;
      await mediaReady;
      const { Call } = await import('./call.mjs');
      const call = new Call({ root: app, meeting: r.meeting, participant: r.participant, media: r.media, local, prefs, onExit: (why) => { store.del(ticketKey(m.id)); endedPage(why); } });
      window.meetCall = call;
      await call.start();
    } catch (err) {
      btn.disabled = false;
      if (err instanceof ToolFailed && err.code === 'ended') return endedPage(err.message);
      toast(err.message);
    }
  });
}

// Waiting room: ask again every two seconds with the same ticket until the host answers.
async function waitingRoom(m, r) {
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow meet-waiting">
    <span class="meet-pulse" aria-hidden="true"></span>
    <h1 class="meet-h">Waiting for the host</h1>
    <p class="ui-mute">${esc(m.title)}. The host will let you in soon. Keep this page open.</p>
    <button class="ui-btn is-quiet" data-tool="meet.leave" id="wleave">Leave</button>
  </div></main>`;
  let gone = false;
  document.getElementById('wleave').onclick = async () => { gone = true; await callTool('meet.leave', { meeting: m.id }).catch(() => {}); store.del(ticketKey(m.id)); location.href = '/'; };
  for (;;) {
    await new Promise((res) => setTimeout(res, 2000));
    if (gone) return null;
    try {
      r = await callTool('meet.join', { meeting: m.id });
      if (r.participant.status === 'admitted') return r;
      if (r.participant.status === 'denied') { endedPage('The host did not let you in.'); return null; }
    } catch (err) {
      if (['removed', 'ended', 'locked'].includes(err.code)) { endedPage(err.message); return null; }
    }
  }
}

function endedPage(message) {
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow"><h1 class="meet-h">${esc(message || 'You left the meeting.')}</h1><p class="meet-actions"><a class="ui-btn is-quiet" href="/">Back to start</a>${location.pathname.startsWith('/m/') && !/ended|removed|did not/.test(message ?? '') ? `<a class="ui-btn" href="${esc(location.pathname)}">Rejoin</a>` : ''}</p></div></main>`;
  app.removeAttribute('aria-busy');
}

// A "Help carry this call" link opened in a browser: say what to run instead.
function hostLinkPage(token, hk) {
  const cmd = `npx -y github:warOnSaaS/meet host "${location.origin}/m/${token}?hk=${hk}"`;
  app.innerHTML = `${topBar()}<main class="meet-center"><div class="ui-card meet-narrow">
    <h1 class="meet-h">Help carry this call</h1>
    <p class="ui-mute">This link is for a computer that forwards the call for others. Run this in a terminal on a computer that is plugged in and has a good connection (Node 22 or newer), or open it in the wOS desktop app.</p>
    <pre class="meet-cmd"><code>${esc(cmd)}</code></pre>
    <p class="meet-actions"><button class="ui-btn is-quiet" data-tool="none" data-why="copies the command shown on screen" id="copycmd">Copy command</button><a class="ui-btn is-ghost" href="/m/${esc(token)}">Join the call instead</a></p>
  </div></main>`;
  app.removeAttribute('aria-busy');
  document.getElementById('copycmd').onclick = async () => { await copyText(cmd); toast('Copied'); };
}
