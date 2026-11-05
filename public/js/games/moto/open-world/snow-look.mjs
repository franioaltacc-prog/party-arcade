/** Real-looking snow (a world's "look": {"snowLook": {...}}), laid over the terrain material (materials.mjs):
 *  - wind-packed and powder: the wind scours some stretches into hard, smooth, slightly blue-grey crust carved with
 *    sastrugi (long ridges running with the wind), and drifts soft bright powder into the rest;
 *  - sparkle: single grains catching the sun (each one tilted its own way, so which ones flash changes as you move),
 *    only where the sun reaches, never in shadow;
 *  - the light of a snowfield: shadows lit by the blue sky (cool, soft blue), sunlit snow a touch warm.
 *  Optional settings: wind (° the wind blows towards, default 35), packed (0..1, how much of the ground is crust,
 *  default .5), sastrugi (ridge strength, default 1), sparkle (default 1), shade [r, g, b] (the shadows' tint),
 *  sun [r, g, b] (the sunlit snow's tint).
 */
import * as THREE from 'three';

export function snowLook(material, map, { near = true, quality = 1 } = {}) {
  const S = map.look?.snowLook && typeof map.look.snowLook === 'object' ? map.look.snowLook : {};
  const wind = THREE.MathUtils.degToRad(S.wind ?? 35);
  const U = {
    uSnWind: { value: new THREE.Vector2(Math.cos(wind), Math.sin(wind)) },
    uSnPacked: { value: S.packed ?? .5 },
    uSnRidge: { value: (S.sastrugi ?? 1) * (near ? 1 : 0) },
    uSnSparkle: { value: (S.sparkle ?? 1) * (near ? 1 : 0) * (quality > .3 ? 1 : 0) },
    uSnShade: { value: new THREE.Vector3(...(S.shade || [.86, .93, 1.08])) },
    uSnSun: { value: new THREE.Vector3(...(S.sun || [1.1, 1.06, 1.0])) },
  };
  const before = material.onBeforeCompile, key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, U);
    // (our sparkle takes over from the old square specks)
    shader.fragmentShader = shader.fragmentShader.replace('totalEmissiveRadiance+=vec3(.9,.95,1.0)*owGlint', 'totalEmissiveRadiance+=0.0*vec3(.9,.95,1.0)*owGlint');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec2 uSnWind; uniform float uSnPacked, uSnRidge, uSnSparkle; uniform vec3 uSnShade, uSnSun;
float snHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float snNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = snHash(vec3(i, 0.0)), b = snHash(vec3(i + vec2(1.0, 0.0), 0.0)), c = snHash(vec3(i + vec2(0.0, 1.0), 0.0)), d = snHash(vec3(i + 1.0, 0.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float snPack = 0.0;`)
      .replace('#include <emissivemap_fragment>', `
{ // wind-packed crust or soft powder: big patches, stretched along the wind
  vec2 snW = uSnWind, snA = vec2(dot(owPosition.xz, snW), dot(owPosition.xz, vec2(-snW.y, snW.x)));
  float snF = snNoise(snA * vec2(.006, .016)) * .65 + snNoise(snA * vec2(.019, .05) + 7.3) * .35;
  snPack = smoothstep(.62 - uSnPacked * .3, .78 - uSnPacked * .3, snF) * owSnow * (1.0 - owCliff) * (1.0 - smoothstep(.2, .7, owTrail));
  float snDist = length(cameraPosition - owPosition);
  // sastrugi: ridges across the wind, wavering, each run fading in and out (only close by: further off they're specks)
  float snR = .5 + .5 * sin(snA.y * 1.15 + 2.4 * sin(snA.x * .07) + 1.3 * sin(snA.x * .023 + snA.y * .04));
  snR = pow(snR, 3.0) * (.55 + .45 * sin(snA.x * .31 + snA.y * .11));
  float snRelief = snR * .6 * snPack * uSnRidge * smoothstep(80.0, 15.0, snDist);
  if (uSnRidge > 0.0) normal = owBump(-vViewPosition, normal, vec2(dFdx(snRelief), dFdy(snRelief)));
  // (crust: a little greyer-blue and smoother, with a sheen at a low angle; powder: the brightest, softest white)
  diffuseColor.rgb *= mix(vec3(1.025, 1.025, 1.02), vec3(.86, .91, .98), snPack * owSnow);
  diffuseColor.rgb *= 1.0 + (snNoise(owPosition.xz * .0035) - .5) * .06 * owSnow;   // (drifts: the far slopes not all one white)
  roughnessFactor = mix(roughnessFactor, .42, snPack * .85);
}
#include <emissivemap_fragment>`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
if (owSnow > .01) {
  float snLit = 1.0;
#if NUM_DIR_LIGHTS > 0
  { // how much of the sun reaches here (shadowed or not), from what it lit
    vec3 L = directionalLights[0].direction; float nl = max(dot(normal, L), 0.0);
    vec3 full = nl * directionalLights[0].color * material.diffuseColor * RECIPROCAL_PI;
    snLit = clamp(dot(reflectedLight.directDiffuse, vec3(1.0)) / max(dot(full, vec3(1.0)), 1e-4), 0.0, 1.0);
    // sparkle: the odd grain, tilted its own way, flashes the sun at you (smaller grains close by, bigger further off)
    float d = length(vViewPosition);
    if (uSnSparkle > 0.0 && d < 70.0 && owCliff < .5) {
      float cell = mix(.035, .16, smoothstep(4.0, 60.0, d));
      vec3 g = floor(owPosition / cell);
      vec3 gn = normalize(vec3(snHash(g) - .5, .9, snHash(g + 17.0) - .5));
      vec3 gV = normalize((viewMatrix * vec4(gn, 0.0)).xyz), H = normalize(L + normalize(vViewPosition));
      float glint = pow(max(dot(gV, H), 0.0), 900.0) * step(.55, snHash(g + 31.0));
      reflectedLight.directSpecular += directionalLights[0].color * glint * 9.0 * snLit * uSnSparkle * owSnow * (1.0 - owTrail * .7) * smoothstep(70.0, 25.0, d);
    }
  }
#endif
  // the light of a snowfield: what the sun misses is lit by the blue sky (cool blue shadows), the sunlit snow a touch warm
  reflectedLight.indirectDiffuse *= mix(vec3(1.0), uSnShade, owSnow);
  reflectedLight.directDiffuse *= mix(vec3(1.0), uSnSun, owSnow * snLit);
}`);
  };
  material.customProgramCacheKey = () => (key ? key.call(material) : '') + '-snowlook' + (near ? 'n' : 'f') + (U.uSnSparkle.value > 0 ? 's' : '');
  material.needsUpdate = true;
  return U;
}
