// Neon Dash level editor checks (no browser): the editor's level format compiles to the same objects
// the game builds, bad levels are refused, and a recorded run replays exactly the same every time.
// Run: node -e "global.print=console.log; global.load=(f)=>require(require('path').resolve(f)); load(process.argv[1])" tests/dashedit.js
// (tests/run_all.py does this for you, with jsc or node).
load('public/js/games/dash-core.js');
const C = globalThis.DashCore;
let failed = 0;
function check(ok, label) {
  print((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) failed++;
}

// ---- 1. the game's own random levels survive the trip through the editor format
let same = 0, total = 0;
for (const diff of ['easy', 'normal', 'hard', 'insane']) {
  for (const seed of [1, 2, 7, 42, 2024, 99999]) {
    const lv = C.buildLevel(seed, diff, 'long');
    const data = C.checkLevel(C.levelFromBuilt(lv));
    const c = C.compileLevel(data);
    const key = (l) => l.objs.map((o) => `${o.t}${o.x},${o.y}`).sort().join(' ');
    const secs = (l) => l.sections.map((s) => [s.mode, s.x0, s.x1, s.ceil].join(':')).join(' ');
    const slopesOk = lv.sections.every((s, i) => !s.floor || s.floor.every(([x, y], j) => Math.abs(c.sections[i].floor[j][0] - x) < 0.02 && Math.abs(c.sections[i].floor[j][1] - y) < 0.02
      && Math.abs(c.sections[i].roof[j][1] - s.roof[j][1]) < 0.02));
    total++;
    if (key(lv) === key(c) && secs(lv) === secs(c) && Math.abs(c.end - lv.end) < 1 && slopesOk) same++;
  }
}
check(same === total, `editor format compiles to the game's own objects, zones and wave slopes (${same}/${total} random levels)`);

// ---- 2. bad levels are refused
const good = { v: 1, name: 'Test', desc: '', theme: 'hard', music: true, len: 60, objs: [['^', 10, 0]], zones: [] };
const refused = (patch) => { try { C.checkLevel({ ...good, ...patch }); return false; } catch (e) { return true; } };
check(!refused({}), 'a simple level passes the checks');
check(refused({ objs: [['X', 3, 0]] }), 'unknown object refused');
check(refused({ objs: [['#', 3, 0], ['^', 3, 0]] }), 'two objects in one cell refused');
check(refused({ objs: [['#', 3, 14]] }), 'object above row 14 refused');
check(refused({ objs: [['#', 3.5, 0]] }) && refused({ objs: [['#', NaN, 0]] }) && refused({ len: 1e9 }), 'fractions, NaN and huge numbers refused');
check(refused({ zones: [['ship', 10, 20, 7], ['ufo', 25, 10, 7]] }), 'overlapping zones refused');
check(refused({ zones: [['ship', 10, 20, 7, 4, [[3, 3]]]] }), 'a zigzag on a ship zone refused');
check(refused({ name: '' }) && refused({ name: 'x'.repeat(33) }), 'missing / too long name refused');
check(refused({ objs: new Array(5001).fill(0).map((_, i) => ['#', i % 59, Math.floor(i / 59) % 14]) }), 'more than 5000 objects refused');
if (typeof TextEncoder !== 'undefined' && typeof btoa !== 'undefined') {
  const code = C.encodeLevel({ ...good, name: 'Ünïcødé 🚀' });
  check(C.decodeLevel(code).name === 'Ünïcødé 🚀' && C.decodeLevel(code).objs.length === 1, 'share codes round-trip (with emoji)');
}

// ---- 3. a level with every kind of part, beaten by a little search bot
const lv = {
  v: 1, name: 'Everything', desc: '', theme: 'normal', music: false, len: 196, zones: [
    ['ship', 80, 30, 7], ['ball', 122, 24, 6], ['wave', 154, 30, 7, 4.4, [[6, 2.3], [9, 4.7], [12, 2.3], [16, 2.3], [19, 4.7], [24, 4.7]]],
  ], objs: [],
};
const add = (t, x, y) => lv.objs.push([t, x, y]);
add('^', 15, 0); add('^', 25, 0); add('^', 26, 0);
for (let x = 33; x <= 36; x++) add('#', x, 0);
add('^', 45, 0); add('^', 46, 0);
add('=', 54, 0); for (let x = 57; x <= 60; x++) add('^', x, 0);
add('o', 68, 2); for (let x = 66; x <= 70; x++) add('^', x, 0);
for (let y = 0; y < 3; y++) add('#', 90, y);       // ship: a pillar from the floor...
for (let y = 4; y < 7; y++) add('#', 100, y);      // ...and one from the ceiling
add('^', 130, 0); add('^', 131, 0); add('v', 138, 5); add('v', 139, 5);
const level = C.compileLevel(C.checkLevel(lv));

/** Depth-first search over "hold or not" every few substeps: returns the recorded inputs of a run that finishes. */
function solve(L, every = 8, budget = 300000) {
  const clone = (r) => ({ p: { ...r.p, used: new Set(r.p.used) }, tick: r.tick, hold: r.hold, rec: r.rec.slice() });
  const seen = new Set();
  let nodes = 0;
  const dfs = (run) => {
    if (run.p.done) return run.rec;
    if (run.p.dead || ++nodes > budget) return null;
    const k = `${run.tick}|${run.hold}|${Math.round(run.p.y * 20)}|${Math.round(run.p.vy)}|${run.p.g}`;
    if (seen.has(k)) return null;
    seen.add(k);
    for (const down of run.hold ? [true, false] : [false, true]) {
      const r = clone(run);
      C.runInput(r, down);
      for (let i = 0; i < every && !r.p.dead && !r.p.done; i++) C.runStep(r, L, null);
      const got = dfs(r);
      if (got) return got;
    }
    return null;
  };
  return dfs(C.newRun(L));
}
const inputs = solve(level);
check(!!inputs, `the search bot beats the test level${inputs ? ` (${inputs.length / 2 | 0} presses)` : ''}`);
if (inputs) {
  const runs = [1, 2, 3, 4, 5].map(() => C.replay(level, inputs));
  check(runs.every((r) => r.done && !r.dead), 'the recorded run reaches the finish when replayed');
  check(runs.every((r) => r.ticks === runs[0].ticks && r.x === runs[0].x), `replaying it gives exactly the same finish every time (${runs[0].ticks} substeps)`);
  check(runs[0].ticks === C.runTicks(level), 'a finished run is exactly runTicks() long (the server checks this)');
  // the live game feeds whole substeps from an accumulator with uneven frame times: same result
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const live = () => {
    const run = C.newRun(level);
    let acc = 0, i = 0;
    while (!run.p.dead && !run.p.done && run.tick < 100000) {
      acc = Math.min(acc + 0.004 + rnd() * 0.046, 0.1);   // frames of 4–50 ms
      while (acc >= C.SUB && !run.p.dead && !run.p.done) {
        while (i < inputs.length && inputs[i] <= run.tick) { C.runInput(run, i % 2 === 0); i++; }
        C.runStep(run, level, null);
        acc -= C.SUB;
      }
    }
    return run;
  };
  const a = live(), b = live();
  check(a.p.done && b.p.done && a.tick === runs[0].ticks && b.tick === runs[0].ticks, 'the same inputs finish identically at any frame rate');
  check(JSON.stringify(a.rec) === JSON.stringify(inputs), 'a live run records exactly the inputs it was given');
  const noInput = C.replay(level, []);
  check(noInput.dead && !noInput.done, `doing nothing crashes (at ${Math.round(noInput.progress * 100)}%), so the replay really matters`);
  const cut = C.replay(level, inputs.slice(0, Math.max(0, inputs.length - 6)));
  check(!cut.done, 'a replay with its last presses removed does not finish');
}
// practice flags stay out of tunnels and off obstacles
const cps = level.checkpoints.slice(1);
check(cps.length > 0 && cps.every((x) => !level.sections.some((s) => x >= s.x0 - 2 && x < s.x1 + 5)), `practice checkpoints avoid the mode zones (${cps.map(Math.floor).join(', ')})`);

print(failed ? `FAILED: ${failed}` : 'all dash editor checks passed');
if (failed) throw new Error(failed + ' dash editor check(s) failed');
