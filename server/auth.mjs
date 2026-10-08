// Who is calling. Three kinds of caller, all with signed, stateless tokens:
//   a member, signed in with GitHub (cookie in the browser, bearer token for agents and MCP clients);
//   a participant ticket, which a guest gets from a meeting link and which only works inside that meeting;
//   a peer token, which a browser or a participant host uses on the media signalling routes.
import crypto from 'node:crypto';

const now = () => Date.now();
export const COOKIE = 'meet_session';

export function sign(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

export function verify(secret, token, kind) {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (p.k !== kind || (p.exp && p.exp < now())) return null;
  return p;
}

export const id = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');
export const secretToken = (n = 18) => crypto.randomBytes(n).toString('base64url');

export function sessionToken(config, user, sid = null) {
  return sign(config.secret, { k: 'session', uid: user.id, ...(sid ? { sid } : {}), exp: now() + 30 * 864e5 });
}

export function cookieHeader(value, maxAgeS, secure = true) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${maxAgeS}`;
}

// The caller for a tool request. Returns { user, ticket } where either may be null.
export async function callerFrom(req, { db, config }) {
  const out = { user: null, ticket: null };
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];
  const s = verify(config.secret, bearer || (cookie && decodeURIComponent(cookie)), 'session');
  // Signed in through a warOnSaaS account: still signed in there? (cached a minute)
  const live = s?.sid ? await (await import('./account.mjs')).accountFor(config)?.isLive(s.sid) ?? true : true;
  if (s && live) out.user = await db.get('SELECT * FROM meet_users WHERE id = ?', [s.uid]);
  const t = req.headers['x-meet-ticket'];
  if (t) out.ticket = verify(config.secret, t, 'ticket');
  return out;
}

export async function upsertUser(db, { login, name, email, avatar }) {
  const found = await db.get('SELECT * FROM meet_users WHERE github_login = ?', [login]);
  if (found) {
    await db.run('UPDATE meet_users SET name = ?, email = ?, avatar_url = ? WHERE id = ?', [name || login, email ?? found.email, avatar ?? found.avatar_url, found.id]);
    return { ...found, name: name || login };
  }
  const u = { id: id('u_'), github_login: login, name: name || login, email: email ?? null, avatar_url: avatar ?? null, created_at: now() };
  await db.run('INSERT INTO meet_users (id, github_login, name, email, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)', [u.id, u.github_login, u.name, u.email, u.avatar_url, u.created_at]);
  return u;
}

// ---- GitHub sign-in (the same flow as agent-kanban's lib/auth.mjs, without the MCP OAuth server) ----

export function githubLoginRedirect(res, config, host, next) {
  if (!config.github.clientId) {
    res.writeHead(302, { location: '/?signin=unavailable' }).end();
    return;
  }
  const state = sign(config.secret, { k: 'gh', next: safeNext(next), exp: now() + 9e5 });
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', config.github.clientId);
  u.searchParams.set('redirect_uri', `${host}/auth/github/callback`);
  u.searchParams.set('scope', 'read:user user:email');
  u.searchParams.set('state', state);
  res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' }).end();
}

export async function githubCallback(req, res, { db, config }, host) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const st = verify(config.secret, q.state, 'gh');
  if (!st || !q.code) return res.writeHead(302, { location: '/?signin=failed' }).end();
  const tok = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code: q.code, redirect_uri: `${host}/auth/github/callback` }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!tok.access_token) return res.writeHead(302, { location: '/?signin=failed' }).end();
  const gh = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${tok.access_token}`, 'user-agent': 'wos-meet' } }).then((r) => r.json());
  if (config.github.allow.length && !config.github.allow.includes(String(gh.login).toLowerCase())) return res.writeHead(302, { location: '/?signin=not-on-team' }).end();
  const user = await upsertUser(db, { login: gh.login, name: gh.name, email: gh.email, avatar: gh.avatar_url });
  res.writeHead(302, { 'set-cookie': cookieHeader(sessionToken(config, user), 30 * 86400, host.startsWith('https')), location: st.next }).end();
}

export const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');
