/* Motocross: the 3D bike and rider, built from code (no model files). Every moving part follows the
   physics: the fork slides, the swingarm swings, the shock squashes, the wheels spin, and the rider's
   body (hips from the physics, arms and legs worked out to reach the bars and the pegs) moves with it.
   Bike coordinates: +X forward, +Y up, +Z to the rider's right; the origin is the frame's centre of
   mass (MotoCore's frame), so wheel and rider positions from the physics drop straight in. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// paint jobs; the ids match the "bikes" rewards in /data/unlocks.json
export const LIVERIES = {
  factory: { name: 'Factory Red', plastic: '#d61f2c', accent: '#ffffff', dark: '#15171c', seat: '#1b1d22', rim: '#1d1f24', frame: '#b9bec6', jersey: '#d61f2c', jersey2: '#ffffff', pants: '#1b1d22', helmet: '#ffffff', helmet2: '#d61f2c', boots: '#f2f2f2', number: 7 },
  lime: { name: 'Lime Green', plastic: '#6fc21b', accent: '#111316', dark: '#111316', seat: '#111316', rim: '#1d1f24', frame: '#6fc21b', jersey: '#111316', jersey2: '#6fc21b', pants: '#111316', helmet: '#6fc21b', helmet2: '#111316', boots: '#111316', number: 3 },
  blue: { name: 'Racing Blue', plastic: '#1747c9', accent: '#ffffff', dark: '#0e1530', seat: '#1747c9', rim: '#1d1f24', frame: '#1747c9', jersey: '#1747c9', jersey2: '#ffffff', pants: '#ffffff', helmet: '#1747c9', helmet2: '#ffffff', boots: '#1747c9', number: 14 },
  orange: { name: 'Sunset Orange', plastic: '#ff6a10', accent: '#16181c', dark: '#16181c', seat: '#16181c', rim: '#ff6a10', frame: '#ff6a10', jersey: '#ff6a10', jersey2: '#16181c', pants: '#16181c', helmet: '#16181c', helmet2: '#ff6a10', boots: '#ff6a10', number: 21 },
  yellow: { name: 'Sun Yellow', plastic: '#ffd21a', accent: '#1747c9', dark: '#16181c', seat: '#1747c9', rim: '#1d1f24', frame: '#b9bec6', jersey: '#ffd21a', jersey2: '#1747c9', pants: '#1747c9', helmet: '#ffd21a', helmet2: '#1747c9', boots: '#ffffff', number: 5 },
  camo: { name: 'Desert Camo', plastic: '#b8925a', accent: '#5b4630', dark: '#3a2f22', seat: '#3a2f22', rim: '#8a6b3e', frame: '#8a7a62', jersey: '#b8925a', jersey2: '#5b4630', pants: '#5b4630', helmet: '#b8925a', helmet2: '#5b4630', boots: '#3a2f22', number: 66, camo: true },
  mud: { name: 'Mud Runner', plastic: '#6a4a2c', accent: '#b6d330', dark: '#2a1f15', seat: '#2a1f15', rim: '#b6d330', frame: '#4a3a2a', jersey: '#6a4a2c', jersey2: '#b6d330', pants: '#2a1f15', helmet: '#b6d330', helmet2: '#6a4a2c', boots: '#2a1f15', number: 88 },
  white: { name: 'Glacier White', plastic: '#f3f5f8', accent: '#2a7fff', dark: '#1b2a44', seat: '#2a7fff', rim: '#2a7fff', frame: '#cfd6df', jersey: '#f3f5f8', jersey2: '#2a7fff', pants: '#2a7fff', helmet: '#f3f5f8', helmet2: '#2a7fff', boots: '#f3f5f8', number: 1 },
  black: { name: 'Midnight', plastic: '#17191e', accent: '#ffd21a', dark: '#0b0c0f', seat: '#0b0c0f', rim: '#ffd21a', frame: '#2a2d33', jersey: '#17191e', jersey2: '#ffd21a', pants: '#17191e', helmet: '#17191e', helmet2: '#ffd21a', boots: '#17191e', number: 13 },
  neon: { name: 'Neon Arcade', plastic: '#8b3dff', accent: '#39ff88', dark: '#1a0f33', seat: '#1a0f33', rim: '#39ff88', frame: '#8b3dff', jersey: '#8b3dff', jersey2: '#39ff88', pants: '#1a0f33', helmet: '#39ff88', helmet2: '#8b3dff', boots: '#8b3dff', number: 99, glow: true },
  gold: { name: 'Gold Rush', plastic: '#e3b021', accent: '#16181c', dark: '#16181c', seat: '#16181c', rim: '#e3b021', frame: '#e3b021', jersey: '#16181c', jersey2: '#e3b021', pants: '#16181c', helmet: '#e3b021', helmet2: '#16181c', boots: '#e3b021', number: 1, metal: true },
  chrome: { name: 'Chrome', plastic: '#d9dde3', accent: '#ff3b7f', dark: '#22252b', seat: '#22252b', rim: '#ff3b7f', frame: '#d9dde3', jersey: '#22252b', jersey2: '#ff3b7f', pants: '#22252b', helmet: '#d9dde3', helmet2: '#ff3b7f', boots: '#22252b', number: 0, chrome: true },
};

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

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

// ------------------------------------------------------------------ materials
function std(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o }); }
function paint(color, o = {}) { return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12, ...o }); }

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The graphics on the side panels: stripes, a number and the Party Arcade name. */
function graphics(lv) {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = lv.plastic; g.fillRect(0, 0, w, h);
    if (lv.camo) {
      for (let i = 0; i < 70; i++) {
        g.fillStyle = ['#8f7146', '#5b4630', '#d4b783'][i % 3];
        g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 70, 18 + Math.random() * 40, Math.random() * 3, 0, 7); g.fill();
      }
    }
    g.save(); g.translate(w * 0.5, h * 0.5); g.rotate(-0.35);
    g.fillStyle = lv.accent; g.fillRect(-w, -h * 0.02, w * 2, h * 0.12);
    g.fillStyle = lv.dark; g.fillRect(-w, h * 0.14, w * 2, h * 0.05);
    g.restore();
    // number box
    g.fillStyle = lv.accent; roundRect(g, w * 0.55, h * 0.12, w * 0.36, h * 0.6, 40); g.fill();
    g.fillStyle = lv.accent === '#ffffff' || lv.accent === '#ffd21a' || lv.accent === '#39ff88' || lv.accent === '#b6d330' ? lv.dark : '#ffffff';
    g.font = `italic 900 ${h * 0.5}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lv.number), w * 0.73, h * 0.43);
    g.fillStyle = lv.dark; g.font = `italic 800 ${h * 0.11}px Kanit, Arial Black, sans-serif`; g.textAlign = 'left';
    g.fillText('PARTY ARCADE', w * 0.05, h * 0.86);
  });
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function numberPlate(lv) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = lv.accent === '#ffffff' ? lv.plastic : '#ffffff'; roundRect(g, 0, 0, w, h, 40); g.fill();
    g.fillStyle = lv.accent === '#ffffff' ? '#ffffff' : lv.dark;
    g.font = `italic 900 ${h * 0.62}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lv.number), w / 2, h * 0.55);
  });
}

