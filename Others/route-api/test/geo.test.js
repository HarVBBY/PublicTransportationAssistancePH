'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');

test('haversine: one degree of latitude is about 111 km', () => {
  const d = geo.haversine(14, 120, 15, 120);
  assert.ok(Math.abs(d - 111195) < 300, String(d));
  assert.equal(geo.haversine(14.6, 120.9, 14.6, 120.9), 0);
});

test('bearing and compass', () => {
  assert.equal(geo.compass(geo.bearing(14.0, 120.0, 14.1, 120.0)), 'north');
  assert.equal(geo.compass(geo.bearing(14.0, 120.0, 14.0, 120.1)), 'east');
  assert.equal(geo.compass(geo.bearing(14.0, 120.1, 14.0, 120.0)), 'west');
  assert.equal(geo.compass(geo.bearing(14.1, 120.0, 14.0, 120.0)), 'south');
});

test('cumulative / pointAt / slice follow the polyline', () => {
  const pts = [[120.0, 14.0], [120.01, 14.0], [120.01, 14.01]];
  const cum = geo.cumulative(pts);
  const total = cum[2];
  assert.ok(total > 2000 && total < 2300);
  const mid = geo.pointAt(pts, cum, cum[1]);
  assert.deepEqual(mid.map((x) => +x.toFixed(5)), [120.01, 14.0]);
  const part = geo.slice(pts, cum, cum[1] - 200, cum[1] + 200);
  assert.equal(part.length, 3); // start, the corner, end
});

test('nearestOnPolyline projects a point onto the line', () => {
  const pts = [[120.0, 14.0], [120.02, 14.0]];
  const cum = geo.cumulative(pts);
  const r = geo.nearestOnPolyline(pts, cum, 14.0009, 120.01);
  assert.ok(Math.abs(r.dist - 100) < 3, String(r.dist));
  assert.ok(Math.abs(r.along - cum[1] / 2) < 5);
});

test('simplify drops collinear points but keeps the ends and real corners', () => {
  const straight = [[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]];
  assert.equal(geo.simplify(straight, 5).length, 2);
  const bent = [[120.0, 14.0], [120.01, 14.0], [120.01, 14.01]];
  assert.equal(geo.simplify(bent, 5).length, 3);
});

test('point in polygon with a hole', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.ok(geo.inPolygon(1, 1, [outer, hole]));
  assert.ok(!geo.inPolygon(5, 5, [outer, hole]));
  assert.ok(!geo.inPolygon(11, 5, [outer]));
});

test('GridIndex returns nearby candidates only', () => {
  const g = new geo.GridIndex(0.003);
  g.add('near', 14.6500, 120.9800);
  g.add('far', 14.7000, 121.0500);
  const c = g.candidates(14.6501, 120.9801, 300);
  assert.ok(c.includes('near'));
  assert.ok(!c.includes('far'));
});
