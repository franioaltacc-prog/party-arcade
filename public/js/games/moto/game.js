/* Motocross: the game page — the 3D scene behind the menus, the ride (input, camera, HUD, effects),
   solo time trials and online races. The menus are in menus.js, the physics in core.js, the 3D bike
   in bike.js, the world in world.js and the sound in sound.js. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWorld } from './world.js';
import { makeBike, boardify, poseBike, disposeBike, preloadBike, bikesLoaded, LIVERIES, MODELS, MTB_MODELS, RIDERS, KITS, HELMETS } from './bike.js';
import { createAudio } from './sound.js';
import { createMenus } from './menus.js';
import {buildRideWorld} from './open-world/ride-world.mjs';
import {loadNature,loadAspens} from './open-world/nature.mjs';
import {createTrial,stepTrial,trialBestKey} from './open-world/trials.mjs';
import * as Coins from './coins.js';
import * as Chutes from './chutes.js';
import { createMap } from './map.js';
import * as Car from './car.js';
import { makeCar, poseCar, disposeCar, preloadCar, CAR_PAINTS, CAR_MODELS, paintable } from './car-model.js';

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
const mtbLook = () => ({ ...myLook(), model: prefs.mtbModel });   // (Unrevvd: your mountain bike, same rider)
/** A snowboard's "pedal power" and air drag (a mountain bike's are 1): barely any push, and it slides well. */
const BOARD = { power: 0.3, drag: 0.85 };
/** Carvvd's boards (only looks). */
const BOARDS = { ice: { name: 'Ice', emoji: '🧊', color: '#2a7fff' }, lava: { name: 'Lava', emoji: '🌋', color: '#ff4a2a' }, toxic: { name: 'Toxic', emoji: '🧪', color: '#7dff3a' },
  aurora: { name: 'Aurora', emoji: '🌌', color: '#b44dff' }, snow: { name: 'Whiteout', emoji: '🤍', color: '#eef3f8' }, gold: { name: 'Gold', emoji: '🥇', color: '#f2b318' } };
