import { MeshLambertMaterial } from 'three';

export const uNight = { value: 0 };
export const uWinter = { value: 0 };

const FRAG_HELPERS = /* glsl */ `
uniform float uNight;
uniform float uWinter;
varying float vRand;
varying vec3 vLP;
varying vec3 vLN;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// painted windows on walls; returns 1 inside a window; wl = "lit at night" flag
float windows(out float wl){
  wl = 0.0;
  if (abs(vLN.y) > 0.3 || vLP.y < 0.8) return 0.0;
  float u = dot(vLP.xz, vec2(-vLN.z, vLN.x));
  float cu = floor(u / 3.0);
  float cv = floor((vLP.y - 0.9) / 3.0);
  float fu = fract(u / 3.0);
  float fv = fract((vLP.y - 0.9) / 3.0);
  float m = step(0.22, fu) * step(fu, 0.72) * step(0.30, fv) * step(fv, 0.78);
  wl = step(0.52, h21(vec2(cu + vRand * 91.0, cv + vRand * 37.0)));
  return m;
}`;

/** Lambert material with vertex colours, painted windows and night-time window glow. */
export function createBuildingMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uNight;
    shader.uniforms.uWinter = uWinter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRand;\nvarying float vRand;\nvarying vec3 vLP;\nvarying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRand = aRand; vLP = position; vLN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HELPERS)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wl; float wm = windows(wl);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.60, 0.68, 0.80), wm * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.80, 0.79), uWinter * step(0.35, vLN.y) * 0.75);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.40) * wm * wl * uNight * 1.15;`,
      );
  };
  m.customProgramCacheKey = () => 'mm-building-v2';
  return m;
}
