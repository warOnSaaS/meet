// A participant host: this computer forwards the call's media for others, without re-encoding it.
// Run it with `npx github:warOnSaaS/meet host "<link>"` (the link comes from "Help carry this call"), or the
// wOS desktop app runs it in the background (docs/DESKTOP-HOST.md).
//
// It is a mediasoup router (ISC licence). Browsers connect to it over WebRTC. Several hosts link to each other
// over encrypted RTP (SRTP plain transports) and forward only the streams someone on the other side is
// watching, at the layer they watch it, so traffic between hosts stays flat as calls grow. Media is also
// encrypted end to end by the browsers, so this computer cannot see or hear the call it carries.
import os from 'node:os';
import dgram from 'node:dgram';
import { Signal } from '../public/app/signal.mjs';
import { cpuInfo, pluggedIn, measureUpload, Steadiness, lanAddress } from './measure.mjs';
import { stunBinding } from '../server/doctor.mjs';

export const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 800 } },
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export async function runHost(link, flags = {}) {
  const h = new Host(link, flags);
  await h.start();
  const stop = async () => { await h.stop('leaving'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return h;
}

export class Host {
  constructor(link, flags) {
    const u = new URL(link);
    this.base = flags.base ?? u.origin;
    this.hk = u.searchParams.get('hk');
    if (!this.hk) throw new Error('This link has no host key. Use the link from "Help carry this call".');
    this.flags = flags;
    this.name = flags.name ?? `${os.userInfo().username}'s computer`;
    this.clients = new Map(); // browser peer -> { transports: Map, producers: Set, consumers: Map }
    this.origin = new Map(); // producer id -> { producer, owner, source, kind, standby }
    this.remote = new Map(); // origin producer id -> { producer, via, spatial }
    this.links = new Map(); // other host peer -> { transport, ready, out: Map(originId -> consumer) }
    this.dirs = new Map(); // host peer -> [{ id, owner, source, kind }]
    this.uses = new Map(); // local producer id -> count of consumers using it
    this.idle = new Map(); // origin id -> time it became unused
    this.hostRtt = {};
    this.steady = new Steadiness();
    this.started = Date.now();
    this.warmupMs = Number(flags.warmup ?? 60) * 1000;
    this.plan = null;
  }

  async start() {
    const mediasoup = await import('mediasoup').catch(() => null);
    if (!mediasoup) throw new Error('mediasoup is not installed here. Run with Node 22 or newer: npx github:warOnSaaS/meet host "<link>"');
    this.worker = await mediasoup.createWorker({ logLevel: 'warn' });
    this.worker.on('died', () => { log('media worker stopped unexpectedly'); process.exit(1); });
    this.router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });

    const lan = this.flags.announce ?? (this.flags.local ? '127.0.0.1' : lanAddress());
    let pub = null;
    if (!this.flags.announce && !this.flags.local) {
      const s = await stunBinding('stun:stun.l.google.com:19302');
      if (s.ok && s.ip !== lan) pub = s.ip;
    }
    this.addr = lan;
    const port = Number(this.flags.port ?? 0) || 40000 + Math.floor(Math.random() * 20000);
    const listenInfos = [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: lan, port },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: lan, port },
    ];
    if (pub) listenInfos.push({ protocol: 'udp', ip: '0.0.0.0', announcedAddress: pub, port: port + 1 });
    this.webRtcServer = await this.worker.createWebRtcServer({ listenInfos });
    this.publicAddr = pub;

    // Echo socket: other hosts ping it to measure the round trip between host computers.
    this.echo = dgram.createSocket('udp4');
    this.echo.on('message', (msg, r) => {
      const s = msg.toString();
      if (s.startsWith('p:')) this.echo.send(`r:${s.slice(2)}`, r.port, r.address);
      else if (s.startsWith('r:')) {
        const [peer, t] = s.slice(2).split('|');
        this.hostRtt[peer] = Math.round(performance.now() - Number(t));
      }
    });
    await new Promise((res) => this.echo.bind(0, '0.0.0.0', res));

    this.levels = await this.router.createAudioLevelObserver({ maxEntries: 3, threshold: -70, interval: 400 });
    this.levels.on('volumes', (v) => this.sendLevels(v.map((x) => ({ id: x.producer.appData.originId ?? x.producer.id, owner: x.producer.appData.owner, volume: x.volume }))));
    this.levels.on('silence', () => this.sendLevels([]));

    const j = await fetch(`${this.base}/media/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host_token: this.hk, client: this.flags.desktop ? 'desktop' : 'cli', metrics: await this.metrics() }) }).then((r) => r.json());
    if (!j.ok) throw new Error(j.error?.message ?? 'Could not join the call as a host.');
    this.peer = j.peer;
    this.signal = new Signal({ base: this.base, token: j.token, cursor: j.cursor, ws: j.ws && !this.flags.poll, onGone: () => { log('the meeting server let this host go'); this.stop('gone').then(() => process.exit(0)); } });
    this.signal.serve((m, d, from) => this.rpc(m, d, from));
    this.signal.on('plan', (p) => this.applyPlan(p));
    this.signal.on('dir', (d, m) => { this.dirs.set(m.from, d.producers); this.gcRemote(); });
    this.signal.on('peer-left', (d) => this.peerLeft(d.peer));
    this.signal.on('ended', () => { log('the meeting ended'); this.stop('ended').then(() => process.exit(0)); });
    this.signal.start();
    if (j.plan) this.applyPlan(j.plan);
    log(`carrying "${this.base}" as ${this.name}: media on ${lan}:${port}${pub ? ` and ${pub}:${port + 1}` : ''}`);

    this.timers = [
      setInterval(() => this.tick().catch((e) => log('tick', e.message)), 2000),
      setInterval(() => this.publishDir(), 10000),
      setInterval(() => this.gcRemote(), 3000),
    ];
    this.tick().catch(() => {});
    return this;
  }

  // ---------- measurements ----------

  async metrics() {
    const cpu = cpuInfo();
    if (this.upload == null) this.upload = this.flags['upload-mbps'] ? Number(this.flags['upload-mbps']) : null;
    const warm = Date.now() - this.started >= this.warmupMs && this.steady.samples.length >= 3 && this.upload != null;
    return {
      name: this.name, uploadMbps: this.upload, cpuCores: cpu.cores, cpuLoad: cpu.load,
      plugged: this.flags['assume-plugged'] ? true : await pluggedIn(), jitterMs: this.steady.jitterMs, rttMs: this.steady.rttMs, warm,
      rtt: { ...this.hostRtt }, echo: { ip: this.addr, port: this.echo?.address().port },
      load: this.load ?? null, version: 1,
    };
  }

  async tick() {
    const t = performance.now();
    await fetch(`${this.base}/healthz`).then((r) => r.arrayBuffer()).catch(() => {});
    this.steady.add(performance.now() - t);
    if (this.upload == null && this.signal && !this.measuring) {
      this.measuring = true;
      this.upload = await measureUpload(this.base, this.signal.token).catch(() => null);
      if (this.upload == null) this.upload = 0;
      log(`measured upload: ${this.upload} Mbit/s`);
    }
    // Ping the other hosts.
    for (const [peer, info] of Object.entries(this.peerEchoes())) this.echo.send(`p:${this.peer}|${performance.now()}`, info.port, info.ip);
    this.load = await this.measureLoad();
    if (this.signal) await this.signal.post('/media/metrics', await this.metrics()).catch(() => {});
  }

  peerEchoes() {
    const out = {};
    for (const h of this.plan?.hostEchoes ?? []) if (h.peer !== this.peer) out[h.peer] = h.echo;
    return out;
  }

  async measureLoad() {
    let sendBps = 0, recvBps = 0, consumers = 0, transports = 0;
    for (const c of this.clients.values()) {
      for (const t of c.transports.values()) {
        transports++;
        const [s] = await t.getStats().catch(() => [{}]);
        sendBps += s?.sendBitrate ?? 0;
        recvBps += s?.recvBitrate ?? 0;
      }
      consumers += c.consumers.size;
    }
    for (const l of this.links.values()) {
      const [s] = await l.transport?.getStats().catch(() => [{}]) ?? [{}];
      sendBps += s?.sendBitrate ?? 0;
      recvBps += s?.recvBitrate ?? 0;
    }
    return { sendMbps: Math.round(sendBps / 1e4) / 100, recvMbps: Math.round(recvBps / 1e4) / 100, consumers, transports, clients: this.clients.size, links: this.links.size, piped: this.remote.size };
  }

  // ---------- the plan: which hosts link to which ----------

  applyPlan(plan) {
    const newPeers = Object.keys(plan.peers ?? {}).some((p) => !this.plan?.peers?.[p]);
    this.plan = plan;
    if (newPeers) this.publishDir();
    const mine = new Set((plan.links ?? []).filter((l) => l.includes(this.peer)).map((l) => (l[0] === this.peer ? l[1] : l[0])));
    for (const [peer, l] of this.links) if (!mine.has(peer)) this.closeLink(peer, l);
    for (const peer of mine) if (!this.links.has(peer) && this.peer < peer) this.openLink(peer).catch((e) => log(`link to ${peer} failed: ${e.message}`));
  }

  async newPlainTransport() {
    return this.router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedAddress: this.addr }, rtcpMux: true, comedia: false, enableSrtp: true, srtpCryptoSuite: 'AES_CM_128_HMAC_SHA1_80' });
  }

  openLink(peer) {
    const l = { out: new Map() };
    l.ready = (async () => {
      l.transport = await this.newPlainTransport();
      const r = await this.signal.request(peer, 'link_open', { ip: this.addr, port: l.transport.tuple.localPort, srtp: l.transport.srtpParameters });
      await l.transport.connect({ ip: r.ip, port: r.port, srtpParameters: r.srtp });
      log(`linked with host ${peer}`);
      return l;
    })();
    this.links.set(peer, l);
    l.ready.catch(() => this.links.delete(peer));
    return l.ready;
  }

  closeLink(peer, l) {
    try { l.transport?.close(); } catch {}
    this.links.delete(peer);
    for (const [id, r] of this.remote) if (r.via === peer) { r.producer.close(); this.remote.delete(id); }
  }

  nextHop(originHost) {
    if (this.links.has(originHost)) return originHost;
    if (this.plan?.topology === 'star' && this.plan.root && this.plan.root !== this.peer && this.links.has(this.plan.root)) return this.plan.root;
    return null;
  }

  originHostOf(id) {
    if (this.origin.has(id)) return this.peer;
    for (const [h, list] of this.dirs) if (list.some((p) => p.id === id)) return h;
    return null;
  }

  // A local producer for an origin producer id: the browser's own, or one piped in from another host.
  async localProducer(originId, spatial = 0) {
    const o = this.origin.get(originId);
    if (o) return o.producer;
    const r = this.remote.get(originId);
    if (r) { if (r.ready) await r.ready; if (spatial > r.spatial) await this.wantLayer(originId, spatial); return this.remote.get(originId)?.producer; }
    const oh = this.originHostOf(originId);
    if (!oh) throw Object.assign(new Error('That stream is not in this call any more.'), { code: 'no_producer' });
    const via = this.nextHop(oh);
    if (!via) throw Object.assign(new Error('Not linked to the host that has that stream yet.'), { code: 'no_route' });
    const entry = { via, spatial };
    entry.ready = (async () => {
      const l = await this.links.get(via).ready;
      const res = await this.signal.request(via, 'pull', { producerId: originId, spatial });
      entry.producer = await l.transport.produce({ kind: res.kind, rtpParameters: res.rtpParameters, appData: { originId, owner: res.owner, source: res.source } });
      if (res.kind === 'audio') this.levels.addProducer({ producerId: entry.producer.id }).catch(() => {});
      delete entry.ready;
      return entry.producer;
    })();
    this.remote.set(originId, entry);
    try { return await entry.ready; } catch (e) { this.remote.delete(originId); throw e; }
  }

  async wantLayer(originId, spatial) {
    const r = this.remote.get(originId);
    if (!r || spatial <= r.spatial) return;
    r.spatial = spatial;
    await this.signal.request(r.via, 'pull_layers', { producerId: originId, spatial }).catch(() => {});
  }

  use(producerId, d) {
    const n = (this.uses.get(producerId) ?? 0) + d;
    if (n <= 0) this.uses.delete(producerId); else this.uses.set(producerId, n);
  }

  // Close piped streams nobody here watches any more (after 10 s, so flipping pages does not churn).
  gcRemote() {
    const nowT = Date.now();
    for (const [originId, r] of this.remote) {
      if (r.ready) continue;
      const gone = !this.originHostOf(originId);
      const used = (this.uses.get(r.producer.id) ?? 0) > 0;
      if (used && !gone) { this.idle.delete(originId); continue; }
      if (!this.idle.has(originId)) this.idle.set(originId, nowT);
      if (gone || nowT - this.idle.get(originId) > 10000) {
        r.producer.close();
        this.remote.delete(originId);
        this.idle.delete(originId);
        this.signal.request(r.via, 'unpull', { producerId: originId }).catch(() => {});
      }
    }
  }

  // ---------- directory and speaking levels ----------

  ownDir() {
    return [...this.origin.entries()].filter(([, o]) => !o.standby).map(([id, o]) => ({ id, owner: o.owner, source: o.source, kind: o.kind, paused: o.producer.paused }));
  }

  publishDir() {
    clearTimeout(this.dirT);
    this.dirT = setTimeout(() => {
      const producers = this.ownDir();
      this.dirs.set(this.peer, producers);
      this.signal?.send('*', 'dir', { producers });
    }, 30);
  }

  sendLevels(top) {
    const key = top.map((t) => t.owner).join(',');
    if (key === this.lastLevels && Date.now() - (this.lastLevelsAt ?? 0) < 3000) return;
    this.lastLevels = key;
    this.lastLevelsAt = Date.now();
    this.signal?.send('*', 'levels', { top });
  }

  // ---------- requests from browsers and other hosts ----------

  client(peer) {
    let c = this.clients.get(peer);
    if (!c) { c = { transports: new Map(), producers: new Set(), consumers: new Map() }; this.clients.set(peer, c); }
    return c;
  }

  async rpc(method, d, from) {
    switch (method) {
      case 'caps': {
        // Everything this host knows is in the call, so a browser that just arrived can ask for it now.
        const dirs = Object.fromEntries([...this.dirs.entries()].filter(([h]) => h !== this.peer));
        dirs[this.peer] = this.ownDir();
        return { rtpCapabilities: this.router.rtpCapabilities, name: this.name, dirs };
      }
      case 'transport': {
        const t = await this.router.createWebRtcTransport({ webRtcServer: this.webRtcServer, enableUdp: true, enableTcp: true, preferUdp: true, initialAvailableOutgoingBitrate: 1_000_000, appData: { owner: from, dir: d.dir } });
        this.client(from).transports.set(t.id, t);
        if (d.dir === 'recv') await t.setMaxIncomingBitrate(3_000_000).catch(() => {});
        return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
      }
      case 'connect': await this.transportOf(from, d.id).connect({ dtlsParameters: d.dtlsParameters }); return {};
      case 'restart_ice': return { iceParameters: await this.transportOf(from, d.id).restartIce() };
      case 'produce': {
        const role = this.plan?.peers?.[from]?.role;
        if (this.plan?.webinar && role === 'viewer') throw Object.assign(new Error('Viewers cannot speak until the host makes them a speaker.'), { code: 'viewer' });
        const p = await this.transportOf(from, d.transportId).produce({ kind: d.kind, rtpParameters: d.rtpParameters, appData: { owner: from, source: d.source } });
        this.client(from).producers.add(p.id);
        this.origin.set(p.id, { producer: p, owner: from, source: d.source, kind: d.kind, standby: !!d.standby });
        if (d.kind === 'audio') this.levels.addProducer({ producerId: p.id }).catch(() => {});
        p.on('transportclose', () => this.dropOrigin(p.id));
        if (!d.standby) this.publishDir();
        return { id: p.id };
      }
      case 'activate': {
        // The browser moved here from a host that left: its standby streams become its real ones.
        for (const id of this.client(from).producers) { const o = this.origin.get(id); if (o) o.standby = false; }
        this.publishDir();
        return {};
      }
      case 'pause_producer': { const o = this.ownProducer(from, d.id); await o.producer.pause(); this.publishDir(); return {}; }
      case 'resume_producer': { const o = this.ownProducer(from, d.id); await o.producer.resume(); this.publishDir(); return {}; }
      case 'close_producer': { this.ownProducer(from, d.id).producer.close(); this.dropOrigin(d.id); return {}; }
      case 'consume': {
        const t = this.transportOf(from, d.transportId);
        const spatial = d.spatial ?? 0;
        const lp = await this.localProducer(d.producerId, spatial);
        if (!this.router.canConsume({ producerId: lp.id, rtpCapabilities: d.rtpCapabilities })) throw new Error('This browser cannot play that stream.');
        const c = await t.consume({ producerId: lp.id, rtpCapabilities: d.rtpCapabilities, paused: true, preferredLayers: { spatialLayer: spatial, temporalLayer: 2 } });
        this.use(lp.id, +1);
        const cl = this.client(from);
        cl.consumers.set(c.id, { consumer: c, originId: d.producerId });
        const end = () => { if (cl.consumers.delete(c.id)) this.use(lp.id, -1); };
        c.on('transportclose', end);
        c.on('producerclose', () => { end(); this.signal.send(from, 'ms', { ev: 'consumer_closed', id: c.id, producerId: d.producerId }); });
        const meta = this.origin.get(d.producerId) ?? { owner: lp.appData.owner, source: lp.appData.source };
        return { id: c.id, producerId: d.producerId, kind: c.kind, rtpParameters: c.rtpParameters, owner: meta.owner, source: meta.source };
      }
      case 'resume_consumer': { await this.consumerOf(from, d.id).consumer.resume(); return {}; }
      case 'pause_consumer': { await this.consumerOf(from, d.id).consumer.pause(); return {}; }
      case 'layers': {
        const x = this.consumerOf(from, d.id);
        if (!this.origin.has(x.originId)) await this.wantLayer(x.originId, d.spatial);
        if (x.consumer.type === 'simulcast') await x.consumer.setPreferredLayers({ spatialLayer: d.spatial, temporalLayer: 2 });
        return {};
      }
      case 'close_consumer': { const x = this.consumerOf(from, d.id); x.consumer.close(); this.client(from).consumers.delete(d.id); this.use(x.consumer.producerId, -1); return {}; }
      case 'stats': return { load: this.load, name: this.name };
      case 'bye': {
        const c = this.clients.get(from);
        if (c) { for (const t of c.transports.values()) t.close(); this.clients.delete(from); }
        return {};
      }

      // from other hosts
      case 'link_open': {
        const l = { out: new Map() };
        l.transport = await this.newPlainTransport();
        await l.transport.connect({ ip: d.ip, port: d.port, srtpParameters: d.srtp });
        l.ready = Promise.resolve(l);
        const old = this.links.get(from);
        if (old) this.closeLink(from, old);
        this.links.set(from, l);
        log(`linked with host ${from}`);
        return { ip: this.addr, port: l.transport.tuple.localPort, srtp: l.transport.srtpParameters };
      }
      case 'pull': {
        const l = this.links.get(from);
        if (!l) throw Object.assign(new Error('No link with that host.'), { code: 'no_link' });
        await l.ready;
        const existing = l.out.get(d.producerId);
        const lp = await this.localProducer(d.producerId, d.spatial ?? 0);
        const meta = this.origin.get(d.producerId) ?? { owner: lp.appData.owner, source: lp.appData.source };
        if (existing && !existing.closed) return { kind: existing.kind, rtpParameters: existing.rtpParameters, owner: meta.owner, source: meta.source };
        const c = await l.transport.consume({ producerId: lp.id, rtpCapabilities: this.router.rtpCapabilities, paused: false, preferredLayers: { spatialLayer: d.spatial ?? 0, temporalLayer: 2 } });
        l.out.set(d.producerId, c);
        this.use(lp.id, +1);
        c.on('producerclose', () => { l.out.delete(d.producerId); this.use(lp.id, -1); });
        c.on('transportclose', () => this.use(lp.id, -1));
        return { kind: c.kind, rtpParameters: c.rtpParameters, owner: meta.owner, source: meta.source };
      }
      case 'pull_layers': {
        const c = this.links.get(from)?.out.get(d.producerId);
        if (!this.origin.has(d.producerId)) await this.wantLayer(d.producerId, d.spatial);
        if (c?.type === 'simulcast') await c.setPreferredLayers({ spatialLayer: d.spatial, temporalLayer: 2 });
        return {};
      }
      case 'unpull': {
        const l = this.links.get(from);
        const c = l?.out.get(d.producerId);
        if (c) { l.out.delete(d.producerId); this.use(c.producerId, -1); c.close(); }
        return {};
      }
      default: throw new Error(`unknown request ${method}`);
    }
  }

  transportOf(peer, id) {
    const t = this.clients.get(peer)?.transports.get(id);
    if (!t) throw Object.assign(new Error('No such connection.'), { code: 'no_transport' });
    return t;
  }
  consumerOf(peer, id) {
    const c = this.clients.get(peer)?.consumers.get(id);
    if (!c) throw Object.assign(new Error('No such stream.'), { code: 'no_consumer' });
    return c;
  }
  ownProducer(peer, id) {
    const o = this.origin.get(id);
    if (!o || o.owner !== peer) throw Object.assign(new Error('Not your stream.'), { code: 'forbidden' });
    return o;
  }

  dropOrigin(id) {
    const o = this.origin.get(id);
    if (!o) return;
    this.origin.delete(id);
    this.clients.get(o.owner)?.producers.delete(id);
    if (!o.standby) this.publishDir();
  }

  peerLeft(peer) {
    const c = this.clients.get(peer);
    if (c) {
      for (const t of c.transports.values()) t.close();
      this.clients.delete(peer);
    }
    this.dirs.delete(peer);
    const l = this.links.get(peer);
    if (l) this.closeLink(peer, l);
    this.gcRemote();
  }

  // Leave politely: ask the server to move everyone to other hosts, give them a few seconds, then go.
  async stop(why) {
    if (this.stopping) return;
    this.stopping = true;
    for (const t of this.timers ?? []) clearInterval(t);
    if (why === 'leaving' && this.signal) {
      log('handing the call to the other hosts');
      await this.signal.post('/media/drain', {}).catch(() => {});
      const until = Date.now() + Number(this.flags['drain-s'] ?? 4) * 1000;
      while (Date.now() < until && [...this.clients.values()].some((c) => c.consumers.size)) await new Promise((r) => setTimeout(r, 250));
      await this.signal.post('/media/leave', {}).catch(() => {});
    }
    this.signal?.close();
    try { this.echo?.close(); } catch {}
    this.worker?.close();
  }
}
