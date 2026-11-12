'use strict';
/**
 * Turns an itinerary's legs into commuter-friendly step-by-step directions: where to wait, which side of the
 * road, what signboard to look for, where to get off, what to say, and what it costs.
 */
const geo = require('./geo');

const peso = (n) => `₱${Number.isInteger(n) ? n : n.toFixed(2)}`;
const mins = (n) => {
  const m = Math.max(1, Math.round(n));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
};
const dist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);

const MODE_NOUN = { jeepney: 'jeepney', bus: 'bus', carousel: 'EDSA Carousel bus', uv: 'UV Express van', train: 'train', tricycle: 'tricycle' };

/** "Samson Rd near SM Grand Central", "Monumento", ... */
function pointLabel(pt, places) {
  const lm = places && places.landmarkNear(pt.lat, pt.lng, 120);
  if (pt.isStop && pt.name) return pt.name;
  if (pt.name && lm && lm !== pt.name) return `${pt.name}, near ${lm}`;
  if (pt.name) return pt.name;
  if (lm) return `the roadside near ${lm}`;
  return 'the roadside';
}

/** Compass heading of a line at a given distance along it (where vehicles are moving). */
function headingAt(L, d) {
  const a = geo.pointAt(L.pts, L.cum, Math.max(0, d - 30));
  const b = geo.pointAt(L.pts, L.cum, Math.min(L.length, d + 120));
  return geo.compass(geo.bearing(a[1], a[0], b[1], b[0]));
}

/** " along Samson Road → Rizal Avenue" for a walking / tricycle path that follows named streets ("" if none are known). */
function viaRoads(names) {
  return names && names.length ? ` along ${names.slice(0, 3).join(' → ')}` : '';
}

function signboard(L) {
  // buses carry a route NUMBER ("Route 14"); jeepneys/UV vans are identified by their origin-destination signboard
  if (L.mode === 'bus' || L.mode === 'carousel') return L.ref ? `Route ${L.ref} – ${L.name}` : L.name;
  return L.ref && L.mode === 'jeepney' ? `${L.name} (code ${L.ref})` : L.name;
}

