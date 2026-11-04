/* Downtown: Driftvvd's city (a world with "features": {"city": {...}}, made by tools/make_city.py).
 *
 * cityLayout(world) lays the whole city out from a few numbers, the same every time (terrain.mjs uses it for what's
 * solid and what's road, cityScenery draws it):
 *  - streets on a grid, `pitch` metres apart, `lines` each way from the middle (the `boulevards` among them wider),
 *    a pavement (`sidewalk`) along every kerb, and a ring of blocks round the outside walling the city in;
 *  - a block of buildings between each four streets, cut into lots, each lot one building filling it (a box: solid);
 *  - the plaza: a huge open car park (no streets or buildings across it), bays round its edges, cones in the middle;
 *  - roundabouts at the crossings in `roundabouts` ([x, z, island radius]: the island is solid);
 *  - street lights along the pavements, traffic lights at the crossings, cars parked along the kerbs (all solid).
 * Positions are world [x, z] in metres; a heading of 0 points +z.
 *
 * This file has no imports (terrain.mjs uses it, and runs in the tests too): city.mjs draws it. */

// ---------------------------------------------------------------- the models' sizes (model units: x, height, z)
/** The buildings: [file, low-detail file, width, height, depth] (the low-detail one is scaled to the same lot). */
export const BUILDINGS = [
  ['building-a', 'low-detail-building-a', 0.88, 1.29, 0.94], ['building-b', 'low-detail-building-b', 0.97, 1.29, 0.94],
  ['building-c', 'low-detail-building-c', 0.88, 0.89, 1.09], ['building-d', 'low-detail-building-d', 0.84, 1.29, 0.9],
  ['building-e', 'low-detail-building-wide-a', 1.64, 0.89, 1.01], ['building-f', 'low-detail-building-f', 0.84, 1.69, 1.03],
  ['building-g', 'low-detail-building-g', 0.97, 1.69, 0.92], ['building-h', 'low-detail-building-h', 0.88, 1.29, 1.01],
  ['building-i', 'low-detail-building-i', 1.24, 1.68, 1.3], ['building-j', 'low-detail-building-wide-b', 2.08, 1.69, 1.34],
  ['building-k', 'low-detail-building-wide-a', 2.08, 1.47, 0.94], ['building-l', 'low-detail-building-l', 1.37, 2.27, 1.4],
  ['building-m', 'low-detail-building-m', 1.24, 3.15, 1.24], ['building-n', 'low-detail-building-wide-b', 2.32, 2.48, 1.82],
  ['building-skyscraper-a', 'low-detail-building-j', 1.36, 2.88, 1.36], ['building-skyscraper-b', 'low-detail-building-k', 1.36, 4.48, 1.36],
  ['building-skyscraper-c', 'low-detail-building-e', 1.28, 4.08, 1.39], ['building-skyscraper-d', 'low-detail-building-c', 1.28, 5.47, 1.39],
  ['building-skyscraper-e', 'low-detail-building-b', 1.29, 4.08, 1.24],
];
const TOWERS = [11, 12, 14, 15, 16, 17, 18];   // (the tall ones: downtown)
/** Parked cars: [file, width, length] (model units; drawn 1.75 times as big). */
export const CARS = [['sedan', 1.5, 2.55], ['taxi', 1.5, 2.75], ['suv', 1.5, 2.55], ['van', 1.5, 2.75], ['hatchback-sports', 1.3, 2.85], ['suv-luxury', 1.5, 2.85], ['police', 1.5, 2.9], ['sedan-sports', 1.3, 2.55], ['truck', 1.5, 2.95], ['delivery', 1.5, 3.25]];
export const CAR_SCALE = 1.75;
export const LAMP_SCALE = 12;       // (the kit's street light is 0.67 tall: 8 m)
export const SIGNAL_SCALE = 10;     // (its traffic light: 5 m)

