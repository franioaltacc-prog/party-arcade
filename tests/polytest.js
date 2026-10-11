load('public/js/games/poly-core.js');
const C = globalThis.PolyCore;
for (const t of C.TRACKS) {
  const T = C.build(t);
  const r = C.simulate(t);
  print(`${t.id} ${t.name.padEnd(12)} len ${Math.round(T.length)} cps ${T.cps}  time ${r.time ? r.time.toFixed(2) : 'DNF'}  respawns ${r.respawns}  cps passed ${r.cps}/${r.total}`);
}
