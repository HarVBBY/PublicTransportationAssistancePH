/* PUBTA planner - talks to the PUBTA server. */
(function () {
  'use strict';
  const PUBTA = (window.PUBTA = window.PUBTA || {});

  class ApiError extends Error {
    constructor(message, code, status) { super(message); this.code = code; this.status = status; }
  }

  const api = {
    base: '',

    /**
     * The page is normally served by the PUBTA server itself (same origin). If it was opened from another
     * static server (e.g. VS Code Live Server on :5501) fall back to the API on localhost:8000.
     * You can also force a server with  ?api=http://host:port
     */
    async init() {
      const override = new URLSearchParams(location.search).get('api');
      const candidates = override ? [override.replace(/\/$/, '')] : ['', 'http://localhost:8000'];
      for (const base of candidates) {
        try {
          const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
          if (res.ok) { api.base = base; return true; }
        } catch (e) { /* try the next one */ }
      }
      return false;
    },

    async request(path, { method = 'GET', body, params, signal } = {}) {
      let url = `${api.base}/api${path}`;
      if (params) {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
        url += `?${q}`;
      }
      let res;
      try {
        res = await fetch(url, { method, signal, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new ApiError("Can't reach the PUBTA server. Make sure it is running (npm start in Others/route-api).", 'NETWORK', 0);
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON body */ }
      if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status}).`, data && data.code, res.status);
      return data;
    },

    config: () => api.request('/config'),
    search: (q, near, signal) => api.request('/places/search', { params: { q, lat: near && near.lat, lng: near && near.lng }, signal }),
    describe: (lat, lng) => api.request('/places/describe', { params: { lat, lng } }),
    nearby: (lat, lng, r = 400) => api.request('/nearby', { params: { lat, lng, r } }),
    plan: (body) => api.request('/plan', { method: 'POST', body }),
    networkLines: (modes, legacy) => api.request('/network/lines', { params: { modes: modes.join(','), legacy: legacy ? 1 : 0 } }),
  };

  PUBTA.api = api;
  PUBTA.ApiError = ApiError;
})();
