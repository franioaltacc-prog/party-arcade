/* What's new: every Party Arcade update, newest first.
   When you release an update: add an entry at the top AND bump VERSION in js/core.js. */
(() => {
  'use strict';
  const { $, h, fill, UI, Net } = PA;
  const FX = PA.FX || {};

  const CHANGELOG = [
    { v: '2.12.0', date: '2026-10-11', emoji: '✨', title: 'Rewards, ball skins and Settings', items: [
      'Unlock rewards by levelling up and earning achievements: 14 glowing auras and 11 animated avatars',
      'Everyone sees your aura and animation in rooms, chat, leaderboards and on your profile',
      '13 ball skins for Slope (glass, disco, soccer, lava, galaxy, Planet Earth, 8-ball and more), with a picker in the Slope menu',
      'New Settings page: sound and music volume, “less motion”, wear your rewards, and your account',
      'Profiles show how many rewards you’ve unlocked',
    ] },
    { v: '2.11.0', date: '2026-10-10', emoji: '⚽', title: 'Neon Dash: much harder ball', items: [
      'New ball parts for Hard and Insane: a lower tunnel, fast spike switches, then pillars with spikes on the other side, so you have to flip at exactly the right moment',
      'Insane now only uses the two hardest ball parts (about 3× tighter timing than before)',
      'Every new part is still checked by the solver bot, so it can always be beaten',
    ] },
    { v: '2.10.0', date: '2026-10-10', emoji: '🔒', title: 'Privacy Policy and this changelog', items: [
      'New Privacy Policy page that explains, in plain English, what the site knows about you and what you can do about it',
      'Links to it on every page, on the sign-up screen and on the guest screen',
      'Version numbers and this “What’s new” page',
      'A clear “Delete my account” button in your account settings',
    ] },
    { v: '2.9.0', date: '2026-10-10', emoji: '🌍', title: 'Front Wars', items: [
      'A brand-new game inspired by OpenFront: grab land, attack your neighbours, build cities, defense posts and missile silos, send boats across the sea and launch nukes',
      'Own 80% of the land (or be the last one standing) to win',
      'Solo against 1–40 bots on easy, medium or hard, with pause and 3× speed',
      'Online with up to 8 friends plus bots: free-for-all, or teams where you pick your side',
      'Random maps every game: continents, islands or one big land, in three sizes',
      'Wins and best land on your profile, two leaderboards and two new achievements',
    ] },
    { v: '2.8.1', date: '2026-10-10', emoji: '🛝', title: 'Slope: bounce sound fix', items: [
      'The bounce sound no longer repeats over and over when you roll fast',
    ] },
    { v: '2.8.0', date: '2026-10-10', emoji: '🛝', title: 'Slope: speed-ups, ramps and music', items: [
      'A bit easier: you speed up slower, steer better, and the track is wider in tight spots',
      'Bright blue speed-up pads that launch you forward',
      'Orange launch ramps that send you flying over gaps and walls of red blocks',
      'A new fast synth music track that gets more intense the faster you go (with a music button)',
      'Fixed: the ball no longer sticks to the top of a ramp, and long jumps don’t count as falling off',
    ] },
    { v: '2.7.0', date: '2026-10-10', emoji: '🟪', title: 'Neon Dash: Geometry Dash-style wave', items: [
      'Wave parts are now zigzag slope corridors, just like in Geometry Dash',
      'The wave flies at exactly 45° so it can ride along the slopes',
      'The ship feels lighter',
    ] },
    { v: '2.6.1', date: '2026-10-10', emoji: '🟪', title: 'Neon Dash: smoother ship', items: [
      'The ship glides instead of wobbling',
      'Fairer Insane ship parts and easier orb jumps',
      'UFO parts no longer lag (the game draws a lot faster)',
    ] },
    { v: '2.6.0', date: '2026-10-10', emoji: '🛝', title: 'Slope arrives', items: [
      'A new solo 3D game: roll down an endless neon track, dodge the red blocks and don’t fall off',
      'Best distance on your profile and the leaderboard, plus the “Downhill legend” achievement',
    ] },
    { v: '2.5.0', date: '2026-10-10', emoji: '🟪', title: 'Neon Dash: ship, UFO, ball and wave', items: [
      'Portals turn you into a ship, UFO, ball or wave, inside tunnels you can’t fly out of',
      'Yellow, pink, red and blue jump orbs, plus new jump pads',
      'Fixed: checkpoints save as soon as you pass the flag',
    ] },
    { v: '2.4.0', date: '2026-10-10', emoji: '🔁', title: 'Rooms survive updates', items: [
      'When the site updates, your room is saved so you and your friends land back in it together',
    ] },
    { v: '2.3.1', date: '2026-10-10', emoji: '⚡', title: 'Faster loading', items: [
      'Pages reuse files your browser already has, so they load faster',
    ] },
    { v: '2.3.0', date: '2026-10-10', emoji: '✨', title: '3D emoji and new icons', items: [
      'Every emoji is now a shiny 3D emoji that looks the same on every device',
      'New icons on buttons and menus',
    ] },
    { v: '2.2.3', date: '2026-10-10', emoji: '💣', title: 'Minesweeper: flag fix', items: [
      'Right-clicking (including Ctrl+click on Macs) always places a flag',
    ] },
    { v: '2.2.2', date: '2026-10-10', emoji: '🛠️', title: 'Little fixes', items: [
      'Menus no longer go off the screen',
      'Tidier “New” badges and buttons',
      'The admin can set someone’s XP or level directly',
    ] },
    { v: '2.2.1', date: '2026-10-10', emoji: '🟢', title: 'Better online counter', items: [
      'The “online” number counts people, not browser tabs',
      'Disconnected players disappear properly',
    ] },
    { v: '2.2.0', date: '2026-10-10', emoji: '💣', title: 'Minesweeper and Credits', items: [
      'Minesweeper: classic solo, plus online Race and Battle modes with friends',
      'A Credits page showing who made Party Arcade, with a movie-style credits roll',
    ] },
    { v: '2.1.0', date: '2026-10-10', emoji: '🕵️', title: 'Impostor and Find players', items: [
      'Impostor: everyone knows the secret word except the impostor. Give clues, argue, and vote!',
      'Search for any player and see their profile',
    ] },
    { v: '2.0.0', date: '2026-10-10', emoji: '👤', title: 'Accounts, XP and leaderboards', items: [
      'Make a free account (just a username and password) or keep playing as a guest',
      'Earn XP and level up, with stats and match history for every game',
      'Leaderboards, public profiles and achievements',
    ] },
    { v: '1.2.0', date: '2026-10-10', emoji: '✨', title: 'Animations everywhere', items: [
      'Smooth animations across the whole site: cards, pop-ups, scoreboards, coin rain and more',
    ] },
    { v: '1.1.1', date: '2026-10-09', emoji: '🏡', title: 'Family Life: trust funds', items: [
      'Babies and toddlers can’t hold money anymore: it goes into a trust fund until they’re 18',
    ] },
    { v: '1.1.0', date: '2026-10-09', emoji: '🏡', title: 'Family Life seasons and heists', items: [
      'Family Life now plays in seasons, with new crimes, crew heists, jail options and seasonal events',
      'Fairer Neon Dash levels',
      'Lobby chat fixes',
    ] },
    { v: '1.0.0', date: '2026-10-09', emoji: '🕹️', title: 'Party Arcade opens!', items: [
      'Online games with friends: Neon Dash, Family Life, Doodle Guess, Party Blitz, Casino Night and Connect 4',
      'Solo games: Neon Snake, 2048 and Memory Flip',
      'Just for fun: Spin the Wheel, Would You Rather and the Magic 8-Ball',
      'Rooms with invite codes, quick play and chat',
    ] },
  ];

  const nice = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  UI.topbar({ title: 'What’s new', emoji: '📜' });
  Net.connect();
  const root = $('#log');
  fill(root,
    h('section', { class: 'page-head' },
      h('h1', { class: 'display' }, 'What’s new ', h('span', { class: 'gradient-text' }, '📜')),
      h('p', { class: 'muted' }, `Every Party Arcade update. You’re on version ${PA.VERSION}.`)),
    h('div', { class: 'cl-list' }, CHANGELOG.map((e, i) => h('article', { class: 'panel cl-entry' + (i === 0 ? ' latest' : '') },
      h('div', { class: 'cl-head' },
        h('span', { class: 'cl-v' }, 'v' + e.v),
        i === 0 ? h('span', { class: 'badge new' }, '✨ Latest') : null,
        h('span', { class: 'cl-date' }, nice(e.date))),
      h('h2', {}, `${e.emoji} ${e.title}`),
      h('ul', {}, e.items.map((x) => h('li', {}, x)))))));
  // one gentle fade-in for the newest updates; everything else is just there, nothing waits for scrolling
  if (FX.on && FX.list) FX.list([...root.querySelectorAll('.page-head, .cl-entry')].slice(0, 4), { y: 10, duration: 0.4, stagger: 0.06 });
})();
