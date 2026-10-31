/* Free ride: the supercars. Two are model files (a Lamborghini Revuelto and an Aventador, CC BY, credited on
   /credits) and one is built from code (a low wedge, also what shows while a model file loads). All are posed from
   car.js's state: the body pitches and rolls on its springs, the wheels spin, steer and follow the suspension.
   Car coordinates: +X forward, +Y up, +Z to the right, the origin the middle of the body (car.js's position),
   the ground 0.74 m below it. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAR_MODELS = {
  revuelto: { name: 'Revuelto', emoji: '🧡', about: 'Lamborghini Revuelto (model by ALIEEEN, CC BY)', file: '/models/moto/revuelto.glb', paint: 'Body' },
  aventador: { name: 'Aventador', emoji: '💛', about: 'Lamborghini Aventador (model by Arion Digital, CC BY)', file: '/models/moto/aventador.glb' },
  wedge: { name: 'Wedge', emoji: '🔺', about: 'A wedge supercar built from code' },
};
/** Can this car be painted? (the Aventador's paint is part of its one texture) */
export const paintable = (id) => !CAR_MODELS[id]?.file || !!CAR_MODELS[id].paint;

export const CAR_PAINTS = {
  arancio: { name: 'Arancio', color: '#ff6a00' },
  verde: { name: 'Verde', color: '#7ed321' },
  giallo: { name: 'Giallo', color: '#ffc800' },
  viola: { name: 'Viola', color: '#7b2ff7' },
  rosso: { name: 'Rosso', color: '#d6102b' },
  blu: { name: 'Blu', color: '#1f6fff' },
  bianco: { name: 'Bianco', color: '#f2f4f7' },
  nero: { name: 'Nero', color: '#16181c' },
};
const GROUND = -0.74;   // the ground, in car coordinates
const WHEELS = [[1.32, -0.84], [1.32, 0.84], [-1.28, -0.84], [-1.28, 0.84]];

/** A side outline (x forward, y up from the ground) extruded across the car, centred. */
function side(points, width, bevel = 0.04, holes = []) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y + GROUND) : shape.moveTo(x, y + GROUND)));
  shape.closePath();
  for (const hp of holes) shape.holes.push(hp);
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 16 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}
/** The body's outline, with round arches cut into the bottom edge for the wheels. */
function bodyOutline() {
  const pts = [];
  const arch = (cx, from, to) => { for (let k = 0; k <= 12; k++) { const a = from + (to - from) * k / 12; pts.push([cx + Math.cos(a) * 0.44, 0.36 + Math.sin(a) * 0.44]); } };
  pts.push([2.28, 0.34], [2.32, 0.46], [2.05, 0.6], [1.5, 0.72], [0.95, 0.8], [-1.25, 0.86], [-2.0, 0.93], [-2.32, 0.9], [-2.36, 0.6], [-2.28, 0.34]);
  pts.push([-1.75, 0.3]); arch(-1.28, 0, Math.PI); pts.push([-0.8, 0.28], [0.85, 0.28]); arch(1.32, 0, Math.PI); pts.push([1.78, 0.3]);
  return pts.reverse();   // (the arches are drawn front to back, so flip the whole outline to keep it one way round)
}

// ------------------------------------------------------------------ the model files
const fitted = {}; const loading = {}; let ready = 0;
/** Load a model-file car (once). Resolves when it can be built (or failed: then it's the wedge). */
export function preloadCar(id) {
  const spec = CAR_MODELS[id];
  if (!spec?.file || fitted[id]) return Promise.resolve(true);
  if (!loading[id]) loading[id] = new Promise((resolve) => new GLTFLoader().load(spec.file, (g) => { fitted[id] = fitCar(g.scene); ready++; resolve(true); }, undefined, (e) => { console.warn('car model', id, e); resolve(false); }));
  return loading[id];
}
export const carsLoaded = () => ready;
/** Work out where every part of a model car goes: its axles onto car.js's axles (scaled to the same wheelbase),
    its wheels each on their own pivot so they can spin and steer. Wheel parts are found by their node names
    (Wheel_FL, Wheel_BR, Wheel_RR…: F is the front), left and right by where they are. */
