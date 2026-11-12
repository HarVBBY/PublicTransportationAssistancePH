'use strict';
/**
 * Compiles the raw downloads in data/raw/ into data/network.json - the file the planner loads.
 *
 *   node scripts/build-network.js
 *
 * Sources and how they are used:
 *   OpenStreetMap routes  buses, UV Express, EDSA Carousel and (OSM-mapped) jeepneys  -> confidence 'medium'
 *   OpenStreetMap rail    LRT-1 / LRT-2 / MRT-3                                        -> confidence 'high'
 *   DOTC/Sakay GTFS       JEEPNEY routes only (2013-15 snapshot), de-duplicated vs OSM -> confidence 'low'
 */
const fs = require('fs');
const path = require('path');
const geo = require('../src/geo');
const { Roads } = require('../src/roads');
const osm = require('./lib/osm');
const match = require('./lib/road-match');
const { STUDY_BBOX } = require('./lib/study-area');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const OUT = process.env.NETWORK_OUT || path.join(__dirname, '..', 'data', 'network.json');
const ROADS_FILE = path.join(__dirname, '..', 'data', 'roads.bin.gz');
let ROADS = null; // the road graph (npm run data:roads), used to make route lines follow real streets
const matchStats = { osmGapsBridged: 0, osmGapsLeft: 0, gtfsLines: 0, gtfsRoadPieces: 0, gtfsStraightPieces: 0 };
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const exists = (f) => fs.existsSync(path.join(RAW, f));
const inBox = (lat, lng) => lat >= STUDY_BBOX.south && lat <= STUDY_BBOX.north && lng >= STUDY_BBOX.west && lng <= STUDY_BBOX.east;
const dropped = {};
const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };

// ------------------------------------------------------------------ classification of OSM road routes
function isInactive(t) {
  return ['proposed', 'construction', 'abandoned', 'disused', 'planned', 'razed'].includes(t.state) || t['disused:route'] || t['proposed:route'] || t.proposed
    || /\((proposed|planned|suspended)\)/i.test(t.name || '');
}

function classifyRoad(rel) {
  const t = rel.tags || {};
  const net = `${t.network || ''} ${t.operator || ''}`;
  const name = t.name || '';
  const ref = String(t.ref || '');
  if (/P2P|BGC|shuttle/i.test(net + name)) return null;
  if (rel.tags.route === 'share_taxi' || /UV Express/i.test(net + name)) return { mode: 'uv', fareClass: 'uv_express' };
  if (/QCityBus|Quezon City Bus/i.test(net)) return { mode: 'bus', fareClass: 'free' };
  if (/EDSA Carousel/i.test(name)) return { mode: 'carousel', fareClass: t.air_conditioning === 'yes' ? 'bus_aircon' : 'bus_ordinary' };
  if (rel.tags.route !== 'bus' && rel.tags.route !== 'minibus' && rel.tags.route !== 'trolleybus') return null;
  const isRouteN = /^Route\s+\d+/i.test(name) || (/^\d{1,2}[A-Z]?$/.test(ref) && /LTFRB/i.test(t.network || ''));
  if (isRouteN) return { mode: 'bus', fareClass: t.air_conditioning === 'yes' ? 'bus_aircon' : 'bus_ordinary' };
  if (/PUJ/i.test(net) || /^T?\d{3,4}[A-Z]?$/.test(ref) || /jeep/i.test(name)) return { mode: 'jeepney', fareClass: 'puj_traditional' };
  // unknown local route: treat as a jeepney if it looks local, otherwise a bus
  return /LTFRB/i.test(net) ? { mode: 'jeepney', fareClass: 'puj_traditional' } : { mode: 'bus', fareClass: 'bus_ordinary' };
}

