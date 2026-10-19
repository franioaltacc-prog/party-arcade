/* Motocross sound: a synthesised four-stroke engine that follows the real revs (so gear changes,
   the rev limiter and nitro all sound right), wind, tyres scrubbing, landings and crashes, and the
   other riders' engines. Made with Web Audio, no sound files. It plays through the site's sound
   effects volume and goes quiet when the site is muted. */
const { Sfx } = window.PA;

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; d[i] = last; }
  return buf;
}
const curves = new Map();
function shaperCurve(k) {
  k = Math.round(k * 4) / 4;
  if (curves.has(k)) return curves.get(k);
  const n = 1024; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  curves.set(k, c);
  return c;
}
/** A pulse-like wave with strong odd harmonics: the bark of a single-cylinder exhaust. */
function engineWave(ctx) {
  const n = 40; const re = new Float32Array(n); const im = new Float32Array(n);
  for (let i = 1; i < n; i++) im[i] = (i % 2 ? 1 : 0.55) / Math.pow(i, 0.85) * (1 + (i > 6 && i < 14 ? 0.5 : 0));
  return ctx.createPeriodicWave(re, im);
}

function makeEngine(ctx, out, loud = 1) {
  const wave = engineWave(ctx);
  const main = ctx.createOscillator(); main.setPeriodicWave(wave);
  const sub = ctx.createOscillator(); sub.type = 'triangle';
  const buzz = ctx.createOscillator(); buzz.type = 'sawtooth';
  const nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBuffer(ctx); nsrc.loop = true;
  const nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.Q.value = 1.4;
  const gMain = ctx.createGain(); gMain.gain.value = 0.5;
  const gSub = ctx.createGain(); gSub.gain.value = 0.35;
  const gBuzz = ctx.createGain(); gBuzz.gain.value = 0.12;
  const gNoise = ctx.createGain(); gNoise.gain.value = 0.0;
  const shaper = ctx.createWaveShaper(); shaper.curve = shaperCurve(2.2); shaper.oversample = '2x';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 180; body.gain.value = 5; body.Q.value = 1;
  const vol = ctx.createGain(); vol.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  main.connect(gMain).connect(shaper); sub.connect(gSub).connect(shaper); buzz.connect(gBuzz).connect(shaper);
  nsrc.connect(nbp).connect(gNoise).connect(shaper);
  shaper.connect(body).connect(lp).connect(vol);
  if (pan) vol.connect(pan).connect(out); else vol.connect(out);
  const t0 = ctx.currentTime;
  for (const o of [main, sub, buzz, nsrc]) o.start(t0);
  let flutter = 0; let lastCurve = shaper.curve;
  return {
    /** rpm, throttle 0..1, limiter on?, volume 0..1, pan -1..1 */
    set(rpm, thr, limiter, level, p = 0, dt = 1 / 60) {
      const t = ctx.currentTime;
      const f = Math.max(20, rpm / 60);   // one bang per two turns, and its first harmonic is what you hear most
      main.frequency.setTargetAtTime(f, t, 0.012);
      sub.frequency.setTargetAtTime(f / 2, t, 0.012);
      buzz.frequency.setTargetAtTime(f * 1.007, t, 0.012);
      nbp.frequency.setTargetAtTime(500 + f * 6, t, 0.03);
      gNoise.gain.setTargetAtTime(0.06 + thr * 0.22, t, 0.03);
      lp.frequency.setTargetAtTime(500 + rpm * 0.22 + thr * 1800, t, 0.03);
      const curve = shaperCurve(1.6 + thr * 2.4);
      if (curve !== lastCurve) { shaper.curve = curve; lastCurve = curve; }
      flutter += dt * 34;
      const lim = limiter ? 0.55 + 0.45 * (Math.sin(flutter * 6.28) > 0 ? 1 : 0) : 1;
      vol.gain.setTargetAtTime(loud * level * (0.16 + thr * 0.3 + Math.min(1, rpm / 12000) * 0.12) * lim, t, limiter ? 0.004 : 0.04);
      if (pan) pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), t, 0.05);
    },
    stop() {
      const t = ctx.currentTime;
      vol.gain.setTargetAtTime(0, t, 0.05);
      for (const o of [main, sub, buzz, nsrc]) { try { o.stop(t + 0.3); } catch { /* already stopped */ } }
      setTimeout(() => { try { vol.disconnect(); } catch { /* gone */ } }, 500);
    },
  };
}

function makeLoop(ctx, out, type, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 3); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(out); src.start();
  return { f, g, set(v, freqTo) { const t = ctx.currentTime; g.gain.setTargetAtTime(v, t, 0.05); if (freqTo) f.frequency.setTargetAtTime(freqTo, t, 0.05); }, stop() { try { src.stop(); } catch { /* done */ } } };
}

