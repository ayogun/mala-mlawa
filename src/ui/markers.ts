import type { CameraRig } from '../interactions/controls';
import type { ResolvedLandmark } from '../city/landmarksIndex';
import { h } from './dom';

export class Markers {
  private els: { l: ResolvedLandmark; el: HTMLElement }[];
  private out = { x: 0, y: 0, visible: false };
  private selected: string | null = null;

  constructor(private container: HTMLElement, list: ResolvedLandmark[], onPick: (id: string) => void) {
    this.els = list.map((l) => {
      const el = h('button', { class: 'marker', title: l.lm.name }, h('span', { class: 'dot' }), h('span', { class: 'label', text: l.lm.name }));
      el.setAttribute('aria-label', l.lm.name);
      el.onclick = (e) => {
        e.stopPropagation();
        onPick(l.lm.id);
      };
      this.container.append(el);
      return { l, el };
    });
  }

  setSelected(id: string | null) {
    this.selected = id;
    for (const { l, el } of this.els) el.classList.toggle('selected', l.lm.id === id);
  }

  setVisible(visible: boolean) {
    this.container.hidden = !visible;
  }

  update(rig: CameraRig) {
    const r = rig.size;
    for (const { l, el } of this.els) {
      rig.project(l.x, l.height + 4, l.z, this.out);
      const ok = this.out.visible && this.out.x > -20 && this.out.x < r.w + 20;
      el.style.display = ok ? '' : 'none';
      if (!ok) continue;
      el.style.transform = `translate(${this.out.x - 8}px, ${this.out.y - 16}px)`;
      el.style.zIndex = l.lm.id === this.selected ? '2' : '';
    }
  }
}
