import './ui/styles.css';
import './game/game.css';
import './advent/advent.css';
import { PCFShadowMap, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { project, unproject } from './data/geo';
import { LANDMARKS } from './data/landmarks';
import { inBuilding, LandmarkIndex, type ResolvedLandmark } from './city/landmarksIndex';
import { CityWorld } from './city/cityWorld';
import { CameraRig } from './interactions/controls';
import { pickBuilding } from './interactions/picking';
import { DayNight } from './rendering/dayNight';
import { Highlight } from './rendering/highlight';
import { PerfStats } from './rendering/perfStats';
import { Weather } from './rendering/weather';
import { UNIT, type BuildingRec } from './data/types';
import { Markers } from './ui/markers';
import { UI } from './ui/ui';
import { FoxGame } from './game/foxGame';
import { ForestScene, FOX_FOREST_POSITION } from './game/forestScene';
import { AdventMapMarkers } from './advent/mapMarkers';
import type { AdventOffer } from './advent/offers';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

// ---------- quality tier ----------
const coarse = matchMedia('(pointer: coarse)').matches;
const cores = navigator.hardwareConcurrency ?? 4;
const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
const low = params.get('quality') === 'low' || (params.get('quality') !== 'high' && (coarse || cores <= 4 || memory <= 4));
const tier = low ? 'low' : 'high';
const shadows = !low;

const dataBase = ((import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? './data').replace(/\/$/, '');

// ---------- renderer / scene ----------
const stage = document.getElementById('stage')!;
const renderer = (() => {
  try {
    return new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (error) {
    document.getElementById('loading')!.textContent = 'Nie udało się uruchomić mapy. Potrzebna jest przeglądarka z obsługą WebGL 2.';
    throw error;
  }
})();
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, low ? 1.5 : 2));
renderer.info.autoReset = false;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Mapa Mławy. Przesuwaj klawiszami WASD, obracaj Q i E, przybliżaj plusem i minusem.');
if (shadows) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
}
stage.append(renderer.domElement);

const scene = new Scene();
const dayNight = new DayNight(scene, shadows);
const highlight = new Highlight();
scene.add(highlight.group);

const landmarks = new LandmarkIndex(LANDMARKS);
let dirty = true;
const invalidate = () => { dirty = true; };

const world = new CityWorld({ dataBase, landmarks, shadows, treeDensity: low ? 0.55 : 1, onChange: invalidate });
scene.add(world.group);

let rig: CameraRig;
let markers: Markers | null = null;
let composer: EffectComposer;
let pixelPass: RenderPixelatedPass | null = null;
let antialiasPass: ShaderPass | null = null;
let pixelSize = 1;
let perf: PerfStats | null = null;
let weather: Weather | null = null;
const renderPixelSize = (size: number) => size === 1 ? 1 : Math.max(2, Math.round(size * renderer.getPixelRatio()));

const ui = new UI({
  onClosePanel: () => clearSelection(),
  onPlace: (id) => selectLandmark(id),
  onAdventOffer: (offer) => selectAdventOffer(offer),
  onAdventPreview: (preview) => {
    if (!preview && selectedAdvent?.example) clearSelection();
    adventMarkers.setPreview(preview);
  },
  onReset: () => { clearSelection(); rig.reset(); },
  onNight: (on) => { dayNight.setNight(on); invalidate(); },
  onZoom: (factor) => rig.zoomBy(factor),
  onRotate: (angle) => rig.rotateBy(angle),
  onSeason: (season) => world.setSeason(season),
  onPixelSize: (size) => {
    pixelSize = size;
    pixelPass?.setPixelSize(renderPixelSize(size));
    if (antialiasPass) antialiasPass.enabled = size === 1;
    invalidate();
  },
  onMarkers: (visible) => {
    markers?.setVisible(visible);
    adventMarkers.setVisible(visible);
  },
  onMotion: (enabled) => world.setMotion(enabled),
  onLiveTime: (enabled) => {
    dayNight.setLiveTime(enabled);
    if (enabled) ui.setNight(dayNight.night);
    invalidate();
  },
  onWeather: (enabled) => {
    if (enabled && !weather) {
      try {
        weather = new Weather(document.getElementById('weather') as HTMLCanvasElement, (message, active) => ui.setWeatherStatus(message, active));
      } catch {
        ui.setWeatherStatus('Efekty pogodowe nie są dostępne w tej przeglądarce. Dane:', false);
        return;
      }
    }
    weather?.setEnabled(enabled);
  },
});
ui.setPlaces(landmarks.list);
const foxGame = new FoxGame();
const forestScene = new ForestScene();
const initialMotion = !low && !matchMedia('(prefers-reduced-motion: reduce)').matches;
world.setMotion(initialMotion);
ui.setMotion(initialMotion);

