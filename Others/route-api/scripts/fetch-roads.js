'use strict';
/**
 * Downloads the OpenStreetMap ROAD NETWORK of the study area (every street, lane, footpath and busway) so that
 * walking, tricycle and jeepney paths can follow real roads instead of straight lines.
 *
 *   node scripts/fetch-roads.js            # fetch the tiles that are missing (resumable)
 *   node scripts/fetch-roads.js --force    # refetch every tile
 *
 * The area is cut into small tiles (a single huge query is rejected by the public Overpass servers). Each tile is
 * cached in data/raw/osm_roads_tiles/ with only the tags the router needs, so an interrupted run just continues.
 * A way that crosses a tile edge is returned by both tiles; scripts/build-roads.js de-duplicates by way id.
 * Data (c) OpenStreetMap contributors, ODbL - https://www.openstreetmap.org/copyright
 */
const fs = require('fs');
const path = require('path');
const { STUDY_BBOX } = require('./lib/study-area');
const { overpass, sleep } = require('./lib/overpass');

const DIR = path.join(__dirname, '..', 'data', 'raw', 'osm_roads_tiles');
const STEP = 0.03; // degrees (~3.3 km)
const EXCLUDE = 'proposed|construction|raceway|bus_guideway|escape|elevator|platform|rest_area|services|abandoned|disused|corridor|via_ferrata';
const KEEP_TAGS = ['highway', 'name', 'ref', 'oneway', 'junction', 'access', 'foot', 'motor_vehicle', 'vehicle', 'motorcar', 'service', 'bridge', 'tunnel', 'area'];
const r7 = (x) => Math.round(x * 1e7) / 1e7;

function tiles() {
  const out = [];
  let r = 0;
  for (let s = STUDY_BBOX.south; s < STUDY_BBOX.north - 1e-9; s += STEP, r++) {
    let c = 0;
    for (let w = STUDY_BBOX.west; w < STUDY_BBOX.east - 1e-9; w += STEP, c++) {
      out.push({ id: `r${r}c${c}`, s: +s.toFixed(5), w: +w.toFixed(5), n: +Math.min(s + STEP, STUDY_BBOX.north).toFixed(5), e: +Math.min(w + STEP, STUDY_BBOX.east).toFixed(5) });
    }
  }
  return out;
}

function compact(json) {
  const ways = [];
  for (const e of json.elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2 || e.geometry.some((p) => !p)) continue;
    const t = {};
    for (const k of KEEP_TAGS) if (e.tags && e.tags[k] !== undefined) t[k] = e.tags[k];
    const g = [];
    for (const p of e.geometry) g.push(r7(p.lat), r7(p.lon));
    ways.push({ i: e.id, t, n: e.nodes, g });
  }
  return ways;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const force = process.argv.includes('--force');
  const list = tiles();
  console.log(`roads: ${list.length} tiles`);
  let done = 0, total = 0;
  for (const t of list) {
    const file = path.join(DIR, `${t.id}.json`);
    done++;
    if (!force && fs.existsSync(file)) { total += JSON.parse(fs.readFileSync(file, 'utf8')).length; continue; }
    const t0 = Date.now();
    const json = await overpass(`[out:json][timeout:240];
way["highway"]["highway"!~"^(${EXCLUDE})$"](${t.s},${t.w},${t.n},${t.e});
out geom;`, `roads ${t.id}`);
    const ways = compact(json);
    fs.writeFileSync(file, JSON.stringify(ways));
    total += ways.length;
    console.log(`  ${done}/${list.length} ${t.id}: ${ways.length} ways (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    await sleep(1500);
  }
  console.log(`all done: ${total} way records (before de-duplication)`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
