/* Motocross: the game page — the 3D scene behind the menus, the ride (input, camera, HUD, effects),
   solo time trials and online races. The menus are in menus.js, the physics in core.js, the 3D bike
   in bike.js, the world in world.js and the sound in sound.js. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWorld } from './world.js';
import { makeBike, boardify, jetskify, sledify, skateify, preloadSkateboard, poseBike, seatRider, disposeBike, preloadBike, bikesLoaded, LIVERIES, MODELS, MTB_MODELS, MTB_RIDERS, RIDERS, KITS, HELMETS } from './bike.js';
import { createAudio } from './sound.js';
import { createMenus } from './menus.js';
import {buildRideWorld} from './open-world/ride-world.mjs';
import {loadNature,loadAspens,loadSpruces} from './open-world/nature.mjs';
import {createTrial,stepTrial,trialBestKey} from './open-world/trials.mjs';
import * as Coins from './coins.js';
import * as Chutes from './chutes.js';
import { createTracks } from './tracks.js';
import { coverModel } from './cover.js';
import { createStudio, recorder } from './studio.js';
import { createAvalanche } from './avalanche.js';
import { createTow } from './tow.js';
import * as Career from './career.js';
import { createMap } from './map.js';
import * as Car from './car.js';
import * as Wing from './wing.js';
import { makeCar, poseCar, disposeCar, preloadCar, preloadExtra, CAR_PAINTS, CAR_MODELS, paintable } from './car-model.js';

const { $, $$, h, fill, Net, Sfx, UI, store, Account, Unlocks } = PA;
const FX = PA.FX || {};
const C = window.MotoCore;
const DT = C.DT;

// ------------------------------------------------------------------ data and preferences
let DATA = null; let WORLDS = []; let CHALLENGES = [];
const builtTracks = new Map();
const trackDef = (id) => DATA.tracks.find((t) => t.id === id) || DATA.tracks[0];
const physicsTrack = (def) => { if (!builtTracks.has(def.id)) builtTracks.set(def.id, C.build(def)); return builtTracks.get(def.id); };
const prefs = Object.assign({ cam: 'chase', quality: 'auto', livery: 'factory', mode: 'solo', track: 'desert', minimap: 'on', physics: 'og', vehicle: 'bike', carModel: 'revuelto', carPaint: 'arancio', mtbModel: 'dh', mtbWorld: 'wildwood' }, store.get('moto_prefs', {}));
if (!MTB_MODELS[prefs.mtbModel]) prefs.mtbModel = 'dh';
const savePrefs = () => store.set('moto_prefs', prefs);
// OG physics: a tumble plays out until you land on your wheels or your head. NEW: over on your side or roof is a
// crash straight away, the wreck stops bouncing about and you're back riding sooner
const calm = () => prefs.physics === 'new';
const crashTime = () => (calm() ? 0.8 : C.P.CRASH_TIME);
const bestOf = (id) => store.get('moto_best_' + id, null);
// medals: how close you get to the robot's time
const MEDALS = [['🥇', 'Gold', 1.06], ['🥈', 'Silver', 1.2], ['🥉', 'Bronze', 1.45]];
const medalTimes = (def) => MEDALS.map((m) => def.robot * m[2]);
const medalFor = (def, t) => medalTimes(def).findIndex((m) => t <= m);
const fmt = (s) => {
  if (s == null) return '–';
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 6000)}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const touchDevice = matchMedia('(pointer: coarse)').matches;
const qualityLevel = () => (prefs.quality === 'auto' ? (touchDevice ? 'medium' : 'high') : prefs.quality);
const QUALITY = { high: { pr: 2, scenery: 1, shadows: true }, medium: { pr: 1.4, scenery: 0.65, shadows: true }, low: { pr: 1, scenery: 0.4, shadows: false } };

// what the player has unlocked (bike paint jobs)
let unlocked = new Set(['factory']);
let bikeList = []; const bikeHints = {};
async function loadUnlocks() {
  try {
    const d = await Unlocks.load();
    const u = Account.user;
    if (!u) unlocked = new Set((d.bikes || []).filter((b) => !b.rule).map((b) => b.id));
    else {
      const prof = await Net.request('profile:get', { name: u.name });
      const have = await Unlocks.of(prof.profile.level, prof.profile.stats || {});
      unlocked = have.bike || new Set(['factory']);
    }
  } catch { /* offline: keep the default */ }
  if (!unlocked.has(prefs.livery)) prefs.livery = 'factory';
  try { bikeList = (await Unlocks.load()).bikes || []; } catch { bikeList = []; }
  for (const b of bikeList) if (b.rule && !bikeHints[b.id]) { try { bikeHints[b.id] = await Unlocks.hint(b.rule); } catch { /* no hint */ } }
}
const myLivery = () => (Account.user && Account.user.look && Account.user.look.bike && unlocked.has(Account.user.look.bike) ? Account.user.look.bike : unlocked.has(prefs.livery) ? prefs.livery : 'factory');
// your bike style, rider kit, helmet and race number (free to pick; only looks)
prefs.style = Object.assign({ model: 'mx4', rider: 'biker', kit: 'match', helmet: 'match', number: null }, prefs.style);
const myLook = () => ({ ...prefs.style, livery: myLivery() });
const mtbRider = (id = prefs.mtbRider) => (MTB_RIDERS[id] ? id : 'bmx');
const mtbLook = () => ({ ...myLook(), model: prefs.mtbModel, rider: mtbRider() });   // (Unrevvd: your mountain bike and rider)
const boardLook = () => ({ ...mtbLook(), rider: 'snow' });   // (Carvvd: the snowboarder)
/** A snowboard's "pedal power" and air drag (a mountain bike's are 1): barely any push, and it slides well. */
const BOARD = { power: 0.3, drag: 0.85 };
/** Carvvd's free ride: deep powder off the pistes slows you down, the groomed pistes are quicker. */
const BOARD_FREE = { ...BOARD, powder: 0.03 };
// Wavvd's jet ski: the dirt bike's engine through a jet (gentler power, lower gearing, the water's drag), about
// 95 km/h flat out and more on turbo
const JETSKI = { power: 0.62, drag: 5.5, turbo: 1.15, regen: 1.3, gear: 0.82 };
const SPRAY = new THREE.Color('#eef7fa'); const SPRAY_W = SPRAY;
const jetColor = () => prefs.jetColor || '#18b6d6';
/** Sledvvd: a snowmobile (the dirt bike's physics with lots of low-down pull for climbing, and a lower top speed). */
const SLED = { power: 0.95, drag: 2.6, turbo: 1.1, regen: 1.2, gear: 0.72 };
const sledColor = () => prefs.sledColor || '#ff5a1f';
/** Drivvd: the rally buggy's paint (one of the supercar paints). */
const buggyPaint = () => (CAR_PAINTS[prefs.buggyPaint] ? prefs.buggyPaint : 'giallo');
/** Skyvvd: the wingsuit's colour. */
const wingColor = () => prefs.wingColor || '#ff4fa3';
const SNOW_SPRAY = new THREE.Color('#f4f8ff');
/** Grindvvd: a skateboard (pushing along like pedalling, a board's spins), and its deck's colour. */
const SKATE = { power: 0.5, drag: 0.9 };
const skateColor = () => prefs.skateColor || '#ff4fa3';
const jetLook = () => ({ ...myLook(), rider: mtbRider() });   // (Wavvd: your Unrevvd rider, no helmet)
/** Carvvd's weather (free ride on the snow): the sky and how much it snows. */
const WEATHER = { clear: { name: 'Clear', emoji: '☀️' }, snow: { name: 'Snowing', emoji: '🌨️' }, blizzard: { name: 'Blizzard', emoji: '🌬️' } };
/** The sky for free ride on any world (prefs.sky): as the world was made, or sunset, night (your lamp on), rolling fog
    or a storm (rain and lightning; on the snow a blizzard; at sea the waves get much bigger). */
const SKIES = { day: { name: 'Day', emoji: '☀️' }, sunset: { name: 'Sunset', emoji: '🌅' }, night: { name: 'Night', emoji: '🌙' }, fog: { name: 'Fog', emoji: '🌫️' }, storm: { name: 'Storm', emoji: '⛈️' } };
const SKY_LOOK = {
  sunset: { sky: { sun: [5, 250], turbidity: 7, rayleigh: 2.8, mie: 0.014, mieG: 0.9, exposure: 1.05, fogK: 1.25, fogColor: '#b98f86', sunColor: '#ffa860', sunI: 1.6, hemi: ['#ffc59a', '#3d3328', 0.75], envI: 0.5 } },
  night: { night: true, lamp: 320, sky: { sun: [40, 150], exposure: 2.2, fogK: 6, fogColor: '#05070c', sunColor: '#8ea6e0', sunI: 0.28, hemi: ['#2c3a58', '#0b0d0a', 0.34], envI: 0 } },
  fog: { fogPulse: [3, 16, 20], sky: { sun: [26, 180], turbidity: 8, rayleigh: 1.2, mie: 0.01, exposure: 1, fogColor: '#c4cacd', sunColor: '#f2f0ea' } },
  storm: { storm: true, sky: { sun: [34, 200], turbidity: 10, rayleigh: 3, mie: 0.02, exposure: 0.75, fogK: 4, fogColor: '#4d565e', sunColor: '#a7b0bd', sunI: 0.9, hemi: ['#6b7785', '#20251c', 0.55] } },
};
/** A world (its JSON, before it's built) under the sky you picked. */
function applySky(def, k) {
  const L = SKY_LOOK[k]; if (!L) return;
  const snow = def.theme === 'snow' && k === 'storm';   // (no rain on the snow: a blizzard)
  def.look = { ...(def.look || {}), ...L, sky: { ...(def.look?.sky || {}), ...L.sky }, ...(snow ? { storm: false, weather: 'blizzard' } : {}) };
  if (k !== 'sunset') delete def.look.dusk;
  if (def.sea && k === 'storm') def.sea = { ...def.sea, steep: Math.min(0.9, def.sea.steep * 1.1), deep: '#0b2a3a', shallow: '#2f8f8a', waves: def.sea.waves.map(([l, a, d]) => [l * 1.25, a * 2, d]) };   // (a rough sea)
}
/** Carvvd's boards (only looks). */
const BOARDS = { ice: { name: 'Ice', emoji: '🧊', color: '#2a7fff' }, lava: { name: 'Lava', emoji: '🌋', color: '#ff4a2a' }, toxic: { name: 'Toxic', emoji: '🧪', color: '#7dff3a' },
  aurora: { name: 'Aurora', emoji: '🌌', color: '#b44dff' }, snow: { name: 'Whiteout', emoji: '🤍', color: '#eef3f8' }, gold: { name: 'Gold', emoji: '🥇', color: '#f2b318' },
  champ: { name: 'Champion', emoji: '🏆', color: '#00c2a8', lock: () => (Chutes.weeklyGold() ? null : '🔒 Win gold in a Weekly Challenge') },
  legend: { name: 'Legend', emoji: '🎖️', color: '#e8c25a', lock: () => (Career.cleared('legend') ? null : '🔒 Clear the Legend tier in Career') } };
/** On a snowboard the air tricks are grabs (the same keys, in MotoCore.TRICKS's order; bike.js's GRABS poses them). */
const BOARD_TRICKS = ['MUTE GRAB', 'INDY GRAB', 'MELON GRAB', 'NOSE GRAB', 'TAIL GRAB', 'STALEFISH', 'SHIFTY', '360'];
/** Grindvvd's: flips and grabs of a skateboard (the same keys). */
const SKATE_TRICKS = ['KICKFLIP', 'HEELFLIP', 'POP SHUV-IT', 'INDY GRAB', 'MELON GRAB', 'NOSE GRAB', 'SHIFTY', '360'];
const trickName = (i) => (R.skate ? SKATE_TRICKS[i] : R.board || R.tow ? BOARD_TRICKS[i] : C.TRICKS[i].name);
const boardColor = () => (BOARDS[prefs.board] && !BOARDS[prefs.board].lock?.() ? BOARDS[prefs.board] : BOARDS.ice).color;
const netStyle = () => ({ ...prefs.style, car: prefs.carModel, paint: prefs.carPaint, mtb: prefs.mtbModel, mrider: mtbRider(), cgear: gear(), jet: jetColor(), boardColor: boardColor(), sled: sledColor(), buggy: buggyPaint(), wing: wingColor(), skate: skateColor() });
/** Carvvd: a snowboard or skis. */
const gear = () => (prefs.cgear === 'skis' ? 'skis' : 'board');   // (what the room sees: bike, rider, supercar, mountain bike and its rider)
/** Pick your Unrevvd mountain bike. */
/** Pick your Unrevvd rider. */
function setMtbRider(id) {
  if (!MTB_RIDERS[id]) return;
  prefs.mtbRider = id; savePrefs(); Sfx.play('click');
  if (window.Room && Room.code) Net.send('g:style', { style: netStyle() });
  preloadBike(prefs.mtbModel, id).then(() => { menus?.refresh?.(); placeStage(); });
}
function setMtbModel(id) {
  if (!MTB_MODELS[id]) return;
  prefs.mtbModel = id; savePrefs();
  if (window.Room && Room.code) Net.send('g:style', { style: netStyle() });
  Sfx.play('click'); menus.refresh();
  preloadBike(id).then(() => placeStage());
}
function setStyle(patch) {
  prefs.style = { ...prefs.style, ...patch }; savePrefs();
  if (window.Room && Room.code) Net.send('g:style', { style: netStyle() });   // (so the others see it)
  Sfx.play('click');
  menus.refresh();
  if (patch.model || patch.rider) preloadBike(prefs.style.model).then(() => placeStage());   // (a model-file bike or rider shows as soon as it has loaded)
}
preloadBike(prefs.style.model).then(() => placeStage());

// ------------------------------------------------------------------ renderer and world
const canvas = $('#mx-canvas');
let renderer = null; let camera = null; let world = null; let worldKey = null;
function setupRenderer() {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    UI.toast('Your browser can’t show 3D graphics (WebGL) 😢', 'bad', 5000);
    return false;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.25, 9000);
  studio = createStudio({ app: $('#mx'), camera, renderer, ground: (x, z) => (R.T ? groundUnder(x, z, R.bike ? R.bike.s : 0) : 0), onExit: () => { R.cam.init = false; R.last = performance.now(); } });
  return true;
}
let studio = null;   // photo mode and replays (studio.js)
function resize() {
  if (!renderer) return;
  const q = QUALITY[qualityLevel()];
  const w = canvas.clientWidth || innerWidth; const hh = canvas.clientHeight || innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, R.mode==='free' ? (prefs.quality==='high'?1.5:qualityLevel()==='low'?1:1.2) : q.pr) * (R.prScale || 1));
  renderer.setSize(w, hh, false);
  camera.aspect = w / hh; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
function loadWorld(def) {
  const key = def.id + ':' + qualityLevel();
  if (worldKey === key && world) return world;
  if (world) {
    for (const sb of stage.bikes.values()) { sb.model.root.removeFromParent(); if (sb.tag) sb.tag.removeFromParent(); }   // (they move to the new world)
    dropTrails(); world.dispose(); world = null;
  }
  const q = QUALITY[qualityLevel()];
  world = buildWorld(renderer, physicsTrack(def), { quality: q.scenery });
  renderer.shadowMap.enabled = q.shadows;
  renderer.toneMappingExposure = world.theme.exposure;
  worldKey = key;
  return world;
}

// ------------------------------------------------------------------ the ride
const R = {
  rec: recorder(),   // the last minute of riding, for the replay
  V: C, car: false, mtb: false,   // (the physics: MotoCore's bike (mtb: a mountain bike), or car.js's supercar in free ride)
  running: false, mode: 'solo', def: null, T: null, bike: null, model: null, prev: null, cur: null,
  goAt: 0, acc: 0, last: 0, finished: false, spectate: false, lane: 0, camMode: prefs.cam,
  cam: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, shake: 0, init: false },
  audio: null, freeOnline: false, others: new Map(), sentAt: 0, beeped: 0, gateDown: false, prScale: 1, slowFrames: 0,
  stuck: 0, hudAt: 0, trickTimer: null, lastLand: 0, emitAcc: 0, roll: 0, safeTrail: [], retry: null, toPad: false,
};
const keys = {};
const touch = { gas: false, brake: false, left: false, right: false, back: false, fwd: false, nitro: false, trick: false, spin: false };
// air tricks: keys 1–6 hold a pose, Z whips the bike sideways, X spins it 360 (MotoCore.TRICKS has the same order)
const TRICK_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyZ', 'KeyX'];

function snap(b) {
  const f = b.wh[0]; const r = b.wh[1];
  return {
    x: b.x, y: b.y, a: b.a, wf: [f.x, f.y, f.ang], wr: [r.x, r.y, r.ang], rx: b.rx, ry: b.ry, lean: b.lean, px: b.px, pz: b.pz, h: b.h, s: b.s,
    boost: b.boost, crashed: b.crashed, ragdoll: b.rider ? { hip: { x: b.rider.hip.x, y: b.rider.hip.y }, head: { x: b.rider.head.x, y: b.rider.head.y } } : null,
    tk: b.tk, tp: b.pose, wh: b.whip, sp: b.spin, th: b.thr, v: Math.hypot(b.vx, b.vy), air: !(f.ct || r.ct),
    car: b.car ? { p: b.pitch, r: b.roll, st: b.steer, w: [b.wspin[0], b.wspin[1]], c: [...b.comp] } : null,
  };
}
const lerpA = (p, q, t) => { let d = q - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return p + d * t; };
function mix(p, q, t) {
  const L = (a, b) => a + (b - a) * t;
  return {
    x: L(p.x, q.x), y: L(p.y, q.y), a: lerpA(p.a, q.a, t), lean: L(p.lean, q.lean), rx: L(p.rx, q.rx), ry: L(p.ry, q.ry),
    px: L(p.px, q.px), pz: L(p.pz, q.pz), h: lerpA(p.h, q.h, t), s: L(p.s, q.s),
    wf: [L(p.wf[0], q.wf[0]), L(p.wf[1], q.wf[1]), L(p.wf[2], q.wf[2])], wr: [L(p.wr[0], q.wr[0]), L(p.wr[1], q.wr[1]), L(p.wr[2], q.wr[2])],
    tk: q.tk, tp: L(p.tp || 0, q.tp || 0), wh: L(p.wh || 0, q.wh || 0), sp: q.sp ? (p.sp && p.sp <= q.sp ? L(p.sp, q.sp) : q.sp) : 0, th: q.th, v: L(p.v || 0, q.v || 0), air: q.air,
    car: q.car && p.car ? { p: lerpA(p.car.p, q.car.p, t), r: lerpA(p.car.r, q.car.r, t), st: L(p.car.st, q.car.st), w: [L(p.car.w[0], q.car.w[0]), L(p.car.w[1], q.car.w[1])], c: q.car.c.map((v, i) => L(p.car.c[i], v)) } : q.car,
    boost: q.boost, crashed: q.crashed, ragdoll: q.ragdoll && p.ragdoll ? { hip: { x: L(p.ragdoll.hip.x, q.ragdoll.hip.x), y: L(p.ragdoll.hip.y, q.ragdoll.hip.y) }, head: { x: L(p.ragdoll.head.x, q.ragdoll.head.x), y: L(p.ragdoll.head.y, q.ragdoll.head.y) } } : q.ragdoll,
  };
}

/** Read the controls: keyboard (W/S gas and brake, A/D steer, Q/E lean back/forward, Space nitro; arrows work too),
    the touch buttons and a gamepad (triggers, left stick to steer, right stick to lean). */
function controls() {
  let gas = keys.KeyW || keys.ArrowUp || touch.gas ? 1 : 0;
  let brake = keys.KeyS || keys.ArrowDown || touch.brake ? 1 : 0;
  let steer = (keys.KeyD || keys.ArrowRight || touch.right ? 1 : 0) - (keys.KeyA || keys.ArrowLeft || touch.left ? 1 : 0);
  let lean = (keys.KeyE || touch.fwd ? 1 : 0) - (keys.KeyQ || touch.back ? 1 : 0);
  let nitro = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.nitro);
  let trick = TRICK_KEYS.findIndex((k) => keys[k]);
  if (trick < 0 && touch.trick) trick = 0;
  if (trick < 0 && touch.spin) trick = 7;
  const axis=(value,dead)=>Math.abs(value)<=dead?0:Math.sign(value)*(Math.abs(value)-dead)/(1-dead);
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    gas = Math.max(gas, p.buttons[7] ? p.buttons[7].value : 0);
    brake = Math.max(brake, p.buttons[6] ? p.buttons[6].value : 0);
    if (Math.abs(p.axes[0] || 0) > C.P.GAMEPAD_STEER_DEAD) steer = axis(p.axes[0],C.P.GAMEPAD_STEER_DEAD);
    if (Math.abs(p.axes[3] || 0) > C.P.GAMEPAD_LEAN_DEAD) lean = axis(p.axes[3],C.P.GAMEPAD_LEAN_DEAD);
    if (p.buttons[0] && p.buttons[0].pressed) nitro = true;
    // X superman, Y no-hander, B 360, bumpers whip / can-can
    for (const [btn, t] of [[2, 0], [3, 1], [1, 7], [4, 6], [5, 2]]) if (trick < 0 && p.buttons[btn] && p.buttons[btn].pressed) trick = t;
  }
  return { gas, brake, steer, lean, nitro, trick };
}