function fitCar(scene) {
  scene.updateMatrixWorld(true);
  const wheelOf = (o) => { for (let p = o; p; p = p.parent) if (/^Wheel_[A-Z]{2}$/i.test(p.name || '')) return p; return null; };   // (the wheel's own node, so all its parts turn about one centre)
  const meshes = []; const groups = new Map();
  scene.traverse((o) => { if (!o.isMesh) return; const w = wheelOf(o); meshes.push({ o, w }); if (w) { if (!groups.has(w)) groups.set(w, new THREE.Box3()); groups.get(w).expandByObject(o); } });
  const wheels = [...groups.entries()].map(([node, box]) => ({ node, box, c: box.getCenter(new THREE.Vector3()), front: /^Wheel_F/i.test(node.name) }));
  const mid = (list) => list.reduce((a, w) => a.add(w.c), new THREE.Vector3()).multiplyScalar(1 / list.length);
  const fm = mid(wheels.filter((w) => w.front)); const rm = mid(wheels.filter((w) => !w.front));
  const fwd = new THREE.Vector3(fm.x - rm.x, 0, fm.z - rm.z); const base = fwd.length(); fwd.normalize();
  const up = new THREE.Vector3(0, 1, 0); const right = new THREE.Vector3().crossVectors(fwd, up);
  const s = (WHEELS[0][0] - WHEELS[2][0]) / base;
  const radius = wheels.reduce((a, w) => a + (w.box.max.y - w.box.min.y) / 2, 0) / wheels.length * s;
  // model → car: from the rear axle's middle, turned to the car's axes, scaled, onto car.js's rear axle (on the ground)
  const M = new THREE.Matrix4().makeTranslation(WHEELS[2][0], GROUND + radius, 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeBasis(fwd, up, right).transpose())
    .multiply(new THREE.Matrix4().makeTranslation(-rm.x, -rm.y, -rm.z));
  // which physics wheel each model wheel is (front left, front right, rear left, rear right)
  for (const w of wheels) { const c = w.c.clone().applyMatrix4(M); w.car = c; w.index = (c.x > 0 ? 0 : 2) + (c.z > 0 ? 1 : 0); }
  const parts = meshes.map(({ o, w }) => {
    const wh = w && wheels.find((x) => x.node === w);
    const matrix = wh ? new THREE.Matrix4().makeTranslation(-wh.car.x, -wh.car.y, -wh.car.z).multiply(M).multiply(o.matrixWorld) : M.clone().multiply(o.matrixWorld);
    return { geometry: o.geometry, material: o.material, matrix, wheel: wh ? wh.index : -1 };
  });
  return { parts, wheels: wheels.map((w) => ({ index: w.index, car: w.car })), radius };
}
function makeModelCar(id, paintId) {
  const F = fitted[id]; const spec = CAR_MODELS[id];
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  const own = [];   // (materials made for this car: its paint)
  let paintMat = null;
  const wheels = [0, 1, 2, 3].map((i) => {
    const w = F.wheels.find((x) => x.index === i) || { car: new THREE.Vector3(WHEELS[i][0], GROUND + F.radius, WHEELS[i][1]) };
    const g = new THREE.Group(); g.position.copy(w.car); root.add(g);
    const spinG = new THREE.Group(); g.add(spinG);
    return { g, spinG, x: w.car.x, z: w.car.z, lift: F.radius - 0.34 };
  });
  for (const p of F.parts) {
    let mat = p.material;
    if (spec.paint && mat.name === spec.paint && CAR_PAINTS[paintId]) {
      if (!paintMat) { paintMat = mat.clone(); paintMat.color.set(CAR_PAINTS[paintId].color); own.push(paintMat); }
      mat = paintMat;
    }
    const o = new THREE.Mesh(p.geometry, mat); o.matrixAutoUpdate = false; o.matrix.copy(p.matrix);
    o.castShadow = true; o.receiveShadow = true; o.userData.shared = true;
    (p.wheel >= 0 ? wheels[p.wheel].spinG : body).add(o);
  }
  return { root, body, wheels, car: true, ghost: false, materials: own, file: true };
}

/** Build a car: model ('revuelto', 'aventador', 'wedge'; a model file that hasn't loaded yet shows as the wedge),
    paint (CAR_PAINTS id; for the cars that can be painted). */
