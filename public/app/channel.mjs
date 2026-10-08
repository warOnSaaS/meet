// The call's encrypted channel: small messages between the people in a call (live captions, whiteboard
// strokes), sealed in the browser with the meeting's key (AES-GCM) before they leave it. They travel through
// the same signalling mailbox as the rest of the call, so they work the same in direct calls, calls carried
// by computers in the call, and media-server calls. The app's server only ever passes ciphertext along.
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function channelKey(meetingKey) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`wos-meet channel v1:${meetingKey}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export class SecureChannel {
  constructor(signal, meetingKey) {
    this.signal = signal;
    this.key = channelKey(meetingKey);
    this.handlers = new Map();
    this.stats = { sent: 0, received: 0, failed: 0 };
    signal.on('enc', (b, m) => this.receive(b, m));
  }

  on(type, fn) { (this.handlers.get(type) ?? this.handlers.set(type, []).get(type)).push(fn); return () => this.off(type, fn); }
  off(type, fn) { const l = this.handlers.get(type); if (l) l.splice(l.indexOf(fn) >>> 0, 1); }

  /** Send to everyone in the call ('*') or one peer. */
  async send(type, data, to = '*') {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key, enc.encode(JSON.stringify({ t: type, d: data }))));
    this.signal.send(to, 'enc', { iv: b64(iv), ct: b64(ct) });
    this.stats.sent++;
  }

  async receive(b, m) {
    let msg;
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(b.iv) }, await this.key, unb64(b.ct));
      msg = JSON.parse(dec.decode(pt));
    } catch { this.stats.failed++; return; }
    this.stats.received++;
    for (const fn of this.handlers.get(msg.t) ?? []) { try { fn(msg.d, m.from); } catch (e) { console.error(e); } }
  }
}
