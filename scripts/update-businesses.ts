import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { project } from '../src/data/geo';
import type { Business, BusinessDataset } from '../src/businesses/types';
import type { Manifest } from '../src/data/types';
import { pointInRing, type Pt } from './lib/geometry';
import { BBOX } from './lib/sources';

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OsmResponse {
  osm3s?: { timestamp_osm_base?: string };
  elements?: OsmElement[];
  remark?: string;
}

const cache = resolve('scripts/.cache/businesses.json');
const output = resolve('public/data/businesses.json');
const manifest = JSON.parse(readFileSync(resolve('public/data/manifest.json'), 'utf8')) as Manifest;
const boundary: Pt[] = [];
for (let index = 0; index < manifest.boundary.length; index += 2) {
  boundary.push([manifest.boundary[index] * manifest.unit, manifest.boundary[index + 1] * manifest.unit]);
}

const amenity = 'restaurant|fast_food|cafe|bar|pub|ice_cream|food_court|biergarten|bank|bureau_de_change|pharmacy|doctors|dentist|clinic|veterinary|fuel|car_wash|car_rental|car_sharing|vehicle_inspection|driving_school|language_school|music_school|childcare|post_office';
const tourism = 'hotel|motel|guest_house|hostel|apartment|camp_site';
const leisure = 'fitness_centre|sports_centre|sports_hall|bowling_alley|golf_course|dance|escape_game';
const bbox = `(${BBOX.join(',')})`;
const query = `[out:json][timeout:90];(`
  + `nwr["shop"]${bbox};nwr["office"]${bbox};nwr["craft"]${bbox};nwr["healthcare"]${bbox};`
  + `nwr["amenity"~"^(${amenity})$"]${bbox};nwr["tourism"~"^(${tourism})$"]${bbox};`
  + `nwr["leisure"~"^(${leisure})$"]${bbox};);out center;`;

const labels: Record<string, string> = {
  supermarket: 'Supermarket', convenience: 'Sklep spożywczy', bakery: 'Piekarnia',
  butcher: 'Sklep mięsny', greengrocer: 'Warzywniak', clothes: 'Sklep odzieżowy',
  shoes: 'Sklep obuwniczy', books: 'Księgarnia', florist: 'Kwiaciarnia',
  hairdresser: 'Salon fryzjerski', beauty: 'Salon kosmetyczny', car_repair: 'Warsztat samochodowy',
  car: 'Salon samochodowy', furniture: 'Sklep meblowy', doityourself: 'Sklep budowlany',
  restaurant: 'Restauracja', fast_food: 'Gastronomia', cafe: 'Kawiarnia', bar: 'Bar',
  pub: 'Pub', ice_cream: 'Lodziarnia', food_court: 'Gastronomia', biergarten: 'Ogródek gastronomiczny',
  bank: 'Bank', bureau_de_change: 'Kantor', pharmacy: 'Apteka', doctors: 'Gabinet lekarski',
  dentist: 'Gabinet stomatologiczny', clinic: 'Przychodnia', veterinary: 'Gabinet weterynaryjny',
  fuel: 'Stacja paliw', car_wash: 'Myjnia samochodowa', car_rental: 'Wypożyczalnia samochodów',
  car_sharing: 'Wynajem samochodów', vehicle_inspection: 'Stacja kontroli pojazdów',
  driving_school: 'Szkoła jazdy', language_school: 'Szkoła językowa', music_school: 'Szkoła muzyczna',
  childcare: 'Opieka nad dziećmi', post_office: 'Poczta', hotel: 'Hotel', motel: 'Motel',
  guest_house: 'Pensjonat', hostel: 'Hostel', apartment: 'Apartament', camp_site: 'Kemping',
  fitness_centre: 'Klub fitness', sports_centre: 'Centrum sportowe', sports_hall: 'Hala sportowa',
  bowling_alley: 'Kręgielnia', golf_course: 'Pole golfowe', dance: 'Szkoła tańca', escape_game: 'Escape room',
};
const excludedOffices = new Set(['government', 'ngo', 'association', 'political_party', 'diplomatic', 'religion']);
const inactive = new Set(['vacant', 'closed', 'disused', 'abandoned', 'demolished', 'construction', 'proposed']);
const services = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'tourism', 'leisure'];

