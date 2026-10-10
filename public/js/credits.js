/* Credits: who made Party Arcade, plus a movie-style "roll the credits". */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Sfx, icon } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;
  const root = $('#credits');

  UI.topbar({ title: 'Credits', emoji: '🎬' });

  const MAIN = [
    ['🛠️', 'Made by', 'Franio & Claude', '#ff4fd8'],
    ['💡', 'Ideas by', 'Franio, Jan & Claude', '#facc15'],
    ['🎨', 'Design by', 'Claude', '#22d3ee'],
  ];

  const ROLES = [
    ['👑', 'Owner & head admin', 'Franio'],
    ['🎮', 'Game design', 'Franio & Claude'],
    ['💻', 'Programming', 'Claude'],
    ['🌐', 'Server & multiplayer', 'Claude'],
    ['✨', 'Animations', 'Claude (with GSAP)'],
    ['🔊', 'Sound effects', 'Claude — every sound is made live in your browser, no sound files!'],
    ['🖼️', 'Game art & icons', 'Claude — drawn in code with SVG and emoji'],
    ['📝', 'Writing', 'Claude — Family Life events, Impostor words, Would You Rather questions'],
    ['👤', 'Accounts & leaderboards', 'Claude'],
    ['🧪', 'Testing', 'Franio & Claude (and a lot of robot players)'],
    ['🚀', 'Putting it online', 'Franio, with help from Claude'],
  ];

  const GAMES = [
    ['🟪', 'Neon Dash'], ['🏡', 'Family Life'], ['🎨', 'Doodle Guess'], ['🕵️', 'Impostor'], ['💣', 'Minesweeper'],
    ['⚡', 'Party Blitz'], ['🎰', 'Casino Night'], ['🔴', 'Connect 4'], ['🐍', 'Neon Snake'], ['🔢', '2048'],
    ['🃏', 'Memory Flip'], ['🛝', 'Slope'], ['🌍', 'Front Wars'], ['🎡', 'Spin the Wheel'], ['🤔', 'Would You Rather'], ['🎱', 'Magic 8-Ball'],
  ];

  const TOOLS = [
    ['🐍', 'Python', 'the game server'],
    ['🧊', 'three.js', 'the 3D graphics in Slope'],
    ['🟢', 'GSAP by GreenSock', 'animations'],
    ['🔤', 'Bungee by David Jonathan Ross', 'title font (Google Fonts)'],
    ['🔤', 'Fredoka by Milena Brandão', 'text font (Google Fonts)'],
    ['☁️', 'Render', 'hosting'],
    ['🗄️', 'Turso', 'the account database'],
    ['🐙', 'GitHub', 'storing the code'],
    ['🤖', 'Claude by Anthropic', 'the AI that wrote the code with Franio'],
    ['😀', 'Fluent Emoji by Microsoft', '3D emoji (via LobeHub’s CDN)'],
    ['✏️', 'Phosphor Icons', 'button icons'],
  ];

  const INSPIRED = ['Geometry Dash (RobTop Games)', 'BitLife (Candywriter)', 'Pictionary & skribbl.io', 'Spyfall-style "who\'s the impostor?" word games',
    'Classic Minesweeper', 'Slope (by Rob Kay)', 'OpenFront.io', '2048 (Gabriele Cirulli)', 'Snake', 'Connect Four', 'WarioWare-style microgames'];

  function render(players) {
    fill(root,
      h('section', { class: 'page-head' },
        h('h1', { class: 'display' }, 'Credits ', h('span', { class: 'gradient-text' }, '🎬')),
        h('p', { class: 'muted' }, 'The people (and the AI) behind Party Arcade.'),
        h('button', { class: 'btn btn-yellow btn-lg', style: { marginTop: '16px' }, onclick: roll }, '▶ Roll the credits')),

      h('section', { class: 'cr-main' }, MAIN.map(([e, role, who, c]) => h('div', { class: 'cr-big', style: { '--c': c } },
        h('div', { class: 'cr-e' }, e), h('div', { class: 'cr-role' }, role), h('div', { class: 'cr-who' }, who)))),

      h('h2', { class: 'cr-h' }, '🎞️ Everything else'),
      h('section', { class: 'cr-grid' }, ROLES.map(([e, role, who]) => h('div', { class: 'cr-card' },
        h('span', { class: 'cr-e' }, e), h('div', {}, h('div', { class: 'cr-role' }, role), h('div', { class: 'cr-who' }, who))))),

      h('h2', { class: 'cr-h' }, '🕹️ The games'),
      h('section', { class: 'cr-games' }, GAMES.map(([e, name]) => h('span', { class: 'cr-chip' }, e, ' ', name))),
      h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '8px' } }, 'All made by Franio & Claude.'),

      h('h2', { class: 'cr-h' }, '🧰 Built with'),
      h('section', { class: 'cr-grid' }, TOOLS.map(([e, name, what]) => h('div', { class: 'cr-card' },
        h('span', { class: 'cr-e' }, e), h('div', {}, h('div', { class: 'cr-who' }, name), h('div', { class: 'cr-role' }, what))))),

      h('h2', { class: 'cr-h' }, '🌟 Inspired by'),
      h('section', { class: 'cr-games' }, INSPIRED.map((x) => h('span', { class: 'cr-chip' }, x))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '8px' } }, 'Party Arcade is a fan-made project. It isn’t connected to the makers of these games.'),

      h('section', { class: 'cr-thanks panel' },
        h('div', { class: 'cr-e' }, '💜'),
        h('h2', {}, 'Special thanks'),
        h('p', {}, 'To Jan for the ideas, and to everyone who plays with us!'),
        players ? h('p', { class: 'muted' }, `🎉 That’s ${players.toLocaleString('en-US')} player${players === 1 ? '' : 's'} with an account so far.`) : null,
        h('a', { class: 'btn btn-pink', href: '/', style: { marginTop: '12px' } }, '🕹️ Back to the games')));

    if (G) {
      g3d();
      FX.reveal(root.querySelectorAll('.cr-card, .cr-chip, .cr-h, .cr-thanks'));
    }
  }

  function g3d() {
    const cards = root.querySelectorAll('.cr-big');
    G.from(cards, { y: 80, rotationX: -60, autoAlpha: 0, transformPerspective: 900, stagger: 0.15, duration: 0.9, ease: 'back.out(1.6)', delay: 0.2, clearProps: 'transform,opacity,visibility' });
    G.from(root.querySelectorAll('.cr-big .cr-e'), { scale: 0, rotation: -180, stagger: 0.15, duration: 1, ease: 'elastic.out(1, 0.5)', delay: 0.5 });
    FX.tilt(cards, 8);
  }

  // ------------------------------------------------------------ movie-style roll
  function roll() {
    Sfx.play('swoosh');
    const lines = [
      h('div', { class: 'roll-title' }, '🕹️ PARTY ARCADE'),
      h('div', { class: 'roll-sub' }, 'a game website for playing with friends'),
      h('div', { class: 'roll-gap' }),
      ...MAIN.flatMap(([e, role, who]) => [h('div', { class: 'roll-role' }, `${e} ${role}`), h('div', { class: 'roll-who' }, who)]),
      h('div', { class: 'roll-gap' }),
      ...ROLES.flatMap(([e, role, who]) => [h('div', { class: 'roll-role' }, `${e} ${role}`), h('div', { class: 'roll-who small' }, who)]),
      h('div', { class: 'roll-gap' }),
      h('div', { class: 'roll-role' }, '🕹️ Starring'),
      ...GAMES.map(([e, name]) => h('div', { class: 'roll-who small' }, `${e} ${name}`)),
      h('div', { class: 'roll-gap' }),
      h('div', { class: 'roll-role' }, '🧰 Built with'),
      ...TOOLS.map(([e, name]) => h('div', { class: 'roll-who small' }, `${e} ${name}`)),
      h('div', { class: 'roll-gap' }),
      h('div', { class: 'roll-role' }, '💜 Special thanks'),
      h('div', { class: 'roll-who' }, 'Jan & everyone who plays'),
      h('div', { class: 'roll-gap' }),
      h('div', { class: 'roll-title' }, 'THANKS FOR PLAYING! 🎉'),
    ];
    const track = h('div', { class: 'roll-track' }, lines);
    let tween = null;
    const close = () => { if (tween) tween.kill(); overlay.remove(); removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const overlay = h('div', { class: 'roll', role: 'dialog', 'aria-label': 'Credits', onclick: close },
      h('button', { class: 'icon-btn roll-x', 'aria-label': 'Close', onclick: close }, icon('x')), track);
    document.body.append(overlay);
    addEventListener('keydown', onKey);
    if (!G) { track.style.position = 'static'; overlay.style.overflow = 'auto'; return; }
    const height = track.offsetHeight;
    G.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 });
    tween = G.fromTo(track, { y: innerHeight }, {
      y: -height, duration: Math.max(18, height / 75), ease: 'none',
      onComplete: () => { Sfx.play('win'); UI.confetti(200); setTimeout(close, 1500); },
    });
  }

  Net.connect();
  render(null);
  Net.request('players:find', { q: '', sort: 'new' }).then((r) => {
    const p = root.querySelector('.cr-thanks');
    if (p && r.total) p.insertBefore(h('p', { class: 'muted' }, `🎉 That’s ${r.total.toLocaleString('en-US')} player${r.total === 1 ? '' : 's'} with an account so far.`), p.querySelector('a'));
  }).catch(() => {});
})();
