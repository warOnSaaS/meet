// The whiteboard in the call: Excalidraw (MIT) in every browser, merged with Yjs (MIT). Each change is a
// small Yjs update sent to the others over the call's encrypted channel (sealed with the meeting key), so
// the app's server never sees the drawing while it is made. A few seconds after a change, the browser that
// made it saves the board to the meeting (meet.save_whiteboard) with an SVG and PNG picture.
import { callTool, assetUrl } from './api.mjs';
import { esc, icon, toast } from './dom.mjs';

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let libP = null;
function lib() {
  if (!libP) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = assetUrl('wb/whiteboard.css');
    document.head.append(css);
    libP = import(/* @vite-ignore */ assetUrl('wb/whiteboard.js'));
  }
  return libP;
}

export class Whiteboard {
  constructor(call) {
    this.call = call;
    this.status = null;
    this.hidden = false;
    this.stats = { sent: 0, received: 0, saves: 0 };
  }

  get mid() { return this.call.meeting.id; }

  async load() {
    try { this.status = await callTool('meet.get_whiteboard', { meeting: this.mid }); } catch { return; }
    if (this.status.open && !this.hidden) await this.show();
    if (!this.status.open) this.hide(true);
    this.call.render();
  }

  async show() {
    if (this.el) { this.el.hidden = false; return; }
    const stage = this.call.root.querySelector('#stage');
    this.el = document.createElement('div');
    this.el.className = 'meet-wb';
    this.el.innerHTML = `<div class="meet-wb-h"><b class="meet-wb-t"></b><div class="meet-wb-a" id="wba"></div></div><div class="meet-wb-c" id="wbc"><p class="ui-empty">Loading the whiteboard…</p></div>`;
    stage.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('submit', (e) => this.onSubmit(e));
    this.renderHead();
    const L = await lib();
    this.L = L;
    this.doc = new L.Y.Doc();
    this.map = this.doc.getMap('elements');
    const full = await callTool('meet.get_whiteboard', { meeting: this.mid, full: true }).catch(() => null);
    if (full?.state) L.Y.applyUpdate(this.doc, unb64(full.state), 'remote');
    else if (full?.elements?.length) this.doc.transact(() => { for (const e of full.elements) this.map.set(e.id, e); }, 'remote');
    const ch = this.call.channel;
    this.offs = [
      ch.on('wb', (u) => { this.stats.received++; L.Y.applyUpdate(this.doc, unb64(u), 'remote'); }),
      // Someone just opened the board: send them what they are missing.
      ch.on('wb-hello', (sv, from) => ch.send('wb', b64(L.Y.encodeStateAsUpdate(this.doc, unb64(sv))), from)),
    ];
    this.doc.on('update', (u, origin) => { if (origin === 'local') { this.stats.sent++; ch.send('wb', b64(u)).catch(() => {}); this.saveSoon(); } });
    this.map.observe((e) => { if (e.transaction.origin !== 'local') this.toScene(); });
    ch.send('wb-hello', b64(L.Y.encodeStateVector(this.doc))).catch(() => {});
    const host = this.el.querySelector('#wbc');
    host.innerHTML = '';
    // Excalidraw's own buttons draw on this screen; the drawing reaches the meeting through
    // meet.save_whiteboard, which is also how an agent draws. Say so on each of them, for the parity check.
    const tag = () => { for (const el of host.querySelectorAll('button:not([data-tool]), [role=menuitem]:not([data-tool]), label:has(> input[type=radio]):not([data-tool])')) { el.dataset.tool = 'none'; el.dataset.why = 'draws on the whiteboard on this screen; the board is saved with meet.save_whiteboard, which agents use to draw'; } };
    this.mo = new MutationObserver(tag);
    this.mo.observe(host, { childList: true, subtree: true });
    this.root = L.createRoot(host);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    this.root.render(L.React.createElement(L.Excalidraw, {
      excalidrawAPI: (api) => { this.api = api; this.toScene(); },
      initialData: { elements: this.elements(), appState: { viewBackgroundColor: dark ? '#121214' : '#ffffff' } },
      theme: dark ? 'dark' : 'light',
      onChange: (els) => this.fromScene(els),
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
    }));
  }

