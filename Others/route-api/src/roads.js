'use strict';
/**
 * Road-network router: finds paths that FOLLOW REAL STREETS, so walking, tricycle and (at build time) jeepney
 * geometry is no longer a straight line "as the crow flies".
 *
 * The graph comes from OpenStreetMap highways (scripts/build-roads.js -> data/roads.bin.gz). Every edge is a piece of
 * road between two junctions and keeps its full shape. Three profiles describe who may use which edge:
 *   foot   walking: every street, lane, footpath and stairway, in both directions
 *   trike  tricycles: ordinary streets, one-way rules obeyed, highways allowed but discouraged
 *   veh    jeepneys / buses (used when drawing routes): motor roads, one-way rules obeyed, small lanes discouraged
 * Costs are length x a per-road-class multiplier (always >= 1, so straight-line distance is an admissible A* bound).
 */
const fs = require('fs');
const zlib = require('zlib');
const geo = require('./geo');
const { MinHeap } = require('./heap');

const FLAG = { FOOT: 1, TRIKE: 2, VEH: 4, ONEWAY: 8 };
const CLS_LIST = ['other', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'busway', 'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track'];
const CLS = Object.fromEntries(CLS_LIST.map((n, i) => [n, i]));

const mult = (o) => { const a = new Float32Array(CLS_LIST.length).fill(1); for (const [k, v] of Object.entries(o)) a[CLS[k]] = v; return a; };
const PROFILES = {
  foot: { flag: FLAG.FOOT, directed: false, mult: mult({ steps: 1.5 }) },
  trike: { flag: FLAG.TRIKE, directed: true, mult: mult({ trunk: 1.7, primary: 1.4, secondary: 1.1, service: 1.15, track: 1.3 }) },
  veh: { flag: FLAG.VEH, directed: true, mult: mult({ tertiary: 1.05, unclassified: 1.3, residential: 1.5, living_street: 2.5, service: 4, busway: 3 }) },
};

// ------------------------------------------------------------------ binary file format
const MAGIC = 0x31445250; // "PRD1"
const pad4 = (n) => (4 - (n % 4)) % 4;
const COUNT_OF = { n: 'nN', e: 'nE', g: 'nG' };
const FIELDS = [
  ['nLat', Int32Array, 'n'], ['nLng', Int32Array, 'n'],
  ['eU', Int32Array, 'e'], ['eV', Int32Array, 'e'], ['eName', Int32Array, 'e'], ['eGeoOff', Int32Array, 'e'],
  ['eGeoCnt', Uint16Array, 'e'], ['eFlags', Uint8Array, 'e'], ['eCls', Uint8Array, 'e'],
  ['gLat', Int32Array, 'g'], ['gLng', Int32Array, 'g'],
];

/** data: { names: string[], meta?: object, nLat, nLng (micro-degrees), eU, eV, eName, eGeoOff, eGeoCnt, eFlags, eCls, gLat, gLng } -> Buffer */
function encode(data) {
  const counts = { nN: data.nLat.length, nE: data.eU.length, nG: data.gLat.length };
  const header = Buffer.from(JSON.stringify({ version: 1, ...counts, names: data.names, meta: data.meta || {} }), 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(header.length, 4);
  const parts = [head, header, Buffer.alloc(pad4(8 + header.length))];
  for (const [name, , group] of FIELDS) {
    const arr = data[name];
    if (arr.length !== counts[COUNT_OF[group]]) throw new Error(`road data field ${name} has ${arr.length} entries, expected ${counts[COUNT_OF[group]]}`);
    parts.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), Buffer.alloc(pad4(arr.byteLength)));
  }
  return Buffer.concat(parts);
}

