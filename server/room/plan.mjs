// The room planner: given who is in a call and which computers can carry it, decide how media flows.
// Pure function, no I/O, so it is unit tested on its own (test/unit/plan.test.mjs).
//
// Order of preference, per room:
//   1. p2p:     everyone connects straight to everyone (up to 4 people). Needs nothing but this app.
//   2. hosts:   one or more participants' computers (desktop app or CLI) forward the media. No re-encoding.
//               Several hosts link to each other: full mesh up to 5 hosts, a star beyond that, so any
//               speaker reaches any listener in at most 2 host-to-host hops.
//   3. livekit: a LiveKit server, when one is configured.
//   4. capped:  4 people talk peer to peer; anyone else sees a plain message saying why they wait.

export const DEFAULTS = {
  p2pMax: 4,
  meshMaxHosts: 5,
  // What one viewer costs the host they are connected to, in Mbit/s of host upload: the active speaker at
  // the large simulcast layer, a page of small tiles, and audio.
  perViewerMbps: 2.0,
  // Webinar viewers watch one or two speakers and never publish.
  perWebinarViewerMbps: 1.4,
  // What one host-to-host link costs each end: only watched streams cross, mostly at the small layer.
  perLinkMbps: 2.6,
  usableUpload: 0.75,
  growAt: 1.2, // add a host when the hosts' combined limit is under 1.2x the people in the call
  shrinkAt: 1.6, // drop a host only when the rest still leave 1.6x headroom
  minUploadMbps: 5,
  maxJitterMs: 30,
  maxPathMs: 250, // end-to-end one-way delay budget between hosts on a meeting path
  maxPathMsWebinar: 1500, // webinar viewers tolerate more delay
};

// carrying: the host is in the current plan, or was ready in it. A jumpy connection then only lowers how
// many people it takes (hostCapacity), because dropping it would break a call that works; a new host has
// to meet the full bar to be chosen.
export function hostEligible(h, o = DEFAULTS, carrying = false) {
  const m = h.metrics ?? {};
  if (h.kind !== 'host' || h.draining) return { ok: false, why: h.draining ? 'handing off' : 'not a host' };
  if (!['desktop', 'cli'].includes(h.client)) return { ok: false, why: 'only the desktop app or the command line can carry a call' };
  if (m.plugged === false) return { ok: false, why: 'on battery' };
  if (!m.warm && !carrying) return { ok: false, why: 'still measuring the connection' };
  if (!(m.uploadMbps >= o.minUploadMbps)) return { ok: false, why: `upload under ${o.minUploadMbps} Mbit/s` };
  if (m.jitterMs > o.maxJitterMs && !carrying) return { ok: false, why: 'connection too jumpy' };
  return { ok: true };
}

export function hostCapacity(h, links, perViewer, o = DEFAULTS) {
  const up = (h.metrics?.uploadMbps ?? 0) * o.usableUpload;
  const cpu = h.metrics?.cpuLoad ?? 0;
  const cpuFactor = cpu > 0.85 ? 0.5 : cpu > 0.6 ? 0.8 : 1;
  const jitterFactor = h.metrics?.jitterMs > o.maxJitterMs ? 0.6 : 1;
  const usable = up * cpuFactor * jitterFactor - links * o.perLinkMbps;
  return Math.max(0, Math.floor(usable / perViewer));
}

const rtt = (a, b) => (a.peer === b.peer ? 0 : a.metrics?.rtt?.[b.peer] ?? b.metrics?.rtt?.[a.peer] ?? 20);
const score = (h, others) => {
  const m = h.metrics ?? {};
  const avgRtt = others.length ? others.reduce((s, o) => s + rtt(h, o), 0) / others.length : 0;
  return (m.uploadMbps ?? 0) * (1 - Math.min(0.9, m.cpuLoad ?? 0)) - avgRtt / 10;
};

// Links each host keeps for a set of hosts. Mesh: everyone; star: leaves to the root.
// prevRoot: the root last time. It stays root unless another host's worst round trip is clearly better
// (30 ms and a third), because changing the root relinks every host.
export function topologyFor(hosts, o = DEFAULTS, prevRoot = null) {
  if (hosts.length <= 1) return { topology: hosts.length ? 'single' : null, root: hosts[0]?.peer ?? null, links: [] };
  if (hosts.length <= o.meshMaxHosts) {
    const links = [];
    for (let i = 0; i < hosts.length; i++) for (let j = i + 1; j < hosts.length; j++) links.push([hosts[i].peer, hosts[j].peer]);
    return { topology: 'mesh', root: null, links };
  }
  // Star: the root is the host whose worst round trip to any other host is smallest; ties go to the best upload.
  let best = null;
  for (const c of hosts) {
    const worst = Math.max(...hosts.map((h) => rtt(c, h)));
    const s = score(c, hosts);
    if (!best || worst < best.worst || (worst === best.worst && s > best.s)) best = { c, worst, s };
  }
  const keep = prevRoot && hosts.find((h) => h.peer === prevRoot);
  if (keep) {
    const worstKeep = Math.max(...hosts.map((h) => rtt(keep, h)));
    if (!(best.worst < worstKeep - 30 && best.worst < worstKeep * 0.67)) best = { c: keep };
  }
  const root = best.c.peer;
  return { topology: 'star', root, links: hosts.filter((h) => h.peer !== root).map((h) => [root, h.peer]) };
}