function parseFromTo(t) {
  if (t.from || t.to) return { from: t.from || null, to: t.to || null };
  const m = osm.cleanName(t.name).split(/\s+via\s+/i)[0].split(/\s*[–—→-]\s*/);
  return m.length >= 2 ? { from: m[0].trim(), to: m[m.length - 1].trim() } : { from: null, to: null };
}

// ------------------------------------------------------------------ one OSM relation -> 0..n lines
function relationLines(rel, nodesById, waysById, cls, extra = {}) {
  const t = rel.tags || {};
  const stops = osm.relationStops(rel, nodesById);
  const out = [];
  const runs = osm.stitch(rel.members);
  runs.forEach((run, runIdx) => {
    // where the OSM ways of a road route do not quite touch, bridge the gap along the road network (rail is left alone)
    let source = run.pts;
    if (ROADS && cls.mode !== 'train') {
      const f = match.fillGaps(ROADS, run);
      source = f.pts; matchStats.osmGapsBridged += f.filled; matchStats.osmGapsLeft += f.left;
    }
    const pts = geo.simplify(source, 4).map(([x, y]) => [r5(x), r5(y)]);
    const cum = geo.cumulative(pts);
    const length = cum[cum.length - 1];
    if (length < (extra.minLengthM || 1200)) { drop('too short'); return; }
    if (length > 120000) { drop('implausibly long'); return; }

    const stopsOut = [];
    for (const s of stops) {
      const np = geo.nearestOnPolyline(pts, cum, s.lat, s.lng);
      if (np.dist <= 90) stopsOut.push([r5(s.lng), r5(s.lat), Math.round(np.along), s.name]);
    }
    stopsOut.sort((a, b) => a[2] - b[2]);

    const roads = [];
    for (const mark of run.marks) {
      const w = waysById.get(mark.wayId);
      const nm = w && w.tags && (w.tags.name || w.tags.ref);
      if (!nm) continue;
      const p = run.pts[Math.min(mark.at, run.pts.length - 1)];
      const d = Math.round(geo.nearestOnPolyline(pts, cum, p[1], p[0]).along);
      if (!roads.length || roads[roads.length - 1][1] !== nm) roads.push([d, nm]);
    }
    roads.sort((a, b) => a[0] - b[0]);

    const ft = parseFromTo(t);
    const interval = osm.parseInterval(t.interval);
    out.push({
      id: `osm-${rel.id}${runs.length > 1 ? '-' + runIdx : ''}`,
      mode: cls.mode,
      ref: t.ref || null,
      name: osm.cleanName(t.name) || `${ft.from || '?'} - ${ft.to || '?'}`,
      from: ft.from, to: ft.to,
      via: t.via || null,
      operator: t.operator || null,
      colour: t.colour || null,
      source: 'osm', confidence: extra.confidence || 'medium',
      fareClass: cls.fareClass,
      intervalMin: interval && interval <= 60 ? interval : null,
      aircon: t.air_conditioning === 'yes' ? true : t.air_conditioning === 'no' ? false : null,
      boarding: extra.boarding || (cls.mode === 'jeepney' ? 'anywhere' : stopsOut.length >= 4 ? 'stops' : stopsOut.length >= 2 && cls.mode === 'uv' ? 'stops' : 'anywhere'),
      pts, stops: stopsOut, roads,
      osmId: rel.id,
    });
  });
  return out;
}

// ------------------------------------------------------------------ OSM road routes
function buildOsmRoadLines() {
  if (!exists('osm_routes.json')) { console.warn('! osm_routes.json missing - run scripts/fetch-osm.js'); return []; }
  const raw = readJSON('osm_routes.json');
  const nodesById = new Map(raw.nodes.map((n) => [n.id, n]));
  const waysById = new Map(raw.ways.map((w) => [w.id, w]));
  const lines = [];
  for (const rel of raw.relations) {
    if (isInactive(rel.tags || {})) { drop('inactive'); continue; }
    const cls = classifyRoad(rel);
    if (!cls) { drop('not a local road service'); continue; }
    lines.push(...relationLines(rel, nodesById, waysById, cls));
  }
  return lines;
}

