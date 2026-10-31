/** Real plants all over an open world, in place of the drawn ones: ez-tree oaks and ashes (oaks.glb, tools/pack_trees.py)
 * and pines on the green worlds, spruces on the snowy ones, and Poly Haven's scanned quiver trees, boulders and
 * rooibos bushes in the desert, shrubs, nettles, dandelions and ferns on the ground (public/models/nature/wild,
 * tools/pack_nature.py). Trees and boulders are solid (terrain.addSolids: crash into a trunk, jump a low rock); the
 * bushes and flowers you ride through.
 *
 * Thousands of trees stay cheap the way a ski run's forest does (nature.mjs forestScenery): the full models close by,
 * simpler ones further out, and out to the fog a picture of the tree on two crossed cards (taken of the model itself
 * when the world loads). Everything of one kind draws in one go: as you move, each tree is put in the list for how far
 * off it is. The small plants on the ground only grow in squares round you (made as you come near).
 *
 * The leaves sway in the wind (gusts rolling across, the treetops most, the leaves fluttering), and glow where the sun
 * shines through them (looking towards the sun). */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {loadNature,loadSpruces,snowy,autumnal,AUTUMN} from './nature.mjs';

const files=new Map();
/** A model file's meshes by name (a promise, shared). */
function meshes(file){
 if(!files.has(file))files.set(file,new GLTFLoader().loadAsync('/models/nature/'+file).then(g=>{const out={};g.scene.traverse(o=>{if(o.isMesh)out[o.name]=o;});return out;}).catch(e=>{files.delete(file);throw e;}));
 return files.get(file);
}
const one=ms=>Object.values(ms);
let oaksLoading=null;
/** The leafy trees (ez-tree's Oak Medium, Oak Large and Ash Medium): [{bark, leaves, far: {bark, leaves}}], mats. */
function loadOaks(){
 return oaksLoading||(oaksLoading=meshes('oaks.glb').then(ms=>{
  const bark=ms.oak0_bark.material,leaves=ms.oak0_leaves.material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,6);}   // (the bark's texture runs a branch's length once: repeat it up the trunk)
  leaves.side=THREE.DoubleSide;leaves.alphaTest=.45;
  return {trees:[0,1,2].map(k=>({bark:ms['oak'+k+'_bark'].geometry,leaves:ms['oak'+k+'_leaves'].geometry,far:{bark:ms['oak'+k+'_far_bark'].geometry,leaves:ms['oak'+k+'_far_leaves'].geometry}})),mats:{bark,leaves}};
 }).catch(e=>{oaksLoading=null;throw e;}));
}
const leafy=m=>{m.side=THREE.DoubleSide;m.alphaTest=.45;m.transparent=false;m.depthWrite=true;return m;};
/** The wild models a scanned file holds: [{geo, mat}] (every mesh in it, one material). */
const scanned=(file,leaf=false)=>meshes('wild/'+file).then(ms=>one(ms).map(m=>({geo:m.geometry,mat:leaf?leafy(m.material):m.material})));

// ------------------------------------------------------------------------------------------------ the wind and the sun
const WIND={uWT:{value:0},uWK:{value:1},uSunD:{value:new THREE.Vector3(0,1,0)},uSunC:{value:new THREE.Color(1,1,1)}};
/** A copy of a plant's material that sways in the wind: bend (how far the top moves, by the height squared: the
    trunk's foot stays put), flutter (each leaf on its own, quick), glow (the sun shining through, seen against it). */
