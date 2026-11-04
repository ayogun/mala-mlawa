import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import polygonClipping from 'polygon-clipping';
import proj4 from 'proj4';
import { SaxesParser } from 'saxes';
import { project, unproject } from '../src/data/geo';
import { UNIT, type BuildingRec, type ChunkData, type Lod1Height, type Lod2Manifest, type Manifest } from '../src/data/types';
import { centroid, pointInRing, type Pt } from './lib/geometry';
import { asPolygon, boundsOf, overlaps, polygonArea, SpatialGrid, type Bounds, type Polygon } from './lib/spatial';

const CACHE = resolve(import.meta.dirname, '.cache');
const DATA = resolve(import.meta.dirname, '../public/data');
const ARCHIVE = resolve(CACHE, 'lod1-2024-1413.zip');
const SOURCE = 'https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD1/2024/14/1413.zip';
const POLAND_1992 = '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs';

type Point3 = [number, number, number];
type IndexedBuilding = { key: string; index: number; building: BuildingRec; polygon: Polygon; area: number; bounds: Bounds };
type RawBuilding = { id: string; height: number; year?: number; ground?: Point3[][]; groundZ: number };

const manifest = JSON.parse(readFileSync(resolve(DATA, 'manifest.json'), 'utf8')) as Manifest;
const boundary: Pt[] = [];
for (let index = 0; index < manifest.boundary.length; index += 2) boundary.push([manifest.boundary[index] * UNIT, manifest.boundary[index + 1] * UNIT]);

