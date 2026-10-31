/* The chutes (Unrevvd's first-person forest runs) and their extras: medal times, your trail stats, near misses
   (passing a tree close without touching it), ghosts (a run recorded, to race against), the Daily Chute (a new
   gully every day, the same for everyone) and the Downhill World Cup (five chutes back to back). Kept apart from
   game.js: it only needs the ground (terrain.mjs) and the bike. */
const { store } = PA;

// ------------------------------------------------------------------ medals
export const MEDALS = [['🥇', 'Gold'], ['🥈', 'Silver'], ['🥉', 'Bronze']];
/** A race challenge's medal times (seconds): its own "medals" in challenges.json, or a share of its time limit. */
export const medalTimes = (ch) => ch.medals || [0.42, 0.56, 0.75].map((k) => Math.round(ch.limit * k));
/** 0 gold, 1 silver, 2 bronze, -1 none (only races have medals). */
export const medalOf = (ch, t) => (ch.kind === 'race' && t != null ? medalTimes(ch).findIndex((m) => t <= m) : -1);
/** The best medal you've won on a challenge (on this device), -1 none. */
export const bestMedal = (id) => store.get('moto_ch_medal_' + id, -1);
export function saveMedal(id, m) { const old = bestMedal(id); if (m >= 0 && (old < 0 || m < old)) { store.set('moto_ch_medal_' + id, m); return true; } return false; }
/** The chutes whose gold medals together unlock the Golden Chute paint (see goldAll). */
export const GOLD_CHUTES = ['timber-run', 'frozen-run', 'night-run'];
export const goldAll = () => GOLD_CHUTES.every((id) => bestMedal(id) === 0);

// ------------------------------------------------------------------ trail stats (this device)
const TRAIL = 'mtb_trail_v1';
/** { m: metres ridden in chutes, dodged: trees passed within 2 m, close: near misses, clean: the longest run in
    metres without a crash, runs: chute runs finished }. */
export const trailStats = () => ({ m: 0, dodged: 0, close: 0, clean: 0, runs: 0, ...store.get(TRAIL, {}) });
function addTrail(f) { const s = trailStats(); f(s); store.set(TRAIL, s); }

// ------------------------------------------------------------------ a run down a chute
const NEAR = 0.5;    // a near miss: the bike's side passed within this many metres of a tree's trunk (or a rock)
const DODGE = 2;     // a tree dodged: passed within this
/** Watches the bike down a chute (call step every physics step): the distance, the longest stretch without a crash,
    trees dodged and near misses (onNear(o) for each: a tree or rock you got past within half a metre) and how close
    the nearest thing ahead is (danger 0..1, for the heartbeat). bushes: [{x, z, r}] you ride through (onBush). */
export function chuteRun(ground, { onNear = () => {}, onBush = () => {}, bushes = [] } = {}) {
  let m = 0; let clean = 0; let bestClean = 0; let dodged = 0; let close = 0; let danger = 0;
  const near = new Map();   // obstacle -> the closest gap so far while it's beside you
  let inBush = null;
  const bushGrid = new Map();
  for (const b of bushes) { const k = Math.floor(b.x / 10) + ',' + Math.floor(b.z / 10); if (!bushGrid.has(k)) bushGrid.set(k, []); bushGrid.get(k).push(b); }
  return {
    get danger() { return danger; },
    step(b, moved) {
      if (b.crashed) { near.clear(); danger = 0; return; }
      m += moved; clean += moved; bestClean = Math.max(bestClean, clean);
      const c = Math.cos(b.h); const s = Math.sin(b.h); const fast = b.vx > 4;
      danger = 0;
      for (const o of ground.obstaclesNear(b.px, b.pz, 7)) {
        const dx = o.x - b.px; const dz = o.z - b.pz; const along = dx * c + dz * s; const side = Math.abs(-dx * s + dz * c);
        const gap = side - o.r - 0.35;   // (0.35: half the bike's width at the bars)
        if (along > 0 && gap < 1.2 && fast) danger = Math.max(danger, Math.min(1, (1.2 - gap) / 1.2) * Math.max(0, 1 - along / 7));
        if (along > -1.2 && along < 1.5) near.set(o, Math.min(near.get(o) ?? Infinity, gap));
        else if (along <= -1.2 && near.has(o)) {
          const g = near.get(o); near.delete(o);   // (it's behind you now and you didn't touch it)
          if (g < DODGE && o.tall > 3) dodged++;
          if (g < NEAR && fast) { close++; onNear(o); }
        }
      }
      for (const o of near.keys()) if (Math.hypot(o.x - b.px, o.z - b.pz) > 8) near.delete(o);
      // riding into a bush (only the first moment counts)
      const list = bushGrid.get(Math.floor(b.px / 10) + ',' + Math.floor(b.pz / 10)) || [];
      const hit = list.find((x) => Math.hypot(x.x - b.px, x.z - b.pz) < x.r);
      if (hit && hit !== inBush && b.vx > 2) onBush(hit);
      inBush = hit || null;
    },
    crash() { clean = 0; near.clear(); },
    /** The run is over: add it to your trail stats. */
    save(finished) { addTrail((t) => { t.m += Math.round(m); t.dodged += dodged; t.close += close; t.clean = Math.max(t.clean, Math.round(bestClean)); if (finished) t.runs++; }); },
    get close() { return close; },
  };
}

