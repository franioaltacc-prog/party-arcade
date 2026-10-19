/* Motocross: the game page — menus, the ride (input, camera, HUD, effects), solo time trials and
   online races. The physics is in core.js, the 3D bike in bike.js, the world in world.js and the
   sound in sound.js. */
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeBike, poseBike, disposeBike, LIVERIES } from './bike.js';
import { createAudio } from './sound.js';

const { $, h, fill, Net, Sfx, UI, store, Account, Unlocks } = PA;
const FX = PA.FX || {};
const C = window.MotoCore;
const DT = C.DT;

// ------------------------------------------------------------------ data and preferences
let DATA = null;
const builtTracks = new Map();
const trackDef = (id) => DATA.tracks.find((t) => t.id === id) || DATA.tracks[0];
const physicsTrack = (def) => { if (!builtTracks.has(def.id)) builtTracks.set(def.id, C.build(def)); return builtTracks.get(def.id); };
const prefs = Object.assign({ cam: 'chase', quality: 'auto', livery: 'factory' }, store.get('moto_prefs', {}));
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
async function loadUnlocks() {
  try {
    const d = await Unlocks.load();
    const u = Account.user;
    if (!u) { unlocked = new Set((d.bikes || []).filter((b) => !b.rule).map((b) => b.id)); return; }
    const prof = await Net.request('profile:get', { name: u.name });
    const have = await Unlocks.of(prof.profile.level, prof.profile.stats || {});
    unlocked = have.bike || new Set(['factory']);
  } catch { /* offline: keep the default */ }
  if (!unlocked.has(prefs.livery)) prefs.livery = 'factory';
}
const myLivery = () => (Account.user && Account.user.look && Account.user.look.bike && unlocked.has(Account.user.look.bike) ? Account.user.look.bike : unlocked.has(prefs.livery) ? prefs.livery : 'factory');

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
  if (world) { world.dispose(); world = null; }
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
  stuck: 0, hudAt: 0, trickTimer: null, lastLand: 0, emitAcc: 0,
};
const keys = {};
const touch = { gas: false, brake: false, back: false, fwd: false, nitro: false };

function snap(b) {
  const f = b.wh[0]; const r = b.wh[1];
  return {
    x: b.x, y: b.y, a: b.a, wf: [f.x, f.y, f.ang], wr: [r.x, r.y, r.ang], rx: b.rx, ry: b.ry, lean: b.lean,
    boost: b.boost, crashed: b.crashed, ragdoll: b.rider ? { hip: { x: b.rider.hip.x, y: b.rider.hip.y }, head: { x: b.rider.head.x, y: b.rider.head.y } } : null,
  };
}
const lerpA = (p, q, t) => { let d = q - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return p + d * t; };
function mix(p, q, t) {
  const L = (a, b) => a + (b - a) * t;
  return {
    x: L(p.x, q.x), y: L(p.y, q.y), a: lerpA(p.a, q.a, t), lean: L(p.lean, q.lean), rx: L(p.rx, q.rx), ry: L(p.ry, q.ry),
    wf: [L(p.wf[0], q.wf[0]), L(p.wf[1], q.wf[1]), L(p.wf[2], q.wf[2])], wr: [L(p.wr[0], q.wr[0]), L(p.wr[1], q.wr[1]), L(p.wr[2], q.wr[2])],
    boost: q.boost, crashed: q.crashed, ragdoll: q.ragdoll && p.ragdoll ? { hip: { x: L(p.ragdoll.hip.x, q.ragdoll.hip.x), y: L(p.ragdoll.hip.y, q.ragdoll.hip.y) }, head: { x: L(p.ragdoll.head.x, q.ragdoll.head.x), y: L(p.ragdoll.head.y, q.ragdoll.head.y) } } : q.ragdoll,
  };
}

/** Read the controls: keyboard, the touch buttons and a gamepad. */
function controls() {
  let gas = keys.KeyD || keys.ArrowRight || touch.gas ? 1 : 0;
  let brake = keys.KeyA || keys.ArrowLeft || touch.brake ? 1 : 0;
  let lean = (keys.KeyS || keys.ArrowDown || touch.fwd ? 1 : 0) - (keys.KeyW || keys.ArrowUp || touch.back ? 1 : 0);
  let nitro = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.nitro);
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    gas = Math.max(gas, p.buttons[7] ? p.buttons[7].value : 0);
    brake = Math.max(brake, p.buttons[6] ? p.buttons[6].value : 0);
    if (Math.abs(p.axes[1] || 0) > 0.2) lean = p.axes[1];
    if (p.buttons[0] && p.buttons[0].pressed) nitro = true;
  }
  return { gas, brake, lean, nitro };
}

