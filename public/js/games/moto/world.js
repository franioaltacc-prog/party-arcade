/* Motocross: the 3D world around a track — sky, sun and fog, the ground (sculpted dirt jumps,
   banked berms, tyre ruts), scenery, the start gate, checkpoint and finish arches, and the dust,
   mud and snow particles. Everything is made from code at load time (no image or model files).
   A point on the track is (s = metres along it, y = height, u = metres to the right of its middle). */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const C = window.MotoCore;

export const THEMES = {
  desert: {
    sun: [48, 125], turbidity: 4, rayleigh: 1.1, mie: 0.004, mieG: 0.82, exposure: 0.42,
    sunColor: '#fff0d8', sunI: 2.6, hemi: ['#d6e6ff', '#b88c5c', 0.55], envI: 0.55,
    fog: '#e6d3b6', fogD: 0.00075,
    track: '#b98b5d', rut: '#93673f', berm: '#b8865a', ground: ['#ecd3a3', '#e2c38e', '#d9b47c', '#efdcb4'], side: '#c08c5a', far: '#d5a171',
    puff: '#dcbf92', chunk: '#9b7448', water: null,
    trees: [['cactus', 0.5], ['barrel', 0.6], ['rock', 0.9], ['shrub', 1.4], ['grass', 4], ['deadtree', 0.08]], mountains: 'mesa', snowing: false, lamps: false,
    arch: '#ff6a10', fence: '#ffffff',
  },
  forest: {
    sun: [22, 210], turbidity: 9, rayleigh: 2.2, mie: 0.012, mieG: 0.86, exposure: 0.36,
    sunColor: '#ffe2b8', sunI: 1.9, hemi: ['#bccbd8', '#3b3a22', 0.7], envI: 0.6,
    fog: '#a9b6aa', fogD: 0.0016,
    track: '#5a3f28', rut: '#3a2717', berm: '#664a30', ground: ['#4d6b2c', '#56772f', '#3f5a26', '#5f6f34'], side: '#5b4630', far: '#3d5a34',
    puff: '#6b5844', chunk: '#3b2a1a', water: '#3a3020',
    trees: [['pine', 2.2], ['broadleaf', 0.9], ['rock', 0.5], ['shrub', 1.6], ['grass', 5], ['log', 0.12]], mountains: 'hills', snowing: false, lamps: false,
    arch: '#2ecc71', fence: '#ff8a00',
  },
  snow: {
    sun: [4, 250], turbidity: 6, rayleigh: 2.6, mie: 0.006, mieG: 0.8, exposure: 0.33,
    sunColor: '#ffc9a0', sunI: 1.6, hemi: ['#b6c4f2', '#8d93b8', 0.85], envI: 0.75,
    fog: '#b9b6d2', fogD: 0.0011,
    track: '#dfe5ef', rut: '#b9c3d4', berm: '#e8edf5', ground: ['#f4f7fc', '#eef2fa', '#e6ecf7', '#f8faff'], side: '#e2e8f2', far: '#dfe6f2',
    puff: '#ffffff', chunk: '#e8eef8', water: null,
    trees: [['snowpine', 2.4], ['rock', 0.4], ['snowbank', 0.6]], mountains: 'peaks', snowing: true, lamps: true,
    arch: '#2a7fff', fence: '#ff3b5c',
  },
};

/** Merge geometries of any kind (indexed or not) that share position/normal/uv (and colour if all have it). */
function mergeAll(list) {
  const withColor = list.every((g) => g.attributes.color);
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k) && !(withColor && k === 'color')) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    n.morphAttributes = {};
    return n;
  });
  return mergeGeometries(flat);
}

// ------------------------------------------------------------------ noise
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x); const yi = Math.floor(y); const xf = x - xi; const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi); const b = hash2(xi + 1, yi); const c = hash2(xi, yi + 1); const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) { let s = 0; let a = 0.5; let f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** Value noise that repeats every P cells (so the picture tiles without seams). */
function pnoise(x, y, P, seed) {
  const xi = Math.floor(x); const yi = Math.floor(y); const xf = x - xi; const yf = y - yi;
  const w = (i) => ((i % P) + P) % P;
  const g = (i, j) => hash2(w(i) + seed * 977, w(j) + seed * 131);
  const u = xf * xf * (3 - 2 * xf); const v = yf * yf * (3 - 2 * yf);
  const a = g(xi, yi); const b = g(xi + 1, yi); const c = g(xi, yi + 1); const d = g(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** A tiling grey grain picture (for detail) and a matching bump normal map. */
function detailMaps(seed) {
  const N = 256; const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0; let amp = 0.5; let tot = 0;
    for (const P of [6, 12, 24, 48, 96]) { v += amp * pnoise(x / N * P, y / N * P, P, seed + P); tot += amp; amp *= 0.62; }
    hgt[y * N + x] = v / tot;
  }
  const map = canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const v = 222 + (hgt[i] - 0.5) * 60 + (hash2(i, seed) - 0.5) * 10; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, v)); img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  });
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const hx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x + N - 1) % N)];
      const hy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
      const nx = -hx * 9; const ny = -hy * 9; const nz = 1; const l = Math.hypot(nx, ny, nz);
      const i = (y * N + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  return { map, normal };
}

/* ------------------------------------------------------------------ scenery models
   Every model is made here from simple shapes that get bent, lumped, cut and coloured vertex by vertex,
   then copied around with instancing (each copy a little bigger, smaller, darker or lighter). */
