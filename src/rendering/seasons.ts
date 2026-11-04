import { Color, type BufferGeometry, type InstancedMesh } from 'three';
import { hash01 } from './buildingMesh';
import type { TreeMeshes } from './props';

export type Season = 'summer' | 'autumn' | 'winter';

const autumnGround = new Color('#b8a06a');
const winterGround = new Color('#e1e9e2');
const autumnLeaves = ['#b77838', '#d2a04b', '#a65335', '#d4ad62', '#70854d'].map((value) => new Color(value));
const autumnConifers = ['#507c50', '#618955', '#496e4a'].map((value) => new Color(value));
const winterLeaves = ['#c7d5cb', '#e3e9dc', '#aabeb2'].map((value) => new Color(value));
const winterConifers = ['#88a99a', '#a8c5b4', '#729381'].map((value) => new Color(value));

export function applyGroundSeason(geometry: BufferGeometry, season: Season) {
  const mask = geometry.userData.seasonMask as Uint8Array | undefined;
  const color = geometry.getAttribute('color');
  if (!mask || !color) return;
  const values = color.array as Float32Array;
  const original = (geometry.userData.summerColors ??= values.slice()) as Float32Array;
  values.set(original);
  if (season !== 'summer') {
    const target = season === 'autumn' ? autumnGround : winterGround;
    for (let index = 0; index < mask.length; index++) {
      if (!mask[index]) continue;
      const amount = season === 'autumn' ? (mask[index] === 2 ? 0.08 : 0.55) : (mask[index] === 2 ? 0.7 : 0.82);
      const offset = index * 3;
      values[offset] += (target.r - values[offset]) * amount;
      values[offset + 1] += (target.g - values[offset + 1]) * amount;
      values[offset + 2] += (target.b - values[offset + 2]) * amount;
    }
  }
  color.needsUpdate = true;
}

function colorTrees(mesh: InstancedMesh | null, season: Season, conifer: boolean) {
  if (!mesh?.instanceColor) return;
  const attribute = mesh.instanceColor;
  const values = attribute.array as Float32Array;
  const original = (mesh.userData.summerColors ??= values.slice()) as Float32Array;
  if (season === 'summer') values.set(original);
  else {
    const palette = season === 'autumn'
      ? (conifer ? autumnConifers : autumnLeaves)
      : (conifer ? winterConifers : winterLeaves);
    for (let index = 0; index < mesh.count; index++) {
      const color = palette[Math.floor(hash01(index * 31 + (conifer ? 7 : 1)) * palette.length)];
      values.set([color.r, color.g, color.b], index * 3);
    }
  }
  attribute.needsUpdate = true;
}

export function applyTreeSeason(trees: TreeMeshes, season: Season) {
  colorTrees(trees.round, season, false);
  colorTrees(trees.cone, season, true);
}