const rng = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function cityLayout(world) {
  const S = world.features.city; const r = rng(S.seed || 1);
  const P = S.pitch; const N = S.lines; const EXT = S.extent; const SW = S.sidewalk;
  const lines = []; for (let k = -N; k <= N; k++) lines.push({ c: k * P, w: (S.boulevards || []).includes(k) ? S.boulevard : S.road, k });
  const lim = N * P + S.road / 2;            // (the streets run this far out: the ring of blocks beyond)
  const [px0, pz0, px1, pz1] = S.plaza;      // (street lines bounding the plaza)
  const lineAt = (c) => lines.find((l) => l.c === c);
  const plaza = { x0: px0 + lineAt(px0).w / 2, z0: pz0 + lineAt(pz0).w / 2, x1: px1 - lineAt(px1).w / 2, z1: pz1 - lineAt(pz1).w / 2 };
  const inPlaza = (x, z, m = 0) => x > plaza.x0 - m && x < plaza.x1 + m && z > plaza.z0 - m && z < plaza.z1 + m;
  const rounds = (S.roundabouts || []).map(([x, z, isl]) => ({ x, z, island: isl, outer: isl + 15 }));
  // ---- what's road: a street's strip, the plaza, a roundabout's ring
  function roadAt(x, z) {
    if (Math.abs(x) > lim + 2 || Math.abs(z) > lim + 2) return false;
    if (inPlaza(x, z)) return true;
    for (const R of rounds) { const d = Math.hypot(x - R.x, z - R.z); if (d < R.outer) return d > R.island; }
    for (const l of lines) if (Math.abs(x - l.c) < l.w / 2 || Math.abs(z - l.c) < l.w / 2) return true;
    return false;
  }
  // ---- the solid things: boxes (buildings, parked cars) and circles (poles, the roundabouts' islands)
  const boxes = []; const circles = []; const lots = []; const lamps = []; const signals = []; const parked = []; const cones = [];
  const nearRound = (x, z, d) => rounds.some((R) => Math.hypot(x - R.x, z - R.z) < R.outer + d);
  const boxNearRound = (x0, z0, x1, z1, d) => rounds.some((R) => Math.hypot(clamp(R.x, x0, x1) - R.x, clamp(R.z, z0, z1) - R.z) < R.outer + d);
  /** A building on the lot [x0, z0, x1, z1], its front to the street on side `face` (0: -z, 1: +x, 2: +z, 3: -x). */
  function building(x0, z0, x1, z1, face, downtown) {
    const lw = x1 - x0; const ld = z1 - z0; const turned = face === 1 || face === 3;
    const aspect = (turned ? ld : lw) / (turned ? lw : ld);
    let pool = BUILDINGS.map((b, i) => i).filter((i) => Math.abs(Math.log(BUILDINGS[i][2] / BUILDINGS[i][4] / aspect)) < 0.42);
    if (downtown) { const tall = pool.filter((i) => TOWERS.includes(i)); if (tall.length && r() < 0.75) pool = tall; } else if (r() < 0.8) pool = pool.filter((i) => !TOWERS.includes(i));
    if (!pool.length) pool = [0];
    const i = pool[Math.floor(r() * pool.length)]; const [, , mw, mh, md] = BUILDINGS[i];
    const sx = (turned ? ld : lw) / mw; const sz = (turned ? lw : ld) / md; const sy = Math.sqrt(sx * sz) * (0.85 + r() * 0.3);
    const b = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, hw: lw / 2, hd: ld / 2, ry: [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face], i, sx, sy, sz, tall: mh * sy };
    lots.push(b); boxes.push(b);
  }
  /** A block between streets: [x0, z0, x1, z1] inside its pavements, cut into lots. edges: which sides face a street. */
  function block(x0, z0, x1, z1, edges) {
    if (x1 - x0 < 12 || z1 - z0 < 12) return;
    const downtown = Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) < 260;
    const nx = x1 - x0 > 70 ? 2 : 1; const nz = z1 - z0 > 70 ? 2 : 1; const big = nx * nz > 1 && r() < 0.18;   // (now and then one building fills a block)
    const cx = big ? 1 : nx; const cz = big ? 1 : nz; const gap = 1.5;
    for (let i = 0; i < cx; i++) for (let j = 0; j < cz; j++) {
      const a0 = x0 + (x1 - x0) * i / cx + gap; const a1 = x0 + (x1 - x0) * (i + 1) / cx - gap; const b0 = z0 + (z1 - z0) * j / cz + gap; const b1 = z0 + (z1 - z0) * (j + 1) / cz - gap;
      if (boxNearRound(a0, b0, a1, b1, SW + 4)) continue;   // (the corners round a roundabout are cut back)
      // (it faces the street it's nearest)
      const opts = [[0, j === 0 && edges[0]], [2, j === cz - 1 && edges[2]], [3, i === 0 && edges[3]], [1, i === cx - 1 && edges[1]]].filter((o) => o[1]).map((o) => o[0]);
      building(a0, b0, a1, b1, opts.length ? opts[Math.floor(r() * opts.length)] : 0, downtown);
    }
  }
  // the blocks between the streets, and the ring round the outside
  const cuts = [-EXT + 6, ...lines.map((l) => l.c), EXT - 6];
  for (let i = 0; i < cuts.length - 1; i++) for (let j = 0; j < cuts.length - 1; j++) {
    const lx = lines.find((l) => l.c === cuts[i]); const hx = lines.find((l) => l.c === cuts[i + 1]); const lz = lines.find((l) => l.c === cuts[j]); const hz = lines.find((l) => l.c === cuts[j + 1]);
    const x0 = lx ? lx.c + lx.w / 2 + SW : cuts[i]; const x1 = hx ? hx.c - hx.w / 2 - SW : cuts[i + 1]; const z0 = lz ? lz.c + lz.w / 2 + SW : cuts[j]; const z1 = hz ? hz.c - hz.w / 2 - SW : cuts[j + 1];
    if (inPlaza((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    block(x0, z0, x1, z1, [!!lz, !!hx, !!hz, !!lx]);
  }
  // ---- along the streets: street lights, traffic lights at the crossings, parked cars by the kerbs
  const crossing = (l, t) => lines.some((m) => Math.abs(t - m.c) < m.w / 2 + 16);   // (t: how far along line l: near a crossing street?)
  const solidCircle = (x, z, rr) => circles.push({ x, z, r: rr });
  for (const l of lines) for (const axis of [0, 1]) for (const side of [-1, 1]) {
    const off = l.c + side * (l.w / 2 + 1.1);   // (on the pavement, by the kerb)
    for (let t = -lim + 20, n = 0; t < lim - 20; t += 38, n++) {
      if ((n + (side > 0 ? 1 : 0)) % 2) continue;   // (staggered: one side then the other)
      const x = axis ? t : off; const z = axis ? off : t;
      if (crossing(l, t) || inPlaza(x, z, 4) || nearRound(x, z, 6)) continue;
      lamps.push({ x, z, ry: axis ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) }); solidCircle(x, z, 0.3);
    }
    // parked cars: in the kerbside lane, on the plain streets (not the boulevards: room to drift)
    if (l.w !== S.road) continue;
    const lane = l.c + side * (l.w / 2 - 1.5);
    for (let t = -lim + 10; t < lim - 10; t += 6.5) {
      if (r() > 0.11) continue;
      const x = axis ? t : lane; const z = axis ? lane : t;
      if (crossing(l, t) || inPlaza(x, z, 8) || nearRound(x, z, 12)) continue;
      const c = Math.floor(r() * CARS.length); const [, cw, cl] = CARS[c];
      const hw = cw * CAR_SCALE / 2; const hl = cl * CAR_SCALE / 2;
      const car = { x, z, c, ry: (axis ? Math.PI / 2 : 0) + (r() < 0.5 ? Math.PI : 0), hw: axis ? hl : hw, hd: axis ? hw : hl, tall: 2 };
      parked.push(car); boxes.push(car); t += cl * CAR_SCALE;
    }
  }
  // traffic lights on two corners of every plain crossing
  for (const a of lines) for (const b of lines) {
    if (rounds.some((R) => R.x === a.c && R.z === b.c) || inPlaza(a.c, b.c, 30)) continue;
    for (const [sx, sz] of [[1, 1], [-1, -1]]) {
      const x = a.c + sx * (a.w / 2 + 1.4); const z = b.c + sz * (b.w / 2 + 1.4);
      signals.push({ x, z, ry: sx > 0 ? 0 : Math.PI, phase: (a.k + b.k) & 1 }); solidCircle(x, z, 0.25);
    }
  }
  // the plaza: bays down two sides with cars in some, lights round it, cones to drift round in the middle
  const bays = [];
  for (const [z, dir] of [[plaza.z0 + 3, 1], [plaza.z1 - 3, -1]]) for (let x = plaza.x0 + 8; x < plaza.x1 - 8; x += 3.2) {
    bays.push({ x, z: z + dir * 2.7, ry: 0 });
    if (r() < 0.3) { const c = Math.floor(r() * 6); const [, cw, cl] = CARS[c]; const car = { x, z: z + dir * 2.7, c, ry: dir > 0 ? Math.PI : 0, hw: cw * CAR_SCALE / 2, hd: cl * CAR_SCALE / 2, tall: 2 }; parked.push(car); boxes.push(car); }
  }
  for (let x = plaza.x0 + 4; x <= plaza.x1 - 4; x += 36) for (const z of [plaza.z0 + 12, plaza.z1 - 12]) { lamps.push({ x, z, ry: z < 0 ? 0 : Math.PI }); solidCircle(x, z, 0.3); }
  const pcx = (plaza.x0 + plaza.x1) / 2; const pcz = (plaza.z0 + plaza.z1) / 2;
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; cones.push({ x: pcx + Math.cos(a) * 26, z: pcz + Math.sin(a) * 26 }); }   // (a ring of cones: drift round it)
  for (const [dx] of [[-55], [55]]) for (let k = 0; k < 5; k++) cones.push({ x: pcx + dx, z: pcz - 40 + k * 20 });   // (and two lines of them: a slalom)
  // round each roundabout: its island (solid), and lights at its four corners
  for (const R of rounds) { solidCircle(R.x, R.z, R.island); for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const d = (R.outer + 2) / Math.SQRT2; lamps.push({ x: R.x + dx * d, z: R.z + dz * d, ry: Math.atan2(-dx, -dz) }); solidCircle(R.x + dx * d, R.z + dz * d, 0.3); } }
  // ---- looking things up fast: a grid of 40 m cells
  const CELL = 40; const grid = new Map();
  const put = (o, x0, z0, x1, z1) => { for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) { const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); } };
  for (const b of boxes) put(b, b.x - b.hw, b.z - b.hd, b.x + b.hw, b.z + b.hd);
  for (const c of circles) put({ ...c, circle: true }, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  /** Something solid within rad metres of (x, z)? { nx, nz (out of it), depth, what } (the deepest), or null. */
  function hit(x, z, rad) {
    let best = null; const seen = new Set();
    for (let gx = Math.floor((x - rad) / CELL); gx <= Math.floor((x + rad) / CELL); gx++) for (let gz = Math.floor((z - rad) / CELL); gz <= Math.floor((z + rad) / CELL); gz++) {
      for (const o of grid.get(gx + ',' + gz) || []) {
        if (seen.has(o)) continue; seen.add(o);
        let nx; let nz; let depth;
        if (o.circle) { const dx = x - o.x; const dz = z - o.z; const d = Math.hypot(dx, dz); depth = o.r + rad - d; if (depth <= 0) continue; nx = d > 1e-6 ? dx / d : 1; nz = d > 1e-6 ? dz / d : 0; }
        else {
          const cx = clamp(x, o.x - o.hw, o.x + o.hw); const cz = clamp(z, o.z - o.hd, o.z + o.hd); const dx = x - cx; const dz = z - cz; const d = Math.hypot(dx, dz);
          if (d > 1e-6) { depth = rad - d; if (depth <= 0) continue; nx = dx / d; nz = dz / d; }
          else {   // (the middle is inside: out the nearest side)
            const ex = o.hw - Math.abs(x - o.x); const ez = o.hd - Math.abs(z - o.z);
            if (ex < ez) { nx = Math.sign(x - o.x) || 1; nz = 0; depth = ex + rad; } else { nx = 0; nz = Math.sign(z - o.z) || 1; depth = ez + rad; }
          }
        }
        if (!best || depth > best.depth) best = { nx, nz, depth, what: o.circle ? 'pole' : o.c != null ? 'car' : 'building' };
      }
    }
    return best;
  }
  /** How flat the ground is made here (1 over the city, fading off just beyond it). */
  const flat = (x, z) => 1 - clamp((Math.max(Math.abs(x), Math.abs(z)) - EXT) / 60, 0, 1);
  return { lines, lim, plaza, rounds, lots, lamps, signals, parked, bays, cones, boxes, circles, roadAt, hit, flat, inPlaza, extent: EXT, sidewalk: SW, road: S.road };
}

