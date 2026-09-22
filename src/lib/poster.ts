import { A2 } from './print.ts';
import { MAP, POSTER, formatCoordinates, mapPoint, metersPerUnit, project } from './geo.ts';
import type { Camera } from './geo.ts';
import type { FeatureKind, MapData } from './map-data.ts';

export interface Palette {
  id: string;
  name: string;
  description: string;
  paper: string;
  land: string;
  ink: string;
  accent: string;
  water: string;
  park: string;
  minor: string;
  major: string;
  motorway: string;
  path: string;
  rail: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'classic', name: 'The Classic', description: 'Warm paper. Timeless lines.',
    paper: '#f6f1e7', land: '#eee8db', ink: '#303b38', accent: '#b76643',
    water: '#b4c9c9', park: '#d3d8c4', minor: '#fcfaf4', major: '#7d8378',
    motorway: '#5a645e', path: '#c2bbab', rail: '#9c8f7c',
  },
  {
    id: 'noir', name: 'After Hours', description: 'A city dressed in midnight.',
    paper: '#20252a', land: '#282e34', ink: '#f4eddf', accent: '#dbc5a0',
    water: '#151b21', park: '#353f40', minor: '#758087', major: '#d2cabb',
    motorway: '#f4eddf', path: '#424e56', rail: '#ab9583',
  },
  {
    id: 'pop', name: 'Pop Art', description: 'Big color. A little rebellion.',
    paper: '#fff3d3', land: '#fbd76a', ink: '#3d2861', accent: '#df4b79',
    water: '#5abcc3', park: '#c8c76b', minor: '#fff3d3', major: '#df4b79',
    motorway: '#3d2861', path: '#d9a751', rail: '#7e6e8e',
  },
];

export interface Scene {
  origin: Camera;
  paths: { kind: FeatureKind; d: string }[];
  featureCount: number;
}

export interface PosterSettings {
  title: string;
  subtitle: string;
  caption: string;
  palette: Palette;
  camera: Camera;
}

export function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

function number(value: number): string {
  return value.toFixed(2);
}

export function buildScene(data: MapData, camera: Camera): Scene {
  const lines = new Map<FeatureKind, string[]>();
  const paths: Scene['paths'] = [];
  for (const feature of data.features) {
    const area = feature.kind === 'ocean' || feature.kind === 'water' || feature.kind === 'park';
    const d = feature.rings.map((ring) => ring.map((point, index) => {
      const p = mapPoint(point, camera);
      return `${index === 0 ? 'M' : 'L'}${number(p.x)},${number(p.y)}`;
    }).join('') + (area ? 'Z' : '')).join('');
    if (area) paths.push({ kind: feature.kind, d });
    else {
      const group = lines.get(feature.kind) ?? [];
      group.push(d);
      lines.set(feature.kind, group);
    }
  }
  for (const [kind, group] of lines) paths.push({ kind, d: group.join('') });
  return { origin: { ...camera }, paths, featureCount: data.features.length };
}

export function sceneTransform(scene: Scene, camera: Camera): string {
  const scale = metersPerUnit(scene.origin) / metersPerUnit(camera);
  const origin = project(scene.origin);
  const current = project(camera);
  const cx = MAP.x + MAP.width / 2;
  const cy = MAP.y + MAP.height / 2;
  const tx = cx * (1 - scale) + (origin.x - current.x) / metersPerUnit(camera);
  const ty = cy * (1 - scale) - (origin.y - current.y) / metersPerUnit(camera);
  return `translate(${number(tx)} ${number(ty)}) scale(${scale.toFixed(6)})`;
}

const LAYER_ORDER: FeatureKind[] = ['ocean', 'park', 'water', 'path', 'rail', 'minor', 'major', 'motorway'];
const WIDTHS = { path: 0.8, rail: 1.1, minor: 2.3, major: 3.3, motorway: 4.5 };

export function renderPoster(scene: Scene | null, settings: PosterSettings): string {
  const { palette, camera } = settings;
  const title = settings.title.trim().toLocaleUpperCase() || 'YOUR CITY';
  const subtitle = settings.subtitle.trim().toLocaleUpperCase();
  const titleSize = Math.min(78, 1280 / Math.max(title.length, 1));
  const map = scene ? LAYER_ORDER.map((kind) => {
    const area = kind === 'ocean' || kind === 'water' || kind === 'park';
    const attributes = area
      ? `fill="${palette[kind === 'ocean' ? 'water' : kind]}" fill-rule="evenodd"`
      : `fill="none" stroke="${palette[kind]}" stroke-width="${WIDTHS[kind]}" stroke-linecap="round" stroke-linejoin="round"${kind === 'rail' ? ' stroke-dasharray="5 4"' : ''}`;
    return `<g ${attributes}>${scene.paths.filter((path) => path.kind === kind).map((path) => `<path d="${path.d}"/>`).join('')}</g>`;
  }).join('') : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${A2.widthMm}mm" height="${A2.heightMm}mm" viewBox="0 0 ${POSTER.width} ${POSTER.height}" role="img" aria-label="${escapeXml(title)} map poster">
<title>${escapeXml(title)} - Geoposter</title>
<desc>A2 map poster. Map data © OpenStreetMap contributors, licensed under ODbL. https://www.openstreetmap.org/copyright</desc>
<defs><clipPath id="map-frame"><rect x="${MAP.x}" y="${MAP.y}" width="${MAP.width}" height="${MAP.height}"/></clipPath></defs>
<rect width="1000" height="${POSTER.height}" fill="${palette.paper}"/>
<rect x="${MAP.x}" y="${MAP.y}" width="${MAP.width}" height="${MAP.height}" fill="${palette.land}"/>
<g clip-path="url(#map-frame)">${scene ? `<g transform="${sceneTransform(scene, camera)}">${map}</g>` : `<g fill="none" stroke="${palette.ink}" opacity=".13" stroke-width="1.5">
<circle cx="500" cy="540" r="165"/><ellipse cx="500" cy="540" rx="75" ry="165"/><ellipse cx="500" cy="540" rx="165" ry="65"/>
<path d="M335 540H665M500 375V705"/></g>
<text x="500" y="790" text-anchor="middle" fill="${palette.ink}" font-family="Georgia, serif" font-size="31">A place worth keeping.</text>
<text x="500" y="835" text-anchor="middle" fill="${palette.ink}" opacity=".65" font-family="Arial, sans-serif" font-size="17">Find your city to begin</text>`}</g>
<rect x="466" y="1146" width="68" height="4" fill="${palette.accent}"/>
<g text-anchor="middle" fill="${palette.ink}">
<text x="500" y="1240" font-family="Georgia, 'Times New Roman', serif" font-size="${titleSize}" letter-spacing="5">${escapeXml(title)}</text>
<text x="500" y="1282" font-family="Arial, sans-serif" font-size="${Math.min(19, 1100 / Math.max(subtitle.length, 1))}" letter-spacing="4">${escapeXml(subtitle)}</text>
<text x="500" y="1322" font-family="Arial, sans-serif" font-size="14" letter-spacing="2">${scene ? escapeXml(formatCoordinates(camera)) : 'A LITTLE PIECE OF YOUR WORLD'}</text>
<text x="500" y="1351" font-family="Georgia, serif" font-size="16" font-style="italic">${escapeXml(settings.caption)}</text>
<a href="https://www.openstreetmap.org/copyright"><text x="500" y="1390" font-family="Arial, sans-serif" font-size="9" opacity=".8">© OpenStreetMap contributors · openstreetmap.org/copyright</text></a>
</g></svg>`;
}
