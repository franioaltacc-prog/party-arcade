/* Wavvd's wakeboarding: a speedboat pulls you round a loop of open water on a rope. You don't steer the boat or
   have a throttle: A / D carve you out to either side of it (the rope swings you round and you speed up), and the
   boat's wake is two real ridges of water behind it: cut across one hard and it throws you into the air, where the
   board's tricks and spins work as they do on the snow. The boat, its rope, its foam and the ridges are all here;
   game.js calls step() after each physics step (which moves you along the rope) and update() each frame. */
import * as THREE from 'three';

export const TOW = { centre: [250, 1200], radii: [500, 280], speed: 13.5, rope: 19, pylon: 3.2 };
const TAN = Math.tan(17 * Math.PI / 180);   // (how fast the wake's two ridges spread out behind the boat)

/** The boat, its loop and the rope. ground: the world's terrain (its waves, and the hook for the ridges). */
export function createTow(scene, ground, ocean) {
  // the loop, sampled every so often by distance along it
  const [cx, cz] = TOW.centre; const [rx, rz] = TOW.radii; const pts = []; let len = 0;
  for (let i = 0; i <= 1440; i++) {
    const a = -Math.PI / 2 + (i / 1440) * Math.PI * 2; const x = cx + Math.cos(a) * rx; const z = cz + Math.sin(a) * rz;
    if (i) len += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
    pts.push({ x, z, s: len });
  }
  const at = (s) => {
    s = ((s % len) + len) % len; let lo = 0; let hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
    const p = pts[lo]; const q = pts[hi]; const k = (s - p.s) / Math.max(1e-6, q.s - p.s);
    return { x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, h: Math.atan2(q.z - p.z, q.x - p.x) };
  };
  const boat = speedboat(); scene.add(boat);
  const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#f4e9c8' }));
  rope.frustumCulled = false; scene.add(rope);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.6 }));
  scene.add(handle);
  let s = 0; let v = 0; let B = at(0);
  const pylon = () => ({ x: B.x - Math.cos(B.h) * TOW.pylon, z: B.z - Math.sin(B.h) * TOW.pylon });

  // the wake's two ridges, behind where the boat is now (it turns gently, so a straight line behind it is near enough)
  const ridges = (x, z) => {
    if (v < 3) return 0;
    const c = Math.cos(B.h); const sn = Math.sin(B.h); const dx = x - B.x; const dz = z - B.z;
    const back = -(dx * c + dz * sn); if (back < 2 || back > 70) return 0;
    const side = Math.abs(-dx * sn + dz * c); const crest = 1 + back * TAN; const e = (side - crest) / 1.3;
    return Math.min(1, v / TOW.speed) * 0.8 * Math.exp(-back / 48) * Math.exp(-e * e) * Math.min(1, (back - 2) / 4);
  };
  ground.setSeaExtra?.(ridges);

  return {
    len,
    /** Where to put a rider: behind the boat on the end of the rope (heading: the map's, like a safe pad's). */
    behind() { const p = pylon(); const d = TOW.rope - 1; return { position: [p.x - Math.cos(B.h) * d, p.z - Math.sin(B.h) * d], heading: Math.PI / 2 - B.h }; },
    /** After a physics step: the boat goes on round (once go is true), and a taut rope pulls the rider along it. */
    step(b, dt, go, before) {
      if (go) { v = Math.min(TOW.speed, v + dt * 2.6); s += v * dt; }
      B = at(s);
      if (b.crashed) return;
      const p = pylon(); const dx = b.px - p.x; const dz = b.pz - p.z; const d = Math.hypot(dx, dz);
      if (d > TOW.rope) {
        const nx = p.x + (dx / d) * TOW.rope; const nz = p.z + (dz / d) * TOW.rope;
        const mx = (nx - before.x) / dt; const mz = (nz - before.z) / dt;   // (how the rider really moved)
        b.px = nx; b.pz = nz; b.vx = Math.max(b.vx * 0.2, mx * Math.cos(b.h) + mz * Math.sin(b.h));
      }
      // you stay behind the boat: out to the side at most 65° from straight behind, and with the rope slack you drop back
      { const c = Math.cos(B.h); const sn = Math.sin(B.h); const rx = b.px - p.x; const rz = b.pz - p.z; const dist = Math.hypot(rx, rz);
        const back = -(rx * c + rz * sn); const side = -rx * sn + rz * c; const ang = Math.atan2(Math.abs(side), back);
        if (ang > 1.13) { const a = 1.13 * Math.sign(side || 1); b.px = p.x - c * Math.cos(a) * dist - sn * Math.sin(a) * dist; b.pz = p.z - sn * Math.cos(a) * dist + c * Math.sin(a) * dist; }
        if (dist < TOW.rope * 0.85 && b.vx > v * 0.85) b.vx = Math.max(v * 0.85, b.vx - dt * 8); }
      // a hard cut swings you out faster than the boat, up to a point; the water soon slows you back to its speed
      if (b.vx > v * 1.6 + 1) b.vx = v * 1.6 + 1;
      if (b.vx > v && (b.wh[0].ct || b.wh[1].ct)) b.vx -= (b.vx - v) * dt * 0.35;
      // you can carve out to the side, but the board can't point more than ~75° away from the boat
      const to = Math.atan2(p.z - b.pz, p.x - b.px); const off = Math.atan2(Math.sin(b.h - to), Math.cos(b.h - to));
      if (Math.abs(off) > 1.3) b.h = to + Math.sign(off) * 1.3;
    },
    /** Each frame: the boat on the waves, its foam, the rope to the rider's hands. */
    update(model, now) {
      const y = ground.waveAt(B.x, B.z); const c = Math.cos(B.h); const sn = Math.sin(B.h);
      const pitch = Math.atan2(ground.waveAt(B.x + c * 2.5, B.z + sn * 2.5) - ground.waveAt(B.x - c * 2.5, B.z - sn * 2.5), 5) + Math.min(1, v / TOW.speed) * 0.06;
      const roll = Math.atan2(ground.waveAt(B.x - sn * 1.2, B.z + c * 1.2) - ground.waveAt(B.x + sn * 1.2, B.z - c * 1.2), 2.4);
      boat.position.set(B.x, y - 0.25, B.z); boat.rotation.set(0, 0, 0); boat.rotateY(-B.h); boat.rotateZ(pitch); boat.rotateX(roll);
      boat.updateMatrixWorld();
      if (v > 2) ocean?.wake('boat', B.x - c * 3.6, B.z - sn * 3.6, B.h, v);
      const a = boat.localToWorld(new THREE.Vector3(-TOW.pylon, 2.05, 0));
      const hand = model ? model.root.localToWorld(new THREE.Vector3(0.3, 1.05, 0)) : a;
      rope.geometry.attributes.position.setXYZ(0, a.x, a.y, a.z); rope.geometry.attributes.position.setXYZ(1, hand.x, hand.y, hand.z); rope.geometry.attributes.position.needsUpdate = true;
      handle.position.copy(hand); handle.lookAt(a); handle.rotateY(Math.PI / 2);
      rope.visible = handle.visible = !!model?.root.visible;
    },
    get speed() { return v; },
    dispose() {
      ground.setSeaExtra?.(null);
      for (const o of [boat, rope, handle]) { o.removeFromParent(); o.traverse((m) => { m.geometry?.dispose(); m.material?.dispose?.(); }); }
    },
  };
}