// ---------- selection ----------
let selectedLandmark: ResolvedLandmark | null = null;
let landmarkHighlighted = false;
let selectedAdvent: AdventOffer | null = null;
let selectedAdventBuilding: BuildingRec | undefined;
const adventMarkers = new AdventMapMarkers(
  document.getElementById('advent-map-layer')!,
  (offer) => adventRec(offer),
  (offer) => selectAdventOffer(offer),
  invalidate,
);
scene.add(adventMarkers.group);

function buildingCentre(rec: BuildingRec): { x: number; z: number } {
  const r = rec.r[0];
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  const n = r.length / 2;
  return { x: (x / n) * UNIT, z: (z / n) * UNIT };
}

/** fly so that (x,z) ends up in the visible part of the screen (above the bottom sheet on phones) */
function focus(x: number, z: number, zoom: number, avoidSidePanel = false) {
  const z2 = Math.max(rig.zoom, zoom);
  const { w, h } = rig.size;
  let tx = x, tz = z;
  if (w < 720) {
    const d = (0.17 * h) / (z2 * Math.sin(rig.elev));
    tx += Math.sin(rig.azim) * d;
    tz += Math.cos(rig.azim) * d;
  } else if (avoidSidePanel) {
    const d = Math.min(175, w * 0.22) / z2;
    tx -= Math.cos(rig.azim) * d;
    tz += Math.sin(rig.azim) * d;
  }
  rig.flyTo(tx, tz, z2, 750);
}

function clearSelection() {
  selectedLandmark = null;
  clearAdventSelection();
  highlight.set(null);
  markers?.setSelected(null);
  ui.hidePanel();
  invalidate();
}

function clearAdventSelection() {
  if (!selectedAdvent) return;
  selectedAdvent = null;
  selectedAdventBuilding = undefined;
  adventMarkers.setSelected(null);
}

function landmarkRec(l: ResolvedLandmark): BuildingRec | undefined {
  if (l.chunkKey === undefined || l.buildingIndex === undefined) return undefined;
  return world.chunks.get(l.chunkKey)?.data.b[l.buildingIndex];
}

function selectLandmark(id: string) {
  const l = landmarks.byId(id);
  if (!l) return;
  clearAdventSelection();
  selectedLandmark = l;
  markers?.setSelected(id);
  const rec = landmarkRec(l);
  landmarkHighlighted = !!rec;
  highlight.set(rec ?? null);
  ui.showLandmark(l, rec);
  const c = rec ? buildingCentre(rec) : { x: l.x, z: l.z };
  focus(c.x, c.z, 2.2);
  invalidate();
}

function selectBuilding(rec: BuildingRec, chunkKey: string, index: number) {
  const adventOffer = adventMarkers.offerForBuilding(rec);
  if (adventOffer) return selectAdventOffer(adventOffer);
  const lm = landmarks.list.find((l) => l.chunkKey === chunkKey && l.buildingIndex === index);
  if (lm) return selectLandmark(lm.lm.id);
  clearAdventSelection();
  selectedLandmark = null;
  markers?.setSelected(null);
  highlight.set(rec);
  ui.showBuilding(rec);
  const c = buildingCentre(rec);
  focus(c.x, c.z, 2.2);
  invalidate();
}

function adventRec(offer: AdventOffer): BuildingRec | undefined {
  const id = offer.business.buildingOsmId;
  if (id !== undefined) {
    for (const chunk of world.chunks.values()) {
      const rec = chunk.data.b.find((building) => building.s !== 'egib' && building.id === id);
      if (rec) return rec;
    }
  }
  const point = project(offer.business.latitude, offer.business.longitude);
  for (const chunk of world.chunks.values()) {
    const rec = chunk.data.b.find((building) => inBuilding(point.x, point.z, building.r[0]));
    if (rec) return rec;
  }
  return undefined;
}

function selectAdventOffer(offer: AdventOffer) {
  selectedLandmark = null;
  selectedAdvent = offer;
  markers?.setSelected(null);
  const point = project(offer.business.latitude, offer.business.longitude);
  const rec = adventRec(offer);
  selectedAdventBuilding = rec;
  highlight.set(rec ?? null);
  adventMarkers.setSelected(offer);
  ui.showAdventOffer(offer);
  focus(point.x, point.z, 2.2, true);
  invalidate();
}

