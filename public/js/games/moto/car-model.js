/* Free ride: the supercars. Two are model files (a Lamborghini Revuelto and an Aventador, CC BY, credited on
   /credits) and one is built from code (a low wedge, also what shows while a model file loads). All are posed from
   car.js's state: the body pitches and rolls on its springs, the wheels spin, steer and follow the suspension.
   Car coordinates: +X forward, +Y up, +Z to the right, the origin the middle of the body (car.js's position),
   the ground 0.74 m below it. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

/** Move the car to a snapshot: s.px, s.pz, s.y, s.h (MotoCore heading), s.car = { p: pitch, r: roll, st: steer, w: [front spin, rear spin], c: [4 spring compressions] }. */
export function poseCar(m, s) {
  const c = s.car || { p: 0, r: 0, st: 0, w: [0, 0], c: [0.12, 0.12, 0.12, 0.12] };
  m.root.position.set(s.px, s.y, s.pz);
  m.root.rotation.set(-c.r, -s.h, c.p, 'YZX');   // (heading, then pitch, then roll about the car's own length)
  m.wheels.forEach((wh, i) => {
    wh.g.position.y = -0.2 - (0.34 - Math.min(c.c[i], 0.2)) + (wh.lift || 0);   // (the spring mount, less the spring's length now, but only a little way up into the arch; a bigger wheel sits higher)
    wh.g.rotation.y = i < 2 ? -c.st * 0.55 : 0;
    wh.spinG.rotation.z = -c.w[i < 2 ? 0 : 1];
  });
}

export function disposeCar(m) {
  if (!m.file) m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });   // (a model file's geometry is shared by every car made from it)
  for (const mat of m.materials) mat.dispose();
  if (m.root.parent) m.root.parent.remove(m.root);
}
