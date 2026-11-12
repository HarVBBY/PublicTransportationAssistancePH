/* PUBTA planner - renders route options and the step-by-step directions. */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});
  const { h, svg, peso, mins, dist, clock } = PUBTA;

  const TAG_LABEL = { recommended: 'Recommended', fastest: 'Fastest', cheapest: 'Cheapest', 'fewest-transfers': 'Fewest transfers', 'walk-only': 'Walking only' };
  const TRAIN_NAME = { lrt1: 'LRT-1', lrt2: 'LRT-2', mrt3: 'MRT-3' };

  const R = {
    cfg: null,

    modeColor(leg) {
      if (leg.type === 'walk') return '#4A90E2';
      if (leg.type === 'tricycle') return R.cfg.modes.tricycle.color;
      // trains keep their line colour (LRT-1 green, LRT-2 purple, MRT-3 blue); everything else uses its mode colour
      // so the map, the chips and the legend agree (OpenStreetMap's per-route colours are arbitrary)
      return leg.mode === 'train' && leg.line.colour ? leg.line.colour : R.cfg.modes[leg.mode].color;
    },

    /** Black or white, whichever is easier to read on this background colour. */
    textOn(hex) {
      const c = hex.replace('#', '');
      const ch = [0, 2, 4].map((i) => { const v = parseInt(c.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.3 ? '#1f2328' : '#ffffff';
    },

    /** A short label for a vehicle leg: "Bus 14", "LRT-1", "Jeepney", ... */
    legLabel(leg) {
      if (leg.type === 'tricycle') return 'Tricycle';
      const L = leg.line;
      if (leg.mode === 'train') return TRAIN_NAME[L.fareClass] || R.cfg.modes.train.label;
      const base = R.cfg.modes[leg.mode].label;
      if ((leg.mode === 'bus' || leg.mode === 'carousel') && L.ref) return leg.mode === 'carousel' ? base : `${base} ${L.ref}`;
      return base;
    },

    icon(mode, size = 20) {
      const m = R.cfg.modes[mode];
      if (m && m.icon) return h('img', { src: m.icon, alt: '', width: size, height: size });
      return svg('walk');
    },

    legChip(leg) {
      if (leg.type === 'walk') return h('span', { class: 'leg-chip walk' }, h('span', { class: 'ico' }, svg('walk')), mins(leg.minutes));
      const col = R.modeColor(leg);
      const older = leg.type === 'ride' && leg.line.source === 'dotc-gtfs';
      return h('span', { class: `leg-chip${older ? ' older' : ''}`, style: `--c:${col};--ct:${R.textOn(col)}`, title: older ? 'Older LTFRB route data - confirm the signboard with the driver' : null }, h('span', { class: 'ico' }, R.icon(leg.mode === 'tricycle' ? 'tricycle' : leg.mode, 14)), R.legLabel(leg));
    },

    /** The list of option cards. */
    renderResults(host, result, selectedId, handlers) {
      host.replaceChildren();
      const its = result.itineraries;
      const q = result.query;
      const disc = q.passenger !== 'regular';
      host.append(h('div', { class: 'results-head' }, h('span', {}, `${its.length} way${its.length === 1 ? '' : 's'} to get there`), h('span', {}, `${R.clock12(q.when)} · ${R.periodLabel(q.period)}`)));
      its.forEach((it) => {
        const selected = it.id === selectedId;
        const chain = [];
        it.legs.forEach((leg, i) => {
          if (i) chain.push(h('span', { class: 'arrow', 'aria-hidden': 'true' }, '›'));
          chain.push(R.legChip(leg));
        });
        const walkOnly = it.tags.includes('walk-only');
        const meta = walkOnly
          ? `${dist(it.walkM)} on foot · free`
          : `${clock(it.depart)} → ${clock(it.arrive)} · ${it.transfers ? `${it.transfers} transfer${it.transfers > 1 ? 's' : ''}` : 'no transfer'} · ${dist(it.walkM)} walking`;
        const summary = h('button', { type: 'button', class: 'card-summary', 'aria-expanded': selected ? 'true' : 'false', onclick: () => handlers.onSelect(it) },
          h('div', { class: 'tags' }, it.tags.map((t) => h('span', { class: `tag ${t}` }, TAG_LABEL[t] || t))),
          h('div', { class: 'card-main' },
            h('div', { class: 'time' }, mins(it.totalMin)),
            h('div', { class: 'fare' }, walkOnly ? 'Free' : peso(it.fare.payable), !walkOnly && disc ? h('small', {}, `regular ${peso(it.fare.regular)}`) : null)),
          h('div', { class: 'chain' }, chain),
          h('div', { class: 'meta' }, meta));
        const card = h('article', { class: `card${selected ? ' selected' : ''}`, dataset: { id: it.id } }, summary, selected ? R.renderDetail(it, result, handlers) : null);
        host.append(card);
      });
    },

    /** 'YYYY-MM-DD HH:mm' (Manila time) -> '11:55 PM' */
    clock12(s) {
      const [hh, mm] = s.slice(11, 16).split(':').map(Number);
      return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
    },

    periodLabel(p) {
      return { amPeak: 'morning rush', pmPeak: 'evening rush', midday: 'daytime traffic', night: 'night', weekend: 'weekend traffic' }[p] || p;
    },

    /** Expanded directions for the selected option. */
    renderDetail(it, result, handlers) {
      const q = result.query;
      const disc = q.passenger !== 'regular';
      const wrap = h('div', { class: 'card-detail' });
      if (it.warnings.length) wrap.append(h('div', { class: 'warn', role: 'note' }, h('ul', {}, it.warnings.map((w) => h('li', {}, w)))));

      const ol = h('ol', { class: 'steps' });
      it.steps.forEach((s) => {
        const leg = it.legs[s.legIndex];
        const color = s.type === 'arrive' ? '#d93025' : leg ? R.modeColor(leg) : '#4A90E2';
        const ico = s.type === 'arrive' ? svg('flag') : s.type === 'walk' ? svg('walk') : R.icon(s.mode, 20);
        const tips = (s.tips || []).filter(Boolean);
        let fareLine = null;
        if (s.fare && (s.fare.regular > 0 || s.type === 'ride')) {
          const base = s.type === 'tricycle' ? `Fare ≈ ${peso(s.fare.regular)}` : `Fare: ${peso(s.fare.regular)}`;
          fareLine = h('span', { class: 'fare-line' }, base + (disc ? ` (${peso(s.fare.discounted)} discounted)` : ''), s.fare.confidence && s.fare.confidence !== 'official' ? h('span', { class: 'conf' }, ` · ${s.fare.confidence === 'estimate' ? 'estimate' : 'reported'}`) : null);
        }
        ol.append(h('li', { class: `step ${s.type}`, style: `--c:${color}` },
          h('div', { class: 'step-ico' }, ico),
          h('div', { class: 'step-body' },
            h('button', { type: 'button', class: 'step-head', title: 'Show this step on the map', onclick: () => handlers.onStep(s, it) },
              h('span', { class: 'step-title' }, s.title), s.minutes ? h('span', { class: 'step-min' }, mins(s.minutes)) : null),
            h('p', { class: 'step-text' }, s.text),
            fareLine,
            tips.length ? h('details', { class: 'tips' }, h('summary', {}, `Tips (${tips.length})`), h('ul', {}, tips.map((t) => h('li', {}, t)))) : null)));
      });
      wrap.append(ol);

      // fare breakdown
      const rows = it.legs.filter((l) => l.type !== 'walk').map((l) => h('tr', {}, h('td', {}, `${R.legLabel(l)}${l.type === 'ride' ? ` · ${(l.distM / 1000).toFixed(1)} km` : ''}`), h('td', {}, peso(l.fare.regular))));
      if (rows.length) {
        const table = h('table', {}, h('tbody', {}, rows,
          h('tr', { class: 'total' }, h('td', {}, 'Total (regular fare)'), h('td', {}, peso(it.fare.regular))),
          disc ? h('tr', { class: 'total' }, h('td', {}, `You pay (${q.passenger})`), h('td', {}, peso(it.fare.payable))) : null));
        wrap.append(h('div', { class: 'breakdown' }, table, h('small', { class: 'meta' }, `Fares as of ${result.meta.faresAsOf}. Prices can change - check the posted fare matrix.`)));
      }

      wrap.append(h('div', { class: 'detail-actions' },
        h('button', { type: 'button', onclick: () => handlers.onFit(it) }, 'Show on map'),
        h('button', { type: 'button', onclick: (e) => handlers.onShare(e.currentTarget) }, 'Copy link')));
      return wrap;
    },
  };

  PUBTA.results = R;
})();
