/** Tileable 1024² albedo + relief atlases, generated locally (or a world's own photo of the ground, from this site).
 * World-space triplanar projection prevents stretched cliff faces. Macro and centimetre-scale
 * detail mix with slope/altitude snow coverage; derivative bump feeds StandardMaterial lighting.
 */
import * as THREE from 'three';
import {soilTextures,SOIL_GLSL,LOOK} from '../look.js';
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
 const textures=sharedTextures || Object.fromEntries(Object.keys(palettes).map(k=>[k,texture(k,map.theme,map.look?.photo?.[k]?2048:1024,map.look)]));
 const hole=new THREE.Vector4();
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91,metalness:0});
 // a world with "look": {"soil": {...}}: its trails and tracks are a scanned ground (look.js), swapped in once its
 // pictures have loaded. "set": which scan (default "soil", the red dirt); "tint": its colour multiplied (r, g, b);
 // "scale": its tile size (1 = 2.4 m); "area" [x, z, radius]: where the steep banks and worn patches get it too (default
 // everywhere); "banks": how much of it on steep ground (0..1, default 1); "worn": the worn patches showing it through
 // the grass (0..1, default .9); "cover": the open ground itself is this ground, 0..1 (a desert's sand, a forest floor)
 const soilSpec=map.look?.soil,soil=soilSpec?soilTextures(null,{hi:LOOK.hi,set:soilSpec.set||'soil'}):null,pom=detailed&&LOOK.pom;
 const soilF=(v,d)=>(+(v??d)).toFixed(3);
 if(soil&&!soil.loaded)soil.ready.then(()=>{material.needsUpdate=true;}).catch(e=>console.warn('soil',e));
 const soilOn=()=>!!soil?.loaded;
 material.customProgramCacheKey=()=> 'ow-terrain-lod-v11-'+map.theme+'-'+detailed+(map.look?.paved?'-paved':'')+(map.sea?'-sea'+map.sea.level:'')+(soilOn()?'-soil'+(soilSpec.set||'')+(soilSpec.cover?'c':'')+(pom?'p':''):'');
 material.onBeforeCompile=shader=>{
  const S=soilOn();
  if(S){const a=soilSpec.area||[0,0,1e7];Object.assign(shader.uniforms,{soilC:{value:soil.color},soilN:{value:soil.normal},soilO:{value:soil.orh},soilPOM:{value:pom?1:0},soilScale:{value:soilSpec.scale||1},soilTint:{value:new THREE.Vector3(...(soilSpec.tint||[1,1,1]))},owSoilArea:{value:new THREE.Vector3(a[0],a[1],a[2])}});}
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
${S?SOIL_GLSL+'\nuniform vec3 owSoilArea;\n':''}
// smooth noise for the big patches of colour across the land (so a hillside isn't one flat colour)
float owH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float owN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(owH(i),owH(i+vec2(1.0,0.0)),f.x),mix(owH(i+vec2(0.0,1.0)),owH(i+vec2(1.0,1.0)),f.x),f.y);}
float owFbm(vec2 p){return owN(p)*.55+owN(p*2.07+3.1)*.3+owN(p*4.3+7.7)*.15;}
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
float owSnow=${map.theme==='snow'?'1.0':map.theme==='alpine'&&map.look?.snow!==false?'smoothstep(250.0,450.0,owPosition.y)':'0.0'};   // (look.snow false: an alpine world with no snow up high)
vec4 owGround=owCliff>.25?owTri(${map.theme==='desert'?'owdirt':map.theme==='snow'?'owsnow':'owgrass'},owP,owWeights):owSample(${map.theme==='desert'?'owdirt':map.theme==='snow'?'owsnow':'owgrass'},owP.xz);
${map.theme==='alpine'?'if(owSnow>.01)owGround=mix(owGround,owSample(owsnow,owP.xz),owSnow);':''}
// far away the fine pattern would show its repeats (and shimmer): it fades toward the texture's own average colour
float owFar=smoothstep(30.0,240.0,length(cameraPosition-owPosition));
${(()=>{const g=map.theme==='desert'?'owdirt':map.theme==='snow'?'owsnow':'owgrass';return `owGround.rgb=mix(owGround.rgb,${map.theme==='alpine'?`mix(textureLod(${g},vec2(.5),12.0).rgb,textureLod(owsnow,vec2(.5),12.0).rgb,owSnow)`:`textureLod(${g},vec2(.5),12.0).rgb`},owFar*.7);`;})()}
vec4 owRock=owTri(owrock,owP*.65,owWeights);
owRock.rgb=mix(owRock.rgb,textureLod(owrock,vec2(.5),12.0).rgb,owFar*.5);
owRock.rgb*=.72+.5*texture2D(owrock,owPosition.xz*.0021+owPosition.y*.0013).a;   // (broad light and dark patches across a mountain face)
owRock.rgb*=.86+.26*owN(vec2((owPosition.x+owPosition.z)*.06,owPosition.y*.005));   // (rain-worn streaks running down a cliff)
${map.theme==='desert'?`{ // the rock's layers: uneven bands, wavy across the face; the thin ones fade out where they'd be thinner than a pixel or two
 float owY=owPosition.y+(owFbm(owPosition.xz*.008)-.5)*22.0,owAA=1.0-smoothstep(.15,.6,fwidth(owY)*.25);
 float owS=owN(vec2(owY*.07,.5))*.65+owN(vec2(owY*.25,4.5))*.35*owAA;
 owRock.rgb*=mix(vec3(.8,.66,.58),vec3(1.1,1.02,.92),mix(.5,owS,.4+.6*owAA)); }`:''}