export function makeCar(modelId = 'revuelto', paintId = 'arancio', ghost = null) {
  if (modelId === 'buggy') return makeBuggy(paintId, ghost);
  if (modelId === 'wing') return makeWing(paintId, ghost);
  if (CAR_MODELS[modelId]?.file) { if (fitted[modelId] && !ghost) return makeModelCar(modelId, paintId); preloadCar(modelId); }
  return makeWedge(paintId, ghost);
}
function makeWedge(paintId = 'arancio', ghost = null) {
  const paintCol = (CAR_PAINTS[paintId] || CAR_PAINTS.arancio).color;
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...o });
  const M = ghost
    ? (() => { const m = new THREE.MeshStandardMaterial({ color: ghost, transparent: true, opacity: 0.4, depthWrite: false }); return new Proxy({}, { get: () => m }); })()
    : {
      paint: new THREE.MeshPhysicalMaterial({ color: paintCol, roughness: 0.28, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#0d1117', roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
      black: std('#0f1012', { roughness: 0.6 }),
      carbon: std('#1b1c1f', { roughness: 0.35, metalness: 0.4 }),
      tyre: std('#141414', { roughness: 0.9 }),
      rim: std('#2a2c31', { metalness: 0.9, roughness: 0.25 }),
      chrome: std('#b9bec6', { metalness: 1, roughness: 0.3 }),
      caliper: std(paintId === 'giallo' ? '#16181c' : '#ffd21a', { roughness: 0.4 }),
      head: new THREE.MeshStandardMaterial({ color: '#f4f8ff', emissive: '#e8f1ff', emissiveIntensity: 1.6 }),
      tail: new THREE.MeshStandardMaterial({ color: '#ff1a2a', emissive: '#ff1020', emissiveIntensity: 1.8 }),
    };
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  const add = (g, m, x = 0, y = 0, z = 0, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = !ghost; o.receiveShadow = !ghost; parent.add(o); return o; };
  // the body up to the waist, then the glass cabin (narrower) with a painted roof, and vents on the engine cover
  add(side(bodyOutline(), 1.98, 0.06), M.paint);
  add(side([[1.02, 0.78], [0.3, 1.1], [-0.55, 1.13], [-1.32, 0.88], [-1.32, 0.8], [1.02, 0.74]], 1.56, 0.05), M.glass);
  add(side([[0.34, 1.095], [-0.55, 1.14], [-1.02, 1.0], [-0.96, 0.985], [-0.52, 1.11], [0.3, 1.075]], 1.44, 0.02), M.paint, 0, 0.012);
  for (const x of [-1.52, -1.66, -1.8]) add(new THREE.BoxGeometry(0.05, 0.02, 1.2), M.black, x, GROUND + 0.885 + (-1.25 - x) * 0.09, 0);
  // front splitter, side intakes and skirts, the diffuser
  add(new THREE.BoxGeometry(0.5, 0.05, 2.0), M.carbon, 2.08, GROUND + 0.29, 0);
  for (const z of [-1, 1]) {
    add(side([[0.3, 0.5], [-0.35, 0.72], [-0.75, 0.72], [-0.75, 0.42]], 0.02, 0), M.black, 0, 0, z * 0.995);
    add(new THREE.BoxGeometry(2.0, 0.08, 0.06), M.carbon, 0.02, GROUND + 0.3, z * 0.98);
  }
  add(new THREE.BoxGeometry(0.35, 0.12, 1.7), M.carbon, -2.2, GROUND + 0.36, 0);
  // lights: thin headlight blades and a full-width tail light bar
  for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.36, 0.035, 0.46), M.head, 2.1, GROUND + 0.6, z * 0.6).rotation.z = -0.48;
  add(new THREE.BoxGeometry(0.06, 0.1, 1.3), M.black, 2.3, GROUND + 0.4, 0);   // (the front intake)
  add(new THREE.BoxGeometry(0.04, 0.06, 1.72), M.tail, -2.42, GROUND + 0.78, 0);
  // the rear wing on two struts, and four exhaust tips
  add(new THREE.BoxGeometry(0.42, 0.04, 1.86), M.carbon, -1.95, GROUND + 1.18, 0).rotation.z = 0.08;
  for (const z of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.08, 0.24, 0.05), M.carbon, -1.92, GROUND + 1.04, z);
  for (const z of [-0.32, -0.16, 0.16, 0.32]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 14).rotateZ(Math.PI / 2), M.chrome, -2.4, GROUND + 0.42, z);
  // mirrors
  for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.08, 0.16), M.paint, 0.72, GROUND + 0.88, z * 0.95);
  // the wheels: tyre, a dark five-spoke rim, a brake caliper (that doesn't spin)
  const wheels = WHEELS.map(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, GROUND + 0.34, z * 1.08); root.add(g);   // (a little further out than the physics' wheels: flush with the body)
    const spinG = new THREE.Group(); g.add(spinG);
    const out = Math.sign(z);
    add(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 32).rotateX(Math.PI / 2), M.tyre, 0, 0, 0, spinG);
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.31, 28).rotateX(Math.PI / 2), M.rim, 0, 0, 0, spinG);
    for (let k = 0; k < 5; k++) { const sp = add(new THREE.BoxGeometry(0.42, 0.05, 0.03), M.chrome, 0, 0, out * 0.16, spinG); sp.rotation.z = k * Math.PI / 5; }
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16).rotateX(Math.PI / 2), M.chrome, 0, 0, out * 0.17, spinG);
    add(new THREE.BoxGeometry(0.12, 0.16, 0.05), M.caliper, 0.12, 0.12, out * 0.1, g);
    return { g, spinG, x, z };
  });
  if (ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
  return { root, body, wheels, car: true, ghost: !!ghost, materials: Object.values(M).filter((m, i, a) => a.indexOf(m) === i) };
}

