/* Skyvvd: a wingsuit. You jump out of a helicopter over a high point and glide: W tips you into a dive (faster, steeper), S flares
   (flatter, and you slow down; hold it too long and you stall), A / D bank and turn. Fly low over the ground at speed
   for proximity points. Space pulls the parachute: you float down slowly and can steer it in; land under it and
   you're safe (R or Space again goes back up to launch). Touch the ground in the wingsuit and you crash.
   It looks after the same fields as MotoCore's bike and car.js's car (px, pz, y, h, vx, wh, crashed, and the car's
   pitch / roll / steer / comp, so game.js draws it, follows it and sends it online the way it does the car). */
const DT = 1 / 120;
const G = 9.8;
const K = 0.00143;         // drag: a 17° glide settles at about 45 m/s (a glide ratio of about 3.2)
const GLIDE = 0.3;         // the glide path angle (radians below level) with nothing pressed
const DIVE = 0.95;         // ...pushing W
const FLARE = -0.18;       // ...pulling S (climbing a little, while the speed lasts)
const STALL = 22;          // below this (m/s) the nose drops whatever you do
const CHUTE = { sink: 5.5, fwd: 8, turn: 0.9 };   // under the parachute: m/s down and forward, rad/s turning
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const P = () => globalThis.MotoCore.P;

export function newBike(T) {
  const b = {
    car: true, wing: true, px: 0, pz: 0, y: 0, h: 0, x: 0, s: 0, v: 20, gam: 0.3, bank: 0, chute: 0, landed: 0,
    pitch: 0, roll: 0, steer: 0, comp: [0, 0, 0, 0], wspin: [0, 0], vel: [0, 0, 0], vx: 0, vy: 0, a: 0, lean: 0, rx: 0, ry: 0, yaw: 0,
    wh: [{ ct: false, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }, { ct: false, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }],
    crashed: 0, crashes: 0, flips: 0, maxSpeed: 0, boost: false, nitro: 0, gear: 1, rpm: 0, thr: 0, brk: 0, limiter: false, hold: 0, t: 0, cp: -1,
    finished: null, rider: null, tk: -1, pose: 0, whip: 0, spin: 0, scrub: 0, slide: 0, G: null, air: 0, upside: 0, padT: 0, prox: 0, near: 0,
  };
  place(T, b, T.spawn);
  return b;
}

/** Put the flyer at spot ({ position: [x, z], heading (map heading) }): out of the helicopter, 120 m above it, at 25 m/s. */
export const DROP = 120;
export function place(T, b, spot) {
  const g = T.terrain;
  b.px = spot.position[0]; b.pz = spot.position[1]; b.h = Math.PI / 2 - (spot.heading || 0);
  b.y = g.heightAt(b.px, b.pz) + DROP; b.v = 25; b.gam = 0.45; b.bank = 0; b.chute = 0; b.landed = 0;
  b.crashed = 0; b.air = 0; b.steer = 0; b.near = 0;
  sync(b);
}

/** Back to the launch point (a wingsuit can't take off from where it fell). */
export function respawn(T, b, u = 0, spot = null) {
  const keep = { crashes: b.crashes, flips: b.flips, maxSpeed: b.maxSpeed, t: b.t, x: b.x, prox: b.prox };
  place(T, b, T.launch || spot || T.spawn);
  Object.assign(b, keep); b.s = b.x;
  b.hold = P().HOLD_TIME;
}

function sync(b) {
  const c = Math.cos(b.h); const s = Math.sin(b.h); const hv = b.v * Math.cos(b.gam);
  b.vel = [c * hv, -b.v * Math.sin(b.gam), s * hv]; b.vx = hv; b.vy = b.vel[1];
  b.pitch = -b.gam * (b.chute ? 0.15 : 0.8); b.roll = -b.bank; b.a = b.pitch; b.rx = b.x; b.ry = b.y; b.s = b.x;
  for (const w of b.wh) { w.x = b.x; w.y = b.y - 0.6; }
  b.comp[0] = b.chute;   // (how far the parachute's open: the model shows it from this)
}

