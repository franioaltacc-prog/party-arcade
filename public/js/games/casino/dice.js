/* Lucky Dice — two dice, one shared roll. */
Casino.register('dice', (() => {
  const { h, fill, Sfx } = PA;
  const MAIN = [['low', null, 'LOW 2–6', '×2'], ['high', null, 'HIGH 8–12', '×2'], ['seven', null, 'LUCKY 7', '×5'], ['doubles', null, 'DOUBLES', '×5']];
  const EXACT = { 2: 31, 3: 16, 4: 11, 5: 8, 6: 6, 8: 6, 9: 8, 10: 11, 11: 16, 12: 31 };
  let st = null, els = {}, C, rollRound = null, soundRound = null;

  function wins(kind, value, r) {
    const [a, b] = r.dice; const t = r.total;
    return { low: t <= 6, high: t >= 8, seven: t === 7, doubles: a === b, sum: t === value }[kind];
  }

  function place(kind, value) {
    if (!C.canPlay()) return;
    if (st && !['idle', 'betting'].includes(st.phase)) { C.toast('Bets are closed — wait for the next roll ⏳', 'bad'); return; }
    C.send('dice', 'bet', { kind, value, amount: C.bet() });
    Sfx.play('coin');
  }

  const btn = (kind, value, label, pay) => h('button', { class: 'bet-btn', 'data-kind': kind, 'data-value': value == null ? '' : value, onclick: () => place(kind, value) }, label, h('span', { class: 'pay' }, pay));

  function mount(body, ctx) {
    C = ctx;
    els.d1 = ctx.die(6); els.d2 = ctx.die(6);
    els.total = h('div', { class: 'dice-total' }, '');
    els.status = h('div', { class: 'status-line' });
    els.history = h('div', { class: 'history' });
    els.mine = h('div', { class: 'row wrap', style: { marginTop: '10px', gap: '8px' } });
    els.others = h('div', { class: 'others' });
    fill(body,
      els.status,
      h('div', { class: 'dice-stage' }, els.d1, els.d2, els.total),
      ctx.chips(h('div', { style: { marginBottom: '12px' } })),
      h('div', { class: 'dice-bets' }, MAIN.map(([k, v, l, p]) => btn(k, v, l, p))),
      h('div', { class: 'label-h', style: { marginTop: '12px' } }, 'Exact total'),
      h('div', { class: 'dice-sums' }, Object.entries(EXACT).map(([n, m]) => btn('sum', Number(n), n, `×${m}`))),
      h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'A total of 7 loses LOW and HIGH bets. Payouts include your stake.'),
      els.mine,
      h('div', { class: 'label-h', style: { marginTop: '12px' } }, 'Last rolls'), els.history, els.others);
  }

  function update(state, ctx) {
    C = ctx; st = state;
    const r = state.result;
    document.querySelectorAll('.dice-bets .bet-btn, .dice-sums .bet-btn').forEach((el) => {
      const kind = el.dataset.kind;
      const value = el.dataset.value === '' ? null : Number(el.dataset.value);
      const mine = state.mine.filter((b) => b.kind === kind && (kind !== 'sum' || b.value === value)).reduce((s, b) => s + b.amount, 0);
      const old = el.querySelector('.chip-mini'); if (old) old.remove();
      if (mine) el.append(h('span', { class: 'chip-mini' }, mine));
      el.classList.toggle('hit', state.phase === 'results' && r && !!wins(kind, value, r));
    });
    if (state.phase === 'resolving' && r && rollRound !== state.round) {
      rollRound = state.round;
      els.total.textContent = '…';
      Sfx.play('swoosh');
      const ms = (ctx.left(state.remaining, 'dice') || 0) * 1000;
      ctx.rollDice([els.d1, els.d2], r.dice, ms);
      setTimeout(() => { if (els.total) els.total.textContent = r.total; }, ms);
    } else if (state.phase === 'results' && r) {
      if (rollRound !== state.round) { rollRound = state.round; ctx.setDie(els.d1, r.dice[0]); ctx.setDie(els.d2, r.dice[1]); }
      els.total.textContent = r.total;
      const p = state.payouts[ctx.me];
      if (p && soundRound !== state.round) { soundRound = state.round; Sfx.play(p.returned ? 'win' : 'lose'); }
    }
    fill(els.history, (state.history || []).map((x) => h('span', { class: x.total === 7 ? 'h-green' : x.total < 7 ? 'h-black' : 'h-red' }, x.total)));
    const total = state.mine.reduce((s, b) => s + b.amount, 0);
    fill(els.mine, total ? [h('span', { class: 'bold' }, `Your bets: ${ctx.fmt(total)}`),
      state.phase === 'betting' ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.send('dice', 'clear') }, '↩️ Take back my bets') : null] : []);
    const others = Object.entries(state.bets).filter(([u]) => u !== ctx.me);
    fill(els.others, others.map(([u, b]) => { const p = ctx.player(u); return h('span', {}, `${p.avatar} ${p.name}: 🪙 ${ctx.fmt(b.total)}`); }));
    tick(ctx);
  }

  function tick(ctx) {
    if (!st || !els.status) return;
    const t = Math.ceil(ctx.left(st.remaining, 'dice') || 0);
    let txt;
    if (st.phase === 'idle') txt = [h('span', { class: 'big' }, '🎲 Place a bet'), h('span', { class: 'muted' }, 'The first bet starts a 12-second countdown.')];
    else if (st.phase === 'betting') txt = [h('span', { class: 'big' }, `⏳ ${t}s`), h('span', {}, 'Bets open! One roll for everyone.')];
    else if (st.phase === 'resolving') txt = [h('span', { class: 'big' }, '🎲 Rolling…')];
    else {
      const p = st.payouts[ctx.me];
      txt = [h('span', { class: 'big' }, `Total ${st.result.total}`),
        p ? h('span', { class: 'bold', style: { color: p.returned ? 'var(--lime)' : 'var(--red)' } }, p.returned ? `You won ${ctx.fmt(p.returned)} (+${ctx.fmt(p.returned - p.staked)})` : `You lost ${ctx.fmt(p.staked)}`) : h('span', { class: 'muted' }, 'Next roll soon…')];
    }
    fill(els.status, txt);
  }

  return { mount, update, tick, unmount() { els = {}; } };
})());
