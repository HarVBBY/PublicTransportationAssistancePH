'use strict';
/**
 * Fare engine. All numbers come from data/config/fares.json so they can be updated without touching code.
 *
 *   regular     = what a full-fare adult pays for this leg (rounded to whole pesos)
 *   discounted  = what a student / senior citizen / PWD pays (rounded to the nearest 25 centavos)
 */
const round = (x, step) => Math.round(x / step) * step;

class FareEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.asOf = cfg.asOf;
    this._fn = new Map();
  }

  has(fareClass) { return Boolean(this.cfg.classes[fareClass]); }

  info(fareClass, city) {
    const c = this.cfg.classes[fareClass];
    if (!c) return null;
    const p = fareClass === 'tricycle' ? this._tricycleParams(c, city) : c;
    return { label: c.label, confidence: p.confidence || c.confidence, source: p.source || c.source, note: c.note || null };
  }

  _tricycleParams(c, city) {
    return (city && c.byCity && c.byCity[city]) || c.default;
  }

  /** Regular (full) fare in pesos for riding `distM` metres, or `hops` station-to-station hops on rail. */
  regular(fareClass, { distM = 0, hops = 1, stations = 2, city = null } = {}) {
    const c = this.cfg.classes[fareClass];
    if (!c) return 0;
    const step = c.round || 1;
    switch (c.type) {
      case 'flat':
        return c.amount;
      case 'stations': {
        const span = Math.max(1, stations - 2);
        return round(c.min + ((c.max - c.min) * Math.max(0, hops - 1)) / span, step);
      }
      case 'distance':
      default: {
        const p = fareClass === 'tricycle' ? this._tricycleParams(c, city) : c;
        const km = distM / 1000;
        return round(p.base + Math.max(0, km - p.baseKm) * p.perKm, step);
      }
    }
  }

  discountRate(fareClass, passenger = 'regular') {
    if (passenger === 'regular') return 0;
    const d = this.cfg.discounts;
    return fareClass in d.byClass ? d.byClass[fareClass] : d.default;
  }

  discounted(regular, fareClass, passenger = 'student') {
    return round(regular * (1 - this.discountRate(fareClass, passenger)), 0.25);
  }

  /** Both fares for one leg, plus how trustworthy the number is. */
  leg(fareClass, opts = {}, passenger = 'regular') {
    const regular = this.regular(fareClass, opts);
    const info = this.info(fareClass, opts.city) || {};
    return {
      fareClass,
      label: info.label || fareClass,
      regular,
      discounted: this.discounted(regular, fareClass, passenger === 'regular' ? 'student' : passenger),
      confidence: info.confidence || 'estimate',
      source: info.source || null,
      note: info.note || null,
    };
  }

  /**
   * A fast closure (distM, hops) => pesos for one fare class and passenger type, used in the planner's inner
   * loop. Always agrees with searchFare().
   */
  searchFn(fareClass, passenger, stations) {
    const c = this.cfg.classes[fareClass];
    if (!c) return () => 0;
    const mult = passenger === 'regular' ? 1 : 1 - this.discountRate(fareClass, passenger);
    const step = c.round || 1;
    if (c.type === 'flat') { const v = c.amount * mult; return () => v; }
    if (c.type === 'stations') {
      const span = Math.max(1, stations - 2);
      return (distM, hops) => round(c.min + ((c.max - c.min) * Math.max(0, hops - 1)) / span, step) * mult;
    }
    const { base, baseKm, perKm } = c;
    return (distM) => round(base + Math.max(0, distM / 1000 - baseKm) * perKm, step) * mult;
  }

  /**
   * Cheap numeric fare used inside the shortest-path search (the amount the selected passenger type pays,
   * not rounded for display).
   */
  searchFare(fareClass, opts, passenger) {
    const reg = this.regular(fareClass, opts);
    return passenger === 'regular' ? reg : reg * (1 - this.discountRate(fareClass, passenger));
  }
}

module.exports = { FareEngine, round };