const boardColor = () => (BOARDS[prefs.board] || BOARDS.ice).color;
const netStyle = () => ({ ...prefs.style, car: prefs.carModel, paint: prefs.carPaint, mtb: prefs.mtbModel });   // (what the room sees: bike, rider, supercar and mountain bike)
/** Pick your Unrevvd mountain bike. */
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
  return true;
}
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
    world.dispose(); world = null;
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
    tk: b.tk, tp: b.pose, wh: b.whip, sp: b.spin, th: b.thr, v: Math.hypot(b.vx, b.vy),
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
    tk: q.tk, tp: L(p.tp || 0, q.tp || 0), wh: L(p.wh || 0, q.wh || 0), sp: q.sp ? (p.sp && p.sp <= q.sp ? L(p.sp, q.sp) : q.sp) : 0, th: q.th, v: L(p.v || 0, q.v || 0),
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
    R.V = C; R.car = false; R.mtb = false; R.camMode = prefs.cam;
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
  dropGhosts(); dropTagMarker();
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
  const ev = R.V.step(T, b, { ...inp, hold: holding, calm: calm() });
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
  if (R.mode === 'free' && !holding) {
    if (!b.crashed && !R.finished) payCoins(Math.abs(b.x - xBefore) / 250, false);   // (a coin for every 250 m ridden)
    // where to put you back after a crash: somewhere you were riding along on both wheels (not on a jump)
    const g = T.terrain;
    if (!b.crashed && b.wh[0].ct && b.wh[1].ct && b.vx > 3 && now - (R.safeTrail.at(-1)?.t || 0) > 500 && g.inBounds(b.px, b.pz, 60) && !g.hazardAt(b.px, b.pz) && g.rampAt(b.px, b.pz).weight < 0.05 && !g.obstacleAt(b.px, b.pz)) {
      R.safeTrail.push({ x: b.px, z: b.pz, h: Math.PI / 2 - b.h, t: now });
      if (R.safeTrail.length > 24) R.safeTrail.shift();
    }
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
      const back = R.toPad ? null : R.retry ? { ...R.retry, gap: true } : R.safeTrail.findLast((p) => p.t < now - crashTime() * 1000 - 2500);
      R.V.respawn(T, b, 0, back ? { position: back.position || [back.x, back.z], heading: back.heading ?? back.h } : null);
      where = back ? (back.gap ? 'the run-in: have another go!' : 'where you were riding') : 'a safe riding pad';
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
  if (k === 'trick') { trickPop(d); return; }
  if (k === 'bail') { showMessage(`BAILED! ${C.TRICKS[d].name}`, 'bad', 1400); return; }
  if (k === 'crash') {
    if (R.audio) R.audio.crash();
    R.run?.crash();
    if (!online() && !R.override) R.slow = 0.9;
    R.cam.shake = C.P.CAM_CRASH_SHAKE;
    showMessage('CRASHED!', 'bad', 1300);
    burst(b.x, b.y, 26, 'puff', 1.4);
    if (online()) sendPos(true);
  } else if (k === 'land') {
    const strength = Math.min(1.5, d.air * 0.8);
    if (R.audio) R.audio.land(strength);
    R.cam.shake = Math.max(R.cam.shake, Math.min(C.P.CAM_SHAKE_MAX, d.air * C.P.CAM_LAND_SHAKE));
    burst(b.x, b.y - 0.4, Math.round(4 + d.air * 10), 'puff', 0.8 + d.air * 0.3);
    if (d.clean && (d.turns || d.perfect || d.air > 0.9 || (d.tricks && d.tricks.length))) trick(d);
    if (R.mode === 'free' && d.clean) {
      const pay = (d.turns || 0) * 5 + (d.score || 0) + (d.air > 2 ? 3 : 0);   // coins for flips, tricks and big air
      if (pay) payCoins(pay);
      const ch = R.challenge;
      if (ch && !ch.done && performance.now() > R.goAt) {
        if (ch.def.kind === 'air') ch.score = Math.max(ch.score, d.air);
        if (ch.def.kind === 'flips' && d.turns) ch.score += d.turns;
        if (ch.def.kind === 'tricks' && d.score) ch.score += d.score;
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
  const moves = (d.tricks || []).map((i) => C.TRICKS[i].name);
  const all = [...moves, flip].filter(Boolean);
  const title = all.length ? all.join(' + ') : d.perfect ? 'PERFECT LANDING' : 'CLEAN LANDING';
  const sub = (d.score ? `${d.score} PTS · ` : '') + `+${Math.round(d.gain * 100)}% NITRO` + (all.length && d.perfect ? ' · PERFECT' : '');
  const el = $('#hud-trick');
  fill(el, h('b', {}, title), h('small', {}, sub));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1600);
  if ((d.turns || moves.length) && R.audio) R.audio.trick();
}
/** A trick held long enough in the air: a little pop-up while you're still flying. */
function trickPop(i) {
  const el = $('#hud-trick');
  fill(el, h('b', {}, C.TRICKS[i].name), h('small', {}, 'land it!'));
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
const disposeModel = (m) => (m.car ? disposeCar(m) : disposeBike(m));
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
  }
  R.model.root.visible = !R.spectate;
  // gates drop at GO
  if (R.gateDown) for (const gg of w.gates) gg.rotation.z = Math.min(Math.PI / 2 * 0.95, gg.rotation.z + dt * 7);
  // other riders
  const leader = drawOthers(now, dt);
  drawGhosts(now, dt); drawTagMarker(now);
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
  const air = Math.max(0, P.y - groundUnder(P.x, P.z, s.s) - 0.7);
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

/** Dust, roost, mud and snow from the wheels; a puff of exhaust smoke now and then. */
function effects(s, dt, place) {
  const b = R.bike; const w = world; const fx = w.fx; const th = w.theme;
  R.emitAcc += dt;
  if (R.emitAcc < 1 / 60) return;
  const step = R.emitAcc; R.emitAcc = 0;
  const D = [Math.cos(s.h), Math.sin(s.h)];
  const speed = Math.hypot(b.vx, b.vy);
  const surface = b.G ? C.surfaceAt(b.G, b.x) : 0;
  const colPuff = surface === 1 ? fx.colors.mud : fx.colors.puff;
  const colChunk = surface === 1 ? fx.colors.mud : fx.colors.chunk;
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
  if (!b.crashed && rear.ct) {
    const slip = Math.max(0, rear.slip - 0.4);
    const roost = Math.min(1.6, slip * 0.25 + b.thr * speed * 0.012);
    const n = Math.floor(roost * 6 * step * 60 / 3 + Math.random());
    const cx = rear.x - rear.nx * 0.33; const cy = rear.y - rear.ny * 0.33;
    if (n) emitAt(cx, cy, n, 'chunk', 0.6 + roost * 0.6);
    if (Math.random() < Math.min(1, roost * 0.9 + speed * 0.012)) emitAt(cx, cy, 1, 'puff', 0.7);
  }
  // sliding wide in a turn sprays dirt to the outside
  if (b.scrub > 0.15) emitAt(rear.x, rear.y - 0.33, 1 + Math.floor(b.scrub * 4), 'chunk', 1.1, -Math.sign(b.yaw) * 4);
  if (!b.crashed && b.wh[0].ct && b.brk > 0.5 && speed > 4) emitAt(b.wh[0].x, b.wh[0].y - 0.33, 1, 'puff', 0.5);
  if (b.crashed && speed > 2 && Math.random() < 0.5) emitAt(b.x, b.y - 0.3, 2, 'puff', 0.8);
  // exhaust (not on a bicycle)
  if (!R.mtb && Math.random() < 0.18 + b.thr * 0.3) {
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
  $('#hud-left').textContent = R.mode==='free' ? R.trial ? `${R.trial.race.name} · LAP ${R.trial.lap}/${R.trial.race.laps}` : R.board ? 'CARVVD · A / D CARVE · R SAFE PAD' : R.mtb ? 'UNREVVD · Q WHEELIE · R SAFE PAD' : 'FREE RIDE · SPACE TURBO · R SAFE PAD' : `${Math.max(0, Math.round(T.finish - b.s))} M LEFT`;
  if(R.mode==='free')$('#hud-sub').textContent=R.trial?`GATE ${Math.min(R.trial.next+1,R.trial.gates.length)} / ${R.trial.gates.length}`:'EXPLORE AT YOUR OWN PACE';
  const ch = R.challenge;
  if (ch) {
    const k = ch.def.kind; const el = Math.min(ch.def.limit, ch.elapsed);
    $('#hud-time').closest('.mx-tr').hidden = false;
    $('#hud-time').textContent = fmt(k === 'race' ? el : Math.max(0, ch.def.limit - el));   // (races count up, the rest count down)
    const togo = ch.finish ? Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) : 0;
    $('#hud-sub').textContent = R.spectate ? watchLine() : ch.done ? (k === 'race' && ch.elapsed < ch.def.limit ? 'FINISHED!' : 'TIME’S UP') : k === 'race' ? (togo > 950 ? `${(togo / 1000).toFixed(1)} KM TO THE FINISH` : `${Math.round(togo)} M TO THE FINISH`)
      : k === 'lanterns' ? `🏮 ${ch.score} / ${world.forest?.lanterns.length || 0} · ${Math.round(togo)} M TO THE BOTTOM`
      : k === 'tag' ? tagLine()
      : k === 'air' ? `BEST AIR ${ch.score.toFixed(2)} S` : k === 'flips' ? `${ch.score} FLIP${ch.score === 1 ? '' : 'S'}` : k === 'tricks' ? `${ch.score} TRICK POINTS` : `TOP ${Math.round(ch.score)} KM/H`;
    $('#hud-left').textContent = ch.online && state.race ? `P${myPlace()} / ${Object.keys(state.race.runners).length} · ${k === 'race' ? 'FOLLOW THE GREEN BEAM' : k === 'tag' ? 'RIDE INTO SOMEONE TO TAG THEM' : 'TIME LEFT TOP RIGHT'}`
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
    const mtb=ch?ch.vehicle==='mtb':opts.online?prefs.vehicle==='mtb':!!(opts.mtb||opts.board);
    const def=await response.json();await preloadBike(mtb?prefs.mtbModel:myLook().model);
    if(opts.daily)Object.assign(def,{id:'daily',name:'Daily Chute',seed:opts.daily.seed});   // (today's gully: a chute's look, its own trees)
    let nature=def.gauntlets?.length?await loadNature().catch((e)=>{console.warn('nature models',e);return null;}):null;   // (real trees and rocks for a gauntlet)
    if(nature&&def.gauntlets.some(g=>g.aspens))nature={...nature,aspens:await loadAspens().catch(()=>null)};   // (the Autumn Chute's aspens)
    if(!ch&&!mtb&&prefs.vehicle==='car')await preloadCar(prefs.carModel);if(!riding||R.ride!==ride)return;
    for(const o of R.others.values())dropOther(o);R.others.clear();
    if(R.model){disposeModel(R.model);R.model=null;}
    for(const sb of stage.bikes.values()){sb.model.root.removeFromParent();sb.tag?.removeFromParent();}
    if(world)world.dispose();world=null;worldKey=null;
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
    }
    // the dirt bike, the mountain bike (its upgrades only in free ride too) or the supercar
    R.mtb=mtb;R.car=!ch&&!mtb&&prefs.vehicle==='car';R.V=R.car?Car:C;
    R.board=!!(ch?ch.board:opts.board);   // (Carvvd: a board instead of a bike, no pedalling: it's all gravity)
    R.T=C.groundTrack(world.ground,spawn,engine,mtb?(R.board?BOARD:ch?{}:Coins.MTB.current().stats):null);R.bike=R.V.newBike(R.T);
    R.model=R.car?makeCar(prefs.carModel,prefs.carPaint):makeBike(mtb?mtbLook():myLook());if(R.board)boardify(R.model,boardColor());world.scene.add(R.model.root);
    if(opts.online&&state.race){fillOthers(state.race);if(ch)for(const o of R.others.values())addOtherModel(o);}   // (free ride: each rider's bike or car appears with their first message)
    R.prev=R.cur=snap(R.bike);R.acc=0;R.last=performance.now();R.finished=false;R.cam.init=false;R.stuck=0;R.emitAcc=0;R.roll=0;R.best=null;R.beeped=0;R.safeTrail=[];R.retry=null;R.toPad=false;
    R.goAt=ch?Math.max(opts.goAt||0,performance.now()+(opts.online?600:3200)):0;R.gateDown=!ch;
    R.camMode=ch?.cam||prefs.cam;   // (a challenge can be ridden in first person)
    R.trialMarker=null;R.finishMarker=finish?finishBeacon(finish):null;R.audio=createAudio({pedal:mtb});chuteExtras(ch);R.helmet=Coins.CAM.current();
    if(world.lamp&&mtb){const L=Coins.LAMP.current().lamp;Object.assign(world.lamp.spot,{intensity:L.i,angle:L.angle,distance:L.dist});}   // (your bike lamp, from the shop)
    if(world.storm){R.audio?.rain(1);world.onLightning=(far)=>{pulse($('#fx-flash'));R.audio?.thunder(far);};}$('.mx-nlab').textContent='TURBO · SPACE / SHIFT';for(const el of $$('.mx-nitro, .mx-nlab'))el.style.display=mtb?'none':'';$('#mx-trials').hidden=!!ch;   // (a bicycle has no nitro)
    $('#hud-track').textContent=ch?`${ch.emoji} ${ch.name}${R.cup?` · World Cup ${R.cup.i+1}/${Chutes.CUP.length}`:''}`:def.name;
    fill($('#hud-center'));resize();drawMapBase();coinHud(purse().wallet().coins,0);R.running=true;requestAnimationFrame(frame);
    const url=new URL(location.href);url.searchParams.delete('solo');url.searchParams.delete('track');
    if(ch){url.searchParams.delete('free');url.searchParams.delete('world');history.replaceState(null,'',url);showMessage(ch.about,'small',5000);}
    else{if(!R.board){if(mtb)prefs.mtbWorld=def.id;else prefs.world=def.id;savePrefs();}url.searchParams.set('free','1');url.searchParams.set('world',def.id);if(mtb&&!R.freeOnline)url.searchParams.set('mtb','1');else url.searchParams.delete('mtb');if(R.board)url.searchParams.set('board','1');else url.searchParams.delete('board');history.replaceState(null,'',url);
      showMessage(R.freeOnline?'FREE RIDE TOGETHER · Esc goes back to the room':R.board?'CARVVD · Point it downhill · A / D carve · Q / E flip · R resets':mtb?'UNREVVD · W pedals · Q pops a wheelie · R resets':'FREE RIDE · Collect the gold coins · Space / Shift turbo · R resets','small',4500);}
  }catch(error){console.error(error);UI.toast('Could not load that world','bad');quit();}
}

// ------------------------------------------------------------------ coins
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
  : kind === 'lanterns' ? `${v} lantern${v === 1 ? '' : 's'}` : kind === 'tag' ? `${(+v).toFixed(1)} s it` : `${Math.round(v)} km/h`);
