/* Front Wars core — the whole game as a deterministic simulation: the same moves always give
   exactly the same result, on every computer. Solo games run it locally; online games run it
   in every browser while the server only passes everyone's moves around ("lockstep").

   To keep all computers in agreement the simulation only uses + - * / and Math.sqrt on
   numbers (those give identical results everywhere), a seeded random generator, and never
   picks things based on the order a Set happens to be in. */
(function (root) {
  'use strict';

  const TICK_MS = 100;            // one simulation step = 0.1 s
  const SPAWN_TICKS = 120;        // 12 s to pick where you start
  const WIN_SHARE = 0.8;          // own this much of the land to win
  const MAX_BOATS = 3;
  const BOAT_SPEED = 2;           // water tiles per tick
  const NUKE_RADIUS = 8;
  const POST_RADIUS = 7;
  const COST = { city: 12000, post: 6000, silo: 30000, port: 15000, warship: 20000, nuke: 25000 };
  const MAX_WARSHIPS = 4;
  const WARSHIP_RANGE = 6;          // tiles
  const REQUEST_TICKS = 300;       // alliance requests last 30 s
  const BREAK_COOLDOWN = 600;      // no new alliance with someone you just broke up with for 60 s
  const TERRAIN_COST = [0, 10, 16, 26];   // water, plains, hills, mountains
  const SIZES = { small: [180, 112], medium: [240, 150], large: [320, 200] };
  const STYLES = {
    continents: { scale: 44, falloff: 0.45, land: 0.46 },
    islands: { scale: 22, falloff: 0.25, land: 0.36 },
    pangaea: { scale: 70, falloff: 0.8, land: 0.52 },
  };
  const BOT = {
    easy: { every: 26, keep: 0.6, send: 0.16, nerve: 0.55, build: 0.15, posts: false, nukes: false, boats: 0.05, spare: 3, power: 0.7, accept: 0.7, ask: 0.01, betray: false, navy: false },
    medium: { every: 15, keep: 0.45, send: 0.25, nerve: 0.85, build: 0.4, posts: true, nukes: false, boats: 0.2, spare: 1.5, power: 0.85, accept: 0.5, ask: 0.03, betray: false, navy: true },
    hard: { every: 7, keep: 0.28, send: 0.38, nerve: 1.2, build: 0.8, posts: true, nukes: true, boats: 0.5, spare: 1, power: 1, accept: 0.35, ask: 0.04, betray: true, navy: true },
  };
  const COLORS = ['#ff4fd8', '#22d3ee', '#a3e635', '#facc15', '#fb923c', '#f43f5e', '#8b5cf6', '#34d399', '#60a5fa', '#f472b6',
    '#c084fc', '#2dd4bf', '#fbbf24', '#e879f9', '#4ade80', '#f87171', '#38bdf8', '#fde047', '#a78bfa', '#fb7185',
    '#86efac', '#fdba74', '#67e8f9', '#d946ef', '#bef264', '#fca5a5', '#93c5fd', '#f0abfc', '#5eead4', '#fcd34d'];
  const TEAM_COLORS = [['#f43f5e', '#fb7185', '#e11d48', '#fda4af', '#be123c'], ['#3b82f6', '#60a5fa', '#2563eb', '#93c5fd', '#1d4ed8'],
    ['#22c55e', '#4ade80', '#16a34a', '#86efac', '#15803d'], ['#eab308', '#facc15', '#ca8a04', '#fde047', '#a16207']];
  const TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
  const BOT_PLACES = ['Zorbia', 'Pixelton', 'Byteland', 'Mangoria', 'Glitchvale', 'Nebulon', 'Wobbleton', 'Snackistan', 'Fizzmoor', 'Quackland',
    'Bananastan', 'Moonbeam', 'Turbonia', 'Crumbleton', 'Noodleheim', 'Sprocket Isle', 'Yeetopia', 'Cheddaria', 'Bloopshire', 'Zapzania',
    'Grumbleford', 'Pancakia', 'Waffleburg', 'Dinoland', 'Sharkington', 'Bubbleport', 'Taco Coast', 'Frostwick', 'Lavalia', 'Mossgrove',
    'Pebbleton', 'Rocketburg', 'Squidmark', 'Thunderia', 'Velvetia', 'Whiskerton', 'Yodelia', 'Zoomtown', 'Cactus Creek', 'Marshmallo'];
  const BOT_TITLES = ['Kingdom of', 'Empire of', 'Republic of', 'Duchy of', 'Free State of', 'Grand Realm of', 'United Tribes of', 'Principality of'];

  // ------------------------------------------------------------------ random numbers
  function hash32(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return (h ^ (h >>> 15)) >>> 0;
  }
  function rand(g) {   // mulberry32, state kept in the game so it can be saved
    let a = (g.rng = (g.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------------ the map
  function noise(x, y, s) {   // smooth value noise, 0..1
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = x - xi; const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx); const v = fy * fy * (3 - 2 * fy);
    const a = hash32(hash32(xi, yi), s) / 4294967296;
    const b = hash32(hash32(xi + 1, yi), s) / 4294967296;
    const c = hash32(hash32(xi, yi + 1), s) / 4294967296;
    const d = hash32(hash32(xi + 1, yi + 1), s) / 4294967296;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** terrain per tile: 0 water, 1 plains, 2 hills, 3 mountains. Edges are always sea. */
  function makeMap(seed, size, style) {
    const [W, H] = SIZES[size] || SIZES.medium;
    const st = STYLES[style] || STYLES.continents;
    const N = W * H;
    const height = new Float64Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let amp = 1; let freq = 1 / st.scale; let sum = 0; let norm = 0;
        for (let o = 0; o < 5; o++) {
          sum += amp * noise(x * freq + 1000, y * freq + 1000, (seed + o * 1013) | 0);
          norm += amp; amp *= 0.5; freq *= 2;
        }
        const dx = (x / (W - 1) - 0.5) * 2;
        const dy = (y / (H - 1) - 0.5) * 2;
        height[y * W + x] = (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) ? -9 : sum / norm - st.falloff * (dx * dx + dy * dy) * 0.5;
      }
    }
    const sorted = Float64Array.from(height).sort();
    const sea = sorted[Math.floor(N * (1 - st.land))];
    const landH = sorted.subarray(Math.floor(N * (1 - st.land)));
    const hill = landH[Math.floor(landH.length * 0.62)];
    const mount = landH[Math.floor(landH.length * 0.9)];
    const terrain = new Uint8Array(N);
    for (let t = 0; t < N; t++) terrain[t] = height[t] < sea ? 0 : height[t] < hill ? 1 : height[t] < mount ? 2 : 3;
    // tidy up: sink tiny islands, fill tiny lakes
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    for (let t = 0; t < N; t++) {
      if (seen[t]) continue;
      const isLand = terrain[t] > 0;
      let n = 0; let sp = 0; let edge = false;
      const members = [];
      stack[sp++] = t; seen[t] = 1;
      while (sp) {
        const c = stack[--sp];
        members.push(c); n++;
        const x = c % W; const y = (c - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
        for (const m of nb) if (m >= 0 && !seen[m] && (terrain[m] > 0) === isLand) { seen[m] = 1; stack[sp++] = m; }
      }
      if (isLand && n < 30) for (const m of members) terrain[m] = 0;
      else if (!isLand && !edge && n < 20) for (const m of members) terrain[m] = 1;
    }
    let land = 0;
    for (let t = 0; t < N; t++) if (terrain[t]) land++;
    return { W, H, N, terrain, land };
  }

  // ------------------------------------------------------------------ setting up a game
  /** cfg: { seed, size, style, mode: 'ffa'|'teams', teams, difficulty, bots,
              humans: [{ name, color, team }] }  (team 1-based, only in teams mode) */
  function createGame(cfg) {
    const map = makeMap(cfg.seed | 0, cfg.size, cfg.style);
    const g = {
      cfg, W: map.W, H: map.H, N: map.N, terrain: map.terrain, landTotal: map.land,
      owner: new Int16Array(map.N), tick: 0, rng: (cfg.seed ^ 0x5bd1e995) | 0,
      players: [null], attacks: [], boats: [], nukes: [], buildings: [], warships: [], nextId: 1,
      alliances: [], requests: [], broken: [],   // alliances: [a, b, tick]; requests: {from, to, tick}; broken: {k, tick}
      spawnEnd: SPAWN_TICKS, winner: null, track: false, dirty: [], events: [],
    };
    const teams = cfg.mode === 'teams' ? Math.max(2, Math.min(4, cfg.teams | 0)) : 0;
    const used = new Set();
    const teamSize = [0, 0, 0, 0, 0];
    const add = (p) => {
      p.id = g.players.length;
      Object.assign(p, { alive: true, spawned: false, spawnTile: -1, troops: 2500, gold: 0, nCity: 0, nPost: 0, nSilo: 0, nPort: 0 });
      g.players.push(p);
      return p;
    };
    for (const hu of cfg.humans || []) {
      let team = 0;
      if (teams) team = hu.team >= 1 && hu.team <= teams ? hu.team : 1 + teamSize.slice(1, teams + 1).indexOf(Math.min(...teamSize.slice(1, teams + 1)));
      if (teams) teamSize[team]++;
      let color = hu.color && !used.has(hu.color) && !teams ? hu.color : null;
      add({ name: String(hu.name || 'Player').slice(0, 24), human: true, team, color, level: null, uid: hu.uid || null });
      if (color) used.add(color);
    }
    const nBots = Math.max(0, Math.min(60, cfg.bots | 0));
    const names = new Set();
    for (let i = 0; i < nBots; i++) {
      let name;
      for (let k = 0; k < 20; k++) {
        name = BOT_TITLES[hash32(cfg.seed, i * 31 + k) % BOT_TITLES.length] + ' ' + BOT_PLACES[hash32(cfg.seed + 7, i * 17 + k) % BOT_PLACES.length];
        if (!names.has(name)) break;
      }
      names.add(name);
      let team = 0;
      if (teams) { team = 1 + teamSize.slice(1, teams + 1).indexOf(Math.min(...teamSize.slice(1, teams + 1))); teamSize[team]++; }
      add({ name: '🤖 ' + name, human: false, team, color: null, level: BOT[cfg.difficulty] ? cfg.difficulty : 'medium', uid: null });
    }
    // colours: team shades in team games, otherwise a palette (humans keep their own colour if it's free)
    let ci = 0; const shade = [0, 0, 0, 0, 0];
    for (const p of g.players) {
      if (!p) continue;
      if (teams) { p.color = TEAM_COLORS[p.team - 1][shade[p.team]++ % 5]; continue; }
      if (p.color) continue;
      while (ci < COLORS.length && used.has(COLORS[ci])) ci++;
      if (ci < COLORS.length) { p.color = COLORS[ci]; used.add(COLORS[ci]); ci++; } else p.color = `hsl(${(p.id * 137) % 360} 75% 62%)`;
    }
    rebuild(g);
    return g;
  }

  /** Caches that can always be worked out again from the main state. */
  function rebuild(g) {
    const P = g.players.length;
    g.count = new Int32Array(P);
    g.sumX = new Float64Array(P);
    g.sumY = new Float64Array(P);
    g.borders = [];
    for (let i = 0; i < P; i++) g.borders.push(new Set());
    g.stamp = new Uint32Array(g.N);
    g.stampN = 0;
    g.mark = new Uint8Array(g.N);
    g.buildingAt = new Map();
    for (const b of g.buildings) g.buildingAt.set(b.tile, b);
    g.allySet = new Set(g.alliances.map(([a, b]) => pairKey(a, b)));
    for (let t = 0; t < g.N; t++) {
      const o = g.owner[t];
      if (!o) continue;
      g.count[o]++; g.sumX[o] += t % g.W; g.sumY[o] += (t / g.W) | 0;
    }
    for (let t = 0; t < g.N; t++) if (g.owner[t] && isBorder(g, t)) g.borders[g.owner[t]].add(t);
  }

  // ------------------------------------------------------------------ tiles
  const xOf = (g, t) => t % g.W;
  const yOf = (g, t) => (t / g.W) | 0;
  function isBorder(g, t) {
    const o = g.owner[t]; const W = g.W; const x = t % W;
    if (x === 0 || x === W - 1 || t < W || t >= g.N - W) return true;
    return g.owner[t - 1] !== o || g.owner[t + 1] !== o || g.owner[t - W] !== o || g.owner[t + W] !== o;
  }
  function refreshBorder(g, t) {
    const o = g.owner[t];
    if (!o) return;
    if (isBorder(g, t)) g.borders[o].add(t); else g.borders[o].delete(t);
  }
  function setOwner(g, t, p) {
    const old = g.owner[t];
    if (old === p) return;
    const x = t % g.W; const y = (t - x) / g.W;
    if (old) { g.count[old]--; g.sumX[old] -= x; g.sumY[old] -= y; g.borders[old].delete(t); }
    g.owner[t] = p;
    if (p) { g.count[p]++; g.sumX[p] += x; g.sumY[p] += y; }
    refreshBorder(g, t);
    const W = g.W;
    if (x > 0) refreshBorder(g, t - 1);
    if (x < W - 1) refreshBorder(g, t + 1);
    if (t >= W) refreshBorder(g, t - W);
    if (t < g.N - W) refreshBorder(g, t + W);
    const b = g.buildingAt.get(t);
    if (b) {
      if (!p) removeBuilding(g, b);
      else { buildingCount(g, b, -1); b.owner = p; buildingCount(g, b, 1); if (g.track) g.events.push({ type: 'capture', b: b.type, tile: t, by: p, from: old }); }
    }
    if (g.track) g.dirty.push(t);
  }
  const pairKey = (a, b) => (a < b ? a * 4096 + b : b * 4096 + a);
  /** Same player, same team, or an alliance (free-for-all). Nobody is allied with empty land (0). */
  const allied = (g, a, b) => a === b || (!!a && !!b && ((g.players[a].team && g.players[a].team === g.players[b].team) || g.allySet.has(pairKey(a, b))));
  const isCoast = (g, t) => {
    const W = g.W; const x = t % W;
    return (x > 0 && !g.terrain[t - 1]) || (x < W - 1 && !g.terrain[t + 1]) || (t >= W && !g.terrain[t - W]) || (t < g.N - W && !g.terrain[t + W]);
  };
  function maxTroops(g, p) {
    const pl = g.players[p];
    return 3000 + g.count[p] * 28 + pl.nCity * 10000;
  }

  // ------------------------------------------------------------------ buildings
  function buildingCount(g, b, d) {
    const p = g.players[b.owner];
    if (!p) return;
    if (b.type === 'city') p.nCity += d; else if (b.type === 'post') p.nPost += d; else if (b.type === 'silo') p.nSilo += d; else if (b.type === 'port') p.nPort += d;
  }
  function removeBuilding(g, b) {
    buildingCount(g, b, -1);
    g.buildingAt.delete(b.tile);
    g.buildings.splice(g.buildings.indexOf(b), 1);
    if (g.track) g.events.push({ type: 'destroyed', b: b.type, tile: b.tile });
  }
  function buildCost(g, p, type) {
    const pl = g.players[p];
    if (type === 'city') return COST.city * (1 + pl.nCity) + 3000 * pl.nCity * pl.nCity;
    if (type === 'post') return COST.post * (1 + Math.floor(pl.nPost / 2));
    if (type === 'silo') return COST.silo * (1 + pl.nSilo);
    if (type === 'port') return COST.port * (1 + pl.nPort);
    return COST[type] || COST.nuke;
  }
  function canBuild(g, p, type, t) {
    if (!(t >= 0 && t < g.N) || g.owner[t] !== p || !g.terrain[t] || !COST[type] || type === 'nuke' || type === 'warship') return false;
    if (type === 'port' && !isCoast(g, t)) return false;   // ports go on the coast
    const x0 = t % g.W; const y0 = (t - x0) / g.W;
    for (const b of g.buildings) {
      const dx = (b.tile % g.W) - x0; const dy = ((b.tile - (b.tile % g.W)) / g.W) - y0;
      if (dx * dx + dy * dy < 9) return false;   // keep buildings a few tiles apart
    }
    return g.players[p].gold >= buildCost(g, p, type);
  }
  function build(g, p, type, t) {
    if (!canBuild(g, p, type, t)) return false;
    g.players[p].gold -= buildCost(g, p, type);
    const b = { id: g.nextId++, type, tile: t, owner: p };
    g.buildings.push(b);
    g.buildingAt.set(t, b);
    buildingCount(g, b, 1);
    if (g.track) g.events.push({ type: 'built', b: type, tile: t, by: p });
    return true;
  }
  function defended(g, t, posts) {
    if (!posts.length) return false;
    const x = t % g.W; const y = (t - x) / g.W;
    for (const b of posts) {
      const dx = (b.tile % g.W) - x; const dy = ((b.tile - (b.tile % g.W)) / g.W) - y;
      if (dx * dx + dy * dy <= POST_RADIUS * POST_RADIUS) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ spawning
  function claimSpawn(g, p, t) {
    const pl = g.players[p];
    if (!(t >= 0 && t < g.N) || !g.terrain[t] || (g.owner[t] && g.owner[t] !== p)) return false;
    if (pl.spawned) {   // moving your start during the spawn phase
      const sx = pl.spawnTile % g.W; const sy = (pl.spawnTile - sx) / g.W;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = sx + dx; const y = sy + dy;
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        if (g.owner[y * g.W + x] === p) setOwner(g, y * g.W + x, 0);
      }
    }
    const cx = t % g.W; const cy = (t - cx) / g.W;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 10) continue;
        const x = cx + dx; const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        const k = y * g.W + x;
        if (g.terrain[k] && !g.owner[k]) setOwner(g, k, p);
      }
    }
    pl.spawned = true;
    pl.spawnTile = t;
    return true;
  }
  /** A random free land tile, as far as possible from everyone who has already started. */
  function randomSpawn(g) {
    let best = -1; let bestD = -1;
    const spots = g.players.filter((q) => q && q.spawned).map((q) => q.spawnTile);
    for (let i = 0; i < 40; i++) {
      const t = Math.floor(rand(g) * g.N);
      if (!g.terrain[t] || g.owner[t]) continue;
      const x = t % g.W; const y = (t - x) / g.W;
      let d = 1e9;
      for (const s of spots) { const dx = (s % g.W) - x; const dy = ((s - (s % g.W)) / g.W) - y; d = Math.min(d, dx * dx + dy * dy); }
      if (d > bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // ------------------------------------------------------------------ attacks
  function sharesBorder(g, p, target) {
    const W = g.W; const own = g.owner; const ter = g.terrain;
    for (const t of g.borders[p]) {
      const x = t % W;
      if (x > 0 && own[t - 1] === target && ter[t - 1]) return true;
      if (x < W - 1 && own[t + 1] === target && ter[t + 1]) return true;
      if (t >= W && own[t - W] === target && ter[t - W]) return true;
      if (t < g.N - W && own[t + W] === target && ter[t + W]) return true;
    }
    return false;
  }
  function launchAttack(g, p, target, troops) {
    if (troops <= 0) return;
    // the target is attacking us at the same time: the two armies fight first
    const back = g.attacks.find((a) => a.att === target && a.target === p);
    if (back) {
      const m = Math.min(back.troops, troops);
      back.troops -= m; troops -= m;
      if (back.troops <= 0) g.attacks.splice(g.attacks.indexOf(back), 1);
      if (troops <= 0) return;
    }
    const same = g.attacks.find((a) => a.att === p && a.target === target);
    if (same) same.troops += troops;
    else g.attacks.push({ id: g.nextId++, att: p, target, troops });
  }
  function stepAttack(g, a) {
    const p = a.att; const T = a.target; const W = g.W; const own = g.owner; const ter = g.terrain;
    const stamp = ++g.stampN; const st = g.stamp; const mark = g.mark;
    const cands = [];
    for (const b of g.borders[p]) {
      const x = b % W;
      const nb0 = x > 0 ? b - 1 : -1; const nb1 = x < W - 1 ? b + 1 : -1; const nb2 = b >= W ? b - W : -1; const nb3 = b < g.N - W ? b + W : -1;
      for (const c of [nb0, nb1, nb2, nb3]) {
        if (c < 0 || own[c] !== T || !ter[c]) continue;
        if (st[c] !== stamp) { st[c] = stamp; mark[c] = 1; cands.push(c); } else mark[c]++;
      }
    }
    if (!cands.length) return false;
    // tiles touched by more of our land go first (smooth fronts), ties broken by a hash of the
    // tile and the tick, so the choice never depends on the order the border was stored in
    const want = Math.min(cands.length, Math.max(2, Math.floor(Math.sqrt(a.troops) / 4)), Math.floor(cands.length / 3) + 3);
    const keys = new Float64Array(cands.length);
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      keys[i] = ((mark[c] * 1048576) + (hash32(c, g.tick + a.id * 7919) & 1048575)) * g.N + c;
    }
    keys.sort();
    const def = T ? g.players[T] : null;
    const density = def ? def.troops / Math.max(1, g.count[T]) : 0;
    const posts = def && def.nPost ? g.buildings.filter((b) => b.type === 'post' && b.owner === T) : [];
    let took = 0;
    for (let i = keys.length - 1; i >= 0 && took < want; i--) {
      const c = keys[i] % g.N;
      let cost = TERRAIN_COST[ter[c]];
      if (def) {
        cost = cost * 1.5 + density * 0.8;
        if (defended(g, c, posts)) cost *= 2.5;
      }
      if (a.troops < cost) break;
      a.troops -= cost;
      if (def) def.troops = Math.max(0, def.troops - density * 0.6);
      setOwner(g, c, p);
      took++;
    }
    a.troops = Math.floor(a.troops);
    if (def) def.troops = Math.floor(def.troops);
    return took > 0;
  }

  // ------------------------------------------------------------------ boats
  /** Where a boat aimed at tile t comes ashore (t itself if it's on the coast). */
  function landingTile(g, p, t) {
    if (!(t >= 0 && t < g.N) || !g.terrain[t]) return -1;
    if (isCoast(g, t)) return allied(g, p, g.owner[t]) ? -1 : t;
    // nearest coast tile that isn't ours, searching over land
    const stamp = ++g.stampN; const st = g.stamp; const W = g.W;
    let q = [t]; st[t] = stamp;
    for (let r = 0; r < 25 && q.length; r++) {
      let best = -1;
      for (const c of q) if (isCoast(g, c) && !allied(g, p, g.owner[c]) && (best < 0 || c < best)) best = c;
      if (best >= 0) return best;
      const next = [];
      for (const c of q) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (n < 0 || n >= g.N || st[n] === stamp || !g.terrain[n]) continue;
          st[n] = stamp; next.push(n);
        }
      }
      q = next;
    }
    return -1;
  }
  /** Water path from our coast to the water next to `land`. */
  function boatPath(g, p, land) {
    const W = g.W; const N = g.N; const own = g.owner; const ter = g.terrain;
    const stamp = ++g.stampN; const st = g.stamp;
    const prev = new Int32Array(N);
    let q = [];
    const x0 = land % W;
    for (const n of [x0 > 0 ? land - 1 : -1, x0 < W - 1 ? land + 1 : -1, land - W, land + W]) {
      if (n >= 0 && n < N && !ter[n] && st[n] !== stamp) { st[n] = stamp; prev[n] = -1; q.push(n); }
    }
    while (q.length) {
      // the first water tile (lowest index on this ring) that touches our land is the start
      let start = -1;
      for (const c of q) {
        const x = c % W;
        if ((x > 0 && own[c - 1] === p) || (x < W - 1 && own[c + 1] === p) || (c >= W && own[c - W] === p) || (c < N - W && own[c + W] === p)) {
          if (start < 0 || c < start) start = c;
        }
      }
      if (start >= 0) {
        const path = [];
        for (let c = start; c !== -1; c = prev[c]) path.push(c);
        return path;
      }
      const next = [];
      for (const c of q) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n < 0 || ter[n] || st[n] === stamp) continue;
          st[n] = stamp; prev[n] = c; next.push(n);
        }
      }
      q = next;
    }
    return null;
  }
  function sendBoat(g, p, t, ratio) {
    const pl = g.players[p];
    if (g.boats.filter((b) => b.owner === p).length >= MAX_BOATS) return false;
    const land = landingTile(g, p, t);
    if (land < 0) return false;
    const path = boatPath(g, p, land);
    if (!path) return false;
    const troops = Math.floor(pl.troops * ratio);
    if (troops < 50) return false;
    pl.troops -= troops;
    g.boats.push({ id: g.nextId++, owner: p, troops, path, i: 0, land });
    if (g.track) g.events.push({ type: 'boat', by: p, tile: land });
    return true;
  }
  function stepBoats(g) {
    for (let k = g.boats.length - 1; k >= 0; k--) {
      const b = g.boats[k];
      b.i += BOAT_SPEED;
      if (b.i < b.path.length - 1) continue;
      g.boats.splice(k, 1);
      const p = b.owner; const L = b.land; const T = g.owner[L];
      if (!g.players[p].alive) continue;
      if (allied(g, p, T)) { g.players[p].troops += b.troops; continue; }
      const def = T ? g.players[T] : null;
      const density = def ? def.troops / Math.max(1, g.count[T]) : 0;
      const cost = TERRAIN_COST[g.terrain[L]] * (def ? 1.5 : 1) + density * 0.8;
      if (b.troops <= cost) continue;
      setOwner(g, L, p);
      if (g.track) g.events.push({ type: 'landed', by: p, tile: L });
      launchAttack(g, p, T, Math.floor(b.troops - cost));
    }
  }

  // ------------------------------------------------------------------ nukes
  function launchNuke(g, p, t) {
    const pl = g.players[p];
    if (!(t >= 0 && t < g.N) || pl.gold < COST.nuke || !pl.nSilo) return false;
    if (g.owner[t] && g.owner[t] !== p && allied(g, p, g.owner[t])) return false;   // never nuke your team
    const tx = t % g.W; const ty = (t - tx) / g.W;
    let from = null; let best = 1e18;
    for (const b of g.buildings) {
      if (b.type !== 'silo' || b.owner !== p) continue;
      const dx = (b.tile % g.W) - tx; const dy = ((b.tile - (b.tile % g.W)) / g.W) - ty;
      if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; from = b; }
    }
    if (!from) return false;
    pl.gold -= COST.nuke;
    const flight = Math.max(20, Math.floor(Math.sqrt(best) / 2.2));
    g.nukes.push({ id: g.nextId++, owner: p, from: from.tile, to: t, t0: g.tick, t1: g.tick + flight });
    if (g.track) g.events.push({ type: 'launch', by: p, tile: t });
    return true;
  }
  function stepNukes(g) {
    for (let k = g.nukes.length - 1; k >= 0; k--) {
      const n = g.nukes[k];
      if (g.tick < n.t1) continue;
      g.nukes.splice(k, 1);
      const cx = n.to % g.W; const cy = (n.to - cx) / g.W;
      const lost = new Map();
      const R = NUKE_RADIUS;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          const x = cx + dx; const y = cy + dy;
          if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
          const t = y * g.W + x;
          const o = g.owner[t];
          if (!o || allied(g, n.owner, o) && o !== n.owner) continue;
          if (d2 > 36 && rand(g) < 0.5) continue;   // ragged edge
          lost.set(o, (lost.get(o) || 0) + 1);
          setOwner(g, t, 0);
        }
      }
      for (const b of g.buildings.slice()) {
        const dx = (b.tile % g.W) - cx; const dy = ((b.tile - (b.tile % g.W)) / g.W) - cy;
        if (dx * dx + dy * dy <= R * R && !allied(g, n.owner, b.owner)) removeBuilding(g, b);
      }
      g.warships = g.warships.filter((w) => {
        const t = shipAt(w); const dx = (t % g.W) - cx; const dy = ((t - (t % g.W)) / g.W) - cy;
        return dx * dx + dy * dy > R * R || allied(g, n.owner, w.owner) && w.owner !== n.owner;
      });
      for (const [o, tiles] of lost) {
        const pl = g.players[o];
        const before = g.count[o] + tiles;
        pl.troops = Math.max(0, Math.floor(pl.troops - (pl.troops * tiles * 1.5) / Math.max(1, before)));
      }
      if (g.track) g.events.push({ type: 'nuke', by: n.owner, tile: n.to });
    }
  }

  // ------------------------------------------------------------------ alliances (free-for-all only)
  function requestAlliance(g, p, q) {
    const Q = g.players[q];
    if (g.cfg.mode === 'teams' || !Q || p === q || !Q.alive || !Q.spawned || allied(g, p, q)) return;
    if (g.broken.some((x) => x.k === pairKey(p, q) && g.tick - x.tick < BREAK_COOLDOWN)) return;
    if (g.requests.some((r) => r.from === q && r.to === p)) { formAlliance(g, p, q); return; }   // they asked us too: deal!
    if (g.requests.some((r) => r.from === p && r.to === q) || g.requests.filter((r) => r.from === p).length >= 3) return;
    g.requests.push({ from: p, to: q, tick: g.tick });
    if (g.track) g.events.push({ type: 'request', from: p, to: q });
  }
  function formAlliance(g, a, b) {
    g.requests = g.requests.filter((r) => !((r.from === a && r.to === b) || (r.from === b && r.to === a)));
    g.alliances.push([Math.min(a, b), Math.max(a, b), g.tick]);
    g.allySet.add(pairKey(a, b));
    // stop fighting: attacks between the new allies end and the troops go home
    for (let i = g.attacks.length - 1; i >= 0; i--) {
      const x = g.attacks[i];
      if ((x.att === a && x.target === b) || (x.att === b && x.target === a)) { g.players[x.att].troops += x.troops; g.attacks.splice(i, 1); }
    }
    if (g.track) g.events.push({ type: 'allied', a, b });
  }
  function breakAlliance(g, p, q) {
    const k = pairKey(p, q);
    const i = g.alliances.findIndex(([a, b]) => pairKey(a, b) === k);
    if (i < 0) return;
    g.alliances.splice(i, 1);
    g.allySet.delete(k);
    g.broken.push({ k, tick: g.tick });
    if (g.track) g.events.push({ type: 'betrayed', by: p, of: q });
  }
  function declineAlliance(g, p, from) {
    const before = g.requests.length;
    g.requests = g.requests.filter((r) => !(r.from === from && r.to === p));
    if (g.track && g.requests.length < before) g.events.push({ type: 'declined', by: p, of: from });
  }
  const alliesOf = (g, p) => g.alliances.filter(([a, b]) => a === p || b === p).map(([a, b]) => (a === p ? b : a));

  // ------------------------------------------------------------------ warships
  /** Water path from `from` to `to` (both water), or null. */
  function waterPath(g, from, to) {
    const W = g.W; const N = g.N; const ter = g.terrain;
    const stamp = ++g.stampN; const st = g.stamp;
    const prev = new Int32Array(N);
    let q = [from]; st[from] = stamp; prev[from] = -1;
    while (q.length) {
      if (st[to] === stamp) break;
      const next = [];
      for (const c of q) {
        const x = c % W;
        for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c < N - W ? c + W : -1]) {
          if (n < 0 || ter[n] || st[n] === stamp) continue;
          st[n] = stamp; prev[n] = c; next.push(n);
        }
      }
      q = next;
    }
    if (st[to] !== stamp) return null;
    const path = [];
    for (let c = to; c !== -1; c = prev[c]) path.push(c);
    return path.reverse();
  }
  /** Where a new warship for p heading to t would start and its route, or null if it can't get there. */
  function warshipRoute(g, p, t) {
    if (!(t >= 0 && t < g.N) || g.terrain[t] || !g.players[p].nPort) return null;
    const tx = t % g.W; const ty = (t - tx) / g.W;
    let port = null; let best = 1e18;
    for (const b of g.buildings) {
      if (b.type !== 'port' || b.owner !== p) continue;
      const dx = (b.tile % g.W) - tx; const dy = ((b.tile - (b.tile % g.W)) / g.W) - ty;
      if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; port = b; }
    }
    if (!port) return null;
    const W = g.W; const c = port.tile; const x = c % W;
    const start = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W].find((n) => n >= 0 && n < g.N && !g.terrain[n]);
    if (start === undefined) return null;
    return waterPath(g, start, t);
  }
  function sendWarship(g, p, t) {
    const pl = g.players[p];
    if (!(t >= 0 && t < g.N) || g.terrain[t] || !pl.nPort || pl.gold < COST.warship) return false;
    if (g.warships.filter((w) => w.owner === p).length >= MAX_WARSHIPS) return false;
    const path = warshipRoute(g, p, t);
    if (!path) return false;
    const start = path[0];
    pl.gold -= COST.warship;
    g.warships.push({ id: g.nextId++, owner: p, path, i: 0, hp: 100, cd: 0 });
    if (g.track) g.events.push({ type: 'warship', by: p, tile: start });
    return true;
  }
  const shipAt = (w) => w.path[Math.min(w.i, w.path.length - 1)];
  const boatAt = (b) => b.path[Math.min(b.i, b.path.length - 1)];
  function stepWarships(g) {
    const W = g.W; const R2 = WARSHIP_RANGE * WARSHIP_RANGE;
    for (const w of g.warships) if (w.i < w.path.length - 1) w.i++;
    for (const w of g.warships) {
      if (w.hp <= 0) continue;
      if (w.cd > 0) { w.cd--; continue; }
      const at = shipAt(w); const x = at % W; const y = (at - x) / W;
      const near = (t) => { const dx = (t % W) - x; const dy = ((t - (t % W)) / W) - y; return dx * dx + dy * dy; };
      // sink enemy boats full of troops first
      let target = null; let best = R2 + 1;
      for (const b of g.boats) {
        if (b.troops <= 0 || allied(g, w.owner, b.owner)) continue;
        const d = near(boatAt(b));
        if (d <= R2 && d < best) { best = d; target = b; }
      }
      if (target) {
        target.troops -= 800;
        w.cd = 8;
        if (g.track) g.events.push({ type: 'shot', from: at, to: boatAt(target), by: w.owner });
        if (target.troops <= 0 && g.track) g.events.push({ type: 'sunk', what: 'boat', tile: boatAt(target), by: w.owner, of: target.owner });
        continue;
      }
      // then fight enemy warships
      let foe = null; best = R2 + 1;
      for (const v of g.warships) {
        if (v === w || v.hp <= 0 || allied(g, w.owner, v.owner)) continue;
        const d = near(shipAt(v));
        if (d <= R2 && d < best) { best = d; foe = v; }
      }
      if (foe) {
        foe.hp -= 25;
        w.cd = 10;
        if (g.track) g.events.push({ type: 'shot', from: at, to: shipAt(foe), by: w.owner });
        if (foe.hp <= 0 && g.track) g.events.push({ type: 'sunk', what: 'warship', tile: shipAt(foe), by: w.owner, of: foe.owner });
      }
    }
    g.boats = g.boats.filter((b) => b.troops > 0);
    g.warships = g.warships.filter((w) => w.hp > 0);
  }

  // ------------------------------------------------------------------ moves from players
  /** it: { k: 'spawn'|'attack'|'boat'|'build'|'nuke'|'warship'|'ally'|'unally'|'decline'|'cheat',
            t: tile, r: percent, b: building, p: another player } */
  function applyIntent(g, p, it) {
    const pl = g.players[p];
    if (!pl || !it || typeof it !== 'object') return;
    const t = it.t | 0;
    if (it.k === 'spawn') {
      if (g.tick <= g.spawnEnd && pl.human) claimSpawn(g, p, t);
      return;
    }
    if (it.k === 'cheat') {   // admin testing cheats (sent by the server, so everyone applies them)
      if (it.c === 'troops') pl.troops += 50000;
      else if (it.c === 'gold') pl.gold += 100000;
      return;
    }
    if (g.tick <= g.spawnEnd || !pl.alive || !pl.spawned) return;
    const ratio = Math.max(1, Math.min(100, it.r | 0)) / 100;
    if (it.k === 'attack') {
      if (!(t >= 0 && t < g.N) || !g.terrain[t]) return;
      const T = g.owner[t];
      if (T === p || allied(g, p, T) || (T && !g.players[T].alive)) return;
      if (!sharesBorder(g, p, T)) return;
      const troops = Math.floor(pl.troops * ratio);
      if (troops < 1) return;
      pl.troops -= troops;
      launchAttack(g, p, T, troops);
    } else if (it.k === 'boat') sendBoat(g, p, t, ratio);
    else if (it.k === 'build') build(g, p, it.b, t);
    else if (it.k === 'nuke') launchNuke(g, p, t);
    else if (it.k === 'warship') sendWarship(g, p, t);
    else if (it.k === 'ally') requestAlliance(g, p, it.p | 0);
    else if (it.k === 'unally') breakAlliance(g, p, it.p | 0);
    else if (it.k === 'decline') declineAlliance(g, p, it.p | 0);
  }

  // ------------------------------------------------------------------ bots
  function botThink(g, p) {
    const pl = g.players[p];
    const k = BOT[pl.level] || BOT.medium;
    const W = g.W; const own = g.owner; const ter = g.terrain;
    const max = maxTroops(g, p);
    // who do we touch? (shared border length per neighbour, and one tile of theirs to aim at)
    const shared = new Map(); const aim = new Map();
    let coast = false;
    for (const b of g.borders[p]) {
      const x = b % W;
      for (const c of [x > 0 ? b - 1 : -1, x < W - 1 ? b + 1 : -1, b - W, b + W]) {
        if (c < 0 || c >= g.N) continue;
        if (!ter[c]) { coast = true; continue; }
        const o = own[c];
        if (o === p) continue;
        shared.set(o, (shared.get(o) || 0) + 1);
        if (!aim.has(o) || c < aim.get(o)) aim.set(o, c);
      }
    }
    // spend gold
    if (pl.gold >= buildCost(g, p, 'city') && pl.nCity < 1 + g.count[p] / 250 && rand(g) < k.build) build(g, p, 'city', homeTile(g, p));
    if (k.posts && pl.gold >= buildCost(g, p, 'post') * 1.5) {
      let threat = 0; let worst = 0;
      for (const [o] of shared) if (o && !allied(g, p, o) && g.players[o].troops > threat) { threat = g.players[o].troops; worst = o; }
      if (worst && threat > pl.troops * 1.3 && rand(g) < 0.3) build(g, p, 'post', g.borders[p].size ? nearTile(g, p, aim.get(worst)) : -1);
    }
    if (k.nukes && g.tick > g.spawnEnd + 1200) {
      if (!pl.nSilo && pl.gold >= COST.silo * 1.4 && rand(g) < 0.2) build(g, p, 'silo', homeTile(g, p));
      else if (pl.nSilo && pl.gold >= COST.nuke && rand(g) < 0.25) {
        let big = 0; let bigTroops = 0;
        for (const [o] of shared) if (o && !allied(g, p, o) && g.players[o].troops > bigTroops) { bigTroops = g.players[o].troops; big = o; }
        if (big) {
          const t = centerTile(g, big);
          if (t >= 0) launchNuke(g, p, t);
        }
      }
    }
    // the weakest enemy next to us
    let target = 0; let weakest = Infinity;
    for (const [o] of shared) {
      if (!o || allied(g, p, o)) continue;
      const e = g.players[o];
      const score = e.troops * (e.human ? k.spare : 1);   // easier bots go easier on real players
      if (score < weakest) { weakest = score; target = o; }
    }
    // alliances (free-for-all): answer requests, ask a scary neighbour, and hard bots sometimes betray
    if (g.cfg.mode !== 'teams') {
      const mine = alliesOf(g, p);
      for (const r of g.requests) {
        if (r.to !== p) continue;
        if (mine.length < 2 && g.players[r.from].troops >= pl.troops * 0.5 && rand(g) < k.accept) { formAlliance(g, p, r.from); break; }
        if (rand(g) < 0.25) { declineAlliance(g, p, r.from); break; }
      }
      if (mine.length < 2 && rand(g) < k.ask) {
        let scary = 0; let most = pl.troops * 1.3;
        for (const [o] of shared) if (o && !allied(g, p, o) && g.players[o].troops > most) { most = g.players[o].troops; scary = o; }
        if (scary) requestAlliance(g, p, scary);
      }
      if (k.betray && !target && !shared.has(0)) {
        for (const [a, b, since] of g.alliances) {
          if (a !== p && b !== p) continue;
          const q = a === p ? b : a;
          if (shared.has(q) && g.tick - since > 600 && pl.troops > g.players[q].troops * 2.5 && rand(g) < 0.2) { breakAlliance(g, p, q); break; }
        }
      }
    }
    // ports and warships
    if (k.navy && coast) {
      if (!pl.nPort && pl.gold >= COST.port * 1.3 && rand(g) < 0.15) {
        let spot = -1;
        for (const b of g.borders[p]) if (isCoast(g, b) && (spot < 0 || b < spot) && canBuild(g, p, 'port', b)) spot = b;
        if (spot >= 0) build(g, p, 'port', spot);
      } else if (pl.level === 'hard' && pl.nPort && pl.gold >= COST.warship * 2 && rand(g) < 0.08 && g.warships.filter((w) => w.owner === p).length < 2) {
        let spot = -1; let low = 4294967296;
        for (const b of g.borders[p]) {
          if (!isCoast(g, b)) continue;
          const v = hash32(b, g.tick);
          if (v < low) { low = v; spot = b; }
        }
        if (spot >= 0) {
          const x = spot % W;
          const water = [x > 0 ? spot - 1 : -1, x < W - 1 ? spot + 1 : -1, spot - W, spot + W].find((n) => n >= 0 && n < g.N && !ter[n]);
          if (water !== undefined) sendWarship(g, p, water);
        }
      }
    }
    // wait until we have enough troops (unless we're far stronger than who we'd hit)
    if (pl.troops < max * k.keep && !(target && !shared.has(0) && pl.troops > g.players[target].troops * 2.5)) return;
    const busy = (who) => g.attacks.some((a) => a.att === p && a.target === who && a.troops > pl.troops * 0.2);
    if (shared.has(0)) {
      if (!busy(0)) { const n = Math.floor(pl.troops * k.send); pl.troops -= n; launchAttack(g, p, 0, n); }
      return;
    }
    if (target && (pl.troops * k.nerve > g.players[target].troops * 0.6 || pl.troops >= max * 0.95)) {
      if (!busy(target)) { const n = Math.floor(pl.troops * k.send); pl.troops -= n; launchAttack(g, p, target, n); }
      return;
    }
    // nobody to fight by land: take a boat somewhere
    if (coast && !target && rand(g) < k.boats) {
      let best = -1; let bestD = 1e18;
      const c = centerTile(g, p);
      const cx = c >= 0 ? c % W : 0; const cy = c >= 0 ? (c - cx) / W : 0;
      for (let i = 0; i < 30; i++) {
        const t = Math.floor(rand(g) * g.N);
        if (!ter[t] || allied(g, p, own[t]) || !isCoast(g, t)) continue;
        const dx = (t % W) - cx; const dy = ((t - (t % W)) / W) - cy;
        const d = dx * dx + dy * dy + (own[t] ? 400 : 0);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best >= 0) sendBoat(g, p, best, k.send);
    }
  }
  /** The tile at the middle of a player's land (or the nearest one of theirs to it). */
  function centerTile(g, p) {
    if (!g.count[p]) return -1;
    const cx = Math.floor(g.sumX[p] / g.count[p]); const cy = Math.floor(g.sumY[p] / g.count[p]);
    const t = cy * g.W + cx;
    if (g.owner[t] === p) return t;
    let best = -1; let bestD = 1e18;
    for (const b of g.borders[p]) {
      const dx = (b % g.W) - cx; const dy = ((b - (b % g.W)) / g.W) - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && b < best)) { bestD = d; best = b; }
    }
    return best;
  }
  /** Somewhere safe-ish inside a player's land for a new building. */
  function homeTile(g, p) {
    const c = centerTile(g, p);
    if (c < 0) return -1;
    const cx = c % g.W; const cy = (c - cx) / g.W;
    for (let i = 0; i < 25; i++) {
      const x = cx + Math.floor(rand(g) * 21) - 10; const y = cy + Math.floor(rand(g) * 21) - 10;
      if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
      const t = y * g.W + x;
      if (canBuild(g, p, 'city', t) || canBuild(g, p, 'silo', t)) return t;
    }
    return c;
  }
  /** One of our tiles a little way back from `t` (for defense posts). */
  function nearTile(g, p, t) {
    if (t === undefined || t < 0) return -1;
    const x0 = t % g.W; const y0 = (t - x0) / g.W;
    for (let i = 0; i < 20; i++) {
      const x = x0 + Math.floor(rand(g) * 7) - 3; const y = y0 + Math.floor(rand(g) * 7) - 3;
      if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
      if (g.owner[y * g.W + x] === p) return y * g.W + x;
    }
    return -1;
  }

  // ------------------------------------------------------------------ one tick
  /** Advance the game by one tick. intents: [[playerId, move], ...] in the order they arrived. */
  function step(g, intents) {
    if (g.winner) return;
    g.tick++;
    if (g.tick === 1) {
      for (const p of g.players) if (p && !p.human && !claimSpawn(g, p.id, randomSpawn(g))) p.alive = false;   // no room left
    }
    for (const [p, it] of intents || []) applyIntent(g, p | 0, it);
    // the spawn phase ends after a while, or early once every human has picked a spot
    if (g.tick <= g.spawnEnd) {
      const humans = g.players.filter((q) => q && q.human);
      if (g.tick > 20 && humans.every((q) => q.spawned) && g.spawnEnd > g.tick) g.spawnEnd = g.tick;
      if (g.tick === g.spawnEnd) for (const q of humans) if (!q.spawned) claimSpawn(g, q.id, randomSpawn(g));
      return;
    }
    // troops and gold
    for (const pl of g.players) {
      if (!pl || !pl.alive) continue;
      const p = pl.id;
      const max = maxTroops(g, p);
      let add = Math.floor((6 + Math.sqrt(pl.troops) * 1.6) * (1 - pl.troops / max) * (pl.human ? 1 : (BOT[pl.level] || BOT.medium).power));
      if (add < 0) add = Math.max(add, -Math.ceil(pl.troops * 0.01));
      pl.troops += add;
      pl.gold += 2 + Math.floor(g.count[p] / 25) + pl.nCity * 3 + pl.nPort * 4;   // ports bring in trade
    }
    // attacks
    for (let i = 0; i < g.attacks.length; i++) {
      const a = g.attacks[i];
      const pa = g.players[a.att];
      const dead = !pa.alive || (a.target && !g.players[a.target].alive);
      if (dead || !stepAttack(g, a)) {
        if (pa.alive) pa.troops += a.troops;
        g.attacks.splice(i--, 1);
      }
    }
    stepBoats(g);
    stepWarships(g);
    stepNukes(g);
    if (g.requests.length) g.requests = g.requests.filter((r) => g.tick - r.tick < REQUEST_TICKS && g.players[r.from].alive && g.players[r.to].alive);
    if (g.broken.length) g.broken = g.broken.filter((x) => g.tick - x.tick < BREAK_COOLDOWN);
    // bots think about once a second (spread out so they don't all think on the same tick)
    for (const pl of g.players) {
      if (!pl || pl.human || !pl.alive) continue;
      const every = (BOT[pl.level] || BOT.medium).every;
      if ((g.tick + pl.id * 3) % every === 0) botThink(g, pl.id);
    }
    // knocked out?
    for (const pl of g.players) {
      if (!pl || !pl.alive || !pl.spawned || g.count[pl.id] > 0) continue;
      pl.alive = false;
      pl.troops = 0;
      pl.outTick = g.tick;
      g.attacks = g.attacks.filter((a) => a.att !== pl.id);
      g.boats = g.boats.filter((b) => b.owner !== pl.id);
      g.warships = g.warships.filter((w) => w.owner !== pl.id);
      for (const q of alliesOf(g, pl.id)) { g.allySet.delete(pairKey(pl.id, q)); }
      g.alliances = g.alliances.filter(([a, b]) => a !== pl.id && b !== pl.id);
      if (g.track) g.events.push({ type: 'out', who: pl.id });
    }
    checkWin(g);
  }

  function checkWin(g) {
    const teams = g.cfg.mode === 'teams';
    const share = new Map();
    for (const pl of g.players) {
      if (!pl || !pl.alive) continue;
      const key = teams ? 't' + pl.team : 'p' + pl.id;
      share.set(key, (share.get(key) || 0) + g.count[pl.id]);
    }
    let win = null;
    if (share.size === 1) win = [...share.keys()][0];
    // free-for-all: everyone still in is allied with everyone else -> they win together
    if (!teams && share.size > 1) {
      const alive = g.players.filter((pl) => pl && pl.alive).map((pl) => pl.id);
      let all = true;
      for (let i = 0; i < alive.length && all; i++) for (let j = i + 1; j < alive.length && all; j++) if (!g.allySet.has(pairKey(alive[i], alive[j]))) all = false;
      if (all) {
        g.winner = { players: alive };
        if (g.track) g.events.push({ type: 'win', winner: g.winner });
        return;
      }
    }
    for (const [key, n] of share) if (n >= g.landTotal * WIN_SHARE) win = key;
    // every real player is out: no point making them watch the bots fight it out, so whoever
    // has the most land wins (ties go to whoever comes first)
    const humans = g.players.filter((p) => p && p.human);
    if (!win && humans.length && humans.every((p) => !p.alive)) {
      let most = -1;
      for (const [key, n] of share) if (n > most) { most = n; win = key; }
    }
    if (win) {
      g.winner = win[0] === 't' ? { team: +win.slice(1) } : { player: +win.slice(1) };
      if (g.track) g.events.push({ type: 'win', winner: g.winner });
    }
  }

  // ------------------------------------------------------------------ for the screen & checks
  /** A short number that only matches if two games are in exactly the same state. */
  function hash(g) {
    let h = hash32(g.tick, g.rng);
    for (let t = 0; t < g.N; t += 3) h = hash32(h, g.owner[t]);
    for (const p of g.players) if (p) { h = hash32(h, p.troops | 0); h = hash32(h, p.gold | 0); h = hash32(h, g.count[p.id]); }
    for (const a of g.attacks) h = hash32(h, a.troops | 0);
    for (const [a, b] of g.alliances) h = hash32(h, pairKey(a, b));
    for (const w of g.warships) { h = hash32(h, w.hp); h = hash32(h, shipAt(w)); }
    h = hash32(h, g.requests.length);
    return h >>> 0;
  }
  function share(g, p) { return g.count[p] / g.landTotal; }
  function teamShare(g, team) {
    let n = 0;
    for (const pl of g.players) if (pl && pl.team === team) n += g.count[pl.id];
    return n / g.landTotal;
  }

  root.FrontCore = {
    TICK_MS, SPAWN_TICKS, WIN_SHARE, COST, MAX_BOATS, MAX_WARSHIPS, WARSHIP_RANGE, NUKE_RADIUS, POST_RADIUS, REQUEST_TICKS, SIZES, STYLES, BOT, TEAM_NAMES,
    makeMap, createGame, rebuild, step, hash, maxTroops, buildCost, canBuild, sharesBorder, landingTile, isCoast,
    allied, alliesOf, pairKey, share, teamShare, centerTile, shipAt, boatAt, warshipRoute, xOf, yOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
