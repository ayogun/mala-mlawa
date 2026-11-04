import type { CameraRig } from '../interactions/controls';

export const FOX_FOREST_POSITION = { x: -1200, z: -4500 };

export class ForestScene {
  private scene = document.getElementById('fox-map-scene') as HTMLButtonElement;
  private projection = { x: 0, y: 0, visible: false };

  update(rig: CameraRig): void {
    rig.project(FOX_FOREST_POSITION.x, 3, FOX_FOREST_POSITION.z, this.projection);
    this.scene.hidden = !this.projection.visible;
    if (!this.projection.visible) return;
    const scale = Math.max(0.75, Math.min(1.25, 0.96 + Math.log2(Math.max(rig.zoom, 0.1)) * 0.08));
    this.scene.style.transform = `translate(${this.projection.x}px, ${this.projection.y}px) translate(-50%, -95%) scale(${scale})`;
  }
}
