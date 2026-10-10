/* Slope: roll a ball down an endless neon track. Steer, dodge the red blocks, don't fall off. */
(() => {
  'use strict';
  const { $, h, fill, UI, Sfx, store, Net, Account, Profile } = PA;
  const FX = PA.FX || {};
  UI.topbar({ title: 'Slope', emoji: '🛝' });
  Net.connect();

  const stage = $('#stage');
  const over = $('#over');
  if (!window.THREE) {
    fill(over, h('div', { class: 'sl-msg' }, 'Slope needs an internet connection to load its 3D engine. 😕'));
    return;
  }

  // ------------------------------------------------------------------ tuning
  const R = 0.5;            // ball radius
  const G = 34;             // gravity
  const DOWN = 0.16;        // how steep the track goes downhill
  const START_SPEED = 15;
  const MAX_SPEED = 46;
  const speedAt = (dist) => Math.min(MAX_SPEED, START_SPEED + dist * 0.011);
  const steerAt = (speed) => 7 + speed * 0.13;   // how fast you slide sideways
  const GREEN = 0x39ff88;

  // ------------------------------------------------------------------ three.js scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  scene.fog = new THREE.Fog(0x02030a, 35, 135);
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 500);
  scene.add(new THREE.AmbientLight(0x6688aa, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 400;
    starPos[i * 3 + 1] = Math.random() * 160 - 20;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 400;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x88ffcc, size: 0.7, fog: false }));
  scene.add(stars);

  // a green grid texture for the track
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = gridCanvas.height = 128;
  const gx = gridCanvas.getContext('2d');
  gx.fillStyle = '#04140a';
  gx.fillRect(0, 0, 128, 128);
  gx.strokeStyle = '#1fd06a';
  gx.lineWidth = 5;
  gx.strokeRect(0, 0, 128, 128);
  gx.lineWidth = 1.5;
  gx.strokeStyle = 'rgba(57,255,136,0.35)';
  gx.beginPath(); gx.moveTo(64, 0); gx.lineTo(64, 128); gx.moveTo(0, 64); gx.lineTo(128, 64); gx.stroke();
  const gridTex = new THREE.CanvasTexture(gridCanvas);
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.anisotropy = 4;

  const edgeMat = new THREE.LineBasicMaterial({ color: GREEN });
  const redEdge = new THREE.LineBasicMaterial({ color: 0xff5577 });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x4a0010, emissive: 0xff1144, emissiveIntensity: 0.55, roughness: 0.5 });

  const color = new THREE.Color(Profile.get().color || '#39ff88');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.35 }));
  const ballLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(R * 1.01, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  ball.add(ballLines);
  const glow = new THREE.PointLight(color, 1.2, 9);
  scene.add(ball, glow);

  // ------------------------------------------------------------------ the track
  // Forward is -z. Tiles are tilted slabs: from (z0, y0) to (z1, y1), centred on x, w wide.
  let tiles = [];
  let blocks = [];
  let gen = null;
  let rng = Math.random;

  function tileMesh(t) {
    const len = t.z0 - t.z1;
    const dy = t.y0 - t.y1;
    const geo = new THREE.BoxGeometry(t.w, 0.5, Math.hypot(len, dy));
    const tex = gridTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(t.w / 2, Math.hypot(len, dy) / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    mesh.position.set(t.x, (t.y0 + t.y1) / 2 - 0.25, (t.z0 + t.z1) / 2);
    mesh.rotation.x = -Math.atan2(dy, len);
    return mesh;
  }

  function addTile(len, w, x, down = DOWN) {
    const t = { x, w, z0: gen.z, z1: gen.z - len, y0: gen.y, y1: gen.y - len * down };
    t.mesh = tileMesh(t);
    scene.add(t.mesh);
    tiles.push(t);
    gen.z = t.z1;
    gen.y = t.y1;
    gen.x = x;
    return t;
  }

  function heightOn(t, z) {
    const k = (t.z0 - z) / (t.z0 - t.z1);
    return t.y0 + (t.y1 - t.y0) * k;
  }

  function addBlock(t, x, z, w, d, hgt, move) {
    const geo = new THREE.BoxGeometry(w, hgt, d);
    const mesh = new THREE.Mesh(geo, blockMat);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), redEdge));
    const y = heightOn(t, z);
    mesh.position.set(x, y + hgt / 2, z);
    mesh.rotation.x = -Math.atan2(t.y0 - t.y1, t.z0 - t.z1);
    scene.add(mesh);
    blocks.push({ x, z, w, d, hgt, y, mesh, move, cx: x });
  }

  const pick = (a) => a[Math.floor(rng() * a.length)];
  const between = (a, b) => a + rng() * (b - a);

  /** Add one piece of track. Harder pieces show up the further you get.
   *  Every gap between things you have to steer around is measured in time, not distance:
   *  the faster you roll, the more room you get, so every piece can always be passed. */
  function piece() {
    const dist = -gen.z;
    const hard = Math.min(1, dist / 2600);
    const sp = speedAt(dist + 60);
    // track needed to steer `side` units sideways (plus a moment to react)
    const room = (side, min) => Math.max(min, sp * (side / steerAt(sp) + 0.3));
    if (dist < 70) { addTile(70, 7, 0); return; }
    const kinds = ['straight', 'narrow', 'zigzag', 'gap', 'wall', 'slalom'];
    if (hard > 0.25) kinds.push('mover', 'gap', 'zigzag');
    if (hard > 0.5) kinds.push('narrowZig', 'mover');
    const kind = pick(kinds);
    const x0 = gen.x;
    if (kind === 'straight') {
      const lead = room(2, 6);
      const t = addTile(lead + between(14, 26), between(5, 7.5), x0);
      if (rng() < 0.5 + hard * 0.4) addBlock(t, t.x + between(-t.w / 3, t.w / 3), between(t.z1 + 4, t.z0 - lead), 1.6, 1.6, 1.4);
    } else if (kind === 'narrow') {
      addTile(between(18, 30) * (1 - hard * 0.3), 2.8 - hard * 0.6, x0);
    } else if (kind === 'zigzag' || kind === 'narrowZig') {
      const w = kind === 'narrowZig' ? 2.6 : 3.4;
      const shift = Math.min(w - 1.2, 1.4 + hard * 0.8);
      let x = x0;
      const n = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        x += (i % 2 ? -1 : 1) * shift * (rng() < 0.5 ? 1 : -1);
        x = Math.max(-6, Math.min(6, x));
        addTile(room(shift, 6), w, x);
      }
      addTile(room(3, 14), 6, x);
    } else if (kind === 'gap') {
      const w = 5.5;
      addTile(10, w, x0);
      const ramp = addTile(6, w, x0, -0.24);   // goes up
      // size the gap so the jump always clears it (land in the first half of the next tile)
      const vy = 0.24 * sp;
      const drop = between(2.5, 4.5);
      const air = (vy + Math.sqrt(vy * vy + 2 * G * drop)) / G;
      const gapLen = sp * air * between(0.45, 0.6);
      gen.z -= gapLen;
      gen.y = ramp.y1 - drop;
      addTile(Math.max(16, sp * 0.9), 7, x0 + between(-1, 1));
    } else if (kind === 'wall') {
      const holeW = 2.6 - hard * 0.5;
      const rows = 1 + (hard > 0.35 ? 1 : 0);
      const holes = [];
      for (let r = 0; r < rows; r++) holes.push(r ? Math.max(-2.4, Math.min(2.4, holes[r - 1] + between(-3, 3))) : between(-2.4, 2.4));
      const zs = [room(3.5, 8)];
      for (let r = 1; r < rows; r++) zs.push(zs[r - 1] + room(Math.abs(holes[r] - holes[r - 1]), 11));
      const t = addTile(zs[rows - 1] + room(3, 8), 7.5, x0);
      const left0 = t.x - t.w / 2;
      const right1 = t.x + t.w / 2;
      for (let r = 0; r < rows; r++) {
        const z = t.z0 - zs[r];
        const a = t.x + holes[r] - holeW / 2;
        const b = t.x + holes[r] + holeW / 2;
        if (a - left0 > 0.2) addBlock(t, (left0 + a) / 2, z, a - left0, 1.2, 1.6);
        if (right1 - b > 0.2) addBlock(t, (b + right1) / 2, z, right1 - b, 1.2, 1.6);
      }
    } else if (kind === 'slalom') {
      const lead = room(3, 6);
      const gap = room(2.6, 8.5);
      const t = addTile(lead + gap * 3 + room(3, 6), 6.5, x0);
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        addBlock(t, t.x + side * 1.4, t.z0 - lead - i * gap, 3.6, 1.2, 1.4);
      }
    } else if (kind === 'mover') {
      const lead = room(3.5, 10);
      const gap = room(3.5, 13);
      const t = addTile(lead + gap + room(3, 11), 7, x0);
      for (let i = 0; i < 2; i++) {
        addBlock(t, t.x, t.z0 - lead - i * gap, 2.2, 1.4, 1.4, { amp: t.w / 2 - 1.2, speed: 1.6 + hard * 1.6, phase: rng() * 6 });
      }
    }
  }

  function ensureTrack(zFront) {
    while (gen.z > zFront - 160) piece();
    // forget track that is far behind us
    const keepT = [];
    for (const t of tiles) {
      if (t.z1 > zFront + 30) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose(); } else keepT.push(t);
    }
    tiles = keepT;
    const keepB = [];
    for (const b of blocks) {
      if (b.z > zFront + 30) { scene.remove(b.mesh); b.mesh.geometry.dispose(); } else keepB.push(b);
    }
    blocks = keepB;
  }

  function tileUnder(x, z) {
    for (const t of tiles) if (z <= t.z0 && z > t.z1 && Math.abs(x - t.x) <= t.w / 2) return t;
    return null;
  }

  // ------------------------------------------------------------------ game state
  const S = { state: 'menu', x: 0, y: R, z: 0, vx: 0, vy: 0, speed: START_SPEED, ground: 0, score: 0, best: store.get('slope_best', 0), t: 0 };
  let input = 0;
  const keys = { left: false, right: false };
  let touchDir = 0;

  function reset() {
    for (const t of tiles) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose(); }
    for (const b of blocks) { scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    tiles = [];
    blocks = [];
    gen = { z: 8, y: 0, x: 0 };
    Object.assign(S, { x: 0, y: R + 1.3, z: 0, vx: 0, vy: 0, speed: START_SPEED, ground: 0, score: 0, t: 0 });
    ensureTrack(0);
    camera.position.set(0, 4, 8);
  }

  function start() {
    reset();
    S.state = 'play';
    over.style.display = 'none';
    Sfx.play('go');
  }

  function crash(why) {
    if (S.state !== 'play') return;
    S.state = 'dead';
    Sfx.play('boom');
    const score = S.score;
    const isBest = score > S.best;
    if (isBest) { S.best = score; store.set('slope_best', score); }
    $('#best').textContent = S.best;
    if (score > 0) Account.submit('slope', score);
    if (isBest && score > 20) UI.confetti(160);
    setTimeout(() => showMenu(why, score, isBest), 600);
  }

  function showMenu(why, score, isBest) {
    fill(over, h('div', {},
      h('h1', {}, why ? (isBest ? 'NEW BEST!' : 'GAME OVER') : 'SLOPE'),
      why ? h('p', {}, `${why} You rolled ${score.toLocaleString('en-US')}.`) : h('p', {}, 'Roll down the neon slope. Steer, dodge the red blocks, and don’t fall off!'),
      h('button', { class: 'btn btn-lime btn-lg', onclick: start }, why ? '🔁 Play again' : '▶ Play'),
      h('div', { class: 'sl-keys' }, '⬅️ ➡️ / A D to steer · on a phone, hold the left or right side · Space to start')));
    over.style.display = 'grid';
    if (FX.pop) FX.pop(over.firstChild, { from: 0.8 });
  }

  // ------------------------------------------------------------------ input
  addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keys.left = true; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keys.right = true; e.preventDefault(); }
    if ((e.code === 'Space' || e.code === 'Enter') && S.state !== 'play' && !e.repeat) { e.preventDefault(); start(); }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
  });
  addEventListener('blur', () => { keys.left = keys.right = false; touchDir = 0; });
  const pointerDir = (e) => { const r = stage.getBoundingClientRect(); return e.clientX - r.left < r.width / 2 ? -1 : 1; };
  stage.addEventListener('pointerdown', (e) => { if (S.state === 'play') { touchDir = pointerDir(e); stage.setPointerCapture(e.pointerId); } });
  stage.addEventListener('pointermove', (e) => { if (touchDir) touchDir = pointerDir(e); });
  const release = () => { touchDir = 0; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // ------------------------------------------------------------------ physics
  function update(dt) {
    S.t += dt;
    const dist = -S.z;
    S.speed = speedAt(dist);
    input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) || touchDir;
    S.vx += (input * steerAt(S.speed) - S.vx) * Math.min(1, dt * 9);
    S.x += S.vx * dt;
    S.z -= S.speed * dt;

    const t = tileUnder(S.x, S.z);
    if (t) {
      const gy = heightOn(t, S.z) + R;
      const slopeVy = ((t.y1 - t.y0) / (t.z0 - t.z1)) * S.speed;
      // land if we're at (or just passed through) the surface this frame; far below = fell off the side
      const reach = Math.max(0.7, Math.abs(S.vy) * dt * 1.5);
      if (S.y <= gy + 0.06 && S.y >= gy - reach) {
        S.y = gy;
        S.vy = slopeVy;
        S.ground = gy;
      } else {
        S.vy -= G * dt;
        S.y += S.vy * dt;
        if (S.y < gy && S.y >= gy - Math.max(0.7, Math.abs(S.vy) * dt * 1.5)) { S.y = gy; S.vy = slopeVy; S.ground = gy; Sfx.play('pop'); }
      }
    } else {
      S.vy -= G * dt;
      S.y += S.vy * dt;
    }
    if (S.y < S.ground - 12) { crash('You fell off the slope!'); return; }

    for (const b of blocks) {
      if (b.move) b.mesh.position.x = b.x = b.cx + Math.sin(S.t * b.move.speed + b.move.phase) * b.move.amp;
      if (Math.abs(S.z - b.z) < b.d / 2 + R * 0.8 && Math.abs(S.x - b.x) < b.w / 2 + R * 0.8 && S.y - R < b.y + b.hgt - 0.1) { crash('You hit a block!'); return; }
    }
    const sc = Math.floor(dist / 3);
    if (sc !== S.score) { S.score = sc; $('#score').textContent = sc.toLocaleString('en-US'); }
    ensureTrack(S.z);
  }

  // ------------------------------------------------------------------ loop
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (S.state === 'play') update(dt);
    else if (S.state === 'menu') { S.t += dt; S.z -= 6 * dt; ensureTrack(S.z); const t = tileUnder(0, S.z); if (t) S.y = heightOn(t, S.z) + R; }
    ball.position.set(S.x, S.y, S.z);
    ball.rotation.x -= (S.state === 'dead' ? 0 : S.speed) * dt / R;
    ball.rotation.z = -S.vx * 0.04;
    glow.position.set(S.x, S.y + 1, S.z);
    const k = Math.min(1, dt * 6);
    camera.position.x += (S.x * 0.75 - camera.position.x) * k;
    camera.position.y += (S.y + 3.3 - camera.position.y) * k;
    camera.position.z += (S.z + 7.5 - camera.position.z) * Math.min(1, dt * 12);
    camera.lookAt(S.x * 0.85, S.y + 0.3, S.z - 8);
    stars.position.set(camera.position.x, camera.position.y * 0.3, camera.position.z);
    renderer.render(scene, camera);
  }

  if (location.hostname === 'localhost') window.__slope = { S, update, start, keys, tiles: () => tiles, blocks: () => blocks, tileUnder, heightOn, seed: (n) => { rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648); } };   // testing on your own computer only
  $('#best').textContent = S.best.toLocaleString('en-US');
  reset();
  showMenu(null, 0, false);
  requestAnimationFrame(frame);
})();
