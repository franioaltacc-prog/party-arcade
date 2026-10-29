/* Admin panel. Only admin accounts can use it: the server re-checks every request. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, on, icon } = PA;
  const FX = PA.FX || {};
  const root = $('#admin');
  const GAMES = { dash: ['🟪', 'Neon Dash'], life: ['🏡', 'Family Life'], doodle: ['🎨', 'Doodle Guess'], songs: ['🎧', 'Song Rush'], volley: ['🏐', 'Screen Volley'], blitz: ['⚡', 'Party Blitz'], connect4: ['🔴', 'Connect 4'], billiards: ['🎱', 'Billiards'], casino: ['🎰', 'Casino Night'], impostor: ['🕵️', 'Impostor'], mines: ['💣', 'Minesweeper'], flappy: ['🐤', 'Neon Flappy'], golf: ['⛳', 'Mini Golf'], poly: ['🏎️', 'Poly Racer'], moto: ['🏍️', 'Revvd'], prophunt: ['🔫', 'Prop Hunt'], front: ['🌍', 'Front Wars'] };
  let timer = null;
  let mode = null;
  let lastQuery = '';

  UI.topbar({ title: 'Admin', emoji: '🛡️' });

  async function req(t, data) {
    try { return await Net.request(t, data); } catch (e) { UI.toast(e.message, 'bad', 4500); throw e; }
  }

  /** Small form in a popup. fields: [{key, label, type, value, placeholder}] → values or null */
  function ask(title, text, fields, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      let answer = null;
      const inputs = fields.map((f) => h('input', { class: 'input', type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', autocomplete: 'off' }));
      const close = UI.modal(h('form', { onsubmit: (e) => {
        e.preventDefault();
        answer = Object.fromEntries(fields.map((f, i) => [f.key, inputs[i].value]));
        close();
      } },
      h('h2', {}, title), text ? h('p', { class: 'muted', style: { marginBottom: '12px' } }, text) : null,
      fields.map((f, i) => h('label', { class: 'field', style: { marginBottom: '10px' } }, f.label, inputs[i])),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'btn-red' : 'btn-pink'), type: 'submit' }, okLabel))), { onClose: () => resolve(answer) });
      setTimeout(() => inputs[0] && inputs[0].focus(), 80);
    });
  }

  function page(...kids) {
    fill(root, h('section', { class: 'page-head' }, h('h1', { class: 'display' }, 'Admin panel ', h('span', { class: 'gradient-text' }, '🛡️')),
      h('p', { class: 'muted' }, 'Only admins can see this page. With great power comes great responsibility.')), kids);
  }

  // ------------------------------------------------------------ gate
  function gate() {
    clearInterval(timer);
    const u = Account.user;
    if (!u) {
      mode = 'login';
      page(h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, '🔐'), h('h1', {}, 'Log in first'),
        h('p', { class: 'tagline' }, 'The admin panel works with your normal account. Log in, then unlock admin with your secret admin code.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn btn-cyan btn-lg btn-block', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in'),
          h('button', { class: 'btn btn-ghost btn-block', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Create an account'))));
      if (FX.entry) FX.entry(root.querySelector('.entry'));
      return;
    }
    if (!u.admin) {
      mode = 'unlock';
      const code = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Admin code', style: { textAlign: 'center' } });
      const err = h('p', { class: 'acct-err' });
      page(h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, '🗝️'), h('h1', {}, 'Unlock admin'),
        h('p', { class: 'tagline' }, `Logged in as ${u.name}. Type the secret ADMIN_CODE you set on the server to make this account an admin.`),
        h('form', { class: 'actions', onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = '';
          try {
            const r = await Net.request('admin:unlock', { code: code.value });
            Account.save(r.user);
            UI.toast('🛡️ Admin unlocked! Welcome, boss.', 'good');
            UI.confetti(160);
            PA.Sfx.play('win');
            gate();
          } catch (ex) { err.textContent = ex.message; PA.Sfx.play('wrong'); if (FX.shake) FX.shake(code); }
        } }, code, err, h('button', { class: 'btn btn-yellow btn-lg btn-block', type: 'submit' }, '🗝️ Unlock'))));
      if (FX.entry) FX.entry(root.querySelector('.entry'));
      return;
    }
    if (mode !== 'admin') dashboard();
  }

  // ------------------------------------------------------------ dashboard
  function dashboard() {
    mode = 'admin';
    const search = h('input', { class: 'input', placeholder: 'Search players by name… (empty = recent)', autocomplete: 'off' });
    let debounce;
    search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => findUsers(search.value), 300); });
    const msg = h('input', { class: 'input', maxlength: 200, placeholder: 'e.g. Server restarting in 5 minutes!' });
    page(
      h('div', { class: 'adm-cards', id: 'adm-cards' }),
      h('section', { class: 'panel', style: { marginBottom: '16px' }, id: 'adm-dash' }),
      h('div', { class: 'adm-grid' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, '🎮 Live rooms', h('button', { class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto' }, onclick: refresh, title: 'Refresh', 'aria-label': 'Refresh' }, icon('arrow-clockwise'))), h('div', { id: 'adm-rooms' })),
        h('div', { class: 'col' },
          h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, '📢 Announcement'),
            h('form', { class: 'row', onsubmit: async (e) => {
              e.preventDefault();
              const r = await req('admin:announce', { text: msg.value });
              UI.toast(`📢 Sent to ${r.sent} player${r.sent === 1 ? '' : 's'}`, 'good');
              msg.value = '';
            } }, msg, h('button', { class: 'btn btn-yellow', type: 'submit' }, 'Send')),
            h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'Pops up for everyone on the site right now.')),
          h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, '👀 Online now'), h('div', { id: 'adm-online' })))),
      h('section', { class: 'panel', style: { marginTop: '16px' } }, h('div', { class: 'panel-title' }, '👥 Accounts'), search, h('div', { id: 'adm-users', style: { marginTop: '12px' } })),

      h('section', { class: 'panel adm-help', style: { marginTop: '16px' } }, h('div', { class: 'panel-title' }, '🛠️ Cheats'),
        h('p', { class: 'muted' }, 'Join any online game and press the 🛡️ button in the bottom-left corner for that game’s cheats: free coins in Casino, money and maxed stats in Family Life, god mode in Neon Dash, see the word in Doodle Guess, the answer in Song Rush, and more. Games where you cheat don’t count for anyone’s leaderboards.')),
    );
    refresh();
    findUsers('');
    dashQueue();
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    if (FX.list) FX.list(root.querySelectorAll('.panel'), { y: 24, stagger: 0.08 });
  }

  async function refresh() {
    let o;
    try { o = await Net.request('admin:overview'); } catch (e) {
      if (/admins only/i.test(e.message)) { Account.save({ ...Account.user, admin: false }); mode = null; gate(); }
      return;
    }
    const up = o.uptime < 3600 ? `${Math.round(o.uptime / 60)} min` : `${(o.uptime / 3600).toFixed(1)} h`;
    const local = /^(localhost|127\.|192\.168\.|10\.)/.test(location.hostname);
    const cards = [
      ['🟢', o.clients.length, 'online now'],
      ['👤', o.users, 'accounts'],
      ['🎮', o.rooms.length, 'live rooms'],
      ['⏱️', up, 'server uptime'],
      [o.storage === 'turso' ? '☁️' : '💾', o.storage === 'turso' ? 'Turso' : 'File', o.storage === 'turso' ? 'database (safe)' : 'database'],
    ];
    fill($('#adm-cards'), cards.map(([e, v, l]) => h('div', { class: 'hl' }, h('span', { class: 'e' }, e), h('b', { class: 'v' }, String(v)), h('span', { class: 'l' }, l))),
      o.storage !== 'turso' && !local ? h('div', { class: 'adm-warn' }, '⚠️ Accounts are saved in a file on the server. On Render’s free plan that file is wiped on every restart! Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (see README).') : null);

    fill($('#adm-rooms'), o.rooms.length ? o.rooms.map((r) => {
      const [e, title] = GAMES[r.game] || ['🎲', r.game];
      return h('div', { class: 'adm-room' },
        h('div', { class: 'row' }, h('span', { class: 'e' }, e), h('div', { class: 'grow' }, h('b', {}, title), h('div', { class: 'tiny muted' }, `${r.code} · ${r.phase}${r.tainted ? ' · 🛠️ cheats used' : ''}`)),
          h('a', { class: 'btn btn-lime btn-sm', href: `/games/${r.game}?room=${r.code}` }, 'Join'),
          h('button', { class: 'btn btn-red btn-sm', onclick: async () => {
            if (!await ask(`Close room ${r.code}?`, 'Everyone in it gets sent back to the menu.', [], 'Close room', true)) return;
            await req('admin:room', { code: r.code, action: 'close' }); UI.toast('Room closed', 'good'); refresh();
          } }, 'Close')),
        h('div', { class: 'adm-players' }, r.players.map((p) => h('span', { class: 'adm-chip' + (p.online ? '' : ' off') }, `${p.avatar} ${p.name}`, p.acct ? ' ✔' : '',
          h('button', { class: 'x', title: `Kick ${p.name}`, onclick: async () => {
            if (!await ask(`Kick ${p.name}?`, 'They can’t come back into this room.', [], 'Kick', true)) return;
            await req('admin:room', { code: r.code, action: 'kick', uid: p.id }); UI.toast(`Kicked ${p.name}`, 'good'); refresh();
          } }, icon('x'))))));
    }) : h('p', { class: 'muted small' }, 'No rooms right now.'));

    fill($('#adm-online'), o.clients.length ? h('div', { class: 'adm-online' }, o.clients.map((c) => h('div', { class: 'adm-on' },
      h('span', {}, c.avatar), c.acct ? h('a', { href: '/profile?u=' + encodeURIComponent(c.acct) }, c.name, ' ✔') : h('span', {}, c.name, h('span', { class: 'tiny faint' }, ' guest')),
      c.tabs > 1 ? h('span', { class: 'tiny faint' }, `${c.tabs} tabs`) : null,
      h('span', { class: 'tiny muted', style: { marginLeft: 'auto', textAlign: 'right' } },
        c.where.length ? c.where.map((w) => `${(GAMES[w.game] || ['🎲'])[0]} ${w.room}`).join(' · ') : 'browsing'))))
      : h('p', { class: 'muted small' }, 'Nobody (except you?)'));
  }

  // ------------------------------------------------------------ accounts
  async function findUsers(q) {
    lastQuery = q;
    let r;
    try { r = await Net.request('admin:users', { q }); } catch (e) { return; }
    if (q !== lastQuery) return;
    fill($('#adm-users'), r.users.length ? r.users.map(userRow) : h('p', { class: 'muted small' }, 'No accounts found.'));
  }

  function userRow(u) {
    const btn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Actions', icon('caret-down'));
    btn.onclick = () => UI.menu(btn, actionsFor(u));
    return h('div', { class: 'adm-user' + (u.banned ? ' banned' : '') }, UI.avatar(u),
      h('div', { class: 'grow' }, h('div', {}, h('b', {}, u.name), u.admin ? h('span', { class: 'tag adm' }, '🛡️ admin') : null,
        ROLE_TAGS[u.role] ? h('span', { class: 'tag ' + u.role, title: 'Only admins see this' }, ROLE_TAGS[u.role]) : null, u.banned ? h('span', { class: 'tag ban' }, '🚫 banned') : null),
        h('div', { class: 'tiny muted' }, `Lv ${u.level} · ${u.xp.toLocaleString('en-US')} XP · seen ${UI.timeAgo(u.lastSeen)}`)), btn);
  }

  // Roles an admin can give. Testers and developers get no name tag: only admins show one (🛡️).
  const ROLE_TAGS = { tester: '🧪 tester', developer: '🛠️ developer' };
  const ROLES = [
    ['', '🎮 Player', 'A normal account.'],
    ['tester', '🧪 Tester', 'Sees the update calendar rows that developers share with testers. Can’t change anything.'],
    ['developer', '🛠️ Developer', 'Sees the whole update calendar and can add, change and delete updates. No admin panel, cheats or XP tools.'],
    ['admin', '🛡️ Admin', 'Everything: the admin panel, bans, XP and stat tools, cheats and the update calendar.'],
  ];
  function pickRole(u, done) {
    const now = u.admin ? 'admin' : u.role || '';
    const close = UI.modal(h('div', { class: 'role-pick' }, h('h2', {}, `${u.name}’s role`),
      h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Only admins show a name tag. Testers and developers look like everyone else.'),
      ROLES.map(([key, label, about]) => h('button', { class: 'role-opt' + (key === now ? ' on' : ''), type: 'button', disabled: key === now,
        onclick: () => { close(); done(key, label); } }, h('b', {}, label, key === now ? h('span', { class: 'tiny muted' }, ' · now') : null), h('span', { class: 'small muted' }, about)))));
  }

  function actionsFor(u) {
    const me = Account.user && Account.user.id === u.id;
    const act = async (action, value, done) => {
      await req('admin:user', { name: u.name, action, value });
      UI.toast(done, 'good');
      findUsers(lastQuery);
    };
    return [
      { head: h('b', {}, u.name) },
      { label: '👤 View profile', href: '/profile?u=' + encodeURIComponent(u.name) },
      { label: '✨ Give XP', onClick: async () => { const v = await ask(`Give XP to ${u.name}`, 'Use a minus number to take XP away.', [{ key: 'n', label: 'XP', type: 'number', value: 100 }], 'Give'); if (v) act('xp', Number(v.n), 'XP updated ✨'); } },
      { label: '🎯 Set XP', onClick: async () => { const v = await ask(`Set ${u.name}'s XP`, `Right now: ${u.xp.toLocaleString('en-US')} XP (level ${u.level}).`, [{ key: 'n', label: 'Total XP', type: 'number', value: u.xp }], 'Set XP'); if (v) act('setxp', Number(v.n), 'XP set 🎯'); } },
      { label: '⭐ Set level', onClick: async () => { const v = await ask(`Set ${u.name}'s level`, `Right now: level ${u.level}. Their XP is set to the start of the new level.`, [{ key: 'n', label: 'Level', type: 'number', value: u.level }], 'Set level'); if (v) act('setlevel', Number(v.n), 'Level set ⭐'); } },
      { label: '📊 Set a stat', onClick: async () => {
        const v = await ask(`Set a stat for ${u.name}`, 'Examples: wins, games, dash.wins, life.best, snake.best, casino.best_win', [{ key: 'k', label: 'Stat', placeholder: 'wins' }, { key: 'n', label: 'Value', type: 'number', value: 0 }], 'Set');
        if (v) act('stat', { key: v.k.trim(), value: Number(v.n) }, 'Stat set 📊');
      } },
      me ? null : { label: '🔑 Reset password', onClick: async () => {
        const v = await ask(`New password for ${u.name}`, 'Use this when someone forgot their password. Tell them the new one, and they can change it in their account.', [{ key: 'p', label: 'New password', placeholder: 'At least 6 characters' }], 'Set password');
        if (v) act('password', v.p, `Password changed for ${u.name} 🔑`);
      } },
      me ? null : { label: '🎭 Set role…', onClick: () => pickRole(u, async (role, label) => {
        if (role === 'admin' && !(await ask(`Make ${u.name} an admin?`, 'Admins can ban people, edit stats and use cheats.', [], 'Make admin'))) return;
        act('role', role, `${u.name} is now: ${label}`);
      }) },
      me ? null : { label: '🚪 Log out everywhere', onClick: () => act('logout', null, `${u.name} was logged out`) },
      '-',
      me ? null : (u.banned ? { label: '✅ Unban', onClick: () => act('unban', null, `${u.name} was unbanned`) }
        : { label: '🚫 Ban', danger: true, onClick: async () => { if (await ask(`Ban ${u.name}?`, 'They get logged out and can’t log in or show up on leaderboards.', [], 'Ban', true)) act('ban', null, `${u.name} was banned 🚫`); } }),
      { label: '🧹 Reset stats & XP', danger: true, onClick: async () => { if (await ask(`Reset all of ${u.name}'s stats?`, 'XP, stats and match history go back to zero. This can’t be undone.', [], 'Reset', true)) act('reset', null, 'Stats reset 🧹'); } },
      me ? null : { label: '🗑️ Delete account', danger: true, onClick: async () => {
        const v = await ask(`Delete ${u.name}?`, `Type ${u.name} to confirm. This can’t be undone.`, [{ key: 'n', label: 'Name' }], 'Delete forever', true);
        if (v && v.n === u.name) act('delete', null, 'Account deleted 🗑️'); else if (v) UI.toast('Name didn’t match — nothing deleted.', 'bad');
      } },
    ];
  }

  // ------------------------------------------------------------ Neon Dash community levels
  // New levels wait here until an admin approves them. The preview plays the creator's verify run in
  // the real game (the Neon Dash page in a frame), so you can see the level can be beaten.
  const DASH_TABS = [['pending', '⏳ Pending'], ['approved', '✅ Approved'], ['rejected', '❌ Rejected'], ['unlisted', '🙈 Unlisted']];
  const DASH_THEMES = { easy: ['#0b2f4a', '#0e7490', '#22d3ee'], normal: ['#1e0b3d', '#6d28d9', '#f0abfc'], hard: ['#2b0707', '#9a3412', '#fb923c'], insane: ['#03140b', '#14532d', '#a3e635'] };
  const DASH_MODE = { ship: '#f472b6', ufo: '#fb923c', ball: '#ef4444', wave: '#22d3ee' };
  const DASH_DOT = { '=': '#facc15', _: '#f472b6', o: '#fde047', p: '#f472b6', r: '#ef4444', b: '#60a5fa' };
  let dashTab = 'pending';

  /** A quick picture of a level's start (blocks, spikes, orbs, zones) for the queue. */
  function dashStrip(pv) {
    const c = h('canvas', { class: 'dq-strip' });
    requestAnimationFrame(() => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = r.width || 220, hh = r.height || 70;
      c.width = w * dpr; c.height = hh * dpr;
      const x = c.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [top, bottom, line] = DASH_THEMES[pv.theme] || DASH_THEMES.normal;
      const g = x.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      x.fillStyle = g; x.fillRect(0, 0, w, hh);
      const objs = pv.o || [];
      const first = Math.min(...objs.map((o) => o[1]), ...(pv.z || []).map((z) => z[1]), 1e9);
      const x0 = first < 1e9 ? Math.max(-1.5, first - 3) : -1.5;
      const tall = Math.max(0, ...objs.filter((o) => o[1] < x0 + w / (hh / 6.9)).map((o) => o[2] + 1), ...(pv.z || []).filter((z) => z[1] < x0 + w / (hh / 6.9)).map((z) => z[3]));
      const S = hh / (Math.max(4, Math.min(9, tall + 1.5)) + 0.9), fy = hh - S * 0.9, X = (v) => (v - x0) * S, Y = (v) => fy - v * S;
      for (const [mode, x0, zw, ceil] of pv.z || []) {
        x.fillStyle = DASH_MODE[mode] + '30'; x.fillRect(X(x0), Y(ceil), zw * S, fy - Y(ceil));
        x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(X(x0), 0, zw * S, Y(ceil));
        x.fillStyle = DASH_MODE[mode]; x.fillRect(X(x0), Y(ceil) - 1, zw * S, 2);
      }
      x.lineWidth = 1.2;
      for (const [t, ox, oy] of pv.o || []) {
        const px = X(ox), py = Y(oy + 1);
        if (px > w) continue;
        x.strokeStyle = line;
        if (t === '#') { x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(px, py, S, S); x.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1); }
        else if (t === '^' || t === 'v') {
          x.fillStyle = '#0a0612'; x.beginPath();
          if (t === '^') { x.moveTo(px + S * 0.1, py + S); x.lineTo(px + S / 2, py + S * 0.1); x.lineTo(px + S * 0.9, py + S); }
          else { x.moveTo(px + S * 0.1, py); x.lineTo(px + S / 2, py + S * 0.9); x.lineTo(px + S * 0.9, py); }
          x.closePath(); x.fill(); x.stroke();
        } else { x.strokeStyle = DASH_DOT[t] || '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px + S / 2, py + S / 2, S * 0.3, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1.2; }
      }
      x.fillStyle = '#000'; x.fillRect(0, fy, w, hh - fy);
      x.fillStyle = line; x.fillRect(0, fy - 1, w, 2);
    });
    return c;
  }

  async function dashQueue(tab = dashTab) {
    dashTab = tab;
    const box = $('#adm-dash');
    if (!box) return;
    let r;
    try { r = await Net.request('dash:queue', { status: tab }); } catch (e) { fill(box, h('p', { class: 'muted small' }, e.message)); return; }
    if (dashTab !== tab) return;
    const n = r.counts || {};
    fill(box,
      h('div', { class: 'panel-title' }, '🟪 Dash levels', n.pending ? h('span', { class: 'dq-badge' }, `${n.pending} waiting`) : null,
        h('button', { class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto' }, onclick: () => dashQueue(), title: 'Refresh', 'aria-label': 'Refresh' }, icon('arrow-clockwise'))),
      h('div', { class: 'seg dq-tabs' }, DASH_TABS.map(([id, label]) => h('button', { class: id === tab ? 'on' : '', type: 'button', onclick: () => dashQueue(id) }, `${label}${n[id] ? ` · ${n[id]}` : ''}`))),
      r.levels.length ? h('div', { class: 'dq-list' }, r.levels.map(dashRow))
        : h('p', { class: 'muted small', style: { marginTop: '12px' } }, tab === 'pending' ? 'Nothing to check right now. 🎉' : 'No levels here.'));
  }

  function dashRow(l) {
    const pv = l.preview || {};
    const act = async (action, verb) => {
      let reason = '';
      if (action !== 'approve') {
        const v = await ask(`${verb} “${l.name}”?`, `${l.by.name} sees your reason in My levels (optional).`, [{ key: 'r', label: 'Reason', placeholder: action === 'reject' ? 'e.g. It can’t be beaten without a glitch' : 'e.g. Copied from someone else' }], verb, true);
        if (!v) return;
        reason = v.r;
      }
      await req('dash:review', { id: l.id, action, reason });
      UI.toast(action === 'approve' ? `✅ “${l.name}” is live!` : `Done: ${l.name}`, 'good');
      dashQueue();
    };
    const buttons = {
      pending: [['✅ Approve', 'btn-lime', () => act('approve')], ['❌ Reject', 'btn-red', () => act('reject', 'Reject')]],
      approved: [['🙈 Unlist', 'btn-red', () => act('unlist', 'Unlist')]],
      rejected: [['✅ Approve', 'btn-lime', () => act('approve')]],
      unlisted: [['✅ List again', 'btn-lime', () => act('approve')]],
    }[l.status] || [];
    return h('div', { class: 'dq-row' },
      h('button', { class: 'dq-prev', type: 'button', title: 'Watch the creator’s verify run', onclick: () => dashPreview(l, 'replay', buttons) }, dashStrip(pv), h('span', { class: 'dq-play' }, '▶')),
      h('div', { class: 'grow' },
        h('div', {}, h('b', {}, l.name)),
        h('div', { class: 'tiny muted' }, 'by ', h('a', { href: '/profile?u=' + encodeURIComponent(l.by.name) }, `${l.by.avatar} ${l.by.name}`),
          ` · ${pv.n || 0} objects · ${pv.len || 0} blocks (${Math.round((pv.len || 0) / 10.4)}s) · posted ${UI.timeAgo(l.created)}`),
        l.desc ? h('div', { class: 'tiny', style: { marginTop: '2px' } }, `“${l.desc}”`) : null,
        l.status === 'approved' ? h('div', { class: 'tiny muted' }, `▶ ${l.plays} plays · 👍 ${l.likes}${l.reviewer ? ` · approved by ${l.reviewer}` : ''}`) : null,
        l.reason ? h('div', { class: 'tiny', style: { color: '#fecdd3' } }, `Reason: ${l.reason}`) : null),
      h('div', { class: 'dq-btns' },
        h('button', { class: 'btn btn-cyan btn-sm', onclick: () => dashPreview(l, 'replay', buttons) }, '👀 Watch run'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => dashPreview(l, 'test', buttons) }, '🎮 Test it'),
        buttons.map(([label, cls, fn]) => h('button', { class: `btn ${cls} btn-sm`, onclick: fn }, label))));
  }

  /** The real game in a frame: the creator's verify run ("replay"), or play it yourself ("test"). */
  function dashPreview(l, what, buttons) {
    const src = `/games/dash?${what}=${l.id}&embed=1${what === 'test' ? '&cp=1' : ''}`;
    const frame = h('iframe', { class: 'dq-frame', src, title: `Neon Dash: ${l.name}`, allow: 'autoplay' });
    const close = UI.modal(h('div', {},
      h('h2', {}, what === 'replay' ? `👀 ${l.name}` : `🎮 ${l.name}`),
      h('p', { class: 'muted small', style: { marginBottom: '10px' } }, what === 'replay'
        ? `${l.by.name}’s verify run, played back in the real game. If it reaches the 🏁, the level can be beaten.`
        : 'Play it yourself (with practice checkpoints). Click the game, then Space / click / tap to jump.'),
      frame,
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { frame.src = src; } }, '🔁 Restart'),
        what === 'replay' ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { close(); dashPreview(l, 'test', buttons); } }, '🎮 Test it yourself')
          : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { close(); dashPreview(l, 'replay', buttons); } }, '👀 Watch the run'),
        h('a', { class: 'btn btn-ghost btn-sm', href: src.replace('&embed=1', ''), target: '_blank', rel: 'noopener' }, '↗ New tab'),
        h('div', { style: { flex: 1 } }),
        buttons.map(([label, cls, fn]) => h('button', { class: `btn ${cls} btn-sm`, onclick: () => { close(); fn(); } }, label)))), { wide: true });
    setTimeout(() => frame.focus(), 400);
  }

  on('account', () => { if (mode !== 'admin' || !Account.admin) { mode = null; gate(); } });
  Net.connect();
  Account.ready().then(gate);
})();
