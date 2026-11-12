'use strict';
/**
 * Build-time helpers that make a route polyline follow real roads (using the road graph from src/roads.js):
 *   snapToRoads   a line that only has STOPS (the legacy GTFS jeepneys): route stop-to-stop along motor roads
 *   fillGaps      an OSM route whose ways do not quite touch: bridge each gap along the roads instead of a straight jump
 *   alongMonotone distance along a polyline for a list of points, never going backwards
 * Wherever no sensible road path is found, the original straight piece is kept, so this can only ever improve a line.
 */
const geo = require('../../src/geo');

const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;

/**
 * Map-match a list of stops onto the road network (Viterbi). The legacy GTFS stop coordinates are only accurate to
 * ~50 m (longitudes were rounded to 3 decimals), so the nearest road to a stop is often the wrong one - the opposite
 * carriageway, a parallel street - and routing between those nearest roads makes absurd detours. Instead every stop
 * gets several candidate roads, and the combination with the cheapest path along the whole line wins.
 *
 * @param {Roads} roads
 * @param {[number, number][]} pts   [lng,lat] stops in travel order
 * @returns {{ pts, joins, stopPts, matched, straight }}
 *   pts      the road-following polyline;  joins[i] = index in pts of stop i;
 *   stopPts  where each stop really is: moved onto its matched road (unchanged if no road was found near it);
 *   matched / straight = how many stop-to-stop pieces follow roads / were left as a straight line.
 */
function snapToRoads(roads, pts, { maxSnapM = 100, k = 5, lambda = 1.5, ratio = 1.7, slackM = 120, minSegM = 20 } = {}) {
  const n = pts.length;
  const cands = pts.map((p) => roads.snapMany('veh', p[1], p[0], maxSnapM, k));
  const at = (i) => ({ lat: pts[i][1], lng: pts[i][0] });
  const hop = (i) => geo.haversine(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);

  // ---- Viterbi: score[i][c] = cheapest way to be on candidate c of stop i; prev[i][c] = the candidate used at stop i-1
  const score = [], prev = [];
  const cost = (i, p, c) => { // path cost of stop i-1 on candidate p -> stop i on candidate c (without the hops to/from the roads)
    const d = hop(i - 1);
    const sa = cands[i - 1][p], sb = cands[i][c];
    const r = roads.routeSnapped('veh', at(i - 1), at(i), sa, sb, { maxCost: (d * ratio + slackM) * 2 });
    return r ? r.cost - r.offRoadM : Infinity;
  };
  const chosen = new Array(n).fill(-1);
  const linked = new Array(n).fill(false); // is the hop i-1 -> i part of one Viterbi chain?
  const finishRun = (start, end) => {
    let c = 0;
    for (let q = 1; q < score[end].length; q++) if (score[end][q] < score[end][c]) c = q;
    for (let i = end; i >= start; i--) { chosen[i] = c; if (i > start) c = prev[i][c]; }
  };
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    if (!cands[i].length) { if (runStart >= 0) finishRun(runStart, i - 1); runStart = -1; score[i] = []; prev[i] = []; continue; }
    const emission = cands[i].map((c) => lambda * c.dist);
    if (runStart < 0) { runStart = i; score[i] = emission; prev[i] = []; continue; }
    const sc = new Array(cands[i].length).fill(Infinity), pv = new Array(cands[i].length).fill(-1);
    for (let c = 0; c < cands[i].length; c++) {
      for (let p = 0; p < cands[i - 1].length; p++) {
        if (score[i - 1][p] === Infinity) continue;
        const v = score[i - 1][p] + cost(i, p, c) + emission[c];
        if (v < sc[c]) { sc[c] = v; pv[c] = p; }
      }
    }
    if (sc.every((v) => v === Infinity)) { // no road connection from the previous stop at all: end the chain here and start a new one
      finishRun(runStart, i - 1);
      runStart = i; score[i] = emission; prev[i] = [];
    } else { score[i] = sc; prev[i] = pv; linked[i] = true; }
  }
  if (runStart >= 0) finishRun(runStart, n - 1);

  // ---- assemble the polyline
  const pos = pts.map((p, i) => (chosen[i] >= 0 ? [cands[i][chosen[i]].lng, cands[i][chosen[i]].lat] : p));
  const out = [], joins = [];
  let matched = 0, straight = 0;
  const push = (p) => { if (!out.length || !same(out[out.length - 1], p)) out.push(p); };
  for (let i = 0; i < n - 1; i++) {
    const d = hop(i);
    let r = null;
    if (linked[i + 1] && d >= minSegM) r = roads.routeSnapped('veh', at(i), at(i + 1), cands[i][chosen[i]], cands[i + 1][chosen[i + 1]], { maxCost: (d * ratio + slackM) * 2 });
    // accept only a believable path: not absurdly longer than the straight distance between the two stops
    if (r && r.road.length >= 2 && r.distM - r.offRoadM <= d * ratio + slackM) {
      push(pos[i]); joins.push(out.length - 1);
      for (const q of r.road) push(q);
      push(pos[i + 1]);
      matched++;
    } else if (linked[i + 1] && d < minSegM) { // two stops on top of each other
      push(pos[i]); joins.push(out.length - 1);
      push(pos[i + 1]);
    } else {
      push(pos[i]); joins.push(out.length - 1);
      push(pos[i + 1]);
      straight++;
    }
  }
  joins.push(out.length - 1);
  return { pts: out, joins, stopPts: pos, matched, straight };
}

/**
 * @param {Roads} roads
 * @param {{pts: [number, number][], gaps?: {at: number, jumpM: number}[]}} run  a stitched OSM route (scripts/lib/osm.js)
 * @returns {{ pts, filled, left }}
 */
function fillGaps(roads, run, { minJumpM = 12, maxSnapM = 40, ratio = 3, slackM = 80 } = {}) {
  if (!run.gaps || !run.gaps.length) return { pts: run.pts, filled: 0, left: 0 };
  const at = new Map(run.gaps.map((g) => [g.at, g]));
  const out = [];
  let filled = 0, left = 0;
  run.pts.forEach((p, i) => {
    const g = at.get(i);
    if (g && g.jumpM >= minJumpM && out.length) {
      const a = out[out.length - 1];
      const r = roads.route('veh', { lat: a[1], lng: a[0] }, { lat: p[1], lng: p[0] }, { maxSnapM });
      if (r && r.road.length >= 2 && r.distM - r.offRoadM <= g.jumpM * ratio + slackM) { for (const q of r.road) out.push(q); filled++; } else left++;
    }
    out.push(p);
  });
  return { pts: out, filled, left };
}

/** Distance along (pts, cum) of each point in `points`, in order and never decreasing (so a route that revisits a street keeps its stops in sequence). */
function alongMonotone(pts, cum, points, windowM = 8000) {
  const res = [];
  let seg = 0, last = 0;
  for (const [lng, lat] of points) {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110574;
    let best = { d: Infinity, along: last, seg };
    for (let s = seg; s < pts.length - 1; s++) {
      if (cum[s] > last + windowM && best.d < Infinity) break;
      const ax = (pts[s][0] - lng) * kx, ay = (pts[s][1] - lat) * ky;
      const dx = (pts[s + 1][0] - pts[s][0]) * kx, dy = (pts[s + 1][1] - pts[s][1]) * ky;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < best.d - 1e-9) best = { d, along: cum[s] + t * (cum[s + 1] - cum[s]), seg: s };
    }
    last = Math.max(last, best.along);
    seg = best.seg;
    res.push(last);
  }
  return res;
}

module.exports = { snapToRoads, fillGaps, alongMonotone };
