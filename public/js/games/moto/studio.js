/* Photo mode and replays, for every vehicle.
   Photo mode (P, or 📷) freezes the ride where it is, hides the HUD and gives you a camera to fly round it: drag to look
   round, scroll (or pinch) to zoom, W A S D / arrows to move, Q E down and up; then save the picture as a PNG.
   Replays (V, or 🎬, and "Replay" when a challenge is over) play back the last minute of riding from TV-style cameras:
   one by the side of the track as you go past, a low chase, a slow orbit, from up high, and tracking alongside.
   Space pauses, ← → skip, C picks a camera (or back to switching), P takes a photo of it, Esc or V ends it.
   game.js keeps the recording (recorder) and draws the replay's rider; this file is the cameras and the controls. */
import * as THREE from 'three';

const REC_SECONDS = 60;
/** The last REC_SECONDS of a ride, one snapshot per frame drawn: add(t seconds, snapshot). */
export function recorder() {
  let frames = [];
  return {
    add(t, s) { frames.push({ t, s }); if (frames.length > 30 && frames[frames.length - 1].t - frames[0].t > REC_SECONDS) frames.splice(0, frames.length > 4000 ? 200 : 1); },
    clear() { frames = []; },
    /** A copy of what's recorded, starting at 0 seconds (null if there's hardly anything). */
    take() { if (frames.length < 20) return null; const t0 = frames[0].t; return frames.map((f) => ({ t: f.t - t0, s: f.s })); },
    get length() { return frames.length; },
  };
}

const CAMS = ['auto', 'trackside', 'chase', 'orbit', 'high', 'alongside'];
const CAM_NAMES = { auto: '🎬 Director', trackside: '📹 Trackside', chase: '🏍️ Low chase', orbit: '🔄 Orbit', high: '🚁 Helicopter', alongside: '🎥 Alongside' };
const v1 = new THREE.Vector3(); const v2 = new THREE.Vector3();

/** The studio: app is the game's root element (it gets .photo / .replay while they're on). ground(x, z): the height
    there. Everything else comes from the game when it calls in. */
