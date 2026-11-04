import { signedArea, type Pt } from './geometry';

export type Polygon = Pt[][];
export type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };

export function boundsOf(ring: Pt[]): Bounds {
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of ring) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

export function overlaps(left: Bounds, right: Bounds): boolean {
  return left.minX <= right.maxX && left.maxX >= right.minX && left.minZ <= right.maxZ && left.maxZ >= right.minZ;
}

export function polygonArea(polygon: Polygon): number {
  return Math.max(0, Math.abs(signedArea(polygon[0])) - polygon.slice(1).reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0));
}

export function asPolygon(rings: Pt[][]): Polygon {
  return rings.filter((ring) => ring.length >= 3).map((ring) => [...ring, ring[0]]);
}

export class SpatialGrid<T> {
  private readonly cells = new Map<string, T[]>();

  constructor(private readonly size: number) {}

  private keys(bounds: Bounds): string[] {
    const keys: string[] = [];
    for (let x = Math.floor(bounds.minX / this.size); x <= Math.floor(bounds.maxX / this.size); x++) {
      for (let z = Math.floor(bounds.minZ / this.size); z <= Math.floor(bounds.maxZ / this.size); z++) keys.push(`${x}_${z}`);
    }
    return keys;
  }

  add(bounds: Bounds, item: T): void {
    for (const key of this.keys(bounds)) {
      const entries = this.cells.get(key) ?? [];
      entries.push(item);
      this.cells.set(key, entries);
    }
  }

  query(bounds: Bounds): Set<T> {
    const matches = new Set<T>();
    for (const key of this.keys(bounds)) for (const item of this.cells.get(key) ?? []) matches.add(item);
    return matches;
  }
}
