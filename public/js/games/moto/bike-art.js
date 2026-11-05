/* Revvd's painted artwork: canvases made into textures, and the Revvd wordmark that goes on bikes, kit and helmets. */
import * as THREE from 'three';

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

export const REVVD_HOT = '#ff7a1a';
export const lum = (c) => { const n = parseInt(c.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** [letters, outline] that stand out on a background colour. */
export const inkOn = (bg) => (lum(bg) > 0.55 ? ['#16181c', '#ffffff'] : ['#ffffff', '#16181c']);
/** The Revvd wordmark: italic REVVD (the two Vs in Revvd orange) over a slanted orange speed bar, outlined so it reads
    on any paint. (x, y) is the left end of the baseline (its middle when center); h is the font size. Returns its width. */
export function revvdLogo(g, x, y, h, ink = '#ffffff', edge = '#16181c', center = false) {
  g.save();
  g.font = `italic 900 ${h}px Kanit, Arial Black, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const bits = [['RE', ink], ['VV', REVVD_HOT], ['D', ink]];
  const w = bits.reduce((s, [t]) => s + g.measureText(t).width, 0);
  if (center) x -= w / 2;
  g.lineJoin = 'round'; g.lineWidth = h * 0.1; g.strokeStyle = edge;
  const bar = () => { g.beginPath(); g.moveTo(x + h * 0.02, y + h * 0.06); g.lineTo(x + w + h * 0.08, y + h * 0.06); g.lineTo(x + w - h * 0.02, y + h * 0.19); g.lineTo(x - h * 0.08, y + h * 0.19); g.closePath(); };
  bar(); g.stroke(); g.fillStyle = REVVD_HOT; g.fill();
  let cx = x; for (const [t] of bits) { g.strokeText(t, cx, y); cx += g.measureText(t).width; }
  cx = x; for (const [t, c] of bits) { g.fillStyle = c; g.fillText(t, cx, y); cx += g.measureText(t).width; }
  g.restore();
  return w;
}
