/* Free ride: a supercar instead of the bike. A body on four springy wheels that follow the real ground (ramps,
   gap jumps and hills work like they do for the bike), a fast engine with seven gears, grip that lets go when you
   push it (Q is the handbrake, for drifts), turbo, and a little control in the air (Q / E tip the nose).
   It looks after the same fields as MotoCore's bike (px, pz, y, h, vx, wh, crashed…), so game.js can drive it with
   the same camera, map, coins, gap jumps and respawns. Headings are MotoCore's: forward is (cos h, sin h) in x, z. */
const DT = 1 / 120;
const WB = [1.32, -1.28];              // front and rear axle, metres ahead of the middle
const TRACK = 0.84;                    // each wheel's distance out from the middle
const R = 0.34;                        // wheel radius
const REST = 0.34;                     // spring length with nothing on it
const K = 21.9;                        // spring stiffness per wheel (per kg of car): it sits 0.12 m down
const C = 2.9;                         // spring damping
const MOUNT = -0.2;                    // where the springs are fixed, below the middle of the car
const IP = 1.15; const IR = 0.55;      // how hard it is to pitch and to roll (per kg)
const WHEELS = [[WB[0], -TRACK], [WB[0], TRACK], [WB[1], -TRACK], [WB[1], TRACK]];   // front left, front right, rear left, rear right
const G = 10.5;
const VMAX = 92;                       // top speed (m/s; with turbo a little more)
const GEARS = [0, 14, 24, 35, 47, 60, 75, 999];   // speeds (m/s) each gear runs up to

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const P = () => globalThis.MotoCore.P;

export function newBike(T) {
  const b = {
    car: true, px: 0, pz: 0, y: 0, h: 0, x: 0, s: 0, vel: [0, 0, 0], yaw: 0, pitch: 0, pr: 0, roll: 0, rr: 0,
    comp: [0.12, 0.12, 0.12, 0.12], wspin: [0, 0], steer: 0, steerVis: 0, vx: 0, vy: 0, a: 0, lean: 0, rx: 0, ry: 0,
    wh: [{ ct: true, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }, { ct: true, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }],
    crashed: 0, crashes: 0, flips: 0, maxSpeed: 0, boost: false, nitro: P().FREE_START_TURBO, gear: 1, rpm: P().IDLE, thr: 0, brk: 0,
    limiter: false, hold: 0, t: 0, cp: -1, finished: null, rider: null, tk: 0, pose: 0, whip: 0, spin: 0, scrub: 0, slide: 0, G: null,
    air: 0, upside: 0, padT: 0,
  };
  place(T, b, T.spawn);
  return b;
}

/** Put the car at spot ({ position: [x, z], heading (map heading: 0 = +z) }), standing still on the ground. */
export function place(T, b, spot) {
  const g = T.terrain;
  b.px = spot.position[0]; b.pz = spot.position[1]; b.h = Math.PI / 2 - (spot.heading || 0);
  const c = Math.cos(b.h); const s = Math.sin(b.h);
  const front = g.heightAt(b.px + c * 1.3, b.pz + s * 1.3); const back = g.heightAt(b.px - c * 1.3, b.pz - s * 1.3);
  const left = g.heightAt(b.px + s * TRACK, b.pz - c * TRACK); const right = g.heightAt(b.px - s * TRACK, b.pz + c * TRACK);
  b.pitch = Math.atan2(front - back, 2.6); b.roll = Math.atan2(right - left, 2 * TRACK); b.pr = b.rr = 0;   // (sitting level with the ground, a side slope too)
  b.y = (front + back) / 2 + (R + REST - 0.12 - MOUNT) / Math.max(0.3, Math.cos(b.pitch) * Math.cos(b.roll));   // (the springs stand square to a tilted ground)
  b.vel = [0, 0, 0]; b.yaw = 0; b.vx = b.vy = 0; b.steer = 0;
  b.crashed = 0; b.air = 0; b.upside = 0; b.boost = false; b.comp = [0.12, 0.12, 0.12, 0.12];
  sync(b);
}

/** Back to a safe pad (or spot), like MotoCore.respawn. */
export function respawn(T, b, u = 0, spot = null) {
  const keep = { nitro: b.nitro, crashes: b.crashes, flips: b.flips, maxSpeed: b.maxSpeed, t: b.t, x: b.x };
  place(T, b, spot || T.terrain.nearestSafePad(b.px, b.pz));
  Object.assign(b, keep); b.s = b.x;
  b.hold = P().HOLD_TIME;
}

