'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');
const { Roads } = require('../src/roads');
const { buildGraph } = require('../scripts/lib/road-graph');
const { snapToRoads, fillGaps, alongMonotone } = require('../scripts/lib/road-match');

const way = (i, t, pts) => ({ i, t, n: pts.map((p) => p[2]), g: pts.flatMap((p) => [p[0], p[1]]) });
const roadsOf = (ways) => new Roads(buildGraph(ways, { minComponent: 1 }).data);
const len = (pts) => geo.cumulative(pts).at(-1);

// an "L": 323 m east along First Street, then 222 m north along Second Street
const L_TOWN = () => [
  way(1, { highway: 'secondary', name: 'First Street' }, [[14.650, 120.980, 1], [14.650, 120.983, 2]]),
  way(2, { highway: 'secondary', name: 'Second Street' }, [[14.650, 120.983, 2], [14.652, 120.983, 3]]),
];

test('a stops-only jeepney line is drawn along the streets, not cutting the corner', () => {
  const roads = roadsOf(L_TOWN());
  const stops = [[120.980, 14.650], [120.983, 14.650], [120.983, 14.652]]; // [lng, lat]
  const crow = len(stops);
  const m = snapToRoads(roads, [stops[0], stops[2]]); // just the two ends: a diagonal would be ~392 m
  assert.equal(m.matched, 1);
  assert.equal(m.straight, 0);
  assert.ok(Math.abs(len(m.pts) - 545) < 5, `drawn length ${len(m.pts)}`);
  assert.ok(m.pts.some(([lng, lat]) => Math.abs(lng - 120.983) < 1e-5 && Math.abs(lat - 14.650) < 1e-5), 'turns at the corner');
  assert.ok(Math.abs(crow - 545) < 5);
  assert.deepEqual(m.joins, [0, m.pts.length - 1], 'the first and last stop are the ends of the polyline');
});

test('where no road is found the straight piece is kept, never dropped', () => {
  const roads = roadsOf(L_TOWN());
  const m = snapToRoads(roads, [[120.980, 14.650], [120.983, 14.650], [121.10, 14.70]]); // the last stop is nowhere near a road
  assert.equal(m.matched, 1);
  assert.equal(m.straight, 1);
  assert.deepEqual(m.pts.at(-1), [121.10, 14.70]);
});

test('an implausible detour is rejected in favour of the straight piece', () => {
  // the only road between the two stops runs a long way round
  const roads = roadsOf([
    way(1, { highway: 'secondary' }, [[14.650, 120.980, 1], [14.650, 120.9801, 2]]),
    way(2, { highway: 'secondary' }, [[14.650, 120.9801, 2], [14.660, 120.9801, 3], [14.660, 120.9830, 4], [14.650, 120.9830, 5]]),
    way(3, { highway: 'secondary' }, [[14.650, 120.9830, 5], [14.650, 120.9832, 6]]),
  ]);
  const m = snapToRoads(roads, [[120.980, 14.650], [120.9832, 14.650]]);
  assert.equal(m.matched, 0);
  assert.equal(m.straight, 1);
});

test('one-way streets are respected when drawing a line', () => {
  const roads = roadsOf([
    way(1, { highway: 'secondary', name: 'Eastbound', oneway: 'yes' }, [[14.650, 120.980, 1], [14.650, 120.983, 2]]),
    way(2, { highway: 'secondary', name: 'Loop A' }, [[14.650, 120.983, 2], [14.652, 120.983, 3]]),
    way(3, { highway: 'secondary', name: 'Loop B' }, [[14.652, 120.983, 3], [14.652, 120.980, 4]]),
    way(4, { highway: 'secondary', name: 'Loop C' }, [[14.652, 120.980, 4], [14.650, 120.980, 1]]),
  ]);
  const east = snapToRoads(roads, [[120.980, 14.650], [120.983, 14.650]]);
  assert.ok(Math.abs(len(east.pts) - 323) < 5);
  assert.equal(east.matched, 1);
  // westbound, the only legal way is round the block (768 m for a 323 m hop): drawn when such a detour is allowed...
  const west = snapToRoads(roads, [[120.983, 14.650], [120.980, 14.650]], { ratio: 3 });
  assert.equal(west.matched, 1);
  assert.ok(Math.abs(len(west.pts) - 768) < 8, `${len(west.pts)}`);
  // ...and refused by default (more than 1.7x the straight distance is more likely a data error than a real route)
  assert.equal(snapToRoads(roads, [[120.983, 14.650], [120.980, 14.650]]).matched, 0);
});

test('gaps between OSM ways are bridged along the road', () => {
  const roads = roadsOf(L_TOWN());
  // two ways that stop ~35 m short of each other at the corner: the straight jump would cut across
  const run = { pts: [[120.980, 14.650], [120.9822, 14.650], [120.9830, 14.6504], [120.983, 14.652]], gaps: [{ at: 2, jumpM: 90 }] };
  const f = fillGaps(roads, run, { minJumpM: 12 });
  assert.equal(f.filled, 1);
  assert.ok(f.pts.length > run.pts.length);
  assert.ok(f.pts.some(([lng, lat]) => Math.abs(lng - 120.983) < 1e-5 && Math.abs(lat - 14.650) < 1e-5), 'goes through the corner');
  // a run without gaps is returned untouched
  assert.equal(fillGaps(roads, { pts: run.pts, gaps: [] }).pts, run.pts);
  // tiny jumps are left alone
  assert.equal(fillGaps(roads, { pts: run.pts, gaps: [{ at: 2, jumpM: 5 }] }).filled, 0);
});

test('positions along a line never go backwards, even where the line revisits a street', () => {
  // out along the street, round a loop and back along the same street
  const pts = [[120.980, 14.650], [120.983, 14.650], [120.983, 14.652], [120.980, 14.652], [120.980, 14.650], [120.983, 14.650]];
  const cum = geo.cumulative(pts);
  const marks = [[120.9815, 14.650], [120.9825, 14.652], [120.9815, 14.650]]; // the 1st and 3rd are the same place, a lap apart
  const a = alongMonotone(pts, cum, marks);
  assert.ok(a[0] < a[1] && a[1] < a[2], `${a}`);
  assert.ok(a[2] > cum[4], 'the second visit is on the second pass');
});
