/* Family Life casino: slots, roulette, blackjack, dice, horse racing, scratch cards and the lottery.
   The server decides every game (games/life/casino.py); this file only shows it happening, so you see the
   reels stop, the wheel slow down or the horses cross the line before you find out whether you won.
   LifeCasino({ hold, release }) → { open(state), onMessage(msg), busy(), refused() } */
window.LifeCasino = (api) => {
  'use strict';
  const { hold, release } = api;
  const { h, fill, Net, Sfx, UI, fmtMoney } = PA;
  const FX = PA.FX || {};
  const calm = () => document.documentElement.classList.contains('calm');
  const ms = (n) => (calm() ? Math.min(n, 250) : n);
  const wait = (n) => new Promise((r) => setTimeout(r, ms(n)));

  const GAMES = [['slots', '🎰 Slots'], ['roulette', '🎡 Roulette'], ['bj', '🃏 Blackjack'], ['dice', '🎲 Dice'], ['horses', '🐎 Horses'], ['scratch', '🎟️ Scratch'], ['lottery', '🎱 Lottery']];
  const CHIPS = [10, 100, 1000, 10000, 100000, 1000000];
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '💎', '7️⃣'];
  const short = (n) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${+(n / 1e3).toFixed(1)}K` : `$${n}`);

  let C = null;   // the open casino window: { close, box, game, bet, busy, st (server state), ... }

  // ---------------------------------------------------------------- window
  function open(st) {
    if (C) { C.st = st; drawTop(); drawGame(); return; }
    const box = h('div', { class: 'casino' });
    C = { box, st, game: PA.store.get('life_cz_game', 'slots'), bet: Math.min(100, Math.max(10, st.money)), busy: false,
      rouletteBet: 'red', diceBet: 'low', pick: null, picks: [], scratchPrice: st.scratch[0], angle: 0 };
    C.close = UI.modal(box, { wide: true, onClose: () => { C = null; release(); } });
    fill(box,
      h('div', { class: 'cz-top' }, h('h2', {}, '🎰 Casino'), h('div', { class: 'cz-stats', id: 'cz-stats' })),
      h('div', { class: 'cz-tabs', id: 'cz-tabs' }),
      h('div', { class: 'cz-stage', id: 'cz-stage' }),
      h('div', { class: 'cz-result', id: 'cz-result', 'aria-live': 'polite' }),
      h('div', { class: 'cz-bet', id: 'cz-bet' }));
    drawTop();
    drawGame();
  }
  const $c = (sel) => C && C.box.querySelector(sel);

  function drawTop() {
    const st = C.st;
    const money = $c('#cz-money') || h('b', { id: 'cz-money' }, fmtMoney(st.money));
    if (!C.busy && !money.dataset.counting) money.textContent = fmtMoney(st.money);
    fill($c('#cz-stats'),
      h('span', { class: 'cz-chip money' }, '💰 ', money),
      h('span', { class: 'cz-chip' }, `🎟️ ${st.left} game${st.left === 1 ? '' : 's'} left`),
      h('span', { class: 'cz-chip ' + (st.net > 0 ? 'up' : st.net < 0 ? 'down' : '') }, `Tonight: ${st.net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(st.net))}`));
    fill($c('#cz-tabs'), GAMES.map(([k, l]) => h('button', { class: k === C.game ? 'on' : '', disabled: C.busy || (C.st.bj && !C.st.bj.done && k !== 'bj'),
      onclick: () => { if (C.busy) return; C.game = k; PA.store.set('life_cz_game', k); Sfx.play('click'); fill($c('#cz-result')); drawTop(); drawGame(); } }, l)));
  }

  function drawBet(show) {
    const el = $c('#cz-bet');
    if (!show) { fill(el); return; }
    const money = C.st.money;
    const max = Math.max(0, Math.min(money, C.st.maxBet));
    C.bet = Math.max(C.st.minBet, Math.min(C.bet, max || C.st.minBet));
    const input = h('input', { class: 'input cz-bet-in', type: 'number', min: C.st.minBet, max, step: 10, value: C.bet, 'aria-label': 'Your bet',
      onchange: () => { C.bet = Math.max(C.st.minBet, Math.min(max, Math.round(+input.value || 0))); input.value = C.bet; drawBet(true); } });
    fill(el, h('span', { class: 'cz-bet-l' }, 'Bet'),
      CHIPS.filter((c) => c <= max).map((c) => h('button', { class: 'cz-bchip' + (c === C.bet ? ' on' : ''), disabled: C.busy, onclick: () => { C.bet = c; Sfx.play('coin'); drawBet(true); } }, short(c))),
      max > C.st.minBet ? h('button', { class: 'cz-bchip allin' + (C.bet === max ? ' on' : ''), disabled: C.busy, onclick: () => { C.bet = max; Sfx.play('boing'); drawBet(true); } }, 'ALL IN') : null,
      input);
  }

  function setBusy(b) {
    C.busy = b;
    if (b) hold(); else release();
    C.box.querySelectorAll('.cz-go, .cz-bchip, .cz-opt, .cz-tabs button').forEach((x) => { x.disabled = b; });
    if (!b) drawTop();
  }
  const cantPlay = () => C.busy || C.st.left <= 0;

  /** The big "you won / you lost" line under the game. */
  function showResult(bet, win, label) {
    const net = win - bet;
    const el = $c('#cz-result');
    if (!el) return;
    const cls = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
    const text = net > 0 ? `🎉 ${label || 'WIN'}  +${fmtMoney(net)}` : net < 0 ? `${label || 'No luck'}  −${fmtMoney(-net)}` : `🤝 ${label || 'Push'} · money back`;
    fill(el, h('div', { class: 'cz-res ' + cls }, text));
    if (FX.pop) FX.pop(el.firstChild, { from: 0.6 });
    if (net > 0) { Sfx.play('win'); if (win >= bet * 10) UI.confetti(win >= bet * 100 ? 260 : 120); } else if (net < 0) Sfx.play('lose');
    const money = $c('#cz-money');
    if (money && FX.count && !calm()) {
      money.dataset.counting = '1';
      FX.count(money, C.st.money, { from: C.st.money - net, format: fmtMoney });
      setTimeout(() => { delete money.dataset.counting; money.textContent = fmtMoney(C.st.money); }, 1300);
    } else if (money) money.textContent = fmtMoney(C.st.money);
  }

  function apply(msg) {
    C.st = { ...C.st, money: msg.money, left: msg.left, net: msg.net, field: msg.field || C.st.field };
    if (msg.op === 'bj') C.st.bj = msg.bj;
  }

  // ---------------------------------------------------------------- games
  function drawGame() {
    const stage = $c('#cz-stage');
    fill(stage);
    stage.className = 'cz-stage g-' + C.game;
    if (C.st.left <= 0 && !(C.st.bj && !C.st.bj.done)) {
      fill(stage, h('div', { class: 'cz-closed' }, h('div', { class: 'big' }, '🌙'), h('b', {}, 'That’s all your games for tonight.'), h('p', { class: 'muted small' }, 'The casino opens again next time you have energy.')));
      drawBet(false);
      return;
    }
    ({ slots: drawSlots, roulette: drawRoulette, bj: drawBj, dice: drawDice, horses: drawHorses, scratch: drawScratch, lottery: drawLottery })[C.game]();
  }

  function send(op, data) {
    if (cantPlay()) return;
    if (!['scratch', 'lottery'].includes(op) && C.bet > C.st.money) { UI.toast('You don’t have that much money.', 'bad'); return; }
    setBusy(true);
    fill($c('#cz-result'));
    Net.send('g:casino', { op, ...data });
  }

  // 🎰 slots: three reels that stop one after another
  function drawSlots() {
    const reels = [0, 1, 2].map(() => h('div', { class: 'reel' }, h('div', { class: 'strip' }, h('div', { class: 'sym' }, SYMBOLS[Math.floor(Math.random() * 5)]))));
    fill($c('#cz-stage'),
      h('div', { class: 'slots' }, reels),
      h('div', { class: 'cz-pay' }, '7️⃣7️⃣7️⃣ ×3000 · 💎 ×600 · ⭐ ×200 · 🔔 ×80 · 🍇 ×30 · 🍊 ×18 · 🍋 ×12 · 🍒🍒🍒 ×8 · any two 🍒 ×2'),
      h('button', { class: 'btn btn-pink btn-lg cz-go', onclick: () => send('slots', { bet: C.bet }) }, '🎰 SPIN'));
    drawBet(true);
  }
  async function playSlots(msg) {
    const reels = [...C.box.querySelectorAll('.reel')];
    const H = reels[0].getBoundingClientRect().height || 96;
    await Promise.all(reels.map((reel, i) => new Promise((done) => {
      const strip = reel.querySelector('.strip');
      const n = 18 + i * 7;
      const syms = Array.from({ length: n }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
      syms.push(msg.result.reels[i]);
      fill(strip, syms.map((s) => h('div', { class: 'sym' }, s)));
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      void strip.offsetHeight;
      const dur = ms(1100 + i * 550);
      strip.style.transition = `transform ${dur}ms cubic-bezier(.12,.8,.25,1)`;
      strip.style.transform = `translateY(${-n * H}px)`;
      setTimeout(() => { Sfx.play('tick'); reel.classList.add('stop'); done(); }, dur);
    })));
    if (msg.result.mult > 0) reels.forEach((r) => r.classList.add('win'));
    showResult(msg.bet, msg.win, msg.result.jackpot ? '7️⃣7️⃣7️⃣ JACKPOT!' : msg.result.mult >= 30 ? 'BIG WIN!' : null);
  }

  // 🎡 roulette: a European wheel that spins down to the winning number
  function wheelSvg() {
    const R = 140;
    const sa = 360 / 37;
    const pt = (a, r) => [R + r * Math.sin((a * Math.PI) / 180), R - r * Math.cos((a * Math.PI) / 180)];
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${R * 2} ${R * 2}`);
    svg.setAttribute('class', 'wheel');
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'wheel-g');
    WHEEL.forEach((n, i) => {
      const [x1, y1] = pt(i * sa, R - 4);
      const [x2, y2] = pt((i + 1) * sa, R - 4);
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M${R},${R} L${x1},${y1} A${R - 4},${R - 4} 0 0 1 ${x2},${y2} Z`);
      path.setAttribute('fill', n === 0 ? '#16a34a' : REDS.has(n) ? '#dc2626' : '#111827');
      path.setAttribute('stroke', '#facc15');
      path.setAttribute('stroke-width', '0.6');
      g.append(path);
      const [tx, ty] = pt(i * sa + sa / 2, R - 20);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', tx); t.setAttribute('y', ty);
      t.setAttribute('transform', `rotate(${i * sa + sa / 2} ${tx} ${ty})`);
      t.setAttribute('class', 'wn');
      t.textContent = n;
      g.append(t);
    });
    const hub = document.createElementNS(ns, 'circle');
    hub.setAttribute('cx', R); hub.setAttribute('cy', R); hub.setAttribute('r', R * 0.55); hub.setAttribute('class', 'hub');
    g.append(hub);
    svg.append(g);
    return svg;
  }
  function drawRoulette() {
    const opt = (k, l, cls = '') => h('button', { class: 'cz-opt ' + cls + (C.rouletteBet === k ? ' on' : ''), onclick: () => { C.rouletteBet = k; Sfx.play('click'); drawRoulette(); } }, l);
    const num = h('select', { class: 'select cz-num', 'aria-label': 'Number', onchange: () => { C.rouletteBet = +num.value; drawRoulette(); } },
      h('option', { value: '' }, 'Pick a number…'), Array.from({ length: 37 }, (_, n) => h('option', { value: n, selected: C.rouletteBet === n }, String(n))));
    const wheel = h('div', { class: 'wheel-wrap' }, h('div', { class: 'pointer' }, '▼'), wheelSvg(), h('div', { class: 'wheel-num', id: 'wheel-num' }, '?'));
    fill($c('#cz-stage'),
      wheel,
      h('div', { class: 'cz-opts' }, opt('red', '🔴 Red ×2', 'red'), opt('black', '⚫ Black ×2', 'black'), opt('odd', 'Odd ×2'), opt('even', 'Even ×2'),
        opt('low', '1–18 ×2'), opt('high', '19–36 ×2'), opt('zero', '🟢 0 ×36', 'green')),
      h('div', { class: 'cz-opts' }, num, typeof C.rouletteBet === 'number' ? h('span', { class: 'cz-chip on' }, `On ${C.rouletteBet} · pays ×36`) : null),
      h('button', { class: 'btn btn-pink btn-lg cz-go', onclick: () => send('roulette', { bet: C.bet, choice: C.rouletteBet }) }, '🎡 SPIN THE WHEEL'));
    const g = wheel.querySelector('.wheel-g');
    g.style.transform = `rotate(${C.angle}deg)`;
    drawBet(true);
  }
  async function playRoulette(msg) {
    const g = C.box.querySelector('.wheel-g');
    const sa = 360 / 37;
    const center = msg.result.slot * sa + sa / 2;
    const now = ((C.angle % 360) + 360) % 360;
    const target = ((360 - center - now) % 360 + 360) % 360;
    C.angle += 360 * 6 + target;
    const dur = ms(4300);
    g.style.transition = `transform ${dur}ms cubic-bezier(.12,.72,.18,1)`;
    g.style.transform = `rotate(${C.angle}deg)`;
    const ticker = setInterval(() => Sfx.play('tick'), 160);
    await wait(dur);
    clearInterval(ticker);
    const n = msg.result.n;
    const el = C.box.querySelector('#wheel-num');
    if (el) { el.textContent = n; el.className = 'wheel-num ' + msg.result.color; if (FX.pop) FX.pop(el, { from: 0.4 }); }
    showResult(msg.bet, msg.win, msg.win ? `${n} ${msg.result.color.toUpperCase()}!` : `${n} ${msg.result.color}`);
  }

  // 🃏 blackjack: deal, hit, stand or double; the dealer's hidden card flips at the end
  const cardEl = (c, hidden) => {
    if (hidden || c[0] === '?') return h('div', { class: 'card back' }, h('span', {}, '🂠'));
    const red = c[1] === '♥' || c[1] === '♦';
    return h('div', { class: 'card' + (red ? ' red' : '') }, h('span', { class: 'r' }, c[0]), h('span', { class: 's' }, c[1]));
  };
  function drawBj() {
    const hand = C.st.bj;
    const live = hand && !hand.done;
    fill($c('#cz-stage'),
      h('div', { class: 'bj' },
        h('div', { class: 'bj-row' }, h('div', { class: 'bj-l' }, 'Dealer', h('b', { id: 'bj-dv' }, hand ? hand.dv : '')), h('div', { class: 'bj-cards', id: 'bj-dealer' }, hand ? hand.dealer.map((c) => cardEl(c)) : null)),
        h('div', { class: 'bj-row' }, h('div', { class: 'bj-l' }, 'You', h('b', { id: 'bj-pv' }, hand ? hand.pv : '')), h('div', { class: 'bj-cards', id: 'bj-player' }, hand ? hand.player.map((c) => cardEl(c)) : null))),
      live
        ? h('div', { class: 'cz-opts' },
          h('button', { class: 'btn btn-cyan cz-go', onclick: () => bjMove('hit') }, '👆 Hit'),
          h('button', { class: 'btn btn-yellow cz-go', onclick: () => bjMove('stand') }, '✋ Stand'),
          hand.player.length === 2 ? h('button', { class: 'btn btn-orange cz-go', onclick: () => bjMove('double') }, `✌️ Double (${fmtMoney(hand.bet)} more)`) : null)
        : h('button', { class: 'btn btn-pink btn-lg cz-go', onclick: () => send('bj', { move: 'deal', bet: C.bet }) }, '🃏 DEAL'),
      h('div', { class: 'cz-pay' }, 'Blackjack pays 3 to 2 · dealer stands on 17 · double on your first two cards'));
    drawBet(!live);
  }
  function bjMove(move) {
    if (C.busy) return;
    setBusy(true);
    Net.send('g:casino', { op: 'bj', move });
  }
  async function playBj(msg, old) {
    const hand = msg.bj;
    const fresh = !old || old.done;      // a new deal (otherwise a hit, stand or double on the same hand)
    const before = fresh ? { player: 0, dealer: 0 } : { player: old.player.length, dealer: old.dealer.length };
    C.st.bj = hand;
    if (fresh) drawBj();
    const pRow = C.box.querySelector('#bj-player');
    const dRow = C.box.querySelector('#bj-dealer');
    if (fresh) { fill(pRow); fill(dRow); }
    const deal = async (row, c, hidden) => { const el = cardEl(c, hidden); row.append(el); el.classList.add('deal'); Sfx.play('swoosh'); await wait(320); };
    if (fresh) {
      await deal(pRow, hand.player[0]); await deal(dRow, hand.dealer[0]); await deal(pRow, hand.player[1]);
      await deal(dRow, hand.dealer[1], !hand.done);
    } else {
      for (const c of hand.player.slice(before.player)) await deal(pRow, c);
    }
    C.box.querySelector('#bj-pv').textContent = hand.pv;
    if (hand.done) {
      const hole = dRow.children[1];
      if (hole && hole.classList.contains('back')) { const el = cardEl(hand.dealer[1]); el.classList.add('flip'); hole.replaceWith(el); Sfx.play('pop'); await wait(450); }
      for (const c of hand.dealer.slice(Math.max(2, fresh ? 2 : before.dealer))) await deal(dRow, c);
      C.box.querySelector('#bj-dv').textContent = hand.dv;
      const label = { blackjack: '🃏 BLACKJACK!', win: 'You beat the dealer!', lose: 'Dealer wins', bust: '💥 Bust!', push: 'Push' }[hand.outcome];
      showResult(hand.bet, msg.win, label);
    } else {
      C.box.querySelector('#bj-dv').textContent = hand.dv;
    }
  }

  // 🎲 lucky dice: two dice tumble and land
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const die = (n) => h('div', { class: 'die' }, Array.from({ length: 9 }, (_, i) => h('i', { class: PIPS[n].includes(i) ? 'on' : '' })));
  function drawDice() {
    const opt = (k, l) => h('button', { class: 'cz-opt' + (C.diceBet === k ? ' on' : ''), onclick: () => { C.diceBet = k; Sfx.play('click'); drawDice(); } }, l);
    fill($c('#cz-stage'),
      h('div', { class: 'dice', id: 'dice' }, die(3), die(4)),
      h('div', { class: 'cz-opts' }, opt('low', '⬇️ Low 2–6 ×2.3'), opt('high', '⬆️ High 8–12 ×2.3'), opt('seven', '🍀 Lucky 7 ×5.5'), opt('doubles', '👯 Doubles ×5.5')),
      h('button', { class: 'btn btn-pink btn-lg cz-go', onclick: () => send('dice', { bet: C.bet, choice: C.diceBet }) }, '🎲 ROLL'));
    drawBet(true);
  }
  async function playDice(msg) {
    const box = C.box.querySelector('#dice');
    box.classList.add('rolling');
    const end = performance.now() + ms(1000);
    while (performance.now() < end) {
      fill(box, die(1 + Math.floor(Math.random() * 6)), die(1 + Math.floor(Math.random() * 6)));
      Sfx.play('tick');
      await new Promise((r) => setTimeout(r, 90));
    }
    box.classList.remove('rolling');
    fill(box, die(msg.result.dice[0]), die(msg.result.dice[1]));
    box.querySelectorAll('.die').forEach((d) => { if (FX.pop) FX.pop(d, { from: 0.7 }); });
    showResult(msg.bet, msg.win, `Rolled ${msg.result.total}${msg.result.dice[0] === msg.result.dice[1] ? ' (doubles)' : ''}`);
  }

  // 🐎 horse racing: pick a horse, then watch the race
  function drawHorses(raced) {
    const field = raced ? raced.field : C.st.field;
    const lanes = field.map((f, i) => h('button', { class: 'lane' + (C.pick === i && !raced ? ' on' : ''), disabled: !!raced, onclick: () => { C.pick = i; Sfx.play('click'); drawHorses(); } },
      h('span', { class: 'lane-info' }, h('b', {}, f.name), h('span', { class: 'odds' }, `×${f.odds}`)),
      h('span', { class: 'track' }, h('span', { class: 'horse', style: { '--c': f.color } }, h('span', { class: 'hz' }, '🏇')), h('span', { class: 'finish' }))));
    fill($c('#cz-stage'),
      h('div', { class: 'race' }, lanes),
      raced ? h('button', { class: 'btn btn-cyan cz-go', disabled: C.busy, onclick: () => { C.pick = null; drawHorses(); } }, '🔁 Next race')
        : h('button', { class: 'btn btn-pink btn-lg cz-go', disabled: C.pick == null, onclick: () => send('horses', { bet: C.bet, pick: C.pick }) }, C.pick == null ? 'Pick a horse first' : `🏁 START · ${field[C.pick].name}`));
    drawBet(!raced);
  }
  async function playHorses(msg) {
    const r = msg.result;
    drawHorses(r);
    const horses = [...C.box.querySelectorAll('.horse')];
    const tracks = [...C.box.querySelectorAll('.track')];
    const D = ms(5400);
    const rank = {};
    r.order.forEach((lane, i) => { rank[lane] = i; });
    const look = horses.map((_, i) => ({ T: D * (0.8 + 0.038 * rank[i]), a: (Math.random() - 0.5) * 0.16, b: (Math.random() - 0.5) * 0.07 }));
    const width = tracks.map((t) => t.clientWidth - 30);
    Sfx.play('go');
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = now - t0;
        horses.forEach((el, i) => {
          const u = Math.min(1, t / look[i].T);
          const p = u + look[i].a * Math.sin(Math.PI * u) + look[i].b * Math.sin(2 * Math.PI * u);
          el.style.transform = `translateX(${Math.max(0, p) * width[i]}px)`;
        });
        if (t < D) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const lanes = [...C.box.querySelectorAll('.lane')];
    lanes[r.winner].classList.add('won');
    if (r.pick !== r.winner) lanes[r.pick].classList.add('lost');
    showResult(msg.bet, msg.win, msg.win ? `${r.field[r.winner].name} WON!` : `${r.field[r.winner].name} won`);
  }

  // 🎟️ scratch cards: buy one, then scratch it with your finger or mouse
  function drawScratch() {
    const prices = C.st.scratch;
    fill($c('#cz-stage'),
      h('div', { class: 'cz-opts' }, prices.map((p) => h('button', { class: 'cz-opt' + (C.scratchPrice === p ? ' on' : ''), onclick: () => { C.scratchPrice = p; Sfx.play('click'); drawScratch(); } }, `${short(p)} card`))),
      h('div', { class: 'scratch-card empty' }, h('div', { class: 'sc-hint' }, `Match three amounts to win! Top prize: ${fmtMoney(C.scratchPrice * 5000)}`)),
      h('button', { class: 'btn btn-pink btn-lg cz-go', onclick: () => send('scratch', { price: C.scratchPrice }) }, `🎟️ BUY A ${short(C.scratchPrice)} CARD`));
    drawBet(false);
  }
  function playScratch(msg) {
    return new Promise((done) => {
      const r = msg.result;
      const counts = {};
      r.cells.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const cells = r.cells.map((v) => h('div', { class: 'sc-cell' + (r.mult && counts[v] >= 3 ? ' match' : '') }, short(v)));
      const canvas = h('canvas', { class: 'sc-cover' });
      const card = h('div', { class: 'scratch-card' }, h('div', { class: 'sc-grid' }, cells), canvas);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        canvas.style.transition = `opacity ${ms(350)}ms`;
        canvas.style.opacity = '0';
        setTimeout(() => { canvas.remove(); card.classList.add('done'); showResult(msg.bet, msg.win, r.mult ? 'THREE OF A KIND!' : 'No match'); done(); }, ms(380));
      };
      fill($c('#cz-stage'), card, h('button', { class: 'btn btn-ghost cz-reveal', onclick: finish }, '✨ Reveal all'));
      requestAnimationFrame(() => {
        const w = card.clientWidth;
        const hgt = card.clientHeight;
        canvas.width = w; canvas.height = hgt;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, w, hgt);
        grad.addColorStop(0, '#d4d4d8'); grad.addColorStop(0.5, '#a1a1aa'); grad.addColorStop(1, '#e4e4e7');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, hgt);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.font = '700 15px Fredoka, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SCRATCH HERE ✨', w / 2, hgt / 2 + 5);
        if (calm()) { finish(); return; }
        ctx.globalCompositeOperation = 'destination-out';
        let down = false;
        let moves = 0;
        let last = null;
        ctx.lineWidth = 44;
        ctx.lineCap = 'round';
        const scratch = (e) => {
          const b = canvas.getBoundingClientRect();
          const x = (e.clientX - b.left) * (w / b.width);
          const y = (e.clientY - b.top) * (hgt / b.height);
          ctx.beginPath();                 // a line from the last point, so a fast swipe scratches the whole way
          ctx.moveTo(last ? last[0] : x, last ? last[1] : y);
          ctx.lineTo(x, y);
          ctx.stroke();
          last = [x, y];
          if (++moves % 12 === 0) {
            const data = ctx.getImageData(0, 0, w, hgt).data;
            let clear = 0;
            let total = 0;
            for (let i = 3; i < data.length; i += 4 * 40) { total++; if (data[i] === 0) clear++; }
            if (clear / total > 0.55) finish();
          }
          if (moves % 6 === 0) Sfx.play('tick');
        };
        canvas.addEventListener('pointerdown', (e) => { down = true; last = null; canvas.setPointerCapture(e.pointerId); scratch(e); });
        canvas.addEventListener('pointermove', (e) => { if (down) scratch(e); });
        canvas.addEventListener('pointerup', () => { down = false; last = null; });
      });
    });
  }

  // 🎱 lottery: pick 5 numbers (or a quick pick), then watch the balls come out
  function drawLottery() {
    const picks = C.picks;
    fill($c('#cz-stage'),
      h('div', { class: 'lotto-grid' }, Array.from({ length: 30 }, (_, i) => i + 1).map((n) => h('button', {
        class: 'ball-btn' + (picks.includes(n) ? ' on' : ''), disabled: !picks.includes(n) && picks.length >= 5,
        onclick: () => { C.picks = picks.includes(n) ? picks.filter((x) => x !== n) : [...picks, n]; Sfx.play('click'); drawLottery(); },
      }, n))),
      h('div', { class: 'lotto-draw', id: 'lotto-draw' }),
      h('div', { class: 'cz-opts' },
        h('button', { class: 'btn btn-ghost cz-opt', onclick: () => { const all = Array.from({ length: 30 }, (_, i) => i + 1); C.picks = []; while (C.picks.length < 5) { const n = all.splice(Math.floor(Math.random() * all.length), 1)[0]; C.picks.push(n); } Sfx.play('boing'); drawLottery(); } }, '🎲 Quick pick'),
        h('button', { class: 'btn btn-pink btn-lg cz-go', disabled: picks.length !== 5, onclick: () => send('lottery', { picks }) }, picks.length === 5 ? `🎱 BUY A TICKET (${fmtMoney(C.st.lotto)})` : `Pick ${5 - picks.length} more`)),
      h('div', { class: 'cz-pay' }, '5 numbers: $2,000,000 · 4: $1,000 · 3: $50 · 2: $5'));
    drawBet(false);
  }
  async function playLottery(msg) {
    const r = msg.result;
    const out = C.box.querySelector('#lotto-draw');
    fill(out);
    for (const n of r.drawn) {
      const hit = r.picks.includes(n);
      const ball = h('span', { class: 'ball' + (hit ? ' hit' : '') }, n);
      out.append(ball);
      ball.classList.add('drop');
      Sfx.play(hit ? 'coin' : 'pop');
      await wait(750);
    }
    C.box.querySelectorAll('.ball-btn').forEach((b) => { if (r.drawn.includes(+b.textContent)) b.classList.add('drawn'); });
    showResult(msg.bet, msg.win, `${r.hits} match${r.hits === 1 ? '' : 'es'}`);
  }

  // ---------------------------------------------------------------- server replies
  async function onMessage(msg) {
    if (msg.op === 'enter') { open(msg); return; }
    if (!C) return;
    const game = msg.op;
    const prevBj = C.st.bj;
    apply(msg);
    try {
      if (game === 'slots') await playSlots(msg);
      else if (game === 'roulette') await playRoulette(msg);
      else if (game === 'bj') await playBj(msg, prevBj);
      else if (game === 'dice') await playDice(msg);
      else if (game === 'horses') await playHorses(msg);
      else if (game === 'scratch') await playScratch(msg);
      else if (game === 'lottery') await playLottery(msg);
    } catch (e) { console.error(e); }
    if (!C) return;
    setBusy(false);
    if (game === 'bj') drawBj();
    else if (game === 'horses') drawBet(false);
    else if (C.st.left <= 0) drawGame();
    else drawBet(!['scratch', 'lottery'].includes(game));
    C.box.querySelectorAll('.cz-go').forEach((x) => { x.disabled = false; });
    if (game === 'horses' && C.st.left <= 0) drawGame();
  }

  return {
    open,
    onMessage,
    busy: () => !!(C && C.busy),
    /** A refused bet (the server said no): let the player try again. */
    refused() { if (C && C.busy) setBusy(false); },
  };
};
