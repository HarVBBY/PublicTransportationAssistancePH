'use strict';
/**
 * Compiles the downloaded road tiles (data/raw/osm_roads_tiles/, from scripts/fetch-roads.js) into
 * data/roads.bin.gz - the compact road graph that src/roads.js routes on.
 *
 *   node scripts/build-roads.js
 *
 * Data (c) OpenStreetMap contributors, ODbL - https://www.openstreetmap.org/copyright
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encode } = require('../src/roads');
const { buildGraph } = require('./lib/road-graph');

const TILES = path.join(__dirname, '..', 'data', 'raw', 'osm_roads_tiles');
const OUT = path.join(__dirname, '..', 'data', 'roads.bin.gz');

function main() {
  if (!fs.existsSync(TILES)) throw new Error('data/raw/osm_roads_tiles is missing - run: node scripts/fetch-roads.js');
  const files = fs.readdirSync(TILES).filter((f) => /^r\d+c\d+\.json$/.test(f)).sort();
  if (!files.length) throw new Error('no road tiles downloaded yet - run: node scripts/fetch-roads.js');
  const ways = [];
  for (const f of files) for (const w of JSON.parse(fs.readFileSync(path.join(TILES, f), 'utf8'))) ways.push(w);
  console.log(`${files.length} tiles, ${ways.length} way records`);

  const t0 = Date.now();
  const { data, stats } = buildGraph(ways);
  data.meta = { builtAt: new Date().toISOString(), tiles: files.length, source: 'OpenStreetMap highways (ODbL)' };
  console.log(`graph: ${stats.nodes} junctions, ${stats.edges} road pieces, ${stats.shapePoints} shape points, ${stats.namedRoads} road names (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`  dropped ${stats.droppedNodes} nodes in tiny disconnected islands`);
  console.log('  ways by type:', Object.entries(stats.classes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));

  const bin = encode(data);
  const gz = zlib.gzipSync(bin, { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${(bin.length / 1e6).toFixed(1)} MB raw, ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
}

try { main(); } catch (e) { console.error('FAILED:', e.message); process.exit(1); }
