// The standalone page: Meetings drawn into #app, moving around with the browser's own address bar.
// The wOS suite loads the same screens through screens/index.mjs instead.
import { startMeet, route } from './home.mjs';

const nav = {
  suite: false,
  path: () => location.pathname + location.search,
  query: () => new URLSearchParams(location.search),
  go: (p) => { history.pushState({}, '', p); return route(); },
  replace: (p) => history.replaceState({}, '', p),
  href: (p) => p,
};
startMeet(document.getElementById('app'), nav);
window.addEventListener('popstate', () => route());
