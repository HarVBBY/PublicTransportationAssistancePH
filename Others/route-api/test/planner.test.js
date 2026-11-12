'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePlanner, J1, J1b, B1, T1 } = require('./helpers');
const { PlanError } = require('../src/planner');

const NOON = '2026-11-10T12:00'; // a Tuesday, midday (Manila time)
const rides = (it) => it.legs.filter((l) => l.type === 'ride');
const nonWalk = (res) => res.itineraries.filter((i) => !i.tags.includes('walk-only'));

// west end of J1 -> east end of J1, both ~55 m off the road
const WEST = { lat: 14.6505, lng: 120.9625 };
const EAST = { lat: 14.6505, lng: 121.0175 };

test('a single jeepney ride: boards near the origin, alights near the destination, exact fare', () => {
  const { planner, fares } = makePlanner([J1()]);
  const res = planner.plan({ from: WEST, to: EAST, when: NOON });
  const it = nonWalk(res)[0];
  assert.equal(it.transfers, 0);
  assert.equal(rides(it).length, 1);
  const ride = rides(it)[0];
  assert.equal(ride.mode, 'jeepney');
  assert.equal(ride.line.id, 'J1');
  assert.ok(ride.distM > 5500 && ride.distM <= 6300, `ride distance ${ride.distM}`);
  assert.equal(it.fare.regular, fares.regular('puj_traditional', { distM: ride.distM }));
  assert.ok(it.fare.regular >= 17 && it.fare.regular <= 20);
  assert.ok(it.tags.includes('recommended'));
  assert.ok(it.walkM < 300);
  assert.ok(it.steps.length >= 3 && it.steps.at(-1).type === 'arrive');
});

test('a transfer between two crossing lines adds up the fares of both rides', () => {
  const { planner } = makePlanner([J1(), B1()]);
  const res = planner.plan({ from: { lat: 14.6505, lng: 120.9625 }, to: { lat: 14.6785, lng: 120.9905 }, when: NOON, modes: ['jeepney', 'bus'] });
  const it = nonWalk(res)[0];
  assert.equal(it.transfers, 1);
  assert.deepEqual(rides(it).map((r) => r.mode), ['jeepney', 'bus']);
  const sum = rides(it).reduce((s, r) => s + r.fare.regular, 0);
  assert.equal(it.fare.regular, sum);
  assert.ok(it.steps.some((s) => /Transfer|Walk/.test(s.text)));
});

test('restricting the transport types removes lines that are not allowed', () => {
  const { planner } = makePlanner([J1()]);
  assert.throws(() => planner.plan({ from: WEST, to: EAST, when: NOON, modes: ['bus'] }), (e) => e instanceof PlanError && e.code === 'NO_ROUTE');
  assert.throws(() => planner.plan({ from: WEST, to: EAST, modes: ['spaceship'] }), (e) => e.code === 'NO_MODES');
  assert.ok(planner.plan({ from: WEST, to: EAST, when: NOON, modes: [] }).itineraries.length > 0); // empty list => all types
});

test('points outside the coverage area are rejected with a clear error', () => {
  const { planner } = makePlanner([J1()]);
  assert.throws(() => planner.plan({ from: { lat: 15.9, lng: 120.9 }, to: EAST }), (e) => e.code === 'OUT_OF_AREA');
  assert.throws(() => planner.plan({ from: { lat: 'x', lng: 1 }, to: EAST }), (e) => e.code === 'BAD_POINT');
});

test('student / senior / PWD pay the discounted fare', () => {
  const { planner } = makePlanner([J1()]);
  const reg = nonWalk(planner.plan({ from: WEST, to: EAST, when: NOON }))[0];
  const stu = nonWalk(planner.plan({ from: WEST, to: EAST, when: NOON, passenger: 'student' }))[0];
  assert.equal(stu.fare.regular, reg.fare.regular);
  assert.ok(stu.fare.payable < reg.fare.payable);
  assert.ok(Math.abs(stu.fare.payable - reg.fare.regular * 0.8) <= 0.25 + 1e-9);
});

test('rush hour makes road trips slower than late at night', () => {
  const { planner } = makePlanner([J1()]);
  const peak = nonWalk(planner.plan({ from: WEST, to: EAST, when: '2026-11-10T08:00' }))[0];
  const night = nonWalk(planner.plan({ from: WEST, to: EAST, when: '2026-11-10T22:00' }))[0];
  assert.ok(rides(peak)[0].rideMin > rides(night)[0].rideMin * 1.5);
  assert.ok(peak.warnings.some((w) => /rush-hour/.test(w)));
  assert.equal(planner.plan({ from: WEST, to: EAST, when: '2026-11-10T08:00' }).query.period, 'amPeak');
  assert.equal(planner.plan({ from: WEST, to: EAST, when: '2026-11-14T08:00' }).query.period, 'weekend');
});

