/* Revvd: the menus. They sit on top of the 3D track, inside the game window (like Cork7): the main menu,
   the time trial tracks, racing online, the room (riders, ready-up, the track and chat), the garage,
   leaderboards and controls, Unrevvd (the mountain bikes: free ride, challenges and the bike shop) and Carvvd (the
   snowboards: free ride on Frostpeak, challenges and your board).
   game.js owns the 3D scene behind them and the ride itself. */
const { h, fill, Net, Sfx, UI, Account, Profile } = PA;
const FX = PA.FX || {};
// each free-ride world's card colour and emoji
const WORLD_LOOK = { redrock: ['red', '🏜️'], pinecrest: ['green', '🌲'], frostpeak: ['blue', '❄️'], golddunes: ['orange', '🌅'], autumnridge: ['red', '🍁'], canyonrun: ['purple', '🏞️'], magmaisle: ['red', '🌋'], emeraldbay: ['blue', '🏝️'],
  wildwood: ['green', '🚵'], sheerwall: ['orange', '🪂'] };
const NEW_WORLDS = ['wildwood', 'sheerwall'];

/** ctx: what the menus need from the game (see game.js). Returns { show, roomUpdate, refresh, onKey, screen }. */
export function createMenus(ctx) {
  const screenEl = document.getElementById('mx-screen');
  const tabsEl = document.getElementById('mx-tabs');
  let screen = null;
  let primary = null;   // what Enter does on this screen
  let back = null;      // what Esc does
  let roomEls = null;   // the room screen's parts (it's updated in place, so typing in the chat isn't interrupted)
  let preview = null;   // the paint job shown on the bike in the garage
  let boardKey = 'moto_desert';
  let garageTab = 'bike';
  let garageVeh = 'bike';   // (the garage: which vehicle you're looking at)
  let shopTab = 'bike';   // (Unrevvd's bike shop)
  let hideResults = null;

  const fmt = ctx.fmt;
  const tracks = () => ctx.DATA.tracks;
  const inRoom = () => !!(window.Room && Room.code);

  // ---------------------------------------------------------------- pieces
  const go = (label, sub, onClick, extra = {}) => h('button', { class: 'mx-go' + (extra.on ? ' on' : '') + (extra.slim ? ' slim' : ''), type: 'button', disabled: !!extra.disabled, onclick: onClick },
    h('b', {}, label, sub ? h('small', {}, sub) : null), extra.key === false ? null : h('span', { class: 'mx-key' }, 'ENTER'), h('span', { class: 'arr' }, '↗'));
  const card2 = (color, ic, title, sub, onClick, extra = {}) => h('button', { class: `mx-card2 ${color}` + (extra.on ? ' on' : '') + (extra.wide ? ' wide' : ''), type: 'button', onclick: onClick },
    h('span', { class: 'ic' }, ic), extra.sticker ? h('span', { class: 'mx-sticker' + (extra.stickerCls ? ' ' + extra.stickerCls : '') }, extra.sticker) : null,
    h('b', {}, title), sub ? h('small', {}, sub) : null);
  const backBtn = (title) => h('button', { class: 'mx-back', type: 'button', onclick: () => back && back() }, '← ', title, h('span', {}, 'ESC'));
  const glass = (title, count, ...kids) => h('div', { class: 'mx-glass' }, title ? h('div', { class: 'mx-h' }, title, count != null ? h('span', { class: 'n' }, count) : null) : null, kids);
  const note = (text) => h('p', { class: 'mx-note' }, text);
  const paint = (id) => {
    const b = ctx.bikeList.find((x) => x.id === id); const lv = ctx.LIVERIES[id] || ctx.LIVERIES.factory;
    return { name: lv.name, c1: b && b.colors ? b.colors[0] : lv.plastic, c2: b && b.colors ? b.colors[1] : lv.accent };
  };
  const medalOf = (t) => { const best = ctx.bestOf(t.id); return best ? ctx.medalFor(t, best.ms / 1000) : -1; };

  function trackCard(t, on, onClick, small) {
    const best = t.robot ? ctx.bestOf(t.id) : null;
    const medal = t.robot ? medalOf(t) : -1;
    return h('button', { class: `mx-tcard ${t.theme || 'random'}` + (on ? ' on' : ''), type: 'button', onclick: onClick, disabled: !onClick, title: t.name },
      h('span', { class: 'e' }, t.emoji), h('b', {}, t.name),
      small ? null : h('span', { class: 'medal' }, medal >= 0 ? ctx.MEDALS[medal][0] : ''),
      small ? null : h('span', { class: 'about' }, t.about),
      small || !t.robot ? null : h('span', { class: 'times' }, h('span', { class: 'best' }, best ? `Best ${fmt(best.ms / 1000)}` : 'Not ridden yet'),
        ctx.medalTimes(t).map((m, i) => h('span', {}, `${ctx.MEDALS[i][0]} ${fmt(m)}`))));
  }

  const KIND = { race: '🏁 Race to the finish', air: '🚀 Longest jump', flips: '🤸 Most flips', speed: '⚡ Top speed', tricks: '🌟 Most trick points', surf: '🏄 Most surf points', lanterns: '🏮 Most lanterns', tag: '🏷️ Tag (rooms only)', relay: '🏮 Team relay (rooms only)' };
  /** A challenge to pick: what it is, where, the goal and (big) your best on this device. */
  const worldName = (c) => (c.daily ? 'A new gully every day' : (ctx.allWorlds.find((w) => w.id === c.world) || {}).name || c.world);
  function challengeChip(c, on, onClick, big) {
    const best = ctx.challengeBest(c.id); const world = worldName(c);
    const medal = c.kind === 'race' ? ctx.Chutes.bestMedal(c.id) : -1;
    return h('button', { class: 'mx-chal' + (on ? ' on' : ''), type: 'button', onclick: onClick, disabled: !onClick, title: c.about },
      h('span', { class: 'e' }, c.emoji, medal >= 0 ? h('i', { class: 'md' }, ctx.Chutes.MEDALS[medal][0]) : null),
      h('span', { class: 'tx' }, h('b', {}, c.name, c.today ? h('i', { class: 'mx-today' + (ctx.Chutes.todayDone(c.id) ? ' done' : '') }, ctx.Chutes.todayDone(c.id) ? '📅 ✔' : '📅 TODAY') : null), h('small', {}, `${world} · ${KIND[c.kind]}${c.kind === 'race' ? '' : ` · ${c.limit}s`}${c.board ? ' · 🏂 Snowboard' : c.vehicle === 'mtb' ? ' · 🚵 MTB' : ''}${c.cam === 'first' ? ' · 👀 First person' : ''}`),
        big ? h('span', { class: 'ab' }, c.about) : null),
      big ? h('span', { class: 'best' }, best != null ? `Best ${ctx.fmtScore(c.kind, best)}` : 'Not tried yet') : null);
  }

  /** A free-ride world to pick for the room. */
  function worldChip(w, on, onClick) {
    const [, e] = WORLD_LOOK[w.id] || ['green', '🗺️'];
    return h('button', { class: 'mx-chal' + (on ? ' on' : ''), type: 'button', onclick: onClick, disabled: !onClick, title: w.name },
      h('span', { class: 'e' }, e), h('span', { class: 'tx' }, h('b', {}, w.name), h('small', {}, `${w.areaKm2.toFixed(1)} km²${w.gaps ? ` · ${w.gaps} gap jumps` : ''}`)));
  }

  /** A shop of upgrades bought with coins from wallet C (Revvd engines, Unrevvd bike parts). */
  function shopPanel(C, title, about, text) {
    const wl = C.wallet();
    const act = (e) => {
      if (wl.owned.includes(e.id)) { C.equip(e.id); Sfx.play('click'); show(screen); return; }
      const r = C.buy(e.id);
      if (r.ok) { Sfx.play('coin'); UI.toast(`${e.emoji} ${e.name} bought and fitted!`, 'good'); if (UI.confetti) UI.confetti(120); } else { Sfx.play('wrong'); UI.toast(r.error, 'bad'); }
      show(screen);
    };
    return glass(title, `🪙 ${wl.coins.toLocaleString('en-US')} coins`,
      h('div', { class: 'mx-shop' }, C.items.map((e) => {
        const own = wl.owned.includes(e.id); const on = wl.engine === e.id;
        return h('div', { class: 'mx-shoprow' + (on ? ' on' : '') },
          h('span', { class: 'e' }, e.emoji),
          h('span', { class: 'tx' }, h('b', {}, e.name), h('small', {}, about(e))),
          h('button', { class: 'mx-sb' + (on ? ' on' : ''), type: 'button', disabled: on || (!own && (wl.coins < e.price || !!(e.lock && e.lock()))), onclick: () => act(e) },
            on ? (e.lamp || e.cam != null ? 'ON' : 'RIDING') : own ? 'Use' : e.lock && e.lock() ? e.lock() : `🪙 ${e.price.toLocaleString('en-US')}`));
      })),
      note(text));
  }

  /** The free-ride worlds (mtb: Unrevvd's, on a mountain bike, its own bike park first). */
  /** The jet ski's colour (Wavvd's menu and the garage). */
  const COLOURS = [['#18b6d6', 'Lagoon'], ['#ff5a36', 'Coral'], ['#ffd23a', 'Sun'], ['#7c4dff', 'Ultra'], ['#16181c', 'Stealth'], ['#2ecc71', 'Reef'], ['#c3cad4', 'Pro', () => (ctx.Career.cleared('pro') ? null : '🔒 Clear the Pro tier in Career')]];
  const jetGlass = (screen) => glass('Your jet ski', 'only looks: they all ride the same', h('div', { class: 'mx-liveries' }, COLOURS.map(([c, n, lock]) => h('button', {
          class: 'mx-livery' + (ctx.jetColor() === c ? ' on' : '') + (lock?.() ? ' locked' : ''), type: 'button', style: { '--c1': c, '--c2': c }, title: lock?.() || n,
          onclick: () => { if (lock?.()) { UI.toast(lock(), 'info', 2500); return; } ctx.prefs.jetColor = c; ctx.savePrefs(); Sfx.play('click'); show(screen); } }, lock?.() ? h('span', { class: 'lk' }, '🔒') : ctx.jetColor() === c ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo', style: { color: c } }, '●'), h('span', {}, n)))));
  /** Carvvd's board and board-or-skis (its menu and the garage). */
  const boardGlasses = (screen) => { const board = ctx.BOARDS[ctx.prefs.board] || Object.values(ctx.BOARDS)[0]; return [
    glass('Your board', 'only looks: they all ride the same', h('div', { class: 'mx-liveries' }, Object.entries(ctx.BOARDS).map(([k, b]) => h('button', {
          class: 'mx-livery' + (k === (ctx.prefs.board || 'ice') ? ' on' : '') + (b.lock?.() ? ' locked' : ''), type: 'button', style: { '--c1': b.color, '--c2': b.color }, title: b.lock?.() || b.name,
          onclick: () => { if (b.lock?.()) { UI.toast(b.lock(), 'info', 2500); return; } ctx.prefs.board = k; ctx.savePrefs(); Sfx.play('click'); show(screen); } },
        k === (ctx.prefs.board || 'ice') && !b.lock?.() ? h('span', { class: 'eq' }, 'ON') : b.lock?.() ? h('span', { class: 'lk' }, '🔒') : null, h('b', { class: 'emo' }, b.emoji), h('span', {}, b.name))))),
    glass('Board or skis', 'the same speed, a different style', h('div', { class: 'mx-liveries' }, [['board', '🏂', 'Snowboard'], ['skis', '⛷️', 'Skis']].map(([k, e, n]) => h('button', {
          class: 'mx-livery' + (ctx.gear() === k ? ' on' : ''), type: 'button', style: { '--c1': board.color, '--c2': board.color }, title: n,
          onclick: () => { ctx.prefs.cgear = k; ctx.savePrefs(); Sfx.play('click'); show(screen); } }, ctx.gear() === k ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo' }, e), h('span', {}, n)))))]; };
  /** The supercar's model and paint (free ride's menu and the garage). */
  const carPickers = (screen) => [
    h('div', { class: 'mx-seg' }, Object.entries(ctx.CAR_MODELS).map(([k, c]) => h('button', { class: 'mx-sb' + ((ctx.prefs.carModel || 'revuelto') === k ? ' on' : ''), type: 'button', title: c.about, onclick: () => { ctx.setCarModel(k); show(screen); } }, c.emoji + ' ' + c.name))),
    ctx.paintable(ctx.prefs.carModel || 'revuelto') ? h('div', { class: 'mx-paints' }, Object.entries(ctx.CAR_PAINTS).map(([k, p]) => h('button', { class: 'mx-paint' + (ctx.prefs.carPaint === k ? ' on' : ''), type: 'button', title: p.name, 'aria-label': p.name, style: { '--c': p.color }, onclick: () => { ctx.setCarPaint(k); show(screen); } }))) : null];
  /** Which mode's menu a challenge is in. */
  const modeOf = (c) => (c.water ? 'water' : c.board ? 'snow' : c.vehicle || 'bike');
  /** The newer vv modes: their name, logo, colour, the worlds they ride and how to drive. */
  const NEWER = {
    sled: { name: 'Sledvvd', logo: ['SLED', 'VV', 'D'], tag: 'Snowmobiles · deep snow · climb anything', emoji: '🛷', cls: 'sled',
      worlds: ['frostpeak', 'powderpeak', 'twilight'], colours: [['#ff5a1f', 'Blaze'], ['#ffd23a', 'Arctic Sun'], ['#2a7fff', 'Glacier'], ['#16181c', 'Black Ice'], ['#7dff3a', 'Toxic'], ['#e8e9ec', 'White-out']],
      pref: 'sledColor', colour: () => ctx.sledColor(),
      how: 'W is the throttle, A / D steer, S brakes. It pulls hard from low down, so point it up any slope you like: it climbs where a bike can’t. Q / E lean and flip in the air, Space / Shift turbo. Sledvvd shares Revvd’s coins.' },
    buggy: { name: 'Drivvd', logo: ['DRI', 'VV', 'D'], tag: 'Rally buggies · long travel · flat out off-road', emoji: '🚙', cls: 'buggy',
      worlds: ['golddunes', 'redrock', 'canyonrun'], colours: Object.entries(ctx.CAR_PAINTS).map(([k, p]) => [k, p.name, p.color]),
      pref: 'buggyPaint', colour: () => ctx.buggyPaint(),
      how: 'W / S drive and brake, A / D steer, Q is the handbrake (slide it round the turns). The long springs soak up the bumps and jumps, and it grips off the trails better than the supercar. Space turbo, Q / E tip the nose in the air. Drivvd shares Revvd’s coins.' },
    wing: { name: 'Skyvvd', logo: ['SKY', 'VV', 'D'], tag: 'Wingsuits · out of the helicopter · fly the mountains', emoji: '🪂', cls: 'sky',
      worlds: ['powderpeak', 'frostpeak', 'sheerwall'], colours: [['#ff4fa3', 'Flamingo'], ['#ff6a00', 'Blaze'], ['#ffd23a', 'Sun'], ['#2a7fff', 'Sky'], ['#7dff3a', 'Toxic'], ['#16181c', 'Night']],
      pref: 'wingColor', colour: () => ctx.wingColor(),
      how: 'The helicopter drops you over the highest point. W tips you into a dive (faster, steeper), S flares (flatter, slower: too slow and you stall), A / D bank and turn. Fly low over the ground at speed for proximity points and coins. Space pulls the parachute: steer it in and land. Touch the ground in the wingsuit and you crash. R: back up in the helicopter.' },
    skate: { name: 'Grindvvd', logo: ['GRIN', 'VV', 'D'], tag: 'Skateboards · rails · halfpipe · tricks', emoji: '🛹', cls: 'grind',
      worlds: ['skateplaza', 'wildwood', 'frostpeak'], colours: [['#ff4fa3', 'Bubblegum'], ['#c8a27a', 'Maple'], ['#2a7fff', 'Ocean'], ['#7dff3a', 'Slime'], ['#ffd23a', 'Banana'], ['#16181c', 'Blackout']],
      pref: 'skateColor', colour: () => ctx.skateColor(),
      how: 'W pushes, A / D carve, S drags a foot to slow down. Ride up onto a rail or box to grind it. In the air: Q / E flip, X spins, 1–6 for kickflips, heelflips, shuv-its and grabs. Land trick after trick for a combo. Grindvvd shares Revvd’s coins.' },
  };
  /** Every mode (the Modes tab): its menu, emoji, name, what it is, and whether it's new. */
  const MODES = [['mtb', '🚵', 'Unrevvd', 'Mountain bikes · downhill chutes · a bike park'], ['snow', '🏂', 'Carvvd', 'Snowboards and skis · resorts · halfpipe'],
    ['water', '🌊', 'Wavvd', 'Jet skis · wakeboarding · surfing'], ['sled', '🛷', 'Sledvvd', 'Snowmobiles · climb anything', true],
    ['buggy', '🚙', 'Drivvd', 'Rally buggies · desert stages', true], ['wing', '🪂', 'Skyvvd', 'Wingsuits · rings in the sky · parachutes', true],
    ['skate', '🛹', 'Grindvvd', 'Skateboards · rails · halfpipe', true]];
  /** A newer mode's paint picker (in the garage). */
  const paintGlass = (mode, screen) => { const M = NEWER[mode]; return glass('Your paint', 'only looks', h('div', { class: 'mx-liveries' }, M.colours.map(([c, n, sw = c]) => h('button', {
        class: 'mx-livery' + (M.colour() === c ? ' on' : ''), type: 'button', style: { '--c1': sw, '--c2': sw }, title: n,
        onclick: () => { ctx.prefs[M.pref] = c; ctx.savePrefs(); Sfx.play('click'); show(screen); } }, M.colour() === c ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo', style: { color: sw } }, '●'), h('span', {}, n))))); };
  /** One line on a mode's menu: your colour, and a link to change it in the garage. */
  const looksLink = (veh, color, label) => h('button', { class: 'mx-looks', type: 'button', onclick: () => { garageVeh = veh; Sfx.play('click'); show('garage'); } },
    h('i', { style: { background: color } }), h('span', {}, label), h('b', {}, '🎨 Change it in the Garage ↗'));
  /** A newer mode's menu: free ride on its worlds, its challenges, its colour. */
  function newerHub(mode) {
    const M = NEWER[mode]; back = () => show('modes');
    const worlds = M.worlds.map((id) => ctx.allWorlds.find((w) => w.id === id)).filter(Boolean);
    const chs = ctx.challenges.filter((c) => modeOf(c) === mode);
    const ride = (w) => w && ctx.startVehFree(w, mode);
    primary = () => ride(worlds[0]);
    return h('div', { class: 'mx-col' },
      h('div', { class: 'mx-unrevvd ' + M.cls }, h('b', {}, M.logo[0], h('i', {}, M.logo[1]), M.logo[2]), h('small', {}, M.tag)),
      h('div', { class: 'mx-two' },
        card2('blue', M.emoji, 'Free ride', `${worlds[0]?.name || ''}: the whole map`, () => ride(worlds[0]), { sticker: 'NEW' }),
        card2('orange', '🎯', 'Challenges', `${chs.length} to ride · medals and coins`, () => show(mode + 'challenges'), { sticker: 'NEW' })),
      ...worlds.slice(1).map((w, i) => card2(i ? 'green' : 'purple', (WORLD_LOOK[w.id] || [])[1] || '🗺️', w.name, `Free ride on ${w.name}`, () => ride(w), { wide: true })),
      go(`Ride ${worlds[0]?.name.split(' ')[0] || ''}`, M.name, () => ride(worlds[0])),
      looksLink(mode, M.colour(), `Your ${M.name} paint`),
      skyGlass(mode),
      note(M.how));
  }
  /** The sky for free ride (any world, any vehicle): day, sunset, night, fog or a storm. */
  const skyGlass = (screen) => h('div', { class: 'mx-skyrow' }, h('span', { class: 'mx-lab' }, 'SKY'), h('div', { class: 'mx-seg' }, Object.entries(ctx.SKIES).map(([k, w]) => h('button', {
    class: 'mx-sb' + ((ctx.prefs.sky || 'day') === k ? ' on' : ''), type: 'button', title: `${w.name} (free ride on any world)`,
    onclick: () => { ctx.prefs.sky = k; ctx.savePrefs(); Sfx.play('click'); show(screen); } }, `${w.emoji} ${w.name}`))));
  function worldsScreen(mtb) {
    back = () => show(mtb ? 'mtb' : 'home');
    const list = mtb ? [...ctx.worlds].sort((a, b) => (b.bike ? 1 : 0) - (a.bike ? 1 : 0)) : ctx.worlds;
    const sel = list.find((w) => w.id === (mtb ? ctx.prefs.mtbWorld : ctx.prefs.world)) || list[0];
    const start = (w) => (mtb ? ctx.startMtbFree(w) : ctx.startFree(w));
    primary = () => sel && start(sel);
    const C = mtb ? ctx.Coins.MTB : ctx.Coins; const wl = C.wallet(); const eng = C.current ? C.current(wl.engine) : C.engineOf(wl.engine);
    const bike = mtb ? ctx.MTB_MODELS[ctx.prefs.mtbModel] || Object.values(ctx.MTB_MODELS)[0] : null;
    const what = (w) => [`${w.areaKm2.toFixed(1)} km²`, w.gaps ? `${w.gaps} gap jump${w.gaps === 1 ? '' : 's'}` : null, w.pools ? `${w.pools} pool${w.pools === 1 ? '' : 's'}` : null, w.bike ? 'bike park' : '4 mini races'].filter(Boolean).join(' · ');
    return h('div', { class: 'mx-col wide' }, backBtn(mtb ? 'Unrevvd free ride' : 'Free ride'),
      h('div', { class: 'mx-ticket' }, h('div', { class: 'grow' }, h('span', { class: 'lab' }, mtb ? 'Your mountain bike' : 'Your free-ride bike'),
        h('div', { class: 'nm' }, h('small', {}, '🪙 ' + wl.coins.toLocaleString('en-US') + ' COINS'), h('b', {}, mtb ? `${bike.emoji} ${bike.name} · ${eng.emoji} ${eng.name}` : `${eng.emoji} ${eng.name}`)),
        h('div', { class: 'acts' }, h('button', { class: 'mx-link', type: 'button', onclick: () => { if (mtb) { shopTab = 'parts'; show('mtbgarage'); } else { garageTab = 'engine'; show('garage'); } } }, mtb ? '⚡ Upgrade your bike ↗' : '⚡ Upgrade the engine ↗'),
          sel ? h('button', { class: 'mx-link', type: 'button', title: 'Make a room: everyone rides the same world, and friends can join any time', onclick: async () => { ctx.rideWithFriends(sel, mtb ? 'mtb' : null); await create(); } }, `📡 Ride ${sel.name.split(' ')[0]} with friends ↗`) : null)), h('span', { class: 'mx-barcode' })),
      // ride the bike or the supercar (Revvd's free ride on your own only)
      mtb ? null : h('div', { class: 'mx-vehicle' },
        h('div', { class: 'mx-seg' }, [['bike', '🏍️ Dirt bike'], ['car', '🏎️ Supercar']].map(([k, label]) => h('button', { class: 'mx-sb' + ((ctx.prefs.vehicle === 'car' ? 'car' : 'bike') === k ? ' on' : ''), type: 'button', onclick: () => { ctx.setVehicle(k); show('worlds'); } }, label))),
        ...(ctx.prefs.vehicle === 'car' ? carPickers('worlds') : []),
        h('small', {}, ctx.prefs.vehicle === 'car' ? 'W/S drive · A/D steer · Q handbrake (drift) · Space turbo · Q/E tip the nose in the air' : 'Challenges and races always use the bike')),
      // all the worlds at once, in a grid (no scrolling down a long list)
      h('div', { class: 'mx-wgrid' }, list.map((w) => { const [c, e] = WORLD_LOOK[w.id] || ['green', '🗺️'];
        return card2(c, e, w.name, what(w), () => start(w), { on: w === sel, sticker: w === sel ? 'LAST RIDDEN' : NEW_WORLDS.includes(w.id) ? 'NEW' : null, stickerCls: w === sel ? 'dark' : null }); })),
      skyGlass(mtb ? 'mtbworlds' : 'worlds'),
      note(mtb ? 'Every world is rideable on a mountain bike: the Wildwood Bike Park is made for it. Climb, then fly down. Grab the gold coins and land flips for Unrevvd coins, and the flag button starts a mini race. R returns to a safe pad, M opens the map (pick a place to fast-travel up the hill).'
        : 'Grab the gold coins on the trails and over the jumps, land flips and finish mini races to earn coins, then buy faster engines in the garage (free ride only). Space / Shift for turbo, R returns to a safe pad, the flag button starts a mini race.'));
  }

  /** A leaderboard's top ten (and where you are), in a pop-up. */
  async function leaderboard(key, title) {
    const body = h('div', { class: 'mx-lb' }, h('p', { class: 'muted' }, 'Loading…'));
    UI.modal(h('div', {}, h('h2', {}, title), body));
    try {
      const { board } = await Net.request('lb:get', { board: key });
      const row = (r) => h('div', { class: 'mx-lbrow' + (r.me ? ' me' : '') }, h('span', { class: 'rk' }, `#${r.rank}`), h('span', { class: 'nm' }, `${r.avatar || ''} ${r.name}`), h('span', { class: 'tm' }, ctx.fmt(r.value / 1000)));
      fill(body, board.rows.length ? board.rows.slice(0, 10).map(row) : h('p', { class: 'muted' }, 'Nobody yet: be the first!'),
        board.me && board.me.rank > 10 ? row({ rank: board.me.rank, name: 'You', value: board.me.value, me: true }) : null,
        PA.Account.user ? null : h('p', { class: 'small muted' }, 'Log in to put your times on the leaderboards.'));
    } catch (e) { fill(body, h('p', { class: 'muted' }, 'The leaderboard couldn’t load. Try again in a moment.')); }
  }

  /** The challenges of a mode: 'bike' (Revvd's), 'mtb' (Unrevvd's, on mountain bikes) or 'snow' (Carvvd's, on snowboards). */
  function challengesScreen(mode) {
    const water = mode === 'water'; const snow = mode === 'snow'; const un = mode === 'mtb'; const mtb = un || snow; const newer = NEWER[mode];
    back = () => show(mode === 'bike' ? 'home' : mode);
    const list = ctx.challenges.filter((c) => modeOf(c) === mode && !c.room);
    const tdy = ctx.Chutes.todaysChallenge(list); if (tdy) list.splice(list.indexOf(tdy), 1, { ...tdy, today: true });   // (today's challenge: a bonus once a day)
    if (un) list.unshift(ctx.Chutes.dailyChallenge());   // (today's Daily Chute first)
    const weekly = water || newer ? null : ctx.Chutes.weeklyChallenge(ctx.challenges); if (weekly) list.unshift(weekly);   // (and this week's challenge before that, in every mode but Wavvd's)
    if (!list.length) return h('div', { class: 'mx-col' }, backBtn('Challenges'), note('The challenges couldn’t load. Try again in a moment.'));
    const key = mode === 'bike' ? 'challenge' : mode + 'Challenge';
    const sel = list.find((c) => c.id === ctx.prefs[key]) || list[0];
    const pick = (c) => { if (c === sel) { ctx.startChallengeSolo(c); return; } ctx.prefs[key] = c.id; ctx.savePrefs(); Sfx.play('click'); show(screen); };
    primary = () => ctx.startChallengeSolo(sel);
    const friends = async () => { ctx.challengeFriends(sel); await create(); };
    // the picked challenge (and its buttons) beside a compact grid of all of them
    const best = ctx.challengeBest(sel.id); const world = worldName(sel);
    const times = sel.kind === 'race' ? ctx.Chutes.medalTimes(sel) : null; const won = times ? ctx.Chutes.bestMedal(sel.id) : -1;
    const board = sel.kind === 'race' ? (sel.daily ? 'mch_daily' : sel.weekly ? 'mch_weekly' : 'mch_' + sel.id) : null;
    const ghosts = () => { ctx.prefs.ghosts = ctx.prefs.ghosts === 'off' ? 'on' : 'off'; ctx.savePrefs(); Sfx.play('click'); show(screen); };
    const trail = ctx.Chutes.trailStats(); const cupBest = PA.store.get('moto_cup_best', null);
    const tag = ctx.challenges.find((c) => c.kind === 'tag'); const relay = ctx.challenges.find((c) => c.kind === 'relay');
    return h('div', { class: 'mx-col wide' },
      backBtn(newer ? `${newer.name} challenges` : water ? 'Wavvd challenges' : snow ? 'Carvvd challenges' : mtb ? 'Unrevvd challenges' : 'Challenges'),
      h('div', { class: 'mx-chsplit' },
        h('div', { class: 'mx-chpick' },
          h('div', { class: 'mx-glass mx-chdetail' },
            h('span', { class: 'e' }, sel.emoji), h('b', {}, sel.name),
            h('small', {}, `${world} · ${KIND[sel.kind]}${sel.kind === 'race' ? '' : ` · ${sel.limit} s`}${sel.cam === 'first' ? ' · 👀 First person' : ''}`),
            h('p', {}, sel.about),
            sel.today ? h('span', { class: 'best' }, ctx.Chutes.todayDone(sel.id) ? '📅 Today’s challenge: bonus collected, a new one tomorrow' : '📅 Today’s challenge: finish it for +150 bonus coins') : null,
            h('span', { class: 'best' }, best != null ? `Your best: ${ctx.fmtScore(sel.kind, best)}` : 'Not tried yet'),
            times ? h('span', { class: 'mx-medals' }, times.map((t, i) => h('span', { class: i === won ? 'won' : '' }, `${ctx.Chutes.MEDALS[i][0]} ${ctx.fmt(t)}`))) : null,
            board ? h('span', { class: 'mx-chbtns' },
              h('button', { class: 'mx-pill', type: 'button', onclick: () => leaderboard(board, `${sel.emoji} ${sel.name}`) }, '🏆 Leaderboard'),
              h('button', { class: 'mx-pill', type: 'button', onclick: ghosts }, ctx.prefs.ghosts === 'off' ? '👻 Ghosts: off' : '👻 Ghosts: on')) : null),
          go('Ride it solo', board ? 'Race your ghost, earn coins and medals' : 'Beat your best, earn coins', () => ctx.startChallengeSolo(sel)),
          sel.daily || sel.weekly ? null : card2('purple', '📡', 'Challenge friends', 'Make a room: everyone rides it at the same time', friends, { wide: true }),
          un ? card2('gold', '🏆', 'Downhill World Cup', `Five chutes back to back · ${cupBest ? 'best ' + ctx.fmt(cupBest / 1000) : 'not finished yet'}`, () => ctx.startCup(), { wide: true }) : null,
          un ? h('button', { class: 'mx-pill wide', type: 'button', onclick: () => leaderboard('mch_cup', '🏆 Downhill World Cup') }, '🏆 World Cup leaderboard') : null,
          un && tag ? card2('red', '🏷️', 'Forest Tag', 'Make a room and play tag in the woods with your friends', async () => { ctx.challengeFriends(tag); await create(); }, { wide: true }) : null,
          un && relay ? card2('orange', '🏮', 'Lantern Relay', 'Two teams pass a lantern down the Midnight Chute: make a room', async () => { ctx.challengeFriends(relay); await create(); }, { wide: true }) : null,
          un ? h('div', { class: 'mx-glass mx-trail' }, h('b', {}, '🌲 Your trail stats'),
            h('span', {}, `${(trail.m / 1000).toFixed(1)} km ridden`), h('span', {}, `${trail.dodged} trees dodged`), h('span', {}, `${trail.close} close calls`),
            h('span', {}, `${Math.round(trail.clean)} m longest clean run`), h('span', {}, `${trail.runs} chutes finished`)) : null),
        h('div', { class: 'mx-chlist grid' }, list.map((c) => challengeChip(c, c === sel, () => pick(c), false)))),
      note(newer ? `Everyone rides the same in ${newer.name} challenges, so it’s fair. ${mode === 'wing' ? 'Crash and the helicopter takes you back to the start (the clock keeps going).' : 'Crash and you go back to where you last were on your wheels.'}`
        : water ? 'Everyone rides the same jet ski in Wavvd challenges. Crash and you go back to where you last were on the water.'
        : snow ? 'Everyone rides the same board in Carvvd challenges: no pedals, it’s all gravity. Crash and you go back to where you last were on your feet.'
        : mtb ? 'Everyone rides with stock legs in Unrevvd challenges, so it’s fair. Crash and you go back to where you last were on your wheels.'
        : 'Everyone rides the stock engine in challenges, so it’s fair. Crash and you go back to where you last were on your wheels.'));
  }

  // ---------------------------------------------------------------- screens
  const SCREENS = {
    home() {
      const mode = ctx.prefs.mode === 'online' ? 'online' : 'solo';
      const next = () => show(mode === 'solo' ? 'tracks' : 'online');
      // pick a mode; tapping the picked one again goes on
      const pick = (m) => { if (m === mode) { next(); return; } ctx.prefs.mode = m; ctx.savePrefs(); Sfx.play('click'); show('home'); };
      primary = next;
      const have = ctx.bikeList.filter((b) => ctx.unlocked.has(b.id)).length;
      return h('div', { class: 'mx-col' },
        h('div', { class: 'mx-two' },
          card2('blue', '👤', 'Solo', 'Time trial · 3 tracks · medals', () => pick('solo'), { on: mode === 'solo', sticker: mode === 'solo' ? '✔ PICKED' : null }),
          card2('purple', '📡', 'Online', 'Race 2–6 riders with a code', () => pick('online'), { on: mode === 'online', sticker: mode === 'online' ? '✔ PICKED' : null })),
        h('div', { class: 'mx-two' },
          card2('green', '🗺️', 'Free ride', `${ctx.worlds.length || 6} huge worlds · collect coins · faster engines`, () => show('worlds'), { sticker: `🪙 ${ctx.Coins.wallet().coins.toLocaleString('en-US')}`, stickerCls: 'dark' }),
          card2('orange', '🎯', 'Challenges', 'Downhill, big air, flips · solo or with friends', () => show('challenges'), { sticker: 'NEW' })),
        licence(),
        h('div', { class: 'mx-two' },
          card2('blue', '🧭', 'More modes', 'Mountain bikes, snowboards, jet skis, snowmobiles, buggies, wingsuits, skateboards', () => show('modes'), { sticker: 'NEW' }),
          card2('purple', '🎖️', 'Career', 'Rookie to Legend: events in every mode, rewards for each tier', () => show('career'), { sticker: 'NEW' })),
        go(mode === 'solo' ? 'Ride' : 'Race', mode === 'solo' ? 'Pick a track' : 'Make a room or join friends', next),
        card2('green', '🏍️', 'Garage', `${Object.keys(ctx.MODELS).length} bikes · ${Object.keys(ctx.KITS).length - 1} rider kits · ${have} / ${ctx.bikeList.length || 1} paint jobs`, () => show('garage'), { wide: true, sticker: (ctx.MODELS[ctx.style.model] || {}).name || paint(ctx.myLivery()).name, stickerCls: 'dark' }));
    },

    /** Every vv mode on one screen (one tab instead of one each). */
    modes() {
      back = () => show('home');
      const cols = ['green', 'blue', 'orange', 'purple'];
      return h('div', { class: 'mx-col wide' }, backBtn('Modes'),
        h('div', { class: 'mx-wgrid' }, MODES.map(([k, e, name, about, fresh], i) => card2(cols[i % cols.length], e, name, about, () => show(k), { sticker: fresh ? 'NEW' : null }))),
        note('Revvd (dirt bikes and the supercar) is on the Ride tab. Every mode has its own free ride, challenges and looks; they all count towards your Career.'));
    },

    /** Career: every vv mode in four tiers, Rookie to Legend (career.js). */
    career() {
      back = () => show('home');
      const rows = ctx.Career.career(ctx.challenges, { best: ctx.challengeBest, medal: ctx.Chutes.bestMedal, fmtScore: ctx.fmtScore, medalTimes: ctx.Chutes.medalTimes });
      const won = ctx.Career.claim(rows); if (won.length) setTimeout(() => ctx.careerReward(won), 60);
      const mode = (c) => (c.water ? '🌊 Wavvd' : c.board ? '🏂 Carvvd' : c.vehicle === 'mtb' ? '🚵 Unrevvd' : c.vehicle === 'sled' ? '🛷 Sledvvd' : c.vehicle === 'buggy' ? '🚙 Drivvd' : c.vehicle === 'skate' ? '🛹 Grindvvd' : c.vehicle === 'wing' ? '🪂 Skyvvd' : '🏍️ Revvd');
      const next = rows.find((r) => r.open && !r.cleared);
      primary = () => { const e = next?.events.find((x) => !x.done); if (e) ctx.startChallengeSolo(e.c); };
      return h('div', { class: 'mx-col wide' }, backBtn('Career'),
        h('div', { class: 'mx-unrevvd car' }, h('b', {}, 'CA', h('i', {}, 'REE'), 'R'), h('small', {}, next ? `${next.emoji} ${next.name}: ${next.got} / ${next.need} done` : '🏆 Legend: every tier cleared')),
        ...rows.map((r) => glass(`${r.emoji} ${r.name}`, r.cleared ? '✔ cleared' : r.open ? `${r.got} / ${r.need} to clear` : '🔒 clear the tier before',
          h('div', { class: 'mx-chlist' }, r.events.map((e) => h('button', { class: 'mx-chal' + (e.done ? ' on' : ''), type: 'button', disabled: !r.open, title: e.c.about, onclick: () => ctx.startChallengeSolo(e.c) },
            h('span', { class: 'e' }, e.c.emoji, e.done ? h('i', { class: 'md' }, '✔') : null),
            h('span', { class: 'tx' }, h('b', {}, e.c.name), h('small', {}, `${mode(e.c)} · ${e.text}`))))),
          note(`Reward: 🪙 ${r.coins} in Revvd and in Unrevvd${r.unlock ? `, and ${r.unlock}` : ''}${r.claimed ? ' · collected ✔' : ''}`))),
        note('Your medals and bests in the challenges count (on this device), so what you’ve already done is there. Clear enough of a tier’s events and the next one opens.'));
    },

    tracks() {
      const list = tracks();
      let sel = list.find((t) => t.id === ctx.prefs.track) || list[0];
      const pick = (t) => { if (t === sel) { ctx.startSolo(t); return; } ctx.prefs.track = t.id; ctx.savePrefs(); Sfx.play('click'); show('tracks'); };
      primary = () => ctx.startSolo(sel);
      back = () => show('home');
      SCREENS.tracks.move = (d) => { const i = (list.indexOf(sel) + d + list.length) % list.length; pick(list[i]); };
      return h('div', { class: 'mx-col' },
        backBtn('Time trial'),
        h('div', { class: 'mx-tracks' }, list.map((t) => trackCard(t, t === sel, () => pick(t)))),
        go('Ride', `${sel.emoji} ${sel.name} · 3, 2, 1… GO!`, () => ctx.startSolo(sel)),
        note(Account.user ? 'Your best time on each track goes on its leaderboard. ↑ ↓ to pick a track.' : 'Log in to put your best times on the leaderboards. ↑ ↓ to pick a track.'));
    },

    worlds() { return worldsScreen(false); },
    mtbworlds() { return worldsScreen(true); },
    challenges() { return challengesScreen('bike'); },
    mtbchallenges() { return challengesScreen('mtb'); },
    snowchallenges() { return challengesScreen('snow'); },
    waterchallenges() { return challengesScreen('water'); },
    sled() { return newerHub('sled'); },
    sledchallenges() { return challengesScreen('sled'); },
    buggy() { return newerHub('buggy'); },
    buggychallenges() { return challengesScreen('buggy'); },
    wing() { return newerHub('wing'); },
    wingchallenges() { return challengesScreen('wing'); },
    skate() { return newerHub('skate'); },
    skatechallenges() { return challengesScreen('skate'); },

    /** Wavvd: jet skis on the sea. Free ride round Azure Bay, challenges, and your jet ski's colour. */
    water() {
      back = () => show('modes');
      const bay = ctx.allWorlds.find((w) => w.id === 'azurebay');
      const chs = ctx.challenges.filter((c) => c.water);
      primary = () => bay && ctx.startWaterFree(bay);
      return h('div', { class: 'mx-col' },
        h('div', { class: 'mx-unrevvd wav' }, h('b', {}, 'WA', h('i', {}, 'VV'), 'D'), h('small', {}, 'Jet skis · waves · open water')),
        h('div', { class: 'mx-two' },
          card2('blue', '🌊', 'Free ride', `${bay ? bay.name : 'Azure Bay'}: islands, beaches and waves to jump`, () => bay && ctx.startWaterFree(bay), { sticker: 'NEW' }),
          card2('orange', '🎯', 'Challenges', `${chs.length} on the water: the buoy slalom, surfing the swell, big air off the waves`, () => show('waterchallenges'), { sticker: 'NEW' })),
        card2('green', '🏄', 'Wakeboard', 'A boat pulls you round the bay: carve out wide, cut back across its wake and fly', () => bay && ctx.startTowFree(bay), { wide: true, sticker: 'NEW' }),
        go('Ride Azure Bay', 'Jet ski', () => bay && ctx.startWaterFree(bay)),
        looksLink('jet', ctx.jetColor(), 'Your jet ski'),
        skyGlass('water'),
        note('W is the throttle, A / D steer, S slows you down. Ride up the face of a wave and you take off: Q / E lean and flip, and land it level. Space / Shift turbo. Run aground and you grind to a stop. Wavvd shares Revvd’s coins.'));
    },

    /** Carvvd: snowboards. No pedals and no engine: gravity. Free ride on Frostpeak, challenges, and your board. */
    snow() {
      back = () => show('modes');
      const peak = ctx.allWorlds.find((w) => w.id === 'frostpeak') || ctx.worlds[0];
      const resort = ctx.allWorlds.find((w) => w.id === 'powderpeak');
      const twilight = ctx.allWorlds.find((w) => w.id === 'twilight');
      const chs = ctx.challenges.filter((c) => c.board);
      const board = ctx.BOARDS[ctx.prefs.board] || Object.values(ctx.BOARDS)[0];
      primary = () => peak && ctx.startBoardFree(peak);
      return h('div', { class: 'mx-col' },
        h('div', { class: 'mx-unrevvd carv' }, h('b', {}, 'CAR', h('i', {}, 'VV'), 'D'), h('small', {}, 'Snowboards · no engine · all gravity')),
        h('div', { class: 'mx-two' },
          card2('blue', '🏔️', 'Free ride', `${peak ? peak.name : 'Frostpeak'}: the whole mountain`, () => peak && ctx.startBoardFree(peak), { sticker: `🪙 ${ctx.Coins.MTB.wallet().coins.toLocaleString('en-US')}`, stickerCls: 'dark' }),
          card2('orange', '🎯', 'Challenges', `${chs.length} runs: chutes, the peak, big air and speed · solo or with friends`, () => show('snowchallenges'), { sticker: 'NEW' })),
        twilight ? card2('blue', '🌆', 'Twilight Slope', 'One long floodlit run down a forested hill at dusk, a chairlift beside it, the lodge at the bottom', () => ctx.startBoardFree(twilight), { wide: true, sticker: 'NEW' }) : null,
        resort ? card2('green', '⛷️', 'Powder Peak Resort', 'A real ski mountain: start on the summit, four marked runs down through the forest, two chairlifts back up', () => ctx.startBoardFree(resort), { wide: true, sticker: 'NEW' }) : null,
        go('Ride Frostpeak', `${board.emoji} ${board.name} board`, () => peak && ctx.startBoardFree(peak)),
        looksLink('snow', board.color, `${board.emoji} ${board.name} ${ctx.gear() === 'skis' ? 'skis' : 'board'}`),
        h('div', { class: 'mx-skyrow' }, h('span', { class: 'mx-lab' }, 'SNOW'), h('div', { class: 'mx-seg' }, Object.entries(ctx.WEATHER).map(([k, w]) => h('button', {
          class: 'mx-sb' + ((ctx.prefs.weather || 'snow') === k ? ' on' : ''), type: 'button', title: `${w.name} (free ride on the snow)`,
          onclick: () => { ctx.prefs.weather = k; ctx.savePrefs(); Sfx.play('click'); show('snow'); } }, `${w.emoji} ${w.name}`)))),
        skyGlass('snow'),
        note('No pedals: point it downhill and gravity does the rest. A / D carve, W pushes along, Q / E lean and flip, hold X to spin, 1–6 grab. Off the pistes is deep powder (slower); the groomed pistes are fast. Ride slowly into the chairlift to go up. Carvvd shares Unrevvd’s coins.'));
    },

    /** Unrevvd: mountain bikes. Free ride (its own bike park and every Revvd world), challenges and the bike shop. */
    mtb() {
      back = () => show('modes');
      const C = ctx.Coins.MTB; const wl = C.wallet(); const part = C.current(wl.engine);
      const wild = ctx.worlds.find((w) => w.bike) || ctx.worlds[0];
      const chs = ctx.challenges.filter((c) => c.vehicle === 'mtb' && !c.board);
      const bike = ctx.MTB_MODELS[ctx.prefs.mtbModel] || Object.values(ctx.MTB_MODELS)[0];
      primary = () => wild && ctx.startMtbFree(wild);
      return h('div', { class: 'mx-col' },
        h('div', { class: 'mx-unrevvd' }, h('b', {}, 'UNRE', h('i', {}, 'VV'), 'D'), h('small', {}, 'Mountain bikes · no engine · all legs')),
        h('div', { class: 'mx-two' },
          card2('green', '🗺️', 'Free ride', `${wild ? wild.name : 'Bike park'} and every Revvd world`, () => show('mtbworlds'), { sticker: `🪙 ${wl.coins.toLocaleString('en-US')}`, stickerCls: 'dark' }),
          card2('orange', '🎯', 'Challenges', `${chs.length} downhills, climbs, air and speed · solo or with friends`, () => show('mtbchallenges'), { sticker: 'NEW' })),
        card2('purple', '📡', 'Ride with friends', 'Make a room: mountain bikes and dirt bikes ride free together', async () => { ctx.rideWithFriends(wild, 'mtb'); await create(); }, { wide: true }),
        go('Ride Wildwood', `${bike.emoji} ${bike.name} · ${part.emoji} ${part.name}`, () => wild && ctx.startMtbFree(wild)),
        card2('green', '🛠️', 'Bike shop', `${Object.keys(ctx.MTB_MODELS).length} bikes · ${C.items.length - 1} upgrades`, () => show('mtbgarage'), { wide: true, sticker: bike.name, stickerCls: 'dark' }),
        note('W pedals: easy on the flat, hard work up a hill, and downhill you fly. Lean back (Q) on the ground for a wheelie. Q / E lean and flip in the air, 1–6 for tricks. Unrevvd has its own coins: earn them riding and spend them in the bike shop.'));
    },

    /** Unrevvd's bike shop: which mountain bike, and the upgrades (bought with Unrevvd coins, free ride only). */
    mtbgarage() {
      back = () => show('mtb');
      const C = ctx.Coins.MTB; let panel; let name; let sub = '';
      const TABS = [['bike', '🚵 Bike'], ['parts', '⚡ Upgrades'], ['gear', '🔦 Lamps & cams']];
      if (shopTab === 'gear') {
        panel = h('div', { class: 'mx-col' },
          shopPanel(ctx.Coins.LAMP, 'Bike lamps', (e) => e.about, 'For the Night Run and the Lantern Hunt. Lamps don’t make you faster, so they work in challenges too.'),
          shopPanel(ctx.Coins.CAM, 'Helmet cams', (e) => e.about, 'How first person looks. Win gold on the Timber, Frozen and Night Runs for the golden visor.'));
        const l = ctx.Coins.LAMP.current(); const c = ctx.Coins.CAM.current(); name = `${l.emoji} ${l.name}`; sub = `${c.emoji} ${c.name}`.toUpperCase();
      } else if (shopTab === 'parts') {
        panel = shopPanel(C, 'Bike upgrades', (e) => `${e.about} · ${e.top[0]} km/h on the flat`,
          'Upgrades only work in free ride. Unrevvd challenges use stock legs so nobody can buy a win. Earn Unrevvd coins by grabbing the gold coins, riding, landing flips and in challenges.');
        const eq = C.current(); name = `${eq.emoji} ${eq.name}`; sub = `${eq.top[0]} KM/H ON THE FLAT`;
      } else {
        const id = ctx.MTB_MODELS[ctx.prefs.mtbModel] ? ctx.prefs.mtbModel : Object.keys(ctx.MTB_MODELS)[0];
        panel = glass('Mountain bikes', 'only looks: they all ride the same', h('div', { class: 'mx-liveries' }, Object.entries(ctx.MTB_MODELS).map(([k, m]) => h('button', {
          class: 'mx-livery' + (k === id ? ' on' : ''), type: 'button', style: { '--c1': '#000', '--c2': '#000' }, title: m.about, onclick: () => ctx.setMtbModel(k) },
        k === id ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo' }, m.emoji), h('span', {}, m.name)))),
        glass('Your rider', 'Unrevvd only', h('div', { class: 'mx-liveries' }, Object.entries(ctx.MTB_RIDERS).map(([k, r]) => h('button', {
          class: 'mx-livery' + (k === (ctx.MTB_RIDERS[ctx.prefs.mtbRider] ? ctx.prefs.mtbRider : 'bmx') ? ' on' : ''), type: 'button', style: { '--c1': '#000', '--c2': '#000' }, title: r.about,
          onclick: () => { ctx.setMtbRider(k); show('mtbgarage'); } },
        k === (ctx.MTB_RIDERS[ctx.prefs.mtbRider] ? ctx.prefs.mtbRider : 'bmx') ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo' }, r.emoji), h('span', {}, r.name))))),
        note('Your kit, helmet and number are the same as in the Revvd garage. Carvvd has its own snowboarder.'),
        h('button', { class: 'mx-sb', type: 'button', style: { marginTop: '8px', justifySelf: 'start' }, onclick: () => { garageTab = 'rider'; show('garage'); } }, '🧍 Change your rider ↗'));
        name = ctx.MTB_MODELS[id].name; sub = ctx.MTB_MODELS[id].about.toUpperCase();
      }
      return [
        h('div', { class: 'mx-col mid' }, backBtn('Bike shop'),
          h('div', { class: 'mx-seg' }, TABS.map(([k, label]) => h('button', { class: 'mx-sb' + (k === shopTab ? ' on' : ''), type: 'button', onclick: () => { shopTab = k; Sfx.play('click'); show('mtbgarage'); } }, label))),
          panel),
        h('div', { class: 'mx-showcase' }, h('b', {}, name), sub ? h('small', {}, sub) : null),
      ];
    },

    online() {
      back = () => show('home');
      const code = h('input', { class: 'input', maxlength: 4, placeholder: 'CODE', 'aria-label': 'Room code', autocomplete: 'off', spellcheck: 'false',
        onkeydown: (e) => { if (e.key === 'Enter') join(code.value); } });
      primary = () => create();
      return h('div', { class: 'mx-col' },
        backBtn('Race online'),
        card2('red', '✨', 'Create a room', 'You get a code to send your friends', create, { wide: true }),
        card2('green', '⚡', 'Quick play', 'Jump into any open room', quick, { wide: true }),
        h('div', { class: 'mx-ticket' }, h('div', { class: 'grow' }, h('span', { class: 'lab' }, 'Join friends'),
          h('div', { class: 'mx-joinrow' }, code, h('button', { class: 'mx-go slim', type: 'button', style: { width: 'auto' }, onclick: () => join(code.value) }, h('b', {}, 'Join'), h('span', { class: 'arr' }, '↗'))))),
        note('2 to 6 riders. Everyone readies up, then 3, 2, 1… GO! Your bike is the one from your garage.'));
    },

    joining() {
      return h('div', { class: 'mx-col' }, glass(null, null, h('div', { class: 'mx-loading' }, h('div', { class: 'mx-spin' }), 'Joining the room…')));
    },

    room() {
      back = null;
      primary = () => { const b = roomEls && roomEls.go.querySelector('button'); if (b && !b.disabled) b.click(); };
      roomEls = {
        results: h('div'), code: h('div'), riders: h('div', { class: 'mx-glass' }), track: h('div', { class: 'mx-glass' }), go: h('div'), tools: h('div', { class: 'mx-glass' }),
      };
      const el = h('div', { class: 'mx-room' },
        h('div', { class: 'mx-col' }, roomEls.results, roomEls.code, roomEls.riders, roomEls.track, roomEls.go, roomEls.tools),
        h('div', { class: 'mx-gap' }),
        ctx.chat);
      roomUpdate(true);
      return el;
    },

    garage() {
      back = () => { preview = null; show('home'); };
      const mine = ctx.myLivery(); const lvMine = ctx.LIVERIES[mine] || ctx.LIVERIES.factory; const st = ctx.style;
      if (!preview) preview = mine;
      // every vehicle's looks in one place: the dirt bike's tabs, or the others' pickers
      const VEH = [['bike', '🏍️ Dirt bike'], ['car', '🏎️ Supercar'], ['mtb', '🚵 Mountain bike'], ['snow', '🏂 Board & skis'], ['jet', '🌊 Jet ski'], ['sled', '🛷 Snowmobile'], ['buggy', '🚙 Buggy'], ['wing', '🪂 Wingsuit'], ['skate', '🛹 Skateboard']];
      const vehRow = h('div', { class: 'mx-seg mx-veh' }, VEH.map(([k, label]) => h('button', { class: 'mx-sb' + (k === garageVeh ? ' on' : ''), type: 'button',
        onclick: () => { Sfx.play('click'); if (k === 'mtb') { shopTab = 'bike'; show('mtbgarage'); return; } garageVeh = k; show('garage'); } }, label)));
      if (garageVeh !== 'bike') {
        const car = ctx.CAR_MODELS[ctx.prefs.carModel || 'revuelto'];
        const [title, kids, about] = garageVeh === 'car' ? [`${car.emoji} ${car.name}`, [glass('Supercar', 'free ride', ...carPickers('garage'))], 'Drive it in Revvd’s free ride (pick 🏎️ Supercar there) and in rooms riding free together.']
          : garageVeh === 'snow' ? ['Carvvd', boardGlasses('garage'), 'Your board and whether you ride a snowboard or skis, in Carvvd.']
          : NEWER[garageVeh] ? [NEWER[garageVeh].name, [paintGlass(garageVeh, 'garage')], `Only looks: in ${NEWER[garageVeh].name} everyone rides the same.`]
          : ['Wavvd', [jetGlass('garage')], 'Your jet ski’s colour in Wavvd (the wakeboard is the same colour).'];
        return [h('div', { class: 'mx-col mid' }, backBtn('Garage'), vehRow, ...kids, note(about)), h('div', { class: 'mx-showcase' }, h('b', {}, title))];
      }
      const TABS = [['bike', '🏍️ Bike'], ['engine', '⚡ Engine'], ['paint', '🎨 Paint'], ['rider', '🧍 Rider'], ['kit', '👕 Rider kit'], ['helmet', '⛑️ Helmet'], ['number', '#️⃣ Number']];
      const grid = (items, cur, onPick) => h('div', { class: 'mx-liveries' }, items.map(([id, label, c1, c2, opts = {}]) => h('button', {
        class: 'mx-livery' + (id === cur ? ' on' : '') + (opts.locked ? ' locked' : ''), type: 'button', style: { '--c1': c1, '--c2': c2 }, title: opts.title || label, onclick: () => onPick(id) },
      id === cur && !opts.locked ? h('span', { class: 'eq' }, opts.on || 'ON') : null, opts.locked ? h('span', { class: 'lk' }, '🔒') : null,
      opts.emoji ? h('b', { class: 'emo' }, opts.emoji) : h('i', {}), h('span', {}, label))));
      let panel; let name; let sub = '';
      if (garageTab === 'engine') {
        const C = ctx.Coins;
        panel = shopPanel({ ...C, items: C.ENGINES }, 'Free-ride engines', (e) => `${e.about} · ${e.top[0]} km/h (${e.top[1]} with turbo)`,
          'Engines only work in free ride. Races and challenges use the stock engine so nobody can buy a win. Earn coins by grabbing the gold coins on the trails and over the jumps, riding, landing flips and in challenges. Coins are kept on this device.');
        const eq = C.engineOf(C.wallet().engine); name = `${eq.emoji} ${eq.name}`; sub = `${eq.top[0]} KM/H · ${eq.top[1]} WITH TURBO`;
      } else if (garageTab === 'paint') {
        const list = ctx.bikeList; const have = ctx.unlocked.has(preview);
        panel = glass('Paint jobs', `${list.filter((b) => ctx.unlocked.has(b.id)).length} / ${list.length} unlocked`,
          grid(list.map((b) => { const p = paint(b.id); const ok = ctx.unlocked.has(b.id); return [b.id, p.name, p.c1, p.c2, { locked: !ok, on: 'RIDING', title: ok ? p.name : `🔒 ${p.name}: ${ctx.bikeHints[b.id] || 'Locked'}` }]; }), preview,
          (id) => { preview = id; Sfx.play('click'); if (ctx.unlocked.has(id) && id !== mine) ctx.chooseLivery(id); else show('garage'); }),
          note(Account.user ? 'Level up, land flips and win races to unlock more. Everyone in your races sees your bike.' : 'Log in to unlock more paint jobs as you level up and win races.'));
        name = paint(preview).name; sub = have ? (preview === mine ? '✔ YOU’RE RIDING THIS ONE' : '') : `🔒 ${ctx.bikeHints[preview] || 'Locked'}`;
      } else if (garageTab === 'bike') {
        panel = glass('Bikes', 'only looks: they all ride the same', grid(Object.entries(ctx.MODELS).map(([id, m]) => [id, m.name, '#000', '#000', { emoji: m.emoji, title: m.about }]), st.model, (id) => ctx.setStyle({ model: id })));
        name = ctx.MODELS[st.model] ? ctx.MODELS[st.model].name : ''; sub = ctx.MODELS[st.model] ? ctx.MODELS[st.model].about.toUpperCase() : '';
      } else if (garageTab === 'rider') {
        const rid = ctx.RIDERS[st.rider] ? st.rider : 'biker';
        panel = glass('Rider', 'only looks', grid(Object.entries(ctx.RIDERS).map(([id, r]) => [id, r.name, '#000', '#000', { emoji: r.emoji, title: r.about }]), rid, (id) => ctx.setStyle({ rider: id })),
          note('Rider kit and helmet colours go on the MX Racer.'));
        name = ctx.RIDERS[rid].name; sub = ctx.RIDERS[rid].about.toUpperCase();
      } else if (garageTab === 'kit') {
        panel = glass('Rider kit', null, grid(Object.entries(ctx.KITS).map(([id, k]) => [id, k.name, k.jersey || lvMine.jersey, k.pants || lvMine.pants]), st.kit, (id) => ctx.setStyle({ kit: id })),
          note('Your jersey, pants and boots. “Match my bike” goes with your paint job.'));
        name = (ctx.KITS[st.kit] || ctx.KITS.match).name;
      } else if (garageTab === 'helmet') {
        panel = glass('Helmet', null, grid(Object.entries(ctx.HELMETS).map(([id, k]) => [id, k.name, k.helmet || lvMine.helmet, k.helmet2 || lvMine.helmet2]), st.helmet, (id) => ctx.setStyle({ helmet: id })),
          note('Each helmet comes with its own goggle lens colour.'));
        name = (ctx.HELMETS[st.helmet] || ctx.HELMETS.match).name;
      } else {
        const n = st.number ?? lvMine.number;
        const set = (v) => ctx.setStyle({ number: v });
        const input = h('input', { class: 'input', type: 'number', min: 0, max: 99, value: n, 'aria-label': 'Race number',
          onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 0 && v <= 99) set(v); else show('garage'); } });
        panel = glass('Race number', null, h('div', { class: 'mx-num' },
          h('button', { class: 'mx-sb', type: 'button', 'aria-label': 'Lower', onclick: () => set((n + 99) % 100) }, '−'), input,
          h('button', { class: 'mx-sb', type: 'button', 'aria-label': 'Higher', onclick: () => set((n + 1) % 100) }, '+')),
        h('button', { class: 'mx-sb', type: 'button', style: { marginTop: '10px' }, onclick: () => set(null) }, `Use my paint job’s number (${lvMine.number})`),
        note('0 to 99, on your number plates and your bike’s sides.'));
        name = `#${n}`;
      }
      return [
        h('div', { class: 'mx-col mid' }, backBtn('Garage'), vehRow,
          h('div', { class: 'mx-seg' }, TABS.map(([k, label]) => h('button', { class: 'mx-sb' + (k === garageTab ? ' on' : ''), type: 'button', onclick: () => { garageTab = k; preview = null; Sfx.play('click'); show('garage'); } }, label))),
          panel),
        h('div', { class: 'mx-showcase' }, h('b', {}, name), sub ? h('small', {}, sub) : null),
      ];
    },

    boards() {
      back = () => show('home');
      const list = h('div', { class: 'mx-board-list' }, h('div', { class: 'mx-empty' }, h('div', { class: 'mx-spin', style: { margin: '0 auto' } })));
      const keys = [...tracks().map((t) => [`moto_${t.id}`, `${t.emoji} ${t.name}`]), ['moto', '🏆 Wins'], ['moto_flips', '🤸 Flips']];
      load(boardKey, list);
      return h('div', { class: 'mx-col', style: { width: 'min(540px, 100%)' } },
        backBtn('Leaderboards'),
        h('div', { class: 'mx-seg' }, keys.map(([k, label]) => h('button', { class: 'mx-sb' + (k === boardKey ? ' on' : ''), type: 'button', onclick: () => { boardKey = k; show('boards'); } }, label))),
        h('div', { class: 'mx-glass' }, list),
        h('a', { class: 'mx-sb', href: `/leaderboards?b=${boardKey}`, style: { justifySelf: 'start' } }, 'See the whole board ↗'));
    },

    controls() {
      back = () => show('home');
      const seg = (opts, cur, set) => h('div', { class: 'mx-seg' }, opts.map(([k, label]) => h('button', { class: 'mx-sb' + (k === cur ? ' on' : ''), type: 'button', onclick: () => { set(k); Sfx.play('click'); show('controls'); } }, label)));
      const key = (keys, what) => h('div', {}, h('span', { class: 'k' }, keys.map((k) => h('kbd', {}, k))), h('span', {}, what));
      return [
        h('div', { class: 'mx-col' },
          backBtn('Controls'),
          glass('Keys', null, h('div', { class: 'mx-keys' },
            key(['W', '↑'], 'Gas'), key(['S', '↓'], 'Brake (hold when stopped to back up)'), key(['A', 'D'], 'Steer left and right'),
            key(['Q'], 'Lean back (backflip in the air)'), key(['E'], 'Lean forward (frontflip)'), key(['Space', 'Shift'], 'Nitro / free-ride turbo'),
            key(['1', '2', '3'], 'Air tricks: Superman, No-Hander, Can-Can (hold)'), key(['4', '5', '6'], 'Nac-Nac, Heel Clicker, Cliffhanger (hold)'),
            key(['Z'], 'Whip the bike sideways (hold)'), key(['X'], '360 spin (tap)'),
            key(['R'], 'Reset to checkpoint / free-ride safe pad'), key(['C'], 'Change camera'), key(['M'], 'Map (in the menus: sound on/off)'), key(['Esc'], 'Back to the menu'))),
          note('Gamepads work too: triggers for gas and brake, left stick to steer, right stick to lean, A for nitro, X / Y / bumpers for tricks, B for a 360.')),
        h('div', { class: 'mx-col' },
          glass('Settings', null,
            h('div', { class: 'mx-lab' }, 'CAMERA'), seg([['chase', '🎥 Chase'], ['side', '📺 Side'], ['close', '🎬 Close'], ['first', '👀 First person']], ctx.prefs.cam, ctx.setCam),
            h('div', { class: 'mx-lab' }, 'GRAPHICS'), seg([['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low (faster)']], ctx.prefs.quality, ctx.setQuality),
            h('div', { class: 'mx-lab' }, 'PHYSICS'), seg([['og', '🤸 OG'], ['new', '🧱 NEW']], ctx.prefs.physics === 'new' ? 'new' : 'og', ctx.setPhysics),
            h('small', { class: 'mx-hint' }, ctx.prefs.physics === 'new' ? 'NEW: roll over and it’s a crash straight away, then you’re straight back riding' : 'OG: tumbles play out: bounce, roll and maybe land on your wheels again'),
            h('div', { class: 'mx-lab' }, 'MINIMAP'), seg([['on', '🗺️ On'], ['off', 'Off']], ctx.prefs.minimap === 'off' ? 'off' : 'on', ctx.setMinimap),
            h('div', { class: 'mx-lab' }, 'SOUND'), seg([['on', '🔊 On'], ['off', '🔇 Off']], PA.Sfx.muted ? 'off' : 'on', (k) => PA.Sfx.setMuted(k === 'off'))),
          glass('How to ride', null, h('ul', { class: 'mx-tips' },
            h('li', {}, 'Slow down for corners or you slide wide. The banked berms help you round them.'),
            h('li', {}, 'In the air, lean back or forward to flip. Let go and the rider levels the bike for the landing.'),
            h('li', {}, 'Hold a trick key in the air, then let go before you land: still in a trick when you touch down and you bail. Chain tricks and flips in one jump for a combo.'),
            h('li', {}, 'Land on your head or upside down and you crash: reset to a checkpoint or free-ride safe pad.'),
            h('li', {}, 'Clean landings and flips fill nitro. Free-ride turbo also recharges when released.'),
            h('li', {}, 'Unrevvd (mountain bikes): W pedals and Q (lean back) pulls a wheelie. No nitro: it’s a bicycle. Climbing is hard work, so the map’s fast travel can take you up the hill.')))),
      ];
    },
  };

  // ---------------------------------------------------------------- the room
  /** Redraw the parts of the room screen (results, code, riders, track, ready button, tools). */
  function roomUpdate(fresh) {
    if (screen !== 'room' || !roomEls || !inRoom()) return;
    const st = ctx.state;
    const host = Room.isHost;
    const riders = (Room.players || []).filter((p) => !p.watch && p.online !== false);
    const watchers = (Room.players || []).filter((p) => p.watch && p.online !== false).length;
    const meIn = riders.some((p) => p.id === Net.id);
    const mine = !!st.ready[Net.id];
    const readyCount = riders.filter((p) => st.ready[p.id]).length;
    const racing = st.phase === 'racing' && st.race;

    // the last race's results (until you close them)
    const res = st.results;
    const resKey = res && res.rows ? res.rows.map((r) => r.id + r.time).join() : null;
    fill(roomEls.results, res && res.rows && !racing && hideResults !== resKey ? (() => {
      const ch = res.challenge && ctx.challenges.find((c) => c.id === res.challenge);
      const tr = ch || ctx.trackDef(res.track);
      return h('div', { class: 'mx-glass' },
        h('div', { class: 'mx-h' }, ch ? '🎯 Last challenge' : '🏁 Last race', h('span', { class: 'n' }, `${tr.emoji} ${tr.name}`),
          h('button', { class: 'mx-sb', type: 'button', style: { padding: '2px 8px' }, title: 'Hide', 'aria-label': 'Hide the results', onclick: () => { hideResults = resKey; roomUpdate(); } }, '✕')),
        h('div', { class: 'mx-results' }, res.rows.map((r) => h('div', { class: 'mx-rider' + (r.id === Net.id ? ' me' : '') },
          h('b', { style: { width: '24px', textAlign: 'center' } }, r.done ? ['🥇', '🥈', '🥉'][r.place - 1] || `#${r.place}` : '–'), UI.avatar(r, 'sm'),
          h('span', { class: 'nm' }, r.name, r.flips ? h('small', {}, ` · 🤸 ${r.flips}`) : null),
          h('span', { class: 't' }, ch && ch.kind !== 'race' ? (r.done ? ctx.fmtScore(ch.kind, r.score) : 'No score') : r.done ? fmt(r.time / 1000) : 'DNF')))));
    })() : null);

    // the code, to send to friends
    fill(roomEls.code, h('div', { class: 'mx-ticket' },
      h('div', { class: 'grow' }, h('span', { class: 'lab' }, 'Room code'), h('span', { class: 'mx-code-big' }, Room.code),
        h('div', { class: 'acts' },
          h('button', { class: 'mx-link', type: 'button', onclick: () => { UI.copy(Room.inviteLink(), 'Invite link copied! Send it to your friends 🚀'); Sfx.play('coin'); } }, '🔗 Copy invite link'),
          h('button', { class: 'mx-link', type: 'button', onclick: () => PA.Friends.inviteModal() }, '📨 Invite friends'))),
      h('span', { class: 'mx-barcode' })));

    // the riders: who's ready, their bikes, wins
    fill(roomEls.riders,
      h('div', { class: 'mx-h' }, 'Riders', h('span', { class: 'n' }, `${riders.length} / 6${racing ? '' : ` · ${readyCount} ready`}${watchers ? ` · 👀 ${watchers}` : ''}`)),
      h('div', { class: 'mx-riders' }, riders.map((p) => {
        const pt = paint(p.id === Net.id ? ctx.myLivery() : ctx.LIVERIES[p.bike] ? p.bike : 'factory');
        const status = racing ? (st.race.runners[p.id] ? h('span', { class: 'st' }, st.race.free ? 'RIDING' : 'RACING') : h('span', { class: 'st off' }, st.race.free ? 'IN THE ROOM' : 'NEXT RACE'))
          : st.ready[p.id] ? h('span', { class: 'st ok' }, '✔ READY') : h('span', { class: 'st' }, 'NOT READY');
        return h('div', { class: 'mx-rider' + (p.id === Net.id ? ' me' : '') + (p.acct ? ' click' : ''), title: p.acct ? `See ${p.acct}'s profile` : '',
          onclick: p.acct ? () => UI.profileCard(p.acct) : null },
        UI.avatar(p, 'sm'), h('span', { class: 'nm' }, p.id === Room.host ? '👑 ' : '', p.name, p.id === Net.id ? h('small', {}, ' (you)') : null,
          st.wins[p.id] ? h('small', {}, ` · 🏆${st.wins[p.id]}`) : null),
        h('span', { class: 'sw', title: pt.name, style: { '--c1': pt.c1, '--c2': pt.c2 } }), status);
      })),
      riders.length < st.min ? note(`You need at least ${st.min} riders. Send a friend the code!`) : null);

    // a track race or a challenge (the host picks)
    const sel = st.settings.track; const mode = ['challenge', 'free'].includes(st.settings.mode) ? st.settings.mode : 'race'; const isCh = mode === 'challenge'; const can = host && !racing;
    const seg = h('div', { class: 'mx-seg' }, [['race', '🏁 Track race'], ['challenge', '🎯 Challenge'], ['free', '🌍 Free ride']].map(([k, label]) => h('button', {
      class: 'mx-sb' + (k === mode ? ' on' : ''), type: 'button', disabled: !can,
      onclick: () => { if (k !== mode) { Net.send('g:settings', { mode: k }); Sfx.play('click'); } } }, label)));
    const myRide = ['car', 'mtb', 'board', 'jet'].includes(ctx.prefs.vehicle) ? ctx.prefs.vehicle : 'bike';
    const rideSeg = mode === 'free' ? [h('div', { class: 'mx-lab' }, 'YOU RIDE'), h('div', { class: 'mx-seg' }, [['bike', '🏍️ Dirt bike'], ['mtb', '🚵 Mountain bike'], ['car', '🏎️ Supercar'], ['board', '🏂 Snowboard'], ['jet', '🌊 Jet ski (on the sea)']].map(([k, label]) => h('button', {
      class: 'mx-sb' + (k === myRide ? ' on' : ''), type: 'button', onclick: () => { if (k !== myRide) { ctx.setVehicle(k); roomUpdate(); } } }, label)))] : null;
    fill(roomEls.track, h('div', { class: 'mx-h' }, isCh ? 'Challenge' : mode === 'free' ? 'World' : 'Track', h('span', { class: 'n' }, host ? 'you pick' : 'the host picks')), seg, rideSeg,
      mode === 'free'
        ? h('div', { class: 'mx-chlist' }, ctx.allWorlds.filter((w) => !w.hidden || w.roomFree).map((w) => worldChip(w, st.settings.world === w.id,
          can ? () => { if (st.settings.world !== w.id) { Net.send('g:settings', { world: w.id }); Sfx.play('click'); } } : null)))
        : isCh
        ? h('div', { class: 'mx-chlist' }, ctx.challenges.map((c) => challengeChip(c, st.settings.challenge === c.id,
          can ? () => { if (st.settings.challenge !== c.id) { Net.send('g:settings', { challenge: c.id }); Sfx.play('click'); } } : null)))
        : h('div', { class: 'mx-tchips' }, [...tracks(), { id: 'random', name: 'Surprise', emoji: '🎲' }].map((t) => trackCard(t, sel === t.id,
          can ? () => { if (sel !== t.id) { Net.send('g:settings', { track: t.id }); Sfx.play('click'); } } : null, true))));

    // ready up (or watch the race that's on)
    let btn;
    if (racing && st.race.free) {
      // a free ride is on: ride in (or back in), and the host can end it for everyone
      const w = ctx.worlds.find((x) => x.id === st.race.free);
      btn = h('div', {}, meIn ? go(st.race.runners[Net.id] ? 'Back to the ride' : 'Join the ride', `${w ? w.name : 'Free ride'} · ${Object.keys(st.race.runners).length} riding`, () => { Net.send('g:hop'); Sfx.play('pop'); }) : null,
        host ? h('button', { class: 'mx-sb', type: 'button', style: { marginTop: '8px', width: '100%' }, onclick: () => { Net.send('g:stop'); Sfx.play('click'); } }, '⏹ End the free ride for everyone') : null);
    } else if (racing && st.race.challenge) btn = go('Challenge on', 'You can ready up for the next one when it’s over', () => {}, { disabled: true });
    else if (racing) btn = go('Watch the race', 'You can ready up for the next one when it’s over', () => ctx.watchRace());
    else if (!meIn) btn = go('Join in', 'You’re just watching', () => { Net.send('room:watch', { watch: false }); Sfx.play('pop'); });
    else if (mine) {
      const waiting = riders.length - readyCount;
      btn = go('Ready ✔', riders.length < st.min ? `Waiting for more riders (${st.min} needed)` : waiting ? `Waiting for ${waiting} more…` : 'Here we go!',
        () => { Net.send('g:ready', { ready: false }); Sfx.play('click'); }, { on: true });
    } else btn = go(mode === 'free' ? 'Let’s ride' : 'I’m ready', mode === 'free' ? 'The ride starts when everyone is ready, and friends can join in any time' : riders.length < st.min ? 'The race starts when everyone is ready' : 'The race starts when everyone is ready: 3, 2, 1… GO!', () => { Net.send('g:ready', { ready: true }); Sfx.play('coin'); });
    fill(roomEls.go, btn);

    // invite, watch, party mode and the rest (from the lobby), and leaving
    fill(roomEls.tools, Lobby.roomTools(), h('button', { class: 'mx-sb', type: 'button', style: { marginTop: '8px' }, onclick: () => Lobby.leave() }, '🚪 Leave the room'));
    roomEls.tools.querySelectorAll('.btn').forEach((b) => { b.className = 'mx-sb' + (b.getAttribute('aria-pressed') === 'true' ? ' on' : ''); });   // (in the game's style; the picked one stays lit)

    if (fresh && FX.list) FX.list(screenEl.querySelectorAll('.mx-room > .mx-col > *:not(:empty), .mx-chat'), { y: 26, stagger: 0.05, duration: 0.4, ease: 'back.out(1.5)' });
    ctx.stage.room();
  }

  // ---------------------------------------------------------------- the rider licence (your account)
  function licence() {
    const u = Account.user; const p = Profile.get();
    const pct = u && u.to > u.from ? Math.max(0, Math.min(100, ((u.xp - u.from) / (u.to - u.from)) * 100)) : 0;
    return h('div', { class: 'mx-ticket' },
      UI.avatar(p, 'lg'),
      h('div', { class: 'grow' },
        h('span', { class: 'lab' }, u ? `Rider licence · level ${u.level}` : 'Rider licence · guest'),
        h('div', { class: 'nm' }, h('small', {}, 'RIDER'), h('b', {}, p.name)),
        u ? h('div', { class: 'xp', title: `${u.xp.toLocaleString('en-US')} XP` }, h('i', { style: { width: pct + '%' } })) : null,
        h('div', { class: 'acts' }, u
          ? [h('a', { class: 'mx-link', href: '/profile?u=' + encodeURIComponent(u.name) }, 'My profile ↗'), h('button', { class: 'mx-link', type: 'button', onclick: () => Profile.edit() }, 'Edit my look')]
          : [h('button', { class: 'mx-link', type: 'button', onclick: () => UI.accountModal({ view: 'login' }) }, 'Sign in ↗'),
            h('button', { class: 'mx-link', type: 'button', onclick: () => UI.accountModal({ view: 'signup' }) }, 'Free account'),
            h('button', { class: 'mx-link', type: 'button', onclick: () => Profile.edit() }, 'Edit look')])),
      h('span', { class: 'mx-barcode' }));
  }

  // ---------------------------------------------------------------- leaderboards
  async function load(key, el) {
    try {
      const { board } = await Net.request('lb:get', { board: key });
      if (screen !== 'boards' || boardKey !== key) return;
      const me = Account.user;
      const val = (v) => (board.format === 'time' ? fmt(v / 1000) : Number(v).toLocaleString('en-US'));
      const rows = board.rows.slice(0, 10);
      fill(el, rows.length ? rows.map((r) => h('a', { class: 'mx-lb' + (me && r.id === me.id ? ' me' : ''), href: '/profile?u=' + encodeURIComponent(r.name) },
        h('span', { class: 'rk' }, ['🥇', '🥈', '🥉'][r.rank - 1] || r.rank), UI.avatar(r, 'sm'), h('span', { class: 'nm' }, r.name), h('span', { class: 'v' }, val(r.value))))
        : h('div', { class: 'mx-empty' }, 'Nobody here yet. Be the first!'),
      me && board.me && !rows.some((r) => r.id === me.id) ? h('div', { class: 'mx-lb me' }, h('span', { class: 'rk' }, board.me.rank), UI.avatar(me, 'sm'), h('span', { class: 'nm' }, 'You'), h('span', { class: 'v' }, val(board.me.value))) : null,
      !me ? h('div', { class: 'mx-empty' }, h('button', { class: 'mx-sb', type: 'button', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Make a free account to get on here')) : null);
      if (FX.list) FX.list(el.children, { x: -20, y: 0, stagger: 0.03, duration: 0.3 });
    } catch (e) {
      if (screen === 'boards') fill(el, h('div', { class: 'mx-empty' }, '😵 ', e.message || 'Couldn’t load the leaderboard'));
    }
  }

  // ---------------------------------------------------------------- going online
  async function create() { await Profile.ensure(); Sfx.play('pop'); show('joining'); Net.send('room:create', { game: 'moto', private: Lobby.privatePref() }); }
  async function quick() { await Profile.ensure(); Sfx.play('pop'); show('joining'); Net.send('room:quick', { game: 'moto' }); }
  async function join(code) {
    code = String(code || '').trim().toUpperCase();
    if (code.length < 4) { UI.toast('Room codes have 4 letters 🔑', 'bad'); return; }
    await Profile.ensure();
    show('joining');
    Net.send('room:join', { code, game: 'moto' });
  }

  // ---------------------------------------------------------------- tabs and switching screens
  // (all the vv modes share one tab: it shows the one you're in, and opens the picker)
  const TABS = [['ride', '🏁', 'Ride'], ['modes', '🧭', 'Modes'], ['career', '🎖️', 'Career'], ['garage', '🏍️', 'Garage'], ['boards', '🏆', 'Leaderboards'], ['controls', '🎮', 'Controls']];
  /** Which mode a screen belongs to ('mtb', 'snow', 'water' or a newer one), or null. */
  const modeKey = (s) => Object.keys(NEWER).find((k) => (s || '').startsWith(k)) || (/^mtb/.test(s || '') ? 'mtb' : /^snow/.test(s || '') ? 'snow' : /^water/.test(s || '') ? 'water' : null);
  const tabOf = (s) => (['garage', 'boards', 'controls', 'career', 'modes'].includes(s) ? s : modeKey(s) ? 'modes' : 'ride');
  const logoEl = document.querySelector('.mx-logo b');
  function drawTabs() {
    const cur = MODES.find((m) => m[0] === modeKey(screen));   // (in a mode: the tab says which, and goes back to the picker)
    fill(tabsEl, TABS.map(([k, e, label]) => h('button', { class: 'mx-tab' + (tabOf(screen) === k ? ' on' : ''), type: 'button',
      onclick: () => { Sfx.play('click'); if (k === 'ride') show(inRoom() ? 'room' : 'home'); else show(k); } },
    h('span', { class: 'ph' }, k === 'modes' && cur ? cur[1] : e), k === 'modes' && cur ? cur[2] : label, k === 'ride' && inRoom() ? h('span', { class: 'new' }, Room.code) : null, k === 'modes' && !cur ? h('span', { class: 'new' }, 'NEW') : null)));
    // the logo: UNREVVD on Unrevvd's screens, CARVVD on Carvvd's, WAVVD on Wavvd's
    const mk = modeKey(screen); const brand = mk === 'mtb' ? 'un' : mk === 'snow' ? 'carv' : mk === 'water' ? 'wav' : 're';
    const nw = NEWER[mk]; const b2 = nw ? nw.cls : brand;
    if (logoEl && logoEl.dataset.brand !== b2) { fill(logoEl, nw ? nw.logo[0] : { un: 'UNRE', carv: 'CAR', wav: 'WA', re: 'RE' }[brand], h('i', {}, 'VV'), nw ? nw.logo[2] : 'D'); for (const k of ['un', 'carv', 'wav', ...Object.values(NEWER).map((m) => m.cls)]) logoEl.classList.toggle(k, b2 === k); logoEl.dataset.brand = b2; }
  }

  function show(name) {
    if (name !== 'garage') preview = null;
    if (name !== 'room') roomEls = null;
    const prev = screen;
    screen = name; primary = null; back = null;
    const kids = SCREENS[name]();
    fill(screenEl, kids);
    drawTabs();
    // the 3D scene behind: which track, which bikes and where the camera looks
    if (name !== 'room') ctx.stage.solo(name === 'garage' ? preview : null, name);
    if (prev !== name && name !== 'room' && FX.list) FX.list(screenEl.querySelectorAll('.mx-col > *'), { y: 22, stagger: 0.04, duration: 0.35, ease: 'back.out(1.5)' });
    if (prev !== name) document.getElementById('mx-ui').scrollTop = 0;
  }

  /** Keys while the menus are up: Enter = the big button (unless a button has the focus), Esc = back, ↑ ↓ = pick a track. */
  function onKey(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (document.querySelector('.modal-backdrop, .pop-menu')) return;
    const focused = document.activeElement && document.activeElement !== document.body && document.activeElement.closest('button, a');
    if (e.code === 'Enter' && primary && !e.repeat && !focused) { e.preventDefault(); primary(); } else if (e.code === 'Escape' && back) back();
    else if (screen === 'tracks' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); SCREENS.tracks.move(e.code === 'ArrowUp' ? -1 : 1); }
  }

  return {
    show, roomUpdate, onKey,
    get screen() { return screen; },
    /** Redraw this screen (after logging in, unlocking a paint job, …). */
    refresh() { if (screen === 'room') roomUpdate(); else if (screen && screen !== 'joining') show(screen); },
  };
}