const grid = new SpatialGrid<IndexedBuilding>(100);
for (const info of manifest.chunks) {
  const key = `${info.cx}_${info.cz}`;
  const data = JSON.parse(readFileSync(resolve(DATA, info.file), 'utf8')) as ChunkData;
  data.b.forEach((building, index) => {
    const rings = building.r.map((flat) => {
      const ring: Pt[] = [];
      for (let offset = 0; offset < flat.length; offset += 2) ring.push([flat[offset] * UNIT, flat[offset + 1] * UNIT]);
      return ring;
    });
    const polygon = asPolygon(rings);
    if (!polygon.length) return;
    const bounds = boundsOf(rings[0]);
    grid.add(bounds, { key, index, building, polygon, bounds, area: polygonArea(polygon) });
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
  minX: Math.min(...projectedCorners.map((point) => point[0])) - 100,
  maxX: Math.max(...projectedCorners.map((point) => point[0])) + 100,
  minZ: Math.min(...projectedCorners.map((point) => point[1])) - 100,
  maxZ: Math.max(...projectedCorners.map((point) => point[1])) + 100,
};

function intersectsCity(xml: string): boolean {
  const lower = xml.match(/<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/)?.[1].trim().split(/\s+/).map(Number);
  const upper = xml.match(/<gml:upperCorner>([^<]+)<\/gml:upperCorner>/)?.[1].trim().split(/\s+/).map(Number);
  if (!lower || !upper) return true;
  return overlaps(cityExtent, { minX: lower[0], minZ: lower[1], maxX: upper[0], maxZ: upper[1] });
}

const matches = new Map<string, { score: number; height: Lod1Height }>();
const seen = new Set<string>();
let examined = 0;
let inTown = 0;

function processBuilding(model: RawBuilding): void {
  if (!model.id || seen.has(model.id) || !model.ground || model.height < 1.5 || model.height > 250 || !Number.isFinite(model.height)) return;
  seen.add(model.id);
  const first = model.ground[0][0];
  if (first[0] < cityExtent.minX || first[0] > cityExtent.maxX || first[1] < cityExtent.minZ || first[1] > cityExtent.maxZ) return;
  const rings = model.ground.map((ring) => ring.map(([east, north]) => {
    const [lon, lat] = proj4(POLAND_1992, 'WGS84', [east, north]);
    const position = project(lat, lon);
    return [position.x, position.z] as Pt;
  }));
  const [centerX, centerZ] = centroid(rings[0]);
  if (!pointInRing(centerX, centerZ, boundary)) return;
  inTown++;
  const polygon = asPolygon(rings);
  const area = polygonArea(polygon);
  if (area < 5) return;
  const bounds = boundsOf(rings[0]);
  let best: IndexedBuilding | undefined;
  let bestScore = 0;
  for (const candidate of grid.query(bounds)) {
    if (!overlaps(bounds, candidate.bounds)) continue;
    let intersection: number;
    try {
      intersection = polygonClipping.intersection(polygon, candidate.polygon)
        .reduce((sum, result) => sum + polygonArea(result as Polygon), 0);
    } catch {
      continue;
    }
    const score = intersection / (area + candidate.area - intersection);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (!best || bestScore < 0.8 || best.building.hs === 0) return;
  const key = `${best.key}/${best.index}`;
  if ((matches.get(key)?.score ?? 0) >= bestScore) return;
  const height: Lod1Height = { h: Math.round(model.height * 10) / 10 };
  if (model.year && model.year >= 1900 && model.year <= 2100) height.y = model.year;
  matches.set(key, { score: bestScore, height });
}

function parseTile(xml: string): void {
  const parser = new SaxesParser();
  let building: RawBuilding | null = null;
  let surface: Point3[][] | null = null;
  let ring: Point3[] | null = null;
  let sourceAttribute = false;
  let reading: 'height' | 'year' | 'coordinates' | null = null;
  let text = '';
  parser.on('opentag', (tag) => {
    if (tag.name === 'bldg:Building') {
      building = { id: String(tag.attributes['gml:id'] ?? ''), height: NaN, groundZ: Infinity };
      examined++;
    } else if (building && tag.name === 'gen:stringAttribute') sourceAttribute = tag.attributes.name === 'aktZrodla';
    else if (building && tag.name === 'bldg:measuredHeight') { reading = 'height'; text = ''; }
    else if (building && sourceAttribute && tag.name === 'gen:value') { reading = 'year'; text = ''; }
    else if (building && tag.name === 'gml:Polygon') surface = [];
    else if (surface && tag.name === 'gml:LinearRing') ring = [];
    else if (ring && (tag.name === 'gml:pos' || tag.name === 'gml:posList')) { reading = 'coordinates'; text = ''; }
  });
  parser.on('text', (value) => { if (reading) text += value; });
  parser.on('closetag', (tag) => {
    if (reading === 'height' && tag.name === 'bldg:measuredHeight' && building) {
      building.height = Number(text.trim());
      reading = null;
    } else if (reading === 'year' && tag.name === 'gen:value' && building) {
      building.year = Number(text.trim());
      reading = null;
    } else if (reading === 'coordinates' && (tag.name === 'gml:pos' || tag.name === 'gml:posList') && ring) {
      const values = text.trim().split(/\s+/).map(Number);
      for (let index = 0; index + 2 < values.length; index += 3) {
        if (values.slice(index, index + 3).every(Number.isFinite)) ring.push([values[index], values[index + 1], values[index + 2]]);
      }
      reading = null;
    } else if (tag.name === 'gen:stringAttribute') sourceAttribute = false;
    else if (tag.name === 'gml:LinearRing' && ring && surface) {
      const first = ring[0], last = ring[ring.length - 1];
      if (first && last && first.every((value, index) => value === last[index])) ring.pop();
      if (ring.length >= 3) surface.push(ring);
      ring = null;
    } else if (tag.name === 'gml:Polygon' && surface && building) {
      const heights = surface.flat().map((point) => point[2]);
      if (heights.length >= 3) {
        const low = Math.min(...heights), high = Math.max(...heights);
        if (high - low < 0.05 && low < building.groundZ) { building.ground = surface; building.groundZ = low; }
      }
      surface = null;
    } else if (tag.name === 'bldg:Building' && building) {
      processBuilding(building);
      building = null;
    }
  });
  parser.write(xml).close();
}

mkdirSync(CACHE, { recursive: true });
if (!existsSync(ARCHIVE)) {
  console.log('Downloading official GUGiK LoD1 (2024 collection) for powiat mławski…');
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`LoD1 download: HTTP ${response.status}`);
  const temporary = `${ARCHIVE}.tmp`;
  writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  try {
    execFileSync('unzip', ['-tq', temporary], { stdio: 'ignore' });
    renameSync(temporary, ARCHIVE);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

const entries = execFileSync('unzip', ['-Z1', ARCHIVE], { encoding: 'utf8' }).split('\n').filter((name) => name.endsWith('.gml'));
let tiles = 0;
for (const entry of entries) {
  const xml = execFileSync('unzip', ['-p', ARCHIVE, entry], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (!intersectsCity(xml)) continue;
  parseTile(xml);
  tiles++;
}
if (!inTown || !matches.size) throw new Error('No LoD1 buildings matched the current city data; existing sidecars were left unchanged.');

const output = resolve(CACHE, 'lod1-output');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const chunks = new Map<string, Record<string, Lod1Height>>();
for (const [matchKey, result] of matches) {
  const [key, index] = matchKey.split('/');
  const records = chunks.get(key) ?? {};
  records[index] = result.height;
  chunks.set(key, records);
}
for (const [key, heights] of chunks) writeFileSync(resolve(output, `${key}.json`), JSON.stringify(heights));
const lod1Manifest: Lod2Manifest = { cityGenerated: manifest.generated, chunks: [...chunks.keys()].sort(), matchedBuildings: matches.size };
writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(lod1Manifest));
rmSync(resolve(DATA, 'lod1'), { recursive: true, force: true });
renameSync(output, resolve(DATA, 'lod1'));
console.log(`Read ${tiles} tiles and ${examined} models; ${inTown} inside Mława, ${matches.size} matched to current buildings.`);
