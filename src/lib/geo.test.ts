import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAP, MAX_SPAN_KM, MIN_SPAN_KM, cameraBounds, containsBounds, formatCoordinates,
  mapPoint, panCamera, project, unproject, validateBounds, zoomCamera,
} from './geo.ts';

const camera = { lat: 52.52, lon: 13.405, spanKm: 6 };

test('Mercator coordinates round-trip and city is centered in the map frame', () => {
  const restored = unproject(project(camera));
  assert.ok(Math.abs(restored.lat - camera.lat) < 1e-10);
  assert.ok(Math.abs(restored.lon - camera.lon) < 1e-10);
  assert.deepEqual(mapPoint(project(camera), camera), { x: MAP.x + MAP.width / 2, y: MAP.y + MAP.height / 2 });
});

test('a buffered data extent contains the viewport but not a distant pan', () => {
  const bounds = cameraBounds(camera, 1.4);
  assert.ok(containsBounds(bounds, cameraBounds(camera)));
  assert.ok(!containsBounds(bounds, cameraBounds(panCamera(camera, 1000, 0))));
});

test('dragging right moves the camera west; dragging down moves it north', () => {
  const moved = panCamera(camera, 100, 100);
  assert.ok(moved.lon < camera.lon);
  assert.ok(moved.lat > camera.lat);
  assert.equal(moved.spanKm, camera.spanKm);
});

test('zoom limits keep fetch areas bounded', () => {
  assert.equal(zoomCamera(camera, 100).spanKm, MAX_SPAN_KM);
  assert.equal(zoomCamera(camera, 0.001).spanKm, MIN_SPAN_KM);
});

test('date-line and polar extents fail explicitly instead of querying the whole world', () => {
  assert.throws(() => validateBounds(cameraBounds({ lat: 0, lon: 179.999, spanKm: 16 })), /date line/);
  assert.throws(() => project({ lat: 89, lon: 0 }), /85/);
  assert.throws(() => project({ lat: NaN, lon: 0 }), /85/);
});

test('coordinates correctly label both hemispheres', () => {
  assert.equal(formatCoordinates({ lat: -33.8688, lon: 151.2093 }), '33.869° S  /  151.209° E');
});
