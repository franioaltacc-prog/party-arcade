/* Final colour finish. Kept separate from maps, vehicles and world generation.
   Uses the existing final pass: no extra render targets or texture samples. */
export const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.14 }, uCon: { value: 1.07 }, uVig: { value: 0.22 }, uSpeed: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1.6 }, uWarm: { value: 0.02 }, uCool: { value: 0.012 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat, uCon, uVig, uSpeed, uTime, uAspect, uWarm, uCool; varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec2 d = vUv - vec2(0.5, 0.52); vec2 da = vec2(d.x * uAspect, d.y); float r = length(da);
      // at speed the edges smear outward from the middle (the middle stays sharp: that's where you look)
      float blur = uSpeed * smoothstep(0.32, 0.9, r) * 0.016;   // (gentle: a heavy blur makes speed feel slower, not faster)
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (blur > 0.001) { vec3 acc = c; for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - d * blur * float(i)).rgb; c = acc / 6.0; }
      // A bounded S-curve adds midtone definition without clipping shadow detail
      // or turning bright snow into a flat white patch. Input is display-referred
      // because OutputPass has already applied exposure and tone mapping.
      c = clamp(c, 0.0, 1.0);
      c += (uCon - 1.0) * 4.0 * c * (1.0 - c) * (c - 0.5);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Ease saturation in bright highlights so sunlight stays neutral.
      float sat = mix(uSat, 1.0, smoothstep(0.65, 1.0, l));
      c = mix(vec3(l), c, sat);
      float shadows = (1.0 - smoothstep(0.12, 0.5, l)) * smoothstep(0.0, 0.12, l);
      float highlights = smoothstep(0.5, 0.9, l) * (1.0 - smoothstep(0.9, 1.0, l));
      c += vec3(-0.45, 0.12, 0.6) * shadows * uCool;
      c += vec3(1.0, 0.4, -1.0) * highlights * uWarm;
      // streaks of wind: thin lines raying out from the middle, rushing outward, only round the edges
      if (uSpeed > 0.02) {
        float a = atan(da.y, da.x); float k = floor(a * 70.0); float n = hash(k);
        float seg = fract(r * 2.2 - uTime * (2.5 + n * 2.0) + n * 7.0);
        float line = step(0.86, n) * smoothstep(0.0, 0.35, seg) * (1.0 - smoothstep(0.35, 0.7, seg));
        c += line * smoothstep(0.3, 0.8, r) * uSpeed * 0.16 * (0.12 + 0.88 * smoothstep(0.05, 0.5, l));   // (faint in the dark: they're the light of the scene smeared, not lights of their own)
      }
      // the corners darken (more at speed: tunnel vision)
      c *= 1.0 - (uVig + uSpeed * 0.12) * smoothstep(0.4, 1.0, r * 1.1);
      // Static sub-byte dither breaks sky/fog banding without animated grain.
      float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      gl_FragColor = vec4(clamp(c + dither / 255.0, 0.0, 1.0), 1.0);
    }`,
};