// ------------------------------------------------------------------ OSM rail
function buildRailLines() {
  if (!exists('osm_rail.json')) { console.warn('! osm_rail.json missing - run scripts/fetch-osm.js rail'); return []; }
  const raw = readJSON('osm_rail.json');
  const nodesById = new Map(raw.nodes.map((n) => [n.id, n]));
  let lines = [];
  for (const rel of raw.relations) {
    const t = rel.tags || {};
    if (isInactive(t)) { drop('inactive rail'); continue; }
    const fareClass = /MRT/i.test(t.network || '') || t.ref === '3' && /MRT/i.test(t.name || '') ? 'mrt3' : t.ref === '2' ? 'lrt2' : 'lrt1';
    const colour = fareClass === 'lrt1' ? '#6BA539' : fareClass === 'lrt2' ? '#7B3F98' : '#0D5CAB';
    lines.push(...relationLines(rel, nodesById, new Map(), { mode: 'train', fareClass }, { confidence: 'high', boarding: 'stops', minLengthM: 3000 }));
    lines[lines.length - 1] && (lines[lines.length - 1].colour = lines[lines.length - 1].colour || colour);
  }
  // keep only the longest relation per (service, direction); partial relations (e.g. "Monumento to Dr. Santos") are subsets
  lines.sort((a, b) => b.stops.length - a.stops.length);
  const kept = [];
  for (const L of lines) {
    const subset = kept.some((K) => K.fareClass === L.fareClass && sameDirectionSubset(L, K));
    if (subset) drop('rail subset'); else kept.push(L);
  }
  return kept;
}