/** Start a ride. mode 'solo' or 'online'; goAt: when the gate drops (performance.now() time). */
function begin(def, mode, goAt) {
  if (!setupRenderer()) return false;
  stopRide();
  setRiding(true);
  R.mode = mode; R.def = def; R.T = physicsTrack(def); R.ride = (R.ride || 0) + 1;
  R.trial=null; R.challenge=null; R.freeOnline=false; $('#mx-trials').hidden=true;$('.mx-nlab').textContent='NITRO';for(const el of $$('.mx-nitro, .mx-nlab'))el.style.display=''; $('#hud-coins').hidden=true;
  if (mode === 'solo') { R.spectate = false; for (const o of R.others.values()) dropOther(o); R.others.clear(); }
  fill($('#hud-center'), h('div', { class: 'mx-loading' }, h('div', { class: 'mx-spin' }), 'Building the track…'));
  resize();
  // let the loading message show before the (slow) world build (and your bike, if it's a model file, load)
  setTimeout(() => preloadBike(myLook().model).then(() => {
    if (!riding || R.mode!==mode || R.def!==def) return;   // stale asynchronous start
    loadWorld(def);
    R.lane = mode === 'online' ? laneFor(Net.id) : 0;   // (your slot in the start gate)
    R.bike = C.newBike(R.T, R.T.start, R.lane);
    R.prev = R.cur = snap(R.bike);
    if (R.model) disposeModel(R.model);
    R.V = C; R.car = false; R.mtb = false; R.camMode = prefs.cam; R.veh = null; R.sled = R.buggy = R.wing = R.skate = R.water = R.board = false;   // (a track race: none of the other modes' vehicles)
    R.model = makeBike(myLook());
    R.model.root.visible = !R.spectate;
    world.scene.add(R.model.root);
    R.goAt = Math.max(goAt, performance.now() + 600);
    R.acc = 0; R.last = performance.now(); R.finished = false; R.beeped = 0; R.gateDown = false; R.cam.init = false; R.stuck = 0; R.emitAcc = 0;
    R.splits = []; R.best = mode === 'solo' ? bestOf(def.id) : null;
    for (const gg of world.gates) gg.rotation.z = 0;
    for (const o of R.others.values()) addOtherModel(o);
    fill($('#hud-center'));
    $('#hud-track').textContent = def.name;
    drawMapBase();
    R.audio = createAudio();
    R.running = true;
    requestAnimationFrame(frame);
  }), 30);
  return true;
}
function stopRide() {
  map.reset(); wayMarker = null;
  if(R.trialMarker){R.trialMarker.removeFromParent();R.trialMarker.geometry.dispose();R.trialMarker.material.dispose();R.trialMarker=null;}
  dropFinishMarker();
  if (R.run) { R.run.save(false); R.run = null; }
  dropGhosts(); dropTagMarker(); dropRelayLanterns(); dropAvalanche(); R.tow?.dispose(); R.tow = null; R.chain = null;
  studio?.stop(); R.rec.clear(); R.lift = null; R.grind = null; R.pipe = null;
  R.running = false;R.paused=false;
  if (R.audio) { R.audio.stop(); R.audio = null; }
  for (const k of Object.keys(touch)) touch[k] = false;
}
const LANES = [0, -1.15, 1.15, -2.3, 2.3, -3.45, 3.45];   // the start gate's slots
/** Riding with the room: a race, a challenge, or a free ride together. */
const online = () => R.mode === 'online' || !!R.challenge?.online || R.freeOnline;
const laneFor = (id) => {
  const ids = state.race ? Object.keys(state.race.runners).sort() : [id];
  const i = Math.max(0, ids.indexOf(id));
  return LANES[i % LANES.length];
};

const perfEnabled=new URLSearchParams(location.search).has('perf');
const perfLabel=perfEnabled?h('div',{id:'moto-perf',style:{position:'fixed',bottom:'8px',left:'35%',zIndex:20,padding:'5px',background:'#101820df',color:'#fff',font:'12px monospace',pointerEvents:'none'}},'Measuring…'):null;
if(perfLabel)document.body.append(perfLabel);
let prof={start:0,frames:0,cpu:0};
function profileFrame(now,cpuStart){
 if(!perfLabel)return;
 if(!prof.start)prof.start=now;
 prof.frames++;prof.cpu+=performance.now()-cpuStart;
 if(now-prof.start>1000){perfLabel.textContent=`${Math.round(prof.frames*1000/(now-prof.start))} fps · CPU ${(prof.cpu/prof.frames).toFixed(1)} ms · ${Math.round(renderer.info.render.triangles/1000)}k tris · ${renderer.info.render.calls} draws`;prof={start:now,frames:0,cpu:0};}
}
function frame(now) {
  if (!R.running) return;
  const cpuStart=perfEnabled?performance.now():0;
  const ride=R.ride; requestAnimationFrame(t=>{if(ride===R.ride)frame(t);});
  const dt = Math.min(0.1, (now - R.last) / 1000); R.last = now;
  if (studio && studio.busy) { studioFrame(now, dt); return; }
  if (R.lift) { liftFrame(now, dt); return; }
  if(R.paused){render(now,dt,1);return;}
  // the countdown
  const left = (R.goAt - now) / 1000;
  if (left > 0) {
    const n = Math.ceil(left);
    if (n <= 3 && n !== R.beeped) { R.beeped = n; if (R.audio) R.audio.beep(false); showCount(n); }
  } else if (!R.gateDown) {
    R.gateDown = true; if (R.audio) { R.audio.beep(true); R.audio.gate(); } showCount('GO!');
  }
  // fixed-step physics (a moment of slow motion when you crash on your own)
  R.slow = Math.max(0, (R.slow || 0) - dt);
  R.acc += R.slow > 0 ? dt * 0.35 : dt;
  let steps = 0;
  while (R.acc >= DT && steps < 14) { physicsStep(now); R.acc -= DT; steps++; }
  if (steps >= 14) R.acc = 0;
  render(now, dt, R.acc / DT);
  profileFrame(now,cpuStart);
  // too slow? draw fewer pixels
  if (dt > 1 / 38) R.slowFrames++; else R.slowFrames = Math.max(0, R.slowFrames - 1);
  if (R.slowFrames > 90 && R.prScale > 0.6) { R.prScale -= 0.15; R.slowFrames = 0; resize(); }
}

const aheadV = new THREE.Vector3();
function physicsStep(now) {
  const b = R.bike; const T = R.T;
  R.prev = R.cur;
  const holding = now < R.goAt || b.hold > 0 || R.spectate;
  const inp = R.spectate || R.finished ? { gas: 0, brake: R.finished ? 1 : 0, lean: 0, nitro: false } : R.override ? R.override(R.T, b) : controls();
  if (b.hold > 0) { b.hold -= DT; b.t += DT; }
  const before={x:b.px,y:b.y,z:b.pz}; const xBefore=b.x;
  const ev = R.V.step(T, b, { ...inp, ...(R.tow ? { gas: 0, brake: 0, nitro: false } : null), hold: holding, calm: calm() });
  if (R.tow) R.tow.step(b, DT, !holding || b.hold > 0, before);   // (the boat pulls you along the rope)
  if(R.trial && !holding && !b.crashed){
    const event=stepTrial(R.trial,before,{x:b.px,y:b.y,z:b.pz},DT);
    if(event==='finish'){
      const key=trialBestKey(R.def.id+(R.mtb?'-mtb':''),R.trial.race.id),ms=Math.round(R.trial.time*1000),best=store.get(key,null);
      if(!best||ms<best.ms)store.set(key,{ms});
      payCoins(!best||ms<best.ms?50:30);
      showMessage(`FINISHED ${fmt(ms/1000)} · ${!best||ms<best.ms?'NEW BEST!':'Best '+fmt(best.ms/1000)}`,'cp',6000);
      R.audio?.checkpoint(); R.trial=null; updateTrialMarker();
    }else if(event){R.audio?.checkpoint();updateTrialMarker();}
  }
  for (const [k, d] of ev) onEvent(k, d);
  if (T.terrain && !holding) { parkStep(b, before); if (world.wind) windStep(b, now); }
  if (R.mode === 'free' && !holding) {
    if (!b.crashed && !R.finished) payCoins(Math.abs(b.x - xBefore) / 250 + (b.near ? b.near * DT * 0.8 : 0), false);   // (a coin for every 250 m ridden, and for flying low)
    if (b.near > 0.45 && !(R.proxAt > now)) { showMessage('🔥 PROXIMITY', 'cp', 600); R.proxAt = now + 1500; }
    // where to put you back after a crash: somewhere you were riding along on both wheels (not on a jump)
    const g = T.terrain;
    if (!b.crashed && b.wh[0].ct && b.wh[1].ct && b.vx > 3 && now - (R.safeTrail.at(-1)?.t || 0) > 500 && g.inBounds(b.px, b.pz, 60) && !g.hazardAt(b.px, b.pz) && g.rampAt(b.px, b.pz).weight < 0.05 && !g.obstacleAt(b.px, b.pz)) {
      R.safeTrail.push({ x: b.px, z: b.pz, h: Math.PI / 2 - b.h, t: now });
      if (R.safeTrail.length > 24) R.safeTrail.shift();
    }
    if (R.def.look?.corridor && g.trailNearest && !R.lift && !b.crashed) offSlope(b, T);
    if (R.challenge) challengeStep(b, now);
    if (R.run && R.challenge && !R.challenge.done) R.run.step(b, Math.abs(b.x - xBefore));
  }
  if (b.crashed > crashTime()) {
    if(R.mode==='free'){R.trial=null;updateTrialMarker();}
    // in a challenge you go back to where you last were on your wheels (a safe pad could be a shortcut)
    let where;
    if (R.challenge) { const sp = clearOfTrees(T, R.challenge.safe); R.V.place(T, b, { position: [sp.x, sp.z], heading: sp.h }); where = 'where you were'; }
    else if (R.mode === 'free') {
      // free ride: another go at the gap you fell into, else where you were riding a few seconds ago (R and the
      // world edge go to a safe pad)
      const back = R.tow ? R.tow.behind() : R.toPad ? null : R.retry ? { ...R.retry, gap: true } : R.safeTrail.findLast((p) => p.t < now - crashTime() * 1000 - 2500);
      R.V.respawn(T, b, 0, back ? { position: back.position || [back.x, back.z], heading: back.heading ?? back.h } : null);
      where = R.wing ? 'the helicopter' : R.tow ? 'the end of the rope' : back ? (back.gap ? 'the run-in: have another go!' : 'where you were riding') : 'a safe riding pad';
      R.retry = null; R.toPad = false; R.safeTrail.length = 0;
    } else { C.respawn(T, b); where = b.cp >= 0 ? `checkpoint ${b.cp + 1}` : 'the start'; }
    R.prev = snap(b); R.cam.init = false;
    showMessage(`Back to ${where}`, 'small', 1000);
  }
  // stuck (e.g. sitting in a pit): offer to go back
  const sp = Math.hypot(b.vx, b.vy);
  R.stuck = !b.crashed && b.hold <= 0 && now > R.goAt && !R.finished && sp < 0.6 ? R.stuck + DT : 0;
  if (R.stuck > 4 && R.stuck - DT <= 4 && !R.challenge) showMessage(R.mode==='free'?'Press R to return to a safe pad':'Stuck? Press R to go back to the checkpoint', 'small', 2500);
  R.cur = snap(b);
}

/** Where to start again in a gauntlet (a forest of solid trees): if the line straight ahead runs into a tree or rock
    within ~16 m, moved sideways to the nearest clear line (or you'd hit the same tree again). spot: { x, z, h }. */
function clearOfTrees(T, spot) {
  const g = T.terrain;
  if (!g || !g.gauntletIn || !g.gauntletIn(spot.x, spot.z, 10)) return spot;
  const fx = Math.sin(spot.h); const fz = Math.cos(spot.h);
  const blocked = (x, z) => { for (let d = -1.5; d <= 12; d += 0.5) for (const w of [-1, -0.5, 0, 0.5, 1]) if (g.obstacleAt(x + fx * d + fz * w, z + fz * d - fx * w)) return true; return false; };   // (fine steps: a trunk is thin)
  for (const side of [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6, 8, -8, 10, -10, 13, -13]) { const x = spot.x + fz * side; const z = spot.z - fx * side; if (!blocked(x, z)) return { ...spot, x, z }; }
  return spot;
}

/** A ski run with a "corridor" (Twilight Slope): you can ride off into the trees a little way, but not far. Past the
    corridor (metres beyond the run's edge, outside the clearings round the top and the lodge) you're told to head back; a bit further, or still out there after 3 s,
    you're put back on the run beside where you were, facing down it. */
function offSlope(b, T) {
  const lim = R.def.look.corridor; const n = T.terrain.trailNearest(b.px, b.pz);
  const clearing = (R.def.features?.forest?.cuts || []).some(([x, z, r]) => Math.hypot(b.px - x, b.pz - z) < r);   // (the lodge and the top are open ground)
  if (!n || n.distance < lim || clearing) { R.offSlope = 0; return; }
  if (!R.offSlope) showMessage('🌲 Too far from the slope! Head back to the run', 'small', 1600);
  R.offSlope = (R.offSlope || 0) + DT;
  if (n.distance < lim + 14 && R.offSlope < 3) return;
  const k = (n.half - 6) / (n.distance + n.half); const x = n.x + (b.px - n.x) * k; const z = n.z + (b.pz - n.z) * k;
  R.V.place(T, b, { position: [x, z], heading: n.heading });
  R.prev = R.cur = snap(b); R.cam.init = false; R.offSlope = 0; R.safeTrail.length = 0;
  showMessage('Back on the slope', 'small', 1200);
}

function respawnNow() {
  const b = R.bike;
  if (!R.running || R.finished || !b || performance.now() < R.goAt || b.hold > 0) return;
  if (!b.crashed) { b.crashes++; b.crashed = crashTime() + 1; }
  R.toPad = true;
}

const HAZARD_TEXT = {
  lava: ['🔥 TOO HOT! Into the lava', new THREE.Color('#ff7a2a')], water: ['💦 SPLASH!', new THREE.Color('#cfe8ff')],
  ice: ['🥶 SPLASH! That water is freezing', new THREE.Color('#e4f4ff')], chasm: ['😱 DOWN THE CHASM!', null],
  tar: ['🛢️ STUCK IN THE TAR PIT!', new THREE.Color('#3a3530')],
};
function onEvent(k, d) {
  const b = R.bike;
  if(k==='bounds'){R.toPad=true;showMessage('World edge · returning to a safe pad','small',1500);return;}
  if (k === 'hazard') {
    // (the crash event came first; this says what you fell into, and where you'll get another go)
    R.retry = d.retry || null;
    const [text, col] = HAZARD_TEXT[d.kind] || HAZARD_TEXT.water;
    setTimeout(() => showMessage(text, 'bad', 1600), 0);
    burst(b.x, b.y, 30, 'puff', 1.8, col);
    return;
  }
  if (k === 'pad') { showMessage('⚡ BOOST!', 'cp', 700); if (R.audio) R.audio.checkpoint(); return; }
  if (k === 'chute') { showMessage('🪂 PARACHUTE!', 'cp', 1000); return; }   // (Skyvvd)
  if (k === 'landed') { showMessage('LANDED! · Space to fly again', 'cp', 2500); if (R.mode === 'free') payCoins(10); R.audio?.checkpoint(); return; }
  if (k === 'relaunch') { R.V.respawn(R.T, b); R.prev = snap(b); R.cam.init = false; showMessage('Back up in the helicopter', 'small', 1200); return; }
  if (k === 'trick') { trickPop(d); return; }
  if (k === 'bail') { showMessage(`BAILED! ${trickName(d)}`, 'bad', 1400); return; }
  if (k === 'crash') {
    if (R.audio) R.audio.crash();
    R.run?.crash();
    if (!online() && !R.override) R.slow = 0.9;
    R.cam.shake = C.P.CAM_CRASH_SHAKE;
    showMessage(R.chain?.n > 1 && b.t < R.chain.until ? `CRASHED! · COMBO ×${Math.min(5, R.chain.n)} LOST` : 'CRASHED!', 'bad', 1300); R.chain = null;
    burst(b.x, b.y, 26, 'puff', 1.4);
    if (online()) sendPos(true);
  } else if (k === 'land') {
    const strength = Math.min(1.5, d.air * 0.8);
    if (R.audio) R.audio.land(strength);
    R.cam.shake = Math.max(R.cam.shake, Math.min(C.P.CAM_SHAKE_MAX, d.air * C.P.CAM_LAND_SHAKE));
    burst(b.x, b.y - 0.4, Math.round(4 + d.air * 10), 'puff', 0.8 + d.air * 0.3);
    if (d.clean && d.score > 0) {
      // a combo: land trick after trick, each within 5 s of the last, and the points multiply (up to ×5)
      const K = R.chain && b.t < R.chain.until ? R.chain : (R.chain = { n: 0 });   // (riding time: a pause doesn't break it)
      K.n++; K.until = b.t + 5; d.mult = Math.min(5, K.n); d.bonus = d.score * (d.mult - 1);
    }
    if (d.clean && (d.turns || d.spin || d.perfect || d.air > 0.9 || (d.tricks && d.tricks.length))) trick(d);
    if (R.mode === 'free' && d.clean) {
      const pay = (d.turns || 0) * 5 + (d.score || 0) + Math.round((d.bonus || 0) / 2) + (d.air > 2 ? 3 : 0);   // coins for flips, tricks (and combos) and big air
      if (pay) payCoins(pay);
      const ch = R.challenge;
      if (ch && !ch.done && performance.now() > R.goAt) {
        if (ch.def.kind === 'air') ch.score = Math.max(ch.score, d.air);
        if (ch.def.kind === 'flips' && d.turns) ch.score += d.turns;
        if (ch.def.kind === 'tricks' && d.score) ch.score += ch.def.judges ? judge(d) : d.score + (d.bonus || 0);
        if (ch.def.kind === 'tricks' && R.pipeAt && performance.now() - R.pipeAt < 4000) { const p = Math.round(d.air * 25); ch.score += p; R.pipeAt = 0; showMessage(`🛹 PIPE AIR ${d.air.toFixed(1)} S · +${p}`, 'cp', 1200); }   // (air out of the halfpipe scores on its own)
      }
    }
  } else if (k === 'fence') {
    if (R.audio) R.audio.land(0.6);
    R.cam.shake = Math.max(R.cam.shake, 0.25);
    showMessage('STAY ON THE TRACK!', 'bad', 900);
  } else if (k === 'cp') {
    if (R.audio) R.audio.checkpoint();
    const t = b.t;
    let extra = '';
    if (R.best && R.best.splits && R.best.splits[d] != null) {
      const diff = t - R.best.splits[d];
      extra = (diff <= 0 ? '−' : '+') + Math.abs(diff).toFixed(2);
      $('#hud-split').className = 'mx-split ' + (diff <= 0 ? 'good' : 'bad');
      $('#hud-split').textContent = extra;
      setTimeout(() => { $('#hud-split').textContent = ''; }, 2500);
    }
    R.splits[d] = t;
    showMessage(`CHECKPOINT ${d + 1}`, 'cp', 1100);
  } else if (k === 'finish') {
    R.finished = true;
    if (R.audio) R.audio.checkpoint();
    if (R.mode === 'solo') soloFinish(d); else onlineFinish(d);
  }
}

function trick(d) {
  const names = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];
  const flip = d.turns ? `${names[d.turns] || d.turns + '× '}${d.back ? 'BACKFLIP' : 'FRONTFLIP'}` : '';
  const moves = (d.tricks || []).map(trickName);
  const all = [d.spin ? String(d.spin * 180) : '', ...moves, flip].filter(Boolean);
  const title = all.length ? all.join(' + ') : d.perfect ? 'PERFECT LANDING' : 'CLEAN LANDING';
  const sub = (d.score ? `${d.score} PTS` : '') + (d.mult > 1 ? ` · COMBO ×${d.mult} +${d.bonus}` : '') + (R.mtb || R.tow ? '' : `${d.score ? ' · ' : ''}+${Math.round(d.gain * 100)}% NITRO`) + (all.length && d.perfect ? ' · PERFECT' : '');   // (no nitro on a bicycle or a wakeboard)
  const el = $('#hud-trick');
  fill(el, h('b', {}, title), h('small', {}, sub));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1600);
  if ((d.turns || d.spin || moves.length) && R.audio) R.audio.trick();
}
/** A trick held long enough in the air: a little pop-up while you're still flying. */
function trickPop(i) {
  const el = $('#hud-trick');
  fill(el, h('b', {}, trickName(i)), h('small', {}, 'land it!'));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1100);
}
function showCount(n) {
  const el = h('div', { class: 'mx-count' + (n === 'GO!' ? ' go' : '') }, String(n));
  fill($('#hud-center'), el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 900);
}
let msgTimer = null;
function showMessage(text, kind, ms) {
  const el = $('#hud-msg');
  el.className = 'mx-msg on ' + (kind || '');
  el.textContent = text;
  clearTimeout(msgTimer); msgTimer = setTimeout(() => { el.className = 'mx-msg'; }, ms || 1200);
}

// ------------------------------------------------------------------ drawing a frame
const tmpV = new THREE.Vector3(); const tmpV2 = new THREE.Vector3(); const tmpV3 = new THREE.Vector3(); const headV = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
/** Turns a snapshot's upright-plane coordinates (x = odometer, y = height) into the world. */
function placer(sn) {
  const c = Math.cos(sn.h); const n = Math.sin(sn.h);
  return (x, y, out) => out.set(sn.px + c * (x - sn.x), y, sn.pz + n * (x - sn.x));
}
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const disposeModel = (m) => { if (m.flyer) disposeBike(m.flyer); return m.car ? disposeCar(m) : disposeBike(m); };
/** Skyvvd's wingsuit with a real rider in it: your Unrevvd rider in the model's T-pose (arms out, legs straight), lying
    face down between the wings (the code-built flyer's body hidden). color: the suit; ghost: a see-through ghost's. */
