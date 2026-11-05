/** The sea (a world with "sea"): the water you see, worked out on the graphics card from the same Gerstner waves the
 * jet skis ride on (terrain.mjs waveAt), on a disc of water centred on you (fine close by, coarser out to the horizon).
 * It's see-through: clear and turquoise over the sand in the shallows, deepening to dark blue (how deep it is under
 * each point comes from a picture of the seabed), the sky mirrored in it (more at a glancing angle, as real water
 * does), the sun glinting off it, small ripples moving over the waves, light glowing through the crests, foam where
 * a crest breaks, along the beaches and in every jet ski's wake (wakes: a picture of the foam round you, redrawn
 * each frame from where the jet skis have been). Also the buoys, piers and the lighthouse ("features": { buoys,
 * piers, lighthouse }), bobbing on the same waves.
 * 3.25: the foam is lace (the bubbly cells real foam makes, drawn here), whitecaps break on the crests where the wind
 * blows them ("sea": {"whitecaps": 0..1}), breakers roll in over the shallows as lines of foam, the water washes up
 * and back down the beach ("swash": metres), and the colour runs turquoise over sand, through a green-blue, to deep
 * blue. A wooden pier has planks, rails and posts. Lakes use the same water (lakeWater in shore.mjs): calm wind chop,
 * clipped to the lake's shore. */
import * as THREE from 'three';
import {seaClock, seaLight} from './materials.mjs';

const MAXW = 8;

