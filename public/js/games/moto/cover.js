/* Snow and mud on riders and things.
   Snow settles on whatever faces up (a hat, the shoulders, a backpack, a board, a deck or a sign): in patches at first,
   then all over. Mud splashes up from the wheels: thickest low down (the wheels, the frame, boots and legs), spattered
   higher up. A rider's own copies of their materials get it (coverModel), so everyone's is their own; things in the
   world share one amount (coverShader). */
import * as THREE from 'three';

/** Make a material show snow and mud: u = { snow: { value: 0..1 }, mud: { value: 0..1 }, ground: { value: y } } (the
    ground's height under the thing, for how high the mud reaches). */
export function coverShader(m, u, key = '') {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = u.snow; sh.uniforms.uMud = u.mud || { value: 0 }; sh.uniforms.uGround = u.ground || { value: -1e5 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoverN;\nvarying vec3 vCoverP;\nvarying float vCoverY;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvCoverP = transformed;\nvCoverY = (modelMatrix * vec4(transformed, 1.0)).y;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvCoverN = inverseTransformDirection(transformedNormal, viewMatrix);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uSnow;
uniform float uMud;
uniform float uGround;
varying vec3 vCoverN;
varying vec3 vCoverP;
varying float vCoverY;
float cvH(vec3 q) { return fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float cvN(vec3 p) {   // (smooth noise, for soft-edged patches)
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cvH(i), cvH(i + vec3(1, 0, 0)), f.x), mix(cvH(i + vec3(0, 1, 0)), cvH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cvH(i + vec3(0, 0, 1)), cvH(i + vec3(1, 0, 1)), f.x), mix(cvH(i + vec3(0, 1, 1)), cvH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float snowHere = 0.0; float mudHere = 0.0;
if (uMud > 0.001) {
  float low = 1.0 - smoothstep(0.1, 1.1, vCoverY - uGround);   // (thick down by the wheels and boots, just spatters higher up)
  float spat = cvN(vCoverP * 23.0) * 0.6 + cvN(vCoverP * 61.0) * 0.4;
  mudHere = smoothstep(0.0, 0.12, uMud * (0.14 + low * 1.4) - spat * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.135, 0.085) * (0.8 + spat * 0.4), mudHere * 0.95);
}
if (uSnow > 0.001) {
  float up = smoothstep(0.2, 0.75, normalize(vCoverN).y);
  float grain = cvN(vCoverP * 11.0) * 0.65 + cvN(vCoverP * 29.0) * 0.35;
  snowHere = up * smoothstep(0.0, 0.18, uSnow * 1.6 - grain * 0.75);   // (patches first, then a covering)
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), snowHere * 0.92);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, snowHere);\nroughnessFactor = mix(roughnessFactor, 0.55, mudHere * 0.6);   // (wet mud shines a little)');
  };
  m.customProgramCacheKey = () => 'cover-' + key;
}

/** Snow and mud for one rider (parts: the groups to cover: the rider, the bike or board). snow and mud: 0..1; set
    ground each frame (the height of the ground under them). */
export function coverModel(parts) {
  const u = { snow: { value: 0 }, mud: { value: 0 }, ground: { value: 0 } }; const made = [];
  const one = (o, m) => {
    if (!m || !m.isMeshStandardMaterial) return m;
    const c = m.clone(); made.push(c); if (!o.userData.shared) m.dispose();
    coverShader(c, u, m.customProgramCacheKey());
    return c;
  };
  for (const part of parts) if (part) part.traverseVisible((o) => {   // (not the hidden bike under a snowboard)
    if (!o.isMesh || o.userData.covered) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => one(o, m)) : one(o, o.material); o.userData.covered = true;
  });
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return {
    get snow() { return u.snow.value; }, set snow(v) { u.snow.value = clamp(v); },
    get mud() { return u.mud.value; }, set mud(v) { u.mud.value = clamp(v); },
    set ground(y) { u.ground.value = y; },
    dispose() { made.forEach((m) => m.dispose()); },
  };
}
