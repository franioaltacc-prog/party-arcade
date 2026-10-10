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

  // ---------------------------------------------------------------- profile & account
  const AVATARS = ['😎', '🤖', '👽', '🐸', '🦊', '🐼', '🐙', '🦄', '🐯', '🐵', '👻', '🎃', '🍕', '🌮', '🚀', '⚡', '🔥', '💎', '🐧', '🦖', '🐱', '🐶', '🤠', '🥷', '🧙', '🐲', '🍩', '🐝'];
  const COLORS = ['#ff4fd8', '#8b5cf6', '#22d3ee', '#84cc16', '#facc15', '#fb923c', '#f43f5e', '#3b82f6', '#10b981', '#e879f9', '#14b8a6', '#f97316'];
  const ADJ = ['Turbo', 'Sneaky', 'Cosmic', 'Mega', 'Silly', 'Neon', 'Ultra', 'Fuzzy', 'Epic', 'Pixel', 'Lucky', 'Spicy', 'Hyper', 'Wobbly'];
  const NOUN = ['Taco', 'Ninja', 'Panda', 'Rocket', 'Pickle', 'Wizard', 'Llama', 'Comet', 'Noodle', 'Dragon', 'Potato', 'Goose', 'Waffle', 'Yeti'];

  /** A logged-in account (saved stats, XP, leaderboards). Guests have none. */
  const Account = {
    user: store.get('pa_user', null),
    known: false,            // true once the server told us who we are
    get token() { return store.get('pa_token', null); },
    get admin() { return !!(Account.user && Account.user.admin); },
    save(user, token) {
      Account.user = user;
      store.set('pa_user', user);
      if (token) store.set('pa_token', token);
      emit('account', user);
      emit('profile', Profile.get());
    },
    clear() {
      Account.user = null;
      store.set('pa_user', null);
      try { localStorage.removeItem('pa_token'); } catch { /* storage blocked */ }
      emit('account', null);
      emit('profile', Profile.get());
    },
    async signup(name, password, look) {
      const r = await Net.request('auth:signup', { name, password, avatar: look.avatar, color: look.color });
      Account.save(r.user, r.token);
      return r.user;
    },
    async login(name, password) {
      const r = await Net.request('auth:login', { name, password });
      Account.save(r.user, r.token);
      return r.user;
    },
    async logout() {
      try { await Net.request('auth:logout', { token: Account.token }); } catch { /* offline: forget locally anyway */ }
      Account.clear();
      Net.send('profile', Profile.get());
    },
    async updateLook(look) {
      const r = await Net.request('account:update', look);
      Account.save(r.user);
      return r.user;
    },
    /** Save a solo high score (snake, 2048, memory, dash-solo) if logged in. */
    async submit(game, value) {
      if (!Account.user) {
        if (!Account.hinted) { Account.hinted = true; setTimeout(() => UI.toast('💡 Log in to save your scores on the leaderboards!', '', 3500), 1200); }
        return null;
      }
      try {
        const r = await Net.request('stats:solo', { game, value: Math.round(value) });
        if (r.best) UI.toast('🏆 New personal best — saved to the leaderboard!', 'good', 3500);
        return r;
      } catch (e) {
        console.warn('score not saved:', e.message);
        return null;
      }
    },
    /** Resolves once we know whether this browser is logged in (or after 4s). */
    ready() {
      if (Account.known) return Promise.resolve(Account.user);
      return new Promise((resolve) => {
        const off = on('auth', () => { off(); resolve(Account.user); });
        setTimeout(() => { off(); resolve(Account.user); }, 4000);
      });
    },
  };

  const Profile = {
    get() {
      if (Account.user) return { name: Account.user.name, avatar: Account.user.avatar, color: Account.user.color };
      const saved = store.get('pa_profile');
      if (saved && saved.name) return saved;
      let draft = store.get('pa_profile_draft');
      if (!draft) {
        draft = { name: rand(ADJ) + rand(NOUN), avatar: rand(AVATARS), color: rand(COLORS) };
        store.set('pa_profile_draft', draft);
      }
      return draft;
    },
    isSet: () => !!Account.user || !!store.get('pa_profile'),
    /** Save the guest look (name/avatar/color). */
    set(p) {
      const clean = { name: String(p.name || '').trim().slice(0, 16) || 'Player', avatar: p.avatar, color: p.color };
      store.set('pa_profile', clean);
      Net.send('profile', clean);
      emit('profile', clean);
    },
    /** Opens the player card / account window. Resolves when done. */
    edit({ first = false, view } = {}) {
      return UI.accountModal({ first, view: view || (Account.user ? 'me' : first ? 'choose' : 'guest') });
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
        ws.send(JSON.stringify({ t: 'hello', id: uid, name: p.name, avatar: p.avatar, color: p.color, token: Account.token }));
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'res') { const done = pending.get(m.rid); if (done) done(m); return; }
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

    // request/response: the server answers with {t: 'res', rid, ok, error?}
    const pending = new Map();
    let nextRid = 1;
    function request(t, data = {}, timeout = 15000) {
      return new Promise((resolve, reject) => {
        const rid = nextRid++;
        const timer = setTimeout(() => { pending.delete(rid); reject(new Error('The server took too long to answer. Try again!')); }, timeout);
        pending.set(rid, (m) => {
          clearTimeout(timer);
          pending.delete(rid);
          if (m.ok) resolve(m); else reject(new Error(m.error || 'Something went wrong 😵'));
        });
        send(t, { ...data, rid });
        connect();
      });
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
    return { connect, send, request, on: onMsg, off: offMsg, next, get id() { return uid; }, get ready() { return ready; } };
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
  // motion helpers from fx.js (loaded after this file; may be missing)
  const fx = () => (window.PA && window.PA.FX && window.PA.FX.on ? window.PA.FX : null);

  const UI = {
    toast(text, type = '', ms = 2600) {
      let stack = $('.toast-stack');
      if (!stack) { stack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' }); document.body.append(stack); }
      const t = h('div', { class: 'toast ' + type }, text);
      stack.append(t);
      while (stack.children.length > 4) stack.firstChild.remove();
      const f = fx();
      if (f) f.toastIn(t);
      setTimeout(() => {
        if (f) f.toastOut(t, () => t.remove());
        else { t.classList.add('out'); setTimeout(() => t.remove(), 260); }
      }, ms);
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
        const f = fx();
        if (f) f.modalOut(back, box, () => back.remove()); else back.remove();
        document.removeEventListener('keydown', onKey);
        if (!silent && onClose) onClose();
      };
      const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
      if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
      document.addEventListener('keydown', onKey);
      document.body.append(back);
      const f = fx();
      if (f) f.modalIn(back, box);
      return close;
    },

    avatar(p, size = '') {
      return h('div', { class: `avatar ${size} ${p && p.online === false ? 'off' : ''}`, style: { '--c': (p && p.color) || '#8b5cf6' }, title: p ? p.name : '' }, (p && p.avatar) || '🙂');
    },

    /** Little badges after a player's name: ✔ = has an account, 🛡️ = admin. */
    badges(p) {
      if (!p || !p.acct) return null;
      return h('span', { class: 'badges' }, p.adm ? h('span', { class: 'b-adm', title: 'Admin' }, '🛡️') : null,
        h('span', { class: 'b-acct', title: 'Registered player — click for their profile' }, '✔'));
    },

    /** XP progress bar for a user ({level, xp, from, to}). */
    xpBar(u) {
      const pct = Math.max(0, Math.min(100, ((u.xp - u.from) / Math.max(1, u.to - u.from)) * 100));
      return h('div', { class: 'xpbar', title: `${u.xp.toLocaleString('en-US')} XP` },
        h('div', { class: 'xpbar-top' }, h('b', {}, `Level ${u.level}`), h('span', {}, `${(u.xp - u.from).toLocaleString('en-US')} / ${(u.to - u.from).toLocaleString('en-US')} XP`)),
        h('div', { class: 'xpbar-track' }, h('i', { style: { width: pct + '%' } })));
    },

    timeAgo(ts) {
      const s = Math.max(0, Date.now() / 1000 - ts);
      if (s < 90) return 'just now';
      if (s < 3600) return `${Math.round(s / 60)} min ago`;
      if (s < 86400) return `${Math.round(s / 3600)} h ago`;
      if (s < 86400 * 45) return `${Math.round(s / 86400)} days ago`;
      return new Date(ts * 1000).toLocaleDateString();
    },

    /** Pick an emoji avatar and a color. Changes `look` in place. */
    lookPicker(look, onChange) {
      const preview = h('div', { class: 'avatar xl', style: { '--c': look.color, margin: '0 auto 12px' } }, look.avatar);
      const refresh = () => { preview.textContent = look.avatar; preview.style.setProperty('--c', look.color); if (onChange) onChange(look); };
      const grid = h('div', { class: 'emoji-grid' });
      const colors = h('div', { class: 'color-row' });
      fill(grid, AVATARS.map((a) => h('button', {
        class: a === look.avatar ? 'on' : '', type: 'button', 'aria-label': 'Avatar ' + a,
        onclick: (e) => { look.avatar = a; grid.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); refresh(); Sfx.play('click'); },
      }, a)));
      fill(colors, COLORS.map((c) => h('button', {
        class: c === look.color ? 'on' : '', type: 'button', style: { background: c }, 'aria-label': 'Color ' + c,
        onclick: (e) => { look.color = c; colors.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); refresh(); Sfx.play('click'); },
      })));
      return h('div', { class: 'look-picker' }, preview,
        h('div', { class: 'small muted bold', style: { margin: '4px 0 8px' } }, 'AVATAR'), grid,
        h('div', { class: 'small muted bold', style: { margin: '14px 0 8px' } }, 'COLOR'), colors);
    },

    /** The account window: choose / guest / signup / login / me / password / delete. */
    accountModal({ first = false, view = 'choose' } = {}) {
      return new Promise((resolve) => {
        const box = h('div', { class: 'acct' });
        const look = { ...Profile.get() };
        let result = null;
        let close = () => {};
        const done = (v) => { result = v; close(); };
        const go = (v) => { view = v; render(); };
        const err = h('p', { class: 'acct-err', role: 'alert' });
        const fail = (e) => { err.textContent = (e && e.message) || String(e); Sfx.play('wrong'); const f = fx(); if (f) f.shake(err); };
        const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('busy', on); };
        const header = (title, sub, back) => [
          back ? h('button', { class: 'icon-btn acct-back', type: 'button', 'aria-label': 'Back', onclick: () => go(back) }, '←') : null,
          h('h2', { class: 'acct-title' }, title),
          sub ? h('p', { class: 'muted acct-sub' }, sub) : null];
        const input = (props) => h('input', { class: 'input', ...props });
        const showPw = (...inputs) => h('label', { class: 'switch small acct-show' },
          h('input', { type: 'checkbox', onchange: (e) => inputs.forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; }) }), 'Show password');
        const form = (onSubmit, ...kids) => h('form', { class: 'acct-form', onsubmit: (e) => { e.preventDefault(); onSubmit(e.submitter || e.target.querySelector('[type=submit]')); } }, kids);
        const welcome = (u, again) => {
          UI.toast(again ? `👋 Welcome back, ${u.name}!` : `🎉 Account created! Welcome, ${u.name}!`, 'good', 3500);
          Sfx.play('win');
          if (!again) UI.confetti(140);
        };

        const views = {
          choose: () => [
            ...header(first ? 'Welcome to the party! 🎉' : 'Join the party! 🎉',
              'Make a free account to save your stats, level up and get on the leaderboards — or just jump in as a guest.'),
            h('div', { class: 'acct-choices' },
              h('button', { class: 'acct-choice pink', type: 'button', onclick: () => go('signup') }, h('span', { class: 'e' }, '✨'),
                h('span', {}, h('b', {}, 'Create an account'), h('small', {}, 'Saves your stats, XP & levels'))),
              h('button', { class: 'acct-choice cyan', type: 'button', onclick: () => go('login') }, h('span', { class: 'e' }, '🔑'),
                h('span', {}, h('b', {}, 'Log in'), h('small', {}, 'I already have an account'))),
              h('button', { class: 'acct-choice ghost', type: 'button', onclick: () => go('guest') }, h('span', { class: 'e' }, '🎮'),
                h('span', {}, h('b', {}, 'Play as a guest'), h('small', {}, 'Just play — nothing gets saved')))),
          ],

          guest: () => {
            const name = input({ maxlength: 16, value: look.name, placeholder: 'Your nickname', style: { textAlign: 'center', fontSize: '1.15rem', fontWeight: '700' } });
            return [
              ...header(first ? 'Play as a guest 🎮' : 'Your guest card 🎮', 'Pick a name and a look. Friends will see this.', first ? 'choose' : null),
              form(() => { look.name = name.value.trim() || look.name; Profile.set(look); Sfx.play('coin'); done(look); },
                h('div', { class: 'row', style: { marginBottom: '14px' } }, name,
                  h('button', { class: 'icon-btn', type: 'button', title: 'Random name', onclick: () => { name.value = rand(ADJ) + rand(NOUN); Sfx.play('pop'); } }, '🎲')),
                UI.lookPicker(look),
                h('button', { class: 'btn btn-pink btn-block btn-lg', type: 'submit', style: { marginTop: '18px' } }, first ? "Let's go! 🚀" : 'Save')),
              h('p', { class: 'small muted acct-foot' }, 'Want your wins to count? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('signup'); } }, 'Create a free account ✨')),
            ];
          },

          signup: () => {
            const name = input({ maxlength: 16, autocomplete: 'username', placeholder: 'e.g. TurboTaco', autocapitalize: 'off', spellcheck: false });
            const pw = input({ type: 'password', maxlength: 128, autocomplete: 'new-password', placeholder: 'At least 6 characters' });
            const pw2 = input({ type: 'password', maxlength: 128, autocomplete: 'new-password', placeholder: 'Type it again' });
            if (!Account.user && look.name && /^[A-Za-z0-9_]{3,16}$/.test(look.name)) name.value = look.name;
            const submit = async (btn) => {
              err.textContent = '';
              const n = name.value.trim();
              if (!/^[A-Za-z0-9_]{3,16}$/.test(n)) return fail(new Error('Usernames are 3–16 letters, numbers or _ (no spaces).'));
              if (pw.value.length < 6) return fail(new Error('Your password needs at least 6 characters.'));
              if (pw.value !== pw2.value) return fail(new Error("The two passwords don't match."));
              busy(btn, true);
              try { const u = await Account.signup(n, pw.value, look); welcome(u, false); done(u); } catch (e) { fail(e); } finally { busy(btn, false); }
            };
            return [
              ...header('Create your account ✨', 'Free, no email needed. Your stats and levels get saved.', 'choose'),
              form(submit,
                h('label', { class: 'field' }, 'Username', name, h('span', { class: 'tiny faint' }, '3–16 letters, numbers or _. Everyone can see it.')),
                h('label', { class: 'field' }, 'Password', pw),
                h('label', { class: 'field' }, 'Password again', pw2),
                showPw(pw, pw2),
                h('p', { class: 'tiny acct-warn' }, "🔒 Don't reuse a password from another website. There's no email, so remember it — write it down somewhere safe!"),
                h('details', { class: 'acct-look' }, h('summary', {}, UI.avatar(look, 'sm'), ' Pick your look'), UI.lookPicker(look, () => {
                  const sum = box.querySelector('.acct-look summary .avatar'); if (sum) { sum.textContent = look.avatar; sum.style.setProperty('--c', look.color); }
                })),
                err,
                h('button', { class: 'btn btn-pink btn-block btn-lg', type: 'submit' }, 'Create account 🚀')),
              h('p', { class: 'small muted acct-foot' }, 'Already have one? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('login'); } }, 'Log in')),
            ];
          },

          login: () => {
            const name = input({ maxlength: 16, autocomplete: 'username', placeholder: 'Your username', autocapitalize: 'off', spellcheck: false });
            const pw = input({ type: 'password', maxlength: 128, autocomplete: 'current-password', placeholder: 'Your password' });
            const submit = async (btn) => {
              err.textContent = '';
              if (!name.value.trim() || !pw.value) return fail(new Error('Type your username and password.'));
              busy(btn, true);
              try { const u = await Account.login(name.value.trim(), pw.value); welcome(u, true); done(u); } catch (e) { fail(e); } finally { busy(btn, false); }
            };
            return [
              ...header('Welcome back! 🔑', null, 'choose'),
              form(submit,
                h('label', { class: 'field' }, 'Username', name),
                h('label', { class: 'field' }, 'Password', pw),
                showPw(pw),
                err,
                h('button', { class: 'btn btn-cyan btn-block btn-lg', type: 'submit' }, 'Log in')),
              h('p', { class: 'small muted acct-foot' }, 'New here? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); go('signup'); } }, 'Create an account'),
                h('br'), h('span', { class: 'tiny faint' }, 'Forgot your password? Ask the site admin to reset it.')),
            ];
          },

          me: () => {
            const u = Account.user;
            const bio = input({ maxlength: 140, value: u.bio || '', placeholder: 'A short bio (optional)' });
            const save = async (btn) => {
              busy(btn, true);
              try { await Account.updateLook({ avatar: look.avatar, color: look.color, bio: bio.value }); UI.toast('Saved! ✨', 'good'); Sfx.play('coin'); done(Account.user); } catch (e) { fail(e); } finally { busy(btn, false); }
            };
            return [
              h('div', { class: 'acct-me' }, h('div', {}, h('h2', {}, u.name, u.admin ? ' 🛡️' : ''), h('p', { class: 'muted small' }, `Member since ${new Date(u.created * 1000).toLocaleDateString()}`)), UI.xpBar(u)),
              form(save, UI.lookPicker(look), h('label', { class: 'field', style: { marginTop: '14px' } }, 'Bio', bio), err,
                h('button', { class: 'btn btn-pink btn-block', type: 'submit', style: { marginTop: '12px' } }, 'Save my look')),
              h('div', { class: 'acct-links' },
                h('a', { class: 'btn btn-ghost btn-sm', href: '/profile?u=' + encodeURIComponent(u.name) }, '👤 My profile'),
                h('a', { class: 'btn btn-ghost btn-sm', href: '/leaderboards' }, '🏆 Leaderboards'),
                u.admin ? h('a', { class: 'btn btn-ghost btn-sm', href: '/admin' }, '🛡️ Admin') : null,
                h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => go('password') }, '🔒 Password'),
                h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => { await Account.logout(); UI.toast('Logged out. See you soon! 👋'); done(null); } }, '🚪 Log out')),
              h('p', { class: 'tiny acct-foot' }, h('a', { href: '#', class: 'danger-link', onclick: (e) => { e.preventDefault(); go('delete'); } }, 'Delete my account')),
            ];
          },

          password: () => {
            const old = input({ type: 'password', autocomplete: 'current-password', maxlength: 128 });
            const pw = input({ type: 'password', autocomplete: 'new-password', maxlength: 128, placeholder: 'At least 6 characters' });
            const pw2 = input({ type: 'password', autocomplete: 'new-password', maxlength: 128 });
            const submit = async (btn) => {
              if (pw.value.length < 6) return fail(new Error('Your new password needs at least 6 characters.'));
              if (pw.value !== pw2.value) return fail(new Error("The two new passwords don't match."));
              busy(btn, true);
              try {
                const r = await Net.request('account:password', { old: old.value, new: pw.value });
                store.set('pa_token', r.token);
                UI.toast('🔒 Password changed! Other devices were logged out.', 'good', 3500);
                go('me');
              } catch (e) { fail(e); } finally { busy(btn, false); }
            };
            return [...header('Change password 🔒', null, 'me'),
              form(submit, h('label', { class: 'field' }, 'Current password', old), h('label', { class: 'field' }, 'New password', pw),
                h('label', { class: 'field' }, 'New password again', pw2), showPw(old, pw, pw2), err,
                h('button', { class: 'btn btn-pink btn-block', type: 'submit' }, 'Change password'))];
          },

          delete: () => {
            const pw = input({ type: 'password', autocomplete: 'current-password', maxlength: 128, placeholder: 'Your password' });
            const submit = async (btn) => {
              busy(btn, true);
              try {
                await Net.request('account:delete', { password: pw.value });
                Account.clear();
                Net.send('profile', Profile.get());
                UI.toast('Your account was deleted. 👋');
                done(null);
              } catch (e) { fail(e); } finally { busy(btn, false); }
            };
            return [...header('Delete your account? 😢', 'This removes your account, stats, XP and match history forever. It can’t be undone.', 'me'),
              form(submit, h('label', { class: 'field' }, 'Type your password to confirm', pw), err,
                h('button', { class: 'btn btn-red btn-block', type: 'submit' }, 'Delete forever'))];
          },
        };

        const render = () => {
          if (view === 'me' && !Account.user) view = 'choose';
          err.textContent = '';
          fill(box, views[view]());
          const f = fx();
          if (f && box.isConnected) f.list(box.children, { y: 12, stagger: 0.04, duration: 0.3 });
          const first = box.querySelector('input:not([type=checkbox])');
          if (first && matchMedia('(pointer: fine)').matches) setTimeout(() => first.focus(), 60);
        };
        render();
        close = UI.modal(box, { dismissable: !first, onClose: () => resolve(result) });
      });
    },

    /** Small menu that drops down from a button. items: {label, href} | {label, onClick} | '-' */
    menu(anchor, items) {
      document.querySelectorAll('.pop-menu').forEach((m) => m.remove());
      const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc); };
      const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
      const esc = (e) => { if (e.key === 'Escape') close(); };
      const menu = h('div', { class: 'pop-menu', role: 'menu' }, items.filter(Boolean).map((it) => {
        if (it === '-') return h('div', { class: 'sep' });
        if (it.head) return h('div', { class: 'mhead' }, it.head);
        if (it.href) return h('a', { class: 'mi', href: it.href, role: 'menuitem' }, it.label);
        return h('button', { class: 'mi' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', onclick: () => { close(); it.onClick(); } }, it.label);
      }));
      document.body.append(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.top = r.bottom + 8 + 'px';
      menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', esc);
      const f = fx();
      if (f) f.gsap.from(menu, { y: -10, scale: 0.95, autoAlpha: 0, transformOrigin: '100% 0%', duration: 0.25, ease: 'back.out(2)' });
      return close;
    },

    /** Quick look at a registered player's profile. */
    async profileCard(name) {
      const box = h('div', { class: 'pcard' }, h('div', { class: 'center', style: { padding: '40px' } }, h('span', { class: 'spin', style: { fontSize: '2rem' } }, '🌀')));
      UI.modal(box);
      try {
        const { profile: p } = await Net.request('profile:get', { name });
        const st = p.stats || {};
        const games = st.games || 0;
        const wins = st.wins || 0;
        fill(box,
          h('div', { class: 'pcard-head' }, UI.avatar(p, 'xl'),
            h('h2', {}, p.name, p.admin ? h('span', { title: 'Admin' }, ' 🛡️') : null),
            h('p', { class: 'small ' + (p.online ? 'online-now' : 'muted') }, p.online ? `🟢 Online${p.playing ? ' · playing ' + p.playing : ''}` : `Last seen ${UI.timeAgo(p.lastSeen)}`),
            p.bio ? h('p', { class: 'pcard-bio' }, `“${p.bio}”`) : null),
          UI.xpBar(p),
          h('div', { class: 'pcard-stats' },
            h('div', {}, h('b', {}, games.toLocaleString('en-US')), h('span', {}, 'games')),
            h('div', {}, h('b', {}, wins.toLocaleString('en-US')), h('span', {}, 'wins')),
            h('div', {}, h('b', {}, games ? Math.round((wins / games) * 100) + '%' : '–'), h('span', {}, 'win rate')),
            h('div', {}, h('b', {}, p.rank ? '#' + p.rank : '–'), h('span', {}, 'rank'))),
          h('a', { class: 'btn btn-pink btn-block', href: '/profile?u=' + encodeURIComponent(p.name) }, 'View full profile →'));
      } catch (e) {
        fill(box, h('div', { class: 'center', style: { padding: '30px', flexDirection: 'column', gap: '8px' } }, h('div', { style: { fontSize: '2.4rem' } }, '🤷'), h('p', {}, e.message)));
      }
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
        const f = fx();
        if (n > 0) { const s = h('span', {}, n); el.append(s); if (f) f.countNum(s, false); Sfx.play('tick'); n--; timer = setTimeout(step, 1000); }
        else { const s = h('span', { style: { color: 'var(--lime)' } }, 'GO!'); el.append(s); if (f) f.countNum(s, true); Sfx.play('go'); timer = setTimeout(() => el.remove(), 800); if (onDone) onDone(); }
      };
      timer = setTimeout(step, (seconds - Math.floor(seconds)) * 1000);
      return () => { clearTimeout(timer); el.remove(); };
    },

    /** Standard page top bar. */
    topbar({ title, emoji, back = true } = {}) {
      const chip = h('button', { class: 'profile-chip', title: 'Your account', 'aria-haspopup': 'menu', onclick: () => UI.menu(chip, accountMenu()) });
      const drawChip = () => {
        const p = Profile.get();
        const u = Account.user;
        chip.replaceChildren(UI.avatar(p, 'sm'), h('span', { class: 'name' }, p.name),
          u ? h('span', { class: 'lvl', title: `Level ${u.level}` }, `Lv ${u.level}`) : h('span', { class: 'guest-tag' }, 'Guest'));
      };
      drawChip();
      on('profile', drawChip);
      on('account', drawChip);
      const accountMenu = () => {
        const u = Account.user;
        if (u) {
          return [{ head: h('div', {}, h('b', {}, u.name), h('div', { class: 'tiny muted' }, `Level ${u.level} · ${u.xp.toLocaleString('en-US')} XP`)) },
            { label: '👤 My profile', href: '/profile?u=' + encodeURIComponent(u.name) },
            { label: '🎨 Edit my look', onClick: () => Profile.edit() },
            { label: '🏆 Leaderboards', href: '/leaderboards' },
            { label: '🔎 Find players', href: '/players' },
            { label: '🎬 Credits', href: '/credits' },
            u.admin ? { label: '🛡️ Admin panel', href: '/admin' } : null,
            '-',
            { label: '🚪 Log out', onClick: async () => { await Account.logout(); UI.toast('Logged out. See you soon! 👋'); } }];
        }
        return [{ head: h('div', {}, h('b', {}, Profile.get().name), h('div', { class: 'tiny muted' }, 'Playing as a guest')) },
          { label: '✨ Create an account', onClick: () => UI.accountModal({ view: 'signup' }) },
          { label: '🔑 Log in', onClick: () => UI.accountModal({ view: 'login' }) },
          { label: '🎨 Edit my look', onClick: () => Profile.edit() },
          { label: '🏆 Leaderboards', href: '/leaderboards' },
          { label: '🔎 Find players', href: '/players' },
          { label: '🎬 Credits', href: '/credits' }];
      };
      const lbBtn = h('a', { class: 'icon-btn hide-sm', href: '/leaderboards', title: 'Leaderboards', 'aria-label': 'Leaderboards' }, '🏆');
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
        pill, lbBtn, muteBtn, chip,
      );
      document.body.prepend(bar);
      return bar;
    },
  };

  // ---------------------------------------------------------------- account events
  Net.on('auth:state', (m) => {
    Account.known = true;
    if (m.user) Account.save(m.user);
    else if (m.expired || m.banned) {
      const had = !!Account.user;
      Account.clear();
      Net.send('profile', Profile.get());
      if (had) UI.toast(m.banned ? '🚫 This account was banned.' : 'You were logged out. Log in again to keep saving your stats!', 'bad', 5000);
    } else if (m.offline) {
      if (Account.user) UI.toast('⚠️ Accounts are offline right now — stats won’t save for a bit.', 'bad', 5000);
    } else if (Account.user) Account.clear();
    emit('auth', Account.user);
  });
  Net.on('account:xp', (m) => {
    if (Account.user) Account.save({ ...Account.user, xp: m.xp, level: m.level, from: m.from, to: m.to });
    UI.toast(`✨ +${m.gained} XP${m.why ? ' · ' + m.why : ''}`, 'good', 3000);
    if (m.levelUp) {
      setTimeout(() => {
        const f = fx();
        if (f) f.banner(`⭐ LEVEL ${m.level}!`, 'You leveled up!', { color: '#facc15', hold: 1.6 });
        UI.confetti(180);
        Sfx.play('win');
      }, 700);
    }
  });
  Net.on('announce', (m) => {
    UI.toast(`📢 ${m.text}`, '', 9000);
    Sfx.play('boing');
  });

  window.PA = { $, $$, h, fill, esc, rand, clamp, sleep, fmtMoney, fmtTime, store, on, emit, Profile, Account, Net, Sfx, UI, AVATARS, COLORS };
})();
