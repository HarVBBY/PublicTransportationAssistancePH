'use strict';
/**
 * Multimodal trip planner.
 *
 * Search model (see network.js for how nodes are made). Every network node has two search states:
 *   B(i) = "I am standing at node i and can board that line's vehicle"
 *   A(i) = "I just got off a vehicle at node i"
 * Moves:
 *   origin -> B(k)   walk (or tricycle) to a nearby boarding point
 *   B(i)  -> A(j)    ride the same line forward, board at i, alight at j   (exact fare for this leg)
 *   A(j)  -> B(k)    walk to another line's boarding point  (a transfer)
 *   A(j)  -> dest    walk (or tricycle) to the destination
 * Dijkstra minimises a "generalised cost" = minutes + fareWeight * pesos + boarding penalty, so the same
 * engine yields the fastest, cheapest and simplest trips by changing the weights.
 */
const geo = require('./geo');
const { MinHeap } = require('./heap');
const { describeItinerary } = require('./instructions');

class PlanError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/** Search presets: how much a peso, a transfer and a minute of walking "weigh" against a minute of travel. */
const PRESETS = {
  balanced: { fareW: 0.30, boardPen: 6, walkW: 1.5 },
  fastest:  { fareW: 0.04, boardPen: 3, walkW: 1.3 },
  cheapest: { fareW: 1.00, boardPen: 2, walkW: 1.2 },
  simplest: { fareW: 0.15, boardPen: 22, walkW: 2.0 },
};

const PASSENGERS = ['regular', 'student', 'senior', 'pwd'];
const ALL_MODES = ['jeepney', 'bus', 'carousel', 'uv', 'train', 'tricycle'];
const K = { WALK_IN: 1, TRIKE_IN: 2, RIDE: 3, TRANSFER: 4, WALK_OUT: 5, TRIKE_OUT: 6 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const kmhToMpm = (kmh) => (kmh * 1000) / 60; // metres per minute

/** Names of the streets a road path uses, in order, skipping unnamed bits and very short stretches: ["Samson Road", ...] */
function namedRoads(segments) {
  const out = [];
  for (const s of segments) if (s.name && s.distM >= 40 && out[out.length - 1] !== s.name) out.push(s.name);
  return out;
}

// ---------------------------------------------------------------- time of day (always Manila time, UTC+8)
const MANILA = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });

