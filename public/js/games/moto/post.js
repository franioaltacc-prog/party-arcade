/* The finishing touches on every frame, as racing games do: the 3D scene is drawn into a picture (and how far away
   each pixel is, its depth) first, then
   - nooks and contact points darken a little: under the bike, where grass meets dirt, in the ruts and berms
     ("ambient occlusion", GTAO from three.js, worked out from the depth alone at half size; high quality only),
   - the air between you and far things glows the sky's own colour (aerial perspective): far hills fade toward a pale
     horizon, warmer looking toward the sun. The colour is the sky's (the same sky formula, three.js Sky), so the hills
     melt into it. It thins out with height, so the valley is hazier than the ridge tops. This replaces the plain fog,
   - out-of-focus blur (depth of field): what's much nearer or further than the rider goes soft, like a camera lens.
     Strong in photo mode, replays and the menus; just a touch while riding (high quality only),
   - bright things glow (the sun on snow and water, lamps and the lighthouse at night: "bloom"),
   - the colours get a little more contrast and life (the plain renderer looks washed out),
   - the edges of the screen darken a touch, and at speed they smear outward and faint streaks of wind rush past.
   On low quality none of this runs: the scene is drawn straight to the screen (with its plain fog) as before. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

import { GRADE } from './finish-grade.js';

const SANE_FN = 'vec3 SANE(vec3 c) { return clamp(c, vec3(0.0), vec3(40.0)); }\n';   // (on graphics cards clamp turns infinite into 40 and not-a-number into 0)
function sane(mat, find, put) {
  if (!mat.fragmentShader.includes(find)) return;   // (a newer three.js: leave it)
  mat.fragmentShader = mat.fragmentShader.replace('void main()', SANE_FN + 'void main()').replace(find, put); mat.needsUpdate = true;
}

const QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// (where a pixel is: its distance from the camera and direction, from the depth picture)
const VIEW_FN = `
uniform sampler2D tDepth; uniform mat4 uProjInv, uCamWorld; uniform float uNear, uFar;
vec3 viewPos(vec2 uv, float d) { vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
`;

/** The sky's colour looking in a direction: three.js Sky's own formula (Preetham), without the sun's disc. */
const SKY_FN = `
uniform vec3 uSunPos; uniform float uRayleigh, uTurbidity, uMie, uMieG;
vec3 skyColour(vec3 direction) {
  const float e = 2.718281828; const float pi = 3.141592653589793;
  const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
  const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
  vec3 up = vec3(0.0, 1.0, 0.0); vec3 sunDir = normalize(uSunPos);
  float zc = clamp(dot(sunDir, up), -1.0, 1.0);
  float sunE = 1000.0 * max(0.0, 1.0 - pow(e, -((1.6110731556870734 - acos(zc)) / 1.5)));
  float sunfade = 1.0 - clamp(1.0 - exp(uSunPos.y / 450000.0), 0.0, 1.0);
  vec3 betaR = totalRayleigh * (uRayleigh - (1.0 - sunfade));
  vec3 betaM = 0.434 * (0.2 * uTurbidity) * 10E-18 * MieConst * uMie;
  float zenithAngle = acos(max(0.0, dot(up, direction)));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
  float cosTheta = dot(direction, sunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
  float g2 = uMieG * uMieG; float mPhase = 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * uMieG * cosTheta + g2, 1.5));
  vec3 k = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
  vec3 Lin = pow(sunE * k * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * k * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, sunDir), 5.0), 0.0, 1.0));
  vec3 c = (Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(c, vec3(1.0 / (1.2 + 1.2 * sunfade)));
}
`;

