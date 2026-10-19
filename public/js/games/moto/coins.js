/* Motocross coins: earned riding the open worlds (gold coins on the trails and over the jumps, distance,
   flips, mini races and challenges) and spent on engine upgrades that only work in free ride. Races and
   challenges always use the stock engine, so they stay fair. Kept in this browser, like free-ride records. */
const { store } = PA;

const KEY = 'moto_coins_v1';
/** Free-ride engines. stats multiply the free-ride bike's power, drag, turbo power, turbo recharge and gearing
    (taller gearing = higher top speed). top: flat-ground top speed without / with turbo (from tests/mototest.js). */
export const ENGINES = [
  { id: 'stock', name: 'Stock 450', emoji: '🏍️', price: 0, about: 'The engine every bike comes with', top: [315, 347], stats: null },
  { id: 'sport', name: 'Sport tune', emoji: '🔧', price: 300, about: 'More power and a taller top gear', top: [346, 383], stats: { power: 1.25, drag: 0.94, turbo: 1.1, regen: 1.15, gear: 1.1 } },
  { id: 'race', name: 'Race engine', emoji: '🏁', price: 900, about: 'Factory race power, slicker bodywork', top: [384, 425], stats: { power: 1.6, drag: 0.86, turbo: 1.2, regen: 1.3, gear: 1.22 } },
  { id: 'twin', name: 'Twin turbo', emoji: '🔥', price: 2000, about: 'Two turbos: a much bigger boost that refills faster', top: [428, 474], stats: { power: 2.0, drag: 0.78, turbo: 1.4, regen: 1.5, gear: 1.36 } },
  { id: 'rocket', name: 'Rocket bike', emoji: '🚀', price: 4500, about: 'Why is there a rocket on this bike', top: [488, 540], stats: { power: 2.6, drag: 0.7, turbo: 1.6, regen: 1.8, gear: 1.55 } },
];
const listeners = new Set();
let cached = null;   // (the balance, so riding doesn't read storage every step)

function read() {
  const w = store.get(KEY, null) || {};
  const owned = Array.isArray(w.owned) ? w.owned.filter((id) => ENGINES.some((e) => e.id === id)) : [];
  if (!owned.includes('stock')) owned.unshift('stock');
  const out = { coins: Math.max(0, Math.floor(Number(w.coins) || 0)), owned, engine: owned.includes(w.engine) ? w.engine : 'stock' };
  cached = out.coins;
  return out;
}
function write(w) { store.set(KEY, w); cached = w.coins; listeners.forEach((f) => f(w)); }

export const wallet = () => read();
export const onWallet = (f) => { listeners.add(f); return () => listeners.delete(f); };
/** Add coins (n can be fractional: distance adds up a little at a time). Returns the new whole total. */
let partial = 0;
export function earn(n) {
  partial += n;
  const whole = Math.floor(partial);
  if (whole <= 0) return cached ?? read().coins;
  partial -= whole;
  const w = read(); w.coins += whole; write(w);
  return w.coins;
}
export function buy(id) {
  const e = ENGINES.find((x) => x.id === id); const w = read();
  if (!e || w.owned.includes(id)) return { ok: false, error: 'You already have that' };
  if (w.coins < e.price) return { ok: false, error: `You need ${(e.price - w.coins).toLocaleString('en-US')} more coins` };
  w.coins -= e.price; w.owned.push(id); w.engine = id; write(w);
  return { ok: true };
}
export function equip(id) { const w = read(); if (!w.owned.includes(id)) return false; w.engine = id; write(w); return true; }
export const engineOf = (id = read().engine) => ENGINES.find((e) => e.id === id) || ENGINES[0];
