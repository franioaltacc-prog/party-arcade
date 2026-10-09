/* Texas Hold'em — vs players, coins move between friends. */
Casino.register('poker', (() => {
  const { h, fill, Sfx, UI } = PA;
  const POS = [[50, 82], [9, 64], [9, 26], [50, 11], [91, 26], [91, 64]];
  let st = null, els = {}, C, raiseTo = 0, seenBoard = { hand: null, n: 0 }, lastTurn = null, soundHand = null;

  function mount(body, ctx) {
    C = ctx;
    els.status = h('div', { class: 'status-line' });
    els.win = h('div');
    els.table = h('div', { class: 'pk-table' });
    els.controls = h('div', { class: 'pk-controls' });
    fill(body, els.status, els.win, els.table, els.controls,
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '8px' } }, 'No-limit Hold’em. Your poker chips are your match coins. 25s per move — if you’re away you auto-check/fold.'));
  }

  function seatEl(s, i, hand) {
    const pos = POS[i];
    const style = { left: pos[0] + '%', top: pos[1] + '%' };
    if (!s) return h('div', { class: 'pk-seat empty', style }, '🪑 Empty seat');
    const p = C.player(s.id);
    const turn = hand && hand.toAct === s.id;
    const won = hand && hand.over && hand.winners.find((w) => w.uid === s.id);
    return h('div', { class: 'pk-seat' + (turn ? ' turn' : '') + (s.folded ? ' folded' : ''), style },
      s.button ? h('span', { class: 'pk-btn', title: 'Dealer button' }, 'D') : null,
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px' } }, UI.avatar(p, 'sm'), h('span', { class: 'nm' }, s.name + (s.id === C.me ? ' (you)' : ''))),
      h('div', { class: 'co' }, `🪙 ${C.fmt(s.coins)}${s.away ? ' · 📴' : ''}`),
      s.cards && s.cards.length ? h('div', { class: 'cards' }, s.cards.map((c) => C.card(c, { sm: true, win: !!(won && won.best && won.best.includes(c)) }))) : null,
      h('div', { class: 'act' }, won ? `🏆 +${C.fmt(won.amount)}${s.handName ? ' · ' + s.handName : ''}` : s.handName || s.last || (s.inHand ? '' : 'sitting out')),
      turn && hand.turnLeft != null ? h('div', { class: 'turn-bar' }, h('i', { id: 'pk-turn', style: { width: '100%' } })) : null,
      s.bet ? h('span', { class: 'bet chip-mini' }, C.fmt(s.bet)) : null);
  }

  function update(state, ctx) {
    C = ctx; st = state;
    const hand = state.hand;
    const mySeat = state.seats.findIndex((s) => s && s.id === ctx.me);
    const rot = mySeat >= 0 ? mySeat : 0;
    const seats = state.seats.map((s, i) => seatEl(s, (i - rot + 6) % 6, hand));
    let center;
    if (hand) {
      const newHand = seenBoard.hand !== hand.no;
      if (newHand) seenBoard = { hand: hand.no, n: 0 };
      const board = Array.from({ length: 5 }, (_, i) => {
        const c = hand.board[i];
        if (!c) return h('div', { class: 'pcard', style: { opacity: 0.15, background: 'transparent', border: '2px dashed rgba(255,255,255,.4)' } });
        const isNew = i >= seenBoard.n;
        const win = hand.over && hand.winners.some((w) => w.best && w.best.includes(c));
        return ctx.card(c, { deal: isNew, delay: isNew ? (i - seenBoard.n) * 0.18 : 0, win });
      });
      if (hand.board.length > seenBoard.n) Sfx.play('swoosh');
      seenBoard.n = hand.board.length;
      center = h('div', { class: 'pk-center' }, h('div', { class: 'pk-street' }, hand.street === 'showdown' ? 'Showdown' : hand.street),
        h('div', { class: 'cards', style: { justifyContent: 'center', margin: '8px 0' } }, board), h('div', { class: 'pk-pot' }, `Pot 🪙 ${ctx.fmt(hand.pot)}`));
    } else {
      center = h('div', { class: 'pk-center', style: { color: '#d1fae5' } }, h('div', { style: { fontSize: '2.4rem' } }, '♠️♥️♣️♦️'),
        h('div', { class: 'bold' }, state.starting ? 'Next hand starting…' : 'Waiting for players'), h('div', { class: 'small' }, `Blinds ${state.sb} / ${state.bb}`));
    }
    fill(els.table, h('div', { class: 'pk-felt' }, center), seats);

    if (hand && hand.over && hand.winners.length) {
      fill(els.win, h('div', { class: 'pk-win' }, hand.winners.map((w) => `🏆 ${w.name} wins ${ctx.fmt(w.amount)}${w.hand ? ' with ' + w.hand : ''}`).join(' · ')));
      if (soundHand !== hand.no) {
        soundHand = hand.no;
        const me = hand.winners.find((w) => w.uid === ctx.me);
        if (me) { Sfx.play('win'); if (me.amount >= 500) UI.confetti(120); } else if (state.seats.some((s) => s && s.id === ctx.me && s.inHand)) Sfx.play('lose');
      }
    } else fill(els.win);

    // controls
    const o = hand && hand.opts;
    const kids = [];
    if (o) {
      if (lastTurn !== hand.no + ':' + hand.street + ':' + hand.current) { lastTurn = hand.no + ':' + hand.street + ':' + hand.current; raiseTo = o.minRaiseTo; Sfx.play('boing'); }
      raiseTo = Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, raiseTo));
      const label = h('b', { class: 'mono' }, ctx.fmt(raiseTo));
      const slider = h('input', { type: 'range', min: o.minRaiseTo, max: o.maxRaiseTo, step: 1, value: raiseTo, oninput: (e) => { raiseTo = Number(e.target.value); label.textContent = ctx.fmt(raiseTo); } });
      const setTo = (v) => { raiseTo = Math.max(o.minRaiseTo, Math.min(o.maxRaiseTo, Math.round(v))); slider.value = raiseTo; label.textContent = ctx.fmt(raiseTo); };
      const pot = hand.pot;
      kids.push(
        h('button', { class: 'btn btn-red', onclick: () => ctx.send('poker', 'fold') }, '🏳️ Fold'),
        o.canCheck ? h('button', { class: 'btn btn-cyan', onclick: () => ctx.send('poker', 'check') }, '✔️ Check')
          : h('button', { class: 'btn btn-green', onclick: () => { ctx.send('poker', 'call'); Sfx.play('coin'); } }, `📞 Call ${ctx.fmt(o.toCall)}`),
        o.maxRaiseTo > o.current ? h('div', { class: 'pk-raise' },
          slider, label,
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => setTo(o.current + pot / 2) }, '½ pot'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => setTo(o.current + pot) }, 'Pot'),
          h('button', { class: 'btn btn-yellow', onclick: () => { ctx.send('poker', raiseTo >= o.maxRaiseTo ? 'allin' : 'raise', { amount: raiseTo }); Sfx.play('coin'); } }, raiseTo >= o.maxRaiseTo ? '🔥 All-in' : `⬆️ Raise to ${ctx.fmt(raiseTo)}`)) : null);
    } else if (!state.seated) {
      kids.push(h('button', { class: 'btn btn-yellow btn-lg', disabled: !ctx.canPlay(), onclick: () => { ctx.send('poker', 'sit'); Sfx.play('pop'); } }, `🪑 Sit down (blinds ${state.sb}/${state.bb})`));
    } else {
      kids.push(h('span', { class: 'muted bold' }, hand && !hand.over ? (hand.toAct ? `⏳ Waiting for ${ctx.player(hand.toAct).name}…` : 'Dealing…') : 'Seated — next hand starts automatically.'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.send('poker', 'leave') }, '🚪 Leave table'));
    }
    fill(els.controls, kids);
    tick(ctx);
  }

  function tick(ctx) {
    if (!st || !els.status) return;
    const hand = st.hand;
    const seated = st.seats.filter(Boolean).length;
    let txt;
    if (!hand) txt = [h('span', { class: 'big' }, '♠️ Texas Hold’em'), h('span', { class: 'muted' }, seated < 2 ? `Need 2+ players seated (${seated}/6). Invite a friend to sit down!` : 'Shuffling up…')];
    else if (hand.over) txt = [h('span', { class: 'big' }, `Hand #${hand.no} done`), h('span', { class: 'muted' }, 'Next hand in a few seconds…')];
    else {
      const t = hand.turnLeft != null ? Math.ceil(ctx.left(hand.turnLeft, 'poker')) : null;
      txt = [h('span', { class: 'big' }, `Hand #${hand.no} · ${hand.street}`), hand.toAct ? h('span', {}, hand.toAct === ctx.me ? `👉 Your turn! ${t != null ? t + 's' : ''}` : `${ctx.player(hand.toAct).name} to act ${t != null ? '· ' + t + 's' : ''}`) : null];
      const bar = document.getElementById('pk-turn');
      if (bar && hand.turnLeft != null) bar.style.width = Math.max(0, ctx.left(hand.turnLeft, 'poker') / st.turn * 100) + '%';
    }
    fill(els.status, txt);
  }

  return { mount, update, tick, unmount() { els = {}; } };
})());
