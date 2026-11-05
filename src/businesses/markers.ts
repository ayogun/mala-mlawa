import { inBuilding } from '../city/landmarksIndex';
import type { ChunkRuntime } from '../city/cityWorld';
import { project } from '../data/geo';
import type { CameraRig } from '../interactions/controls';
import { MANUAL_BUSINESSES } from './manual';
import type { Business } from './types';

interface BusinessPoint {
  business: Business;
  x: number;
  z: number;
  height?: number;
}

export interface ProjectedBusiness {
  business: Business;
  x: number;
  y: number;
}

interface BusinessGroup {
  key: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  businesses: Business[];
}

interface MarkerElement {
  button: HTMLButtonElement;
  count: HTMLElement;
  label: HTMLElement;
  businesses: Business[];
}

export function groupBusinesses(points: ProjectedBusiness[], distance = 52): BusinessGroup[] {
  const cells = new Map<string, BusinessGroup[]>();
  const groups: BusinessGroup[] = [];
  for (const point of points) {
    const column = Math.floor(point.x / distance);
    const row = Math.floor(point.y / distance);
    let group: BusinessGroup | undefined;
    for (let dx = -1; dx <= 1 && !group; dx++) {
      for (let dy = -1; dy <= 1 && !group; dy++) {
        group = cells.get(`${column + dx}_${row + dy}`)?.find((candidate) =>
          Math.hypot(candidate.anchorX - point.x, candidate.anchorY - point.y) < distance);
      }
    }
    if (!group) {
      group = { key: point.business.id, anchorX: point.x, anchorY: point.y, x: 0, y: 0, businesses: [] };
      groups.push(group);
      const key = `${column}_${row}`;
      const cell = cells.get(key) ?? [];
      cell.push(group);
      cells.set(key, cell);
    }
    group.x += point.x;
    group.y += point.y;
    group.businesses.push(point.business);
  }
  for (const group of groups) {
    group.x /= group.businesses.length;
    group.y /= group.businesses.length;
  }
  return groups;
}

export class BusinessMarkers {
  private points: BusinessPoint[] = [];
  private elements = new Map<string, MarkerElement>();
  private resolvedChunks = new Set<string>();
  private projection = { x: 0, y: 0, visible: false };
  private visible = true;

  constructor(private container: HTMLElement, private onPick: (businesses: Business[]) => void) {}

  setBusinesses(businesses: Business[]) {
    const combined = [...businesses];
    for (const manual of MANUAL_BUSINESSES) {
      const manualPoint = project(manual.latitude, manual.longitude);
      const duplicate = combined.some((business) => {
        if (!business.named || !business.name.toLocaleLowerCase('pl').includes(manual.name.toLocaleLowerCase('pl'))) return false;
        const point = project(business.latitude, business.longitude);
        return Math.hypot(point.x - manualPoint.x, point.z - manualPoint.z) < 60;
      });
      if (!duplicate) combined.push(manual);
    }
    this.points = combined.map((business) => ({ business, ...project(business.latitude, business.longitude) }));
    this.resolvedChunks.clear();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.container.hidden = !visible;
  }

  resolveBuildings(chunks: Iterable<ChunkRuntime>, chunkSize: number) {
    if (!this.points.length) return;
    for (const chunk of chunks) {
      if (this.resolvedChunks.has(chunk.key)) continue;
      this.resolvedChunks.add(chunk.key);
      const minX = (chunk.info.cx - 1) * chunkSize;
      const maxX = (chunk.info.cx + 2) * chunkSize;
      const minZ = (chunk.info.cz - 1) * chunkSize;
      const maxZ = (chunk.info.cz + 2) * chunkSize;
      for (const point of this.points) {
        if (point.height !== undefined || point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) continue;
        const building = chunk.data.b.find((candidate) => inBuilding(point.x, point.z, candidate.r[0]));
        if (building) point.height = building.h;
      }
    }
  }

  update(rig: CameraRig) {
    if (!this.visible) return;
    const radius = rig.visibleRadius();
    const { w, h } = rig.size;
    const projected: ProjectedBusiness[] = [];
    for (const point of this.points) {
      if (Math.abs(point.x - rig.target.x) > radius || Math.abs(point.z - rig.target.z) > radius) continue;
      rig.project(point.x, (point.height ?? 0) + 5, point.z, this.projection);
      if (!this.projection.visible || this.projection.x < -24 || this.projection.x > w + 24 || this.projection.y < -24 || this.projection.y > h + 24) continue;
      projected.push({ business: point.business, x: this.projection.x, y: this.projection.y });
    }
    const groups = groupBusinesses(projected);
    const active = new Set<string>();
    for (const group of groups) {
      active.add(group.key);
      let marker = this.elements.get(group.key);
      if (!marker) {
        marker = this.createMarker();
        this.elements.set(group.key, marker);
        this.container.append(marker.button);
      }
      marker.businesses = group.businesses;
      const count = group.businesses.length;
      const name = count === 1 ? group.businesses[0].name : `Lokale w pobliżu (${count})`;
      marker.count.hidden = count === 1;
      marker.count.textContent = String(count);
      marker.label.textContent = name;
      marker.button.title = name;
      marker.button.setAttribute('aria-label', count === 1 ? `Pokaż lokal: ${name}` : `Pokaż lokale w pobliżu: ${count}`);
      marker.button.style.transform = `translate(${group.x}px, ${group.y}px) translate(-50%, -90%)`;
    }
    for (const [key, marker] of this.elements) {
      if (active.has(key)) continue;
      marker.button.remove();
      this.elements.delete(key);
    }
  }

  private createMarker(): MarkerElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'business-map-marker';
    button.innerHTML = '<span class="business-map-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 3h16l2 5v2a3 3 0 0 1-2 2.8V21H4v-8.2A3 3 0 0 1 2 10V8zm2 10v6h3v-4h5v4h4v-6a4 4 0 0 1-3-1.2A4 4 0 0 1 12 13a4 4 0 0 1-3-1.2A4 4 0 0 1 6 13z"/></svg></span><span class="business-map-count" aria-hidden="true"></span><span class="business-map-label" aria-hidden="true"></span>';
    const marker: MarkerElement = {
      button,
      count: button.querySelector('.business-map-count')!,
      label: button.querySelector('.business-map-label')!,
      businesses: [],
    };
    button.onclick = (event) => {
      event.stopPropagation();
      this.onPick(marker.businesses);
    };
    return marker;
  }
}
