/* The shaped parts of Revvd's drawn dirt bike and MX rider, all made from code (no model files): curved plastics
   (shrouds, side plates, fenders, the front number plate), a twin-spar frame and tapered swingarm, spoked wheels with
   knobbly tyres and wave brake discs (and a spinning blur over the spokes at speed), a chain that runs round its
   sprockets, and the rider's kit: a helmet with a peak, chin bar and goggles, a loose jersey and pants, gloves and
   tall buckled boots, painted in the rider's kit and helmet colours. bike.js puts them together and moves them. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, roundRect, inkOn, revvdLogo, lum } from './bike-art.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ shapes
function build(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** A surface over a grid: f(u, v) -> [x, y, z] for u, v from 0 to 1 (its picture: u across, v down). It faces the
    way the cross product of the v and u directions points; flip turns it round. */
export function grid(nu, nv, f, flip = false) {
  const pos = []; const uv = []; const idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const u = i / nu; const v = j / nv; pos.push(...f(u, v)); uv.push(u, 1 - v); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const A = i * (nv + 1) + j; const B = A + nv + 1;
    if (flip) idx.push(A, B, A + 1, A + 1, B, B + 1); else idx.push(A, A + 1, B, A + 1, B + 1, B);
  }
  return build(pos, uv, idx);
}
/** A body panel on the bike's right side (facing +z): its edge along the top and along the bottom (side-on x, y, each
    from the back of the panel, u = 0, to the front, u = 1), and how far out it stands, z(x, y, u, v) (v: 0 top, 1 bottom).
    Its picture is u across (back to front) and v down. */
export function panel(top, bot, z, nu = 16, nv = 9) {
  return grid(nu, nv, (u, v) => { const a = top(u); const b = bot(u); const x = lerp(a[0], b[0], v); const y = lerp(a[1], b[1], v); return [x, y, z(x, y, u, v)]; });
}
/** The same part on the bike's left side: mirrored, with its picture turned so writing still reads the right way. */
export function mirrorZ(g, flipU = true) {
  const m = g.clone(); const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i));
  const ix = m.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  if (flipU) { const u = m.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, 1 - u.getX(i)); }
  m.computeVertexNormals();
  return m;
}
/** A tube along a path (points with z, bending in the side-on plane): sec(s, q) -> [a, b] is the section at s (0 to 1
    along the path), q (0 to 1) round it: a across the path in the side-on plane, b sideways (z). */
export function sweep(pts, seg, ring, sec) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const P = V(0, 0); const T = V(0, 0);
  return grid(seg, ring, (s, q) => {
    curve.getPointAt(s, P); curve.getTangentAt(s, T);
    const n = Math.hypot(T.x, T.y) || 1; const [a, b] = sec(s, q);
    return [P.x - T.y / n * a, P.y + T.x / n * a, P.z + b];
  });
}
/** A rounded-box section (p < 1: squarer), half sizes a (in the side-on plane) and b (sideways); either can be a
    function of s, and `ends` closes the tube by shrinking it to nothing at both ends. */
export const boxy = (a, b, p = 0.55, ends = 0) => (s, q) => {
  const t = q * Math.PI * 2; const c = Math.cos(t); const sn = Math.sin(t);
  const k = ends ? Math.sqrt(Math.min(1, s / ends, (1 - s) / ends)) : 1;
  const A = (typeof a === 'function' ? a(s) : a) * k; const B = (typeof b === 'function' ? b(s) : b) * k;
  return [A * Math.sign(c) * Math.abs(c) ** p, B * Math.sign(sn) * Math.abs(sn) ** p];
};
/** A limb along +y, centred, len long (as bike.js's placeLimb stands it from one joint to the next), radius r(t) from
    its start (t = 0) to its end; its picture goes round it (u: 0 = +z, a quarter = +x) and along it (v). */
export function limbGeo(len, r, seg = 10, around = 16, from = 0, to = 1) {
  const pts = [new THREE.Vector2(0.0005, -len / 2 + from * len - r(from) * 0.45)];
  for (let k = 0; k <= seg; k++) { const t = lerp(from, to, k / seg); pts.push(new THREE.Vector2(r(t), -len / 2 + t * len)); }
  pts.push(new THREE.Vector2(0.0005, -len / 2 + to * len + r(to) * 0.45));
  return new THREE.LatheGeometry(pts, around);
}
/** Join geometries into one (any mix of indexed and not), keeping position, normal and uv. */
export function joinGeos(list) {
  return mergeGeometries(list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  }));
}
const at = (g, x = 0, y = 0, z = 0, rz = 0, rx = 0, ry = 0) => { if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); return g.translate(x, y, z); };

