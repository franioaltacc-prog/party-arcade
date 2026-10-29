/* Home page: game cards, live counts, open rooms, lobby chat. */
(() => {
  'use strict';
  const { $, h, fill, Net, UI, Profile, Sfx } = PA;
  const FX = PA.FX || {};
  const G = FX.on ? FX.gsap : null;

  // ---------------------------------------------------------------- art
  const svg = (id, body, from, to) => `<svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="200" height="120" fill="url(#g-${id})"/>${body}</svg>`;
  const emoji = (x, y, size, e, extra = '') => {
    const url = PA.Emoji.url(e);
    const s = size * 1.15;
    return url ? `<image href="${url}" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" ${extra}/>`
      : `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" ${extra}>${e}</text>`;
  };

  const ART = {
    dash: svg('dash', `
      <g stroke="rgba(255,255,255,.08)">${[20, 50, 80].map((y) => `<path d="M0 ${y}h200"/>`).join('')}${[30, 70, 110, 150, 190].map((x) => `<path d="M${x} 0v92"/>`).join('')}</g>
      <rect y="92" width="200" height="28" fill="rgba(0,0,0,.35)"/><path d="M0 92h200" stroke="#f0abfc" stroke-width="2.5"/>
      <path d="M28 88 q 30 -62 64 -30" stroke="#fde047" stroke-dasharray="3 6" fill="none" stroke-width="2.5" stroke-linecap="round"/>
      <g transform="translate(78 40) rotate(28 13 13)"><rect width="26" height="26" rx="4" fill="#facc15" stroke="#fff" stroke-width="2.5"/><rect x="5" y="8" width="6" height="6" fill="#1e1b4b"/><rect x="15" y="8" width="6" height="6" fill="#1e1b4b"/><rect x="6" y="17" width="14" height="3" fill="#1e1b4b"/></g>
      <path d="M118 92l9-19 9 19zM136 92l9-19 9 19z" fill="#0f0a2e" stroke="#22d3ee" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="162" y="66" width="26" height="26" fill="#1e1b4b" stroke="#22d3ee" stroke-width="2.5"/>
      <circle cx="175" cy="38" r="9" fill="none" stroke="#fde047" stroke-width="3"/>`, '#2e1065', '#9333ea'),
    life: svg('life', `
      <circle cx="40" cy="62" r="24" fill="rgba(255,255,255,.18)"/><circle cx="100" cy="62" r="24" fill="rgba(255,255,255,.18)"/><circle cx="160" cy="62" r="24" fill="rgba(255,255,255,.18)"/>
      <path d="M66 62h8M126 62h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      ${emoji(40, 63, 28, '👶')}${emoji(100, 63, 28, '🧑‍🎓')}${emoji(160, 63, 28, '👵')}
      ${emoji(24, 22, 16, '💰')}${emoji(176, 20, 16, '💍')}${emoji(100, 104, 16, '🏆')}${emoji(62, 104, 14, '❤️')}${emoji(140, 104, 14, '🎓')}`, '#0e7490', '#16a34a'),
    doodle: svg('doodle', `
      <g transform="rotate(-5 100 60)"><rect x="34" y="14" width="132" height="92" rx="8" fill="#fff"/>
      <path d="M56 78 q 14 -34 30 -6 t 30 -10 t 26 6" stroke="#f43f5e" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M58 40 q 10 -14 22 0 q 10 14 22 0" stroke="#3b82f6" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="138" cy="40" r="11" fill="none" stroke="#facc15" stroke-width="5"/>
      <path d="M70 92h60" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 9"/></g>
      ${emoji(170, 92, 34, '✏️')}${emoji(26, 26, 18, '❓')}`, '#db2777', '#f97316'),
    blitz: svg('blitz', `
      <g fill="rgba(255,255,255,.14)">${Array.from({ length: 12 }, (_, i) => `<path d="M100 60 L${100 + 140 * Math.cos(i * Math.PI / 6)} ${60 + 140 * Math.sin(i * Math.PI / 6)} L${100 + 140 * Math.cos(i * Math.PI / 6 + 0.25)} ${60 + 140 * Math.sin(i * Math.PI / 6 + 0.25)}Z"/>`).join('')}</g>
      <circle cx="100" cy="60" r="34" fill="#fde047" stroke="#fff" stroke-width="4"/>${emoji(100, 62, 40, '⚡')}
      ${emoji(32, 30, 22, '🧮')}${emoji(168, 30, 22, '🎨')}${emoji(36, 94, 22, '👊')}${emoji(166, 92, 22, '🔍')}`, '#ea580c', '#facc15'),
    casino: svg('casino', `
      <ellipse cx="100" cy="66" rx="92" ry="46" fill="#14532d" stroke="#78350f" stroke-width="6"/>
      <g transform="translate(50 46) rotate(-12)"><rect width="30" height="42" rx="5" fill="#fff"/><text x="15" y="24" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">A♠</text></g>
      <g transform="translate(76 40) rotate(8)"><rect width="30" height="42" rx="5" fill="#fff"/><text x="15" y="24" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" fill="#dc2626" font-family="Fredoka, sans-serif">K♥</text></g>
      ${[[132, 78, '#3b82f6'], [146, 70, '#ef4444'], [138, 60, '#facc15'], [152, 54, '#16a34a']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="11" fill="${c}" stroke="#fff" stroke-width="3" stroke-dasharray="4 3"/>`).join('')}
      ${emoji(40, 24, 18, '🎰')}${emoji(168, 22, 18, '🪙')}${emoji(30, 100, 16, '🎲')}`, '#422006', '#a16207'),
    impostor: svg('imp', `
      <circle cx="100" cy="76" r="28" fill="none" stroke="#f43f5e" stroke-width="3" stroke-dasharray="5 5"/>
      ${[[45, '😎'], [100, '🕵️'], [155, '🤠']].map(([x, e]) => `<circle cx="${x}" cy="76" r="22" fill="rgba(255,255,255,.16)"/>${emoji(x, 77, 26, e)}`).join('')}
      ${[[45, '🍕'], [100, '❓'], [155, '🍕']].map(([x, e]) => `<rect x="${x - 17}" y="14" width="34" height="28" rx="10" fill="#fff"/><path d="M${x - 5} 41 l5 8 l5 -8z" fill="#fff"/>${emoji(x, 28, 16, e)}`).join('')}
      ${emoji(100, 110, 12, '🗳️ ? 🗳️')}`, '#4c0519', '#5b21b6'),
    mines: svg('mines', `
      <g transform="translate(46 10)">${Array.from({ length: 30 }, (_, k) => {
        const r = Math.floor(k / 6); const c = k % 6; const x = c * 18; const y = r * 20;
        const open = { 7: '1', 8: '1', 9: '2', 13: '1', 14: '', 15: '3', 19: '1', 20: '', 21: '2', 25: '', 26: '1' }[k];
        if (k === 16) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#7f1d1d"/>${emoji(x + 8, y + 10, 11, '💥')}`;
        if (k === 10 || k === 22) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#3d3480"/>${emoji(x + 8, y + 10, 10, '🚩')}`;
        if (open !== undefined) return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="rgba(255,255,255,.08)"/>${open ? `<text x="${x + 8}" y="${y + 10}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="800" fill="${{ 1: '#60a5fa', 2: '#4ade80', 3: '#f87171' }[open]}" font-family="Fredoka, sans-serif">${open}</text>` : ''}`;
        return `<rect x="${x}" y="${y}" width="16" height="18" rx="3" fill="#3d3480"/>`;
      }).join('')}</g>
      ${emoji(24, 30, 22, '💣')}${emoji(178, 92, 22, '😎')}`, '#0f172a', '#4338ca'),
    slope: svg('slope', `
      ${[0, 1, 2, 3, 4, 5].map((i) => { const y = 120 - i * 16; const s = 1 - i * 0.13; const w = 130 * s; const x = 100 - w / 2 + (i % 2 ? 6 : -6) * s;
        return `<polygon points="${x},${y} ${x + w},${y} ${x + w - 8 * s},${y - 15} ${x + 8 * s},${y - 15}" fill="#04140a" stroke="#39ff88" stroke-width="${2.5 * s}"/>`; }).join('')}
      <rect x="112" y="78" width="16" height="12" fill="#ff1144" stroke="#ff5577" stroke-width="2"/>
      <circle cx="92" cy="96" r="13" fill="#39ff88" stroke="#fff" stroke-width="2"/>
      <path d="M92 83 v26 M79 96 h26" stroke="rgba(0,0,0,.25)" stroke-width="2"/>
      ${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 53) % 200}" cy="${(i * 29) % 40 + 5}" r="1.2" fill="#88ffcc"/>`).join('')}`, '#02030a', '#06281a'),
    connect4: svg('c4', `
      <rect x="38" y="12" width="124" height="100" rx="12" fill="#2563eb" stroke="#1d4ed8" stroke-width="3"/>
      ${[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4, 5].map((c) => {
        const color = { '4,1': '#f43f5e', '4,2': '#facc15', '4,3': '#f43f5e', '3,2': '#f43f5e', '3,3': '#facc15', '2,3': '#f43f5e', '4,4': '#facc15', '3,4': '#facc15', '1,4': '#f43f5e', '2,4': '#facc15' }[`${r},${c}`] || '#0b0920';
        return `<circle cx="${55 + c * 18}" cy="${28 + r * 18}" r="7" fill="${color}"/>`;
      }).join('')).join('')}
      <circle cx="73" cy="6" r="7" fill="#facc15"/>`, '#1e3a8a', '#0ea5e9'),
    snake: svg('snake', `
      <g stroke="rgba(255,255,255,.07)">${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 18} 0v120"/>`).join('')}${Array.from({ length: 7 }, (_, i) => `<path d="M0 ${i * 18}h200"/>`).join('')}</g>
      <path d="M30 96 H90 V60 H142 V30" stroke="#a3e635" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="142" cy="30" r="9" fill="#bef264"/><circle cx="139" cy="27" r="2" fill="#111"/><circle cx="146" cy="27" r="2" fill="#111"/>
      ${emoji(172, 76, 22, '🍎')}`, '#052e16', '#166534'),
    '2048': svg('2048', `
      ${[['2', '#eee4da', '#776e65'], ['4', '#ede0c8', '#776e65'], ['8', '#f2b179', '#fff'], ['16', '#f59563', '#fff'], ['32', '#f67c5f', '#fff'], ['64', '#f65e3b', '#fff'], ['128', '#edcf72', '#fff'], ['2048', '#edc22e', '#fff']].map(([n, bg, fg], i) => {
        const x = 26 + (i % 4) * 38; const y = 22 + Math.floor(i / 4) * 40;
        return `<rect x="${x}" y="${y}" width="34" height="34" rx="6" fill="${bg}"/><text x="${x + 17}" y="${y + 18}" font-size="${n.length > 3 ? 10 : 14}" font-weight="800" fill="${fg}" text-anchor="middle" dominant-baseline="central" font-family="Fredoka, sans-serif">${n}</text>`;
      }).join('')}${emoji(182, 60, 20, '✨')}`, '#78350f', '#d97706'),
    memory: svg('memory', `
      <g transform="rotate(-10 60 62)"><rect x="34" y="28" width="50" height="68" rx="9" fill="#7c3aed" stroke="#fff" stroke-width="3"/><path d="M44 40h30M44 52h30M44 64h30M44 76h30M44 88h30" stroke="rgba(255,255,255,.3)" stroke-width="5"/></g>
      <rect x="76" y="22" width="50" height="68" rx="9" fill="#fff" stroke="#facc15" stroke-width="3"/>${emoji(101, 57, 30, '🦄')}
      <g transform="rotate(10 142 62)"><rect x="118" y="28" width="50" height="68" rx="9" fill="#fff" stroke="#facc15" stroke-width="3"/>${emoji(143, 63, 30, '🦄')}</g>`, '#4c1d95', '#c026d3'),
    'dash-solo': null,
    wheel: svg('wheel', `
      <g transform="translate(100 62)">${['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#fb923c'].map((c, i) => {
        const a1 = (i / 6) * Math.PI * 2; const a2 = ((i + 1) / 6) * Math.PI * 2;
        return `<path d="M0 0 L${46 * Math.cos(a1)} ${46 * Math.sin(a1)} A46 46 0 0 1 ${46 * Math.cos(a2)} ${46 * Math.sin(a2)} Z" fill="${c}"/>`;
      }).join('')}<circle r="46" fill="none" stroke="#fff" stroke-width="4"/><circle r="9" fill="#fff"/></g>
      <path d="M100 6 l-9 -2 9 22 9 -22z" fill="#fff"/>${emoji(30, 30, 18, '🎉')}${emoji(172, 96, 18, '🤔')}`, '#0f766e', '#4f46e5'),
    wyr: svg('wyr', `
      <rect width="100" height="120" fill="#e11d48"/><rect x="100" width="100" height="120" fill="#2563eb"/>
      ${emoji(50, 54, 34, '🦖')}${emoji(150, 54, 34, '🦄')}
      <circle cx="100" cy="60" r="20" fill="#fff"/><text x="100" y="61" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">OR</text>
      <text x="50" y="100" text-anchor="middle" font-size="12" font-weight="700" fill="rgba(255,255,255,.85)" font-family="Fredoka, sans-serif">54%</text>
      <text x="150" y="100" text-anchor="middle" font-size="12" font-weight="700" fill="rgba(255,255,255,.85)" font-family="Fredoka, sans-serif">46%</text>`, '#e11d48', '#2563eb'),
    eightball: svg('8ball', `
      ${Array.from({ length: 18 }, () => `<circle cx="${Math.random() * 200}" cy="${Math.random() * 120}" r="${Math.random() * 1.6 + 0.4}" fill="#fff" opacity="${Math.random() * 0.7 + 0.2}"/>`).join('')}
      <circle cx="100" cy="60" r="44" fill="#111"/><circle cx="86" cy="44" r="16" fill="rgba(255,255,255,.12)"/>
      <circle cx="100" cy="60" r="18" fill="#fff"/><text x="100" y="61" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="#111" font-family="Fredoka, sans-serif">8</text>`, '#1e1b4b', '#312e81'),
  };
  ART.front = svg('front', `
      <path d="M18 72 C26 42 66 30 94 44 C122 24 162 30 182 56 C192 82 162 102 122 96 C92 110 50 106 30 94 Z" fill="#2f5a3c"/>
      <path d="M18 72 C26 42 66 30 94 44 L100 70 C80 90 50 102 30 94 Z" fill="#ff4fd8" opacity=".6" stroke="#ff9be9" stroke-width="1.5"/>
      <path d="M94 44 C122 24 162 30 182 56 L150 76 L100 70 Z" fill="#22d3ee" opacity=".6" stroke="#7ff0ff" stroke-width="1.5"/>
      <path d="M100 70 L150 76 L182 56 C192 82 162 102 122 96 C102 100 94 90 100 70 Z" fill="#facc15" opacity=".6" stroke="#fde68a" stroke-width="1.5"/>
      ${emoji(58, 70, 20, '🏙️')}${emoji(140, 50, 18, '🚀')}${emoji(132, 84, 17, '🛡️')}${emoji(176, 104, 16, '⛵')}${emoji(80, 26, 18, '☢️')}`, '#0b1a3a', '#123068');
  ART.prophunt = svg('prophunt', `
      <rect x="0" y="52" width="200" height="22" fill="#2a2a44"/><path d="M0 63h200" stroke="#facc15" stroke-width="2" stroke-dasharray="10 9"/>
      <rect x="14" y="8" width="70" height="40" rx="4" fill="#ff4fd8" stroke="#ffd0f4" stroke-width="2"/><path d="M14 28h70" stroke="rgba(0,0,0,.25)" stroke-width="3"/>
      <rect x="120" y="82" width="66" height="34" rx="4" fill="#3b2f5c" stroke="#e2d9ff" stroke-width="3"/>
      ${emoji(140, 100, 16, '🛋️')}${emoji(168, 99, 13, '🪴')}
      ${emoji(112, 26, 22, '🌳')}${emoji(150, 30, 18, '🛢️')}${emoji(36, 96, 18, '📦')}${emoji(70, 100, 18, '🛢️')}
      <path d="M100 63 L156 33" stroke="#f43f5e" stroke-width="2" stroke-dasharray="4 4" opacity=".9"/>
      <circle cx="100" cy="63" r="11" fill="#f43f5e" stroke="#fff" stroke-width="2.5"/>${emoji(100, 63, 12, '😈')}
      <circle cx="70" cy="100" r="22" fill="none" stroke="#f43f5e" stroke-width="2" opacity=".55"/>`, '#14281f', '#1d3b2f');
  ART.poly = svg('poly', `
      <polygon points="0,120 200,120 200,70 0,90" fill="#1f6f43"/><polygon points="0,90 60,60 120,80 200,50 200,70 0,95" fill="#2f8f55"/>
      <polygon points="40,120 160,120 120,48 92,48" fill="#3a3f55"/><polygon points="96,48 116,48 132,80 82,80" fill="#454b66"/>
      <path d="M100 52 L104 70 M106 84 L112 108" stroke="#fff" stroke-width="3" stroke-dasharray="6 6"/>
      <polygon points="88,48 92,48 50,120 40,120" fill="#ef4444"/><polygon points="116,48 120,48 160,120 150,120" fill="#ef4444"/>
      <g transform="translate(100 96)"><polygon points="-16,10 16,10 14,-4 8,-10 -8,-10 -14,-4" fill="#ff4fd8"/><polygon points="-8,-10 8,-10 6,-16 -6,-16" fill="#22d3ee"/>
      <rect x="-18" y="4" width="6" height="8" fill="#111"/><rect x="12" y="4" width="6" height="8" fill="#111"/></g>
      ${emoji(170, 26, 18, '🏁')}${emoji(30, 28, 16, '⚡')}`, '#0ea5e9', '#7dd3fc');
  ART['poly-solo'] = ART.poly.replaceAll('g-poly', 'g-poly2').replace('#0ea5e9', '#f59e0b').replace('#7dd3fc', '#fde68a');
  ART['front-solo'] = ART.front.replaceAll('g-front', 'g-front2').replace('#0b1a3a', '#1e1b4b').replace('#123068', '#0f766e');
  ART['mines-solo'] = ART.mines.replaceAll('g-mines', 'g-mines2').replace('#0f172a', '#14532d').replace('#4338ca', '#0d9488');
  ART['dash-solo'] = ART.dash.replaceAll('g-dash', 'g-dash2').replace('#2e1065', '#082f49').replace('#9333ea', '#0891b2');

  // Billiards: a little pool table seen from above, the rack waiting and the cue lined up on the break
  const poolArt = (id, felt, feltDark, from, to, extra = '') => {
    const ball = (x, y, c, stripe, n) => {
      const r = 5.4; const k = r * 0.866;
      return `<ellipse cx="${x + 1.6}" cy="${y + 2.2}" rx="${r}" ry="${r * 0.8}" fill="rgba(0,0,0,.35)"/>` + (stripe
        ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><path d="M${x - k} ${y - r / 2}A${r} ${r} 0 0 1 ${x + k} ${y - r / 2}Z M${x + k} ${y + r / 2}A${r} ${r} 0 0 1 ${x - k} ${y + r / 2}Z" fill="#f8fafc"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`)
        + (n ? `<circle cx="${x}" cy="${y}" r="2.3" fill="#fff"/>` : '')
        + `<circle cx="${x - 1.7}" cy="${y - 1.9}" r="1.6" fill="rgba(255,255,255,.75)"/>`;
    };
    const rack = [['#facc15', 0, 1], ['#2563eb', 1, 1], ['#dc2626', 1, 0], ['#7c3aed', 0, 0], ['#111827', 0, 1], ['#f97316', 1, 0], ['#16a34a', 0, 1],
      ['#7f1d1d', 1, 1], ['#facc15', 1, 0], ['#2563eb', 0, 0]];
    let i = 0; let balls = '';
    for (let row = 0; row < 4; row++) {
      for (let j = 0; j <= row; j++) {
        const [c, stripe, n] = rack[i++];
        balls += ball(128 + row * 9.4, 58 + (j - row / 2) * 10.9, c, stripe, n);
      }
    }
    const pockets = [[23, 25], [100, 23], [177, 25], [177, 95], [100, 97], [23, 95]];
    const diamonds = [42, 61, 80, 120, 139, 158].flatMap((x) => [[x, 17.5], [x, 102.5]]).concat([[15.5, 42], [15.5, 60], [15.5, 78], [184.5, 42], [184.5, 60], [184.5, 78]]);
    return svg(id, `
      <defs><radialGradient id="felt-${id}" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="${felt}"/><stop offset="1" stop-color="${feltDark}"/></radialGradient>
      <linearGradient id="wood-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5228"/><stop offset=".5" stop-color="#5b3418"/><stop offset="1" stop-color="#3a1f0d"/></linearGradient>
      <radialGradient id="cue-${id}" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cbd5e1"/></radialGradient></defs>
      <rect x="8" y="10" width="184" height="100" rx="13" fill="rgba(0,0,0,.35)" transform="translate(2 4)"/>
      <rect x="8" y="10" width="184" height="100" rx="13" fill="url(#wood-${id})" stroke="#24120a" stroke-width="1.5"/>
      <rect x="10.5" y="12.5" width="179" height="95" rx="11" fill="none" stroke="rgba(255,226,180,.28)" stroke-width="1.2"/>
      <rect x="21" y="23" width="158" height="74" rx="3" fill="url(#felt-${id})" stroke="rgba(0,0,0,.45)" stroke-width="2"/>
      <path d="M60.5 25v70" stroke="rgba(255,255,255,.12)" stroke-width="1"/><circle cx="139.5" cy="60" r="1.1" fill="rgba(255,255,255,.3)"/>
      ${diamonds.map(([x, y]) => `<path d="M${x} ${y - 1.6}l1.3 1.6 -1.3 1.6 -1.3 -1.6z" fill="#f5f0e1" opacity=".9"/>`).join('')}
      ${pockets.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.4" fill="#c9a46a"/><circle cx="${x}" cy="${y}" r="5.2" fill="#050505"/>`).join('')}
      <path d="M63.2 70 L117.4 60" stroke="rgba(255,255,255,.55)" stroke-width="1" stroke-dasharray="2.5 2.5"/>
      <circle cx="117.4" cy="60" r="5.4" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1" stroke-dasharray="1.6 1.6"/>
      ${balls}
      <ellipse cx="59.6" cy="73.4" rx="5.4" ry="4.3" fill="rgba(0,0,0,.35)"/><circle cx="58" cy="71" r="5.4" fill="url(#cue-${id})"/>
      <path d="M50.6 72.2 L47.6 72.7" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M47.6 72.7 L44.2 73.2" stroke="#f8fafc" stroke-width="2.9"/>
      <path d="M44.2 73.2 L4 79.3" stroke="#e9c98f" stroke-width="3.1"/>
      <path d="M4 79.3 L-30 84.5" stroke="#3a1a08" stroke-width="4.4"/>${extra}`, from, to);
  };
  ART.billiards = poolArt('billiards', '#0f8a4a', '#065f35', '#0b3d2e', '#14532d');
  ART['billiards-solo'] = poolArt('billiards2', '#1f6fd1', '#123f8a', '#0c1d4a', '#1e3a8a', emoji(186, 12, 13, '⏱️'));
  // Neon Flappy: a synthwave night, glowing pipes and a cute bird (the online card adds ghost birds)
  const flappyArt = (id, from, to, ghosts, extra = '') => {
    const glow = (d, col, w = 2.2) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w * 3.2}" opacity=".22" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round"/>`;
    const pipe = (x, top, bot, col) => `<rect x="${x}" y="-2" width="22" height="${top + 2}" fill="rgba(8,3,28,.62)"/><rect x="${x}" y="${bot}" width="22" height="${96 - bot}" fill="rgba(8,3,28,.62)"/>
      ${glow(`M${x} -2V${top - 9}M${x + 22} -2V${top - 9}M${x - 3} ${top - 9}h28v9h-28z`, col)}${glow(`M${x} 96V${bot + 9}M${x + 22} 96V${bot + 9}M${x - 3} ${bot}h28v9h-28z`, col)}`;
    const bird = (x, y, rot, s, a, body = '#ffd23f', wing = '#ffb21e', line = '#a85400') => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" opacity="${a}">
      <circle r="11.5" fill="${body}" stroke="${line}" stroke-width="1.6"/><ellipse cx="-1" cy="5" rx="7.5" ry="4.6" fill="#fff3c4" opacity=".9"/>
      <path d="M-11 1q-8-10 3-9q6 3-3 9z" fill="${wing}" stroke="${line}" stroke-width="1.3" stroke-linejoin="round"/>
      <circle cx="4.5" cy="-3.5" r="4.6" fill="#fff" stroke="${line}" stroke-width="1"/><circle cx="6" cy="-3.3" r="2.2" fill="#1e1b4b"/><circle cx="6.7" cy="-4.2" r=".8" fill="#fff"/>
      <path d="M9 0.5l9 3-9 3.2z" fill="#ff7b29" stroke="${line}" stroke-width="1" stroke-linejoin="round"/><circle cx="1.5" cy="3.4" r="2" fill="#fb7185" opacity=".55"/></g>`;
    const stars = [[14, 12], [36, 30], [58, 8], [92, 22], [118, 10], [136, 34], [176, 14], [194, 40], [8, 48], [104, 44]];
    const towers = [[0, 66, 16], [14, 58, 14], [30, 72, 18], [96, 62, 14], [112, 70, 20], [168, 60, 16], [184, 68, 18]];
    return svg(id, `
      <defs><linearGradient id="sun-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde047"/><stop offset=".55" stop-color="#fb923c"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient></defs>
      ${stars.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.7 : 1.1}" fill="#fff" opacity="${i % 2 ? 0.5 : 0.85}"/>`).join('')}
      <circle cx="150" cy="84" r="30" fill="url(#sun-${id})" opacity=".95"/>
      ${[70, 77, 83, 88, 92].map((y, i) => `<rect x="118" y="${y}" width="64" height="${1.4 + i * 0.6}" fill="${from}"/>`).join('')}
      ${towers.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${96 - y}" fill="rgba(12,6,40,.88)"/><path d="M${x} ${y}h${w}" stroke="#a78bfa" stroke-width="1" opacity=".7"/>`).join('')}
      ${towers.map(([x, y, w], i) => `<rect x="${x + 4}" y="${y + 6}" width="2.2" height="2.2" fill="${i % 2 ? '#22d3ee' : '#fde68a'}" opacity=".8"/><rect x="${x + w - 7}" y="${y + 14}" width="2.2" height="2.2" fill="#fde68a" opacity=".7"/>`).join('')}
      ${pipe(70, 30, 74, '#22d3ee')}${pipe(150, 42, 84, '#ff4fd8')}
      <rect y="96" width="200" height="24" fill="#12062e"/>
      <g stroke="#ff4fd8" stroke-width=".9" opacity=".55">${[-60, -20, 20, 60, 100, 140, 180, 220, 260].map((x) => `<path d="M${(x + 100) / 2} 96L${x} 120"/>`).join('')}<path d="M0 104h200M0 112h200"/></g>
      ${glow('M0 96h200', '#ff4fd8', 1.8)}
      <path d="M8 74 q 14 -26 34 -16" stroke="#fde047" stroke-width="2.4" stroke-dasharray="1 5.5" stroke-linecap="round" fill="none" opacity=".9"/>
      ${ghosts ? `${bird(22, 36, -12, 0.82, 0.45, '#ece9ff', '#d9d3ff', '#7c6fd6')}${bird(36, 86, 18, 0.82, 0.45, '#a7b4c6', '#7c8aa0', '#2c3644')}` : ''}
      <circle cx="50" cy="56" r="20" fill="#facc15" opacity=".16"/>
      ${bird(50, 56, -14, 1.15, 1)}
      ${extra}`, from, to);
  };
  ART.flappy = flappyArt('flappy', '#1e0b4b', '#7e22ce', true);
  ART['flappy-solo'] = flappyArt('flappy2', '#0b1a4b', '#be185d', false, emoji(186, 14, 14, '🥇'));
  // Mini Golf: a little green with wooden rails, a windmill and a waving flag (online adds friends' balls,
  // solo is Spooky Hollow by moonlight)
  const golfArt = (id, from, to, night, extra = '') => {
    const turf = night ? ['#2f7a52', '#286a47'] : ['#4fc06a', '#45b05f'];
    const rail = night ? '#5b5570' : '#c98a4b'; const railTop = night ? '#857ea0' : '#e9b57a';
    const stripes = [0, 1, 2, 3, 4, 5].map((i) => `<path d="M${38 + i * 22} 104 L${62 + i * 18} 46 L${71 + i * 18} 46 L${49 + i * 22} 104z" fill="${turf[i % 2]}"/>`).join('');
    const ball = (x, y, c, r = 4.2, a = 1) => `<g opacity="${a}"><ellipse cx="${x + 1.2}" cy="${y + r * 0.85}" rx="${r}" ry="${r * 0.42}" fill="rgba(0,0,0,.3)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/><circle cx="${x - r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff" opacity=".7"/></g>`;
    return svg(id, `
      ${night ? `<circle cx="168" cy="22" r="11" fill="#fef3c7"/><circle cx="173" cy="19" r="9.5" fill="${from}"/>
        ${[[20, 14], [48, 26], [92, 10], [128, 30], [190, 46], [8, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#fff" opacity=".8"/>`).join('')}
        <path d="M120 20q4-4 8 0q4-4 8 0q-4 1-8 4q-4-3-8-4z" fill="#1e1236"/><path d="M60 34q3-3 6 0q3-3 6 0q-3 1-6 3q-3-2-6-3z" fill="#1e1236"/>`
        : `<circle cx="172" cy="20" r="12" fill="#fde68a" opacity=".95"/><ellipse cx="40" cy="22" rx="20" ry="6" fill="#fff" opacity=".7"/><ellipse cx="120" cy="14" rx="16" ry="5" fill="#fff" opacity=".55"/>`}
      <path d="M0 62 Q50 44 100 56 T200 52 V120 H0z" fill="${night ? '#1d3b33' : '#7cc96b'}"/>
      <path d="M0 78 Q60 62 120 74 T200 70 V120 H0z" fill="${night ? '#183128' : '#5fb35a'}"/>
      ${night ? `<path d="M14 80l4-14 4 14z" fill="#3c3552"/><rect x="11" y="78" width="14" height="4" rx="1" fill="#2b2540"/><circle cx="186" cy="88" r="6" fill="#f97316"/><path d="M183 87l1.5-1.5 1.5 1.5M187 87l1.5-1.5 1.5 1.5M183.5 90q2.5 2 5 0" stroke="#3b1500" stroke-width=".9" fill="none"/><circle cx="186" cy="88" r="10" fill="#fb923c" opacity=".18"/>`
        : `<circle cx="16" cy="74" r="9" fill="#2f8f4e"/><circle cx="24" cy="70" r="7" fill="#3aa25a"/><rect x="18" y="78" width="3" height="8" fill="#7c4a24"/><circle cx="186" cy="80" r="8" fill="#2f8f4e"/><rect x="185" y="84" width="3" height="7" fill="#7c4a24"/>`}
      <path d="M34 108 L60 44 L150 44 L172 108z" fill="rgba(0,0,0,.28)" transform="translate(2 3)"/>
      <path d="M36 104 L62 46 L148 46 L168 104z" fill="${turf[0]}"/>${stripes}
      <path d="M36 104 L62 46 L148 46 L168 104z" fill="none" stroke="${rail}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M36 104 L62 46 L148 46 L168 104z" fill="none" stroke="${railTop}" stroke-width="1.6" stroke-linejoin="round" transform="translate(0 -1.6)"/>
      <ellipse cx="118" cy="58" rx="6" ry="2.6" fill="#0b1a10"/><ellipse cx="118" cy="57.4" rx="6" ry="2.2" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".6"/>
      <path d="M118 58 V28" stroke="#e5e7eb" stroke-width="1.4"/>
      <path d="M118 28 q8 2 15 0 q-3 4 0 9 q-7 2 -15 0z" fill="${night ? '#a855f7' : '#ef4444'}"/>
      <g transform="translate(78 64)">
        <path d="M-7 18 L-4 -6 L4 -6 L7 18z" fill="${night ? '#3b3350' : '#f1e3c8'}" stroke="rgba(0,0,0,.3)" stroke-width=".8"/>
        <path d="M-6 -6 L0 -14 L6 -6z" fill="${night ? '#2a2340' : '#b91c1c'}"/>
        <rect x="-2.6" y="10" width="5.2" height="8" rx="2.6" fill="#1f2937"/>
        <g transform="translate(0 -4) rotate(18)" fill="${night ? '#1e1236' : '#fafafa'}" stroke="rgba(0,0,0,.35)" stroke-width=".6">
          <path d="M0 0 L-3 -20 L3 -20z"/><path d="M0 0 L20 -3 L20 3z"/><path d="M0 0 L3 20 L-3 20z"/><path d="M0 0 L-20 3 L-20 -3z"/></g>
        <circle cy="-4" r="1.8" fill="#78350f"/>
      </g>
      <path d="M108 94 Q114 80 117 62" stroke="#fff" stroke-width="1.6" stroke-dasharray="1 4" stroke-linecap="round" fill="none" opacity=".9"/>
      ${ball(106, 97, '#ffffff', 4.6)}
      ${extra}`, from, to);
  };
  ART.golf = golfArt('golf', '#38bdf8', '#bae6fd', false,
    `<circle cx="132" cy="80" r="3.6" fill="#ff4fd8" opacity=".7" stroke="rgba(0,0,0,.25)" stroke-width=".6"/><circle cx="148" cy="92" r="3.6" fill="#facc15" opacity=".7" stroke="rgba(0,0,0,.25)" stroke-width=".6"/><circle cx="92" cy="84" r="3.6" fill="#22d3ee" opacity=".7" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`);
  ART['golf-solo'] = golfArt('golf2', '#0f0a24', '#3b1d5e', true, emoji(186, 14, 14, '🏆'));

  // Song Rush: a spinning record, an equalizer and headphones
  ART.songs = svg('songs', `
      <circle cx="62" cy="62" r="70" fill="#ff4fd8" opacity=".12"/>
      <g class="sr-disc"><circle cx="62" cy="62" r="44" fill="#120a24"/>
      ${[40, 35, 30, 25, 20].map((r) => `<circle cx="62" cy="62" r="${r}" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="1.2"/>`).join('')}
      <path d="M30 40 A40 40 0 0 1 62 22" stroke="rgba(255,255,255,.25)" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="62" cy="62" r="14" fill="#facc15"/><circle cx="62" cy="62" r="14" fill="url(#g-songs)" opacity=".55"/><circle cx="62" cy="62" r="2.6" fill="#120a24"/></g>
      <path d="M118 14 L118 22 L96 58" stroke="#e5e7eb" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="118" cy="14" r="5" fill="#9ca3af"/><rect x="90" y="54" width="10" height="7" rx="2" transform="rotate(-30 95 58)" fill="#e5e7eb"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => { const hgt = [22, 40, 30, 52, 34, 46, 26][i]; return `<rect x="${120 + i * 10}" y="${108 - hgt}" width="7" height="${hgt}" rx="3" fill="${['#22d3ee', '#a3e635', '#facc15', '#ff4fd8', '#a855f7', '#22d3ee', '#a3e635'][i]}" opacity=".9"/>`; }).join('')}
      <path d="M114 108h82" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
      ${emoji(160, 42, 26, '🎧')}${emoji(128, 44, 12, '🎵')}${emoji(188, 60, 12, '🎶')}${emoji(22, 100, 13, '❓')}`, '#3b0764', '#db2777');

  // Screen Volley: two laptops side by side, the ball flying from one screen to the other
  const laptop = (x, c) => `<g transform="translate(${x} 34)"><rect x="0" y="0" width="74" height="48" rx="4" fill="#0f0a24" stroke="#cbd5e1" stroke-width="3"/>
      <rect x="4" y="4" width="66" height="40" fill="url(#g-volley)" opacity=".55"/><path d="M4 42h66" stroke="${c}" stroke-width="2"/>
      <path d="M-8 52h90l-6 6h-78z" fill="#cbd5e1"/></g>`;
  ART.volley = svg('volley', `
      <circle cx="100" cy="64" r="58" fill="#facc15" opacity=".1"/>
      ${laptop(22, '#ff4fd8')}${laptop(104, '#22d3ee')}
      <rect x="93" y="58" width="3" height="18" fill="#fff" opacity=".8"/><rect x="104" y="58" width="3" height="18" fill="#fff" opacity=".8"/>
      <path d="M58 64 Q 100 6 142 56" stroke="#fde047" stroke-width="2.5" stroke-dasharray="2 6" stroke-linecap="round" fill="none"/>
      <circle cx="58" cy="66" r="6" fill="none" stroke="#ff4fd8" stroke-width="2.5"/>
      ${emoji(112, 22, 22, '🏐')}${emoji(166, 98, 14, '💥')}${emoji(20, 100, 13, '⚡')}`, '#1e1b4b', '#0e7490');

  // Revvd (motocross): a rider mid-backflip over a dirt double at dusk, dust behind the takeoff
  const dirtBike = (wheel, plastic) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="-17" cy="8" r="8.5" stroke="${wheel}" stroke-width="3.2" stroke-dasharray="2 1.4"/><circle cx="17" cy="8" r="8.5" stroke="${wheel}" stroke-width="3.2" stroke-dasharray="2 1.4"/>
      <path d="M-17 8 L-4 2 L8 2 M17 8 L10 -8 M8 2 L10 -8 M-4 2 L-2 -4" stroke="#e5e7eb" stroke-width="2"/>
      <path d="M-22 -4 Q-12 -9 0 -6 L10 -9 L16 -5 L6 -2 L-6 -1 Z" fill="${plastic}" stroke="${plastic}" stroke-width="1.5"/>
      <path d="M-6 -6 L-1 -16 L6 -20 M6 -20 L10 -10 M-1 -16 L4 -6" stroke="#f8fafc" stroke-width="3"/>
      <circle cx="7" cy="-24" r="4.6" fill="#fff" stroke="#fff"/><path d="M8 -24 h5" stroke="${plastic}" stroke-width="2.4"/></g>`;
  ART.moto = svg('moto', `
      <circle cx="152" cy="34" r="16" fill="#fde68a" opacity=".85"/><circle cx="152" cy="34" r="26" fill="#fde68a" opacity=".18"/>
      <path d="M0 78 L28 62 L48 70 L78 52 L104 66 L132 58 L160 68 L200 54 V120 H0Z" fill="#7c3a2d" opacity=".55"/>
      <path d="M0 96 Q 40 86 70 92 L84 72 Q 92 68 96 74 L100 92 Q 140 96 200 90 V120 H0Z" fill="#c2733f"/>
      <path d="M118 92 Q 132 74 150 80 Q 170 90 200 94 V120 H118Z" fill="#a85d33"/>
      <path d="M0 104 Q 60 98 120 104 T 200 102 V120 H0Z" fill="#8b4a28"/>
      <path d="M96 72 Q 114 30 146 58" stroke="#fde047" stroke-width="2" stroke-dasharray="2 5" fill="none" stroke-linecap="round"/>
      <g transform="translate(122 56) rotate(-30) scale(1.05)">${dirtBike('#111827', '#ef4444')}</g>
      ${[[88, 86, 7], [78, 90, 9], [66, 94, 6], [96, 90, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f5d0a9" opacity=".55"/>`).join('')}
      <path d="M16 70 v-22 l14 5 l-14 5" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 48 l7 2.5 v5 l-7 -2.5z" fill="#111"/>
      ${emoji(176, 102, 13, '🏁')}${emoji(30, 104, 12, '💨')}`, '#4c1d95', '#f97316');
  ART['moto-solo'] = ART.moto.replaceAll('g-moto', 'g-moto2').replace('#4c1d95', '#0c4a6e').replace('#f97316', '#38bdf8').replace('#ef4444', '#facc15');

  // ---------------------------------------------------------------- the catalogue
  // One entry per game. modes: where each way of playing it starts (the first one is where the tile goes).
  // cats: the category chips it shows under. spot: a slide in the spotlight at the top.
  const GAMES = [
    { key: 'moto', title: 'Revvd', icon: '🏍️', tag: 'Realistic 3D dirt bikes: races, time trials, challenges, air tricks and eight huge free-ride worlds.', desc: 'Jump lava pits and canyons, pull Supermans, whips and backflips, collect coins in eight huge open worlds and buy faster engines, then take on downhill, big air and trick challenges with your friends.', players: '1–6', glow: 'rgba(249,115,22,.7)', isNew: true, cats: ['racing', 'sports'],
      modes: [['online', '/games/moto', '🌐 Race'], ['solo', '/games/moto?solo=1', '🏁 Trial'], ['solo', '/games/moto?free=1&world=redrock', '🗺️ Free ride']], spot: 'New: volcano world & lava jumps' },
    { key: 'songs', title: 'Song Rush', icon: '🎧', tag: 'A song starts… name it before everyone else! 60s to now, Disney and K-pop.', desc: 'Type the title and the artist, or pick from four. Hits from the 2020s back to the 60s, Disney, K-pop, party songs and spooky Halloween tunes.', players: '1–16', glow: 'rgba(236,72,153,.7)', isNew: true, cats: ['party'], modes: [['online', '/games/songs', '🌐 Play']], spot: 'Music quiz with friends' },
    { key: 'volley', title: 'Screen Volley', icon: '🏐', tag: 'Two laptops side by side: punch the ball from your screen onto your friend’s.', desc: 'Your cursor is your hand and fast reflexes win. No second laptop? Practice against the robot.', players: '2', glow: 'rgba(34,211,238,.7)', isNew: true, cats: ['sports', 'arcade'], modes: [['online', '/games/volley', '🌐 Play']] },
    { key: 'dash', title: 'Neon Dash', icon: '🟪', tag: 'A mini Geometry Dash: race friends through spikes, jump pads and orbs.', players: '1–12', glow: 'rgba(168,85,247,.7)', cats: ['racing', 'arcade'], modes: [['online', '/games/dash', '🌐 Race'], ['solo', '/games/dash?solo=1', '🕹️ Practice']] },
    { key: 'life', title: 'Family Life', icon: '🏡', tag: 'Multiplayer BitLife: be siblings, get one of 86 jobs, travel, prank each other.', desc: 'You and your friends are siblings in one family. Make friends, join clubs, get one of 86 jobs, travel the world, buy a submarine. Best life wins!', players: '1–4', glow: 'rgba(34,197,94,.6)', cats: ['party'], modes: [['online', '/games/life', '🌐 Play']] },
    { key: 'front', title: 'Front Wars', icon: '🌍', tag: 'Conquer the world: grab land, build cities, send boats and nukes.', desc: 'Grab land, build cities and ports, send boats across the sea and nuke your rivals. Play friends online or take on a world full of bots.', spot: 'World conquest', players: '1–8 + bots', glow: 'rgba(34,197,94,.6)', isNew: true, cats: ['brain'], modes: [['online', '/games/front', '🌐 Play'], ['solo', '/games/front?solo=1', '🤖 vs Bots']] },
    { key: 'poly', title: 'Poly Racer', icon: '🏎️', tag: 'Low-poly 3D racing with ramps, boost pads and ghost cars.', desc: 'Six tracks of ramps, boost pads and hairpins. Race your friends, or chase your own ghost for a medal time.', spot: '3D racing', players: '1–10', glow: 'rgba(14,165,233,.6)', isNew: true, cats: ['racing'], modes: [['online', '/games/poly', '🌐 Race'], ['solo', '/games/poly?solo=1', '🏁 Trial']] },
    { key: 'golf', title: 'Mini Golf', icon: '⛳', tag: '3D mini golf: six courses plus random ones that are new every time. Lowest score wins.', desc: 'Windmills, a haunted house, ice rinks, lava, crabs and mine carts. Or make a random course and share its code with friends.', players: '1–8', glow: 'rgba(74,222,128,.6)', isNew: true, cats: ['sports'], modes: [['online', '/games/golf', '🌐 Play'], ['solo', '/games/golf?solo=1', '🕹️ Solo']], spot: 'Seven courses + random ones' },
    { key: 'billiards', title: 'Billiards', icon: '🎱', tag: '8-ball or 9-ball with real physics: spin, banks and kisses. Winner stays on!', desc: 'Real pool physics with spin, banks and kisses. 8-ball or 9-ball against friends or the computer, and the winner stays on.', spot: 'Real-physics pool', players: '2 + watchers', glow: 'rgba(16,185,129,.6)', isNew: true, cats: ['sports'], modes: [['online', '/games/billiards', '🌐 Play'], ['solo', '/games/billiards?solo=1', '🤖 vs CPU']] },
    { key: 'prophunt', title: 'Prop Hunt', icon: '🔫', tag: 'Hide and seek with a killer: turn into a barrel or a couch and survive.', players: '2–10', glow: 'rgba(244,63,94,.6)', isNew: true, cats: ['party'], modes: [['online', '/games/prophunt', '🌐 Play']] },
    { key: 'impostor', title: 'Impostor', icon: '🕵️', tag: 'Everyone knows the secret word… except the impostor. Vote out the faker!', players: '3–10', glow: 'rgba(244,63,94,.6)', isNew: true, cats: ['party'], modes: [['online', '/games/impostor', '🌐 Play']] },
    { key: 'doodle', title: 'Doodle Guess', icon: '🎨', tag: 'One person draws, everyone guesses. Fast fingers win!', players: '2–12', glow: 'rgba(244,63,94,.6)', cats: ['party'], modes: [['online', '/games/doodle', '🌐 Play']] },
    { key: 'flappy', title: 'Flappy Royale', icon: '🐤', tag: 'Neon Flappy: everyone flies the same pipes at once. Last bird flying wins.', players: '1–12', glow: 'rgba(250,204,21,.6)', isNew: true, cats: ['arcade'], modes: [['online', '/games/flappy', '🌐 Royale'], ['solo', '/games/flappy?solo=1', '🕹️ Solo']] },
    { key: 'mines', title: 'Minesweeper', icon: '💣', tag: 'Race friends on the same board, battle on one shared board, or play classic.', players: '1–8', glow: 'rgba(99,102,241,.6)', isNew: true, cats: ['brain'], modes: [['online', '/games/mines', '🌐 Play'], ['solo', '/games/mines?solo=1', '🕹️ Classic']] },
    { key: 'blitz', title: 'Party Blitz', icon: '⚡', tag: 'Rapid-fire minigames: reaction, mashing, math, memory and more.', players: '1–12', glow: 'rgba(250,204,21,.6)', cats: ['party', 'arcade'], modes: [['online', '/games/blitz', '🌐 Play']] },
    { key: 'casino', title: 'Casino Night', icon: '🎰', tag: 'Fake-coin roulette, blackjack, slots, dice, poker and 1v1 duels.', players: '1–6', glow: 'rgba(251,191,36,.6)', cats: ['party'], modes: [['online', '/games/casino', '🌐 Play']] },
    { key: 'connect4', title: 'Connect 4', icon: '🔴', tag: 'The classic. Drop discs, get four in a row, talk trash in chat.', players: '2 + watchers', glow: 'rgba(59,130,246,.6)', cats: ['brain'], modes: [['online', '/games/connect4', '🌐 Play']] },
    { key: 'slope', title: 'Slope', icon: '🛝', tag: 'Roll down an endless neon slope. Dodge the red blocks, don’t fall off!', players: 'Solo', glow: 'rgba(34,211,238,.6)', isNew: true, cats: ['arcade'], modes: [['solo', '/games/slope', '🕹️ Play']] },
    { key: 'snake', title: 'Neon Snake', icon: '🐍', tag: 'Eat, grow, don’t bite yourself. Faster with every apple.', players: 'Solo', glow: 'rgba(163,230,53,.6)', cats: ['arcade'], modes: [['solo', '/games/snake', '🕹️ Play']] },
    { key: '2048', title: '2048', icon: '🔢', tag: 'Slide and merge tiles. Can you reach 2048?', players: 'Solo', glow: 'rgba(250,204,21,.6)', cats: ['brain'], modes: [['solo', '/games/2048', '🕹️ Play']] },
    { key: 'memory', title: 'Memory Flip', icon: '🃏', tag: 'Flip cards and find all the emoji pairs.', players: 'Solo', glow: 'rgba(168,85,247,.6)', cats: ['brain'], modes: [['solo', '/games/memory', '🕹️ Play']] },
    { key: 'wheel', title: 'Spin the Wheel', icon: '🎡', tag: 'Can’t decide? Let the wheel choose. Add your own options!', players: 'Toy', cats: ['toys'], modes: [['solo', '/games/wheel', '🎡 Spin']] },
    { key: 'wyr', title: 'Would You Rather', icon: '🤔', tag: 'Pick a side and see what everyone else chose.', players: 'Global votes', cats: ['toys', 'party'], modes: [['solo', '/games/wyr', '🤔 Vote']] },
    { key: 'eightball', title: 'Magic 8-Ball', icon: '🎱', tag: 'Ask a yes-or-no question. The ball knows all.', players: 'Toy', cats: ['toys'], modes: [['solo', '/games/eightball', '🔮 Ask']] },
  ];
  const CATS = [
    ['all', '🎮', 'All'], ['new', '✨', 'New'], ['online', '🌐', 'With friends'], ['solo', '🕹️', 'Solo'],
    ['racing', '🏁', 'Racing'], ['party', '🎉', 'Party'], ['sports', '⚽', 'Sports'], ['brain', '🧠', 'Strategy & puzzles'], ['arcade', '👾', 'Arcade'], ['toys', '🎈', 'Toys'],
  ];
  const inCat = (g, c) => c === 'all' || (c === 'new' ? g.isNew : c === 'online' || c === 'solo' ? g.modes.some((m) => m[0] === c) : g.cats.includes(c));
  const hrefOf = (g) => g.modes[0][1];
  // in-game pictures (tools/game_shots.py); the drawn card art is kept for any game without one
  const SHOTS = new Set(['moto', 'songs', 'volley', 'dash', 'life', 'front', 'poly', 'golf', 'billiards', 'prophunt', 'impostor', 'doodle', 'flappy', 'mines', 'blitz', 'casino', 'connect4', 'slope', 'snake', '2048', 'memory', 'wheel', 'wyr', 'eightball']);
  const shot = (key, big) => `/assets/shots/${key}${big ? '' : '-sm'}.webp`;
  const picture = (key, big, eager) => (SHOTS.has(key)
    ? h('img', { src: shot(key, big), alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' })
    : h('div', { html: art(key), style: { height: '100%' } }));
  const PLAY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11a.6.6 0 0 0 .9.5l9-5.5a.6.6 0 0 0 0-1l-9-5.5a.6.6 0 0 0-.9.5z"/></svg>';
  // (each copy of a card picture needs its own gradient ids, or a hidden copy breaks the visible one)
  let artN = 0;
  const art = (key) => { const n = ++artN; return (ART[key] || '').replace(/id="g-/g, `id="g${n}-`).replace(/url\(#g-/g, `url(#g${n}-`); };

  // recently played (this browser only)
  const recent = () => { const r = PA.store.get('pa_recent', []); return Array.isArray(r) ? r : []; };
  const remember = (key) => PA.store.set('pa_recent', [key, ...recent().filter((k) => k !== key)].slice(0, 6));

  function tile(g) {
    const live = g.modes.some((m) => m[0] === 'online') ? h('span', { class: 't-live', 'data-live': g.key }, h('span', { class: 'n' }, '0'), ' playing') : null;
    const go = () => { remember(g.key); Sfx.play('pop'); };
    return h('article', { class: 'tile', 'data-key': g.key, style: g.glow ? { '--glow': g.glow } : null },
      h('a', { class: 't-main', href: hrefOf(g), title: g.desc || g.tag, onclick: go },
        h('div', { class: 't-art' }, picture(g.key),
          h('span', { class: 't-badges' }, g.isNew ? h('span', { class: 't-new' }, 'NEW') : null, live),
          h('span', { class: 't-play', html: PLAY + ' Play' })),
        h('div', { class: 't-body' },
          h('div', { class: 't-title' }, h('span', { class: 'ic' }, g.icon), g.title, h('span', { class: 'pl' }, g.players)),
          h('div', { class: 't-tag' }, g.tag))),
      g.modes.length > 1
        ? h('div', { class: 't-foot' }, g.modes.map(([kind, href, label]) => h('a', { class: 't-mode ' + kind, href, onclick: go }, label.replace(/^\S+\s/, ''))))
        : null);
  }
  const tilesEl = $('#tiles');
  const tiles = GAMES.map(tile);
  tilesEl.append(...tiles);
  $('#stat-games').textContent = GAMES.length;
  if (G) FX.count($('#stat-games'), GAMES.length, { from: 0, duration: 1.6 });

  // category chips and search
  let cat = PA.store.get('pa_cat', 'all');
  if (!CATS.some((c) => c[0] === cat)) cat = 'all';
  const chipsEl = $('#chips');
  const chips = CATS.map(([id, , label]) => h('button', { class: 'chip', type: 'button', role: 'tab', 'data-cat': id, onclick: () => { Sfx.play('click'); cat = id; PA.store.set('pa_cat', id); apply(true); } },
    label, h('span', { class: 'n' }, GAMES.filter((g) => inCat(g, id)).length)));
  chipsEl.append(...chips);
  const search = $('#search');
  const words = (g) => [g.title, g.tag, g.desc || '', ...g.cats, g.players].join(' ').toLowerCase();
  function apply(animate) {
    const q = search.value.trim().toLowerCase();
    const state = animate && FX.flipState ? FX.flipState(tiles.filter((t) => !t.hidden)) : null;
    let shown = 0;
    GAMES.forEach((g, i) => {
      const ok = (q ? q.split(/\s+/).every((w) => words(g).includes(w)) : inCat(g, cat));
      tiles[i].hidden = !ok; if (ok) shown++;
    });
    chips.forEach((c) => { const on = !q && c.dataset.cat === cat; c.classList.toggle('on', on); c.setAttribute('aria-selected', on); });
    $('#no-games').hidden = shown > 0;
    $('#cat-count').textContent = q ? `${shown} found` : `${shown} ${shown === 1 ? 'game' : 'games'}`;
    renderRecent(!q && cat === 'all');
    if (G && animate) G.set(tiles.filter((t) => !t.hidden && getComputedStyle(t).opacity === '0'), { autoAlpha: 1, y: 0, rotation: 0 });   // (not yet scrolled into view: just show them)
    if (state) FX.flipFrom(state, tiles.filter((t) => !t.hidden));
  }
  search.addEventListener('input', () => apply(false));
  addEventListener('keydown', (e) => {   // "/" jumps to the search box
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); search.focus(); }
  });
  function renderRecent(show) {
    const box = $('#recent');
    const list = recent().map((k) => GAMES.find((g) => g.key === k)).filter(Boolean);
    box.hidden = !show || !list.length;
    if (box.hidden) return;
    fill(box, h('div', { class: 'sec-label' }, h('h2', {}, 'Jump back in')),
      h('div', { class: 'recent-row' }, list.map((g) => h('a', { class: 'r-card', href: hrefOf(g), onclick: () => remember(g.key) }, picture(g.key), h('span', {}, `${g.icon} ${g.title}`)))));
  }
  chipsEl.querySelector('.chip.on, [data-cat="' + cat + '"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  apply(false);

  // ---------------------------------------------------------------- the featured games
  // A big in-game picture of one game at a time, with a picker of the others beside it (it moves on by itself).
  const spot = $('#spotlight'); const hero = $('#hero');
  const FEATURED = ['moto', 'poly', 'golf', 'billiards', 'front', 'songs'];
  const slidesData = FEATURED.map((k) => GAMES.find((g) => g.key === k)).filter((g) => g && g.spot);
  const DWELL = 7000;
  let cur = 0; let timer = null; let paused = false;
  const slides = slidesData.map((g, i) => h('div', { class: 'slide' + (i ? '' : ' on'), role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${slidesData.length}: ${g.title}` },
    picture(g.key, true, i === 0),
    h('div', { class: 's-body' },
      h('span', { class: 's-kicker' }, g.spot),
      h('div', { class: 's-title' }, g.title),
      h('p', { class: 's-desc' }, g.desc || g.tag),
      h('div', { class: 's-meta' }, h('span', { class: 'pill' }, `${g.players} players`),
        ...g.cats.slice(0, 2).map((c) => h('span', { class: 'pill' }, (CATS.find((x) => x[0] === c) || [, , c])[2])),
        g.modes.some((m) => m[0] === 'online') ? h('span', { class: 'pill live', 'data-live': g.key }, h('span', { class: 'n' }, '0'), ' playing now') : null),
      h('div', { class: 's-btns' },
        h('a', { class: 's-play', href: hrefOf(g), onclick: () => remember(g.key), html: PLAY + ' Play now' }),
        g.modes.slice(1).map(([, href, label]) => h('a', { class: 's-alt', href, onclick: () => remember(g.key) }, label.replace(/^\S+\s/, '')))))));
  const picks = slidesData.map((g, i) => h('button', { class: 'pick' + (i ? '' : ' on'), type: 'button', role: 'tab', 'aria-label': `Show ${g.title}`, onclick: () => { go(i); Sfx.play('click'); } },
    h('img', { src: shot(g.key), alt: '', loading: 'lazy', decoding: 'async' }),
    h('span', { class: 'tx' }, h('b', {}, g.title), h('small', {}, g.spot)), h('i', { class: 'bar' })));
  hero.style.setProperty('--dwell', DWELL / 1000 + 's');
  spot.append(...slides, h('div', { class: 's-arrows' },
    h('button', { class: 's-arrow', type: 'button', 'aria-label': 'Previous', onclick: () => go(cur - 1) }, '‹'),
    h('button', { class: 's-arrow', type: 'button', 'aria-label': 'Next', onclick: () => go(cur + 1) }, '›')));
  $('#picker').append(...picks);
  function go(i) {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === cur));
    picks.forEach((d, k) => { d.classList.remove('on'); if (k === cur) { void d.offsetWidth; d.classList.add('on'); } });   // (restart the progress bar)
    if (innerWidth <= 1100) picks[cur].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    schedule();
  }
  function schedule() { clearTimeout(timer); if (!paused && slides.length > 1) timer = setTimeout(() => go(cur + 1), DWELL); }
  const pause = (on) => { paused = on; hero.classList.toggle('paused', on); if (on) clearTimeout(timer); else schedule(); };
  hero.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') pause(true); });
  hero.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') pause(false); });
  hero.addEventListener('focusin', () => pause(true));
  hero.addEventListener('focusout', () => pause(false));
  // swipe between slides on touch screens
  let sx = null;
  spot.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') sx = e.clientX; });
  spot.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 40) go(cur + (e.clientX < sx ? 1 : -1)); sx = null; });
  document.addEventListener('visibilitychange', () => pause(document.hidden));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) pause(true); else schedule();

  // ---------------------------------------------------------------- top bar
  UI.topbar({ back: false });

  // ---------------------------------------------------------------- live counts
  Net.on('online', (m) => {
    if (G) FX.count($('#stat-online'), m.count, { duration: 1.2 }); else $('#stat-online').textContent = m.count;
    document.querySelectorAll('[data-live]').forEach((el) => {
      const n = (m.games || {})[el.dataset.live] || 0;
      el.classList.toggle('on', n > 0);
      el.querySelector('.n').textContent = n;
    });
  });

  // ---------------------------------------------------------------- join by code
  const joinForm = $('#join-form');
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 4 && G) { UI.toast('Room codes have 4 characters 🔑', 'bad'); FX.shake($('#join-code')); return; }
    if (code.length !== 4) { UI.toast('Room codes have 4 characters 🔑', 'bad'); $('#join-code').classList.add('shake'); setTimeout(() => $('#join-code').classList.remove('shake'), 400); return; }
    Net.send('room:find', { code });
  });
  Net.on('room:found', (m) => {
    if (m.game) { Sfx.play('coin'); location.href = `/games/${m.game}?room=${m.code}`; }
    else { Sfx.play('wrong'); UI.toast(`No room called ${m.code} 🤔 Check the code!`, 'bad'); }
  });

  // ---------------------------------------------------------------- limited-time event
  // A small "🎃 Halloween quests: 3/8 · ends in 22 days →" strip linking to /quests (hide it for the day with ×).
  async function renderEvent() {
    const box = $('#event-banner');
    const [ev] = await PA.Unlocks.activeEvents();
    const today = new Date().toISOString().slice(0, 10);
    const hidden = PA.store.get('pa_ev_hide', null);
    if (!ev || (hidden && hidden.id === ev.id && hidden.day === today)) { box.classList.add('hidden'); return; }
    const d = await PA.Unlocks.load();
    const quests = PA.Unlocks.quests(d, ev.id);
    if (!quests.length) { box.classList.add('hidden'); return; }
    const u = PA.Account.user;
    let done = null;
    if (u) {
      try {
        const { profile } = await Net.request('profile:get', { name: u.name });
        const achs = PA.Unlocks.earned(d, profile.level, profile.stats || {});
        done = quests.filter((a) => achs.has(a.id)).length;
      } catch { /* offline */ }
    }
    const left = ev.daysLeft <= 1 ? 'ends today!' : `ends in ${ev.daysLeft} days`;
    box.classList.remove('hidden');
    fill(box,
      h('a', { class: 'evb-link', href: '/quests' },
        h('span', { class: 'evb-e' }, ev.emoji),
        h('span', { class: 'evb-t' }, h('b', {}, `${ev.name} quests`), done != null ? h('span', { class: 'evb-n' }, `${done}/${quests.length}`) : null,
          h('span', { class: 'evb-s' }, done != null && done >= quests.length ? '· theme unlocked 🎉' : `· ${left}`, done == null ? ' · win a spooky theme' : '')),
        h('span', { class: 'evb-go' }, '→')),
      h('button', { class: 'icon-btn evb-x', 'aria-label': 'Hide for today', title: 'Hide for today', onclick: () => { PA.store.set('pa_ev_hide', { id: ev.id, day: today }); box.classList.add('hidden'); } }, PA.icon('x')));
  }
  renderEvent();
  PA.on('auth', renderEvent);

  // ---------------------------------------------------------------- open rooms
  const roomsPanel = $('#rooms-panel');
  const seenRooms = new Set();
  function renderRooms(all, tours = []) {
    const rooms = all.filter((r) => !r.live);
    const live = all.filter((r) => r.live);
    if (G) { if (String(rooms.length) !== $('#stat-rooms').textContent) FX.count($('#stat-rooms'), rooms.length); }
    else $('#stat-rooms').textContent = rooms.length;
    const info = Lobby.GAME_INFO;
    const link = (r, watch) => `/games/${r.game}?room=${r.code}${watch ? '&watch=1' : ''}`;
    const item = (r) => h('div', { class: 'room-item', 'data-code': r.code + (r.live ? 'L' : '') },
      h('div', { class: 'ri-emoji' }, (info[r.game] || {}).emoji || '🎮'),
      h('div', { class: 'grow' },
        h('div', { class: 'ri-title' }, (info[r.game] || {}).title || r.game, r.party ? h('span', { class: 'ri-tag', title: 'Party mode' }, '🎉') : null, r.tour ? h('span', { class: 'ri-tag', title: 'Tournament match' }, '🏆') : null),
        h('div', { class: 'ri-sub' }, `${r.hostAvatar} ${r.host} · ${r.players}/${r.max}${r.watchers ? ` · 👀 ${r.watchers}` : ''} · ${r.code}`)),
      r.live || r.tour
        ? h('a', { class: 'btn btn-cyan btn-sm', href: link(r, true), title: r.tour ? 'A tournament match — watch it' : 'Watch this game' }, '👀 Watch')
        : r.players >= r.max
          ? h('a', { class: 'btn btn-ghost btn-sm', href: link(r, true), title: 'This room is full — you can watch' }, '👀 Full')
          : h('a', { class: 'btn btn-lime btn-sm', href: link(r) }, 'Join'));
    fill(roomsPanel,
      h('div', { class: 'panel-title' }, '🔥 Open rooms', h('span', { class: 'count' }, rooms.length ? `${rooms.length} open` : '')),
      rooms.length
        ? h('div', {}, rooms.map(item))
        : h('div', { class: 'empty' }, 'No open rooms yet.', h('br'), 'Start one and invite your friends! 🎈'),
      tours.length ? h('div', { class: 'panel-title live-title' }, '🏆 Tournaments') : null,
      tours.length ? h('div', {}, tours.map((t) => h('div', { class: 'room-item' },
        h('div', { class: 'ri-emoji' }, '🏆'),
        h('div', { class: 'grow' }, h('div', { class: 'ri-title' }, `${t.title} tournament`),
          h('div', { class: 'ri-sub' }, t.champion ? `👑 ${t.champion} won! · ${t.players} players` : `${t.round} · ${t.players} players · by ${t.host}`)),
        h('a', { class: 'btn btn-yellow btn-sm', href: `/tournament?id=${t.id}` }, 'Bracket')))) : null,
      h('div', { class: 'panel-title live-title' }, '📺 Live games', h('span', { class: 'count' }, live.length ? `${live.length} playing` : '')),
      live.length
        ? h('div', {}, live.map(item))
        : h('div', { class: 'empty' }, 'Nobody is mid-game right now.', h('br'), 'Games being played show up here so you can watch 👀'),
    );
    if (!G) return;
    const fresh = [...roomsPanel.querySelectorAll('.room-item')].filter((el) => {
      const key = el.dataset.code;
      if (seenRooms.has(key)) return false;
      seenRooms.add(key);
      return true;
    });
    if (fresh.length) G.from(fresh, { x: 50, scale: 0.8, autoAlpha: 0, stagger: 0.08, duration: 0.6, ease: 'back.out(2)', clearProps: 'transform,opacity,visibility' });
  }
  renderRooms([]);
  Net.on('rooms:list', (m) => renderRooms(m.rooms, m.tours || []));
  const poll = () => { if (!document.hidden) Net.send('rooms:list'); };
  setInterval(poll, 4000);

  // ---------------------------------------------------------------- top players
  const topPanel = $('#top-panel');
  async function renderTop() {
    let board = null;
    try { board = (await Net.request('lb:get', { board: 'xp' })).board; } catch { /* accounts offline */ }
    const u = PA.Account.user;
    const rows = board ? board.rows.slice(0, 5) : [];
    fill(topPanel,
      h('div', { class: 'panel-title' }, '🌟 Top players', h('a', { class: 'count', href: '/leaderboards' }, 'All boards →')),
      h('a', { class: 'find-link', href: '/players' }, '🔎 Find a player…'),
      rows.length
        ? h('div', { class: 'top-list' }, rows.map((r) => h('a', { class: 'top-row' + (u && r.id === u.id ? ' me' : ''), href: '/profile?u=' + encodeURIComponent(r.name) },
          h('span', { class: 'rk' }, ['🥇', '🥈', '🥉'][r.rank - 1] || '#' + r.rank), PA.UI.avatar(r, 'sm'), h('span', { class: 'nm' }, r.name),
          h('span', { class: 'lvl' }, 'Lv ' + r.level))))
        : h('div', { class: 'empty' }, board ? 'No champions yet — be the first! 👑' : 'Leaderboards are taking a nap 😴'),
      u
        ? h('a', { class: 'top-me', href: '/profile?u=' + encodeURIComponent(u.name) }, PA.UI.xpBar(u))
        : h('button', { class: 'btn btn-pink btn-sm btn-block', style: { marginTop: '12px' }, onclick: () => PA.UI.accountModal({ view: 'choose' }) }, '✨ Sign up to save your stats'));
    if (G) FX.list(topPanel.querySelectorAll('.top-row'), { x: 30, y: 0, stagger: 0.06 });
  }
  PA.on('account', () => renderTop());
  setInterval(() => { if (!document.hidden) renderTop(); }, 60000);

  // ---------------------------------------------------------------- lobby chat
  const chat = Lobby.ChatBox($('#lobby-chat'), { title: '💬 Lobby chat', placeholder: 'Say hi to everyone…', room: false });
  Net.on('chat', (m) => { chat.add(m); if (m.from && m.from.id !== Net.id) Sfx.play('message'); });
  Net.on('chat:history', (m) => { chat.clear(); m.messages.forEach((x) => chat.add(x)); if (!m.messages.length) chat.add({ sys: true, placeholder: true, text: 'Be the first to say something! 👋' }); });
  Net.on('welcome', () => { Net.send('chat:history'); poll(); renderTop(); });

  // ---------------------------------------------------------------- motion
  if (G) {
    const tl = G.timeline({ defaults: { ease: 'power3.out' } });
    tl.from(spot, { y: 30, scale: 0.97, autoAlpha: 0, duration: 0.9, clearProps: 'transform,opacity,visibility' })
      .from(slides[0].querySelectorAll('.s-body > *'), { y: 26, autoAlpha: 0, stagger: 0.08, duration: 0.6, clearProps: 'transform,opacity,visibility' }, 0.25)
      .from(picks, { x: 30, autoAlpha: 0, stagger: 0.06, duration: 0.5, clearProps: 'transform,opacity,visibility' }, 0.3)
      .from('.quick', { y: 20, autoAlpha: 0, duration: 0.5, clearProps: 'transform,opacity,visibility' }, 0.5);
    G.from(chips, { y: 12, autoAlpha: 0, stagger: 0.03, duration: 0.4, delay: 0.5, clearProps: 'transform,opacity,visibility' });
    FX.reveal('.tile:not([hidden])', { y: 30 });
    G.from('.hub-side > *', { y: 30, autoAlpha: 0, stagger: 0.12, duration: 0.7, ease: 'power3.out', delay: 0.6, clearProps: 'transform,opacity,visibility' });
    FX.reveal('.footer', { y: 20 });
  }

  Net.connect();
  if (!Profile.isSet()) setTimeout(() => Profile.ensure(), 400);
})();