function materials(lv, ghost) {
  if (ghost) {
    const m = new THREE.MeshStandardMaterial({ color: ghost, roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.42, depthWrite: false, emissive: ghost, emissiveIntensity: 0.25 });
    const d = new THREE.MeshStandardMaterial({ color: new THREE.Color(ghost).multiplyScalar(0.45), roughness: 0.5, transparent: true, opacity: 0.38, depthWrite: false });
    return new Proxy({}, { get: (_, k) => (/rubber|dark|seat|engine|black|boots|pants|lens/.test(k) ? d : m) });
  }
  const plastic = lv.chrome ? new THREE.MeshPhysicalMaterial({ color: lv.plastic, metalness: 1, roughness: 0.08, clearcoat: 1 })
    : lv.metal ? new THREE.MeshPhysicalMaterial({ color: lv.plastic, metalness: 0.85, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 })
      : paint(lv.plastic, lv.glow ? { emissive: lv.plastic, emissiveIntensity: 0.15 } : {});
  const gfx = graphics(lv);
  return {
    plastic,
    graphics: lv.chrome || lv.metal ? plastic : paint('#ffffff', { map: gfx }),
    accent: paint(lv.accent),
    plate: std('#ffffff', { map: numberPlate(lv), roughness: 0.45 }),
    dark: std(lv.dark, { roughness: 0.55 }),
    black: std('#111214', { roughness: 0.5 }),
    seat: std(lv.seat, { roughness: 0.85 }),
    rubber: std('#161617', { roughness: 0.95 }),
    alu: std('#c9ced6', { metalness: 1, roughness: 0.32 }),
    frame: lv.frame === '#b9bec6' || lv.frame === '#cfd6df' ? std(lv.frame, { metalness: 1, roughness: 0.3 }) : paint(lv.frame, { metalness: 0.4 }),
    chrome: std('#eef1f5', { metalness: 1, roughness: 0.08 }),
    gold: std('#d4a23a', { metalness: 1, roughness: 0.28 }),
    rim: lv.rim === '#1d1f24' ? std('#1d1f24', { metalness: 0.8, roughness: 0.35 }) : paint(lv.rim, { metalness: 0.6, roughness: 0.25 }),
    engine: std('#3a3d44', { metalness: 0.7, roughness: 0.45 }),
    mag: std('#8d9096', { metalness: 0.9, roughness: 0.4 }),
    pipe: new THREE.MeshPhysicalMaterial({ color: '#b78f6a', metalness: 1, roughness: 0.25, iridescence: 0.6, iridescenceIOR: 1.5 }),
    silencer: std('#d8dce2', { metalness: 1, roughness: 0.22 }),
    carbon: std('#1a1b1e', { roughness: 0.35, metalness: 0.2 }),
    spring: paint(lv.accent === '#ffffff' ? lv.plastic : lv.accent),
    jersey: std(lv.jersey, { roughness: 0.82 }),
    jersey2: std(lv.jersey2, { roughness: 0.82 }),
    pants: std(lv.pants, { roughness: 0.8 }),
    boots: std(lv.boots, { roughness: 0.55 }),
    helmet: paint(lv.helmet),
    helmet2: paint(lv.helmet2),
    lens: new THREE.MeshPhysicalMaterial({ color: '#ffb02e', metalness: 1, roughness: 0.05, iridescence: 1 }),
    skin: std('#e8b996', { roughness: 0.7 }),
  };
}

