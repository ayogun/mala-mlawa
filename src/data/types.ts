// Shared between the preprocessing scripts and the web app.
// All coordinates in generated chunks are integers in "units" of 0.1 m (decimetres),
// in a local metric system: x = east, z = south, origin = manifest.origin.

export const UNIT = 0.1; // metres per stored unit

export type HeightSource = 0 | 1 | 2 | 3 | 4; // 0 OSM height, 1 OSM levels, 2 type default, 3 GUGiK LoD2, 4 GUGiK LoD1

/** Building kind codes (colour + Polish label). */
export type BuildingKind = 'h' | 'u' | 'a' | 'c' | 'i' | 'p' | 'r' | 's' | 'o';
// h house, u residential, a apartments, c commercial, i industrial, p public/civic, r religious, s shed/garage, o other

/** Road class codes. */
export type RoadClass = 'p' | 's' | 'r' | 'v' | 'f' | 'w' | 'd' | 'x';
// p primary, s secondary/tertiary, r residential, v service/track, f footway/path, w river/canal, d stream/ditch, x railway

/** Ground area kinds, ordered by paint priority (low → high). */
export type AreaKind = 'u' | 'm' | 's' | 'g' | 'f' | 'c' | 'q' | 'p' | 'k' | 'w';
// u urban landuse, m farmland, s scrub/meadow, g park/grass, f forest, c cemetery, q plaza, p sports, k parking, w water

export type Lod2Surface = [kind: 'w' | 'r', rings: number[][]];

export interface Lod2Model {
  h: number;
  surfaces: Lod2Surface[];
}

export interface Lod2Manifest {
  cityGenerated: string;
  chunks: string[];
  matchedBuildings: number;
}

export interface Lod1Height {
  h: number;
  y?: number;
}

export interface BuildingRec {
  id: number; // OSM way/relation id or a deterministic EGiB styling id
  r: number[][]; // rings: [outer, ...holes], each flat [x0,z0,x1,z1,...] in units
  h: number; // height in metres
  hs: HeightSource;
  lv?: number; // building:levels if known
  k: BuildingKind;
  n?: string; // name
  a?: string; // address "Street 12"
  t?: string; // function tag (amenity/shop/...) for the info panel
  lod2?: Lod2Surface[];
  s?: 'egib';
  ei?: string;
  hy?: number;
}

export interface RoadRec {
  c: RoadClass;
  p: number[]; // polyline flat [x,z,...] in units
  n?: string;
}

export interface AreaRec {
  k: AreaKind;
  r: number[][]; // rings (outer then holes)
  id: number;
}

export interface ChunkData {
  b: BuildingRec[];
  r: RoadRec[];
  a: AreaRec[];
  t: number[]; // OSM-mapped trees, flat [x,z,...] in units
}

export interface ChunkInfo {
  cx: number;
  cz: number;
  file: string;
  b: number;
  r: number;
  a: number;
  t: number;
}

export interface Manifest {
  version: number;
  generated: string;
  origin: { lat: number; lon: number };
  chunkSize: number; // metres
  unit: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }; // metres
  boundary: number[]; // town outline ring, flat units
  center: { x: number; z: number }; // initial camera focus, metres
  chunks: ChunkInfo[];
  stats: Record<string, number>;
  attribution: string;
  sources?: { osmRoads?: string; osmBuildings?: string; egibFetched?: string };
}
