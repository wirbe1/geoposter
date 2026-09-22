import { cameraBounds, project, validateBounds } from './geo.ts';
import type { Camera, Location } from './geo.ts';
import { normalizeMap } from './map-data.ts';
import type { MapData } from './map-data.ts';

export interface City extends Location {
  id: string;
  name: string;
  label: string;
  country: string;
}

interface ProviderOptions {
  geocoderUrl?: string;
  overpassUrl?: string;
  fetcher?: typeof fetch;
}

export function parseCities(payload: unknown): City[] {
  if (!Array.isArray(payload)) throw new Error('The city search service returned an invalid response.');
  return payload.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const item = entry as Record<string, unknown>;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (typeof item.lat !== 'string' || typeof item.lon !== 'string'
      || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180
      || typeof item.display_name !== 'string' || typeof item.place_id !== 'number') return [];
    const address = typeof item.address === 'object' && item.address !== null
      ? item.address as Record<string, unknown> : {};
    return [{
      id: String(item.place_id),
      name: typeof item.name === 'string' && item.name ? item.name : item.display_name.split(',')[0],
      label: item.display_name,
      country: typeof address.country === 'string' ? address.country : '',
      lat,
      lon,
    }];
  });
}

export function buildOverpassQuery(camera: Camera): { query: string; bounds: ReturnType<typeof cameraBounds> } {
  const bounds = cameraBounds(camera, 1.4);
  validateBounds(bounds);
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((n) => n.toFixed(6)).join(',');
  return {
    bounds,
    query: `[out:json][timeout:45][maxsize:268435456];(
way["highway"]["area"!="yes"](${box});
way["railway"="rail"](${box});
way["natural"="coastline"](${box});
nwr["natural"~"^(water|wood|grassland)$"](${box});
nwr["landuse"~"^(forest|grass|meadow|recreation_ground|reservoir|basin)$"](${box});
nwr["leisure"~"^(park|garden|nature_reserve)$"](${box});
nwr["waterway"="riverbank"](${box});
);out geom;`,
  };
}

function serviceError(response: Response, service: string): Error {
  if (response.status === 429) return new Error(`${service} is busy. Wait a minute before trying again.`);
  if (response.status === 504) return new Error(`${service} timed out. Try a smaller map area.`);
  return new Error(`${service} is unavailable (HTTP ${response.status}). Please retry later.`);
}

async function requestJson(fetcher: typeof fetch, url: string, init: RequestInit, service: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    if (init.signal?.aborted) {
      if (init.signal.reason instanceof DOMException && init.signal.reason.name === 'TimeoutError') {
        throw new Error(`${service} took too long to respond. Please retry with a smaller area.`);
      }
      throw error;
    }
    if (error instanceof TypeError) throw new Error(`Cannot reach ${service}. Check your connection and try again.`);
    throw error;
  }
  if (!response.ok) throw serviceError(response, service);
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${service} returned unreadable data. Please retry later.`);
    throw error;
  }
}

export function createMapServices(options: ProviderOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const geocoderUrl = options.geocoderUrl ?? 'https://nominatim.openstreetmap.org/search';
  const overpassUrl = options.overpassUrl ?? 'https://overpass-api.de/api/interpreter';
  const cityCache = new Map<string, City[]>();
  let lastSearch = 0;
  let lastMapRequest = 0;

  return {
    async searchCities(query: string, signal: AbortSignal): Promise<City[]> {
      const trimmed = query.trim();
      if (trimmed.length < 2) throw new Error('Enter at least two characters to find a place.');
      const key = trimmed.toLocaleLowerCase();
      const cached = cityCache.get(key);
      if (cached) return cached;
      if (Date.now() - lastSearch < 1200) throw new Error('Please wait a moment between city searches.');
      lastSearch = Date.now();
      const url = new URL(geocoderUrl);
      url.search = new URLSearchParams({
        q: trimmed, format: 'jsonv2', addressdetails: '1', limit: '6', 'accept-language': 'en',
      }).toString();
      const payload = await requestJson(fetcher, url.toString(), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        headers: { Accept: 'application/json' },
      }, 'city search');
      const cities = parseCities(payload);
      if (cityCache.size >= 30) cityCache.delete(cityCache.keys().next().value!);
      cityCache.set(key, cities);
      return cities;
    },

    async loadMap(camera: Camera, signal: AbortSignal): Promise<MapData> {
      project(camera);
      const { query, bounds } = buildOverpassQuery(camera);
      if (Date.now() - lastMapRequest < 5000) throw new Error('Please wait five seconds between map requests.');
      lastMapRequest = Date.now();
      const payload = await requestJson(fetcher, overpassUrl, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        headers: { Accept: 'application/json' },
      }, 'OpenStreetMap geometry service');
      return normalizeMap(payload, bounds);
    },
  };
}
