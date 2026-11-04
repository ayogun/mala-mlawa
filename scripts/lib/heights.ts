import type { BuildingKind, HeightSource } from '../../src/data/types';

// Default heights (metres) when OSM has neither `height` nor `building:levels`.
// These are generic estimates, NOT measurements — see README "Height fallbacks".
const DEFAULT_HEIGHT: Record<BuildingKind, number> = {
  h: 6.5,
  u: 7.5,
  a: 15,
  c: 8,
  i: 8,
  p: 10,
  r: 12,
  s: 3,
  o: 6.5,
};

const KIND_BY_BUILDING: Record<string, BuildingKind> = {
  house: 'h', detached: 'h', semidetached_house: 'h', terrace: 'h', bungalow: 'h', residential: 'u', static_caravan: 'h',
  apartments: 'a', dormitory: 'a',
  commercial: 'c', retail: 'c', office: 'c', supermarket: 'c', kiosk: 'c', hotel: 'c',
  industrial: 'i', warehouse: 'i', factory: 'i', service: 'i', hangar: 'i', manufacture: 'i',
  public: 'p', civic: 'p', government: 'p', school: 'p', kindergarten: 'p', hospital: 'p', university: 'p', college: 'p',
  train_station: 'p', transportation: 'p', fire_station: 'p', sports_hall: 'p', stadium: 'p',
  church: 'r', chapel: 'r', cathedral: 'r', synagogue: 'r', religious: 'r',
  garage: 's', garages: 's', carport: 's', shed: 's', barn: 's', farm_auxiliary: 's', cabin: 's', roof: 's',
  greenhouse: 's', hut: 's', stable: 's', cowshed: 's', farm: 'h', storage_tank: 's', silo: 's',
};

export function buildingKind(tags: Record<string, string>): BuildingKind {
  if (tags.amenity === 'place_of_worship') return 'r';
  const b = KIND_BY_BUILDING[tags.building];
  if (b) return b;
  if (tags.amenity && /school|kindergarten|hospital|townhall|library|courthouse|police|fire_station|college|university|theatre|cinema|clinic|community_centre/.test(tags.amenity)) return 'p';
  if (tags.shop || tags.office) return 'c';
  return 'o';
}

function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = v.replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : undefined;
}

/** deterministic pseudo-random in [0,1) from an integer id */
export function hash01(id: number): number {
  let x = (id ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Height resolution chain:
 *  0. OSM `height` tag (metres)
 *  1. OSM `building:levels` × 3 m
 *  2. default per building kind with ±20 % deterministic variation
 * (3 and 4 are reserved for GUGiK LoD2 and LoD1 enrichment.)
 */
export function resolveHeight(
  tags: Record<string, string>,
  kind: BuildingKind,
  id: number,
): { h: number; hs: HeightSource; lv?: number } {
  const lv = parseNumber(tags['building:levels']);
  const height = parseNumber(tags.height);
  if (height && height >= 1.5 && height <= 250) return { h: round1(height), hs: 0, lv };
  if (lv && lv >= 1 && lv <= 60) return { h: round1(lv * 3 + (tags['roof:levels'] ? 1.5 : 0)), hs: 1, lv };
  const base = DEFAULT_HEIGHT[kind];
  const h = base * (0.85 + 0.3 * hash01(id));
  return { h: round1(Math.max(2.5, h)), hs: 2 };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
