import { BufferAttribute, BufferGeometry } from 'three';
import earcut from 'earcut';
import { UNIT, type BuildingKind, type BuildingRec, type Lod2Surface } from '../data/types';
import { BUILDING_STYLE, LANDMARK_ROOF, LANDMARK_WALL, SELECT_COLOR, c3 } from '../data/palette';

type P = [number, number];

/** Growable Float32 buffer. */
class FloatBuf {
  a = new Float32Array(1 << 16);
  n = 0;
  push(...v: number[]) {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i];
  }
}

export function hash01(id: number): number {
  let x = (id ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const styleCache = new Map<BuildingKind, { walls: number[][]; roofs: number[][] }>();
function style(kind: BuildingKind) {
  let s = styleCache.get(kind);
  if (!s) {
    const def = BUILDING_STYLE[kind];
    s = { walls: def.walls.map(c3), roofs: def.roofs.map(c3) };
    styleCache.set(kind, s);
  }
  return s;
}
const LM_WALL = c3(LANDMARK_WALL);
const LM_ROOF = c3(LANDMARK_ROOF);
const SEL = c3(SELECT_COLOR);

class Builder {
  pos = new FloatBuf();
  nor = new FloatBuf();
  col = new FloatBuf();
  rnd = new FloatBuf();
  tris = 0;

  /** Adds a triangle whose front face points along (nx,ny,nz). */
  tri(a: number[], b: number[], c: number[], n: number[], color: number[], rand: number) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) [b, c] = [c, b];
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nor.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.col.push(...color, ...color, ...color);
    this.rnd.push(rand, rand, rand);
    this.tris++;
  }

  /** Roof triangle: normal derived from the geometry itself, forced upward. */
  roofTri(a: number[], b: number[], c: number[], color: number[], rand: number) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    this.tri(a, b, c, [nx, ny, nz], color, rand);
  }

  wall(p: P, q: P, yp: number, yq: number, color: number[], rand: number) {
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return;
    const n = [dz / l, 0, -dx / l];
    this.tri([p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], yq, q[1]], n, color, rand);
    this.tri([p[0], 0, p[1]], [q[0], yq, q[1]], [p[0], yp, p[1]], n, color, rand);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    const n = this.pos.n;
    const col = new Uint8Array(n);
    for (let i = 0; i < n; i++) col[i] = Math.round(Math.min(1, this.col.a[i]) * 255);
    const nor = new Int8Array(n);
    for (let i = 0; i < n; i++) nor[i] = Math.round(this.nor.a[i] * 127);
    const rnd = new Uint8Array(n / 3);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.round(this.rnd.a[i] * 255);
    g.setAttribute('position', new BufferAttribute(this.pos.a.slice(0, n), 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3, true));
    g.setAttribute('color', new BufferAttribute(col, 3, true));
    g.setAttribute('aRand', new BufferAttribute(rnd, 1, true));
    return g;
  }
}

const toPts = (flat: number[]): P[] => {
  const out: P[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * UNIT, flat[i + 1] * UNIT]);
  return out;
};

function area(r: P[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

interface Obb { ux: number; uz: number; vx: number; vz: number; cx: number; cz: number; lenU: number; lenV: number }

/** Minimum-area oriented bounding box; u is the long axis. */
function obb(pts: P[]): Obb {
  let best: Obb | null = null;
  let bestA = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.5) continue;
    const ax = (b[0] - a[0]) / l, az = (b[1] - a[1]) / l;
    const bx = -az, bz = ax;
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of pts) {
      const pa = p[0] * ax + p[1] * az, pb = p[0] * bx + p[1] * bz;
      minA = Math.min(minA, pa); maxA = Math.max(maxA, pa);
      minB = Math.min(minB, pb); maxB = Math.max(maxB, pb);
    }
    const ar = (maxA - minA) * (maxB - minB);
    if (ar < bestA) {
      bestA = ar;
      const la = maxA - minA, lb = maxB - minB;
      const ca = (minA + maxA) / 2, cb = (minB + maxB) / 2;
      const cx = ca * ax + cb * bx, cz = ca * az + cb * bz;
      best = la >= lb
        ? { ux: ax, uz: az, vx: bx, vz: bz, cx, cz, lenU: la, lenV: lb }
        : { ux: bx, uz: bz, vx: ax, vz: az, cx, cz, lenU: lb, lenV: la };
    }
  }
  return best ?? { ux: 1, uz: 0, vx: 0, vz: 1, cx: pts[0][0], cz: pts[0][1], lenU: 1, lenV: 1 };
}

