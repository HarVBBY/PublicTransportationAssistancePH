'use strict';
/**
 * Downloads the raw OpenStreetMap data PUBTA needs from the public Overpass API and caches it in data/raw/:
 *   osm_routes.json      transit route relations (+ geometry, stop nodes, way names), fetched in small chunks
 *   osm_rail.json        LRT-1 / LRT-2 / MRT-3 (kept whole, not clipped to the study area)
 *   osm_places.json      named places, landmarks, stations and major roads (for the search box)
 *   osm_boundaries.json  city boundaries (to know which city a point is in)
 *
 *   node scripts/fetch-osm.js            # fetch whatever is missing
 *   node scripts/fetch-osm.js --force    # refetch everything
 *   node scripts/fetch-osm.js places     # one dataset only (routes | rail | places | boundaries)
 *
 * The public Overpass servers are shared and sometimes busy, so every request is retried with backoff and
 * mirrors. Data (c) OpenStreetMap contributors, ODbL - https://www.openstreetmap.org/copyright
 */
const fs = require('fs');
const path = require('path');
const { STUDY_BBOX, bboxStr } = require('./lib/study-area');
const { overpass, sleep } = require('./lib/overpass');

const RAW = path.join(__dirname, '..', 'data', 'raw');
const BB = bboxStr(STUDY_BBOX);

// City buses, jeepneys (mapped as route=bus) and UV Express (route=share_taxi). Interregional / provincial
// buses and private shuttles are not part of the local commuter network.
const ROAD_NETWORK_EXCLUDE = 'Interregional|Region III|Region IV|Victory Liner|Philtranco|Genesis|Five Star|Partas|Baliwag|Cisco|P2P|BGC Bus|Shuttle';

const save =(name, obj) => {
  const file = path.join(RAW, `osm_${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  console.log(`  saved ${name}: ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
};

async function fetchRoutes() {
  console.log('routes: listing relations...');
  const list = await overpass(`[out:json][timeout:120];
rel["route"~"^(bus|share_taxi|minibus|trolleybus)$"]["network"!~"${ROAD_NETWORK_EXCLUDE}"](${BB});
out ids;`, 'route ids');
  const ids = list.elements.map((e) => e.id);
  console.log(`  ${ids.length} relations; fetching geometry in chunks`);
  const relations = [], nodes = new Map(), ways = new Map();
  const CHUNK = 25;
  const chunkDir = path.join(RAW, 'osm_routes_chunks');
  fs.mkdirSync(chunkDir, { recursive: true });
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const cacheFile = path.join(chunkDir, `chunk_${String(i).padStart(4, '0')}.json`);
    let json;
    if (fs.existsSync(cacheFile)) json = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); // resume after a failed run
    else {
      const q = `[out:json][timeout:240];
rel(id:${part.join(',')})->.r;
.r out geom(${BB});
node(r.r)->.n; .n out body;
way(r.r)->.w; .w out tags;`;
      json = await overpass(q, `routes ${i}-${i + part.length}`);
      fs.writeFileSync(cacheFile, JSON.stringify(json));
      await sleep(2000);
    }
    for (const e of json.elements) {
      if (e.type === 'relation') relations.push(e);
      else if (e.type === 'node') nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, tags: e.tags || {} });
      else if (e.type === 'way') ways.set(e.id, { id: e.id, tags: pick(e.tags, ['name', 'ref', 'highway', 'oneway']) });
    }
    process.stdout.write(`  ${Math.min(i + CHUNK, ids.length)}/${ids.length}\r`);
    await sleep(1500);
  }
  console.log();
  save('routes', { relations, nodes: [...nodes.values()], ways: [...ways.values()] });
}

function pick(obj = {}, keys) { const o = {}; for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k]; return o; }

async function fetchRail() {
  console.log('rail...');
  const json = await overpass(`[out:json][timeout:180];
rel["route"~"^(light_rail|subway|train|tram)$"]["network"~"Manila LRT|Manila MRT"](14.40,120.85,14.85,121.20)->.r;
.r out geom;
node(r.r)->.n; .n out body;`, 'rail');
  save('rail', {
    relations: json.elements.filter((e) => e.type === 'relation'),
    nodes: json.elements.filter((e) => e.type === 'node').map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, tags: e.tags || {} })),
    ways: [],
  });
}

async function fetchPlaces() {
  console.log('places...');
  const groups = {
    amenities: `nwr["name"]["amenity"~"^(university|college|hospital|townhall|bus_station|marketplace|courthouse|police|library|cinema|school)$"](${BB});`,
    shops: `nwr["name"]["shop"~"^(mall|department_store|supermarket)$"](${BB});`,
    stations: `nwr["name"]["railway"~"^(station|halt)$"](${BB}); nwr["name"]["public_transport"="station"](${BB});`,
    areas: `nwr["name"]["place"~"^(suburb|neighbourhood|quarter|village|town|city|hamlet|locality|island)$"](${BB});`,
    leisure: `nwr["name"]["tourism"~"^(attraction|museum)$"](${BB}); nwr["name"]["leisure"~"^(park|stadium|sports_centre)$"](${BB});`,
    roads: `way["name"]["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${BB});`,
  };
  const elements = [];
  for (const [name, body] of Object.entries(groups)) {
    const json = await overpass(`[out:json][timeout:180];(${body});out center tags;`, `places:${name}`);
    for (const e of json.elements) elements.push({ type: e.type, id: e.id, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon, tags: pick(e.tags, ['name', 'name:en', 'alt_name', 'amenity', 'shop', 'railway', 'public_transport', 'place', 'tourism', 'leisure', 'highway', 'ref', 'operator', 'brand', 'addr:city', 'addr:street']) });
    console.log(`  ${name}: ${json.elements.length}`);
    await sleep(1500);
  }
  save('places', { elements });
}

async function fetchBoundaries() {
  console.log('boundaries...');
  const json = await overpass(`[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"="6"]["name"~"Caloocan|Malabon|Navotas|Valenzuela|Quezon City|Manila|San Juan|Mandaluyong|Marikina|Pasig"](${BB});
out geom;`, 'boundaries');
  save('boundaries', { elements: json.elements });
}

const DATASETS = { routes: fetchRoutes, rail: fetchRail, places: fetchPlaces, boundaries: fetchBoundaries };

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  for (const [name, fn] of Object.entries(DATASETS)) {
    if (only.length && !only.includes(name)) continue;
    const file = path.join(RAW, `osm_${name}.json`);
    if (!force && fs.existsSync(file) && fs.statSync(file).size > 1000) { console.log(`skip ${name} (cached)`); continue; }
    const t0 = Date.now();
    await fn();
    console.log(`  ${name} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('all done');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
