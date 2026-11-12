'use strict';
/** Acceptance tests against the REAL compiled data (skipped if data/network.json has not been built). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const geo = require('../src/geo');
const { loadPlanner, DATA } = require('../src/bootstrap');
const { PlanError } = require('../src/planner');

const have = fs.existsSync(path.join(DATA, 'network.json'));
const opts = { skip: have ? false : 'data/network.json not built - run npm run data:build' };
const parts = have ? loadPlanner() : null;
const NOON = '2026-11-10T12:00';
const nonWalk = (res) => res.itineraries.filter((i) => !i.tags.includes('walk-only'));
const rides = (it) => it.legs.filter((l) => l.type === 'ride');

test('the network covers every kind of transport', opts, () => {
  const { byMode } = parts.network.stats();
  assert.ok(byMode.train >= 2, 'LRT/MRT');
  assert.ok(byMode.carousel >= 1, 'EDSA Carousel');
  assert.ok(byMode.bus >= 20, 'buses');
  assert.ok(byMode.uv >= 1, 'UV Express');
  assert.ok(byMode.jeepney >= 100, 'jeepneys');
});

test('every line is well formed and points to a known fare class', opts, () => {
  for (const L of parts.network.lines) {
    assert.ok(parts.fares.has(L.fareClass), `${L.id}: unknown fare class ${L.fareClass}`);
    assert.ok(L.pts.length >= 2 && L.length > 300, L.id);
    assert.ok(['high', 'medium', 'low'].includes(L.confidence), L.id);
    let last = -1;
    for (let n = L.nodeStart; n < L.nodeEnd; n++) {
      const d = parts.network.d[n];
      assert.ok(d >= last - 1e-6 && d <= L.length + 1, `${L.id}: node distances must increase along the line`);
      last = d;
    }
  }
});

test('LRT-1 has its stations, with Monumento among them', opts, () => {
  const lrt1 = parts.network.lines.find((l) => l.fareClass === 'lrt1');
  assert.ok(lrt1, 'LRT-1 line');
  assert.ok(lrt1.nodeEnd - lrt1.nodeStart >= 20);
  const names = [];
  for (let n = lrt1.nodeStart; n < lrt1.nodeEnd; n++) names.push(parts.network.name[n]);
  assert.ok(names.some((n) => /monumento/i.test(n || '')), `stations: ${names.join(', ')}`);
});

test('the original hand-surveyed example: UE Caloocan to SM Grand Central is one short jeepney ride along Samson Rd', opts, () => {
  const res = parts.planner.plan({ from: { lat: 14.65781, lng: 120.97616 }, to: { lat: 14.65508, lng: 120.98405 }, when: NOON });
  const best = nonWalk(res)[0];
  assert.ok(best, 'a transit option');
  assert.equal(best.transfers, 0);
  const ride = rides(best)[0];
  assert.equal(ride.mode, 'jeepney');
  assert.ok(ride.distM < 2500);
  assert.equal(best.fare.regular, 14);
  assert.ok(ride.roads.some((r) => /samson/i.test(r)) || /samson/i.test(ride.board.name || '') || /samson/i.test(ride.alight.name || ''), 'Samson Road should be mentioned');
});

test('a train trip along LRT-1 is planned with the matrix fare', opts, () => {
  const lrt1 = parts.network.lines.find((l) => l.fareClass === 'lrt1');
  const at = (re) => { for (let n = lrt1.nodeStart; n < lrt1.nodeEnd; n++) if (re.test(parts.network.name[n] || '')) return { lat: parts.network.lat[n], lng: parts.network.lng[n] }; return null; };
  const a = at(/monumento/i), b = at(/central terminal/i);
  assert.ok(a && b);
  const res = parts.planner.plan({ from: a, to: b, when: NOON, modes: ['train'] });
  const it = nonWalk(res)[0];
  const ride = rides(it)[0];
  assert.equal(ride.mode, 'train');
  assert.ok(ride.hops >= 5);
  assert.ok(it.fare.regular >= 20 && it.fare.regular <= 55, `fare ${it.fare.regular}`);
  assert.equal(parts.planner.plan({ from: a, to: b, when: NOON, modes: ['train'], passenger: 'student' }).itineraries[0].fare.payable <= it.fare.regular / 2 + 0.25, true);
});

test('fuzz: 40 random trips across CAMANAVA never crash and always report consistent numbers', opts, () => {
  let seed = 20261111;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pt = () => ({ lat: 14.62 + rnd() * 0.15, lng: 120.93 + rnd() * 0.12 });
  let planned = 0, noRoute = 0, slowest = 0;
  for (let i = 0; i < 40; i++) {
    const t0 = Date.now();
    try {
      const res = parts.planner.plan({ from: pt(), to: pt(), when: NOON, passenger: ['regular', 'student', 'senior', 'pwd'][i % 4] });
      planned++;
      for (const it of res.itineraries) {
        assert.ok(it.totalMin >= 1 && Number.isFinite(it.fare.regular) && it.fare.regular >= 0);
        assert.ok(it.fare.payable <= it.fare.regular + 1e-9);
        assert.ok(Math.abs(it.legs.reduce((s, l) => s + l.minutes, 0) - it.totalMin) <= 1);
        assert.ok(it.steps.length >= 1);
        for (const l of it.legs) assert.ok(l.geometry.length >= 2);
      }
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
      noRoute++;
    }
    slowest = Math.max(slowest, Date.now() - t0);
  }
  assert.ok(planned >= 25, `only ${planned} of 40 random trips could be planned (${noRoute} had no route)`);
  // Not a benchmark (test files run in parallel, so timings are noisy): alone the slowest trip takes ~1.5 s.
  // This only guards against a pathological slowdown, e.g. the search flooding the whole network.
  assert.ok(slowest < 12000, `slowest plan took ${slowest} ms`);
});

// ---------------------------------------------------------------- routes that follow roads (needs data/roads.bin.gz)
const roadOpts = { skip: have && parts.roads ? false : 'data/roads.bin.gz not built - run npm run data:roads' };

/** Share (0..1) of a polyline's length that lies within tolM of a road the vehicle profile can use, sampled every stepM. */
function shareOnRoads(pts, roads, profile, tolM = 20, stepM = 60) {
  const cum = geo.cumulative(pts);
  const total = cum[cum.length - 1];
  let on = 0, n = 0;
  for (let d = 0; d <= total; d += stepM) {
    const p = geo.pointAt(pts, cum, d);
    n++;
    if (roads.snap(profile, p[1], p[0], tolM)) on++;
  }
  return n ? on / n : 1;
}

