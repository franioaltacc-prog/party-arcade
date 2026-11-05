/* The race tracks' "real camera" look (Desert Dunes, Forest Mud, Snow Ridge), each with its own character:
   - the ground: two scanned materials (Poly Haven, CC0) blended by distance from the track's middle: packed riding
     surface on the track, loose ground off it (sand and gravelly sand in the desert; dead leaves and forest mud in the
     forest; powder and packed snow on the ridge). The biome's own vertex colours still tint it (darker steep banks,
     mud and ice on the surface), the edge between the two wanders, and a second bigger sample hides the repeat;
   - the scenery: the game's procedural plants swapped for scanned and ez-tree models where they stand (quiver trees,
     boulders, rooibos, didelta and succulents in the desert; tall pines, oaks, bushes, mossy rocks, ferns and stumps
     in the forest; spruces and rocks under snow on the ridge), detailed close by and simpler further off;
   - real grass tufts (tufts.mjs) along the track's edges, swaying in the wind;
   - sponsor banner fences: long runs of fabric on stakes. Every sponsor is invented (no real brand).
   Rendering only: the ground the bike rides on, the collision and the physics are unchanged.
   Files: public/models/nature, public/assets/moto-realism/race (see SOURCES.md). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tuftKit, tuftPatch } from './open-world/tufts.mjs';

const BASE = '/assets/moto-realism/race/';

/** Each track's ground: off (loose ground) and track (riding surface) texture sets, their tile sizes in metres, how much
    the vertex colours tint them, the rut strength, and patches of another colour off the track (forest: moss). */
const GROUND = {
  desert: { off: 'sand_01', track: 'gravelly_sand', offS: 3.4, trkS: 2.2, tint: 0.55, ruts: 1, patch: ['#a8946a', 0.3], normal: 1.0, offK: [1.05, 1.0, 0.95], trkK: [1, 1, 1] },
  forest: { off: 'forest_leaves_02', track: 'mud_forest', offS: 2.8, trkS: 2.6, tint: 0.35, ruts: 1, patch: ['#47722a', 0.85], patchAt: 0.36, normal: 1.0, offK: [0.78, 0.92, 0.62], trkK: [1, 1, 1] },
  snow: { off: 'snow_02', track: 'snow_02', offS: 5.5, trkS: 1.7, tint: 0.3, ruts: 0.45, patch: ['#dfe8f6', 0.0], normal: 0.8, offK: [1.5, 1.52, 1.6], trkK: [1.3, 1.36, 1.48] },
};
/** A tiling cloudy noise (R, G, B: three unrelated layers) for where the patches grow and how the ground varies. */
function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  const h = (x, y, s) => { let v = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2246822519); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y, P, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, w = (i) => ((i % P) + P) % P;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(w(xi), w(yi), s), b = h(w(xi + 1), w(yi), s), c = h(w(xi), w(yi + 1), s), d = h(w(xi + 1), w(yi + 1), s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let ch = 0; ch < 3; ch++) {
    let v = 0, amp = 0.5, tot = 0;
    for (const P of [4, 8, 16, 32]) { v += amp * vn(x / N * P, y / N * P, P, ch * 7 + P); tot += amp; amp *= 0.5; }
    data[(y * N + x) * 4 + ch] = Math.round(v / tot * 255);
  }
  const t = new THREE.DataTexture(data, N, N); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** Switch a race track's ground material (world.js) to the scanned look once its textures have loaded (till then, and
    if they fail, the procedural look stays). th: the track's THEMES entry; TW: the track's half-width. */