function makeWingsuit(color, ghost = null) {
  const m = makeCar('wing', color || '#ff4fa3', ghost);
  const r = makeBike({ ...mtbLook(), ...(ghost ? { ghost } : {}) }); const fig = r.rider; if (!fig) return m;
  fig.removeFromParent(); fig.position.set(0, 0, 0); fig.rotation.set(0, 0, 0); fig.scale.setScalar(fig.scale.x);
  fig.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.pose(); o.frustumCulled = false; } });
  const holder = new THREE.Group(); holder.add(fig); holder.rotation.z = -Math.PI / 2; holder.position.set(WING_FIT.x, WING_FIT.y, 0); holder.rotation.y = WING_FIT.turn;   // (head forward, face down)
  m.body.add(holder); for (const p of m.man || []) p.visible = false;
  m.flyer = r; return m;
}
const WING_FIT = { x: -1.0, y: 0.12, turn: 0 };
function render(now, dt, alpha) {
  const w = world; const b = R.bike;
  const s = mix(R.prev, R.cur, alpha);
  const place = placer(s);
  const speed = Math.hypot(b.vx, b.vy);
  if (R.car) poseCar(R.model, s);
  else {
  // lean into turns like a real bike: tan(lean) = sideways acceleration / gravity
  const want = b.crashed || !(b.wh[0].ct || b.wh[1].ct) ? 0 : Math.atan(b.vx * b.yaw / C.P.G);
  R.roll += (clampN(want, -0.85, 0.85) - R.roll) * (1 - Math.exp(-dt * 8));
  s.roll = R.roll;
  // the front wheel steers (shown a bit more than the physics' small angle at speed, so you can see it)
  const lock = C.P.STEER / (1 + Math.abs(b.vx) * C.P.STEER_FALL);
  const steerTo = b.crashed ? 0 : (b.wh[0].ct || b.wh[1].ct) ? b.steer * Math.min(0.55, lock * 1.5 + 0.12) : b.steer * 0.25;
  R.steerVis = (R.steerVis || 0) + (steerTo - (R.steerVis || 0)) * (1 - Math.exp(-dt * 12));
  s.st = R.steerVis;
  poseBike(R.model, s, place, s.h, now / 1000);
  leaveTracks('me', R.model, b.crashed); settle(R.model, b.crashed, dt, speed);
  if (R.model.board) { const deep = R.T.mtb?.powder && world.ground.surfaceAt(b.px, b.pz).kind === 'snow'; R.model.sink = (R.model.sink || 0) + ((deep ? 0.1 : 0) - (R.model.sink || 0)) * (1 - Math.exp(-dt * 4)); }   // (sunk into deep powder)
  }
  R.model.root.visible = !R.spectate;
  if (!R.spectate && now > R.goAt) R.rec.add(now / 1000, s);   // (for the replay)
  // gates drop at GO
  if (R.gateDown) for (const gg of w.gates) gg.rotation.z = Math.min(Math.PI / 2 * 0.95, gg.rotation.z + dt * 7);
  // other riders
  const leader = drawOthers(now, dt);
  drawGhosts(now, dt); drawTagMarker(now); drawRelayLanterns(now);
  const A = R.challenge?.aval;
  if (A) {
    A.vis.update(A.front, dt);
    if (A.gap < 70) { R.cam.shake = Math.max(R.cam.shake, (1 - A.gap / 70) * 0.5); if (now > A.rumbleAt) { A.rumbleAt = now + 2500; R.audio?.thunder?.(Math.min(1, A.gap / 80)); } }
  }
  if (R.run && R.audio && !R.finished) R.audio.heartbeat(R.run.danger);
  // dust, roost and smoke
  if (!R.spectate) effects(s, dt, place);
  const watched = R.spectate ? watching(leader) : null;
  if (watched) updateCamera(watched.snap, dt, watched.snap.v || 20, watched.place, watched.model);
  else updateCamera(s, dt, speed, place);
  if (w.free) {
    // (the detailed ground is centred up to 30 m ahead of a fast bike)
    const lead = Math.min(30, Math.max(0, b.vx) * 0.7), p = R.model.root.position;
    w.update(p, dt, camera, aheadV.set(p.x + Math.cos(s.h) * lead, p.y, p.z + Math.sin(s.h) * lead));
    if (w.lamp) {
      // at night: the lamp on the bars shines where the bike points (and dips with it)
      const ca = Math.cos(s.a), L = w.lamp;
      L.spot.position.set(p.x + Math.cos(s.h) * 0.7, p.y + 1.25 + Math.sin(s.a) * 0.7, p.z + Math.sin(s.h) * 0.7);
      L.spot.target.position.set(L.spot.position.x + Math.cos(s.h) * ca * 24, L.spot.position.y + Math.sin(s.a) * 24 - 4, L.spot.position.z + Math.sin(s.h) * ca * 24);
      L.glow.position.set(p.x - Math.cos(s.h) * 0.2, p.y + 2.1, p.z - Math.sin(s.h) * 0.2);
    }
  } else w.update(R.model.root.position, dt, camera);
  R.tow?.update(R.model, performance.now());
  if (R.audio) {
    R.audio.update(b, dt, { scrub: b.scrub, surface: b.G ? C.surfaceAt(b.G, b.x) : 0 });
    if (online()) R.audio.others(otherSounds(b));
  }
  // gold coins (free ride and challenges)
  if (w.collect && !R.spectate && !b.crashed) { const got = w.collect(b.px, b.y, b.pz, performance.now(), () => showMessage('⭕ THROUGH THE HOOP! +15', 'cp', 1200)); if (got) { payCoins(got); Sfx.play('coin'); } }
  renderer.render(w.scene, camera);
  if (now - R.hudAt > 60) { R.hudAt = now; hud(now); }
  if (online() && now - R.sentAt > 80) sendPos(false);
}

// ------------------------------------------------------------------ parks: rails and boxes, the halfpipe, chairlifts
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Every physics step in an open world: slide along rails and boxes, turn round in the air out of a halfpipe wall,
    and take a chairlift. before: where the bike was at the start of the step. */
function parkStep(b, before) {
  const g = R.T.terrain; const onGround = b.wh[0].ct || b.wh[1].ct;
  // a rail or box: once you're on top of one it lines you up and you slide along it; it scores when you come off
  const rail = !b.crashed && onGround && g.railAt ? g.railAt(b.px, b.pz) : null;
  if (rail && rail.y > g.heightAt(b.px, b.pz) + 0.25) {
    const f = rail.park; let hr = Math.PI / 2 - f.heading; if (Math.abs(wrapA(b.h - hr)) > Math.PI / 2) hr += Math.PI;
    if (Math.abs(wrapA(b.h - hr)) < 0.7) {
      b.h += wrapA(hr - b.h) * 0.25;
      const off = rail.c - rail.item.c; b.px -= off * 0.3 * f.c; b.pz += off * 0.3 * f.s;   // (slide back to the middle of it)
      if (!R.grind || R.grind.item !== rail.item) { finishGrind(); R.grind = { item: rail.item, m: 0 }; }
      R.grind.m += Math.hypot(b.px - before.x, b.pz - before.z);
    }
  } else if (R.grind && (onGround || b.crashed || !rail)) finishGrind(b.crashed);
  // a halfpipe: going up a wall fast enough to leave the lip, you turn round in the air and come back down it
  if (!b.crashed && !onGround && R.wasGround && g.parkList) {
    for (const f of g.parkList) {
      if (f.park !== 'halfpipe') continue;
      const dx = b.px - f.x; const dz = b.pz - f.z; const a = dx * f.s + dz * f.c; const c = dx * f.c - dz * f.s;
      if (a < 8 || a > f.len - 8 || Math.abs(c) < 7 || Math.abs(c) > 14.5 || b.vy < 2) continue;
      const hu = Math.atan2(f.c, f.s);   // (the pipe's direction, as a heading)
      const turn = wrapA(2 * hu - 2 * b.h);   // (the way you're going, mirrored across the pipe)
      R.pipe = { t: 0, T: Math.max(0.45, 2 * b.vy / C.P.G), turn, a0: b.a }; R.pipeAt = performance.now();
      break;
    }
  }
  if (R.pipe) {
    const P = R.pipe;
    if (onGround || b.crashed) R.pipe = null;
    else { P.t += DT; if (P.t <= P.T) { b.h += P.turn * DT / P.T; b.w = -2 * P.a0 / P.T; } }
  }
  R.wasGround = onGround;
  // a chairlift: ride slowly into the bottom station (Carvvd, on your own)
  if (R.board && R.mode === 'free' && !online() && !b.crashed && world.parks) for (const L of world.parks.lifts) {
    if (Math.hypot(b.px - L.bottom[0], b.pz - L.bottom[1]) < 12 && Math.hypot(b.vx, b.vy) < 12 && !(R.liftOff > performance.now())) { startLift(L); break; }
  }
}
/** A blizzard's wind: a headwind holds you back, a tailwind helps, and gusts from the side push you off your line. */
function windStep(b, now) {
  const W = world.wind; if (b.crashed || !(b.wh[0].ct || b.wh[1].ct) || Math.abs(b.vx) < 1) return;
  const c = Math.cos(b.h); const sn = Math.sin(b.h); const gust = 0.6 + 0.4 * Math.sin(now / 1000 * 0.7) + 0.3 * Math.sin(now / 1000 * 2.3);
  const dv = DT * (c * W.x + sn * W.z) * 1.3 * gust; b.vx += dv; for (const w of b.wh) w.vx += dv;
  b.h += DT * (c * W.z - sn * W.x) * 0.05 * gust;
}
/** Coming off a rail or box: what the slide was worth. */
function finishGrind(fell) {
  const G = R.grind; R.grind = null;
  if (!G || fell || G.m < 1.5) return;
  const name = R.skate ? (G.item.rail ? '50-50 GRIND' : 'BOARDSLIDE') : G.item.rail ? (R.board ? 'BOARDSLIDE' : 'RAIL RIDE') : (R.board ? '50-50' : 'BOX RIDE');
  const pts = Math.round(15 + G.m * 5);
  const el = $('#hud-trick'); fill(el, h('b', {}, name), h('small', {}, `${pts} PTS · ${G.m.toFixed(1)} M`));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1600);
  R.audio?.trick();
  if (R.mode === 'free') payCoins(Math.round(pts / 10));
  const ch = R.challenge; if (ch && !ch.done && ch.def.kind === 'tricks') ch.score += pts;
}
/** Riding a chairlift: sat on a chair up the line (hold W to hurry it along, Esc to hop off), then off at the top. */
function startLift(L) {
  R.lift = { L, d: 6 }; R.grind = null; R.pipe = null;
  for (const k of Object.keys(keys)) keys[k] = false;
  showMessage(`🚡 ${L.name} · hold W to hurry · R hops off`, 'small', 3000);
}
function liftFrame(now, dt) {
  const { L } = R.lift; const m = R.model;
  R.lift.d += dt * (keys.KeyW || keys.ArrowUp || touch.gas ? 70 : 22);
  if (R.lift.d >= L.len - 4 || keys.KeyR) { endLift(); return; }
  const seat = L.seat(R.lift.d);
  seatRider(m, seat, L.heading);
  const back = tmpV.set(Math.sin(L.heading), 0, Math.cos(L.heading));
  camera.position.set(seat.x - back.x * 6.5 + back.z * 2.5, seat.y + 2.2, seat.z - back.z * 6.5 - back.x * 2.5);
  camera.lookAt(seat.x, seat.y + 0.5, seat.z);
  L.mine = true; L.chairs[0].position.copy(L.line(R.lift.d, 1)); L.chairs[0].rotation.y = L.heading;   // (one of the chairs is yours)
  world.update(m.root.position, dt, camera);
  renderer.render(world.scene, camera);
  if (now - R.hudAt > 200) { R.hudAt = now; hud(now); }
}
function endLift() {
  const { L } = R.lift; R.lift = null; R.liftOff = performance.now() + 4000; L.mine = false;
  R.V.respawn(R.T, R.bike, 0, { position: L.exit.position, heading: L.exit.heading });
  R.bike.hold = 0; R.prev = R.cur = snap(R.bike); R.cam.init = false; R.safeTrail = []; R.last = performance.now();
  showMessage('🏔️ Off you go!', 'small', 1500);
}

// ------------------------------------------------------------------ photo mode and replays (studio.js)
/** A frame while photo mode or a replay is on: the ride stands still; a replay draws your recorded run instead. */
function studioFrame(now, dt) {
  if (studio.replay && !studio.photo) {
    const s = studio.replayStep(dt, mix); const place = placer(s);
    if (R.car) poseCar(R.model, s); else poseBike(R.model, s, place, s.h, now / 1000);
    R.model.root.visible = true;
    const p = R.model.root.position;
    studio.replayCamera(p, s.h, s.v || 0, dt);
    world.update(p, dt, camera);
  } else studio.photoCamera(dt);
  renderer.render(world.scene, camera);
}
const studioOk = () => R.running && world && R.model && !online() && performance.now() > R.goAt && !map.isOpen;
function startPhoto() {
  if (!studioOk()) { if (online()) showMessage('Photo mode is for riding on your own', 'small', 1500); return; }
  for (const k of Object.keys(keys)) keys[k] = false;
  studio.startPhoto(world.scene, R.model, { fov: camera.fov });
}
function startReplay() {
  if (!studioOk()) { if (online()) showMessage('Replays are for riding on your own', 'small', 1500); return; }
  for (const k of Object.keys(keys)) keys[k] = false;
  if (!studio.startReplay(R.rec.take())) showMessage('Ride for a bit first, then watch it back', 'small', 1600);
}

/** The ground height under a point in the world (near the track). */
function groundUnder(x, z, hint, T = R.T) { if(T.terrain)return T.terrain.heightAt(x,z); const L = C.locate(T, x, z, hint); return C.heightAt(T, L.s, L.u); }

/** The dark edges at speed in first person (0..1). */
const fxSpeedEl = document.getElementById('fx-speed'); let fxSpeedNow = -1;
/** The helmet cam's look over first person ('' none; see Coins.CAMS). */
const fxHelmetEl = document.getElementById('fx-helmet'); let fxHelmetNow = null;
function fxHelmet(k) { if (k !== fxHelmetNow) { fxHelmetNow = k; if (fxHelmetEl) fxHelmetEl.className = 'fx-helmet' + (k ? ' ' + k : ''); } }
function fxSpeed(v) { v = Math.round(v * 20) / 20; if (v !== fxSpeedNow) { fxSpeedNow = v; if (fxSpeedEl) fxSpeedEl.style.opacity = v; } }
const firstV = new THREE.Vector3(); const firstD = new THREE.Vector3(); const firstU = new THREE.Vector3(); const firstGrip = new THREE.Vector3();
/** In first person the rider's own head is hidden (the camera is where it is). */
function firstHead(m, hide) {
  const head = m?.fig ? m.fig.bones.CC_Base_Head : m?.parts?.helmet;
  if (!head) return;
  if (m.fig) head.scale.setScalar(hide ? 0.001 : 1); else head.visible = !hide;
}
function updateCamera(s, dt, speed, place, model = R.model) {
  const cam = R.cam;
  // swing round behind the way the bike points, like a 3D racing game (smoothly, so steering isn't jerky)
  cam.h = cam.init ? lerpA(cam.h, s.h, 1 - Math.exp(-dt * C.P.CAM_HEADING)) : s.h;
  const heading = cam.h;
  const D = tmpV.set(Math.cos(heading), 0, Math.sin(heading));
  const Rt = tmpV2.set(-Math.sin(heading), 0, Math.cos(heading));
  const rag = s.crashed && s.ragdoll;
  const P = place(rag ? s.ragdoll.hip.x : s.x, rag ? s.ragdoll.hip.y : s.y, tmpV3);
  const air = R.wing ? 0 : Math.max(0, P.y - groundUnder(P.x, P.z, s.s) - 0.7);   // (a wingsuit is always high up: the camera stays close behind it)
  let want; let look; let fov = C.P.CAM_FOV + Math.min(C.P.CAM_FOV_RANGE, speed * C.P.CAM_SPEED_FOV) + (camera.aspect < 1 ? 18 : 0);   // (a tall phone screen needs a wider view)
  const first = R.camMode === 'first' && !R.car && !s.crashed && (!R.spectate || (model && model !== R.model));   // (watching someone: from their eyes)
  // (the head stays hidden while a crash's camera flies out of it, or you'd see the inside of the helmet)
  const flyOut = R.camMode === 'first' && s.crashed && model?.fig ? model.fig.bones.CC_Base_Head.getWorldPosition(headV).distanceTo(camera.position) : Infinity;
  const inHead = first || flyOut < 1.2;
  if (R.headless && R.headless !== model) firstHead(R.headless, false);
  firstHead(model, inHead); R.headless = inHead ? model : null;
  if (first) {
    // first person: where a rider's eyes would be, behind and above the hands on the bar (so the bar and your hands are
    // at the bottom of the view, whatever the speed), looking ahead the way the bike points. Everything is measured in
    // the bike's own frame (its forward and up), so in a flip the view turns over with the bike instead of staying level
    // and looking into the rider's body
    const m = model; const ca = Math.cos(s.a); const sa = Math.sin(s.a); m.root.updateMatrixWorld(true);
    firstD.set(Math.cos(s.h) * ca, sa, Math.sin(s.h) * ca);
    firstU.set(-Math.cos(s.h) * sa, ca, -Math.sin(s.h) * sa);
    const B = m.fig && m.fig.bones;
    // (the hands on the bar, kept relative to the bike: a trick that lets go of the bar doesn't take the camera with it)
    if (m.board) m.root.getWorldPosition(firstV).addScaledVector(firstU, 0.85).addScaledVector(firstD, 0.4);   // (a snowboard: eyes over the board)
    else if (B && B.CC_Base_L_Hand && B.CC_Base_R_Hand) {
      if (!(s.tp > 0) || !firstGrip.ok) { B.CC_Base_L_Hand.getWorldPosition(firstV); B.CC_Base_R_Hand.getWorldPosition(tmpV); m.root.worldToLocal(firstV.add(tmpV).multiplyScalar(0.5)); firstGrip.copy(firstV); firstGrip.ok = true; }
      m.root.localToWorld(firstV.copy(firstGrip));
    } else m.parts.helmet.getWorldPosition(firstV).addScaledVector(firstD, 0.45).addScaledVector(firstU, -0.6);
    camera.position.copy(firstV).addScaledVector(firstD, m.board ? 0 : -0.4).addScaledVector(firstU, m.board ? 0.5 : 0.7);
    // (leaning right forward, as in a frontflip, brings the shoulders over the bar, in front of the camera: move up with
    // them. Riding normally the neck is about 0.25 m ahead, inside the near plane)
    if (B && B.CC_Base_NeckTwist01 && !m.board) {
      const ahead = B.CC_Base_NeckTwist01.getWorldPosition(tmpV).sub(camera.position).dot(firstD) - 0.28;
      if (ahead > 0) camera.position.addScaledVector(firstD, ahead);
    }
    firstD.multiplyScalar(10).add(camera.position).addScaledVector(firstU, -4);
    if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt * 1.6); camera.position.y += (Math.random() - 0.5) * cam.shake * 0.3; }
    // the faster you go, the more the bars shake under you (on the ground), and the edges of the view darken
    const kmh = speed * 3.6; const rough = Math.max(0, kmh - 12) * 0.0009; const tt = performance.now() / 1000;
    if (rough > 0 && !(R.bike && R.bike.air > 0.15)) camera.position.addScaledVector(firstU, (Math.sin(tt * 31) + Math.sin(tt * 47.3) * 0.6) * rough).addScaledVector(tmpV.crossVectors(firstD, firstU).normalize(), Math.sin(tt * 23.7) * rough * 0.6);
    fxSpeed(Math.min(0.85, Math.max(0, (kmh - 22) / 30)));
    fxHelmet(R.mtb && R.helmet ? R.helmet.cam : '');
    camera.up.copy(firstU); camera.lookAt(firstD);
    const f = 84 + (camera.aspect < 1 ? 18 : 0) + (R.mtb && R.helmet ? R.helmet.fov : 0);   // (an action cam is wider)   // (the same at any speed: a wider view at speed pushed the bar out of the bottom when slow)
    // (the near plane cuts away your own shoulders and back, just in front of the camera: the hands are further)
    if (Math.abs(camera.fov - f) > 0.05 || camera.near !== 0.62) { camera.fov += (f - camera.fov) * Math.min(1, dt * 4); camera.near = 0.62; camera.updateProjectionMatrix(); }
    // (a crash, or switching camera, flies smoothly out from here to behind the bike)
    cam.pos.copy(camera.position); cam.look.copy(firstD); cam.fov = camera.fov; cam.h = s.h; cam.init = true;
    return;
  }
  fxSpeed(0); fxHelmet('');
  const near = flyOut < 2 ? 0.62 : 0.25;   // (still close to the rider: don't show the inside of their jacket)
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  camera.up.set(0, 1, 0);   // (first person tilts it with the bike)
  if (R.camMode === 'side') {
    want = P.clone().addScaledVector(Rt, 10.5 + air * 0.5).addScaledVector(D, 2).add(UPV.clone().multiplyScalar(1.8 + air * 0.25));
    look = P.clone().addScaledVector(D, 3).add(UPV.clone().multiplyScalar(0.6));
    fov -= 6;
  } else if (R.camMode === 'close') {
    want = P.clone().addScaledVector(D, -4.2).add(UPV.clone().multiplyScalar(1.7 + air * 0.25));
    look = P.clone().addScaledVector(D, 5).add(UPV.clone().multiplyScalar(0.9));
  } else {
    // Cork7-style chase: behind and above, looking ahead
    const far = R.car ? 2 : 1;   // (the car is longer and wider: sit further back and higher)
    want = P.clone().addScaledVector(D, -5 * far).add(UPV.clone().multiplyScalar((2.0 + air * 0.3) * (R.car ? 1.6 : 1)));
    look = P.clone().addScaledVector(D, 5 * far).add(UPV.clone().multiplyScalar(1.0 + air * 0.2));
  }
  // keep the camera out of the ground
  want.y = Math.max(want.y, groundUnder(want.x, want.z, s.s) + 1.1);
  if (!cam.init) { cam.pos.copy(want); cam.look.copy(look); cam.fov = fov; cam.init = true; }
  const kPos = 1 - Math.exp(-dt * (R.camMode === 'side' ? 6 : C.P.CAM_FOLLOW));
  const kLook = 1 - Math.exp(-dt * C.P.CAM_LOOK);
  cam.pos.lerp(want, kPos); cam.look.lerp(look, kLook);
  cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * C.P.CAM_FOV_RATE));
  camera.position.copy(cam.pos);
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * 1.6);
    camera.position.x += (Math.random() - 0.5) * cam.shake * 0.5; camera.position.y += (Math.random() - 0.5) * cam.shake * 0.5;
  }
  camera.lookAt(cam.look);
  if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
}

/** Tracks on the ground (tracks.js): a board's groove in the snow, a pair of skis' two, tyre tracks in the mud, sand,
    dirt, grass and snow. In a room each rider's grooves are tinted their colour. */
const trackP = new THREE.Vector3(); const trackAx = new THREE.Vector3();
function leaveTracks(id, model, crashed, color = online() && id === 'me' ? playerOf(Net.id).color : null) {
  if (model.jetski || model.wakes) {   // (a jet ski or a wakeboard leaves a wake of foam on the water instead)
    const o = world.ocean; if (!o) return;
    const p = model.root.localToWorld(trackP.set(model.jetski ? -1.3 : -0.6, 0, 0)); trackAx.setFromMatrixColumn(model.root.matrixWorld, 0);
    const last = model.wakeAt; const now = performance.now(); const v = last ? Math.hypot(p.x - last.x, p.z - last.z) / Math.max(0.001, (now - last.t) / 1000) : 0;
    model.wakeAt = { x: p.x, z: p.z, t: now };
    if (!crashed && p.y - world.ground.waveAt(p.x, p.z) < 0.7 && v > 1.5) o.wake(id, p.x, p.z, Math.atan2(trackAx.z, trackAx.x), Math.min(40, v));
    return;
  }
  const T = R.tracks; if (!T || !model.root.visible) return;
  const g = world.ground;
  trackAx.setFromMatrixColumn(model.root.matrixWorld, 0); const l = Math.hypot(trackAx.x, trackAx.z) || 1; const ax = trackAx.x / l; const az = trackAx.z / l;
  if (model.board) {
    const p = model.board.getWorldPosition(trackP);
    const on = !crashed && p.y - g.heightAt(p.x, p.z) < 0.25;
    if (model.skis) T.skis(id, p.x, p.z, ax, az, on, color); else T.groove(id, p.x, p.z, ax, az, on, color);
  } else if (model.car) {
    for (const side of [-1, 1]) {
      const p = model.root.localToWorld(trackP.set(-1.35, 0, side * 0.82));
      T.tyre(id + side, p.x, p.z, ax, az, !crashed && model.root.position.y - g.heightAt(p.x, p.z) < 1.4, 0.3);
    }
  } else if (model.rearWheel) {
    const p = model.rearWheel.getWorldPosition(trackP);
    T.tyre(id, p.x, p.z, ax, az, !crashed && p.y - 0.36 - g.heightAt(p.x, p.z) < 0.15, model.pedal ? 0.1 : 0.2);
  }
}
/** Snow settles on the riders where it's snowing (a crash knocks it off), and mud splashes up when they ride through it
    (it stays on). */
