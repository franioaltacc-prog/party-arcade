/* Party Blitz — rapid-fire minigames. Server picks rounds; clients time themselves. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  const S = { phase: 'lobby', settings: { rounds: 8 }, scores: {}, round: null, final: null };
  let cur = null;
  let barTimer = null;
  const arena = $('#arena');

  const ICONS = { reaction: '⚡', mash: '👊', math: '🧮', odd: '🔍', color: '🎨', count: '🔢', type: '⌨️', simon: '🧠' };

  // ------------------------------------------------------------ helpers
  function player(id) { return Room.player(id) || { name: 'Someone', avatar: '❓', color: '#888' }; }
  function setBar(fraction) { $('#tbar').style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%'; }
  function clearRound() {
    if (!cur) return;
    cur.timers.forEach(clearTimeout);
    cur.intervals.forEach(clearInterval);
    if (cur.cleanup) cur.cleanup();
  }
  function later(ms, fn) { const t = setTimeout(fn, ms); cur.timers.push(t); return t; }
  function every(ms, fn) { const t = setInterval(fn, ms); cur.intervals.push(t); return t; }

  function answer(value, view) {
    if (!cur || cur.answered) return;
    cur.answered = true;
    Net.send('g:answer', { n: cur.n, ms: Math.round(performance.now() - cur.t0), value });
    fill(arena, view || h('div', { class: 'locked' }, h('b', {}, 'Locked in! 🔒'), 'Waiting for everyone else…'));
  }

  function renderScores() {
    const rows = Object.entries(S.scores).sort((a, b) => b[1] - a[1]);
    if (FX.board) FX.board($('#sb'), draw); else draw();
    function draw() { fill($('#sb'), rows.map(([id, pts], i) => { const p = player(id); return h('div', { class: 'sb-row' + (id === Net.id ? ' me' : ''), 'data-flip-id': id }, h('span', { style: { width: '22px' } }, ['🥇', '🥈', '🥉'][i] || i + 1), UI.avatar(p, 'sm'), h('span', { class: 'bold' }, p.name), h('span', { class: 'pts' }, pts)); })); }
  }

  // ------------------------------------------------------------ challenges
  function startChallenge() {
    const r = cur;
    r.t0 = performance.now();
    const start = r.t0;
    every(100, () => setBar(1 - (performance.now() - start) / 1000 / r.limit));
    const d = r.data;
    switch (r.kind) {
      case 'reaction': {
        let goAt = null;
        const el = h('div', { class: 'reaction wait' }, 'Wait for green…');
        const tap = () => {
          if (r.answered) return;
          if (!goAt) { Sfx.play('wrong'); answer(-1, h('div', { class: 'reaction done' }, 'Too early! 😬')); return; }
          const ms = Math.round(performance.now() - goAt);
          Sfx.play('right');
          answer(ms, h('div', { class: 'reaction done' }, `${ms} ms ⚡`));
        };
        el.addEventListener('pointerdown', tap);
        const key = (e) => { if (e.code === 'Space') { e.preventDefault(); tap(); } };
        addEventListener('keydown', key);
        r.cleanup = () => removeEventListener('keydown', key);
        later(d.delay * 1000, () => { if (r.answered) return; goAt = performance.now(); el.className = 'reaction go'; el.textContent = 'TAP!'; Sfx.play('go'); });
        fill(arena, el);
        break;
      }
      case 'mash': {
        let count = 0;
        const counter = h('div', { class: 'mash-count' }, '0');
        const secs = h('div', { class: 'muted bold' }, `${d.duration}s`);
        const tap = () => { if (r.answered) return; count++; counter.textContent = count; Sfx.play('click'); if (G) FX.bump(counter); };
        const btn = h('button', { class: 'mash-btn', onpointerdown: (e) => { e.preventDefault(); tap(); } }, 'TAP!');
        const key = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); tap(); } };
        addEventListener('keydown', key);
        r.cleanup = () => removeEventListener('keydown', key);
        every(100, () => { secs.textContent = Math.max(0, d.duration - (performance.now() - start) / 1000).toFixed(1) + 's'; });
        later(d.duration * 1000, () => { Sfx.play('go'); answer(count, h('div', { class: 'locked' }, h('b', {}, `${count} taps! 👊`), 'Waiting for everyone else…')); });
        fill(arena, h('div', {}, counter, btn, h('div', { style: { marginTop: '16px' } }, secs, h('div', { class: 'tiny faint' }, 'Tip: you can also mash Space'))));
        break;
      }
      case 'math':
        fill(arena, h('div', {}, h('div', { class: 'q-big' }, `${d.q} = ?`),
          h('div', { class: 'opts' }, d.options.map((o, i) => h('button', { class: 'btn btn-ghost btn-lg', onclick: () => { Sfx.play('click'); answer(i); } }, o)))));
        break;
      case 'odd':
        fill(arena, h('div', { style: { width: '100%', display: 'grid', placeItems: 'center' } },
          h('div', { class: 'emoji-board', style: { gridTemplateColumns: `repeat(${d.cols}, 1fr)` } }, d.grid.map((e, i) => h('button', { onclick: () => { Sfx.play('click'); answer(i); } }, e)))));
        break;
      case 'color':
        fill(arena, h('div', {}, h('div', { class: 'stroop', style: { color: d.ink } }, d.word),
          h('div', { class: 'opts' }, d.options.map((o, i) => h('button', { class: 'btn btn-ghost btn-lg', onclick: () => { Sfx.play('click'); answer(i); } }, o)))));
        break;
      case 'count': {
        fill(arena, h('div', {}, h('p', { class: 'bold big', style: { marginBottom: '12px' } }, `How many ${d.target} ?`),
          h('div', { class: 'emoji-board', style: { gridTemplateColumns: 'repeat(6, 1fr)', pointerEvents: 'none' } }, d.grid.map((e) => h('button', {}, e)))));
        later(d.show * 1000, () => {
          if (r.answered) return;
          fill(arena, h('div', {}, h('div', { class: 'q-big' }, `How many ${d.target}?`),
            h('div', { class: 'opts' }, d.options.map((o, i) => h('button', { class: 'btn btn-ghost btn-lg', onclick: () => { Sfx.play('click'); answer(i); } }, o)))));
        });
        break;
      }
      case 'type': {
        const input = h('input', { class: 'input', style: { fontSize: '1.6rem', textAlign: 'center', maxWidth: '420px' }, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'type here…' });
        const go = () => { const v = input.value.trim(); if (v) { answer(v); Sfx.play(v.toLowerCase() === d.word ? 'right' : 'wrong'); } };
        input.addEventListener('input', () => { if (input.value.trim().toLowerCase() === d.word) go(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        fill(arena, h('div', { style: { width: '100%' } }, h('div', { class: 'q-big', style: { userSelect: 'none' } }, d.word), input));
        setTimeout(() => input.focus(), 30);
        break;
      }
      case 'simon': {
        const pads = d.colors.map((c, i) => h('button', { style: { background: c, color: c }, 'aria-label': 'Pad ' + (i + 1) }));
        const status = h('p', { class: 'bold big', style: { marginBottom: '14px' } }, '👀 Watch closely…');
        fill(arena, h('div', {}, status, h('div', { class: 'simon' }, pads)));
        const step = d.step * 1000;
        d.seq.forEach((idx, k) => {
          later(400 + k * step, () => { pads[idx].classList.add('lit'); Sfx.tone(300 + idx * 120, 0.25, 'triangle', 0.08); });
          later(400 + k * step + step * 0.7, () => pads[idx].classList.remove('lit'));
        });
        later(400 + d.seq.length * step, () => {
          status.textContent = '👉 Your turn! Repeat it';
          const input = [];
          pads.forEach((p, idx) => p.addEventListener('pointerdown', () => {
            if (r.answered) return;
            input.push(idx);
            p.classList.add('lit'); setTimeout(() => p.classList.remove('lit'), 160);
            Sfx.tone(300 + idx * 120, 0.18, 'triangle', 0.08);
            if (input.length === d.seq.length) answer(input);
          }));
        });
        break;
      }
      default:
        fill(arena, h('p', {}, 'Unknown round 🤷'));
    }
  }

  // ------------------------------------------------------------ results
  function detail(kind, row) {
    if (kind === 'reaction') return row.ok ? `${row.ms} ms` : 'too early 😬';
    if (kind === 'mash') return `${row.value} taps`;
    return row.ok ? `${(row.ms / 1000).toFixed(2)}s` : 'wrong ❌';
  }
  function solutionText(m) {
    const d = S.round && S.round.data;
    if (!d) return null;
    if (m.kind === 'math' || m.kind === 'count') return `Answer: ${d.options[m.solution]}`;
    if (m.kind === 'color') return `The ink was ${d.options[m.solution]}`;
    if (m.kind === 'odd') return `The odd one was ${d.grid[m.solution]}`;
    if (m.kind === 'type') return `The word was “${m.solution}”`;
    return null;
  }
  function showRoundResult(m) {
    clearRound();
    if (cur) cur.answered = true;
    setBar(0);
    const answered = new Set(m.results.map((r) => r.id));
    const missing = Object.keys(S.scores).filter((id) => !answered.has(id));
    const sol = solutionText(m);
    const mine = m.results.find((r) => r.id === Net.id);
    Sfx.play(mine && mine.points ? 'coin' : 'lose');
    fill(arena, h('div', { style: { width: '100%', display: 'grid', placeItems: 'center' } },
      h('h2', { class: 'res-head', style: { marginBottom: '6px' } }, mine && mine.points ? `+${mine.points} points! 🎉` : 'Round over'),
      sol ? h('p', { class: 'muted', style: { marginBottom: '14px' } }, sol) : null,
      h('div', { class: 'res-list' },
        m.results.map((r, i) => { const p = player(r.id); return h('div', { class: 'res-row' + (r.points ? '' : ' bad'), style: { animationDelay: i * 0.07 + 's' } }, UI.avatar(p, 'sm'), h('b', {}, p.name), h('span', { class: 'muted small' }, detail(m.kind, r)), h('span', { class: 'pts' }, r.points ? `+${r.points}` : '0')); }),
        missing.map((id) => { const p = player(id); return h('div', { class: 'res-row bad' }, UI.avatar(p, 'sm'), h('b', {}, p.name), h('span', { class: 'muted small' }, 'no answer 💤'), h('span', { class: 'pts' }, '0')); }))));
    if (G) { FX.pop($('.res-head', arena), { from: 0.3 }); if (mine && mine.points) FX.rain('⭐', 14); }
  }

  // ------------------------------------------------------------ lobby
  function renderRoomMain() {
    const host = Room.isHost;
    const kids = [];
    if (S.final && S.final.length) {
      const top = S.final.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      kids.push(h('div', { class: 'panel-title' }, '🏆 Final standings'),
        h('div', { class: 'podium' }, order.map((r, i) => r ? h('div', { class: `step p${[2, 1, 3][i]}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, `${r.points} pts`), h('div', { class: 'block' }, [2, 1, 3][i])) : h('div', { class: 'step' }))));
    }
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, 'NUMBER OF ROUNDS'),
      h('div', { class: 'seg', style: { marginBottom: '16px' } }, [5, 8, 12, 15].map((v) => h('button', { class: S.settings.rounds === v ? 'on' : '', disabled: !host, onclick: () => { Net.send('g:settings', { rounds: v }); Sfx.play('click'); } }, v))),
      h('div', { class: 'chips', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '18px' } }, Object.entries(ICONS).map(([k, e]) => h('span', { class: 'badge' }, e, ' ', k))),
      host ? h('button', { class: 'btn btn-yellow btn-lg btn-block', onclick: () => Net.send('g:start') }, S.final ? '🔁 Play again' : '⚡ Start the Blitz!')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
    );
    fill($('#room-main'), kids);
  }

  function route() {
    const playing = S.phase === 'playing';
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (!playing) renderRoomMain();
    else renderScores();
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'blitz',
    title: 'Party Blitz',
    emoji: '⚡',
    tagline: 'Lightning-fast minigames. Fastest fingers win!',
    howTo: '<b>How to play</b><ul><li>Each round is a surprise minigame: reaction, button mash, math, memory, typing…</li><li>Be fast AND right to score big.</li><li>Most points after all rounds wins!</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'));

  Lobby.on('joined', (m) => {
    Object.assign(S, m.state);
    route();
    if (S.phase === 'playing') fill(arena, h('div', { class: 'locked' }, h('b', {}, 'Joining… 🏃'), 'You’ll jump in on the next round!'));
  });
  Lobby.on('players', () => { if (S.phase === 'playing') renderScores(); else renderRoomMain(); });
  Net.on('g:settings', (m) => { S.settings = m.settings; renderRoomMain(); });
  Net.on('g:scores', (m) => { S.scores = m.scores; renderScores(); });
  Net.on('g:begin', (m) => {
    S.phase = 'playing'; S.scores = m.scores; S.final = null;
    route();
    $('#rn').textContent = 'Get ready!';
    fill(arena, h('div', { class: 'title-card' }, h('div', { class: 'emoji' }, '⚡'), h('h2', {}, 'GET READY!'), h('p', {}, `${m.total} rounds of chaos incoming…`)));
    Sfx.play('boing');
  });
  Net.on('g:round', (m) => {
    clearRound();
    S.phase = 'playing';
    S.round = m.round;
    if ($('#play').classList.contains('hidden')) route();
    cur = { ...m.round, answered: false, timers: [], intervals: [], cleanup: null };
    $('#rn').textContent = `Round ${m.round.n}/${m.round.total}`;
    setBar(1);
    fill(arena, h('div', { class: 'title-card' }, h('div', { class: 'emoji' }, ICONS[m.round.kind] || '🎲'), h('h2', {}, m.round.title.replace(/^\S+\s/, '')), h('p', {}, m.round.help),
      S.scores && !(Net.id in S.scores) ? h('p', { class: 'small muted' }, '👀 You’re watching — play along for fun, it won’t count.') : null));
    Sfx.play('swoosh');
    later(m.intro * 1000, startChallenge);
  });
  Net.on('g:roundResult', (m) => { S.scores = m.scores; renderScores(); showRoundResult(m); });
  Net.on('g:final', (m) => {
    clearRound();
    S.phase = 'over'; S.final = m.ranking;
    route();
    if (m.ranking[0] && m.ranking[0].id === Net.id) { UI.confetti(220); Sfx.play('win'); }
  });
})();
