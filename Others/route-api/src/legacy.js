'use strict';
/**
 * The ORIGINAL PUBTA endpoints: GET /api/routes and GET /api/routes/:id (the six hand-drawn routes).
 *
 * They used to read from MySQL; the data now lives in data/legacy-routes.json, so no database server (and no
 * database password) is needed. Response shapes are unchanged, so older pages keep working.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'legacy-routes.json');

function mount(router, { file = DEFAULT_FILE } = {}) {
  let routes = [];
  try {
    routes = JSON.parse(fs.readFileSync(file, 'utf8')).routes || [];
  } catch (e) {
    console.warn(`legacy routes not loaded (${path.basename(file)}): ${e.message}`);
  }
  const byId = new Map(routes.map((r) => [r.id, r]));

  router.get('/routes', (req, res) => {
    res.json(routes.map((r) => ({ id: r.id, name: r.name, via: r.via || null })));
  });

  router.get('/routes/:id', (req, res) => {
    const r = byId.get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Route not found' });
    res.json({
      id: r.id,
      name: r.name,
      via: r.via || null,
      segments: r.segments.map((s, i) => ({ id: i + 1, color: s.color, description: s.description, coordinates: s.coordinates })),
      instructions: r.instructions || [],
    });
  });

  return routes.length;
}

module.exports = { mount };