const vc = (geo, color, jitter = 0.08, fn) => {
  const n = geo.attributes.position.count; const col = new Float32Array(n * 3); const c0 = new THREE.Color(color); const c = new THREE.Color();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    c.copy(c0).multiplyScalar(1 - jitter + Math.random() * jitter * 2);
    if (fn) fn(c, geo.attributes.position.getX(i), geo.attributes.position.getY(i), geo.attributes.position.getZ(i), nrm ? nrm.getY(i) : 1, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
};
const wobble = (geo, amt, f = 2.2, seed = 0) => {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const n = (vnoise(x * f + seed, y * f + z * f * 0.7) - 0.5) * 2;
    const l = Math.hypot(x, z) || 1;
    p.setXYZ(i, x + x / l * n * amt, y + n * amt * 0.4, z + z / l * n * amt);
  }
  geo.computeVertexNormals();
  return geo;
};
const snowy = (c, x, y, z, ny) => { if (ny > 0.35) c.lerp(new THREE.Color('#f4f8ff'), Math.min(1, (ny - 0.35) * 2.2)); };
/** Share the vertices of a closed shape so it shades smoothly (no facets). */
const smoothGeo = (g) => { g.deleteAttribute('normal'); g.deleteAttribute('uv'); const m = mergeVertices(g); m.computeVertexNormals(); return m; };
const n3 = (x, y, z) => (vnoise(x, y) + vnoise(y + 31.7, z) + vnoise(z + 57.3, x)) / 3;   // (a cheap 3D noise)
const f3 = (x, y, z, oct) => { let s = 0; let a = 0.5; let f = 1; for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); f *= 2.1; a *= 0.5; } return s / (1 - Math.pow(0.5, oct)); };
/** Push each vertex in or out from the middle by noise (bumpy stone, leafy clumps). Keeps how far, for colouring. */
const lump = (g, amt, freq, seed, oct = 4) => {
  const p = g.attributes.position; const bump = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const n = (f3(x * freq + seed, y * freq + seed * 0.3, z * freq, oct) - 0.5) * 2; bump[i] = n;
    p.setXYZ(i, x * (1 + n * amt), y * (1 + n * amt), z * (1 + n * amt));
  }
  g.computeVertexNormals(); g.userData.bump = bump;
  return g;
};
/** Ribs round the vertical axis (cacti). */
const ribbed = (g, ribs, depth) => {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); const z = p.getZ(i); const k = 1 + Math.cos(Math.atan2(z, x) * ribs) * depth; p.setX(i, x * k); p.setZ(i, z * k); }
  g.computeVertexNormals(); return g;
};
const groove = (ribs) => (c, x, y, z) => c.multiplyScalar(0.7 + 0.36 * (0.5 + 0.5 * Math.cos(Math.atan2(z, x) * ribs)));
const bark = (c, x, y, z) => c.multiplyScalar(0.72 + 0.32 * vnoise(Math.atan2(z, x) * 3, y * 6));
/** The scenery models for a theme. detail: 2 = the race tracks (few copies, lots of shape), 1 = open-world near, 0 = far away. */
export function makeProps(theme, rand, detail = 2) {
  const T = { theme };
  const D = (far, near, race) => [far, near, race][detail];
  /** A fir: a tapering trunk and layers of drooping branches with ragged tips, darker inside. */
  const conifer = (snow) => {
    const parts = [vc(new THREE.CylinderGeometry(0.09, 0.26, 3.4, D(5, 7, 9), D(1, 2, 4)).translate(0, 1.7, 0), '#4e3423', 0.08, bark)];
    const layers = D(4, 6, 9); const seed = rand() * 10; const tall = layers === 9 ? 1 : 9 / layers * 0.78;   // (fewer, taller layers far away)
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const r = 2.35 * (1 - t * 0.8) + 0.12; const hgt = (1.55 - t * 0.55) * tall; const y0 = 1.2 + t * 6.4;
      const g = new THREE.ConeGeometry(r, hgt, D(7, 12, 20), D(1, 2, 3), true);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k); const y = p.getY(k); const z = p.getZ(k);
        const a = Math.atan2(z, x); const rim = (hgt / 2 - y) / hgt;   // 0 at the tip, 1 at the rim
        const jag = 1 + (0.2 * Math.sin(a * 7 + i * 1.9 + seed) + 0.25 * (vnoise(a * 2.5 + i * 3, seed) - 0.5)) * rim;
        p.setXYZ(k, x * jag, y - rim * rim * 0.42 * (r / 2.35), z * jag);   // ragged branch tips that droop
      }
      g.computeVertexNormals(); g.translate(0, y0 + hgt / 2, 0);
      parts.push(vc(g, snow ? '#24452f' : i % 2 ? '#2d5a31' : '#2a532c', 0.08, (c, x, y, z, ny) => {
        c.multiplyScalar(0.5 + 0.62 * Math.min(1, Math.hypot(x, z) / r) + t * 0.12);
        if (snow) snowy(c, x, y, z, ny + 0.15);
      }));
    }
    return mergeAll(parts);
  };
  const PROPS = {
    pine: () => conifer(false),
    snowpine: () => conifer(true),
    broadleaf: () => {
      const parts = [vc(new THREE.CylinderGeometry(0.15, 0.3, 3.4, D(5, 7, 10), D(1, 2, 4)).translate(0, 1.7, 0), '#5a4330', 0.06, bark)];
      for (const [ax, az, up] of [[0.9, 0.3, 1.1], [-0.8, -0.4, 1.2], [0.1, -1.0, 0.9], [-0.3, 0.9, 1.0]]) {
        parts.push(vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.6, 0), new THREE.Vector3(ax * 0.45, 3.1, az * 0.45), new THREE.Vector3(ax, 3.2 + up, az)]), D(2, 4, 8), 0.08, D(3, 4, 6)), '#5a4330', 0.08));
      }
      for (const [x, y, z, r] of [[0, 4.9, 0, 1.8], [1.15, 4.2, 0.4, 1.35], [-1.05, 4.3, -0.5, 1.4], [0.25, 4.1, -1.15, 1.25], [-0.35, 5.7, 0.3, 1.25], [0.65, 3.8, 1.05, 1.1], [-0.85, 3.7, 0.85, 1.05], [0.9, 5.4, -0.4, 1.0]]) {
        const g = lump(smoothGeo(new THREE.IcosahedronGeometry(r * D(1.12, 1, 1), D(0, 1, 3))), 0.24, 1.3, rand() * 40, 3);
        g.translate(x, y, z);
        parts.push(vc(g, '#4b7a2c', 0.1, (c, px, py, pz, ny, i) => c.multiplyScalar(0.52 + 0.42 * Math.max(0, ny) + 0.18 * g.userData.bump[i] + (py - 4) * 0.05)));
      }
      return mergeAll(parts);
    },
    cactus: () => {
      // a saguaro: a deep-ribbed trunk, two arms and a few flowers on top
      const parts = [vc(ribbed(new THREE.CapsuleGeometry(0.32, 4.2, D(1, 2, 8), D(8, 12, 40)), 12, 0.09), '#4a7838', 0.04, groove(12)).translate(0, 2.4, 0)];
      for (const side of [-1, 1]) {
        const h = 1.3 + rand() * 1.0; const up = 1.0 + rand() * 0.7;
        const across = vc(ribbed(new THREE.CapsuleGeometry(0.2, 0.42, D(1, 2, 6), D(6, 9, 28)), 10, 0.08), '#477536', 0.04, groove(10));
        across.rotateZ(Math.PI / 2); across.translate(side * 0.5, h, 0); parts.push(across);
        parts.push(vc(ribbed(new THREE.CapsuleGeometry(0.21, up, D(1, 2, 6), D(6, 9, 28)), 10, 0.08), '#477536', 0.04, groove(10)).translate(side * 0.8, h + up / 2 + 0.05, 0));
      }
      for (let i = 0; i < D(0, 3, 4); i++) { const a = i * 1.6 + rand(); parts.push(vc(new THREE.SphereGeometry(0.07, 6, 4).translate(Math.cos(a) * 0.17, 4.82, Math.sin(a) * 0.17), i % 2 ? '#f7f0c8' : '#fbe08a', 0.05)); }
      return mergeAll(parts);
    },
    barrel: () => {
      // a little barrel cactus with a ring of pink and yellow flowers
      const g = ribbed(new THREE.SphereGeometry(0.5, D(10, 20, 40), D(6, 10, 20)), 16, 0.1); g.scale(1, 1.2, 1); g.translate(0, 0.42, 0);
      const parts = [vc(g, '#5a7e3a', 0.04, (c, x, y, z) => { groove(16)(c, x, y, z); if (y > 0.85) c.lerp(new THREE.Color('#c9b46a'), Math.min(1, (y - 0.85) * 4)); })];
      for (let i = 0; i < D(0, 5, 7); i++) { const a = i / 7 * Math.PI * 2; parts.push(vc(new THREE.SphereGeometry(0.075, D(4, 5, 8), D(3, 4, 6)).scale(1, 0.7, 1).translate(Math.cos(a) * 0.2, 1.0, Math.sin(a) * 0.2), i % 2 ? '#ff5d8f' : '#ffd23f', 0.05)); }
      return mergeAll(parts);
    },
    rock: () => {
      // a boulder: lumpy, with a few flat split faces and a flat bottom sunk into the ground
      const g = lump(smoothGeo(new THREE.IcosahedronGeometry(1, D(1, 2, 4))), 0.36, 1.7, rand() * 50, D(3, 4, 5));
      const p = g.attributes.position; const v = new THREE.Vector3(); const cuts = [];
      for (let k = 0; k < 7; k++) { const a = rand() * 6.28; const b = (rand() - 0.25) * 1.1; cuts.push([new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)), 0.55 + rand() * 0.25]); }
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        for (const [nrm, d] of cuts) { const k = v.dot(nrm); if (k > d) v.addScaledVector(nrm, d - k); }
        if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.15;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.scale(1.25, 0.78, 1); g.translate(0, 0.22, 0); g.computeVertexNormals();
      const bump = g.userData.bump;
      const base = T.theme === 'desert' ? '#a87450' : T.theme === 'snow' ? '#696d79' : '#7c7d76';
      const moss = new THREE.Color('#4f6d2a'); const band = new THREE.Color(T.theme === 'desert' ? '#c99766' : '#9a9b94');
      return vc(g, base, 0.04, (c, x, y, z, ny, i) => {
        c.multiplyScalar(0.5 + 0.7 * (0.5 + 0.5 * bump[i]) + 0.12 * Math.max(0, ny));   // darker in the cracks, lighter on top
        if (T.theme === 'desert') c.lerp(band, 0.35 * (0.5 + 0.5 * Math.sin(y * 16 + vnoise(x * 3, z * 3) * 4)));   // sandstone layers
        if (T.theme === 'forest' && ny > 0.45) c.lerp(moss, Math.min(0.75, (ny - 0.45) * 2 * vnoise(x * 4 + 3, z * 4)  + 0.2));
        if (T.theme === 'snow') snowy(c, x, y, z, ny);
      });
    },
    shrub: () => {
      const desert = T.theme === 'desert'; const parts = [];
      for (let i = 0; i < D(4, 6, 8); i++) {
        const r = (0.26 + rand() * 0.26) * D(1.3, 1.12, 1); const a = rand() * 6.28; const d = rand() * 0.55;
        const g = lump(smoothGeo(new THREE.IcosahedronGeometry(r, D(0, 1, 2))), 0.32, 2.6, rand() * 40, 3);
        g.translate(Math.cos(a) * d, r * 0.75 + rand() * 0.2, Math.sin(a) * d);
        parts.push(vc(g, desert ? (i % 3 ? '#8e9561' : '#a3a06a') : (i % 3 ? '#3d6a28' : '#4b7a2e'), 0.1, (c, x, y, z, ny, k) => c.multiplyScalar(0.55 + 0.4 * Math.max(0, ny) + 0.15 * g.userData.bump[k] + y * 0.15)));
      }
      if (desert && detail) for (let i = 0; i < 6; i++) { const b = new THREE.CylinderGeometry(0.01, 0.025, 0.7, 4).translate(0, 0.35, 0); b.rotateZ((rand() - 0.5) * 1.4); b.rotateY(rand() * 6.28); parts.push(vc(b, '#7a6248', 0.1)); }
      return mergeAll(parts);
    },
    grass: () => {
      // a tuft of grass blades, dark at the root and light at the tips (dry and straw-coloured in the desert)
      const dry = T.theme === 'desert'; const parts = [];
      for (let i = 0; i < D(6, 10, 16); i++) {
        const hgt = 0.3 + rand() * 0.45;
        const g = new THREE.PlaneGeometry(0.055 * D(1.8, 1.3, 1), hgt, 1, D(1, 2, 4)).translate(0, hgt / 2, 0);
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) { const t = p.getY(k) / hgt; p.setX(k, p.getX(k) * (1 - t * 0.92)); p.setZ(k, t * t * (0.12 + rand() * 0.1)); }
        g.rotateY(rand() * 6.28); g.translate((rand() - 0.5) * 0.35, 0, (rand() - 0.5) * 0.35); g.computeVertexNormals();
        parts.push(vc(g, dry ? (i % 2 ? '#b9a26a' : '#a8925a') : (i % 2 ? '#5c8a33' : '#6b9a3a'), 0.1, (c, x, y) => c.multiplyScalar(0.45 + y * 1.3)));
      }
      return mergeAll(parts);
    },
    deadtree: () => {
      // gnarled branches that split and split again
      const parts = [];
      const branch = (from, dir, len, r, depth) => {
        const to = from.clone().addScaledVector(dir, len);
        const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3((rand() - 0.5) * len * 0.3, 0, (rand() - 0.5) * len * 0.3));
        parts.push(vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, to]), D(2, 4, 6), r, D(3, 5, 6)), '#7d6a55', 0.1, bark));
        if (depth > 0) for (let k = 0; k < 2 + (rand() < 0.4 ? 1 : 0); k++) branch(to, dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.5, rand() * 0.5, (rand() - 0.5) * 1.5)).normalize(), len * (0.55 + rand() * 0.2), r * 0.6, depth - 1);
      };
      branch(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 1, 0), 2.3, 0.15, D(2, 3, 3));
      return mergeAll(parts);
    },
    log: () => {
      const g = new THREE.CylinderGeometry(0.3, 0.33, 4, D(7, 10, 16), D(1, 2, 6));
      vc(g, '#5a432e', 0.08, (c, x, y, z, ny) => {
        if (Math.abs(ny) > 0.9) c.set('#b48a5c').multiplyScalar(0.82 + 0.18 * Math.sin(Math.hypot(x, z) * 70));   // the cut ends: tree rings
        else bark(c, x, y, z);
      });
      g.rotateZ(Math.PI / 2); g.translate(0, 0.28, 0);
      return g;
    },
    snowbank: () => {
      const g = lump(smoothGeo(new THREE.SphereGeometry(1.4, D(10, 18, 28), D(4, 7, 12), 0, Math.PI * 2, 0, Math.PI / 2)), 0.16, 1.1, rand() * 9, 3);
      g.scale(1.6, 0.6, 1); g.computeVertexNormals();
      return vc(g, '#f2f6fd', 0.02, (c, x, y, z, ny) => c.multiplyScalar(0.84 + 0.16 * Math.max(0, ny)));
    },
  };
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  const cactusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });   // (open branch layers and grass blades are seen from both sides)
  const MATS = { pine: leafMat, snowpine: leafMat, grass: leafMat, cactus: cactusMat, barrel: cactusMat };
  const NEAR = new Set(['snowbank', 'shrub', 'rock', 'grass', 'barrel']);
  return { PROPS, MATS, NEAR, propMat, leafMat, cactusMat };
}

