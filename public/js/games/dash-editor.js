/* Neon Dash level editor + community levels.
   The editor draws with the game's own art (DashGame.Art) and playtests with the real game
   (DashGame.startSession with a custom level). Levels are saved as drafts in this browser; with an
   account you can verify a level (beat it in one go, inputs recorded) and post it. Admins check every
   level before it shows up under 🌐 Community levels, and players can post 3 levels a day. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Account, store, Sfx, fmtTime, clamp, on } = PA;
  const C = window.DashCore;
  const G = window.DashGame;
  const Art = G.Art;
  const FX = PA.FX || {};
  const L = C.LIMITS;
  const params = new URLSearchParams(location.search);
  const embed = params.get('embed') === '1';
  if (embed) document.body.classList.add('dash-embed');

  // ====================================================================
  // Palette
  // ====================================================================
  const OBJS = [
    { id: '#', name: 'Block', key: '1', tip: 'Land on top. Running into the side is a crash.' },
    { id: '^', name: 'Spike', key: '2', tip: 'Touch it and you crash.' },
    { id: 'v', name: 'Hanging spike', key: '3', tip: 'A spike pointing down.' },
    { id: '=', name: 'Yellow pad', key: '4', tip: 'Launches you high (cube).' },
    { id: '_', name: 'Pink pad', key: '5', tip: 'A small launch (cube).' },
    { id: 'o', name: 'Yellow orb', key: '6', tip: 'Tap in the air to jump again (cube).' },
    { id: 'p', name: 'Pink orb', key: '7', tip: 'A small mid-air jump (cube).' },
    { id: 'r', name: 'Red orb', key: '8', tip: 'A huge mid-air jump (cube).' },
    { id: 'b', name: 'Blue orb', key: '9', tip: 'Tap to flip gravity in UFO and Ball zones.' },
  ];
  const ZONES = [
    { id: 'ship', name: 'Ship zone', tip: 'Hold to fly up.' },
    { id: 'ufo', name: 'UFO zone', tip: 'Tap to flap.' },
    { id: 'ball', name: 'Ball zone', tip: 'Tap to flip gravity.' },
    { id: 'wave', name: 'Wave zone', tip: 'Hold to zig-zag up. Add a zigzag corridor in its settings.' },
  ];
  const MODE_EMOJI = { ship: '🚀', ufo: '🛸', ball: '⚽', wave: '〰️' };
  const THEME_NAMES = [['easy', 'Ocean'], ['normal', 'Neon'], ['hard', 'Lava'], ['insane', 'Toxic']];
  const TOOLS = [
    ['paint', '🖌️', 'Paint', 'B'], ['erase', '🧽', 'Erase', 'E'], ['select', '⬚', 'Select', 'S'], ['pan', '✋', 'Move view', 'H'],
  ];
  const brushInfo = (id) => OBJS.find((o) => o.id === id) || ZONES.find((z) => z.id === id) || (id === 'end' ? { id, name: 'Level end', tip: 'Click where the finish line goes.' } : null);

  // ====================================================================
  // Drafts (kept in this browser)
  // ====================================================================
  const DRAFTS = 'dash_drafts';
  const CUR = 'dash_draft_cur';
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const blank = (name = 'My level') => ({ v: 1, name, desc: '', theme: 'normal', music: true, len: 160, objs: [], zones: [] });
  function drafts() { const l = store.get(DRAFTS, []); return Array.isArray(l) ? l.filter((d) => d && d.id && d.level) : []; }
  function saveDrafts(list) { store.set(DRAFTS, list); }
  function putDraft(d) {
    const list = drafts();
    const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list[i] = d; else list.unshift(d);
    saveDrafts(list);
  }
  /** What a verify run proves: the gameplay part of a level (not its name or colours). */
  function fingerprint(lv) {
    const s = JSON.stringify([lv.len, [...lv.objs].sort((a, b) => a[1] - b[1] || a[2] - b[2]), lv.zones]);
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(36) + s.length.toString(36);
  }

  // ====================================================================
  // Editor state
  // ====================================================================
  const key = (x, y) => x * 16 + y;
  const ed = {
    draft: null, meta: blank(), cells: new Map(), zones: [], len: 160,
    tool: 'paint', brush: '#', S: 34, fitS: 34, camX: -3, camY: 0, tx: -3, ty: 0,
    undo: [], redo: [], sel: null, zoneSel: -1, pathEdit: false, clip: null, hover: null,
    drag: null, pointers: new Map(), pinch: null, space: false, lv: null, dirtyLv: true, saveTimer: 0,
    checkpoints: store.get('dash_ed_cp', false), open: false, miniDirty: true,
  };

  function levelData() {
    const objs = [];
    for (const [k, t] of ed.cells) objs.push([t, Math.floor(k / 16), k % 16]);
    objs.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    return { v: 1, name: ed.meta.name, desc: ed.meta.desc, theme: ed.meta.theme, music: ed.meta.music !== false, len: ed.len, objs, zones: ed.zones.map((z) => JSON.parse(JSON.stringify(z))) };
  }
  function loadLevel(lv) {
    ed.meta = { ...blank(), ...lv };
    ed.cells = new Map(lv.objs.map(([t, x, y]) => [key(x, y), t]));
    ed.zones = (lv.zones || []).map((z) => JSON.parse(JSON.stringify(z))).sort((a, b) => a[1] - b[1]);
    ed.len = lv.len;
    ed.sel = null; ed.zoneSel = -1; ed.pathEdit = false;
    changed(false);
  }
  function openDraft(d) {
    ed.draft = d;
    store.set(CUR, d.id);
    ed.undo = []; ed.redo = [];
    loadLevel(d.level);
    ed.camX = ed.tx = d.cam ? d.cam : -3;
    ed.camY = ed.ty = 0;
    renderTop();
  }
  function currentDraft() {
    const list = drafts();
    let d = list.find((x) => x.id === store.get(CUR, null)) || list[0];
    if (!d) { d = { id: newId(), name: 'My first level', updated: Date.now(), level: starter() }; putDraft(d); }
    return d;
  }
  /** A tiny example so a brand-new editor isn't empty. */
  function starter() {
    const lv = blank('My first level');
    lv.objs = [['^', 14, 0], ['#', 22, 0], ['#', 23, 0], ['#', 23, 1], ['^', 30, 0], ['^', 31, 0], ['=', 38, 0], ['#', 44, 2], ['#', 45, 2], ['#', 46, 2], ['^', 46, 3], ['o', 54, 3], ['^', 52, 0], ['^', 53, 0], ['^', 54, 0], ['^', 55, 0]];
    return lv;
  }

  /** Call after every change. `save` = it's an edit (saved as a draft, and the old verify run no longer counts). */
  function changed(save = true) {
    ed.dirtyLv = true;
    ed.miniDirty = true;
    if (save && ed.draft) {
      clearTimeout(ed.saveTimer);
      ed.saveTimer = setTimeout(saveNow, 400);
    }
    renderStatus();
  }
  function saveNow() {
    clearTimeout(ed.saveTimer);
    if (!ed.draft) return;
    ed.draft.level = levelData();
    ed.draft.name = ed.meta.name;
    ed.draft.updated = Date.now();
    ed.draft.cam = Math.round(ed.camX);
    putDraft(ed.draft);
    renderVerified();
  }
  function compiled() {
    if (ed.dirtyLv || !ed.lv) { ed.lv = C.compileLevel(levelData()); ed.dirtyLv = false; }
    return ed.lv;
  }
  const verified = () => !!(ed.draft && ed.draft.verified && ed.draft.replay && ed.draft.verified === fingerprint(levelData()));

  // -------------------------------------------------------------- undo / redo
  const snap = () => JSON.stringify({ c: [...ed.cells], z: ed.zones, l: ed.len });
  function restore(s) { const o = JSON.parse(s); ed.cells = new Map(o.c); ed.zones = o.z; ed.len = o.l; ed.sel = null; if (ed.zoneSel >= ed.zones.length) ed.zoneSel = -1; renderInspector(); changed(); }
  function remember() { ed.undo.push(snap()); if (ed.undo.length > 150) ed.undo.shift(); ed.redo = []; renderUndo(); }
  function undo() { if (!ed.undo.length) return; ed.redo.push(snap()); restore(ed.undo.pop()); renderUndo(); Sfx.play('click'); }
  function redo() { if (!ed.redo.length) return; ed.undo.push(snap()); restore(ed.redo.pop()); renderUndo(); Sfx.play('click'); }

  // -------------------------------------------------------------- editing helpers
  const zoneAt = (x) => ed.zones.findIndex((z) => x >= z[1] && x < z[1] + z[2]);
  /** Can an object go in this cell? (inside the level, below 14 rows, and below a zone's roof) */
  function cellOk(x, y) {
    if (x < 0 || x >= ed.len || y < 0 || y >= L.rows) return false;
    const zi = zoneAt(x);
    return zi < 0 || y < ed.zones[zi][3];
  }
  function put(x, y, t) {
    if (!cellOk(x, y)) return false;
    const k = key(x, y);
    if (ed.cells.get(k) === t) return false;
    if (!ed.cells.has(k) && ed.cells.size >= L.objs) { limitToast(); return false; }
    ed.cells.set(k, t);
    return true;
  }
  let limitShown = 0;
  function limitToast() { if (Date.now() - limitShown > 3000) { limitShown = Date.now(); UI.toast(`That’s the limit: ${L.objs} objects per level.`, 'bad'); } }
  function erase(x, y) { return ed.cells.delete(key(x, y)); }
  /** Remove objects a zone's roof would hide (x0..x1, at or above `ceil`). */
  function clearRoof(x0, x1, ceil) {
    for (const k of [...ed.cells.keys()]) { const x = Math.floor(k / 16); if (x >= x0 && x < x1 && k % 16 >= ceil) ed.cells.delete(k); }
  }
  /** The free span around column x (between other zones and inside the level). */
  function freeSpan(x, skip = -1) {
    let lo = 1, hi = ed.len;
    ed.zones.forEach((z, i) => {
      if (i === skip) return;
      if (z[1] + z[2] <= x) lo = Math.max(lo, z[1] + z[2]);
      else if (z[1] > x) hi = Math.min(hi, z[1]);
    });
    return [lo, hi];
  }
  function sortZones() {
    const sel = ed.zones[ed.zoneSel];
    ed.zones.sort((a, b) => a[1] - b[1]);
    ed.zoneSel = sel ? ed.zones.indexOf(sel) : -1;
  }
  function defaultPath(w, ceil, gap) {
    const lo = gap / 2 + 0.3;
    const hi = ceil - gap / 2 - 0.3;
    const pts = [];
    let up = false;
    for (let x = 5; x <= w - 5; x += Math.max(2, Math.min(3.2, hi - lo + 0.6))) { pts.push([Math.round(x * 10) / 10, Math.round((up ? hi : lo) * 10) / 10]); up = !up; }
    return pts;
  }
  /** Slopes steeper than 45° (the wave can't follow them): [[x0, y0, x1, y1], ...] in level blocks. */
  function steepParts(z) {
    if (z[0] !== 'wave' || !z[5] || !z[5].length) return [];
    const pts = C.zoneSlopes(z[2], z[3], z[4], z[5]);
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      for (const j of [1, 2]) if (Math.abs(pts[i][j] - pts[i - 1][j]) > dx + 1e-6) out.push([z[1] + pts[i - 1][0], pts[i - 1][j], z[1] + pts[i][0], pts[i][j]]);
    }
    return out;
  }

  // ====================================================================
  // Layout
  // ====================================================================
  const root = $('#editor');
  const cv = h('canvas', { class: 'ed-cv' });
  const ctx = cv.getContext('2d');
  const mini = h('canvas', { class: 'ed-mini', title: 'The whole level: click or drag to jump there' });
  const mctx = mini.getContext('2d');
  const miniCache = document.createElement('canvas');
  const stageEl = h('div', { class: 'ed-stage' }, cv);
  const hintEl = h('div', { class: 'ed-hint' });
  const coordEl = h('div', { class: 'ed-coord mono' });
  const inspEl = h('div', { class: 'ed-insp hidden' });
  const selBar = h('div', { class: 'ed-selbar hidden' });
  stageEl.append(hintEl, coordEl, inspEl, selBar);
  const nameIn = h('input', { class: 'ed-name', maxlength: L.name, 'aria-label': 'Level name', spellcheck: false });
  const topEl = h('div', { class: 'ed-top' });
  const toolsEl = h('div', { class: 'ed-tools' });
  const paletteEl = h('aside', { class: 'ed-palette', 'aria-label': 'Objects' });
  const statusEl = h('div', { class: 'ed-status' });
  fill(root, h('div', { class: 'ed-wrap' }, topEl, h('div', { class: 'ed-main' }, paletteEl, h('div', { class: 'ed-center' }, toolsEl, stageEl, mini, statusEl))));

  nameIn.addEventListener('input', () => { ed.meta.name = nameIn.value.slice(0, L.name); saveSoon(); });
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); });
  function saveSoon() { clearTimeout(ed.saveTimer); ed.saveTimer = setTimeout(saveNow, 500); }

  /** A small yes / no (or text) question in the site's own popup. Resolves with true / the text, or null. */
  function ask(title, text, { input = null, ok = 'OK', danger = false } = {}) {
    return new Promise((resolve) => {
      let answer = null;
      const field = input != null ? h('input', { class: 'input', value: input, maxlength: L.name }) : null;
      const close = UI.modal(h('form', { onsubmit: (e) => { e.preventDefault(); answer = field ? field.value : true; close(); } },
        h('h2', {}, title), text ? h('p', { class: 'muted', style: { margin: '6px 0 12px' } }, text) : null, field,
        h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } },
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'btn-red' : 'btn-pink'), type: 'submit' }, ok))), { onClose: () => resolve(answer) });
      if (field) setTimeout(() => { field.focus(); field.select(); }, 80);
    });
  }

  const btn = (cls, label, title, onclick, extra = {}) => h('button', { class: 'btn ' + cls, type: 'button', title, 'aria-label': title, onclick, ...extra }, label);

  function renderTop() {
    nameIn.value = ed.meta.name;
    const verifiedChip = h('span', { class: 'ed-chip', id: 'ed-verified' });
    fill(topEl,
      h('button', { class: 'icon-btn', title: 'Back', 'aria-label': 'Back', onclick: leaveEditor }, PA.icon('arrow-left')),
      h('div', { class: 'ed-title' }, h('span', { class: 'ed-badge' }, '🛠️'), nameIn, verifiedChip),
      h('div', { class: 'ed-actions' },
        btn('btn-ghost btn-sm ed-wide', '📁 Drafts', 'Your drafts', openDrafts),
        btn('btn-ghost btn-sm ed-wide', '⚙️ Settings', 'Level settings', openSettings),
        btn('btn-ghost btn-sm ed-wide', '🔗 Share code', 'Export / import a level code', openCode),
        btn('btn-ghost btn-sm ed-narrow', '⋯', 'More', (e) => UI.menu(e.currentTarget, [
          { label: '📁 Drafts', onClick: openDrafts }, { label: '⚙️ Level settings', onClick: openSettings }, { label: '🔗 Share code', onClick: openCode },
          { label: '🌐 Community levels', onClick: () => openCommunity('browse') }, { label: '📮 My posted levels', onClick: () => openCommunity('mine') },
          { label: `🚩 Practice checkpoints: ${ed.checkpoints ? 'on' : 'off'}`, onClick: () => { ed.checkpoints = !ed.checkpoints; store.set('dash_ed_cp', ed.checkpoints); renderTools(); UI.toast(`🚩 Checkpoints ${ed.checkpoints ? 'on' : 'off'} in playtests`, '', 1500); } }])),
        btn('btn-ghost btn-sm ed-wide', '📮 My levels', 'Levels you posted', () => openCommunity('mine')),
        btn('btn-cyan btn-sm', '✅ Verify', 'Beat it in one go to post it', startVerify, { id: 'ed-verify' }),
        btn('btn-pink btn-sm', '🚀 Post', 'Post it for everyone (an admin checks it first)', openPost)));
    renderVerified();
  }
  function renderVerified() {
    const el = $('#ed-verified');
    if (!el) return;
    const ok = verified();
    const posted = ed.draft && ed.draft.posted && ed.draft.posted.fp === fingerprint(levelData());
    el.className = 'ed-chip ' + (posted ? 'posted' : ok ? 'ok' : '');
    el.textContent = posted ? '📮 Posted' : ok ? '✅ Verified' : 'Draft · saved';
    el.title = posted ? 'You posted this version' : ok ? 'You beat this version in verify mode: it’s ready to post' : 'Saved in this browser';
  }

  function renderTools() {
    const zoomPct = Math.round((ed.S / ed.fitS) * 100);
    fill(toolsEl,
      h('div', { class: 'ed-seg', role: 'toolbar', 'aria-label': 'Tools' }, TOOLS.map(([id, e, name, k]) => h('button', {
        class: 'ed-tool' + (ed.tool === id ? ' on' : ''), type: 'button', title: `${name} (${k})`, 'aria-label': name, 'aria-pressed': String(ed.tool === id),
        onclick: () => setTool(id),
      }, h('span', { class: 'e' }, e), h('span', { class: 'l' }, name)))),
      h('div', { class: 'ed-seg' },
        h('button', { class: 'ed-tool', type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', id: 'ed-undo', onclick: undo }, h('span', { class: 'e' }, '↶')),
        h('button', { class: 'ed-tool', type: 'button', title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', id: 'ed-redo', onclick: redo }, h('span', { class: 'e' }, '↷'))),
      h('div', { class: 'ed-seg ed-zoom' },
        h('button', { class: 'ed-tool', type: 'button', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, h('span', { class: 'e' }, '−')),
        h('button', { class: 'ed-tool ed-pct', type: 'button', title: 'Fit the level’s height', onclick: () => { zoomTo(ed.fitS); } }, `${zoomPct}%`),
        h('button', { class: 'ed-tool', type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, h('span', { class: 'e' }, '+'))),
      h('div', { class: 'grow' }),
      h('label', { class: 'switch ed-cp', title: 'Practice checkpoints in playtests' }, h('input', { type: 'checkbox', checked: ed.checkpoints, onchange: (e) => { ed.checkpoints = e.target.checked; store.set('dash_ed_cp', ed.checkpoints); } }), h('span', {}, '🚩 Checkpoints')),
      h('div', { class: 'ed-seg' },
        h('button', { class: 'ed-tool ed-play', type: 'button', title: 'Playtest from the start (Enter)', onclick: () => playtest(0) }, h('span', { class: 'e' }, '▶'), h('span', { class: 'l' }, 'Test')),
        h('button', { class: 'ed-tool', type: 'button', title: 'Playtest from the left of the view (Shift+Enter)', onclick: () => playtest(hereX()) }, h('span', { class: 'e' }, '⏵'), h('span', { class: 'l' }, 'From here'))));
    renderUndo();
  }
  function renderUndo() {
    const u = $('#ed-undo'), r = $('#ed-redo');
    if (u) u.disabled = !ed.undo.length;
    if (r) r.disabled = !ed.redo.length;
  }
  function setTool(id) {
    ed.tool = id;
    if (id !== 'select') { ed.sel = null; renderSelBar(); }
    renderTools();
    renderPalette();
    Sfx.play('click');
  }
  function setBrush(id) {
    ed.brush = id;
    if (ed.tool !== 'paint') ed.tool = 'paint';
    renderPalette();
    renderTools();
    Sfx.play('click');
  }

  // palette: the real game art on little canvases
  const icons = new Map();
  function paletteIcon(id) {
    if (icons.has(id)) return icons.get(id);
    const size = 44;
    const c = h('canvas', { width: size * 2, height: size * 2, class: 'pi-cv' });
    const x2 = c.getContext('2d');
    const draw = () => {
      x2.setTransform(2, 0, 0, 2, 0, 0);
      x2.clearRect(0, 0, size, size);
      const th = C.THEMES[ed.meta.theme] || C.THEMES.normal;
      const S = 26;
      const sx = (x) => (x - 0) * S + (size - S) / 2;
      const sy = (y) => size - (size - S) / 2 - y * S;
      Art.on(x2, () => {
        if (OBJS.some((o) => o.id === id)) {
          const o = { t: id, x: 0, y: 0 };
          Art.objects({ 0: [o] }, 0, 0, sx, sy, S, th, 0, null);
        } else if (MODE_EMOJI[id]) {
          const col = G.MODE_COLOR[id];
          x2.fillStyle = col + '22';
          x2.fillRect(6, 6, size - 12, size - 12);
          Art.portal(0, 0, 1, id, (x) => size / 2 + x, (y) => size - 7 - y * (size - 14), 24, 0);
        } else if (id === 'end') {
          const cell = 6;
          for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) { x2.fillStyle = (r + k) % 2 ? '#ffffff' : '#111111'; x2.fillRect(13 + k * cell, 8 + r * cell, cell, cell); }
          x2.fillStyle = '#ffffff';
          x2.fillRect(11, 6, 2, 32);
        }
      });
    };
    draw();
    icons.set(id, { el: c, draw });
    return icons.get(id);
  }
  function renderPalette() {
    const item = (o) => {
      const ic = paletteIcon(o.id);
      return h('button', { class: 'pi' + (ed.brush === o.id && ed.tool === 'paint' ? ' on' : ''), type: 'button', title: `${o.name}${o.key ? ` (${o.key})` : ''}: ${o.tip}`, 'aria-label': o.name, onclick: () => setBrush(o.id) },
        ic.el, h('span', { class: 'pi-name' }, o.name), o.key ? h('span', { class: 'pi-key' }, o.key) : null);
    };
    fill(paletteEl,
      h('div', { class: 'pg' }, h('div', { class: 'pg-h' }, 'Blocks & spikes'), h('div', { class: 'pg-grid' }, OBJS.slice(0, 3).map(item))),
      h('div', { class: 'pg' }, h('div', { class: 'pg-h' }, 'Pads & orbs'), h('div', { class: 'pg-grid' }, OBJS.slice(3).map(item))),
      h('div', { class: 'pg' }, h('div', { class: 'pg-h' }, 'Mode zones'), h('div', { class: 'pg-grid' }, ZONES.map(item))),
      h('div', { class: 'pg' }, h('div', { class: 'pg-h' }, 'Finish'), h('div', { class: 'pg-grid' }, item({ id: 'end', name: 'Level end', tip: 'Click where the finish line goes.' }))));
  }
  function refreshIcons() { for (const ic of icons.values()) ic.draw(); }

  function renderStatus() {
    if (!ed.open) return;
    const secs = ed.len / C.SPEED;
    fill(statusEl,
      h('span', {}, h('b', {}, ed.cells.size.toLocaleString('en-US')), ` / ${L.objs.toLocaleString('en-US')} objects`),
      h('span', {}, h('b', {}, ed.len), ` blocks · ${secs.toFixed(1)}s`),
      h('span', {}, h('b', {}, ed.zones.length), ` zone${ed.zones.length === 1 ? '' : 's'}`),
      h('span', { class: 'grow' }),
      h('span', { class: 'ed-keys' }, h('span', { class: 'kbd' }, 'Wheel'), ' scroll · ', h('span', { class: 'kbd' }, 'Ctrl'), '+wheel zoom · ', h('span', { class: 'kbd' }, 'Space'), '+drag move'));
    hintEl.classList.toggle('hidden', ed.cells.size > 0 || ed.zones.length > 0);
    fill(hintEl, matchMedia('(pointer: coarse)').matches
      ? 'Pick an object below, then tap or drag to place it. Two fingers move and zoom.'
      : 'Pick an object on the left, then click or drag to place it. Right-click erases.');
  }

  // ====================================================================
  // Zone inspector + selection bar (float over the stage)
  // ====================================================================
  function renderInspector() {
    const z = ed.zones[ed.zoneSel];
    const opening = z && inspEl.classList.contains('hidden');
    inspEl.classList.toggle('hidden', !z);
    if (!z) { ed.pathEdit = false; return; }
    if (opening) { inspEl.style.pointerEvents = 'none'; setTimeout(() => { inspEl.style.pointerEvents = ''; }, 350); }
    const i = ed.zoneSel;
    const edit = (fn) => { remember(); fn(); changed(); renderInspector(); };
    const stepper = (label, value, dec, inc, fmt = (v) => v) => h('div', { class: 'ins-row' }, h('span', { class: 'ins-l' }, label),
      h('div', { class: 'ins-step' }, h('button', { type: 'button', class: 'ed-tool', 'aria-label': `Less ${label}`, onclick: dec }, '−'), h('b', {}, fmt(value)), h('button', { type: 'button', class: 'ed-tool', 'aria-label': `More ${label}`, onclick: inc }, '+')));
    const setCeil = (v) => edit(() => {
      z[3] = clamp(v, L.ceil[0], L.ceil[1]);
      clearRoof(z[1], z[1] + z[2], z[3]);
      if (z[5]) { z[4] = Math.min(z[4], z[3] - 0.5); z[5].forEach((p) => { p[1] = clamp(p[1], z[4] / 2, z[3] - z[4] / 2); }); }
    });
    const setWidth = (v) => edit(() => {
      const [, hi] = freeSpan(z[1], i);
      z[2] = clamp(v, L.zoneW[0], Math.min(L.zoneW[1], hi - z[1]));
      if (z[5]) z[5] = z[5].filter((p) => p[0] < z[2] - 0.2);
      clearRoof(z[1], z[1] + z[2], z[3]);
    });
    const wave = z[0] === 'wave';
    const zig = wave && z[5] && z[5].length > 0;
    const steep = steepParts(z).length;
    fill(inspEl,
      h('div', { class: 'ins-head' }, h('span', { class: 'ins-e', style: { '--c': G.MODE_COLOR[z[0]] } }, MODE_EMOJI[z[0]]),
        h('b', {}, ZONES.find((q) => q.id === z[0]).name), h('button', { class: 'icon-btn ins-x', 'aria-label': 'Close', onclick: () => { ed.zoneSel = -1; renderInspector(); } }, PA.icon('x'))),
      h('div', { class: 'ins-modes' }, ZONES.map((q) => h('button', { type: 'button', class: 'ins-mode' + (q.id === z[0] ? ' on' : ''), title: q.name, onclick: () => edit(() => { z[0] = q.id; if (q.id !== 'wave') z.length = 4; }) }, MODE_EMOJI[q.id]))),
      h('div', { class: 'tiny muted' }, `Blocks ${z[1]}–${z[1] + z[2] - 1}. ${ZONES.find((q) => q.id === z[0]).tip}`),
      stepper('Height', z[3], () => setCeil(z[3] - 1), () => setCeil(z[3] + 1)),
      stepper('Length', z[2], () => setWidth(z[2] - 2), () => setWidth(z[2] + 2)),
      wave ? h('label', { class: 'switch ins-row' }, h('input', { type: 'checkbox', checked: zig, onchange: (e) => edit(() => {
        if (e.target.checked) { const gap = Math.min(4.4, z[3] - 1.5); z[4] = gap; z[5] = defaultPath(z[2], z[3], gap); ed.pathEdit = true; } else { z.length = 4; ed.pathEdit = false; }
      }) }), 'Zigzag corridor') : null,
      zig ? stepper('Gap', z[4], () => edit(() => { z[4] = Math.max(L.gap[0], Math.round((z[4] - 0.2) * 10) / 10); }),
        () => edit(() => { z[4] = Math.min(L.gap[1], z[3] - 0.5, Math.round((z[4] + 0.2) * 10) / 10); z[5].forEach((p) => { p[1] = clamp(p[1], z[4] / 2, z[3] - z[4] / 2); }); }), (v) => v.toFixed(1)) : null,
      zig ? h('label', { class: 'switch ins-row' }, h('input', { type: 'checkbox', checked: ed.pathEdit, onchange: (e) => { ed.pathEdit = e.target.checked; } }), 'Edit the zigzag') : null,
      zig && ed.pathEdit ? h('p', { class: 'tiny muted' }, 'Tap inside the zone to add a point, drag points to move them, double-tap one to remove it.') : null,
      steep ? h('p', { class: 'tiny ins-warn' }, `⚠️ ${steep} slope${steep === 1 ? ' is' : 's are'} steeper than the wave can fly (45°).`) : null,
      h('button', { class: 'btn btn-ghost btn-sm btn-block ins-del', type: 'button', onclick: () => edit(() => { ed.zones.splice(i, 1); ed.zoneSel = -1; }) }, '🗑️ Delete zone'));
  }

  function renderSelBar() {
    const s = ed.sel;
    selBar.classList.toggle('hidden', !s);
    if (!s) return;
    const n = selected().length;
    fill(selBar,
      h('span', { class: 'tiny' }, `${n} selected`),
      h('button', { class: 'ed-tool', type: 'button', title: 'Copy (Ctrl+C)', onclick: copySel }, '📋'),
      h('button', { class: 'ed-tool', type: 'button', title: 'Paste (Ctrl+V)', onclick: () => paste(), disabled: !ed.clip }, '📥'),
      h('button', { class: 'ed-tool', type: 'button', title: 'Duplicate (Ctrl+D)', onclick: duplicate }, '⧉'),
      h('button', { class: 'ed-tool', type: 'button', title: 'Delete (Del)', onclick: deleteSel }, '🗑️'),
      h('button', { class: 'ed-tool', type: 'button', title: 'Clear selection (Esc)', onclick: () => { ed.sel = null; renderSelBar(); } }, '✕'));
  }
  function selected() {
    const s = ed.sel;
    if (!s) return [];
    const out = [];
    for (const [k, t] of ed.cells) { const x = Math.floor(k / 16), y = k % 16; if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) out.push([t, x, y]); }
    return out;
  }
  function copySel() {
    const s = ed.sel;
    if (!s) return;
    ed.clip = { w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1, objs: selected().map(([t, x, y]) => [t, x - s.x0, y - s.y0]) };
    UI.toast(`📋 Copied ${ed.clip.objs.length} object${ed.clip.objs.length === 1 ? '' : 's'}`, '', 1400);
    renderSelBar();
  }
  function paste(at) {
    if (!ed.clip) return;
    const x0 = at ? at.x : ed.hover ? ed.hover.x : Math.round(ed.camX + 4);
    const y0 = at ? at.y : ed.hover ? ed.hover.y : 0;
    remember();
    for (const [t, dx, dy] of ed.clip.objs) put(x0 + dx, y0 + dy, t);
    ed.sel = { x0, y0, x1: x0 + ed.clip.w - 1, y1: y0 + ed.clip.h - 1 };
    if (ed.tool !== 'select') { ed.tool = 'select'; renderTools(); }
    changed(); renderSelBar();
  }
  function duplicate() { const s = ed.sel; if (!s) return; copySel(); paste({ x: s.x1 + 1, y: s.y0 }); }
  function deleteSel() {
    const list = selected();
    if (!list.length) { ed.sel = null; renderSelBar(); return; }
    remember();
    for (const [, x, y] of list) erase(x, y);
    changed(); renderSelBar();
  }
  function moveSel(dx, dy) {
    const s = ed.sel;
    if (!s || (!dx && !dy)) return;
    const list = selected();
    remember();
    for (const [, x, y] of list) erase(x, y);
    for (const [t, x, y] of list) put(x + dx, y + dy, t);
    ed.sel = { x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
    changed(); renderSelBar();
  }

  // ====================================================================
  // Camera
  // ====================================================================
  let W = 0, H = 0, DPR = 1, MW = 0, MH = 0;
  const groundH = () => Math.max(22, ed.S * 1.1);
  const floorY = () => H - groundH();
  const sx = (x) => (x - ed.camX) * ed.S;
  const sy = (y) => floorY() - (y - ed.camY) * ed.S;
  const toCell = (px, py) => ({ x: Math.floor(px / ed.S + ed.camX), y: Math.floor((floorY() - py) / ed.S + ed.camY), fx: px / ed.S + ed.camX, fy: (floorY() - py) / ed.S + ed.camY });
  const maxCamY = () => Math.max(0, L.rows + 0.6 - floorY() / ed.S);
  const clampCam = () => {
    ed.tx = clamp(ed.tx, -6, ed.len + 6 - W / ed.S);
    if (ed.len + 12 < W / ed.S) ed.tx = -6;
    ed.ty = clamp(ed.ty, 0, maxCamY());
  };
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = stageEl.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const mr = mini.getBoundingClientRect();
    MW = Math.max(1, mr.width); MH = Math.max(1, mr.height);
    mini.width = Math.round(MW * DPR); mini.height = Math.round(MH * DPR);
    const fit = H / (L.rows + 0.6 + 1.1);
    const was = ed.fitS;
    ed.fitS = clamp(fit, 14, 64);
    // phones start a bit zoomed in (bigger cells to tap); scroll up for the top rows
    if (Math.abs(ed.S - was) < 0.5 || !ed.sized) ed.S = matchMedia('(pointer: coarse)').matches ? Math.max(ed.fitS, 30) : ed.fitS;
    ed.sized = true;
    ed.miniDirty = true;
    clampCam(); ed.camY = ed.ty;
    renderTools();
  }
  new ResizeObserver(() => { if (ed.open) resize(); }).observe(stageEl);
  function zoomTo(S, px = W / 2, py = floorY()) {
    const before = toCell(px, py);
    ed.S = clamp(S, 12, 80);
    ed.camX = ed.tx = before.fx - px / ed.S;
    ed.camY = ed.ty = clamp(before.fy - (floorY() - py) / ed.S, 0, maxCamY());
    clampCam(); ed.camX = ed.tx;
    renderTools();
  }
  const zoomBy = (f, px, py) => zoomTo(ed.S * f, px, py);
  const hereX = () => clamp(Math.round(ed.camX + 3), 0, Math.max(0, ed.len - 10));

  // ====================================================================
  // Drawing
  // ====================================================================
  function draw(now) {
    const lv = compiled();
    const th = lv.theme;
    const S = ed.S;
    const fy = floorY();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.top);
    grad.addColorStop(1, th.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const viewL = Math.floor(ed.camX) - 2;
    const viewR = Math.ceil(ed.camX + W / S) + 2;
    // the level's space: 14 rows from the start to the finish line; outside is dimmed
    const top = sy(L.rows);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    if (sx(0) > 0) ctx.fillRect(0, 0, sx(0), fy);
    if (sx(ed.len) < W) ctx.fillRect(sx(ed.len), 0, W - sx(ed.len), fy);
    ctx.fillRect(Math.max(0, sx(0)), 0, Math.min(W, sx(ed.len)) - Math.max(0, sx(0)), Math.max(0, top));

    // grid
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = Math.max(0, viewL); c <= Math.min(ed.len, viewR); c++) { if (c % 5) { ctx.moveTo(Math.round(sx(c)) + 0.5, Math.max(0, top)); ctx.lineTo(Math.round(sx(c)) + 0.5, fy); } }
    for (let r = 1; r < L.rows; r++) { const y = Math.round(sy(r)) + 0.5; ctx.moveTo(Math.max(0, sx(0)), y); ctx.lineTo(Math.min(W, sx(ed.len)), y); }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.stroke();
    ctx.beginPath();
    for (let c = Math.max(0, viewL - (viewL % 5)); c <= Math.min(ed.len, viewR); c += 5) { if (c % 5 === 0) { ctx.moveTo(Math.round(sx(c)) + 0.5, Math.max(0, top)); ctx.lineTo(Math.round(sx(c)) + 0.5, fy); } }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke();
    // the top of the level
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = th.line;
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(Math.max(0, sx(0)), Math.round(top) + 0.5); ctx.lineTo(Math.min(W, sx(ed.len)), Math.round(top) + 0.5); ctx.stroke();
    ctx.restore();

    Art.on(ctx, () => {
      for (const sec of lv.sections) {
        if (sec.x1 < viewL - 3 || sec.x0 > viewR + 3) continue;
        Art.tunnel(sec, sx, sy, S, th, now);
      }
      Art.objects(lv.cols, viewL, viewR, sx, sy, S, th, now / 1000, null);
    });

    // practice checkpoints
    if (ed.checkpoints) {
      for (const cx of lv.checkpoints.slice(1)) {
        if (cx < viewL || cx > viewR) continue;
        const x = sx(cx + 0.2);
        ctx.save();
        ctx.strokeStyle = 'rgba(163,230,53,0.8)'; ctx.fillStyle = 'rgba(163,230,53,0.6)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x, sy(0)); ctx.lineTo(x, sy(1.4)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, sy(1.4)); ctx.lineTo(x + S * 0.55, sy(1.2)); ctx.lineTo(x, sy(1)); ctx.fill();
        ctx.restore();
      }
    }

    // the selected zone: outline, edge handles, zigzag points, too-steep slopes
    const z = ed.zones[ed.zoneSel];
    if (z) {
      const xa = sx(z[1]), xb = sx(z[1] + z[2]), yc = sy(z[3]);
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
      ctx.strokeRect(xa + 1, yc, xb - xa - 2, fy - yc);
      ctx.setLineDash([]);
      for (const x of [xa, xb]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.roundRect(x - 5, (yc + fy) / 2 - 16, 10, 32, 5); ctx.fill();
        ctx.fillStyle = G.MODE_COLOR[z[0]];
        ctx.fillRect(x - 1, (yc + fy) / 2 - 9, 2, 18);
      }
      for (const [x0, y0, x1, y1] of steepParts(z)) {
        ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 4; ctx.shadowColor = '#f43f5e'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(sx(x0), sy(y0)); ctx.lineTo(sx(x1), sy(y1)); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (z[5] && ed.pathEdit) {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        z[5].forEach(([px, py], j) => { const X = sx(z[1] + px), Y = sy(py); if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [px, py] of z[5]) {
          ctx.fillStyle = '#22d3ee'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx(z[1] + px), sy(py), Math.max(6, S * 0.2), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // finish line
    const fx = sx(ed.len);
    if (fx < W + 40 && fx > -40) {
      const cell = S * 0.4;
      for (let r = 0; r < Math.ceil((fy - Math.max(0, top)) / cell); r++) {
        for (let c = 0; c < 2; c++) { ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111'; ctx.fillRect(fx + c * cell, fy - (r + 1) * cell, cell, cell); }
      }
      chip(fx + cell * 2 + 6, Math.max(8, top + 6), '🏁 Finish', '#ffffff');
    }

    // ground (as in the game)
    const gg = ctx.createLinearGradient(0, fy, 0, H);
    gg.addColorStop(0, th.ground);
    gg.addColorStop(1, '#000000');
    ctx.fillStyle = gg;
    ctx.fillRect(0, fy, W, H - fy);
    ctx.fillStyle = th.line;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, fy - 4, W, 8);
    ctx.globalAlpha = 1;
    ctx.fillRect(0, fy - 1.5, W, 3);
    // column numbers on the ground
    ctx.font = `600 ${Math.max(10, Math.min(13, S * 0.36))}px Fredoka, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const every = S < 22 ? 20 : 10;
    for (let c = Math.max(0, viewL - (viewL % every)); c <= Math.min(ed.len, viewR); c += every) if (c % every === 0) ctx.fillText(String(c), sx(c) + 3, fy + groundH() / 2);

    // the start: a ghost of you
    const me = PA.Profile.get();
    if (sx(0) > -S && sx(0) < W) {
      Art.on(ctx, () => Art.cube(sx(0), sy(1), S, me.color, me.avatar, 0, 0.5, false));
      chip(sx(0), sy(1) - 22, '▶ Start', me.color);
    }

    // hover preview
    const hv = ed.hover;
    if (hv && !ed.drag && !ed.pinch && ed.tool !== 'pan' && !ed.space) {
      if (ed.tool === 'paint' && OBJS.some((o) => o.id === ed.brush) && cellOk(hv.x, hv.y)) {
        ctx.save(); ctx.globalAlpha = 0.5;
        Art.on(ctx, () => Art.objects({ [hv.x]: [{ t: ed.brush, x: hv.x, y: hv.y }] }, hv.x, hv.x, sx, sy, S, th, now / 1000, null));
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(sx(hv.x) + 0.5, sy(hv.y + 1) + 0.5, S - 1, S - 1);
      } else if (ed.tool === 'paint' && (MODE_EMOJI[ed.brush] || ed.brush === 'end')) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(sx(hv.x), Math.max(0, top), S, fy - Math.max(0, top));
      } else if (ed.tool === 'erase' && hv.y >= 0) {
        ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
        ctx.strokeRect(sx(hv.x) + 1, sy(hv.y + 1) + 1, S - 2, S - 2);
        ctx.beginPath(); ctx.moveTo(sx(hv.x) + S * 0.25, sy(hv.y + 1) + S * 0.25); ctx.lineTo(sx(hv.x) + S * 0.75, sy(hv.y + 1) + S * 0.75);
        ctx.moveTo(sx(hv.x) + S * 0.75, sy(hv.y + 1) + S * 0.25); ctx.lineTo(sx(hv.x) + S * 0.25, sy(hv.y + 1) + S * 0.75); ctx.stroke();
      }
    }
    // a zone being dragged out
    const d = ed.drag;
    if (d && d.kind === 'zone') {
      const [a, b] = zoneSpan(d);
      ctx.fillStyle = G.MODE_COLOR[d.mode] + '40';
      ctx.fillRect(sx(a), sy(7), (b - a) * S, fy - sy(7));
      ctx.strokeStyle = G.MODE_COLOR[d.mode]; ctx.lineWidth = 2;
      ctx.strokeRect(sx(a), sy(7), (b - a) * S, fy - sy(7));
      chip(sx(a) + 6, sy(7) + 8, `${MODE_EMOJI[d.mode]} ${b - a} blocks`, G.MODE_COLOR[d.mode]);
    }
    // selection
    const s = ed.sel || (d && d.kind === 'box' ? boxOf(d) : null);
    if (s) {
      const off = d && d.kind === 'move' ? [d.dx, d.dy] : [0, 0];
      if (d && d.kind === 'move' && (off[0] || off[1])) {
        ctx.save(); ctx.globalAlpha = 0.6;
        const cols = {};
        for (const [t, x, y] of d.list) (cols[x + off[0]] ||= []).push({ t, x: x + off[0], y: y + off[1] });
        Art.on(ctx, () => Art.objects(cols, s.x0 + off[0], s.x1 + off[0], sx, sy, S, th, now / 1000, null));
        ctx.restore();
      }
      const x = sx(s.x0 + off[0]), y = sy(s.y1 + 1 + off[1]);
      const w = (s.x1 - s.x0 + 1) * S, hh = (s.y1 - s.y0 + 1) * S;
      ctx.fillStyle = 'rgba(34,211,238,0.12)';
      ctx.fillRect(x, y, w, hh);
      ctx.save();
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.lineDashOffset = -now / 40;
      ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
      ctx.restore();
    }
    drawMini();
  }

  function chip(x, y, text, color) {
    ctx.save();
    ctx.font = '600 12px Fredoka, sans-serif';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(11,9,32,0.75)';
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, x + 7, y + 10.5);
    ctx.restore();
  }

  // minimap: the whole level, the part you see, click to jump
  const OBJ_DOT = { '#': null, '^': '#ffffff', v: '#ffffff', '=': '#facc15', _: '#f472b6', o: '#fde047', p: '#f472b6', r: '#ef4444', b: '#60a5fa' };
  function drawMini() {
    const k = MW / Math.max(ed.len + 4, 40);
    const rowH = (MH - 6) / L.rows;
    if (ed.miniDirty) {
      ed.miniDirty = false;
      miniCache.width = mini.width; miniCache.height = mini.height;
      const m = miniCache.getContext('2d');
      m.setTransform(DPR, 0, 0, DPR, 0, 0);
      const th = C.THEMES[ed.meta.theme] || C.THEMES.normal;
      const g = m.createLinearGradient(0, 0, 0, MH);
      g.addColorStop(0, th.top); g.addColorStop(1, th.bottom);
      m.fillStyle = g; m.fillRect(0, 0, MW, MH);
      m.fillStyle = 'rgba(0,0,0,0.35)'; m.fillRect(ed.len * k, 0, MW, MH);
      for (const z of ed.zones) {
        m.fillStyle = G.MODE_COLOR[z[0]] + '55';
        m.fillRect(z[1] * k, MH - 3 - z[3] * rowH, z[2] * k, z[3] * rowH);
        m.fillStyle = 'rgba(0,0,0,0.45)';
        m.fillRect(z[1] * k, 0, z[2] * k, MH - 3 - z[3] * rowH);
      }
      for (const [kk, t] of ed.cells) {
        const x = Math.floor(kk / 16), y = kk % 16;
        m.fillStyle = OBJ_DOT[t] || th.line;
        m.fillRect(x * k, MH - 3 - (y + 1) * rowH, Math.max(1, k), Math.max(1, rowH - (t === '#' ? 0 : rowH * 0.4)));
      }
      m.fillStyle = th.line; m.fillRect(0, MH - 3, MW, 3);
      m.fillStyle = '#ffffff'; m.fillRect(ed.len * k, 0, 2, MH);
    }
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.drawImage(miniCache, 0, 0);
    mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const vx = ed.camX * k, vw = (W / ed.S) * k;
    mctx.fillStyle = 'rgba(255,255,255,0.14)';
    mctx.fillRect(vx, 0, vw, MH);
    mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1.5;
    mctx.strokeRect(vx + 0.75, 0.75, vw - 1.5, MH - 1.5);
  }
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    const k = MW / Math.max(ed.len + 4, 40);
    ed.tx = (e.clientX - r.left) / k - W / ed.S / 2;
    clampCam();
  }
  mini.addEventListener('pointerdown', (e) => { mini.setPointerCapture(e.pointerId); miniJump(e); mini.onpointermove = miniJump; });
  mini.addEventListener('pointerup', () => { mini.onpointermove = null; });

  let raf = 0;
  function frame(now) {
    raf = 0;
    if (!ed.open || root.classList.contains('hidden')) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    // smooth scrolling toward the target
    const k = 0.28;
    ed.camX += (ed.tx - ed.camX) * k;
    ed.camY += (ed.ty - ed.camY) * k;
    if (Math.abs(ed.tx - ed.camX) < 0.002) ed.camX = ed.tx;
    if (Math.abs(ed.ty - ed.camY) < 0.002) ed.camY = ed.ty;
    draw(now);
  }

  // ====================================================================
  // Pointer input
  // ====================================================================
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const boxOf = (d) => ({ x0: Math.min(d.a.x, d.b.x), x1: Math.max(d.a.x, d.b.x), y0: clamp(Math.min(d.a.y, d.b.y), 0, L.rows - 1), y1: clamp(Math.max(d.a.y, d.b.y), 0, L.rows - 1) });
  function zoneSpan(d) {
    const [lo, hi] = freeSpan(d.x0);
    let a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1) + 1;
    if (b - a < 3) b = a + 30;   // a click: a 30 block zone
    a = clamp(a, lo, hi); b = clamp(b, lo, hi);
    if (b - a > L.zoneW[1]) b = a + L.zoneW[1];
    return [a, b];
  }
  /** Cells on a line from a to b, so fast drags don't leave gaps. */
  function line(a, b, fn) {
    let { x, y } = a;
    const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), stx = x < b.x ? 1 : -1, sty = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      fn(x, y);
      if (x === b.x && y === b.y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += stx; }
      if (e2 <= dx) { err += dx; y += sty; }
    }
  }
  function zoneHit(c) {
    const i = zoneAt(c.x);
    return i >= 0 ? i : -1;
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // no "ghost" click after a tap: it would land on the zone settings that just popped up under the finger
  cv.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.focus({ preventScroll: true });
    cv.setPointerCapture(e.pointerId);
    const [px, py] = local(e);
    ed.pointers.set(e.pointerId, { x: px, y: py });
    if (ed.pointers.size === 2) { endDrag(true); startPinch(); return; }
    if (ed.pointers.size > 2) return;
    const c = toCell(px, py);
    ed.hover = c;
    const pan = e.button === 1 || ed.space || ed.tool === 'pan';
    if (pan) { ed.drag = { kind: 'pan', px, py, cx: ed.tx, cy: ed.ty }; return; }
    // the selected zone: drag its edges, or edit its zigzag
    const z = ed.zones[ed.zoneSel];
    if (z && e.button === 0) {
      const near = (x) => Math.abs(c.fx - x) < Math.max(0.45, 10 / ed.S) && c.fy < z[3];
      if (near(z[1]) || near(z[1] + z[2])) { remember(); ed.drag = { kind: 'edge', zone: z, side: near(z[1]) ? 0 : 1 }; return; }
      if (ed.pathEdit && z[5] && c.fx > z[1] && c.fx < z[1] + z[2] && c.fy < z[3]) { pathDown(z, c, e); return; }
    }
    const erasing = e.button === 2 || ed.tool === 'erase';
    if (erasing) {
      remember();
      ed.drag = { kind: 'erase', last: c, any: false };
      // the dark roof of a zone (or its portal) erases the whole zone
      const zi = zoneHit(c);
      if (zi >= 0 && c.y >= ed.zones[zi][3]) { ed.zones.splice(zi, 1); ed.zoneSel = -1; renderInspector(); changed(); Sfx.play('pop'); ed.drag.any = true; return; }
      if (erase(c.x, c.y)) { ed.drag.any = true; changed(); }
      return;
    }
    if (ed.tool === 'select') {
      const s = ed.sel;
      if (s && c.x >= s.x0 && c.x <= s.x1 && c.y >= s.y0 && c.y <= s.y1) { ed.drag = { kind: 'move', start: c, dx: 0, dy: 0, list: selected() }; return; }
      ed.sel = null; renderSelBar();
      ed.drag = { kind: 'box', a: c, b: c };
      return;
    }
    // paint
    const zi = zoneHit(c);
    if (MODE_EMOJI[ed.brush]) {
      if (zi >= 0) { selectZone(zi); return; }
      ed.drag = { kind: 'zone', mode: ed.brush, x0: c.x, x1: c.x };
      return;
    }
    if (ed.brush === 'end') { remember(); setEnd(c.x); ed.drag = { kind: 'end' }; return; }
    if (zi >= 0 && c.y >= ed.zones[zi][3]) { selectZone(zi); return; }   // clicked a zone's roof
    remember();
    ed.drag = { kind: 'paint', last: c, any: false };
    if (put(c.x, c.y, ed.brush)) { ed.drag.any = true; changed(); Sfx.play('click'); }
  });

  cv.addEventListener('pointermove', (e) => {
    const [px, py] = local(e);
    if (ed.pointers.has(e.pointerId)) ed.pointers.set(e.pointerId, { x: px, y: py });
    if (ed.pinch) { movePinch(); return; }
    const c = toCell(px, py);
    ed.hover = c;
    coordEl.textContent = `x ${c.x} · y ${c.y}`;
    const d = ed.drag;
    if (!d) return;
    if (d.kind === 'pan') { ed.tx = d.cx - (px - d.px) / ed.S; ed.ty = d.cy + (py - d.py) / ed.S; clampCam(); ed.camX = ed.tx; ed.camY = ed.ty; }
    else if (d.kind === 'paint') { let any = false; line(d.last, c, (x, y) => { if (put(x, y, ed.brush)) any = true; }); d.last = c; if (any) { d.any = true; changed(); } }
    else if (d.kind === 'erase') { let any = false; line(d.last, c, (x, y) => { if (erase(x, y)) any = true; }); d.last = c; if (any) { d.any = true; changed(); } }
    else if (d.kind === 'box') d.b = c;
    else if (d.kind === 'move') { d.dx = c.x - d.start.x; d.dy = c.y - d.start.y; }
    else if (d.kind === 'zone') d.x1 = c.x;
    else if (d.kind === 'end') setEnd(c.x);
    else if (d.kind === 'edge') dragEdge(d, c);
    else if (d.kind === 'path') dragPath(d, c);
    edgeScroll(px);
  });

  function endDrag(cancel) {
    const d = ed.drag;
    ed.drag = null;
    if (!d) return;
    if (d.kind === 'paint' || d.kind === 'erase') { if (!d.any) ed.undo.pop(); renderUndo(); }
    else if (d.kind === 'box' && !cancel) {
      const s = boxOf(d);
      if (s.x0 === s.x1 && s.y0 === s.y1) {
        // a click: pick the zone under it, or the object
        const zi = zoneHit(d.a);
        if (zi >= 0 && !ed.cells.has(key(d.a.x, d.a.y))) { selectZone(zi); return; }
      }
      ed.sel = s;
      if (!selected().length) ed.sel = null;
      renderSelBar();
    } else if (d.kind === 'move' && !cancel) moveSel(d.dx, d.dy);
    else if (d.kind === 'zone' && !cancel) {
      const [a, b] = zoneSpan(d);
      if (b - a < L.zoneW[0]) { UI.toast('There’s no room for a zone here.', 'bad'); return; }
      remember();
      ed.zones.push([d.mode, a, b - a, 7]);
      clearRoof(a, b, 7);
      ed.zoneSel = ed.zones.length - 1;
      sortZones();
      changed(); renderInspector();
      Sfx.play('swoosh');
    } else if (d.kind === 'edge' || d.kind === 'path') { changed(); renderInspector(); }
    else if (d.kind === 'end') changed();
  }
  const up = (e) => {
    ed.pointers.delete(e.pointerId);
    if (ed.pinch) { if (ed.pointers.size < 2) ed.pinch = null; return; }
    endDrag(false);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', (e) => { ed.pointers.delete(e.pointerId); ed.pinch = null; endDrag(true); });
  cv.addEventListener('pointerleave', () => { if (!ed.drag) ed.hover = null; });

  function edgeScroll(px) {
    const d = ed.drag;
    if (!d || d.kind === 'pan') return;
    const m = 30;
    if (px < m) ed.tx -= 0.4; else if (px > W - m) ed.tx += 0.4;
    clampCam();
  }
  function selectZone(i) {
    ed.zoneSel = i;
    ed.pathEdit = !!(ed.zones[i][5] && ed.zones[i][5].length);
    renderInspector();
    Sfx.play('click');
  }
  function setEnd(x) {
    const furthest = Math.max(0, ...[...ed.cells.keys()].map((k) => Math.floor(k / 16) + 1), ...ed.zones.map((z) => z[1] + z[2]));
    const n = clamp(x, Math.max(L.len[0], furthest), L.len[1]);
    if (n !== ed.len) { ed.len = n; changed(); }
  }
  function dragEdge(d, c) {
    const z = d.zone;
    const i = ed.zones.indexOf(z);
    const [lo, hi] = freeSpan(z[1], i);
    if (d.side === 1) z[2] = clamp(Math.round(c.fx) - z[1], L.zoneW[0], Math.min(L.zoneW[1], hi - z[1]));
    else {
      const end = z[1] + z[2];
      const x0 = clamp(Math.round(c.fx), Math.max(lo, end - L.zoneW[1]), end - L.zoneW[0]);
      if (z[5]) { const shift = z[1] - x0; z[5] = z[5].map(([px, py]) => [Math.round((px + shift) * 10) / 10, py]).filter((p) => p[0] > 0.1); }
      z[1] = x0; z[2] = end - x0;
    }
    if (z[5]) z[5] = z[5].filter((p) => p[0] < z[2] - 0.1);
    clearRoof(z[1], z[1] + z[2], z[3]);
    ed.dirtyLv = true; ed.miniDirty = true;
  }

  // wave zigzag points
  let lastTap = { t: 0, i: -1 };
  function pathDown(z, c, e) {
    const pts = z[5];
    const r = Math.max(0.45, 12 / ed.S);
    const i = pts.findIndex(([px, py]) => Math.hypot(z[1] + px - c.fx, py - c.fy) < r);
    remember();
    if (i >= 0) {
      const dbl = lastTap.i === i && performance.now() - lastTap.t < 380;
      lastTap = { t: performance.now(), i };
      if (dbl || ed.tool === 'erase' || e.button === 2) { pts.splice(i, 1); if (!pts.length) z.length = 4; ed.dirtyLv = true; changed(); renderInspector(); return; }
      ed.drag = { kind: 'path', zone: z, i };
      return;
    }
    if (pts.length >= L.path) { UI.toast(`Up to ${L.path} points per zigzag.`, 'bad'); return; }
    const p = [Math.round((c.fx - z[1]) * 5) / 5, 0];
    pts.push(p);
    pts.sort((a, b) => a[0] - b[0]);
    ed.drag = { kind: 'path', zone: z, i: pts.indexOf(p) };
    dragPath(ed.drag, c);
  }
  function dragPath(d, c) {
    const z = d.zone;
    const pts = z[5];
    const p = pts[d.i];
    if (!p) return;
    const lo = d.i > 0 ? pts[d.i - 1][0] + 0.2 : 0.2;
    const hi = d.i < pts.length - 1 ? pts[d.i + 1][0] - 0.2 : z[2] - 0.2;
    p[0] = clamp(Math.round((c.fx - z[1]) * 5) / 5, lo, hi);
    p[1] = clamp(Math.round(c.fy * 10) / 10, z[4] / 2, z[3] - z[4] / 2);
    ed.dirtyLv = true; ed.miniDirty = true;
  }

  // two fingers: pinch to zoom, drag to move
  function startPinch() {
    const [a, b] = [...ed.pointers.values()];
    ed.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), S: ed.S, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cell: toCell((a.x + b.x) / 2, (a.y + b.y) / 2) };
  }
  function movePinch() {
    const [a, b] = [...ed.pointers.values()];
    if (!a || !b) return;
    const p = ed.pinch;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ed.S = clamp(p.S * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, p.d), 12, 80);
    ed.tx = ed.camX = p.cell.fx - mx / ed.S;
    ed.ty = ed.camY = clamp(p.cell.fy - (floorY() - my) / ed.S, 0, maxCamY());
    clampCam(); ed.camX = ed.tx;
    renderZoomPct();
  }
  function renderZoomPct() { const el = toolsEl.querySelector('.ed-pct'); if (el) el.textContent = `${Math.round((ed.S / ed.fitS) * 100)}%`; }

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = local(e);
    if (e.ctrlKey || e.metaKey) { zoomBy(Math.exp(-e.deltaY * 0.0022), px, py); return; }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    if (e.shiftKey && !e.deltaX) ed.ty += (-e.deltaY * unit) / ed.S;
    else ed.tx += ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit) / ed.S;
    clampCam();
  }, { passive: false });

  // keyboard
  addEventListener('keydown', (e) => {
    if (!ed.open || root.classList.contains('hidden') || document.querySelector('.modal-backdrop')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'c') { e.preventDefault(); copySel(); return; }
    if (mod && k === 'x') { e.preventDefault(); copySel(); deleteSel(); return; }
    if (mod && k === 'v') { e.preventDefault(); paste(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
    if (mod && k === 's') { e.preventDefault(); saveNow(); UI.toast('💾 Saved', '', 1200); return; }
    if (mod) return;
    if (e.code === 'Space') { e.preventDefault(); ed.space = true; cv.classList.add('panning'); return; }
    if (e.key === 'Enter') { e.preventDefault(); playtest(e.shiftKey ? hereX() : 0); return; }
    if (e.key === 'Escape') { ed.sel = null; ed.zoneSel = -1; renderSelBar(); renderInspector(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (ed.sel) deleteSel(); else if (ed.zoneSel >= 0) { remember(); ed.zones.splice(ed.zoneSel, 1); ed.zoneSel = -1; changed(); renderInspector(); } return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (arrows) {
      e.preventDefault();
      const n = e.shiftKey ? 5 : 1;
      if (ed.sel) moveSel(arrows[0] * n, arrows[1] * n);
      else { ed.tx += arrows[0] * n * 2; ed.ty += arrows[1] * n; clampCam(); }
      return;
    }
    if (k === '+' || k === '=') { zoomBy(1.25); return; }
    if (k === '-') { zoomBy(1 / 1.25); return; }
    const o = OBJS.find((q) => q.key === e.key);
    if (o) { setBrush(o.id); return; }
    const tool = TOOLS.find((t) => t[3].toLowerCase() === k);
    if (tool) setTool(tool[0]);
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { ed.space = false; cv.classList.remove('panning'); } });
  addEventListener('blur', () => { ed.space = false; cv.classList.remove('panning'); });

  // ====================================================================
  // Opening / leaving the editor
  // ====================================================================
  function openEditor() {
    if (!ed.draft) openDraft(currentDraft());
    ed.open = true;
    G.showScreen('editor');
    $('#entry').classList.add('hidden');
    history.replaceState(null, '', location.pathname + '?editor=1');
    renderTop(); renderTools(); renderPalette(); renderStatus(); renderInspector(); renderSelBar();
    requestAnimationFrame(() => { resize(); if (!raf) raf = requestAnimationFrame(frame); });
  }
  function leaveEditor() {
    saveNow();
    ed.open = false;
    G.showScreen('entry');
    Lobby.showEntry();
    history.replaceState(null, '', location.pathname);
  }

  /** Playtest with the real game, from the start or from column x, then come back exactly here. */
  function playtest(x) {
    saveNow();
    const data = levelData();
    if (x >= ed.len - 4) x = 0;
    G.startSession({
      mode: 'test', custom: data, music: data.music, startX: x, checkpoints: ed.checkpoints, countdown: 0,
      onQuit: () => backToEditor(),
      onDone: (g) => { UI.toast(`🏁 You reached the end! ${fmtTime(g.finishMs)} · ${g.attempts} attempt${g.attempts === 1 ? '' : 's'}`, 'good', 3000); backToEditor(); },
    });
    G.banner(h('span', { class: 'big' }, '🧪 Playtest'), x ? `From block ${x}` : 'From the start', h('div', { class: 'small muted' }, 'Press ✕ to go back to the editor'));
    setTimeout(() => { const g = G.game; if (g && g.mode === 'test') G.hideBanner(); }, 1600);
  }
  function backToEditor() {
    ed.open = true;
    G.showScreen('editor');
    requestAnimationFrame(() => { resize(); if (!raf) raf = requestAnimationFrame(frame); });
  }

  // ====================================================================
  // Verify + post
  // ====================================================================
  function startVerify() {
    saveNow();
    const data = levelData();
    try { C.checkLevel({ ...data, name: data.name || 'x' }); } catch (e) { UI.toast(e.message, 'bad'); return; }
    if (!data.objs.length) { UI.toast('Add some obstacles first 🙂', 'bad'); return; }
    const fp = fingerprint(data);
    G.startSession({
      mode: 'verify', custom: data, music: data.music, checkpoints: false, countdown: 0,
      onQuit: () => { UI.toast('Verify run stopped. Beat the whole level in one go to post it.', '', 3000); backToEditor(); },
      onDone: (g) => {
        ed.draft.verified = fp;
        ed.draft.replay = { e: g.run.rec.slice(), n: g.run.tick };
        saveNow();
        Sfx.play('win');
        backToEditor();
        renderVerified();
        verifiedModal();
      },
    });
    G.banner(h('span', { class: 'big' }, '✅ Verify'), 'Beat your level in one go, from the start.', h('div', { class: 'small muted' }, 'No checkpoints. Crash and it starts over.'));
    setTimeout(() => { const g = G.game; if (g && g.mode === 'verify') G.hideBanner(); }, 2200);
  }
  function verifiedModal() {
    const close = UI.modal(h('div', { class: 'center-col' },
      h('div', { class: 'big-e' }, '🎉'),
      h('h2', {}, 'Level verified!'),
      h('p', { class: 'muted' }, 'You beat it from start to finish. Your run is saved with the level, so admins can watch it.'),
      h('div', { class: 'col', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-pink btn-lg', onclick: () => { close(); openPost(); } }, '🚀 Post it'),
        h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Keep editing'))));
  }

  async function needAccount(why) {
    if (Account.user) return true;
    const close = UI.modal(h('div', { class: 'center-col' },
      h('div', { class: 'big-e' }, '🔐'), h('h2', {}, 'Log in to post'),
      h('p', { class: 'muted' }, why),
      h('div', { class: 'col', style: { marginTop: '14px' } },
        h('button', { class: 'btn btn-pink btn-lg', onclick: () => { close(); UI.accountModal({ view: 'signup' }); } }, '✨ Create a free account'),
        h('button', { class: 'btn btn-cyan', onclick: () => { close(); UI.accountModal({ view: 'login' }); } }, '🔑 Log in'))));
    return false;
  }

  async function openPost() {
    saveNow();
    if (!await needAccount('Anyone can build levels, but you need an account to post them for everyone to play.')) return;
    const data = levelData();
    try { C.checkLevel(data); } catch (e) { UI.toast(e.message, 'bad'); if (/name/i.test(e.message)) openSettings(); return; }
    if (!verified()) {
      const close = UI.modal(h('div', { class: 'center-col' },
        h('div', { class: 'big-e' }, '✅'), h('h2', {}, 'Verify it first'),
        h('p', { class: 'muted' }, 'Like in Geometry Dash, you have to beat your own level from start to finish, in one go and without checkpoints, before you can post it. That proves it can be beaten!'),
        h('div', { class: 'col', style: { marginTop: '14px' } },
          h('button', { class: 'btn btn-cyan btn-lg', onclick: () => { close(); startVerify(); } }, '✅ Start a verify run'),
          h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Not yet'))));
      return;
    }
    let quota = null;
    try { quota = await Net.request('dash:quota'); } catch (e) { UI.toast(e.message, 'bad'); return; }
    const name = h('input', { class: 'input', maxlength: L.name, value: data.name });
    const desc = h('textarea', { class: 'input', maxlength: L.desc, rows: 2, placeholder: 'What’s it like? (optional)' }, data.desc);
    const strip = h('canvas', { class: 'post-strip' });
    const err = h('p', { class: 'acct-err' });
    const left = quota.admin ? null : quota.left;
    const go = h('button', { class: 'btn btn-pink btn-lg', type: 'submit', disabled: left === 0 }, '🚀 Post for review');
    const close = UI.modal(h('form', { class: 'post-form ed-form', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      ed.meta.name = name.value.trim(); ed.meta.desc = desc.value.trim(); nameIn.value = ed.meta.name;
      saveNow();
      go.disabled = true;
      try {
        const lv = levelData();
        const r = await Net.request('dash:post', { level: lv, replay: ed.draft.replay });
        ed.draft.posted = { id: r.id, at: Date.now(), fp: fingerprint(lv) };
        saveNow();
        close();
        UI.confetti(120);
        Sfx.play('win');
        UI.toast(`📮 Posted! An admin will check “${lv.name}” soon.${r.admin ? '' : ` ${r.left} post${r.left === 1 ? '' : 's'} left today.`}`, 'good', 5000);
        renderVerified();
      } catch (ex) { err.textContent = ex.message; go.disabled = false; Sfx.play('wrong'); }
    } },
    h('h2', {}, '🚀 Post your level?'),
    strip,
    h('label', { class: 'field' }, 'Name', name),
    h('label', { class: 'field' }, 'Description', desc),
    h('div', { class: 'post-quota' + (left === 0 ? ' none' : '') }, h('span', { class: 'e' }, left === 0 ? '⏳' : '📮'),
      h('div', {}, quota.admin ? h('b', {}, 'Admins can post as many levels as they like.')
        : h('b', {}, `You can post ${quota.limit} levels a day (${quota.left} left today)`),
      left === 0 ? h('div', { class: 'small' }, `You can post again in ${waitText(quota.wait)}.`) : null)),
    h('ul', { class: 'post-notes' },
      h('li', {}, '🛡️ An admin checks it first. Until then only you can see it, in ', h('b', {}, 'My levels'), '.'),
      h('li', {}, '🔒 Posted levels can’t be changed. To fix something, post it again (that counts as a new post).'),
      h('li', {}, '🗑️ Every post counts toward today’s limit, even if it’s rejected or you delete it.')),
    err,
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancel'), go)), { wide: false });
    requestAnimationFrame(() => drawStrip(strip, { len: data.len, theme: data.theme, o: data.objs.filter((o) => o[1] < 160), z: data.zones }, 0));
  }
  function waitText(s) {
    const m = Math.max(1, Math.ceil(s / 60));
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }

  // ====================================================================
  // Dialogs: drafts, settings, share code
  // ====================================================================
  function openDrafts() {
    saveNow();
    const list = h('div', { class: 'draft-list' });
    let close;
    const draw = () => {
      const all = drafts().sort((a, b) => b.updated - a.updated);
      fill(list, all.map((d) => {
        const cur = ed.draft && d.id === ed.draft.id;
        const fp = fingerprint(d.level);
        return h('div', { class: 'draft' + (cur ? ' cur' : '') },
          h('div', { class: 'grow' },
            h('div', {}, h('b', {}, d.level.name || 'Untitled'), cur ? h('span', { class: 'tag adm' }, 'open') : null,
              d.verified === fp ? h('span', { class: 'tag ok' }, '✅ verified') : null, d.posted && d.posted.fp === fp ? h('span', { class: 'tag post' }, '📮 posted') : null),
            h('div', { class: 'tiny muted' }, `${d.level.objs.length} objects · ${d.level.len} blocks · edited ${UI.timeAgo(Math.floor(d.updated / 1000))}`)),
          h('div', { class: 'draft-btns' },
            cur ? null : h('button', { class: 'btn btn-lime btn-sm', onclick: () => { close(); openDraft(d); Sfx.play('pop'); } }, 'Open'),
            h('button', { class: 'btn btn-ghost btn-sm', title: 'More', onclick: (e) => UI.menu(e.currentTarget, [
              { label: '✏️ Rename', onClick: async () => { const n = await ask('✏️ Rename draft', null, { input: d.level.name, ok: 'Rename' }); if (n && n.trim()) { d.level.name = n.trim().slice(0, L.name); d.name = d.level.name; putDraft(d); if (cur) { ed.meta.name = d.level.name; nameIn.value = d.level.name; } draw(); } } },
              { label: '⧉ Duplicate', onClick: () => { const c = { ...JSON.parse(JSON.stringify(d)), id: newId(), updated: Date.now(), verified: null, replay: null, posted: null }; c.level.name = (d.level.name + ' copy').slice(0, L.name); putDraft(c); draw(); } },
              { label: '🗑️ Delete', danger: true, onClick: async () => {
                if (!await ask(`Delete “${d.level.name}”?`, 'This draft is only saved in this browser, so it can’t be undone.', { ok: 'Delete', danger: true })) return;
                saveDrafts(drafts().filter((x) => x.id !== d.id));
                if (cur) { ed.draft = null; openDraft(currentDraft()); }
                draw();
              } }]) }, '⋯')));
      }));
    };
    draw();
    close = UI.modal(h('div', {},
      h('h2', {}, '📁 Your drafts'),
      h('p', { class: 'muted small' }, 'Drafts are saved in this browser. Use a share code to move one to another device.'),
      list,
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '14px' } },
        h('button', { class: 'btn btn-pink', onclick: () => { close(); newDraft(blank('New level')); } }, '✨ New empty level'),
        h('button', { class: 'btn btn-cyan', onclick: () => {
          close();
          const lv = C.levelFromBuilt(C.buildLevel(Math.floor(Math.random() * 2 ** 31), PA.rand(['easy', 'normal', 'hard']), 'short'), { name: 'Remix level' });
          newDraft(lv);
        } }, '🎲 Start from a random level'))), { wide: true });
  }
  function newDraft(level) {
    saveNow();
    const d = { id: newId(), name: level.name, updated: Date.now(), level };
    putDraft(d);
    openDraft(d);
    ed.camX = ed.tx = -3;
    Sfx.play('pop');
  }

  function openSettings() {
    const name = h('input', { class: 'input', maxlength: L.name, value: ed.meta.name });
    const desc = h('textarea', { class: 'input', maxlength: L.desc, rows: 2, placeholder: 'Optional' }, ed.meta.desc);
    const len = h('input', { class: 'input', type: 'number', min: L.len[0], max: L.len[1], value: ed.len });
    let theme = ed.meta.theme;
    const themes = h('div', { class: 'theme-pick' });
    const drawThemes = () => fill(themes, THEME_NAMES.map(([id, label]) => {
      const t = C.THEMES[id];
      return h('button', { type: 'button', class: 'theme-opt' + (id === theme ? ' on' : ''), onclick: () => { theme = id; drawThemes(); }, style: { '--a': t.top, '--b': t.bottom, '--l': t.line } },
        h('span', { class: 'sw' }), label);
    }));
    drawThemes();
    const music = h('input', { type: 'checkbox', checked: ed.meta.music !== false });
    const close = UI.modal(h('form', { class: 'ed-form', onsubmit: (e) => {
      e.preventDefault();
      const n = clamp(Math.round(Number(len.value) || ed.len), L.len[0], L.len[1]);
      const furthest = Math.max(0, ...[...ed.cells.keys()].map((k) => Math.floor(k / 16) + 1), ...ed.zones.map((z) => z[1] + z[2]));
      if (n < furthest) { UI.toast(`Some objects are past block ${n}. Move or delete them first (or make it ${furthest}+).`, 'bad', 4000); return; }
      const lenChanged = n !== ed.len;
      if (lenChanged) remember();
      Object.assign(ed.meta, { name: name.value.trim().slice(0, L.name) || 'My level', desc: desc.value.trim().slice(0, L.desc), theme, music: music.checked });
      ed.len = n;
      nameIn.value = ed.meta.name;
      refreshIcons();
      changed(lenChanged);
      saveNow();
      close();
    } },
    h('h2', {}, '⚙️ Level settings'),
    h('label', { class: 'field' }, `Name (up to ${L.name})`, name),
    h('label', { class: 'field' }, `Description (up to ${L.desc})`, desc),
    h('div', { class: 'field' }, 'Colours', themes),
    h('label', { class: 'field' }, `Length in blocks (${L.len[0]}–${L.len[1]})`, len),
    h('label', { class: 'switch', style: { marginTop: '6px' } }, music, '🎵 Music'),
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px', gap: '8px' } },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn btn-pink', type: 'submit' }, 'Save'))));
  }

  function openCode() {
    saveNow();
    const code = C.encodeLevel(levelData());
    const out = h('textarea', { class: 'input mono code-box', readonly: true, rows: 3 }, code);
    const inp = h('textarea', { class: 'input mono code-box', rows: 3, placeholder: 'Paste a level code (ND1.…)' });
    const err = h('p', { class: 'acct-err' });
    const close = UI.modal(h('div', {},
      h('h2', {}, '🔗 Share code'),
      h('p', { class: 'muted small' }, 'Send this code to a friend: they can open your level in their editor, even before you post it.'),
      out,
      h('div', { class: 'row', style: { gap: '8px', margin: '8px 0 18px' } }, h('button', { class: 'btn btn-cyan btn-sm', onclick: () => UI.copy(code, 'Level code copied! 📋') }, '📋 Copy code'), h('span', { class: 'tiny faint' }, `${code.length.toLocaleString('en-US')} characters`)),
      h('div', { class: 'setting-label' }, 'Open a code'),
      inp, err,
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } },
        h('button', { class: 'btn btn-pink', onclick: () => {
          try { const lv = C.decodeLevel(inp.value); close(); newDraft(lv); UI.toast(`📥 Opened “${lv.name}” as a new draft`, 'good'); } catch (e) { err.textContent = e.message; }
        } }, '📥 Open as a new draft'))), { wide: true });
    setTimeout(() => out.select(), 60);
  }

  // ====================================================================
  // Community levels
  // ====================================================================
  const comm = { tab: 'browse', sort: 'new', q: '', levels: [], more: false, offset: 0, busy: false };
  const commRoot = $('#community');
  const cbest = () => store.get('dash_cbest', {});
  function saveBest(id, patch) { const all = cbest(); all[id] = { ...(all[id] || {}), ...patch }; store.set('dash_cbest', all); }

  /** A mini picture of a level's start (cards, post dialog, admin queue). */
  function drawStrip(cvs, pv, now = 0) {
    const r = cvs.getBoundingClientRect();
    const w = Math.max(1, r.width || 300), hh = Math.max(1, r.height || 70);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(hh * dpr);
    const c = cvs.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const th = C.THEMES[pv.theme] || C.THEMES.normal;
    const g = c.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, th.top); g.addColorStop(1, th.bottom);
    c.fillStyle = g; c.fillRect(0, 0, w, hh);
    // skip the empty run-up, and zoom so the tallest thing in view still fits
    const objs = pv.o || [];
    const first = Math.min(...objs.map((o) => o[1]), ...(pv.z || []).map((z) => z[1]), 1e9);
    const x0 = first < 1e9 ? Math.max(-1.5, first - 3) : -1.5;
    let rows = 6;
    for (let k = 0; k < 2; k++) {
      const span = w / (hh / (rows + 0.9));
      const tall = Math.max(0, ...objs.filter((o) => o[1] >= x0 && o[1] <= x0 + span).map((o) => o[2] + 1), ...(pv.z || []).filter((z) => z[1] <= x0 + span && z[1] + z[2] >= x0).map((z) => z[3]));
      rows = clamp(tall + 1.5, 4, 9);
    }
    const S = hh / (rows + 0.9);
    const fy = hh - S * 0.9;
    const sxx = (x) => (x - x0) * S, syy = (y) => fy - y * S;
    const lv = C.compileLevel({ len: pv.len || 200, theme: pv.theme, objs: pv.o || [], zones: pv.z || [] });
    Art.on(c, () => {
      for (const sec of lv.sections) Art.tunnel(sec, sxx, syy, S, th, now);
      Art.objects(lv.cols, Math.floor(x0) - 1, Math.ceil(x0 + w / S) + 1, sxx, syy, S, th, 0, null);
    });
    c.fillStyle = th.ground; c.fillRect(0, fy, w, hh - fy);
    c.fillStyle = th.line; c.fillRect(0, fy - 1, w, 2);
  }

  function statusChip(st) {
    const map = { pending: ['⏳ Pending', 'pending'], approved: ['✅ Approved', 'approved'], rejected: ['❌ Rejected', 'rejected'], unlisted: ['🙈 Unlisted', 'unlisted'] };
    const [label, cls] = map[st] || [st, ''];
    return h('span', { class: 'st-chip ' + cls }, label);
  }

  function renderCommunity() {
    const tabs = [['browse', '🌐 ', 'Community levels', 'Levels'], ['mine', '📮 ', 'My levels', 'Mine']];
    fill(commRoot, h('div', { class: 'comm' },
      h('div', { class: 'comm-head' },
        h('button', { class: 'icon-btn', title: 'Back', 'aria-label': 'Back', onclick: () => { G.showScreen('entry'); Lobby.showEntry(); history.replaceState(null, '', location.pathname); } }, PA.icon('arrow-left')),
        h('div', { class: 'comm-tabs', role: 'tablist' }, tabs.map(([id, e, long, short]) => h('button', { class: 'comm-tab' + (comm.tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(comm.tab === id), onclick: () => openCommunity(id) }, e, h('span', { class: 'tl' }, long), h('span', { class: 'ts' }, short)))),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-yellow btn-sm comm-edit', onclick: openEditor, title: 'Level editor' }, '🛠️', h('span', { class: 'l' }, ' Level editor'))),
      h('div', { id: 'comm-body' })));
    if (comm.tab === 'browse') renderBrowse(); else renderMine();
  }

  function openCommunity(tab = 'browse') {
    if (ed.open) saveNow();
    ed.open = false;
    comm.tab = tab;
    G.showScreen('community');
    $('#entry').classList.add('hidden');
    history.replaceState(null, '', location.pathname + '?community=' + tab);
    renderCommunity();
  }

  function renderBrowse() {
    const body = $('#comm-body');
    const search = h('input', { class: 'input', placeholder: '🔎 Search levels or creators…', value: comm.q, autocomplete: 'off', 'aria-label': 'Search' });
    let deb;
    search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { comm.q = search.value; loadBrowse(true); }, 300); });
    const sorts = h('div', { class: 'seg' });
    const drawSorts = () => fill(sorts, [['new', '🆕 Newest'], ['plays', '🔥 Most played'], ['likes', '👍 Top liked']].map(([v, label]) => h('button', { class: v === comm.sort ? 'on' : '', type: 'button', onclick: () => { comm.sort = v; drawSorts(); loadBrowse(true); } }, label)));
    drawSorts();
    fill(body,
      h('div', { class: 'comm-bar' }, sorts, search),
      h('div', { class: 'lvl-grid', id: 'lvl-grid' }),
      h('div', { class: 'center', style: { marginTop: '16px' }, id: 'lvl-more' }));
    loadBrowse(true);
  }

  async function loadBrowse(reset) {
    if (reset) { comm.offset = 0; comm.levels = []; fill($('#lvl-grid'), h('div', { class: 'lvl-empty' }, h('span', { class: 'spin' }, '🌀'), ' Loading…')); }
    const want = { sort: comm.sort, q: comm.q, offset: comm.offset };
    let r;
    try { r = await Net.request('dash:list', want); } catch (e) { fill($('#lvl-grid'), h('div', { class: 'lvl-empty' }, e.message)); return; }
    if (want.sort !== comm.sort || want.q !== comm.q || !$('#lvl-grid')) return;
    comm.levels = reset ? r.levels : comm.levels.concat(r.levels);
    comm.offset = comm.levels.length;
    comm.more = r.more;
    const grid = $('#lvl-grid');
    if (reset) fill(grid);
    if (!comm.levels.length) {
      fill(grid, h('div', { class: 'lvl-empty' }, h('div', { class: 'big-e' }, comm.q ? '🔎' : '🏗️'),
        h('p', {}, comm.q ? 'No levels match that.' : 'No community levels yet. Build one and be the first!'),
        h('button', { class: 'btn btn-yellow', onclick: openEditor }, '🛠️ Open the level editor')));
    } else {
      const cards = r.levels.map(levelCard);
      grid.append(...cards);
      requestAnimationFrame(() => cards.forEach((c) => c._draw && c._draw()));
      if (FX.list) FX.list(cards, { y: 20, stagger: 0.04, duration: 0.4 });
    }
    fill($('#lvl-more'), comm.more ? h('button', { class: 'btn btn-ghost', onclick: () => loadBrowse(false) }, 'Load more') : null);
  }

  function levelCard(l) {
    const strip = h('canvas', { class: 'lvl-strip' });
    const best = cbest()[l.id];
    const likeBtn = h('button', { class: 'btn btn-ghost btn-sm like' + (l.liked ? ' on' : ''), title: l.liked ? 'You like this' : 'Like', onclick: () => like(l, likeBtn) }, `👍 ${l.likes}`);
    const card = h('article', { class: 'lvl-card' },
      h('div', { class: 'lvl-strip-wrap', onclick: () => playCommunity(l.id) }, strip, h('span', { class: 'lvl-play' }, '▶')),
      h('div', { class: 'lvl-body' },
        h('div', { class: 'lvl-name', title: l.name }, l.name),
        h('div', { class: 'lvl-by' }, UI.avatar({ ...l.by, name: l.by.name }, 'sm'), h('a', { href: '/profile?u=' + encodeURIComponent(l.by.name), class: 'muted' }, l.by.name)),
        l.desc ? h('p', { class: 'lvl-desc tiny muted' }, l.desc) : null,
        h('div', { class: 'lvl-meta tiny' },
          h('span', { title: 'Length' }, `⏱️ ${Math.round((l.preview.len || 0) / C.SPEED)}s`),
          h('span', { title: 'Plays' }, `▶ ${l.plays.toLocaleString('en-US')}`),
          best ? h('span', { class: 'lvl-best', title: 'Your best' }, best.time ? `🏆 ${fmtTime(best.time)}` : `Best ${Math.round((best.pct || 0) * 100)}%`) : null),
        h('div', { class: 'lvl-btns' },
          h('button', { class: 'btn btn-pink btn-sm', onclick: () => playCommunity(l.id) }, '▶ Play'),
          likeBtn,
          h('button', { class: 'btn btn-ghost btn-sm', title: 'More', 'aria-label': 'More', onclick: (e) => UI.menu(e.currentTarget, [
            { label: '🚩 Practice (checkpoints)', onClick: () => playCommunity(l.id, { practice: true }) },
            { label: '👀 Watch the creator’s run', onClick: () => playCommunity(l.id, { watch: true }) },
            { label: '🔗 Copy link', onClick: () => UI.copy(`${location.origin}/games/dash?level=${l.id}`, 'Link copied! 📋') },
          ]) }, '⋯'))));
    card._draw = () => drawStrip(strip, l.preview, 0);
    return card;
  }

  async function like(l, el) {
    if (!Account.user) { needAccount('Make a free account to like levels and post your own.'); return; }
    try {
      const r = await Net.request('dash:like', { id: l.id, on: !l.liked });
      l.liked = r.liked; l.likes = r.likes;
      el.textContent = `👍 ${l.likes}`;
      el.classList.toggle('on', l.liked);
      if (l.liked) { Sfx.play('pop'); if (FX.on) FX.gsap.fromTo(el, { scale: 1.3 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }); }
    } catch (e) { UI.toast(e.message, 'bad'); }
  }

  async function renderMine() {
    const body = $('#comm-body');
    if (!Account.user) {
      fill(body, h('div', { class: 'lvl-empty' }, h('div', { class: 'big-e' }, '📮'), h('p', {}, 'Log in to post levels and see them here.'),
        h('button', { class: 'btn btn-pink', onclick: () => UI.accountModal({ view: 'login' }) }, '🔑 Log in')));
      return;
    }
    fill(body, h('div', { class: 'lvl-empty' }, h('span', { class: 'spin' }, '🌀'), ' Loading…'));
    let r;
    try { r = await Net.request('dash:mine'); } catch (e) { fill(body, h('div', { class: 'lvl-empty' }, e.message)); return; }
    if (comm.tab !== 'mine' || !$('#comm-body')) return;
    const quota = r.admin ? 'You’re an admin: no daily limit.' : r.left ? `You can post ${r.limit} levels a day: ${r.left} left today.` : `You’ve posted ${r.limit} levels today. You can post again in ${waitText(r.wait)}.`;
    fill(body,
      h('div', { class: 'mine-quota' }, h('span', { class: 'e' }, '📮'), h('span', { class: 'txt' }, quota), h('button', { class: 'btn btn-yellow btn-sm', onclick: openEditor }, '🛠️ Build a level')),
      r.levels.length ? h('div', { class: 'mine-list' }, r.levels.map((l) => {
        const strip = h('canvas', { class: 'mine-strip' });
        requestAnimationFrame(() => drawStrip(strip, l.preview, 0));
        return h('div', { class: 'mine-row' },
          strip,
          h('div', { class: 'grow' },
            h('div', { class: 'row wrap', style: { gap: '8px' } }, h('b', {}, l.name), statusChip(l.status)),
            h('div', { class: 'tiny muted' }, `Posted ${UI.timeAgo(l.created)}` + (l.status === 'approved' ? ` · ▶ ${l.plays} plays · 👍 ${l.likes}` : '')),
            l.reason ? h('div', { class: 'small reason' }, `Admin: “${l.reason}”`) : null,
            l.status === 'pending' ? h('div', { class: 'tiny faint' }, 'Waiting for an admin to check it. Only you and admins can see it.') : null),
          h('div', { class: 'mine-btns' },
            h('button', { class: 'btn btn-pink btn-sm', onclick: () => playCommunity(l.id, { own: true }) }, '▶ Play'),
            h('button', { class: 'btn btn-ghost btn-sm', title: 'More', onclick: (e) => UI.menu(e.currentTarget, [
              { label: '🛠️ Open a copy in the editor', onClick: async () => {
                try { const { level } = await Net.request('dash:get', { id: l.id }); newDraft({ ...level.data, name: (level.data.name + ' v2').slice(0, L.name) }); openEditor(); } catch (ex) { UI.toast(ex.message, 'bad'); }
              } },
              l.status === 'approved' ? { label: '🔗 Copy link', onClick: () => UI.copy(`${location.origin}/games/dash?level=${l.id}`, 'Link copied! 📋') } : null,
              '-',
              { label: '🗑️ Delete', danger: true, onClick: async () => {
                if (!await ask(`Delete “${l.name}”?`, `It disappears for everyone, and still counts toward today’s ${r.limit} posts.`, { ok: 'Delete', danger: true })) return;
                try { await Net.request('dash:delete', { id: l.id }); UI.toast('Level deleted', 'good'); renderMine(); } catch (ex) { UI.toast(ex.message, 'bad'); }
              } }]) }, '⋯')));
      })) : h('div', { class: 'lvl-empty' }, h('div', { class: 'big-e' }, '🏗️'), h('p', {}, 'You haven’t posted any levels yet. Build one, verify it, and post it!')));
  }

  /** Play a community level (or your own pending one) with the real game. */
  async function playCommunity(id, { practice = false, watch = false, own = false, back = 'community' } = {}) {
    let level;
    try { ({ level } = await Net.request('dash:get', { id })); } catch (e) { UI.toast(e.message, 'bad'); return; }
    const data = level.data;
    if (watch && !level.replay) { UI.toast('There’s no recorded run for this level.', 'bad'); return; }
    if (!watch && !own && level.status === 'approved') Net.request('dash:play', { id }).catch(() => {});
    const goBack = () => { if (back === 'community') openCommunity(comm.tab); else G.showScreen('entry'); };
    G.startSession({
      mode: watch ? 'replay' : 'community', custom: data, music: data.music, checkpoints: practice, countdown: watch ? 0 : 0,
      replay: watch ? level.replay : null, noRespawn: watch, levelId: id,
      onQuit: goBack,
      onDeath: (g) => {
        if (watch) { G.banner(h('span', { class: 'big' }, '💥'), `The run crashed at ${Math.round(g.player.x / g.level.end * 100)}%`); return; }
        if (!practice && g.best) { const b = cbest()[id]; if (!b || (b.pct || 0) < g.best) saveBest(id, { pct: g.best }); }
      },
      onDone: (g) => {
        if (watch) { G.banner(h('span', { class: 'big' }, '🏁 Done!'), `${level.by.name}’s verify run`); return; }
        communityResults(g, level, practice, goBack);
      },
    });
    G.banner(h('span', { class: 'big' }, watch ? '👀 Replay' : practice ? '🚩 Practice' : '🌐 ' + data.name), watch ? `${level.by.name}’s verify run` : `by ${level.by.name}`);
    setTimeout(() => { const g = G.game; if (g && g.levelId === id && !g.finished) G.hideBanner(); }, 1800);
  }

  function communityResults(g, level, practice, goBack) {
    const id = level.id;
    const prev = cbest()[id] || {};
    const isBest = !practice && (!prev.time || g.finishMs < prev.time);
    if (!practice) saveBest(id, { pct: 1, time: isBest ? g.finishMs : prev.time, attempts: g.attempts });
    let liked = !!level.liked;
    const likeBtn = level.mine || level.status !== 'approved' ? null : h('button', { class: 'btn btn-ghost', onclick: async () => {
      if (!Account.user) { needAccount('Make a free account to like levels.'); return; }
      try { const r = await Net.request('dash:like', { id, on: true }); liked = r.liked; likeBtn.textContent = `👍 Liked (${r.likes})`; likeBtn.disabled = true; Sfx.play('pop'); } catch (e) { UI.toast(e.message, 'bad'); }
    } }, '👍 Like this level');
    const close = UI.modal(h('div', { class: 'center-col' },
      h('div', { class: 'big-e' }, isBest ? '🏆' : '🏁'),
      h('h2', {}, practice ? 'Practice complete!' : isBest ? 'New best!' : 'Level complete!'),
      h('div', { class: 'result-big gradient-text' }, fmtTime(g.finishMs)),
      h('p', { class: 'muted' }, `“${level.name}” by ${level.by.name} · ${g.attempts} attempt${g.attempts === 1 ? '' : 's'}` + (prev.time && !isBest ? ` · best ${fmtTime(prev.time)}` : '')),
      h('div', { class: 'col', style: { marginTop: '16px' } },
        h('button', { class: 'btn btn-pink btn-lg', onclick: () => { close(); playCommunity(id, { practice, own: level.mine }); } }, '🔁 Play again'),
        likeBtn,
        h('button', { class: 'btn btn-ghost', onclick: () => { close(); goBack(); } }, '🌐 More levels'))), { dismissable: false });
  }

  /** The race settings' level picker: resolves with a level card or null. */
  function pickLevel() {
    return new Promise((resolve) => {
      let picked = null;
      const search = h('input', { class: 'input', placeholder: '🔎 Search levels or creators…', autocomplete: 'off' });
      const list = h('div', { class: 'pick-list' });
      let deb;
      const load = async () => {
        fill(list, h('div', { class: 'lvl-empty' }, h('span', { class: 'spin' }, '🌀')));
        try {
          const r = await Net.request('dash:list', { q: search.value, sort: 'plays' });
          fill(list, r.levels.length ? r.levels.map((l) => {
            const strip = h('canvas', { class: 'pick-strip' });
            requestAnimationFrame(() => drawStrip(strip, l.preview, 0));
            return h('button', { class: 'pick-row', type: 'button', onclick: () => { picked = l; close(); } }, strip,
              h('div', { class: 'grow' }, h('b', {}, l.name), h('div', { class: 'tiny muted' }, `by ${l.by.name} · ${Math.round(l.preview.len / C.SPEED)}s · ▶ ${l.plays} · 👍 ${l.likes}`)));
          }) : h('p', { class: 'muted center' }, 'No levels found.'));
        } catch (e) { fill(list, h('p', { class: 'muted' }, e.message)); }
      };
      search.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(load, 300); });
      const close = UI.modal(h('div', {}, h('h2', {}, '🌐 Race a community level'), search, list), { wide: true, onClose: () => resolve(picked) });
      load();
      setTimeout(() => search.focus(), 80);
    });
  }

  // ====================================================================
  // Hooking into the Neon Dash page
  // ====================================================================
  window.DashEditor = { pickLevel, open: openEditor, community: openCommunity, drawStrip };
  if (location.hostname === 'localhost') window.__dashEd = { ed, levelData, cellToScreen: (x, y) => { const r = cv.getBoundingClientRect(); return [r.left + sx(x + 0.5), r.top + sy(y + 0.5)]; } };   // for testing on your own computer only

  // entry screen + practice screen buttons
  const entryActions = $('#entry .actions');
  if (entryActions) {
    const solo = entryActions.querySelector('.btn-cyan');
    const row = h('div', { class: 'ed-entry-row' },
      h('button', { class: 'btn btn-yellow btn-block', onclick: openEditor }, '🛠️ Level editor'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => openCommunity('browse') }, '🌐 Community levels'));
    if (solo) solo.after(row); else entryActions.prepend(row);
  }
  const soloCard = $('#solo .solo-card');
  if (soloCard) soloCard.append(h('div', { class: 'ed-entry-row', style: { marginTop: '18px' } },
    h('button', { class: 'btn btn-yellow btn-block', onclick: openEditor }, '🛠️ Level editor'),
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => openCommunity('browse') }, '🌐 Community levels')));

  // live updates when an admin reviews one of your levels (core.js shows the toast)
  Net.on('dash:reviewed', () => { if (comm.tab === 'mine' && !commRoot.classList.contains('hidden')) renderMine(); });
  on('account', () => { if (!commRoot.classList.contains('hidden')) renderCommunity(); });

  // ?editor=1  ?community=browse|mine  ?level=ID  ?test=ID  ?replay=ID (the admin's preview)
  (async () => {
    const want = ['editor', 'community', 'level', 'test', 'replay'].find((k) => params.get(k));
    if (!want) return;
    $('#entry').classList.add('hidden');
    if (want === 'editor') { openEditor(); return; }
    if (want === 'community') { openCommunity(params.get('community') === 'mine' ? 'mine' : 'browse'); return; }
    await Account.ready();
    const id = params.get(want);
    if (want === 'level') { openCommunity('browse'); playCommunity(id); return; }
    const back = embed ? 'none' : 'community';
    if (want === 'test') playCommunity(id, { practice: params.get('cp') === '1', own: true, back });
    else playCommunity(id, { watch: true, back });
  })();
})();
