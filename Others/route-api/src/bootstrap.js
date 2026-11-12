'use strict';
/**
 * Loads the compiled data and wires the planner together. Used by the server, the tests and the CLI helpers.
 */
const fs = require('fs');
const path = require('path');
const { Network } = require('./network');
const { FareEngine } = require('./fares');
const { Planner } = require('./planner');

const DATA = path.join(__dirname, '..', 'data');
const readJSON = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p), 'utf8'));

function loadPlanner({ networkFile = 'network.json', withPlaces = true, withRoads = true } = {}) {
  const modesConfig = readJSON('config', 'modes.json');
  const faresConfig = readJSON('config', 'fares.json');
  const network = new Network(readJSON(networkFile), modesConfig);
  const fares = new FareEngine(faresConfig);

  let areas = null;
  let places = null;
  let roads = null;
  try { const { Areas } = require('./areas'); if (fs.existsSync(path.join(DATA, 'areas.json'))) areas = new Areas(readJSON('areas.json')); } catch (e) { console.warn('areas not loaded:', e.message); }
  try { const { Places } = require('./places'); if (withPlaces && fs.existsSync(path.join(DATA, 'places.json'))) places = new Places(readJSON('places.json'), areas); } catch (e) { console.warn('places not loaded:', e.message); }
  // the road map makes walking / tricycle legs follow real streets; without it they fall back to straight lines
  try { const { Roads } = require('./roads'); const f = path.join(DATA, 'roads.bin.gz'); if (withRoads && fs.existsSync(f)) roads = Roads.fromFile(f); } catch (e) { console.warn('road map not loaded:', e.message); }

  const planner = new Planner(network, fares, { areas, places, modesConfig, roads, bbox: network.meta.bbox });
  return { planner, network, fares, areas, places, roads, modesConfig, faresConfig };
}

module.exports = { loadPlanner, DATA };
