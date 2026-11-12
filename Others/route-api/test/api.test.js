'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePlanner, J1, B1, T1, modesConfig, faresConfig } = require('./helpers');
const { createApp } = require('../src/app');
const { Places } = require('../src/places');

const PLACES = new Places([
  { n: 'West End Market', t: 'marketplace', lat: 14.6505, lng: 120.9625, c: 'Caloocan', a: ['WEM'] },
  { n: 'East End Mall', t: 'mall', lat: 14.6505, lng: 121.0175, c: 'Caloocan' },
]);

let server, base;
test.before(async () => {
  const { planner, network, fares } = makePlanner([J1(), B1(), T1()], { places: PLACES });
  const app = createApp({ planner, network, fares, places: PLACES, areas: null, modesConfig, faresConfig, legacyRoutes: true });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

const get = (p, opts) => fetch(base + p, opts);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('health and config describe the data and the transport modes', async () => {
  const h = await (await get('/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.network.lines, 3);
  const c = await (await get('/api/config')).json();
  assert.ok(c.modes.jeepney && c.modes.train && c.modes.tricycle);
  assert.deepEqual(c.cities, ['Caloocan', 'Malabon', 'Navotas', 'Valenzuela']);
  assert.equal(c.faresAsOf, faresConfig.asOf);
  assert.ok(c.passengerTypes.includes('senior'));
});

test('place search and map-point description', async () => {
  const s = await (await get('/api/places/search?q=wem')).json();
  assert.equal(s.results[0].name, 'West End Market');
  const d = await (await get('/api/places/describe?lat=14.6505&lng=121.0175')).json();
  assert.match(d.label, /East End Mall/);
  assert.equal((await get('/api/places/describe?lat=abc')).status, 400);
});

test('POST /api/plan returns itineraries with steps', async () => {
  const r = await post('/api/plan', { from: { lat: 14.6505, lng: 120.9625, name: 'West End Market' }, to: { lat: 14.6505, lng: 121.0175, name: 'East End Mall' }, when: '2026-11-10T12:00', passenger: 'senior' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.itineraries.length >= 1);
  const it = j.itineraries.find((i) => !i.tags.includes('walk-only'));
  assert.ok(it.fare.payable < it.fare.regular);
  assert.match(it.steps.map((s) => s.text).join(' '), /East End Mall/);
  assert.equal(j.query.passenger, 'senior');
  assert.ok(it.legs.find((l) => l.type === 'ride').geometry.length >= 2);
});

test('GET /api/plan works as a shareable URL', async () => {
  const r = await get('/api/plan?from=14.6505,120.9625&to=14.6505,121.0175&when=2026-11-10T12:00&modes=jeepney');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).itineraries.length >= 1);
});

test('bad input produces clear 4xx errors, never a crash', async () => {
  let r = await post('/api/plan', {});
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'BAD_POINT');
  r = await post('/api/plan', { from: { lat: 20, lng: 100 }, to: { lat: 14.65, lng: 121 } });
  assert.equal((await r.json()).code, 'OUT_OF_AREA');
  r = await post('/api/plan', { from: { lat: 14.6505, lng: 120.9625 }, to: { lat: 14.6505, lng: 121.0175 }, modes: ['bus'] });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'NO_ROUTE');
  r = await fetch(base + '/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(r.status, 400);
  assert.equal((await get('/api/nope')).status, 404);
});

test('nearby lines and the network overlay', async () => {
  const n = await (await get('/api/nearby?lat=14.6505&lng=120.99&r=300')).json();
  assert.ok(n.lines.some((l) => l.id === 'J1'));
  assert.ok(n.lines.every((l) => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'].includes(l.heading)));
  const g = await (await get('/api/network/lines?modes=jeepney,bus,train')).json();
  assert.equal(g.type, 'FeatureCollection');
  assert.equal(g.features.length, 3);
  assert.ok(g.features.every((f) => f.geometry.type === 'LineString' && f.properties.colour));
});

test('the original hand-drawn routes are still served - from a JSON file, no database needed', async () => {
  const list = await (await get('/api/routes')).json();
  assert.equal(list.length, 6);
  assert.deepEqual(list.map((r) => r.id).sort(), ['mcuue1', 'uemcu1', 'uesmgc1', 'uesmgc2', 'uevictory1', 'victoryue1']);
  assert.ok(list.every((r) => r.name && 'via' in r));

  const r = await (await get('/api/routes/uesmgc1')).json();
  assert.equal(r.id, 'uesmgc1');
  assert.equal(r.segments.length, 3);
  assert.ok(r.segments.every((s) => s.color && s.description && s.coordinates.length >= 2 && s.coordinates.every(([lng, lat]) => typeof lng === 'number' && typeof lat === 'number')));
  assert.equal(r.instructions.length, 5);

  assert.equal((await get('/api/routes/nope')).status, 404);
  assert.equal((await get('/api/routes/__proto__')).status, 404); // ids are looked up in a Map, never as object keys
});

test('the website is served, but source code, data and secrets are not', async () => {
  for (const page of ['/PUBTASYSTEM.html', '/dashboard.html']) assert.equal((await get(page)).status, 200, page);
  assert.equal((await get('/Others/CSS/PUBTA-2.css')).status, 200);
  for (const secret of ['/.env', '/Others/route-api/.env', '/Others/route-api/server.js', '/Others/route-api/data/network.json', '/Others/route-api/package.json', '/Others/route-api/src/planner.js', '/Others/../.git/config']) {
    assert.equal((await get(secret)).status, 404, `${secret} must not be public`);
  }
  assert.equal((await get('/', { redirect: 'manual' })).status, 302);
});