export function raceGround(material, renderer, theme, th, TW, quality = 1) {
  const G = GROUND[theme] || GROUND.desert;
  let disposed = false;
  const textures = [];
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = (name, color) => new Promise((ok, no) => {
    const t = loader.load(BASE + name + '.jpg', () => ok(t), undefined, no);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
  });
  const fallback = [material.map, material.normalMap];
  material.addEventListener('dispose', () => { disposed = true; textures.forEach((t) => t.dispose()); fallback.forEach((t) => t?.dispose()); });
  const lin = (c) => new THREE.Color(c);   // (THREE.Color keeps linear values: the same space as the vertex colours)
  const avg = th.ground.map(lin).reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / th.ground.length);
  Promise.all([load(G.off + '-color', true), load(G.off + '-normal'), load(G.off + '-arm'), load(G.track + '-color', true), load(G.track + '-normal'), load(G.track + '-arm')])
    .then(([oc, on, oa, tc, tn, ta]) => {
      if (disposed) { textures.forEach((t) => t.dispose()); return; }
      const noise = noiseTexture(); textures.push(noise);
      material.map = null; material.normalMap = on; material.normalScale.set(G.normal, G.normal);
      material.roughness = 1; material.color.set('#ffffff');
      const U = {
        uOffC: { value: oc }, uOffA: { value: oa }, uTrkC: { value: tc }, uTrkN: { value: tn }, uTrkA: { value: ta },
        uTW: { value: TW }, uOffS: { value: G.offS }, uTrkS: { value: G.trkS }, uTintK: { value: G.tint }, uRuts: { value: G.ruts },
        uOffRef: { value: avg }, uTrkRef: { value: lin(th.track) }, uPatchC: { value: lin(G.patch[0]) }, uPatchK: { value: G.patch[1] },
        uNoise: { value: noise }, uPatchAt: { value: G.patchAt ?? 0.42 }, uOffK: { value: new THREE.Vector3(...G.offK) }, uTrkK: { value: new THREE.Vector3(...G.trkK) },
      };
      material.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 raceCoord; varying vec2 vRaceCoord; varying vec3 vRaceW; uniform float uOffS;')
          .replace('#include <uv_vertex>', `#include <uv_vertex>
            vRaceCoord = raceCoord; vRaceW = (modelMatrix * vec4(position, 1.0)).xyz;
            vNormalMapUv = vRaceW.xz / uOffS;   // (world space: the near and far strips and the chunks join without seams)`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec2 vRaceCoord; varying vec3 vRaceW;
          uniform sampler2D uOffC, uOffA, uTrkC, uTrkN, uTrkA, uNoise;
          uniform float uTW, uOffS, uTrkS, uTintK, uRuts, uPatchK, uPatchAt; uniform vec3 uOffRef, uTrkRef, uPatchC, uOffK, uTrkK;
          float racePhase() { return (vRaceCoord.x + sin(vRaceCoord.y * 0.13) * 0.16 + sin(vRaceCoord.y * 0.043) * 0.25) * 10.5; }`)
          .replace('#include <map_fragment>', `
            vec2 rw = vRaceW.xz;
            float rFar = smoothstep(25.0, 170.0, length(vViewPosition));
            // the loose ground: a fine tile and a bigger, turned one mixed by a slow wave (no repeat shows across a hill)
            vec2 oUv = rw / uOffS, bUv = mat2(0.8, -0.6, 0.6, 0.8) * rw / (uOffS * 3.3) + 0.37;
            vec4 oc = texture2D(uOffC, oUv);
            #ifdef RACE_LITE
              vec4 ob = oc;   // (medium and low: one sample of the loose ground)
            #else
              vec4 ob = texture2D(uOffC, bUv);
            #endif
            vec3 nBig = texture2D(uNoise, rw / 260.0).rgb, nMid = texture2D(uNoise, rw / 61.0 + 0.31).rgb;
            float rWave = nBig.b;
            float rBig = clamp(0.2 + rFar * 0.55 + (rWave - 0.5) * 0.5, 0.0, 1.0);
            vec3 offCol = mix(oc.rgb, ob.rgb, rBig) * uOffK * (0.88 + 0.24 * nMid.g);
            #ifdef RACE_LITE
              vec3 offArm = texture2D(uOffA, oUv).rgb;
            #else
              vec3 offArm = mix(texture2D(uOffA, oUv).rgb, texture2D(uOffA, bUv).rgb, rBig);
            #endif
            float oLum = dot(oc.rgb, vec3(0.3, 0.59, 0.11));
            // patches of a second colour (moss and grass among the forest's leaves)
            float rPatch = nMid.r * 0.7 + nBig.g * 0.3 + (oLum - 0.4) * 0.5;
            offCol = mix(offCol, uPatchC * (0.35 + oLum * 1.6) * (0.8 + 0.4 * nBig.r), uPatchK * smoothstep(uPatchAt, uPatchAt + 0.2, rPatch) * smoothstep(uTW + 0.8, uTW + 3.5, abs(vRaceCoord.x)));
            // far off, the ground's average colour (no repeating detail lining up into stripes across a hillside)
            float rAway = smoothstep(70.0, 320.0, length(vViewPosition));
            offCol = mix(offCol, textureLod(uOffC, oUv, 12.0).rgb * uOffK * (0.88 + 0.24 * nMid.g) * mix(vec3(1.0), uPatchC * 2.2, uPatchK * 0.55), rAway * 0.75);
            // the riding surface, its edge wandering with the ground's own grain
            vec2 tUv = rw / uTrkS;
            vec3 trkCol = texture2D(uTrkC, tUv).rgb * uTrkK, trkArm = texture2D(uTrkA, tUv).rgb;
            float rEdge = abs(vRaceCoord.x) + (oLum - 0.4) * 1.4 + sin(vRaceCoord.y * 0.41) * 0.22 + sin(vRaceCoord.y * 1.37) * 0.09;
            float rMask = 1.0 - smoothstep(uTW - 0.45, uTW + 0.85, rEdge);
            vec3 rArm = mix(offArm, trkArm, rMask);
            vec3 rCol = mix(offCol, trkCol, rMask) * mix(1.0, rArm.r, 0.55);
            float groove = pow(0.5 + 0.5 * sin(racePhase()), 10.0) * rMask * uRuts;
            diffuseColor.rgb *= rCol * (1.0 - groove * 0.18);`)
          .replace('#include <color_fragment>', `
            #if defined( USE_COLOR )
              // the biome's colours as a tint: the scanned colour stays, darker steep banks and mud, the ice's blue
              vec3 rRef = mix(uOffRef, uTrkRef, rMask);
              diffuseColor.rgb *= mix(vec3(1.0), clamp(vColor / max(rRef, vec3(0.02)), vec3(0.35), vec3(1.7)), uTintK);
            #endif`)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * clamp(rArm.g, 0.08, 1.0);')
          .replace('#include <normal_fragment_maps>', `
            {
              vec3 nO = texture2D(normalMap, oUv).xyz * 2.0 - 1.0, nT = texture2D(uTrkN, tUv).xyz * 2.0 - 1.0;
              vec3 mapN = normalize(mix(nO, nT, rMask)); mapN.xy *= normalScale * (1.0 - 0.8 * rAway);
              normal = normalize(tbn * mapN);
              // fine parallel ruts that follow the track round the corners (shading only: the ground is unchanged)
              float ph = racePhase();
              float slope = 0.18 * uRuts * cos(ph) * pow(0.5 + 0.5 * sin(ph), 7.0) * rMask;
              mat3 trackFrame = getTangentFrame(-vViewPosition, normal, vRaceCoord);
              normal = normalize(trackFrame * normalize(vec3(-slope, 0.0, 1.0)));
            }`);
      };
      if (quality <= 0.8) material.defines = { ...(material.defines || {}), RACE_LITE: '' };
      material.customProgramCacheKey = () => 'race-ground-v2' + (quality <= 0.8 ? '-lite' : '');
      material.needsUpdate = true;
    }).catch(() => { textures.forEach((t) => t.dispose()); });   // (a missing file leaves the old look: still rideable)
}

