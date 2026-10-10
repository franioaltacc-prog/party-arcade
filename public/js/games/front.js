/* Front Wars: grab land, build cities, send boats and nukes (inspired by OpenFront.io).
   Solo vs bots, or online with friends and bots: free-for-all or teams. The rules live in
   front-core.js; online, the server sends everyone's moves 10x a second and every browser
   runs the same simulation. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store, Account } = PA;
  const FX = PA.FX || {};
  const F = window.FrontCore;
  const Room = window.Room;

  const short = (n) => {
    n = Math.max(0, Math.floor(n));
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(n);
  };
  const pct = (x) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
  const TERRAIN_NAME = ['water', 'plains', 'hills', 'mountains'];
  const TEAM_COLOR = ['#f43f5e', '#3b82f6', '#22c55e', '#eab308'];
  const SIZE_LABEL = { small: 'Small', medium: 'Medium', large: 'Large' };
  const STYLE_LABEL = { continents: '🌍 Continents', islands: '🏝️ Islands', pangaea: '🗺️ One big land' };
  const LEVEL_LABEL = { easy: '😌 Easy', medium: '😐 Medium', hard: '😈 Hard' };
  const TOOLS = [
    ['city', '🏙️', 'City', 'More troops and gold (1)'],
    ['post', '🛡️', 'Defense', 'Land near it is much harder to take (2)'],
    ['port', '⚓', 'Port', 'On your coast: brings in trade gold and builds warships (3)'],
    ['warship', '🚢', 'Warship', 'Click the sea: it sails there, guards it and sinks enemy boats — needs a port (4)'],
    ['silo', '🚀', 'Silo', 'Lets you launch nukes (5)'],
    ['nuke', '☢️', 'Nuke', 'Wipe out an area — needs a silo (6)'],
  ];
  const BUILD_EMOJI = { city: '🏙️', post: '🛡️', silo: '🚀', port: '⚓' };

  // ================================================================ screens
  const SCREENS = ['entry', 'setup', 'room', 'play'];
  function showScreen(name) {
    for (const s of SCREENS) $('#' + s).classList.toggle('hidden', s !== name);
    if (name === 'play') requestAnimationFrame(() => view.resize());
  }

  // ================================================================ the game session
  let S = null;   // { g, mode: 'solo'|'online', me, pending, incoming, ... }
  let ratio = store.get('front_ratio', 30);
  let tool = null;

  function startSession(cfg, mode, me, turns) {
    const g = F.createGame(cfg);
    g.track = true;
    S = {
      g, cfg, mode, me, pending: [], incoming: turns || [], over: false, paused: false, speed: 1, acc: 0,
      lastFrame: performance.now(), lastStep: performance.now(), troopsAgo: [], knockedOut: false, watching: false,
      expect: (turns && turns.length ? turns[turns.length - 1].n : 0) + 1, reported: false,
      log: [],   // every move, by tick, for the replay
    };
    tool = null;
    view.attach(g);
    fill($('#over'));
    $('#over').classList.add('hidden');
    renderTools();
    renderControls();
    showScreen('play');
    $('#play').classList.toggle('with-chat', mode === 'online');
    $('#play-chat').classList.toggle('hidden', mode !== 'online');
  }

  function myPlayer() { return S && S.me ? S.g.players[S.me] : null; }
  function canAct() { const p = myPlayer(); return S.mode !== 'replay' && p && p.alive && !S.g.winner && !(S.mode === 'solo' && S.paused); }
  const ffa = () => S && S.cfg.mode !== 'teams';
  const isAlly = (p) => S && S.me && p && p !== S.me && F.allied(S.g, S.me, p);

  /** A little card about another player: their stats and alliance buttons. */
  let cardFor = 0;
  function playerCard(p) {
    cardFor = p;
    renderCard();
  }
  function renderCard() {
    const el = $('#card');
    const g = S && S.g;
    const pl = g && cardFor ? g.players[cardFor] : null;
    if (!pl) { el.classList.add('hidden'); cardFor = 0; return; }
    const me = myPlayer();
    const asked = g.requests.some((r) => r.from === S.me && r.to === cardFor);
    const asksMe = g.requests.some((r) => r.from === cardFor && r.to === S.me);
    const btns = [];
    if (me && me.alive && pl.alive && cardFor !== S.me && ffa() && canAct()) {
      if (isAlly(cardFor)) btns.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { act({ k: 'unally', p: cardFor }); Sfx.play('wrong'); } }, '💔 Break alliance'));
      else if (asksMe) btns.push(h('button', { class: 'btn btn-lime btn-sm', onclick: () => { act({ k: 'ally', p: cardFor }); Sfx.play('coin'); } }, '✅ Accept alliance'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ k: 'decline', p: cardFor }) }, '❌ No thanks'));
      else if (asked) btns.push(h('button', { class: 'btn btn-ghost btn-sm', disabled: true }, '⏳ Asked…'));
      else btns.push(h('button', { class: 'btn btn-cyan btn-sm', onclick: () => { act({ k: 'ally', p: cardFor }); Sfx.play('click'); float(innerWidth / 2, 120, '🤝 Asked!'); } }, '🤝 Ask to team up'));
    }
    if (pl.alive) btns.push(h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const c = F.centerTile(g, cardFor); if (c >= 0) view.focus(c); } }, '🎯 Show'));
    const status = !pl.alive ? '💀 Knocked out' : cardFor === S.me ? '⭐ That’s you' : isAlly(cardFor) ? (ffa() ? '🤝 Your ally' : '🤝 Teammate')
      : asksMe ? '💬 Wants to team up with you' : asked ? '⏳ You asked to team up' : '⚔️ Not allied';
    fill(el, h('div', { class: 'fw-card-head' }, h('span', { class: 'dot', style: { background: pl.color } }), h('b', {}, pl.name),
      h('button', { class: 'icon-btn fw-x', 'aria-label': 'Close', onclick: () => { cardFor = 0; renderCard(); } }, '✕')),
    h('div', { class: 'small muted' }, `🪖 ${short(pl.troops)} · 🗺️ ${pct(F.share(g, cardFor))}${pl.team ? ' · Team ' + F.TEAM_NAMES[pl.team - 1] : ''}`),
    h('div', { class: 'small' }, status),
    btns.length ? h('div', { class: 'fw-card-btns' }, btns) : null);
    el.classList.remove('hidden');
  }

  /** Send a move: solo keeps it for the next tick, online it goes to the server. */
  function act(it) {
    if (!canAct()) return;
    if (S.mode === 'solo') S.pending.push([S.me, it]);
    else Net.send('g:do', { it });
  }

  function stepGame(intents, quiet) {
    const before = S.g.tick;
    F.step(S.g, intents);
    if (intents.length && S.log && S.g.tick !== before) S.log.push([S.g.tick, intents]);
    S.lastStep = performance.now();
    const events = S.g.events.splice(0);
    if (!quiet) for (const e of events) onEvent(e);
    if (S.mode === 'online' && S.me && S.g.tick % 100 === 0) Net.send('g:hash', { n: S.g.tick, h: F.hash(S.g) });
    if (S.g.winner && !S.over) gameOver();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!S) return;
    const dt = Math.min(250, now - S.lastFrame);
    S.lastFrame = now;
    if (S.mode === 'replay') {
      if (S.playing && S.g.tick < S.end) {
        S.acc += dt * S.speed;
        let n = 0;
        while (S.acc >= F.TICK_MS && S.g.tick < S.end && n < 400) { S.acc -= F.TICK_MS; replayStep(S.speed <= 8); n++; }
        if (S.g.tick >= S.end) { S.playing = false; renderControls(); }
      } else S.acc = 0;
    } else if (S.mode === 'solo') {
      if (!S.paused && !S.g.winner) {
        S.acc += dt * S.speed;
        let n = 0;
        while (S.acc >= F.TICK_MS && n < 10) { S.acc -= F.TICK_MS; stepGame(S.pending.splice(0), false); n++; }
        if (n >= 10) S.acc = 0;
      }
    } else {
      const t0 = performance.now();
      const behind = S.incoming.length;
      while (S.incoming.length && performance.now() - t0 < 30) {
        const turn = S.incoming.shift();
        stepGame(turn.i, S.incoming.length > 4);
      }
      if (behind > 20 || S.incoming.length > 20) banner(`⏳ Catching up… ${S.incoming.length} steps to go`);
      else if (S.catching) banner(null);
      S.catching = S.incoming.length > 20;
    }
    view.draw(now);
    if (now - (S.hudAt || 0) > 250) { S.hudAt = now; renderHud(); }
  }
  requestAnimationFrame(frame);
  // a hidden browser tab doesn't draw frames, but online games must keep up (so this browser can
  // still check the results with everyone else): catch up once a second in the background
  setInterval(() => {
    if (!S || S.mode !== 'online' || !document.hidden) return;
    while (S.incoming.length) stepGame(S.incoming.shift().i, true);
  }, 1000);

  // ================================================================ things happening
  function nameOf(p) { const pl = S.g.players[p]; return pl ? pl.name : 'Nobody'; }
  function onEvent(e) {
    const me = S.me;
    if (e.type === 'nuke') {
      view.boom(e.tile);
      Sfx.play('boom');
      if (e.by !== me && view.ownedNear(e.tile, me)) UI.toast(`☢️ ${nameOf(e.by)} nuked you!`, 'bad', 3000);
    } else if (e.type === 'launch') {
      Sfx.play('swoosh');
      view.warn(e.tile);
      if (e.by !== me && S.g.owner[e.tile] === me) UI.toast(`🚨 Incoming nuke from ${nameOf(e.by)}!`, 'bad', 3000);
    } else if (e.type === 'landed') {
      if (e.by === me) Sfx.play('pop');
      else if (S.g.owner[e.tile] === me || view.ownedNear(e.tile, me)) UI.toast(`⛵ ${nameOf(e.by)} landed on your coast!`, 'bad', 2500);
    } else if (e.type === 'built' && e.by === me) {
      Sfx.play('coin');
    } else if (e.type === 'capture') {
      if (e.by === me) UI.toast(`🎉 You captured a ${e.b === 'post' ? 'defense post' : e.b}!`, 'good', 2000);
      else if (e.from === me) UI.toast(`😱 ${nameOf(e.by)} took your ${e.b === 'post' ? 'defense post' : e.b}!`, 'bad', 2500);
    } else if (e.type === 'out') {
      if (e.who === me) knockedOut();
      else UI.toast(`💀 ${nameOf(e.who)} was knocked out`, '', 2000);
    } else if (e.type === 'request') {
      if (e.to === me) { Sfx.play('message'); }
    } else if (e.type === 'allied') {
      if (e.a === me || e.b === me) { Sfx.play('coin'); UI.toast(`🤝 You and ${nameOf(e.a === me ? e.b : e.a)} are now allies!`, 'good', 3000); }
      else UI.toast(`🤝 ${nameOf(e.a)} and ${nameOf(e.b)} teamed up`, '', 2000);
    } else if (e.type === 'betrayed') {
      if (e.of === me) { Sfx.play('wrong'); UI.toast(`💔 ${nameOf(e.by)} broke your alliance!`, 'bad', 3500); }
      else if (e.by === me) UI.toast(`💔 You broke your alliance with ${nameOf(e.of)}`, '', 2500);
      else UI.toast(`💔 ${nameOf(e.by)} betrayed ${nameOf(e.of)}!`, '', 2000);
    } else if (e.type === 'declined') {
      if (e.of === me) UI.toast(`🙅 ${nameOf(e.by)} said no thanks`, '', 2500);
    } else if (e.type === 'warship') {
      if (e.by === me) Sfx.play('coin');
    } else if (e.type === 'shot') {
      view.shot(e.from, e.to, e.by);
    } else if (e.type === 'sunk') {
      const what = e.what === 'boat' ? 'boat' : 'warship';
      if (e.of === me) { Sfx.play('boom'); UI.toast(`🌊 ${nameOf(e.by)} sank your ${what}!`, 'bad', 2500); }
      else if (e.by === me) { Sfx.play('right'); UI.toast(`💥 You sank ${nameOf(e.of)}’s ${what}!`, 'good', 2000); }
    }
    if (cardFor) renderCard();
  }

  function knockedOut() {
    if (S.knockedOut) return;
    S.knockedOut = true;
    tool = null;
    Sfx.play('lose');
    if (!S.g.winner) UI.toast('💀 You were knocked out! You can keep watching your team.', 'bad', 3500);
  }

  function iWon() {
    const w = S.g.winner; const me = myPlayer();
    if (!w || !me) return false;
    return w.player === S.me || (w.team && w.team === me.team) || (w.players && w.players.includes(S.me));
  }
  function winnerName() {
    const w = S.g.winner;
    if (!w) return '';
    if (w.players) return w.players.map((p) => nameOf(p).replace('🤖 ', '')).join(' & ') + (w.players.length > 1 ? ' (alliance)' : '');
    return w.team ? `Team ${F.TEAM_NAMES[w.team - 1]}` : nameOf(w.player);
  }
  const winnerShare = (g) => (g.winner.team ? F.teamShare(g, g.winner.team) : g.winner.players ? g.winner.players.reduce((n, p) => n + F.share(g, p), 0) : F.share(g, S.me));

  function gameOver() {
    S.over = true;
    tool = null;
    const g = S.g;
    const won = iWon();
    if (S.mode === 'online' && S.me && !S.reported) {
      S.reported = true;
      const shares = {};
      for (const p of g.players) if (p && p.human) shares[p.id] = +F.share(g, p.id).toFixed(4);
      Net.send('g:over', { w: g.winner, tick: g.tick, shares, names: g.players.slice(1).map((p) => p.name) });
    }
    if (won) {
      Sfx.play('win');
      UI.confetti(240);
      if (FX.banner) FX.banner('🏆 VICTORY!', g.winner.players && g.winner.players.length > 1 ? 'You won together with your allies!' : `${pct(winnerShare(g))} of the world is yours`, { color: '#facc15' });
      if (S.mode === 'solo' && S.cfg.bots > 0) Account.submit('front-solo', S.cfg.bots);
    } else if (S.me) Sfx.play('lose');
    const minutes = Math.max(1, Math.round((g.tick - g.spawnEnd) / 600));
    fill($('#over'), h('div', {},
      h('h2', { style: { color: won ? '#facc15' : '#fff' } }, won ? '🏆 You win!' : `👑 ${winnerName()} wins!`),
      h('p', {}, won ? `You conquered the world in ${minutes} min. 🎉`
        : S.knockedOut ? `You were knocked out after ${Math.max(1, Math.round(((S.g.players[S.me].outTick || S.g.tick) - S.g.spawnEnd) / 600))} min. Better luck next time!`
          : S.me ? 'Better luck next time!' : `After ${minutes} min of fighting.`),
      S.mode === 'solo'
        ? h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('button', { class: 'btn btn-pink btn-lg', onclick: () => startSolo(S.cfg.settings) }, '🔁 Play again'),
          replayButton(),
          h('button', { class: 'btn btn-ghost', onclick: openSetup }, '⚙️ Change settings'))
        : h('p', { class: 'small muted' }, 'Saving the results…')));
    $('#over').classList.remove('hidden');
    if (FX.pop) FX.pop($('#over').firstChild, { from: 0.8 });
  }

  // ================================================================ replay
  // The game is deterministic, so a replay just plays all the recorded moves again from the start.
  function startReplay() {
    const done = S.mode === 'replay' ? S.done : S;
    S = {
      g: null, cfg: done.cfg, mode: 'replay', me: done.me, done, log: done.log, li: 0, end: done.g.tick,
      speed: 8, playing: true, acc: 0, lastFrame: performance.now(), lastStep: performance.now(), troopsAgo: [], over: true,
    };
    replaySeek(0);
    tool = null; cardFor = 0; renderCard();
    $('#over').classList.add('hidden');
    renderTools(); renderControls();
    Sfx.play('swoosh');
  }
  function replayStep(effects) {
    const T = S.g.tick + 1;
    const moves = S.li < S.log.length && S.log[S.li][0] === T ? S.log[S.li++][1] : [];
    F.step(S.g, moves);
    S.lastStep = performance.now();
    const events = S.g.events.splice(0);
    if (effects) for (const e of events) if (e.type === 'nuke') view.boom(e.tile); else if (e.type === 'shot') view.shot(e.from, e.to);
  }
  function replaySeek(tick) {
    const g = F.createGame(S.cfg);
    S.g = g; S.li = 0;
    g.track = false;
    while (g.tick < tick) replayStep(false);
    g.track = true;
    g.dirty.length = 0;
    view.attach(g);
  }
  function exitReplay() {
    if (!S || S.mode !== 'replay') return;
    S = S.done;
    view.attach(S.g);
    S.g.dirty.length = 0;
    banner(null);
    renderTools(); renderControls();
    $('#over').classList.remove('hidden');
  }
  const clock = (ticks) => { const sec = Math.max(0, Math.floor(ticks / 10)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  const replayButton = () => h('button', { class: 'btn btn-yellow', onclick: startReplay }, '🎬 Watch the replay');

  function banner(text) {
    const el = $('#banner');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  // ================================================================ clicking the map
  function clickTile(t, sx, sy) {
    if (!S || t < 0 || S.mode === 'replay') return;
    const g = S.g;
    const me = myPlayer();
    if (!me) return;
    if (g.tick <= g.spawnEnd) {
      if (!g.terrain[t]) { float(sx, sy, '🌊 Pick land!'); return; }
      if (g.owner[t] && g.owner[t] !== S.me) { float(sx, sy, '🚫 Taken!'); return; }
      act({ k: 'spawn', t });
      Sfx.play('pop');
      return;
    }
    if (!canAct()) return;
    if (tool) {
      if (tool === 'warship') {
        if (!me.nPort) { UI.toast('⚓ Build a port on your coast first!', 'bad'); return; }
        if (g.terrain[t]) { float(sx, sy, '🌊 Click the sea'); return; }
        if (me.gold < F.COST.warship) { float(sx, sy, `💰 A warship costs ${short(F.COST.warship)}`); return; }
        if (g.warships.filter((w) => w.owner === S.me).length >= F.MAX_WARSHIPS) { float(sx, sy, `🚢 Max ${F.MAX_WARSHIPS} warships`); return; }
        if (!F.warshipRoute(g, S.me, t)) { float(sx, sy, '🌊 Your ships can’t sail there'); return; }
        act({ k: 'warship', t });
        float(sx, sy, '🚢 Setting sail!');
        if (!keepTool) { tool = null; renderTools(); }
        return;
      }
      if (tool === 'nuke') {
        if (!me.nSilo) { UI.toast('🚀 Build a missile silo first!', 'bad'); return; }
        if (me.gold < F.COST.nuke) { UI.toast(`💰 A nuke costs ${short(F.COST.nuke)} gold`, 'bad'); return; }
        act({ k: 'nuke', t });
        float(sx, sy, '☢️ Launching!');
      } else {
        if (g.owner[t] !== S.me) { float(sx, sy, '🚫 Build on your own land'); return; }
        if (!F.canBuild(g, S.me, tool, t)) {
          float(sx, sy, me.gold < F.buildCost(g, S.me, tool) ? '💰 Not enough gold' : tool === 'port' && !F.isCoast(g, t) ? '⚓ Ports go right on the coast' : '📏 Too close to another building');
          return;
        }
        act({ k: 'build', b: tool, t });
        float(sx, sy, BUILD_EMOJI[tool] + ' Building!');
      }
      if (!keepTool) { tool = null; renderTools(); }
      return;
    }
    if (!g.terrain[t]) return;
    const o = g.owner[t];
    if (o === S.me) return;
    if (o && F.allied(g, S.me, o)) { float(sx, sy, ffa() ? '🤝 Your ally!' : '🤝 Teammate!'); playerCard(o); return; }
    const troops = Math.floor(me.troops * ratio / 100);
    if (F.sharesBorder(g, S.me, o)) {
      act({ k: 'attack', t, r: ratio });
      float(sx, sy, `⚔️ ${short(troops)}`);
      Sfx.play('click');
    } else if (F.landingTile(g, S.me, t) >= 0 && hasCoast()) {
      if (S.g.boats.filter((b) => b.owner === S.me).length >= F.MAX_BOATS) { float(sx, sy, `⛵ Max ${F.MAX_BOATS} boats at once`); return; }
      act({ k: 'boat', t, r: ratio });
      float(sx, sy, `⛵ ${short(troops)}`);
      Sfx.play('swoosh');
    } else float(sx, sy, '🚫 Can’t reach there');
  }
  let keepTool = false;
  function hasCoast() {
    for (const b of S.g.borders[S.me]) if (F.isCoast(S.g, b)) return true;
    return false;
  }
  function float(x, y, text) {
    const el = h('div', { class: 'fw-float', style: { left: x + 'px', top: y + 'px' } }, text);
    $('#stage').append(el);
    setTimeout(() => el.remove(), 900);
  }

  // ================================================================ the map view
  const view = (() => {
    const cv = $('#cv');
    const ctx = cv.getContext('2d');
    let g = null;
    let terrC = null; let ownC = null; let ownCtx = null; let ownImg = null; let own32 = null;
    let fillCol = []; let edgeCol = []; let rgb = [];
    let cam = { x: 0, y: 0, z: 4 };
    let fitZ = 1;
    let cw = 1; let ch = 1; let dpr = 1;
    let labels = []; let labelsAt = 0; let dist = null;
    const booms = []; const warns = []; const shots = [];
    let hover = -1; let mouse = null;

    function resize() {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(1, r.width); ch = Math.max(1, r.height);
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      if (g) { const old = fitZ; fitZ = Math.min(cw / g.W, ch / g.H); if (cam.z === old || cam.z < fitZ * 0.9) cam.z = fitZ; clampCam(); }
    }
    new ResizeObserver(resize).observe(cv);

    function parse(color) {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = color;
      const v = c.fillStyle;   // normalised to #rrggbb
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    }
    const pack = (r, gg, b, a) => ((a << 24) | (b << 16) | (gg << 8) | r) >>> 0;

    function attach(game) {
      g = game;
      // terrain picture: deep and shallow water, plains, hills, mountains
      terrC = document.createElement('canvas'); terrC.width = g.W; terrC.height = g.H;
      const tctx = terrC.getContext('2d');
      const img = tctx.createImageData(g.W, g.H);
      const d32 = new Uint32Array(img.data.buffer);
      const near = new Uint8Array(g.N);
      for (let t = 0; t < g.N; t++) {
        if (g.terrain[t]) continue;
        const x = t % g.W; const y = (t - x) / g.W;
        for (let dy = -2; dy <= 2 && !near[t]; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx; const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < g.W && yy < g.H && g.terrain[yy * g.W + xx]) { near[t] = 1; break; }
        }
      }
      for (let t = 0; t < g.N; t++) {
        const k = g.terrain[t];
        const n = (((t * 2654435761) >>> 0) % 7) - 3;   // a little texture
        if (!k) d32[t] = near[t] ? pack(22, 52, 98, 255) : pack(9, 22, 52 + n, 255);
        else if (k === 1) d32[t] = pack(58 + n, 92 + n, 62 + n, 255);
        else if (k === 2) d32[t] = pack(96 + n, 104 + n, 70, 255);
        else d32[t] = pack(150 + n * 2, 148 + n * 2, 140 + n * 2, 255);
      }
      tctx.putImageData(img, 0, 0);
      ownC = document.createElement('canvas'); ownC.width = g.W; ownC.height = g.H;
      ownCtx = ownC.getContext('2d');
      ownImg = ownCtx.createImageData(g.W, g.H);
      own32 = new Uint32Array(ownImg.data.buffer);
      rgb = g.players.map((p) => (p ? parse(p.color) : [0, 0, 0]));
      fillCol = rgb.map(([r, gg, b]) => pack(r, gg, b, 120));
      edgeCol = rgb.map(([r, gg, b]) => pack(Math.min(255, r + 30), Math.min(255, gg + 30), Math.min(255, b + 30), 235));
      for (let t = 0; t < g.N; t++) paint(t);
      ownCtx.putImageData(ownImg, 0, 0);
      g.dirty.length = 0;
      dist = new Uint16Array(g.N);
      labels = []; labelsAt = 0;
      booms.length = 0; warns.length = 0;
      resize();
      fitZ = Math.min(cw / g.W, ch / g.H);
      cam = { x: g.W / 2, y: g.H / 2, z: fitZ };
    }

    function paint(t) {
      const o = g.owner[t];
      if (!o) { own32[t] = 0; return; }
      const W = g.W; const x = t % W;
      const edge = (x > 0 && g.owner[t - 1] !== o && g.terrain[t - 1]) || (x < W - 1 && g.owner[t + 1] !== o && g.terrain[t + 1])
        || (t >= W && g.owner[t - W] !== o && g.terrain[t - W]) || (t < g.N - W && g.owner[t + W] !== o && g.terrain[t + W]);
      own32[t] = edge ? edgeCol[o] : fillCol[o];
    }
    function flush() {
      const d = g.dirty;
      if (!d.length) return;
      const W = g.W;
      for (const t of d) {
        paint(t);
        const x = t % W;
        if (x > 0) paint(t - 1);
        if (x < W - 1) paint(t + 1);
        if (t >= W) paint(t - W);
        if (t < g.N - W) paint(t + W);
      }
      d.length = 0;
      ownCtx.putImageData(ownImg, 0, 0);
    }

    // where each country's name goes: the spot deepest inside its land
    function computeLabels() {
      const N = g.N; const W = g.W; const o = g.owner; const d = dist;
      for (let t = 0; t < N; t++) {
        const p = o[t];
        if (!p) { d[t] = 0; continue; }
        const x = t % W;
        const a = x > 0 && o[t - 1] === p ? d[t - 1] : 0;
        const b = t >= W && o[t - W] === p ? d[t - W] : 0;
        d[t] = Math.min(a, b) + 1;
      }
      const best = new Int32Array(g.players.length).fill(-1);
      const bestD = new Uint16Array(g.players.length);
      for (let t = N - 1; t >= 0; t--) {
        const p = o[t];
        if (!p) continue;
        const x = t % W;
        const a = x < W - 1 && o[t + 1] === p ? d[t + 1] : 0;
        const b = t < N - W && o[t + W] === p ? d[t + W] : 0;
        const v = Math.min(d[t], Math.min(a, b) + 1);
        d[t] = v;
        if (v > bestD[p]) { bestD[p] = v; best[p] = t; }
      }
      labels = [];
      for (let p = 1; p < g.players.length; p++) if (best[p] >= 0) labels.push({ p, x: best[p] % W + 0.5, y: Math.floor(best[p] / W) + 0.5, r: bestD[p] });
    }

    const sx = (x) => (x - cam.x) * cam.z + cw / 2;
    const sy = (y) => (y - cam.y) * cam.z + ch / 2;
    function tileAt(px, py) {
      if (!g) return -1;
      const x = Math.floor((px - cw / 2) / cam.z + cam.x); const y = Math.floor((py - ch / 2) / cam.z + cam.y);
      if (x < 0 || y < 0 || x >= g.W || y >= g.H) return -1;
      return y * g.W + x;
    }
    function clampCam() {
      if (!g) return;
      cam.z = Math.max(fitZ * 0.8, Math.min(28, cam.z));
      const hw = cw / 2 / cam.z; const hh = ch / 2 / cam.z;
      cam.x = g.W <= hw * 2 ? g.W / 2 : Math.max(hw, Math.min(g.W - hw, cam.x));
      cam.y = g.H <= hh * 2 ? g.H / 2 : Math.max(hh, Math.min(g.H - hh, cam.y));
    }
    function zoomAt(px, py, f) {
      const wx = (px - cw / 2) / cam.z + cam.x; const wy = (py - ch / 2) / cam.z + cam.y;
      cam.z *= f;
      clampCam();
      cam.x = wx - (px - cw / 2) / cam.z; cam.y = wy - (py - ch / 2) / cam.z;
      clampCam();
    }
    function pan(dx, dy) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; clampCam(); }

    function emojiAt(e, x, y, size) {
      const im = PA.Emoji && PA.Emoji.image ? PA.Emoji.image(e) : null;
      if (im) ctx.drawImage(im, x - size / 2, y - size / 2, size, size);
      else { ctx.font = `${Math.round(size * 0.85)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e, x, y); }
    }

    function draw(now) {
      if (!g) return;
      flush();
      if (now - labelsAt > 400) { labelsAt = now; computeLabels(); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let shx = 0; let shy = 0;
      for (const b of booms) { const age = (now - b.at) / 1000; if (age < 0.5) { shx += (Math.random() - 0.5) * 12 * (0.5 - age); shy += (Math.random() - 0.5) * 12 * (0.5 - age); } }
      ctx.fillStyle = '#070f24';
      ctx.fillRect(0, 0, cw, ch);
      ctx.translate(shx, shy);
      ctx.imageSmoothingEnabled = false;
      const x0 = sx(0); const y0 = sy(0);
      ctx.drawImage(terrC, x0, y0, g.W * cam.z, g.H * cam.z);
      ctx.drawImage(ownC, x0, y0, g.W * cam.z, g.H * cam.z);
      const z = cam.z;
      const frac = Math.min(1, (performance.now() - S.lastStep) / (F.TICK_MS / (S.mode === 'solo' ? S.speed : 1)));

      // nuke danger zones and spawn spots
      for (let i = warns.length - 1; i >= 0; i--) if (!g.nukes.some((n) => n.to === warns[i])) warns.splice(i, 1);
      for (const n of g.nukes) {
        const x = sx((n.to % g.W) + 0.5); const y = sy(Math.floor(n.to / g.W) + 0.5);
        ctx.strokeStyle = `rgba(244, 63, 94, ${0.5 + 0.4 * Math.sin(now / 120)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(x, y, F.NUKE_RADIUS * z, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (g.tick <= g.spawnEnd) {
        for (const p of g.players) {
          if (!p || !p.spawned) continue;
          const x = sx((p.spawnTile % g.W) + 0.5); const y = sy(Math.floor(p.spawnTile / g.W) + 0.5);
          ctx.strokeStyle = p.color; ctx.lineWidth = p.id === S.me ? 3 : 1.5;
          ctx.beginPath(); ctx.arc(x, y, (5 + 2 * Math.sin(now / 200 + p.id)) * Math.max(1, z / 3), 0, Math.PI * 2); ctx.stroke();
        }
      }

      // buildings
      const bs = Math.max(11, z * 2.4);
      for (const b of g.buildings) {
        const x = sx((b.tile % g.W) + 0.5); const y = sy(Math.floor(b.tile / g.W) + 0.5);
        if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath(); ctx.arc(x, y, bs * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = g.players[b.owner].color; ctx.lineWidth = 2;
        ctx.stroke();
        emojiAt(BUILD_EMOJI[b.type], x, y, bs);
      }
      // boats
      for (const b of g.boats) {
        const a = b.path[Math.min(b.path.length - 1, b.i)];
        const c = b.path[Math.min(b.path.length - 1, b.i + 2)];
        const fx = (a % g.W) + ((c % g.W) - (a % g.W)) * frac + 0.5;
        const fy = Math.floor(a / g.W) + (Math.floor(c / g.W) - Math.floor(a / g.W)) * frac + 0.5;
        const x = sx(fx); const y = sy(fy);
        const s = Math.max(14, z * 2.6);
        ctx.fillStyle = g.players[b.owner].color;
        ctx.beginPath(); ctx.arc(x, y + s * 0.15, s * 0.42, 0, Math.PI * 2); ctx.fill();
        emojiAt('⛵', x, y, s);
        if (z > 3) { ctx.font = '700 11px Fredoka, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(short(b.troops), x, y + s * 0.9); }
      }
      // warships: a ship in its owner's colour, a health bar when hurt, and (yours) the area it guards
      for (const w of g.warships) {
        const a = w.path[Math.min(w.path.length - 1, w.i)];
        const c = w.path[Math.min(w.path.length - 1, w.i + 1)];
        const f = w.i < w.path.length - 1 ? frac : 0;
        const x = sx((a % g.W) + ((c % g.W) - (a % g.W)) * f + 0.5);
        const y = sy(Math.floor(a / g.W) + (Math.floor(c / g.W) - Math.floor(a / g.W)) * f + 0.5);
        if (x < -40 || y < -40 || x > cw + 40 || y > ch + 40) continue;
        const s2 = Math.max(16, z * 3);
        if (w.owner === S.me) {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(x, y, F.WARSHIP_RANGE * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = g.players[w.owner].color;
        ctx.beginPath(); ctx.arc(x, y + s2 * 0.12, s2 * 0.45, 0, Math.PI * 2); ctx.fill();
        emojiAt('🚢', x, y, s2);
        if (w.hp < 100) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - s2 * 0.5, y - s2 * 0.75, s2, 4);
          ctx.fillStyle = w.hp > 50 ? '#4ade80' : w.hp > 25 ? '#facc15' : '#f43f5e'; ctx.fillRect(x - s2 * 0.5, y - s2 * 0.75, s2 * w.hp / 100, 4);
        }
      }
      // cannon shots
      for (let i = shots.length - 1; i >= 0; i--) {
        const sh = shots[i];
        const age = (now - sh.at) / 1000;
        if (age > 0.35) { shots.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(253, 224, 71, ${1 - age / 0.35})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx((sh.from % g.W) + 0.5), sy(Math.floor(sh.from / g.W) + 0.5)); ctx.lineTo(sx((sh.to % g.W) + 0.5), sy(Math.floor(sh.to / g.W) + 0.5)); ctx.stroke();
      }
      // nukes in the air: an arc from the silo to the target
      for (const n of g.nukes) {
        const p = Math.min(1, (g.tick - n.t0 + frac) / (n.t1 - n.t0));
        const ax = (n.from % g.W) + 0.5; const ay = Math.floor(n.from / g.W) + 0.5;
        const bx = (n.to % g.W) + 0.5; const by = Math.floor(n.to / g.W) + 0.5;
        const len = Math.hypot(bx - ax, by - ay);
        const lift = Math.sin(Math.PI * p) * Math.max(6, len * 0.35);
        const x = sx(ax + (bx - ax) * p); const y = sy(ay + (by - ay) * p - lift);
        ctx.fillStyle = '#fde047';
        ctx.shadowColor = '#f43f5e'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(x, y, Math.max(3, z * 0.7), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
      // explosions
      for (let i = booms.length - 1; i >= 0; i--) {
        const b = booms[i];
        const age = (now - b.at) / 1000;
        if (age > 1.4) { booms.splice(i, 1); continue; }
        const x = sx((b.tile % g.W) + 0.5); const y = sy(Math.floor(b.tile / g.W) + 0.5);
        const r = F.NUKE_RADIUS * z * (0.3 + age * 1.1);
        ctx.fillStyle = `rgba(255, 220, 120, ${Math.max(0, 0.75 - age * 0.6)})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0, 1 - age)})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, Math.PI * 2); ctx.stroke();
      }
      // names and troop counts
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of labels) {
        const pl = g.players[l.p];
        const size = Math.min(34, l.r * z * 0.55);
        if (size < 7) continue;
        const x = sx(l.x); const y = sy(l.y);
        if (x < -100 || y < -40 || x > cw + 100 || y > ch + 40) continue;
        let name = (S.cfg.mode !== 'teams' && l.p !== S.me && S.me && F.allied(g, S.me, l.p) ? '🤝 ' : '') + pl.name.replace('🤖 ', '');
        ctx.font = `700 ${Math.round(size)}px Fredoka, sans-serif`;
        while (name.length > 4 && ctx.measureText(name).width > l.r * z * 2.4) name = name.slice(0, -2);
        if (!pl.name.endsWith(name.replace('🤝 ', ''))) name += '…';
        ctx.lineWidth = Math.max(2, size / 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(name, x, y - size * 0.35);
        ctx.fillStyle = l.p === S.me ? '#fde047' : '#fff';
        ctx.fillText(name, x, y - size * 0.35);
        ctx.font = `600 ${Math.round(size * 0.8)}px Fredoka, sans-serif`;
        ctx.strokeText(short(pl.troops), x, y + size * 0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(short(pl.troops), x, y + size * 0.6);
      }
      // what the mouse is over
      if (hover >= 0 && mouse) {
        const x = sx(hover % g.W); const y = sy(Math.floor(hover / g.W));
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, z, z);
        if (tool && tool !== 'nuke') { ctx.strokeStyle = 'rgba(250,204,21,0.6)'; ctx.beginPath(); ctx.arc(x + z / 2, y + z / 2, 3 * z, 0, Math.PI * 2); ctx.stroke(); }
        if (tool === 'nuke') { ctx.strokeStyle = 'rgba(244,63,94,0.8)'; ctx.beginPath(); ctx.arc(x + z / 2, y + z / 2, F.NUKE_RADIUS * z, 0, Math.PI * 2); ctx.stroke(); }
        if (tool === 'post') { ctx.strokeStyle = 'rgba(96,165,250,0.6)'; ctx.beginPath(); ctx.arc(x + z / 2, y + z / 2, F.POST_RADIUS * z, 0, Math.PI * 2); ctx.stroke(); }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // the little info box next to the mouse
    function tip() {
      const el = $('#tip');
      if (!S || !g || hover < 0 || !mouse || mouse.touch) { el.classList.add('hidden'); return; }
      const o = g.owner[hover]; const k = g.terrain[hover];
      let text;
      if (!k) text = '🌊 Sea';
      else if (!o) text = `🌿 Empty ${TERRAIN_NAME[k]}`;
      else {
        const p = g.players[o];
        text = `${p.name}${o === S.me ? ' (you)' : ''} · 🪖 ${short(p.troops)} · ${pct(F.share(g, o))}`;
        if (p.team) text += ` · ${F.TEAM_NAMES[p.team - 1]}`;
      }
      const b = g.buildingAt.get(hover);
      if (b) text += ` · ${BUILD_EMOJI[b.type]}`;
      el.textContent = text;
      el.style.left = mouse.x + 'px'; el.style.top = mouse.y + 'px';
      el.classList.remove('hidden');
    }

    // ---- mouse & touch
    const pointers = new Map();
    let down = null; let pinch = 0; let longTimer = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); down = null; clearTimeout(longTimer); return; }
      if (e.button === 2) return;
      down = { ...p, moved: false, touch: e.pointerType !== 'mouse' };
      clearTimeout(longTimer);
      if (down.touch) {   // hold a finger on someone's land to see their card (alliances)
        const d = down;
        longTimer = setTimeout(() => {
          if (down !== d || d.moved) return;
          d.long = true;
          const t = tileAt(d.x, d.y);
          if (t >= 0 && g.owner[t]) { playerCard(g.owner[t]); if (navigator.vibrate) navigator.vibrate(15); }
        }, 550);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      mouse = { ...p, touch: e.pointerType !== 'mouse' };
      hover = tileAt(p.x, p.y);
      tip();
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
        return;
      }
      if (down && (down.moved || Math.hypot(p.x - down.x, p.y - down.y) > 6)) {
        down.moved = true;
        $('#stage').classList.add('panning');
        pan(p.x - prev.x, p.y - prev.y);
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      $('#stage').classList.remove('panning');
      clearTimeout(longTimer);
      if (down && !down.moved && !down.long && e.type === 'pointerup') { const p = pos(e); clickTile(tileAt(p.x, p.y), p.x, p.y); }
      down = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!pointers.size) { hover = -1; mouse = null; tip(); } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (tool) { tool = null; renderTools(); return; }
      const p = pos(e); const t = tileAt(p.x, p.y);
      if (t >= 0 && g.owner[t]) playerCard(g.owner[t]);
    });

    return {
      attach, draw, resize, tileAt,
      zoomBy: (f) => zoomAt(cw / 2, ch / 2, f),
      pan,
      boom: (t) => booms.push({ tile: t, at: performance.now() }),
      shot: (from, to) => shots.push({ from, to, at: performance.now() }),
      warn: (t) => warns.push(t),
      ownedNear: (t, p) => {
        if (!p) return false;
        const x0 = t % g.W; const y0 = Math.floor(t / g.W);
        for (let dy = -F.NUKE_RADIUS; dy <= F.NUKE_RADIUS; dy += 2) for (let dx = -F.NUKE_RADIUS; dx <= F.NUKE_RADIUS; dx += 2) {
          const x = x0 + dx; const y = y0 + dy;
          if (x >= 0 && y >= 0 && x < g.W && y < g.H && g.owner[y * g.W + x] === p) return true;
        }
        return false;
      },
      focus: (t) => { cam.x = (t % g.W) + 0.5; cam.y = Math.floor(t / g.W) + 0.5; cam.z = Math.max(cam.z, fitZ * 2.2); clampCam(); },
      toScreen: (t) => ({ x: sx((t % g.W) + 0.5), y: sy(Math.floor(t / g.W) + 0.5) }),
    };
  })();

  // ================================================================ heads-up display
  function renderHud() {
    const g = S.g; const me = myPlayer();
    // you
    const rows = [];
    if (me && me.alive && me.spawned) {
      const max = F.maxTroops(g, S.me);
      S.troopsAgo.push(me.troops);
      if (S.troopsAgo.length > 4) S.troopsAgo.shift();
      const atk = g.attacks.filter((a) => a.att === S.me);
      const myBoats = g.boats.filter((b) => b.owner === S.me);
      rows.push(h('div', { class: 'fw-box fw-me' },
        h('span', {}, '🪖'), h('div', {}, h('div', { class: 'big' }, short(me.troops)), h('div', { class: 'sub' }, `of ${short(max)} max`)),
        h('span', {}, '💰'), h('div', { class: 'big', style: { color: '#fde68a' } }, short(me.gold)),
        h('span', {}, '🗺️'), h('div', { class: 'big', style: { color: me.color } }, pct(F.share(g, S.me)),
          h('span', { class: 'sub' }, ` · ${g.count[S.me].toLocaleString('en-US')} tiles`)),
        h('span', {}, '🏆'), h('div', { class: 'sub' }, `#${1 + g.players.filter((q) => q && q.alive && g.count[q.id] > g.count[S.me]).length} of ${g.players.filter((q) => q && q.alive).length} still in`),
        ffa() && F.alliesOf(g, S.me).length ? h('div', { class: 'fw-allies', style: { gridColumn: '1 / -1' } }, '🤝 ', F.alliesOf(g, S.me).map((q) => nameOf(q).replace('🤖 ', '')).join(', ')) : null,
        atk.length || myBoats.length ? h('div', { class: 'fw-atk', style: { gridColumn: '1 / -1' } },
          ...atk.map((a) => h('div', {}, `⚔️ ${a.target ? nameOf(a.target).replace('🤖 ', '') : 'empty land'}: ${short(a.troops)}`)),
          ...myBoats.map((b) => h('div', {}, `⛵ boat: ${short(b.troops)}`))) : null));
    } else if (me && !me.spawned) {
      rows.push(h('div', { class: 'fw-box' }, '📍 Pick a starting spot on the map!'));
    } else {
      rows.push(h('div', { class: 'fw-box' }, me ? '💀 Knocked out — watching' : '👀 Watching'));
    }
    fill($('#hud-me'), ...rows);

    // leaderboard
    const all = g.players.filter((p) => p && (p.alive || p.outTick));
    const alive = g.players.filter((p) => p && p.alive);
    const top = alive.slice().sort((a, b) => g.count[b.id] - g.count[a.id]);
    const shown = top.slice(0, 8);
    if (me && me.alive && !shown.includes(me)) shown.push(me);
    const teamRows = [];
    if (S.cfg.mode === 'teams') {
      const n = Math.max(2, Math.min(4, S.cfg.teams | 0));
      for (let t = 1; t <= n; t++) teamRows.push(h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: TEAM_COLOR[t - 1] } }), h('span', { class: 'nm' }, `Team ${F.TEAM_NAMES[t - 1]}`), h('b', {}, pct(F.teamShare(g, t)))));
    }
    fill($('#hud-lb'), h('div', { class: 'fw-box fw-lb' },
      h('h4', {}, h('span', {}, '🏆 Leaders'), h('span', { class: 'muted' }, `${alive.length}/${all.length || g.players.length - 1} left`)),
      ...teamRows,
      teamRows.length ? h('div', { style: { height: '4px' } }) : null,
      ...shown.map((p) => h('div', { class: 'row click' + (p.id === S.me ? ' me' : ''), title: 'Click for alliance options', onclick: () => playerCard(p.id) },
        h('span', { class: 'dot', style: { background: p.color } }),
        h('span', { class: 'nm' }, (ffa() && isAlly(p.id) ? '🤝 ' : '') + p.name.replace('🤖 ', '🤖')),
        h('span', {}, pct(F.share(g, p.id))))),
      ffa() ? h('div', { class: 'tm' }, '🤝 Click a name (or right-click their land) to team up') : null,
      h('div', { class: 'tm' }, `🎯 Own ${Math.round(F.WIN_SHARE * 100)}% of the land to win`)));

    // alliance requests waiting for an answer
    const asks = S.me && ffa() && S.mode !== 'replay' ? g.requests.filter((r) => r.to === S.me) : [];
    fill($('#asks'), asks.map((r) => h('div', { class: 'fw-ask' },
      h('span', { class: 'dot', style: { background: g.players[r.from].color } }),
      h('span', { class: 'grow' }, h('b', {}, nameOf(r.from).replace('🤖 ', '')), ' wants to team up! ', h('span', { class: 'muted' }, `${Math.ceil((F.REQUEST_TICKS - (g.tick - r.tick)) / 10)}s`)),
      h('button', { class: 'btn btn-lime btn-sm', onclick: () => { act({ k: 'ally', p: r.from }); Sfx.play('coin'); } }, '✅'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act({ k: 'decline', p: r.from }) }, '❌'))));
    if (cardFor) renderCard();

    if (S.mode === 'replay') {
      banner(`🎬 Replay · ${clock(g.tick)} / ${clock(S.end)}${S.g.tick >= S.end ? ' · the end' : ''}`);
      const pos = $('#replay-pos');
      if (pos && document.activeElement !== pos) pos.value = g.tick;
      return;
    }
    // spawn phase countdown
    if (g.tick <= g.spawnEnd && !S.g.winner) {
      const left = Math.ceil((g.spawnEnd - g.tick) / 10);
      banner(me && me.spawned ? `✅ Ready! The war starts in ${left}s (you can still move)` : me ? `📍 Click on land to pick your start — ${left}s` : `⏳ Players are picking their start… ${left}s`);
    } else if (!S.catching) banner(null);
    renderTools(true);
  }

  function renderTools(refresh) {
    const g = S && S.g; const me = myPlayer();
    const el = $('#tools');
    if (!g || !me || !me.alive || S.mode === 'replay') { fill(el); el.dataset.sig = ''; return; }
    const sig = [tool, S.mode, me.gold >= F.COST.nuke, me.gold >= F.COST.warship, me.nSilo, me.nPort, ...['city', 'post', 'port', 'silo'].map((b) => me.gold >= F.buildCost(g, S.me, b))].join();
    if (refresh && el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    fill(el, ...TOOLS.map(([key, e, label, hint]) => {
      const cost = F.buildCost(g, S.me, key);
      const ok = me.gold >= cost && (key !== 'nuke' || me.nSilo > 0) && (key !== 'warship' || me.nPort > 0);
      return h('button', {
        class: 'fw-tool' + (tool === key ? ' on' : ''), disabled: !ok && tool !== key, title: `${label}: ${hint}`,
        onclick: (ev) => { tool = tool === key ? null : key; keepTool = ev.shiftKey; Sfx.play('click'); renderTools(); },
      }, h('span', { class: 'e' }, e), h('span', {}, label), h('small', {}, '💰' + short(cost)));
    }));
  }

  function renderControls() {
    const el = $('#ctl');
    if (S && S.mode === 'replay') {
      const slider = h('input', { type: 'range', min: 0, max: S.end, step: 10, value: S.g.tick, id: 'replay-pos', 'aria-label': 'Replay position',
        onchange: (e) => { replaySeek(+e.target.value); renderHud(); } });
      fill(el, h('div', { class: 'fw-box fw-replay' },
        h('button', { class: 'icon-btn', title: S.playing ? 'Pause' : 'Play', 'aria-label': S.playing ? 'Pause' : 'Play', onclick: () => {
          if (!S.playing && S.g.tick >= S.end) replaySeek(0);
          S.playing = !S.playing; renderControls();
        } }, S.playing ? '⏸️' : '▶️'),
        slider,
        h('div', { class: 'seg' }, [2, 8, 32].map((v) => h('button', { class: S.speed === v ? 'on' : '', onclick: () => { S.speed = v; renderControls(); } }, `${v}×`))),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: exitReplay }, '✖ Exit replay')));
      return;
    }
    const btns = [
      h('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => view.zoomBy(1.4) }, '➕'),
      h('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => view.zoomBy(1 / 1.4) }, '➖'),
      h('button', { class: 'icon-btn', title: 'Find me', 'aria-label': 'Find me', onclick: () => { const c = S && S.me ? F.centerTile(S.g, S.me) : -1; if (c >= 0) view.focus(c); } }, '🎯'),
    ];
    if (S && S.mode === 'solo') {
      btns.push(h('button', { class: 'icon-btn', title: 'Pause (P)', 'aria-label': 'Pause', onclick: togglePause }, S.paused ? '▶️' : '⏸️'));
      btns.push(h('button', { class: 'btn btn-ghost btn-sm', title: 'Game speed', onclick: () => { S.speed = S.speed >= 3 ? 1 : S.speed + 1; renderControls(); } }, `⏩ ${S.speed}×`));
    }
    btns.push(h('button', { class: 'icon-btn', title: 'Leave', 'aria-label': 'Leave the game', onclick: leaveGame }, '🚪'));
    fill(el, ...btns);
  }
  function togglePause() {
    if (!S || S.mode !== 'solo') return;
    S.paused = !S.paused;
    banner(S.paused ? '⏸️ Paused — press P or ▶️ to carry on' : null);
    renderControls();
  }
  function leaveGame() {
    if (!S) return;
    if (S.mode === 'solo') {
      if (!S.over && !S.knockedOut && S.g.tick > S.g.spawnEnd && !confirm('Leave this game?')) return;
      S = null;
      openSetup();
    } else if (Room.code) {
      if (!confirm('Leave the room?')) return;
      S = null;
      Lobby.leave();
    }
  }

  const ratioEl = $('#ratio');
  function setRatio(v) {
    ratio = Math.max(5, Math.min(100, Math.round(v / 5) * 5));
    ratioEl.value = ratio;
    $('#ratio-val').textContent = ratio + '%';
    store.set('front_ratio', ratio);
  }
  ratioEl.addEventListener('input', () => setRatio(+ratioEl.value));
  setRatio(ratio);

  addEventListener('keydown', (e) => {
    if (!S || $('#play').classList.contains('hidden') || e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'q') setRatio(ratio - 5);
    else if (k === 'e') setRatio(ratio + 5);
    else if (k === 'p' || k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'escape') { tool = null; renderTools(); }
    else if ('123456'.includes(k) && k.length === 1) { const key = TOOLS[+k - 1][0]; tool = tool === key ? null : key; renderTools(); }
    else if (k === '+' || k === '=') view.zoomBy(1.3);
    else if (k === '-') view.zoomBy(1 / 1.3);
    else if (k === 'arrowleft' || k === 'a') view.pan(60, 0);
    else if (k === 'arrowright' || k === 'd') view.pan(-60, 0);
    else if (k === 'arrowup' || k === 'w') view.pan(0, 60);
    else if (k === 'arrowdown' || k === 's') view.pan(0, -60);
  });

  // ================================================================ solo
  let soloSettings = { bots: 10, difficulty: 'medium', size: 'medium', style: 'continents', ...store.get('front_solo', {}) };
  function openSetup() {
    S = null;
    showScreen('setup');
    renderSetup();
    history.replaceState(null, '', location.pathname + '?solo=1');
  }
  function seg(label, options, value, onPick, fmt) {
    return h('div', {}, h('div', { class: 'lbl' }, label),
      h('div', { class: 'seg' }, options.map((v) => h('button', { class: v === value ? 'on' : '', onclick: () => { onPick(v); Sfx.play('click'); } }, fmt(v)))));
  }
  function renderSetup() {
    const s = soloSettings;
    const set = (patch) => { Object.assign(s, patch); store.set('front_solo', s); renderSetup(); };
    const bots = h('input', { type: 'range', min: 1, max: 40, value: s.bots, oninput: (e) => { s.bots = +e.target.value; $('#bots-n').textContent = s.bots; store.set('front_solo', s); } });
    fill($('#setup-body'),
      h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'You against a world full of bots. Grab land, build up, and own 80% of the map to win!'),
      h('div', { class: 'fw-set' },
        h('div', {}, h('div', { class: 'lbl' }, 'BOTS'), h('div', { class: 'row', style: { alignItems: 'center', gap: '10px' } }, bots, h('b', { class: 'fw-bots', id: 'bots-n' }, s.bots))),
        seg('BOT SKILL', ['easy', 'medium', 'hard'], s.difficulty, (v) => set({ difficulty: v }), (v) => LEVEL_LABEL[v]),
        seg('MAP SIZE', ['small', 'medium', 'large'], s.size, (v) => set({ size: v }), (v) => SIZE_LABEL[v]),
        seg('MAP', ['continents', 'islands', 'pangaea'], s.style, (v) => set({ style: v }), (v) => STYLE_LABEL[v])),
      h('button', { class: 'btn btn-pink btn-lg btn-block', style: { marginTop: '18px' }, onclick: () => startSolo(s) }, '🌍 Start the war'),
      howTo());
  }
  function startSolo(s) {
    soloSettings = { ...s };
    const p = PA.Profile.get();
    const cfg = { seed: (Math.random() * 2 ** 31) | 0, size: s.size, style: s.style, mode: 'ffa', difficulty: s.difficulty, bots: s.bots,
      humans: [{ name: p.name || 'You', color: p.color }], settings: { ...s } };
    startSession(cfg, 'solo', 1);
    Sfx.play('go');
  }
  function howTo() {
    return h('div', { class: 'how-to', style: { marginTop: '16px' }, html: HOW_TO });
  }
  const HOW_TO = '<b>How to play</b><ul>'
    + '<li>📍 Pick a starting spot. Then <b>click empty land</b> to expand, and <b>click a neighbour</b> to attack them.</li>'
    + '<li>⚔️ The slider sets how many of your troops each attack uses. Troops grow back on their own — more land = more troops.</li>'
    + '<li>⛵ Click land across the sea to send a <b>boat</b> full of troops.</li>'
    + '<li>💰 Gold builds 🏙️ cities (more troops), 🛡️ defense posts, ⚓ ports (trade gold) and 🚀 silos for ☢️ nukes.</li>'
    + '<li>🚢 With a port, build <b>warships</b>: click the sea and they guard it, sinking enemy boats and warships.</li>'
    + '<li>🤝 In free-for-all, click a name in the leaderboard (or right-click / long-press their land) to <b>team up</b>. Allies can’t attack each other — and if everyone left is allied, you all win!</li>'
    + '<li>🎬 After a game, watch the <b>replay</b> to see how the map changed.</li>'
    + '<li>🏆 Own 80% of the land (or be the last one standing) to win. Mountains and hills are slower to take!</li>'
    + '<li>🖱️ Drag to move the map, scroll or pinch to zoom. Keys: Q/E attack size, 1–6 build, P pause.</li></ul>';
  $('#setup-back').addEventListener('click', () => { showScreen('entry'); Lobby.showEntry(); history.replaceState(null, '', location.pathname); });

  // ================================================================ online
  let L = { phase: 'lobby', settings: { mode: 'ffa', teams: 2, bots: 8, difficulty: 'medium', size: 'medium', style: 'continents' }, picks: {}, results: null };
  let matchId = 0;

  /** In a room: the map while we're in a game (also after it ends, until "Back to the lobby"), else the lobby. */
  function route() {
    if (!Room.code) return;
    if (S && S.mode === 'online') { showScreen('play'); return; }
    showScreen('room');
    renderLobby();
  }

  function renderLobby() {
    const host = Room.isHost;
    const s = L.settings;
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const myTeam = L.picks[Net.id] || 0;
    const teamsBox = s.mode === 'teams' ? h('div', {},
      h('div', { class: 'lbl', style: { fontSize: '.8rem', fontWeight: 700, color: 'var(--muted)', marginTop: '6px' } }, 'PICK YOUR TEAM (bots fill the gaps)'),
      h('div', { class: 'fw-teams' }, Array.from({ length: s.teams }, (_, i) => {
        const t = i + 1;
        const who = Room.players.filter((p) => L.picks[p.id] === t);
        return h('div', { class: 'fw-team', style: { '--tc': TEAM_COLOR[i] } },
          h('b', {}, `Team ${F.TEAM_NAMES[i]}`),
          h('div', { class: 'who' }, who.length ? who.map((p) => h('span', {}, `${p.avatar} ${p.name}`)) : h('span', { class: 'muted' }, 'nobody yet')),
          h('button', { class: 'btn btn-sm btn-block ' + (myTeam === t ? 'btn-ghost' : 'btn-cyan'), style: { marginTop: '8px' }, disabled: myTeam === t, onclick: () => { Net.send('g:team', { team: t }); Sfx.play('click'); } }, myTeam === t ? '✅ You’re here' : 'Join'));
      }))) : null;
    const bots = h('div', {}, h('div', { class: 'lbl' }, 'BOTS'),
      h('div', { class: 'seg' }, [0, 4, 8, 12, 20, 30, 40].map((v) => h('button', { class: s.bots === v ? 'on' : '', disabled: !host, onclick: () => send({ bots: v }) }, String(v)))));
    fill($('#room-main'),
      L.results ? resultsCard(L.results) : null,
      L.phase === 'playing' ? h('div', { class: 'fw-result' }, h('h3', {}, '⚔️ A game is running'), h('p', {}, 'Hang on — you’ll be watching in a moment.')) : null,
      h('div', { class: 'panel-title' }, '⚙️ Game settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'mode-cards' },
        h('button', { class: 'mode-card' + (s.mode === 'ffa' ? ' on' : ''), disabled: !host, onclick: () => send({ mode: 'ffa' }) }, h('b', {}, '⚔️ Free-for-all'), h('span', {}, 'Everyone for themselves — friends and bots.')),
        h('button', { class: 'mode-card' + (s.mode === 'teams' ? ' on' : ''), disabled: !host, onclick: () => send({ mode: 'teams' }) }, h('b', {}, '🤝 Teams'), h('span', {}, 'Team up with friends! Teammates can’t attack each other.'))),
      h('div', { class: 'fw-set' },
        s.mode === 'teams' ? h('div', {}, h('div', { class: 'lbl' }, 'TEAMS'), h('div', { class: 'seg' }, [2, 3, 4].map((v) => h('button', { class: s.teams === v ? 'on' : '', disabled: !host, onclick: () => send({ teams: v }) }, `${v} teams`)))) : null,
        bots,
        h('div', {}, h('div', { class: 'lbl' }, 'BOT SKILL'), h('div', { class: 'seg' }, ['easy', 'medium', 'hard'].map((v) => h('button', { class: s.difficulty === v ? 'on' : '', disabled: !host, onclick: () => send({ difficulty: v }) }, LEVEL_LABEL[v])))),
        h('div', {}, h('div', { class: 'lbl' }, 'MAP SIZE'), h('div', { class: 'seg' }, ['small', 'medium', 'large'].map((v) => h('button', { class: s.size === v ? 'on' : '', disabled: !host, onclick: () => send({ size: v }) }, SIZE_LABEL[v])))),
        h('div', {}, h('div', { class: 'lbl' }, 'MAP'), h('div', { class: 'seg' }, ['continents', 'islands', 'pangaea'].map((v) => h('button', { class: s.style === v ? 'on' : '', disabled: !host, onclick: () => send({ style: v }) }, STYLE_LABEL[v]))))),
      teamsBox,
      h('div', { style: { marginTop: '18px' } }, host
        ? h('button', { class: 'btn btn-pink btn-lg btn-block', disabled: L.phase === 'playing', onclick: () => Net.send('g:start') }, L.results ? '🔁 Play again' : '🌍 Start the war')
        : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host'))),
      h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '10px' } }, 'Up to 8 players plus up to 40 bots.'),
      howTo());
  }

  function resultsCard(r) {
    return h('div', { class: 'fw-result' },
      h('h3', {}, `👑 ${r.name} won!`),
      h('p', { class: 'small muted', style: { marginBottom: '8px' } }, `${r.minutes} min · ${r.mode === 'teams' ? 'teams' : 'free-for-all'} · ${r.bots} bots`),
      r.rows.map((x) => h('div', { class: 'rr' + (x.won ? ' won' : '') }, h('span', {}, x.won ? '🏆' : '💀'), UI.avatar(x, 'sm'), h('span', { class: 'grow bold' }, x.name),
        x.team ? h('span', { class: 'small', style: { color: TEAM_COLOR[x.team - 1] } }, F.TEAM_NAMES[x.team - 1]) : null,
        h('span', { class: 'small muted' }, `best ${pct(x.share)}`))));
  }

  function onlineConfig(match) {
    const s = match.settings;
    return { seed: match.seed, size: s.size, style: s.style, mode: s.mode, teams: s.teams, difficulty: s.difficulty, bots: s.bots,
      humans: match.humans.map((x) => ({ name: x.name, color: x.color, team: x.team })), settings: s };
  }
  function joinMatch(match, n, log) {
    matchId = match.id;
    const turns = [];
    const byN = new Map((log || []).map(([k, moves]) => [k, moves]));
    for (let k = 1; k <= (n || 0); k++) turns.push({ n: k, i: byN.get(k) || [] });
    const me = match.humans.findIndex((x) => x.uid === Net.id) + 1;
    startSession(onlineConfig(match), 'online', me, turns);
    if (turns.length > 30) banner('⏳ Catching up…');
    if (!me) UI.toast('👀 This game started before you joined — you’re watching. You’ll play in the next one!', '', 4000);
  }

  Lobby.init({
    game: 'front',
    title: 'Front Wars',
    emoji: '🌍',
    tagline: 'Conquer the world! Grab land, build cities, send boats and nukes. Inspired by OpenFront.',
    howTo: HOW_TO,
    solo: { label: '🤖 Play solo vs bots', onClick: openSetup },
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#play-chat'), { title: '💬 Chat' });

  Lobby.on('joined', (m) => {
    const st = m.state;
    L = { phase: st.phase, settings: st.settings, picks: st.picks || {}, results: st.results };
    if (st.phase === 'playing' && st.match) joinMatch(st.match, st.n, st.turns);
    else if (S && S.mode === 'online') S = null;
    route();
  });
  Lobby.on('players', () => { if ($('#room').classList.contains('hidden') === false) renderLobby(); });
  Lobby.on('entry', () => { S = null; for (const s of ['setup', 'room', 'play']) $('#' + s).classList.add('hidden'); });
  Lobby.on('left', () => { S = null; });
  Net.on('g:state', (m) => {
    const st = m.state;
    L = { ...L, phase: st.phase, settings: st.settings, picks: st.picks || {}, results: st.results };
    if (!S || S.mode !== 'online' || L.phase === 'lobby') route();
  });
  Net.on('g:start', (m) => {
    L.phase = 'playing';
    L.results = null;
    joinMatch(m.match, 0, []);
    Sfx.play('go');
  });
  Net.on('g:turn', (m) => {
    if (!S || S.mode !== 'online') return;
    if (m.n !== S.expect) {   // missed something (shouldn't happen): ask for the whole game again
      S = null;
      Net.send('room:join', { code: Room.code, game: 'front' });
      return;
    }
    S.expect = m.n + 1;
    S.incoming.push({ n: m.n, i: m.i });
  });
  Net.on('g:over', (m) => {
    L.results = m.results;
    L.phase = 'lobby';
    if (S && S.mode === 'online') {
      const box = $('#over').firstChild;
      if (box) {
        const last = box.lastChild;
        if (last && last.tagName === 'P') last.remove();
        box.append(h('div', { class: 'row', style: { justifyContent: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('button', { class: 'btn btn-pink', onclick: () => { S = null; route(); } }, '👥 Back to the lobby'), replayButton()));
      }
    }
  });
  Net.on('g:stopped', () => {
    L.phase = 'lobby';
    if (S && S.mode === 'online') { S = null; UI.toast('🛑 The game was stopped', '', 2500); }
    route();
  });
  Net.on('g:desync', () => {
    UI.toast('🔄 Your game got out of sync — reloading it…', 'bad', 3000);
    S = null;
    Net.send('room:join', { code: Room.code, game: 'front' });
  });
  PA.on('admin:cheat', ({ action }) => {
    if (S && S.mode === 'solo' && S.me && (action === 'troops' || action === 'gold')) S.pending.push([S.me, { k: 'cheat', c: action }]);
  });

  if (location.hostname === 'localhost') window.__front = { get S() { return S; }, F, view, step: (moves, quiet) => stepGame(moves, quiet) };   // testing on your own computer only
  if (new URLSearchParams(location.search).get('solo')) { Lobby.hideEntry(); openSetup(); }
})();