test('tricycle feeds riders who are too far from the road to walk', () => {
  const { planner } = makePlanner([J1()]);
  const far = { lat: 14.6650, lng: 120.9900 }; // ~1.6 km north of the jeepney line
  assert.throws(() => planner.plan({ from: far, to: EAST, when: NOON, modes: ['jeepney'] }), (e) => e.code === 'NO_ROUTE');
  const res = planner.plan({ from: far, to: EAST, when: NOON, modes: ['jeepney', 'tricycle'] });
  const it = nonWalk(res)[0];
  assert.equal(it.legs[0].type, 'tricycle');
  assert.equal(it.legs[0].role, 'access');
  assert.ok(it.legs[0].fare.regular >= 10);
  assert.ok(it.steps[0].text.includes('tricycle'));
  assert.equal(it.transfers, 1); // tricycle -> jeepney counts as a change of vehicle
});

test('jeepneys that follow the same road are merged into one option and listed as alternatives', () => {
  const { planner } = makePlanner([J1(), J1b()]);
  const res = planner.plan({ from: WEST, to: EAST, when: NOON });
  const options = nonWalk(res);
  assert.equal(options.length, 1, 'two signboards on the same road must not appear as two different trips');
  const ride = rides(options[0])[0];
  assert.equal(ride.alsoLines.length, 1);
  assert.ok(['J1', 'J1b'].includes(ride.line.id) && ride.alsoLines[0].id !== ride.line.id);
  assert.ok(options[0].steps.some((s) => (s.tips || []).some((t) => /also go the same way/.test(t))));
});

test('train: boards and alights at stations only, fare comes from the station count', () => {
  const { planner, fares } = makePlanner([T1()]);
  // near station "Two" (0.2) to near station "Five" (0.8)
  const stationTwo = { lat: 14.6602, lng: 120.960 + 0.07 * 0.2 + 0.0003 };
  const stationFive = { lat: 14.6602, lng: 120.960 + 0.07 * 0.8 - 0.0003 };
  const res = planner.plan({ from: stationTwo, to: stationFive, when: NOON });
  const it = nonWalk(res)[0];
  const ride = rides(it)[0];
  assert.equal(ride.mode, 'train');
  assert.equal(ride.hops, 3);
  assert.equal(ride.board.name, 'Two');
  assert.equal(ride.alight.name, 'Five');
  assert.equal(ride.fare.regular, fares.regular('lrt1', { hops: 3, stations: 6 }));
  assert.deepEqual(ride.stationsList, ['Three', 'Four']);
  assert.ok(it.steps[0].text.includes('Beep') || it.steps[1].text.includes('Beep'));
});

test('very short trips offer walking, and walking is never badged fastest or cheapest', () => {
  const { planner } = makePlanner([J1()]);
  const res = planner.plan({ from: { lat: 14.6505, lng: 120.9800 }, to: { lat: 14.6505, lng: 120.9850 }, when: NOON });
  const walk = res.itineraries.find((i) => i.tags.includes('walk-only'));
  assert.ok(walk);
  assert.equal(walk.fare.regular, 0);
  assert.deepEqual(walk.tags, ['walk-only']);
});

test('every option reports consistent totals', () => {
  const { planner } = makePlanner([J1(), B1(), T1()]);
  const res = planner.plan({ from: { lat: 14.6505, lng: 120.9625 }, to: { lat: 14.6785, lng: 120.9905 }, when: NOON });
  assert.ok(res.itineraries.length >= 1);
  for (const it of res.itineraries) {
    const minutes = it.legs.reduce((s, l) => s + l.minutes, 0);
    assert.ok(Math.abs(minutes - it.totalMin) <= 1, `${it.id}: legs sum ${minutes} vs ${it.totalMin}`);
    const fare = it.legs.reduce((s, l) => s + l.fare.regular, 0);
    assert.equal(it.fare.regular, fare);
    assert.ok(new Date(it.arrive) > new Date(it.depart));
    assert.ok(it.steps.length > 0 && it.steps.every((s, i) => s.n === i + 1));
  }
});
