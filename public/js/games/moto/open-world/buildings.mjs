/** Buildings and trail furniture for the open worlds, made from simple shapes coloured vertex by vertex
 * and merged, so each building is one draw call. Local space: metres, y = 0 at the ground, the front faces +Z.
 * Everything reaches a little below y = 0 so it sits into slopes instead of floating. */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const col = new THREE.Color();
function hash(n) { n = Math.imul(n ^ (n >>> 15), 2246822519); n = Math.imul(n ^ (n >>> 13), 3266489917); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

/** Collects coloured parts and merges them into one geometry. */
class Kit {
  constructor(seed = 1) { this.parts = []; this.seed = seed; }
  rand() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  add(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.05, shade = null, face = false } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const p = g.attributes.position, n = g.attributes.normal, c0 = new THREE.Color(color), out = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 3) {
      const k = 1 - jitter + this.rand() * jitter * 2;   // (each face a touch lighter or darker)
      for (let j = i; j < i + 3 && j < p.count; j++) {
        col.copy(c0).multiplyScalar(k);
        if (shade && face) shade(col, (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3, n.getY(j));   // (one colour per triangle: hard-edged stripes)
        else if (shade) shade(col, p.getX(j), p.getY(j), p.getZ(j), n.getY(j));
        out[j * 3] = col.r; out[j * 3 + 1] = col.g; out[j * 3 + 2] = col.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(r0, r1, h, color, o = {}, seg = 8) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg), color, o); }
  /** A beam from a to b (round posts, braces, rails). */
  beam(a, b, r, color, seg = 6) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this.add(g, color);
  }
  /** A triangular gable end (or tent side) w wide, h tall, t thick, facing ±Z. */
  gable(w, h, t, color, o = {}) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2);
    return this.add(g, color, o);
  }
  build() { const g = mergeGeometries(this.parts); this.parts.forEach((p) => p.dispose()); g.computeBoundingSphere(); return g; }
}

const PAL = {
  desert: { wood: '#9a6c45', dark: '#5d4029', roof: '#a8522f', stone: '#c09066', trim: '#e9d9b8', canvas: '#efe2c4', metal: '#8d9298', snow: null },
  alpine: { wood: '#7a5332', dark: '#4a3220', roof: '#40553f', stone: '#8b877c', trim: '#e8e2d2', canvas: '#d9cfae', metal: '#8a9096', snow: null },
  snow: { wood: '#6e4b31', dark: '#43301f', roof: '#5b3a2e', stone: '#7d8691', trim: '#f2efe8', canvas: '#d33f2f', metal: '#9aa2ab', snow: '#f4f8ff' },
};
const pal = (theme) => PAL[theme] || PAL.alpine;
const GLASS = '#22323d';
/** Snow settles on anything facing up. */
const snowTop = (p) => (p.snow ? (c, x, y, z, ny) => { if (ny > 0.55) c.set(p.snow).multiplyScalar(0.92 + 0.08 * ny); } : null);
const grain = (c, x, y, z) => c.multiplyScalar(0.86 + 0.14 * Math.sin(y * 9 + Math.sin(x * 3 + z * 2) * 2));

