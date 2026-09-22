import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent } from 'react';
import {
  MAP, MAX_SPAN_KM, MIN_SPAN_KM, POSTER, cameraBounds, containsBounds,
  formatCoordinates, panCamera, zoomCamera,
} from './lib/geo.ts';
import type { Camera } from './lib/geo.ts';
import type { MapData } from './lib/map-data.ts';
import { PALETTES, buildScene, renderPoster } from './lib/poster.ts';
import type { Scene } from './lib/poster.ts';
import { createMapServices } from './lib/services.ts';
import type { City } from './lib/services.ts';
import { downloadBlob, pngBlob, posterFilename, svgBlob } from './lib/export.ts';

const INITIAL_CAMERA: Camera = { lat: 52.52, lon: 13.405, spanKm: 6 };
const services = createMapServices({
  geocoderUrl: import.meta.env.VITE_GEOCODER_URL,
  overpassUrl: import.meta.env.VITE_OVERPASS_URL,
});

function Icon({ name, size = 20 }: { name: 'search' | 'arrow' | 'pin' | 'download' | 'reset' | 'close'; size?: number }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
}

export function App() {
  const [query, setQuery] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [city, setCity] = useState<City | null>(null);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const [loaded, setLoaded] = useState<{ data: MapData; scene: Scene } | null>(null);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState('');
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [caption, setCaption] = useState('');
  const [paletteId, setPaletteId] = useState('classic');
  const [exportFormat, setExportFormat] = useState<'svg' | 'png'>('svg');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);
  const mapRequest = useRef<AbortController | null>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera; scale: number; pointerId: number } | null>(null);

  useEffect(() => () => {
    searchRequest.current?.abort();
    mapRequest.current?.abort();
  }, []);

  const palette = PALETTES.find((item) => item.id === paletteId)!;
  const covered = loaded ? containsBounds(loaded.data.bounds, cameraBounds(camera)) : false;
  const canEditMap = loaded !== null && !mapBusy;
  const canAdjustView = city !== null && !mapBusy;
  const canExport = loaded !== null && covered && !mapBusy && !exportBusy;
  const svg = useMemo(() => renderPoster(loaded?.scene ?? null, {
    title, subtitle, caption, palette, camera,
  }), [loaded, title, subtitle, caption, palette, camera]);

  async function search(event: FormEvent) {
    event.preventDefault();
    searchRequest.current?.abort();
    const request = new AbortController();
    searchRequest.current = request;
    setSearchBusy(true);
    setSearchError('');
    setCities([]);
    setSearched(false);
    try {
      const results = await services.searchCities(query, request.signal);
      if (request.signal.aborted) return;
      setCities(results);
      setSearched(true);
    } catch (error) {
      if (!request.signal.aborted) setSearchError(errorMessage(error));
    } finally {
      if (searchRequest.current === request) setSearchBusy(false);
    }
  }

  async function loadMap(nextCamera: Camera) {
    mapRequest.current?.abort();
    const request = new AbortController();
    mapRequest.current = request;
    setMapBusy(true);
    setMapError('');
    setNotice('');
    setExportNotice('');
    setExportError('');
    try {
      const data = await services.loadMap(nextCamera, request.signal);
      if (request.signal.aborted) return;
      setLoaded({ data, scene: buildScene(data, nextCamera) });
      setNotice('Your map is ready. Make it your own.');
    } catch (error) {
      if (!request.signal.aborted) setMapError(errorMessage(error));
    } finally {
      if (mapRequest.current === request) setMapBusy(false);
    }
  }

  function selectCity(selected: City) {
    const nextCamera = { lat: selected.lat, lon: selected.lon, spanKm: 6 };
    setCity(selected);
    setCamera(nextCamera);
    setTitle(selected.name.slice(0, 40));
    setSubtitle(selected.country.slice(0, 60));
    setCities([]);
    setSearched(false);
    setQuery(selected.name);
    setLoaded(null);
    void loadMap(nextCamera);
  }

  function cancelMap() {
    mapRequest.current?.abort();
    setMapBusy(false);
    setNotice('Map loading cancelled. You can retry when ready.');
  }

  function moveCamera(nextCamera: Camera) {
    setCamera(nextCamera);
    setExportNotice('');
    setExportError('');
  }

  function recenter() {
    if (city) moveCamera({ lat: city.lat, lon: city.lon, spanKm: 6 });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!canEditMap || event.button !== 0 || drag.current || (event.target instanceof Element && event.target.closest('a'))) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = POSTER.width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    if (x < MAP.x || x > MAP.x + MAP.width || y < MAP.y || y > MAP.y + MAP.height) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, camera, scale, pointerId: event.pointerId };
    setDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    moveCamera(panCamera(start.camera, (event.clientX - start.x) * start.scale, (event.clientY - start.y) * start.scale));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyboardPan(event: KeyboardEvent<HTMLDivElement>) {
    if (!canEditMap || event.target !== event.currentTarget) return;
    const delta = event.shiftKey ? 120 : 35;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [delta, 0], ArrowRight: [-delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta],
    };
    if (moves[event.key]) {
      event.preventDefault();
      moveCamera(panCamera(camera, ...moves[event.key]));
    } else if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      moveCamera(zoomCamera(camera, event.key === '-' ? 1.2 : 1 / 1.2));
    } else if (event.key === 'Home') {
      event.preventDefault();
      recenter();
    }
  }

  async function exportPoster() {
    if (!canExport) return;
    setExportBusy(true);
    setExportError('');
    setExportNotice('');
    try {
      const blob = exportFormat === 'svg' ? svgBlob(svg) : await pngBlob(svg);
      downloadBlob(blob, posterFilename(title, exportFormat));
      setExportNotice(`Your A2 ${exportFormat.toUpperCase()} download is ready.`);
    } catch (error) {
      setExportError(errorMessage(error));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="wordmark" href="./" aria-label="Geoposter home">
          <span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span>
          geo<span className="wordmark-light">poster</span><span className="brand-dot">.</span>
        </a>
        <span className="header-note">EVERY PLACE HAS A STORY</span>
        <a className="header-link" href="#print-details">Made for your walls <span aria-hidden="true">↗</span></a>
      </header>

      <main>
        <div className="intro">
          <div><p className="eyebrow"><span /> YOUR WORLD, BEAUTIFULLY FRAMED</p><h1>A place worth <em>keeping.</em></h1></div>
          <p>Your hometown. Your next adventure.<br />Turn somewhere special into a work of art.</p>
        </div>

        <div className="studio">
          <aside className="editor" aria-label="Poster customization">
            <section className="editor-section">
              <div className="section-title"><span className="step-number">01</span><h2>Find your place</h2></div>
              <form onSubmit={(event) => void search(event)}>
                <label className="field-label" htmlFor="city-search">City or place</label>
                <div className="search-field">
                  <Icon name="search" size={18} />
                  <input id="city-search" name="city" value={query} onChange={(event) => setQuery(event.target.value)}
                    placeholder="Where does your story begin?" autoComplete="off" maxLength={150} required minLength={2}
                    aria-describedby="search-help" />
                  <button className="search-button" type="submit" disabled={searchBusy} aria-label="Search cities">
                    {searchBusy ? <span className="spinner" /> : <Icon name="arrow" size={18} />}
                  </button>
                </div>
                <p id="search-help" className="field-hint">Search a city, neighborhood, or special address.</p>
              </form>
              <div aria-live="polite">
                {searchBusy && <p className="field-hint">Finding your place…</p>}
                {searched && cities.length === 0 && <p className="message">No places found. Try adding a country to your search.</p>}
              </div>
              {searchError && <p role="alert" className="message error">{searchError}</p>}
              {cities.length > 0 && <ul className="search-results" aria-label="City search results">
                {cities.map((result) => <li key={result.id}><button type="button" onClick={() => selectCity(result)}>
                  <Icon name="pin" size={17} /><span><strong>{result.name}</strong><small>{result.label}</small></span>
                  <Icon name="arrow" size={16} />
                </button></li>)}
              </ul>}
              {city && <div className="selected-place"><Icon name="pin" size={15} /><span>{city.name}{city.country ? `, ${city.country}` : ''}</span></div>}
            </section>

            <section className="editor-section">
              <div className="section-title"><span className="step-number">02</span><h2>Set the mood</h2><span className="section-aside">3 STYLES</span></div>
              <fieldset className="palette-list"><legend className="sr-only">Map style</legend>
                {PALETTES.map((item) => <label key={item.id} className={`palette-option ${paletteId === item.id ? 'selected' : ''}`}>
                  <input type="radio" name="palette" value={item.id} checked={paletteId === item.id} onChange={() => setPaletteId(item.id)} />
                  <span className="palette-swatch" style={{ '--land': item.land, '--water': item.water, '--road': item.major } as CSSProperties}>
                    <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="var(--land)" /><path d="M40-5C10 18 57 28 32 69H65V-5Z" fill="var(--water)" /><g stroke="var(--road)" strokeWidth="2.5" fill="none"><path d="m-5 14 76 32M-5 38 69 0M9-4l17 72M-3 57l74-23M43-5 11 70" /></g></svg>
                  </span>
                  <span className="palette-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
                  <span className="radio-mark" aria-hidden="true" />
                </label>)}
              </fieldset>
            </section>

            <section className="editor-section">
              <div className="section-title"><span className="step-number">03</span><h2>Make it yours</h2></div>
              <label className="field-label" htmlFor="poster-title">Poster title</label>
              <input id="poster-title" className="text-input" value={title} maxLength={40} placeholder="YOUR CITY" onChange={(event) => setTitle(event.target.value)} />
              <div className="two-fields">
                <div><label className="field-label" htmlFor="poster-subtitle">Subtitle</label>
                  <input id="poster-subtitle" className="text-input" value={subtitle} maxLength={60} placeholder="Country or region" onChange={(event) => setSubtitle(event.target.value)} /></div>
                <div><label className="field-label" htmlFor="poster-caption">A little note <span>optional</span></label>
                  <input id="poster-caption" className="text-input" value={caption} maxLength={65} placeholder="Where we first met" onChange={(event) => setCaption(event.target.value)} /></div>
              </div>
              <div className="scale-label"><label className="field-label" htmlFor="map-scale">Map area</label><output htmlFor="map-scale">{camera.spanKm.toFixed(1)} km across</output></div>
              <input id="map-scale" className="scale-slider" type="range" min={MIN_SPAN_KM} max={MAX_SPAN_KM} step="0.1" value={camera.spanKm}
                disabled={!canAdjustView} onChange={(event) => moveCamera({ ...camera, spanKm: Number(event.target.value) })} />
              <div className="range-labels"><span>Street-level</span><span>The bigger picture</span></div>
              {loaded && !covered && <p className="message warning">You moved beyond the loaded map. Update this area before exporting.</p>}
              {city && <button className="text-button refresh-button" disabled={mapBusy} onClick={() => void loadMap(camera)}>
                <Icon name="reset" size={14} />{loaded ? 'Update map area' : 'Load map'}
              </button>}
            </section>

            <section className="export-section" id="print-details" aria-labelledby="export-heading">
              <div className="export-heading"><h2 id="export-heading">From a place to a print.</h2><span className="paper-badge">A2</span></div>
              <p>420 × 594 mm · Portrait · Print-ready</p>
              <label className="field-label" htmlFor="export-format">Download format</label>
              <select id="export-format" className="text-input" value={exportFormat} disabled={exportBusy}
                onChange={(event) => setExportFormat(event.target.value === 'png' ? 'png' : 'svg')}>
                <option value="svg">SVG — lossless vector (recommended)</option>
                <option value="png">PNG — 300 DPI / 4961 × 7016 px</option>
              </select>
              <button className="export-button" disabled={!canExport} onClick={() => void exportPoster()}>
                {exportBusy ? <span className="spinner" /> : <Icon name="download" size={18} />}
                {exportBusy ? 'Preparing your print…' : 'Download your poster'}{!exportBusy && <span aria-hidden="true">↗</span>}
              </button>
              <p className="export-footnote">{!loaded ? 'Choose a place to create your first poster.' : 'Print at actual size / 100%. No bleed included.'}</p>
              {exportError && <p className="message error" role="alert">{exportError}</p>}
              <p className="export-notice" role="status">{exportNotice}</p>
            </section>
          </aside>

          <section className="preview-area" aria-label="Poster preview">
            <div className="preview-topline"><span><span className="live-dot" /> LIVE PREVIEW</span><span>A2 / PORTRAIT</span></div>
            <div className="preview-stage">
              <span className="dimension dimension-top">420 mm</span>
              <span className="dimension dimension-side">594 mm</span>
              <div className={`poster ${dragging ? 'dragging' : ''} ${canEditMap ? 'interactive' : ''}`}
                role="group" aria-label="Interactive map poster" aria-describedby="preview-help" aria-busy={mapBusy}
                tabIndex={0} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
                onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
                onKeyDown={keyboardPan} dangerouslySetInnerHTML={{ __html: svg }} />
              {mapBusy && <div className="loading-overlay" role="status">
                <span className="spinner" /><strong>Drawing your corner of the world…</strong>
                <p>Fetching streets, parks, and waterways.<br />Detailed maps can take up to a minute.</p>
                <button className="text-button" onClick={cancelMap}><Icon name="close" size={14} /> Cancel</button>
              </div>}
            </div>
            <div className="preview-toolbar">
              <p id="preview-help">{loaded ? 'Drag to move · Arrow keys to fine-tune' : 'Find a place. Make it your own.'}</p>
              <div className="map-controls">
                <button aria-label="Zoom out" title="Zoom out" disabled={!canAdjustView || camera.spanKm >= MAX_SPAN_KM}
                  onClick={() => moveCamera(zoomCamera(camera, 1.2))}>−</button>
                <button aria-label="Recenter map" title="Recenter map" disabled={!canAdjustView} onClick={recenter}><Icon name="reset" size={16} /></button>
                <button aria-label="Zoom in" title="Zoom in" disabled={!canAdjustView || camera.spanKm <= MIN_SPAN_KM}
                  onClick={() => moveCamera(zoomCamera(camera, 1 / 1.2))}>+</button>
              </div>
            </div>
            {mapError && <div className="preview-message message error" role="alert">
              <span>{mapError}</span><button className="text-button" disabled={mapBusy} onClick={() => void loadMap(camera)}>Retry map</button>
            </div>}
            <p className="map-status" role="status">{!mapBusy && notice}</p>
            <div className="preview-bottomline"><span>{loaded ? formatCoordinates(camera) : 'DESIGNED BY YOU. ROOTED IN A PLACE.'}</span><span>GEOGRAPHY MEETS ART</span></div>
          </section>
        </div>
      </main>

      <footer className="site-footer">
        <span>A little piece of your world.</span>
        <p>Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
        <details className="service-details"><summary>About maps & printing</summary><div>
          <p>City searches are sent to Nominatim; map areas are sent to Overpass. Text and poster exports stay in your browser.</p>
          <p>Public map services have usage limits. Search on demand and wait between requests. Coastal water is filled from OSM coastlines; map labels are not included in this edition.</p>
          <p>SVG is resolution-independent; PNG is 4961 × 7016 pixels at 300 DPI. Exports use sRGB color, with no bleed. Your print shop can convert SVG to PDF and advise on color profiles.</p>
        </div></details>
      </footer>
    </div>
  );
}
