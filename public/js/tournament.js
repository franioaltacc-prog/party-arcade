/* Tournament bracket page: /tournament?id=XXXXX — live bracket, your next match, watch buttons. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Sfx } = PA;
  const FX = PA.FX || {};
  const root = $('#tournament');
  const id = (new URLSearchParams(location.search).get('id') || '').toUpperCase();
  const EMOJI = { connect4: '🔴', billiards: '🎱', dash: '🟪', mines: '💣', blitz: '⚡', prophunt: '🔫', golf: '⛳', poly: '🏎️' };
  let T = null;
  let startsAt = 0;
  let cheered = false;

  UI.topbar({ title: 'Tournament', emoji: '🏆' });

  const player = (uid) => (T && T.players[uid]) || null;
  const watchUrl = (m, watch) => `/games/${T.game}?room=${m.room}${watch ? '&watch=1' : ''}`;

  function myStatus() {
    const me = Net.id;
    if (!T.players[me]) {
      return h('div', { class: 'tr-me' }, T.champion ? '🏁 The tournament is over.' : '👀 You’re watching. Press “Watch” on any live match!');
    }
    if (T.champion === me) return h('div', { class: 'tr-me win' }, h('div', { class: 'big' }, '🏆 You’re the champion!'), 'You won every match. Legend.');
    const lost = T.rounds.some((r) => r.matches.some((m) => m.winner && m.winner !== me && (m.a === me || m.b === me)));
    if (lost) return h('div', { class: 'tr-me out' }, '😅 You’re out — good game! Watch the rest of the matches 👀');
    const cur = T.rounds[T.cur];
    const mine = cur && cur.matches.find((m) => m.a === me || m.b === me);
    if (mine && mine.state === 'playing') {
      const other = player(mine.a === me ? mine.b : mine.a);
      return h('div', { class: 'tr-me go' }, h('div', { class: 'big' }, `⚔️ ${cur.name}: you vs ${other ? other.name : '?'}`), 'Your match is on! Taking you there…',
        h('div', {}, h('a', { class: 'btn btn-lime', href: watchUrl(mine) }, '🎮 Go to my match')));
    }
    if (T.startsIn != null && T.cur < 0) return h('div', { class: 'tr-me' }, h('div', { class: 'big' }, 'Get ready!'), 'The first matches start in ', h('b', { class: 'tr-count' }, '…'), ' seconds.');
    if (T.startsIn != null) return h('div', { class: 'tr-me go' }, h('div', { class: 'big' }, '✅ You’re through!'), 'The next round starts in ', h('b', { class: 'tr-count' }, '…'), ' seconds.');
    return h('div', { class: 'tr-me' }, '⏳ Waiting for the other matches to finish…');
  }

  function playerRow(m, uid) {
    if (!uid) return h('div', { class: 'tr-p tbd' }, 'to be decided');
    const p = player(uid);
    const won = m.winner === uid;
    return h('div', { class: 'tr-p' + (won ? ' won' : m.winner ? ' lost' : '') }, UI.avatar(p, 'sm'), h('span', { class: 'nm' }, p.name, uid === Net.id ? ' (you)' : ''), won ? '✅' : null);
  }

  function matchCard(m, ri) {
    const live = m.state === 'playing';
    const mine = m.a === Net.id || m.b === Net.id;
    const bye = m.note === 'bye' || (ri === 0 && (!m.a || !m.b));
    const foot = bye
      ? h('div', { class: 'tr-foot' }, '⏭️ free pass to the next round')
      : m.state === 'done'
        ? h('div', { class: 'tr-foot' }, m.note ? `🏁 ${m.note}` : '🏁 done')
        : live
          ? h('div', { class: 'tr-foot' }, m.live ? '🔴 LIVE' : '⏳ starting…', h('a', { href: watchUrl(m, !mine) }, mine ? '🎮 Play' : '👀 Watch'))
          : h('div', { class: 'tr-foot' }, '⏳ waiting');
    const rows = bye ? [playerRow(m, m.a || m.b), h('div', { class: 'tr-p tbd' }, '— bye —')] : [playerRow(m, m.a), playerRow(m, m.b)];
    return h('div', { class: 'tr-m' + (live ? ' live' : '') + (mine ? ' mine' : '') }, ...rows, foot);
  }

  function render() {
    if (!T) {
      fill(root, h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, '🤷'), h('h1', {}, 'Tournament not found'),
        h('p', { class: 'tagline' }, 'It may have finished a while ago, or the link is wrong.'), h('div', { class: 'actions' }, h('a', { class: 'btn btn-pink', href: '/' }, '🏠 Back to the arcade'))));
      return;
    }
    document.title = `${T.title} tournament · Party Arcade`;
    const n = Object.keys(T.players).length;
    startsAt = T.startsIn != null ? performance.now() + T.startsIn * 1000 : 0;
    const champ = T.champion && player(T.champion);
    fill(root,
      h('section', { class: 'tr-head' },
        h('div', { class: 'game-icon' }, EMOJI[T.game] || '🏆'),
        h('h1', { class: 'display' }, `${T.title} tournament`),
        h('p', { class: 'muted' }, `${n} players · started by ${T.host} · ${T.rounds.length} rounds`, ' · ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); UI.copy(location.href, 'Bracket link copied! 🔗'); } }, '🔗 copy link'))),
      myStatus(),
      champ ? h('div', { class: 'tr-champ' }, h('div', { class: 'crown' }, '🏆'), UI.avatar(champ, 'xl'), h('h2', {}, champ.name), h('p', { class: 'muted' }, `is the ${T.title} champion!`)) : null,
      h('div', { class: 'bracket' }, T.rounds.map((r, i) => h('div', { class: 'tr-col' + (i === T.cur && !T.champion ? ' now' : '') },
        h('h3', {}, r.name), h('div', { class: 'tr-matches' }, r.matches.map((m) => matchCard(m, i)))))));
    tickCount();
    if (champ && !cheered) {
      cheered = true;
      UI.confetti(240);
      Sfx.play('win');
      if (FX.banner) FX.banner('🏆 CHAMPION', champ.name, { color: '#facc15', hold: 1.8 });
    }
  }

  function tickCount() {
    const el = $('.tr-count');
    if (el && startsAt) el.textContent = Math.max(0, Math.ceil((startsAt - performance.now()) / 1000));
  }
  setInterval(tickCount, 300);

  Net.on('tour:state', (m) => { T = m.tour; render(); });
  Net.on('welcome', () => Net.send('tour:view', { id }));
  Net.connect();
})();
