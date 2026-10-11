// Mini Golf: headless checks of every hole in public/js/games/golf-core.js.
//   node tests/golftest.js            (all holes)
//   node tests/golftest.js spooky-6   (one hole)
// For every hole a search over (wait, angle, power) shot sequences must hole out within par + 1,
// moving obstacles must move, random shots must never leave the ball somewhere it can't be,
// and the same shots must always give exactly the same result.
'use strict';
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '..', 'public', 'js', 'games', 'golf-core.js'));
const C = globalThis.GolfCore;
const P = C.P;

let failed = 0;
const check = (ok, label) => { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; };
const only = process.argv[2];
const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

// the server's copy of the pars must match
{
  const py = fs.readFileSync(path.join(__dirname, '..', 'games', 'golf.py'), 'utf8');
  for (const c of C.COURSES) {
    const m = py.match(new RegExp(`"${c.id}": \\("([^"]+)", \\[([\\d, ]+)\\]\\)`));
    const pars = m ? m[2].split(',').map(Number) : null;
    check(m && m[1] === c.name && JSON.stringify(pars) === JSON.stringify(c.holes.map((x) => x.par)), `${c.id}: games/golf.py has the same name and pars (${c.holes.map((x) => x.par).join(' ')})`);
    check(c.holes.length === 9 && c.holes.every((x) => x.par >= 2 && x.par <= 5), `${c.id}: 9 holes, every par 2–5`);
  }
}

for (const course of C.COURSES) {
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
        const changed = Math.hypot(a.x - b.x, a.z - b.z) + Math.hypot(a.x - c.x, a.z - c.z) > 0.3 || a.on !== b.on || a.on !== c.on;
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
    const rnd = rng(1234 + hd.n * 77 + (course.id === 'spooky' ? 9 : 0));
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
  }
}
console.log('FAILED:', failed);
process.exit(failed ? 1 : 0);
