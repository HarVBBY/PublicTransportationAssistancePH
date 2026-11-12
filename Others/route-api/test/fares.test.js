'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FareEngine } = require('../src/fares');
const { faresConfig } = require('./helpers');

const f = new FareEngine(faresConfig);

test('traditional jeepney: minimum fare covers the first 4 km, then PHP 2.00 per km', () => {
  assert.equal(f.regular('puj_traditional', { distM: 500 }), 14);
  assert.equal(f.regular('puj_traditional', { distM: 4000 }), 14);
  assert.equal(f.regular('puj_traditional', { distM: 6000 }), 18);
  assert.equal(f.regular('puj_traditional', { distM: 10000 }), 26);
});

test('modern jeepney and buses use their own tables', () => {
  assert.equal(f.regular('puj_modern', { distM: 3000 }), 17);
  assert.equal(f.regular('bus_ordinary', { distM: 5000 }), 15);
  assert.equal(f.regular('bus_ordinary', { distM: 10000 }), Math.round(15 + 5 * 2.49));
  assert.equal(f.regular('bus_aircon', { distM: 5000 }), 18);
});

test('train fare scales from the minimum to the maximum across the stations of the line', () => {
  assert.equal(f.regular('lrt1', { hops: 1, stations: 25 }), 20);
  assert.equal(f.regular('lrt1', { hops: 24, stations: 25 }), 55);
  const mid = f.regular('lrt1', { hops: 12, stations: 25 });
  assert.ok(mid > 20 && mid < 55);
});

test('tricycle fares depend on the city and fall back to a default', () => {
  assert.equal(f.regular('tricycle', { distM: 1000, city: 'Valenzuela' }), 10);
  assert.equal(f.regular('tricycle', { distM: 3000, city: 'Valenzuela' }), 13);
  assert.equal(f.regular('tricycle', { distM: 1000, city: 'Malabon' }), 15);
  assert.equal(f.regular('tricycle', { distM: 1000, city: 'Nowhere' }), 15);
});

test('free rides cost nothing', () => assert.equal(f.regular('free', { distM: 9000 }), 0));

test('student / senior / PWD pay 20% less on road transport, 50% on trains', () => {
  assert.equal(f.discounted(14, 'puj_traditional', 'student'), 11.25); // 11.20 rounded to the nearest 25 centavos
  assert.equal(f.discounted(20, 'lrt1', 'senior'), 10);
  assert.equal(f.discounted(20, 'tricycle', 'pwd'), 20); // not guaranteed for tricycles
  assert.equal(f.discountRate('puj_traditional', 'regular'), 0);
});

test('every fare class declares how trustworthy it is', () => {
  for (const [name, c] of Object.entries(faresConfig.classes)) {
    const conf = c.confidence || (c.byCity ? 'estimate' : null);
    assert.ok(['official', 'reported', 'estimate'].includes(conf), `${name} needs a confidence`);
  }
});

test('the planner\'s fast fare closure always agrees with the reference calculation', () => {
  const samples = [{ distM: 300, hops: 1 }, { distM: 4000, hops: 3 }, { distM: 7300, hops: 6 }, { distM: 21000, hops: 19 }];
  for (const cls of ['puj_traditional', 'puj_modern', 'bus_ordinary', 'bus_aircon', 'uv_express', 'free', 'lrt1', 'mrt3']) {
    for (const passenger of ['regular', 'student', 'senior']) {
      const fn = f.searchFn(cls, passenger, 25);
      for (const s of samples) {
        const ref = f.searchFare(cls, { ...s, stations: 25 }, passenger);
        assert.ok(Math.abs(fn(s.distM, s.hops) - ref) < 1e-9, `${cls}/${passenger}/${s.distM}: ${fn(s.distM, s.hops)} vs ${ref}`);
      }
    }
  }
});