// ------------------------------------------------------------------ the world
/** Build everything for a track. Returns { scene, sun, place(), heightAt(), fx, update(), ... }. */
export function buildWorld(renderer, T, opts = {}) {
  const th = THEMES[T.theme] || THEMES.desert;
  const quality = opts.quality || 1;
  const scene = new THREE.Scene();
  const rand = rng(T.n * 7919 + T.id.length);

  // ---------------------------------------------------------------- sky, sun, fog, light
  const sky = new Sky(); sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  su.turbidity.value = th.turbidity; su.rayleigh.value = th.rayleigh; su.mieCoefficient.value = th.mie; su.mieDirectionalG.value = th.mieG;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - th.sun[0]), THREE.MathUtils.degToRad(th.sun[1]));
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);
  // the sky also lights the scene and shows in the paint and chrome
  const pm = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); sky2.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = su[k].value;
  skyScene.add(sky2);
  const env = pm.fromScene(skyScene, 0.02).texture;
  scene.environment = env; scene.environmentIntensity = th.envI;
  pm.dispose();
  scene.fog = new THREE.FogExp2(th.fog, th.fogD);
  const sun = new THREE.DirectionalLight(th.sunColor, th.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality > 0.6 ? 2048 : 1024, quality > 0.6 ? 2048 : 1024);
  const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]); scene.add(hemi);

  // ---------------------------------------------------------------- the track's path and the ground's height
  // the ground comes from core.js, so what you see is exactly what the bike rides on
  const S0 = T.S0; const S1 = T.S1;
  const pathAt = (s, out) => C.pathAt(T, s, out);
  const trackY = (s) => C.trackY(T, s);
  const bermAt = (s) => C.bermAt(T, s);
  const TW = C.P.TW;
  const bank = (s, u) => C.bank(T, s, u);
  const height = (s, u) => C.heightAt(T, s, u);

  // ---------------------------------------------------------------- placing things in the world
  const tmpP = {};
  /** World position of track point (s, y, u). */
  function place(s, y, u, out = new THREE.Vector3()) {
    pathAt(s, tmpP);
    return out.set(tmpP.x - Math.sin(tmpP.h) * u, y, tmpP.z + Math.cos(tmpP.h) * u);
  }
  const headingAt = (s) => pathAt(s, tmpP).h;

  // ---------------------------------------------------------------- terrain meshes
  const det = detailMaps(T.id === 'snow' ? 11 : T.id === 'forest' ? 5 : 2);
  det.map.repeat.set(1, 1); det.normal.repeat.set(1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: T.theme === 'snow' ? 0.72 : 0.96, metalness: 0, map: det.map, normalMap: det.normal, normalScale: new THREE.Vector2(0.8, 0.8) });
  const colorOf = (() => {
    const cols = th.ground.map((c) => new THREE.Color(c)); const side = new THREE.Color(th.side); const far = new THREE.Color(th.far); const trk = new THREE.Color(th.track); const rut = new THREE.Color(th.rut);
    const tmp = new THREE.Color(); const tmp2 = new THREE.Color();
    return (s, u, onTrack, steep, out) => {
      const n = fbm(s * 0.08 + 3, u * 0.08, 3);
      const i = Math.min(cols.length - 1, Math.floor(n * cols.length * 0.999));
      tmp.copy(cols[i]).lerp(cols[(i + 1) % cols.length], (n * cols.length) % 1);
      tmp.lerp(far, smooth(25, 140, Math.abs(u)) * 0.7);
      tmp.lerp(side, Math.min(1, steep * 1.4));
      tmp2.copy(trk).lerp(rut, Math.max(0, 1 - Math.abs(Math.abs(u) - 1.1) / 0.6) * 0.35 + (vnoise(s * 0.7, u * 2) - 0.5) * 0.25);
      const kind = C.surfaceAt(T, s);
      if (onTrack > 0 && kind === 1) tmp2.multiplyScalar(0.62);
      if (onTrack > 0 && kind === 2) tmp2.setRGB(0.82, 0.9, 1.0);
      out.copy(tmp).lerp(tmp2, onTrack);
      out.multiplyScalar(0.94 + vnoise(s * 1.7, u * 1.7) * 0.12);
      return out;
    };
  })();
  function ribbon(uList, ds, sFrom, sTo, uvScale, under = 0) {
    const rows = Math.ceil((sTo - sFrom) / ds) + 1; const cols = uList.length;
    const pos = new Float32Array(rows * cols * 3); const col = new Float32Array(rows * cols * 3); const uv = new Float32Array(rows * cols * 2);
    const p = {}; const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const s = sFrom + r * ds;
      pathAt(s, p);
      const sx = -Math.sin(p.h); const sz = Math.cos(p.h);
      for (let k = 0; k < cols; k++) {
        const u = uList[k];
        // far from the track, follow a smoothed path so corners don't fold the ground over itself
        let px = p.x; let pz = p.z; let rx = sx; let rz = sz;
        if (Math.abs(u) > 16) {
          const win = Math.min(90, Math.abs(u) * 0.8); const q1 = pathAt(s - win, {}); const q2 = pathAt(s + win, {});
          const mh = Math.atan2(q2.z - q1.z, q2.x - q1.x);
          const blend = smooth(16, 40, Math.abs(u));
          px += ((q1.x + q2.x) / 2 - p.x) * blend; pz += ((q1.z + q2.z) / 2 - p.z) * blend;
          rx = -Math.sin(mh) * blend + sx * (1 - blend); rz = Math.cos(mh) * blend + sz * (1 - blend);
          const l = Math.hypot(rx, rz); rx /= l; rz /= l;
        }
        const y = height(s, u) - under;
        const i = (r * cols + k);
        pos[i * 3] = px + rx * u; pos[i * 3 + 1] = y; pos[i * 3 + 2] = pz + rz * u;
        const onTrack = 1 - smooth(TW - 0.6, TW + 0.6, Math.abs(u));
        const steep = Math.min(1, Math.abs(height(s, u + 0.5) - height(s, u - 0.5)) * 0.9 + Math.abs(height(s + 0.5, u) - height(s - 0.5, u)) * 0.6) * (1 - onTrack);
        colorOf(s, u, onTrack, steep, c);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        uv[i * 2] = u / uvScale; uv[i * 2 + 1] = s / uvScale;
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
      const a = r * cols + k; const b = a + 1; const c2 = a + cols; const d = c2 + 1;
      idx.push(a, b, c2, b, d, c2);   // (counter-clockwise seen from above)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const near = [];
  for (let u = -13; u <= 13.001; u += (Math.abs(u) < 5 ? 0.5 : Math.abs(u) < 9 ? 0.75 : 1)) near.push(+u.toFixed(3));
  const farU = [];
  for (const side of [-1, 1]) for (const u of [12, 15, 19, 24, 31, 40, 52, 68, 88, 115, 150, 200, 270, 360]) farU.push(side * u);
  farU.sort((a, b) => a - b);
  // the strip along the track is cut into pieces so the ones you can't see aren't drawn
  const ground = new THREE.Group(); scene.add(ground);
  const CH = 120;
  for (let s = S0; s < S1; s += CH) {
    const m = new THREE.Mesh(ribbon(near, 0.5, s, Math.min(S1, s + CH), 6), groundMat);
    m.receiveShadow = true; ground.add(m);
    const f = new THREE.Mesh(ribbon(farU, 2.5, s, Math.min(S1, s + CH), 14, 0.05), groundMat);
    f.receiveShadow = true; ground.add(f);
  }
  // the riding surface: tyre ruts, braking bumps and roost marks, faded at the edges
  const rutTex = canvasTex(256, 512, (g, w, h) => {
    const tc = new THREE.Color(th.track); const rc = new THREE.Color(th.rut);
    g.clearRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.1, '#fff'); grd.addColorStop(0.9, '#fff'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#' + tc.getHexString(); g.fillRect(0, 0, w, h);
    const r2 = rng(99);
    for (let i = 0; i < 160; i++) {   // tyre lines
      const x = w * (0.18 + r2() * 0.64); const lw = 1 + r2() * 3;
      g.strokeStyle = `rgba(${rc.r * 255 | 0},${rc.g * 255 | 0},${rc.b * 255 | 0},${0.04 + r2() * 0.1})`; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.02 + i) * 6, y);
      g.stroke();
    }
    for (let i = 0; i < 900; i++) {   // stones and clods
      g.fillStyle = r2() < 0.5 ? `rgba(0,0,0,${0.05 + r2() * 0.12})` : `rgba(255,255,255,${0.04 + r2() * 0.08})`;
      g.beginPath(); g.ellipse(r2() * w, r2() * h, 0.8 + r2() * 2.5, 0.8 + r2() * 2, r2() * 3, 0, 7); g.fill();
    }
  });
  rutTex.colorSpace = THREE.SRGBColorSpace; rutTex.wrapS = THREE.ClampToEdgeWrapping;
  const rutMat = new THREE.MeshStandardMaterial({ map: rutTex, transparent: true, roughness: T.theme === 'snow' ? 0.55 : 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, normalMap: det.normal });
  for (let s = T.x0; s < T.end; s += CH) {
    const g = ribbon([-TW - 0.4, -TW / 2, 0, TW / 2, TW + 0.4], 0.5, s, Math.min(T.end, s + CH), 1, -0.012);
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) { uvA.setX(i, (i % 5) / 4); uvA.setY(i, uvA.getY(i) / 9); }
    const m = new THREE.Mesh(g, rutMat); m.receiveShadow = true; m.renderOrder = 1; scene.add(m);
  }
  // mud puddles and icy patches: irregular shiny blobs on the riding surface
  const wetMat = T.theme === 'snow'
    ? new THREE.MeshPhysicalMaterial({ color: '#d4e6ff', roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    : new THREE.MeshPhysicalMaterial({ color: '#2a1d10', roughness: 0.16, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.3, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const blobs = [];
  for (const f of T.features.filter((q) => q.kind === 'mud' || q.kind === 'ice')) {
    const n = Math.round((f.x1 - f.x0) / (f.kind === 'mud' ? 2.6 : 3.2));
    for (let i = 0; i < n; i++) {
      const s = f.x0 + 1 + rand() * (f.x1 - f.x0 - 2); const u = (rand() - 0.5) * (TW * 1.6);
      const r = f.kind === 'mud' ? 0.7 + rand() * 1.5 : 1.2 + rand() * 1.8;
      const g = new THREE.CircleGeometry(1, 28);
      const pa = g.attributes.position; const seed = rand() * 50;
      for (let k = 1; k < pa.count; k++) {   // a wobbly edge
        const x = pa.getX(k); const y = pa.getY(k); const a2 = Math.atan2(y, x);
        const m = 0.75 + 0.35 * vnoise(Math.cos(a2) * 2 + seed, Math.sin(a2) * 2 + seed);
        pa.setXY(k, x * m * r * (1.4 + rand() * 0.1), y * m * r);
      }
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, wetMat);
      m.position.copy(place(s, height(s, u) + 0.015, u)); m.rotation.y = -headingAt(s) + (rand() - 0.5) * 0.6;
      m.receiveShadow = true; m.renderOrder = 2; scene.add(m); blobs.push(m);
    }
  }

  // ---------------------------------------------------------------- scenery
  const { PROPS, MATS, NEAR, propMat } = makeProps(T.theme, rand);
  const instances = {};
  const length = S1 - S0;
  const tint = new THREE.Color();
  for (const [kind, density] of th.trees) {
    const geo = PROPS[kind]();
    const count = Math.round(length / 10 * density * quality);
    const perChunk = {};
    for (let i = 0; i < count; i++) {
      const s = S0 + rand() * length;
      const side = rand() < 0.5 ? -1 : 1;
      const near = NEAR.has(kind);
      const u = side * (TW + (kind === 'grass' ? 3 : 4.5) + Math.pow(rand(), near ? 1.6 : 1.1) * (near ? 70 : 150));
      const y = height(s, u);
      // keep clear of the track (also where a corner bends the far side back towards it)
      const pp = place(s, y, u);
      const key = Math.floor((s - S0) / CH);
      (perChunk[key] ||= []).push({ pp, s: (kind === 'pine' || kind === 'snowpine' || kind === 'broadleaf' ? 0.7 + rand() * 0.8 : 0.6 + rand() * 0.9), rot: rand() * 6.28, tilt: kind === 'rock' ? (rand() - 0.5) * 0.5 : (rand() - 0.5) * 0.08 });
    }
    for (const list of Object.values(perChunk)) {
      const im = new THREE.InstancedMesh(geo, MATS[kind] || propMat, list.length);
      const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
      list.forEach((o, i) => {
        e.set(o.tilt, o.rot, o.tilt * 0.5); q.setFromEuler(e);
        m4.compose(o.pp.clone().setY(o.pp.y - 0.05), q, new THREE.Vector3(o.s, o.s * (kind === 'rock' ? 0.8 + rand() * 0.6 : 1), o.s)); im.setMatrixAt(i, m4);
        const k = 0.86 + rand() * 0.28; im.setColorAt(i, tint.setRGB(k * (0.96 + rand() * 0.08), k, k * (0.96 + rand() * 0.08)));   // no two quite alike
      });
      im.castShadow = kind !== 'snowbank' && kind !== 'grass'; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
      (instances[kind] ||= []).push(im);
    }
  }
  // distant mountains, mesas or hills all around
  const mtnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false });
  const mid = place((T.start + T.finish) / 2, 0, 0);
  for (let i = 0; i < 18; i++) {
    const ang = i / 18 * Math.PI * 2 + rand() * 0.3; const dist = 1400 + rand() * 1600;
    let g;
    if (th.mountains === 'mesa') {
      g = new THREE.CylinderGeometry(160 + rand() * 260, 260 + rand() * 300, 120 + rand() * 180, 22, 6);
      wobble(g, 30, 0.012, i); g.translate(0, 60, 0);
      vc(g, '#b5683f', 0.1, (c, x, y) => { c.lerp(new THREE.Color(y > 100 ? '#c98a5a' : '#9a5534'), 0.4 + 0.3 * Math.sin(y * 0.08)); });
    } else {
      const hgt = th.mountains === 'peaks' ? 500 + rand() * 700 : 180 + rand() * 260;
      g = new THREE.ConeGeometry(500 + rand() * 600, hgt, 28, 10); wobble(g, th.mountains === 'peaks' ? 90 : 60, 0.006, i); g.translate(0, hgt / 2 - 20, 0);
      vc(g, th.mountains === 'peaks' ? '#5d6476' : '#2f4a2c', 0.1, th.mountains === 'peaks' ? (c, x, y, z, ny) => { if (y > hgt * 0.15 && ny > 0.25) c.lerp(new THREE.Color('#f2f5fb'), Math.min(1, (y - hgt * 0.15) / (hgt * 0.25))); } : null);
    }
    const m = new THREE.Mesh(g, mtnMat); m.position.set(mid.x + Math.cos(ang) * dist, -40, mid.z + Math.sin(ang) * dist); scene.add(m);
  }
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(9000, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: th.far, roughness: 1 }));
  skirt.position.set(mid.x, -6, mid.z); scene.add(skirt);
  // clouds
  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 18; i++) {
      const x = w * (0.2 + Math.random() * 0.6); const y = h * (0.45 + Math.random() * 0.2); const r = 20 + Math.random() * 34;
      const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    }
  }, false);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  const cloudCol = T.theme === 'snow' ? '#ffd6e4' : T.theme === 'forest' ? '#dfe4e6' : '#ffffff';
  for (let i = 0; i < (T.theme === 'forest' ? 26 : 14); i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: cloudCol, transparent: true, opacity: 0.7, fog: false, depthWrite: false }));
    const ang = rand() * Math.PI * 2; const d = 500 + rand() * 1800;
    sp.position.set(mid.x + Math.cos(ang) * d, 260 + rand() * 300, mid.z + Math.sin(ang) * d);
    sp.scale.set(600 + rand() * 500, 220 + rand() * 120, 1);
    scene.add(sp);
  }

  // ---------------------------------------------------------------- track props: stakes and tape, banners, hay, gates, arches
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6).translate(0, 0.45, 0);
  const posts = [];
  for (let s = T.x0 + 4; s < T.end - 6; s += 6) for (const side of [-1, 1]) {
    const u = side * (TW + 1.3 + (bermAt(s) ? 0.9 : 0)); posts.push(place(s, height(s, u), u));
  }
  const postIM = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: th.fence, roughness: 0.6 }), posts.length);
  posts.forEach((p, i) => postIM.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y - 0.05, p.z)));
  postIM.castShadow = true; scene.add(postIM);
  // the tape between the stakes
  for (const side of [-1, 1]) {
    const pts = [];
    for (let s = T.x0 + 4; s < T.end - 6; s += 3) { const u = side * (TW + 1.3 + (bermAt(s) ? 0.9 : 0)); pts.push(place(s, height(s, u) + 0.72 - (s % 6 ? 0.06 : 0), u)); }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.012, 3, false);
    scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: th.fence === '#ffffff' ? '#ff3b3b' : '#ffffff', roughness: 0.5 })));
  }
  // banners on the fence
  const bannerWords = ['PARTY ARCADE', 'SEND IT', 'MX', 'NITRO', 'FULL GAS', 'PARTY ARCADE MX', 'HOLESHOT', 'BRAAAP'];
  const bannerCols = [[th.arch, '#ffffff'], ['#16181c', '#ffd21a'], ['#ffffff', '#16181c'], ['#d61f2c', '#ffffff'], ['#1747c9', '#ffffff']];
  const bannerMats = bannerWords.map((wd, i) => {
    const [bg, fg] = bannerCols[i % bannerCols.length];
    const t = canvasTex(512, 96, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = 'italic 900 62px Kanit, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(wd, w / 2, h / 2 + 4); g.fillRect(0, h - 8, w, 8); }, false);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide });
  });
  const bannerGeo = new THREE.PlaneGeometry(4.2, 0.8);
  const bannerPost = new THREE.CylinderGeometry(0.035, 0.04, 1.35, 8).translate(0, 0.675, 0);
  const bannerPostMat = new THREE.MeshStandardMaterial({ color: '#d9dde3', metalness: 0.8, roughness: 0.35 });
  for (let s = T.start + 20, i = 0; s < T.finish; s += 34 + rand() * 30, i++) {
    const side = i % 2 ? 1 : -1; const u = side * (TW + 2.4 + (bermAt(s) ? 1.2 : 0));
    const g = new THREE.Group();
    const b = new THREE.Mesh(bannerGeo, bannerMats[i % bannerMats.length]); b.position.y = 0.85; b.castShadow = true; g.add(b);
    for (const x of [-2.12, 2.12]) { const post = new THREE.Mesh(bannerPost, bannerPostMat); post.position.set(x, -0.15, -0.03); post.castShadow = true; g.add(post); }   // (on two posts, like at a real track)
    g.position.copy(place(s, height(s, u), u)); g.rotation.y = -headingAt(s) + (side > 0 ? Math.PI : 0);   // (facing the track)
    scene.add(g);
  }
  // hay bales and tyre stacks on the outside of corners and next to the jumps
  const strawTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#d8b75a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 600; i++) { g.strokeStyle = Math.random() < 0.5 ? '#b8933e' : '#efd486'; g.lineWidth = 1; g.beginPath(); const x = Math.random() * w; const y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 4); g.stroke(); } g.fillStyle = 'rgba(70,45,20,.6)'; for (const y of [0.3, 0.7]) g.fillRect(0, h * y, w, 3); });
  strawTex.colorSpace = THREE.SRGBColorSpace;
  const hayGeo = new RoundedHay();
  const hayMat = new THREE.MeshStandardMaterial({ map: strawTex, roughness: 0.95 });
  const hay = [];
  for (const f of T.features) {
    if (f.kind === 'turn') {
      const outer = f.deg > 0 ? -1 : 1;
      for (let s = f.x0; s < f.x1; s += 2.6) hay.push([s, outer * (TW + 3.2)]);
    } else if (f.top != null || f.kind === 'kicker') {
      for (const side of [-1, 1]) hay.push([f.x0 - 3, side * (TW + 2.6)]);
    }
  }
  const hayIM = new THREE.InstancedMesh(hayGeo, hayMat, hay.length);
  hay.forEach(([s, u], i) => {
    const p = place(s, height(s, u) + 0.3, u);
    hayIM.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -headingAt(s)), new THREE.Vector3(1, 1, 1)));
  });
  hayIM.castShadow = true; hayIM.receiveShadow = true; scene.add(hayIM);
  // stacks of old tyres by the jumps
  const tyreGeo = mergeAll([0, 1, 2].map((k) => { const t = new THREE.TorusGeometry(0.3, 0.13, 10, 22).rotateX(Math.PI / 2); t.translate((k % 2) * 0.03, 0.13 + k * 0.25, 0); return t; }));
  const tyreSpots = [];
  for (const f of T.features) if (f.top != null || f.kind === 'kicker') for (const side of [-1, 1]) tyreSpots.push([f.x0 - 5.5, side * (TW + 3.4)]);
  const tyreIM = new THREE.InstancedMesh(tyreGeo, new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.92 }), Math.max(1, tyreSpots.length));
  tyreSpots.forEach(([s, u], i) => tyreIM.setMatrixAt(i, new THREE.Matrix4().makeTranslation(place(s, height(s, u) - 0.03, u))));
  tyreIM.count = tyreSpots.length; tyreIM.castShadow = true; tyreIM.receiveShadow = true; scene.add(tyreIM);

  // the start gate, checkpoint arches and the finish arch
  const archMat = new THREE.MeshPhysicalMaterial({ color: th.arch, roughness: 0.45, clearcoat: 0.6, sheen: 1, sheenColor: new THREE.Color('#ffffff') });
  const label = (text, bg, fg, checker) => {
    const t = canvasTex(1024, 160, (g, w, h) => {
      if (checker) { for (let x = 0; x < w; x += 40) for (let y = 0; y < h; y += 40) { g.fillStyle = ((x + y) / 40) % 2 ? '#111' : '#fff'; g.fillRect(x, y, 40, 40); } g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(w * 0.25, 20, w * 0.5, h - 40); }
      else { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.fillStyle = fg; g.font = 'italic 900 110px Kanit, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 6);
    }, false);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, side: THREE.DoubleSide });
  };
  function arch(s, text, mat, banner) {
    const g = new THREE.Group();
    const span = TW + 2.4; const hgt = 5.2;
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = Math.PI * i / 24; pts.push(new THREE.Vector3(0, Math.sin(a) * hgt, -Math.cos(a) * span)); }
    const tubeM = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.5, 16), mat); tubeM.castShadow = true; g.add(tubeM);
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.5, span * 1.5 * 160 / 1024 * 1.4), banner); bn.position.set(-0.05, hgt - 0.45, 0); bn.rotation.y = -Math.PI / 2; g.add(bn);   // (facing riders coming up to it)
    const p = place(s, trackY(s), 0); g.position.copy(p); g.rotation.y = -headingAt(s);
    scene.add(g);
    return g;
  }
  arch(T.finish, 'FINISH', new THREE.MeshPhysicalMaterial({ color: '#f2f2f2', roughness: 0.45, sheen: 1 }), label('FINISH', '#111', '#ffffff', true));
  T.cps.forEach((s, i) => arch(s, 'CHECKPOINT', archMat, label(`CHECKPOINT ${i + 1}`, th.arch, '#ffffff')));
  // start gate: a row of drop-down gates and a banner over the line
  const gate = new THREE.Group();
  const gateMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.9, roughness: 0.35 });
  const gateTex = canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#b8bec7'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5d636c'; for (let y = 34; y < h - 8; y += 12) for (let x = 8 + (y / 12 % 2) * 6; x < w - 4; x += 12) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }   // punched holes
    g.fillStyle = '#ffd21a'; g.fillRect(0, 0, w, 24);   // a hazard stripe along the top
    g.fillStyle = '#16181c'; for (let x = -24; x < w; x += 28) { g.beginPath(); g.moveTo(x, 24); g.lineTo(x + 14, 24); g.lineTo(x + 38, 0); g.lineTo(x + 24, 0); g.fill(); }
  }, false);
  gateTex.colorSpace = THREE.SRGBColorSpace;
  const gateFace = new THREE.MeshStandardMaterial({ map: gateTex, metalness: 0.65, roughness: 0.4 });
  const gates = [];
  for (let k = -3; k <= 3; k++) {
    const gg = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 1.08), [gateFace, gateFace, gateMat, gateMat, gateMat, gateMat]); bar.position.set(0, 0.3, 0); bar.castShadow = true; gg.add(bar);
    const num = label(String(k + 4), '#16181c', '#ffffff');
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), num); plate.position.set(-0.04, 0.32, 0); plate.rotation.y = -Math.PI / 2; gg.add(plate);
    gg.position.set(0, 0, k * 1.15); gate.add(gg); gates.push(gg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 8.6), gateMat); beam.position.set(0.05, 0.05, 0); gate.add(beam);
  // the pen behind the gate: end posts, rails down both sides, and a billboard at the back
  const railMat = new THREE.MeshStandardMaterial({ color: '#f2f4f7', metalness: 0.5, roughness: 0.4 });
  for (const z of [-4.35, 4.35]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), gateMat); post.position.set(0.05, 0.55, z); post.castShadow = true; gate.add(post);
    for (const y of [0.45, 0.95]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.2, 8), railMat); rail.rotation.z = Math.PI / 2; rail.position.set(-2.55, y, z); rail.castShadow = true; gate.add(rail); }
    for (const x of [-2.6, -5.1]) { const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8).translate(0, 0.52, 0), railMat); p2.position.set(x, 0, z); gate.add(p2); }
  }
  const board = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.6), label('PARTY ARCADE MX', th.arch, '#ffffff'));
  board.position.set(-7.5, 2.3, 0); board.rotation.y = Math.PI / 2; board.castShadow = true; gate.add(board);   // (facing the gate)
  for (const z of [-3.9, 3.9]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 3.1, 8).translate(0, 1.55, 0), gateMat); leg.position.set(-7.55, 0, z); gate.add(leg); }
  const sp0 = place(T.start + 1.1, trackY(T.start + 1.1), 0); gate.position.copy(sp0); gate.rotation.y = -headingAt(T.start);
  scene.add(gate);
  arch(T.start + 6, 'START', archMat, label('PARTY ARCADE MX', '#16181c', '#ffffff'));
  // lamp posts (snow track at dusk)
  const glows = [];
  if (th.lamps) {
    const glowTex = canvasTex(64, 64, (g, w, h) => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,230,190,1)'); grd.addColorStop(0.25, 'rgba(255,200,140,.55)'); grd.addColorStop(1, 'rgba(255,180,120,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, false);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.5 });
    const headMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd8a0', emissiveIntensity: 4 });
    for (let s = T.x0 + 10, i = 0; s < T.end; s += 28, i++) {
      const side = i % 2 ? 1 : -1; const u = side * (TW + 4);
      const p = place(s, height(s, u), u);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 8).translate(0, 3, 0), poleMat); pole.position.copy(p); pole.castShadow = true; scene.add(pole);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), headMat); hd.position.copy(p).add(new THREE.Vector3(0, 6, 0)); scene.add(hd);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd9a8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); glow.position.copy(hd.position); glow.scale.set(5, 5, 1); scene.add(glow); glows.push(glow);
      // a warm pool of light on the snow
      const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffc890', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.position.copy(p).add(new THREE.Vector3(-side * Math.sin(-headingAt(s)) * 2, 0.08, 0)); scene.add(pool);
    }
  }

  // ---------------------------------------------------------------- particles
  const fx = particles(scene, th, T);

  return {
    scene, sun, hemi, theme: th, T, place, headingAt, height, trackY, bank, fx, gates, TW,
    /** Keep the sun's shadow box on the rider and move ambient effects. */
    update(focus, dt, camera) {
      sun.position.copy(focus).addScaledVector(sunDir, 120);
      sun.target.position.copy(focus);
      fx.update(dt, camera);
    },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { for (const k of ['map', 'normalMap']) if (m[k]) m[k].dispose(); m.dispose(); }); } });
      env.dispose();
    },
  };
}

