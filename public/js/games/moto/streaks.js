/* Wind streaks: faint short lines hanging in the air around you, stretched the way you're moving. They stay put in
   the world, so at speed they rush past the camera (near ones faster than far ones), the way roadside posts sell
   speed in a racing game. Each one that falls behind comes round again ahead. Snow worlds get flakes' white;
   elsewhere they're a pale dust colour. */
import * as THREE from 'three';

const N = 160; const BOX = new THREE.Vector3(22, 9, 22);
export function makeStreaks(scene, { snow = false, night = false } = {}) {
  const pos = new Float32Array(N * 6); const pts = [];
  for (let i = 0; i < N; i++) pts.push(new THREE.Vector3(1e9, 0, 0));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: snow ? '#ffffff' : '#fff6e6', transparent: true, opacity: 0, depthWrite: false, fog: true });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 5; lines.visible = false;
  scene.add(lines);
  const c = new THREE.Vector3(); const d = new THREE.Vector3();
  return {
    /** cam: the camera; vel: the velocity (m/s, world); k: 0..1 how strongly to show them. */
    update(cam, vel, k) {
      mat.opacity += (k * (night ? 0.2 : 0.55) - mat.opacity) * 0.1;   // (at night: barely there)
      lines.visible = mat.opacity > 0.01;
      if (!lines.visible) return;
      const v = vel.length(); if (v < 0.1) return;
      // the box of air they live in sits mostly ahead of the camera, where they'll come from
      c.copy(vel).multiplyScalar(14 / v).add(cam.position);
      const len = Math.min(3.5, v * 0.045);
      for (let i = 0; i < N; i++) {
        const p = pts[i]; d.subVectors(p, c);
        let moved = false;
        for (const ax of ['x', 'y', 'z']) {
          const B = BOX[ax];
          if (d[ax] > B) { d[ax] -= 2 * B; moved = true; } else if (d[ax] < -B) { d[ax] += 2 * B; moved = true; }
        }
        if (p.x > 1e8) { d.set((Math.random() * 2 - 1) * BOX.x, (Math.random() * 2 - 1) * BOX.y, (Math.random() * 2 - 1) * BOX.z); moved = true; }
        if (moved) {
          p.addVectors(c, d);
          if (p.distanceToSquared(cam.position) < 4) p.y += 3;   // (not right in your face)
        }
        const o = i * 6;
        pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
        pos[o + 3] = p.x - vel.x / v * len; pos[o + 4] = p.y - vel.y / v * len; pos[o + 5] = p.z - vel.z / v * len;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { lines.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}
