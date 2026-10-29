/* Revvd: the menus. They sit on top of the 3D track, inside the game window (like Cork7): the main menu,
   the time trial tracks, racing online, the room (riders, ready-up, the track and chat), the garage,
   leaderboards and controls, and Unrevvd (the mountain bikes: free ride, challenges and the bike shop).
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

  const KIND = { race: '🏁 Race to the finish', air: '🚀 Longest jump', flips: '🤸 Most flips', speed: '⚡ Top speed', tricks: '🌟 Most trick points' };
  /** A challenge to pick: what it is, where, the goal and (big) your best on this device. */
  function challengeChip(c, on, onClick, big) {
    const best = ctx.challengeBest(c.id); const world = (ctx.worlds.find((w) => w.id === c.world) || {}).name || c.world;
    return h('button', { class: 'mx-chal' + (on ? ' on' : ''), type: 'button', onclick: onClick, disabled: !onClick, title: c.about },
      h('span', { class: 'e' }, c.emoji),
      h('span', { class: 'tx' }, h('b', {}, c.name), h('small', {}, `${world} · ${KIND[c.kind]}${c.kind === 'race' ? '' : ` · ${c.limit}s`}${c.vehicle === 'mtb' ? ' · 🚵 MTB' : ''}`),
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
          h('button', { class: 'mx-sb' + (on ? ' on' : ''), type: 'button', disabled: on || (!own && wl.coins < e.price), onclick: () => act(e) },
            on ? 'RIDING' : own ? 'Use' : `🪙 ${e.price.toLocaleString('en-US')}`));
      })),
      note(text));
  }

  /** The free-ride worlds (mtb: Unrevvd's, on a mountain bike, its own bike park first). */
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
        ctx.prefs.vehicle === 'car' ? h('div', { class: 'mx-seg' }, Object.entries(ctx.CAR_MODELS).map(([k, c]) => h('button', { class: 'mx-sb' + ((ctx.prefs.carModel || 'revuelto') === k ? ' on' : ''), type: 'button', title: c.about, onclick: () => { ctx.setCarModel(k); show('worlds'); } }, c.emoji + ' ' + c.name))) : null,
        ctx.prefs.vehicle === 'car' && ctx.paintable(ctx.prefs.carModel || 'revuelto') ? h('div', { class: 'mx-paints' }, Object.entries(ctx.CAR_PAINTS).map(([k, p]) => h('button', { class: 'mx-paint' + (ctx.prefs.carPaint === k ? ' on' : ''), type: 'button', title: p.name, 'aria-label': p.name, style: { '--c': p.color }, onclick: () => { ctx.setCarPaint(k); show('worlds'); } }))) : null,
        h('small', {}, ctx.prefs.vehicle === 'car' ? 'W/S drive · A/D steer · Q handbrake (drift) · Space turbo · Q/E tip the nose in the air' : 'Challenges and races always use the bike')),
      // all the worlds at once, in a grid (no scrolling down a long list)
      h('div', { class: 'mx-wgrid' }, list.map((w) => { const [c, e] = WORLD_LOOK[w.id] || ['green', '🗺️'];
        return card2(c, e, w.name, what(w), () => start(w), { on: w === sel, sticker: w === sel ? 'LAST RIDDEN' : NEW_WORLDS.includes(w.id) ? 'NEW' : null, stickerCls: w === sel ? 'dark' : null }); })),
      note(mtb ? 'Every world is rideable on a mountain bike: the Wildwood Bike Park is made for it. Climb, then fly down. Grab the gold coins and land flips for Unrevvd coins, and the flag button starts a mini race. R returns to a safe pad, M opens the map (pick a place to fast-travel up the hill).'
        : 'Grab the gold coins on the trails and over the jumps, land flips and finish mini races to earn coins, then buy faster engines in the garage (free ride only). Space / Shift for turbo, R returns to a safe pad, the flag button starts a mini race.'));
  }

  /** The challenges (mtb: Unrevvd's, on mountain bikes). */
  function challengesScreen(mtb) {
    back = () => show(mtb ? 'mtb' : 'home');
    const list = ctx.challenges.filter((c) => (c.vehicle === 'mtb') === mtb);
    if (!list.length) return h('div', { class: 'mx-col' }, backBtn('Challenges'), note('The challenges couldn’t load. Try again in a moment.'));
    const key = mtb ? 'mtbChallenge' : 'challenge';
    const sel = list.find((c) => c.id === ctx.prefs[key]) || list[0];
    const pick = (c) => { if (c === sel) { ctx.startChallengeSolo(c); return; } ctx.prefs[key] = c.id; ctx.savePrefs(); Sfx.play('click'); show(screen); };
    primary = () => ctx.startChallengeSolo(sel);
    const friends = async () => { ctx.challengeFriends(sel); await create(); };
    // the picked challenge (and its buttons) beside a compact grid of all of them
    const best = ctx.challengeBest(sel.id); const world = (ctx.worlds.find((w) => w.id === sel.world) || {}).name || sel.world;
    return h('div', { class: 'mx-col wide' },
      backBtn(mtb ? 'Unrevvd challenges' : 'Challenges'),
      h('div', { class: 'mx-chsplit' },
        h('div', { class: 'mx-chpick' },
          h('div', { class: 'mx-glass mx-chdetail' },
            h('span', { class: 'e' }, sel.emoji), h('b', {}, sel.name),
            h('small', {}, `${world} · ${KIND[sel.kind]}${sel.kind === 'race' ? '' : ` · ${sel.limit} s`}`),
            h('p', {}, sel.about),
            h('span', { class: 'best' }, best != null ? `Your best: ${ctx.fmtScore(sel.kind, best)}` : 'Not tried yet')),
          go('Ride it solo', 'Beat your best, earn coins', () => ctx.startChallengeSolo(sel)),
          card2('purple', '📡', 'Challenge friends', 'Make a room: everyone rides it at the same time', friends, { wide: true })),
        h('div', { class: 'mx-chlist grid' }, list.map((c) => challengeChip(c, c === sel, () => pick(c), false)))),
      note(mtb ? 'Everyone rides with stock legs in Unrevvd challenges, so it’s fair. Crash and you go back to where you last were on your wheels.'
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
        go(mode === 'solo' ? 'Ride' : 'Race', mode === 'solo' ? 'Pick a track' : 'Make a room or join friends', next),
        card2('green', '🏍️', 'Garage', `${Object.keys(ctx.MODELS).length} bikes · ${Object.keys(ctx.KITS).length - 1} rider kits · ${have} / ${ctx.bikeList.length || 1} paint jobs`, () => show('garage'), { wide: true, sticker: (ctx.MODELS[ctx.style.model] || {}).name || paint(ctx.myLivery()).name, stickerCls: 'dark' }));
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
    challenges() { return challengesScreen(false); },
    mtbchallenges() { return challengesScreen(true); },

    /** Unrevvd: mountain bikes. Free ride (its own bike park and every Revvd world), challenges and the bike shop. */
    mtb() {
      back = () => show('home');
      const C = ctx.Coins.MTB; const wl = C.wallet(); const part = C.current(wl.engine);
      const wild = ctx.worlds.find((w) => w.bike) || ctx.worlds[0];
      const chs = ctx.challenges.filter((c) => c.vehicle === 'mtb');
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
        note('W pedals: easy on the flat, hard work up a hill, and downhill you fly. Space / Shift sprints (it refills when you let go). Q / E lean and flip, 1–6 for tricks. Unrevvd has its own coins: earn them riding and spend them in the bike shop.'));
    },

    /** Unrevvd's bike shop: which mountain bike, and the upgrades (bought with Unrevvd coins, free ride only). */
    mtbgarage() {
      back = () => show('mtb');
      const C = ctx.Coins.MTB; let panel; let name; let sub = '';
      const TABS = [['bike', '🚵 Bike'], ['parts', '⚡ Upgrades']];
      if (shopTab === 'parts') {
        panel = shopPanel(C, 'Bike upgrades', (e) => `${e.about} · ${e.top[0]} km/h on the flat (${e.top[1]} sprinting)`,
          'Upgrades only work in free ride. Unrevvd challenges use stock legs so nobody can buy a win. Earn Unrevvd coins by grabbing the gold coins, riding, landing flips and in challenges.');
        const eq = C.current(); name = `${eq.emoji} ${eq.name}`; sub = `${eq.top[0]} KM/H · ${eq.top[1]} SPRINTING`;
      } else {
        const id = ctx.MTB_MODELS[ctx.prefs.mtbModel] ? ctx.prefs.mtbModel : Object.keys(ctx.MTB_MODELS)[0];
        panel = glass('Mountain bikes', 'only looks: they all ride the same', h('div', { class: 'mx-liveries' }, Object.entries(ctx.MTB_MODELS).map(([k, m]) => h('button', {
          class: 'mx-livery' + (k === id ? ' on' : ''), type: 'button', style: { '--c1': '#000', '--c2': '#000' }, title: m.about, onclick: () => ctx.setMtbModel(k) },
        k === id ? h('span', { class: 'eq' }, 'ON') : null, h('b', { class: 'emo' }, m.emoji), h('span', {}, m.name)))),
        note('Your rider, kit, helmet and number are the same as in the Revvd garage.'),
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
        h('div', { class: 'mx-col mid' }, backBtn('Garage'),
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
            h('div', { class: 'mx-lab' }, 'CAMERA'), seg([['chase', '🎥 Chase'], ['side', '📺 Side'], ['close', '🎬 Close']], ctx.prefs.cam, ctx.setCam),
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
            h('li', {}, 'Unrevvd (mountain bikes): W pedals, Space / Shift sprints. Climbing is hard work, so the map’s fast travel can take you up the hill.')))),
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
    const myRide = ctx.prefs.vehicle === 'car' || ctx.prefs.vehicle === 'mtb' ? ctx.prefs.vehicle : 'bike';
    const rideSeg = mode === 'free' ? [h('div', { class: 'mx-lab' }, 'YOU RIDE'), h('div', { class: 'mx-seg' }, [['bike', '🏍️ Dirt bike'], ['mtb', '🚵 Mountain bike'], ['car', '🏎️ Supercar']].map(([k, label]) => h('button', {
      class: 'mx-sb' + (k === myRide ? ' on' : ''), type: 'button', onclick: () => { if (k !== myRide) { ctx.setVehicle(k); roomUpdate(); } } }, label)))] : null;
    fill(roomEls.track, h('div', { class: 'mx-h' }, isCh ? 'Challenge' : mode === 'free' ? 'World' : 'Track', h('span', { class: 'n' }, host ? 'you pick' : 'the host picks')), seg, rideSeg,
      mode === 'free'
        ? h('div', { class: 'mx-chlist' }, ctx.worlds.map((w) => worldChip(w, st.settings.world === w.id,
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
  const TABS = [['ride', '🏁', 'Ride'], ['mtb', '🚵', 'Unrevvd'], ['garage', '🏍️', 'Garage'], ['boards', '🏆', 'Leaderboards'], ['controls', '🎮', 'Controls']];
  const tabOf = (s) => (['garage', 'boards', 'controls'].includes(s) ? s : /^mtb/.test(s || '') ? 'mtb' : 'ride');
  const logoEl = document.querySelector('.mx-logo b');
  function drawTabs() {
    fill(tabsEl, TABS.map(([k, e, label]) => h('button', { class: 'mx-tab' + (tabOf(screen) === k ? ' on' : ''), type: 'button',
      onclick: () => { Sfx.play('click'); if (k === 'ride') show(inRoom() ? 'room' : 'home'); else show(k); } },
    h('span', { class: 'ph' }, e), label, k === 'ride' && inRoom() ? h('span', { class: 'new' }, Room.code) : null, k === 'mtb' ? h('span', { class: 'new' }, 'NEW') : null)));
    // the logo: UNREVVD on Unrevvd's screens
    const un = tabOf(screen) === 'mtb';
    if (logoEl && logoEl.classList.contains('un') !== un) { fill(logoEl, un ? 'UNRE' : 'RE', h('i', {}, 'VV'), 'D'); logoEl.classList.toggle('un', un); }
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
