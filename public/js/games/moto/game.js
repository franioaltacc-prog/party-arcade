/* Motocross: the game page — the 3D scene behind the menus, the ride (input, camera, HUD, effects),
   solo time trials and online races. The menus are in menus.js, the physics in core.js, the 3D bike
   in bike.js, the world in world.js and the sound in sound.js. */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeBike, poseBike, disposeBike, LIVERIES, MODELS, KITS, HELMETS } from './bike.js';
import { createAudio } from './sound.js';
import { createMenus } from './menus.js';

const { $, h, fill, Net, Sfx, UI, store, Account, Unlocks } = PA;
const FX = PA.FX || {};
const C = window.MotoCore;
const DT = C.DT;

// ------------------------------------------------------------------ data and preferences
let DATA = null;
const builtTracks = new Map();
const trackDef = (id) => DATA.tracks.find((t) => t.id === id) || DATA.tracks[0];
const physicsTrack = (def) => { if (!builtTracks.has(def.id)) builtTracks.set(def.id, C.build(def)); return builtTracks.get(def.id); };
const prefs = Object.assign({ cam: 'chase', quality: 'auto', livery: 'factory', mode: 'solo', track: 'desert' }, store.get('moto_prefs', {}));
const savePrefs = () => store.set('moto_prefs', prefs);
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
prefs.style = Object.assign({ model: 'mx4', kit: 'match', helmet: 'match', number: null }, prefs.style);
const myLook = () => ({ ...prefs.style, livery: myLivery() });
function setStyle(patch) {
  prefs.style = { ...prefs.style, ...patch }; savePrefs();
  if (window.Room && Room.code) Net.send('g:style', { style: prefs.style });   // (so the others see it)
  Sfx.play('click');
  menus.refresh();
}

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
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pr) * (R.prScale || 1));
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
  running: false, mode: 'solo', def: null, T: null, bike: null, model: null, prev: null, cur: null,
  goAt: 0, acc: 0, last: 0, finished: false, spectate: false, lane: 0, camMode: prefs.cam,
  cam: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60, shake: 0, init: false },
  audio: null, others: new Map(), sentAt: 0, beeped: 0, gateDown: false, prScale: 1, slowFrames: 0,
  stuck: 0, hudAt: 0, trickTimer: null, lastLand: 0, emitAcc: 0, roll: 0,
};
const keys = {};
const touch = { gas: false, brake: false, left: false, right: false, back: false, fwd: false, nitro: false };

function snap(b) {
  const f = b.wh[0]; const r = b.wh[1];
  return {
    x: b.x, y: b.y, a: b.a, wf: [f.x, f.y, f.ang], wr: [r.x, r.y, r.ang], rx: b.rx, ry: b.ry, lean: b.lean, px: b.px, pz: b.pz, h: b.h, s: b.s,
    boost: b.boost, crashed: b.crashed, ragdoll: b.rider ? { hip: { x: b.rider.hip.x, y: b.rider.hip.y }, head: { x: b.rider.head.x, y: b.rider.head.y } } : null,
  };
}
const lerpA = (p, q, t) => { let d = q - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return p + d * t; };
function mix(p, q, t) {
  const L = (a, b) => a + (b - a) * t;
  return {
    x: L(p.x, q.x), y: L(p.y, q.y), a: lerpA(p.a, q.a, t), lean: L(p.lean, q.lean), rx: L(p.rx, q.rx), ry: L(p.ry, q.ry),
    px: L(p.px, q.px), pz: L(p.pz, q.pz), h: lerpA(p.h, q.h, t), s: L(p.s, q.s),
    wf: [L(p.wf[0], q.wf[0]), L(p.wf[1], q.wf[1]), L(p.wf[2], q.wf[2])], wr: [L(p.wr[0], q.wr[0]), L(p.wr[1], q.wr[1]), L(p.wr[2], q.wr[2])],
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
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    gas = Math.max(gas, p.buttons[7] ? p.buttons[7].value : 0);
    brake = Math.max(brake, p.buttons[6] ? p.buttons[6].value : 0);
    if (Math.abs(p.axes[0] || 0) > 0.15) steer = p.axes[0];
    if (Math.abs(p.axes[3] || 0) > 0.2) lean = p.axes[3];
    if (p.buttons[0] && p.buttons[0].pressed) nitro = true;
  }
  return { gas, brake, steer, lean, nitro };
}