/** A log cabin with a stone footing, gable roof, porch, windows and a chimney. */
function cabin(theme, seed) {
  const p = pal(theme), k = new Kit(seed), W = 10, Dp = 7.5, H = 3.6;
  k.box(W + 0.8, 2.6, Dp + 0.8, p.stone, { y: -0.9, jitter: 0.12 });
  // walls of stacked logs that cross over at the corners
  for (let i = 0; i < 9; i++) {
    const y = 0.55 + i * 0.4;
    for (const z of [-Dp / 2, Dp / 2]) k.cyl(0.21, 0.21, W + 0.9, i % 2 ? p.wood : p.dark, { y, z, rz: Math.PI / 2, jitter: 0.1, shade: grain });
    for (const x of [-W / 2, W / 2]) k.cyl(0.21, 0.21, Dp + 0.9, i % 2 ? p.dark : p.wood, { y: y + 0.2, x, rx: Math.PI / 2, jitter: 0.1, shade: grain });
  }
  k.box(W - 0.3, H, Dp - 0.3, p.dark, { y: 0.4 + H / 2 });   // (the inside face, behind the logs)
  // gable roof: two slopes, the gable ends and a ridge beam
  const pitch = 0.62, half = Dp / 2 + 0.9, slope = half / Math.cos(pitch), rise = half * Math.tan(pitch), top = 0.4 + H;
  for (const s of [-1, 1]) k.box(W + 1.6, 0.22, slope, p.roof, { y: top + rise / 2 + 0.1, z: s * half / 2, rx: s * pitch, jitter: 0.04, shade: snowTop(p) });
  for (const x of [-W / 2 - 0.1, W / 2 + 0.1]) k.gable(Dp + 0.4, rise + 0.05, 0.3, p.wood, { y: top, x, ry: Math.PI / 2, shade: grain });
  k.cyl(0.18, 0.18, W + 1.8, p.dark, { y: top + rise + 0.1, rz: Math.PI / 2 });
  // door, windows with frames and shutters
  k.box(1.25, 2.2, 0.16, p.dark, { y: 0.4 + 1.1, z: Dp / 2 + 0.22 });
  k.box(1.5, 0.16, 0.2, p.trim, { y: 0.4 + 2.28, z: Dp / 2 + 0.24 });
  for (const x of [-W / 4 - 0.4, W / 4 + 0.4]) {
    k.box(1.5, 1.2, 0.1, GLASS, { x, y: 2.3, z: Dp / 2 + 0.24, jitter: 0 });
    k.box(1.7, 0.12, 0.16, p.trim, { x, y: 2.95, z: Dp / 2 + 0.27 }); k.box(1.7, 0.12, 0.16, p.trim, { x, y: 1.65, z: Dp / 2 + 0.27 });
    k.box(0.1, 1.3, 0.16, p.trim, { x, y: 2.3, z: Dp / 2 + 0.27 });
    for (const s of [-1, 1]) k.box(0.55, 1.35, 0.08, p.roof, { x: x + s * 1.08, y: 2.3, z: Dp / 2 + 0.3 });
  }
  for (const z of [-1.4, 1.4]) k.box(0.1, 1.1, 1.3, GLASS, { x: W / 2 + 0.25, y: 2.3, z, jitter: 0 });
  // porch: deck, posts, rails and a little roof
  k.box(W, 0.22, 2.6, p.wood, { y: 0.45, z: Dp / 2 + 1.55, shade: (c, x) => c.multiplyScalar(0.85 + 0.15 * Math.sin(x * 12)) });
  for (const x of [-W / 2 + 0.2, -1.3, 1.3, W / 2 - 0.2]) k.box(0.2, 2.7, 0.2, p.dark, { x, y: 1.75, z: Dp / 2 + 2.7 });
  for (const s of [-1, 1]) k.box(W / 2 - 1.6, 0.1, 0.1, p.wood, { x: s * (W / 4 + 0.75), y: 1.4, z: Dp / 2 + 2.7 });
  k.box(W + 0.4, 0.16, 3.0, p.roof, { y: 3.15, z: Dp / 2 + 1.6, rx: -0.18, shade: snowTop(p) });
  // stone chimney
  k.box(1.1, H + rise + 2.2, 1.1, p.stone, { x: -W / 2 - 0.65, y: (H + rise + 2.2) / 2 - 0.2, z: -1.2, jitter: 0.12 });
  // firewood stacked along the side
  for (let i = 0; i < 18; i++) k.cyl(0.13, 0.13, 0.9, i % 3 ? p.wood : p.dark, { x: W / 2 + 0.7, y: 0.2 + Math.floor(i / 6) * 0.25, z: -2.6 + (i % 6) * 0.27, rx: 0, rz: Math.PI / 2, jitter: 0.15 }, 6);
  return k.build();
}

