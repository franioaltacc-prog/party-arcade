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
  };

  const Room = {
    code: null,
    game: null,
    host: null,
    players: [],
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
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Friends can also type the code on the Party Arcade home page.'),
        ),
      );
    };
    render();
    on('joined', () => {
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
    const list = h('div', { class: 'player-list' }, Room.players.map((p) => h('div', {
      class: 'player-row' + (p.id === Net.id ? ' me' : '') + (p.acct ? ' clickable' : ''), 'data-pid': p.id,
      title: p.acct ? `See ${p.acct}'s profile` : 'Guest player',
      onclick: p.acct ? (e) => { if (!e.target.closest('button')) UI.profileCard(p.acct); } : null,
    },
      UI.avatar(p),
      h('div', { class: 'grow' },
        h('div', { class: 'pname' }, p.name, UI.badges(p), p.id === Net.id ? h('span', { class: 'faint small' }, ' (you)') : null),
        !p.online ? h('div', { class: 'tiny faint' }, 'reconnecting…') : null),
      h('div', { class: 'pmeta' }, panel.extra ? panel.extra(p) : null, p.id === Room.host ? h('span', { title: 'Host' }, '👑') : null),
    )));
    fill(panel.el, h('div', { class: 'panel-title' }, panel.title, h('span', { class: 'count' }, `${Room.players.filter((p) => p.online).length} online`)), list);
    for (const row of list.children) if (!seen.has(row.dataset.pid)) { seen.add(row.dataset.pid); fresh.push(row); }
    if (G && fresh.length) G.from(fresh, { x: 40, scale: 0.8, autoAlpha: 0, stagger: 0.08, duration: 0.55, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
  }
  function refreshPlayers() { playerPanels.forEach(drawPlayers); }

  // ------------------------------------------------------------ actions
  function leave() {
    Net.send('room:leave');
    Room.code = null;
    setUrlRoom(null);
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
      const fresh = Room.code !== m.code;
      Object.assign(Room, { code: m.code, game: m.game, host: m.host, players: m.players });
      autoJoining = false;
      setUrlRoom(m.code);
      hideEntry();
      if (fresh) { chatBoxes.forEach((b) => b.clear()); playerPanels.forEach((pp) => pp.seen && pp.seen.clear()); Sfx.play('coin'); }
      refreshPlayers();
      emit('joined', m);
      if (fresh && G) requestAnimationFrame(() => FX.list(document.querySelectorAll('#room > *:not(.hidden)'), { y: 40, scale: 0.96, stagger: 0.09, duration: 0.6, ease: 'back.out(1.4)' }));
    });
    Net.on('room:players', (m) => {
      const wasHost = Room.isHost;
      Room.host = m.host;
      Room.players = m.players;
      refreshPlayers();
      emit('players', m);
      if (!wasHost && Room.isHost) UI.toast('👑 You are the host now!', 'good');
    });
    Net.on('room:kicked', (m) => { UI.toast(m.reason || 'Disconnected from room', 'bad'); Room.code = null; setUrlRoom(null); emit('left'); showEntry(); });
    Net.on('chat', (m) => { chatBoxes.forEach((b) => b.add(m)); if (m.from && m.from.id !== Net.id) Sfx.play('message'); });
    Net.on('error', (m) => {
      if (m.code === 'wronggame' && m.game) { location.href = `/games/${m.game}?room=${m.room}`; return; }
      UI.toast(m.msg || 'Something went wrong', 'bad');
      if (m.code === 'noroom' && autoJoining) { autoJoining = false; setUrlRoom(null); showEntry(); }
    });
    Net.on('reconnect', () => { if (Room.code) Net.send('room:join', { code: Room.code, game: opts.game }); });

    const code = new URLSearchParams(location.search).get('room');
    if (code) {
      autoJoining = true;
      hideEntry();
      Profile.ensure().then(() => Net.send('room:join', { code: code.toUpperCase(), game: opts.game }));
    } else {
      showEntry();
    }
    Net.connect();
  }

  window.Lobby = { init, on, Room, ChatBox, renderCode, renderPlayers, refreshPlayers, leave, showEntry, hideEntry, GAME_INFO };
  window.Room = Room;
})();