/** Start a ride. mode 'solo' or 'online'; goAt: when the gate drops (performance.now() time). */
function begin(def, mode, goAt) {
  if (!setupRenderer()) return false;
  stopRide();
  setRiding(true);
  R.mode = mode; R.def = def; R.T = physicsTrack(def); R.ride = (R.ride || 0) + 1;
  if (mode === 'solo') { R.spectate = false; for (const o of R.others.values()) dropOther(o); R.others.clear(); }
  fill($('#hud-center'), h('div', { class: 'mx-loading' }, h('div', { class: 'mx-spin' }), 'Building the track…'));
  resize();
  // let the loading message show before the (slow) world build
  setTimeout(() => {
    if (!riding) return;   // (back to the menu already)
    loadWorld(def);
    R.lane = mode === 'online' ? laneFor(Net.id) : 0;   // (your slot in the start gate)
    R.bike = C.newBike(R.T, R.T.start, R.lane);
    R.prev = R.cur = snap(R.bike);
    if (R.model) disposeBike(R.model);
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
  }, 30);
  return true;
}
function stopRide() {
  R.running = false;
  if (R.audio) { R.audio.stop(); R.audio = null; }
  for (const k of Object.keys(touch)) touch[k] = false;
}
const LANES = [0, -1.15, 1.15, -2.3, 2.3, -3.45, 3.45];   // the start gate's slots
const laneFor = (id) => {
  const ids = state.race ? Object.keys(state.race.runners).sort() : [id];
  const i = Math.max(0, ids.indexOf(id));
  return LANES[i % LANES.length];
};

function frame(now) {
  if (!R.running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - R.last) / 1000); R.last = now;
  // the countdown
  const left = (R.goAt - now) / 1000;
  if (left > 0) {
    const n = Math.ceil(left);
    if (n <= 3 && n !== R.beeped) { R.beeped = n; if (R.audio) R.audio.beep(false); showCount(n); }
  } else if (!R.gateDown) {
    R.gateDown = true; if (R.audio) { R.audio.beep(true); R.audio.gate(); } showCount('GO!');
  }
  // fixed-step physics
  R.acc += dt;
  let steps = 0;
  while (R.acc >= DT && steps < 14) { physicsStep(now); R.acc -= DT; steps++; }
  if (steps >= 14) R.acc = 0;
  render(now, dt, R.acc / DT);
  // too slow? draw fewer pixels
  if (dt > 1 / 38) R.slowFrames++; else R.slowFrames = Math.max(0, R.slowFrames - 1);
  if (R.slowFrames > 90 && R.prScale > 0.6) { R.prScale -= 0.15; R.slowFrames = 0; resize(); }
}

function physicsStep(now) {
  const b = R.bike; const T = R.T;
  R.prev = R.cur;
  const holding = now < R.goAt || b.hold > 0 || R.spectate;
  const inp = R.spectate || R.finished ? { gas: 0, brake: R.finished ? 1 : 0, lean: 0, nitro: false } : R.override ? R.override(R.T, b) : controls();
  if (b.hold > 0) { b.hold -= DT; b.t += DT; }
  const ev = C.step(T, b, { ...inp, hold: holding });
  for (const [k, d] of ev) onEvent(k, d);
  if (b.crashed > C.P.CRASH_TIME) {
    C.respawn(T, b);
    R.prev = snap(b); R.cam.init = false;
    const where = b.cp >= 0 ? `checkpoint ${b.cp + 1}` : 'the start';
    showMessage(`Back to ${where}`, 'small', 1000);
  }
  // stuck (e.g. sitting in a pit): offer to go back
  const sp = Math.hypot(b.vx, b.vy);
  R.stuck = !b.crashed && b.hold <= 0 && now > R.goAt && !R.finished && sp < 0.6 ? R.stuck + DT : 0;
  if (R.stuck > 4 && R.stuck - DT <= 4) showMessage('Stuck? Press R to go back to the checkpoint', 'small', 2500);
  R.cur = snap(b);
}