/** A fire-lookout tower: braced legs, zig-zag stairs, a glazed cab and a pointed roof. */
function tower(theme, seed) {
  const p = pal(theme), k = new Kit(seed), top = 15, legB = 3.4, legT = 2.3;
  k.box(9, 1.6, 9, p.stone, { y: -0.6, jitter: 0.1 });
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) k.beam([sx * legB, -0.3, sz * legB], [sx * legT, top, sz * legT], 0.17, p.dark);
  for (let lv = 0; lv < 3; lv++) {
    const y0 = lv * top / 3, y1 = (lv + 1) * top / 3, w0 = legB - (legB - legT) * lv / 3, w1 = legB - (legB - legT) * (lv + 1) / 3;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
      k.beam([ax * w0, y0, az * w0], [bx * w1, y1, bz * w1], 0.07, p.wood);
      k.beam([bx * w0, y0, bz * w0], [ax * w1, y1, az * w1], 0.07, p.wood);
      k.beam([ax * w1, y1, az * w1], [bx * w1, y1, bz * w1], 0.08, p.wood);
    }
  }
  // stairs up one side, landing at each level
  for (let i = 0; i < 3; i++) {
    const y0 = i * top / 3, y1 = (i + 1) * top / 3, s = i % 2 ? -1 : 1, z = legB + 0.9 - i * 0.35;
    k.box(0.9, 0.12, Math.hypot(top / 3, 4.2), p.wood, { x: s * 0.0, y: (y0 + y1) / 2, z, rx: 0, ry: Math.PI / 2, jitter: 0.06 });
    const g = k.parts.pop(); g.translate(0, -(y0 + y1) / 2, -z); g.rotateZ(s * Math.atan2(top / 3, 4.2)); g.translate(0, (y0 + y1) / 2, z); k.parts.push(g);
  }
  // the cab
  const cab = 2.8;
  k.box(6.6, 0.35, 6.6, p.wood, { y: top + 0.1 });
  k.box(cab * 2, 1.1, cab * 2, p.wood, { y: top + 0.85, shade: grain });
  k.box(cab * 2 - 0.1, 1.3, cab * 2 - 0.1, GLASS, { y: top + 2.05, jitter: 0 });
  for (const [sx, sz] of legs) k.box(0.18, 1.4, 0.18, p.trim, { x: sx * cab, y: top + 2.05, z: sz * cab });
  k.box(cab * 2 + 0.2, 0.3, cab * 2 + 0.2, p.trim, { y: top + 2.8 });
  const roof = new THREE.ConeGeometry(cab * 1.75, 2.2, 4, 1); roof.rotateY(Math.PI / 4);
  k.add(roof, p.roof, { y: top + 4.0, shade: snowTop(p) });
  // walkway rail round the cab and an aerial with a light
  for (const [sx, sz] of legs) k.box(0.1, 1.0, 0.1, p.dark, { x: sx * 3.2, y: top + 0.8, z: sz * 3.2 });
  for (let i = 0; i < 4; i++) { const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4]; k.beam([ax * 3.2, top + 1.25, az * 3.2], [bx * 3.2, top + 1.25, bz * 3.2], 0.05, p.trim); }
  k.cyl(0.05, 0.05, 4, p.metal, { y: top + 6.6, x: 0.4 });
  k.add(new THREE.SphereGeometry(0.22, 8, 6), '#ff3a2a', { y: top + 8.7, x: 0.4, jitter: 0 });
  return k.build();
}

