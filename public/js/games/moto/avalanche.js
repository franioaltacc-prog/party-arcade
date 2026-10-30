/* Carvvd's Avalanche! challenge: a wall of snow coming down the mountain behind you. It's a curtain across the slope
   (W metres wide, following the ground), its crest boiling up and down, with clouds of powder thrown up along its front.
   game.js moves it (front: metres from the start along the way down) and checks whether it has caught you. */
import * as THREE from 'three';

const W = 420; const N = 84; const HIGH = 16;

/** start: [x, z] where it breaks, dir: [dx, dz] the way down (a unit vector). */
export function createAvalanche(scene, ground, fx, start, dir) {
  const [x0, z0] = start; const [dx, dz] = dir; const px = dz; const pz = -dx;   // (across the slope)
  const pos = new Float32Array((N + 1) * 3 * 3); const col = new Float32Array((N + 1) * 3 * 3);
  const index = [];
  for (let i = 0; i < N; i++) for (let r = 0; r < 2; r++) { const a = i * 3 + r; const b = (i + 1) * 3 + r; index.push(a, b, a + 1, a + 1, b, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  for (let i = 0; i <= N; i++) for (let r = 0; r < 3; r++) { const k = [0.82, 1, 0.9][r] * (0.92 + 0.08 * Math.sin(i * 1.7)); col.set([k, k, k * 1.02], (i * 3 + r) * 3); }
  const mat = new THREE.MeshStandardMaterial({ color: '#f4f8ff', vertexColors: true, roughness: 1, emissive: '#3b4656', emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  let t = 0;
  return {
    /** Move the wall to front metres down the slope from where it broke. */
    update(front, dt) {
      t += dt;
      for (let i = 0; i <= N; i++) {
        const w = -W / 2 + W * i / N;
        const x = x0 + dx * front + px * w; const z = z0 + dz * front + pz * w; const y = ground.heightAt(x, z);
        const boil = HIGH * (0.75 + 0.25 * Math.sin(t * 1.8 + i * 0.9) + 0.15 * Math.sin(t * 3.1 + i * 2.3));
        const bx = x - dx * 34; const bz = z - dz * 34;
        pos.set([x, y - 1, z, x - dx * 6, y + boil, z - dz * 6, bx, ground.heightAt(bx, bz) + boil * 0.7, bz], i * 9);
        if (Math.random() < 0.18 * dt * 60) fx.puff(x - dx * 4, y + boil * (0.3 + Math.random() * 0.6), z - dz * 4, dx * 6 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, dz * 6 + (Math.random() - 0.5) * 4,
          { life: 1.6 + Math.random(), size: 4 + Math.random() * 4, grow: 6, alpha: 0.7, drag: 0.8, color: fx.colors.snow });
      }
      geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
    },
    dispose() { mesh.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}
