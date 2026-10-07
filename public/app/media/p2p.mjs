// Direct calls: every person connects straight to every other person (a mesh), for up to 4 people.
// No server carries media. The app's own server only passes the connection details (signalling).
//
// To avoid both sides offering at once, the peer with the smaller id always makes the offer. Each connection
// has three fixed slots in the same order on both sides: microphone, camera, screen. Turning something on or
// off swaps the track in its slot, which needs no renegotiation.
export const SOURCES = ['mic', 'cam', 'screen'];

export class P2PEngine {
  constructor({ signal, me, local, ice, canPublish = true, onTrack, onTrackGone, onPeerState }) {
    Object.assign(this, { signal, me, local, ice, canPublish, onTrack, onTrackGone, onPeerState });
    this.kind = 'p2p';
    this.pcs = new Map();
    this.off = [];
    // Handle one message at a time, in order: an answer must not overtake its offer.
    this.chain = Promise.resolve();
    const h = (b, m) => { this.chain = this.chain.then(() => this.onSignal(m.from, b)).catch((e) => console.warn('[meet] p2p', e.message)); };
    signal.on('p2p', h);
    this.handler = h;
  }

  isOfferer(other) { return this.me < other; }

  async update(peers) {
    this.want = new Set(peers.filter((p) => p !== this.me));
    for (const [p, c] of this.pcs) if (!this.want.has(p)) this.drop(p, c);
    for (const p of this.want) if (!this.pcs.has(p) && this.isOfferer(p)) await this.connect(p);
  }

  makePc(peer) {
    const pc = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: 'max-bundle' });
    const c = { pc, peer, pendingIce: [], restarts: 0, tracks: new Map(), state: 'connecting' };
    pc.onicecandidate = (e) => e.candidate && this.signal.send(peer, 'p2p', { ice: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      const source = SOURCES[this.slotOf(pc, e.transceiver)] ?? 'cam';
      c.tracks.set(source, e.track);
      this.onTrack?.({ peer, source, track: e.track, receiver: e.receiver });
    };
    pc.oniceconnectionstatechange = () => this.watch(c);
    pc.onconnectionstatechange = () => this.watch(c);
    this.pcs.set(peer, c);
    return c;
  }

  slotOf(pc, t) {
    const list = pc.getTransceivers().slice().sort((a, b) => Number(a.mid) - Number(b.mid));
    return list.indexOf(t);
  }

  watch(c) {
    const s = c.pc.connectionState;
    const state = s === 'connected' ? 'connected' : s === 'failed' ? 'failed' : s === 'disconnected' ? 'unstable' : 'connecting';
    if (state !== c.state) { c.state = state; this.onPeerState?.(c.peer, state, this.reasonFor(c)); }
    if (s === 'failed' && this.isOfferer(c.peer) && c.restarts < 3) {
      c.restarts++;
      this.offer(c, true).catch(() => {});
    }
  }

  reasonFor(c) {
    if (c.state !== 'failed') return null;
    const turn = this.ice.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
    return turn ? 'The connection failed even through the relay server.' : 'A firewall on one side blocks direct calls. A relay (TURN) server would fix this; an admin can add one.';
  }

  async connect(peer) {
    const c = this.makePc(peer);
    for (const kind of ['audio', 'video', 'video']) c.pc.addTransceiver(kind, { direction: 'sendrecv' });
    await this.fillSlots(c);
    await this.offer(c, false);
  }

  async offer(c, restart) {
    const offer = await c.pc.createOffer(restart ? { iceRestart: true } : undefined);
    await c.pc.setLocalDescription(offer);
    this.signal.send(c.peer, 'p2p', { sdp: c.pc.localDescription.toJSON() });
  }

  async fillSlots(c) {
    const list = c.pc.getTransceivers().slice().sort((a, b) => Number(a.mid ?? 99) - Number(b.mid ?? 99));
    for (let i = 0; i < SOURCES.length; i++) {
      const t = list[i];
      if (!t) continue;
      t.direction = 'sendrecv';
      await t.sender.replaceTrack(this.canPublish ? this.local[SOURCES[i]] ?? null : null);
      if (SOURCES[i] === 'cam') this.tune(t.sender, 'cam');
    }
  }

  async tune(sender, source) {
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) return;
      const n = Math.max(1, this.want?.size ?? 1);
      p.encodings[0].maxBitrate = source === 'screen' ? 2_000_000 : n <= 1 ? 1_500_000 : 700_000;
      await sender.setParameters(p);
    } catch {}
  }

  async onSignal(from, b) {
    let c = this.pcs.get(from);
    if (b.sdp) {
      if (b.sdp.type === 'offer') {
        if (!c) c = this.makePc(from);
        await c.pc.setRemoteDescription(b.sdp);
        await this.fillSlots(c);
        const ans = await c.pc.createAnswer();
        await c.pc.setLocalDescription(ans);
        this.signal.send(from, 'p2p', { sdp: c.pc.localDescription.toJSON() });
      } else if (c) {
        await c.pc.setRemoteDescription(b.sdp);
      }
      if (c) for (const cand of c.pendingIce.splice(0)) await c.pc.addIceCandidate(cand).catch(() => {});
    } else if (b.ice) {
      if (!c || !c.pc.remoteDescription) {
        if (!c) { c = this.makePc(from); }
        c.pendingIce.push(b.ice);
      } else await c.pc.addIceCandidate(b.ice).catch(() => {});
    }
  }

  // A webinar viewer sends nothing; when the host lets them speak, their tracks go into the slots.
  async setCanPublish(on) {
    if (on === this.canPublish) return;
    this.canPublish = on;
    for (const c of this.pcs.values()) await this.fillSlots(c);
  }

  async setTrack(source, track) {
    this.local[source] = track;
    if (!this.canPublish) return;
    const i = SOURCES.indexOf(source);
    for (const c of this.pcs.values()) {
      const t = c.pc.getTransceivers().slice().sort((a, b) => Number(a.mid) - Number(b.mid))[i];
      if (t) { await t.sender.replaceTrack(track ?? null).catch(() => {}); if (track) this.tune(t.sender, source); }
    }
  }

  drop(peer, c) {
    for (const source of c.tracks.keys()) this.onTrackGone?.({ peer, source });
    c.pc.close();
    this.pcs.delete(peer);
  }

  async stats() {
    const out = {};
    for (const [peer, c] of this.pcs) {
      const r = await c.pc.getStats();
      let rtt = null, inBytes = 0, outBytes = 0, relay = false;
      r.forEach((s) => {
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') { rtt = s.currentRoundTripTime; const lc = r.get(s.localCandidateId); relay = lc?.candidateType === 'relay'; }
        if (s.type === 'inbound-rtp') inBytes += s.bytesReceived ?? 0;
        if (s.type === 'outbound-rtp') outBytes += s.bytesSent ?? 0;
      });
      out[peer] = { state: c.state, rtt, inBytes, outBytes, relay };
    }
    return out;
  }

  async stop() {
    for (const [p, c] of this.pcs) this.drop(p, c);
    const list = this.signal.handlers.get('p2p');
    if (list) list.splice(list.indexOf(this.handler), 1);
  }
}
