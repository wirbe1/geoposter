import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, posterFilename, svgBlob, withPrintDpi } from './export.ts';

const pixelPng = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64',
));

test('PNG export records 300 DPI with a valid checksum and preserves image data', () => {
  const png = withPrintDpi(pixelPng);
  const offset = 33;
  const view = new DataView(png.buffer);
  assert.equal(view.getUint32(offset), 9);
  assert.equal(String.fromCharCode(...png.subarray(offset + 4, offset + 8)), 'pHYs');
  assert.equal(view.getUint32(offset + 8), 11811);
  assert.equal(view.getUint32(offset + 12), 11811);
  assert.equal(png[offset + 16], 1);
  assert.equal(view.getUint32(offset + 17), crc32(png.subarray(offset + 4, offset + 17)));
  assert.deepEqual(png.subarray(offset + 21), pixelPng.subarray(offset));
  assert.deepEqual(withPrintDpi(png), png, 'replace existing DPI metadata without duplicate chunks');
});

test('invalid or truncated PNG exports fail explicitly', () => {
  assert.throws(() => withPrintDpi(new Uint8Array([1, 2, 3])), /valid PNG/);
  assert.throws(() => withPrintDpi(pixelPng.subarray(0, 20)), /truncated/);
});

test('download filenames are safe and SVG exports declare UTF-8', async () => {
  assert.equal(posterFilename('São Paulo / center', 'svg'), 'sao-paulo-center-a2.svg');
  assert.equal(posterFilename('../../', 'png'), 'geoposter-a2.png');
  assert.match(await svgBlob('<svg/>').text(), /encoding="UTF-8"/);
});
