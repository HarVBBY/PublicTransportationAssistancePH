'use strict';
/**
 * Developer helper: run the planner from the command line.
 *
 *   node scripts/try-plan.js <from> <to> [passenger] [when]
 *
 * where <from>/<to> is either "lat,lng" or a name that place search understands (use quotes):
 *   node scripts/try-plan.js "UE Caloocan" "SM Grand Central"
 *   node scripts/try-plan.js 14.7008,120.9822 14.6544,120.9838 student 2026-11-10T08:00
 */
const { loadPlanner } = require('../src/bootstrap');

const [fromArg, toArg, passenger = 'regular', when] = process.argv.slice(2);
if (!fromArg || !toArg) { console.error('usage: node scripts/try-plan.js <from> <to> [passenger] [when]'); process.exit(1); }

const { planner, places } = loadPlanner();

function resolve(arg) {
  const m = arg.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[3]), name: arg };
  if (!places) throw new Error('places.json is not built; use lat,lng');
  const hit = places.search(arg)[0];
  if (!hit) throw new Error(`no place matches "${arg}"`);
  console.log(`  "${arg}" -> ${hit.name} (${hit.typeLabel}${hit.city ? ', ' + hit.city : ''}) ${hit.lat},${hit.lng}`);
  return { lat: hit.lat, lng: hit.lng, name: hit.name };
}

const from = resolve(fromArg);
const to = resolve(toArg);
const t0 = Date.now();
const res = planner.plan({ from, to, passenger, when });
console.log(`\ncomputed in ${Date.now() - t0} ms; ${res.itineraries.length} options; period=${res.query.period}\n`);
for (const it of res.itineraries) {
  console.log(`== ${it.id} [${it.tags.join(', ')}]  ${it.totalMin} min | ₱${it.fare.regular}${it.fare.regular !== it.fare.payable ? ` (₱${it.fare.payable})` : ''} | ${it.transfers} transfer(s) | walk ${it.walkM} m | ${it.summary}`);
  for (const s of it.steps) console.log(`   ${s.n}. ${s.text}${s.fareText ? ' ' + s.fareText : ''}`);
  if (it.warnings.length) console.log('   ! ' + it.warnings.join(' | '));
  console.log();
}
