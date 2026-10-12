/* Quests page (/quests): a limited-time event's quests (its achievements), your progress on each,
   what they give you, and the grand prize (the event's theme) with a big Equip button once earned. */
(() => {
  'use strict';
  const { $, h, fill, UI, Net, Sfx, Account, Unlocks, store, on } = PA;
  const FX = PA.FX || {};
  UI.topbar({ title: 'Quests', emoji: '🎃' });
  Net.connect();
  const root = $('#quests');

  // where to go for each quest
  const PLAY = {
    'trick-or-treat': ['/', 'Find a game'], boo: ['/games/prophunt', 'Prop Hunt'], 'night-owl': ['/', 'Find a game'],
    'haunted-hole': ['/games/golf', 'Mini Golf'], 'creepy-flap': ['/games/flappy', 'Neon Flappy'], 'pool-shark': ['/games/billiards', 'Billiards'],
    undead: ['/games/life', 'Family Life'], 'sweet-tooth': ['/games/doodle', 'Doodle Guess'],
  };
  const KINDS = [['auras', '✨', 'aura'], ['anims', '🎭', 'avatar animation'], ['balls', '🛝', 'ball skin'], ['themes', '🎨', 'theme']];

  let U = null;
  let ev = null;
  let stats = null;
  let have = null;
  let tick = 0;

  /** The event to show: ?event=id, else the one going on, else the latest one that had quests. */
  function pickEvent() {
    const want = new URLSearchParams(location.search).get('event');
    const all = (U.events || []).map((e) => Unlocks.event(U, e.id)).filter((e) => e && Unlocks.quests(U, e.id).length);
    return all.find((e) => e.id === want) || all.find((e) => e.active) || all.filter((e) => !e.over)[0]
      || all.sort((a, b) => Date.parse(b.until) - Date.parse(a.until))[0] || null;
  }

  function countdown() {
    const target = Date.parse((ev.active || ev.over ? ev.until : ev.from) + 'T00:00:00Z');
    const box = h('div', { class: 'q-count', 'aria-live': 'off' });
    const draw = () => {
      let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
      if (!s && !ev.over) { clearInterval(tick); render(); return; }
      const parts = [[Math.floor(s / 86400), 'days'], [Math.floor(s % 86400 / 3600), 'hours'], [Math.floor(s % 3600 / 60), 'min'], [s % 60, 'sec']];
      fill(box, parts.map(([n, l]) => h('div', {}, h('b', {}, String(n).padStart(2, '0')), h('span', {}, l))));
    };
    draw();
    clearInterval(tick);
    tick = setInterval(draw, 1000);
    return box;
  }

  const rewardsOf = (id) => KINDS.flatMap(([k, e, label]) => (U[k] || []).filter((x) => x.rule && x.rule.ach === id).map((x) => `${e} ${x.name} ${label}`));

  function questCard(a, prize) {
    const p = stats ? Unlocks.progress(a, stats, have.achievements) : null;
    const done = !!(p && p.done);
    const [href, game] = PLAY[a.id] || [];
    return h('article', { class: 'quest' + (done ? ' done' : '') + (ev.over && !done ? ' missed' : '') },
      done ? h('span', { class: 'tick', title: 'Done!' }, '✅') : null,
      h('div', { class: 'qe' }, a.emoji),
      h('h3', {}, a.name),
      h('div', { class: 'qd' }, a.desc.replace(/ during the Halloween event$/, '')),
      p ? h('div', { class: 'qp-row' }, h('div', { class: 'q-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.need, 'aria-valuenow': p.have, 'aria-label': a.name },
        h('i', { style: { width: `${(p.have / p.need) * 100}%` } })), h('span', { class: 'qn' }, `${p.have}/${p.need}`)) : null,
      h('div', { class: 'qr' }, rewardsOf(a.id).map((r) => h('span', { class: 'chip' }, '🎁 ', r)),
        prize ? h('span', { class: 'chip theme' }, `${prize.emoji} 1 of ${prize.rule.achs.length} for the theme`) : null,
        href && ev.active && !done ? h('a', { class: 'go', href }, `${game} →`) : ev.over && !done ? h('span', { class: 'go faint' }, 'Missed') : null));
  }

  function prizeCard(prize, quests) {
    const p = stats ? Unlocks.progress(prize, stats, have.achievements) : null;
    const earned = !!(have && have.theme && have.theme.has(prize.id));
    const wearing = PA.Theme.current === prize.id;
    PA.Theme.font(prize.id);
    const preview = h('div', { class: 'theme-prev', 'data-theme': prize.id, 'aria-hidden': 'true' },
      h('div', { class: 'tp-bar' }, h('span', { class: 'tp-logo' }), h('span', { class: 'tp-title' }, 'Party ', h('i', {}, 'Arcade'))),
      h('div', { class: 'tp-body' }, h('div', { class: 'tp-card' }, h('i'), h('i')), h('div', { class: 'tp-card' }, h('i'), h('i')), h('span', { class: 'tp-btn' }, 'Play')),
      h('span', { class: 'tp-moon' }), h('span', { class: 'tp-jack' }, '🎃'));
    let action;
    if (earned) {
      action = wearing
        ? [h('div', { class: 'pz-on' }, '✅ Equipped'), h('p', { class: 'small' }, 'Change themes any time in ', h('a', { href: '/settings#theme' }, 'Settings'), '.')]
        : h('button', { class: 'btn btn-pink btn-lg', onclick: (e) => equip(prize, e.currentTarget) }, `${prize.emoji} Equip`);
    } else if (!Account.user) {
      action = h('button', { class: 'btn btn-pink', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Make a free account');
    } else if (ev.over) {
      action = h('p', { class: 'small' }, 'The event is over, so this one can’t be unlocked any more.');
    } else {
      const left = p.need - p.have;
      action = h('button', { class: 'btn btn-ghost', disabled: true }, `🔒 ${left} quest${left === 1 ? '' : 's'} to go`);
    }
    return h('aside', { class: 'prize' + (earned ? ' earned' : ' locked') },
      h('div', { class: 'pz-k' }, earned ? 'Unlocked — yours forever' : 'Grand prize'),
      h('h2', {}, `${prize.name} theme`),
      h('div', { class: 'pz-wrap' }, preview, earned ? null : h('span', { class: 'pz-lock' }, '🔒')),
      h('p', {}, earned ? `${prize.about}. You earned it during the ${ev.name} event, so it stays yours even after it ends.`
        : ev.over ? `${prize.about}. It went to everyone who finished all ${quests.length} quests during the event.`
          : `${prize.about}. Finish all ${quests.length} quests before ${ev.last} to unlock it — then it’s yours forever.`),
      action);
  }

  async function equip(prize, btn) {
    btn.classList.add('busy');
    try {
      await PA.Theme.set(prize.id);
      Sfx.play('win');
      UI.toast(`${prize.emoji} ${prize.name} theme on! Happy haunting 🦇`, 'good', 3500);
      for (let i = 0; i < 4; i++) PA.Theme.flyBat(i * 300);
    } catch (e) {
      btn.classList.remove('busy');
      UI.toast(e.message, 'bad');
    }
  }

  async function render() {
    U = await Unlocks.load();
    ev = pickEvent();
    if (!ev) {
      fill(root, h('section', { class: 'panel q-none' }, h('h1', { class: 'display' }, 'No quests right now'), h('p', { class: 'muted' }, 'Limited-time events bring quests with special rewards. Check back soon!'),
        h('p', { style: { marginTop: '14px' } }, h('a', { class: 'btn btn-pink', href: '/' }, '🕹️ Back to the arcade'))));
      return;
    }
    document.title = `${ev.name} quests · Party Arcade`;
    const quests = Unlocks.quests(U, ev.id);
    const prize = (U.themes || []).find((t) => t.event === ev.id && t.rule && t.rule.achs);
    stats = null;
    have = null;
    if (Account.user) {
      try {
        const { profile } = await Net.request('profile:get', { name: Account.user.name });
        stats = profile.stats || {};
        have = await Unlocks.of(profile.level, stats);
      } catch { stats = null; }
    }
    const done = have ? quests.filter((a) => have.achievements.has(a.id)).length : 0;
    const earned = !!(prize && have && have.theme.has(prize.id));

    const hero = h('section', { class: 'q-hero' },
      h('span', { class: 'q-e' }, ev.emoji),
      h('h1', {}, `${ev.name} quests`),
      ev.over
        ? h('p', {}, `The ${ev.name} event is over — thanks for playing! Here’s what you got.`)
        : h('p', {}, ev.active ? `${ev.about} Finish every quest to unlock the ${prize ? prize.name + ' theme' : 'grand prize'}.` : `Starts on ${new Date(Date.parse(ev.from + 'T00:00:00Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`),
      ev.over ? h('div', { class: 'q-over' }, stats ? `You finished ${done} of ${quests.length} quests${earned ? ' and unlocked the theme 🎉' : ''}.` : 'Log in to see what you earned.')
        : [h('div', { class: 'tiny', style: { marginTop: '14px', color: '#c9b3dd', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' } }, ev.active ? `Ends in · last day ${ev.last}` : 'Starts in'), countdown()],
      stats ? h('div', { class: 'q-total' }, h('div', { class: 'tt' }, h('span', {}, 'Quests done'), h('span', {}, `${done} / ${quests.length}`)),
        h('div', { class: 'q-bar' }, h('i', { style: { width: `${(done / quests.length) * 100}%` } }))) : null);
    if (ev.over) clearInterval(tick);

    const guest = !Account.user ? h('section', { class: 'panel q-guest' },
      h('span', { style: { fontSize: '2.2rem' } }, '👻'),
      h('div', { class: 'grow' }, h('b', {}, 'Make a free account to do quests'), h('div', { class: 'small muted' }, 'Your quest progress is saved on your account. It’s free and needs no email.')),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        h('button', { class: 'btn btn-pink btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Create an account'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in'))) : null;

    fill(root, hero,
      h('div', { class: 'q-layout' },
        h('div', {}, guest,
          h('div', { class: 'q-grid' }, quests.map((a) => questCard(a, prize))),
          h('p', { class: 'q-tip muted' }, '💡 Only games played while the event is on count. Online games count when they finish; solo scores count when you’re logged in.')),
        prize ? prizeCard(prize, quests) : null));

    if (earned && !ev.over && !store.get('pa_q_party_' + ev.id)) {
      store.set('pa_q_party_' + ev.id, 1);
      setTimeout(() => {
        if (FX.banner) FX.banner(`${prize.emoji} THEME UNLOCKED!`, `The ${prize.name} theme is yours forever`, { color: '#ff7a1a', hold: 1.8 });
        if (UI.confetti) UI.confetti(160);
        Sfx.play('win');
      }, 500);
    }
    if (FX.on && FX.list && !render.done) { render.done = true; FX.list([...root.querySelectorAll('.quest')], { y: 14, duration: 0.4, stagger: 0.04 }); }
  }

  const rerender = () => { clearTimeout(rerender.t); rerender.t = setTimeout(render, 40); };
  on('account', rerender);
  on('theme', rerender);
  Account.ready().then(render);
})();
