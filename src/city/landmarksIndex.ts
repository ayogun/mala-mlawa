import type { Landmark } from '../data/landmarks';
import { project } from '../data/geo';
import { UNIT, type ChunkData } from '../data/types';

export interface ResolvedLandmark {
  lm: Landmark;
  x: number;
  z: number;
  /** top of the matched building, or 0 */
  height: number;
  chunkKey?: string;
  buildingIndex?: number;
}

export class LandmarkIndex {
  readonly list: ResolvedLandmark[];

  constructor(landmarks: Landmark[]) {
    this.list = landmarks.map((lm) => {
      const p = project(lm.latitude, lm.longitude);
      return { lm, x: p.x, z: p.z, height: 0 };
    });
  }

  byId(id: string) {
    return this.list.find((l) => l.lm.id === id);
  }

  /** match unresolved landmarks to buildings of a freshly loaded chunk; returns accent building indices */
  resolveChunk(key: string, data: ChunkData): Set<number> {
    const accent = new Set<number>();
    for (const l of this.list) {
      if (l.buildingIndex !== undefined) continue;
      let found = -1;
      if (l.lm.osmId !== undefined) found = data.b.findIndex((b) => b.s !== 'egib' && b.id === l.lm.osmId);
      if (found < 0) {
        for (let i = 0; i < data.b.length; i++) {
          if (inBuilding(l.x, l.z, data.b[i].r[0])) { found = i; break; }
        }
      }
      if (found >= 0) {
        l.chunkKey = key;
        l.buildingIndex = found;
        l.height = data.b[found].h;
        accent.add(found);
      }
    }
    return accent;
  }
}

function inBuilding(x: number, z: number, ring: number[]): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  const ux = x / UNIT, uz = z / UNIT;
  if (ux < minX || ux > maxX || uz < minZ || uz > maxZ) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > uz !== zj > uz && ux < ((xj - xi) * (uz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
