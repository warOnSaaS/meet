// Reachability checks for calls, in plain words. Used by `meet doctor` on the command line and by the
// meet.doctor tool. Each check says what it tested, whether it passed, and what to do if not.
import dgram from 'node:dgram';
import tls from 'node:tls';
import net from 'node:net';
import crypto from 'node:crypto';

// A STUN binding request (RFC 5389). Answers with the public address the other side saw.
export function stunBinding(server, { timeoutMs = 2500, socket } = {}) {
  const [host, port] = server.replace(/^stuns?:/, '').split(':');
  return new Promise((resolve) => {
    const s = socket ?? dgram.createSocket('udp4');
    const txid = crypto.randomBytes(12);
    const msg = Buffer.alloc(20);
    msg.writeUInt16BE(0x0001, 0); msg.writeUInt16BE(0, 2); msg.writeUInt32BE(0x2112a442, 4); txid.copy(msg, 8);
    const done = (r) => { clearTimeout(t); s.off('message', onMsg); if (!socket) s.close(); resolve(r); };
    const t = setTimeout(() => done({ ok: false, error: 'no answer' }), timeoutMs);
    const started = Date.now();
    function onMsg(buf) {
      if (buf.length < 20 || !buf.subarray(8, 20).equals(txid)) return;
      let i = 20;
      while (i + 4 <= buf.length) {
        const type = buf.readUInt16BE(i), len = buf.readUInt16BE(i + 2), v = buf.subarray(i + 4, i + 4 + len);
        if (type === 0x0020 && v[1] === 1) {
          const port2 = v.readUInt16BE(2) ^ 0x2112;
          const ip = [0, 1, 2, 3].map((k) => v[4 + k] ^ msg[4 + k]).join('.');
          return done({ ok: true, ip, port: port2, ms: Date.now() - started });
        }
        if (type === 0x0001 && v[1] === 1) return done({ ok: true, ip: [...v.subarray(4, 8)].join('.'), port: v.readUInt16BE(2), ms: Date.now() - started });
        i += 4 + len + ((4 - (len % 4)) % 4);
      }
      done({ ok: false, error: 'answer without an address' });
    }
    s.on('message', onMsg);
    s.on('error', (e) => done({ ok: false, error: e.code ?? e.message }));
    s.send(msg, Number(port || 3478), host, (e) => e && done({ ok: false, error: e.code ?? e.message }));
  });
}

function tlsCheck(hostname, port = 443, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: hostname, port, servername: hostname, timeout: timeoutMs }, () => {
      const c = s.getPeerCertificate();
      resolve({ ok: s.authorized, valid_to: c?.valid_to, error: s.authorized ? null : String(s.authorizationError) });
      s.end();
    });
    s.on('error', (e) => resolve({ ok: false, error: e.code ?? e.message }));
    s.on('timeout', () => { resolve({ ok: false, error: 'timed out' }); s.destroy(); });
  });
}

function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: timeoutMs }, () => { resolve({ ok: true }); s.end(); });
    s.on('error', (e) => resolve({ ok: false, error: e.code ?? e.message }));
    s.on('timeout', () => { resolve({ ok: false, error: 'timed out' }); s.destroy(); });
  });
}

export async function runDoctor({ config, publicUrl, livekitHost } = {}) {
  const checks = [];
  const add = (name, ok, said, fix) => checks.push({ name, ok, said, fix: ok ? null : fix });

  const stun = await stunBinding(config?.stun?.[0] ?? 'stun:stun.l.google.com:19302');
  add('UDP out', stun.ok, stun.ok ? `UDP works. The internet sees this machine as ${stun.ip}.` : `A STUN check got ${stun.error}.`, 'Calls need UDP. Allow outbound UDP in the firewall, or set up TURN over TCP or TLS (TURN_URLS).');

  if (publicUrl?.startsWith('https://')) {
    const host = new URL(publicUrl).hostname;
    const t = await tlsCheck(host);
    add('TLS', t.ok, t.ok ? `${host} has a valid certificate until ${t.valid_to}.` : `TLS to ${host} failed: ${t.error}.`, 'Browsers only allow camera and microphone on https. Put Caddy in front (docker compose does this) or fix the certificate.');
  } else if (publicUrl) {
    const local = /localhost|127\.0\.0\.1/.test(publicUrl);
    add('TLS', local, local ? 'Running on localhost, where browsers allow camera and microphone without https.' : `${publicUrl} is not https.`, 'Serve the app over https, or browsers will block the camera and microphone.');
  }

  if (config?.turn) {
    const u = config.turn.urls.find((x) => x.startsWith('turn:'));
    if (u) {
      const r = await stunBinding(u.replace(/^turn:/, '').split('?')[0]);
      add('TURN reachable', r.ok, r.ok ? `The TURN server at ${u} answers.` : `The TURN server at ${u} did not answer (${r.error}).`, 'Check the TURN address and that UDP 3478 is open on that server.');
    }
  } else {
    add('TURN', true, 'No TURN server is set. Most people connect directly; some behind strict company or hotel firewalls will not, and they will see a message saying so. Set TURN_URLS to fix that.', null);
  }

  if (config?.livekit || livekitHost) {
    const u = new URL((config?.livekit?.url ?? livekitHost).replace(/^ws/, 'http'));
    const sig = await fetch(u.origin + '/', { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
    add('Media server', sig, sig ? `LiveKit answers at ${u.origin}.` : `LiveKit does not answer at ${u.origin}.`, 'Start it with: docker compose --profile meetings up -d, and check LIVEKIT_URL.');
    const tcp = await tcpCheck(u.hostname, 7881);
    add('Media server TCP 7881', tcp.ok, tcp.ok ? 'TCP 7881 (media over TCP fallback) is open.' : `TCP 7881 is closed (${tcp.error}).`, 'Open TCP 7881 on the media server firewall.');
    const turn = await stunBinding(`${u.hostname}:3478`);
    add('Media server TURN UDP 3478', turn.ok, turn.ok ? 'The built-in TURN answers on UDP 3478.' : `No answer on UDP 3478 (${turn.error}).`, 'Open UDP 3478 and set turn.enabled in livekit.yaml.');
  }
  const ok = checks.every((c) => c.ok);
  return { ok, summary: ok ? 'Everything calls need is in place.' : `${checks.filter((c) => !c.ok).length} thing(s) need fixing.`, checks };
}
