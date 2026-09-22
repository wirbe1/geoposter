import { project } from './geo.ts';
import type { Bounds, Point } from './geo.ts';
import { coastlineWaterRings } from './coastline.ts';

export type FeatureKind = 'ocean' | 'water' | 'park' | 'minor' | 'major' | 'motorway' | 'path' | 'rail';

export interface MapFeature {
  kind: FeatureKind;
  rings: Point[][];
}

export interface MapData {
  features: MapFeature[];
  bounds: Bounds;
}

interface Coordinate {
  lat: number;
  lon: number;
}

interface OsmMember {
  type: string;
  ref: number;
  role: string;
  geometry?: Coordinate[];
}

interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: Coordinate[];
  members?: OsmMember[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coordinates(value: unknown): Coordinate[] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  if (!value.every((p: unknown) => isRecord(p)
    && typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85
    && typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180)) {
    return undefined;
  }
  return value as Coordinate[];
}

function parseElement(value: unknown): OsmElement | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.id !== 'number') return undefined;
  const tags: Record<string, string> = {};
  if (isRecord(value.tags)) {
    for (const [key, tag] of Object.entries(value.tags)) {
      if (typeof tag === 'string') tags[key] = tag;
    }
  }
  const members: OsmMember[] = [];
  if (Array.isArray(value.members)) {
    for (const member of value.members) {
      if (isRecord(member) && member.type === 'way' && typeof member.ref === 'number') {
        members.push({
          type: member.type,
          ref: member.ref,
          role: typeof member.role === 'string' ? member.role : '',
          geometry: coordinates(member.geometry),
        });
      }
    }
  }
  return { type: value.type, id: value.id, tags, geometry: coordinates(value.geometry), members };
}

function same(a: Coordinate, b: Coordinate): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

// Multipolygon members can arrive unordered and in either direction.
export function stitchRings(segments: Coordinate[][]): Coordinate[][] {
  const remaining = segments.map((segment) => [...segment]);
  const rings: Coordinate[][] = [];
  while (remaining.length > 0) {
    const ring = remaining.pop()!;
    while (!same(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1];
      const index = remaining.findIndex((segment) => same(segment[0], end) || same(segment[segment.length - 1], end));
      if (index === -1) break;
      const next = remaining.splice(index, 1)[0];
      if (!same(next[0], end)) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function featureKind(tags: Record<string, string>): FeatureKind | undefined {
  if (tags.natural === 'water' || ['reservoir', 'basin'].includes(tags.landuse)
    || tags.waterway === 'riverbank') return 'water';
  if (['park', 'garden', 'nature_reserve'].includes(tags.leisure)
    || ['forest', 'grass', 'meadow', 'recreation_ground'].includes(tags.landuse)
    || ['wood', 'grassland'].includes(tags.natural)) return 'park';
  if (tags.railway === 'rail' && tags.tunnel !== 'yes') return 'rail';
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(tags.highway)) return 'motorway';
  if (['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'].includes(tags.highway)) return 'major';
  if (['residential', 'unclassified', 'living_street', 'service', 'pedestrian', 'road'].includes(tags.highway)) return 'minor';
  if (['footway', 'cycleway', 'path', 'steps', 'track', 'bridleway'].includes(tags.highway)) return 'path';
  return undefined;
}

export function normalizeMap(payload: unknown, bounds: Bounds): MapData {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) {
    throw new Error('The map service returned an invalid response. Please retry.');
  }
  if (typeof payload.remark === 'string') {
    throw new Error('The map service could not finish this area. Try a smaller area or retry later.');
  }
  const elements = payload.elements.map(parseElement).filter((element) => element !== undefined);
  const features: MapFeature[] = [];
  const coastlines = elements.filter((element) =>
    element.type === 'way' && element.tags?.natural === 'coastline' && element.geometry)
    .map((element) => element.geometry!.map(project));
  const ocean = coastlineWaterRings(coastlines, bounds);
  if (ocean.length > 0) features.push({ kind: 'ocean', rings: ocean });
  const representedWays = new Set<string>();

  for (const element of elements) {
    const kind = featureKind(element.tags ?? {});
    if (element.type !== 'relation' || (kind !== 'water' && kind !== 'park')) continue;
    const members = element.members ?? [];
    const outer = stitchRings(members.filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry!));
    const inner = stitchRings(members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry!));
    if (outer.length === 0) continue;
    features.push({ kind, rings: [...outer, ...inner].map((ring) => ring.map(project)) });
    for (const member of members) representedWays.add(`${kind}:${member.ref}`);
  }

  for (const element of elements) {
    const kind = featureKind(element.tags ?? {});
    if (element.type !== 'way' || !kind || !element.geometry || representedWays.has(`${kind}:${element.id}`)) continue;
    const isArea = kind === 'water' || kind === 'park';
    if (isArea && (element.geometry.length < 4 || !same(element.geometry[0], element.geometry[element.geometry.length - 1]))) continue;
    features.push({ kind, rings: [element.geometry.map(project)] });
  }
  if (features.length === 0) {
    throw new Error('No printable map features were found here. Try another location or a wider area.');
  }
  return { features, bounds };
}
