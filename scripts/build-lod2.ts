import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import polygonClipping from 'polygon-clipping';
import proj4 from 'proj4';
import { SaxesParser } from 'saxes';
import { project, unproject } from '../src/data/geo';
import { UNIT, type BuildingRec, type ChunkData, type Lod2Manifest, type Lod2Model, type Lod2Surface, type Manifest } from '../src/data/types';
import { centroid, pointInRing, signedArea, type Pt } from './lib/geometry';

const CACHE = resolve(import.meta.dirname, '.cache');
const DATA = resolve(import.meta.dirname, '../public/data');
const ARCHIVE = resolve(CACHE, 'lod2-1413.zip');
const SOURCE = 'https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD2/1413_gml.zip';
const POLAND_1992 = '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs';
const GRID = 100;

type Point3 = [number, number, number];
type SurfaceKind = 'ground' | 'wall' | 'roof';
type RawSurface = { kind: SurfaceKind; rings: Point3[][] };
type Polygon = [number, number][][];
type IndexedBuilding = { key: string; index: number; polygon: Polygon; area: number; bounds: Bounds };
type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

const manifest = JSON.parse(readFileSync(resolve(DATA, 'manifest.json'), 'utf8')) as Manifest;
const boundary: Pt[] = [];
for (let index = 0; index < manifest.boundary.length; index += 2) {
  boundary.push([manifest.boundary[index] * UNIT, manifest.boundary[index + 1] * UNIT]);
}

function boundsOf(ring: Pt[]): Bounds {
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of ring) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

function overlap(left: Bounds, right: Bounds) {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minZ <= right.maxZ && left.maxZ >= right.minZ;
}

function polygonArea(polygon: Polygon): number {
  return Math.max(0, Math.abs(signedArea(polygon[0])) - polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0));
}

function asPolygon(rings: Pt[][]): Polygon {
  return rings.filter((ring) => ring.length >= 3).map((ring) => [...ring, ring[0]]);
}

function cells(bounds: Bounds): string[] {
  const keys: string[] = [];
  for (let x = Math.floor(bounds.minX / GRID); x <= Math.floor(bounds.maxX / GRID); x++) {
    for (let z = Math.floor(bounds.minZ / GRID); z <= Math.floor(bounds.maxZ / GRID); z++) keys.push(`${x}_${z}`);
  }
  return keys;
}

const grid = new Map<string, IndexedBuilding[]>();
for (const info of manifest.chunks) {
  const key = `${info.cx}_${info.cz}`;
  const data = JSON.parse(readFileSync(resolve(DATA, info.file), 'utf8')) as ChunkData;
  data.b.forEach((building: BuildingRec, index: number) => {
    const rings = building.r.map((flat) => {
      const ring: Pt[] = [];
      for (let offset = 0; offset < flat.length; offset += 2) ring.push([flat[offset] * UNIT, flat[offset + 1] * UNIT]);
      return ring;
    });
    const polygon = asPolygon(rings);
    if (!polygon.length) return;
    const item = { key, index, polygon, area: polygonArea(polygon), bounds: boundsOf(rings[0]) };
    for (const cell of cells(item.bounds)) {
      const entries = grid.get(cell) ?? [];
      entries.push(item);
      grid.set(cell, entries);
    }
  });
}

const projectedCorners = [
  [manifest.bounds.minX, manifest.bounds.minZ], [manifest.bounds.maxX, manifest.bounds.minZ],
  [manifest.bounds.minX, manifest.bounds.maxZ], [manifest.bounds.maxX, manifest.bounds.maxZ],
].map(([x, z]) => {
  const { lat, lon } = unproject(x, z);
  return proj4('WGS84', POLAND_1992, [lon, lat]);
});
const cityExtent = {
  minE: Math.min(...projectedCorners.map((point) => point[0])) - 100,
  maxE: Math.max(...projectedCorners.map((point) => point[0])) + 100,
  minN: Math.min(...projectedCorners.map((point) => point[1])) - 100,
  maxN: Math.max(...projectedCorners.map((point) => point[1])) + 100,
};

function intersectsCity(xml: string): boolean {
  const lower = xml.match(/<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/)?.[1].trim().split(/\s+/).map(Number);
  const upper = xml.match(/<gml:upperCorner>([^<]+)<\/gml:upperCorner>/)?.[1].trim().split(/\s+/).map(Number);
  if (!lower || !upper) return true;
  return lower[0] <= cityExtent.maxE && upper[0] >= cityExtent.minE && lower[1] <= cityExtent.maxN && upper[1] >= cityExtent.minN;
}

const matched = new Map<string, { score: number; model: Lod2Model }>();
const seen = new Set<string>();
let inTown = 0;
let examined = 0;

