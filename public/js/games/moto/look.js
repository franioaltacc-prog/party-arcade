/* The shared "real camera" look for Revvd's worlds and race tracks.
   - Sky light from a photographed sky (image-based lighting): Poly Haven's Kloofendal 43d Clear Pure Sky (CC0), turned
     into the soft all-round light and reflections of a real blue sky. Its sun is clipped out (the game's own sun, a
     directional light with shadows, does that job), and it's turned so its bright side matches the game's sun.
   - Scanned soil: Poly Haven's Red Laterite Soil Stones (CC0): colour, a normal map, and ambient occlusion, roughness
     and height packed into one picture (R, G, B). 2048² on high quality, 1024² otherwise.
   See public/assets/moto-realism/SOURCES.md. Every file is hosted on this site. */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const BASE = '/assets/moto-realism/';
/** Set by the game from the quality setting before a world is built: hi (2048² soil, relief) and the renderer. */
export const LOOK = { hi: true, pom: true, renderer: null };
let skyLoad = null;

/** The photographed sky as an environment map (a promise, made once): { env, angle } (angle: its sun's direction round). */
export function loadSkyEnv(renderer) {
  if (skyLoad) return skyLoad;
  skyLoad = new RGBELoader().setDataType(THREE.FloatType).loadAsync(BASE + 'sky-clear-1k.hdr').then((tex) => {
    const { data, width, height } = tex.image; let best = 0, at = 0;
    for (let i = 0; i < width * height; i++) { const l = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722; if (l > best) { best = l; at = i; } }
    // (clip the sun and its bright halo: what's left is the blue sky's light)
    const cap = 3.2;
    for (let i = 0; i < width * height; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], m = Math.max(r, g, b); if (m > cap) { const k = cap / m; data[i * 4] = r * k; data[i * 4 + 1] = g * k; data[i * 4 + 2] = b * k; } }
    const u = ((at % width) + 0.5) / width;
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.needsUpdate = true;
    const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
    return { env, angle: (u - 0.5) * Math.PI * 2 };
  }).catch((e) => { skyLoad = null; throw e; });
  return skyLoad;
}

/** Light a scene with the photographed sky once it's loaded (till then, whatever environment it has). sunDir: the
    game's sun. Returns a function that stops it if the world goes first. */
export function useSkyEnv(scene, renderer, sunDir, intensity) {
  let gone = false; const before = scene.environment;
  loadSkyEnv(renderer).then(({ env, angle }) => {
    if (gone) return;
    scene.environment = env; scene.environmentIntensity = intensity;
    scene.environmentRotation.set(0, Math.atan2(sunDir.z, sunDir.x) - angle, 0);
    if (before && before !== env) before.dispose();
  }).catch((e) => console.warn('sky light', e));
  return () => { gone = true; };
}

const soils = new Map();
/** The scanned soil's textures, shared: { color, normal, orh, ready (a promise) }. srgb: colour decoded to linear by
    the graphics card (else raw, for shaders that do it themselves). */
export function soilTextures(renderer, { hi = true, srgb = false } = {}) {
  const key = (hi ? 'hi' : 'lo') + (srgb ? '-srgb' : '');
  if (soils.has(key)) return soils.get(key);
  const loader = new THREE.TextureLoader(), suffix = hi ? '' : '-1k', aniso = Math.min(hi ? 16 : 8, (renderer || LOOK.renderer)?.capabilities.getMaxAnisotropy() || 4);
  const load = (name, colour) => new Promise((ok, no) => {
    const t = loader.load(BASE + name + suffix + '.webp', () => ok(t), undefined, no);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = colour && srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  });
  const out = { color: null, normal: null, orh: null, loaded: false };
  out.ready = Promise.all([load('soil-color', true), load('soil-normal'), load('soil-orh')]).then(([c, n, o]) => {
    Object.assign(out, { color: c, normal: n, orh: o, loaded: true }); return out;
  }).catch((e) => { soils.delete(key); throw e; });
  soils.set(key, out);
  return out;
}