test('the road map covers the four cities', roadOpts, () => {
  const s = parts.roads.stats();
  assert.ok(s.edges > 60000, `only ${s.edges} road pieces`);
  for (const [name, lat, lng] of [['Caloocan', 14.6578, 120.9762], ['Malabon', 14.6625, 120.9570], ['Navotas', 14.6667, 120.9417], ['Valenzuela', 14.7011, 120.9830]]) {
    assert.ok(parts.roads.snap('foot', lat, lng, 120), `${name} city centre is not near any walkable road`);
    assert.ok(parts.roads.snap('veh', lat, lng, 250), `${name} city centre is not near any road for vehicles`);
  }
});

test('route lines follow real roads (no more straight stop-to-stop lines across blocks)', roadOpts, () => {
  const by = { osm: [], 'dotc-gtfs': [] };
  for (const L of parts.network.lines) {
    if (L.mode === 'train' || !by[L.source]) continue;
    by[L.source].push(shareOnRoads(L.pts, parts.roads, 'veh', 25));
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(by.osm) >= 0.93, `OSM lines: ${(avg(by.osm) * 100).toFixed(1)}% on roads`);
  // the older jeepney data only had stops; matching them to roads is what makes them drawable
  assert.ok(avg(by['dotc-gtfs']) >= 0.85, `legacy jeepney lines: ${(avg(by['dotc-gtfs']) * 100).toFixed(1)}% on roads`);
});

