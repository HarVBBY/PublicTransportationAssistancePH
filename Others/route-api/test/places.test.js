'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Places, norm, tokens } = require('../src/places');

const LIST = [
  { n: 'University of the East - Caloocan', t: 'university', lat: 14.6578, lng: 120.9762, c: 'Caloocan', a: ['UE', 'UE Caloocan'] },
  { n: 'Manila Central University', t: 'university', lat: 14.6560, lng: 120.9840, c: 'Caloocan', a: ['MCU'] },
  { n: 'SM City Grand Central', t: 'mall', lat: 14.6551, lng: 120.9840, c: 'Caloocan', a: ['SM Grand Central', 'SMGC'] },
  { n: 'Monumento Station (LRT-1)', t: 'station', lat: 14.6544, lng: 120.9838, c: 'Caloocan', a: ['Monumento'] },
  { n: 'Santo Niño', t: 'area', lat: 14.70, lng: 120.97, c: 'Valenzuela' },
  { n: 'Samson Road', t: 'road', lat: 14.6577, lng: 120.9790, c: 'Caloocan' },
  { n: 'Rizal Avenue', t: 'road', lat: 14.654, lng: 120.983, c: 'Caloocan' },
];
const places = new Places(LIST);
const names = (q, o) => places.search(q, o).map((r) => r.name);

test('normalisation removes accents and punctuation and expands Filipino abbreviations', () => {
  assert.equal(norm('Santo Niño!'), 'santo nino');
  assert.deepEqual(tokens('Sto. Nino'), ['santo', 'nino']);
  assert.deepEqual(tokens('Rizal Ave.'), ['rizal', 'avenue']);
});

test('short names and aliases that commuters really use find the right place first', () => {
  assert.equal(names('ue')[0], 'University of the East - Caloocan');
  assert.equal(names('mcu')[0], 'Manila Central University');
  assert.equal(names('sm grand central')[0], 'SM City Grand Central');
  assert.equal(names('monumento')[0], 'Monumento Station (LRT-1)');
});

test('partial words and abbreviations match', () => {
  assert.equal(names('monum')[0], 'Monumento Station (LRT-1)');
  assert.equal(names('sto nino')[0], 'Santo Niño');
  assert.ok(names('rizal ave').includes('Rizal Avenue'));
  assert.ok(names('samson rd').includes('Samson Road'));
});

test('nonsense finds nothing, and a single letter is too short to search', () => {
  assert.deepEqual(names('zzzzqq'), []);
  assert.deepEqual(names('u'), []);
});

test('results carry a readable type and city for the dropdown', () => {
  const r = places.search('grand central')[0];
  assert.equal(r.typeLabel, 'Mall');
  assert.equal(r.city, 'Caloocan');
  assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lng));
});

test('landmarkNear picks notable places, and describe() labels a point', () => {
  assert.equal(places.landmarkNear(14.6552, 120.9841, 100), 'SM City Grand Central');
  assert.equal(places.landmarkNear(14.60, 120.90, 100), null);
  assert.match(places.describe(14.6552, 120.9841).label, /SM City Grand Central/);
  assert.match(places.describe(14.50, 120.50).label, /Pinned location/);
});