// ------------------------------------------------------------------ the scenery models
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// (a variant: [near parts, far parts or null]; a part: [file, mesh name, colour (times the material's) or none])
const tree = (file, stem, i) => [[[file, stem + i + '_bark'], [file, stem + i + '_leaves']], [[file, stem + i + '_far_bark'], [file, stem + i + '_far_leaves']]];
const one = (file, names, color) => names.map((n) => [[[file, n, color]], null]);
const PALE = [3.2, 2.9, 2.5], RED = [1.25, 0.86, 0.68];   // (the scans' bark is dark: a quiver tree's is pale golden grey; the desert's boulders red)
/** For each track: which of world.js's procedural kinds become which models. v: variants; h: fit to this height
    (metres; else k: a plain scale); cull: not drawn further than this; shade: casts shadows; snow: snow on top (how
    white all over); mul: how many more of them there are as models. The instances keep world.js's spots, turns, sizes
    and tints. */
const DRESS = {
  desert: {
    cactus: { v: [[[['wild/quiver1-trunk', 'quiver_tree_01', PALE], ['wild/quiver1-leaf', 'quiver_tree_01', [1.8, 1.8, 1.6]]], null], one('wild/quiver2', ['quiver_tree_02'], PALE)[0]], h: 3.4, shade: true },
    deadtree: { v: one('wild/deadquiver', ['dead_quiver_trunk_LOD0'], [2, 1.85, 1.65]), h: 2.5, shade: true },
    rock: { v: [...one('wild/boulder-a', ['boulder_02'], RED), ...one('wild/boulder-b', ['boulder_04'], RED), ...one('wild/boulder-c', ['namaqualand_boulder_05'], RED), ...one('wild/boulder-d', ['boulder_01'], RED)], k: 1.9, shade: true },
    shrub: { v: one('wild/rooibos', ['wild_rooibos_bush_b', 'wild_rooibos_bush_c', 'wild_rooibos_bush_d']), k: 1.15, cull: 230, mul: 2.4 },
    barrel: { v: one('succulents', ['cheiridopsis_succulent_e_LOD0', 'cheiridopsis_succulent_g_LOD0', 'cheiridopsis_succulent_h_LOD0']), k: 2.6, cull: 150, mul: 4 },
    didelta: { v: one('didelta', ['didelta_spinosa_large_LOD0', 'didelta_spinosa_medium_LOD0', 'didelta_spinosa_small_LOD0']), k: 1.25, cull: 300, shade: true },
  },
  forest: {
    pine: { v: range(3, (i) => tree('pines', 'pine', i)), h: 15, shade: true, mul: 1.4 },
    broadleaf: { v: range(3, (i) => tree('oaks', 'oak', i)), h: 11, shade: true },
    rock: { v: [...one('rocks-moss', range(6, (i) => 'rock_moss_set_01_rock0' + (i + 1))), ...one('rocks-moss2', ['rock_moss_set_02_rock08', 'rock_moss_set_02_rock11', 'rock_moss_set_02_rock13'])], k: 1.7, shade: true },
    shrub: { v: range(3, (i) => tree('bushes', 'bush', i)), k: 1.35, cull: 260, shade: true },
    log: { v: one('log', ['dead_tree_trunk']), k: 1.1, shade: true },
    fern: { v: one('fern', ['fern_02_a', 'fern_02_b', 'fern_02_c', 'fern_02_d']), k: 3.2, cull: 150 },
    stump: { v: [...one('stump', ['tree_stump_01']), ...one('stump2', ['tree_stump_02'])], k: 1.4, cull: 220, shade: true },
  },
  snow: {
    snowpine: { v: range(3, (i) => tree('spruces', 'pine', i)), h: 12.5, shade: true, snow: 0.3, medMul: 0.7 },
    rock: { v: [...one('rocks-moss', range(6, (i) => 'rock_moss_set_01_rock0' + (i + 1)))], k: 1.8, shade: true, snow: 0 },
  },
};
/** How much more (or less) of a kind there is when it's drawn as a model: mul on high quality, medMul on medium. */
export function dressDensity(theme, kind, quality) { const sp = DRESS[theme]?.[kind]; return quality > 0.8 ? sp?.mul || 1 : sp?.medMul || 1; }
/** Kinds that only exist as models (world.js scatters their spots on medium and high quality): [kind, density]. */
export const DRESS_MORE = { desert: [['didelta', 1.2]], forest: [['fern', 3.2], ['stump', 0.35]], snow: [] };