/** One physics step. inp: { gas (W: dive), brake (S: flare), steer, nitro (Space: the parachute), hold }. */
export function step(T, b, inp) {
  const ev = []; const g = T.terrain; const out = !!b.crashed;
  if (!inp.hold) b.t += DT;
  if (inp.hold || out) {
    if (out) b.crashed += DT;
    sync(b); return ev;
  }
  const steer = clamp(+inp.steer || 0, -1, 1); b.steer += (steer - b.steer) * Math.min(1, DT * 5);
  // the parachute: Space pulls it (it opens over a second), and once you've landed under it, Space again goes back up
  if (inp.nitro && !b.chute && !b.landed) { b.chute = DT; ev.push(['chute']); }
  if (b.landed) { b.landed += DT; if (inp.nitro && b.landed > 1) ev.push(['relaunch']); sync(b); return ev; }
  if (b.chute) {
    b.chute = Math.min(1, b.chute + DT);
    const k = Math.min(1, b.chute * 1.5);   // (opening: the speed falls away)
    b.v += (Math.hypot(CHUTE.fwd, CHUTE.sink) - b.v) * Math.min(1, DT * 3 * k);
    b.gam += (Math.atan2(CHUTE.sink, CHUTE.fwd) - b.gam) * Math.min(1, DT * 3 * k);
    b.bank += (b.steer * 0.35 - b.bank) * Math.min(1, DT * 3);
    b.h += b.steer * CHUTE.turn * DT;
  } else {
    // the wingsuit: aim the path angle, bank to turn (as a plane does: tighter at lower speed)
    const want = clamp(GLIDE + (+inp.gas || 0) * (DIVE - GLIDE) - (+inp.brake || 0) * (GLIDE - FLARE), FLARE, DIVE);
    const stall = b.v < STALL ? (STALL - b.v) / STALL : 0;
    b.gam += (Math.max(want, GLIDE * stall * 2) - b.gam) * Math.min(1, DT * (1.6 + stall * 3));
    b.bank += (b.steer * 0.95 - b.bank) * Math.min(1, DT * 3.5);
    b.h += (G * Math.tan(b.bank) / Math.max(15, b.v)) * DT;
    b.v += (G * Math.sin(b.gam) - K * b.v * b.v) * DT;   // (speed from the drop, less the drag)
    b.v = Math.max(8, b.v);
  }
  const c = Math.cos(b.h); const s = Math.sin(b.h); const hv = b.v * Math.cos(b.gam);
  b.px += c * hv * DT; b.pz += s * hv * DT; b.y -= b.v * Math.sin(b.gam) * DT; b.x += hv * DT;
  b.maxSpeed = Math.max(b.maxSpeed, b.v);
  b.air += DT;
  // how close to the ground: proximity flying (low and fast) scores
  const gy = g.heightAt(b.px, b.pz); const above = b.y - gy;
  b.near = !b.chute && above < 18 && b.v > 30 ? 1 - above / 18 : 0;
  if (b.near) b.prox += b.near * b.v * DT * 0.5;
  // touching down: under the parachute that's a landing; in the wingsuit, a crash
  const o = g.obstacleAt ? g.obstacleAt(b.px, b.pz) : null;
  if (above < 0.6 || (o && b.y < o.top)) {
    b.y = Math.max(b.y, gy + 0.6);
    if (b.chute > 0.6 && !o) { b.landed = DT; b.v = 0; b.gam = 0; b.bank = 0; ev.push(['landed']); }
    else crash(b, ev);
  }
  if (!b.crashed && !g.inBounds(b.px, b.pz)) { crash(b, ev); ev.push(['bounds']); }
  sync(b);
  return ev;
}

function crash(b, ev) {
  if (b.crashed) return;
  b.crashed = DT; b.crashes++; b.air = 0; b.v = 0; b.chute = 0;
  ev.push(['crash']);
}