function respawnNow() {
  const b = R.bike;
  if (!R.running || R.finished || !b || performance.now() < R.goAt || b.hold > 0) return;
  if (!b.crashed) { b.crashes++; b.crashed = C.P.CRASH_TIME + 1; }
}

function onEvent(k, d) {
  const b = R.bike;
  if (k === 'crash') {
    if (R.audio) R.audio.crash();
    R.cam.shake = 0.6;
    showMessage('CRASHED!', 'bad', 1300);
    burst(b.x, b.y, 26, 'puff', 1.4);
    if (R.mode === 'online') sendPos(true);
  } else if (k === 'land') {
    const strength = Math.min(1.5, d.air * 0.8);
    if (R.audio) R.audio.land(strength);
    R.cam.shake = Math.max(R.cam.shake, Math.min(0.35, d.air * 0.15));
    burst(b.x, b.y - 0.4, Math.round(4 + d.air * 10), 'puff', 0.8 + d.air * 0.3);
    if (d.clean && (d.turns || d.perfect || d.air > 0.9)) trick(d);
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
  const title = d.turns ? `${names[d.turns] || d.turns + '× '}${d.back ? 'BACKFLIP' : 'FRONTFLIP'}` : d.perfect ? 'PERFECT LANDING' : 'CLEAN LANDING';
  const sub = `+${Math.round(d.gain * 100)}% NITRO` + (d.turns && d.perfect ? ' · PERFECT' : '');
  const el = $('#hud-trick');
  fill(el, h('b', {}, title), h('small', {}, sub));
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(R.trickTimer); R.trickTimer = setTimeout(() => el.classList.remove('on'), 1600);
  if (d.turns && R.audio) R.audio.trick();
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
const tmpV = new THREE.Vector3(); const tmpV2 = new THREE.Vector3(); const tmpV3 = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
/** Turns a snapshot's upright-plane coordinates (x = odometer, y = height) into the world. */
function placer(sn) {
  const c = Math.cos(sn.h); const n = Math.sin(sn.h);
  return (x, y, out) => out.set(sn.px + c * (x - sn.x), y, sn.pz + n * (x - sn.x));
}
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
function render(now, dt, alpha) {
  const w = world; const b = R.bike;
  const s = mix(R.prev, R.cur, alpha);
  const place = placer(s);
  const speed = Math.hypot(b.vx, b.vy);
  // lean into turns like a real bike: tan(lean) = sideways acceleration / gravity
  const want = b.crashed || !(b.wh[0].ct || b.wh[1].ct) ? 0 : Math.atan(b.vx * b.yaw / C.P.G);
  R.roll += (clampN(want, -0.85, 0.85) - R.roll) * (1 - Math.exp(-dt * 8));
  s.roll = R.roll;
  poseBike(R.model, s, place, s.h, now / 1000);
  R.model.root.visible = !R.spectate;
  // gates drop at GO
  if (R.gateDown) for (const gg of w.gates) gg.rotation.z = Math.min(Math.PI / 2 * 0.95, gg.rotation.z + dt * 7);
  // other riders
  const leader = drawOthers(now, dt);
  // dust, roost and smoke
  if (!R.spectate) effects(s, dt, place);
  if (R.spectate && leader) updateCamera(leader.snap, dt, 20, leader.place);
  else updateCamera(s, dt, speed, place);
  w.update(R.model.root.position, dt, camera);
  if (R.audio) {
    R.audio.update(b, dt, { scrub: b.scrub, surface: b.G ? C.surfaceAt(b.G, b.x) : 0 });
    if (R.mode === 'online') R.audio.others(otherSounds(b));
  }
  renderer.render(w.scene, camera);
  if (now - R.hudAt > 60) { R.hudAt = now; hud(now); }
  if (R.mode === 'online' && now - R.sentAt > 80) sendPos(false);
}

/** The ground height under a point in the world (near the track). */
function groundUnder(x, z, hint, T = R.T) { const L = C.locate(T, x, z, hint); return C.heightAt(T, L.s, L.u); }

function updateCamera(s, dt, speed, place) {
  const cam = R.cam;
  // swing round behind the way the bike points, like a 3D racing game (smoothly, so steering isn't jerky)
  cam.h = cam.init ? lerpA(cam.h, s.h, 1 - Math.exp(-dt * 5.5)) : s.h;
  const heading = cam.h;
  const D = tmpV.set(Math.cos(heading), 0, Math.sin(heading));
  const Rt = tmpV2.set(-Math.sin(heading), 0, Math.cos(heading));
  const rag = s.crashed && s.ragdoll;
  const P = place(rag ? s.ragdoll.hip.x : s.x, rag ? s.ragdoll.hip.y : s.y, tmpV3);
  const air = Math.max(0, P.y - groundUnder(P.x, P.z, s.s) - 0.7);
  let want; let look; let fov = 56 + Math.min(10, speed * 0.32) + (camera.aspect < 1 ? 18 : 0);   // (a tall phone screen needs a wider view)
  if (R.camMode === 'side') {
    want = P.clone().addScaledVector(Rt, 10.5 + air * 0.5).addScaledVector(D, 2).add(UPV.clone().multiplyScalar(1.8 + air * 0.25));
    look = P.clone().addScaledVector(D, 3).add(UPV.clone().multiplyScalar(0.6));
    fov -= 6;
  } else if (R.camMode === 'close') {
    want = P.clone().addScaledVector(D, -4.2).add(UPV.clone().multiplyScalar(1.7 + air * 0.25));
    look = P.clone().addScaledVector(D, 5).add(UPV.clone().multiplyScalar(0.9));
  } else {
    // Cork7-style chase: behind and above, looking ahead
    want = P.clone().addScaledVector(D, -5).add(UPV.clone().multiplyScalar(2.0 + air * 0.3));
    look = P.clone().addScaledVector(D, 5).add(UPV.clone().multiplyScalar(1.0 + air * 0.2));
  }
  // keep the camera out of the ground
  want.y = Math.max(want.y, groundUnder(want.x, want.z, s.s) + 1.1);
  if (!cam.init) { cam.pos.copy(want); cam.look.copy(look); cam.fov = fov; cam.init = true; }
  const kPos = 1 - Math.exp(-dt * (R.camMode === 'side' ? 6 : 8.5));
  const kLook = 1 - Math.exp(-dt * 10);
  cam.pos.lerp(want, kPos); cam.look.lerp(look, kLook);
  cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 2));
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
  // exhaust
  if (Math.random() < 0.18 + b.thr * 0.3) {
    const ex = R.model.root.localToWorld(tmpV.set(-0.82, 0.4, 0.17));
    fx.puff(ex.x, ex.y, ex.z, -D[0] * 0.6, 0.25, -D[1] * 0.6, { life: 0.8, size: 0.12, grow: 0.7, alpha: b.boost ? 0 : 0.12, drag: 1, color: fx.colors.smoke });
  }
}
function burst(x, y, n, kind, power) {
  const w = world; if (!w || !R.cur) return;
  const p = placer(R.cur)(x, y, new THREE.Vector3());
  const col = R.bike.G && C.surfaceAt(R.bike.G, x) === 1 ? w.fx.colors.mud : w.fx.colors.puff;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2; const sp = (1 + Math.random() * 3) * power;
    w.fx.puff(p.x, p.y, p.z, Math.cos(a) * sp, 0.6 + Math.random() * power, Math.sin(a) * sp, { life: 1.2 + Math.random(), size: 0.8, grow: 3.5 + power * 2, alpha: w.theme.snowing ? 0.55 : 0.38, drag: 1.6, color: col });
  }
}

