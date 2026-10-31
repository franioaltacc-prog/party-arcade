/* Career: the whole vv family in four tiers, Rookie to Legend. Each tier is a handful of events across the modes
   (Revvd, Unrevvd, Carvvd, Wavvd and the newer ones), each a challenge with a goal: finish it, win a medal or reach a
   score. Clear enough of a tier's events and the next one opens, with a reward. Nothing new is recorded: progress
   comes from your medals and bests in the challenges (on this device), so what you've already done counts. */
const { store } = PA;

/** goal: 'finish' | 0 gold, 1 silver, 2 bronze (races) | a number (the score to reach, in the challenge's own units). */
export const TIERS = [
  { id: 'rookie', name: 'Rookie', emoji: '🟢', need: 4, coins: 250,
    events: [['frost-downhill', 'finish'], ['timber-run', 'finish'], ['board-run', 'finish'], ['lighthouse-run', 'finish'], ['pine-flips', 1]] },
  { id: 'amateur', name: 'Amateur', emoji: '🥉', need: 5, coins: 500,
    events: [['autumn-run', 2], ['board-night', 2], ['buoy-slalom', 2], ['red-big-air', 2.5], ['surf-break', 150], ['pump-track', 2], ['rally-dash', 2]] },
  { id: 'pro', name: 'Pro', emoji: '🥈', need: 6, coins: 900, unlock: 'the 🥈 Pro jet ski colour',
    events: [['storm-run', 1], ['twilight-run', 1], ['island-hop', 1], ['hill-climb', 1], ['canyon-tricks', 500], ['board-speed', 90], ['sled-run', 1], ['sky-rings', 1]] },
  { id: 'legend', name: 'Legend', emoji: '🏆', need: 6, coins: 1500, unlock: 'the 🏆 Legend board',
    events: [['night-run', 0], ['avalanche-escape', 0], ['lighthouse-run', 0], ['wild-flips', 8], ['buoy-slalom', 0], ['skate-jam', 1200], ['sky-dive', 0], ['rally-dash', 0]] },
];

/** How far you've got with one event: { done, text } (text: the goal, in words). */
export function eventState(c, goal, { best, medal, fmtScore, medalTimes }) {
  if (!c) return { done: false, text: 'Coming soon' };
  const b = best(c.id); const m = c.kind === 'race' ? medal(c.id) : -1;
  if (goal === 'finish') return { done: b != null, text: c.kind === 'race' ? 'Finish it' : 'Score anything' };
  if (c.kind === 'race') {
    const names = ['🥇 Gold', '🥈 Silver', '🥉 Bronze']; const t = medalTimes(c)[goal];
    return { done: m >= 0 && m <= goal, text: `${names[goal]} (${fmtScore('race', t)})` };
  }
  return { done: b != null && b >= goal, text: `Reach ${fmtScore(c.kind, goal)}` };
}

/** Every tier with its events and how you're doing: [{ ...tier, events: [{ c, goal, done, text }], cleared, open, claimed }]. */
export function career(challenges, helpers) {
  const byId = Object.fromEntries(challenges.map((c) => [c.id, c]));
  let open = true;
  return TIERS.map((T) => {
    const events = T.events.map(([id, goal]) => ({ c: byId[id] || null, goal, ...eventState(byId[id], goal, helpers) })).filter((e) => e.c);
    const got = events.filter((e) => e.done).length; const need = Math.min(T.need, events.length);
    const row = { ...T, events, got, need, open, cleared: open && got >= need, claimed: store.get('moto_career_' + T.id, false) };
    open = row.cleared;
    return row;
  });
}
/** The rewards for tiers you've cleared and not yet collected: returns them (and marks them collected). */
export function claim(rows) {
  const out = [];
  for (const r of rows) if (r.cleared && !r.claimed) { store.set('moto_career_' + r.id, true); r.claimed = true; out.push(r); }
  return out;
}
/** Whether you've cleared a tier (its reward collected). */
export const cleared = (id) => store.get('moto_career_' + id, false);
