/* Driftvvd: a rear-wheel-drive drift car, with its own handling (car.js's supercar and buggy are untouched, so their
   records stay fair). Seen from above it's a real car on four tyres: each axle's tyres grip sideways up to what the
   road can take (more weight on them, more grip), and the back ones share that grip with the engine pushing the car
   along. So:
   - floor it in a turn and the back tyres spin up, lose their side grip and the tail swings out (power oversteer);
   - Space (or Q) is the handbrake: it locks the back wheels and they slide (pull it, turn in, and you're sideways);
   - the front wheels follow the slide on their own (as a real car's caster does), so it counter-steers itself and you
     hold the angle with A / D and the throttle; ease off and the back tyres bite and snap it straight again.
   Going straight with no slide, a traction control keeps the wheels from spinning, so it launches cleanly.
   It's flat ground (the city) with the body leaning on its springs as it brakes, accelerates and slides; it bounces off
   buildings, parked cars and poles (terrain.city.hit) instead of crashing. It looks after the same fields as car.js
   (px, pz, y, h, vx, wh, crashed, pitch, roll, comp…), so game.js draws, follows and sends it the same way, and b.drift
   ({ angle, speed }) says how sideways it is, for the drift score. Headings: forward is (cos h, sin h) in x, z; the
   right is (-sin h, cos h); h growing turns right. */
const DT = 1 / 120;
const G = 9.81;
const M = 1250;                     // kg
const IZ = 1750;                    // how hard it is to spin (kg m²)
const A = 1.18; const B = 1.37;     // front and back axle from the middle (m)
const L = A + B;
const HCG = 0.48;                   // the middle's height (weight moves front and back with braking and throttle)
const MU_F = 1.12; const MU_R = 1.04;   // the tyres' grip (the back a touch looser: it's a drift car)
const PULL = 1.2;                   // how much more grip the back tyres have pulling the car along than sideways (sticky drive tyres)
const POWER = 200000;               // W
const DRIVE_MAX = 11000;            // N at the back wheels, most (first gear)
const DRAG = 0.5; const ROLL = 160; // air drag (N per (m/s)²) and rolling resistance (N)
const BRAKE = 1.05;                 // g, both axles
const LOCK = 0.62;                  // the front wheels' most lock (rad)
const RIDE = 0.62;                  // the body's middle above the ground
const SAG = 0.12;
export const GEARS = [0, 13, 22, 31, 41, 52, 64, 999];   // speeds (m/s) each gear runs up to (only for the engine's sound)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const P = () => globalThis.MotoCore.P;
/** How much of its grip a tyre uses at slip angle a (radians): rises to 1 at about 7°, then falls off a little (a tyre
    sliding grips less than one just about to). */
const tyre = (a) => Math.sin(1.55 * Math.atan(11 * a)) * (1 - 0.18 * clamp((Math.abs(a) - 0.12) / 0.5, 0, 1));

export function newBike(T) {
  const b = {
    car: true, drift: { angle: 0, speed: 0 }, px: 0, pz: 0, y: 0, h: 0, x: 0, s: 0, u: 0, w: 0, r: 0, vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, ax: 0, ay: 0,
    comp: [SAG, SAG, SAG, SAG], wspin: [0, 0], steer: 0, wheel: 0, vx: 0, vy: 0, a: 0, lean: 0, rx: 0, ry: 0, spin: 0,
    wh: [{ ct: true, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }, { ct: true, slip: 0, x: 0, y: 0, ang: 0, nx: 0, ny: 1 }],
    crashed: 0, crashes: 0, flips: 0, maxSpeed: 0, boost: false, nitro: 0, gear: 1, rpm: P().IDLE, thr: 0, brk: 0,
    limiter: false, hold: 0, t: 0, cp: -1, finished: null, rider: null, tk: 0, pose: 0, whip: 0, scrub: 0, slide: 0, G: null,
    air: 0, upside: 0, padT: 0, bump: 0,
  };
  place(T, b, T.spawn);
  return b;
}

