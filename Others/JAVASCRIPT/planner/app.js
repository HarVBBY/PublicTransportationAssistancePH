/* PUBTA planner - application controller. */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});
  const { h, api, store, PlaceInput, mapCtl, results, isMobile } = PUBTA;
  const $ = (id) => document.getElementById(id);

  const MODE_CHIPS = [
    { key: 'jeepney', label: 'Jeepney' },
    { key: 'bus', label: 'Bus' },
    { key: 'uv', label: 'UV Express' },
    { key: 'train', label: 'Train' },
    { key: 'tricycle', label: 'Tricycle' },
  ];

  const state = {
    cfg: null,
    from: null, to: null,
    result: null, selectedId: null,
    prefs: { passenger: 'regular', modes: MODE_CHIPS.map((m) => m.key), walk: 900, legacy: true },
    planning: false,
  };
  let fromInput, toInput;

  // ---------------------------------------------------------------- status line
  function setStatus(kind, text) {
    const host = $('status');
    host.replaceChildren();
    if (!text) return;
    host.append(h('div', { class: `msg ${kind}` }, kind === 'loading' ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, text));
  }

  // ---------------------------------------------------------------- options
  function readOptions() {
    const modes = [...document.querySelectorAll('#modeChips input:checked')].map((i) => i.value);
    return {
      passenger: $('passenger').value,
      modes,
      walk: Number($('walk').value),
      legacy: $('legacy').checked,
      whenMode: $('whenMode').value,
      when: $('whenMode').value === 'custom' && $('whenInput').value ? $('whenInput').value : null,
    };
  }

  function refreshOptionsSummary() {
    const o = readOptions();
    const pass = { regular: 'Regular fare', student: 'Student', senior: 'Senior', pwd: 'PWD' }[o.passenger];
    const modes = o.modes.length === MODE_CHIPS.length ? 'All transport' : `${o.modes.length} transport type${o.modes.length === 1 ? '' : 's'}`;
    $('optionsSummary').textContent = `${pass} · ${modes} · ${o.whenMode === 'now' ? 'leave now' : 'set time'}`;
    $('walkOut').textContent = `${$('walk').value} m`;
    $('whenRow').hidden = o.whenMode !== 'custom';
  }

  function savePrefs() {
    const o = readOptions();
    store.set('pubta.prefs', { passenger: o.passenger, modes: o.modes, walk: o.walk, legacy: o.legacy });
  }

  function buildOptions() {
    const chips = $('modeChips');
    for (const m of MODE_CHIPS) {
      const color = (state.cfg.modes[m.key] || {}).color || '#999';
      chips.append(h('label', { class: 'chip', style: `--c:${color}` }, h('input', { type: 'checkbox', value: m.key, checked: state.prefs.modes.includes(m.key), onchange: onOptionChange }), h('span', {}, m.label)));
    }
    $('passenger').value = state.prefs.passenger;
    $('walk').value = state.prefs.walk;
    $('legacy').checked = state.prefs.legacy;
    for (const id of ['passenger', 'walk', 'legacy', 'whenMode', 'whenInput']) $(id).addEventListener('input', onOptionChange);
    refreshOptionsSummary();
  }

  function onOptionChange() { refreshOptionsSummary(); savePrefs(); }

  // ---------------------------------------------------------------- endpoints
  function onPlaceChange(input) {
    const place = input.place;
    if (input === fromInput) { state.from = place; mapCtl.setEndpoint('from', place); }
    else { state.to = place; mapCtl.setEndpoint('to', place); }
  }

  async function pickFromMap(kind, lat, lng) {
    const input = kind === 'from' ? fromInput : toInput;
    input.setPlace({ lat, lng, name: 'Pinned location…', type: 'point' });
    try {
      const d = await api.describe(lat, lng);
      input.setPlace({ lat, lng, name: d.label, type: 'point', city: d.city }, { silent: true });
    } catch (e) { /* keep the generic name */ }
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setStatus('error', 'Your browser cannot share its location.'); return; }
    setStatus('loading', 'Finding your location…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const b = state.cfg.bbox;
      const inside = lat >= b.south - 0.03 && lat <= b.north + 0.03 && lng >= b.west - 0.03 && lng <= b.east + 0.03;
      if (!inside) { setStatus('error', 'Your location is outside the area PUBTA covers (Caloocan, Malabon, Navotas, Valenzuela and nearby). Search for a place instead.'); return; }
      setStatus('', '');
      await pickFromMap('from', lat, lng);
      fromInput.place.name = 'My location';
      fromInput.input.value = 'My location';
      fromInput.place.type = 'gps';
    }, (err) => setStatus('error', err.code === 1 ? 'Location permission was denied. Search for a place or pick a point on the map instead.' : 'Could not get your location.'), { enableHighAccuracy: true, timeout: 10000 });
  }

  function swap() {
    const a = fromInput.place, b = toInput.place;
    const at = fromInput.text, bt = toInput.text;
    fromInput.setPlace(b, { silent: true }); toInput.setPlace(a, { silent: true });
    if (!b) fromInput.input.value = bt;
    if (!a) toInput.input.value = at;
    state.from = b; state.to = a;
    mapCtl.setEndpoint('from', b); mapCtl.setEndpoint('to', a);
    if (state.result && a && b) plan();
  }

  // ---------------------------------------------------------------- planning
  async function plan() {
    if (state.planning) return;
    const o = readOptions();
    state.planning = true;
    $('btnGo').disabled = true;
    setStatus('loading', 'Finding the best ways to get there…');
    try {
      const [from, to] = await Promise.all([fromInput.resolve(), toInput.resolve()]);
      if (!from || !to) {
        setStatus('error', !from && !to ? 'Please choose where you are and where you want to go.' : !from ? 'Please choose your starting point - type a place or tap the pin to pick it on the map.' : 'Please choose your destination - type a place or tap the pin to pick it on the map.');
        return;
      }
      state.from = from; state.to = to;
      mapCtl.setEndpoint('from', from); mapCtl.setEndpoint('to', to);
      PlaceInput.remember(from); PlaceInput.remember(to);
      if (Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lng - to.lng) < 1e-5) { setStatus('error', 'Your starting point and destination are the same place.'); return; }

      const result = await api.plan({
        from: { lat: from.lat, lng: from.lng, name: from.name },
        to: { lat: to.lat, lng: to.lng, name: to.name },
        passenger: o.passenger,
        modes: o.modes,
        when: o.when || undefined,
        maxWalkM: o.walk,
        includeLowConfidence: o.legacy,
      });
      state.result = result;
      const best = result.itineraries[0];
      $('srStatus').textContent = `${result.itineraries.length} ways found. Recommended: ${best.summary}, about ${best.totalMin} minutes, fare ${best.fare.payable} pesos.`;
      $('welcome').hidden = true;
      setStatus('', '');
      select(result.itineraries[0]);
      syncUrl();
      if (isMobile()) $('panel').classList.remove('collapsed');
      $('results').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      state.result = null;
      mapCtl.clearItinerary();
      $('results').replaceChildren();
      setStatus('error', e.message);
    } finally {
      state.planning = false;
      $('btnGo').disabled = false;
    }
  }

  function select(it) {
    state.selectedId = it.id;
    results.renderResults($('results'), state.result, it.id, { onSelect: select, onStep: focusStep, onFit: (i) => mapCtl.showItinerary(i), onShare: share });
    mapCtl.showItinerary(it);
  }

  function focusStep(step, it) {
    if (step.type === 'arrive') { mapCtl.focusPoint(state.to.lat, state.to.lng, 17); }
    else mapCtl.focusLeg(step.legIndex);
    if (isMobile()) $('panel').classList.add('collapsed');
  }

  // ---------------------------------------------------------------- sharing / URL state
  function buildUrl() {
    const o = readOptions();
    const u = new URL(location.href);
    u.search = '';
    const set = (k, v) => v !== undefined && v !== null && v !== '' && u.searchParams.set(k, v);
    set('from', `${state.from.lat.toFixed(5)},${state.from.lng.toFixed(5)}`); set('fromName', state.from.name);
    set('to', `${state.to.lat.toFixed(5)},${state.to.lng.toFixed(5)}`); set('toName', state.to.name);
    if (o.passenger !== 'regular') set('passenger', o.passenger);
    if (o.modes.length !== MODE_CHIPS.length) set('modes', o.modes.join(','));
    if (o.when) set('when', o.when);
    if (o.walk !== 900) set('walk', o.walk);
    if (!o.legacy) set('legacy', '0');
    const apiParam = new URLSearchParams(location.search).get('api');
    if (apiParam) set('api', apiParam);
    return u.toString();
  }
  function syncUrl() { try { history.replaceState(null, '', buildUrl()); } catch (e) { /* ignore */ } }

  async function share(btn) {
    const url = buildUrl();
    const label = btn.textContent;
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied ✓'; } catch (e) { window.prompt('Copy this link:', url); }
    setTimeout(() => { btn.textContent = label; }, 1800);
  }

  function restoreFromUrl() {
    const p = new URLSearchParams(location.search);
    const parse = (s) => { const m = (s || '').split(',').map(Number); return m.length === 2 && m.every(Number.isFinite) ? { lat: m[0], lng: m[1] } : null; };
    const f = parse(p.get('from')), t = parse(p.get('to'));
    if (p.get('passenger') && ['regular', 'student', 'senior', 'pwd'].includes(p.get('passenger'))) $('passenger').value = p.get('passenger');
    if (p.get('modes')) { const want = new Set(p.get('modes').split(',')); document.querySelectorAll('#modeChips input').forEach((i) => { i.checked = want.has(i.value); }); }
    if (p.get('walk')) $('walk').value = Math.min(1500, Math.max(300, Number(p.get('walk')) || 900));
    if (p.get('legacy') === '0') $('legacy').checked = false;
    if (p.get('when')) { $('whenMode').value = 'custom'; $('whenInput').value = p.get('when'); }
    refreshOptionsSummary();
    if (f) fromInput.setPlace({ ...f, name: p.get('fromName') || 'Start' });
    if (t) toInput.setPlace({ ...t, name: p.get('toName') || 'Destination' });
    return Boolean(f && t);
  }

  // ---------------------------------------------------------------- start-up
  function renderQuickPicks() {
    const host = $('quickPicks');
    host.replaceChildren();
    PlaceInput.popular.forEach((pl) => host.append(h('button', { type: 'button', onclick: () => {
      const target = !toInput.place ? toInput : !fromInput.place ? fromInput : toInput;
      target.setPlace(pl);
      if (fromInput.place && toInput.place) plan(); else (target === toInput ? fromInput : toInput).input.focus();
    } }, pl.label || pl.name)));
  }

  function fatal(msg) {
    $('welcome').hidden = true;
    setStatus('error', msg);
    $('btnGo').disabled = true;
  }

  async function main() {
    // wire the basics first so the page is usable even if the server is down
    $('btnTutorial').addEventListener('click', () => $('tutorial').showModal());
    $('sheetHandle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
    $('btnSwap').addEventListener('click', swap);
    $('whenMode').addEventListener('change', () => { if ($('whenMode').value === 'custom' && !$('whenInput').value) { const d = new Date(Date.now() + 15 * 60000); const p = (n) => String(n).padStart(2, '0'); $('whenInput').value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; } refreshOptionsSummary(); });
    $('plannerForm').addEventListener('submit', (e) => { e.preventDefault(); plan(); });
    $('btnLayers').addEventListener('click', () => { const m = $('layersMenu'); m.hidden = !m.hidden; $('btnLayers').setAttribute('aria-expanded', String(!m.hidden)); });
    document.querySelectorAll('[data-layer]').forEach((cb) => cb.addEventListener('change', () => mapCtl.setOverlay(cb.dataset.layer, cb.checked)));
    $('pickCancel').addEventListener('click', () => { mapCtl.stopPick(); document.querySelectorAll('.icon-btn.active').forEach((b) => b.classList.remove('active')); });

    if (!(await api.init())) {
      fatal(api.problem === 'wrong-server'
        ? 'This page is being served by a plain file server (for example Python’s http.server or Live Server), not by PUBTA, so it has no route data. Close that server, run “npm start” in Others/route-api, then open http://127.0.0.1:8000/PUBTASYSTEM.html.'
        : "Can't reach the PUBTA server. Start it with “npm start” in Others/route-api, then reload this page.");
      return;
    }
    state.cfg = await api.config();
    results.cfg = state.cfg;
    state.prefs = { ...state.prefs, ...store.get('pubta.prefs', {}) };
    buildOptions();

    await mapCtl.init(state.cfg, { onPick: pickFromMap });

    const near = () => { const c = mapCtl.map && mapCtl.map.getCenter(); return c ? { lat: c.lat, lng: c.lng } : null; };
    const afterPick = (input) => {
      const other = input === fromInput ? toInput : fromInput;
      if (!other.place) other.input.focus(); else $('btnGo').focus();
    };
    fromInput = new PlaceInput({ field: document.querySelector('.field[data-kind=from]'), onChange: onPlaceChange, onPicked: afterPick, getNear: near });
    toInput = new PlaceInput({ field: document.querySelector('.field[data-kind=to]'), onChange: onPlaceChange, onPicked: afterPick, getNear: near });

    document.querySelectorAll('.field .icon-btn').forEach((btn) => btn.addEventListener('click', () => {
      const kind = btn.closest('.field').dataset.kind;
      if (btn.dataset.act === 'locate') useMyLocation();
      else {
        document.querySelectorAll('.icon-btn.active').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        mapCtl.startPick(kind);
        if (isMobile()) $('panel').classList.add('collapsed');
      }
    }));
    // picking finished -> un-highlight the pin buttons
    const stop = mapCtl.stopPick;
    mapCtl.stopPick = () => { stop(); document.querySelectorAll('.icon-btn.active').forEach((b) => b.classList.remove('active')); };

    $('footNote').textContent = `Fares as of ${state.cfg.faresAsOf} (LTFRB / LRMC). Route data built ${new Date(state.cfg.builtAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}. Times and fares are estimates.`;

    PlaceInput.loadPopular().then(renderQuickPicks).catch(() => {});
    if (restoreFromUrl()) plan();
  }

  main().catch((e) => { console.error(e); fatal('Something went wrong while loading PUBTA. Please reload the page.'); });
  PUBTA.app = { state, plan };
})();
