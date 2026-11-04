/* Downtown, drawn: the streets, pavements, buildings and street furniture of cityLayout (city-layout.mjs). The models
 * are Kenney's City Kit (Commercial), City Kit (Roads) and Car Kit (CC0, kenney.nl), in public/models/city/. On phones
 * and low quality the buildings are the kit's low-detail ones (stretched to the same lots: the same boxes). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUILDINGS, CARS, CAR_SCALE, LAMP_SCALE, SIGNAL_SCALE } from './city-layout.mjs';

const loader = new GLTFLoader();
const files = {};   // file -> Promise of { geometry, material } (each model merged into one mesh)
function model(kit, name) {
  const key = kit + '/' + name;
  return files[key] ||= new Promise((resolve) => loader.load(`/models/city/${kit}/${name}.glb`, (g) => {
    const parts = []; g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    const geos = parts.map((m) => { const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k); return geo.index ? geo : geo; });
    resolve({ geometry: geos.length === 1 ? geos[0] : merge(geos), material: parts[0].material });
  }, undefined, (e) => { console.warn('city model', key, e); resolve(null); }));
}
/** Several geometries (position, normal, uv; indexed or not) as one. */
function merge(geos) {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g)); let n = 0; for (const g of flat) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const [k, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const arr = new Float32Array(n * size); let o = 0;
    for (const g of flat) { const a = g.attributes[k]; if (a) arr.set(a.array, o); o += g.attributes.position.count * size; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** The city's streets, pavements, buildings and street furniture, drawn into scene. Returns { update(camera position),
    dispose() }. quality: 0..2 (under 1: low-detail buildings and fewer parked cars drawn); night: the lights lit. */
export function cityScenery(terrain, scene, map, { quality = 1, night = false, dusk = false, shadows = false } = {}) {
  const L = terrain.city; const base = map.baseHeight; const group = new THREE.Group(); scene.add(group);
  const owned = []; const keep = (o) => { owned.push(o); return o; }; let gone = false;
  const lit = night || dusk;
  // ---- the ground: asphalt, pavements, lines (all flat, laid just over the ground)
  // (a grainy tarmac and a paving-slab pattern, laid by world position: one tile every 9 m)
  const grain = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); paint(g); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return keep(t); };
  const tarmac = grain((g) => { g.fillStyle = '#5b5e63'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 9000; i++) { const v = 70 + Math.random() * 50; g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.35})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(30,32,35,.05)'; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 40, 6 + Math.random() * 20, Math.random() * 3, 0, 7); g.fill(); } });
  const slabs = grain((g) => { g.fillStyle = '#b3b0a9'; g.fillRect(0, 0, 256, 256); for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) { const v = 168 + Math.random() * 22; g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(x * 64 + 1, z * 64 + 1, 62, 62); } });
  const asphalt = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', map: tarmac, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const pave = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', map: slabs, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));   // (each layer pulled a little nearer than the one under it: pavement, road, lines)
  const white = keep(new THREE.MeshStandardMaterial({ color: '#e9e9e4', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const yellow = keep(new THREE.MeshStandardMaterial({ color: '#e8b923', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const grass = keep(new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const quads = { asphalt: [], pave: [], white: [], yellow: [], grass: [] };
  const quad = (list, x0, z0, x1, z1, y = 0) => list.push([x0, z0, x1, z1, y]);
  const lim = L.lim; const SW = L.sidewalk;
  // pavements: the whole city is pavement under the roads (blocks too: the buildings stand on it)
  quad(quads.pave, -L.extent, -L.extent, L.extent, L.extent, 0.04);
  for (const l of L.lines) { quad(quads.asphalt, l.c - l.w / 2, -lim, l.c + l.w / 2, lim, 0.07); quad(quads.asphalt, -lim, l.c - l.w / 2, lim, l.c + l.w / 2, 0.07); }
  const P = L.plaza; quad(quads.asphalt, P.x0 - 1, P.z0 - 1, P.x1 + 1, P.z1 + 1, 0.07);
  // the lines down the streets: dashed white between the lanes, a double yellow down a boulevard's middle; a stop
  // line and a zebra crossing at each crossing
  for (const l of L.lines) for (const axis of [0, 1]) {
    const along = (t0, t1, off, w, list) => (axis ? quad(list, t0, l.c + off - w / 2, t1, l.c + off + w / 2, 0.1) : quad(list, l.c + off - w / 2, t0, l.c + off + w / 2, t1, 0.1));
    for (let t = -lim; t < lim; t += 12) {
      const mid = t + 3; if (L.lines.some((m) => Math.abs(mid - m.c) < m.w / 2 + 6) || L.inPlaza(axis ? mid : l.c, axis ? l.c : mid, 2)) continue;
      if (l.w > L.road) { along(t, t + 12, -0.2, 0.18, quads.yellow); along(t, t + 12, 0.2, 0.18, quads.yellow); along(t, t + 6, -l.w / 4, 0.16, quads.white); along(t, t + 6, l.w / 4, 0.16, quads.white); }
      else along(t, t + 6, 0, 0.16, quads.white);
    }
    for (const m of L.lines) {   // (zebra crossings either side of each crossing)
      if (L.rounds.some((R) => (axis ? R.x === m.c && R.z === l.c : R.x === l.c && R.z === m.c)) || L.inPlaza(axis ? m.c : l.c, axis ? l.c : m.c, 20)) continue;
      for (const s of [-1, 1]) { const t = m.c + s * (m.w / 2 + 2.5); for (let k = -l.w / 2 + 1; k < l.w / 2 - 1; k += 1.6) along(t - 1.6, t + 1.6, k + 0.4, 0.8, quads.white); }
    }
  }
  // the plaza's bays
  for (const b of L.bays) { quad(quads.white, b.x - 1.6 - 0.06, b.z - 2.5, b.x - 1.6 + 0.06, b.z + 2.5, 0.1); }
  // ---- roundabouts: a ring of road, a green island with a kerb
  const discs = [];
  for (const R of L.rounds) {
    const ring = keep(new THREE.RingGeometry(R.island, R.outer, 48)); ring.rotateX(-Math.PI / 2); const m = new THREE.Mesh(ring, asphalt); m.position.set(R.x, base + 0.08, R.z); discs.push(m);
    const isl = keep(new THREE.CylinderGeometry(R.island, R.island + 0.3, 0.4, 40)); const im = new THREE.Mesh(isl, grass); im.position.set(R.x, base + 0.2, R.z); discs.push(im);
    const kerb = keep(new THREE.TorusGeometry(R.island + 0.15, 0.25, 6, 48)); kerb.rotateX(Math.PI / 2); const km = new THREE.Mesh(kerb, pave); km.position.set(R.x, base + 0.2, R.z); discs.push(km);
  }
  for (const m of discs) { m.receiveShadow = true; group.add(m); }
  for (const [k, list] of Object.entries(quads)) {
    if (!list.length) continue;
    const pos = new Float32Array(list.length * 18); const nor = new Float32Array(list.length * 18); const uv = new Float32Array(list.length * 12); let o = 0; let p = 0;
    for (const [x0, z0, x1, z1, y] of list) {
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]]) { pos[o] = x; pos[o + 1] = base + y; pos[o + 2] = z; nor[o + 1] = 1; o += 3; uv[p++] = x / 9; uv[p++] = z / 9; }
    }
    const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(g, { asphalt, pave, white, yellow, grass }[k]); mesh.receiveShadow = true; group.add(mesh);
  }
  // ---- the models: one instanced mesh per model, filled in once each has loaded
  const instanced = [];   // { im, items, place(item, matrix) , near (draw only within this many metres: parked cars) }
  const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(); const v = new THREE.Vector3(); const sc = new THREE.Vector3(); const UP = new THREE.Vector3(0, 1, 0);
  const lowDetail = quality < 1;
  function add(kit, name, items, place, { near = 0, cast = true } = {}) {
    if (!items.length) return;
    model(kit, name).then((md) => {
      if (!md || gone) return;
      const im = new THREE.InstancedMesh(md.geometry, md.material, items.length); im.castShadow = cast && shadows; im.receiveShadow = true;
      const rec = { im, items, place, near, at: null };
      if (!near) { items.forEach((it, i) => { place(it, m4); im.setMatrixAt(i, m4); }); im.count = items.length; im.computeBoundingSphere(); }
      else { im.count = 0; im.frustumCulled = false; }
      group.add(im); instanced.push(rec);
    });
  }
  const at = (x, z, ry, s, sy = s, sz = s, y = 0) => m4.compose(v.set(x, base + y, z), q.setFromAxisAngle(UP, ry), sc.set(s, sy, sz));
  // buildings: each one stretched to fill its lot exactly (what's solid is what you see)
  const byModel = new Map();
  for (const b of L.lots) { const f = lowDetail ? BUILDINGS[b.i][1] : BUILDINGS[b.i][0]; if (!byModel.has(f)) byModel.set(f, []); byModel.get(f).push(b); }
  for (const [f, items] of byModel) {
    const low = f.startsWith('low');
    add('commercial', f, items, (b, out) => {
      // (the low-detail ones are 0.5 square, or 1 × 0.5 when wide: scaled to the same lot)
      const [, , mw, , md] = BUILDINGS[b.i]; const lw = low ? (f.includes('wide') ? 1 : 0.5) : mw; const ld = low ? 0.5 : md;
      const turned = Math.abs(Math.sin(b.ry)) > 0.5; const sx = (turned ? b.hd * 2 : b.hw * 2) / lw; const sz = (turned ? b.hw * 2 : b.hd * 2) / ld;
      at(b.x, b.z, b.ry, sx, low ? b.tall / (f.includes('wide') ? 1.1 : 2) : b.sy, sz, 0.04); out.copy(m4);
    }, { cast: true });
  }
  // street lights, traffic lights, parked cars, cones
  add('roads', 'light-curved', L.lamps, (l, out) => { at(l.x, l.z, l.ry, LAMP_SCALE); out.copy(m4); }, { cast: false });
  add('roads', 'traffic-light', L.signals, (s, out) => { at(s.x, s.z, s.ry, SIGNAL_SCALE); out.copy(m4); }, { cast: false });
  const carsBy = new Map(); for (const c of L.parked) { if (!carsBy.has(c.c)) carsBy.set(c.c, []); carsBy.get(c.c).push(c); }
  for (const [c, items] of carsBy) add('cars', CARS[c][0], items, (it, out) => { at(it.x, it.z, it.ry, CAR_SCALE, CAR_SCALE, CAR_SCALE, 0.3 * CAR_SCALE + 0.04); out.copy(m4); }, { near: quality < 1 ? 160 : 260 });
  add('cars', 'cone', L.cones, (it, out) => { at(it.x, it.z, 0, 1.6, 1.6, 1.6, 0.04); out.copy(m4); }, { cast: false });
  // ---- at night: the street lights' lamps glow (and light the road round you)
  let glowPts = null; const real = [];
  if (lit) {
    const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,248,230,1)'); grd.addColorStop(0.18, 'rgba(255,214,150,.8)'); grd.addColorStop(0.5, 'rgba(255,170,90,.15)'); grd.addColorStop(1, 'rgba(255,150,70,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    keep(tex);
    const head = (l) => [l.x + Math.sin(l.ry) * -0.2 * LAMP_SCALE, base + 0.64 * LAMP_SCALE, l.z + Math.cos(l.ry) * -0.2 * LAMP_SCALE];   // (the lamp at the end of its arm)
    const pos = new Float32Array(L.lamps.length * 3); L.lamps.forEach((l, i) => pos.set(head(l), i * 3));
    const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = keep(new THREE.PointsMaterial({ map: tex, size: 11, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffd9a0', fog: false }));   // (seen through the night's haze: a string of lights down every street)
    glowPts = new THREE.Points(g, mat); glowPts.frustumCulled = false; group.add(glowPts);
    // (a pool of light on the road under every lamp, all in one mesh)
    const ptex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,220,170,.9)'); grd.addColorStop(0.45, 'rgba(255,200,140,.45)'); grd.addColorStop(1, 'rgba(255,180,110,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();   // (softer and wider than the lamp's glow)
    keep(ptex);
    const pool = keep(new THREE.MeshBasicMaterial({ map: ptex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffc27a', opacity: 1, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    const pg = keep(new THREE.PlaneGeometry(1, 1)); pg.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(pg, pool, L.lamps.length);
    L.lamps.forEach((l, i) => { const [x, , z] = head(l); m4.compose(v.set(x, base + 0.12, z), q.identity(), sc.set(18, 1, 18)); pools.setMatrixAt(i, m4); });
    pools.computeBoundingSphere(); group.add(pools);
    for (let i = 0; i < 4; i++) { const p = new THREE.PointLight('#ffcf8f', 60, 30, 1.6); group.add(p); real.push(p); }   // (the nearest few lamps really light you)
    L.heads = L.lamps.map(head);
  }
  // traffic lights: a glowing red or green on each, changing every few seconds
  const sigMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  const sigGeo = keep(new THREE.SphereGeometry(0.22, 8, 6));
  const sig = new THREE.InstancedMesh(sigGeo, sigMat, Math.max(1, L.signals.length)); sig.frustumCulled = false; group.add(sig);
  const RED = new THREE.Color(lit ? '#ff3020' : '#ff4a3a').multiplyScalar(lit ? 3 : 1.6); const GREEN = new THREE.Color(lit ? '#30ff70' : '#3dff7a').multiplyScalar(lit ? 3 : 1.6);
  L.signals.forEach((s, i) => { m4.compose(v.set(s.x + Math.sin(s.ry) * 0.5, base + 0.43 * SIGNAL_SCALE, s.z + Math.cos(s.ry) * 0.5), q.identity(), sc.set(1, 1, 1)); sig.setMatrixAt(i, m4); });
  let phase = -1;
  const cam = new THREE.Vector3(); let lastNear = null;
  return {
    update(camPos) {
      // the parked cars near you
      if (!lastNear || lastNear.distanceToSquared(camPos) > 400) {
        lastNear = (lastNear || new THREE.Vector3()).copy(camPos);
        for (const rec of instanced) {
          if (!rec.near) continue; let n = 0; const n2 = rec.near * rec.near;
          for (const it of rec.items) if ((it.x - camPos.x) ** 2 + (it.z - camPos.z) ** 2 < n2) { rec.place(it, m4); rec.im.setMatrixAt(n++, m4); }
          rec.im.count = n; rec.im.instanceMatrix.needsUpdate = true;
        }
        if (real.length) {   // (the real lights: the nearest lamps)
          const near = L.heads.map((h, i) => [(h[0] - camPos.x) ** 2 + (h[2] - camPos.z) ** 2, i]).sort((a, b) => a[0] - b[0]).slice(0, real.length);
          near.forEach(([, i], k) => real[k].position.set(...L.heads[i]));
        }
      }
      const ph = Math.floor(performance.now() / 6000) & 1;
      if (ph !== phase) { phase = ph; L.signals.forEach((s, i) => sig.setColorAt(i, (s.phase ^ ph) ? GREEN : RED)); if (sig.instanceColor) sig.instanceColor.needsUpdate = true; }
      cam.copy(camPos);
    },
    dispose() {
      gone = true; group.removeFromParent();
      for (const rec of instanced) rec.im.dispose(); sig.dispose(); for (const o of owned) o.dispose?.();
    },
  };
}
