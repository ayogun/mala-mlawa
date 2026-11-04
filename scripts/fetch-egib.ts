import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BBOX, TOWN_EGIB_PREFIX } from './lib/sources';

const CACHE = resolve(import.meta.dirname, '.cache');
const FILE = resolve(CACHE, 'egib-buildings.json');
const SERVICE = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza';
const LIMIT = 1000;
const MAX_DEPTH = 8;
const CONCURRENCY = 3;

type Area = { south: number; west: number; north: number; east: number; depth: number };
type Feature = { type: 'Feature'; properties: { ID_BUDYNKU?: string }; geometry: { type: string; coordinates: unknown } | null };
type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

async function fetchArea(area: Area): Promise<{ features: Feature[]; matched: number }> {
  const query = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: 'ms:budynki',
    bbox: `${area.south},${area.west},${area.north},${area.east},EPSG:4326`,
    srsName: 'EPSG:4326', outputFormat: 'application/json', count: String(LIMIT),
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const hitsQuery = new URLSearchParams(query);
      hitsQuery.delete('outputFormat');
      hitsQuery.delete('count');
      hitsQuery.set('resultType', 'hits');
      const [response, hitsResponse] = await Promise.all([
        fetch(`${SERVICE}?${query}`, { signal: AbortSignal.timeout(60_000) }),
        fetch(`${SERVICE}?${hitsQuery}`, { signal: AbortSignal.timeout(60_000) }),
      ]);
      if (!response.ok || !hitsResponse.ok) throw new Error(`HTTP ${response.status} / ${hitsResponse.status}`);
      const data = await response.json() as FeatureCollection;
      const hits = await hitsResponse.text();
      const matchedValue = hits.match(/\bnumberMatched="(\d+)"/)?.[1];
      if (matchedValue === undefined) throw new Error('Invalid EGiB feature count');
      const matched = Number(matchedValue);
      if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length > LIMIT) {
        throw new Error('Invalid EGiB response');
      }
      return { features: data.features, matched };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
  throw new Error('Could not fetch EGiB buildings');
}

function subdivide(area: Area): Area[] {
  const latitude = (area.south + area.north) / 2;
  const longitude = (area.west + area.east) / 2;
  const depth = area.depth + 1;
  return [
    { south: area.south, west: area.west, north: latitude, east: longitude, depth },
    { south: area.south, west: longitude, north: latitude, east: area.east, depth },
    { south: latitude, west: area.west, north: area.north, east: longitude, depth },
    { south: latitude, west: longitude, north: area.north, east: area.east, depth },
  ];
}

if (existsSync(FILE) && !process.argv.includes('--force')) {
  console.log('cached  EGiB buildings');
} else {
  mkdirSync(CACHE, { recursive: true });
  const [south, west, north, east] = BBOX;
  const areas: Area[] = [{ south, west, north, east, depth: 0 }];
  const features = new Map<string, Feature>();
  let requests = 0;
  while (areas.length) {
    const batch = areas.splice(0, CONCURRENCY);
    const results = await Promise.all(batch.map(fetchArea));
    for (let index = 0; index < batch.length; index++) {
      const area = batch[index];
      const result = results[index];
      requests++;
      if (result.features.length !== result.matched) {
        if (area.depth >= MAX_DEPTH) throw new Error('EGiB response is incomplete at the smallest query area');
        areas.push(...subdivide(area));
        continue;
      }
      for (const feature of result.features) {
        const id = feature.properties?.ID_BUDYNKU;
        if (!id?.startsWith(TOWN_EGIB_PREFIX)) continue;
        if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) continue;
        features.set(id, feature);
      }
    }
    console.log(`EGiB: ${requests} requests, ${features.size} unique Mława buildings`);
  }
  if (features.size < 1000) throw new Error('EGiB response is unexpectedly incomplete; existing cache was left unchanged');
  const output = { type: 'FeatureCollection', fetched: new Date().toISOString(), features: [...features.values()] };
  const temporary = `${FILE}.tmp`;
  writeFileSync(temporary, JSON.stringify(output));
  renameSync(temporary, FILE);
  console.log(`Fetched ${features.size} registered buildings from EGiB.`);
}
