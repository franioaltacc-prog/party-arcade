/* The finishing touches on every frame, as racing games do: the 3D scene is drawn into a picture first, then
   - bright things glow (the sun on snow and water, lamps and the lighthouse at night: "bloom"),
   - the colours get a little more contrast and life (the plain renderer looks washed out),
   - the edges of the screen darken a touch, and at speed they smear outward and faint streaks of wind rush past.
   On low quality none of this runs: the scene is drawn straight to the screen as before. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.14 }, uCon: { value: 1.07 }, uVig: { value: 0.22 }, uSpeed: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1.6 }, uWarm: { value: 0.02 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig, uSpeed, uTime, uAspect, uWarm; varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec2 d = vUv - vec2(0.5, 0.52); vec2 da = vec2(d.x * uAspect, d.y); float r = length(da);
      // at speed the edges smear outward from the middle (the middle stays sharp: that's where you look)
      float blur = uSpeed * smoothstep(0.32, 0.9, r) * 0.016;   // (gentle: a heavy blur makes speed feel slower, not faster)
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (blur > 0.001) { vec3 acc = c; for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - d * blur * float(i)).rgb; c = acc / 6.0; }
      // colour: a little more contrast and saturation, highlights a touch warm
      c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c += vec3(uWarm, uWarm * 0.4, -uWarm) * smoothstep(0.55, 1.0, l);
      // streaks of wind: thin lines raying out from the middle, rushing outward, only round the edges
      if (uSpeed > 0.02) {
        float a = atan(da.y, da.x); float k = floor(a * 70.0); float n = hash(k);
        float seg = fract(r * 2.2 - uTime * (2.5 + n * 2.0) + n * 7.0);
        float line = step(0.86, n) * smoothstep(0.0, 0.35, seg) * (1.0 - smoothstep(0.35, 0.7, seg));
        c += line * smoothstep(0.3, 0.8, r) * uSpeed * 0.16 * (0.12 + 0.88 * smoothstep(0.05, 0.5, l));   // (faint in the dark: they're the light of the scene smeared, not lights of their own)
      }
      // the corners darken (more at speed: tunnel vision)
      c *= 1.0 - (uVig + uSpeed * 0.12) * smoothstep(0.4, 1.0, r * 1.1);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const SANE_FN = 'vec3 SANE(vec3 c) { return clamp(c, vec3(0.0), vec3(40.0)); }\n';   // (on graphics cards clamp turns infinite into 40 and not-a-number into 0)
function sane(mat, find, put) {
  if (!mat.fragmentShader.includes(find)) return;   // (a newer three.js: leave it)
  mat.fragmentShader = mat.fragmentShader.replace('void main()', SANE_FN + 'void main()').replace(find, put); mat.needsUpdate = true;
}

export function createPost(renderer) {
  let composer = null; let bloom = null; let grade = null; let render = null; let on = false;
  const size = new THREE.Vector2();
  function build() {
    renderer.getSize(size); const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });   // (samples: smooth edges, as the screen's own antialiasing gives)
    composer = new EffectComposer(renderer, rt);
    render = new RenderPass(null, null); composer.addPass(render);
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.45, 1.2); composer.addPass(bloom);
    const out = new OutputPass(); composer.addPass(out);   // (tone mapping and colour: what the renderer did when drawing to the screen)
    // a pinpoint glint on snow or water can be brighter than the picture can hold (infinite): left alone, the glow spreads
    // it into a black hole across the screen. Cap the brightness before the glow and before the tone mapping
    sane(bloom.materialHighPassFilter, 'vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = SANE(texel.rgb);');
    sane(out.material, 'gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv ); gl_FragColor.rgb = SANE(gl_FragColor.rgb);');
    grade = new ShaderPass(GRADE); composer.addPass(grade);
  }
  const api = {
    /** q: { post, bloom } from the quality setting. */
    set(q) {
      on = !!q.post;
      if (on && !composer) build();
      if (bloom) bloom.enabled = !!q.bloom;
    },
    /** A world's look: at night lights glow more; fog and snow need less (they're bright everywhere). */
    look({ night = false, snow = false, fog = false } = {}) {
      if (!composer) return;
      bloom.strength = night ? 0.7 : snow ? 0.15 : fog ? 0.15 : 0.25;
      bloom.threshold = night ? 0.6 : snow ? 1.6 : 1.2;   // (the day sky stays clear: only the sun and glints glow)
      grade.uniforms.uSat.value = night ? 1.08 : fog ? 1.04 : snow ? 1.08 : 1.14;
      grade.uniforms.uCon.value = fog ? 1.04 : 1.07;
      grade.uniforms.uWarm.value = night || snow ? 0 : 0.02;
    },
    resize() {
      if (!composer) return;
      renderer.getSize(size); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(size.x, size.y);
    },
    /** Draw a frame. speed: 0 (still) to 1 (flat out), for the edges' smear and the streaks. */
    draw(scene, camera, speed = 0) {
      if (!on || !composer) { renderer.render(scene, camera); return; }
      render.scene = scene; render.camera = camera;
      const u = grade.uniforms; u.uSpeed.value += (speed - u.uSpeed.value) * 0.12; u.uTime.value = performance.now() / 1000; u.uAspect.value = size.x / Math.max(1, size.y);
      composer.render();
    },
    get on() { return on; },
  };
  return api;
}
