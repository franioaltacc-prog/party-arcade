/* Impostor — everyone knows the secret word except the impostor. Clue, discuss, vote!
   Modes: Classic (impostor gets no word), Undercover (a close but different word) and
   Questions (a different question). Optional Jester and Detective roles, ⭐ for the best clue. */
(() => {
  'use strict';
  const { $, $$, h, fill, Net, Sfx, UI } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  let S = { phase: 'lobby', settings: { rounds: 5, clueRounds: 2, clueTime: 30, discussTime: 60, voteTime: 30, categories: {}, twoImpostors: false, impostorCategory: true, mode: 'classic', jester: false, detective: false }, categories: [], players: [], history: [], r: null, final: null, results: null };
  let deadline = 0;
  let total = 0;
  let prev = { phase: null, round: 0, turn: null, hint: null };
  let roleHidden = false;
  let roleKey = '';
  let seenClues = '';
  let stageKey = '';
  let lastTick = 0;
  const PLAYING = ['role', 'clue', 'answer', 'discuss', 'vote', 'guess', 'reveal'];
  const PHASE_LABEL = { role: '🃏 Check your card', clue: '🗝️ Clues', answer: '✍️ Answer time', discuss: '💬 Discussion', vote: '🗳️ Vote!', guess: '🎯 Last chance', reveal: '🔎 The reveal' };
  const MODES = [
    { key: 'classic', emoji: '🕵️', name: 'Classic', text: 'The impostor gets no word, maybe just the category.' },
    { key: 'undercover', emoji: '🎭', name: 'Undercover', text: 'The impostor gets a close word (pizza vs burger)… and doesn’t know it!' },
    { key: 'questions', emoji: '❓', name: 'Questions', text: 'Everyone answers a question. The impostor secretly got a different one.' },
  ];
  const MODE_NAME = Object.fromEntries(MODES.map((m) => [m.key, `${m.emoji} ${m.name}`]));

  const me = () => Net.id;
  const P = (id) => S.players.find((p) => p.id === id) || Room.player(id) || { id, name: 'Someone', avatar: '❓', color: '#888888' };
  const seated = () => !!(S.r && S.r.order.includes(me()));
  const isHost = () => Room.isHost;
  const modeOf = () => (S.r && S.r.mode) || S.settings.mode || 'classic';

  // ------------------------------------------------------------ sounds (built from Sfx tones, so the mute button and volume apply)
  const play = (fn) => { if (!Sfx.muted) { try { fn(); } catch { /* audio unavailable */ } } };
  const SND = {
    sneaky: () => play(() => [330, 311, 262, 247].forEach((f, i) => Sfx.tone(f, 0.22, 'triangle', 0.06, 0, i * 0.16))),
    card: () => play(() => { Sfx.noise(0.12, 0.08, 0, 2500); Sfx.tone(660, 0.12, 'sine', 0.06, 300, 0.05); }),
    drumroll: (sec = 1.4) => play(() => { const n = Math.round(sec * 16); for (let i = 0; i < n; i++) Sfx.noise(0.05, 0.05 + 0.08 * (i / n), i / 16, 900); Sfx.tone(110, sec, 'sawtooth', 0.025, 110); }),
    star: () => play(() => [1319, 1568, 2093].forEach((f, i) => Sfx.tone(f, 0.12, 'sine', 0.05, 0, i * 0.06))),
    unstar: () => play(() => Sfx.tone(700, 0.1, 'sine', 0.04, -300)),
    hint: () => play(() => { Sfx.tone(988, 0.18, 'sine', 0.07); Sfx.tone(1319, 0.3, 'sine', 0.07, 0, 0.18); }),
    jester: () => play(() => [523, 659, 523, 784, 1047].forEach((f, i) => Sfx.tone(f, 0.12, 'square', 0.04, i === 4 ? -600 : 0, i * 0.1))),
    locked: () => play(() => { Sfx.tone(520, 0.08, 'triangle', 0.07); Sfx.tone(780, 0.14, 'triangle', 0.07, 0, 0.08); }),
    question: () => play(() => { Sfx.tone(440, 0.14, 'sine', 0.07, 200); Sfx.tone(660, 0.2, 'sine', 0.07, 220, 0.16); }),
  };

  // ------------------------------------------------------------ routing
  function route() {
    const playing = PLAYING.includes(S.phase);
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (playing) renderPlay(); else renderLobby();
    syncChat();
  }

  // ------------------------------------------------------------ lobby
  function renderLobby() {
    const host = isHost();
    const s = S.settings;
    const mode = s.mode || 'classic';
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, options, label, fmt = (v) => v) => h('div', {},
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, options.map((v) => h('button', { class: s[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, fmt(v)))));
    const toggle = (key, label, hint) => h('label', { class: 'switch', title: hint || '' },
      h('input', { type: 'checkbox', checked: !!s[key], disabled: !host, onchange: (e) => send({ [key]: e.target.checked }) }), label);
    const online = Room.players.filter((p) => p.online).length;
    const kids = [];
    if (S.final && S.final.length) kids.push(...resultsView());
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Game settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, 'MODE'),
      h('div', { class: 'mode-cards' }, MODES.map((m) => h('button', { class: 'mode-card' + (mode === m.key ? ' on' : ''), disabled: !host, 'data-mode': m.key, onclick: () => send({ mode: m.key }) },
        h('span', { class: 'mc-emoji' }, m.emoji), h('span', { class: 'mc-name' }, m.name), h('span', { class: 'mc-text' }, m.text)))),
      h('div', { class: 'imp-set', style: { marginTop: '14px' } },
        seg('rounds', [3, 5, 8, 10], 'ROUNDS'),
        mode !== 'questions' ? seg('clueRounds', [1, 2, 3], 'CLUES EACH ROUND', (v) => `${v}×`) : null,
        seg('clueTime', [15, 30, 45, 60], mode === 'questions' ? 'ANSWER TIMER' : 'CLUE TIMER', (v) => `${mode === 'questions' ? v + 10 : v}s`),
        seg('discussTime', [30, 60, 90, 120], 'DISCUSSION', (v) => `${v}s`),
        seg('voteTime', [20, 30, 45, 60], 'VOTE TIMER', (v) => `${v}s`),
        h('div', { class: 'col', style: { gap: '10px', justifyContent: 'center' } },
          mode === 'classic' ? toggle('impostorCategory', 'Impostor knows the category') : null,
          toggle('twoImpostors', '2 impostors (7+ players)'))),
      h('div', { class: 'small muted bold', style: { margin: '16px 0 8px' } }, 'EXTRA ROLES'),
      h('div', { class: 'role-toggles' },
        h('label', { class: 'role-toggle' + (s.jester ? ' on' : ''), title: 'Needs 5+ players' },
          h('input', { type: 'checkbox', checked: !!s.jester, disabled: !host, onchange: (e) => send({ jester: e.target.checked }) }),
          h('span', { class: 'rt-emoji' }, '🃏'), h('span', {}, h('b', {}, 'Jester'), h('span', { class: 'tiny muted' }, ' · 5+ players'), h('br'), h('span', { class: 'small muted' }, 'Knows the word, but wins only if they get voted out.'))),
        h('label', { class: 'role-toggle' + (s.detective ? ' on' : ''), title: 'Needs 4+ players' },
          h('input', { type: 'checkbox', checked: !!s.detective, disabled: !host, onchange: (e) => send({ detective: e.target.checked }) }),
          h('span', { class: 'rt-emoji' }, '🔎'), h('span', {}, h('b', {}, 'Detective'), h('span', { class: 'tiny muted' }, ' · 4+ players'), h('br'), h('span', { class: 'small muted' }, 'On the crew, and learns one player who is NOT the impostor.')))),
      mode === 'questions'
        ? h('p', { class: 'small muted', style: { margin: '16px 0 0' } }, '❓ Question mode has its own question list, so categories don’t matter here.')
        : [h('div', { class: 'small muted bold', style: { margin: '16px 0 8px' } }, mode === 'undercover' ? 'CATEGORIES (word pairs)' : 'CATEGORIES'),
          h('div', { class: 'cat-chips' }, S.categories.map((c) => {
            const on = s.categories[c.key] !== false;
            return h('button', { class: 'cat-chip' + (on ? ' on' : ''), disabled: !host, title: `${c.n} words`, onclick: () => send({ categories: { [c.key]: !on } }) }, `${c.emoji} ${c.name}`);
          }))],
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-red btn-lg btn-block', disabled: online < 3, onclick: () => { Net.send('g:start'); Sfx.play('pop'); } }, S.final ? '🔁 Play again' : '🕵️ Start the game')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host to start'))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '10px' } }, online < 3 ? `Needs at least 3 players — invite ${3 - online} more! 🕵️` : `${online} players ready · up to 10 play, extra people watch`));
    fill($('#room-main'), kids);
  }

  // end-of-game results: podium, awards, everyone's numbers and the points of every round
  function resultsView() {
    const top = S.final.slice(0, 3);
    const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
    const res = S.results;
    const out = [h('div', { class: 'panel-title' }, '🏆 Final points'),
      h('div', { class: 'podium' }, order.map(([r, place]) => (r ? h('div', { class: `step p${place}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, `${r.points} pts`), h('div', { class: 'block' }, place)) : h('div', { class: 'step' }))))];
    if (res) {
      const byId = Object.fromEntries(S.final.map((p) => [p.id, p]));
      const name = (id) => (byId[id] || P(id)).name;
      if (res.awards.length) {
        out.push(h('div', { class: 'awards' }, res.awards.map((a) => h('div', { class: 'award' },
          h('div', { class: 'aw-emoji' }, a.emoji), h('div', { class: 'aw-title' }, a.title),
          h('div', { class: 'aw-who' }, a.ids.map(name).join(' & ')), h('div', { class: 'tiny muted' }, `${a.n} ${a.n === 1 ? ({ 'right votes': 'right vote', stars: 'star', 'wins as impostor': 'win as impostor', 'Jester wins': 'Jester win' }[a.unit] || a.unit) : a.unit}`)))));
      }
      const hist = res.history || [];
      out.push(h('div', { class: 'res-wrap' }, h('table', { class: 'res-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'l' }, 'Player'), h('th', { title: 'Right votes' }, '🗳️'), h('th', { title: 'Stars for clues' }, '⭐'), h('th', { title: 'Wins as impostor' }, '🕵️'),
          hist.map((r) => h('th', { title: `${MODE_NAME[r.mode] || ''} · ${winText(r.winner)}` }, `R${r.n}`, h('br'), h('span', { class: 'tiny' }, winEmoji(r.winner)))), h('th', {}, 'Total'))),
        h('tbody', {}, res.rows.map((row) => h('tr', { class: row.id === me() ? 'me' : '' },
          h('td', { class: 'l' }, UI.avatar(byId[row.id] || P(row.id), 'sm'), h('span', {}, name(row.id))),
          h('td', {}, row.correctVotes || '·'), h('td', {}, row.stars || '·'), h('td', {}, row.impRounds ? `${row.impWins}/${row.impRounds}` : '·'),
          hist.map((r) => {
            const role = r.impostors.includes(row.id) ? 'imp' : r.jester === row.id ? 'jest' : r.detective === row.id ? 'det' : '';
            const g = r.gained[row.id];
            return h('td', { class: 'rc ' + role, title: role === 'imp' ? 'Impostor this round' : role === 'jest' ? 'Jester this round' : role === 'det' ? 'Detective this round' : '' }, g == null ? '–' : g ? `+${g}` : '0');
          }),
          h('td', { class: 'tot' }, row.points)))))),
      h('p', { class: 'tiny faint', style: { margin: '6px 0 0' } }, 'Red = impostor that round · orange = Jester · blue = Detective'));
    }
    out.push(h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' } }));
    return out;
  }
  const winEmoji = (w) => ({ crew: '🎉', impostor: '🕵️', jester: '🃏' }[w] || '😕');
  const winText = (w) => ({ crew: 'crew won', impostor: 'impostor won', jester: 'Jester won' }[w] || 'cancelled');

  // ------------------------------------------------------------ play
  function renderPlay() {
    const r = S.r;
    if (!r) return;
    $('#round').textContent = `Round ${r.n}/${S.settings.rounds}`;
    $('#phase-label').textContent = S.phase === 'clue' ? `${PHASE_LABEL.clue} · ${r.clueRound}/${r.clueRounds}` : PHASE_LABEL[S.phase];
    $('#mode-tag').textContent = MODE_NAME[r.mode] || '';
    renderScores();
    renderRole();
    renderStage();
    renderClues();
    fill($('#spec-note'), S.spectator ? h('div', { class: 'spec-note' }, '👀 You’re watching this round. Your chat only goes to other spectators. You’ll get a seat next round!') : null);
  }

  function renderScores() {
    const r = S.r;
    const rows = [...S.players].sort((a, b) => b.points - a.points);
    const draw = () => fill($('#scores'), rows.map((p, i) => h('div', { class: 'score-row' + (p.id === me() ? ' me' : ''), 'data-flip-id': p.id },
      h('span', { style: { width: '20px' } }, ['🥇', '🥈', '🥉'][i] || i + 1), UI.avatar(p, 'sm'),
      h('span', { class: 'bold', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
      r && r.impostors && r.impostors.includes(p.id) ? h('span', { title: 'Impostor' }, '🕵️') : null,
      h('span', { class: 'pts' }, p.points))));
    if (FX.board) FX.board($('#scores'), draw); else draw();
    const hist = S.history || [];
    fill($('#history'), hist.length ? [h('div', { class: 'small muted bold', style: { margin: '12px 0 6px' } }, '📜 ROUNDS SO FAR'),
      [...hist].reverse().map((x) => h('div', { class: 'hist-row ' + (x.winner || '') },
        h('span', { class: 'hn' }, `R${x.n}`), h('span', { class: 'hw' }, winEmoji(x.winner)),
        h('span', { class: 'hi' }, x.impostors.map((id) => P(id).name).join(' & ')),
        h('span', { class: 'hs', title: secretLine(x) }, secretShort(x))))] : null);
  }
  const secretShort = (x) => (x.mode === 'questions' ? '❓' : x.mode === 'undercover' ? `${x.word} / ${x.impWord}` : x.word);
  const secretLine = (x) => (x.mode === 'questions' ? `Crew: ${x.question}\nImpostor: ${x.impQuestion}` : x.mode === 'undercover' ? `Crew: ${x.word} · Impostor: ${x.impWord}` : x.word);

  function renderRole() {
    const r = S.r;
    const reveal = S.phase === 'reveal';
    const key = [r.n, r.role, roleHidden, reveal, r.word, r.question, !!r.category, r.impWord, r.impQuestion].join('|');
    if (key === roleKey) return;
    const fresh = roleKey.split('|')[0] !== String(r.n);
    roleKey = key;
    const cat = r.category ? h('span', { class: 'rc-cat' }, r.category.emoji, ' ', r.category.name) : r.mode === 'questions' ? null : h('span', { class: 'rc-cat' }, '❓ Category: secret');
    const mode = r.mode;
    const big = (text) => h('div', { class: 'rc-big' + (mode === 'questions' ? ' q' : '') }, mode === 'questions' ? text : (text || '').toUpperCase());
    const secret = mode === 'questions' ? r.question : r.word;
    const extraTip = { jester: '🃏 Get the others to vote YOU out to win… but don’t make it obvious!', detective: '🔎 When the discussion starts you’ll learn one player who is NOT the impostor.' }[r.role] || '';
    const sharedTip = mode === 'undercover' ? 'Someone has a slightly different word… and it could be you! 👀'
      : mode === 'questions' ? 'Answer it when the timer starts. Someone got a different question… maybe you!'
        : `Give clues that prove you know it, without giving it away. ${r.impCount > 1 ? 'There are 2 impostors!' : 'One of you is the impostor!'}`;
    const label = mode === 'questions' ? 'your question is:' : 'the word is:';
    let card;
    if (r.role === 'impostor') {
      const tip = reveal
        ? (mode === 'undercover' ? `Your word was ${r.impWord} · the crew had ${r.word}` : mode === 'questions' ? `The crew’s question was: ${r.question}` : `The word was: ${r.word}`)
        : mode === 'undercover' ? `Your word was “${r.word}” — different from the crew’s!`
          : `You don’t know the word. Listen to the clues and blend in!${r.impCount > 1 ? ' There are 2 impostors — you don’t know the other one.' : ''}`;
      card = h('div', { class: 'role-card imp' },
        h('div', { class: 'rc-top' }, reveal ? 'Busted? 😈' : 'Shhh… 🤫'),
        h('div', { class: 'rc-big' }, reveal ? '🕵️ You were the IMPOSTOR' : '🕵️ You are the IMPOSTOR'),
        cat, h('div', { class: 'rc-tip' }, tip));
    } else if (r.role === 'crew' || r.role === 'jester' || r.role === 'detective') {
      const top = { crew: mode === 'classic' ? '✅ You’re in the crew — ' + label : '🤫 Your secret ' + (mode === 'questions' ? 'question' : 'word') + ':', jester: '🃏 You’re the JESTER — ' + label, detective: '🔎 You’re the DETECTIVE — ' + label }[r.role];
      card = h('div', { class: 'role-card ' + (r.role === 'crew' ? 'crew' : r.role) },
        h('div', { class: 'rc-top' }, top), big(secret), cat,
        h('div', { class: 'rc-tip' }, extraTip || sharedTip, extraTip && mode !== 'classic' ? h('div', {}, sharedTip) : null));
    } else {
      card = h('div', { class: 'role-card spec' },
        h('div', { class: 'rc-top' }, '👀 You’re spectating — ' + (mode === 'questions' ? 'the crew’s question:' : 'the word is:')),
        big(secret), cat,
        r.impWord ? h('div', { class: 'rc-tip' }, `🕵️ The impostor’s word: ${r.impWord}`) : null,
        r.impQuestion ? h('div', { class: 'rc-tip' }, `🕵️ The impostor’s question: ${r.impQuestion}`) : null);
    }
    card.append(h('span', { class: 'rc-hide' }, roleHidden ? '' : 'tap to hide'), h('div', { class: 'rc-cover' }, '🙈 Card hidden — tap to show'));
    card.classList.toggle('hid', roleHidden);
    card.addEventListener('click', () => { roleHidden = !roleHidden; Sfx.play('click'); renderRole(); });
    fill($('#role'), card);
    if (fresh) {
      SND.card();
      if (G) {
        G.fromTo(card, { rotationY: 180, scale: 0.7, autoAlpha: 0 }, { rotationY: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: 'back.out(1.5)', clearProps: 'transform' });
        G.from(card.querySelector('.rc-big'), { scale: 0.3, autoAlpha: 0, duration: 0.7, delay: 0.45, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
      }
    }
  }

  function clueForm(placeholder, onSend, label) {
    const input = h('input', { class: 'input', maxlength: 30, placeholder, autocomplete: 'off', spellcheck: false });
    const form = h('form', { class: 'clue-form', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { onSend(v); input.value = ''; } } },
      input, h('button', { class: 'btn btn-pink', type: 'submit' }, label));
    setTimeout(() => input.focus(), 50);
    return form;
  }

  function hintBox(r) {
    if (!r.hint || r.role !== 'detective') return null;
    const p = P(r.hint);
    return h('div', { class: 'hint-box' }, h('span', { class: 'hb-emoji' }, '🔎'), UI.avatar(p, 'sm'), h('span', {}, h('b', {}, p.name), ' is NOT the impostor. Use it wisely!'));
  }

  function realQuestion(r) {
    return r.realQuestion ? h('div', { class: 'real-q' }, h('div', { class: 'tiny muted bold' }, 'THE CREW’S QUESTION WAS'), h('div', { class: 'rq' }, r.realQuestion)) : null;
  }

  function renderStage() {
    const r = S.r;
    const el = $('#stage');
    const phase = S.phase;
    const mine = r.role === 'impostor';
    const answered = r.answered || [];
    // only rebuild when something visible changed, so a half-typed clue isn't wiped
    const key = JSON.stringify([phase, r.n, r.turn, r.clueRound, r.myVote, r.voted, r.out, r.winner, r.cancelled, r.hint, answered.length, (r.clues[me()] || []).length, isHost(), S.spectator, S.players.map((p) => p.name + p.avatar)]);
    if (key === stageKey) return;
    stageKey = key;
    let kids;
    if (phase === 'role') {
      kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, `Round ${r.n}`), h('p', { class: 'muted' }, r.mode === 'questions' ? 'Read your question! Answers start in a moment… ❓' : 'Look at your card! Clues start in a moment… 🃏'));
    } else if (phase === 'answer') {
      const mineAns = (r.clues[me()] || [])[0];
      const status = h('p', { class: 'small muted' }, `${answered.length}/${r.order.length} answered · answers show when everyone’s done`);
      if (seated() && !mineAns) {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '✍️ Answer your question!'),
          h('p', { class: 'muted' }, 'Short and honest works best. Everyone answers at the same time.'),
          clueForm('Your answer (max 30 letters)', (v) => Net.send('g:answer', { text: v }), 'Lock in'), status);
      } else {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, seated() ? '🔒 Answer locked in!' : '✍️ Players are answering…'),
          mineAns ? h('div', { class: 'locked-ans' }, mineAns) : null, status);
      }
    } else if (phase === 'clue') {
      const turn = r.turn;
      if (turn === me()) {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '✍️ Your turn!'),
          h('p', { class: 'muted' }, mine ? 'You don’t know the word — give a clue that blends in 😈' : 'One word or a short phrase. Don’t say the word!'),
          clueForm('Your clue (max 30 letters)', (v) => Net.send('g:clue', { text: v }), 'Send'));
      } else {
        const p = P(turn);
        kids = h('div', { class: 'stage-center thinking' }, UI.avatar(p, 'lg'), h('div', { class: 'big' }, `${p.name} is thinking…`),
          h('p', { class: 'muted' }, 'Chat is off during clues. Watch closely! 👀'));
      }
    } else if (phase === 'discuss') {
      kids = h('div', { class: 'stage-center' }, realQuestion(r), h('div', { class: 'big' }, '🗣️ Who’s the impostor?'),
        h('p', { class: 'muted' }, r.mode === 'questions' ? 'Whose answer doesn’t fit the question? Argue it out in the chat! 🤔' : 'Argue it out in the chat! Whose clue was a little too vague? 🤔'),
        hintBox(r),
        seated() ? h('p', { class: 'small muted' }, `⭐ Tap the star next to your favourite ${r.mode === 'questions' ? 'answer' : 'clue'} to give it +25 points.`) : null,
        isHost() ? h('button', { class: 'btn btn-yellow', onclick: () => Net.send('g:skipDiscussion') }, '🗳️ Start the vote now') : null);
    } else if (phase === 'vote') {
      const voted = r.voted || [];
      if (seated()) {
        kids = h('div', { class: 'stage-center' }, realQuestion(r), h('div', { class: 'big' }, r.role === 'jester' ? '🗳️ Vote… (you want THEM to pick you 🃏)' : '🗳️ Vote out the impostor!'),
          hintBox(r),
          h('div', { class: 'vote-grid' },
            r.order.filter((id) => id !== me()).map((id) => {
              const p = P(id);
              return h('button', { class: 'vote-btn' + (r.myVote === id ? ' on' : '') + (r.hint === id ? ' cleared' : ''), onclick: () => { Net.send('g:vote', { target: id }); Sfx.play('pop'); } },
                UI.avatar(p, 'lg'), h('span', { class: 'vn' }, p.name), h('span', { class: 'vt' }, r.hint === id ? '🔎 cleared' : voted.includes(id) ? '✔ voted' : ' '));
            }),
            h('button', { class: 'vote-btn skip' + (r.myVote === 'skip' ? ' on' : ''), onclick: () => { Net.send('g:vote', { target: 'skip' }); Sfx.play('pop'); } },
              h('div', { class: 'avatar lg', style: { '--c': '#475569' } }, '🤷'), h('span', { class: 'vn' }, 'Skip'), h('span', { class: 'vt' }, 'not sure'))),
          h('p', { class: 'small muted' }, `${voted.length}/${r.order.length} voted · votes stay secret until everyone’s done`));
      } else {
        kids = h('div', { class: 'stage-center' }, realQuestion(r), h('div', { class: 'big' }, '🗳️ Players are voting…'), h('p', { class: 'muted' }, `${voted.length}/${r.order.length} voted`));
      }
    } else if (phase === 'guess') {
      const out = P(r.out);
      const uc = r.mode === 'undercover';
      kids = h('div', { class: 'stage-center' }, tallyView(r),
        r.out === me()
          ? [h('div', { class: 'big' }, uc ? '🎭 You were the UNDERCOVER!' : '🎯 Caught! One last chance…'),
            h('p', { class: 'muted' }, uc ? `Your word “${r.word}” was different. Guess the crew’s word to steal the win!` : 'Guess the secret word to steal the win!'),
            clueForm('Your guess…', (v) => Net.send('g:guess', { text: v }), 'Guess!')]
          : [h('div', { class: 'big' }, `🎯 ${out.name} IS an impostor!`), h('p', { class: 'muted' }, 'They get one guess at the word to steal the win… 🤞')]);
    } else if (phase === 'reveal') {
      kids = r.cancelled ? h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '😕 Round cancelled'), h('p', { class: 'muted' }, 'Next round starting…')) : revealView(r);
    }
    fill(el, kids);
  }

  // the big reveal: face-down cards flip over to show the impostor(s), then the secret and the points
  function revealView(r) {
    const imps = r.impostors || [];
    const head = { crew: ['crew', '🎉 Impostor caught!'], impostor: ['imp', '🕵️ Impostor wins!'], jester: ['jest', '🃏 The Jester wins!'] }[r.winner] || ['imp', '🔎 The reveal'];
    let secret;
    if (r.mode === 'undercover') {
      secret = h('div', { class: 'word-pair' }, h('div', { class: 'wp crew' }, h('span', { class: 'tiny muted bold' }, 'CREW WORD'), h('b', {}, r.word)),
        h('span', { class: 'wp-vs' }, 'vs'), h('div', { class: 'wp imp' }, h('span', { class: 'tiny muted bold' }, 'IMPOSTOR WORD'), h('b', {}, r.impWord)));
    } else if (r.mode === 'questions') {
      secret = h('div', { class: 'q-pair' }, h('div', { class: 'wp crew' }, h('span', { class: 'tiny muted bold' }, 'CREW QUESTION'), h('b', {}, r.question)),
        h('div', { class: 'wp imp' }, h('span', { class: 'tiny muted bold' }, 'IMPOSTOR QUESTION'), h('b', {}, r.impQuestion)));
    } else {
      secret = h('div', { class: 'word-reveal' }, `The word was “${r.word}”`);
    }
    const roles = [r.jester ? `🃏 Jester: ${P(r.jester).name}` : null, r.detective ? `🔎 Detective: ${P(r.detective).name}` : null].filter(Boolean);
    let story;
    if (r.winner === 'jester') story = h('p', { class: 'bold' }, `You voted out ${P(r.out).name}… the Jester! 🤡 They win the round.`);
    else if (r.guess) story = h('p', { class: 'bold' }, `${P(r.out).name} guessed “${r.guess}” ${r.guessOk ? '✅ and stole the win!' : '❌'}`);
    else if (r.out && imps.includes(r.out)) story = h('p', { class: 'muted' }, r.mode === 'questions' ? `${P(r.out).name} got voted out — caught!` : 'No guess in time!');
    else story = h('p', { class: 'muted' }, r.out ? `The crew voted out ${P(r.out).name}… who was innocent 😬` : 'Nobody got voted out (tie or skips)!');
    const why = r.why || {};
    return h('div', { class: 'stage-center reveal' },
      h('div', { class: 'tiny muted bold reveal-lead' }, imps.length > 1 ? 'THE IMPOSTORS WERE…' : 'THE IMPOSTOR WAS…'),
      h('div', { class: 'flip-row' }, imps.map((id) => {
        const p = P(id);
        return h('div', { class: 'flip' }, h('div', { class: 'flip-in' },
          h('div', { class: 'flip-face back' }, '❓'),
          h('div', { class: 'flip-face front' }, UI.avatar(p, 'lg'), h('div', { class: 'fname' }, p.name), h('div', { class: 'tiny' }, '🕵️ impostor'))));
      })),
      h('div', { class: 'after' },
        h('div', { class: 'result-head ' + head[0] }, head[1]),
        secret,
        roles.length ? h('div', { class: 'small muted bold' }, roles.join(' · ')) : null,
        story,
        tallyView(r),
        h('div', { class: 'gains' }, r.order.filter((id) => r.gained && r.gained[id]).sort((a, b) => r.gained[b] - r.gained[a]).map((id) => h('span', { title: (why[id] || []).map(([t, n]) => `${t} +${n}`).join('\n') },
          h('b', {}, `+${r.gained[id]}`), ` ${P(id).name}`, h('span', { class: 'gw' }, (why[id] || []).map(([t]) => t.split(' ')[0]).join(''))))),
        h('p', { class: 'tiny faint' }, S.round >= S.settings.rounds ? 'Final scores coming up…' : 'Next round in a few seconds…')));
  }

  function tallyView(r) {
    const tally = r.tally || {};
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return h('p', { class: 'muted small' }, 'Nobody voted!');
    return h('div', { class: 'tally' }, entries.map(([target, n]) => {
      const p = target === 'skip' ? { name: 'Skip', avatar: '🤷', color: '#475569' } : P(target);
      return h('span', { class: 'tchip' + (target === r.out ? ' out' : '') }, UI.avatar(p, 'sm'), p.name, ` · ${n} vote${n === 1 ? '' : 's'}`);
    }));
  }

  function renderClues() {
    const r = S.r;
    const reveal = S.phase === 'reveal';
    const turn = r.turn;
    const voted = r.voted || [];
    const stars = r.stars || {};
    const canStar = seated() && (S.phase === 'discuss' || S.phase === 'vote');
    const showStars = canStar || S.phase === 'discuss' || S.phase === 'vote' || reveal;
    const word = r.mode === 'questions' ? 'Answers' : 'Clues';
    fill($('#clues'), h('div', { class: 'panel-title' }, r.mode === 'questions' ? '✍️ Answers' : '🗝️ Clues', h('span', { class: 'count' }, `${r.order.length} players`)),
      r.order.map((id) => {
        const p = P(id);
        const clues = r.clues[id] || [];
        const chips = clues.map((c) => h('span', { class: 'clue-chip' + (c ? '' : ' none') + (c === '…' ? ' hidden-ans' : '') }, c === '…' ? '🔒 answered' : c || (r.mode === 'questions' ? '(no answer)' : '(no clue)')));
        if (id === turn) chips.push(h('span', { class: 'clue-chip wait' }, '✍️ …'));
        let tag = null;
        if (S.phase === 'vote' && voted.includes(id)) tag = h('span', { class: 'tag muted' }, '✔ voted');
        if ((S.phase === 'guess' || reveal) && r.tally && r.tally[id]) tag = h('span', { class: 'tag' }, `🗳️ ${r.tally[id]}`);
        const imp = reveal && r.impostors && r.impostors.includes(id);
        const roleTag = reveal && r.jester === id ? '🃏' : reveal && r.detective === id ? '🔎' : null;
        const hasClue = clues.some((c) => c && c !== '…');
        let star = null;
        if (showStars && hasClue) {
          const n = stars[id] || 0;
          const mineStar = r.myStar === id;
          star = canStar && id !== me()
            ? h('button', { class: 'star-btn' + (mineStar ? ' on' : ''), title: mineStar ? 'Take your star back' : `Give ${p.name} your ⭐ for the best ${word.toLowerCase().slice(0, -1)}`, onclick: (e) => { e.stopPropagation(); Net.send('g:star', { target: id }); (mineStar ? SND.unstar : SND.star)(); } }, mineStar ? '★' : '☆', n ? h('span', {}, n) : null)
            : n ? h('span', { class: 'star-btn static' }, '★', h('span', {}, n)) : null;
        }
        return h('div', { class: 'clue-row' + (id === turn ? ' turn' : '') + (imp ? ' imp' : '') + (roleTag === '🃏' ? ' jest' : ''), 'data-cid': id },
          UI.avatar(p, 'sm'), h('span', { class: 'cn', title: p.name }, p.name, id === me() ? h('span', { class: 'faint small' }, ' (you)') : null),
          h('div', { class: 'chips' }, chips), star, imp ? h('span', { class: 'tag' }, '🕵️') : roleTag ? h('span', { class: 'tag' }, roleTag) : tag);
      }));
    // animate clues that just arrived (and all the answers at once in Question mode)
    const sig = r.n + ':' + r.order.map((id) => (r.clues[id] || []).map((c) => (c === '…' ? 'x' : 'c')).join('')).join(',');
    if (G && sig !== seenClues && seenClues.split(':')[0] === String(r.n)) {
      const before = seenClues.split(':')[1].split(',');
      r.order.forEach((id, i) => {
        const now = (r.clues[id] || []).map((c) => (c === '…' ? 'x' : 'c')).join('');
        if (now !== (before[i] || '')) {
          const chips = $$(`#clues [data-cid="${CSS.escape(id)}"] .clue-chip:not(.wait)`);
          if (chips.length) FX.pop(chips[chips.length - 1], { from: 0.3 });
        }
      });
    }
    seenClues = sig;
  }

  // ------------------------------------------------------------ chat rules on the client side (the server enforces them)
  let roomChat = null;
  let playChat = null;
  function syncChat() {
    if (!playChat) return;
    const r = S.r;
    const input = playChat.input;
    let placeholder = 'Say something…';
    let disabled = false;
    if (PLAYING.includes(S.phase) && r) {
      if (S.spectator || !seated()) placeholder = '👀 Spectator chat — players can’t see this';
      else if (S.phase === 'clue' && r.turn === me()) placeholder = '✍️ Type your clue…';
      else if (S.phase === 'answer' && !(r.clues[me()] || []).length) placeholder = '✍️ Type your answer…';
      else if (S.phase === 'role' || S.phase === 'clue' || S.phase === 'answer') { placeholder = '🤫 Chat is off during clues'; disabled = true; }
      else if (S.phase === 'guess' && r.out === me()) placeholder = '🎯 Type your guess…';
      else placeholder = '💬 Who’s the impostor?';
    }
    input.placeholder = placeholder;
    input.disabled = disabled;
  }

  // ------------------------------------------------------------ timer
  setInterval(() => {
    const clock = $('#clock');
    const bar = $('#tbar');
    if (!deadline || !PLAYING.includes(S.phase)) { clock.textContent = '--'; bar.style.width = '0%'; return; }
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    const low = left <= 6;
    clock.textContent = Math.ceil(left);
    clock.classList.toggle('low', low);
    $('#tbar-wrap').classList.toggle('low', low);
    bar.style.width = (total ? Math.min(100, (left / total) * 100) : 0) + '%';
    const s = Math.ceil(left);
    const r = S.r;
    const mine = r && ((S.phase === 'clue' && r.turn === me()) || (S.phase === 'guess' && r.out === me()) || (S.phase === 'vote' && seated() && !r.myVote)
      || (S.phase === 'answer' && seated() && !(r.clues[me()] || []).length));
    if (mine && s <= 5 && s > 0 && s !== lastTick) { lastTick = s; Sfx.play('tick'); }
  }, 200);

  // ------------------------------------------------------------ the reveal animation
  function playReveal(r) {
    const stage = $('#stage');
    const flips = stage.querySelectorAll('.flip-in');
    const after = stage.querySelector('.after');
    const crewWon = r.winner === 'crew';
    const iWon = r.role === 'impostor' ? r.winner === 'impostor' : r.role === 'jester' ? r.winner === 'jester' : (r.role === 'crew' || r.role === 'detective') ? crewWon : false;
    const banner = () => {
      const title = { crew: '🎉 IMPOSTOR CAUGHT!', impostor: '🕵️ IMPOSTOR WINS!', jester: '🃏 THE JESTER WINS!' }[r.winner];
      const sub = r.mode === 'undercover' ? `${r.word} vs ${r.impWord}` : r.mode === 'questions' ? 'Different question, same game 😈' : `The word was “${r.word}”`;
      if (FX.banner && title) FX.banner(title, sub, { color: { crew: '#22d3ee', impostor: '#f43f5e', jester: '#fb923c' }[r.winner], hold: 1.5 });
      if (r.winner === 'jester') SND.jester(); else Sfx.play(iWon ? 'win' : r.role === 'spectator' ? 'pop' : 'lose');
      if (iWon) UI.confetti(160);
    };
    if (!G) { banner(); return; }
    SND.drumroll(1.3);
    G.set(flips, { rotationY: 0 });
    G.set(after, { autoAlpha: 0, y: 16 });
    const tl = G.timeline();
    tl.from(stage.querySelectorAll('.flip'), { scale: 0.4, autoAlpha: 0, y: 20, stagger: 0.12, duration: 0.45, ease: 'back.out(2)' })
      .to(flips, { rotationY: '+=8', yoyo: true, repeat: 5, duration: 0.09, ease: 'sine.inOut' })
      .to(flips, { rotationY: 180, duration: 0.6, stagger: 0.25, ease: 'back.out(1.6)' }, '+=0.15')
      .add(() => { Sfx.play('boom'); banner(); }, '-=0.3')
      .to(after, { autoAlpha: 1, y: 0, duration: 0.45, clearProps: 'transform' }, '+=0.1')
      .add(() => FX.list && FX.list(stage.querySelectorAll('.tchip, .gains span, .wp'), { y: 14, scale: 0.6, stagger: 0.06, ease: 'back.out(2)' }));
    // a background tab barely runs animations: make sure the result is shown anyway
    setTimeout(() => { if (tl.progress() < 1) tl.progress(1); }, 4500);
  }

  // ------------------------------------------------------------ state + effects
  function onState(st) {
    const before = S.r;
    S = st;
    const r = S.r;
    if (S.left != null) { deadline = performance.now() + S.left * 1000; total = S.total || S.left; } else deadline = 0;
    route();
    if (!r) { prev = { phase: S.phase, round: 0, turn: null, hint: null }; return; }
    if (S.phase === 'role' && r.n !== prev.round) {
      roleHidden = false;
      Sfx.play('swoosh');
      if (r.role === 'impostor') setTimeout(SND.sneaky, 350);
      else if (r.mode === 'questions') setTimeout(SND.question, 350);
      const sub = { impostor: '🤫 You are the impostor…', jester: '🃏 You are the Jester!', detective: '🔎 You are the Detective!', spectator: '👀 Spectating' }[r.role]
        || (r.mode === 'classic' ? '🔎 Find the impostor!' : r.mode === 'undercover' ? '🎭 Someone’s word is different…' : '❓ Someone’s question is different…');
      if (FX.banner) FX.banner(`ROUND ${r.n}`, sub, { color: r.role === 'impostor' ? '#f43f5e' : r.role === 'jester' ? '#fb923c' : '#22d3ee', hold: 0.9 });
    }
    if (S.phase === 'clue' && r.turn === me() && prev.turn !== me()) { Sfx.play('go'); UI.toast('✍️ Your turn — give a clue!', 'good', 2000); }
    if (S.phase === 'answer' && prev.phase !== 'answer') Sfx.play('go');
    if (S.phase === 'answer' && before && (before.clues[me()] || []).length === 0 && (r.clues[me()] || []).length) SND.locked();
    if (S.phase === 'discuss' && prev.phase !== 'discuss') { Sfx.play('message'); if (r.mode === 'questions') SND.question(); }
    if (r.hint && r.hint !== prev.hint && r.role === 'detective') { setTimeout(SND.hint, 300); const hb = $('#stage .hint-box'); if (hb && G) G.from(hb, { scale: 0.5, autoAlpha: 0, duration: 0.6, ease: 'back.out(2.5)' }); }
    if (S.phase === 'vote' && prev.phase !== 'vote') Sfx.play('boing');
    if (S.phase === 'guess' && prev.phase !== 'guess') { Sfx.play('boom'); if (FX.list) FX.list($('#stage').querySelectorAll('.tchip'), { scale: 0.3, y: 0, stagger: 0.15, ease: 'back.out(2.5)' }); }
    if (S.phase === 'reveal' && prev.phase !== 'reveal' && !r.cancelled) playReveal(r);
    if (S.phase !== prev.phase && G && S.phase !== 'reveal') FX.list($('#stage').children, { y: 12, stagger: 0.05, duration: 0.35 });
    prev = { phase: S.phase, round: r.n, turn: r.turn, hint: r.hint };
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'impostor',
    title: 'Impostor',
    emoji: '🕵️',
    tagline: 'Everyone knows the secret word… except the impostor. Give clues, find the faker, vote them out!',
    howTo: '<b>How to play</b><ul>'
      + '<li>Everyone gets the secret word — except one random <b>impostor</b>.</li>'
      + '<li>Take turns giving <b>one clue</b> each in the chat. Don’t make it too obvious!</li>'
      + '<li>Discuss, then <b>vote</b> out who you think is faking it. Caught impostors get one guess at the word to steal the win.</li>'
      + '<li>⭐ During the discussion, star your favourite clue: every star is <b>+25 points</b>.</li></ul>'
      + '<b>Modes</b><ul>'
      + '<li>🕵️ <b>Classic</b>: the impostor gets no word (maybe the category).</li>'
      + '<li>🎭 <b>Undercover</b>: the impostor gets a close word (pizza vs burger) and doesn’t know they’re the impostor!</li>'
      + '<li>❓ <b>Questions</b>: everyone answers a question at the same time. The impostor secretly got a different one.</li></ul>'
      + '<b>Extra roles</b> (the host can switch them on)<ul>'
      + '<li>🃏 <b>Jester</b>: knows the word, but wins only if they get voted out. 5+ players.</li>'
      + '<li>🔎 <b>Detective</b>: on the crew, and learns one player who is NOT the impostor. 4+ players.</li></ul>'
      + '<b>Points</b>: right vote +100 · crew win +50 · impostor not caught +250 · impostor steals with a guess +200 · Jester voted out +300 · each ⭐ +25. 3–10 players.',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  roomChat = Lobby.ChatBox($('#room-chat'));
  playChat = Lobby.ChatBox($('#play-chat'), { title: '💬 Game chat' });

  Lobby.on('joined', (m) => { roleKey = ''; seenClues = ''; stageKey = ''; onState(m.state); });
  Lobby.on('players', () => { if (!PLAYING.includes(S.phase)) renderLobby(); else renderPlay(); });
  Lobby.on('entry', () => { $('#room').classList.add('hidden'); $('#play').classList.add('hidden'); });
  Net.on('g:state', (m) => onState(m.state));
  Net.on('g:toast', (m) => { UI.toast(m.text, m.bad ? 'bad' : 'good', m.text.startsWith('🔎') ? 6000 : 3000); if (m.bad) Sfx.play('wrong'); });
  Net.on('g:final', (m) => {
    const top = m.ranking[0];
    if (top && top.id === me() && m.ranking.length > 1 && top.points > (m.ranking[1] ? m.ranking[1].points : 0)) { UI.confetti(220); Sfx.play('win'); }
    setTimeout(() => { if (G) FX.list($$('#room-main .award, #room-main .res-table tbody tr'), { y: 14, scale: 0.8, stagger: 0.07, ease: 'back.out(2)' }); }, 50);
  });
  void roomChat;
})();