/** A hay bale: a rounded block. */
function RoundedHay() {
  const g = new THREE.BoxGeometry(1.2, 0.6, 0.6, 6, 3, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const k = 0.92 + 0.08 * (1 - Math.max(Math.abs(y) / 0.3, Math.abs(z) / 0.3) ** 4);
    p.setXYZ(i, x * (0.98 + Math.random() * 0.03), y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function RoundedBoxGeometryLite(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

// ------------------------------------------------------------------ particles
export function particles(scene, th, T, quality = 1) {
  const softTex = canvasTex(64, 64, (g, w, h) => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, false);
  const vert = `attribute float size; attribute float alpha; attribute vec3 tint; varying float vA; varying vec3 vC;
    #include <fog_pars_vertex>
    void main(){ vA = alpha; vC = tint; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (520.0 / -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
    }`;
  const frag = `uniform sampler2D map; varying float vA; varying vec3 vC;
    #include <fog_pars_fragment>
    void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA);
    #include <fog_fragment>
    }`;
  function system(max, tex, blending = THREE.NormalBlending) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3); const size = new Float32Array(max); const alpha = new Float32Array(max); const tint = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: tex } }]), vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending, fog: true });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
    const P = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a: 1, r: 1, g: 1, b: 1, grav: 0, drag: 0 }));
    let next = 0;
    return {
      emit(x, y, z, vx, vy, vz, o) {
        const p = P[next]; next = (next + 1) % max;
        Object.assign(p, { x, y, z, vx, vy, vz, life: o.life, max: o.life, s0: o.size, s1: o.grow ?? o.size * 2.5, a: o.alpha ?? 0.6, grav: o.grav ?? 0, drag: o.drag ?? 1.5 });
        const c = o.color; p.r = c.r; p.g = c.g; p.b = c.b;
      },
      update(dt) {
        for (let i = 0; i < max; i++) {
          const p = P[i];
          if (p.life <= 0) { alpha[i] = 0; continue; }
          p.life -= dt;
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const t = 1 - Math.max(0, p.life) / p.max;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          size[i] = p.s0 + (p.s1 - p.s0) * t;
          alpha[i] = p.a * Math.min(1, t * 6) * (1 - t);
          tint[i * 3] = p.r; tint[i * 3 + 1] = p.g; tint[i * 3 + 2] = p.b;
        }
        for (const k of ['position', 'size', 'alpha', 'tint']) g.attributes[k].needsUpdate = true;
      },
    };
  }
  const puffs = system(Math.round(700 * quality), softTex);
  const chunks = system(Math.round(500 * quality), softTex);
  const colors = { puff: new THREE.Color(th.puff), chunk: new THREE.Color(th.chunk), mud: new THREE.Color('#3b2a1a'), white: new THREE.Color('#ffffff'), smoke: new THREE.Color('#9aa0a8'), snow: new THREE.Color('#ffffff') };
  // falling snow around the camera
  let flakes = null;
  if (th.snowing) {
    const n = Math.round(1400 * quality); const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 80; p[i * 3 + 1] = Math.random() * 40; p[i * 3 + 2] = (Math.random() - 0.5) * 80; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    flakes = new THREE.Points(g, new THREE.PointsMaterial({ map: softTex, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false, color: '#ffffff' }));
    flakes.frustumCulled = false; scene.add(flakes);
  }
  return {
    colors,
    puff(x, y, z, vx, vy, vz, o) { puffs.emit(x, y, z, vx, vy, vz, o); },
    chunk(x, y, z, vx, vy, vz, o) { chunks.emit(x, y, z, vx, vy, vz, o); },
    update(dt, camera) {
      puffs.update(dt); chunks.update(dt);
      if (flakes && camera) {
        const p = flakes.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          let x = p.getX(i); let y = p.getY(i) - dt * (1.2 + (i % 7) * 0.12); let z = p.getZ(i);
          x += Math.sin(y * 0.6 + i) * dt * 0.4;
          // keep the flakes in a box around the camera
          const cx = camera.position.x; const cy = camera.position.y; const cz = camera.position.z;
          if (y < cy - 12) y += 40; if (x - cx > 40) x -= 80; if (cx - x > 40) x += 80; if (z - cz > 40) z -= 80; if (cz - z > 40) z += 80;
          if (y > cy + 28) y -= 40;
          p.setXYZ(i, x, y, z);
        }
        p.needsUpdate = true;
      }
    },
  };
}