function decode(buf) {
  if (buf.length < 8 || buf.readUInt32LE(0) !== MAGIC) throw new Error('not a PUBTA road graph file');
  const hl = buf.readUInt32LE(4);
  const header = JSON.parse(buf.toString('utf8', 8, 8 + hl));
  // copy to a fresh, 4-byte-aligned ArrayBuffer (a Buffer from zlib may sit at an odd offset in a shared pool)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  let off = 8 + hl + pad4(8 + hl);
  const data = { names: header.names, meta: header.meta };
  for (const [name, Type, group] of FIELDS) {
    const n = header[COUNT_OF[group]];
    data[name] = new Type(ab, off, n);
    off += n * Type.BYTES_PER_ELEMENT;
    off += pad4(n * Type.BYTES_PER_ELEMENT);
  }
  return data;
}

// ------------------------------------------------------------------ router
const CELL = 0.002; // spatial grid cell, degrees (~215 m)
const MAX_POPS = 400000;

class Roads {
  /** @param {object} data  decoded graph  @param {{minWalkComponent?: number}} [opts]  ignore walkable fragments smaller than this many junctions (0 = keep all) */
  constructor(data, { minWalkComponent = 0 } = {}) {
    this.names = data.names;
    this.meta = data.meta || {};
    const nN = data.nLat.length, nE = data.eU.length;
    this.nN = nN; this.nE = nE;
    this.lat = new Float64Array(nN); this.lng = new Float64Array(nN);
    for (let i = 0; i < nN; i++) { this.lat[i] = data.nLat[i] / 1e6; this.lng[i] = data.nLng[i] / 1e6; }
    this.gLat = new Float64Array(data.gLat.length); this.gLng = new Float64Array(data.gLng.length);
    for (let i = 0; i < this.gLat.length; i++) { this.gLat[i] = data.gLat[i] / 1e6; this.gLng[i] = data.gLng[i] / 1e6; }
    this.eU = data.eU; this.eV = data.eV; this.eName = data.eName; this.eGeoOff = data.eGeoOff; this.eGeoCnt = data.eGeoCnt;
    this.eFlags = data.eFlags; this.eCls = data.eCls;

    // edge lengths from the stored shape, so costs and drawn geometry always agree
    this.len = new Float32Array(nE);
    for (let e = 0; e < nE; e++) this.len[e] = this._edgeLength(e);

    // adjacency (CSR): entry = edge * 2 + dir, dir 0 = leaving through U (towards V), 1 = leaving through V
    const deg = new Int32Array(nN + 1);
    for (let e = 0; e < nE; e++) { deg[this.eU[e]]++; deg[this.eV[e]]++; }
    this.adjStart = new Int32Array(nN + 1);
    for (let i = 0; i < nN; i++) this.adjStart[i + 1] = this.adjStart[i] + deg[i];
    this.adj = new Int32Array(this.adjStart[nN]);
    const fill = this.adjStart.slice(0, nN);
    for (let e = 0; e < nE; e++) { this.adj[fill[this.eU[e]]++] = e * 2; this.adj[fill[this.eV[e]]++] = e * 2 + 1; }

    // which pieces of the walkable network are connected at all (an expressway or a river can split it in two)
    const parent = new Int32Array(nN).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let e = 0; e < nE; e++) if (this.eFlags[e] & FLAG.FOOT) { const a = find(this.eU[e]), b = find(this.eV[e]); if (a !== b) parent[a] = b; }
    this.footComp = new Int32Array(nN);
    for (let i = 0; i < nN; i++) this.footComp[i] = find(i);
    // A walkable fragment of a few junctions (a stray footpath, a mapped stub) is not a real island: a bus stop
    // beside it would wrongly snap onto it and look cut off from everything. Treat such fragments as not walkable.
    if (minWalkComponent > 0) {
      const size = new Int32Array(nN);
      for (let i = 0; i < nN; i++) size[this.footComp[i]]++;
      this.eFlags = Uint8Array.from(this.eFlags);
      for (let e = 0; e < nE; e++) if ((this.eFlags[e] & FLAG.FOOT) && size[this.footComp[this.eU[e]]] < minWalkComponent) this.eFlags[e] &= ~FLAG.FOOT;
    }

