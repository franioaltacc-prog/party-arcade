/* Leaderboards page: pick a board, see the top 50 and your own rank. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, store, on } = PA;
  const FX = PA.FX || {};
  const GROUPS = [
    ['General', ['xp', 'wins', 'games']],
    ['Online games', ['dash', 'life', 'life_age', 'doodle', 'blitz', 'casino', 'casino_big', 'c4', 'impostor', 'impostor_rounds', 'mines']],
    ['Solo', ['snake', '2048', 'memory', 'dash_solo', 'mines_medium', 'mines_hard']],
  ];
  let boards = [];
  let current = new URLSearchParams(location.search).get('b') || store.get('lb_board', 'xp');

  UI.topbar({ title: 'Leaderboards', emoji: '🏆' });

  const profileUrl = (name) => '/profile?u=' + encodeURIComponent(name);
  function fmtValue(v, f) {
    const n = Number(v) || 0;
    if (f === 'xp') return `${n.toLocaleString('en-US')} XP`;
    if (f === 'coins') return `🪙 ${n.toLocaleString('en-US')}`;
    if (f === 'time') return `${(n / 1000).toFixed(2)}s`;
    if (f === 'years') return `${n} years`;
    return n.toLocaleString('en-US');
  }

  function renderTabs() {
    const byKey = Object.fromEntries(boards.map((b) => [b.key, b]));
    fill($('#tabs'), GROUPS.map(([label, keys]) => h('div', { class: 'lb-group' },
      h('span', { class: 'lb-glabel' }, label),
      keys.filter((k) => byKey[k]).map((k) => h('button', { class: 'lb-tab' + (k === current ? ' on' : ''), onclick: () => select(k) }, byKey[k].title)))));
  }

  async function select(key) {
    if (!boards.some((b) => b.key === key)) key = 'xp';
    current = key;
    store.set('lb_board', key);
    const url = new URL(location.href);
    url.searchParams.set('b', key);
    history.replaceState(null, '', url);
    renderTabs();
    fill($('#board'), h('div', { class: 'lb-empty' }, h('span', { class: 'spin' }, '🌀'), ' Loading…'));
    try {
      const { board } = await Net.request('lb:get', { board: key });
      if (board.key === current) renderBoard(board);
    } catch (e) {
      fill($('#board'), h('div', { class: 'lb-empty' }, '😵 ', e.message));
    }
  }

  function renderBoard(b) {
    const rows = b.rows;
    const me = Account.user;
    const top = rows.slice(0, 3);
    const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
    const podium = h('div', { class: 'podium' }, order.map(([r, place]) => (r
      ? h('a', { class: `step p${place}`, href: profileUrl(r.name), title: `See ${r.name}'s profile` },
        UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name), h('div', { class: 'pts' }, fmtValue(r.value, b.format)), h('div', { class: 'block' }, place))
      : h('div', { class: 'step' }))));
    const list = h('div', { class: 'lb-list' }, rows.slice(3).map((r) => h('a', { class: 'lb-row' + (me && r.id === me.id ? ' me' : ''), href: profileUrl(r.name) },
      h('span', { class: 'rk' }, '#' + r.rank), UI.avatar(r, 'sm'), h('span', { class: 'nm' }, r.name),
      h('span', { class: 'lvl' }, 'Lv ' + r.level), h('span', { class: 'val' }, fmtValue(r.value, b.format)))));
    fill($('#board'),
      h('div', { class: 'panel-title' }, b.title, h('span', { class: 'count' }, rows.length ? `Top ${rows.length}` : '')),
      rows.length ? [podium, list] : h('div', { class: 'lb-empty' }, h('div', { style: { fontSize: '2.6rem' } }, '🏜️'), 'Nobody here yet — be the first!'));
    if (FX.list) FX.list(list.children, { x: -24, y: 0, stagger: 0.03, duration: 0.35, delay: 0.5 });

    let mine;
    if (!me) {
      mine = h('div', { class: 'lb-mine guest' }, h('span', { class: 'e' }, '✨'),
        h('div', { class: 'grow' }, h('b', {}, 'Want to be on here?'), h('div', { class: 'tiny muted' }, 'Guests don’t get saved. Make a free account!')),
        h('button', { class: 'btn btn-pink btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, 'Sign up'));
    } else if (b.me) {
      mine = h('div', { class: 'lb-mine' }, UI.avatar(me), h('div', { class: 'grow' }, h('b', {}, 'You'), h('div', { class: 'tiny muted' }, me.name)),
        h('div', { class: 'rk' }, '#' + b.me.rank), h('div', { class: 'val' }, fmtValue(b.me.value, b.format)));
    } else {
      mine = h('div', { class: 'lb-mine' }, h('span', { class: 'e' }, '🎯'), h('div', { class: 'grow' }, 'You’re not on this board yet — go play!'),
        h('a', { class: 'btn btn-lime btn-sm', href: '/' }, 'Play'));
    }
    fill($('#mine'), mine);
    if (FX.pop) FX.pop(mine, { from: 0.85, delay: 0.3 });
  }

  on('account', () => { if (boards.length) select(current); });
  Net.connect();
  Net.request('lb:boards').then((r) => { boards = r.boards; select(current); })
    .catch((e) => fill($('#board'), h('div', { class: 'lb-empty' }, '😵 ', e.message)));
})();
