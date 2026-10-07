// Bundles the two browser libraries the screens use (mediasoup-client, livekit-client) into public/vendor.
// The screens themselves are plain modules in public/app and need no build.
import fs from 'node:fs';
import path from 'node:path';

const ifNeeded = process.argv.includes('--if-needed');
const out = path.resolve('public', 'vendor');
const targets = [
  { entry: 'client/mediasoup-client.mjs', file: 'mediasoup-client.js' },
  { entry: 'client/livekit-client.mjs', file: 'livekit-client.js' },
];
if (ifNeeded && targets.every((t) => fs.existsSync(path.join(out, t.file)))) process.exit(0);
let esbuild;
try { esbuild = await import('esbuild'); } catch { if (ifNeeded) process.exit(0); throw new Error('esbuild is not installed'); }
fs.mkdirSync(out, { recursive: true });
for (const t of targets) {
  await esbuild.build({ entryPoints: [t.entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: path.join(out, t.file), legalComments: 'linked', logLevel: 'warning' });
}
console.log(`built ${targets.map((t) => t.file).join(', ')} into public/vendor`);
