/* PUBTA planner - the "From" / "To" boxes: autocomplete combobox with keyboard support. */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});
  const { h, api, store } = PUBTA;

  const ABBR = { station: 'TR', mall: 'MA', supermarket: 'SM', university: 'UN', college: 'CO', school: 'SC', hospital: 'HO', townhall: 'CH', barangay_hall: 'BH', bus_station: 'TM', marketplace: 'MK', area: 'AR', park: 'PK', attraction: 'LM', road: 'RD', police: 'PO', courthouse: 'CT', library: 'LB', cinema: 'CI', point: 'PIN', gps: 'GPS' };
  // [label shown on the quick-pick chip, query used to find the place]
  const POPULAR = [['Monumento (LRT-1)', 'monumento station'], ['SM City Grand Central', 'sm grand central'], ['Victory Mall', 'victory mall'], ['UE Caloocan', 'ue'], ['MCU', 'mcu'], ['Valenzuela City Hall', 'valenzuela city hall']];

  class PlaceInput {
    /**
     * @param {{field: HTMLElement, onChange: Function, onPicked?: Function, getNear: Function}} opts
     */
    constructor({ field, onChange, onPicked, getNear }) {
      this.field = field;
      this.kind = field.dataset.kind;
      this.input = field.querySelector('input');
      this.list = field.querySelector('.suggest');
      this.onChange = onChange || (() => {});
      this.onPicked = onPicked || (() => {});
      this.getNear = getNear || (() => null);
      this.place = null;
      this.items = [];
      this.itemsFor = null; // the text the currently shown suggestions were fetched for
      this.active = -1;
      this.seq = 0;
      this.abort = null;
      this.timer = null;
      this._bind();
    }

    _bind() {
      this.input.addEventListener('input', () => {
        if (this.place) { this.place = null; this.field.classList.remove('picked'); this.onChange(this); }
        this.input.setAttribute('aria-activedescendant', '');
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._searchNow(), 160);
      });
      this.input.addEventListener('focus', () => { this.input.select(); this._searchNow(); });
      this.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.input) this.close(); }, 160));
      this.input.addEventListener('keydown', async (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (this.list.hidden) this._searchNow(); else this._move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); }
        else if (e.key === 'Enter') {
          if (this.list.hidden || !this.items.length) return; // let the form submit
          e.preventDefault();
          // never accept a suggestion that belongs to an older version of the text
          if (this.itemsFor !== this.text) { clearTimeout(this.timer); await this._searchNow(); }
          if (this.items.length && !this.list.hidden) this._pick(this.items[Math.max(0, this.active)]);
        } else if (e.key === 'Escape') this.close();
      });
    }

    get text() { return this.input.value.trim(); }

    setPlace(place, { silent = false } = {}) {
      this._cancel();
      this.place = place;
      this.input.value = place ? place.name : '';
      this.field.classList.toggle('picked', Boolean(place));
      this.close();
      if (!silent) this.onChange(this);
    }

    clear() { this.setPlace(null); }

    /** The chosen place, or - if the user only typed text - the best match for it. */
    async resolve() {
      if (this.place) return this.place;
      if (this.text.length < 2) return null;
      try {
        const { results } = await api.search(this.text, this.getNear());
        if (results.length) { this.setPlace(this._toPlace(results[0]), { silent: true }); return this.place; }
      } catch (e) { /* fall through */ }
      return null;
    }

    _toPlace(r) { return { lat: r.lat, lng: r.lng, name: r.name, type: r.type, city: r.city }; }

    /** Forget any pending or in-flight search (its result must not re-open the list). */
    _cancel() {
      clearTimeout(this.timer);
      this.seq++;
      if (this.abort) this.abort.abort();
    }

    async _searchNow() {
      const q = this.text;
      if (this.abort) this.abort.abort();
      const mySeq = ++this.seq;
      if (q.length < 2) { this._render(this._defaults(), q); return; }
      this.abort = new AbortController();
      try {
        const { results } = await api.search(q, this.getNear(), this.abort.signal);
        if (mySeq !== this.seq) return;
        this._render(results.map((r) => ({ ...r, kind: 'place' })), q);
      } catch (e) {
        if (e.name === 'AbortError' || mySeq !== this.seq) return;
        this._render([], q, e.message);
      }
    }

    _defaults() {
      const recents = store.get('pubta.recent', []).map((p) => ({ ...p, kind: 'recent', typeLabel: 'Recent' }));
      const popular = (PlaceInput.popular || []).map((p) => ({ ...p, kind: 'popular' }));
      return [...recents.slice(0, 4), ...popular.filter((p) => !recents.some((r) => r.name === p.name)).slice(0, 5)];
    }

    _render(items, q, error) {
      this.items = items;
      this.itemsFor = q;
      this.active = items.length ? 0 : -1;
      this.list.replaceChildren();
      if (!items.length && q.length < 2) { this.close(); return; }
      if (!items.length) {
        this.list.append(h('li', { class: 's-empty' }, error || `No places found for “${q}”. Try a landmark, mall, school, barangay or road - or pick a point on the map.`));
      }
      let lastKind = null;
      items.forEach((it, i) => {
        if (it.kind !== lastKind && (it.kind === 'recent' || it.kind === 'popular')) this.list.append(h('li', { class: 's-head', role: 'presentation' }, it.kind === 'recent' ? 'Recent' : 'Popular places'));
        lastKind = it.kind;
        this.list.append(h('li', { id: `${this.kind}-opt-${i}`, role: 'option', 'aria-selected': i === this.active ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); this._pick(it); } },
          h('span', { class: 's-ico' }, ABBR[it.type] || '•'),
          h('span', {}, h('span', { class: 's-name' }, it.name), h('span', { class: 's-sub' }, [it.typeLabel, it.city].filter(Boolean).join(' · ')))));
      });
      this.list.hidden = false;
      this.input.setAttribute('aria-expanded', 'true');
    }

    _move(dir) {
      if (!this.items.length) return;
      this.active = (this.active + dir + this.items.length) % this.items.length;
      this.list.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', i === this.active ? 'true' : 'false'));
      const li = this.list.querySelector(`#${this.kind}-opt-${this.active}`);
      if (li) { li.scrollIntoView({ block: 'nearest' }); this.input.setAttribute('aria-activedescendant', li.id); }
    }

    _pick(it) {
      if (!it) return;
      const place = this._toPlace(it);
      this.setPlace(place);
      PlaceInput.remember(place);
      this.onPicked(this);
    }

    close() { this.list.hidden = true; this.input.setAttribute('aria-expanded', 'false'); }

    static remember(place) {
      if (place.type === 'point' || place.type === 'gps') return;
      const list = store.get('pubta.recent', []).filter((p) => p.name !== place.name);
      list.unshift({ name: place.name, lat: place.lat, lng: place.lng, type: place.type, city: place.city });
      store.set('pubta.recent', list.slice(0, 6));
    }

    /** Look the popular places up once so the empty box (and the quick-pick chips) can suggest them. */
    static async loadPopular() {
      const found = await Promise.all(POPULAR.map(([label, q]) => api.search(q).then((r) => (r.results[0] ? { ...r.results[0], label } : null)).catch(() => null)));
      PlaceInput.popular = found.filter(Boolean).map((r) => ({ lat: r.lat, lng: r.lng, name: r.name, type: r.type, typeLabel: r.typeLabel, city: r.city, label: r.label }));
      return PlaceInput.popular;
    }
  }
  PlaceInput.popular = [];

  PUBTA.PlaceInput = PlaceInput;
})();