// ------------------------------------------------------------------ geometry helpers
function tube(points, r, seg = 24, radial = 10) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), seg, r, radial, false);
}
function extrudeSide(pts, depth, bevel = 0.012, curveSeg = 6) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curveSeg });
  g.translate(0, 0, -depth / 2);
  return g;
}
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m;
}
/** A capsule from a to b (kept as one mesh you move every frame). */
function limb(r, len, mat) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.userData.len = len;
  return m;
}
const tmpDir = new THREE.Vector3();
function placeLimb(m, a, b) {
  m.position.copy(a).add(b).multiplyScalar(0.5);
  tmpDir.copy(b).sub(a);
  const L = tmpDir.length();
  if (L > 1e-5) m.quaternion.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / L));
}

/** Where a joint (elbow, knee) goes so both bones reach from a to b; pole says which way it bends. */
function ik(a, b, l1, l2, pole, out) {
  tmpDir.copy(b).sub(a);
  let d = tmpDir.length();
  const dir = tmpDir.multiplyScalar(1 / (d || 1));
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return out.copy(a).addScaledVector(dir, x).addScaledVector(p, hgt);
}

// ------------------------------------------------------------------ wheels
const wheelGeo = {};
function wheel(R, front, M) {
  const g = new THREE.Group();
  const key = R + (front ? 'f' : 'r');
  if (!wheelGeo[key]) {
    const tyreR = front ? 0.052 : 0.06;
    const ring = R - tyreR;
    const tyre = new THREE.TorusGeometry(ring, tyreR, 14, 56);
    // knobbly tread: two staggered rows of knobs plus a centre row
    const knobs = [];
    const n = 44;
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 0, 1]) {
        if (side === 0 && i % 2) continue;
        const ang = (i + (side ? 0.5 * (side > 0) : 0)) / n * Math.PI * 2;
        const k = new RoundedBoxGeometry(0.026, 0.022, side ? 0.03 : 0.036, 1, 0.006);
        const rr = ring + tyreR * (side ? 0.82 : 0.98);
        k.rotateZ(ang + Math.PI / 2);
        k.translate(Math.cos(ang) * rr, Math.sin(ang) * rr, side * tyreR * 0.55);
        knobs.push(k);
      }
    }
    const rimR = ring - tyreR * 0.8;
    const rim = new THREE.TorusGeometry(rimR, 0.016, 8, 48);
    rim.scale(1, 1, 1.6);
    const spokes = [];
    for (let i = 0; i < 36; i++) {
      const ang = i / 36 * Math.PI * 2; const side = i % 2 ? 1 : -1;
      const hubA = ang + side * 0.35;
      const a = V(Math.cos(hubA) * 0.045, Math.sin(hubA) * 0.045, side * 0.045);
      const b = V(Math.cos(ang) * (rimR - 0.012), Math.sin(ang) * (rimR - 0.012), side * 0.008);
      const c = new THREE.CylinderGeometry(0.0022, 0.0022, a.distanceTo(b), 4);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
      c.applyQuaternion(q); c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      spokes.push(c);
    }
    const hub = new THREE.CylinderGeometry(0.045, 0.045, 0.13, 20); hub.rotateX(Math.PI / 2);
    const disc = new THREE.CylinderGeometry(front ? 0.135 : 0.12, front ? 0.135 : 0.12, 0.005, 36, 1);
    disc.rotateX(Math.PI / 2); disc.translate(0, 0, front ? -0.075 : 0.075);
    wheelGeo[key] = { tyre: mergeAll([tyre, ...knobs]), rim, spokes: mergeAll(spokes), hub, disc };
  }
  const G = wheelGeo[key];
  g.add(mesh(G.tyre, M.rubber), mesh(G.rim, M.rim), mesh(G.spokes, M.chrome), mesh(G.hub, M.alu), mesh(G.disc, M.chrome));
  return g;
}

