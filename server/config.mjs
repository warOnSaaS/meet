// Everything the server reads from the environment, in one place. See .env.example.
import crypto from 'node:crypto';

export function loadConfig(env = process.env) {
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const turnUrls = list(env.TURN_URLS);
  return {
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') || '',
    secret: env.SESSION_SECRET || devSecret(),
    devLogin: env.DEV_LOGIN === '1',
    // Anyone may start a meeting without signing in (the hosted demo). Off by default for self-hosters.
    openCreate: env.OPEN_CREATE === '1',
    github: { clientId: env.GITHUB_CLIENT_ID || '', clientSecret: env.GITHUB_CLIENT_SECRET || '', allow: list(env.GITHUB_ALLOW).map((s) => s.toLowerCase()) },
    stun: list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),
    turn: turnUrls.length ? { urls: turnUrls, secret: env.TURN_SECRET || '', username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' } : null,
    livekit: env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET ? { url: env.LIVEKIT_URL, key: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET } : null,
    p2pMax: Number(env.P2P_MAX ?? 4),
    pollMs: Number(env.SIGNAL_POLL_MS ?? 20000),
    serverless: !!env.VERCEL,
  };
}

let dev;
function devSecret() {
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) throw new Error('SESSION_SECRET is required in production');
  return (dev ??= crypto.randomBytes(32).toString('hex'));
}

// ICE servers handed to browsers. TURN with a shared secret uses the coturn "REST API" scheme: short-lived
// credentials, so the secret never leaves the server.
export function iceServers(config, who = 'guest') {
  const out = config.stun.length ? [{ urls: config.stun }] : [];
  const t = config.turn;
  if (t) {
    if (t.secret) {
      const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${who}`;
      const credential = crypto.createHmac('sha1', t.secret).update(username).digest('base64');
      out.push({ urls: t.urls, username, credential });
    } else out.push({ urls: t.urls, username: t.username, credential: t.credential });
  }
  return out;
}
