/* Song Rush — a song plays, everyone races to name it. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI, store } = PA;

  const S = { phase: 'lobby', settings: { playlist: 'mix', rounds: 10, time: 20, mode: 'type' }, scores: {}, streaks: {}, round: null, reveal: null, final: null, playlists: [] };
  const OPT_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e'];
  let endsAt = 0;          // performance.now() when the guessing time runs out
  let startsAt = 0;        // ... when the song starts (countdown)
  let plus = {};           // points each player got this round, shown in the scores

  // ------------------------------------------------------------ the song player
  /* Songs are 30-second previews. They're downloaded and decoded with Web Audio so everyone starts in sync
     (and we get a real equalizer); if that fails we fall back to a plain <audio> element. */
  const Player = (() => {
    const bufs = new Map();
    let vol = Math.min(1, Math.max(0, Number(store.get('pa_song_vol', 0.8)) || 0));
    let node = null; let gainN = null; let analyser = null; let el = null; let cur = null;
    let blocked = false;
    const ctx = () => Sfx.ac();
    const level = () => (Sfx.muted ? 0 : vol);

    function load(url) {
      if (!url) return Promise.resolve(null);
      if (!bufs.has(url)) {
        const c = ctx();
        const p = !c || !window.fetch ? Promise.resolve(null)
          : fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
            .then((b) => new Promise((res, rej) => c.decodeAudioData(b, res, rej)))
            .catch(() => null);
        bufs.set(url, p);
        while (bufs.size > 4) bufs.delete(bufs.keys().next().value);
      }
      return bufs.get(url);
    }

    function stop(fade = 0.3) {
      cur = null;
      blocked = false;
      if (node) {
        const c = ctx();
        const n = node; const g = gainN;
        try { g.gain.setTargetAtTime(0, c.currentTime, fade / 4); n.stop(c.currentTime + fade); } catch { /* already stopped */ }
        node = null;
      }
      if (el) { const e = el; el = null; e.pause(); e.removeAttribute('src'); }
    }

    /** Play `url` from `offset` seconds in. Resolves to 'ok', 'tap' (the browser wants a tap first) or 'fail'. */
    async function play(url, offset, n) {
      stop(0.15);
      const token = { url, n, t0: performance.now() - offset * 1000 };
      cur = token;
      const buf = await load(url);
      if (cur !== token) return 'old';
      const off = (performance.now() - token.t0) / 1000;
      const c = ctx();
      if (buf && c) {
        if (c.state !== 'running') { try { await c.resume(); } catch { /* needs a tap */ } }
        if (cur !== token) return 'old';
        if (c.state !== 'running') { blocked = true; return 'tap'; }
        if (off >= buf.duration - 0.2) return 'ok';
        if (!analyser) { analyser = c.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.75; analyser.connect(c.destination); }
        gainN = c.createGain();
        gainN.gain.value = 0;
        gainN.gain.setTargetAtTime(level(), c.currentTime, 0.05);
        gainN.connect(analyser);
        node = c.createBufferSource();
        node.buffer = buf;
        node.connect(gainN);
        node.start(0, Math.max(0, off));
        return 'ok';
      }
      // plan B: a normal audio element (no equalizer)
      return new Promise((resolve) => {
        const a = new Audio();
        el = a;
        a.preload = 'auto';
        a.volume = level();
        a.onerror = () => { if (el === a) { el = null; resolve('fail'); } };
        a.onloadedmetadata = () => {
          if (el !== a) return;
          try { a.currentTime = Math.max(0, (performance.now() - token.t0) / 1000); } catch { /* not seekable yet */ }
          a.play().then(() => resolve('ok')).catch((e) => { if (e && e.name === 'NotAllowedError') { blocked = true; resolve('tap'); } else resolve('fail'); });
        };
        a.src = url;
      });
    }

    function setVol(v) {
      vol = v;
      store.set('pa_song_vol', v);
      if (gainN) { const c = ctx(); gainN.gain.setTargetAtTime(level(), c.currentTime, 0.05); }
      if (el) el.volume = level();
    }
    PA.on('muted', () => setVol(vol));

    return {
      load, play, stop, setVol,
      get vol() { return vol; },
      get blocked() { return blocked; },
      get current() { return cur; },
      /** Equalizer levels 0..1, or null when nothing real is playing. */
      levels(out) {
        if (!analyser || !node) return null;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < out.length; i++) out[i] = data[Math.min(data.length - 1, 1 + Math.floor(i * (data.length * 0.7) / out.length))] / 255;
        return out;
      },
      get fallbackPlaying() { return !!(el && !el.paused); },
    };
  })();

  // iPhones mute Web Audio when the silent switch is on; songs are media, so ask for normal playback
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }

  // unlock audio on the first tap anywhere (phones only allow sound after the player touches the page)
  const unlock = () => { const c = Sfx.ac(); if (c && c.state === 'running') { document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); } };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);

  const volEl = $('#vol');
  volEl.value = Math.round(Player.vol * 100);
  volEl.addEventListener('input', () => Player.setVol(volEl.value / 100));

  // ------------------------------------------------------------ equalizer
  const viz = $('#viz');
  const vctx = viz.getContext('2d');
  const bars = new Float32Array(32);
  const shown = new Float32Array(32);
  function drawViz(t) {
    requestAnimationFrame(drawViz);
    if ($('#play').classList.contains('hidden')) return;
    const real = Player.levels(bars);
    const live = S.phase === 'playing' || S.phase === 'reveal';
    for (let i = 0; i < bars.length; i++) {
      let target;
      if (real) target = bars[i];
      else if (live && (Player.fallbackPlaying)) target = 0.25 + 0.5 * Math.abs(Math.sin(t / 220 + i * 1.7) * Math.cos(t / 330 + i));
      else target = 0.04 + 0.03 * Math.sin(t / 600 + i / 2);
      shown[i] += (target - shown[i]) * 0.3;
    }
    const W = viz.width; const H = viz.height;
    vctx.clearRect(0, 0, W, H);
    const bw = W / bars.length;
    const grad = vctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, '#22d3ee'); grad.addColorStop(0.5, '#ff4fd8'); grad.addColorStop(1, '#facc15');
    vctx.fillStyle = grad;
    for (let i = 0; i < bars.length; i++) {
      const bh = Math.max(3, shown[i] * H * 0.95);
      const x = i * bw + bw * 0.18;
      vctx.globalAlpha = 0.55 + shown[i] * 0.45;
      vctx.beginPath();
      if (vctx.roundRect) vctx.roundRect(x, H - bh, bw * 0.64, bh, 4); else vctx.rect(x, H - bh, bw * 0.64, bh);
      vctx.fill();
    }
    vctx.globalAlpha = 1;
  }
  requestAnimationFrame(drawViz);

  // ------------------------------------------------------------ helpers
  const isType = () => (S.round ? S.round.mode : S.settings.mode) === 'type';
  const playlist = (id) => S.playlists.find((p) => p.id === id) || { emoji: '🎵', name: id, count: 0 };
  const myKnown = () => (S.round && S.round.solved && S.round.solved[Net.id]) || '';

  function maskEl(text) {
    return h('div', { class: 'sr-mask', 'aria-label': 'Hidden letters' }, text.split(' ').filter(Boolean).map((w) => h('span', { class: 'sr-word' },
      [...w].map((ch) => (ch === '_' ? h('i', { class: 'sr-ch' }) : /[\p{L}\p{N}]/u.test(ch) ? h('i', { class: 'sr-ch on' }, ch) : h('b', {}, ch))))));
  }

  function overlay(...kids) {
    const o = $('#over');
    fill(o, h('div', {}, ...kids));
    o.classList.remove('hidden');
    return o;
  }
  const hideOverlay = () => $('#over').classList.add('hidden');

  function setLabel(img) {
    const label = $('#label');
    if (img) fill(label, h('img', { class: 'sr-cover', src: img, alt: '' })); else label.textContent = '♫';
  }

  // ------------------------------------------------------------ rendering
  function renderScores() {
    const r = S.round;
    const rows = Object.entries(S.scores).sort((a, b) => b[1] - a[1]).map(([id, pts]) => {
      const p = Room.player(id) || { name: '?', avatar: '❓', color: '#888' };
      const solved = (r && r.solved && r.solved[id]) || '';
      const answered = r && (r.answered || []).includes(id);
      const done = S.phase !== 'reveal' && (isType() ? solved.length === 2 : answered);
      let st = null;
      if (S.phase === 'playing' || S.phase === 'reveal') {
        if (isType()) st = (solved.includes('t') ? '🎵' : '') + (solved.includes('a') ? (r && r.movie ? '🎬' : '🎤') : '');
        else if (S.phase === 'reveal' && S.reveal && S.reveal.results[id] && S.reveal.results[id].pick != null) st = S.reveal.results[id].ok ? '✅' : '❌';
        else if (answered) st = '🔒';
      }
      const streak = S.streaks[id] || 0;
      return h('div', { class: 'score-row' + (done ? ' done' : ''), 'data-flip-id': id },
        UI.avatar(p, 'sm'),
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'bold', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name, id === Net.id ? ' (you)' : ''),
          streak >= 2 ? h('div', { class: 'streak' }, `🔥 ${streak} in a row`) : null),
        st ? h('span', { class: 'st' }, st) : null,
        plus[id] ? h('span', { class: 'plus' }, `+${plus[id]}`) : null,
        h('span', { class: 'pts' }, pts.toLocaleString('en-US')));
    });
    if (PA.FX && PA.FX.board) PA.FX.board($('#scores'), () => fill($('#scores'), rows)); else fill($('#scores'), rows);
  }

  function renderTop() {
    const r = S.round;
    $('#round').textContent = r ? `Song ${r.n}/${r.rounds}` : '';
    const pl = playlist(S.settings.playlist);
    $('#plname').textContent = `${pl.emoji} ${pl.name}`;
  }

  function renderHints() {
    const r = S.round;
    const box = $('#hints');
    if (!r || !isType()) { fill(box); return; }
    const known = myKnown();
    const hints = r.hints || {};
    const whoLabel = r.movie ? '🎬 Movie' : '🎤 Artist';
    const rv = S.phase === 'reveal' && S.reveal && S.reveal.song;
    if (rv) {   // the answer is out: show it, with ✅ for the parts you got
      const row = (lbl, val, got) => h('div', { class: 'sr-row ' + (got ? 'got' : 'was') }, h('span', { class: 'lbl' }, lbl), h('span', { class: 'val' }, val, got ? ' ✅' : ''));
      fill(box, row('🎵 Song', rv.t, known.includes('t')), row(whoLabel, r.movie ? `${rv.m} (${rv.a})` : rv.a, known.includes('a')));
      return;
    }
    const titleRow = known.includes('t') && r.title
      ? h('div', { class: 'sr-row got' }, h('span', { class: 'lbl' }, '🎵 Song'), h('span', { class: 'val' }, r.title, ' ✅'))
      : h('div', { class: 'sr-row' }, h('span', { class: 'lbl' }, '🎵 Song'), hints.title ? maskEl(hints.title) : h('span', { class: 'sr-wait' }, 'Listen…'));
    const whoRow = known.includes('a') && r.who
      ? h('div', { class: 'sr-row got' }, h('span', { class: 'lbl' }, whoLabel), h('span', { class: 'val' }, r.who, ' ✅'))
      : h('div', { class: 'sr-row' }, h('span', { class: 'lbl' }, whoLabel), hints.who ? maskEl(hints.who) : h('span', { class: 'sr-wait' }, r.movie ? 'Which movie is it from? (the singer counts too)' : 'Who sings it?'));
    const extra = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      hints.year ? h('span', { class: 'sr-chip' }, `🗓️ ${hints.year}`) : null,
      hints.genre ? h('span', { class: 'sr-chip' }, `🎼 ${hints.genre}`) : null,
      !hints.year && S.phase === 'playing' ? h('span', { class: 'tiny faint' }, 'Hints appear as time runs out. Type the song or the artist in the chat — or both!') : null);
    fill(box, titleRow, whoRow, extra);
  }

  function renderOptions() {
    const r = S.round;
    const box = $('#options');
    if (!r || isType() || !r.options) { fill(box); box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const rev = S.phase === 'reveal' && S.reveal;
    const mine = r.picked;
    fill(box, r.options.map((o, i) => {
      let cls = 'sr-opt';
      if (rev) cls += i === S.reveal.answer ? ' right' : i === mine ? ' wrong' : ' dim';
      else if (mine === i) cls += ' mine';
      else if (mine != null) cls += ' dim';
      return h('button', { class: cls, disabled: mine != null || S.phase !== 'playing' || Room.watching, onclick: () => pick(i) },
        h('span', { class: 'k', style: { background: OPT_COLORS[i] } }, 'ABCD'[i]),
        h('span', {}, h('div', { class: 't' }, o.t), h('div', { class: 'a' }, o.a)));
    }));
  }

  function pick(i) {
    if (!S.round || S.round.picked != null || S.phase !== 'playing') return;
    S.round.picked = i;
    Net.send('g:pick', { i });
    Sfx.play('pop');
    renderOptions();
  }

  function renderMutedNote() {
    const box = $('#muted-note');
    if (Sfx.muted) {
      fill(box, h('div', { class: 'sr-muted' }, h('span', { class: 'bold' }, '🔇 Your sound is off, so you can’t hear the songs.'),
        h('button', { class: 'btn btn-yellow btn-sm', onclick: () => { Sfx.setMuted(false); Sfx.ac(); renderMutedNote(); } }, '🔊 Turn sound on')));
    } else fill(box);
  }
  PA.on('muted', renderMutedNote);

  function route() {
    const playing = ['ready', 'playing', 'reveal'].includes(S.phase);
    $('#room').classList.toggle('hidden', playing);
    $('#play').classList.toggle('hidden', !playing);
    if (!playing) { Player.stop(); renderRoomMain(); return; }
    guessBox.input.placeholder = isType() ? 'Type the song or the artist…' : 'Say something…';
    renderTop();
    renderScores();
    renderHints();
    renderOptions();
    renderMutedNote();
    if (S.phase === 'ready') showCountdown();
    else if (S.phase === 'reveal' && S.reveal) showReveal(false);
    else { hideOverlay(); setLabel(null); }
    $('#disc').classList.toggle('spin', S.phase === 'playing' || S.phase === 'reveal');
  }

  // ------------------------------------------------------------ round flow
  let cdTimer = null;
  function showCountdown() {
    clearInterval(cdTimer);
    setLabel(null);
    $('#disc').classList.remove('spin');
    const tick = () => {
      const left = Math.ceil((startsAt - performance.now()) / 1000);
      if (S.phase !== 'ready') { clearInterval(cdTimer); return; }
      overlay(h('p', { class: 'muted bold' }, `Song ${S.round.n} of ${S.round.rounds}`), h('div', { class: 'big gradient-text' }, left > 0 ? String(left) : '🎧'), h('p', { class: 'muted' }, 'Get ready…'));
      if (left > 0 && left <= 3) Sfx.play('tick');
    };
    tick();
    cdTimer = setInterval(tick, 1000);
  }

  async function startSong() {
    const r = S.round;
    if (!r) return;
    $('#load-note').textContent = '';
    const offset = Math.max(0, S.settings.time - (r.left != null ? r.left : S.settings.time));
    const res = await Player.play(r.url, offset, r.n);
    if (S.round !== r) return;
    if (res === 'tap') showTap();
    else if (res === 'fail') {
      $('#load-note').textContent = '😵 This song didn’t load for you.';
      Net.send('g:bad', { n: r.n });
    }
  }

  function showTap() {
    const o = overlay(h('div', { class: 'big' }, '🔊'), h('p', { class: 'bold' }, 'Your browser wants a tap before it plays sound.'),
      h('button', { class: 'btn btn-pink btn-lg', style: { marginTop: '10px' }, onclick: () => {
        const c = Sfx.ac();
        const go = () => { hideOverlay(); const r = S.round; if (r && (S.phase === 'playing' || S.phase === 'reveal')) { const off = S.settings.time - Math.max(0, (endsAt - performance.now()) / 1000); Player.play(r.url, S.phase === 'reveal' ? S.settings.time : off, r.n).then((x) => { if (x === 'tap') showTap(); }); } };
        if (c && c.resume) c.resume().then(go, go); else go();
      } }, '▶ Play the song'));
    o.classList.add('sr-tap');
  }

  function showReveal(fresh) {
    const rv = S.reveal;
    const s = rv.song;
    setLabel(s.art);
    const results = Object.entries(rv.results).filter(([, x]) => x.t || x.a);
    overlay(h('div', { class: 'sr-reveal' },
      s.art ? h('img', { class: 'sr-cover', src: s.art, alt: `${s.album || s.t} cover`, referrerpolicy: 'no-referrer' }) : null,
      h('div', { style: { minWidth: 0 } },
        h('div', { class: 'tiny muted bold' }, 'IT WAS'),
        h('div', { class: 'sr-t gradient-text' }, s.t),
        h('div', { class: 'sr-a' }, s.a),
        h('div', { class: 'sr-m small' }, [s.m ? `🎬 ${s.m}` : null, s.y].filter(Boolean).join(' · ')),
        h('div', { class: 'small', style: { marginTop: '8px' } }, results.length ? `${results.length} player${results.length === 1 ? '' : 's'} scored 🎉` : 'Nobody got it 😅'),
        s.url ? h('a', { class: 'sr-am', href: s.url, target: '_blank', rel: 'noopener' }, '🎵 Listen on Apple Music ↗') : null)));
    if (fresh) {
      const g = PA.FX && PA.FX.on ? PA.FX.gsap : null;
      const img = $('#over img.sr-cover');
      if (g && img) g.from(img, { rotationY: 90, scale: 0.6, duration: 0.6, ease: 'back.out(1.6)' });
    }
  }

  setInterval(() => {
    const clock = $('#clock');
    if (S.phase !== 'playing') { clock.textContent = '--'; clock.classList.remove('low'); return; }
    const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
    clock.textContent = left;
    clock.classList.toggle('low', left <= 5);
    if (left <= 5 && left > 0 && clock.dataset.last !== String(left)) Sfx.play('tick');
    clock.dataset.last = left;
  }, 250);

  // ------------------------------------------------------------ lobby screen
  function setSetting(key, v) {
    S.settings = { ...S.settings, [key]: v };   // right away, so a quick second click doesn't undo this one
    Net.send('g:settings', S.settings);
    Sfx.play('click');
    renderRoomMain();
  }

  function renderRoomMain() {
    const host = Room.isHost;
    const kids = [];
    const F = S.final;
    if (F && F.ranking && F.ranking.length) {
      const top = F.ranking.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      kids.push(h('div', { class: 'panel-title' }, '🏆 Final scores'),
        h('div', { class: 'podium' }, order.map((r, i) => (r ? h('div', { class: `step p${[2, 1, 3][i]}` }, UI.avatar(r, 'lg'), h('div', { class: 'pname' }, r.name),
          h('div', { class: 'pts' }, `${r.points.toLocaleString('en-US')} pts`), h('div', { class: 'tiny muted' }, `🎵 ${r.correct}/${F.rounds}`), h('div', { class: 'block' }, [2, 1, 3][i])) : h('div', { class: 'step' })))));
      if (F.songs && F.songs.length) {
        kids.push(h('div', { class: 'panel-title' }, '🎶 Songs in this game'),
          h('div', { class: 'sr-played' }, F.songs.map((s) => h('a', { href: s.url || '#', target: '_blank', rel: 'noopener', title: 'Listen on Apple Music' },
            s.art ? h('img', { class: 'sr-cover', src: s.art.replace('600x600bb', '100x100bb'), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
            h('div', { class: 'grow' }, h('div', { class: 't' }, s.t), h('div', { class: 'a' }, `${s.a} · ${s.y}${s.m ? ' · 🎬 ' + s.m : ''}`)),
            h('span', { class: 'tiny faint' }, '↗')))));
      }
    }
    const seg = (key, opts, label) => h('div', { class: 'sr-setrow' },
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: S.settings[key] === v ? 'on' : '', disabled: !host, onclick: () => setSetting(key, v) }, l))));
    kids.push(
      h('div', { class: 'panel-title' }, '⚙️ Settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'sr-setrow' },
        h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, 'PLAYLIST'),
        h('div', { class: 'pl-grid' }, S.playlists.map((p) => h('button', { class: 'pl-card' + (S.settings.playlist === p.id ? ' on' : ''), disabled: !host, title: p.desc,
          onclick: () => setSetting('playlist', p.id) },
        h('span', { class: 'e' }, p.emoji), h('span', { class: 'n' }, p.name), h('span', { class: 'c' }, `${p.count} song${p.count === 1 ? '' : 's'}`))))),
      seg('mode', [['type', '⌨️ Type it'], ['pick', '🔘 Pick from 4']], 'HOW TO ANSWER'),
      seg('rounds', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], 'SONGS'),
      seg('time', [[15, '15s'], [20, '20s'], [30, '30s']], 'TIME TO GUESS'),
      host ? h('button', { class: 'btn btn-pink btn-lg btn-block', onclick: () => { Sfx.ac(); Net.send('g:start'); } }, F ? '🔁 Play again' : '🎧 Start the music')
        : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('p', { class: 'tiny faint', style: { marginTop: '10px', textAlign: 'center' } }, '🔊 Turn your sound up! Play alone or with up to 16 friends.'),
      h('p', { class: 'sr-credit' }, 'Song previews and covers courtesy of Apple Music.'),
    );
    fill($('#room-main'), kids);
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'songs',
    title: 'Song Rush',
    emoji: '🎧',
    tagline: 'A song starts playing… name it before everyone else!',
    howTo: '<b>How to play</b><ul><li>Every round plays a few seconds of a real song.</li><li><b>Type it:</b> type the song’s name and the artist in the chat (or the movie, for movie songs). Spelling doesn’t have to be perfect!</li><li><b>Pick from 4:</b> choose the right song before time runs out.</li><li>The faster you are, the more points you get. Get songs in a row for a 🔥 streak bonus.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'));
  Lobby.ChatBox($('#room-chat'));
  const guessBox = Lobby.ChatBox($('#play-chat'), { title: '💬 Name that song!', placeholder: 'Type the song or the artist…', onSend: (text) => Net.send('g:guess', { text }) });

  function applyRound(r) {
    S.round = r;
    if (r && r.left != null) endsAt = performance.now() + r.left * 1000;
    if (r && r.startsIn != null) startsAt = performance.now() + r.startsIn * 1000;
  }

  Lobby.on('joined', (m) => {
    Object.assign(S, m.state);
    applyRound(m.state.round);
    plus = {};
    route();
    if (S.phase === 'ready' && S.round) Player.load(S.round.url);
    if (S.phase === 'playing') startSong();
  });
  Lobby.on('players', () => { if ($('#play').classList.contains('hidden')) renderRoomMain(); else renderScores(); });
  Lobby.on('left', () => Player.stop());

  Net.on('g:settings', (m) => { S.settings = m.settings; renderRoomMain(); });
  Net.on('g:scores', (m) => { S.scores = m.scores; if (m.streaks) S.streaks = m.streaks; renderScores(); });
  Net.on('g:round', (m) => {
    Player.stop(0.6);
    S.phase = 'ready'; S.final = null; S.reveal = null; plus = {};
    S.scores = m.scores; S.streaks = m.streaks;
    applyRound(m.round);
    Player.load(m.round.url);
    if (m.round.n === 1) guessBox.clear();
    guessBox.add({ sys: true, text: `🎧 Song ${m.round.n} of ${m.round.rounds}…` });
    route();
  });
  Net.on('g:play', (m) => {
    S.phase = 'playing';
    applyRound(m.round);
    clearInterval(cdTimer);
    route();
    Sfx.play('go');
    startSong();
    if (isType()) guessBox.input.focus({ preventScroll: true });
  });
  Net.on('g:hint', (m) => {
    if (!S.round) return;
    S.round.hints = m.hints;
    renderHints();
    Sfx.play('tick');
    const g = PA.FX && PA.FX.on ? PA.FX.gsap : null;
    if (g) g.from('#hints .sr-row:not(.got), #hints .sr-chip', { scale: 0.92, duration: 0.35, ease: 'back.out(2)', clearProps: 'transform' });
  });
  Net.on('g:got', (m) => {
    S.scores = m.scores;
    S.streaks[m.id] = m.streak;
    if (S.round) S.round.solved = { ...(S.round.solved || {}), [m.id]: m.solved };
    plus[m.id] = (plus[m.id] || 0) + m.pts;
    if (m.id !== Net.id) {
      const what = m.got === 'at' ? 'the song AND the artist' : m.got === 't' ? 'the song' : (S.round && S.round.movie ? 'the movie' : 'the artist');
      guessBox.add({ from: { id: m.id, name: m.name, avatar: m.avatar, color: '#22c55e' }, text: `got ${what}! +${m.pts}${m.first ? ' ⚡ first!' : ''}`, good: true });
      Sfx.play('coin');
    }
    renderScores();
  });
  Net.on('g:answer', (m) => {
    if (!S.round) return;
    if (m.title) S.round.title = m.title;
    if (m.who) S.round.who = m.who;
    S.round.solved = { ...(S.round.solved || {}), [Net.id]: (m.title ? 't' : '') + (m.who ? 'a' : '') };
    Sfx.play('right');
    const parts = [m.got.includes('t') ? `🎵 ${m.title}` : null, m.got.includes('a') ? `${S.round.movie ? '🎬' : '🎤'} ${m.who}` : null].filter(Boolean);
    UI.toast(`🎉 ${parts.join(' · ')}  +${m.pts}${m.streak >= 2 && m.got.includes('t') ? ` · 🔥${m.streak}` : ''}`, 'good', 2600);
    guessBox.add({ from: { id: Net.id, name: 'You', avatar: '🎉', color: '#22c55e' }, text: `got ${parts.join(' and ')}! +${m.pts}`, good: true });
    if (PA.FX && PA.FX.rain && m.title && m.who) PA.FX.rain('🎵', 14);
    renderHints();
    renderScores();
  });
  Net.on('g:answered', (m) => {
    if (!S.round) return;
    S.round.answered = [...new Set([...(S.round.answered || []), m.id])];
    if (m.id !== Net.id) Sfx.play('pop');
    renderScores();
  });
  Net.on('g:close', (m) => { UI.toast(`🔥 “${m.text}” is SO close!`, '', 2200); Sfx.play('tick'); });
  Net.on('g:slow', () => UI.toast('⏳ Whoa, slow down a little!', '', 1200));
  Net.on('g:chat', (m) => guessBox.add({ from: { id: m.id, name: m.name, avatar: m.avatar, color: m.color }, text: m.text, secret: m.secret }));
  Net.on('g:reveal', (m) => {
    S.phase = 'reveal';
    S.reveal = m.reveal;
    S.scores = m.scores; S.streaks = m.streaks;
    plus = {};
    for (const [id, x] of Object.entries(m.reveal.results)) if (x.t || x.a) plus[id] = x.t + x.a;
    if (S.round && m.reveal.answer != null) S.round.answer = m.reveal.answer;
    route();
    showReveal(true);
    const me = m.reveal.results[Net.id];
    if (!m.skipped) Sfx.play(me && (me.t || me.a) ? 'win' : 'lose');
    if (m.reveal.next) Player.load(m.reveal.next);
    const s = m.reveal.song;
    guessBox.add({ sys: true, text: `🎶 It was “${s.t}” by ${s.a}${s.m ? ` (${s.m})` : ''}` });
  });
  Net.on('g:final', (m) => {
    S.phase = 'over'; S.final = m.final; S.round = null; S.reveal = null;
    Player.stop(1.5);
    route();
    const me = m.final.ranking[0];
    if (me && me.id === Net.id && m.final.ranking.length > 1) { UI.confetti(200); Sfx.play('win'); }
  });
})();
