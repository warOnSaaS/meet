// Sign-in with a warOnSaaS account on the hosted copy (AUTH_PROVIDER=waronsaas, or WOS_ACCOUNT_CLIENT_ID set):
// GitHub, Google or an email link happen at account.waronsaas.com, and the meet session carries the account
// session id so "Sign out everywhere" reaches it. Guests still join by link with no account at all.
import { WosAccount, authProvider } from './account-client.mjs';
import { cookieHeader, sessionToken, safeNext, id } from './auth.mjs';

const cache = new Map();
export const accountMode = (config) => authProvider(config.env) === 'waronsaas' && !!config.env.WOS_ACCOUNT_CLIENT_ID;

export function accountFor(config, base) {
  if (!accountMode(config)) return null;
  const key = base || config.publicUrl || 'http://localhost';
  if (!cache.has(key)) cache.set(key, WosAccount.fromEnv(config.env, { redirectUri: `${key}/auth/waronsaas/callback`, secret: config.secret }));
  return cache.get(key);
}

// A person from their account: the row made for this account, else (once) a GitHub sign-in or the same verified
// email from before, else a new row whose id is the account id.
export async function userFromAccount(db, p) {
  let u = await db.get('SELECT * FROM meet_users WHERE id = ?', [p.sub]);
  if (!u && p.github_login) u = await db.get('SELECT * FROM meet_users WHERE lower(github_login) = ?', [String(p.github_login).toLowerCase()]);
  if (!u && p.email && p.email_verified) u = await db.get('SELECT * FROM meet_users WHERE lower(email) = ? ORDER BY created_at LIMIT 1', [String(p.email).toLowerCase()]);
  if (u) {
    await db.run('UPDATE meet_users SET name = ?, email = COALESCE(?, email), avatar_url = COALESCE(?, avatar_url) WHERE id = ?', [p.name || u.name, p.email ?? null, p.picture ?? null, u.id]);
    return { ...u, name: p.name || u.name };
  }
  const row = { id: p.sub || id('u_'), github_login: p.github_login ?? null, name: p.name || (p.email ? p.email.split('@')[0] : 'Guest'), email: p.email ?? null, avatar_url: p.picture ?? null, created_at: Date.now() };
  await db.run('INSERT INTO meet_users (id, github_login, name, email, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)', [row.id, row.github_login, row.name, row.email, row.avatar_url, row.created_at]);
  return row;
}

/** The /auth routes in account mode. Returns true when it answered. */
export async function accountRoutes(p, req, res, url, { db, config }, base) {
  const acct = accountFor(config, base);
  if (!acct) return false;
  const secure = base.startsWith('https');
  const next = safeNext(url.searchParams.get('next'));
  if (p === '/auth/waronsaas') {
    const s = acct.start({ next, prompt: url.searchParams.get('prompt') === 'none' ? 'none' : null, provider: ['github', 'google'].includes(url.searchParams.get('provider')) ? url.searchParams.get('provider') : null, secure });
    res.writeHead(302, { location: s.location, 'set-cookie': s.cookie, 'cache-control': 'no-store' }).end();
    return true;
  }
  if (p === '/auth/waronsaas/callback') {
    const r = await acct.finish(req);
    if (r.error) {
      const to = safeNext(r.next);
      const flag = r.error === 'login_required' || r.error === 'consent_required' ? 'silent=tried' : r.error === 'access_denied' ? '' : 'signin=failed';
      res.writeHead(302, { location: flag ? `${to}${to.includes('?') ? '&' : '?'}${flag}` : to, 'set-cookie': r.clear, 'cache-control': 'no-store' }).end();
      return true;
    }
    const user = await userFromAccount(db, r.profile);
    res.writeHead(302, { 'set-cookie': [cookieHeader(sessionToken(config, user, r.profile.sid), 30 * 86400, secure), r.clear], location: safeNext(r.next), 'cache-control': 'no-store' }).end();
    return true;
  }
  if (p === '/auth/waronsaas/backchannel' && req.method === 'POST') {
    // Sessions are stateless and checked against the account every minute, so the token only needs a 200.
    res.writeHead(200).end();
    return true;
  }
  // The old GitHub link goes through the account.
  if (p === '/auth/github') {
    res.writeHead(302, { location: `/auth/waronsaas?next=${encodeURIComponent(next)}&provider=github`, 'cache-control': 'no-store' }).end();
    return true;
  }
  if (p === '/auth/signout') {
    res.writeHead(302, { 'set-cookie': cookieHeader('', 0, secure), location: acct.endSessionUrl(`${base}/`) }).end();
    return true;
  }
  return false;
}
