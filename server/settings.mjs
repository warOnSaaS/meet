// Settings a team (inside wOS) or a person (standalone) gives Meetings: the model that writes notes, the
// speech service used when a device cannot transcribe, and file storage for recordings. Stored in
// meet_settings as JSON; keys and secrets are encrypted with a key derived from SESSION_SECRET (which lives
// outside the database) and are never sent back to a screen. The environment gives defaults for everyone.
import crypto from 'node:crypto';

export const FIELDS = {
  notes_model_url: { env: 'NOTES_MODEL_URL', secret: false, about: 'OpenAI-compatible address for meeting notes, for example https://api.openai.com/v1 or http://localhost:11434/v1' },
  notes_model: { env: 'NOTES_MODEL', secret: false, about: 'Model name, for example gpt-4.1-mini or llama3.1' },
  notes_model_key: { env: 'NOTES_MODEL_KEY', secret: true, about: 'API key for that address (leave empty for a local server)' },
  transcribe_url: { env: 'TRANSCRIBE_URL', secret: false, about: 'OpenAI-compatible speech-to-text address (Whisper), used only for people whose device cannot transcribe' },
  transcribe_model: { env: 'TRANSCRIBE_MODEL', secret: false, about: 'Speech model name, for example whisper-1' },
  transcribe_key: { env: 'TRANSCRIBE_KEY', secret: true, about: 'API key for the speech service' },
  s3_endpoint: { env: 'S3_ENDPOINT', secret: false, about: 'S3-compatible storage address, for example https://<account>.r2.cloudflarestorage.com' },
  s3_bucket: { env: 'S3_BUCKET', secret: false, about: 'Bucket for recordings and whiteboards' },
  s3_region: { env: 'S3_REGION', secret: false, about: 'Region (auto for R2)' },
  s3_access_key_id: { env: 'S3_ACCESS_KEY_ID', secret: true, about: 'Access key id' },
  s3_secret_access_key: { env: 'S3_SECRET_ACCESS_KEY', secret: true, about: 'Secret access key' },
};

const keyOf = (secret) => crypto.createHash('sha256').update(`meet-settings:${secret}`).digest();
function seal(secret, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${Buffer.concat([ct, c.getAuthTag()]).toString('base64url')}`;
}
function open(secret, box) {
  try {
    const [, iv, data] = String(box).split('.');
    const buf = Buffer.from(data, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8');
  } catch { return ''; }
}

/** Whose settings: the team's inside wOS, the host's standalone. */
export const ownerOf = (ctx, m) => (ctx.teamId ? `team:${m?.team_id ?? ctx.teamId}` : `user:${m?.host_id ?? ctx.caller.user?.id ?? 'none'}`);

async function ensure(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS meet_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

/** The stored values for an owner, decrypted, with environment defaults filled in. */
export async function readSettings(ctx, owner) {
  await ensure(ctx.db);
  const row = await ctx.db.get('SELECT value FROM meet_settings WHERE key = ?', [`settings:${owner}`]);
  const stored = row ? JSON.parse(row.value) : {};
  const env = ctx.config.env ?? process.env;
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = stored[k] != null ? (f.secret ? open(ctx.config.secret, stored[k]) : stored[k]) : '';
    out[k] = v || env[f.env] || '';
    out[`${k}__from`] = v ? 'settings' : env[f.env] ? 'server' : null;
  }
  return out;
}

export async function writeSettings(ctx, owner, input) {
  await ensure(ctx.db);
  const row = await ctx.db.get('SELECT value FROM meet_settings WHERE key = ?', [`settings:${owner}`]);
  const stored = row ? JSON.parse(row.value) : {};
  for (const [k, f] of Object.entries(FIELDS)) {
    if (!(k in input)) continue;
    const v = input[k] == null ? '' : String(input[k]).trim().slice(0, 1000);
    if (!v) delete stored[k];
    else stored[k] = f.secret ? seal(ctx.config.secret, v) : v;
  }
  const value = JSON.stringify(stored);
  const done = await ctx.db.run('UPDATE meet_settings SET value = ? WHERE key = ?', [value, `settings:${owner}`]);
  if (!done.changes) await ctx.db.run('INSERT INTO meet_settings (key, value) VALUES (?, ?)', [`settings:${owner}`, value]);
}

/** What a screen may see: which fields are set and where from, never the secrets themselves. */
export function publicView(s) {
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) out[k] = f.secret ? { set: !!s[k], from: s[`${k}__from`] } : { value: s[k] || null, from: s[`${k}__from`] };
  out.notes_model_ready = !!(s.notes_model_url && s.notes_model);
  out.transcribe_ready = !!(s.transcribe_url && (s.transcribe_key || !/openai\.com/.test(s.transcribe_url)));
  out.storage_ready = !!(s.s3_endpoint && s.s3_bucket && s.s3_access_key_id && s.s3_secret_access_key);
  return out;
}
