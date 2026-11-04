export type Pt = [number, number];

/** Douglas–Peucker on an open polyline. */
export function simplifyLine(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i], pts[a], pts[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (no repeated closing point). Keeps ≥ 3 points. */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4) return ring;
  // split ring at the two most distant points so both halves are open polylines
  let bi = 0;
  let bd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > bd) {
      bd = d;
      bi = i;
    }
  }
  const h1 = simplifyLine(ring.slice(0, bi + 1), tol);
  const h2 = simplifyLine([...ring.slice(bi), ring[0]], tol);
  const out = [...h1.slice(0, -1), ...h2.slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const z = a[1] + t * dz - p[1];
  return x * x + z * z;
}

export function signedArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % n];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

export function centroid(ring: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

export function pointInRing(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
