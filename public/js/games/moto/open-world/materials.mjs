/** Tileable 1024² albedo + relief atlases, generated locally (or a world's own photo of the ground, from this site).
 * World-space triplanar projection prevents stretched cliff faces. Macro and centimetre-scale
 * detail mix with slope/altitude snow coverage; derivative bump feeds StandardMaterial lighting.
 */
import * as THREE from 'three';
const palettes={
 dirt:[[116,88,59],[182,145,102]], grass:[[53,73,39],[111,121,64]],
 rock:[[74,80,84],[161,156,143]], snow:[[190,206,222],[249,251,253]]
};
// (each world's own rock and dirt: red sandstone in the desert, cold blue-grey granite in the snow)
const themed={
 desert:{rock:[[122,58,36],[214,132,82]],dirt:[[150,98,62],[214,168,118]]},
 snow:{rock:[[58,64,76],[138,146,160]]},
 alpine:{rock:[[70,74,70],[150,148,134]],grass:[[66,96,44],[136,156,78]]},
};
function hash(x,y,seed){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function tileNoise(x,y,period,seed){const ix=Math.floor(x),iy=Math.floor(y),wrap=a=>((a%period)+period)%period;let u=x-ix,v=y-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);const h=(a,b)=>hash(wrap(a),wrap(b),seed),a=h(ix,iy),b=h(ix+1,iy),c=h(ix,iy+1),d=h(ix+1,iy+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
// (a world can bring its own colours too: "look": { "rock": [low, high], "dirt": …, "grass": … })
function texture(kind,theme,size=1024,look=null){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d'),pixels=context.createImageData(size,size),[low,high]=look?.[kind]||themed[theme]?.[kind]||palettes[kind],seed=kind.length*733;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size;
  let h=.52*tileNoise(u*8,v*8,8,seed)+.26*tileNoise(u*32,v*32,32,seed+9)+.15*tileNoise(u*128,v*128,128,seed+3)+.07*hash(x,y,seed);
  if(kind==='rock'){const seam=Math.abs(Math.sin(v*Math.PI*32+tileNoise(u*8,v*8,8,seed)*2));h=h*.72+Math.min(1,seam*5)*.28;}
  if(kind==='grass'){h=h*.8+tileNoise(u*256,v*256,256,seed+11)*.2;}
  if(kind==='snow'){h=h*.86+.07+.07*Math.sin(v*Math.PI*32+Math.sin(u*Math.PI*8)*.8);}   // (soft wind ripples)
  const i=(y*size+x)*4;for(let k=0;k<3;k++)pixels.data[i+k]=low[k]+(high[k]-low[k])*h;pixels.data[i+3]=h*155+70;
 }
 context.putImageData(pixels,0,0);const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.anisotropy=8;tex.colorSpace=THREE.NoColorSpace;
 // a world can use a real photo instead ("look": {"photo": {"snow": [colour image, height image, brightness]}}): it
 // replaces this one when it has loaded (the height goes in the alpha, like the made-up one's; brightness, 0-255: lifts
 // the photo's average to that, keeping its detail)
 const photo=look?.photo?.[kind];
 if(photo)Promise.all(photo.slice(0,2).map(src=>new Promise((ok,no)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=no;im.src=src;}))).then(([colour,height])=>{
  context.clearRect(0,0,size,size);context.drawImage(height,0,0,size,size);const h=context.getImageData(0,0,size,size).data;
  context.clearRect(0,0,size,size);context.drawImage(colour,0,0,size,size);const px=context.getImageData(0,0,size,size);
  let mean=0;for(let i=0;i<px.data.length;i+=4)mean+=(px.data[i]+px.data[i+1]+px.data[i+2])/3;mean/=px.data.length/4;
  const k=photo[2]&&mean<photo[2]?(255-photo[2])/Math.max(1,255-mean):1;   // (scales the distance from white)
  for(let i=0;i<px.data.length;i+=4){for(let c=0;c<3;c++)px.data[i+c]=255-(255-px.data[i+c])*k;px.data[i+3]=h[i]*.6+70;}
  context.putImageData(px,0,0);tex.needsUpdate=true;
 }).catch(e=>console.warn('ground photo',photo,e));
 return tex;
}
/** The sea's clock (seconds, shared by every sea material: the waves, the light rippling on the seabed). */
export const seaClock={value:0};
/** How bright the daylight is (1 day .. 0 night): the light rippling on the seabed and through the waves fades with it. */
export const seaLight={value:1};
export function terrainMaterial(map,sharedTextures=null,detailed=true){
 const textures=sharedTextures || Object.fromEntries(Object.keys(palettes).map(k=>[k,texture(k,map.theme,1024,map.look)]));
 const hole=new THREE.Vector4();
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91,metalness:0});
 material.customProgramCacheKey=()=> 'ow-terrain-lod-v9-'+map.theme+'-'+detailed+(map.sea?'-sea'+map.sea.level:'');
 material.onBeforeCompile=shader=>{
  for(const [key,value]of Object.entries(textures))shader.uniforms['ow'+key]={value};
  shader.uniforms.owHole={value:hole};
  shader.uniforms.owBiome={value:map.theme==='desert'?0:map.theme==='snow'?2:1};
  shader.uniforms.owTime=seaClock;shader.uniforms.owLight=seaLight;
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
uniform float owTime,owLight;
uniform vec4 owHole;
// light rippling on the seabed (caustics): the bright edges between moving cells
float owCaustic(vec2 p,float t){
 float c=0.0;
 for(int o=0;o<2;o++){
  vec2 q=p*(o==0?1.0:1.9)+vec2(o==0?0.0:3.7,o==0?0.0:1.3),ip=floor(q),fp=fract(q);float d1=8.0,d2=8.0;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
   vec2 g=vec2(float(i),float(j)),h=fract(sin(vec2(dot(ip+g,vec2(127.1,311.7)),dot(ip+g,vec2(269.5,183.3))))*43758.5453);
   vec2 r=g+.5+.42*sin(t*(.6+.3*float(o))+6.2832*h)-fp;float d=dot(r,r);
   if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
  }
  c+=pow(1.0-smoothstep(0.0,.32,sqrt(d2)-sqrt(d1)),3.0)*(o==0?.7:.45);
 }
 return c;
}
varying vec3 owPosition;
varying vec3 owSurfaceNormal;
varying float owTrail;
vec4 owSample(sampler2D tex,vec2 p){
 mat2 rot=mat2(.8,-.6,.6,.8);
 ${detailed?'return texture2D(tex,p)*.57+texture2D(tex,rot*p*.373+vec2(.31,.71))*.43;':'return texture2D(tex,p);'}
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
float owCliff=smoothstep(.20,.65,1.0-abs(normalize(owSurfaceNormal).y));
float owSnow=${map.theme==='snow'?'1.0':map.theme==='alpine'?'smoothstep(250.0,450.0,owPosition.y)':'0.0'};
vec4 owGround=owCliff>.25?owTri(${map.theme==='desert'?'owdirt':map.theme==='snow'?'owsnow':'owgrass'},owP,owWeights):owSample(${map.theme==='desert'?'owdirt':map.theme==='snow'?'owsnow':'owgrass'},owP.xz);
${map.theme==='alpine'?'if(owSnow>.01)owGround=mix(owGround,owSample(owsnow,owP.xz),owSnow);':''}
vec4 owRock=owTri(owrock,owP*.65,owWeights);
owRock.rgb*=.72+.5*texture2D(owrock,owPosition.xz*.0021+owPosition.y*.0013).a;   // (broad light and dark patches across a mountain face)
${map.theme==='desert'?'owRock.rgb*=mix(vec3(.8,.66,.58),vec3(1.1,1.02,.92),.5+.5*sin(owPosition.y*.42+texture2D(owrock,owPosition.xz*.004).a*7.0));':''}
if(owCliff>.02)owGround=mix(owGround,owRock,owCliff*(1.0-.3*owSnow));
if(owTrail>.01){
 // packed dirt (darker than the open ground round it)
 vec4 owRoad=${map.theme==='snow'?'vec4(owGround.rgb*vec3(.8,.84,.9),owGround.a)':map.theme==='desert'?'vec4(owSample(owdirt,owP.xz*1.7).rgb*vec3(.86,.8,.74),owGround.a*.6)':'owSample(owdirt,owP.xz)'};
 owGround=mix(owGround,owRoad,smoothstep(.15,.85,owTrail)*.9*(1.0-owCliff));
}
${map.theme==='snow'&&detailed?`
// the groomed pistes: corduroy, the groomer's fine ridges running straight down the slope (close by only)
{ vec2 owFall=normalize(owSurfaceNormal).xz; float owSl=length(owFall);
  if(owTrail>.2&&owSl>.07){ vec2 owAc=vec2(-owFall.y,owFall.x)/owSl; float owCord=sin(dot(owPosition.xz,owAc)*14.0);
   float owK=smoothstep(.2,.8,owTrail)*smoothstep(.07,.16,owSl)*smoothstep(16.0,5.0,length(cameraPosition-owPosition));
   owGround.rgb*=1.0-.07*owK*(.5+.5*owCord); owGround.a=mix(owGround.a,.45+.3*owCord,.6*owK); } }`:''}
${map.sea?`{ // a sea world: sand along the beaches and under the water
 float owSand=1.0-smoothstep(${(map.sea.level+.8).toFixed(2)},${(map.sea.level+2.8).toFixed(2)},owPosition.y);
 owGround=mix(owGround,vec4(owSample(owdirt,owP.xz*1.6).rgb*vec3(1.55,1.42,1.12),owGround.a*.7),owSand*(1.0-owCliff*.7)); }`:''}
float owMacro=texture2D(owrock,owPosition.xz*.008).a;
vec3 owAlbedo=pow(owGround.rgb,vec3(2.2));
diffuseColor.rgb*=owAlbedo*(.86+owMacro*.34);
float owRelief=owGround.a*(owBiome>1.5?.09:.16);
`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
${detailed?'normal=owBump(-vViewPosition,normal,vec2(dFdx(owRelief),dFdy(owRelief)));':''}
`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
${detailed&&map.theme!=='desert'?`
// snow glitters: the odd grain catches the sun, and which ones do changes as you move (only close by, where a grain is
// bigger than a speck)
if(owSnow>.5&&owCliff<.5){
 vec3 owEye=cameraPosition-owPosition;float owDist=length(owEye);
 vec3 owGrain=floor(owPosition*30.0)+floor(owEye/owDist*7.0)*17.0;
 float owGlint=step(.996,fract(sin(dot(owGrain,vec3(12.9898,78.233,37.719)))*43758.5453));
 totalEmissiveRadiance+=vec3(.9,.95,1.0)*owGlint*smoothstep(20.0,4.0,owDist)*(1.0-owTrail)*1.3;
}`:''}
${map.sea?`{ // sunlight focused by the waves, dancing on the seabed (fading with depth)
 float owD=${map.sea.level.toFixed(2)}-owPosition.y;
 if(owD>-.05)totalEmissiveRadiance+=vec3(.75,.95,1.0)*owCaustic(owPosition.xz*.32,owTime*1.4)*smoothstep(-.05,.35,owD)*exp(-owD*.11)*owLight*${detailed?'.55':'.35'};
}`:''}
`).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
roughnessFactor=clamp(.78+owGround.a*.22-.09*owSnow,.65,1.0);
`);
 };
 return {material,textures,hole,dispose(){material.dispose();if(!sharedTextures)Object.values(textures).forEach(t=>t.dispose());}};
}
