/* Mini Golf — low-poly 3D mini golf, solo or online. The courses and the ball physics are in
   golf-core.js; this file draws the holes with three.js and runs the menus, aiming, the HUD,
   scorecards and online games (everyone plays the same hole at once, the others are ghost balls). */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, Account, Profile } = PA;
  const FX = PA.FX || {};
  const C = window.GolfCore;
  const P = C.P;
  const DT = P.DT;
  const calm = () => document.documentElement.classList.contains('calm');

  const THEMES = {
    meadow: {
      sky: ['#3f9cf5', '#9dd3ff', '#e9f7ff'], fog: 0xcfe6f5, fogNear: 34, fogFar: 110, stars: false,
      hemi: [0xeaf6ff, 0x5d7a3a, 0.58], sun: [0xfff0d2, 0.72], sunDir: [-0.55, 1, 0.65],
      turf: [0x52c43f, 0x46b236], turfEdge: 0x2f7f27, sand: 0xf0d48a, rim: 0x6a4a2a,
      ground: [0x6a9f45, 0x62953f, 0x73a84c], rail: 0xb9773f, railTop: 0xe3a86a, post: 0x8e5628, postTop: 0xf0bf80,
      skirt: 0x8d5b33, skirt2: 0x6d4325, water: 0x3b9fe8, waterGlow: 0x06243f, bed: 0x2b6aa8, plank: [0xc58f57, 0xb27c47], pit: 'creek',
      shore: 0xb9b2a4, glow: 0xfff2b0,
    },
    spooky: {
      sky: ['#04020c', '#160a2e', '#3c1b5e'], fog: 0x2a1748, fogNear: 14, fogFar: 62, stars: true,
      hemi: [0xa99cff, 0x1d1236, 0.62], sun: [0xc2ccff, 0.78], sunDir: [0.5, 1, -0.55],
      turf: [0x3f8c5c, 0x387f52], turfEdge: 0x21573a, sand: 0x4d3c58, rim: 0x2c2238,
      ground: [0x262040, 0x211b37, 0x2c2449], rail: 0x585273, railTop: 0x837ba2, post: 0x3f3958, postTop: 0x9b93bf,
      skirt: 0x2d2742, skirt2: 0x1d1830, water: 0x167a48, waterGlow: 0x0c4a2a, bed: 0x0e3b2a, plank: [0x5e4838, 0x4f3c2f], pit: 'void',
      shore: 0x3b3550, glow: 0xffb347,
      rock: 0x5d5873, bumper: 'pumpkin', farY: 0.3, hills: [0.5, 0.5], flag: '#ff7a18', knob: 0xff9a3c, swirl: 'rgba(200,140,255,.9)',
      sign: ['#3b2f52', '#1d1630', '#ffb347', 0x2a2140], pitFloor: 0x1a0b30, pitGlow: 0x9b4dff, pitMist: 0xc084fc, reeds: 0x3c4a35,
      items: [['deadtree', 0.22], ['grave', 0.26], ['rock', 0.14], ['pumpkin', 0.1], ['cross', 0.1], ['mushroom', 0.1], ['fencebit', 0.08]], near: 'grave',
      fx: { bump: [0xffa53a, 0xffd34d], land: 0x8a7aa8, tele: [0xc084fc, 0x7c3aed, 0xffffff], splash: [0x7dffb5, 0x45ff9d, 0xd9ffe8] },
      splashText: 'SPLOOSH!', gapText: 'INTO THE CRYPT!',
      mill: { body: 0x3c3350, trim: 0x231c33, base: 0x4a4262, stone: 0x6b6288, window: 0xffb347, blade: 0x120a1f, sail: 0x1a0d2a, cap: 0x2a1f3b },
    },
    desert: {
      sky: ['#e58447', '#f8cb93', '#fff0d4'], fog: 0xf1d3a8, fogNear: 36, fogFar: 120, stars: false,
      hemi: [0xfff1d6, 0x9a6a3a, 0.62], sun: [0xfff0d0, 0.86], sunDir: [-0.6, 1, 0.45],
      turf: [0x86c24e, 0x79b545], turfEdge: 0x4f7f2c, sand: 0xe9c483, rim: 0x9a5a2e,
      ground: [0xd9a066, 0xcf955b, 0xe4b077], rail: 0xa0522d, railTop: 0xd98c5a, post: 0x7a3d20, postTop: 0xe8a06a,
      skirt: 0xb36b3a, skirt2: 0x8a4e28, water: 0x3fb5c9, waterGlow: 0x0a3b44, bed: 0x2a7f8c, plank: [0xb98552, 0xa6743f], pit: 'canyon',
      shore: 0xc08a5a, glow: 0xffe0a0,
      rock: 0xb8673a, bumper: 'cactus', farY: 2.6, hills: [2, 2.2], flag: '#e0482f', knob: 0xffc23d,
      sign: ['#e7b57a', '#8a4e28', '#5a2a12', 0xa0522d], pitFloor: 0x8a5a36,
      items: [['cactus', 0.32], ['rock', 0.24], ['drybush', 0.2], ['skull', 0.08], ['tumbleweed', 0.16]], near: 'drybush',
      fx: { bump: [0x7cc04a, 0xff7ab6, 0xffffff], land: 0xe9c483, tele: [0xffd27a, 0xffffff] }, gapText: 'INTO THE CANYON!',
      mill: { body: 0xe7c39a, trim: 0xb5562f, base: 0xc49a6c, stone: 0x9a6a44, window: 0x4a7fb0, blade: 0x7a4a26, sail: 0xfbe9cf, cap: 0xb5562f },
    },
    winter: {
      sky: ['#5b9fe0', '#b8dcf8', '#f2f8ff'], fog: 0xe1ecf7, fogNear: 30, fogFar: 105, stars: false,
      hemi: [0xf0f6ff, 0x8aa0b8, 0.64], sun: [0xffffff, 0.72], sunDir: [-0.5, 1, 0.6],
      turf: [0x67b866, 0x5cac5c], turfEdge: 0x3a7444, sand: 0xf3f7fd, rim: 0x8fb3d1, ice: 0x9fd6f5,
      ground: [0xdfe8f2, 0xd3dfec, 0xe9f0f7], rail: 0x5f87b0, railTop: 0xf4f8fc, post: 0x4a6b8f, postTop: 0xffffff,
      skirt: 0xc4d4e6, skirt2: 0x8fa6bf, water: 0x4f9fd6, waterGlow: 0x0b2f4a, bed: 0x2e5f87, plank: [0x9c7b5a, 0x8a6a4b], pit: 'void',
      shore: 0xd6e2ee, glow: 0xffffff,
      rock: 0x8e9aab, bumper: 'snow', farY: 2.4, hills: [1.8, 2], flag: '#2f7fd8', knob: 0xffffff,
      sign: ['#dff0ff', '#4a6b8f', '#24476e', 0x5f87b0], pitFloor: 0x173a5c, pitGlow: 0x7fd3ff, pitMist: 0xd8f1ff,
      items: [['snowpine', 0.42], ['rock', 0.14], ['drift', 0.22], ['pine', 0.12], ['snowman', 0.06]], near: 'drift',
      fx: { bump: [0xffffff, 0xbfe8ff], land: 0xffffff, tele: [0xbfe8ff, 0xffffff] }, splashText: 'BRRR… SPLASH!', gapText: 'DOWN THE CREVASSE!',
      mill: { body: 0xffffff, trim: 0x3b82c4, base: 0xb8c6d4, stone: 0x8e9aab, window: 0xffd27a, blade: 0x6b5236, sail: 0xf4f8ff, cap: 0x3b82c4 },
    },
    beach: {
      sky: ['#1f9cf5', '#94defc', '#eafbff'], fog: 0xcdeffa, fogNear: 36, fogFar: 125, stars: false,
      hemi: [0xf2fbff, 0xb79b63, 0.62], sun: [0xfff3d6, 0.84], sunDir: [-0.55, 1, 0.6],
      turf: [0x4fc95a, 0x44bb4f], turfEdge: 0x2c8a3a, sand: 0xf6dfa3, rim: 0xa8743d,
      ground: [0xf2d9a0, 0xead095, 0xf7e2ae], rail: 0xd4a066, railTop: 0xf0c98a, post: 0xa87444, postTop: 0xf3d29a,
      skirt: 0xd9b77a, skirt2: 0xb8955c, water: 0x1fc7d4, waterGlow: 0x053f47, bed: 0x37b7ba, plank: [0xc4935a, 0xb07f48], pit: 'creek',
      shore: 0xf0d8a0, glow: 0xfff3b0,
      rock: 0xa49b8c, bumper: 'ball', farY: 0.12, hills: [0.25, 0.35], farWater: true, flag: '#ff5a36', knob: 0xffd23f,
      sign: ['#ffe2a8', '#a87444', '#6a3a14', 0xd4a066],
      items: [['palm', 0.36], ['rock', 0.14], ['bush', 0.18], ['starfish', 0.16], ['umbrella', 0.08], ['surfboard', 0.08]], near: 'starfish',
      fx: { bump: [0xff4f6b, 0xffd23f, 0x2fa8ff, 0xffffff], land: 0xf6dfa3, tele: [0xffffff, 0x9be3ff] },
      mill: { body: 0xfdf3d6, trim: 0x1fa3b8, base: 0xd7b98a, stone: 0xb59a70, window: 0x1fa3b8, blade: 0x8a5a32, sail: 0xffffff, cap: 0xff5a36 },
    },
    volcano: {
      sky: ['#0b0304', '#3a0c08', '#8f2c10'], fog: 0x2c100b, fogNear: 20, fogFar: 78, stars: true,
      hemi: [0xffb38a, 0x2a1210, 0.62], sun: [0xffc9a0, 0.72], sunDir: [0.45, 1, -0.55],
      turf: [0x4f7f3e, 0x467336], turfEdge: 0x2a4524, sand: 0x5d5250, rim: 0x6b2a18,
      ground: [0x2c2321, 0x251e1c, 0x332826], rail: 0x3e3533, railTop: 0x5d524f, post: 0x2c2524, postTop: 0x7a6e6a,
      skirt: 0x322a29, skirt2: 0x1e1817, water: 0xff5a1a, waterGlow: 0xd83000, bed: 0x8a1e05, plank: [0x5a4636, 0x4a392c], pit: 'void',
      shore: 0x3a302e, glow: 0xff7a2a, lava: true,
      rock: 0x463c3a, bumper: 'lava', farY: 1, hills: [1.2, 1.4], flag: '#ffb400', knob: 0xff5a1a, swirl: 'rgba(255,170,90,.9)',
      sign: ['#2c2423', '#ff6a1a', '#ffb070', 0x2c2524], pitFloor: 0xb83208, pitGlow: 0xff5a1a, pitMist: 0xff9a4a,
      items: [['basalt', 0.32], ['rock', 0.22], ['deadtree', 0.14], ['crystal', 0.16], ['vent', 0.16]], near: 'vent',
      fx: { bump: [0xff7a2a, 0xffd34d], land: 0x6a5a56, tele: [0xff9a4a, 0xffd34d, 0xffffff], splash: [0xff7a2a, 0xffd34d, 0xff3b1a] },
      splashText: 'SIZZLE!', gapText: 'TOO HOT!',
      mill: { body: 0x3a302e, trim: 0xff6a1a, base: 0x2a2423, stone: 0x5d524f, window: 0xffb347, blade: 0x1e1817, sail: 0x5a1a0a, cap: 0xff6a1a },
    },
  };
  // what each look falls back on (the sunny meadow)
  const THEME_BASE = {
    rock: 0x9b978f, bumper: 'classic', farY: 2.2, hills: [1.6, 1.8], farWater: false, lava: false, flag: '#ef3b4f', knob: 0xfacc15,
    swirl: 'rgba(255,255,255,.85)', sign: ['#e0b277', '#8a5a2e', '#5a3418', 0xb07a45], ice: 0xbfe8ff,
    pitFloor: 0x4b3a2a, pitGlow: 0x9b4dff, pitMist: 0xc084fc, reeds: 0x5b8f3a,
    items: [['tree', 0.36], ['pine', 0.16], ['bush', 0.2], ['rock', 0.12], ['flowers', 0.16]], near: 'bush',
    fx: { bump: [0xffd23f, 0xffffff, 0xef3b4f], land: 0xd8f5c0, tele: [0xffffff, 0xfde68a], splash: [0xbfe6ff, 0x7cc8ff, 0xffffff] },
    splashText: 'SPLASH!', gapText: 'SPLASH!',
    mill: { body: 0xf6efe2, trim: 0xd2493b, base: 0xa8a29a, stone: 0x857d73, window: 0x5b88b5, blade: 0x8a5a32, sail: 0xfdf7ea, cap: 0xd2493b },
  };
  for (const [id, th] of Object.entries(THEMES)) THEMES[id] = { ...THEME_BASE, ...th, fx: { ...THEME_BASE.fx, ...th.fx }, id };
  const SCORE = (n, par) => {
    if (n === 1) return ['HOLE IN ONE!', '#facc15', 'ace'];
    const d = n - par;
    if (d <= -3) return ['ALBATROSS!', '#facc15', 'eagle'];
    if (d === -2) return ['EAGLE!', '#22d3ee', 'eagle'];
    if (d === -1) return ['BIRDIE!', '#a3e635', 'birdie'];
    if (d === 0) return ['PAR', '#ffffff', ''];
    if (d === 1) return ['BOGEY', '#fdba74', 'bogey'];
    if (d === 2) return ['DOUBLE BOGEY', '#fb7185', 'dbl'];
    return [`+${d}`, '#fb7185', 'dbl'];
  };
  const vsPar = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);
  const bestKey = (id) => 'golf_best_' + id;
  const stage = $('#stage');

  // ------------------------------------------------------------------ 3D setup
  let renderer = null; let scene; let camera; let hemi; let sun;
  let viewW = 800; let viewH = 450;
  function setup3d() {
    if (renderer) return true;
    if (!window.THREE) { UI.toast('Mini Golf needs an internet connection to load its 3D engine 😕', 'bad', 5000); return false; }
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.prepend(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 700);
    hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.75);
    sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    scene.add(hemi, sun, sun.target);
    const resize = () => {
      const r = stage.getBoundingClientRect();
      viewW = Math.max(1, r.width); viewH = Math.max(1, r.height);
      renderer.setSize(viewW, viewH, false);
      camera.aspect = viewW / viewH;
      camera.fov = viewW < viewH ? 62 : 50;
      camera.updateProjectionMatrix();
      Parts.scale(viewH);
    };
    new ResizeObserver(resize).observe(stage);
    resize();
    bindInput(renderer.domElement);
    return true;
  }

  // ------------------------------------------------------------------ geometry helpers
  const col = (hex) => new THREE.Color(hex);
  const _n = new THREE.Vector3(); const _a = new THREE.Vector3(); const _b = new THREE.Vector3();
  /** Builds one vertex-coloured mesh out of many triangles (one draw call). */
  class Geo {
    constructor() { this.p = []; this.c = []; }
    tri(a, b, c, k, up) {
      if (up) {
        _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        _n.crossVectors(_a, _b);
        if (_n.x * up[0] + _n.y * up[1] + _n.z * up[2] < 0) { const t = b; b = c; c = t; }
      }
      this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) this.c.push(k.r, k.g, k.b);
    }
    quad(a, b, c, d, k, up) { this.tri(a, b, c, k, up); this.tri(a, c, d, k, up); }
    /** Add a three.js geometry, moved by a matrix, in one colour (each face a little varied by jitter). */
    add(geo, m, k, jitter = 0, rnd = Math.random) {
      const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
      const a = g.attributes.position.array;
      const ca = g.attributes.color ? g.attributes.color.array : null;
      const tmp = new THREE.Color();
      for (let i = 0; i < a.length; i += 9) {
        tmp.copy(k);
        if (jitter) tmp.offsetHSL(0, 0, (rnd() - 0.5) * jitter);
        for (let j = 0; j < 9; j++) this.p.push(a[i + j]);
        for (let v = 0; v < 3; v++) {
          if (ca) this.c.push(ca[i + v * 3] * tmp.r, ca[i + v * 3 + 1] * tmp.g, ca[i + v * 3 + 2] * tmp.b);
          else this.c.push(tmp.r, tmp.g, tmp.b);
        }
      }
      g.dispose();
    }
    mesh(mat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    }
  }
  const M4 = new THREE.Matrix4(); const Q = new THREE.Quaternion(); const V = new THREE.Vector3(); const S3 = new THREE.Vector3(); const E = new THREE.Euler();
  const mat4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E); V.set(x, y, z); S3.set(sx, sy, sz);
    return new THREE.Matrix4().compose(V.clone(), Q.clone(), S3.clone());
  };
  const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const hash = (str) => { let x = 7; for (const ch of str) x = (x * 31 + ch.charCodeAt(0)) % 2147483646; return x + 1; };
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let PRIM = null;
  const prim = () => PRIM || (PRIM = {
    box: new THREE.BoxGeometry(1, 1, 1), ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1),
    dode: new THREE.DodecahedronGeometry(1, 0), cone: new THREE.ConeGeometry(1, 1, 7), cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
    cyl12: new THREE.CylinderGeometry(1, 1, 1, 14), sph: new THREE.SphereGeometry(1, 10, 7), half: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false, -Math.PI / 2, Math.PI),
    oct: new THREE.CylinderGeometry(0.72, 1, 1, 8),
  });
  const MATS = {};
  const vcMat = () => MATS.vc || (MATS.vc = new THREE.MeshLambertMaterial({ vertexColors: true }));
  let glowTex = null; let dotTex = null; let softTex = null;
  function textures() {
    if (glowTex) return;
    const radial = (size, stops) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      stops.forEach(([o, s]) => g.addColorStop(o, s));
      x.fillStyle = g; x.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(c);
    };
    glowTex = radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]);
    dotTex = radial(64, [[0, 'rgba(255,255,255,1)'], [0.6, 'rgba(255,255,255,1)'], [0.75, 'rgba(255,255,255,0)']]);
    // a soft cloud for fog banks
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const rnd = seeded(99);
    for (let i = 0; i < 26; i++) {
      const px = 50 + rnd() * 156; const py = 90 + rnd() * 76; const r = 30 + rnd() * 50;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    }
    softTex = new THREE.CanvasTexture(c);
  }
  const glow = (color, size, opacity = 0.8) => {
    textures();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.set(size, size, 1);
    return s;
  };
  function canvasTex(w, hh, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    draw(c.getContext('2d'), w, hh);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }
  function skyTexture(th) {
    return canvasTex(64, 512, (x, w, hh) => {
      const g = x.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, th.sky[0]); g.addColorStop(0.55, th.sky[1]); g.addColorStop(1, th.sky[2]);
      x.fillStyle = g; x.fillRect(0, 0, w, hh);
      if (th.stars) {
        const r = seeded(5);
        for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.7})`; x.fillRect(r() * w, r() * hh * 0.6, r() < 0.15 ? 1.5 : 0.8, r() < 0.15 ? 1.5 : 0.8); }
      }
    });
  }

  // ------------------------------------------------------------------ building a hole
  const built = new Map();
  function holeScene(hd, themeId) {
    if (built.has(hd.id)) return built.get(hd.id);
    const H = C.build(hd);
    const th = THEMES[themeId];
    const spooky = themeId === 'spooky';
    const grp = new THREE.Group();
    const rnd = seeded(hash(hd.id));
    const anim = [];          // things that move every frame: (t, dt) => void
    const bumperObjs = [];
    let moonObj = null;
    const { W, D } = H;
    const ch = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? '#' : hd.map[z][x]);
    const code = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? C.VOID : H.code[z * W + x]);
    const sh = (x, z) => C.surface(H, x, z, {}).h;
    const GROUND = -0.34;
    const BED = -0.62;
    const PIT = th.pit === 'creek' ? -1.6 : th.pit === 'canyon' ? -2.4 : -3.2;

    // distance to the nearest rail or block (for darkening the turf next to them)
    const wallDist = (x, z) => {
      const ix = Math.floor(x); const iz = Math.floor(z);
      if (ix < 0 || iz < 0 || ix >= W || iz >= D) return 9;
      let best = 9;
      for (const wi of H.near[iz * W + ix].w) {
        const s = H.walls[wi];
        const ex = s.bx - s.ax; const ez = s.bz - s.az;
        const u = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (s.len * s.len)));
        best = Math.min(best, Math.hypot(x - s.ax - ex * u, z - s.az - ez * u));
      }
      return best;
    };
    const K = {
      turfA: col(th.turf[0]), turfB: col(th.turf[1]), edge: col(th.turfEdge), sand: col(th.sand), rim: col(th.rim),
      rail: col(th.rail), railTop: col(th.railTop), post: col(th.post), postTop: col(th.postTop), skirt: col(th.skirt), skirt2: col(th.skirt2),
      bed: col(th.bed), shore: col(th.shore), plankA: col(th.plank[0]), plankB: col(th.plank[1]), ice: col(th.ice),
    };
    const tmpC = new THREE.Color();
    // sand drawn as rounded bunkers: how much sand is around a point
    const sandAt = (x, z) => {
      let n = 0; let t = 0;
      for (let dz = -0.5; dz <= 0.51; dz += 0.25) for (let dx = -0.5; dx <= 0.51; dx += 0.25) { t++; if (C.floorAt(H, x + dx, z + dz) === C.SAND) n++; }
      return n / t;
    };
    const turfColor = (x, z) => {
      if (C.floorAt(H, x, z) === C.ICE) {
        // ice: pale blue with faint streaks, a little darker by the rails
        tmpC.copy(K.ice).offsetHSL(0, 0, (rnd() - 0.5) * 0.04 + 0.035 * Math.sin(x * 2.3 + z * 1.7));
        const wd = wallDist(x, z);
        if (wd < 0.4) tmpC.lerp(K.edge, 0.22 * (1 - wd / 0.4));
        return tmpC;
      }
      const sa = sandAt(x, z);
      if (sa > 0.55) return tmpC.copy(K.sand).offsetHSL(0, 0, (rnd() - 0.5) * 0.06 - (sa < 0.7 ? 0.08 : 0));
      const stripe = Math.floor(z * 0.999) % 2;
      tmpC.copy(stripe ? K.turfA : K.turfB).offsetHSL(0, 0, (rnd() - 0.5) * 0.025);
      const sf = C.surface(H, x, z, {});
      tmpC.offsetHSL(0, 0, sf.h * 0.05 - Math.min(0.08, Math.hypot(sf.gx, sf.gz) * 0.12) * (sf.gz > 0 ? 1 : 0.4));
      for (const f of H.hf) {
        if (f.t === 'ring' && f.tint) {
          const u = Math.abs(Math.hypot(x - f.x, z - f.z) - f.R) / f.w;
          if (u < 0.85) tmpC.lerp(K.rim, 0.75 * (1 - u * u));
        }
      }
      if (sa > 0.3) tmpC.lerp(K.sand, 0.35);
      const wd = wallDist(x, z);
      if (wd < 0.4) tmpC.lerp(K.edge, 0.38 * (1 - wd / 0.4));
      return tmpC;
    };

    // ---------------- turf, sand and the cup
    const turf = new Geo();
    const UP = [0, 1, 0];
    const cx = H.cup[0]; const cz = H.cup[1];
    const q4 = (v) => Math.round(v * 4) / 4;
    const cut = { x0: q4(Math.floor((cx - 0.62) * 4) / 4), x1: q4(Math.ceil((cx + 0.62) * 4) / 4), z0: q4(Math.floor((cz - 0.62) * 4) / 4), z1: q4(Math.ceil((cz + 0.62) * 4) / 4) };
    const N = 4; const st = 1 / N;
    const vtx = (x, z) => [x, sh(x, z), z];
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (!C.solid(H.code[i]) || ch(x, z) === '=') continue;
        const d = H.diag[i];
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const x0 = x + k * st; const z0 = z + j * st; const x1 = x0 + st; const z1 = z0 + st;
            if (x0 >= cut.x0 - 1e-6 && x1 <= cut.x1 + 1e-6 && z0 >= cut.z0 - 1e-6 && z1 <= cut.z1 + 1e-6) continue;
            const A = vtx(x0, z0); const B = vtx(x0, z1); const Cc = vtx(x1, z1); const Dd = vtx(x1, z0);
            const kk = turfColor(x0 + st / 2, z0 + st / 2).clone();
            if (!d) { turf.quad(A, B, Cc, Dd, kk, UP); continue; }
            // diagonal tiles: whole, half or none of this little square
            let full; let half = null;
            if (d === 7) { full = k + j >= N; if (k + j === N - 1) half = [Dd, Cc, B]; } else if (d === 3) { full = k + j <= N - 2; if (k + j === N - 1) half = [A, Dd, B]; } else if (d === 9) { full = j >= k + 1; if (j === k) half = [A, B, Cc]; } else { full = k >= j + 1; if (k === j) half = [A, Dd, Cc]; }
            if (full) turf.quad(A, B, Cc, Dd, kk, UP);
            else if (half) turf.tri(half[0], half[1], half[2], kk, UP);
          }
        }
      }
    }
    // the square around the cup, with a round hole in it
    {
      const shape = new THREE.Shape();
      const pts = [];
      for (let x = cut.x0; x < cut.x1 - 1e-6; x += st) pts.push([x, cut.z0]);
      for (let z = cut.z0; z < cut.z1 - 1e-6; z += st) pts.push([cut.x1, z]);
      for (let x = cut.x1; x > cut.x0 + 1e-6; x -= st) pts.push([x, cut.z1]);
      for (let z = cut.z1; z > cut.z0 + 1e-6; z -= st) pts.push([cut.x0, z]);
      pts.forEach(([x, z], i) => (i ? shape.lineTo(x, z) : shape.moveTo(x, z)));
      const hole = new THREE.Path();
      hole.absarc(cx, cz, P.CUP_R, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const g = new THREE.ShapeGeometry(shape, 40);
      const a = g.toNonIndexed().attributes.position.array;
      for (let i = 0; i < a.length; i += 9) {
        const tri = [0, 3, 6].map((o) => [a[i + o], sh(a[i + o], a[i + o + 1]), a[i + o + 1]]);
        const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3; const mz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
        turf.tri(tri[0], tri[1], tri[2], turfColor(mx, mz).clone(), UP);
      }
    }
    const turfMesh = turf.mesh(vcMat());
    turfMesh.receiveShadow = true;
    grp.add(turfMesh);
    const cupY = sh(cx, cz);
    {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(P.CUP_R, P.CUP_R, 0.52, 32, 1, true), new THREE.MeshLambertMaterial({ color: 0x2a2f2a, side: THREE.BackSide }));
      liner.position.set(cx, cupY - 0.24, cz);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(P.CUP_R - 0.004, P.CUP_R - 0.004, 0.09, 32, 1, true), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.BackSide }));
      band.position.set(cx, cupY - 0.05, cz);
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(P.CUP_R, 32), new THREE.MeshBasicMaterial({ color: 0x0c100c }));
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(cx, cupY - 0.49, cz);
      grp.add(liner, band, bottom);
    }

    // ---------------- the flag
    const flag = new THREE.Group();
    {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 8), new THREE.MeshLambertMaterial({ color: 0xf8fafc }));
      pole.position.y = 1.15 - 0.45;
      pole.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshLambertMaterial({ color: th.knob, emissive: spooky ? 0x803000 : 0x302000 }));
      knob.position.y = 2.3 - 0.45;
      const tex = canvasTex(256, 160, (x, w, hh) => {
        x.fillStyle = th.flag; x.fillRect(0, 0, w, hh);
        x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, hh - 18, w, 18);
        x.fillStyle = '#fff'; x.font = '700 104px Bungee, Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(String(hd.n), w / 2, hh / 2 + 6);
      });
      const fg = new THREE.PlaneGeometry(0.9, 0.56, 12, 4);
      fg.translate(0.45, 0, 0);
      const cloth = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      cloth.position.y = 2.3 - 0.45 - 0.33;
      cloth.castShadow = true;
      const base = fg.attributes.position.array.slice();
      flag.add(pole, knob, cloth);
      for (const m of [pole, knob, cloth]) { m.material.transparent = true; }
      flag.userData.mats = [pole.material, knob.material, cloth.material];
      flag.position.set(cx, cupY, cz);
      flag.rotation.y = -Math.PI / 2 + 0.6;
      anim.push((t) => {
        if (calm()) return;
        const a = fg.attributes.position.array;
        for (let i = 0; i < a.length; i += 3) {
          const u = base[i] / 0.9;
          a[i + 2] = Math.sin(base[i] * 7 - t * 6 + base[i + 1] * 2) * 0.07 * u;
          a[i + 1] = base[i + 1] - u * u * 0.04 + Math.sin(base[i] * 5 - t * 4) * 0.015 * u;
        }
        fg.attributes.position.needsUpdate = true;
        fg.computeVertexNormals();
      });
      grp.add(flag);
    }

    // ---------------- rails: wooden (or stone) beams with a bevelled cap and posts at the corners
    const rails = new Geo();
    const T = 0.24;
    const beyond = (s, px, pz) => {        // what's on the outside of a rail at a point
      const f = C.floorAt(H, px - s.nx * 0.3, pz - s.nz * 0.3);
      return f === C.WATER ? BED : f === C.GAP ? PIT : GROUND;
    };
    const prism = (g, A, B, ox, oz, o0, o1, y0A, y0B, y1A, y1B, k, kTop, ends = true, i0 = 0, i1 = 0) => {
      // a beam from A to B, from offset o0 to o1 (outwards), bottom y0, top y1; i0/i1 narrow the top (bevel)
      const p = (P0, o, y) => [P0[0] + ox * o, y, P0[1] + oz * o];
      const a1 = p(A, o0, y0A); const a2 = p(A, o1, y0A); const a3 = p(A, o1 - i1, y1A); const a4 = p(A, o0 + i0, y1A);
      const b1 = p(B, o0, y0B); const b2 = p(B, o1, y0B); const b3 = p(B, o1 - i1, y1B); const b4 = p(B, o0 + i0, y1B);
      g.quad(a1, b1, b4, a4, k, [-ox, 0, -oz]);           // inner face
      g.quad(a2, a3, b3, b2, k, [ox, 0, oz]);             // outer face
      g.quad(a4, b4, b3, a3, kTop || k, [0, 1, 0]);       // top
      if (ends) {
        const dx = B[0] - A[0]; const dz = B[1] - A[1];
        g.quad(a1, a4, a3, a2, k, [-dx, 0, -dz]);
        g.quad(b1, b2, b3, b4, k, [dx, 0, dz]);
      }
    };
    const posts = new Map();
    const addPost = (x, z, ox, oz) => {
      const key = x.toFixed(2) + ',' + z.toFixed(2);
      const p = posts.get(key) || { x, z, ox: 0, oz: 0, n: 0 };
      p.ox += ox; p.oz += oz; p.n++;
      posts.set(key, p);
    };
    for (const s of H.walls) {
      if (s.kind !== 'rail') continue;
      const ox = -s.nx; const oz = -s.nz;
      const n = Math.max(1, Math.ceil(s.len / 1));
      for (let k = 0; k < n; k++) {
        const A = [s.ax + (s.bx - s.ax) * k / n, s.az + (s.bz - s.az) * k / n];
        const B = [s.ax + (s.bx - s.ax) * (k + 1) / n, s.az + (s.bz - s.az) * (k + 1) / n];
        const hA = sh(A[0] + s.nx * 0.05, A[1] + s.nz * 0.05) + P.WALL_H; const hB = sh(B[0] + s.nx * 0.05, B[1] + s.nz * 0.05) + P.WALL_H;
        const bA = beyond(s, A[0], A[1]); const bB = beyond(s, B[0], B[1]);
        const shade = K.rail.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
        prism(rails, A, B, ox, oz, 0, T, Math.min(bA, bB), Math.min(bA, bB), hA - 0.08, hB - 0.08, shade, shade, false);
        prism(rails, A, B, ox, oz, -0.035, T + 0.035, hA - 0.09, hB - 0.09, hA, hB, K.railTop, K.railTop.clone().offsetHSL(0, 0, 0.05), false, 0.03, 0.03);
      }
      addPost(s.ax, s.az, ox, oz); addPost(s.bx, s.bz, ox, oz);
      // fence posts along long rails
      const every = 3;
      const m = Math.floor(s.len / every);
      for (let k = 1; k < m; k++) {
        const u = k / m;
        posts.set('m' + posts.size, { x: s.ax + (s.bx - s.ax) * u, z: s.az + (s.bz - s.az) * u, ox, oz, n: 1, mid: true, dir: Math.atan2(s.bz - s.az, s.bx - s.ax) });
      }
    }
    for (const p of posts.values()) {
      let ox = p.ox / p.n; let oz = p.oz / p.n;
      const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l;
      const px = p.x + ox * T * 0.5; const pz = p.z + oz * T * 0.5;
      const top = sh(p.x - ox * 0.06, p.z - oz * 0.06) + P.WALL_H + (p.mid ? 0.05 : 0.1);
      const bottom = C.floorAt(H, p.x + ox * 0.4, p.z + oz * 0.4) === C.WATER ? BED : GROUND;
      const size = p.mid ? 0.28 : 0.34;
      const yaw = p.mid ? -p.dir : -Math.atan2(oz, ox) + Math.PI / 4;
      rails.add(prim().box, mat4(px, (top + bottom) / 2, pz, size, top - bottom, size, yaw), K.post);
      // a little pyramid on top
      rails.add(new THREE.ConeGeometry(size * 0.72, 0.12, 4), mat4(px, top + 0.06, pz, 1, 1, 1, yaw + Math.PI / 4), K.postTop);
    }
    // ---------------- the drop-offs: sides of the turf where there's no rail (water, chasms)
    const skirt = rails;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (!C.solid(H.code[i])) continue;
        const sides = [[0, -1, [x, z], [x + 1, z]], [0, 1, [x + 1, z + 1], [x, z + 1]], [-1, 0, [x, z + 1], [x, z]], [1, 0, [x + 1, z], [x + 1, z + 1]]];
        for (const [dx, dz, A, B] of sides) {
          const mx = (A[0] + B[0]) / 2 + dx * 0.05; const mz = (A[1] + B[1]) / 2 + dz * 0.05;
          const inside = C.floorAt(H, mx - dx * 0.1, mz - dz * 0.1);
          const out = C.floorAt(H, mx, mz);
          if (!C.solid(inside) || C.solid(out) || out === C.VOID) continue;
          if (out === C.WATER && H.railed[i]) continue;      // there's a rail there
          const bot = out === C.WATER ? BED : PIT;
          const yA = sh(A[0], A[1]); const yB = sh(B[0], B[1]);
          skirt.quad([A[0], yA, A[1]], [B[0], yB, B[1]], [B[0], bot, B[1]], [A[0], bot, A[1]], (out === C.GAP ? K.skirt2 : K.skirt).clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.04), [dx, 0, dz]);
          // a thin lip of darker earth at the top edge
          skirt.quad([A[0], yA + 0.001, A[1]], [B[0], yB + 0.001, B[1]], [B[0], yB - 0.07, B[1]], [A[0], yA - 0.07, A[1]], K.skirt2, [dx, 0, dz]);
        }
        // the cut side of diagonal tiles over water / chasm
        const d = H.diag[i];
        if (d && H.cutType[i] !== C.VOID && !(H.cutType[i] === C.WATER && H.railed[i])) {
          const pts = d === 7 ? [[x + 1, z], [x, z + 1], -1, -1] : d === 3 ? [[x, z + 1], [x + 1, z], 1, 1] : d === 9 ? [[x, z], [x + 1, z + 1], 1, -1] : [[x + 1, z + 1], [x, z], -1, 1];
          const [A, B, ndx, ndz] = pts;
          const bot = H.cutType[i] === C.WATER ? BED : PIT;
          const yA = sh(A[0], A[1]); const yB = sh(B[0], B[1]);
          skirt.quad([A[0], yA, A[1]], [B[0], yB, B[1]], [B[0], bot, B[1]], [A[0], bot, A[1]], K.skirt, [ndx, 0, ndz]);
        }
      }
    }
    // bridges: planks across, with a dark gap between
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        if (ch(x, z) !== '=') continue;
        const along = ch(x, z - 1) === '=' || ch(x, z + 1) === '=' || C.solid(code(x, z - 1)) ? 'z' : 'x';
        rails.add(prim().box, mat4(x + 0.5, -0.09, z + 0.5, 1, 0.16, 1), K.skirt2);
        for (let k = 0; k < 4; k++) {
          const o = (k + 0.5) / 4;
          const kk = (k + x + z) % 2 ? K.plankA : K.plankB;
          if (along === 'z') rails.add(prim().box, mat4(x + 0.5, -0.025, z + o, 1.0, 0.05, 0.22), kk, 0.05, rnd);
          else rails.add(prim().box, mat4(x + o, -0.025, z + 0.5, 0.22, 0.05, 1.0), kk, 0.05, rnd);
        }
        // posts under the bridge
        rails.add(prim().cyl, mat4(x + 0.12, (BED - 0.1) / 2, z + 0.5, 0.07, -BED, 0.07), K.skirt2);
        rails.add(prim().cyl, mat4(x + 0.88, (BED - 0.1) / 2, z + 0.5, 0.07, -BED, 0.07), K.skirt2);
      }
    }
    const railMesh = rails.mesh(vcMat());
    railMesh.castShadow = true; railMesh.receiveShadow = true;
    grp.add(railMesh);

    // ---------------- water: shimmering low-poly surface, a bed below, stones round the edge
    const waterCells = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (H.code[z * W + x] === C.WATER) waterCells.push([x, z]);
    const isWater = (x, z) => code(x, z) === C.WATER || (C.solid(code(x, z)) && false);
    if (waterCells.length) {
      const wg = new Geo(); const bed = new Geo();
      for (const [x, z] of waterCells) {
        for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
          const x0 = x + k * 0.5; const z0 = z + j * 0.5;
          wg.quad([x0, P.WATER_Y, z0], [x0, P.WATER_Y, z0 + 0.5], [x0 + 0.5, P.WATER_Y, z0 + 0.5], [x0 + 0.5, P.WATER_Y, z0], col(th.water), UP);
        }
        bed.quad([x, BED, z], [x, BED, z + 1], [x + 1, BED, z + 1], [x + 1, BED, z], K.bed.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.05), UP);
        // the outside edge of the pond: a low wall of stones
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (code(x + dx, z + dz) !== C.VOID) continue;
          const ex = x + 0.5 + dx * 0.5; const ez = z + 0.5 + dz * 0.5;
          for (let k = 0; k < 3; k++) {
            const u = (k + 0.5) / 3 - 0.5;
            const sx = ex + (dz ? u : 0) + dx * 0.05; const sz = ez + (dx ? u : 0) + dz * 0.05;
            const r = 0.2 + rnd() * 0.08;
            bed.add(prim().dode, mat4(sx, GROUND + 0.04, sz, r * 1.2, r * 0.8, r * 1.2, rnd() * 6), K.shore, 0.12, rnd);
          }
          bed.quad([ex - dz * 0.5 + dx * 0.0, BED, ez - dx * 0.5], [ex + dz * 0.5, BED, ez + dx * 0.5], [ex + dz * 0.5, GROUND, ez + dx * 0.5], [ex - dz * 0.5, GROUND, ez - dx * 0.5], K.shore, [-dx, 0, -dz]);
        }
      }
      const wm = wg.mesh(th.lava
        ? new THREE.MeshPhongMaterial({ color: th.water, emissive: th.waterGlow, specular: 0xffc080, shininess: 18, flatShading: true })
        : new THREE.MeshPhongMaterial({ color: th.water, emissive: th.waterGlow, specular: spooky ? 0x1a3a2a : 0x9fc8e8, shininess: spooky ? 70 : 60, flatShading: true, transparent: true, opacity: 0.88 }));
      if (th.lava) {
        // lava glows and pulses (a soft light over some of its tiles)
        wm.material.emissiveIntensity = 0.85;
        anim.push((t) => { wm.material.emissiveIntensity = 0.75 + 0.2 * Math.sin(t * 1.6); });
        waterCells.forEach(([x, z], k) => {
          if (k % 3) return;
          const g = glow(0xff6a1a, 2.4, 0.4); const ph2 = rnd() * 6;
          g.position.set(x + 0.5, P.WATER_Y + 0.25, z + 0.5);
          grp.add(g);
          anim.push((t) => { g.material.opacity = 0.32 + 0.12 * Math.sin(t * 2 + ph2); });
        });
      }
      wm.receiveShadow = true;
      const pos = wm.geometry.attributes.position;
      const base = pos.array.slice();
      anim.push((t) => {
        if (calm() && t > 0.1) return;
        const a = pos.array;
        for (let i = 0; i < a.length; i += 3) a[i + 1] = P.WATER_Y + Math.sin(base[i] * 2.1 + t * 1.7) * Math.cos(base[i + 2] * 1.7 + t * 1.3) * 0.028 + Math.sin((base[i] + base[i + 2]) * 3.3 + t * 2.6) * 0.012;
        pos.needsUpdate = true;
        wm.geometry.computeVertexNormals();
      });
      grp.add(wm, bed.mesh(vcMat()));
    }
    // ---------------- chasms: a creek far below (meadow) or a glowing purple void (spooky)
    const gapCells = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (H.code[z * W + x] === C.GAP) gapCells.push([x, z]);
    if (gapCells.length) {
      const pit = new Geo();
      let gx0 = 99; let gx1 = -99; let gz0 = 99; let gz1 = -99;
      for (const [x, z] of gapCells) {
        gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x + 1); gz0 = Math.min(gz0, z); gz1 = Math.max(gz1, z + 1);
        pit.quad([x, PIT, z], [x, PIT, z + 1], [x + 1, PIT, z + 1], [x + 1, PIT, z], col(th.pitFloor).offsetHSL(0, 0, (rnd() - 0.5) * 0.04), UP);
        for (const [dx, dz, A, B] of [[0, -1, [x, z], [x + 1, z]], [0, 1, [x + 1, z + 1], [x, z + 1]], [-1, 0, [x, z + 1], [x, z]], [1, 0, [x + 1, z], [x + 1, z + 1]]]) {
          const o = code(x + dx, z + dz);
          if (o === C.GAP) continue;
          if (C.solid(o)) continue;   // the turf's own skirt covers that side
          pit.quad([A[0], GROUND, A[1]], [B[0], GROUND, B[1]], [B[0], PIT, B[1]], [A[0], PIT, A[1]], K.skirt2.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.04), [-dx, 0, -dz]);
        }
      }
      grp.add(pit.mesh(vcMat()));
      if (th.pit === 'creek') {
        const creek = new THREE.Mesh(new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0, 8, 4), new THREE.MeshPhongMaterial({ color: th.water, emissive: th.waterGlow, specular: 0xcfeaff, shininess: 50, flatShading: true }));
        creek.rotation.x = -Math.PI / 2;
        creek.position.set((gx0 + gx1) / 2, PIT + 0.45, (gz0 + gz1) / 2);
        const cp = creek.geometry.attributes.position; const cb = cp.array.slice();
        anim.push((t) => { if (calm()) return; for (let i = 0; i < cp.array.length; i += 3) cp.array[i + 2] = Math.sin(cb[i] * 2 + t * 3) * 0.04; cp.needsUpdate = true; creek.geometry.computeVertexNormals(); });
        grp.add(creek);
        // rocks in the creek
        for (let k = 0; k < 6; k++) {
          const r = new THREE.Mesh(prim().dode, new THREE.MeshLambertMaterial({ color: 0x9a948a }));
          r.scale.set(0.3 + rnd() * 0.2, 0.25, 0.3 + rnd() * 0.2);
          r.position.set(gx0 + 0.4 + rnd() * (gx1 - gx0 - 0.8), PIT + 0.45, gz0 + 0.3 + rnd() * (gz1 - gz0 - 0.6));
          grp.add(r);
        }
      } else if (th.pit === 'canyon') {
        // a dry canyon: boulders down at the bottom
        for (let k = 0; k < 7; k++) {
          const r = new THREE.Mesh(prim().dode, new THREE.MeshLambertMaterial({ color: th.rock, flatShading: true }));
          r.scale.set(0.3 + rnd() * 0.3, 0.25 + rnd() * 0.2, 0.3 + rnd() * 0.3);
          r.position.set(gx0 + 0.4 + rnd() * (gx1 - gx0 - 0.8), PIT + 0.15, gz0 + 0.3 + rnd() * (gz1 - gz0 - 0.6));
          grp.add(r);
        }
      } else {
        const g1 = glow(th.pitGlow, Math.max(gx1 - gx0, gz1 - gz0) * 1.4, 0.75);
        g1.position.set((gx0 + gx1) / 2, PIT + 0.8, (gz0 + gz1) / 2);
        grp.add(g1);
        anim.push((t) => { g1.material.opacity = 0.6 + Math.sin(t * 2) * 0.15; });
        // mist (or sparks) rising out of the pit
        for (let k = 0; k < 5; k++) {
          const m = glow(th.pitMist, 1.4, 0.35);
          const sx = gx0 + 0.5 + rnd() * (gx1 - gx0 - 1); const sz = gz0 + 0.5 + rnd() * (gz1 - gz0 - 1); const ph = rnd() * 3;
          grp.add(m);
          anim.push((t) => { const u = ((t * 0.35 + ph) % 1); m.position.set(sx, PIT + 0.5 + u * 3.2, sz); m.material.opacity = 0.4 * Math.sin(u * Math.PI); });
        }
      }
    }

    // ---------------- the ground round the course: flat nearby, rolling hills further out
    const M = 26;
    const occupied = (x, z) => {
      const ix = Math.floor(x); const iz = Math.floor(z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (code(ix + dx, iz + dz) !== C.VOID) return true;
      return false;
    };
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    const FAR_Y = th.farY;
    const bboxDist = (x, z) => Math.hypot(Math.max(0, -x, x - W), Math.max(0, -z, z - D));
    const groundY = (x, z) => {
      const d = bboxDist(x, z);
      const n = Math.sin(x * 0.23 + ph[0]) * Math.cos(z * 0.19 + ph[1]) + 0.5 * Math.sin(x * 0.47 + z * 0.33 + ph[2]);
      const hills = smooth(5, 22, d) * (th.hills[0] + n * th.hills[1]);
      return GROUND + hills * (1 - smooth(M - 3, M, d)) + smooth(M - 3, M, d) * FAR_Y;
    };
    {
      const g = new Geo();
      const kk = th.ground.map(col);
      for (let z = -M; z < D + M; z++) {
        for (let x = -M; x < W + M; x++) {
          if (x >= 0 && z >= 0 && x < W && z < D && code(x, z) !== C.VOID && !H.diag[z * W + x]) continue;
          const A = [x, groundY(x, z), z]; const B = [x, groundY(x, z + 1), z + 1]; const Cc = [x + 1, groundY(x + 1, z + 1), z + 1]; const Dd = [x + 1, groundY(x + 1, z), z];
          const n = 0.5 + 0.5 * Math.sin(x * 0.31 + ph[1]) * Math.cos(z * 0.27 + ph[2]);
          const base = kk[0].clone().lerp(n > 0.5 ? kk[2] : kk[1], Math.abs(n - 0.5) * 1.6);
          g.tri(A, B, Cc, base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.022), UP);
          g.tri(A, Cc, Dd, base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.022), UP);
        }
      }
      // beyond: a flat plain into the fog
      const far = 400; const y = GROUND + FAR_Y;
      const x0 = -M; const x1 = W + M; const z0 = -M; const z1 = D + M;
      const pk = th.farWater ? col(th.water) : kk[0];
      g.quad([x0 - far, y, z0 - far], [x0 - far, y, z1 + far], [x0, y, z1 + far], [x0, y, z0 - far], pk, UP);
      g.quad([x1, y, z0 - far], [x1, y, z1 + far], [x1 + far, y, z1 + far], [x1 + far, y, z0 - far], pk, UP);
      g.quad([x0, y, z0 - far], [x0, y, z0], [x1, y, z0], [x1, y, z0 - far], pk, UP);
      g.quad([x0, y, z1], [x0, y, z1 + far], [x1, y, z1 + far], [x1, y, z1], pk, UP);
      const gm = g.mesh(vcMat());
      gm.receiveShadow = true;
      grp.add(gm);
    }

    // ---------------- obstacles
    const props = new Geo();       // static, vertex-coloured, one mesh
    const put = (geo, x, y, z, sx, sy, sz, ry, k, jitter = 0.06, rx = 0, rz = 0) => props.add(geo, mat4(x, y, z, sx, sy, sz, ry, rx, rz), col(k), jitter, rnd);
    const addTomb = (x, y, z, w, hh, d, ry = 0, tone = 0x8a8aa0) => {
      put(prim().box, x, y + hh * 0.42, z, w, hh * 0.84, d, ry, tone);
      put(prim().half, x, y + hh * 0.84, z, w / 2, d, w / 2, ry, tone, 0.06, -Math.PI / 2, 0);
      put(prim().box, x, y + 0.04, z, w * 1.2, 0.08, d * 1.6, ry, 0x4b4560);
    };
    for (const b of H.blocks) {
      if (b.hidden) continue;
      const w = b.x1 - b.x0; const d = b.z1 - b.z0; const mx = (b.x0 + b.x1) / 2; const mz = (b.z0 + b.z1) / 2; const y = sh(mx, mz);
      if (b.style === 'brick') {
        put(prim().box, mx, y + 0.3, mz, w, 0.6, d, 0, 0xb4533a, 0.04);
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          const n = Math.max(2, Math.round(w / 0.42)); const bw = w / n;
          for (let k = 0; k < n; k++) {
            const off = r % 2 ? bw / 2 : 0;
            const bx = b.x0 + off + bw * (k + 0.5);
            if (bx > b.x1 - bw * 0.3) continue;
            put(prim().box, bx, y + 0.1 + r * 0.2, mz, bw * 0.9, 0.17, d + 0.04, 0, (k + r) % 3 ? 0xc65f43 : 0xa9472f, 0.06);
          }
        }
        put(prim().box, mx, y + 0.66, mz, w + 0.08, 0.12, d + 0.12, 0, 0xe8dcc8, 0.03);
      } else if (b.style === 'tomb') {
        addTomb(mx, y, mz, w, 0.85, d);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 0.32), new THREE.MeshLambertMaterial({ map: ripTex(), transparent: true }));
        sign.position.set(mx, y + 0.55, b.z1 + 0.003);
        grp.add(sign);
      } else if (b.style === 'house') {
        grp.add(hauntedHouse(H, b, y, anim));
      } else if (b.style === 'mesa') {
        // a little red-rock mesa in layers
        const layers = [0xb8673a, 0xc97a46, 0xa95a32, 0xd28a55];
        for (let k = 0; k < 4; k++) put(prim().box, mx + (rnd() - 0.5) * 0.06, y + 0.17 + k * 0.3, mz + (rnd() - 0.5) * 0.06, w - k * 0.07, 0.32, d - k * 0.07, (rnd() - 0.5) * 0.04, layers[k], 0.05);
        put(prim().box, mx, y + 1.26, mz, w - 0.3, 0.06, d - 0.3, 0, 0x8a4e28, 0.04);
      } else if (b.style === 'crate') {
        put(prim().box, mx, y + 0.4, mz, w, 0.8, d, 0, 0xb07a45, 0.05);
        for (const f of [-1, 1]) {
          put(prim().box, mx, y + 0.4, mz + f * (d / 2 + 0.005), w * 0.96, 0.1, 0.02, 0, 0x7a4c29, 0);
          put(prim().box, mx + f * (w / 2 + 0.005), y + 0.4, mz, 0.02, 0.1, d * 0.96, 0, 0x7a4c29, 0);
        }
        put(prim().box, mx, y + 0.805, mz, w * 0.98, 0.02, d * 0.98, 0, 0xc48a52, 0.03);
      } else if (b.style === 'iceblock') {
        const ice = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), new THREE.MeshPhongMaterial({ color: 0xbfe8ff, emissive: 0x16384f, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.82 }));
        ice.position.set(mx, y + 0.4, mz);
        ice.castShadow = true;
        grp.add(ice);
        put(prim().box, mx, y + 0.83, mz, w * 0.9, 0.07, d * 0.9, 0, 0xffffff, 0.02);
      } else if (b.style === 'basalt') {
        // dark six-sided basalt columns
        const n = Math.max(2, Math.round((w * d) / 0.3));
        for (let k = 0; k < n; k++) {
          const cx2 = b.x0 + 0.18 + rnd() * Math.max(0.01, w - 0.36); const cz2 = b.z0 + 0.18 + rnd() * Math.max(0.01, d - 0.36); const hh2 = 0.7 + rnd() * 0.6;
          put(prim().cyl, cx2, y + hh2 / 2, cz2, Math.min(0.24, w / 2), hh2, Math.min(0.24, d / 2), rnd() * 6, 0x2e2725, 0.08);
        }
        put(prim().box, mx, y + 0.35, mz, w, 0.7, d, 0, 0x262020, 0.05);
      } else {
        put(prim().dode, mx, y + 0.35, mz, w / 1.6, 0.6, d / 1.6, rnd() * 6, 0x9a9a9a, 0.12);
      }
    }
    for (const [bi, o] of H.bumpers.entries()) {
      const y = sh(o.x, o.z);
      const g = new THREE.Group();
      if (th.bumper === 'pumpkin') {
        g.add(pumpkin(o.r, true));
      } else if (th.bumper !== 'classic') {
        g.add(bumperMesh(th.bumper, o.r, rnd, anim));
      } else {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.05, 0.42, 20), new THREE.MeshLambertMaterial({ color: 0xef3b4f }));
        body.position.y = 0.21;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.01, o.r * 1.01, 0.1, 20), new THREE.MeshLambertMaterial({ color: 0xffffff }));
        band.position.y = 0.24;
        const top = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.92, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xffd23f, shininess: 60 }));
        top.position.y = 0.42;
        top.scale.y = 0.45;
        g.add(body, band, top);
      }
      g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      g.position.set(o.x, y, o.z);
      grp.add(g);
      bumperObjs[bi] = { g, hit: -9 };
    }
    // moving obstacles
    const moverObjs = H.movers.map((m) => moverMesh(H, m, th, grp, anim));
    // teleports
    for (const tp of H.tele) teleMesh(H, tp, th, grp, anim);
    // speed pads: glowing arrows that slide along
    for (const o of H.boosts) {
      const tex = arrowTex();
      const mat = new THREE.MeshBasicMaterial({ map: tex.clone(), transparent: true, depthWrite: false, color: th.lava ? 0xffb24a : 0x5cf0ff });
      mat.map.needsUpdate = true;
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(o.r, 28), mat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = Math.atan2(-o.dz, o.dx) - Math.PI / 2;
      pad.position.set(o.x, sh(o.x, o.z) + 0.014, o.z);
      const sf = C.surface(H, o.x, o.z, {});
      pad.rotation.x += Math.atan(sf.gz) * 0;    // (pads only sit on flat bits or gentle ramps)
      const ring = new THREE.Mesh(new THREE.RingGeometry(o.r, o.r + 0.06, 28), new THREE.MeshBasicMaterial({ color: th.lava ? 0xff6a1a : 0x22d3ee, transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(o.x, sh(o.x, o.z) + 0.012, o.z);
      const gl = glow(th.lava ? 0xff7a2a : 0x22d3ee, 1.6, 0.35);
      gl.position.set(o.x, sh(o.x, o.z) + 0.2, o.z);
      grp.add(pad, ring, gl);
      anim.push((t) => { if (!calm()) mat.map.offset.y = -t * 1.2; gl.material.opacity = 0.28 + 0.1 * Math.sin(t * 5); });
    }

    // ---------------- scenery
    const decoAt = (kind, x, z, s = 1, r = 0) => decoItem(kind, x, z, s, r, { H, grp, put, addTomb, anim, rnd, spooky, th, sh, groundY });
    for (const d of hd.deco || []) decoAt(...d);
    // a little sign by the tee with the hole number and par
    {
      let best = null;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = Math.floor(H.tee[0]) + dx; const z = Math.floor(H.tee[1]) + dz;
        if (code(x, z) !== C.VOID || occupiedBy(x + 0.5, z + 0.5)) continue;
        let near = false;
        for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) if (C.solid(code(x + a, z + b2))) near = true;
        if (!near) continue;
        if (Math.abs(dx) < 2 || Math.abs(dz) > 1) continue;     // beside the tee, not in front of the camera
        const dd = Math.hypot(dx, dz) + (dx > 0 ? 0.3 : 0);
        if (!best || dd < best.d) best = { x: x + 0.5, z: z + 0.5, d: dd };
      }
      if (best) decoItem('teesign', best.x, best.z, 1, Math.atan2(H.tee[0] - best.x, H.tee[1] - best.z), { H, grp, put, anim, rnd, spooky, th, sh, groundY, hd });
    }
    function occupiedBy(x, z) { return (hd.deco || []).some((d) => Math.hypot(d[1] - x, d[2] - z) < 1.2); }
    // random scenery all around
    {
      const items = th.items;
      const pick = () => { let r = rnd(); for (const [k, p] of items) { r -= p; if (r <= 0) return k; } return items[0][0]; };
      let placed = 0; let tries = 0;
      const spots = [];
      // keep the view from behind the tee clear
      const dir = C.pathDir(H, H.tee[0], H.tee[1]); const fx = Math.cos(dir); const fz = Math.sin(dir);
      const behindTee = (x, z) => { const rx = x - H.tee[0]; const rz = z - H.tee[1]; const along = rx * fx + rz * fz; const side = Math.abs(rx * fz - rz * fx); return along < 1 && along > -12 && side < 3 + -along * 0.45; };
      while (placed < 110 && tries < 2200) {
        tries++;
        const x = -M + 2 + rnd() * (W + 2 * M - 4); const z = -M + 2 + rnd() * (D + 2 * M - 4);
        const d = bboxDist(x, z);
        if (occupied(x, z) || d > M - 4 || behindTee(x, z)) continue;
        if (d < 1.5 && rnd() < 0.5) continue;
        if (spots.some(([a, b]) => Math.hypot(a - x, b - z) < 1.6)) continue;
        if ((hd.deco || []).some((dd) => Math.hypot(dd[1] - x, dd[2] - z) < 1.4)) continue;
        // don't block the view from behind the tee
        spots.push([x, z]);
        let k = pick();
        if (d < 3 && ['tree', 'pine', 'deadtree', 'palm', 'snowpine', 'basalt', 'cactus'].includes(k)) k = th.near;
        decoAt(k, x, z, 0.75 + rnd() * 0.6 + Math.min(0.6, d * 0.03), rnd() * 6);
        placed++;
      }
    }
    // the sky and what moves in it: clouds and butterflies, bats and fog, snow, gulls, embers…
    if (!spooky && !th.lava) {
      const clouds = new THREE.Group();
      const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8aa0b8 });
      for (let k = 0; k < (th.id === 'desert' ? 4 : 9); k++) {
        const c = new THREE.Group();
        const n = 3 + ((rnd() * 3) | 0);
        for (let j = 0; j < n; j++) {
          const m = new THREE.Mesh(prim().ico, cm);
          const r = 1.2 + rnd() * 1.4;
          m.scale.set(r * 1.3, r * 0.8, r);
          m.position.set(j * 1.6 - n * 0.8, rnd() * 0.6, rnd() * 1.2);
          c.add(m);
        }
        c.position.set(W / 2 + (rnd() - 0.5) * 120, 20 + rnd() * 10, D / 2 + (rnd() - 0.5) * 120);
        clouds.add(c);
      }
      grp.add(clouds);
      anim.push((t, dt) => { clouds.position.x = ((t * 0.6) % 60) - 30; });
      if (th.id === 'desert') {
        // mesas on the horizon
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + rnd(); const dd = 70 + rnd() * 40; const hgt = 8 + rnd() * 10; const wd = 10 + rnd() * 14;
          const m = new THREE.Mesh(new THREE.CylinderGeometry(wd * 0.8, wd, hgt, 7), new THREE.MeshLambertMaterial({ color: 0xc0703f, flatShading: true }));
          m.position.set(W / 2 + Math.cos(a) * dd, GROUND + FAR_Y + hgt / 2 - 0.5, D / 2 + Math.sin(a) * dd);
          grp.add(m);
        }
      }
      if (th.id === 'winter') {
        // snow falling all round
        const n = calm() ? 0 : 500; const pos = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) { pos[k * 3] = W / 2 + (rnd() - 0.5) * 50; pos[k * 3 + 1] = rnd() * 14; pos[k * 3 + 2] = D / 2 + (rnd() - 0.5) * 50; }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        textures();
        const snow = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: 0xffffff, size: 0.12, transparent: true, depthWrite: false }));
        grp.add(snow);
        const base = pos.slice();
        anim.push((t) => {
          const a = geo.attributes.position.array;
          for (let k = 0; k < n; k++) { a[k * 3 + 1] = (((base[k * 3 + 1] - t * 0.9) % 14) + 14) % 14; a[k * 3] = base[k * 3] + Math.sin(t * 0.7 + k) * 0.3; }
          geo.attributes.position.needsUpdate = true;
        });
      }
      if (th.id === 'beach') {
        // seagulls gliding round
        for (let k = 0; k < 4; k++) {
          const b = bat(0xffffff);
          const rr = 6 + rnd() * 8; const ph2 = rnd() * 9; const yy = 5 + rnd() * 3; const sp = 0.25 + rnd() * 0.2;
          grp.add(b);
          anim.push((t) => {
            const u = t * sp + ph2;
            b.position.set(W / 2 + Math.cos(u) * rr, yy + Math.sin(u * 1.7) * 0.5, D / 2 + Math.sin(u) * rr * 1.2);
            b.rotation.y = -u - Math.PI / 2;
            b.visible = b.position.distanceTo(camera.position) > 6;
            if (!calm()) { const f = Math.sin(t * 5 + ph2) * 0.45; b.children[0].rotation.z = f; b.children[1].rotation.z = -f; }
          });
        }
      }
      // butterflies (not out in the snow, the desert or the sea)
      for (let k = 0; k < (th.id === 'meadow' ? 4 : 0); k++) {
        const b = butterfly(rnd);
        const ox = W / 2 + (rnd() - 0.5) * (W + 6); const oz = D / 2 + (rnd() - 0.5) * (D + 6); const ph2 = rnd() * 9;
        grp.add(b);
        anim.push((t) => {
          const u = t * 0.4 + ph2;
          b.position.set(ox + Math.sin(u) * 3, 0.9 + Math.sin(u * 3.1) * 0.3, oz + Math.cos(u * 0.8) * 2.5);
          b.rotation.y = -u;
          if (!calm()) { b.children[0].rotation.z = Math.sin(t * 22) * 0.9; b.children[1].rotation.z = -Math.sin(t * 22) * 0.9; }
        });
      }
    } else if (th.lava) {
      // a volcano on the horizon with a glowing top, and embers drifting up everywhere
      const a = Math.atan2(-1, 0.2) + rnd() * 0.6; const dd = 80;
      const vx = W / 2 + Math.cos(a) * dd; const vz = D / 2 + Math.sin(a) * dd;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(6, 34, 30, 9), new THREE.MeshLambertMaterial({ color: 0x241b19, flatShading: true }));
      cone.position.set(vx, GROUND + FAR_Y + 14, vz);
      const top = glow(0xff5a1a, 30, 0.7); top.position.set(vx, GROUND + FAR_Y + 31, vz);
      grp.add(cone, top);
      anim.push((t) => { top.material.opacity = 0.55 + 0.15 * Math.sin(t * 1.3); });
      textures();
      for (let k = 0; k < 6; k++) {
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x4a3a38, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
        grp.add(f);
        const ph2 = k / 6;
        anim.push((t) => { const u = (t * 0.03 + ph2) % 1; const sz = 14 + u * 40; f.scale.set(sz, sz * 0.7, 1); f.position.set(vx + u * 25, GROUND + FAR_Y + 34 + u * 30, vz); f.material.opacity = 0.5 * Math.sin(u * Math.PI); });
      }
      const n = calm() ? 0 : 160; const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { pos[k * 3] = W / 2 + (rnd() - 0.5) * 34; pos[k * 3 + 1] = rnd() * 8; pos[k * 3 + 2] = D / 2 + (rnd() - 0.5) * 34; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const embers = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: 0xff8a3a, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      grp.add(embers);
      const base = pos.slice();
      anim.push((t) => {
        const ar = geo.attributes.position.array;
        for (let k = 0; k < n; k++) { ar[k * 3 + 1] = (base[k * 3 + 1] + t * 0.6) % 8; ar[k * 3] = base[k * 3] + Math.sin(t + k) * 0.25; }
        geo.attributes.position.needsUpdate = true;
      });
    } else {
      // bats circling over the course
      for (let k = 0; k < 6; k++) {
        const b = bat();
        const r = 5 + rnd() * 7; const ph2 = rnd() * 9; const y = 3.8 + rnd() * 3; const sp = 0.35 + rnd() * 0.4;
        const ox = W / 2 + (rnd() - 0.5) * 4; const oz = D / 2 + (rnd() - 0.5) * 6;
        grp.add(b);
        anim.push((t) => {
          const u = t * sp + ph2;
          b.position.set(ox + Math.cos(u) * r, y + Math.sin(u * 2.3) * 0.6, oz + Math.sin(u) * r * 1.3);
          b.rotation.y = -u - Math.PI / 2;
          b.visible = b.position.distanceTo(camera.position) > 6;     // never right in your face
          if (!calm()) { const f = Math.sin(t * 16 + ph2) * 0.8; b.children[0].rotation.z = f; b.children[1].rotation.z = -f; }
        });
      }
      // low drifting fog
      textures();
      for (let k = 0; k < 14; k++) {
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xb9a6ff, transparent: true, opacity: 0.32, depthWrite: false }));
        const s = 7 + rnd() * 7;
        f.scale.set(s, s * 0.5, 1);
        const ox = -4 + rnd() * (W + 8); const oz = -4 + rnd() * (D + 8); const ph2 = rnd() * 50; const sp = 0.15 + rnd() * 0.2;
        grp.add(f);
        anim.push((t) => { const u = ((ox + t * sp + ph2) % (W + 12)) - 6; f.position.set(u, 0.35, oz); });
      }
      // the moon
      const moon = new THREE.Group();
      const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex(), transparent: true, fog: false, depthWrite: false }));
      disc.scale.set(16, 16, 1);
      const halo = glow(0xfff1c9, 46, 0.45);
      moon.add(halo, disc);
      grp.add(moon);
      moonObj = moon;
    }
    // the whole hole: shadow camera fitted to it
    return remember({ grp, H, anim, flag, moon: moonObj, bumpers: bumperObjs, movers: moverObjs, cupY, center: [W / 2, 0, D / 2], size: Math.max(W, D) });

    function remember(v) {
      const pm = props.mesh(vcMat());
      pm.castShadow = true; pm.receiveShadow = true;
      grp.add(pm);
      built.set(hd.id, v);
      return v;
    }
  }

  // ---------------- props and pieces
  let _rip = null;
  const ripTex = () => _rip || (_rip = canvasTex(128, 64, (x, w, hh) => {
    x.fillStyle = 'rgba(40,36,58,.85)'; x.font = '700 34px Bungee, Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('R.I.P', w / 2, hh / 2 + 2);
  }));
  let _moon = null;
  const moonTex = () => _moon || (_moon = canvasTex(256, 256, (x) => {
    const g = x.createRadialGradient(118, 112, 10, 128, 128, 110);
    g.addColorStop(0, '#fffbe8'); g.addColorStop(0.8, '#f6e7b4'); g.addColorStop(1, '#e8d08c');
    x.fillStyle = g; x.beginPath(); x.arc(128, 128, 104, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(190,160,100,.28)';
    for (const [cx, cy, r] of [[96, 100, 20], [156, 150, 26], [150, 84, 12], [100, 168, 14], [176, 112, 9]]) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); }
  }));
  function pumpkin(r, face) {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(r, 16, 10);
    const p = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const rib = 1 - 0.09 * Math.pow(Math.abs(Math.cos(a * 4)), 3);
      p.setXYZ(i, x * rib, y * 0.72, z * rib);
      const k = 0.78 + 0.22 * rib;
      colors.push(1 * k, 0.48 * k, 0.08 * k);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    body.position.y = r * 0.72;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.12, r * 0.35, 6), new THREE.MeshLambertMaterial({ color: 0x4d7c2a }));
    stem.position.y = r * 1.5;
    stem.rotation.z = 0.2;
    g.add(body, stem);
    if (face) {
      const fm = new THREE.MeshBasicMaterial({ color: 0xffd34d });
      const tri = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return new THREE.ShapeGeometry(s); };
      const eyeL = new THREE.Mesh(tri([[-0.42, 0.12], [-0.1, 0.12], [-0.26, 0.42]]), fm);
      const eyeR = new THREE.Mesh(tri([[0.1, 0.12], [0.42, 0.12], [0.26, 0.42]]), fm);
      const mouth = new THREE.Mesh(tri([[-0.5, -0.12], [-0.3, -0.3], [-0.12, -0.2], [0, -0.36], [0.12, -0.2], [0.3, -0.3], [0.5, -0.12], [0.2, -0.2], [0, -0.1], [-0.2, -0.2]]), fm);
      const faceG = new THREE.Group();
      faceG.add(eyeL, eyeR, mouth);
      faceG.scale.set(r, r, r);
      faceG.position.set(0, r * 0.72, r * 0.93);
      g.add(faceG);
      const gl = glow(0xff9a2e, r * 4.2, 0.55);
      gl.position.set(0, r * 0.8, r * 0.6);
      g.add(gl);
    }
    return g;
  }
  /** A bat (or, given a colour, a seagull: same wings, no red eyes). */
  function bat(color) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: color ?? 0x0d0618, side: THREE.DoubleSide });
    const wing = (s) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.55 * s, 0.18); sh.lineTo(0.7 * s, -0.05); sh.lineTo(0.5 * s, -0.02); sh.lineTo(0.38 * s, -0.14); sh.lineTo(0.22 * s, -0.04); sh.lineTo(0, -0.08);
      const w = new THREE.Mesh(new THREE.ShapeGeometry(sh), m);
      w.rotation.x = -Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.add(w);
      return pivot;
    };
    g.add(wing(1), wing(-1));
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), m);
    body.scale.set(0.8, 0.8, 1.6);
    g.add(body);
    if (color == null) {
      const eyes = glow(0xff3355, 0.25, 0.9);
      eyes.position.set(0, 0.04, 0.12);
      g.add(eyes);
    }
    g.scale.setScalar(1.3);
    return g;
  }
  function butterfly(rnd) {
    const g = new THREE.Group();
    const c = [0xffd23f, 0xff7ab6, 0x7dd3fc, 0xffffff][(rnd() * 4) | 0];
    const m = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.09, 6), m);
      w.rotation.x = -Math.PI / 2;
      w.position.x = 0.08 * s;
      pivot.add(w);
      g.add(pivot);
    }
    return g;
  }
  function hauntedHouse(H, b, y, anim) {
    const g = new THREE.Group();
    const w = b.x1 - b.x0; const d = b.z1 - b.z0;
    const mx = (b.x0 + b.x1) / 2; const mz = (b.z0 + b.z1) / 2;
    const geo = new Geo();
    const wall = col(0x4a3d63); const dark = col(0x2a2238); const trim = col(0x7a6aa0); const roof = col(0x231b33);
    const wh = 2.4;
    // walls made of vertical boards
    const n = Math.round(w / 0.32);
    for (let k = 0; k < n; k++) {
      const bx = b.x0 + (k + 0.5) * (w / n);
      geo.add(prim().box, mat4(bx, y + wh / 2, b.z1 - 0.06, w / n * 0.94, wh, 0.12), wall.clone().offsetHSL(0, 0, (Math.sin(k * 12.9) * 0.5) * 0.06));
      geo.add(prim().box, mat4(bx, y + wh / 2, b.z0 + 0.06, w / n * 0.94, wh, 0.12), wall.clone().offsetHSL(0, 0, (Math.cos(k * 7.3) * 0.5) * 0.06));
    }
    geo.add(prim().box, mat4(mx, y + wh / 2, mz, w - 0.1, wh, d - 0.2), dark);
    geo.add(prim().box, mat4(mx, y + 0.08, mz, w + 0.2, 0.16, d + 0.2), col(0x3a3348));
    geo.add(prim().box, mat4(mx, y + wh + 0.05, mz, w + 0.3, 0.1, d + 0.3), trim);
    // a gabled roof
    const rh = 1.5;
    const ridge = [[b.x0 - 0.15, y + wh + 0.1 + rh, mz], [b.x1 + 0.15, y + wh + 0.1 + rh, mz]];
    const e1 = [[b.x0 - 0.15, y + wh + 0.1, b.z1 + 0.35], [b.x1 + 0.15, y + wh + 0.1, b.z1 + 0.35]];
    const e0 = [[b.x0 - 0.15, y + wh + 0.1, b.z0 - 0.35], [b.x1 + 0.15, y + wh + 0.1, b.z0 - 0.35]];
    geo.quad(e1[0], e1[1], ridge[1], ridge[0], roof, [0, 1, 1]);
    geo.quad(e0[0], ridge[0], ridge[1], e0[1], roof, [0, 1, -1]);
    geo.tri(e1[0], ridge[0], e0[0], dark, [-1, 0, 0]);
    geo.tri(e1[1], e0[1], ridge[1], dark, [1, 0, 0]);
    // shingle stripes
    for (let k = 1; k < 4; k++) {
      const u = k / 4;
      const a0 = [e1[0][0], e1[0][1] + rh * u, e1[0][2] + (mz - e1[0][2]) * u]; const a1 = [e1[1][0], e1[1][1] + rh * u, e1[1][2] + (mz - e1[1][2]) * u];
      geo.quad(a0, a1, [a1[0], a1[1] + 0.05, a1[2] - 0.02], [a0[0], a0[1] + 0.05, a0[2] - 0.02], col(0x3a2c52), [0, 1, 1]);
    }
    // a crooked tower
    const tx = b.x1 - 0.9; const tz = mz;
    geo.add(prim().oct, mat4(tx, y + wh + 1.4, tz, 0.75, 2.8, 0.75, 0.3), wall);
    geo.add(prim().cone, mat4(tx + 0.1, y + wh + 3.5, tz, 0.95, 1.6, 0.95, 0.2, 0, -0.12), roof);
    const m = geo.mesh(vcMat());
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    // glowing windows
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    const win = (x, yy, z, ww, hh2, face = 1) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh2), winMat);
      p.position.set(x, yy, z);
      if (face < 0) p.rotation.y = Math.PI;
      g.add(p);
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(0.05, hh2), new THREE.MeshBasicMaterial({ color: 0x2a1d1a }));
      fr.position.set(x, yy, z + 0.002 * face);
      if (face < 0) fr.rotation.y = Math.PI;
      g.add(fr);
      const gl = glow(0xffa53a, ww * 3.5, 0.35);
      gl.position.set(x, yy, z + 0.2 * face);
      g.add(gl);
      return gl;
    };
    const glows = [win(b.x0 + 1.0, y + 1.75, b.z1 + 0.005, 0.55, 0.6), win(b.x1 - 1.9, y + 1.75, b.z1 + 0.005, 0.55, 0.6), win(mx, y + 1.75, b.z1 + 0.005, 0.45, 0.5),
      win(tx, y + wh + 2.0, tz + 0.66, 0.35, 0.45), win(b.x0 + 1.4, y + 1.6, b.z0 - 0.005, 0.5, 0.55, -1)];
    anim.push((t) => { if (calm()) return; glows.forEach((gl, i) => { gl.material.opacity = 0.3 + 0.12 * Math.sin(t * (3 + i) + i * 2) * Math.sin(t * 7.1 + i); }); });
    // a ghost peeking out of the tower window now and then
    const ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: ghostTex(), transparent: true, depthWrite: false }));
    ghost.scale.set(0.7, 0.8, 1);
    g.add(ghost);
    anim.push((t) => { const u = (t % 9) / 9; const up = Math.max(0, Math.sin(u * Math.PI * 2)) ; ghost.position.set(tx + 0.5 * up, y + wh + 2.0 + up * 0.4, tz + 0.75); ghost.material.opacity = up; });
    return g;
  }
  let _ghost = null;
  const ghostTex = () => _ghost || (_ghost = canvasTex(64, 72, (x) => {
    x.fillStyle = 'rgba(240,240,255,.92)';
    x.beginPath(); x.arc(32, 28, 22, Math.PI, 0); x.lineTo(54, 64); x.lineTo(46, 58); x.lineTo(38, 66); x.lineTo(32, 58); x.lineTo(26, 66); x.lineTo(18, 58); x.lineTo(10, 64); x.closePath(); x.fill();
    x.fillStyle = '#1b1530'; x.beginPath(); x.ellipse(24, 28, 4, 6, 0, 0, Math.PI * 2); x.ellipse(40, 28, 4, 6, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(32, 42, 5, 4, 0, 0, Math.PI * 2); x.fill();
  }));

  function moverMesh(H, m, th, grp, anim) {
    const sh = (x, z) => C.surface(H, x, z, {}).h;
    const spooky = th.id === 'spooky' || m.style === 'bat';
    const mc = th.mill;
    const o = { m };
    if (m.k === 'windmill') {
      const f = m.face || 1;
      const y = sh(m.x, m.z);
      const g = new THREE.Group();
      const geo = new Geo();
      const body = col(mc.body); const trim = col(mc.trim); const base = col(mc.base);
      const span = m.span + 0.25; const z0 = -m.d / 2 - 0.1; const z1 = m.d / 2 + 0.1;
      const tH = 0.9;   // tunnel height
      // the base, with a tunnel through it
      geo.add(prim().box, mat4(-(span + m.w / 2) / 2, 0.6, 0, span - m.w / 2, 1.2, z1 - z0), base, 0.04);
      geo.add(prim().box, mat4((span + m.w / 2) / 2, 0.6, 0, span - m.w / 2, 1.2, z1 - z0), base, 0.04);
      geo.add(prim().box, mat4(0, (1.2 + tH) / 2, 0, m.w + 0.02, 1.2 - tH, z1 - z0), base, 0.04);
      geo.add(prim().box, mat4(0, 1.26, 0, span * 2 + 0.2, 0.12, z1 - z0 + 0.2), trim);
      // stones round the tunnel mouth
      for (let k = 0; k <= 6; k++) {
        const a = Math.PI * (k / 6);
        geo.add(prim().box, mat4(Math.cos(a) * (m.w / 2 + 0.08), tH - 0.25 + Math.sin(a) * 0.32, f * (z1 + 0.04), 0.22, 0.16, 0.08, 0, 0, a + Math.PI / 2), col(mc.stone));
      }
      // the tower
      const tw = spooky ? 0.82 : 0.92;
      geo.add(prim().oct, mat4(0, 1.32 + 1.4, 0, tw, 2.8, tw, Math.PI / 8), body, 0.03);
      for (let k = 0; k < 3; k++) geo.add(prim().box, mat4(0, 1.9 + k * 0.85, f * (tw * 0.86 + 0.02), 0.32, 0.42, 0.06), col(mc.window));
      geo.add(prim().cone, mat4(0, 4.12 + 0.55, 0, tw * 1.05, 1.3, tw * 1.05, Math.PI / 8), trim, 0.04);
      if (spooky) geo.add(prim().cone, mat4(0.2, 5.4, 0, 0.18, 0.6, 0.18, 0, 0, -0.3), trim);
      const mesh = geo.mesh(vcMat());
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
      // dark inside the tunnel
      const inside = new THREE.Mesh(new THREE.PlaneGeometry(m.w, tH), new THREE.MeshBasicMaterial({ color: 0x0b0a12 }));
      inside.position.set(0, tH / 2, 0);
      g.add(inside);
      // the blades
      const hub = new THREE.Group();
      hub.position.set(0, 2.45, f * (m.d / 2 + 0.32));
      const bladeL = 2.25;
      const bm = new THREE.MeshLambertMaterial({ color: mc.blade });
      const sail = new THREE.MeshLambertMaterial({ color: mc.sail, side: THREE.DoubleSide });
      for (let k = 0; k < m.blades; k++) {
        const arm = new THREE.Group();
        arm.rotation.z = (k * Math.PI * 2) / m.blades;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, bladeL, 0.08), bm);
        bar.position.y = -bladeL / 2;
        arm.add(bar);
        if (spooky) {
          // a bat wing
          const s = new THREE.Shape();
          s.moveTo(0, -0.2); s.lineTo(0.75, -0.55); s.lineTo(0.55, -1.0); s.lineTo(0.7, -1.45); s.lineTo(0.42, -1.75); s.lineTo(0.3, -2.2); s.lineTo(0, -2.2);
          const wing = new THREE.Mesh(new THREE.ShapeGeometry(s), sail);
          wing.position.z = 0.05;
          arm.add(wing);
        } else {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.6), sail);
          p.position.set(0.32, -bladeL / 2 - 0.25, 0.04);
          arm.add(p);
          for (let j = 0; j < 4; j++) {
            const slat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.03), bm);
            slat.position.set(0.32, -0.75 - j * 0.42, 0.07);
            arm.add(slat);
          }
        }
        arm.traverse((x) => { if (x.isMesh) x.castShadow = true; });
        hub.add(arm);
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 10), new THREE.MeshLambertMaterial({ color: mc.cap }));
      cap.rotation.x = Math.PI / 2;
      hub.add(cap);
      if (spooky) { const eyes = glow(0xff2a4d, 0.9, 0.9); eyes.position.z = 0.2; hub.add(eyes); }
      g.add(hub);
      g.position.set(m.x, y, m.z);
      if (f < 0) g.rotation.y = 0;   // geometry above is built facing +z (f) already
      grp.add(g);
      o.update = (t) => { const p = C.moverPose(m, t); hub.rotation.z = -p.th * f; };
    } else if (m.k === 'slide') {
      const g = new THREE.Group();
      const geo = new Geo();
      if (m.style === 'gate') {
        geo.add(prim().box, mat4(0, 0.32, 0, m.w, 0.5, m.d), col(0xffffff));
        const n = 5;
        for (let k = 0; k < n; k++) if (k % 2 === 0) geo.add(prim().box, mat4(-m.w / 2 + (k + 0.5) * (m.w / n), 0.32, 0, m.w / n, 0.52, m.d + 0.02), col(0xe23a3a));
        geo.add(prim().box, mat4(0, 0.06, 0, m.w + 0.06, 0.12, m.d + 0.06), col(0x6b4a2b));
      } else if (m.style === 'cart') {
        // a mine cart: a rusty box on four wheels
        geo.add(prim().box, mat4(0, 0.36, 0, m.w * 0.94, 0.42, m.d * 0.9), col(0x7a5a3a), 0.05);
        geo.add(prim().box, mat4(0, 0.58, 0, m.w, 0.06, m.d), col(0x5a4636), 0.03);
        geo.add(prim().box, mat4(0, 0.5, 0, m.w * 0.8, 0.12, m.d * 0.7), col(0xd9a441), 0.15);     // gold ore inside
        const long = m.w > m.d;
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          const wx = long ? a * m.w * 0.32 : b * (m.w / 2); const wz = long ? b * (m.d / 2) : a * m.d * 0.32;
          geo.add(prim().cyl12, mat4(wx, 0.13, wz, 0.13, 0.06, 0.13, 0, long ? Math.PI / 2 : 0, long ? 0 : Math.PI / 2), col(0x2a2a2e));
        }
      } else if (m.style === 'iceblock') {
        const ice = new THREE.Mesh(new THREE.BoxGeometry(m.w, 0.62, m.d), new THREE.MeshPhongMaterial({ color: 0xbfe8ff, emissive: 0x16384f, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.85 }));
        ice.position.y = 0.31;
        ice.castShadow = true;
        g.add(ice);
        geo.add(prim().box, mat4(0, 0.64, 0, m.w * 0.9, 0.06, m.d * 0.85), col(0xffffff), 0.02);
      } else if (m.style === 'crab') {
        // a red crab scuttling sideways
        const red = col(0xe8452e);
        geo.add(prim().sph, mat4(0, 0.26, 0, m.w * 0.36, 0.2, m.d * 0.55), red, 0.04);
        for (const sx of [-1, 1]) {
          geo.add(prim().sph, mat4(sx * m.w * 0.42, 0.3, m.d * 0.25, 0.16, 0.11, 0.13), red, 0.04);             // claws
          geo.add(prim().cyl, mat4(sx * 0.12, 0.5, m.d * 0.2, 0.02, 0.16, 0.02), red, 0);                       // eye stalks
          geo.add(prim().sph, mat4(sx * 0.12, 0.6, m.d * 0.2, 0.045, 0.045, 0.045), col(0x111111), 0);
          for (let k = 0; k < 3; k++) geo.add(prim().box, mat4(sx * m.w * 0.3, 0.1, -m.d * 0.2 + k * m.d * 0.2, 0.3, 0.04, 0.04, 0, 0, sx * 0.5), red, 0);
        }
      } else if (m.style === 'magma') {
        geo.add(prim().box, mat4(0, 0.34, 0, m.w, 0.66, m.d), col(0x2a201e), 0.08);
        const crack = new THREE.Mesh(new THREE.BoxGeometry(m.w * 0.96, 0.08, m.d + 0.02), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
        crack.position.y = 0.36;
        g.add(crack);
        const gl = glow(0xff6a1a, 1.4, 0.45); gl.position.y = 0.4; g.add(gl);
      } else {
        // a tombstone gliding on its base
        geo.add(prim().box, mat4(0, 0.36, 0, m.w * 0.9, 0.62, m.d * 0.8), col(0x8c8aa3), 0.05);
        geo.add(prim().half, mat4(0, 0.67, 0, m.w * 0.45, m.d * 0.8, m.w * 0.45, 0, -Math.PI / 2), col(0x8c8aa3), 0.05);
        geo.add(prim().box, mat4(0, 0.04, 0, m.w, 0.08, m.d), col(0x4b4560));
      }
      const mesh = geo.mesh(vcMat());
      mesh.castShadow = true;
      g.add(mesh);
      if (m.style === 'tomb' || !m.style) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(m.w * 0.6, 0.28), new THREE.MeshLambertMaterial({ map: ripTex(), transparent: true }));
        sign.position.set(0, 0.45, m.d * 0.4 + 0.004);
        g.add(sign);
        const sign2 = sign.clone(); sign2.rotation.y = Math.PI; sign2.position.z = -m.d * 0.4 - 0.004; g.add(sign2);
      } else if (m.style === 'gate' || m.style === 'cart') {
        // the slot (or the rails) it slides in
        const lenX = Math.abs(m.x1 - m.x0) + (m.x1 !== m.x0 ? m.w : 0.12); const lenZ = Math.abs(m.z1 - m.z0) + (m.z1 !== m.z0 ? m.d : 0.12);
        const slot = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.03, lenZ), new THREE.MeshLambertMaterial({ color: m.style === 'cart' ? 0x6a6a72 : 0x5a3e24 }));
        slot.position.set((m.x0 + m.x1) / 2, sh((m.x0 + m.x1) / 2, (m.z0 + m.z1) / 2) + 0.012, (m.z0 + m.z1) / 2);
        grp.add(slot);
      }
      grp.add(g);
      o.update = (t) => { const p = C.moverPose(m, t); g.position.set(p.x, sh(p.x, p.z), p.z); };
    } else if (m.k === 'swing') {
      const y = sh(m.x, m.z);
      const top = 3.3;
      const frame = new Geo();
      const wood = col(0x3b2c22);
      const half = m.amp + 1.2;
      frame.add(prim().box, mat4(m.x - half, y + top / 2, m.z, 0.22, top + 0.2, 0.22, 0, 0, 0.06), wood);
      frame.add(prim().box, mat4(m.x + half, y + top / 2, m.z, 0.22, top + 0.2, 0.22, 0, 0, -0.06), wood);
      frame.add(prim().box, mat4(m.x, y + top + 0.05, m.z, half * 2 + 0.6, 0.22, 0.26), wood);
      const fm = frame.mesh(vcMat());
      fm.castShadow = true;
      grp.add(fm);
      const L = top - 0.64;
      const pend = new THREE.Group();
      pend.position.set(m.x, y + top, m.z);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L - 0.5, 5), new THREE.MeshLambertMaterial({ color: 0x777788 }));
      chain.position.y = -(L - 0.5) / 2;
      pend.add(chain);
      if (m.style === 'log') {
        // a log on two ropes
        const logM = new THREE.Mesh(new THREE.CylinderGeometry(m.d / 2, m.d / 2, m.w, 12), new THREE.MeshLambertMaterial({ color: 0x8a5a32 }));
        logM.rotation.z = Math.PI / 2;
        logM.position.y = -L;
        logM.castShadow = true;
        for (const sx of [-1, 1]) {
          const end = new THREE.Mesh(new THREE.CircleGeometry(m.d / 2 - 0.02, 12), new THREE.MeshLambertMaterial({ color: 0xd9a86c }));
          end.rotation.y = sx * Math.PI / 2; end.position.set(sx * (m.w / 2 + 0.002), -L, 0);
          pend.add(end);
        }
        chain.material.color.setHex(0xc9a35a);
        pend.add(logM);
        grp.add(pend);
        o.update = (t) => {
          const p = C.moverPose(m, t);
          pend.rotation.z = Math.asin(Math.max(-1, Math.min(1, (p.x - m.x) / L)));
        };
        return o;
      }
      // a coffin: a long hexagon
      const s = new THREE.Shape();
      const cw = m.w / 2; const chh = 0.55;
      s.moveTo(-cw * 0.55, -chh); s.lineTo(cw * 0.55, -chh); s.lineTo(cw, 0.1); s.lineTo(cw * 0.7, chh); s.lineTo(-cw * 0.7, chh); s.lineTo(-cw, 0.1); s.closePath();
      const cg = new THREE.ExtrudeGeometry(s, { depth: m.d, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
      cg.translate(0, 0, -m.d / 2);
      const coffin = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: 0x5a3a28 }));
      coffin.position.y = -L;
      coffin.castShadow = true;
      pend.add(coffin);
      const cross = new THREE.Group();
      const cm = new THREE.MeshBasicMaterial({ color: 0xd9b56a });
      const v1 = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.5), cm); const v2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.07), cm);
      v2.position.y = 0.08;
      cross.add(v1, v2);
      cross.position.set(0, -L + 0.03, m.d / 2 + 0.035);
      const cross2 = cross.clone(); cross2.rotation.y = Math.PI; cross2.position.z = -m.d / 2 - 0.035;
      pend.add(cross, cross2);
      grp.add(pend);
      o.update = (t) => {
        const p = C.moverPose(m, t);
        pend.rotation.z = Math.asin(Math.max(-1, Math.min(1, (p.x - m.x) / L)));
      };
    } else if (m.k === 'spin') {
      // a bar turning round a post
      const y = sh(m.x, m.z);
      const g = new THREE.Group();
      const look = m.style === 'iceblock' ? [0xbfe8ff, 0x16384f] : m.style === 'magma' ? [0x2a201e, 0x000000] : [0x9a6a3e, 0x000000];
      const bar = new THREE.Mesh(new THREE.BoxGeometry(m.len, 0.42, m.w || 0.3), new THREE.MeshPhongMaterial({ color: look[0], emissive: look[1], shininess: m.style === 'iceblock' ? 80 : 10, transparent: m.style === 'iceblock', opacity: 0.88 }));
      bar.position.y = 0.23;
      bar.castShadow = true;
      g.add(bar);
      if (m.style === 'magma') {
        const crack = new THREE.Mesh(new THREE.BoxGeometry(m.len * 0.98, 0.07, (m.w || 0.3) + 0.02), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
        crack.position.y = 0.25; g.add(crack);
      }
      for (const sx of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.46, 10), new THREE.MeshLambertMaterial({ color: m.style === 'magma' ? 0xff6a1a : m.style === 'iceblock' ? 0xffffff : 0xd2493b }));
        cap.position.set(sx * m.len / 2, 0.23, 0); g.add(cap);
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 12), new THREE.MeshLambertMaterial({ color: 0x55555f }));
      post.position.y = 0.35; g.add(post);
      g.position.set(m.x, y, m.z);
      grp.add(g);
      o.update = (t) => { g.rotation.y = -C.moverPose(m, t).a; };
    } else {
      o.update = () => {};
    }
    return o;
  }
  function teleMesh(H, tp, th, grp, anim) {
    const sh = (x, z) => C.surface(H, x, z, {}).h;
    // a swirl on the ground at the entrance and the exit
    const swirlTex = canvasTex(128, 128, (x) => {
      x.translate(64, 64);
      for (let k = 0; k < 3; k++) {
        x.rotate((Math.PI * 2) / 3);
        x.strokeStyle = th.swirl; x.lineWidth = 7; x.lineCap = 'round';
        x.beginPath(); for (let a = 0; a < 4.2; a += 0.1) { const r = 6 + a * 12; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.stroke();
      }
    });
    const mk = (x, z, size) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshBasicMaterial({ map: swirlTex, transparent: true, depthWrite: false, opacity: tp.boo ? 0.4 : 0.8 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, sh(x, z) + 0.012, z);
      grp.add(m);
      anim.push((t) => { if (!calm()) m.rotation.z = t * 2; });
      return m;
    };
    if (tp.style === 'burrow' || tp.style === 'cave') {
      // a hollow log poking out of the hedge (or a mine shaft in the rock), and another one where you come out
      const cave = tp.style === 'cave';
      const log = (x, z, dx, dz) => {
        const g = new THREE.Group();
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, cave ? 7 : 14, 1, true), new THREE.MeshLambertMaterial({ color: cave ? 0x8a5a36 : 0x7a4c29, side: THREE.DoubleSide, flatShading: cave }));
        lg.rotation.z = Math.PI / 2;
        const inner = new THREE.Mesh(new THREE.CircleGeometry(0.4, 14), new THREE.MeshBasicMaterial({ color: 0x120a04 }));
        inner.rotation.y = Math.PI / 2;
        inner.position.x = 0.25;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.43, 14), new THREE.MeshLambertMaterial({ color: cave ? 0x5a3e24 : 0xd8a56c, side: THREE.DoubleSide }));
        ring.rotation.y = Math.PI / 2;
        ring.position.x = -0.55;
        g.add(lg, inner, ring);
        g.position.set(x, sh(x, z) + 0.3, z);
        g.rotation.y = Math.atan2(dz, -dx);
        lg.castShadow = true;
        grp.add(g);
      };
      log(tp.fx + 0.55, tp.fz, -1, 0);
      log(tp.tx - 0.5, tp.tz, 1, 0);
      mk(tp.fx, tp.fz, 0.42);
      mk(tp.tx, tp.tz, 0.32);
    } else if (tp.style === 'door') {
      // a door in the haunted house (the house itself is drawn with the block)
      const door = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.25, 0.08), new THREE.MeshLambertMaterial({ color: 0x1c1428 }));
      frame.position.y = 0.62;
      const inside = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.05), new THREE.MeshBasicMaterial({ color: tp.boo ? 0x5a0d2a : 0x3b0f6e }));
      inside.position.set(0, 0.55, 0.045);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.375, 16, 0, Math.PI), inside.material);
      top.position.set(0, 1.07, 0.046);
      const gl = glow(tp.boo ? 0xff3366 : 0xa855f7, 1.6, 0.55);
      gl.position.set(0, 0.6, 0.25);
      door.add(frame, inside, top, gl);
      door.position.set(tp.fx, sh(tp.fx, tp.fz), tp.fz - 0.08);
      grp.add(door);
      anim.push((t) => { gl.material.opacity = 0.45 + 0.2 * Math.sin(t * 3 + tp.fx); });
      if (!tp.boo) {
        // the back door you come out of
        const back = door.clone();
        back.position.set(tp.tx, sh(tp.tx, tp.tz), tp.tz + 0.2);
        back.rotation.y = Math.PI;
        grp.add(back);
        mk(tp.tx, tp.tz - 0.2, 0.3);
      }
      mk(tp.fx, tp.fz + 0.25, 0.36);
    }
  }
  /** One piece of scenery. */
  function decoItem(kind, x, z, s, r, ctx) {
    const { H, grp, put, anim, rnd, spooky, sh, th } = ctx;
    const inCourse = (xx, zz) => xx >= 0 && zz >= 0 && xx < H.W && zz < H.D;
    const y = inCourse(x, z) && C.solid(C.floorAt(H, x, z)) ? sh(x, z) : ctx.groundY(x, z);
    switch (kind) {
      case 'tree': {
        const hgt = 1.4 * s;
        put(prim().cyl, x, y + hgt / 2, z, 0.14 * s, hgt, 0.14 * s, r, 0x7b5133);
        const greens = [0x4fae3c, 0x5cbf45, 0x3f9a35, 0x6bc94f];
        const g = greens[(rnd() * greens.length) | 0];
        put(prim().ico, x, y + hgt + 0.55 * s, z, 0.95 * s, 0.85 * s, 0.95 * s, r, g, 0.08);
        put(prim().ico, x + 0.35 * s, y + hgt + 0.15 * s, z + 0.2 * s, 0.6 * s, 0.55 * s, 0.6 * s, r + 1, g, 0.08);
        put(prim().ico, x - 0.3 * s, y + hgt + 0.25 * s, z - 0.25 * s, 0.55 * s, 0.5 * s, 0.55 * s, r + 2, g, 0.08);
        break;
      }
      case 'pine': {
        put(prim().cyl, x, y + 0.4 * s, z, 0.12 * s, 0.8 * s, 0.12 * s, r, 0x6d4529);
        for (let k = 0; k < 3; k++) put(prim().cone, x, y + (0.9 + k * 0.62) * s, z, (0.85 - k * 0.22) * s, 1.0 * s, (0.85 - k * 0.22) * s, r + k, k % 2 ? 0x2f7d45 : 0x37904f, 0.06);
        break;
      }
      case 'bush':
        put(prim().ico, x, y + 0.3 * s, z, 0.55 * s, 0.42 * s, 0.55 * s, r, 0x4caa3f, 0.1);
        put(prim().ico, x + 0.35 * s, y + 0.22 * s, z + 0.1, 0.38 * s, 0.32 * s, 0.38 * s, r + 1, 0x5cbb48, 0.1);
        if (rnd() < 0.5) for (let k = 0; k < 3; k++) put(prim().sph, x + (rnd() - 0.5) * 0.6 * s, y + 0.5 * s, z + (rnd() - 0.5) * 0.6 * s, 0.06, 0.06, 0.06, 0, 0xff5470, 0);
        break;
      case 'rock':
        put(prim().dode, x, y + 0.12 * s, z, 0.45 * s, 0.32 * s, 0.38 * s, r, th.rock, 0.12);
        if (rnd() < 0.5) put(prim().dode, x + 0.4 * s, y + 0.05, z + 0.2, 0.22 * s, 0.16 * s, 0.2 * s, r + 2, col(th.rock).offsetHSL(0, 0, -0.05).getHex(), 0.12);
        if (th.id === 'winter') put(prim().dode, x, y + 0.3 * s, z, 0.36 * s, 0.1 * s, 0.3 * s, r, 0xffffff, 0.04);
        break;
      case 'flowers': {
        const cols = [0xff5c8a, 0xffd23f, 0xffffff, 0xb57bff, 0xff8a3d];
        for (let k = 0; k < 9; k++) {
          const fx = x + (rnd() - 0.5) * 1.3 * s; const fz = z + (rnd() - 0.5) * 1.3 * s;
          put(prim().cyl, fx, y + 0.1, fz, 0.015, 0.2, 0.015, 0, 0x3f8f35, 0);
          put(prim().ico, fx, y + 0.22, fz, 0.07, 0.05, 0.07, rnd() * 6, cols[(rnd() * cols.length) | 0], 0.05);
        }
        put(prim().ico, x, y + 0.08, z, 0.5 * s, 0.12, 0.5 * s, 0, 0x4a9e3c, 0.05);
        break;
      }
      case 'bench':
        for (const k of [-0.4, 0.4]) put(prim().box, x + Math.cos(r) * k, y + 0.18, z - Math.sin(r) * k, 0.08, 0.36, 0.35, r, 0x5a5a62);
        put(prim().box, x, y + 0.36, z, 1.1, 0.06, 0.38, r, 0xc28a52);
        put(prim().box, x - Math.sin(r) * 0.17, y + 0.58, z - Math.cos(r) * 0.17, 1.1, 0.24, 0.05, r, 0xb07a45);
        break;
      case 'sign':
      case 'teesign': {
        put(prim().box, x, y + 0.45, z, 0.08, 0.9, 0.08, r, 0x7b5133);
        const tex = canvasTex(256, 140, (c, w, hh) => {
          c.fillStyle = th.sign[0]; c.fillRect(0, 0, w, hh);
          c.strokeStyle = th.sign[1]; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, hh - 10);
          c.fillStyle = th.sign[2]; c.textAlign = 'center'; c.textBaseline = 'middle';
          if (kind === 'teesign' && ctx.hd) {
            c.font = '700 44px Bungee, Fredoka, sans-serif'; c.fillText(`HOLE ${ctx.hd.n}`, w / 2, 50);
            c.font = '700 34px Fredoka, sans-serif'; c.fillText(`PAR ${ctx.hd.par}`, w / 2, 102);
          } else { c.font = '700 40px Bungee, Fredoka, sans-serif'; c.fillText('⛳ FORE!', w / 2, hh / 2 + 4); }
        });
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.44, 0.05), [0, 0, 0, 0, 0, 0].map((_, i) => (i === 4 || i === 5 ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ color: th.sign[3] }))));
        board.position.set(x, y + 0.85, z);
        board.rotation.y = r;
        board.castShadow = true;
        grp.add(board);
        break;
      }
      case 'fence':
        for (let k = -3; k <= 3; k++) {
          const fx = x + Math.sin(r) * k * 0.45; const fz = z + Math.cos(r) * k * 0.45;
          put(prim().box, fx, y + 0.3, fz, 0.1, 0.6, 0.06, r, 0xf8f4ec, 0.02);
          put(prim().cone, fx, y + 0.65, fz, 0.07, 0.1, 0.05, r, 0xf8f4ec, 0);
        }
        put(prim().box, x, y + 0.42, z, 0.04, 0.07, 2.9, r, 0xece6da, 0);
        put(prim().box, x, y + 0.2, z, 0.04, 0.07, 2.9, r, 0xece6da, 0);
        break;
      case 'lily': {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(0.32 * s, 12, 0.4, Math.PI * 2 - 0.5), new THREE.MeshLambertMaterial({ color: 0x3f9e3a, side: THREE.DoubleSide }));
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rnd() * 6;
        grp.add(pad);
        const fl = rnd() < 0.6 ? new THREE.Mesh(prim().ico, new THREE.MeshLambertMaterial({ color: 0xff8fc0 })) : null;
        if (fl) { fl.scale.set(0.09, 0.07, 0.09); grp.add(fl); }
        const ph2 = rnd() * 6;
        anim.push((t) => { const yy = P.WATER_Y + 0.02 + Math.sin(t * 1.3 + ph2) * 0.015; pad.position.set(x, yy, z); if (fl) fl.position.set(x + 0.08, yy + 0.05, z); });
        break;
      }
      case 'duck': {
        const d = new THREE.Group();
        const ym = new THREE.MeshLambertMaterial({ color: 0xffd23f });
        const body = new THREE.Mesh(prim().sph, ym); body.scale.set(0.22, 0.16, 0.3);
        const head = new THREE.Mesh(prim().sph, ym); head.scale.setScalar(0.12); head.position.set(0, 0.17, 0.18);
        const beak = new THREE.Mesh(prim().cone, new THREE.MeshLambertMaterial({ color: 0xff7a1a })); beak.scale.set(0.05, 0.1, 0.05); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.16, 0.31);
        d.add(body, head, beak);
        grp.add(d);
        anim.push((t) => { const u = t * 0.25; d.position.set(x + Math.sin(u) * 1.2, P.WATER_Y + 0.06 + Math.sin(t * 2) * 0.02, z + Math.cos(u * 1.3) * 0.8); d.rotation.y = u + Math.PI / 2; });
        break;
      }
      case 'reeds':
        for (let k = 0; k < 7; k++) {
          const rx = x + (rnd() - 0.5) * 0.7; const rz = z + (rnd() - 0.5) * 0.7; const hh = 0.6 + rnd() * 0.6;
          put(prim().cyl, rx, P.WATER_Y + hh / 2, rz, 0.025, hh, 0.025, 0, th.reeds, 0.06, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
          if (rnd() < 0.5) put(prim().cyl, rx, P.WATER_Y + hh, rz, 0.05, 0.18, 0.05, 0, 0x6b4426, 0);
        }
        break;
      case 'deadtree': {
        const hgt = 2.2 * s;
        const bark = 0x2f2638;
        put(prim().cyl, x, y + hgt / 2, z, 0.16 * s, hgt, 0.16 * s, r, bark, 0.04, 0.05, -0.08);
        for (let k = 0; k < 4; k++) {
          const a = r + k * 1.7; const by = y + hgt * (0.45 + k * 0.13); const len = (0.9 - k * 0.12) * s;
          put(prim().cyl, x + Math.cos(a) * len * 0.42, by + len * 0.3, z + Math.sin(a) * len * 0.42, 0.06 * s, len, 0.06 * s, -a, bark, 0.04, 0, 0.9);
        }
        break;
      }
      case 'grave':
        ctx.addTomb ? ctx.addTomb(x, y, z, 0.55 * s, 0.75 * s, 0.16 * s, r, [0x76738c, 0x8a8aa0, 0x6a6780][(rnd() * 3) | 0]) : null;
        break;
      case 'cross':
        put(prim().box, x, y + 0.42 * s, z, 0.1 * s, 0.84 * s, 0.1 * s, r, 0x6f6a85, 0.06, 0, (rnd() - 0.5) * 0.25);
        put(prim().box, x, y + 0.6 * s, z, 0.46 * s, 0.1 * s, 0.1 * s, r, 0x6f6a85, 0.06, 0, (rnd() - 0.5) * 0.25);
        break;
      case 'mushroom': {
        put(prim().cyl, x, y + 0.1, z, 0.05, 0.2, 0.05, 0, 0xe8e0d0, 0);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffb0 }));
        cap.position.set(x, y + 0.2, z);
        grp.add(cap);
        const g = glow(0x5dff9a, 0.9, 0.35); g.position.set(x, y + 0.3, z); grp.add(g);
        break;
      }
      case 'fencebit':
        for (let k = -2; k <= 2; k++) {
          const fx = x + Math.cos(r) * k * 0.3; const fz = z - Math.sin(r) * k * 0.3;
          put(prim().box, fx, y + 0.45, fz, 0.05, 0.9, 0.05, r, 0x1a1525, 0);
          put(prim().cone, fx, y + 0.95, fz, 0.06, 0.14, 0.06, r, 0x1a1525, 0);
        }
        put(prim().box, x, y + 0.75, z, 1.3, 0.05, 0.04, r, 0x1a1525, 0);
        break;
      case 'pumpkin': {
        const p = pumpkin(0.3 * s, true);
        p.position.set(x, y, z);
        p.rotation.y = Math.atan2((H.tee[0] - x), (H.tee[1] - z));
        grp.add(p);
        break;
      }
      case 'candle': {
        const hgt = 0.18 + rnd() * 0.16;
        const base = inCourse(x, z) && C.floorAt(H, x, z) !== C.VOID ? y : y;
        // standing on a rail if there's one right here
        let yy = base;
        for (const w of H.walls) {
          if (w.kind !== 'rail') continue;
          const ex = w.bx - w.ax; const ez = w.bz - w.az;
          const u = Math.max(0, Math.min(1, ((x - w.ax) * ex + (z - w.az) * ez) / (w.len * w.len)));
          if (Math.hypot(x - w.ax - ex * u, z - w.az - ez * u) < 0.3) { yy = sh(w.ax + ex * u + w.nx * 0.05, w.az + ez * u + w.nz * 0.05) + P.WALL_H; break; }
        }
        put(prim().cyl, x, yy + hgt / 2, z, 0.05, hgt, 0.05, 0, 0xf3ead2, 0.03);
        const flame = glow(0xffc35a, 0.28, 1);
        const halo = glow(0xff9a3c, 1.5, 0.35);
        grp.add(flame, halo);
        const ph2 = rnd() * 9;
        anim.push((t) => {
          const f = calm() ? 1 : 0.85 + 0.15 * Math.sin(t * 13 + ph2) * Math.sin(t * 7.7 + ph2 * 2);
          flame.position.set(x, yy + hgt + 0.07, z); flame.scale.set(0.2 * f, 0.32 * f, 1);
          halo.position.set(x, yy + hgt + 0.1, z); halo.material.opacity = 0.3 * f;
        });
        break;
      }
      case 'gate': {
        // an iron graveyard gate arching over the path
        let x0 = null; let x1 = null; const row = Math.floor(z);
        for (let k = 0; k < H.W; k++) if (C.solid(H.code[row * H.W + k])) { if (x0 === null) x0 = k; x1 = k + 1; }
        if (x0 === null) break;
        const l = x0 - 0.35; const rr = x1 + 0.35;
        for (const px of [l, rr]) { put(prim().box, px, y + 1.1, z, 0.42, 2.2, 0.42, 0, 0x5b5570, 0.04); put(prim().cone, px, y + 2.4, z, 0.32, 0.4, 0.32, Math.PI / 4, 0x3f3a52, 0); }
        // a wrought-iron arch with spikes, and a sign hanging from it
        const iron = new THREE.MeshLambertMaterial({ color: 0x15111f });
        const half = (rr - l) / 2;
        const arch = new THREE.Mesh(new THREE.TorusGeometry(half, 0.05, 6, 32, Math.PI), iron);
        arch.position.set((l + rr) / 2, y + 2.05, z);
        arch.scale.y = 0.42;
        const arch2 = arch.clone(); arch2.position.y = y + 1.95; arch2.scale.y = 0.3;
        grp.add(arch, arch2);
        for (let k = 1; k < 8; k++) {
          const a = Math.PI * (k / 8);
          put(prim().cone, (l + rr) / 2 - Math.cos(a) * half, y + 2.05 + Math.sin(a) * half * 0.42 + 0.1, z, 0.05, 0.22, 0.05, 0, 0x15111f, 0);
        }
        const tex = canvasTex(512, 96, (c, w, hh) => {
          c.fillStyle = '#1d1630'; c.fillRect(0, 0, w, hh); c.strokeStyle = '#ffb347'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, hh - 12);
          c.fillStyle = '#ffb347'; c.font = '700 52px Bungee, Fredoka, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SPOOKY HOLLOW', w / 2, hh / 2 + 3, w - 40);
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.42), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
        sign.position.set((l + rr) / 2, y + 2.0, z);
        grp.add(sign);
        break;
      }
      case 'scarecrow':
        put(prim().box, x, y + 0.9, z, 0.08, 1.8, 0.08, r, 0x6b4a2b);
        put(prim().box, x, y + 1.3, z, 1.2, 0.07, 0.07, r, 0x6b4a2b);
        put(prim().box, x, y + 1.15, z, 0.45, 0.55, 0.25, r, 0x5b3f78, 0.05);
        { const p = pumpkin(0.22, true); p.position.set(x, y + 1.42, z); p.rotation.y = Math.atan2(H.tee[0] - x, H.tee[1] - z); grp.add(p); }
        put(prim().cone, x, y + 1.95, z, 0.3, 0.35, 0.3, r, 0x1a1525, 0);
        break;
      case 'broom':
        put(prim().cyl, x, y + 0.75, z, 0.035, 1.5, 0.035, r, 0x7b5133, 0, 0, 0.4);
        put(prim().cone, x + 0.32, y + 0.08, z, 0.18, 0.4, 0.18, r, 0xc9a35a, 0.1, 0, 0.4 + Math.PI);
        break;
      case 'wisp': {
        const g = glow(0x6dffb1, 0.9, 0.8);
        const g2 = glow(0x6dffb1, 0.25, 1);
        grp.add(g, g2);
        const ph2 = rnd() * 9;
        anim.push((t) => { const yy = P.WATER_Y + 0.7 + Math.sin(t * 1.4 + ph2) * 0.25; const xx = x + Math.sin(t * 0.5 + ph2) * 0.6; g.position.set(xx, yy, z); g2.position.set(xx, yy, z); g.material.opacity = 0.55 + 0.25 * Math.sin(t * 3 + ph2); });
        break;
      }
      case 'cactus': {
        // a saguaro: a trunk and an arm or two
        const g = 0x4f9a3c; const hgt = 1.5 * s;
        put(prim().cyl12, x, y + hgt / 2, z, 0.17 * s, hgt, 0.17 * s, r, g, 0.05);
        put(prim().sph, x, y + hgt, z, 0.17 * s, 0.12 * s, 0.17 * s, 0, g, 0.05);
        for (const [sx, hy, len] of [[1, 0.55, 0.5], [-1, 0.75, 0.38]]) {
          if (sx < 0 && rnd() < 0.4) continue;
          const ax = x + Math.cos(r) * sx * 0.32 * s; const az = z - Math.sin(r) * sx * 0.32 * s;
          put(prim().cyl12, x + Math.cos(r) * sx * 0.18 * s, y + hgt * hy, z - Math.sin(r) * sx * 0.18 * s, 0.1 * s, 0.3 * s, 0.1 * s, r, g, 0.05, 0, 0, sx * Math.PI / 2);
          put(prim().cyl12, ax, y + hgt * hy + len * s / 2, az, 0.1 * s, len * s, 0.1 * s, r, g, 0.05);
          put(prim().sph, ax, y + hgt * hy + len * s, az, 0.1 * s, 0.08 * s, 0.1 * s, 0, g, 0.05);
        }
        if (rnd() < 0.5) put(prim().ico, x, y + hgt + 0.1 * s, z, 0.07, 0.05, 0.07, 0, 0xff6fae, 0);
        break;
      }
      case 'drybush':
        for (let k = 0; k < 6; k++) put(prim().cyl, x + (rnd() - 0.5) * 0.3 * s, y + 0.2 * s, z + (rnd() - 0.5) * 0.3 * s, 0.02, 0.45 * s, 0.02, rnd() * 6, 0x9a7a4a, 0.1, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 1.2);
        put(prim().ico, x, y + 0.12 * s, z, 0.28 * s, 0.16 * s, 0.28 * s, r, 0xa8925a, 0.12);
        break;
      case 'skull':
        put(prim().sph, x, y + 0.11, z, 0.13, 0.11, 0.15, r, 0xf2ead8, 0.03);
        put(prim().box, x - Math.sin(r) * 0.12, y + 0.05, z - Math.cos(r) * 0.12, 0.12, 0.06, 0.06, r, 0xf2ead8, 0.03);
        for (const sx of [-1, 1]) put(prim().cyl, x + Math.cos(r) * sx * 0.32, y + 0.14, z - Math.sin(r) * sx * 0.32, 0.025, 0.4, 0.025, r, 0xf2ead8, 0.03, 0, sx * 1.1);    // horns
        break;
      case 'tumbleweed': {
        const tw = new THREE.Mesh(prim().ico1, new THREE.MeshLambertMaterial({ color: 0xa8875a, wireframe: true }));
        tw.scale.setScalar(0.32 * s);
        grp.add(tw);
        const ph2 = rnd() * 50; const sp = 0.5 + rnd() * 0.4;
        anim.push((t) => {
          const u = calm() ? 0 : ((t * sp + ph2) % 16) - 8;
          tw.position.set(x + u, ctx.groundY(x + u, z) + 0.32 * s + Math.abs(Math.sin(t * 3 + ph2)) * 0.15, z);
          tw.rotation.z = -u * 2;
        });
        break;
      }
      case 'barrel':
        put(prim().cyl12, x, y + 0.32, z, 0.26, 0.64, 0.26, r, 0x8a5a32, 0.04);
        for (const hy of [0.12, 0.52]) put(prim().cyl12, x, y + hy, z, 0.27, 0.04, 0.27, r, 0x4a4a52, 0);
        break;
      case 'palm': {
        // a curved trunk and a crown of leaves
        const hgt = 2.4 * s; const lean = 0.18 + rnd() * 0.12; const n = 6;
        let px = x; let py = y; let pz = z;
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n; const seg = hgt / n;
          const ox = Math.cos(r) * lean * u * u * hgt; const oz = Math.sin(r) * lean * u * u * hgt;
          px = x + ox; pz = z + oz; py = y + u * hgt;
          put(prim().cyl, px, py, pz, (0.13 - u * 0.04) * s, seg * 1.05, (0.13 - u * 0.04) * s, 0, k % 2 ? 0x9a7048 : 0x8a6240, 0.04, 0, 0);
        }
        const top = py + hgt / n / 2;
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2 + rnd() * 0.3;
          put(prim().box, px + Math.cos(a) * 0.55 * s, top - 0.12 * s, pz + Math.sin(a) * 0.55 * s, 1.15 * s, 0.04, 0.26 * s, -a, k % 2 ? 0x3fae4a : 0x2f9a3e, 0.08, 0, -0.35);
        }
        for (let k = 0; k < 3; k++) put(prim().sph, px + (rnd() - 0.5) * 0.2, top - 0.15, pz + (rnd() - 0.5) * 0.2, 0.09, 0.09, 0.09, 0, 0x6b4a2a, 0);
        break;
      }
      case 'umbrella': {
        put(prim().cyl, x, y + 0.75, z, 0.03, 1.5, 0.03, 0, 0xf3f3f3, 0, 0, 0.1);
        const cols = [0xff4f6b, 0xffffff, 0x2fa8ff, 0xffd23f];
        const c0 = cols[(rnd() * cols.length) | 0];
        for (let k = 0; k < 8; k++) put(prim().cone, x + 0.07, y + 1.55, z, 0.95, 0.42, 0.95, (k / 8) * Math.PI * 2, k % 2 ? 0xffffff : c0, 0, 0, 0.1);
        put(prim().box, x + 0.7, y + 0.06, z + 0.3, 0.6, 0.04, 1.2, r, 0xffffff, 0);    // a towel
        put(prim().box, x + 0.7, y + 0.065, z + 0.3, 0.6, 0.04, 0.2, r, c0, 0);
        break;
      }
      case 'starfish':
        for (let k = 0; k < 5; k++) put(prim().cone, x + Math.cos(k * 1.2566 + r) * 0.1, y + 0.02, z + Math.sin(k * 1.2566 + r) * 0.1, 0.06, 0.24, 0.035, -(k * 1.2566 + r), 0xff8a5c, 0, 0, Math.PI / 2);
        break;
      case 'surfboard':
        put(prim().sph, x, y + 0.7, z, 0.24, 0.8, 0.05, r, [0xff4f6b, 0x2fa8ff, 0xffd23f][(rnd() * 3) | 0], 0, 0, 0.12);
        break;
      case 'boat':
        put(prim().box, x, P.WATER_Y + 0.12, z, 1.4, 0.26, 0.6, r, 0xd9532f, 0.03);
        put(prim().box, x, P.WATER_Y + 0.28, z, 1.2, 0.06, 0.5, r, 0xc49a6c, 0.03);
        put(prim().cyl, x, P.WATER_Y + 0.9, z, 0.03, 1.2, 0.03, 0, 0x8a5a32, 0);
        put(prim().cone, x + Math.cos(r) * 0.2, P.WATER_Y + 1.0, z - Math.sin(r) * 0.2, 0.3, 0.9, 0.04, r + Math.PI / 2, 0xffffff, 0);
        break;
      case 'wreck':
        for (let k = 0; k < 5; k++) put(prim().box, x + (k - 2) * 0.3, y + 0.2 + Math.abs(k - 2) * 0.12, z, 0.26, 0.5 + Math.abs(k - 2) * 0.25, 1.6, r, 0x6b4a2b, 0.08, 0, (k - 2) * 0.15);
        put(prim().cyl, x, y + 0.9, z, 0.05, 1.8, 0.05, 0, 0x5a3e24, 0, 0.4, 0.3);
        break;
      case 'chest':
        put(prim().box, x, y + 0.18, z, 0.6, 0.36, 0.4, r, 0x8a5a32, 0.04);
        put(prim().half, x, y + 0.36, z, 0.3, 0.6, 0.2, r, 0x7a4c29, 0.04, 0, Math.PI / 2);
        put(prim().box, x, y + 0.2, z, 0.62, 0.06, 0.42, r, 0xd9a441, 0);
        { const g = glow(0xffd23f, 1.2, 0.5); g.position.set(x, y + 0.45, z); grp.add(g); }
        break;
      case 'snowman':
        put(prim().sph, x, y + 0.32 * s, z, 0.34 * s, 0.32 * s, 0.34 * s, 0, 0xffffff, 0.02);
        put(prim().sph, x, y + 0.8 * s, z, 0.24 * s, 0.23 * s, 0.24 * s, 0, 0xffffff, 0.02);
        put(prim().sph, x, y + 1.15 * s, z, 0.17 * s, 0.17 * s, 0.17 * s, 0, 0xffffff, 0.02);
        {
          const a = Math.atan2(H.tee[0] - x, H.tee[1] - z);
          put(prim().cone, x + Math.sin(a) * 0.2 * s, y + 1.14 * s, z + Math.cos(a) * 0.2 * s, 0.035 * s, 0.18 * s, 0.035 * s, 0, 0xff7a1a, 0, Math.PI / 2 * Math.cos(a), -Math.PI / 2 * Math.sin(a));
          put(prim().cyl12, x, y + 1.32 * s, z, 0.13 * s, 0.05 * s, 0.13 * s, 0, 0x222228, 0);
          put(prim().cyl12, x, y + 1.42 * s, z, 0.09 * s, 0.18 * s, 0.09 * s, 0, 0x222228, 0);
          put(prim().box, x, y + 0.98 * s, z, 0.36 * s, 0.07 * s, 0.36 * s, 0, 0xd2493b, 0);     // scarf
        }
        break;
      case 'snowpine': {
        put(prim().cyl, x, y + 0.4 * s, z, 0.12 * s, 0.8 * s, 0.12 * s, r, 0x6d4529);
        for (let k = 0; k < 3; k++) {
          const yy = y + (0.9 + k * 0.62) * s; const rr = (0.85 - k * 0.22) * s;
          put(prim().cone, x, yy, z, rr, 1.0 * s, rr, r + k, k % 2 ? 0x2d6e48 : 0x347c52, 0.06);
          put(prim().cone, x, yy + 0.22 * s, z, rr * 0.7, 0.5 * s, rr * 0.7, r + k, 0xf6f9ff, 0.02);
        }
        break;
      }
      case 'drift':
        put(prim().sph, x, y, z, 0.7 * s, 0.22 * s, 0.5 * s, r, 0xf6f9ff, 0.02);
        break;
      case 'basalt': {
        const n = 3 + ((rnd() * 4) | 0);
        for (let k = 0; k < n; k++) { const hh2 = (0.6 + rnd() * 1.6) * s; put(prim().cyl, x + (rnd() - 0.5) * 0.7 * s, y + hh2 / 2, z + (rnd() - 0.5) * 0.7 * s, 0.2 * s, hh2, 0.2 * s, rnd(), 0x2e2725, 0.1); }
        break;
      }
      case 'crystal': {
        const c = [0xff7a2a, 0xffb347, 0xff4a6a][(rnd() * 3) | 0];
        for (let k = 0; k < 4; k++) {
          const m = new THREE.Mesh(prim().oct, new THREE.MeshBasicMaterial({ color: c }));
          const hh2 = (0.3 + rnd() * 0.4) * s;
          m.scale.set(0.08 * s, hh2, 0.08 * s);
          m.position.set(x + (rnd() - 0.5) * 0.4 * s, y + hh2 / 2, z + (rnd() - 0.5) * 0.4 * s);
          m.rotation.set((rnd() - 0.5) * 0.6, rnd() * 6, (rnd() - 0.5) * 0.6);
          grp.add(m);
        }
        const g = glow(c, 1.4 * s, 0.4); g.position.set(x, y + 0.3, z); grp.add(g);
        break;
      }
      case 'vent': {
        // a glowing crack in the ground with sparks drifting up
        put(prim().box, x, y + 0.01, z, 0.9 * s, 0.03, 0.12 * s, r, 0xff6a1a, 0);
        const g = glow(0xff6a1a, 1.5 * s, 0.5); g.position.set(x, y + 0.1, z); grp.add(g);
        const ph2 = rnd() * 9;
        anim.push((t) => { g.material.opacity = 0.35 + 0.15 * Math.sin(t * 3 + ph2); });
        break;
      }
      case 'smoke': {
        for (let k = 0; k < 4; k++) {
          textures();
          const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x5a4a48, transparent: true, opacity: 0.4, depthWrite: false }));
          grp.add(f);
          const ph2 = k / 4;
          anim.push((t) => { const u = (t * 0.12 + ph2) % 1; const sz = 2 + u * 5; f.scale.set(sz, sz, 1); f.position.set(x + u * 1.5, y + 1 + u * 7, z); f.material.opacity = 0.45 * Math.sin(u * Math.PI); });
        }
        break;
      }
      default:
        break;
    }
  }
  /** A bumper in the course's style: a barrel cactus, a snowman, a beach ball or a glowing lava rock. */
  function bumperMesh(kind, r, rnd, anim) {
    const g = new THREE.Group();
    if (kind === 'cactus') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshLambertMaterial({ color: 0x4f9a3c, flatShading: true }));
      body.scale.y = 0.95; body.position.y = r * 0.85;
      const fl = new THREE.Mesh(prim().ico, new THREE.MeshLambertMaterial({ color: 0xff6fae })); fl.scale.set(0.1, 0.06, 0.1); fl.position.y = r * 1.8;
      g.add(body, fl);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const sp = new THREE.Mesh(prim().cone, new THREE.MeshLambertMaterial({ color: 0xf2e6c8 }));
        sp.scale.set(0.015, 0.09, 0.015); sp.position.set(Math.cos(a) * r, r * 0.9, Math.sin(a) * r); sp.rotation.set(0, 0, 0); sp.lookAt(Math.cos(a) * 3, r * 0.9, Math.sin(a) * 3); sp.rotateX(Math.PI / 2);
        g.add(sp);
      }
    } else if (kind === 'snow') {
      const w = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const a = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), w); a.position.y = r * 0.9;
      const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.66, 16, 12), w); b.position.y = r * 2.1;
      const nose = new THREE.Mesh(prim().cone, new THREE.MeshLambertMaterial({ color: 0xff7a1a })); nose.scale.set(0.04, 0.16, 0.04); nose.rotation.x = Math.PI / 2; nose.position.set(0, r * 2.15, r * 0.7);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, r * 0.5, 14), new THREE.MeshLambertMaterial({ color: 0x222228 })); hat.position.y = r * 2.85;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.04, 14), hat.material); brim.position.y = r * 2.62;
      g.add(a, b, nose, hat, brim);
      g.userData.face = nose;
    } else if (kind === 'ball') {
      const tex = canvasTex(128, 64, (c, w, hh) => { const cols = ['#ff4f6b', '#ffffff', '#2fa8ff', '#ffffff', '#ffd23f', '#ffffff']; cols.forEach((cc, i) => { c.fillStyle = cc; c.fillRect((i * w) / 6, 0, w / 6 + 1, hh); }); });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshPhongMaterial({ map: tex, shininess: 60 }));
      ball.position.y = r;
      ball.rotation.z = 0.4 + rnd();
      g.add(ball);
      const spin = rnd() * 6;
      anim.push((t) => { if (!calm()) ball.rotation.y = spin + t * 0.4; });
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshLambertMaterial({ color: 0x2a201e, emissive: 0x5a1400, flatShading: true }));
      rock.position.y = r * 0.8;
      const gl = glow(0xff6a1a, r * 4, 0.45); gl.position.y = r;
      g.add(rock, gl);
      const ph2 = rnd() * 6;
      anim.push((t) => { rock.material.emissiveIntensity = 0.8 + 0.4 * Math.sin(t * 2.5 + ph2); });
    }
    return g;
  }
  let _arrow = null;
  /** Chevrons for the speed pads (scrolled along by their texture offset). */
  const arrowTex = () => _arrow || (_arrow = canvasTex(128, 128, (c, w, hh) => {
    c.strokeStyle = '#ffffff'; c.lineWidth = 14; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const y of [20, 64, 108]) { c.beginPath(); c.moveTo(26, y + 22); c.lineTo(64, y - 14); c.lineTo(102, y + 22); c.stroke(); }
  }));

  // ------------------------------------------------------------------ particles
  const Parts = (() => {
    let sys = null;
    const make = (n, additive) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3); const colr = new Float32Array(n * 4); const size = new Float32Array(n);
      for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('acolor', new THREE.BufferAttribute(colr, 4));
      geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
      const mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 400 }, round: { value: additive ? 1 : 0 } },
        vertexShader: 'attribute float size; attribute vec4 acolor; varying vec4 vC; uniform float scale; void main(){ vC = acolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec4 vC; uniform float round; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (round > 0.5) { if (r > 0.5) discard; gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.5, 0.05, r)); } else { if (max(abs(d.x), abs(d.y * 1.8)) > 0.5) discard; gl_FragColor = vC; } }',
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      return { pts, geo, n, list: [], mat };
    };
    const ensure = () => {
      if (sys) return sys;
      sys = { norm: make(700, false), add: make(500, true) };
      return sys;
    };
    return {
      attach(scn) { const s = ensure(); scn.add(s.norm.pts, s.add.pts); },
      scale(hh) { if (!sys) ensure(); const v = hh / (2 * Math.tan((camera ? camera.fov : 50) * Math.PI / 360)); sys.norm.mat.uniforms.scale.value = v; sys.add.mat.uniforms.scale.value = v; },
      burst(o) {
        const s = ensure()[o.glow ? 'add' : 'norm'];
        const cols = o.colors.map((c) => new THREE.Color(c));
        for (let i = 0; i < o.n; i++) {
          if (s.list.length >= s.n) s.list.shift();
          const a = Math.random() * Math.PI * 2; const up = o.up ?? 4; const sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8);
          s.list.push({ x: o.x + (Math.random() - 0.5) * (o.spread || 0.1), y: o.y, z: o.z + (Math.random() - 0.5) * (o.spread || 0.1), vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * sp,
            life: 0, max: (o.life || 1.2) * (0.6 + Math.random() * 0.7), c: cols[(Math.random() * cols.length) | 0], size: (o.size || 0.12) * (0.6 + Math.random() * 0.8), g: o.gravity ?? 9, drag: o.drag ?? 0.6 });
        }
      },
      update(dt) {
        if (!sys) return;
        for (const s of [sys.norm, sys.add]) {
          const pos = s.geo.attributes.position.array; const cc = s.geo.attributes.acolor.array; const sz = s.geo.attributes.size.array;
          s.list = s.list.filter((p) => (p.life += dt) < p.max);
          for (let i = 0; i < s.n; i++) {
            const p = s.list[i];
            if (!p) { pos[i * 3 + 1] = -999; sz[i] = 0; continue; }
            p.vy -= p.g * dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vz *= k; p.vy *= s === sys.norm ? k : 1;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
            pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
            const fade = Math.min(1, (p.max - p.life) * 3);
            cc[i * 4] = p.c.r; cc[i * 4 + 1] = p.c.g; cc[i * 4 + 2] = p.c.b; cc[i * 4 + 3] = fade;
            sz[i] = p.size;
          }
          s.geo.attributes.position.needsUpdate = true; s.geo.attributes.acolor.needsUpdate = true; s.geo.attributes.size.needsUpdate = true;
        }
      },
      clear() { if (sys) { sys.norm.list = []; sys.add.list = []; } },
    };
  })();

  // ------------------------------------------------------------------ balls
  function makeBall(color, ghost) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(P.R, 24, 16), ghost
      ? new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })
      : new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x666666 }));
    m.castShadow = !ghost;
    g.add(m);
    if (!ghost) {
      // a stripe so you can see it roll
      const band = new THREE.Mesh(new THREE.TorusGeometry(P.R * 0.995, P.R * 0.13, 6, 24), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60 }));
      m.add(band);
    }
    g.userData.ball = m;
    return g;
  }
  function nameTag(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(1.6, 0.4, 1);
    sp.position.y = 0.65;
    sp.renderOrder = 10;
    sp.userData.draw = (t) => {
      const x = c.getContext('2d');
      x.clearRect(0, 0, 256, 64);
      x.font = '700 30px Fredoka, sans-serif';
      const w = Math.min(250, x.measureText(t).width + 28);
      x.fillStyle = 'rgba(11,9,32,.72)';
      x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 46, 23); x.fill();
      x.fillStyle = color || '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(t, 128, 32, 240);
      sp.material.map.needsUpdate = true;
    };
    sp.userData.draw(text);
    return sp;
  }

  // ------------------------------------------------------------------ sounds
  const Snd = {
    putt(p) { Sfx.tone(180 + p * 120, 0.06, 'triangle', 0.14); Sfx.noise(0.05, 0.08 + p * 0.06, 0, 2400); },
    tock(v) { Sfx.tone(560 + Math.min(8, v) * 30, 0.045, 'square', Math.min(0.05, 0.012 + v * 0.006)); Sfx.tone(260, 0.06, 'triangle', Math.min(0.06, v * 0.01)); },
    bump(v) { Sfx.tone(300, 0.18, 'sine', 0.1, 500); Sfx.tone(820, 0.06, 'triangle', Math.min(0.05, v * 0.008)); },
    cup() { [0, 0.07, 0.15].forEach((d, i) => Sfx.tone(1250 - i * 180, 0.06, 'triangle', 0.08, 0, d)); Sfx.tone(140, 0.2, 'sine', 0.12, 0, 0.18); },
    splash() { Sfx.noise(0.55, 0.22, 0, 600); Sfx.tone(240, 0.3, 'sine', 0.06, -150); },
    oob() { Sfx.play('wrong'); },
    tele() { Sfx.tone(300, 0.35, 'sine', 0.08, 900); Sfx.noise(0.25, 0.06, 0.05, 2500); },
    land() { Sfx.tone(120, 0.1, 'sine', 0.14); },
    lip() { Sfx.tone(1400, 0.05, 'triangle', 0.06); Sfx.tone(1000, 0.08, 'triangle', 0.05, 0, 0.05); },
    boo() { Sfx.tone(420, 0.6, 'sawtooth', 0.04, -260); Sfx.tone(310, 0.6, 'sine', 0.06, -150, 0.05); },
    boost() { Sfx.tone(260, 0.22, 'sawtooth', 0.04, 700); Sfx.noise(0.18, 0.05, 0, 3000); },
    sizzle() { Sfx.noise(0.7, 0.16, 0, 5000); Sfx.tone(90, 0.4, 'sine', 0.08, -40); },
    fanfare(kind) {
      if (kind === 'ace') { [523, 659, 784, 1047, 1319].forEach((f, i) => Sfx.tone(f, 0.25, 'triangle', 0.09, 0, i * 0.09)); Sfx.tone(1568, 0.6, 'triangle', 0.08, 0, 0.5); } else if (kind === 'eagle' || kind === 'birdie') Sfx.play('win');
      else if (kind === '') Sfx.play('right');
      else Sfx.play('lose');
    },
  };

  // ------------------------------------------------------------------ the game state
  const S = { phase: 'lobby', settings: { course: 'classic', holes: 9 }, round: null, results: null, wins: {} };
  const G = {
    running: false, mode: null, course: null, list: [], k: 0, practice: false, hd: null, vis: null, H: null,
    ball: null, mesh: null, t: 0, goAt: 0, strokes: 0, last: null, scores: [], how: [], state: 'idle', outAt: 0, doneAt: 0,
    sentAt: 0, finishSent: false, spectate: false, others: new Map(), follow: null, hurryEnd: 0, shotT: 0, holedAt: 0, roll: new THREE.Quaternion(),
  };

  // camera: orbits a target; yaw = the direction it looks (same angles as shots)
  const cam = { yaw: 0, pitch: 0.5, dist: 7, zoom: 1, tx: 0, ty: 0, tz: 0, cur: { yaw: 0, pitch: 0.5, dist: 7, tx: 0, ty: 0, tz: 0 }, mode: 'follow', user: false, snap: true };
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

  function loadHole(hd, theme) {
    const vis = holeScene(hd, theme);
    for (const c of [...scene.children]) if (c.userData.hole) scene.remove(c);
    vis.grp.userData.hole = true;
    scene.add(vis.grp);
    Parts.attach(scene);
    Parts.clear();
    const th = THEMES[theme];
    scene.background = th._sky || (th._sky = skyTexture(th));
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    hemi.color.setHex(th.hemi[0]); hemi.groundColor.setHex(th.hemi[1]); hemi.intensity = th.hemi[2];
    sun.color.setHex(th.sun[0]); sun.intensity = th.sun[1];
    const [cx, , cz] = vis.center; const R = vis.size * 0.75 + 4;
    const d = new THREE.Vector3(...th.sunDir).normalize();
    sun.position.set(cx + d.x * 40, d.y * 40, cz + d.z * 40);
    sun.target.position.set(cx, 0, cz);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 100;
    sc.updateProjectionMatrix();
    return vis;
  }

  function startHole(hd, theme, opts = {}) {
    if (!setup3d()) return false;
    clearBall();
    clearInterval(G.cardTimer);
    fill($('#center')); fill($('#banner'));
    G.cdShown = 0;
    G.hd = hd; G.vis = loadHole(hd, theme); G.H = G.vis.H; G.theme = theme; G.th = THEMES[theme];
    G.ball = opts.resume ? { ...C.newBall(G.H, [opts.resume.pos[0], opts.resume.pos[2]]) } : C.newBall(G.H);
    G.ball.ev = [];
    G.strokes = opts.resume ? opts.resume.s || 0 : 0;
    G.last = [G.ball.x, G.ball.z]; G.restSpot = null; G.outFree = false;
    G.t = 0; G.goAt = opts.goAt || performance.now();
    G.state = opts.spectate ? 'spectate' : 'intro';
    G.spectate = !!opts.spectate;
    G.finishSent = false; G.holedAt = 0; G.outAt = 0; G.doneAt = 0;
    G.mesh = makeBall(new THREE.Color(Profile.get().color || '#ff4fd8'));
    G.mesh.visible = !G.spectate;
    G.ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32), new THREE.MeshBasicMaterial({ color: Profile.get().color || '#ff4fd8', transparent: true, opacity: 0.8, depthWrite: false }));
    G.ring.rotation.x = -Math.PI / 2;
    scene.add(G.mesh, G.ring, aim.group);
    G.running = true;
    // the camera starts high over the hole and swoops down behind the ball
    const H = G.H;
    cam.mode = 'overview'; cam.user = false; cam.zoom = 1; cam.snap = true;
    cam.yaw = Math.atan2(H.cup[1] - H.tee[1], H.cup[0] - H.tee[0]);
    updateCamGoal(0);
    cam.cur = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, tx: cam.tx, ty: cam.ty, tz: cam.tz };
    showScreen('play');
    renderHud(true);
    showIntro();
    clearTimeout(G.introTimer);
    const introMs = opts.introMs ?? 2300;
    G.introTimer = setTimeout(() => {
      if (G.state === 'intro') { G.state = 'play'; cam.mode = 'follow'; cam.user = false; fill($('#intro')); hint(true); }
    }, introMs);
    return true;
  }
  function clearBall() {
    if (!scene) return;
    for (const m of [G.mesh, G.ring, ...[...G.others.values()].map((o) => o.mesh)]) if (m) scene.remove(m);
    G.others.clear();
    aimOff();
  }
  function stopPlay() {
    G.running = false;
    clearTimeout(G.introTimer); clearTimeout(G.nextTimer);
    clearBall();
    fill($('#center')); fill($('#banner')); fill($('#intro'));
  }

  // ------------------------------------------------------------------ the main loop
  let last = performance.now();
  function frame(t) { requestAnimationFrame(frame); tick(t); }
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!G.running || !renderer) return;
    // run the physics at a fixed rate, in step with the hole clock
    const target = Math.max(0, (now - G.goAt) / 1000);
    if (target - G.t > 2) G.t = target - 2;
    let n = 0;
    while (G.t + DT <= target && n < 400) {
      if (G.ball && (G.state === 'play' || G.state === 'moving' || G.state === 'intro')) {
        C.step(G.H, G.ball, G.t, DT);
        if (G.state === 'moving' && G.t - G.shotT > P.MAX_SHOT_T && (G.ball.state === 'roll' || G.ball.state === 'air')) { G.ball.state = 'rest'; G.ball.vx = G.ball.vz = G.ball.vy = 0; }
      }
      G.t += DT; n++;
    }
    handleBall(now);
    // animate the hole
    for (const fn of G.vis.anim) fn(now / 1000, dt);
    // online: the countdown before the hole starts
    if (G.mode === 'online' && !G.spectate) {
      if (now < G.goAt) {
        const cd = Math.ceil((G.goAt - now) / 1000);
        if (cd !== G.cdShown && cd <= 5) { G.cdShown = cd; fill($('#center'), h('div', { class: 'count' }, cd)); Sfx.play('tick'); }
      } else if (G.cdShown) {
        G.cdShown = 0;
        fill($('#center'), h('div', { class: 'count' }, 'GO!'));
        Sfx.play('go');
        setTimeout(() => { if ($('#center .count')) fill($('#center')); }, 700);
      }
    }
    for (const o of G.vis.movers) o.update(G.t);
    for (const b of G.vis.bumpers) {
      if (!b) continue;
      const k = G.t - b.hit;
      const s = k < 0.4 ? 1 + Math.sin(k * 30) * 0.18 * (1 - k / 0.4) : 1;
      b.g.scale.set(2 - s, s, 2 - s);
    }
    drawBall(dt);
    drawOthers(now);
    updateCamera(dt);
    if (G.vis.moon) {
      // the moon hangs in the sky up and to the right of wherever you look (like the sky itself)
      const m = G.vis.moon;
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      const tv = Math.tan(camera.fov * Math.PI / 360); const th = tv * camera.aspect;
      const u = viewW > viewH ? 0.62 : 0.74; const r = viewW > viewH ? 0.62 : 0.45;
      const dx = -e[8] + e[4] * tv * u + e[0] * th * r; const dy = -e[9] + e[5] * tv * u + e[1] * th * r; const dz = -e[10] + e[6] * tv * u + e[2] * th * r;
      const l = Math.hypot(dx, dy, dz);
      const D = 38;
      m.position.set(camera.position.x + (dx / l) * D, camera.position.y + (dy / l) * D, camera.position.z + (dz / l) * D);
      m.scale.setScalar(viewW > viewH ? 0.3 : 0.25);
      m.visible = cam.cur.pitch < 0.95;
    }
    {
      const f = G.vis.flag;
      const d = Math.hypot(camera.position.x - f.position.x, camera.position.z - f.position.z);
      const want = cam.mode === 'overview' ? 1 : Math.max(0.25, Math.min(1, (d - 3) / 4));
      f.userData.op = (f.userData.op ?? 1) + (want - (f.userData.op ?? 1)) * Math.min(1, dt * 6);
      for (const m of f.userData.mats) m.opacity = f.userData.op;
    }
    aimDraw(now);
    Parts.update(dt);
    if (G.mode === 'online') {
      const b = G.ball;
      const moving = b && (b.state === 'roll' || b.state === 'air');
      if (!G.spectate && !G.finishSent && b && now - G.sentAt > (moving ? 100 : 900) && target > 0) {
        G.sentAt = now;
        Net.send('g:pos', { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), s: G.strokes, moving });
      }
      renderBoard();
      renderHurry(now);
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function handleBall(now) {
    const b = G.ball;
    if (!b) return;
    // what happened during the physics steps
    for (const e of b.ev) {
      if (e[0] === 'wall') { Snd.tock(e[1]); if (e[1] > 3) Parts.burst({ x: b.x, y: b.y + 0.15, z: b.z, n: 4, colors: [0xffffff], size: 0.05, speed: 1, up: 1.5, life: 0.4, glow: true }); }
      else if (e[0] === 'bump') { Snd.bump(e[1]); const o = G.vis.bumpers[e[2]]; if (o) o.hit = G.t; Parts.burst({ x: b.x, y: b.y + 0.2, z: b.z, n: 10, colors: G.th.fx.bump, size: 0.07, speed: 2.5, up: 2, life: 0.5, glow: true }); }
      else if (e[0] === 'hitm') Snd.tock(e[1] + 2);
      else if (e[0] === 'land') { Snd.land(); Parts.burst({ x: b.x, y: b.y + 0.05, z: b.z, n: 10, colors: [G.th.fx.land], size: 0.06, speed: 1.6, up: 1.2, life: 0.5, gravity: 4 }); }
      else if (e[0] === 'boost') { Snd.boost(); Parts.burst({ x: b.x, y: b.y + 0.1, z: b.z, n: 14, colors: G.th.lava ? [0xff7a2a, 0xffd34d] : [0x22d3ee, 0xffffff], size: 0.07, speed: 2, up: 1.5, life: 0.5, glow: true }); }
      else if (e[0] === 'lip') Snd.lip();
      else if (e[0] === 'tele') {
        Snd.tele(); cam.snap = true;
        if (e[1].boo) { Snd.boo(); banner('BOO! 👻', '#c084fc', 'The trick door!'); }
        Parts.burst({ x: e[1].tx, y: b.y + 0.2, z: e[1].tz, n: 26, colors: G.th.fx.tele, size: 0.08, speed: 2, up: 2.5, life: 0.8, glow: true });
      }
      else if (e[0] === 'holed') holed();
      else if (e[0] === 'out') outOfPlay(e[1]);
    }
    b.ev.length = 0;
    if (b.state === 'rest' && (G.state === 'moving' || G.state === 'play')) G.restSpot = [b.x, b.z];
    if (G.state === 'moving' && b.state === 'rest') {
      // the ball stopped
      G.state = 'play';
      cam.user = false;
      if (G.strokes >= P.MAX_STROKES) pickUp();
      else hint(false);
    }
    if (G.state === 'out' && now - G.outAt > 1100) {
      // a ball knocked in by an obstacle while it sat waiting for you costs nothing: it goes back to where
      // it was resting (or, if that spot is in the obstacle's way, to where you last played from)
      const free = G.outFree;
      const spot = free && !inMoverPath(G.restSpot) ? G.restSpot : G.last;
      // don't put the ball back inside an obstacle that is passing over the spot right now: wait for it to clear
      if (inMoverPath(spot, G.t, 0.35) && now - G.outAt < 5000) return;
      if (!free) G.strokes += 1;
      Object.assign(b, C.newBall(G.H, spot), { ev: [] });
      cam.snap = true;
      if (G.strokes >= P.MAX_STROKES) pickUp(); else G.state = 'play';
      renderHud();
    }
  }

  function shoot(angle, power) {
    if (G.state !== 'play' || G.ball.state !== 'rest' || G.spectate || G.finishSent) return;
    G.last = [G.ball.x, G.ball.z];
    G.restSpot = null;
    C.hit(G.ball, angle, power);
    G.strokes += 1;
    G.shotT = G.t;
    G.state = 'moving';
    Snd.putt(power);
    hint(false, true);
    G.firstShot = true;
    renderHud();
    if (G.mode === 'online') Net.send('g:pos', { x: +G.ball.x.toFixed(2), y: +G.ball.y.toFixed(2), z: +G.ball.z.toFixed(2), s: G.strokes, moving: true });
  }
  // could a moving obstacle reach a ball resting here?
  // (with from/span: only during that stretch of the hole clock)
  function inMoverPath(spot, from, span) {
    if (!spot) return true;
    for (const m of G.H.movers) {
      for (let i = 0; i < 48; i++) {
        const A = C.moverPose(m, span ? from + span * i / 47 : (m.period || 1) * i / 48);
        if (span && A.on === false) continue;
        const ca = Math.cos(A.a); const sa = Math.sin(A.a);
        const rx = spot[0] - A.x; const rz = spot[1] - A.z;
        if (Math.abs(rx * ca + rz * sa) < A.hw + P.R + 0.1 && Math.abs(-rx * sa + rz * ca) < A.hd + P.R + 0.1) return true;
      }
    }
    return false;
  }
  function outOfPlay(why) {
    G.outFree = G.state === 'play';
    G.state = 'out';
    G.outAt = performance.now();
    const b = G.ball;
    const th = G.th;
    if (why === 'gap' && th.pit !== 'creek') {
      // down a crypt, a crevasse, the canyon or into the lava
      if (th.id === 'spooky') Snd.boo(); else if (th.lava) Snd.sizzle(); else Snd.oob();
      Parts.burst({ x: b.x, y: -1, z: b.z, n: 30, colors: [th.pitMist, th.pitGlow], size: 0.1, speed: 1.2, up: 3, life: 1, gravity: 2, glow: true });
      banner(th.gapText, '#' + col(th.pitMist).getHexString(), '+1 stroke · back to where you were');
    } else if (why === 'water' || why === 'gap') {
      if (th.lava && why === 'water') Snd.sizzle(); else Snd.splash();
      Parts.burst({ x: b.x, y: why === 'gap' ? -1.1 : P.WATER_Y + 0.05, z: b.z, n: 40, colors: th.fx.splash, size: 0.09, speed: 1.6, up: 4.5, life: 1, gravity: th.lava ? 4 : 10, glow: th.lava });
      banner(th.splashText, th.lava ? '#ff8a3a' : '#7dd3fc', '+1 stroke · back to where you were');
    } else {
      Snd.oob();
      banner('OUT OF BOUNDS', '#fb7185', '+1 stroke · back to where you were');
    }
  }
  function holed() {
    G.state = 'holed';
    G.holedAt = performance.now();
    const n = G.strokes;
    const [label, color, kind] = SCORE(n, G.hd.par);
    Snd.cup();
    setTimeout(() => Snd.fanfare(kind), 260);
    const [cx, cz] = G.H.cup;
    Parts.burst({ x: cx, y: G.vis.cupY + 0.1, z: cz, n: kind === 'ace' ? 80 : 36, colors: [0xfff3a0, 0xffd23f, 0xffffff], size: 0.09, speed: 2.2, up: 4, life: 1.1, glow: true });
    if (kind === 'ace' || kind === 'eagle') {
      Parts.burst({ x: cx, y: G.vis.cupY + 0.3, z: cz, n: 260, colors: [0xff4fd8, 0x22d3ee, 0xa3e635, 0xfacc15, 0x8b5cf6, 0xfb923c], size: 0.13, speed: 3.4, up: 7, life: 2.6, gravity: 5, drag: 1.2, spread: 0.4 });
      if (!calm()) UI.confetti(kind === 'ace' ? 220 : 120);
    }
    banner(label, color, `${n} stroke${n === 1 ? '' : 's'} · par ${G.hd.par}`);
    finishHole(n, kind === 'ace' ? 'ace' : 'holed');
  }
  function pickUp() {
    G.state = 'holed';
    G.holedAt = performance.now();
    Snd.fanfare('dbl');
    banner('PICKED UP', '#fb7185', `That’s ${P.MAX_STROKES} — on to the next one`);
    finishHole(P.MAX_STROKES, 'picked');
  }
  function finishHole(n, how) {
    if (G.mode !== 'online') { G.scores[G.k] = n; G.how[G.k] = how; }
    renderHud();
    // after the celebration, rise up over the hole
    setTimeout(() => { if (G.running && (G.state === 'holed' || G.state === 'card') && cam.mode === 'follow') { cam.mode = 'overview'; cam.user = false; } }, 1900);
    if (G.mode === 'online') {
      if (!G.finishSent) {
        G.finishSent = true;
        Net.send('g:holed', { hole: S.round ? S.round.hole : 0, strokes: n, picked: how === 'picked' });
      }
      setTimeout(() => { if (G.running && G.state === 'holed' && S.round && S.round.stage === 'play') waitingCard(); }, 2200);
      return;
    }
    G.nextTimer = setTimeout(() => soloAfterHole(), 2300);
  }

  // ------------------------------------------------------------------ drawing the balls
  const _q = new THREE.Quaternion(); const _ax = new THREE.Vector3();
  function drawBall(dt) {
    const b = G.ball; const m = G.mesh;
    if (!b || !m) return;
    let y = b.y + P.R;
    if (G.state === 'holed' && b.state === 'holed') {
      const k = Math.min(1, (performance.now() - G.holedAt) / 350);
      y = G.vis.cupY + P.R - k * 0.42;
    }
    if (b.state === 'out' && b.why === 'water') y = Math.max(P.WATER_Y - 0.5, b.y + P.R - (performance.now() - G.outAt) / 1000);
    if (b.state === 'out' && b.why === 'gap') y = -1.4;
    // rolling
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.01 && b.state !== 'air') {
      _ax.set(b.vz, 0, -b.vx).normalize();
      _q.setFromAxisAngle(_ax, (sp * dt) / P.R);
      m.userData.ball.quaternion.premultiply(_q);
    }
    m.position.set(b.x, y, b.z);
    m.visible = !G.spectate && !(b.state === 'out' && b.why === 'oob' && performance.now() - G.outAt > 300);
    // a ring under your ball when it's your shot
    const ready = G.state === 'play' && b.state === 'rest' && !G.spectate;
    G.ring.visible = ready;
    if (ready) {
      const s = 1 + Math.sin(performance.now() / 260) * 0.08;
      G.ring.scale.set(s, s, s);
      G.ring.position.set(b.x, b.y + 0.015, b.z);
    }
    // a little trail when it's going fast
    if (sp > 4.5 && !calm() && Math.random() < 0.6) Parts.burst({ x: b.x, y: y - 0.1, z: b.z, n: 1, colors: [0xffffff], size: 0.06, speed: 0.05, up: 0.1, life: 0.35, gravity: 0, glow: true });
  }
  function addOther(id) {
    if (G.others.has(id) || !scene) return G.others.get(id);
    const p = (window.Room && Room.player(id)) || { name: '?', color: '#888888' };
    const mesh = makeBall(new THREE.Color(p.color || '#888888'), true);
    const tag = nameTag(p.name, p.color);
    mesh.add(tag);
    scene.add(mesh);
    const o = { mesh, tag, s: [], strokes: -1, name: p.name };
    G.others.set(id, o);
    return o;
  }
  function drawOthers(now) {
    for (const [id, o] of G.others) {
      const p = sampleOther(o, now - 110);
      const r = S.round && S.round.players[id];
      const done = r && r.scores[S.round.hole] != null;
      o.mesh.visible = !!p && !done;
      if (p) o.mesh.position.set(p[1], p[2] + P.R, p[3]);
      const s = r ? r.s : 0;
      if (s !== o.strokes) { o.strokes = s; o.tag.userData.draw(`${o.name} · ${s}`); }
    }
  }
  function sampleOther(o, t) {
    const s = o.s;
    if (!s.length) return null;
    if (t <= s[0][0]) return s[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i][0] <= t) {
        const a = s[i]; const b = s[i + 1];
        if (!b) return a;
        const k = (t - a[0]) / Math.max(1, b[0] - a[0]);
        return [t, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
      }
    }
    return s[0];
  }

  // ------------------------------------------------------------------ camera
  function updateCamGoal() {
    const H = G.H;
    if (!H) return;
    const portrait = viewH > viewW;
    if (cam.mode === 'overview') {
      cam.tx = H.W / 2; cam.ty = 0; cam.tz = H.D / 2;
      if (!cam.user) { cam.yaw = Math.round(Math.atan2(H.cup[1] - H.tee[1], H.cup[0] - H.tee[0]) / (Math.PI / 2)) * (Math.PI / 2); cam.pitch = 1.08; }
      // fit the hole: its size along and across the view
      const fx = Math.cos(cam.yaw); const fz = Math.sin(cam.yaw);
      const along = Math.abs(H.W * fx) + Math.abs(H.D * fz); const across = Math.abs(H.W * fz) + Math.abs(H.D * fx);
      const vf = camera.fov * Math.PI / 180; const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
      const dAlong = (along * 0.62) / Math.tan(vf / 2) * Math.sin(cam.pitch) + 2;
      const dAcross = (across * 0.6) / Math.tan(hf / 2);
      cam.dist = Math.max(8, Math.max(dAlong, dAcross) * (portrait ? 0.95 : 0.9)) * cam.zoom;
      return;
    }
    let tx; let ty; let tz;
    if (cam.mode === 'spectate' && G.follow) {
      const o = G.others.get(G.follow);
      if (o && o.mesh.visible) { tx = o.mesh.position.x; ty = o.mesh.position.y - P.R; tz = o.mesh.position.z; }
    }
    if (tx === undefined) {
      const b = G.ball;
      if (G.spectate || !b) { cam.mode = 'overview'; return updateCamGoal(); }
      tx = b.x; ty = Math.max(b.y, -0.2); tz = b.z;
      if (G.state === 'holed') { tx = H.cup[0]; tz = H.cup[1]; ty = G.vis.cupY; }
    }
    cam.tx = tx; cam.ty = ty; cam.tz = tz;
    const ball = G.ball;
    if (aim.on && !aim.kb) {
      // hold the view still while you drag to aim, so the arrow doesn't drift under your finger
      cam.yaw = cam.cur.yaw; cam.pitch = cam.cur.pitch; cam.dist = cam.cur.dist / cam.zoom;
    } else if (!cam.user && ball && (ball.state === 'rest' || G.state === 'intro')) {
      cam.yaw = C.pathDir(H, tx, tz);
      const toCup = Math.hypot(H.cup[0] - tx, H.cup[1] - tz);
      cam.pitch = portrait ? 0.66 : 0.52;
      cam.dist = (portrait ? 1.12 : 1) * Math.max(4.6, Math.min(8.5, 3.6 + toCup * 0.35));
    }
  }
  const _look = new THREE.Vector3();
  function updateCamera(dt) {
    updateCamGoal();
    const c = cam.cur;
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * (cam.mode === 'overview' ? 3 : 5));
    const kt = cam.snap ? 1 : aim.on && !aim.kb ? 0 : 1 - Math.exp(-dt * 7);
    cam.snap = false;
    c.yaw += angDiff(cam.yaw, c.yaw) * k;
    c.pitch += (cam.pitch - c.pitch) * k;
    c.dist += (cam.dist * (cam.mode === 'overview' ? 1 : cam.zoom) - c.dist) * k;
    c.tx += (cam.tx - c.tx) * kt; c.ty += (cam.ty - c.ty) * kt; c.tz += (cam.tz - c.tz) * kt;
    const fx = Math.cos(c.yaw); const fz = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch); const sp = Math.sin(c.pitch);
    let px = c.tx - fx * cp * c.dist; let py = c.ty + 0.25 + sp * c.dist; let pz = c.tz - fz * cp * c.dist;
    // don't go under the turf or the ground
    if (G.H) {
      const f = C.floorAt(G.H, px, pz);
      const floorY = C.solid(f) ? C.surface(G.H, px, pz, {}).h + P.WALL_H + 0.35 : 0.5;
      if (py < floorY) py = floorY;
      // …nor inside a brick wall, tombstone or the haunted house: go up over it instead
      for (const bl of G.H.blocks) {
        const e = Math.max(bl.x0 - px, px - bl.x1, bl.z0 - pz, pz - bl.z1);   // how far outside it the camera is
        if (bl.hidden || e > 0.9) continue;
        const top = C.surface(G.H, (bl.x0 + bl.x1) / 2, (bl.z0 + bl.z1) / 2, {}).h + ({ brick: 0.8, tomb: 1.25, house: 3.6 }[bl.style] || 0.8) + 0.3;
        const w = e <= 0.3 ? 1 : 1 - (e - 0.3) / 0.6;   // rise smoothly on the way in
        if (py < top) py += (top - py) * w * w * (3 - 2 * w);
      }
    }
    camera.position.set(px, py, pz);
    const ahead = cam.mode === 'overview' ? 0 : (viewH > viewW ? 4.2 : 1.8) * Math.min(1.3, c.dist / 6);
    _look.set(c.tx + fx * ahead, c.ty + 0.3, c.tz + fz * ahead);
    camera.lookAt(_look);
  }

  // ------------------------------------------------------------------ aiming
  const aim = { group: null, on: false, angle: 0, power: 0, kb: false, arrow: null, ring: null, dots: [] };
  function aimSetup() {
    if (aim.group) return;
    aim.group = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(0, -0.1); s.lineTo(0.72, -0.1); s.lineTo(0.72, -0.24); s.lineTo(1, 0); s.lineTo(0.72, 0.24); s.lineTo(0.72, 0.1); s.lineTo(0, 0.1); s.closePath();
    const ag = new THREE.ShapeGeometry(s);
    ag.rotateX(Math.PI / 2);
    aim.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.92, depthTest: false, side: THREE.DoubleSide }));
    aim.arrow.renderOrder = 20;
    aim.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    aim.ring.rotation.x = -Math.PI / 2;
    aim.ring.renderOrder = 19;
    const back = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthTest: false, side: THREE.DoubleSide }));
    back.rotation.x = -Math.PI / 2;
    back.renderOrder = 18;
    aim.back = back;
    const dm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    for (let i = 0; i < 14; i++) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), dm.clone());
      d.rotation.x = -Math.PI / 2;
      d.renderOrder = 19;
      aim.dots.push(d);
      aim.group.add(d);
    }
    aim.group.add(aim.arrow, aim.ring, back);
    aim.group.visible = false;
  }
  function aimOff() { aim.on = false; aim.kb = false; if (aim.group) aim.group.visible = false; $('#power').classList.remove('on'); if (renderer) renderer.domElement.classList.remove('aim'); }
  const powerColor = (p) => new THREE.Color().setHSL(0.33 - 0.33 * Math.min(1, p * 1.1), 0.85, 0.55);
  let lastRingP = -1;
  function aimDraw(now) {
    if (!aim.group) return;
    const show = aim.on && G.state === 'play' && G.ball.state === 'rest';
    aim.group.visible = show;
    if (!show) return;
    const b = G.ball;
    const y = b.y + 0.03;
    const c = powerColor(aim.power);
    const len = 0.5 + aim.power * 2.8;
    aim.arrow.position.set(b.x + Math.cos(aim.angle) * 0.32, y, b.z + Math.sin(aim.angle) * 0.32);
    aim.arrow.rotation.y = -aim.angle;
    aim.arrow.scale.set(len, 1, 1 + aim.power * 0.4);
    aim.arrow.material.color.copy(c);
    if (Math.abs(lastRingP - aim.power) > 0.004) {
      lastRingP = aim.power;
      aim.ring.geometry.dispose();
      aim.ring.geometry = new THREE.RingGeometry(0.42, 0.52, 48, 1, Math.PI / 2, Math.max(0.01, aim.power * Math.PI * 2));
    }
    aim.ring.material.color.copy(c);
    aim.ring.position.set(b.x, y, b.z); aim.back.position.set(b.x, y - 0.001, b.z);
    // a dotted line showing the way it will go (straight, up to the first rail)
    const reach = 1.4 + aim.power * 6;
    const fx = Math.cos(aim.angle); const fz = Math.sin(aim.angle);
    let stop = reach;
    for (let s = 0.4; s < reach; s += 0.1) { const f = C.floorAt(G.H, b.x + fx * s, b.z + fz * s); if (!C.solid(f) && f !== C.WATER) { stop = s; break; } if (hitsWall(b.x + fx * s, b.z + fz * s)) { stop = s; break; } }
    aim.dots.forEach((d, i) => {
      const s = 0.55 + (i + ((now / 600) % 1)) * 0.42;
      d.visible = s < stop;
      const x = b.x + fx * s; const z = b.z + fz * s;
      d.position.set(x, C.surface(G.H, x, z, {}).h + 0.03, z);
      d.material.opacity = 0.85 * (1 - s / (stop + 0.4));
    });
    const pct = Math.round(aim.power * 100);
    $('#power-pct').textContent = pct + '%';
    $('#power-bar').style.width = pct + '%';
  }
  function hitsWall(x, z) {
    const H = G.H;
    const ix = Math.floor(x); const iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= H.W || iz >= H.D) return true;
    for (const wi of H.near[iz * H.W + ix].w) {
      const s = H.walls[wi];
      const ex = s.bx - s.ax; const ez = s.bz - s.az;
      const u = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (s.len * s.len)));
      if (Math.hypot(x - s.ax - ex * u, z - s.az - ez * u) < P.R * 0.9) return true;
    }
    for (const o of H.bumpers) if (Math.hypot(x - o.x, z - o.z) < o.r + P.R * 0.9) return true;
    return false;
  }

  // ------------------------------------------------------------------ input
  const ray = { r: null, plane: null };
  const ptrs = new Map();
  let drag = null;
  function canAim() { return G.running && G.state === 'play' && G.ball && G.ball.state === 'rest' && !G.spectate && !G.finishSent && performance.now() >= G.goAt; }
  function ballScreen() {
    const v = new THREE.Vector3(G.ball.x, G.ball.y + P.R, G.ball.z).project(camera);
    const v2 = new THREE.Vector3(G.ball.x, G.ball.y + P.R * 2, G.ball.z).project(camera);
    return { x: (v.x + 1) / 2 * viewW, y: (1 - v.y) / 2 * viewH, r: Math.abs(v2.y - v.y) / 2 * viewH, front: v.z < 1 };
  }
  function groundPoint(cx, cy) {
    if (!ray.r) { ray.r = new THREE.Raycaster(); ray.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); }
    ray.r.setFromCamera({ x: (cx / viewW) * 2 - 1, y: -(cy / viewH) * 2 + 1 }, camera);
    ray.plane.constant = -(G.ball.y + P.R);   // the plane through the ball's centre, so pulling straight back from the ball on screen aims straight
    const hit = new THREE.Vector3();
    return ray.r.ray.intersectPlane(ray.plane, hit) ? hit : null;
  }
  function aimFrom(cx, cy) {
    const bs = ballScreen();
    const pix = Math.hypot(cx - bs.x, cy - bs.y);
    const f = Math.max(0, Math.min(1, (pix - 10) / (Math.min(viewW, viewH) * 0.32)));
    aim.power = f * f * 0.3 + f * 0.7;
    const gp = groundPoint(cx, cy);
    if (gp && Math.hypot(gp.x - G.ball.x, gp.z - G.ball.z) > 0.05) aim.angle = Math.atan2(G.ball.z - gp.z, G.ball.x - gp.x);
    else if (pix > 4) {
      // pointing above the horizon: use the screen direction (pull down = shoot forwards)
      const dx = cx - bs.x; const dy = cy - bs.y;
      const fx = Math.cos(cam.cur.yaw); const fz = Math.sin(cam.cur.yaw);
      aim.angle = Math.atan2(-fx * dx + fz * dy, fz * dx + fx * dy);
    }
  }
  function bindInput(el) {
    aimSetup();
    const local = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      ptrs.set(e.pointerId, { x, y });
      if (ptrs.size === 2) {
        // two fingers: orbit and zoom
        if (drag && drag.kind === 'aim') aimOff();
        const [a, b] = [...ptrs.values()];
        drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        return;
      }
      if (ptrs.size > 2) return;
      if (G.state === 'intro') { G.state = 'play'; cam.mode = 'follow'; fill($('#intro')); hint(true); }
      if (canAim() && e.button === 0) {
        const bs = ballScreen();
        const reach = Math.max(e.pointerType === 'touch' ? 70 : 52, bs.r * 3);
        if (bs.front && Math.hypot(x - bs.x, y - bs.y) < reach) {
          drag = { kind: 'aim', x, y };
          aim.on = true; aim.kb = false; aim.power = 0;
          aim.angle = cam.cur.yaw;
          el.classList.add('aim');
          $('#power').classList.add('on'); $('#hint').classList.add('off');
          return;
        }
      }
      drag = { kind: 'orbit', x, y, moved: 0 };
    });
    el.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const [x, y] = local(e);
      ptrs.set(e.pointerId, { x, y });
      if (!drag) return;
      if (drag.kind === 'aim') { aimFrom(x, y); return; }
      if (drag.kind === 'pinch' && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
        cam.zoom = Math.max(0.45, Math.min(2.6, cam.zoom * (drag.d / Math.max(20, d))));
        orbit(mx - drag.mx, my - drag.my);
        drag.d = d; drag.mx = mx; drag.my = my;
        return;
      }
      if (drag.kind === 'orbit') {
        const dx = x - drag.x; const dy = y - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = x; drag.y = y;
        orbit(dx, dy);
      }
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (!drag) return;
      if (drag.kind === 'aim') {
        const p = aim.power; const a = aim.angle;
        aimOff();
        if (p > 0.03 && e.type === 'pointerup') shoot(a, p);
      }
      if (ptrs.size === 0) drag = null;
      else if (drag.kind === 'pinch') { const [q] = [...ptrs.values()]; drag = { kind: 'orbit', x: q.x, y: q.y, moved: 0 }; }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom = Math.max(0.45, Math.min(2.6, cam.zoom * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  }
  function orbit(dx, dy) {
    if (cam.mode === 'follow' || cam.mode === 'overview' || cam.mode === 'spectate') {
      cam.user = true;
      cam.yaw += dx * 0.006;
      cam.pitch = Math.max(0.12, Math.min(1.45, cam.pitch + dy * 0.005));
      cam.cur.yaw = cam.yaw; cam.cur.pitch = cam.pitch;
    }
  }
  const playing = () => !$('#play').classList.contains('hidden') && G.running;
  const typing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  const keys = {};
  addEventListener('keydown', (e) => {
    if (!playing() || typing()) return;
    keys[e.code] = true;
    if (e.code === 'KeyV' && !e.repeat) toggleView();
    if (e.code === 'KeyC' && !e.repeat) { cam.user = false; cam.zoom = 1; cam.mode = G.spectate ? 'spectate' : 'follow'; }
    if (e.code === 'Escape' && aim.on) aimOff();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code)) {
      e.preventDefault();
      if (G.state === 'intro') { G.state = 'play'; cam.mode = 'follow'; fill($('#intro')); }
      if (canAim() && !aim.on) { aim.on = true; aim.kb = true; aim.angle = cam.cur.yaw; aim.power = 0.35; $('#power').classList.add('on'); $('#hint').classList.add('off'); }
    }
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      if (aim.on && aim.kb && canAim()) { const p = aim.power; const a = aim.angle; aimOff(); shoot(a, p); }
      else if (!aim.on && canAim()) { aim.on = true; aim.kb = true; aim.angle = cam.cur.yaw; aim.power = 0.35; $('#power').classList.add('on'); $('#hint').classList.add('off'); }
    }
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  setInterval(() => {
    if (!aim.on || !aim.kb) return;
    const turn = (keys.ArrowLeft || keys.KeyA ? -1 : 0) + (keys.ArrowRight || keys.KeyD ? 1 : 0);
    const pw = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
    if (turn) { aim.angle += turn * 0.025; cam.yaw = aim.angle; cam.user = true; }
    if (pw) aim.power = Math.max(0.02, Math.min(1, aim.power + pw * 0.012));
  }, 16);
  function toggleView() {
    if (!G.running) return;
    cam.user = false; cam.zoom = 1;
    cam.mode = cam.mode === 'overview' ? (G.spectate ? 'spectate' : 'follow') : 'overview';
    $('#btn-view').classList.toggle('on', cam.mode === 'overview');
  }
  $('#btn-view').addEventListener('click', toggleView);
  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });
  $('#btn-quit').addEventListener('click', () => {
    if (G.mode === 'online') { stopPlay(); showScreen('room'); renderRoomMain(); } else { stopPlay(); showMenu(); }
  });

  // ------------------------------------------------------------------ HUD
  function renderHud() {
    if (!G.hd) return;
    const hd = G.hd;
    const course = C.courseById(hd.course);
    const total = G.mode === 'online' ? G.list.length : G.list.length;
    $('#hole-n').replaceChildren(`HOLE ${hd.n}`, h('small', {}, G.practice ? 'practice' : `/ ${total === 9 ? 9 : total}`));
    $('#hole-name').textContent = `${course.emoji} ${hd.name}`;
    const dots = h('span', { class: 'gf-strokes', title: 'Strokes' });
    for (let i = 0; i < Math.max(hd.par, G.strokes); i++) dots.append(h('i', { class: i < G.strokes ? (i >= hd.par ? 'on over' : 'on') : '' }));
    fill($('#hole-par'), h('span', { class: 'gf-chip hot' }, `PAR ${hd.par}`), h('span', { class: 'gf-chip' + (G.strokes >= P.MAX_STROKES - 1 ? ' warn' : '') }, G.spectate ? '👀 Watching' : ['🏌️ ', G.strokes, ' ', dots]));
    // running total
    let tot = 0; let parSum = 0;
    if (G.mode === 'online' && S.round) {
      const me = S.round.players[Net.id];
      if (me) me.scores.forEach((s, i) => { if (s != null) { tot += s; parSum += S.round.pars[i]; } });
    } else {
      G.scores.forEach((s, i) => { if (s != null) { tot += s; parSum += C.courseById(G.course).holes[G.list[i]].par; } });
    }
    const played = parSum > 0;
    fill($('#total'), played ? [h('div', { class: 'big' }, vsPar(tot - parSum)), h('div', { class: 'sub' }, `Total ${tot}`)] : null);
  }
  let hintTimer = null;
  function hint(show, hide) {
    const el = $('#hint');
    clearTimeout(hintTimer);
    if (hide || G.spectate) { el.classList.add('off'); return; }
    const touch = matchMedia('(pointer: coarse)').matches;
    const first = !G.firstShot;
    if (!first && !show) { el.classList.add('off'); return; }
    el.textContent = touch ? '👆 Pull back from the ball, let go to putt' : '🖱️ Drag back from the ball and let go to shoot · drag elsewhere to look around';
    el.classList.toggle('off', !first);
    if (first) hintTimer = setTimeout(() => el.classList.add('off'), 9000);
  }
  function showIntro() {
    const hd = G.hd;
    const el = $('#intro');
    fill(el, h('div', {}, h('div', { class: 'k' }, `${C.courseById(hd.course).name.toUpperCase()} · HOLE ${hd.n}`), h('div', { class: 't' }, hd.name), h('div', { class: 'p' }, `PAR ${hd.par}`), h('div', { class: 'tip' }, hd.tip || '')));
    if (FX.on && !calm()) FX.gsap.fromTo(el.firstChild, { y: 30, autoAlpha: 0, scale: 0.9 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(1.8)' });
  }
  let bannerTimer = null;
  function banner(text, color, sub) {
    const el = $('#banner');
    clearTimeout(bannerTimer);
    fill(el, h('div', { style: { '--bc': color } }, h('div', { class: 't' }, text), sub ? h('div', { class: 's' }, sub) : null));
    if (FX.on && !calm()) FX.gsap.fromTo(el.firstChild, { scale: 0.3, rotation: -6, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.7, ease: 'elastic.out(1, 0.55)' });
    bannerTimer = setTimeout(() => {
      if (FX.on && !calm() && el.firstChild) FX.gsap.to(el.firstChild, { y: -30, autoAlpha: 0, duration: 0.35, onComplete: () => fill(el) });
      else fill(el);
    }, 1900);
  }
  function scoreTable(pars, rows, cur) {
    const n = pars.length;
    const tp = pars.reduce((a, b) => a + b, 0);
    return h('div', { class: 'card-scroll' }, h('table', { class: 'sc' },
      h('tr', {}, h('th', {}, ''), pars.map((_, i) => h('th', {}, i + 1)), h('th', {}, 'Tot')),
      h('tr', { class: 'par' }, h('td', { class: 'nm' }, 'Par'), pars.map((p) => h('td', {}, p)), h('td', {}, tp)),
      rows.map((r) => {
        let tot = 0; let parSum = 0;
        return h('tr', {}, h('td', { class: 'nm', style: { color: r.color || 'inherit' } }, r.name),
          Array.from({ length: n }, (_, i) => {
            const s = r.scores[i];
            if (s == null) return h('td', { class: 's' + (i === cur ? ' cur' : '') }, '');
            tot += s; parSum += pars[i];
            const kind = r.how && r.how[i] === 'picked' ? 'dbl' : SCORE(s, pars[i])[2];
            return h('td', { class: `s ${kind}${i === cur ? ' cur' : ''}`, title: r.how && r.how[i] === 'dnf' ? 'Ran out of time' : '' }, s);
          }),
          h('td', { class: 'tot' }, parSum ? `${tot}` : '–'));
      })));
  }

  // ------------------------------------------------------------------ solo
  const FLAGS = { classic: '⛳', spooky: '🦇', desert: '🦂', frost: '⛄', beach: '🦀', volcano: '🔥' };
  const isGen = (id) => /^gen-\d+$/.test(id || '');
  /** A course code typed in by hand, or null. */
  const readSeed = (v) => { const n = Math.floor(Number(String(v).replace(/[^0-9]/g, ''))); return n >= 1 && n <= 2147483646 ? n : null; };
  function showMenu() {
    showScreen('menu');
    const code = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'Course code', maxlength: 10, 'aria-label': 'Course code' });
    const playCode = () => { const n = readSeed(code.value); if (n) startSolo(`gen-${n}`); else { UI.toast('That isn’t a course code — it’s a number like 123456789', 'bad', 3000); code.focus(); } };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') playCode(); });
    const genCard = h('div', { class: 'course-card', role: 'group' },
      h('div', { class: 'art gen' }, h('span', {}, '🎲'), h('span', { class: 'flag' }, '✨')),
      h('div', { class: 'body' },
        h('b', {}, 'Random Course'),
        h('div', { class: 'muted small' }, 'Nine brand-new holes made up on the spot, in any of the six looks. Every course has a code, so friends can play the same one.'),
        h('div', { class: 'meta' }, h('span', {}, '9 holes'), h('span', {}, 'New every time'), h('span', {}, '6 looks')),
        h('button', { class: 'btn btn-pink btn-block play', onclick: () => startSolo(`gen-${C.newSeed()}`) }, '🎲 Make me a course'),
        h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'Got a course code?'),
        h('div', { class: 'seed-row' }, code, h('button', { class: 'btn btn-cyan btn-sm', onclick: playCode }, 'Play'))));
    const card = (c) => {
      const best = store.get(bestKey(c.id), null);
      const par = C.par(c.id);
      return h('div', { class: 'course-card', role: 'group' },
        h('div', { class: 'art ' + c.id }, h('span', {}, c.emoji), h('span', { class: 'flag' }, FLAGS[c.id] || '⛳')),
        h('div', { class: 'body' },
          h('b', {}, c.name),
          h('div', { class: 'muted small' }, c.blurb),
          h('div', { class: 'meta' }, h('span', {}, '9 holes'), h('span', {}, `Par ${par}`), h('span', {}, best ? `⭐ Best ${best} (${vsPar(best - par)})` : 'Not played yet')),
          h('button', { class: 'btn btn-pink btn-block play', onclick: () => startSolo(c.id) }, `⛳ Play ${c.name}`),
          h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'Practice a hole:'),
          h('div', { class: 'practice' }, c.holes.map((hd, i) => h('button', { title: `${hd.name} · par ${hd.par}`, onclick: () => startSolo(c.id, i) }, i + 1)))));
    };
    fill($('#menu'),
      h('div', { class: 'menu-head' }, h('div', { class: 'game-icon' }, '⛳'), h('h1', { class: 'display' }, 'Mini Golf'),
        h('p', { class: 'muted' }, 'Pick a course and play all 9 holes — or make up a random one. Fewest strokes wins, and your best round goes on the leaderboard!')),
      h('div', { class: 'courses' }, genCard, C.COURSES.map(card)),
      h('div', { class: 'center', style: { marginTop: '16px', gap: '8px', flexWrap: 'wrap' } },
        h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); } }, '👥 Play with friends online')));
    if (FX.list) FX.list($('#menu .courses').children, { y: 24, stagger: 0.08, duration: 0.5, ease: 'back.out(1.5)' });
  }
  function startSolo(courseId, only = null) {
    scrollTo({ top: 0 });
    const c = C.courseById(courseId);
    Object.assign(G, { mode: 'solo', course: c.id, list: only == null ? c.holes.map((_, i) => i) : [only], practice: only != null, k: 0, scores: [], how: [] });
    const url = new URL(location.href); url.searchParams.set('solo', '1'); url.searchParams.set('course', c.id);
    if (only != null) url.searchParams.set('hole', only + 1); else url.searchParams.delete('hole');
    history.replaceState(null, '', url);
    playSoloHole();
  }
  function playSoloHole() {
    const c = C.courseById(G.course);
    $('#play-chat').classList.add('hidden');
    $('#board').replaceChildren();
    startHole(c.holes[G.list[G.k]], c.theme);
  }
  function soloAfterHole() {
    if (!G.running || G.mode !== 'solo') return;
    const c = C.courseById(G.course);
    const pars = G.list.map((i) => c.holes[i].par);
    const lastHole = G.k + 1 >= G.list.length;
    const n = G.scores[G.k];
    if (G.practice) {
      const [label] = SCORE(n, G.hd.par);
      showCard(h('div', { class: 'gf-card' }, h('h2', {}, label), h('div', { class: 'sub' }, `${G.hd.name} · ${n} stroke${n === 1 ? '' : 's'} (par ${G.hd.par})`),
        h('div', { class: 'btns' }, h('button', { class: 'btn btn-pink', onclick: () => startSolo(G.course, G.list[0]) }, '🔁 Again'),
          G.list[0] + 1 < c.holes.length ? h('button', { class: 'btn btn-cyan', onclick: () => startSolo(G.course, G.list[0] + 1) }, 'Next hole ▶') : null,
          h('button', { class: 'btn btn-ghost', onclick: () => { stopPlay(); showMenu(); } }, '⛳ Courses'))));
      return;
    }
    const me = { name: Profile.get().name, color: Profile.get().color, scores: G.scores, how: G.how };
    if (!lastHole) {
      let left = 6;
      const btn = h('button', { class: 'btn btn-pink btn-lg' }, `Next hole ▶ (${left})`);
      const go = () => { clearInterval(G.cardTimer); fill($('#center')); G.k++; playSoloHole(); };
      btn.onclick = go;
      showCard(h('div', { class: 'gf-card' }, h('h2', {}, `After ${G.k + 1} hole${G.k ? 's' : ''}`), h('div', { class: 'sub' }, c.name), scoreTable(pars, [me], G.k), h('div', { class: 'btns' }, btn)));
      clearInterval(G.cardTimer);
      G.cardTimer = setInterval(() => { left--; btn.textContent = `Next hole ▶ (${left})`; if (left <= 0) go(); }, 1000);
      return;
    }
    // the end of the round
    const total = G.scores.reduce((a, b) => a + b, 0);
    const par = pars.reduce((a, b) => a + b, 0);
    const aces = G.how.filter((x) => x === 'ace').length;
    store.set('golf_aces', store.get('golf_aces', 0) + aces);
    Sfx.play('win');
    const acesText = aces ? ` · ⛳ ${aces} hole${aces === 1 ? '' : 's'} in one!` : '';
    if (c.gen) {
      // random courses have no best or leaderboard (they're all different), but they do have a code to share
      if (total <= par) UI.confetti(180);
      const copy = () => { navigator.clipboard?.writeText(String(c.seed)).then(() => UI.toast('📋 Course code copied', 'good', 2000), () => {}); };
      showCard(h('div', { class: 'gf-card' },
        h('h2', {}, '🎲 Round complete!'),
        h('div', { class: 'big' }, `${total} `, h('span', { style: { fontSize: '.5em', color: 'var(--muted)' } }, `(${vsPar(total - par)})`)),
        h('div', { class: 'sub' }, `${c.blurb}`, acesText),
        h('div', { class: 'sub' }, 'Course code ', h('b', { class: 'seed-code' }, String(c.seed)), ' ', h('button', { class: 'btn btn-ghost btn-sm', onclick: copy }, '📋 Copy'), h('div', { class: 'tiny muted' }, 'Give it to a friend to play the same 9 holes.')),
        scoreTable(pars, [me], -1),
        h('div', { class: 'btns' },
          h('button', { class: 'btn btn-pink', onclick: () => startSolo(`gen-${C.newSeed()}`) }, '🎲 New random course'),
          h('button', { class: 'btn btn-cyan', onclick: () => startSolo(c.id) }, '🔁 Play this one again'),
          h('button', { class: 'btn btn-ghost', onclick: () => { stopPlay(); showMenu(); } }, '⛳ Courses'))));
      return;
    }
    const prev = store.get(bestKey(c.id), null);
    const better = prev == null || total < prev;
    if (better) store.set(bestKey(c.id), total);
    Account.submit(`golf-${c.id}`, total);
    if (better || total <= par) UI.confetti(180);
    const next = C.COURSES[(C.COURSES.findIndex((x) => x.id === c.id) + 1) % C.COURSES.length];
    showCard(h('div', { class: 'gf-card' },
      h('h2', {}, `${c.emoji} Round complete!`),
      h('div', { class: 'big' }, `${total} `, h('span', { style: { fontSize: '.5em', color: 'var(--muted)' } }, `(${vsPar(total - par)})`)),
      h('div', { class: 'sub' }, prev == null ? 'Your first round on this course!' : better ? `🎉 New best! ${prev - total} better than before` : `Your best: ${prev} (${vsPar(prev - par)})`, acesText),
      scoreTable(pars, [me], -1),
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-pink', onclick: () => startSolo(c.id) }, '🔁 Play again'),
        h('button', { class: 'btn btn-cyan', onclick: () => startSolo(next.id) }, `${next.emoji} Try ${next.name}`),
        h('button', { class: 'btn btn-ghost', onclick: () => { stopPlay(); showMenu(); } }, '⛳ Courses'))));
  }
  function showCard(card) {
    fill($('#center'), card);
    if (FX.on && !calm()) FX.gsap.fromTo(card, { y: 40, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(1.6)' });
  }

  // ------------------------------------------------------------------ screens
  function showScreen(name) {
    for (const s of ['entry', 'room', 'menu', 'play']) $('#' + s).classList.toggle('hidden', s !== name);
    if (name !== 'play') { stopPlay(); }
    if (name !== 'play' || !G.running) scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------------ online
  function renderRoomMain() {
    const host = Room.isHost;
    const res = S.results;
    const kids = [];
    if (res && res.rows) {
      const c = C.courseById(res.course);
      kids.push(h('div', { class: 'panel-title' }, `🏆 Results · ${c.emoji} ${c.gen ? `${c.name} #${c.seed}` : c.name}`),
        h('div', {}, res.rows.map((r) => h('div', { class: 'player-row' + (r.id === Net.id ? ' me' : '') },
          h('b', { style: { width: '26px' } }, ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}`), UI.avatar(r, 'sm'),
          h('span', { class: 'grow' }, r.name), h('span', { class: 'pmeta' }, `${r.total} (${vsPar(r.par)})${r.aces ? ` · ⛳${r.aces}` : ''}`)))),
        scoreTable(res.pars, res.rows, -1),
        h('div', { style: { height: '14px' } }));
    }
    const sel = S.settings.course;
    const opts = [{ id: 'gen', name: 'Random course', emoji: '🎲', sub: 'Brand-new holes every game' },
      ...C.COURSES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, sub: `9 holes · par ${C.par(c.id)}` })),
      { id: 'random', name: 'Any course', emoji: '🔀', sub: 'One of the six, picked for you' }];
    kids.push(h('div', { class: 'panel-title' }, '⛳ Course', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'courses', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' } }, opts.map((c) => h('button', {
        class: 'course-card' + (sel === c.id ? ' on' : ''), disabled: !host,
        onclick: () => { Net.send('g:settings', { course: c.id }); Sfx.play('click'); },
      }, h('div', { class: 'art ' + c.id, style: { height: '80px', fontSize: '2.4rem' } }, h('span', {}, c.emoji)),
        h('div', { class: 'body', style: { padding: '10px 12px' } }, h('b', { style: { fontSize: '1rem' } }, c.name), h('div', { class: 'tiny muted' }, c.sub))))),
      h('div', { class: 'set-row' }, h('b', {}, 'Holes'), h('div', { class: 'seg' }, [3, 6, 9].map((n) => h('button', {
        class: S.settings.holes === n ? 'on' : '', disabled: !host, onclick: () => { Net.send('g:settings', { holes: n }); Sfx.play('click'); },
      }, n)))),
      h('div', { style: { height: '14px' } }),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => Net.send('g:start') }, res ? '🔁 Play again' : '⛳ Tee off!')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, 'Everyone plays the same hole at the same time and sees the others as ghost balls. Fewest strokes wins! Once someone holes out, the rest have 45 seconds.'));
    fill($('#room-main'), kids);
  }
  function startOnlineHole(round, countdown) {
    S.round = round;
    const c = C.courseById(round.course);
    const hd = c.holes[round.hole];
    const me = round.players[Net.id];
    const mine = me && me.scores[round.hole] == null;
    Object.assign(G, { mode: 'online', course: c.id, list: Array.from({ length: round.holes }, (_, i) => i), k: round.hole, practice: false });
    const goAt = performance.now() - round.elapsed * 1000;
    const resume = mine && me.pos && me.s ? { pos: me.pos, s: me.s } : null;
    fill($('#center'));
    if (!startHole(hd, c.theme, { goAt, spectate: !mine, resume, introMs: Math.max(1200, countdown * 1000 - 300) })) return;
    $('#play-chat').classList.remove('hidden');
    for (const id of Object.keys(round.players)) if (id !== Net.id) {
      const o = addOther(id);
      const p = round.players[id];
      if (o && p.pos) o.s.push([performance.now(), p.pos[0], p.pos[1], p.pos[2]]);
      else if (o) o.s.push([performance.now(), G.H.tee[0], C.surface(G.H, G.H.tee[0], G.H.tee[1], {}).h, G.H.tee[1]]);
    }
    if (!mine) {
      cam.mode = 'overview';
      fill($('#center'), h('div', { class: 'gf-card', style: { width: 'auto', padding: '10px 16px', alignSelf: 'end' } }, h('b', {}, me ? '✅ You’re done with this hole — watching the others' : '👀 Watching — you’ll play in the next game')));
    }
    G.hurryEnd = round.hurry ? performance.now() + round.hurry * 1000 : 0;
  }
  function waitingCard() {
    if (!S.round) return;
    const r = S.round;
    const waiting = Object.entries(r.players).filter(([, p]) => p.scores[r.hole] == null).map(([id]) => ((window.Room && Room.player(id)) || { name: '?' }).name);
    if (!waiting.length) return;
    fill($('#center'), h('div', { class: 'gf-card', style: { width: 'auto', padding: '10px 16px', alignSelf: 'end' } }, h('b', {}, `✅ Holed! Waiting for ${waiting.slice(0, 3).join(', ')}${waiting.length > 3 ? '…' : ''}`)));
    // watch someone who's still playing
    const id = Object.keys(r.players).find((u) => u !== Net.id && r.players[u].scores[r.hole] == null);
    if (id) { G.follow = id; cam.mode = 'spectate'; cam.user = false; }
  }
  let boardKey = '';
  function renderBoard() {
    const r = S.round;
    if (!r) return;
    const rows = Object.entries(r.players).map(([id, p]) => {
      const pl = (window.Room && Room.player(id)) || { name: '?', color: '#888' };
      const tot = p.scores.reduce((a, s) => a + (s || 0), 0);
      const done = p.scores[r.hole] != null;
      return { id, name: pl.name, color: pl.color, s: id === Net.id ? (done ? p.scores[r.hole] : G.strokes) : (done ? p.scores[r.hole] : p.s), done, tot };
    }).sort((a, b) => a.tot - b.tot);
    const key = rows.map((x) => `${x.id}${x.s}${x.done}${x.tot}`).join();
    if (key === boardKey) return;
    boardKey = key;
    fill($('#board'), rows.map((x) => h('div', { class: (x.id === Net.id ? 'me' : '') + (x.done ? ' done' : '') }, h('i', { style: { background: x.color } }), x.name, h('b', {}, `${x.done ? '✓ ' : ''}${x.s}`))));
  }
  function renderHurry(now) {
    const el = $('#hurry');
    const left = G.hurryEnd ? Math.ceil((G.hurryEnd - now) / 1000) : 0;
    const txt = left > 0 && S.round && S.round.stage === 'play' ? `⏱️ ${left}s` : '';
    if (el.textContent !== txt) fill(el, txt ? h('span', { class: 'gf-chip' + (left <= 10 ? ' warn' : '') }, txt) : null);
  }

  Lobby.init({
    game: 'golf',
    title: 'Mini Golf',
    emoji: '⛳',
    tagline: 'Low-poly 3D mini golf! Six courses — meadow, haunted, desert, ice, beach and volcano — plus random courses that are new every time. Play solo or race your friends.',
    solo: { label: '⛳ Play solo', onClick: () => showMenu() },
    howTo: '<b>How to play</b><ul><li>Drag back from your ball like a slingshot — the further you pull, the harder the shot. Let go to putt.</li><li>Drag anywhere else to look around, scroll or pinch to zoom, 🗺️ to see the whole hole.</li><li>Water, lava or out of bounds: +1 stroke and back to where you hit from. 8 strokes max per hole.</li><li>Ice is slippery, sand is slow, and glowing arrows give your ball a big push.</li><li>🎲 Random course: nine brand-new holes every game. Each one has a code you can share.</li><li>Online: everyone plays the same hole at once. When someone holes out, the rest have 45 seconds. Fewest strokes wins!</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (S.wins[p.id] ? h('span', { title: 'Wins' }, `🏆${S.wins[p.id]}`) : null) });
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'));

  Lobby.on('joined', (m) => {
    Object.assign(S, m.state);
    if (S.phase === 'playing' && S.round && S.round.stage === 'play') startOnlineHole(S.round, Math.max(0, -S.round.elapsed));
    else if (S.phase === 'playing' && S.round) { showScreen('room'); renderRoomMain(); fill($('#room-main'), h('div', { class: 'center muted bold', style: { padding: '30px' } }, '⛳ A game is on — you’ll see the next hole in a moment…')); }
    else { showScreen('room'); renderRoomMain(); }
  });
  Lobby.on('players', () => { if (!$('#room').classList.contains('hidden')) renderRoomMain(); boardKey = ''; });
  Lobby.on('left', () => { stopPlay(); });
  Lobby.on('entry', () => { for (const s of ['menu', 'room', 'play']) $('#' + s).classList.add('hidden'); stopPlay(); });

  Net.on('g:settings', (m) => { S.settings = m.settings; if (!$('#room').classList.contains('hidden')) renderRoomMain(); });
  Net.on('g:start', (m) => { S.round = m.round; S.results = null; S.phase = 'playing'; });
  Net.on('g:hole', (m) => { S.phase = 'playing'; startOnlineHole(m.round, m.countdown); });
  Net.on('g:pos', (m) => {
    if (S.round && S.round.players[m.id]) { S.round.players[m.id].s = m.s; S.round.players[m.id].pos = [m.x, m.y, m.z]; }
    if (!G.running || G.mode !== 'online') return;
    const o = addOther(m.id);
    if (!o) return;
    o.s.push([performance.now(), m.x, m.y, m.z]);
    if (o.s.length > 12) o.s.shift();
  });
  Net.on('g:done', (m) => {
    const r = S.round;
    if (r && r.players[m.id]) { r.players[m.id].scores[m.hole] = m.strokes; r.players[m.id].how[m.hole] = m.picked ? 'picked' : m.strokes === 1 ? 'ace' : 'holed'; }
    renderHud();
    if (m.id === Net.id) return;
    const p = (window.Room && Room.player(m.id)) || { name: '?' };
    const [label] = r ? SCORE(m.strokes, r.pars[m.hole]) : ['Holed'];
    UI.toast(m.picked ? `${p.name} picked up` : `⛳ ${p.name}: ${label.toLowerCase()} (${m.strokes})`, m.strokes === 1 ? 'good' : '', 2400);
    if (G.follow === m.id && G.state === 'holed') setTimeout(waitingCard, 400);
  });
  Net.on('g:hurry', (m) => {
    G.hurryEnd = performance.now() + m.seconds * 1000;
    if (G.running && !G.finishSent && !G.spectate) UI.toast(`⏱️ Someone holed out! ${m.seconds}s left to finish`, 'bad', 3500);
  });
  Net.on('g:ace', () => {
    if (!G.running || !G.ball) return;
    G.finishSent = true;
    G.strokes = 1;
    Object.assign(G.ball, { x: G.H.cup[0], z: G.H.cup[1], vx: 0, vz: 0, state: 'holed' });
    holed();
  });
  Net.on('g:holeEnd', (m) => {
    S.round = m.round;
    G.hurryEnd = 0;
    if (!G.running) return;
    const r = m.round;
    const c = C.courseById(r.course);
    const rows = Object.entries(r.players).map(([id, p]) => {
      const pl = (window.Room && Room.player(id)) || { name: 'Gone', color: '#888' };
      return { id, name: pl.name, color: pl.color, scores: p.scores, how: p.how, tot: p.scores.reduce((a, s) => a + (s || 0), 0) };
    }).sort((a, b) => a.tot - b.tot);
    let left = m.next ? Math.round(m.next) : 0;
    const foot = h('div', { class: 'sub', style: { marginTop: '10px', marginBottom: 0 } }, m.last ? '🏁 That was the last hole…' : `Next hole in ${left}…`);
    G.state = G.state === 'holed' ? 'holed' : 'card';
    aimOff();
    showCard(h('div', { class: 'gf-card' }, h('h2', {}, `Hole ${r.hole + 1} · ${c.holes[r.hole].name}`), h('div', { class: 'sub' }, `${c.emoji} ${c.name}`), scoreTable(r.pars, rows, r.hole), foot));
    clearInterval(G.cardTimer);
    if (left) G.cardTimer = setInterval(() => { left--; if (left > 0) foot.textContent = `Next hole in ${left}…`; else clearInterval(G.cardTimer); }, 1000);
  });
  Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
  Net.on('g:results', (m) => {
    S.results = m.results; S.wins = m.wins || {}; S.phase = 'results';
    const was = G.running && G.mode === 'online';
    const rows = m.results.rows;
    clearInterval(G.cardTimer);
    if (was) {
      const c = C.courseById(m.results.course);
      showCard(h('div', { class: 'gf-card' }, h('h2', {}, '🏆 Final scores'), h('div', { class: 'sub' }, `${c.emoji} ${c.name}${c.gen ? ` #${c.seed}` : ''} · ${m.results.holes} holes`),
        h('div', { class: 'rows' }, rows.slice(0, 8).map((r) => h('div', { class: r.id === Net.id ? 'me' : '' }, h('span', {}, ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}`), h('span', { class: 'grow' }, r.name), h('b', {}, `${r.total} (${vsPar(r.par)})`)))),
        scoreTable(m.results.pars, rows, -1)));
    }
    const mine = rows.find((r) => r.id === Net.id);
    if (mine && mine.place === 1 && rows.length > 1) { UI.confetti(220); Sfx.play('win'); }
    setTimeout(() => { if (S.phase === 'results') { showScreen('room'); renderRoomMain(); Lobby.refreshPlayers(); } }, was ? 6500 : 200);
  });
  PA.on('admin:cheat', () => {});

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {   // testing on your own computer only
    window.__golf = { G, C, S, cam, startSolo, shoot, tick, holeScene, aim, toggleView, ballScreen,
      view(pos, look) { G.debugView = { pos, look }; },
      aimPreview(x, y) { const keep = { angle: aim.angle, power: aim.power }; aimFrom(x, y); const r = { angle: aim.angle, power: aim.power }; Object.assign(aim, keep); return r; },
    };
  }

  const qs = new URLSearchParams(location.search);
  if (qs.get('solo')) {
    $('#entry').classList.add('hidden');
    const c = qs.get('course');
    if (c && (C.COURSES.some((x) => x.id === c) || isGen(c))) startSolo(c, qs.get('hole') ? Math.max(0, Math.min(8, +qs.get('hole') - 1)) : null);
    else showMenu();
  }
})();
