// Copies the warOnSaaS Account client library into server/account-client.mjs. Do not edit the copy.
// Usage: node scripts/sync-account.mjs [path-to-wos-account]
import fs from 'node:fs';
import path from 'node:path';
const src = path.resolve(process.argv[2] ?? path.join(process.env.HOME ?? '..', 'wos-account'), 'client', 'account-client.mjs');
const out = path.resolve('server', 'account-client.mjs');
fs.writeFileSync(out, `// Copied from warOnSaaS/account client/account-client.mjs by scripts/sync-account.mjs. Do not edit here.\n${fs.readFileSync(src, 'utf8')}`);
console.log(`copied ${src} -> ${out}`);
