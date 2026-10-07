// The room planner decides how media flows. Pure function, so every case is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoom, topologyFor, hops, hostEligible } from '../../server/room/plan.mjs';

const browser = (i, extra = {}) => ({ peer: `p_${String(i).padStart(3, '0')}`, kind: 'browser', participantId: `pt_${i}`, name: `Person ${i}`, role: 'member', joinedAt: i, ...extra });
const host = (i, m = {}) => ({ peer: `h_${i}`, kind: 'host', client: 'cli', joinedAt: 0, metrics: { warm: true, uploadMbps: 40, cpuLoad: 0.1, jitterMs: 3, plugged: true, ...m } });
const people = (n) => Array.from({ length: n }, (_, i) => browser(i + 1));

test('up to 4 people talk directly', () => {
  for (const n of [1, 2, 3, 4]) {
    const p = planRoom({ peers: people(n) });
    assert.equal(p.mode, 'p2p');
    assert.equal(p.p2p.length, n);
    assert.equal(p.message, null);
  }
});

test('a fifth person with nothing to carry the call is told why, in plain words', () => {
  const p = planRoom({ peers: people(5) });
  assert.equal(p.mode, 'capped');
  assert.deepEqual(p.capped, ['p_005']);
  assert.match(p.message, /Help carry this call/);
});

test('with LiveKit configured, a big call goes to the media server', () => {
  assert.equal(planRoom({ peers: people(6), livekit: true }).mode, 'livekit');
});

test('a ready participant host carries a call of 5', () => {
  const p = planRoom({ peers: [...people(5), host(1)] });
  assert.equal(p.mode, 'hosts');
  assert.equal(p.hosts.length, 1);
  for (const b of people(5)) assert.equal(p.assign[b.peer].primary, 'h_1');
});

test('small calls stay direct even when a host is offered', () => {
  assert.equal(planRoom({ peers: [...people(3), host(1)] }).mode, 'p2p');
});

test('hosts that are not ready are not used, and say why', () => {
  assert.equal(hostEligible(host(1, { warm: false })).why, 'still measuring the connection');
  assert.equal(hostEligible(host(1, { plugged: false })).why, 'on battery');
  assert.match(hostEligible(host(1, { uploadMbps: 2 })).why, /upload under/);
  assert.equal(hostEligible({ ...host(1), client: 'browser' }).ok, false);
  const p = planRoom({ peers: [...people(5), host(1, { uploadMbps: 1 })] });
  assert.equal(p.mode, 'capped');
});

test('two hosts: everyone gets a primary and a warm standby on the other host', () => {
  const p = planRoom({ peers: [...people(6), host(1), host(2)] });
  assert.equal(p.mode, 'hosts');
  assert.equal(p.hosts.length, 2);
  assert.deepEqual(p.links, [['h_1', 'h_2']]);
  for (const b of people(6)) {
    const a = p.assign[b.peer];
    assert.ok(a.primary && a.standby && a.primary !== a.standby);
  }
  const loads = p.hosts.map((h) => h.load);
  assert.ok(Math.abs(loads[0] - loads[1]) <= 1, 'load is spread');
});

test('when a host leaves, its people move to the host that was their standby', () => {
  const peers = [...people(6), host(1), host(2)];
  const p1 = planRoom({ peers });
  const p2 = planRoom({ peers: peers.filter((x) => x.peer !== 'h_1'), prev: p1 });
  for (const b of people(6)) assert.equal(p2.assign[b.peer].primary, 'h_2');
});

test('a draining host hands its people over before it goes', () => {
  const peers = [...people(6), host(1), host(2), host(3)];
  const p1 = planRoom({ peers });
  const drained = peers.map((x) => (x.peer === p1.hosts[0].peer ? { ...x, draining: true } : x));
  const p2 = planRoom({ peers: drained, prev: p1 });
  assert.ok(!p2.hosts.some((h) => h.peer === p1.hosts[0].peer));
  for (const b of people(6)) assert.notEqual(p2.assign[b.peer].primary, p1.hosts[0].peer);
});

test('hosts are sticky: a new, faster host does not reshuffle a working call', () => {
  const peers = [...people(6), host(1), host(2)];
  const p1 = planRoom({ peers });
  const p2 = planRoom({ peers: [...peers, host(3, { uploadMbps: 400 })], prev: p1 });
  for (const b of people(6)) assert.equal(p2.assign[b.peer].primary, p1.assign[b.peer].primary);
});

test('up to 5 hosts link in a full mesh; beyond that a star, never more than 2 hops', () => {
  const five = Array.from({ length: 5 }, (_, i) => host(i + 1));
  const m = topologyFor(five);
  assert.equal(m.topology, 'mesh');
  assert.equal(m.links.length, 10);
  const eight = Array.from({ length: 8 }, (_, i) => host(i + 1));
  const s = topologyFor(eight);
  assert.equal(s.topology, 'star');
  assert.equal(s.links.length, 7);
  for (const a of eight) for (const b of eight) assert.ok(hops(s, a.peer, b.peer) <= 2);
});

test('a big call grows the number of hosts with the number of people', () => {
  const hosts = Array.from({ length: 8 }, (_, i) => host(i + 1, { uploadMbps: 20 }));
  const small = planRoom({ peers: [...people(6), ...hosts] });
  const big = planRoom({ peers: [...people(40), ...hosts] });
  assert.ok(big.hosts.length > small.hosts.length);
  assert.ok(big.limit >= 40);
  assert.equal(big.capped.length, 0);
});

test('a host far from the others is left out, so no path is too slow', () => {
  const far = host(3, { rtt: { h_1: 600, h_2: 600 } });
  const p = planRoom({ peers: [...people(30), host(1, { uploadMbps: 20 }), host(2, { uploadMbps: 20 }), far] });
  assert.ok(!p.hosts.some((h) => h.peer === 'h_3'));
});

test('webinar: viewers cost less, so the same hosts carry more people', () => {
  const hosts = [host(1, { uploadMbps: 20 }), host(2, { uploadMbps: 20 })];
  const meeting = planRoom({ peers: [...people(10), ...hosts] });
  const viewers = people(10).map((b, i) => (i < 2 ? { ...b, role: 'speaker' } : { ...b, role: 'viewer' }));
  const webinar = planRoom({ meeting: { kind: 'webinar' }, peers: [...viewers, ...hosts] });
  assert.ok(webinar.limit > meeting.limit);
});

test('the meeting can be forced to one way', () => {
  assert.equal(planRoom({ meeting: { media_pref: 'p2p' }, peers: [...people(5), host(1)] }).mode, 'capped');
  assert.equal(planRoom({ meeting: { media_pref: 'livekit' }, peers: people(2), livekit: true }).mode, 'livekit');
});
