/* Race-track light, colour finish and clouds. Rendering only: does not change a map, collision mesh or vehicle.
   The ground, scenery and banners: race-look.js. */
import * as THREE from 'three';

/** Each track's light, with its own character (the THEMES entry in world.js is the fallback):
    - Desert Dunes: a hard high midday sun, warm dusty air, deep short shadows;
    - Forest Mud: a lower sun slanting through tall pines, cool green shade and a damp haze;
    - Snow Ridge: a cold low sun at the end of the day, pink-gold light on the snow and blue shadows. */
const LIGHT = {
  desert: { sun: [58, 125], turbidity: 3.4, rayleigh: 1.25, mie: 0.004, mieG: 0.82, sunColor: '#fff0da', sunI: 3.9,
    hemi: ['#c6daf2', '#b08b62', 0.42], envI: 0.42, exposure: 0.5, fog: '#ddcdb2', fogD: 0.00058 },
  forest: { sun: [33, 212], turbidity: 5.5, rayleigh: 2.0, mie: 0.007, mieG: 0.84, sunColor: '#ffe8c4', sunI: 3.2,
    hemi: ['#b7c9d4', '#4b4630', 0.8], envI: 0.62, exposure: 0.58, fog: '#a8b7ab', fogD: 0.00125 },
  snow: { sun: [10, 248], turbidity: 4.2, rayleigh: 2.5, mie: 0.005, mieG: 0.8, sunColor: '#ffd3a6', sunI: 3.0,
    hemi: ['#a9bde8', '#959cbc', 0.62], envI: 0.5, exposure: 0.47, fog: '#b9bfd8', fogD: 0.0009 },
};
/** The track's daylight: its own settings over the theme's. */
export function raceDaylight(theme, original) {
  return { ...original, ...(LIGHT[theme] || {}) };
}
/** The colour finish and air for each track (scene.userData.look, read by post.js): saturation, contrast, warm
    highlights, cool shadows, how far the haze reaches and its tint. */
export function raceLook(theme, fogD) {
  const base = { hazeBase: 0, hazeH: 420, hazeD: fogD * 0.55, hazeK: 0.62, fogKeep: 0.35 };
  if (theme === 'desert') return { ...base, hazeD: fogD * 0.7, hazeH: 300, hazeTint: '#fff1dc', sat: 1.03, con: 1.11, warm: 0.05, cool: 0.012 };
  if (theme === 'forest') return { ...base, hazeD: fogD * 0.85, hazeH: 260, hazeTint: '#e8f0e4', sat: 1.05, con: 1.08, warm: 0.02, cool: 0.024 };
  if (theme === 'snow') return { ...base, hazeD: fogD * 0.6, hazeH: 500, hazeTint: '#f0e8f4', sat: 1.06, con: 1.06, warm: 0.035, cool: 0.03 };
  return base;
}

/** A light broken cloud layer, separate from the physical sky and its lighting. */
export function addRaceClouds(scene, sunDirection) {
  const material = new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: sunDirection } },
    side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 sunDirection; varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDirection);
        vec2 p = d.xz / (max(d.y, 0.0) + 0.1) * 1.25;   // (smooth all the way down: a clamp here drew streaks under the clouds)
        float n = noise(p) * 0.57 + noise(p * 2.1 + 13.0) * 0.28 + noise(p * 4.3 + 7.0) * 0.15;
        float a = smoothstep(0.49, 0.69, n) * smoothstep(0.04, 0.22, d.y) * 0.82;
        float light = smoothstep(0.48, 0.78, n);
        vec3 c = mix(vec3(0.78, 0.83, 0.89), vec3(1.65, 1.62, 1.55), light);
        c += pow(max(0.0, dot(d, sunDirection)), 12.0) * 0.18;
        vec3 sky = mix(vec3(0.65, 0.8, 0.95), vec3(0.15, 0.4, 0.72), pow(max(d.y, 0.0), 0.45));
        sky += vec3(1.0, 0.85, 0.62) * pow(max(0.0, dot(d, sunDirection)), 700.0) * 3.0;
        gl_FragColor = vec4(mix(sky, c, a), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), material);
  clouds.onBeforeRender = (_renderer, _scene, camera) => { clouds.position.copy(camera.position); clouds.updateMatrixWorld(); };
  clouds.renderOrder = -1;
  clouds.frustumCulled = false;
  scene.add(clouds);
}
