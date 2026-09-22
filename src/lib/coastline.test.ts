import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coastlineWaterRings } from './coastline.ts';
import { project } from './geo.ts';
import type { Point } from './geo.ts';

const bounds = { south: 0, west: 0, north: 2, east: 2 };
const p = (lon: number, lat: number) => project({ lon, lat });

function filled(rings: Point[][], point: Point): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

test('open coastline fills water to the right, not land to the left', () => {
  const rings = coastlineWaterRings([[p(1, -1), p(1, 3)]], bounds);
  assert.equal(filled(rings, p(1.5, 1)), true);
  assert.equal(filled(rings, p(0.5, 1)), false);
  const reverse = coastlineWaterRings([[p(1, 3), p(1, -1)]], bounds);
  assert.equal(filled(reverse, p(1.5, 1)), false);
  assert.equal(filled(reverse, p(0.5, 1)), true);
});

test('unordered ways join without reversing coast direction', () => {
  const rings = coastlineWaterRings([
    [p(1, 0.8), p(1, 1.2)], [p(1, 1.2), p(1, 3)], [p(1, -1), p(1, 0.8)],
  ], bounds);
  assert.equal(filled(rings, p(1.5, 1)), true);
  assert.equal(filled(rings, p(0.5, 1)), false);
});

test('every ordering of fragmented coastlines produces the same land and water', () => {
  const segments = [
    [p(1, -1), p(1, 0.5)], [p(1, 0.5), p(1, 1)], [p(1, 1), p(1, 1.5)], [p(1, 1.5), p(1, 3)],
  ];
  function permutations<T>(items: T[]): T[][] {
    return items.length === 0 ? [[]] : items.flatMap((item, i) =>
      permutations(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]));
  }
  for (const ways of permutations(segments)) {
    const rings = coastlineWaterRings(ways, bounds);
    assert.equal(filled(rings, p(1.5, 1)), true);
    assert.equal(filled(rings, p(0.5, 1)), false);
  }
});

test('horizontal and corner-crossing shores respect the water side', () => {
  const horizontal = coastlineWaterRings([[p(-1, 1), p(3, 1)]], bounds);
  assert.equal(filled(horizontal, p(1, 0.5)), true);
  assert.equal(filled(horizontal, p(1, 1.5)), false);
  const diagonal = coastlineWaterRings([[p(-1, -1), p(0, 0), p(2, 2), p(3, 3)]], bounds);
  assert.equal(filled(diagonal, p(1.5, 0.5)), true);
  assert.equal(filled(diagonal, p(0.5, 1.5)), false);
});

test('separate coastlines enclose a bay without flooding either bank', () => {
  const rings = coastlineWaterRings([
    [p(0.5, -1), p(0.5, 3)], [p(1.5, 3), p(1.5, -1)],
  ], bounds);
  assert.equal(filled(rings, p(1, 1)), true);
  assert.equal(filled(rings, p(0.2, 1)), false);
  assert.equal(filled(rings, p(1.8, 1)), false);
});

test('islands are holes in the ocean, including alongside mainland coasts', () => {
  const island = [p(1.2, 0.8), p(1.6, 0.8), p(1.6, 1.2), p(1.2, 1.2), p(1.2, 0.8)];
  for (const ways of [[island], [[p(0.5, -1), p(0.5, 3)], island]]) {
    const rings = coastlineWaterRings(ways, bounds);
    assert.equal(filled(rings, p(1.4, 1)), false);
    assert.equal(filled(rings, p(1, 1)), true);
  }
});

test('a clockwise closed coast fills only its interior water', () => {
  const rings = coastlineWaterRings([[
    p(0.5, 0.5), p(0.5, 1.5), p(1.5, 1.5), p(1.5, 0.5), p(0.5, 0.5),
  ]], bounds);
  assert.equal(filled(rings, p(1, 1)), true);
  assert.equal(filled(rings, p(0.2, 1)), false);
});

test('coastlines can leave and reenter the requested extent', () => {
  const rings = coastlineWaterRings([[
    p(0.5, -1), p(0.5, 3), p(1.5, 3), p(1.5, -1),
  ]], bounds);
  assert.equal(filled(rings, p(1, 1)), true);
  assert.equal(filled(rings, p(0.2, 1)), false);
  assert.equal(filled(rings, p(1.8, 1)), false);
});

test('inland maps remain unchanged and missing coast segments fail explicitly', () => {
  assert.deepEqual(coastlineWaterRings([], bounds), []);
  assert.throws(() => coastlineWaterRings([[p(1, 0.5), p(1, 1.5)]], bounds), /Coastline geometry is incomplete/);
});
