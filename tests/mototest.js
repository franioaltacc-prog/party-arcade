/* Motocross without a browser: the bike's physics, the tracks and the robot rider.
   Run:  jsc tests/mototest.js   (from the repo folder; tests/run_all.py runs it too)
   Prints one line per check; a line starting with "FAIL " means something is wrong. */
load('public/js/games/moto/core.js');
const C = globalThis.MotoCore;
const DATA = JSON.parse(readFile('public/js/games/moto/tracks.json'));
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; print((ok ? 'PASS ' : 'FAIL ') + what); };
const kmh = (v) => (v * 3.6).toFixed(0) + ' km/h';
const flat = C.build({ id: 'flat', name: 'Flat', course: ['flat 20', 'start', 'flat 1500', 'finish', 'flat 50'] });

// ---------------------------------------------------------------- the bike
{
  const b = C.newBike(flat);
  const x = b.x;
  for (let i = 0; i < 240; i++) C.step(flat, b, {});
  check(Math.abs(b.x - x) < 0.05 && Math.abs(b.a) < 0.05 && !b.crashed, 'a bike left alone stands still on its suspension');
  check(b.wh[0].c > 0.03 && b.wh[0].c < 0.12 && b.wh[1].c > 0.03 && b.wh[1].c < 0.12, `it sags into its suspension (${b.wh[0].c.toFixed(2)} / ${b.wh[1].c.toFixed(2)} m)`);
  let gears = new Set();
  for (let i = 0; i < 120 * 12; i++) { C.step(flat, b, { gas: 1 }); gears.add(b.gear); }
  const top = Math.hypot(b.vx, b.vy);
  check(top > 85 / 3.6 && top < 110 / 3.6 && !b.crashed, `full gas on the flat: top speed ${kmh(top)}, no crash`);
  check(gears.size === 5, 'it changes up through all 5 gears');
  let stop = b.x;
  const v0 = Math.hypot(b.vx, b.vy);
  for (let i = 0; i < 120 * 8 && Math.hypot(b.vx, b.vy) > 0.3; i++) C.step(flat, b, { brake: 1 });
  check(!b.crashed && b.x - stop < 70, `full brakes from ${kmh(v0)} stop in ${(b.x - stop).toFixed(0)} m without going over the bars`);
}
{
  // lean back on the gas: a wheelie; leaning forward keeps the front down
  const b = C.newBike(flat); let up = 0;
  for (let i = 0; i < 240; i++) { C.step(flat, b, { gas: 1, lean: -1 }); up = Math.max(up, b.a); }
  const c = C.newBike(flat); let up2 = 0;
  for (let i = 0; i < 240; i++) { C.step(flat, c, { gas: 1, lean: 1 }); up2 = Math.max(up2, c.a); }
  check(up > 0.4 && up2 < 0.25 && !b.crashed && !c.crashed, `leaning back pulls a wheelie (${up.toFixed(2)} rad), leaning forward keeps the front down (${up2.toFixed(2)} rad)`);
}
{
  // drop it upside down: that's a crash, and the rider goes flying
  const b = C.newBike(flat);
  b.a = Math.PI; b.y += 1.6; b.ry += 2.4; b.rx = b.x;
  let ev = [];
  for (let i = 0; i < 120; i++) ev = ev.concat(C.step(flat, b, {}));
  check(b.crashed > 0 && ev.some((e) => e[0] === 'crash') && b.rider, 'landing on your head is a crash');
  C.respawn(flat, b);
  check(!b.crashed && Math.abs(b.a) < 0.05 && b.x === flat.start && b.crashes === 1, 'after a crash you go back to the start (or the last checkpoint), upright');
}
{
  // tricks in the air fill the nitro, and nitro makes you faster
  const T = C.build({ id: 'jump', name: 'Jump', course: ['flat 20', 'start', 'flat 60', 'double 11 2.8 18', 'flat 80', 'finish', 'flat 40'] });
  const f = T.features.find((q) => q.kind === 'double');
  check(f.speed > 12 && f.speed < 22, `a big double wants ${kmh(f.speed)} at the lip`);
  // hold lean-back off the lip, let go a bit before a full turn (the robot lands it); try a few let-go points
  let land = null; let b = null;
  for (let stop = 0.6; stop < 2.8 && !land; stop += 0.2) {
    b = C.newBike(T); let flipping = false; let rot = 0;
    for (let i = 0; i < 120 * 20 && !land && !b.crashed; i++) {
      const inp = C.robot(T, b);
      const air = !(b.wh[0].ct || b.wh[1].ct);
      if (air && b.x > f.lip - 1 && b.x < f.lip + 3 && !rot) flipping = true;
      if (flipping) { rot += b.w * C.DT; if (rot > 2 * Math.PI - stop || !air) flipping = false; else inp.lean = -1; }
      for (const [k, d] of C.step(T, b, inp)) if (k === 'land' && d.turns) land = d;
    }
  }
  check(land && land.turns === 1 && land.back && b.nitro >= 0.3, `a backflip landed clean fills the nitro (${b.nitro.toFixed(2)})`);
  const s = C.newBike(flat); const n = C.newBike(flat); n.nitro = 1;
  for (let i = 0; i < 120 * 3; i++) { C.step(flat, s, { gas: 1, lean: 1 }); C.step(flat, n, { gas: 1, lean: 1, nitro: true }); }
  check(n.x > s.x + 2 && n.nitro < 1, `nitro: ${(n.x - s.x).toFixed(1)} m ahead after 3 s`);
}
// ---------------------------------------------------------------- riding in 3D
{
  // steering: A/D turn the bike, the faster you go the less the bars turn
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 3; i++) C.step(flat, b, { gas: 0.6 });
  const h0 = b.h;
  for (let i = 0; i < 120; i++) C.step(flat, b, { gas: 0.4, steer: 1 });
  check(b.h - h0 > 0.4 && !b.crashed, `D turns the bike right (${(b.h - h0).toFixed(2)} rad in 1 s)`);
  const h1 = b.h;
  for (let i = 0; i < 120; i++) C.step(flat, b, { gas: 0.4, steer: -1 });
  check(b.h < h1 - 0.4, 'A turns it left');
  // the ground under the bike is the same ground the 3D world draws
  const gy = C.heightAt(flat, b.s, b.u);
  check(Math.abs(b.wh[1].y - C.P.R[1] - gy) < 0.08, `the wheels sit on the drawn ground (${(b.wh[1].y - C.P.R[1] - gy).toFixed(3)} m)`);
}
{
  // too fast for a tight turn: you slide wide and lose speed instead of turning on the spot
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 6; i++) C.step(flat, b, { gas: 1, lean: 0.5 });
  const v0 = b.vx; let scrub = 0;
  for (let i = 0; i < 60; i++) { C.step(flat, b, { gas: 1, steer: 1 }); scrub = Math.max(scrub, b.scrub); }
  check(scrub > 0.1 && b.vx < v0 && !b.crashed, `a hard turn at ${kmh(v0)} slides wide and scrubs off speed (${kmh(b.vx)})`);
}
{
  // the barrier: you can leave the tape but not cut across the countryside
  const b = C.newBike(flat); let most = 0; let hit = false;
  for (let i = 0; i < 120 * 8; i++) { for (const [k] of C.step(flat, b, { gas: 0.5, steer: i < 120 ? 0.6 : 0 })) if (k === 'fence') hit = true; most = Math.max(most, Math.abs(b.u)); }
  check(hit && most < C.P.FENCE + 0.5 && !b.crashed, `riding off the track ends at the barrier (${most.toFixed(1)} m out)`);
}
{
  // off the track the ground is slower
  const on = C.newBike(flat); const off = C.newBike(flat, flat.start, 8);
  for (let i = 0; i < 120 * 4; i++) { C.step(flat, on, { gas: 1, lean: 0.4 }); C.step(flat, off, { gas: 1, lean: 0.4 }); }
  check(off.off && off.vx < on.vx - 2, `off the track is slower (${kmh(off.vx)} vs ${kmh(on.vx)})`);
}
{
  // stopped with S held you paddle backwards; turned around you're going the wrong way
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 2; i++) C.step(flat, b, { brake: 1 });
  check(b.vx < -0.8 && !b.crashed, `holding S when stopped backs you up (${b.vx.toFixed(1)} m/s)`);
  const c = C.newBike(flat); let wrong = false;
  for (let i = 0; i < 120 * 8 && !wrong; i++) { C.step(flat, c, { gas: 0.35, steer: 1 }); wrong = c.wrong; }
  check(wrong, 'turning all the way round shows WRONG WAY');
}
{
  let threw = false;
  try { C.build({ id: 'bad', course: ['flat 10', 'start', 'loop 5', 'finish'] }); } catch (e) { threw = /loop/.test(e.message); }
  check(threw, 'an unknown track piece is an error that names it');
}

