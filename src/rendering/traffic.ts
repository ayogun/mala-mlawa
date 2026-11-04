import { BoxGeometry, BufferAttribute, Color, DynamicDrawUsage, InstancedMesh, MeshLambertMaterial, Object3D, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../data/palette';
import { UNIT, type ChunkData } from '../data/types';
import { hash01 } from './buildingMesh';

type Point = { x: number; z: number; distance: number };
type Route = { points: Point[]; length: number; phase: number; speed: number; direction: number; lane: number; seed: number };

function paint(geometry: BufferGeometry, color: string) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  const shade = new Color(color);
  const values = new Float32Array(result.getAttribute('position').count * 3);
  for (let index = 0; index < values.length; index += 3) values.set([shade.r, shade.g, shade.b], index);
  result.setAttribute('color', new BufferAttribute(values, 3));
  return result;
}

const parts = [
  paint(new BoxGeometry(3.8, 0.8, 1.8).translate(0, 0.7, 0), '#ffffff'),
  paint(new BoxGeometry(1.9, 0.65, 1.55).translate(-0.15, 1.42, 0), '#8e9da2'),
];
for (const x of [-1.15, 1.15]) {
  for (const z of [-0.88, 0.88]) parts.push(paint(new BoxGeometry(0.65, 0.5, 0.3).translate(x, 0.35, z), '#343a3b'));
}
const geometry = mergeGeometries(parts)!;
for (const part of parts) part.dispose();
const material = new MeshLambertMaterial({ vertexColors: true });
const colors = ['#e7e1d3', '#ba5b48', '#638598', '#d2ad63', '#66766e', '#e3bdb2'].map((value) => new Color(value));
const object = new Object3D();

export class Traffic {
  readonly mesh: InstancedMesh;

  constructor(private routes: Route[]) {
    this.mesh = new InstancedMesh(geometry, material, routes.length);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    routes.forEach((route, index) => this.mesh.setColorAt(index, colors[Math.floor(hash01(route.seed + 73) * colors.length)]));
    this.update(performance.now());
  }

  update(now: number) {
    const seconds = now / 1000;
    this.routes.forEach((route, index) => {
      let distance = (route.phase + seconds * route.speed) % route.length;
      if (route.direction < 0) distance = route.length - distance;
      let pointIndex = 1;
      while (pointIndex < route.points.length - 1 && route.points[pointIndex].distance < distance) pointIndex++;
      const start = route.points[pointIndex - 1], end = route.points[pointIndex];
      const segmentLength = end.distance - start.distance;
      const progress = segmentLength ? (distance - start.distance) / segmentLength : 0;
      const dx = (end.x - start.x) / segmentLength;
      const dz = (end.z - start.z) / segmentLength;
      object.position.set(start.x + (end.x - start.x) * progress - dz * route.lane, 0, start.z + (end.z - start.z) * progress + dx * route.lane);
      object.rotation.set(0, -Math.atan2(dz * route.direction, dx * route.direction), 0);
      object.updateMatrix();
      this.mesh.setMatrixAt(index, object.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export function buildTraffic(chunk: ChunkData): Traffic | null {
  const routes: Route[] = [];
  const roads = chunk.r.filter((road) => road.c === 'p' || road.c === 's' || road.c === 'r')
    .sort((left, right) => ['p', 's', 'r'].indexOf(left.c) - ['p', 's', 'r'].indexOf(right.c));
  for (const road of roads) {
    if (routes.length >= 12) break;
    const seed = Math.round(road.p[0] * 19 + road.p[1] * 37 + road.p.length * 71);
    if (hash01(seed) > (road.c === 'r' ? 0.42 : 0.8)) continue;
    const points: Point[] = [];
    let length = 0;
    for (let index = 0; index + 1 < road.p.length; index += 2) {
      const x = road.p[index] * UNIT, z = road.p[index + 1] * UNIT;
      const previous = points[points.length - 1];
      const step = previous ? Math.hypot(x - previous.x, z - previous.z) : 0;
      if (previous && step < 0.1) continue;
      length += step;
      points.push({ x, z, distance: length });
    }
    if (length < 60 || points.length < 2) continue;
    const direction = hash01(seed + 11) < 0.5 ? -1 : 1;
    routes.push({
      points, length, direction, seed,
      phase: hash01(seed + 21) * length,
      speed: 5 + hash01(seed + 31) * 5,
      lane: direction * PALETTE.road[road.c].width * 0.22,
    });
  }
  return routes.length ? new Traffic(routes) : null;
}
