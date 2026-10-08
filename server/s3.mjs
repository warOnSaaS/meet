// Presigned URLs for S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2), AWS Signature V4
// in the query string. The browser uploads a recording straight to the bucket with the URL, so the file never
// passes through this server (and Vercel's request size limit does not apply). The bucket needs a CORS rule
// allowing PUT and GET from the app's address (docs/SELF-HOSTING.md).
import crypto from 'node:crypto';

const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** s: { s3_endpoint, s3_bucket, s3_region, s3_access_key_id, s3_secret_access_key }. Path-style URLs. */
export function presign(s, method, key, { expires = 3600, now = new Date(), contentType } = {}) {
  const endpoint = new URL(s.s3_endpoint);
  const region = s.s3_region || 'auto';
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = `${endpoint.pathname.replace(/\/$/, '')}/${enc(s.s3_bucket)}/${key.split('/').map(enc).join('/')}`;
  const headers = { host: endpoint.host, ...(contentType ? { 'content-type': contentType } : {}) };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${s.s3_access_key_id}/${scope}`, 'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': signedHeaders,
  };
  const query = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonical = [method, path, query, Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  let k = hmac(`AWS4${s.s3_secret_access_key}`, day);
  for (const part of [region, 's3', 'aws4_request']) k = hmac(k, part);
  const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${sig}`;
}