// ------------------------------------------------------------------ ghosts
/** A recorded run: 8 frames a second of where the bike was and how it looked (the same fields as a rider's
    position message, so it's drawn like another rider). */
const FIELDS = ['px', 'pz', 'h', 'ro', 'y', 'a', 'rx', 'ry', 'c0', 'c1', 'l', 'tk', 'tp', 's', 'k'];
export const GHOST_HZ = 8;
export function ghostRecorder() {
  const frames = []; let next = 0;
  return {
    /** t: the run's time (s); msg: the bike's position message. */
    add(t, msg) { if (t < next) return; next = t + 1 / GHOST_HZ; frames.push([Math.round(t * 100) / 100, ...FIELDS.map((f) => Math.round((msg[f] || 0) * 100) / 100)]); },
    data: () => ({ v: 1, f: FIELDS, frames }),
  };
}
/** A ghost to draw: data (from ghostRecorder) -> frames as position messages, at: ms of run time. */
export function ghostFrames(data) {
  if (!data || !Array.isArray(data.frames) || !Array.isArray(data.f)) return null;
  return data.frames.map((row) => { const m = { at: row[0] * 1000 }; data.f.forEach((f, i) => { m[f] = +row[i + 1] || 0; }); m.x = 0; return m; });
}
/** Your own best run's ghost on this device. */
export const myGhost = (key) => store.get('moto_ghost_' + key, null);
export function saveMyGhost(key, ms, data) { try { store.set('moto_ghost_' + key, { ms, data }); } catch { /* storage full: no ghost */ } }

// ------------------------------------------------------------------ the Daily Chute
/** Which chute look each day has, in turn (the world file it borrows its look from). */
export const DAILY_LOOKS = ['timberchute', 'autumnchute', 'frostchute', 'fogchute', 'stormchute', 'nightchute'];
/** Today's Daily Chute (UTC days): { day: 'YYYYMMDD', seed, look: world id, name }. */
export function dailyChute(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const n = Math.floor(date.getTime() / 86400000);
  return { day, seed: 10007 + (n * 7919) % 90000, look: DAILY_LOOKS[n % DAILY_LOOKS.length] };
}
/** The Daily Chute's challenge (a race down it, in first person). */
export const dailyChallenge = (d = dailyChute()) => ({ id: 'daily', world: 'daily', kind: 'race', name: 'Daily Chute', emoji: '📅', from: 'top', to: 'bottom', limit: 180, vehicle: 'mtb', cam: 'first', daily: d,
  about: 'A new gully every day, the same one for everybody. One leaderboard, for today only. Touch anything and you crash.' });

// ------------------------------------------------------------------ the Weekly Challenge
/** The week number (UTC weeks since 1970: the server counts them the same way). */
export const weekNumber = (date = new Date()) => Math.floor(date.getTime() / 86400000 / 7);
/** This week's challenge: one of the race challenges in turn (Revvd's, Unrevvd's and Carvvd's), the same for everybody,
    with its own leaderboard for the week. all: every challenge (challenges.json's order, like the server's). */
export function weeklyChallenge(all, date = new Date()) {
  const races = all.filter((c) => c.kind === 'race' && !c.daily && !c.weekly && !c.water);   // (Wavvd's races came later: kept out, so the weekly pick didn't change)
  if (!races.length) return null;
  const n = weekNumber(date); const base = races[n % races.length];
  return { ...base, id: 'weekly-' + n, base: base.id, weekly: { n }, name: 'Weekly: ' + base.name, emoji: '🗓️',
    about: `This week's challenge, the same for everybody, with a leaderboard just for this week: ${base.about} Win gold for the 🏆 Champion prizes.` };
}
/** Whether you've won gold in a Weekly Challenge (it unlocks the Champion board and visor). */
export const weeklyGold = () => store.get('moto_weekly_gold', null) != null;

// ------------------------------------------------------------------ the Downhill World Cup
/** Five chutes back to back: the times add up. */
export const CUP = ['timber-run', 'autumn-run', 'storm-run', 'frozen-run', 'night-run'];
