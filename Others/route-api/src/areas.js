'use strict';
/** City boundaries: which city (Caloocan, Malabon, ...) is a point in? Data comes from data/areas.json. */
const geo = require('./geo');

const CAMANAVA = new Set(['Caloocan', 'Malabon', 'Navotas', 'Valenzuela']);

class Areas {
  /** @param {{cities: Array<{name:string, bbox:number[], polygons:number[][][][]}>}} data  bbox = [w,s,e,n]; polygon = [outerRing, ...holes] */
  constructor(data) {
    this.cities = data.cities;
  }

  cityAt(lat, lng) {
    for (const c of this.cities) {
      const [w, s, e, n] = c.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      for (const poly of c.polygons) if (geo.inPolygon(lng, lat, poly)) return c.name;
    }
    return null;
  }

  isCamanava(name) { return CAMANAVA.has(name); }
}

module.exports = { Areas, CAMANAVA };
