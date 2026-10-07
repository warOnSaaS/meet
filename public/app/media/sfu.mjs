// Calls carried by participant hosts. This browser sends its streams to one host (its primary) and keeps a
// warm connection to a second (its standby): a paused microphone stream and a paused loopback keep that
// connection's network path and encryption handshake done, so if the primary host drops, switching is a few
// requests, not a fresh connection.
//
// Everything sent is encrypted end to end (e2ee.mjs) before it leaves the browser, so hosts forward frames
// they cannot read. Only streams this screen shows are requested: visible tiles at the small layer, the
// large tile and shared screens at the top layer, and audio from everyone (or the recent speakers in a big call).
import { Device } from '../../vendor/mediasoup-client.js';
import { E2ee, needsInsertableFlag } from './e2ee.mjs';

const CAM_ENCODINGS = [
  { rid: 'l', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
  { rid: 'm', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { rid: 'h', scaleResolutionDownBy: 1, maxBitrate: 1_200_000 },
];
const AUDIO_ALL_UP_TO = 12;

export class SfuEngine {
  constructor({ signal, me, local, ice, e2eeKey, canPublish = true, onTrack, onTrackGone, onPeerState, onEvent }) {
    Object.assign(this, { signal, me, local, ice, canPublish, onTrack, onTrackGone, onPeerState, onEvent });
    this.kind = 'hosts';
    this.e2ee = new E2ee(e2eeKey);
    this.conns = new Map(); // host -> conn
    this.dir = new Map(); // host -> producers
    this.dead = new Set();
    this.view = { visible: new Set(), big: null };
    this.speakers = new Map(); // owner -> last time heard
    this.queue = Promise.resolve();
    this.offs = [
      this.listen('dir', (d, m) => { this.dir.set(m.from, d.producers); this.reconcile(); }),
      this.listen('levels', (d) => { const t = Date.now(); for (const x of d.top ?? []) this.speakers.set(x.owner, t); this.onEvent?.('levels', d.top); this.reconcile(); }),
      this.listen('ms', (d, m) => this.onHostEvent(m.from, d)),
      this.listen('peer-left', (d) => { if (this.conns.has(d.peer)) this.hostLost(d.peer, 'left'); this.dir.delete(d.peer); this.reconcile(); }),
    ];
    this.watchT = setInterval(() => this.watch(), 1000);
  }

  listen(type, fn) {
    this.signal.on(type, fn);
    return () => { const l = this.signal.handlers.get(type); if (l) l.splice(l.indexOf(fn), 1); };
  }

  serial(fn) { const p = this.queue.then(fn, fn); this.queue = p.catch((e) => console.warn('[meet]', e.message)); return p; }

  get primary() { for (const c of this.conns.values()) if (c.role === 'primary') return c; return null; }
  get standby() { for (const c of this.conns.values()) if (c.role === 'standby') return c; return null; }

  update(plan) {
    this.plan = plan;
    return this.serial(async () => {
      const a = plan.assign?.[this.me];
      if (!a) return;
      const want = { primary: this.dead.has(a.primary) ? a.standby : a.primary, standby: this.dead.has(a.standby) ? null : a.standby };
      if (want.primary === want.standby) want.standby = null;
      const cur = this.primary;
      if (!cur || cur.host !== want.primary) {
        const sb = this.conns.get(want.primary);
        if (sb?.role === 'standby' && sb.ok) await this.promote(sb);
        else await this.makePrimary(want.primary);
        if (cur && cur.host !== want.primary) this.closeConn(cur);
      }
      const s = this.standby;
      if (s && s.host !== want.standby) this.closeConn(s);
      if (want.standby && !this.conns.has(want.standby)) this.makeStandby(want.standby).catch((e) => console.warn('[meet] standby', e.message));
      // Hosts no longer in the plan.
      for (const c of this.conns.values()) if (c.host !== want.primary && c.host !== want.standby) this.closeConn(c);
      await this.reconcileNow();
    });
  }

  // ---------- connections ----------

  async connect(host, role) {
    const c = { host, role, consumers: new Map(), producers: {}, ok: false, rr: { n: -1, at: Date.now() }, badSince: null };
    this.conns.set(host, c);
    const { rtpCapabilities } = await this.signal.request(host, 'caps');
    c.device = new Device();
    await c.device.load({ routerRtpCapabilities: rtpCapabilities });
    const extra = needsInsertableFlag() ? { encodedInsertableStreams: true } : undefined;
    const mk = async (dir) => {
      const info = await this.signal.request(host, 'transport', { dir });
      const opts = { ...info, iceServers: this.ice, additionalSettings: extra };
      const t = dir === 'send' ? c.device.createSendTransport(opts) : c.device.createRecvTransport(opts);
      t.on('connect', ({ dtlsParameters }, ok, bad) => this.signal.request(host, 'connect', { id: t.id, dtlsParameters }).then(ok, bad));
      t.on('connectionstatechange', (s) => { c.state = s; if (s === 'connected') c.ok = true; if (['failed', 'disconnected', 'closed'].includes(s)) c.badSince ??= Date.now(); else c.badSince = null; });
      if (dir === 'send') t.on('produce', ({ kind, rtpParameters, appData }, ok, bad) => this.signal.request(host, 'produce', { transportId: t.id, kind, rtpParameters, source: appData.source, standby: appData.standby }).then(ok, bad));
      return t;
    };
    if (this.canPublish) c.send = await mk('send');
    c.recv = await mk('recv');
    return c;
  }

  async makePrimary(host) {
    const c = await this.connect(host, 'primary');
    this.onEvent?.('primary', host);
    if (this.canPublish) for (const s of ['mic', 'cam', 'screen']) if (this.local[s]) await this.produce(c, s, this.local[s]);
    c.ok = true;
  }

  // Warm standby: connected and encrypted, carrying nothing anyone hears.
  async makeStandby(host) {
    const c = await this.connect(host, 'standby');
    if (this.canPublish && this.local.mic) {
      const p = await this.produce(c, 'mic', this.local.mic, true);
      p.pause();
      await this.signal.request(host, 'pause_producer', { id: p.id }).catch(() => {});
      // A paused loopback of that stream warms the receiving side too.
      const params = await this.signal.request(host, 'consume', { transportId: c.recv.id, producerId: p.id, rtpCapabilities: c.device.rtpCapabilities, spatial: 0 });
      c.loop = await c.recv.consume(params);
      this.e2ee.attach(c.loop.rtpReceiver, 'audio', 'decrypt');
    }
    c.ok = true;
  }

  async promote(c) {
    c.role = 'primary';
    this.onEvent?.('primary', c.host);
    await this.signal.request(c.host, 'activate', {});
    if (c.loop) { c.loop.close(); this.signal.request(c.host, 'close_consumer', { id: c.loop.id }).catch(() => {}); c.loop = null; }
    if (c.producers.mic) { c.producers.mic.resume(); await this.signal.request(c.host, 'resume_producer', { id: c.producers.mic.id }); }
    if (this.canPublish) for (const s of ['mic', 'cam', 'screen']) if (this.local[s] && !c.producers[s]) await this.produce(c, s, this.local[s]);
  }

  async produce(c, source, track, standby = false) {
    const opts = { track, appData: { source, standby } };
    if (source === 'cam') { opts.encodings = CAM_ENCODINGS; opts.codecOptions = { videoGoogleStartBitrate: 800 }; }
    if (source === 'screen') opts.encodings = [{ maxBitrate: 2_000_000 }];
    if (source === 'mic') opts.codecOptions = { opusDtx: true, opusFec: true };
    const p = await c.send.produce(opts);
    this.e2ee.attach(p.rtpSender, track.kind, 'encrypt');
    c.producers[source] = p;
    return p;
  }

  closeConn(c) {
    if (!this.dead.has(c.host)) this.signal.request(c.host, 'bye', {}).catch(() => {});
    for (const [pid, x] of c.consumers) this.onTrackGone?.({ peer: x.owner, source: x.source, producerId: pid });
    try { c.send?.close(); } catch {}
    try { c.recv?.close(); } catch {}
    this.conns.delete(c.host);
  }

  // ---------- local tracks ----------

  setTrack(source, track) {
    this.local[source] = track;
    return this.serial(async () => {
      for (const c of this.conns.values()) {
        const p = c.producers[source];
        if (c.role === 'standby' && source !== 'mic') continue;
        if (track && p && !p.closed) { await p.replaceTrack({ track }); continue; }
        if (!track && p) { p.close(); delete c.producers[source]; this.signal.request(c.host, 'close_producer', { id: p.id }).catch(() => {}); continue; }
        if (track && c.send && this.canPublish) await this.produce(c, source, track, c.role === 'standby');
      }
    });
  }

  setCanPublish(on) {
    if (on === this.canPublish) return;
    this.canPublish = on;
    if (this.plan) { for (const c of [...this.conns.values()]) this.closeConn(c); this.update(this.plan); }
  }

  // ---------- what to receive ----------

  setView({ visible, big }) {
    this.view = { visible: new Set(visible), big };
    this.reconcile();
  }

  reconcile() { clearTimeout(this.recT); this.recT = setTimeout(() => this.serial(() => this.reconcileNow()), 40); }

  desired() {
    const all = [...this.dir.entries()].flatMap(([host, list]) => (this.dead.has(host) ? [] : list.map((p) => ({ ...p, host })))).filter((p) => p.owner !== this.me);
    const audios = all.filter((p) => p.kind === 'audio');
    const recent = [...this.speakers.entries()].filter(([, t]) => Date.now() - t < 15000).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([o]) => o);
    const out = new Map();
    for (const p of all) {
      if (p.kind === 'audio') { if (audios.length <= AUDIO_ALL_UP_TO || recent.includes(p.owner)) out.set(p.id, { ...p, spatial: 0 }); }
      else if (p.source === 'screen') out.set(p.id, { ...p, spatial: 2 });
      else if (this.view.visible.has(p.owner) || this.view.big === p.owner) out.set(p.id, { ...p, spatial: this.view.big === p.owner ? 2 : 0 });
    }
    return out;
  }

  async reconcileNow() {
    const c = this.primary;
    if (!c?.recv) return;
    const want = this.desired();
    for (const [pid, x] of c.consumers) {
      if (!want.has(pid)) {
        c.consumers.delete(pid);
        x.consumer.close();
        this.signal.request(c.host, 'close_consumer', { id: x.consumer.id }).catch(() => {});
        this.onTrackGone?.({ peer: x.owner, source: x.source, producerId: pid });
      } else if (want.get(pid).spatial !== x.spatial && x.kind === 'video') {
        x.spatial = want.get(pid).spatial;
        this.signal.request(c.host, 'layers', { id: x.consumer.id, spatial: x.spatial }).catch(() => {});
      }
    }
    const adds = [...want.values()].filter((p) => !c.consumers.has(p.id));
    await Promise.all(adds.map((p) => this.consume(c, p).catch((e) => console.warn('[meet] consume', p.source, e.message))));
  }

  async consume(c, p) {
    const params = await this.signal.request(c.host, 'consume', { transportId: c.recv.id, producerId: p.id, rtpCapabilities: c.device.rtpCapabilities, spatial: p.spatial });
    if (!this.conns.has(c.host) || c.role !== 'primary') return;
    const consumer = await c.recv.consume({ id: params.id, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters });
    this.e2ee.attach(consumer.rtpReceiver, consumer.kind, 'decrypt');
    c.consumers.set(p.id, { consumer, owner: p.owner, source: p.source, kind: p.kind, spatial: p.spatial });
    await this.signal.request(c.host, 'resume_consumer', { id: consumer.id });
    this.onTrack?.({ peer: p.owner, source: p.source, track: consumer.track, receiver: consumer.rtpReceiver, producerId: p.id });
  }

  onHostEvent(host, d) {
    const c = this.conns.get(host);
    if (d.ev === 'consumer_closed' && c) {
      const x = c.consumers.get(d.producerId);
      if (x) { c.consumers.delete(d.producerId); x.consumer.close(); this.onTrackGone?.({ peer: x.owner, source: x.source, producerId: d.producerId }); }
    }
  }

  // ---------- noticing a host has gone ----------

  // The primary host answers our microphone stream with RTCP reports about once a second. If those stop for
  // 3 s, or the connection says it failed, the host is gone: switch to the standby now and tell the server.
  async watch() {
    const c = this.primary;
    if (!c?.send || this.switching) return;
    let stalled = false;
    try {
      const stats = await c.send.getStats();
      let n = null;
      stats.forEach((s) => { if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') n = (s.roundTripTimeMeasurements ?? 0) + (s.packetsLost ?? 0) * 0; });
      if (n != null) {
        if (n !== c.rr.n) c.rr = { n, at: Date.now() };
        else if (Date.now() - c.rr.at > 3000 && this.local.mic) stalled = true;
      }
    } catch {}
    const broken = c.badSince && Date.now() - c.badSince > 1000;
    if (stalled || broken) this.hostLost(c.host, stalled ? 'silent' : 'connection failed');
  }

  hostLost(host, why) {
    if (this.dead.has(host)) return;
    this.dead.add(host);
    setTimeout(() => this.dead.delete(host), 60000);
    this.onEvent?.('host-lost', { host, why });
    this.signal.post('/media/report', { dead: host }).catch(() => {});
    const c = this.conns.get(host);
    if (!c) return;
    const wasPrimary = c.role === 'primary';
    this.closeConn(c);
    this.dir.delete(host);
    if (!wasPrimary) return;
    const t0 = performance.now();
    this.switching = true;
    this.serial(async () => {
      const s = this.standby;
      if (s?.ok) await this.promote(s);
      await this.reconcileNow();
      this.onEvent?.('failover', { from: host, to: s?.host ?? null, ms: Math.round(performance.now() - t0) });
    }).finally(() => { this.switching = false; });
  }

  async stats() {
    const out = { conns: [], e2ee: await this.e2ee.stats() };
    for (const c of this.conns.values()) out.conns.push({ host: c.host, role: c.role, state: c.state, consumers: c.consumers.size, producers: Object.keys(c.producers) });
    return out;
  }

  async stop() {
    clearInterval(this.watchT);
    for (const off of this.offs) off();
    for (const c of [...this.conns.values()]) this.closeConn(c);
    this.e2ee.close();
  }
}
