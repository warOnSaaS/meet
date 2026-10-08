// Makes the known speech files the notetaker tests feed in as fake microphones (Chromium's
// --use-file-for-fake-audio-capture, with --mute-audio). It runs at test time, writes to test/.cache/speech
// (git-ignored, never committed) and never plays anything aloud: `say -o` writes a file. macOS only. Each file: 3 s of silence, three lines with 1.5 s gaps, then silence up to 40 s, 16 kHz mono.
// Writes test/.cache/speech/<who>.wav and script.json (the words and where each line sits in the file).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = new URL('../test/.cache/speech/', import.meta.url).pathname;
const RATE = 16000;
export const SCRIPT = {
  sam: { voice: 'Samantha', lines: [
    'Good morning everyone, thanks for joining the Acme Dental planning call.',
    'We decided to move the launch to Friday the fourteenth.',
    'Jordan will send the revised quote to the client by Thursday.',
  ] },
  jordan: { voice: 'Daniel', lines: [
    'Thanks Sam, that works for me.',
    'I will update the proposal and share it with the team today.',
    'Casey should review the contract before the launch.',
  ] },
};
const LEAD = 3, GAP = 1.5, TOTAL = 40;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-'));
const pcm = (file) => {
  const raw = path.join(tmp, 'x.raw');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', raw]);
  return fs.readFileSync(raw);
};
const silence = (s) => Buffer.alloc(Math.round(s * RATE) * 2);
const out = {};
fs.mkdirSync(OUT, { recursive: true });
for (const [who, { voice, lines }] of Object.entries(SCRIPT)) {
  const parts = [silence(LEAD)];
  let t = LEAD;
  const marks = [];
  lines.forEach((line, i) => {
    const aiff = path.join(tmp, `${who}${i}.aiff`);
    execFileSync('say', ['-v', voice, '-r', '175', '-o', aiff, line]);
    const b = pcm(aiff);
    const dur = b.length / 2 / RATE;
    marks.push({ text: line, start_ms: Math.round(t * 1000), end_ms: Math.round((t + dur) * 1000) });
    parts.push(b);
    t += dur;
    if (i < lines.length - 1) { parts.push(silence(GAP)); t += GAP; }
  });
  if (t < TOTAL) parts.push(silence(TOTAL - t));
  const data = Buffer.concat(parts);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUT, `${who}.wav`), Buffer.concat([head, data]));
  out[who] = { voice, file: `${who}.wav`, seconds: TOTAL, lines: marks };
}
fs.writeFileSync(path.join(OUT, 'script.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(out).length} speech files to ${OUT}`);
