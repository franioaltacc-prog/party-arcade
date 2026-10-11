load('public/js/games/poly-core.js');
const C = globalThis.PolyCore;
for (const t of C.TRACKS) {
  const T = C.build(t);
  // reverse from the start for 6 seconds
  let c = C.newCar(T); let minAlong = 0; let fell = false;
  for (let k = 0; k < 720; k++) {
    C.step(T, c, { down: 1, left: k % 200 < 100 ? 0.3 : 0 }, 1 / 120);
    const s = T.S[0]; const along = (c.x - s.x) * s.hx + (c.z - s.z) * s.hz;
    minAlong = Math.min(minAlong, along); if (c.fell) fell = true;
  }
  const back = `reverse: furthest ${minAlong.toFixed(2)} behind the start, grounded ${c.grounded}, fell ${fell}`;
  // drive past the end of the run-out (pretend you missed a checkpoint, so you don't finish)
  c = C.newCar(T, T.S.length - 20); c.cp = -5; let maxAlong = -99; fell = false;
  for (let k = 0; k < 720; k++) {
    C.step(T, c, { up: 1 }, 1 / 120);
    const s = T.S[T.S.length - 1]; const along = (c.x - s.x) * s.hx + (c.z - s.z) * s.hz;
    maxAlong = Math.max(maxAlong, along); if (c.fell) fell = true;
  }
  print(`${t.id} ${t.name.padEnd(12)} ${back} | end: furthest ${maxAlong.toFixed(2)} past the end, fell ${fell} | autopilot ${C.simulate(t).time.toFixed(2)}`);
}