/** Snow lying on whatever faces up (and a little all over: base). */
function snowOn(m, base) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `{
      vec3 snowN = inverseTransformDirection(normal, viewMatrix);
      float snow = max(smoothstep(0.2, 0.65, snowN.y), ${base.toFixed(2)});
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.97), snow); roughnessFactor = mix(roughnessFactor, 0.7, snow);
    }
    #include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => 'race-snow' + base;
}

/** Leaves that stay leafy far off: a leaf texture's smaller (mipmapped) versions average its see-through edges away, so
    a distant tree loses its needles. The alpha is raised as the texture gets smaller on screen. */
function leafAlpha(m) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
      { vec2 tsz = vec2(textureSize(map, 0)); vec2 dx = dFdx(vMapUv * tsz), dy = dFdy(vMapUv * tsz);
        float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
        diffuseColor.a *= 1.0 + lod * 0.3; }
      #endif
      #include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => key.call(m) + '|leafa';
}

/** Banner fabric with invented sponsors, logo after logo. */
const SPONSORS = {
  desert: [['REVVD', 'RACING'], ['DUNE DOGS', 'SAND & SUN'], ['GRIT OIL', 'MOTOR OIL'], ['PARTY ARCADE', 'PLAY · RACE · WIN'], ['FULL GAS CO.', 'FUEL & OIL'], ['DESERT DUNES', 'MOTOCROSS']],
  forest: [['BERM BROS.', 'DIRT WORKS'], ['MUDLINE', 'TYRES'], ['HOLESHOT HQ', 'RACE GEAR'], ['REVVD', 'RACING'], ['PARTY ARCADE', 'PLAY · RACE · WIN'], ['FOREST MUD', 'MOTOCROSS']],
  snow: [['COLD START', 'TYRES'], ['REVVD', 'RACING'], ['HIGH PASS CO.', 'MOUNTAIN GEAR'], ['PARTY ARCADE', 'PLAY · RACE · WIN'], ['SNOW RIDGE', 'MOTOCROSS'], ['HOLESHOT HQ', 'RACE GEAR']],
};
const WAYS = {
  desert: [['#16181c', '#ff7a1a', '#ffffff'], ['#ff6a10', '#ffffff', '#16181c'], ['#f2efe6', '#16181c', '#d8262c']],
  forest: [['#1d5e34', '#ffffff', '#ffd21a'], ['#16181c', '#ff8a00', '#ffffff'], ['#f2efe6', '#1d5e34', '#16181c']],
  snow: [['#1b2f9e', '#ffffff', '#9fd3ff'], ['#d8262c', '#ffffff', '#ffd21a'], ['#f2f5fb', '#1b2f9e', '#d8262c']],
};
function bannerTexture(list, [bg, fg, accent], seed) {
  const W = 2048, H = 192, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);   // (the hems)
  for (let x = 0; x < W; x += 3) { g.fillStyle = `rgba(255,255,255,${0.012 + (x % 7) * 0.002})`; g.fillRect(x, 0, 1, H); }   // (the weave)
  const n = 4, slot = W / n;
  for (let i = 0; i < n; i++) {
    const [t, sub] = list[(i + seed) % list.length], cx = slot * i + slot / 2;
    g.save(); g.translate(cx - slot * 0.36, H * 0.5); g.strokeStyle = fg; g.fillStyle = fg; g.lineWidth = 9;
    if ((i + seed) % 2) { g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-22, 20); g.lineTo(22, -20); g.stroke(); }
    else { g.beginPath(); g.moveTo(-30, 24); g.lineTo(0, -26); g.lineTo(30, 24); g.lineTo(14, 24); g.lineTo(0, 0); g.lineTo(-14, 24); g.closePath(); g.fill(); }
    g.restore();
    g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle';
    let size = 78; g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    while (g.measureText(t).width > slot * 0.66 && size > 30) { size -= 4; g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`; }
    g.fillText(t, cx - slot * 0.27, H * 0.44);
    g.font = '700 26px Arial, sans-serif'; g.fillStyle = accent; g.fillText(sub, cx - slot * 0.27 + 4, H * 0.8);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8; return tex;
}