// ------------------------------------------------------------------ wheels
const wheelCache = {};
/** A wheel's parts (made once for each size, shared by every bike): knobbly tyre, rim, spokes, hub, wave disc, the
    sprocket (rear) and the blur disc that stands in for the spokes when it spins fast. */
export function wheelGeos(R, front) {
  const key = R + (front ? 'f' : 'r');
  if (wheelCache[key]) return wheelCache[key];
  const rimR = front ? 0.267 : 0.241;                 // a 21" front rim, a 19" rear
  const tall = R - rimR - 0.012; const wide = front ? 0.041 : 0.054;
  const mid = rimR + tall / 2;
  const tyre = new THREE.TorusGeometry(mid, tall / 2, 16, 72); tyre.scale(1, 1, wide / (tall / 2));
  const knobs = [];
  const n = front ? 46 : 42;
  for (let i = 0; i < n; i++) {
    for (const side of [-1, 0, 1]) {
      if (side === 0 && i % 2) continue;
      const ang = (i + (side > 0 ? 0.5 : 0)) / n * Math.PI * 2;
      const k = new THREE.BoxGeometry(0.028, 0.019, side ? 0.026 : 0.032);
      const rr = mid + tall / 2 * (side ? 0.8 : 0.97);
      k.rotateX(side * 0.5); k.rotateZ(ang + Math.PI / 2);
      k.translate(Math.cos(ang) * rr, Math.sin(ang) * rr, side * wide * 0.62);
      knobs.push(k);
    }
  }
  // the rim: an aluminium channel (its profile turned round the axle)
  const prof = [[-0.013, -0.029], [0.007, -0.031], [0.011, -0.024], [-0.002, -0.019], [-0.004, 0.019], [0.011, 0.024], [0.007, 0.031], [-0.013, 0.029], [-0.017, 0]];
  const rim = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(rimR + r, z)), 64); rim.rotateX(Math.PI / 2);
  const spokes = [];
  for (let i = 0; i < 36; i++) {
    const ang = i / 36 * Math.PI * 2; const side = i % 2 ? 1 : -1; const lead = (i % 4 < 2 ? 1 : -1) * 0.42;
    const a = V(Math.cos(ang + lead) * 0.052, Math.sin(ang + lead) * 0.052, side * 0.043);
    const b = V(Math.cos(ang) * (rimR - 0.016), Math.sin(ang) * (rimR - 0.016), side * 0.007);
    const c = new THREE.CylinderGeometry(0.0021, 0.0021, a.distanceTo(b), 4, 1, true);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1), b.clone().sub(a).normalize()));
    c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    spokes.push(c);
    const nip = new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 5); nip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1), b.clone().sub(a).normalize())); nip.translate(b.x, b.y, b.z);
    spokes.push(nip);
  }
  // the hub: a barrel between two spoke flanges, the axle nuts at the ends
  const hubP = [[0.012, -0.08], [0.03, -0.075], [0.03, -0.06], [0.058, -0.052], [0.058, -0.04], [0.036, -0.034], [0.034, 0.034], [0.058, 0.04], [0.058, 0.052], [0.03, 0.06], [0.03, 0.075], [0.012, 0.08]];
  const hub = new THREE.LatheGeometry(hubP.map(([r, z]) => new THREE.Vector2(r, z)), 28); hub.rotateX(Math.PI / 2);
  // a wave disc: a wavy outer edge, slots and bolts on a carrier
  const dr = front ? 0.135 : 0.12;
  const s = new THREE.Shape();
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; const r = dr + Math.sin(a * 12) * 0.0055; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const hole = new THREE.Path(); hole.absarc(0, 0, dr - 0.032, 0, Math.PI * 2, true); s.holes.push(hole);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const h = new THREE.Path(); h.absarc(Math.cos(a) * (dr - 0.016), Math.sin(a) * (dr - 0.016), 0.0045, 0, Math.PI * 2, true); s.holes.push(h); }
  const disc = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: 4 }); disc.translate(0, 0, (front ? -0.07 : 0.07) - 0.002);
  const carrier = new THREE.CylinderGeometry(dr - 0.03, dr - 0.03, 0.006, 6); carrier.rotateX(Math.PI / 2); carrier.translate(0, 0, front ? -0.066 : 0.066);
  const blur = new THREE.RingGeometry(0.05, rimR - 0.014, 48, 1);
  const out = { tyre: joinGeos([tyre, ...knobs]), rim, spokes: joinGeos(spokes), hub, disc: joinGeos([disc, carrier]), blur, rimR };
  if (!front) {
    // the rear sprocket (on the left, -z), with teeth and lightening holes
    const sp = new THREE.Shape(); const T = 48;
    for (let i = 0; i <= T * 2; i++) { const a = i / (T * 2) * Math.PI * 2; const r = i % 2 ? 0.112 : 0.104; if (i) sp.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sp.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const h = new THREE.Path(); h.absarc(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.019, 0, Math.PI * 2, true); sp.holes.push(h); }
    const c = new THREE.Path(); c.absarc(0, 0, 0.032, 0, Math.PI * 2, true); sp.holes.push(c);
    out.sprocket = new THREE.ExtrudeGeometry(sp, { depth: 0.006, bevelEnabled: false, curveSegments: 3 }).translate(0, 0, -0.082);
  }
  for (const g of Object.values(out)) if (g && g.isBufferGeometry) g.userData.shared = true;
  return (wheelCache[key] = out);
}
/** The blur over spinning spokes: soft streaks round the hub, see-through (one per bike: its opacity follows the wheel's speed). */
let blurTex = null;
export function blurMaterial(color) {
  if (!blurTex) {
    blurTex = canvasTex(512, 64, (g, w, h) => {
      // (u goes round the ring, v from the hub out: a ring's picture is laid along it)
      for (let x = 0; x < w; x++) { const k = 0.35 + 0.65 * Math.abs(Math.sin(x / w * Math.PI * 18)) ** 6; g.fillStyle = `rgba(255,255,255,${(0.16 + k * 0.4).toFixed(3)})`; g.fillRect(x, 0, 1, h); }
      const fade = g.createLinearGradient(0, 0, 0, h); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.15, 'rgba(0,0,0,1)'); fade.addColorStop(0.85, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in'; g.fillStyle = fade; g.fillRect(0, 0, w, h);
    });
    blurTex.userData = { shared: true };
  }
  const m = new THREE.MeshStandardMaterial({ color, map: blurTex, metalness: 0.35, roughness: 0.6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  m.userData.keepMap = true;
  return m;
}
/** Lay a ring's picture round it (RingGeometry's own uv is a flat x-y projection). */
export function ringUV(g, inner, outer) {
  const p = g.attributes.position; const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); const y = p.getY(i); uv.setXY(i, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - inner) / (outer - inner)); }
  return g;
}