// ------------------------------------------------------------------ HUD
let mapBase = null;
/** The track seen from above, turned so it runs left to right, with the checkpoints and the finish. */
function drawMapBase() {
  const cv = $('#hud-map'); const T = R.T;
  const W = cv.width; const H = cv.height;
  mapBase = document.createElement('canvas'); mapBase.width = W; mapBase.height = H;
  const g = mapBase.getContext('2d');
  const a = C.pathAt(T, T.start); const z = C.pathAt(T, T.finish);
  const ang = Math.atan2(z.z - a.z, z.x - a.x); const c = Math.cos(-ang); const sn = Math.sin(-ang);
  const rot = (x, y) => [(x - a.x) * c - (y - a.z) * sn, (x - a.x) * sn + (y - a.z) * c];
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (let s = T.start - 10; s <= T.finish + 10; s += 4) { const p = C.pathAt(T, s); const [x, y] = rot(p.x, p.z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const k = Math.min((W - 16) / (x1 - x0 || 1), (H - 16) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * k) / 2 - x0 * k; const oy = (H - (y1 - y0) * k) / 2 - y0 * k;
  R.mapPt = (x, y) => { const [u, v] = rot(x, y); return [ox + u * k, oy + v * k]; };
  g.lineWidth = 7; g.strokeStyle = 'rgba(10,12,20,.35)'; g.lineJoin = 'round'; g.lineCap = 'round';
  const line = () => { g.beginPath(); for (let s = T.start; s <= T.finish; s += 2) { const p = C.pathAt(T, s); const [x, y] = R.mapPt(p.x, p.z); if (s === T.start) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); };
  line(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; line();
  for (const s of [...T.cps, T.finish]) {
    const p = C.pathAt(T, s); const [x, y] = R.mapPt(p.x, p.z);
    g.fillStyle = s === T.finish ? '#fde047' : '#ffffff'; g.beginPath(); g.arc(x, y, s === T.finish ? 5 : 3.5, 0, 7); g.fill();
  }
}
function hud(now) {
  const b = R.bike; const T = R.T;
  const t = now < R.goAt ? 0 : b.t;
  $('#hud-time').textContent = fmt(t);
  $('#hud-speed').textContent = Math.round(Math.hypot(b.vx, b.vy) * 3.6);
  $('#hud-gear').textContent = b.crashed ? 'N' : b.gear;
  $('#hud-nitro').style.width = `${Math.round(b.nitro * 100)}%`;
  $('#hud-nitro').parentNode.classList.toggle('on', b.boost);
  $('#hud-nitro').parentNode.classList.toggle('full', b.nitro >= 0.999);
  $('#hud-sub').textContent = R.spectate ? 'WATCHING THE LEADER' : R.mode === 'online' && state.race ? `P${myPlace()} / ${Object.keys(state.race.runners).length}  ·  CP ${b.cp + 1}/${T.cps.length}` : `CHECKPOINT ${b.cp + 1} / ${T.cps.length}`;
  $('#hud-left').textContent = `${Math.max(0, Math.round(T.finish - b.s))} M LEFT`;
  // minimap: you and the others on the track seen from above
  const cv = $('#hud-map'); const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height); g.drawImage(mapBase, 0, 0);
  const dot = (x, z, col, r) => { const [px, py] = R.mapPt(x, z); g.fillStyle = col; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.5; g.stroke(); };
  for (const o of R.others.values()) if (o.snap) dot(o.snap.px, o.snap.pz, o.color, 5);
  dot(b.px, b.pz, '#ffd21a', 7);
  $('#hud-wrong').classList.toggle('on', !!b.wrong && !R.spectate && !R.finished);
  if (R.mode === 'online') drawBoard();
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
    const url = new URL(location.href); url.searchParams.set('solo', '1'); url.searchParams.set('track', def.id); history.replaceState(null, '', url);
  }
}
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
const stage = { shot: 'home', list: [], bikes: new Map(), trackId: null, cam: { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false }, off: 0, last: 0, raf: 0, timer: null };
// where the camera sits for each menu: distance, height, angle from the bike's heading (0 = in front, π/2 = beside),
// how far it drifts and how fast, and how far the bikes are pushed right (to make room for the menus)
const SHOTS = {
  home: { r: 6.6, y: 1.9, ang: 0.95, swing: 0.45, speed: 0.07, look: 0.75, off: 0.2, fov: 46 },
  tracks: { r: 9, y: 3, ang: 1.15, swing: 0.5, speed: 0.06, look: 0.9, off: 0.2, fov: 50 },
  garage: { r: 4.3, y: 1.1, ang: 1.5, swing: 0.32, speed: 0.12, look: 0.72, off: 0.19, fov: 42 },
  room: { r: 10.5, y: 3.2, ang: 0.62, swing: 0.3, speed: 0.05, look: 0.8, off: 0.03, fov: 50 },
};

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
  placeStage();
  stageStart();
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
  stage.shot = SHOTS[screen] ? screen : 'home';
  stage.list = [{ id: 'me', look: { ...myLook(), ...(livery ? { livery } : {}) } }];
  stageTrack(prefs.track);
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
    const lookKey = JSON.stringify(e.look);
    if (sb.model && sb.lookKey !== lookKey) { disposeBike(sb.model); sb.model = null; }
    if (!sb.model) { sb.model = makeBike(e.look); sb.lookKey = lookKey; }
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
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
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
function quit() {
  if (R.mode === 'online' && window.Room && Room.code) { setRiding(false); menus.show('room'); return; }
  setRiding(false);
  menus.show('tracks');
  const url = new URL(location.href); url.searchParams.delete('track'); history.replaceState(null, '', url);
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
const CAMS = ['chase', 'side', 'close'];
camBtn.addEventListener('click', () => { R.camMode = CAMS[(CAMS.indexOf(R.camMode) + 1) % CAMS.length]; prefs.cam = R.camMode; savePrefs(); R.cam.init = false; showMessage(`${R.camMode.toUpperCase()} CAMERA`, 'small', 900); });

addEventListener('keydown', (e) => {
  const typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (!riding) {
    if (e.code === 'KeyM' && !e.repeat && !typing) Sfx.setMuted(!Sfx.muted);
    else if (menus) menus.onKey(e);
    return;
  }
  if (e.code === 'Escape' && !typing) { quit(); return; }
  if (!R.running) return;
  if (R.audio && R.audio.ctx.state === 'suspended') R.audio.ctx.resume();   // (browsers only allow sound after a key press or tap)
  if (typing) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR') respawnNow();
  else if (e.code === 'KeyC' && !e.repeat) camBtn.click();
  else if (e.code === 'KeyM' && !e.repeat) muteBtn.click();
  else if (e.code === 'Enter' && R.mode === 'solo' && (R.finished || performance.now() > R.goAt)) startSolo(R.def);
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
  for (const o of R.others.values()) dropOther(o);
  R.others.clear();
  for (const id of Object.keys(race.runners)) {
    if (id === Net.id) continue;
    const p = playerOf(id);
    // a rider who picked a paint job shows up in its colour, everyone else in their player colour
    const paint = p.bike && p.bike !== 'factory' && LIVERIES[p.bike] ? LIVERIES[p.bike].plastic : null;
    R.others.set(id, { id, buf: [], x: race.runners[id].x || null, lane: 0, name: p.name, color: paint || p.color || '#888888', model: null, tag: null, ang: [0, 0], done: race.runners[id].done });
  }
  begin(def, 'online', performance.now() + countdown * 1000);
}
function addOtherModel(o) {
  if (!world) return;
  dropOther(o);
  o.lane = laneFor(o.id);
  o.model = makeBike({ ...(state.styles[o.id] || {}), ghost: o.color });
  world.scene.add(o.model.root);
  o.tag = nameTag(o.name, o.color);
  world.scene.add(o.tag);
}
function dropOther(o) {
  if (o.model) { disposeBike(o.model); o.model = null; }
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
  };
}
const DELAY = 130;   // draw the others a moment in the past, so there are always two messages to blend between
function sampleOther(o, now) {
  const buf = o.buf; if (!buf.length) return null;
  const t = now - DELAY;
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].at > t) i--;
  const b = buf[i]; const a = buf[Math.max(0, i - 1)];
  if (a === b || b.at <= a.at) return b;
  const k = Math.max(0, Math.min(1.2, (t - a.at) / (b.at - a.at)));
  const L = (p, q) => p + (q - p) * k;
  const out = { ...b };
  for (const f of ['x', 'y', 'rx', 'ry', 'c0', 'c1', 'l', 's', 'px', 'pz', 'ro']) out[f] = L(a[f], b[f]);
  out.a = lerpA(a.a, b.a, k); out.h = lerpA(a.h, b.h, k);
  return out;
}
function drawOthers(now, dt) {
  if (R.mode !== 'online' || !world) return null;
  let leader = null;
  for (const o of R.others.values()) {
    if (!o.model) continue;
    const m = sampleOther(o, now);
    o.model.root.visible = !!m; if (o.tag) o.tag.visible = !!m;
    if (!m) continue;
    o.ang[0] += (m.s / 3.6 / 0.35) * dt; o.ang[1] += (m.s / 3.6 / 0.34) * dt;
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
  const r2 = (v) => Math.round(v * 1000) / 1000;
  // x = how far along the track (for the order), px/pz/h = where you are and which way you point,
  // the rest is the bike's pose in its upright plane (relative to the frame)
  const msg = { x: r2(b.s), px: r2(b.px), pz: r2(b.pz), h: r2(b.h), ro: r2(R.roll), y: r2(b.y), a: r2(b.a), rx: r2(b.rx - b.x), ry: r2(b.ry - b.y),
    c0: r2(b.wh[0].c), c1: r2(b.wh[1].c), l: r2(b.lean),
    s: Math.round(Math.hypot(b.vx, b.vy) * 36) / 10, r: Math.round(b.rpm), th: r2(b.thr), k: b.crashed ? 1 : 0, b: b.boost ? 1 : 0, cp: b.cp };
  if (b.crashed && b.rider) msg.rg = [r2(b.rider.hip.x - b.x), r2(b.rider.hip.y), r2(b.rider.head.x - b.x), r2(b.rider.head.y)];
  Net.send('g:pos', msg);
}
function standings() {
  if (!state.race) return [];
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
    return h('div', { class: r.id === Net.id ? 'me' : '' }, h('i', { style: { background: (o && o.color) || p.color || '#888' } }), `${i + 1}. ${p.name}`, r.done ? ' 🏁' : '');
  }));
}
function otherSounds(b) {
  return [...R.others.values()].filter((o) => o.buf.length && o.model).map((o) => {
    const m = o.buf[o.buf.length - 1];
    return { id: o.id, rpm: m.r, thr: m.th, dist: m.x - b.s, lane: 0 };
  }).sort((p, q) => Math.abs(p.dist) - Math.abs(q.dist));
}
function onlineFinish(t) {
  const b = R.bike;
  Net.send('g:finish', { time: Math.round(t * 1000), cp: b.cp, crashes: b.crashes, flips: b.flips });
  fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, '🏁 Finished!'), h('div', { class: 'mx-big' }, fmt(t)), h('p', { class: 'muted' }, 'Waiting for the others…')));
}

