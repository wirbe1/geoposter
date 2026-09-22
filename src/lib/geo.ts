export interface Location {
  lat: number;
  lon: number;
}

export interface Camera extends Location {
  spanKm: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MAP = { x: 65, y: 65, width: 870, height: 1040 } as const;
export const POSTER = { width: 1000, height: 1000 * 594 / 420 } as const;
export const MIN_SPAN_KM = 1;
export const MAX_SPAN_KM = 16;
const EARTH_RADIUS = 6378137;
const RADIANS = Math.PI / 180;

export function project({ lat, lon }: Location): Point {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) {
    throw new Error('Choose a location between 85° south and 85° north.');
  }
  return {
    x: EARTH_RADIUS * lon * RADIANS,
    y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * RADIANS / 2)),
  };
}

export function unproject({ x, y }: Point): Location {
  return {
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) / RADIANS,
    lon: x / EARTH_RADIUS / RADIANS,
  };
}

export function metersPerUnit(camera: Camera): number {
  return camera.spanKm * 1000 / Math.cos(camera.lat * RADIANS) / MAP.width;
}

export function cameraBounds(camera: Camera, padding = 1): Bounds {
  const center = project(camera);
  const scale = metersPerUnit(camera);
  const sw = unproject({
    x: center.x - MAP.width * scale * padding / 2,
    y: center.y - MAP.height * scale * padding / 2,
  });
  const ne = unproject({
    x: center.x + MAP.width * scale * padding / 2,
    y: center.y + MAP.height * scale * padding / 2,
  });
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

export function containsBounds(outer: Bounds, inner: Bounds): boolean {
  return outer.south <= inner.south && outer.west <= inner.west
    && outer.north >= inner.north && outer.east >= inner.east;
}

export function validateBounds(bounds: Bounds): void {
  if (!Object.values(bounds).every(Number.isFinite)
    || bounds.south >= bounds.north || bounds.west >= bounds.east
    || bounds.west < -180 || bounds.east > 180
    || bounds.south < -85 || bounds.north > 85) {
    throw new Error('This map area crosses the date line or polar limit. Move the map toward the selected city.');
  }
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  const center = project(camera);
  const scale = metersPerUnit(camera);
  const location = unproject({ x: center.x - dx * scale, y: center.y + dy * scale });
  return {
    lat: Math.max(-84.8, Math.min(84.8, location.lat)),
    lon: Math.max(-179.8, Math.min(179.8, location.lon)),
    spanKm: camera.spanKm,
  };
}

export function zoomCamera(camera: Camera, factor: number): Camera {
  return { ...camera, spanKm: Math.max(MIN_SPAN_KM, Math.min(MAX_SPAN_KM, camera.spanKm * factor)) };
}

export function mapPoint(point: Point, camera: Camera): Point {
  const center = project(camera);
  const scale = metersPerUnit(camera);
  return {
    x: MAP.x + MAP.width / 2 + (point.x - center.x) / scale,
    y: MAP.y + MAP.height / 2 - (point.y - center.y) / scale,
  };
}

export function formatCoordinates(location: Location): string {
  return `${Math.abs(location.lat).toFixed(3)}° ${location.lat >= 0 ? 'N' : 'S'}  /  ${Math.abs(location.lon).toFixed(3)}° ${location.lon >= 0 ? 'E' : 'W'}`;
}
