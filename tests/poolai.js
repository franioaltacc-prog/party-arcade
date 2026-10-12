// Billiards CPU opponent checks (no browser): PoolAI.choose never throws, answers inside its time budget,
// only gives valid ball-in-hand spots, is deterministic for a given rand, finishes CPU-vs-CPU frames in
// both modes at every level, and Hard clearly beats Easy.
// Run: node tests/poolai.js   (tests/run_all.py runs it with jsc or node)
if (typeof print === 'undefined') globalThis.print = console.log;
if (typeof load === 'undefined') globalThis.load = (f) => require(require('path').resolve(__dirname, '..', f));
load('public/js/games/pool-core.js');
load('public/js/games/pool-ai.js');
const PC = globalThis.PoolCore;
const AI = globalThis.PoolAI;
const clock = typeof performance !== 'undefined' && performance.now ? () => performance.now()
  : typeof preciseTime === 'function' ? () => preciseTime() * 1000 : () => Date.now();

let failed = 0;
function check(ok, label) {
  print((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) failed++;
}
function info(s) { print('INFO ' + s); }
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const fin = (v) => typeof v === 'number' && isFinite(v);
function shapeOk(c, F) {
  if (!c || !fin(c.a) || !fin(c.p) || !fin(c.sx) || !fin(c.sy)) return false;
  if (c.p < 0 || c.p > 1 || typeof c.think !== 'string') return false;
  if (F && F.inHand) return PC.validPlacement(F, c.cx, c.cy);
  return !('cx' in c) && !('cy' in c);
}

// ---- 1. bad input never throws
{
  let threw = null, allOk = true;
  const F0 = PC.newFrame('8ball', 0, rng(1));
  const over = PC.cloneFrame(F0); over.over = true;
  const cases = [[null, 2], [undefined, 3], [{}, 1], [{ balls: 'x' }, 2], [over, 3], [F0, 'hard'], [F0, 7], [F0, 2, { rand: () => { throw new Error('x'); } }],
    [F0, 3, { rand: () => NaN, budgetMs: -5 }], [F0, 1, { budgetMs: 'soon' }]];
  for (const cs of cases) {
    try {
      const c = AI.choose(cs[0], cs[1], cs[2]);
      if (!c || !fin(c.a) || !fin(c.p) || !fin(c.sx) || !fin(c.sy)) allOk = false;
      if (cs[0] && cs[0].inHand && !cs[0].over && Array.isArray(cs[0].balls) && !PC.validPlacement(cs[0], c.cx, c.cy)) allOk = false;
    } catch (e) { threw = e; }
  }
  check(!threw && allOk, 'choose() survives bad frames, levels, rand and budgets' + (threw ? ` (threw ${threw})` : ''));
}

// ---- 2. the break
for (const mode of ['8ball', '9ball']) {
  const F = PC.newFrame(mode, 0, rng(3));
  const c = AI.choose(F, 3, { rand: rng(4) });
  check(shapeOk(c, F) && c.cx <= PC.HEAD_X && c.p > 0.9, `${mode} break: full power from a valid kitchen spot (${c.think})`);
  const o = PC.applyShot(F, PC.makeShot(F, c.a, c.p, c.sx, c.sy, c.cx, c.cy));
  check(!o.result.foul, `${mode} break by Hard is legal`);
}

// ---- 3. determinism for a given rand (with a budget roomy enough not to cut the search short)
{
  let same = true;
  for (const lv of [1, 2, 3]) {
    let F = PC.newFrame(lv === 2 ? '9ball' : '8ball', 1, rng(10 + lv));
    for (let k = 0; k < 6 && !F.over; k++) {
      const a = AI.choose(F, lv, { rand: rng(100 + k), budgetMs: 8000 });
      const b = AI.choose(F, lv, { rand: rng(100 + k), budgetMs: 8000 });
      if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
      F = PC.applyShot(F, PC.makeShot(F, a.a, a.p, a.sx, a.sy, a.cx, a.cy)).frame;
    }
  }
  check(same, 'the same frame and rand give the same shot at every level');
}

// ---- 4. tight budgets are respected
{
  let worst = 0, okAll = true, n = 0;
  for (const budget of [20, 60, 150]) {
    for (const mode of ['8ball', '9ball']) {
      const rand = rng(budget + (mode === '9ball' ? 1 : 0));
      let F = PC.newFrame(mode, 0, rand);
      for (let k = 0; k < 8 && !F.over; k++) {
        const t = clock();
        const c = AI.choose(F, 3, { rand, budgetMs: budget });
        const dt = clock() - t;
        n++;
        worst = Math.max(worst, dt - budget);
        if (dt > budget + 50 || !shapeOk(c, F)) okAll = false;
        F = PC.applyShot(F, PC.makeShot(F, c.a, c.p, c.sx, c.sy, c.cx, c.cy)).frame;
      }
    }
  }
  check(okAll, `Hard with 20/60/150 ms budgets answers in time with valid shots (${n} shots, worst ${worst.toFixed(0)} ms over budget)`);
}

// ---- 5. CPU vs CPU frames
function play(levels, mode, seed, budget, st) {
  const rand = rng(seed);
  let F = PC.newFrame(mode, seed % 2, rand);
  let k = 0;
  while (!F.over && k < 200) {
    const seat = F.turn, lv = levels[seat];
    const s = st[lv] || (st[lv] = { shots: 0, pots: 0, fouls: 0, think: 0, max: 0, n: 0 });
    let c;
    const t = clock();
    try { c = AI.choose(F, lv, { rand, budgetMs: budget }); } catch (e) { st.errors.push(String(e)); return null; }
    const dt = clock() - t;
    s.think += dt; s.n++; s.max = Math.max(s.max, dt);
    if (dt > budget + 50) st.late++;
    if (!shapeOk(c, F)) st.bad++;
    const o = PC.applyShot(F, PC.makeShot(F, c.a, c.p, c.sx, c.sy, c.cx, c.cy));
    if (!F.isBreak) {
      s.shots++;
      if (o.result.again || (o.result.over && o.result.winner === seat)) s.pots++;
      if (o.result.foul) s.fouls++;
    }
    F = o.frame;
    k++;
  }
  st.frames++; st.total += k;
  if (!F.over) st.capped++;
  return F;
}
function newStats() { return { errors: [], late: 0, bad: 0, frames: 0, total: 0, capped: 0 }; }
function lvLine(st, lv) {
  const s = st[lv];
  if (!s) return '';
  return `L${lv}: pot rate ${(s.pots / Math.max(1, s.shots)).toFixed(2)}, fouls ${(s.fouls / Math.max(1, s.shots)).toFixed(2)}, think avg ${(s.think / s.n).toFixed(0)} ms / max ${s.max.toFixed(0)} ms`;
}
{
  for (const mode of ['8ball', '9ball']) {
    for (const lv of [1, 2, 3]) {
      const st = newStats();
      for (let f = 0; f < 4; f++) play([lv, lv], mode, 500 + 37 * f + lv, 900, st);
      check(!st.errors.length && !st.late && !st.bad && st.frames === 4,
        `${mode} L${lv} vs L${lv}: ${st.frames} frames, no errors, every shot valid and within 950 ms` + (st.errors.length ? ` (${st.errors[0]})` : st.late ? ` (${st.late} late)` : st.bad ? ` (${st.bad} invalid)` : ''));
      info(`${mode} L${lv}: ${(st.total / st.frames).toFixed(1)} shots/frame, ${st.capped} hit the 200-shot cap; ${lvLine(st, lv)}`);
    }
  }
}

// ---- 6. Hard clearly beats Easy (and Medium beats Easy)
function match(a, b, frames, seed0) {
  const st = newStats();
  let winsA = 0;
  for (let f = 0; f < frames; f++) {
    const mode = f % 2 ? '9ball' : '8ball';
    const levels = (f >> 1) % 2 ? [a, b] : [b, a];
    const F = play(levels, mode, seed0 + f, 900, st);
    if (F && F.over && levels[F.winner] === a) winsA++;
  }
  return { st, winsA };
}
{
  const m = match(3, 1, 40, 9000);
  check(!m.st.errors.length && !m.st.late && !m.st.bad, 'Hard vs Easy: no errors, all shots valid and in time');
  check(m.winsA >= 32, `Hard beats Easy clearly: ${m.winsA}/40 frames`);
  info(`Hard vs Easy: ${(m.st.total / m.st.frames).toFixed(1)} shots/frame; ${lvLine(m.st, 3)}; ${lvLine(m.st, 1)}`);
  const m2 = match(2, 1, 20, 9100);
  check(m2.winsA >= 13, `Medium beats Easy: ${m2.winsA}/20 frames`);
  info(`Medium vs Easy: ${lvLine(m2.st, 2)}; ${lvLine(m2.st, 1)}`);
  const m3 = match(3, 2, 10, 9200);
  info(`Hard vs Medium: Hard won ${m3.winsA}/10; ${lvLine(m3.st, 3)}; ${lvLine(m3.st, 2)}`);
}

print(`FAILED: ${failed}`);
if (failed) throw new Error(failed + ' pool AI check(s) failed');
