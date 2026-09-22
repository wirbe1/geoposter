import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMap, stitchRings } from './map-data.ts';

const bounds = { south: 0, west: 0, north: 2, east: 2 };
const a = { lat: 0, lon: 0 };
const b = { lat: 0, lon: 1 };
const c = { lat: 1, lon: 1 };
const d = { lat: 1, lon: 0 };

test('joins unordered and reversed multipolygon segments into closed rings', () => {
  const rings = stitchRings([[a, b], [c, b], [d, a], [c, d]]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  assert.deepEqual(rings[0][0], rings[0][4]);
  assert.deepEqual(stitchRings([[a, b], [c, d]]), []);
});

test('normalizes roads, closed parks, water multipolygons and their holes', () => {
  const result = normalizeMap({ elements: [
    { type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [a, b] },
    { type: 'way', id: 2, tags: { leisure: 'park' }, geometry: [a, b, c, d, a] },
    { type: 'relation', id: 3, tags: { natural: 'water' }, members: [
      { type: 'way', ref: 4, role: 'outer', geometry: [a, b, c, d, a] },
      { type: 'way', ref: 5, role: 'inner', geometry: [
        { lat: 0.2, lon: 0.2 }, { lat: 0.2, lon: 0.3 }, { lat: 0.3, lon: 0.3 }, { lat: 0.2, lon: 0.2 },
      ] },
    ] },
    { type: 'way', id: 4, tags: { natural: 'water' }, geometry: [a, b, c, d, a] },
  ] }, bounds);
  assert.equal(result.features.length, 3);
  const water = result.features.find((feature) => feature.kind === 'water');
  assert.equal(water?.rings.length, 2);
  assert.ok(result.features.some((feature) => feature.kind === 'major'));
});

test('open OSM coastlines create a separate ocean area rather than being discarded', () => {
  const result = normalizeMap({ elements: [
    { type: 'way', id: 8, tags: { natural: 'coastline' }, geometry: [
      { lon: 1, lat: -1 }, { lon: 1, lat: 3 },
    ] },
  ] }, bounds);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].kind, 'ocean');
  assert.equal(result.features[0].rings.length, 2);
});

test('rejects incomplete service responses and empty geometry', () => {
  assert.throws(() => normalizeMap({}, bounds), /invalid response/);
  assert.throws(() => normalizeMap({ elements: [], remark: 'timeout' }, bounds), /could not finish/);
  assert.throws(() => normalizeMap({ elements: [] }, bounds), /No printable/);
  assert.throws(() => normalizeMap({ elements: [
    { type: 'way', id: 1, tags: { leisure: 'park' }, geometry: [a, b, c] },
    { type: 'way', id: 2, tags: { highway: 'primary' }, geometry: [a, { lat: null, lon: 0 }] },
  ] }, bounds), /No printable/);
});