function describeItinerary(it, ctx, planner) {
  const net = planner.net;
  const places = planner.places;
  const steps = [];
  const warnings = new Set();
  const modeChain = [];
  const disc = ctx.passenger !== 'regular';
  const discLabel = { student: 'student', senior: 'senior citizen', pwd: 'PWD' }[ctx.passenger];

  const fromName = ctx.from.name || 'your starting point';
  const toName = ctx.to.name || 'your destination';

  it.legs.forEach((leg, idx) => {
    const next = it.legs[idx + 1];
    if (leg.type === 'walk') {
      const dir = geo.compass(leg.bearing);
      let target;
      if (leg.role === 'to-destination') target = toName;
      else if (next && next.type === 'ride') target = pointLabel(next.board, places);
      else target = pointLabel(leg.to, places);
      const origin = leg.role === 'to-board' && idx === 0 ? fromName : pointLabel(leg.from, places);
      const via = viaRoads(leg.roadNames);
      let text = leg.role === 'to-destination'
        ? `Walk about ${dist(leg.distM)} (${mins(leg.minutes)}) ${dir} to ${toName}${via}.`
        : `Walk about ${dist(leg.distM)} (${mins(leg.minutes)}) ${dir} from ${origin} to ${target}${via}.`;
      const tips = [];
      if (leg.role === 'transfer') text = `Transfer: walk about ${dist(leg.distM)} (${mins(leg.minutes)}) ${dir} to ${target}${via}.`;
      if (next && next.type === 'ride' && next.mode === 'jeepney' && !next.board.isStop) {
        const head = headingAt(next.line, net.d[next.board.node]);
        tips.push(`Wait on the side of the road for vehicles heading ${head}.`);
      }
      steps.push({ type: 'walk', mode: 'walk', title: leg.role === 'to-destination' ? 'Walk to your destination' : `Walk to ${target}`, text, tips, minutes: Math.round(leg.minutes), distanceM: leg.distM, legIndex: idx });
    } else if (leg.type === 'tricycle') {
      const dir = geo.compass(leg.bearing);
      const where = leg.role === 'access' ? `from ${fromName} to ${pointLabel(next.board, places)}` : `from ${pointLabel(leg.from, places)} to ${toName}`;
      const km = (leg.distM / 1000).toFixed(1);
      const f = leg.fare;
      steps.push({
        type: 'tricycle', mode: 'tricycle',
        title: leg.role === 'access' ? 'Take a tricycle to the main road' : 'Take a tricycle to your destination',
        text: `Take a tricycle ${dir} ${where}${viaRoads(leg.roadNames)} (about ${km} km, ${mins(leg.rideMin)}). Ask the driver for the fare first - expect around ${peso(f.regular)}${leg.city ? ` in ${leg.city}` : ''}.`,
        tips: [net.modes.tricycle.boardingTip, f.confidence === 'estimate' ? 'Tricycle fare is only an estimate - fares differ per TODA and are often negotiated.' : 'Fare follows the city matrix; confirm with the driver before riding.'],
        minutes: Math.round(leg.minutes), distanceM: leg.distM, fare: { regular: f.regular, discounted: f.discounted }, legIndex: idx,
      });
      modeChain.push({ mode: 'tricycle', label: 'Tricycle', ref: null });
      if (f.confidence === 'estimate') warnings.add('Tricycle fares are estimates and are usually negotiated with the driver.');
    } else if (leg.type === 'ride') {
      const L = leg.line;
      const mc = net.modes[L.mode];
      const boardTxt = pointLabel(leg.board, places);
      const alightTxt = pointLabel(leg.alight, places);
      const heading = headingAt(L, net.d[leg.board.node]);
      const sign = signboard(L);
      const noun = MODE_NOUN[L.mode] || L.mode;
      const f = leg.fare;

      let board;
      switch (L.mode) {
        case 'train':
          board = `Enter ${boardTxt}${/station/i.test(boardTxt) ? '' : ' Station'}. Buy a single-journey ticket or tap your Beep card, then take the train toward ${L.to || 'the end of the line'}.`;
          break;
        case 'carousel':
          board = `Go to the ${boardTxt} busway station and board the EDSA Carousel bus${L.to ? ` toward ${L.to}` : ''}.`;
          break;
        case 'uv':
          board = `Go to ${boardTxt} and join the queue for the UV Express van marked “${L.name}”.`;
          break;
        case 'bus':
          board = `Wait at ${boardTxt} for a bus marked “${sign}”. Buses heading ${heading} stop here.`;
          break;
        default: // jeepney
          board = leg.board.isStop
            ? `Wait at ${boardTxt} for a jeepney with the signboard “${sign}”.`
            : `Wait at ${boardTxt}, on the side of the road for vehicles heading ${heading}. Flag down a jeepney with the signboard “${sign}”.`;
      }

      const stopsTxt = leg.stopsPassed !== null && leg.stopsPassed > 0 ? `, passing ${leg.stopsPassed} stop${leg.stopsPassed > 1 ? 's' : ''}` : '';
      const viaTxt = leg.roads.length ? ` along ${leg.roads.slice(0, 4).join(' → ')}` : '';
      let alightPhrase;
      if (L.mode === 'train') alightPhrase = `Get off at ${alightTxt}${/station/i.test(alightTxt) ? '' : ' Station'}.`;
      else if (L.mode === 'carousel') alightPhrase = `Get off at the ${alightTxt} busway station.`;
      else if (L.mode === 'uv') alightPhrase = `Tell the driver you are getting off at ${alightTxt}.`;
      else alightPhrase = `Tell the driver “Para po” when you reach ${alightTxt}.`;

      const fareTxt = `Fare: ${peso(f.regular)}${disc ? ` (${peso(f.discounted)} with ${discLabel} discount)` : ''}.`;
      const text = `${board} Ride about ${mins(leg.rideMin)} (${(leg.distM / 1000).toFixed(1)} km${stopsTxt})${viaTxt}. ${alightPhrase}`;

      const tips = [mc.boardingTip];
      if (leg.alsoLines && leg.alsoLines.length) {
        const names = leg.alsoLines.map((a) => (a.ref ? `${a.ref} ${a.name}` : a.name));
        tips.push(`These signboards also go the same way, so take whichever comes first: ${names.map((n) => `“${n}”`).join(', ')}.`);
      }
      if (L.aircon === true) tips.push('This service is air-conditioned, so the fare may be a little higher than the ordinary-bus rate.');
      if (L.mode === 'bus' && L.aircon === null) tips.push('If the bus is air-conditioned the fare is about ₱3 higher.');
      if (L.mode === 'train' && leg.stationsList && leg.stationsList.length) tips.push(`Stations on the way: ${leg.stationsList.join(', ')}.`);
      if (L.source === 'dotc-gtfs') {
        warnings.add('Some jeepney routes come from older LTFRB data and may have changed. Always check the signboard and ask the driver or barker before riding.');
        tips.push('Route from older LTFRB data - confirm the signboard with the driver.');
      }
      if (L.confidence === 'low' && L.source !== 'dotc-gtfs') warnings.add('One or more routes in this trip have low data confidence - double-check them before you go.');
      if (f.confidence === 'estimate') warnings.add('Some fares are estimates. Check the posted fare matrix.');
      if (f.confidence === 'reported' && L.mode === 'train') tips.push('Train fare is interpolated from the published matrix - check lrmc.ph for the exact price.');

      steps.push({
        type: 'ride', mode: L.mode, title: `${mc.label}: ${sign}`, text, tips,
        board: { name: boardTxt, lat: leg.board.lat, lng: leg.board.lng }, alight: { name: alightTxt, lat: leg.alight.lat, lng: leg.alight.lng },
        signboard: sign, fareText: fareTxt, fare: { regular: f.regular, discounted: f.discounted, confidence: f.confidence, label: f.label },
        minutes: Math.round(leg.minutes), waitMin: Math.round(leg.waitMin), rideMin: Math.round(leg.rideMin), distanceM: leg.distM, legIndex: idx,
      });
      modeChain.push({ mode: L.mode, label: mc.label, ref: L.ref, name: L.name, colour: L.colour });
      leg.signboard = sign;
    }
  });

  if (!(it.legs.length === 1 && it.legs[0].type === 'walk')) {
    steps.push({ type: 'arrive', mode: 'walk', title: `Arrive at ${toName}`, text: `You have arrived at ${toName}.`, tips: [], minutes: 0, distanceM: 0, legIndex: it.legs.length });
  }
  if (ctx.period === 'amPeak' || ctx.period === 'pmPeak') warnings.add('Times assume rush-hour traffic, so road trips take longer than usual.');

  it.steps = steps.map((s, i) => ({ n: i + 1, ...s }));
  it.modeChain = modeChain;
  it.warnings = [...warnings];
  it.summary = it.legs.some((l) => l.type !== 'walk')
    ? modeChain.map((m) => (m.ref ? `${m.label} ${m.ref}` : m.label)).join(' → ')
    : 'Walk';
  return it;
}

module.exports = { describeItinerary, pointLabel, peso, mins, dist };
