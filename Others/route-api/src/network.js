'use strict';
/**
 * The transit network the planner searches.
 *
 * A compiled network file (data/network.json, produced by scripts/build-network.js) holds LINES: one per
 * route and direction, each with a polyline, optional named stops, and metadata (mode, fare class, ...).
 *
 * At load time every line is turned into NODES - the places where a passenger can board or alight:
 *   - boarding 'stops'    : only at its named stops (trains, EDSA Carousel, UV terminals, bus stops)
 *   - boarding 'anywhere' : at a flag-down point every ~250 m along the route (jeepneys can be hailed
 *                           anywhere), plus any named stops
 * Nodes of one line are numbered consecutively, in travel order, so "ride from node i to node j" is simply
 * a range scan.
 */
const fs = require('fs');
const geo = require('./geo');

class Network {
  /**
   * @param {object} data   parsed network.json ({ meta, lines })
   * @param {object} modes  parsed modes.json
   */
  constructor(data, modes) {
    this.meta = data.meta || {};
    this.modes = modes.modes;
    this.planning = modes.planning;
    this.lines = [];
    this.lineById = new Map();

    const lat = [], lng = [], line = [], d = [], name = [], isStop = [];
    const spacing = this.planning.hailSpacingM;

    for (const raw of data.lines) {
      const mode = this.modes[raw.mode];
      if (!mode || !raw.pts || raw.pts.length < 2) continue;
      const cum = geo.cumulative(raw.pts);
      const length = cum[cum.length - 1];
      if (length < 300) continue; // too short to be a useful ride

      const L = {
        idx: this.lines.length,
        id: raw.id,
        mode: raw.mode,
        ref: raw.ref || null,
        name: raw.name,
        from: raw.from || null,
        to: raw.to || null,
        via: raw.via || null,
        operator: raw.operator || null,
        colour: raw.colour || null,
        source: raw.source || 'unknown',
        confidence: raw.confidence || 'medium',
        fareClass: raw.fareClass,
        intervalMin: raw.intervalMin || null,
        aircon: raw.aircon === undefined ? null : raw.aircon,
        boarding: raw.boarding || (mode.hail ? 'anywhere' : 'stops'),
        pts: raw.pts,
        cum,
        length,
        stops: raw.stops || [],
        roads: raw.roads || [],
        nodeStart: lat.length,
        nodeEnd: 0,
      };

      // ---- boarding / alighting nodes ----
      const stops = L.stops.slice().sort((a, b) => a[2] - b[2]);
      const nodes = []; // [d, lat, lng, name|null, isStop]
      const useStopsOnly = L.boarding === 'stops' && stops.length >= 2;
      if (useStopsOnly) {
        for (const s of stops) nodes.push([s[2], s[1], s[0], s[3] || null, 1]);
      } else {
        const sp = L.boarding === 'anywhere' ? spacing : spacing * 2;
        const stopDs = stops.map((s) => s[2]);
        const samples = [];
        for (let x = 0; x < length; x += sp) samples.push(x);
        samples.push(length);
        for (const x of samples) {
          // skip a flag-down point that would sit right next to a named stop - the stop replaces it
          if (stopDs.some((sd) => Math.abs(sd - x) < sp * 0.4)) continue;
          const p = geo.pointAt(L.pts, cum, x);
          nodes.push([x, p[1], p[0], null, 0]);
        }
        for (const s of stops) nodes.push([s[2], s[1], s[0], s[3] || null, 1]);
        nodes.sort((a, b) => a[0] - b[0]);
      }
      if (nodes.length < 2) continue;

      for (const n of nodes) {
        d.push(n[0]); lat.push(n[1]); lng.push(n[2]); name.push(n[3]); isStop.push(n[4]); line.push(L.idx);
      }
      L.nodeEnd = lat.length;
      this.lines.push(L);
      this.lineById.set(L.id, L);
    }

    this.nodeCount = lat.length;
    this.lat = Float64Array.from(lat);
    this.lng = Float64Array.from(lng);
    this.d = Float64Array.from(d);
    this.line = Int32Array.from(line);
    this.name = name;
    this.isStop = Uint8Array.from(isStop);

    this._nb = new Array(this.nodeCount); // lazily filled by neighbors() (straight-line version)
    this._nbRoads = new Map();            // road map -> its own lazily filled neighbour lists
    this.grid = new geo.GridIndex(0.003);
    for (let i = 0; i < this.nodeCount; i++) this.grid.add(i, this.lat[i], this.lng[i]);
  }

  static fromFiles(networkPath, modesPath) {
    return new Network(JSON.parse(fs.readFileSync(networkPath, 'utf8')), JSON.parse(fs.readFileSync(modesPath, 'utf8')));
  }