  elements() { return [...(this.map?.values() ?? [])].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0)); }

  // Drawing on this screen: every element whose version moved goes into the shared document.
  fromScene(els) {
    if (this.applying || !this.map) return;
    this.doc.transact(() => {
      for (const el of els) {
        const cur = this.map.get(el.id);
        if (!cur || cur.version < el.version || (cur.version === el.version && cur.versionNonce !== el.versionNonce && el.versionNonce < cur.versionNonce)) this.map.set(el.id, JSON.parse(JSON.stringify(el)));
      }
    }, 'local');
  }

  // Drawing from the others: put the merged document on screen.
  toScene() {
    if (!this.api) return;
    this.applying = true;
    try { this.api.updateScene({ elements: this.elements() }); } finally { this.applying = false; }
  }

  saveSoon() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save().catch((e) => console.warn('[meet] board save', e.message)), 2500); }

  async pictures() {
    const els = this.elements().filter((e) => !e.isDeleted);
    const appState = { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false };
    const files = this.api?.getFiles?.() ?? null;
    const svg = els.length ? (await this.L.exportToSvg({ elements: els, appState, files })).outerHTML : '';
    let png = '';
    if (els.length) {
      const blob = await this.L.exportToBlob({ elements: els, appState, files, mimeType: 'image/png' });
      if (blob.size < 1_500_000) png = b64(new Uint8Array(await blob.arrayBuffer()));
    }
    return { els, svg, png };
  }

  async save() {
    if (!this.doc) return;
    const { els, svg, png } = await this.pictures();
    await callTool('meet.save_whiteboard', { meeting: this.mid, state: b64(this.L.Y.encodeStateAsUpdate(this.doc)), elements: els, svg, ...(png ? { png_base64: png } : {}) });
    this.stats.saves++;
  }

  hide(gone = false) {
    if (gone) { this.hidden = false; this.teardown(); return; }
    this.hidden = true;
    if (this.el) this.el.hidden = true;
    this.call.render();
  }

  teardown() {
    clearTimeout(this.saveT);
    this.mo?.disconnect();
    for (const off of this.offs ?? []) off();
    this.offs = null;
    try { this.root?.unmount(); } catch {}
    this.root = null; this.api = null; this.doc?.destroy(); this.doc = null; this.map = null;
    this.el?.remove(); this.el = null;
  }

  renderHead() {
    if (!this.el) return;
    const s = this.status;
    this.el.querySelector('.meet-wb-t').textContent = s?.title ?? 'Whiteboard';
    const canClose = this.call.amHost() || s?.opened_by === this.call.me.display_name;
    const inSuite = !!this.call.notes?.status?.in_suite;
    const html = `<button class="ui-btn is-quiet is-sm" data-tool="meet.export_whiteboard" data-act="wb-png">${icon('download', 16)} PNG</button>
      <button class="ui-btn is-quiet is-sm" data-tool="meet.export_whiteboard" data-act="wb-svg">${icon('download', 16)} SVG</button>
      ${inSuite ? `<form class="meet-wb-att" data-tool="meet.attach_whiteboard" data-act="wb-attach"><label class="ui-sr" for="wbto">Attach to</label><input class="ui-input" id="wbto" name="to" placeholder="crm:deal:Acme Dental or board:task:7"><button class="ui-btn is-sm" type="submit" data-tool="meet.attach_whiteboard">Attach</button></form>` : ''}
      <button class="ui-btn is-ghost is-sm" data-tool="none" data-why="hides the whiteboard on this screen only" data-act="wb-hide">Hide</button>
      ${canClose ? '<button class="ui-btn is-ghost is-sm" data-tool="meet.close_whiteboard" data-act="wb-close">Close for everyone</button>' : ''}`;
    const a = this.el.querySelector('#wba');
    if (a.dataset.html !== html) { a.innerHTML = html; a.dataset.html = html; }
  }

  moreItems() {
    if (this.status?.open && !this.hidden) return [];
    return [this.status?.open ? ['wb-show', 'none', 'Show the whiteboard', 'board', 'shows the whiteboard on this screen again'] : ['wb-open', 'meet.open_whiteboard', 'Whiteboard', 'board']];
  }

  async onAct(a) {
    if (a === 'wb-open') { this.hidden = false; this.status = await callTool('meet.open_whiteboard', { meeting: this.mid }); await this.show(); return this.call.render(); }
    if (a === 'wb-show') { this.hidden = false; await this.show(); return this.call.render(); }
    if (a === 'wb-hide') return this.hide();
    if (a === 'wb-close') { await this.save().catch(() => {}); await callTool('meet.close_whiteboard', { meeting: this.mid }); return this.load(); }
    if (a === 'wb-png' || a === 'wb-svg') {
      await this.save();
      const format = a === 'wb-png' ? 'png' : 'svg';
      const r = await callTool('meet.export_whiteboard', { meeting: this.mid, format });
      const blob = format === 'png' ? new Blob([unb64(r.png_base64)], { type: r.mime }) : new Blob([r.svg], { type: r.mime });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: r.file_name.replace(/[^\w .-]+/g, '') });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || b.closest('form')) return; // the attach form has its own submit handler
    b.disabled = true;
    try { await this.onAct(b.dataset.act); } catch (err) { toast(err.message); } finally { b.disabled = false; }
  }

  async onSubmit(e) {
    if (e.target.dataset.act !== 'wb-attach') return;
    e.preventDefault();
    const to = String(new FormData(e.target).get('to') || '').trim();
    if (!to) return;
    try { await this.save(); const r = await callTool('meet.attach_whiteboard', { meeting: this.mid, to }); toast(`Attached to ${r.attached}`); } catch (err) { toast(err.message); }
  }

  snapshot() { return { open: !!this.status?.open, shown: !!this.el && !this.el.hidden, elements: this.elements().filter((e) => !e.isDeleted).length, stats: this.stats }; }

  stop() { this.teardown(); }
}
