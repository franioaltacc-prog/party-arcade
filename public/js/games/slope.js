/* Slope: roll a ball down an endless neon track. Steer, dodge the red blocks, don't fall off.
   Speed-up pads give you a burst of speed and launch ramps send you flying. */
(() => {
  'use strict';
  const { $, h, fill, UI, Sfx, store, Net, Account, Profile, on: onBus } = PA;
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
  const KICK = 0.6;         // how steep a launch ramp goes up
  const START_SPEED = 14;
  const MAX_SPEED = 40;
  const speedAt = (dist) => Math.min(MAX_SPEED, START_SPEED + dist * 0.008);
  const steerAt = (speed) => 8 + speed * 0.14;   // how fast you slide sideways
  const BOOST = 11;         // extra speed from a speed-up pad...
  const BOOST_TIME = 2.6;   // ...for this many seconds (the last part fades out)
  const EDGE = 0.2;         // the ball can hang this far over an edge before it falls
  const GREEN = 0x39ff88;
  const boostNow = () => BOOST * Math.min(1, Math.max(0, S.boostT) / 1.2);

  // ------------------------------------------------------------------ three.js scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  scene.fog = new THREE.Fog(0x02030a, 35, 135);
  const BASE_FOV = 68;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.1, 500);
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

  /** A square grid texture for the track (green) or launch ramps (orange, with arrows). */
  function gridTexture(bg, line, faint, arrows) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line;
    g.lineWidth = 5;
    g.strokeRect(0, 0, 128, 128);
    g.lineWidth = 1.5;
    g.strokeStyle = faint;
    g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    if (arrows) {
      g.strokeStyle = line;
      g.lineWidth = 9;
      g.lineJoin = 'round';
      g.beginPath(); g.moveTo(34, 84); g.lineTo(64, 50); g.lineTo(94, 84); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }
  const gridTex = gridTexture('#04140a', '#1fd06a', 'rgba(57,255,136,0.35)', false);
  const kickTex = gridTexture('#1c0d00', '#ffb020', 'rgba(255,176,32,0.35)', true);

  // speed-up pads: bright glowing arrows that slide forward
  const padCanvas = document.createElement('canvas');
  padCanvas.width = 128; padCanvas.height = 256;
  const pg = padCanvas.getContext('2d');
  pg.fillStyle = 'rgba(0, 200, 255, 0.45)';
  pg.fillRect(0, 0, 128, 256);
  pg.lineJoin = 'round';
  pg.lineCap = 'round';
  for (const y of [92, 220]) {
    pg.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    pg.lineWidth = 34;
    pg.beginPath(); pg.moveTo(20, y); pg.lineTo(64, y - 52); pg.lineTo(108, y); pg.stroke();
    pg.strokeStyle = '#e8feff';
    pg.lineWidth = 16;
    pg.beginPath(); pg.moveTo(20, y); pg.lineTo(64, y - 52); pg.lineTo(108, y); pg.stroke();
  }
  const padTex = new THREE.CanvasTexture(padCanvas);
  padTex.wrapS = padTex.wrapT = THREE.RepeatWrapping;
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  const edgeMat = new THREE.LineBasicMaterial({ color: GREEN });
  const kickEdge = new THREE.LineBasicMaterial({ color: 0xffb020 });
  const padEdge = new THREE.LineBasicMaterial({ color: 0x7df9ff });
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
  let pads = [];
  let padCount = 0;
  let gen = null;
  let rng = Math.random;

  function tileMesh(t) {
    const len = t.z0 - t.z1;
    const dy = t.y0 - t.y1;
    const geo = new THREE.BoxGeometry(t.w, 0.5, Math.hypot(len, dy));
    const tex = (t.kick ? kickTex : gridTex).clone();
    tex.needsUpdate = true;
    tex.repeat.set(t.w / 2, Math.hypot(len, dy) / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), t.kick ? kickEdge : edgeMat));
    mesh.position.set(t.x, (t.y0 + t.y1) / 2 - 0.25, (t.z0 + t.z1) / 2);
    mesh.rotation.x = -Math.atan2(dy, len);
    return mesh;
  }

  function addTile(len, w, x, down = DOWN) {
    const t = { x, w, z0: gen.z, z1: gen.z - len, y0: gen.y, y1: gen.y - len * down, kick: down < 0 };
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

  /** A speed-up pad lying on tile t, centred at (x, z). */
  function addPad(t, x, z, w = 2.6, len = 4) {
    const geo = new THREE.PlaneGeometry(w, len);
    const mesh = new THREE.Mesh(geo, padMat);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), padEdge));
    mesh.rotation.x = -Math.PI / 2 - Math.atan2(t.y0 - t.y1, t.z0 - t.z1);
    mesh.position.set(x, heightOn(t, z) + 0.03, z);
    scene.add(mesh);
    pads.push({ id: ++padCount, x, w, z0: z + len / 2, z1: z - len / 2, mesh });
  }

  const pick = (a) => a[Math.floor(rng() * a.length)];
  const between = (a, b) => a + rng() * (b - a);

  /** How far the ball flies off a ramp that goes up `slope` at `speed`, landing `drop` lower. */
  function jumpLength(speed, slope, drop) {
    const vy = slope * speed;
    return (speed * (vy + Math.sqrt(vy * vy + 2 * G * drop))) / G;
  }
  /** Where the ball lands on a downhill tile that starts `gap` after the ramp and `drop` lower. */
  function landAt(speed, slope, drop, gap) {
    const a = G / (2 * speed * speed);
    const b = slope + DOWN;
    return (b + Math.sqrt(Math.max(0, b * b + 4 * a * (drop - DOWN * gap)))) / (2 * a);
  }
  /** How high the ball's bottom is above a normal downhill tile, `d` after leaving a ramp. */
  function clearance(speed, slope, d) {
    const t = d / speed;
    return slope * speed * t - (G * t * t) / 2 + DOWN * d;
  }

  /** Add one piece of track. Harder pieces show up the further you get.
   *  Every gap between things you have to steer around is measured in time, not distance,
   *  using the fastest you could be going (with a speed-up), so every piece can always be passed. */
  function piece() {
    const dist = -gen.z;
    const hard = Math.min(1, dist / 3600);
    const slow = speedAt(dist);                  // the slowest you can be here
    const sp = speedAt(dist + 90) + BOOST;       // the fastest you can be here
    // track needed to steer `side` units sideways (plus a moment to react)
    const room = (side, min) => Math.max(min, sp * (side / steerAt(sp) + 0.35));
    if (dist < 70) { addTile(70, 7, 0); return; }
    const kinds = ['straight', 'narrow', 'zigzag', 'gap', 'wall', 'slalom', 'boost', 'ramp', 'rampWall'];
    if (hard > 0.25) kinds.push('mover', 'gap', 'zigzag', 'ramp');
    if (hard > 0.5) kinds.push('narrowZig', 'mover');
    const kind = pick(kinds);
    const x0 = gen.x;
    if (kind === 'straight') {
      const lead = room(2, 6);
      const t = addTile(lead + between(14, 26), between(5.5, 7.5), x0);
      if (rng() < 0.4 + hard * 0.4) addBlock(t, t.x + between(-t.w / 3, t.w / 3), between(t.z1 + 4, t.z0 - lead), 1.6, 1.6, 1.4);
      else if (rng() < 0.35) addPad(t, t.x + between(-1.2, 1.2), t.z0 - lead - 2);
    } else if (kind === 'boost') {
      // a wide straight with a speed-up pad (or two side by side), then room to get used to the speed
      const t = addTile(room(3, 10) + 6 + room(3, 14), 7.5, x0);
      const z = t.z0 - room(3, 10) - 2;
      if (rng() < 0.5) addPad(t, t.x, z);
      else { addPad(t, t.x - 1.9, z); addPad(t, t.x + 1.9, z); }
    } else if (kind === 'narrow') {
      addTile(between(18, 30) * (1 - hard * 0.3), 3.2 - hard * 0.6, x0);
    } else if (kind === 'zigzag' || kind === 'narrowZig') {
      const w = kind === 'narrowZig' ? 2.8 : 3.6;
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
      const ramp = addTile(6, w, x0, -0.24);   // goes up a little
      // size the gap so even the slowest jump clears it, and the landing is long enough for the fastest
      const drop = between(2.5, 4.5);
      const gapLen = jumpLength(slow, 0.24, drop) * between(0.45, 0.6);
      gen.z -= gapLen;
      gen.y = ramp.y1 - drop;
      addTile(Math.max(16, landAt(sp, 0.24, drop, gapLen) - gapLen + room(3, 8)), 7, x0 + between(-1, 1));
    } else if (kind === 'ramp' || kind === 'rampWall') {
      // a big orange launch ramp. Line up on the runway (maybe grab a speed-up first), then fly!
      // The ramp gets less steep when you're fast, so you get about a second of air, not five.
      const w = 6;
      const k = Math.max(0.3, Math.min(KICK, 12 / sp));
      const run = addTile(room(3, 12) + 4, w, x0);
      if (rng() < 0.45) addPad(run, x0, run.z1 + 4);
      const kick = addTile(5, w, x0, -k);
      if (kind === 'ramp') {
        // over a gap
        const drop = between(1, 3);
        const gapLen = jumpLength(slow, k, drop) * between(0.5, 0.65);
        gen.z -= gapLen;
        gen.y = kick.y1 - drop;
        addTile(Math.max(18, landAt(sp, k, drop, gapLen) - gapLen + room(3, 8)), 7.5, x0 + between(-1, 1));
      } else {
        // over a row of red blocks right after the ramp (even the slowest jump clears them)
        const land = addTile(Math.max(24, landAt(sp, k, 0, 0) + room(3, 8)), 7.5, x0);
        const hgt = 0.9;
        const rows = [];
        for (let d = 1.5; d < 12; d += 1.2) if (clearance(slow, k, d - 0.8) > hgt + 0.3 && clearance(slow, k, d + 0.8) > hgt + 0.3) rows.push(d);
        for (const d of rows.slice(0, 3)) addBlock(land, land.x, land.z0 - d, land.w, 0.8, hgt);
      }
    } else if (kind === 'wall') {
      const holeW = 3.0 - hard * 0.5;
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
        addBlock(t, t.x + side * 1.5, t.z0 - lead - i * gap, 3.2, 1.2, 1.4);
      }
    } else if (kind === 'mover') {
      const lead = room(3.5, 10);
      const gap = room(3.5, 13);
      const t = addTile(lead + gap + room(3, 11), 7, x0);
      for (let i = 0; i < 2; i++) {
        addBlock(t, t.x, t.z0 - lead - i * gap, 2.2, 1.4, 1.4, { amp: t.w / 2 - 1.2, speed: 1.4 + hard * 1.4, phase: rng() * 6 });
      }
    }
  }

  function ensureTrack(zFront) {
    while (gen.z > zFront - 170) piece();
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
    const keepP = [];
    for (const p of pads) {
      if (p.z1 > zFront + 30) { scene.remove(p.mesh); p.mesh.geometry.dispose(); } else keepP.push(p);
    }
    pads = keepP;
  }

  function tileUnder(x, z) {
    for (const t of tiles) if (z <= t.z0 && z > t.z1 && Math.abs(x - t.x) <= t.w / 2 + EDGE) return t;
    return null;
  }

  // ------------------------------------------------------------------ music
  // A fast synth track made live in the browser (no music files). It builds up like a real
  // song: drums and bass, then claps, chords and an arpeggio, then the lead tune drops in.
  // Going fast or hitting a speed-up turns everything up.
  const Music = (() => {
    const BPM = 150;
    const STEP = 60 / BPM / 4;   // one 16th note
    // A minor: Am - F - C - G, one chord per bar ([bass note, chord notes])
    const CHORDS = [[45, [69, 72, 76]], [41, [65, 69, 72]], [48, [67, 72, 76]], [43, [67, 71, 74]]];
    // the lead tune: [step, note, length in steps] for each bar
    const TUNE = [
      [[0, 76, 2], [3, 79, 1], [4, 81, 2], [6, 79, 2], [8, 76, 3], [11, 74, 1], [12, 72, 2], [14, 74, 2]],
      [[0, 72, 2], [3, 74, 1], [4, 76, 2], [6, 77, 2], [8, 76, 3], [11, 74, 1], [12, 72, 4]],
      [[0, 79, 2], [3, 76, 1], [4, 79, 2], [6, 81, 2], [8, 84, 3], [11, 83, 1], [12, 79, 4]],
      [[0, 79, 2], [2, 81, 2], [4, 83, 2], [6, 86, 2], [8, 83, 2], [10, 79, 2], [12, 81, 4]],
    ];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let enabled = store.get('slope_music', true);
    let timer = null;
    let bus = null;
    let pump = null;    // ducks the bass and chords on every kick (that "pumping" dance sound)
    let echo = null;
    let noiseBuf = null;
    let nextTime = 0;
    let stepN = 0;
    let c = null;

    function osc(type, freq, t, dur, vol, out, cutoff, detune = 0) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.setValueAtTime(vol, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4; o.connect(f); node = f; }
      node.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    function noise(t, dur, vol, type, freq, out = bus) {
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(out);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.02);
    }
    function kick(t) {
      const o = c.createOscillator(); const g = c.createGain();
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.26);
      pump.gain.setValueAtTime(0.25, t);
      pump.gain.linearRampToValueAtTime(1, t + STEP * 2.6);
    }
    function clap(t) {
      noise(t, 0.16, 0.42, 'bandpass', 1400);
      noise(t + 0.012, 0.1, 0.25, 'bandpass', 2600);
      osc('triangle', 185, t, 0.07, 0.12, bus);
    }
    function riser(t, dur) {   // a whooshing build-up
      const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.3, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dur + 0.1);
    }

    /** How busy the music is right now: 0 = intro ... 3 = everything. */
    function level(bar) {
      if (S.boostT > 0 || S.speed > 27) return 3;
      return bar < 4 ? 0 : bar < 8 ? 1 : 2;
    }

    function schedule() {
      if (c.currentTime - nextTime > 0.2) nextTime = c.currentTime + 0.05;   // the tab was asleep: skip, don't pile up
      while (nextTime < c.currentTime + 0.12) {
        const t = nextTime;
        const bar = Math.floor(stepN / 16);
        const s = stepN % 16;
        const [root, chord] = CHORDS[bar % 4];
        const lv = level(bar);
        // drums
        if (s % 4 === 0) kick(t);
        if (s === 0 && (bar === 8 || (bar > 8 && bar % 8 === 0))) noise(t, 1.4, 0.2, 'highpass', 5000);   // crash cymbal
        if (lv >= 1 && (s === 4 || s === 12)) clap(t);
        if (s % 4 === 2) noise(t, 0.09, 0.16, 'highpass', 7500);                  // open hat on the off-beat
        if (lv >= 3 && s % 2 === 1) noise(t, 0.03, 0.07, 'highpass', 9000);       // fast hats
        if (bar === 7 && s === 0) riser(t, STEP * 16);                           // build-up before the tune drops
        // bass: pumping off-beats, rolling 16ths when it's flat out
        const cutoff = 500 + lv * 350;
        if (s % 4 === 2 || (lv >= 2 && s % 4 === 3) || (lv >= 3 && s % 4 === 1)) osc('sawtooth', mtof(root), t, STEP * 0.9, 0.2, pump, cutoff);
        // chords and arpeggio
        if (lv >= 1 && s === 0) for (const n of chord) for (const d of [-9, 9]) osc('sawtooth', mtof(n - 12), t, STEP * 15, 0.022, pump, 1600, d);
        if (lv >= 1) osc('square', mtof(chord[[0, 1, 2, 1][s % 4]] + (s >= 8 && lv >= 2 ? 12 : 0)), t, STEP * 0.8, 0.035, bus, 2400 + lv * 800);
        // the lead tune (with a little echo)
        if (lv >= 2) {
          for (const [st, n, len] of TUNE[bar % 4]) {
            if (st !== s) continue;
            for (const d of [-7, 7]) osc('sawtooth', mtof(n), t, STEP * len * 0.95, 0.045, echo, 3800, d);
            osc('square', mtof(n - 12), t, STEP * len * 0.95, 0.025, echo, 2000);
          }
        }
        nextTime += STEP;
        stepN++;
      }
    }

    return {
      get enabled() { return enabled; },
      get playing() { return !!timer; },
      toggle() { enabled = !enabled; store.set('slope_music', enabled); if (!enabled) this.stop(); else if (S.state === 'play') this.start(); return enabled; },
      start() {
        if (timer || !enabled || Sfx.muted) return;
        c = Sfx.ac();
        if (!c) return;
        if (!noiseBuf) {
          noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        bus = c.createGain(); bus.gain.value = 0.42; bus.connect(Sfx.master);
        pump = c.createGain(); pump.connect(bus);
        // lead echo: dry + a delayed copy that repeats a few times
        echo = c.createGain(); echo.connect(bus);
        const delay = c.createDelay(1); delay.delayTime.value = STEP * 3;
        const fb = c.createGain(); fb.gain.value = 0.3;
        echo.connect(delay); delay.connect(fb).connect(delay); delay.connect(bus);
        nextTime = c.currentTime + 0.06;
        stepN = 0;
        timer = setInterval(schedule, 25);
        schedule();
      },
      stop() {
        clearInterval(timer);
        timer = null;
        if (bus) { const b = bus; b.gain.setTargetAtTime(0, c.currentTime, 0.08); setTimeout(() => b.disconnect(), 600); bus = null; }
      },
      boost() {   // a whoosh when you hit a speed-up
        if (timer) riser(c.currentTime, 0.45);
      },
    };
  })();
  onBus('muted', (m) => { if (m) Music.stop(); else if (S.state === 'play') Music.start(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Music.stop(); else if (S.state === 'play') Music.start(); });

  // ------------------------------------------------------------------ game state
  const S = { state: 'menu', x: 0, y: R, z: 0, vx: 0, vy: 0, speed: START_SPEED, ground: 0, score: 0, best: store.get('slope_best', 0), t: 0, boostT: 0, pad: -1, air: 0 };
  let input = 0;
  const keys = { left: false, right: false };
  let touchDir = 0;

  function reset() {
    for (const t of tiles) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.map.dispose(); t.mesh.material.dispose(); }
    for (const b of blocks) { scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    for (const p of pads) { scene.remove(p.mesh); p.mesh.geometry.dispose(); }
    tiles = [];
    blocks = [];
    pads = [];
    gen = { z: 8, y: 0, x: 0 };
    Object.assign(S, { x: 0, y: R + 1.3, z: 0, vx: 0, vy: 0, speed: START_SPEED, ground: 0, score: 0, t: 0, boostT: 0, pad: -1, air: 0 });
    ensureTrack(0);
    camera.position.set(0, 4, 8);
  }

  function start() {
    reset();
    S.state = 'play';
    over.style.display = 'none';
    Sfx.play('go');
    Music.start();
  }

  function crash(why) {
    if (S.state !== 'play') return;
    S.state = 'dead';
    Music.stop();
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
      why ? h('p', {}, `${why} You rolled ${score.toLocaleString('en-US')}.`) : h('p', {}, 'Roll down the neon slope. Steer, dodge the red blocks, and don’t fall off! Blue arrows speed you up, orange ramps launch you.'),
      h('button', { class: 'btn btn-lime btn-lg', onclick: start }, why ? '🔁 Play again' : '▶ Play'),
      h('div', { class: 'sl-keys' }, '⬅️ ➡️ / A D to steer · on a phone, hold the left or right side · Space to start')));
    over.style.display = 'grid';
    if (FX.pop) FX.pop(over.firstChild, { from: 0.8 });
  }

  /** The "SPEED UP!" flash. */
  function flashBoost() {
    const el = $('#boost');
    el.classList.remove('on');
    void el.offsetWidth;   // restart the animation
    el.classList.add('on');
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
  stage.addEventListener('pointerdown', (e) => { if (S.state === 'play' && !e.target.closest('button')) { touchDir = pointerDir(e); stage.setPointerCapture(e.pointerId); } });
  stage.addEventListener('pointermove', (e) => { if (touchDir) touchDir = pointerDir(e); });
  const release = () => { touchDir = 0; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  const musicBtn = $('#btn-music');
  musicBtn.style.opacity = Music.enabled ? 1 : 0.4;
  musicBtn.addEventListener('click', (e) => { e.stopPropagation(); musicBtn.style.opacity = Music.toggle() ? 1 : 0.4; musicBtn.blur(); });

  // ------------------------------------------------------------------ physics
  function update(dt) {
    S.t += dt;
    const dist = -S.z;
    S.boostT = Math.max(0, S.boostT - dt);
    S.speed = speedAt(dist) + boostNow();
    input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) || touchDir;
    S.vx += (input * steerAt(S.speed) - S.vx) * Math.min(1, dt * 9);
    S.x += S.vx * dt;
    S.z -= S.speed * dt;

    const t = tileUnder(S.x, S.z);
    if (t) {
      const gy = heightOn(t, S.z) + R;
      const slopeVy = ((t.y1 - t.y0) / (t.z0 - t.z1)) * S.speed;
      // Stick to the surface if we're on it (or just passed through it this frame). Compare where
      // we're about to be, not where we were: the track drops away under us every frame, and at
      // high speed that looked like leaving the ground (and landing, with a "pop") 60 times a second.
      // Moving up faster than the surface (off the top of a ramp) means we're flying, so don't stick.
      const reach = Math.max(0.7, (Math.abs(S.vy) + Math.abs(slopeVy)) * dt * 1.5);
      const yNext = S.y + S.vy * dt;
      let landed = false;
      if (S.vy <= slopeVy + 0.5 && yNext <= gy + 0.06 && yNext >= gy - reach) landed = true;
      else {
        S.vy -= G * dt;
        S.y += S.vy * dt;
        S.air += dt;
        landed = S.vy <= slopeVy && S.y < gy && S.y >= gy - Math.max(0.7, Math.abs(S.vy) * dt * 1.5);
      }
      if (landed) {
        if (S.air > 0.12) Sfx.play('pop');   // only a real landing makes a sound
        S.y = gy;
        S.vy = slopeVy;
        S.ground = gy;
        S.air = 0;
      }
      // speed-up pads
      if (S.y - gy < 0.3) {
        for (const p of pads) {
          if (S.z <= p.z0 && S.z >= p.z1 && Math.abs(S.x - p.x) < p.w / 2 + R * 0.4) {
            S.boostT = BOOST_TIME;
            if (S.pad !== p.id) { S.pad = p.id; Sfx.play('swoosh'); Music.boost(); flashBoost(); }
          }
        }
      }
    } else {
      S.vy -= G * dt;
      S.y += S.vy * dt;
      S.air += dt;
    }
    // fell: well below the track we're over, or (beside the track) far below where we last rolled
    if (t ? S.y < heightOn(t, S.z) + R - 3 : S.y < S.ground - 12) { crash('You fell off the slope!'); return; }

    for (const b of blocks) {
      if (b.move) b.mesh.position.x = b.x = b.cx + Math.sin(S.t * b.move.speed + b.move.phase) * b.move.amp;
      if (Math.abs(S.z - b.z) < b.d / 2 + R * 0.7 && Math.abs(S.x - b.x) < b.w / 2 + R * 0.7 && S.y - R < b.y + b.hgt - 0.1) { crash('You hit a block!'); return; }
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
    // speed-ups: the camera widens and the ball glows brighter
    const rush = S.state === 'play' ? boostNow() / BOOST : 0;
    const fov = BASE_FOV + rush * 16;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
    glow.intensity = 1.2 + rush * 2;
    padTex.offset.y -= dt * 2.5;
    const k = Math.min(1, dt * 6);
    camera.position.x += (S.x * 0.75 - camera.position.x) * k;
    camera.position.y += (S.y + 3.3 - camera.position.y) * k;
    camera.position.z += (S.z + 7.5 - camera.position.z) * Math.min(1, dt * 12);
    camera.lookAt(S.x * 0.85, S.y + 0.3, S.z - 8);
    stars.position.set(camera.position.x, camera.position.y * 0.3, camera.position.z);
    renderer.render(scene, camera);
  }

  if (location.hostname === 'localhost') window.__slope = { S, update, start, keys, Music, tiles: () => tiles, blocks: () => blocks, pads: () => pads, tileUnder, heightOn, seed: (n) => { rng = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648); } };   // testing on your own computer only
  $('#best').textContent = S.best.toLocaleString('en-US');
  reset();
  showMenu(null, 0, false);
  requestAnimationFrame(frame);
})();