/** Basecamp: a striped marquee, dome tents, a camper, a campfire, picnic table and a flagpole. */
function basecamp(theme, seed, keepClear) {
  const p = pal(theme), k = new Kit(seed);
  const ok = (x, z, r) => !keepClear || keepClear(x, z, r);
  // the marquee
  if (ok(0, 0, 8)) {
    for (const [x, z] of [[-4, -3], [4, -3], [4, 3], [-4, 3]]) k.cyl(0.08, 0.08, 3, p.metal, { x, y: 1.4, z });
    const roof = new THREE.ConeGeometry(6.2, 2.4, 12, 1, true); roof.scale(1, 1, 0.75);
    k.add(roof, '#ffffff', { y: 4.1, jitter: 0.02, face: true, shade: (c, x, y, z) => { if (Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 6)) % 2) c.set(theme === 'snow' ? '#2a6fd6' : '#e2492f'); } });
    k.box(8.2, 0.5, 0.06, theme === 'snow' ? '#2a6fd6' : '#e2492f', { y: 2.7, z: 3.05 });
    k.box(3, 0.8, 1, '#c9cdd2', { x: -1.5, y: 0.4, z: -0.5 }); k.box(3, 0.8, 1, '#c9cdd2', { x: 1.8, y: 0.4, z: -0.5 });   // (tables)
  }
  // dome tents in different colours
  const tents = [[11, -4, '#f29f05'], [13, 4, '#2d9c5a'], [8, 10, '#3b6fd6'], [-10, 9, '#d6453b']];
  for (const [x, z, c] of tents) {
    if (!ok(x, z, 3.5)) continue;
    const g = new THREE.SphereGeometry(1.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1.25, 0.8, 1);
    k.add(g, c, { x, y: -0.05, z, ry: k.rand() * 6, shade: (cc, gx, gy, gz) => cc.multiplyScalar(0.8 + 0.25 * Math.abs(Math.sin(Math.atan2(gz, gx) * 2))) });
    k.box(0.9, 0.9, 0.08, '#2a2a2a', { x: x + 2.2, y: 0.45, z, ry: Math.PI / 2 });
  }
  // a camper trailer
  if (ok(-11, -2, 5)) {
    k.box(6, 2.4, 2.5, '#f1ede4', { x: -11, y: 1.6, z: -2, shade: (c, x, y) => { if (y > 1.05 && y < 1.35) c.set('#2f7fb0'); } });
    k.box(5.8, 0.3, 2.3, '#3a3d42', { x: -11, y: 0.3, z: -2 });
    for (const s of [-1, 1]) k.cyl(0.42, 0.42, 0.3, '#1d1e21', { x: -11.5, y: 0.42, z: -2 + s * 1.3, rx: Math.PI / 2 }, 12);
    k.box(1.4, 0.7, 0.06, GLASS, { x: -10, y: 2.1, z: -0.73, jitter: 0 });
    k.box(0.8, 1.7, 0.06, '#c9c3b6', { x: -12.5, y: 1.4, z: -0.73 });
  }
  // campfire ring with logs and a glowing heart
  if (ok(5, 9, 3)) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; k.add(new THREE.DodecahedronGeometry(0.28, 0), p.stone, { x: 5 + Math.cos(a) * 1.0, y: 0.12, z: 9 + Math.sin(a) * 1.0, jitter: 0.2 }); }
    for (let i = 0; i < 4; i++) k.cyl(0.1, 0.1, 1.2, p.dark, { x: 5, y: 0.25, z: 9, rz: 1.1, ry: i * 0.8 }, 6);
    k.add(new THREE.ConeGeometry(0.45, 0.8, 7), '#ff8a1f', { x: 5, y: 0.45, z: 9, jitter: 0.1 });
    for (const [x, z, r] of [[3, 7.4, 0.4], [7.2, 10, 1.9]]) k.cyl(0.25, 0.25, 1.6, p.wood, { x, y: 0.22, z, rz: Math.PI / 2, ry: r }, 8);
  }
  if (ok(-4, 9, 2.5)) {   // picnic table
    k.box(2.2, 0.08, 0.9, p.wood, { x: -4, y: 0.78, z: 9 });
    for (const s of [-1, 1]) { k.box(2.2, 0.06, 0.3, p.wood, { x: -4, y: 0.45, z: 9 + s * 0.75 }); k.box(0.08, 0.8, 1.7, p.dark, { x: -4 + s * 0.85, y: 0.4, z: 9, rx: 0 }); }
  }
  if (ok(-6, -9, 1)) { k.cyl(0.06, 0.08, 9, p.metal, { x: -6, y: 4.4, z: -9 }); k.box(2.2, 1.3, 0.04, theme === 'desert' ? '#e2492f' : theme === 'snow' ? '#2a6fd6' : '#2d9c5a', { x: -4.9, y: 8.1, z: -9, jitter: 0 }); }
  return k.build();
}

