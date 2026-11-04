import { Color } from 'three';
import type { AreaKind, BuildingKind, RoadClass } from './types';

export interface Palette {
  background: string;
  ground: string;
  soil: string;
  area: Record<AreaKind, string>;
  road: Record<RoadClass, { fill: string; casing: string; width: number; y: number }>;
}

export const PALETTE: Palette = {
  background: '#a9c5c6',
  ground: '#8eb87c',
  soil: '#756a54',
  area: {
    u: '#b3bd9e', // urban landuse
    m: '#b1c68a', // farmland
    s: '#99c181', // meadow/scrub
    g: '#72aa68', // park / grass
    f: '#56895a', // forest
    c: '#86a979', // cemetery
    q: '#ded4bc', // plaza / square
    p: '#79b683', // sports
    k: '#a8aca4', // parking
    w: '#72adca', // water
  },
  road: {
    p: { fill: '#52646a', casing: '#c7c7b5', width: 11, y: 0.2 },
    s: { fill: '#657579', casing: '#c9caba', width: 8.5, y: 0.18 },
    r: { fill: '#7c8984', casing: '#cbd0bd', width: 6.5, y: 0.16 },
    v: { fill: '#a1aaa0', casing: '#cbd0bd', width: 3.8, y: 0.14 },
    f: { fill: '#c5b99d', casing: '#c5b99d', width: 1.8, y: 0.12 },
    w: { fill: '#72adca', casing: '#5c94b0', width: 7, y: 0.1 },
    d: { fill: '#72adca', casing: '#5c94b0', width: 2.6, y: 0.1 },
    x: { fill: '#6c6d69', casing: '#555b59', width: 2.4, y: 0.22 },
  },
};

export interface BuildingStyle {
  walls: string[];
  roofs: string[];
}

export const BUILDING_STYLE: Record<BuildingKind, BuildingStyle> = {
  h: { walls: ['#f4e7d3', '#efdcbf', '#f2d9c6', '#e9e3d4', '#f6efe0'], roofs: ['#c8664b', '#b4543e', '#8f5b4b', '#6f7580', '#a2453a'] },
  u: { walls: ['#f4e7d3', '#efdcbf', '#f2d9c6', '#e9e3d4', '#f6efe0'], roofs: ['#c8664b', '#b4543e', '#8f5b4b', '#6f7580', '#a2453a'] },
  a: { walls: ['#f5ecd9', '#ecdcc0', '#e6d0cc', '#d6e0e6', '#efe4b8'], roofs: ['#9a8f86', '#8a8f98', '#b07a68'] },
  c: { walls: ['#dce6ee', '#e6e0ee', '#e9e4d6'], roofs: ['#8d99a8', '#9aa3ad'] },
  i: { walls: ['#cfd2d8', '#c3c8cf', '#d8d4c8'], roofs: ['#8895a2', '#7d8893'] },
  p: { walls: ['#f2dca8', '#efd0a2', '#f0e0bc'], roofs: ['#a65a4a', '#8d5448'] },
  r: { walls: ['#f8f1e2', '#f3e9d3'], roofs: ['#b7473b', '#9c4036'] },
  s: { walls: ['#e3d8c6', '#dccfbb', '#d8d3c8'], roofs: ['#8f8981', '#a39a8e', '#807a73'] },
  o: { walls: ['#ece1d1', '#e6dccb'], roofs: ['#a99e92', '#9a9087'] },
};

export const LANDMARK_ROOF = '#ff9d3c';
export const LANDMARK_WALL = '#fff1d2';
export const SELECT_COLOR = '#ffd23f';

export const c3 = (hex: string): [number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
