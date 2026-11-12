'use strict';
/**
 * Small geometry toolkit. Coordinates are [lng, lat] pairs (GeoJSON order) unless a function says otherwise.
 * Distances are metres.
 */
const R = 6371008.8; // mean earth radius (m)
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in metres between two lat/lng points. */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial compass bearing (0-360, 0 = north) from point 1 to point 2. */
function bearing(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
/** "north", "southeast", ... for a bearing in degrees. */
function compass(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Cumulative distance (m) at every vertex of a [lng,lat] polyline. cum[0] === 0. */
function cumulative(pts) {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
  return cum;
}

/** Index of the last vertex with cum[idx] <= d (binary search). */
function indexAt(cum, d) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** [lng,lat] at distance d (m) along a polyline. */
function pointAt(pts, cum, d) {
  if (d <= 0) return pts[0];
  const total = cum[cum.length - 1];
  if (d >= total) return pts[pts.length - 1];
  const i = indexAt(cum, d);
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (d - cum[i]) / seg : 0;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
}

/** The part of a polyline between distances d0..d1 (m), with interpolated end points. */
function slice(pts, cum, d0, d1) {
  if (d1 < d0) [d0, d1] = [d1, d0];
  const out = [pointAt(pts, cum, d0)];
  const i0 = indexAt(cum, d0);
  const i1 = indexAt(cum, d1);
  for (let i = i0 + 1; i <= i1; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
  out.push(pointAt(pts, cum, d1));
  return out;
}

/**
 * Closest point of a polyline to (lat,lng): { dist, along, idx, point }.
 * Uses a local equirectangular projection, accurate to well under a metre at city scale.
 */
function nearestOnPolyline(pts, cum, lat, lng) {
  const kx = Math.cos(toRad(lat)) * 111320;
  const ky = 110574;
  let best = { dist: Infinity, along: 0, idx: 0, point: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = (pts[i][0] - lng) * kx;
    const ay = (pts[i][1] - lat) * ky;
    const bx = (pts[i + 1][0] - lng) * kx;
    const by = (pts[i + 1][1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const dist = Math.hypot(px, py);
    if (dist < best.dist) {
      best = { dist, along: cum[i] + (cum[i + 1] - cum[i]) * t, idx: i, point: [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t] };
    }
  }
  return best;
}

/** Ray-casting point-in-polygon. ring = [[lng,lat],...] */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon with holes: rings[0] is the outer ring, the rest are holes. */
function inPolygon(lng, lat, rings) {
  if (!inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false;
  return true;
}

/** Douglas-Peucker simplification of a [lng,lat] polyline; tolMeters is the allowed deviation. */
function simplify(pts, tolMeters) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const lat0 = pts[0][1];
  const kx = Math.cos(toRad(lat0)) * 111320;
  const ky = 110574;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const ax = pts[a][0] * kx, ay = pts[a][1] * ky, bx = pts[b][0] * kx, by = pts[b][1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * kx - ax;
      const py = pts[i][1] * ky - ay;
      let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - dx * t, py - dy * t);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolMeters && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Uniform-grid spatial index over points (lat/lng), for "everything within r metres" queries.
 */
class GridIndex {
  constructor(cellDeg = 0.003) {
    this.cell = cellDeg;
    this.map = new Map();
  }

  _key(ix, iy) { return ix * 200003 + iy; }

  add(id, lat, lng) {
    const k = this._key(Math.floor(lng / this.cell), Math.floor(lat / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push(id);
  }

  /** ids whose grid cell intersects the radius; callers must still test the exact distance. */
  candidates(lat, lng, radiusM) {
    const dLat = radiusM / 110574;
    const dLng = radiusM / (Math.cos(toRad(lat)) * 111320);
    const x0 = Math.floor((lng - dLng) / this.cell), x1 = Math.floor((lng + dLng) / this.cell);
    const y0 = Math.floor((lat - dLat) / this.cell), y1 = Math.floor((lat + dLat) / this.cell);
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const b = this.map.get(this._key(x, y));
      if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
    }
    return out;
  }
}

module.exports = { haversine, bearing, compass, cumulative, indexAt, pointAt, slice, nearestOnPolyline, inRing, inPolygon, simplify, GridIndex, toRad, toDeg };
