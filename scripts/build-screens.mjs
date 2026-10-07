// Bundles the suite screen part (screens/index.mjs) into one browser module: dist/screens.mjs.
// meet.css is scoped to the mount root (.wos-meet) so nothing in it reaches the suite's shell; page-level
// rules (html, body) are left out. The engines for bigger calls (participant hosts, LiveKit) load large
// browser libraries; inside the suite they are left out for now and calls go peer to peer (up to 4 people).
// --check fails when dist/screens.mjs is out of date.
import fs from 'node:fs';
import { build, transform } from 'esbuild';

const plugin = {
  name: 'meet-suite',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = fs.readFileSync(args.path, 'utf8').replace(/^(html|body)[^{]*\{[^}]*\}\s*$/gm, '');
      const { code } = await transform(`.wos-meet{${css}}`, { loader: 'css', target: ['chrome100', 'safari15', 'firefox100'], minify: true });
      return { contents: code, loader: 'text' };
    });
    b.onResolve({ filter: /\/media\/(sfu|livekit)\.mjs$/ }, (args) => ({ path: args.path, namespace: 'meet-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'meet-stub' }, () => ({
      contents: `const no = () => { throw new Error('Calls of more than 4 people are not available inside wOS yet. Open the Meetings site for bigger calls.'); };
export class SfuEngine { constructor() { no(); } }
export class LiveKitEngine { constructor() { no(); } }`,
      loader: 'js',
    }));
  },
};

export const screensOptions = {
  entryPoints: ['screens/index.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [plugin],
  outfile: 'dist/screens.mjs',
  legalComments: 'none',
  write: false,
  banner: { js: '// wOS Meetings screen part, built from screens/index.mjs by scripts/build-screens.mjs. AGPL-3.0. Do not edit.' },
};

const out = (await build(screensOptions)).outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (!fs.existsSync('dist/screens.mjs') || fs.readFileSync('dist/screens.mjs', 'utf8') !== out) { console.error('dist/screens.mjs is out of date: run npm run build:screens'); process.exit(1); }
  console.log('dist/screens.mjs is current');
} else {
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/screens.mjs', out);
  console.log(`wrote dist/screens.mjs (${Math.round(out.length / 1024)} KB)`);
}
