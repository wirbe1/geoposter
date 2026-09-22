import { A2 } from './print.ts';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Canvas defaults to 96 DPI. pHYs records the intended physical print density.
export function withPrintDpi(png: Uint8Array, dpi = A2.dpi): Uint8Array<ArrayBuffer> {
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) throw new Error('The browser did not produce a valid PNG.');
  const chunks: Uint8Array[] = [PNG_SIGNATURE];
  const source = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const physical = new Uint8Array(21);
  const view = new DataView(physical.buffer);
  view.setUint32(0, 9);
  physical.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.round(dpi / 0.0254));
  view.setUint32(12, Math.round(dpi / 0.0254));
  physical[16] = 1;
  view.setUint32(17, crc32(physical.subarray(4, 17)));
  let hasHeader = false;
  let hasEnd = false;
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('The PNG export was truncated.');
    const length = source.getUint32(offset);
    const end = offset + length + 12;
    if (end > png.length) throw new Error('The PNG export was truncated.');
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type !== 'pHYs') chunks.push(png.subarray(offset, end));
    if (type === 'IHDR') {
      hasHeader = true;
      chunks.push(physical);
    }
    if (type === 'IEND') hasEnd = true;
    offset = end;
  }
  if (!hasHeader || !hasEnd) throw new Error('The PNG export is missing required data.');
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let position = 0;
  for (const chunk of chunks) {
    output.set(chunk, position);
    position += chunk.length;
  }
  return output;
}

export function posterFilename(title: string, extension: 'svg' | 'png'): string {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 70);
  return `${slug || 'geoposter'}-a2.${extension}`;
}

export function svgBlob(svg: string): Blob {
  return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', svg], { type: 'image/svg+xml;charset=utf-8' });
}

export async function pngBlob(svg: string): Promise<Blob> {
  const rasterSvg = svg.replace('width="420mm" height="594mm"', `width="${A2.widthPx}" height="${A2.heightPx}"`);
  const url = URL.createObjectURL(svgBlob(rasterSvg));
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Unable to render this poster. Try the SVG export instead.'));
      image.src = url;
    });
    canvas.width = A2.widthPx;
    canvas.height = A2.heightPx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create a print canvas. Use SVG export instead.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('Not enough memory for PNG export. Use the lossless SVG option instead.')),
      'image/png',
    ));
    return new Blob([withPrintDpi(new Uint8Array(await blob.arrayBuffer()))], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
