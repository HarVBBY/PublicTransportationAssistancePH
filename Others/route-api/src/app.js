'use strict';
/**
 * The PUBTA web application: JSON API + the static website, in one Express app.
 *
 *   POST /api/plan            plan a trip (see README for the request/response shape)
 *   GET  /api/plan?from=lat,lng&to=lat,lng&...        same, as a shareable URL
 *   GET  /api/places/search   autocomplete for the From/To boxes
 *   GET  /api/places/describe label for a point picked on the map
 *   GET  /api/nearby          which lines can I ride near this point?
 *   GET  /api/network/lines   GeoJSON of the transit network (map overlay)
 *   GET  /api/config          modes, colours, fares info, coverage
 *   GET  /api/health          liveness + dataset sizes
 *   GET  /api/routes[/:id]    the original hand-drawn routes (legacy; from data/legacy-routes.json)
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const geo = require('./geo');
const { PlanError, ALL_MODES, PASSENGERS } = require('./planner');
const { TYPE_LABEL } = require('./places');
const legacy = require('./legacy');

const SITE_ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGES = new Set(['dashboard', 'features', 'about_us', 'PUBTASYSTEM']);
const STATIC_DIRS = ['CSS', 'IMAGES', 'JAVASCRIPT', 'vendor', 'video'];

const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
const parsePoint = (s) => {
  const m = String(s || '').split(',').map(Number);
  return m.length >= 2 && m.every(Number.isFinite) ? { lat: m[0], lng: m[1] } : null;
};

function createApp({ planner, network, fares, places, areas, roads = null, modesConfig, faresConfig, legacyRoutes = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 0);

  const origins = process.env.CORS_ORIGIN;
  app.use(cors({ origin: origins ? (origins === '*' ? '*' : origins.split(',')) : [/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/] }));
  app.use(express.json({ limit: '20kb' }));

  // ------------------------------------------------------------ API
  const api = express.Router();

  api.get('/health', (req, res) => {
    res.json({ ok: true, network: network.stats(), builtAt: network.meta.builtAt, places: places ? places.size : 0, faresAsOf: fares.asOf, roads: roads ? { ...roads.stats() } : null, legacyRoutes: legacyRoutes ? 'enabled' : 'disabled' });
  });

  api.get('/config', (req, res) => {
    res.json({
      bbox: network.meta.bbox,
      center: { lat: 14.6985, lng: 120.9807, zoom: 11.6 },
      cities: ['Caloocan', 'Malabon', 'Navotas', 'Valenzuela'],
      modes: Object.fromEntries(Object.entries(modesConfig.modes).map(([k, m]) => [k, { label: m.label, color: m.color, icon: m.icon || null }])),
      planning: modesConfig.planning,
      passengerTypes: PASSENGERS,
      selectableModes: ALL_MODES,
      faresAsOf: fares.asOf,
      fareClasses: Object.fromEntries(Object.entries(faresConfig.classes).map(([k, c]) => [k, { label: c.label, confidence: c.confidence || (c.byCity ? 'estimate' : null), source: c.source || null }])),
      discounts: faresConfig.discounts,
      sources: network.meta.sources,
      builtAt: network.meta.builtAt,
    });
  });

  api.get('/places/search', (req, res) => {
    if (!places) return res.status(503).json({ error: 'Place search is not available (data/places.json missing).' });
    const near = { lat: num(req.query.lat), lng: num(req.query.lng) };
    const results = places.search(String(req.query.q || ''), { lat: Number.isFinite(near.lat) ? near.lat : null, lng: Number.isFinite(near.lng) ? near.lng : null, limit: Math.min(15, Number(req.query.limit) || 8) });
    res.json({ results });
  });

  api.get('/places/describe', (req, res) => {
    const lat = num(req.query.lat), lng = num(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });
    const d = places ? places.describe(lat, lng) : { label: `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, city: null };
    res.json({ lat, lng, ...d });
  });

  api.get('/nearby', (req, res) => {
    const lat = num(req.query.lat), lng = num(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });
    const r = Math.min(1000, Math.max(100, num(req.query.r) || 400));
    const best = new Map();
    for (const { node, distM } of network.nodesNear(lat, lng, r)) {
      const li = network.line[node];
      if (!best.has(li)) best.set(li, { node, distM });
    }
    const items = [...best.entries()].map(([li, { node, distM }]) => {
      const L = network.lines[li];
      const heading = geo.compass(geo.bearing(network.lat[node], network.lng[node], ...(() => { const p = geo.pointAt(L.pts, L.cum, Math.min(L.length, network.d[node] + 150)); return [p[1], p[0]]; })()));
      return { id: L.id, mode: L.mode, ref: L.ref, name: L.name, from: L.from, to: L.to, confidence: L.confidence, source: L.source, distM: Math.round(distM), heading, boardAt: { lat: network.lat[node], lng: network.lng[node], name: network.nodeLabel(node) } };
    }).sort((a, b) => a.distM - b.distM).slice(0, 40);
    res.json({ r, count: items.length, lines: items });
  });

  // network overlay for the map (cached per query)
  const overlayCache = new Map();
  api.get('/network/lines', (req, res) => {
    const modes = new Set(String(req.query.modes || 'train,carousel,bus,uv,jeepney').split(',').filter(Boolean));
    const includeLegacy = req.query.legacy === '1';
    const key = `${[...modes].sort().join(',')}|${includeLegacy}`;
    let body = overlayCache.get(key);
    if (!body) {
      const features = [];
      for (const L of network.lines) {
        if (!modes.has(L.mode)) continue;
        if (!includeLegacy && L.source === 'dotc-gtfs') continue;
        if (!L._overview) L._overview = geo.simplify(L.pts, 12);
        features.push({ type: 'Feature', properties: { id: L.id, mode: L.mode, ref: L.ref, name: L.name, colour: L.mode === 'train' && L.colour ? L.colour : modesConfig.modes[L.mode].color, confidence: L.confidence, source: L.source }, geometry: { type: 'LineString', coordinates: L._overview } });
      }
      body = JSON.stringify({ type: 'FeatureCollection', features });
      overlayCache.set(key, body);
    }
    res.type('application/json').send(body);
  });

  // ---- trip planning
  const runPlan = (reqBody, res) => {
    try {
      res.json(planner.plan(reqBody));
    } catch (e) {
      if (e instanceof PlanError) return res.status(e.status).json({ error: e.message, code: e.code });
      console.error('plan failed:', e);
      res.status(500).json({ error: 'Something went wrong while planning the trip.', code: 'INTERNAL' });
    }
  };
  api.post('/plan', (req, res) => runPlan(req.body || {}, res));
  api.get('/plan', (req, res) => {
    const q = req.query;
    runPlan({
      from: { ...(parsePoint(q.from) || {}), name: q.fromName },
      to: { ...(parsePoint(q.to) || {}), name: q.toName },
      passenger: q.passenger,
      modes: q.modes ? String(q.modes).split(',') : undefined,
      when: q.when,
      maxWalkM: num(q.walk),
      includeLowConfidence: q.legacy === '0' ? false : undefined,
    }, res);
  });

  // ---- legacy routes (the original hand-drawn routes, now a JSON file instead of MySQL)
  if (legacyRoutes) legacy.mount(api);

  api.use((req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  app.use('/api', api);

  // ------------------------------------------------------------ website (only the front-end files - never source or data)
  app.get('/', (req, res) => res.redirect('/dashboard.html'));
  app.get(/^\/([A-Za-z0-9_]+)\.html$/, (req, res, next) => {
    if (!PAGES.has(req.params[0])) return next();
    res.sendFile(path.join(SITE_ROOT, `${req.params[0]}.html`));
  });
  for (const dir of STATIC_DIRS) app.use(`/Others/${dir}`, express.static(path.join(SITE_ROOT, 'Others', dir), { dotfiles: 'deny', maxAge: '5m' }));

  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  });
  return app;
}

module.exports = { createApp, SITE_ROOT, TYPE_LABEL };