// ------------------------------------------------------------------ the newer modes' model files
/* Drivvd's buggy ("Buggy" by Nick Slough) and Skyvvd's parachute ("Parachute" by Poly by Google), both CC BY 3.0 via
   Poly Pizza. Until they've loaded (or if they can't), the code-built ones stand in. */
const extras = {}; const extraLoading = {};
export function preloadExtra(name) {
  if (extras[name]) return Promise.resolve(true);
  return extraLoading[name] ||= new Promise((resolve) => new GLTFLoader().load(`/models/moto/${name}.glb`, (g) => { extras[name] = g.scene; resolve(true); }, undefined, (e) => { console.warn(name, e); resolve(false); }));
}
/** The buggy model fitted to car.js's buggy (made once, then shared): its body merged into one mesh per material, in car
    coordinates, and each wheel's parts centred on its hub, scaled to the physics' wheel size. The model points along
    -x, its small wheels at the front: turned round, scaled to the physics' wheelbase and moved onto its axles. */
let buggyFit = null;
function fitBuggy() {
  if (buggyFit || !extras.buggy) return buggyFit;
  const src = extras.buggy; src.updateMatrixWorld(true);
  const s = 2.55 / 2.06; const hubs = [[-1.27, -0.29, -0.585], [-1.27, -0.29, 0.585], [0.785, -0.175, -0.765], [0.785, -0.175, 0.765]];   // (front left, front right, rear left, rear right, in the model)
  const F = new THREE.Matrix4().makeTranslation(-0.27, -0.16, 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  const toCar = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(F);
  const hubsCar = hubs.map((h) => toCar(...h)); const radii = [0.255, 0.255, 0.31, 0.31].map((r) => r * s);
  const body = new Map(); const wheels = [[], [], [], []]; const box = new THREE.Box3(); const c = new THREE.Vector3();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(F, o.matrixWorld)); g.computeBoundingBox(); g.boundingBox.getCenter(c);
    const sz = g.boundingBox.getSize(new THREE.Vector3());
    const w = hubsCar.findIndex((hc) => Math.hypot(hc.x - c.x, hc.y - c.y) < 0.12 && Math.abs(hc.z - c.z) < 0.25 && Math.max(sz.x, sz.y) < 0.9);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (w >= 0) { const k = 0.42 / radii[w]; g.translate(-hubsCar[w].x, -hubsCar[w].y, -hubsCar[w].z).scale(k, k, 1); wheels[w].push([g, o.material]); return; }
    const key = o.material.uuid + (g.attributes.uv ? 'u' : ''); if (!body.has(key)) body.set(key, [o.material, []]); body.get(key)[1].push(g);
  });
  buggyFit = { body: [...body.values()].map(([m, gs]) => [mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g))), m]), wheels };
  return buggyFit;
}

/** Drivvd's rally buggy, built from code: a tube-frame cage over a floor pan, a short nose, the engine out back with
    its exhaust and a spare wheel, a light bar on the roof, a helmeted driver, and four big knobbly tyres on long
    springs (car.js's buggy spec: the ground is 0.87 m below the middle). */