/** Start the sound for a ride. Returns null if there's no audio. */
export function createAudio() {
  const ctx = Sfx.ac && Sfx.ac();
  if (!ctx) return null;
  const master = ctx.createGain(); master.gain.value = Sfx.muted ? 0 : 1;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
  master.connect(comp).connect(Sfx.master);
  const engine = makeEngine(ctx, master, 1);
  const wind = makeLoop(ctx, master, 'bandpass', 700, 0.5);
  const scrub = makeLoop(ctx, master, 'bandpass', 2400, 0.8);
  const nitro = makeLoop(ctx, master, 'highpass', 1800, 0.7);
  const others = new Map();
  let lastSpeed=0,load=0;
  const shot = (fn) => { if (!Sfx.muted) { try { fn(); } catch { /* audio unavailable */ } } };
  function thud(strength) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.9, 0.25 + strength * 0.5), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.32);
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, 0.3);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(Math.min(0.6, strength * 0.5), t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(f).connect(g2).connect(master); n.start(t);
  }
  return {
    ctx,
    update(b, dt, extra = {}) {
      master.gain.setTargetAtTime(Sfx.muted ? 0 : 1, ctx.currentTime, 0.05);
      const speed = Math.hypot(b.vx, b.vy);
      const acceleration=Math.max(0,(speed-lastSpeed)/Math.max(.001,dt));lastSpeed=speed;
      const tune=window.MotoCore.P;
      load+=(Math.min(1,acceleration/tune.SOUND_ACCEL_SCALE)*b.thr-load)*(1-Math.exp(-dt*tune.SOUND_RESPONSE));
      engine.set(b.crashed ? 1700 : b.rpm, b.crashed ? 0 : Math.min(1,b.thr*tune.SOUND_BASE_LOAD+load*tune.SOUND_ACCEL), b.limiter && !b.crashed, 1, 0, dt);
      wind.set(Math.min(0.35, speed * speed * 0.00035), 500 + speed * 25);
      const slip = b.crashed ? 0 : Math.max(b.wh[1].ct ? b.wh[1].slip : 0, b.wh[0].ct ? b.wh[0].slip * 0.6 : 0, (extra.scrub || 0) * 0.6, b.slide || 0);
      scrub.set(Math.min(0.22, Math.max(0, slip - 0.6) * 0.05), extra.surface === 2 ? 3800 : extra.surface === 1 ? 900 : 2200);
      nitro.set(b.boost ? 0.16 : 0, b.boost ? 2600 : 1800);
    },
    /** Other riders: id -> { rpm, thr, dist (m, signed: + ahead), lane } — only the closest few are heard. */
    others(list) {
      const keep = new Set(list.slice(0, 3).map((o) => o.id));
      for (const [id, e] of others) if (!keep.has(id)) { e.stop(); others.delete(id); }
      for (const o of list.slice(0, 3)) {
        let e = others.get(o.id);
        if (!e) { e = makeEngine(ctx, master, 0.6); others.set(o.id, e); }
        const level = Math.max(0, 1 - Math.abs(o.dist) / 70) ** 2;
        e.set(o.rpm, o.thr, false, level, Math.max(-0.8, Math.min(0.8, o.lane * 0.2 - o.dist * 0.01)));
      }
    },
    land(strength) { shot(() => thud(strength)); },
    crash() { shot(() => { thud(1.2); Sfx.noise(0.5, 0.25, 0.02, 600); Sfx.tone(180, 0.18, 'square', 0.04, -120, 0.05); }); },
    checkpoint() { shot(() => { Sfx.tone(988, 0.1, 'triangle', 0.08); Sfx.tone(1480, 0.22, 'triangle', 0.08, 0, 0.09); }); },
    trick() { shot(() => [660, 880, 1320].forEach((f, i) => Sfx.tone(f, 0.12, 'triangle', 0.06, 0, i * 0.06))); },
    beep(go) { shot(() => Sfx.tone(go ? 880 : 440, go ? 0.45 : 0.18, 'square', 0.06)); },
    gate() { shot(() => { Sfx.noise(0.12, 0.2, 0, 1200); Sfx.tone(300, 0.08, 'square', 0.05, -100); }); },
    stop() {
      engine.stop(); wind.stop(); scrub.stop(); nitro.stop();
      for (const e of others.values()) e.stop();
      others.clear();
      setTimeout(() => { try { master.disconnect(); } catch { /* gone */ } }, 600);
    },
  };
}