/** A quarry yard (containers, gravel heaps, fuel tanks) or, in the hills, a timber yard (log stacks and a saw shed). */
function yard(theme, seed, keepClear) {
  const p = pal(theme), k = new Kit(seed);
  const ok = (x, z, r) => !keepClear || keepClear(x, z, r);
  const box = [['#b5432f', '#2f6db5', '#e0a526', '#3c8c58', '#8a8f96'], ['#7a3d2a']];
  // corrugated shipping containers, some stacked
  const ribs = (c, x, y, z) => c.multiplyScalar(0.84 + 0.16 * Math.abs(Math.sin((x + z) * 9)));
  for (const [x, z, lv, r] of [[-12, -6, 0, 0], [-12, -6, 1, 0.05], [-12, -1.4, 0, 0], [-4, -11, 0, Math.PI / 2], [12, -8, 0, 0.3]]) {
    if (!ok(x, z, 4)) continue;
    k.box(6, 2.6, 2.4, box[0][Math.floor(k.rand() * 5)], { x, y: 1.3 + lv * 2.6, z, ry: r, shade: ribs });
  }
  if (theme === 'desert') {
    for (const [x, z, s] of [[8, 6, 1], [14, 2, 0.7], [3, 13, 0.85]]) {
      if (!ok(x, z, 6 * s)) continue;
      const g = new THREE.ConeGeometry(6 * s, 4.5 * s, 14, 3); const pp = g.attributes.position;
      for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (1 + (hash(i + seed) - 0.5) * 0.15), pp.getY(i), pp.getZ(i) * (1 + (hash(i * 7 + seed) - 0.5) * 0.15));
      g.computeVertexNormals();
      k.add(g, k.rand() < 0.5 ? '#c7a98a' : '#a58670', { x, y: 2.2 * s - 0.1, z, jitter: 0.12 });
    }
    if (ok(-2, 4, 4)) for (const s of [-1, 1]) {   // fuel tanks on cradles
      k.cyl(1.0, 1.0, 5, '#e8e4dc', { x: -2, y: 1.6, z: 4 + s * 2.4, rz: Math.PI / 2 }, 14);
      for (const x of [-3.6, -0.4]) k.box(0.4, 0.8, 1.6, '#5a5d63', { x, y: 0.4, z: 4 + s * 2.4 });
    }
  } else {
    for (const [x, z, n] of [[8, 6, 5], [14, -1, 4], [2, 12, 4]]) {   // log stacks
      if (!ok(x, z, 4)) continue;
      for (let row = 0; row < n; row++) for (let i = 0; i < n - row; i++) k.cyl(0.32, 0.34, 7, i % 2 ? p.wood : p.dark, { x: x - (n - row - 1) * 0.33 + i * 0.66, y: 0.32 + row * 0.56, z, rx: Math.PI / 2, jitter: 0.12, shade: snowTop(p) }, 9);
    }
    if (ok(-1, 4, 5)) {   // the saw shed: open-sided, on posts
      for (const [x, z] of [[-5, 1], [3, 1], [3, 7], [-5, 7]]) k.box(0.25, 4, 0.25, p.dark, { x, y: 2, z });
      for (const s of [-1, 1]) k.box(9.4, 0.18, 3.8, p.roof, { x: -1, y: 4.4, z: 4 + s * 1.7, rx: s * 0.32, shade: snowTop(p) });
      k.box(5, 0.9, 1, p.metal, { x: -1, y: 0.45, z: 4 });
    }
  }
  if (ok(-6, 8, 3)) {   // the site office
    k.box(5, 2.6, 2.6, '#e9e4d6', { x: -6, y: 1.3, z: 8 });
    k.box(1.6, 0.9, 0.06, GLASS, { x: -6, y: 1.6, z: 9.33, jitter: 0 });
    k.box(5.3, 0.2, 2.9, '#5d6168', { x: -6, y: 2.7, z: 8, shade: snowTop(p) });
  }
  return k.build();
}

/** Ruins: broken walls with a doorway arch and rubble. */
function ruin(theme, seed) {
  const p = pal(theme), k = new Kit(seed), stone = theme === 'desert' ? '#c69a6c' : p.stone;
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(-(z1 - z0), x1 - x0), n = Math.ceil(len / 1.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, h = 0.8 + 3.6 * Math.abs(Math.sin(i * 1.7 + seed)) * (0.5 + 0.5 * k.rand());
      k.box(len / n + 0.04, h + 0.8, 0.8, stone, { x: x0 + (x1 - x0) * t, y: h / 2 - 0.4, z: z0 + (z1 - z0) * t, ry, jitter: 0.14, shade: (c, x, y) => c.multiplyScalar(0.9 + 0.1 * Math.sin(y * 7)) });
    }
  };
  wall(-8, -6, 8, -6); wall(8, -6, 8, 5); wall(-8, -6, -8, 2);
  wall(-8, 6, -2.2, 6); wall(2.2, 6, 6, 6);
  // the doorway arch
  for (const s of [-1, 1]) k.box(0.9, 4.2, 0.9, stone, { x: s * 1.75, y: 1.7, z: 6 });
  for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; k.box(0.75, 0.6, 0.9, stone, { x: Math.cos(a) * 1.75, y: 3.8 + Math.sin(a) * 1.3, z: 6, rz: a - Math.PI / 2 }); }
  for (let i = 0; i < 16; i++) { const g = new THREE.DodecahedronGeometry(0.25 + k.rand() * 0.45, 0); k.add(g, stone, { x: (k.rand() - 0.5) * 18, y: 0.1, z: (k.rand() - 0.5) * 14, rx: k.rand() * 3, ry: k.rand() * 3, jitter: 0.2 }); }
  return k.build();
}

