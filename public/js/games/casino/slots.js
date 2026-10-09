/* Slots — your own machine. The server picks the symbols; we just animate. */
Casino.register('slots', (() => {
  const { h, fill, Sfx, UI } = PA;
  const SYMS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'];
  let els = {}, C, spinning = false, auto = false, timers = [], cyclers = [], recent = [], paytableDone = false, watchdog = null;

  function reelEl() { return h('div', { class: 'reel' }, h('span', {}, SYMS[Math.floor(Math.random() * SYMS.length)])); }

  function startReels() {
    stopCyclers();
    els.reels.forEach((r) => {
      r.classList.remove('stop'); r.classList.add('spinning');
      cyclers.push(setInterval(() => { r.firstChild.textContent = SYMS[Math.floor(Math.random() * SYMS.length)]; }, 70));
    });
  }
  function stopCyclers() { cyclers.forEach(clearInterval); cyclers = []; }

  function spin() {
    if (spinning || !C.canPlay()) return;
    if (C.coins() < C.bet()) { C.toast('Not enough coins for that bet 💸', 'bad'); auto = false; renderAuto(); return; }
    spinning = true;
    els.btn.disabled = true;
    els.win.textContent = '';
    startReels();
    Sfx.play('swoosh');
    C.send('slots', 'spin', { amount: C.bet() });
    clearTimeout(watchdog);
    watchdog = setTimeout(() => { if (spinning) finish(); }, 3500);
  }

  function onSpin(m, ctx) {
    C = ctx;
    if (!els.reels) return;
    clearTimeout(watchdog);
    if (!spinning) startReels();
    spinning = true;
    els.btn.disabled = true;
    m.reels.forEach((sym, i) => {
      timers.push(setTimeout(() => {
        const r = els.reels[i];
        clearInterval(cyclers[i]);
        r.classList.remove('spinning'); r.classList.add('stop');
        r.firstChild.textContent = sym;
        Sfx.play('tick');
      }, 350 + i * 330));
    });
    timers.push(setTimeout(() => {
      stopCyclers();
      if (m.win) {
        els.win.textContent = `${m.mult >= 20 ? '🎉 JACKPOT! ' : '✨ '}+${ctx.fmt(m.win)} (×${m.mult})`;
        Sfx.play(m.mult >= 20 ? 'win' : 'coin');
        if (m.mult >= 20) UI.confetti(180);
      } else {
        els.win.textContent = 'No luck this time…';
      }
      recent = [m, ...recent].slice(0, 8);
      renderRecent();
      finish();
    }, 1400));
  }

  function finish() {
    spinning = false;
    stopCyclers();
    if (els.btn) els.btn.disabled = false;
    if (auto) timers.push(setTimeout(() => { if (auto) spin(); }, 700));
  }

  function renderAuto() { if (els.auto) els.auto.textContent = auto ? '⏹ Stop auto' : '🔁 Auto spin'; }
  function renderRecent() {
    if (!els.recent) return;
    fill(els.recent, recent.map((r) => h('div', {}, h('span', {}, r.reels.join(' ')), h('b', { style: { color: r.win ? 'var(--lime)' : 'var(--faint)' } }, r.win ? `+${C.fmt(r.win)}` : `-${C.fmt(r.amount)}`))));
  }

  function mount(body, ctx) {
    C = ctx;
    paytableDone = false;
    els.reels = [reelEl(), reelEl(), reelEl()];
    els.win = h('div', { class: 'slot-win' });
    els.btn = h('button', { class: 'btn btn-yellow btn-lg btn-block', onclick: spin }, '🎰 SPIN');
    els.auto = h('button', { class: 'btn btn-ghost', onclick: () => { auto = !auto; renderAuto(); if (auto) spin(); } });
    els.pay = h('div', { class: 'paytable' });
    els.recent = h('div', { class: 'paytable', style: { gridTemplateColumns: '1fr' } });
    renderAuto();
    fill(body,
      h('div', { class: 'slot-machine' },
        h('div', { class: 'slot-title' }, '★ LUCKY 7s ★'),
        h('div', { class: 'reels' }, els.reels),
        els.win,
        ctx.chips(h('div', { style: { justifyContent: 'center', marginBottom: '12px' } })),
        h('div', { class: 'row', style: { gap: '10px' } }, els.btn, els.auto)),
      h('div', { class: 'duel-grid', style: { marginTop: '16px' } },
        h('div', {}, h('div', { class: 'label-h' }, '💰 Paytable (× your bet)'), els.pay),
        h('div', {}, h('div', { class: 'label-h' }, '🕘 Your last spins'), els.recent)));
    renderRecent();
    addEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.code === 'Space' && e.target.tagName !== 'INPUT' && els.btn) { e.preventDefault(); spin(); } }

  function update(state) {
    if (!paytableDone && els.pay && state.paytable) {
      paytableDone = true;
      fill(els.pay, state.paytable.map((r) => h('div', {}, h('span', {}, r.combo.join(' ')), h('b', {}, `×${r.mult}`))));
    }
  }

  function unmount() {
    auto = false;
    timers.forEach(clearTimeout); timers = [];
    stopCyclers();
    clearTimeout(watchdog);
    spinning = false;
    removeEventListener('keydown', onKey);
    els = {};
  }

  return { mount, update, onSpin, unmount };
})());