// ------------------------------------------------------------------ the chain
/** A chain loop (in the swingarm's frame: the rear axle at x = len, the gearbox sprocket at x = 0) and its material,
    whose links scroll round as the rear wheel turns (set by turning the links: chainTurn). */
export function chainGeo(len, rRear = 0.108, rFront = 0.042) {
  const pts = [];
  const N = 18;
  for (let i = 0; i <= N; i++) { const a = Math.PI / 2 - i / N * Math.PI; pts.push(V(len + Math.cos(a) * rRear, Math.sin(a) * rRear)); }   // round the back of the sprocket
  for (let i = 1; i < 6; i++) pts.push(V(lerp(len, 0, i / 6), lerp(-rRear, -rFront, i / 6)));
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 - i / 10 * Math.PI; pts.push(V(Math.cos(a) * rFront, Math.sin(a) * rFront)); }
  for (let i = 1; i < 6; i++) pts.push(V(lerp(0, len, i / 6), lerp(rFront, rRear, i / 6)));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const L = curve.getLength(); const links = Math.round(L / 0.0159);
  const P = V(0, 0); const T = V(0, 0);
  const g = grid(160, 8, (s, q) => {
    curve.getPointAt(s % 1, P); curve.getTangentAt(s % 1, T);
    const t = q * Math.PI * 2; const a = 0.0055 * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.4; const b = 0.0075 * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.4;
    return [P.x - T.y * a, P.y + T.x * a, b];
  });
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));   // (u along the chain)
  return { geo: g, length: L, links };
}
let linkImg = null;
export function chainMaterial(links) {
  if (!linkImg) linkImg = canvasTex(64, 32, (g, w, h) => {
    g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6b6e74'; roundRect(g, 2, 3, w - 4, h - 6, 10); g.fill();
    g.fillStyle = '#1a1b1d'; g.fillRect(w / 2 - 2, 0, 4, h);
    g.fillStyle = '#9a9ea6'; for (const x of [10, w - 10]) { g.beginPath(); g.arc(x, h / 2, 5, 0, 7); g.fill(); }
  });
  const map = linkImg.clone(); map.wrapS = THREE.RepeatWrapping; map.repeat.set(links, 1); map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, metalness: 0.75, roughness: 0.42 });
}