export function createStudio({ app, camera, renderer, ground, onExit }) {
  const bar = document.createElement('div'); bar.className = 'mx-studio'; bar.hidden = true; app.appendChild(bar);
  const btn = (label, title, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b; };

  // ---------------------------------------------------------------- photo mode
  /** Photo filters (the 🎨 button or F): a CSS filter on the picture, and the same on the saved PNG. */
  const FILTERS = [['Natural', ''], ['Warm', 'sepia(.22) saturate(1.35) hue-rotate(-8deg) brightness(1.04)'], ['Cool', 'saturate(1.1) hue-rotate(12deg) brightness(1.02) contrast(1.05)'],
    ['B&W', 'grayscale(1) contrast(1.2)'], ['Vintage', 'sepia(.55) contrast(.9) brightness(1.08) saturate(.8)'], ['Punchy', 'saturate(1.6) contrast(1.18)']];
  let filter = 0;
  const setFilter = (i) => { filter = (i + FILTERS.length) % FILTERS.length; renderer.domElement.style.filter = photo ? FILTERS[filter][1] : ''; const b = bar.querySelector('.filt'); if (b) b.textContent = '🎨 ' + FILTERS[filter][0]; };
  let photo = null;   // { target, yaw, pitch, dist, fov, hide, scene, model, keys }
  function startPhoto(scene, model, at) {
    if (photo) return;
    const p = model.root.getWorldPosition(new THREE.Vector3()); p.y += 0.9;
    const d = v1.copy(camera.position).sub(p);
    photo = { scene, model, target: p, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-0.95, Math.min(0.95, d.y / (d.length() || 1)))), dist: Math.max(2, Math.min(12, d.length())), fov: camera.fov, hide: false, keys: {}, from: at };
    app.classList.add('photo');
    bar.replaceChildren();
    const tip = document.createElement('span'); tip.className = 'tip'; tip.textContent = '📷 Drag to look · scroll to zoom · W A S D to move · Q E down / up · F filter';
    const lens = document.createElement('input'); lens.type = 'range'; lens.min = '18'; lens.max = '95'; lens.value = String(Math.round(photo.fov)); lens.title = 'Lens (wide ↔ zoomed)'; lens.setAttribute('aria-label', 'Lens');
    lens.addEventListener('input', () => { photo.fov = 113 - +lens.value; });
    photo.fov = 113 - +lens.value;
    const hide = btn('🙈 Rider', 'Hide or show your rider', () => { photo.hide = !photo.hide; hide.classList.toggle('on', photo.hide); });
    const filt = btn('🎨 ' + FILTERS[filter][0], 'Change the filter (F)', () => setFilter(filter + 1)); filt.classList.add('filt');
    bar.append(tip, Object.assign(document.createElement('label'), { className: 'lens', textContent: '🔭' }), lens, hide, filt,
      btn('💾 Save picture', 'Save the picture (a PNG)', savePhoto), btn('✕ Done', 'Back to riding (P or Esc)', stopPhoto));
    bar.hidden = false; setFilter(filter);
  }
  function stopPhoto() {
    if (!photo) return;
    photo.model.root.visible = true;
    const back = photo.from; photo = null; app.classList.remove('photo'); renderer.domElement.style.filter = '';
    camera.fov = back ? back.fov : camera.fov; camera.updateProjectionMatrix();
    if (replay) drawReplayBar(); else { bar.hidden = true; onExit?.(); }
  }
  function photoCamera(dt) {
    const P = photo; const k = P.keys; const sp = (k.ShiftLeft || k.ShiftRight ? 14 : 5) * dt;
    const fx = -Math.sin(P.yaw); const fz = -Math.cos(P.yaw);
    if (k.KeyW || k.ArrowUp) P.target.add(v1.set(fx * sp, 0, fz * sp));
    if (k.KeyS || k.ArrowDown) P.target.add(v1.set(-fx * sp, 0, -fz * sp));
    if (k.KeyA || k.ArrowLeft) P.target.add(v1.set(fz * sp, 0, -fx * sp));
    if (k.KeyD || k.ArrowRight) P.target.add(v1.set(-fz * sp, 0, fx * sp));
    if (k.KeyQ) P.target.y -= sp; if (k.KeyE) P.target.y += sp;
    const cp = Math.cos(P.pitch);
    camera.position.set(P.target.x + Math.sin(P.yaw) * cp * P.dist, P.target.y + Math.sin(P.pitch) * P.dist, P.target.z + Math.cos(P.yaw) * cp * P.dist);
    const floor = ground(camera.position.x, camera.position.z) + 0.25;   // (not under the snow or the dirt)
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(P.target);
    if (Math.abs(camera.fov - P.fov) > 0.01) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
    P.model.root.visible = !P.hide;
  }
  function savePhoto() {
    if (!photo) return;
    photoCamera(0); renderer.render(photo.scene, camera);
    const a = document.createElement('a');
    let pic = renderer.domElement;
    if (FILTERS[filter][1]) {   // (the filter baked into the picture; where a browser can't, it saves without)
      const c = document.createElement('canvas'); c.width = pic.width; c.height = pic.height; const g = c.getContext('2d');
      if ('filter' in g) { g.filter = FILTERS[filter][1]; g.drawImage(pic, 0, 0); pic = c; }
    }
    a.href = pic.toDataURL('image/png');
    a.download = `revvd-photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    bar.querySelector('.tip').textContent = '✅ Saved to your downloads';
  }
  // dragging, zooming (mouse, touch and pinch)
  const pointers = new Map(); let pinch = 0;
  app.addEventListener('pointerdown', (e) => { if (!photo || bar.contains(e.target)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  addEventListener('pointermove', (e) => {
    if (!photo || !pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const after = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) photo.dist = Math.max(0.6, Math.min(60, photo.dist * before / (after || 1))); pinch = 1;
      return;
    }
    photo.yaw -= (e.clientX - p.x) * 0.006; photo.pitch = Math.max(-0.4, Math.min(1.45, photo.pitch + (e.clientY - p.y) * 0.005));
    p.x = e.clientX; p.y = e.clientY;
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
  addEventListener('pointerup', up); addEventListener('pointercancel', up);
  app.addEventListener('wheel', (e) => { if (!photo) return; e.preventDefault(); photo.dist = Math.max(0.6, Math.min(60, photo.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

  // ---------------------------------------------------------------- replays
  let replay = null;   // { frames, t, end, playing, cam, auto, shotAt, spot, orbit }
  function startReplay(frames) {
    if (!frames || replay) return false;
    replay = { frames, t: 0, end: frames[frames.length - 1].t, playing: true, cam: 'auto', shot: 'chase', shotAt: 0, spot: null, orbit: 0, fov: camera.fov, i: 0 };
    app.classList.add('replay');
    drawReplayBar();
    return true;
  }
  function stopReplay() {
    if (!replay) return;
    if (photo) stopPhoto();
    camera.fov = replay.fov; camera.updateProjectionMatrix();
    replay = null; app.classList.remove('replay'); bar.hidden = true; onExit?.();
  }
  let progress = null; let clock = null;
  function drawReplayBar() {
    bar.replaceChildren();
    const play = btn(replay.playing ? '⏸' : '▶', 'Pause / play (Space)', () => { replay.playing = !replay.playing; drawReplayBar(); });
    progress = document.createElement('input'); progress.type = 'range'; progress.min = '0'; progress.max = String(Math.round(replay.end * 10)); progress.value = String(Math.round(replay.t * 10)); progress.className = 'seek'; progress.setAttribute('aria-label', 'Replay position');
    progress.addEventListener('input', () => { replay.t = +progress.value / 10; replay.spot = null; });
    clock = document.createElement('span'); clock.className = 'tip';
    const cam = btn(CAM_NAMES[replay.cam], 'Change camera (C)', () => cycleCam());
    bar.append(Object.assign(document.createElement('b'), { className: 'rp', textContent: '● REPLAY' }), play, progress, clock, cam,
      btn('📷', 'Take a photo of this moment (P)', () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))), btn('✕ Done', 'Back to riding (Esc or V)', stopReplay));
    bar.hidden = false;
  }
  function cycleCam() { replay.cam = CAMS[(CAMS.indexOf(replay.cam) + 1) % CAMS.length]; replay.spot = null; drawReplayBar(); }
  /** The snapshot at the replay's time (blend: game.js's mix), and moves the clock on. */
  function replayStep(dt, blend) {
    const R = replay; const F = R.frames;
    if (R.playing) R.t += dt;
    if (R.t >= R.end) { R.t = R.end; R.playing = false; drawReplayBar(); }
    if (R.t < 0) R.t = 0;
    while (R.i > 0 && F[R.i].t > R.t) R.i--;
    while (R.i < F.length - 2 && F[R.i + 1].t <= R.t) R.i++;
    const a = F[R.i]; const b = F[Math.min(F.length - 1, R.i + 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (R.t - a.t) / (b.t - a.t))) : 0;
    const s = blend(a.s, b.s, k); s.roll = a.s.roll + ((b.s.roll || 0) - (a.s.roll || 0)) * k; s.st = a.s.st + ((b.s.st || 0) - (a.s.st || 0)) * k;
    if (progress && document.activeElement !== progress) progress.value = String(Math.round(R.t * 10));
    if (clock) clock.textContent = `${fmtT(R.t)} / ${fmtT(R.end)}`;
    return s;
  }
  const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  /** Point the camera at the rider (p: where they are, h: which way they're going, speed in m/s) for this shot. */
  function replayCamera(p, h, speed, dt) {
    const R = replay; let shot = R.cam;
    if (shot === 'auto') {
      R.shotAt -= dt;
      if (R.shotAt <= 0) { const pick = ['trackside', 'chase', 'orbit', 'high', 'alongside', 'trackside'].filter((x) => x !== R.shot); R.shot = pick[Math.floor(Math.random() * pick.length)]; R.shotAt = 3 + Math.random() * 2.5; R.spot = null; }
      shot = R.shot;
    }
    const fx = Math.cos(h); const fz = Math.sin(h);
    let fov = 50;
    if (shot === 'trackside') {
      // a camera on a tripod by the side of the track, a bit ahead; a new spot once you're well past it
      const ahead = R.spot ? (R.spot.x - p.x) * fx + (R.spot.z - p.z) * fz : 0;
      if (!R.spot || ahead < -18 || v1.set(R.spot.x - p.x, 0, R.spot.z - p.z).length() > 70) {
        const side = Math.random() < 0.5 ? -1 : 1; const d = 22 + speed * 0.6;
        const x = p.x + fx * d - fz * side * (7 + Math.random() * 5); const z = p.z + fz * d + fx * side * (7 + Math.random() * 5);
        R.spot = { x, z, y: Math.max(ground(x, z) + 1.4, p.y - 2) };
      }
      camera.position.set(R.spot.x, R.spot.y, R.spot.z);
      fov = Math.max(22, Math.min(55, 900 / Math.max(8, v1.set(R.spot.x - p.x, 0, R.spot.z - p.z).length() + 6)));   // (zooms in as you get further away)
    } else if (shot === 'chase') {
      camera.position.set(p.x - fx * 4.2, p.y + 0.9, p.z - fz * 4.2); fov = 62;
    } else if (shot === 'orbit') {
      R.orbit += dt * 0.45; camera.position.set(p.x + Math.cos(R.orbit) * 6, p.y + 1.8, p.z + Math.sin(R.orbit) * 6); fov = 50;
    } else if (shot === 'high') {
      camera.position.set(p.x - fx * 12 + fz * 6, p.y + 11, p.z - fz * 12 - fx * 6); fov = 48;
    } else {
      camera.position.set(p.x - fz * 5.5 + fx * 1.5, p.y + 1.1, p.z + fx * 5.5 + fz * 1.5); fov = 55;
    }
    const floor = ground(camera.position.x, camera.position.z) + 0.4;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(v2.set(p.x, p.y + 0.7, p.z));
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // ---------------------------------------------------------------- keys (the game hands them over while either is on)
  function key(e, down) {
    if (photo) {
      photo.keys[e.code] = down;
      if (down && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) stopPhoto();
      else if (down && e.code === 'KeyF' && !e.repeat) setFilter(filter + 1);
      return true;
    }
    if (replay) {
      if (!down) return true;
      if (e.code === 'Space') { replay.playing = !replay.playing; drawReplayBar(); e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { replay.t += e.code === 'ArrowRight' ? 5 : -5; replay.spot = null; if (replay.t < replay.end) replay.playing = replay.playing || false; e.preventDefault(); }
      else if (e.code === 'KeyC' && !e.repeat) cycleCam();
      else if ((e.code === 'Escape' || e.code === 'KeyV') && !e.repeat) stopReplay();
      else if (e.code === 'KeyP') return false;   // (the game starts a photo of this moment)
      return true;
    }
    return false;
  }

  return {
    get photo() { return !!photo; }, get replay() { return !!replay; }, get busy() { return !!(photo || replay); },
    startPhoto, stopPhoto, photoCamera, savePhoto, startReplay, stopReplay, replayStep, replayCamera, key,
    stop() { if (photo) stopPhoto(); if (replay) stopReplay(); },
  };
}
