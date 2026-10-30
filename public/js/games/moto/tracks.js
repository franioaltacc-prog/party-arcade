/* Tracks on the ground, behind everyone riding an open world: a snowboard (or a pair of skis) cuts a groove in the snow,
   and wheels leave tyre tracks: dark ruts in mud, a dent in sand, a trace on dirt and grass, a line in snow. Each kind is
   a strip of short pieces laid on the ground (the last few thousand are kept, shared by all the riders), wider where a
   board slid sideways than where it carved on its edge. A track stops in the air and starts again where they land.
   Old pieces fade away; where it's snowing they fill back in (over FILL seconds). In a room each rider's grooves are
   tinted their colour. Made from code: no image files. */
import * as THREE from 'three';

const STEP = 0.45;    // metres between the points of a track
const LIFT = 0.025;   // (just above the ground, so it doesn't flicker into it)
const FILL = 75;      // seconds for falling snow to cover a groove
const FADE = 160;     // seconds for a track to fade away anywhere else
const now = () => performance.now() / 1000;

/** A groove's look across its width (u 0..1) and a little along it (board chatter): colour and see-through in one
    picture, and how deep it is for the bumps. */
function grooveTextures() {
  const W = 64; const H = 64;
  const depth = (u) => {   // 0 the snow round it, - down in the groove, + the lips of snow pushed out
    const lip = (c) => Math.exp(-(((u - c) / 0.07) ** 2)) * 0.45;
    const floor = 1 / (1 + Math.exp(-(u - 0.2) * 40)) * (1 / (1 + Math.exp((u - 0.8) * 40)));
    return lip(0.08) + lip(0.92) - floor;
  };
  return paint(W, H, (u, y) => {
    const chatter = Math.sin(y / H * Math.PI * 6) * 0.02 + Math.sin(y / H * Math.PI * 22) * 0.012;
    const d = depth(u + chatter); const slope = (depth(u + chatter + 0.01) - depth(u + chatter - 0.01)) / 0.02;
    // the floor: packed snow in the shade of its walls (a little darker and bluer than the snow round it), the far
    // wall darker still; the lips: fresh snow catching the light; outside: nothing
    const inGroove = Math.max(0, -d); const lip = Math.max(0, d) / 0.45; const wall = Math.max(0, slope) * inGroove;
    const k = lip > 0.05 ? 1 : 0.74 - wall * 0.1;
    return { r: 214 * k + 40 * lip, g: 226 * k + 28 * lip, b: 248 * k + 7 * lip, a: inGroove * 0.36 + lip * 0.22 + Math.min(0.2, wall * 0.06), slope: slope * 0.22 };
  });
}
/** A tyre's print: knobbly tread blocks pressed into the ground (grey: the ground's own colour comes from the piece). */
function tyreTextures() {
  const W = 32; const H = 64;
  return paint(W, H, (u, y) => {
    const edge = Math.min(1, Math.min(u, 1 - u) / 0.14);   // (soft sides)
    const row = Math.floor(y / 8); const off = row % 2 ? 0.25 : 0;
    const knob = ((u + off) * 4) % 1 < 0.55 && y % 8 < 5 ? 1 : 0;   // (staggered knobs)
    const a = edge * (0.55 + 0.45 * knob);
    const k = 0.8 + 0.2 * (1 - knob);
    return { r: 255 * k, g: 255 * k, b: 255 * k, a, slope: (knob ? 0 : 0.15) * (u < 0.5 ? 1 : -1) };
  });
}
function paint(W, H, at) {
  const col = document.createElement('canvas'); col.width = W; col.height = H;
  const nor = document.createElement('canvas'); nor.width = W; nor.height = H;
  const c = col.getContext('2d').createImageData(W, H); const n = nor.getContext('2d').createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = at(x / (W - 1), y); const i = (y * W + x) * 4;
    c.data[i] = p.r; c.data[i + 1] = p.g; c.data[i + 2] = p.b; c.data[i + 3] = Math.min(255, Math.max(0, p.a * 255));
    const nx = -p.slope; const l = Math.hypot(nx, 1);   // (the bumps: a normal map, x across the track)
    n.data[i] = (nx / l * 0.5 + 0.5) * 255; n.data[i + 1] = 128; n.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; n.data[i + 3] = 255;
  }
  col.getContext('2d').putImageData(c, 0, 0); nor.getContext('2d').putImageData(n, 0, 0);
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nor);
  for (const t of [map, normalMap]) { t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, normalMap };
}

