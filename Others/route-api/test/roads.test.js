'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');
const { Roads, encode, decode, FLAG } = require('../src/roads');
const { classify, buildGraph } = require('../scripts/lib/road-graph');

/** way(id, tags, [[lat, lng, nodeId], ...]) in the shape scripts/fetch-roads.js produces */
const way = (i, t, pts) => ({ i, t, n: pts.map((p) => p[2]), g: pts.flatMap((p) => [p[0], p[1]]) });
const build = (ways) => new Roads(buildGraph(ways, { minComponent: 1 }).data);

// A small block (~323 m x ~222 m):
//   P4 ---- N ---- P3
//    |  \          |
//    W     \ (footway)  E
//    |          \  |
//   P1 ==== S ===> P2        S is ONE-WAY eastbound
const P1 = [14.650, 120.980, 1], P2 = [14.650, 120.983, 2], P3 = [14.652, 120.983, 3], P4 = [14.652, 120.980, 4];
const TOWN = () => [
  way(10, { highway: 'residential', name: 'South Street', oneway: 'yes' }, [P1, P2]),
  way(11, { highway: 'residential', name: 'East Street' }, [P2, P3]),
  way(12, { highway: 'residential', name: 'North Street' }, [P3, P4]),
  way(13, { highway: 'residential', name: 'West Street' }, [P4, P1]),
  way(14, { highway: 'footway', name: 'Shortcut Path' }, [P2, P4]),
];
const at = (p) => ({ lat: p[0], lng: p[1] });

test('walking follows the streets, not the straight line', () => {
  // an L: 323 m east along one street, then 222 m north along another
  const roads = build([
    way(1, { highway: 'residential', name: 'First Street' }, [[14.650, 120.980, 1], [14.650, 120.983, 2]]),
    way(2, { highway: 'residential', name: 'Second Street' }, [[14.650, 120.983, 2], [14.652, 120.983, 3]]),
  ]);
  const a = { lat: 14.650, lng: 120.980 }, b = { lat: 14.652, lng: 120.983 };
  const r = roads.route('foot', a, b);
  const straight = geo.haversine(a.lat, a.lng, b.lat, b.lng);
  assert.ok(straight < 400);
  assert.ok(Math.abs(r.distM - 545) < 4, `distance ${r.distM}`);
  assert.deepEqual(r.segments.map((s) => s.name), ['First Street', 'Second Street']);
  assert.ok(r.geometry.some(([lng, lat]) => Math.abs(lng - 120.983) < 1e-6 && Math.abs(lat - 14.650) < 1e-6), 'the path must turn at the corner');
  assert.equal(r.offRoadM, 0);
});

test('one-way streets are obeyed by tricycles but not by walkers', () => {
  const roads = build(TOWN());
  const foot = roads.route('foot', at(P2), at(P1));
  const trike = roads.route('trike', at(P2), at(P1));
  assert.ok(Math.abs(foot.distM - 323) < 4, `foot ${foot.distM}`);
  assert.deepEqual(foot.segments.map((s) => s.name), ['South Street']);
  assert.ok(Math.abs(trike.distM - 768) < 6, `trike ${trike.distM}`); // East + North + West: it may not drive against the one-way
  assert.deepEqual(trike.segments.map((s) => s.name), ['East Street', 'North Street', 'West Street']);
  // going the legal way round is direct
  assert.ok(Math.abs(roads.route('trike', at(P1), at(P2)).distM - 323) < 4);
});

test('footpaths are for walkers only', () => {
  const roads = build(TOWN());
  const foot = roads.route('foot', at(P2), at(P4));
  const trike = roads.route('trike', at(P2), at(P4));
  assert.deepEqual(foot.segments.map((s) => s.name), ['Shortcut Path']);
  assert.ok(Math.abs(foot.distM - 392) < 4, `foot ${foot.distM}`);
  assert.deepEqual(trike.segments.map((s) => s.name), ['East Street', 'North Street']);
});

test('a point off the road is joined to it by a short hop that is counted', () => {
  const roads = build(TOWN());
  const off = { lat: 14.65027, lng: 120.9815 }; // ~30 m north of South Street
  const r = roads.route('foot', off, at(P2));
  assert.ok(r.offRoadM > 25 && r.offRoadM < 35, `hop ${r.offRoadM}`);
  assert.ok(Math.abs(r.distM - (30 + 161)) < 8, `distance ${r.distM}`);
});

test('two points on the same street are joined along it', () => {
  const roads = build(TOWN());
  const r = roads.route('foot', { lat: 14.650, lng: 120.981 }, { lat: 14.650, lng: 120.982 });
  assert.ok(Math.abs(r.distM - 107.6) < 2, `${r.distM}`);
  assert.equal(r.segments.length, 1);
});

test('no road nearby (or no connection) gives null so callers can fall back to a straight line', () => {
  const roads = build(TOWN());
  assert.equal(roads.route('foot', { lat: 14.70, lng: 121.05 }, at(P1)), null);
  // two separate islands
  const split = build([
    way(1, { highway: 'residential' }, [[14.650, 120.980, 1], [14.650, 120.983, 2]]),
    way(2, { highway: 'residential' }, [[14.660, 120.980, 3], [14.660, 120.983, 4]]),
  ]);
  assert.equal(split.route('foot', { lat: 14.650, lng: 120.981 }, { lat: 14.660, lng: 120.981 }, { maxSnapM: 150 }), null);
});

