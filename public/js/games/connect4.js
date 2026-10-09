/* Connect 4 — two seats, everyone else watches. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI } = PA;
  const ROWS = 6;
  const COLS = 7;
  const COLORS = ['#f43f5e', '#facc15'];
  let S = { phase: 'waiting', seats: [null, null], board: [], turn: 0, winner: null, winCells: [], last: null, score: {} };
  let lastKey = '';

  const mySeat = () => S.seats.indexOf(Net.id);
  const myTurn = () => S.phase === 'playing' && S.seats[S.turn] === Net.id;
  const player = (id) => Room.player(id) || { name: 'Empty seat', avatar: '🪑', color: '#555' };

  function render() {
    // seats
    fill($('#versus'),
      seat(0), h('span', { class: 'vs' }, 'VS'), seat(1));
    // status
    let status = '';
    if (S.phase === 'waiting') status = '⏳ Waiting for a second player… share the code!';
    else if (S.phase === 'playing') status = myTurn() ? '👉 Your turn! Drop a disc' : `${player(S.seats[S.turn]).avatar} ${player(S.seats[S.turn]).name} is thinking…`;
    else if (S.winner === -1) status = '🤝 It’s a draw!';
    else if (S.winner != null) status = S.seats[S.winner] === Net.id ? '🏆 You win!' : `${player(S.seats[S.winner]).avatar} ${player(S.seats[S.winner]).name} wins!`;
    $('#status').textContent = status;
    if (mySeat() === -1 && S.phase !== 'waiting') $('#status').append(h('div', { class: 'small muted' }, '👀 You are spectating'));

    // board
    const key = S.last ? S.last.join(',') + ':' + S.board.flat().join('') : '';
    const animate = key && key !== lastKey;
    lastKey = key;
    const wins = new Set((S.winCells || []).map(([r, c]) => `${r},${c}`));
    const can = myTurn();
    fill($('#board'), Array.from({ length: COLS }, (_, c) => h('div', {
      class: 'c4col' + (can && S.board[0] && S.board[0][c] === 0 ? ' can' : ''),
      onclick: () => { if (myTurn() && S.board[0][c] === 0) { Net.send('g:drop', { col: c }); Sfx.play('click'); } },
    },
    h('div', { class: 'ghost', style: { background: COLORS[S.turn] } }),
    Array.from({ length: ROWS }, (_, r) => {
      const v = S.board[r] ? S.board[r][c] : 0;
      const isLast = S.last && S.last[0] === r && S.last[1] === c;
      return h('div', { class: 'cell' }, v ? h('div', {
        class: `pc p${v}` + (isLast && animate ? ' drop' : '') + (wins.has(`${r},${c}`) ? ' win' : ''),
        style: isLast && animate ? { '--from': `-${(r + 1) * 115}%`, '--dur': `${0.18 + r * 0.06}s` } : null,
      }) : null);
    }))));
    if (animate) setTimeout(() => Sfx.play('pop'), 180 + (S.last ? S.last[0] : 0) * 60);

    // after-game buttons
    const btns = [];
    if (S.phase === 'over' && mySeat() !== -1) btns.push(h('button', { class: 'btn btn-pink', onclick: () => Net.send('g:rematch') }, '🔁 Rematch'));
    if (S.phase === 'over' && Room.isHost && Room.players.filter((p) => p.online).length > 2) btns.push(h('button', { class: 'btn btn-ghost', onclick: () => Net.send('g:swap') }, '🔄 Swap in a spectator'));
    fill($('#after'), btns);
  }

  function seat(i) {
    const id = S.seats[i];
    const p = player(id);
    return h('div', { class: 'seat' + (S.phase === 'playing' && S.turn === i ? ' turn' : ''), style: { '--c': COLORS[i] } },
      h('span', { class: 'disc' }), UI.avatar(p), h('span', { class: 'nm' }, id ? p.name : 'Waiting…'), h('span', { class: 'sc' }, (id && S.score[id]) || 0));
  }

  Lobby.init({
    game: 'connect4',
    title: 'Connect 4',
    emoji: '🔴',
    tagline: 'Drop discs. Connect four. Brag forever.',
    howTo: '<b>How to play</b><ul><li>Take turns dropping discs into the columns.</li><li>First to line up 4 in a row — across, down or diagonal — wins!</li><li>Extra friends can join to watch and chat.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (S.seats.includes(p.id) ? h('span', { class: 'avatar sm', style: { '--c': COLORS[S.seats.indexOf(p.id)], width: '14px', height: '14px' } }) : h('span', { class: 'tiny faint' }, 'watching')) });
  Lobby.ChatBox($('#room-chat'));

  Lobby.on('joined', (m) => { S = m.state; $('#room').classList.remove('hidden'); render(); });
  Lobby.on('players', () => render());
  Lobby.on('entry', () => $('#room').classList.add('hidden'));
  Net.on('g:state', (m) => {
    const before = S.phase;
    S = m;
    render();
    Lobby.refreshPlayers();
    if (before !== 'over' && S.phase === 'over') {
      if (S.winner != null && S.seats[S.winner] === Net.id) { setTimeout(() => { UI.confetti(); Sfx.play('win'); }, 500); }
      else if (mySeat() !== -1 && S.winner !== -1) setTimeout(() => Sfx.play('lose'), 500);
    }
    if (before === 'waiting' && S.phase === 'playing') UI.toast('🎮 Game on!', 'good');
  });
})();
