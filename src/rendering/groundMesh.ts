import { BufferAttribute, BufferGeometry } from 'three';
import earcut from 'earcut';
import { PALETTE, c3 } from '../data/palette';
import { UNIT, type AreaKind, type ChunkData } from '../data/types';
import { hash01 } from './buildingMesh';

/** Painter's-order draw tiers (renderOrder): ground layers never write depth, so no z-fighting. */
export const AREA_TIER: Record<AreaKind, 0 | 1 | 2> = { u: 0, m: 0, s: 0, g: 1, f: 1, c: 1, q: 1, p: 2, k: 2, w: 2 };
const KIND_ORDER: AreaKind[] = ['u', 'm', 's', 'g', 'f', 'c', 'q', 'p', 'k', 'w'];

class Acc {
  pos: number[] = [];
  col: number[] = [];
  seasonal: number[] = [];
  vert(x: number, z: number, c: number[], season: number) {
    this.pos.push(x, 0, z);
    this.col.push(c[0], c[1], c[2]);
    this.seasonal.push(season);
  }
  tri(a: number[], b: number[], c: number[], color: number[], season = 0) {
    // force an upward-facing (+y) winding
    const y = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (y < 0) [b, c] = [c, b];
    this.vert(a[0], a[1], color, season);
    this.vert(b[0], b[1], color, season);
    this.vert(c[0], c[1], color, season);
  }
  geometry(): BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    const n = this.pos.length / 3;
    const nor = new Int8Array(n * 3);
    for (let i = 0; i < n; i++) nor[i * 3 + 1] = 127;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3, true));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.userData.seasonMask = new Uint8Array(this.seasonal);
    return g;
  }
}

function ribbon(acc: Acc, flat: number[], width: number, color: number[]) {
  const n = flat.length / 2;
  if (n < 2) return;
  const px: number[] = [], pz: number[] = [];
  for (let i = 0; i < n; i++) {
    px.push(flat[i * 2] * UNIT);
    pz.push(flat[i * 2 + 1] * UNIT);
  }
  const hw = width / 2;
  const L: number[][] = [], R: number[][] = [];
  for (let i = 0; i < n; i++) {
    const dirs: number[][] = [];
    if (i > 0) dirs.push(norm(px[i] - px[i - 1], pz[i] - pz[i - 1]));
    if (i < n - 1) dirs.push(norm(px[i + 1] - px[i], pz[i + 1] - pz[i]));
    // average of left-normals, miter-limited
    let nx = 0, nz = 0;
    for (const d of dirs) { nx += -d[1]; nz += d[0]; }
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    let k = 1;
    if (dirs.length === 2) {
      const dot = nx * -dirs[0][1] + nz * dirs[0][0];
      k = Math.min(1.7, 1 / Math.max(0.5, dot));
    }
    L.push([px[i] + nx * hw * k, pz[i] + nz * hw * k]);
    R.push([px[i] - nx * hw * k, pz[i] - nz * hw * k]);
  }
  for (let i = 0; i < n - 1; i++) {
    acc.tri(L[i], R[i], L[i + 1], color);
    acc.tri(R[i], R[i + 1], L[i + 1], color);
  }
  // round-ish ends: tiny end-caps avoid gaps at junctions
  for (const i of [0, n - 1]) {
    const c = [px[i], pz[i]];
    const k = 0.62 * hw;
    acc.tri([c[0] - k, c[1] - k], [c[0] + k, c[1] - k], [c[0] + k, c[1] + k], color);
    acc.tri([c[0] - k, c[1] - k], [c[0] + k, c[1] + k], [c[0] - k, c[1] + k], color);
  }
}

const ROAD_MARKING_COLOR = c3('#f5f0d7');

