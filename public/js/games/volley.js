/* Screen Volley — one volleyball court spread over two screens standing side by side.
   The screen that has the ball runs it (no lag for the person hitting it). Before the ball goes over the net,
   that screen works out exactly when and where it will cross and tells the other screen in advance, so it
   comes in right on time even over the internet. Two screens on the same Wi-Fi also connect directly. */
(() => {
  'use strict';
  const { $, h, fill, Net, Sfx, UI } = PA;
  const V = window.VolleyCore;
  const C = V.C;
  const COLORS = { left: '#ff4fd8', right: '#22d3ee' };
  const qs = new URLSearchParams(location.search);

  const S = { phase: 'lobby', settings: { mode: 'versus', target: 7 }, sides: { left: null, right: null }, score: { left: 0, right: 0 },
    owner: null, epoch: 0, rally: 0, best: 0, passes: 0, lives: 3, final: null };
  let solo = false;   // practice against the robot (no room)

  const mySide = () => (solo ? 'left' : S.sides.left === Net.id ? 'left' : S.sides.right === Net.id ? 'right' : null);
  const otherSide = (s) => (s === 'left' ? 'right' : 'left');
  const nameOf = (side) => {
    if (solo) return side === 'left' ? 'You' : 'Robot';
    const p = Room.player(S.sides[side]);
    return p ? p.name : side === 'left' ? 'Left' : 'Right';
  };

  // ------------------------------------------------------------ clock: everyone agrees on "server time"
  const Clock = {
    offset: 0, rtt: 250, best: Infinity, n: 0,
    server(local) { return local + this.offset; },
    local(server) { return server - this.offset; },
  };
  Net.on('g:sync', (m) => {
    const rtt = performance.now() - m.c;
    if (!(rtt >= 0)) return;
    Clock.rtt = Clock.n ? Clock.rtt * 0.75 + rtt * 0.25 : rtt;
    Clock.n++;
    // the quickest replies give the most accurate offset
    if (rtt < Clock.best * 1.25 || Clock.n <= 2) {
      Clock.best = Math.min(Clock.best, rtt);
      Clock.offset = m.s - (m.c + rtt / 2);
    }
  });
  const syncClock = () => { if (Room.code) Net.send('g:sync', { c: performance.now() }); };
  setInterval(() => { if (!solo && Room.code && (S.phase === 'playing' || Clock.n < 6)) syncClock(); }, 1500);
  setInterval(() => { if (!solo && Room.code) Direct.connect(); }, 3000);

  // ------------------------------------------------------------ direct connection between the two screens
  /* Only between screens on the same network: no outside servers are asked for addresses, so nobody's
     internet address is shared. If it doesn't work (school Wi-Fi often blocks it) the server path is used. */
  const Direct = {
    pc: null, ch: null, open: false, rtt: null, peer: null, id: null, timer: null, pinger: null,
    supported: typeof RTCPeerConnection === 'function',
    stop() {
      clearTimeout(this.timer); clearInterval(this.pinger);
      try { if (this.ch) this.ch.close(); } catch { /* closed */ }
      try { if (this.pc) this.pc.close(); } catch { /* closed */ }
      Object.assign(this, { pc: null, ch: null, open: false, rtt: null, peer: null, id: null });
      drawPing();
    },
    make(id, peer) {
      try { if (this.pc) this.pc.close(); } catch { /* closed */ }
      const pc = new RTCPeerConnection({ iceServers: [] });
      Object.assign(this, { pc, id, peer, open: false, rtt: null });
      pc.onicecandidate = (e) => { if (e.candidate && this.pc === pc) Net.send('g:rtc', { data: { id, kind: 'ice', cand: e.candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => { if (this.pc === pc && ['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { this.open = false; drawPing(); } };
      pc.ondatachannel = (e) => this.channel(e.channel, pc);
      clearTimeout(this.timer);
      return pc;
    },
    channel(ch, pc) {
      this.ch = ch;
      ch.onopen = () => {
        if (this.pc !== pc) return;
        this.open = true;
        clearInterval(this.pinger);
        this.pinger = setInterval(() => this.send({ k: 'ping', t: performance.now() }), 2000);
        this.send({ k: 'ping', t: performance.now() });
        drawPing();
      };
      ch.onclose = () => { if (this.ch === ch) { this.open = false; drawPing(); } };
      ch.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.k === 'ping') this.send({ k: 'pong', t: m.t });
        else if (m.k === 'pong') { const r = performance.now() - m.t; this.rtt = this.rtt == null ? r : this.rtt * 0.7 + r * 0.3; drawPing(); }
        else if (m.k === 'cross') incoming(m);
      };
    },
    async connect() {
      // the left screen starts it, the right screen answers; the left one tries again every 10 s until it works
      const side = mySide();
      const peer = side ? S.sides[otherSide(side)] : null;
      if (!this.supported || solo || !peer) { if (this.pc || this.peer) this.stop(); return; }
      if (side !== 'left') { if (this.peer !== peer) { this.stop(); this.peer = peer; } return; }
      if (this.peer === peer && (this.open || performance.now() - (this.offeredAt || -1e9) < 10000)) return;
      this.stop();
      const id = Math.random().toString(36).slice(2);
      const pc = this.make(id, peer);
      this.offeredAt = performance.now();
      this.channel(pc.createDataChannel('volley', { ordered: false, maxRetransmits: 2 }), pc);
      try {
        await pc.setLocalDescription(await pc.createOffer());
        Net.send('g:rtc', { data: { id, kind: 'offer', sdp: pc.localDescription.sdp } });
      } catch { /* no direct connection then */ }
    },
    async signal(d) {
      try {
        if (d.kind === 'offer' && mySide() === 'right') {
          const pc = this.make(d.id, S.sides.left);
          await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          Net.send('g:rtc', { data: { id: d.id, kind: 'answer', sdp: pc.localDescription.sdp } });
        } else if (d.kind === 'answer' && this.pc && d.id === this.id) {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
        } else if (d.kind === 'ice' && this.pc && d.id === this.id && d.cand) {
          await this.pc.addIceCandidate(d.cand);
        }
      } catch { /* ignore: we still have the server */ }
    },
    send(obj) { if (this.open && this.ch) { try { this.ch.send(JSON.stringify(obj)); return true; } catch { /* closed */ } } return false; },
  };
  Net.on('g:rtc', (m) => { if (m.data) Direct.signal(m.data); });

  /** How early to tell the other screen about the ball: longer when messages take longer. */
  function leadTime() {
    if (solo) return 0.1;
    if (Direct.open && Direct.rtt != null) return Math.min(0.5, Math.max(0.14, Direct.rtt / 1000 * 1.3 + 0.08));
    return Math.min(0.7, Math.max(0.28, Clock.rtt / 1000 * 1.15 + 0.1));
  }

  function drawPing() {
    const el = $('#vb-ping');
    if (!el) return;
    if (solo) { el.textContent = '🤖 Practice'; el.className = 'vb-ping good'; return; }
    const direct = Direct.open && Direct.rtt != null;
    const ms = Math.round(direct ? Direct.rtt : Clock.rtt);
    el.textContent = `📶 ${ms} ms · ${direct ? 'direct' : 'via server'}`;
    el.className = 'vb-ping ' + (ms < 80 ? 'good' : ms < 220 ? 'ok' : 'bad');
    el.title = direct ? 'Your screens are talking to each other directly over your Wi-Fi.' : 'Messages go through the Party Arcade server. Same Wi-Fi? The screens try to connect directly.';
  }

  // ------------------------------------------------------------ the court
  const cv = $('#court');
  const ctx = cv.getContext('2d');
  let Hpx = 1;     // canvas height in device pixels = 1 court unit
  const G = {
    f: V.field(1.6, 'left'),
    ball: null, state: 'none',   // none | serve | mine | incoming | leaving | splash
    epoch: 0, seen: 0, frozenUntil: 0, locked: null, held: false, heldFor: 0, acc: 0, last: 0, hb: 0,
    incoming: null, leaving: null, splash: null, hits: 0,
    hand: { x: -1, y: -1, px: -1, py: -1, vx: 0, vy: 0, on: false, down: false, trail: [] },
    msg: null, robot: null,
  };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    if (!r.height) return;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    Hpx = cv.height;
    G.f = V.field(r.width / r.height, mySide() || 'left');
    if (G.robot) G.robot.f = V.field(G.f.w, 'right');
  }
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', () => { resize(); $('#vb-full').textContent = document.fullscreenElement ? '⛶ Exit full screen' : '⛶ Full screen'; });

  // ------------------------------------------------------------ hand (cursor or finger)
  function toCourt(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.height, (e.clientY - r.top) / r.height];
  }
  function moveHand(e) {
    const [x, y] = toCourt(e);
    const hd = G.hand;
    if (!hd.on) { hd.px = x; hd.py = y; hd.vx = 0; hd.vy = 0; hd.trail.length = 0; }
    hd.x = x; hd.y = y; hd.on = true;
  }
  cv.addEventListener('pointermove', (e) => {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (list.length ? list : [e]).forEach(moveHand);
  });
  cv.addEventListener('pointerdown', (e) => {
    moveHand(e);
    G.hand.px = G.hand.x; G.hand.py = G.hand.y;
    try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
    G.hand.down = true;
    Sfx.ac();
    const b = G.ball;
    if (G.state === 'mine' && b && !G.locked && Math.hypot(b.x - G.hand.x, b.y - G.hand.y) < (C.R + C.HAND) * 1.5) {
      G.held = true; G.heldFor = 0; G.frozenUntil = 0;
      Sfx.play('pop');
    }
  });
  const handUp = (e) => {
    G.hand.down = false;
    if (e.pointerType !== 'mouse') G.hand.on = false;   // a finger lifted: no hand any more
    if (G.held) letGo();
  };
  cv.addEventListener('pointerup', handUp);
  cv.addEventListener('pointercancel', handUp);
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !G.hand.down) G.hand.on = false; });

  function letGo() {
    G.held = false;
    if (G.ball) V.release(G.ball, G.f);
    Sfx.play('swoosh');
  }

  // ------------------------------------------------------------ passing the ball on
  function announce(msg) {
    if (solo) { G.robot.receive(msg); return; }
    Direct.send({ k: 'cross', ...msg, epoch: msg.epoch + 1 });
    Net.send('g:cross', msg);
  }

  /** The other screen says the ball is coming: it shows up at `at` (server time), never before. */
  function incoming(m) {
    if (!(m.epoch > G.seen) || G.state === 'mine') return;
    G.seen = m.epoch;
    const due = Clock.local(m.at);
    const now = performance.now();
    G.incoming = { due: Math.max(due, now), late: Math.max(0, now - due), msg: m, epoch: m.epoch };
    G.state = 'incoming';
  }
  Net.on('g:cross', (m) => incoming(m));

  function takeBall(b, epoch) {
    G.ball = b; G.epoch = epoch; G.state = 'mine';
    G.locked = null; G.held = false; G.acc = 0; G.hb = 0;
    G.f = V.field(G.f.w, mySide() || 'left');
  }

  function crossedNow() {
    // the ball went over the net on this screen (normally it was announced already)
    const b = G.ball;
    if (!G.locked) {
      G.locked = { epoch: G.epoch, at: Clock.server(performance.now()), y: b.y, vx: b.vx, vy: b.vy, a: b.a, spin: b.spin, d: V.overshoot(b, G.f) };
      announce(G.locked);
    }
    G.leaving = { b: V.copy(b), until: performance.now() + 600 };
    G.ball = null; G.locked = null; G.held = false;
    G.state = 'none';
  }

  function hitFloor() {
    const b = G.ball;
    G.splash = { x: b.x, until: performance.now() + 700 };
    G.ball = null; G.held = false; G.locked = null;
    G.state = 'none';
    Sfx.play('boom');
    if (solo) G.robot.lost('left');
    else Net.send('g:drop', { epoch: G.epoch });
  }

  // ------------------------------------------------------------ the robot (practice on one screen)
  /* The robot has its own invisible court to the right of yours (shown small in the corner). It runs the
     same physics and hits the ball back over the net, but not every time. */
  function Robot() {
    const R = {
      f: V.field(G.f.w, 'right'), ball: null, hand: { x: G.f.w * 0.6, y: 0.8 }, plan: null, wait: 0, misses: 0,
      receive(msg) {
        // like a real other screen: the ball arrives when it's due
        R.pending = { due: performance.now() + Math.max(0, Clock.local(msg.at) - performance.now()), msg };
      },
      serve() { R.ball = V.ball(R.f.w * 0.6, 0.36); R.wait = 1.1; R.plan = null; R.served = true; },
      lost(side) { point(otherSide(side), side); },
      tick(dt) {
        const now = performance.now();
        if (R.pending && now >= R.pending.due) { R.ball = V.arrive(R.pending.msg, R.f); R.pending = null; R.plan = null; R.served = false; }
        const b = R.ball;
        if (!b) { R.hand.y += (0.82 - R.hand.y) * 0.05; return; }
        if (R.wait > 0) { R.wait -= dt; R.hand.x += (b.x + 0.05 - R.hand.x) * 0.1; R.hand.y += (b.y + 0.14 - R.hand.y) * 0.1; if (R.wait <= 0) R.swing(b, true); return; }
        // get under the ball where it'll be at hitting height, then knock it back over
        if (!R.plan) {
          const p = V.copy(b);
          for (let i = 0; i < 400; i++) { V.step(p, R.f); if (p.vy > 0 && p.y > 0.58) break; }
          R.plan = { x: p.x, miss: Math.random() < 0.14 };
        }
        const tx = R.plan.x + 0.06; const ty = 0.74;
        const sp = 2.6 * dt;
        R.hand.x += Math.max(-sp, Math.min(sp, tx - R.hand.x));
        R.hand.y += Math.max(-sp, Math.min(sp, ty - R.hand.y));
        if (!R.plan.miss && b.vy > 0 && b.y > 0.58 && Math.abs(b.x - R.plan.x) < 0.2) R.swing(b, false);
        R.stepBall(dt);
      },
      swing(b, serve) {
        // pick a return that clears the net (try a few, a bit random)
        for (let k = 0; k < 14; k++) {
          const t = V.copy(b);
          t.vx = -(serve ? 1.0 : 0.9) - Math.random() * 1.1;
          t.vy = -1.55 - Math.random() * 0.9;
          t.spin = -6 + Math.random() * 12;
          const p = V.predict(t, R.f, 600);
          if (p && p.ev === 'cross') { Object.assign(b, t); R.hand.x = b.x + 0.06; R.hand.y = b.y + 0.1; R.plan = { x: b.x, done: true, miss: true }; Sfx.tone(380, 0.05, 'triangle', 0.05); return; }
        }
        R.plan = { x: b.x, miss: true };   // couldn't find one: it'll drop
      },
      stepBall(dt) {
        R.acc = (R.acc || 0) + dt;
        while (R.ball && R.acc >= C.DT) {
          R.acc -= C.DT;
          const ev = V.step(R.ball, R.f);
          if (ev === 'cross') {
            const b = R.ball;
            R.ball = null;
            incoming({ epoch: G.seen + 1, at: Clock.server(performance.now()), y: b.y, vx: b.vx, vy: b.vy, a: b.a, spin: b.spin, d: V.overshoot(b, R.f) });
          } else if (ev === 'floor') {
            R.ball = null;
            point('left', 'right');
          }
        }
      },
    };
    return R;
  }

  // ------------------------------------------------------------ scores, serves, messages
  function say(big, small = '', ms = 1600) {
    G.msg = { big, small, until: performance.now() + ms };
    const el = $('#vb-msg');
    fill(el, h('div', { class: 'big gradient-text' }, big), small ? h('div', { class: 'small' }, small) : null);
    el.style.opacity = '1';
  }

  function drawScore() {
    const el = $('#vb-score');
    if (S.settings.mode === 'coop') {
      fill(el, h('span', { class: 'who l' }, nameOf('left')), h('span', { class: 'n' }, `🤝 ${S.passes}`),
        h('span', { class: 'mid' }, `${'❤️'.repeat(Math.max(0, S.lives))}${'🖤'.repeat(Math.max(0, 3 - S.lives))}`), h('span', { class: 'who r' }, nameOf('right')));
    } else {
      fill(el, h('span', { class: 'who l' }, nameOf('left')), h('span', { class: 'n l' }, S.score.left), h('span', { class: 'mid' }, `to ${S.settings.target}`),
        h('span', { class: 'n r' }, S.score.right), h('span', { class: 'who r' }, nameOf('right')));
    }
    $('#vb-hint').textContent = mySide() ? 'Move your cursor into the ball to hit it · hold the button to carry it · keep it off your floor!' : '';
  }

  function serveTo(side, epoch, atServer) {
    G.ball = null; G.state = 'none'; G.locked = null; G.held = false; G.incoming = null;
    if (side === mySide()) {
      G.state = 'serve';
      G.serve = { due: Clock.local(atServer), epoch };
      say('Your serve!', 'Hit the ball over the net', 1500);
    } else {
      say(`${nameOf(side)} serves`, '', 1300);
    }
  }

  function point(winner, loser) {
    // practice mode keeps score here; online, the server does
    if (!solo) return;
    G.ball = null; G.state = 'none'; G.locked = null; G.incoming = null; G.robot.ball = null; G.robot.pending = null;
    S.score[winner]++;
    drawScore();
    Sfx.play(winner === 'left' ? 'coin' : 'lose');
    if (S.score[winner] >= S.settings.target) {
      S.phase = 'over';
      endCard(winner === 'left' ? '🏆 You win!' : '🤖 The robot wins', `${S.score.left} – ${S.score.right}`);
      if (winner === 'left') UI.confetti(160);
      return;
    }
    say(winner === 'left' ? 'Point!' : 'Robot scores', `${S.score.left} – ${S.score.right}`, 1300);
    setTimeout(() => { if (!solo || S.phase !== 'playing') return; if (winner === 'left') serveTo('left', ++G.seen, Clock.server(performance.now() + 900)); else G.robot.serve(); }, 1400);
  }

  function endCard(big, small) {
    const end = h('div', { class: 'vb-end' }, h('div', { class: 'card' },
      h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '2rem' } }, big),
      h('p', { class: 'muted', style: { margin: '8px 0 16px' } }, small),
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } },
        h('button', { class: 'btn btn-pink', onclick: () => { end.remove(); startSolo(); } }, '🔁 Again'),
        h('button', { class: 'btn btn-ghost', onclick: () => { end.remove(); leaveCourt(); } }, 'Done'))));
    $('#play').append(end);
  }

  // ------------------------------------------------------------ the loop
  function frame(t) {
    requestAnimationFrame(frame);
    tick(t);
  }
  function tick(t) {
    // real time, even when frames come slowly: the other screen counts on the ball being where it said
    const dt = Math.min(0.25, Math.max(0, (t - (G.last || t)) / 1000));
    G.last = t;
    if ($('#play').classList.contains('hidden')) return;
    const hd = G.hand;
    // the hand's speed, smoothed over ~50 ms so a twitchy trackpad doesn't fling the ball
    if (hd.on && hd.px >= 0 && dt > 0) {
      const k = 1 - Math.exp(-dt / 0.05);
      hd.vx += ((hd.x - hd.px) / dt - hd.vx) * k;
      hd.vy += ((hd.y - hd.py) / dt - hd.vy) * k;
    } else if (!hd.on) { hd.vx = 0; hd.vy = 0; }

    if (G.state === 'serve' && t >= G.serve.due) {
      takeBall(V.ball(G.f.side === 'left' ? G.f.w * 0.4 : G.f.w * 0.6, 0.36), G.serve.epoch);
      G.frozenUntil = t + 4000;   // it floats until you hit it (or 4 seconds pass)
    }
    if (G.state === 'incoming' && t >= G.incoming.due) {
      takeBall(V.arrive(G.incoming.msg, G.f), G.incoming.epoch);
      G.incoming = null;
    }

    if (G.state === 'mine') {
      const b = G.ball;
      if (G.held) {
        G.heldFor += dt;
        if (hd.on) V.hold(b, G.f, hd.x, hd.y, hd.vx, hd.vy, dt);
        if (G.heldFor > C.HOLD_MAX || !hd.on) letGo();
      }
      // a floating serve starts the moment your hand touches it
      if (G.frozenUntil && hd.on && Math.hypot(b.x - hd.x, b.y - hd.y) < C.R + C.HAND) G.frozenUntil = 0;
      const floating = G.frozenUntil && t < G.frozenUntil;
      if (!floating) G.frozenUntil = 0;
      if (!G.held && !floating) {
        G.acc += dt;
        const n = Math.floor(G.acc / C.DT);
        let i = 0;
        while (G.state === 'mine' && G.acc >= C.DT) {
          G.acc -= C.DT;
          i++;
          // the hand meets the ball at every step, all along the path it moved this frame
          if (!G.locked && hd.on && hd.px >= 0) {
            const k = n ? i / n : 1;
            const power = V.touch(G.ball, G.f, hd.px + (hd.x - hd.px) * k, hd.py + (hd.y - hd.py) * k, hd.vx, hd.vy);
            if (power > 0.35 && t - (G.lastHit || 0) > 110) { Sfx.tone(240 + power * 160, 0.07, 'triangle', 0.04 + Math.min(0.06, power * 0.02)); G.lastHit = t; }
          }
          const ev = V.step(G.ball, G.f);
          if (ev === 'cross') crossedNow();
          else if (ev === 'floor') hitFloor();
          else if (ev === 'net' || ev === 'wall') { if (t - (G.lastBump || 0) > 120) { Sfx.tone(ev === 'net' ? 140 : 200, 0.05, 'sine', 0.05); G.lastBump = t; } }
        }
        // a ball that's about to go over is announced now and can't be touched any more
        if (G.state === 'mine' && !G.locked) {
          const lead = leadTime();
          const p = V.predict(G.ball, G.f, Math.ceil(lead / C.DT));
          if (p && p.ev === 'cross') {
            const when = t + (p.steps * C.DT - G.acc) * 1000;
            const pb = p.ball;
            G.locked = { epoch: G.epoch, at: Clock.server(when), y: pb.y, vx: pb.vx, vy: pb.vy, a: pb.a, spin: pb.spin, d: V.overshoot(pb, G.f) };
            announce(G.locked);
          }
        }
      } else G.acc = 0;
      if (G.state === 'mine' && !solo && t - G.hb > 1000) { G.hb = t; Net.send('g:hb', { epoch: G.epoch }); }
    }
    if (G.leaving) {
      const b = G.leaving.b;
      b.vy += C.G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.spin * dt;
      if (t > G.leaving.until) G.leaving = null;
    }
    if (solo && G.robot && S.phase === 'playing') G.robot.tick(dt);
    hd.px = hd.x; hd.py = hd.y;
    if (hd.on) { hd.trail.push([hd.x, hd.y]); while (hd.trail.length > 7) hd.trail.shift(); }
    if (G.msg && t > G.msg.until) { G.msg = null; $('#vb-msg').style.opacity = '0'; }
    draw(t);
  }

  // ------------------------------------------------------------ drawing
  const U = (v) => v * Hpx;
  function draw(t) {
    const W = cv.width; const H = cv.height;
    const f = G.f;
    const side = mySide() || 'left';
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#120a33'); g.addColorStop(0.7, '#2a1458'); g.addColorStop(1, '#3b1a62');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 40; i++) { const x = ((i * 9301 + 49297) % 233280) / 233280 * W; const y = ((i * 4973 + 1301) % 9973) / 9973 * H * 0.6; ctx.fillRect(x, y, 2, 2); }
    // your colour glows along your outer wall
    const col = COLORS[side];
    const wallX = side === 'left' ? 0 : W;
    const wg = ctx.createLinearGradient(wallX, 0, side === 'left' ? U(0.25) : W - U(0.25), 0);
    wg.addColorStop(0, col + '44'); wg.addColorStop(1, col + '00');
    ctx.fillStyle = wg; ctx.fillRect(Math.min(wallX, side === 'left' ? 0 : W - U(0.25)), 0, U(0.25), H);
    // floor
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, H - U(0.02), W, U(0.02));
    ctx.fillStyle = col; ctx.fillRect(0, H - U(0.006), W, U(0.006));
    // the net on the seam
    const nx = U(f.seam);
    const top = U(1 - C.NET);
    const nw = U(0.014);
    const x0 = side === 'left' ? nx - nw : nx;
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x0, top, nw, H - top);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, U(0.002));
    ctx.beginPath();
    for (let y = top; y < H; y += U(0.03)) { ctx.moveTo(x0, y); ctx.lineTo(x0 + nw, y + U(0.015)); ctx.moveTo(x0 + nw, y); ctx.lineTo(x0, y + U(0.015)); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 - U(0.003), top - U(0.008), nw + U(0.006), U(0.012));
    // the incoming ball: a warning on the net, then it slides in
    if (G.state === 'incoming' && G.incoming) {
      const m = G.incoming.msg;
      const left = (G.incoming.due - t) / 1000;
      const y = U(m.y);
      const a = Math.max(0, Math.min(1, 1 - left / 0.6));
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * a;
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = U(0.008);
      ctx.beginPath(); ctx.arc(nx, y, U(C.R * 1.5 + 0.08 * (1 - a)), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (left < 0.2) {
        const bx = f.seam + m.vx * -left;
        drawBall({ x: bx, y: m.y + m.vy * -left, a: m.a || 0 }, 1);
      }
    }
    if (G.splash && t < G.splash.until) {
      const k = 1 - (G.splash.until - t) / 700;
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = U(0.006);
      ctx.beginPath(); ctx.ellipse(U(G.splash.x), H - U(0.01), U(0.05 + k * 0.15), U(0.012 + k * 0.03), 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (G.leaving) drawBall(G.leaving.b, 1);
    if (G.state === 'mine' && G.ball) {
      const b = G.ball;
      // shadow on the floor
      const hgt = 1 - b.y;
      ctx.fillStyle = `rgba(0,0,0,${0.35 - hgt * 0.25})`;
      ctx.beginPath(); ctx.ellipse(U(b.x), H - U(0.008), U(C.R * (1.2 - hgt * 0.5)), U(0.012), 0, 0, Math.PI * 2); ctx.fill();
      if (G.locked) {   // on its way over: a little trail
        ctx.strokeStyle = 'rgba(250,204,21,.35)'; ctx.lineWidth = U(C.R * 1.2); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(U(b.x - b.vx * 0.06), U(b.y - b.vy * 0.06)); ctx.lineTo(U(b.x), U(b.y)); ctx.stroke();
      }
      if (G.frozenUntil) {
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = U(0.004);
        ctx.beginPath(); ctx.arc(U(b.x), U(b.y), U(C.R + 0.02 + 0.01 * Math.sin(t / 200)), 0, Math.PI * 2); ctx.stroke();
      }
      drawBall(b, 1);
    }
    // where's the ball? (it's on the other screen)
    if (!solo && G.state === 'none' && S.phase === 'playing' && S.owner && S.owner !== side && !G.leaving) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = `700 ${Math.round(U(0.032))}px Fredoka, sans-serif`;
      ctx.textAlign = side === 'left' ? 'right' : 'left';
      ctx.fillText(side === 'left' ? `🏐 on ${nameOf('right')}'s screen →` : `← 🏐 on ${nameOf('left')}'s screen`, side === 'left' ? nx - U(0.04) : nx + U(0.04), U(0.2));
    }
    if (solo && G.robot) drawRobot();
    // your hand
    const hd = G.hand;
    if (hd.on && mySide()) {
      ctx.lineCap = 'round';
      for (let i = 1; i < hd.trail.length; i++) {
        ctx.strokeStyle = col + ['10', '18', '22', '2c', '36', '40', '4a'][Math.min(6, i)];
        ctx.lineWidth = U(C.HAND * 1.4 * i / hd.trail.length);
        ctx.beginPath(); ctx.moveTo(U(hd.trail[i - 1][0]), U(hd.trail[i - 1][1])); ctx.lineTo(U(hd.trail[i][0]), U(hd.trail[i][1])); ctx.stroke();
      }
      ctx.fillStyle = G.held ? col + 'cc' : col + '40';
      ctx.strokeStyle = col; ctx.lineWidth = U(0.006);
      ctx.beginPath(); ctx.arc(U(hd.x), U(hd.y), U(C.HAND), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawBall(b, alpha) {
    const x = U(b.x); const y = U(b.y); const r = U(C.R);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y); ctx.rotate(b.a || 0);
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9dce8');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.clip();
    ctx.lineWidth = r * 0.16;
    ctx.strokeStyle = '#facc15';
    ctx.beginPath(); ctx.arc(-r * 1.1, 0, r * 1.25, -0.9, 0.9); ctx.stroke();
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath(); ctx.arc(r * 1.1, 0, r * 1.25, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(0, r * 1.15, r * 1.2, -Math.PI + 0.9, -0.9); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawRobot() {
    // the robot's screen, small, in the top right corner
    const R = G.robot;
    const bw = cv.width * 0.24; const bh = bw / R.f.w;
    const bx = cv.width - bw - U(0.03); const by = U(0.11);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.strokeStyle = 'rgba(34,211,238,.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10); else ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
    const k = bh;   // 1 unit = bh pixels
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(bx, by + bh - 2, bw, 2);
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(bx, by + k * (1 - C.NET), 3, k * C.NET);
    if (R.ball) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx + R.ball.x * k, by + R.ball.y * k, C.R * k, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(34,211,238,.5)'; ctx.beginPath(); ctx.arc(bx + R.hand.x * k, by + R.hand.y * k, C.HAND * k, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `700 ${Math.round(bh * 0.1)}px Fredoka, sans-serif`; ctx.textAlign = 'right';
    ctx.fillText("🤖 Robot's screen", bx + bw - 8, by + bh * 0.14);
    ctx.restore();
  }

  requestAnimationFrame(frame);

  // ------------------------------------------------------------ showing the court
  function showCourt() {
    $('#play').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(resize);
    resize();
    drawScore();
    drawPing();
  }
  function hideCourt() {
    $('#play').classList.add('hidden');
    document.body.style.overflow = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function leaveCourt() {
    if (solo) {
      solo = false; S.phase = 'lobby'; G.robot = null; G.state = 'none'; G.ball = null;
      hideCourt();
      const url = new URL(location.href); url.searchParams.delete('solo'); history.replaceState(null, '', url);
      if (!Room.code) Lobby.showEntry();
      return;
    }
    if (S.phase === 'playing' && mySide() && !confirm('Leave the game? You’ll lose this match.')) return;
    Lobby.leave();
  }
  $('#vb-leave').addEventListener('click', leaveCourt);
  $('#vb-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else ($('#play').requestFullscreen ? $('#play').requestFullscreen() : Promise.reject()).catch(() => UI.toast('Your browser won’t go full screen here. Try ⌃⌘F on a Mac.', '', 3000));
  });
  document.addEventListener('visibilitychange', () => {
    // a hidden page stops running the ball, so give it up rather than leave the other screen waiting
    if (document.hidden && !solo && G.state === 'mine') hitFloor();
  });

  function startSolo() {
    solo = true;
    Lobby.hideEntry();
    $('#room').classList.add('hidden');
    $('.vb-end') && $('.vb-end').remove();
    Object.assign(S, { phase: 'playing', settings: { mode: 'versus', target: 7 }, score: { left: 0, right: 0 } });
    showCourt();
    G.robot = Robot();
    G.robot.f = V.field(G.f.w, 'right');
    G.seen = 0;
    const url = new URL(location.href); url.searchParams.set('solo', '1'); history.replaceState(null, '', url);
    serveTo('left', ++G.seen, Clock.server(performance.now() + 1200));
  }

  // ------------------------------------------------------------ room screen
  function route() {
    if (solo) return;
    const playing = S.phase === 'playing' && !!mySide();
    if (playing) { showCourt(); $('#room').classList.add('hidden'); } else { hideCourt(); if (Room.code) $('#room').classList.remove('hidden'); }
    renderRoomMain();
  }

  function renderRoomMain() {
    const host = Room.isHost;
    const me = mySide();
    const kids = [];
    const F = S.final;
    if (S.phase === 'playing') {
      kids.push(h('div', { class: 'vb-live' }, h('div', { class: 'muted bold' }, '🏐 Game on!'),
        S.settings.mode === 'coop' ? h('div', { class: 'n' }, `🤝 ${S.passes} passes · ${'❤️'.repeat(Math.max(0, S.lives))}`)
          : h('div', { class: 'n' }, `${S.score.left} – ${S.score.right}`),
        h('div', { class: 'small muted' }, `${nameOf('left')} vs ${nameOf('right')}`)));
    } else if (F) {
      kids.push(h('div', { class: 'vb-final' }, F.mode === 'coop'
        ? [h('div', { class: 'big gradient-text' }, `🤝 ${F.passes} passes`), h('p', { class: 'muted' }, `Longest rally: ${F.best} · ${F.names.left || '?'} & ${F.names.right || '?'}`)]
        : [h('div', { class: 'big gradient-text' }, `🏆 ${F.names[F.winner] || '?'} wins!`), h('p', { class: 'muted' }, `${F.score.left} – ${F.score.right}${F.forfeit ? ' (the other player left)' : ''} · longest rally ${F.best}`)]));
    }
    const seat = (s) => {
      const uid = S.sides[s];
      const p = uid ? Room.player(uid) : null;
      const mine = uid === Net.id;
      return h('div', { class: `vb-seat ${s[0]}` + (uid ? ' taken' : '') },
        h('div', { class: 'lap' }, s === 'left' ? '💻⬅️' : '➡️💻'),
        h('div', { class: 'bold' }, s === 'left' ? 'LEFT screen' : 'RIGHT screen'),
        p ? h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, UI.avatar(p, 'sm'), h('span', { class: 'bold' }, p.name, mine ? ' (you)' : '')) : h('div', { class: 'muted small' }, 'Empty'),
        S.phase === 'playing' ? null
          : mine ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => Net.send('g:side', { side: null }) }, 'Get up')
            : !uid && !Room.watching ? h('button', { class: s === 'left' ? 'btn btn-pink btn-sm' : 'btn btn-cyan btn-sm', onclick: () => { Net.send('g:side', { side: s }); Sfx.play('pop'); } }, me ? 'Move here' : 'Play here') : null);
    };
    const seg = (key, opts, label) => h('div', { class: 'vb-set' },
      h('div', { class: 'small muted bold', style: { marginBottom: '6px' } }, label),
      h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: S.settings[key] === v ? 'on' : '', disabled: !host || S.phase === 'playing', onclick: () => { Net.send('g:settings', { ...S.settings, [key]: v }); Sfx.play('click'); } }, l))));
    const ready = S.sides.left && S.sides.right;
    kids.push(
      h('div', { class: 'panel-title' }, '🏐 Who plays where'),
      h('div', { class: 'vb-seats' }, seat('left'), seat('right')),
      seg('mode', [['versus', '🏐 Versus'], ['coop', '🤝 Keep it up (together)']], 'MODE'),
      S.settings.mode === 'versus' ? seg('target', [[5, '5'], [7, '7'], [11, '11']], 'POINTS TO WIN') : h('p', { class: 'small muted vb-set' }, 'Pass the ball back and forth without dropping it. 3 drops and it’s over. How many passes can you do?'),
      S.phase === 'playing' ? null
        : host ? h('button', { class: 'btn btn-pink btn-lg btn-block', disabled: !ready, onclick: () => { Sfx.ac(); Net.send('g:start'); } }, ready ? (F ? '🔁 Play again' : '🏐 Start') : 'Waiting for both screens…')
          : h('div', { class: 'center muted bold', style: { padding: '14px' } }, h('span', { class: 'waiting-dots' }, '⏳ Waiting for the host')),
      h('div', { class: 'vb-tips' }, h('b', {}, '💡 Set up'),
        h('ol', {},
          h('li', {}, 'Put the two laptops side by side: the LEFT player’s laptop on the left.'),
          h('li', {}, 'Press ⛶ Full screen in the game, so each court reaches the edges of its screen.'),
          h('li', {}, 'Same Wi-Fi? The laptops connect straight to each other and the ball flies faster. Look for “direct” on the 📶 sign.'),
          h('li', {}, 'Move your cursor into the ball to hit it. Fast moves punch it, slow moves slow it down. Hold the button to carry it for a moment.'))),
      h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '12px' }, onclick: () => { Lobby.leave(); setTimeout(startSolo, 50); } }, '🤖 Practice against the robot'),
    );
    fill($('#room-main'), kids);
  }

  // ------------------------------------------------------------ wiring
  Lobby.init({
    game: 'volley',
    title: 'Screen Volley',
    emoji: '🏐',
    tagline: 'Two laptops side by side, one ball. Punch it across to your friend’s screen!',
    solo: { label: '🤖 Practice against the robot', onClick: () => startSolo() },
    howTo: '<b>How to play</b><ul><li>Put two laptops (or tablets) next to each other. One player takes the LEFT screen, the other the RIGHT one.</li><li>Your cursor is your hand: move it into the ball to hit it. Move fast to punch it, slowly to slow it down. Hold the button to carry it.</li><li>Get it over the net onto your friend’s screen. If it touches your floor, they score!</li><li>🤝 Keep it up: pass it back and forth together without dropping it.</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => (S.sides.left === p.id ? h('span', { title: 'Left screen' }, '⬅️') : S.sides.right === p.id ? h('span', { title: 'Right screen' }, '➡️') : null) });
  Lobby.ChatBox($('#room-chat'));

  function applyState(m) {
    const before = mySide();
    Object.assign(S, { phase: m.phase, settings: m.settings, sides: m.sides, score: m.score, owner: m.owner, epoch: m.epoch, rally: m.rally, best: m.best, passes: m.passes, lives: m.lives, final: m.final });
    if (mySide() !== before) resize();
    if (S.phase !== 'playing') { G.state = 'none'; G.ball = null; G.incoming = null; }
    Direct.connect();
    Lobby.refreshPlayers();
    drawScore();
    route();
  }

  Lobby.on('joined', (m) => {
    if (solo) { solo = false; G.robot = null; }
    applyState(m.state);
    for (let i = 0; i < 4; i++) setTimeout(syncClock, i * 250);
  });
  Lobby.on('players', () => { if (!solo) { Direct.connect(); renderRoomMain(); drawScore(); } });
  Lobby.on('left', () => { Direct.stop(); if (!solo) hideCourt(); });

  Net.on('g:state', (m) => { if (!solo) applyState(m); });
  Net.on('g:serve', (m) => {
    if (solo) return;
    S.score = m.score || S.score; S.lives = m.lives != null ? m.lives : S.lives; S.owner = m.side; S.epoch = m.epoch;
    G.seen = m.epoch;   // the server's count starts again every game
    drawScore();
    serveTo(m.side, m.epoch, m.at);
  });
  Net.on('g:rally', (m) => { if (!solo) { S.owner = m.owner; S.epoch = m.epoch; S.rally = m.rally; S.passes = m.passes; if (S.settings.mode === 'coop') drawScore(); } });
  Net.on('g:point', (m) => {
    if (solo) return;
    if (G.state === 'mine' || G.state === 'incoming') { G.state = 'none'; G.ball = null; G.incoming = null; }
    if (m.score) S.score = m.score;
    if (m.lives != null) S.lives = m.lives;
    S.owner = null;
    drawScore();
    if (S.settings.mode === 'coop') { say(`💔 Dropped after ${m.rally} pass${m.rally === 1 ? '' : 'es'}`, `${m.lives} ${m.lives === 1 ? 'life' : 'lives'} left`, 1500); Sfx.play('lose'); return; }
    const me = mySide();
    if (m.side === me) { say('Point!', `${S.score.left} – ${S.score.right}`, 1300); Sfx.play('coin'); } else { say(`${nameOf(m.side)} scores`, `${S.score.left} – ${S.score.right}`, 1300); Sfx.play('lose'); }
  });

  if (qs.get('debug')) window.VB = { G, S, Clock, Direct, startSolo, drive: () => setInterval(() => tick(performance.now()), 16) };   // for testing
  if (qs.get('solo')) startSolo();
})();