/** Put the car at spot ({ position: [x, z], heading (map heading: 0 = +z) }), standing still. */
export function place(T, b, spot) {
  b.px = spot.position[0]; b.pz = spot.position[1]; b.h = Math.PI / 2 - (spot.heading || 0);
  b.u = b.w = b.r = 0; b.ax = b.ay = 0; b.pitch = b.roll = 0; b.steer = b.wheel = 0; b.spin = 0;
  b.crashed = 0; b.air = 0; b.upside = 0; b.boost = false; b.comp = [SAG, SAG, SAG, SAG]; b.bump = 0;
  b.y = T.terrain.heightAt(b.px, b.pz) + RIDE;
  sync(b);
}

/** Back to a safe pad (or spot). */
export function respawn(T, b, u = 0, spot = null) {
  const keep = { crashes: b.crashes, maxSpeed: b.maxSpeed, t: b.t, x: b.x };
  place(T, b, spot || T.terrain.nearestSafePad(b.px, b.pz));
  Object.assign(b, keep); b.s = b.x;
  b.hold = P().HOLD_TIME;
}

function sync(b) {
  const c = Math.cos(b.h); const s = Math.sin(b.h);
  b.vel = [c * b.u - s * b.w, 0, s * b.u + c * b.w];
  const speed = Math.hypot(b.u, b.w);
  b.vx = speed * (b.u < 0 ? -1 : 1); b.vy = 0; b.yaw = b.r;
  b.drift.speed = speed; b.drift.angle = speed > 3 ? Math.atan2(b.w, Math.abs(b.u)) : 0;   // (+: the tail out to the left, sliding right)
  b.rx = b.x; b.ry = b.y; b.s = b.x; b.a = b.pitch;
  b.wh[0].x = b.x + A; b.wh[1].x = b.x - B; b.wh[0].y = b.wh[1].y = b.y - RIDE + 0.33;
  b.wh[0].ang = b.wspin[0]; b.wh[1].ang = b.wspin[1];
}