/** The scene drawn with its depth; then AO and the air's haze put on it, into the next picture in the chain. */
class ScenePass extends Pass {
  constructor(renderer) {
    super();
    this.needsSwap = true; this.scene = null; this.camera = null; this.ao = null; this.aoOn = false;
    this.depth = new THREE.DepthTexture(1, 1); this.depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depth });   // (samples: smooth edges)
    this.whiteAO = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.whiteAO.needsUpdate = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: this.depth }, tAO: { value: this.whiteAO }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uNear: { value: 0.25 }, uFar: { value: 9000 },
        uAO: { value: 0 }, uHaze: { value: 0 }, uHazeFall: { value: 1 / 380 }, uHazeBase: { value: 0 }, uHazeTint: { value: new THREE.Color(1, 1, 1) }, uHazeK: { value: 1 }, uHazeStart: { value: 0 }, uSky: { value: 0 }, uFogColour: { value: new THREE.Color() }, uHazeFog: { value: 0.5 },
        uSunPos: { value: new THREE.Vector3(0, 1, 0) }, uRayleigh: { value: 1 }, uTurbidity: { value: 2 }, uMie: { value: 0.005 }, uMieG: { value: 0.8 } },
      vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: VIEW_FN + SKY_FN + `
        uniform sampler2D tDiffuse, tAO; uniform float uAO, uHaze, uHazeFall, uHazeBase, uHazeK, uHazeStart, uSky, uHazeFog; uniform vec3 uHazeTint, uFogColour; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv); float d = texture2D(tDepth, vUv).x;
          if (d >= 0.99999) { gl_FragColor = c; return; }   // (the sky itself)
          vec3 v = viewPos(vUv, d); float dist = length(v);
          vec3 wp = (uCamWorld * vec4(v, 1.0)).xyz; vec3 eye = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vec3 rd = (wp - eye) / max(dist, 1e-4);
          // nooks darken (fading out far off, where the half-size picture is coarser than the nook)
          float ao = texture2D(tAO, vUv).r;
          c.rgb *= mix(1.0, ao, uAO * (1.0 - smoothstep(60.0, 220.0, dist)));
          // the air: thicker low down (the haze integrated along the line of sight through air thinning with height)
          float h0 = (eye.y - uHazeBase) * uHazeFall, dy = rd.y * dist * uHazeFall;
          float optical = uHaze * max(dist - uHazeStart, 0.0) * exp(-max(h0, -4.0)) * (abs(dy) > 1e-3 ? (1.0 - exp(-dy)) / dy : 1.0 - 0.5 * dy);
          float k = 1.0 - exp(-max(optical, 0.0));
          // (the sky's colour toward the horizon, mixed with the world's own air colour: warm in a desert, grey-green in a forest)
          vec3 air = uSky > 0.5 ? mix(skyColour(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.35 + 0.035, rd.z))) * uHazeK * uHazeTint, uFogColour, uHazeFog) : uFogColour;
          c.rgb = mix(c.rgb, air, k);
          gl_FragColor = c;
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) {
    this.target.setSize(w, h);
    if (this.ao) this.ao.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
  }
  enableAO(renderer, on) {
    this.aoOn = on;
    if (on && !this.ao) {
      // (made without a depth picture first, then handed ours: three.js r170 expects its own to exist when it's given one)
      const ao = new GTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), Math.max(1, this.target.width >> 1), Math.max(1, this.target.height >> 1));
      ao.setGBuffer(this.depth, undefined);
      ao.output = GTAOPass.OUTPUT.Off;
      ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 2.2, scale: 1.25, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao = ao;
    }
  }
  render(renderer, writeBuffer) {
    const scene = this.scene, camera = this.camera, u = this.mat.uniforms;
    // with the haze on, the scene's own plain fog only keeps a little (it was standing in for the air)
    const fog = scene.fog, fogD = fog?.density; const L = scene.userData.look || {};
    if (fog && fogD !== undefined && u.uHaze.value > 0) fog.density = fogD * (L.fogKeep ?? 0.3);
    renderer.setRenderTarget(this.target); renderer.clear(); renderer.render(scene, camera);
    if (fog && fogD !== undefined) fog.density = fogD;
    u.tAO.value = this.whiteAO;
    if (this.aoOn && this.ao) {
      this.ao.camera = camera; this.ao.scene = scene;
      this.ao.render(renderer, null, null);
      u.tAO.value = this.ao.gtaoMap;
    }
    u.tDiffuse.value = this.target.texture; u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.depth.dispose(); this.ao?.dispose(); this.mat.dispose(); this.quad.dispose(); this.whiteAO.dispose(); }
}

/** Depth of field: each pixel blurred by how far it is from the plane in focus (a disc of samples, bigger for further
    from focus). Near things blur over what's behind them; far things don't bleed over a sharp rider. */
const DOF = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uNear: { value: 0.25 }, uFar: { value: 9000 },
    uFocus: { value: 10 }, uNearK: { value: 1 }, uFarK: { value: 0.4 }, uMaxPx: { value: 10 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: QUAD_VS,
  fragmentShader: VIEW_FN + `
    uniform sampler2D tDiffuse; uniform float uFocus, uNearK, uFarK, uMaxPx; uniform vec2 uRes; varying vec2 vUv;
    float coc(vec2 uv) {   // (blur radius in pixels, + behind the focus, - in front)
      float d = texture2D(tDepth, uv).x; float z = d >= 0.99999 ? 1e5 : length(viewPos(uv, d));
      float k = (z - uFocus) / max(z, 0.01);
      return k > 0.0 ? min(1.0, k * uFarK) * uMaxPx : max(-1.0, k * uNearK * 1.4) * uMaxPx;
    }
    void main() {
      float c0 = coc(vUv); vec4 base = texture2D(tDiffuse, vUv);
      // (a near-field blur can spread onto sharp pixels: look round anyway when near things may be about)
      if (abs(c0) < 0.6 && uNearK < 0.01) { gl_FragColor = base; return; }
      vec3 acc = base.rgb; float wsum = 1.0; float r0 = abs(c0);
      const int N = 28; const float GA = 2.39996323;
      for (int i = 1; i < N; i++) {
        float t = sqrt(float(i) / float(N)); vec2 o = vec2(cos(float(i) * GA), sin(float(i) * GA)) * t * uMaxPx;
        vec2 uv = vUv + o / uRes; float cs = coc(uv); float ds = t * uMaxPx;
        // a sample counts if its own blur reaches here (near ones always may), or if this pixel's blur reaches it and it's not a sharper thing in front
        float w = cs < 0.0 ? smoothstep(ds - 1.0, ds + 0.5, -cs) : smoothstep(ds - 1.0, ds + 0.5, min(r0, cs));
        acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
};

export function createPost(renderer) {
  let composer = null; let bloom = null; let grade = null; let scenePass = null; let dof = null; let on = false;
  let q = {}; let dofMode = 'play'; let focusDist = 10;
  const size = new THREE.Vector2();
  function build() {
    renderer.getSize(size); const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    scenePass = new ScenePass(renderer); composer.addPass(scenePass);
    dof = new ShaderPass(DOF); dof.uniforms.tDepth.value = scenePass.depth; composer.addPass(dof);
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.45, 1.2); composer.addPass(bloom);
    const out = new OutputPass(); composer.addPass(out);   // (tone mapping and colour: what the renderer did when drawing to the screen)
    // a pinpoint glint on snow or water can be brighter than the picture can hold (infinite): left alone, the glow spreads
    // it into a black hole across the screen. Cap the brightness before the glow and before the tone mapping
    sane(bloom.materialHighPassFilter, 'vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = SANE(texel.rgb);');
    sane(out.material, 'gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv ); gl_FragColor.rgb = SANE(gl_FragColor.rgb);');
    grade = new ShaderPass(GRADE); composer.addPass(grade);
    composer.setPixelRatio(pr); composer.setSize(size.x, size.y);
  }
  /** What this frame's look needs: AO (high), haze (whenever the post runs), the blur (high, or any still shot). */
  function configure(scene) {
    const L = scene.userData.look || {}, u = scenePass.mat.uniforms, sky = scene.userData.sky;
    scenePass.enableAO(renderer, !!q.ao && L.ao !== false);
    u.uAO.value = scenePass.aoOn ? (L.ao ?? 0.6) : 0; u.uHazeFog.value = L.hazeFog ?? 0.55;
    const fog = scene.fog;
    u.uHaze.value = q.haze && fog && L.haze !== false ? (L.hazeD ?? (fog.density || 0) * 1.25) : 0;
    u.uHazeFall.value = 1 / (L.hazeH ?? 380); u.uHazeBase.value = L.hazeBase ?? 0; u.uHazeK.value = L.hazeK ?? 1; u.uHazeStart.value = L.hazeStart ?? 0;   // (hazeStart: clear air for that many metres, the haze only further off)
    if (L.hazeTint) u.uHazeTint.value.set(L.hazeTint); else u.uHazeTint.value.setRGB(1, 1, 1);
    u.uSky.value = sky && !L.night ? 1 : 0;
    if (fog) u.uFogColour.value.copy(fog.color);
    if (sky) { const su = sky.material.uniforms; u.uSunPos.value.copy(su.sunPosition.value); u.uRayleigh.value = su.rayleigh.value; u.uTurbidity.value = su.turbidity.value; u.uMie.value = su.mieCoefficient.value; u.uMieG.value = su.mieDirectionalG.value; }
    // (a world can set its own colour finish: "sat", "con" (contrast), "warm")
    const g = grade.uniforms; if (L.sat) g.uSat.value = L.sat; if (L.con) g.uCon.value = L.con; if (L.warm !== undefined) g.uWarm.value = L.warm;
    const still = dofMode !== 'play';
    dof.enabled = !!q.dof && L.dof !== false && (still || q.dofPlay);
    const d = dof.uniforms; d.uFocus.value = focusDist;
    const scale = Math.max(1, size.y * renderer.getPixelRatio() / 720);   // (the blur's size in pixels follows the picture's height)
    if (dofMode === 'photo') { d.uNearK.value = 0.1; d.uFarK.value = 0.45; d.uMaxPx.value = 8 * scale; }
    else if (dofMode === 'menu') { d.uNearK.value = 0.8; d.uFarK.value = 0.35; d.uMaxPx.value = 7 * scale; }
    else { d.uNearK.value = 0.0; d.uFarK.value = 0.12; d.uMaxPx.value = 3 * scale; }   // (riding: only the far distance goes a touch soft)
  }
  const api = {
    /** q: { post, bloom, ao, haze, dof, dofPlay } from the quality setting. */
    set(quality) {
      q = quality || {}; on = !!q.post;
      if (on && !composer) build();
      if (bloom) bloom.enabled = !!q.bloom;
    },
    /** A world's look: at night lights glow more; fog and snow need less (they're bright everywhere). */
    look({ night = false, snow = false, fog = false } = {}) {
      if (!composer) return;
      bloom.strength = night ? 0.7 : snow ? 0.15 : fog ? 0.15 : 0.16;
      bloom.threshold = night ? 0.6 : snow ? 1.6 : 1.1;   // (the day sky stays clear: only the sun and glints glow)
      bloom.radius = night ? 0.45 : 0.6;
      grade.uniforms.uSat.value = night ? 1.08 : fog ? 1.04 : snow ? 1.08 : 1.07;
      grade.uniforms.uCon.value = fog ? 1.04 : 1.09;
      grade.uniforms.uWarm.value = night || snow ? 0 : 0.026;
      grade.uniforms.uCool.value = night ? 0.006 : snow || fog ? 0.004 : 0.012;
    },
    /** What the camera is doing: 'play' (riding), 'photo' (photo mode and replays) or 'menu'; and how far away the rider is. */
    focus(mode, distance) { dofMode = mode || 'play'; if (distance > 0) focusDist = distance; },
    resize() {
      if (!composer) return;
      renderer.getSize(size); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(size.x, size.y);
      dof.uniforms.uRes.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
    },
    /** Draw a frame. speed: 0 (still) to 1 (flat out), for the edges' smear and the streaks. */
    draw(scene, camera, speed = 0) {
      if (!on || !composer) { renderer.render(scene, camera); return; }
      scenePass.scene = scene; scenePass.camera = camera; configure(scene);
      const d = dof.uniforms; d.uNear.value = camera.near; d.uFar.value = camera.far; d.uProjInv.value.copy(camera.projectionMatrixInverse); d.uCamWorld.value.copy(camera.matrixWorld);
      if (!d.uRes.value.x || d.uRes.value.x === 1) d.uRes.value.set(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio());
      const u = grade.uniforms; u.uSpeed.value += (speed - u.uSpeed.value) * 0.12; u.uTime.value = performance.now() / 1000; u.uAspect.value = size.x / Math.max(1, size.y);
      composer.render();
    },
    get on() { return on; },
  };
  return api;
}
