// Bundles the browser libraries the screens use into public/vendor: mediasoup-client and livekit-client (calls),
// the speech model's worker (transformers.js running Whisper, for notes), the whiteboard (Excalidraw and
// Yjs), and background blur (MediaPipe). The screens themselves are plain modules in public/app and need no
// build. Large runtime files (the speech model, ONNX and MediaPipe WebAssembly) load from their CDNs once.
import fs from 'node:fs';
import path from 'node:path';

const ifNeeded = process.argv.includes('--if-needed');
const out = path.resolve('public', 'vendor');
const targets = [
  { entry: 'client/mediasoup-client.mjs', file: 'mediasoup-client.js' },
  { entry: 'client/livekit-client.mjs', file: 'livekit-client.js' },
  { entry: 'client/whisper-worker.mjs', file: 'whisper-worker.js' },
];
if (ifNeeded && [...targets.map((t) => t.file), 'livekit-e2ee-worker.mjs'].every((f) => fs.existsSync(path.join(out, f)))) process.exit(0);
let esbuild;
try { esbuild = await import('esbuild'); } catch { if (ifNeeded) process.exit(0); throw new Error('esbuild is not installed'); }
fs.mkdirSync(out, { recursive: true });
for (const t of targets) {
  await esbuild.build({ entryPoints: [t.entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, outfile: path.join(out, t.file), legalComments: 'linked', logLevel: 'warning' });
}
// LiveKit's end-to-end encryption runs in its own worker, shipped as is.
fs.copyFileSync(path.resolve('node_modules/livekit-client/dist/livekit-client.e2ee.worker.mjs'), path.join(out, 'livekit-e2ee-worker.mjs'));
console.log(`built ${targets.map((t) => t.file).join(', ')} and livekit-e2ee-worker.mjs into public/vendor`);