// ---------------------------------------------------------------- every track
for (const def of DATA.tracks) {
  const T = C.build(def);
  check(T.cps.length >= 2 && T.finish > T.start + 500, `${def.name}: ${(T.finish - T.start).toFixed(0)} m, ${T.cps.length} checkpoints`);
  const r = C.simulate(T);
  const r2 = C.simulate(T);
  check(r.time != null && r.crashes === 0, `${def.name}: the robot rides it in ${r.time ? r.time.toFixed(2) + 's' : 'DNF'} with ${r.crashes} crashes`);
  check(r2.time === r.time, `${def.name}: the physics is the same every time`);
  check(def.robot && Math.abs(def.robot - r.time) < 0.05, `${def.name}: tracks.json has the robot's time (${def.robot}; it's ${r.time && r.time.toFixed(2)})`);
  for (let i = 0; i < T.cps.length; i++) {
    const q = C.simulate(T, { from: i });
    check(q.time != null && q.crashes === 0, `${def.name}: from checkpoint ${i + 1} the robot gets to the finish (${q.time ? q.time.toFixed(1) + 's' : 'DNF'}, ${q.crashes} crashes)`);
  }
  const jumps = T.features.filter((f) => f.top != null && f.kind !== 'stepup');
  check(jumps.every((f) => f.speed && f.speed < 21), `${def.name}: every jump can be cleared (${jumps.map((f) => kmh(f.speed)).join(', ')})`);
}
print('FAILED: ' + failed);
