/** Tileable 1024² albedo + relief atlases, generated locally. No remote texture dependencies.
 * World-space triplanar projection prevents stretched cliff faces. Macro and centimetre-scale
 * detail mix with slope/altitude snow coverage; derivative bump feeds StandardMaterial lighting.
 */
import * as THREE from 'three';
const palettes={
 dirt:[[116,88,59],[182,145,102]], grass:[[53,73,39],[111,121,64]],
 rock:[[74,80,84],[161,156,143]], snow:[[173,195,210],[246,250,251]]
};
function hash(x,y,seed){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function tileNoise(x,y,period,seed){const ix=Math.floor(x),iy=Math.floor(y),wrap=a=>((a%period)+period)%period;let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);const h=(a,b)=>hash(wrap(a),wrap(b),seed),a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function texture(kind,size=1024){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d'),pixels=context.createImageData(size,size),[low,high]=palettes[kind],seed=kind.length*733;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size;
  let h=.52*tileNoise(u*8,v*8,8,seed)+.26*tileNoise(u*32,v*32,32,seed+9)+.15*tileNoise(u*128,v*128,128,seed+3)+.07*hash(x,y,seed);
  if(kind==='rock'){const seam=Math.abs(Math.sin(v*Math.PI*32+tileNoise(u*8,v*8,8,seed)*2));h=h*.72+Math.min(1,seam*5)*.28;}
  if(kind==='grass'){h=h*.8+tileNoise(u*256,v*256,256,seed+11)*.2;}
  if(kind==='snow'){h=h*.8+.1+.1*Math.sin(v*Math.PI*32+Math.sin(u*Math.PI*8)*.8);}
  const i=(y*size+x)*4;for(let k=0;k<3;k++)pixels.data[i+k]=low[k]+(high[k]-low[k])*h;pixels.data[i+3]=h*155+70;
 }
 context.putImageData(pixels,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;tex.colorSpace=THREE.NoColorSpace;return tex;
}
export function terrainMaterial(map,sharedTextures=null){
 const textures=sharedTextures || Object.fromEntries(Object.keys(palettes).map(k=>[k,texture(k)]));
 const hole=new THREE.Vector4();
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91,metalness:0});
 material.customProgramCacheKey=()=> 'ow-triplanar-v2-'+map.theme;
 material.onBeforeCompile=shader=>{
  for(const [key,value]of Object.entries(textures))shader.uniforms['ow'+key]={value};
  shader.uniforms.owHole={value:hole};
  shader.uniforms.owBiome={value:map.theme==='desert'?0:map.theme==='snow'?2:1};
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
attribute float trailWeight;
varying vec3 owPosition;
varying vec3 owSurfaceNormal;
varying float owTrail;
`).replace('#include <begin_vertex>',`#include <begin_vertex>
owPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
owSurfaceNormal=normalize(mat3(modelMatrix)*objectNormal);
owTrail=trailWeight;
`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform sampler2D owdirt;
uniform sampler2D owgrass;
uniform sampler2D owrock;
uniform sampler2D owsnow;
uniform float owBiome;
uniform vec4 owHole;
varying vec3 owPosition;
varying vec3 owSurfaceNormal;
varying float owTrail;
vec4 owSample(sampler2D tex,vec2 p){
 mat2 rot=mat2(.8,-.6,.6,.8);
 return texture2D(tex,p)*.57+texture2D(tex,rot*p*.373+vec2(.31,.71))*.43;
}
vec4 owTri(sampler2D tex,vec3 p,vec3 weights){
 return owSample(tex,p.zy)*weights.x+owSample(tex,p.xz)*weights.y+owSample(tex,p.xy)*weights.z;
}
vec3 owBump(vec3 surf_pos,vec3 surf_norm,vec2 grad){
 vec3 dx=dFdx(surf_pos),dy=dFdy(surf_pos);
 vec3 r1=cross(dy,surf_norm),r2=cross(surf_norm,dx);
 float determinant=dot(dx,r1);
 return normalize(abs(determinant)*surf_norm-sign(determinant)*(grad.x*r1+grad.y*r2));
}
`).replace('#include <color_fragment>',`#include <color_fragment>
if(owHole.w>.5 && abs(owPosition.x-owHole.x)<owHole.z && abs(owPosition.z-owHole.y)<owHole.z)discard;
vec3 owWeights=pow(abs(normalize(owSurfaceNormal)),vec3(5.0));owWeights/=max(.001,dot(owWeights,vec3(1.0)));
vec3 owP=owPosition*.12;
vec4 owD=owTri(owdirt,owP,owWeights),owG=owTri(owgrass,owP,owWeights),owR=owTri(owrock,owP*.65,owWeights),owS=owTri(owsnow,owP,owWeights);
float owCliff=smoothstep(.20,.65,1.0-abs(normalize(owSurfaceNormal).y));
float owSnow=owBiome>1.5?1.0:(owBiome>.5?smoothstep(250.0,450.0,owPosition.y):0.0);
vec4 owGround=owBiome<.5?owD:mix(owG,owS,owSnow);
owGround=mix(owGround,owR,owCliff*(1.0-.3*owSnow));
vec4 owRoad=owBiome>1.5?mix(owS,owR,.32):owD;
owGround=mix(owGround,owRoad,owTrail*.78*(1.0-owCliff));
float owMacro=owTri(owrock,owPosition*.008,owWeights).a;
vec3 owAlbedo=pow(owGround.rgb,vec3(2.2));
diffuseColor.rgb*=owAlbedo*(.86+owMacro*.34);
float owRelief=owGround.a*(owBiome>1.5?.09:.16);
`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
normal=owBump(-vViewPosition,normal,vec2(dFdx(owRelief),dFdy(owRelief)));
`).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=clamp(.78+owGround.a*.22-.09*owSnow,.65,1.0);
`);
 };
 return {material,textures,hole,dispose(){material.dispose();if(!sharedTextures)Object.values(textures).forEach(t=>t.dispose());}};
}
