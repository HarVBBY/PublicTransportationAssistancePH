'use strict';
/** The planner on a synthetic road map: walking and tricycle legs follow streets and the numbers follow the real distance. */
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');
const { Roads } = require('../src/roads');
const { buildGraph } = require('../scripts/lib/road-graph');
const { makePlanner, J1, B1 } = require('./helpers');

const way = (i, t, pts) => ({ i, t, n: pts.map((p) => p[2]), g: pts.flatMap((p) => [p[0], p[1]]) });
const roadsOf = (ways) => new Roads(buildGraph(ways, { minComponent: 1 }).data);
const NOON = '2026-11-10T12:00';
const legsOf = (res) => res.itineraries.find((i) => !i.tags.includes('walk-only')).legs;
const onRoads = (pts, tests) => pts.every(([lng, lat]) => tests.some((f) => f(lng, lat)));

// J1 runs along lat 14.650 (Main Street). A side street joins it at lng 120.970.
const SIDE_STREET_TOWN = () => [
  way(1, { highway: 'secondary', name: 'Main Street' }, [[14.650, 120.950, 100], [14.650, 120.970, 41], [14.650, 121.030, 101]]),
  way(2, { highway: 'residential', name: 'Side Street' }, [[14.653, 120.970, 40], [14.650, 120.970, 41]]),
];

test('the walk to the stop follows the side street and the main road, not a diagonal', () => {
  const roads = roadsOf(SIDE_STREET_TOWN());
  const { planner } = makePlanner([J1()], { roads });
  const res = planner.plan({ from: { lat: 14.6530, lng: 120.9700, name: 'Home' }, to: { lat: 14.6500, lng: 121.0100, name: 'Mall' }, when: NOON });
  const walk = legsOf(res)[0];
  assert.equal(walk.type, 'walk');
  assert.equal(walk.approximate, false);
  assert.ok(walk.geometry.length > 2, 'more than a straight segment');
  assert.ok(onRoads(walk.geometry, [(lng) => Math.abs(lng - 120.970) < 3e-5, (lng, lat) => Math.abs(lat - 14.650) < 3e-5]), 'every point lies on one of the two streets');
  assert.ok(walk.roadNames.includes('Side Street'));
  const straight = geo.haversine(14.6530, 120.9700, walk.to.lat, walk.to.lng);
  assert.ok(walk.distM >= straight, 'a road path is never shorter than the straight line');
  assert.match(res.itineraries[0].steps[0].text, /along Side Street/);
});

test('without a road map the same trip still works (straight line x detour, flagged approximate)', () => {
  const { planner } = makePlanner([J1()]);
  const res = planner.plan({ from: { lat: 14.6530, lng: 120.9700 }, to: { lat: 14.6500, lng: 121.0100 }, when: NOON });
  const walk = legsOf(res)[0];
  assert.equal(walk.approximate, true);
  assert.equal(walk.geometry.length, 2);
});

// A river: the origin is on "Bank Road", 445 m north of Main Street as the crow flies, but the only way across is
// the bridge ("Link Road") 645 m to the east.
const RIVER_TOWN = () => [
  way(1, { highway: 'secondary', name: 'Main Street' }, [[14.650, 120.950, 100], [14.650, 120.976, 30], [14.650, 121.030, 101]]),
  way(2, { highway: 'residential', name: 'Link Road' }, [[14.654, 120.976, 31], [14.650, 120.976, 30]]),
  way(3, { highway: 'residential', name: 'Bank Road' }, [[14.654, 120.969, 32], [14.654, 120.976, 31]]),
];

test('a stop across the river is not "close": the walk goes over the bridge', () => {
  const roads = roadsOf(RIVER_TOWN());
  const req = { from: { lat: 14.6540, lng: 120.9700, name: 'North Bank' }, to: { lat: 14.6500, lng: 121.0100, name: 'Mall' }, when: NOON, maxWalkM: 1600, modes: ['jeepney'] };
  const withRoads = legsOf(makePlanner([J1()], { roads }).planner.plan(req))[0];
  const straightOnly = legsOf(makePlanner([J1()]).planner.plan(req))[0];
  assert.equal(withRoads.type, 'walk');
  assert.ok(withRoads.distM > 1000, `the real walk is ${withRoads.distM} m`);
  assert.ok(withRoads.geometry.some(([lng, lat]) => Math.abs(lng - 120.976) < 3e-5 && Math.abs(lat - 14.654) < 3e-5), 'passes the bridge approach');
  assert.ok(straightOnly.distM < 700, `the straight-line guess is ${straightOnly.distM} m`);
  // with the usual 900 m limit nothing is reachable on foot any more - an honest "no route", not a fantasy short walk
  assert.throws(() => makePlanner([J1()], { roads }).planner.plan({ ...req, maxWalkM: 900 }), { code: 'NO_ROUTE' });
});

// One block with a one-way street: tricycles must go round, walkers need not
const BLOCK = [[14.650, 120.980, 1], [14.650, 120.983, 2], [14.652, 120.983, 3], [14.652, 120.980, 4]];
const BLOCK_TOWN = () => [
  way(10, { highway: 'residential', name: 'South Street', oneway: 'yes' }, [BLOCK[0], BLOCK[1]]),
  way(11, { highway: 'residential', name: 'East Street' }, [BLOCK[1], BLOCK[2]]),
  way(12, { highway: 'residential', name: 'North Street' }, [BLOCK[2], BLOCK[3]]),
  way(13, { highway: 'residential', name: 'West Street' }, [BLOCK[3], BLOCK[0]]),
];

