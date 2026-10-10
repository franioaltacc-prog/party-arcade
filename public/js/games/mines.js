/* Minesweeper: classic solo boards, plus online Race and Battle modes. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  // cell codes (same as the server): -1 hidden, -2 flag, 0-8 open, 9 exploded, 10 mine, 11 wrong flag
  const HIDDEN = -1;
  const FLAG = -2;
  const MAX_CELL = 38;

  // ================================================================ board view (used by solo + online)
  function BoardView(el, cols, rows, act) {
    const n = cols * rows;
    let codes = new Array(n).fill(null);
    let owners = null;
    let xray = new Set();
    let flagMode = false;
    let press = null;
    el.className = 'ms-board';
    el.style.setProperty('--cols', cols);
    const cells = Array.from({ length: n }, (_, i) => h('div', { class: 'ms-cell h', 'data-i': i }));
    fill(el, cells);

    function size() {
      const wrap = el.parentElement;
      const avail = (wrap ? wrap.clientWidth : 600) - 16 - (cols - 1) * 3;
      el.style.setProperty('--size', Math.max(22, Math.min(MAX_CELL, Math.floor(avail / cols))) + 'px');
    }
    size();
    const onResize = () => size();
    addEventListener('resize', onResize);

    function click(i, button) {
      const code = codes[i];
      if (button === 2 || (flagMode && (code === HIDDEN || code === FLAG))) { if (code === HIDDEN || code === FLAG) act('flag', i); return; }
      if (button === 1 || (code >= 1 && code <= 8)) { act('chord', i); return; }
      if (code === HIDDEN) act('reveal', i);
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.ms-cell');
      if (!cell) return;
      const i = +cell.dataset.i;
      if (e.pointerType === 'mouse') { if (e.button === 2 || e.button === 1) { e.preventDefault(); click(i, e.button); } press = { i, long: false }; return; }
      press = { i, long: false, timer: setTimeout(() => { press.long = true; click(i, 2); if (navigator.vibrate) navigator.vibrate(25); }, 380) };
    });
    el.addEventListener('pointerup', (e) => {
      if (!press) return;
      clearTimeout(press.timer);
      const cell = e.target.closest('.ms-cell');
      const p = press;
      press = null;
      if (!cell || p.long || +cell.dataset.i !== p.i || (e.pointerType === 'mouse' && e.button !== 0)) return;
      click(p.i, 0);
    });
    el.addEventListener('pointercancel', () => { if (press) clearTimeout(press.timer); press = null; });
    el.addEventListener('pointerleave', () => { if (press) clearTimeout(press.timer); press = null; });

    function paint(i, code, owner) {
      const c = cells[i];
      let cls = 'ms-cell ';
      let txt = '';
      if (code === HIDDEN) cls += 'h' + (xray.has(i) ? ' xr' : '');
      else if (code === FLAG) { cls += 'h f'; txt = '🚩'; }
      else if (code >= 0 && code <= 8) { cls += 'o' + (code ? ' n' + code : ''); txt = code ? String(code) : ''; }
      else if (code === 9) { cls += 'x'; txt = '💥'; }
      else if (code === 10) { cls += 'm'; txt = '💣'; }
      else if (code === 11) { cls += 'wf'; txt = '❌'; }
      if (owner && code >= 0 && code <= 9) { cls += ' owned'; c.style.setProperty('--oc', owner); } else c.style.removeProperty('--oc');
      c.className = cls;
      c.textContent = txt;
    }

    return {
      update(next, nextOwners) {
        const opened = [];
        const booms = [];
        for (let i = 0; i < n; i++) {
          const owner = nextOwners ? nextOwners[i] : null;
          if (next[i] === codes[i] && (!owners || owners[i] === owner)) continue;
          if (codes[i] !== null && next[i] >= 0 && next[i] <= 8 && codes[i] < 0) opened.push(cells[i]);
          if (next[i] === 9 && codes[i] !== 9 && codes[i] !== null) booms.push(cells[i]);
          paint(i, next[i], owner);
        }
        codes = next.slice();
        owners = nextOwners ? nextOwners.slice() : null;
        if (G && opened.length && opened.length < 260) {
          G.from(opened, { scale: 0.3, autoAlpha: 0, duration: 0.28, ease: 'back.out(2)', stagger: Math.min(0.012, 0.3 / opened.length), clearProps: 'transform,opacity,visibility' });
        }
        if (G && booms.length) G.fromTo(booms, { scale: 2.2 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', clearProps: 'transform' });
        return opened.length;
      },
      setXray(list) { xray = new Set(list); codes.forEach((c, i) => { if (c === HIDDEN) paint(i, c, null); }); },
      setFlagMode(v) { flagMode = v; },
      get flags() { return codes.filter((c) => c === FLAG).length; },
      shake() { if (FX.shake) FX.shake(el); },
      destroy() { removeEventListener('resize', onResize); },
    };
  }

  // ================================================================ solo game (runs in the browser)
  const SOLO = { easy: [9, 9, 10, 'Easy'], medium: [16, 16, 40, 'Medium'], hard: [30, 16, 99, 'Hard'] };

  class SoloGame {
    constructor(diff) {
      [this.cols, this.rows, this.count] = SOLO[diff];
      this.diff = diff;
      this.n = this.cols * this.rows;
      this.mines = null;
      this.open = new Set();
      this.flags = new Set();
      this.over = false;
      this.won = false;
      this.hit = -1;
      this.t0 = 0;
      this.time = 0;
    }
    around(i) {
      const r = Math.floor(i / this.cols);
      const c = i % this.cols;
      const out = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if ((dr || dc) && r + dr >= 0 && r + dr < this.rows && c + dc >= 0 && c + dc < this.cols) out.push((r + dr) * this.cols + c + dc);
      }
      return out;
    }
    place(first) {
      const safe = new Set([first, ...this.around(first)]);
      const pool = [];
      for (let i = 0; i < this.n; i++) if (!safe.has(i)) pool.push(i);
      for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
      this.mines = new Set(pool.slice(0, this.count));
      this.counts = Array.from({ length: this.n }, (_, i) => this.around(i).filter((j) => this.mines.has(j)).length);
      this.t0 = performance.now();
    }
    reveal(i) {
      if (this.over || this.flags.has(i) || this.open.has(i)) return 0;
      if (!this.mines) this.place(i);
      if (this.mines.has(i)) { this.hit = i; this.end(false); return -1; }
      const queue = [i];
      const seen = new Set([i]);
      let added = 0;
      while (queue.length) {
        const j = queue.shift();
        if (this.open.has(j) || this.flags.has(j)) continue;
        this.open.add(j);
        added++;
        if (this.counts[j] === 0) for (const k of this.around(j)) if (!seen.has(k) && !this.mines.has(k)) { seen.add(k); queue.push(k); }
      }
      if (this.open.size === this.n - this.count) this.end(true);
      return added;
    }
    chord(i) {
      if (this.over || !this.open.has(i) || !this.counts[i]) return 0;
      const around = this.around(i);
      if (around.filter((j) => this.flags.has(j)).length !== this.counts[i]) return 0;
      let res = 0;
      for (const j of around) if (!this.open.has(j) && !this.flags.has(j)) { const r = this.reveal(j); if (r < 0) return -1; res += r; }
      return res;
    }
    flag(i) {
      if (this.over || this.open.has(i)) return;
      if (this.flags.has(i)) this.flags.delete(i); else this.flags.add(i);
    }
    end(won) {
      this.over = true;
      this.won = won;
      this.time = performance.now() - this.t0;
    }
    codes() {
      const out = new Array(this.n).fill(HIDDEN);
      for (const i of this.flags) out[i] = FLAG;
      for (const i of this.open) out[i] = this.counts[i];
      if (this.over && this.mines) {
        for (const i of this.mines) if (out[i] === HIDDEN || (this.won && out[i] === FLAG)) out[i] = this.won ? FLAG : 10;
        for (const i of this.flags) if (!this.mines.has(i)) out[i] = 11;
        if (this.hit >= 0) out[this.hit] = 9;
      }
      return out;
    }
    elapsed() { return this.over ? this.time : this.mines ? performance.now() - this.t0 : 0; }
  }

  let solo = null;
  let soloView = null;
  let soloDiff = store.get('mines_solo', 'medium');
  let soloFlag = false;

  function newSolo() {
    solo = new SoloGame(soloDiff);
    if (soloView) soloView.destroy();
    soloView = BoardView($('#solo-board'), solo.cols, solo.rows, soloAct);
    soloView.setFlagMode(soloFlag);
    soloView.update(solo.codes());
    $('#solo-face').textContent = '🙂';
    renderSoloBar();
    if (FX.list) FX.list($('#solo-board').children, { scale: 0.4, y: 0, stagger: { each: 0.002, from: 'center' }, duration: 0.3, ease: 'back.out(2)' });
  }
  function soloAct(type, i) {
    if (!solo || solo.over) return;
    let r = 0;
    if (type === 'flag') { solo.flag(i); Sfx.play('click'); } else if (type === 'reveal') r = solo.reveal(i); else r = solo.chord(i);
    soloView.update(solo.codes());
    if (r > 0) Sfx.play(r > 8 ? 'swoosh' : 'pop');
    renderSoloBar();
    if (solo.over) soloOver();
  }
  function soloOver() {
    const s = solo;
    if (s.won) {
      $('#solo-face').textContent = '😎';
      Sfx.play('win');
      UI.confetti(180);
      const bests = store.get('mines_best', {});
      const prev = bests[s.diff];
      const best = !prev || s.time < prev;
      if (best) { bests[s.diff] = Math.round(s.time); store.set('mines_best', bests); }
      if (FX.banner) FX.banner('🧹 CLEARED!', `${(s.time / 1000).toFixed(2)}s on ${SOLO[s.diff][3]}${best ? ' · new best!' : ''}`, { color: '#22c55e' });
      PA.Account.submit('mines-' + s.diff, s.time);
      renderBests();
    } else {
      $('#solo-face').textContent = '😵';
      Sfx.play('boom');
      soloView.shake();
      if (FX.rain) FX.rain('💥', 12);
    }
  }
  function renderSoloBar() {
    if (!solo) return;
    $('#solo-left').textContent = solo.count - solo.flags.size;
    $('#solo-time').textContent = Math.floor(solo.elapsed() / 1000);
  }
  function renderBests() {
    const bests = store.get('mines_best', {});
    fill($('#solo-best'), Object.entries(SOLO).map(([k, v]) => h('span', {}, `🏆 ${v[3]}: ${bests[k] ? (bests[k] / 1000).toFixed(2) + 's' : '—'}`)));
  }
  function renderSoloDiffs() {
    fill($('#solo-diff'), Object.entries(SOLO).map(([k, v]) => h('button', { class: k === soloDiff ? 'on' : '', onclick: () => { soloDiff = k; store.set('mines_solo', k); renderSoloDiffs(); newSolo(); } }, v[3])));
  }
  $('#solo-face').addEventListener('click', () => { newSolo(); Sfx.play('pop'); });
  $('#solo-flag').addEventListener('click', (e) => { soloFlag = !soloFlag; e.currentTarget.classList.toggle('on', soloFlag); if (soloView) soloView.setFlagMode(soloFlag); });
  $('#solo-back').addEventListener('click', () => { showScreen('entry'); Lobby.showEntry(); history.replaceState(null, '', location.pathname); });
  setInterval(() => { if (solo && !$('#solo').classList.contains('hidden')) renderSoloBar(); }, 250);

  function openSolo() {
    showScreen('solo');
    renderSoloDiffs();
    renderBests();
    newSolo();
  }

  // ================================================================ screens
  const SCREENS = ['entry', 'solo', 'room', 'play'];
  function showScreen(name) {
    for (const s of SCREENS) $('#' + s).classList.toggle('hidden', s !== name);
  }

  // ================================================================ online
  let S = { phase: 'lobby', settings: { mode: 'race', size: 'medium', penalty: 10, minutes: 5 }, players: [], results: null };
  let view = null;
  let viewGame = 0;
  let clock0 = 0;
  let flagMode = false;
  let lobbyView = false;   // show settings instead of the finished board
  let stunUntil = 0;
  let lastGame = 0;
  const MODES = { race: ['🏁 Race', 'Same board for everyone. Clear it the fastest! Mines add a time penalty.'], battle: ['⚔️ Battle', 'One shared board. Every cell you open is a point. Mines cost points and stun you!'] };
  const SIZE_LABEL = { small: 'Small 9×9 · 10💣', medium: 'Medium 16×16 · 40💣', large: 'Large 24×16 · 70💣' };

  const me = () => Net.id;
  const myRow = () => S.players.find((p) => p.id === me());

  function onlineAct(type, i) {
    if (S.phase !== 'playing' || S.spectator) return;
    if (performance.now() < stunUntil) { Sfx.play('wrong'); return; }
    Net.send('g:' + type, { i });
    if (type === 'flag') Sfx.play('click');
  }

  function route() {
    if (!Room.code) return;
    const showBoard = S.phase === 'playing' || (S.phase === 'over' && S.cells && !lobbyView);
    showScreen(showBoard ? 'play' : 'room');
    if (showBoard) renderPlay(); else renderLobby();
  }

  function renderLobby() {
    const host = Room.isHost;
    const s = S.settings;
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, options, label, fmt) => h('div', {},
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, options.map((v) => h('button', { class: s[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, fmt(v)))));
    fill($('#room-main'),
      S.results ? resultsCard(S.results, false) : null,
      h('div', { class: 'panel-title' }, '⚙️ Game settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'mode-cards', style: { marginBottom: '14px' } }, Object.entries(MODES).map(([k, [title, desc]]) => h('button', {
        class: 'mode-card' + (s.mode === k ? ' on' : ''), disabled: !host, onclick: () => send({ mode: k }),
      }, h('b', {}, title), h('span', {}, desc)))),
      h('div', { class: 'set-grid' },
        seg('size', ['small', 'medium', 'large'], 'BOARD', (v) => SIZE_LABEL[v]),
        seg('minutes', [3, 5, 10], 'TIME LIMIT', (v) => `${v} min`),
        s.mode === 'race' ? seg('penalty', [0, 5, 10, 20], 'MINE PENALTY', (v) => (v ? `+${v}s` : 'none')) : null),
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => { lobbyView = false; Net.send('g:start'); } }, S.results ? '🔁 Play again' : '💣 Start the game')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host'))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '10px' } }, 'Up to 8 players. You can also play alone to practice.'));
  }

  function resultsCard(res, withButtons) {
    const race = res.mode === 'race';
    return h('div', { class: 'ms-result' },
      h('h3', {}, race ? '🏁 Race results' : '⚔️ Battle results'),
      res.rows.map((r, i) => h('div', { class: 'rr' }, h('span', {}, ['🥇', '🥈', '🥉'][i] || `#${i + 1}`), UI.avatar(r, 'sm'), h('span', { class: 'grow' }, r.name),
        h('span', { class: 'bold' }, race ? (r.done ? `${r.time.toFixed(1)}s` : `${Math.round(r.progress * 100)}%`) : `${r.points} pts`),
        r.hits ? h('span', { class: 'small muted' }, ` ${r.hits}💥`) : null)),
      withButtons ? h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px', flexWrap: 'wrap' } },
        Room.isHost ? h('button', { class: 'btn btn-pink btn-sm', onclick: () => Net.send('g:start') }, '🔁 Play again') : null,
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { lobbyView = true; route(); } }, Room.isHost ? '⚙️ Change settings' : '👥 Back to lobby')) : null);
  }

  function renderPlay() {
    if (!S.cells) return;
    if (!view || viewGame !== S.gameId) {
      if (view) view.destroy();
      view = BoardView($('#ms-board'), S.cols, S.rows, onlineAct);
      view.setFlagMode(flagMode);
      viewGame = S.gameId;
    }
    const colors = S.players.map((p) => p.color);
    view.update(S.cells, S.owners ? S.owners.map((o) => (o >= 0 ? colors[o] : null)) : null);
    clock0 = performance.now() - S.elapsed * 1000;
    $('#ms-mode').textContent = (MODES[S.mode] || ['💣'])[0] + (S.spectator ? ' · 👀 watching' : '');
    $('#ms-left').textContent = S.mines - view.flags;
    fill($('#ms-result'), S.phase === 'over' && S.results ? resultsCard(S.results, true) : null);
    $('#ms-help').textContent = S.spectator ? 'You joined mid-game — you’ll play next round!'
      : S.mode === 'race' ? 'Everyone has the same board. Click to open · right-click / long-press / 🚩 to flag · click a number to open around it.'
        : 'Shared board! Open cells before the others do. Mines cost 10 points and stun you for 3s.';
    renderPlayers();
    tickClock();
  }

  function renderPlayers() {
    const race = S.mode === 'race';
    const rows = [...S.players].sort((a, b) => (race ? (b.done - a.done) || (a.done ? a.time - b.time : b.progress - a.progress) : b.points - a.points));
    fill($('#ms-players'), h('div', { class: 'panel-title' }, race ? '🏁 Race' : '⚔️ Points'),
      rows.map((p) => h('div', { class: 'mp-row' + (p.id === me() ? ' me' : ''), style: { '--c': p.color } },
        UI.avatar(p, 'sm'), h('span', { class: 'nm' }, p.name),
        h('span', { class: 'val' }, race ? (p.done ? `✅ ${p.time.toFixed(1)}s` : `${Math.round(p.progress * 100)}%`) : `${p.points}`),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.round(p.progress * 100) + '%' } })),
        h('span', { class: 'sub' }, [p.hits ? `💥 ${p.hits}` : null, race && p.penalty ? `+${p.penalty}s` : null, !race ? `${p.cells} cells` : null, !p.online ? '📴 away' : null].filter(Boolean).join(' · ') || ' '))));
  }

  function tickClock() {
    if (!S.cells || $('#play').classList.contains('hidden')) return;
    const mine = myRow();
    let t;
    if (S.phase === 'over' || (mine && mine.done)) t = mine && mine.done ? mine.time : S.elapsed;
    else t = (performance.now() - clock0) / 1000;
    $('#ms-time').textContent = Math.max(0, Math.floor(t));
    const stunned = performance.now() < stunUntil;
    $('#ms-stun').classList.toggle('hidden', !stunned);
  }
  setInterval(tickClock, 250);

  $('#ms-flag').addEventListener('click', (e) => { flagMode = !flagMode; e.currentTarget.classList.toggle('on', flagMode); if (view) view.setFlagMode(flagMode); });

  function onState(st) {
    const before = S;
    S = st;
    if (S.phase === 'playing') lobbyView = false;
    route();
    if (S.phase === 'playing' && S.gameId !== lastGame) {
      lastGame = S.gameId;
      if (S.elapsed < 0) UI.countdown(-S.elapsed);
      if (FX.list && view) FX.list($('#ms-board').children, { scale: 0.3, y: 0, stagger: { each: 0.0015, from: 'center' }, duration: 0.3, ease: 'back.out(2)' });
    }
    // somebody finished the race
    if (S.mode === 'race' && before.players) {
      for (const p of S.players) {
        const old = before.players.find((x) => x.id === p.id);
        if (old && !old.done && p.done) { Sfx.play(p.id === me() ? 'win' : 'coin'); if (p.id === me()) { UI.confetti(140); if (FX.banner) FX.banner('🧹 CLEARED!', `${p.time.toFixed(1)}s · #${p.place}`, { color: '#22c55e' }); } }
      }
    }
  }

  Lobby.init({
    game: 'mines',
    title: 'Minesweeper',
    emoji: '💣',
    tagline: 'The classic, now with friends! Race on the same board or battle on one shared board.',
    howTo: '<b>How to play</b><ul><li>Numbers tell you how many mines touch that square. Flag the mines, open everything else!</li><li><b>Race:</b> everyone gets the same board — fastest clear wins (mines add a time penalty).</li><li><b>Battle:</b> one shared board — every square you open is a point, mines cost points.</li><li>Want to practice? Play solo on Easy, Medium or Hard.</li></ul>',
    solo: { label: '🎮 Play solo (classic)', onClick: openSolo },
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'), { title: '💬 Chat' });

  Lobby.on('joined', (m) => { lastGame = m.state.gameId; onState(m.state); });
  Lobby.on('players', () => route());
  Lobby.on('entry', () => { for (const s of ['solo', 'room', 'play']) $('#' + s).classList.add('hidden'); });
  Net.on('g:state', (m) => onState(m.state));
  Net.on('g:boom', (m) => {
    Sfx.play('boom');
    if (view) view.shake();
    if (m.stun) { stunUntil = performance.now() + m.stun * 1000; UI.toast(`💥 Boom! −${m.penalty} points, stunned for ${m.stun}s`, 'bad', 2500); }
    else UI.toast(m.penalty ? `💥 Boom! +${m.penalty}s penalty` : '💥 Boom!', 'bad', 2000);
  });
  Net.on('g:xray', (m) => { if (view) view.setXray(m.mines); });
  Net.on('g:over', (m) => {
    const rows = m.results.rows;
    const iWon = rows.length > 1 && rows[0].id === me() && (m.results.mode === 'battle' || rows[0].done);
    if (FX.banner) FX.banner(m.results.mode === 'race' ? '🏁 RACE OVER' : '⚔️ BATTLE OVER', rows[0] ? `${rows[0].name} wins!` : '', { color: '#facc15' });
    if (iWon) { UI.confetti(220); Sfx.play('win'); } else Sfx.play('lose');
  });

  if (new URLSearchParams(location.search).get('solo')) { Lobby.hideEntry(); openSolo(); }
})();