    this._buildGrid();
    this._dist = new Float64Array(nN);
    this._seen = new Int32Array(nN);
    this._prev = new Int32Array(nN);
    this._q = 0;
    this._edgeStamp = new Int32Array(nE);
    this._snapQ = 0;
    this._snapCache = new Map();
  }

  static fromBuffer(buf, opts) { return new Roads(decode(buf), opts); }

  /** Loads data/roads.bin.gz. Walkable fragments under 100 junctions are ignored (see the constructor). */
  static fromFile(file, opts = { minWalkComponent: 100 }) {
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return Roads.fromBuffer(buf, opts);
  }

  stats() { return { nodes: this.nN, edges: this.nE, shapePoints: this.gLat.length, names: this.names.length, ...this.meta }; }

  // ------------------------------------------------------------ geometry helpers
  _edgeLength(e) {
    const u = this.eU[e], v = this.eV[e], off = this.eGeoOff[e], cnt = this.eGeoCnt[e];
    let pl = this.lat[u], pg = this.lng[u], total = 0;
    for (let i = 0; i <= cnt; i++) {
      const cl = i < cnt ? this.gLat[off + i] : this.lat[v];
      const cg = i < cnt ? this.gLng[off + i] : this.lng[v];
      total += geo.haversine(pl, pg, cl, cg);
      pl = cl; pg = cg;
    }
    return total;
  }

  /** [[lng,lat], ...] of an edge from U to V (both ends included). */
  _edgeLine(e) {
    const u = this.eU[e], v = this.eV[e], off = this.eGeoOff[e], cnt = this.eGeoCnt[e];
    const pts = [[this.lng[u], this.lat[u]]];
    for (let i = 0; i < cnt; i++) pts.push([this.gLng[off + i], this.gLat[off + i]]);
    pts.push([this.lng[v], this.lat[v]]);
    return pts;
  }

  /** The part of edge e between offsets a0 and a1 (metres from U), in travel order a0 -> a1. */
  _partial(e, a0, a1) {
    const pts = this._edgeLine(e);
    const cum = geo.cumulative(pts);
    const out = geo.slice(pts, cum, Math.max(0, Math.min(a0, a1)), Math.min(cum[cum.length - 1], Math.max(a0, a1)));
    return a0 <= a1 ? out : out.reverse();
  }

  _buildGrid() {
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    const eat = (la, lo) => { if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLng) minLng = lo; if (lo > maxLng) maxLng = lo; };
    for (let i = 0; i < this.nN; i++) eat(this.lat[i], this.lng[i]);
    for (let i = 0; i < this.gLat.length; i++) eat(this.gLat[i], this.gLng[i]);
    if (!Number.isFinite(minLat)) { minLat = minLng = 0; maxLat = maxLng = 0; }
    this.gridMinLat = minLat; this.gridMinLng = minLng;
    this.gw = Math.floor((maxLng - minLng) / CELL) + 1;
    this.gh = Math.floor((maxLat - minLat) / CELL) + 1;
    const cells = this.gw * this.gh;
    const stamp = new Int32Array(cells);
    const counts = new Int32Array(cells + 1);
    const visit = (e, fn) => {
      const u = this.eU[e], v = this.eV[e], off = this.eGeoOff[e], cnt = this.eGeoCnt[e];
      let pl = this.lat[u], pg = this.lng[u];
      for (let i = 0; i <= cnt; i++) {
        const cl = i < cnt ? this.gLat[off + i] : this.lat[v];
        const cg = i < cnt ? this.gLng[off + i] : this.lng[v];
        const x0 = Math.floor((Math.min(pg, cg) - minLng) / CELL), x1 = Math.floor((Math.max(pg, cg) - minLng) / CELL);
        const y0 = Math.floor((Math.min(pl, cl) - minLat) / CELL), y1 = Math.floor((Math.max(pl, cl) - minLat) / CELL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const c = y * this.gw + x;
          if (stamp[c] !== e + 1) { stamp[c] = e + 1; fn(c); }
        }
        pl = cl; pg = cg;
      }
    };
    for (let e = 0; e < this.nE; e++) visit(e, (c) => { counts[c + 1]++; });
    this.cellStart = new Int32Array(cells + 1);
    for (let c = 0; c < cells; c++) this.cellStart[c + 1] = this.cellStart[c] + counts[c + 1];
    this.cellEdges = new Int32Array(this.cellStart[cells]);
    const fill = this.cellStart.slice(0, cells);
    stamp.fill(0);
    for (let e = 0; e < this.nE; e++) visit(e, (c) => { this.cellEdges[fill[c]++] = e; });
  }

  // ------------------------------------------------------------ snapping
  /**
   * The nearest road (that profile may use) within maxM of a point:
   * { e, a (metres from the edge's U end), dist, lat, lng } or null.
   */
  snap(profile, lat, lng, maxM = 150) {
    const P = PROFILES[profile];
    if (!P) throw new Error(`unknown road profile ${profile}`);
    return this._scan(P, lat, lng, maxM, null);
  }

  /**
   * The k nearest DIFFERENT roads (that profile may use) within maxM of a point, nearest first. For noisy points
   * (the legacy GTFS stops are only accurate to ~50 m) the nearest road is often the wrong one, so map matching
   * considers several candidates.
   */
  snapMany(profile, lat, lng, maxM = 100, k = 5) {
    const P = PROFILES[profile];
    if (!P) throw new Error(`unknown road profile ${profile}`);
    const list = [];
    this._scan(P, lat, lng, maxM, list);
    list.sort((a, b) => a.dist - b.dist);
    return list.slice(0, k);
  }

  /** Walks the grid cells around a point; returns the nearest snap, or (if `list` is given) pushes the best snap of every edge into it. */
  _scan(P, lat, lng, maxM, list) {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
    const rc = Math.ceil(maxM / 200);
    const cx = Math.floor((lng - this.gridMinLng) / CELL), cy = Math.floor((lat - this.gridMinLat) / CELL);
    const q = ++this._snapQ;
    let best = null;
    for (let x = Math.max(0, cx - rc); x <= Math.min(this.gw - 1, cx + rc); x++) {
      for (let y = Math.max(0, cy - rc); y <= Math.min(this.gh - 1, cy + rc); y++) {
        const c = y * this.gw + x;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const e = this.cellEdges[k];
          if (this._edgeStamp[e] === q) continue;
          this._edgeStamp[e] = q;
          if (!(this.eFlags[e] & P.flag)) continue;
          const u = this.eU[e], v = this.eV[e], off = this.eGeoOff[e], cnt = this.eGeoCnt[e];
          let pl = this.lat[u], pg = this.lng[u], along = 0;
          let eb = null; // best point on THIS edge
          for (let i = 0; i <= cnt; i++) {
            const cl = i < cnt ? this.gLat[off + i] : this.lat[v];
            const cg = i < cnt ? this.gLng[off + i] : this.lng[v];
            const ax = (pg - lng) * kx, ay = (pl - lat) * ky, dx = (cg - pg) * kx, dy = (cl - pl) * ky;
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(ax + dx * t, ay + dy * t);
            const seg = Math.sqrt(l2);
            if (d <= maxM && (!eb || d < eb.dist)) eb = { e, dist: d, aRaw: along + seg * t, lat: pl + (cl - pl) * t, lng: pg + (cg - pg) * t };
            along += seg;
            pl = cl; pg = cg;
          }
          if (!eb) continue;
          eb.a = Math.min(this.len[e], along > 0 ? eb.aRaw * (this.len[e] / along) : 0);
          if (list) list.push(eb);
          else if (!best || eb.dist < best.dist) best = eb;
        }
      }
    }
    return best;
  }

  /** snap() remembered under a caller-chosen key (e.g. a transit node id) - those points never move. */
  snapCached(profile, key, lat, lng, maxM = 150) {
    const k = `${profile}:${key}`;
    let s = this._snapCache.get(k);
    if (s === undefined) { s = this.snap(profile, lat, lng, maxM); this._snapCache.set(k, s); }
    return s;
  }

  /**
   * Match every transit boarding point to the road map ahead of time (in small slices so the server stays responsive),
   * so the first trip planned after start-up is as fast as the rest. Returns the time taken in ms.
   */
  async warmSnaps(net, { slice = 1500, profiles = ['foot', 'trike'] } = {}) {
    const t0 = Date.now();
    for (let i = 0; i < net.nodeCount; i++) {
      for (const p of profiles) this.snapCached(p, i, net.lat[i], net.lng[i]);
      if (i % slice === slice - 1) await new Promise((resolve) => setImmediate(resolve));
    }
    return Date.now() - t0;
  }

  // ------------------------------------------------------------ search core
  /** Entry points into the graph from a snapped position: [{ node, cost, from: 'U'|'V' }]. */
  _startLabels(P, s, undirected) {
    const e = s.e, m = P.mult[this.eCls[e]], L = this.len[e];
    const free = undirected || !P.directed || !(this.eFlags[e] & FLAG.ONEWAY);
    const out = [{ node: this.eV[e], cost: (L - s.a) * m, to: 'V' }];
    if (free) out.push({ node: this.eU[e], cost: s.a * m, to: 'U' });
    return out;
  }

  /** Ways to finish at a snapped position: Map node -> cost of the last bit. */
  _endLabels(P, s, undirected) {
    const e = s.e, m = P.mult[this.eCls[e]], L = this.len[e];
    const free = undirected || !P.directed || !(this.eFlags[e] & FLAG.ONEWAY);
    const out = new Map();
    out.set(this.eU[e], s.a * m);
    if (free) { const c = (L - s.a) * m; const cur = out.get(this.eV[e]); if (cur === undefined || c < cur) out.set(this.eV[e], c); }
    return out;
  }

  /**
   * A* / Dijkstra from labelled start nodes. With `ends` (Map node -> final cost) stops at the cheapest total;
   * without it explores everything within maxCost. Returns { best, bestEnd, visited }.
   */
  _run(P, starts, ends, target, maxCost, undirected, collect) {
    const q = ++this._q;
    const dist = this._dist, seen = this._seen, prev = this._prev;
    const { adjStart, adj, eU, eV, eFlags, eCls, len } = this;
    const heap = new MinHeap();
    const kx = target ? 111320 * Math.cos((target.lat * Math.PI) / 180) : 0, ky = 110574;
    const h = target ? (n) => Math.hypot((this.lng[n] - target.lng) * kx, (this.lat[n] - target.lat) * ky) : () => 0;
    let best = Infinity, bestEnd = -1;
    const visited = collect ? [] : null;

    const relax = (n, c, code) => {
      if (c > maxCost) return;
      if (seen[n] === q) { if (dist[n] <= c) return; } else if (collect) visited.push(n);
      seen[n] = q; dist[n] = c; prev[n] = code;
      if (ends) {
        const ec = ends.get(n);
        if (ec !== undefined && c + ec < best) { best = c + ec; bestEnd = n; }
      }
      const f = c + h(n);
      if (f < best) heap.push(f, n);
    };
    starts.forEach((s, i) => relax(s.node, s.cost, -(i + 1)));

    let pops = 0;
    while (heap.size) {
      const n = heap.pop();
      const c = dist[n];
      if (heap.lastPriority > c + h(n) + 1e-6) continue; // stale entry
      if (heap.lastPriority >= best) break;
      if (++pops > MAX_POPS) break;
      for (let k = adjStart[n]; k < adjStart[n + 1]; k++) {
        const code = adj[k], e = code >> 1, dir = code & 1;
        const fl = eFlags[e];
        if (!(fl & P.flag)) continue;
        if (!undirected && P.directed && (fl & FLAG.ONEWAY) && dir === 1) continue; // one-way: only U -> V
        relax(dir === 0 ? eV[e] : eU[e], c + len[e] * P.mult[eCls[e]], code);
      }
    }
    return { best, bestEnd, visited };
  }

  // ------------------------------------------------------------ public routing API
  /**
   * Shortest path along the roads between two points.
   * @returns {{ distM, cost, geometry: [lng,lat][], road: [lng,lat][], segments: {name, cls, distM}[], offRoadM }|null}
   *   null when a point is not near any suitable road or no path exists (callers fall back to a straight line).
   */
  route(profile, a, b, { maxSnapM = 150, maxCost = Infinity, undirected = false } = {}) {
    const P = PROFILES[profile];
    if (!P) throw new Error(`unknown road profile ${profile}`);
    const sa = this.snap(profile, a.lat, a.lng, maxSnapM);
    const sb = sa && this.snap(profile, b.lat, b.lng, maxSnapM);
    if (!sa || !sb) return null;
    return this.routeSnapped(profile, a, b, sa, sb, { maxCost, undirected });
  }

  /** route() between positions that are already snapped (see snap / snapMany); a and b are only used for the hops to/from the road. */
  routeSnapped(profile, a, b, sa, sb, { maxCost = Infinity, undirected = false } = {}) {
    const P = PROFILES[profile];
    const starts = this._startLabels(P, sa, undirected);
    const ends = this._endLabels(P, sb, undirected);
    const r = this._run(P, starts, ends, b, maxCost, undirected, false);

    // both points on the same piece of road: walking straight along it may be the best (or only) way
    let direct = Infinity;
    if (sa.e === sb.e) {
      const m = P.mult[this.eCls[sa.e]];
      const forwardOk = sb.a >= sa.a;
      if (forwardOk || undirected || !P.directed || !(this.eFlags[sa.e] & FLAG.ONEWAY)) direct = Math.abs(sb.a - sa.a) * m;
    }
    if (!(r.best < Infinity) && !(direct < Infinity)) return null;

    const pieces = []; // [{ pts, name, cls }]
    const asSeg = (e, pts) => ({ pts, e });
    let cost;
    if (direct <= r.best) {
      cost = direct;
      pieces.push(asSeg(sa.e, this._partial(sa.e, sa.a, sb.a)));
    } else {
      cost = r.best;
      // walk the predecessor chain back from the end node
      const codes = [];
      let n = r.bestEnd;
      let startIdx = 0;
      for (;;) {
        const pe = this._prev[n];
        if (pe < 0) { startIdx = -pe - 1; break; }
        codes.push(pe);
        n = (pe & 1) ? this.eV[pe >> 1] : this.eU[pe >> 1];
      }
      codes.reverse();
      const st = starts[startIdx];
      pieces.push(asSeg(sa.e, this._partial(sa.e, sa.a, st.to === 'V' ? this.len[sa.e] : 0)));
      for (const code of codes) {
        const e = code >> 1;
        const line = this._edgeLine(e);
        pieces.push(asSeg(e, (code & 1) ? line.reverse() : line));
      }
      // finish: from the end node to the projection of b
      const endNode = r.bestEnd;
      // arrive at the U end (then drive forward to the projection) unless V is the end node; for a loop edge, take the shorter side
      const endAtU = this.eU[sb.e] === endNode && (this.eV[sb.e] !== endNode || sb.a <= this.len[sb.e] - sb.a);
      pieces.push(asSeg(sb.e, this._partial(sb.e, endAtU ? 0 : this.len[sb.e], sb.a)));
    }

    // assemble the geometry: a -> its road -> ... -> b's road -> b
    const geometry = [[a.lng, a.lat], [sa.lng, sa.lat]];
    const segments = [];
    for (const p of pieces) {
      let d = 0;
      for (let i = 0; i < p.pts.length; i++) {
        const last = geometry[geometry.length - 1];
        const pt = p.pts[i];
        if (Math.abs(last[0] - pt[0]) < 1e-9 && Math.abs(last[1] - pt[1]) < 1e-9) continue;
        d += geo.haversine(last[1], last[0], pt[1], pt[0]);
        geometry.push(pt);
      }
      if (d > 0.5) {
        const name = this.names[this.eName[p.e]] || null;
        const cls = CLS_LIST[this.eCls[p.e]];
        const tail = segments[segments.length - 1];
        if (tail && tail.name === name && tail.cls === cls) tail.distM += d; else segments.push({ name, cls, distM: d });
      }
    }
    const lastPt = geometry[geometry.length - 1];
    if (Math.abs(lastPt[0] - sb.lng) > 1e-9 || Math.abs(lastPt[1] - sb.lat) > 1e-9) geometry.push([sb.lng, sb.lat]);
    geometry.push([b.lng, b.lat]);

    let distM = 0;
    for (let i = 1; i < geometry.length; i++) distM += geo.haversine(geometry[i - 1][1], geometry[i - 1][0], geometry[i][1], geometry[i][0]);
    return {
      distM, cost: cost + sa.dist + sb.dist, geometry,
      road: geometry.slice(1, geometry.length - 1), // the same path from where a meets its road to where b meets its road
      segments: segments.map((s) => ({ ...s, distM: Math.round(s.distM) })),
      offRoadM: sa.dist + sb.dist,
    };
  }

  /**
   * Everything within maxCost metres (of weighted path cost) of a point, for "how far is it really to walk to X?"
   * questions. Returns a Reach, or null when the point is not near a suitable road.
   */
  reach(profile, from, maxCost, { maxSnapM = 150, undirected = true, key } = {}) {
    const P = PROFILES[profile];
    // `key` = a fixed point (a transit stop) whose snap is remembered
    const sa = key === undefined ? this.snap(profile, from.lat, from.lng, maxSnapM) : this.snapCached(profile, key, from.lat, from.lng, maxSnapM);
    if (!sa) return null;
    const starts = this._startLabels(P, sa, undirected);
    const r = this._run(P, starts, null, null, maxCost, undirected, true);
    const dist = new Map();
    for (const n of r.visited) dist.set(n, this._dist[n]);
    return new Reach(this, profile, P, sa, dist, undirected, maxSnapM);
  }
}

