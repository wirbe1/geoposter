import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOverpassQuery, createMapServices, parseCities } from './services.ts';

const searchResult = [{
  place_id: 1, name: 'Berlin', display_name: 'Berlin, Germany',
  lat: '52.52', lon: '13.405', address: { country: 'Germany' },
}];

test('parses city metadata and rejects malformed or polar results', () => {
  assert.equal(parseCities(searchResult)[0].country, 'Germany');
  assert.deepEqual(parseCities([{ ...searchResult[0], lat: '91' }, { lat: null }]), []);
  assert.throws(() => parseCities({}), /invalid response/);
});

test('Overpass query requests actual geometry and bounded multipolygon data', () => {
  const { query, bounds } = buildOverpassQuery({ lat: 52.52, lon: 13.405, spanKm: 6 });
  assert.match(query, /out geom/);
  assert.match(query, /nwr\["natural"/);
  assert.match(query, /way\["natural"="coastline"\]/);
  assert.match(query, /\[maxsize:268435456\]/, 'city queries need a realistic Overpass memory budget');
  assert.ok(bounds.east > bounds.west);
  assert.throws(() => buildOverpassQuery({ lat: 0, lon: 180, spanKm: 16 }), /date line/);
});

test('search only calls the provider once for a repeated query and limits rapid new queries', async () => {
  let calls = 0;
  const service = createMapServices({ fetcher: async (url) => {
    calls++;
    assert.match(String(url), /q=Berlin/);
    return Response.json(searchResult);
  } });
  const signal = new AbortController().signal;
  assert.equal((await service.searchCities('Berlin', signal))[0].name, 'Berlin');
  assert.equal((await service.searchCities(' berlin ', signal)).length, 1);
  assert.equal(calls, 1);
  await assert.rejects(service.searchCities('Paris', signal), /wait a moment/);
});

test('map loading sends the bounded query and normalizes a successful geometry response', async () => {
  const camera = { lat: 52.52, lon: 13.405, spanKm: 6 };
  const { query, bounds } = buildOverpassQuery(camera);
  let calls = 0;
  const service = createMapServices({ fetcher: async (url, init) => {
    calls++;
    assert.equal(url, 'https://overpass-api.de/api/interpreter');
    assert.equal(init?.method, 'POST');
    assert.ok(init.body instanceof URLSearchParams);
    assert.equal(init.body.get('data'), query);
    return Response.json({ elements: [{
      type: 'way', id: 1, tags: { highway: 'residential' },
      geometry: [{ lat: 52.52, lon: 13.405 }, { lat: 52.521, lon: 13.406 }],
    }] });
  } });
  const signal = new AbortController().signal;
  const data = await service.loadMap(camera, signal);
  assert.deepEqual(data.bounds, bounds);
  assert.equal(data.features.length, 1);
  assert.equal(data.features[0].kind, 'minor');
  await assert.rejects(service.loadMap(camera, signal), /five seconds/);
  assert.equal(calls, 1);
});

test('HTTP 200 with an Overpass runtime error is rejected, including partial results', async () => {
  const service = createMapServices({ fetcher: async () => Response.json({
    elements: [{
      type: 'way', id: 1, tags: { highway: 'residential' },
      geometry: [{ lat: 52.52, lon: 13.405 }, { lat: 52.521, lon: 13.406 }],
    }],
    remark: 'runtime error: Query ran out of memory in "query" at line 2.',
  }) });
  await assert.rejects(
    service.loadMap({ lat: 52.52, lon: 13.405, spanKm: 6 }, new AbortController().signal),
    /could not finish/,
  );
});

test('provider failures are actionable and never returned as successful empty maps', async () => {
  const signal = new AbortController().signal;
  const unavailable = createMapServices({ fetcher: async () => new Response('', { status: 429 }) });
  await assert.rejects(unavailable.searchCities('Paris', signal), /Wait a minute/);
  const broken = createMapServices({ fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(broken.loadMap({ lat: 0, lon: 0, spanKm: 2 }, signal), /Check your connection/);
  const malformed = createMapServices({ fetcher: async () => new Response('<html>broken') });
  await assert.rejects(malformed.searchCities('Paris', signal), /unreadable data/);
});