test('a tricycle obeys one-way streets and its fare follows the distance it really drives', () => {
  const roads = roadsOf(BLOCK_TOWN());
  const withRoads = makePlanner([J1()], { roads }).planner;
  const plain = makePlanner([J1()]).planner;
  const a = { lat: 14.650, lng: 120.983 }, b = { lat: 14.650, lng: 120.980 }; // 323 m apart, but South Street only runs the other way
  const ctx = withRoads._context({ from: a, to: b, when: NOON });
  const trike = withRoads._trikeLeg(ctx, a, b, 'Caloocan', 'egress');
  assert.equal(trike.approximate, false);
  assert.ok(Math.abs(trike.distM - 768) < 8, `drives ${trike.distM} m`);
  assert.deepEqual(trike.roadNames, ['East Street', 'North Street', 'West Street']);
  const guess = plain._trikeLeg(plain._context({ from: a, to: b, when: NOON }), a, b, 'Caloocan', 'egress');
  assert.ok(trike.distM > guess.distM * 1.5, 'much longer than the straight-line guess');
  assert.ok(trike.fare.regular >= guess.fare.regular);
  const walk = withRoads._walkLeg(ctx, a, b, 'to-destination');
  assert.ok(Math.abs(walk.distM - 323) < 5, `walks ${walk.distM} m`);
});

// J1 (east-west, lat 14.650) and B1 (north-south, lng 120.990) cross at (14.650, 120.990).
const CROSSING = (connected) => [
  way(1, { highway: 'secondary', name: 'East-West Road' }, [[14.650, 120.955, 100], [14.650, 120.990, connected ? 50 : 51], [14.650, 121.010, 60], [14.650, 121.025, 101]]),
  way(2, { highway: 'secondary', name: 'North-South Road' }, [[14.635, 120.990, 102], [14.650, 120.990, connected ? 50 : 52], [14.680, 120.990, 62], [14.685, 120.990, 103]]),
];
const OVERPASS_LOOP = () => [ // the only link between the two streets is a long way round
  way(3, { highway: 'secondary', name: 'Ramp' }, [[14.650, 121.010, 60], [14.680, 121.010, 61]]),
  way(4, { highway: 'secondary', name: 'Link' }, [[14.680, 120.990, 62], [14.680, 121.010, 61]]),
];
const TRANSFER_TRIP = { from: { lat: 14.650, lng: 120.965, name: 'West' }, to: { lat: 14.672, lng: 120.990, name: 'North' }, when: NOON, modes: ['jeepney', 'bus'] };

test('a transfer where the two streets really meet is short', () => {
  const { planner } = makePlanner([J1(), B1()], { roads: roadsOf(CROSSING(true)) });
  const it = planner.plan(TRANSFER_TRIP).itineraries[0];
  assert.equal(it.legs.filter((l) => l.type === 'ride').length, 2);
  for (const l of it.legs.filter((x) => x.type === 'walk')) assert.ok(l.distM <= 250, `${l.role} walk of ${l.distM} m`);
});

test('a "transfer" between streets that cross without meeting (an overpass) is not offered as a short walk', () => {
  const lineup = () => [J1(), B1()];
  // no connection at all
  assert.throws(() => makePlanner(lineup(), { roads: roadsOf(CROSSING(false)) }).planner.plan(TRANSFER_TRIP), { code: 'NO_ROUTE' });
  // connected only by a loop several kilometres long
  assert.throws(() => makePlanner(lineup(), { roads: roadsOf([...CROSSING(false), ...OVERPASS_LOOP()]) }).planner.plan(TRANSFER_TRIP), { code: 'NO_ROUTE' });
  // for comparison, the straight-line planner happily offers it
  assert.ok(makePlanner(lineup()).planner.plan(TRANSFER_TRIP).itineraries.length >= 1);
});

test('every distance in a road-based itinerary adds up', () => {
  const roads = roadsOf(SIDE_STREET_TOWN());
  const { planner } = makePlanner([J1()], { roads });
  const res = planner.plan({ from: { lat: 14.6530, lng: 120.9700 }, to: { lat: 14.6520, lng: 121.0100 }, when: NOON });
  for (const it of res.itineraries) {
    assert.ok(Math.abs(it.legs.reduce((s, l) => s + l.minutes, 0) - it.totalMin) <= 1);
    for (const l of it.legs) {
      assert.ok(l.geometry.length >= 2);
      if (l.type === 'walk' && !l.approximate) { // (an approximate leg is a straight line scaled by the detour factor, by definition)
        let len = 0;
        for (let i = 1; i < l.geometry.length; i++) len += geo.haversine(l.geometry[i - 1][1], l.geometry[i - 1][0], l.geometry[i][1], l.geometry[i][0]);
        assert.ok(Math.abs(len - l.distM) <= 2, `drawn ${len} vs reported ${l.distM}`);
      }
    }
  }
});
