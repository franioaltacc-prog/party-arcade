/* Skyvvd's jump plane ("Small Airplane" by Vojtěch Balák, CC BY 3.0 via Poly Pizza; until it has loaded, or if it
   can't, a plane built from boxes stands in). You ride up in it and climb out of its door onto the step by the wing strut, as jumpers do from a small plane, and jump.
   A jump run (a challenge): it flies a straight line over the drop point, and the door is right over it at GO, so you
   leave from the same place, height and speed as everyone. Free flight: it circles past the drop point until you jump.
   Either way, once you're out it flies on, climbing away, and is gone after a while. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const SPEED = 32;   // m/s (a jump plane on its run flies slow, about 60 knots)
const RADIUS = 260;        // free flight: the circle it flies round (a lap takes about 50 s)
const AWAY = 45;           // seconds it flies on after you've jumped, before it's put away
/** The step outside its door, in the plane (x forward, y up, z to the right): where you stand before you jump. */
export const DOOR = new THREE.Vector3(-0.35, -0.55, 1.5);

let src = null; let loading = null;
export function preloadPlane() {
  return loading ||= new Promise((resolve) => new GLTFLoader().load('/models/moto/plane.glb', (g) => { src = g.scene; resolve(true); }, undefined, (e) => { console.warn('plane', e); resolve(false); }));
}

/** The plane model (x forward, y up): the file's plane turned round (it points along -z), its propeller spinning
    about its own hub; or the box-built one. */
function makeModel() {
  const root = new THREE.Group(); let prop = null; const owned = [];
  if (src) {
    const m = src.clone(true); m.rotation.y = -Math.PI / 2; root.add(m);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (/propeller/i.test(o.name)) prop = o; } });
    if (prop) {
      // (centred on the hub, so it turns on the spot)
      prop.geometry = prop.geometry.clone(); owned.push(prop.geometry); prop.geometry.computeBoundingBox();
      const c = prop.geometry.boundingBox.getCenter(new THREE.Vector3()); prop.geometry.translate(-c.x, -c.y, 0);
      prop.position.set(c.x, c.y, 0);
    }
    return { root, prop, owned, mats: [] };
  }
  const white = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 }); const red = new THREE.MeshStandardMaterial({ color: '#b3200f', roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#333', roughness: 0.5 });
  const box = (w, h, d, mat, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); owned.push(g); const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.castShadow = true; root.add(o); return o; };
  box(7.5, 1.4, 1.3, white, 0.8, 0.3, 0); box(2, 1.6, 1.4, white, 1.8, 0.4, 0); box(1.4, 0.2, 11, white, 0.9, 1.25, 0);
  box(1.2, 1.5, 0.12, red, -3, 1.2, 0); box(1.2, 0.12, 3.4, white, -3, 0.6, 0); box(0.9, 0.5, 1.32, red, 0.8, 0.0, 0);
  prop = box(0.1, 2.2, 0.18, dark, 4.65, 0.25, 0);
  return { root, prop, owned, mats: [white, red, dark] };
}

/** A plane in the scene. ground: the world's ground (heightAt), to keep its circle clear of the hills. */
export function createPlane(scene, ground) {
  const m = makeModel(); scene.add(m.root); m.root.visible = false;
  const door = new THREE.Vector3(); const off = new THREE.Vector3();
  let path = null; let t = 0; let away = null;
  const pose = { x: 0, y: 0, z: 0, h: 0, bank: 0, pitch: 0 };
  function place() {
    m.root.rotation.set(pose.bank, -pose.h, pose.pitch, 'YZX');
    off.copy(DOOR).applyEuler(m.root.rotation);
    m.root.position.set(pose.x, pose.y, pose.z).sub(off);   // (the pose is the door's: the plane is put round it)
    door.set(pose.x, pose.y, pose.z);
  }
  function at(tt) {
    if (path.circle) {
      const { cx, cz, s, h, w, y, bank } = path; const ang = h - s * Math.PI / 2 + s * w * tt;
      Object.assign(pose, { x: cx + Math.cos(ang) * RADIUS, z: cz + Math.sin(ang) * RADIUS, y, h: h + s * w * tt, bank: s * bank, pitch: 0 });
    } else {
      const { x, z, y, h } = path;
      Object.assign(pose, { x: x + Math.cos(h) * SPEED * tt, z: z + Math.sin(h) * SPEED * tt, y, h, bank: 0, pitch: 0 });
    }
  }
  return {
    door, pose,
    get visible() { return m.root.visible; },
    get flying() { return !!path && !away; },
    /** Line up a jump run: the door is over (x, z) at height y, heading h (b.h's angles), `lead` seconds from now.
        circle: keep circling round past it (free flight) until release(). */
    run(x, y, z, h, lead = 0, circle = false) {
      away = null; t = -lead; m.root.visible = true;
      if (!circle) { path = { x, y, z, h }; at(t); place(); return; }
      // the circle runs through the drop point, along the heading, turning whichever way has the lower hills under it
      // (and high enough to clear them)
      let best = null;
      for (const s of [1, -1]) {
        const cx = x + Math.cos(h + s * Math.PI / 2) * RADIUS; const cz = z + Math.sin(h + s * Math.PI / 2) * RADIUS;
        let top = -Infinity; for (let a = 0; a < 6.28; a += 0.13) top = Math.max(top, ground.heightAt(cx + Math.cos(a) * RADIUS, cz + Math.sin(a) * RADIUS));
        if (!best || top < best.top) best = { s, cx, cz, top };
      }
      path = { circle: true, ...best, h, w: SPEED / RADIUS, y: Math.max(y, best.top + 45), bank: Math.atan(SPEED * SPEED / (9.8 * RADIUS)) * 0.6 };   // (banked a bit less than it really would be: it reads better)
      at(t); place();
    },
    /** You've jumped: it flies on the way it's heading, levelling out and climbing away. */
    release() { if (!path || away) return; away = { ...pose, t: 0 }; },
    update(dt) {
      if (!path || !m.root.visible) return;
      if (m.prop) m.prop.rotation.z += dt * 40;   // (the propeller: a blur)
      if (away) {
        away.t += dt; const k = Math.min(1, away.t / 3);
        pose.x += Math.cos(pose.h) * SPEED * dt; pose.z += Math.sin(pose.h) * SPEED * dt; pose.y += dt * 4 * k;
        pose.bank = away.bank * (1 - k); pose.pitch = 0.08 * k;
        if (away.t > AWAY) { m.root.visible = false; path = null; away = null; return; }
      } else { t += dt; at(t); }
      place();
    },
    /** A point beside the plane (x forward, y up, z right, from its door; turned with its heading, not its bank) in
        the world: out (a Vector3). */
    toWorld(x, y, z, out) { const c = Math.cos(pose.h); const n = Math.sin(pose.h); return out.set(door.x + c * x - n * z, door.y + y, door.z + n * x + c * z); },
    hide() { m.root.visible = false; path = null; away = null; },
    dispose() { m.root.removeFromParent(); for (const g of m.owned) g.dispose(); for (const mt of m.mats) mt.dispose(); },
  };
}
