/* Revvd coins: earned riding the open worlds (gold coins on the trails and over the jumps, distance,
   flips, mini races and challenges) and spent on engine upgrades that only work in free ride. Races and
   challenges always use the stock engine, so they stay fair. Kept in this browser, like free-ride records.
   Unrevvd (the mountain bikes) has its own coins and its own upgrades, in a wallet of their own (MTB). */
const { store } = PA;

/** Free-ride engines. stats multiply the free-ride bike's power, drag, turbo power, turbo recharge and gearing
    (taller gearing = higher top speed). top: flat-ground top speed without / with turbo (from tests/mototest.js). */
export const ENGINES = [
  { id: 'stock', name: 'Stock 450', emoji: '🏍️', price: 0, about: 'The engine every bike comes with', top: [315, 347], stats: null },
  { id: 'sport', name: 'Sport tune', emoji: '🔧', price: 300, about: 'More power and a taller top gear', top: [346, 383], stats: { power: 1.25, drag: 0.94, turbo: 1.1, regen: 1.15, gear: 1.1 } },
  { id: 'race', name: 'Race engine', emoji: '🏁', price: 900, about: 'Factory race power, slicker bodywork', top: [384, 425], stats: { power: 1.6, drag: 0.86, turbo: 1.2, regen: 1.3, gear: 1.22 } },
  { id: 'twin', name: 'Twin turbo', emoji: '🔥', price: 2000, about: 'Two turbos: a much bigger boost that refills faster', top: [428, 474], stats: { power: 2.0, drag: 0.78, turbo: 1.4, regen: 1.5, gear: 1.36 } },
  { id: 'rocket', name: 'Rocket bike', emoji: '🚀', price: 4500, about: 'Why is there a rocket on this bike', top: [488, 540], stats: { power: 2.6, drag: 0.7, turbo: 1.6, regen: 1.8, gear: 1.55 } },
];
/** Unrevvd's mountain bike upgrades. stats multiply the rider's pedal power and air drag ({} = stock).
    top: flat-ground top speed pedalling (from tests/mototest.js). */
export const MTB_PARTS = [
  { id: 'stock', name: 'Trail legs', emoji: '🦵', price: 0, about: 'Your own two legs', top: [47], stats: {} },
  { id: 'clips', name: 'Clipless pedals', emoji: '👟', price: 250, about: 'Clipped in: every pedal stroke counts', top: [51], stats: { power: 1.2 } },
  { id: 'carbon', name: 'Carbon wheels', emoji: '⚙️', price: 700, about: 'Lighter, stiffer, faster', top: [55], stats: { power: 1.4, drag: 0.92 } },
  { id: 'pro', name: 'Pro legs', emoji: '💪', price: 1600, about: 'A season of training', top: [61], stats: { power: 1.75, drag: 0.86 } },
  { id: 'ebike', name: 'E-bike motor', emoji: '🔋', price: 4000, about: 'A little motor helps every stroke. Shh', top: [71], stats: { power: 2.5, drag: 0.82 } },
];

/** A wallet kept in this browser under key, with the upgrades in items to buy. */
function makeWallet(key, items) {
  const listeners = new Set();
  let cached = null;   // (the balance, so riding doesn't read storage every step)
  let partial = 0;
  function read() {
    const w = store.get(key, null) || {};
    const owned = Array.isArray(w.owned) ? w.owned.filter((id) => items.some((e) => e.id === id)) : [];
    if (!owned.includes('stock')) owned.unshift('stock');
    const out = { coins: Math.max(0, Math.floor(Number(w.coins) || 0)), owned, engine: owned.includes(w.engine) ? w.engine : 'stock' };
    cached = out.coins;
    return out;
  }
  function write(w) { store.set(key, w); cached = w.coins; listeners.forEach((f) => f(w)); }
  return {
    items,
    wallet: () => read(),
    onWallet: (f) => { listeners.add(f); return () => listeners.delete(f); },
    /** Add coins (n can be fractional: distance adds up a little at a time). Returns the new whole total. */
    earn(n) {
      partial += n;
      const whole = Math.floor(partial);
      if (whole <= 0) return cached ?? read().coins;
      partial -= whole;
      const w = read(); w.coins += whole; write(w);
      return w.coins;
    },
    buy(id) {
      const e = items.find((x) => x.id === id); const w = read();
      if (!e || w.owned.includes(id)) return { ok: false, error: 'You already have that' };
      if (w.coins < e.price) return { ok: false, error: `You need ${(e.price - w.coins).toLocaleString('en-US')} more coins` };
      w.coins -= e.price; w.owned.push(id); w.engine = id; write(w);
      return { ok: true };
    },
    equip(id) { const w = read(); if (!w.owned.includes(id)) return false; w.engine = id; write(w); return true; },
    /** The upgrade in use (or the one with this id). */
    current: (id = read().engine) => items.find((e) => e.id === id) || items[0],
  };
}

const MOTO = makeWallet('moto_coins_v1', ENGINES);
export const MTB = makeWallet('mtb_coins_v1', MTB_PARTS);
export const wallet = MOTO.wallet;
export const onWallet = MOTO.onWallet;
export const earn = MOTO.earn;
export const buy = MOTO.buy;
export const equip = MOTO.equip;
export const engineOf = MOTO.current;
