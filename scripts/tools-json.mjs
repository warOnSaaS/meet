// Writes tools.json from the tool definitions in server/tools/meet.mjs, and checks it with the suite's
// checker when a checkout of warOnSaaS/suite is next to this repo. `--check` fails when tools.json is stale.
import fs from 'node:fs';
import path from 'node:path';
import { catalogue } from '../server/tools/meet.mjs';

const file = path.resolve('tools.json');
const text = JSON.stringify(catalogue(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('tools.json is out of date. Run: npm run tools:json'); process.exit(1); }
  console.log('tools.json is up to date');
} else {
  fs.writeFileSync(file, text);
  console.log(`wrote tools.json (${catalogue().tools.length} tools)`);
}