/** Result of Roads.reach(): road distance from the origin point to anything nearby. */
class Reach {
  constructor(roads, profile, P, origin, dist, undirected, maxSnapM) {
    this.roads = roads; this.profile = profile; this.P = P; this.origin = origin; this.dist = dist; this.undirected = undirected; this.maxSnapM = maxSnapM;
  }

  /**
   * Weighted road distance (m) to a point, including the short hop from/to the road.
   * Infinity = there is a road there but it is not reachable within the search limit;
   * null = the point is not near any suitable road at all (callers fall back to a straight line).
   */
  distTo(lat, lng, key) {
    const R = this.roads;
    const sb = key === undefined ? R.snap(this.profile, lat, lng, this.maxSnapM) : R.snapCached(this.profile, key, lat, lng, this.maxSnapM);
    if (!sb) return null;
    const P = this.P, e = sb.e, m = P.mult[R.eCls[e]], L = R.len[e];
    let best = Infinity;
    const dU = this.dist.get(R.eU[e]), dV = this.dist.get(R.eV[e]);
    if (dU !== undefined) best = dU + sb.a * m;
    const free = this.undirected || !P.directed || !(R.eFlags[e] & FLAG.ONEWAY);
    if (free && dV !== undefined) best = Math.min(best, dV + (L - sb.a) * m);
    const o = this.origin;
    if (o.e === e) {
      const ok = sb.a >= o.a || free;
      if (ok) best = Math.min(best, Math.abs(sb.a - o.a) * m);
    }
    return best === Infinity ? Infinity : best + o.dist + sb.dist;
  }
}

module.exports = { Roads, Reach, encode, decode, FLAG, CLS, CLS_LIST, PROFILES };
