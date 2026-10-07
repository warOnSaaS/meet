// Copies the warOnSaaS UI kit (ui-design) into public/ui from the kit repo's main branch, as committed,
// whatever branch the kit checkout is on. Never edit public/ui by hand: what the kit lacks is in
// public/app/meet.css, written in the kit's tokens.
// Usage: node scripts/sync-kit.mjs [path-to-ui-design] [ref]   (defaults: ../waronsaas-ui-design, main)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const kit = path.resolve(process.argv[2] ?? path.join('..', 'waronsaas-ui-design'));
const ref = process.argv[3] ?? 'main';
const files = ['src/ui.css', 'src/tokens.css', 'src/ui.mjs',
  'fonts/geist.woff2', 'fonts/geist-mono.woff2', 'fonts/jetbrains-mono.woff2', 'fonts/departure-mono.woff2', 'fonts/fraunces.woff2', 'fonts/source-serif-4.woff2', 'fonts/instrument-sans.woff2',
  'fonts/OFL-Geist.txt', 'fonts/OFL-JetBrainsMono.txt', 'fonts/OFL-DepartureMono.txt', 'fonts/OFL-Fraunces.txt', 'fonts/OFL-SourceSerif4.txt', 'fonts/OFL-InstrumentSans.txt', 'NOTICE', 'LICENSE'];
const out = path.resolve('public', 'ui');
fs.rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const buf = execFileSync('git', ['-C', kit, 'show', `${ref}:${f}`], { maxBuffer: 1 << 26 });
  const to = path.join(out, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, buf);
  bytes += buf.length;
}
const rev = execFileSync('git', ['-C', kit, 'rev-parse', '--short', ref]).toString().trim();
fs.writeFileSync(path.join(out, 'SYNCED.txt'), `Copied from warOnSaaS/ui-design ${ref} at ${rev} by scripts/sync-kit.mjs. Do not edit.\n`);
console.log(`synced ui-design ${ref} ${rev} (${files.length} files, ${bytes} bytes) into public/ui`);
