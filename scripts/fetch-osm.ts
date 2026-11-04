// Downloads raw OpenStreetMap data for Mława from Overpass into scripts/.cache/.
// Re-runs are free: cached files are reused unless --force is passed.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BBOX, TOWN_RELATION } from './lib/sources';

export const CACHE_DIR = resolve(import.meta.dirname, '.cache');

const MIRRORS = [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://ovp.dresel.systems/api/interpreter',
];
const UA = 'mala-mlawa-poc/0.1 (static miniature-city proof of concept)';
const force = process.argv.includes('--force');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(name: string, body: string): Promise<void> {
  const file = resolve(CACHE_DIR, `${name}.json`);
  if (existsSync(file) && !force) {
    console.log(`cached  ${name}`);
    return;
  }
  const query = `[out:json][timeout:180];${body}`;
  for (let attempt = 0; attempt < 24; attempt++) {
    console.log(`request ${name} (attempt ${attempt + 1})`);
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(150_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text) as { elements?: unknown; remark?: string };
      if (!Array.isArray(data.elements) || data.remark) throw new Error(data.remark || 'Invalid Overpass response');
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, text);
      renameSync(temporary, file);
      console.log(`fetched ${name} (${(text.length / 1024).toFixed(0)} KB) via ${new URL(url).host}`);
      await sleep(4000);
      return;
    } catch (e) {
      console.warn(`  ${name} attempt ${attempt + 1} failed on ${new URL(url).host}: ${(e as Error).message}`);
      await sleep(Math.min(60_000, 5000 * (attempt + 1)));
    }
  }
  throw new Error(`Could not fetch ${name} from any Overpass mirror`);
}

const [s, w, n, e] = BBOX;
const bb = `(${s},${w},${n},${e})`;

mkdirSync(CACHE_DIR, { recursive: true });
await overpass('boundary', `relation(${TOWN_RELATION});out geom;`);
await overpass('buildings', `(way["building"]${bb};relation["building"]${bb};);out geom;`);
await overpass(
  'roads',
  `(way["highway"]["highway"!~"proposed|construction|bus_stop|platform|elevator"]${bb};way["railway"="rail"]${bb};);out geom;`,
);
await overpass(
  'areas',
  `(` +
    `way["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery|village_green|allotments|orchard|farmland|residential|industrial|commercial|retail)$"]${bb};` +
    `relation["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery|village_green|allotments|orchard|farmland)$"]${bb};` +
    `way["leisure"~"^(park|garden|pitch|playground|stadium|sports_centre|swimming_pool|track)$"]${bb};` +
    `relation["leisure"~"^(park|garden)$"]${bb};` +
    `way["natural"~"^(water|wood|scrub|grassland|wetland)$"]${bb};` +
    `relation["natural"~"^(water|wood|wetland)$"]${bb};` +
    `way["waterway"~"^(river|stream|canal|drain|ditch)$"]${bb};` +
    `way["amenity"="parking"]${bb};` +
    `way["place"="square"]${bb};way["highway"="pedestrian"]["area"="yes"]${bb};` +
    `);out geom;`,
);
await overpass('trees', `(node["natural"="tree"]${bb};way["natural"="tree_row"]${bb};);out geom;`);
await overpass(
  'pois',
  `(` +
    `nwr["name"]["tourism"~"^(museum|attraction|viewpoint|gallery)$"]${bb};` +
    `nwr["name"]["historic"]${bb};` +
    `nwr["name"]["amenity"~"^(townhall|place_of_worship|library|theatre|hospital|marketplace|courthouse|police|fire_station|cinema|arts_centre|community_centre)$"]${bb};` +
    `nwr["name"]["leisure"~"^(stadium|sports_centre|water_park|park)$"]${bb};` +
    `nwr["name"]["railway"="station"]${bb};` +
    `nwr["name"]["shop"="mall"]${bb};` +
    `);out tags center;`,
);
console.log('done');
