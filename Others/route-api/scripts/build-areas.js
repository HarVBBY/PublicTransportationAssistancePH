'use strict';
/**
 * Builds data/areas.json (simplified city boundaries) from data/raw/osm_boundaries.json.
 *   node scripts/build-areas.js
 */
const fs = require('fs');
const path = require('path');
const geo = require('../src/geo');

const RAW = path.join(__dirname, '..', 'data', 'raw', 'osm_boundaries.json');
const OUT = path.join(__dirname, '..', 'data', 'areas.json');
const r5 = (x) => Math.round(x * 1e5) / 1e5;

/** Join unordered way fragments into closed rings. */
function ringsFromWays(ways) {
  const segs = ways.map((w) => w.filter(Boolean).map((p) => [p.lon, p.lat])).filter((s) => s.length > 1);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const rings = [];
  while (segs.length) {
    let ring = segs.shift().slice();
    let progressed = true;
    while (progressed && !same(ring[0], ring[ring.length - 1])) {
      progressed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (same(ring[ring.length - 1], s[0])) ring.push(...s.slice(1));
        else if (same(ring[ring.length - 1], s[s.length - 1])) ring.push(...s.slice(0, -1).reverse());
        else if (same(ring[0], s[s.length - 1])) ring = s.slice(0, -1).concat(ring);
        else if (same(ring[0], s[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1); progressed = true; break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const cities = [];
  for (const rel of raw.elements) {
    if (rel.type !== 'relation') continue;
    const name = (rel.tags.name || '').replace(/^City of /i, '').replace(/ City$/i, (m) => (rel.tags.name === 'Quezon City' ? m : ''));
    const outer = ringsFromWays(rel.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry));
    const inner = ringsFromWays(rel.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry));
    if (!outer.length) { console.warn('no boundary rings for', name); continue; }
    const polygons = outer.map((o) => {
      const simple = geo.simplify(o, 20).map(([x, y]) => [r5(x), r5(y)]);
      const holes = inner.filter((h) => geo.inRing(h[0][0], h[0][1], o)).map((h) => geo.simplify(h, 20).map(([x, y]) => [r5(x), r5(y)]));
      return [simple, ...holes];
    });
    const all = polygons.flatMap((p) => p[0]);
    const bbox = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
    cities.push({ name: name === 'Quezon' ? 'Quezon City' : name, bbox, polygons });
    console.log(`${name}: ${polygons.length} polygon(s), ${all.length} points`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), cities }));
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
main();