function makeBuggy(paintId = 'arancio', ghost = null) {
  const GR = -0.87; const paintCol = (CAR_PAINTS[paintId] || CAR_PAINTS.arancio).color;
  const fit = fitBuggy(); if (fit) return modelBuggy(fit, paintCol, ghost);
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...o });
  const M = ghost
    ? (() => { const m = new THREE.MeshStandardMaterial({ color: ghost, transparent: true, opacity: 0.4, depthWrite: false }); return new Proxy({}, { get: () => m }); })()
    : { paint: new THREE.MeshPhysicalMaterial({ color: paintCol, roughness: 0.32, metalness: 0.2, clearcoat: 0.8 }), tube: std('#24262b', { metalness: 0.6, roughness: 0.4 }),
      black: std('#121316', { roughness: 0.7 }), tyre: std('#1a1a1a', { roughness: 0.95 }), rim: std('#b9bec6', { metalness: 0.8, roughness: 0.3 }), metal: std('#5d636d', { metalness: 0.7, roughness: 0.35 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#f4f8ff', emissive: '#fff4d6', emissiveIntensity: 1.5 }), suit: std('#e8452f', { roughness: 0.8 }), visor: std('#0d1117', { roughness: 0.1, metalness: 0.6 }) };
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  const add = (g, m, x = 0, y = 0, z = 0, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = !ghost; parent.add(o); return o; };
  const up = new THREE.Vector3(0, 1, 0); const sideB = (pts, w, bv) => side(pts, w, bv).translate(0, GR - GROUND, 0);   // (side() measures from the supercar's ground)
  const tube = (a, b, r = 0.032, mat = M.tube) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A); const o = add(new THREE.CylinderGeometry(r, r, d.length(), 8), mat, ...A.clone().addScaledVector(d, 0.5).toArray()); o.quaternion.setFromUnitVectors(up, d.normalize()); return o; };
  // floor pan, nose and engine cover (painted), the seat
  add(new THREE.BoxGeometry(2.3, 0.07, 1.05), M.black, -0.05, GR + 0.5, 0);
  add(sideB([[1.75, 0.55], [1.55, 0.78], [0.55, 0.88], [0.55, 0.5], [1.4, 0.45]], 0.95, 0.05), M.paint);
  add(sideB([[-0.85, 0.52], [-0.85, 1.02], [-1.25, 1.0], [-1.6, 0.75], [-1.62, 0.52]], 1.0, 0.05), M.paint);
  add(new THREE.BoxGeometry(0.5, 0.34, 0.8), M.metal, -1.2, GR + 0.62, 0);   // (the engine)
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 12).rotateZ(Math.PI / 2 - 0.25), M.rim, -1.6, GR + 0.95, 0.32);   // (the exhaust)
  add(new THREE.BoxGeometry(0.55, 0.12, 0.5), M.black, -0.2, GR + 0.62, 0); add(new THREE.BoxGeometry(0.12, 0.6, 0.5), M.black, -0.45, GR + 0.9, 0).rotation.z = 0.15;
  // the cage: two hoops, the roof rails, the side bars and a cross brace
  const H = GR + 1.62; const W = 0.56;
  for (const [x, top] of [[0.45, H - 0.06], [-0.75, H]]) { tube([x, GR + 0.52, -W], [x, top, -W * 0.92]); tube([x, GR + 0.52, W], [x, top, W * 0.92]); tube([x, top, -W * 0.92], [x, top, W * 0.92]); }
  for (const k of [-1, 1]) { tube([0.45, H - 0.06, k * W * 0.92], [-0.75, H, k * W * 0.92]); tube([0.45, GR + 0.52, k * W], [1.5, GR + 0.62, k * 0.42]); tube([-0.75, H, k * W * 0.92], [-1.55, GR + 0.75, k * 0.45]); tube([0.45, GR + 0.85, k * W], [-0.75, GR + 0.85, k * W]); }
  tube([-0.75, H, -W * 0.9], [0.45, GR + 0.85, W]);
  tube([1.62, GR + 0.5, -0.5], [1.62, GR + 0.5, 0.5], 0.045);   // (the front bumper)
  // the light bar on the roof and two spots on the cage
  add(new THREE.BoxGeometry(0.1, 0.08, 0.95), M.black, 0.42, H + 0.02, 0);
  for (let z = -0.38; z <= 0.39; z += 0.19) add(new THREE.BoxGeometry(0.02, 0.05, 0.13), M.lamp, 0.48, H + 0.02, z);
  // the spare wheel on the back
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20).rotateZ(Math.PI / 2 - 0.4), M.tyre, -1.62, GR + 1.08, 0);
  // the driver: suit, helmet with a dark visor, hands up on the wheel
  add(new THREE.CapsuleGeometry(0.2, 0.35, 4, 10), M.suit, -0.25, GR + 1.0, 0);
  add(new THREE.SphereGeometry(0.17, 16, 12), M.paint, -0.18, GR + 1.38, 0);
  add(new THREE.BoxGeometry(0.06, 0.08, 0.2), M.visor, -0.03, GR + 1.38, 0);
  add(new THREE.TorusGeometry(0.17, 0.02, 6, 20).rotateY(Math.PI / 2).rotateZ(-0.5), M.black, 0.15, GR + 1.05, 0);   // (the steering wheel)
  // the wheels: a big knobbly tyre and a beadlock rim, each on its own spring
  const WH = [[1.3, -0.92], [1.3, 0.92], [-1.25, -0.92], [-1.25, 0.92]];
  const wheels = WH.map(([x, z]) => {
    const g = new THREE.Group(); g.position.set(x, GR + 0.42, z * 1.02); root.add(g);
    const spinG = new THREE.Group(); g.add(spinG);
    const out = Math.sign(z);
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 28).rotateX(Math.PI / 2), M.tyre, 0, 0, 0, spinG);
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; const kn = add(new THREE.BoxGeometry(0.07, 0.05, 0.3), M.tyre, Math.cos(a) * 0.43, Math.sin(a) * 0.43, (k % 2 ? 0.03 : -0.03), spinG); kn.rotation.z = a; }
    add(new THREE.CylinderGeometry(0.24, 0.24, 0.35, 20).rotateX(Math.PI / 2), M.rim, 0, 0, 0, spinG);
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14).rotateX(Math.PI / 2), M.black, 0, 0, out * 0.18, spinG);
    // (the suspension arm and the coil, going in to the frame: they ride up and down with the wheel)
    add(new THREE.BoxGeometry(0.08, 0.05, 0.5), M.tube, 0, 0.02, -out * 0.3, g);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 10), M.paint, 0, 0.3, -out * 0.28, g).rotation.x = out * 0.4;
    return { g, spinG, x, z };
  });
  if (ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
  return { root, body, wheels, car: true, buggy: true, susp: { mount: -0.12, rest: 0.52, travel: 0.5 }, ghost: !!ghost, materials: Object.values(M).filter((m, i, a) => a.indexOf(m) === i) };
}