function foliage(src,{bend=.0012,flutter=0,glow=0}={}){
 const m=src.clone(),prev=src.onBeforeCompile,prevKey=src.customProgramCacheKey?.bind(src);
 const own=prev&&prev!==THREE.Material.prototype.onBeforeCompile?prev:null;
 m.onBeforeCompile=(sh,r)=>{
  own?.call(m,sh,r);Object.assign(sh.uniforms,WIND);
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uWT,uWK;\nvarying vec3 vFolW;').replace('#include <begin_vertex>',`#include <begin_vertex>
{ vec3 fr=vec3(0.0);
#ifdef USE_INSTANCING
  fr=instanceMatrix[3].xyz;
#endif
  float ph=uWT*1.25+fr.x*.13+fr.z*.11,gust=.55+.45*sin(uWT*.45-fr.x*.012-fr.z*.009),h=max(transformed.y,0.0);
  transformed.xz+=vec2(.8,.5)*(sin(ph)+.4*sin(ph*2.3+1.0)+.6)*gust*uWK*${bend.toFixed(5)}*h*h;
  ${flutter?`transformed+=vec3(.6,.35,.5)*sin(uWT*7.0+position.x*9.0+position.z*7.0+position.y*5.0+fr.x)*${flutter.toFixed(4)}*gust*uWK*min(h,1.0);`:''} }`)
   .replace('#include <project_vertex>',`#include <project_vertex>
{ vec4 fw=vec4(transformed,1.0);
#ifdef USE_INSTANCING
  fw=instanceMatrix*fw;
#endif
  vFolW=(modelMatrix*fw).xyz; }`);
  // (far off, a leaf texture's smaller copies mix its leaves with the black of the see-through parts round them: the
  // leaves would go dark, so undo that by how see-through the mix is)
  if(m.alphaTest>0)sh.fragmentShader=sh.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb/=max(diffuseColor.a,.35);');
  if(glow)sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform vec3 uSunD,uSunC;\nvarying vec3 vFolW;').replace('#include <opaque_fragment>',`{ // the sun shining through the leaves, looking towards it
 float back=pow(max(dot(normalize(vFolW-cameraPosition),uSunD),0.0),3.0);
 outgoingLight+=diffuseColor.rgb*uSunC*back*${glow.toFixed(2)};
}
#include <opaque_fragment>`);
  else sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vFolW;');
 };
 m.customProgramCacheKey=()=>'wild-'+bend+'-'+flutter+'-'+glow+(m.alphaTest>0?'-cut':'')+(prevKey?'-'+prevKey():'');
 return m;
}

// ------------------------------------------------------------------------------------------------ pictures for far off
/** A picture of a model (its parts: [[geometry, material]]) from the side, lit evenly, on see-through: the texture and
    the size of the model { tex, wide, tall, low }. */
function photograph(renderer,parts){
 const box=new THREE.Box3();for(const [g] of parts){if(!g.boundingBox)g.computeBoundingBox();box.union(g.boundingBox);}
 const wide=Math.max(box.max.x-box.min.x,box.max.z-box.min.z),tall=box.max.y-box.min.y,W=128,H=Math.min(512,Math.max(64,Math.round(W*tall/wide/32)*32));
 const scene=new THREE.Scene();scene.add(new THREE.AmbientLight('#ffffff',Math.PI));
 for(const [g,m] of parts)scene.add(new THREE.Mesh(g,m));
 const cx=(box.min.x+box.max.x)/2,cam=new THREE.OrthographicCamera(-wide/2,wide/2,tall/2,-tall/2,-wide*2,wide*2);cam.position.set(cx,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2);cam.lookAt(cx,cam.position.y,cam.position.z-1);
 const rt=new THREE.WebGLRenderTarget(W*2,H*2,{generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
 const was=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),sun=WIND.uSunC.value.clone();WIND.uSunC.value.set(0,0,0);   // (no sun through the leaves in the picture)
 renderer.setRenderTarget(rt);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(scene,cam);
 renderer.setRenderTarget(was);renderer.setClearColor(clear,alpha);WIND.uSunC.value.copy(sun);
 return {tex:rt.texture,rt,wide,tall,low:box.min.y};
}
/** Two crossed cards showing a picture (photograph), standing on the ground, lit from above like the ground round them. */
function cards(p){
 const card=new THREE.PlaneGeometry(p.wide,p.tall).translate(0,p.low+p.tall/2,0),geo=mergeGeometries([card,card.clone().rotateY(Math.PI/2)]);card.dispose();
 const n=geo.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);
 const mat=new THREE.MeshLambertMaterial({map:p.tex,alphaTest:.5,side:THREE.DoubleSide});
 // (a two-sided card's back would face down, unlit: both sides face up here)
 mat.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0','1.0'));};
 mat.customProgramCacheKey=()=>'wild-card';
 return {geo,mat};
}