test('the walking and tricycle legs of 40 random trips follow roads and their numbers are consistent', roadOpts, () => {
  let seed = 7771;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pt = () => ({ lat: 14.63 + rnd() * 0.15, lng: 120.94 + rnd() * 0.10 });
  let legs = 0, straightLegs = 0, checked = 0;
  for (let i = 0; i < 40; i++) {
    let res;
    try { res = parts.planner.plan({ from: pt(), to: pt(), when: NOON }); } catch (e) { if (e instanceof PlanError) continue; throw e; }
    for (const it of res.itineraries) {
      for (const l of it.legs) {
        if (l.type !== 'walk' && l.type !== 'tricycle') continue;
        legs++;
        if (l.approximate) { straightLegs++; continue; }
        checked++;
        let drawn = 0;
        for (let k = 1; k < l.geometry.length; k++) drawn += geo.haversine(l.geometry[k - 1][1], l.geometry[k - 1][0], l.geometry[k][1], l.geometry[k][0]);
        assert.ok(Math.abs(drawn - l.distM) <= 2, `${l.type} leg: drawn ${drawn.toFixed(0)} m but reported ${l.distM} m`);
        const straight = geo.haversine(l.from.lat, l.from.lng, l.to.lat, l.to.lng);
        assert.ok(l.distM >= straight - 2, `${l.type} leg shorter than the straight line`);
        // tricycle legs follow streets a tricycle may use; walking legs follow footways too
        const share = shareOnRoads(l.geometry.slice(1, -1).length >= 2 ? l.geometry.slice(1, -1) : l.geometry, parts.roads, l.type === 'walk' ? 'foot' : 'trike', 6, 15);
        assert.ok(share >= 0.9, `${l.type} leg is only ${(share * 100).toFixed(0)}% on roads`);
      }
      assert.ok(Math.abs(it.legs.reduce((s, l) => s + l.minutes, 0) - it.totalMin) <= 1);
    }
  }
  assert.ok(checked >= 40, `only ${checked} road legs were checked`);
  assert.ok(straightLegs <= legs * 0.25, `${straightLegs} of ${legs} walking/tricycle legs fell back to a straight line`);
});

test('no walking transfer is a long detour', roadOpts, () => {
  let seed = 99;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pt = () => ({ lat: 14.63 + rnd() * 0.15, lng: 120.94 + rnd() * 0.10 });
  for (let i = 0; i < 30; i++) {
    let res;
    try { res = parts.planner.plan({ from: pt(), to: pt(), when: NOON }); } catch (e) { if (e instanceof PlanError) continue; throw e; }
    for (const it of res.itineraries) for (const l of it.legs) {
      if (l.type === 'walk' && l.role === 'transfer') assert.ok(l.distM <= 1200, `a transfer of ${l.distM} m`);
    }
  }
});

test('the A* search is exact: for every preset it finds the same optimum as plain Dijkstra on 25 random real trips', opts, () => {
  const { Planner, PRESETS } = require('../src/planner');
  // Both planners run WITHOUT the road map: this tests the search algorithm itself.
  const base = { areas: parts.areas, places: parts.places, modesConfig: parts.modesConfig, bbox: parts.network.meta.bbox };
  const fast = new Planner(parts.network, parts.fares, base);
  const exact = new Planner(parts.network, parts.fares, { ...base, heuristic: false });
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pt = () => ({ lat: 14.62 + rnd() * 0.15, lng: 120.93 + rnd() * 0.12 });
  // Compare each preset's single best answer by its NUMBERS, not its line ids: many parallel jeepney lines run on
  // the very same roads, so equally good lines may be picked in either order (and then merged differently in the
  // final list of options) - but the best time / fare / transfers must be identical.
  const best = (planner, ctx, name) => {
    const chain = planner._search(ctx, PRESETS[name], null);
    if (!chain) return 'no route';
    const it = planner._build(ctx, chain);
    return `${it.totalMin}min|P${it.fare.regular}|${it.transfers}t|${it.legs.filter((l) => l.type === 'ride').length}r`;
  };
  let compared = 0;
  for (let i = 0; i < 25; i++) {
    const req = { from: pt(), to: pt(), when: NOON };
    let ca, ce;
    try { ca = fast._context(req); ce = exact._context(req); } catch (e) { if (e instanceof PlanError) continue; throw e; }
    for (const name of Object.keys(PRESETS)) {
      assert.equal(best(fast, ca, name), best(exact, ce, name), `trip ${i}, preset ${name}: A* and Dijkstra disagree`);
    }
    compared++;
  }
  assert.ok(compared >= 15, `only ${compared} comparable trips`);
});
