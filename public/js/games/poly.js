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
  const THEMES = {
    summer: { sky: 0x8fd3ff, fog: 0xc4e8ff, ground: 0x62c25c, deco: 'tree', light: 1 },
    desert: { sky: 0xffcf8a, fog: 0xffe0b5, ground: 0xe7c47d, deco: 'cactus', light: 1.05 },
    snow: { sky: 0xc6dcff, fog: 0xe4edff, ground: 0xf2f5fb, deco: 'pine', light: 1 },
    night: { sky: 0x0e0b2a, fog: 0x1b1745, ground: 0x231d55, deco: 'crystal', light: 0.6 },
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
    camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 1500);
    hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.75);
    sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(80, 140, 60);
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
    const pos = []; const cols = [];
    const tri = (a, b, c, k) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cols.push(k.r, k.g, k.b); };
    const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
    const at = (s, off, dy = 0) => [s.x - s.hz * off, s.y + dy, s.z + s.hx * off];
    const K = {
      road: col(0x3d4357), road2: col(0x373c4f), line: col(0xf8fafc), side: col(0x272b3a), out: col(0x2b2f40),
      boost: col(0x22d3ee), boost2: col(0x0e7490), kick: col(0xf59e0b), kick2: col(0xfde047), wallA: col(0xef4444), wallB: col(0xf8fafc),
      finish: col(0xffffff), finish2: col(0x111111),
    };
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i]; const b = S[i + 1];
      if (a.gap || b.gap) continue;
      const band = Math.floor(i / 3) % 2;
      let k = Math.floor(i / 6) % 2 ? K.road : K.road2;
      if (a.boost) k = band ? K.boost : K.boost2;
      else if (a.slope > 0.12 && b.slope > 0.12) k = band ? K.kick : K.kick2;
      else if (a.after) k = K.out;
      if (i >= T.finish - 2 && i < T.finish + 1) k = i % 2 ? K.finish : K.finish2;
      quad(at(a, -a.w), at(a, a.w), at(b, b.w), at(b, -b.w), k);
      // white edge lines and a dashed middle line
      quad(at(a, a.w - 0.75, 0.03), at(a, a.w - 0.3, 0.03), at(b, b.w - 0.3, 0.03), at(b, b.w - 0.75, 0.03), K.line);
      quad(at(a, -a.w + 0.3, 0.03), at(a, -a.w + 0.75, 0.03), at(b, -b.w + 0.75, 0.03), at(b, -b.w + 0.3, 0.03), K.line);
      if (Math.floor(i / 4) % 2 && !a.boost) quad(at(a, -0.15, 0.03), at(a, 0.15, 0.03), at(b, 0.15, 0.03), at(b, -0.15, 0.03), K.line);
      // the sides of the road slab
      quad(at(a, a.w), at(b, b.w), at(b, b.w, -1.3), at(a, a.w, -1.3), K.side);
      quad(at(a, -a.w), at(b, -b.w), at(b, -b.w, -1.3), at(a, -a.w, -1.3), K.side);
      quad(at(a, -a.w, -1.3), at(a, a.w, -1.3), at(b, b.w, -1.3), at(b, -b.w, -1.3), K.side);
      if (a.walls && b.walls) {
        const kw = band ? K.wallA : K.wallB;
        quad(at(a, a.w + 0.2), at(b, b.w + 0.2), at(b, b.w + 0.2, 1.1), at(a, a.w + 0.2, 1.1), kw);
        quad(at(a, -a.w - 0.2), at(b, -b.w - 0.2), at(b, -b.w - 0.2, 1.1), at(a, -a.w - 0.2, 1.1), kw);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    grp.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));

    // pillars holding the road up
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x8b8fa8 });
    for (let i = 6; i < S.length; i += 14) {
      const s = S[i];
      if (s.gap || s.after) continue;
      const hgt = s.y - 1.3 - GROUND;
      if (hgt < 1) continue;
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, hgt, 1.4), pillarMat);
      p.position.set(s.x, GROUND + hgt / 2, s.z);
      grp.add(p);
    }

    // checkpoint arches and the finish line
    const arches = [];
    const arch = (s, color, banner) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 });
      const w = s.w + 0.9;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6, 0.7), mat);
        post.position.set(side * w, 3, 0);
        g.add(post);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.7, 0.9, 0.7), mat);
      bar.position.y = 6;
      g.add(bar);
      if (banner) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 32;
        const x = c.getContext('2d');
        for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 8, j * 8, 8, 8); }
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
        flag.position.y = 5;
        g.add(flag);
      }
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = Math.atan2(s.hx, s.hz);
      grp.add(g);
      return { g, mat };
    };
    S.forEach((s) => { if (s.cp >= 0) arches[s.cp] = arch(s, 0xfacc15); });
    arch(S[T.finish], 0xffffff, true);
    arch(S[0], 0x22d3ee);

    // the ground and scenery
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const th = THEMES[track.theme] || THEMES.summer;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 1400, z1 - z0 + 1400), new THREE.MeshLambertMaterial({ color: th.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, GROUND, (z0 + z1) / 2);
    grp.add(ground);
    let seed = track.id * 9973;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spots = [];
    for (let k = 0; k < 900 && spots.length < 170; k++) {
      const x = x0 - 160 + rnd() * (x1 - x0 + 320); const z = z0 - 160 + rnd() * (z1 - z0 + 320);
      let near = false;
      for (let i = 0; i < S.length; i += 3) { const s = S[i]; if ((s.x - x) ** 2 + (s.z - z) ** 2 < (s.w + 14) ** 2) { near = true; break; } }
      if (!near) spots.push([x, z, 0.7 + rnd() * 1.1, rnd() * Math.PI]);
    }
    const parts = {
      tree: [[new THREE.CylinderGeometry(0.5, 0.6, 3, 5), 0x8b5a2b, 1.5], [new THREE.ConeGeometry(2.6, 6, 6), 0x2f9e44, 5.5]],
      pine: [[new THREE.CylinderGeometry(0.4, 0.5, 2.4, 5), 0x6b4423, 1.2], [new THREE.ConeGeometry(2.4, 7, 6), 0x1f6f43, 5.5], [new THREE.ConeGeometry(1.2, 2.4, 6), 0xffffff, 8.2]],
      cactus: [[new THREE.CylinderGeometry(0.7, 0.8, 6, 6), 0x3f9b4a, 3], [new THREE.BoxGeometry(2.6, 0.7, 0.7), 0x3f9b4a, 3.6]],
      crystal: [[new THREE.OctahedronGeometry(2.2, 0), 0xa855f7, 2.2], [new THREE.OctahedronGeometry(1.1, 0), 0x22d3ee, 4.6]],
    }[th.deco];
    const m4 = new THREE.Matrix4();
    for (const [g, color, dy] of parts) {
      const mat = new THREE.MeshLambertMaterial({ color, emissive: th.deco === 'crystal' ? color : 0x000000, emissiveIntensity: th.deco === 'crystal' ? 0.45 : 0, flatShading: true });
      const inst = new THREE.InstancedMesh(g, mat, spots.length);
      spots.forEach(([x, z, sc, rot], i) => {
        m4.makeRotationY(rot);
        m4.scale(new THREE.Vector3(sc, sc, sc));
        m4.setPosition(x, GROUND + dy * sc, z);
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      grp.add(inst);
    }
    const out = { T, grp, arches };
    built.set(track.id, out);
    return out;
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
    scene.fog = new THREE.Fog(th.fog, 160, 620);
    hemi.intensity = 0.75 * th.light; sun.intensity = 0.85 * th.light;
    Object.assign(R, { running: true, mode, track, T: ts.T, arches: ts.arches, car: C.newCar(ts.T), steer: 0, acc: 0, goAt, started: false,
      rec: [], recAt: 0, finishSent: false, spectate: false, lastCp: -1, camSnap: true, wasBoost: false });
    R.mesh = makeCar(new THREE.Color(Profile.get().color || '#ff4fd8'));
    scene.add(R.mesh);
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
      for (const m of [R.mesh, R.ghostMesh, ...[...R.others.values()].map((o) => o.mesh)]) if (m) scene.remove(m);
    }
    R.mesh = null; R.ghostMesh = null; R.others.clear(); R.car = null;
  }

  let last = performance.now();
  const camPos = { x: 0, y: 0, z: 0 };
  let shownCount = null;
  function frame(t) {
    requestAnimationFrame(frame);
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

  if (location.hostname === 'localhost') window.__poly = { R, C, keys, startSolo, trackById };   // testing on your own computer only

  const qs = new URLSearchParams(location.search);
  if (qs.get('solo')) {
    $('#entry').classList.add('hidden');
    const t = qs.get('track') && trackById(+qs.get('track'));
    if (t && qs.get('track')) startSolo(t); else showMenu();
  }
})();