// Host-to-host hops between two hosts under a topology.
export function hops(topo, a, b) {
  if (a === b) return 0;
  if (topo.topology === 'star') return a === topo.root || b === topo.root ? 1 : 2;
  return 1;
}

export function planRoom(input) {
  const o = { ...DEFAULTS, ...(input.options ?? {}) };
  const p2pMax = input.p2pMax ?? o.p2pMax;
  const meeting = input.meeting ?? {};
  const webinar = meeting.kind === 'webinar';
  const prev = input.prev ?? null;
  const pref = meeting.media_pref ?? 'auto';
  const browsers = (input.peers ?? []).filter((p) => p.kind === 'browser').sort((a, b) => a.joinedAt - b.joinedAt || (a.peer < b.peer ? -1 : 1));
  const allHosts = (input.peers ?? []).filter((p) => p.kind === 'host');
  const n = browsers.length;
  const needsServer = !!(meeting.needs?.record || meeting.needs?.agent);
  const viewers = webinar ? browsers.filter((b) => b.role === 'viewer').length : 0;
  const perViewer = n ? (viewers * o.perWebinarViewerMbps + (n - viewers) * o.perViewerMbps) / n : o.perViewerMbps;

  const peersInfo = Object.fromEntries((input.peers ?? []).map((p) => [p.peer, { pid: p.participantId ?? null, name: p.name ?? null, kind: p.kind, role: p.role ?? null }]));
  // Hosts carrying the call, or judged ready last time, keep the slack (see hostEligible).
  const trusted = new Set([...(prev?.hosts ?? []).map((h) => h.peer), ...Object.entries(prev?.hostStatus ?? {}).filter(([, v]) => v.ok).map(([k]) => k)]);
  const hostStatus = Object.fromEntries(allHosts.map((h) => [h.peer, hostEligible(h, o, trusted.has(h.peer))]));
  const hostEchoes = allHosts.filter((h) => h.metrics?.echo?.port).map((h) => ({ peer: h.peer, echo: h.metrics.echo }));
  const base = { peers: peersInfo, hostStatus, hostEchoes, p2p: [], hosts: [], links: [], topology: null, root: null, assign: {}, capped: [], limit: 0, message: null };

  const p2pPlan = (reason) => {
    const inCall = browsers.slice(0, p2pMax).map((b) => b.peer);
    const capped = browsers.slice(p2pMax).map((b) => b.peer);
    return {
      ...base, mode: n > p2pMax ? 'capped' : 'p2p', reason, p2p: inCall, capped, limit: p2pMax,
      message: capped.length ? `Calls of more than ${p2pMax} people need a computer to carry the call. Someone on the desktop app or the command line can turn on "Help carry this call", or an admin can add a media server.` : null,
    };
  };
  const livekitPlan = (reason) => ({ ...base, mode: 'livekit', reason, limit: Infinity });

  if (pref === 'livekit' && input.livekit) return livekitPlan('this meeting is set to use the media server');
  if (pref === 'p2p') return p2pPlan('this meeting is set to peer to peer');

  // Ranked eligible hosts, sticky: hosts from the last plan keep their place.
  let eligible = allHosts.filter((h) => hostStatus[h.peer].ok);
  const prevHosts = new Set((prev?.hosts ?? []).map((h) => h.peer));
  eligible.sort((a, b) => (prevHosts.has(b.peer) - prevHosts.has(a.peer)) || score(b, eligible) - score(a, eligible));

  // Path delay: a host whose round trip to the others would push a path over budget is not used.
  const budget = webinar ? o.maxPathMsWebinar : o.maxPathMs;

  const prevRoot = prev?.root ?? null;
  const capOf = (hs) => {
    const t = topologyFor(hs, o, prevRoot);
    const linkCount = (h) => t.links.filter((l) => l.includes(h.peer)).length;
    return hs.reduce((s, h) => s + hostCapacity(h, linkCount(h), perViewer, o), 0);
  };

  const stayHosts = prev?.mode === 'hosts' && n >= p2pMax && eligible.length > 0;
  const wantHosts = (!needsServer && n <= p2pMax && !stayHosts) ? false : eligible.length > 0;
  if (!wantHosts) {
    if (!needsServer && n <= p2pMax) return p2pPlan(`${n} ${n === 1 ? 'person' : 'people'}, direct connections`);
    if (input.livekit) return livekitPlan(needsServer ? 'recording or an agent needs the media server' : 'no computer in the call can carry it');
    return p2pPlan('no computer in the call can carry it and no media server is set up');
  }

  // How many hosts: grow before the limit is reached, shrink only with plenty of room. At least two when
  // two can carry it, so everyone has a warm standby.
  const minK = Math.min(2, eligible.length);
  const smallest = (factor) => {
    for (let k = minK; k <= eligible.length; k++) if (capOf(eligible.slice(0, k)) >= Math.ceil(n * factor)) return k;
    return eligible.length;
  };
  const prevK = Math.min(prevHosts.size ? [...prevHosts].filter((p) => eligible.some((h) => h.peer === p)).length : 0, eligible.length);
  let k;
  if (!prevK || capOf(eligible.slice(0, prevK)) < Math.ceil(n * o.growAt)) k = smallest(o.growAt);
  else if (prevK > minK && capOf(eligible.slice(0, prevK - 1)) >= Math.ceil(n * o.shrinkAt)) k = Math.max(minK, Math.min(prevK - 1, smallest(o.shrinkAt)));
  else k = prevK;
  k = Math.max(k, minK);

  let chosen = eligible.slice(0, k);
  let topo = topologyFor(chosen, o, prevRoot);
  // Re-parent: drop hosts that are too far from the rest, and recompute.
  // Hosts already carrying the call get twice the budget, so a slow moment does not reshuffle it.
  const budgetOf = (h) => budget * (prevHosts.has(h.peer) ? 2 : 1);
  for (let guard = 0; guard < 4 && chosen.length > 1; guard++) {
    const far = chosen.filter((h) => chosen.some((x) => pathMs(topo, chosen, h, x) > Math.max(budgetOf(h), budgetOf(x))));
    if (!far.length) break;
    // Drop the host on the most slow paths (the far one), then the slowest.
    const slow = (h) => chosen.filter((x) => pathMs(topo, chosen, h, x) > Math.max(budgetOf(h), budgetOf(x))).length;
    const worst = far.sort((a, b) => slow(b) - slow(a) || maxPath(topo, chosen, b) - maxPath(topo, chosen, a))[0];
    chosen = chosen.filter((h) => h !== worst);
    topo = topologyFor(chosen, o, prevRoot);
  }

  const linkCount = (peer) => topo.links.filter((l) => l.includes(peer)).length;
  const hosts = chosen.map((h) => ({ peer: h.peer, capacity: hostCapacity(h, linkCount(h.peer), perViewer, o), load: 0, parent: topo.topology === 'star' && h.peer !== topo.root ? topo.root : null }));
  const limit = hosts.reduce((s, h) => s + h.capacity, 0);

  if (n > limit && input.livekit) return livekitPlan(`the computers in the call can carry about ${limit} people`);

  // Assign each person a primary host (least loaded relative to capacity, nearer first) and a warm standby.
  const byPeer = Object.fromEntries(hosts.map((h) => [h.peer, h]));
  const assign = {};
  const capped = [];
  for (const b of browsers) {
    const was = prev?.assign?.[b.peer];
    const room = (h) => h.capacity - h.load;
    let primary = was?.primary && byPeer[was.primary] && room(byPeer[was.primary]) > 0 ? byPeer[was.primary] : null;
    if (!primary) {
      const open = hosts.filter((h) => room(h) > 0);
      open.sort((x, y) => x.load / x.capacity - y.load / y.capacity || (b.metrics?.rtt?.[x.peer] ?? 50) - (b.metrics?.rtt?.[y.peer] ?? 50));
      primary = open[0] ?? null;
    }
    if (!primary) { capped.push(b.peer); continue; }
    primary.load++;
    const others = hosts.filter((h) => h !== primary);
    let standby = was?.standby && byPeer[was.standby] && was.standby !== primary.peer ? byPeer[was.standby] : null;
    if (!standby && others.length) standby = others.sort((x, y) => x.load / Math.max(1, x.capacity) - y.load / Math.max(1, y.capacity))[0];
    assign[b.peer] = { primary: primary.peer, standby: standby?.peer ?? null };
  }

  return {
    ...base,
    mode: 'hosts',
    reason: `${hosts.length} ${hosts.length === 1 ? 'computer carries' : 'computers carry'} the call`,
    hosts, links: topo.links, topology: topo.topology, root: topo.root, assign, capped, limit,
    webinar,
    message: capped.length ? `This call is full: the computers carrying it can take about ${limit} people. When someone leaves, or another person turns on "Help carry this call", you will join.` : null,
  };
}

function pathMs(topo, hosts, a, b) {
  if (a === b) return 0;
  if (topo.topology !== 'star' || a.peer === topo.root || b.peer === topo.root) return rtt(a, b) / 2;
  const root = hosts.find((h) => h.peer === topo.root);
  return (rtt(a, root) + rtt(root, b)) / 2;
}
const maxPath = (topo, hosts, h) => Math.max(...hosts.map((x) => pathMs(topo, hosts, h, x)));

// Plain-words summary for the screens and for meet.room_status.
export function describePlan(plan) {
  if (!plan) return 'Nobody is in the call yet.';
  if (plan.mode === 'p2p') return 'Direct: everyone connects straight to everyone. No server carries the media.';
  if (plan.mode === 'hosts') return `Carried by ${plan.hosts.length} ${plan.hosts.length === 1 ? 'computer' : 'computers'} in the call, about ${plan.limit} people at most. Media is encrypted so those computers cannot see or hear it.`;
  if (plan.mode === 'livekit') return 'Carried by the media server.';
  return plan.message;
}
