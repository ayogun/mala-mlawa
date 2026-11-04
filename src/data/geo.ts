// Local metric projection around the city origin (equirectangular; error is negligible over ~10 km).
export const ORIGIN = { lat: 53.1122, lon: 20.3833 };

const R = 6371008.8;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = R * DEG;
const M_PER_DEG_LON = R * DEG * Math.cos(ORIGIN.lat * DEG);

/** lat/lon → local metres. x east, z south. */
export function project(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT };
}

export function unproject(x: number, z: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - z / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}