function processBuilding(id: string, surfaces: RawSurface[]) {
  if (id && seen.has(id)) return;
  if (id) seen.add(id);
  const ground = surfaces.find((surface) => surface.kind === 'ground' && surface.rings[0]?.length >= 3);
  if (!ground || !surfaces.some((surface) => surface.kind === 'roof') || !surfaces.some((surface) => surface.kind === 'wall')) return;

  const converted = new Map<string, Pt>();
  const local = ([east, north]: Point3): Pt => {
    const key = `${east},${north}`;
    let point = converted.get(key);
    if (!point) {
      const [lon, lat] = proj4(POLAND_1992, 'WGS84', [east, north]);
      const position = project(lat, lon);
      point = [position.x, position.z];
      converted.set(key, point);
    }
    return point;
  };
  const rings = ground.rings.map((ring) => ring.map(local));
  const [centerX, centerZ] = centroid(rings[0]);
  if (!pointInRing(centerX, centerZ, boundary)) return;
  inTown++;

  const polygon = asPolygon(rings);
  const area = polygonArea(polygon);
  if (area < 5) return;
  const bounds = boundsOf(rings[0]);
  const candidates = new Set<IndexedBuilding>();
  for (const cell of cells(bounds)) for (const entry of grid.get(cell) ?? []) candidates.add(entry);
  let best: IndexedBuilding | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    if (!overlap(bounds, candidate.bounds)) continue;
    let intersection: number;
    try {
      const clipped = polygonClipping.intersection(polygon, candidate.polygon);
      intersection = clipped.reduce((sum, result) => sum + polygonArea(result as Polygon), 0);
    } catch {
      continue;
    }
    const score = intersection / (area + candidate.area - intersection);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (!best || bestScore < 0.9) return;
  const matchKey = `${best.key}/${best.index}`;
  if ((matched.get(matchKey)?.score ?? 0) >= bestScore) return;

  const base = Math.min(...ground.rings.flat().map((point) => point[2]));
  let height = 0;
  const modelSurfaces: Lod2Surface[] = [];
  for (const surface of surfaces) {
    if (surface.kind === 'ground') continue;
    const modelRings = surface.rings.map((ring) => ring.flatMap((point) => {
      const [x, z] = local(point);
      const y = Math.max(0, point[2] - base);
      height = Math.max(height, y);
      return [Math.round(x / UNIT), Math.round(y / UNIT), Math.round(z / UNIT)];
    })).filter((ring) => ring.length >= 9);
    if (modelRings.length) modelSurfaces.push([surface.kind === 'wall' ? 'w' : 'r', modelRings]);
  }
  if (height < 1.5 || height > 250 || !Number.isFinite(height)) return;
  matched.set(matchKey, { score: bestScore, model: { h: Math.round(height * 10) / 10, surfaces: modelSurfaces } });
}

function parseTile(xml: string) {
  const parser = new SaxesParser();
  let building: RawSurface[] | null = null;
  let buildingId = '';
  let kind: SurfaceKind | null = null;
  let surface: RawSurface | null = null;
  let ring: Point3[] | null = null;
  let position = '';
  let text = '';
  parser.on('opentag', (tag) => {
    if (tag.name === 'bldg:Building') {
      building = [];
      buildingId = String(tag.attributes['gml:id'] ?? '');
      examined++;
    } else if (building && tag.name === 'bldg:GroundSurface') kind = 'ground';
    else if (building && tag.name === 'bldg:WallSurface') kind = 'wall';
    else if (building && tag.name === 'bldg:RoofSurface') kind = 'roof';
    else if (kind && tag.name === 'gml:Polygon') surface = { kind, rings: [] };
    else if (surface && tag.name === 'gml:LinearRing') ring = [];
    else if (ring && (tag.name === 'gml:pos' || tag.name === 'gml:posList')) { position = tag.name; text = ''; }
  });
  parser.on('text', (value) => { if (position) text += value; });
  parser.on('closetag', (tag) => {
    if (position && tag.name === position && ring) {
      const values = text.trim().split(/\s+/).map(Number);
      for (let index = 0; index + 2 < values.length; index += 3) {
        if (values.slice(index, index + 3).every(Number.isFinite)) ring.push([values[index], values[index + 1], values[index + 2]]);
      }
      position = '';
    } else if (tag.name === 'gml:LinearRing' && ring && surface) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first && last && first.every((value, index) => value === last[index])) ring.pop();
      if (ring.length >= 3) surface.rings.push(ring);
      ring = null;
    } else if (tag.name === 'gml:Polygon' && surface && building) {
      if (surface.rings.length) building.push(surface);
      surface = null;
    } else if (tag.name === 'bldg:GroundSurface' || tag.name === 'bldg:WallSurface' || tag.name === 'bldg:RoofSurface') kind = null;
    else if (tag.name === 'bldg:Building' && building) {
      processBuilding(buildingId, building);
      building = null;
    }
  });
  parser.write(xml).close();
}

mkdirSync(CACHE, { recursive: true });
if (!existsSync(ARCHIVE)) {
  console.log('Downloading official GUGiK LoD2 data for powiat mławski…');
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`LoD2 download: HTTP ${response.status}`);
  writeFileSync(ARCHIVE, Buffer.from(await response.arrayBuffer()));
}

const entries = execFileSync('unzip', ['-Z1', ARCHIVE], { encoding: 'utf8' }).split('\n').filter((name) => name.endsWith('.gml'));
let tiles = 0;
for (const entry of entries) {
  const xml = execFileSync('unzip', ['-p', ARCHIVE, entry], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (!intersectsCity(xml)) continue;
  parseTile(xml);
  tiles++;
}
if (!inTown || !matched.size) throw new Error('No LoD2 buildings matched the current city data; existing sidecars were left unchanged.');

const output = resolve(CACHE, 'lod2-output');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const chunks = new Map<string, Record<string, Lod2Model>>();
for (const [matchKey, result] of matched) {
  const [key, index] = matchKey.split('/');
  const chunk = chunks.get(key) ?? {};
  chunk[index] = result.model;
  chunks.set(key, chunk);
}
for (const [key, models] of chunks) writeFileSync(resolve(output, `${key}.json`), JSON.stringify(models));
const lod2Manifest: Lod2Manifest = { cityGenerated: manifest.generated, chunks: [...chunks.keys()].sort(), matchedBuildings: matched.size };
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(lod2Manifest));
rmSync(resolve(DATA, 'lod2'), { recursive: true, force: true });
renameSync(output, resolve(DATA, 'lod2'));
console.log(`Read ${tiles} tiles and ${examined} models; ${inTown} inside Mława, ${matched.size} matched to current buildings.`);
