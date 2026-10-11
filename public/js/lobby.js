/* Shared room flow for online games: entry screen, invite code, players, chat. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, Profile, Account, icon } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  const GAME_INFO = {
    dash: { title: 'Neon Dash', emoji: '🟪' },
    life: { title: 'Family Life', emoji: '🏡' },
    doodle: { title: 'Doodle Guess', emoji: '🎨' },
    blitz: { title: 'Party Blitz', emoji: '⚡' },
    connect4: { title: 'Connect 4', emoji: '🔴' },
    casino: { title: 'Casino Night', emoji: '🎰' },
    impostor: { title: 'Impostor', emoji: '🕵️' },
    mines: { title: 'Minesweeper', emoji: '💣' },
    front: { title: 'Front Wars', emoji: '🌍' },
  };

  const Room = {
    code: null,
    game: null,
    host: null,
    players: [],
    party: null,     // party mode: { list, i, done, next, nextIn, board, last }
    vote: null,      // "play again?" / "pick a game" vote in progress
    get watching() { const p = this.player(Net.id); return !!(p && p.watch); },
    get me() { return Net.id; },
    get isHost() { return this.host === Net.id; },
    player(id) { return this.players.find((p) => p.id === id); },
    inviteLink() { return `${location.origin}/games/${this.game}?room=${this.code}`; },
  };

  const listeners = {};
  const emit = (t, d) => (listeners[t] || []).forEach((fn) => fn(d));
  const chatBoxes = new Set();
  const playerPanels = new Set();
  let opts = {};
  let autoJoining = false;
  let rejoining = false;   // asked to get back into our room after the connection dropped

  function setUrlRoom(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }

  // ------------------------------------------------------------ chat box
  function ChatBox(el, { placeholder = 'Say something…', onSend, title = '💬 Chat', room = true } = {}) {
    const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    const input = h('input', { class: 'input', maxlength: 200, placeholder, autocomplete: 'off' });
    const form = h('form', { class: 'chat-form', onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      if (onSend) onSend(text); else Net.send('chat', { text });
    } }, input, h('button', { class: 'btn btn-cyan btn-sm', type: 'submit', title: 'Send', 'aria-label': 'Send' }, icon('paper-plane-tilt')));
    fill(el, ...(title ? [h('div', { class: 'panel-title' }, title)] : []), h('div', { class: 'chat' }, log, form));
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const box = {
      input,
      clear() { fill(log, ); },
      add(m) {
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
        let row;
        if (!m.placeholder) log.querySelectorAll('.placeholder').forEach((x) => x.remove());
        if (m.sys) row = h('div', { class: 'chat-msg sys' + (m.placeholder ? ' placeholder' : '') }, m.text);
        else {
          const who = m.from || m;
          row = h('div', { class: 'chat-msg' + (m.good ? ' good' : '') + (m.secret ? ' secret' : '') + (m.spec ? ' spec' : '') + (m.clue ? ' clue' : '') },
            UI.avatar(who, 'sm'),
            h('div', { class: 'bubble' }, h('div', { class: 'who', style: { color: who.color } }, who.name, m.secret ? ' 🤫' : '', m.spec ? ' 👀 spectator' : '', m.clue ? ' 🗝️ clue' : ''), m.text));
        }
        log.append(row);
        if (G && !m.placeholder) G.from(row, { x: -18, scale: 0.92, autoAlpha: 0, transformOrigin: '0% 50%', duration: 0.35, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
        while (log.children.length > 150) log.firstChild.remove();
        if (atBottom || (m.from && m.from.id === Net.id)) log.scrollTop = log.scrollHeight;
      },
    };
    if (room) chatBoxes.add(box);
    return box;
  }

  // ------------------------------------------------------------ panels
  function renderCode(el) {
    const render = () => {
      fill(el, 
        h('div', { class: 'panel-title' }, '🔑 Room code'),
        h('div', { class: 'code-card' },
          h('div', { class: 'code', title: 'Room code' }, Room.code || '----'),
          h('div', { class: 'col' },
            h('button', { class: 'btn btn-yellow btn-block', onclick: () => { UI.copy(Room.inviteLink(), 'Invite link copied! Send it to your friends 🚀'); Sfx.play('coin'); } }, icon('link'), 'Copy invite link'),
            h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: leave }, icon('door-open'), 'Leave room'),
          ),
          roomTools(),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Friends can also type the code on the Party Arcade home page.'),
        ),
      );
    };
    render();
    let toolsKey = '';
    const again = () => {   // redraw when host / watching / party changes
      const key = [Room.isHost, Room.watching, !!(Room.party && !Room.party.done)].join();
      if (key !== toolsKey) { toolsKey = key; render(); }
    };
    on('players', again);
    on('party', again);
    on('joined', () => {
      toolsKey = '';
      render();
      const code = el.querySelector('.code');
      if (G && code) G.fromTo(code, { rotationX: -100, scale: 0.4, autoAlpha: 0, transformPerspective: 600 }, { rotationX: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: 'elastic.out(1, 0.55)', delay: 0.2, clearProps: 'transform' });
    });
  }

  function renderPlayers(el, { extra, title = '👥 Players' } = {}) {
    const panel = { el, extra, title };
    playerPanels.add(panel);
    drawPlayers(panel);
    return () => drawPlayers(panel);
  }
  function drawPlayers(panel) {
    const fresh = [];
    const seen = panel.seen || (panel.seen = new Set());
    const sorted = [...Room.players].sort((a, b) => (a.watch ? 1 : 0) - (b.watch ? 1 : 0));
    const list = h('div', { class: 'player-list' }, sorted.map((p) => h('div', {
      class: 'player-row' + (p.id === Net.id ? ' me' : '') + (p.acct ? ' clickable' : '') + (p.watch ? ' watcher' : ''), 'data-pid': p.id,
      title: p.acct ? `See ${p.acct}'s profile` : 'Guest player',
      onclick: p.acct ? (e) => { if (!e.target.closest('button')) UI.profileCard(p.acct); } : null,
    },
      UI.avatar(p),
      h('div', { class: 'grow' },
        h('div', { class: 'pname' }, p.name, UI.badges(p), p.id === Net.id ? h('span', { class: 'faint small' }, ' (you)') : null),
        !p.online ? h('div', { class: 'tiny faint' }, 'reconnecting…') : p.watch ? h('div', { class: 'tiny faint' }, 'just watching') : null),
      h('div', { class: 'pmeta' }, panel.extra ? panel.extra(p) : null, p.watch ? h('span', { title: 'Watching' }, '👀') : null, p.id === Room.host ? h('span', { title: 'Host' }, '👑') : null),
    )));
    const watchers = Room.players.filter((p) => p.online && p.watch).length;
    fill(panel.el, h('div', { class: 'panel-title' }, panel.title, h('span', { class: 'count' }, `${Room.players.filter((p) => p.online && !p.watch).length} online${watchers ? ` · 👀 ${watchers}` : ''}`)), list);
    for (const row of list.children) if (!seen.has(row.dataset.pid)) { seen.add(row.dataset.pid); fresh.push(row); }
    if (G && fresh.length) G.from(fresh, { x: 40, scale: 0.8, autoAlpha: 0, stagger: 0.08, duration: 0.55, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
  }
  function refreshPlayers() { playerPanels.forEach(drawPlayers); }

  // ------------------------------------------------------------ watching, votes, party mode
  const PARTY_GAMES = ['dash', 'doodle', 'blitz', 'impostor', 'mines', 'front', 'casino', 'life'];
  const SWITCH_GAMES = [...PARTY_GAMES, 'connect4'];
  const PARTY_POINTS = [10, 7, 5, 3];
  const gTitle = (g) => (GAME_INFO[g] || {}).title || g;
  const gEmoji = (g) => (GAME_INFO[g] || {}).emoji || '🎮';
  const wantWatch = new URLSearchParams(location.search).get('watch') === '1';

  function setUrlWatch(on) {
    const url = new URL(location.href);
    if (on) url.searchParams.set('watch', '1'); else url.searchParams.delete('watch');
    history.replaceState(null, '', url);
  }
  function setWatch(want) {
    Net.send('room:watch', { watch: want });
    setUrlWatch(want);
    Sfx.play('pop');
  }

  /** Buttons under the room code: watch / join in, and the host's party mode and switch game. */
  function roomTools() {
    const partyOn = Room.party && !Room.party.done;
    return h('div', { class: 'room-tools' },
      Room.isHost ? h('div', { class: 'rt-row' },
        partyOn
          ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { if (confirm('End party mode for everyone?')) Net.send('party:stop'); } }, '🛑 End party')
          : h('button', { class: 'btn btn-pink btn-sm', title: 'Play a playlist of games — points carry over', onclick: partyPicker }, '🎉 Party mode'),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Move everyone to another game', onclick: switchPicker }, '🔀 Switch game')) : null,
      Room.code ? (Room.watching
        ? h('button', { class: 'btn btn-lime btn-sm btn-block', onclick: () => setWatch(false) }, '✋ Join in (you’re watching)')
        : h('button', { class: 'btn btn-ghost btn-sm btn-block', title: 'Sit out and just watch', onclick: () => setWatch(true) }, '👀 Just watch')) : null);
  }

  function gameTile(g, extra = {}) {
    return h('button', { type: 'button', class: 'game-tile' + (extra.on ? ' on' : ''), onclick: extra.onClick, disabled: !!extra.disabled, title: gTitle(g) },
      h('span', { class: 'gt-emoji' }, gEmoji(g)), h('span', { class: 'gt-title' }, gTitle(g)),
      extra.badge != null ? h('span', { class: 'gt-badge' }, extra.badge) : null);
  }

  function partyPicker() {
    const chosen = [];
    const list = h('div', { class: 'pp-list' });
    const startBtn = h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => { Net.send('party:start', { games: chosen }); close(); Sfx.play('win'); } }, '🎉 Start the party');
    const grid = h('div', { class: 'game-grid' }, PARTY_GAMES.map((g) => gameTile(g, { onClick: () => { if (chosen.length < 8) { chosen.push(g); Sfx.play('pop'); draw(); } } })));
    const presets = [
      ['⚡ Quick party', ['blitz', 'doodle', 'dash']],
      ['🌍 Big night', ['doodle', 'blitz', 'front', 'mines', 'casino']],
      ['🧠 Brainy', ['blitz', 'impostor', 'mines']],
    ];
    const draw = () => {
      fill(list, chosen.length
        ? chosen.map((g, i) => h('span', { class: 'pp-chip' }, h('b', {}, i + 1), ` ${gEmoji(g)} ${gTitle(g)} `,
          h('button', { type: 'button', 'aria-label': `Remove ${gTitle(g)}`, onclick: () => { chosen.splice(i, 1); draw(); } }, '×')))
        : h('span', { class: 'muted small' }, 'Tap games below to add them in order (2 to 8).'));
      startBtn.disabled = chosen.length < 2;
    };
    draw();
    const close = UI.modal(h('div', { class: 'party-picker' },
      h('h2', {}, '🎉 Party mode'),
      h('p', { class: 'muted small' }, `Make a playlist. After each game, places turn into party points (1st ${PARTY_POINTS[0]}, 2nd ${PARTY_POINTS[1]}, 3rd ${PARTY_POINTS[2]}, 4th ${PARTY_POINTS[3]}, everyone else 1) and everyone moves to the next game together.`),
      h('div', { class: 'pp-presets' }, presets.map(([label, games]) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { chosen.splice(0, chosen.length, ...games); draw(); } }, label))),
      list, grid, startBtn), { wide: true });
  }

  function switchPicker() {
    const close = UI.modal(h('div', {},
      h('h2', {}, '🔀 Switch game'),
      h('p', { class: 'muted small' }, 'Everyone in the room moves to the new game together, with the same room code.'),
      h('div', { class: 'game-grid' }, SWITCH_GAMES.filter((g) => g !== Room.game).map((g) => gameTile(g, {
        onClick: () => { Net.send('room:switch', { game: g }); close(); } })))), { wide: true });
  }

  // the dock (bottom right): vote card and party standings
  let dock = null;
  function getDock() {
    if (!dock) { dock = h('div', { class: 'room-dock' }); document.body.append(dock); }
    return dock;
  }

  // watchers get a little chip so they can always join in, even when the room panel is hidden mid-game
  let watchEl = null;
  function drawWatchChip() {
    const show = !!Room.code && Room.watching;
    if (show && !watchEl) {
      watchEl = h('div', { class: 'watch-chip', role: 'status' }, h('span', {}, '👀 You’re watching'),
        h('button', { class: 'btn btn-lime btn-sm', onclick: () => setWatch(false) }, '✋ Join in'));
      getDock().append(watchEl);
      if (G) G.from(watchEl, { y: 30, autoAlpha: 0, duration: 0.4, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
    } else if (!show && watchEl) { watchEl.remove(); watchEl = null; }
  }

  let voteEl = null;
  let voteTick = null;
  let myVote = null;
  let voteKind = null;
  let voteSmall = false;
  function showVote(v) {
    Room.vote = v;
    clearInterval(voteTick);
    if (!v) { if (voteEl) { voteEl.remove(); voteEl = null; } myVote = null; voteKind = null; return; }
    if (v.kind !== voteKind) { myVote = null; voteSmall = false; voteKind = v.kind; }
    const fresh = !voteEl;
    if (fresh) { voteEl = h('div', { class: 'room-vote', role: 'dialog', 'aria-label': 'Vote on what to play next' }); getDock().prepend(voteEl); }
    const ends = Date.now() + v.left * 1000;
    const total = v.kind === 'pick' ? 20 : 20;
    const timeEl = h('span', { class: 'rv-time' });
    const bar = h('i');
    const tick = () => {
      const left = Math.max(0, (ends - Date.now()) / 1000);
      timeEl.textContent = Math.ceil(left) + 's';
      bar.style.width = Math.min(100, (left / total) * 100) + '%';
    };
    const voted = Object.values(v.counts || {}).reduce((a, b) => a + b, 0);
    const can = !Room.watching;
    const cast = (choice) => { if (!can) return; myVote = choice; Sfx.play('pop'); Net.send('room:vote', { choice }); showVote(Room.vote); };
    if (voteSmall) {
      fill(voteEl, h('button', { class: 'rv-pill', onclick: () => { voteSmall = false; showVote(Room.vote); } }, '🗳️ ', v.kind === 'next' ? 'What next?' : 'Pick a game', ' · ', timeEl));
    } else {
      const head = h('div', { class: 'rv-head' },
        h('b', {}, v.kind === 'next' ? '🎉 What next?' : '🎮 Pick the next game'), timeEl,
        h('button', { class: 'icon-btn', title: 'Hide', 'aria-label': 'Hide the vote', onclick: () => { voteSmall = true; showVote(Room.vote); } }, '–'));
      const n = (c) => (v.counts || {})[c] || 0;
      const body = v.kind === 'next'
        ? h('div', { class: 'rv-two' },
          h('button', { class: 'btn btn-lime' + (myVote === 'again' ? ' picked' : ''), disabled: !can, onclick: () => cast('again') }, '🔁 Play again', h('span', { class: 'rv-n' }, n('again'))),
          h('button', { class: 'btn btn-cyan' + (myVote === 'new' ? ' picked' : ''), disabled: !can, onclick: () => cast('new') }, '🎮 New game', h('span', { class: 'rv-n' }, n('new'))))
        : h('div', { class: 'game-grid small' }, (v.options || []).map((g) => gameTile(g, { on: myVote === g, disabled: !can, badge: n(g) || null, onClick: () => cast(g) })));
      fill(voteEl, head, h('div', { class: 'rv-bar' }, bar), body,
        h('div', { class: 'tiny muted rv-foot' }, can
          ? `${voted}/${v.voters} voted${Room.isHost && v.kind === 'next' ? ' · or just press start' : ''}`
          : `👀 You’re watching — players are voting (${voted}/${v.voters})`));
    }
    tick();
    voteTick = setInterval(tick, 250);
    if (fresh) { Sfx.play('boing'); if (G) G.from(voteEl, { y: 40, scale: 0.9, autoAlpha: 0, duration: 0.45, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' }); }
  }

  let partyEl = null;
  let partyTick = null;
  let podiumShown = null;
  function partyBoard(p, rows = 99) {
    const gained = (p.last && p.last.gained) || {};
    return h('div', { class: 'pb-board' }, p.board.slice(0, rows).map((r, i) => h('div', { class: 'pb-row' + (r.id === Net.id ? ' me' : '') },
      h('span', { class: 'pb-place' }, ['🥇', '🥈', '🥉'][i] || `#${i + 1}`), h('span', { class: 'pb-name' }, r.name),
      gained[r.id] ? h('span', { class: 'pb-gain' }, `+${gained[r.id]}`) : null,
      h('b', { class: 'pb-pts' }, r.points))));
  }
  function partyModal() {
    const p = Room.party;
    if (!p) return;
    UI.modal(h('div', { class: 'party-standings' },
      h('h2', {}, p.done ? '🏆 Party results' : '🎉 Party standings'),
      h('div', { class: 'pp-list' }, p.list.map((g, i) => h('span', { class: 'pp-chip' + (i === p.i ? ' now' : i < p.i || p.done ? ' done' : '') }, h('b', {}, i + 1), ` ${gEmoji(g)} ${gTitle(g)}`))),
      p.board.length ? partyBoard(p) : h('p', { class: 'muted' }, 'No points yet — finish a game to score!'),
      Room.isHost && !p.done ? h('button', { class: 'btn btn-ghost btn-sm', style: { marginTop: '12px' }, onclick: () => { if (confirm('End party mode for everyone?')) Net.send('party:stop'); } }, '🛑 End the party') : null));
  }
  function podium(p) {
    const top = p.board.slice(0, 3);
    const order = [1, 0, 2].filter((i) => top[i]);
    UI.modal(h('div', { class: 'party-podium' },
      h('h2', {}, '🏆 Party champion!'),
      h('div', { class: 'podium' }, order.map((i) => h('div', { class: `pod pod-${i + 1}` },
        h('div', { class: 'pod-name' }, top[i].name), h('div', { class: 'pod-pts' }, `${top[i].points} pts`),
        h('div', { class: 'pod-step' }, ['🥇', '🥈', '🥉'][i])))),
      p.board.length > 3 ? partyBoard({ ...p, board: p.board }, 12) : null,
      h('p', { class: 'muted small', style: { marginTop: '10px' } }, `${p.list.length} games · ${p.list.map(gTitle).join(' → ')}`),
      Room.isHost ? h('button', { class: 'btn btn-pink btn-block', style: { marginTop: '10px' }, onclick: partyPicker }, '🎉 Start another party') : null), { wide: false });
    UI.confetti(220);
    Sfx.play('win');
  }
  function showParty(p, fromJoin) {
    const was = Room.party;
    Room.party = p;
    clearInterval(partyTick);
    emit('party', p);
    if (!p) { if (partyEl) { partyEl.remove(); partyEl = null; } return; }
    if (!partyEl) { partyEl = h('div', { class: 'party-card' }); getDock().append(partyEl); }
    const me = p.board.find((r) => r.id === Net.id);
    const leader = p.board[0];
    const head = h('button', { class: 'pc-head', title: 'Party standings', onclick: () => (p.done ? podium(p) : partyModal()) },
      h('span', {}, p.done ? '🏁 Party over' : `🎉 Party · game ${p.i + 1}/${p.list.length}`),
      h('span', { class: 'pc-sub' }, leader && leader.points ? `🥇 ${leader.name} ${leader.points}` : `${gEmoji(p.list[p.i])} ${gTitle(p.list[p.i])}`, me && me.points ? ` · you ${me.points}` : ''));
    if (p.next) {
      const left = h('b', {});
      const ends = Date.now() + (p.nextIn || 0) * 1000;
      const tick = () => { left.textContent = Math.max(0, Math.ceil((ends - Date.now()) / 1000)) + 's'; };
      fill(partyEl, head, h('div', { class: 'pc-next' }, `Next up: ${gEmoji(p.next)} ${gTitle(p.next)} in `, left), partyBoard(p, 5));
      tick();
      partyTick = setInterval(tick, 250);
      partyEl.classList.add('big');
    } else {
      fill(partyEl, head);
      partyEl.classList.remove('big');
    }
    if (G && !was) G.from(partyEl, { y: 30, autoAlpha: 0, duration: 0.45, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
    const key = p.list.join() + p.board.map((r) => r.points).join();
    if (p.done && !fromJoin && was && !was.done && podiumShown !== key) { podiumShown = key; podium(p); }
  }

  // ------------------------------------------------------------ actions
  function leave() {
    Net.send('room:leave');
    Room.code = null;
    setUrlRoom(null);
    setUrlWatch(false);
    showVote(null);
    showParty(null);
    drawWatchChip();
    chatBoxes.forEach((b) => b.clear());
    emit('left');
    showEntry();
  }

  async function create() { await Profile.ensure(); Sfx.play('pop'); Net.send('room:create', { game: opts.game }); }
  async function quick() { await Profile.ensure(); Sfx.play('pop'); Net.send('room:quick', { game: opts.game }); }
  async function join(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length < 4) { UI.toast('Room codes have 4 letters 🔑', 'bad'); return; }
    await Profile.ensure();
    Net.send('room:join', { code, game: opts.game });
  }

  function showEntry() {
    const entry = $('#entry');
    if (entry) entry.classList.remove('hidden');
    if (FX.entry && entry) FX.entry(entry.querySelector('.entry'));
    emit('entry');
  }
  function hideEntry() { const entry = $('#entry'); if (entry) entry.classList.add('hidden'); }

  function buildEntry() {
    const el = $('#entry');
    if (!el) return;
    const codeInput = h('input', { class: 'input code', maxlength: 4, placeholder: 'CODE', 'aria-label': 'Room code', autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') join(codeInput.value); } });
    fill(el, h('section', { class: 'entry pop' },
      h('div', { class: 'game-icon' }, opts.emoji),
      h('h1', {}, opts.title),
      h('p', { class: 'tagline' }, opts.tagline),
      h('div', { class: 'actions' },
        opts.solo ? h('button', { class: 'btn btn-cyan btn-lg btn-block', onclick: opts.solo.onClick }, opts.solo.label) : null,
        h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: create }, '✨ Create a room'),
        h('button', { class: 'btn btn-lime btn-block', onclick: quick }, '⚡ Quick play (join any open room)'),
        h('div', { class: 'divider' }, 'or join friends'),
        h('div', { class: 'join-row' }, codeInput, h('button', { class: 'btn btn-yellow', onclick: () => join(codeInput.value) }, 'Join →')),
      ),
      opts.howTo ? h('div', { class: 'how-to', html: opts.howTo }) : null,
    ));
  }

  function on(t, fn) { (listeners[t] ||= []).push(fn); }

  // ------------------------------------------------------------ admin cheats
  // Only shown to admins. The server checks admin rights again for every cheat,
  // and a game where a cheat was used doesn't count for leaderboards.
  const CHEATS = {
    casino: [['coins', '🪙 +10,000 coins'], ['rich', '💎 +1,000,000 coins'], ['broke', '💸 Go broke'], ['end', '🏁 End the match']],
    life: [['money', '💰 +$100,000'], ['stats', '💪 Max my stats'], ['energy', '⚡ Refill my energy'], ['clean', '😇 Clear heat & jail'],
      ['event', '🎲 Give me an event'], ['skip', '⏩ Skip time (no vote)']],
    blitz: [['points', '💯 +500 points'], ['skip', '⏭️ Skip this round'], ['end', '🏁 End the game']],
    doodle: [['word', '🤫 Show me the word'], ['points', '💯 +500 points'], ['skip', '⏭️ Skip this turn'], ['end', '🏁 End the game']],
    connect4: [['win', '🏆 Win this game'], ['undo', '↩️ Undo last move'], ['reset', '🔄 New board']],
    dash: [['god', '😇 God mode (no deaths)', true], ['skip', '⏩ Teleport to the finish', true]],
    impostor: [['reveal', '🔎 Show impostor & word'], ['skip', '⏭️ Skip this phase'], ['end', '🏁 End the game']],
    mines: [['mines', '💣 X-ray: see all mines'], ['clear', '🧹 Clear the board for me'], ['end', '🏁 End the game']],
    front: [['troops', '💪 +50,000 troops', true], ['gold', '💰 +100,000 gold', true], ['end', '🏁 End the game']],
  };
  let adminFab = null;
  let adminPanel = null;
  function closeAdminPanel() { if (adminPanel) { adminPanel.remove(); adminPanel = null; } }
  async function runCheat(action, local) {
    try {
      if (Room.code || !local) {
        const r = await Net.request('admin:cheat', { action });
        UI.toast(r.text, 'good', action === 'word' ? 6000 : 2500);
      } else UI.toast('🛠️ Cheat on (practice mode)', 'good');
      Sfx.play('coin');
      PA.emit('admin:cheat', { action });
    } catch (e) { UI.toast(e.message, 'bad'); }
  }
  function toggleAdminPanel() {
    if (adminPanel) { closeAdminPanel(); return; }
    const list = CHEATS[opts.game] || [];
    adminPanel = h('div', { class: 'admin-panel', role: 'dialog', 'aria-label': 'Admin cheats' },
      h('div', { class: 'ap-head' }, h('b', {}, '🛡️ Admin cheats'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeAdminPanel }, icon('x'))),
      h('p', { class: 'tiny muted' }, 'Games where you cheat don’t count for leaderboards.'),
      list.map(([action, label, local]) => h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: () => runCheat(action, local) }, label)),
      h('a', { class: 'btn btn-ghost btn-sm btn-block', href: '/admin' }, '🛡️ Open admin panel'));
    document.body.append(adminPanel);
    const f = PA.FX;
    if (f && f.on) f.list(adminPanel.children, { y: 10, stagger: 0.03, duration: 0.25 });
  }
  function syncAdmin() {
    const show = Account.admin && CHEATS[opts.game];
    if (show && !adminFab) {
      adminFab = h('button', { class: 'admin-fab', title: 'Admin cheats', 'aria-label': 'Admin cheats', onclick: toggleAdminPanel }, icon('shield-star'));
      document.body.append(adminFab);
    } else if (!show && adminFab) {
      adminFab.remove(); adminFab = null; closeAdminPanel();
    }
  }

  function init(o) {
    opts = { ...GAME_INFO[o.game], ...o };
    UI.topbar({ title: opts.title, emoji: opts.emoji });
    buildEntry();
    syncAdmin();
    PA.on('account', syncAdmin);

    Net.on('room:joined', (m) => {
      if (m.game !== opts.game) { location.href = `/games/${m.game}?room=${m.code}`; return; }
      showVote(m.vote || null);
      showParty(m.party || null, true);
      const fresh = Room.code !== m.code;
      Object.assign(Room, { code: m.code, game: m.game, host: m.host, players: m.players });
      autoJoining = false;
      rejoining = false;
      setUrlRoom(m.code);
      hideEntry();
      if (fresh) { chatBoxes.forEach((b) => b.clear()); playerPanels.forEach((pp) => pp.seen && pp.seen.clear()); Sfx.play('coin'); }
      refreshPlayers();
      drawWatchChip();
      emit('joined', m);
      if (fresh && G) requestAnimationFrame(() => FX.list(document.querySelectorAll('#room > *:not(.hidden)'), { y: 40, scale: 0.96, stagger: 0.09, duration: 0.6, ease: 'back.out(1.4)' }));
    });
    Net.on('room:players', (m) => {
      const wasHost = Room.isHost;
      Room.host = m.host;
      Room.players = m.players;
      refreshPlayers();
      drawWatchChip();
      emit('players', m);
      if (!wasHost && Room.isHost) UI.toast('👑 You are the host now!', 'good');
    });
    Net.on('room:kicked', (m) => { UI.toast(m.reason || 'Disconnected from room', 'bad'); Room.code = null; setUrlRoom(null); showVote(null); showParty(null); drawWatchChip(); emit('left'); showEntry(); });
    Net.on('room:vote', (m) => showVote(m.vote));
    Net.on('party:state', (m) => showParty(m.party));
    Net.on('room:goto', (m) => {
      if (m.code !== Room.code) return;
      UI.toast(`${gEmoji(m.game)} Off to ${gTitle(m.game)}!`, 'good', 2000);
      Sfx.play('coin');
      const url = `/games/${m.game}?room=${m.code}`;
      if (FX.on && G) G.to('main, #room', { autoAlpha: 0, scale: 0.97, duration: 0.35, onComplete: () => { location.href = url; } });
      else location.href = url;
      setTimeout(() => { location.href = url; }, 900);
    });
    Net.on('chat', (m) => { chatBoxes.forEach((b) => b.add(m)); if (m.from && m.from.id !== Net.id) Sfx.play('message'); });
    Net.on('error', (m) => {
      if (m.code === 'wronggame' && m.game) { location.href = `/games/${m.game}?room=${m.room}${wantWatch ? '&watch=1' : ''}`; return; }
      UI.toast(m.msg || 'Something went wrong', 'bad');
      if (m.code === 'noroom' && autoJoining) { autoJoining = false; setUrlRoom(null); showEntry(); }
      else if (m.code === 'noroom' && rejoining) { rejoining = false; Room.code = null; setUrlRoom(null); emit('left'); showEntry(); }
    });
    Net.on('reconnect', () => { if (Room.code) { rejoining = true; Net.send('room:join', { code: Room.code, game: opts.game }); } });

    const code = new URLSearchParams(location.search).get('room');
    if (code) {
      autoJoining = true;
      hideEntry();
      Profile.ensure().then(() => Net.send('room:join', { code: code.toUpperCase(), game: opts.game, watch: wantWatch }));
    } else {
      showEntry();
    }
    Net.connect();
  }

  window.Lobby = { init, on, Room, ChatBox, renderCode, renderPlayers, refreshPlayers, leave, showEntry, hideEntry, GAME_INFO };
  window.Room = Room;
})();