test('reach(): road distance to everything nearby, matching route()', () => {
  const roads = build(TOWN());
  const reach = roads.reach('foot', at(P1), 2000);
  const d = reach.distTo(P3[0], P3[1]);
  assert.ok(Math.abs(d - roads.route('foot', at(P1), at(P3)).cost) < 1, `${d}`);
  assert.ok(Math.abs(d - 545) < 6 || Math.abs(d - (392 + 222)) < 6 || d < 560, `${d}`);
  // a point with no road nearby is "unknown" (null); a point on a road that is too far away is Infinity
  assert.equal(reach.distTo(14.70, 121.05), null);
  assert.equal(roads.reach('foot', at(P1), 100).distTo(P3[0], P3[1]), Infinity);
});

test('the compact binary format round-trips', () => {
  const g = buildGraph(TOWN(), { minComponent: 1 }).data;
  const copy = new Roads(decode(encode(g)));
  const orig = new Roads(g);
  const a = orig.route('trike', at(P2), at(P1)), b = copy.route('trike', at(P2), at(P1));
  assert.equal(Math.round(a.distM), Math.round(b.distM));
  assert.deepEqual(a.segments, b.segments);
  assert.equal(copy.stats().edges, orig.stats().edges);
  assert.throws(() => decode(Buffer.from('not a graph file at all')), /not a PUBTA road graph/);
});

test('tiny disconnected islands are removed from the graph', () => {
  const ways = [
    way(1, { highway: 'residential' }, [[14.650, 120.980, 1], [14.650, 120.981, 2], [14.651, 120.981, 3], [14.651, 120.980, 4]]),
    way(2, { highway: 'residential' }, [[14.651, 120.980, 4], [14.650, 120.980, 1]]),
    way(4, { highway: 'residential' }, [[14.650, 120.980, 1], [14.650, 120.979, 5]]), // three junctions (1, 4, 5) in the main network
    way(3, { highway: 'service' }, [[14.700, 121.000, 90], [14.700, 121.001, 91]]), // an orphan stub (2 junctions)
  ];
  const { stats } = buildGraph(ways, { minComponent: 3 });
  assert.equal(stats.droppedNodes, 2);
  assert.equal(stats.nodes, 3);
});

test('OSM tag rules: who may use a road', () => {
  const can = (tags, flag) => { const c = classify(tags); return Boolean(c && (c.flags & flag)); };
  assert.equal(can({ highway: 'motorway' }, FLAG.FOOT), false, 'nobody walks on an expressway');
  assert.equal(can({ highway: 'motorway' }, FLAG.VEH), true);
  assert.equal(can({ highway: 'primary' }, FLAG.FOOT), true);
  assert.equal(can({ highway: 'footway' }, FLAG.TRIKE), false);
  assert.equal(can({ highway: 'steps' }, FLAG.TRIKE), false);
  assert.equal(can({ highway: 'service', service: 'driveway' }, FLAG.TRIKE), false);
  assert.equal(can({ highway: 'service', service: 'driveway' }, FLAG.FOOT), true);
  assert.equal(can({ highway: 'residential', access: 'private' }, FLAG.FOOT), false, 'a private compound');
  assert.equal(can({ highway: 'residential', access: 'private', foot: 'yes' }, FLAG.FOOT), true);
  assert.equal(can({ highway: 'residential', motor_vehicle: 'no' }, FLAG.TRIKE), false);
  assert.equal(can({ highway: 'residential', motor_vehicle: 'no' }, FLAG.FOOT), true);
  assert.equal(classify({ highway: 'pedestrian', area: 'yes' }), null);
  assert.equal(classify({ highway: 'proposed' }), null);
  assert.equal(classify({ highway: 'primary_link' }).cls, classify({ highway: 'primary' }).cls, 'a link is its parent class');
  assert.equal(classify({ highway: 'residential', oneway: 'yes' }).ow, 1);
  assert.equal(classify({ highway: 'residential', oneway: '-1' }).ow, -1);
  assert.equal(classify({ highway: 'residential', junction: 'roundabout' }).ow, 1);
  assert.equal(classify({ highway: 'residential', junction: 'roundabout', oneway: 'no' }).ow, 0);
  assert.equal(classify({ highway: 'motorway' }).ow, 1);
  assert.equal(classify({ highway: 'residential' }).name, null);
  assert.equal(classify({ highway: 'residential', ref: 'R-10' }).name, 'R-10');
});

test('a "oneway=-1" street runs against the order its nodes are listed in', () => {
  const roads = build([way(1, { highway: 'residential', oneway: '-1', name: 'Backwards Street' }, [[14.650, 120.980, 1], [14.650, 120.983, 2]])]);
  assert.equal(roads.route('trike', { lat: 14.650, lng: 120.980 }, { lat: 14.650, lng: 120.983 }), null, 'against the flow');
  assert.ok(roads.route('trike', { lat: 14.650, lng: 120.983 }, { lat: 14.650, lng: 120.980 }).distM > 300);
});
