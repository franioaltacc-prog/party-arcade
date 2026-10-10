/* Admin panel. Only admin accounts can use it: the server re-checks every request. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, on } = PA;
  const FX = PA.FX || {};
  const root = $('#admin');
  const GAMES = { dash: ['🟪', 'Neon Dash'], life: ['🏡', 'Family Life'], doodle: ['🎨', 'Doodle Guess'], blitz: ['⚡', 'Party Blitz'], connect4: ['🔴', 'Connect 4'], casino: ['🎰', 'Casino Night'] };
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
      h('div', { class: 'adm-grid' },
        h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, '🎮 Live rooms', h('button', { class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto' }, onclick: refresh }, '🔄')), h('div', { id: 'adm-rooms' })),
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
        h('p', { class: 'muted' }, 'Join any online game and press the 🛡️ button in the bottom-left corner for that game’s cheats: free coins in Casino, money and maxed stats in Family Life, god mode in Neon Dash, see the word in Doodle Guess, and more. Games where you cheat don’t count for anyone’s leaderboards.')),
    );
    refresh();
    findUsers('');
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
          } }, '✕')))));
    }) : h('p', { class: 'muted small' }, 'No rooms right now.'));

    fill($('#adm-online'), o.clients.length ? h('div', { class: 'adm-online' }, o.clients.map((c) => h('div', { class: 'adm-on' },
      h('span', {}, c.avatar), c.acct ? h('a', { href: '/profile?u=' + encodeURIComponent(c.acct) }, c.name, ' ✔') : h('span', {}, c.name, h('span', { class: 'tiny faint' }, ' guest')),
      h('span', { class: 'tiny muted', style: { marginLeft: 'auto' } }, c.room ? `${(GAMES[c.game] || ['🎲'])[0]} ${c.room}` : 'browsing'))))
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
    const btn = h('button', { class: 'btn btn-ghost btn-sm' }, 'Actions ▾');
    btn.onclick = () => UI.menu(btn, actionsFor(u));
    return h('div', { class: 'adm-user' + (u.banned ? ' banned' : '') }, UI.avatar(u),
      h('div', { class: 'grow' }, h('div', {}, h('b', {}, u.name), u.admin ? h('span', { class: 'tag adm' }, '🛡️ admin') : null, u.banned ? h('span', { class: 'tag ban' }, '🚫 banned') : null),
        h('div', { class: 'tiny muted' }, `Lv ${u.level} · ${u.xp.toLocaleString('en-US')} XP · seen ${UI.timeAgo(u.lastSeen)}`)), btn);
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
      { label: '📊 Set a stat', onClick: async () => {
        const v = await ask(`Set a stat for ${u.name}`, 'Examples: wins, games, dash.wins, life.best, snake.best, casino.best_win', [{ key: 'k', label: 'Stat', placeholder: 'wins' }, { key: 'n', label: 'Value', type: 'number', value: 0 }], 'Set');
        if (v) act('stat', { key: v.k.trim(), value: Number(v.n) }, 'Stat set 📊');
      } },
      me ? null : { label: '🔑 Reset password', onClick: async () => {
        const v = await ask(`New password for ${u.name}`, 'Use this when someone forgot their password. Tell them the new one, and they can change it in their account.', [{ key: 'p', label: 'New password', placeholder: 'At least 6 characters' }], 'Set password');
        if (v) act('password', v.p, `Password changed for ${u.name} 🔑`);
      } },
      u.admin ? (me ? null : { label: '⬇️ Remove admin', onClick: () => act('unadmin', null, 'Admin removed') }) : { label: '🛡️ Make admin', onClick: async () => { if (await ask(`Make ${u.name} an admin?`, 'Admins can ban people, edit stats and use cheats.', [], 'Make admin')) act('admin', null, `${u.name} is an admin now`); } },
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

  on('account', () => { if (mode !== 'admin' || !Account.admin) { mode = null; gate(); } });
  Net.connect();
  Account.ready().then(gate);
})();