// ------------------------------------------------------------------------------------------------ what grows where
/** The kinds of plant for a world (each: how many to a km², how big, where, solid or not, and its models). */
async function catalogue(map){
 const theme=map.theme,autumn=!!map.look?.autumn,snow=theme==='snow';
 if(theme==='desert'){
  const [q1t,q1l,q2,dq,ba,bb,bc,roo]=await Promise.all([scanned('quiver1-trunk.glb'),scanned('quiver1-leaf.glb'),scanned('quiver2.glb'),scanned('deadquiver.glb'),scanned('boulder-a.glb'),scanned('boulder-b.glb'),scanned('boulder-c.glb'),scanned('rooibos.glb',true)]);
  return [
   {id:'quiver',like:'deadtree',per:150,size:[1.3,2.1],cluster:.3,slope:.85,clear:7,solid:{r:.42,tall:4},card:true,variants:[{near:[[q1t[0],0],[q1l[0],1]]},{near:[[q2[0],0]]}],winds:[{bend:.0006},{bend:.0006,flutter:.01}]},
   {id:'deadquiver',like:'deadtree',per:30,size:[1.1,1.7],cluster:.2,slope:.85,clear:7,solid:{r:.3,tall:3},card:true,variants:[{near:[[dq[0],0]]}],winds:[{bend:0}]},
   {id:'boulder',like:'rock',per:120,size:[.7,2.1],cluster:.35,slope:.6,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,tint:[1.25,.86,.68],variants:[{near:[[ba[0],0]]},{near:[[bb[0],0]]},{near:[[bc[0],0]]}],winds:[{bend:0}]},
   {id:'rooibos',like:'shrub',per:9000,size:[.7,1.4],cluster:.25,slope:.75,clear:2.5,cover:true,near:70,variants:roo.map(r=>({near:[[r,0]]})),winds:[{bend:.05,flutter:.015,glow:.25}]},
  ].map(k=>resolve(k));
 }
 const [nature,oaks,spruces,sa,sb,sc,nt,dd]=await Promise.all([loadNature(),snow?null:loadOaks(),snow?loadSpruces():null,
  snow?null:scanned('shrub-a.glb',true),snow?null:scanned('shrub-b.glb',true),null,snow?null:scanned('nettle.glb',true),snow||autumn?null:scanned('dandelion.glb',true)]);
 if(snow){
  const S=spruces||nature,bark=snowy(S.mats.bark),needles=snowy(S.mats.needles,.3);
  return [
   {id:'spruce',like:'snowpine',per:700,size:[.8,1.6],cluster:.5,slope:.8,clear:8,line:430,solid:{r:.42,tall:14},card:true,mats:[bark,needles],variants:S.pines.map(p=>({near:[[{geo:p.bark},0],[{geo:p.leaves},1]],far:[[{geo:p.far.bark},0],[{geo:p.far.leaves},1]]})),winds:[{bend:.0006},{bend:.0006,flutter:.008,glow:.12}]},
   {id:'boulder',like:'rock',per:70,size:[.8,2.2],cluster:.4,slope:.5,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,variants:nature.rocks.map((g,i)=>({near:[[{geo:g,mat:snowy(nature.rockMat[i])},0]]})),winds:[{bend:0}]},
  ].map(k=>resolve(k));
 }
 const P=nature.pines,M=nature.mats,oakLeaves=autumn?autumnal(oaks.mats.leaves):oaks.mats.leaves,bushLeaves=autumn?autumnal(M.leaves):M.leaves,fern=autumn?autumnal(M.fern):M.fern;
 return [
  {id:'oak',like:'broadleaf',per:300,size:[.75,1.25],cluster:.35,slope:.84,clear:8,line:380,solid:{r:.45,tall:9},card:true,autumn,mats:[oaks.mats.bark,oakLeaves],variants:oaks.trees.map(t=>({near:[[{geo:t.bark},0],[{geo:t.leaves},1]],far:[[{geo:t.far.bark},0],[{geo:t.far.leaves},1]]})),winds:[{bend:.0011},{bend:.0011,flutter:.03,glow:.35}]},
  {id:'pine',like:'pine',per:380,size:[.8,1.7],cluster:.55,slope:.8,clear:8,line:460,solid:{r:.42,tall:14},card:true,mats:[M.bark,M.needles],variants:P.map(p=>({near:[[{geo:p.bark},0],[{geo:p.leaves},1]],far:[[{geo:p.far.bark},0],[{geo:p.far.leaves},1]]})),winds:[{bend:.0006},{bend:.0006,flutter:.008,glow:.18}]},
  {id:'boulder',like:'rock',per:45,size:[.7,2],cluster:.4,slope:.55,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,variants:nature.rocks.map((g,i)=>({near:[[{geo:g,mat:nature.rockMat[i]},0]]})),winds:[{bend:0}]},
  {id:'bush',like:'shrub',per:1500,size:[.8,1.5],cluster:.3,slope:.75,clear:3,cover:true,near:80,autumn,mats:[M.twigs,bushLeaves],variants:nature.bushes.map(b=>({near:[[{geo:b.bark},0],[{geo:b.leaves},1]]})),winds:[{bend:.035},{bend:.035,flutter:.03,glow:.3}]},
  {id:'shrub',like:'shrub',per:3000,size:[.7,1.3],cluster:.25,slope:.75,clear:2.5,cover:true,near:70,variants:sa.map(r=>({near:[[r,0]]})),winds:[{bend:.04,flutter:.02,glow:.3}]},
  {id:'fern',like:'shrub',per:8000,size:[.8,1.5],cluster:.4,slope:.7,clear:2,cover:true,near:55,autumn,mats:[fern],variants:nature.ferns.map(g=>({near:[[{geo:g},0]]})),winds:[{bend:.08,flutter:.02,glow:.3}]},
  {id:'weeds',like:'shrub',per:40000,size:[.8,1.4],cluster:.15,slope:.7,clear:1.5,cover:true,near:45,variants:[...sb,...nt].map(r=>({near:[[r,0]]})),winds:[{bend:.2,flutter:.02,glow:.3}]},
  ...(dd?[{id:'flowers',like:'shrub',per:15000,size:[.9,1.4],cluster:.5,slope:.75,clear:1.5,cover:true,near:40,variants:dd.map(r=>({near:[[r,0]]})),winds:[{bend:.3,flutter:.02,glow:.3}]}]:[]),
 ].map(k=>resolve(k));
}
/** Fill in a kind's materials: each part [model ({geo, mat} or {geo} with the kind's mats[k]), k] becomes [geo, its
    material made to sway (winds[k], or the last of them)]. */
