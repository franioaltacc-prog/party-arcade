/* Update calendar (/calendar): what's coming to Party Arcade and when.
   Testers see the updates developers share with them ("Testers" ticked) and can't change anything.
   Developers and admins see everything and add, change, move (drag) and delete updates.
   The server checks the role on every request (planner.py); open calendars reload when anything changes. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, on, icon, store } = PA;
  const FX = PA.FX || {};
  const root = $('#cal');

  UI.topbar({ title: 'Update calendar', emoji: '📅' });
  Net.connect();

  const KINDS = [['big', 'Big update'], ['small', 'Small update'], ['fix', 'Fix'], ['event', 'Event']];
  const STATUSES = [['idea', 'Idea'], ['planned', 'Planned'], ['building', 'Building'], ['shipped', 'Shipped'], ['skipped', 'Skipped']];
  const KIND = Object.fromEntries(KINDS), STATUS = Object.fromEntries(STATUSES);
  const KIND_ORDER = Object.fromEntries(KINDS.map(([k], i) => [k, i]));
  const ROLE_LABEL = { tester: '🧪 Tester', developer: '🛠️ Developer', admin: '🛡️ Admin' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const LABELS = { day: 'Date', title: 'Update', kind: 'Type', status: 'Status', version: 'Version', notes: 'Notes', testers: 'Testers can see it' };

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => keyOf(new Date());
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const fmtDay = (k) => { const d = parse(k); return `${DAYS[(d.getDay() + 6) % 7].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  const fmtDayLong = (k) => { const d = parse(k); return `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const narrow = matchMedia('(max-width: 700px)');

  const now = new Date();
  const S = {
    items: new Map(), canEdit: false, role: '', builtFor: null,
    month: { y: now.getFullYear(), m: now.getMonth() }, selected: todayKey(), view: store.get('pa_cal_view', 'cal'), showShipped: true,
  };

  // ------------------------------------------------------------ who can see this page
  function screen(emoji, title, text, ...actions) {
    S.builtFor = null;
    fill(root, h('section', { class: 'entry' }, h('div', { class: 'game-icon' }, emoji), h('h1', {}, title), h('p', { class: 'tagline' }, text),
      actions.length ? h('div', { class: 'actions' }, actions) : null));
    if (FX.entry) FX.entry(root.querySelector('.entry'));
  }
  function gate() {
    if (!Account.known) { if (!root.firstChild) fill(root, h('p', { class: 'muted', style: { textAlign: 'center', padding: '60px 0' } }, 'Loading…')); return; }
    if (!Account.user) {
      return screen('🔐', 'Log in first', 'The update calendar is for testers and developers. Log in with your account to see it.',
        h('button', { class: 'btn btn-cyan btn-lg btn-block', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in'));
    }
    if (!Account.can('tester')) {
      return screen('📅', 'Testers and developers only', 'This calendar shows what’s coming to Party Arcade before it’s out. An admin can give you access.',
        h('a', { class: 'btn btn-ghost btn-block', href: '/' }, '🕹️ Back to the arcade'));
    }
    if (S.builtFor !== Account.role) build();
    load();
  }

  async function load() {
    let r;
    try { r = await Net.request('plan:list'); } catch (e) {
      if (/only testers/i.test(e.message)) { Account.save({ ...Account.user, role: '', admin: false }); return gate(); }
      UI.toast(e.message, 'bad', 4500);
      return;
    }
    S.items = new Map(r.items.map((it) => [it.id, it]));
    if (r.canEdit !== S.canEdit || r.role !== S.role) { S.canEdit = r.canEdit; S.role = r.role; build(); }
    renderAll();
  }
  let reloadTimer = null;
  Net.on('plan:changed', () => { if (S.builtFor) { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 150); } });
  on('auth', gate);
  on('account', () => { if (Account.known && S.builtFor !== null && S.builtFor !== Account.role) gate(); });

  // ------------------------------------------------------------ data helpers
  function sorted() {
    return [...S.items.values()].sort((a, b) => {
      if (!a.day !== !b.day) return a.day ? -1 : 1;
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.id - b.id);
    });
  }
  function byDay() {
    const m = new Map();
    for (const it of sorted()) if (it.day) { if (!m.has(it.day)) m.set(it.day, []); m.get(it.day).push(it); }
    return m;
  }
  const fields = (it) => ({ id: it.id, title: it.title, day: it.day, kind: it.kind, status: it.status, version: it.version, notes: it.notes, testers: !!it.testers });

  async function save(item, msg) {
    try {
      const r = await Net.request('plan:save', { item: fields(item) });
      if (item.id == null) item.id = r.id;
      S.items.set(r.id, { ...S.items.get(r.id), ...item, id: r.id });
      renderAll();
      if (msg) UI.toast(msg, 'good');
      return true;
    } catch (e) { UI.toast(e.message, 'bad', 4500); load(); return false; }
  }
  async function remove(id) {
    try { await Net.request('plan:delete', { id }); S.items.delete(id); renderAll(); UI.toast('Deleted 🗑️'); } catch (e) { UI.toast(e.message, 'bad', 4500); }
  }

  // ------------------------------------------------------------ page
  function build() {
    S.builtFor = Account.role;
    S.canEdit = Account.can('developer');
    S.role = Account.role;
    const edit = S.canEdit;
    const tab = (key, label) => h('button', { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-selected': String(S.view === key), onclick: () => setView(key) }, label);
    fill(root,
      h('header', { class: 'cal-head' },
        h('div', { class: 'cal-brand' },
          h('h1', { class: 'display' }, 'Update ', h('span', { class: 'gradient-text' }, 'calendar')),
          h('p', { class: 'muted' }, edit ? 'Plan what’s coming to Party Arcade. Tick “Testers” on an update to let testers see it early.'
            : 'A sneak peek at what’s coming to Party Arcade. Keep it to yourself! 🤫'),
          h('span', { class: 'cal-role', title: 'Only you can see your role' }, ROLE_LABEL[S.role] || '', edit ? ' · can edit' : ' · view only')),
        h('section', { class: 'nx', id: 'nx', 'aria-label': 'Next update' })),
      h('div', { class: 'cal-bar' },
        h('div', { class: 'cal-tabs', role: 'tablist', 'aria-label': 'View' }, tab('cal', 'Calendar'), tab('sheet', 'Sheet')),
        h('div', { class: 'cal-month', id: 'month-nav' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onclick: () => moveMonth(-1) }, '‹'),
          h('h2', { id: 'month', 'aria-live': 'polite' }),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', onclick: () => moveMonth(1) }, '›'),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: goToday }, 'Today')),
        h('span', { class: 'grow' }),
        edit ? h('button', { class: 'btn btn-pink btn-sm', type: 'button', onclick: () => openAdd(narrow.matches && S.view === 'cal' ? S.selected : '') }, '+ Add update') : null),
      h('section', { id: 'view-cal', class: 'cal-layout', role: 'tabpanel', 'aria-labelledby': 'tab-cal' },
        h('div', { class: 'panel cal-box' },
          h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, DAYS.map((d) => h('span', {}, d.slice(0, 3)))),
          h('div', { class: 'cal-grid', id: 'grid' }),
          h('div', { class: 'cal-legend', id: 'legend' }),
          h('div', { class: 'day-panel', id: 'day-panel' })),
        h('aside', { class: 'panel ideas', id: 'ideas-box', 'aria-labelledby': 'ideas-head' },
          h('h3', { id: 'ideas-head' }, 'Ideas ', h('small', {}, 'no date yet')),
          h('div', { class: 'idea-list', id: 'ideas' }),
          edit ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openAdd('') }, '+ Add an idea') : null)),
      h('section', { id: 'view-sheet', role: 'tabpanel', 'aria-labelledby': 'tab-sheet' },
        h('div', { class: 'sheet-tools' },
          h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: S.showShipped, onchange: (e) => { S.showShipped = e.target.checked; renderSheet(); } }), 'Show shipped'),
          h('span', {}, edit ? 'Click any cell to change it. Rows are sorted by date, ideas last.' : 'Sorted by date, ideas last.')),
        h('div', { class: 'panel sheet-scroll' },
          h('table', { class: 'sheet' },
            h('thead', {}, h('tr', {}, ['Date', 'Update', 'Type', 'Status', 'Version', 'Notes', ...(edit ? ['Testers', 'Added by', ''] : [])].map((t) => h('th', {}, t)))),
            h('tbody', { id: 'rows' })),
          h('p', { class: 'muted sheet-empty', id: 'sheet-empty', hidden: true }, edit ? 'Nothing planned yet. Use “+ Add update” to plan the first one.' : 'Nothing to preview yet. Check back soon!'))));
    root.classList.toggle('can-edit', edit);
    rowEls.clear();
    wire();
    setView(S.view);
    renderAll();
  }

  function setView(v) {
    S.view = v === 'sheet' ? 'sheet' : 'cal';
    store.set('pa_cal_view', S.view);
    $('#tab-cal').setAttribute('aria-selected', String(S.view === 'cal'));
    $('#tab-sheet').setAttribute('aria-selected', String(S.view === 'sheet'));
    $('#view-cal').hidden = S.view !== 'cal';
    $('#view-sheet').hidden = S.view !== 'sheet';
    $('#month-nav').hidden = S.view !== 'cal';
  }
  function moveMonth(d) { const { y, m } = S.month; const t = new Date(y, m + d, 1); S.month = { y: t.getFullYear(), m: t.getMonth() }; renderGrid(); }
  function goToday() { const d = new Date(); S.month = { y: d.getFullYear(), m: d.getMonth() }; S.selected = keyOf(d); renderGrid(); renderDayPanel(); }

  // ------------------------------------------------------------ render
  function renderAll() {
    if (!S.builtFor) return;
    renderNext(); renderGrid(); renderLegend(); renderIdeas(); renderDayPanel(); renderSheet();
  }

  function renderNext() {
    const t = todayKey();
    const all = sorted();
    const up = all.filter((it) => it.day && it.day >= t && (it.status === 'planned' || it.status === 'building'));
    const last = all.filter((it) => it.status === 'shipped' && it.day && it.day <= t).pop();
    const kids = [h('span', { class: 'nx-label' }, 'Next up')];
    if (up.length) {
      const it = up[0];
      const n = daysBetween(t, it.day);
      kids.push(
        h('div', { class: 'nx-count' }, h('b', {}, n === 0 ? 'Today' : n === 1 ? '1 day' : `${n} days`), n > 0 ? h('span', {}, 'to go') : null),
        h('button', { type: 'button', class: `nx-title k-${it.kind} s-${it.status}`, onclick: () => open(it.id) }, h('span', { class: 'cdot' }), it.title),
        h('span', { class: 'nx-when' }, `${fmtDayLong(it.day)} · ${KIND[it.kind]} · ${STATUS[it.status]}`));
    } else {
      kids.push(h('p', { class: 'muted' }, S.canEdit ? 'Nothing planned yet. Pick a day and add the next update.' : 'Nothing to preview right now. Check back soon!'));
    }
    if (last) kids.push(h('span', { class: 'nx-last' }, `Last shipped: ${last.version ? 'v' + last.version + ' · ' : ''}${last.title} · ${fmtDay(last.day)}`));
    fill($('#nx'), kids);
  }

  const tip = (it) => `${it.version ? 'v' + it.version + ' · ' : ''}${it.title}\n${KIND[it.kind]} · ${STATUS[it.status]}${S.canEdit ? (it.testers ? ' · testers can see it' : ' · hidden from testers') : ''}${it.notes ? '\n\n' + it.notes : ''}`;
  const chip = (it) => h('button', { type: 'button', class: `chip k-${it.kind} s-${it.status}`, draggable: S.canEdit ? 'true' : null, 'data-id': it.id, title: tip(it) },
    h('span', { class: 'cdot' }), h('span', { class: 'ctext' }, it.title),
    S.canEdit && it.testers ? h('span', { class: 'hidden-eye', 'aria-label': 'Testers can see it' }, '🧪') : null);

  function renderGrid() {
    const { y, m } = S.month;
    $('#month').textContent = `${MONTHS[m]} ${y}`;
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const weeks = Math.ceil((offset + new Date(y, m + 1, 0).getDate()) / 7);
    const groups = byDay();
    const t = todayKey();
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(y, m, 1 - offset + i);
      const k = keyOf(d);
      const items = groups.get(k) || [];
      const cls = ['day', d.getMonth() !== m && 'out', k === t && 'today', k === S.selected && 'sel', i % 7 >= 5 && 'wkend'].filter(Boolean).join(' ');
      const label = `${fmtDayLong(k)}${items.length ? `, ${items.length} update${items.length === 1 ? '' : 's'}` : ''}`;
      cells.push(h('div', { class: cls, 'data-day': k },
        h('div', { class: 'day-top' },
          h('button', { type: 'button', class: 'dnum', 'aria-label': S.canEdit && !narrow.matches ? `Add an update on ${label}` : label }, String(d.getDate())),
          k === t ? h('span', { class: 'today-tag' }, 'Today') : null),
        h('div', { class: 'chips' }, items.map(chip)),
        items.length ? h('div', { class: 'dots', 'aria-hidden': 'true' }, items.slice(0, 4).map((it) => h('i', { class: `k-${it.kind}` }))) : null));
    }
    fill($('#grid'), cells);
  }

  function renderLegend() {
    fill($('#legend'),
      KINDS.map(([k, label]) => h('span', { class: `k-${k}` }, h('i', { class: 'cdot' }), label)),
      h('span', { class: 'tip' }, 'Dashed = idea · pulsing = building · ✓ = shipped'),
      S.canEdit ? h('span', { class: 'tip' }, '🧪 = testers can see it · click a day to add · drag to move') : null);
  }

  const ideaCard = (it) => h('button', { type: 'button', class: `idea k-${it.kind} s-${it.status}`, draggable: S.canEdit ? 'true' : null, 'data-id': it.id, title: tip(it) },
    h('span', { class: 'idea-top' }, h('span', { class: 'cdot' }), h('b', {}, (it.version ? 'v' + it.version + ' ' : '') + it.title)),
    it.notes ? h('span', { class: 'idea-notes' }, it.notes) : null,
    h('span', { class: 'idea-meta' }, `${KIND[it.kind]} · ${STATUS[it.status]}`, S.canEdit ? (it.testers ? ' · 🧪 testers' : ' · hidden from testers') : ''));

  function renderIdeas() {
    const list = sorted().filter((it) => !it.day);
    fill($('#ideas'), list.length ? list.map(ideaCard)
      : h('p', { class: 'muted small' }, S.canEdit ? 'Updates without a date wait here. Drag one onto a day to schedule it.' : 'No ideas to show yet.'));
  }

  function renderDayPanel() {
    const k = S.selected;
    const items = byDay().get(k) || [];
    fill($('#day-panel'),
      h('div', { class: 'dp-head' }, h('h3', {}, fmtDayLong(k)), S.canEdit ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => openAdd(k) }, '+ Add') : null),
      items.length ? h('div', { class: 'idea-list' }, items.map(ideaCard)) : h('p', { class: 'muted small' }, 'Nothing planned for this day.'));
  }

  // the sheet keeps one row per update, so typing in a cell isn't interrupted when the calendar reloads
  const rowEls = new Map();
  function buildRow(id) {
    const edit = S.canEdit;
    const input = (f, attrs) => h('input', { ...attrs, 'data-f': f, 'aria-label': LABELS[f] });
    const select = (f, opts) => h('select', { 'data-f': f, 'aria-label': LABELS[f] }, opts.map(([v, l]) => h('option', { value: v }, l)));
    return h('tr', { 'data-id': id },
      h('td', { class: 'c-date' }, input('day', { type: 'date' })),
      h('td', { class: 'c-title' }, input('title', { type: 'text', maxlength: 120 })),
      h('td', { class: 'c-kind' }, h('div', { class: 'cell-kind' }, h('span', { class: 'cdot' }), select('kind', KINDS))),
      h('td', { class: 'c-status' }, select('status', STATUSES)),
      h('td', { class: 'c-ver' }, input('version', { type: 'text', maxlength: 20, placeholder: '—' })),
      h('td', { class: 'c-notes' }, input('notes', { type: 'text', maxlength: 2000, placeholder: edit ? 'Add notes' : '' })),
      edit ? h('td', { class: 'c-test' }, input('testers', { type: 'checkbox' })) : null,
      edit ? h('td', { class: 'c-by' }) : null,
      edit ? h('td', { class: 'c-del' }, h('button', { type: 'button', class: 'del' }, 'Delete')) : null);
  }
  function fillRow(tr, it) {
    tr.className = `k-${it.kind} s-${it.status}`;
    for (const c of tr.querySelectorAll('[data-f]')) {
      const f = c.dataset.f;
      if (c.type === 'checkbox') { c.checked = !!it[f]; c.title = it[f] ? 'Testers can see it' : 'Hidden from testers'; }
      else if (document.activeElement !== c && c.value !== (it[f] || '')) c.value = it[f] || '';
      c.disabled = !S.canEdit;
    }
    const by = tr.querySelector('.c-by');
    if (by) by.textContent = it.by || '—';
    const del = tr.querySelector('.del');
    if (del) del.setAttribute('aria-label', `Delete “${it.title}”`);
  }
  function renderSheet() {
    const tbody = $('#rows');
    const list = sorted().filter((it) => S.showShipped || it.status !== 'shipped');
    const keep = new Set(list.map((it) => it.id));
    for (const [id, tr] of rowEls) if (!keep.has(id)) { tr.remove(); rowEls.delete(id); }
    const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#rows tr') : null;
    list.forEach((it, i) => {
      let tr = rowEls.get(it.id);
      if (!tr) { tr = buildRow(it.id); rowEls.set(it.id, tr); }
      fillRow(tr, it);
      if (tbody.children[i] !== tr && tr !== focused) tbody.insertBefore(tr, tbody.children[i] || null);
    });
    $('#sheet-empty').hidden = list.length > 0;
  }

  // ------------------------------------------------------------ add, view and change one update
  function open(id) { const it = S.items.get(id); if (it) (S.canEdit ? showForm(it) : showView(it)); }
  function openAdd(day) { if (S.canEdit) showForm({ id: null, title: '', day: day || '', kind: 'small', status: day ? 'planned' : 'idea', version: '', notes: '', testers: false }); }

  function showView(it) {
    UI.modal(h('div', { class: 'plan-view' },
      h('h2', {}, (it.version ? 'v' + it.version + ' · ' : '') + it.title),
      h('div', { class: 'pv-tags' },
        h('span', { class: `k-${it.kind}` }, h('i', { class: 'cdot' }), KIND[it.kind]),
        h('span', { class: `k-${it.kind} s-${it.status}` }, h('i', { class: 'cdot' }), STATUS[it.status]),
        h('span', {}, it.day ? fmtDayLong(it.day) : 'No date yet')),
      it.notes ? h('p', {}, it.notes) : h('p', { class: 'muted' }, 'No details yet.'),
      h('p', { class: 'tiny muted' }, '🤫 This is a preview for testers. Plans can still change.')));
  }

  function showForm(it) {
    const isNew = it.id == null;
    const title = h('input', { class: 'input', type: 'text', maxlength: 120, value: it.title, placeholder: 'e.g. Song guessing game', autocomplete: 'off' });
    const day = h('input', { class: 'input', type: 'date', value: it.day, disabled: !it.day });
    const noDay = h('input', { type: 'checkbox', checked: !it.day });
    const kind = h('select', { class: 'select' }, KINDS.map(([v, l]) => h('option', { value: v }, l)));
    const status = h('select', { class: 'select' }, STATUSES.map(([v, l]) => h('option', { value: v }, l)));
    kind.value = it.kind; status.value = it.status;
    const version = h('input', { class: 'input', type: 'text', maxlength: 20, value: it.version, placeholder: 'e.g. 2.20.0', autocomplete: 'off' });
    const notes = h('textarea', { class: 'input', maxlength: 2000, placeholder: 'What’s in it, what still needs doing…' }, it.notes);
    const testers = h('input', { type: 'checkbox', checked: !!it.testers });
    const err = h('p', { class: 'err', hidden: true });
    let armed = null;
    const del = isNew ? null : h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
      if (!armed) { del.textContent = 'Delete for good?'; del.classList.add('btn-red'); armed = setTimeout(() => { armed = null; del.textContent = 'Delete'; del.classList.remove('btn-red'); }, 4000); return; }
      clearTimeout(armed); close(); remove(it.id);
    } }, 'Delete');
    noDay.addEventListener('change', () => {
      day.disabled = noDay.checked;
      if (noDay.checked && status.value === 'planned') status.value = 'idea';
      if (!noDay.checked) { if (status.value === 'idea') status.value = 'planned'; if (!day.value) day.value = S.selected || todayKey(); day.focus(); }
    });
    const close = UI.modal(h('form', { class: 'plan-form', onsubmit: async (e) => {
      e.preventDefault();
      const name = title.value.trim();
      if (!name) { err.textContent = 'Give the update a name.'; err.hidden = false; title.focus(); return; }
      if (!noDay.checked && !day.value) { err.textContent = 'Pick a date, or tick “No date yet”.'; err.hidden = false; day.focus(); return; }
      const item = { id: it.id, title: name, day: noDay.checked ? '' : day.value, kind: kind.value, status: status.value,
        version: version.value.trim().replace(/^v/i, ''), notes: notes.value.trim(), testers: testers.checked };
      close();
      if (item.day) { const d = parse(item.day); S.month = { y: d.getFullYear(), m: d.getMonth() }; S.selected = item.day; }
      await save(item, isNew ? (item.day ? `📅 Added to ${fmtDay(item.day)}` : '💡 Added to Ideas') : 'Saved ✅');
    } },
    h('h2', {}, isNew ? (it.day ? `Add an update · ${fmtDay(it.day)}` : 'Add an idea') : 'Edit update'),
    h('label', { class: 'field' }, 'What’s the update?', title),
    h('div', { class: 'row2' }, h('label', { class: 'field' }, 'Date', day), h('label', { class: 'check' }, noDay, 'No date yet (idea)')),
    h('div', { class: 'row2' }, h('label', { class: 'field' }, 'Type', kind), h('label', { class: 'field' }, 'Status', status)),
    h('label', { class: 'field' }, 'Version', version),
    h('label', { class: 'field' }, 'Notes', notes),
    h('label', { class: 'switch' }, testers, '🧪 Testers can see this'),
    err,
    isNew ? null : h('div', { class: 'meta' }, `Added by ${it.by || 'someone'}${it.updated ? ` · changed ${UI.timeAgo(it.updated)}` : ''}`),
    h('div', { class: 'actions' }, del, h('span', { class: 'grow' }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn btn-pink btn-sm', type: 'submit' }, isNew ? 'Add' : 'Save'))), { onClose: () => clearTimeout(armed) });
    setTimeout(() => title.focus(), 80);
  }

  // ------------------------------------------------------------ clicks, sheet edits and dragging
  function wire() {
    $('#grid').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (c) { open(Number(c.dataset.id)); return; }
      const day = e.target.closest('.day');
      if (!day) return;
      S.selected = day.dataset.day;
      if (narrow.matches || !S.canEdit) { renderGrid(); renderDayPanel(); return; }
      openAdd(day.dataset.day);
    });
    for (const id of ['#ideas', '#day-panel']) $(id).addEventListener('click', (e) => { const c = e.target.closest('.idea'); if (c) open(Number(c.dataset.id)); });

    $('#rows').addEventListener('change', (e) => {
      const f = e.target.dataset.f;
      const tr = e.target.closest('tr');
      if (!f || !tr || !S.canEdit) return;
      const it = S.items.get(Number(tr.dataset.id));
      if (!it) return;
      let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (f === 'title') { v = v.trim(); if (!v) { e.target.value = it.title; UI.toast('An update needs a name.', 'bad'); return; } }
      if (f === 'version') v = v.trim().replace(/^v/i, '');
      if (f === 'notes') v = v.trim();
      if (v === it[f]) return;
      const next = { ...it, [f]: v };
      if (f === 'day' && !v && it.status === 'planned') next.status = 'idea';
      if (f === 'day' && v && it.status === 'idea') next.status = 'planned';
      save(next);
    });
    const armedRows = new Map();
    $('#rows').addEventListener('click', (e) => {
      const b = e.target.closest('.del');
      if (!b) return;
      const id = Number(b.closest('tr').dataset.id);
      if (!armedRows.has(id)) {
        b.classList.add('armed'); b.textContent = 'Sure?';
        armedRows.set(id, setTimeout(() => { armedRows.delete(id); b.classList.remove('armed'); b.textContent = 'Delete'; }, 3500));
        return;
      }
      clearTimeout(armedRows.get(id));
      armedRows.delete(id);
      remove(id);
    });
  }

  // drag an update to another day, or onto the ideas shelf to take its date away
  let dragId = null;
  const dropTarget = (e) => e.target.closest && (e.target.closest('.day') || e.target.closest('#ideas-box'));
  const clearDrop = () => document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.chip, .idea');
    if (!c || !S.canEdit) return;
    dragId = Number(c.dataset.id);
    e.dataTransfer.setData('text/plain', String(dragId));
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  });
  document.addEventListener('dragend', () => { dragId = null; clearDrop(); document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });
  document.addEventListener('dragover', (e) => {
    const t = dragId != null && dropTarget(e);
    if (!t) return;
    e.preventDefault();
    if (!t.classList.contains('drop')) { clearDrop(); t.classList.add('drop'); }
  });
  document.addEventListener('drop', (e) => {
    const t = dragId != null && dropTarget(e);
    if (!t) return;
    e.preventDefault();
    clearDrop();
    const it = S.items.get(dragId);
    if (!it) return;
    if (t.id === 'ideas-box') {
      if (it.day) save({ ...it, day: '', status: it.status === 'planned' ? 'idea' : it.status }, '💡 Moved to Ideas');
    } else if (t.dataset.day !== it.day) {
      save({ ...it, day: t.dataset.day, status: it.status === 'idea' ? 'planned' : it.status }, `📅 Moved to ${fmtDay(t.dataset.day)}`);
    }
  });
  narrow.addEventListener('change', () => { if (S.builtFor) { renderGrid(); renderDayPanel(); } });

  gate();
})();
