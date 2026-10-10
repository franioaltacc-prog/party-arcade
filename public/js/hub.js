/* Home page: game cards, live counts, open rooms, lobby chat. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Profile, Sfx, rand } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  // ---------------------------------------------------------------- art
  const svg = (id, body, from, to) => `<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="200" height="120" fill="url(#g-${id})"/>${body}</svg>`;
  const emoji = (x, y, size, e, extra = '') => {
    const url = PA.Emoji.url(e);
    const s = size * 1.15;
    return url ? `<image href="${url}" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" ${extra}/>`
      : `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" ${extra}>${e}</text>`;
  };

  const ART = {
    dash: svg('dash', `
      <g stroke="rgba(255,255,255,.08)">${[20, 50, 80].map((y) => `<path d="M0 ${y}h200"/>`).join('')}${[30, 70, 110, 150, 190].map((x) => `<path d="M${x} 0v92"/>`).join('')}</g>
      <rect y="92" width="200" height="28" fill="rgba(0,0,0,.35)"/><path d="M0 92h200" stroke="#f0abfc" stroke-width="2.5"/>
      <path d="M28 88 q 30 -62 64 -30" stroke="#fde047" stroke-dasharray="3 6" fill="none" stroke-width="2.5" stroke-linecap="round"/>
      <g transform="translate(78 40) rotate(28 13 13)"><rect width="26" height="26" rx="4" fill="#facc15" stroke="#fff" stroke-width="2.5"/><rect x="5" y="8" width="6" height="6" fill="#1e1b4b"/><rect x="15" y="8" width="6" height="6" fill="#1e1b4b"/><rect x="6" y="17" width="14" height="3" fill="#1e1b4b"/></g>
      <path d="M118 92l9-19 9 19zM136 92l9-19 9 19z" fill="#0f0a2e" stroke="#22d3ee" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="162" y="66" width="26" height="26" fill="#1e1b4b" stroke="#22d3ee" stroke-width="2.5"/>
      <circle cx="175" cy="38" r="9" fill="none" stroke="#fde047" stroke-width="3"/>`, '#2e1065', '#9333ea'),
    life: svg('life', `
      <circle cx="40" cy="62" r="24" fill="rgba(255,255,255,.18)"/><circle cx="100" cy="62" r="24" fill="rgba(255,255,255,.18)"/><circle cx="160" cy="62" r="24" fill="rgba(255,255,255,.18)"/>
      <path d="M66 62h8M126 62h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      ${emoji(40, 63, 28, '👶')}${emoji(100, 63, 28, '🧑‍🎓')}${emoji(160, 63, 28, '👵')}
      ${emoji(24, 22, 16, '💰')}${emoji(176, 20, 16, '💍')}${emoji(100, 104, 16, '🏆')}${emoji(62, 104, 14, '❤️')}${emoji(140, 104, 14, '🎓')}`, '#0e7490', '#16a34a'),
    doodle: svg('doodle', `
      <g transform="rotate(-5 100 60)"><rect x="34" y="14" width="132" height="92" rx="8" fill="#fff"/>
      <path d="M56 78 q 14 -34 30 -6 t 30 -10 t 26 6" stroke="#f43f5e" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M58 40 q 10 -14 22 0 q 10 14 22 0" stroke="#3b82f6" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="138" cy="40" r="11" fill="none" stroke="#facc15" stroke-width="5"/>
      <path d="M70 92h60" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 9"/></g>
      ${emoji(170, 92, 34, '✏️')}${emoji(26, 26, 18, '❓')}`, '#db2777', '#f97316'),
    blitz: svg('blitz', `
      <g fill="rgba(255,255,255,.14)">${Array.from({ length: 12 }, (_, i) => `<path d="M100 60 L${100 + 140 * Math.cos(i * Math.PI / 6)} ${60 + 140 * Math.sin(i * Math.PI / 6)} L${100 + 140 * Math.cos(i * Math.PI / 6 + 0.25)} ${60 + 140 * Math.sin(i * Math.PI / 6 + 0.25)}Z"/>`).join('')}</g>
      <circle cx="100" cy="60" r="34" fill="#fde047" stroke="#fff" stroke-width="4"/>${emoji(100, 62, 40, '⚡')}
      ${emoji(32, 30, 22, '🧮')}${emoji(168, 30, 22, '🎨')}${emoji(36, 94, 22, '👊')}${emoji(166, 92, 22, '🔍')}`, '#ea580c', '#facc15'),
    casino: svg('casino', `
      <ellipse cx="100" cy="66" rx="92" ry="46" fill="#14532d" stroke="#78350f" stroke-width="6"/>
      <g transform="translate(50 46) rotate(-12)"><rect width="30" height="42" rx="5" fill="#fff"/><text x="15" y="24" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">A♠</text></g>
      <g transform="translate(76 40) rotate(8)"><rect width="30" height="42" rx="5" fill="#fff"/><text x="15" y="24" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" fill="#dc2626" font-family="Fredoka, sans-serif">K♥</text></g>
      ${[[132, 78, '#3b82f6'], [146, 70, '#ef4444'], [138, 60, '#facc15'], [152, 54, '#16a34a']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="11" fill="${c}" stroke="#fff" stroke-width="3" stroke-dasharray="4 3"/>`).join('')}
      ${emoji(40, 24, 18, '🎰')}${emoji(168, 22, 18, '🪙')}${emoji(30, 100, 16, '🎲')}`, '#422006', '#a16207'),
    impostor: svg('imp', `
      <circle cx="100" cy="76" r="28" fill="none" stroke="#f43f5e" stroke-width="3" stroke-dasharray="5 5"/>
      ${[[45, '😎'], [100, '🕵️'], [155, '🤠']].map(([x, e]) => `<circle cx="${x}" cy="76" r="22" fill="rgba(255,255,255,.16)"/>${emoji(x, 77, 26, e)}`).join('')}
      ${[[45, '🍕'], [100, '❓'], [155, '🍕']].map(([x, e]) => `<rect x="${x - 17}" y="14" width="34" height="28" rx="10" fill="#fff"/><path d="M${x - 5} 41 l5 8 l5 -8z" fill="#fff"/>${emoji(x, 28, 16, e)}`).join('')}
      ${emoji(100, 110, 12, '🗳️ ? 🗳️')}`, '#4c0519', '#5b21b6'),
    mines: svg('mines', `
      <g transform="translate(46 10)">${Array.from({ length: 30 }, (_, k) => {
        const r = Math.floor(k / 6); const c = k % 6; const x = c * 18; const y = r * 20;
        const open = { 7: '1', 8: '1', 9: '2', 13: '1', 14: '', 15: '3', 19: '1', 20: '', 21: '2', 25: '', 26: '1' }[k];
        if (k === 16) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#7f1d1d"/>${emoji(x + 8, y + 10, 11, '💥')}`;
        if (k === 10 || k === 22) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#3d3480"/>${emoji(x + 8, y + 10, 10, '🚩')}`;
        if (open !== undefined) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="rgba(255,255,255,.08)"/>${open ? `<text x="${x + 8}" y="${y + 10}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="800" fill="${{ 1: '#60a5fa', 2: '#4ade80', 3: '#f87171' }[open]}" font-family="Fredoka, sans-serif">${open}</text>` : ''}`;
        return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#3d3480"/>`;
      }).join('')}</g>
      ${emoji(24, 30, 22, '💣')}${emoji(178, 92, 22, '😎')}`, '#0f172a', '#4338ca'),
    connect4: svg('c4', `
      <rect x="38" y="12" width="124" height="100" rx="12" fill="#2563eb" stroke="#1d4ed8" stroke-width="3"/>
      ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4, 5].map((c) => {
        const color = { '4,1': '#f43f5e', '4,2': '#facc15', '4,3': '#f43f5e', '3,2': '#f43f5e', '3,3': '#facc15', '2,3': '#f43f5e', '4,4': '#facc15', '3,4': '#facc15', '1,4': '#f43f5e', '2,4': '#facc15' }[`${r},${c}`] || '#0b0920';
        return `<circle cx="${55 + c * 18}" cy="${28 + r * 18}" r="7" fill="${color}"/>`;
      }).join('')).join('')}
      <circle cx="73" cy="6" r="7" fill="#facc15"/>`, '#1e3a8a', '#0ea5e9'),
    snake: svg('snake', `
      <g stroke="rgba(255,255,255,.07)">${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 18} 0v120"/>`).join('')}${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * 18}h200"/>`).join('')}</g>
      <path d="M30 96 H90 V60 H142 V30" stroke="#a3e635" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="142" cy="30" r="9" fill="#bef264"/><circle cx="139" cy="27" r="2" fill="#111"/><circle cx="146" cy="27" r="2" fill="#111"/>
      ${emoji(172, 76, 22, '🍎')}`, '#052e16', '#166534'),
    '2048': svg('2048', `
      ${[['2', '#eee4da', '#776e65'], ['4', '#ede0c8', '#776e65'], ['8', '#f2b179', '#fff'], ['16', '#f59563', '#fff'], ['32', '#f67c5f', '#fff'], ['64', '#f65e3b', '#fff'], ['128', '#edcf72', '#fff'], ['2048', '#edc22e', '#fff']].map(([n, bg, fg], i) => {
        const x = 26 + (i % 4) * 38; const y = 22 + Math.floor(i / 4) * 40;
        return `<rect x="${x}" y="${y}" width="34" height="34" rx="6" fill="${bg}"/><text x="${x + 17}" y="${y + 18}" font-size="${n.length > 3 ? 10 : 14}" font-weight="800" fill="${fg}" text-anchor="middle" dominant-baseline="central" font-family="Fredoka, sans-serif">${n}</text>`;
      }).join('')}${emoji(182, 60, 20, '✨')}`, '#78350f', '#d97706'),
    memory: svg('memory', `
      <g transform="rotate(-10 60 62)"><rect x="34" y="28" width="50" height="68" rx="9" fill="#7c3aed" stroke="#fff" stroke-width="3"/><path d="M44 40h30M44 52h30M44 64h30M44 76h30M44 88h30" stroke="rgba(255,255,255,.3)" stroke-width="5"/></g>
      <rect x="76" y="22" width="50" height="68" rx="9" fill="#fff" stroke="#facc15" stroke-width="3"/>${emoji(101, 57, 30, '🦄')}
      <g transform="rotate(10 142 62)"><rect x="118" y="28" width="50" height="68" rx="9" fill="#fff" stroke="#facc15" stroke-width="3"/>${emoji(143, 63, 30, '🦄')}</g>`, '#4c1d95', '#c026d3'),
    'dash-solo': null,
    wheel: svg('wheel', `
      <g transform="translate(100 62)">${['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#fb923c'].map((c, i) => {
        const a1 = (i / 6) * Math.PI * 2; const a2 = ((i + 1) / 6) * Math.PI * 2;
        return `<path d="M0 0 L${46 * Math.cos(a1)} ${46 * Math.sin(a1)} A46 46 0 0 1 ${46 * Math.cos(a2)} ${46 * Math.sin(a2)} Z" fill="${c}"/>`;
      }).join('')}<circle r="46" fill="none" stroke="#fff" stroke-width="4"/><circle r="9" fill="#fff"/></g>
      <path d="M100 6 l-9 -2 9 22 9 -22z" fill="#fff"/>${emoji(30, 30, 18, '🎉')}${emoji(172, 96, 18, '🤔')}`, '#0f766e', '#4f46e5'),
    wyr: svg('wyr', `
      <rect width="100" height="120" fill="#e11d48"/><rect x="100" width="100" height="120" fill="#2563eb"/>
      ${emoji(50, 54, 34, '🦖')}${emoji(150, 54, 34, '🦄')}
      <circle cx="100" cy="60" r="20" fill="#fff"/><text x="100" y="61" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">OR</text>
      <text x="50" y="100" text-anchor="middle" font-size="12" font-weight="700" fill="rgba(255,255,255,.85)" font-family="Fredoka, sans-serif">54%</text>
      <text x="150" y="100" text-anchor="middle" font-size="12" font-weight="700" fill="rgba(255,255,255,.85)" font-family="Fredoka, sans-serif">46%</text>`, '#e11d48', '#2563eb'),
    eightball: svg('8ball', `
      ${Array.from({ length: 18 }, () => `<circle cx="${Math.random() * 200}" cy="${Math.random() * 120}" r="${Math.random() * 1.6 + 0.4}" fill="#fff" opacity="${Math.random() * 0.7 + 0.2}"/>`).join('')}
      <circle cx="100" cy="60" r="44" fill="#111"/><circle cx="86" cy="44" r="16" fill="rgba(255,255,255,.12)"/>
      <circle cx="100" cy="60" r="18" fill="#fff"/><text x="100" y="61" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">8</text>`, '#1e1b4b', '#312e81'),
  };
  ART['mines-solo'] = ART.mines.replaceAll('g-mines', 'g-mines2').replace('#0f172a', '#14532d').replace('#4338ca', '#0d9488');
  ART['dash-solo'] = ART.dash.replaceAll('g-dash', 'g-dash2').replace('#2e1065', '#082f49').replace('#9333ea', '#0891b2');

  // ---------------------------------------------------------------- cards
  const ONLINE = [
    { key: 'dash', title: 'Neon Dash', icon: '🟪', desc: 'A mini Geometry Dash! Race your friends through the same level of spikes, jump pads and orbs.', players: '1–12 players', glow: 'rgba(168,85,247,.7)', feature: true },
    { key: 'life', title: 'Family Life', icon: '🏡', desc: 'A multiplayer BitLife where you and your friends are siblings in one family. Vote to age up, plan family trips, prank each other. Best life wins!', players: '1–4 siblings', glow: 'rgba(34,197,94,.6)', feature: true },
    { key: 'doodle', title: 'Doodle Guess', icon: '🎨', desc: 'One person draws, everyone guesses. Fast fingers win!', players: '2–12 players', glow: 'rgba(244,63,94,.6)' },
    { key: 'impostor', title: 'Impostor', icon: '🕵️', desc: 'Everyone knows the secret word… except the impostor. Give one clue each, argue it out, and vote out the faker!', players: '3–10 players', glow: 'rgba(244,63,94,.6)', isNew: true },
    { key: 'mines', title: 'Minesweeper', icon: '💣', desc: 'Race your friends on the same board, or battle on one shared board for the most squares!', players: '1–8 players', glow: 'rgba(99,102,241,.6)', isNew: true },
    { key: 'blitz', title: 'Party Blitz', icon: '⚡', desc: 'Rapid-fire minigames: reaction, mashing, math, memory and more.', players: '1–12 players', glow: 'rgba(250,204,21,.6)' },
    { key: 'casino', title: 'Casino Night', icon: '🎰', desc: 'Fake-coin casino party: roulette, blackjack, slots, dice, poker and 1v1 duels. Most coins wins!', players: '1–6 players', glow: 'rgba(251,191,36,.6)' },
    { key: 'connect4', title: 'Connect 4', icon: '🔴', desc: 'The classic. Drop discs, get four in a row, talk trash in chat.', players: '2 + spectators', glow: 'rgba(59,130,246,.6)' },
  ];
  const SOLO = [
    { key: 'dash-solo', href: '/games/dash?solo=1', title: 'Neon Dash Practice', icon: '🟦', desc: 'Train on random levels and chase your best times.', players: 'Solo' },
    { key: 'mines-solo', href: '/games/mines?solo=1', title: 'Minesweeper', icon: '💣', desc: 'The classic! Easy, Medium and Hard boards. Your first click is always safe.', players: 'Solo' },
    { key: 'snake', title: 'Neon Snake', icon: '🐍', desc: 'Eat, grow, don’t bite yourself. Gets faster every apple.', players: 'Solo' },
    { key: '2048', title: '2048', icon: '🔢', desc: 'Slide and merge tiles. Can you reach 2048?', players: 'Solo' },
    { key: 'memory', title: 'Memory Flip', icon: '🃏', desc: 'Flip cards and find all the emoji pairs.', players: 'Solo' },
  ];
  const FUN = [
    { key: 'wheel', title: 'Spin the Wheel', icon: '🎡', desc: 'Can’t decide? Let the wheel choose. Add your own options!', players: 'Toy' },
    { key: 'wyr', title: 'Would You Rather', icon: '🤔', desc: 'Pick a side and see what everyone else on the server chose.', players: 'Global votes' },
    { key: 'eightball', title: 'Magic 8-Ball', icon: '🎱', desc: 'Ask a yes-or-no question. The ball knows all.', players: 'Toy' },
  ];
  const ALL = [...ONLINE, ...SOLO, ...FUN];

  function card(g, kind) {
    const href = g.href || `/games/${g.key}`;
    const badge = kind === 'online' ? h('span', { class: 'badge online' }, '● Online') : kind === 'solo' ? h('span', { class: 'badge solo' }, 'Solo') : h('span', { class: 'badge fun' }, 'Fun');
    const live = h('span', { class: 'live', 'data-live': g.key }, h('span', { class: 'dot' }), h('span', { class: 'n' }, '0'), ' playing');
    const thumb = h('div', { class: 'thumb', html: ART[g.key] || '' }, badge, kind === 'online' ? live : null,
      g.isNew ? h('span', { class: 'badge new new-tag' }, '✨ New') : null);
    return h('a', { class: 'game-card' + (g.feature ? ' feature' : ''), href, style: g.glow ? { '--glow': g.glow } : null, onclick: () => Sfx.play('pop') },
      thumb,
      h('div', { class: 'info' },
        h('h3', {}, h('span', {}, g.icon), g.title),
        h('p', {}, g.desc),
        h('div', { class: 'meta' }, h('span', {}, '👥 ' + g.players))));
  }
  $('#cards-online').append(...ONLINE.map((g) => card(g, 'online')));
  $('#cards-solo').append(...SOLO.map((g) => card(g, 'solo')));
  $('#cards-fun').append(...FUN.map((g) => card(g, 'fun')));
  $('#stat-games').textContent = ALL.length;
  if (G) FX.count($('#stat-games'), ALL.length, { from: 0, duration: 1.6 });

  // ---------------------------------------------------------------- top bar
  UI.topbar({ back: false });

  // ---------------------------------------------------------------- live counts
  Net.on('online', (m) => {
    if (G) FX.count($('#stat-online'), m.count, { duration: 1.2 }); else $('#stat-online').textContent = m.count;
    document.querySelectorAll('[data-live]').forEach((el) => {
      const n = (m.games || {})[el.dataset.live] || 0;
      el.classList.toggle('on', n > 0);
      el.querySelector('.n').textContent = n;
    });
  });

  // ---------------------------------------------------------------- join by code
  const joinForm = $('#join-form');
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4 && G) { UI.toast('Room codes have 4 characters 🔑', 'bad'); FX.shake($('#join-code')); return; }
    if (code.length !== 4) { UI.toast('Room codes have 4 characters 🔑', 'bad'); $('#join-code').classList.add('shake'); setTimeout(() => $('#join-code').classList.remove('shake'), 400); return; }
    Net.send('room:find', { code });
  });
  Net.on('room:found', (m) => {
    if (m.game) { Sfx.play('coin'); location.href = `/games/${m.game}?room=${m.code}`; }
    else { Sfx.play('wrong'); UI.toast(`No room called ${m.code} 🤔 Check the code!`, 'bad'); }
  });

  $('#surprise').addEventListener('click', () => {
    Sfx.play('boing');
    const g = rand(ALL);
    UI.toast(`${g.icon} ${g.title}!`, 'good', 900);
    if (G) G.to('.hero-art', { rotation: '+=720', scale: 1.15, duration: 0.65, ease: 'power2.in' });
    setTimeout(() => { location.href = g.href || `/games/${g.key}`; }, 650);
  });

  // ---------------------------------------------------------------- open rooms
  const roomsPanel = $('#rooms-panel');
  const seenRooms = new Set();
  function renderRooms(rooms) {
    if (G) { if (String(rooms.length) !== $('#stat-rooms').textContent) FX.count($('#stat-rooms'), rooms.length); }
    else $('#stat-rooms').textContent = rooms.length;
    const info = Lobby.GAME_INFO;
    fill(roomsPanel, 
      h('div', { class: 'panel-title' }, '🔥 Open rooms', h('span', { class: 'count' }, rooms.length ? `${rooms.length} live` : '')),
      rooms.length
        ? h('div', {}, rooms.map((r) => h('div', { class: 'room-item' },
          h('div', { class: 'ri-emoji' }, (info[r.game] || {}).emoji || '🎮'),
          h('div', { class: 'grow' },
            h('div', { class: 'ri-title' }, (info[r.game] || {}).title || r.game),
            h('div', { class: 'ri-sub' }, `${r.hostAvatar} ${r.host} · ${r.players}/${r.max} · ${r.code}`)),
          h('a', { class: 'btn btn-lime btn-sm', href: `/games/${r.game}?room=${r.code}` }, 'Join'))))
        : h('div', { class: 'empty' }, 'No open rooms yet.', h('br'), 'Start one and invite your friends! 🎈'),
    );
    if (!G) return;
    const fresh = [...roomsPanel.querySelectorAll('.room-item')].filter((el, i) => {
      const key = rooms[i].code;
      if (seenRooms.has(key)) return false;
      seenRooms.add(key);
      return true;
    });
    if (fresh.length) G.from(fresh, { x: 50, scale: 0.8, autoAlpha: 0, stagger: 0.08, duration: 0.6, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
  }
  renderRooms([]);
  Net.on('rooms:list', (m) => renderRooms(m.rooms));
  const poll = () => { if (!document.hidden) Net.send('rooms:list'); };
  setInterval(poll, 4000);

  // ---------------------------------------------------------------- top players
  const topPanel = $('#top-panel');
  async function renderTop() {
    let board = null;
    try { board = (await Net.request('lb:get', { board: 'xp' })).board; } catch { /* accounts offline */ }
    const u = PA.Account.user;
    const rows = board ? board.rows.slice(0, 5) : [];
    fill(topPanel,
      h('div', { class: 'panel-title' }, '🌟 Top players', h('a', { class: 'count', href: '/leaderboards' }, 'All boards →')),
      h('a', { class: 'find-link', href: '/players' }, '🔎 Find a player…'),
      rows.length
        ? h('div', { class: 'top-list' }, rows.map((r) => h('a', { class: 'top-row' + (u && r.id === u.id ? ' me' : ''), href: '/profile?u=' + encodeURIComponent(r.name) },
          h('span', { class: 'rk' }, ['🥇', '🥈', '🥉'][r.rank - 1] || '#' + r.rank), PA.UI.avatar(r, 'sm'), h('span', { class: 'nm' }, r.name),
          h('span', { class: 'lvl' }, 'Lv ' + r.level))))
        : h('div', { class: 'empty' }, board ? 'No champions yet — be the first! 👑' : 'Leaderboards are taking a nap 😴'),
      u
        ? h('a', { class: 'top-me', href: '/profile?u=' + encodeURIComponent(u.name) }, PA.UI.xpBar(u))
        : h('button', { class: 'btn btn-pink btn-sm btn-block', style: { marginTop: '12px' }, onclick: () => PA.UI.accountModal({ view: 'choose' }) }, '✨ Sign up to save your stats'));
    if (G) FX.list(topPanel.querySelectorAll('.top-row'), { x: 30, y: 0, stagger: 0.06 });
  }
  PA.on('account', () => renderTop());
  setInterval(() => { if (!document.hidden) renderTop(); }, 60000);

  // ---------------------------------------------------------------- lobby chat
  const chat = Lobby.ChatBox($('#lobby-chat'), { title: '💬 Lobby chat', placeholder: 'Say hi to everyone…', room: false });
  Net.on('chat', (m) => { chat.add(m); if (m.from && m.from.id !== Net.id) Sfx.play('message'); });
  Net.on('chat:history', (m) => { chat.clear(); m.messages.forEach((x) => chat.add(x)); if (!m.messages.length) chat.add({ sys: true, placeholder: true, text: 'Be the first to say something! 👋' }); });
  Net.on('welcome', () => { Net.send('chat:history'); poll(); renderTop(); });

  // ---------------------------------------------------------------- motion
  if (G) {
    const hero = $('.hero');
    const art = $('.hero-art');
    const bubbles = [...document.querySelectorAll('.hero-bubble')];
    // split the plain first line into words (the gradient part animates as one piece)
    const h1 = $('.hero h1');
    const first = h1.firstChild;
    let words = [];
    if (first && first.nodeType === 3) {
      const span = h('span', {}, first.textContent);
      h1.replaceChild(span, first);
      words = FX.split(span, 'words');
    }
    const grad = $('.hero .gradient-text');
    grad.style.display = 'inline-block';
    const tl = G.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.hero .badge.new', { y: -30, scale: 0.5, autoAlpha: 0, duration: 0.6, ease: 'back.out(2.5)' })
      .from(words, { y: 60, rotationX: -90, autoAlpha: 0, transformOrigin: '50% 100%', transformPerspective: 600, stagger: 0.08, duration: 0.7, ease: 'back.out(1.8)' }, 0.1)
      .from(grad, { scale: 0, rotation: -10, autoAlpha: 0, duration: 1.1, ease: 'elastic.out(1, 0.5)' }, '-=0.35')
      .from('.hero .lead', { y: 20, autoAlpha: 0, duration: 0.5 }, '-=0.8')
      .from('.hero-actions > *', { y: 24, autoAlpha: 0, stagger: 0.1, duration: 0.5, ease: 'back.out(2)', clearProps: 'transform' }, '-=0.55')
      .from('.hero-stats > div', { y: 24, autoAlpha: 0, stagger: 0.1, duration: 0.5 }, '-=0.35')
      .from(art, { scale: 0.2, rotation: -120, autoAlpha: 0, duration: 1.3, ease: 'elastic.out(1, 0.6)' }, 0.15)
      .from(bubbles, {
        x: (i, el) => art.clientWidth / 2 - (el.offsetLeft + el.offsetWidth / 2),
        y: (i, el) => art.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2),
        scale: 0, autoAlpha: 0, stagger: 0.07, duration: 0.8, ease: 'back.out(1.8)',
      }, 0.65);
    // after the intro: bubbles float, react to hover, and the art follows the mouse
    tl.call(() => {
      bubbles.forEach((b, i) => {
        G.to(b, { y: i % 2 ? 12 : -12, rotation: i % 2 ? -6 : 6, duration: 2 + (i % 3) * 0.5, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        const sc = G.quickTo(b, 'scale', { duration: 0.4, ease: 'back.out(3)' });
        b.addEventListener('pointerenter', () => sc(1.2));
        b.addEventListener('pointerleave', () => sc(1));
      });
      if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      G.set(art, { transformPerspective: 900 });
      const rx = G.quickTo(art, 'rotationX', { duration: 0.8, ease: 'power3' });
      const ry = G.quickTo(art, 'rotationY', { duration: 0.8, ease: 'power3' });
      const bx = bubbles.map((b) => G.quickTo(b, 'x', { duration: 1, ease: 'power3' }));
      hero.addEventListener('pointermove', (e) => {
        const r = art.getBoundingClientRect();
        const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
        const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
        ry(nx * 16); rx(-ny * 12);
        bx.forEach((q, i) => q(nx * (10 + (i % 3) * 8)));
      });
      hero.addEventListener('pointerleave', () => { rx(0); ry(0); bx.forEach((q) => q(0)); });
    });
    if (window.ScrollTrigger) {
      G.to(art, { yPercent: 16, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } });
    }
    // game cards, section titles, side panels
    FX.reveal('.section-head', { y: 30 });
    FX.reveal('.game-card', { rotate: true });
    FX.tilt('.game-card', 6);
    G.from('.hub-side > *', { x: 60, autoAlpha: 0, stagger: 0.15, duration: 0.8, ease: 'power3.out', delay: 0.5, clearProps: 'transform,opacity,visibility' });
    FX.reveal('.footer', { y: 20 });
  }

  Net.connect();
  if (!Profile.isSet()) setTimeout(() => Profile.ensure(), 400);
})();