function coverOn(model) { if (world && world.free && !model.car && !model.cover) model.cover = coverModel(model.board ? [model.rider, model.board] : [model.root]); }
function settle(model, crashed, dt, speed) {
  const c = model.cover; if (!c) return;
  const p = model.root.position; c.ground = world.ground.heightAt(p.x, p.z);
  if (world.snowing) c.snow += crashed ? -dt * 1.5 : dt / 150;
  if (speed > 2 && !crashed && world.ground.surfaceAt(p.x, p.z).kind === 'mud') c.mud += dt / 40 * Math.min(1.5, speed / 8);
}
function dropTrails() { if (R.tracks) { R.tracks.dispose(); R.tracks = null; } }

/** Dust, roost, mud and snow from the wheels; a puff of exhaust smoke now and then. */
function effects(s, dt, place) {
  const b = R.bike; const w = world; const fx = w.fx; const th = w.theme;
  R.emitAcc += dt;
  if (R.emitAcc < 1 / 60) return;
  const step = R.emitAcc; R.emitAcc = 0;
  const D = [Math.cos(s.h), Math.sin(s.h)];
  const speed = Math.hypot(b.vx, b.vy);
  const surface = b.G ? C.surfaceAt(b.G, b.x) : 0;
  const colPuff = R.water ? SPRAY : surface === 1 ? fx.colors.mud : fx.colors.puff;
  const colChunk = R.water ? SPRAY : surface === 1 ? fx.colors.mud : fx.colors.chunk;
  const rear = b.wh[1];
  const emitAt = (x, y, n, kind, power, side0 = 0) => {
    const p = place(x, y, tmpV3);
    for (let i = 0; i < n; i++) {
      const back = -(2 + Math.random() * 5) * power; const up = (0.8 + Math.random() * 3) * power; const side = (Math.random() - 0.5) * 2.4 * power + side0;
      const vx = D[0] * back - D[1] * side; const vz = D[1] * back + D[0] * side;
      if (kind === 'chunk') fx.chunk(p.x, p.y, p.z, vx, up, vz, { life: 0.6 + Math.random() * 0.4, size: 0.09 + Math.random() * 0.08, grow: 0.08, alpha: 0.95, grav: 9.8, drag: 0.4, color: colChunk });
      else fx.puff(p.x, p.y + 0.1, p.z, vx * 0.35, up * 0.3, vz * 0.35, { life: 1 + Math.random() * 0.8, size: 0.6 + Math.random() * 0.5, grow: 2.6 + Math.random() * 2 + (th.snowing ? 1 : 0), alpha: th.snowing ? 0.5 : 0.32, drag: 1.3, color: colPuff });
    }
  };
  // a jet ski: a rooster tail of spray from the jet, more with the throttle and speed, and a sheet of it thrown out from
  // the hull in a hard turn (to the outside)
  if ((R.water || R.sled) && !b.crashed && rear.ct) {
    const SPRAY = R.sled ? SNOW_SPRAY : SPRAY_W;
    const jet = R.model.root.localToWorld(R.sled ? tmpV3.set(-1.2, -0.5, 0) : tmpV3.set(-1.55, -0.3, 0));
    const tail = Math.min(1.4, b.thr * (0.35 + speed * 0.035)); const n = Math.floor(tail * 5 * step * 60 + Math.random());
    for (let i = 0; i < n; i++) {
      const back = -(3 + Math.random() * 4) * (0.5 + tail * 0.5); const up = 2.5 + Math.random() * 3.5 * tail; const side = (Math.random() - 0.5) * 1.6;
      fx.chunk(jet.x, jet.y, jet.z, D[0] * back - D[1] * side, up, D[1] * back + D[0] * side, { life: 0.7 + Math.random() * 0.5, size: 0.06 + Math.random() * 0.07, grow: 0.12, alpha: 0.85, grav: 9.8, drag: 0.5, color: SPRAY });
    }
    if (tail > 0.25 && Math.random() < tail * 0.5) fx.puff(jet.x, jet.y + 0.2, jet.z, -D[0] * 2, 1.2, -D[1] * 2, { life: 1.1, size: 0.5, grow: 2.2, alpha: 0.28, drag: 1.4, color: SPRAY });   // (mist)
    const carve = Math.min(1.5, Math.abs(b.yaw || 0) * speed * 0.07); const out = -Math.sign(b.yaw || 0);
    if (carve > 0.2) {
      const bow = R.model.root.localToWorld(tmpV.set(0.2, -0.4, 0)); const m2 = Math.floor(carve * 5 * step * 60 + Math.random());
      for (let i = 0; i < m2; i++) { const sd = (2 + Math.random() * 3) * out * carve; const up = 1.5 + Math.random() * 2.5 * carve;
        fx.chunk(bow.x, bow.y, bow.z, D[0] * -1 - D[1] * sd, up, D[1] * -1 + D[0] * sd, { life: 0.5 + Math.random() * 0.4, size: 0.05 + Math.random() * 0.06, grow: 0.1, alpha: 0.85, grav: 9.8, drag: 0.6, color: SPRAY }); }
    }
  }
  if (!b.crashed && rear.ct && !R.board && !R.water && !R.sled && !R.skate) {   // (a board has no back wheel to spin; a jet ski's spray is above)
    const slip = Math.max(0, rear.slip - 0.4);
    const roost = Math.min(1.6, slip * 0.25 + b.thr * speed * 0.012);
    const n = Math.floor(roost * 6 * step * 60 / 3 + Math.random());
    const cx = rear.x - rear.nx * 0.33; const cy = rear.y - rear.ny * 0.33;
    if (n) emitAt(cx, cy, n, 'chunk', 0.6 + roost * 0.6);
    if (Math.random() < Math.min(1, roost * 0.9 + speed * 0.012)) emitAt(cx, cy, 1, 'puff', 0.7);
  }
  // a snowboard: powder thrown out from its edge in a hard carve (to the outside of the turn), more the faster you go
  if (R.board && !b.crashed && rear.ct) {
    const deep = R.T.mtb?.powder && world.ground.surfaceAt(b.px, b.pz).kind === 'snow';   // (powder: twice the spray)
    const amt = Math.min(1.5, Math.abs(R.roll) * speed * (deep ? 0.14 : 0.08)); const out = -Math.sign(R.roll);
    if (amt > 0.2) {
      const p = place(rear.x - rear.nx * 0.3, rear.y - rear.ny * 0.3, tmpV3); const n = Math.floor(amt * 4 * step * 60 + Math.random());
      for (let i = 0; i < n; i++) {
        const side = (1.5 + Math.random() * 3) * out * amt; const back = -(1 + Math.random() * 2.5); const up = 1.2 + Math.random() * 2.2 * amt;
        fx.chunk(p.x, p.y, p.z, D[0] * back - D[1] * side, up, D[1] * back + D[0] * side, { life: 0.45 + Math.random() * 0.4, size: 0.04 + Math.random() * 0.06, grow: 0.06, alpha: 0.95, grav: 9.8, drag: 0.7, color: colChunk });
      }
      if (amt > 0.35 && Math.random() < amt * 0.4 * step * 60) fx.puff(p.x, p.y + 0.1, p.z, -D[1] * out * 2 * amt - D[0], 0.4 + amt * 0.4, D[0] * out * 2 * amt - D[1], { life: 0.7 + Math.random() * 0.5, size: 0.3, grow: 1.4 + amt, alpha: 0.32, drag: 1.6, color: colPuff });
    }
  }
  // sliding wide in a turn sprays dirt to the outside
  if (b.scrub > 0.15) emitAt(rear.x, rear.y - 0.33, 1 + Math.floor(b.scrub * 4), 'chunk', 1.1, -Math.sign(b.yaw) * 4);
  if (!b.crashed && b.wh[0].ct && b.brk > 0.5 && speed > 4) emitAt(b.wh[0].x, b.wh[0].y - 0.33, 1, 'puff', 0.5);
  if (b.crashed && speed > 2 && Math.random() < 0.5) emitAt(b.x, b.y - 0.3, 2, 'puff', 0.8);
  // exhaust (not on a bicycle)
  if (!R.mtb && !R.wing && !R.skate && Math.random() < 0.18 + b.thr * 0.3) {
    const ex = R.model.root.localToWorld(R.car ? tmpV.set(-2.36, -0.32, Math.random() < 0.5 ? -0.24 : 0.24) : tmpV.set(-0.82, 0.4, 0.17));
    fx.puff(ex.x, ex.y, ex.z, -D[0] * 0.6, 0.25, -D[1] * 0.6, { life: 0.8, size: 0.12, grow: 0.7, alpha: b.boost ? 0 : 0.12, drag: 1, color: fx.colors.smoke });
  }
}
function burst(x, y, n, kind, power, color = null) {
  const w = world; if (!w || !R.cur) return;
  const p = placer(R.cur)(x, y, new THREE.Vector3());
  const col = color || (R.bike.G && C.surfaceAt(R.bike.G, x) === 1 ? w.fx.colors.mud : w.fx.colors.puff);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2; const sp = (1 + Math.random() * 3) * power;
    w.fx.puff(p.x, p.y, p.z, Math.cos(a) * sp, 0.6 + Math.random() * power, Math.sin(a) * sp, { life: 1.2 + Math.random(), size: 0.8, grow: 3.5 + power * 2, alpha: w.theme.snowing ? 0.55 : 0.38, drag: 1.6, color: col });
  }
}

// ------------------------------------------------------------------ HUD
/** Set the maps up for this ride (the world's top-down picture, or the track). */
function drawMapBase() {
  if (R.mode === 'free') map.setFree(R.def, world.ground);
  else map.setTrack(R.T, C.pathAt);
}
function hud(now) {
  const b = R.bike; const T = R.T;
  const t = now < R.goAt ? 0 : b.t;
  $('#hud-time').closest('.mx-tr').hidden=R.mode==='free'&&!R.trial;
  $('#hud-time').textContent = fmt(R.mode==='free'?R.trial?.time:t);
  $('#hud-speed').textContent = Math.round(Math.hypot(b.vx, b.vy) * 3.6);
  $('#hud-gear').textContent = b.crashed ? 'N' : b.gear;
  $('#hud-nitro').style.width = `${Math.round(b.nitro * 100)}%`;
  $('#hud-nitro').parentNode.classList.toggle('on', b.boost);
  $('#hud-nitro').parentNode.classList.toggle('full', b.nitro >= 0.999);
  $('#hud-sub').textContent = R.spectate ? watchLine() : R.mode === 'online' && state.race ? `P${myPlace()} / ${Object.keys(state.race.runners).length}  ·  CP ${b.cp + 1}/${T.cps.length}` : `CHECKPOINT ${b.cp + 1} / ${T.cps.length}`;
  $('#hud-left').textContent = R.mode==='free' ? R.trial ? `${R.trial.race.name} · LAP ${R.trial.lap}/${R.trial.race.laps}` : R.tow ? 'WAKEBOARD · CUT ACROSS THE WAKE · R BACK TO THE ROPE' : R.skate ? 'GRINDVVD · PUSH W · GRIND THE RAILS · R SAFE PAD' : R.wing ? `SKYVVD · PROXIMITY ${Math.round(b.prox || 0)} · SPACE PARACHUTE · R HELICOPTER` : R.sled ? 'SLEDVVD · SPACE TURBO · R SAFE PAD' : R.buggy ? 'DRIVVD · SPACE TURBO · R SAFE PAD' : R.water ? 'WAVVD · SPACE TURBO · R SAFE PAD' : R.board ? 'CARVVD · A / D CARVE · R SAFE PAD' : R.mtb ? 'UNREVVD · Q WHEELIE · R SAFE PAD' : 'FREE RIDE · SPACE TURBO · R SAFE PAD' : `${Math.max(0, Math.round(T.finish - b.s))} M LEFT`;
  if(R.mode==='free')$('#hud-sub').textContent=R.trial?`GATE ${Math.min(R.trial.next+1,R.trial.gates.length)} / ${R.trial.gates.length}`:'EXPLORE AT YOUR OWN PACE';
  const ch = R.challenge;
  if (ch) {
    const k = ch.def.kind; const el = Math.min(ch.def.limit, ch.elapsed);
    $('#hud-time').closest('.mx-tr').hidden = false;
    $('#hud-time').textContent = fmt(k === 'race' ? el : Math.max(0, ch.def.limit - el));   // (races count up, the rest count down)
    const togo = ch.finish ? Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) : 0;
    $('#hud-sub').textContent = R.spectate ? watchLine() : ch.done ? (ch.buried ? 'BURIED!' : k === 'race' && ch.elapsed < ch.def.limit ? 'FINISHED!' : 'TIME’S UP') : ch.def.laps ? `LAP ${Math.min(ch.def.laps, (ch.lap || 0) + 1)} / ${ch.def.laps}` : ch.def.gates && (ch.gate || 0) < ch.def.gates.length ? `GATE ${(ch.gate || 0) + 1} / ${ch.def.gates.length} · ${Math.round(Math.hypot(b.px - ch.def.gates[ch.gate || 0][0], b.pz - ch.def.gates[ch.gate || 0][1]))} M` : k === 'surf' ? `${Math.round(ch.score)} SURF POINTS` : k === 'race' ? (togo > 950 ? `${(togo / 1000).toFixed(1)} KM TO THE FINISH` : `${Math.round(togo)} M TO THE FINISH`)
      : k === 'lanterns' ? `🏮 ${ch.score} / ${world.forest?.lanterns.length || 0} · ${Math.round(togo)} M TO THE BOTTOM`
      : k === 'tag' ? tagLine() : k === 'relay' ? relayLine()
      : k === 'air' ? `BEST AIR ${ch.score.toFixed(2)} S` : k === 'flips' ? `${ch.score} FLIP${ch.score === 1 ? '' : 'S'}` : k === 'tricks' ? `${ch.score} TRICK POINTS` : `TOP ${Math.round(ch.score)} KM/H`;
    $('#hud-left').textContent = ch.online && state.race ? `P${myPlace()} / ${Object.keys(state.race.runners).length} · ${k === 'race' ? 'FOLLOW THE GREEN BEAM' : k === 'tag' ? 'RIDE INTO SOMEONE TO TAG THEM' : k === 'relay' ? 'PASS THE LANTERN DOWN THE CHUTE' : 'TIME LEFT TOP RIGHT'}`
      : ch.aval ? `🌊 THE AVALANCHE IS ${Math.max(0, Math.round(ch.aval.gap))} M BEHIND YOU!` : ch.def.laps ? 'ROUND THE TRACK · PUMP THE ROLLERS' : ch.def.park && k === 'race' ? 'UP TO THE CHEQUERED FLAG'
      : k === 'race' ? 'RIDE TO THE GREEN BEAM · ANY LINE YOU LIKE' : k === 'lanterns' ? 'PICK UP THE LANTERNS · THE BOTTOM ENDS IT' : ch.def.about.toUpperCase();
  }
  // the waypoint you set on the big map: how far, on the line under the world's name
  const wp = R.mode === 'free' && !ch && !R.trial ? map.waypoint : null;
  if (wp) { const d = Math.hypot(b.px - wp.x, b.pz - wp.z); $('#hud-sub').textContent = d < 40 ? `${wp.icon} ${wp.name.toUpperCase()} · YOU’RE HERE!` : `${wp.icon} ${wp.name.toUpperCase()} · ${d > 950 ? (d / 1000).toFixed(1) + ' KM' : Math.round(d / 10) * 10 + ' M'}`; }
  map.drawMini();
  $('#hud-wrong').classList.toggle('on', !!b.wrong && !R.spectate && !R.finished);
  if (online()) drawBoard();
}

// ------------------------------------------------------------------ solo: finishing a time trial
function soloFinish(t) {
  const def = R.def; const b = R.bike;
  const ms = Math.round(t * 1000);
  const prev = bestOf(def.id);
  const better = !prev || ms < prev.ms;
  if (better) store.set('moto_best_' + def.id, { ms, splits: R.splits.slice() });
  const medal = medalFor(def, t);
  if (medal === 0) UI.confetti(220);
  Account.submit(`moto-${def.id}`, ms, { flips: b.flips });
  const i = DATA.tracks.indexOf(def); const next = DATA.tracks[i + 1];
  const ride = R.ride;
  const btn = (label, onClick, key) => h('button', { class: 'mx-go slim', type: 'button', onclick: onClick }, h('b', {}, label), key ? h('span', { class: 'mx-key' }, key) : null);
  setTimeout(() => {
    if (R.ride !== ride || !riding) return;
    fill($('#hud-center'), h('div', { class: 'mx-card' },
      h('div', { class: 'mx-medal' }, medal >= 0 ? MEDALS[medal][0] : '🏁'),
      h('h2', {}, medal >= 0 ? `${MEDALS[medal][1]} medal!` : 'Finished!'),
      h('div', { class: 'mx-big' }, fmt(t)),
      h('p', { class: 'muted' }, prev ? (better ? `🎉 New best! ${fmt((prev.ms - ms) / 1000)} faster` : `Your best: ${fmt(prev.ms / 1000)}`) : 'First finish on this track!'),
      h('div', { class: 'mx-stats' },
        h('span', {}, `🤸 ${b.flips} flip${b.flips === 1 ? '' : 's'}`), h('span', {}, `💥 ${b.crashes} crash${b.crashes === 1 ? '' : 'es'}`), h('span', {}, `💨 ${Math.round(b.maxSpeed * 3.6)} km/h top`)),
      medal !== 0 ? h('p', { class: 'small muted' }, `Next: ${MEDALS[Math.max(0, (medal < 0 ? 3 : medal) - 1)][0]} ${fmt(medalTimes(def)[Math.max(0, (medal < 0 ? 3 : medal) - 1)])}`) : null,
      h('div', { class: 'btns' },
        btn('🔁 Again', () => startSolo(def), 'ENTER'),
        h('div', { class: 'row' }, next ? btn(`${next.emoji} Next track`, () => startSolo(next)) : null, btn('Menu', quit, 'ESC')))));
  }, 900);
}
function startSolo(def) {
  if (begin(def, 'solo', performance.now() + 3200)) {
    prefs.track = def.id; savePrefs();
    const url = new URL(location.href); url.searchParams.delete('free');url.searchParams.delete('world');url.searchParams.set('solo', '1'); url.searchParams.set('track', def.id); history.replaceState(null, '', url);
  }
}
/** Ride an open world: free ride, or with opts.challenge one of the challenges (opts.online: the whole room
    rides it at once, state.race says who; opts.goAt: when the countdown ends). */
