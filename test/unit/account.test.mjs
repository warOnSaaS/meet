// AUTH_PROVIDER=waronsaas: members sign in with a warOnSaaS account (a fake one here); guests still join by
// link with no account; starting a meeting needs sign-in (OPEN_CREATE off); the account's sign-out reaches here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, api } from '../helpers.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const fake = { nonce: '', live: new Set(['ses_1']), url: '' };
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const acct = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
  if (req.url === '/jwks.json') return send({ keys: [jwk] });
  if (req.url === '/oauth/token') {
    const now = Math.floor(Date.now() / 1000);
    const body = `${enc({ alg: 'RS256', kid: 'k1' })}.${enc({ iss: fake.url, aud: 'meet', sub: 'acc_riley', sid: 'ses_1', email: 'riley@acme.example', email_verified: true, name: 'Riley Chen', nonce: fake.nonce, iat: now, exp: now + 3600 })}`;
    return send({ access_token: 'x', id_token: `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}` });
  }
  if (req.url === '/api/sessions/check') { const sid = JSON.parse(b).sid; return send({ sessions: { [sid]: fake.live.has(sid) } }); }
  res.writeHead(404).end();
});
await new Promise((r) => acct.listen(0, '127.0.0.1', r));
fake.url = `http://127.0.0.1:${acct.address().port}`;
const srv = await startServer({ DEV_LOGIN: '0', OPEN_CREATE: '0', AUTH_PROVIDER: 'waronsaas', WOS_ACCOUNT_CLIENT_ID: 'meet', WOS_ACCOUNT_CLIENT_SECRET: 'shh', WOS_ACCOUNT_URL: fake.url });
after(async () => { acct.close(); await srv.close(); });

test('starting a meeting needs a free account; whoami points at the account sign-in', async () => {
  const who = await api(srv.base, 'meet.whoami', {});
  assert.equal(who.user, null);
  assert.equal(who.can_start, false);
  assert.equal(who.signin_url, '/auth/waronsaas');
  await assert.rejects(api(srv.base, 'meet.create', { title: 'Standup' }), (e) => e.code === 'sign_in' && /warOnSaaS account/.test(e.message));
});

let cookie;
test('sign in through the account, start a meeting, and a guest joins by link with no account', async () => {
  let r = await fetch(`${srv.base}/auth/github?next=/`, { redirect: 'manual' });
  assert.match(r.headers.get('location'), /^\/auth\/waronsaas\?next=%2F&provider=github/);
  r = await fetch(`${srv.base}/auth/waronsaas?next=/m`, { redirect: 'manual' });
  const to = new URL(r.headers.get('location'));
  assert.equal(to.origin, fake.url);
  fake.nonce = to.searchParams.get('nonce');
  const flow = r.headers.getSetCookie()[0].split(';')[0];
  r = await fetch(`${srv.base}/auth/waronsaas/callback?code=c&state=${to.searchParams.get('state')}`, { redirect: 'manual', headers: { cookie: flow } });
  assert.equal(r.headers.get('location'), '/m');
  cookie = r.headers.getSetCookie().find((c) => c.startsWith('meet_session=')).split(';')[0];
  const who = await api(srv.base, 'meet.whoami', {}, { cookie });
  assert.equal(who.user.id, 'acc_riley');
  const m = await api(srv.base, 'meet.create', { title: 'Standup' }, { cookie });
  const g = await api(srv.base, 'meet.join', { meeting: m.join_url.split('/m/')[1], name: 'Casey' });
  assert.equal(g.participant.is_guest, true, 'a guest joins by link with no account');
});

test('signing out everywhere on the account signs out here too', async () => {
  fake.live.delete('ses_1');
  const { accountFor } = await import('../../server/account.mjs');
  accountFor(srv.app.config)?.live.clear();
  const who = await api(srv.base, 'meet.whoami', {}, { cookie });
  assert.equal(who.user, null);
});