/** GLSL: the soil sampled two ways and blended (a fine 2.4 m tile close by, a bigger turned one further out, so it's
    crisp under the wheels and never shows a repeat across a hillside), with steep-parallax relief close by (high
    quality: the clods and stones stand up from the surface as you move). Needs uniforms soilC, soilN, soilO, soilPOM. */
export const SOIL_GLSL = `
uniform sampler2D soilC, soilN, soilO; uniform float soilPOM; uniform vec3 soilTint;
struct Soil { vec3 albedo; vec3 n; float ao; float rough; float h; };
vec2 soilRot(vec2 p) { return mat2(0.8, -0.6, 0.6, 0.8) * p; }
// steep parallax on the fine tile: march down the view ray through the height field (stones stand proud)
vec2 soilParallax(vec2 uv, vec3 vts, float k) {
  if (k <= 0.001) return uv;
  const int STEPS = 12; float layer = 1.0 / float(STEPS);
  vec2 dir = vts.xy / max(vts.z, 0.25) * 0.022 * k;
  float depth = 0.0; vec2 cur = uv; float h = 1.0 - texture2D(soilO, cur).b;
  vec2 prev = cur; float prevH = h, prevD = 0.0;
  for (int i = 0; i < STEPS; i++) {
    if (depth >= h) break;
    prev = cur; prevH = h; prevD = depth;
    cur -= dir * layer; depth += layer; h = 1.0 - texture2D(soilO, cur).b;
  }
  float a = h - depth, b = prevH - prevD; float t = a / (a - b + 1e-5);
  return mix(cur, prev, t);
}
Soil soilAt(vec3 wp, vec3 nW, vec3 eye, float dist) {
  vec2 p = wp.xz;
  vec2 uvA = p / 2.4, uvB = soilRot(p) / 9.5 + vec2(0.37, 0.61);
  // (the view in the fine tile's frame: x along world x, y along world z, z up the surface)
  vec3 V = normalize(eye - wp); vec3 vts = vec3(V.x, V.z, max(dot(V, nW), 0.05));
  uvA = soilParallax(uvA, vts, soilPOM * (1.0 - smoothstep(6.0, 16.0, dist)));
  vec4 cA = texture2D(soilC, uvA), cB = texture2D(soilC, uvB);
  vec4 oA = texture2D(soilO, uvA), oB = texture2D(soilO, uvB);
  vec3 nA = texture2D(soilN, uvA).xyz * 2.0 - 1.0, nB = texture2D(soilN, uvB).xyz * 2.0 - 1.0;
  float far = smoothstep(7.0, 45.0, dist);
  // the big tile's own height decides where its lumps show through the fine one (a height blend, not a cross-fade)
  float hb = clamp((oB.b - oA.b) * 2.0 + (far - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  Soil s;
  s.albedo = mix(cA.rgb, cB.rgb, hb) * soilTint;
  s.h = mix(oA.b, oB.b, hb);
  s.albedo *= mix(0.6, 1.08, smoothstep(0.02, 0.55, s.h));   // (crumbs and clods catch the light, the gaps between them are in shade)
  s.ao = mix(oA.r, oB.r, hb); s.rough = mix(oA.g, oB.g, hb);
  vec3 nt = normalize(vec3(mix(nA.xy, nB.xy * 0.8, hb) * 1.7, 1.0));
  // tangent frame from the world: x along the texture's u, z along its v, kept on the surface
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - nW * nW.x), B = normalize(vec3(0.0, 0.0, 1.0) - nW * nW.z);
  s.n = normalize(T * nt.x + B * nt.y + nW * nt.z);
  return s;
}
// (on steep cut banks: the soil's colour, occlusion and height projected from all three sides)
vec4 soilTri(vec3 wp, vec3 w, out float ao) {
  vec3 p = wp / 2.4;
  vec4 c = texture2D(soilC, p.zy) * w.x + texture2D(soilC, p.xz) * w.y + texture2D(soilC, p.xy) * w.z;
  vec4 o = texture2D(soilO, p.zy) * w.x + texture2D(soilO, p.xz) * w.y + texture2D(soilO, p.xy) * w.z;
  ao = o.r; return vec4(c.rgb * soilTint, o.b);
}
`;
