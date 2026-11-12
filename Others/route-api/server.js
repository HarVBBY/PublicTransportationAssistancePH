'use strict';
/**
 * PUBTA server: trip-planning API + the website.
 *
 *   npm start            -> http://localhost:8000          (PORT / HOST can be set in .env)
 *   HOST=0.0.0.0 npm start   to open it to your phone on the same Wi-Fi
 *
 * First time (or to refresh the transit data): see README.md - "Updating the data".
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPlanner, DATA } = require('./src/bootstrap');
const { createApp } = require('./src/app');

if (!fs.existsSync(path.join(DATA, 'network.json'))) {
  console.error('\nThe transit network (data/network.json) has not been built yet.\nRun:  npm run data:build   (and npm run data:fetch first if data/raw is empty)\n');
  process.exit(1);
}

const parts = loadPlanner();
const app = createApp(parts);

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
  const s = parts.network.stats();
  console.log(`PUBTA is running  ->  http://localhost:${PORT}/PUBTASYSTEM.html`);
  console.log(`  network: ${s.lines} lines, ${s.nodes} boarding points | places: ${parts.places ? parts.places.size : 0} | fares as of ${parts.fares.asOf}`);
  console.log(parts.roads
    ? `  road map: ${parts.roads.stats().edges} road pieces - walking and tricycle paths follow real streets`
    : '  road map: NOT FOUND (data/roads.bin.gz) - walking and tricycle legs will be straight lines. Run: npm run data:roads');
  if (HOST === '0.0.0.0') {
    for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}/PUBTASYSTEM.html`);
  }
});

// precompute transfer neighbours in the background so the first trips are as fast as the rest
parts.network.warmUp(1500, parts.roads)
  .then((ms) => { console.log(`  route search warmed up in ${(ms / 1000).toFixed(1)} s`); return parts.roads ? parts.roads.warmSnaps(parts.network) : 0; })
  .then((ms) => { if (parts.roads) console.log(`  stops matched to the road map in ${(ms / 1000).toFixed(1)} s`); });

process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
