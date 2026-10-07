// Before anything is published: no private names and no em dashes in any tracked file or commit message.
// Private names live in .names (git-ignored), one per line, so this public repo never lists them.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const names = fs.existsSync('.names') ? fs.readFileSync('.names', 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : [];
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/\.(woff2|png|ico)$/.test(f) && !f.startsWith('public/vendor/') && f !== 'package-lock.json');
const problems = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.includes('\u2014') && !f.startsWith('public/ui/')) problems.push(`${f}:${i + 1}: em dash`);
    for (const n of names) if (line.toLowerCase().includes(n.toLowerCase())) problems.push(`${f}:${i + 1}: private name`);
  });
}
const log = execFileSync('git', ['log', '--all', '--format=%H %B'], { encoding: 'utf8' });
for (const n of names) if (log.toLowerCase().includes(n.toLowerCase())) problems.push('a commit message has a private name');
if (log.includes('\u2014')) problems.push('a commit message has an em dash');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`clean: ${files.length} files, ${names.length} private names checked${names.length ? '' : ' (no .names file here)'}`);