/** True if >=85% of a's stops lie on b's stops (within 120 m) in the same travel order. */
function sameDirectionSubset(a, b) {
  if (!a.stops.length || !b.stops.length) return false;
  let hit = 0, lastIdx = -1, inOrder = true;
  for (const s of a.stops) {
    let bi = -1, bd = 120;
    b.stops.forEach((q, i) => { const d = geo.haversine(s[1], s[0], q[1], q[0]); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) { hit++; if (bi < lastIdx) inOrder = false; lastIdx = bi; }
  }
  return hit / a.stops.length >= 0.85 && inOrder;
}

// ------------------------------------------------------------------ legacy DOTC / Sakay GTFS (jeepneys only)
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift();
  return rows.filter((r) => r.length === h.length).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

/** "Samson Road, Caloocan City" -> "Samson Road"; drops the trailing city/region clutter from DOTC stop names. */
const cleanStopName = (s) => (s || '')
  .replace(/,?\s*(Metro Manila|Philippines|NCR)\s*$/i, '')
  .replace(/,?\s*(Caloocan|Malabon|Navotas|Valenzuela|Quezon|Manila|Makati|Pasay|Mandaluyong|Marikina|Pasig|San Juan|Taguig|Para[ñn]aque|Las Pi[ñn]as|Muntinlupa|Pateros)\s+City\s*$/i, '')
  .replace(/\s+/g, ' ').trim() || null;
const SMALL = new Set(['via', 'of', 'to', 'and', 'at', 'the', 'de', 'ng', 'sa', 'in', 'on']);
/** "MONUMENTO-MALABON via LETRE" -> "Monumento-Malabon via Letre" (only touches names that are mostly upper-case). */
function titleCase(s) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  let out = s;
  if (letters.length && upper / letters.length > 0.6) {
    out = s.toLowerCase().replace(/(^|[\s\-/(.])([a-z])/g, (m, pre, c) => pre + c.toUpperCase())
      .replace(/\b(Via|Of|To|And|At|The|De|Ng|Sa|In|On)\b/g, (w, g1, offset) => (offset === 0 ? w : w.toLowerCase()));
  }
  return out.replace(/\s+/g, ' ').trim();
}

function buildGtfsJeepneys(osmJeepneys) {
  const dir = path.join(RAW, 'gtfs');
  if (!fs.existsSync(path.join(dir, 'stop_times.txt'))) { console.warn('! GTFS missing - run scripts/fetch-gtfs.js'); return []; }
  const load = (n) => parseCSV(fs.readFileSync(path.join(dir, n + '.txt'), 'utf8'));
  const routes = load('routes'), trips = load('trips'), stops = load('stops'), st = load('stop_times');
  const stopById = new Map(stops.map((s) => [s.stop_id, { name: s.stop_name, lat: +s.stop_lat, lng: +s.stop_lon }]));
  const tripRoute = new Map(trips.map((t) => [t.trip_id, t.route_id]));
  const seq = new Map();
  for (const r of st) { let a = seq.get(r.trip_id); if (!a) seq.set(r.trip_id, (a = [])); a.push([+r.stop_sequence, r.stop_id]); }
  const bestTrip = new Map();
  for (const [tid, a] of seq) { const rid = tripRoute.get(tid); const cur = bestTrip.get(rid); if (rid && (!cur || a.length > cur.length)) bestTrip.set(rid, a); }

  // grid of OSM jeepney polylines, for de-duplication
  const CELL = 0.0005;
  const cellKey = (lng, lat) => Math.floor(lng / CELL) * 100003 + Math.floor(lat / CELL);
  const grid = new Map();
  osmJeepneys.forEach((L, li) => {
    const cum = geo.cumulative(L.pts);
    for (let d = 0; d <= cum[cum.length - 1]; d += 40) {
      const p = geo.pointAt(L.pts, cum, d);
      const k = cellKey(p[0], p[1]);
      let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push([li, d, p[0], p[1]]);
    }
  });

  const lines = [];
  for (const r of routes) {
    if (!/^LTFRB_PUJ/.test(r.route_id)) continue; // jeepneys only; the 2013-15 bus data is long obsolete
    const a = bestTrip.get(r.route_id);
    if (!a) continue;
    a.sort((x, y) => x[0] - y[0]);
    const all = a.map(([, id]) => stopById.get(id)).filter(Boolean);
    // longest contiguous run of stops inside the study area
    let best = [], cur = [];
    for (const s of all) { if (inBox(s.lat, s.lng)) cur.push(s); else { if (cur.length > best.length) best = cur; cur = []; } }
    if (cur.length > best.length) best = cur;
    if (best.length < 5) { drop('gtfs: <5 stops in area'); continue; }
    const pts = best.map((s) => [r5(s.lng), r5(s.lat)]);
    const cum = geo.cumulative(pts);
    if (cum[cum.length - 1] < 1500) { drop('gtfs: too short'); continue; }

    // duplicate of an OSM jeepney? (>=85% of its stops within 45 m of one OSM line, same direction (a near-subset))
    const hits = new Map();
    for (const s of best) {
      const k0x = Math.floor(s.lng / CELL), k0y = Math.floor(s.lat / CELL);
      const seen = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [li, d, x, y] of grid.get((k0x + dx) * 100003 + (k0y + dy)) || []) {
          if (seen.has(li) || geo.haversine(s.lat, s.lng, y, x) > 45) continue;
          seen.add(li);
          const h = hits.get(li) || { n: 0, first: d, last: d };
          h.n++; h.last = d; hits.set(li, h);
        }
      }
    }
    let dup = false;
    for (const h of hits.values()) if (h.n / best.length >= 0.85 && h.last > h.first) dup = true;
    if (dup) { drop('gtfs: duplicate of an OSM jeepney'); continue; }

    // The DOTC data only lists STOPS, so the line used to be drawn as straight pieces between them (cutting across
    // blocks, rivers and parks). Route stop-to-stop along motor roads instead.
    let linePts = pts, alongs = best.map((_, i) => cum[i]), stopPts = pts;
    if (ROADS) {
      const m = match.snapToRoads(ROADS, pts);
      matchStats.gtfsLines++; matchStats.gtfsRoadPieces += m.matched; matchStats.gtfsStraightPieces += m.straight;
      linePts = geo.simplify(m.pts, 3).map(([x, y]) => [r5(x), r5(y)]);
      alongs = match.alongMonotone(linePts, geo.cumulative(linePts), m.joins.map((j) => m.pts[j]));
      stopPts = m.stopPts; // the DOTC coordinates are only good to ~50 m: use the matched position on the road
    }

    const nm = titleCase(r.route_long_name || r.route_short_name || r.route_id);
    lines.push({
      id: `gtfs-${r.route_id.replace('LTFRB_', '')}`,
      mode: 'jeepney', ref: null, name: nm,
      from: all[0] ? cleanStopName(all[0].name) : null, to: all[all.length - 1] ? cleanStopName(all[all.length - 1].name) : null,
      via: null, operator: null, colour: null,
      source: 'dotc-gtfs', confidence: 'low',
      fareClass: 'puj_traditional', intervalMin: null, aircon: null,
      boarding: 'stops',
      pts: linePts,
      stops: best.map((s, i) => [r5(stopPts[i][0]), r5(stopPts[i][1]), Math.round(alongs[i]), cleanStopName(s.name)]),
      roads: [],
    });
  }
  return lines;
}