/** One physics step (1/120 s). inp: { gas, brake, steer, lean, nitro, hold }. Returns events like car.js. */
export function step(T, b, inp) {
  const ev = []; const g = T.terrain; const held = !!inp.hold; const Pc = P();
  if (!held) b.t += DT;
  const gas = held ? 0 : clamp(+inp.gas || 0, 0, 1); const brake = held ? 0 : clamp(+inp.brake || 0, 0, 1);
  const hand = !held && (!!inp.nitro || (+inp.lean || 0) < -0.3);   // (Space or Q: the handbrake)
  b.thr += (gas - b.thr) * Math.min(1, DT * 10); b.brk = brake;
  b.steer += clamp((held ? 0 : clamp(+inp.steer || 0, -1, 1)) - b.steer, -DT * 5.5, DT * 5.5);
  let { u, w, r } = b; const speed = Math.hypot(u, w); const fwd = u >= 0 ? 1 : -1;
  // ---- the front wheels: what you steer, plus the slide itself (they turn into it: counter-steer)
  const beta = speed > 2 ? Math.atan2(w, Math.abs(u) + 1) : 0;   // (the way the car is really going, against the way it points)
  const sliding = clamp((Math.abs(Math.atan2(w, Math.abs(u) + 1)) - 0.06) / 0.25, 0, 1);
  const grip = 1 / (1 + Math.max(0, Math.abs(u) - 8) * 0.03);   // (less lock at speed when gripping, like a real driver gives it)
  const wantWheel = clamp(b.steer * LOCK * (sliding ? 0.7 : grip) + beta * sliding * fwd, -LOCK - 0.2, LOCK + 0.2);
  b.wheel += clamp(wantWheel - b.wheel, -DT * 9, DT * 9);
  const d = b.wheel;
  // ---- weight on each axle (the springs: braking loads the front, throttle the back)
  const fzF = Math.max(500, M * G * B / L - M * b.ax * HCG / L); const fzR = Math.max(500, M * G * A / L + M * b.ax * HCG / L);
  // ---- the back wheels: the engine (or the handbrake, or the brakes) and how much side grip that leaves them
  const capR = MU_R * fzR; const capF = MU_F * fzF;
  let drive = 0;
  if (gas > 0) drive = gas * Math.min(DRIVE_MAX, POWER / Math.max(3, Math.abs(u)));
  if (brake && u < 0.6) drive = -brake * 4200;   // (stopped: S backs up)
  const tc = sliding < 0.15 && Math.abs(b.steer) < 0.35 && !hand;   // (straight and gripping: no wheelspin)
  const pull = capR * PULL;
  if (tc) drive = clamp(drive, -0.95 * pull, 0.95 * pull);
  let fxR = drive; let fxF = 0; let spin = 0;
  if (brake && u > 0.6) { fxF -= Math.min(capF * 0.9, BRAKE * M * G * 0.6 * brake); fxR -= Math.min(capR * 0.8, BRAKE * M * G * 0.4 * brake); }
  if (hand) { fxR = -Math.sign(u) * Math.min(capR * 0.7, Math.abs(u) * M / DT * 0.5); }   // (locked: they skid)
  if (Math.abs(fxR) > pull * 0.95) { spin = clamp((Math.abs(fxR) - pull * 0.95) / (pull * 0.6), 0, 1); fxR = Math.sign(fxR) * pull * 0.95; }   // (wheelspin: only so much gets through)
  // (side grip the back tyres have left: never all of it gone, so a slide stays catchable on a keyboard's all-or-nothing throttle)
  const leftR = hand ? 0.38 : Math.max(0.42, Math.sqrt(Math.max(0, 1 - (fxR / pull) ** 2)) * (1 - spin * 0.35));
  const leftF = Math.sqrt(Math.max(0.1, 1 - (fxF / capF) ** 2));
  // ---- the tyres' side forces (to the right), from how far each axle is sliding sideways
  const den = Math.abs(u) + 1.5;
  const aF = Math.atan2(w + A * r, den) - d * fwd; const aR = Math.atan2(w - B * r, den);
  const fyF = -capF * leftF * tyre(aF); const fyR = -capR * leftR * tyre(aR);
  // ---- the sums, and moving
  const cd = Math.cos(d); const sd = Math.sin(d);
  const fx = fxR + fxF * cd - fyF * sd - DRAG * u * Math.abs(u) - ROLL * Math.tanh(u * 2);
  const fy = fyR + fyF * cd + fxF * sd;
  let mz = A * (fyF * cd + fxF * sd) - B * fyR;
  // drift assist: past 45° sideways the car is eased back round towards where it's going (spin it right round only by
  // really trying), the way arcade drift games keep a slide holdable
  const slip = speed > 3 ? Math.atan2(w, Math.abs(u) + 0.5) : 0; const over = Math.abs(slip) - 0.78;
  if (over > 0 && !hand) mz += IZ * Math.sign(slip) * over * 9 - IZ * r * over * 2.5;
  b.ax += (fx / M - b.ax) * Math.min(1, DT * 8); b.ay += (fy / M - b.ay) * Math.min(1, DT * 8);
  u += (fx / M + w * r) * DT; w += (fy / M - u * r) * DT; r += (mz / IZ) * DT;
  if (speed < 1.5 && !gas) { w *= 1 - DT * 6; r *= 1 - DT * 6; if (!brake) u *= 1 - DT * 1.5; }   // (rolling to a stop: no creeping sideways)
  if (held) { u *= 0.5; w *= 0.5; r *= 0.5; }
  b.h += r * DT;
  const c = Math.cos(b.h); const s = Math.sin(b.h);
  const vx = c * u - s * w; const vz = s * u + c * w;
  b.px += vx * DT; b.pz += vz * DT; b.x += Math.abs(u) * DT;
  // ---- bumping into things: the body is three circles down its length
  b.bump = Math.max(0, b.bump - DT);
  if (g.city) {
    let wx = vx; let wz = vz; let hard = 0;
    for (const k of [-1.45, 0, 1.45]) {
      const hit = g.city.hit(b.px + c * k, b.pz + s * k, 1.05); if (!hit) continue;
      b.px += hit.nx * hit.depth; b.pz += hit.nz * hit.depth;
      const vn = wx * hit.nx + wz * hit.nz;
      if (vn < 0) {
        wx -= 1.3 * vn * hit.nx; wz -= 1.3 * vn * hit.nz; wx *= 0.85; wz *= 0.85; hard = Math.max(hard, -vn);
        r += -k * (hit.nx * -s + hit.nz * c) * vn * 0.25;   // (hit off the middle: it spins away)
      }
    }
    if (hard) {
      u = c * wx + s * wz; w = -s * wx + c * wz;
      if (hard > 2.5 && !b.bump) { ev.push(['bump', { speed: hard }]); b.bump = 0.4; }
    }
  }
  // ---- out of the world: back to a pad
  if (!g.inBounds(b.px, b.pz, 4)) { b.crashed = DT; b.crashes++; ev.push(['crash'], ['bounds']); }
  if (b.crashed) b.crashed += DT;
  b.u = u; b.w = w; b.r = r;
  // ---- the body on its springs: it leans out of a turn, squats when it pulls away, dives when it brakes
  b.pitch += (clamp(b.ax * 0.006, -0.06, 0.05) - b.pitch) * Math.min(1, DT * 6);
  b.roll += (clamp(-b.ay * 0.007, -0.07, 0.07) - b.roll) * Math.min(1, DT * 6);
  b.y = g.heightAt(b.px, b.pz) + RIDE;
  const cmp = clamp(SAG + b.ax * 0.004, 0.05, 0.2); const cr = clamp(b.ay * 0.004, -0.06, 0.06);
  b.comp = [cmp + cr, cmp - cr, SAG * 2 - cmp + cr, SAG * 2 - cmp - cr];
  // ---- how sideways (for the smoke, the screech and the score), the engine, the wheels
  const rearSlide = clamp((Math.abs(aR) - 0.1) / 0.25, 0, 1);
  b.slide = Math.max(rearSlide, spin * Math.min(1, speed / 6), hand && speed > 3 ? 0.7 : 0); b.scrub = b.slide;
  b.wh[0].slip = clamp((Math.abs(aF) - 0.12) / 0.3, 0, 1); b.wh[1].slip = b.slide;
  b.maxSpeed = Math.max(b.maxSpeed, speed);
  const v = Math.abs(u); let gear = 1; while (gear < 7 && v > GEARS[gear]) gear++;
  if (gear !== b.gear) { ev.push(['shift', gear]); b.gear = gear; }
  const lo = GEARS[gear - 1]; const hi = Math.min(GEARS[gear], 75);
  const rpmWant = Pc.IDLE + (Pc.LIMIT - Pc.IDLE) * clamp(((v - lo) / (hi - lo)) * 0.85 + spin * 0.4 + (gas && b.slide ? 0.15 : 0), 0, 1) + gas * 700;
  b.rpm += (rpmWant - b.rpm) * Math.min(1, DT * 9);
  b.limiter = b.rpm > Pc.LIMIT * 0.98 && gas > 0;
  b.wspin[0] += u / 0.34 * DT; b.wspin[1] += (hand ? 0 : u + spin * 25 + (gas ? b.slide * 12 : 0)) / 0.34 * DT;
  b.wh[0].ct = b.wh[1].ct = true;
  sync(b);
  return ev;
}