/** Skyvvd's wingsuit flyer (x forward, y up): lying flat, arms and legs spread with the wings between them, a helmet
    and visor; and the parachute (hidden until it's pulled: wing.js passes how far open it is in the first spring). */
function makeWing(color = '#ff4fa3', ghost = null) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
  const M = ghost
    ? (() => { const m = new THREE.MeshStandardMaterial({ color: ghost, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }); return new Proxy({}, { get: () => m }); })()
    : { suit: std(color, { side: THREE.DoubleSide, roughness: 0.5 }), dark: std('#1b1f27', { side: THREE.DoubleSide }), white: std('#f2f4f7', { side: THREE.DoubleSide }),
      helmet: new THREE.MeshPhysicalMaterial({ color: '#f2f4f7', roughness: 0.25, clearcoat: 1 }), visor: std('#0d1117', { roughness: 0.1, metalness: 0.7 }),
      canopy: std(color, { side: THREE.DoubleSide, roughness: 0.7 }), canopy2: std('#f2f4f7', { side: THREE.DoubleSide, roughness: 0.7 }), line: new THREE.LineBasicMaterial({ color: '#dfe3ea' }) };
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  const add = (g, m, x = 0, y = 0, z = 0, parent = body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = !ghost; parent.add(o); return o; };
  const man = [];   // (the code-built flyer: game.js puts a real rider in its place)
  // the wing: its outline seen from above (x forward, the shape's y across), both halves
  const half = [[0.42, 0], [0.32, 0.18], [0.16, 0.86], [0.02, 0.9], [-0.42, 0.42], [-0.62, 0.32], [-1.02, 0.2], [-1.08, 0]];
  const shape = new THREE.Shape(); [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [x, -z])].forEach(([x, z], i) => (i ? shape.lineTo(x, z) : shape.moveTo(x, z)));
  add(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }).rotateX(Math.PI / 2), M.suit, 0.1, 0.02, 0);
  for (const k of [-1, 1]) { man.push(add(new THREE.BoxGeometry(0.06, 0.035, 0.7), M.white, 0.22, 0.03, k * 0.5)); man.at(-1).rotation.y = k * 0.1; }   // (a stripe on each arm wing)

  man.push(add(new THREE.CapsuleGeometry(0.16, 0.5, 4, 10).rotateZ(Math.PI / 2), M.dark, -0.05, 0.05, 0));   // the body
  for (const k of [-1, 1]) {
    man.push(add(new THREE.CapsuleGeometry(0.05, 0.75, 4, 8).rotateX(Math.PI / 2), M.suit, 0.2, 0.05, k * 0.48)); man.at(-1).rotation.y = k * 0.18;   // arms along the leading edge
    man.push(add(new THREE.CapsuleGeometry(0.07, 0.6, 4, 8).rotateZ(Math.PI / 2), M.dark, -0.72, 0.04, k * 0.13)); man.at(-1).rotation.y = -k * 0.12;   // legs
    man.push(add(new THREE.BoxGeometry(0.22, 0.09, 0.1), M.dark, -1.1, 0.05, k * 0.17));   // shoes
  }
  man.push(add(new THREE.SphereGeometry(0.14, 16, 12), M.helmet, 0.48, 0.07, 0));
  man.push(add(new THREE.BoxGeometry(0.06, 0.07, 0.17), M.visor, 0.6, 0.06, 0));
  // the parachute: a ram-air canopy (bent across), its lines to the shoulders
  const chute = new THREE.Group(); chute.visible = false; root.add(chute);
  if (extras.parachute) {   // (the model: a ram-air canopy on its lines, the harness at its bottom on your shoulders)
    const p = extras.parachute.clone(true); p.scale.setScalar(0.72); p.rotation.y = Math.PI / 2; p.position.y = 1.15;
    if (ghost) p.traverse((o) => { if (o.isMesh) o.material = M.suit; });
    chute.add(p);
    if (ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
    return { root, body, wheels: [], car: true, wing: true, chute, man, file: true, ghost: !!ghost, materials: Object.values(M).filter((m, i, a) => a.indexOf(m) === i),
      dispose: () => body.traverse((o) => o.geometry?.dispose()) };
  }
  const cg = new THREE.BoxGeometry(1.2, 0.22, 3.2, 6, 1, 16); const cp = cg.attributes.position;
  for (let i = 0; i < cp.count; i++) { const z = cp.getZ(i); const x = cp.getX(i); cp.setY(i, cp.getY(i) - z * z * 0.1 + (x > 0 ? 0.06 : 0)); }
  cg.computeVertexNormals();
  add(cg, M.canopy, 0, 4.2, 0, chute);
  for (const z of [-1.2, 0, 1.2]) add(new THREE.BoxGeometry(1.22, 0.23, 0.18), M.canopy2, 0, 4.2 - z * z * 0.1 + 0.002, z, chute);
  const lines = [];
  for (const z of [-1.5, -0.8, 0, 0.8, 1.5]) for (const x of [-0.5, 0.5]) lines.push(x, 4.1 - z * z * 0.1, z, 0, 0.55, Math.sign(z) * 0.12);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  chute.add(new THREE.LineSegments(lg, M.line));
  if (ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
  return { root, body, wheels: [], car: true, wing: true, chute, man, ghost: !!ghost, materials: Object.values(M).filter((m, i, a) => a.indexOf(m) === i) };
}

/** The buggy from its model file: the shared body (the orange of its frame in your paint), the wheels on their springs,
    and the code-built driver in the seat. */
function modelBuggy(fit, paintCol, ghost) {
  const ghostMat = ghost ? new THREE.MeshStandardMaterial({ color: ghost, transparent: true, opacity: 0.4, depthWrite: false }) : null;
  const mats = new Map(); const own = [];
  const matFor = (m) => {
    if (ghostMat) return ghostMat;
    if (!mats.has(m)) { const hsl = {}; m.color?.getHSL(hsl); const orange = hsl.s > 0.5 && (hsl.h < 0.11 || hsl.h > 0.96) && hsl.l > 0.2;   // (its red-orange frame and panels)
      const mm = orange ? m.clone() : m; if (orange) { mm.color.set(paintCol); own.push(mm); } mats.set(m, mm); }
    return mats.get(m);
  };
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);
  for (const [g, m] of fit.body) { const o = new THREE.Mesh(g, matFor(m)); o.castShadow = !ghost; o.receiveShadow = !ghost; if (ghost) o.renderOrder = 2; body.add(o); }
  const WH = [[1.3, -0.92], [1.3, 0.92], [-1.25, -0.92], [-1.25, 0.92]];
  const wheels = WH.map(([x, z], i) => {
    const g = new THREE.Group(); g.position.set(x, -0.45, z); root.add(g);
    const spinG = new THREE.Group(); g.add(spinG);
    for (const [geo, m] of fit.wheels[i]) { const o = new THREE.Mesh(geo, matFor(m)); o.castShadow = !ghost; spinG.add(o); }
    return { g, spinG, x, z };
  });
  // the driver: suit and helmet (the paint), sat in the seat
  const suit = ghostMat || new THREE.MeshStandardMaterial({ color: '#e8452f', roughness: 0.8 }); const helmet = ghostMat || new THREE.MeshPhysicalMaterial({ color: paintCol, roughness: 0.3, clearcoat: 1 });
  const visor = ghostMat || new THREE.MeshStandardMaterial({ color: '#0d1117', roughness: 0.1, metalness: 0.6 }); if (!ghost) own.push(suit, helmet, visor);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = !ghost; body.add(o); own.push(geo); return o; };
  add(new THREE.CapsuleGeometry(0.19, 0.32, 4, 10), suit, -0.3, 0.12, 0); add(new THREE.SphereGeometry(0.16, 16, 12), helmet, -0.26, 0.5, 0); add(new THREE.BoxGeometry(0.06, 0.08, 0.2), visor, -0.12, 0.5, 0);
  return { root, body, wheels, car: true, buggy: true, file: true, susp: { mount: -0.12, rest: 0.52, travel: 0.5 }, ghost: !!ghost,
    materials: ghostMat ? [ghostMat] : own.filter((m) => m.isMaterial), dispose: () => own.forEach((x) => !x.isMaterial && x.dispose()) };
}