async function startFree(entry, opts = {}){
  if(!setupRenderer())return;
  const ch=opts.challenge||null;
  if(!opts.online&&inRoom()){UI.toast('Leave the online race room before riding on your own','bad');return;}
  stopRide();setRiding(true);clearTimeout(stage.timer);
  const ride=R.ride=(R.ride||0)+1;R.mode='free';R.trial=null;R.spectate=false;R.challenge=null;R.onEnter=null;R.watchId=null;R.freeOnline=!!(opts.online&&!ch);
  fill($('#hud-center'),h('div',{class:'mx-loading'},'Building '+entry.name+'…'));$('#hud-time').closest('.mx-tr').hidden=true;
  try{
    const response=await fetch('/js/games/moto/open-world/'+entry.file);if(!response.ok)throw new Error('World unavailable');
    // on a mountain bike: an Unrevvd challenge, Unrevvd's free ride (opts.mtb), or a room's free ride with it picked
    const ov=opts.online&&!ch?prefs.vehicle:null;if(ov==='board')opts={...opts,board:true};if(ov==='jet')opts={...opts,water:true};   // (a room's free ride: the snowboard or jet ski you picked there)
    const mtb=ch?ch.vehicle==='mtb':opts.online&&!opts.board?prefs.vehicle==='mtb':!!(opts.mtb||opts.board);const tow=!ch&&!!opts.tow;const veh=ch?(['sled','buggy','skate','wing'].includes(ch.vehicle)?ch.vehicle:null):opts.veh||null;const sled=veh==='sled';let water=!!(ch?ch.water:opts.water||tow);   // (wakeboarding: on the water too, behind a boat)   // (Wavvd: a jet ski)
    const def=await response.json();if(ov==='jet'&&!def.sea)water=false;   // (no sea in this world: your dirt bike)
    await preloadBike(mtb?prefs.mtbModel:myLook().model,(ch?ch.board:opts.board)?'snow':mtb||water||veh==='skate'||veh==='wing'?mtbRider():myLook().rider);
    if(opts.daily)Object.assign(def,{id:'daily',name:'Daily Chute',seed:opts.daily.seed});
    if(!ch)applySky(def,SKIES[prefs.sky]?prefs.sky:'day');
    if(!ch&&opts.board&&def.theme==='snow'&&!(prefs.sky==='storm'))def.look={...(def.look||{}),weather:WEATHER[prefs.weather]?prefs.weather:'snow'};   // (Carvvd's free ride: your weather)   // (today's gully: a chute's look, its own trees)
    let nature=def.gauntlets?.length||def.features?.forest?await loadNature().catch((e)=>{console.warn('nature models',e);return null;}):null;   // (real trees and rocks for a gauntlet or a ski run's forest)
    if(nature&&def.gauntlets?.some(g=>g.aspens))nature={...nature,aspens:await loadAspens().catch(()=>null)};   // (the Autumn Chute's aspens)
    if(nature&&def.features?.forest)nature={...nature,spruces:await loadSpruces().catch(()=>null)};   // (a ski run's spruces)
    if(veh==='buggy'||veh==='wing'||veh==='skate')await (veh==='buggy'?preloadExtra('buggy'):veh==='wing'?preloadExtra('parachute'):preloadSkateboard());   // (the newer modes' model files)
    if(!ch&&!mtb&&!water&&!veh&&prefs.vehicle==='car')await preloadCar(prefs.carModel);if(!riding||R.ride!==ride)return;
    for(const o of R.others.values())dropOther(o);R.others.clear();
    if(R.model){disposeModel(R.model);R.model=null;}
    for(const sb of stage.bikes.values()){sb.model.root.removeFromParent();sb.tag?.removeFromParent();}
    dropTrails();dropAvalanche();R.tow?.dispose();R.tow=null;if(world)world.dispose();world=null;worldKey=null;
    const q=QUALITY[qualityLevel()];world=buildRideWorld(def,q.scenery,renderer,q.shadows,nature);worldKey='free:'+def.id;
    renderer.shadowMap.enabled=q.shadows;renderer.toneMappingExposure=world.theme.exposure;
    R.def=def;
    let spawn,engine=null,finish=null;
    if(ch){
      ({spawn,finish}=challengeStart(ch,world.ground,def,opts.online?laneFor(Net.id):0));
      R.challenge={def:ch,online:!!opts.online,finish,score:0,sent:0,sentAt:0,done:false,elapsed:0,safe:{x:spawn.position[0],z:spawn.position[1],h:spawn.heading},safeAt:0};
    }else{
      const pad=def.spawnPads[0],park=world.ground.parks[0];   // (start facing the jump park, not the edge of the world)
      spawn={...pad,heading:park?park.heading:Math.atan2(-pad.position[0],-pad.position[1])};
      if(R.freeOnline){const side=laneFor(Net.id)*3;spawn.position=[pad.position[0]+Math.cos(spawn.heading)*side,pad.position[1]-Math.sin(spawn.heading)*side];}   // (riding together: side by side)
      engine=Coins.engineOf().stats;   // (bought engine upgrades only work in free ride)
      if(veh==='wing'){const hp=[...def.safePads].sort((p,q)=>world.ground.heightAt(...q.position)-world.ground.heightAt(...p.position))[0];spawn={position:hp.riderPosition||hp.position,heading:0};}   // (Skyvvd: the helicopter drops you over the highest point)
    }
    if(tow){R.tow=createTow(world.scene,world.ground,world.ocean);spawn=R.tow.behind();engine={power:0,drag:1,turbo:0,regen:0,gear:1};}   // (no engine: the boat pulls you)
    // the dirt bike, the mountain bike (its upgrades only in free ride too) or the supercar
    R.mtb=mtb;R.water=water;R.veh=veh;R.sled=sled;R.buggy=veh==='buggy';R.wing=veh==='wing';R.skate=veh==='skate';R.car=R.buggy||R.wing||!ch&&!mtb&&!water&&!veh&&prefs.vehicle==='car';R.V=R.wing?Wing:R.car?Car:C;if(R.car&&!R.wing)Car.setSpec(R.buggy?'buggy':'super');   // (Skyvvd's wingsuit is drawn and followed like a car)   // (Drivvd's buggy: the car on long springs)
    R.board=!!(ch?ch.board:opts.board);   // (Carvvd: a board instead of a bike, no pedalling: it's all gravity)
    R.T=C.groundTrack(world.ground,spawn,water&&!tow?JETSKI:sled?SLED:engine,veh==='skate'?SKATE:mtb?(R.board?(ch?BOARD:BOARD_FREE):ch?{}:Coins.MTB.current().stats):null);R.bike=R.V.newBike(R.T);R.bike.board=R.board||tow||veh==='skate';   // (a board spins 180s, 540s…)
    if(R.wing){R.T.launch=spawn;if(!ch){const g=world.ground,[x0,z0]=spawn.position;let best=null;for(let a=0;a<6.28;a+=0.2){const d=[0,1,2,3].reduce((m,k)=>m+g.heightAt(x0+Math.sin(a)*(300+k*300),z0+Math.cos(a)*(300+k*300)),0);if(!best||d<best.d)best={d,a};}spawn.heading=best.a;R.T.launch=spawn;R.V.place(R.T,R.bike,spawn);}}   // (free flight: out of the helicopter facing the way the mountain falls away)
    R.model=R.wing?makeWingsuit(wingColor()):R.buggy?makeCar('buggy',buggyPaint()):R.car?makeCar(prefs.carModel,prefs.carPaint):makeBike(R.board?boardLook():mtb||veh==='skate'?mtbLook():water?jetLook():myLook());if(R.board)boardify(R.model,boardColor(),gear());if(tow){boardify(R.model,jetColor(),'board');R.model.wakes=true;}else if(water)jetskify(R.model,jetColor());else if(sled)sledify(R.model,sledColor());else if(R.skate)skateify(R.model,skateColor());world.scene.add(R.model.root);coverOn(R.model);
    R.tracks=createTracks(world.scene,(x,z)=>world.ground.heightAt(x,z),(x,z)=>world.ground.surfaceAt(x,z),{snowing:world.snowing});   // (grooves and tyre tracks)
    if(opts.online&&state.race){fillOthers(state.race);if(ch)for(const o of R.others.values())addOtherModel(o);}   // (free ride: each rider's bike or car appears with their first message)
    R.prev=R.cur=snap(R.bike);R.acc=0;R.last=performance.now();R.finished=false;R.cam.init=false;R.stuck=0;R.emitAcc=0;R.roll=0;R.best=null;R.beeped=0;R.safeTrail=[];R.retry=null;R.toPad=false;
    R.goAt=ch?Math.max(opts.goAt||0,performance.now()+(opts.online?600:3200)):0;R.gateDown=!ch;
    R.camMode=ch?.cam||prefs.cam;   // (a challenge can be ridden in first person)
    R.trialMarker=null;R.finishMarker=finish?finishBeacon(finish):null;R.audio=createAudio({pedal:mtb||R.wing||R.skate});chuteExtras(ch);R.helmet=Coins.CAM.current();
    if(world.lamp&&mtb){const L=Coins.LAMP.current().lamp;Object.assign(world.lamp.spot,{intensity:L.i,angle:L.angle,distance:L.dist});}   // (your bike lamp, from the shop)
    if(world.storm){R.audio?.rain(1);world.onLightning=(far)=>{pulse($('#fx-flash'));R.audio?.thunder(far);};}$('.mx-nlab').textContent='TURBO · SPACE / SHIFT';for(const el of $$('.mx-nitro, .mx-nlab'))el.style.display=mtb||tow||R.wing||R.skate?'none':'';$('#mx-trials').hidden=!!ch;   // (a bicycle has no nitro)
    $('#hud-track').textContent=ch?`${ch.emoji} ${ch.name}${R.cup?` · World Cup ${R.cup.i+1}/${Chutes.CUP.length}`:''}`:def.name;
    fill($('#hud-center'));resize();drawMapBase();coinHud(purse().wallet().coins,0);R.running=true;requestAnimationFrame(frame);
    const url=new URL(location.href);url.searchParams.delete('solo');url.searchParams.delete('track');
    if(ch){url.searchParams.delete('free');url.searchParams.delete('world');history.replaceState(null,'',url);showMessage(ch.about,'small',5000);}
    else{if(!R.board&&!water){if(mtb)prefs.mtbWorld=def.id;else prefs.world=def.id;savePrefs();}if(water)url.searchParams.set('water','1');else url.searchParams.delete('water');if(tow)url.searchParams.set('tow','1');else url.searchParams.delete('tow');if(veh)url.searchParams.set('veh',veh);else url.searchParams.delete('veh');url.searchParams.set('free','1');url.searchParams.set('world',def.id);if(mtb&&!R.freeOnline)url.searchParams.set('mtb','1');else url.searchParams.delete('mtb');if(R.board)url.searchParams.set('board','1');else url.searchParams.delete('board');history.replaceState(null,'',url);
      showMessage(R.freeOnline?'FREE RIDE TOGETHER · Esc goes back to the room':R.skate?'GRINDVVD · W push · A / D carve · ride onto a rail to grind · Q / E flip · 1–6 tricks · X spin':R.wing?'SKYVVD · W dive · S flare · A / D turn · fly low for proximity points · Space: parachute':R.buggy?'DRIVVD · W/S drive · A/D steer · Q handbrake · Space turbo · Q/E tip the nose in the air':sled?'SLEDVVD · W throttle · climb anything · Q / E flip · Space turbo · R resets':tow?'WAKEBOARD · A / D carve out wide, then cut back hard across the wake to fly · Q / E flip · X spin · 1–6 grab':water?'WAVVD · W throttle · A / D steer · jump the waves · Q / E flip · Space turbo':R.board?'CARVVD · Point it downhill · A / D carve · Q / E flip · R resets':mtb?'UNREVVD · W pedals · Q pops a wheelie · R resets':'FREE RIDE · Collect the gold coins · Space / Shift turbo · R resets','small',4500);}
  }catch(error){console.error(error);UI.toast('Could not load that world','bad');quit();}
}

// ------------------------------------------------------------------ coins
/** Career tiers you've just cleared: their coins (in both purses) and a cheer. */
function careerReward(rows) {
  for (const r of rows) {
    Coins.earn(r.coins); Coins.MTB.earn(r.coins);
    UI.toast(`${r.emoji} Career: ${r.name} cleared! +${r.coins} coins in Revvd and Unrevvd${r.unlock ? ` · unlocked ${r.unlock}` : ''}`, 'good', 5000);
  }
  UI.confetti(200); menus.refresh();
}
/** The coins you're earning: Revvd's, or Unrevvd's on a mountain bike. */
const purse = (mtb = R.mtb) => (mtb ? Coins.MTB : Coins);
/** Earn coins (fractions add up); pop shows "+n" by the counter. */
function payCoins(n, pop = true, wallet = purse()) {
  const before = R.coins ?? wallet.wallet().coins;
  const total = wallet.earn(n);
  if (total !== before) coinHud(total, pop ? total - before : 0);
}
function coinHud(total, gained) {
  R.coins = total;
  const el = $('#hud-coins'); el.hidden = R.mode !== 'free';
  el.querySelector('b').textContent = total.toLocaleString('en-US');
  if (gained > 0) {
    const pop = h('i', { class: 'pop' }, '+' + gained);
    el.append(pop); setTimeout(() => pop.remove(), 900);
  }
}

// ------------------------------------------------------------------ challenges
const fmtScore = (kind, v) => (kind === 'race' ? fmt(v) : kind === 'air' ? `${v.toFixed(2)} s` : kind === 'flips' ? `${v} flip${v === 1 ? '' : 's'}` : kind === 'tricks' ? `${v} pts`
  : kind === 'surf' ? `${Math.round(v)} pts` : kind === 'lanterns' ? `${v} lantern${v === 1 ? '' : 's'}` : kind === 'tag' ? `${(+v).toFixed(1)} s it` : `${Math.round(v)} km/h`);
const challengeBest = (id) => store.get('moto_ch_best_' + id, null);
/** Where a challenge starts (lane: a few metres to the side, so a room doesn't stack up) and where it finishes. */
function challengeStart(ch, ground, def, lane) {   // (lane may change for a relay)
  const pads = Object.fromEntries(def.safePads.map((p) => [p.id, p]));
  let pos; let head; let finish = null;
  const park = ch.park && ground.parkList ? ground.parkList.find((f) => f.id === ch.park) : null;
  if (park) {   // (a park: its start; a hill climb finishes at the top)
    pos = park.start.position; head = park.start.heading; if (park.park === 'climb') finish = park.top;
  } else if (ch.kind === 'race' || ch.kind === 'relay' || ch.from) {   // (a race, or the Lantern Hunt: top to bottom too)
    const a = pads[ch.from]; finish = ch.to ? pads[ch.to].position : ch.gates.at(-1).slice(0, 2); pos = a.riderPosition || a.position;   // (a gate course without a finish pad ends at its last gate)
    const aim = ch.gates ? ch.gates[0] : finish; head = Math.atan2(aim[0] - pos[0], aim[1] - pos[1]);
  } else if (ch.at === 'park' && ground.parks[0]) {
    const p = ground.parks[0]; pos = [p.start[0] - Math.sin(p.heading) * 40, p.start[1] - Math.cos(p.heading) * 40]; head = p.heading;
  } else {
    const a = pads[ch.at] || def.safePads[0]; pos = a.riderPosition || a.position;
    head = ground.roadAt(...pos)?.heading ?? Math.atan2(-pos[0], -pos[1]);
  }
  if (ch.kind === 'relay' && state.race?.teams) {   // (the Lantern Relay: your team's riders wait in turn down the chute)
    const t = relayTeam(Net.id); const team = state.race.teams[t] || [Net.id]; const k = Math.max(0, team.indexOf(Net.id));
    const f = k / team.length; pos = [pos[0] + (finish[0] - pos[0]) * f, pos[1] + (finish[1] - pos[1]) * f]; lane = t === '1' ? 1 : -1;
  }
  const off = lane * (ch.kind === 'tag' ? 5.5 : 2.6);   // (Forest Tag: spread out, or "it" tags someone straight away)
  return { spawn: { position: [pos[0] + Math.cos(head) * off, pos[1] - Math.sin(head) * off], heading: head }, finish };
}
/** A tall glowing column over the finish pad, seen from far away. */
function finishBeacon([x, z], color = '#7dffb5') {
  const y = world.ground.heightAt(x, z);
  const g = new THREE.Group();
  // (tall enough to see from the top of Sheerwall's cliff, 420 m above its finish)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 760, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.set(x, y + 380, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(40, 0.8, 8, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
  ring.position.set(x, y + 0.6, z);
  g.add(beam, ring); world.scene.add(g);
  return g;
}
function dropFinishMarker() {
  for (const g of R.gateMarks || []) { g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); g.removeFromParent(); }
  R.gateMarks = [];
  if (!R.finishMarker) return;
  R.finishMarker.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  R.finishMarker.removeFromParent(); R.finishMarker = null;
}
function challengeStep(b, now) {
  const ch = R.challenge; if (ch.done) return;
  ch.elapsed += DT; const el = ch.elapsed;   // (riding time: a paused or background tab doesn't eat into it)
  const onWheels = b.wh[0].ct || b.wh[1].ct;
  if (!b.crashed && onWheels && now - ch.safeAt > 500 && R.T.terrain.inBounds(b.px, b.pz, 60)) {
    ch.safe = { x: b.px, z: b.pz, h: Math.PI / 2 - b.h }; ch.safeAt = now;   // (clearOfTrees moves it off the line of a tree)
  }
  const kind = ch.def.kind;
  R.ghostRec?.add(el, posMsg(b));
  if (kind === 'speed' && !b.crashed && onWheels) ch.score = Math.max(ch.score, Math.hypot(b.vx, b.vy) * 3.6);
  if (ch.def.gates && !gateStep(ch, b)) { challengeDone(el); return; }
  if (kind === 'race' && ch.finish && !(ch.def.gates && ch.gate < ch.def.gates.length) && Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) < (ch.def.finishR || 40)) { challengeDone(el); return; }
  if (kind === 'surf') surfStep(ch, b);
  if (ch.def.laps && !lapStep(ch, b)) { challengeDone(el); return; }
  if (ch.def.avalanche && avalancheStep(ch, b, el)) return;
  if (kind === 'lanterns') {
    // ride past a lantern to pick it up; the run's over at the bottom
    const f = world.forest;
    if (f && !b.crashed) for (const l of f.lanterns) if (!l.out && Math.hypot(l.x - b.px, l.z - b.pz) < 3.4) { f.lanternOut(l); ch.score++; R.audio?.chime(); showMessage(`🏮 ${ch.score} / ${f.lanterns.length}`, 'cp', 900); }
    if (Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) < 40) { challengeDone(null); return; }
  }
  if (kind === 'relay' && ch.online && state.race?.carrier) {
    // carrying the lantern: ride up to the next rider in your team to hand it on; the last one takes it to the bottom
    const t = relayTeam(Net.id); const team = state.race.teams[t]; const leg = state.race.leg[t];
    if (state.race.carrier[t] === Net.id) {
      const next = team[leg + 1]; const o = next && R.others.get(next);
      if (o && o.snap && Math.hypot(o.snap.px - b.px, o.snap.pz - b.pz) < 3.5 && now > (ch.passAt || 0)) { Net.send('g:pass', { id: next }); ch.passAt = now + 600; }
      if (!next && Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) < 40) { challengeDone(el); return; }
    }
  }
  if (kind === 'tag' && ch.online && state.race?.it === Net.id && now > (ch.tagAt || 0)) {
    // you're it: ride into someone to pass it on (the server checks)
    for (const o of R.others.values()) if (o.snap && Math.hypot(o.snap.px - b.px, o.snap.pz - b.pz) < 3) { Net.send('g:tag', { id: o.id }); ch.tagAt = now + 600; break; }
  }
  if (el >= ch.def.limit) { challengeDone(null); return; }
  if (ch.online && kind !== 'race' && ch.score > ch.sent && now - ch.sentAt > 300) { ch.sent = ch.score; ch.sentAt = now; Net.send('g:score', { score: ch.score }); }
}
/** The Avalanche! challenge: a wall of snow breaks 80 m behind you and comes down the same way you're going, faster
    and faster (up to 16 m/s), slowing down where the slope eases off. If it catches you, you're buried. Returns true once it has. */
function avalancheStep(ch, b, el) {
  if (!ch.aval) {
    const [sx, sz] = [b.px, b.pz]; let dx = ch.finish[0] - sx; let dz = ch.finish[1] - sz; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    ch.aval = { x0: sx, z0: sz, dx, dz, front: -80, vis: createAvalanche(world.scene, world.ground, world.fx, [sx, sz], [dx, dz]), rumbleAt: 0 };
  }
  const A = ch.aval; const g = world.ground;
  if (!A.slopeAt || el - A.slopeAt > 0.5) {   // (how steep it is where the front is: it slows on the flat)
    const x = A.x0 + A.dx * A.front; const z = A.z0 + A.dz * A.front;
    A.slope = (g.heightAt(x, z) - g.heightAt(x + A.dx * 30, z + A.dz * 30)) / 30; A.slopeAt = el;
  }
  A.front += DT * Math.min(16, 4 + el * 0.11) * Math.min(1.25, Math.max(0.65, 0.4 + A.slope * 4));
  A.gap = (b.px - A.x0) * A.dx + (b.pz - A.z0) * A.dz - A.front;
  if (A.gap < 1 && !ch.done) {
    showMessage('❄️ BURIED BY THE AVALANCHE!', 'bad', 3000); R.cam.shake = 1; ch.buried = true;
    challengeDone(null); return true;
  }
  return false;
}
function dropAvalanche() { if (R.challenge?.aval) { R.challenge.aval.vis.dispose(); R.challenge.aval = null; } }
/** Laps of a park's loop (the pump track): only riding round it on the track counts. Returns false once they're done. */
/** A course of gates ("gates": [[x, z, radius?, height?], …]) to go through in order: buoys to round, rings in the
    sky. The marker shows the next one. Returns false once the last is done (with no "to", that's the finish). */
