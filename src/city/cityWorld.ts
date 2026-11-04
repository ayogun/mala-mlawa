import {
  BufferAttribute, BufferGeometry, Group, InstancedMesh, Mesh, MeshLambertMaterial,
} from 'three';
import earcut from 'earcut';
import { PALETTE, c3 } from '../data/palette';
import { UNIT, type ChunkData, type ChunkInfo, type Lod1Height, type Lod2Manifest, type Lod2Model, type Lod2Surface, type Manifest } from '../data/types';
import { buildBuildings } from '../rendering/buildingMesh';
import { buildGround } from '../rendering/groundMesh';
import { createBuildingMaterial, uWinter } from '../rendering/materials';
import { buildLamps, buildTrees, treeMaterial, type TreeMeshes } from '../rendering/props';
import { applyGroundSeason, applyTreeSeason, type Season } from '../rendering/seasons';
import { buildTraffic, type Traffic } from '../rendering/traffic';
import type { LandmarkIndex } from './landmarksIndex';

export interface ChunkRuntime {
  key: string;
  info: ChunkInfo;
  data: ChunkData;
  group: Group;
  building: Mesh | null;
  triStart: Uint32Array;
  trees: TreeMeshes;
  lamps: InstancedMesh | null;
  traffic: Traffic | null;
  tris: number;
}

export interface WorldOptions {
  dataBase: string;
  landmarks: LandmarkIndex;
  shadows: boolean;
  treeDensity: number;
  onChange: () => void;
}

const RENDER = { base: -3, area: 0, casing: 3, fill: 4, markings: 5, building: 10, tree: 11 };

export class CityWorld {
  readonly group = new Group();
  readonly chunks = new Map<string, ChunkRuntime>();
  readonly buildingMaterial = createBuildingMaterial();
  readonly groundMaterial = new MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  readonly pickables: Mesh[] = [];
  lod1Count = 0;
  lod2Count = 0;
  manifest!: Manifest;

  private requested = new Set<string>();
  private queue: ChunkInfo[] = [];
  private inflight = 0;
  private ready: { info: ChunkInfo; data: ChunkData }[] = [];
  private stamp = '';
  private lod1Chunks = new Set<string>();
  private lod2Chunks = new Set<string>();
  private seasonalGround: BufferGeometry[] = [];
  private season: Season = 'summer';
  private motion = true;
  private lastTraffic = 0;
  private lastCenter = { x: 0, z: 0 };

  constructor(private opts: WorldOptions) {}

