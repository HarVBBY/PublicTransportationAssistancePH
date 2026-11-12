'use strict';
/**
 * Builds data/places.json (the searchable list of landmarks, stations, areas and roads) from
 * data/raw/osm_places.json, the train stations in data/network.json, and data/curated/aliases.json.
 *   node scripts/build-places.js            (run build-areas.js and build-network.js first)
 */
const fs = require('fs');
const path = require('path');
const geo = require('../src/geo');
const { norm } = require('../src/places');
const { Areas } = require('../src/areas');

const DATA = path.join(__dirname, '..', 'data');
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const read = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p), 'utf8'));
const has = (...p) => fs.existsSync(path.join(DATA, ...p));

function typeOf(t) {
  if (t.highway) return 'road';
  if (t.place) return 'area';
  if (t.railway) return 'station'; // LRT / MRT / PNR stations only
  if (t.public_transport === 'station') return 'bus_station'; // jeepney, bus and UV terminals
  switch (t.amenity) {
    case 'university': return 'university';
    case 'college': return 'college';
    case 'school': return 'school';
    case 'hospital': return 'hospital';
    case 'townhall': return /barangay|brgy|bgy/i.test(`${t.name || ''} ${t['name:en'] || ''}`) ? 'barangay_hall' : 'townhall';
    case 'bus_station': return 'bus_station';
    case 'marketplace': return 'marketplace';
    case 'police': return 'police';
    case 'courthouse': return 'courthouse';
    case 'library': return 'library';
    case 'cinema': return 'cinema';
    default: break;
  }
  if (t.shop === 'mall' || t.shop === 'department_store') return 'mall';
  if (t.shop === 'supermarket') return 'supermarket';
  if (t.tourism) return 'attraction';
  if (t.leisure === 'park') return 'park';
  if (t.leisure) return 'attraction';
  return null;
}

function main() {
  if (!has('raw', 'osm_places.json')) throw new Error('data/raw/osm_places.json missing - run: node scripts/fetch-osm.js places');
  const areas = has('areas.json') ? new Areas(read('areas.json')) : null;
  const raw = read('raw', 'osm_places.json');
  let items = [];
  const roads = new Map(); // name -> [{lat,lng}]

  for (const el of raw.elements) {
    const t = el.tags || {};
    const name = (t['name:en'] || t.name || '').trim();
    if (!name || el.lat === undefined) continue;
    const type = typeOf(t);
    if (!type) continue;
    if (type === 'road') {
      if (!roads.has(name)) roads.set(name, []);
      roads.get(name).push({ lat: el.lat, lng: el.lon });
      continue;
    }
    const a = [];
    if (t.alt_name) a.push(...t.alt_name.split(';').map((s) => s.trim()).filter(Boolean));
    items.push({ n: name, t: type, lat: r5(el.lat), lng: r5(el.lon), a });
  }

  // one entry per road name: the way centre closest to that road's median point
  for (const [name, pts] of roads) {
    const mLat = pts.map((p) => p.lat).sort((x, y) => x - y)[pts.length >> 1];
    const mLng = pts.map((p) => p.lng).sort((x, y) => x - y)[pts.length >> 1];
    const c = pts.reduce((b, p) => (geo.haversine(p.lat, p.lng, mLat, mLng) < geo.haversine(b.lat, b.lng, mLat, mLng) ? p : b));
    items.push({ n: name, t: 'road', lat: r5(c.lat), lng: r5(c.lng), a: [] });
  }

  // train stations from the compiled network (so every LRT/MRT stop is searchable, even outside the study box)
  if (has('network.json')) {
    const seen = new Set();
    for (const L of read('network.json').lines) {
      if (L.mode !== 'train') continue;
      const label = L.fareClass === 'lrt1' ? 'LRT-1' : L.fareClass === 'lrt2' ? 'LRT-2' : 'MRT-3';
      for (const s of L.stops || []) {
        if (!s[3]) continue;
        const key = `${label}|${norm(s[3])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Always add the canonical LRT/MRT station. Look-alike OSM "stations" nearby (often mis-tagged shops or
        // duplicate nodes) are folded into it as aliases so they cannot outrank the real station.
        const first = norm(s[3]).split(' ')[0];
        const nm = /station/i.test(s[3]) ? s[3] : `${s[3]} Station (${label})`;
        const aliases = [`${s[3]} ${label}`, `LRT ${s[3]}`, s[3]];
        for (const p of items) {
          if (p.t === 'station' && !p._canon && geo.haversine(p.lat, p.lng, s[1], s[0]) < 200 && norm(p.n).includes(first)) { aliases.push(p.n, ...(p.a || [])); p._drop = true; }
        }
        items.push({ n: nm, t: 'station', lat: r5(s[1]), lng: r5(s[0]), a: aliases.filter((a) => a !== nm), _canon: true });
      }
    }
  }

  items = items.filter((p) => !p._drop).map(({ _canon, ...rest }) => rest);

  // places OSM is missing (surveyed by the PUBTA team)
  if (has('curated', 'places.json')) {
    for (const p of read('curated', 'places.json').places) items.push({ n: p.n, t: p.t, lat: p.lat, lng: p.lng, a: p.a || [], c: p.c });
  }

  // de-duplicate (OSM often has both a node and a way for the same place)
  const out = [];
  for (const it of items) {
    const twin = out.find((o) => o.t === it.t && norm(o.n) === norm(it.n) && geo.haversine(o.lat, o.lng, it.lat, it.lng) < 200);
    if (twin) { twin.a = [...new Set([...twin.a, ...it.a])]; continue; }
    out.push(it);
  }
  items = out;

  if (areas) for (const it of items) { const c = areas.cityAt(it.lat, it.lng); if (c) it.c = c; else if (!it.c) delete it.c; }

  // curated aliases
  if (has('curated', 'aliases.json')) {
    for (const rule of read('curated', 'aliases.json').aliases) {
      const m = norm(rule.match);
      let n = 0;
      for (const it of items) {
        if (rule.city && it.c !== rule.city) continue;
        if (rule.type && it.t !== rule.type) continue;
        if (norm(it.n).includes(m)) { it.a = [...new Set([...it.a, ...rule.aliases])]; n++; }
      }
      if (!n) console.warn(`alias rule matched nothing: ${rule.match}`);
    }
  }

  items.forEach((it) => { if (!it.a.length) delete it.a; });
  items.sort((a, b) => a.n.localeCompare(b.n));
  const file = path.join(DATA, 'places.json');
  fs.writeFileSync(file, JSON.stringify(items));
  const byType = {};
  for (const it of items) byType[it.t] = (byType[it.t] || 0) + 1;
  console.log(`wrote data/places.json: ${items.length} places (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`, byType);
}
main();
