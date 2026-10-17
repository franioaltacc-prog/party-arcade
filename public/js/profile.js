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
    ['Neon Dash', '🟪', '#a855f7', [['Races', 'dash.races'], ['Wins', 'dash.wins'], ['Top 3', 'dash.podiums'], ['Finished', 'dash.finishes'], ['Levels posted', 'dash.levels_posted'], ['Levels approved', 'dash.levels_approved']]],
    ['Family Life', '🏡', '#22c55e', [['Lives', 'life.lives'], ['Wins', 'life.wins'], ['Best score', 'life.best'], ['Oldest', 'life.oldest', (v) => `${v} yrs`], ['Richest', 'life.richest', (v) => PA.fmtMoney(v)]]],
    ['Doodle Guess', '🎨', '#f43f5e', [['Games', 'doodle.games'], ['Wins', 'doodle.wins'], ['Best game', 'doodle.best'], ['Total points', 'doodle.points']]],
    ['Song Rush', '🎧', '#ec4899', [['Games', 'songs.games'], ['Wins', 'songs.wins'], ['Songs named', 'songs.correct'], ['Best game', 'songs.best'], ['Total points', 'songs.points'], ['Perfect games', 'songs.perfect']]],
    ['Screen Volley', '🏐', '#22d3ee', [['Games', 'volley.games'], ['Wins', 'volley.wins'], ['Points scored', 'volley.points'], ['Longest rally', 'volley.best_rally'], ['Best keep-it-up game', 'volley.coop_best', (v) => `${v} passes`]]],
    ['Party Blitz', '⚡', '#facc15', [['Games', 'blitz.games'], ['Wins', 'blitz.wins'], ['Best game', 'blitz.best'], ['Total points', 'blitz.points']]],
    ['Casino Night', '🎰', '#fbbf24', [['Matches', 'casino.games'], ['Wins', 'casino.wins'], ['Biggest win', 'casino.best_win', (v) => `🪙 ${num(v)}`], ['Most coins', 'casino.best_coins', (v) => `🪙 ${num(v)}`]]],
    ['Connect 4', '🔴', '#3b82f6', [['Wins', 'c4.wins'], ['Losses', 'c4.losses'], ['Draws', 'c4.draws']]],
    ['Billiards', '🎱', '#10b981', [['Games', 'pool.games'], ['Wins', 'pool.wins'], ['Losses', 'pool.losses'], ['Frames won', 'pool.frames'], ['Run-outs', 'pool.runs'],
      ['Speed clear best', 'poolspeed.best', secs], ['Wins vs CPU', 'poolcpu.wins']]],
    ['Impostor', '🕵️', '#f43f5e', [['Games', 'impostor.games'], ['Wins', 'impostor.wins'], ['Rounds as impostor', 'impostor.imp_rounds'],
      ['Won as impostor', 'impostor.imp_wins'], ['Survived as impostor', 'impostor.survived'], ['Correct votes', 'impostor.correct_votes']]],
    ['Minesweeper', '💣', '#6366f1', [['Games', 'mines.games'], ['Wins', 'mines.wins'], ['Race boards cleared', 'mines.cleared'], ['Best battle', 'mines.best'],
      ['Solo Easy', 'mines_easy.best', secs], ['Solo Medium', 'mines_medium.best', secs], ['Solo Hard', 'mines_hard.best', secs]]],
    ['Front Wars', '🌍', '#22c55e', [['Games', 'front.games'], ['Wins', 'front.wins'], ['Team wins', 'front.team_wins'], ['Most land', 'front.best', (v) => `${v}%`],
      ['Solo wins vs bots', 'frontsolo.wins'], ['Most bots beaten', 'frontsolo.best']]],
    ['Prop Hunt', '🔫', '#f43f5e', [['Games', 'prophunt.games'], ['Wins', 'prophunt.wins'], ['Total points', 'prophunt.points'], ['Best game', 'prophunt.best'],
      ['Catches as killer', 'prophunt.catches'], ['Caught everyone', 'prophunt.aces'], ['Rounds survived', 'prophunt.survived']]],
    ['Poly Racer', '🏎️', '#0ea5e9', [['Races', 'poly.races'], ['Wins', 'poly.wins'], ['Top 3', 'poly.podiums'], ['🌱 First Lap', 'poly1.best', secs], ['⛰️ Hill Climb', 'poly2.best', secs], ['🌀 Hairpins', 'poly3.best', secs], ['🚀 Big Air', 'poly4.best', secs], ['☁️ Sky Highway', 'poly5.best', secs], ['🌋 Chaos', 'poly6.best', secs]]],
    ['Neon Flappy', '🐤', '#facc15', [['Best score', 'flappy.best'], ['Royale games', 'flappy.games'], ['Royale wins', 'flappy.wins'], ['Best Royale round', 'flappy.best_online']]],
    ['Mini Golf', '⛳', '#4ade80', [['Games', 'golf.games'], ['Wins', 'golf.wins'], ['Holes played', 'golf.holes'], ['Holes in one', 'golf.aces'], ['Best 9 online', 'golf.best', (v) => `${v} strokes`],
      ['⛳ Classic Meadow', 'golfclassic.best', (v) => `${v} strokes`], ['🎃 Spooky Hollow', 'golfspooky.best', (v) => `${v} strokes`], ['Spooky rounds finished', 'golf.spooky_done']]],
    ['Tournaments', '🏆', '#facc15', [['Played', 'tour.played'], ['Won', 'tour.wins']]],
    ['Party mode', '🎉', '#ff4fd8', [['Parties', 'party.games'], ['Party wins', 'party.wins'], ['Party points', 'party.points']]],
    ['Solo arcade', '🕹️', '#22d3ee', [['🐍 Snake best', 'snake.best'], ['🔢 2048 best', '2048.best'], ['🃏 Memory (Normal)', 'memory.best', secs], ['🟦 Dash levels', 'dashsolo.levels'], ['🛝 Slope best', 'slope.best']]],
  ];

  // achievements (and the rewards they unlock) come from /data/unlocks.json, shared with the server

  const GAME_EMOJI = { dash: '🟪', life: '🏡', doodle: '🎨', songs: '🎧', volley: '🏐', blitz: '⚡', connect4: '🔴', billiards: '🎱', poolspeed: '⏱️', poolcpu: '🤖', casino: '🎰', impostor: '🕵️', slope: '🛝', front: '🌍', frontsolo: '🤖', mines: '💣', mines_easy: '💣', mines_medium: '💣', mines_hard: '💣', snake: '🐍', 2048: '🔢', memory: '🃏', dashsolo: '🟦', party: '🎉', prophunt: '🔫', tour: '🏆', poly: '🏎️', poly1: '🏁', poly2: '🏁', poly3: '🏁', poly4: '🏁', poly5: '🏁', poly6: '🏁', flappy: '🐤', golf: '⛳', golfclassic: '⛳', golfspooky: '🎃' };
  const GAME_NAME = { dash: 'Neon Dash', life: 'Family Life', doodle: 'Doodle Guess', songs: 'Song Rush', volley: 'Screen Volley', blitz: 'Party Blitz', connect4: 'Connect 4', billiards: 'Billiards', poolspeed: 'Billiards speed clear', poolcpu: 'Billiards vs CPU', casino: 'Casino Night', impostor: 'Impostor', slope: 'Slope', front: 'Front Wars', frontsolo: 'Front Wars solo', mines: 'Minesweeper', mines_easy: 'Minesweeper Easy', mines_medium: 'Minesweeper Medium', mines_hard: 'Minesweeper Hard', snake: 'Neon Snake', 2048: '2048', memory: 'Memory Flip', dashsolo: 'Dash practice', party: 'Party mode', prophunt: 'Prop Hunt', tour: 'Tournament', poly: 'Poly Racer', poly1: 'Poly Racer · First Lap', poly2: 'Poly Racer · Hill Climb', poly3: 'Poly Racer · Hairpins', poly4: 'Poly Racer · Big Air', poly5: 'Poly Racer · Sky Highway', poly6: 'Poly Racer · Chaos', flappy: 'Neon Flappy', golf: 'Mini Golf', golfclassic: 'Mini Golf · Classic Meadow', golfspooky: 'Mini Golf · Spooky Hollow' };
  const OUTCOME = { win: ['WIN', 'win'], loss: ['LOSS', 'loss'], draw: ['DRAW', 'draw'], play: ['PLAYED', 'play'] };

  function message(emoji, title, text, ...kids) {
    fill(root, h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, emoji), h('h1', {}, title), h('p', { class: 'tagline' }, text), h('div', { class: 'actions' }, kids)));
    if (FX.entry) FX.entry(root.firstChild);
  }

  /** ➕ Add friend / ✓ Friends, and Join / Watch when a friend is in a room. */
  function friendButtons(p) {
    const box = h('div', { class: 'row wrap prof-actions', style: { marginTop: '12px', gap: '8px' } });
    const draw = (state) => {
      const btns = [];
      if (!Account.user) btns.push(h('button', { class: 'btn btn-pink btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, '➕ Add friend'));
      else if (state === 'ok') {
        btns.push(h('span', { class: 'btn btn-ghost btn-sm is-friend' }, '✓ Friends'));
        const r = p.where && p.where.room;
        if (r) {
          if (!r.full) btns.push(h('a', { class: 'btn btn-lime btn-sm', href: PA.Friends.link(r) }, `🎮 Join ${p.name}`));
          btns.push(h('a', { class: 'btn btn-cyan btn-sm', href: PA.Friends.link(r, true) }, '👀 Watch'));
        }
      } else if (state === 'sent') btns.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await PA.Friends.remove(p.name, 'Request cancelled'); draw(null); } }, '⏳ Request sent · cancel'));
      else btns.push(h('button', { class: 'btn btn-pink btn-sm', onclick: async () => {
        try { const r = await PA.Friends.add(p.name); draw(r.state === 'friends' ? 'ok' : 'sent'); } catch (e) { UI.toast(e.message, 'bad'); }
      } }, state === 'incoming' ? '✓ Accept friend request' : '➕ Add friend'));
      fill(box, btns);
    };
    draw(p.friend || null);
    return box;
  }

  function render(p, U, have) {
    const st = p.stats || {};
    const mine = Account.user && Account.user.id === p.id;
    document.title = `${p.name} · Party Arcade`;
    const games = st.games || 0;
    const wins = st.wins || 0;
    const sections = SECTIONS.filter(([, , , items]) => items.some(([, key]) => st[key]));
    const unlocked = U.achievements.filter((a) => have.achievements.has(a.id)).length;
    const rewards = [['✨', 'auras', have.aura.size, U.auras.length], ['🎭', 'animations', have.anim.size, U.anims.length], ['🛝', 'ball skins', have.ball.size, U.balls.length]];

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
            h('a', { class: 'btn btn-yellow btn-sm', href: '/settings#rewards' }, '✨ Wear rewards'),
            h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
            h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await Account.logout(); UI.toast('Logged out 👋'); } }, '🚪 Log out')) : null,
          !mine && !p.banned ? friendButtons(p) : null)),

      h('section', { class: 'prof-highlights' },
        [['🎮', num(games), 'online games'], ['🏆', num(wins), 'wins'], ['📈', games ? Math.round((wins / games) * 100) + '%' : '–', 'win rate'],
          ['🌟', p.rank ? '#' + p.rank : '–', 'XP rank'], ['🎖️', `${unlocked}/${U.achievements.length}`, 'achievements']]
          .map(([e, v, l]) => h('div', { class: 'hl' }, h('span', { class: 'e' }, e), h('b', { class: 'v', 'data-count': v }, v), h('span', { class: 'l' }, l)))),

      h('div', { class: 'prof-grid' },
        h('div', { class: 'prof-main' },
          h('h2', { class: 'prof-h' }, '📊 Game stats'),
          sections.length
            ? h('div', { class: 'prof-games' }, sections.map(([title, emoji, color, items]) => h('div', { class: 'gstat', style: { '--gc': color } },
              h('div', { class: 'gstat-head' }, h('span', { class: 'e' }, emoji), h('b', {}, title)),
              h('div', { class: 'gstat-grid' }, items.map(([label, key, f]) => h('div', {}, h('b', {}, st[key] ? (f ? f(st[key]) : num(st[key])) : '–'), h('span', {}, label)))))))
            : h('p', { class: 'muted panel' }, mine ? 'No games saved yet. Finish an online game and your stats show up here!' : 'No games saved yet.'),
          h('div', { id: 'prof-dash' }),
          h('h2', { class: 'prof-h' }, '🎖️ Achievements'),
          h('div', { class: 'achs' }, U.achievements.filter((a) => !PA.Unlocks.gone(U, a, have.achievements.has(a.id))).map((a) => {
            const ok = have.achievements.has(a.id);
            const ev = a.event && PA.Unlocks.event(U, a.event);
            return h('div', { class: 'ach' + (ok ? ' ok' : '') + (ev ? ' lim' : ''), title: a.desc }, h('span', { class: 'e' }, ok ? a.emoji : '🔒'), h('b', {}, a.name),
              h('span', {}, a.desc, ev ? h('em', { class: 'lim-tag' }, ok ? ` · ${ev.emoji} limited` : ev.active ? ` · ${ev.emoji} until ${ev.last}` : '') : null));
          })),
          h('h2', { class: 'prof-h' }, '🎁 Rewards unlocked'),
          h('div', { class: 'prof-rewards panel' },
            rewards.map(([e, label, n, total]) => h('div', { class: 'pr' }, h('span', { class: 'e' }, e), h('b', {}, `${n}/${total}`), h('span', { class: 'muted small' }, label))),
            h('p', { class: 'tiny muted', style: { gridColumn: '1 / -1', margin: 0 } }, 'Level up and earn achievements to unlock auras, animated avatars and Slope ball skins.',
              mine ? [' ', h('a', { href: '/settings#rewards' }, 'Wear them in Settings →')] : null))),
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

    if (st['dash.levels_approved']) dashLevels(p);
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

  /** Their approved Neon Dash community levels. */
  async function dashLevels(p) {
    let r;
    try { r = await Net.request('dash:list', { by: p.name, sort: 'new' }); } catch { return; }
    const box = $('#prof-dash');
    if (!box || !r.levels.length) return;
    fill(box, h('h2', { class: 'prof-h' }, '🛠️ Neon Dash levels'),
      h('div', { class: 'prof-levels' }, r.levels.map((l) => h('a', { class: 'prof-level', href: `/games/dash?level=${l.id}` },
        h('span', { class: 'e' }, '🟪'),
        h('div', { class: 'grow' }, h('b', {}, l.name), h('div', { class: 'tiny muted' }, `${Math.round((l.preview.len || 0) / 10.4)}s · ▶ ${num(l.plays)} plays · 👍 ${num(l.likes)}`)),
        h('span', { class: 'play' }, '▶')))));
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
      const [{ profile }, U] = await Promise.all([Net.request('profile:get', { name: wanted }), PA.Unlocks.load()]);
      render(profile, U, await PA.Unlocks.of(profile.level, profile.stats || {}));
    } catch (e) {
      message('🤷', 'Player not found', e.message, h('a', { class: 'btn btn-pink btn-lg btn-block', href: '/players?q=' + encodeURIComponent(wanted || '') }, '🔎 Search for players'),
        h('a', { class: 'btn btn-ghost btn-block', href: '/leaderboards' }, '🏆 See the leaderboards'));
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