// ---------- main loop ----------
let lastFrame = 0;
let lastStream = -1e9;
let revealed = false;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
  lastFrame = now;

  let need = dirty || debug;
  let shadowDirty = dirty;
  if (rig.update(now)) { need = true; shadowDirty = true; }
  if (dayNight.update(dt)) {
    need = true;
    shadowDirty = true;
    if (dayNight.liveTime) ui.setNight(dayNight.night);
  }
  if (world.pump(8)) {
    need = true;
    shadowDirty = true;
    adventMarkers.resolveBuildings();
    if (selectedLandmark && !landmarkHighlighted) {
      const rec = landmarkRec(selectedLandmark);
      if (rec) {
        landmarkHighlighted = true;
        highlight.set(rec);
        ui.showLandmark(selectedLandmark, rec);
      }
    }
    if (selectedAdvent) {
      const rec = adventRec(selectedAdvent);
      if (rec !== selectedAdventBuilding) {
        selectedAdventBuilding = rec;
        highlight.set(rec ?? null);
      }
    }
  }
  if (world.updateTraffic(now, rig.zoom, rig.visibleRadius())) need = true;
  if (!need) return;
  dirty = false;

  if (now - lastStream > 200) {
    lastStream = now;
    world.requestAround(rig.target.x, rig.target.z, rig.visibleRadius());
  }
  world.applyLod(rig.zoom, dayNight.factor);
  dayNight.follow(rig.target.x, rig.target.z, rig.visibleRadius());
  if (shadows && shadowDirty) renderer.shadowMap.needsUpdate = true;
  renderer.info.reset();
  composer.render(dt);
  markers?.update(rig);
  adventMarkers.update(rig);
  forestScene.update(rig);
  const { lat, lon } = unproject(rig.target.x, rig.target.z);
  ui.setView(lat, lon, rig.zoom);
  perf?.frame(now);

  if (!revealed) {
    const s = world.stats;
    if (s.loaded >= Math.min(4, s.total) && (s.pending === 0 || s.loaded >= 6)) {
      revealed = true;
      ui.hideLoading();
    }
  }
}

// ---------- boot ----------
async function boot() {
  let manifest;
  try {
    manifest = await world.init();
  } catch (e) {
    console.error(e);
    ui.showError('Nie udało się wczytać danych miasta.');
    return;
  }
  ui.setDataStatus(manifest, world.lod1Count, world.lod2Count);

  const w = stage.clientWidth, h = stage.clientHeight;
  rig = new CameraRig(renderer.domElement, manifest.bounds, { x: manifest.center.x, z: manifest.center.z, zoom: Math.min(w, h) / 360 });
  rig.onChange = invalidate;
  rig.onTap = (x, y) => {
    const hit = pickBuilding(world, rig.camera, renderer.domElement, x, y);
    if (hit) selectBuilding(hit.rec, hit.chunk.key, hit.index);
    else clearSelection();
  };
  document.getElementById('fox-find')!.addEventListener('click', () => {
    clearSelection();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 750;
    rig.flyTo(FOX_FOREST_POSITION.x, FOX_FOREST_POSITION.z, 1.25, duration);
  });
  markers = new Markers(document.getElementById('markers')!, landmarks.list, (id) => selectLandmark(id));
  composer = new EffectComposer(renderer);
  pixelPass = new RenderPixelatedPass(renderPixelSize(pixelSize), scene, rig.camera, {
    normalEdgeStrength: 0.12,
    depthEdgeStrength: 0.25,
  });
  composer.addPass(pixelPass);
  antialiasPass = new ShaderPass(FXAAShader);
  composer.addPass(antialiasPass);
  composer.addPass(new OutputPass());

  addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (foxGame.isOpen || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || target?.isContentEditable || target?.closest?.('#advent-calendar, #panel') || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
    switch (event.key.toLowerCase()) {
      case 'w': case 'arrowup': rig.panBy(0, 100); break;
      case 's': case 'arrowdown': rig.panBy(0, -100); break;
      case 'a': case 'arrowleft': rig.panBy(-100, 0); break;
      case 'd': case 'arrowright': rig.panBy(100, 0); break;
      case 'q': if (!event.repeat) rig.rotateBy(-Math.PI / 2); break;
      case 'e': if (!event.repeat) rig.rotateBy(Math.PI / 2); break;
      case '+': case '=': rig.zoomBy(1.25); break;
      case '-': case '_': rig.zoomBy(1 / 1.25); break;
      default: return;
    }
    event.preventDefault();
  });

  const resize = () => {
    const rw = stage.clientWidth, rh = stage.clientHeight;
    renderer.setSize(rw, rh);
    composer.setSize(rw, rh);
    antialiasPass!.uniforms.resolution.value.set(1 / Math.max(1, renderer.domElement.width), 1 / Math.max(1, renderer.domElement.height));
    rig.resize(rw, rh);
    invalidate();
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  if (debug) perf = new PerfStats(document.getElementById('debug')!, renderer, world, rig, tier);
  world.requestAround(rig.target.x, rig.target.z, rig.visibleRadius());
  requestAnimationFrame(frame);

  if (import.meta.env.DEV || debug) (window as unknown as Record<string, unknown>).__mm = { world, rig, dayNight, renderer, composer, pixelPass, antialiasPass, selectLandmark, ui };
}

void boot();