const challengeBest = (id) => store.get('moto_ch_best_' + id, null);
/** Where a challenge starts (lane: a few metres to the side, so a room doesn't stack up) and where it finishes. */
function challengeStart(ch, ground, def, lane) {
  const pads = Object.fromEntries(def.safePads.map((p) => [p.id, p]));
  let pos; let head; let finish = null;
  if (ch.kind === 'race' || ch.from) {   // (a race, or the Lantern Hunt: top to bottom too)
    const a = pads[ch.from]; finish = pads[ch.to].position; pos = a.riderPosition || a.position;
    head = Math.atan2(finish[0] - pos[0], finish[1] - pos[1]);
  } else if (ch.at === 'park' && ground.parks[0]) {
    const p = ground.parks[0]; pos = [p.start[0] - Math.sin(p.heading) * 40, p.start[1] - Math.cos(p.heading) * 40]; head = p.heading;
  } else {
    const a = pads[ch.at] || def.safePads[0]; pos = a.riderPosition || a.position;
    head = ground.roadAt(...pos)?.heading ?? Math.atan2(-pos[0], -pos[1]);
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
  if (kind === 'race' && Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) < 40) { challengeDone(el); return; }
  if (kind === 'lanterns') {
    // ride past a lantern to pick it up; the run's over at the bottom
    const f = world.forest;
    if (f && !b.crashed) for (const l of f.lanterns) if (!l.out && Math.hypot(l.x - b.px, l.z - b.pz) < 3.4) { f.lanternOut(l); ch.score++; R.audio?.chime(); showMessage(`🏮 ${ch.score} / ${f.lanterns.length}`, 'cp', 900); }
    if (Math.hypot(b.px - ch.finish[0], b.pz - ch.finish[1]) < 40) { challengeDone(null); return; }
  }
  if (kind === 'tag' && ch.online && state.race?.it === Net.id && now > (ch.tagAt || 0)) {
    // you're it: ride into someone to pass it on (the server checks)
    for (const o of R.others.values()) if (o.snap && Math.hypot(o.snap.px - b.px, o.snap.pz - b.pz) < 3) { Net.send('g:tag', { id: o.id }); ch.tagAt = now + 600; break; }
  }
  if (el >= ch.def.limit) { challengeDone(null); return; }
  if (ch.online && kind !== 'race' && ch.score > ch.sent && now - ch.sentAt > 300) { ch.sent = ch.score; ch.sentAt = now; Net.send('g:score', { score: ch.score }); }
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
    if (kind === 'race' && time != null) Net.send('g:finish', { time: Math.round(time * 1000), cp: 0, crashes: R.bike.crashes, flips: R.bike.flips });
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
  const pay = ok ? 40 + (better ? 30 : 0) + (medal >= 0 ? [60, 30, 15][medal] : 0) : 0;
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
    h('div', { class: 'btns' }, btn('🔁 Again', () => startChallengeSolo(def), 'ENTER'), btn('Menu', quit, 'ESC'))));
}
/** The solo leaderboard a race challenge's times go on (the Daily Chute has one a day). */
const chuteGame = (ch) => (ch.daily ? 'mch-daily' : 'mch-' + ch.id);
/** Where your own best run's ghost is kept on this device. */
const ghostKey = (ch) => (ch.daily ? 'daily-' + ch.daily.day : ch.id);

