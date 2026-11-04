import { Raycaster, Vector2, type OrthographicCamera } from 'three';
import { buildingOfFace } from '../rendering/buildingMesh';
import type { BuildingRec } from '../data/types';
import type { ChunkRuntime, CityWorld } from '../city/cityWorld';

export interface BuildingHit {
  chunk: ChunkRuntime;
  index: number;
  rec: BuildingRec;
}

const ray = new Raycaster();
const ndc = new Vector2();

/** Picks the building under a client position (works for mouse and touch taps). */
export function pickBuilding(world: CityWorld, camera: OrthographicCamera, el: HTMLElement, cx: number, cy: number): BuildingHit | null {
  const r = el.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(world.pickables, false);
  for (const h of hits) {
    const chunk = world.chunks.get(h.object.userData.chunkKey);
    if (!chunk || h.faceIndex == null) continue;
    const index = buildingOfFace(chunk.triStart, h.faceIndex);
    return { chunk, index, rec: chunk.data.b[index] };
  }
  return null;
}
