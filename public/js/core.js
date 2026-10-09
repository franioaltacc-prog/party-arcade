/* Party Arcade core: helpers, profile, networking, sound, UI bits.
   Everything lives on window.PA so each page can grab what it needs. */
(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtMoney = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const fmtTime = (ms) => {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    return (m ? m + ':' + String(Math.floor(s % 60)).padStart(2, '0') : Math.floor(s)) + '.' + String(Math.floor(ms % 1000 / 10)).padStart(2, '0');
  };

  /** Tiny element builder: h('div', {class: 'x', onclick: fn}, 'text', child) */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  /** Replace an element's children, skipping null/false entries. */
  const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k))))); return el; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };

  // tiny event bus
  const bus = {};
  const on = (t, fn) => { (bus[t] ||= new Set()).add(fn); return () => bus[t].delete(fn); };
  const emit = (t, d) => { (bus[t] || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } }); };

  // ---------------------------------------------------------------- profile
  const AVATARS = ['😎', '🤖', '👽', '🐸', '🦊', '🐼', '🐙', '🦄', '🐯', '🐵', '👻', '🎃', '🍕', '🌮', '🚀', '⚡', '🔥', '💎', '🐧', '🦖', '🐱', '🐶', '🤠', '🥷', '🧙', '🐲', '🍩', '🐝'];
  const COLORS = ['#ff4fd8', '#8b5cf6', '#22d3ee', '#84cc16', '#facc15', '#fb923c', '#f43f5e', '#3b82f6', '#10b981', '#e879f9', '#14b8a6', '#f97316'];
  const ADJ = ['Turbo', 'Sneaky', 'Cosmic', 'Mega', 'Silly', 'Neon', 'Ultra', 'Fuzzy', 'Epic', 'Pixel', 'Lucky', 'Spicy', 'Hyper', 'Wobbly'];
  const NOUN = ['Taco', 'Ninja', 'Panda', 'Rocket', 'Pickle', 'Wizard', 'Llama', 'Comet', 'Noodle', 'Dragon', 'Potato', 'Goose', 'Waffle', 'Yeti'];

  const Profile = {
    get() {
      const saved = store.get('pa_profile');
      if (saved && saved.name) return saved;
      let draft = store.get('pa_profile_draft');
      if (!draft) {
        draft = { name: rand(ADJ) + rand(NOUN), avatar: rand(AVATARS), color: rand(COLORS) };
        store.set('pa_profile_draft', draft);
      }
      return draft;
    },
    isSet: () => !!store.get('pa_profile'),
    set(p) {
      const clean = { name: String(p.name || '').trim().slice(0, 16) || 'Player', avatar: p.avatar, color: p.color };
      store.set('pa_profile', clean);
      Net.send('profile', clean);
      emit('profile', clean);
    },
    /** Opens the profile editor. Resolves when saved. */
    edit({ first = false } = {}) {
      return new Promise((resolve) => {
        const p = { ...Profile.get() };
        const preview = h('div', { class: 'avatar xl', style: { '--c': p.color, margin: '0 auto 14px' } }, p.avatar);
        const nameInput = h('input', { class: 'input', maxlength: 16, value: p.name, placeholder: 'Your nickname', style: { textAlign: 'center', fontSize: '1.2rem', fontWeight: '700' } });
        const refresh = () => { preview.textContent = p.avatar; preview.style.setProperty('--c', p.color); };
        const emojiGrid = h('div', { class: 'emoji-grid' }, AVATARS.map((a) => h('button', {
          class: a === p.avatar ? 'on' : '', type: 'button', 'aria-label': 'Avatar ' + a,
          onclick: (e) => { p.avatar = a; $$('.emoji-grid button', box).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); refresh(); Sfx.play('click'); },
        }, a)));
        const colorRow = h('div', { class: 'color-row' }, COLORS.map((c) => h('button', {
          class: c === p.color ? 'on' : '', type: 'button', style: { background: c }, 'aria-label': 'Color ' + c,
          onclick: (e) => { p.color = c; $$('.color-row button', box).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); refresh(); Sfx.play('click'); },
        })));
        const save = () => { p.name = nameInput.value.trim() || p.name; Profile.set(p); close(); Sfx.play('coin'); resolve(p); };
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        const box = h('div', {},
          h('h2', { style: { textAlign: 'center' } }, first ? 'Welcome to the party! 🎉' : 'Your player card'),
          h('p', { class: 'muted', style: { textAlign: 'center', marginBottom: '16px' } }, first ? 'Pick a name and a look. Friends will see this.' : 'Change how friends see you.'),
          preview,
          h('div', { class: 'row', style: { marginBottom: '14px' } }, nameInput,
            h('button', { class: 'icon-btn', type: 'button', title: 'Random name', onclick: () => { nameInput.value = rand(ADJ) + rand(NOUN); Sfx.play('pop'); } }, '🎲')),
          h('div', { class: 'small muted bold', style: { margin: '4px 0 8px' } }, 'AVATAR'), emojiGrid,
          h('div', { class: 'small muted bold', style: { margin: '14px 0 8px' } }, 'COLOR'), colorRow,
          h('button', { class: 'btn btn-pink btn-block btn-lg', style: { marginTop: '20px' }, onclick: save }, first ? "Let's go! 🚀" : 'Save'),
        );
        const close = UI.modal(box, { dismissable: !first, onClose: () => resolve(null) });
        setTimeout(() => nameInput.select(), 50);
      });
    },
    async ensure() {
      if (!Profile.isSet()) await Profile.edit({ first: true });
      return Profile.get();
    },
  };

  // ---------------------------------------------------------------- network
  const Net = (() => {
    let ws = null;
    let ready = false;
    let retry = 0;
    let everConnected = false;
    let queue = [];
    const handlers = {};
    let uid = null;
    try { uid = sessionStorage.getItem('pa_uid'); } catch { /* ignore */ }
    if (!uid) {
      uid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
      try { sessionStorage.setItem('pa_uid', uid); } catch { /* ignore */ }
    }

    function fire(t, m) { (handlers[t] || []).slice().forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } }); }

    function connect() {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        const p = Profile.get();
        ws.send(JSON.stringify({ t: 'hello', id: uid, name: p.name, avatar: p.avatar, color: p.color }));
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          ready = true;
          retry = 0;
          const wasReconnect = everConnected;
          everConnected = true;
          const q = queue; queue = [];
          q.forEach((x) => ws.send(JSON.stringify(x)));
          emit('net', true);
          if (m.online) fire('online', m.online);
          if (wasReconnect) fire('reconnect', m);
        }
        fire(m.t, m);
      };
      ws.onclose = () => {
        ready = false;
        emit('net', false);
        setTimeout(connect, Math.min(6000, 400 * 2 ** retry++));
      };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    }

    function send(t, data = {}) {
      const m = { t, ...data };
      if (ready && ws && ws.readyState === 1) ws.send(JSON.stringify(m));
      else if (t !== 'g:pos' && queue.length < 60) queue.push(m);
    }

    function onMsg(t, fn) { (handlers[t] ||= []).push(fn); return () => offMsg(t, fn); }
    function offMsg(t, fn) { handlers[t] = (handlers[t] || []).filter((f) => f !== fn); }
    /** Resolve with the next message of type t. */
    function next(t, timeout = 8000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { offMsg(t, fn); reject(new Error('timeout')); }, timeout);
        const fn = (m) => { clearTimeout(timer); offMsg(t, fn); resolve(m); };
        onMsg(t, fn);
      });
    }

    setInterval(() => { if (ready) send('ping', { ts: Date.now() }); }, 20000);
    return { connect, send, on: onMsg, off: offMsg, next, get id() { return uid; }, get ready() { return ready; } };
  })();

  // ---------------------------------------------------------------- sound
  const Sfx = (() => {
    let ctx = null;
    let master = null;
    let muted = store.get('pa_muted', false);
    function ac() {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, dur = 0.1, type = 'square', vol = 0.08, slide = 0, delay = 0) {
      const c = ac(); if (!c) return;
      const t = c.currentTime + delay;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    function noise(dur = 0.3, vol = 0.15, delay = 0, hp = 0) {
      const c = ac(); if (!c) return;
      const t = c.currentTime + delay;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = vol;
      let node = src;
      if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
      node.connect(g).connect(master);
      src.start(t);
    }
    const presets = {
      click: () => tone(700, 0.04, 'triangle', 0.05),
      pop: () => tone(520, 0.09, 'sine', 0.12, 500),
      jump: () => tone(380, 0.11, 'square', 0.035, 380),
      boing: () => tone(220, 0.25, 'sine', 0.12, 600),
      orb: () => { tone(880, 0.08, 'triangle', 0.06); tone(1320, 0.12, 'triangle', 0.05, 0, 0.05); },
      coin: () => { tone(988, 0.07, 'square', 0.045); tone(1319, 0.16, 'square', 0.045, 0, 0.07); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, 0, i * 0.11)),
      lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.04, 0, i * 0.14)),
      boom: () => { noise(0.4, 0.22); tone(140, 0.3, 'sawtooth', 0.06, -100); },
      tick: () => tone(1250, 0.03, 'square', 0.03),
      go: () => tone(880, 0.35, 'square', 0.06),
      wrong: () => tone(150, 0.25, 'sawtooth', 0.06),
      right: () => { tone(660, 0.08, 'triangle', 0.08); tone(990, 0.16, 'triangle', 0.08, 0, 0.08); },
      message: () => tone(1100, 0.05, 'sine', 0.05),
      swoosh: () => noise(0.18, 0.08, 0, 1800),
    };
    return {
      play(name) { if (!muted && presets[name]) { try { presets[name](); } catch { /* audio unavailable */ } } },
      tone, noise, ac,
      get master() { ac(); return master; },
      get muted() { return muted; },
      setMuted(v) { muted = !!v; store.set('pa_muted', muted); emit('muted', muted); },
    };
  })();

  // ---------------------------------------------------------------- UI
  const UI = {
    toast(text, type = '', ms = 2600) {
      let stack = $('.toast-stack');
      if (!stack) { stack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' }); document.body.append(stack); }
      const t = h('div', { class: 'toast ' + type }, text);
      stack.append(t);
      while (stack.children.length > 4) stack.firstChild.remove();
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
    },

    /** Show a modal; returns a close() function. */
    modal(content, { dismissable = true, onClose, wide = false } = {}) {
      const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
      if (dismissable) box.append(h('button', { class: 'icon-btn modal-close', 'aria-label': 'Close', onclick: () => close() }, '✕'));
      box.append(content);
      const back = h('div', { class: 'modal-backdrop' }, box);
      let closed = false;
      const close = (silent) => {
        if (closed) return;
        closed = true;
        back.remove();
        document.removeEventListener('keydown', onKey);
        if (!silent && onClose) onClose();
      };
      const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
      if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
      document.addEventListener('keydown', onKey);
      document.body.append(back);
      return close;
    },

    avatar(p, size = '') {
      return h('div', { class: `avatar ${size} ${p && p.online === false ? 'off' : ''}`, style: { '--c': (p && p.color) || '#8b5cf6' }, title: p ? p.name : '' }, (p && p.avatar) || '🙂');
    },

    copy(text, msg = 'Copied! 📋') {
      const done = () => UI.toast(msg, 'good');
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => UI.fallbackCopy(text, done));
      else UI.fallbackCopy(text, done);
    },
    fallbackCopy(text, done) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
      document.body.append(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch { UI.toast(text); }
      ta.remove();
    },

    confetti(amount = 140) {
      let cv = $('#confetti');
      if (!cv) { cv = h('canvas', { id: 'confetti' }); document.body.append(cv); }
      const ctx = cv.getContext('2d');
      const W = (cv.width = innerWidth), H = (cv.height = innerHeight);
      const colors = ['#ff4fd8', '#22d3ee', '#a3e635', '#facc15', '#8b5cf6', '#fb923c'];
      const parts = Array.from({ length: amount }, () => ({
        x: W / 2 + (Math.random() - 0.5) * W * 0.4, y: H * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
        s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: rand(colors), life: 0,
      }));
      let frame = 0;
      const tick = () => {
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        for (const p of parts) {
          p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
          if (p.y < H + 20) alive++;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
          ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
        }
        if (alive && frame++ < 400) requestAnimationFrame(tick); else ctx.clearRect(0, 0, W, H);
      };
      tick();
    },

    /** 3..2..1..GO! overlay that ends exactly after `seconds`. */
    countdown(seconds, onDone) {
      const el = h('div', { class: 'countdown' });
      document.body.append(el);
      let n = Math.floor(seconds);
      let timer;
      const step = () => {
        el.innerHTML = '';
        if (n > 0) { el.append(h('span', {}, n)); Sfx.play('tick'); n--; timer = setTimeout(step, 1000); }
        else { el.append(h('span', { style: { color: 'var(--lime)' } }, 'GO!')); Sfx.play('go'); timer = setTimeout(() => el.remove(), 800); if (onDone) onDone(); }
      };
      timer = setTimeout(step, (seconds - Math.floor(seconds)) * 1000);
      return () => { clearTimeout(timer); el.remove(); };
    },

    /** Standard page top bar. */
    topbar({ title, emoji, back = true } = {}) {
      const p = Profile.get();
      const chip = h('button', { class: 'profile-chip', onclick: () => Profile.edit(), title: 'Edit your player card' },
        UI.avatar(p, 'sm'), h('span', { class: 'name' }, p.name));
      on('profile', (np) => { chip.replaceChildren(UI.avatar(np, 'sm'), h('span', { class: 'name' }, np.name)); });
      const muteBtn = h('button', { class: 'icon-btn', title: 'Sound on/off', 'aria-label': 'Toggle sound', onclick: () => Sfx.setMuted(!Sfx.muted) }, Sfx.muted ? '🔇' : '🔊');
      on('muted', (m) => { muteBtn.textContent = m ? '🔇' : '🔊'; });
      const pill = h('span', { class: 'online-pill hide-sm' }, h('span', { class: 'dot' }), h('span', { class: 'txt' }, 'Connecting…'));
      const setPill = (count) => { $('.txt', pill).textContent = `${count} online`; };
      Net.on('online', (m) => setPill(m.count));
      on('net', (ok) => { pill.classList.toggle('offline', !ok); if (!ok) $('.txt', pill).textContent = 'Reconnecting…'; });
      const bar = h('header', { class: 'topbar' },
        back ? h('a', { class: 'back-link', href: '/' }, '←', h('span', { class: 'hide-sm' }, ' Arcade')) : null,
        h('a', { class: 'logo', href: '/' }, h('span', { class: 'logo-mark' }, '🕹️'), h('span', { class: 'logo-word hide-sm' }, h('span', {}, 'PARTY'), h('span', {}, ' ARCADE'))),
        title ? h('div', { class: 'page-title' }, emoji ? h('span', {}, emoji) : null, h('span', {}, title)) : null,
        h('div', { class: 'spacer' }),
        pill, muteBtn, chip,
      );
      document.body.prepend(bar);
      return bar;
    },
  };

  window.PA = { $, $$, h, fill, esc, rand, clamp, sleep, fmtMoney, fmtTime, store, on, emit, Profile, Net, Sfx, UI, AVATARS, COLORS };
})();
