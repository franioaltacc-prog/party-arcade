/* 1v1 duels — Coinflip, High Card and Dice Duel share this module. */
(() => {
  const { h, fill, Sfx, UI } = PA;

  function makeDuel(kind) {
    let st = null, els = {}, C, target = null, animating = null, animTimers = [];
    const shown = new Set();

    function opponents() {
      return C.scores.filter((r) => r.id !== C.me && !r.out);
    }

    function mount(body, ctx) {
      C = ctx;
      els.arena = h('div', { class: 'duel-arena' });
      els.opps = h('div', { class: 'opp-list' });
      els.go = h('button', { class: 'btn btn-yellow btn-lg btn-block', style: { marginTop: '12px' }, onclick: challenge });
      els.mine = h('div', { class: 'duel-list' });
      els.history = h('div', { class: 'duel-list' });
      idleArena();
      fill(body, els.arena,
        h('div', { class: 'duel-grid' },
          h('div', {}, h('div', { class: 'label-h' }, '⚔️ Challenge someone'), els.opps, ctx.chips(h('div', { style: { marginTop: '12px' } })), els.go),
          h('div', {}, h('div', { class: 'label-h' }, '📨 Your challenges'), els.mine, h('div', { class: 'label-h', style: { marginTop: '12px' } }, '🕘 Recent duels'), els.history)));
      renderOpps();
    }

    function idleArena() {
      const intro = { coinflip: ['🪙', 'Heads or tails — the challenger is always heads.'], highcard: ['🂡', 'Both draw a card. Higher card wins (ties redraw).'], diceduel: ['🎯', 'Both roll two dice. Higher total wins (ties reroll).'] }[kind];
      fill(els.arena, h('div', {}, h('div', { style: { fontSize: '3.4rem' } }, intro[0]), h('p', { class: 'bold', style: { color: '#d1fae5' } }, intro[1]), h('p', { class: 'small', style: { color: '#bbf7d0' } }, 'Winner takes both stakes. No house cut!')));
    }

    function challenge() {
      if (!C.canPlay()) return;
      if (!target) { C.toast('Pick who to challenge first 👆', 'bad'); return; }
      C.send(kind, 'challenge', { to: target, amount: C.bet() });
      Sfx.play('pop');
    }

    function renderOpps() {
      if (!els.opps) return;
      const opps = opponents();
      if (target && !opps.some((o) => o.id === target)) target = null;
      fill(els.opps, opps.length ? opps.map((o) => h('button', { class: target === o.id ? 'on' : '', disabled: !o.online, onclick: () => { target = o.id; renderOpps(); Sfx.play('click'); } },
        UI.avatar(o, 'sm'), h('span', {}, o.name), h('span', { class: 'tiny muted' }, `🪙${C.fmt(o.coins)}${o.online ? '' : ' 📴'}`))) : h('p', { class: 'muted small' }, 'No other players with coins right now.'));
      const t = target ? C.player(target) : null;
      els.go.textContent = t ? `⚔️ Challenge ${t.name} for ${C.fmt(C.bet())}` : '⚔️ Challenge';
      els.go.disabled = !t || !C.canPlay();
    }

    function sideEl(uid, label, won) {
      const p = C.player(uid);
      return h('div', { class: 'vs-side' + (won ? ' won' : '') }, UI.avatar(p, 'lg'), h('span', {}, p.name), label ? h('span', { class: 'tiny', style: { color: '#bbf7d0' } }, label) : null);
    }

    function animate(d) {
      animTimers.forEach(clearTimeout); animTimers = [];
      animating = d.id;
      const total = Math.max(0.6, (st.reveal || 3.2) - (d.age || 0));
      const done = () => {
        const meIn = d.from === C.me || d.to === C.me;
        if (meIn) { if (d.winner === C.me) { Sfx.play('win'); UI.confetti(100); } else Sfx.play('lose'); }
        const w = C.player(d.winner);
        els.arena.querySelectorAll('.vs-side').forEach((el, i) => el.classList.toggle('won', (i === 0 ? d.from : d.to) === d.winner));
        els.arena.append(h('div', { class: 'bold', style: { color: '#fde68a', marginTop: '12px', fontSize: '1.2rem', width: '100%' } }, `🏆 ${w.name} wins ${C.fmt(d.amount * 2)}!`));
        animTimers.push(setTimeout(() => { if (animating === d.id) { animating = null; idleArena(); } }, 4500));
      };
      if (kind === 'coinflip') {
        const coin = h('div', { class: 'coin3d' }, h('div', { class: 'f' }, 'HEADS'), h('div', { class: 'f tails' }, 'TAILS'));
        const turns = 360 * 6 + (d.result.side === 'tails' ? 180 : 0);
        coin.style.setProperty('--turns', turns + 'deg');
        coin.style.setProperty('--dur', total + 's');
        fill(els.arena, h('div', { class: 'vs-row' }, sideEl(d.from, 'HEADS'), coin, sideEl(d.to, 'TAILS')));
        requestAnimationFrame(() => coin.classList.add('flip'));
        Sfx.play('swoosh');
      } else if (kind === 'highcard') {
        const rounds = d.result.rounds;
        const last = rounds[rounds.length - 1];
        const slotA = h('div', { class: 'cards' }, C.card('??'));
        const slotB = h('div', { class: 'cards' }, C.card('??'));
        fill(els.arena, h('div', { class: 'vs-row' }, sideEl(d.from), slotA, h('span', { class: 'big bold', style: { color: '#fff' } }, 'VS'), slotB, sideEl(d.to)),
          rounds.length > 1 ? h('p', { class: 'small', style: { color: '#bbf7d0', width: '100%' } }, `${rounds.length - 1} tie${rounds.length > 2 ? 's' : ''} — redrawn!`) : null);
        animTimers.push(setTimeout(() => { fill(slotA, C.card(last[0], { deal: true })); Sfx.play('pop'); }, total * 400));
        animTimers.push(setTimeout(() => { fill(slotB, C.card(last[1], { deal: true })); Sfx.play('pop'); }, total * 750));
      } else {
        const rounds = d.result.rounds;
        const last = rounds[rounds.length - 1];
        const a = [C.die(1), C.die(1)], b = [C.die(1), C.die(1)];
        const ta = h('div', { class: 'dice-total' }, '?'), tb = h('div', { class: 'dice-total' }, '?');
        fill(els.arena, h('div', { class: 'vs-row' }, sideEl(d.from), h('div', { class: 'row' }, a, ta), h('span', { class: 'big bold', style: { color: '#fff' } }, 'VS'), h('div', { class: 'row' }, b, tb), sideEl(d.to)),
          rounds.length > 1 ? h('p', { class: 'small', style: { color: '#bbf7d0', width: '100%' } }, `${rounds.length - 1} tie${rounds.length > 2 ? 's' : ''} — rerolled!`) : null);
        C.rollDice([...a, ...b], [...last[0], ...last[1]], total * 850);
        Sfx.play('swoosh');
        animTimers.push(setTimeout(() => { ta.textContent = last[0][0] + last[0][1]; tb.textContent = last[1][0] + last[1][1]; }, total * 850));
      }
      animTimers.push(setTimeout(done, total * 1000));
    }

    function update(state, ctx) {
      C = ctx; st = state;
      const playing = state.duels.find((d) => d.status === 'playing' && !shown.has(d.id));
      if (playing) { shown.add(playing.id); animate(playing); }
      const mine = state.duels.filter((d) => d.status === 'pending');
      fill(els.mine, mine.length ? mine.map((d) => {
        const incoming = d.to === ctx.me;
        const other = ctx.player(incoming ? d.from : d.to);
        return h('div', { class: 'row-item' }, UI.avatar(other, 'sm'),
          h('span', { class: 'grow' }, incoming ? h('b', {}, `${other.name} challenged you`) : `Waiting for ${other.name}…`, h('span', { class: 'tiny muted' }, ` · 🪙 ${ctx.fmt(d.amount)} · ${d.expiresIn}s`)),
          incoming ? h('button', { class: 'btn btn-green btn-sm', onclick: () => ctx.send(kind, 'accept', { id: d.id }) }, 'Accept') : null,
          incoming ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.send(kind, 'decline', { id: d.id }) }, 'Decline')
            : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.send(kind, 'cancel', { id: d.id }) }, 'Cancel'));
      }) : h('p', { class: 'muted small' }, 'No open challenges.'));
      fill(els.history, state.history.length ? state.history.map((x) => {
        const w = ctx.player(x.winner);
        return h('div', { class: 'row-item' }, UI.avatar(w, 'sm'), h('span', { class: 'small' }, h('b', {}, w.name), ` beat ${x.winner === x.from ? x.toName : x.fromName} · 🪙 ${ctx.fmt(x.amount * 2)}`));
      }) : h('p', { class: 'muted small' }, 'No duels yet. Be the first!'));
      renderOpps();
    }

    return { mount, update, onScores() { renderOpps(); }, unmount() { animTimers.forEach(clearTimeout); animTimers = []; animating = null; els = {}; } };
  }

  ['coinflip', 'highcard', 'diceduel'].forEach((k) => Casino.register(k, makeDuel(k)));
})();
