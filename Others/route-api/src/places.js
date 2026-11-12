'use strict';
/**
 * Place search for the "From" / "To" boxes: landmarks, malls, schools, stations, barangays/areas and roads
 * in and around CAMANAVA. Runs fully in memory - no external geocoding service is needed.
 */
const geo = require('./geo');

const TYPE_LABEL = {
  station: 'Train station', mall: 'Mall', supermarket: 'Supermarket', university: 'University', college: 'College', school: 'School',
  hospital: 'Hospital', townhall: 'City hall', bus_station: 'Terminal', marketplace: 'Market', area: 'Area / barangay',
  park: 'Park', attraction: 'Landmark', road: 'Road', police: 'Police station', courthouse: 'Court', library: 'Library', cinema: 'Cinema', barangay_hall: 'Barangay hall', other: 'Place',
};
// How "notable" each kind of place is: used to rank matches and to choose landmarks for directions.
const WEIGHT = { station: 10, mall: 9, university: 9, college: 8, hospital: 8, townhall: 7, bus_station: 8, marketplace: 6, area: 6, attraction: 5, park: 4, supermarket: 4, school: 4, police: 3, courthouse: 3, library: 3, cinema: 4, road: 3, barangay_hall: 3, other: 2 };
const LOCAL_CITIES = new Set(['Caloocan', 'Malabon', 'Navotas', 'Valenzuela']); // results here rank a little higher
const LANDMARK_TYPES = new Set(['station', 'mall', 'university', 'college', 'hospital', 'townhall', 'bus_station', 'marketplace', 'attraction', 'supermarket', 'park']);

// Filipino address abbreviations -> one canonical spelling, so "Sto. Nino" finds "Santo Niño".
const CANON = { sto: 'santo', sta: 'santa', ave: 'avenue', av: 'avenue', rd: 'road', blvd: 'boulevard', hway: 'highway', hiway: 'highway', hwy: 'highway', brgy: 'barangay', bgy: 'barangay', st: 'street', gen: 'general', pres: 'president', dr: 'doctor', mt: 'mount', ext: 'extension', univ: 'university', cor: 'corner', sm: 'sm' };

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const tokens = (s) => norm(s).split(' ').filter(Boolean).map((t) => CANON[t] || t);

class Places {
  /** @param {Array<{n:string,t:string,lat:number,lng:number,c?:string,a?:string[]}>} list */
  constructor(list, areas = null) {
    this.areas = areas;
    this.items = list.map((p, i) => {
      const names = [p.n, ...(p.a || [])];
      return { id: `p${i}`, name: p.n, type: p.t, lat: p.lat, lng: p.lng, city: p.c || null, w: WEIGHT[p.t] ?? 2, norms: names.map(norm), toks: names.map(tokens), tokSet: new Set(names.flatMap(tokens)) };
    });
    this.grid = new geo.GridIndex(0.004);
    this.items.forEach((p, i) => { if (LANDMARK_TYPES.has(p.type) || p.type === 'area' || p.type === 'road') this.grid.add(i, p.lat, p.lng); });
  }

  /** Ranked matches for what the user typed. Optional bias towards (lat,lng). */
  search(query, { lat = null, lng = null, limit = 8 } = {}) {
    const q = norm(query);
    if (q.length < 2) return [];
    const qt = tokens(query);
    const scored = [];
    for (const p of this.items) {
      let best = -1;
      for (let k = 0; k < p.norms.length; k++) {
        const s = this._score(q, qt, p.norms[k], p.toks[k], p.w, k > 0);
        if (s > best) best = s;
      }
      if (best < 0) continue;
      if (LOCAL_CITIES.has(p.city)) best += 1.5;
      if (lat !== null && lng !== null) best += 3 * Math.exp(-geo.haversine(lat, lng, p.lat, p.lng) / 6000);
      scored.push([best, p]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = [];
    for (const [, p] of scored) {
      if (out.some((o) => o.nameNorm === p.norms[0] && geo.haversine(o.lat, o.lng, p.lat, p.lng) < 400)) continue; // node+way duplicates
      out.push({ id: p.id, name: p.name, type: p.type, typeLabel: TYPE_LABEL[p.type] || 'Place', lat: p.lat, lng: p.lng, city: p.city, nameNorm: p.norms[0] });
      if (out.length >= limit) break;
    }
    return out.map(({ nameNorm, ...rest }) => rest);
  }

  _score(q, qt, nameNorm, nameToks, weight, isAlias) {
    if (nameNorm === q) return 40 + weight;
    let s = 0;
    // every query word must start a word of the name (or be a >=4-letter fragment of one)
    for (const t of qt) {
      let ok = false;
      for (const nt of nameToks) {
        if (nt === t) { s += 3; ok = true; break; }
        if (nt.startsWith(t)) { s += 2; ok = true; break; }
      }
      if (!ok && t.length >= 4 && nameNorm.includes(t)) { s += 0.5; ok = true; }
      if (!ok) return -1;
    }
    if (nameNorm.startsWith(q)) s += 8;
    else if (nameNorm.includes(' ' + q)) s += 3;
    s += weight * 0.8;
    s -= Math.max(0, nameToks.length - qt.length) * 0.35;
    if (isAlias) s += 1;
    return s;
  }

  /** The most useful nearby landmark name (mall, station, school, ...) within r metres, or null. */
  landmarkNear(lat, lng, r = 120) {
    let best = null, bestScore = -Infinity;
    for (const id of this.grid.candidates(lat, lng, r)) {
      const p = this.items[id];
      if (!LANDMARK_TYPES.has(p.type)) continue;
      const d = geo.haversine(lat, lng, p.lat, p.lng);
      if (d > r) continue;
      const s = p.w - d / 20;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best ? best.name : null;
  }

  /** A readable label for an arbitrary map point ("Near SM City Grand Central, Caloocan"). */
  describe(lat, lng) {
    const city = this.areas ? this.areas.cityAt(lat, lng) : null;
    const lm = this.landmarkNear(lat, lng, 150);
    let label;
    if (lm) label = `Near ${lm}`;
    else {
      let road = null, rd = 220, area = null, ad = 1800;
      for (const id of this.grid.candidates(lat, lng, 1800)) {
        const p = this.items[id];
        const d = geo.haversine(lat, lng, p.lat, p.lng);
        if (p.type === 'road' && d < rd) { rd = d; road = p; }
        if (p.type === 'area' && d < ad) { ad = d; area = p; }
      }
      if (road) label = `Along ${road.name}`;
      else if (area) label = `Near ${area.name}`;
      else label = `Pinned location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    }
    return { label: city ? `${label}, ${city}` : label, city };
  }

  get size() { return this.items.length; }
}

module.exports = { Places, TYPE_LABEL, norm, tokens };
