'use strict';
/** A tiny synthetic city used by the tests (independent of the real data). */
const fs = require('fs');
const path = require('path');
const geo = require('../src/geo');
const { Network } = require('../src/network');
const { FareEngine } = require('../src/fares');
const { Planner } = require('../src/planner');

const DATA = path.join(__dirname, '..', 'data');
const modesConfig = JSON.parse(fs.readFileSync(path.join(DATA, 'config', 'modes.json'), 'utf8'));
const faresConfig = JSON.parse(fs.readFileSync(path.join(DATA, 'config', 'fares.json'), 'utf8'));

const BBOX = { south: 14.60, west: 120.90, north: 14.72, east: 121.06 };

/** Straight line from [lng,lat] to [lng,lat] with optional named stops at the given fractions. */
function line(id, mode, a, b, extra = {}) {
  const pts = [a, b];
  const total = geo.haversine(a[1], a[0], b[1], b[0]);
  const stops = (extra.stopAt || []).map(([f, name]) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.round(total * f), name]);
  const { stopAt, ...rest } = extra;
  return { id, mode, name: id, pts, stops, confidence: 'medium', source: 'osm', fareClass: 'puj_traditional', ...rest };
}

const J1 = () => line('J1', 'jeepney', [120.960, 14.650], [121.020, 14.650], { name: 'West–East Jeepney', ref: 'J1', boarding: 'anywhere', fareClass: 'puj_traditional' });
const J1b = () => line('J1b', 'jeepney', [120.960, 14.6501], [121.020, 14.6501], { name: 'West–East Jeepney (variant)', boarding: 'anywhere', fareClass: 'puj_traditional' });
const B1 = () => line('B1', 'bus', [120.990, 14.640], [120.990, 14.680], { name: 'South–North Bus', ref: '7', boarding: 'anywhere', fareClass: 'bus_ordinary' });
const T1 = () => line('T1', 'train', [120.960, 14.660], [121.030, 14.660], {
  name: 'Test Line', ref: '1', from: 'West', to: 'East', boarding: 'stops', fareClass: 'lrt1', confidence: 'high',
  stopAt: [[0, 'West'], [0.2, 'Two'], [0.4, 'Three'], [0.6, 'Four'], [0.8, 'Five'], [1, 'East']],
});

function makePlanner(lines, { areas = null, places = null, roads = null } = {}) {
  const network = new Network({ meta: { bbox: BBOX }, lines }, modesConfig);
  const fares = new FareEngine(faresConfig);
  return { planner: new Planner(network, fares, { areas, places, roads, modesConfig, bbox: BBOX }), network, fares };
}

module.exports = { makePlanner, J1, J1b, B1, T1, line, modesConfig, faresConfig, BBOX, DATA };