// ------------------------------------------------------------------ the bodywork
/** The bodywork of a modern MX bike (right side made, the left mirrored): radiator shrouds, side number plates, the
    seat, the rear fender and the front fender (the front fender turns with the bars, so it's returned on its own).
    Each entry: [geometry, material key]. */
export function mxBodywork() {
  const out = [];
  const curl = (u, v, k = 0.012) => k * (1 - smooth(0, 0.16, Math.min(v, 1 - v))) + k * 0.6 * (1 - smooth(0, 0.08, Math.min(u, 1 - u)));
  // radiator shrouds: from under the seat's nose, flaring out and down round the radiators to a point by the fork
  const shroud = panel(
    (u) => [lerp(-0.02, 0.42, u), 0.505 + 0.065 * u ** 1.6],
    (u) => [lerp(0.05, 0.47, u ** 0.85), lerp(0.445, 0.13, smooth(0, 1, u))],
    (x, y, u, v) => 0.118 + 0.085 * u * v ** 0.8 + 0.016 * Math.sin(Math.PI * v) - curl(u, v), 18, 10);
  out.push([shroud, 'shroudR'], [mirrorZ(shroud), 'shroudL']);
  // side number plates under the back of the seat
  const side = panel(
    (u) => [lerp(-0.82, -0.2, u), lerp(0.49, 0.468, u)],
    (u) => [lerp(-0.78, -0.25, u), 0.475 - 0.27 * smooth(0.02, 0.8, u)],
    (x, y, u, v) => 0.102 + 0.012 * u + 0.016 * Math.sin(Math.PI * v) - curl(u, v, 0.01), 16, 8);
  out.push([side, 'sideR'], [mirrorZ(side), 'sideL']);
  // the seat: long, flat and narrow, rising over the tank to meet the shrouds
  out.push([sweep([V(0.25, 0.512), V(0.1, 0.5), V(-0.3, 0.482), V(-0.87, 0.47)], 40, 24,
    boxy(0.038, (s) => lerp(0.06, 0.112, smooth(0, 0.3, s)) - 0.02 * smooth(0.7, 1, s), 0.42, 0.025)), 'seat']);
  // the rear fender: a thin arched shell from under the seat out to a pointed tail
  out.push([sweep([V(-0.32, 0.445), V(-0.7, 0.468), V(-0.95, 0.5), V(-1.14, 0.565)], 30, 12, (s, q) => {
    const a = q * Math.PI; const w = lerp(0.118, 0.055, smooth(0.3, 1, s)); const d = lerp(0.07, 0.022, smooth(0.2, 1, s));
    return [d * (1 - Math.sin(a)) + 0.004, w * Math.cos(a)];
  }), 'shell']);
  return out;
}
/** The front fender (in the bike's frame, under the bottom triple clamp): a long thin arch high over the front tyre. */
export function frontFender() {
  return sweep([V(0.47, 0.29), V(0.62, 0.345), V(0.82, 0.352), V(1.0, 0.325), V(1.17, 0.262)], 34, 12, (s, q) => {
    const a = q * Math.PI; const w = lerp(0.07, 0.088, smooth(0, 0.35, s)) - 0.03 * smooth(0.65, 1, s); const d = 0.05 - 0.02 * smooth(0.5, 1, s);
    return [-(d * (1 - Math.sin(a))) - 0.004, w * Math.cos(a)];
  });
}
/** The front number plate: a curved shield (its shape comes from its picture), standing up facing +x. */
export function plateGeo() {
  return grid(10, 10, (u, v) => { const z = lerp(0.15, -0.15, u); const y = lerp(0.16, -0.15, v); return [-2.6 * z * z - 0.6 * (y + 0.15) ** 2, y, z]; }, true);
}