function resolve(k){
 const made=new Map();
 const sway=(mat,i)=>{const key=mat.uuid+':'+i;if(!made.has(key))made.set(key,foliage(mat,k.winds[Math.min(i,k.winds.length-1)]));return made.get(key);};
 const fix=list=>list?.map(([m,i])=>[m.geo,sway(m.mat||k.mats[i],i)]);
 return {...k,variants:k.variants.map(v=>({near:fix(v.near),far:fix(v.far)})),materials:[...made.values()]};
}

// ------------------------------------------------------------------------------------------------ the scenery
/** Grows the plants on a built open world (world.mjs buildOpenWorld: its plantable() and hideKinds()) into scene, as
    soon as their models have loaded (a promise of { update(eye, dt), dispose() }). quality (0..1): how many and how
    far; renderer: for the pictures far off (without one, the trees just end at the far models); sun: the sun's
    direction and colour (the light through the leaves); night: no sun through them. */
export async function growWilds(built,map,scene,{quality=1,renderer=null,shadows=false,sunDir=null,sunColor=null,night=false}={}){
 if(Array.isArray(map.look?.flora)&&!map.look.flora.length)return null;   // (a world with no plants: a skate plaza)
 const kinds=(await catalogue(map)).filter(k=>!map.look?.flora||map.look.flora.includes(k.like)||k.like==='shrub'&&map.look.flora.includes('shrub'));
 if(!kinds.length)return null;
 const terrain=built.terrain,[W,D]=map.size,seed0=map.seed>>>0;
 if(sunDir)WIND.uSunD.value.copy(sunDir).normalize();
 WIND.uSunC.value.set(sunColor||'#fff4e0').multiplyScalar(night?0:map.look?.storm?.25:map.look?.dusk?.3:1);
 WIND.uWK.value=map.look?.storm?2.2:map.look?.weather==='blizzard'?1.8:1;
 const q=Math.max(.3,quality),NEAR=35+45*q,MID=110+190*q,FAR=Math.min(2600,1300+900*q);
 const noise=(x,z,k)=>{let n=0,a=.5,f=1/300,t=0;for(let i=0;i<3;i++){n+=a*Math.sin(x*f*1.7+z*f*.6+k*5.1+i*2.3)*Math.cos(z*f*1.3-x*f*.4+k*3.7+i*1.1);t+=a;a*=.5;f*=2.1;}return .5+.5*n/t;};
 const hash=(x,z,s)=>{let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^s;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const dummy=new THREE.Object3D(),own=[],made=[];
 // a tree's or rock's place: { x, z, m (its matrix), v (which variant), shade, leaf (its leaves' colour in autumn) }
 const place=(k,x,z,s,rot,v,r)=>{
  const y=built.renderHeightAt(x,z)-(k.rock?.2*s:.12*s);dummy.position.set(x,y,z);dummy.rotation.set(k.rock?(r-.5)*.3:0,rot,k.rock?(r-.5)*.2:0);
  dummy.scale.set(s,k.rock?s*(.75+r*.5):s,s);dummy.updateMatrix();
  return {x,z,y,s,m:dummy.matrix.clone(),v,shade:.82+r*.3,leaf:k.autumn?AUTUMN[Math.floor(r*AUTUMN.length*.999)]:k.tint||null};   // (k.tint: the desert's boulders take on its red)
 };
 // the challenges' courses stay clear of trees and boulders: a corridor down the straight line from the start, through
 // each gate (a ring in the sky too: the wingsuit has to get down to it) to the finish, as wide as the gates
 const lanes=[];
 try{
  const C=(await (await fetch('/js/games/moto/open-world/challenges.json')).json()).challenges.filter(c=>c.world===map.id);
  const at=id=>map.spots?.find(p=>p.id===id)?.position||map.safePads?.find(p=>p.id===id)?.position;
  for(const c of C){const pts=[at(c.from),...(c.gates||[]).map(g=>[g[0],g[1],g[2]]),at(c.to)].filter(Boolean);for(let i=1;i<pts.length;i++)lanes.push([pts[i-1],pts[i],Math.max(14,pts[i][2]||0,pts[i-1][2]||0)]);}
 }catch{}
 const inLane=(x,z)=>lanes.some(([a,b,w])=>{const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<w;});
 const spot=(k,x,z)=>(!k.cluster||noise(x,z,k.id.length)>=k.cluster*.9)&&built.plantable(x,z,{clear:k.clear,slope:k.slope,line:k.line,rise:k.rock?260:90})&&(k.cover||!inLane(x,z));
 // ---- the trees and rocks: all of them now (they're solid everywhere)
 let s=seed0^0x5bd1e995;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 const big=kinds.filter(k=>!k.cover),spaced=new Map(),solids=[];
 const room=(x,z,r)=>{for(let gx=Math.floor((x-r)/8);gx<=Math.floor((x+r)/8);gx++)for(let gz=Math.floor((z-r)/8);gz<=Math.floor((z+r)/8);gz++)for(const o of spaced.get(gx+','+gz)||[])if(Math.hypot(o.x-x,o.z-z)<r+o.r)return false;return true;};
 const keep=(x,z,r)=>{const key=Math.floor(x/8)+','+Math.floor(z/8);if(!spaced.has(key))spaced.set(key,[]);spaced.get(key).push({x,z,r});};
 const dens=.45+.55*q;
 for(const k of big){
  k.items=[];const n=Math.round(k.per*W*D/1e6*dens);
  for(let i=0;i<n;i++){
   const x=(rnd()-.5)*W,z=(rnd()-.5)*D,r1=rnd(),r2=rnd(),r3=rnd();
   const sz=k.size[0]+(k.size[1]-k.size[0])*Math.pow(r1,1.5),gap=k.rock?1.2*sz:1.6*sz;
   if(!spot(k,x,z)||!room(x,z,gap)||terrain.obstacleAt(x,z))continue;
   keep(x,z,gap);const v=Math.floor(r2*k.variants.length*.999),it=place(k,x,z,sz,r3*6.283,v,r2);it.k=k;k.items.push(it);
   if(k.solid){
    let r=k.solid.r*sz,tall=k.solid.tall*sz;
    if(k.solid.byBox){const g=k.variants[v].near[0][0];if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox;r=Math.min(b.max.x-b.min.x,b.max.z-b.min.z)*.42*sz;tall=b.max.y*sz*(.75+r2*.5)*.8;}
    solids.push({x,z,r,tall});
   }
  }
 }
 terrain.addSolids(solids);
 // ---- one drawing (instanced) per part of each variant and how close: 0 the full model, 1 the far one, 2 the picture
 const draws=[];
 const drawOf=(geo,mat,cap,cast)=>{const im=new THREE.InstancedMesh(geo,mat,Math.max(1,cap));im.count=0;im.frustumCulled=false;im.castShadow=cast;im.receiveShadow=true;scene.add(im);own.push(im);draws.push(im);return im;};
 for(const k of big){
  k.draws=k.variants.map((v,vi)=>{
   const n=k.items.filter(it=>it.v===vi).length;
   const near=v.near.map(([g,m])=>drawOf(g,m,n,shadows));
   const far=v.far?v.far.map(([g,m])=>drawOf(g,m,n,false)):null;
   let card=null;
   if(k.card&&renderer){const p=photograph(renderer,v.near);const c=cards(p);made.push(p.rt,c.geo,c.mat);card=drawOf(c.geo,c.mat,n,false);}
   return {near,far,card};
  });
 }
 // ---- the small plants: in 32 m squares round you, made as you come near and forgotten when you're well away
 const cover=kinds.filter(k=>k.cover),CELL=32,cells=new Map(),reach=Math.max(0,...cover.map(k=>k.near))*(.6+.4*q);
 for(const k of cover){k.draws=k.variants.map(v=>({near:v.near.map(([g,m])=>drawOf(g,m,Math.round(k.per*Math.PI*k.near*k.near/1e6*q*1.3/k.variants.length)+40,false))}));}
 function growCell(cx,cz){
  const list=[];
  for(const k of cover){
   const n=k.per*CELL*CELL/1e6*q;let c=0;
   for(let i=0;i<n*1.6&&c<n;i++){
    const h=hash(cx*7+i,cz*13-i,k.id.length*101+seed0);
    const x=(cx+hash(cx,cz+i*3,k.id.length+7))*CELL,z=(cz+hash(cx+i*5,cz,k.id.length+13))*CELL;
    if(!spot(k,x,z)||terrain.obstacleAt(x,z))continue;c++;
    const sz=k.size[0]+(k.size[1]-k.size[0])*h;list.push({k,...place(k,x,z,sz,hash(cx-i,cz+i,29)*6.283,Math.floor(h*k.variants.length*.999),hash(i,cx+cz,31))});
   }
  }
  return list;
 }
 // ---- who's where: each time you've moved a few metres, every plant goes in the list for how far off it is
 const color=new THREE.Color(),at={x:Infinity,z:Infinity};
 const put=(im,it,leaf)=>{const n=im.count++;im.setMatrixAt(n,it.m);const c=(leaf||!it.k?.autumn)&&it.leaf?it.leaf:null;im.setColorAt(n,c?color.setRGB(c[0]*it.shade,c[1]*it.shade,c[2]*it.shade):color.setRGB(it.shade,it.shade,it.shade*.97));};
 function refresh(eye){
  for(const im of draws)im.count=0;
  for(const k of big){
   const nearD=k.rock?MID*.9:NEAR;
   for(const it of k.items){
    const d=Math.hypot(it.x-eye.x,it.z-eye.z),dr=k.draws[it.v];
    if(d<nearD||(!dr.far&&d<MID))dr.near.forEach((im,i)=>put(im,it,i===1));
    else if(dr.far&&d<MID)dr.far.forEach((im,i)=>put(im,it,i===1));
    else if(dr.card&&d<FAR)put(dr.card,it,false);
   }
  }
  const gx=Math.floor(eye.x/CELL),gz=Math.floor(eye.z/CELL),span=Math.ceil(reach/CELL);
  for(let x=gx-span;x<=gx+span;x++)for(let z=gz-span;z<=gz+span;z++){
   const key=x+','+z;if(Math.hypot(Math.max(x*CELL-eye.x,0,eye.x-x*CELL-CELL),Math.max(z*CELL-eye.z,0,eye.z-z*CELL-CELL))>reach)continue;
   if(!cells.has(key))cells.set(key,growCell(x,z));
   for(const it of cells.get(key)){const lim=it.k.near*(.6+.4*q);if(Math.hypot(it.x-eye.x,it.z-eye.z)<lim){const im=it.k.draws[it.v].near;im.forEach((m,i)=>{if(m.count<m.instanceMatrix.count)put(m,it,i===1||it.k.variants[0].near.length===1);});}}
  }
  if(cells.size>900)for(const [key,list] of cells){const [x,z]=key.split(',').map(Number);if(Math.hypot(x*CELL-eye.x,z*CELL-eye.z)>reach+200)cells.delete(key);}
  for(const im of draws){im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}
  at.x=eye.x;at.z=eye.z;
 }
 // the drawn kinds these stand in for stop drawing (rocks stay: the real boulders are as well as them)
 built.hideKinds(map.theme==='desert'?['shrub','deadtree']:map.theme==='snow'?['snowpine']:['pine','broadleaf','shrub']);
 return {
  count:big.reduce((n,k)=>n+k.items.length,0),solids:solids.length,kinds:Object.fromEntries(big.map(k=>[k.id,k.items.length])),items:id=>big.find(k=>k.id===id)?.items,
  update(eye,dt){
   WIND.uWT.value=(WIND.uWT.value+dt)%1000;
   if(Math.hypot(eye.x-at.x,eye.z-at.z)>6)refresh(eye);
  },
  dispose(){for(const im of own){im.removeFromParent();im.dispose();}for(const k of kinds)for(const m of k.materials)m.dispose();for(const d of made)d.dispose();},
 };
}
