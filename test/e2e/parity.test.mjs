// Agent parity (ROADMAP 3.2), enforced:
// 1. Screen-to-tool: open every screen, panel and notice at desk and phone width and collect every button
//    and form. Each must name a tool in the catalogue (data-tool), be the submit button of a form that does,
//    or say data-tool="none" with a reason in data-why (it only moves around the screen). Links navigate.
// 2. No side doors: screen code only calls /api/tools/*, plus /media/* for the call's own traffic.
// 3. A parity report: actions per screen, tools used by screens, tools with no screen (allowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, joinAs, inCall, api } from '../helpers.mjs';
import { tools } from '../../server/tools/meet.mjs';

const catalogue = new Set(tools.map((t) => t.name));
const APP = new URL('../../public/app/', import.meta.url).pathname;

test('no side doors: screens only call /api/tools and the call\'s /media routes', () => {
  const problems = [];
  const files = [...fs.readdirSync(APP).map((f) => path.join(APP, f)), ...fs.readdirSync(path.join(APP, 'media')).map((f) => path.join(APP, 'media', f))].filter((f) => /\.m?js$/.test(f));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/fetch\(\s*([`'"])(.*?)\1/g)) {
      const url = m[2].replace(/\$\{[^}]*base[^}]*\}/, '');
      if (url === '${path}' && path.basename(f) === 'signal.mjs') continue; // Signal.post: its callers are checked below
      if (!/^\/(api\/tools\/|media\/)/.test(url)) problems.push(`${path.basename(f)}: fetch(${m[2]})`);
    }
    for (const m of src.matchAll(/\.post\(\s*([`'"])(.*?)\1/g)) if (!m[2].startsWith('/media/')) problems.push(`${path.basename(f)}: post(${m[2]})`);
    for (const m of src.matchAll(/sendBeacon\?*\.?\(\s*([`'"])(.*?)\1/g)) if (!m[2].startsWith('/media/')) problems.push(`${path.basename(f)}: sendBeacon(${m[2]})`);
  }
  assert.deepEqual(problems, []);
});

const collect = (page) => page.evaluate(() => {
  const out = [];
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  for (const el of document.querySelectorAll('button, form, select, [role=menuitem]')) {
    if (el.tagName !== 'FORM' && !visible(el)) continue;
    const form = el.closest('form');
    let tool = el.getAttribute('data-tool');
    let how = tool === 'none' ? (el.dataset.why ? 'none' : null) : tool ? 'tool' : null;
    if (!how && el.tagName === 'BUTTON' && el.type === 'submit' && form?.dataset.tool) { tool = form.dataset.tool; how = 'submit'; }
    if (!how && el.tagName === 'SELECT' && form?.dataset.tool) { tool = form.dataset.tool; how = 'form field'; }
    out.push({ tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), tool: tool === 'none' ? null : tool, how });
  }
  return out;
});

test('every action on every screen has a tool, at desk and phone width', async (t) => {
  const srv = await startServer();
  const browser = await launch();
  t.after(async () => { await browser.close(); await srv.close(); });
  const report = { screens: {}, used: new Set(), problems: [] };

  for (const [w, h, tag] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
    const viewport = { width: w, height: h };
    const check = async (page, name) => {
      await page.waitForTimeout(250);
      const found = await collect(page);
      report.screens[`${tag} ${name}`] = found.length;
      for (const f of found) {
        if (f.tool) report.used.add(f.tool);
        if (!f.how) report.problems.push(`${tag} ${name}: <${f.tag}> "${f.text}" names no tool`);
        else if (f.tool && !catalogue.has(f.tool)) report.problems.push(`${tag} ${name}: <${f.tag}> "${f.text}" names ${f.tool}, not in the catalogue`);
      }
    };
    // Signed out home.
    const anon = await (await browser.newContext({ viewport })).newPage();
    await anon.goto(srv.base);
    await anon.waitForSelector('.meet-hero');
    await check(anon, 'home, signed out');

    // Signed in home with a scheduled meeting, and the doctor's answer.
    const hostCtx = await browser.newContext({ viewport, permissions: ['camera', 'microphone'] });
    const host = await hostCtx.newPage();
    await host.goto(`${srv.base}/auth/dev?login=sam&name=Sam`);
    await host.waitForSelector('#schedule');
    await host.fill('#schedule input[name=title]', 'Acme Dental weekly');
    await host.click('#schedule button[type=submit]');
    await host.waitForSelector('.meet-row');
    await host.click('#doctor');
    await host.waitForSelector('.meet-doctor', { timeout: 15000 });
    await check(host, 'home, signed in');

    // Start a meeting: the join page, then the call.
    await host.click('#start');
    await host.waitForSelector('#jf');
    await check(host, 'join page');
    await host.click('#jf button[type=submit]');
    await inCall(host);
    const joinUrl = await host.evaluate(() => window.meetCall.meeting.join_url);

    // A guest in the waiting room.
    const g = await joinAs(browser, joinUrl, 'Jordan', { viewport });
    await g.page.waitForSelector('.meet-waiting');
    await check(g.page, 'waiting room');
    await host.waitForSelector('#notices [data-act=admit-all]');
    await check(host, 'call, someone waiting');
    await host.click('#bar [data-act=people]');
    await host.waitForSelector('#side [data-act=admit]');
    await check(host, 'people panel, someone waiting');
    await host.click('#side [data-act=admit]');
    await inCall(g.page);

    // A screen share request on the guest's screen.
    const gid = await g.page.evaluate(() => window.meetCall.me.id);
    const ticket = await host.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith('meet:ticket:'))));
    await api(srv.base, 'meet.request_screen_share', { meeting: joinUrl.split('/m/')[1], participant: gid }, { ticket });
    await g.page.waitForSelector('#notices [data-act=share]');
    await check(g.page, 'call, asked to share');

    await host.waitForSelector(`#side [data-pid="${gid}"]`, { state: 'attached' });
    for (const row of await host.$$('#side li.meet-prow')) await row.hover();
    await check(host, 'people panel');
    for (const p of ['chat', 'info']) {
      await host.click(`#side [data-panel=${p}]`);
      await host.waitForTimeout(200);
      if (p === 'info') { await host.click('#side [data-act=add-host]'); await host.waitForSelector('.meet-hostcmd'); }
      await check(host, `${p} panel`);
    }
    await host.click('#side [data-act=close]');
    await host.click('#bar [data-act=layout]');
    await check(host, 'call, speaker view');
    await check(g.page, 'call, guest');

    // Leaving, and a "help carry this call" link opened in a browser.
    await g.page.click('#bar [data-act=leave]');
    await g.page.waitForSelector('.meet-center');
    await check(g.page, 'after leaving');
    await g.page.goto(`${joinUrl}?hk=example`);
    await g.page.waitForSelector('#copycmd');
    await check(g.page, 'host link page');
    await host.click('#bar [data-act=people]');
    await host.click('#side [data-panel=info]');
    await host.click('#side [data-act=end]');
    await host.waitForSelector('.meet-center');
    await hostCtx.close();
    await g.ctx.close();
  }

  const noScreen = [...catalogue].filter((n) => !report.used.has(n));
  console.log('  parity report');
  for (const [k, v] of Object.entries(report.screens)) console.log(`    ${k}: ${v} actions`);
  console.log(`    tools used by screens: ${report.used.size} of ${catalogue.size}`);
  console.log(`    tools with no screen (agents only, allowed): ${noScreen.join(', ')}`);
  assert.deepEqual(report.problems, []);
});
