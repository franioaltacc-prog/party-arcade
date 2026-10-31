/* Motocross: the 3D bike and rider, built from code. Every moving part follows the physics: the fork
   slides, the swingarm swings, the shock squashes, the wheels spin, and the rider's body (hips from the
   physics, arms and legs worked out to reach the bars and the pegs) moves with it. Two bikes are 3D
   model files instead (/models/moto, both CC BY 4.0): they're fitted onto the same frame so their
   wheels sit on the physics axles and spin, and the rider reaches their own bars and pegs.
   Bike coordinates: +X forward, +Y up, +Z to the rider's right; the origin is the frame's centre of
   mass (MotoCore's frame), so wheel and rider positions from the physics drop straight in. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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

// bike styles, rider kits and helmets: free to pick, and only looks (every bike rides exactly the same)
export const MODELS = {
  mx4: { name: 'Factory 450', emoji: '🏁', about: 'Four-stroke race bike' },
  mx2: { name: '250 Two-Stroke', emoji: '💨', about: 'Fat expansion chamber' },
  enduro: { name: 'Enduro', emoji: '🔦', about: 'Headlight, hand guards, big tank' },
  retro: { name: 'Retro 70s', emoji: '🕶️', about: 'Chrome high pipe and gaiters' },
  electric: { name: 'E-Moto', emoji: '⚡', about: 'Battery pack that glows' },
  varg: { name: 'Stark Varg', emoji: '🔋', about: 'Detailed electric MX bike (model by Hari Yojuta, CC BY)', file: true },
  hcr2: { name: 'Hill Racer', emoji: '🧡', about: 'Chunky cartoon dirt bike (model by oakar258, CC BY)', file: true },
};
// Unrevvd's mountain bikes (model files too; only looks: they all pedal the same)
export const MTB_MODELS = {
  dh: { name: 'Downhill Pro', emoji: '🚵', about: 'Full-suspension downhill bike (model by Sidra, CC BY)' },
  tyax: { name: 'Trail Hardtail', emoji: '🌲', about: 'Hardtail trail bike (model by Saushkin, CC BY)' },
};
// the model files: which way the bike faces along the model's z (+1 = front wheel at +z), which parts are the
// wheels (node names), and where its grips and footpegs are ([y, z] in the model's own units). A bicycle also has
// cranks (the parts that turn round the bottom bracket bb, with the right pedal at pedal), a saddle, and a rider
// drawn a little bigger (rider: the bikes are bigger than life, so their wheels sit on the same axles as a dirt bike's)
const FILES = {
  varg: { file: '/models/moto/stark-varg.glb', dir: -1, front: /^(Wheel-F|F-Dic|F-Hub|Spoke)/, rear: /^(Wheel-R|R-Wheel|Sprocket001)/, grips: [2.41, -0.42], pegs: [0.82, 0.36] },
  hcr2: { file: '/models/moto/hcr2-motocross.glb', dir: 1, front: /Front_Wheel/, rear: /Rear_Wheel/, grips: [1.78, 0.26], pegs: [0.55, -0.2] },
  dh: { file: '/models/mtb/downhill.glb', dir: 1, front: /^Wheel_F/, rear: /^Wheel_B/, crank: /^Pedal/, grips: [0.695, 0.25], pegs: [0.2225, -0.035],
    bb: [0.2225, -0.035], pedal: [0.17, 0.04], saddle: [0.64, -0.09], rider: 1.1 },
  tyax: { file: '/models/mtb/tyax.glb', dir: 1, front: /^Wheel_F/, rear: /^Wheel_R/, crank: /^Crank/, grips: [88, -29], pegs: [-5.3, -86.1],
    bb: [-5.3, -86.1], pedal: [-5.4, -65.2], saddle: [76, -110], rider: 1.2 },
};
export const KITS = {
  match: { name: 'Match my bike' },
  blackout: { name: 'Blackout', jersey: '#16181c', jersey2: '#2c2f36', pants: '#16181c', boots: '#16181c' },
  white: { name: 'Clean White', jersey: '#f4f5f7', jersey2: '#d61f2c', pants: '#f4f5f7', boots: '#f4f5f7' },
  fire: { name: 'Fire Red', jersey: '#d61f2c', jersey2: '#16181c', pants: '#16181c', boots: '#ffffff' },
  ocean: { name: 'Ocean', jersey: '#1d5bd8', jersey2: '#ffffff', pants: '#0e1f44', boots: '#ffffff' },
  hivis: { name: 'Hi-Vis', jersey: '#d7ff1f', jersey2: '#16181c', pants: '#16181c', boots: '#d7ff1f' },
  bubblegum: { name: 'Bubblegum', jersey: '#ff5fb8', jersey2: '#ffffff', pants: '#3a1030', boots: '#ffffff' },
  blaze: { name: 'Blaze', jersey: '#ff7a1a', jersey2: '#16181c', pants: '#ff7a1a', boots: '#16181c' },
  woodland: { name: 'Woodland', jersey: '#5d6b3a', jersey2: '#3d4728', pants: '#4a4030', boots: '#3a2f22' },
  galaxy: { name: 'Galaxy', jersey: '#6a2bd9', jersey2: '#16d3f0', pants: '#1a0f33', boots: '#6a2bd9' },
  seventies: { name: 'Seventies', jersey: '#e8c27a', jersey2: '#a8432a', pants: '#5a3a24', boots: '#3a2414' },
  champion: { name: 'Champion', jersey: '#16181c', jersey2: '#e3b021', pants: '#e3b021', boots: '#16181c' },
};
export const HELMETS = {
  match: { name: 'Match my bike' },
  white: { name: 'White', helmet: '#f4f5f7', helmet2: '#16181c', lens: '#ffb02e' },
  matte: { name: 'Matte Black', helmet: '#1a1b1f', helmet2: '#3a3d44', lens: '#9ad7ff' },
  red: { name: 'Red', helmet: '#d61f2c', helmet2: '#ffffff', lens: '#ffd21a' },
  blue: { name: 'Blue', helmet: '#1d5bd8', helmet2: '#ffd21a', lens: '#ff7a1a' },
  sun: { name: 'Sunshine', helmet: '#ffd21a', helmet2: '#16181c', lens: '#ff3b7f' },
  toxic: { name: 'Toxic', helmet: '#39ff88', helmet2: '#8b3dff', lens: '#39ff88' },
  candy: { name: 'Candy', helmet: '#ff5fb8', helmet2: '#ffffff', lens: '#9ad7ff' },
  orange: { name: 'Orange', helmet: '#ff7a1a', helmet2: '#16181c', lens: '#ffd21a' },
  gold: { name: 'Gold', helmet: '#e3b021', helmet2: '#16181c', lens: '#ffb02e' },
};
export const RIDERS = {
  biker: { name: 'Mystery Biker', emoji: '🧥', about: 'Leather jacket, jeans and a black visor (model by thomasdonovan26, CC BY)' },
  mx: { name: 'MX Racer', emoji: '🏁', about: 'Classic motocross kit in your rider kit and helmet colours' },
};
/** Unrevvd's riders (on mountain bikes) and Carvvd's snowboarder: Quaternius's CC0 characters. */
export const MTB_RIDERS = {
  bmx: { name: 'Street', emoji: '👟', about: 'T-shirt, jeans and red trainers' },
  punk: { name: 'Punk', emoji: '🤘', about: 'A red mohawk and ripped jeans' },
  hoodie: { name: 'Hoodie', emoji: '🧢', about: 'A hoodie and shorts, whatever the weather' },
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

/** The graphics on the side panels: stripes, a number and the Revvd logo. */
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
    // the logo where the radiator shroud shows it (the panels take this picture 1:1 in metres, so it's drawn twice as wide)
    g.save(); g.translate(w * 0.06, h * 0.62); g.scale(2, 1); revvdLogo(g, 0, 0, h * 0.1, ...inkOn(lv.plastic)); g.restore();
  });
}
/** The rear side panels: a number plate with the logo over the number. */
function sidePlate(lv) {
  return canvasTex(512, 256, (g, w, h) => {
    const bg = lv.accent === '#ffffff' ? lv.plastic : '#ffffff';
    g.fillStyle = lv.plastic; g.fillRect(0, 0, w, h);
    g.fillStyle = bg; roundRect(g, w * 0.17, h * 0.2, w * 0.58, h * 0.54, 34); g.fill();
    revvdLogo(g, w * 0.46, h * 0.36, h * 0.13, ...inkOn(bg), true);
    g.fillStyle = lv.accent === '#ffffff' ? '#ffffff' : lv.dark;
    g.font = `italic 900 ${h * 0.34}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(String(lv.number), w * 0.46, h * 0.68);
  });
}
/** A copy of a panel material whose picture is placed by u = x * a + b, v = y * c + d (x, y in metres on the panel). */
function placed(mat, a, b, c = 1, d = 0) {
  const m = mat.clone(); m.map = mat.map.clone(); m.map.repeat.set(a, c); m.map.offset.set(b, d); m.map.needsUpdate = true;
  return m;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// ------------------------------------------------------------------ Revvd branding
const REVVD_HOT = '#ff7a1a';
const lum = (c) => { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** [letters, outline] that stand out on a background colour. */
const inkOn = (bg) => (lum(bg) > 0.55 ? ['#16181c', '#ffffff'] : ['#ffffff', '#16181c']);
/** The Revvd wordmark: italic REVVD (the two Vs in Revvd orange) over a slanted orange speed bar, outlined so it reads
    on any paint. (x, y) is the left end of the baseline (its middle when center); h is the font size. Returns its width. */
function revvdLogo(g, x, y, h, ink = '#ffffff', edge = '#16181c', center = false) {
  g.save();
  g.font = `italic 900 ${h}px Kanit, Arial Black, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const bits = [['RE', ink], ['VV', REVVD_HOT], ['D', ink]];
  const w = bits.reduce((s, [t]) => s + g.measureText(t).width, 0);
  if (center) x -= w / 2;
  g.lineJoin = 'round'; g.lineWidth = h * 0.1; g.strokeStyle = edge;
  const bar = () => { g.beginPath(); g.moveTo(x + h * 0.02, y + h * 0.06); g.lineTo(x + w + h * 0.08, y + h * 0.06); g.lineTo(x + w - h * 0.02, y + h * 0.19); g.lineTo(x - h * 0.08, y + h * 0.19); g.closePath(); };
  bar(); g.stroke(); g.fillStyle = REVVD_HOT; g.fill();
  let cx = x; for (const [t] of bits) { g.strokeText(t, cx, y); cx += g.measureText(t).width; }
  cx = x; for (const [t, c] of bits) { g.fillStyle = c; g.fillText(t, cx, y); cx += g.measureText(t).width; }
  g.restore();
  return w;
}
/** A see-through sticker: just the logo (for the model-file bikes and the rider's jacket). */
let stickerMat = null;
function revvdSticker() {
  if (!stickerMat) {
    stickerMat = new THREE.MeshStandardMaterial({ map: canvasTex(512, 176, (g, w, h) => revvdLogo(g, w / 2, h * 0.68, h * 0.62, '#ffffff', '#16181c', true)),
      transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.45 });
  }
  return stickerMat;
}
/** The back patch on the Mystery Biker's jacket: a team badge. */
let patchMat = null;
function revvdPatch() {
  if (!patchMat) {
    patchMat = new THREE.MeshStandardMaterial({ roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = REVVD_HOT; roundRect(g, 0, 0, w, h, 46); g.fill();
      g.fillStyle = '#16181c'; roundRect(g, 10, 10, w - 20, h - 20, 38); g.fill();
      revvdLogo(g, w / 2, h * 0.52, h * 0.27, '#ffffff', '#16181c', true);
      g.fillStyle = '#ffffff'; g.font = `italic 800 ${h * 0.085}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center';
      g.fillText('FACTORY  RACING', w / 2, h * 0.78);
      g.fillStyle = REVVD_HOT; g.fillText('★  ★  ★', w / 2, h * 0.27);
    }) });
  }
  return patchMat;
}
/** The rider's helmet shell: its colour with the logo on each side (a sphere's texture wraps round it: the
    rider's right side is a quarter of the way across, the left three quarters; both sit a little to the back). */
function helmetTex(lv) {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = lv.helmet; g.fillRect(0, 0, w, h);
    for (const u of [0.14, 0.86]) revvdLogo(g, w * u, h * 0.6, h * 0.085, ...inkOn(lv.helmet), true);
  });
}
/** The jersey: the logo on the chest, and REVVD over the rider's number on the back. */
function crestTex(lv) {
  return canvasTex(256, 128, (g, w, h) => revvdLogo(g, w / 2, h * 0.66, h * 0.5, ...inkOn(lv.jersey2), true));
}
function backTex(lv) {
  return canvasTex(384, 256, (g, w, h) => {
    const [ink, edge] = inkOn(lv.jersey);
    revvdLogo(g, w / 2, h * 0.27, h * 0.24, ink, edge, true);
    g.font = `italic 900 ${h * 0.62}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.lineJoin = 'round'; g.lineWidth = h * 0.05; g.strokeStyle = edge; g.strokeText(String(lv.number), w / 2, h * 0.9);
    g.fillStyle = ink; g.fillText(String(lv.number), w / 2, h * 0.9);
  });
}

function numberPlate(lv) {
  return canvasTex(256, 256, (g, w, h) => {
    const bg = lv.accent === '#ffffff' ? lv.plastic : '#ffffff';
    g.fillStyle = bg; roundRect(g, 0, 0, w, h, 40); g.fill();
    revvdLogo(g, w / 2, h * 0.24, h * 0.17, ...inkOn(bg), true);
    g.fillStyle = lv.accent === '#ffffff' ? '#ffffff' : lv.dark;
    g.font = `italic 900 ${h * 0.54}px Kanit, Arial Black, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lv.number), w / 2, h * 0.62);
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
  const graphicsR = lv.chrome || lv.metal ? Object.assign(plastic.clone(), { color: new THREE.Color('#ffffff'), map: gfx }) : paint('#ffffff', { map: gfx });
  // the side panels: the right side reads front to back as x grows, the left side (seen from the other way) mirrored
  const side = paint('#ffffff', { map: sidePlate(lv) });
  return {
    plastic,
    graphics: graphicsR,
    graphicsL: placed(graphicsR, -1, 0.48),
    sideR: placed(side, 1 / 0.6, 0.86 / 0.6, 1 / 0.25, -0.2 / 0.25),
    sideL: placed(side, -1 / 0.6, -0.26 / 0.6, 1 / 0.25, -0.2 / 0.25),
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
    helmetLogo: paint('#ffffff', { map: helmetTex(lv) }),
    crest: std('#ffffff', { map: crestTex(lv), transparent: true, alphaTest: 0.3, roughness: 0.82 }),
    back: std('#ffffff', { map: backTex(lv), transparent: true, alphaTest: 0.3, roughness: 0.82 }),
    lens: new THREE.MeshPhysicalMaterial({ color: lv.lens || '#ffb02e', metalness: 1, roughness: 0.05, iridescence: 1 }),
    glow: new THREE.MeshStandardMaterial({ color: lv.plastic, emissive: lv.plastic, emissiveIntensity: 1.6 }),
    light: new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff1c2', emissiveIntensity: 1.3 }),
    tail: std('#ff2a2a', { emissive: '#ff1a1a', emissiveIntensity: 0.9 }),
    cable: std('#ff7a1a', { roughness: 0.5 }),
    leather: std('#4a2f1e', { roughness: 0.7 }),
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

// ------------------------------------------------------------------ model-file bikes
const AXLE_F = V(0.8, -0.24); const AXLE_R = V(-0.68, -0.26);   // the axles with the bike sitting on its suspension
const fitted = {}; const loading = {}; let modelsReady = 0;
/** Load a model-file bike (if it is one, and not loaded yet). Resolves when it can be built (or failed: then makeBike draws the Factory 450). */
export function preloadBike(id, riderId = 'biker') {
  const f = FILES[id];
  const rider = preloadRider(RIDER_FILES[riderId] ? riderId : 'biker');
  if (!f || fitted[id]) return rider.then(() => true);
  if (!loading[id]) {
    loading[id] = new Promise((resolve) => {
      new GLTFLoader().load(f.file, (g) => { fitted[id] = fit(f, g.scene); modelsReady++; resolve(true); }, undefined, (e) => { console.warn('bike model', id, e); resolve(false); });
    });
  }
  return Promise.all([loading[id], rider]).then(([ok]) => ok);
}
/** How many model-file bikes have loaded (part of a bike's look key, so a stand-in is swapped for the real thing). */
export const bikesLoaded = () => modelsReady;
/** Work out where every part of a model goes on the physics frame: the axles onto the physics axles, the wheels
    resized to the physics wheels and centred on their own axle (so they can spin). */
function fit(f, scene) {
  scene.updateMatrixWorld(true);
  const nameOf = (o) => { for (let p = o; p; p = p.parent) if (p.name && !/^Object_/.test(p.name)) return p.name; return ''; };
  const meshes = []; scene.traverse((o) => { if (o.isMesh) meshes.push({ o, wheel: f.front.test(nameOf(o)) ? 0 : f.rear.test(nameOf(o)) ? 1 : f.crank && f.crank.test(nameOf(o)) ? 2 : -1 }); });
  const M0 = new THREE.Matrix4().set(0, 0, f.dir, 0, 0, 1, 0, 0, -f.dir, 0, 0, 0, 0, 0, 0, 1);   // model → bike axes (forward +X, up +Y)
  const box = [new THREE.Box3(), new THREE.Box3()];
  for (const m of meshes) if (m.wheel === 0 || m.wheel === 1) box[m.wheel].union(new THREE.Box3().setFromObject(m.o));
  const C = box.map((b) => b.getCenter(V(0, 0)).applyMatrix4(M0)); const rad = box.map((b) => (b.max.y - b.min.y) / 2);
  const s = AXLE_F.distanceTo(AXLE_R) / Math.hypot(C[0].x - C[1].x, C[0].y - C[1].y);
  const pitch = Math.atan2(AXLE_F.y - AXLE_R.y, AXLE_F.x - AXLE_R.x) - Math.atan2(C[0].y - C[1].y, C[0].x - C[1].x);
  const F = new THREE.Matrix4().makeTranslation(AXLE_R.x, AXLE_R.y, 0).multiply(new THREE.Matrix4().makeRotationZ(pitch))
    .multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-C[1].x, -C[1].y, -C[1].z)).multiply(M0);
  const pt = ([y, z]) => { const v = new THREE.Vector3(0, y, z).applyMatrix4(F); return V(v.x, v.y); };
  const bb = f.bb ? pt(f.bb) : null;
  const parts = meshes.map(({ o, wheel }) => {
    let mat;
    if (wheel === 2) mat = new THREE.Matrix4().makeTranslation(-bb.x, -bb.y, 0).multiply(F).multiply(o.matrixWorld);   // (the cranks turn round the bottom bracket)
    else if (wheel < 0) mat = F.clone().multiply(o.matrixWorld);
    else {
      const k = [0.35, 0.34][wheel] / rad[wheel];
      mat = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-C[wheel].x, -C[wheel].y, -C[wheel].z)).multiply(M0).multiply(o.matrixWorld);
    }
    return { geometry: o.geometry, material: o.material, matrix: mat, wheel };
  });
  if (bb) {
    const ped = pt(f.pedal).sub(bb);
    return { parts, grips: pt(f.grips), pegs: pt(f.pegs), decals: [], crank: { bb, len: ped.length(), phase: Math.atan2(ped.y, ped.x), saddle: pt(f.saddle) }, rider: f.rider || 1 };
  }
  return { parts, grips: pt(f.grips), pegs: pt(f.pegs), decals: revvdDecals(parts) };
}
/** Revvd stickers for a model-file bike: looked for from each side where the built bikes have their radiator shroud
    and their rear side panel, and pressed onto whatever bodywork is there (so they follow its curves). */
function revvdDecals(parts) {
  const solid = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const body = parts.filter((p) => p.wheel < 0 && p.geometry.attributes.normal).map((p) => {
    const o = new THREE.Mesh(p.geometry, solid); o.matrixAutoUpdate = false; o.matrix.copy(p.matrix); o.matrixWorld.copy(p.matrix);
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    o.userData.box = p.geometry.boundingBox.clone().applyMatrix4(p.matrix);
    return o;
  });
  const ray = new THREE.Raycaster(); const out = [];
  for (const [x, y, size] of [[0.17, 0.34, 0.22], [-0.46, 0.3, 0.24]]) {
    for (const side of [1, -1]) {
      ray.set(V(x, y, side * 2), V(0, 0, -side));
      const hit = ray.intersectObjects(body, false)[0];
      if (!hit || hit.point.z * side < 0.04) continue;
      const dims = V(size, size * 0.36, 0.12);
      const reach = new THREE.Box3().setFromCenterAndSize(hit.point, V(size, size, 0.12));
      const turn = new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0);
      const geos = body.filter((o) => o.userData.box.intersectsBox(reach)).map((o) => new DecalGeometry(o, hit.point, turn, dims)).filter((g) => g.attributes.position.count);
      if (geos.length) out.push(mergeGeometries(geos));
    }
  }
  return out;
}
/** Swap a built bike's own parts for a model file's (the rider, the nitro flame and the moving-part groups stay). */
function dress(m, part, M, ghost) {
  const keep = new Set([m.flame, m.flame2]);
  for (const c of [...m.body.children]) if (!keep.has(c)) m.body.remove(c);
  m.frontWheel.clear(); m.rearWheel.clear();
  m.forkLower.visible = m.swing.visible = m.spring.visible = m.shockBody.visible = m.bars.visible = false;
  m.steers = false;   // (only its front wheel turns: the model's bars are part of its frame)
  if (part.crank) {
    // a bicycle: the cranks turn round the bottom bracket, and the rider is drawn a little bigger to match the bike
    m.crank = new THREE.Group(); m.crank.position.set(part.crank.bb.x, part.crank.bb.y, 0); m.body.add(m.crank);
    m.pedal = { ...part.crank, ang: 0, seat: 0, t: null };
    m.rider.scale.setScalar(part.rider);
  }
  for (const p of part.parts) {
    const o = new THREE.Mesh(p.geometry, ghost ? M.plastic : p.material);
    o.matrixAutoUpdate = false; o.matrix.copy(p.matrix);
    o.castShadow = !ghost; o.receiveShadow = !ghost; o.userData.shared = !ghost;   // (the geometry and materials belong to every bike made from this file)
    if (ghost) o.renderOrder = 2;
    (p.wheel === 0 ? m.frontWheel : p.wheel === 1 ? m.rearWheel : p.wheel === 2 ? m.crank : m.body).add(o);
  }
  if (!ghost) for (const g of part.decals) { const o = new THREE.Mesh(g, revvdSticker()); o.userData.shared = true; m.body.add(o); }
  m.grips = part.grips; m.pegs = part.pegs;
}

// ------------------------------------------------------------------ the model-file rider
// A rigged character (public/models/moto/rider.glb: a Character Creator skeleton in a T-pose, facing the model's +z with
// its left at +x). It has no riding animation: every frame its bones are turned towards the same hips, shoulders,
// elbows, hands, knees and feet the drawn rider uses, so it rides, does every trick and crashes the same way.
/** The rider model files. q: one of Quaternius's characters (its bones are renamed to the Character Creator names the
    posing uses when it loads, and it's given toes); recolor: material name -> colour; winter: a beanie and goggles. */
const RIDER_FILES = {
  biker: { file: '/models/moto/rider.glb' },
  bmx: { file: '/models/riders/bmx.glb', q: true },
  punk: { file: '/models/riders/punk.glb', q: true },
  hoodie: { file: '/models/riders/hoodie.glb', q: true },
  snow: { file: '/models/riders/snowboarder.glb', q: true, winter: true, recolor: { Green: '#ef5a24', LightGreen: '#1f6fd1', Brown: '#26303d', Brown2: '#3a4250', Gold: '#cfd8e3' } },
};
const Q_NAMES = { Hips: 'Hip', Abdomen: 'Waist', Torso: 'Spine01', Chest: 'Spine02', Neck: 'NeckTwist01', Head: 'Head' };
for (const S of ['L', 'R']) {
  Object.assign(Q_NAMES, { [`UpperArm.${S}`]: `${S}_Upperarm`, [`LowerArm.${S}`]: `${S}_Forearm`, [`Wrist.${S}`]: `${S}_Hand`,
    [`UpperLeg.${S}`]: `${S}_Thigh`, [`LowerLeg.${S}`]: `${S}_Calf`, [`Foot.${S}`]: `${S}_Foot` });
  for (const [q, c] of [['Index', 'Index'], ['Middle', 'Mid'], ['Ring', 'Ring'], ['Pinky', 'Pinky']]) for (const i of [1, 2, 3]) Q_NAMES[`${q}${i}.${S}`] = `${S}_${c}${i}`;
}
for (const k of Object.keys(Q_NAMES)) Q_NAMES[k.replace('.', '')] = Q_NAMES[k];   // (three.js drops the dots from node names: Foot.L loads as FootL)
const riderSrcs = {}; const riderLoading = {};
const boneName = (o) => o.name.replace(/_\d+$/, '');
// bone -> [the joint it points at ('up': straight up), which way its side faces]: 'z' = the rider's right,
// 'fwd' / 'back' = the way the elbow / knee bends (so they only ever bend the right way)
const AIMS = {
  CC_Base_Hip: ['CC_Base_Waist', 'z'], CC_Base_Waist: ['CC_Base_Spine01', 'z'], CC_Base_Spine01: ['CC_Base_Spine02', 'z'],
  CC_Base_Spine02: ['CC_Base_NeckTwist01', 'z'], CC_Base_NeckTwist01: ['CC_Base_Head', 'z'], CC_Base_Head: ['up', 'z'],
};
for (const S of ['L', 'R']) {
  Object.assign(AIMS, {
    [`CC_Base_${S}_Upperarm`]: [`CC_Base_${S}_Forearm`, 'fwd'], [`CC_Base_${S}_Forearm`]: [`CC_Base_${S}_Hand`, 'fwd'],
    [`CC_Base_${S}_Thigh`]: [`CC_Base_${S}_Calf`, 'back'], [`CC_Base_${S}_Calf`]: [`CC_Base_${S}_Foot`, 'back'],
    [`CC_Base_${S}_Foot`]: [`CC_Base_${S}_ToeBase`, 'z'],
    [`CC_Base_${S}_Hand`]: [`CC_Base_${S}_Mid1`, 'palm'],   // (its side: the palm, the way the fingers curl; down in the T-pose)
  });
}
const AX = V(1, 0, 0); const AZ = V(0, 0, 1);
const cP = new THREE.Vector3(); const cQ = new THREE.Quaternion(); const cQ2 = new THREE.Quaternion(); const cM = new THREE.Matrix4();
const aX = new THREE.Vector3(); const aY = new THREE.Vector3(); const aZ = new THREE.Vector3();
/** A bone's position and turn in the rider group's space (top), found by walking up its parents; returns its overall scale. */
function chain(b, top, outP, outQ) {
  outP.set(0, 0, 0); outQ.identity(); let k = 1;
  for (let x = b; x && x !== top; x = x.parent) { outP.multiply(x.scale).applyQuaternion(x.quaternion).add(x.position); outQ.premultiply(x.quaternion); k *= x.scale.x; }
  return k;
}
/** The turn that takes the x axis to dir and the z axis (as near as it can) to side. */
function basisQ(dir, side, out) {
  aX.copy(dir).normalize();
  aZ.copy(side).addScaledVector(aX, -side.dot(aX)).normalize();
  aY.crossVectors(aZ, aX);
  return out.setFromRotationMatrix(cM.makeBasis(aX, aY, aZ));
}
/** Load a rider model (once). Resolves when it can be used (or failed: then riders are drawn as the MX Racer). */
export function preloadRider(id = 'biker') {
  const f = RIDER_FILES[id] || RIDER_FILES.biker;
  if (!riderLoading[id]) {
    riderLoading[id] = new Promise((resolve) => {
      new GLTFLoader().load(f.file, (g) => { riderSrcs[id] = prepRider(g.scene, f); modelsReady++; resolve(true); }, undefined, (e) => { console.warn('rider model', id, e); resolve(false); });
    });
  }
  return riderLoading[id];
}
/** Measure the T-pose: the size that gives the drawn rider's leg length, how each aimed bone sits against its
    own aim, the arm and leg lengths, and how to curl the fingers round the grips. */
function prepRider(scene, spec = {}) {
  // (an animation rig's file stands in a frame of its idle, lopsided: measure it in its own neat T-pose instead)
  if (spec.q) { scene.updateMatrixWorld(true); scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); }); }
  const top = new THREE.Group(); const root = new THREE.Group(); root.rotation.y = Math.PI / 2; top.add(root); root.add(scene);
  if (spec.q) scene.traverse((o) => { if (o.isBone && Q_NAMES[o.name]) o.name = 'CC_Base_' + Q_NAMES[o.name]; });
  if (spec.recolor) scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (spec.recolor[m.name]) m.color.set(spec.recolor[m.name]); });
  const bones = {}; scene.traverse((o) => { if (o.isBone) bones[boneName(o)] = o; });
  if (spec.q) {
    // (an animation rig: its thighs hang off the body and its feet off the root, as handles. Hang them where they go,
    // thighs off the hips and feet off the shins, keeping the T-pose: the skin follows the bones wherever they are)
    top.updateMatrixWorld(true);
    for (const S of ['L', 'R']) { bones.CC_Base_Hip.attach(bones[`CC_Base_${S}_Thigh`]); bones[`CC_Base_${S}_Calf`].attach(bones[`CC_Base_${S}_Foot`]); }
    // (and the hips carry the "body" bone they hung from, with the bit of shirt it moves, instead of it staying put)
    const body = bones.CC_Base_Hip.parent;
    if (body && body.isBone && body.parent) { body.parent.attach(bones.CC_Base_Hip); bones.CC_Base_Hip.attach(body); }
  }
  const at = (n) => { chain(bones[n], top, cP, cQ); return cP.clone(); };
  const legOf = () => at('CC_Base_L_Thigh').distanceTo(at('CC_Base_L_Calf')) + at('CC_Base_L_Calf').distanceTo(at('CC_Base_L_Foot'));
  const k = 0.88 / legOf(); root.scale.setScalar(k);
  const madeToes = !bones.CC_Base_L_ToeBase;
  if (madeToes) {
    // (no toes: one a foot's length ahead of each ankle, down on the sole, so the feet know which way they point and
    // stand on the pedals and pegs rather than above them)
    top.updateMatrixWorld(true);
    const sole = new THREE.Box3().setFromObject(top).min.y;
    for (const S of ['L', 'R']) {
      const foot = bones[`CC_Base_${S}_Foot`]; const toe = new THREE.Bone(); toe.name = `CC_Base_${S}_ToeBase`; const ankle = at(`CC_Base_${S}_Foot`);
      foot.add(toe); toe.position.copy(foot.worldToLocal(ankle.add(V(0.13, Math.min(-0.01, sole - ankle.y), 0)))); bones[toe.name] = toe;
    }
  }
  // which way each palm faces, from its fingers (models come in different poses: arms out with the palms down, or
  // hanging with the palms in): a left hand's palm is the fingers' direction crossed with pinky-to-index, a right's the
  // other way (and every model's finger bones are named for the side they're on)
  const palms = {};
  for (const S of ['L', 'R']) {
    const fingers = at(`CC_Base_${S}_Mid2`).sub(at(`CC_Base_${S}_Mid1`)).normalize(); const across = at(`CC_Base_${S}_Index2`).sub(at(`CC_Base_${S}_Pinky2`)).normalize();
    palms[S] = new THREE.Vector3().crossVectors(fingers, across).normalize().multiplyScalar(S === 'L' ? 1 : -1);
  }
  const rest = {};
  for (const [n, [to, side]] of Object.entries(AIMS)) {
    const p = at(n); chain(bones[n], top, cP, cQ); const q = cQ.clone();
    const dir = to === 'up' ? UP.clone() : at(to).sub(p).normalize();
    const sd = side === 'z' ? AZ.clone() : side === 'palm' ? palms[n.includes('_L_') ? 'L' : 'R'].clone() : new THREE.Vector3().crossVectors(dir, side === 'fwd' ? AX : V(-1, 0, 0)).normalize();
    rest[n] = { q, off: basisQ(dir, sd, new THREE.Quaternion()).invert().multiply(q) };
  }
  const len = (a, b) => at(a).distanceTo(at(b));
  const limbs = {};
  for (const [S, i] of [['L', 0], ['R', 1]]) {
    limbs[`arm${i}`] = { a: `CC_Base_${S}_Upperarm`, b: `CC_Base_${S}_Forearm`, l1: len(`CC_Base_${S}_Upperarm`, `CC_Base_${S}_Forearm`), l2: len(`CC_Base_${S}_Forearm`, `CC_Base_${S}_Hand`) + 0.5 * len(`CC_Base_${S}_Hand`, `CC_Base_${S}_Mid1`),
      wrist: len(`CC_Base_${S}_Forearm`, `CC_Base_${S}_Hand`), palm: Math.max(len(`CC_Base_${S}_Hand`, `CC_Base_${S}_Mid1`), 0.6 * len(`CC_Base_${S}_Hand`, `CC_Base_${S}_Mid2`)) };   // (palm: wrist to knuckles)
    limbs[`leg${i}`] = { a: `CC_Base_${S}_Thigh`, b: `CC_Base_${S}_Calf`, l1: len(`CC_Base_${S}_Thigh`, `CC_Base_${S}_Calf`), l2: len(`CC_Base_${S}_Calf`, `CC_Base_${S}_Foot`) };
  }
  // fingers curl towards the palm. (Where a model's first finger bones start at the wrist, they're the bones of the
  // hand itself: those hardly bend, the next two do)
  const curls = [];
  const meta = len('CC_Base_L_Hand', 'CC_Base_L_Mid1') < 0.5 * len('CC_Base_L_Mid1', 'CC_Base_L_Mid2');
  for (const [n, b] of Object.entries(bones)) {
    const f = /^CC_Base_([LR])_(Index|Mid|Ring|Pinky)([123])$/.exec(n); const kid = b.children.find((c) => c.isBone);
    if (!f || !kid) continue;
    const p = at(n); chain(b, top, cP, cQ); const q = cQ.clone();
    const dir = at(boneName(kid)).sub(p).normalize();
    const axis = new THREE.Vector3().crossVectors(dir, palms[f[1]]).normalize().applyQuaternion(q.invert());
    curls.push({ n, axis, ang: (meta ? [0.08, 1.15, 1.0] : [0.85, 1.0, 0.6])[f[3] - 1] });
  }
  const ankle = at('CC_Base_L_Foot'); const ball = at('CC_Base_L_ToeBase');
  const dims = { torso: at('CC_Base_L_Upperarm').y - at('CC_Base_Hip').y, arm: limbs.arm0.l1 + limbs.arm0.l2, foot: [ankle.x - ball.x, ankle.y - ball.y + (madeToes ? 0.012 : 0.03)] };   // (+ half the pedal or peg: the sole sits on top)
  // a Revvd team patch on the jacket's back: placed on it here in the T-pose, then carried by the upper spine
  top.updateMatrixWorld(true);
  const skins = []; scene.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  const hit = new THREE.Raycaster(V(-2, at('CC_Base_Spine02').y + 0.04, 0), V(1, 0, 0)).intersectObjects(skins, false)[0];
  let patch = null; let winter = null;
  if (hit && !spec.q) {
    patch = new THREE.PlaneGeometry(0.27, 0.27).rotateY(-Math.PI / 2).translate(hit.point.x - 0.014, hit.point.y + 0.012, 0)
      .applyMatrix4(bones.CC_Base_Spine02.matrixWorld.clone().invert());
  }
  if (spec.winter) winter = winterGear(scene, bones.CC_Base_Head, top);
  root.remove(scene);
  return { scene, k, rest, limbs, curls, dims, patch, winter };
}
/** A beanie (with a bobble) over the hair and goggles over the eyes, made to fit this head in the T-pose and carried by
    the head bone (geometries in its own space). */
const WINTER = {};   // (the beanie's and goggles' materials, shared by every snowboarder)
function winterGear(scene, head, top) {
  top.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
  const hair = new THREE.Box3(); const eyes = new THREE.Box3();
  scene.traverse((o) => { if (!o.isMesh) return; const names = [].concat(o.material).map((m) => m.name); if (names.includes('Hair')) hair.expandByObject(o); if (names.includes('Eye')) eyes.expandByObject(o); });
  if (hair.isEmpty()) return null;
  // (round the top of the head: the hair's top, over the head bone; the hair box can include a beard)
  const hp = head.getWorldPosition(V(0, 0)); const size = hair.getSize(V(0, 0)); const inv = head.matrixWorld.clone().invert();
  const r = Math.max(size.z, Math.min(size.x, size.z * 1.2)) * 0.6;
  const c = V(hp.x - r * 0.08, hair.max.y - r * 0.72, hp.z);
  const hat = new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.04, 0.92, 1.04).translate(c.x, c.y, c.z);
  const rim = new THREE.TorusGeometry(r * 1.0, r * 0.17, 8, 28).rotateX(Math.PI / 2).translate(c.x, c.y - r * 0.08, c.z);
  const bob = new THREE.SphereGeometry(r * 0.3, 12, 10).translate(c.x, c.y + r * 0.95, c.z);
  const eyeC = eyes.isEmpty() ? V(c.x + r * 0.7, c.y - r * 0.5, c.z) : eyes.getCenter(V(0, 0));
  const band = new THREE.TorusGeometry(r * 1.02, r * 0.08, 6, 28).rotateX(Math.PI / 2).translate(c.x, Math.min(eyeC.y + r * 0.08, c.y - r * 0.2), c.z);
  const lens = new RoundedBoxGeometry(r * 0.32, r * 0.55, r * 1.5, 2, r * 0.12).translate(eyeC.x + r * 0.18, Math.min(eyeC.y + r * 0.08, c.y - r * 0.2), c.z);
  for (const g of [hat, rim, bob, band, lens]) g.applyMatrix4(inv);
  return { knit: mergeAll([hat, rim]), bob, band, lens };
}
/** Put a copy of the rider model on a built bike in place of the drawn rider. */
function addRider(m, M, ghost, id = 'biker') {
  const src = riderSrcs[id]; const scene = SkeletonUtils.clone(src.scene);
  const root = new THREE.Group(); root.rotation.y = Math.PI / 2; root.scale.setScalar(src.k); root.add(scene);
  const bones = {};
  scene.traverse((o) => {
    if (o.isBone) bones[boneName(o)] = o;
    if (o.isSkinnedMesh) {
      o.frustumCulled = false; o.castShadow = !ghost;
      if (ghost) { o.material = /pants|boots/.test(o.material.name) ? M.pants : M.jersey; o.renderOrder = 2; } else o.userData.shared = true;
    }
  });
  const open = src.curls.map((c) => [bones[c.n], bones[c.n].quaternion.clone()]);   // (open hands: on a snowboard)
  for (const c of src.curls) bones[c.n].quaternion.multiply(cQ.setFromAxisAngle(c.axis, c.ang));
  if (src.patch && !ghost) { const o = new THREE.Mesh(src.patch, revvdPatch()); o.userData.shared = true; bones.CC_Base_Spine02.add(o); }
  if (src.winter) for (const [g, color] of [[src.winter.knit, '#d93a3a'], [src.winter.bob, '#f4f4f4'], [src.winter.band, '#1b1f27'], [src.winter.lens, '#ffb347']]) {
    const mat = ghost ? M.jersey : WINTER[color] || (WINTER[color] = new THREE.MeshStandardMaterial({ color, roughness: color === '#ffb347' ? 0.15 : 0.9, metalness: color === '#ffb347' ? 0.4 : 0, emissive: color === '#ffb347' ? '#5a2a00' : '#000000' }));
    const o = new THREE.Mesh(g, mat); o.userData.shared = true; o.castShadow = !ghost; bones.CC_Base_Head.add(o);
  }
  for (const p of Object.values(m.parts)) for (const o of [].concat(p)) o.visible = false;   // (the arms and legs come in pairs)
  m.rider.add(root);
  m.fig = { top: m.rider, bones, rest: src.rest, limbs: src.limbs, dims: src.dims, hinge: {}, open };
}
/** Turn a bone so it points along dir with its side towards side (both in the rider group's space). */
function aimBone(F, n, dir, side) {
  const b = F.bones[n];
  basisQ(dir, side, cQ2).multiply(F.rest[n].off);
  chain(b.parent, F.top, cP, cQ);
  b.quaternion.copy(cQ.invert()).multiply(cQ2);
}
const fA = new THREE.Vector3(); const fB = new THREE.Vector3(); const fC = new THREE.Vector3(); const fD = new THREE.Vector3();
/** The rider model's body: hips at hip, the spine towards the shoulders, the neck and head towards head.
    follow: how much the pelvis tips with the spine (riding: a bit; thrown off: all the way). twist: the head turned
    (radians, + towards -z; the shoulders turn a little of it too). */
const twistV = new THREE.Vector3();
const twisted = (a) => twistV.set(Math.sin(a), 0, Math.cos(a));
function figTorso(F, hip, sho, head, follow, twist = 0) {
  const B = F.bones.CC_Base_Hip;
  const k = chain(B.parent, F.top, cP, cQ);
  B.position.copy(hip).sub(cP).applyQuaternion(cQ.invert()).multiplyScalar(1 / k);
  fA.copy(sho).sub(hip).normalize();
  fB.copy(UP).lerp(fA, follow).normalize();
  aimBone(F, 'CC_Base_Hip', fB, AZ);
  aimBone(F, 'CC_Base_Waist', fA, AZ); aimBone(F, 'CC_Base_Spine01', fA, twisted(twist * 0.15)); aimBone(F, 'CC_Base_Spine02', fA, twisted(twist * 0.3));
  chain(F.bones.CC_Base_NeckTwist01, F.top, fB, cQ);
  fB.subVectors(head, fB).normalize();
  aimBone(F, 'CC_Base_NeckTwist01', fB, twisted(twist * 0.6));
  aimBone(F, 'CC_Base_Head', fB.lerp(UP, 1 - follow * 0.6).normalize(), twisted(twist));
}
/** An arm or leg of the rider model: from its real shoulder / hip joint through mid (the elbow / knee) to end. With a
    pole, mid is worked out here (the joint bends towards the pole) from the model's own bone lengths. */
function figLimb(F, key, mid, end, pole, wrist = false) {
  const L = F.limbs[key];
  chain(F.bones[L.a], F.top, fA, cQ);
  if (pole) ik(fA, end, L.l1, wrist ? L.wrist : L.l2, pole, mid);
  fB.subVectors(mid, fA); fC.subVectors(end, mid);
  const n = F.hinge[key] || (F.hinge[key] = new THREE.Vector3(0, 0, 1));
  fD.crossVectors(fB, fC);
  if (fD.lengthSq() > 1e-8) n.copy(fD.normalize());
  aimBone(F, L.a, fB, n); aimBone(F, L.b, fC, n);
}
/** Hand i (0 left, 1 right; z: -1 / 1) holding the grip at grip: the wrist just behind and above it, the hand reaching
    forward over the top with the back of the hand up and a little out, so the curled fingers wrap round under it. */
const gDir = new THREE.Vector3(); const gBack = new THREE.Vector3(); const gWrist = new THREE.Vector3(); const gMid = new THREE.Vector3();
function figGrip(F, i, z, grip, pole) {
  const L = F.limbs[`arm${i}`];
  gDir.set(0.85, -0.3, z * 0.22).normalize(); gBack.set(0.3, 1, z * 0.3).normalize();
  gWrist.copy(grip).addScaledVector(gDir, -L.palm * 0.9).addScaledVector(gBack, 0.03);
  figLimb(F, `arm${i}`, gMid, gWrist, pole, true);
  aimBone(F, i ? 'CC_Base_R_Hand' : 'CC_Base_L_Hand', gDir, gBack.negate());   // (the palm faces down onto the grip)
}
/** Stand a foot flat on its peg (as in the T-pose, in the bike's own frame). */
function figFootFlat(F, i) {
  const n = i ? 'CC_Base_R_Foot' : 'CC_Base_L_Foot';
  chain(F.bones[n].parent, F.top, cP, cQ);
  F.bones[n].quaternion.copy(cQ.invert()).multiply(F.rest[n].q);
}

/** Build a bike + rider. opts: { livery (paint job id), model, kit, helmet, number (0–99), ghost colour (a see-through ghost) }.
    A model-file bike that hasn't loaded yet (see preloadBike) is drawn as the Factory 450 for now. */
export function makeBike(opts = {}) {
  const paintJob = LIVERIES[opts.livery] || LIVERIES.factory;
  const num = Number.isInteger(opts.number) && opts.number >= 0 && opts.number <= 99 ? opts.number : paintJob.number;
  const lv = { ...paintJob, ...(KITS[opts.kit] && KITS[opts.kit].jersey ? KITS[opts.kit] : {}), ...(HELMETS[opts.helmet] && HELMETS[opts.helmet].helmet ? HELMETS[opts.helmet] : {}), name: paintJob.name, number: num };
  const fromFile = FILES[opts.model] ? fitted[opts.model] : null;
  if (FILES[opts.model] && !fromFile) preloadBike(opts.model);
  const MODEL = MODELS[opts.model] && !FILES[opts.model] ? opts.model : 'mx4';
  const two = MODEL === 'mx2'; const enduro = MODEL === 'enduro'; const retro = MODEL === 'retro'; const electric = MODEL === 'electric';
  let tip = { x: -0.99, y: 0.43, z: 0.165, a: Math.PI / 2 - 0.2 };   // where the nitro flame comes out
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
  if (!electric) {
    // engine: cylinder and head tilted forward (a two-stroke's is smaller and finned all the way), crankcase, clutch and ignition covers
    const tilt = two ? -0.18 : -0.32;
    const head = mesh(new RoundedBoxGeometry(two ? 0.15 : 0.17, two ? 0.2 : 0.24, two ? 0.15 : 0.17, 3, 0.03), M.engine, 0.14, two ? 0.06 : 0.08, 0); head.rotation.z = tilt; body.add(head);
    const fins = two || retro ? 8 : 5;
    for (let i = 0; i < fins; i++) { const fin = mesh(new THREE.BoxGeometry(two ? 0.19 : 0.2, 0.008, two ? 0.19 : 0.2), retro ? M.chrome : M.mag, 0.14 + i * (two ? 0.006 : 0.012), (two ? -0.03 : 0) + i * (two ? 0.024 : 0.035), 0); fin.rotation.z = tilt; body.add(fin); }
    body.add(mesh(new RoundedBoxGeometry(0.36, 0.2, 0.24, 3, 0.05), retro ? M.alu : M.engine, -0.01, -0.13, 0));
    const clutch = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 28), retro ? M.chrome : M.mag, -0.02, -0.11, 0.13); clutch.rotation.x = Math.PI / 2; body.add(clutch);
    const ign = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24), retro ? M.chrome : M.mag, 0.06, -0.12, -0.13); ign.rotation.x = Math.PI / 2; body.add(ign);
  } else {
    // a battery pack where the engine would be, with a glowing strip, and the motor by the swingarm
    body.add(mesh(new RoundedBoxGeometry(0.46, 0.36, 0.25, 4, 0.05), M.engine, 0.02, -0.04, 0));
    body.add(mesh(new THREE.BoxGeometry(0.42, 0.025, 0.256), M.glow, 0.02, 0.05, 0));
    const motor = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 28), M.alu, -0.13, -0.15, 0); motor.rotation.x = Math.PI / 2; body.add(motor);
    body.add(mesh(tube([V(0.1, 0.12, 0.13), V(-0.05, 0.05, 0.15), V(-0.13, -0.1, 0.09)], 0.012, 12, 6), M.cable));
    tip = { x: -0.86, y: 0.36, z: 0, a: Math.PI / 2 - 0.12 };
  }
  body.add(mesh(new RoundedBoxGeometry(enduro ? 0.48 : 0.42, enduro ? 0.04 : 0.03, 0.2, 2, 0.01), enduro ? M.alu : M.black, 0.0, -0.25, 0));   // skid plate (a big bash plate on the enduro)
  // radiators behind the shrouds (not on the air-cooled retro or the electric), and the tank
  if (!retro && !electric) for (const z of [-0.13, 0.13]) body.add(mesh(new RoundedBoxGeometry(0.16, 0.24, 0.035, 2, 0.01), M.black, 0.28, 0.22, z));
  if (retro) {
    const tank = mesh(new THREE.SphereGeometry(0.2, 28, 18), M.plastic, 0.12, 0.45, 0); tank.scale.set(1.25, 0.62, 0.72); body.add(tank);
    body.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 18), M.chrome, 0.14, 0.575, 0));
  } else body.add(mesh(new RoundedBoxGeometry(enduro ? 0.4 : 0.34, enduro ? 0.2 : 0.16, enduro ? 0.31 : 0.26, 4, 0.07), electric ? M.dark : M.plastic, 0.12, enduro ? 0.43 : 0.42, 0));
  // exhaust
  if (two) {
    // a two-stroke's fat expansion chamber round the front and under, then a skinny silencer
    body.add(mesh(tube([V(0.18, 0.02, 0.05), V(0.33, -0.08, 0.09), V(0.3, -0.24, 0.14), V(0.08, -0.27, 0.18), V(-0.16, -0.1, 0.19), V(-0.3, 0.12, 0.17)], 0.05, 48, 16), M.pipe));
    const sil = mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.4, 20), M.silencer, -0.5, 0.27, 0.165); sil.rotation.z = Math.PI / 2 - 0.25; body.add(sil);
    tip = { x: -0.7, y: 0.32, z: 0.165, a: Math.PI / 2 - 0.25 };
  } else if (retro) {
    // a chrome high pipe along the side
    body.add(mesh(tube([V(0.22, 0.08, 0.05), V(0.31, 0.02, 0.12), V(0.22, 0.26, 0.2), V(-0.1, 0.36, 0.21), V(-0.46, 0.4, 0.2)], 0.024, 40), M.chrome));
    const sil = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 24), M.chrome, -0.66, 0.415, 0.2); sil.rotation.z = Math.PI / 2 - 0.06; body.add(sil);
    tip = { x: -0.88, y: 0.43, z: 0.2, a: Math.PI / 2 - 0.06 };
  } else if (!electric) {
    // header round the front of the engine, then up to the silencer on the right
    body.add(mesh(tube([V(0.22, 0.06, 0.04), V(0.3, -0.02, 0.07), V(0.24, -0.16, 0.12), V(0.04, -0.12, 0.16), V(-0.18, 0.08, 0.17), V(-0.36, 0.26, 0.16)], 0.022, 40), M.pipe));
    const sil = mesh(new THREE.CylinderGeometry(enduro ? 0.058 : 0.052, 0.048, 0.42, 24), M.silencer, -0.56, 0.33, 0.165); sil.rotation.z = Math.PI / 2 - 0.2; body.add(sil);
    const cap = mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.05, 24), M.carbon, -0.78, 0.38, 0.165); cap.rotation.z = Math.PI / 2 - 0.2; body.add(cap);
  }
  // plastics: shrouds and side panels (oval number plates on the retro), seat, fenders, number plates
  if (!retro) {
    for (const side of [-1, 1]) {
      body.add(mesh(extrudeSide([[0.44, 0.44], [0.2, 0.56, 0.02, 0.5], [-0.06, 0.36], [0.02, 0.16, 0.14, 0.14], [0.38, 0.18], [0.46, 0.3]], 0.012), side > 0 ? M.graphics : M.graphicsL, 0, 0, side * 0.16));
      body.add(mesh(extrudeSide([[-0.26, 0.4], [-0.84, 0.45], [-0.86, 0.34], [-0.6, 0.2, -0.34, 0.2]], 0.012), side > 0 ? M.sideR : M.sideL, 0, 0, side * 0.115));
    }
  } else {
    for (const side of [-1, 1]) { const ov = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 32), M.plate, -0.42, 0.3, side * 0.12); ov.rotation.x = Math.PI / 2; ov.scale.set(1.25, 1, 0.9); body.add(ov); }
  }
  if (retro) body.add(mesh(extrudeSide([[0.04, 0.49], [-0.3, 0.5, -0.82, 0.48], [-0.84, 0.43], [-0.3, 0.43, 0.02, 0.43]], 0.2, 0.03), M.leather, 0, 0, 0));
  else body.add(mesh(extrudeSide([[0.06, 0.5], [-0.3, 0.5, -0.82, 0.46], [-0.84, 0.41], [-0.3, 0.41, 0.0, 0.42]], 0.17, 0.03), M.seat, 0, 0, 0));
  body.add(mesh(extrudeSide([[-0.6, 0.44], [-0.9, 0.47, -1.08, 0.55], [-1.09, 0.52], [-0.9, 0.42, -0.62, 0.39]], 0.15, 0.015), retro ? M.chrome : M.plastic, 0, 0, 0));
  // the front end that steers (bars, triple clamps, fork tubes, number plate) turns on the fork axis through FORK_0
  const bars = new THREE.Group(); bars.position.copy(FORK_0); root.add(bars);
  const toBars = (o) => { o.position.sub(FORK_0); bars.add(o); return o; };
  toBars(mesh(extrudeSide([[0.52, 0.2], [0.78, 0.27, 1.16, 0.16], [1.15, 0.13], [0.8, 0.22, 0.53, 0.16]], 0.13, 0.015), retro ? M.chrome : M.plastic, 0, 0, 0));   // front mudguard
  const plate = mesh(retro ? new THREE.CylinderGeometry(0.13, 0.13, 0.02, 32) : new RoundedBoxGeometry(0.02, 0.24, 0.27, 2, 0.008), M.plate);
  plate.position.copy(onFork(0.86)).add(V(FORK_U.y, -FORK_U.x).multiplyScalar(0.1)); plate.rotation.z = FORK_ANGLE + (retro ? Math.PI / 2 : 0); toBars(plate);
  if (enduro) {
    // a headlight in the front plate, a tail light and a little licence plate
    const lamp = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.03, 24), M.light); lamp.position.copy(onFork(0.82)).add(V(FORK_U.y, -FORK_U.x).multiplyScalar(0.12)); lamp.rotation.z = FORK_ANGLE + Math.PI / 2; toBars(lamp);
    body.add(mesh(new RoundedBoxGeometry(0.04, 0.03, 0.08, 1, 0.01), M.tail, -1.06, 0.53, 0));
    body.add(mesh(new THREE.BoxGeometry(0.01, 0.1, 0.16), M.dark, -1.0, 0.43, 0));
  }
  if (electric) { const led = mesh(new THREE.BoxGeometry(0.025, 0.02, 0.2), M.glow); led.position.copy(onFork(0.74)).add(V(FORK_U.y, -FORK_U.x).multiplyScalar(0.12)); led.rotation.z = FORK_ANGLE; toBars(led); }
  // triple clamps and the fork's outer tubes, on the same axis the physics uses
  for (const t of [0.97, 0.8]) { const cl = mesh(new RoundedBoxGeometry(0.08, 0.035, 0.3, 2, 0.012), M.alu); cl.position.copy(onFork(t)); cl.rotation.z = FORK_ANGLE; toBars(cl); }
  for (const z of [-0.11, 0.11]) {
    const outer = mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.58, 18), M.gold);
    outer.position.copy(onFork(0.71)).setZ(z); outer.rotation.z = FORK_ANGLE; toBars(outer);
  }
  toBars(mesh(tube([V(0.3, 0.73, -0.39), V(0.33, 0.7, -0.2), V(0.38, 0.62, 0), V(0.33, 0.7, 0.2), V(0.3, 0.73, 0.39)], 0.012, 30), M.alu));
  toBars(mesh(new RoundedBoxGeometry(0.05, 0.03, 0.2, 2, 0.01), M.black, 0.38, 0.66, 0));
  for (const z of [-1, 1]) {
    const grip = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.13, 14), M.black, GRIPS.x, GRIPS.y, z * 0.38); grip.rotation.x = Math.PI / 2; toBars(grip);
    const lever = mesh(tube([V(0.31, 0.73, z * 0.3), V(0.37, 0.72, z * 0.34), V(0.4, 0.7, z * 0.42)], 0.006, 8, 6), M.alu); toBars(lever);
    body.add(mesh(new RoundedBoxGeometry(0.06, 0.02, 0.05, 1, 0.006), M.alu, PEGS.x, PEGS.y, z * 0.17));
    if (enduro) toBars(mesh(tube([V(0.29, 0.71, z * 0.22), V(0.4, 0.745, z * 0.3), V(0.43, 0.73, z * 0.38), V(0.33, 0.72, z * 0.44)], 0.022, 16, 8), M.plastic));   // hand guards
  }

  // the moving parts
  const forkLower = new THREE.Group(); root.add(forkLower);   // at the front axle
  for (const z of [-0.11, 0.11]) {
    const inner = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.5, 16), M.chrome); inner.position.copy(FORK_U).multiplyScalar(0.3).setZ(z); inner.quaternion.setFromUnitVectors(UP, FORK_U); forkLower.add(inner);
    if (retro) { const gaiter = mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.2, 14, 1), M.rubber); gaiter.position.copy(FORK_U).multiplyScalar(0.44).setZ(z); gaiter.quaternion.setFromUnitVectors(UP, FORK_U); forkLower.add(gaiter); continue; }   // rubber fork boots
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
  flame.rotation.z = tip.a; flame.position.set(tip.x, tip.y, tip.z); flame.visible = false; body.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.25, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame2.rotation.copy(flame.rotation); flame2.position.set(tip.x + 0.07, tip.y - 0.02, tip.z); flame2.visible = false; body.add(flame2);

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
  const shell = mesh(new THREE.SphereGeometry(0.135, 32, 22), M.helmetLogo); shell.scale.set(1.18, 1.02, 0.94); hel.add(shell);
  const stripe = mesh(new THREE.SphereGeometry(0.137, 32, 22, 0, Math.PI * 2, 0, 0.75), M.helmet2); stripe.scale.set(1.18, 1.02, 0.42); stripe.rotation.z = -0.25; hel.add(stripe);
  // MX helmet: a long chin bar sticking forward, a peak over the eyes, goggles
  const chinBar = mesh(extrudeSide([[0.04, -0.02], [0.2, -0.04, 0.21, -0.12], [0.16, -0.15], [0.06, -0.15, 0.0, -0.12]], 0.15, 0.03), M.helmet2); hel.add(chinBar);
  const peak = mesh(extrudeSide([[0.02, 0.1], [0.16, 0.12, 0.25, 0.06], [0.24, 0.04], [0.12, 0.08, 0.02, 0.07]], 0.19, 0.008), M.helmet2); hel.add(peak);
  const lens = mesh(new RoundedBoxGeometry(0.06, 0.06, 0.2, 2, 0.02), M.lens, 0.135, 0.015, 0); hel.add(lens);
  const strap = mesh(new THREE.TorusGeometry(0.135, 0.011, 6, 36), M.dark); strap.rotation.y = Math.PI / 2; strap.position.y = 0.015; strap.scale.set(1.0, 1.0, 1.2); hel.add(strap);
  R.add(parts.pelvis, parts.torso, parts.chest, parts.neck, hel, ...parts.upperArm, ...parts.foreArm, ...parts.hand, ...parts.thigh, ...parts.shin, ...parts.boot, ...parts.knee);
  hel.traverse((o) => { o.castShadow = true; });
  if (!opts.ghost) {
    // team kit: the logo on the chest, and REVVD over the number across the back (a strip of cylinder hugging the torso)
    const crest = mesh(new THREE.PlaneGeometry(0.19, 0.095), M.crest, 0.102, 0.015, 0); crest.rotation.y = Math.PI / 2; parts.chest.add(crest);
    const back = mesh(new THREE.CylinderGeometry(0.154, 0.154, 0.19, 16, 1, true, Math.PI * 1.5 - 0.85, 1.7), M.back, 0, 0.03, 0); parts.torso.add(back);
  }

  if (opts.ghost) root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 2; } });
  const m = { root, body, bars, steers: true, forkLower, frontWheel, rearWheel, swing, spring, shockBody, flame, flame2, rider: R, parts, livery: lv, ghost: !!opts.ghost, materials: M, grips: GRIPS, pegs: PEGS };
  if (fromFile) dress(m, fromFile, M, opts.ghost);
  const fileRider = RIDER_FILES[opts.rider] ? opts.rider : !RIDERS[opts.rider] ? 'biker' : null;   // (the MX Racer is drawn)
  if (fileRider) { if (riderSrcs[fileRider]) addRider(m, M, opts.ghost, fileRider); else preloadRider(fileRider); }
  return m;
}

/** The rider's air tricks (same order as MotoCore.TRICKS): how far the hips move and the body tips, and where the
    hands ([forward, up from the shoulders, out]) and feet go: `feet` = both (z mirrored), `foot` = just the left one. */
const TRICK_POSES = [
  { hip: [-0.3, 0.2], lean: 0.75, feet: [-1.05, 0.5, 0.18] },                    // Superman: legs straight out behind
  { hip: [0, 0.05], lean: -0.25, hand: [-0.05, 0.3, 0.55] },                    // No-Hander: arms out wide
  { hip: [0.02, 0.06], lean: 0, foot: [0.32, 0.12, 0.42] },                      // Can-Can: one leg over to the other side
  { hip: [-0.05, 0.1], lean: 0.1, foot: [-0.8, 0.55, 0.42] },                    // Nac-Nac: one leg back over the seat
  { hip: [-0.12, 0.12], lean: -0.45, feet: [0.62, 0.78, 0.06] },                 // Heel Clicker: feet up over the bars
  { hip: [0.14, 0.34], lean: 0.35, feet: [-0.55, 1.2, 0.14] },                  // Cliffhanger: up over the bars, legs kicked up behind
];
const FORK_AXIS = V(FORK_U.x, FORK_U.y, 0).normalize(); const Z_AXIS = V(0, 0, 1);
const qSteer = new THREE.Quaternion(); const qSpin = new THREE.Quaternion();
const qLean = new THREE.Quaternion(); const qUp = new THREE.Quaternion(); const eUp = new THREE.Euler(); const vLean = new THREE.Vector3(); const vLean2 = new THREE.Vector3();
const tA = new THREE.Vector3(); const tB = new THREE.Vector3(); const tC = new THREE.Vector3(); const tD = new THREE.Vector3();
const hipC = new THREE.Vector3(); const sho = new THREE.Vector3(); const headP = new THREE.Vector3();
const poleArm = [V(-0.55, -0.5, -0.65), V(-0.55, -0.5, 0.65)];
const poleLeg = [V(1, 0.15, -0.35), V(1, 0.15, 0.35)];

/** Move a bike to a physics snapshot. s: { x, y, a, roll, wf: [x, y, ang], wr: [...], rx, ry, lean, boost, crashed, ragdoll: { hip, head } | null }
    (positions in the side-on plane), place(x, y, out) turns a plane point into world space (its lane is built in),
    heading: the track's direction there. */
const grips = V(0, 0); const pegs = [V(0, 0), V(0, 0)];
/** Turn a mountain bike model into a snowboard: the bike is hidden, a board goes under the rider's feet, and the rider
    stands sideways on it (the rider group turned a quarter turn, so their feet are along the board and their arms
    out for balance), a little lower than on a bike. Call poseBoard after poseBike each frame. */
export function boardify(m, color = '#2a7fff', gear = 'board') {
  for (const c of m.root.children) if (c !== m.rider) c.visible = false;
  if (gear === 'skis') return skify(m, color);
  const top = new THREE.Color(color);
  const geo = new RoundedBoxGeometry(1.5, 0.035, 0.3, 3, 0.012);
  // (turned-up tips: the ends of the board lifted)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const e = Math.max(0, Math.abs(x) - 0.55); pos.setY(i, pos.getY(i) + e * e * 0.9); }
  geo.computeVertexNormals();
  const mat = m.ghost ? m.materials.plastic : new THREE.MeshStandardMaterial({ color: top, roughness: 0.35, metalness: 0.15 });
  const board = new THREE.Mesh(geo, mat); board.castShadow = !m.ghost;
  for (const x of [-0.24, 0.24]) {   // (the bindings)
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.06, 0.24, 2, 0.02), m.ghost ? mat : new THREE.MeshStandardMaterial({ color: '#1b1f27', roughness: 0.6 }));
    b.position.set(x, 0.04, 0); board.add(b);
  }
  m.root.add(board);
  m.board = board; m.pedal = null; m.stance = 0.26; m.steers = false;
  m.rider.rotation.y = -Math.PI / 2; m.rider.position.y = -0.3;
  if (m.fig) for (const [b, q] of m.fig.open) b.quaternion.copy(q);   // (nothing to grip: hands open)
  m.pegs = new THREE.Vector3(0, 0, 0); m.grips = new THREE.Vector3(0.18, 0.45, 0);
  return m;
}
/** A jet ski instead of a bike (Wavvd): a deep-V hull (white below, glossy paint on top, a rubber rail round the
    edge), the seat, the hood and handlebars, footwells, a swim platform and the jet nozzle at the back. The rider
    stands up on it, knees bent, as you do over waves. Built along the bike's own frame (x forward, y up), its hull
    sitting in the water where the wheels would touch the ground. */
export function jetskify(m, color = '#18b6d6') {
  for (const c of m.root.children) if (c !== m.rider) c.visible = false;
  const ghost = m.ghost;
  const paint = ghost ? m.materials.plastic : new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const white = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: '#f3f5f7', roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
  const black = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.55, side: THREE.DoubleSide });
  const grey = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.8 });
  const chrome = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.2, metalness: 0.9 });
  const ski = new THREE.Group(); ski.name = 'jetski';
  // the hull: cross-sections from the stern (-1.45) to the bow (1.62): [x, half-width, keel y, chine y, rail y, deck y]
  const ST = [[-1.45, 0.52, -0.5, -0.47, -0.2, -0.12], [-1.1, 0.56, -0.56, -0.48, -0.18, -0.08], [-0.4, 0.58, -0.62, -0.5, -0.16, -0.05], [0.3, 0.56, -0.62, -0.49, -0.14, 0.02],
    [0.9, 0.46, -0.57, -0.44, -0.1, 0.1], [1.3, 0.32, -0.46, -0.36, -0.05, 0.06], [1.55, 0.14, -0.3, -0.24, 0.0, 0.03], [1.64, 0.02, -0.12, -0.1, 0.01, 0.02]];
  const loft = (prof, mat) => {
    const pos = [], idx = [];
    for (const st of ST) for (const [px, py] of prof(st)) pos.push(st[0], py, px);
    const n = prof(ST[0]).length;
    for (let i = 0; i < ST.length - 1; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const o = new THREE.Mesh(g, mat); o.castShadow = !ghost; o.receiveShadow = true; ski.add(o); return o;
  };
  const side = (k) => ([x, w, keel, chine, rail]) => [[0, keel], [w * 0.55 * k, chine - 0.02], [w * 0.92 * k, chine + 0.05], [w * k, (chine + rail) / 2], [w * k, rail]];
  loft(side(1), white); loft((st) => side(-1)(st).reverse(), white);   // (the hull, both sides of the keel)
  loft(([x, w, , , rail, deck]) => [[-w, rail], [-w * 0.93, rail + 0.06], [-w * 0.6, deck - 0.01], [0, deck + 0.02], [w * 0.6, deck - 0.01], [w * 0.93, rail + 0.06], [w, rail]], paint);   // (the deck)
  loft(([x, w, , , rail]) => [[-w - 0.03, rail - 0.03], [-w - 0.03, rail + 0.04], [-w + 0.01, rail + 0.05]], black);   // (the rubber rail)
  loft(([x, w, , , rail]) => [[w - 0.01, rail + 0.05], [w + 0.03, rail + 0.04], [w + 0.03, rail - 0.03]], black);
  const add = (geo, mat, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = !ghost; ski.add(o); return o; };
  add(new RoundedBoxGeometry(1.0, 0.16, 0.44, 3, 0.07), black, -0.62, 0.06, 0);                                   // the seat
  add(new RoundedBoxGeometry(0.86, 0.3, 0.78, 3, 0.12), paint, 0.62, 0.14, 0, -0.18);                            // the hood
  add(new RoundedBoxGeometry(0.3, 0.32, 0.36, 2, 0.08), paint, 0.3, 0.3, 0, 0.35);                               // the steering column
  for (const k of [-1, 1]) add(new RoundedBoxGeometry(0.95, 0.04, 0.2, 2, 0.015), grey, -0.25, -0.07, k * 0.33);   // footwells
  add(new RoundedBoxGeometry(0.34, 0.06, 0.86, 2, 0.02), grey, -1.5, -0.2, 0);                                    // the swim platform
  const nozzle = add(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 14), black, -1.5, -0.38, 0, Math.PI / 2);
  const bar = add(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 10), chrome, 0.34, 0.47, 0); bar.rotation.x = Math.PI / 2;   // the handlebar
  for (const k of [-1, 1]) {
    const grip = add(new THREE.CylinderGeometry(0.036, 0.036, 0.13, 12), black, 0.34, 0.47, k * 0.33); grip.rotation.x = Math.PI / 2;
    add(new RoundedBoxGeometry(0.03, 0.08, 0.13, 2, 0.01), chrome, 0.7, 0.34, k * 0.36);                          // mirrors
  }
  for (const k of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.012, 0.05), white, 0.62, 0.27, k * 0.22, -0.18);       // a white stripe on the hood
  m.root.add(ski);
  m.jetski = ski; m.nozzle = nozzle; m.pedal = null; m.steers = false; m.stance = 0.33;
  m.grips = new THREE.Vector3(0.34, 0.47, 0); m.pegs = new THREE.Vector3(-0.3, -0.04, 0);
  return m;
}
/** A skateboard instead of a bike (Grindvvd): a maple deck with kicked-up nose and tail, black grip tape, two trucks
    and four wheels; the rider stands across it like a snowboarder. m.board is the deck (posed like a board). */
export function skateify(m, color = '#ff4fa3') {
  for (const c of m.root.children) if (c !== m.rider) c.visible = false;
  const ghost = m.ghost;
  const wood = ghost ? m.materials.plastic : new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const grip = ghost ? wood : new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.95 });
  const metal = ghost ? wood : new THREE.MeshStandardMaterial({ color: '#c3c9d1', roughness: 0.3, metalness: 0.9 });
  const urethane = ghost ? wood : new THREE.MeshStandardMaterial({ color: '#f4efe2', roughness: 0.55 });
  const deck = new THREE.Group();
  const kick = (geo, lift) => { const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const e = Math.max(0, Math.abs(x) - 0.3); pos.setY(i, pos.getY(i) + e * e * lift); } geo.computeVertexNormals(); return geo; };
  const ply = new THREE.Mesh(kick(new RoundedBoxGeometry(0.82, 0.018, 0.21, 3, 0.008), 1.6), wood); ply.castShadow = !ghost; deck.add(ply);
  const tape = new THREE.Mesh(kick(new RoundedBoxGeometry(0.8, 0.004, 0.2, 2, 0.002), 1.6), grip); tape.position.y = 0.011; deck.add(tape);
  for (const x of [-0.24, 0.24]) {
    const truck = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.035, 0.16, 2, 0.01), metal); truck.position.set(x, -0.03, 0); deck.add(truck);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6).rotateX(Math.PI / 2), metal); axle.position.set(x, -0.05, 0); deck.add(axle);
    for (const z of [-0.09, 0.09]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 14).rotateX(Math.PI / 2), urethane); w.position.set(x, -0.05, z); w.castShadow = !ghost; deck.add(w); }
  }
  deck.scale.setScalar(1.25);   // (a touch bigger than life, so it reads from the chase camera)
  m.root.add(deck);
  m.board = deck; m.skate = true; m.pedal = null; m.stance = 0.2; m.steers = false;
  m.rider.rotation.y = -Math.PI / 2; m.rider.position.y = -0.3;
  if (m.fig) for (const [b, q] of m.fig.open) b.quaternion.copy(q);   // (nothing to hold: hands open)
  m.pegs = new THREE.Vector3(0, 0, 0); m.grips = new THREE.Vector3(0.18, 0.45, 0);
  return m;
}
/** A snowmobile instead of a bike (Sledvvd): a sculpted cowl over the engine with a windscreen and headlight, a long
    seat, running boards, two steering skis out front and the rubber track (with its bogie wheels) underneath. The
    rider sits up on it, feet on the boards, like the jet ski. Built along the bike's frame (x forward, y up). */
export function sledify(m, color = '#ff5a1f') {
  for (const c of m.root.children) if (c !== m.rider) c.visible = false;
  const ghost = m.ghost;
  const paint = ghost ? m.materials.plastic : new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
  const black = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.6 });
  const grey = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#41464f', roughness: 0.75, metalness: 0.2 });
  const chrome = ghost ? paint : new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.25, metalness: 0.9 });
  const sled = new THREE.Group(); sled.name = 'sled';
  const add = (geo, mat, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = !ghost; sled.add(o); return o; };
  // the cowl: a side profile (nose low at the front, up to the windscreen), extruded across and rounded off
  const prof = new THREE.Shape(); prof.moveTo(1.28, -0.22); prof.bezierCurveTo(1.25, 0.02, 0.9, 0.2, 0.42, 0.3); prof.lineTo(0.12, 0.26); prof.lineTo(0.05, -0.05); prof.lineTo(1.0, -0.3); prof.closePath();
  const cowl = new THREE.ExtrudeGeometry(prof, { depth: 0.66, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 4, curveSegments: 16 }).translate(0, 0, -0.33);
  add(cowl, paint, 0, 0, 0);
  add(new RoundedBoxGeometry(1.25, 0.16, 0.86, 3, 0.05), paint, -0.42, -0.2, 0);                                // the tunnel over the track
  add(new RoundedBoxGeometry(1.15, 0.17, 0.4, 3, 0.07), black, -0.5, -0.03, 0);                                 // the seat
  for (const k of [-1, 1]) add(new RoundedBoxGeometry(1.0, 0.03, 0.2, 2, 0.01), grey, -0.35, -0.27, k * 0.5);   // running boards
  const glass = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: '#2a3542', roughness: 0.05, transparent: true, opacity: 0.55 });
  add(new RoundedBoxGeometry(0.04, 0.3, 0.62, 2, 0.015), glass, 0.36, 0.42, 0, -0.5);                           // windscreen
  add(new THREE.CircleGeometry(0.09, 16).rotateY(Math.PI / 2), ghost ? paint : new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff2c0', emissiveIntensity: 1.6 }), 1.22, -0.02, 0, -0.35);   // headlight
  const bar = add(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 10), chrome, 0.22, 0.42, 0); bar.rotation.x = Math.PI / 2;
  for (const k of [-1, 1]) { const g = add(new THREE.CylinderGeometry(0.034, 0.034, 0.13, 12), black, 0.22, 0.42, k * 0.34); g.rotation.x = Math.PI / 2; }
  // the track: a belt with lugs, and the bogie wheels inside it
  add(new RoundedBoxGeometry(1.45, 0.24, 0.46, 3, 0.1), black, -0.45, -0.42, 0);
  for (let x = -1.1; x <= 0.2; x += 0.13) add(new THREE.BoxGeometry(0.04, 0.03, 0.46), grey, x, -0.555, 0);
  for (const x of [-1.05, -0.6, -0.15]) for (const k of [-1, 1]) { const w = add(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), grey, x, -0.42, k * 0.25); w.rotation.x = Math.PI / 2; }
  // the skis on their legs (the front of the sled rides on them)
  for (const k of [-1, 1]) {
    const geo = new RoundedBoxGeometry(1.0, 0.03, 0.12, 2, 0.01); const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const e = Math.max(0, x - 0.3); pos.setY(i, pos.getY(i) + e * e * 0.9); }
    geo.computeVertexNormals();
    add(geo, black, 0.85, -0.54, k * 0.5);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), grey, 0.82, -0.38, k * 0.47);
    add(new RoundedBoxGeometry(0.4, 0.04, 0.05, 2, 0.01), grey, 0.65, -0.3, k * 0.3, 0.1);
  }
  add(new RoundedBoxGeometry(0.05, 0.22, 0.5, 2, 0.02), black, -1.2, -0.42, 0);                                // the snow flap
  m.root.add(sled);
  m.sled = sled; m.pedal = null; m.steers = false; m.stance = 0.3;
  m.grips = new THREE.Vector3(0.22, 0.42, 0); m.pegs = new THREE.Vector3(-0.32, -0.25, 0);
  return m;
}
/** Skis instead of a board (Carvvd's other choice): two skis under the feet, the rider facing down them, a pole in each
    hand. m.board is the pair (so it's treated like a board), m.skis says which. */
function skify(m, color) {
  const mat = m.ghost ? m.materials.plastic : new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.2 });
  const bootMat = m.ghost ? mat : new THREE.MeshStandardMaterial({ color: '#1b1f27', roughness: 0.55 });
  const pair = new THREE.Group();
  for (const z of [-0.15, 0.15]) {
    const geo = new RoundedBoxGeometry(1.75, 0.03, 0.09, 2, 0.01);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); const e = Math.max(0, x - 0.68); pos.setY(i, pos.getY(i) + e * e * 1.6 + Math.max(0, -x - 0.78) * 0.12); }   // (the tip turned up, a little tail)
    geo.computeVertexNormals();
    const ski = new THREE.Mesh(geo, mat); ski.position.z = z; ski.castShadow = !m.ghost;
    const binding = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.05, 0.1, 2, 0.015), bootMat); binding.position.set(-0.02, 0.035, 0); ski.add(binding);
    pair.add(ski);
  }
  m.root.add(pair);
  // the poles: in the rider's own space (poseSkier puts them between the hand and the tip each frame)
  const poleMat = m.ghost ? mat : new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.7, roughness: 0.3 });
  const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6); const basket = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 10).translate(0, -0.45, 0);
  m.poles = [0, 1].map(() => { const p = new THREE.Mesh(poleGeo, poleMat); p.add(new THREE.Mesh(basket, poleMat)); m.rider.add(p); return p; });
  m.board = pair; m.skis = true; m.pedal = null; m.stance = 0.15; m.steers = false;
  m.rider.rotation.y = 0; m.rider.position.y = -0.3;
  m.pegs = new THREE.Vector3(0, 0, 0); m.grips = new THREE.Vector3(0.18, 0.45, 0);
  return m;
}
/** The board under the wheels' contact points (the physics still rides on two wheels), and the rider's feet on it. */
export function poseBoard(m) {
  if (!m.board) return;
  const f = m.frontWheel.position; const r = m.rearWheel.position;
  m.board.position.set((f.x + r.x) / 2, (f.y + r.y) / 2 - 0.32 - (m.sink || 0) + (m.skate ? 0.1 : 0), 0);   // (sink: down in deep powder; a skateboard stands on its wheels)
  m.board.rotation.z = Math.atan2(f.y - r.y, f.x - r.x);
  // (the feet in the rider's own frame: the rider group is lowered 0.3 and scaled by k, and turned so its sideways is
  // along the board; poseBike divides the grips by k itself)
  const k = m.rider.scale.x; const y = m.board.position.y + 0.3;
  m.pegs.set(0, (y + 0.05) / k, 0);
  m.grips.set(0.2, y + 1.0, 0);
}

export function poseBike(m, s, place, heading, t) {
  const root = m.root;
  place(s.x, s.y, root.position);
  // air tricks: the 360 turns the whole bike round, the whip throws it sideways
  const whip = s.wh || 0;
  // (a board or skis lean less into a turn than a bike: much more and the rider goes into the snow)
  const roll = m.board ? Math.max(-0.5, Math.min(0.5, s.roll || 0)) : s.roll || 0;
  root.rotation.set(roll + whip * 0.85, -heading + (s.sp || 0) + whip * 0.35, s.a);
  // lean round where the tyres touch the ground, not round the middle of the bike (or the wheels lift off it
  // and the bike looks like it's floating through the turn)
  if (roll) {
    const hc = s.y - Math.min(s.wf[1], s.wr[1]) + 0.35;   // from the middle of the bike down to the ground
    qLean.setFromEuler(root.rotation);
    eUp.set(whip * 0.85, root.rotation.y, s.a, 'YZX'); qUp.setFromEuler(eUp);
    root.position.add(vLean.set(0, -hc, 0).applyQuaternion(qUp)).sub(vLean2.set(0, -hc, 0).applyQuaternion(qLean));
  }
  const ca = Math.cos(-s.a); const sa = Math.sin(-s.a);
  const local = (x, y, out) => { const dx = x - s.x; const dy = y - s.y; return out.set(dx * ca - dy * sa, dx * sa + dy * ca, 0); };
  // wheels
  local(s.wf[0], s.wf[1], m.frontWheel.position);
  // steering: the front wheel, fork legs and bars turn on the fork's axis (s.st radians, + = to the right)
  const st = Math.max(-1, Math.min(1, s.st || 0)) * (m.steers ? 1 : 0.6);
  qSteer.setFromAxisAngle(FORK_AXIS, -st);
  m.frontWheel.quaternion.copy(qSteer).multiply(qSpin.setFromAxisAngle(Z_AXIS, -s.wf[2]));
  m.forkLower.quaternion.copy(qSteer); m.bars.quaternion.copy(qSteer);
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

  if (m.board) poseBoard(m);   // (a snowboard: the board, and where the feet go)
  // the rider (on a bicycle the rider is drawn bigger: points on the bike are divided by k to get the rider's own)
  const P = m.parts; const fig = m.fig; const k = m.rider.scale.x; const pd = m.pedal;
  if (pd) {
    // pedalling: sit on the saddle and turn the cranks, faster the faster you go; coasting: stand up on level
    // pedals with the hips free over the bike, like a downhill racer
    const dt = pd.t == null ? 0 : Math.min(0.1, Math.max(0, t - pd.t)); pd.t = t;
    const pedalling = !s.crashed && (s.th || 0) > 0.15;
    pd.seat += ((pedalling ? 1 : 0) - pd.seat) * Math.min(1, dt * 5);
    if (pedalling) pd.ang += Math.max(2.5, Math.min(11, (s.v || 0) / 0.84)) * dt;
    else { const level = pd.phase + Math.round((pd.ang - pd.phase) / Math.PI) * Math.PI; pd.ang += (level - pd.ang) * Math.min(1, dt * 6); }
    m.crank.rotation.z = -pd.ang;
    for (let i = 0; i < 2; i++) { const a = pd.phase - pd.ang + (i ? 0 : Math.PI); pegs[i].set((pd.bb.x + Math.cos(a) * pd.len) / k, (pd.bb.y + Math.sin(a) * pd.len) / k, 0); }
  } else pegs[0].copy(pegs[1].copy(m.pegs));
  grips.copy(m.grips).divideScalar(k);
  if (s.crashed && s.ragdoll) {
    // thrown off: hips and head from the ragdoll, arms and legs flailing
    const rg = s.ragdoll;
    local(rg.hip.x, rg.hip.y, hipC); local(rg.head.x, rg.head.y, headP); hipC.divideScalar(k); headP.divideScalar(k);
    tA.copy(headP).sub(hipC).normalize();
    sho.copy(hipC).addScaledVector(tA, fig ? fig.dims.torso : 0.5);
    headP.copy(sho).addScaledVector(tA, 0.26);
    if (fig) figTorso(fig, hipC, sho, headP, 1); else poseTorso(P, hipC, sho, headP, -Math.atan2(tA.x, tA.y));
    const side = V(-tA.y, tA.x, 0);
    for (let i = 0; i < 2; i++) {
      const z = i ? 0.18 : -0.18; const ph = t * 9 + i * 2;
      tB.copy(sho).setZ(z);
      tC.copy(tB).addScaledVector(side, Math.sin(ph) * 0.3).add(V(Math.cos(ph) * 0.2, 0.2, z * 1.5));
      tD.copy(tC).add(V(Math.sin(ph * 1.3) * 0.3, Math.cos(ph) * 0.25, z));
      if (fig) figLimb(fig, `arm${i}`, tC, tD); else { placeLimb(P.upperArm[i], tB, tC); placeLimb(P.foreArm[i], tC, tD); P.hand[i].position.copy(tD); }
      tB.copy(hipC).setZ(z * 0.6);
      tC.copy(tB).addScaledVector(tA, -0.45).add(V(Math.sin(ph * 0.8) * 0.2, 0, z * 0.5));
      tD.copy(tC).add(V(Math.cos(ph * 0.7) * 0.3, -0.35, 0));
      if (fig) figLimb(fig, `leg${i}`, tC, tD); else { placeLimb(P.thigh[i], tB, tC); placeLimb(P.shin[i], tC, tD); P.boot[i].position.copy(tD); P.knee[i].position.copy(tC); }
    }
    return;
  }
  local(s.rx, s.ry, hipC);
  hipC.y += 0.16;   // (the physics point is the rider's weight; the hips sit a little above it, standing on the pegs)
  if (m.board && fig) { (m.skis ? poseSkier : poseSnowboarder)(m, s, t, hipC.divideScalar(k), pegs[0]); return; }
  if (pd && pd.seat > 0.01) hipC.lerp(tA.set(pd.saddle.x - 0.04, pd.saddle.y + 0.07, 0), pd.seat);   // (sat on the saddle)
  hipC.divideScalar(k);
  // a held air trick moves the hips (and below, the hands and feet) towards its pose
  const tk = s.tp > 0 ? TRICK_POSES[s.tk] : null; const tp = tk ? s.tp * s.tp * (3 - 2 * s.tp) : 0;
  if (tk) hipC.add(tA.set(tk.hip[0] * tp, tk.hip[1] * tp, 0));
  // the torso leans to reach the bars: more when leaning forward, upright and back when leaning back
  let lean = 0.5 + 0.38 * Math.max(-1, Math.min(1, s.lean)) + (tk ? tk.lean * tp : 0);
  const torso = fig ? fig.dims.torso : 0.5; const arm = fig ? fig.dims.arm : 0.6;
  for (let k = 0; k < 6; k++) {
    sho.set(hipC.x + Math.sin(lean) * torso, hipC.y + Math.cos(lean) * torso, 0);
    const reach = Math.hypot(grips.x - sho.x, grips.y - sho.y);
    if (reach > arm * 0.93) lean += 0.08; else if (reach < arm * 0.5) lean -= 0.06; else break;
  }
  headP.set(sho.x + Math.sin(lean * 0.55) * 0.23, sho.y + Math.cos(lean * 0.55) * 0.23, 0);
  if (fig) figTorso(fig, hipC, sho, headP, 0.6); else poseTorso(P, hipC, sho, headP, lean);
  for (let i = 0; i < 2; i++) {
    const z = i ? 1 : -1;
    // arms: shoulder → elbow (out and up, MX style) → grip
    tB.set(sho.x - 0.02, sho.y - 0.03, z * 0.2);
    tD.set(grips.x, grips.y, z * 0.36);
    if (m.steers) tD.sub(FORK_0).applyQuaternion(qSteer).add(FORK_0);   // (the grips turn with the bars)
    if (tk && tk.hand) tD.lerp(tA.set(sho.x + tk.hand[0], sho.y + tk.hand[1], z * tk.hand[2]), tp);
    if (fig) { if (tk && tk.hand && tp > 0.3) figLimb(fig, `arm${i}`, tC, tD, poleArm[i]); else figGrip(fig, i, z, tD, poleArm[i]); }   // (off the bars in a no-hander)
    else {
      ik(tB, tD, 0.3, 0.3, poleArm[i], tC);
      placeLimb(P.upperArm[i], tB, tC); placeLimb(P.foreArm[i], tC, tD);
      P.hand[i].position.copy(tD); P.hand[i].rotation.z = -0.5;
    }
    // legs: hip → knee (forward, gripping the bike) → ankle over the peg
    tB.set(hipC.x, hipC.y - 0.03, z * 0.1);
    const peg = pegs[i]; const fz = m.stance || (pd ? 0.13 : 0.2);   // (a bicycle's pedals are closer together than footpegs; a snowboarder's feet further apart)
    tD.set(peg.x - 0.02, peg.y + 0.12, z * fz);
    const foot = tk && (tk.feet || (i === 0 ? tk.foot : null));
    if (foot) tD.lerp(tA.set(foot[0], foot[1], foot[2] * (tk.feet ? z : 1)), tp);
    if (fig) {
      if (!foot) tD.set(peg.x + fig.dims.foot[0], peg.y + fig.dims.foot[1], z * fz);   // (the ball of the foot on the peg)
      figLimb(fig, `leg${i}`, tC, tD, poleLeg[i]); if (!foot) figFootFlat(fig, i);
      continue;
    }
    ik(tB, tD, 0.45, 0.44, poleLeg[i], tC);
    placeLimb(P.thigh[i], tB, tC); placeLimb(P.shin[i], tC, tD);
    P.knee[i].position.copy(tC).add(V(0.04, 0, 0)); P.knee[i].quaternion.copy(P.shin[i].quaternion);
    if (foot) P.boot[i].position.copy(tD).add(tA.set(0.04, -0.07, 0));
    else P.boot[i].position.set(peg.x + 0.02, peg.y + 0.05, z * fz);
    P.boot[i].rotation.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ the snowboarder
/** Board grabs for the air tricks (keys 1-6, the same order as MotoCore.TRICKS): which hand, and where on the board
    (x: + the toe edge, - the heel edge; z: along the board, the nose at -). */
const GRABS = [[0, 0.16, -0.14], [1, 0.16, 0.06], [0, -0.16, -0.02], [0, 0, -0.66], [1, 0, 0.66], [1, -0.16, 0.12]];
const bHip = new THREE.Vector3(); const bSho = new THREE.Vector3(); const bHead = new THREE.Vector3(); const bMid = new THREE.Vector3(); const bEnd = new THREE.Vector3(); const bTo = new THREE.Vector3();
const smooth01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
/** The snowboarder standing on their board (s: the bike snapshot, hip: the hips from the physics, peg: where the feet
    go, both in the rider's own frame: x towards their toes, z along the board with the nose at -z, the front foot is
    leg0). Knees bent, lower and tucked the faster they go; leaning into a carve (hips out over the toes on a toe-side
    turn, sat back over the heels on a heel-side one); arms out for balance; looking down the hill over the front
    shoulder. Going slowly with the gas held, the back foot comes out of its binding and pushes along on the snow;
    faster, holding the gas tucks them down low for speed.
    In the air they tuck their knees up (and grab the board in a trick), and they soak up the landing. */
function poseSnowboarder(m, s, t, hip, peg) {
  const F = m.fig; const st = m.bp || (m.bp = { t, push: 0, pw: 0, fast: 0, carve: 0, airT: 0, tuck: 0, land: 0 });
  const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
  const ease = (rate) => 1 - Math.exp(-dt * rate);
  const v = s.v || 0; const air = !!s.air;
  // pushing along: the gas held, going slowly, on the snow
  const gas = (s.th || 0) > 0.15; const pushing = !air && gas && v < 4.5;
  st.pw += ((pushing ? 1 : 0) - st.pw) * ease(pushing ? 5 : 3);
  st.fast += ((!air && gas && !pushing ? 1 : 0) - st.fast) * ease(4);   // (the speed tuck)
  st.push = st.pw > 0.02 ? (st.push + dt * (1.1 + v * 0.06)) % 1 : 0;
  const planted = st.push < 0.55;   // (the back foot on the snow, pushing; then it swings forward again)
  // carving: the lean into the turn (+: towards the toes)
  st.carve += (Math.max(-1, Math.min(1, (s.roll || 0) / 0.45)) - st.carve) * ease(7);
  const c = st.carve; const toe = Math.max(0, c); const heel = Math.max(0, -c);
  // in the air, and landing (the longer the drop, the deeper they sink into it)
  if (air) st.airT += dt; else { if (st.airT > 0.3) st.land = Math.min(1, st.airT / 1.1); st.airT = 0; }
  st.land *= 1 - ease(3.5);
  st.tuck += ((air && st.airT > 0.15 ? 1 : 0) - st.tuck) * ease(air ? 5 : 10);
  const tk = s.tp > 0 && s.tk >= 0 ? GRABS[s.tk] : null; const tp = tk ? smooth01(s.tp) : 0;
  const crouch = Math.min(0.42, 0.06 + Math.min(0.12, v * 0.004) + 0.1 * toe + 0.17 * heel + 0.2 * st.tuck + 0.16 * st.fast + 0.22 * tp + 0.24 * st.land
    + st.pw * (planted ? 0.12 : 0.05) + Math.sin(t * 1.9) * 0.008 * (1 - st.pw));
  bHip.copy(hip).add(bTo.set(0.06 * toe - 0.08 * heel + 0.05 * st.pw, -crouch, -0.08 * st.pw));
  // the upper body: forward over the knees, more in a crouch; the head turned to look down the hill
  const lean = 0.1 + crouch * 0.7 + 0.25 * st.fast + 0.12 * toe + 0.06 * heel + 0.22 * st.pw + 0.15 * tp;
  const torso = F.dims.torso;
  bSho.set(bHip.x + Math.sin(lean) * torso, bHip.y + Math.cos(lean) * torso, -0.06 * st.pw + (tk ? tk[2] * 0.5 * tp : 0));   // (reaching along the board for a grab)
  bHead.set(bSho.x + Math.sin(lean * 0.4) * 0.23, bSho.y + Math.cos(lean * 0.4) * 0.23, bSho.z);
  figTorso(F, bHip, bSho, bHead, 0.6, 0.95 + 0.35 * st.pw - 0.15 * heel);
  // the arms: out along the board for balance
  for (let i = 0; i < 2; i++) {
    const z = i ? 1 : -1; const front = i === 0;
    bEnd.set(bSho.x + 0.14, bSho.y - 0.36, bSho.z + z * 0.44);
    bEnd.x += 0.08 * toe + 0.32 * heel; bEnd.y += -0.12 * toe + 0.1 * heel + 0.24 * st.tuck; bEnd.z += (front ? -0.12 : 0.04) * toe - z * 0.1 * heel + z * 0.08 * st.tuck;
    bEnd.y += Math.sin(t * 1.7 + i * 2) * 0.02;
    bEnd.lerp(bTo.set(bHip.x + 0.34, bHip.y + 0.08, z * 0.16), st.fast * 0.8);   // (tucked: hands in by the knees)
    if (st.pw > 0.01) {   // (pushing: the arms hang and swing with the push)
      const sw = Math.sin(st.push * Math.PI * 2 + (i ? Math.PI : 0));
      bTo.set(bSho.x + 0.1 + sw * 0.1, bSho.y - 0.5, bSho.z + z * 0.24 + sw * 0.08);
      bEnd.lerp(bTo, st.pw);
    }
    if (tk && tk[0] === i) bEnd.lerp(bTo.set(peg.x + tk[1], peg.y + 0.02, tk[2]), tp);   // (a grab)
    figLimb(F, `arm${i}`, bMid, bEnd, poleArm[i]);
  }
  // the legs: both feet in their bindings, or the back one out pushing
  const fz = m.stance; const foot = F.dims.foot;
  for (let i = 0; i < 2; i++) {
    bEnd.set(peg.x + foot[0], peg.y + foot[1], (i ? 1 : -1) * fz);
    if (i && st.pw > 0.01) {
      const p = st.push; const snow = peg.y - 0.09;
      const z = planted ? -0.12 + (p / 0.55) * 0.82 : 0.7 - smooth01((p - 0.55) / 0.45) * 0.82;
      const lift = planted ? 0 : Math.sin(((p - 0.55) / 0.45) * Math.PI) * 0.16;
      bEnd.lerp(bTo.set(0.4 + foot[0], snow + foot[1] + lift, z), st.pw);
    }
    figLimb(F, `leg${i}`, bMid, bEnd, poleLeg[i]); figFootFlat(F, i);
  }
}

/** A skier on their skis (the same frame as poseSnowboarder, but facing down the skis: x along them, the feet side by
    side at ±z): knees bent and forward, the hips shifting inside a turn while the shoulders stay level (angulation),
    the poles held forward and planted at the start of each turn; going slowly with the gas held, a double-pole push;
    faster, a tuck with the poles under the arms; in the air, knees up (and a ski grab in a trick). */
const pHand = new THREE.Vector3(); const pTip = new THREE.Vector3(); const pDir = new THREE.Vector3();
function setPole(pole, hand, tip) {
  pDir.subVectors(tip, hand); const len = pDir.length() || 1;
  pole.position.copy(hand).addScaledVector(pDir, 0.5); pole.quaternion.setFromUnitVectors(UP, pDir.divideScalar(len)); pole.scale.set(1, len, 1);
}
function poseSkier(m, s, t, hip, peg) {
  const F = m.fig; const st = m.bp || (m.bp = { t, push: 0, pw: 0, fast: 0, carve: 0, airT: 0, tuck: 0, land: 0, plant: 0, plantSide: 1, lastSide: 0 });
  const dt = Math.min(0.1, Math.max(0, t - st.t)); st.t = t;
  const ease = (rate) => 1 - Math.exp(-dt * rate);
  const v = s.v || 0; const air = !!s.air; const gas = (s.th || 0) > 0.15;
  const pushing = !air && gas && v < 5;
  st.pw += ((pushing ? 1 : 0) - st.pw) * ease(pushing ? 5 : 3);
  st.fast += ((!air && gas && !pushing ? 1 : 0) - st.fast) * ease(4);
  st.push = st.pw > 0.02 ? (st.push + dt * (0.9 + v * 0.08)) % 1 : 0;
  st.carve += (Math.max(-1, Math.min(1, (s.roll || 0) / 0.45)) - st.carve) * ease(7);
  const c = st.carve;
  // a pole plant as each turn starts (on the inside of the new turn)
  const side = c > 0.25 ? 1 : c < -0.25 ? -1 : 0;
  if (side && side !== st.lastSide && !air) { st.plant = 1; st.plantSide = side; }
  if (side) st.lastSide = side;
  st.plant = Math.max(0, st.plant - dt * 2.8);
  if (air) st.airT += dt; else { if (st.airT > 0.3) st.land = Math.min(1, st.airT / 1.1); st.airT = 0; }
  st.land *= 1 - ease(3.5);
  st.tuck += ((air && st.airT > 0.15 ? 1 : 0) - st.tuck) * ease(air ? 5 : 10);
  const tk = s.tp > 0 && s.tk >= 0 ? GRABS[s.tk] : null; const tp = tk ? smooth01(s.tp) : 0;
  const crouch = Math.min(0.45, 0.08 + Math.min(0.1, v * 0.004) + 0.1 * Math.abs(c) + 0.2 * st.fast + 0.2 * st.tuck + 0.2 * tp + 0.22 * st.land + 0.08 * st.pw * Math.sin(st.push * Math.PI));
  bHip.copy(hip).add(bTo.set(-0.05 - 0.06 * st.fast, -crouch, 0.07 * c));
  const lean = 0.2 + crouch * 0.8 + 0.3 * st.fast + 0.25 * st.pw * Math.sin(st.push * Math.PI * 2) ** 2;
  const torso = F.dims.torso;
  bSho.set(bHip.x + Math.sin(lean) * torso, bHip.y + Math.cos(lean) * torso, bHip.z * 0.3);
  bHead.set(bSho.x + Math.sin(lean * 0.4) * 0.23, bSho.y + Math.cos(lean * 0.4) * 0.23, bSho.z);
  figTorso(F, bHip, bSho, bHead, 0.6, 0);
  const snow = peg.y - 0.06;
  for (let i = 0; i < 2; i++) {
    const z = i ? 1 : -1;
    // the hand, and where its pole's tip is
    pHand.set(bSho.x + 0.32, bSho.y - 0.42, z * 0.3); pTip.set(pHand.x - 0.45, snow + 0.1, z * 0.36);   // (held forward, tips trailing)
    if (st.plant > 0 && st.plantSide === z) { const k = Math.sin(st.plant * Math.PI); pHand.add(bTo.set(0.12 * k, -0.08 * k, 0)); pTip.lerp(bTo.set(0.55, snow, z * 0.38), k); }
    if (st.pw > 0.01) {   // (double-poling: reach forward, plant, push back, swing through)
      const p = st.push; const reach = p < 0.5 ? Math.cos(p * 2 * Math.PI) : Math.cos(Math.PI) + (p - 0.5) * 4; const k2 = Math.max(-1, Math.min(1, reach));
      bTo.set(bSho.x + 0.18 + 0.32 * k2, bSho.y - 0.35 - 0.2 * (1 - k2) / 2, z * 0.3); pHand.lerp(bTo, st.pw);
      pTip.lerp(bTo.set(p < 0.5 ? 0.45 - p * 1.6 : -0.35, p < 0.5 ? snow : snow + 0.3, z * 0.36), st.pw);
    }
    if (st.fast > 0.01) { pHand.lerp(bTo.set(bHip.x + 0.48, bHip.y + 0.22, z * 0.12), st.fast); pTip.lerp(bTo.set(pHand.x - 1.05, pHand.y + 0.2, z * 0.2), st.fast); }   // (tucked)
    if (st.tuck > 0.01) { pHand.y += 0.12 * st.tuck; pHand.z += z * 0.12 * st.tuck; pTip.lerp(bTo.set(pHand.x - 0.9, pHand.y - 0.5, z * 0.6), st.tuck * 0.7); }
    if (tk && tk[0] === i) { const at = tk[2] < -0.3 ? 0.55 : tk[2] > 0.3 ? -0.55 : 0.12; pHand.lerp(bTo.set(at, peg.y + 0.08, z * 0.15), tp); }   // (a ski grab)
    bEnd.copy(pHand);
    figLimb(F, `arm${i}`, bMid, bEnd, poleArm[i]);
    if (m.poles) { m.poles[i].visible = true; setPole(m.poles[i], pHand, pTip); }
    // the legs: side by side on the skis
    bEnd.set(peg.x + F.dims.foot[0], peg.y + F.dims.foot[1], z * m.stance);
    figLimb(F, `leg${i}`, bMid, bEnd, poleLeg[i]); figFootFlat(F, i);
  }
}

/** Sat on a chairlift's chair at seat (world space), facing heading (radians, 0 = +z): hips on the bench, knees
    bent, hands in the lap, the board (if any) hanging off the feet. */
const seatV = new THREE.Vector3();
export function seatRider(m, seat, heading) {
  const F = m.fig; const root = m.root; const k = m.rider.scale.x;
  root.rotation.set(0, m.board && !m.skis ? heading : heading - Math.PI / 2, 0); root.position.copy(seat);
  if (!F) return;
  const hy = 0.6;
  bHip.set(-0.02, hy, 0); bSho.set(-0.08, hy + F.dims.torso, 0); bHead.set(-0.04, bSho.y + 0.23, 0);
  figTorso(F, bHip, bSho, bHead, 0.6, 0.15);
  for (let i = 0; i < 2; i++) {
    const z = i ? 1 : -1;
    figLimb(F, `arm${i}`, bMid, bEnd.set(0.3, hy + 0.12, z * 0.17), poleArm[i]);
    figLimb(F, `leg${i}`, bMid, bEnd.set(0.42 + F.dims.foot[0], hy - 0.42 + F.dims.foot[1], z * (m.board ? m.stance : 0.13)), poleLeg[i]); figFootFlat(F, i);
  }
  if (m.skis) { m.board.position.set(0.42 * k, (hy - 0.5) * k - 0.3, 0); m.board.rotation.set(0, 0, 0); for (const p of m.poles) p.visible = false; }
  else if (m.board) { m.board.position.set(0, (hy - 0.5) * k - 0.3, 0.42 * k); m.board.rotation.set(0, 0, 0); }
  // move it all so the hips are on the bench
  root.updateMatrixWorld(true); F.bones.CC_Base_Hip.getWorldPosition(seatV);
  root.position.add(seatV.subVectors(seat, seatV)).y += 0.12;
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
  if (m.cover) m.cover.dispose();   // (its own snowy and muddy copies of the materials)
  m.root.traverse((o) => { if (o.isMesh && o.material && !o.userData.shared) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((x) => { if (x.map) x.map.dispose(); x.dispose(); }); } });
  if (m.root.parent) m.root.parent.remove(m.root);
}