function gateStep(ch, b) {
  const G = ch.def.gates; ch.gate ||= 0;
  if (!ch.gateMark) ch.gateMark = gateMarker();
  if (ch.gate >= G.length) { ch.gateMark.visible = false; return true; }   // (all through: now the finish)
  const [x, z, r = 14, y] = G[ch.gate];
  if (!b.crashed && Math.hypot(b.px - x, b.pz - z) < r && (y == null || Math.abs((b.wy ?? b.y) - y) < r)) {
    ch.gate++; R.audio?.chime?.();
    if (ch.gate >= G.length && !ch.finish) { ch.gateMark.visible = false; return false; }
    if (ch.gate < G.length) showMessage(`GATE ${ch.gate} / ${G.length}`, 'cp', 900);
  }
  const g = G[Math.min(ch.gate, G.length - 1)], m = ch.gateMark;
  if (ch.gate >= G.length) m.visible = false;
  else { const gy = g[3] ?? world.ground.heightAt(g[0], g[1]); m.position.set(g[0], gy, g[1]); m.scale.setScalar((g[2] || 14) / 14);
    const n = G[ch.gate + 1] || [g[0] + (g[0] - b.px), g[1] + (g[1] - b.pz)]; m.rotation.y = Math.atan2(n[0] - g[0], n[1] - g[1]); m.children[0].position.y = g[3] != null ? 0 : 7; }
  return true;
}
/** The next gate: an upright ring (you go through it) and a column of light to find it from far away. */
function gateMarker() {
  const g = new THREE.Group(), col = '#ffd23a';
  const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 8, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }));
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 260, 12, 1, true).translate(0, 130, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  g.add(ring, beam); world.scene.add(g); R.gateMarks = (R.gateMarks || []).concat(g);
  return g;
}
/** Wavvd's Surf Break: points for every second you ride down the face of a wave at speed (and more the steeper it is). */
function surfStep(ch, b) {
  const t = world.ground; if (!t.waveAt || b.crashed || !(b.wh[0].ct || b.wh[1].ct)) { ch.surfing = 0; return; }
  const c = Math.cos(b.h), sn = Math.sin(b.h), down = (t.waveAt(b.px - c * 2, b.pz - sn * 2) - t.waveAt(b.px + c * 2, b.pz + sn * 2)) / 4;
  if (down > 0.07 && b.vx > 7) {
    ch.score += DT * 10 * Math.min(3, down / 0.07) * (1 + Math.min(1, (b.vx - 7) / 15)); ch.surfing = (ch.surfing || 0) + DT;
    if (ch.surfing > 0.6 && !(ch.surfShown > performance.now())) { showMessage(`🏄 SURFING · ${Math.round(ch.score)}`, 'cp', 700); ch.surfShown = performance.now() + 700; }
  } else ch.surfing = 0;
}
function lapStep(ch, b) {
  const f = world.ground.parkList.find((p) => p.id === ch.def.park); if (!f) return true;
  const L = f.loop(b.px, b.pz);
  if (Math.abs(L.d) < f.tw / 2 + 1.5 && !b.crashed) {
    if (ch.lapT != null) { let d = L.t - ch.lapT; if (d < -f.loopLen / 2) d += f.loopLen; if (d > f.loopLen / 2) d -= f.loopLen; if (Math.abs(d) < 3) ch.dist = (ch.dist || 0) + d; }
    ch.lapT = L.t;
  } else ch.lapT = null;
  const lap = Math.floor(Math.max(0, ch.dist || 0) / f.loopLen);
  if (lap > (ch.lap || 0)) { ch.lap = lap; if (lap >= ch.def.laps) return false; showMessage(`LAP ${lap + 1} / ${ch.def.laps}`, 'cp', 1200); R.audio?.checkpoint(); }
  return true;
}
/** The Freestyle Arena's judges: what a landing is worth to them (the same trick again is worth less), and their cards. */
function judge(d) {
  const key = [...(d.tricks || [])].sort().join(',') + '|' + (d.turns || 0) + '|' + (d.spin || 0);
  const seen = (R.judged ||= new Map()).get(key) || 0; R.judged.set(key, seen + 1);
  const pts = Math.round(d.score * (d.perfect ? 1.2 : 1) / (1 + seen));
  const card = () => Math.max(1, Math.min(10, Math.round((3.2 + Math.log2(1 + pts / 12) * 1.25 + (Math.random() - 0.5) * 0.8) * 2) / 2));
  const cards = [card(), card(), card()];
  setTimeout(() => {
    const el = $('#hud-trick'); fill(el, h('b', {}, `🧑‍⚖️ ${cards.map((c) => c.toFixed(1)).join(' · ')}`), h('small', {}, seen ? `${pts} PTS · seen that one already` : `${pts} PTS`));
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }, 1200);
  return pts;
}
/** The challenge is over for you: time = your time in a race (null = out of time); timed ones use the score. */
function challengeDone(time) {
  const ch = R.challenge; if (!ch || ch.done) return;
  ch.done = true; R.finished = true;
  R.audio?.checkpoint();
  const def = ch.def; const kind = def.kind;
  const score = kind === 'race' ? time : ch.score;
  const ok = kind === 'race' ? time != null : ch.score > 0;
  if (ch.online) {
    if ((kind === 'race' || kind === 'relay') && time != null) Net.send('g:finish', { time: Math.round(time * 1000), cp: 0, crashes: R.bike.crashes, flips: R.bike.flips });
    else if (kind !== 'race' && ch.score > 0) Net.send('g:score', { score: ch.score });
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, kind === 'race' ? (ok ? '🏁 Finished!' : '⏱️ Out of time') : '⏱️ Time’s up!'),
      ok ? h('div', { class: 'mx-big' }, fmtScore(kind, score)) : null, h('p', { class: 'muted' }, 'Waiting for the others…')));
    // then watch the ones still riding
    setTimeout(() => {
      if (R.challenge !== ch || !R.running || !state.race || !Object.entries(state.race.runners).some(([id, r]) => id !== Net.id && !r.done)) return;
      R.spectate = true; R.cam.init = false; fill($('#hud-center')); showMessage('Watching the others · ← → to switch', 'small', 3000);
    }, 2500);
    return;
  }
  // on your own: your best on this device, a medal, and coins
  const best = challengeBest(def.id);
  const better = ok && (best == null || (kind === 'race' ? score < best : score > best));
  if (better) store.set('moto_ch_best_' + def.id, score);
  const medal = Chutes.medalOf(def, score); const firstMedal = Chutes.saveMedal(def.id, medal);
  const goldBefore = Chutes.goldAll();
  const today = ok && def.today ? Chutes.claimToday(def.id) : 0;   // (today's challenge: a bonus, once a day)
  const pay = ok ? 40 + (better ? 30 : 0) + (medal >= 0 ? [60, 30, 15][medal] : 0) + today : 0;
  if (today) setTimeout(() => UI.toast(`📅 Today's challenge done: +${today} bonus coins`, 'good', 3500), 600);
  if (pay) payCoins(pay);
  if (medal === 0) UI.confetti(220); else if (better && best != null) UI.confetti(160);
  const close = R.run ? R.run.close : 0;
  if (R.run) { R.run.save(ok); R.run = null; }
  // the leaderboards (logged in) and the ghost of this run
  if (ok && kind === 'race') {
    const ms = Math.round(score * 1000); const game = chuteGame(def); const data = R.ghostRec?.data();
    if (data && better) Chutes.saveMyGhost(ghostKey(def), ms, data);
    if (!R.cup) Account.submit(game, ms).then((r) => { if (r && r.best && data && game.startsWith('mch-')) Net.request('ghost:put', { game, ms, data }).then((g) => { if (g.kept) UI.toast('👻 Your run is the new record ghost!', 'good', 3500); }).catch(() => {}); });
  }
  R.ghostRec = null;
  if (R.cup) { cupNext(score); return; }
  if (def.weekly && medal === 0 && !Chutes.weeklyGold()) { store.set('moto_weekly_gold', def.weekly.n); setTimeout(() => UI.toast('🏆 Weekly gold! The Champion board and visor are yours', 'good', 6000), 1200); }
  if (!goldBefore && Chutes.goldAll()) setTimeout(() => UI.toast('🏅 Gold on all three chutes! The golden visor is yours (Shop → Helmet cam)', 'good', 6000), 1200);
  const btn = (label, onClick, key) => h('button', { class: 'mx-go slim', type: 'button', onclick: onClick }, h('b', {}, label), key ? h('span', { class: 'mx-key' }, key) : null);
  const times = kind === 'race' ? Chutes.medalTimes(def) : null;
  const nextMedal = medal < 0 ? 2 : medal - 1;
  fill($('#hud-center'), h('div', { class: 'mx-card' },
    h('div', { class: 'mx-medal' }, medal >= 0 ? Chutes.MEDALS[medal][0] : def.emoji),
    h('h2', {}, medal >= 0 ? `${Chutes.MEDALS[medal][1]} medal${firstMedal ? '!' : ''}` : def.name),
    h('div', { class: 'mx-big' }, ok ? fmtScore(kind, score) : kind === 'race' ? 'Out of time' : 'No score'),
    h('p', { class: 'muted' }, better ? (best == null ? 'Your first score!' : `🎉 New best! (was ${fmtScore(kind, best)})`) : best != null ? `Your best: ${fmtScore(kind, best)}` : 'Give it another go!'),
    times && medal !== 0 && ok ? h('p', { class: 'small muted' }, `Next: ${Chutes.MEDALS[nextMedal][0]} ${fmt(times[nextMedal])}`) : null,
    close ? h('p', { class: 'small muted' }, `😮 ${close} close call${close === 1 ? '' : 's'}`) : null,
    pay ? h('p', { class: 'small muted' }, `+${pay} 🪙`) : null,
    h('div', { class: 'btns' }, btn('🔁 Again', () => startChallengeSolo(def), 'ENTER'), btn('🎬 Replay', startReplay, 'V'), btn('Menu', quit, 'ESC'))));
}
/** The solo leaderboard a race challenge's times go on (the Daily Chute has one a day). */
const chuteGame = (ch) => (ch.daily ? 'mch-daily' : ch.weekly ? 'mch-weekly' : 'mch-' + ch.id);
/** Where your own best run's ghost is kept on this device. */
const ghostKey = (ch) => (ch.daily ? 'daily-' + ch.daily.day : ch.id);   // (a Weekly Challenge's id has its week in it)

// ------------------------------------------------------------------ chutes: near misses, bushes, ghosts (chutes.js)
/** A challenge starting in a forest: watch for near misses and bushes, record the run, and bring in the ghosts. */
function chuteExtras(ch) {
  dropGhosts(); R.run = null; R.ghostRec = null; R.judged = null;
  if (!ch) return;
  if (world.forest) R.run = Chutes.chuteRun(world.ground, { bushes: world.forest.bushes,
    onNear: () => { payCoins(3); showMessage('😮 CLOSE CALL! +3', 'cp', 900); R.audio?.whoosh(); },
    onBush: () => { R.audio?.rustle(); if (R.camMode === 'first') pulse($('#fx-leaves')); } });
  if (ch.kind === 'race' && !ch.online) { R.ghostRec = Chutes.ghostRecorder(); if (prefs.ghosts !== 'off') loadGhosts(ch); }
}
function pulse(el) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
async function loadGhosts(ch) {
  const ride = R.ride;
  const mine = Chutes.myGhost(ghostKey(ch));
  if (mine) addGhost(mine.data, '👻 Your best', '#7dd3ff');
  if (!Account.user && !navigator.onLine) return;
  try {
    const { ghost } = await Net.request('ghost:get', { game: chuteGame(ch) });
    if (R.ride !== ride || !ghost || (Account.user && ghost.name === Account.user.name && mine)) throw 0;   // (your own record: already there)
    addGhost(ghost.data, `🏆 ${ghost.name} · ${fmt(ghost.ms / 1000)}`, '#ffd34d', ghost.name);
  } catch { /* offline: just your own */ }
  if (!Account.user) return;
  try {   // and your friends' best runs (the fastest three)
    const { ghosts } = await Net.request('ghost:friends', { game: chuteGame(ch) });
    for (const g of ghosts || []) if (R.ride === ride && R.ghosts.length < 5 && !R.ghosts.some((o) => o.name === g.name)) addGhost(g.data, `👥 ${g.name} · ${fmt(g.ms / 1000)}`, g.color || '#b48cff', g.name);
  } catch { /* no friends' runs */ }
}
function addGhost(data, label, color, name = null) {
  const frames = Chutes.ghostFrames(data);
  if (!frames || !frames.length || !world) return;
  const model = R.wing ? makeWingsuit(null, color) : R.car ? makeCar(R.buggy ? 'buggy' : prefs.carModel, null, color) : makeBike({ ...(R.board ? boardLook() : R.water ? jetLook() : mtbLook()), ghost: color }); if (!R.car) { if (R.board) boardify(model, color, gear()); if (R.water) jetskify(model, color); if (R.sled) sledify(model, color); if (R.skate) skateify(model, color); } world.scene.add(model.root);
  const tag = nameTag(label, color); world.scene.add(tag);
  R.ghosts.push({ frames, model, tag, ang: [0, 0], name });
}
function dropGhosts() { for (const g of R.ghosts || []) dropOther(g); R.ghosts = []; }
/** The ghosts ride the run as it was recorded, by the challenge's clock. */
function drawGhosts(now, dt) {
  const ch = R.challenge; if (!ch || !R.ghosts?.length) return;
  const t = ch.elapsed * 1000;
  for (const g of R.ghosts) {
    const m = sampleBuf(g.frames, t); const end = g.frames[g.frames.length - 1].at;
    const s = m && otherSnap(m, g);
    // (gone a little after it finished, and out of the way when it's right on top of you)
    const show = !!m && t < end + 1500 && (R.camMode !== 'first' || Math.hypot(s.px - R.bike.px, s.pz - R.bike.pz) > 2.2);
    g.model.root.visible = g.tag.visible = show;
    if (!show) continue;
    g.ang[0] += (m.s / 3.6 / 0.35) * dt; g.ang[1] += (m.s / 3.6 / 0.34) * dt;
    if (g.model.car) poseCar(g.model, { px: m.px, pz: m.pz, y: m.y, h: m.h, car: { p: m.a, r: m.ro, st: m.st || 0, w: g.ang, c: [m.c0, m.c1, m.c2 || 0, m.c3 || 0] } });   // (a buggy's ghost)
    else poseBike(g.model, s, placer(s), s.h, now / 1000);
    g.tag.position.copy(g.model.root.position).add(tmpV.set(0, 2.1, 0));
  }
}

// ------------------------------------------------------------------ Forest Tag
/** The line under the challenge's name: who's it (and how long you've been it). */
function tagLine() {
  const it = state.race?.it; const mine = state.race?.itTimes?.[Net.id] ?? 0;
  return it === Net.id ? `🏷️ YOU’RE IT! CATCH SOMEONE · YOU ${mine.toFixed(0)} S` : `🏷️ ${(playerOf(it).name || 'SOMEONE').toUpperCase()} IS IT · RUN! · YOU ${mine.toFixed(0)} S`;
}
/** A pink arrow over whoever is it. */
function drawTagMarker(now) {
  const it = R.challenge?.def.kind === 'tag' && state.race?.it;
  const root = !it ? null : it === Net.id ? R.model?.root : R.others.get(it)?.model?.root;
  if (!root) { if (R.tagMarker) R.tagMarker.visible = false; return; }
  if (!R.tagMarker) {
    R.tagMarker = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 16).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: '#ff3fb8', fog: false }));
    world.scene.add(R.tagMarker);
  }
  R.tagMarker.visible = true;
  R.tagMarker.position.copy(root.position).add(tmpV.set(0, 3 + Math.sin(now / 180) * 0.25, 0));
  R.tagMarker.rotation.y = now / 400;
}
/** The Lantern Relay: which team someone's in ('0' or '1'), and a glowing lantern over each team's carrier. */
const relayTeam = (id) => Object.keys(state.race?.teams || {}).find((t) => state.race.teams[t].includes(id)) ?? '0';
const RELAY_COLORS = ['#ff5a3c', '#3c9bff'];
function drawRelayLanterns(now) {
  const race = state.race; const on = R.challenge?.def.kind === 'relay' && race?.carrier;
  R.lanterns ||= [];
  Object.keys(on ? race.carrier : {}).forEach((t, i) => {
    const id = race.carrier[t]; const root = id === Net.id ? R.model?.root : R.others.get(id)?.model?.root;
    let L = R.lanterns[i];
    if (!L) {
      L = new THREE.Group(); L.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshBasicMaterial({ color: '#ffd27a', fog: false })));
      L.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 16), new THREE.MeshBasicMaterial({ color: RELAY_COLORS[i], fog: false })));
      L.add(new THREE.PointLight('#ffb347', 6, 14, 2)); world.scene.add(L); R.lanterns[i] = L;
    }
    L.visible = !!root; if (root) { L.position.copy(root.position).add(tmpV.set(0, 2.6 + Math.sin(now / 200) * 0.15, 0)); L.children[1].rotation.y = now / 500; }
  });
  for (let i = on ? Object.keys(race.carrier).length : 0; i < R.lanterns.length; i++) R.lanterns[i].visible = false;
}
function relayLine() {
  const race = state.race; if (!race?.carrier) return '';
  const t = relayTeam(Net.id); const team = race.teams[t]; const leg = race.leg[t]; const carrier = race.carrier[t];
  const away = (id) => { const o = R.others.get(id); return o?.snap ? ` · ${Math.round(Math.hypot(o.snap.px - R.bike.px, o.snap.pz - R.bike.pz))} M` : ''; };
  if (R.challenge?.done) return '🏮 YOUR TEAM IS DOWN!';
  if (carrier === Net.id) return team[leg + 1] ? `🏮 YOU HAVE THE LANTERN · TAKE IT TO ${playerOf(team[leg + 1]).name.toUpperCase()}${away(team[leg + 1])}` : '🏮 YOU HAVE THE LANTERN · TO THE BOTTOM!';
  return team.indexOf(Net.id) > leg ? `🏮 WAIT FOR ${playerOf(carrier).name.toUpperCase()} TO BRING IT${away(carrier)}` : '🏮 YOU PASSED IT ON · CHEER THEM DOWN';
}
function dropRelayLanterns() { for (const L of R.lanterns || []) { L.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); o.dispose?.(); }); L.removeFromParent(); } R.lanterns = null; }
function dropTagMarker() { if (R.tagMarker) { R.tagMarker.removeFromParent(); R.tagMarker.geometry.dispose(); R.tagMarker.material.dispose(); R.tagMarker = null; } }

// ------------------------------------------------------------------ the Downhill World Cup (five chutes in a row)
function startCup() {
  R.cup = { i: 0, total: 0, times: [] };
  cupRide();
}
function cupRide() {
  const ch = CHALLENGES.find((c) => c.id === Chutes.CUP[R.cup.i]);
  if (!ch) { R.cup = null; quit(); return; }
  startChallengeSolo(ch, true);
}
/** A chute of the cup done: time (s), or null if you ran out of time (that's the end of the cup). */
function cupNext(time) {
  const cup = R.cup; const n = Chutes.CUP.length; const ch = CHALLENGES.find((c) => c.id === Chutes.CUP[cup.i]);
  const btn = (label, onClick, key) => h('button', { class: 'mx-go slim', type: 'button', onclick: onClick }, h('b', {}, label), key ? h('span', { class: 'mx-key' }, key) : null);
  R.onEnter = null;
  if (time == null) {
    R.cup = null; R.onEnter = startCup;
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('div', { class: 'mx-medal' }, '🏆'), h('h2', {}, 'Out of the World Cup'), h('p', { class: 'muted' }, `You ran out of time in ${ch.name} (chute ${cup.i + 1} of ${n}).`),
      h('div', { class: 'btns' }, btn('🔁 Start again', startCup, 'ENTER'), btn('Menu', quit, 'ESC'))));
    return;
  }
  cup.total += time; cup.times.push(time); cup.i++;
  if (cup.i < n) {
    const next = CHALLENGES.find((c) => c.id === Chutes.CUP[cup.i]); R.onEnter = cupRide;
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('div', { class: 'mx-medal' }, '🏆'), h('h2', {}, `Chute ${cup.i} of ${n} done`), h('div', { class: 'mx-big' }, fmt(cup.total)),
      h('p', { class: 'muted' }, `${ch.name}: ${fmt(time)}. Next: ${next.emoji} ${next.name}`),
      h('div', { class: 'btns' }, btn('Next chute', cupRide, 'ENTER'), btn('Menu', () => { R.cup = null; quit(); }, 'ESC'))));
    return;
  }
  R.cup = null; R.onEnter = startCup;
  const ms = Math.round(cup.total * 1000); const best = store.get('moto_cup_best', null); const better = !best || ms < best;
  if (better) store.set('moto_cup_best', ms);
  payCoins(better ? 400 : 250); UI.confetti(260);
  Account.submit('mch-cup', ms);
  fill($('#hud-center'), h('div', { class: 'mx-card' }, h('div', { class: 'mx-medal' }, '🏆'), h('h2', {}, 'World Cup finished!'), h('div', { class: 'mx-big' }, fmt(cup.total)),
    h('p', { class: 'muted' }, better ? (best ? `🎉 New best! (was ${fmt(best / 1000)})` : 'Your first World Cup!') : `Your best: ${fmt(best / 1000)}`),
    h('p', { class: 'small muted' }, cup.times.map((t, i) => `${CHALLENGES.find((c) => c.id === Chutes.CUP[i]).emoji} ${fmt(t)}`).join('  ·  ')),
    h('p', { class: 'small muted' }, `+${better ? 400 : 250} 🪙`),
    h('div', { class: 'btns' }, btn('🔁 Again', startCup, 'ENTER'), btn('Menu', quit, 'ESC'))));
}
function startChallengeSolo(ch, cup = false) {
  if (!cup) R.cup = null;   // (riding anything else ends a World Cup)
  if (ch.daily) { const entry = WORLDS.find((w) => w.id === ch.daily.look); if (entry) startFree(entry, { challenge: ch, daily: ch.daily }); return; }
  const entry = WORLDS.find((w) => w.id === ch.world);
  if (entry) startFree(entry, { challenge: ch });
}
/** The room's challenge started (or is on when you arrive). */
function startChallenge(race, countdown) {
  state.race = race; state.phase = 'racing'; state.results = null;
  const ch = CHALLENGES.find((c) => c.id === race.challenge);
  const entry = ch && WORLDS.find((w) => w.id === ch.world);
  if (!ch || !entry || !race.runners[Net.id] || race.runners[Net.id].done) { if (menus) menus.roomUpdate(); return; }
  startFree(entry, { challenge: ch, online: true, goAt: performance.now() + countdown * 1000 });
}

function updateTrialMarker(){
  if(R.trialMarker){R.trialMarker.removeFromParent();R.trialMarker.geometry.dispose();R.trialMarker.material.dispose();R.trialMarker=null;}
  const gate=R.trial?.gates[R.trial.next];if(!gate)return;
  // two glowing posts and a beam across the trail (white for the finish)
  const last=R.trial.next===R.trial.gates.length-1&&R.trial.lap===R.trial.race.laps,w=Math.min(gate.radius*1.4,26);
  const geo=mergeGeometries([new THREE.CylinderGeometry(.45,.55,11,10).translate(-w/2,5.5,0),new THREE.CylinderGeometry(.45,.55,11,10).translate(w/2,5.5,0),new THREE.BoxGeometry(w+1,1.3,.5).translate(0,11,0)]);
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:last?'#ffffff':'#62ffd0',fog:false}));
  mesh.position.set(gate.x,gate.y-1,gate.z);mesh.rotation.y=gate.heading;world.scene.add(mesh);R.trialMarker=mesh;
}
function beginTrial(race){
  R.trial=createTrial(world.ground,race);const gate=R.trial.gates[0];
  R.V.place(R.T,R.bike,{position:[gate.x-Math.sin(gate.heading)*8,gate.z-Math.cos(gate.heading)*8],heading:gate.heading});
  R.bike.hold=0;R.prev=R.cur=snap(R.bike);R.cam.init=false;R.goAt=performance.now()+3000;R.gateDown=false;R.beeped=0;R.acc=0;
  updateTrialMarker();showMessage('Ride through the green gates in order','small',3000);
}
$('#mx-trials').addEventListener('click',()=>{
 if(R.mode!=='free'||!R.running)return;
 for(const k of Object.keys(keys))keys[k]=false;for(const k of Object.keys(touch))touch[k]=false;
 R.paused=true;
 const close=UI.modal(h('div',{},h('h2',{},'Mini races'),h('p',{class:'muted'},'Choose a course. Your best time is saved on this device.'),
 h('div',{class:'stack'},R.def.races.map(r=>{const best=store.get(trialBestKey(R.def.id+(R.mtb?'-mtb':''),r.id),null);return h('button',{class:'btn btn-cyan',onclick:()=>{close();beginTrial(r);}},r.name+' · '+r.laps+' lap'+(r.laps>1?'s':'')+' · '+(best?'Best '+fmt(best.ms/1000):'No time yet'));})),
 R.trial?h('button',{class:'btn btn-ghost',onclick:()=>{R.trial=null;updateTrialMarker();close();}},'Cancel current race'):null),{onClose:()=>{R.paused=false;}});
});

async function chooseLivery(id) {
  prefs.livery = id; savePrefs();
  if (Account.user) { try { await Account.wear({ bike: id }); } catch (e) { UI.toast(e.message || 'Couldn’t save that', 'bad'); } }
  Sfx.play('coin');
  menus.refresh();
}

// ------------------------------------------------------------------ the 3D scene behind the menus
/* While the menus are up, the track you picked is drawn behind them: your bike (or everyone's in a room)
   parked in the start gate and a slow camera drifting round it, like a game's title screen. */
