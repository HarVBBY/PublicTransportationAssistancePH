'use strict';
/**
 * Downloads the legacy DOTC/LTFRB GTFS feed (as republished by Sakay.ph) into data/raw/gtfs/.
 * It is the only open dataset with broad jeepney coverage of Metro Manila, but it is a 2013-2015 snapshot,
 * so PUBTA only uses its JEEPNEY routes and marks every one of them "low confidence".
 *
 * License: DOTC Developer License Agreement (see LICENSE.md in the source repository) - use is permitted
 * for the purpose of assisting mass-transportation riders / promoting public transportation.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/sakayph/gtfs/master/';
const FILES = ['agency', 'routes', 'trips', 'stops', 'stop_times', 'shapes', 'frequencies', 'calendar', 'feed_info'];
const OUT = path.join(__dirname, '..', 'data', 'raw', 'gtfs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const force = process.argv.includes('--force');
  for (const f of FILES) {
    const dest = path.join(OUT, `${f}.txt`);
    if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) { console.log(`skip ${f}.txt (cached)`); continue; }
    const res = await fetch(`${BASE}${f}.txt`, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`${f}.txt -> HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`${f}.txt  ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
  }
  console.log('done');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
