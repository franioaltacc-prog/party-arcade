/* Mini Golf core: the two courses and the ball physics. No drawing here, so it also runs in node
   (tests/golftest.js searches over shots to prove every hole can be holed within par + 1).

   A hole is a little tile map, one character per 1×1 tile (row 0 is the far end):
     #  outside (a rail is built where the turf meets it)     .  turf      s  sand (slow)
     ~  water (no rail: roll in and it's a splash, +1)         _  a drop / chasm (fall in: +1)
     =  bridge (turf with rails against the water)            ,  turf with rails against the water
     7 9 1 3  turf with one corner cut off at 45°, like the keys on a number pad (7 = top-left cut)
     T  the tee     C  the cup   (both are turf; `tee` / `cup` can place them more exactly)
   plus heights (ramps, plateaus, hills, rings), bumpers, blocks, moving obstacles and teleports.
   Everything is driven by the hole clock t (seconds since the hole started), so a run is
   deterministic: the same shots at the same times always end in the same place. */
(function (root) {
  'use strict';
  const P = {
    R: 0.2,            // ball radius
    CUP_R: 0.38,       // cup radius
    G: 9.8,
    VMAX: 11,          // a full-power shot
    ROLL: 1.0,         // rolling friction (units/s²) on turf…
    DRAG: 0.18,        // …plus this much per unit of speed
    SAND_ROLL: 5.5,
    SAND_DRAG: 0.9,
    WALL_E: 0.64,      // how bouncy the rails are
    BUMP_E: 1.12,      // bumpers give a little kick
    MOVER_E: 0.6,
    STOP_V: 0.07,
    CAP_V: 3.1,        // faster than this over the cup and it lips out
    PULL: 14,          // the cup's rim pulls slow balls in
    WALL_H: 0.42,      // rail height above the turf
    WATER_Y: -0.18,
    OUT_Y: -1.2,
    VCAP: 15,
    DT: 1 / 120,
    MAX_STROKES: 8,
    MAX_SHOT_T: 30,    // a shot that hasn't stopped after this long is stopped
  };

  // ------------------------------------------------------------------ the courses
  const CLASSIC = [
    {
      name: 'First Putt', par: 2, tip: 'A gentle warm-up. Drag back from the ball and let go!',
      map: [
        '###########',
        '###7...9###',
        '##7.....9##',
        '##...C...##',
        '##1.....3##',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###..T..###',
        '###1...3###',
        '###########',
      ],
      deco: [['flowers', 1.2, 8], ['flowers', 9.6, 6], ['bench', 9.4, 11.5, 1.57], ['sign', 2.3, 13.4]],
    },
    {
      name: 'Dogleg', par: 3, tip: 'Round the corner — and stay out of the sand.',
      map: [
        '###############',
        '#7...........9#',
        '#.ss..........#',
        '#.ss.......C..#',
        '#.............#',
        '#............3#',
        '#.....3########',
        '#.....#########',
        '#.....#########',
        '#.....#########',
        '#.....#########',
        '#.....#########',
        '#.....#########',
        '#.....#########',
        '#..T..#########',
        '#1...3#########',
        '###############',
      ],
      bumpers: [[8.5, 4.5, 0.35]],
      deco: [['tree', 9.5, 10, 1.2], ['tree', 12, 8.5, 1], ['flowers', 8, 8], ['rock', 10.5, 12.5, 0.8]],
    },
    {
      name: 'Windmill', par: 3, tip: 'Time it through the windmill — the blades knock you back.',
      map: [
        '#########',
        '##7...9##',
        '#7.....9#',
        '#...C...#',
        '#1.....3#',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##..T..##',
        '##1...3##',
        '#########',
      ],
      movers: [{ k: 'windmill', x: 4.5, z: 8.5, w: 1.3, d: 1.6, span: 2.5, period: 5, face: 1, style: 'mill' }],
      deco: [['flowers', 1, 11], ['flowers', 8.2, 4.6], ['fence', 0.6, 6, 1.57]],
    },
    {
      name: 'Ramp Jump', par: 3, tip: 'Hit the ramp hard enough to clear the creek!',
      map: [
        '#########',
        '##7...9##',
        '##.....##',
        '##..C..##',
        '##.....##',
        '##.....##',
        '##_____##',
        '##_____##',
        '##_____##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##..T..##',
        '##1...3##',
        '#########',
      ],
      h: [['ramp', 0, 9, 9, 12, 0.6, 0, 'z']],
      cup: [3.4, 2.6],
      bumpers: [[4.95, 3.4, 0.32]],
      deco: [['tree', 0.6, 3, 1.1], ['tree', 8.4, 4.5, 0.9], ['rock', 8.2, 13, 0.7]],
    },
    {
      name: 'Bumper Bash', par: 3, tip: 'Bounce your way past the bumpers.',
      map: [
        '#############',
        '##7.......9##',
        '#7.........9#',
        '#.....C.....#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#...........#',
        '#1.........3#',
        '##1.......3##',
        '####.....####',
        '####..T..####',
        '####1...3####',
        '#############',
      ],
      bumpers: [[6.5, 8.6, 0.55], [4.0, 6.6, 0.5], [9.0, 6.6, 0.5], [6.5, 5.4, 0.45], [2.6, 4.4, 0.4], [10.4, 4.4, 0.4]],
      deco: [['flowers', 1.5, 12.5], ['flowers', 11.5, 12.5], ['tree', 12.4, 9, 1]],
    },
    {
      name: 'Gate Keeper', par: 3, tip: 'Slip through the gap while the gate is open.',
      map: [
        '#########',
        '##7...9##',
        '#7.....9#',
        '#...C...#',
        '#.......#',
        '#1.....3#',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##..T..##',
        '##1...3##',
        '#########',
      ],
      h: [['hill', 4.5, 5.6, 1.5, 0.16]],
      blocks: [[2, 8.6, 3.75, 9.4, 'brick'], [5.25, 8.6, 7, 9.4, 'brick']],
      movers: [{ k: 'slide', x0: 2.85, z0: 9.75, x1: 6.15, z1: 9.75, w: 1.7, d: 0.36, period: 3.4, phase: 0, style: 'gate' }],
      deco: [['flowers', 0.8, 12], ['bench', 8.3, 11, -1.57], ['tree', 8.4, 3, 0.9]],
    },
    {
      name: 'Hilltop', par: 3, tip: 'Up the hill — too soft and it rolls back to you!',
      map: [
        '###########',
        '###7...9###',
        '##7.....9##',
        '##.C.....##',
        '##.......##',
        '##1.....3##',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###..T..###',
        '###1...3###',
        '###########',
      ],
      cup: [3.9, 3.0],
      h: [['flat', 0, 0, 11, 6, 0.85], ['ramp', 0, 6, 11, 11, 0.85, 0, 'z'], ['hill', 4.6, 8.6, 1.1, 0.2], ['hill', 4.9, 4.5, 1.15, 0.24], ['hill', 7.4, 2.2, 0.9, 0.12]],
      deco: [['tree', 1, 8, 1.1], ['tree', 10, 9.5, 1], ['rock', 9.6, 2.5, 0.8], ['flowers', 1.2, 12]],
    },
    {
      name: 'Island Green', par: 3, tip: 'Cross the bridge. The island has no rails — careful!',
      map: [
        '############',
        '#~~~~~~~~~~#',
        '#~7.....9~~#',
        '#~.......~~#',
        '#~.......~~#',
        '#~.......~~#',
        '#~1.....3~~#',
        '#~~==~~~~~~#',
        '#~~==~~~~~~#',
        '#~~==~~~~~~#',
        '#~~==~~~~~~#',
        '#~,,,,,,,,~#',
        '#~,,,,,,,,~#',
        '#~,,,,,,,,~#',
        '#~,,,,,,,,~#',
        '#~~~~~~~~~~#',
        '############',
      ],
      tee: [8.3, 13.4], cup: [7.0, 4.3],
      deco: [['lily', 9.6, 9], ['lily', 7, 8.6], ['lily', 10.3, 4], ['reeds', 1.4, 9.5], ['reeds', 10.5, 13], ['duck', 7.5, 10]],
    },
    {
      name: 'Rabbit Hole', par: 4, tip: 'The long way round… or try the rabbit hole.',
      map: [
        '##############',
        '#7..........9#',
        '#....ss......#',
        '#....ss......#',
        '#.....3#1....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###....#',
        '#.....###..s.#',
        '#.....###....#',
        '#..T..###.C..#',
        '#1...3###1..3#',
        '##############',
      ],
      tele: [{ from: [5.58, 8.5], r: 0.5, to: [9.42, 8.6], dir: [0.55, -0.83], style: 'burrow' }],
      deco: [['bush', 7.5, 12], ['bush', 7.4, 6.5], ['tree', 7.5, 9.6, 0.8], ['flowers', 7.5, 14.6]],
    },
  ];

  const SPOOKY = [
    {
      name: 'Graveyard Gate', par: 2, tip: 'Welcome to Spooky Hollow… mind the graves.',
      map: [
        '###########',
        '###7...9###',
        '##7.....9##',
        '##...C...##',
        '##.......##',
        '##1.....3##',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###..T..###',
        '###1...3###',
        '###########',
      ],
      blocks: [[3.5, 8.3, 4.5, 8.65, 'tomb'], [6.5, 6.6, 7.5, 6.95, 'tomb'], [5.95, 5.3, 6.85, 5.62, 'tomb']],
      deco: [['gate', 5.5, 11.0], ['candle', 3.05, 6.2], ['candle', 7.95, 9.5], ['candle', 2.6, 4.6], ['pumpkin', 9.4, 3.2, 0.8], ['grave', 1.4, 8.5], ['grave', 9.6, 10]],
    },
    {
      name: 'Sliding Stones', par: 3, tip: 'The tombstones move… wait for your moment.',
      map: [
        '#########',
        '##7...9##',
        '#7.....9#',
        '#...C...#',
        '#1.....3#',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##..T..##',
        '##1...3##',
        '#########',
      ],
      movers: [
        { k: 'slide', x0: 3.0, z0: 12.5, x1: 6.0, z1: 12.5, w: 1.6, d: 0.42, period: 3.2, phase: 0, style: 'tomb' },
        { k: 'slide', x0: 6.0, z0: 8.0, x1: 3.0, z1: 8.0, w: 1.6, d: 0.42, period: 2.6, phase: 1.1, style: 'tomb' },
      ],
      deco: [['candle', 2.05, 10.2], ['candle', 6.95, 6], ['grave', 0.8, 9], ['grave', 8.3, 13], ['deadtree', 8.4, 4, 1]],
    },
    {
      name: 'Pumpkin Patch', par: 3, tip: 'Pumpkins are bouncy. Very bouncy.',
      map: [
        '#############',
        '#7.....9#####',
        '#.......9####',
        '#..C.....9###',
        '#.........9##',
        '#1.........9#',
        '##1.........#',
        '###1........#',
        '####1.......#',
        '#####1......#',
        '######......#',
        '######..T...#',
        '######1....3#',
        '#############',
      ],
      sandStyle: 'dirt',
      bumpers: [[5.9, 7.1, 0.55], [7.9, 5.3, 0.5], [4.4, 5.4, 0.45], [9.6, 8.1, 0.5], [6.2, 3.2, 0.42], [3.0, 1.9, 0.35]],
      bumperE: 1.25,
      deco: [['deadtree', 2.5, 10, 1.2], ['pumpkin', 11, 2, 1], ['pumpkin', 10.4, 3.2, 0.7], ['scarecrow', 3.4, 8.6], ['candle', 12.1, 9]],
    },
    {
      name: 'Coffin Swing', par: 3, tip: 'Duck under the swinging coffin.',
      map: [
        '#########',
        '##7...9##',
        '#7.....9#',
        '#...C...#',
        '#1.....3#',
        '##.....##',
        '##1...3##',
        '###...###',
        '###...###',
        '###...###',
        '##7...9##',
        '##.....##',
        '##.....##',
        '##.....##',
        '##..T..##',
        '##1...3##',
        '#########',
      ],
      movers: [{ k: 'swing', x: 4.5, z: 8.5, amp: 1.2, w: 1.5, d: 0.55, period: 2.4, phase: 0, style: 'coffin' }],
      deco: [['candle', 2.95, 7.3], ['candle', 6.05, 9.7], ['grave', 1, 11], ['deadtree', 8, 12, 1], ['pumpkin', 0.8, 2.5, 0.7]],
    },
    {
      name: 'Bat Mill', par: 3, tip: 'The bats spin… slip through between the wings.',
      map: [
        '############',
        '##7......9##',
        '##........9#',
        '##.......C.#',
        '##.........#',
        '##........3#',
        '##.....3####',
        '##.....#####',
        '##.....#####',
        '##.....#####',
        '##.....#####',
        '##.....#####',
        '##.....#####',
        '##..T..#####',
        '##1...3#####',
        '############',
      ],
      movers: [{ k: 'windmill', x: 4.5, z: 9.2, w: 1.3, d: 1.6, span: 2.5, period: 4.4, face: 1, style: 'bat' }],
      deco: [['candle', 7.4, 4.1], ['grave', 9, 10], ['deadtree', 9.5, 12.5, 1.1], ['pumpkin', 1, 13, 0.8]],
    },
    {
      name: 'Haunted House', par: 3, tip: 'Two doors. One is a trick… BOO!',
      map: [
        '############',
        '#7......9###',
        '#........###',
        '#..C.....###',
        '#........###',
        '#1.......###',
        '##.......###',
        '##.......###',
        '##.......###',
        '##.......###',
        '##.......###',
        '##.......###',
        '##.......###',
        '##...T...###',
        '##1.....3###',
        '############',
      ],
      blocks: [[2, 7, 9, 10.5, 'house']],
      tele: [
        { from: [3.8, 10.62], to: [5.5, 6.75], dir: [-0.42, -1], style: 'door' },
        { from: [7.2, 10.62], to: [7.2, 11.2], dir: [0, 1], style: 'door', boo: true },
      ],
      deco: [['deadtree', 10, 4, 1.2], ['grave', 10.4, 9], ['grave', 0.9, 9.5], ['candle', 2.4, 11.6], ['candle', 8.6, 11.6], ['pumpkin', 8.2, 1.6, 0.7]],
    },
    {
      name: 'Crypt Jump', par: 3, tip: 'Fly over the crypt — don’t fall in!',
      map: [
        '###########',
        '#7.......9#',
        '#.........#',
        '#....C....#',
        '#.........#',
        '#1.......3#',
        '#_________#',
        '#_________#',
        '#_________#',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###.....###',
        '###..T..###',
        '###1...3###',
        '###########',
      ],
      h: [['flat', 0, 0, 11, 6, 0.15], ['ramp', 0, 9, 11, 12, 0.62, 0, 'z']],
      blocks: [[2.2, 1.9, 3.1, 2.25, 'tomb'], [7.9, 1.9, 8.8, 2.25, 'tomb']],
      deco: [['candle', 3.05, 11], ['candle', 7.95, 11], ['deadtree', 1, 12, 1], ['grave', 9.7, 13], ['pumpkin', 10.3, 3.5, 0.7]],
    },
    {
      name: "Witch's Cauldron", par: 3, tip: 'Over the rim and into the cauldron!',
      map: [
        '#############',
        '####7...9####',
        '###7.....9###',
        '##7.......9##',
        '##.........##',
        '##.........##',
        '##.........##',
        '##1.......3##',
        '###1.....3###',
        '####.....####',
        '####.....####',
        '####.....####',
        '####.....####',
        '####..T..####',
        '####1...3####',
        '#############',
      ],
      cup: [6.5, 4.1],
      h: [['ring', 6.5, 5.1, 2.1, 0.9, 0.3, 'rim']],
      deco: [['candle', 4.05, 9.6], ['candle', 8.95, 9.6], ['candle', 2.6, 5], ['candle', 10.4, 5], ['broom', 11, 9], ['pumpkin', 1.2, 2, 0.8], ['deadtree', 11.6, 12, 1]],
    },
    {
      name: 'Moonlit Marsh', par: 4, tip: 'Hop the islands. The swamp is hungry.',
      map: [
        '##############',
        '#~~~~~~~~~~~~#',
        '#~~~~~7..9~~~#',
        '#~~~~~....~~~#',
        '#~~~~~....~~~#',
        '#~~~~~1...~~~#',
        '#~~~~~~~==~~~#',
        '#~~~~~~~==~~~#',
        '#~~7......~~~#',
        '#~~.......~~~#',
        '#~~.......~~~#',
        '#~~1.....3~~~#',
        '#~~~==~~~~~~~#',
        '#~~~==~~~~~~~#',
        '#~~~==~~~~~~~#',
        '#~,,,,,,,,~~~#',
        '#~,,,,,,,,~~~#',
        '#~,,,,,,,,~~~#',
        '#~~~~~~~~~~~~#',
        '##############',
      ],
      tee: [6.5, 16.5], cup: [8.4, 3.6],
      movers: [{ k: 'slide', x0: 4.2, z0: 9.6, x1: 8.0, z1: 9.6, w: 1.2, d: 0.4, period: 4, phase: 0.5, style: 'tomb' }],
      deco: [['wisp', 11, 6], ['wisp', 2.2, 4], ['wisp', 11.5, 14], ['reeds', 1.6, 7], ['reeds', 11.4, 10.5], ['deadtree', 12.6, 2, 1]],
    },
  ];

  const COURSES = [
    { id: 'classic', name: 'Classic Meadow', emoji: '🌼', theme: 'meadow', blurb: 'Sunny warm-up course: windmill, ramp jump, island green.', holes: CLASSIC },
    { id: 'spooky', name: 'Spooky Hollow', emoji: '🎃', theme: 'spooky', blurb: 'A haunted night course: sliding graves, coffins, a haunted house.', holes: SPOOKY },
  ];
  COURSES.forEach((c) => c.holes.forEach((hd, i) => { hd.id = `${c.id}-${i + 1}`; hd.n = i + 1; hd.course = c.id; }));
  const courseById = (id) => COURSES.find((c) => c.id === id) || COURSES[0];
  const par = (id) => courseById(id).holes.reduce((s, x) => s + x.par, 0);

  // ------------------------------------------------------------------ building a hole
  // cell codes
  const VOID = 0; const TURF = 1; const SAND = 2; const WATER = 3; const GAP = 4;
  const CODE = { '#': VOID, ' ': VOID, '.': TURF, T: TURF, C: TURF, s: SAND, '~': WATER, _: GAP, '=': TURF, ',': TURF, 7: TURF, 9: TURF, 1: TURF, 3: TURF };
  const solid = (c) => c === TURF || c === SAND;

  function build(hd) {
    if (hd._built) return hd._built;
    const rows = hd.map;
    const D = rows.length; const W = rows[0].length;
    rows.forEach((r, i) => { if (r.length !== W) throw new Error(`${hd.id}: row ${i} is ${r.length} wide, not ${W}`); });
    const code = new Uint8Array(W * D);
    const diag = new Uint8Array(W * D);      // 7 9 1 3 = which corner is cut
    const railed = new Uint8Array(W * D);    // bridges and ',' turf get rails against water
    const cutType = new Uint8Array(W * D);   // what the cut-off corner of a diagonal tile is (void or water)
    let tee = null; let cup = null;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const ch = rows[z][x];
        if (!(ch in CODE)) throw new Error(`${hd.id}: unknown tile "${ch}"`);
        const i = z * W + x;
        code[i] = CODE[ch];
        if ('7913'.includes(ch)) diag[i] = +ch;
        if (ch === '=' || ch === ',') railed[i] = 1;
        if (ch === 'T') tee = [x + 0.5, z + 0.5];
        if (ch === 'C') cup = [x + 0.5, z + 0.5];
      }
    }
    const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? VOID : code[z * W + x]);
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const d = diag[z * W + x];
        if (!d) continue;
        const nz = d === 7 || d === 9 ? z - 1 : z + 1;
        const nx = d === 7 || d === 1 ? x - 1 : x + 1;
        cutType[z * W + x] = at(x, nz) === WATER || at(nx, z) === WATER ? WATER : at(x, nz) === GAP || at(nx, z) === GAP ? GAP : VOID;
      }
    }
    tee = hd.tee || tee; cup = hd.cup || cup;
    if (!tee || !cup) throw new Error(`${hd.id}: needs a tee and a cup`);

    const H = { hd, W, D, code, diag, railed, cutType, tee, cup, walls: [], bumpers: [], blocks: [], movers: [], tele: [], hf: [] };

    // heights
    for (const f of hd.h || []) {
      const [t] = f;
      if (t === 'flat') H.hf.push({ t, x0: f[1], z0: f[2], x1: f[3], z1: f[4], h: f[5] });
      else if (t === 'ramp') H.hf.push({ t, x0: f[1], z0: f[2], x1: f[3], z1: f[4], a: f[5], b: f[6], axis: f[7] || 'z' });
      else if (t === 'hill') H.hf.push({ t, x: f[1], z: f[2], r: f[3], h: f[4] });
      else if (t === 'ring') H.hf.push({ t, x: f[1], z: f[2], R: f[3], w: f[4], h: f[5], tint: f[6] });
    }

    // the rails, from the tile edges where turf meets the outside
    // edge of a tile: is that whole edge turf? (a diagonal tile's two cut sides aren't)
    const CUT_SIDES = { 7: 'NW', 9: 'NE', 1: 'SW', 3: 'SE' };
    const edgeKind = (x, z, side) => {      // what's on this tile's side of the edge
      if (x < 0 || z < 0 || x >= W || z >= D) return VOID;
      const i = z * W + x;
      const d = diag[i];
      if (d && CUT_SIDES[d].includes(side)) return cutType[i];
      return code[i];
    };
    const segs = [];
    const addSeg = (ax, az, bx, bz, nx, nz, top = P.WALL_H, kind = 'rail') => segs.push({ ax, az, bx, bz, nx, nz, top, kind });
    const SIDES = [['N', 0, -1, 'S'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E'], ['E', 1, 0, 'W']];
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (!solid(code[i])) continue;
        for (const [side, dx, dz, opp] of SIDES) {
          if (diag[i] && CUT_SIDES[diag[i]].includes(side)) continue;
          const other = edgeKind(x + dx, z + dz, opp);
          const wall = other === VOID || (other === WATER && railed[i]);
          if (!wall) continue;
          // the edge, with the normal pointing back into this tile
          if (side === 'N') addSeg(x, z, x + 1, z, 0, 1);
          if (side === 'S') addSeg(x, z + 1, x + 1, z + 1, 0, -1);
          if (side === 'W') addSeg(x, z, x, z + 1, 1, 0);
          if (side === 'E') addSeg(x + 1, z, x + 1, z + 1, -1, 0);
        }
        const d = diag[i];
        if (d && (cutType[i] === VOID || (cutType[i] === WATER && railed[i]))) {
          const s = Math.SQRT1_2;
          if (d === 7) addSeg(x + 1, z, x, z + 1, s, s);
          if (d === 9) addSeg(x, z, x + 1, z + 1, -s, s);
          if (d === 1) addSeg(x, z, x + 1, z + 1, s, -s);
          if (d === 3) addSeg(x + 1, z, x, z + 1, -s, -s);
        }
      }
    }
    // join rail pieces that continue in a straight line
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < segs.length; i++) {
        for (let j = 0; j < segs.length; j++) {
          if (i === j) continue;
          const a = segs[i]; const b = segs[j];
          if (a.nx !== b.nx || a.nz !== b.nz || a.top !== b.top) continue;
          const dax = a.bx - a.ax; const daz = a.bz - a.az; const dbx = b.bx - b.ax; const dbz = b.bz - b.az;
          if (Math.abs(dax * dbz - daz * dbx) > 1e-9) continue;
          let joined = null;
          if (a.bx === b.ax && a.bz === b.az && dax * dbx + daz * dbz > 0) joined = [a.ax, a.az, b.bx, b.bz];
          else if (a.ax === b.bx && a.az === b.bz && dax * dbx + daz * dbz > 0) joined = [b.ax, b.az, a.bx, a.bz];
          else if (a.bx === b.bx && a.bz === b.bz && dax * dbx + daz * dbz < 0) joined = [a.ax, a.az, b.ax, b.az];
          else if (a.ax === b.ax && a.az === b.az && dax * dbx + daz * dbz < 0) joined = [a.bx, a.bz, b.bx, b.bz];
          if (joined) {
            [a.ax, a.az, a.bx, a.bz] = joined;
            segs.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    for (const s of segs) H.walls.push(s);

    // blocks (rectangles you can't go through)
    const addBlock = (x0, z0, x1, z1, style, top = 1.4, opts = {}) => {
      const b = { x0, z0, x1, z1, style, top, ...opts };
      H.blocks.push(b);
      H.walls.push({ ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: -1, top, kind: 'block' });
      H.walls.push({ ax: x0, az: z1, bx: x1, bz: z1, nx: 0, nz: 1, top, kind: 'block' });
      H.walls.push({ ax: x0, az: z0, bx: x0, bz: z1, nx: -1, nz: 0, top, kind: 'block' });
      H.walls.push({ ax: x1, az: z0, bx: x1, bz: z1, nx: 1, nz: 0, top, kind: 'block' });
      return b;
    };
    for (const b of hd.blocks || []) addBlock(b[0], b[1], b[2], b[3], b[4] || 'rock', b[4] === 'house' ? 6 : b[4] === 'tomb' ? 1.1 : 1.4);
    for (const b of hd.bumpers || []) H.bumpers.push({ x: b[0], z: b[1], r: b[2], e: hd.bumperE || P.BUMP_E });

    // moving obstacles
    for (const m of hd.movers || []) {
      if (m.k === 'windmill') {
        const f = m.face || 1;
        const z0 = m.z - m.d / 2; const z1 = m.z + m.d / 2;
        addBlock(m.x - m.span, z0, m.x - m.w / 2, z1, 'mill', 5, { hidden: true });
        addBlock(m.x + m.w / 2, z0, m.x + m.span, z1, 'mill', 5, { hidden: true });
        H.movers.push({ ...m, k: 'windmill', hw: m.w / 2, hd: 0.16, cz: m.z + f * (m.d / 2 + 0.18), blades: m.blades || 4 });
      } else if (m.k === 'slide') {
        H.movers.push({ ...m, hw: m.w / 2, hd: m.d / 2 });
      } else if (m.k === 'swing') {
        H.movers.push({ ...m, hw: m.w / 2, hd: m.d / 2 });
      } else if (m.k === 'spin') {
        H.movers.push({ ...m, hw: m.len / 2, hd: (m.w || 0.3) / 2 });
      }
    }
    for (const t of hd.tele || []) {
      const l = Math.hypot(t.dir[0], t.dir[1]);
      H.tele.push({ fx: t.from[0], fz: t.from[1], r: t.r || 0.42, tx: t.to[0], tz: t.to[1], dx: t.dir[0] / l, dz: t.dir[1] / l, style: t.style, boo: !!t.boo });
    }

    // a grid of which walls and bumpers are near each tile, so the physics only checks those
    H.near = new Array(W * D + 1);
    for (let i = 0; i < H.near.length; i++) H.near[i] = { w: [], b: [] };
    const pad = P.R + 0.25;
    const cellsOf = (x0, z0, x1, z1, fn) => {
      for (let z = Math.max(0, Math.floor(z0 - pad)); z <= Math.min(D - 1, Math.floor(z1 + pad)); z++) {
        for (let x = Math.max(0, Math.floor(x0 - pad)); x <= Math.min(W - 1, Math.floor(x1 + pad)); x++) fn(H.near[z * W + x]);
      }
    };
    H.walls.forEach((s, i) => {
      s.len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      cellsOf(Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz), (c) => c.w.push(i));
    });
    H.bumpers.forEach((b, i) => cellsOf(b.x - b.r, b.z - b.r, b.x + b.r, b.z + b.r, (c) => c.b.push(i)));
    // the period after which every moving thing is back where it started (for the solver)
    H.cycle = H.movers.reduce((m, o) => Math.max(m, o.period || 0), 0);
    hd._built = H;
    return H;
  }

  // ------------------------------------------------------------------ the ground
  /** Which kind of ground is at a point: VOID, TURF, SAND, WATER or GAP. */
  function floorAt(H, x, z) {
    const ix = Math.floor(x); const iz = Math.floor(z);
    if (ix < 0 || iz < 0 || ix >= H.W || iz >= H.D) return VOID;
    const i = iz * H.W + ix;
    const d = H.diag[i];
    if (d) {
      const fx = x - ix; const fz = z - iz;
      const cut = d === 7 ? fx + fz < 1 : d === 9 ? fz < fx : d === 1 ? fx < fz : fx + fz > 1;
      if (cut) return H.cutType[i];
    }
    return H.code[i];
  }
  const surf = { h: 0, gx: 0, gz: 0 };
  /** Height of the turf at a point and its slope (gx, gz = how fast it rises along x and z). */
  function surface(H, x, z, out = surf) {
    let h = 0; let gx = 0; let gz = 0;
    const E = 1e-6;
    for (const f of H.hf) {
      if (f.t === 'flat') {
        if (x >= f.x0 - E && x <= f.x1 + E && z >= f.z0 - E && z <= f.z1 + E) { h = f.h; gx = 0; gz = 0; }
      } else if (f.t === 'ramp') {
        if (x >= f.x0 - E && x <= f.x1 + E && z >= f.z0 - E && z <= f.z1 + E) {
          if (f.axis === 'z') { const k = (f.b - f.a) / (f.z1 - f.z0); h = f.a + (z - f.z0) * k; gx = 0; gz = k; } else { const k = (f.b - f.a) / (f.x1 - f.x0); h = f.a + (x - f.x0) * k; gx = k; gz = 0; }
        }
      } else if (f.t === 'hill') {
        const dx = x - f.x; const dz = z - f.z; const d = Math.hypot(dx, dz);
        if (d < f.r) {
          h += f.h * (0.5 + 0.5 * Math.cos(Math.PI * d / f.r));
          if (d > 1e-9) { const g = -f.h * 0.5 * Math.sin(Math.PI * d / f.r) * Math.PI / f.r / d; gx += g * dx; gz += g * dz; }
        }
      } else if (f.t === 'ring') {
        const dx = x - f.x; const dz = z - f.z; const d = Math.hypot(dx, dz); const u = d - f.R;
        if (Math.abs(u) < f.w) {
          h += f.h * (0.5 + 0.5 * Math.cos(Math.PI * u / f.w));
          if (d > 1e-9) { const g = -f.h * 0.5 * Math.sin(Math.PI * u / f.w) * Math.PI / f.w / d; gx += g * dx; gz += g * dz; }
        }
      }
    }
    out.h = h; out.gx = gx; out.gz = gz;
    return out;
  }
  const heightAt = (H, x, z) => surface(H, x, z, {}).h;

  // ------------------------------------------------------------------ moving obstacles
  /** Where a moving obstacle is at time t: centre, angle, half sizes, and whether it blocks right now. */
  function moverPose(m, t, out = {}) {
    out.hw = m.hw; out.hd = m.hd; out.a = 0; out.on = true;
    if (m.k === 'windmill') {
      const th = (t / m.period) * Math.PI * 2 + (m.phase || 0);
      const step = (Math.PI * 2) / m.blades;
      const rel = ((th % step) + step) % step;
      out.x = m.x; out.z = m.cz; out.th = th;
      out.on = rel < 0.32 || rel > step - 0.32;       // a blade is pointing down into the tunnel mouth
    } else if (m.k === 'slide') {
      const k = 0.5 - 0.5 * Math.cos((t / m.period) * Math.PI * 2 + (m.phase || 0));
      out.x = m.x0 + (m.x1 - m.x0) * k; out.z = m.z0 + (m.z1 - m.z0) * k;
    } else if (m.k === 'swing') {
      const s = Math.sin((t / m.period) * Math.PI * 2 + (m.phase || 0));
      out.x = m.x + m.amp * s; out.z = m.z; out.swing = s;
    } else if (m.k === 'spin') {
      out.x = m.x; out.z = m.z; out.a = (t / m.period) * Math.PI * 2 + (m.phase || 0);
    }
    return out;
  }

  // ------------------------------------------------------------------ the ball
  function newBall(H, at) {
    const [x, z] = at || H.tee;
    return { x, z, y: surface(H, x, z).h, vx: 0, vy: 0, vz: 0, state: 'rest', why: null, tc: 0, ev: null };
  }
  const cloneBall = (b) => ({ x: b.x, z: b.z, y: b.y, vx: b.vx, vy: b.vy, vz: b.vz, state: b.state, why: b.why, tc: b.tc, ev: null });
  /** Hit the ball: angle in radians (0 = +x, π/2 = +z), power 0..1. */
  function hit(b, angle, power) {
    const v = Math.max(0.04, Math.min(1, power)) * P.VMAX;
    b.vx = Math.cos(angle) * v; b.vz = Math.sin(angle) * v; b.vy = 0;
    b.state = 'roll';
  }
  const emit = (b, e) => { if (b.ev) b.ev.push(e); };

  const pa = {}; const pb = {};
  function collide(H, b, t, dt) {
    const air = b.state === 'air';
    const R = P.R;
    const ix = Math.floor(b.x); const iz = Math.floor(b.z);
    const cell = ix >= 0 && iz >= 0 && ix < H.W && iz < H.D ? H.near[iz * H.W + ix] : null;
    if (cell) {
      for (const wi of cell.w) {
        const s = H.walls[wi];
        const ex = s.bx - s.ax; const ez = s.bz - s.az;
        let u = ((b.x - s.ax) * ex + (b.z - s.az) * ez) / (s.len * s.len);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const px = s.ax + ex * u; const pz = s.az + ez * u;
        let dx = b.x - px; let dz = b.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (air && b.y > surface(H, px + s.nx * 0.05, pz + s.nz * 0.05, pa).h + s.top) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-9) { dx = s.nx; dz = s.nz; d = 1; } else { dx /= d; dz /= d; }
        // a ball that somehow got behind a rail goes back to the turf side
        if (dx * s.nx + dz * s.nz < 0 && u > 0 && u < 1) { dx = s.nx; dz = s.nz; d = -d; }
        b.x = px + dx * R; b.z = pz + dz * R;
        const vn = b.vx * dx + b.vz * dz;
        if (vn < 0) {
          b.vx -= (1 + P.WALL_E) * vn * dx; b.vz -= (1 + P.WALL_E) * vn * dz;
          if (vn < -0.6) emit(b, ['wall', -vn]);
        }
      }
      for (const bi of cell.b) {
        const o = H.bumpers[bi];
        let dx = b.x - o.x; let dz = b.z - o.z;
        const rr = o.r + R;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        if (air && b.y > surface(H, o.x, o.z, pa).h + 0.6) continue;
        const d = Math.sqrt(d2) || 1e-6; dx /= d; dz /= d;
        b.x = o.x + dx * rr; b.z = o.z + dz * rr;
        const vn = b.vx * dx + b.vz * dz;
        if (vn < 0) {
          b.vx -= (1 + o.e) * vn * dx; b.vz -= (1 + o.e) * vn * dz;
          emit(b, ['bump', -vn, bi]);
        }
      }
    }
    for (let mi = 0; mi < H.movers.length; mi++) {
      const m = H.movers[mi];
      const A = moverPose(m, t, pa);
      if (!A.on) continue;
      if (air && b.y > 1.2) continue;
      const ca = Math.cos(A.a); const sa = Math.sin(A.a);
      const rx = b.x - A.x; const rz = b.z - A.z;
      const lx = rx * ca + rz * sa; const lz = -rx * sa + rz * ca;
      if (Math.abs(lx) > A.hw + R || Math.abs(lz) > A.hd + R) continue;
      let qx = lx < -A.hw ? -A.hw : lx > A.hw ? A.hw : lx;
      let qz = lz < -A.hd ? -A.hd : lz > A.hd ? A.hd : lz;
      let nx; let nz; let depth;
      if (qx === lx && qz === lz) {
        // the centre is inside: out through the nearest side
        const px = A.hw - Math.abs(lx); const pz = A.hd - Math.abs(lz);
        if (px < pz) { nx = lx < 0 ? -1 : 1; nz = 0; qx = nx * A.hw; depth = px + R; } else { nx = 0; nz = lz < 0 ? -1 : 1; qz = nz * A.hd; depth = pz + R; }
      } else {
        const dx = lx - qx; const dz = lz - qz;
        const d = Math.hypot(dx, dz);
        if (d >= R) continue;
        nx = dx / d; nz = dz / d; depth = R - d;
      }
      // back to world space
      const wnx = nx * ca - nz * sa; const wnz = nx * sa + nz * ca;
      b.x += wnx * depth; b.z += wnz * depth;
      // how fast that bit of the obstacle is moving
      const B = moverPose(m, t + dt, pb);
      const cb = Math.cos(B.a); const sb = Math.sin(B.a);
      const wx0 = A.x + qx * ca - qz * sa; const wz0 = A.z + qx * sa + qz * ca;
      const wx1 = B.x + qx * cb - qz * sb; const wz1 = B.z + qx * sb + qz * cb;
      const mvx = (wx1 - wx0) / dt; const mvz = (wz1 - wz0) / dt;
      const rvx = b.vx - mvx; const rvz = b.vz - mvz;
      const vn = rvx * wnx + rvz * wnz;
      if (vn < 0) {
        b.vx = rvx - (1 + P.MOVER_E) * vn * wnx + mvx;
        b.vz = rvz - (1 + P.MOVER_E) * vn * wnz + mvz;
        if (b.state === 'rest') b.state = 'roll';
        emit(b, ['hitm', -vn, mi]);
      }
    }
  }

  /** Move the ball forward by dt at hole time t. Sets b.state to 'holed' or 'out' (b.why = 'water' / 'gap' / 'oob'). */
  function step(H, b, t, dt = P.DT) {
    if (b.state === 'holed' || b.state === 'out') return;
    if (b.tc > 0) b.tc -= dt;
    const s = surface(H, b.x, b.z, pa);
    if (b.state === 'air') {
      b.vy -= P.G * dt;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      const f = floorAt(H, b.x, b.z);
      if (solid(f)) {
        const hh = surface(H, b.x, b.z, pb).h;
        if (b.y <= hh) {
          b.y = hh;
          if (b.vy < -2.6) { b.vy = -b.vy * 0.32; b.vx *= 0.9; b.vz *= 0.9; emit(b, ['land', 1]); } else { b.vy = 0; b.state = 'roll'; b.vx *= 0.94; b.vz *= 0.94; emit(b, ['land', 0]); }
        }
      } else if (f === WATER && b.y <= P.WATER_Y + 0.12) { out(b, 'water'); return; }
      else if (f === VOID && b.y < -0.3) { out(b, 'oob'); return; }
      if (b.y < P.OUT_Y) { out(b, f === WATER ? 'water' : f === GAP ? 'gap' : 'oob'); return; }
    } else {
      const sand = floorAt(H, b.x, b.z) === SAND;
      const roll = sand ? P.SAND_ROLL : P.ROLL; const drag = sand ? P.SAND_DRAG : P.DRAG;
      const slope = P.G * Math.hypot(s.gx, s.gz);
      if (b.state === 'rest' && slope > roll * 1.05) b.state = 'roll';
      if (b.state === 'roll') {
        b.vx -= P.G * s.gx * dt; b.vz -= P.G * s.gz * dt;
        let sp = Math.hypot(b.vx, b.vz);
        if (sp > 0) {
          const dec = (roll + drag * sp) * dt;
          if (dec >= sp) { b.vx = 0; b.vz = 0; sp = 0; } else { const k = (sp - dec) / sp; b.vx *= k; b.vz *= k; sp -= dec; }
        }
        if (sp > P.VCAP) { b.vx *= P.VCAP / sp; b.vz *= P.VCAP / sp; }
        const vyGround = b.vx * s.gx + b.vz * s.gz;
        b.x += b.vx * dt; b.z += b.vz * dt;
        const f = floorAt(H, b.x, b.z);
        if (!solid(f)) {
          b.state = 'air'; b.vy = Math.max(0, vyGround);
        } else {
          const hh = surface(H, b.x, b.z, pb).h;
          if (hh < b.y - 0.08) { b.state = 'air'; b.vy = Math.max(0, vyGround); } else b.y = hh;
        }
        if (b.state === 'roll' && sp < P.STOP_V && slope <= roll * 1.05) { b.vx = 0; b.vz = 0; b.state = 'rest'; }
      }
    }
    collide(H, b, t, dt);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > P.VCAP) { b.vx *= P.VCAP / sp; b.vz *= P.VCAP / sp; }
    if (b.x < -2 || b.z < -2 || b.x > H.W + 2 || b.z > H.D + 2) { out(b, 'oob'); return; }
    if (b.state !== 'air') {
      // the cup
      const dx = H.cup[0] - b.x; const dz = H.cup[1] - b.z;
      const d = Math.hypot(dx, dz);
      if (d < P.CUP_R) {
        const v = Math.hypot(b.vx, b.vz);
        if (d < P.CUP_R - 0.14 && v < P.CAP_V) { b.state = 'holed'; b.x = H.cup[0]; b.z = H.cup[1]; b.vx = b.vz = 0; emit(b, ['holed']); return; }
        if (d > 1e-6) { b.vx += (dx / d) * P.PULL * dt; b.vz += (dz / d) * P.PULL * dt; }
        if (b.state === 'rest') b.state = 'roll';
        if (!b.lip) { b.lip = true; if (v >= P.CAP_V) emit(b, ['lip']); }
      } else b.lip = false;
      // teleports
      if (b.tc <= 0) {
        for (const tp of H.tele) {
          if (Math.hypot(b.x - tp.fx, b.z - tp.fz) < tp.r) {
            const v = Math.max(2.2, Math.hypot(b.vx, b.vz) * 0.85);
            b.x = tp.tx; b.z = tp.tz; b.y = surface(H, b.x, b.z, pb).h;
            b.vx = tp.dx * v; b.vz = tp.dz * v; b.state = 'roll'; b.tc = 0.5;
            emit(b, ['tele', tp]);
            break;
          }
        }
      }
    }
  }
  function out(b, why) { b.state = 'out'; b.why = why; b.vx = b.vz = b.vy = 0; emit(b, ['out', why]); }

  /** Play one shot to the end. Returns { b, t } — b.state is 'rest', 'holed' or 'out'. */
  function simulateShot(H, ball, t0, angle, power, onStep) {
    const b = cloneBall(ball);
    hit(b, angle, power);
    let t = t0;
    const end = t0 + P.MAX_SHOT_T;
    while (b.state === 'roll' || b.state === 'air') {
      step(H, b, t, P.DT);
      t += P.DT;
      if (onStep) onStep(b, t);
      if (t > end && b.state !== 'holed' && b.state !== 'out') { b.state = 'rest'; b.vx = b.vz = b.vy = 0; break; }
    }
    return { b, t };
  }
  /** Wait w seconds without hitting (moving obstacles may still push a resting ball). */
  function idle(H, ball, t0, w) {
    const b = cloneBall(ball);
    let t = t0;
    const n = Math.round(w / P.DT);
    for (let i = 0; i < n || b.state === 'roll' || b.state === 'air'; i++) {
      step(H, b, t, P.DT);
      t += P.DT;
      if (b.state === 'holed' || b.state === 'out' || i > n + 3600) break;
    }
    return { b, t };
  }

  // ------------------------------------------------------------------ path distance to the cup
  /** Walking distance from every tile to the cup (water and drops cost more; teleports are free). */
  function geodesic(H) {
    if (H._geo) return H._geo;
    const { W, D } = H;
    const dist = new Float64Array(W * D).fill(Infinity);
    const cost = (i) => {
      const c = H.code[i];
      return c === TURF ? 1 : c === SAND ? 2.5 : c === GAP ? 1.6 : c === WATER ? 6 : Infinity;
    };
    const blocked = new Uint8Array(W * D);
    for (const bl of H.blocks) {
      for (let z = Math.floor(bl.z0); z < Math.ceil(bl.z1); z++) for (let x = Math.floor(bl.x0); x < Math.ceil(bl.x1); x++) {
        const cx = x + 0.5; const cz = z + 0.5;
        if (cx > bl.x0 && cx < bl.x1 && cz > bl.z0 && cz < bl.z1 && x >= 0 && z >= 0 && x < W && z < D) blocked[z * W + x] = 1;
      }
    }
    const start = Math.floor(H.cup[1]) * W + Math.floor(H.cup[0]);
    dist[start] = 0;
    const q = [start];
    const teleTo = H.tele.map((tp) => [Math.floor(tp.fz) * W + Math.floor(tp.fx), Math.floor(tp.tz) * W + Math.floor(tp.tx)]);
    // simple Dijkstra (the grids are tiny)
    const done = new Uint8Array(W * D);
    while (q.length) {
      let bi = 0;
      for (let k = 1; k < q.length; k++) if (dist[q[k]] < dist[q[bi]]) bi = k;
      const i = q[bi]; q.splice(bi, 1);
      if (done[i]) continue;
      done[i] = 1;
      const x = i % W; const z = (i / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx; const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const j = nz * W + nx;
        if (blocked[j]) continue;
        const c = cost(j);
        if (c === Infinity) continue;
        if (dx && dz && (cost(z * W + nx) === Infinity || cost(nz * W + x) === Infinity)) continue;
        const nd = dist[i] + c * (dx && dz ? Math.SQRT2 : 1);
        if (nd < dist[j]) { dist[j] = nd; q.push(j); }
      }
      // going backwards through a teleport: its exit tile reaches its entrance tile for free
      for (const [from, to] of teleTo) if (to === i && dist[i] < dist[from]) { dist[from] = dist[i]; q.push(from); }
    }
    H._geo = dist;
    return dist;
  }
  function pathDist(H, x, z) {
    const g = geodesic(H);
    const ix = Math.max(0, Math.min(H.W - 1, Math.floor(x))); const iz = Math.max(0, Math.min(H.D - 1, Math.floor(z)));
    const v = g[iz * H.W + ix];
    if (v === Infinity) return 999;
    if (v === 0) return Math.hypot(x - H.cup[0], z - H.cup[1]);
    return v + 0.5 * Math.hypot(x - ix - 0.5, z - iz - 0.5);
  }
  /** Which way the course goes from a point (towards the cup along the path), for aiming the camera. */
  function pathDir(H, x, z) {
    const g = geodesic(H);
    let bx = H.cup[0]; let bz = H.cup[1];
    let cx = Math.floor(x); let cz = Math.floor(z);
    for (let k = 0; k < 4; k++) {
      const here = g[cz * H.W + cx];
      if (!(here > 0) || here === Infinity) break;
      let best = here; let nx = cx; let nz = cz;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx; const zz = cz + dz;
        if (xx < 0 || zz < 0 || xx >= H.W || zz >= H.D) continue;
        const v = g[zz * H.W + xx];
        if (v < best) { best = v; nx = xx; nz = zz; }
      }
      if (nx === cx && nz === cz) break;
      cx = nx; cz = nz; bx = cx + 0.5; bz = cz + 0.5;
    }
    if (Math.hypot(H.cup[0] - x, H.cup[1] - z) < 4.5 || g[Math.floor(z) * H.W + Math.floor(x)] < 4.5) { bx = H.cup[0]; bz = H.cup[1]; }
    return Math.atan2(bz - z, bx - x);
  }

  // ------------------------------------------------------------------ the solver (for the tests)
  /** Search over shots for a way to hole out in at most maxStrokes. Returns { strokes, shots } or null. */
  function solve(H, maxStrokes, o = {}) {
    const beamW = o.beam || 10;
    const nA = o.angles || 64;
    const powers = o.powers || [0.12, 0.2, 0.28, 0.36, 0.45, 0.55, 0.65, 0.76, 0.88, 1];
    const waits = H.movers.length ? (o.waits || [0, 0.25, 0.5, 0.75].map((k) => k * H.cycle)) : [0];
    let beam = [{ b: newBall(H), t: 0, shots: [], d: pathDist(H, H.tee[0], H.tee[1]) }];
    let tried = 0;
    for (let depth = 1; depth <= maxStrokes; depth++) {
      const best = new Map();
      for (const st of beam) {
        const angles = [];
        for (let k = 0; k < nA; k++) angles.push((k / nA) * Math.PI * 2);
        const aimAt = (x, z, spread) => { const a = Math.atan2(z - st.b.z, x - st.b.x); for (const d of spread) angles.push(a + d); };
        const fine = [0, 0.01, -0.01, 0.025, -0.025, 0.05, -0.05, 0.08, -0.08];
        aimAt(H.cup[0], H.cup[1], fine);
        for (const tp of H.tele) aimAt(tp.fx, tp.fz, [0, 0.03, -0.03, 0.07, -0.07]);
        const cupD = Math.hypot(H.cup[0] - st.b.x, H.cup[1] - st.b.z);
        for (const w of waits) {
          const start = w ? idle(H, st.b, st.t, w) : { b: st.b, t: st.t };
          if (start.b.state !== 'rest') continue;
          for (let ai = 0; ai < angles.length; ai++) {
            const a = angles[ai];
            // aimed straight at the cup: try a finer range of soft putts too
            const ps = ai >= nA && ai < nA + fine.length ? powers.concat([0.06, 0.09, 0.15, 0.24, 0.32, 0.4, 0.5].filter(() => cupD < 14)) : powers;
            for (const p of ps) {
              tried++;
              const r = simulateShot(H, start.b, start.t, a, p);
              const shots = st.shots.concat([{ wait: w, angle: a, power: p }]);
              if (r.b.state === 'holed') return { strokes: depth, shots, tried };
              if (r.b.state !== 'rest') continue;
              const d = pathDist(H, r.b.x, r.b.z);
              const key = `${Math.round(r.b.x * 3)},${Math.round(r.b.z * 3)}` + (H.movers.length ? ',' + Math.floor((r.t % H.cycle) / (H.cycle / 4)) : '');
              const prev = best.get(key);
              if (!prev || prev.d > d) best.set(key, { b: r.b, t: r.t, shots, d });
            }
          }
        }
      }
      beam = [...best.values()].sort((a, b) => a.d - b.d).slice(0, beamW);
      if (!beam.length) return null;
    }
    return null;
  }

  root.GolfCore = { P, COURSES, courseById, par, build, floorAt, surface, heightAt, moverPose, newBall, cloneBall, hit, step,
    simulateShot, idle, geodesic, pathDist, pathDir, solve, VOID, TURF, SAND, WATER, GAP, solid };
})(typeof window !== 'undefined' ? window : globalThis);
