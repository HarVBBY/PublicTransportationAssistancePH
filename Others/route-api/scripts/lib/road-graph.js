'use strict';
/**
 * Turns OpenStreetMap highway ways into the compact routing graph used by src/roads.js.
 *
 *   way record = { i: wayId, t: {tags}, n: [nodeIds], g: [lat, lon, lat, lon, ...] }   (see scripts/fetch-roads.js)
 *
 * Junction nodes (shared by two ways, or the end of a way) become graph nodes; the stretch of road between two
 * junctions becomes one edge that remembers its full shape. Who may use an edge (walk / tricycle / jeepney, one-way
 * rules) is decided here from the OSM tags.
 */
const geo = require('../../src/geo');
const { FLAG, CLS } = require('../../src/roads');

const ALL = FLAG.FOOT | FLAG.TRIKE | FLAG.VEH;
const TABLE = {
  motorway: [CLS.motorway, FLAG.VEH],
  trunk: [CLS.trunk, ALL],
  primary: [CLS.primary, ALL],
  secondary: [CLS.secondary, ALL],
  tertiary: [CLS.tertiary, ALL],
  unclassified: [CLS.unclassified, ALL],
  residential: [CLS.residential, ALL],
  living_street: [CLS.living_street, ALL],
  service: [CLS.service, ALL],
  road: [CLS.other, ALL],
  busway: [CLS.busway, FLAG.VEH],
  track: [CLS.track, FLAG.FOOT | FLAG.TRIKE],
  pedestrian: [CLS.pedestrian, FLAG.FOOT],
  footway: [CLS.footway, FLAG.FOOT],
  path: [CLS.path, FLAG.FOOT],
  steps: [CLS.steps, FLAG.FOOT],
  cycleway: [CLS.cycleway, FLAG.FOOT],
};
const LINKABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const NOT_FOR_VEHICLES = /^(parking_aisle|driveway|drive-through|emergency_access)$/;
const deny = (v) => v === 'no' || v === 'private';
const allow = (v) => v === 'yes' || v === 'designated' || v === 'permissive' || v === 'destination' || v === 'delivery';

/** OSM tags -> { cls, flags, ow (0 both ways, 1 forward only, -1 backward only), name } or null if not routable. */
function classify(t) {
  let hw = t.highway;
  if (!hw || t.area === 'yes') return null;
  const m = /^(.*)_link$/.exec(hw);
  if (m && LINKABLE.has(m[1])) hw = m[1];
  const row = TABLE[hw];
  if (!row) return null;
  let [cls, flags] = row;
  if (hw === 'service' && NOT_FOR_VEHICLES.test(t.service || '')) flags = FLAG.FOOT;

  const motorBlocked = deny(t.motor_vehicle) || (deny(t.vehicle) && !allow(t.motor_vehicle)) || (deny(t.access) && !allow(t.motor_vehicle) && !allow(t.vehicle));
  const footBlocked = deny(t.foot) || (deny(t.access) && !allow(t.foot));
  if (motorBlocked) flags &= ~(FLAG.TRIKE | FLAG.VEH);
  if (footBlocked) flags &= ~FLAG.FOOT;
  if (!flags) return null;

  let ow = 0;
  const o = t.oneway;
  if (o === 'yes' || o === 'true' || o === '1') ow = 1;
  else if (o === '-1' || o === 'reverse') ow = -1;
  else if (!o && (t.junction === 'roundabout' || t.junction === 'circular' || hw === 'motorway')) ow = 1;
  return { cls, flags, ow, name: t.name || t.ref || null };
}

/**
 * @param {object[]} rawWays
 * @param {{minComponent?: number, simplifyM?: number}} [opts]
 * @returns {{ data: object, stats: object }}  data is ready for roads.encode()
 */
