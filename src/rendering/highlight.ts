import { Color, Group, Mesh, MeshLambertMaterial } from 'three';
import type { BuildingRec } from '../data/types';
import { buildBuildings } from './buildingMesh';

/** Overlay that re-draws the selected building in the selection colour. */
export class Highlight {
  readonly group = new Group();
  private mesh: Mesh | null = null;
  private material = new MeshLambertMaterial({
    vertexColors: true,
    emissive: new Color('#5a3a00'),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  set(rec: BuildingRec | null) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (!rec) return;
    const { geometry } = buildBuildings([rec], { select: true });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.renderOrder = 12;
    this.group.add(this.mesh);
  }
}