/** A lookout deck on stilts with railings, a bench and coin-op binoculars. */
function lookout(theme, seed) {
  const p = pal(theme), k = new Kit(seed), W = 9, Dd = 6, H = 1.6;
  for (const x of [-W / 2 + 0.3, 0, W / 2 - 0.3]) for (const z of [-Dd / 2 + 0.3, Dd / 2 - 0.3]) k.box(0.3, H + 1.5, 0.3, p.dark, { x, y: (H - 1.5) / 2, z });
  k.box(W, 0.2, Dd, p.wood, { y: H, shade: (c, x) => c.multiplyScalar(0.85 + 0.15 * Math.sin(x * 11)) });
  for (const [x0, z0, x1, z1] of [[-W / 2, Dd / 2, W / 2, Dd / 2], [W / 2, -Dd / 2, W / 2, Dd / 2], [-W / 2, -Dd / 2, -W / 2, Dd / 2]]) {
    for (const y of [H + 0.55, H + 1.05]) k.beam([x0, y, z0], [x1, y, z1], 0.05, p.trim);
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 1.5);
    for (let i = 0; i <= n; i++) k.box(0.12, 1.1, 0.12, p.dark, { x: x0 + (x1 - x0) * i / n, y: H + 0.55, z: z0 + (z1 - z0) * i / n });
  }
  // steps up the back
  for (let i = 0; i < 5; i++) k.box(1.6, 0.14, 0.4, p.wood, { x: -W / 2 + 1.5, y: H - 0.3 * (i + 1), z: -Dd / 2 - 0.25 - i * 0.35 });
  k.box(2.4, 0.1, 0.5, p.wood, { x: -1.6, y: H + 0.5, z: -1.6 }); k.box(2.4, 0.5, 0.08, p.wood, { x: -1.6, y: H + 0.8, z: -1.85 });   // (bench)
  k.cyl(0.07, 0.09, 1.1, p.metal, { x: 2.4, y: H + 0.55, z: Dd / 2 - 0.8 }); k.box(0.5, 0.25, 0.35, '#2d6fb5', { x: 2.4, y: H + 1.2, z: Dd / 2 - 0.8 });
  return k.build();
}

/** A jetty out over the water with a little boathouse and a rowing boat. */
function dock(theme, seed) {
  const p = pal(theme), k = new Kit(seed);
  for (let i = 0; i < 9; i++) {
    k.box(3.2, 0.15, 1.95, i % 2 ? p.wood : p.dark, { y: 0.9, z: 2 + i * 2, jitter: 0.1, shade: snowTop(p) });
    for (const s of [-1, 1]) k.cyl(0.14, 0.14, 4, p.dark, { x: s * 1.5, y: -1, z: 2 + i * 2 });
  }
  k.box(5, 3, 4, p.wood, { x: -5, y: 1.3, z: 1, shade: grain });
  for (const s of [-1, 1]) k.box(5.6, 0.18, 2.6, p.roof, { x: -5, y: 3.15 + 0.35, z: 1 + s * 1.15, rx: s * 0.35, shade: snowTop(p) });
  k.box(2.2, 2.3, 0.08, p.dark, { x: -5, y: 1.15, z: 3.05 });
  const boat = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); boat.scale(0.9, 0.45, 2.3);
  k.add(boat, theme === 'snow' ? '#d33f2f' : '#2f7fb0', { x: 2.6, y: 0.55, z: 9, ry: 0.15 });
  return k.build();
}

