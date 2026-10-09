/* Casino Night — match screen, lobby, scoreboard and shared helpers.
   Each game lives in its own file and calls Casino.register(key, module). */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store } = PA;

  const modules = {};
  let S = { phase: 'lobby', settings: { games: {} }, games: [], allowed: [], scores: [], info: {}, feed: [], tables: {}, summaries: {}, results: null, spectator: false };
  let current = store.get('casino_game', 'roulette');
  let mounted = null;
  let betAmount = store.get('casino_bet', 50);
  const stateAt = {};
  const prevCoins = {};
  const chipRows = new Set();
  let infoAt = performance.now();

  const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');
  const myRow = () => S.scores.find((r) => r.id === Net.id);
  const coins = () => (myRow() || {}).coins || 0;
  const player = (uid) => S.scores.find((r) => r.id === uid) || Room.player(uid) || { name: 'Someone', avatar: '❓', color: '#888888' };
  const gameInfo = (key) => S.games.find((g) => g.key === key) || { key, title: key, emoji: '🎲', mode: 'house' };
  const canPlay = () => S.phase === 'playing' && !S.spectator && myRow() && !myRow().out;

  // ================================================================ helpers for game modules
  const CHIP_COLORS = [[1, '#64748b'], [5, '#ef4444'], [10, '#3b82f6'], [25, '#16a34a'], [50, '#f97316'], [100, '#111827'], [250, '#db2777'], [500, '#7c3aed'], [1000, '#ca8a04'], [5000, '#0891b2'], [1e12, '#be123c']];
  const chipColor = (v) => CHIP_COLORS.find(([lim]) => v <= lim)[1];
  const short = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

  function chipValues() {
    const { minBet = 10, maxBet = 1000 } = S.settings;
    const base = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 100000];
    let vals = base.filter((v) => v >= minBet && (!maxBet || v <= maxBet));
    if (!vals.includes(minBet)) vals.unshift(minBet);
    if (maxBet && !vals.includes(maxBet)) vals.push(maxBet);
    if (vals.length > 7) {
      const keep = [vals[0]];
      for (let i = 1; i < 6; i++) keep.push(vals[Math.round((i * (vals.length - 1)) / 6)]);
      keep.push(vals[vals.length - 1]);
      vals = [...new Set(keep)];
    }
    return vals;
  }

  function bet() {
    const { minBet = 10, maxBet = 0 } = S.settings;
    let b = Math.max(minBet, betAmount);
    if (maxBet) b = Math.min(b, maxBet);
    return b;
  }

  function renderChips(el) {
    const mine = coins();
    const cur = bet();
    const vals = chipValues();
    fill(el,
      h('span', { class: 'small muted bold' }, 'Bet:'),
      vals.map((v) => h('button', {
        class: 'chip-btn' + (v === cur ? ' on' : ''), style: { '--cc': chipColor(v) }, disabled: v > mine, title: `${fmt(v)} coins`,
        onclick: () => { betAmount = v; store.set('casino_bet', v); Sfx.play('click'); chipRows.forEach(renderChips); },
      }, short(v))),
      h('span', { class: 'chip-mini', style: { marginLeft: '6px', minWidth: '54px', height: '30px', fontSize: '.85rem' } }, fmt(cur)));
  }

  function chips(el) {
    el.classList.add('chips-row');
    chipRows.add(el);
    renderChips(el);
    return el;
  }

  function card(c, o = {}) {
    const cls = (extra) => `pcard${o.sm ? ' sm' : ''}${o.deal ? ' deal' : ''}${o.win ? ' win' : ''}${extra}`;
    const style = o.delay ? { animationDelay: o.delay + 's' } : null;
    if (!c || c === '??') return h('div', { class: cls(' back'), style }, h('span'));
    const r = c[0] === 'T' ? '10' : c[0];
    const s = c[1];
    return h('div', { class: cls(s === '♥' || s === '♦' ? ' red' : ''), style, title: r + s }, h('span', { class: 'r' }, r), h('span', { class: 's' }, s), h('span', { class: 'r2' }, r));
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function die(n, o = {}) {
    const el = h('div', { class: 'die' + (o.sm ? ' sm' : '') });
    setDie(el, n);
    return el;
  }
  function setDie(el, n) {
    fill(el, Array.from({ length: 9 }, (_, i) => ((PIPS[n] || []).includes(i) ? h('i') : h('span'))));
  }
  /** Tumble some dice for `ms`, then land on the final values. */
  function rollDice(els, finals, ms) {
    els.forEach((e) => e.classList.add('rolling'));
    const t = setInterval(() => els.forEach((e) => setDie(e, 1 + Math.floor(Math.random() * 6))), 90);
    setTimeout(() => { clearInterval(t); els.forEach((e, i) => { e.classList.remove('rolling'); setDie(e, finals[i]); }); }, Math.max(0, ms));
  }

  function left(remaining, key) {
    if (remaining == null) return null;
    return Math.max(0, remaining - (performance.now() - (stateAt[key] || performance.now())) / 1000);
  }

  const ctx = {
    get me() { return Net.id; },
    get settings() { return S.settings; },
    get scores() { return S.scores; },
    send: (game, a, data = {}) => Net.send('g:tbl', { game, a, ...data }),
    bet, coins, chips, card, die, setDie, rollDice, player, fmt, left, canPlay,
    toast: UI.toast, sfx: Sfx, h, fill,
  };

  function register(key, mod) { modules[key] = mod; }

  // ================================================================ lobby
  function renderLobby() {
    const el = $('#room-main');
    const host = Room.isHost;
    const st = S.settings;
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, opts, fmtFn = (v) => v) => h('div', { class: 'seg' }, opts.map((v) => h('button', { class: st[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, fmtFn(v))));
    const numIn = (key, min, max) => h('input', { class: 'input num-in', type: 'number', min, max, value: st[key], disabled: !host, onchange: (e) => send({ [key]: Number(e.target.value) }) });
    const kids = [];
    if (S.phase === 'over' && S.results) kids.push(renderResults());
    const house = S.games.filter((g) => g.mode === 'house');
    const pvp = S.games.filter((g) => g.mode === 'players');
    const toggle = (g) => h('button', { class: 'gt' + (st.games[g.key] ? ' on' : ''), disabled: !host, onclick: () => send({ games: { [g.key]: !st.games[g.key] } }) },
      h('span', { class: 'e' }, g.emoji), h('span', {}, g.title), h('span', { class: 'badge ' + (g.mode === 'house' ? 'vs-house' : 'vs-players') }, g.mode === 'house' ? 'VS HOUSE' : 'VS PLAYERS'));
    kids.push(
      h('div', { class: 'panel-title' }, '🎰 Match settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('p', { class: 'fake-note', style: { marginBottom: '14px' } }, '🪙 Fake coins only — no real money, nothing to buy. Coins reset every match.'),
      h('div', { class: 'set-grid' },
        h('div', {}, h('div', { class: 'label-h' }, 'Starting coins'), h('div', { class: 'row wrap', style: { gap: '6px' } }, seg('startCoins', [500, 1000, 5000], fmt), numIn('startCoins', 100, 1000000))),
        h('div', {}, h('div', { class: 'label-h' }, 'How to win'), seg('winMode', ['time', 'rounds', 'target'], (v) => ({ time: '⏱ Time limit', rounds: '🔁 Rounds', target: '🎯 First to' }[v]))),
        st.winMode === 'time' ? h('div', {}, h('div', { class: 'label-h' }, 'Minutes'), seg('minutes', [5, 10, 20, 30], (v) => `${v} min`))
          : st.winMode === 'rounds' ? h('div', {}, h('div', { class: 'label-h' }, 'Rounds (any table)'), h('div', { class: 'row wrap', style: { gap: '6px' } }, seg('rounds', [10, 20, 30, 50]), numIn('rounds', 5, 500)))
            : h('div', {}, h('div', { class: 'label-h' }, 'Target coins'), h('div', { class: 'row wrap', style: { gap: '6px' } }, seg('target', [5000, 10000, 25000], fmt), numIn('target', 200, 100000000))),
        h('div', {}, h('div', { class: 'label-h' }, 'Comeback coins'), h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.comeback, disabled: !host, onchange: (e) => send({ comeback: e.target.checked }) }), '100 coins once if you go broke')),
        h('div', {}, h('div', { class: 'label-h' }, 'Min bet'), seg('minBet', [1, 5, 10, 25, 50])),
        h('div', {}, h('div', { class: 'label-h' }, 'Max bet'), seg('maxBet', [100, 500, 1000, 5000, 0], (v) => (v ? fmt(v) : 'No limit')))),
      h('div', { class: 'label-h', style: { marginTop: '16px' } }, '🏠 VS House games'),
      h('div', { class: 'game-toggles' }, house.map(toggle)),
      h('div', { class: 'label-h', style: { marginTop: '12px' } }, '⚔️ VS Players games'),
      h('div', { class: 'game-toggles' }, pvp.map(toggle)),
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-yellow btn-lg btn-block', onclick: () => Net.send('g:start') }, S.phase === 'over' ? '🔁 Play again (same players & settings)' : '🎲 Start the match!')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host to start'))),
    );
    fill(el, kids);
  }

  function renderResults() {
    const r = S.results;
    const w = r.winner;
    const card2 = (title, x, val) => (x ? h('div', { class: 'res-card' }, h('div', { class: 't' }, title), h('div', { class: 'v' }, val), h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px' } }, UI.avatar(x, 'sm'), h('b', { class: 'small' }, x.name))) : null);
    return h('div', { style: { marginBottom: '22px' } },
      h('div', { class: 'res-hero' }, h('div', { class: 'crown' }, '👑'), h('h2', { class: 'gradient-text' }, w ? `${w.name} wins!` : 'Match over'),
        h('p', { class: 'muted' }, r.reason), w ? h('p', { class: 'bold', style: { color: 'var(--gold)', fontSize: '1.2rem' } }, `🪙 ${fmt(w.coins)} coins`) : null),
      h('div', { class: 'res-cards' },
        card2('💰 Biggest single win', r.biggestWin, r.biggestWin ? `+${fmt(r.biggestWin.value)}${r.biggestWin.game ? ' · ' + r.biggestWin.game : ''}` : ''),
        card2('💸 Biggest loss', r.biggestLoss, r.biggestLoss ? `-${fmt(r.biggestLoss.value)}` : ''),
        card2('🎲 Most games played', r.mostPlayed, r.mostPlayed ? `${r.mostPlayed.value} games` : ''),
        h('div', { class: 'res-card' }, h('div', { class: 't' }, '⏱ Match'), h('div', { class: 'v' }, `${Math.floor(r.duration / 60)}m ${r.duration % 60}s`), h('div', { class: 'small muted' }, `${r.rounds} rounds`))),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Coins'), h('th', {}, 'Games'))),
        h('tbody', {}, r.ranking.map((p, i) => h('tr', {}, h('td', {}, ['🥇', '🥈', '🥉'][i] || i + 1), h('td', {}, h('div', { class: 'row' }, UI.avatar(p, 'sm'), h('b', {}, p.name), p.out ? ' 💀' : '')), h('td', { class: 'mono bold', style: { color: 'var(--gold)' } }, fmt(p.coins)), h('td', {}, p.played))))),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '20px 0 6px' } }));
  }

  // ================================================================ match screen
  function renderMenu() {
    const allowed = S.games.filter((g) => S.allowed.includes(g.key));
    const btn = (g) => h('button', { class: 'gbtn' + (g.key === current ? ' on' : ''), onclick: () => switchGame(g.key) },
      h('span', { class: 'e' }, g.emoji), h('span', {}, h('div', { class: 't' }, g.title), h('div', { class: 's', 'data-sum': g.key }, S.summaries[g.key] || '')));
    const house = allowed.filter((g) => g.mode === 'house');
    const pvp = allowed.filter((g) => g.mode === 'players');
    fill($('#menu'),
      house.length ? h('h4', {}, '🏠 VS House') : null, house.map(btn),
      pvp.length ? h('h4', {}, '⚔️ VS Players') : null, pvp.map(btn));
  }
  function renderSummaries() {
    document.querySelectorAll('[data-sum]').forEach((el) => { el.textContent = S.summaries[el.dataset.sum] || ''; });
  }

  function renderBar() {
    const me = myRow();
    const st = S.settings;
    const n = coins();
    const old = prevCoins._me;
    prevCoins._me = n;
    const num = h('span', { class: 'n' + (old != null && n > old ? ' up' : old != null && n < old ? ' down' : '') }, fmt(n));
    const alive = S.scores.filter((r) => !r.out).length;
    let status;
    if (st.winMode === 'time') status = h('span', { id: 'clock' }, '⏱ …');
    else if (st.winMode === 'rounds') status = `🔁 Round ${Math.min(S.info.rounds + 1, st.rounds)} / ${st.rounds}`;
    else status = `🎯 First to ${fmt(st.target)} coins`;
    fill($('#match-bar'),
      h('div', { class: 'my-coins' }, h('span', { class: 'coin' }, '🪙'), h('div', {}, h('div', { class: 'tiny muted bold' }, S.spectator ? 'SPECTATING' : me && me.out ? 'OUT OF COINS' : 'YOUR COINS'), num)),
      me && me.out ? h('span', { class: 'badge', style: { background: 'rgba(244,63,94,.2)' } }, '💀 Out') : null,
      h('div', { class: 'match-status' }, h('div', {}, status), h('div', { class: 'sub' }, `${S.info.rounds || 0} rounds played · ${alive} player${alive === 1 ? '' : 's'} in`)),
      Room.isHost ? h('button', { class: 'btn btn-ghost btn-sm', onclick: confirmEnd }, '⏹ End match') : null);
    tickClock();
  }

  function tickClock() {
    const el = document.getElementById('clock');
    if (!el || S.info.endsIn == null) return;
    const s = Math.max(0, Math.round(S.info.endsIn - (performance.now() - infoAt) / 1000));
    el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
    el.style.color = s <= 30 ? 'var(--red)' : '';
  }

  function confirmEnd() {
    const close = UI.modal(h('div', { style: { textAlign: 'center' } }, h('h2', {}, 'End the match now?'), h('p', { class: 'muted' }, 'Bets still in play are refunded and the results are shown.'),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn btn-red', onclick: () => { Net.send('g:end'); close(); } }, '⏹ End match'), h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Keep playing'))));
  }

  function renderScores() {
    const rows = S.scores.map((r, i) => {
      const prev = prevCoins[r.id];
      prevCoins[r.id] = r.coins;
      const flash = prev != null && r.coins !== prev ? (r.coins > prev ? ' flash-up' : ' flash-down') : '';
      const g = r.viewing ? gameInfo(r.viewing) : null;
      return h('div', { class: 'sb-row' + (r.id === Net.id ? ' me' : '') + (r.out ? ' out' : '') + flash },
        h('span', { class: 'bold' }, ['🥇', '🥈', '🥉'][i] || i + 1), UI.avatar(r, 'sm'),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'nm' }, r.name, r.id === Net.id ? ' (you)' : ''),
          h('div', { class: 'sub' }, r.out ? '💀 out' : !r.online ? '📴 away' : `${g ? g.emoji + ' ' + g.title : 'browsing'}${r.inPlay ? ` · 🎲 ${fmt(r.inPlay)} in play` : ''}`)),
        h('div', { class: 'c' }, fmt(r.coins), Room.isHost && r.id !== Net.id ? h('button', { class: 'icon-btn', style: { width: '26px', height: '26px', fontSize: '.75rem', marginLeft: '4px', display: 'inline-grid' }, title: 'Kick player', onclick: () => kick(r) }, '👢') : null));
    });
    fill($('#scoreboard'), rows.length ? rows : h('p', { class: 'muted small' }, 'No players yet.'));
    setTimeout(() => document.querySelectorAll('.sb-row.flash-up, .sb-row.flash-down').forEach((e) => e.classList.remove('flash-up', 'flash-down')), 700);
  }

  function kick(r) {
    const close = UI.modal(h('div', { style: { textAlign: 'center' } }, h('h2', {}, `Kick ${r.name}?`), h('p', { class: 'muted' }, 'They will be removed from the room and can’t rejoin this match.'),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn btn-red', onclick: () => { Net.send('g:kick', { uid: r.id }); close(); } }, '👢 Kick'), h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Cancel'))));
  }

  function renderFeed() {
    fill($('#feed'), S.feed.length ? S.feed.slice().reverse().map((f) => h('div', {}, f.text)) : h('p', { class: 'muted small' }, 'Big wins show up here!'));
  }

  function renderTableShell() {
    const g = gameInfo(current);
    const me = myRow();
    const body = h('div', { id: 'table-body' });
    fill($('#table'),
      h('div', { class: 'table-head' }, h('h2', {}, h('span', {}, g.emoji), g.title),
        h('span', { class: 'badge ' + (g.mode === 'house' ? 'vs-house' : 'vs-players') }, g.mode === 'house' ? '🏠 VS HOUSE' : '⚔️ VS PLAYERS'),
        h('span', { class: 'muted small grow' }, g.blurb)),
      S.spectator ? h('div', { class: 'banner info' }, '👀 You joined mid-match, so you’re spectating. You’ll get coins in the next match!') : null,
      me && me.out ? h('div', { class: 'banner' }, '💀 You’re out of coins. You can still watch every table and cheer in the chat.') : null,
      body);
    return body;
  }

  function switchGame(key) {
    if (!S.allowed.includes(key)) key = S.allowed[0];
    if (!key) return;
    if (mounted && mounted.mod.unmount) mounted.mod.unmount();
    chipRows.clear();
    current = key;
    store.set('casino_game', key);
    const body = renderTableShell();
    const mod = modules[key];
    mounted = { key, mod };
    if (mod) {
      mod.mount(body, ctx, key);
      if (S.tables[key]) mod.update(S.tables[key], ctx, key);
    } else fill(body, h('p', { class: 'muted' }, 'This game is coming soon.'));
    renderMenu();
    Net.send('g:view', { game: key });
  }

  function route() {
    const playing = S.phase === 'playing';
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (!playing) {
      if (mounted && mounted.mod.unmount) mounted.mod.unmount();
      mounted = null;
      renderLobby();
      return;
    }
    for (const k of Object.keys(S.tables)) stateAt[k] = performance.now();
    infoAt = performance.now();
    renderBar();
    renderScores();
    renderFeed();
    switchGame(current);
  }

  setInterval(() => {
    tickClock();
    if (mounted && mounted.mod.tick && S.phase === 'playing') mounted.mod.tick(ctx);
  }, 250);

  // ================================================================ boot
  function boot() {
    Lobby.init({
      game: 'casino',
      title: 'Casino Night',
      emoji: '🎰',
      tagline: 'Fake coins, real bragging rights. Everyone starts equal — finish with the most coins!',
      howTo: '<b>How it works</b><ul><li>🪙 Only fake coins — no real money, nothing to buy.</li><li>🏠 <b>VS House</b>: Roulette, Lucky Dice, Blackjack, Slots.</li><li>⚔️ <b>VS Players</b>: Texas Hold’em and 1v1 duels — coins move between friends.</li><li>Switch games any time. Most coins when the match ends wins!</li></ul>',
    });
    Lobby.renderCode($('#room-code'));
    Lobby.renderPlayers($('#room-players'), { extra: (p) => (Room.isHost && p.id !== Net.id ? h('button', { class: 'icon-btn', style: { width: '28px', height: '28px', fontSize: '.8rem' }, title: 'Kick', onclick: () => kick(p) }, '👢') : null) });
    Lobby.ChatBox($('#room-chat'));
    Lobby.ChatBox($('#chat-box'));

    Lobby.on('joined', (m) => { S = m.state; route(); });
    Lobby.on('players', () => { if (S.phase !== 'playing') renderLobby(); else renderBar(); });
    Net.on('g:state', (m) => {
      const was = S.phase;
      S = m.state;
      route();
      if (was !== 'playing' && S.phase === 'playing') { UI.toast('🎲 The match has started! Good luck!', 'good'); Sfx.play('win'); }
    });
    Net.on('g:table', (m) => {
      S.tables[m.game] = m.state;
      S.summaries[m.game] = m.summary;
      stateAt[m.game] = performance.now();
      if (mounted && mounted.key === m.game && mounted.mod) mounted.mod.update(m.state, ctx, m.game);
      renderSummaries();
    });
    Net.on('g:scores', (m) => {
      S.scores = m.scores;
      S.info = m.info;
      infoAt = performance.now();
      Object.assign(S.summaries, m.summaries || {});
      if (S.phase !== 'playing') return;
      renderBar();
      renderScores();
      renderSummaries();
      chipRows.forEach(renderChips);
      if (mounted && mounted.mod.onScores) mounted.mod.onScores(ctx);
    });
    Net.on('g:feed', (m) => { S.feed.push(m.item); if (S.feed.length > 40) S.feed.shift(); renderFeed(); });
    Net.on('g:toast', (m) => { UI.toast(m.text, m.bad ? 'bad' : 'good', 2800); Sfx.play(m.bad ? 'wrong' : 'pop'); });
    Net.on('g:over', () => {
      setTimeout(() => {
        const w = S.results && S.results.winner;
        if (w && w.id === Net.id) { UI.confetti(240); Sfx.play('win'); } else Sfx.play('lose');
      }, 400);
    });
    Net.on('g:slots', (m) => { if (modules.slots && modules.slots.onSpin) modules.slots.onSpin(m, ctx); });
    Net.on('g:duel_invite', (m) => {
      Sfx.play('boing');
      const close = UI.modal(h('div', { style: { textAlign: 'center' } },
        h('div', { style: { fontSize: '3rem' } }, m.emoji), h('h2', {}, `${m.fromName} challenged you!`),
        h('p', { class: 'muted' }, `${m.title} for ${fmt(m.amount)} coins each. Winner takes ${fmt(m.amount * 2)}.`),
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '16px' } },
          h('button', { class: 'btn btn-green btn-lg', onclick: () => { ctx.send(m.game, 'accept', { id: m.id }); close(); switchGame(m.game); } }, '⚔️ Accept'),
          h('button', { class: 'btn btn-ghost', onclick: () => { ctx.send(m.game, 'decline', { id: m.id }); close(); } }, 'Decline'))));
      setTimeout(() => close(true), 30000);
    });
  }

  window.Casino = { register, boot, ctx };
})();