/** Start a ride. mode 'solo' or 'online'; goAt: when the gate drops (performance.now() time). */
function begin(def, mode, goAt) {
  if (!setupRenderer()) return false;
  stopRide();
  showScreen('ride');
  R.mode = mode; R.def = def; R.T = physicsTrack(def); R.ride = (R.ride || 0) + 1;
  fill($('#hud-center'), h('div', { class: 'mx-loading' }, h('div', { class: 'mx-spin' }), 'Building the track…'));
  resize();
  // let the loading message show before the (slow) world build
  setTimeout(() => {
    loadWorld(def);
    R.lane = mode === 'online' ? laneFor(Net.id) : 0;
    R.bike = C.newBike(R.T);
    R.prev = R.cur = snap(R.bike);
    if (R.model) disposeBike(R.model);
    R.model = makeBike({ livery: myLivery() });
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
const laneFor = (id) => {
  const ids = state.race ? Object.keys(state.race.runners).sort() : [id];
  const i = Math.max(0, ids.indexOf(id));
  const lanes = [0, -1.8, 1.8, -3.2, 3.2, -0.9, 0.9, -2.6, 2.6, -3.6];
  return lanes[i % lanes.length];
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
function render(now, dt, alpha) {
  const w = world; const b = R.bike;
  const s = mix(R.prev, R.cur, alpha);
  const heading = w.headingAt(s.x);
  const lane = R.lane;
  const lift = w.bank(s.x, lane);
  const place = (x, y, out) => w.place(x, y + lift, lane, out);
  // lean the bike into corners (berms tilt you; faster = more)
  const speed = Math.hypot(b.vx, b.vy);
  const k = (w.headingAt(s.x + 2) - w.headingAt(s.x - 2)) / 4;
  const roll = Math.max(-0.6, Math.min(0.6, k * speed * speed * 0.09));
  s.roll = roll;
  poseBike(R.model, s, place, heading, now / 1000);
  // gates drop at GO
  if (R.gateDown) for (const gg of w.gates) gg.rotation.z = Math.min(Math.PI / 2 * 0.95, gg.rotation.z + dt * 7);
  // other riders
  drawOthers(now, place);
  // dust, roost and smoke
  effects(s, dt, lane, lift);
  updateCamera(s, dt, heading, speed, lane, lift);
  w.update(R.model.root.position, dt, camera);
  if (R.audio) {
    R.audio.update(b, dt, { scrub: b.scrub, surface: C.surfaceAt(R.T, b.x) });
    if (R.mode === 'online') R.audio.others(otherSounds(b));
  }
  renderer.render(w.scene, camera);
  if (now - R.hudAt > 60) { R.hudAt = now; hud(now); }
  if (R.mode === 'online' && now - R.sentAt > 80) sendPos(false);
}

function updateCamera(s, dt, heading, speed, lane, lift) {
  const w = world; const cam = R.cam;
  const D = tmpV.set(Math.cos(heading), 0, Math.sin(heading));
  const Rt = tmpV2.set(-Math.sin(heading), 0, Math.cos(heading));
  const focusX = s.crashed && s.ragdoll ? s.ragdoll.hip.x : s.x;
  const focusY = (s.crashed && s.ragdoll ? s.ragdoll.hip.y : s.y) + lift;
  const P = w.place(focusX, focusY, lane, tmpV3);
  const ground = w.trackY(focusX);
  const air = Math.max(0, focusY - ground - 0.7);
  let want; let look; let fov = 56 + Math.min(10, speed * 0.32);
  if (R.camMode === 'side') {
    want = P.clone().addScaledVector(Rt, 10.5 + air * 0.5).addScaledVector(D, 2).add(UPV.clone().multiplyScalar(1.8 + air * 0.25));
    look = P.clone().addScaledVector(D, 3).add(UPV.clone().multiplyScalar(0.6));
    fov -= 6;
  } else if (R.camMode === 'close') {
    want = P.clone().addScaledVector(D, -4.4).addScaledVector(Rt, 0.9).add(UPV.clone().multiplyScalar(1.7 + air * 0.25));
    look = P.clone().addScaledVector(D, 5).add(UPV.clone().multiplyScalar(0.9));
  } else {
    // Cork7-style chase: behind, a little to the side and above, looking down the track
    want = P.clone().addScaledVector(D, -4.7).addScaledVector(Rt, 1.25).add(UPV.clone().multiplyScalar(1.85 + air * 0.3));
    look = P.clone().addScaledVector(D, 5).add(UPV.clone().multiplyScalar(0.95 + air * 0.2));
  }
  // keep the camera out of the ground
  const sCam = focusX + (R.camMode === 'side' ? 2 : R.camMode === 'close' ? -4.4 : -4.7);
  const uCam = lane + (R.camMode === 'side' ? 10.5 : R.camMode === 'close' ? 0.9 : 1.25);
  want.y = Math.max(want.y, w.height(sCam, uCam) + 1.1);
  if (!cam.init) { cam.pos.copy(want); cam.look.copy(look); cam.fov = fov; cam.init = true; }
  const kPos = 1 - Math.exp(-dt * (R.camMode === 'side' ? 5 : 4.2));
  const kLook = 1 - Math.exp(-dt * 9);
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
function effects(s, dt, lane, lift) {
  const b = R.bike; const w = world; const fx = w.fx; const th = w.theme;
  R.emitAcc += dt;
  if (R.emitAcc < 1 / 60) return;
  const step = R.emitAcc; R.emitAcc = 0;
  const heading = w.headingAt(b.x);
  const D = [Math.cos(heading), Math.sin(heading)];
  const speed = Math.hypot(b.vx, b.vy);
  const surface = C.surfaceAt(R.T, b.x);
  const colPuff = surface === 1 ? fx.colors.mud : fx.colors.puff;
  const colChunk = surface === 1 ? fx.colors.mud : fx.colors.chunk;
  const rear = b.wh[1];
  const emitAt = (wx, wy, n, kind, power) => {
    const p = w.place(wx, wy + lift, lane, tmpV3);
    for (let i = 0; i < n; i++) {
      const back = -(2 + Math.random() * 5) * power; const up = (0.8 + Math.random() * 3) * power; const side = (Math.random() - 0.5) * 2.4 * power;
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
  if (b.scrub > 0.5) emitAt(b.x, b.y - 0.55, 2, 'chunk', 1.2);
  if (!b.crashed && b.wh[0].ct && b.brk > 0.5 && speed > 4) emitAt(b.wh[0].x, b.wh[0].y - 0.33, 1, 'puff', 0.5);
  if (b.crashed && speed > 2 && Math.random() < 0.5) emitAt(b.x, b.y - 0.3, 2, 'puff', 0.8);
  // exhaust
  if (Math.random() < 0.18 + b.thr * 0.3) {
    const ex = R.model.root.localToWorld(tmpV.set(-0.82, 0.4, 0.17));
    fx.puff(ex.x, ex.y, ex.z, -D[0] * 0.6, 0.25, -D[1] * 0.6, { life: 0.8, size: 0.12, grow: 0.7, alpha: b.boost ? 0 : 0.12, drag: 1, color: fx.colors.smoke });
  }
}
function burst(x, y, n, kind, power) {
  const w = world; if (!w) return;
  const p = w.place(x, y + w.bank(x, R.lane), R.lane, new THREE.Vector3());
  const col = C.surfaceAt(R.T, x) === 1 ? w.fx.colors.mud : w.fx.colors.puff;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2; const sp = (1 + Math.random() * 3) * power;
    w.fx.puff(p.x, p.y, p.z, Math.cos(a) * sp, 0.6 + Math.random() * power, Math.sin(a) * sp, { life: 1.2 + Math.random(), size: 0.8, grow: 3.5 + power * 2, alpha: w.theme.snowing ? 0.55 : 0.38, drag: 1.6, color: col });
  }
}

// ------------------------------------------------------------------ HUD
let mapBase = null;
function drawMapBase() {
  const cv = $('#hud-map'); const T = R.T;
  const W = cv.width; const H = cv.height;
  mapBase = document.createElement('canvas'); mapBase.width = W; mapBase.height = H;
  const g = mapBase.getContext('2d');
  let lo = Infinity; let hi = -Infinity;
  for (let x = T.start; x <= T.finish; x += 2) { const y = C.groundY(T, x); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const sx = (x) => 4 + (x - T.start) / (T.finish - T.start) * (W - 8);
  const sy = (y) => H - 8 - (y - lo) / Math.max(4, hi - lo) * (H - 20);
  R.mapX = sx; R.mapY = sy;
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineJoin = 'round';
  g.beginPath();
  for (let x = T.start; x <= T.finish; x += 1.5) { const px = sx(x); const py = sy(C.groundY(T, x)); if (x === T.start) g.moveTo(px, py); else g.lineTo(px, py); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.9)';
  for (const c of T.cps) { g.fillRect(sx(c) - 1, 2, 2, H - 6); }
  g.fillStyle = '#fff'; g.fillRect(sx(T.finish) - 2, 2, 4, H - 6);
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
  $('#hud-sub').textContent = R.mode === 'online' && state.race ? `P${myPlace()} / ${Object.keys(state.race.runners).length}  ·  CP ${b.cp + 1}/${T.cps.length}` : `CHECKPOINT ${b.cp + 1} / ${T.cps.length}`;
  $('#hud-left').textContent = `${Math.max(0, Math.round(T.finish - b.x))} M LEFT`;
  // minimap: you and the others on the track's profile
  const cv = $('#hud-map'); const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height); g.drawImage(mapBase, 0, 0);
  const dot = (x, col, r) => { const xx = Math.min(T.finish, Math.max(T.start, x)); g.fillStyle = col; g.beginPath(); g.arc(R.mapX(xx), R.mapY(C.groundY(T, xx)) - 3, r, 0, 7); g.fill(); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke(); };
  for (const o of R.others.values()) if (o.x != null) dot(o.x, o.color, 4);
  dot(b.x, '#ffd21a', 5.5);
  if (R.mode === 'online') drawBoard();
}

// ------------------------------------------------------------------ solo: finishing and the menu
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
  setTimeout(() => {
    if (R.ride !== ride || $('#ride').classList.contains('hidden')) return;
    fill($('#hud-center'), h('div', { class: 'mx-card' },
      h('div', { class: 'mx-medal' }, medal >= 0 ? MEDALS[medal][0] : '🏁'),
      h('h2', {}, medal >= 0 ? `${MEDALS[medal][1]} medal!` : 'Finished!'),
      h('div', { class: 'mx-big' }, fmt(t)),
      h('p', { class: 'muted' }, prev ? (better ? `🎉 New best! ${fmt((prev.ms - ms) / 1000)} faster` : `Your best: ${fmt(prev.ms / 1000)}`) : 'First finish on this track!'),
      h('div', { class: 'mx-stats' },
        h('span', {}, `🤸 ${b.flips} flip${b.flips === 1 ? '' : 's'}`), h('span', {}, `💥 ${b.crashes} crash${b.crashes === 1 ? '' : 'es'}`), h('span', {}, `💨 ${Math.round(b.maxSpeed * 3.6)} km/h top`)),
      medal !== 0 ? h('p', { class: 'small muted' }, `Next: ${MEDALS[Math.max(0, (medal < 0 ? 3 : medal) - 1)][0]} ${fmt(medalTimes(def)[Math.max(0, (medal < 0 ? 3 : medal) - 1)])}`) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'btn btn-pink', onclick: () => startSolo(def) }, '🔁 Again (Enter)'),
        next ? h('button', { class: 'btn btn-cyan', onclick: () => startSolo(next) }, `${next.emoji} Next track`) : null,
        h('button', { class: 'btn btn-ghost', onclick: () => { stopRide(); showMenu(); } }, '🗺️ Tracks'))));
  }, 900);
}
function startSolo(def) {
  if (begin(def, 'solo', performance.now() + 3200)) {
    const url = new URL(location.href); url.searchParams.set('solo', '1'); url.searchParams.set('track', def.id); history.replaceState(null, '', url);
  }
}

async function showMenu() {
  showScreen('menu');
  await loadUnlocks();
  const bikes = (await Unlocks.load()).bikes || [];
  const pick = myLivery();
  const camNames = { chase: '🎥 Chase', side: '📺 Side', close: '🎬 Close' };
  fill($('#menu'),
    h('div', { class: 'menu-head' }, h('div', { class: 'game-icon' }, '🏍️'), h('h1', { class: 'display' }, 'Motocross'),
      h('p', { class: 'muted' }, 'Pick a track and ride! Lean to land your jumps, flip for nitro, and beat the medal times. Your best times go on the leaderboards.')),
    h('div', { class: 'tracks' }, DATA.tracks.map((t) => {
      const best = bestOf(t.id);
      const medal = best ? medalFor(t, best.ms / 1000) : -1;
      return h('button', { class: 'track-card mx-tc mx-' + t.theme, onclick: () => startSolo(t) },
        h('div', { class: 'tc-top' }, h('span', { class: 'tc-e' }, t.emoji), h('b', {}, t.name), h('span', { style: { marginLeft: 'auto', fontSize: '1.4rem' } }, medal >= 0 ? MEDALS[medal][0] : '')),
        h('div', { class: 'tc-about' }, t.about),
        h('div', { class: 'tc-best' }, best ? `Best: ${fmt(best.ms / 1000)}` : 'Not ridden yet'),
        h('div', { class: 'tc-medals' }, medalTimes(t).map((m, i) => `${MEDALS[i][0]} ${fmt(m)}`).join('  ')));
    })),
    h('div', { class: 'panel mx-garage' },
      h('div', { class: 'panel-title' }, '🏍️ Your bike', h('span', { class: 'count' }, `${bikes.filter((b) => unlocked.has(b.id)).length}/${bikes.length}`)),
      h('div', { class: 'mx-liveries' }, bikes.map((b) => {
        const lv = LIVERIES[b.id] || LIVERIES.factory; const have = unlocked.has(b.id);
        return h('button', {
          class: 'mx-livery' + (b.id === pick ? ' on' : '') + (have ? '' : ' locked'), title: have ? lv.name : `🔒 ${b.about || 'Locked'}`,
          style: { '--c1': lv.plastic, '--c2': lv.accent },
          onclick: () => { if (!have) { UI.toast(`🔒 ${lv.name}: ${b.about}`, '', 3500); return; } chooseLivery(b.id); },
        }, h('i', {}), h('span', {}, have ? lv.name : '🔒'));
      })),
      h('p', { class: 'tiny faint' }, Account.user ? 'Level up and win races to unlock more paint jobs. Everyone online sees yours.' : 'Log in to unlock more paint jobs as you level up.')),
    h('div', { class: 'mx-opts' },
      h('label', {}, 'Camera ', h('select', { class: 'input', onchange: (e) => { prefs.cam = R.camMode = e.target.value; savePrefs(); } },
        Object.entries(camNames).map(([k, v]) => h('option', { value: k, selected: prefs.cam === k }, v)))),
      h('label', {}, 'Graphics ', h('select', { class: 'input', onchange: (e) => { prefs.quality = e.target.value; savePrefs(); worldKey = null; } },
        [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low (faster)']].map(([k, v]) => h('option', { value: k, selected: prefs.quality === k }, v))))),
    h('div', { class: 'center', style: { marginTop: '16px', gap: '8px', flexWrap: 'wrap' } },
      h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { history.replaceState(null, '', location.pathname); showScreen('entry'); Lobby.showEntry(); } }, '👥 Race friends online')),
    h('p', { class: 'mx-keys' }, 'D / → gas · A / ← brake · W / ↑ lean back · S / ↓ lean forward · Space nitro · R back to checkpoint · C camera · M mute'));
  if (FX.list) FX.list($('#menu .tracks').children, { y: 24, stagger: 0.05, duration: 0.45, ease: 'back.out(1.5)' });
}
async function chooseLivery(id) {
  prefs.livery = id; savePrefs();
  if (Account.user) { try { await Account.wear({ bike: id }); } catch (e) { UI.toast(e.message || 'Couldn’t save that', 'bad'); } }
  Sfx.play('coin');
  if (R.mode !== 'online') showMenu(); else renderRoomMain();
}

// ------------------------------------------------------------------ screens and buttons
function showScreen(name) {
  for (const s of ['entry', 'room', 'menu']) $('#' + s).classList.toggle('hidden', s !== name);
  $('#ride').classList.toggle('hidden', name !== 'ride');
  document.body.classList.toggle('mx-riding', name === 'ride');
  if (name !== 'ride') { stopRide(); fill($('#hud-center')); }
  if (name !== 'ride') scrollTo({ top: 0 });
}
function quit() {
  if (R.mode === 'online') { stopRide(); showScreen('room'); renderRoomMain(); } else { stopRide(); showMenu(); }
}
$('#mx-quit').addEventListener('click', quit);
$('#mx-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if ($('#ride').requestFullscreen) $('#ride').requestFullscreen().catch(() => {});
});
const muteBtn = $('#mx-mute');
const showMute = () => { muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; };
muteBtn.addEventListener('click', () => { Sfx.setMuted(!Sfx.muted); showMute(); });
showMute();
const camBtn = $('#mx-cam');
const CAMS = ['chase', 'side', 'close'];
camBtn.addEventListener('click', () => { R.camMode = CAMS[(CAMS.indexOf(R.camMode) + 1) % CAMS.length]; prefs.cam = R.camMode; savePrefs(); R.cam.init = false; showMessage(`${R.camMode.toUpperCase()} CAMERA`, 'small', 900); });

addEventListener('keydown', (e) => {
  if (!R.running) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyR') respawnNow();
  else if (e.code === 'KeyC' && !e.repeat) camBtn.click();
  else if (e.code === 'KeyM' && !e.repeat) muteBtn.click();
  else if (e.code === 'Enter' && R.mode === 'solo' && (R.finished || performance.now() > R.goAt)) startSolo(R.def);
  else if (e.code === 'Escape') quit();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });
for (const btn of document.querySelectorAll('#mx-touch [data-k]')) {
  const k = btn.dataset.k;
  const set = (v) => (e) => { e.preventDefault(); if (k === 'respawn') { if (v) respawnNow(); return; } touch[k] = v; btn.classList.toggle('on', v); };
  btn.addEventListener('pointerdown', set(true)); btn.addEventListener('pointerup', set(false)); btn.addEventListener('pointercancel', set(false)); btn.addEventListener('pointerleave', set(false));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const k of Object.keys(keys)) keys[k] = false; });

// ------------------------------------------------------------------ online races
const state = { phase: 'lobby', settings: { track: 'desert' }, race: null, results: null, wins: {}, ready: {} };
function myPlace() { return 1; }
function drawBoard() {}
function otherSounds() { return []; }
function drawOthers() {}
function addOtherModel() {}
function sendPos() {}
function onlineFinish() {}
function renderRoomMain() {}

// ------------------------------------------------------------------ start
async function init() {
  try { DATA = await (await fetch('/js/games/moto/tracks.json')).json(); } catch { UI.toast('Couldn’t load the tracks 😵', 'bad'); return; }
  window.Lobby.init({
    game: 'moto', title: 'Motocross', emoji: '🏍️',
    tagline: 'Realistic 3D dirt bikes! Huge jumps, flips for nitro, and races against your friends.',
    solo: { label: '🏁 Ride solo (time trial)', onClick: () => showMenu() },
    howTo: '<b>How to ride</b><ul><li><b>D / →</b> gas, <b>A / ←</b> brake.</li><li><b>W / ↑</b> lean back, <b>S / ↓</b> lean forward: in the air that spins the bike, so match the slope you land on!</li><li>Land on your head or upside down and you crash: back to the last checkpoint.</li><li>Clean landings and flips fill your <b>nitro</b>. Hold <b>Space</b> to use it.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  const qs = new URLSearchParams(location.search);
  if (qs.get('solo')) {
    $('#entry').classList.add('hidden');
    const t = qs.get('track') && DATA.tracks.find((x) => x.id === qs.get('track'));
    if (t) { await loadUnlocks(); startSolo(t); } else showMenu();
  }
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {   // testing on your own computer only
    // (the browser pane used for testing barely runs animation frames, so tests drive the game by hand)
    let fake = 0;
    window.__moto = { R, C, keys, touch, startSolo, trackDef, showMenu, get world() { return world; }, get renderer() { return renderer; }, get camera() { return camera; },
      /** Run the game for `seconds` of game time with these controls held, then draw one frame. */
      advance(seconds, held = {}) {
        if (!R.bike) return null;
        R.running = false;
        if (!fake) fake = performance.now();
        R.override = typeof held === 'function' ? held : null;
        Object.assign(touch, { gas: false, brake: false, back: false, fwd: false, nitro: false }, R.override ? {} : held);
        const n = Math.round(seconds / DT);
        for (let i = 0; i < n; i++) { fake += DT * 1000; if (fake >= R.goAt && !R.gateDown) { R.gateDown = true; } physicsStep(fake); }
        render(fake, 1 / 60, 1);
        for (let i = 0; i < 30; i++) render(fake, 1 / 60, 1);   // let the camera settle
        return { x: R.bike.x, y: R.bike.y, a: R.bike.a, t: R.bike.t, crashed: R.bike.crashed, speed: Math.hypot(R.bike.vx, R.bike.vy) * 3.6, cp: R.bike.cp, finished: R.finished };
      } };
  }
}
init();
