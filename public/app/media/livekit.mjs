// Calls carried by a LiveKit media server, when one is configured: for calls bigger than the computers in
// the call can carry, and later for recording and agents. Same events as the other engines.
const SRC = { microphone: 'mic', camera: 'cam', screen_share: 'screen' };

export class LiveKitEngine {
  constructor({ signal, me, local, canPublish = true, onTrack, onTrackGone, onPeerState, onEvent }) {
    Object.assign(this, { signal, me, local, canPublish, onTrack, onTrackGone, onPeerState, onEvent });
    this.kind = 'livekit';
    this.pubs = {};
  }

  async update() {
    if (this.room) return;
    const lk = await import('../../vendor/livekit-client.js');
    this.lk = lk;
    const t = await this.signal.post('/media/livekit-token', {});
    if (!t.ok) throw new Error(t.error?.message ?? 'No media server.');
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    room.on(lk.RoomEvent.TrackSubscribed, (track, pub, p) => this.onTrack?.({ peer: p.identity, source: SRC[pub.source] ?? 'cam', track: track.mediaStreamTrack }));
    room.on(lk.RoomEvent.TrackUnsubscribed, (track, pub, p) => this.onTrackGone?.({ peer: p.identity, source: SRC[pub.source] ?? 'cam' }));
    room.on(lk.RoomEvent.ActiveSpeakersChanged, (sp) => this.onEvent?.('levels', sp.map((s) => ({ owner: s.identity, volume: s.audioLevel }))));
    room.on(lk.RoomEvent.Disconnected, () => this.onEvent?.('disconnected'));
    await room.connect(t.url, t.token);
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
    if (pub && track) await pub.track.replaceTrack(track);
    else if (pub && !track) { await this.room.localParticipant.unpublishTrack(pub.track, false); delete this.pubs[source]; }
    else if (track) await this.publish(source, track);
  }

  setView() {}
  setCanPublish(on) { this.canPublish = on; }
  async stats() { return { room: this.room?.name, state: this.room?.state }; }
  async stop() { await this.room?.disconnect(); }
}