function sync(b) {
  b.rx = b.x; b.ry = b.y; b.s = b.x; b.a = b.pitch;
  b.wh[0].x = b.x + WB[0]; b.wh[1].x = b.x + WB[1];
  b.wh[0].y = b.y + MOUNT - (REST - (b.comp[0] + b.comp[1]) / 2); b.wh[1].y = b.y + MOUNT - (REST - (b.comp[2] + b.comp[3]) / 2);
  b.wh[0].ang = b.wspin[0]; b.wh[1].ang = b.wspin[1];
}

const basis = { f: [0, 0, 0], r: [0, 0, 0], u: [0, 0, 0] };
/** The car's own axes in the world (forward, right, up) from heading, pitch and roll. */
function axes(b) {
  const c = Math.cos(b.h); const s = Math.sin(b.h); const cp = Math.cos(b.pitch); const sp = Math.sin(b.pitch); const cr = Math.cos(b.roll); const sr = Math.sin(b.roll);
  const f0 = [c, 0, s]; const r0 = [-s, 0, c];
  const f = [f0[0] * cp, sp, f0[2] * cp]; const u1 = [-f0[0] * sp, cp, -f0[2] * sp];
  basis.f = f; basis.r = [r0[0] * cr + u1[0] * sr, u1[1] * sr, r0[2] * cr + u1[2] * sr]; basis.u = [u1[0] * cr - r0[0] * sr, u1[1] * cr, u1[2] * cr - r0[2] * sr];
  return basis;
}