// ------------------------------------------------------------------ the bike's paint
/** Number plates are white with dark numbers (black with white ones on a white bike). */
const plateBg = (lv) => (lum(lv.plastic) > 0.8 ? lv.dark : '#ffffff');
const plateInk = (lv) => (lum(plateBg(lv)) > 0.5 ? lv.dark : '#ffffff');
/** The plastics' graphics. A shroud's picture is laid back (left) to front (right), a side plate's the same. */
export function shroudTex(lv, left = false) {
  return canvasTex(512, 256, (g, w, h) => {
    // (the left side's picture is laid front to back: its shapes are mirrored, its writing isn't)
    const X = (x) => (left ? w - x : x);
    g.fillStyle = lv.plastic; g.fillRect(0, 0, w, h);
    g.save(); if (left) { g.translate(w, 0); g.scale(-1, 1); }
    if (lv.camo) for (let i = 0; i < 40; i++) { g.fillStyle = ['#8f7146', '#5b4630', '#d4b783'][i % 3]; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 12 + Math.random() * 24, Math.random() * 3, 0, 7); g.fill(); }
    // a big swoosh up from the front, a pinstripe over it
    g.fillStyle = lv.accent; g.beginPath(); g.moveTo(w, h * 0.95); g.bezierCurveTo(w * 0.7, h * 0.85, w * 0.45, h * 0.45, 0, h * 0.28); g.lineTo(0, h * 0.42); g.bezierCurveTo(w * 0.45, h * 0.62, w * 0.72, h * 1.0, w, h * 1.1); g.fill();
    g.strokeStyle = lv.dark; g.lineWidth = h * 0.03; g.beginPath(); g.moveTo(w, h * 0.78); g.bezierCurveTo(w * 0.7, h * 0.7, w * 0.45, h * 0.32, 0, h * 0.17); g.stroke();
    g.restore();
    g.save(); g.translate(X(w * 0.66), h * 0.3); g.rotate(left ? 0.12 : -0.12); revvdLogo(g, 0, 0, h * 0.16, ...inkOn(lv.plastic), true); g.restore();
    // an invented sponsor's sticker low down
    g.save(); g.translate(X(w * 0.8), h * 0.62); g.rotate(left ? 0.3 : -0.3); g.fillStyle = lv.dark; roundRect(g, -40, -13, 80, 26, 6); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'italic 900 15px Kanit, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GRIT OIL', 0, 1); g.restore();
  });
}
export function sideTex(lv, left = false) {
  return canvasTex(512, 256, (g, w, h) => {
    const X = (x) => (left ? w - x : x);
    const bg = plateBg(lv);
    g.fillStyle = lv.plastic; g.fillRect(0, 0, w, h);
    g.fillStyle = lv.accent; g.beginPath(); g.moveTo(X(0), h * 0.05); g.lineTo(X(w), h * 0.0); g.lineTo(X(w), h * 0.12); g.lineTo(X(0), h * 0.14); g.fill();
    // the white number area
    g.fillStyle = bg; roundRect(g, left ? w * 0.08 : w * 0.36, h * 0.12, w * 0.56, h * 0.62, 26); g.fill();
    g.fillStyle = plateInk(lv);
    g.font = `italic 900 ${h * 0.46}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lv.number), X(w * 0.64), h * 0.45);
    g.save(); g.translate(X(w * 0.64), h * 0.86); revvdLogo(g, 0, 0, h * 0.1, ...inkOn(lv.plastic), true); g.restore();
  });
}
/** The front plate: a white shield with the number (see-through round its shape). */
export function plateTex(lv) {
  return canvasTex(256, 256, (g, w, h) => {
    const bg = plateBg(lv);
    g.beginPath(); g.moveTo(w * 0.08, h * 0.08); g.quadraticCurveTo(w * 0.5, -h * 0.02, w * 0.92, h * 0.08); g.lineTo(w * 0.86, h * 0.62); g.quadraticCurveTo(w * 0.5, h * 1.02, w * 0.14, h * 0.62); g.closePath();
    g.fillStyle = bg; g.fill(); g.lineWidth = 8; g.strokeStyle = lv.plastic; g.stroke();
    revvdLogo(g, w / 2, h * 0.24, h * 0.12, ...inkOn(bg), true);
    g.fillStyle = plateInk(lv);
    g.font = `italic 900 ${h * 0.44}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lv.number), w / 2, h * 0.52);
  });
}
/** The seat cover: grippy ribs across it. */
export function seatTex(color) {
  return canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y + 2, w, 1); }
  });
}

