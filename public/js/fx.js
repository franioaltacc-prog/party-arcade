/* Party Arcade motion: GSAP animations shared by every page.
   Every helper is safe to call even when GSAP didn't load (no internet) or the
   player's device asks for reduced motion; then they simply do nothing. */
(() => {
  'use strict';
  const g = window.gsap;
  // the device asks for reduced motion, or "Less motion" was picked in Settings (core.js sets .calm)
  const reduce = (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('calm');
  const ON = !!g && !reduce;
  if (g) g.registerPlugin(...[window.ScrollTrigger, window.Flip, window.SplitText].filter(Boolean));
  if (ON) document.documentElement.classList.add('fx-on');
  const finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);

  const list = (t) => {
    if (!t) return [];
    if (typeof t === 'string') return [...document.querySelectorAll(t)];
    if (t instanceof Element) return [t];
    return [...t].filter(Boolean);
  };

  const FX = { on: ON, gsap: g };

  // ------------------------------------------------------------- text
  /** Split an element's text into words or characters (spans you can animate). */
  FX.split = (el, type = 'words') => {
    if (!ON || !el) return [];
    if (el._fxSplit) return type === 'chars' ? el._fxSplit.chars : el._fxSplit.words;
    if (window.SplitText) {
      el._fxSplit = new SplitText(el, { type: 'words,chars', wordsClass: 'fx-word', charsClass: 'fx-char' });
    } else {
      const words = [];
      const parts = el.textContent.split(/(\s+)/);
      el.textContent = '';
      for (const p of parts) {
        if (/^\s*$/.test(p)) { el.append(p); continue; }
        const s = document.createElement('span');
        s.className = 'fx-word';
        s.style.display = 'inline-block';
        s.textContent = p;
        el.append(s);
        words.push(s);
      }
      el._fxSplit = { words, chars: words };
    }
    return type === 'chars' ? el._fxSplit.chars : el._fxSplit.words;
  };

  /** Bring a heading in word by word (gradient text animates as one piece so its colors survive). */
  FX.textIn = (el, delay = 0) => {
    if (!ON || !el) return;
    if (el.classList.contains('gradient-text')) {
      g.fromTo(el, { scale: 0.2, rotation: -8, autoAlpha: 0 }, { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.9, delay, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' });
      return;
    }
    g.fromTo(FX.split(el, 'words'), { y: -40, scale: 0.6, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, stagger: 0.08, duration: 0.5, delay, ease: 'back.out(2.5)' });
  };

  // ------------------------------------------------------------- small effects
  FX.pop = (el, opts = {}) => ON && el && g.fromTo(el, { scale: opts.from ?? 0.6, autoAlpha: 0 },
    { scale: 1, autoAlpha: 1, duration: opts.duration ?? 0.5, delay: opts.delay ?? 0, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
  FX.bump = (el) => ON && el && g.fromTo(el, { scale: 1.3 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)', clearProps: 'transform' });
  FX.shake = (el) => ON && el && g.fromTo(el, { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.2, 0.2)', clearProps: 'transform' });
  FX.jelly = (el) => ON && el && g.fromTo(el, { scaleX: 1.12, scaleY: 0.88 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1, 0.35)', clearProps: 'transform' });

  /** Stagger a group of elements in. */
  FX.list = (targets, opts = {}) => {
    const els = list(targets);
    if (!ON || !els.length) return;
    g.from(els, {
      y: opts.y ?? 16, x: opts.x ?? 0, scale: opts.scale ?? 1, rotation: opts.rotation ?? 0, autoAlpha: 0,
      duration: opts.duration ?? 0.5, stagger: opts.stagger ?? 0.05, delay: opts.delay ?? 0,
      ease: opts.ease ?? 'power3.out', clearProps: 'transform,opacity,visibility',
    });
  };

  /** Count a number up/down inside an element. */
  FX.count = (el, to, opts = {}) => {
    if (!el) return;
    const format = opts.format || ((v) => Math.round(v).toLocaleString('en-US'));
    if (el._fxCount) el._fxCount.kill();
    if (!ON || document.hidden) { el.textContent = opts.final ?? format(to); el.dataset.fxVal = to; return; }
    const from = opts.from ?? (Number(el.dataset.fxVal) || parseFloat(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0);
    el.dataset.fxVal = to;
    const box = { v: from };
    el.textContent = format(from);
    el._fxCount = g.to(box, {
      v: to, duration: opts.duration ?? 0.9, ease: 'power2.out',
      onUpdate: () => { el.textContent = format(box.v); },
      onComplete: () => { if (opts.final != null) el.textContent = opts.final; },
    });
  };

  /** Re-render a scoreboard: rows (marked with data-flip-id) slide to their new
      places and changed scores count up. `render` does the actual re-render. */
  FX.board = (container, render, ptsSel = '.pts') => {
    if (!ON || !container) { render(); return; }
    const rows = [...container.querySelectorAll('[data-flip-id]')];
    const state = window.Flip && rows.length ? Flip.getState(rows) : null;
    const old = {};
    rows.forEach((el) => { const p = el.querySelector(ptsSel); if (p) old[el.dataset.flipId] = p.textContent; });
    render();
    const now = [...container.querySelectorAll('[data-flip-id]')];
    if (state) Flip.from(state, { targets: now, duration: 0.55, ease: 'power2.inOut', simple: true });
    now.forEach((el) => {
      const p = el.querySelector(ptsSel);
      const before = old[el.dataset.flipId];
      if (!p || before == null || before === p.textContent) return;
      const final = p.textContent;
      const m = final.match(/^(\D*?)(-?[\d,]+)(.*)$/);
      const b = before.match(/-?[\d,]+/);
      if (m && b) {
        const to = Number(m[2].replace(/,/g, ''));
        const from = Number(b[0].replace(/,/g, ''));
        const commas = m[2].includes(',');
        FX.count(p, to, { from, final, duration: 0.8, format: (v) => m[1] + (commas ? Math.round(v).toLocaleString('en-US') : String(Math.round(v))) + m[3] });
      }
      FX.bump(p);
    });
  };

  // ------------------------------------------------------------- scroll + hover
  /** Fade/slide elements in when they scroll into view. */
  FX.reveal = (targets, opts = {}) => {
    const els = list(targets);
    if (!ON || !els.length) return;
    if (!window.ScrollTrigger) { FX.list(els, { y: 30, stagger: 0.06 }); return; }
    g.set(els, { y: opts.y ?? 50, autoAlpha: 0, rotation: opts.rotate ? (i) => (i % 2 ? 2.5 : -2.5) : 0 });
    ScrollTrigger.batch(els, {
      start: 'top 94%', once: true,
      onEnter: (batch) => g.to(batch, { y: 0, rotation: 0, autoAlpha: 1, stagger: 0.09, duration: 0.8, ease: 'back.out(1.5)', overwrite: true }),
    });
  };

  /** 3D tilt that follows the mouse. */
  FX.tilt = (targets, max = 7) => {
    if (!ON || !finePointer) return;
    for (const el of list(targets)) {
      if (el._fxTilt) continue;
      el._fxTilt = true;
      g.set(el, { transformPerspective: 900 });
      const rx = g.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3' });
      const ry = g.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3' });
      const lift = g.quickTo(el, 'y', { duration: 0.4, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * max * 2);
        rx(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
      });
      el.addEventListener('pointerenter', () => lift(-8));
      el.addEventListener('pointerleave', () => { rx(0); ry(0); lift(0); });
    }
  };

  // ------------------------------------------------------------- big moments
  /** A big banner that sweeps across the screen. */
  let bannerTl = null;
  FX.banner = (title, sub, opts = {}) => {
    if (!ON || document.hidden) return;
    if (bannerTl) bannerTl.progress(1);
    const el = document.createElement('div');
    el.className = 'fx-banner';
    const inner = document.createElement('div');
    inner.className = 'fx-banner-inner';
    if (opts.color) inner.style.setProperty('--fx-c', opts.color);
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    inner.append(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 's';
      s.textContent = sub;
      inner.append(s);
    }
    el.append(inner);
    document.body.append(el);
    bannerTl = g.timeline({ onComplete: () => { el.remove(); bannerTl = null; } })
      .fromTo(inner, { xPercent: -130, skewX: 25 }, { xPercent: 0, skewX: 0, duration: 0.55, ease: 'power4.out' })
      .from(t, { letterSpacing: '0.4em', duration: 0.6, ease: 'power3.out' }, 0.1)
      .to(inner, { xPercent: 130, skewX: -25, duration: 0.45, ease: 'power3.in' }, opts.hold ?? 1.4);
  };

  /** Emoji rain (coins on big wins). */
  FX.rain = (emoji = '🪙', n = 28) => {
    if (!ON || document.hidden) return;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'fx-drop';
      s.textContent = emoji;
      s.style.left = rand(2, 96) + 'vw';
      s.style.fontSize = rand(20, 44) + 'px';
      document.body.append(s);
      g.to(s, { y: innerHeight + 140, x: rand(-90, 90), rotation: rand(-540, 540), duration: rand(1.3, 2.4), delay: rand(0, 0.6), ease: 'power1.in', onComplete: () => s.remove() });
    }
  };

  /** Fly a copy of one element onto another (a chip landing on the table). */
  FX.fly = (fromEl, toEl) => {
    if (!ON || document.hidden || !fromEl || !toEl) return;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const ghost = fromEl.cloneNode(true);
    ghost.classList.add('fx-ghost');
    Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: 0 });
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    g.timeline({ onComplete: () => ghost.remove() })
      .to(ghost, { x: dx, duration: 0.45, ease: 'power1.inOut' }, 0)
      .to(ghost, { y: dy, duration: 0.45, ease: 'back.in(1.6)' }, 0)
      .to(ghost, { rotation: 360, duration: 0.45, ease: 'power1.out' }, 0)
      .to(ghost, { scale: 0.45, autoAlpha: 0, duration: 0.15 }, 0.36);
  };

  /** Smoothly move re-rendered rows to their new spots (scoreboards). */
  FX.flipState = (targets) => {
    const els = list(targets);
    return ON && window.Flip && els.length ? Flip.getState(els) : null;
  };
  FX.flipFrom = (state, targets) => {
    if (!state || !ON) return;
    Flip.from(state, { targets: list(targets), duration: 0.55, ease: 'power2.inOut', simple: true });
  };

  /** Results podium: blocks grow, winners drop in. */
  FX.podium = (root) => {
    if (!ON || !root) return;
    const steps = [...root.querySelectorAll('.step')];
    const byPlace = (cls) => steps.filter((s) => s.classList.contains(cls));
    const order = [...byPlace('p3'), ...byPlace('p2'), ...byPlace('p1')];
    const tl = g.timeline();
    order.forEach((step, i) => {
      const block = step.querySelector('.block');
      const av = step.querySelector('.avatar');
      const txt = step.querySelectorAll('.pname, .pts');
      if (block) tl.from(block, { scaleY: 0, transformOrigin: '50% 100%', duration: 0.5, ease: 'back.out(1.7)' }, i * 0.35);
      if (av) tl.from(av, { y: -120, autoAlpha: 0, duration: 0.8, ease: 'bounce.out' }, i * 0.35 + 0.2);
      if (txt.length) tl.from(txt, { autoAlpha: 0, y: 10, duration: 0.3, stagger: 0.05 }, i * 0.35 + 0.45);
    });
    const winner = byPlace('p1')[0];
    const av = winner && winner.querySelector('.avatar');
    if (av) tl.to(av, { y: -10, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    root._fxLoop = tl;
    root.setAttribute('data-fx-loop', '');
  };

  // ------------------------------------------------------------- core UI hooks
  FX.modalIn = (back, box) => {
    if (!ON) return;
    g.fromTo(back, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
    g.fromTo(box, { y: 50, scale: 0.88, rotationX: -14, autoAlpha: 0, transformPerspective: 900 },
      { y: 0, scale: 1, rotationX: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(1.6)', clearProps: 'transform' });
    const body = box.lastElementChild;
    if (body) FX.list([...body.children].slice(0, 12), { y: 14, stagger: 0.04, delay: 0.12, duration: 0.4 });
  };
  FX.modalOut = (back, box, done) => {
    if (!ON) { done(); return; }
    back.style.pointerEvents = 'none';
    g.to(box, { y: 24, scale: 0.94, autoAlpha: 0, duration: 0.18, ease: 'power2.in' });
    g.to(back, { autoAlpha: 0, duration: 0.22, onComplete: done });
  };
  FX.toastIn = (el) => ON && g.from(el, { y: 40, scale: 0.7, autoAlpha: 0, duration: 0.5, ease: 'back.out(2.2)' });
  FX.toastOut = (el, done) => {
    if (!ON) { done(); return; }
    g.to(el, { y: 16, scale: 0.9, autoAlpha: 0, duration: 0.25, ease: 'power2.in', onComplete: done });
  };
  FX.countNum = (span, isGo) => {
    if (!ON) return;
    span.style.display = 'inline-block';
    g.timeline()
      .fromTo(span, { scale: isGo ? 0.4 : 2.8, rotation: isGo ? -10 : 15, autoAlpha: 0 },
        { scale: 1, rotation: 0, autoAlpha: 1, duration: 0.45, ease: isGo ? 'elastic.out(1, 0.4)' : 'back.out(2)' })
      .to(span, { scale: isGo ? 1.6 : 0.6, autoAlpha: 0, duration: 0.25, ease: 'power2.in' }, isGo ? 0.55 : 0.72);
  };

  /** Animate the "join a game" card on every online game page. */
  FX.entry = (root) => {
    if (!ON || !root) return;
    const icon = root.querySelector('.game-icon');
    const h1 = root.querySelector('h1');
    const chars = FX.split(h1, 'chars');
    if (root._fxTl) root._fxTl.kill();
    const tl = root._fxTl = g.timeline({ defaults: { ease: 'power3.out' } });
    tl.fromTo(root, { y: 40, autoAlpha: 0, scale: 0.96 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.5 });
    if (icon) tl.fromTo(icon, { y: -90, rotation: -40, scale: 0.3, autoAlpha: 0 }, { y: 0, rotation: 0, scale: 1, autoAlpha: 1, duration: 0.9, ease: 'bounce.out' }, 0.05);
    if (chars.length) tl.fromTo(chars, { y: -40, rotation: () => rand(-25, 25), autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, stagger: 0.03, duration: 0.5, ease: 'back.out(2.5)' }, 0.2);
    tl.fromTo(root.querySelectorAll('.tagline, .actions > *, .how-to'), { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.45, ease: 'back.out(1.6)', clearProps: 'transform' }, 0.45);
    if (icon) tl.to(icon, { y: -10, rotation: 4, duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  };

  // ------------------------------------------------------------- automatic effects
  // Elements that animate in whenever they appear (results screens, popups...).
  const seen = new Set();
  // endless idle tweens are remembered so they can be stopped when their element is removed
  const loop = (el, anim) => { el._fxLoop = anim; el.setAttribute('data-fx-loop', ''); return anim; };
  const once = (el) => {
    const sig = el.className + '|' + el.textContent.slice(0, 300);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  };
  const AUTO = [
    ['.podium', (el) => once(el) && FX.podium(el)],
    ['.awards', (el) => once(el) && FX.list(el.children, { y: 30, rotation: -8, scale: 0.7, stagger: 0.1, ease: 'back.out(2)', duration: 0.6 })],
    ['.res-cards', (el) => once(el) && FX.list(el.children, { y: 30, scale: 0.8, stagger: 0.08, ease: 'back.out(2)', duration: 0.55, delay: 0.3 })],
    ['.res-hero', (el) => {
      if (!once(el)) return;
      const crown = el.querySelector('.crown');
      if (crown) {
        loop(crown, g.timeline().fromTo(crown, { y: -160, rotation: -30, autoAlpha: 0 }, { y: 0, rotation: 0, autoAlpha: 1, duration: 1, ease: 'bounce.out' })
          .to(crown, { y: -10, rotation: 6, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
      }
      FX.list(el.querySelectorAll('h2, p'), { y: 20, stagger: 0.1, delay: 0.35 });
    }],
    ['.title-card', (el) => {
      const h2 = el.querySelector('h2');
      const em = el.querySelector('.emoji');
      if (em) {
        loop(em, g.timeline().fromTo(em, { scale: 0, rotation: -200 }, { scale: 1, rotation: 0, duration: 0.8, ease: 'elastic.out(1, 0.5)' })
          .to(em, { y: -12, rotation: 6, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
      }
      if (h2) g.fromTo(FX.split(h2, 'chars'), { y: -60, autoAlpha: 0, rotation: () => rand(-30, 30) }, { y: 0, autoAlpha: 1, rotation: 0, stagger: 0.035, duration: 0.5, ease: 'back.out(2.5)', delay: 0.1 });
      FX.list(el.querySelectorAll('p'), { delay: 0.45 });
    }],
    ['.res-list', (el) => FX.list(el.children, { x: -30, y: 0, stagger: 0.07, ease: 'back.out(1.7)' })],
    ['.event-card', (el) => {
      g.fromTo(el, { rotationX: -75, transformOrigin: '50% 0%', transformPerspective: 900, autoAlpha: 0 }, { rotationX: 0, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.6)', clearProps: 'transform' });
      FX.list(el.querySelectorAll('.choices > *'), { x: -24, y: 0, stagger: 0.07, delay: 0.3 });
    }],
    ['.pk-win', (el) => once(el) && FX.pop(el)],
    ['.dead-card', (el) => {
      if (!once(el)) return;
      const stone = el.querySelector('.stone');
      if (stone) g.fromTo(stone, { y: -120, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'bounce.out' });
    }],
    ['.locked', (el) => FX.pop(el, { from: 0.85 })],
    ['.canvas-overlay .big', (el) => FX.textIn(el)],
    ['.winner', (el) => FX.textIn(el, 0.15)],
    ['.result-big', (el) => FX.textIn(el, 0.2)],
    ['.results-box', (el) => once(el) && FX.list(el.querySelectorAll('tr'), { x: -30, y: 0, stagger: 0.08 })],
    ['.side.a', (el) => g.from(el, { x: -80, rotation: -4, autoAlpha: 0, duration: 0.6, ease: 'back.out(1.6)', clearProps: 'transform,opacity,visibility' })],
    ['.side.b', (el) => g.from(el, { x: 80, rotation: 4, autoAlpha: 0, duration: 0.6, ease: 'back.out(1.6)', clearProps: 'transform,opacity,visibility' })],
    ['.or', (el) => g.fromTo(el, { scale: 0, rotation: -180 }, { scale: 1, rotation: 0, duration: 0.7, delay: 0.25, ease: 'elastic.out(1, 0.5)', clearProps: 'transform' })],
    ['.story', (el) => once(el) && FX.list(el, { y: 20 })],
  ];
  const AUTO_SEL = AUTO.map(([sel]) => sel).join(',');
  function scan(node) {
    if (!(node instanceof Element)) return;
    const found = node.matches(AUTO_SEL) ? [node] : [];
    found.push(...node.querySelectorAll(AUTO_SEL));
    for (const el of found) {
      for (const [sel, fn] of AUTO) {
        if (el.matches(sel)) { try { fn(el); } catch (e) { console.warn(e); } break; }
      }
    }
  }

  function boot() {
    if (!ON) return;
    // top bar slides down
    const bar = document.querySelector('.topbar');
    if (bar) g.from(bar.children, { y: -40, autoAlpha: 0, duration: 0.5, stagger: 0.05, ease: 'power3.out', clearProps: 'transform,opacity,visibility' });
    // entry cards that are already on screen (404 page)
    document.querySelectorAll('.entry').forEach((el) => { if (!el._fxTl && el.offsetParent) FX.entry(el); });
    // solo pages: the page content rises in
    if (!document.querySelector('.hero, #entry, .entry')) FX.list(document.querySelectorAll('main.page > *'), { y: 30, stagger: 0.1, duration: 0.6, ease: 'back.out(1.4)' });
    // buttons wobble when clicked
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.btn, .icon-btn, .chip-btn, .gbtn, .act, .bet-btn, .seg button, .tabs button, .act-tabs button, .sib-acts button, .profile-chip');
      if (b && !b.disabled) FX.jelly(b);
    }, true);
    // soft glow that follows the mouse
    if (finePointer) {
      const glow = document.createElement('div');
      glow.className = 'fx-glow';
      document.body.append(glow);
      const qx = g.quickTo(glow, 'x', { duration: 0.8, ease: 'power3' });
      const qy = g.quickTo(glow, 'y', { duration: 0.8, ease: 'power3' });
      addEventListener('pointermove', (e) => { qx(e.clientX); qy(e.clientY); }, { passive: true });
    }
    // animate special elements whenever they appear
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) scan(n);
        for (const n of m.removedNodes) {
          if (!(n instanceof Element) || n.isConnected) continue;
          const loops = n.hasAttribute('data-fx-loop') ? [n] : [];
          loops.push(...n.querySelectorAll('[data-fx-loop]'));
          loops.forEach((el) => { if (el._fxLoop) { el._fxLoop.kill(); el._fxLoop = null; } });
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.PA = window.PA || {};
  window.PA.FX = FX;
})();
