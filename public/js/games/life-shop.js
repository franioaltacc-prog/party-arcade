/* Family Life shop: buy vehicles, homes, investments, luxury things, hire staff and book experiences,
   and see (and sell) everything you own. The server checks every purchase (games/life/game.py → buy/sell).
   LifeShop({ me }) → { open(tab), onItems(items), refresh() } */
window.LifeShop = (api) => {
  'use strict';
  const { h, fill, Net, Sfx, UI, fmtMoney } = PA;
  const TABS = [['vehicles', '🚗 Vehicles'], ['homes', '🏠 Homes'], ['invest', '💼 Invest'], ['luxury', '💎 Luxury'], ['staff', '🤵 Staff'],
    ['fun', '🎟️ Experiences'], ['mine', '🧾 My stuff']];
  let W = null;      // the open window: { close, box, tab, items }
  const armed = new Map();

  function open(tab) {
    if (!W) {
      const box = h('div', { class: 'shop' });
      W = { box, tab: tab || PA.store.get('life_shop_tab', 'vehicles'), items: null };
      W.close = UI.modal(box, { wide: true, onClose: () => { W = null; } });
    } else if (tab) W.tab = tab;
    Net.send('g:shop');
    draw();
  }

  const trend = (g) => {
    if (!g) return null;
    const [lo, hi] = g;
    if (hi <= 0) return h('span', { class: 'tag down' }, `📉 loses ${Math.abs(Math.round((lo + hi) / 2))}%/yr`);
    if (lo >= 0) return h('span', { class: 'tag up' }, `📈 gains ${lo}–${hi}%/yr`);
    return h('span', { class: 'tag' }, `🎢 ${lo}% to +${hi}%/yr`);
  };
  const earns = (inc) => inc && h('span', { class: 'tag ' + (inc[0] >= 0 ? 'up' : '') }, `💵 ${inc[0] < 0 ? '−' + fmtMoney(-inc[0]) : fmtMoney(inc[0])} to ${fmtMoney(inc[1])}/yr`);

  function itemRow(it) {
    const staff = it.cat === 'staff';
    const fun = it.cat === 'fun';
    const label = staff ? 'Hire' : fun ? 'Do it' : 'Buy';
    return h('div', { class: 'shop-item' + (it.ok ? '' : ' no') },
      h('span', { class: 'si-e' }, it.emoji),
      h('div', { class: 'grow' },
        h('div', { class: 'bold' }, it.name, it.owned ? h('span', { class: 'owned' }, it.max > 1 ? ` ×${it.owned}` : ' ✓') : null),
        h('div', { class: 'si-tags' },
          staff ? h('span', { class: 'tag' }, `💸 ${fmtMoney(it.upkeep)}/yr`) : h('span', { class: 'price' }, it.price ? fmtMoney(it.price) : 'Free'),
          !staff && it.upkeep ? h('span', { class: 'tag' }, `🔧 ${fmtMoney(it.upkeep)}/yr upkeep`) : null,
          earns(it.income), it.bust ? h('span', { class: 'tag down' }, `💥 ${Math.round(it.bust * 100)}% bust risk`) : null,
          staff || fun ? null : trend(it.growth),
          it.home ? h('span', { class: 'tag' }, '🔑 you can live here') : null,
          it.once ? h('span', { class: 'tag' }, '✨ once in a lifetime') : null,
          fun ? h('span', { class: 'tag' }, '⚡ 1 energy') : null,
          it.desc ? h('span', { class: 'tag faint' }, it.desc) : null),
        !it.ok ? h('div', { class: 'tiny muted' }, `🔒 ${it.why}`) : null),
      h('button', { class: 'btn btn-sm ' + (it.ok ? 'btn-lime' : 'btn-ghost'), disabled: !it.ok, onclick: () => { Sfx.play('coin'); Net.send('g:buy', { id: it.id }); } }, label));
  }

  function mine() {
    const m = api.me();
    const stuff = (m && m.assets) || [];
    if (!stuff.length) return [h('p', { class: 'muted' }, 'You don’t own anything yet. Treat yourself! 🛍️')];
    const worth = stuff.reduce((t, a) => t + a.value, 0);
    const upkeep = stuff.reduce((t, a) => t + (a.upkeep || 0), 0);
    return [
      h('div', { class: 'si-sum' },
        h('span', { class: 'tag up' }, `💎 Worth ${fmtMoney(worth)}`), h('span', { class: 'tag' }, `🔧 ${fmtMoney(upkeep)}/yr upkeep`),
        h('span', { class: 'tiny muted' }, 'Values change every birthday. Selling gets you 90% of what something is worth now.')),
      ...stuff.map((a) => {
        const staff = a.cat === 'staff';
        const diff = a.value - a.paid;
        const b = h('button', { class: 'btn btn-sm btn-ghost', onclick: () => {
          if (!armed.get(a.uid)) {
            armed.set(a.uid, true);
            b.textContent = staff ? 'Let them go?' : `Sell for ${fmtMoney(a.sell)}?`;
            b.classList.replace('btn-ghost', 'btn-red');
            setTimeout(() => { armed.delete(a.uid); if (b.isConnected) { b.textContent = staff ? 'Fire' : 'Sell'; b.classList.replace('btn-red', 'btn-ghost'); } }, 3500);
            return;
          }
          armed.delete(a.uid);
          Sfx.play('coin');
          Net.send('g:sell', { uid: a.uid });
        } }, staff ? 'Fire' : 'Sell');
        return h('div', { class: 'shop-item' },
          h('span', { class: 'si-e' }, a.emoji),
          h('div', { class: 'grow' },
            h('div', { class: 'bold' }, a.name),
            h('div', { class: 'si-tags' },
              staff ? h('span', { class: 'tag' }, `💸 ${fmtMoney(a.upkeep)}/yr`)
                : h('span', { class: 'price' }, `Worth ${fmtMoney(a.value)}`),
              !staff && a.paid && diff ? h('span', { class: 'tag ' + (diff >= 0 ? 'up' : 'down') }, `${diff >= 0 ? '▲' : '▼'} ${fmtMoney(Math.abs(diff))} since you bought it`) : null,
              !staff && a.upkeep ? h('span', { class: 'tag' }, `🔧 ${fmtMoney(a.upkeep)}/yr`) : null,
              earns(a.income), a.home ? h('span', { class: 'tag' }, '🔑 home') : null)),
          b);
      }),
    ];
  }

  function draw() {
    if (!W) return;
    const m = api.me();
    const list = W.tab === 'mine' ? mine()
      : !W.items ? [h('p', { class: 'muted' }, 'Opening the shop…')]
        : W.items.filter((it) => it.cat === W.tab).sort((a, b) => (b.ok - a.ok) || (a.price - b.price) || (a.upkeep - b.upkeep)).map(itemRow);
    fill(W.box,
      h('div', { class: 'shop-top' }, h('h2', {}, W.tab === 'mine' ? '🧾 My stuff' : '🛍️ Shop'), m ? h('span', { class: 'tag up big' }, `💰 ${fmtMoney(m.money)}`) : null),
      h('div', { class: 'shop-tabs' }, TABS.map(([k, l]) => h('button', { class: k === W.tab ? 'on' : '', onclick: () => { W.tab = k; PA.store.set('life_shop_tab', k === 'mine' ? 'vehicles' : k); Sfx.play('click'); draw(); } }, l))),
      W.tab === 'staff' ? h('p', { class: 'tiny muted', style: { margin: '0 0 8px' } }, 'Staff cost nothing to hire: you pay their wage every birthday, and they help you every year.') : null,
      W.tab === 'invest' ? h('p', { class: 'tiny muted', style: { margin: '0 0 8px' } }, 'Rentals and businesses pay you (or cost you) money every birthday. Businesses can go bust.') : null,
      h('div', { class: 'shop-list' }, list));
  }

  return {
    open,
    onItems(items) { if (W) { W.items = items; draw(); } },
    /** The player's state changed (money, what they own): redraw an open window. */
    refresh() { if (W) draw(); },
  };
};