// ------------------------------------------------------------------ the rider's kit
const fabricOf = (color, map) => new THREE.MeshPhysicalMaterial({ color: map ? '#ffffff' : color, map: map || null, roughness: 0.92, metalness: 0, sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.5) });
const sponsor = (g, text, x, y, size, fill, bg) => {
  g.save(); g.font = `italic 900 ${size}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (bg) { const tw = g.measureText(text).width; g.fillStyle = bg; roundRect(g, x - tw / 2 - size * 0.3, y - size * 0.6, tw + size * 0.6, size * 1.2, size * 0.25); g.fill(); }
  g.fillStyle = fill; g.fillText(text, x, y); g.restore();
};
/** The kit's fabric materials and the boots, gloves and helmet: lv has the kit's jersey, jersey2, pants, boots and
    helmet colours, and the rider's number. */
export function kitMaterials(lv) {
  const J = lv.jersey; const J2 = lv.jersey2; const glove = lv.glove || J2;
  const torso = canvasTex(1024, 512, (g, w, h) => {
    // u round the body (0 = right side, 0.25 = chest, 0.5 = left side, 0.75 = back), v from the waist (bottom) up
    g.fillStyle = J; g.fillRect(0, 0, w, h);
    g.fillStyle = J2;
    for (const x of [0, w / 2, w]) { g.beginPath(); g.moveTo(x - 40, h); g.lineTo(x - 22, h * 0.2); g.lineTo(x + 22, h * 0.2); g.lineTo(x + 40, h); g.fill(); }   // side panels
    g.fillRect(0, 0, w, h * 0.1);   // the shoulders
    for (const cx of [w * 0.25, w * 0.75]) { g.beginPath(); g.moveTo(cx - 170, h * 0.1); g.lineTo(cx, h * 0.34); g.lineTo(cx + 170, h * 0.1); g.lineTo(cx + 120, h * 0.1); g.lineTo(cx, h * 0.25); g.lineTo(cx - 120, h * 0.1); g.fill(); }   // chevrons
    const [ink, edge] = inkOn(J);
    revvdLogo(g, w * 0.25, h * 0.5, h * 0.11, ink, edge, true);
    sponsor(g, 'BERM BROS', w * 0.25, h * 0.66, h * 0.05, ink);
    sponsor(g, 'HOLESHOT HQ', w * 0.25, h * 0.76, h * 0.045, J, ink);
    // the back: the logo over the number
    revvdLogo(g, w * 0.75, h * 0.4, h * 0.08, ink, edge, true);
    g.font = `italic 900 ${h * 0.34}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.lineJoin = 'round'; g.lineWidth = h * 0.025; g.strokeStyle = edge; g.strokeText(String(lv.number), w * 0.75, h * 0.8); g.fillStyle = ink; g.fillText(String(lv.number), w * 0.75, h * 0.8);
    g.fillStyle = lv.pants; g.fillRect(0, h * 0.94, w, h * 0.06);   // (tucked into the pants)
  });
  const sleeve = (fore) => canvasTex(256, 256, (g, w, h) => {
    // v from the shoulder (upper arm) or the elbow (forearm) at the bottom of the picture, up to the far end
    g.fillStyle = J; g.fillRect(0, 0, w, h);
    g.fillStyle = J2;
    if (!fore) { g.fillRect(0, h * 0.78, w, h * 0.22); g.fillRect(0, h * 0.4, w, h * 0.06); }
    else { g.fillRect(0, h * 0.38, w, h * 0.12); g.fillStyle = lv.dark || '#16181c'; g.fillRect(0, h * 0.1, w, h * 0.06); g.fillStyle = glove; g.fillRect(0, 0, w, h * 0.1); }
  });
  const pants = canvasTex(256, 256, (g, w, h) => {
    // a thigh: v from the hip (bottom) to the knee; a stripe down the outside of each leg (u 0 = right, 0.5 = left)
    g.fillStyle = lv.pants; g.fillRect(0, 0, w, h);
    g.fillStyle = J2; for (const x of [0, w / 2, w]) g.fillRect(x - 14, 0, 28, h * 0.8);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, w, h * 0.16);   // (the knee panel)
    g.save(); g.translate(w * 0.5, h * 0.55); g.rotate(-Math.PI / 2); sponsor(g, 'REVVD', 0, 0, 22, inkOn(J2)[0]); g.restore();
  });
  const boot = canvasTex(256, 256, (g, w, h) => {
    // the boot's shaft: v from the knee end (bottom of the picture) to the ankle; buckles on the outside (u 0 and 0.5)
    g.fillStyle = lv.boots; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, h * 0.3);
    g.fillStyle = '#1c1d21'; g.fillRect(0, h * 0.86, w, h * 0.14);   // (the padded top)
    for (const y of [0.24, 0.46, 0.68]) {
      g.fillStyle = 'rgba(30,32,38,0.75)'; g.fillRect(0, h * y, w, h * 0.035);
      g.fillStyle = '#c9ced6'; for (const x of [w * 0.03, w * 0.53]) g.fillRect(x - 9, h * (y - 0.012), 18, h * 0.06);
    }
    g.fillStyle = J2; g.fillRect(0, h * 0.78, w, h * 0.05);
  });
  const helmet = canvasTex(1024, 512, (g, w, h) => {
    // a sphere's picture: u round from the back (0) by the right (0.25) to the front (0.5) and the left; v from the top down
    g.fillStyle = lv.helmet; g.fillRect(0, 0, w, h);
    g.fillStyle = lv.helmet2; g.fillRect(0, 0, w, h * 0.12);
    for (const cx of [w * 0.25, w * 0.75]) {
      const d = cx < w / 2 ? -1 : 1;   // (both sides: the flash points to the front)
      g.beginPath(); g.moveTo(cx - d * 230, h * 0.62); g.lineTo(cx + d * 160, h * 0.22); g.lineTo(cx + d * 230, h * 0.3); g.lineTo(cx - d * 120, h * 0.7); g.fill();
      revvdLogo(g, cx - d * 20, h * 0.58, h * 0.07, ...inkOn(lv.helmet), true);
    }
    g.fillStyle = lv.helmet2; g.fillRect(0, h * 0.72, w, h * 0.03);
  });
  const shell = (map, color = '#ffffff') => new THREE.MeshPhysicalMaterial({ color, map, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  return {
    torso: fabricOf(J, torso),
    sleeveU: fabricOf(J, sleeve(false)),
    sleeveF: fabricOf(J, sleeve(true)),
    pantsT: fabricOf(lv.pants, pants),
    pants: fabricOf(lv.pants),
    collar: fabricOf(J2),
    glove: fabricOf(glove),
    palm: fabricOf('#1d1e22'),
    bootsShaft: new THREE.MeshPhysicalMaterial({ map: boot, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    bootsFoot: new THREE.MeshPhysicalMaterial({ color: lv.boots, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    sole: new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.9 }),
    buckle: new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.3 }),
    helmetShell: shell(helmet),
    helmetMain: shell(null, lv.helmet),
    chin: Object.assign(shell(canvasTex(256, 128, (g, w, h) => {
      // the chin bar's picture: u from the left ear round to the right, v from its top edge down; the mouth vent in the middle
      g.fillStyle = lv.helmet; g.fillRect(0, 0, w, h);
      g.fillStyle = lv.helmet2; g.fillRect(0, h * 0.82, w, h * 0.18); g.beginPath(); g.moveTo(w * 0.2, h); g.lineTo(w * 0.42, h * 0.3); g.lineTo(w * 0.47, h * 0.3); g.lineTo(w * 0.3, h); g.moveTo(w * 0.8, h); g.lineTo(w * 0.58, h * 0.3); g.lineTo(w * 0.53, h * 0.3); g.lineTo(w * 0.7, h); g.fill();
      g.fillStyle = '#1a1b1f'; roundRect(g, w * 0.455, h * 0.3, w * 0.09, h * 0.5, 6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; for (let y = 0.36; y < 0.76; y += 0.1) g.fillRect(w * 0.46, h * y, w * 0.08, 2);
    })), { side: THREE.DoubleSide }),
    helmetTrim: shell(null, lv.helmet2),
    goggle: new THREE.MeshPhysicalMaterial({ color: J2, roughness: 0.5, clearcoat: 0.5 }),
    strap: fabricOf('#1b1c20'),
    brace: new THREE.MeshStandardMaterial({ color: '#1d1e22', roughness: 0.55 }),
    vent: new THREE.MeshStandardMaterial({ color: '#1a1b1f', roughness: 0.6 }),
  };
}

/** The rider's kit pieces: the same parts (and the same sizes) bike.js's posing moves about, now shaped. K: materials. */
export function riderParts(K, M) {
  const mk = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
  // the torso: hips to shoulders, broad across the chest (posing squashes it front to back and widens it)
  const torso = mk(limbGeo(0.58, (t) => 0.122 + 0.03 * smooth(0.05, 0.75, t) - 0.055 * smooth(0.86, 1, t), 14, 24), K.torso);
  const pelvis = mk(new THREE.SphereGeometry(0.13, 22, 14).scale(1.02, 0.86, 1.2), K.pants);
  const neck = mk(limbGeo(0.12, (t) => 0.082 - 0.014 * t, 3, 16), K.brace);   // (a neck brace)
  const arm = (fore) => mk(limbGeo(0.3, fore ? (t) => 0.056 - 0.012 * t + 0.008 * smooth(0.85, 1, t) : (t) => 0.064 - 0.008 * t, 8, 14), fore ? K.sleeveF : K.sleeveU);
  const thigh = () => mk(limbGeo(0.45, (t) => 0.09 - 0.02 * smooth(0.3, 1, t), 9, 16), K.pantsT);
  const shin = () => {
    const s = mk(limbGeo(0.44, (t) => 0.068 - 0.018 * smooth(0.1, 0.4, t), 8, 14), K.pants);
    // the boot's shaft, from below the knee to the ankle (a child: it goes where the shin goes)
    s.add(mk(limbGeo(0.44, (t) => 0.071 - 0.014 * smooth(0.3, 1, t), 8, 18, 0.2, 1), K.bootsShaft));
    return s;
  };
  // the boot: a black sole, a toe and heel, buckled straps over the top
  const boot = () => {
    const g = new THREE.Group();
    g.add(mk(sweep([V(-0.13, -0.035), V(0, -0.038), V(0.15, -0.03)], 14, 16, boxy(0.016, 0.054, 0.5, 0.06)), K.sole));
    g.add(mk(sweep([V(-0.12, 0.03), V(-0.05, 0.03), V(0.05, 0.0), V(0.14, -0.012)], 18, 18, boxy((s) => lerp(0.07, 0.032, smooth(0.1, 0.95, s)), (s) => lerp(0.06, 0.047, s), 0.6, 0.07)), K.bootsFoot));
    for (const x of [0.0, 0.07]) g.add(mk(at(new THREE.BoxGeometry(0.022, 0.012, 0.118), x, 0.035 - x * 0.35, 0, -0.3), K.palm));
    g.add(mk(at(new THREE.BoxGeometry(0.03, 0.02, 0.008), 0.0, 0.03, 0.06), K.buckle));
    return g;
  };
  // gloves round the grips: a fist, the knuckle guard, a cuff
  const hand = () => {
    const g = new THREE.Group();
    g.add(mk(new THREE.SphereGeometry(0.05, 16, 12).scale(1.05, 0.78, 1.05), K.glove));
    g.add(mk(at(new THREE.SphereGeometry(0.03, 12, 8).scale(1.1, 0.5, 1.6), 0.02, 0.026, 0), K.palm));
    return g;
  };
  const knee = () => mk(new THREE.SphereGeometry(0.072, 16, 12).scale(0.72, 1.25, 1.0), K.pants);
  // the helmet: a long shell, the chin bar pushed forward, a peak, goggles on a strap
  const helmet = new THREE.Group();
  helmet.add(mk(new THREE.SphereGeometry(0.14, 40, 28).scale(1.12, 1.0, 0.95).translate(-0.012, 0.012, 0), K.helmetShell));
  helmet.add(mk(new THREE.SphereGeometry(0.128, 24, 16).scale(1.06, 1, 0.94).translate(0.0, -0.02, 0), K.vent));   // (the dark lining, in the eye port)
  // the chin bar: a shell round the jaw from ear to ear, pushed out into a pointed beak at the front
  const chin = grid(20, 8, (u, v) => {
    const a = lerp(-1.3, 1.3, u); const c = Math.cos(a); const f = c ** 4;
    const out = 0.048 * f * (0.3 + 0.7 * v) + 0.006 * Math.sin(Math.PI * v);
    return [(0.153 + out) * c - 0.012, lerp(-0.034, -0.128, v) - 0.04 * f * v ** 1.3, (0.131 + out * 0.25) * Math.sin(a)];
  });
  const cm = mk(chin, K.chin); helmet.add(cm);
  helmet.add(mk(new THREE.CylinderGeometry(0.144, 0.144, 0.028, 40, 1, true).scale(1.12, 1, 0.97).translate(-0.012, 0.022, 0), K.strap));
  const frame = new THREE.CylinderGeometry(0.159, 0.156, 0.066, 30, 1, true, Math.PI / 2 - 1.08, 2.16).scale(1, 1, 0.92).translate(-0.014, 0.02, 0);
  helmet.add(mk(frame, K.goggle));
  helmet.add(mk(new THREE.CylinderGeometry(0.162, 0.16, 0.05, 30, 1, true, Math.PI / 2 - 0.78, 1.56).scale(1, 1, 0.92).translate(-0.014, 0.02, 0), M.lens));
  const peak = grid(12, 8, (u, v) => {
    const z = lerp(0.125, -0.125, u) * lerp(1, 0.74, v);
    return [lerp(0.05, 0.27, v) - 0.7 * z * z * (1 - v), lerp(0.098, 0.13, v) - 1.5 * z * z * (0.4 + v), z];
  });
  const pk = mk(peak, K.helmetTrim); pk.material = K.helmetTrim.clone(); pk.material.side = THREE.DoubleSide; helmet.add(pk);
  helmet.traverse((o) => { o.castShadow = true; });
  return {
    pelvis, torso, chest: new THREE.Group(), neck, helmet,
    upperArm: [arm(false), arm(false)], foreArm: [arm(true), arm(true)], hand: [hand(), hand()],
    thigh: [thigh(), thigh()], shin: [shin(), shin()], boot: [boot(), boot()], knee: [knee(), knee()],
  };
}
