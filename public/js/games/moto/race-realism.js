/* Race-track rendering only. Does not change a map, collision mesh or vehicle.
   Scanned soil: Poly Haven Brown Mud 02 (CC0); see assets/moto-realism/SOURCES.md. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** More direct daylight, with enough sky fill to keep the rider readable. */
export function raceDaylight(theme, original) {
  if (theme === 'snow') return original;
  return { ...original,
    sun: theme === 'forest' ? [38, 210] : [42, 125],
    turbidity: 2.8, rayleigh: 1.6, mie: 0.003, mieG: 0.8,
    sunColor: '#fff3df', sunI: theme === 'forest' ? 3.1 : 3.4,
    hemi: ['#c4d9ef', theme === 'forest' ? '#655544' : '#9b8065', theme === 'forest' ? 0.85 : 0.48],
    envI: theme === 'forest' ? 0.65 : 0.45, exposure: theme === 'forest' ? 0.6 : 0.5,
    fog: theme === 'forest' ? '#b5c6c2' : '#ced5d3',
    fogD: theme === 'forest' ? 0.00085 : 0.00048,
  };
}

/** Reuse the game's detailed tree asset at the existing race-tree positions.
    These are independent resources; open-world material caches are untouched. */
export function upgradeRacePines(scene, batches) {
  let disposed = false;
  if (!batches?.length) return () => {};
  const release = root => {
    const geometry = new Set(), materials = new Set(), textures = new Set();
    root.traverse(o => { if (o.isMesh) { geometry.add(o.geometry); for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); } } });
    geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  };
  new GLTFLoader().load('/models/nature/pines.glb', ({ scene: source }) => {
    if (disposed) { release(source); return; }
    source.updateMatrixWorld(true);
    const variants = [0, 1, 2].map(i => ['bark', 'leaves'].map(part => source.getObjectByName('pine' + i + '_' + part)));
    if (variants.some(v => v.some(m => !m?.isMesh))) { release(source); return; }
    const used = new Set();
    batches.forEach((old, index) => {
      const pair = variants[index % variants.length];
      const box = new THREE.Box3(); pair.forEach(m => box.union(new THREE.Box3().setFromObject(m)));
      const scale = 8.5 / Math.max(1, box.max.y - box.min.y);
      const fit = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
      pair.forEach(model => {
        const geometry = model.geometry.clone().applyMatrix4(model.matrixWorld);
        const material = model.material.clone();
        // Texture objects belong to this loaded asset and are released with the world.
        for (const v of Object.values(material)) if (v?.isTexture) used.add(v);
        if (model.name.endsWith('_leaves')) { material.side = THREE.DoubleSide; material.alphaTest = 0.4; material.transparent = false; material.alphaToCoverage = true; }
        const trees = new THREE.InstancedMesh(geometry, material, old.count);
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < old.count; i++) { old.getMatrixAt(i, matrix); trees.setMatrixAt(i, matrix.multiply(fit)); }
        if (old.instanceColor) trees.instanceColor = old.instanceColor.clone();
        trees.castShadow = true; trees.receiveShadow = true; trees.computeBoundingSphere(); scene.add(trees);
      });
      old.removeFromParent(); old.dispose();
    });
    // Original mesh buffers and unused far-LOD textures aren't needed by the replacements.
    const geometry = new Set(), materials = new Set(), unused = new Set();
    source.traverse(o => { if (o.isMesh) { geometry.add(o.geometry); materials.add(o.material); for (const v of Object.values(o.material)) if (v?.isTexture && !used.has(v)) unused.add(v); } });
    geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); unused.forEach(t => t.dispose());
    new Set(batches.map(b => b.geometry)).forEach(g => g.dispose());
  }, undefined, () => {});
  return () => { disposed = true; };
}

/** Switch atomically from the existing procedural fallback to locally hosted PBR
    maps. If a world is left during loading, its textures are still released. */