/** A tileable picture of small ripples, as a normal map (drawn here). */
function rippleTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
  const H = (u, v) => { let h = 0; const waves = [[3, 2, .5, .3], [5, -3, .35, 1.7], [-7, 4, .22, 4.1], [9, 7, .15, 2.2], [-11, -9, .1, .7], [14, -5, .07, 5.3], [-17, 13, .05, 3.9]];
    for (const [a, b, amp, ph] of waves) h += amp * Math.sin(6.2832 * (a * u + b * v) + ph); return h; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, dx = (H(u + 1 / N, v) - H(u - 1 / N, v)) * 2.2, dy = (H(u, v + 1 / N) - H(u, v - 1 / N)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    img.data[i] = (-dx / l * .5 + .5) * 255; img.data[i + 1] = (-dy / l * .5 + .5) * 255; img.data[i + 2] = (1 / l * .5 + .5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
/** Tileable foam: R the lace (the bright walls between bubbles of all sizes, as real foam on water looks), G big soft
    patches (where foam gathers and where it's thin). Drawn here from cells (Worley noise), no picture files. */
function foamTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
  let s = 41; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const layer = (n) => { const pts = []; for (let i = 0; i < n; i++) pts.push([r(), r(), .6 + r() * .4]); return pts; };
  const fine = layer(220), mid = layer(70), big = layer(9);
  const cell = (pts, u, v) => { let d1 = 9, d2 = 9; for (const [x, y, w] of pts) { let dx = Math.abs(u - x), dy = Math.abs(v - y); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy); const d = Math.hypot(dx, dy) / w; if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return [d1, d2]; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, [a1, a2] = cell(fine, u, v), [b1, b2] = cell(mid, u, v), [c1] = cell(big, u, v);
    const wallF = Math.max(0, 1 - (a2 - a1) * 38), wallM = Math.max(0, 1 - (b2 - b1) * 16);
    const lace = Math.min(1, wallF * .75 + wallM * .8 + Math.max(0, .5 - b1 * 7) * .5);
    const patch = Math.min(1, Math.max(0, 1.25 - c1 * 4.2));
    const i = (y * N + x) * 4; img.data[i] = lace * 255; img.data[i + 1] = patch * 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}
/** Planks for a pier's deck: boards across, weathered grey-brown, dark gaps between (tiles along the pier). */
function plankTexture() {
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = 9; const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 0; y < H; y += 16) {
    const k = .78 + r() * .3; g.fillStyle = `rgb(${Math.round(132 * k)},${Math.round(108 * k)},${Math.round(82 * k)})`; g.fillRect(0, y, W, 16);
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < .5 ? 'rgba(60,45,30,.18)' : 'rgba(220,210,190,.12)'; g.fillRect(r() * W, y + 1 + r() * 14, 8 + r() * 40, 1); }
    g.fillStyle = 'rgba(25,18,12,.85)'; g.fillRect(0, y + 14.5, W, 1.5);
    for (const nx of [10, W - 12]) { g.fillStyle = 'rgba(40,40,40,.7)'; g.fillRect(nx, y + 6, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** lake: { level, position [x, z], radius [rx, rz], waves [[wavelength m, height m, direction °]…], shallow, deep,
    clear, whitecaps, swash }: a lake's water instead of the sea (calm, its own clock, only inside the lake's shore). */
export function createOcean(terrain, scene, map, { quality = 1, dark = false, lake = null } = {}) {
  const sea = lake || terrain.sea, W = map.size[0], D = map.size[1], disposables = [], group = new THREE.Group(); scene.add(group);
  // ---------------------------------------------------------------- how deep it is: a picture of the seabed (or lake bed)
  const BN = lake ? 384 : 512, bed = new Float32Array(BN * BN), half = new Uint16Array(BN * BN);
  const BX = lake ? lake.position[0] - lake.radius[0] * 1.4 : -W / 2, BZ = lake ? lake.position[1] - lake.radius[1] * 1.4 : -D / 2;
  const BW = lake ? lake.radius[0] * 2.8 : W, BD = lake ? lake.radius[1] * 2.8 : D;
  const bedAt = lake ? (x, z) => terrain.heightAt(x, z) : (x, z) => terrain.bedAt(x, z);
  for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) bed[j * BN + i] = bedAt(BX + BW * (i + .5) / BN, BZ + BD * (j + .5) / BN);
  for (let k = 0; k < bed.length; k++) half[k] = THREE.DataUtils.toHalfFloat(bed[k]);
  const bedTex = new THREE.DataTexture(half, BN, BN, THREE.RedFormat, THREE.HalfFloatType); bedTex.magFilter = bedTex.minFilter = THREE.LinearFilter; bedTex.needsUpdate = true; disposables.push(bedTex);
  // ---------------------------------------------------------------- the wakes: foam drawn round you each frame
  const WN = 512, WS = 300, wakeCanvas = document.createElement('canvas'); wakeCanvas.width = wakeCanvas.height = WN; const wg = wakeCanvas.getContext('2d');
  const wakeTex = new THREE.CanvasTexture(wakeCanvas); wakeTex.colorSpace = THREE.NoColorSpace; disposables.push(wakeTex);
  const trails = new Map();   // id -> [{x, z, h, v, t}]
  // ---------------------------------------------------------------- the water: a disc of rings round you
  // (rings 0.5 m apart close by, growing by 4.5% each, out to 3 km; then one last ring far beyond the horizon)
  const radii = []; for (let r = .5, step = .5; r < 3000; step *= 1.045 + .015 * (1 - quality), r += step) radii.push(r);
  radii.push(30000);
  const rings = radii.length, segs = Math.round(160 + 96 * quality), p = [], idx = [];
  p.push(0, 0, 0);
  for (const rad of radii) for (let s2 = 0; s2 < segs; s2++) { const a = s2 / segs * Math.PI * 2; p.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); }
  for (let s2 = 0; s2 < segs; s2++) idx.push(0, 1 + (s2 + 1) % segs, 1 + s2);
  for (let r = 1; r < rings; r++) for (let s2 = 0; s2 < segs; s2++) { const a = 1 + (r - 1) * segs + s2, b = 1 + (r - 1) * segs + (s2 + 1) % segs, c = a + segs, d = b + segs; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); geo.setIndex(idx); disposables.push(geo);
  const ripple = rippleTexture(), foam = foamTexture(); ripple.anisotropy = foam.anisotropy = 8; disposables.push(ripple, foam);
  let waves = terrain.waves || [];
  if (lake) {   // (a lake's wind chop: short, low waves, the same kind as the sea's)
    waves = (lake.waves || [[11, .035, 30], [6.5, .022, -25], [4.2, .012, 75]]).map(([L, A, deg]) => { const k = 2 * Math.PI / L, a = deg * Math.PI / 180; return { k, A, dx: Math.cos(a), dz: Math.sin(a), w: Math.sqrt(9.81 * k) }; });
    for (const w of waves) w.Q = .6 / (w.k * w.A * waves.length);
  }
  waves = waves.slice(0, MAXW);
  const amp = waves.reduce((a, w) => a + w.A, 0);
  const u = {
    uTime: seaClock, uCenter: { value: new THREE.Vector2() }, uLevel: { value: sea.level },
    uWaveA: { value: Array.from({ length: MAXW }, (_, i) => waves[i] ? new THREE.Vector4(waves[i].dx, waves[i].dz, waves[i].k, waves[i].A) : new THREE.Vector4()) },
    uWaveB: { value: Array.from({ length: MAXW }, (_, i) => waves[i] ? new THREE.Vector2(waves[i].Q, waves[i].w) : new THREE.Vector2()) },
    uBed: { value: bedTex }, uBox: { value: new THREE.Vector4(BX, BZ, BW, BD) },
    uAmp: { value: Math.max(.05, amp) }, uWhite: { value: sea.whitecaps ?? (lake ? .15 : .55) }, uSwash: { value: sea.swash ?? (lake ? .12 : .32) }, uEdge: { value: lake ? .15 : .3 }, uFlat: { value: sea.flat ?? (lake ? .9 : .3) }, uScatter: { value: sea.scatter ?? .1 }, uDetail: { value: sea.detail ?? (lake ? .35 : 1) },
    uClip: { value: lake ? new THREE.Vector4(lake.position[0], lake.position[1], lake.radius[0] * 1.12, lake.radius[1] * 1.12) : new THREE.Vector4() },
    uSwell: { value: new THREE.Vector3(...(sea.swell || [0, 1, 1])) },
    uRipple: { value: ripple }, uFoam: { value: foam }, uWake: { value: wakeTex }, uWakeBox: { value: new THREE.Vector3(0, 0, WS) },
    uLight: seaLight, uShallow: { value: new THREE.Color(sea.shallow || '#35c2b8') }, uDeep: { value: new THREE.Color(sea.deep || '#0a3550') }, uClear: { value: sea.clear ?? .28 },
    // the far shore mirrored in the water: reflections leaving lower than shoreRefl.angle (radians above the
    // horizontal) hit the hills round a lake instead of the sky: { color, angle, k }
    uShoreC: { value: new THREE.Color(sea.shoreRefl?.color || '#33452f') }, uShoreA: { value: new THREE.Vector2(sea.shoreRefl?.angle ?? .1, sea.shoreRefl?.k ?? (lake ? .85 : 0)) },
    uMid: { value: new THREE.Color(sea.mid || new THREE.Color(sea.shallow || '#35c2b8').lerp(new THREE.Color(sea.deep || '#0a3550'), .42).offsetHSL(-.02, .12, .02)) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .06, metalness: 0, transparent: true, envMapIntensity: .95 });
  disposables.push(mat);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    const common = `
uniform float uTime; uniform vec2 uCenter; uniform float uLevel; uniform vec4 uWaveA[${MAXW}]; uniform vec2 uWaveB[${MAXW}];
uniform sampler2D uBed; uniform vec4 uBox; uniform vec3 uSwell; uniform float uAmp, uWhite, uSwash, uEdge; uniform vec4 uClip;
varying vec3 vSeaPos; varying vec2 vSeaGrid; varying float vSeaH;
// the water running up the beach and back: a slow surge, its timing changing along the shore
float seaSwash(vec2 p, float depth) { float k = 1.0 - smoothstep(-.6, 2.2, depth);
  return k * uSwash * (sin(uTime * .85 + p.x * .021 + p.y * .017 + sin(p.x * .013 - p.y * .009) * 2.0) * .6 + .4); }
float seaBed(vec2 p) { return texture2D(uBed, (p - uBox.xy) / uBox.zw).r; }
float seaScale(vec2 p, float bed) { float depth = uLevel - bed; float s = smoothstep(.3, 3.5, depth);
  return s * (1.0 + (uSwell.z - 1.0) * smoothstep(uSwell.x, uSwell.y, p.y)); }`;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + common)
      .replace('#include <beginnormal_vertex>', `
vec2 seaP = position.xz + uCenter; float seaB = seaBed(seaP); float seaF = seaScale(seaP, seaB);
vec3 seaD = vec3(0.0); vec3 seaN = vec3(0.0, 1.0, 0.0); float seaJ = 1.0;
float seaSp = .5 + length(seaP - cameraPosition.xz) * .05;   // (how far apart the water's points are here: waves too short for that fade out)
for (int i = 0; i < ${MAXW}; i++) {
  vec4 a = uWaveA[i]; vec2 b = uWaveB[i]; if (a.w <= 0.0) continue;
  float th = a.z * dot(a.xy, seaP) - b.y * uTime; float A = a.w * seaF * smoothstep(3.0 * seaSp, 6.0 * seaSp, 6.2832 / a.z); float c = cos(th), s = sin(th);
  seaD += vec3(b.x * A * a.x * c, A * s, b.x * A * a.y * c);
  seaN -= vec3(a.x * a.z * A * c, b.x * a.z * A * s, a.y * a.z * A * c);
  seaJ -= b.x * a.z * A * s;
}
vec3 objectNormal = normalize(seaN);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif`)
      .replace('#include <begin_vertex>', `
vec3 transformed = vec3(seaP.x + seaD.x, uLevel + seaD.y + seaSwash(seaP, uLevel - seaB), seaP.y + seaD.z);
vSeaPos = transformed; vSeaGrid = seaP; vSeaH = seaD.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + common + `
uniform sampler2D uRipple; uniform sampler2D uFoam; uniform sampler2D uWake; uniform vec3 uWakeBox;
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uMid; uniform float uClear, uLight; uniform vec3 uShoreC; uniform vec2 uShoreA; uniform float uScatter, uDetail, uFlat;
float seaFoam = 0.0; float seaJ = 1.0; float seaHt = 0.0; float seaFp = 1.0;
const vec4 SEA_DETAIL[10] = vec4[10](vec4(-0.447, 0.894, 1.963, 4.389), vec4(0.583, 0.812, 2.442, 4.894), vec4(-0.583, -0.812, 3.036, 5.458), vec4(0.898, 0.440, 3.776, 6.086), vec4(-0.975, -0.224, 4.695, 6.787), vec4(-0.665, 0.747, 5.839, 7.568), vec4(0.934, 0.356, 7.261, 8.440), vec4(-0.999, -0.047, 9.029, 9.411), vec4(0.972, 0.233, 11.228, 10.495), vec4(-0.914, 0.405, 13.963, 11.704)); vec3 seaNW = vec3(0.0, 1.0, 0.0);
// the waves' slope and how folded they are (seaJ: under ~.3 a crest is breaking), worked out for every pixel from the
// water's undisturbed position (so it's smooth however coarse the mesh), each wave fading out where it's too small
// on screen to draw
void seaShade(vec2 g) {
  vec3 e = cameraPosition - vec3(g.x, uLevel, g.y); float dist = length(e);
  // (a pixel's size on the water: smooth, unlike the mesh's own)
  float fp = dist * .0016 / max(.12, abs(e.y) / dist); float f = seaScale(g, seaBed(g)); vec3 n = vec3(0.0, 1.0, 0.0); float j = 1.0; float h = 0.0;
  for (int i = 0; i < ${MAXW}; i++) {
    vec4 a = uWaveA[i]; vec2 b = uWaveB[i]; if (a.w <= 0.0) continue;
    float A = a.w * f * smoothstep(2.0 * fp, 7.0 * fp, 6.2832 / a.z); float th = a.z * dot(a.xy, g) - b.y * uTime; float c = cos(th), s = sin(th);
    n -= vec3(a.x * a.z * A * c, b.x * a.z * A * s, a.y * a.z * A * c); j -= b.x * a.z * A * s; h += A * s;
  }
  // small waves on top (ripples, wavelengths 3.2 m down to 45 cm, every which way), only their slope, each fading
  // out where it'd be smaller than a few pixels
  for (int i = 0; i < 10; i++) {
    vec4 d = SEA_DETAIL[i]; float L = 6.2832 / d.z;
    float s = .06 * uDetail * smoothstep(2.0 * fp, 6.0 * fp, L) * (1.0 - .4 * float(i) / 9.0);
    float c = cos(d.z * dot(d.xy, g) - d.w * uTime + float(i) * 1.7);
    n -= vec3(d.x * s * c, 0.0, d.y * s * c);
  }
  seaNW = normalize(n); seaJ = j; seaHt = h; seaFp = fp;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
seaShade(vSeaGrid);
vec3 seaSurf = vec3(vSeaPos.x, uLevel + seaHt, vSeaPos.z);   // (the smooth surface here, not the mesh's flat facets: at a glancing angle they'd show)
vec3 seaEye = cameraPosition - seaSurf; float seaDist = length(seaEye); vec3 seaV = seaEye / seaDist;
float seaBedHere = seaBed(vSeaPos.xz); float seaDepth = max(0.0, seaSurf.y + seaSwash(vSeaGrid, uLevel - seaBedHere) - seaBedHere);
// light through water: the further it goes (down and back up at this angle), the more of the shallow colour turns deep
float seaPath = seaDepth / max(.18, seaV.y) * uClear;
float seaThick = 1.0 - exp(-seaPath);
if (uClip.z > 0.0 && length((vSeaPos.xz - uClip.xy) / uClip.zw) > 1.0) discard;   // (a lake: only inside its shore)
// turquoise over the sand, through a green-blue, to deep blue (and the deep colour richer straight down than across)
float seaK = smoothstep(0.0, 1.0, seaThick * 1.25);
diffuseColor.rgb = mix(mix(uShallow, uMid, smoothstep(0.0, .55, seaK)), uDeep, smoothstep(.45, 1.0, seaK));
diffuseColor.rgb *= mix(1.0, .82, smoothstep(.6, 1.0, seaK) * seaV.y);
diffuseColor.a = mix(.03, .96, smoothstep(0.0, 1.1, seaThick)) * smoothstep(0.0, .25, seaDepth + .05);
// foam: where a crest folds over, along the beaches, and in the wakes
vec2 seaWind = uWaveA[0].xy;   // (the foam streaks along the main swell's way)
vec2 seaFG = vec2(dot(vSeaGrid, seaWind), dot(vSeaGrid, vec2(-seaWind.y, seaWind.x)));
vec4 seaT1 = texture2D(uFoam, seaFG * vec2(.07, .13) + vec2(uTime * .011, uTime * .004)), seaT2 = texture2D(uFoam, vSeaGrid * .031 - vec2(uTime * .006, uTime * .009));
float seaF1 = seaT1.r, seaF2 = seaT2.r, seaPatch = seaT1.g * .6 + seaT2.g * .6;
float seaFar = smoothstep(.02, .3, seaFp);   // (far off the lace is finer than a pixel: show it as a soft white)
float seaLace = mix(clamp(seaF1 * 1.1 + seaF2 * .45, 0.0, 1.0), .45, seaFar);
// whitecaps: the wind tears the top off the highest crests (the waves' height against their biggest)
float seaTop = seaHt / (uAmp * seaScale(vSeaGrid, seaBed(vSeaGrid)) + .02);
// (and where a crest is pinched sharp, about to tip over)
float seaCap = smoothstep(.2, .5, seaTop) * smoothstep(.74, .46, seaJ) * smoothstep(.3, .7, seaPatch) * uWhite;
float seaCrest = max(smoothstep(.5, .18, seaJ) * seaLace, smoothstep(.2, .5, seaCap * 1.6 * seaLace) * .9);   // (crisp torn lace, not a milky film)
// breakers: lines of foam rolling in over the shallows (each depth contour moving shorewards), then the wash at the
// water's edge and the fizz left behind as it runs back
float seaBand = fract(seaDepth * .55 - uTime * .12 + seaT2.g * .35);
float seaBreak = smoothstep(.0, .04, seaBand) * smoothstep(.2, .04, seaBand) * smoothstep(3.4, 1.2, seaDepth) * smoothstep(.05, .5, seaDepth);
float seaEdge = smoothstep(uEdge, .02, seaDepth);
float seaShore = max(seaBreak * (.55 + seaPatch * .6), seaEdge) * seaLace * 1.25;
vec2 seaWuv = (vSeaPos.xz - uWakeBox.xy) / uWakeBox.z + .5; float seaWake = 0.0;
if (seaWuv.x > 0.0 && seaWuv.x < 1.0 && seaWuv.y > 0.0 && seaWuv.y < 1.0) seaWake = texture2D(uWake, seaWuv).r * (seaF1 * .8 + .45);
seaFoam = clamp(max(max(seaCrest, seaShore), seaWake), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .96, .97), seaFoam);
diffuseColor.a = max(diffuseColor.a, seaFoam * .95);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ // small ripples drifting over the waves (fading out far off, where they'd only shimmer)
  vec2 r1 = texture2D(uRipple, vSeaGrid * .045 + vec2(uTime * .021, uTime * .013)).xy * 2.0 - 1.0;
  vec2 r2 = texture2D(uRipple, vSeaGrid * .17 - vec2(uTime * .03, -uTime * .024)).xy * 2.0 - 1.0;
  float fp = seaFp;
  vec2 rp = r2 * .025 * smoothstep(.12, .03, fp) * (1.0 - seaFoam * .7);   // (a whisper of the finest sparkle, right by you)   // (each fading where it'd only shimmer)
  vec3 nW = normalize(seaNW + vec3(rp.x, 0.0, rp.y));
  // (far off, the ripples average out: the water mirrors more smoothly there, instead of in flickering stripes)
  nW = normalize(mix(nW, vec3(0.0, 1.0, 0.0), max(smoothstep(10.0, 140.0, seaDist), smoothstep(.15, 1.0, seaFp)) * uFlat));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
if (uShoreA.y > 0.0) { // the hills round the water mirrored in it, wavy with the ripples (each bit of shore a little different)
  vec3 nW = inverseTransformDirection(normal, viewMatrix), R = reflect(-seaV, nW);
  float az = atan(R.z, R.x), ridge = uShoreA.x * (.65 + .35 * sin(az * 3.0 + 1.3) * sin(az * 7.0 - .4) + .2 * sin(az * 13.0));
  float occ = 1.0 - smoothstep(ridge * .2, ridge * 1.25, R.y);
  radiance = mix(radiance, uShoreC * (.35 + .65 * uLight) * (.8 + .4 * sin(az * 23.0)), occ * uShoreA.y);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, .75, seaFoam);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// light through the tops of the waves (green-blue), strongest looking towards the light
totalEmissiveRadiance += uShallow * .22 * uLight * smoothstep(-.2, 1.2, seaHt) * (1.0 - seaFoam);
// (sunlight scattered inside the water: the clear turquoise glow of a sunny sea)
totalEmissiveRadiance += uMid * uScatter * uLight * (1.0 - seaFoam) * smoothstep(.0, .25, seaThick) * (1.0 - .6 * smoothstep(.7, 1.0, seaThick));`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
{ // a real water surface mirrors more the flatter you look across it, see-through or not
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  float f = .02 + .98 * pow(1.0 - clamp(dot(nW, seaV), 0.0, 1.0), 5.0);
  gl_FragColor.a = clamp(max(gl_FragColor.a, f * .9), 0.0, 1.0);
}`);
  };
  mat.customProgramCacheKey = () => 'sea-v3' + (lake ? '-lake' : '');
  const water = new THREE.Mesh(geo, mat); water.frustumCulled = false; water.renderOrder = 2; group.add(water);
  // ---------------------------------------------------------------- buoys, piers and the lighthouse
  const F = lake ? {} : map.features || {}, things = [];   // (a lake has none of the sea's things)
  const buoyGeo = new THREE.CylinderGeometry(.42, .55, 1.1, 14).translate(0, .25, 0), capGeo = new THREE.ConeGeometry(.3, .55, 12).translate(0, 1.05, 0); disposables.push(buoyGeo, capGeo);
  const buoyMats = {}; const buoyMat = (c) => buoyMats[c] || (buoyMats[c] = (disposables.push(new THREE.MeshStandardMaterial({ color: c, roughness: .45 })), disposables.at(-1)));
  const buoys = (F.buoys || []).map(([x, z, color = '#ff6a10']) => { const g = new THREE.Group(); g.add(new THREE.Mesh(buoyGeo, buoyMat(color)), new THREE.Mesh(capGeo, buoyMat('#f4f4f4'))); g.children.forEach((m) => { m.castShadow = true; }); group.add(g); return { g, x, z, ph: x * .37 + z * .21 }; });
  const planks = plankTexture(), wood = new THREE.MeshStandardMaterial({ map: planks, roughness: .88 }), post = new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: .95 });
  disposables.push(planks, wood, post);
  for (const [x, z, heading, len, width = 4] of F.piers || []) {
    const pier = new THREE.Group(); pier.position.set(x, sea.level, z); pier.rotation.y = heading; group.add(pier);
    const deckGeo = new THREE.BoxGeometry(width, .22, len).translate(0, 1.5, len / 2), uv = deckGeo.attributes.uv, pos = deckGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) / width + .5) * width / 4, pos.getZ(i) / 4);   // (a 4 m tile of planks across the deck)
    const deck = new THREE.Mesh(deckGeo, wood); deck.castShadow = deck.receiveShadow = true; pier.add(deck); disposables.push(deckGeo);
    const pile = new THREE.CylinderGeometry(.17, .2, 6.4, 10).translate(0, -1.6, 0), beamG = new THREE.BoxGeometry(width + .3, .22, .22).translate(0, 1.27, 0);
    const railPost = new THREE.BoxGeometry(.12, 1.05, .12).translate(0, 2.13, 0), rail = new THREE.BoxGeometry(.1, .1, len).translate(0, 2.6, len / 2), mid = new THREE.BoxGeometry(.06, .07, len).translate(0, 2.1, len / 2);
    disposables.push(pile, beamG, railPost, rail, mid);
    for (let d = 0; d <= len; d += 4) {
      for (const k of [-1, 1]) { const m = new THREE.Mesh(pile, post); m.position.set(k * (width / 2 - .2), 0, d); m.castShadow = true; pier.add(m); }
      const b = new THREE.Mesh(beamG, post); b.position.z = d; pier.add(b);
      for (const k of [-1, 1]) { const m = new THREE.Mesh(railPost, post); m.position.set(k * (width / 2 - .08), 0, d); m.castShadow = true; pier.add(m); }
    }
    for (const k of [-1, 1]) for (const g of [rail, mid]) { const m = new THREE.Mesh(g, post); m.position.x = k * (width / 2 - .08); pier.add(m); }
    things.push(pier);
  }
  let beam = null;
  if (F.lighthouse) {
    const [x, z] = F.lighthouse, y = terrain.heightAt(x, z), lh = new THREE.Group(); lh.position.set(x, y - .5, z); group.add(lh);
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: .6 }), red = new THREE.MeshStandardMaterial({ color: '#c8322b', roughness: .6 }), glass = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe08a', emissiveIntensity: 2.2 });
    disposables.push(white, red, glass);
    for (let i = 0; i < 5; i++) { const g = new THREE.CylinderGeometry(3.2 - i * .4, 3.6 - i * .4, 4.2, 20).translate(0, 2.1 + i * 4.2, 0); disposables.push(g); const m = new THREE.Mesh(g, i % 2 ? red : white); m.castShadow = true; lh.add(m); }
    const top = new THREE.CylinderGeometry(1.6, 1.6, 2.6, 16).translate(0, 22.3, 0), roof = new THREE.ConeGeometry(2.2, 2.4, 16).translate(0, 24.8, 0); disposables.push(top, roof);
    lh.add(new THREE.Mesh(top, glass), new THREE.Mesh(roof, red));
    terrain.addSolids([{ x, z, r: 3.6, tall: 26 }]);
    beam = lh;
    if (dark) {   // (after dark: two beams sweeping round over the sea)
      const bgeo = new THREE.ConeGeometry(26, 900, 24, 12, true).translate(0, -450, 0).rotateZ(Math.PI / 2 - .03), bp = bgeo.attributes.position, bcol = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++) { const k = Math.pow(Math.max(0, 1 - Math.hypot(bp.getX(i), bp.getY(i)) / 900), 3) * .07; bcol.set([k, k * .95, k * .8], i * 3); }   // (bright at the lamp, fading out to sea)
      bgeo.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
      const bm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }); disposables.push(bm, bgeo);
      const spin = new THREE.Group(); spin.position.y = 22.3; lh.add(spin);
      for (const k of [0, Math.PI]) { const m = new THREE.Mesh(bgeo, bm); m.rotation.y = k; m.renderOrder = 3; m.frustumCulled = false; spin.add(m); }
      const lamp = new THREE.PointLight('#ffe9b8', 140, 90, 1.6); lamp.position.y = 23; lh.add(lamp);
      beam.spin = spin;
    }
  }
  // ---------------------------------------------------------------- each frame
  const v2 = new THREE.Vector2();
  function wakes(eye, now) {
    const cx = Math.round(eye.x / 4) * 4, cz = Math.round(eye.z / 4) * 4; u.uWakeBox.value.set(cx, cz, WS);
    wg.globalCompositeOperation = 'source-over'; wg.fillStyle = '#000'; wg.fillRect(0, 0, WN, WN); wg.globalCompositeOperation = 'lighter';
    const px = WN / WS, tan = Math.tan(19.5 * Math.PI / 180);
    for (const [id, list] of trails) {
      while (list.length && now - list[0].t > 14) list.shift();
      if (!list.length) { trails.delete(id); continue; }
      for (const q of list) {
        const age = now - q.t, fade = Math.max(0, 1 - age / 14), sx = (q.x - cx) / WS * WN + WN / 2, sz = (q.z - cz) / WS * WN + WN / 2;
        if (sx < -40 || sx > WN + 40 || sz < -40 || sz > WN + 40) continue;
        const c = Math.cos(q.h), s = Math.sin(q.h), spread = Math.min(40, age * q.v * tan * .6) * px;   // (the V of the wake opening out behind)
        const churn = Math.min(1, q.v / 8) * fade;
        wg.fillStyle = `rgba(255,255,255,${.5 * churn * fade})`; wg.beginPath(); wg.arc(sx, sz, (1.1 + age * .35) * px, 0, 6.2832); wg.fill();   // (the churned water straight behind)
        if (spread > 1) for (const k of [-1, 1]) { wg.fillStyle = `rgba(255,255,255,${.38 * churn * fade})`; wg.beginPath(); wg.arc(sx - s * spread * k, sz + c * spread * k, (.7 + age * .12) * px, 0, 6.2832); wg.fill(); }
      }
    }
    wakeTex.needsUpdate = true;
  }
  let lastWake = 0;
  return {
    water, bedTex, u,
    /** A jet ski at (x, z) heading h (radians, +x = 0, towards +z = π/2) at v m/s, touching the water: adds to its wake. */
    wake(id, x, z, h, v, now = seaClock.value) {
      let list = trails.get(id); if (!list) trails.set(id, list = []);
      const last = list.at(-1); if (last && Math.hypot(last.x - x, last.z - z) < .9 && now - last.t < .2) return;
      list.push({ x, z, h, v, t: now }); if (list.length > 400) list.shift();
    },
    update(eye, dt) {
      seaClock.value = terrain.waveTime();
      u.uCenter.value.set(Math.round(eye.x / 2) * 2, Math.round(eye.z / 2) * 2);
      const now = seaClock.value; if (now - lastWake > 1 / 30 || now < lastWake) { lastWake = now; wakes(eye, now); }
      for (const b of buoys) { const y = terrain.waveAt(b.x, b.z, now); b.g.position.set(b.x, y - .35, b.z); b.g.rotation.set(Math.sin(now * 1.3 + b.ph) * .12, 0, Math.cos(now * 1.1 + b.ph) * .12); }
      if (beam) { beam.children[5].material.emissiveIntensity = 1.8 + .6 * Math.sin(now * 2.5); if (beam.spin) beam.spin.rotation.y = performance.now() / 1000 * .9; }
    },
    buoys,
    dispose() { group.removeFromParent(); for (const d of disposables) d.dispose(); },
  };
}