/** Move the car to a snapshot: s.px, s.pz, s.y, s.h (MotoCore heading), s.car = { p: pitch, r: roll, st: steer, w: [front spin, rear spin], c: [4 spring compressions] }. */
export function poseCar(m, s) {
  const c = s.car || { p: 0, r: 0, st: 0, w: [0, 0], c: [0.12, 0.12, 0.12, 0.12] };
  m.root.position.set(s.px, s.y, s.pz);
  m.root.rotation.set(-c.r, -s.h, c.p, 'YZX');   // (heading, then pitch, then roll about the car's own length)
  if (m.wing) {   // (the wingsuit: under the parachute you hang upright beneath it)
    const k = Math.min(1, c.c[0] || 0); m.chute.visible = k > 0; m.chute.scale.set(1, 0.3 + 0.7 * k, 0.3 + 0.7 * k); m.body.rotation.z = k * 1.45; m.body.position.y = k * 0.55;
  }
  m.wheels.forEach((wh, i) => {
    wh.g.position.y = m.susp ? m.susp.mount - (m.susp.rest - Math.min(c.c[i], m.susp.travel)) : -0.2 - (0.34 - Math.min(c.c[i], 0.2)) + (wh.lift || 0);   // (the spring mount, less the spring's length now, but only a little way up into the arch; a bigger wheel sits higher)
    wh.g.rotation.y = i < 2 ? -c.st * 0.55 : 0;
    wh.spinG.rotation.z = -c.w[i < 2 ? 0 : 1];
  });
}

export function disposeCar(m) {
  m.dispose?.();   // (its own parts: a model file's shared geometry stays)
  if (!m.file) m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });   // (a model file's geometry is shared by every car made from it)
  for (const mat of m.materials) mat.dispose();
  if (m.root.parent) m.root.parent.remove(m.root);
}
