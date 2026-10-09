/* Blackjack — everyone plays their own hand against the dealer. */
Casino.register('blackjack', (() => {
  const { h, fill, Sfx } = PA;
  let st = null, els = {}, C, seen = {}, soundRound = null;
  const RES = { win: 'WIN', blackjack: 'BLACKJACK!', push: 'PUSH', lose: 'LOSE', bust: 'BUST' };

  function cardsEl(key, cards, sm) {
    const before = seen[key] || 0;
    seen[key] = cards.length;
    return h('div', { class: 'cards', style: sm ? null : { justifyContent: 'center' } },
      cards.map((c, i) => C.card(c, { sm, deal: i >= before, delay: i >= before ? (i - before) * 0.15 : 0 })));
  }

  function mount(body, ctx) {
    C = ctx; seen = {};
    els.status = h('div', { class: 'status-line' });
    els.dealer = h('div', { class: 'bj-dealer' });
    els.hands = h('div', { class: 'bj-hands' });
    els.controls = h('div', { class: 'bj-controls' });
    els.chips = ctx.chips(h('div', { style: { justifyContent: 'center', marginTop: '14px' } }));
    fill(body, els.status, h('div', { class: 'felt' }, els.dealer, els.hands), els.controls, els.chips,
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '8px' } }, 'Dealer stands on 17 · Blackjack pays 3:2 · Double down on your first two cards'));
  }

  function update(state, ctx) {
    C = ctx; st = state;
    if (state.phase === 'betting' || state.phase === 'idle') { if (!Object.keys(state.hands).length) seen = {}; }
    const showDealer = state.dealer.length > 0;
    fill(els.dealer, h('div', { class: 'bj-label' }, `🎩 Dealer${showDealer ? ` · ${state.dealerTotal}${state.phase === 'playing' ? '+' : ''}` : ''}`),
      showDealer ? cardsEl('dealer' + state.round, state.dealer) : h('div', { class: 'muted', style: { color: '#d1fae5' } }, 'Waiting for bets…'));
    const order = Object.keys(state.hands).sort((a, b) => (a === ctx.me ? -1 : b === ctx.me ? 1 : 0));
    const waiting = Object.entries(state.bets || {});
    fill(els.hands,
      order.map((u) => {
        const hd = state.hands[u];
        const p = ctx.player(u);
        return h('div', { class: 'bj-hand' + (u === ctx.me ? ' me' : '') },
          h('div', { class: 'who' }, PA.UI.avatar(p, 'sm'), p.name, h('span', { class: 'chip-mini', style: { marginLeft: 'auto' } }, ctx.fmt(hd.bet))),
          cardsEl(u + state.round, hd.cards, true),
          h('div', { class: 'small bold', style: { color: '#d1fae5', marginTop: '4px' } }, `${hd.total}${hd.soft && hd.total < 21 ? ' (soft)' : ''}${hd.bj ? ' 🃏' : ''}${hd.doubled ? ' · doubled' : ''}`),
          hd.result ? h('span', { class: 'bj-res ' + hd.result }, `${RES[hd.result]}${hd.payout ? ` +${ctx.fmt(hd.payout)}` : ''}`) : null,
          hd.turnLeft != null ? h('div', { class: 'turn-bar' }, h('i', { 'data-turn': u, style: { width: (hd.turnLeft / state.turn * 100) + '%' } })) : null);
      }),
      waiting.map(([u, amt]) => { const p = ctx.player(u); return h('div', { class: 'bj-hand' + (u === ctx.me ? ' me' : '') }, h('div', { class: 'who' }, PA.UI.avatar(p, 'sm'), p.name, h('span', { class: 'chip-mini', style: { marginLeft: 'auto' } }, ctx.fmt(amt))), h('div', { class: 'small', style: { color: '#d1fae5' } }, '✅ Bet placed — waiting for the deal')); }));

    const mine = state.hands[ctx.me];
    const kids = [];
    if ((state.phase === 'idle' || state.phase === 'betting') && !state.myBet) {
      kids.push(h('button', { class: 'btn btn-yellow btn-lg', disabled: !ctx.canPlay(), onclick: (e) => { e.currentTarget.disabled = true; ctx.send('blackjack', 'bet', { amount: ctx.bet() }); Sfx.play('coin'); } }, `🃏 Deal me in · ${ctx.fmt(ctx.bet())}`));
    } else if (state.phase === 'betting' && state.myBet) {
      kids.push(h('button', { class: 'btn btn-ghost', onclick: () => ctx.send('blackjack', 'clear') }, '↩️ Take back my bet'));
    } else if (state.phase === 'playing' && mine && !mine.done) {
      kids.push(
        h('button', { class: 'btn btn-green btn-lg', onclick: () => { ctx.send('blackjack', 'hit'); Sfx.play('swoosh'); } }, '👆 Hit'),
        h('button', { class: 'btn btn-red btn-lg', onclick: () => { ctx.send('blackjack', 'stand'); Sfx.play('click'); } }, '✋ Stand'),
        state.canDouble ? h('button', { class: 'btn btn-yellow btn-lg', onclick: () => { ctx.send('blackjack', 'double'); Sfx.play('coin'); } }, `✌️ Double (${ctx.fmt(mine.bet)})`) : null);
    }
    fill(els.controls, kids);
    els.chips.style.display = (state.phase === 'idle' || state.phase === 'betting') && !state.myBet ? '' : 'none';
    if (state.phase === 'results' && mine && soundRound !== state.round) {
      soundRound = state.round;
      Sfx.play(mine.payout > mine.bet ? 'win' : mine.payout === mine.bet ? 'pop' : 'lose');
      if (mine.result === 'blackjack') PA.UI.confetti(100);
    }
    tick(ctx);
  }

  function tick(ctx) {
    if (!st || !els.status) return;
    const t = Math.ceil(ctx.left(st.remaining, 'blackjack') || 0);
    const mine = st.hands[ctx.me];
    let txt;
    if (st.phase === 'idle') txt = [h('span', { class: 'big' }, '🃏 Table open'), h('span', { class: 'muted' }, 'Pick a chip and press “Deal me in”. Others can join for 12 seconds.')];
    else if (st.phase === 'betting') txt = [h('span', { class: 'big' }, `⏳ ${t}s`), h('span', {}, 'Bets are open — dealing soon!')];
    else if (st.phase === 'playing') txt = [h('span', { class: 'big' }, mine && !mine.done ? '👉 Your move!' : '⏳ Waiting for others…'), h('span', { class: 'muted' }, 'Hit, stand or double down.')];
    else if (st.phase === 'dealer') txt = [h('span', { class: 'big' }, '🎩 Dealer’s turn…')];
    else txt = [h('span', { class: 'big' }, `Dealer: ${st.dealerTotal > 21 ? 'BUST!' : st.dealerTotal}`), mine ? h('span', { class: 'bold' }, RES[mine.result] || '') : h('span', { class: 'muted' }, 'Next hand soon…')];
    fill(els.status, txt);
    document.querySelectorAll('[data-turn]').forEach((el) => {
      const hd = st.hands[el.dataset.turn];
      if (hd && hd.turnLeft != null) el.style.width = Math.max(0, (ctx.left(hd.turnLeft, 'blackjack') / st.turn) * 100) + '%';
    });
  }

  return { mount, update, tick, onScores(ctx) { if (st) update(st, ctx); }, unmount() { els = {}; } };
})());