  /** Node ids within radiusM metres of a point: [{ node, distM }] sorted nearest first. */
  nodesNear(lat, lng, radiusM) {
    const out = [];
    for (const id of this.grid.candidates(lat, lng, radiusM)) {
      const dm = geo.haversine(lat, lng, this.lat[id], this.lng[id]);
      if (dm <= radiusM) out.push({ node: id, distM: dm });
    }
    return out.sort((a, b) => a.distM - b.distM);
  }

  /**
   * Boarding points of OTHER lines a rider can walk to from a node: { ids: Int32Array, d: Float32Array }, where d is
   * the WALKING distance in metres. Candidates are the nearest points as the crow flies (transferWalkM); with a road
   * map their distance is the real walk along streets, and any that are not reachable within the limit (a river or
   * an expressway in between) are dropped; without one it is the straight line times the detour factor.
   * Computed lazily and cached (separately per road map), because the planner asks for the same nodes over and
   * over while searching.
   */
  neighbors(node, roads = null) {
    let cache = this._nb;
    if (roads) {
      cache = this._nbRoads.get(roads);
      if (!cache) { cache = new Array(this.nodeCount); this._nbRoads.set(roads, cache); }
    }
    let nb = cache[node];
    if (nb) return nb;
    const R = this.planning.transferWalkM;
    const lat0 = this.lat[node], lng0 = this.lng[node];
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const ky = 110574;
    const own = this.line[node];
    // keep only the 2 nearest boarding points of each neighbouring line: boarding at a line's nearest points is
    // (almost) always best, and it cuts the search work by about half
    const best = new Map(); // line -> [[dist,node], [dist,node]]
    for (const k of this.grid.candidates(lat0, lng0, R)) {
      const lk = this.line[k];
      if (lk === own) continue;
      const dm = Math.hypot((this.lng[k] - lng0) * kx, (this.lat[k] - lat0) * ky);
      if (dm > R) continue;
      let arr = best.get(lk);
      if (!arr) best.set(lk, (arr = []));
      arr.push([dm, k]);
      if (arr.length > 2) { arr.sort((a, b) => a[0] - b[0]); arr.length = 2; }
    }
    const detour = this.modes.walk.detourFactor;
    const limit = R * detour; // the longest walk a transfer may be, however it is measured
    const reach = roads ? roads.reach('foot', { lat: lat0, lng: lng0 }, limit, { key: node }) : null;
    const ids = [], ds = [];
    for (const arr of best.values()) {
      for (const [dm, k] of arr) {
        let walk = dm * detour;
        if (reach) {
          const road = reach.distTo(this.lat[k], this.lng[k], k); // null = a point with no road nearby: keep the estimate
          if (road !== null) { if (road > limit) continue; walk = road; }
        }
        ids.push(k); ds.push(walk);
      }
    }
    nb = { ids: Int32Array.from(ids), d: Float32Array.from(ds) };
    cache[node] = nb;
    return nb;
  }

  /**
   * Fill the neighbour cache for every node (a few seconds of work, ~15 s with a road map). Done in small slices
   * after start-up so the server answers immediately and stays responsive; trips planned meanwhile simply compute
   * what they need.
   */
  async warmUp(sliceSize = 1500, roads = null) {
    const t0 = Date.now();
    for (let i = 0; i < this.nodeCount; i++) {
      this.neighbors(i, roads);
      if (i % sliceSize === sliceSize - 1) await new Promise((resolve) => setImmediate(resolve));
    }
    return Date.now() - t0;
  }

  lineOf(node) { return this.lines[this.line[node]]; }

  /** Road name at distance d (m) along a line, from the run-length road list [[d, name], ...]. */
  roadAt(L, dist) {
    const r = L.roads;
    if (!r || !r.length) return null;
    let lo = 0, hi = r.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (r[mid][0] <= dist) lo = mid; else hi = mid - 1;
    }
    return r[lo][1] || null;
  }

  /** Distinct road names travelled between two distances along a line, in order. */
  roadsBetween(L, d0, d1) {
    const r = L.roads;
    if (!r || !r.length) return [];
    const out = [];
    let cur = this.roadAt(L, d0);
    if (cur) out.push(cur);
    for (const [rd, rn] of r) {
      if (rd > d0 && rd < d1 && rn && rn !== out[out.length - 1]) out.push(rn);
    }
    return out;
  }

  /** Best human name for a node: its stop name, else "<road> (flag-down point)". */
  nodeLabel(node) {
    if (this.name[node]) return this.name[node];
    const L = this.lineOf(node);
    return this.roadAt(L, this.d[node]) || null;
  }

  stats() {
    const byMode = {};
    for (const L of this.lines) byMode[L.mode] = (byMode[L.mode] || 0) + 1;
    return { lines: this.lines.length, nodes: this.nodeCount, byMode };
  }
}

module.exports = { Network };
