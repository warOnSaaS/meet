// The screen part the wOS suite loads (packages/manifest, section 5): { mount(el, ctx) }.
// Built into dist/screens.mjs by scripts/build-screens.mjs. The same screens as the standalone page
// (public/app/home.mjs), drawn into the suite's element: ctx.callTool for every action, the call's media
// under /media/meet, links inside the app moved with ctx.navigate.
import { startMeet, route, stopMeet } from '../public/app/home.mjs';
import { configure } from '../public/app/api.mjs';
import { setToast } from '../public/app/dom.mjs';
import css from '../public/app/meet.css';

const BASE = '/a/meet';

export default {
  title: 'Meetings',
  mount(el, ctx) {
    const doc = el.ownerDocument;
    el.classList.add('wos-meet');
    if (!doc.getElementById('wos-meet-style')) doc.head.append(Object.assign(doc.createElement('style'), { id: 'wos-meet-style', textContent: css }));
    configure({ callTool: (name, input) => ctx.callTool(name, input), media: '/media/meet' });
    if (ctx.toast) setToast((m) => ctx.toast(m));

    let path = ctx.path || '/';
    const strip = (p) => {
      let x = String(p);
      if (x.startsWith(BASE)) x = x.slice(BASE.length) || '/';
      return x;
    };
    const nav = {
      suite: true,
      path: () => path,
      query: () => new URLSearchParams(path.split('?')[1] ?? ''),
      // The suite's address bar carries the path; a query (a host key) stays in memory only.
      go: (p) => { path = strip(p); ctx.navigate(path.split('?')[0]); return route(); },
      replace: (p) => { path = strip(p); },
      href: (p) => `${BASE}${p === '/' ? '' : p}`,
    };
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.target || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href.startsWith(BASE)) return;
      e.preventDefault();
      nav.go(href);
    };
    el.addEventListener('click', onClick);
    startMeet(el, nav);
    return {
      update(p) {
        const next = strip(p || '/');
        if (next.split('?')[0] === path.split('?')[0]) return;
        path = next;
        // Moving away from a call inside the app (back button) leaves it first.
        stopMeet().finally(() => route());
      },
      unmount() {
        el.removeEventListener('click', onClick);
        stopMeet();
        el.innerHTML = '';
        el.classList.remove('wos-meet');
      },
    };
  },
};
