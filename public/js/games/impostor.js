/* Impostor — everyone knows the secret word except the impostor. Clue, discuss, vote! */
(() => {
  'use strict';
  const { $, $$, h, fill, Net, Sfx, UI } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  let S = { phase: 'lobby', settings: { rounds: 5, clueRounds: 2, clueTime: 30, discussTime: 60, voteTime: 30, categories: {}, twoImpostors: false, impostorCategory: true }, categories: [], players: [], r: null, final: null };
  let deadline = 0;
  let total = 0;
  let prev = { phase: null, round: 0, turn: null };
  let roleHidden = false;
  let roleKey = '';
  let seenClues = '';
  let stageKey = '';
  let lastTick = 0;
  const PLAYING = ['role', 'clue', 'discuss', 'vote', 'guess', 'reveal'];
  const PHASE_LABEL = { role: '🃏 Check your card', clue: '🗝️ Clues', discuss: '💬 Discussion', vote: '🗳️ Vote!', guess: '🎯 Last chance', reveal: '🔎 The reveal' };

  const me = () => Net.id;
  const P = (id) => S.players.find((p) => p.id === id) || Room.player(id) || { id, name: 'Someone', avatar: '❓', color: '#888888' };
  const seated = () => !!(S.r && S.r.order.includes(me()));
  const isHost = () => Room.isHost;

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
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, options, label, fmt = (v) => v) => h('div', {},
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, options.map((v) => h('button', { class: s[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, fmt(v)))));
    const toggle = (key, label, hint) => h('label', { class: 'switch', title: hint || '' },
      h('input', { type: 'checkbox', checked: !!s[key], disabled: !host, onchange: (e) => send({ [key]: e.target.checked }) }), label);
    const online = Room.players.filter((p) => p.online).length;
    const kids = [];
    if (S.final && S.final.length) {
      const top = S.final.slice(0, 3);
      const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
      kids.push(h('div', { class: 'panel-title' }, '🏆 Final points'),
        h('div', { class: 'podium' }, order.map(([r, place]) => (r ? h('div', { class: `step p${place}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, `${r.points} pts`), h('div', { class: 'block' }, place)) : h('div', { class: 'step' })))),
        h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' } }));
    }
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Game settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'imp-set' },
        seg('rounds', [3, 5, 8, 10], 'ROUNDS'),
        seg('clueRounds', [1, 2, 3], 'CLUES EACH ROUND', (v) => `${v}×`),
        seg('clueTime', [15, 30, 45, 60], 'CLUE TIMER', (v) => `${v}s`),
        seg('discussTime', [30, 60, 90, 120], 'DISCUSSION', (v) => `${v}s`),
        seg('voteTime', [20, 30, 45, 60], 'VOTE TIMER', (v) => `${v}s`),
        h('div', { class: 'col', style: { gap: '10px', justifyContent: 'center' } },
          toggle('impostorCategory', 'Impostor knows the category'),
          toggle('twoImpostors', '2 impostors (7+ players)'))),
      h('div', { class: 'small muted bold', style: { margin: '16px 0 8px' } }, 'CATEGORIES'),
      h('div', { class: 'cat-chips' }, S.categories.map((c) => {
        const on = s.categories[c.key] !== false;
        return h('button', { class: 'cat-chip' + (on ? ' on' : ''), disabled: !host, title: `${c.n} words`, onclick: () => send({ categories: { [c.key]: !on } }) }, `${c.emoji} ${c.name}`);
      })),
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-red btn-lg btn-block', disabled: online < 3, onclick: () => { Net.send('g:start'); Sfx.play('pop'); } }, S.final ? '🔁 Play again' : '🕵️ Start the game')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host to start'))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '10px' } }, online < 3 ? `Needs at least 3 players — invite ${3 - online} more! 🕵️` : `${online} players ready · up to 10 play, extra people watch`));
    fill($('#room-main'), kids);
  }

  // ------------------------------------------------------------ play
  function renderPlay() {
    const r = S.r;
    if (!r) return;
    $('#round').textContent = `Round ${r.n}/${S.settings.rounds}`;
    $('#phase-label').textContent = S.phase === 'clue' ? `${PHASE_LABEL.clue} · ${r.clueRound}/${r.clueRounds}` : PHASE_LABEL[S.phase];
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
  }

  function renderRole() {
    const r = S.r;
    const reveal = S.phase === 'reveal';
    const key = [r.n, r.role, roleHidden, reveal, r.word, !!r.category].join('|');
    if (key === roleKey) return;
    const fresh = roleKey.split('|')[0] !== String(r.n);
    roleKey = key;
    const cat = r.category ? h('span', { class: 'rc-cat' }, r.category.emoji, ' ', r.category.name) : h('span', { class: 'rc-cat' }, '❓ Category: secret');
    let card;
    if (r.role === 'impostor') {
      card = h('div', { class: 'role-card imp' },
        h('div', { class: 'rc-top' }, 'Shhh… 🤫'),
        h('div', { class: 'rc-big' }, '🕵️ You are the IMPOSTOR'),
        cat,
        h('div', { class: 'rc-tip' }, reveal && r.word ? `The word was: ${r.word}` : `You don’t know the word. Listen to the clues and blend in!${r.impCount > 1 ? ' There are 2 impostors — you don’t know the other one.' : ''}`));
    } else if (r.role === 'crew') {
      card = h('div', { class: 'role-card crew' },
        h('div', { class: 'rc-top' }, '✅ You’re in the crew — the word is:'),
        h('div', { class: 'rc-big' }, (r.word || '').toUpperCase()),
        cat,
        h('div', { class: 'rc-tip' }, `Give clues that prove you know it, without giving it away. ${r.impCount > 1 ? 'There are 2 impostors!' : 'One of you is the impostor!'}`));
    } else {
      card = h('div', { class: 'role-card spec' },
        h('div', { class: 'rc-top' }, '👀 You’re spectating — the word is:'),
        h('div', { class: 'rc-big' }, (r.word || '').toUpperCase()),
        cat);
    }
    card.append(h('span', { class: 'rc-hide' }, roleHidden ? '' : 'tap to hide'), h('div', { class: 'rc-cover' }, '🙈 Card hidden — tap to show'));
    card.classList.toggle('hid', roleHidden);
    card.addEventListener('click', () => { roleHidden = !roleHidden; Sfx.play('click'); renderRole(); });
    fill($('#role'), card);
    if (fresh && G) {
      G.fromTo(card, { rotationY: 180, scale: 0.7, autoAlpha: 0 }, { rotationY: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: 'back.out(1.5)', clearProps: 'transform' });
      G.from(card.querySelector('.rc-big'), { scale: 0.3, autoAlpha: 0, duration: 0.7, delay: 0.45, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
    }
  }

  function clueForm(placeholder, onSend, label) {
    const input = h('input', { class: 'input', maxlength: 30, placeholder, autocomplete: 'off', spellcheck: false });
    const form = h('form', { class: 'clue-form', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { onSend(v); input.value = ''; } } },
      input, h('button', { class: 'btn btn-pink', type: 'submit' }, label));
    setTimeout(() => input.focus(), 50);
    return form;
  }

  function renderStage() {
    const r = S.r;
    const el = $('#stage');
    const phase = S.phase;
    const mine = r.role === 'impostor';
    // only rebuild when something visible changed, so a half-typed clue isn't wiped
    const key = JSON.stringify([phase, r.n, r.turn, r.clueRound, r.myVote, r.voted, r.out, r.winner, r.cancelled, isHost(), S.spectator, S.players.map((p) => p.name + p.avatar)]);
    if (key === stageKey) return;
    stageKey = key;
    let kids;
    if (phase === 'role') {
      kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, `Round ${r.n}`), h('p', { class: 'muted' }, 'Look at your card! Clues start in a moment… 🃏'));
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
      kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '🗣️ Who’s the impostor?'),
        h('p', { class: 'muted' }, 'Argue it out in the chat! Whose clue was a little too vague? 🤔'),
        isHost() ? h('button', { class: 'btn btn-yellow', onclick: () => Net.send('g:skipDiscussion') }, '🗳️ Start the vote now') : null);
    } else if (phase === 'vote') {
      const voted = r.voted || [];
      if (seated()) {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '🗳️ Vote out the impostor!'),
          h('div', { class: 'vote-grid' },
            r.order.filter((id) => id !== me()).map((id) => {
              const p = P(id);
              return h('button', { class: 'vote-btn' + (r.myVote === id ? ' on' : ''), onclick: () => { Net.send('g:vote', { target: id }); Sfx.play('pop'); } },
                UI.avatar(p, 'lg'), h('span', { class: 'vn' }, p.name), h('span', { class: 'vt' }, voted.includes(id) ? '✔ voted' : ' '));
            }),
            h('button', { class: 'vote-btn skip' + (r.myVote === 'skip' ? ' on' : ''), onclick: () => { Net.send('g:vote', { target: 'skip' }); Sfx.play('pop'); } },
              h('div', { class: 'avatar lg', style: { '--c': '#475569' } }, '🤷'), h('span', { class: 'vn' }, 'Skip'), h('span', { class: 'vt' }, 'not sure'))),
          h('p', { class: 'small muted' }, `${voted.length}/${r.order.length} voted · votes stay secret until everyone’s done`));
      } else {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '🗳️ Players are voting…'), h('p', { class: 'muted' }, `${voted.length}/${r.order.length} voted`));
      }
    } else if (phase === 'guess') {
      const out = P(r.out);
      kids = h('div', { class: 'stage-center' }, tallyView(r),
        r.out === me()
          ? [h('div', { class: 'big' }, '🎯 Caught! One last chance…'), h('p', { class: 'muted' }, 'Guess the secret word to steal the win!'),
            clueForm('Your guess…', (v) => Net.send('g:guess', { text: v }), 'Guess!')]
          : [h('div', { class: 'big' }, `🎯 ${out.name} IS an impostor!`), h('p', { class: 'muted' }, 'They get one guess at the word to steal the win… 🤞')]);
    } else if (phase === 'reveal') {
      if (r.cancelled) {
        kids = h('div', { class: 'stage-center' }, h('div', { class: 'big' }, '😕 Round cancelled'), h('p', { class: 'muted' }, 'Next round starting…'));
      } else {
        const crewWon = r.winner === 'crew';
        const imps = r.impostors || [];
        kids = h('div', { class: 'stage-center reveal' },
          h('div', { class: 'result-head ' + (crewWon ? 'crew' : 'imp') }, crewWon ? '🎉 Impostor caught!' : '🕵️ Impostor wins!'),
          h('div', { class: 'reveal-imps' }, imps.map((id) => { const p = P(id); return h('div', { class: 'who' }, UI.avatar(p, 'lg'), `${p.name} was the impostor`); })),
          h('div', { class: 'word-reveal' }, `The word was “${r.word}”`),
          r.guess ? h('p', { class: 'bold' }, `${P(r.out).name} guessed “${r.guess}” ${r.guessOk ? '✅ and stole the win!' : '❌'}`)
            : r.out && imps.includes(r.out) ? h('p', { class: 'muted' }, 'No guess in time!')
              : h('p', { class: 'muted' }, r.out ? `The crew voted out ${P(r.out).name}… who was innocent 😬` : 'Nobody got voted out (tie or skips)!'),
          tallyView(r),
          h('div', { class: 'gains' }, r.order.filter((id) => r.gained && r.gained[id]).map((id) => h('span', {}, `+${r.gained[id]} ${P(id).name}`))),
          h('p', { class: 'tiny faint' }, S.round >= S.settings.rounds ? 'Final scores coming up…' : 'Next round in a few seconds…'));
      }
    }
    fill(el, kids);
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
    fill($('#clues'), h('div', { class: 'panel-title' }, '🗝️ Clues', h('span', { class: 'count' }, `${r.order.length} players`)),
      r.order.map((id) => {
        const p = P(id);
        const clues = r.clues[id] || [];
        const chips = clues.map((c) => h('span', { class: 'clue-chip' + (c ? '' : ' none') }, c || '(no clue)'));
        if (id === turn) chips.push(h('span', { class: 'clue-chip wait' }, '✍️ …'));
        let tag = null;
        if (S.phase === 'vote' && voted.includes(id)) tag = h('span', { class: 'tag muted' }, '✔ voted');
        if ((S.phase === 'guess' || reveal) && r.tally && r.tally[id]) tag = h('span', { class: 'tag' }, `🗳️ ${r.tally[id]}`);
        const imp = reveal && r.impostors && r.impostors.includes(id);
        return h('div', { class: 'clue-row' + (id === turn ? ' turn' : '') + (imp ? ' imp' : ''), 'data-cid': id },
          UI.avatar(p, 'sm'), h('span', { class: 'cn', title: p.name }, p.name, id === me() ? h('span', { class: 'faint small' }, ' (you)') : null),
          h('div', { class: 'chips' }, chips), imp ? h('span', { class: 'tag' }, '🕵️') : tag);
      }));
    // animate clues that just arrived
    const sig = r.n + ':' + r.order.map((id) => (r.clues[id] || []).length).join(',');
    if (G && sig !== seenClues && seenClues.split(':')[0] === String(r.n)) {
      const before = seenClues.split(':')[1].split(',').map(Number);
      r.order.forEach((id, i) => {
        if ((r.clues[id] || []).length > (before[i] || 0)) {
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
      else if (S.phase === 'role' || S.phase === 'clue') { placeholder = '🤫 Chat is off during clues'; disabled = true; }
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
    const mine = (S.phase === 'clue' && S.r && S.r.turn === me()) || (S.phase === 'guess' && S.r && S.r.out === me()) || (S.phase === 'vote' && seated() && !S.r.myVote);
    if (mine && s <= 5 && s > 0 && s !== lastTick) { lastTick = s; Sfx.play('tick'); }
  }, 200);

  // ------------------------------------------------------------ state + effects
  function onState(st) {
    S = st;
    const r = S.r;
    if (S.left != null) { deadline = performance.now() + S.left * 1000; total = S.total || S.left; } else deadline = 0;
    route();
    if (!r) { prev = { phase: S.phase, round: 0, turn: null }; return; }
    if (S.phase === 'role' && r.n !== prev.round) {
      roleHidden = false;
      Sfx.play('swoosh');
      if (FX.banner) FX.banner(`ROUND ${r.n}`, r.role === 'impostor' ? '🤫 You are the impostor…' : r.role === 'crew' ? '🔎 Find the impostor!' : '👀 Spectating', { color: r.role === 'impostor' ? '#f43f5e' : '#22d3ee', hold: 0.9 });
    }
    if (S.phase === 'clue' && r.turn === me() && prev.turn !== me()) { Sfx.play('go'); UI.toast('✍️ Your turn — give a clue!', 'good', 2000); }
    if (S.phase === 'discuss' && prev.phase !== 'discuss') Sfx.play('message');
    if (S.phase === 'vote' && prev.phase !== 'vote') Sfx.play('boing');
    if (S.phase === 'guess' && prev.phase !== 'guess') { Sfx.play('boom'); if (FX.list) FX.list($('#stage').querySelectorAll('.tchip'), { scale: 0.3, y: 0, stagger: 0.15, ease: 'back.out(2.5)' }); }
    if (S.phase === 'reveal' && prev.phase !== 'reveal' && !r.cancelled) {
      const crewWon = r.winner === 'crew';
      const iWon = r.role === 'impostor' ? !crewWon : r.role === 'crew' ? crewWon : false;
      Sfx.play(prev.phase === 'vote' ? 'boom' : 'swoosh');
      setTimeout(() => {
        if (FX.banner) FX.banner(crewWon ? '🎉 IMPOSTOR CAUGHT!' : '🕵️ IMPOSTOR WINS!', `The word was “${r.word}”`, { color: crewWon ? '#22d3ee' : '#f43f5e', hold: 1.5 });
        Sfx.play(iWon ? 'win' : r.role === 'spectator' ? 'pop' : 'lose');
        if (iWon) UI.confetti(160);
      }, 400);
      if (G) {
        FX.list($('#stage').querySelectorAll('.reveal-imps .who'), { scale: 0, y: 0, rotation: -20, stagger: 0.2, ease: 'elastic.out(1, 0.5)', duration: 1, delay: 0.6 });
        FX.list($('#stage').querySelectorAll('.tchip, .gains span'), { y: 14, scale: 0.6, stagger: 0.06, ease: 'back.out(2)', delay: 1 });
      }
    }
    if (S.phase !== prev.phase && G && S.phase !== 'reveal') FX.list($('#stage').children, { y: 12, stagger: 0.05, duration: 0.35 });
    prev = { phase: S.phase, round: r.n, turn: r.turn };
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'impostor',
    title: 'Impostor',
    emoji: '🕵️',
    tagline: 'Everyone knows the secret word… except the impostor. Give clues, find the faker, vote them out!',
    howTo: '<b>How to play</b><ul><li>Everyone gets the secret word — except one random <b>impostor</b>, who only sees the category.</li><li>Take turns giving <b>one clue</b> each in the chat. Don’t make it too obvious!</li><li>Discuss, then <b>vote</b> out who you think is faking it.</li><li>Caught impostors get one guess at the word to steal the win. 3–10 players.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  roomChat = Lobby.ChatBox($('#room-chat'));
  playChat = Lobby.ChatBox($('#play-chat'), { title: '💬 Game chat' });

  Lobby.on('joined', (m) => { roleKey = ''; seenClues = ''; stageKey = ''; onState(m.state); });
  Lobby.on('players', () => { if (!PLAYING.includes(S.phase)) renderLobby(); else renderPlay(); });
  Lobby.on('entry', () => { $('#room').classList.add('hidden'); $('#play').classList.add('hidden'); });
  Net.on('g:state', (m) => onState(m.state));
  Net.on('g:toast', (m) => { UI.toast(m.text, m.bad ? 'bad' : 'good', 3000); if (m.bad) Sfx.play('wrong'); });
  Net.on('g:final', (m) => {
    const top = m.ranking[0];
    if (top && top.id === me() && m.ranking.length > 1 && top.points > (m.ranking[1] ? m.ranking[1].points : 0)) { UI.confetti(220); Sfx.play('win'); }
  });
  void roomChat;
})();
