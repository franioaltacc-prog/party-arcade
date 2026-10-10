/* Settings: sound, motion, rewards (auras / animated avatars / Slope ball skins), account, data. */
(() => {
  'use strict';
  const { $, h, fill, UI, Net, Sfx, Account, Profile, Settings, Unlocks, store, on } = PA;
  const FX = PA.FX || {};
  UI.topbar({ title: 'Settings', emoji: '⚙️' });
  Net.connect();
  const root = $('#settings');

  let U = null;       // the rewards list
  let have = null;    // what this player has unlocked
  let hints = {};     // rule -> "Reach level 10"

  function range(value, onInput) {
    return h('input', { type: 'range', min: 0, max: 100, step: 5, value, oninput: (e) => onInput(+e.target.value) });
  }

  function soundPanel() {
    const st = Settings.get();
    const fxVal = h('span', { class: 'val' }, st.sfx + '%');
    const muVal = h('span', { class: 'val' }, st.music + '%');
    const muteBtn = h('button', { class: 'btn btn-sm ' + (Sfx.muted ? 'btn-pink' : 'btn-ghost'), onclick: () => Sfx.setMuted(!Sfx.muted) },
      Sfx.muted ? '🔇 Sound is off' : '🔊 Sound is on');
    return h('section', { class: 'panel', id: 'sound' },
      h('h2', {}, '🔊 Sound'),
      h('div', { class: 'st-row' }, h('b', {}, 'All sound'), h('span', { class: 'muted small' }, 'Same as the speaker button at the top.'), muteBtn),
      h('div', { class: 'st-row' }, h('b', {}, 'Sound effects'), range(st.sfx, (v) => { Settings.set({ sfx: v }); fxVal.textContent = v + '%'; }),
        h('div', { class: 'row', style: { gap: '6px' } }, fxVal, h('button', { class: 'icon-btn', title: 'Test', 'aria-label': 'Test sound effects', onclick: () => Sfx.play('coin') }, '▶'))),
      h('div', { class: 'st-row' }, h('b', {}, 'Game music'), range(st.music, (v) => { Settings.set({ music: v }); muVal.textContent = v + '%'; }), muVal),
      h('p', { class: 'st-note' }, '🎵 Music plays in Neon Dash and Slope. Each game also has its own music button.'));
  }

  function motionPanel() {
    const st = Settings.get();
    const device = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pick = (motion) => { Settings.set({ motion }); UI.toast(motion === 'less' ? '🧘 Less motion: on' : '✨ All animations: on', 'good'); render(); };
    return h('section', { class: 'panel', id: 'motion' },
      h('h2', {}, '🎬 Animations'),
      h('div', { class: 'seg' },
        h('button', { class: st.motion !== 'less' ? 'on' : '', onclick: () => pick('full') }, '✨ All animations'),
        h('button', { class: st.motion === 'less' ? 'on' : '', onclick: () => pick('less') }, '🧘 Less motion')),
      h('p', { class: 'st-note' }, 'Less motion stops page animations, moving auras and animated avatars. Handy if motion makes you dizzy or your device is slow.',
        device ? ' Your device already asks for reduced motion, so it’s on anyway.' : '', ' Some pages fully update after a reload.'));
  }

  // ---- rewards
  const me = () => ({ ...Profile.get() });
  function tile(slot, item, wearing, preview) {
    const ok = have && have[slot].has(item.id);
    const on = wearing === item.id;
    return h('button', {
      class: 'rw' + (on ? ' on' : '') + (ok ? '' : ' locked'), disabled: !ok, title: ok ? item.name : `${item.name}: ${hints[item.id + slot] || ''}`,
      onclick: () => wear(slot, on ? '' : item.id),
    }, on ? h('span', { class: 'tag' }, '✅') : !ok ? h('span', { class: 'tag' }, '🔒') : null,
    preview, h('b', {}, item.name), ok ? h('span', { class: 'hint' }, on ? 'Wearing' : 'Tap to wear') : h('span', { class: 'hint' }, hints[item.id + slot] || ''));
  }
  async function wear(slot, id) {
    if (!Account.user) { UI.toast('✨ Make a free account to unlock and wear rewards!'); UI.accountModal({ view: 'signup' }); return; }
    try {
      await Account.wear({ [slot]: id });
      Sfx.play(id ? 'coin' : 'click');
      render();
    } catch (e) { UI.toast(e.message, 'bad'); }
  }
  function rewardsPanel() {
    const look = (Account.user && Account.user.look) || {};
    const p = me();
    const none = (slot, label) => h('button', { class: 'rw' + (!look[slot] ? ' on' : ''), onclick: () => wear(slot, '') },
      !look[slot] ? h('span', { class: 'tag' }, '✅') : null,
      slot === 'ball' ? h('div', { class: 'ballp b-classic', style: { '--c': p.color } }) : UI.avatar({ ...p, aura: null, anim: null }, 'lg'), h('b', {}, label), h('span', { class: 'hint' }, 'The plain one'));
    const balls = U.balls.filter((b) => b.id !== 'classic');
    const count = (slot, list) => `${list.filter((x) => have && have[slot].has(x.id)).length}/${list.length} unlocked`;
    return h('section', { class: 'panel', id: 'rewards' },
      h('h2', {}, '✨ Rewards'),
      h('p', { class: 'muted small', style: { marginBottom: '10px' } }, 'Level up and earn achievements to unlock auras, animated avatars and Slope ball skins. Everyone sees your aura and animation in rooms, chat and on your profile.'),
      Account.user
        ? h('div', { class: 'rw-preview' }, UI.avatar(p, 'xl'), h('div', { class: 'ballp lg b-' + (look.ball || 'classic'), style: { '--c': p.color } }),
          h('div', {}, h('b', {}, p.name), h('div', { class: 'small muted' }, `Level ${Account.user.level}`), h('a', { class: 'small', href: '/profile' }, 'See your achievements →')))
        : h('div', { class: 'rw-preview' }, h('p', { style: { margin: 0 } }, '🔒 Rewards are for players with an account (it’s free, no email needed).'),
          h('button', { class: 'btn btn-pink btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Create an account')),
      h('h3', {}, '✨ Auras', h('small', {}, count('aura', U.auras))),
      h('div', { class: 'rw-grid' }, none('aura', 'No aura'), U.auras.map((a) => tile('aura', a, look.aura, UI.avatar({ ...p, anim: null, aura: a.id }, 'lg')))),
      h('h3', {}, '🎭 Animated avatars', h('small', {}, count('anim', U.anims))),
      h('div', { class: 'rw-grid' }, none('anim', 'Still'), U.anims.map((a) => tile('anim', a, look.anim, UI.avatar({ ...p, aura: null, anim: a.id }, 'lg')))),
      h('h3', {}, '🛝 Slope ball skins', h('small', {}, count('ball', balls))),
      h('div', { class: 'rw-grid' }, none('ball', 'Classic'), balls.map((b) => tile('ball', b, look.ball, h('div', { class: 'ballp b-' + b.id, style: { '--c': p.color } })))));
  }

  function accountPanel() {
    const u = Account.user;
    return h('section', { class: 'panel', id: 'account' },
      h('h2', {}, '👤 Account'),
      u ? h('p', { class: 'muted small' }, `Logged in as `, h('b', {}, u.name), ` · level ${u.level}`) : h('p', { class: 'muted small' }, 'You’re playing as a guest. Your nickname and look are saved in this browser only.'),
      h('div', { class: 'st-btns' },
        h('button', { class: 'btn btn-pink btn-sm', onclick: () => Profile.edit() }, '🎨 Name, avatar & colour'),
        u ? [
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => UI.accountModal({ view: 'password' }) }, '🔒 Change password'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await Account.logout(); UI.toast('Logged out. See you soon! 👋'); render(); } }, '🚪 Log out'),
          h('button', { class: 'btn btn-ghost btn-sm acct-del', onclick: () => UI.accountModal({ view: 'delete' }) }, '🗑️ Delete my account'),
        ] : [
          h('button', { class: 'btn btn-cyan btn-sm', onclick: () => UI.accountModal({ view: 'signup' }) }, '✨ Create an account'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in'),
        ]));
  }

  function dataPanel() {
    return h('section', { class: 'panel', id: 'data' },
      h('h2', {}, '🔒 Privacy & data'),
      h('p', { class: 'muted small' }, 'This browser remembers your settings, guest look, best solo scores and your login. ',
        h('a', { href: '/privacy' }, 'Read the Privacy Policy'), '.'),
      h('div', { class: 'st-btns' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          if (!confirm('Forget everything this browser saved for Party Arcade (settings, guest look, local best scores) and log out here? Your account itself stays.')) return;
          try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage blocked */ }
          location.reload();
        } }, '🧹 Clear this browser’s saved data')),
      h('p', { class: 'st-note' }, `ℹ️ Party Arcade v${PA.VERSION} · `, h('a', { href: '/changelog' }, 'What’s new')));
  }

  async function render() {
    U = await Unlocks.load();
    have = null;
    if (Account.user) {
      try {
        const { profile } = await Net.request('profile:get', { name: Account.user.name });
        have = await Unlocks.of(profile.level, profile.stats || {});
      } catch { have = null; }
    }
    hints = {};
    for (const [slot, list] of [['aura', U.auras], ['anim', U.anims], ['ball', U.balls]]) {
      for (const item of list) hints[item.id + slot] = await Unlocks.hint(item.rule);
    }
    const y = scrollY;
    fill(root,
      h('section', { class: 'page-head' }, h('h1', { class: 'display' }, 'Settings ', h('span', { class: 'gradient-text' }, '⚙️')),
        h('p', { class: 'muted' }, 'Sound, animations, your rewards and your account.')),
      soundPanel(), motionPanel(), rewardsPanel(), accountPanel(), dataPanel());
    scrollTo(0, y);
    if (location.hash && !render.jumped) { render.jumped = true; const el = $(location.hash); if (el) el.scrollIntoView(); }
  }

  on('account', () => render());
  on('muted', () => render());
  Account.ready().then(render);
  if (FX.on && FX.list) setTimeout(() => FX.list([...root.children].slice(0, 3), { y: 10, duration: 0.4, stagger: 0.06 }), 50);
})();