function buildGraph(rawWays, { minComponent = 80, simplifyM = 1.5 } = {}) {
  const seen = new Set();
  const ways = [];
  const classes = {};
  for (const w of rawWays) {
    if (seen.has(w.i)) continue; // a way crossing a tile edge is delivered by both tiles
    seen.add(w.i);
    if (!w.n || w.n.length < 2 || w.g.length !== w.n.length * 2) continue;
    const c = classify(w.t || {});
    if (!c) continue;
    ways.push({ w, c });
    classes[w.t.highway] = (classes[w.t.highway] || 0) + 1;
  }

  // which nodes are junctions?
  const usage = new Map();
  for (const { w } of ways) for (const id of w.n) usage.set(id, (usage.get(id) || 0) + 1);

  const idxOf = new Map();
  const nLat = [], nLng = [];
  const node = (id, lat, lng) => {
    let i = idxOf.get(id);
    if (i === undefined) { i = nLat.length; idxOf.set(id, i); nLat.push(lat); nLng.push(lng); }
    return i;
  };

  const names = [], nameIdx = new Map();
  const nameId = (s) => { if (!s) return -1; let i = nameIdx.get(s); if (i === undefined) { i = names.length; nameIdx.set(s, i); names.push(s); } return i; };

  const E = { u: [], v: [], name: [], flags: [], cls: [], pts: [] }; // pts: interior [lat,lng,...] per edge
  for (const { w, c } of ways) {
    let ids = w.n;
    let g = w.g;
    if (c.ow === -1) {
      ids = ids.slice().reverse();
      const r = [];
      for (let k = ids.length - 1; k >= 0; k--) r.push(g[2 * k], g[2 * k + 1]);
      g = r;
    }
    const flags = c.flags | (c.ow !== 0 && (c.flags & (FLAG.TRIKE | FLAG.VEH)) ? FLAG.ONEWAY : 0);
    const nm = nameId(c.name);
    let startK = 0;
    for (let k = 1; k < ids.length; k++) {
      if (k !== ids.length - 1 && usage.get(ids[k]) < 2) continue; // an ordinary point along the road
      const line = [];
      for (let q = startK; q <= k; q++) line.push([g[2 * q + 1], g[2 * q]]); // [lng, lat]
      const u = node(ids[startK], g[2 * startK], g[2 * startK + 1]);
      const v = node(ids[k], g[2 * k], g[2 * k + 1]);
      startK = k;
      const kept = line.length > 2 ? geo.simplify(line, simplifyM) : line;
      const interior = [];
      for (let q = 1; q < kept.length - 1; q++) interior.push(kept[q][1], kept[q][0]);
      if (u === v && interior.length < 4) continue; // a degenerate loop
      E.u.push(u); E.v.push(v); E.name.push(nm); E.flags.push(flags); E.cls.push(c.cls); E.pts.push(interior);
    }
  }

  // drop tiny disconnected islands (private compounds, mapping fragments)
  const nN0 = nLat.length;
  const parent = new Int32Array(nN0).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let e = 0; e < E.u.length; e++) { const a = find(E.u[e]), b = find(E.v[e]); if (a !== b) parent[a] = b; }
  const size = new Int32Array(nN0);
  for (let i = 0; i < nN0; i++) size[find(i)]++;
  const newIdx = new Int32Array(nN0).fill(-1);
  let nN = 0;
  for (let i = 0; i < nN0; i++) if (size[find(i)] >= minComponent) newIdx[i] = nN++;

  const keptEdges = [];
  for (let e = 0; e < E.u.length; e++) if (newIdx[E.u[e]] >= 0) keptEdges.push(e);
  const nE = keptEdges.length;
  let nG = 0;
  for (const e of keptEdges) nG += E.pts[e].length / 2;

  const data = {
    names,
    meta: {},
    nLat: new Int32Array(nN), nLng: new Int32Array(nN),
    eU: new Int32Array(nE), eV: new Int32Array(nE), eName: new Int32Array(nE), eGeoOff: new Int32Array(nE),
    eGeoCnt: new Uint16Array(nE), eFlags: new Uint8Array(nE), eCls: new Uint8Array(nE),
    gLat: new Int32Array(nG), gLng: new Int32Array(nG),
  };
  for (let i = 0; i < nN0; i++) if (newIdx[i] >= 0) { data.nLat[newIdx[i]] = Math.round(nLat[i] * 1e6); data.nLng[newIdx[i]] = Math.round(nLng[i] * 1e6); }
  let gp = 0;
  keptEdges.forEach((e, k) => {
    data.eU[k] = newIdx[E.u[e]]; data.eV[k] = newIdx[E.v[e]]; data.eName[k] = E.name[e];
    data.eFlags[k] = E.flags[e]; data.eCls[k] = E.cls[e];
    const p = E.pts[e];
    data.eGeoOff[k] = gp; data.eGeoCnt[k] = p.length / 2;
    for (let q = 0; q < p.length; q += 2) { data.gLat[gp] = Math.round(p[q] * 1e6); data.gLng[gp] = Math.round(p[q + 1] * 1e6); gp++; }
  });

  return { data, stats: { ways: ways.length, classes, nodesBeforePrune: nN0, nodes: nN, edges: nE, shapePoints: nG, namedRoads: names.length, droppedNodes: nN0 - nN } };
}

module.exports = { classify, buildGraph };
