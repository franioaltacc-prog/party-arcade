/* Doodle Guess — draw & guess with friends. */
(() => {
  'use strict';
  const { $, $$, h, fill, Net, Sfx, UI } = PA;

  const COLORS = ['#111111', '#ffffff', '#9ca3af', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#92400e', '#fde68a', '#86efac', '#93c5fd', '#f9a8d4'];
  const SIZES = [4, 10, 20, 40];
  const S = { phase: 'lobby', settings: { rounds: 3, drawTime: 80 }, scores: {}, turn: null, strokes: [], final: null };
  const tool = { color: 0, size: 1, eraser: false };
  let endsAt = 0;
  let pending = [];
  let strokeId = 1;
  let drawing = null;
  let chooseClose = null;

  const cv = $('#board');
  const ctx = cv.getContext('2d');
  const isDrawer = () => S.turn && S.turn.drawer === Net.id && S.phase === 'drawing';

  // ------------------------------------------------------------ canvas
  function clearCanvas() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1000, 750); }
  function drawSeg(s) {
    const [x0, y0, x1, y1, c, size] = s;
    ctx.strokeStyle = COLORS[c] || '#111';
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  function redraw() { clearCanvas(); S.strokes.forEach(drawSeg); }
  clearCanvas();

  function pos(e) {
    const r = cv.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / r.width * 1000), Math.round((e.clientY - r.top) / r.height * 750)];
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!isDrawer()) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    drawing = { last: pos(e), id: strokeId++ };
    const [x, y] = drawing.last;
    addSeg([x, y, x + 0.1, y, tool.eraser ? 1 : tool.color, tool.eraser ? 40 : SIZES[tool.size], drawing.id]);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing || !isDrawer()) return;
    const p = pos(e);
    const [lx, ly] = drawing.last;
    if (Math.hypot(p[0] - lx, p[1] - ly) < 2) return;
    addSeg([lx, ly, p[0], p[1], tool.eraser ? 1 : tool.color, tool.eraser ? 40 : SIZES[tool.size], drawing.id]);
    drawing.last = p;
  });
  const endStroke = () => { drawing = null; };
  cv.addEventListener('pointerup', endStroke);
  cv.addEventListener('pointercancel', endStroke);
  function addSeg(seg) { S.strokes.push(seg); drawSeg(seg); pending.push(seg); }
  setInterval(() => { if (pending.length) { Net.send('g:draw', { segs: pending.splice(0, 200) }); } }, 45);

  // tools
  fill($('#swatches'), COLORS.map((c, i) => h('button', { style: { background: c }, title: c, 'aria-label': 'Color ' + c, onclick: () => { tool.color = i; tool.eraser = false; renderTools(); } })));
  fill($('#sizes'), SIZES.map((s, i) => h('button', { title: `Size ${s}`, onclick: () => { tool.size = i; tool.eraser = false; renderTools(); } }, h('i', { style: { width: Math.max(4, s / 2) + 'px', height: Math.max(4, s / 2) + 'px' } }))));
  $('#t-eraser').addEventListener('click', () => { tool.eraser = !tool.eraser; renderTools(); });
  $('#t-undo').addEventListener('click', () => Net.send('g:undo'));
  $('#t-clear').addEventListener('click', () => Net.send('g:clear'));
  function renderTools() {
    $$('#swatches button').forEach((b, i) => b.classList.toggle('on', !tool.eraser && i === tool.color));
    $$('#sizes button').forEach((b, i) => b.classList.toggle('on', i === tool.size));
    $('#t-eraser').classList.toggle('btn-pink', tool.eraser);
  }
  renderTools();

  // ------------------------------------------------------------ UI pieces
  function overlay(...kids) { const o = $('#overlay'); fill(o, h('div', {}, ...kids)); o.classList.remove('hidden'); }
  function hideOverlay() { $('#overlay').classList.add('hidden'); }

  function renderScores() {
    const rows = Object.entries(S.scores).sort((a, b) => b[1] - a[1]).map(([id, pts]) => {
      const p = Room.player(id) || { name: '?', avatar: '❓', color: '#888' };
      const isD = S.turn && S.turn.drawer === id && (S.phase === 'drawing' || S.phase === 'choosing');
      const got = S.turn && (S.turn.guessed || []).includes(id);
      return h('div', { class: 'score-row' + (isD ? ' drawer' : '') + (got ? ' got' : '') },
        UI.avatar(p, 'sm'), h('span', { class: 'bold grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name, id === Net.id ? ' (you)' : ''),
        isD ? h('span', { title: 'Drawing' }, '✏️') : got ? h('span', { title: 'Guessed it' }, '✅') : null,
        h('span', { class: 'pts' }, pts));
    });
    fill($('#scores'), rows);
  }

  function renderHeader() {
    const t = S.turn || {};
    $('#round').textContent = t.round ? `Round ${Math.min(t.round, t.rounds)}/${t.rounds}` : '';
    if (S.phase === 'drawing') $('#hint').textContent = t.word ? t.word.toUpperCase() : (t.hint || '');
    else $('#hint').textContent = '';
    $('#tools').classList.toggle('hidden', !isDrawer());
    $('#canvas-wrap').classList.toggle('can-draw', isDrawer());
  }

  setInterval(() => {
    if (S.phase !== 'drawing') { $('#clock').textContent = '--'; $('#clock').classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
    $('#clock').textContent = left;
    $('#clock').classList.toggle('low', left <= 10);
    if (left <= 5 && left > 0 && $('#clock').dataset.last !== String(left)) Sfx.play('tick');
    $('#clock').dataset.last = left;
  }, 250);

  function nameOf(id) { const p = Room.player(id); return p ? `${p.avatar} ${p.name}` : 'Someone'; }

  function showChoosing() {
    hideOverlay();
    if (chooseClose) { chooseClose(true); chooseClose = null; }
    const t = S.turn;
    if (t.drawer === Net.id && t.choices) {
      overlay(h('div', { class: 'big' }, '✏️ Your turn!'), h('p', { class: 'muted' }, 'Pick a word to draw'));
      chooseClose = UI.modal(h('div', { style: { textAlign: 'center' } },
        h('div', { style: { fontSize: '3rem' } }, '✏️'), h('h2', {}, 'Pick a word to draw'),
        h('p', { class: 'muted' }, 'Others will try to guess it. You have 15 seconds to choose!'),
        h('div', { class: 'word-choice' }, t.choices.map((w, i) => h('button', { class: 'btn btn-pink btn-lg', onclick: () => { Net.send('g:pick', { i }); chooseClose(true); chooseClose = null; } }, w)))), { dismissable: false });
      Sfx.play('pop');
    } else {
      overlay(h('div', { class: 'big' }, '🤔'), h('p', {}, `${nameOf(t.drawer)} is choosing a word…`));
    }
  }

  function route() {
    const playing = ['choosing', 'drawing', 'reveal'].includes(S.phase);
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (!playing) renderRoomMain();
    else {
      renderScores();
      renderHeader();
      redraw();
      if (S.phase === 'choosing') showChoosing();
      else if (S.phase === 'drawing') hideOverlay();
    }
  }

  function renderRoomMain() {
    const host = Room.isHost;
    const kids = [];
    if (S.final && S.final.length) {
      const top = S.final.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      kids.push(h('div', { class: 'panel-title' }, '🏆 Final scores'),
        h('div', { class: 'podium' }, order.map((r, i) => r ? h('div', { class: `step p${[2, 1, 3][i]}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, `${r.points} pts`), h('div', { class: 'block' }, [2, 1, 3][i])) : h('div', { class: 'step' }))));
    }
    const seg = (key, opts, label) => h('div', { style: { marginBottom: '14px' } },
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: S.settings[key] === v ? 'on' : '', disabled: !host, onclick: () => { Net.send('g:settings', { ...S.settings, [key]: v }); Sfx.play('click'); } }, l))));
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      seg('rounds', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], 'ROUNDS'),
      seg('drawTime', [[50, '50s'], [80, '80s'], [100, '100s'], [120, '120s']], 'DRAW TIME'),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => Net.send('g:start') }, S.final ? '🔁 Play again' : '🎨 Start game')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, 'Needs at least 2 players. Everyone takes turns drawing!'),
    );
    fill($('#room-main'), kids);
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'doodle',
    title: 'Doodle Guess',
    emoji: '🎨',
    tagline: 'One person draws, everyone else races to guess the word!',
    howTo: '<b>How to play</b><ul><li>Take turns drawing a secret word.</li><li>Type your guesses in the chat — the faster you guess, the more points.</li><li>The artist gets points for every correct guess.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  const guessBox = Lobby.ChatBox($('#play-chat'), { title: '💬 Guess the word!', placeholder: 'Type your guess…', onSend: (text) => Net.send('g:guess', { text }) });

  Lobby.on('joined', (m) => {
    Object.assign(S, m.state);
    if (S.turn && S.turn.remaining != null) endsAt = performance.now() + S.turn.remaining * 1000;
    route();
  });
  Lobby.on('players', () => { if ($('#play').classList.contains('hidden')) renderRoomMain(); else renderScores(); });

  Net.on('g:settings', (m) => { S.settings = m.settings; renderRoomMain(); });
  Net.on('g:scores', (m) => { S.scores = m.scores; renderScores(); });
  Net.on('g:choosing', (m) => {
    S.phase = 'choosing'; S.turn = m.turn; S.strokes = []; S.final = null;
    if (m.scores) S.scores = m.scores;
    route();
  });
  Net.on('g:choose', (m) => { if (S.turn) { S.turn.choices = m.words; showChoosing(); } });
  Net.on('g:drawing', (m) => {
    if (chooseClose) { chooseClose(true); chooseClose = null; }
    S.phase = 'drawing'; S.turn = m.turn; S.strokes = [];
    endsAt = performance.now() + (m.turn.remaining || S.settings.drawTime) * 1000;
    route();
    hideOverlay();
    if (isDrawer()) { UI.toast(`✏️ Draw: ${m.turn.word.toUpperCase()}`, 'good', 3000); Sfx.play('go'); }
    else guessBox.add({ sys: true, text: `✏️ ${nameOf(m.turn.drawer)} is drawing now!` });
  });
  Net.on('g:draw', (m) => { m.segs.forEach((s) => { S.strokes.push(s); drawSeg(s); }); });
  Net.on('g:redraw', (m) => { S.strokes = m.strokes; redraw(); });
  Net.on('g:hint', (m) => { if (S.turn) { S.turn.hint = m.hint; renderHeader(); Sfx.play('tick'); } });
  Net.on('g:word', (m) => { if (S.turn) { S.turn.word = m.word; renderHeader(); } });
  Net.on('g:close', (m) => { UI.toast(`🔥 "${m.text}" is SO close!`, '', 2200); });
  Net.on('g:chat', (m) => guessBox.add({ from: { id: m.id, name: m.name, avatar: m.avatar, color: m.color }, text: m.text, secret: m.secret }));
  Net.on('g:correct', (m) => {
    S.scores = m.scores;
    if (S.turn) S.turn.guessed = m.guessed;
    guessBox.add({ from: { id: m.id, name: m.name, avatar: m.avatar, color: '#22c55e' }, text: `guessed the word! +${m.points} 🎉`, good: true });
    if (m.id === Net.id) { Sfx.play('right'); UI.toast(`🎉 Correct! +${m.points}`, 'good'); } else Sfx.play('coin');
    renderScores();
  });
  Net.on('g:reveal', (m) => {
    S.phase = 'reveal'; S.scores = m.scores;
    renderScores(); renderHeader();
    $('#tools').classList.add('hidden');
    overlay(h('p', { class: 'muted' }, 'The word was'), h('div', { class: 'big gradient-text' }, m.word.toUpperCase()),
      h('p', {}, m.guessed.length ? `${m.guessed.length} player${m.guessed.length === 1 ? '' : 's'} got it! 🎉` : 'Nobody got it 😅'));
    Sfx.play(m.guessed.length ? 'win' : 'lose');
  });
  Net.on('g:final', (m) => {
    S.phase = 'over'; S.final = m.ranking;
    if (chooseClose) { chooseClose(true); chooseClose = null; }
    route();
    if (m.ranking[0] && m.ranking[0].id === Net.id) { UI.confetti(200); Sfx.play('win'); }
  });
})();
