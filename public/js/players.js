/* Find players: a public search of everyone who has an account. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, store, on } = PA;
  const FX = PA.FX || {};
  const root = $('#players');
  const SORTS = [['active', '🟢 Recently active'], ['new', '✨ Newest'], ['level', '🌟 Highest level'], ['name', '🔤 A–Z']];
  const params = new URLSearchParams(location.search);
  let sort = params.get('sort') || store.get('players_sort', 'active');
  let query = params.get('q') || '';
  let asked = 0;

  UI.topbar({ title: 'Find players', emoji: '🔎' });

  const search = h('input', { class: 'input pl-search', type: 'search', placeholder: 'Search by username…', value: query, maxlength: 16, autocomplete: 'off', spellcheck: false, 'aria-label': 'Search players' });
  const sortBar = h('div', { class: 'seg' });
  const count = h('span', { class: 'muted small' });
  const grid = h('div', { class: 'pl-grid' });
  const cta = h('div');

  fill(root,
    h('section', { class: 'page-head' }, h('h1', { class: 'display' }, 'Find players ', h('span', { class: 'gradient-text' }, '🔎')),
      h('p', { class: 'muted' }, 'Look up anyone who has an account. Click a player to see their profile, stats and achievements.')),
    h('div', { class: 'pl-tools panel' }, search, h('div', { class: 'row wrap', style: { justifyContent: 'space-between', gap: '10px' } }, sortBar, count)),
    grid, cta);

  function drawSorts() {
    fill(sortBar, SORTS.map(([k, label]) => h('button', { class: k === sort ? 'on' : '', onclick: () => { sort = k; store.set('players_sort', k); drawSorts(); find(); } }, label)));
  }

  function card(p) {
    return h('a', { class: 'pl-card', href: '/profile?u=' + encodeURIComponent(p.name), style: { '--c': p.color } },
      h('div', { class: 'pl-av' }, UI.avatar(p, 'lg'), p.online ? h('span', { class: 'pl-dot', title: 'Online now' }) : null),
      h('div', { class: 'pl-name' }, p.name, p.admin ? h('span', { title: 'Admin' }, ' 🛡️') : null),
      h('span', { class: 'pl-lvl' }, `Level ${p.level}`),
      h('div', { class: 'pl-seen ' + (p.online ? 'online-now' : '') }, p.online ? (p.playing ? `🟢 Playing ${p.playing}` : '🟢 Online now') : `Seen ${UI.timeAgo(p.lastSeen)}`),
      p.bio ? h('div', { class: 'pl-bio' }, p.bio) : null);
  }

  async function find() {
    const id = ++asked;
    query = search.value.trim();
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    url.searchParams.set('sort', sort);
    history.replaceState(null, '', url);
    try {
      const r = await Net.request('players:find', { q: query, sort });
      if (id !== asked) return;
      count.textContent = `${r.total.toLocaleString('en-US')} player${r.total === 1 ? '' : 's'} signed up`;
      if (!r.players.length) {
        fill(grid, h('div', { class: 'lb-empty', style: { gridColumn: '1 / -1' } }, h('div', { style: { fontSize: '2.6rem' } }, query ? '🤷' : '🏜️'),
          query ? `Nobody called “${query}”… yet.` : 'No players yet — be the first to sign up!'));
        return;
      }
      fill(grid, r.players.map(card));
      if (FX.list) FX.list(grid.children, { y: 20, scale: 0.9, stagger: 0.03, duration: 0.4, ease: 'back.out(1.8)' });
      if (FX.tilt) FX.tilt(grid.children, 6);
    } catch (e) {
      if (id === asked) fill(grid, h('div', { class: 'lb-empty', style: { gridColumn: '1 / -1' } }, '😵 ', e.message));
    }
  }

  function drawCta() {
    fill(cta, Account.user ? null : h('div', { class: 'lb-mine guest' }, h('span', { class: 'e' }, '✨'),
      h('div', { class: 'grow' }, h('b', {}, 'Want to show up here?'), h('div', { class: 'tiny muted' }, 'Make a free account so friends can find you.')),
      h('button', { class: 'btn btn-pink btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, 'Sign up')));
  }

  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(find, 250); });
  on('account', drawCta);
  drawSorts();
  drawCta();
  Net.connect();
  find();
  if (matchMedia('(pointer: fine)').matches) search.focus();
})();
