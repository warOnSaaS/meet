// What a computer can offer as a call host: upload speed, CPU, power, and how steady its connection is.
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

export function cpuInfo() {
  const cores = os.cpus().length;
  return { cores, load: Math.min(1, os.loadavg()[0] / cores) };
}

// Plugged in? macOS: pmset. Linux: power_supply. Anything else (or a desktop with no battery): yes.
export function pluggedIn() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('pmset', ['-g', 'batt'], (e, out) => resolve(e ? true : !/Battery Power/.test(out)));
    } else if (process.platform === 'linux') {
      try {
        const dir = '/sys/class/power_supply';
        const ac = fs.readdirSync(dir).filter((d) => /^(AC|ADP|ACAD)/i.test(d));
        resolve(ac.length ? ac.some((d) => fs.readFileSync(`${dir}/${d}/online`, 'utf8').trim() === '1') : true);
      } catch { resolve(true); }
    } else resolve(true);
  });
}

// Upload: send random bytes to the meeting server and time it. Rough, and capped by the server's own
// download, so a host can also say its speed with --upload-mbps.
export async function measureUpload(base, token, { bytes = 1_500_000, rounds = 2 } = {}) {
  const body = new Uint8Array(bytes);
  for (let i = 0; i < body.length; i += 65536) crypto.getRandomValues(body.subarray(i, Math.min(i + 65536, body.length)));
  let best = 0;
  for (let i = 0; i < rounds; i++) {
    const t = performance.now();
    const r = await fetch(`${base}/media/speedtest`, { method: 'POST', headers: { 'x-meet-peer': token, 'content-type': 'application/octet-stream' }, body }).catch(() => null);
    if (!r?.ok) return null;
    await r.arrayBuffer();
    const s = (performance.now() - t) / 1000;
    best = Math.max(best, (bytes * 8) / s / 1e6);
  }
  return Math.round(best * 10) / 10;
}

// Jitter: spread of round trips to the meeting server, over the warm-up window.
export class Steadiness {
  constructor() { this.samples = []; }
  add(ms) { this.samples.push(ms); if (this.samples.length > 120) this.samples.shift(); }
  get jitterMs() {
    const s = this.samples;
    if (s.length < 3) return null;
    let sum = 0;
    for (let i = 1; i < s.length; i++) sum += Math.abs(s[i] - s[i - 1]);
    return Math.round((sum / (s.length - 1)) * 10) / 10;
  }
  get rttMs() { const s = [...this.samples].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }
}

export function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}