export function applyRaceSoil(material, renderer, trackWidth) {
  let disposed = false;
  const textures = [];
  const loader = new THREE.TextureLoader();
  const load = (name, color = false) => new Promise((resolve, reject) => {
    const t = loader.load('/assets/moto-realism/' + name + '.webp', resolve, undefined, reject);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
  });
  const fallbackMap = material.map;
  const fallbackNormal = material.normalMap;
  material.addEventListener('dispose', () => {
    disposed = true;
    textures.forEach(t => t.dispose());
    fallbackMap.dispose(); fallbackNormal.dispose();
  });
  Promise.all([load('dirt-color', true), load('dirt-normal'), load('dirt-arm')]).then(([map, normal, arm]) => {
    if (disposed) { textures.forEach(t => t.dispose()); return; }
    material.map = map; material.normalMap = normal;
    material.roughnessMap = arm; material.aoMap = arm;
    material.roughness = 1; material.aoMapIntensity = 0.65;
    material.normalScale.set(0.7, 0.7);
    material.onBeforeCompile = shader => {
      shader.uniforms.raceTrackWidth = { value: trackWidth };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 raceCoord; varying vec2 vRaceCoord;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vRaceCoord; uniform float raceTrackWidth;
        float raceMask() { return 1.0 - smoothstep(raceTrackWidth - 0.7, raceTrackWidth + 0.3, abs(vRaceCoord.x)); }
        float racePhase() { return (vRaceCoord.x + sin(vRaceCoord.y * 0.13) * 0.16 + sin(vRaceCoord.y * 0.043) * 0.25) * 10.5; }
      `);
      // Common world coordinates keep the near/far strips and chunk joins seamless.
      // UV derivatives also give the normal map the correct tangent frame on bends.
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
        #include <uv_vertex>
        vRaceCoord = raceCoord;
        vec2 soilUv = (modelMatrix * vec4(position, 1.0)).xz / 3.0;
        vMapUv = soilUv;
        vNormalMapUv = soilUv;
        vRoughnessMapUv = soilUv;
        vAoMapUv = soilUv;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        // Preserve the biome's vertex colours while retaining the scanned clods.
        vec4 soil = texture2D(map, vMapUv);
        float soilLuma = dot(soil.rgb, vec3(0.2126, 0.7152, 0.0722));
        vec3 soilDetail = mix(vec3(soilLuma), soil.rgb, 0.35) * 4.8;
        diffuseColor.rgb *= clamp(soilDetail, vec3(0.12), vec3(1.6));
        float groove = pow(0.5 + 0.5 * sin(racePhase()), 10.0) * raceMask();
        diffuseColor.rgb *= 1.0 - groove * 0.2;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        // Fine parallel ruts follow the track around corners. They are shading
        // detail, so the collision surface and bike physics stay identical.
        float phase = racePhase();
        float slope = 0.18 * cos(phase) * pow(0.5 + 0.5 * sin(phase), 7.0) * raceMask();
        mat3 trackFrame = getTangentFrame(-vViewPosition, normal, vRaceCoord);
        normal = normalize(trackFrame * normalize(vec3(-slope, 0.0, 1.0)));
      `);
    };
    material.customProgramCacheKey = () => 'race-soil-world-pbr-v1';
    material.needsUpdate = true;
  }).catch(() => {
    // A missing optional asset leaves the original track fully rideable.
    textures.forEach(t => t.dispose());
  });
}

/** A light broken cloud layer, separate from the physical sky and its lighting. */
export function addRaceClouds(scene, sunDirection) {
  const material = new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: sunDirection } },
    side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 sunDirection; varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vDirection);
        vec2 p = d.xz / max(0.12, d.y) * 2.3;
        float n = noise(p) * 0.57 + noise(p * 2.1 + 13.0) * 0.28 + noise(p * 4.3 + 7.0) * 0.15;
        float a = smoothstep(0.49, 0.69, n) * smoothstep(0.035, 0.2, d.y) * 0.82;
        float light = smoothstep(0.48, 0.78, n);
        vec3 c = mix(vec3(0.78, 0.83, 0.89), vec3(1.65, 1.62, 1.55), light);
        c += pow(max(0.0, dot(d, sunDirection)), 12.0) * 0.18;
        vec3 sky = mix(vec3(0.65, 0.8, 0.95), vec3(0.15, 0.4, 0.72), pow(max(d.y, 0.0), 0.45));
        sky += vec3(1.0, 0.85, 0.62) * pow(max(0.0, dot(d, sunDirection)), 700.0) * 3.0;
        gl_FragColor = vec4(mix(sky, c, a), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), material);
  clouds.onBeforeRender = (_renderer, _scene, camera) => { clouds.position.copy(camera.position); clouds.updateMatrixWorld(); };
  clouds.renderOrder = -1;
  clouds.frustumCulled = false;
  scene.add(clouds);
}
