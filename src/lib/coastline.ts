import { project } from './geo.ts';
import type { Bounds, Point } from './geo.ts';

const EPSILON = 0.00001;
const key = (p: Point) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const incomplete = () => new Error('Coastline geometry is incomplete in this area. Try a wider map area or retry later.');

function signedArea(ring: Point[]): number {
  const origin = ring[0];
  return ring.slice(1).reduce((area, p, i) => {
    const previous = ring[i];
    return area + (previous.x - origin.x) * (p.y - origin.y)
      - (p.x - origin.x) * (previous.y - origin.y);
  }, 0) / 2;
}

function joinDirected(segments: Point[][]): Point[][] {
  const starts = new Map<string, number>();
  segments.forEach((segment, i) => {
    const start = key(segment[0]);
    if (starts.has(start)) throw incomplete();
    starts.set(start, i);
  });
  const visited = new Set<number>();
  const chains: Point[][] = [];
  const ends = new Set(segments.map((segment) => key(segment[segment.length - 1])));
  const order = segments.map((_, i) => i).sort((a, b) =>
    Number(ends.has(key(segments[a][0]))) - Number(ends.has(key(segments[b][0]))));
  for (const i of order) {
    if (visited.has(i)) continue;
    const chain = [...segments[i]];
    visited.add(i);
    while (!same(chain[0], chain[chain.length - 1])) {
      const next = starts.get(key(chain[chain.length - 1]));
      if (next === undefined || visited.has(next)) break;
      chain.push(...segments[next].slice(1));
      visited.add(next);
    }
    chains.push(chain);
  }
  return chains;
}

/** OSM coastlines run with land on their left. Preserve direction when stitching. */
export function coastlineWaterRings(ways: Point[][], bounds: Bounds): Point[][] {
  if (ways.length === 0) return [];
  const sw = project({ lat: bounds.south, lon: bounds.west });
  const ne = project({ lat: bounds.north, lon: bounds.east });
  const width = ne.x - sw.x;
  const height = ne.y - sw.y;
  const perimeter = 2 * (width + height);
  const corners = [sw, { x: ne.x, y: sw.y }, ne, { x: sw.x, y: ne.y }];
  const frame = [...corners, sw];
  const cornerPositions = [0, width, width + height, 2 * width + height];

  function boundaryPosition(p: Point): number | undefined {
    if (Math.abs(p.y - sw.y) < EPSILON) return p.x - sw.x;
    if (Math.abs(p.x - ne.x) < EPSILON) return width + p.y - sw.y;
    if (Math.abs(p.y - ne.y) < EPSILON) return width + height + ne.x - p.x;
    if (Math.abs(p.x - sw.x) < EPSILON) return 2 * width + height + ne.y - p.y;
    return undefined;
  }

  function clip(a: Point, b: Point): Point[] | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let start = 0;
    let end = 1;
    for (const [p, q] of [[-dx, a.x - sw.x], [dx, ne.x - a.x], [-dy, a.y - sw.y], [dy, ne.y - a.y]]) {
      if (p === 0) {
        if (q < 0) return null;
      } else if (p < 0) start = Math.max(start, q / p);
      else end = Math.min(end, q / p);
      if (start >= end) return null;
    }
    const from = { x: a.x + start * dx, y: a.y + start * dy };
    const to = { x: a.x + end * dx, y: a.y + end * dy };
    return same(from, to) ? null : [from, to];
  }

  const segments: Point[][] = [];
  for (const way of ways) {
    for (let i = 1; i < way.length; i++) {
      const clipped = clip(way[i - 1], way[i]);
      if (clipped) segments.push(clipped);
    }
  }
  const chains = joinDirected(segments);
  const closed = chains.filter((chain) => same(chain[0], chain[chain.length - 1]));
  const open = chains.filter((chain) => !same(chain[0], chain[chain.length - 1]));
  const landRings: Point[][] = [...closed];
  const starts = open.map((chain) => boundaryPosition(chain[0]));
  const ends = open.map((chain) => boundaryPosition(chain[chain.length - 1]));
  if (starts.some((p) => p === undefined) || ends.some((p) => p === undefined)) throw incomplete();

  const visited = new Set<number>();
  for (let i = 0; i < open.length; i++) {
    if (visited.has(i)) continue;
    const ring: Point[] = [];
    let current = i;
    do {
      if (visited.has(current)) throw incomplete();
      visited.add(current);
      for (const point of open[current]) ring.push(point);
      const end = ends[current]!;
      const candidates = starts.map((start, index) => ({
        index, distance: (start! - end + perimeter) % perimeter,
      })).sort((a, b) => a.distance - b.distance);
      const next = candidates[0];
      // Close land along the rectangle counterclockwise, joining separate
      // coastline fragments rather than painting overlapping ocean wedges.
      const boundaryCorners = cornerPositions.map((position, index) => ({
        point: corners[index], distance: (position - end + perimeter) % perimeter,
      })).filter((corner) => corner.distance > EPSILON && corner.distance < next.distance - EPSILON)
        .sort((a, b) => a.distance - b.distance);
      ring.push(...boundaryCorners.map((corner) => corner.point));
      current = next.index;
    } while (current !== i);
    ring.push(ring[0]);
    landRings.push(ring);
  }

  if (landRings.length === 0) return [];
  // Closed CCW coastlines surround islands (water outside). A clockwise
  // coastline surrounds water instead, e.g. a landlocked sea.
  const largest = landRings.reduce((a, b) => Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b);
  return open.length > 0 || signedArea(largest) > 0 ? [frame, ...landRings] : landRings;
}
