/* Motocross: the maps. The minimap in the corner and the big map (M, or tap the minimap).
   Free ride: the minimap follows you, turned so the way you're riding is up, over a top-down picture of the
   world (hills shaded, trails, water, lava, jumps), with your waypoint or the finish as an arrow on the edge.
   The big map shows the whole world: drag to move it, scroll or pinch to zoom, click a place to set it as your
   waypoint or ride straight there, or click anywhere to drop a pin. Races: the track, the checkpoints and the
   riders, big or small. game.js owns the ride; this file only draws and reports what was picked. */
const TAU = Math.PI * 2;
const SPOT_ICON = { camp: '⛺', lookout: '🔭', checkpoint: '🚩', ruin: '🏛️', yard: '🏗️', tower: '🗼', cabin: '🛖', dock: '⚓' };
const GAP_ICON = { lava: '🔥', water: '💧', ice: '🧊', chasm: '🕳️' };
const GAP_NAME = { lava: 'Lava gap', water: 'Water gap', ice: 'Ice crevasse', chasm: 'Chasm jump' };
const POOL_NAME = { lava: 'Lava pool', tar: 'Tar pit', water: 'Pond' };
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** ctx: { h (PA.h), Sfx, canTravel() (may you fast-travel now?), travel(place), pause(on), onWaypoint(wp or null),
    rider() → { x, z, h (heading, radians: 0 = +x, π/2 = +z) }, others() → [{ x, z, color, name }],
    targets() → [{ x, z, color, label }] (a challenge finish, the next mini-race gate) } */