// ------------------------------------------------------------------ chutes: near misses, bushes, ghosts (chutes.js)
/** A challenge starting in a forest: watch for near misses and bushes, record the run, and bring in the ghosts. */
function chuteExtras(ch) {
  dropGhosts(); R.run = null; R.ghostRec = null;
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
    if (R.ride !== ride || !ghost || (Account.user && ghost.name === Account.user.name && mine)) return;   // (your own record: already there)
    addGhost(ghost.data, `🏆 ${ghost.name} · ${fmt(ghost.ms / 1000)}`, '#ffd34d');
  } catch { /* offline: just your own */ }
}
function addGhost(data, label, color) {
  const frames = Chutes.ghostFrames(data);
  if (!frames || !frames.length || !world) return;
  const model = makeBike({ ...mtbLook(), ghost: color }); if (R.board) boardify(model, color); world.scene.add(model.root);
  const tag = nameTag(label, color); world.scene.add(tag);
  R.ghosts.push({ frames, model, tag, ang: [0, 0] });
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
    poseBike(g.model, s, placer(s), s.h, now / 1000);
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
    if (R.challenge?.finish) t.push({ x: R.challenge.finish[0], z: R.challenge.finish[1], color: '#7dffb5' });
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
  stage.list = [{ id: 'me', look: snow ? { ...mtbLook(), board: boardColor() } : mtb ? mtbLook() : { ...myLook(), ...(livery ? { livery } : {}) } }];
  if (mtb) preloadBike(prefs.mtbModel).then(() => placeStage());
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
    if (!sb.model) { sb.model = makeBike(e.look); if (e.look.board) boardify(sb.model, e.look.board); sb.lookKey = lookKey; }
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
  menus.show((R.mtb ? 'mtb' : '') + (wasChallenge ? 'challenges' : R.mode==='free'?'worlds':'tracks'));
  const url = new URL(location.href); for (const k of ['free', 'world', 'track', 'mtb']) url.searchParams.delete(k); history.replaceState(null, '', url);
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
  else if (e.code === 'Enter' && R.mode === 'solo' && (R.finished || performance.now() > R.goAt)) startSolo(R.def);
  else if (e.code === 'Enter' && R.challenge && R.challenge.done && !R.challenge.online) { if (R.onEnter) R.onEnter(); else startChallengeSolo(R.challenge.def); }
  else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && R.spectate && !e.repeat) switchWatch(e.code === 'ArrowRight' ? 1 : -1);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
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
  o.model = makeBike({ ...st, ...(R.mtb ? { model: MTB_MODELS[st.mtb] ? st.mtb : 'dh' } : {}), ghost: o.color });   // (an Unrevvd challenge: everyone's on a mountain bike)
  if (R.board) boardify(o.model, o.color);   // (everyone in a Carvvd challenge is on a board)
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
  const kind = m.v === 1 ? `car:${carId}:${st.paint || ''}` : `${m.v === 2 ? 'mtb:' + mtbId : 'bike'}:${bikesLoaded()}`;   // (a bike model file that has just loaded replaces its stand-in)
  if (o.kind === kind && o.model) return;
  dropOther(o); o.kind = kind;
  if (m.v === 1) {
    o.model = makeCar(carId, st.paint || 'arancio');
    // (the model file may still be loading: it shows as the wedge until then, and is swapped in once it's here)
    if (CAR_MODELS[carId].file && !o.model.file) preloadCar(carId).then((ok) => { if (ok && o.kind === kind) o.kind = null; });
  } else o.model = makeBike({ ...st, ...(m.v === 2 ? { model: mtbId } : {}), livery: playerOf(o.id).bike });
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
  if (R.car) Object.assign(msg, { v: 1, ro: r2(b.roll), st: r2(b.steer), c0: r2(b.comp[0]), c1: r2(b.comp[1]), c2: r2(b.comp[2]), c3: r2(b.comp[3]) });   // (the supercar)
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
      .sort((p, q) => (race.kind === 'race' ? (p.done !== q.done ? (p.done ? -1 : 1) : p.done ? p.place - q.place : q.x - p.x) : race.kind === 'tag' ? p.score - q.score : q.score - p.score));
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
    const extra = k === 'tag' ? (state.race.it === r.id ? ' · 🏷️ IT' : ` · ${fmtScore(k, r.score)}`) : k && k !== 'race' ? (r.score ? ` · ${fmtScore(k, r.score)}` : '') : r.done ? ' 🏁' : '';   // (timed challenges: everyone's best so far)
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
Net.on('g:hurry', (m) => { if (R.running && !R.finished && !R.spectate) showMessage(`Someone finished! ${m.seconds}s left`, 'bad', 3000); });
Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
/** How a results row's score reads: a time, or a challenge score with its unit. */
const resultText = (res, r) => (res.challenge && res.kind !== 'race' ? (r.done ? fmtScore(res.kind, r.score) : 'No score') : r.done ? fmt(r.time / 1000) : 'DNF');
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
    MTB_MODELS, setMtbModel, startMtbFree: (w) => startFree(w, { mtb: true }), BOARDS, startBoardFree: (w) => startFree(w, { board: true }),
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
  else if(qs.get('free')){const mtb=qs.get('mtb')==='1',board=qs.get('board')==='1';menus.show(board?'snow':mtb?'mtbworlds':'worlds');const w=WORLDS.find(w=>w.id===qs.get('world')&&!w.hidden);if(w){await loadUnlocks();startFree(w,{mtb,board});}}
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
