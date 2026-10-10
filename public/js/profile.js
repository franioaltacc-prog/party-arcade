/* Player profile page: /profile?u=Name (no name = your own profile). */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, Profile, on } = PA;
  const FX = PA.FX || {};
  const root = $('#profile');
  let wanted = new URLSearchParams(location.search).get('u');

  UI.topbar({ title: 'Profile', emoji: '👤' });

  const num = (v) => (Number(v) || 0).toLocaleString('en-US');
  const secs = (ms) => (ms ? `${(ms / 1000).toFixed(2)}s` : '–');

  // game sections: [title, emoji, color, [[label, stat key, format]]]
  const SECTIONS = [
    ['Neon Dash', '🟪', '#a855f7', [['Races', 'dash.races'], ['Wins', 'dash.wins'], ['Top 3', 'dash.podiums'], ['Finished', 'dash.finishes']]],
    ['Family Life', '🏡', '#22c55e', [['Lives', 'life.lives'], ['Wins', 'life.wins'], ['Best score', 'life.best'], ['Oldest', 'life.oldest', (v) => `${v} yrs`], ['Richest', 'life.richest', (v) => PA.fmtMoney(v)]]],
    ['Doodle Guess', '🎨', '#f43f5e', [['Games', 'doodle.games'], ['Wins', 'doodle.wins'], ['Best game', 'doodle.best'], ['Total points', 'doodle.points']]],
    ['Party Blitz', '⚡', '#facc15', [['Games', 'blitz.games'], ['Wins', 'blitz.wins'], ['Best game', 'blitz.best'], ['Total points', 'blitz.points']]],
    ['Casino Night', '🎰', '#fbbf24', [['Matches', 'casino.games'], ['Wins', 'casino.wins'], ['Biggest win', 'casino.best_win', (v) => `🪙 ${num(v)}`], ['Most coins', 'casino.best_coins', (v) => `🪙 ${num(v)}`]]],
    ['Connect 4', '🔴', '#3b82f6', [['Wins', 'c4.wins'], ['Losses', 'c4.losses'], ['Draws', 'c4.draws']]],
    ['Solo arcade', '🕹️', '#22d3ee', [['🐍 Snake best', 'snake.best'], ['🔢 2048 best', '2048.best'], ['🃏 Memory (Normal)', 'memory.best', secs], ['🟦 Dash levels', 'dashsolo.levels']]],
  ];

  const ACHIEVEMENTS = [
    ['👋', 'Hello world', 'Finish your first online game', (s) => s.games >= 1],
    ['🏆', 'Winner', 'Win an online game', (s) => s.wins >= 1],
    ['🔥', 'On fire', 'Win 10 games', (s) => s.wins >= 10],
    ['👑', 'Champion', 'Win 50 games', (s) => s.wins >= 50],
    ['🎮', 'Regular', 'Play 25 online games', (s) => s.games >= 25],
    ['🕹️', 'Arcade legend', 'Play 100 online games', (s) => s.games >= 100],
    ['⭐', 'Rising star', 'Reach level 5', (s, u) => u.level >= 5],
    ['🌟', 'Superstar', 'Reach level 15', (s, u) => u.level >= 15],
    ['🟪', 'Speed demon', 'Win a Neon Dash race', (s) => s['dash.wins'] >= 1],
    ['🧓', 'Long life', 'Live to 90 in Family Life', (s) => s['life.oldest'] >= 90],
    ['💰', 'Millionaire', 'Be worth $1,000,000 in Family Life', (s) => s['life.richest'] >= 1e6],
    ['🎨', 'Picasso', 'Win a game of Doodle Guess', (s) => s['doodle.wins'] >= 1],
    ['⚡', 'Lightning', 'Win a game of Party Blitz', (s) => s['blitz.wins'] >= 1],
    ['🎰', 'High roller', 'Win 5,000 coins in one bet', (s) => s['casino.best_win'] >= 5000],
    ['🔴', 'Four in a row', 'Win at Connect 4', (s) => s['c4.wins'] >= 1],
    ['🐍', 'Snake charmer', 'Score 40 in Snake', (s) => s['snake.best'] >= 40],
    ['🔢', 'Tile master', 'Score 20,000 in 2048', (s) => s['2048.best'] >= 20000],
    ['🧠', 'Elephant memory', 'Beat Memory Flip (Normal) in under 30s', (s) => s['memory.best'] > 0 && s['memory.best'] <= 30000],
  ];

  const GAME_EMOJI = { dash: '🟪', life: '🏡', doodle: '🎨', blitz: '⚡', connect4: '🔴', casino: '🎰', snake: '🐍', 2048: '🔢', memory: '🃏', dashsolo: '🟦' };
  const GAME_NAME = { dash: 'Neon Dash', life: 'Family Life', doodle: 'Doodle Guess', blitz: 'Party Blitz', connect4: 'Connect 4', casino: 'Casino Night', snake: 'Neon Snake', 2048: '2048', memory: 'Memory Flip', dashsolo: 'Dash practice' };
  const OUTCOME = { win: ['WIN', 'win'], loss: ['LOSS', 'loss'], draw: ['DRAW', 'draw'], play: ['PLAYED', 'play'] };

  function message(emoji, title, text, ...kids) {
    fill(root, h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, emoji), h('h1', {}, title), h('p', { class: 'tagline' }, text), h('div', { class: 'actions' }, kids)));
    if (FX.entry) FX.entry(root.firstChild);
  }

  function render(p) {
    const st = p.stats || {};
    const mine = Account.user && Account.user.id === p.id;
    document.title = `${p.name} · Party Arcade`;
    const games = st.games || 0;
    const wins = st.wins || 0;
    const sections = SECTIONS.filter(([, , , items]) => items.some(([, key]) => st[key]));
    const unlocked = ACHIEVEMENTS.filter(([, , , test]) => test(st, p)).length;

    fill(root,
      h('section', { class: 'prof-head panel', style: { '--c': p.color } },
        UI.avatar(p, 'xl'),
        h('div', { class: 'prof-id' },
          h('h1', {}, p.name, p.admin ? h('span', { class: 'prof-admin', title: 'Admin' }, '🛡️ Admin') : null, p.banned ? h('span', { class: 'prof-banned' }, '🚫 Banned') : null),
          h('p', { class: 'small ' + (p.online ? 'online-now' : 'muted') }, p.online ? `🟢 Online now${p.playing ? ' · playing ' + p.playing : ''}` : `Last seen ${UI.timeAgo(p.lastSeen)}`,
            h('span', { class: 'muted' }, ` · joined ${new Date(p.created * 1000).toLocaleDateString()}`)),
          p.bio ? h('p', { class: 'prof-bio' }, `“${p.bio}”`) : null,
          UI.xpBar(p),
          mine ? h('div', { class: 'row wrap', style: { marginTop: '12px', gap: '8px' } },
            h('button', { class: 'btn btn-pink btn-sm', onclick: () => Profile.edit() }, '🎨 Edit my look'),
            h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
            h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await Account.logout(); UI.toast('Logged out 👋'); } }, '🚪 Log out')) : null)),

      h('section', { class: 'prof-highlights' },
        [['🎮', num(games), 'online games'], ['🏆', num(wins), 'wins'], ['📈', games ? Math.round((wins / games) * 100) + '%' : '–', 'win rate'],
          ['🌟', p.rank ? '#' + p.rank : '–', 'XP rank'], ['🎖️', `${unlocked}/${ACHIEVEMENTS.length}`, 'achievements']]
          .map(([e, v, l]) => h('div', { class: 'hl' }, h('span', { class: 'e' }, e), h('b', { class: 'v', 'data-count': v }, v), h('span', { class: 'l' }, l)))),

      h('div', { class: 'prof-grid' },
        h('div', { class: 'prof-main' },
          h('h2', { class: 'prof-h' }, '📊 Game stats'),
          sections.length
            ? h('div', { class: 'prof-games' }, sections.map(([title, emoji, color, items]) => h('div', { class: 'gstat', style: { '--gc': color } },
              h('div', { class: 'gstat-head' }, h('span', { class: 'e' }, emoji), h('b', {}, title)),
              h('div', { class: 'gstat-grid' }, items.map(([label, key, f]) => h('div', {}, h('b', {}, st[key] ? (f ? f(st[key]) : num(st[key])) : '–'), h('span', {}, label)))))))
            : h('p', { class: 'muted panel' }, mine ? 'No games saved yet. Finish an online game and your stats show up here!' : 'No games saved yet.'),
          h('h2', { class: 'prof-h' }, '🎖️ Achievements'),
          h('div', { class: 'achs' }, ACHIEVEMENTS.map(([e, title, desc, test]) => {
            const ok = test(st, p);
            return h('div', { class: 'ach' + (ok ? ' ok' : ''), title: desc }, h('span', { class: 'e' }, ok ? e : '🔒'), h('b', {}, title), h('span', {}, desc));
          }))),
        h('aside', { class: 'prof-side' },
          h('h2', { class: 'prof-h' }, '🕘 Recent games'),
          p.recent.length
            ? h('div', { class: 'recent' }, p.recent.map((r) => {
              const [label, cls] = OUTCOME[r.outcome] || OUTCOME.play;
              return h('div', { class: 'rg' }, h('span', { class: 'e' }, GAME_EMOJI[r.game] || '🎮'),
                h('div', { class: 'grow' }, h('div', { class: 'rg-top' }, h('b', {}, GAME_NAME[r.game] || r.game), h('span', { class: 'oc ' + cls }, label)),
                  h('div', { class: 'tiny muted' }, r.detail), h('div', { class: 'tiny faint' }, `${UI.timeAgo(r.ts)} · +${r.xp} XP`)));
            }))
            : h('p', { class: 'muted small panel' }, 'Nothing yet.'))));

    if (FX.on) {
      const g = FX.gsap;
      g.from('.prof-head', { y: 30, autoAlpha: 0, duration: 0.6, ease: 'back.out(1.5)', clearProps: 'transform,opacity,visibility' });
      g.from('.prof-head .avatar', { scale: 0, rotation: -120, duration: 0.9, ease: 'elastic.out(1, 0.5)', delay: 0.1 });
      FX.list(root.querySelectorAll('.prof-highlights .hl'), { y: 24, scale: 0.8, stagger: 0.07, delay: 0.2, ease: 'back.out(2)' });
      FX.reveal(root.querySelectorAll('.gstat, .ach, .rg'));
      const bar = root.querySelector('.xpbar-track i');
      if (bar) g.from(bar, { width: 0, duration: 1.2, ease: 'power3.out', delay: 0.3 });
    }
  }

  async function load() {
    if (!wanted) {
      await Account.ready();
      if (!Account.user) {
        shownFor = null;
        message('👤', 'Your profile', 'Guests don’t have a profile. Make a free account to save your stats, level up and show off!',
          h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Create an account'),
          h('button', { class: 'btn btn-cyan btn-block', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in'));
        return;
      }
      wanted = Account.user.name;
      shownFor = Account.user.id;
    }
    fill(root, h('div', { class: 'lb-empty' }, h('span', { class: 'spin' }, '🌀'), ' Loading…'));
    try {
      const { profile } = await Net.request('profile:get', { name: wanted });
      render(profile);
    } catch (e) {
      message('🤷', 'Player not found', e.message, h('a', { class: 'btn btn-pink btn-lg btn-block', href: '/leaderboards' }, '🏆 See the leaderboards'));
    }
  }

  // viewing your own profile (no ?u=): reload when you log in or out
  let shownFor;
  on('account', (u) => {
    if (new URLSearchParams(location.search).get('u')) return;
    const id = u ? u.id : null;
    if (id === shownFor) return;
    shownFor = id;
    wanted = u ? u.name : null;
    load();
  });
  Net.connect();
  load();
})();