const inRoom = () => !!(window.Room && Room.code);
Lobby.on('joined', (m) => {
  Object.assign(state, m.state);
  Net.send('g:style', { style: prefs.style });
  const url = new URL(location.href); url.searchParams.delete('solo'); url.searchParams.delete('track'); history.replaceState(null, '', url);
  if (state.phase === 'racing' && state.race) startRace(state.race, Math.max(0, -state.race.elapsed));
  else { setRiding(false); menus.show('room'); }
});
Lobby.on('players', () => menus.roomUpdate());
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
  state.settings = m.settings; state.ready = m.ready || {}; if (m.styles) state.styles = m.styles; if (m.phase !== 'racing') state.phase = m.phase;
  menus.roomUpdate();
});
Net.on('g:start', (m) => { startRace(m.race, m.countdown); });
Net.on('g:pos', (m) => {
  if (R.mode !== 'online') return;
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
Net.on('g:hurry', (m) => { if (R.running && !R.finished && !R.spectate) showMessage(`Someone finished! ${m.seconds}s left`, 'bad', 3000); });
Net.on('g:toast', (m) => UI.toast(m.text, 'bad', 3500));
Net.on('g:results', (m) => {
  state.results = m.results; state.wins = m.wins || {}; state.phase = 'results';
  const racing = riding && R.mode === 'online';
  if (racing) {
    const rows = m.results.rows;
    fill($('#hud-center'), h('div', { class: 'mx-card' }, h('h2', {}, '🏁 Results'),
      h('div', { class: 'rows' }, rows.slice(0, 6).map((r) => h('div', {}, h('span', {}, r.done ? ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}` : '–'), h('span', { class: 'grow' }, r.name), h('b', {}, r.done ? fmt(r.time / 1000) : 'DNF'))))));
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
  if (!DATA.tracks.some((t) => t.id === prefs.track)) prefs.track = DATA.tracks[0].id;
  if (setupRenderer()) resize();
  menus = createMenus({
    get DATA() { return DATA; }, trackDef, prefs, savePrefs, bestOf, MEDALS, medalTimes, medalFor, fmt, LIVERIES, state,
    get unlocked() { return unlocked; }, get bikeList() { return bikeList; }, bikeHints, myLivery, chooseLivery,
    chat: chatEl,
    startSolo,
    watchRace: () => { if (state.race) startRace(state.race, 0, true); },
    MODELS, KITS, HELMETS, get style() { return prefs.style; }, setStyle,
    setCam: (k) => { prefs.cam = R.camMode = k; savePrefs(); },
    setQuality: (k) => { prefs.quality = k; savePrefs(); worldKey = null; resize(); if (stage.trackId) stageTrack(stage.trackId); },
    stage: { solo: stageSolo, room: stageRoom },
  });
  const qs = new URLSearchParams(location.search);
  window.Lobby.init({ game: 'moto', title: 'Motocross', emoji: '🏍️' });
  // your account and friends: the buttons from the site's top bar move into the game's
  const icons = $('#mx-icons');
  const friendsBtn = $('.topbar .friends-btn'); const chip = $('.topbar .profile-chip');
  if (friendsBtn) icons.insertBefore(friendsBtn, $('#mx-snd'));
  if (chip) icons.append(chip);
  Lobby.ChatBox(chatEl, { title: '' });
  chatEl.prepend(h('div', { class: 'mx-h' }, 'Chat'));
  if (qs.get('room')) menus.show('joining');   // (the lobby is joining it)
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
    window.__moto = { R, C, keys, touch, startSolo, trackDef, stage, get menus() { return menus; }, get world() { return world; }, get renderer() { return renderer; }, get camera() { return camera; },
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
