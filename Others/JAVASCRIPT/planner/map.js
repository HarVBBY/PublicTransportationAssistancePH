/* PUBTA planner - the map (MapLibre GL JS). */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});
  const { h, api, peso } = PUBTA;

  const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const RASTER_FALLBACK = {
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const NET_LAYERS = ['net-train', 'net-bus', 'net-uv', 'net-jeepney', 'net-legacy'];

  const ctl = {
    map: null,
    cfg: null,
    markers: [],
    handlers: {},
    picking: null,
    overlay: { train: false, bus: false, uv: false, jeepney: false, legacy: false },
    netData: null,
    popup: null,
    itinerary: null,
    fellBack: false,

    init(cfg, handlers) {
      ctl.cfg = cfg;
      ctl.handlers = handlers;
      const c = cfg.center;
      const map = (ctl.map = new maplibregl.Map({
        container: 'map',
        style: STYLE,
        center: [c.lng, c.lat],
        zoom: c.zoom,
        maxBounds: [[cfg.bbox.west - 0.25, cfg.bbox.south - 0.25], [cfg.bbox.east + 0.25, cfg.bbox.north + 0.25]],
        attributionControl: { compact: true },
      }));
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'bottom-right');
      map.on('style.load', ctl._ensureLayers);
      map.on('error', (e) => {
        // if the vector style cannot be loaded (offline tile server...) switch to plain OpenStreetMap tiles
        if (!ctl.fellBack && !map.isStyleLoaded() && e && e.error && /fetch|style|Failed|NetworkError|AJAX/i.test(String(e.error.message || e.error))) {
          ctl.fellBack = true;
          map.setStyle(RASTER_FALLBACK);
        }
      });
      // the basemap style references a few icons its sprite lacks; give it blanks instead of console warnings
      map.on('styleimagemissing', (e) => { if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
      map.on('click', ctl._onClick);
      map.on('mousemove', (e) => {
        const layers = NET_LAYERS.filter((id) => map.getLayer(id));
        if (!layers.length || ctl.picking) return;
        map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers }).length ? 'pointer' : '';
      });
      return new Promise((resolve) => { if (map.loaded()) resolve(); else map.once('load', resolve); });
    },

    // ---------------------------------------------------------------- layers
    _ensureLayers() {
      const map = ctl.map;
      if (!map.getSource('net')) map.addSource('net', { type: 'geojson', data: ctl.netData || EMPTY });
      const net = (id, filter, paint, layout = {}) => {
        if (map.getLayer(id)) return;
        map.addLayer({ id, type: 'line', source: 'net', filter, layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none', ...layout }, paint });
      };
      net('net-legacy', ['==', ['get', 'source'], 'dotc-gtfs'], { 'line-color': ['get', 'colour'], 'line-width': 2, 'line-opacity': 0.4, 'line-dasharray': [2, 1.5] });
      net('net-jeepney', ['all', ['==', ['get', 'mode'], 'jeepney'], ['!=', ['get', 'source'], 'dotc-gtfs']], { 'line-color': ['get', 'colour'], 'line-width': 2.5, 'line-opacity': 0.75 });
      net('net-uv', ['==', ['get', 'mode'], 'uv'], { 'line-color': ['get', 'colour'], 'line-width': 3, 'line-opacity': 0.8 });
      net('net-bus', ['any', ['==', ['get', 'mode'], 'bus'], ['==', ['get', 'mode'], 'carousel']], { 'line-color': ['get', 'colour'], 'line-width': 3, 'line-opacity': 0.8 });
      net('net-train', ['==', ['get', 'mode'], 'train'], { 'line-color': ['get', 'colour'], 'line-width': 4.5, 'line-opacity': 0.9 });
      ctl._applyOverlayVisibility();

      if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: ctl._routeData || EMPTY });
      if (!map.getLayer('route-casing')) map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['case', ['==', ['get', 'type'], 'walk'], 6, 10], 'line-opacity': 0.95 } });
      if (!map.getLayer('route-walk')) map.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['==', ['get', 'type'], 'walk'], layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-dasharray': [1.2, 1.4] } });
      if (!map.getLayer('route-vehicle')) map.addLayer({ id: 'route-vehicle', type: 'line', source: 'route', filter: ['!=', ['get', 'type'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
      if (!map.getLayer('route-active')) map.addLayer({ id: 'route-active', type: 'line', source: 'route', filter: ['==', ['get', 'legIndex'], -1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.9 } });
    },

    // ---------------------------------------------------------------- network overlay
    async setOverlay(key, on) {
      ctl.overlay[key] = on;
      if (on) await ctl._loadNetwork();
      ctl._applyOverlayVisibility();
    },

    async _loadNetwork() {
      const wantLegacy = ctl.overlay.legacy;
      const modes = ['train', 'carousel', 'bus', 'uv', 'jeepney'];
      if (ctl.netData && ctl.netLegacy === wantLegacy) return;
      try {
        ctl.netData = await api.networkLines(modes, wantLegacy);
        ctl.netLegacy = wantLegacy;
        const src = ctl.map.getSource('net');
        if (src) src.setData(ctl.netData);
      } catch (e) { console.warn('could not load the network overlay', e); }
    },

    _applyOverlayVisibility() {
      const map = ctl.map;
      if (!map) return;
      const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      vis('net-train', ctl.overlay.train);
      vis('net-bus', ctl.overlay.bus);
      vis('net-uv', ctl.overlay.uv);
      vis('net-jeepney', ctl.overlay.jeepney);
      vis('net-legacy', ctl.overlay.legacy);
    },

    // ---------------------------------------------------------------- start / end markers
    setEndpoint(kind, place) {
      const key = kind === 'from' ? '_from' : '_to';
      if (ctl[key]) { ctl[key].remove(); ctl[key] = null; }
      if (!place) return;
      const el = h('div', { class: `mk ${kind === 'from' ? 'start' : 'end'}`, title: place.name }, h('span', {}, kind === 'from' ? 'A' : 'B'));
      ctl[key] = new maplibregl.Marker({ element: el, anchor: kind === 'from' ? 'center' : 'bottom-left' }).setLngLat([place.lng, place.lat]).addTo(ctl.map);
      if (!ctl.itinerary) ctl.fitToEndpoints();
    },

    fitToEndpoints() {
      const pts = [ctl._from, ctl._to].filter(Boolean).map((m) => m.getLngLat());
      if (pts.length === 1) ctl.map.flyTo({ center: pts[0], zoom: Math.max(ctl.map.getZoom(), 14), duration: 600 });
      else if (pts.length === 2) ctl._fit(pts);
    },

    // ---------------------------------------------------------------- itinerary
    showItinerary(it) {
      ctl.clearItinerary();
      ctl.itinerary = it;
      const feats = [];
      it.legs.forEach((leg, i) => {
        const color = leg.type === 'walk' ? '#4A90E2' : PUBTA.results.modeColor(leg);
        feats.push({ type: 'Feature', properties: { legIndex: i, type: leg.type, color, mode: leg.mode || 'walk' }, geometry: { type: 'LineString', coordinates: leg.geometry } });
      });
      ctl._routeData = { type: 'FeatureCollection', features: feats };
      const src = ctl.map.getSource('route');
      if (src) src.setData(ctl._routeData);

      // numbered boarding markers + alighting dots
      let n = 0;
      it.legs.forEach((leg) => {
        if (leg.type === 'walk') return;
        n += 1;
        const color = PUBTA.results.modeColor(leg);
        const from = leg.type === 'ride' ? leg.board : leg.from;
        const to = leg.type === 'ride' ? leg.alight : leg.to;
        ctl.markers.push(new maplibregl.Marker({ element: h('div', { class: 'mk', style: `--c:${color}`, title: `Board: ${from.name || ''}` }, String(n)) }).setLngLat([from.lng, from.lat]).addTo(ctl.map));
        if (leg.type === 'ride') ctl.markers.push(new maplibregl.Marker({ element: h('div', { class: 'mk alight', style: `--c:${color}`, title: `Get off: ${to.name || ''}` }) }).setLngLat([to.lng, to.lat]).addTo(ctl.map));
      });

      const all = it.legs.flatMap((l) => l.geometry);
      ctl._fit(all);
    },

    clearItinerary() {
      ctl.itinerary = null;
      ctl.markers.forEach((m) => m.remove());
      ctl.markers = [];
      ctl._routeData = EMPTY;
      const src = ctl.map && ctl.map.getSource('route');
      if (src) src.setData(EMPTY);
      if (ctl.map && ctl.map.getLayer('route-active')) ctl.map.setFilter('route-active', ['==', ['get', 'legIndex'], -1]);
      if (ctl.popup) { ctl.popup.remove(); ctl.popup = null; }
    },

    /** Zoom to one leg (when the user taps a step). */
    focusLeg(legIndex) {
      const it = ctl.itinerary;
      if (!it || !it.legs[legIndex]) return;
      ctl.map.setFilter('route-active', ['==', ['get', 'legIndex'], legIndex]);
      ctl._fit(it.legs[legIndex].geometry, { maxZoom: 17 });
    },

    focusPoint(lat, lng, zoom = 16) { ctl.map.flyTo({ center: [lng, lat], zoom, duration: 600 }); },

    _fit(coords, { maxZoom = 16.5 } = {}) {
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      const mobile = PUBTA.isMobile();
      const padding = mobile ? { top: 70, left: 28, right: 28, bottom: Math.round(window.innerHeight * 0.5) } : { top: 70, left: 60, right: 60, bottom: 60 };
      ctl.map.fitBounds(b, { padding, maxZoom, duration: 700 });
    },

    // ---------------------------------------------------------------- picking + click menu
    startPick(kind) {
      ctl.picking = kind;
      document.body.classList.add('map-picking');
      document.getElementById('pickText').textContent = kind === 'from' ? 'Click the map to set your starting point' : 'Click the map to set your destination';
      document.getElementById('pickBanner').hidden = false;
    },
    stopPick() {
      ctl.picking = null;
      document.body.classList.remove('map-picking');
      document.getElementById('pickBanner').hidden = true;
    },

    async _onClick(e) {
      const { lat, lng } = e.lngLat;
      if (ctl.picking) {
        const kind = ctl.picking;
        ctl.stopPick();
        ctl.handlers.onPick(kind, lat, lng);
        return;
      }
      // clicked a transit line? show its name
      const layers = NET_LAYERS.filter((id) => ctl.map.getLayer(id) && ctl.map.getLayoutProperty(id, 'visibility') === 'visible');
      const hits = layers.length ? ctl.map.queryRenderedFeatures(e.point, { layers }) : [];
      if (hits.length) {
        const seen = new Set();
        const rows = hits.filter((f) => !seen.has(f.properties.id) && seen.add(f.properties.id)).slice(0, 8)
          .map((f) => h('li', { class: 'mp-line' }, h('span', { class: 'dotc', style: `--c:${f.properties.colour}` }), h('span', {}, f.properties.ref ? `${f.properties.ref} · ` : '', f.properties.name, f.properties.source === 'dotc-gtfs' ? h('span', { class: 'conf' }, ' (older data)') : null)));
        ctl._popup([lng, lat], h('div', { class: 'mp' }, h('strong', {}, hits.length > 1 ? 'Routes here' : 'Route'), h('div', { class: 'mp-near' }, h('ul', {}, rows))));
        return;
      }
      // otherwise offer "start here / go here / rides near here"
      const body = h('div', { class: 'mp' }, h('strong', {}, 'Dropped pin…'));
      const near = h('div', { class: 'mp-near' });
      const actions = h('div', { class: 'mp-actions' },
        h('button', { type: 'button', onclick: () => { ctl.popup.remove(); ctl.handlers.onPick('from', lat, lng); } }, 'Start here'),
        h('button', { type: 'button', onclick: () => { ctl.popup.remove(); ctl.handlers.onPick('to', lat, lng); } }, 'Go here'),
        h('button', { type: 'button', onclick: () => ctl._showNearby(lat, lng, near) }, 'Rides near here'));
      body.append(actions, near);
      ctl._popup([lng, lat], body);
      api.describe(lat, lng).then((d) => { body.querySelector('strong').textContent = d.label; }).catch(() => { body.querySelector('strong').textContent = 'Selected point'; });
    },

    async _showNearby(lat, lng, host) {
      host.replaceChildren(h('small', {}, 'Looking for rides…'));
      try {
        const { lines } = await api.nearby(lat, lng, 450);
        if (!lines.length) { host.replaceChildren(h('small', {}, 'No transit lines within 450 m of this point.')); return; }
        host.replaceChildren(h('small', {}, `${lines.length} line${lines.length > 1 ? 's' : ''} within 450 m (nearest first):`),
          h('ul', {}, lines.slice(0, 12).map((l) => h('li', {},
            h('span', { class: 'dotc', style: `--c:${ctl.cfg.modes[l.mode].color}` }),
            h('span', {}, `${ctl.cfg.modes[l.mode].label}: ${l.ref ? l.ref + ' ' : ''}${l.name}`, h('br'), h('small', {}, `${l.distM} m away · heading ${l.heading}${l.source === 'dotc-gtfs' ? ' · older data' : ''}`))))));
      } catch (e) { host.replaceChildren(h('small', {}, e.message)); }
    },

    _popup(lngLat, content) {
      if (ctl.popup) ctl.popup.remove();
      ctl.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 8 }).setLngLat(lngLat).setDOMContent(content).addTo(ctl.map);
    },

    resize() { if (ctl.map) ctl.map.resize(); },
  };

  PUBTA.mapCtl = ctl;
})();