  async init(): Promise<Manifest> {
    const res = await fetch(`${this.opts.dataBase}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    this.manifest = (await res.json()) as Manifest;
    this.stamp = encodeURIComponent(this.manifest.generated);
    const loadManifest = async (name: 'lod1' | 'lod2'): Promise<Lod2Manifest | undefined> => {
      try {
        const response = await fetch(`${this.opts.dataBase}/${name}/manifest.json`, { cache: 'no-cache' });
        if (!response.ok) return undefined;
        const value = await response.json() as Lod2Manifest;
        if (value.cityGenerated === this.manifest.generated && Array.isArray(value.chunks)) return value;
      } catch (error) {
        console.warn(`${name} data unavailable; using other building sources.`, error);
      }
      return undefined;
    };
    const [lod1, lod2] = await Promise.all([loadManifest('lod1'), loadManifest('lod2')]);
    if (lod1) {
      this.lod1Chunks = new Set(lod1.chunks);
      this.lod1Count = Number.isFinite(lod1.matchedBuildings) ? lod1.matchedBuildings : 0;
    }
    if (lod2) {
      this.lod2Chunks = new Set(lod2.chunks);
      this.lod2Count = Number.isFinite(lod2.matchedBuildings) ? lod2.matchedBuildings : 0;
    }
    this.buildBase();
    return this.manifest;
  }

  get stats() {
    let buildings = 0, tris = 0, trees = 0;
    for (const c of this.chunks.values()) {
      buildings += c.data.b.length;
      tris += c.tris;
      trees += c.trees.count;
    }
    return { loaded: this.chunks.size, total: this.manifest?.chunks.length ?? 0, pending: this.queue.length + this.inflight + this.ready.length, buildings, tris, trees };
  }

  /** the town outline as a diorama slab */
  private buildBase() {
    const ring = this.manifest.boundary;
    const flat: number[] = [];
    for (let i = 0; i < ring.length; i += 2) flat.push(ring[i] * UNIT, ring[i + 1] * UNIT);
    const idx = earcut(flat);
    const top = c3(PALETTE.ground);
    const soil = c3(PALETTE.soil);
    const pos: number[] = [], col: number[] = [], nor: number[] = [];
    const tri = (a: number[], b: number[], c: number[], n: number[], color: number[]) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
      if (d < 0) [b, c] = [c, b];
      for (const p of [a, b, c]) { pos.push(...p); col.push(...color); nor.push(...n); }
    };
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [flat[k * 2], 0, flat[k * 2 + 1]]);
      tri(v[0], v[1], v[2], [0, 1, 0], top);
    }
    const n = flat.length / 2;
    const depth = -22;
    const topGeo = this.toGeometry(pos, col, nor);
    topGeo.userData.seasonMask = new Uint8Array(topGeo.getAttribute('position').count).fill(2);
    this.seasonalGround.push(topGeo);
    applyGroundSeason(topGeo, this.season);
    pos.length = col.length = nor.length = 0;
    for (let i = 0; i < n; i++) {
      const a = [flat[i * 2], flat[i * 2 + 1]], b = [flat[((i + 1) % n) * 2], flat[((i + 1) % n) * 2 + 1]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nn = [(b[1] - a[1]) / l, 0, -(b[0] - a[0]) / l];
      // both windings are emitted so the skirt faces outward whatever the ring orientation
      for (const s of [1, -1]) {
        const m = [nn[0] * s, 0, nn[2] * s];
        tri([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], depth, b[1]], m, soil);
        tri([a[0], 0, a[1]], [b[0], depth, b[1]], [a[0], depth, a[1]], m, soil);
      }
    }
    const skirt = this.toGeometry(pos, col, nor);
    const topMesh = new Mesh(topGeo, this.groundMaterial);
    topMesh.renderOrder = RENDER.base;
    topMesh.receiveShadow = true;
    const skirtMesh = new Mesh(skirt, new MeshLambertMaterial({ vertexColors: true }));
    skirtMesh.renderOrder = RENDER.base - 1;
    this.group.add(topMesh, skirtMesh);
  }

  private toGeometry(pos: number[], col: number[], nor: number[]) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    return g;
  }

  /** queue chunks within `radius` metres of (x,z) */
  requestAround(x: number, z: number, radius: number) {
    this.lastCenter = { x, z };
    const S = this.manifest.chunkSize;
    let added = false;
    for (const info of this.manifest.chunks) {
      const k = `${info.cx}_${info.cz}`;
      if (this.requested.has(k)) continue;
      const cx = (info.cx + 0.5) * S, cz = (info.cz + 0.5) * S;
      if (Math.hypot(cx - x, cz - z) < radius + S * 0.75) {
        this.requested.add(k);
        this.queue.push(info);
        added = true;
      }
    }
    if (added) this.pumpFetch();
  }

  private pumpFetch() {
    const S = this.manifest.chunkSize;
    const { x, z } = this.lastCenter;
    this.queue.sort(
      (a, b) =>
        Math.hypot((a.cx + 0.5) * S - x, (a.cz + 0.5) * S - z) - Math.hypot((b.cx + 0.5) * S - x, (b.cz + 0.5) * S - z),
    );
    while (this.inflight < 4 && this.queue.length) {
      const info = this.queue.shift()!;
      this.inflight++;
      fetch(`${this.opts.dataBase}/${info.file}?v=${this.stamp}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<ChunkData>;
        })
        .then(async (data) => {
          const key = `${info.cx}_${info.cz}`;
          const loadSidecar = async <T>(name: 'lod1' | 'lod2', available: boolean): Promise<Record<string, T>> => {
            if (!available) return {};
            try {
              const response = await fetch(`${this.opts.dataBase}/${name}/${key}.json?v=${this.stamp}`);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return await response.json() as Record<string, T>;
            } catch (error) {
              console.warn(`${name} chunk unavailable; using other building sources.`, key, error);
              return {};
            }
          };
          const [heights, models] = await Promise.all([
            loadSidecar<Lod1Height>('lod1', this.lod1Chunks.has(key)),
            loadSidecar<Lod2Model>('lod2', this.lod2Chunks.has(key)),
          ]);
          for (const [index, height] of Object.entries(heights)) {
            const building = data.b[Number(index)];
            if (!building || building.hs === 0 || !Number.isFinite(height.h) || height.h < 1.5 || height.h > 250) continue;
            building.h = height.h;
            building.hs = 4;
            if (Number.isFinite(height.y)) building.hy = height.y;
          }
          for (const [index, model] of Object.entries(models)) {
            const building = data.b[Number(index)];
            if (!building || !Number.isFinite(model.h) || model.h < 1.5 || !Array.isArray(model.surfaces)) continue;
            if (building.hs === 4 || building.hs === 0) {
              if (Math.abs(building.h - model.h) > Math.max(1.2, building.h * 0.15)) continue;
              const scale = building.h / model.h;
              building.lod2 = model.surfaces.map(([kind, rings]): Lod2Surface => [
                kind, rings.map((ring) => ring.map((value, offset) => offset % 3 === 1 ? Math.round(value * scale) : value)),
              ]);
            } else {
              building.h = model.h;
              building.hs = 3;
              building.lod2 = model.surfaces;
            }
          }
          return data;
        })
        .then((data) => {
          this.ready.push({ info, data });
          this.opts.onChange();
        })
        .catch((e) => {
          console.warn('chunk failed', info.file, e);
          this.requested.delete(`${info.cx}_${info.cz}`);
        })
        .finally(() => {
          this.inflight--;
          this.pumpFetch();
        });
    }
  }

  /** build at most `budgetMs` worth of downloaded chunks; returns true if anything was added */
  pump(budgetMs = 10): boolean {
    const t0 = performance.now();
    let built = false;
    while (this.ready.length && performance.now() - t0 < budgetMs) {
      const { info, data } = this.ready.shift()!;
      this.addChunk(info, data);
      built = true;
    }
    if (this.ready.length) this.opts.onChange();
    return built;
  }

  private addChunk(info: ChunkInfo, data: ChunkData) {
    const key = `${info.cx}_${info.cz}`;
    const group = new Group();
    const accent = this.opts.landmarks.resolveChunk(key, data);
    let tris = 0;
    let building: Mesh | null = null;
    let triStart: Uint32Array = new Uint32Array(1);

    if (data.b.length) {
      const bg = buildBuildings(data.b, { accent });
      triStart = bg.triStart;
      tris += triStart[triStart.length - 1];
      building = new Mesh(bg.geometry, this.buildingMaterial);
      building.castShadow = this.opts.shadows;
      building.receiveShadow = this.opts.shadows;
      building.renderOrder = RENDER.building;
      building.userData.chunkKey = key;
      group.add(building);
      this.pickables.push(building);
    }

    const ground = buildGround(data);
    ground.areaTiers.forEach((g, i) => {
      if (!g) return;
      this.seasonalGround.push(g);
      applyGroundSeason(g, this.season);
      const m = new Mesh(g, this.groundMaterial);
      m.renderOrder = RENDER.area + i;
      m.receiveShadow = this.opts.shadows;
      group.add(m);
    });
    if (ground.casing) {
      const m = new Mesh(ground.casing, this.groundMaterial);
      m.renderOrder = RENDER.casing;
      m.receiveShadow = this.opts.shadows;
      group.add(m);
    }
    if (ground.fill) {
      const m = new Mesh(ground.fill, this.groundMaterial);
      m.renderOrder = RENDER.fill;
      m.receiveShadow = this.opts.shadows;
      group.add(m);
    }
    if (ground.markings) {
      const mesh = new Mesh(ground.markings, this.groundMaterial);
      mesh.renderOrder = RENDER.markings;
      mesh.receiveShadow = this.opts.shadows;
      group.add(mesh);
    }

    const trees = buildTrees(data, this.opts.treeDensity);
    applyTreeSeason(trees, this.season);
    for (const t of [trees.round, trees.cone]) {
      if (!t) continue;
      t.renderOrder = RENDER.tree;
      t.castShadow = this.opts.shadows;
      t.material = treeMaterial;
      group.add(t);
    }
    const lamps = buildLamps(data);
    if (lamps) { lamps.visible = false; group.add(lamps); }
    const traffic = buildTraffic(data);
    if (traffic) { traffic.mesh.visible = false; group.add(traffic.mesh); }

    this.group.add(group);
    this.chunks.set(key, { key, info, data, group, building, triStart, trees, lamps, traffic, tris });
    this.opts.onChange();
  }

  /** level-of-detail switches driven by zoom (px/m) and night factor */
  applyLod(zoom: number, night: number) {
    const showTrees = zoom > 0.45;
    const showLamps = night > 0.02 && zoom > 0.35;
    for (const c of this.chunks.values()) {
      if (c.trees.round) c.trees.round.visible = showTrees;
      if (c.trees.cone) c.trees.cone.visible = showTrees;
      if (c.lamps) c.lamps.visible = showLamps;
      if (c.traffic) c.traffic.mesh.visible = this.motion && zoom > 0.75;
    }
  }

  setSeason(season: Season) {
    this.season = season;
    uWinter.value = season === 'winter' ? 1 : 0;
    for (const geometry of this.seasonalGround) applyGroundSeason(geometry, season);
    for (const chunk of this.chunks.values()) applyTreeSeason(chunk.trees, season);
    this.opts.onChange();
  }

  setMotion(enabled: boolean) {
    this.motion = enabled;
    this.opts.onChange();
  }

  updateTraffic(now: number, zoom: number, radius: number): boolean {
    if (!this.motion || zoom <= 0.75 || now - this.lastTraffic < 50) return false;
    this.lastTraffic = now;
    let updated = false;
    const size = this.manifest.chunkSize;
    for (const chunk of this.chunks.values()) {
      if (!chunk.traffic) continue;
      const x = (chunk.info.cx + 0.5) * size, z = (chunk.info.cz + 0.5) * size;
      if (Math.hypot(x - this.lastCenter.x, z - this.lastCenter.z) > radius + size) continue;
      chunk.traffic.update(now);
      updated = true;
    }
    return updated;
  }
}
