import type { WebGLRenderer } from 'three';
import type { CityWorld } from '../city/cityWorld';
import type { CameraRig } from '../interactions/controls';

/** Dev overlay (`?debug`): FPS, draw calls, triangles, chunk counts. */
export class PerfStats {
  private last = 0;
  private ema = 16;
  private shown = 0;

  constructor(private el: HTMLElement, private renderer: WebGLRenderer, private world: CityWorld, private rig: CameraRig, private tier: string) {
    el.hidden = false;
  }

  frame(now: number) {
    if (this.last) this.ema += (now - this.last - this.ema) * 0.1;
    this.last = now;
    if (now - this.shown < 250) return;
    this.shown = now;
    const i = this.renderer.info;
    const s = this.world.stats;
    this.el.textContent =
      `${(1000 / this.ema).toFixed(0)} fps  ${this.ema.toFixed(1)} ms  tier:${this.tier}\n` +
      `calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\n` +
      `chunks ${s.loaded}/${s.total} (+${s.pending})  bldg ${s.buildings}  trees ${s.trees}\n` +
      `zoom ${this.rig.zoom.toFixed(2)} px/m  geo ${i.memory.geometries}`;
  }
}
