// Calls carried by a LiveKit media server, when one is configured: for calls bigger than the computers in
// the call can carry, and later for recording and agents. Same events as the other engines. Media is
// encrypted end to end with the meeting's key (LiveKit's own E2EE, keys supplied by us), so the media
// server forwards frames it cannot read.
const SRC = { microphone: 'mic', camera: 'cam', screen_share: 'screen' };

export class LiveKitEngine {
  constructor({ signal, me, local, e2eeKey, canPublish = true, onTrack, onTrackGone, onPeerState, onEvent }) {
    Object.assign(this, { signal, me, local, e2eeKey, canPublish, onTrack, onTrackGone, onPeerState, onEvent });
    this.kind = 'livekit';
    this.pubs = {};
  }

  async update() {
    if (this.room || this.connecting) return this.connecting;
    this.connecting = this.connect();
    return this.connecting;
  }

  async connect() {
    const lk = await import('../../vendor/livekit-client.js');
    this.lk = lk;
    const t = await this.signal.post('/media/livekit-token', {});
    if (!t.ok) throw new Error(t.error?.message ?? 'No media server.');
    let e2ee;
    if (this.e2eeKey && lk.isE2EESupported?.()) {
      this.keyProvider = new lk.ExternalE2EEKeyProvider();
      e2ee = { keyProvider: this.keyProvider, worker: new Worker(new URL('../../vendor/livekit-e2ee-worker.mjs', import.meta.url), { type: 'module' }) };
    }
    const room = new lk.Room({ adaptiveStream: true, dynacast: true, ...(e2ee ? { e2ee } : {}) });
    this.room = room;
    room.on(lk.RoomEvent.TrackSubscribed, (track, pub, p) => this.onTrack?.({ peer: p.identity, source: SRC[pub.source] ?? 'cam', track: track.mediaStreamTrack, receiver: track.receiver }));
    room.on(lk.RoomEvent.TrackUnsubscribed, (track, pub, p) => this.onTrackGone?.({ peer: p.identity, source: SRC[pub.source] ?? 'cam' }));
    room.on(lk.RoomEvent.ActiveSpeakersChanged, (sp) => this.onEvent?.('levels', sp.map((s) => ({ owner: s.identity, volume: s.audioLevel }))));
    room.on(lk.RoomEvent.Disconnected, () => this.onEvent?.('disconnected'));
    room.on(lk.RoomEvent.EncryptionError, () => { this.e2eeErrors = (this.e2eeErrors ?? 0) + 1; });
    if (e2ee) { await this.keyProvider.setKey(this.e2eeKey); await room.setE2EEEnabled(true); }
    await room.connect(t.url, t.token);
    this.tokenCanPublish = this.canPublish;
    if (this.canPublish) for (const s of ['mic', 'cam', 'screen']) if (this.local[s]) await this.publish(s, this.local[s]);
  }

  async publish(source, track) {
    const lk = this.lk;
    const src = { mic: lk.Track.Source.Microphone, cam: lk.Track.Source.Camera, screen: lk.Track.Source.ScreenShare }[source];
    this.pubs[source] = await this.room.localParticipant.publishTrack(track, { source: src, simulcast: source === 'cam' });
  }

  async setTrack(source, track) {
    this.local[source] = track;
    if (!this.room || !this.canPublish) return;
    const pub = this.pubs[source];
    if (pub && track) await pub.track.replaceTrack(track, true);
    else if (pub && !track) { await this.room.localParticipant.unpublishTrack(pub.track, false); delete this.pubs[source]; }
    else if (track) await this.publish(source, track);
  }

  setView() {}

  async setCanPublish(on) {
    if (on === this.canPublish) return;
    this.canPublish = on;
    if (!this.room) return;
    // A viewer's token cannot publish: connect again with a new one now that the host lets them speak.
    if (on && !this.tokenCanPublish) {
      await this.room.disconnect();
      this.room = null; this.connecting = null;
      return this.update();
    }
    if (on) { for (const s of ['mic', 'cam', 'screen']) if (this.local[s] && !this.pubs[s]) await this.publish(s, this.local[s]); }
    else for (const s of Object.keys(this.pubs)) { await this.room.localParticipant.unpublishTrack(this.pubs[s].track, false); delete this.pubs[s]; }
  }

  async stats() { return { room: this.room?.name, state: this.room?.state, e2ee: !!this.room?.isE2EEEnabled, e2eeErrors: this.e2eeErrors ?? 0 }; }
  async stop() { await this.room?.disconnect(); }
}