export function createMap(ctx) {
  const { h, Sfx } = ctx;
  const mini = document.getElementById('hud-mini');
  const miniCv = document.getElementById('hud-map');
  const mg = miniCv.getContext('2d');
  let mode = null;          // 'free' | 'track'
  let def = null; let ground = null; let track = null;
  let base = null; let baseJob = null; const N = 512;   // the top-down picture of a free-ride world
  let places = [];          // what the big map can point at
  let waypoint = null;
  const ui = { open: false, el: null, cv: null, g: null, cx: 0, cz: 0, k: 1, sel: null, hover: null };
  let range = 420;          // the minimap shows this many metres from you to its edge

  // ---------------------------------------------------------------- set up for a world or a track
  function setFree(worldDef, terrain) {
    mode = 'free'; def = worldDef; ground = terrain; track = null;
    waypoint = null; ctx.onWaypoint(null);
    places = [];
    for (const s of def.spots) {
      const pad = def.safePads.find((p) => p.id === s.id);
      places.push({ kind: 'spot', icon: SPOT_ICON[s.kind] || '📍', name: s.name, about: s.about, x: s.position[0], z: s.position[1],
        go: pad ? { position: pad.riderPosition || pad.position, heading: terrain.roadAt(...(pad.riderPosition || pad.position))?.heading ?? 0 } : null });
    }
    for (const g of terrain.gaps) places.push({ kind: 'gap', icon: GAP_ICON[g.kind] || '🔥', name: `${GAP_NAME[g.kind] || 'Gap jump'} · ${Math.round(g.gap)} m`, about: g.kind === 'chasm' ? 'Clear it or fall in.' : `Clear it or end up in the ${g.kind === 'lava' ? 'lava' : 'water'}.`, x: g.cx, z: g.cz, go: g.retry });
    for (const p of terrain.pools) places.push({ kind: 'pool', icon: p.kind === 'lava' ? '🌋' : p.kind === 'tar' ? '🛢️' : '💧', name: POOL_NAME[p.kind] || 'Pool', about: p.kind === 'water' ? 'Deep water.' : 'Don’t ride into it!', x: p.x, z: p.z, go: null, small: true });
    terrain.parks.forEach((pk) => places.push({ kind: 'park', icon: '🏁', name: 'Send-it jump park', about: 'Five tabletops, bigger and bigger.', x: pk.ramps[2].position[0], z: pk.ramps[2].position[1], go: { position: pk.start, heading: pk.heading } }));
    for (const race of def.races) {
      const route = def.routes.find((r) => r.id === race.route); const p = route.points[0];
      if (!places.some((q) => q.kind === 'race' && Math.hypot(q.x - p[0], q.z - p[1]) < 40)) places.push({ kind: 'race', icon: '⏱️', name: 'Mini races start', about: 'Start a mini race with the flag button.', x: p[0], z: p[1], go: null, small: true });
    }
    // the picture is drawn a few rows at a time, so loading the world doesn't freeze
    base = document.createElement('canvas'); base.width = base.height = N;
    const bg = base.getContext('2d'); bg.fillStyle = '#1b2027'; bg.fillRect(0, 0, N, N);
    baseJob = { row: 0, img: bg.createImageData(N, 1), hPrev: new Float32Array(N), hRow: new Float32Array(N), lo: Infinity, hi: -Infinity, bg };
    // height range from a coarse look first (for the colours)
    for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) { const [x, z] = world(i * N / 24, j * N / 24); const y = terrain.rawHeight(x, z); baseJob.lo = Math.min(baseJob.lo, y); baseJob.hi = Math.max(baseJob.hi, y); }
    rough();
    range = 420;
  }
  function setTrack(T, pathAt) {
    mode = 'track'; track = { T, pathAt }; def = null; ground = null; base = null; baseJob = null; places = [];
    waypoint = null; ctx.onWaypoint(null);
    // the track's bounds, for both maps
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity; const pts = [];
    for (let s = T.start - 10; s <= T.finish + 10; s += 3) { const p = pathAt(T, s); pts.push([p.x, p.z]); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    track.pts = pts; track.box = [x0, x1, z0, z1];
    track.cps = [...T.cps, T.finish].map((s, i, a) => { const p = pathAt(T, s); return { x: p.x, z: p.z, finish: i === a.length - 1 }; });
  }
  const world = (i, j) => [-def.size[0] / 2 + (i + 0.5) * def.size[0] / N, -def.size[1] / 2 + (j + 0.5) * def.size[1] / N];

  /** The colour of the world seen from above at (x, z), height y (left and up: the heights next to it, for shading;
      step: metres between them). */
  function colourAt(x, z, y, left, up, step) {
    const P = def.palette; const J = baseJob;
    const shade = clamp(0.92 + ((left - y) + (up - y)) * 0.3 / step, 0.55, 1.25);
    let c = mixc(hex(P.low), hex(P.high), clamp((y - J.lo) / (J.hi - J.lo || 1), 0, 1));
    const road = ground.roadAt(x, z); const jump = ground.rampAt(x, z).weight;
    const tw = Math.max(road && road.trail ? 1 : (road?.weight || 0) * 0.35, jump);
    if (tw > 0) c = mixc(c, hex(P.trail), Math.min(1, tw));
    const hz = ground.hazardAt(x, z); const lake = def.terrain.lake; const river = def.terrain.river;
    if (hz && y < hz.level + 0.3) {
      const fluid = hz.kind === 'lava' ? [255, 96, 24] : hz.kind === 'tar' ? [20, 20, 22] : hz.kind === 'chasm' ? [12, 10, 14] : hex(P.water);
      return mixc(fluid, [255, 255, 255], hz.kind === 'lava' ? 0.12 : 0.05);
    }
    if (lake && lake.frozen && Math.hypot((x - lake.position[0]) / lake.radius[0], (z - lake.position[1]) / lake.radius[1]) < 1) return [214, 232, 246];
    if (river && !river.lava && Math.abs(x - river.x - Math.sin(z / river.wavelength) * river.amplitude) < river.width * 0.45 && y < river.level + 0.3) return hex(P.water);
    return c.map((v) => v * shade);
  }
  /** A rough 128 × 128 picture straight away (so the map isn't blank while the sharp one is drawn). */
  function rough() {
    const n = 128; const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); const img = g.createImageData(n, n);
    const hs = new Float32Array(n * n); const step = def.size[0] / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -def.size[0] / 2 + (i + 0.5) * step; const z = -def.size[1] / 2 + (j + 0.5) * def.size[1] / n; hs[j * n + i] = ground.heightAt(x, z); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -def.size[0] / 2 + (i + 0.5) * step; const z = -def.size[1] / 2 + (j + 0.5) * def.size[1] / n; const y = hs[j * n + i];
      const out = colourAt(x, z, y, i ? hs[j * n + i - 1] : y, j ? hs[(j - 1) * n + i] : y, step); const k = (j * n + i) * 4;
      img.data[k] = out[0]; img.data[k + 1] = out[1]; img.data[k + 2] = out[2]; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const bg = base.getContext('2d'); bg.imageSmoothingEnabled = true; bg.drawImage(c, 0, 0, N, N);
  }
  /** Draw some more rows of the sharp free-ride picture (call every frame; it stops by itself when done). */
  function work(budgetMs = 4) {
    const J = baseJob; if (!J) return;
    const end = performance.now() + budgetMs; const step = def.size[0] / N; const trail = hex(def.palette.trail);
    while (J.row < N && performance.now() < end) {
      const j = J.row;
      for (let i = 0; i < N; i++) {
        const [x, z] = world(i, j);
        const y = ground.heightAt(x, z); J.hRow[i] = y;
        const out = colourAt(x, z, y, i ? J.hRow[i - 1] : y, j ? J.hPrev[i] : y, step);
        const k = i * 4; J.img.data[k] = out[0]; J.img.data[k + 1] = out[1]; J.img.data[k + 2] = out[2]; J.img.data[k + 3] = 255;
      }
      J.bg.putImageData(J.img, 0, j);
      J.hPrev.set(J.hRow); J.row++;
    }
    if (J.row >= N) {
      // the trails' own lines on top, so they read clearly
      const g = J.bg; const sx = N / def.size[0]; const sz = N / def.size[1];
      g.lineJoin = g.lineCap = 'round';
      for (const [w, col] of [[3.2, 'rgba(0,0,0,.35)'], [1.6, `rgb(${trail.map((v) => Math.min(255, v + 40)).join(',')})`]]) {
        g.lineWidth = w; g.strokeStyle = col;
        for (const r of def.routes) { g.beginPath(); r.points.forEach(([x, z], k) => { const px = (x + def.size[0] / 2) * sx; const pz = (z + def.size[1] / 2) * sz; if (k) g.lineTo(px, pz); else g.moveTo(px, pz); }); g.stroke(); }
      }
      baseJob = null;
    }
  }

  // ---------------------------------------------------------------- the minimap
  function sizeCanvas(cv, w, hh) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    return dpr;
  }
  function icon(g, x, y, e, size) { g.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, x, y); }
  function dot(g, x, y, r, fillc, ring = 'rgba(0,0,0,.6)') { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = fillc; g.fill(); g.lineWidth = Math.max(1.2, r * 0.3); g.strokeStyle = ring; g.stroke(); }
  function arrow(g, x, y, ang, size, col) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.72, size * 0.75); g.lineTo(0, size * 0.38); g.lineTo(-size * 0.72, size * 0.75); g.closePath();
    g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,.65)'; g.stroke(); g.restore();
  }
  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

  function drawMini() {
    if (!mode) return;
    work();
    if (mini.hidden) return;   // (switched off in the settings: the big map still works)
    const free = mode === 'free';
    mini.classList.toggle('track', !free);
    const w = mini.clientWidth || 180; const hh = mini.clientHeight || 180;
    const dpr = sizeCanvas(miniCv, w, hh);
    const g = mg; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const me = ctx.rider();
    if (!free) { drawTrack(g, w, hh, 8, false); return; }
    // free ride: centred on you, the way you're riding is up
    const R2 = Math.min(w, hh) / 2; const k = R2 / range; const rot = -Math.PI / 2 - me.h;
    const cs = Math.cos(rot); const sn = Math.sin(rot);
    const to = (x, z) => { const dx = (x - me.x) * k; const dz = (z - me.z) * k; return [w / 2 + dx * cs - dz * sn, hh / 2 + dx * sn + dz * cs]; };
    g.save(); g.beginPath(); g.arc(w / 2, hh / 2, R2, 0, TAU); g.clip();
    g.fillStyle = '#12161c'; g.fillRect(0, 0, w, hh);
    g.save(); g.translate(w / 2, hh / 2); g.rotate(rot); g.scale(k, k); g.translate(-me.x, -me.z);
    g.imageSmoothingEnabled = true; g.drawImage(base, -def.size[0] / 2, -def.size[1] / 2, def.size[0], def.size[1]);
    g.restore();
    // a soft vignette, places and riders
    const vg = g.createRadialGradient(w / 2, hh / 2, R2 * 0.55, w / 2, hh / 2, R2); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(0, 0, w, hh);
    for (const p of places) { const [x, y] = to(p.x, p.z); if (Math.hypot(x - w / 2, y - hh / 2) < R2 - 6) icon(g, x, y, p.icon, p.small ? 11 : 14); }
    for (const o of ctx.others()) { const [x, y] = to(o.x, o.z); if (Math.hypot(x - w / 2, y - hh / 2) < R2 - 4) dot(g, x, y, 4.5, o.color); }
    g.restore();
    // targets: on the map, or an arrow on the rim pointing at them, with how far
    const marks = [...ctx.targets(), ...(waypoint ? [{ x: waypoint.x, z: waypoint.z, color: '#ffd84a', label: waypoint.name, pin: true }] : [])];
    for (const t of marks) {
      const [x, y] = to(t.x, t.z); const dx = x - w / 2; const dy = y - hh / 2; const d = Math.hypot(dx, dy);
      if (d < R2 - 10) { if (t.pin) icon(g, x, y - 6, '📍', 16); else dot(g, x, y, 5.5, t.color, '#fff'); }
      else {
        const a = Math.atan2(dy, dx); const ex = w / 2 + Math.cos(a) * (R2 - 11); const ey = hh / 2 + Math.sin(a) * (R2 - 11);
        arrow(g, ex, ey, a + Math.PI / 2, 8, t.color);
      }
    }
    // the rim, north, and you
    g.beginPath(); g.arc(w / 2, hh / 2, R2 - 1.5, 0, TAU); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.75)'; g.stroke();
    const na = rot - Math.PI / 2; const nx = w / 2 + Math.cos(na) * (R2 - 1.5); const ny = hh / 2 + Math.sin(na) * (R2 - 1.5);
    dot(g, nx, ny, 9, '#e5484d', '#fff'); g.fillStyle = '#fff'; g.font = '700 10px Kanit, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 0.5);
    arrow(g, w / 2, hh / 2, 0, 9, '#ffd21a');
  }

  function drawTrack(g, w, hh, pad, big) {
    const [x0, x1, z0, z1] = track.box;
    const k = Math.min((w - pad * 2) / (x1 - x0 || 1), (hh - pad * 2) / (z1 - z0 || 1));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k; const oz = (hh - (z1 - z0) * k) / 2 - z0 * k;
    const to = (x, z) => [ox + x * k, oz + z * k];
    g.lineJoin = g.lineCap = 'round';
    for (const [lw, col] of [[big ? 16 : 8, 'rgba(10,12,20,.55)'], [big ? 7 : 3.5, 'rgba(255,255,255,.92)']]) {
      g.lineWidth = lw; g.strokeStyle = col; g.beginPath(); track.pts.forEach(([x, z], i) => { const [a, b] = to(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke();
    }
    for (const c of track.cps) { const [a, b] = to(c.x, c.z); dot(g, a, b, c.finish ? (big ? 9 : 5) : (big ? 6 : 3.5), c.finish ? '#fde047' : '#ffffff'); }
    for (const o of ctx.others()) { const [a, b] = to(o.x, o.z); dot(g, a, b, big ? 8 : 4.5, o.color); if (big && o.name) { g.font = '600 13px Kanit, sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(o.name, a + 11, b); } }
    const me = ctx.rider(); const [a, b] = to(me.x, me.z); arrow(g, a, b, me.h + Math.PI / 2, big ? 12 : 7, '#ffd21a');
  }

  // ---------------------------------------------------------------- the big map
  function open() {
    if (!mode || ui.open) return;
    ui.sel = null; ui.hover = null;
    const close = h('button', { class: 'mx-mapx', type: 'button', 'aria-label': 'Close the map', onclick: shut }, '✕');
    ui.cv = h('canvas', { class: 'mx-mapcv' }); ui.g = ui.cv.getContext('2d');
    ui.card = h('div', { class: 'mx-mapcard', hidden: true });
    ui.el = h('div', { class: 'mx-bigmap', role: 'dialog', 'aria-label': 'Map' },
      ui.cv,
      h('div', { class: 'mx-maphead' }, h('b', {}, mode === 'free' ? def.name : 'Track map'),
        h('small', {}, mode === 'free' ? 'Drag to move · scroll or pinch to zoom · click a place, or anywhere to drop a pin' : 'Checkpoints, the finish and every rider'), close),
      mode === 'free' ? h('div', { class: 'mx-mapzoom' },
        h('button', { type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomAt(innerWidth / 2, innerHeight / 2, 1.5) }, '+'),
        h('button', { type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.5) }, '−'),
        h('button', { type: 'button', 'aria-label': 'Centre on me', title: 'Centre on me', onclick: () => { const me = ctx.rider(); ui.cx = me.x; ui.cz = me.z; } }, '◎')) : null,
      mode === 'free' ? h('div', { class: 'mx-maplegend' }, [['⛺', 'Places'], ['🏁', 'Jump park'], ['🔥', 'Gap jumps'], ['⏱️', 'Mini races'], ['📍', 'Waypoint']].map(([e, t]) => h('span', {}, e, ' ', t))) : null,
      ui.card);
    document.getElementById('mx').appendChild(ui.el);
    ui.open = true; Sfx.play('click'); ctx.pause(true);
    // start with the whole world (or track) in view
    const me = ctx.rider();
    if (mode === 'free') { ui.cx = 0; ui.cz = 0; ui.k = Math.min(innerWidth / def.size[0], (innerHeight - 40) / def.size[1]) * 0.94; ui.kMin = ui.k * 0.8; ui.kMax = 2.2; }
    bindBig();
    loop();
    if (waypoint) select(places.find((p) => p.x === waypoint.x && p.z === waypoint.z) || null);
  }
  function shut() {
    if (!ui.open) return;
    ui.open = false; ui.el?.remove(); ui.el = null; ctx.pause(false); Sfx.play('click');
  }
  const toScreen = (x, z) => [innerWidth / 2 + (x - ui.cx) * ui.k, innerHeight / 2 + (z - ui.cz) * ui.k];
  const toWorld = (sx, sy) => [ui.cx + (sx - innerWidth / 2) / ui.k, ui.cz + (sy - innerHeight / 2) / ui.k];
  function zoomAt(sx, sy, f) {
    const [wx, wz] = toWorld(sx, sy);
    ui.k = clamp(ui.k * f, ui.kMin, ui.kMax);
    ui.cx = wx - (sx - innerWidth / 2) / ui.k; ui.cz = wz - (sy - innerHeight / 2) / ui.k;
  }
  function placeAt(sx, sy) {
    let best = null; let bd = 22;
    for (const p of places) { const [x, y] = toScreen(p.x, p.z); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function bindBig() {
    const cv = ui.cv; const pts = new Map(); let moved = 0; let pinch = null;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: ui.k }; } });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) { if (mode === 'free') { const p = placeAt(e.clientX, e.clientY); ui.hover = p; cv.style.cursor = p ? 'pointer' : 'grab'; } return; }
      const [px, py] = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (mode !== 'free') return;
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.k * d / pinch.d) / ui.k); return;
      }
      const dx = e.clientX - px; const dy = e.clientY - py; moved += Math.abs(dx) + Math.abs(dy);
      ui.cx -= dx / ui.k; ui.cz -= dy / ui.k; cv.style.cursor = 'grabbing';
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (mode === 'free' && moved < 6 && e.type === 'pointerup') {
        const p = placeAt(e.clientX, e.clientY);
        if (p) select(p);
        else { const [x, z] = toWorld(e.clientX, e.clientY); if (Math.abs(x) < def.size[0] / 2 && Math.abs(z) < def.size[1] / 2) select({ kind: 'pin', icon: '📍', name: 'Dropped pin', about: 'A spot you picked on the map.', x, z, go: null }); }
      }
      cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { if (mode !== 'free') return; e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  }
  function select(p) {
    ui.sel = p; const card = ui.card; if (!card) return;
    if (!p) { card.hidden = true; return; }
    const me = ctx.rider(); const dist = Math.hypot(p.x - me.x, p.z - me.z);
    const isWp = waypoint && waypoint.x === p.x && waypoint.z === p.z;
    const travel = p.go && ctx.canTravel();
    card.hidden = false;
    card.replaceChildren(...[
      h('div', { class: 'top' }, h('span', { class: 'e' }, p.icon), h('div', {}, h('b', {}, p.name), h('small', {}, `${fmtDist(dist)} away`))),
      p.about ? h('p', {}, p.about) : null,
      h('div', { class: 'acts' },
        h('button', { class: 'mx-sb' + (isWp ? ' on' : ''), type: 'button', onclick: () => { setWaypoint(isWp ? null : p); select(p); } }, isWp ? '✕ Clear waypoint' : '📍 Set waypoint'),
        travel ? h('button', { class: 'mx-sb go', type: 'button', onclick: () => { const go = p.go; shut(); ctx.travel(go, p); } }, '🚀 Ride here') : null),
      p.go && !travel ? h('small', { class: 'why' }, 'Fast travel works in solo free ride.') : null].filter(Boolean));
  }
  function setWaypoint(p) {
    waypoint = p ? { x: p.x, z: p.z, name: p.name, icon: p.icon } : null;
    ctx.onWaypoint(waypoint); Sfx.play('click');
  }
  function loop() {
    if (!ui.open) return;
    requestAnimationFrame(loop);
    work(6);
    const w = innerWidth; const hh = innerHeight; const dpr = sizeCanvas(ui.cv, w, hh);
    const g = ui.g; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0e13'; g.fillRect(0, 0, w, hh);
    if (mode === 'track') { drawTrack(g, w, hh, Math.max(60, w * 0.08), true); return; }
    g.save(); g.translate(w / 2, hh / 2); g.scale(ui.k, ui.k); g.translate(-ui.cx, -ui.cz);
    g.imageSmoothingEnabled = ui.k < 1.2; g.drawImage(base, -def.size[0] / 2, -def.size[1] / 2, def.size[0], def.size[1]);
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2 / ui.k; g.strokeRect(-def.size[0] / 2, -def.size[1] / 2, def.size[0], def.size[1]);
    g.restore();
    // places: icons, with names for the big ones (and for any when zoomed in)
    const names = ui.k > 0.45;
    for (const p of places) {
      const [x, y] = toScreen(p.x, p.z); if (x < -40 || y < -40 || x > w + 40 || y > hh + 40) continue;
      const on = p === ui.sel || p === ui.hover;
      if (on) dot(g, x, y, 17, 'rgba(255,255,255,.22)', 'rgba(255,255,255,.9)');
      icon(g, x, y, p.icon, p.small ? 15 : 20);
      if ((p.kind === 'spot' || on || (names && p.kind !== 'pool')) && p.kind !== 'race') {
        g.font = `${p.kind === 'spot' ? 700 : 600} ${p.kind === 'spot' ? 14 : 12}px Kanit, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(p.name, x, y + 13); g.fillStyle = '#fff'; g.fillText(p.name, x, y + 13);
      }
    }
    if (ui.sel && ui.sel.kind === 'pin') { const [x, y] = toScreen(ui.sel.x, ui.sel.z); icon(g, x, y - 10, '📍', 26); }
    for (const t of ctx.targets()) { const [x, y] = toScreen(t.x, t.z); dot(g, x, y, 9, t.color, '#fff'); }
    if (waypoint) { const [x, y] = toScreen(waypoint.x, waypoint.z); icon(g, x, y - 12, '📍', 28); }
    for (const o of ctx.others()) { const [x, y] = toScreen(o.x, o.z); dot(g, x, y, 7, o.color); }
    const me = ctx.rider(); const [mx, my] = toScreen(me.x, me.z);
    dot(g, mx, my, 15, 'rgba(255,210,26,.22)', 'rgba(255,210,26,.0)'); arrow(g, mx, my, me.h + Math.PI / 2, 13, '#ffd21a');
    // a scale bar
    const m = [50, 100, 200, 500, 1000].find((v) => v * ui.k > 70) || 1000; const bx = 24; const by = hh - 30;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bx - 8, by - 20, m * ui.k + 16, 30);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + m * ui.k, by); g.lineTo(bx + m * ui.k, by - 4); g.stroke();
    g.fillStyle = '#fff'; g.font = '600 12px Kanit, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(fmtDist(m), bx, by - 7);
  }

  mini.addEventListener('click', () => open());
  mini.addEventListener('wheel', (e) => { if (mode !== 'free') return; e.preventDefault(); range = clamp(range * Math.exp(e.deltaY * 0.0015), 150, 1400); }, { passive: false });
  return {
    setFree, setTrack, drawMini, open, close: shut, toggle: () => (ui.open ? shut() : open()),
    get isOpen() { return ui.open; }, get waypoint() { return waypoint; }, clearWaypoint: () => setWaypoint(null),
    reset() { mode = null; base = null; baseJob = null; waypoint = null; if (ui.open) shut(); },
  };
}
