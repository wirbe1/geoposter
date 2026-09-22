import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene, escapeXml, PALETTES, renderPoster, sceneTransform } from './poster.ts';
import { cameraBounds, project } from './geo.ts';
import { normalizeMap } from './map-data.ts';

const camera = { lat: 52.52, lon: 13.405, spanKm: 6 };
const scene = buildScene({
  bounds: cameraBounds(camera),
  features: [{ kind: 'major', rings: [[project(camera), project({ lat: 52.53, lon: 13.41 })]] }],
}, camera);
const settings = { title: 'Berlin', subtitle: 'Germany', caption: 'My favorite place', palette: PALETTES[0], camera };

test('poster is a standalone A2 vector with clipped geometry and permanent attribution', () => {
  const svg = renderPoster(scene, settings);
  assert.match(svg, /width="420mm" height="594mm"/);
  assert.match(svg, /clip-path="url\(#map-frame\)"/);
  assert.match(svg, /OpenStreetMap contributors/);
  assert.match(svg, /openstreetmap.org\/copyright/);
  assert.match(svg, /<path d="M/);
  assert.doesNotMatch(svg, /<image|https:.*\.png/);
});

test('all palettes change the actual map rendering, not just controls', () => {
  const outputs = PALETTES.map((palette) => renderPoster(scene, { ...settings, palette }));
  assert.equal(new Set(outputs).size, 3);
  for (const [index, svg] of outputs.entries()) assert.ok(svg.includes(PALETTES[index].major));
});

test('coastal water is a closed even-odd area beneath parks, lakes, and roads in every palette', () => {
  const coastCamera = { lat: 1, lon: 1, spanKm: 6 };
  const data = normalizeMap({ elements: [
    { type: 'way', id: 1, tags: { natural: 'coastline' }, geometry: [{ lat: 0, lon: 1 }, { lat: 2, lon: 1 }] },
    { type: 'way', id: 2, tags: { highway: 'primary' }, geometry: [{ lat: 1, lon: 0.9 }, { lat: 1.1, lon: 0.9 }] },
  ] }, cameraBounds(coastCamera, 1.4));
  const coastScene = buildScene(data, coastCamera);
  const ocean = coastScene.paths.find((path) => path.kind === 'ocean')!;
  assert.equal(ocean.d.split('Z').length - 1, 2, 'frame and land hole must both be closed');
  for (const palette of PALETTES) {
    const svg = renderPoster(coastScene, { ...settings, camera: coastCamera, palette });
    const oceanGroup = `<g fill="${palette.water}" fill-rule="evenodd"><path d="${ocean.d}"/></g>`;
    assert.ok(svg.includes(oceanGroup));
    assert.ok(svg.indexOf(oceanGroup) < svg.indexOf(`stroke="${palette.major}"`));
  }
});

test('user labels cannot inject SVG markup or external resources', () => {
  const svg = renderPoster(scene, { ...settings, title: '<script>&"', caption: '<image href="https://example.org/"/>' });
  assert.doesNotMatch(svg, /<script|<image/);
  assert.match(svg, /&lt;image/);
  assert.equal(escapeXml('\u0000<>&"\''), '&lt;&gt;&amp;&quot;&apos;');
});

test('preview transforms preserve original geometry and reflect pan and zoom', () => {
  assert.equal(sceneTransform(scene, camera), 'translate(0.00 0.00) scale(1.000000)');
  assert.match(sceneTransform(scene, { ...camera, spanKm: 3 }), /scale\(2.000000\)/);
  assert.notEqual(sceneTransform(scene, { ...camera, lon: 13.41 }), sceneTransform(scene, camera));
});