/** Sutherland–Hodgman against the half-plane d(p) >= 0 (or <= 0). */
function clipHalf(ring: P[], d: (p: P) => number, positive: boolean): P[] {
  const out: P[] = [];
  const s = positive ? 1 : -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const da = d(a) * s, db = d(b) * s;
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function triangulate(ring: P[], holes: P[][] = []): number[] {
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (const p of ring) flat.push(p[0], p[1]);
  for (const h of holes) {
    holeIdx.push(flat.length / 2);
    for (const p of h) flat.push(p[0], p[1]);
  }
  return earcut(flat, holeIdx);
}

type RoofKind = 'flat' | 'gable' | 'pyramid';

function chooseRoof(b: BuildingRec, outer: P[], ob: Obb, a: number): RoofKind {
  if (b.r.length > 1 || outer.length > 16 || outer.length < 4) return 'flat';
  const k = b.k;
  const pitchedOk =
    (k === 'h' && a >= 20 && a <= 450) ||
    (k === 'u' && a >= 20 && a <= 450) ||
    (k === 'o' && a >= 20 && a <= 350) ||
    (k === 'a' && a >= 40 && a <= 260) ||
    (k === 'p' && a >= 40 && a <= 600) ||
    (k === 'r' && a >= 40 && a <= 1500);
  if (!pitchedOk) return 'flat';
  const fill = a / (ob.lenU * ob.lenV);
  if (fill < 0.8 || ob.lenV < 3) return 'flat';
  return ob.lenU / ob.lenV < 1.18 ? 'pyramid' : 'gable';
}

export interface BuildingGeometry {
  geometry: BufferGeometry;
  /** triStart[i] = first triangle of building i; last entry = total */
  triStart: Uint32Array;
}

export interface BuildOptions {
  /** indices (into the buildings array) rendered with landmark accent colours */
  accent?: Set<number>;
  /** render everything in the selection colour (highlight overlay) */
  select?: boolean;
}

function buildLod2(builder: Builder, surfaces: Lod2Surface[], wall: number[], roof: number[], rand: number) {
  for (const [kind, flatRings] of surfaces) {
    const rings = flatRings.map((flat) => {
      const points: number[][] = [];
      for (let index = 0; index + 2 < flat.length; index += 3) {
        points.push([flat[index] * UNIT, flat[index + 1] * UNIT, flat[index + 2] * UNIT]);
      }
      return points;
    }).filter((ring) => ring.length >= 3);
    if (!rings.length) continue;

    let nx = 0, ny = 0, nz = 0;
    const outer = rings[0];
    for (let index = 0; index < outer.length; index++) {
      const point = outer[index], next = outer[(index + 1) % outer.length];
      nx += (point[1] - next[1]) * (point[2] + next[2]);
      ny += (point[2] - next[2]) * (point[0] + next[0]);
      nz += (point[0] - next[0]) * (point[1] + next[1]);
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 0.001) continue;
    const sign = kind === 'r' && ny < 0 ? -1 : 1;
    const normal = [sign * nx / length, sign * ny / length, sign * nz / length];
    const axis = Math.abs(nx) > Math.abs(ny)
      ? (Math.abs(nx) > Math.abs(nz) ? 'x' : 'z')
      : (Math.abs(ny) > Math.abs(nz) ? 'y' : 'z');
    const vertices: number[][] = [];
    const projected: number[] = [];
    const holes: number[] = [];
    for (const ring of rings) {
      if (vertices.length) holes.push(vertices.length);
      for (const point of ring) {
        vertices.push(point);
        if (axis === 'x') projected.push(point[1], point[2]);
        else if (axis === 'y') projected.push(point[0], point[2]);
        else projected.push(point[0], point[1]);
      }
    }
    const triangles = earcut(projected, holes);
    for (let index = 0; index < triangles.length; index += 3) {
      builder.tri(vertices[triangles[index]], vertices[triangles[index + 1]], vertices[triangles[index + 2]], normal, kind === 'r' ? roof : wall, rand);
    }
  }
}

export function buildBuildings(buildings: BuildingRec[], opts: BuildOptions = {}): BuildingGeometry {
  const B = new Builder();
  const triStart = new Uint32Array(buildings.length + 1);
  buildings.forEach((b, i) => {
    triStart[i] = B.tris;
    const rand = hash01(b.id * 7 + i);
    const st = style(b.k);
    const jitter = 0.94 + 0.1 * hash01(b.id + 11);
    const tint = (c: number[]) => [c[0] * jitter, c[1] * jitter, c[2] * jitter];
    let wallC = tint(st.walls[Math.floor(hash01(b.id + 3) * st.walls.length)]);
    let roofC = tint(st.roofs[Math.floor(hash01(b.id + 5) * st.roofs.length)]);
    if (opts.accent?.has(i)) { wallC = LM_WALL; roofC = LM_ROOF; }
    if (opts.select) { wallC = SEL; roofC = SEL; }

    if (b.lod2?.length) {
      buildLod2(B, b.lod2, wallC, roofC, rand);
      if (B.tris > triStart[i]) return;
    }

    const rings = b.r.map(toPts);
    const outer = rings[0];
    const a = area(outer);
    const ob = obb(outer);
    const kind = chooseRoof(b, outer, ob, Math.abs(a));
    const H = b.h;
    const rise = kind === 'flat' ? 0 : Math.min((kind === 'gable' ? ob.lenV : ob.lenV * 0.8) * 0.32, H * 0.35, 4.5);
    const eave = H - rise;

    if (kind === 'gable') {
      const halfW = ob.lenV / 2;
      const d = (p: P) => (p[0] - ob.cx) * ob.vx + (p[1] - ob.cz) * ob.vz;
      const yf = (p: P) => eave + rise * (1 - Math.min(1, Math.abs(d(p)) / halfW));
      // insert ridge crossings so gable ends become proper triangles
      const aug: P[] = [];
      for (let k = 0; k < outer.length; k++) {
        const p = outer[k], q = outer[(k + 1) % outer.length];
        aug.push(p);
        const dp = d(p), dq = d(q);
        if ((dp > 0.05 && dq < -0.05) || (dp < -0.05 && dq > 0.05)) {
          const t = dp / (dp - dq);
          aug.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
      for (let k = 0; k < aug.length; k++) {
        const p = aug[k], q = aug[(k + 1) % aug.length];
        B.wall(p, q, yf(p), yf(q), wallC, rand);
      }
      for (const side of [true, false]) {
        const half = clipHalf(aug, d, side);
        if (half.length < 3) continue;
        const idx = triangulate(half);
        for (let t = 0; t < idx.length; t += 3) {
          const v = [idx[t], idx[t + 1], idx[t + 2]].map((j) => [half[j][0], yf(half[j]), half[j][1]]);
          B.roofTri(v[0], v[1], v[2], roofC, rand);
        }
      }
    } else if (kind === 'pyramid') {
      const apex = [ob.cx, eave + rise, ob.cz];
      for (let k = 0; k < outer.length; k++) {
        const p = outer[k], q = outer[(k + 1) % outer.length];
        B.wall(p, q, eave, eave, wallC, rand);
        B.roofTri([p[0], eave, p[1]], [q[0], eave, q[1]], apex, roofC, rand);
      }
    } else {
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k++) B.wall(ring[k], ring[(k + 1) % ring.length], H, H, wallC, rand);
      }
      const idx = triangulate(outer, rings.slice(1));
      const all = rings.flat();
      for (let t = 0; t < idx.length; t += 3) {
        const v = [idx[t], idx[t + 1], idx[t + 2]].map((j) => [all[j][0], H, all[j][1]]);
        B.roofTri(v[0], v[1], v[2], roofC, rand);
      }
    }
  });
  triStart[buildings.length] = B.tris;
  return { geometry: B.geometry(), triStart };
}

/** index of the building owning triangle `face` (binary search over triStart) */
export function buildingOfFace(triStart: Uint32Array, face: number): number {
  let lo = 0, hi = triStart.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (triStart[mid] <= face) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
