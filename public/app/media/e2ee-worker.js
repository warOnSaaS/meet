// End-to-end encryption of media frames. Runs in a worker; the call's computers forward frames they cannot read.
// Each frame: [clear header][AES-GCM ciphertext + tag][12-byte IV][1 byte: 0xE2]. The clear header is what a
// forwarding server needs to route and pick layers: VP8 keeps its first 10 bytes on key frames and 3 on others
// (the same split Jitsi and LiveKit use); Opus keeps 1 byte.
let key = null;
const MARK = 0xe2;

async function setKey(raw) {
  const bytes = Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('wos-meet-e2ee-v1'), info: new Uint8Array() }, base, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
}

const clearBytes = (kind, frame) => (kind === 'audio' ? 1 : frame.type === 'key' ? 10 : 3);
const stats = { enc: 0, dec: 0, fail: 0, why: {} };
const failed = (kind, why) => { stats.fail++; const k = `${kind}:${why}`; stats.why[k] = (stats.why[k] ?? 0) + 1; };

function encryptor(kind) {
  return new TransformStream({
    async transform(frame, ctl) {
      if (!key) return; // never send a frame in the clear
      const data = new Uint8Array(frame.data);
      const n = Math.min(clearBytes(kind, frame), data.length);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: data.subarray(0, n) }, key, data.subarray(n)));
      const out = new Uint8Array(n + ct.length + 13);
      out.set(data.subarray(0, n), 0); out.set(ct, n); out.set(iv, n + ct.length); out[out.length - 1] = MARK;
      frame.data = out.buffer;
      stats.enc++;
      ctl.enqueue(frame);
    },
  });
}

function decryptor(kind) {
  return new TransformStream({
    async transform(frame, ctl) {
      const data = new Uint8Array(frame.data);
      if (!key) return failed(kind, 'no key');
      if (data.length < 14 || data[data.length - 1] !== MARK) return failed(kind, data.length < 14 ? 'short' : 'not encrypted');
      const n = Math.min(clearBytes(kind, frame), data.length - 13);
      const iv = data.subarray(data.length - 13, data.length - 1);
      try {
        const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: data.subarray(0, n) }, key, data.subarray(n, data.length - 13)));
        const out = new Uint8Array(n + pt.length);
        out.set(data.subarray(0, n), 0); out.set(pt, n);
        frame.data = out.buffer;
        stats.dec++;
        ctl.enqueue(frame);
      } catch { failed(kind, 'bad tag'); }
    },
  });
}

function pipe({ readable, writable, kind, op }) {
  readable.pipeThrough(op === 'encrypt' ? encryptor(kind) : decryptor(kind)).pipeTo(writable).catch(() => {});
}

onmessage = async ({ data }) => {
  if (data.op === 'key') { await setKey(data.key); postMessage({ op: 'key-ok' }); }
  else if (data.op === 'stats') postMessage({ op: 'stats', stats });
  else if (data.op === 'encrypt' || data.op === 'decrypt') pipe(data);
};

// Browsers with RTCRtpScriptTransform (Safari, Firefox) deliver the streams here instead.
if (self.RTCTransformEvent) {
  self.onrtctransform = (e) => { const { kind, op } = e.transformer.options; pipe({ readable: e.transformer.readable, writable: e.transformer.writable, kind, op }); };
}
