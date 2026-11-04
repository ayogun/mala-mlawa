// Turns cached raw OSM into small, chunked, browser-friendly JSON in public/data/.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import osmtogeojson from 'osmtogeojson';
import polygonClipping from 'polygon-clipping';
import { ORIGIN, project } from '../src/data/geo';
import type {
  AreaKind, AreaRec, BuildingRec, ChunkData, ChunkInfo, Manifest, RoadClass, RoadRec,
} from '../src/data/types';
import { UNIT } from '../src/data/types';
import { centroid, pointInRing, signedArea, simplifyLine, simplifyRing, type Pt } from './lib/geometry';
import { buildingKind, resolveHeight } from './lib/heights';
import { asPolygon, boundsOf, overlaps, polygonArea, SpatialGrid, type Bounds, type Polygon } from './lib/spatial';

const CACHE = resolve(import.meta.dirname, '.cache');
const OUT = resolve(import.meta.dirname, '../public/data');
const CHUNK = 500; // metres
const DATA_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Feature = { id?: string; geometry: any; properties: Record<string, any> };

function load(name: string): Feature[] {
  const file = resolve(CACHE, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing ${file} — run "npm run data:fetch" first`);
  const gj = osmtogeojson(JSON.parse(readFileSync(file, "utf8")), { flatProperties: true });
  return gj.features as unknown as Feature[];
}

/** OSM id; relations are stored negated so ways/relations can't collide. */
const osmId = (f: Feature) => {
  const [type, id] = String(f.id ?? f.properties.id ?? '/0').split('/');
  return (type === 'relation' ? -1 : 1) * (parseInt(id, 10) || 0);
};
const toM = (ring: number[][]): Pt[] => ring.slice(0, ring.length - 1).map(([lon, lat]) => { const p = project(lat, lon); return [p.x, p.z]; });
const q = (v: number) => Math.round(v / UNIT);
const flat = (ring: Pt[]): number[] => ring.flatMap(([x, z]) => [q(x), q(z)]);
const chunkOf = (x: number, z: number): [number, number] => [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
const key = (cx: number, cz: number) => `${cx}_${cz}`;

function polygonsOf(g: Feature['geometry']): number[][][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/** project polygon rings, orient (outer>0, holes<0), simplify */
function prepRings(poly: number[][][], tol: number, minArea: number): Pt[][] | null {
  const rings: Pt[][] = [];
  for (let i = 0; i < poly.length; i++) {
    let r = toM(poly[i]);
    if (r.length < 3) continue;
    r = simplifyRing(r, tol);
    if (r.length < 3) continue;
    const a = signedArea(r);
    if (Math.abs(a) < (i === 0 ? minArea : 1)) {
      if (i === 0) return null;
      continue;
    }
    if ((i === 0) !== a > 0) r.reverse();
    rings.push(r);
  }
  return rings.length ? rings : null;
}

const chunks = new Map<string, ChunkData>();
const getChunk = (cx: number, cz: number): ChunkData => {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) chunks.set(k, (c = { b: [], r: [], a: [], t: [] }));
  return c;
};

// ---------- boundary ----------
const boundaryFeat = load('boundary').find((f) => polygonsOf(f.geometry).length);
if (!boundaryFeat) throw new Error('boundary relation did not yield a polygon');
const bPolys = polygonsOf(boundaryFeat.geometry);
const mainPoly = bPolys.reduce((a, b) => (b[0].length > a[0].length ? b : a));
const boundaryM: Pt[] = simplifyRing(toM(mainPoly[0]), 3);
const inTown = (x: number, z: number) => pointInRing(x, z, boundaryM);
const boundaryClip: [number, number][][][] = [[boundaryM.map(([x, z]) => [x, z] as [number, number]).concat([[boundaryM[0][0], boundaryM[0][1]]])]];
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
for (const [x, z] of boundaryM) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
console.log(`town boundary: ${boundaryM.length} pts, ${((maxX - minX) / 1000).toFixed(1)} × ${((maxZ - minZ) / 1000).toFixed(1)} km`);

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
type IndexedFootprint = { polygon: Polygon; area: number; bounds: Bounds };
const buildingGrid = new SpatialGrid<IndexedFootprint>(100);

function indexFootprint(rings: Pt[][]): void {
  const polygon = asPolygon(rings);
  const bounds = boundsOf(rings[0]);
  buildingGrid.add(bounds, { polygon, bounds, area: polygonArea(polygon) });
}

function registryId(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return -4294967296 - (hash >>> 0);
}

// ---------- buildings ----------
for (const f of load('buildings')) {
  const tags = f.properties as Record<string, string>;
  if (!tags.building || tags.building === 'no') continue;
  const kind = buildingKind(tags);
  const id = osmId(f);
  for (const poly of polygonsOf(f.geometry)) {
    const rings = prepRings(poly, 0.35, 8);
    if (!rings) { bump('buildings dropped (tiny/invalid)'); continue; }
    const [cx, cz] = centroid(rings[0]);
    if (!inTown(cx, cz)) { bump('buildings outside town'); continue; }
    const { h, hs, lv } = resolveHeight(tags, kind, id);
    const rec: BuildingRec = { id, r: rings.map(flat), h, hs, k: kind };
    if (lv) rec.lv = lv;
    if (tags.name) rec.n = tags.name;
    const street = tags['addr:street'] ?? tags['addr:place'];
    if (street || tags['addr:housenumber']) rec.a = [street, tags['addr:housenumber']].filter(Boolean).join(' ');
    const fn = tags.amenity ?? tags.shop ?? tags.office ?? tags.tourism ?? tags.leisure;
    if (fn) rec.t = fn;
    const [ci, cj] = chunkOf(cx, cz);
    getChunk(ci, cj).b.push(rec);
    indexFootprint(rings);
    bump('buildings');
    bump(`height source ${hs}`);
  }
}

const egibFile = resolve(CACHE, 'egib-buildings.json');
let egibFetched: string | undefined;
if (existsSync(egibFile)) {
  const egib = JSON.parse(readFileSync(egibFile, 'utf8')) as { fetched?: string; features: Feature[] };
  if (!Array.isArray(egib.features)) throw new Error('Invalid EGiB cache');
  egibFetched = egib.fetched;
  for (const feature of egib.features) {
    const sourceId = feature.properties.ID_BUDYNKU;
    if (typeof sourceId !== 'string' || !feature.geometry) continue;
    for (const poly of polygonsOf(feature.geometry)) {
      const rings = prepRings(poly, 0.35, 8);
      if (!rings) continue;
      const [cx, cz] = centroid(rings[0]);
      if (!inTown(cx, cz)) continue;
      const polygon = asPolygon(rings);
      const area = polygonArea(polygon);
      const bounds = boundsOf(rings[0]);
      let alreadyMapped = false;
      for (const candidate of buildingGrid.query(bounds)) {
        if (!overlaps(bounds, candidate.bounds)) continue;
        try {
          const intersection = polygonClipping.intersection(polygon, candidate.polygon)
            .reduce((sum, result) => sum + polygonArea(result as Polygon), 0);
          if (intersection > Math.max(0.5, Math.min(area, candidate.area) * 0.02)) { alreadyMapped = true; break; }
        } catch {
          alreadyMapped = true;
          break;
        }
      }
      if (alreadyMapped) { bump('EGiB buildings already mapped'); continue; }
      const id = registryId(sourceId);
      const kind = feature.properties.RODZAJ === 'm' ? 'u' : 'o';
      const { h, hs } = resolveHeight({}, kind, id);
      const rec: BuildingRec = { id, r: rings.map(flat), h, hs, k: kind, s: 'egib', ei: sourceId };
      const [ci, cj] = chunkOf(cx, cz);
      getChunk(ci, cj).b.push(rec);
      indexFootprint(rings);
      bump('buildings');
      bump('EGiB buildings added');
      bump(`height source ${hs}`);
    }
  }
} else {
  console.warn('EGiB buildings are not cached; run "npm run data:fetch:egib" for additional footprints.');
}

// ---------- roads ----------
const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 'p', motorway_link: 'p', trunk: 'p', trunk_link: 'p', primary: 'p', primary_link: 'p',
  secondary: 's', secondary_link: 's', tertiary: 's', tertiary_link: 's',
  residential: 'r', unclassified: 'r', living_street: 'r', road: 'r',
  service: 'v', track: 'v',
  pedestrian: 'f', footway: 'f', path: 'f', cycleway: 'f', steps: 'f', bridleway: 'f', corridor: 'f',
};

function addLine(cls: RoadClass, pts: Pt[], name?: string) {
  let run: Pt[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length >= 2) {
      const [cx, cz] = runKey.split('_').map(Number);
      const rec: RoadRec = { c: cls, p: flat(run) };
      if (name) rec.n = name;
      getChunk(cx, cz).r.push(rec);
      bump('road pieces');
    }
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!inTown(mx, mz)) { flush(); run = []; runKey = ''; continue; }
    const k = key(...chunkOf(mx, mz));
    if (k !== runKey) {
      flush();
      run = run.length && runKey ? [run[run.length - 1]] : [a];
      if (!runKey) run = [a];
      runKey = k;
    }
    run.push(b);
  }
  flush();
}

for (const f of load('roads')) {
  const t = f.properties as Record<string, string>;
  if (f.geometry.type !== 'LineString') continue;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
  const cls: RoadClass | undefined = t.railway === 'rail' ? 'x' : ROAD_CLASS[t.highway];
  if (!cls) continue;
  const pts = simplifyLine(f.geometry.coordinates.map(([lon, lat]: number[]) => { const p = project(lat, lon); return [p.x, p.z] as Pt; }), 0.8);
  addLine(cls, pts, cls === 'p' || cls === 's' ? t.name : undefined);
  bump('roads ' + cls);
}

// ---------- areas & waterways ----------
function areaKind(t: Record<string, string>): AreaKind | null {
  if (t.natural === 'water' || t.water) return 'w';
  if (t.landuse === 'cemetery') return 'c';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'f';
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'sports_centre' || t.leisure === 'track' || t.leisure === 'swimming_pool') return 'p';
  if (t.amenity === 'parking') return 'k';
  if (t.place === 'square' || t.highway === 'pedestrian') return 'q';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.landuse === 'grass' || t.landuse === 'village_green' || t.landuse === 'recreation_ground') return 'g';
  if (t.landuse === 'meadow' || t.natural === 'scrub' || t.natural === 'grassland' || t.natural === 'wetland') return 's';
  if (t.landuse === 'farmland' || t.landuse === 'allotments' || t.landuse === 'orchard') return 'm';
  if (t.landuse === 'residential' || t.landuse === 'industrial' || t.landuse === 'commercial' || t.landuse === 'retail') return 'u';
  return null;
}

for (const f of load('areas')) {
  const t = f.properties as Record<string, string>;
  if (f.geometry.type === 'LineString' && t.waterway) {
    const pts = simplifyLine(f.geometry.coordinates.map(([lon, lat]: number[]) => { const p = project(lat, lon); return [p.x, p.z] as Pt; }), 1);
    addLine(t.waterway === 'river' || t.waterway === 'canal' ? 'w' : 'd' as RoadClass, pts);
    bump('waterways');
    continue;
  }
  const kind = areaKind(t);
  if (!kind) continue;
  const id = osmId(f);
  for (const poly of polygonsOf(f.geometry)) {
    const rings = prepRings(poly, 1.0, kind === 'w' ? 20 : 60);
    if (!rings) continue;
    // clip to town boundary
    const subject: [number, number][][][] = [rings.map((r) => r.map(([x, z]) => [x, z] as [number, number]).concat([[r[0][0], r[0][1]]]))];
    let clipped: [number, number][][][];
    try { clipped = polygonClipping.intersection(subject, boundaryClip) as [number, number][][][]; } catch { continue; }
    for (const cp of clipped) {
      const out: Pt[][] = cp.map((r) => r.slice(0, -1).map(([x, z]) => [x, z] as Pt));
      const outer = out[0];
      if (!outer || outer.length < 3 || Math.abs(signedArea(outer)) < 30) continue;
      if (signedArea(outer) < 0) outer.reverse();
      const holes = out.slice(1).filter((h) => h.length >= 3).map((h) => (signedArea(h) > 0 ? h.reverse() : h));
      const [cx, cz] = chunkOf(...centroid(outer));
      const rec: AreaRec = { k: kind, id, r: [outer, ...holes].map(flat) };
      getChunk(cx, cz).a.push(rec);
      bump('areas ' + kind);
    }
  }
}

// ---------- mapped trees ----------
for (const f of load('trees')) {
  const g = f.geometry;
  const add = (lon: number, lat: number) => {
    const p = project(lat, lon);
    if (!inTown(p.x, p.z)) return;
    const [cx, cz] = chunkOf(p.x, p.z);
    getChunk(cx, cz).t.push(q(p.x), q(p.z));
    bump('trees (OSM)');
  };
  if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
  else if (g.type === 'LineString') {
    const pts: Pt[] = g.coordinates.map(([lon, lat]: number[]) => { const p = project(lat, lon); return [p.x, p.z] as Pt; });
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7));
      for (let s = 0; s < n; s++) {
        const u = s / n;
        const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
        if (inTown(x, z)) { const [cx, cz] = chunkOf(x, z); getChunk(cx, cz).t.push(q(x), q(z)); bump('trees (OSM)'); }
      }
    }
  }
}

// ---------- write ----------
rmSync(resolve(OUT, 'chunks'), { recursive: true, force: true });
mkdirSync(resolve(OUT, 'chunks'), { recursive: true });
const infos: ChunkInfo[] = [];
let bytes = 0;
for (const [k, data] of chunks) {
  const [cx, cz] = k.split('_').map(Number);
  const file = `chunks/${k}.json`;
  const json = JSON.stringify(data);
  bytes += json.length;
  writeFileSync(resolve(OUT, file), json);
  infos.push({ cx, cz, file, b: data.b.length, r: data.r.length, a: data.a.length, t: data.t.length / 2 });
}
infos.sort((a, b) => a.cx - b.cx || a.cz - b.cz);

const manifest: Manifest = {
  version: DATA_VERSION,
  generated: new Date().toISOString(),
  origin: ORIGIN,
  chunkSize: CHUNK,
  unit: UNIT,
  bounds: { minX, minZ, maxX, maxZ },
  boundary: flat(boundaryM),
  center: { x: 0, z: 0 },
  chunks: infos,
  stats,
  attribution: '© OpenStreetMap contributors (ODbL); GUGiK / EGiB',
  sources: {
    osmRoads: JSON.parse(readFileSync(resolve(CACHE, 'roads.json'), 'utf8')).osm3s?.timestamp_osm_base,
    osmBuildings: JSON.parse(readFileSync(resolve(CACHE, 'buildings.json'), 'utf8')).osm3s?.timestamp_osm_base,
    egibFetched,
  },
};
writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(stats);
console.log(`${infos.length} chunks, ${(bytes / 1024).toFixed(0)} KB raw JSON`);