/** Dress a race track. w: { scene, T, TW, place, height, bermAt, slots ({kind: [{matrices, colors, mesh}]} from world.js),
    quality, theme }. Models and grass only on medium and high quality (models: quality > 0.45); the banners always.
    Returns { update(focus, dt), dispose() }. */
export function raceDress(w) {
  const { scene, T, TW, place, height, bermAt, slots, quality, theme } = w;
  let gone = false;
  const records = [];   // ({x, z, r, near: [meshes], far: [meshes], cull})
  const owned = [];   // (things to dispose that the world's scene sweep may miss)
  let rnd = (T.n * 131 + 7) >>> 0; const rand = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0; return rnd / 4294967296; };

  // ---------------------------------------------------------------- banner fences
  {
    const list = SPONSORS[theme] || SPONSORS.desert, ways = WAYS[theme] || WAYS.desert;
    const mats = ways.map((wy, i) => new THREE.MeshStandardMaterial({ map: bannerTexture(list, wy, i * 2), roughness: 0.82, side: THREE.DoubleSide }));
    const runs = ways.map(() => []); const stakes = [];
    for (const side of [-1, 1]) {
      let s = T.start + 14 + rand() * 30;
      while (s < T.finish - 20) {
        const len = 24 + rand() * 40, way = Math.floor(rand() * ways.length), pos = [], uv = [], idx = [];
        let v = 0, last = null;
        for (let d = 0; d <= len; d += 1.5) {
          const si = s + d, u = side * (TW + 1.45 + (bermAt(si) ? 0.9 : 0)), p = place(si, height(si, u), u);
          if (last) v += p.distanceTo(last) / 7.5;
          last = p; pos.push(p.x, p.y + 0.05, p.z, p.x, p.y + 0.9, p.z); uv.push(v, 0, v, 1);
          const i = pos.length / 3 - 2; if (i > 0) idx.push(i - 2, i, i - 1, i - 1, i, i + 1);
          if (Math.round(d / 1.5) % 2 === 0) stakes.push(p);
        }
        if (idx.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); runs[way].push(g); }
        s += len + 25 + rand() * 45;
      }
    }
    runs.forEach((gs, i) => gs.forEach((g) => { const m = new THREE.Mesh(g, mats[i]); m.castShadow = quality > 0.6; m.receiveShadow = true; scene.add(m); }));
    if (stakes.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 1.15, 6).translate(0, 0.57, 0), new THREE.MeshStandardMaterial({ color: theme === 'snow' ? '#ff3b5c' : '#ffd21a', roughness: 0.55 }), stakes.length);
      const m4 = new THREE.Matrix4(); stakes.forEach((p, i) => im.setMatrixAt(i, m4.makeTranslation(p.x, p.y - 0.08, p.z)));
      im.castShadow = quality > 0.6; im.computeBoundingSphere(); scene.add(im);
    }
  }

  const spec = DRESS[theme] || {};
  if (quality <= 0.45) return { update() {}, dispose() { gone = true; } };   // (low quality: the procedural scenery stays)

  // ---------------------------------------------------------------- grass tufts along the track's edges
  let kit = null;
  if (theme !== 'snow') {
    kit = tuftKit({ quality, seed: T.n || 1, color: theme === 'desert' ? '#e9dcc0' : '#bcd394' });
    owned.push(kit);
    const per = (quality > 0.8 ? 22 : 5) * (theme === 'desert' ? 0.7 : 1);   // (tufts tried per metre of track)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (let s0 = T.S0 + 60; s0 < T.S1 - 40; s0 += 30) {
      const lists = [[], [], []];
      for (let s = s0; s < s0 + 30; s++) for (let j = 0; j < per; j++) {
        const side = rand() < 0.5 ? -1 : 1, si = s + rand();
        const u = side * (TW + 1.1 + (bermAt(si) ? 1.3 : 0) + Math.pow(rand(), 1.8) * (theme === 'desert' ? 30 : 22));
        const y = height(si, u); if (Math.abs(height(si, u + 0.6) - height(si, u - 0.6)) > 0.75) continue;   // (bare earth on steep banks)
        const p = place(si, y, u), d = tuftPatch(p.x, p.z); if (rand() > d * 1.35 - (theme === 'desert' ? 0.3 : 0.12)) continue;
        lists[Math.floor(rand() * 3)].push([p.x, y, p.z, d]);
        if (d > 0.55 && rand() < 0.6) { const x2 = p.x + (rand() - 0.5) * 0.7, z2 = p.z + (rand() - 0.5) * 0.7; lists[Math.floor(rand() * 3)].push([x2, y, z2, d]); }   // (clumps)
      }
      const rec = { x: 0, z: 0, r: 0, near: [], far: [], cull: quality > 0.8 ? 95 : 60 };
      lists.forEach((list, vi) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(kit.geos[vi], kit.mat, list.length);
        list.forEach(([x, y, z, d], i) => {
          const tall = (theme === 'desert' ? 0.2 : 0.18) + (theme === 'desert' ? 0.3 : 0.45) * Math.pow(d, 1.4) * (0.6 + rand() * 0.8), wide = 0.8 + rand() * 0.6;
          q.setFromAxisAngle(up, rand() * 6.283); im.setMatrixAt(i, m4.compose(v.set(x, y - 0.03, z), q, sc.set(wide * (0.7 + tall), tall, wide * (0.7 + tall))));
          const t = 0.8 + rand() * 0.32; im.setColorAt(i, col.setRGB(t, t * (0.92 + rand() * 0.16), t * (0.85 + rand() * 0.15)));
        });
        im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); rec.near.push(im);
      });
      if (rec.near.length) { const b = rec.near[0].boundingSphere; rec.x = b.center.x; rec.z = b.center.z; rec.r = b.radius; records.push(rec); }
    }
  }

  // ---------------------------------------------------------------- swap the procedural plants for the models
  const kinds = Object.keys(spec).filter((k) => slots[k]?.length);
  const need = [...new Set(kinds.flatMap((k) => spec[k].v.flatMap(([nearP, farP]) => [...nearP, ...(farP || [])].map((x) => x[0]))))];
  const loader = new GLTFLoader(), sources = [];
  Promise.all(need.map((f) => loader.loadAsync('/models/nature/' + f + '.glb').then((g) => { g.scene.updateMatrixWorld(true); sources.push(g.scene); return [f, g.scene]; }))).then((pairs) => {
    if (gone) { release(); return; }
    const byName = Object.fromEntries(pairs);
    const matCache = new Map();
    const matFor = (m, sp, color) => {   // (one copy of each model material per world, snow setting and colour)
      const key = m.uuid + '|' + (sp.snow ?? '-') + '|' + color;
      if (!matCache.has(key)) {
        const c = m.clone();
        if (color) c.color.multiply(new THREE.Color().setRGB(...color));
        if (sp.snow !== undefined) snowOn(c, sp.snow);
        if (c.alphaTest > 0 || c.transparent || /leaves|needles|twigs/.test(m.name)) { c.side = THREE.DoubleSide; c.alphaTest = Math.max(0.4, c.alphaTest); c.transparent = false; c.depthWrite = true; leafAlpha(c); }
        matCache.set(key, c);
      }
      return matCache.get(key);
    };
    for (const kind of kinds) {
      const sp = spec[kind];
      // each variant's geometry, fitted (an instance's own size, turn and tilt still apply on top)
      const vars = sp.v.map(([nearP, farP]) => {
        const get = ([f, n]) => byName[f]?.getObjectByName(n);
        const near = nearP.map(get), far = farP ? farP.map(get) : null, colorOf = (parts, i) => parts[i][2];
        if (near.some((m) => !m?.isMesh) || (far && far.some((m) => !m?.isMesh))) return null;
        const box = new THREE.Box3(); near.forEach((m) => box.union(new THREE.Box3().setFromObject(m)));
        const k = sp.h ? sp.h / Math.max(0.01, box.max.y - box.min.y) : sp.k;
        const fit = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(0, sp.h ? -box.min.y : 0, 0));
        const geo = (parts) => (m, i) => ({ g: m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(fit), m: matFor(m.material, sp, colorOf(parts, i)) });
        return { near: near.map(geo(nearP)), far: far ? far.map(geo(farP)) : null };
      }).filter(Boolean);
      if (!vars.length) continue;
      for (const slot of slots[kind]) {
        const n = slot.matrices.length, rec = { x: 0, z: 0, r: 0, near: [], far: [], cull: sp.cull || Infinity };
        vars.forEach((va, vi) => {
          const idx = []; for (let i = vi; i < n; i += vars.length) idx.push(i);
          if (!idx.length) return;
          for (const [which, parts] of [['near', va.near], ['far', va.far]]) {
            if (!parts) continue;
            for (const { g, m } of parts) {
              const im = new THREE.InstancedMesh(g, m, idx.length);
              idx.forEach((i, j) => { im.setMatrixAt(j, slot.matrices[i]); if (slot.colors) im.setColorAt(j, slot.colors[i]); });
              im.castShadow = !!sp.shade && (quality > 0.8 || !!sp.h);   // (medium: only trees cast shadows)
              im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im); rec[which].push(im);
            }
          }
        });
        if (slot.mesh) { slot.mesh.removeFromParent(); slot.mesh.dispose(); }
        if (rec.near.length && (rec.far.length || rec.cull < Infinity)) {   // (else always drawn: nothing to switch)
          const b = new THREE.Sphere(); rec.near.forEach((im) => b.union(im.boundingSphere)); rec.x = b.center.x; rec.z = b.center.z; rec.r = b.radius; records.push(rec);
        }
      }
      // the procedural shapes' geometry isn't needed any more
      new Set(slots[kind].map((s) => s.mesh?.geometry).filter(Boolean)).forEach((g) => g.dispose());
    }
    release();
    if (lastFocus) apply(lastFocus);
  }).catch((e) => { console.warn('race scenery', e); release(); });
  const release = () => {   // (the loaded files' own buffers: every model drawn uses its own copy; textures stay with the copies' materials)
    for (const root of sources) root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (gone) for (const root of sources) root.traverse((o) => { if (o.isMesh) for (const v of Object.values(o.material)) if (v?.isTexture) v.dispose(); });
    sources.length = 0;
  };

  // ---------------------------------------------------------------- near and far
  let lastFocus = null;
  const nearD = quality > 0.8 ? 110 : 45;
  function apply(focus) {
    for (const r of records) {
      const d = Math.hypot(r.x - focus.x, r.z - focus.z) - r.r;
      const near = d < nearD || !r.far.length, show = d < r.cull;
      for (const im of r.near) im.visible = show && near;
      for (const im of r.far) im.visible = show && !near;
    }
  }
  let acc = 0;
  return {
    update(focus, dt) {
      if (kit) kit.time.value += dt;
      lastFocus = focus; acc += dt;
      if (acc > 0.25) { acc = 0; apply(focus); }
    },
    dispose() { gone = true; owned.forEach((o) => o.dispose()); },
  };
}