/** One kind of track: max pieces, its look, and how long a piece lasts (life seconds). */
function strip(scene, heightAt, { max, tex, life, normalScale = 1.4, repeat = 3 }) {
  const pos = new Float32Array(max * 12); const uv = new Float32Array(max * 8); const col = new Float32Array(max * 12).fill(1); const born = new Float32Array(max * 4).fill(-1e6);
  const nrm = new Float32Array(max * 12); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  const index = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) { const v = i * 4; index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6); }
  const geo = new THREE.BufferGeometry();
  const attr = (name, a, n) => geo.setAttribute(name, new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage));
  attr('position', pos, 3); attr('uv', uv, 2); attr('normal', nrm, 3); attr('color', col, 3); attr('born', born, 1);
  geo.setIndex(new THREE.BufferAttribute(index, 1)); geo.setDrawRange(0, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(normalScale, normalScale), vertexColors: true, roughness: 0.62, metalness: 0,
    side: THREE.DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const clock = { value: now() };
  mat.onBeforeCompile = (sh) => {   // (old pieces fade: snowed over, or just worn away)
    sh.uniforms.uNow = clock; sh.uniforms.uLife = { value: life };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float born;\nvarying float vBorn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBorn = born;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNow;\nuniform float uLife;\nvarying float vBorn;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.0, uLife, uNow - vBorn);');
  };
  mat.customProgramCacheKey = () => 'track-fade';
  const mesh = new THREE.Mesh(geo, mat); mesh.onBeforeRender = () => { clock.value = now(); }; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.renderOrder = 1;
  scene.add(mesh);
  let count = 0;
  const riders = new Map();   // id -> the track's last point { x, z, w, v }
  const put = (i, k, x, z, u, v) => {
    const j = (i * 4 + k) * 3; pos[j] = x; pos[j + 1] = heightAt(x, z) + LIFT; pos[j + 2] = z;
    uv[(i * 4 + k) * 2] = u; uv[(i * 4 + k) * 2 + 1] = v;
  };
  return {
    /** A point of a track: (x, z), the thing's length along (ax, az) (a unit vector; a board sliding sideways scrapes
        as wide as it is long), width: across it, color: [r, g, b] (0..1, times the picture), alpha: how strong. */
    mark(id, x, z, ax, az, on, width, color, slide = 1.4) {
      const last = riders.get(id);
      if (!on) { riders.delete(id); return; }
      if (!last) { riders.set(id, { x, z, w: width, v: 0 }); return; }
      const dx = x - last.x; const dz = z - last.z; const d = Math.hypot(dx, dz);
      if (d < STEP) return;
      if (d > 4) { riders.set(id, { x, z, w: width, v: 0 }); return; }   // (a reset or a jump across: a new track)
      const fx = dx / d; const fz = dz / d;
      const w = width + Math.min(1.1, Math.abs(ax * fz - az * fx) * slide);
      const v = last.v + d / repeat;
      const i = count % max;
      put(i, 0, last.x - fz * last.w / 2, last.z + fx * last.w / 2, 0, last.v); put(i, 1, last.x + fz * last.w / 2, last.z - fx * last.w / 2, 1, last.v);
      put(i, 2, x - fz * w / 2, z + fx * w / 2, 0, v); put(i, 3, x + fz * w / 2, z - fx * w / 2, 1, v);
      // the ground's slope under the piece, for the light
      const o = i * 12;
      const ux = pos[o + 6] - pos[o]; const uy = pos[o + 7] - pos[o + 1]; const uz = pos[o + 8] - pos[o + 2];
      const sx = pos[o + 3] - pos[o]; const sy = pos[o + 4] - pos[o + 1]; const sz = pos[o + 5] - pos[o + 2];
      let nx = uy * sz - uz * sy; let ny = uz * sx - ux * sz; let nz = ux * sy - uy * sx; const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (let k = 0; k < 4; k++) { nrm.set([nx, ny, nz], o + k * 3); col.set(color, o + k * 3); }
      born.fill(now(), i * 4, i * 4 + 4);
      for (const [name, size] of [['position', 12], ['uv', 8], ['normal', 12], ['color', 12], ['born', 4]]) { geo.attributes[name].addUpdateRange(i * size, size); geo.attributes[name].needsUpdate = true; }
      count++; geo.setDrawRange(0, Math.min(count, max) * 6);
      riders.set(id, { x, z, w, v });
    },
    get count() { return count; },
    clear() { count = 0; riders.clear(); geo.setDrawRange(0, 0); },
    dispose() { mesh.removeFromParent(); geo.dispose(); mat.dispose(); tex.map.dispose(); tex.normalMap.dispose(); },
  };
}

// the colour of a tyre's print on each kind of ground (times the grey tread picture), and how strong it is
const PRINT = { mud: [0.2, 0.14, 0.09], sand: [0.62, 0.48, 0.32], snow: [0.62, 0.7, 0.82], grass: [0.3, 0.36, 0.18], trail: [0.36, 0.27, 0.19] };
const WHITE = [1, 1, 1];
const tint = (hex) => { const c = new THREE.Color(hex); return [0.55 + c.r * 0.45, 0.55 + c.g * 0.45, 0.55 + c.b * 0.45]; };

/** The tracks for a world: heightAt(x, z) is the ground's height, surfaceAt(x, z).kind what it's made of; snowing: the
    grooves fill in. Call groove / skis / tyres for each rider every frame. */
export function createTracks(scene, heightAt, surfaceAt, { snowing = false } = {}) {
  const grooves = strip(scene, heightAt, { max: 2400, tex: grooveTextures(), life: snowing ? FILL : FADE });
  const prints = strip(scene, heightAt, { max: 3000, tex: tyreTextures(), life: snowing ? FILL : FADE, normalScale: 0.8, repeat: 0.5 });
  const colorOf = (hex) => (hex ? tint(hex) : WHITE);
  return {
    /** A snowboard at (x, z) pointing along (ax, az). color: the rider's colour in a room (or none). */
    groove(id, x, z, ax, az, on, color) { grooves.mark(id, x, z, ax, az, on, 0.26, colorOf(color)); },
    /** A pair of skis (side: the unit vector across them): two narrow grooves. */
    skis(id, x, z, ax, az, on, color) {
      for (const s of [-1, 1]) grooves.mark(id + (s < 0 ? ':l' : ':r'), x - az * s * 0.15, z + ax * s * 0.15, ax, az, on, 0.11, colorOf(color), 0.4);
    },
    /** A tyre touching the ground at (x, z): width wide. */
    tyre(id, x, z, ax, az, on, width = 0.18) {
      const kind = on ? surfaceAt(x, z).kind : null;
      prints.mark(id, x, z, ax, az, on && !!PRINT[kind], kind === 'mud' ? width * 1.25 : width, PRINT[kind] || WHITE, 0);
    },
    get count() { return grooves.count + prints.count; },
    clear() { grooves.clear(); prints.clear(); },
    dispose() { grooves.dispose(); prints.dispose(); },
  };
}
