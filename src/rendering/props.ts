import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, DynamicDrawUsage, IcosahedronGeometry, InstancedMesh,
  Matrix4, MeshLambertMaterial, MeshBasicMaterial, Object3D, PlaneGeometry, CanvasTexture, AdditiveBlending,
  Quaternion, Vector3, CylinderGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNIT, type AreaRec, type ChunkData } from '../data/types';
import { hash01 } from './buildingMesh';

type P = [number, number];

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g.index ? g.toNonIndexed() : g;
}

function makeRound(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.28, 0.4, 2.4, 5).translate(0, 1.2, 0), '#8a6a4b');
  const crown = new IcosahedronGeometry(2.7, 0);
  crown.scale(1, 1.15, 1);
  crown.translate(0, 4.6, 0);
  return mergeGeometries([trunk, paint(crown, '#ffffff')])!;
}

function makeCone(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0), '#7b5e44');
  const lower = new ConeGeometry(2.3, 5, 7).translate(0, 4.2, 0);
  const upper = new ConeGeometry(1.6, 4, 7).translate(0, 6.7, 0);
  return mergeGeometries([trunk, paint(lower, '#ffffff'), paint(upper, '#ffffff')])!;
}

export const treeGeometry = { round: makeRound(), cone: makeCone() };
export const treeMaterial = new MeshLambertMaterial({ vertexColors: true });

const ROUND_GREENS = ['#6b9f5d', '#80ad62', '#629454', '#8bb46c', '#739b5d'];
const CONE_GREENS = ['#4d8052', '#5c8d58', '#42734d', '#64945c'];

function inRing(x: number, z: number, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const toPts = (flat: number[]): P[] => {
  const o: P[] = [];
  for (let i = 0; i < flat.length; i += 2) o.push([flat[i] * UNIT, flat[i + 1] * UNIT]);
  return o;
};

function scatter(a: AreaRec, spacing: number, out: number[]) {
  const rings = a.r.map(toPts);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of rings[0]) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const ix0 = Math.floor(minX / spacing), ix1 = Math.ceil(maxX / spacing);
  const iz0 = Math.floor(minZ / spacing), iz1 = Math.ceil(maxZ / spacing);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const h1 = hash01(ix * 73856093 + iz * 19349663 + a.id);
      const h2 = hash01(ix * 83492791 + iz * 2654435 + a.id * 3);
      if (h1 > 0.82) continue; // gaps in the canopy
      const x = (ix + 0.15 + 0.7 * h1) * spacing;
      const z = (iz + 0.15 + 0.7 * h2) * spacing;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (!inRing(x, z, rings[0])) continue;
      let hole = false;
      for (let k = 1; k < rings.length; k++) if (inRing(x, z, rings[k])) { hole = true; break; }
      if (!hole) out.push(x, z);
    }
  }
}

const dummy = new Object3D();
const tmpColor = new Color();

export interface TreeMeshes { round: InstancedMesh | null; cone: InstancedMesh | null; count: number }

/** Trees from OSM nodes plus decorative scattering inside forests/parks/cemeteries. */
export function buildTrees(chunk: ChunkData, density: number): TreeMeshes {
  const round: number[] = [];
  const cone: number[] = [];
  for (let i = 0; i < chunk.t.length; i += 2) round.push(chunk.t[i] * UNIT, chunk.t[i + 1] * UNIT);
  for (const a of chunk.a) {
    if (a.k === 'f') scatter(a, 11 / density, cone);
    else if (a.k === 'g') scatter(a, 24 / density, round);
    else if (a.k === 'c') scatter(a, 15 / density, round);
  }
  const make = (pts: number[], geom: BufferGeometry, greens: string[], seed: number) => {
    const n = pts.length / 2;
    if (!n) return null;
    const m = new InstancedMesh(geom, treeMaterial, n);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      const h = hash01(Math.round(pts[i * 2] * 10) * 31 + Math.round(pts[i * 2 + 1] * 10) + seed);
      const s = 0.7 + 0.7 * h;
      dummy.position.set(pts[i * 2], 0, pts[i * 2 + 1]);
      dummy.rotation.set(0, h * 6.28, 0);
      dummy.scale.set(s, s * (0.9 + 0.3 * hash01(i + seed)), s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      tmpColor.set(greens[Math.floor(h * 997) % greens.length]);
      m.setColorAt(i, tmpColor);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.frustumCulled = true;
    return m;
  };
  return { round: make(round, treeGeometry.round, ROUND_GREENS, 1), cone: make(cone, treeGeometry.cone, CONE_GREENS, 7), count: (round.length + cone.length) / 2 };
}

// ---------- street lamps (night glow pools) ----------
let glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,140,1)');
  grad.addColorStop(0.35, 'rgba(255,190,100,0.45)');
  grad.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

export const lampMaterial = new MeshBasicMaterial({
  map: null, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.9,
});

export function buildLamps(chunk: ChunkData): InstancedMesh | null {
  if (!lampMaterial.map) lampMaterial.map = glowTexture();
  const spots: number[] = [];
  for (const r of chunk.r) {
    if (r.c !== 'p' && r.c !== 's' && r.c !== 'r') continue;
    const step = r.c === 'r' ? 46 : 36;
    let carry = step * 0.5;
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const ax = r.p[i] * UNIT, az = r.p[i + 1] * UNIT, bx = r.p[i + 2] * UNIT, bz = r.p[i + 3] * UNIT;
      const len = Math.hypot(bx - ax, bz - az);
      let d = carry;
      while (d < len) {
        spots.push(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len);
        d += step;
      }
      carry = d - len;
    }
  }
  const n = spots.length / 2;
  if (!n) return null;
  const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m = new InstancedMesh(geo, lampMaterial, n);
  const q = new Quaternion();
  const s = new Vector3();
  const mat = new Matrix4();
  for (let i = 0; i < n; i++) {
    const size = 14 + 6 * hash01(i * 13 + Math.round(spots[i * 2]));
    s.set(size, 1, size);
    mat.compose(new Vector3(spots[i * 2], 0.3, spots[i * 2 + 1]), q, s);
    m.setMatrixAt(i, mat);
  }
  m.computeBoundingSphere();
  m.renderOrder = 20;
  return m;
}