// ------------------------------------------------------------------ the bike
const FORK_U = V(-0.454, 0.891).normalize();   // fork axis (from the axle up), as in core.js
const FORK_0 = V(0.84, -0.32);                  // the front axle at full extension (core.js P.SUS[0].p)
const onFork = (t) => FORK_0.clone().addScaledVector(FORK_U, t);
const FORK_ANGLE = Math.atan2(-FORK_U.x, FORK_U.y);
const PIVOT = V(-0.17, -0.08);                  // swingarm pivot
export const GRIPS = V(0.27, 0.74);             // handlebar grips (each side ±0.38)
const PEGS = V(-0.11, -0.19);                   // footpegs (each side ±0.17)

/** Build a bike + rider. opts: { livery id, ghost colour (makes a see-through ghost), name tag text }. */
export function makeBike(opts = {}) {
  const lv = LIVERIES[opts.livery] || LIVERIES.factory;
  const M = materials(lv, opts.ghost);
  const root = new THREE.Group(); root.rotation.order = 'YZX';
  const body = new THREE.Group(); root.add(body);

  // frame: twin aluminium spars, a downtube cradle and the subframe
  for (const z of [-0.1, 0.1]) {
    body.add(mesh(tube([V(0.42, 0.5, z * 0.4), V(0.22, 0.44, z), V(-0.02, 0.3, z * 1.1), V(-0.16, 0.12, z * 1.1), PIVOT.clone().setZ(z * 1.05)], 0.026), M.frame));
    body.add(mesh(tube([V(-0.12, 0.3, z * 0.9), V(-0.45, 0.36, z * 0.8), V(-0.78, 0.42, z * 0.5)], 0.013), M.frame));
    body.add(mesh(tube([V(-0.16, 0.0, z * 0.9), V(-0.45, 0.2, z * 0.8), V(-0.7, 0.36, z * 0.6)], 0.011), M.frame));
    body.add(mesh(tube([V(0.36, 0.32, z * 0.3), V(0.28, 0.0, z * 0.7), V(0.16, -0.26, z * 0.7), V(-0.12, -0.26, z * 0.7), V(-0.17, -0.1, z * 0.9)], 0.014), M.frame));
  }
  const stem = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 16), M.frame); stem.position.copy(onFork(0.86)); stem.rotation.z = FORK_ANGLE; body.add(stem);
  // engine: cylinder and head tilted forward, crankcase, clutch and ignition covers
  const head = mesh(new RoundedBoxGeometry(0.17, 0.24, 0.17, 3, 0.03), M.engine, 0.14, 0.08, 0); head.rotation.z = -0.32; body.add(head);
  for (let i = 0; i < 5; i++) { const fin = mesh(new THREE.BoxGeometry(0.2, 0.008, 0.2), M.mag, 0.14 + i * 0.012, 0.0 + i * 0.035, 0); fin.rotation.z = -0.32; body.add(fin); }
  body.add(mesh(new RoundedBoxGeometry(0.36, 0.2, 0.24, 3, 0.05), M.engine, -0.01, -0.13, 0));
  const clutch = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 28), M.mag, -0.02, -0.11, 0.13); clutch.rotation.x = Math.PI / 2; body.add(clutch);
  const ign = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24), M.mag, 0.06, -0.12, -0.13); ign.rotation.x = Math.PI / 2; body.add(ign);
  body.add(mesh(new RoundedBoxGeometry(0.42, 0.03, 0.2, 2, 0.01), M.black, 0.0, -0.25, 0));   // skid plate
  // radiators (behind the shrouds) and the fuel tank
  for (const z of [-0.13, 0.13]) body.add(mesh(new RoundedBoxGeometry(0.16, 0.24, 0.035, 2, 0.01), M.black, 0.28, 0.22, z));
  body.add(mesh(new RoundedBoxGeometry(0.34, 0.16, 0.26, 4, 0.07), M.plastic, 0.12, 0.42, 0));
  // exhaust: header round the front of the engine, then up to the silencer on the right
  body.add(mesh(tube([V(0.22, 0.06, 0.04), V(0.3, -0.02, 0.07), V(0.24, -0.16, 0.12), V(0.04, -0.12, 0.16), V(-0.18, 0.08, 0.17), V(-0.36, 0.26, 0.16)], 0.022, 40), M.pipe));
  const sil = mesh(new THREE.CylinderGeometry(0.052, 0.048, 0.42, 24), M.silencer, -0.56, 0.33, 0.165); sil.rotation.z = Math.PI / 2 - 0.2; body.add(sil);
  const cap = mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.05, 24), M.carbon, -0.78, 0.38, 0.165); cap.rotation.z = Math.PI / 2 - 0.2; body.add(cap);
  // plastics: shrouds, side panels, seat, rear fender, front fender, number plates
  for (const side of [-1, 1]) {
    const z = side * 0.16;
    const shroud = mesh(extrudeSide([[0.44, 0.44], [0.2, 0.56, 0.02, 0.5], [-0.06, 0.36], [0.02, 0.16, 0.14, 0.14], [0.38, 0.18], [0.46, 0.3]], 0.012), M.graphics, 0, 0, z);
    body.add(shroud);
    const panel = mesh(extrudeSide([[-0.26, 0.4], [-0.84, 0.45], [-0.86, 0.34], [-0.6, 0.2, -0.34, 0.2]], 0.012), M.graphics, 0, 0, side * 0.115);
    body.add(panel);
  }
  body.add(mesh(extrudeSide([[0.06, 0.5], [-0.3, 0.5, -0.82, 0.46], [-0.84, 0.41], [-0.3, 0.41, 0.0, 0.42]], 0.17, 0.03), M.seat, 0, 0, 0));
  body.add(mesh(extrudeSide([[-0.6, 0.44], [-0.9, 0.47, -1.08, 0.55], [-1.09, 0.52], [-0.9, 0.42, -0.62, 0.39]], 0.15, 0.015), M.plastic, 0, 0, 0));
  body.add(mesh(extrudeSide([[0.52, 0.2], [0.78, 0.27, 1.16, 0.16], [1.15, 0.13], [0.8, 0.22, 0.53, 0.16]], 0.13, 0.015), M.plastic, 0, 0, 0));
  const plate = mesh(new RoundedBoxGeometry(0.02, 0.24, 0.27, 2, 0.008), M.plate); plate.position.copy(onFork(0.86)).add(V(FORK_U.y, -FORK_U.x).multiplyScalar(0.1)); plate.rotation.z = FORK_ANGLE; body.add(plate);
  // triple clamps and the fork's outer tubes, on the same axis the physics uses
  for (const t of [0.97, 0.8]) { const cl = mesh(new RoundedBoxGeometry(0.08, 0.035, 0.3, 2, 0.012), M.alu); cl.position.copy(onFork(t)); cl.rotation.z = FORK_ANGLE; body.add(cl); }
  for (const z of [-0.11, 0.11]) {
    const outer = mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.58, 18), M.gold);
    outer.position.copy(onFork(0.71)).setZ(z); outer.rotation.z = FORK_ANGLE; body.add(outer);
  }
  body.add(mesh(tube([V(0.3, 0.73, -0.39), V(0.33, 0.7, -0.2), V(0.38, 0.62, 0), V(0.33, 0.7, 0.2), V(0.3, 0.73, 0.39)], 0.012, 30), M.alu));
  body.add(mesh(new RoundedBoxGeometry(0.05, 0.03, 0.2, 2, 0.01), M.black, 0.38, 0.66, 0));
  for (const z of [-1, 1]) {
    const grip = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.13, 14), M.black, GRIPS.x, GRIPS.y, z * 0.38); grip.rotation.x = Math.PI / 2; body.add(grip);
    const lever = mesh(tube([V(0.31, 0.73, z * 0.3), V(0.37, 0.72, z * 0.34), V(0.4, 0.7, z * 0.42)], 0.006, 8, 6), M.alu); body.add(lever);
    body.add(mesh(new RoundedBoxGeometry(0.06, 0.02, 0.05, 1, 0.006), M.alu, PEGS.x, PEGS.y, z * 0.17));
  }

  // the moving parts
  const forkLower = new THREE.Group(); root.add(forkLower);   // at the front axle
  for (const z of [-0.11, 0.11]) {
    const inner = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.5, 16), M.chrome); inner.position.copy(FORK_U).multiplyScalar(0.3).setZ(z); inner.quaternion.setFromUnitVectors(UP, FORK_U); forkLower.add(inner);
    const guard = mesh(new RoundedBoxGeometry(0.06, 0.24, 0.04, 2, 0.015), M.plastic); guard.position.copy(FORK_U).multiplyScalar(0.1).setZ(z * 1.15); guard.quaternion.setFromUnitVectors(UP, FORK_U); forkLower.add(guard);
  }
  const caliper = mesh(new RoundedBoxGeometry(0.07, 0.05, 0.03, 1, 0.01), M.alu, -0.08, 0.1, -0.09); forkLower.add(caliper);
  const frontWheel = wheel(0.35, true, M); root.add(frontWheel);
  const rearWheel = wheel(0.34, false, M); root.add(rearWheel);
  const sprocket = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.008, 40), M.alu, 0, 0, -0.08); sprocket.rotation.x = Math.PI / 2; rearWheel.add(sprocket);
  const swing = new THREE.Group(); swing.position.copy(PIVOT); root.add(swing);   // points along +X to the rear axle
  for (const z of [-0.09, 0.09]) swing.add(mesh(extrudeSide([[0, 0.04], [0.56, 0.03], [0.6, 0], [0.56, -0.03], [0, -0.05]], 0.03, 0.008), M.alu, 0, 0, z));
  swing.add(mesh(new RoundedBoxGeometry(0.08, 0.06, 0.2, 2, 0.015), M.alu, 0.05, -0.02, 0));
  const chain = mesh(tube([V(0.05, 0.08, -0.1), V(0.3, 0.1, -0.1), V(0.6, 0.11, -0.1)], 0.008, 10, 5), M.black); swing.add(chain);
  const shockTop = V(-0.1, 0.33);
  const spring = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => V(Math.cos(i * 0.9) * 0.034, i / 59, Math.sin(i * 0.9) * 0.034))), 120, 0.006, 6), M.spring);
  const shockBody = mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 14), M.gold);
  const reservoir = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 14), M.black, -0.06, 0.38, 0.06); body.add(reservoir);
  root.add(spring, shockBody);
  // nitro flame out of the silencer
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.z = Math.PI / 2 - 0.2; flame.position.set(-0.99, 0.43, 0.165); flame.visible = false; body.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.25, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame2.rotation.copy(flame.rotation); flame2.position.set(-0.92, 0.41, 0.165); flame2.visible = false; body.add(flame2);

  // ------------------------------------------------------------ the rider
  const R = new THREE.Group(); root.add(R);
  const parts = {
    pelvis: mesh(new THREE.SphereGeometry(0.135, 20, 14), M.pants),
    torso: limb(0.15, 0.56, M.jersey),
    chest: mesh(new RoundedBoxGeometry(0.2, 0.28, 0.34, 3, 0.07), M.jersey2),
    neck: limb(0.055, 0.1, M.jersey2),
    helmet: new THREE.Group(),
    upperArm: [limb(0.052, 0.3, M.jersey), limb(0.052, 0.3, M.jersey)],
    foreArm: [limb(0.046, 0.3, M.jersey2), limb(0.046, 0.3, M.jersey2)],
    hand: [mesh(new RoundedBoxGeometry(0.08, 0.06, 0.08, 2, 0.02), M.jersey2), mesh(new RoundedBoxGeometry(0.08, 0.06, 0.08, 2, 0.02), M.jersey2)],
    thigh: [limb(0.075, 0.45, M.pants), limb(0.075, 0.45, M.pants)],
    shin: [limb(0.07, 0.44, M.boots), limb(0.07, 0.44, M.boots)],
    boot: [mesh(new RoundedBoxGeometry(0.28, 0.1, 0.12, 2, 0.03), M.boots), mesh(new RoundedBoxGeometry(0.28, 0.1, 0.12, 2, 0.03), M.boots)],
    knee: [mesh(new RoundedBoxGeometry(0.1, 0.14, 0.1, 2, 0.03), M.black), mesh(new RoundedBoxGeometry(0.1, 0.14, 0.1, 2, 0.03), M.black)],
  };
  parts.chest.scale.set(1, 1, 1);
  const hel = parts.helmet;
  const shell = mesh(new THREE.SphereGeometry(0.135, 32, 22), M.helmet); shell.scale.set(1.18, 1.02, 0.94); hel.add(shell);
  const stripe = mesh(new THREE.SphereGeometry(0.137, 32, 22, 0, Math.PI * 2, 0, 0.75), M.helmet2); stripe.scale.set(1.18, 1.02, 0.42); stripe.rotation.z = -0.25; hel.add(stripe);
  // MX helmet: a long chin bar sticking forward, a peak over the eyes, goggles
  const chinBar = mesh(extrudeSide([[0.04, -0.02], [0.2, -0.04, 0.21, -0.12], [0.16, -0.15], [0.06, -0.15, 0.0, -0.12]], 0.15, 0.03), M.helmet2); hel.add(chinBar);
  const peak = mesh(extrudeSide([[0.02, 0.1], [0.16, 0.12, 0.25, 0.06], [0.24, 0.04], [0.12, 0.08, 0.02, 0.07]], 0.19, 0.008), M.helmet2); hel.add(peak);
  const lens = mesh(new RoundedBoxGeometry(0.06, 0.06, 0.2, 2, 0.02), M.lens, 0.135, 0.015, 0); hel.add(lens);
  const strap = mesh(new THREE.TorusGeometry(0.135, 0.011, 6, 36), M.dark); strap.rotation.y = Math.PI / 2; strap.position.y = 0.015; strap.scale.set(1.0, 1.0, 1.2); hel.add(strap);
  R.add(parts.pelvis, parts.torso, parts.chest, parts.neck, hel, ...parts.upperArm, ...parts.foreArm, ...parts.hand, ...parts.thigh, ...parts.shin, ...parts.boot, ...parts.knee);
  hel.traverse((o) => { o.castShadow = true; });

  if (opts.ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
  const m = { root, body, forkLower, frontWheel, rearWheel, swing, spring, shockBody, flame, flame2, rider: R, parts, livery: lv, ghost: !!opts.ghost, materials: M };
  return m;
}

