/* Poly Racer — low-poly 3D time trials and online races (our own PolyTrack-style game).
   Tracks, car physics and the autopilot are in poly-core.js; this file draws everything with
   three.js and runs the menus, the HUD and online races. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, Account, Profile } = PA;
  const FX = PA.FX || {};
  const C = window.PolyCore;
  const DT = 1 / 120;
  const GROUND = -14;
  // land colours by height above the track's ground (and how steep it is), with a little random variation
  const tint = (hex, r) => new THREE.Color(hex).offsetHSL(0, 0, (r - 0.5) * 0.05);
  const THEMES = {
    summer: { sky: 0xcdeeff, skyTop: 0x3d93dc, fog: 0xcdeeff, deco: 'tree', light: 1, water: 0x3b82f6, clouds: 0xffffff,
      landColor: (hh, st, r) => tint(hh < 0.4 && hh > -4 ? 0xe9d79a : hh < 10 ? (r < 0.5 ? 0x6cc95f : 0x5fbd55) : hh < 45 ? (st > 16 ? 0x8f8f86 : 0x479f4e) : hh < 115 ? (r < 0.5 ? 0x8a8f99 : 0x7b8190) : 0xf3f6fb, r) },
    desert: { sky: 0xffe2b5, skyTop: 0xf59e5b, fog: 0xffe2b5, deco: 'cactus', light: 1.05, water: null, clouds: 0xfff4e0,
      landColor: (hh, st, r) => tint(hh < 12 ? (r < 0.5 ? 0xe8c27c : 0xdfb56c) : hh < 60 ? (st > 14 ? 0xc77a45 : 0xd9a35f) : (r < 0.5 ? 0xb4583a : 0xa04a30), r) },
    snow: { sky: 0xe4edff, skyTop: 0x7aa7e6, fog: 0xe4edff, deco: 'pine', light: 1, water: 0x93c5fd, clouds: 0xe9eef6,
      landColor: (hh, st, r) => tint(hh < 15 ? (r < 0.5 ? 0xf2f5fb : 0xe4ebf6) : hh < 70 ? (st > 16 ? 0x9aa3b2 : 0xdfe8f3) : 0xffffff, r) },
    night: { sky: 0x2a1f5c, skyTop: 0x07051a, fog: 0x1f1848, deco: 'crystal', light: 0.6, water: 0x5b21b6, clouds: null,
      landColor: (hh, st, r) => tint(hh < 10 ? (r < 0.5 ? 0x2a2266 : 0x241d5a) : hh < 60 ? (st > 16 ? 0x3b2f7a : 0x30276e) : 0x6d28d9, r) },
  };
  const MEDALS = [['🏆', 'Author'], ['🥇', 'Gold'], ['🥈', 'Silver'], ['🥉', 'Bronze']];
  const fmt = (s) => {
    if (s == null) return '–';
    const ms = Math.max(0, Math.round(s * 1000));
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  };
  const trackById = (id) => C.TRACKS.find((t) => t.id === id) || C.TRACKS[0];
  const medalFor = (track, s) => track.medals.findIndex((m) => s <= m);    // -1 = no medal
  const bestOf = (id) => store.get('poly_best_' + id, null);

  const stage = $('#stage');
  const state = { phase: 'lobby', settings: { track: 1 }, race: null, results: null, wins: {} };
  const R = { running: false, mode: null, track: null, T: null, car: null, mesh: null, steer: 0, acc: 0, goAt: 0, started: false,
    rec: [], recAt: 0, ghost: null, ghostMesh: null, others: new Map(), sentAt: 0, finishSent: false, spectate: false, splitsBest: null,
    lastCp: -1, camSnap: true, wasBoost: false };

  // ------------------------------------------------------------------ 3D setup
  let renderer = null; let scene; let camera; let sun; let hemi;
  function setup3d() {
    if (renderer) return true;
    if (!window.THREE) { UI.toast('Poly Racer needs an internet connection to load its 3D engine 😕', 'bad', 5000); return false; }
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    stage.prepend(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 4000);
    hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.75);
    sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(90, 124, 128);
    scene.add(hemi, sun);
    const resize = () => {
      const r = stage.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(stage);
    resize();
    return true;
  }

  // ------------------------------------------------------------------ building a track
  const built = new Map();
  const col = (hex) => new THREE.Color(hex);
  function trackScene(track) {
    if (built.has(track.id)) return built.get(track.id);
    const T = C.build(track);
    const grp = new THREE.Group();
    const S = T.S;
    const th = THEMES[track.theme] || THEMES.summer;
    let seed = track.id * 9973 + 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // ---------------- the road, kerbs, barriers
    const pos = []; const cols = [];
    const tri = (a, b, c, k) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cols.push(k.r, k.g, k.b); };
    const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
    const at = (s, off, dy = 0) => [s.x - s.hz * off, s.y + dy, s.z + s.hx * off];
    const K = {
      road: col(0x3d4357), road2: col(0x383d50), line: col(0xf8fafc), side: col(0x2a2e3d), under: col(0x22252f), out: col(0x2b2f40),
      boost: col(0x22d3ee), boost2: col(0x0e7490), kick: col(0xf59e0b), kick2: col(0xfde047), finish: col(0xffffff), finish2: col(0x111111),
      red: col(0xe11d48), white: col(0xf8fafc), kerbR: col(0xdc2626), kerbW: col(0xf1f5f9),
      conc: col(0xd5d9e2), conc2: col(0xc9ced9), base: col(0x5b6170), back: col(0x9aa1ad), cap: col(0xb3b9c4),
      hazY: col(0xfacc15), hazB: col(0x1f2937),
    };
    const WALL_IN = 0.15; const WALL_OUT = 1.05; const WALL_H = 1.35; const SLAB = 1.3;
    const yawOf = (s) => Math.atan2(s.hx, s.hz);
    const turning = (i) => {
      if (i <= 0 || i >= S.length - 1) return 0;
      let d = yawOf(S[i + 1]) - yawOf(S[i - 1]);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };
    const wallOn = (i) => i >= 0 && i < S.length - 1 && !S[i].gap && !S[i + 1].gap && S[i].walls && S[i + 1].walls;
    const roadOn = (i) => i >= 0 && i < S.length - 1 && !S[i].gap && !S[i + 1].gap;
    for (let i = 0; i < S.length - 1; i++) {
      if (!roadOn(i)) continue;
      const a = S[i]; const b = S[i + 1];
      const band = Math.floor(i / 3) % 2;
      let k = Math.floor(i / 6) % 2 ? K.road : K.road2;
      if (a.boost) k = band ? K.boost : K.boost2;
      else if (a.slope > 0.12 && b.slope > 0.12) k = band ? K.kick : K.kick2;
      else if (a.after) k = K.out;
      if (i >= T.finish - 2 && i < T.finish + 1) k = i % 2 ? K.finish : K.finish2;
      quad(at(a, -a.w), at(a, a.w), at(b, b.w), at(b, -b.w), k);
      // kerbs in the corners, white lines on the straights
      const bend = Math.abs(turning(i)) > 0.006;
      const kerb = Math.floor(i / 2) % 2 ? K.kerbR : K.kerbW;
      for (const side of [1, -1]) {
        const o1 = side * (a.w - (bend ? 1.25 : 0.75)); const o2 = side * (a.w - (bend ? 0.05 : 0.3));
        const p1 = side * (b.w - (bend ? 1.25 : 0.75)); const p2 = side * (b.w - (bend ? 0.05 : 0.3));
        quad(at(a, o1, 0.04), at(a, o2, 0.04), at(b, p2, 0.04), at(b, p1, 0.04), bend ? kerb : K.line);
      }
      if (Math.floor(i / 4) % 2 && !a.boost && !bend) quad(at(a, -0.15, 0.03), at(a, 0.15, 0.03), at(b, 0.15, 0.03), at(b, -0.15, 0.03), K.line);
      // the slab under the road: hazard stripes on edges without a barrier
      for (const side of [1, -1]) {
        const ow = side * a.w; const pw = side * b.w;
        if (wallOn(i)) {
          quad(at(a, ow), at(b, pw), at(b, pw, -SLAB), at(a, ow, -SLAB), K.side);
        } else {
          quad(at(a, ow), at(b, pw), at(b, pw, -0.4), at(a, ow, -0.4), Math.floor(i / 2) % 2 ? K.hazY : K.hazB);
          quad(at(a, ow, -0.4), at(b, pw, -0.4), at(b, pw, -SLAB), at(a, ow, -SLAB), K.side);
        }
      }
      quad(at(a, -a.w, -SLAB), at(a, a.w, -SLAB), at(b, b.w, -SLAB), at(b, -b.w, -SLAB), K.under);
      // ends of the road (before and after a gap)
      if (!roadOn(i - 1)) quad(at(a, -a.w), at(a, a.w), at(a, a.w, -SLAB), at(a, -a.w, -SLAB), K.side);
      if (!roadOn(i + 1)) quad(at(b, -b.w), at(b, b.w), at(b, b.w, -SLAB), at(b, -b.w, -SLAB), K.side);
      // barriers: thick concrete with a red and white top, capped at the ends
      if (wallOn(i)) {
        const blk = Math.floor(i / 4) % 2;
        const top = blk ? K.red : K.white;
        for (const side of [1, -1]) {
          const ai = side * (a.w + WALL_IN); const bi = side * (b.w + WALL_IN);
          const ao = side * (a.w + WALL_OUT); const bo = side * (b.w + WALL_OUT);
          quad(at(a, ai), at(b, bi), at(b, bi, 0.16), at(a, ai, 0.16), K.base);
          quad(at(a, ai, 0.16), at(b, bi, 0.16), at(b, bi, 0.8), at(a, ai, 0.8), blk ? K.conc : K.conc2);
          quad(at(a, ai, 0.8), at(b, bi, 0.8), at(b, bi, WALL_H), at(a, ai, WALL_H), top);
          quad(at(a, ai, WALL_H), at(b, bi, WALL_H), at(b, bo, WALL_H), at(a, ao, WALL_H), top);
          quad(at(a, ao, WALL_H), at(b, bo, WALL_H), at(b, bo, -SLAB), at(a, ao, -SLAB), K.back);
          quad(at(a, ai, 0), at(b, bi, 0), at(b, bo, 0), at(a, ao, 0), K.base);
          if (!wallOn(i - 1)) quad(at(a, ai, WALL_H), at(a, ao, WALL_H), at(a, ao, -SLAB), at(a, ai, -SLAB), K.cap);
          if (!wallOn(i + 1)) quad(at(b, bi, WALL_H), at(b, bo, WALL_H), at(b, bo, -SLAB), at(b, bi, -SLAB), K.cap);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    grp.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    // pillars holding the road up
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0xa3a9b8 });
    const capMat = new THREE.MeshLambertMaterial({ color: 0x7c8293 });
    for (let i = 6; i < S.length; i += 14) {
      const s = S[i];
      if (s.gap || s.after) continue;
      const hgt = s.y - SLAB - GROUND;
      if (hgt < 1) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, hgt, 1.8), pillarMat);
      p.position.set(s.x, GROUND + hgt / 2, s.z);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(s.w * 1.4, 0.7, 2.2), capMat);
      cap.position.set(s.x, s.y - SLAB - 0.35, s.z);
      cap.rotation.y = yawOf(s);
      grp.add(p, cap);
    }

    // checkpoint arches, the start and the finish
    const arches = [];
    const arch = (s, color, banner) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
      const dark = new THREE.MeshLambertMaterial({ color: 0x1f2937 });
      const w = s.w + WALL_OUT + 0.5;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), mat);
        post.position.set(side * w, 3.25, 0);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), dark);
        foot.position.set(side * w, 0.3, 0);
        g.add(post, foot);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.9, 1.1, 0.9), mat);
      bar.position.y = 6.5;
      g.add(bar);
      if (banner) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 32;
        const x = c.getContext('2d');
        for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 8, j * 8, 8, 8); }
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
        flag.position.y = 5.3;
        g.add(flag);
      }
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = yawOf(s);
      grp.add(g);
      return { g, mat };
    };
    S.forEach((s) => { if (s.cp >= 0) arches[s.cp] = arch(s, 0xfacc15); });
    arch(S[T.finish], 0xffffff, true);
    arch(S[0], 0x22d3ee);

    // where the track is, for keeping hills and scenery off it
    const CELL = 40; const near = new Map();
    for (let i = 0; i < S.length; i += 2) {
      const key = Math.floor(S[i].x / CELL) + ',' + Math.floor(S[i].z / CELL);
      if (!near.has(key)) near.set(key, []);
      near.get(key).push(S[i]);
    }
    const trackDist = (x, z) => {
      let best = 999;
      const cx = Math.floor(x / CELL); const cz = Math.floor(z / CELL);
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const list = near.get((cx + dx) + ',' + (cz + dz));
        if (!list) continue;
        for (const s of list) { const d = Math.hypot(s.x - x, s.z - z) - s.w; if (d < best) best = d; }
      }
      return best;
    };

    // chevron signs on the barrier at the outside of sharp corners
    const chevron = (right) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 32;
      const x = c.getContext('2d');
      x.fillStyle = '#dc2626'; x.fillRect(0, 0, 128, 32);
      x.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) {
        const cx = 18 + k * 30;
        x.beginPath();
        if (right) { x.moveTo(cx - 8, 4); x.lineTo(cx + 6, 16); x.lineTo(cx - 8, 28); x.lineTo(cx - 1, 28); x.lineTo(cx + 13, 16); x.lineTo(cx - 1, 4); }
        else { x.moveTo(cx + 8, 4); x.lineTo(cx - 6, 16); x.lineTo(cx + 8, 28); x.lineTo(cx + 1, 28); x.lineTo(cx - 13, 16); x.lineTo(cx + 1, 4); }
        x.fill();
      }
      return new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide });
    };
    const chev = { true: chevron(true), false: chevron(false) };
    for (let i = 1; i < S.length - 1;) {
      if (Math.abs(turning(i)) < 0.012) { i++; continue; }
      const dir = Math.sign(turning(i));
      let j = i; let total = 0;
      while (j < S.length - 1 && Math.sign(turning(j)) === dir && Math.abs(turning(j)) >= 0.006) { total += turning(j) / 2; j++; }
      const mid = Math.floor((i + j) / 2);
      if (Math.abs(total) > 1.0 && wallOn(mid)) {
        const s = S[mid]; const s0 = S[i];
        const right = dir < 0;        // yaw going down = turning right; the sign sits on the left
        const off = (right ? -1 : 1) * (s.w + WALL_IN + 0.3);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), chev[right]);
        const p = at(s, off, WALL_H + 0.75);
        sign.position.set(p[0], p[1], p[2]);
        sign.rotation.y = yawOf(s0);
        grp.add(sign);
      }
      i = j + 1;
    }

    // ---------------- the land: low-poly hills, lakes, and mountains at the edge
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const mx = (x0 + x1) / 2; const mz = (z0 + z1) / 2;
    const R0 = Math.hypot(x1 - x0, z1 - z0) / 2;
    const noise = makeNoise(track.id * 7919 + 3);
    const height = (x, z) => {
      const d = trackDist(x, z);
      const n = noise(x, z);
      const flat = smooth(14, 90, d);
      const rim = smooth(R0 + 120, R0 + 650, Math.hypot(x - mx, z - mz));
      let hgt = GROUND + 0.6 + flat * (n - 0.42) * 70 + rim * (50 + n * 190);
      if (d < 16) hgt = Math.min(hgt, GROUND + 0.6);      // flat (and dry) under the track
      return hgt;
    };
    const SIZE = R0 * 2 + 1700; const N = 96; const step = SIZE / N;
    const hs = [];
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) hs.push(height(mx - SIZE / 2 + ix * step, mz - SIZE / 2 + iz * step));
    const tp = []; const tc = [];
    const shade = th.landColor;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const vx = (i) => mx - SIZE / 2 + i * step; const vz = (i) => mz - SIZE / 2 + i * step;
        const hA = hs[iz * (N + 1) + ix]; const hB = hs[iz * (N + 1) + ix + 1]; const hC = hs[(iz + 1) * (N + 1) + ix]; const hD = hs[(iz + 1) * (N + 1) + ix + 1];
        const A = [vx(ix), hA, vz(iz)]; const B = [vx(ix + 1), hB, vz(iz)]; const Cc = [vx(ix), hC, vz(iz + 1)]; const D = [vx(ix + 1), hD, vz(iz + 1)];
        for (const [p, q, r] of [[A, Cc, B], [B, Cc, D]]) {
          const avg = (p[1] + q[1] + r[1]) / 3;
          const steep = Math.max(p[1], q[1], r[1]) - Math.min(p[1], q[1], r[1]);
          const k = shade(avg - GROUND, steep, rnd());
          tp.push(...p, ...q, ...r);
          for (let v = 0; v < 3; v++) tc.push(k.r, k.g, k.b);
        }
      }
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tgeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
    tgeo.computeVertexNormals();
    grp.add(new THREE.Mesh(tgeo, new THREE.MeshLambertMaterial({ vertexColors: true })));
    if (th.water) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ color: th.water, transparent: true, opacity: 0.85, emissive: th.water, emissiveIntensity: th.deco === 'crystal' ? 0.35 : 0.08 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(mx, GROUND - 0.9, mz);
      grp.add(water);
    }

    // ---------------- scenery on the land
    const parts = DECO[th.deco];
    const spots = [];
    for (let k = 0; k < 4000 && spots.length < 420; k++) {
      const x = mx + (rnd() - 0.5) * (R0 * 2 + 700); const z = mz + (rnd() - 0.5) * (R0 * 2 + 700);
      const hgt = height(x, z);
      if (hgt < GROUND - 0.5 || hgt > GROUND + 45 || trackDist(x, z) < 14) continue;
      spots.push([x, hgt, z, 0.7 + rnd() * 1.2, rnd() * Math.PI * 2, rnd() < 0.22]);
    }
    const m4 = new THREE.Matrix4();
    const v3 = new THREE.Vector3();
    for (const kind of ['main', 'rock']) {
      const list = spots.filter((s) => (kind === 'rock') === s[5]);
      for (const [g, color, dy, emissive] of parts[kind]) {
        const mat = new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive ? 0.5 : 0 });
        const inst = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach(([x, y, z, sc, rot], i) => {
          m4.makeRotationY(rot);
          m4.scale(v3.set(sc, sc, sc));
          m4.setPosition(x, y + dy * sc, z);
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        grp.add(inst);
      }
    }

    // grandstands full of fans at the start and the finish
    for (const i of [6, T.finish]) {
      const s = S[i];
      for (const side of [1, -1]) {
        const off = side * (s.w + 9);
        const c = at(s, off);
        let clear = true;
        for (let j = 0; j < S.length; j += 3) {
          if (Math.abs(j - i) < 30) continue;
          if (Math.hypot(S[j].x - c[0], S[j].z - c[2]) < S[j].w + 22) { clear = false; break; }
        }
        if (!clear) continue;
        grp.add(grandstand(s, side, c));
        break;
      }
    }

    // ---------------- sky: gradient, sun or moon and stars, clouds
    const sky = new THREE.Group();
    const sg = new THREE.SphereGeometry(2600, 24, 12);
    const sc2 = []; const top = col(th.skyTop); const hor = col(th.sky);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) { const t = Math.max(0, sp.getY(i) / 2600); const k = hor.clone().lerp(top, Math.pow(t, 0.6)); sc2.push(k.r, k.g, k.b); }
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc2, 3));
    const dome = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.position.set(mx, 0, mz);
    dome.renderOrder = -1;
    sky.add(dome);
    const glow = (color, size, dist, dir) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, color); g.addColorStop(0.25, color); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), fog: false, depthWrite: false }));
      spr.scale.set(size, size, 1);
      spr.position.set(mx + dir[0] * dist, dir[1] * dist, mz + dir[2] * dist);
      return spr;
    };
    const sunDir = [0.45, 0.62, 0.64];
    if (th.deco === 'crystal') {
      sky.add(glow('#f5f3ff', 220, 2000, [-0.5, 0.55, 0.67]));
      const n = 1400; const sp2 = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2; const e = Math.asin(0.08 + rnd() * 0.92);
        sp2[i * 3] = Math.cos(a) * Math.cos(e) * 2400; sp2[i * 3 + 1] = Math.sin(e) * 2400; sp2[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 2400;
      }
      const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(sp2, 3));
      const stars = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false }));
      stars.position.set(mx, 0, mz);
      sky.add(stars);
    } else {
      sky.add(glow('#fffbe6', 420, 2000, sunDir));
    }
    const clouds = new THREE.Group();
    if (th.clouds) {
      const cmat = new THREE.MeshLambertMaterial({ color: th.clouds, flatShading: true, fog: false, emissive: th.clouds, emissiveIntensity: 0.62 });
      const cgeo = new THREE.IcosahedronGeometry(1, 1);
      for (let k = 0; k < 26; k++) {
        const cl = new THREE.Group();
        const n = 3 + Math.floor(rnd() * 4);
        for (let j = 0; j < n; j++) {
          const m = new THREE.Mesh(cgeo, cmat);
          const r = 10 + rnd() * 14;
          m.scale.set(r * 1.3, r * 0.75, r);
          m.position.set((j - n / 2) * 14 + rnd() * 6, rnd() * 6, rnd() * 10);
          cl.add(m);
        }
        const a = rnd() * Math.PI * 2; const d = 300 + rnd() * (R0 + 700);
        cl.position.set(mx + Math.cos(a) * d, 90 + rnd() * 90, mz + Math.sin(a) * d);
        cl.rotation.y = rnd() * Math.PI;
        clouds.add(cl);
      }
    }
    sky.add(clouds);
    grp.add(sky);
    const out = { T, grp, arches, sky, clouds, center: [mx, mz], spread: R0 + 700 };
    built.set(track.id, out);
    return out;
  }

  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function makeNoise(seed0) {
    let s = seed0;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const N = 64; const grid = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) grid[i] = rnd();
    const at = (ix, iz) => grid[(((iz % N) + N) % N) * N + (((ix % N) + N) % N)];
    const sm = (t) => t * t * (3 - 2 * t);
    const one = (x, z) => {
      const ix = Math.floor(x); const iz = Math.floor(z);
      const fx = sm(x - ix); const fz = sm(z - iz);
      const a = at(ix, iz); const b = at(ix + 1, iz); const c = at(ix, iz + 1); const d = at(ix + 1, iz + 1);
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };
    return (x, z) => one(x / 170, z / 170) * 0.55 + one(x / 70 + 13, z / 70 + 7) * 0.3 + one(x / 28 + 31, z / 28 + 5) * 0.15;
  }

  // scenery pieces for each theme: [geometry, colour, height off the ground, glows]
  const DECO = (() => {
    if (!window.THREE) return {};
    const cyl = (r1, r2, hgt, n = 6) => new THREE.CylinderGeometry(r1, r2, hgt, n);
    const cone = (r, hgt, n = 6) => new THREE.ConeGeometry(r, hgt, n);
    const rock = new THREE.DodecahedronGeometry(2.2, 0);
    return {
      tree: { main: [[cyl(0.5, 0.65, 3, 5), 0x8b5a2b, 1.5], [new THREE.IcosahedronGeometry(3, 0), 0x3fa34d, 5.2], [new THREE.IcosahedronGeometry(2, 0), 0x52b85e, 7.4]],
        rock: [[rock, 0x9ca3af, 1.2], [new THREE.IcosahedronGeometry(1.6, 0), 0x4c9a52, 0.9]] },
      pine: { main: [[cyl(0.4, 0.5, 2.4, 5), 0x6b4423, 1.2], [cone(2.6, 6.5), 0x1f6f43, 5], [cone(1.8, 4.5), 0x2f855a, 7.6], [cone(0.9, 2), 0xffffff, 9.6]],
        rock: [[rock, 0xcbd5e1, 1.2], [new THREE.IcosahedronGeometry(1.3, 0), 0xffffff, 1.9]] },
      cactus: { main: [[cyl(0.7, 0.8, 6, 6), 0x3f9b4a, 3], [new THREE.BoxGeometry(3, 0.7, 0.7), 0x3f9b4a, 3.4], [cyl(0.45, 0.45, 1.8, 6), 0x3f9b4a, 4.3]],
        rock: [[rock, 0xc2410c, 1.1], [new THREE.IcosahedronGeometry(1.5, 0), 0xa16207, 0.8]] },
      crystal: { main: [[new THREE.OctahedronGeometry(2.4, 0), 0xa855f7, 2.4, true], [new THREE.OctahedronGeometry(1.2, 0), 0x22d3ee, 5, true]],
        rock: [[rock, 0x3b2f7a, 1.1], [new THREE.IcosahedronGeometry(1, 0), 0xf472b6, 2.4, true]] },
    };
  })();

  function grandstand(s, side, c) {
    const g = new THREE.Group();
    const conc = new THREE.MeshLambertMaterial({ color: 0xcbd2dc });
    const roofM = new THREE.MeshLambertMaterial({ color: 0xe11d48 });
    const L = 34;
    const base = s.y + 0.2 - GROUND;
    const b = new THREE.Mesh(new THREE.BoxGeometry(L, base, 3), conc);
    b.position.set(0, -base / 2 + 0.2, 1.5);
    g.add(b);
    const fanCols = [0xff4fd8, 0x22d3ee, 0xfacc15, 0xa3e635, 0xfb923c, 0x8b5cf6, 0xf8fafc];
    for (let t = 0; t < 5; t++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(L, 1 + t * 1.1, 2.2), conc);
      step.position.set(0, (1 + t * 1.1) / 2, 3 + t * 2.2);
      g.add(step);
      for (let f = 0; f < 15; f++) {
        if ((f * 7 + t * 3) % 5 === 0) continue;
        const fan = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.8), new THREE.MeshLambertMaterial({ color: fanCols[(f * 3 + t * 5) % fanCols.length] }));
        fan.position.set(-L / 2 + 1.5 + f * 2.2, 1 + t * 1.1 + 0.6, 3 + t * 2.2);
        g.add(fan);
      }
    }
    for (const x of [-L / 2 + 0.5, L / 2 - 0.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), conc);
      post.position.set(x, 4.5, 13);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 2, 0.5, 12), roofM);
    roof.position.set(0, 9, 8);
    roof.rotation.x = -0.12;
    g.add(roof);
    // local x runs along the track, local z away from it
    g.position.set(c[0], s.y, c[2]);
    g.rotation.y = Math.atan2(-s.hz, s.hx) + (side < 0 ? Math.PI : 0);
    return g;
  }

  // ------------------------------------------------------------------ cars
  function makeCar(color, ghost) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, transparent: !!ghost, opacity: ghost ? 0.4 : 1, depthWrite: !ghost });
    const add = (geo, c, x, y, z) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); g.add(m); return m; };
    add(new THREE.BoxGeometry(2.1, 0.6, 4.2), color, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.8, 0.35, 1.1), color, 0, 0.6, 2.4);
    add(new THREE.BoxGeometry(1.6, 0.55, 1.8), 0x1e293b, 0, 1.3, -0.3);
    add(new THREE.BoxGeometry(2.1, 0.14, 0.55), 0x111827, 0, 1.4, -2.0);
    add(new THREE.BoxGeometry(0.2, 0.5, 0.2), 0x111827, 0.7, 1.15, -2.0);
    add(new THREE.BoxGeometry(0.2, 0.5, 0.2), 0x111827, -0.7, 1.15, -2.0);
    for (const [x, z] of [[1.1, 1.4], [-1.1, 1.4], [1.1, -1.4], [-1.1, -1.4]]) add(new THREE.BoxGeometry(0.45, 0.8, 0.8), 0x111111, x, 0.4, z);
    g.rotation.order = 'YXZ';
    return g;
  }
  let shadowTex = null;
  function shadowBlob() {
    if (!shadowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      shadowTex = new THREE.CanvasTexture(c);
    }
    const geo = new THREE.PlaneGeometry(3.6, 5.6);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  }
  function nameTag(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.font = '700 30px Fredoka, sans-serif';
    const w = Math.min(250, x.measureText(text).width + 28);
    x.fillStyle = 'rgba(11,9,32,.75)';
    x.beginPath(); x.roundRect((256 - w) / 2, 8, w, 46, 23); x.fill();
    x.fillStyle = color || '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 32, 240);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sp.scale.set(6, 1.5, 1);
    sp.position.y = 3.4;
    return sp;
  }
  function placeMesh(mesh, x, y, z, yaw, pitch = 0, roll = 0) {
    mesh.position.set(x, y, z);
    mesh.rotation.set(pitch, yaw, roll);
  }

  // ------------------------------------------------------------------ engine sound
  const Engine = (() => {
    let osc = null; let gain = null; let filt = null;
    return {
      start() {
        try {
          const ac = Sfx.ac(); if (!ac || osc) return;
          osc = ac.createOscillator(); gain = ac.createGain(); filt = ac.createBiquadFilter();
          osc.type = 'sawtooth'; filt.type = 'lowpass'; filt.frequency.value = 700; gain.gain.value = 0;
          osc.connect(filt).connect(gain).connect(Sfx.master);
          osc.start();
        } catch { osc = null; }
      },
      set(speed, on) {
        if (!osc) return;
        const ac = Sfx.ac();
        osc.frequency.setTargetAtTime(55 + Math.abs(speed) * 3.2, ac.currentTime, 0.05);
        gain.gain.setTargetAtTime(on && !Sfx.muted ? 0.035 : 0, ac.currentTime, 0.08);
      },
      stop() { if (osc) { try { osc.stop(); } catch { /* already stopped */ } osc = null; } },
    };
  })();

  // ------------------------------------------------------------------ input
  const keys = { up: false, down: false, left: false, right: false, drift: false };
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'drift' };
  const driving = () => !$('#drive').classList.contains('hidden');
  const typing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  addEventListener('keydown', (e) => {
    if (!driving() || typing()) return;
    const k = KEYMAP[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'KeyR') respawn();
    if (e.code === 'Enter' && R.mode === 'solo') startSolo(R.track);
  });
  addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  for (const b of document.querySelectorAll('#touch button')) {
    const k = b.dataset.k;
    const down = (e) => { e.preventDefault(); if (k === 'respawn') respawn(); else { keys[k] = true; b.classList.add('on'); } };
    const up = () => { if (k !== 'respawn') { keys[k] = false; b.classList.remove('on'); } };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  function respawn() {
    if (!R.car || !R.started || R.car.finished || R.spectate) return;
    C.respawn(R.T, R.car);
    R.camSnap = true;
    Sfx.play('boing');
  }

  // ------------------------------------------------------------------ running a drive
  function begin(track, mode, goAt) {
    if (!setup3d()) return false;
    stopDrive();
    const ts = trackScene(track);
    for (const child of [...scene.children]) if (child.userData.track) scene.remove(child);
    ts.grp.userData.track = true;
    scene.add(ts.grp);
    ts.arches.forEach((a) => { a.mat.color.setHex(0xfacc15); a.mat.emissive.setHex(0xfacc15); });
    const th = THEMES[track.theme] || THEMES.summer;
    scene.background = new THREE.Color(th.sky);
    scene.fog = new THREE.Fog(th.fog, 320, 1800);
    R.clouds = ts.clouds;
    hemi.intensity = 0.75 * th.light; sun.intensity = 0.85 * th.light;
    Object.assign(R, { running: true, mode, track, T: ts.T, arches: ts.arches, car: C.newCar(ts.T), steer: 0, acc: 0, goAt, started: false,
      rec: [], recAt: 0, finishSent: false, spectate: false, lastCp: -1, camSnap: true, wasBoost: false });
    R.mesh = makeCar(new THREE.Color(Profile.get().color || '#ff4fd8'));
    R.shadow = shadowBlob();
    scene.add(R.mesh, R.shadow);
    // your best run in this track, as a see-through ghost car (solo only)
    const best = mode === 'solo' ? bestOf(track.id) : null;
    R.splitsBest = best && best.splits;
    R.ghost = mode === 'solo' ? store.get('poly_ghost_' + track.id, null) : null;
    if (R.ghost) { R.ghostMesh = makeCar(new THREE.Color('#ffffff'), true); scene.add(R.ghostMesh); }
    showScreen('drive');
    renderMedals();
    fill($('#center'));
    $('#drive-chat').classList.toggle('hidden', mode !== 'online');
    Engine.start();
    return true;
  }
  function stopDrive() {
    R.running = false;
    Engine.stop();
    if (scene) {
      for (const m of [R.mesh, R.shadow, R.ghostMesh, ...[...R.others.values()].map((o) => o.mesh)]) if (m) scene.remove(m);
    }
    R.mesh = null; R.ghostMesh = null; R.others.clear(); R.car = null;
  }

  let last = performance.now();
  const camPos = { x: 0, y: 0, z: 0 };
  let shownCount = null;
  function frame(t) {
    requestAnimationFrame(frame);
    tick(t);
  }
  function tick(t) {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (!R.running || !renderer) return;
    const c = R.car;
    // countdown
    if (!R.started) {
      const left = Math.ceil((R.goAt - t) / 1000);
      if (t >= R.goAt) {
        R.started = true;
        Sfx.play('go');
        fill($('#center'), h('div', { class: 'count' }, 'GO!'));
        setTimeout(() => { if (R.started && $('#center .count')) fill($('#center')); }, 700);
      } else if (left !== shownCount && left <= 3) {
        shownCount = left;
        fill($('#center'), h('div', { class: 'count' }, left));
        Sfx.play('tick');
      }
    } else shownCount = null;
    // drive
    const target = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    R.steer += (target - R.steer) * Math.min(1, dt * 9);
    if (R.started && c && !c.finished && !R.spectate) {
      const inp = { up: keys.up, down: keys.down, left: Math.max(0, -R.steer), right: Math.max(0, R.steer), drift: keys.drift };
      R.acc += dt;
      while (R.acc >= DT) {
        C.step(R.T, c, R.auto ? C.autopilot(R.T, c) : inp, DT);   // (R.auto: the test autopilot on localhost)
        R.acc -= DT;
        if (c.fell) { C.respawn(R.T, c); R.camSnap = true; Sfx.play('boing'); }
        if (c.cp !== R.lastCp) checkpoint();
        if (c.finished) { finished(); break; }
      }
      if (c.t - R.recAt >= 0.05) { R.recAt = c.t; R.rec.push([Math.round(c.t * 1000), +c.x.toFixed(1), +c.y.toFixed(2), +c.z.toFixed(1), +c.yaw.toFixed(3)]); }
      if (c.boostT > 0 && !R.wasBoost) Sfx.play('swoosh');
      R.wasBoost = c.boostT > 0;
    }
    // your car
    const v = c ? C.speed(c) : 0;
    if (c && R.mesh) {
      const s = R.T.S[c.idx];
      const along = Math.sin(c.yaw) * s.hx + Math.cos(c.yaw) * s.hz;
      const pitch = c.grounded ? -Math.atan(s.slope * along) : Math.max(-0.5, Math.min(0.5, -Math.atan2(c.vy, Math.max(5, Math.abs(v))) * 0.7));
      placeMesh(R.mesh, c.x, c.y, c.z, c.yaw, pitch, R.steer * Math.min(1, Math.abs(v) / 40) * 0.06);
      R.mesh.visible = !R.spectate;
      // a soft shadow on the road under the car (it fades the higher you fly)
      const dxs = c.x - s.x; const dzs = c.z - s.z;
      const lat = Math.abs(-s.hz * dxs + s.hx * dzs);
      const roadY = s.y + s.slope * (s.hx * dxs + s.hz * dzs);
      const above = c.y - roadY;
      R.shadow.visible = !R.spectate && !s.gap && lat < s.w + 0.5 && above > -0.5 && above < 14;
      if (R.shadow.visible) {
        R.shadow.position.set(c.x, roadY + 0.07, c.z);
        R.shadow.rotation.y = c.yaw;
        R.shadow.material.opacity = 0.55 * (1 - Math.max(0, above) / 14);
      }
    }
    // the ghost of your best run
    if (R.ghostMesh && R.ghost && c) {
      const g = ghostAt(R.ghost, c.t * 1000);
      R.ghostMesh.visible = !!g;
      if (g) placeMesh(R.ghostMesh, g[1], g[2], g[3], g[4]);
    }
    // other players
    const now = performance.now();
    let follow = null;
    for (const [id, o] of R.others) {
      const p = sampleOther(o, now - 120);
      if (!p) continue;
      placeMesh(o.mesh, p[1], p[2], p[3], p[4]);
      if (!follow || (o.p || 0) > (follow.o.p || 0)) follow = { o, p };
    }
    // camera: behind you (or the leader when you're watching)
    let cx; let cy; let cz; let cyaw; let cv;
    if (R.spectate && follow) [cx, cy, cz, cyaw, cv] = [follow.p[1], follow.p[2], follow.p[3], follow.p[4], 40];
    else if (c) [cx, cy, cz, cyaw, cv] = [c.x, c.y, c.z, c.yaw, Math.abs(v)];
    if (cx != null) {
      const fx = Math.sin(cyaw); const fz = Math.cos(cyaw);
      const back = 9.5 + Math.min(4, cv * 0.06); const up = 3.8 + Math.min(1.6, cv * 0.025);
      const tx = cx - fx * back; const ty = cy + up; const tz = cz - fz * back;
      const k = R.camSnap ? 1 : 1 - Math.exp(-dt * 7);
      R.camSnap = false;
      camPos.x += (tx - camPos.x) * k; camPos.y += (ty - camPos.y) * k; camPos.z += (tz - camPos.z) * k;
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(cx + fx * 5, cy + 1.6, cz + fz * 5);
      const fov = 66 + Math.min(20, cv * 0.28);
      if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    }
    Engine.set(v, R.started && c && !c.finished && !R.spectate && driving());
    // online: tell the others where you are ~10 times a second
    if (R.mode === 'online' && R.started && c && !R.spectate && !c.finished && now - R.sentAt > 100) {
      R.sentAt = now;
      Net.send('g:pos', { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), r: +c.yaw.toFixed(3), v: +v.toFixed(1), p: +(c.idx / R.T.finish).toFixed(3), cp: c.cp + 1 });
    }
    if (R.clouds) {
      R.clouds.position.x += dt * 3;
      if (R.clouds.position.x > 400) R.clouds.position.x = -400;
    }
    hud(v);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function ghostAt(gh, ms) {
    if (!gh.length || ms > gh[gh.length - 1][0]) return null;
    let lo = 0; let hi = gh.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (gh[mid][0] <= ms) lo = mid; else hi = mid; }
    const a = gh[lo]; const b = gh[hi];
    const k = Math.max(0, Math.min(1, (ms - a[0]) / Math.max(1, b[0] - a[0])));
    let dy = b[4] - a[4];
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    return [ms, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + dy * k];
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
        let dy = b[4] - a[4];
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return [t, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + dy * k];
      }
    }
    return s[0];
  }

  // ------------------------------------------------------------------ HUD
  let hudKey = '';
  function hud(v) {
    const c = R.car;
    const t = c ? (c.finished ? c.time : c.t) : 0;
    $('#time').textContent = R.spectate ? '👀 Watching' : fmt(t);
    $('#speed').firstChild.nodeValue = String(Math.round(Math.abs(v) * 3.6));
    const sub = c && !R.spectate ? `CP ${c.cp + 1}/${R.T.cps}${c.respawns ? ` · ↺ ${c.respawns}` : ''}${c.boostT > 0 ? ' · ⚡ BOOST' : ''}` : '';
    if ($('#sub').textContent !== sub) $('#sub').textContent = sub;
    const key = R.track ? R.track.medals.map((m) => (t > m ? 1 : 0)).join('') : '';
    if (key !== hudKey) { hudKey = key; renderMedals(); }
    if (R.mode === 'online') renderBoard();
  }
  function renderMedals() {
    if (!R.track) return;
    const t = R.car ? (R.car.finished ? R.car.time : R.car.t) : 0;
    const next = R.track.medals.findIndex((m) => t <= m);
    const best = R.mode === 'solo' && bestOf(R.track.id);
    fill($('#medals'), R.track.medals.map((m, i) => h('span', { class: i === next ? 'next' : t > m ? 'got' : '' }, `${MEDALS[i][0]} ${fmt(m).slice(0, -2)}`)),
      best ? h('span', {}, `⭐ ${fmt(best.ms / 1000)}`) : null);
  }
  function renderBoard() {
    if (!state.race) { fill($('#board')); return; }
    const rows = Object.entries(state.race.runners).map(([id, r]) => ({ id, ...r, p: id === Net.id && R.car ? (R.car.finished ? 1 : R.car.idx / R.T.finish) : r.p }));
    rows.sort((a, b) => (a.done !== b.done ? (a.done ? -1 : 1) : a.done ? a.place - b.place : b.p - a.p));
    const key = rows.map((r) => r.id + (r.done ? r.place : Math.round(r.p * 50))).join();
    if (renderBoard.key === key) return;
    renderBoard.key = key;
    fill($('#board'), rows.map((r, i) => {
      const p = (window.Room && Room.player(r.id)) || { name: '?', color: '#888' };
      return h('div', { class: r.id === Net.id ? 'me' : '' }, h('i', { style: { background: p.color } }), `${i + 1}. ${p.name}${r.done ? ' 🏁' : ''}`);
    }));
  }
  let splitTimer = null;
  function checkpoint() {
    const c = R.car;
    R.lastCp = c.cp;
    const arch = R.arches[c.cp];
    if (arch) { arch.mat.color.setHex(0x22c55e); arch.mat.emissive.setHex(0x22c55e); }
    Sfx.play('coin');
    const el = $('#split');
    const best = R.splitsBest && R.splitsBest[c.cp];
    if (best != null) {
      const d = c.t - best;
      el.textContent = `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`;
      el.className = 'pr-split on ' + (d < -0.005 ? 'good' : d > 0.005 ? 'bad' : 'even');
    } else {
      el.textContent = `CP ${c.cp + 1} · ${fmt(c.t)}`;
      el.className = 'pr-split on even';
    }
    clearTimeout(splitTimer);
    splitTimer = setTimeout(() => { el.className = 'pr-split'; }, 1500);
  }

  // ------------------------------------------------------------------ finishing
  function finished() {
    const c = R.car;
    Sfx.play('win');
    if (R.mode === 'solo') soloFinish(c);
    else if (!R.finishSent) {
      R.finishSent = true;
      Net.send('g:finish', { time: Math.round(c.time * 1000), respawns: c.respawns });
      fill($('#center'), h('div', { class: 'card' }, h('h2', {}, '🏁 Finished!'), h('div', { class: 'big' }, fmt(c.time)), h('p', { class: 'muted' }, 'Waiting for the others…')));
    }
  }
  function soloFinish(c) {
    const track = R.track;
    const ms = Math.round(c.time * 1000);
    const prev = bestOf(track.id);
    const better = !prev || ms < prev.ms;
    if (better) {
      store.set('poly_best_' + track.id, { ms, splits: c.splits });
      store.set('poly_ghost_' + track.id, R.rec);
    }
    const medal = medalFor(track, c.time);
    if (medal >= 0 && medal <= 1) UI.confetti(200);
    Account.submit(`poly-${track.id}`, ms);
    const next = C.TRACKS[C.TRACKS.indexOf(track) + 1];
    fill($('#center'), h('div', { class: 'card' },
      h('div', { class: 'medal' }, medal >= 0 ? MEDALS[medal][0] : '🏁'),
      h('h2', {}, medal >= 0 ? `${MEDALS[medal][1]} medal!` : 'Finished!'),
      h('div', { class: 'big' }, fmt(c.time)),
      h('p', { class: 'muted' }, prev ? (better ? `🎉 New best! ${fmt((prev.ms - ms) / 1000)} faster` : `Your best: ${fmt(prev.ms / 1000)}`) : 'First finish on this track!',
        c.respawns ? ` · ↺ ${c.respawns} respawn${c.respawns === 1 ? '' : 's'}` : ''),
      medal !== 0 ? h('p', { class: 'small muted' }, `Next: ${MEDALS[Math.max(0, (medal < 0 ? 4 : medal) - 1)][0]} ${fmt(track.medals[Math.max(0, (medal < 0 ? 4 : medal) - 1)])}`) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-pink', onclick: () => startSolo(track) }, '🔁 Again (Enter)'),
        next ? h('button', { class: 'btn btn-cyan', onclick: () => startSolo(next) }, `${next.emoji} Next track`) : null,
        h('button', { class: 'btn btn-ghost', onclick: () => { stopDrive(); showMenu(); } }, '🏁 Tracks'))));
  }

  // ------------------------------------------------------------------ solo: track menu
  function showMenu() {
    showScreen('menu');
    fill($('#menu'),
      h('div', { class: 'menu-head' }, h('div', { class: 'game-icon' }, '🏎️'), h('h1', { class: 'display' }, 'Time trial'),
        h('p', { class: 'muted' }, 'Pick a track, beat the medal times, and race your own ghost. Your best times go on the leaderboards!')),
      h('div', { class: 'tracks' }, C.TRACKS.map((t) => {
        const best = bestOf(t.id);
        const medal = best ? medalFor(t, best.ms / 1000) : -1;
        return h('button', { class: 'track-card', onclick: () => startSolo(t) },
          h('div', { class: 'tc-top' }, h('span', { class: 'tc-e' }, t.emoji), h('b', {}, t.name), h('span', { style: { marginLeft: 'auto', fontSize: '1.4rem' } }, medal >= 0 ? MEDALS[medal][0] : '')),
          h('div', { class: 'tc-best' }, best ? `Best: ${fmt(best.ms / 1000)}` : 'Not driven yet'),
          h('div', { class: 'tc-medals' }, t.medals.slice(1).map((m, i) => `${MEDALS[i + 1][0]} ${fmt(m).slice(0, -2)}`).join('  ')));
      })),
      h('div', { class: 'center', style: { marginTop: '16px', gap: '8px', flexWrap: 'wrap' } },
        h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); } }, '👥 Race friends online')));
    if (FX.list) FX.list($('#menu .tracks').children, { y: 24, stagger: 0.05, duration: 0.45, ease: 'back.out(1.5)' });
  }
  function startSolo(track) {
    if (begin(track, 'solo', performance.now() + 3000)) {
      const url = new URL(location.href); url.searchParams.set('solo', '1'); url.searchParams.set('track', track.id); history.replaceState(null, '', url);
    }
  }

  // ------------------------------------------------------------------ screens
  function showScreen(name) {
    for (const s of ['entry', 'room', 'menu', 'drive']) $('#' + s).classList.toggle('hidden', s !== name);
    if (name !== 'drive') { stopDrive(); fill($('#center')); }
    scrollTo({ top: 0 });
  }
  $('#btn-quit').addEventListener('click', () => {
    if (R.mode === 'online') { stopDrive(); showScreen('room'); renderRoomMain(); } else { stopDrive(); showMenu(); }
  });
  $('#btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });

  // ------------------------------------------------------------------ online
  function renderRoomMain() {
    const host = Room.isHost;
    const res = state.results;
    const kids = [];
    if (res && res.rows) {
      const tr = trackById(res.track);
      kids.push(h('div', { class: 'panel-title' }, `🏁 Results · ${tr.emoji} ${tr.name}`),
        h('div', { class: 'pr-results' }, res.rows.map((r, i) => h('div', { class: 'player-row' + (r.id === Net.id ? ' me' : '') },
          h('b', { style: { width: '26px' } }, r.done ? ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}` : '–'), UI.avatar(r, 'sm'),
          h('span', { class: 'grow' }, r.name), h('span', { class: 'pmeta' }, r.done ? fmt(r.time / 1000) : `${Math.round(r.p * 100)}%`)))),
        h('div', { style: { height: '14px' } }));
    }
    const sel = state.settings.track;
    kids.push(h('div', { class: 'panel-title' }, '🗺️ Track', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'tracks' },
        [...C.TRACKS, { id: 'random', name: 'Surprise me', emoji: '🎲' }].map((t) => h('button', {
          class: 'track-card' + (sel === t.id ? ' on' : ''), disabled: !host,
          onclick: () => { Net.send('g:settings', { track: t.id }); Sfx.play('click'); },
        }, h('div', { class: 'tc-top' }, h('span', { class: 'tc-e' }, t.emoji), h('b', {}, t.name)),
          t.medals ? h('div', { class: 'tc-medals' }, `🥇 ${fmt(t.medals[1]).slice(0, -2)}`) : h('div', { class: 'tc-medals' }, 'A random track')))),
      h('div', { style: { height: '14px' } }),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => Net.send('g:start') }, res ? '🔁 Race again' : '🏁 Start the race')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, 'Everyone drives the same track at the same time and sees the others as ghost cars. First to the finish wins!'));
    fill($('#room-main'), kids);
  }
  function startRace(race, countdown) {
    state.race = race;
    const track = trackById(race.track);
    const mine = race.runners[Net.id] && !race.runners[Net.id].done;
    if (!begin(track, 'online', performance.now() + countdown * 1000)) return;
    R.spectate = !mine;
    if (R.spectate) fill($('#center'), h('div', { class: 'card' }, h('h2', {}, '👀 Watching'), h('p', { class: 'muted' }, 'You’ll race in the next one!')));
    for (const id of Object.keys(race.runners)) if (id !== Net.id) addOther(id);
  }
  function addOther(id) {
    if (R.others.has(id) || !scene) return R.others.get(id);
    const p = (window.Room && Room.player(id)) || { name: '?', color: '#888888' };
    const mesh = makeCar(new THREE.Color(p.color || '#888888'), true);
    mesh.add(nameTag(p.name, p.color));
    scene.add(mesh);
    const o = { mesh, s: [], p: 0 };
    R.others.set(id, o);
    return o;
  }

  Lobby.init({
    game: 'poly',
    title: 'Poly Racer',
    emoji: '🏎️',
    tagline: 'Low-poly 3D racing! Ramps, jumps and boost pads. Race your friends or chase medals on your own.',
    solo: { label: '🏁 Time trial (solo)', onClick: () => showMenu() },
    howTo: '<b>How to play</b><ul><li>⬆️/W to drive, ⬇️/S to brake, ⬅️➡️/A D to steer, Space to drift.</li><li>Drive through every 🟨 checkpoint, then the 🏁 finish. Fell off? Press <b>R</b> to go back to the last checkpoint.</li><li>🟦 Boost pads make you faster. Hit 🟧 ramps fast or you won’t clear the gap!</li><li>Solo: beat the 🥉🥈🥇 medal times and your own ghost. Online: first to the finish wins.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (state.wins[p.id] ? h('span', { title: 'Wins' }, `🏆${state.wins[p.id]}`) : null) });
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#drive-chat'));

  Lobby.on('joined', (m) => {
    Object.assign(state, m.state);
    if (state.phase === 'racing' && state.race) startRace(state.race, Math.max(0, -state.race.elapsed));
    else { showScreen('room'); renderRoomMain(); }
  });
  Lobby.on('players', () => { if (!$('#room').classList.contains('hidden')) renderRoomMain(); });
  Lobby.on('left', () => { stopDrive(); });
  Lobby.on('entry', () => { for (const s of ['menu', 'room', 'drive']) $('#' + s).classList.add('hidden'); stopDrive(); });

  Net.on('g:settings', (m) => { state.settings = m.settings; if (!R.running) renderRoomMain(); });
  Net.on('g:start', (m) => { state.results = null; startRace(m.race, m.countdown); });
  Net.on('g:pos', (m) => {
    if (!R.running || R.mode !== 'online') return;
    const o = addOther(m.id);
    if (!o) return;
    o.s.push([performance.now(), m.x, m.y, m.z, m.r]);
    if (o.s.length > 10) o.s.shift();
    o.p = m.p;
    if (state.race && state.race.runners[m.id]) state.race.runners[m.id].p = m.p;
  });
  Net.on('g:finish', (m) => {
    if (state.race && state.race.runners[m.id]) Object.assign(state.race.runners[m.id], { done: true, place: m.place, time: m.time });
    const p = (window.Room && Room.player(m.id)) || { name: '?' };
    if (m.id === Net.id) {
      fill($('#center'), h('div', { class: 'card' }, h('h2', {}, m.place === 1 ? '🥇 You won!' : `🏁 ${m.place === 2 ? '2nd' : m.place === 3 ? '3rd' : m.place + 'th'} place`),
        h('div', { class: 'big' }, fmt(m.time / 1000)), h('p', { class: 'muted' }, 'Waiting for the others…')));
    } else UI.toast(`🏁 ${p.name} finished ${m.place === 1 ? 'first!' : `#${m.place}`}`, m.place === 1 ? 'good' : '', 2200);
  });
  Net.on('g:hurry', (m) => { if (R.running && R.car && !R.car.finished) UI.toast(`⏱️ Someone finished! ${m.seconds}s left to cross the line`, 'bad', 3500); });
  Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
  Net.on('g:results', (m) => {
    state.results = m.results;
    state.wins = m.wins || {};
    state.phase = 'results';
    const was = R.running && R.mode === 'online';
    const rows = m.results.rows;
    if (was) {
      fill($('#center'), h('div', { class: 'card' }, h('h2', {}, '🏁 Results'),
        h('div', { class: 'rows' }, rows.slice(0, 8).map((r) => h('div', {}, h('span', {}, r.done ? ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}` : '–'), h('span', { class: 'grow' }, r.name), h('b', {}, r.done ? fmt(r.time / 1000) : 'DNF'))))));
    }
    if (rows[0] && rows[0].id === Net.id && rows[0].done) UI.confetti(220);
    setTimeout(() => { if (state.phase === 'results') { showScreen('room'); renderRoomMain(); Lobby.refreshPlayers(); } }, was ? 4000 : 200);
  });

  if (location.hostname === 'localhost') {   // testing on your own computer only
    window.__poly = { R, C, keys, startSolo, trackById, tick,
      snap(w = 800, hh = 450) {     // draw one frame now and return it as a picture
        renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix();
        tick(performance.now());
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        c.getContext('2d').drawImage(renderer.domElement, 0, 0, w, hh);
        return c.toDataURL('image/jpeg', 0.82);
      } };
  }

  const qs = new URLSearchParams(location.search);
  if (qs.get('solo')) {
    $('#entry').classList.add('hidden');
    const t = qs.get('track') && trackById(+qs.get('track'));
    if (t && qs.get('track')) startSolo(t); else showMenu();
  }
})();
