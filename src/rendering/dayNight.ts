import { Color, DirectionalLight, HemisphereLight, MathUtils, Scene, Vector3 } from 'three';
import { getMoonPosition, getPosition } from 'suncalc';
import { ORIGIN } from '../data/geo';
import { uNight } from './materials';

interface Look {
  bg: Color;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
  sun: Color;
  sunI: number;
}

const DAY: Look = {
  bg: new Color('#a9c5c6'),
  hemiSky: new Color('#fff6e6'),
  hemiGround: new Color('#d8ccb4'),
  hemiI: 1.35,
  sun: new Color('#fff0d6'),
  sunI: 1.9,
};
const NIGHT: Look = {
  bg: new Color('#0b1230'),
  hemiSky: new Color('#6f84c8'),
  hemiGround: new Color('#222a4a'),
  hemiI: 1.05,
  sun: new Color('#9db3ff'),
  sunI: 0.9,
};

const SUN_DIR = new Vector3(-0.45, 1, 0.8).normalize();

/** Hemisphere + directional light with a smooth day ↔ night blend. */
export class DayNight {
  t = 0; // 0 day … 1 night
  private goal = 0;
  readonly hemi = new HemisphereLight();
  readonly sun = new DirectionalLight();
  private shadowRadius = 600;
  private shadowsOn = false;
  private direction = SUN_DIR.clone();
  private liveMinute = -1;
  liveTime = false;

  constructor(private scene: Scene, shadows: boolean) {
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.background = new Color(DAY.bg);
    if (shadows) this.enableShadows();
    this.apply();
  }

  private enableShadows() {
    this.shadowsOn = true;
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.6;
    s.shadow.camera.near = 100;
    s.shadow.camera.far = 6000;
  }

  get night() { return this.goal > 0.5; }

  setNight(on: boolean) {
    this.liveTime = false;
    this.direction.copy(SUN_DIR);
    this.goal = on ? 1 : 0;
  }

  setLiveTime(on: boolean) {
    this.liveTime = on;
    this.liveMinute = -1;
    if (on) this.updateSun();
    else this.direction.copy(SUN_DIR);
  }

  private updateSun() {
    const now = new Date();
    this.liveMinute = Math.floor(now.getTime() / 60000);
    const sun = getPosition(now, ORIGIN.lat, ORIGIN.lon);
    const light = sun.altitude > -3 ? sun : getMoonPosition(now, ORIGIN.lat, ORIGIN.lon);
    const azimuth = MathUtils.degToRad(light.azimuth);
    const altitude = MathUtils.degToRad(Math.max(8, light.altitude));
    const horizontal = Math.cos(altitude);
    this.direction.set(Math.sin(azimuth) * horizontal, Math.sin(altitude), -Math.cos(azimuth) * horizontal).normalize();
    this.goal = 1 - MathUtils.smoothstep(sun.altitude, -6, 8);
  }

  get animating() { return Math.abs(this.t - this.goal) > 0.001; }

  /** follow the camera so the shadow map covers what is on screen */
  follow(x: number, z: number, radius: number) {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(this.direction, 2500);
    if (this.shadowsOn) {
      const r = MathUtils.clamp(radius * 0.9, 120, 1400);
      if (Math.abs(r - this.shadowRadius) > 1) {
        this.shadowRadius = r;
        const c = this.sun.shadow.camera;
        c.left = -r; c.right = r; c.top = r; c.bottom = -r;
        c.updateProjectionMatrix();
      }
    }
    this.sun.target.updateMatrixWorld();
  }

  update(dt: number): boolean {
    let updated = false;
    if (this.liveTime && Math.floor(Date.now() / 60000) !== this.liveMinute) {
      this.updateSun();
      updated = true;
    }
    if (!this.animating) return updated;
    const step = dt / 0.9;
    this.t = this.t < this.goal ? Math.min(this.goal, this.t + step) : Math.max(this.goal, this.t - step);
    this.apply();
    return true;
  }

  private apply() {
    const k = this.t * this.t * (3 - 2 * this.t);
    (this.scene.background as Color).lerpColors(DAY.bg, NIGHT.bg, k);
    this.hemi.color.lerpColors(DAY.hemiSky, NIGHT.hemiSky, k);
    this.hemi.groundColor.lerpColors(DAY.hemiGround, NIGHT.hemiGround, k);
    this.hemi.intensity = MathUtils.lerp(DAY.hemiI, NIGHT.hemiI, k);
    this.sun.color.lerpColors(DAY.sun, NIGHT.sun, k);
    this.sun.intensity = MathUtils.lerp(DAY.sunI, NIGHT.sunI, k);
    uNight.value = k;
  }

  get factor() { return this.t; }
}