const tA = new THREE.Vector3(); const tB = new THREE.Vector3(); const tC = new THREE.Vector3(); const tD = new THREE.Vector3();
const hipC = new THREE.Vector3(); const sho = new THREE.Vector3(); const headP = new THREE.Vector3();
const poleArm = [V(-0.55, -0.5, -0.65), V(-0.55, -0.5, 0.65)];
const poleLeg = [V(1, 0.15, -0.35), V(1, 0.15, 0.35)];

/** Move a bike to a physics snapshot. s: { x, y, a, roll, wf: [x, y, ang], wr: [...], rx, ry, lean, boost, crashed, ragdoll: { hip, head } | null }
    (positions in the side-on plane), place(x, y, out) turns a plane point into world space (its lane is built in),
    heading: the track's direction there. */
export function poseBike(m, s, place, heading, t) {
  const root = m.root;
  place(s.x, s.y, root.position);
  root.rotation.set(s.roll || 0, -heading, s.a);
  const ca = Math.cos(-s.a); const sa = Math.sin(-s.a);
  const local = (x, y, out) => { const dx = x - s.x; const dy = y - s.y; return out.set(dx * ca - dy * sa, dx * sa + dy * ca, 0); };
  // wheels
  local(s.wf[0], s.wf[1], m.frontWheel.position); m.frontWheel.rotation.z = -s.wf[2];
  local(s.wr[0], s.wr[1], m.rearWheel.position); m.rearWheel.rotation.z = -s.wr[2];
  m.forkLower.position.copy(m.frontWheel.position);
  // swingarm from the pivot to the rear axle
  tA.copy(m.rearWheel.position).sub(PIVOT);
  m.swing.rotation.z = Math.atan2(tA.y, tA.x);
  m.swing.scale.x = tA.length() / 0.6;
  // shock: from its top mount to a link on the swingarm
  tB.copy(PIVOT).addScaledVector(tA, 0.32).add(V(0, 0.07, 0));
  tC.set(-0.1, 0.33, 0);
  tD.copy(tC).sub(tB);
  const len = tD.length();
  m.spring.position.copy(tB); m.spring.quaternion.setFromUnitVectors(UP, tD.clone().normalize()); m.spring.scale.set(1, len * 0.8, 1);
  placeLimb(m.shockBody, tB, tC); m.shockBody.scale.set(1, len, 1);
  // nitro flame
  m.flame.visible = m.flame2.visible = !!s.boost;
  if (s.boost) { const f = 0.8 + Math.sin(t * 60) * 0.15 + Math.random() * 0.15; m.flame.scale.set(1, f, 1); m.flame2.scale.set(1, f * 0.9, 1); }

  // the rider
  const P = m.parts;
  if (s.crashed && s.ragdoll) {
    // thrown off: hips and head from the ragdoll, arms and legs flailing
    const rg = s.ragdoll;
    local(rg.hip.x, rg.hip.y, hipC); local(rg.head.x, rg.head.y, headP);
    tA.copy(headP).sub(hipC).normalize();
    sho.copy(hipC).addScaledVector(tA, 0.5);
    poseTorso(P, hipC, sho, headP.copy(sho).addScaledVector(tA, 0.26), -Math.atan2(tA.x, tA.y));
    const side = V(-tA.y, tA.x, 0);
    for (let i = 0; i < 2; i++) {
      const z = i ? 0.18 : -0.18; const ph = t * 9 + i * 2;
      tB.copy(sho).setZ(z);
      tC.copy(tB).addScaledVector(side, Math.sin(ph) * 0.3).add(V(Math.cos(ph) * 0.2, 0.2, z * 1.5));
      tD.copy(tC).add(V(Math.sin(ph * 1.3) * 0.3, Math.cos(ph) * 0.25, z));
      placeLimb(P.upperArm[i], tB, tC); placeLimb(P.foreArm[i], tC, tD); P.hand[i].position.copy(tD);
      tB.copy(hipC).setZ(z * 0.6);
      tC.copy(tB).addScaledVector(tA, -0.45).add(V(Math.sin(ph * 0.8) * 0.2, 0, z * 0.5));
      tD.copy(tC).add(V(Math.cos(ph * 0.7) * 0.3, -0.35, 0));
      placeLimb(P.thigh[i], tB, tC); placeLimb(P.shin[i], tC, tD); P.boot[i].position.copy(tD); P.knee[i].position.copy(tC);
    }
    return;
  }
  local(s.rx, s.ry, hipC);
  hipC.y += 0.16;   // (the physics point is the rider's weight; the hips sit a little above it, standing on the pegs)
  // the torso leans to reach the bars: more when leaning forward, upright and back when leaning back
  let lean = 0.5 + 0.38 * Math.max(-1, Math.min(1, s.lean));
  for (let k = 0; k < 6; k++) {
    sho.set(hipC.x + Math.sin(lean) * 0.5, hipC.y + Math.cos(lean) * 0.5, 0);
    const reach = Math.hypot(GRIPS.x - sho.x, GRIPS.y - sho.y);
    if (reach > 0.56) lean += 0.08; else if (reach < 0.3) lean -= 0.06; else break;
  }
  headP.set(sho.x + Math.sin(lean * 0.55) * 0.23, sho.y + Math.cos(lean * 0.55) * 0.23, 0);
  poseTorso(P, hipC, sho, headP, lean);
  for (let i = 0; i < 2; i++) {
    const z = i ? 1 : -1;
    // arms: shoulder → elbow (out and up, MX style) → grip
    tB.set(sho.x - 0.02, sho.y - 0.03, z * 0.2);
    tD.set(GRIPS.x, GRIPS.y, z * 0.36);
    ik(tB, tD, 0.3, 0.3, poleArm[i], tC);
    placeLimb(P.upperArm[i], tB, tC); placeLimb(P.foreArm[i], tC, tD);
    P.hand[i].position.copy(tD); P.hand[i].rotation.z = -0.5;
    // legs: hip → knee (forward, gripping the bike) → ankle over the peg
    tB.set(hipC.x, hipC.y - 0.03, z * 0.1);
    tD.set(PEGS.x - 0.02, PEGS.y + 0.12, z * 0.2);
    ik(tB, tD, 0.45, 0.44, poleLeg[i], tC);
    placeLimb(P.thigh[i], tB, tC); placeLimb(P.shin[i], tC, tD);
    P.knee[i].position.copy(tC).add(V(0.04, 0, 0)); P.knee[i].quaternion.copy(P.shin[i].quaternion);
    P.boot[i].position.set(PEGS.x + 0.02, PEGS.y + 0.05, z * 0.2); P.boot[i].rotation.set(0, 0, 0);
  }
}

function poseTorso(P, hip, shoulder, head, lean) {
  P.pelvis.position.copy(hip);
  placeLimb(P.torso, hip, shoulder);
  P.torso.scale.set(0.85, 1, 1.25);
  P.chest.position.copy(hip).lerp(shoulder, 0.62).add(V(0.05, 0, 0).applyAxisAngle(V(0, 0, 1), -lean));
  P.chest.rotation.set(0, 0, -lean);
  tA.copy(shoulder).lerp(head, 0.35);
  placeLimb(P.neck, shoulder, tA);
  P.helmet.position.copy(head);
  P.helmet.rotation.set(0, 0, -lean * 0.35);
}

/** Free a bike's GPU memory (geometry shared between bikes is kept). */
export function disposeBike(m) {
  m.root.traverse((o) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((x) => { if (x.map) x.map.dispose(); x.dispose(); }); } });
  if (m.root.parent) m.root.parent.remove(m.root);
}