const app = $('#mx');
const chatEl = h('div', { class: 'mx-glass mx-chat' });   // (made once, so the chat keeps its messages)
let riding = false;
let menus = null;
// the minimap and the big map (M, or tap the minimap)
let wayMarker = null;
/** The minimap in the corner can be switched off in the settings (M still opens the big map). */
const showMinimap = () => { $('#hud-mini').hidden = prefs.minimap === 'off'; };
showMinimap();
const map = createMap({
  h, Sfx,
  rider: () => ({ x: R.bike ? R.bike.px : 0, z: R.bike ? R.bike.pz : 0, h: R.bike ? R.bike.h : 0 }),
  others: () => [...R.others.values()].filter((o) => o.snap).map((o) => ({ x: o.snap.px, z: o.snap.pz, color: o.color, name: o.name })),
  targets: () => {
    const t = [];
    if (R.trial) { const g = R.trial.gates[R.trial.next]; if (g) t.push({ x: g.x, z: g.z, color: '#5affb6' }); }
    const G = R.challenge?.def.gates, gi = R.challenge?.gate || 0;
    if (G && gi < G.length) t.push({ x: G[gi][0], z: G[gi][1], color: '#ffd23a' });
    else if (R.challenge?.finish) t.push({ x: R.challenge.finish[0], z: R.challenge.finish[1], color: '#7dffb5' });
    return t;
  },
  // fast travel: free ride on your own only (not in a challenge or a mini race, where it'd be a shortcut)
  canTravel: () => R.mode === 'free' && !R.challenge && !R.trial && !!R.bike && !R.bike.crashed,
  travel: (go, place) => {
    R.V.respawn(R.T, R.bike, 0, { position: go.position, heading: go.heading });
    R.bike.hold = 0; R.prev = R.cur = snap(R.bike); R.cam.init = false; R.safeTrail = [];
    showMessage(`🚀 ${place.name}`, 'small', 1600);
  },
  pause: (on) => {
    if (online()) return;   // (the others keep riding)
    R.paused = on;
    for (const k of Object.keys(keys)) keys[k] = false;
    for (const k of Object.keys(touch)) touch[k] = false;
  },
  onWaypoint: (wp) => {
    if (wayMarker) { wayMarker.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); wayMarker.removeFromParent(); wayMarker = null; }
    if (wp && world?.free) wayMarker = finishBeacon([wp.x, wp.z], '#ffd84a');
  },
});
const stage = { shot: 'home', list: [], bikes: new Map(), trackId: null, cam: { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false }, off: 0, last: 0, raf: 0, timer: null };
// where the camera sits for each menu: distance, height, angle from the bike's heading (0 = in front, π/2 = beside),
// how far it drifts and how fast, and how far the bikes are pushed right (to make room for the menus)
const SHOTS = {
  home: { r: 6.6, y: 1.9, ang: 0.95, swing: 0.45, speed: 0.07, look: 0.75, off: 0.2, fov: 46 },
  tracks: { r: 9, y: 3, ang: 1.15, swing: 0.5, speed: 0.06, look: 0.9, off: 0.2, fov: 50 },
  garage: { r: 4.3, y: 1.1, ang: 1.5, swing: 0.32, speed: 0.12, look: 0.72, off: 0.19, fov: 42 },
  room: { r: 10.5, y: 3.2, ang: 0.62, swing: 0.3, speed: 0.05, look: 0.8, off: 0.03, fov: 50 },
  // (the free-ride and challenge screens are wide grids, so the bike moves further right)
  worlds: { r: 8.4, y: 2.4, ang: 1.0, swing: 0.35, speed: 0.06, look: 0.8, off: 0.33, fov: 44 },
};
SHOTS.challenges = SHOTS.worlds;

/** Switch between the menus and the ride. */
function setRiding(on) {
  riding = on;
  app.classList.toggle('riding', on);
  if (on) {
    if (camera) camera.clearViewOffset();
    for (const sb of stage.bikes.values()) { sb.model.root.visible = false; if (sb.tag) sb.tag.visible = false; }
    return;
  }
  stopRide();
  fill($('#hud-center'));
  stage.cam.init = false;
  if(!world?.free){placeStage();stageStart();}
}

/** Show this track behind the menus (building it takes a moment, so there's a little "building" note). */
function stageTrack(id) {
  if (!renderer || !DATA) return;
  const def = trackDef(id);
  stage.trackId = def.id;
  if (world && worldKey === def.id + ':' + qualityLevel()) { placeStage(); stageStart(); return; }
  $('#mx-load').classList.add('on');
  clearTimeout(stage.timer);
  stage.timer = setTimeout(() => {
    $('#mx-load').classList.remove('on');
    if (riding) return;
    loadWorld(trackDef(stage.trackId));
    stage.cam.init = false;
    placeStage();
    stageStart();
  }, 60);
}
/** Menus with just you: your bike (or the paint job you're looking at in the garage). */
function stageSolo(livery, screen) {
  const snow = /^snow/.test(screen || '');   // (Carvvd's screens: you on your snowboard, on the snow track)
  const mtb = snow || /^mtb/.test(screen || '');   // (Unrevvd's screens: your mountain bike)
  const shot = snow ? screen.slice(4) : mtb ? screen.slice(3) : screen;
  stage.shot = SHOTS[shot] ? shot : 'home';
  stage.list = [{ id: 'me', look: snow ? { ...boardLook(), board: boardColor(), gear: gear() } : mtb ? mtbLook() : { ...myLook(), ...(livery ? { livery } : {}) } }];
  if (mtb) preloadBike(prefs.mtbModel, snow ? 'snow' : mtbRider()).then(() => placeStage());
  stageTrack(snow ? 'snow' : prefs.track);
}
/** In a room: everyone's bike in the start gate, with name tags (✔ = ready). */
function stageRoom() {
  stage.shot = 'room';
  const riders = (Room.players || []).filter((p) => !p.watch && p.online !== false).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  stage.list = riders.map((p) => ({ id: p.id, look: p.id === Net.id ? myLook() : { ...(state.styles[p.id] || {}), livery: LIVERIES[p.bike] ? p.bike : 'factory' }, name: p.name, color: p.color,
    ready: !!state.ready[p.id] && state.phase !== 'racing' }));
  const t = state.settings.track;
  stageTrack(t === 'random' || !DATA.tracks.some((x) => x.id === t) ? (worldKey ? worldKey.split(':')[0] : prefs.track) : t);
}
function dropTag(sb) { if (sb.tag) { sb.tag.removeFromParent(); sb.tag.material.map.dispose(); sb.tag.material.dispose(); sb.tag = null; } }
/** Park the bikes in the start gate. */
function placeStage() {
  if(world?.free)return;
  if (!world || riding) return;
  const T = world.T;
  // (what's left over from the last ride goes)
  if (R.model) R.model.root.visible = false;
  for (const o of R.others.values()) { if (o.model) o.model.root.visible = false; if (o.tag) o.tag.visible = false; }
  for (const gg of world.gates) gg.rotation.z = 0;
  const keep = new Set();
  stage.list.slice(0, LANES.length).forEach((e, i) => {
    keep.add(e.id);
    let sb = stage.bikes.get(e.id);
    if (!sb) { sb = { id: e.id, model: null, tag: null, tagKey: '' }; stage.bikes.set(e.id, sb); }
    const lookKey = JSON.stringify(e.look) + bikesLoaded();
    if (sb.model && sb.lookKey !== lookKey) { disposeBike(sb.model); sb.model = null; }
    if (!sb.model) { sb.model = makeBike(e.look); if (e.look.board) boardify(sb.model, e.look.board, e.look.gear); sb.lookKey = lookKey; }
    if (sb.model.root.parent !== world.scene) world.scene.add(sb.model.root);
    sb.model.root.visible = true;
    const b = C.newBike(T, T.start, stage.list.length > 1 ? LANES[i] : 0);
    const sn = snap(b);
    poseBike(sb.model, sn, placer(sn), sn.h, 0);
    const tagKey = e.name ? `${e.ready ? '✔ ' : ''}${e.name}|${e.color}` : '';
    if (sb.tagKey !== tagKey) {
      dropTag(sb); sb.tagKey = tagKey;
      if (tagKey) { sb.tag = nameTag((e.ready ? '✔ ' : '') + e.name, e.color || '#888888'); sb.tag.scale.multiplyScalar(0.75); }
    }
    if (sb.tag) {
      if (sb.tag.parent !== world.scene) world.scene.add(sb.tag);
      sb.tag.visible = true;
      sb.tag.position.copy(sb.model.root.position).add(tmpV.set(0, i % 2 ? 2.55 : 2.1, 0));   // (every other one higher, so neighbours' tags don't overlap)
    }
  });
  for (const [id, sb] of stage.bikes) if (!keep.has(id)) { disposeBike(sb.model); dropTag(sb); stage.bikes.delete(id); }
}
function stageStart() {
  if (stage.raf || riding || !renderer) return;
  stage.last = performance.now();
  stage.raf = requestAnimationFrame(stageLoop);
}
function stageLoop(now) {
  stage.raf = 0;
  if (riding) return;
  stage.raf = requestAnimationFrame(stageLoop);
  const dt = Math.min(0.1, (now - stage.last) / 1000); stage.last = now;
  if (world && !document.hidden) stageFrame(now, dt);
}
const focusV = new THREE.Vector3(); const wantV = new THREE.Vector3(); const lookV = new THREE.Vector3();
function stageFrame(now, dt) {
  if(world?.free)return;
  const T = world.T; const sh = SHOTS[stage.shot] || SHOTS.home;
  // look at the middle of the parked bikes
  focusV.set(0, 0, 0); let n = 0;
  for (const sb of stage.bikes.values()) if (sb.model.root.visible) { focusV.add(sb.model.root.position); n++; }
  if (n) focusV.divideScalar(n); else { const p = C.pathAt(T, T.start); focusV.set(p.x, C.heightAt(T, T.start, 0), p.z); }
  focusV.y += sh.look;
  const heading = C.pathAt(T, T.start).h;
  const ang = heading + sh.ang + Math.sin(now / 1000 * sh.speed) * sh.swing;
  wantV.set(focusV.x + Math.cos(ang) * sh.r, focusV.y + sh.y, focusV.z + Math.sin(ang) * sh.r);
  wantV.y = Math.max(wantV.y, groundUnder(wantV.x, wantV.z, T.start, T) + 0.9);
  const cam = stage.cam;
  if (!cam.init) { cam.pos.copy(wantV); cam.look.copy(focusV); cam.init = true; camera.fov = sh.fov; }
  cam.pos.lerp(wantV, 1 - Math.exp(-dt * 1.8)); cam.look.lerp(focusV, 1 - Math.exp(-dt * 2.6));
  camera.position.copy(cam.pos); camera.up.set(0, 1, 0); camera.lookAt(cam.look);
  camera.fov += (sh.fov - camera.fov) * (1 - Math.exp(-dt * 2.5));
  // push the bikes right on a wide screen, so the menus on the left don't hide them
  const W = canvas.clientWidth || innerWidth; const H = canvas.clientHeight || innerHeight;
  const want = W > 760 ? W * sh.off : 0;
  stage.off += (want - stage.off) * (1 - Math.exp(-dt * 3));
  if (Math.abs(stage.off) > 0.5) camera.setViewOffset(W, H, -stage.off, 0, W, H); else { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  world.update(focusV, dt, camera);
  renderer.render(world.scene, camera);
}

// ------------------------------------------------------------------ buttons and keys
/** Out of the room's free ride (back in the room). */
function leftFreeRide() {
  R.freeOnline = false;
  const url = new URL(location.href); url.searchParams.delete('free'); url.searchParams.delete('world'); history.replaceState(null, '', url);
}
function quit() {
  if (online() && window.Room && Room.code) {
    if (R.freeOnline) { Net.send('g:part'); leftFreeRide(); }   // (out of the free ride, back to the room: Join the ride gets you back in)
    setRiding(false); menus.show('room'); return;
  }
  const wasChallenge = !!R.challenge; R.challenge = null;
  setRiding(false);
  const hub = R.veh || (R.water ? 'water' : R.board ? 'snow' : R.mtb ? 'mtb' : null);   // (back to the menu of the mode you were riding)
  menus.show(hub ? hub + (wasChallenge ? 'challenges' : hub === 'mtb' && R.mode === 'free' ? 'worlds' : '') : (wasChallenge ? 'challenges' : R.mode==='free'?'worlds':'tracks'));
  const url = new URL(location.href); for (const k of ['free', 'world', 'track', 'mtb', 'water', 'board', 'tow', 'veh']) url.searchParams.delete(k); history.replaceState(null, '', url);
}
$('#mx-quit').addEventListener('click', quit);
// (the whole page goes full screen, not just the game, so pop-ups like signing in still show)
const fullScreen = () => {
  const root = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
};
$('#mx-full').addEventListener('click', fullScreen);
$('#mx-fs').addEventListener('click', fullScreen);
const muteBtn = $('#mx-mute');
const showMute = () => { muteBtn.textContent = $('#mx-snd').textContent = Sfx.muted ? '🔇' : '🔊'; };
muteBtn.addEventListener('click', () => Sfx.setMuted(!Sfx.muted));
$('#mx-snd').addEventListener('click', () => Sfx.setMuted(!Sfx.muted));
PA.on('muted', () => { showMute(); if (menus && menus.screen === 'controls') menus.refresh(); });
showMute();
$('#mx-photo').addEventListener('click', () => startPhoto());
$('#mx-replay').addEventListener('click', () => startReplay());
const camBtn = $('#mx-cam');
const CAMS = ['chase', 'side', 'close', 'first'];
camBtn.addEventListener('click', () => { R.camMode = CAMS[(CAMS.indexOf(R.camMode) + 1) % CAMS.length]; prefs.cam = R.camMode; savePrefs(); R.cam.init = false; showMessage(`${R.camMode.toUpperCase()} CAMERA`, 'small', 900); });

addEventListener('keydown', (e) => {
  const typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (!riding) {
    if (e.code === 'KeyM' && !e.repeat && !typing) Sfx.setMuted(!Sfx.muted);
    else if (menus) menus.onKey(e);
    return;
  }
  if(document.querySelector('.modal-backdrop'))return;
  if (studio && studio.key(e, true)) return;
  if (map.isOpen) { if (e.code === 'Escape' || e.code === 'KeyM') map.close(); return; }
  if (e.code === 'Escape' && !typing) { quit(); return; }
  if (!R.running) return;
  if (R.audio && R.audio.ctx.state === 'suspended') R.audio.ctx.resume();   // (browsers only allow sound after a key press or tap)
  if (typing) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR') respawnNow();
  else if (e.code === 'KeyC' && !e.repeat) camBtn.click();
  else if (e.code === 'KeyM' && !e.repeat) map.open();   // (mute is the 🔊 button while riding)
  else if (e.code === 'KeyP' && !e.repeat) startPhoto();
  else if (e.code === 'KeyV' && !e.repeat) startReplay();
  else if (e.code === 'Enter' && R.mode === 'solo' && (R.finished || performance.now() > R.goAt)) startSolo(R.def);
  else if (e.code === 'Enter' && R.challenge && R.challenge.done && !R.challenge.online) { if (R.onEnter) R.onEnter(); else startChallengeSolo(R.challenge.def); }
  else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && R.spectate && !e.repeat) switchWatch(e.code === 'ArrowRight' ? 1 : -1);
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (studio) studio.key(e, false); });
addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });
for (const btn of document.querySelectorAll('#mx .mx-touch [data-k]')) {
  const k = btn.dataset.k;
  const set = (v) => (e) => {
    e.preventDefault();
    if (R.audio && R.audio.ctx.state === 'suspended') R.audio.ctx.resume();
    if (k === 'respawn') { if (v) respawnNow(); return; }
    touch[k] = v; btn.classList.toggle('on', v);
  };
  btn.addEventListener('pointerdown', set(true)); btn.addEventListener('pointerup', set(false)); btn.addEventListener('pointercancel', set(false)); btn.addEventListener('pointerleave', set(false));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const k of Object.keys(keys)) keys[k] = false; });

// ------------------------------------------------------------------ online races
const state = { phase: 'lobby', settings: { track: 'desert' }, race: null, results: null, wins: {}, ready: {}, styles: {}, min: 2 };
const playerOf = (id) => (window.Room && Room.player(id)) || { name: '?', color: '#888888', avatar: '🏍️' };

function startRace(race, countdown, watch = false) {
  state.race = race; state.phase = 'racing'; state.results = null;
  const def = trackDef(race.track);
  const me = race.runners[Net.id];
  R.spectate = watch || !me || me.done;
  fillOthers(race);
  begin(def, 'online', performance.now() + countdown * 1000);
}
/** The other riders in this race (or challenge), drawn as see-through bikes with name tags. */
function fillOthers(race) {
  for (const o of R.others.values()) dropOther(o);
  R.others.clear();
  for (const id of Object.keys(race.runners)) {
    if (id === Net.id) continue;
    const p = playerOf(id);
    // a rider who picked a paint job shows up in its colour, everyone else in their player colour
    const paint = p.bike && p.bike !== 'factory' && LIVERIES[p.bike] ? LIVERIES[p.bike].plastic : null;
    R.others.set(id, { id, buf: [], x: race.runners[id].x || null, lane: 0, name: p.name, color: paint || p.color || '#888888', model: null, tag: null, ang: [0, 0], done: race.runners[id].done });
  }
}
function addOtherModel(o) {
  if (!world) return;
  dropOther(o);
  o.lane = laneFor(o.id);
  const st = state.styles[o.id] || {};
  if (R.buggy || R.wing) { o.model = R.wing ? makeWingsuit(st.wing || '#ff4fa3') : makeCar('buggy', st.buggy || 'arancio'); world.scene.add(o.model.root); o.tag = nameTag(o.name, o.color); world.scene.add(o.tag); return; }   // (a Drivvd challenge: everyone's in a buggy)
  o.model = makeBike({ ...st, ...(R.mtb ? { model: MTB_MODELS[st.mtb] ? st.mtb : 'dh', rider: R.board ? 'snow' : mtbRider(st.mrider) } : {}), ghost: o.color });   // (an Unrevvd challenge: everyone's on a mountain bike, as their Unrevvd rider)
  if (R.board) boardify(o.model, o.color, st.cgear === 'skis' ? 'skis' : 'board');   // (everyone in a Carvvd challenge is on a board or skis)
  if (R.water) jetskify(o.model, o.color); if (R.sled) sledify(o.model, o.color); if (R.skate) skateify(o.model, o.color);
  world.scene.add(o.model.root);
  o.tag = nameTag(o.name, o.color);
  world.scene.add(o.tag);
}
/** Someone who hopped into the free ride after you. */
function addRider(id) {
  const p = playerOf(id);
  R.others.set(id, { id, buf: [], x: null, lane: 0, name: p.name, color: p.color || '#888888', model: null, tag: null, ang: [0, 0], done: false });
  if (state.race && !state.race.runners[id]) state.race.runners[id] = { done: false, x: 0, cp: -1 };
}
/** Free ride together: another rider's own bike or supercar (as their last message says), made when they first show up
    or switch, and drawn solid in their paint (in races the others are see-through). */