/** One physics step (1/120 s). inp: { gas, brake, steer, lean, nitro, hold }. Returns events like MotoCore.step. */
export function step(T, b, inp) {
  const ev = []; const g = T.terrain; const out = !!b.crashed; const Pc = P();
  const gas = out || inp.hold ? 0 : clamp(+inp.gas || 0, 0, 1); const brake = out || inp.hold ? 0 : clamp(+inp.brake || 0, 0, 1);
  const hand = !out && !inp.hold && (+inp.lean || 0) < -0.3;   // Q: handbrake (drifts)
  if (!inp.hold) b.t += DT;
  b.thr += (gas - b.thr) * Math.min(1, DT * 8); b.brk = brake;
  b.steer += clamp((out || inp.hold ? 0 : clamp(+inp.steer || 0, -1, 1)) - b.steer, -DT * 4, DT * 4);
  const { f, r, u } = axes(b);
  // ---- the four springs
  let n = 0; const acc = [0, -G, 0]; let tp = 0; let tr = 0; let nx = 0; let ny = 0; let nz = 0; let grip = 0;
  for (let i = 0; i < 4; i++) {
    const [fo, lo] = WHEELS[i];
    const ax = b.px + f[0] * fo + r[0] * lo + u[0] * MOUNT; const ay = b.y + f[1] * fo + r[1] * lo + u[1] * MOUNT; const az = b.pz + f[2] * fo + r[2] * lo + u[2] * MOUNT;
    // the spring runs along the car's own down axis to the slope under it (measuring straight down squashes the
    // springs on a steep hill, and the wheels then rise up into the body)
    const gy = g.heightAt(ax, az); const nm = g.normalAt(ax, az);
    const un = Math.max(0.35, u[0] * nm.x + u[1] * nm.y + u[2] * nm.z);
    const comp = REST - ((ay - gy) * nm.y - R) / un;
    if (comp <= 0) { b.comp[i] = Math.max(0, b.comp[i] - DT * 2); continue; }
    n++; nx += nm.x; ny += nm.y; nz += nm.z;
    b.comp[i] = Math.min(comp, 0.32);
    const vAttach = b.vel[0] * nm.x + b.vel[1] * nm.y + b.vel[2] * nm.z + (b.pr * fo + b.rr * lo) * nm.y;   // (roll: + lifts the right side)
    let force = Math.max(0, K * comp - C * vAttach);
    if (comp > 0.3) force += (comp - 0.3) * 400 + Math.max(0, -vAttach) * 8;   // (bottoming out)
    acc[0] += nm.x * force; acc[1] += nm.y * force; acc[2] += nm.z * force;
    tp += force * fo; tr += force * lo;
    grip += g.surfaceAt(ax, az).grip;
  }
  const ground = n > 0;
  // ---- driving: along the ground under the car
  let v = b.vel[0] * Math.cos(b.h) + b.vel[2] * Math.sin(b.h);
  if (ground) {
    const nl = Math.hypot(nx, ny, nz) || 1; const N = [nx / nl, ny / nl, nz / nl];
    const c = Math.cos(b.h); const s = Math.sin(b.h);
    let fg = [c - N[0] * (c * N[0] + s * N[2]), -N[1] * (c * N[0] + s * N[2]), s - N[2] * (c * N[0] + s * N[2])]; const fl = Math.hypot(...fg) || 1; fg = fg.map((k) => k / fl);
    let rg = [-s, 0, c]; const rd = rg[0] * N[0] + rg[2] * N[2]; rg = [rg[0] - N[0] * rd, -N[1] * rd, rg[2] - N[2] * rd]; const rl = Math.hypot(...rg) || 1; rg = rg.map((k) => k / rl);
    const share = n / 4; const mu = (grip / n) * (hand ? 0.32 : 1);
    v = b.vel[0] * fg[0] + b.vel[1] * fg[1] + b.vel[2] * fg[2];
    const vmax = VMAX * (b.boost ? 1.18 : 1);
    let along = gas * 10.5 * Math.max(0, 1 - Math.max(0, v) / vmax) * (b.boost ? 1.7 : 1);
    if (brake) along -= v > 0.6 ? 13 : v > -9 ? 6 : 0;   // (stopped: S backs up)
    if (hand) along -= Math.sign(v) * Math.min(Math.abs(v) / DT, 4);
    along -= 0.0011 * v * Math.abs(v) + 0.25 * Math.sign(v) * (1 - Math.exp(-Math.abs(v)));
    for (let k = 0; k < 3; k++) acc[k] += fg[k] * along * share;
    // sideways: the tyres hold the car to its heading, up to what they can take (then it slides)
    const vlat = b.vel[0] * rg[0] + b.vel[1] * rg[1] + b.vel[2] * rg[2];
    const most = 26 * mu * share; const fix = clamp(-vlat / DT, -most, most);
    for (let k = 0; k < 3; k++) acc[k] += rg[k] * fix;
    b.slide = Math.abs(vlat) > 3 ? Math.min(1, (Math.abs(vlat) - 3) / 8) : 0; b.scrub = b.slide * 0.6;
    // steering: how fast it turns at this speed, no more than the grip allows (the handbrake lets the tail out)
    const lock = 0.62 / (1 + Math.abs(v) * 0.045);
    let yaw = v * Math.tan(b.steer * lock) / 2.6;
    const lim = (most / share) / Math.max(4, Math.abs(v)) * (hand ? 2.2 : 1.15);
    yaw = clamp(yaw, -lim, lim);
    b.yaw += (yaw - b.yaw) * Math.min(1, DT * (hand ? 4 : 10));
    b.wh[0].slip = b.wh[1].slip = b.slide;
  } else {
    b.yaw *= 1 - DT * 0.6;
    // in the air, Q / E tip the nose up and down
    b.pr += (+inp.lean || 0) * 2.6 * DT * (out ? 0 : 1);
    b.slide = 0;
  }
  b.h += b.yaw * DT;
  // ---- turning about the springs
  b.pr += (tp / IP) * DT; b.rr += (tr / IR) * DT;
  b.pr *= 1 - DT * (ground ? 2.5 : 0.4); b.rr *= 1 - DT * (ground ? 3 : 0.4);
  b.pitch += b.pr * DT; b.roll += b.rr * DT;
  // ---- move
  for (let k = 0; k < 3; k++) b.vel[k] += acc[k] * DT;
  if (inp.hold) { b.vel[0] *= 0.5; b.vel[2] *= 0.5; b.vel[1] = Math.min(b.vel[1], 0); }
  const fx = Math.cos(b.h); const fz = Math.sin(b.h);
  const moved = b.vel[0] * fx + b.vel[2] * fz;
  b.px += b.vel[0] * DT; b.pz += b.vel[2] * DT; b.y += b.vel[1] * DT;
  b.x += moved * DT;
  // the body never sinks into the ground
  const under = g.heightAt(b.px, b.pz);
  if (b.y - 0.36 < under) { b.y = under + 0.36; if (b.vel[1] < 0) b.vel[1] *= -0.2; }
  // ---- speed, gears and the engine note
  v = moved; b.vx = v; b.vy = b.vel[1];
  const speed = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
  if (!out) b.maxSpeed = Math.max(b.maxSpeed, speed);
  let gear = 1; while (gear < 7 && Math.abs(v) > GEARS[gear]) gear++;
  if (gear !== b.gear) { ev.push(['shift', gear]); b.gear = gear; }
  const lo = GEARS[gear - 1]; const hi = Math.min(GEARS[gear], VMAX * 1.2);
  const rpmWant = ground ? Pc.IDLE + (Pc.LIMIT - Pc.IDLE) * clamp((Math.abs(v) - lo) / (hi - lo), 0, 1) * 0.85 + gas * 900 : Pc.IDLE + gas * (Pc.LIMIT - Pc.IDLE) * 0.9;
  b.rpm += (rpmWant - b.rpm) * Math.min(1, DT * 10);
  b.limiter = false;
  // wheels turn with the ground speed
  b.wspin[0] += v / R * DT; b.wspin[1] += (v + (gas && b.slide ? 8 : 0)) / R * DT;
  b.wh[0].ct = b.comp[0] > 0 || b.comp[1] > 0; b.wh[1].ct = b.comp[2] > 0 || b.comp[3] > 0;
  // ---- turbo
  b.boost = !!(inp.nitro && b.nitro > 0 && !out && !inp.hold);
  if (b.boost) b.nitro = Math.max(0, b.nitro - Pc.FREE_TURBO_USE * DT);
  else if (!inp.nitro && !out && !inp.hold) b.nitro = Math.min(1, b.nitro + Pc.FREE_TURBO_REGEN * DT);
  // ---- in the air, and landing
  if (!ground) b.air += DT;
  else {
    if (b.air > 0.35 && !out) ev.push(['land', { air: b.air, clean: u[1] > 0.75, turns: 0, back: false, perfect: false, tricks: [], score: 0, gain: 0 }]);
    b.air = 0;
  }
  // ---- crashing: on its roof or side, into lava or deep water, a wall, the edge of the world
  if (!out && !inp.hold) {
    b.upside = u[1] < 0.3 && (ground || b.y - under < 1.2) ? b.upside + DT : 0;
    if (b.upside > 0.35) crash(b, ev);
    const hz = g.hazardAt ? g.hazardAt(b.px, b.pz) : null;
    if (!b.crashed && hz && b.y - 0.5 < hz.level + (hz.kind === 'lava' || hz.kind === 'tar' ? 0.5 : hz.kind === 'chasm' ? 0 : -0.3)) { crash(b, ev); b.vel = b.vel.map((k) => k * 0.3); ev.push(['hazard', hz]); }
    const o = g.obstacleAt ? g.obstacleAt(b.px, b.pz) : null;
    if (!b.crashed && o && b.y < o.top) {
      const dx = b.px - o.x; const dz = b.pz - o.z; const l = Math.hypot(dx, dz) || 1;
      b.px = o.x + dx / l * (o.r + 2.2); b.pz = o.z + dz / l * (o.r + 2.2);
      if (speed > 9) crash(b, ev); b.vel = [b.vel[0] * -0.25, b.vel[1], b.vel[2] * -0.25];
    }
    if (!b.crashed && !g.inBounds(b.px, b.pz)) { crash(b, ev); ev.push(['bounds']); }
    // boost pads
    const pad = ground && g.boostAt ? g.boostAt(b.px, b.pz) : null;
    if (pad && v > 1) {
      b.vel[0] += fx * Pc.FREE_BOOST_PAD * DT; b.vel[2] += fz * Pc.FREE_BOOST_PAD * DT; b.nitro = Math.min(1, b.nitro + 0.6 * DT);
      if (!(b.padT > 0)) ev.push(['pad']);
      b.padT = 0.4;
    } else if (b.padT > 0) b.padT -= DT;
  }
  if (b.crashed) { b.crashed += DT; b.vel[0] *= 1 - DT * 1.2; b.vel[2] *= 1 - DT * 1.2; }
  sync(b);
  return ev;
}

function crash(b, ev) {
  if (b.crashed) return;
  b.crashed = DT; b.crashes++; b.air = 0;
  ev.push(['crash']);
}
