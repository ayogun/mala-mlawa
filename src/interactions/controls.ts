import { MathUtils, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

export interface RigBounds { minX: number; minZ: number; maxX: number; maxZ: number }

interface Pose { x: number; z: number; zoom: number; azim: number; elev: number }

const D = 7000; // camera distance; orthographic, so only affects clipping
const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Orthographic "miniature" camera with map-style gestures:
 * 1 pointer = pan (ground follows the finger), wheel / pinch = zoom to cursor,
 * twist (2 fingers) or right-drag = rotate, tap = select.
 */
export class CameraRig {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 500, 14000);
  target = new Vector3();
  zoom = 1; // pixels per metre
  azim = Math.PI / 4;
  elev = Math.asin(1 / Math.sqrt(3));
  minZoom = 0.05;
  maxZoom = 7;
  onChange: () => void = () => {};
  onTap: (x: number, y: number) => void = () => {};
  onInteract: () => void = () => {};

  private el: HTMLElement;
  private w = 1;
  private h = 1;
  private bounds: RigBounds;
  private home: Pose;
  private ray = new Raycaster();
  private ptrs = new Map<number, { x: number; y: number }>();
  private anchor = new Vector3();
  private mode: 'none' | 'pan' | 'rotate' | 'pinch' = 'none';
  private down = { x: 0, y: 0, t: 0, moved: false, multi: false };
  private lastMid = { x: 0, y: 0 };
  private lastDist = 0;
  private lastAngle = 0;
  private lastRot = { x: 0, y: 0 };
  private vel = new Vector3();
  private fly: { from: Pose; to: Pose; t0: number; ms: number } | null = null;
  private inertia = false;
  private lastT = 0;

  constructor(el: HTMLElement, bounds: RigBounds, home: { x: number; z: number; zoom: number }) {
    this.el = el;
    this.bounds = bounds;
    this.home = { x: home.x, z: home.z, zoom: home.zoom, azim: this.azim, elev: this.elev };
    this.target.set(home.x, 0, home.z);
    this.zoom = home.zoom;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.apply();
  }

  get size() { return { w: this.w, h: this.h }; }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const c = this.camera;
    c.left = -w / 2; c.right = w / 2; c.top = h / 2; c.bottom = -h / 2;
    const ext = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ);
    this.minZoom = Math.max(0.025, (Math.min(w, h) * 0.95) / ext);
    this.zoom = MathUtils.clamp(this.zoom, this.minZoom, this.maxZoom);
    this.apply();
  }

  /** radius (m) of ground covered by the viewport, for chunk streaming */
  visibleRadius(): number {
    return Math.hypot(this.w, this.h / Math.sin(this.elev)) / 2 / this.zoom;
  }

  private apply() {
    const b = this.bounds, m = 150;
    this.target.x = MathUtils.clamp(this.target.x, b.minX - m, b.maxX + m);
    this.target.z = MathUtils.clamp(this.target.z, b.minZ - m, b.maxZ + m);
    this.zoom = MathUtils.clamp(this.zoom, this.minZoom, this.maxZoom);
    this.elev = MathUtils.clamp(this.elev, MathUtils.degToRad(22), MathUtils.degToRad(70));
    const c = this.camera;
    const ce = Math.cos(this.elev);
    c.position.set(this.target.x + D * ce * Math.sin(this.azim), D * Math.sin(this.elev), this.target.z + D * ce * Math.cos(this.azim));
    c.up.set(0, 1, 0);
    c.lookAt(this.target.x, 0, this.target.z);
    c.zoom = this.zoom;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  private groundAt(cx: number, cy: number, out = new Vector3()): Vector3 {
    const r = this.el.getBoundingClientRect();
    const ndc = new Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.ray.ray.intersectPlane(GROUND, out);
    return out;
  }

  /** keep the ground point under screen position (cx,cy) fixed at `anchor` */
  private pinTo(cx: number, cy: number) {
    const p = this.groundAt(cx, cy);
    this.target.x += this.anchor.x - p.x;
    this.target.z += this.anchor.z - p.z;
    this.apply();
  }

  // ---------- animation ----------
  flyTo(x: number, z: number, zoom: number, ms = 800, azim = this.azim, elev = this.elev) {
    this.inertia = false;
    this.fly = {
      from: { x: this.target.x, z: this.target.z, zoom: this.zoom, azim: this.azim, elev: this.elev },
      to: { x, z, zoom: MathUtils.clamp(zoom, this.minZoom, this.maxZoom), azim, elev },
      t0: performance.now(),
      ms,
    };
    this.onChange();
  }

  reset() {
    const h = this.home;
    // take the short way round for azimuth
    let az = h.azim;
    while (az - this.azim > Math.PI) az -= Math.PI * 2;
    while (az - this.azim < -Math.PI) az += Math.PI * 2;
    this.flyTo(h.x, h.z, h.zoom, 900, az, h.elev);
  }

  zoomBy(factor: number) {
    this.fly = null;
    this.inertia = false;
    this.zoom *= factor;
    this.apply();
    this.onChange();
  }

  rotateBy(angle: number) {
    this.flyTo(this.target.x, this.target.z, this.zoom, 260, this.azim + angle, this.elev);
  }

  panBy(right: number, forward: number) {
    this.fly = null;
    this.inertia = false;
    const horizontal = right / this.zoom;
    const vertical = forward / (this.zoom * Math.sin(this.elev));
    this.target.x += horizontal * Math.cos(this.azim) - vertical * Math.sin(this.azim);
    this.target.z -= horizontal * Math.sin(this.azim) + vertical * Math.cos(this.azim);
    this.apply();
    this.onChange();
  }

  get animating() { return !!this.fly || this.inertia; }

  /** advance animations; returns true when the camera moved */
  update(now: number): boolean {
    const dt = Math.min(0.05, (now - (this.lastT || now)) / 1000);
    this.lastT = now;
    if (this.fly) {
      const f = this.fly;
      const k = ease(Math.min(1, (now - f.t0) / f.ms));
      this.target.x = MathUtils.lerp(f.from.x, f.to.x, k);
      this.target.z = MathUtils.lerp(f.from.z, f.to.z, k);
      this.zoom = Math.exp(MathUtils.lerp(Math.log(f.from.zoom), Math.log(f.to.zoom), k));
      this.azim = MathUtils.lerp(f.from.azim, f.to.azim, k);
      this.elev = MathUtils.lerp(f.from.elev, f.to.elev, k);
      if (k >= 1) this.fly = null;
      this.apply();
      return true;
    }
    if (this.inertia) {
      this.target.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.pow(0.0025, dt)); // ~0.5 s glide
      this.apply();
      if (this.vel.lengthSq() < 4) this.inertia = false;
      return true;
    }
    return false;
  }

  // ---------- gestures ----------
  private startPan(x: number, y: number) {
    this.mode = 'pan';
    this.groundAt(x, y, this.anchor);
    this.vel.set(0, 0, 0);
  }

  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.fly = null;
    this.inertia = false;
    this.onInteract();
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 1) {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, multi: false };
      const rotate = e.button === 2 || e.button === 1 || (e.pointerType === 'mouse' && (e.ctrlKey || e.shiftKey));
      if (rotate) {
        this.mode = 'rotate';
        this.lastRot = { x: e.clientX, y: e.clientY };
      } else this.startPan(e.clientX, e.clientY);
    } else if (this.ptrs.size === 2) {
      this.down.multi = true;
      this.mode = 'pinch';
      const [a, b] = [...this.ptrs.values()];
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastAngle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) this.down.moved = true;
    if (this.mode === 'pan' && this.ptrs.size === 1) {
      if (!this.down.moved) return;
      const before = this.target.clone();
      this.pinTo(e.clientX, e.clientY);
      const now = performance.now();
      const dt = Math.max(1, now - (this.lastMoveT || now)) / 1000;
      this.lastMoveT = now;
      this.vel.lerp(this.target.clone().sub(before).divideScalar(dt), 0.4);
      this.onChange();
    } else if (this.mode === 'rotate') {
      this.azim -= (e.clientX - this.lastRot.x) * 0.006;
      this.elev += (e.clientY - this.lastRot.y) * 0.004;
      this.lastRot = { x: e.clientX, y: e.clientY };
      this.apply();
      this.onChange();
    } else if (this.mode === 'pinch' && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.groundAt(this.lastMid.x, this.lastMid.y, this.anchor);
      if (this.lastDist > 0) this.zoom *= dist / this.lastDist;
      let da = ang - this.lastAngle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.azim -= da;
      this.apply();
      this.pinTo(mid.x, mid.y);
      this.lastMid = mid;
      this.lastDist = dist;
      this.lastAngle = ang;
      this.onChange();
    }
  };
  private lastMoveT = 0;

  private onUp = (e: PointerEvent) => {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.ptrs.size === 0) {
      const quick = performance.now() - this.down.t < 600;
      if (!this.down.moved && !this.down.multi && quick && e.type === 'pointerup' && e.button === 0) {
        this.onTap(e.clientX, e.clientY);
      } else if (this.mode === 'pan' && this.vel.lengthSq() > 400 && performance.now() - this.lastMoveT < 80) {
        this.inertia = true;
        this.onChange();
      }
      this.mode = 'none';
    } else if (this.ptrs.size === 1) {
      // continue as pan with the remaining finger
      const [r] = [...this.ptrs.values()];
      this.down.moved = true;
      this.startPan(r.x, r.y);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.fly = null;
    this.inertia = false;
    this.onInteract();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.groundAt(e.clientX, e.clientY, this.anchor);
    this.zoom *= Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016));
    this.apply();
    this.pinTo(e.clientX, e.clientY);
    this.onChange();
  };

  /** ground point (metres) under a client position */
  pick(cx: number, cy: number): { x: number; z: number } {
    const g = this.groundAt(cx, cy);
    return { x: g.x, z: g.z };
  }

  /** screen position (client px) of a world point */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }) {
    const v = new Vector3(x, y, z).project(this.camera);
    const r = this.el.getBoundingClientRect();
    out.x = r.left + ((v.x + 1) / 2) * r.width;
    out.y = r.top + ((1 - v.y) / 2) * r.height;
    out.visible = v.z > -1 && v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
  }
}