function ensureOtherModel(o, m) {
  const st = state.styles[o.id] || {};
  const carId = CAR_MODELS[st.car] ? st.car : 'revuelto';
  const mtbId = MTB_MODELS[st.mtb] ? st.mtb : 'dh';
  const kind = m.v === 8 ? `wing:${st.wing || ''}` : m.v === 7 ? `buggy:${st.buggy || ''}` : m.v === 1 ? `car:${carId}:${st.paint || ''}` : `${m.v >= 2 && m.v !== 6 ? `v${m.v}:` + mtbId + ':' + mtbRider(st.mrider) : 'bike'}:${bikesLoaded()}`;   // (a bike model file that has just loaded replaces its stand-in)
  if (o.kind === kind && o.model) return;
  dropOther(o); o.kind = kind;
  if (m.v === 8) { o.model = makeWingsuit(st.wing || '#ff4fa3'); preloadExtra('parachute'); }   // (Skyvvd)
  else if (m.v === 7) { o.model = makeCar('buggy', st.buggy || 'arancio'); preloadExtra('buggy').then((ok) => { if (ok && o.kind === kind) o.kind = null; }); }   // (Drivvd: the model swaps in once it's loaded)
  else if (m.v === 1) {
    o.model = makeCar(carId, st.paint || 'arancio');
    // (the model file may still be loading: it shows as the wedge until then, and is swapped in once it's here)
    if (CAR_MODELS[carId].file && !o.model.file) preloadCar(carId).then((ok) => { if (ok && o.kind === kind) o.kind = null; });
  } else {
    o.model = makeBike({ ...st, ...(m.v >= 2 && m.v !== 6 ? { model: mtbId, rider: m.v === 3 ? 'snow' : mtbRider(st.mrider) } : {}), livery: playerOf(o.id).bike });
    if (m.v === 3) boardify(o.model, st.boardColor || '#2a7fff', st.cgear === 'skis' ? 'skis' : 'board');   // (Carvvd)
    else if (m.v === 4) jetskify(o.model, st.jet || '#18b6d6');   // (Wavvd)
    else if (m.v === 5) boardify(o.model, st.jet || '#18b6d6', 'board');   // (wakeboarding)
    else if (m.v === 6) sledify(o.model, st.sled || '#ff5a1f');   // (Sledvvd)
    else if (m.v === 9) skateify(o.model, st.skate || '#ff4fa3');   // (Grindvvd)
    coverOn(o.model);
  }
  world.scene.add(o.model.root);
  o.tag = nameTag(o.name, o.color); world.scene.add(o.tag);
}
function dropOther(o) {
  if (o.model) { disposeModel(o.model); o.model = null; }
  if (o.tag) { if (o.tag.parent) o.tag.parent.remove(o.tag); o.tag.material.map.dispose(); o.tag.material.dispose(); o.tag = null; }
}
function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 30px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(name).width + 34);
  g.fillStyle = 'rgba(10,12,20,.6)'; g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 24); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(128 - w / 2 + 20, 32, 7, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.fillText(name, 128 + 8, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(2.4, 0.6, 1); sp.renderOrder = 5;
  return sp;
}

/** Another rider's position message -> a snapshot poseBike understands (their upright plane, with x = 0 at the frame). */
function otherSnap(m, o) {
  const P = C.P; const ca = Math.cos(m.a); const sa = Math.sin(m.a);
  const wheel = (k, c, ang) => { const S = P.SUS[k]; const lx = S.p[0] + S.u[0] * c; const ly = S.p[1] + S.u[1] * c; return [ca * lx - sa * ly, m.y + sa * lx + ca * ly, ang]; };
  return {
    x: 0, y: m.y, a: m.a, wf: wheel(0, m.c0, o.ang[0]), wr: wheel(1, m.c1, o.ang[1]), rx: m.rx, ry: m.y + m.ry, lean: m.l,
    px: m.px, pz: m.pz, h: m.h, s: m.x, roll: m.ro,
    boost: !!m.b, crashed: m.k, ragdoll: m.rg ? { hip: { x: m.rg[0], y: m.rg[1] }, head: { x: m.rg[2], y: m.rg[3] } } : null,
    tk: m.tk ?? -1, tp: m.tp || 0, wh: m.wh || 0, sp: m.sp || 0, th: m.th || 0, v: (m.s || 0) / 3.6,
  };
}
const DELAY = 130;   // draw the others a moment in the past, so there are always two messages to blend between
function sampleOther(o, now) { return sampleBuf(o.buf, now - DELAY); }
/** A position message at time t (ms), blended between the two around it in buf ([{at, ...}], oldest first). */
function sampleBuf(buf, t) {
  if (!buf.length) return null;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].at > t) i--;
  const b = buf[i]; const a = buf[Math.max(0, i - 1)];
  if (a === b || b.at <= a.at) return b;
  const k = Math.max(0, Math.min(1.2, (t - a.at) / (b.at - a.at)));
  const L = (p, q) => p + (q - p) * k;
  const out = { ...b };
  for (const f of ['x', 'y', 'rx', 'ry', 'c0', 'c1', 'c2', 'c3', 'st', 'l', 's', 'px', 'pz', 'ro', 'tp', 'wh']) out[f] = L(a[f] || 0, b[f] || 0);
  out.a = lerpA(a.a, b.a, k); out.h = lerpA(a.h, b.h, k);
  return out;
}
/** Watching the others (after you finish, or a race you joined late): the one picked with ← → (the leader at first). */
function watching(leader) {
  const o = R.watchId && R.others.get(R.watchId);
  return o && o.snap && o.model?.root.visible ? o : leader && leader.snap ? leader : null;
}
function switchWatch(dir) {
  const list = [...R.others.values()].filter((o) => o.snap && o.model);
  if (!list.length) return;
  const i = list.findIndex((o) => o.id === R.watchId);
  R.watchId = list[((i < 0 ? 0 : i + dir) + list.length) % list.length].id; R.cam.init = false;
}
function watchLine() {
  const o = R.watchId && R.others.get(R.watchId);
  return `WATCHING ${o ? o.name.toUpperCase() : 'THE LEADER'} · ← → SWITCH · C CAMERA`;
}
function drawOthers(now, dt) {
  if (!online() || !world) return null;
  let leader = null;
  for (const o of R.others.values()) {
    const last = o.buf[o.buf.length - 1];
    if (R.freeOnline && last) ensureOtherModel(o, last);
    if (!o.model) continue;
    const m = sampleOther(o, now);
    const show = !!m && !(R.freeOnline && now - last.at > 4000);   // (free ride: someone who stopped sending, e.g. in a menu, fades out)
    o.model.root.visible = show; if (o.tag) o.tag.visible = show;
    if (!show) continue;
    o.ang[0] += (m.s / 3.6 / 0.35) * dt; o.ang[1] += (m.s / 3.6 / 0.34) * dt;
    if (o.model.car) {
      poseCar(o.model, { px: m.px, pz: m.pz, y: m.y, h: m.h, car: { p: m.a, r: m.ro, st: m.st || 0, w: o.ang, c: [m.c0, m.c1, m.c2 || 0, m.c3 || 0] } });
      o.tag.position.copy(o.model.root.position).add(tmpV.set(0, 2.1, 0));
      o.snap = { px: m.px, pz: m.pz, y: m.y, h: m.h, s: m.x };
      continue;
    }
    const s = otherSnap(m, o);
    o.place = placer(s);
    poseBike(o.model, s, o.place, s.h, now / 1000);
    leaveTracks(o.id, o.model, s.crashed, o.color); settle(o.model, s.crashed, dt, s.v || 0);
    o.tag.position.copy(o.model.root.position).add(tmpV.set(0, 2.1, 0));
    o.snap = s;
    if (!leader || s.s > leader.snap.s) leader = o;
  }
  return leader;
}
function sendPos(force) {
  const b = R.bike;
  if (!b || R.spectate || (R.finished && !force) || !state.race) return;
  R.sentAt = performance.now();
  Net.send('g:pos', posMsg(b));
}
/** Your bike's position message (what the others, and a ghost, need to draw it). */
function posMsg(b) {
  const r2 = (v) => Math.round(v * 1000) / 1000;
  // x = how far along the track (for the order), px/pz/h = where you are and which way you point,
  // the rest is the bike's pose in its upright plane (relative to the frame)
  const msg = { x: r2(b.s), px: r2(b.px), pz: r2(b.pz), h: r2(b.h), ro: r2(R.roll), y: r2(b.y), a: r2(b.a), rx: r2(b.rx - b.x), ry: r2(b.ry - b.y),
    c0: r2(b.wh[0].c), c1: r2(b.wh[1].c), l: r2(b.lean), tk: b.tk, tp: r2(b.pose), wh: r2(b.whip), sp: r2(b.spin),
    s: Math.round(Math.hypot(b.vx, b.vy) * 36) / 10, r: Math.round(b.rpm), th: r2(b.thr), k: b.crashed ? 1 : 0, b: b.boost ? 1 : 0, cp: b.cp };
  if (R.car) Object.assign(msg, { v: R.wing ? 8 : R.buggy ? 7 : 1, ro: r2(b.roll), st: r2(b.steer), c0: r2(b.comp[0]), c1: r2(b.comp[1]), c2: r2(b.comp[2]), c3: r2(b.comp[3]) });   // (the supercar)
  else if (R.sled) msg.v = 6;   // (a snowmobile)
  else if (R.skate) msg.v = 9;   // (a skateboard)
  else if (R.tow) msg.v = 5;   // (a wakeboard)
  else if (R.water) msg.v = 4;   // (a jet ski)
  else if (R.board) msg.v = 3;   // (a snowboard or skis)
  else if (R.mtb) msg.v = 2;   // (a mountain bike)
  if (b.crashed && b.rider) msg.rg = [r2(b.rider.hip.x - b.x), r2(b.rider.hip.y), r2(b.rider.head.x - b.x), r2(b.rider.head.y)];
  return msg;
}
function standings() {
  if (!state.race) return [];
  const race = state.race;
  if (race.challenge && R.challenge) {
    // timed challenges: best score first; races: finished riders in order, then whoever is closest to the finish
    const f = R.challenge.finish;
    return Object.entries(race.runners).map(([id, r]) => {
      const me = id === Net.id; const o = R.others.get(id); const last = o && o.buf[o.buf.length - 1];
      const at = me && R.bike ? [R.bike.px, R.bike.pz] : last ? [last.px, last.pz] : null;
      const score = me ? R.challenge.score : r.score ?? 0;
      return { id, done: r.done, place: r.place, x: f ? (at ? -Math.hypot(at[0] - f[0], at[1] - f[1]) : -1e9) : score, score };
    }).map((r) => (race.kind === 'tag' ? { ...r, score: race.itTimes?.[r.id] ?? 0 } : r))
      .sort((p, q) => (race.kind === 'race' || race.kind === 'relay' ? (p.done !== q.done ? (p.done ? -1 : 1) : p.done ? p.place - q.place : q.x - p.x) : race.kind === 'tag' ? p.score - q.score : q.score - p.score));
  }
  return Object.entries(state.race.runners).map(([id, r]) => {
    const x = id === Net.id && R.bike ? R.bike.s : (R.others.get(id) || {}).x ?? r.x;
    return { id, done: r.done, place: r.place, x: x || 0 };
  }).sort((p, q) => (p.done !== q.done ? (p.done ? -1 : 1) : p.done ? p.place - q.place : q.x - p.x));
}
function myPlace() { return Math.max(1, standings().findIndex((r) => r.id === Net.id) + 1); }
function drawBoard() {
  const rows = standings().slice(0, 6);
  fill($('#hud-board'), rows.map((r, i) => {
    const p = playerOf(r.id);
    const o = R.others.get(r.id);
    const k = state.race && state.race.challenge && state.race.kind;
    const extra = k === 'tag' ? (state.race.it === r.id ? ' · 🏷️ IT' : ` · ${fmtScore(k, r.score)}`) : k && k !== 'race' && k !== 'relay' ? (r.score ? ` · ${fmtScore(k, r.score)}` : '') : r.done ? ' 🏁' : '';   // (timed challenges: everyone's best so far)
    return h('div', { class: r.id === Net.id ? 'me' : '' }, h('i', { style: { background: (o && o.color) || p.color || '#888' } }), R.freeOnline ? p.name : `${i + 1}. ${p.name}`, extra);
  }));
}
function otherSounds(b) {
  return [...R.others.values()].filter((o) => o.buf.length && o.model && o.buf[o.buf.length - 1].v !== 2).map((o) => {   // (bicycles have no engine to hear)
    const m = o.buf[o.buf.length - 1];
    return { id: o.id, rpm: m.r, thr: m.th, dist: R.mode === 'free' ? Math.hypot(m.px - b.px, m.pz - b.pz) : m.x - b.s, lane: 0 };
  }).sort((p, q) => Math.abs(p.dist) - Math.abs(q.dist));
}
function onlineFinish(t) {
  const b = R.bike;
  Net.send('g:finish', { time: Math.round(t * 1000), cp: b.cp, crashes: b.crashes, flips: b.flips });
  fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, '🏁 Finished!'), h('div', { class: 'mx-big' }, fmt(t)), h('p', { class: 'muted' }, 'Waiting for the others…')));
}

const inRoom = () => !!(window.Room && Room.code);
let pendingChallenge = null;   // a room made from the challenges screen starts on that challenge
let pendingFree = null;        // ...and one made from the free-ride screen on that world
/** The room's free ride started (or you hopped into it). */
function startFreeRoom(race) {
  state.race = race; state.phase = 'racing'; state.results = null;
  const entry = WORLDS.find((w) => w.id === race.free);
  if (!entry || !race.runners[Net.id]) { if (menus) menus.roomUpdate(); return; }
  if (riding && R.freeOnline && R.def?.id === race.free) return;   // (already riding it)
  startFree(entry, { online: true });
}
Lobby.on('joined', (m) => {
  Object.assign(state, m.state);
  Net.send('g:style', { style: netStyle() });
  const url = new URL(location.href); url.searchParams.delete('solo'); url.searchParams.delete('track'); history.replaceState(null, '', url);
  if (Room.isHost && pendingChallenge) Net.send('g:settings', { mode: 'challenge', challenge: pendingChallenge });   // (made from the challenges screen)
  if (Room.isHost && pendingFree) Net.send('g:settings', { mode: 'free', world: pendingFree });   // (made from the free-ride screen)
  pendingChallenge = null; pendingFree = null;
  if (state.phase === 'racing' && state.race && state.race.free) { setRiding(false); menus.show('room'); Net.send('g:hop'); }   // (a free ride is on: ride straight in)
  else if (state.phase === 'racing' && state.race && state.race.challenge) { setRiding(false); menus.show('room'); }   // (wait for the next one)
  else if (state.phase === 'racing' && state.race) startRace(state.race, Math.max(0, -state.race.elapsed));
  else { setRiding(false); menus.show('room'); }
});
Lobby.on('players', () => menus.roomUpdate());
Lobby.on('privacy', () => menus.roomUpdate());
Lobby.on('left', () => { stopRide(); });
// back out of a room (or a room that wasn't there): to the "race online" menu
Lobby.on('entry', () => {
  if (!menus) return;
  const was = menus.screen;
  setRiding(false);
  menus.show(was === 'room' || was === 'joining' ? 'online' : 'home');
});
Net.on('error', () => { if (menus && menus.screen === 'joining' && !inRoom()) menus.show('online'); });
Net.on('g:lobby', (m) => {
  state.settings = m.settings; state.ready = m.ready || {}; if (m.styles) state.styles = m.styles; if (m.min) state.min = m.min; if (m.phase !== 'racing') state.phase = m.phase;
  menus.roomUpdate();
});
Net.on('g:start', (m) => { if (m.race.free) startFreeRoom(m.race); else if (m.race.challenge) startChallenge(m.race, m.countdown); else startRace(m.race, m.countdown); });
Net.on('g:hop', (m) => {
  if (state.race && state.race.free && !state.race.runners[m.id]) state.race.runners[m.id] = { done: false, x: 0, cp: -1 };
  if (R.freeOnline && m.id !== Net.id && !R.others.has(m.id)) { addRider(m.id); UI.toast(`🏍️ ${playerOf(m.id).name} rode in`, '', 1800); }
  menus.roomUpdate();
});
Net.on('g:part', (m) => {
  if (state.race && state.race.runners) delete state.race.runners[m.id];
  const o = R.others.get(m.id); if (o) { dropOther(o); R.others.delete(m.id); }
  menus.roomUpdate();
});
Net.on('g:freeEnd', () => {
  state.race = null; state.phase = 'lobby';
  if (riding && R.freeOnline) { setRiding(false); leftFreeRide(); menus.show('room'); if (!Room.isHost) UI.toast('The host ended the free ride', '', 2500); }
  else menus.roomUpdate();
});
Net.on('g:score', (m) => { if (state.race && state.race.runners[m.id]) state.race.runners[m.id].score = m.score; });
Net.on('g:pos', (m) => {
  if (!online()) return;
  if (R.freeOnline && !R.others.has(m.id) && m.id !== Net.id) addRider(m.id);   // (someone who hopped in after you)
  const o = R.others.get(m.id); if (!o) return;
  m.at = performance.now();
  o.buf.push(m); if (o.buf.length > 14) o.buf.shift();
  o.x = m.x;
});
Net.on('g:finish', (m) => {
  if (state.race && state.race.runners[m.id]) Object.assign(state.race.runners[m.id], { done: true, place: m.place, time: m.time });
  const o = R.others.get(m.id); if (o) o.done = true;
  if (m.id === Net.id) {
    const nth = m.place === 1 ? '🥇 You won!' : `🏁 ${m.place === 2 ? '2nd' : m.place === 3 ? '3rd' : m.place + 'th'} place`;
    if (m.place === 1) UI.confetti(220);
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, nth), h('div', { class: 'mx-big' }, fmt(m.time / 1000)), h('p', { class: 'muted' }, 'Waiting for the others…')));
  } else UI.toast(`🏁 ${playerOf(m.id).name} finished ${m.place === 1 ? 'first!' : `#${m.place}`}`, m.place === 1 ? 'good' : '', 2200);
});
Net.on('g:tag', (m) => {
  if (!state.race) return;
  state.race.it = m.it; state.race.itTimes = m.itTimes;
  if (!R.running || !R.challenge) return;
  if (m.it === Net.id) { showMessage('🏷️ YOU’RE IT!', 'bad', 1600); R.audio?.crash(); }
  else if (m.by === Net.id) { showMessage('TAGGED! 🏷️ RUN!', 'cp', 1400); R.audio?.chime(); }
  else showMessage(`🏷️ ${playerOf(m.it).name} is it`, 'small', 1200);
});
Net.on('g:relay', (m) => {
  if (!state.race?.carrier) return;
  state.race.carrier[m.team] = m.carrier; state.race.leg[m.team] = m.leg;
  if (!R.running || !R.challenge) return;
  if (m.carrier === Net.id) { showMessage(m.by ? '🏮 YOU’VE GOT THE LANTERN! GO!' : '🏮 THE LANTERN’S YOURS NOW', 'cp', 1800); R.audio?.chime(); }
  else if (m.by === Net.id) showMessage('🏮 PASSED IT ON!', 'cp', 1400);
});
Net.on('g:hurry', (m) => { if (R.running && !R.finished && !R.spectate) showMessage(`Someone finished! ${m.seconds}s left`, 'bad', 3000); });
Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
/** How a results row's score reads: a time, or a challenge score with its unit. */
const resultText = (res, r) => (res.challenge && res.kind !== 'race' && res.kind !== 'relay' ? (r.done ? fmtScore(res.kind, r.score) : 'No score') : r.done ? fmt(r.time / 1000) : 'DNF');
Net.on('g:results', (m) => {
  state.results = m.results; state.wins = m.wins || {}; state.phase = 'results';
  const racing = riding && online();
  const res = m.results;
  if (res.challenge) {   // coins for taking part, more for a podium
    const mine = res.rows.find((r) => r.id === Net.id);
    if (mine) { const pay = mine.done ? [100, 60, 40][mine.place - 1] || 20 : 10; payCoins(pay, true, purse(CHALLENGES.find((c) => c.id === res.challenge)?.vehicle === 'mtb')); UI.toast(`+${pay} 🪙 coins`, 'good', 2500); }
  }
  if (racing) {
    const rows = res.rows; const ch = res.challenge && CHALLENGES.find((c) => c.id === res.challenge);
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, ch ? `${ch.emoji} Results` : '🏁 Results'),
      h('div', { class: 'rows' }, rows.slice(0, 6).map((r) => h('div', {}, h('span', {}, r.done ? ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}` : '–'), h('span', { class: 'grow' }, r.name), h('b', {}, resultText(res, r)))))));
  }
  const ride = R.ride;
  setTimeout(() => {
    if (state.phase !== 'results' || R.ride !== ride || !inRoom()) return;
    if (riding) setRiding(false);
    menus.show('room');
  }, racing ? 4500 : 100);
});

// ------------------------------------------------------------------ start
async function init() {
  try { DATA = await (await fetch('/js/games/moto/tracks.json')).json(); } catch { UI.toast('Couldn’t load the tracks 😵', 'bad'); return; }
  try{WORLDS=(await(await fetch('/js/games/moto/open-world/manifest.json')).json()).worlds;}catch{UI.toast('Free ride worlds could not load','bad');}
  try { CHALLENGES = (await (await fetch('/js/games/moto/open-world/challenges.json')).json()).challenges; } catch { /* (the challenges menu just stays empty) */ }
  if (!DATA.tracks.some((t) => t.id === prefs.track)) prefs.track = DATA.tracks[0].id;
  if (setupRenderer()) resize();
  menus = createMenus({
    get DATA() { return DATA; }, trackDef, prefs, savePrefs, bestOf, MEDALS, medalTimes, medalFor, fmt, LIVERIES, state,
    get unlocked() { return unlocked; }, get bikeList() { return bikeList; }, bikeHints, myLivery, chooseLivery,
    chat: chatEl,
    startSolo,startFree,get worlds(){return WORLDS.filter((w)=>!w.hidden);},get allWorlds(){return WORLDS;},   // (a hidden world is only for its challenge)
    get challenges() { return CHALLENGES; }, challengeBest, fmtScore, startChallengeSolo, Chutes, startCup, challengeFriends: (c) => { pendingChallenge = c.id; }, Coins,
    watchRace: () => { if (state.race) startRace(state.race, 0, true); },
    MODELS, RIDERS, KITS, HELMETS, get style() { return prefs.style; }, setStyle,
    setCam: (k) => { prefs.cam = R.camMode = k; savePrefs(); },
    setMinimap: (k) => { prefs.minimap = k; savePrefs(); showMinimap(); },
    CAR_PAINTS, CAR_MODELS, paintable, setVehicle: (k) => { prefs.vehicle = k; savePrefs(); Sfx.play('click'); if (k === 'car') preloadCar(prefs.carModel); if (k === 'mtb') preloadBike(prefs.mtbModel); },
    setPhysics: (k) => { prefs.physics = k; savePrefs(); },
    setCarModel: (k) => { prefs.carModel = k; savePrefs(); Sfx.play('click'); preloadCar(k); if (inRoom()) Net.send('g:style', { style: netStyle() }); },
    setCarPaint: (k) => { prefs.carPaint = k; savePrefs(); Sfx.play('click'); if (inRoom()) Net.send('g:style', { style: netStyle() }); },
    rideWithFriends: (w, vehicle) => { pendingFree = w.id; if (vehicle) { prefs.vehicle = vehicle; savePrefs(); } },
    MTB_MODELS, MTB_RIDERS, setMtbModel, setMtbRider, startMtbFree: (w) => startFree(w, { mtb: true }), BOARDS, WEATHER, SKIES, gear, startBoardFree: (w) => startFree(w, { board: true }), startWaterFree: (w) => startFree(w, { water: true }), startTowFree: (w) => startFree(w, { tow: true }), startVehFree: (w, veh) => startFree(w, { veh }), sledColor, buggyPaint, wingColor, skateColor, Career, careerReward, jetColor,
    setQuality: (k) => { prefs.quality = k; savePrefs(); worldKey = null; resize(); if (stage.trackId) stageTrack(stage.trackId); },
    stage: { solo: stageSolo, room: stageRoom },
  });
  const qs = new URLSearchParams(location.search);
  window.Lobby.init({ game: 'moto', title: 'Revvd', emoji: '🏍️' });
  // your account and friends: the buttons from the site's top bar move into the game's
  const icons = $('#mx-icons');
  const friendsBtn = $('.topbar .friends-btn'); const chip = $('.topbar .profile-chip');
  if (friendsBtn) icons.insertBefore(friendsBtn, $('#mx-snd'));
  if (chip) icons.append(chip);
  Lobby.ChatBox(chatEl, { title: '' });
  chatEl.prepend(h('div', { class: 'mx-h' }, 'Chat'));
  if (qs.get('room')) menus.show('joining');   // (the lobby is joining it)
  else if(qs.get('free')){const mtb=qs.get('mtb')==='1',board=qs.get('board')==='1',water=qs.get('water')==='1',tow=qs.get('tow')==='1',veh=['sled','buggy','skate','wing'].includes(qs.get('veh'))?qs.get('veh'):null;menus.show(veh||(water?'water':board?'snow':mtb?'mtbworlds':'worlds'));const w=WORLDS.find(w=>w.id===qs.get("world")&&(water||veh||w.roomFree||!w.hidden));if(w){await loadUnlocks();startFree(w,{mtb,board,water,tow,veh});}}
  else if (qs.get('solo')) {
    const t = qs.get('track') && DATA.tracks.find((x) => x.id === qs.get('track'));
    menus.show('tracks');
    if (t) { await loadUnlocks(); startSolo(t); }
  }
  loadUnlocks().then(() => menus.refresh());
  PA.on('account', () => loadUnlocks().then(() => menus.refresh()));
  PA.on('profile', () => { if (menus.screen === 'home') menus.refresh(); });
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {   // testing on your own computer only
    // (the browser pane used for testing barely runs animation frames, so tests drive the game by hand)
    let fake = 0;
    window.__moto = { R, C, keys, touch, startSolo, trackDef, stage, get state() { return state; }, get menus() { return menus; }, get world() { return world; }, get renderer() { return renderer; }, get camera() { return camera; },
      /** Draw one frame of the menu scene (the test pane hardly runs animation frames). */
      drawMenu(dt = 1 / 60) { if (world && !riding) stageFrame(performance.now(), dt); },
      /** Run the game for `seconds` of game time with these controls held, then draw one frame. */
      advance(seconds, held = {}) {
        if (!R.bike) return null;
        R.running = false;
        if (!fake) fake = performance.now();
        if (R.lift) { for (let i = 0; i < Math.max(1, Math.round(seconds * 30)); i++) { fake += 1000 / 30; if (R.lift) liftFrame(fake, 1 / 30); } return { lift: !!R.lift }; }   // (on a chairlift)
        R.override = typeof held === 'function' ? held : null;
        for (const k of Object.keys(touch)) touch[k] = false;
        if (!R.override) Object.assign(touch, held);
        const n = Math.round(seconds / DT);
        for (let i = 0; i < n; i++) { fake += DT * 1000; if (fake >= R.goAt && !R.gateDown) { R.gateDown = true; } physicsStep(fake); }
        render(fake, 1 / 60, 1);
        for (let i = 0; i < 30; i++) render(fake, 1 / 60, 1);   // let the camera settle
        return { x: R.bike.x, y: R.bike.y, a: R.bike.a, t: R.bike.t, crashed: R.bike.crashed, speed: Math.hypot(R.bike.vx, R.bike.vy) * 3.6, cp: R.bike.cp, finished: R.finished };
      } };
  }
}
init();
