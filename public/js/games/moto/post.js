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

import { GRADE } from './finish-grade.js';

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
      bloom.strength = night ? 0.7 : snow ? 0.15 : fog ? 0.15 : 0.12;
      bloom.threshold = night ? 0.6 : snow ? 1.6 : 1.2;   // (the day sky stays clear: only the sun and glints glow)
      grade.uniforms.uSat.value = night ? 1.08 : fog ? 1.04 : snow ? 1.08 : 1.05;
      grade.uniforms.uCon.value = fog ? 1.04 : 1.07;
      grade.uniforms.uWarm.value = night || snow ? 0 : 0.02;
      grade.uniforms.uCool.value = night ? 0.006 : snow || fog ? 0.004 : 0.012;
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