function category(tags: Record<string, string>): string | undefined {
  for (const key of services) {
    const value = tags[key];
    if (!value || inactive.has(value) || (key === 'office' && excludedOffices.has(value))) continue;
    if (key === 'amenity' && !amenity.split('|').includes(value)) continue;
    if (key === 'tourism' && !tourism.split('|').includes(value)) continue;
    if (key === 'leisure' && !leisure.split('|').includes(value)) continue;
    return labels[value] ?? (key === 'shop' ? 'Sklep lub usługa'
      : key === 'healthcare' ? 'Usługi zdrowotne'
        : key === 'craft' ? 'Rzemiosło' : 'Usługi');
  }
  return undefined;
}

function toBusiness(element: OsmElement): Business | undefined {
  const tags = element.tags ?? {};
  if (['disused', 'abandoned', 'demolished', 'closed'].some((key) => tags[key] === 'yes')) return undefined;
  if (services.some((key) => ['disused', 'abandoned', 'demolished', 'closed'].some((status) => tags[`${status}:${key}`]))) return undefined;
  const kind = category(tags);
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!kind || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isSafeInteger(element.id) || element.id < 1) return undefined;
  const point = project(latitude!, longitude!);
  if (!pointInRing(point.x, point.z, boundary)) return undefined;
  const name = tags.name?.trim();
  const number = tags['addr:housenumber']?.trim();
  const unit = tags['addr:unit']?.trim();
  const address = tags['addr:full']?.trim() || [tags['addr:street']?.trim(), number ? `${number}${unit ? `/${unit}` : ''}` : undefined].filter(Boolean).join(' ');
  const result: Business = {
    id: `${element.type}/${element.id}`,
    name: name || kind,
    category: kind,
    latitude: latitude!,
    longitude: longitude!,
    named: !!name,
    source: 'osm',
  };
  if (address) result.address = address;
  return result;
}

async function download(): Promise<OsmResponse> {
  const mirrors = [
    ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
    'https://ovp.dresel.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  for (const endpoint of mirrors) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set('data', query);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'mala-mlawa-poc/0.1 (business map)', Accept: 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as OsmResponse;
      const timestamp = Date.parse(data.osm3s?.timestamp_osm_base ?? '');
      if (!Array.isArray(data.elements) || data.remark || !Number.isFinite(timestamp)) throw new Error(data.remark || 'Invalid response');
      if (Date.now() - timestamp > 14 * 24 * 60 * 60 * 1000) throw new Error('OpenStreetMap replica is more than 14 days old');
      mkdirSync(resolve('scripts/.cache'), { recursive: true });
      writeFileSync(cache, JSON.stringify(data));
      console.log(`Fetched businesses from ${url.host} (${data.osm3s?.timestamp_osm_base}).`);
      return data;
    } catch (error) {
      console.warn(`${endpoint}: ${(error as Error).message}`);
    }
  }
  throw new Error('No current OpenStreetMap business data available; existing published data was not changed.');
}

const useCache = process.argv.includes('--cached');
if (useCache && !existsSync(cache)) throw new Error('Business cache is missing. Run without --cached to download it.');
const raw = useCache ? JSON.parse(readFileSync(cache, 'utf8')) as OsmResponse : await download();
const updated = raw.osm3s?.timestamp_osm_base;
if (!updated || !Number.isFinite(Date.parse(updated)) || !Array.isArray(raw.elements) || raw.remark) throw new Error('Invalid cached business data');
const candidates = raw.elements
  .map(toBusiness)
  .filter((business): business is Business => !!business)
  .sort((first, second) => first.id.localeCompare(second.id, 'en'));
const businesses: Business[] = [];
for (const business of candidates) {
  const point = project(business.latitude, business.longitude);
  const duplicate = business.named && businesses.some((other) => {
    if (!other.named || other.name.toLocaleLowerCase('pl') !== business.name.toLocaleLowerCase('pl')) return false;
    if (other.id.split('/')[0] === business.id.split('/')[0]) return false;
    const otherPoint = project(other.latitude, other.longitude);
    return Math.hypot(point.x - otherPoint.x, point.z - otherPoint.z) < 15;
  });
  if (!duplicate) businesses.push(business);
}
if (!businesses.length) throw new Error('No businesses found; existing published data was not changed.');
const result: BusinessDataset = {
  updated,
  attribution: '© OpenStreetMap contributors',
  license: 'https://opendatacommons.org/licenses/odbl/1-0/',
  businesses,
};
writeFileSync(output, `${JSON.stringify(result)}\n`);
console.log(`Saved ${businesses.length} mapped businesses inside Mława to ${output}.`);
