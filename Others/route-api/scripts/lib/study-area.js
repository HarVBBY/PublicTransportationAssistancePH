'use strict';
/**
 * The geographic scope of PUBTA.
 *
 * CAMANAVA = Caloocan, Malabon, Navotas, Valenzuela. The ingest box also covers the neighbouring
 * corridors people actually travel through (Novaliches/Fairview, Balintawak, North EDSA, Cubao,
 * Tondo/Divisoria/Recto), so trips that start in CAMANAVA but end just outside still work.
 */
const STUDY_BBOX = { south: 14.575, west: 120.89, north: 14.82, east: 121.10 };
const CAMANAVA_CITIES = ['Caloocan', 'Malabon', 'Navotas', 'Valenzuela'];
const bboxStr = (b = STUDY_BBOX) => `${b.south},${b.west},${b.north},${b.east}`;
module.exports = { STUDY_BBOX, CAMANAVA_CITIES, bboxStr };
