// Helper for tests/poolunit.py: runs Billiards core cases in JS so they can be compared bit for bit
// with games/pool_core.py.  Reads {"cases": [...]} as JSON on stdin, prints a JSON list of results.
//   node tests/poolcases.js < cases.json
const path = require('path');
const P = require(path.join(__dirname, '..', 'public', 'js', 'games', 'pool-core.js'));

function listRand(vals) {
  let i = 0;
  return () => {
    if (i >= vals.length) throw new Error('ran out of random numbers');
    return vals[i++];
  };
}

function stepAll(balls, shot) {
  const sim = new P.Sim(balls, shot);
  const events = [];
  let guard = 0;
  while (!sim.done) {
    for (const e of sim.step()) events.push(e);
    if (++guard > P.MAX_STEPS + 5) throw new Error('Sim never finished');
  }
  const r = sim.result();
  return { balls: r.balls, events, steps: r.steps, dur: r.dur };
}

function run(c) {
  switch (c.t) {
    case 'geom':
      return { W: P.W, H: P.H, R: P.R, D: P.D, HEAD_X: P.HEAD_X, FOOT_X: P.FOOT_X, HEAD_SPOT: P.HEAD_SPOT, FOOT_SPOT: P.FOOT_SPOT,
        DT: P.DT, MAX_SPEED: P.MAX_SPEED, BREAK_SPEED: P.BREAK_SPEED, SHOT_CAP: P.SHOT_CAP, CORNER_MOUTH: P.CORNER_MOUTH, SIDE_MOUTH: P.SIDE_MOUTH,
        POCKETS: P.POCKETS, JAWS: P.JAWS, CUSHIONS: P.CUSHIONS, SEGMENTS: P.SEGMENTS, DIAMONDS: P.DIAMONDS, CONST: P.CONST };
    case 'sim': return P.simulate(c.balls, c.shot, c.opts);
    case 'step': return stepAll(c.balls, c.shot);
    case 'frame': return P.newFrame(c.mode, c.breaker, listRand(c.rands));
    case 'apply': {
      const o = P.applyShot(c.frame, c.shot);
      return { frame: o.frame, result: o.result, sim: o.sim };
    }
    case 'seq': {
      let F = P.newFrame(c.mode, c.breaker, listRand(c.rands));
      const out = [F];
      for (const s of c.shots) {
        const o = P.applyShot(F, s);
        out.push({ frame: o.frame, result: o.result, sim: o.sim });
        F = o.frame;
      }
      return out;
    }
    case 'timeout': return P.timeoutFoul(c.frame);
    case 'valid': return c.pts.map((p) => P.validPlacement(c.frame, p[0], p[1]));
    case 'shot': return c.args.map((a) => P.makeShot(c.frame, ...a));
    default: throw new Error('unknown case ' + c.t);
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const cases = JSON.parse(input).cases;
  const out = cases.map((c) => {
    try { return run(c); } catch (e) { return { error: String(e && e.stack || e) }; }
  });
  process.stdout.write(JSON.stringify(out));
});
