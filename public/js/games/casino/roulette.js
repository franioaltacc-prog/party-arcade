/* Roulette — shared spin, everyone bets during the countdown. */
Casino.register('roulette', (() => {
  const { h, fill, Sfx } = PA;
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const SEG = (Math.PI * 2) / WHEEL.length;
  const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
  const OUTS = [['low', '1–18'], ['even', 'EVEN'], ['red', '🔴 RED'], ['black', '⚫ BLACK'], ['odd', 'ODD'], ['high', '19–36']];
  const DOZ = [['dozen1', '1st 12'], ['dozen2', '2nd 12'], ['dozen3', '3rd 12']];
  const WINS = {
    red: (n) => RED.has(n), black: (n) => n > 0 && !RED.has(n), odd: (n) => n > 0 && n % 2 === 1, even: (n) => n > 0 && n % 2 === 0,
    low: (n) => n >= 1 && n <= 18, high: (n) => n >= 19, dozen1: (n) => n >= 1 && n <= 12, dozen2: (n) => n >= 13 && n <= 24, dozen3: (n) => n >= 25,
  };

  let st = null;
  let angle = 0;
  let spinRound = null;
  let soundRound = null;
  let raf = null;
  let cv, ctx2, els = {};
  let C;

  function drawWheel(rot) {
    if (!ctx2) return;
    const W = 560, cx = 280, cy = 280;
    ctx2.clearRect(0, 0, W, W);
    ctx2.beginPath(); ctx2.arc(cx, cy, 276, 0, Math.PI * 2); ctx2.fillStyle = '#3f2d14'; ctx2.fill();
    for (let i = 0; i < WHEEL.length; i++) {
      const n = WHEEL[i];
      const a0 = rot + i * SEG - Math.PI / 2 - SEG / 2;
      ctx2.beginPath(); ctx2.moveTo(cx, cy); ctx2.arc(cx, cy, 262, a0, a0 + SEG); ctx2.closePath();
      ctx2.fillStyle = n === 0 ? '#15803d' : RED.has(n) ? '#b91c1c' : '#111827';
      ctx2.fill();
      ctx2.strokeStyle = 'rgba(251,191,36,.6)'; ctx2.lineWidth = 2; ctx2.stroke();
      ctx2.save(); ctx2.translate(cx, cy); ctx2.rotate(a0 + SEG / 2 + Math.PI / 2);
      ctx2.fillStyle = '#fff'; ctx2.font = '700 22px Fredoka, sans-serif'; ctx2.textAlign = 'center';
      ctx2.fillText(String(n), 0, -228); ctx2.restore();
    }
    const g = ctx2.createRadialGradient(cx - 30, cy - 30, 10, cx, cy, 200);
    g.addColorStop(0, '#78350f'); g.addColorStop(1, '#3f2d14');
    ctx2.beginPath(); ctx2.arc(cx, cy, 196, 0, Math.PI * 2); ctx2.fillStyle = g; ctx2.fill();
    ctx2.strokeStyle = '#fbbf24'; ctx2.lineWidth = 4; ctx2.stroke();
    for (let k = 0; k < 8; k++) {
      ctx2.save(); ctx2.translate(cx, cy); ctx2.rotate(rot + (k * Math.PI) / 4);
      ctx2.fillStyle = '#fbbf24'; ctx2.fillRect(-4, -190, 8, 120); ctx2.restore();
    }
  }

  function showResult(n) {
    if (!els.result) return;
    els.result.textContent = n == null ? '' : n;
    els.result.style.background = n == null ? 'transparent' : { red: '#b91c1c', black: '#111827', green: '#15803d' }[colorOf(n)];
    if (n != null && C && C.fx && C.fx.pop) C.fx.pop(els.result, { from: 0.2, duration: 0.7 });
  }

  function spinTo(n, seconds) {
    cancelAnimationFrame(raf);
    const i = WHEEL.indexOf(n);
    let target = -i * SEG;
    const from = angle;
    while (target > from - Math.PI * 8) target -= Math.PI * 2;
    const dur = Math.max(0.3, seconds) * 1000;
    const t0 = performance.now();
    showResult(null);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      angle = from + (target - from) * (1 - Math.pow(1 - t, 3));
      drawWheel(angle);
      if (t < 1) raf = requestAnimationFrame(step);
      else { angle = target % (Math.PI * 2); showResult(n); }
    };
    raf = requestAnimationFrame(step);
  }

  function cell(kind, value, label, cls) {
    const el = h('div', { class: `rl-cell ${cls}`, 'data-kind': kind, 'data-value': value == null ? '' : value, onclick: () => place(kind, value) }, label);
    return el;
  }

  function place(kind, value) {
    if (!C.canPlay()) return;
    if (st && !['idle', 'betting'].includes(st.phase)) { C.toast('Bets are closed — wait for the next spin ⏳', 'bad'); return; }
    C.send('roulette', 'bet', { kind, value, amount: C.bet() });
    Sfx.play('coin');
  }

  function mount(body, ctx) {
    C = ctx;
    cv = h('canvas', { width: 560, height: 560 });
    ctx2 = cv.getContext('2d');
    els.result = h('div', { class: 'wheel-result' });
    els.status = h('div', { class: 'status-line' });
    els.history = h('div', { class: 'history' });
    els.mine = h('div', { class: 'row wrap', style: { marginTop: '10px', gap: '8px' } });
    els.others = h('div', { class: 'others' });
    const board = h('div', { class: 'rl-board' });
    const zero = cell('number', 0, '0', 'green rl-zero');
    zero.style.gridColumn = '1'; zero.style.gridRow = '1 / span 3';
    board.append(zero);
    for (let c = 0; c < 12; c++) {
      for (let r = 0; r < 3; r++) {
        const n = 3 * (c + 1) - r;
        const el = cell('number', n, String(n), colorOf(n));
        el.style.gridColumn = String(c + 2); el.style.gridRow = String(r + 1);
        board.append(el);
      }
    }
    fill(body,
      els.status,
      h('div', { class: 'rl-wrap' },
        h('div', {}, h('div', { class: 'wheel-box' }, cv, h('div', { class: 'pin' }), els.result), h('div', { class: 'label-h', style: { marginTop: '12px' } }, 'Last spins'), els.history),
        h('div', {},
          ctx.chips(h('div', { style: { marginBottom: '12px' } })),
          board,
          h('div', { class: 'rl-dozens' }, DOZ.map(([k, l]) => cell(k, null, `${l} · ×3`, 'out'))),
          h('div', { class: 'rl-outs' }, OUTS.map(([k, l]) => cell(k, null, `${l}`, 'out'))),
          h('p', { class: 'tiny faint', style: { marginTop: '6px' } }, 'Numbers pay ×36 · dozens ×3 · red/black, odd/even, low/high ×2 · 0 is the house’s number'),
          els.mine, els.others)));
    drawWheel(angle);
  }

  function update(state, ctx) {
    C = ctx;
    st = state;
    const n = state.result ? state.result.number : null;
    // board chips + highlights
    document.querySelectorAll('.rl-cell').forEach((el) => {
      const kind = el.dataset.kind;
      const value = el.dataset.value === '' ? null : Number(el.dataset.value);
      const mine = state.mine.filter((b) => b.kind === kind && (kind === 'number' ? b.value === value : true)).reduce((s, b) => s + b.amount, 0);
      const old = el.querySelector('.chip-mini');
      if (old) old.remove();
      if (mine) el.append(h('span', { class: 'chip-mini' }, mine >= 1000 ? `${+(mine / 1000).toFixed(1)}k` : mine));
      const hit = state.phase === 'results' && n != null && (kind === 'number' ? value === n : WINS[kind] && WINS[kind](n));
      el.classList.toggle('hit', !!hit);
    });
    if (state.phase === 'resolving' && state.result && spinRound !== state.round) {
      spinRound = state.round;
      Sfx.play('swoosh');
      spinTo(n, ctx.left(state.remaining, 'roulette'));
    } else if (state.phase === 'results' && spinRound !== state.round && state.result) {
      spinRound = state.round;
      angle = -WHEEL.indexOf(n) * SEG;
      drawWheel(angle);
      showResult(n);
    }
    if (state.phase === 'results') {
      const p = state.payouts[ctx.me];
      if (p && soundRound !== state.round) {
        soundRound = state.round;
        if (p.returned > 0) { Sfx.play('win'); if (p.returned - p.staked >= 500) PA.UI.confetti(120); if (ctx.fx.rain) ctx.fx.rain('🪙', 16); } else Sfx.play('lose');
      }
    }
    fill(els.history, (state.history || []).map((r) => h('span', { class: 'h-' + r.color }, r.number)));
    const total = state.mine.reduce((s, b) => s + b.amount, 0);
    fill(els.mine, total ? [h('span', { class: 'bold' }, `Your bets: ${ctx.fmt(total)}`),
      state.phase === 'betting' ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.send('roulette', 'clear') }, '↩️ Take back my bets') : null] : []);
    const others = Object.entries(state.bets).filter(([u]) => u !== ctx.me);
    fill(els.others, others.map(([u, b]) => { const p = ctx.player(u); return h('span', {}, `${p.avatar} ${p.name}: 🪙 ${ctx.fmt(b.total)}`); }));
    tick(ctx);
  }

  function tick(ctx) {
    if (!st || !els.status) return;
    const s = st;
    const t = Math.ceil(ctx.left(s.remaining, 'roulette') || 0);
    let txt;
    if (s.phase === 'idle') txt = [h('span', { class: 'big' }, '🎯 Place a bet'), h('span', { class: 'muted' }, 'The first bet starts a 15-second countdown for everyone.')];
    else if (s.phase === 'betting') txt = [h('span', { class: 'big' }, `⏳ ${t}s`), h('span', {}, 'Place your bets! Everyone’s spin is shared.')];
    else if (s.phase === 'resolving') txt = [h('span', { class: 'big' }, '🌀 Spinning…'), h('span', { class: 'muted' }, 'No more bets!')];
    else {
      const n = s.result.number;
      const p = s.payouts[ctx.me];
      txt = [h('span', { class: 'big' }, `${n} ${colorOf(n).toUpperCase()}`),
        p ? h('span', { class: 'bold', style: { color: p.returned ? 'var(--lime)' : 'var(--red)' } }, p.returned ? `You won ${ctx.fmt(p.returned)} (+${ctx.fmt(p.returned - p.staked)})` : `You lost ${ctx.fmt(p.staked)}`) : h('span', { class: 'muted' }, 'Next round soon…')];
    }
    fill(els.status, txt);
  }

  function unmount() { cancelAnimationFrame(raf); ctx2 = null; els = {}; }

  return { mount, update, tick, unmount };
})());
