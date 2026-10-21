// Mini Golf: headless checks of every hole in public/js/games/golf-core.js.
//   node tests/golftest.js            (all holes)
//   node tests/golftest.js spooky-6   (one hole; random courses: gen-1234-3)
// For every hole a search over (wait, angle, power) shot sequences must hole out within par + 1,
// moving obstacles must move, random shots must never leave the ball somewhere it can't be,
// and the same shots must always give exactly the same result.
// Also runs under JavaScriptCore (tests/run_all.py on a Mac): then it uses print/load and skips the games/golf.py check.
'use strict';
const hasNode = typeof require === 'function' && typeof process !== 'undefined';
const say = typeof print === 'function' ? print : console.log;
if (hasNode) require(require('path').join(__dirname, '..', 'public', 'js', 'games', 'golf-core.js'));
else load('public/js/games/golf-core.js');
const C = globalThis.GolfCore;
const P = C.P;

let failed = 0;
const check = (ok, label) => { say((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; };
const only = hasNode ? process.argv[2] : undefined;
const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

// the server's copy of the pars must match
if (hasNode) {
  const py = require('fs').readFileSync(require('path').join(__dirname, '..', 'games', 'golf.py'), 'utf8');
  for (const c of C.COURSES) {
    const m = py.match(new RegExp(`"${c.id}": \\("([^"]+)", \\[([\\d, ]+)\\]\\)`));
    const pars = m ? m[2].split(',').map(Number) : null;
    check(m && m[1] === c.name && JSON.stringify(pars) === JSON.stringify(c.holes.map((x) => x.par)), `${c.id}: games/golf.py has the same name and pars (${c.holes.map((x) => x.par).join(' ')})`);
    check(c.holes.length === 9 && c.holes.every((x) => x.par >= 2 && x.par <= 5), `${c.id}: 9 holes, every par 2–5`);
  }
}

// random courses get every check a hand-made one does (a handful of seeds, spread over all the looks)
const GEN = [1, 2, 3, 77, 1234, 99999, 2000000000, 424242].map((seed) => C.generate(seed));
check(new Set(GEN.map((c) => c.theme)).size >= 4, `random courses come in different looks (${GEN.map((c) => c.theme).join(', ')})`);
for (const c of GEN) {
  check(c.holes.length === 9 && c.holes.every((hd, i) => hd.par === C.genPar(c.seed, i)), `${c.id}: 9 holes with the pars the server expects (${c.holes.map((x) => x.par).join(' ')})`);
  check(new Set(c.holes.map((x) => x.name)).size === 9, `${c.id}: every hole has its own name (${c.holes.map((x) => x.name).join(', ')})`);
  check(c.holes.every((hd) => hd.map.length <= 26 && hd.map[0].length <= 26), `${c.id}: every hole fits in 26×26 tiles`);
  check(C.courseById(c.id) === c, `${c.id}: found again by its id`);
}

for (const course of C.COURSES.concat(GEN)) {
  for (const hd of course.holes) {
    if (only && hd.id !== only) continue;
    const H = C.build(hd);
    const tag = `${hd.id} ${hd.name}`;
    // ---- layout
    check(C.solid(C.floorAt(H, H.tee[0], H.tee[1])), `${tag}: the tee is on turf`);
    let cupOk = true;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      for (const r of [0, P.CUP_R, 0.62]) if (C.floorAt(H, H.cup[0] + Math.cos(a) * r, H.cup[1] + Math.sin(a) * r) !== C.TURF) cupOk = false;
    }
    const s0 = C.surface(H, H.cup[0], H.cup[1], {});
    check(cupOk && Math.hypot(s0.gx, s0.gz) < 0.02, `${tag}: the cup sits on flat turf with room round it`);
    const nearWall = H.walls.some((w) => {
      const ex = w.bx - w.ax; const ez = w.bz - w.az;
      const u = Math.max(0, Math.min(1, ((H.cup[0] - w.ax) * ex + (H.cup[1] - w.az) * ez) / (w.len * w.len)));
      return Math.hypot(H.cup[0] - w.ax - ex * u, H.cup[1] - w.az - ez * u) < P.CUP_R + P.R + 0.05;
    });
    check(!nearWall, `${tag}: the cup isn't jammed against a rail`);

    // ---- moving obstacles move (and the windmill opens and closes)
    if (H.movers.length) {
      let moves = true;
      for (const m of H.movers) {
        const a = C.moverPose(m, 0); const b = C.moverPose(m, m.period / 4); const c = C.moverPose(m, m.period * 0.6);
        const changed = Math.hypot(a.x - b.x, a.z - b.z) + Math.hypot(a.x - c.x, a.z - c.z) > 0.3 || a.on !== b.on || a.on !== c.on || Math.abs(a.a - b.a) > 0.3;
        let on = 0; let off = 0;
        for (let t = 0; t < m.period; t += 0.02) (C.moverPose(m, t).on ? on++ : off++);
        if (!changed || (m.k === 'windmill' && (!on || !off))) moves = false;
      }
      check(moves, `${tag}: its ${H.movers.length} moving obstacle${H.movers.length > 1 ? 's' : ''} really move`);
    }

    // ---- playable within par + 1
    const t0 = Date.now();
    const sol = C.solve(H, hd.par + 1);
    check(!!sol, `${tag}: can be holed within par ${hd.par} + 1` + (sol ? ` — found ${sol.strokes} (${sol.tried} shots tried, ${((Date.now() - t0) / 1000).toFixed(1)}s)` : ''));

    // ---- determinism: replaying the solution gives the same result, twice
    if (sol) {
      const play = () => {
        let b = C.newBall(H); let t = 0; const trace = [];
        for (const sh of sol.shots) {
          if (sh.wait) ({ b, t } = C.idle(H, b, t, sh.wait));
          const r = C.simulateShot(H, b, t, sh.angle, sh.power);
          b = r.b; t = r.t;
          trace.push([b.state, b.x, b.z, t]);
        }
        return trace;
      };
      const a = play(); const b = play();
      check(JSON.stringify(a) === JSON.stringify(b) && a[a.length - 1][0] === 'holed', `${tag}: replaying the same shots is exact (${a.map((x) => x[0]).join(' → ')})`);
    }

    // ---- the ball never escapes: random shots from random spots
    const rnd = rng(1234 + hd.n * 77 + C.COURSES.concat(GEN).indexOf(course) * 9);
    const spots = [];
    for (let z = 0; z < H.D; z++) for (let x = 0; x < H.W; x++) if (C.solid(C.floorAt(H, x + 0.5, z + 0.5))) spots.push([x + 0.5, z + 0.5]);
    let bad = null; let holed = 0; let outs = 0; let rests = 0;
    const insideBlock = (x, z) => H.blocks.some((bl) => x > bl.x0 - P.R * 0.5 && x < bl.x1 + P.R * 0.5 && z > bl.z0 - P.R * 0.5 && z < bl.z1 + P.R * 0.5)
      || H.bumpers.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + P.R * 0.5);
    for (let k = 0; k < 160 && !bad; k++) {
      const [sx, sz] = k < 40 ? H.tee : spots[(rnd() * spots.length) | 0];
      if (insideBlock(sx, sz)) continue;
      const start = C.newBall(H, [sx, sz]);
      const t = rnd() * 10;
      const r = C.simulateShot(H, start, t, rnd() * Math.PI * 2, 0.1 + rnd() * 0.9, (b) => {
        if (bad) return;
        if (b.state === 'roll' || b.state === 'rest') {
          if (!C.solid(C.floorAt(H, b.x, b.z))) bad = `rolling where there is no turf at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
        }
        // (flying off a ramp over the edge is allowed: it lands outside and counts as out of bounds)
        if (b.state !== 'out' && (b.x < -2.1 || b.z < -2.1 || b.x > H.W + 2.1 || b.z > H.D + 2.1)) bad = `left the hole at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
        if (b.state === 'air' && b.y < -0.35 && C.floorAt(H, b.x, b.z) === C.VOID) bad = `fell through the ground at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
      });
      const b = r.b;
      if (b.state === 'holed') holed++;
      else if (b.state === 'out') outs++;
      else if (b.state === 'rest') {
        rests++;
        if (!C.solid(C.floorAt(H, b.x, b.z))) bad = `stopped off the turf at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
        else if (insideBlock(b.x, b.z) && !H.movers.length) bad = `stopped inside an obstacle at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
      } else bad = `ended in state ${b.state}`;
    }
    check(!bad, `${tag}: 160 random shots stay in the hole (${rests} stopped, ${holed} holed, ${outs} splash/out)` + (bad ? ` — ${bad}` : ''));

    // ---- harder physics checks: full-power shots, balls left resting by moving obstacles, drops
    {
      const inMover = (x, z, t) => H.movers.some((m) => {
        const A = C.moverPose(m, t); if (!A.on) return false;
        const ca = Math.cos(A.a); const sa = Math.sin(A.a); const rx = x - A.x; const rz = z - A.z;
        return Math.abs(rx * ca + rz * sa) < A.hw - 0.05 && Math.abs(-rx * sa + rz * ca) < A.hd - 0.05;
      });
      let pops = null; let jumps = null; let pushedOut = null; let wedged = null; let longest = 0;
      for (let k = 0; k < 300; k++) {
        const [sx, sz] = k < 60 ? H.tee : spots[(rnd() * spots.length) | 0];
        const t0 = rnd() * 12;
        if (insideBlock(sx, sz) || inMover(sx, sz, t0)) continue;
        const ang = rnd() * Math.PI * 2; const pw = k % 2 ? 1 : 0.2 + rnd() * 0.8;
        let px = sx; let pz = sz; let py = null; let pstate = 'roll';
        const r = C.simulateShot(H, C.newBall(H, [sx, sz]), t0, ang, pw, (b) => {
          const jump = Math.hypot(b.x - px, b.z - pz);
          // nothing moves the ball further in one step than full speed allows, except a teleport or dropping into the cup
          if (jump > 0.3 && b.state !== 'holed' && !H.tele.some((tp) => Math.hypot(px - tp.fx, pz - tp.fz) < tp.r + 0.3)) jumps = jumps || `${jump.toFixed(2)} in one step at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
          // a ball down in a drop never pops back up onto the turf
          if (py !== null && pstate === 'air' && b.y - py > 0.12) pops = pops || `rose ${(b.y - py).toFixed(2)} at ${b.x.toFixed(2)},${b.z.toFixed(2)}`;
          px = b.x; pz = b.z; py = b.y; pstate = b.state;
        });
        longest = Math.max(longest, r.t - t0);
        if (r.b.state !== 'rest' || !H.movers.length) continue;
        // leave it there for a while: moving obstacles may shove it, but never through a rail or into a block
        const w = C.idle(H, r.b, r.t, H.cycle * 1.3).b;
        if (w.state === 'out' && w.why === 'oob') pushedOut = pushedOut || `from ${r.b.x.toFixed(2)},${r.b.z.toFixed(2)}`;
        if ((w.state === 'rest' || w.state === 'roll') && (!C.solid(C.floorAt(H, w.x, w.z)) || insideBlock(w.x, w.z))) wedged = wedged || `at ${w.x.toFixed(2)},${w.z.toFixed(2)}`;
      }
      check(!jumps && !pops, `${tag}: no teleporting or tunnelling, nothing climbs out of a drop` + (jumps ? ` — jumped ${jumps}` : '') + (pops ? ` — ${pops}` : ''));
      check(longest < 20, `${tag}: every shot settles (longest ${longest.toFixed(1)}s)`);
      if (H.movers.length) check(!pushedOut && !wedged, `${tag}: moving obstacles never push a resting ball through a rail or into a wall` + (pushedOut ? ` — out of bounds ${pushedOut}` : '') + (wedged ? ` — stuck ${wedged}` : ''));
    }
  }
}
// a ball the slope holds straight against a rail (Hilltop's corner, next to the small hill) must come to rest,
// not "roll" at zero speed until the 30 s cut-off
if (!only || only === 'classic-7') {
  const H = C.build(C.COURSES[0].holes[6]);
  const b = C.newBall(H, [7.62, 1.98]); b.state = 'roll';
  let t = 0;
  while (b.state === 'roll' && t < 5) { C.step(H, b, t); t += P.DT; }
  let still = b.state === 'rest';
  for (let i = 0; i < 240 && still; i++) { C.step(H, b, t); t += P.DT; if (b.state !== 'rest') still = false; }
  check(still && t < 4, `classic-7 Hilltop: a ball pinned against the corner rail by the slope settles (${t.toFixed(2)}s, ${b.state})`);
}
// lots more random courses: each hole must be holeable within par + 1 (just the solver, to keep this quick)
if (!only) {
  let bad = []; let n = 0;
  const t0 = Date.now();
  for (let k = 0; k < 16; k++) {
    const c = C.generate(1 + ((k * 2654435761) % 2000000000));
    for (const hd of c.holes) { n++; if (!C.solve(C.build(hd), hd.par + 1)) bad.push(`${hd.id} ${hd.name}`); }
  }
  check(!bad.length, `${n} more random holes can all be holed within par + 1 (${((Date.now() - t0) / 1000).toFixed(1)}s)` + (bad.length ? ` — not: ${bad.join(', ')}` : ''));
}
say('FAILED: ' + failed);
if (failed) { if (hasNode) process.exitCode = 1; else throw new Error(failed + ' golf checks failed'); }
