'use strict';
/** Helpers for turning raw OpenStreetMap route relations into clean polylines and stops. */
const geo = require('../../src/geo');

const hav = (a, b) => geo.haversine(a[1], a[0], b[1], b[0]);

/** Split an Overpass geometry array at null entries (points outside the clip box) -> arrays of [lng,lat]. */
function splitAtNulls(geometry) {
  const pieces = [];
  let cur = [];
  for (const p of geometry) {
    if (!p) { if (cur.length > 1) pieces.push(cur); cur = []; } else cur.push([p.lon, p.lat]);
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

/**
 * Join the way members of a route relation into continuous runs, oriented in the direction of travel.
 * Returns [{ pts: [[lng,lat],...], marks: [{ at: vertexIndex, wayId }], gaps: [{ at: vertexIndex, jumpM }] }].
 * A new run starts where consecutive ways are more than gapM apart (e.g. where the route leaves the clip box);
 * smaller jumps (the ways do not share a node) are reported in `gaps`: pts[at-1] -> pts[at] is a straight bridge.
 */
function stitch(members, gapM = 120) {
  const groups = []; // groups of consecutive connected pieces
  let cur = null;
  for (const m of members) {
    if (m.type !== 'way' || !m.geometry) continue;
    if (m.role && !/^(forward|backward|route|main)$/i.test(m.role)) continue;
    for (const pts of splitAtNulls(m.geometry)) {
      const piece = { pts, wayId: m.ref };
      if (!cur) { cur = [piece]; groups.push(cur); continue; }
      const last = cur[cur.length - 1];
      const ends = [last.pts[0], last.pts[last.pts.length - 1]];
      const best = Math.min(hav(ends[0], pts[0]), hav(ends[0], pts[pts.length - 1]), hav(ends[1], pts[0]), hav(ends[1], pts[pts.length - 1]));
      if (best > gapM) { cur = [piece]; groups.push(cur); } else cur.push(piece);
    }
  }

  const runs = [];
  for (const g of groups) {
    // orient the first piece so its end is the one nearest the second piece, then chain the rest
    if (g.length > 1) {
      const a = g[0].pts, b = g[1].pts;
      const opts = [[a[a.length - 1], false], [a[0], true]].map(([pt, rev]) => ({ rev, d: Math.min(hav(pt, b[0]), hav(pt, b[b.length - 1])) }));
      if (opts[1].d < opts[0].d) g[0].pts = a.slice().reverse();
    }
    const out = { pts: [], marks: [], gaps: [] };
    for (const piece of g) {
      let pts = piece.pts;
      if (out.pts.length) {
        const end = out.pts[out.pts.length - 1];
        if (hav(end, pts[pts.length - 1]) < hav(end, pts[0])) pts = pts.slice().reverse();
        // the ways do not quite touch: remember the jump, so the builder can bridge it along the road network
        const jump = hav(end, pts[0]);
        if (jump > 4) out.gaps.push({ at: out.pts.length, jumpM: jump });
      }
      out.marks.push({ at: out.pts.length, wayId: piece.wayId });
      for (const p of pts) {
        const last = out.pts[out.pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.pts.push(p);
      }
    }
    if (out.pts.length >= 2) runs.push(out);
  }
  return runs;
}

const STOP_ROLES = /^(stop|stop_entry_only|stop_exit_only|stop_position|platform|platform_entry_only|platform_exit_only)$/;

/** Ordered, de-duplicated stops of a relation: [{ name, lat, lng }]. */
function relationStops(rel, nodesById) {
  const out = [];
  for (const m of rel.members) {
    if (m.type !== 'node' || !STOP_ROLES.test(m.role || '')) continue;
    const n = nodesById.get(m.ref);
    const lat = n ? n.lat : m.lat;
    const lon = n ? n.lon : m.lon;
    if (lat === undefined || lon === undefined) continue;
    const name = (n && (n.tags['name:en'] || n.tags.name)) || null;
    const last = out[out.length - 1];
    // a "stop_position" and its "platform" are the same stop - keep the first
    if (last && hav([last.lng, last.lat], [lon, lat]) < 60 && (!name || !last.name || name === last.name)) {
      if (!last.name && name) last.name = name;
      continue;
    }
    out.push({ name, lat, lng: lon });
  }
  return out;
}

/** "Route 37: Fairview–Monumento via VGC" -> "Fairview–Monumento via VGC" */
function cleanName(name = '') {
  return name.replace(/^(Route|Jeepney|Bus Route|UV Express|Bus)\s*[\w./-]*\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
}

function parseInterval(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

module.exports = { stitch, relationStops, cleanName, parseInterval, hav, splitAtNulls };