function manilaClock(when) {
  let date;
  if (!when) date = new Date();
  else if (when instanceof Date) date = when;
  else if (typeof when === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(when)) date = new Date(when + '+08:00'); // no offset => Manila local
  else date = new Date(when);
  if (Number.isNaN(date.getTime())) throw new PlanError('BAD_TIME', 'Could not understand the departure time.');
  const parts = Object.fromEntries(MANILA.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { date, hour, minute, minutes: hour * 60 + minute, weekend: parts.weekday === 'Sat' || parts.weekday === 'Sun', label: `${parts.year}-${parts.month}-${parts.day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function periodFor(periods, clock) {
  if (clock.weekend) return 'weekend';
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const name of ['amPeak', 'midday', 'pmPeak']) {
    const p = periods[name];
    if (clock.minutes >= toMin(p.from) && clock.minutes < toMin(p.to)) return name;
  }
  return 'night';
}

const speedKmh = (modeCfg, period) => (typeof modeCfg.speedKmh === 'number' ? modeCfg.speedKmh : modeCfg.speedKmh[period] ?? modeCfg.speedKmh.midday);

// ---------------------------------------------------------------- planner
class Planner {
  /**
   * @param {Network} network
   * @param {FareEngine} fares
   * @param {object} [opts]  { areas, places, modesConfig, roads }  (roads: a Roads router, so walking and tricycle
   *                         legs follow real streets; without it they are straight lines scaled by a detour factor)
   */
  constructor(network, fares, opts = {}) {
    this.net = network;
    this.fares = fares;
    this.roads = opts.roads || null;
    this.areas = opts.areas || null;
    this.places = opts.places || null;
    this.modesConfig = opts.modesConfig;
    this.bbox = opts.bbox || null;
    this.useHeuristic = opts.heuristic !== false;
  }

  /** Which city (Caloocan, Malabon, ...) a point is in, if known. */
  cityAt(lat, lng) { return this.areas ? this.areas.cityAt(lat, lng) : null; }

  plan(req) {
    const t0 = process.hrtime.bigint();
    const ctx = this._context(req);
    const found = new Map(); // signature -> itinerary

    const add = (itin, preset) => {
      if (!itin) return;
      const sig = itin.legs.map((l) => (l.type === 'ride' ? l.line.id : l.type === 'tricycle' ? 'T' + l.role : '')).join('|');
      const prev = found.get(sig);
      if (!prev) { itin._presets = new Set([preset]); found.set(sig, itin); } else prev._presets.add(preset);
    };

    // 0) just walking?
    const direct = geo.haversine(ctx.from.lat, ctx.from.lng, ctx.to.lat, ctx.to.lng);
    if (direct * ctx.walkDetour <= 1500) add(this._walkOnly(ctx), 'walk');

    // 1) the presets (reachability does not depend on the weights, so if the first finds nothing, none will)
    const firstPass = {};
    const run = (name) => { const itin = this._searchAndBuild(ctx, PRESETS[name], null); firstPass[name] = itin; add(itin, name); return itin; };
    if (run('balanced')) {
      run('fastest');
      run('cheapest');
      if (firstPass.balanced.transfers > 1) run('simplest'); // an already simple trip cannot be made much simpler
    }

    // 2) alternatives: ban the main line of the best answers and search again (at most three more searches)
    const triedBans = new Set();
    for (const seed of [firstPass.balanced, firstPass.fastest, firstPass.cheapest]) {
      if (!seed || triedBans.size >= 3) continue;
      const main = seed.legs.filter((l) => l.type === 'ride').sort((x, y) => y.distM - x.distM)[0];
      if (!main || triedBans.has(main.line.id)) continue;
      triedBans.add(main.line.id);
      add(this._searchAndBuild(ctx, PRESETS.balanced, new Set([main.line.idx])), 'alt');
    }

    let list = [...found.values()];
    if (!list.length) {
      const near = this.net.nodesNear(ctx.from.lat, ctx.from.lng, 3000).length;
      throw new PlanError('NO_ROUTE', near === 0
        ? 'There is no public transport near your starting point within the covered area.'
        : 'No public transport connection was found between these two places with the selected options. Try allowing more transport types or a longer walking distance.', 404);
    }

    list = this._rank(list, ctx);
    for (const it of list) { describeItinerary(it, ctx, this); slimForJson(it); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
      query: { from: ctx.from, to: ctx.to, passenger: ctx.passenger, modes: [...ctx.modeSet], when: ctx.clock.label, period: ctx.period, maxWalkM: ctx.maxWalk },
      itineraries: list,
      meta: { computeMs: Math.round(ms), faresAsOf: this.fares.asOf, network: this.net.stats() },
    };
  }

  // ------------------------------------------------------------ request handling
  _context(req) {
    const need = (p, label) => {
      if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) throw new PlanError('BAD_POINT', `Please choose a valid ${label}.`);
      if (this.bbox && (p.lat < this.bbox.south - 0.03 || p.lat > this.bbox.north + 0.03 || p.lng < this.bbox.west - 0.03 || p.lng > this.bbox.east + 0.03)) {
        throw new PlanError('OUT_OF_AREA', `The ${label} is outside the area PUBTA covers (Caloocan, Malabon, Navotas, Valenzuela and nearby).`);
      }
      return { lat: p.lat, lng: p.lng, name: p.name || null };
    };
    const from = need(req.from, 'starting point');
    const to = need(req.to, 'destination');
    const clock = manilaClock(req.when);
    const period = periodFor(this.modesConfig.periods, clock);
    const passenger = PASSENGERS.includes(req.passenger) ? req.passenger : 'regular';

    const wanted = Array.isArray(req.modes) && req.modes.length ? req.modes : ALL_MODES;
    const modeSet = new Set();
    for (const m of wanted) { if (m === 'bus') { modeSet.add('bus'); modeSet.add('carousel'); } else if (ALL_MODES.includes(m)) modeSet.add(m); }
    if (!modeSet.size) throw new PlanError('NO_MODES', 'Select at least one type of transportation.');

    const planning = this.net.planning;
    const maxWalk = clamp(Number(req.maxWalkM) || planning.walkLimitM, 200, 2000);
    const includeLow = req.includeLowConfidence !== false;
    const walkCfg = this.net.modes.walk;

    const lines = this.net.lines;
    const allowed = new Uint8Array(lines.length);
    const speedMpm = new Float64Array(lines.length);
    const waitMin = new Float64Array(lines.length);
    const confPen = new Float64Array(lines.length);
    for (const L of lines) {
      const mc = this.net.modes[L.mode];
      allowed[L.idx] = modeSet.has(L.mode) && (includeLow || L.confidence !== 'low') ? 1 : 0;
      speedMpm[L.idx] = kmhToMpm(speedKmh(mc, period));
      waitMin[L.idx] = L.intervalMin ? clamp(L.intervalMin / 2, 2, 15) : mc.waitMin;
      confPen[L.idx] = planning.lowConfidencePenaltyMin[L.confidence] ?? 2;
    }

    const ctx = {
      from, to, clock, period, passenger, modeSet, maxWalk, includeLow, allowed, speedMpm, waitMin, confPen,
      walkMpm: kmhToMpm(walkCfg.speedKmh), walkDetour: walkCfg.detourFactor,
      trikeOK: modeSet.has('tricycle'),
      cityFrom: this.cityAt(from.lat, from.lng), cityTo: this.cityAt(to.lat, to.lng),
    };

    const triMax = planning.tricycleMaxM, triMin = planning.tricycleMinM;
    const reach = Math.max(maxWalk, ctx.trikeOK ? triMax : 0);
    const roads = this.roads;
    ctx.roads = roads;
    /**
     * Boarding points the rider can get to from `pt`, with the distance of the way there:
     *   walk:  node -> metres to WALK     trike: node -> metres by TRICYCLE
     * Distances follow the real street network when it is available (a stop across a river or an expressway is
     * not "close" just because it is near on the map); otherwise they are straight lines scaled by a detour factor.
     */
    const gather = (pt, city) => {
      const walk = new Map();
      const trike = new Map();
      const wr = roads ? roads.reach('foot', pt, maxWalk) : null;
      const tr = roads && ctx.trikeOK && this.net.modes.tricycle ? roads.reach('trike', pt, triMax) : null;
      for (const { node, distM } of this.net.nodesNear(pt.lat, pt.lng, reach)) {
        if (!allowed[this.net.line[node]]) continue;
        const nl = this.net.lat[node], ng = this.net.lng[node];
        if (distM <= maxWalk) {
          const wd = wr ? wr.distTo(nl, ng, node) : null; // null = this point has no road nearby: fall back to a straight line
          if (wd === null) walk.set(node, distM * ctx.walkDetour);
          else if (wd <= maxWalk) walk.set(node, wd);
        }
        if (ctx.trikeOK && this.net.modes.tricycle) {
          const td = tr ? tr.distTo(nl, ng, node) : null;
          if (td === null) { if (distM >= triMin && distM <= triMax) trike.set(node, distM * 1.35); }
          else if (td >= triMin && td <= triMax) trike.set(node, td);
        }
      }
      return { walk, trike, city };
    };
    ctx.access = gather(from, ctx.cityFrom);
    ctx.egress = gather(to, ctx.cityTo);
    ctx.trikeSpeedMpm = kmhToMpm(speedKmh(this.net.modes.tricycle, period));
    ctx.trikeWait = this.net.modes.tricycle.waitMin;

    // per-line fare closures and the heuristic's constants
    ctx.fareFn = lines.map((L) => this.fares.searchFn(L.fareClass, passenger, L.nodeEnd - L.nodeStart));
    ctx.reachM = Math.max(maxWalk, ctx.trikeOK ? triMax : 0);
    let vmax = Math.max(ctx.walkMpm, ctx.trikeSpeedMpm);
    for (const L of lines) if (allowed[L.idx] && speedMpm[L.idx] > vmax) vmax = speedMpm[L.idx];
    ctx.vmaxMpm = vmax;
    return ctx;
  }

  // ------------------------------------------------------------ shortest-path search
  _searchAndBuild(ctx, preset, bannedLines) {
    const chain = this._search(ctx, preset, bannedLines);
    return chain ? this._build(ctx, chain) : null;
  }

  /** Generalised cost of a tricycle hop of roadM metres (real road distance, or straight line x 1.35 without a road map). */
  _trikeCost(ctx, preset, roadM, city) {
    const minutes = ctx.trikeWait + roadM / ctx.trikeSpeedMpm;
    const fare = this.fares.searchFare('tricycle', { distM: roadM, city }, ctx.passenger);
    return minutes + fare * preset.fareW + preset.boardPen * 0.5;
  }

  /**
   * A* search over the board/alight states described at the top of this file.
   * The heuristic is the straight-line distance still to cover (minus what the final walk/tricycle can
   * bridge) at the fastest allowed vehicle speed - it never overestimates, so the result is still optimal,
   * but the search stays inside the "ellipse" between origin and destination instead of flooding the city.
   */
  _search(ctx, preset, banned) {
    const net = this.net;
    const N = net.nodeCount;
    const ORIGIN = 2 * N, DEST = 2 * N + 1;
    const dist = new Float64Array(2 * N + 2).fill(Infinity);
    const prev = new Int32Array(2 * N + 2).fill(-1);
    const kind = new Uint8Array(2 * N + 2);
    const heap = new MinHeap();
    let destBest = Infinity;

    const { lat, lng, d: nd, line: nline } = net;
    const lines = net.lines;
    // every walk below is measured in metres actually walked (real road distance, or straight line x detour without a road map)
    const transferWalkM = Math.min(net.planning.transferWalkM, ctx.maxWalk) * ctx.walkDetour; // longest transfer walk
    const walkCoefM = preset.walkW / ctx.walkMpm;            // cost per metre walked

    // ---- heuristic (lazy, per node). Every term is a proven lower bound, so the answer stays optimal:
    //   * distance still to cover (minus what the final walk / tricycle can bridge) at the fastest allowed speed
    //   * a state "standing at a boarding point" must still pay that line's wait + boarding penalty
    //   * an alighted state that is still out of reach of the destination must still board something
    const kx = 111320 * Math.cos((ctx.to.lat * Math.PI) / 180);
    const ky = 110574;
    const hDist = new Float64Array(N).fill(-1); // Float64: a rounded cache would make the stale-entry test below misfire
    const far = new Uint8Array(N);
    const prep = (node) => {
      if (hDist[node] >= 0) return;
      const dd = Math.hypot((lng[node] - ctx.to.lng) * kx, (lat[node] - ctx.to.lat) * ky);
      far[node] = dd > ctx.reachM ? 1 : 0;
      hDist[node] = Math.max(0, dd - ctx.reachM) / ctx.vmaxMpm;
    };
    const bcost = new Float64Array(lines.length); // what boarding line li costs before moving an inch
    let minBoard = Infinity;
    for (const L of lines) {
      bcost[L.idx] = ctx.waitMin[L.idx] + preset.boardPen + ctx.confPen[L.idx];
      if (ctx.allowed[L.idx] && !(banned && banned.has(L.idx)) && bcost[L.idx] < minBoard) minBoard = bcost[L.idx];
    }
    if (!Number.isFinite(minBoard)) minBoard = 0;
    const useH = this.useHeuristic;
    const hOf = (s) => {
      if (s === DEST || !useH) return 0; // useHeuristic=false turns this into plain Dijkstra (used by the tests as a reference)
      if (s < N) { prep(s); return hDist[s] + bcost[nline[s]]; }
      const n = s - N;
      prep(n);
      return hDist[n] + (far[n] ? minBoard : 0);
    };

    const relax = (s, cost, from, k) => {
      if (cost < dist[s]) {
        const hs = hOf(s);
        if (cost + hs < destBest) {
          dist[s] = cost; prev[s] = from; kind[s] = k;
          if (s === DEST) destBest = cost;
          heap.push(cost + hs, s);
        }
      }
    };

    // origin -> boarding points
    for (const [node, d] of ctx.access.walk) relax(node, d * walkCoefM, ORIGIN, K.WALK_IN);
    for (const [node, d] of ctx.access.trike) relax(node, this._trikeCost(ctx, preset, d, ctx.access.city), ORIGIN, K.TRIKE_IN);

    while (heap.size) {
      const s = heap.pop();
      const cost = dist[s];
      if (heap.lastPriority > cost + hOf(s) + 1e-9) continue; // stale entry
      if (s === DEST) break;

      if (s < N) {
        // ---- B(i): board here and ride forward ----
        const i = s;
        const li = nline[i];
        if (!ctx.allowed[li] || (banned && banned.has(li))) continue;
        const L = lines[li];
        const minRide = L.mode === 'train' ? 200 : 400; // a ride shorter than this is just a walk
        const base = cost + ctx.waitMin[li] + preset.boardPen + ctx.confPen[li];
        const mpm = ctx.speedMpm[li];
        const fareFn = ctx.fareFn[li];
        const di = nd[i];
        for (let j = i + 1; j < L.nodeEnd; j++) {
          const distM = nd[j] - di;
          if (distM < minRide) continue;
          if (base + distM / mpm >= destBest) break; // farther stops only cost more
          relax(N + j, base + distM / mpm + fareFn(distM, j - i) * preset.fareW, i, K.RIDE);
        }
      } else {
        // ---- A(j): just got off at j ----
        const j = s - N;
        const wd = ctx.egress.walk.get(j);
        if (wd !== undefined) relax(DEST, cost + wd * walkCoefM, s, K.WALK_OUT);
        const td = ctx.egress.trike.get(j);
        if (td !== undefined) relax(DEST, cost + this._trikeCost(ctx, preset, td, ctx.egress.city), s, K.TRIKE_OUT);

        // transfers: walk to another line's boarding point (neighbour lists, with their walking distances, are cached across searches)
        const nb = net.neighbors(j, ctx.roads);
        for (let q = 0; q < nb.ids.length; q++) {
          const dm = nb.d[q];
          if (dm > transferWalkM) continue;
          const k = nb.ids[q];
          const lk = nline[k];
          if (!ctx.allowed[lk] || (banned && banned.has(lk))) continue;
          relax(k, cost + dm * walkCoefM, s, K.TRANSFER);
        }
      }
    }

    if (!(dist[DEST] < Infinity)) return null;
    const chain = [];
    for (let s = DEST; s !== ORIGIN; s = prev[s]) chain.push({ state: s, kind: kind[s], from: prev[s] });
    chain.reverse();
    return chain;
  }

  // ------------------------------------------------------------ itinerary construction
  _build(ctx, chain) {
    const net = this.net;
    const N = net.nodeCount;
    const legs = [];
    const nodePt = (n) => ({ lat: net.lat[n], lng: net.lng[n], name: net.nodeLabel(n), node: n });

    for (const step of chain) {
      const s = step.state;
      switch (step.kind) {
        case K.WALK_IN:
          legs.push(this._walkLeg(ctx, ctx.from, nodePt(s), 'to-board'));
          break;
        case K.TRIKE_IN:
          legs.push(this._trikeLeg(ctx, ctx.from, nodePt(s), ctx.access.city, 'access'));
          break;
        case K.RIDE:
          legs.push(this._rideLeg(ctx, step.from, s - N));
          break;
        case K.TRANSFER:
          legs.push(this._walkLeg(ctx, nodePt(step.from - N), nodePt(s), 'transfer'));
          break;
        case K.WALK_OUT:
          legs.push(this._walkLeg(ctx, nodePt(step.from - N), ctx.to, 'to-destination'));
          break;
        case K.TRIKE_OUT:
          legs.push(this._trikeLeg(ctx, nodePt(step.from - N), ctx.to, ctx.egress.city, 'egress'));
          break;
        default: break;
      }
    }
    return this._finish(ctx, legs.filter(Boolean));
  }

  /**
   * A walking leg. With a road map the path follows the streets (and footpaths) and the distance is the real
   * walking distance; without one (or if an end is not near any road) it is a straight line x the detour factor,
   * flagged `approximate`.
   */
  _walkLeg(ctx, a, b, role) {
    const straight = geo.haversine(a.lat, a.lng, b.lat, b.lng);
    if (straight < 30) return null; // you are already there (e.g. a transfer at the same stop)
    const r = ctx.roads ? ctx.roads.route('foot', a, b) : null;
    // both ends are on the road map but there is no walkable connection between them (a river, an expressway...)
    const blocked = Boolean(ctx.roads && !r && ctx.roads.snap('foot', a.lat, a.lng) && ctx.roads.snap('foot', b.lat, b.lng));
    const distM = r ? r.distM : straight * ctx.walkDetour;
    return {
      type: 'walk', role, from: a, to: b, distM: Math.round(distM), minutes: distM / ctx.walkMpm,
      bearing: geo.bearing(a.lat, a.lng, b.lat, b.lng),
      geometry: r ? r.geometry : [[a.lng, a.lat], [b.lng, b.lat]], approximate: !r,
      roadNames: r ? namedRoads(r.segments) : [],
      ...(blocked ? { blocked: true } : {}),
      fare: { regular: 0, discounted: 0 },
    };
  }

  /** A tricycle leg, routed on streets a tricycle may use (one-way rules obeyed); the fare follows the real distance. */
  _trikeLeg(ctx, a, b, city, role) {
    const straight = geo.haversine(a.lat, a.lng, b.lat, b.lng);
    const r = ctx.roads ? ctx.roads.route('trike', a, b) : null;
    const roadM = r ? r.distM : straight * 1.35;
    const f = this.fares.leg('tricycle', { distM: roadM, city }, ctx.passenger);
    return {
      type: 'tricycle', role, mode: 'tricycle', from: a, to: b, city,
      distM: Math.round(roadM), waitMin: ctx.trikeWait, rideMin: roadM / ctx.trikeSpeedMpm,
      minutes: ctx.trikeWait + roadM / ctx.trikeSpeedMpm,
      geometry: r ? r.geometry : [[a.lng, a.lat], [b.lng, b.lat]], approximate: !r,
      roadNames: r ? namedRoads(r.segments) : [],
      bearing: geo.bearing(a.lat, a.lng, b.lat, b.lng),
      fare: f,
    };
  }

  _rideLeg(ctx, i, j) {
    const net = this.net;
    const L = net.lines[net.line[i]];
    const distM = net.d[j] - net.d[i];
    const hops = j - i;
    const stations = L.nodeEnd - L.nodeStart;
    const fare = this.fares.leg(L.fareClass, { distM, hops, stations }, ctx.passenger);
    const rideMin = distM / ctx.speedMpm[L.idx];
    const waitMin = ctx.waitMin[L.idx];
    const onStops = L.boarding === 'stops';
    return {
      type: 'ride', mode: L.mode, line: L,
      board: { lat: net.lat[i], lng: net.lng[i], name: net.nodeLabel(i), node: i, isStop: Boolean(net.isStop[i]) },
      alight: { lat: net.lat[j], lng: net.lng[j], name: net.nodeLabel(j), node: j, isStop: Boolean(net.isStop[j]) },
      distM: Math.round(distM), hops, stopsPassed: onStops ? Math.max(0, hops - 1) : null,
      waitMin, rideMin, minutes: waitMin + rideMin,
      roads: net.roadsBetween(L, net.d[i], net.d[j]),
      geometry: geo.slice(L.pts, L.cum, net.d[i], net.d[j]),
      stationsList: onStops ? this._stopNames(i, j) : null,
      alsoLines: this._parallelLines(L, i, j, ctx),
      fare,
    };
  }

  /**
   * Other lines of the same kind that board near node i AND alight near node j, i.e. "any of these signboards
   * will do". Commuters can take whichever comes first.
   */
  _parallelLines(L, i, j, ctx) {
    const net = this.net;
    if (L.mode !== 'jeepney' && L.mode !== 'bus') return [];
    const R = 90;
    const boardOn = new Map();
    for (const { node } of net.nodesNear(net.lat[i], net.lng[i], R)) {
      const li = net.line[node];
      const L2 = net.lines[li];
      if (li === L.idx || !ctx.allowed[li] || L2.mode !== L.mode || boardOn.has(li)) continue;
      boardOn.set(li, node);
    }
    if (!boardOn.size) return [];
    const out = [];
    const seen = new Set();
    for (const { node } of net.nodesNear(net.lat[j], net.lng[j], R)) {
      const li = net.line[node];
      if (seen.has(li) || !boardOn.has(li) || node <= boardOn.get(li)) continue;
      seen.add(li);
      const L2 = net.lines[li];
      out.push({ id: L2.id, ref: L2.ref, name: L2.name, mode: L2.mode, source: L2.source, confidence: L2.confidence });
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name)).slice(0, 8);
  }

  _stopNames(i, j) {
    const out = [];
    for (let n = i + 1; n < j; n++) if (this.net.name[n]) out.push(this.net.name[n]);
    return out;
  }

  _walkOnly(ctx) {
    const leg = this._walkLeg(ctx, ctx.from, ctx.to, 'to-destination');
    if (leg && (leg.blocked || leg.distM > 1800)) return null; // no way on foot, or the real way round is too long to suggest
    return leg ? this._finish(ctx, [leg]) : null;
  }

  /** Totals, clock times and warnings for a finished list of legs. */
  _finish(ctx, legs) {
    if (!legs.length) return null;
    let totalMin = 0, walkM = 0, rideM = 0, reg = 0, disc = 0, vehicles = 0;
    let confidenceWorst = 'high';
    const rank = { high: 0, medium: 1, low: 2 };
    for (const l of legs) {
      totalMin += l.minutes;
      if (l.type === 'walk') walkM += l.distM;
      else { vehicles++; rideM += l.distM; reg += l.fare.regular; disc += l.fare.discounted; }
      if (l.type === 'ride' && rank[l.line.confidence] > rank[confidenceWorst]) confidenceWorst = l.line.confidence;
    }
    const depart = ctx.clock.date;
    const arrive = new Date(depart.getTime() + totalMin * 60000);
    return {
      legs,
      totalMin: Math.round(totalMin),
      walkM: Math.round(walkM),
      distanceKm: Math.round(rideM / 100) / 10,
      transfers: Math.max(0, vehicles - 1),
      vehicles,
      fare: { regular: reg, discounted: Math.round(disc * 4) / 4, payable: ctx.passenger === 'regular' ? reg : Math.round(disc * 4) / 4 },
      depart: depart.toISOString(),
      arrive: arrive.toISOString(),
      dataConfidence: confidenceWorst,
    };
  }

  // ------------------------------------------------------------ ranking & labelling
  _rank(list, ctx) {
    const payable = (it) => it.fare.payable;
    const isWalk = (it) => it.legs.length === 1 && it.legs[0].type === 'walk';
    const walkOnly = list.find(isWalk);
    list = list.filter((i) => !isWalk(i));
    const score = (i) => i.totalMin + payable(i) * PRESETS.balanced.fareW + i.transfers * PRESETS.balanced.boardPen + (i.walkM / 1000) * 5;
    list.sort((a, b) => score(a) - score(b));

    // merge itineraries that are the same trip on a different signboard (their boarding/alighting points coincide)
    const uniq = [];
    for (const it of list) if (!uniq.some((u) => similar(u, it))) uniq.push(it);

    let keep = uniq;
    if (keep.length) {
      const bestTime = Math.min(...keep.map((i) => i.totalMin));
      const bestFare = Math.min(...keep.map(payable));
      keep = keep.filter((i) => i.totalMin <= bestTime * 1.8 + 15 && payable(i) <= bestFare * 2.2 + 25);
      keep = keep.filter((a) => !keep.some((b) => b !== a && b.totalMin <= a.totalMin && payable(b) <= payable(a) && b.transfers <= a.transfers &&
        (b.totalMin < a.totalMin || payable(b) < payable(a) || b.transfers < a.transfers)));
    }
    if (!keep.length) keep = uniq;

    const fastest = [...keep].sort((a, b) => a.totalMin - b.totalMin || payable(a) - payable(b))[0];
    const cheapest = [...keep].sort((a, b) => payable(a) - payable(b) || a.totalMin - b.totalMin)[0];
    const simplest = [...keep].sort((a, b) => a.transfers - b.transfers || a.walkM - b.walkM || a.totalMin - b.totalMin)[0];

    const out = keep.slice(0, 4);
    for (const extra of [fastest, cheapest, simplest]) if (extra && !out.includes(extra)) out.push(extra);
    if (walkOnly) out.push(walkOnly);
    out.forEach((it, idx) => {
      it.tags = [];
      if (it === walkOnly) it.tags.push('walk-only');
      else {
        if (it === out[0]) it.tags.push('recommended');
        if (it === fastest) it.tags.push('fastest');
        if (it === cheapest) it.tags.push('cheapest');
        if (it === simplest && keep.some((o) => o.transfers > it.transfers)) it.tags.push('fewest-transfers');
      }
      it.id = `opt${idx + 1}`;
      delete it._presets;
    });
    return out;
  }
}

/**
 * The planner works with full line objects (polylines, cumulative distances, ...). Before an itinerary leaves
 * the planner, replace them by small public summaries and drop internal node ids.
 */
function slimForJson(it) {
  for (const leg of it.legs) {
    if (leg.line) {
      const L = leg.line;
      leg.line = { id: L.id, mode: L.mode, ref: L.ref, name: L.name, from: L.from, to: L.to, via: L.via, operator: L.operator, colour: L.colour, source: L.source, confidence: L.confidence, fareClass: L.fareClass, aircon: L.aircon };
    }
    for (const k of ['board', 'alight', 'from', 'to']) if (leg[k] && typeof leg[k] === 'object') delete leg[k].node;
  }
  return it;
}

/** Two itineraries are "the same trip" if every vehicle leg boards and alights at (nearly) the same places. */
function similar(a, b) {
  if (a.legs.length !== b.legs.length) return false;
  for (let i = 0; i < a.legs.length; i++) {
    const x = a.legs[i], y = b.legs[i];
    if (x.type !== y.type) return false;
    if (x.type === 'walk') continue;
    if (x.mode !== y.mode) return false;
    const near = (p, q) => geo.haversine(p.lat, p.lng, q.lat, q.lng) < 150;
    if (!near(x.from || x.board, y.from || y.board) || !near(x.to || x.alight, y.to || y.alight)) return false;
  }
  return true;
}

module.exports = { Planner, PlanError, PRESETS, manilaClock, periodFor, ALL_MODES, PASSENGERS };