/** A small ski boat (x forward, y up), about 6 m long: a white hull with a stripe, the deck, a windscreen, seats,
    the driver and the tow pylon at the back. */
function speedboat() {
  const g = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(3.1, 0); outline.bezierCurveTo(2.4, 1.05, 0.8, 1.2, -2.9, 1.15); outline.lineTo(-3.05, 0);
  outline.lineTo(-2.9, -1.15); outline.bezierCurveTo(0.8, -1.2, 2.4, -1.05, 3.1, 0);
  const hullGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.85, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 18 }).rotateX(-Math.PI / 2);
  // (a V under the bow: the bottom narrows towards the front)
  const p = hullGeo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.3) { const k = 1 - Math.max(0, p.getX(i) + 1) / 4.6 * 0.55; p.setZ(i, p.getZ(i) * (0.45 + 0.55 * k) + 0 * y); } }
  hullGeo.computeVertexNormals();
  const white = new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const hull = new THREE.Mesh(hullGeo, white); hull.castShadow = true; g.add(hull);
  const stripe = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.16, bevelEnabled: true, bevelSize: 0.135, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 18 }).rotateX(-Math.PI / 2).translate(0, 0.5, 0),
    new THREE.MeshPhysicalMaterial({ color: '#0f6fd6', roughness: 0.3, clearcoat: 1 }));
  g.add(stripe);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(outline, 18).rotateX(-Math.PI / 2).scale(0.92, 1, 0.88).translate(-0.1, 0.99, 0), new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 0.85 }));
  g.add(deck);
  const dark = new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.6 });
  for (const [x, z, w] of [[-0.45, 0.45, 0.6], [-0.45, -0.45, 0.6], [-2.1, 0, 1.6]]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, w), dark); seat.position.set(x, 1.08, z); g.add(seat); const back = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, w), dark); back.position.set(x - 0.3, 1.32, z); g.add(back); }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 1.9), new THREE.MeshPhysicalMaterial({ color: '#9fd3ff', roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.45 }));
  screen.position.set(0.75, 1.3, 0); screen.rotation.z = 0.5; g.add(screen);
  const chrome = new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.2, metalness: 1 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 10), chrome); pole.position.set(-3.2 + 0.0 + 0.0, 1.5, 0); pole.position.x = -TOW.pylon; g.add(pole);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 16), chrome); ring.position.set(-TOW.pylon, 2.05, 0); g.add(ring);
  // the driver: a body and a head, a cap
  const skin = new THREE.MeshStandardMaterial({ color: '#c99a78', roughness: 0.7 }); const shirt = new THREE.MeshStandardMaterial({ color: '#e8452f', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10), shirt); body.position.set(-0.45, 1.65, 0.45); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skin); head.position.set(-0.42, 2.12, 0.45); g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1b1f27' })); cap.position.copy(head.position).y += 0.03; g.add(cap);
  return g;
}
