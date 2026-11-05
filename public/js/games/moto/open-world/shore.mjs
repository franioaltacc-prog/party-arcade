/** The seaside (a world's "look": {"lakeWater": {...}, "beach": {...}}):
 *  - lakeWater: a lake drawn with the sea's water (ocean.mjs): wind chop, foam lapping at the shore, the colour going
 *    from clear turquoise over the sand to deep green-blue, the sky mirrored in it. Optional settings: shallow, mid,
 *    deep, clear, waves [[wavelength m, height m, direction °]…], whitecaps (0..1), swash (m).
 *  - beach: coconut palms (palms.mjs) leaning over the sand along the shore, in clumps, with the odd lone one, the
 *    full model close by and a simpler one further off; their trunks are solid (crash into one), and the fronds sway
 *    in the sea breeze. Optional: { band: [lowest, highest m above the water], every: metres between tries, chance }.
 */
import * as THREE from 'three';
import {createOcean} from './ocean.mjs';
import {jungleModels} from './palms.mjs';

/** The lake's water (terrain.lake) with the sea's shader. */
export function lakeWater(terrain, scene, map, { quality = 1, dark = false } = {}) {
  const L = map.terrain.lake, W = map.look?.lakeWater;
  return createOcean(terrain, scene, map, { quality, dark, lake: { level: L.level, position: L.position, radius: L.radius, ...(W && typeof W === 'object' ? W : {}) } });
}

const rng = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const BREEZE = { value: 0 };

/** A copy of a palm material whose fronds sway in the breeze (the higher up, the more; each palm on its own beat). */
function swaying(src, frond) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBreeze = BREEZE;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBreeze;').replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec3 o = vec3(0.0);
#ifdef USE_INSTANCING
  o = instanceMatrix[3].xyz;
#endif
  float ph = uBreeze * 1.1 + o.x * .21 + o.z * .17, h = max(transformed.y, 0.0);
  transformed.xz += vec2(.7, .45) * (sin(ph) * .6 + sin(ph * 2.7 + 1.3) * .25 + .5) * .0016 * h * h;
  ${frond ? 'transformed.y += sin(ph * 3.1 + transformed.x * 2.0) * .035 * smoothstep(5.0, 9.0, h);' : ''}
}`);
  };
  m.customProgramCacheKey = () => 'shore-palm-' + (frond ? 'f' : 't');
  return m;
}

/** Palms along the beaches. Returns { update(eye, dt), dispose() }. */
export function beachDress(terrain, scene, map, { quality = 1, shadows = false } = {}) {
  const B = map.look?.beach || {}, level = map.sea ? map.sea.level : map.terrain.lake ? map.terrain.lake.level : 0;
  const ground = map.sea ? terrain.bedAt : terrain.heightAt;
  const [lo, hi] = B.band || [.6, 6], every = B.every || 7, chance = (B.chance ?? .32) * Math.min(1, .45 + quality * .6);
  const W = map.size[0], D = map.size[1], r = rng((map.seed || 1) * 7 + 3), spots = [];
  const wet = (x, z) => ground(x, z) < level;
  // (where the clumps are: a soft pattern of patches along the shore)
  const clump = (x, z) => .5 + .5 * Math.sin(x * .021 + Math.sin(z * .013) * 2.2) * Math.cos(z * .017 - Math.sin(x * .011) * 1.7);
  for (let z = -D / 2 + every; z < D / 2 - every; z += every) for (let x = -W / 2 + every; x < W / 2 - every; x += every) {
    const px = x + (r() - .5) * every, pz = z + (r() - .5) * every, roll = r();
    if (roll > chance * (.25 + clump(px, pz) * 1.2)) continue;
    const y = ground(px, pz); if (y < level + lo || y > level + hi) continue;
    const s1 = Math.abs(ground(px + 3, pz) - ground(px - 3, pz)) / 6, s2 = Math.abs(ground(px, pz + 3) - ground(px, pz - 3)) / 6; if (Math.max(s1, s2) > .32) continue;
    if (terrain.wild && terrain.wild(px, pz) < .35) continue;   // (not on a trail, a pad or a jump)
    if (terrain.obstacleAt && terrain.obstacleAt(px, pz)) continue;
    let near = false; for (let k = 0; k < 8 && !near; k++) { const a = k * .785; for (const d of [12, 28, 48]) if (wet(px + Math.cos(a) * d, pz + Math.sin(a) * d)) { near = true; break; } }
    if (!near) continue;   // (a beach: the water close by)
    // lean out towards the water a little, as palms on a beach do
    let sx = 0, sz = 0; for (let k = 0; k < 8; k++) { const a = k * .785; if (wet(px + Math.cos(a) * 40, pz + Math.sin(a) * 40)) { sx += Math.cos(a); sz += Math.sin(a); } }
    spots.push({ x: px, z: pz, y: y - .15, v: Math.floor(r() * 4), s: .8 + r() * .45, a: Math.atan2(sz, sx), spin: r() * 6.283 });
  }
  if (!spots.length) return null;
  terrain.addSolids?.(spots.map((p) => ({ x: p.x, z: p.z, r: .32 * p.s, tall: 9 })));
  const J = jungleModels(), disposables = [], group = new THREE.Group(); group.name = 'beach'; scene.add(group);
  const trunkMat = swaying(J.mats.trunkMat, false), frondMat = swaying(J.mats.frondMat, true); disposables.push(trunkMat, frondMat);
  const mats = [trunkMat, frondMat];
  // per variant, per detail (0 close, 1 far): an InstancedMesh for each part
  const sets = J.palms.map((v, vi) => [v.near, v.far].map((parts, far) => {
    const n = spots.filter((p) => p.v === vi).length;
    return parts.map(([{ geo }, k]) => { const m = new THREE.InstancedMesh(geo, mats[k], Math.max(1, n)); m.count = 0; m.castShadow = shadows && !far; m.receiveShadow = false; m.frustumCulled = false; group.add(m); return m; });
  }));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const matrixOf = (p) => { E.set(Math.sin(p.a) * .12, p.spin, -Math.cos(p.a) * .12, 'YXZ'); Q.setFromEuler(E); S.setScalar(p.s); return M4.compose(P.set(p.x, p.y, p.z), Q, S); };
  const NEAR = 70 + 60 * quality;
  let lastX = Infinity, lastZ = Infinity;
  function sort(eye) {
    for (const vs of sets) for (const parts of vs) for (const m of parts) m.count = 0;
    for (const p of spots) {
      const far = Math.hypot(p.x - eye.x, p.z - eye.z) > NEAR ? 1 : 0, M = matrixOf(p);
      for (const m of sets[p.v][far]) m.setMatrixAt(m.count++, M);
    }
    for (const vs of sets) for (const parts of vs) for (const m of parts) m.instanceMatrix.needsUpdate = true;
  }
  return {
    spots,
    update(eye, dt) {
      BREEZE.value = (BREEZE.value + (dt || 0)) % 1000;
      if (Math.hypot(eye.x - lastX, eye.z - lastZ) > 12) { lastX = eye.x; lastZ = eye.z; sort(eye); }
    },
    dispose() { group.removeFromParent(); for (const vs of sets) for (const parts of vs) for (const m of parts) m.dispose(); for (const d of disposables) d.dispose(); },
  };
}