if(owCliff>.02)owGround=mix(owGround,owRock,owCliff*(1.0-.3*owSnow));
${map.look?.paved?`if(owCliff<.5){ // concrete: slabs 4 m square, each a touch lighter or darker, the joints between them, and stains
 vec2 owSl=owPosition.xz/4.0,owF=abs(fract(owSl)-.5);float owE=.5-max(owF.x,owF.y),owW=fwidth(owSl.x)+fwidth(owSl.y);
 float owJ=(1.0-smoothstep(.0015,.0015+owW*.8,owE))*(1.0-smoothstep(.03,.1,owW));   // (about a pixel wide, fading out far off)
 owGround.rgb*=(.93+.14*owH(floor(owSl)))*(1.0-.22*owJ)*(.9+.2*owFbm(owPosition.xz*.12)); }`:`{ // big patches of colour across the land: lusher and drier ground, lighter and darker sand
 float owM1=owFbm(owPosition.xz*.0045),owM2=owFbm(owPosition.xz*.021+7.3);
 vec3 owTint=${map.theme==='desert'?'mix(vec3(.88,.84,.84),vec3(1.1,1.05,.95),owM1)':map.theme==='snow'?'mix(vec3(.95,.97,1.03),vec3(1.03,1.02,1.0),owM1)':'mix(mix(vec3(.66,.8,.7),vec3(.86,.96,.8),smoothstep(.15,.45,owM2)),vec3(1.18,1.08,.74),smoothstep(.35,.7,owM1))'};
 ${map.theme==='alpine'?'owGround.rgb=mix(vec3(dot(owGround.rgb,vec3(.3,.59,.11))),owGround.rgb,.82);':''}
 owGround.rgb*=mix(vec3(1.0),owTint*(${map.theme==='snow'?'.96+.08':'.88+.24'}*owM2),(1.0-owCliff)*(1.0-owSnow*${map.theme==='snow'?'0.0':'1.0'})); }`}
${map.look?.grassMul?`owGround.rgb*=mix(vec3(1.0),vec3(${map.look.grassMul.map(v=>(+v).toFixed(3)).join(',')}),1.0-owCliff);   // (look.grassMul: this world's grass a touch greener or drier)`:''}
${S?`float owSoilK=0.0;Soil owS;float owSoilAO=1.0;
{ float owDist=length(cameraPosition-owPosition);vec3 owNW=normalize(owSurfaceNormal);
  float owIn=1.0-smoothstep(owSoilArea.z*.8,owSoilArea.z,length(owPosition.xz-owSoilArea.xy)),owWF=owFbm(owPosition.xz*.055+1.7);
  // (the scan is only worked out where it shows: trails, a world's open ground, the worn patches)
  owS.albedo=vec3(.5);owS.n=owNW;owS.ao=1.0;owS.rough=1.0;owS.h=.5;
  if(owTrail>.01${soilSpec.cover?'||owIn>0.0':''}||(owIn>0.0&&owWF>.44&&${soilF(soilSpec.worn,.9)}>0.0))owS=soilAt(owPosition,owNW,cameraPosition,owDist);
  // the track: soil, its edge broken up by the soil's own lumps (grass wins on the low bits)
  owSoilK=smoothstep(.2,.7,owTrail+(owS.h-.4)*.45*smoothstep(0.0,.35,owTrail))*(1.0-owCliff*.25);
  // the cut banks round the track: steep earth, soil from all sides
  if(owIn>0.0&&owCliff>.02){float a;vec4 owT=soilTri(owPosition,owWeights,a);float k=smoothstep(.05,.5,owCliff)*owIn*${soilF(soilSpec.banks,1)};
   owGround=mix(owGround,vec4(owT.rgb,owT.a),k);owSoilAO=mix(1.0,a,k);}
  // worn patches on the grassy slopes round the track: the red earth showing through the grass, ragged-edged
  ${soilSpec.cover?`{ // the open ground is this ground (its lumps breaking up any grass edge)
   float c=clamp(${soilF(soilSpec.cover,0)}+(owS.h-.5)*.3,0.0,1.0)*owIn*(1.0-smoothstep(.3,.7,owCliff));
   owGround=mix(owGround,vec4(owS.albedo,owS.h),c);owSoilAO=mix(owSoilAO,owS.ao,c); }`:''}
  if(owIn>0.0){float e=smoothstep(.6,.74,owWF+(owS.h-.5)*.3)*owIn*(1.0-owCliff)*${soilF(soilSpec.worn,.9)}*(1.0-owSoilK);
   owGround=mix(owGround,vec4(owS.albedo*.92,owS.h),e);owSoilAO=mix(owSoilAO,owS.ao,e);}
  if(owSoilK>0.0){owGround=mix(owGround,vec4(owS.albedo,owS.h),owSoilK);owSoilAO=mix(owSoilAO,owS.ao,owSoilK);}
}`:''}
if(${S?'false&&':''}owTrail>.01){
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
${S?'diffuseColor.rgb*=mix(1.0,owSoilAO,.55);owRelief*=1.0-owSoilK;':''}
`).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
${detailed?'normal=owBump(-vViewPosition,normal,vec2(dFdx(owRelief),dFdy(owRelief)));':''}
${S?'if(owSoilK>0.0)normal=normalize(mix(normal,normalize((viewMatrix*vec4(owS.n,0.0)).xyz),owSoilK*'+(detailed?'1.0':'.7')+'));':''}
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
${S?'roughnessFactor=mix(roughnessFactor,clamp(owS.rough*1.05,.55,1.0),owSoilK);':''}
`);
 };
 return {material,textures,hole,dispose(){material.dispose();if(!sharedTextures)Object.values(textures).forEach(t=>t.dispose());}};
}
