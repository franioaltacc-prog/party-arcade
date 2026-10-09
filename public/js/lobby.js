/* Shared room flow for online games: entry screen, invite code, players, chat. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, Profile } = PA;

  const GAME_INFO = {
    dash: { title: 'Neon Dash', emoji: '🟪' },
    life: { title: 'Family Life', emoji: '🏡' },
    doodle: { title: 'Doodle Guess', emoji: '🎨' },
    blitz: { title: 'Party Blitz', emoji: '⚡' },
    connect4: { title: 'Connect 4', emoji: '🔴' },
    casino: { title: 'Casino Night', emoji: '🎰' },
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
    } }, input, h('button', { class: 'btn btn-cyan btn-sm', type: 'submit' }, 'Send'));
    fill(el, ...(title ? [h('div', { class: 'panel-title' }, title)] : []), h('div', { class: 'chat' }, log, form));
    const box = {
      input,
      clear() { fill(log, ); },
      add(m) {
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
        let row;
        if (m.sys) row = h('div', { class: 'chat-msg sys' }, m.text);
        else {
          const who = m.from || m;
          row = h('div', { class: 'chat-msg' + (m.good ? ' good' : '') + (m.secret ? ' secret' : '') },
            UI.avatar(who, 'sm'),
            h('div', { class: 'bubble' }, h('div', { class: 'who', style: { color: who.color } }, who.name, m.secret ? ' 🤫' : ''), m.text));
        }
        log.append(row);
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
            h('button', { class: 'btn btn-yellow btn-block', onclick: () => { UI.copy(Room.inviteLink(), 'Invite link copied! Send it to your friends 🚀'); Sfx.play('coin'); } }, '🔗 Copy invite link'),
            h('button', { class: 'btn btn-ghost btn-sm btn-block', onclick: leave }, '🚪 Leave room'),
          ),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Friends can also type the code on the Party Arcade home page.'),
        ),
      );
    };
    render();
    on('joined', render);
  }

  function renderPlayers(el, { extra, title = '👥 Players' } = {}) {
    const panel = { el, extra, title };
    playerPanels.add(panel);
    drawPlayers(panel);
    return () => drawPlayers(panel);
  }
  function drawPlayers(panel) {
    const list = h('div', { class: 'player-list' }, Room.players.map((p) => h('div', { class: 'player-row' + (p.id === Net.id ? ' me' : '') },
      UI.avatar(p),
      h('div', { class: 'grow' },
        h('div', { class: 'pname' }, p.name, p.id === Net.id ? h('span', { class: 'faint small' }, ' (you)') : null),
        !p.online ? h('div', { class: 'tiny faint' }, 'reconnecting…') : null),
      h('div', { class: 'pmeta' }, panel.extra ? panel.extra(p) : null, p.id === Room.host ? h('span', { title: 'Host' }, '👑') : null),
    )));
    fill(panel.el, h('div', { class: 'panel-title' }, panel.title, h('span', { class: 'count' }, `${Room.players.filter((p) => p.online).length} online`)), list);
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

  function init(o) {
    opts = { ...GAME_INFO[o.game], ...o };
    UI.topbar({ title: opts.title, emoji: opts.emoji });
    buildEntry();

    Net.on('room:joined', (m) => {
      if (m.game !== opts.game) { location.href = `/games/${m.game}?room=${m.code}`; return; }
      const fresh = Room.code !== m.code;
      Object.assign(Room, { code: m.code, game: m.game, host: m.host, players: m.players });
      autoJoining = false;
      setUrlRoom(m.code);
      hideEntry();
      if (fresh) { chatBoxes.forEach((b) => b.clear()); Sfx.play('coin'); }
      refreshPlayers();
      emit('joined', m);
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
