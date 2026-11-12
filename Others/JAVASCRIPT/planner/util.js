/* PUBTA planner - shared helpers. Plain scripts (no build step); everything hangs off window.PUBTA. */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});

  /**
   * Tiny hyperscript helper. Builds DOM nodes with textContent only, so text that comes from the data
   * (place names, signboards, ...) can never inject markup.
   */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // Static, trusted SVG strings only (never put data in here).
  const SVG = {
    walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2"/><path d="M9 21l2.5-6.5L9 12l1-4 3-1 2.5 3.5 3 .5M11.5 14.5L15 17l1 4M10 8l-3 3"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 5h11l-2 4 2 4H6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  };
  function svg(name) {
    const t = document.createElement('template');
    t.innerHTML = SVG[name] || '';
    return t.content.firstChild;
  }

  const peso = (n) => `₱${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const mins = (n) => {
    const m = Math.max(1, Math.round(n));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
  };
  const dist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
  const CLOCK = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const clock = (iso) => CLOCK.format(new Date(iso));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /** localStorage that never throws (private mode, blocked storage, ...). */
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  };

  PUBTA.h = h; PUBTA.svg = svg; PUBTA.peso = peso; PUBTA.mins = mins; PUBTA.dist = dist; PUBTA.clock = clock; PUBTA.debounce = debounce; PUBTA.store = store;
  PUBTA.isMobile = () => window.matchMedia('(max-width: 860px)').matches;
})();