// ------------------------------------------------------------------ main
function main() {
  if (fs.existsSync(ROADS_FILE)) {
    ROADS = Roads.fromFile(ROADS_FILE);
    console.log(`road map loaded: ${ROADS.stats().edges} road pieces - route lines will follow real streets`);
  } else {
    console.warn('! data/roads.bin.gz not found - lines are NOT matched to roads (run: npm run data:roads)');
  }
  const osmRoad = buildOsmRoadLines();
  const rail = buildRailLines();
  const gtfs = buildGtfsJeepneys(osmRoad.filter((l) => l.mode === 'jeepney'));
  const lines = [...rail, ...osmRoad, ...gtfs];
  lines.forEach((l) => { if (!l.stops.length) delete l.stops; if (!l.roads.length) delete l.roads; for (const k of Object.keys(l)) if (l[k] === null) delete l[k]; });

  const counts = {};
  for (const l of lines) { const k = `${l.mode}/${l.source}`; counts[k] = (counts[k] || 0) + 1; }
  const data = {
    meta: {
      builtAt: new Date().toISOString(),
      bbox: STUDY_BBOX,
      sources: [
        { name: 'OpenStreetMap contributors', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', used: 'buses, UV Express, EDSA Carousel, LRT/MRT, some jeepneys' },
        { name: 'DOTC/LTFRB GTFS via Sakay.ph', license: 'DOTC Developer License Agreement', url: 'https://github.com/sakayph/gtfs', used: 'legacy jeepney routes (2013-2015) - low confidence' },
      ],
      counts,
    },
    lines,
  };
  fs.writeFileSync(OUT, JSON.stringify(data));
  const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}  (${mb} MB, ${lines.length} lines)`);
  console.log('by mode/source:', counts);
  console.log('dropped:', dropped);
  if (ROADS) {
    const pieces = matchStats.gtfsRoadPieces + matchStats.gtfsStraightPieces;
    console.log(`road matching: ${matchStats.osmGapsBridged} OSM gaps bridged (${matchStats.osmGapsLeft} left), ` +
      `${matchStats.gtfsLines} GTFS lines: ${matchStats.gtfsRoadPieces}/${pieces} stop-to-stop pieces follow roads (${pieces ? ((100 * matchStats.gtfsRoadPieces) / pieces).toFixed(0) : 0}%), ${matchStats.gtfsStraightPieces} left straight`);
  }
}

if (require.main === module) main();
module.exports = { classifyRoad, relationLines, buildGtfsJeepneys };
