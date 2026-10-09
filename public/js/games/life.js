/* Family Life — siblings living their lives together. */
(() => {
  'use strict';
  const { $, $$, h, fill, Net, Sfx, UI, fmtMoney } = PA;

  let S = { phase: 'lobby', settings: { rules: {} }, chars: {}, groupInfo: [], family: null };
  let tab = 'sibs';
  let actTab = 'activities';
  let unreadLog = 0;
  let unreadChat = 0;
  let seenLog = -1;
  let seenFamLog = -1;
  let vote = null; // { id, box, close, open, deadline }
  const prevBars = {};

  const STATS = [['health', '❤️', 'Health', '#22c55e'], ['happy', '😊', 'Happy', '#facc15'], ['smarts', '🧠', 'Smarts', '#3b82f6'], ['looks', '✨', 'Looks', '#ec4899']];
  const ACT_TABS = [['activities', '🎯 Activities'], ['school', '🏫 School'], ['career', '💼 Career'], ['family', '🏠 Home'], ['love', '💞 Love'], ['money', '💰 Money'], ['risky', '😈 Risky'], ['jail', '🔒 Jail'], ['group', '🗳️ Together']];
  const SIB_LABELS = { hangout: '🤝 Hang out', teach: '🧑‍🏫 Help study', argue: '😤 Argue', prank: '😜 Prank', gift: '🎁 Gift money', borrow: '🙏 Borrow', payback: '💸 Pay back' };
  const LIVING = { home: '🏠 Lives at home', own: '🔑 Own place', together: '🏡 Lives with siblings' };

  const sib = (cid) => (S.siblings || []).find((x) => x.cid === cid);
  const myChar = () => S.chars[Net.id] || { first: '', gender: 'm', ready: false };

  // ================================================================ lobby
  function show(name) {
    $('#room').classList.toggle('hidden', name !== 'room');
    $('#play').classList.toggle('hidden', name !== 'play');
  }

  let lobbyBuilt = false;
  function buildLobby() {
    if (lobbyBuilt) return;
    lobbyBuilt = true;
    const input = h('input', { class: 'input', id: 'char-name', maxlength: 14, placeholder: 'Your character’s name', autocomplete: 'off',
      onchange: () => Net.send('g:char', { first: input.value }), onkeydown: (e) => { if (e.key === 'Enter') input.blur(); } });
    fill($('#room-main'),
      h('div', { id: 'lm-results' }),
      h('div', { class: 'lobby-grid' },
        h('div', {},
          h('div', { class: 'panel-title' }, '🧒 Your sibling'),
          h('div', { class: 'char-form' }, input, h('div', { class: 'seg', id: 'char-gender' })),
          h('button', { class: 'btn btn-block btn-lg', id: 'ready-btn', style: { marginTop: '10px' }, onclick: () => { Net.send('g:char', { first: input.value }); Net.send('g:ready', { ready: !myChar().ready }); Sfx.play('click'); } })),
        h('div', { id: 'lm-family' }),
        h('div', { id: 'lm-chars' }),
        h('div', { id: 'lm-settings' }),
        h('div', { id: 'lm-start' })));
  }

  function renderLobby() {
    buildLobby();
    const c = myChar();
    const input = $('#char-name');
    if (document.activeElement !== input) input.value = c.first || '';
    fill($('#char-gender'), [['m', '👦 Brother'], ['f', '👧 Sister']].map(([g, l]) => h('button', { class: c.gender === g ? 'on' : '', onclick: () => { Net.send('g:char', { gender: g, first: input.value }); Sfx.play('click'); } }, l)));
    const rb = $('#ready-btn');
    rb.className = 'btn btn-block btn-lg ' + (c.ready ? 'btn-ghost' : 'btn-lime');
    rb.textContent = c.ready ? '✅ Ready! (tap to change)' : '✋ I’m ready';

    // family preview
    const f = S.family;
    if (f) {
      fill($('#lm-family'), h('div', { class: 'fam-card' },
        h('div', { class: 'row between' }, h('h3', {}, `The ${f.last} Family`), Room.isHost ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { Net.send('g:reroll'); Sfx.play('pop'); } }, '🎲 New family') : null),
        h('div', { class: 'muted small' }, `📍 ${f.place}`),
        h('div', { class: 'parents' },
          h('div', { class: 'parent' }, h('b', {}, `👩 ${f.mom.first}`), `Mom · ${f.mom.job}`),
          h('div', { class: 'parent' }, h('b', {}, `👨 ${f.dad.first}`), `Dad · ${f.dad.job}`),
          h('div', { class: 'parent' }, h('b', {}, `💰 ${fmtMoney(f.money)}`), 'Family savings'))));
    }

    // characters
    fill($('#lm-chars'), h('div', { class: 'label-h' }, '👨‍👩‍👧‍👦 The siblings'),
      h('div', { class: 'char-list' }, Room.players.map((p) => {
        const ch = S.chars[p.id];
        return h('div', { class: 'char-row' }, UI.avatar(p, 'sm'),
          h('div', {}, h('div', { class: 'bold' }, ch ? `${ch.gender === 'f' ? '👧' : '👦'} ${ch.first}` : '…'), h('div', { class: 'tiny muted' }, `played by ${p.name}`)),
          h('span', { class: 'rd' }, ch && ch.ready ? '✅ Ready' : '⏳ Not ready'));
      })),
      Room.players.length < 2 ? h('p', { class: 'tiny faint', style: { marginTop: '6px' } }, 'Tip: 2–4 players is the most fun — send the code to your friends! (You can test it solo too.)') : null);

    // settings
    const host = Room.isHost;
    const st = S.settings;
    const send = (patch) => { Net.send('g:settings', patch); Sfx.play('click'); };
    const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: st[key] === v ? 'on' : '', disabled: !host, onclick: () => send({ [key]: v }) }, l)));
    fill($('#lm-settings'),
      h('div', { class: 'panel-title' }, '⚙️ Family settings', !host ? h('span', { class: 'count' }, 'host picks') : null),
      h('div', { class: 'set-grid' },
        h('div', {}, h('div', { class: 'label-h' }, 'Family type'), seg('familyType', [['siblings', '👫 Siblings'], ['twins', '👯 Twins']])),
        st.familyType === 'siblings' ? h('div', {}, h('div', { class: 'label-h' }, 'Age gaps'),
          h('div', { class: 'row wrap', style: { gap: '6px' } }, seg('gapMode', [['random', '🎲 Random 1–5'], ['fixed', '📏 Fixed']]),
            st.gapMode === 'fixed' ? h('div', { class: 'seg' }, [1, 2, 3, 4, 5].map((g) => h('button', { class: st.gap === g ? 'on' : '', disabled: !host, onclick: () => send({ gap: g }) }, `${g}y`))) : null)) : h('div'),
        h('div', {}, h('div', { class: 'label-h' }, 'Vote timeout'), seg('voteTimeout', [[15, '15s'], [30, '30s'], [60, '60s'], [90, '90s']])),
        h('div', {}, h('div', { class: 'label-h' }, 'If someone disconnects'), seg('offline', [['skip', '⏭️ Skip them'], ['abstain', '🤷 Abstain']]))),
      h('details', { style: { marginTop: '12px' } },
        h('summary', { class: 'bold', style: { cursor: 'pointer' } }, '🗳️ Vote rules for group actions'),
        h('div', { class: 'rules', style: { marginTop: '8px' } }, S.groupInfo.map((g) => h('div', { class: 'rule-row' },
          h('span', {}, `${g.emoji} ${g.title}`),
          h('div', { class: 'seg' }, [['unanimous', 'Everyone'], ['majority', 'Majority']].map(([v, l]) => h('button', {
            class: (st.rules || {})[g.id] === v ? 'on' : '', disabled: !host, onclick: () => send({ rules: { [g.id]: v } }),
          }, l))))),
        h('p', { class: 'tiny faint', style: { marginTop: '6px' } }, 'Aging up always needs everyone to vote yes.'))));

    const online = Room.players.filter((p) => p.online);
    const allReady = online.every((p) => (S.chars[p.id] || {}).ready);
    fill($('#lm-start'), host
      ? h('button', { class: 'btn btn-green btn-lg btn-block', disabled: !allReady, onclick: () => Net.send('g:start') }, allReady ? (S.phase === 'over' ? '🍼 Start a new family!' : '🍼 Start — the kids are born!') : '⏳ Waiting for everyone to be ready')
      : h('div', { class: 'center muted bold', style: { padding: '12px' } }, h('span', { class: 'waiting-dots' }, allReady ? '⏳ Waiting for the host to start' : '⏳ Waiting for everyone to be ready')));

    renderResults();
  }

  function renderResults() {
    const el = $('#lm-results');
    if (S.phase !== 'over' || !S.ranking) { fill(el); return; }
    fill(el,
      h('div', { class: 'panel-title' }, `🏁 The ${S.finalFamily ? S.finalFamily.last : ''} family story is over`),
      h('div', { class: 'awards' }, (S.awards || []).map((a, i) => h('div', { class: 'award', style: { animationDelay: i * 0.08 + 's' } }, h('div', { class: 'ae' }, a.emoji), h('div', { class: 'at' }, a.title), h('div', { class: 'an' }, a.name), h('div', { class: 'av' }, a.value)))),
      S.ranking.map((r, i) => h('details', { class: 'story' },
        h('summary', {}, h('span', { class: 'rk' }, ['🥇', '🥈', '🥉'][i] || `${i + 1}.`),
          h('div', {}, h('div', { class: 'bold' }, r.name, h('span', { class: 'muted small' }, ` · ${r.avatar} ${r.player}`)), h('div', { class: 'small muted' }, `Died at ${r.age} from ${r.cause || '?'}`), h('div', { class: 'tiny faint' }, r.summary)),
          h('span', { class: 'pts' }, r.score.total)),
        h('div', { class: 'story-body' },
          h('div', {},
            h('div', { class: 'label-h' }, 'Final stats'),
            h('div', { class: 'chips', style: { marginTop: 0 } }, STATS.map(([k, e]) => h('span', { class: 'chip' }, `${e} ${r.stats[k]}`)), h('span', { class: 'chip' }, `💰 ${fmtMoney(r.worth)}`), r.fame ? h('span', { class: 'chip' }, `⭐ ${r.fame}`) : null),
            h('div', { class: 'label-h', style: { marginTop: '10px' } }, 'Score'),
            h('div', { class: 'breakdown' }, r.score.parts.map((p) => h('div', {}, h('span', {}, p.label), h('b', {}, (p.pts > 0 ? '+' : '') + p.pts)))),
            r.achievements.length ? h('div', { class: 'chips' }, r.achievements.map((a) => h('span', { class: 'chip' }, a))) : null),
          h('div', {}, h('div', { class: 'label-h' }, '📖 Life story'), h('div', { class: 'story-log' }, r.story.map((e) => h('div', {}, h('b', {}, `${e.age}: `), e.text))))))),
      S.familyLog && S.familyLog.length ? h('details', { class: 'story' }, h('summary', { style: { display: 'block' } }, h('b', {}, '📜 Family Log')),
        h('div', { class: 'story-log', style: { marginTop: '10px' } }, S.familyLog.slice().reverse().map((e) => h('div', {}, h('b', {}, `${e.year}: `), e.text)))) : null,
      h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' } }),
      h('div', { class: 'panel-title' }, '🔁 Play again with a new family'));
  }

  // ================================================================ play
  let playBuilt = false;
  function buildPlay() {
    if (playBuilt) return;
    playBuilt = true;
    fill($('#main'),
      h('div', { id: 'm-head' }), h('div', { id: 'm-alerts' }), h('div', { id: 'm-event' }),
      h('div', { class: 'log', id: 'm-log' }), h('div', { id: 'm-acts' }), h('div', { id: 'm-age' }));
    seenLog = -1;
  }

  function bar(key, value, color, cls = '') {
    const from = prevBars[key] ?? value;
    prevBars[key] = value;
    const i = h('i', { style: { width: from + '%', background: value < 25 ? 'var(--red)' : color } });
    requestAnimationFrame(() => requestAnimationFrame(() => { i.style.width = value + '%'; }));
    return h('div', { class: 'bar ' + cls }, i);
  }

  function renderPlay() {
    buildPlay();
    const m = S.me;
    renderHead(m);
    renderAlerts(m);
    renderEvent(m);
    renderLog(m);
    renderActs(m);
    renderAge(m);
    renderSide();
    updateVote();
  }

  function renderHead(m) {
    const el = $('#m-head');
    if (!m) {
      const orphans = (S.orphans || []).map(sib).filter(Boolean);
      fill(el, h('div', { class: 'dead-card' }, h('div', { class: 'stone' }, '👀'), h('h3', {}, 'You’re watching this family'),
        orphans.length ? h('div', {}, h('p', { class: 'muted', style: { margin: '8px 0 12px' } }, 'A sibling is missing their player. Take over their life?'),
          h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, orphans.map((o) => h('button', { class: 'btn btn-pink', onclick: () => Net.send('g:claim', { cid: o.cid }) }, `${o.emoji} Play as ${o.first} (age ${o.age})`))))
          : h('p', { class: 'muted' }, 'The family is full. Follow along in the Family Log and chat!')));
      return;
    }
    const chips = [];
    if (m.job) chips.push(`${m.job.emoji} ${m.job.title} · ${fmtMoney(m.job.salary)}/yr`);
    if (m.uni) chips.push(`🎓 ${m.uni.major} (year ${m.uni.years + 1}/4)`);
    m.degrees.forEach((d) => chips.push(`📜 ${d}`));
    chips.push(LIVING[m.living] || m.living);
    if (m.partner) chips.push(`${m.partner.married ? '💍 Married to' : '💞 Dating'} ${m.partner.first}`);
    m.kids.forEach((k) => chips.push(`🧒 ${k}`));
    m.pets.forEach((p) => chips.push(`${p.emoji} ${p.name}`));
    m.assets.forEach((a) => chips.push(a.name));
    chips.push(`👩 Mom ${m.relMom}`, `👨 Dad ${m.relDad}`);
    fill(el,
      h('div', { class: 'me-head' },
        h('div', { class: 'me-emoji' }, m.emoji),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'me-name' }, m.name), h('div', { class: 'me-sub' }, `${m.status} · ${m.place}`)),
        h('div', { class: 'me-age' }, h('div', { class: 'y' }, `AGE · ${S.year}`), h('div', { class: 'n' }, m.age))),
      h('div', { class: 'stat-row' },
        ...STATS.map(([k, e, l, c]) => h('div', { class: 'stat' }, h('div', { class: 'lbl' }, h('span', {}, `${e} ${l}`), h('b', {}, m.stats[k])), bar(k, m.stats[k], c))),
        h('div', { class: 'money-box' }, h('div', { class: 'l' }, '💰 MONEY'), h('div', { class: 'v' + (m.money < 0 ? ' neg' : '') }, fmtMoney(m.money)))),
      h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip' }, c)), m.fame ? h('span', { class: 'chip' }, `⭐ Fame ${m.fame}`) : null,
        h('span', { class: 'chip' }, `🎸 ${m.skills.music}`), h('span', { class: 'chip' }, `🏅 ${m.skills.sport}`)),
      m.achievements.length ? h('div', { class: 'chips', style: { marginTop: '6px' } }, m.achievements.map((a) => h('span', { class: 'chip', style: { background: 'rgba(250,204,21,.12)' } }, a))) : null);
  }

  function renderAlerts(m) {
    const el = $('#m-alerts');
    const kids = [];
    const v = S.vote;
    if (v) {
      const yes = Object.values(v.votes).filter((x) => x === 'yes').length;
      kids.push(h('div', { class: 'vote-banner', onclick: () => openVote(true) }, h('span', { style: { fontSize: '1.4rem' } }, '🗳️'),
        h('div', { class: 'grow' }, v.title, h('div', { class: 'tiny muted' }, `${yes}/${v.voters.length} yes · ${v.rule === 'unanimous' ? 'everyone must agree' : 'majority wins'}`)),
        m && v.voters.includes(m.cid) && !v.votes[m.cid] ? h('span', { class: 'btn btn-yellow btn-sm' }, 'Vote!') : h('span', { class: 'small muted' }, 'view')));
    }
    if (m) {
      m.requests.forEach((r) => kids.push(h('div', { class: 'req' },
        h('span', { style: { fontSize: '1.5rem' } }, r.emoji), h('div', { class: 'grow bold' }, r.text),
        h('button', { class: 'btn btn-green btn-sm', onclick: () => { Net.send('g:respond', { rid: r.id, accept: true }); Sfx.play('click'); } }, '✅ Accept'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { Net.send('g:respond', { rid: r.id, accept: false }); Sfx.play('click'); } }, 'Decline'))));
      if (m.outgoing.length) kids.push(h('div', { class: 'chips', style: { marginTop: 0, marginBottom: '10px' } }, m.outgoing.map((o) => { const t = sib(o.to); return h('span', { class: 'chip' }, `⏳ Waiting for ${t ? t.first : '…'} (${SIB_LABELS[o.kind] || o.kind})`); })));
    }
    fill(el, kids);
  }

  function renderEvent(m) {
    const el = $('#m-event');
    if (!m || !m.alive || !m.event) { el.dataset.key = ''; fill(el); return; }
    const key = m.event.text + m.age;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    Sfx.play('pop');
    fill(el, h('div', { class: 'event-card' }, h('div', { class: 'q' }, m.event.text),
      h('div', { class: 'choices' }, m.event.choices.map((c, i) => h('button', { class: 'btn btn-ghost', onclick: (e) => {
        $$('.choices .btn', el).forEach((b) => { b.disabled = true; });
        e.currentTarget.classList.replace('btn-ghost', 'btn-pink');
        Net.send('g:choose', { i });
      } }, c)))));
  }

  function renderLog(m) {
    const log = $('#m-log');
    if (!m) { if (seenLog !== -2) { seenLog = -2; fill(log, h('p', { class: 'muted', style: { textAlign: 'center', padding: '20px' } }, '📜 Open the Family Log tab to follow along.')); } return; }
    const key = m.log.length + ':' + m.age + ':' + (m.log.length ? m.log[m.log.length - 1].text : '');
    if (log.dataset.key === key) return;
    const fresh = seenLog < 0 ? 0 : Math.max(0, m.log.length - seenLog);
    log.dataset.key = key;
    seenLog = m.log.length;
    let last = -1;
    const rows = [];
    m.log.forEach((e, i) => {
      if (e.age !== last) { rows.push(h('div', { class: 'age-h' }, e.age === 0 ? '🍼 Baby' : `🎂 Age ${e.age}`)); last = e.age; }
      rows.push(h('div', { class: 'lentry' + (i >= m.log.length - fresh ? ' new' : '') }, e.text));
    });
    if (last !== m.age && m.alive) rows.push(h('div', { class: 'age-h' }, `🎂 Age ${m.age}`));
    fill(log, rows);
    log.scrollTop = log.scrollHeight;
  }

  function renderActs(m) {
    const el = $('#m-acts');
    if (!m || !m.alive) { fill(el); return; }
    const cats = new Set(m.actions.map((a) => a.cat));
    const tabs = ACT_TABS.filter(([k]) => k === 'group' || cats.has(k));
    if (!tabs.some(([k]) => k === actTab)) actTab = tabs[0][0];
    const out = m.energy <= 0;
    let grid;
    if (actTab === 'group') {
      grid = m.groups.map((g) => h('button', { class: 'act group', disabled: !g.ok || !!S.vote, title: g.why || '', onclick: () => { Net.send('g:vote_start', { kind: 'group', action: g.id }); Sfx.play('click'); } },
        h('span', {}, h('span', { class: 'e' }, g.emoji), ' ', g.title),
        h('span', { class: 'why' }, g.ok ? `🗳️ ${g.rule === 'unanimous' ? 'Everyone must agree' : 'Majority vote'} · ${g.involved.join(', ')}` : `🔒 ${g.why}`)));
    } else {
      grid = m.actions.filter((a) => a.cat === actTab).map((a) => h('button', { class: 'act', disabled: (out && !a.client) || a.done, title: a.done ? 'Already done this year' : '', onclick: () => doAction(a) },
        h('span', { class: 'e' }, a.emoji), h('span', {}, a.label + (a.done ? ' ✓' : ''))));
    }
    fill(el,
      h('div', { class: 'act-tabs' }, tabs.map(([k, l]) => h('button', { class: k === actTab ? 'on' : '', onclick: () => { actTab = k; renderActs(S.me); Sfx.play('click'); } }, l))),
      out && actTab !== 'group' ? h('div', { class: 'chip', style: { marginBottom: '8px' } }, '😴 No energy left this year — start an age vote when you’re ready!') : null,
      h('div', { class: 'act-grid' }, grid.length ? grid : h('p', { class: 'muted small' }, 'Nothing here right now.')));
  }

  function renderAge(m) {
    const el = $('#m-age');
    if (!m) { fill(el); return; }
    if (!m.alive) {
      fill(el, h('div', { class: 'dead-card' }, h('div', { class: 'stone' }, '🪦'), h('h3', {}, `Rest in peace, ${m.first}`),
        h('p', { class: 'muted' }, `Died at ${m.age} from ${m.cause}. You’re a spectator now — you can watch and chat, but not vote.`),
        m.score ? h('p', { class: 'bold', style: { marginTop: '6px' } }, `Life score: ${m.score.total}`) : null));
      return;
    }
    const pips = Array.from({ length: m.maxEnergy }, (_, i) => h('i', { class: i < m.energy ? '' : 'used' }));
    fill(el, h('div', { class: 'age-row' },
      h('span', { class: 'energy', title: 'Actions left this year' }, '⚡', pips),
      h('button', { class: 'btn btn-green btn-lg age-btn', disabled: !!S.vote, onclick: () => { Net.send('g:vote_start', { kind: 'age' }); Sfx.play('click'); } },
        S.vote ? '🗳️ Vote in progress…' : `➕ AGE  →  ${S.year + 1}`)),
    h('p', { class: 'tiny faint', style: { textAlign: 'center', marginTop: '6px' } }, 'Aging starts a vote — every living sibling must say yes.'));
  }

  function doAction(a) {
    Sfx.play('click');
    if (a.client === 'jobs') return jobBoard();
    Net.send('g:act', { a: a.id });
  }

  function jobBoard() {
    const m = S.me;
    const jobs = [...m.jobs].sort((x, y) => (y.ok - x.ok) || (y.salary - x.salary));
    const close = UI.modal(h('div', {}, h('h2', {}, '🔍 Job board'),
      h('p', { class: 'muted', style: { marginBottom: '14px' } }, m.job ? `You work as a ${m.job.title}. Applying costs 1 energy.` : 'Applying costs 1 energy. Smarts and looks help!'),
      jobs.map((j) => h('div', { class: 'job' + (j.ok ? '' : ' no') }, h('span', { class: 'je' }, j.emoji),
        h('div', { class: 'grow' }, h('div', { class: 'bold' }, j.title, j.star ? ' ⭐' : ''), h('div', { class: 'small muted' }, j.ok ? `${fmtMoney(j.salary)}/yr${j.star ? ' + fame bonus' : ''}` : `🔒 ${j.why}`)),
        j.ok ? h('button', { class: 'btn btn-lime btn-sm', disabled: m.energy <= 0, onclick: () => { Net.send('g:act', { a: 'apply', job: j.key }); close(); } }, 'Apply') : null))), { wide: true });
  }

  // ---------------------------------------------------------------- side
  function renderSide() {
    renderFamily();
    renderFamLog();
  }

  function renderFamily() {
    const el = $('#tab-sibs');
    const f = S.family;
    const me = S.me;
    const kids = [];
    if (f) {
      const parent = (p, e) => h('div', { class: 'parent' }, h('b', {}, `${p.alive ? e : '🕊️'} ${p.first}`),
        p.alive ? `${p.role} · ${p.age} · ${p.care ? '🏥 care home' : p.job}` : `${p.role} · passed away`);
      if (Room.isHost) {
        kids.push(h('div', { style: { textAlign: 'right', marginBottom: '8px' } }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          const close = UI.modal(h('div', { style: { textAlign: 'center' } }, h('h2', {}, 'End the game?'), h('p', { class: 'muted' }, 'Every sibling’s life ends now and you’ll see the final results.'),
            h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } }, h('button', { class: 'btn btn-red', onclick: () => { Net.send('g:end'); close(); } }, '⏹ End game'), h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Keep playing'))));
        } }, '⏹ End game (host)')));
      }
      kids.push(h('div', { class: 'fam-card', style: { marginBottom: '12px' } },
        h('h3', {}, `The ${f.last} Family`), h('div', { class: 'muted small' }, `📍 ${f.place} · ${f.married ? '💑 parents together' : '💔 parents divorced'}`),
        h('div', { class: 'parents' }, parent(f.mom, '👩'), parent(f.dad, '👨')),
        h('div', { class: 'chips' }, h('span', { class: 'chip' }, `💰 Family savings ${fmtMoney(f.money)}`), f.pets.map((p) => h('span', { class: 'chip' }, `${p.emoji} ${p.name}`)),
          f.inheritance ? h('span', { class: 'chip', style: { background: 'rgba(250,204,21,.18)' } }, `📜 Inheritance ${fmtMoney(f.inheritance)} — vote to split it!`) : null)));
    }
    (S.siblings || []).forEach((x) => {
      const isMe = me && x.cid === me.cid;
      const card = h('div', { class: 'sib' + (isMe ? ' me' : '') + (x.alive ? '' : ' dead') },
        h('div', { class: 'sib-head' }, h('span', { class: 'sib-emoji' }, x.emoji),
          h('div', { class: 'grow', style: { minWidth: 0 } },
            h('div', { class: 'sib-name' }, x.first, isMe ? h('span', { class: 'muted small' }, ' (you)') : null, x.twin ? ' 👯' : ''),
            h('div', { class: 'sib-sub' }, `${x.alive ? `Age ${x.age}` : `Died at ${x.age}`} · ${x.status}`),
            h('div', { class: 'sib-sub' }, `${x.avatar} ${x.player}${x.online ? '' : ' · 📴 offline'}`)),
          h('div', { class: 'bold small', style: { textAlign: 'right' } }, fmtMoney(x.worth))),
        x.alive ? h('div', { class: 'mini' }, STATS.map(([k, e, , c]) => h('div', {}, `${e} ${x.stats[k]}`, bar(`${x.cid}-${k}`, x.stats[k], c, 'sm')))) : null);
      if (!isMe && me && x.rel != null) {
        const tag = x.silent ? '🙊 Not speaking' : x.best ? '👯 Besties' : '';
        card.append(h('div', { class: 'rel' }, h('span', {}, `💞 ${x.rel}`), bar(`${x.cid}-rel`, x.rel, x.silent ? '#64748b' : '#ec4899', 'sm'), tag ? h('span', {}, tag) : null));
        const debt = [];
        if (x.owes) debt.push(`You owe ${fmtMoney(x.owes)}`);
        if (x.owed) debt.push(`Owes you ${fmtMoney(x.owed)}`);
        if (debt.length) card.append(h('div', { class: 'tiny muted', style: { marginTop: '4px' } }, '💸 ' + debt.join(' · ')));
        if (me.alive && x.alive && x.acts) {
          card.append(h('div', { class: 'sib-acts' }, x.acts.length ? x.acts.map((a) => h('button', {
            disabled: me.energy <= 0, onclick: () => sibAction(a, x),
          }, SIB_LABELS[a] || a)) : h('span', { class: 'tiny faint' }, x.silent ? 'Try a 🎁 gift to break the silence…' : 'Nothing more to do together this year.')));
        }
      }
      kids.push(card);
    });
    fill(el, kids);
  }

  function sibAction(a, x) {
    Sfx.play('click');
    if (a !== 'borrow') { Net.send('g:sib', { a, target: x.cid }); return; }
    const amounts = [100, 500, 1000, 5000, 25000, 100000].filter((n) => n <= x.money);
    if (!amounts.length) { UI.toast(`${x.first} is broke too 😅`, 'bad'); return; }
    const close = UI.modal(h('div', { style: { textAlign: 'center' } }, h('div', { style: { fontSize: '2.6rem' } }, '🙏'), h('h2', {}, `Borrow from ${x.first}`),
      h('p', { class: 'muted' }, `${x.first} has ${fmtMoney(x.money)}. They’ll get a popup to say yes or no.`),
      h('div', { class: 'row wrap', style: { justifyContent: 'center', marginTop: '14px' } }, amounts.map((n) => h('button', { class: 'btn btn-cyan', onclick: () => { Net.send('g:sib', { a, target: x.cid, amount: n }); close(); } }, fmtMoney(n))))));
  }

  function renderFamLog() {
    const el = $('#tab-log');
    const items = S.familyLog || [];
    if (seenFamLog >= 0 && items.length > seenFamLog && tab !== 'log') { unreadLog += items.length - seenFamLog; updateDots(); }
    seenFamLog = items.length;
    fill(el, items.length ? items.slice().reverse().map((e) => h('div', { class: 'famlog-item' }, h('span', { class: 'yr' }, e.year), h('span', {}, e.text))) : h('p', { class: 'muted' }, 'Nothing yet…'));
  }

  function setTab(t) {
    tab = t;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    for (const n of ['sibs', 'log', 'chat']) $('#tab-' + n).classList.toggle('hidden', n !== t);
    if (t === 'log') unreadLog = 0;
    if (t === 'chat') unreadChat = 0;
    updateDots();
  }
  function updateDots() {
    const l = $('#log-dot'); l.textContent = unreadLog; l.classList.toggle('on', unreadLog > 0);
    const c = $('#chat-dot'); c.textContent = unreadChat; c.classList.toggle('on', unreadChat > 0);
  }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => { setTab(b.dataset.tab); Sfx.play('click'); }));

  // ---------------------------------------------------------------- votes
  function openVote(force) {
    const v = S.vote;
    if (!v) return;
    if (vote && vote.id === v.id && vote.open) return;
    if (vote && vote.id === v.id && !force) return;
    const box = h('div', { class: 'vote-box' });
    const close = UI.modal(box, { onClose: () => { if (vote) vote.open = false; } });
    vote = { id: v.id, box, close, open: true, deadline: vote && vote.id === v.id ? vote.deadline : performance.now() + v.remaining * 1000 };
    renderVoteBox();
  }

  function updateVote() {
    const v = S.vote;
    if (!v) {
      if (vote && vote.open) vote.close(true);
      vote = null;
      return;
    }
    const me = S.me;
    if (!vote || vote.id !== v.id) {
      if (vote && vote.open) vote.close(true);
      vote = { id: v.id, open: false, deadline: performance.now() + v.remaining * 1000 };
      const voter = me && v.voters.includes(me.cid);
      Sfx.play('boing');
      if (voter) openVote(true);
      else UI.toast(`🗳️ Vote started: ${v.title}`, '', 2500);
    }
    if (vote.open) renderVoteBox();
  }

  function renderVoteBox() {
    const v = S.vote;
    if (!v || !vote || !vote.box) return;
    const me = S.me;
    const mine = me && v.votes[me.cid];
    const canVote = me && me.alive && v.voters.includes(me.cid) && !mine;
    const starter = sib(v.starter);
    const icon = (x) => ({ yes: '✅', no: '❌', abstain: '🤷' }[x] || '⏳');
    fill(vote.box,
      h('h2', {}, v.title),
      h('div', { class: 'badge ' + (v.rule === 'unanimous' ? 'online' : 'fun') + ' vote-rule' }, v.rule === 'unanimous' ? 'Everyone must vote yes' : 'Majority wins'),
      h('p', {}, v.desc),
      starter ? h('p', { class: 'tiny muted' }, `Started by ${starter.first}`) : null,
      v.possible && v.possible.length ? h('div', { class: 'possible' }, h('b', {}, 'What could happen:'), v.possible.map((p) => h('div', {}, '• ' + p))) : null,
      h('div', { class: 'voters' }, v.voters.map((cid) => { const x = sib(cid) || {}; return h('div', { class: 'voter' }, h('span', {}, x.emoji || '🙂'), h('span', {}, x.first || '?'), h('span', { class: 'tiny muted' }, x.player ? `(${x.player})` : ''), h('span', { class: 'st' }, icon(v.votes[cid]))); })),
      h('div', { class: 'vtimer' }, h('i', { id: 'vtimer-fill' })),
      canVote ? h('div', { class: 'vote-btns' },
        h('button', { class: 'btn btn-green btn-lg', onclick: (e) => { e.currentTarget.disabled = true; Net.send('g:vote', { id: v.id, yes: true }); Sfx.play('right'); } }, '👍 Yes'),
        h('button', { class: 'btn btn-red btn-lg', onclick: (e) => { e.currentTarget.disabled = true; Net.send('g:vote', { id: v.id, yes: false }); Sfx.play('wrong'); } }, '👎 No'))
        : h('p', { class: 'center muted bold' }, mine ? `You voted ${icon(mine)} — waiting for the others…` : 'You’re not part of this vote.'));
    tickVote();
  }

  function tickVote() {
    const el = document.getElementById('vtimer-fill');
    if (!el || !vote || !S.vote) return;
    const left = Math.max(0, vote.deadline - performance.now()) / 1000;
    el.style.width = Math.min(100, left / (S.vote.timeout || 30) * 100) + '%';
  }
  setInterval(tickVote, 250);

  // ================================================================ wiring
  function route() {
    if (S.phase === 'playing') { show('play'); renderPlay(); }
    else { show('room'); renderLobby(); updateVote(); }
  }

  Lobby.init({
    game: 'life',
    title: 'Family Life',
    emoji: '🏡',
    tagline: 'You and your friends are siblings in the same family. Grow up together, vote on big decisions, and see whose life turns out best!',
    howTo: '<b>How it works</b><ul><li>2–4 players each play a brother or sister (twins too!).</li><li>Do your own thing — study, work, date — no vote needed.</li><li>Hang out, prank, argue with or borrow money from your siblings.</li><li><b>Nobody ages alone:</b> pressing <b>+ Age</b> starts a vote. Family trips, running away, starting a business… all voted on too!</li></ul>',
  });
  Lobby.renderCode($('#room-code'));
  Lobby.renderPlayers($('#room-players'), { extra: (p) => { const c = S.chars[p.id]; return c && S.phase !== 'playing' ? h('span', {}, c.ready ? '✅' : '⏳') : null; } });
  Lobby.ChatBox($('#room-chat'));
  Lobby.ChatBox($('#side-chat'), { title: null });
  Net.on('chat', (m) => { if (tab !== 'chat' && S.phase === 'playing' && !m.sys) { unreadChat++; updateDots(); } });

  Lobby.on('joined', (m) => { S = m.state; seenFamLog = -1; route(); });
  Lobby.on('players', () => { if (S.phase !== 'playing') renderLobby(); });
  Net.on('g:state', (m) => {
    const was = S.phase;
    S = m.state;
    if (was !== S.phase && S.phase === 'playing') { seenLog = -1; seenFamLog = -1; for (const k of Object.keys(prevBars)) delete prevBars[k]; setTab('sibs'); }
    route();
  });
  const deltaChips = (delta) => (delta || []).map((d) => h('span', { class: 'delta' + (d.d < 0 ? ' neg' : '') }, `${d.d > 0 ? '+' : ''}${d.k === 'money' ? fmtMoney(d.d) : d.d} ${d.icon}`));
  Net.on('g:toast', (m) => {
    const chips = deltaChips(m.delta);
    UI.toast(h('div', {}, h('div', {}, m.text), chips.length ? h('div', { class: 'result-pop' }, chips) : null), m.warn ? 'bad' : '', 3800);
    Sfx.play(m.warn ? 'wrong' : 'pop');
  });
  Net.on('g:notify', (m) => {
    const chips = deltaChips(m.delta);
    UI.toast(h('div', {}, h('div', {}, m.text), chips.length ? h('div', { class: 'result-pop' }, chips) : null), 'good', 4200);
    Sfx.play('message');
  });
  Net.on('g:request', (m) => { UI.toast(`📨 ${m.text}`, 'good', 3500); Sfx.play('coin'); });
  Net.on('g:announce', (m) => { UI.toast(m.text, '', 4200); });
  Net.on('g:year', () => { if (S.me && S.me.alive) Sfx.play('coin'); });
  Net.on('g:vote_result', (m) => {
    if (m.passed) { UI.toast(`✅ Vote passed: ${m.title}`, 'good', 2500); Sfx.play('win'); }
    else { UI.toast(`🗳️ ${m.title} — cancelled. ${m.reason || ''}`, 'bad', 3500); Sfx.play('lose'); }
  });
  Net.on('g:died', (m) => {
    Sfx.play('lose');
    UI.modal(h('div', { style: { textAlign: 'center' } }, h('div', { style: { fontSize: '4rem' } }, '🪦'), h('h2', {}, 'Your life is over'),
      h('p', { class: 'muted' }, `You died at age ${m.age} from ${m.cause}.`),
      h('div', { class: 'breakdown', style: { textAlign: 'left', margin: '12px auto', maxWidth: '320px' } }, m.score.parts.map((p) => h('div', {}, h('span', {}, p.label), h('b', {}, (p.pts > 0 ? '+' : '') + p.pts))),
        h('div', { style: { fontWeight: 700, color: 'var(--yellow)' } }, h('span', {}, 'Life score'), h('span', {}, m.score.total))),
      h('p', { class: 'small faint' }, 'You’re a spectator now: you can still watch your siblings and chat.')));
  });
  Net.on('g:over', () => {
    setTimeout(() => {
      if (S.ranking && S.ranking[0]) {
        const top = S.ranking[0];
        const mine = (S.ranking || []).find((r) => r.player === PA.Profile.get().name);
        if (mine && mine === top) { UI.confetti(220); Sfx.play('win'); }
      }
    }, 600);
  });
})();