function roadMarkings(acc: Acc, flat: number[]) {
  const segments: { originX: number; originZ: number; deltaX: number; deltaZ: number; length: number }[] = [];
  let totalLength = 0;
  for (let index = 0; index + 3 < flat.length; index += 2) {
    const originX = flat[index] * UNIT, originZ = flat[index + 1] * UNIT;
    const deltaX = flat[index + 2] * UNIT - originX, deltaZ = flat[index + 3] * UNIT - originZ;
    const length = Math.hypot(deltaX, deltaZ);
    if (length < 0.01) continue;
    segments.push({ originX, originZ, deltaX, deltaZ, length });
    totalLength += length;
  }
  if (totalLength < 10) return;

  const spacing = 12, dashLength = 4, margin = 3, halfWidth = 0.18;
  let distance = 0;
  for (const segment of segments) {
    const segmentEnd = distance + segment.length;
    const normalX = -segment.deltaZ / segment.length * halfWidth;
    const normalZ = segment.deltaX / segment.length * halfWidth;
    for (let dash = Math.floor(distance / spacing) * spacing + margin; dash < segmentEnd; dash += spacing) {
      const start = Math.max(distance, dash, margin);
      const end = Math.min(segmentEnd, dash + dashLength, totalLength - margin);
      if (end - start < 0.05) continue;
      const startRatio = (start - distance) / segment.length;
      const endRatio = (end - distance) / segment.length;
      const startX = segment.originX + segment.deltaX * startRatio, startZ = segment.originZ + segment.deltaZ * startRatio;
      const endX = segment.originX + segment.deltaX * endRatio, endZ = segment.originZ + segment.deltaZ * endRatio;
      const leftStart = [startX + normalX, startZ + normalZ], rightStart = [startX - normalX, startZ - normalZ];
      const leftEnd = [endX + normalX, endZ + normalZ], rightEnd = [endX - normalX, endZ - normalZ];
      acc.tri(leftStart, rightStart, leftEnd, ROAD_MARKING_COLOR);
      acc.tri(rightStart, rightEnd, leftEnd, ROAD_MARKING_COLOR);
    }
    distance = segmentEnd;
  }
}

const norm = (x: number, z: number) => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

const areaColors = Object.fromEntries(KIND_ORDER.map((k) => [k, c3(PALETTE.area[k])])) as unknown as Record<AreaKind, number[]>;
const roadColors = Object.fromEntries(
  Object.entries(PALETTE.road).map(([k, v]) => [k, { fill: c3(v.fill), casing: c3(v.casing), width: v.width }]),
);

export interface GroundGeometries {
  areaTiers: (BufferGeometry | null)[];
  casing: BufferGeometry | null;
  fill: BufferGeometry | null;
  markings: BufferGeometry | null;
}

export function buildGround(chunk: ChunkData): GroundGeometries {
  const tiers = [new Acc(), new Acc(), new Acc()];
  const areas = [...chunk.a].sort((a, b) => KIND_ORDER.indexOf(a.k) - KIND_ORDER.indexOf(b.k));
  for (const a of areas) {
    const flat: number[] = [];
    const holes: number[] = [];
    a.r.forEach((ring, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (let j = 0; j < ring.length; j += 2) flat.push(ring[j] * UNIT, ring[j + 1] * UNIT);
    });
    const idx = earcut(flat, holes);
    const j = 0.96 + 0.08 * hash01(a.id);
    const base = areaColors[a.k];
    const color = [base[0] * j, base[1] * j, base[2] * j];
    const acc = tiers[AREA_TIER[a.k]];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [flat[k * 2], flat[k * 2 + 1]]);
      acc.tri(v[0], v[1], v[2], color, ['m', 's', 'g', 'f', 'c'].includes(a.k) ? 1 : 0);
    }
  }

  const casing = new Acc();
  const fill = new Acc();
  const markings = new Acc();
  const order = ['d', 'w', 'f', 'v', 'r', 's', 'p', 'x'];
  const roads = [...chunk.r].sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  for (const r of roads) {
    const st = roadColors[r.c];
    if (r.c !== 'f') ribbon(casing, r.p, st.width + 1.3, st.casing);
    ribbon(fill, r.p, st.width, st.fill);
    if (r.c === 'p' || r.c === 's' || r.c === 'r') roadMarkings(markings, r.p);
  }
  return { areaTiers: tiers.map((t) => t.geometry()), casing: casing.geometry(), fill: fill.geometry(), markings: markings.geometry() };
}