/** A trail checkpoint: a booth, a striped barrier arm and flags. */
function booth(theme, seed) {
  const p = pal(theme), k = new Kit(seed);
  k.box(3, 2.6, 2.6, p.trim, { x: -9, y: 1.2, z: 0 });
  k.box(2.4, 0.9, 0.06, GLASS, { x: -9, y: 1.6, z: 1.33, jitter: 0 });
  k.box(3.6, 0.25, 3.2, '#c0392b', { x: -9, y: 2.6, z: 0, shade: snowTop(p) });
  k.box(0.4, 1.1, 0.4, '#3a3d42', { x: -7.2, y: 0.55, z: 0 });
  k.add(new THREE.BoxGeometry(7, 0.18, 0.18, 10, 1, 1), '#ffffff', { x: -3.6, y: 1.05, z: 0, face: true, shade: (c, x) => { if (Math.floor(x / 0.7 + 20) % 2) c.set('#d62c1f'); } });
  for (const x of [-12, -6]) { k.cyl(0.04, 0.05, 5, p.metal, { x, y: 2.5, z: -1.8 }); k.box(0.06, 1.6, 1.1, x < -8 ? '#ffd21a' : '#1e8ad6', { x, y: 4.1, z: -1.2, jitter: 0 }); }
  return k.build();
}

/** Buildings by spot kind (the JSON's spots). keepClear(x, z, r) = false where a part would block the rider's reset spot. */
export function buildingGeometry(kind, theme, seed, keepClear) {
  switch (kind) {
    case 'cabin': return cabin(theme, seed);
    case 'tower': return tower(theme, seed);
    case 'camp': return basecamp(theme, seed, keepClear);
    case 'yard': return yard(theme, seed, keepClear);
    case 'ruin': return ruin(theme, seed);
    case 'dock': return dock(theme, seed);
    case 'checkpoint': return booth(theme, seed);
    default: return lookout(theme, seed);
  }
}

/** A painted wooden sign on two posts. */
export function signGeometry(theme) {
  const p = pal(theme), k = new Kit(7);
  for (const s of [-1, 1]) k.box(0.22, 3.4, 0.22, p.dark, { x: s * 2.7, y: 1.3 });
  k.box(6.0, 1.5, 0.12, p.wood, { y: 2.3, z: -0.1 });
  if (p.snow) k.box(6.1, 0.12, 0.3, p.snow, { y: 3.1, z: -0.1 });
  return k.build();
}
export function textTexture(text, { bg = '#3b2a1c', fg = '#f7ecd6', w = 1024, h = 256, font = '800 120px Kanit, Arial Black, sans-serif', stripe = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (stripe) { g.fillStyle = stripe; g.fillRect(0, 0, w, h * 0.1); g.fillRect(0, h * 0.9, w, h * 0.1); }
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text.toUpperCase(), w / 2, h / 2 + 6, w * 0.92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** A race start arch: two padded columns and a beam, w wide (the banner goes on separately). */
export function archGeometry(w, color) {
  const k = new Kit(3);
  for (const s of [-1, 1]) { k.add(new THREE.CapsuleGeometry(0.75, 7.5, 3, 10), color, { x: s * w / 2, y: 4.2, jitter: 0.03 }); k.cyl(1.1, 1.2, 0.5, '#2a2c30', { x: s * w / 2, y: 0.1 }, 12); }
  k.box(w + 1.5, 1.9, 1.3, '#16181c', { y: 8.9 });
  return k.build();
}
/** A round hay bale (lying down, 1.2 m across). */
export function hayGeometry() {
  const k = new Kit(5);
  k.add(new THREE.CylinderGeometry(0.62, 0.62, 1.15, 14, 1), '#d9b45a', { y: 0.58, rz: Math.PI / 2, jitter: 0.06, shade: (c, x, y, z, ny) => { if (Math.abs(x) > 0.55) c.multiplyScalar(0.82); else c.multiplyScalar(0.9 + 0.1 * Math.sin(Math.atan2(y - 0.58, z) * 10)); } });
  return k.build();
}
/** A trail marker stake with a reflective tip. */
export function stakeGeometry(color) {
  const k = new Kit(9);
  k.box(0.12, 1.3, 0.12, '#f3f0e6', { y: 0.55 });
  k.box(0.14, 0.32, 0.14, color, { y: 1.08, jitter: 0 });
  return k.build();
}
/** A flag pole with a pennant. */
export function flagGeometry(color) {
  const k = new Kit(11);
  k.cyl(0.04, 0.05, 5.5, '#e8e8e8', { y: 2.6 });
  k.gable(1.4, 2.2, 0.03, color, { x: 0.7, y: 4.1, rz: -Math.PI / 2, jitter: 0 });
  return k.build();
}
