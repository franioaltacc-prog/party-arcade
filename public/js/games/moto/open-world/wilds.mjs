/** Real plants all over an open world, in place of the drawn ones: ez-tree oaks and ashes (oaks.glb, tools/pack_trees.py)
 * and pines on the green worlds, spruces on the snowy ones, and Poly Haven's scanned quiver trees, boulders and
 * rooibos bushes in the desert, shrubs, nettles, dandelions and ferns on the ground (public/models/nature/wild,
 * tools/pack_nature.py). Trees and boulders are solid (terrain.addSolids: crash into a trunk, jump a low rock); the
 * bushes and flowers you ride through.
 *
 * The trees grow in woods (a forest where a big soft pattern across the map says so, thinning out at its edges, with
 * the odd lone tree out in the meadows), and the far hills beyond where you can ride get their own tree lines.
 * Tens of thousands of trees stay cheap the way a ski run's forest does (nature.mjs forestScenery): the full models close
 * by, simpler ones further out, and out to the fog a picture of the tree on two crossed cards (taken of the model itself
 * when the world loads). Each kind draws in one go; the cards are one fixed set (a card near you folds away, its tree is
 * drawn instead), and only the trees near you are sorted as you move. The small plants on the ground (bushes, ferns,
 * saplings, stones and fallen logs too) only grow in squares round you, a few squares a frame as you come near.
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
const CARD={uNear:{value:100}};
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
 const mat=new THREE.MeshLambertMaterial({map:p.tex,alphaTest:.5,side:THREE.DoubleSide,color:new THREE.Color(1.3,1.3,1.3)});   // (lit from above only, a picture of a tree reads darker than the tree: a touch brighter)
 // (a two-sided card's back would face down, unlit: both sides face up here)
 // (and a card within CARD.uNear of the camera folds away to nothing: the full or simpler tree stands there instead, so
 // the cards are one set made once, never sorted as you move)
 mat.onBeforeCompile=sh=>{sh.uniforms.uNear=CARD.uNear;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uNear;').replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
  if(distance((modelMatrix*instanceMatrix[3]).xz,cameraPosition.xz)<uNear)transformed=vec3(0.0);
#endif`);
  sh.fragmentShader=sh.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0','1.0'))
   .replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb/=max(diffuseColor.a,.3);');};   // (far off, the picture's smaller copies mix the tree with the black round it: undo that, as the leaves do)
 mat.customProgramCacheKey=()=>'wild-card';
 return {geo,mat};
}

// ------------------------------------------------------------------------------------------------ what grows where
/** The kinds of plant for a world. A tree or rock kind: per (to a km² out in the open), dense (to a km² deep in its
    woods), woods (which pattern it grows in: 'trees' or 'rocks'), mix (on the green worlds: +1 the leafy woods, -1 the
    pine woods), size, slope (the ground's up, 0..1, at least), clear (metres off the trails), line (its tree line),
    solid. A small plant (cover): per (to a km², all over), where ('woods' more under the trees, 'open' more out in the
    meadows), near (metres from you it's drawn). Then its models and how it sways. */
async function catalogue(map){
 const theme=map.theme,autumn=!!map.look?.autumn,snow=theme==='snow';
 if(theme==='desert'){
  const [q1t,q1l,q2,dq,ba,bb,bc,roo]=await Promise.all([scanned('quiver1-trunk.glb'),scanned('quiver1-leaf.glb'),scanned('quiver2.glb'),scanned('deadquiver.glb'),scanned('boulder-a.glb'),scanned('boulder-b.glb'),scanned('boulder-c.glb'),scanned('rooibos.glb',true)]);
  const red=[1.25,.86,.68],rocks=[ba,bb,bc].map(r=>({near:[[r[0],0]]}));
  for(const m of [q1t[0].mat,q2[0].mat])m.color.setRGB(3.2,2.9,2.5);dq[0].mat.color.setRGB(2,1.85,1.65);q1l[0].mat.color.setRGB(1.8,1.8,1.6);   // (the scans' bark is dark: a quiver tree's is pale, golden grey)
  return [
   {id:'quiver',like:'deadtree',tree:true,per:60,dense:1100,woods:'trees',size:[1.3,2.1],slope:.85,clear:7,solid:{r:.42,tall:4},card:true,variants:[{near:[[q1t[0],0],[q1l[0],1]]},{near:[[q2[0],0]]}],winds:[{bend:.0006},{bend:.0006,flutter:.01}]},
   {id:'deadquiver',like:'deadtree',tree:true,per:20,dense:250,woods:'trees',size:[1.1,1.7],slope:.85,clear:7,solid:{r:.3,tall:3},card:true,variants:[{near:[[dq[0],0]]}],winds:[{bend:0}]},
   {id:'boulder',like:'rock',per:90,dense:1800,woods:'rocks',size:[.7,2.1],slope:.6,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,tint:red,variants:rocks,winds:[{bend:0}]},
   {id:'rooibos',like:'shrub',cover:true,per:22000,where:'woods',size:[.7,1.4],slope:.75,near:80,variants:roo.map(r=>({near:[[r,0]]})),winds:[{bend:.05,flutter:.015,glow:.25}]},
   {id:'stones',like:'rock',cover:true,per:7000,size:[.12,.4],slope:.6,near:70,rock:true,tint:red,variants:rocks,winds:[{bend:0}]},
  ].map(k=>resolve(k));
 }
 const [nature,oaks,spruces,sa,sb,nt,dd]=await Promise.all([loadNature(),snow?null:loadOaks(),snow?loadSpruces():null,
  snow?null:scanned('shrub-a.glb',true),snow?null:scanned('shrub-b.glb',true),snow?null:scanned('nettle.glb',true),snow||autumn?null:scanned('dandelion.glb',true)]);
 const M=nature.mats,rockv=mat=>nature.rocks.map((g,i)=>({near:[[{geo:g,mat:mat(nature.rockMat[i])},0]]})),same=m=>m;
 if(snow){
  const S=spruces||nature,bark=snowy(S.mats.bark),needles=snowy(S.mats.needles,.12),twigs=snowy(M.twigs),leaves=snowy(M.leaves,.35);
  const spruce=S.pines.map(p=>({near:[[{geo:p.bark},0],[{geo:p.leaves},1]],far:[[{geo:p.far.bark},0],[{geo:p.far.leaves},1]]}));
  return [
   {id:'spruce',like:'snowpine',tree:true,per:150,dense:13000,woods:'trees',size:[.8,1.6],slope:.8,clear:8,line:430,solid:{r:.42,tall:14},card:true,tint:[.78,.95,.84],mats:[bark,needles],variants:spruce,winds:[{bend:.0006},{bend:.0006,flutter:.008}]},
   {id:'boulder',like:'rock',per:45,dense:900,woods:'rocks',size:[.8,2.2],slope:.5,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,variants:rockv(m=>snowy(m)),winds:[{bend:0}]},
   {id:'young',like:'snowpine',cover:true,per:1800,where:'woods',size:[.1,.18],slope:.75,near:110,mats:[bark,needles],variants:spruce.map(v=>({near:v.far})),winds:[{bend:.004},{bend:.004,flutter:.01}]},
   {id:'bush',like:'shrub',cover:true,per:3500,where:'woods',size:[.7,1.3],slope:.75,near:80,mats:[twigs,leaves],variants:nature.bushes.map(b=>({near:[[{geo:b.bark},0],[{geo:b.leaves},1]]})),winds:[{bend:.03},{bend:.03,flutter:.02}]},
   {id:'stones',like:'rock',cover:true,per:2500,size:[.2,.55],slope:.6,near:70,rock:true,variants:rockv(m=>snowy(m)),winds:[{bend:0}]},
  ].map(k=>resolve(k));
 }
 const P=nature.pines,oakLeaves=autumn?autumnal(oaks.mats.leaves):oaks.mats.leaves,bushLeaves=autumn?autumnal(M.leaves):M.leaves,fern=autumn?autumnal(M.fern):M.fern;
 const oakv=oaks.trees.map(t=>({near:[[{geo:t.bark},0],[{geo:t.leaves},1]],far:[[{geo:t.far.bark},0],[{geo:t.far.leaves},1]]}));
 return [
  {id:'oak',like:'broadleaf',tree:true,per:120,dense:9000,woods:'trees',mix:1,size:[.75,1.25],slope:.84,clear:8,line:380,solid:{r:.45,tall:9},card:true,autumn,mats:[oaks.mats.bark,oakLeaves],variants:oakv,winds:[{bend:.0011},{bend:.0011,flutter:.03,glow:.35}]},
  {id:'pine',like:'pine',tree:true,per:120,dense:12000,woods:'trees',mix:-1,size:[.8,1.7],slope:.8,clear:8,line:460,solid:{r:.42,tall:14},card:true,mats:[M.bark,M.needles],variants:P.map(p=>({near:[[{geo:p.bark},0],[{geo:p.leaves},1]],far:[[{geo:p.far.bark},0],[{geo:p.far.leaves},1]]})),winds:[{bend:.0006},{bend:.0006,flutter:.008,glow:.18}]},
  {id:'boulder',like:'rock',per:35,dense:700,woods:'rocks',size:[.7,2],slope:.55,clear:7,solid:{r:.9,tall:1.4,byBox:true},rock:true,variants:rockv(same),winds:[{bend:0}]},
  {id:'sapling',like:'broadleaf',cover:true,per:1600,where:'woods',size:[.16,.26],slope:.8,near:110,autumn,mats:[oaks.mats.bark,oakLeaves],variants:oakv.map(v=>({near:v.far})),winds:[{bend:.006},{bend:.006,flutter:.03,glow:.35}]},
  {id:'bush',like:'shrub',cover:true,per:5000,where:'woods',size:[.8,1.5],slope:.75,near:90,autumn,mats:[M.twigs,bushLeaves],variants:nature.bushes.map(b=>({near:[[{geo:b.bark},0],[{geo:b.leaves},1]]})),winds:[{bend:.035},{bend:.035,flutter:.03,glow:.3}]},
  {id:'shrub',like:'shrub',cover:true,per:5000,size:[.7,1.3],slope:.75,near:80,variants:sa.map(r=>({near:[[r,0]]})),winds:[{bend:.04,flutter:.02,glow:.3}]},
  {id:'fern',like:'shrub',cover:true,per:26000,where:'woods',size:[.8,1.5],slope:.7,near:55,autumn,mats:[fern],variants:nature.ferns.map(g=>({near:[[{geo:g},0]]})),winds:[{bend:.08,flutter:.02,glow:.3}]},
  {id:'weeds',like:'shrub',cover:true,per:60000,size:[.8,1.4],slope:.7,near:45,variants:[...sb,...nt].map(r=>({near:[[r,0]]})),winds:[{bend:.2,flutter:.02,glow:.3}]},
  ...(dd?[{id:'flowers',like:'shrub',cover:true,per:28000,where:'open',size:[.9,1.4],slope:.75,near:40,variants:dd.map(r=>({near:[[r,0]]})),winds:[{bend:.3,flutter:.02,glow:.3}]}]:[]),
  {id:'stones',like:'rock',cover:true,per:3000,size:[.25,.7],slope:.6,near:70,rock:true,variants:rockv(same),winds:[{bend:0}]},
  {id:'logs',like:'log',cover:true,per:500,where:'woods',size:[.8,1.2],slope:.85,near:90,mats:[M.log],variants:[{near:[[{geo:nature.log},0]]}],winds:[{bend:0}]},
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
    far; renderer: for the pictures far off (without one, the trees just end at the far models, and the far hills stay
    bare); sun: the sun's direction and colour (the light through the leaves); night: no sun through them. A world's
    "look": {"flora": [...]} keeps only those kinds of tree and rock where you ride (the far hills and the small plants
    still grow: a chute's own forest is left to it); a paved world grows nothing. */
export async function growWilds(built,map,scene,{quality=1,renderer=null,shadows=false,sunDir=null,sunColor=null,night=false}={}){
 if(map.look?.paved)return null;   // (a skate plaza: concrete)
 const all=await catalogue(map),flora=map.look?.flora;
 const kinds=all.filter(k=>k.cover||!flora||flora.includes(k.like));   // (where you ride: the kinds the world allows)
 const terrain=built.terrain,[W,D]=map.size,seed0=map.seed>>>0;
 if(sunDir)WIND.uSunD.value.copy(sunDir).normalize();
 WIND.uSunC.value.set(sunColor||'#fff4e0').multiplyScalar(night?0:map.look?.storm?.25:map.look?.dusk?.3:1);
 WIND.uWK.value=map.look?.storm?2.2:map.look?.weather==='blizzard'?1.8:1;
 // how far off each level of detail goes (the full trees, the simpler ones; the cards beyond), and how thick the woods are
 const q=Math.max(.3,quality),NEAR=20+28*q,MID=55+60*q,dens=.3+.7*q;CARD.uNear.value=MID;
 const noise=(x,z,k)=>{let n=0,a=.5,f=1/300,t=0;for(let i=0;i<3;i++){n+=a*Math.sin(x*f*1.7+z*f*.6+k*5.1+i*2.3)*Math.cos(z*f*1.3-x*f*.4+k*3.7+i*1.1);t+=a;a*=.5;f*=2.1;}return .5+.5*n/t;};
 const hash=(x,z,s)=>{let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^s;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const ss=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
 const sd=(seed0%97)*3.1;
 // the woods: deep where the pattern is high, thinning to nothing at their edges; on the green worlds the leafy woods and
 // the pine woods each have their own parts of the map (mixing where they meet); rocks gather in their own outcrops
 const woods=(x,z)=>ss(.5,.66,noise(x,z,1.3+sd));
 const rocky=(x,z)=>ss(.56,.72,noise(x,z,7.9+sd));
 const leafy=(x,z)=>ss(.4,.6,noise(x*.7,z*.7,4.2+sd));
 const share=(k,x,z)=>{const f=k.woods==='rocks'?rocky(x,z):woods(x,z);const m=k.mix>0?leafy(x,z):k.mix<0?1-leafy(x,z):1;return k.per/k.dense+(1-k.per/k.dense)*f*m;};
 const dummy=new THREE.Object3D(),own=[],made=[];
 // a tree's or rock's place: { x, z, y, m (its matrix), v (which variant), shade, leaf (its leaves' colour in autumn, or the kind's tint) }
 const place=(k,x,z,y0,s,rot,v,r)=>{
  const y=y0-(k.rock?.2*s:.12*s);dummy.position.set(x,y,z);dummy.rotation.set(k.rock?(r-.5)*.3:0,rot,k.rock?(r-.5)*.2:0);
  dummy.scale.set(s,k.rock?s*(.75+r*.5):s,s);dummy.updateMatrix();
  return {k,x,z,y,s,m:dummy.matrix.clone(),v,shade:.82+r*.3,leaf:k.autumn?AUTUMN[Math.floor(r*AUTUMN.length*.999)]:k.tint||null};   // (k.tint: the desert's boulders take on its red)
 };
 // the challenges' courses stay clear of trees and boulders: a corridor down the straight line from the start, through
 // each gate (a ring in the sky too: the wingsuit has to get down to it) to the finish, as wide as the gates
 const lanes=[];
 try{
  const C=(await (await fetch('/js/games/moto/open-world/challenges.json')).json()).challenges.filter(c=>c.world===map.id);
  const at=id=>map.spots?.find(p=>p.id===id)?.position||map.safePads?.find(p=>p.id===id)?.position;
  for(const c of C){const pts=[at(c.from),...(c.gates||[]).map(g=>[g[0],g[1],g[2]]),at(c.to)].filter(Boolean);for(let i=1;i<pts.length;i++)lanes.push([pts[i-1],pts[i],Math.max(14,pts[i][2]||0,pts[i-1][2]||0)]);}
 }catch{}
 const camps=[map.spawn,...(map.safePads||[]).flatMap(p=>[p.position,p.riderPosition]),...(map.spawnPads||[]).map(p=>p.position)].filter(Boolean);
 const inCamp=(x,z)=>camps.some(p=>Math.hypot(x-p[0],z-p[1])<70);   // (a wide clearing round where you set off and come back to)
 const inLane=(x,z)=>lanes.some(([a,b,w])=>{const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l2));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<w;});
 // ---- the trees and rocks where you ride: all of them now (they're solid everywhere)
 const t0=performance.now();
 let s=seed0^0x5bd1e995;const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 const big=kinds.filter(k=>!k.cover),spaced=new Map(),solids=[];
 const room=(x,z,r)=>{for(let gx=Math.floor((x-r)/8);gx<=Math.floor((x+r)/8);gx++)for(let gz=Math.floor((z-r)/8);gz<=Math.floor((z+r)/8);gz++)for(const o of spaced.get(gx+','+gz)||[])if(Math.hypot(o.x-x,o.z-z)<r+o.r)return false;return true;};
 const keep=(x,z,r)=>{const key=Math.floor(x/8)+','+Math.floor(z/8);if(!spaced.has(key))spaced.set(key,[]);spaced.get(key).push({x,z,r});};
 const GRID=64,grid=new Map();   // (the trees by 64 m square: only those near you are sorted as you move)
 for(const k of big){
  k.items=[];const n=Math.round(k.dense*W*D/1e6*dens);
  for(let i=0;i<n;i++){
   const x=(rnd()-.5)*W,z=(rnd()-.5)*D,r1=rnd(),r2=rnd(),r3=rnd(),r4=rnd();
   if(r4>share(k,x,z))continue;   // (thick in its woods, the odd one out in the open)
   const sz=k.size[0]+(k.size[1]-k.size[0])*Math.pow(r1,1.5),gap=k.rock?1.2*sz:1.5*sz;
   if(!room(x,z,gap)||!built.plantable(x,z,{clear:k.clear,slope:k.slope,line:k.line,rise:k.rock?260:90})||inLane(x,z)||inCamp(x,z)||terrain.obstacleAt(x,z))continue;
   keep(x,z,gap);const v=Math.floor(r2*k.variants.length*.999),it=place(k,x,z,built.renderHeightAt(x,z),sz,r3*6.283,v,r2);k.items.push(it);
   const key=Math.floor(x/GRID)+','+Math.floor(z/GRID);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(it);
   if(k.solid){
    let r=k.solid.r*sz,tall=k.solid.tall*sz;
    if(k.solid.byBox){const g=k.variants[v].near[0][0];if(!g.boundingBox)g.computeBoundingBox();const b=g.boundingBox;r=Math.min(b.max.x-b.min.x,b.max.z-b.min.z)*.42*sz;tall=b.max.y*sz*(.75+r2*.5)*.8;}
    solids.push({x,z,r,tall});
   }
  }
 }
 terrain.addSolids(solids);
 // ---- the far hills, beyond where you can ride: woods of cards only, on the gentler slopes below the tree line
 const backdrop=[];
 if(renderer){
  const trees=all.filter(k=>k.tree&&k.card),lift=terrain.bedAt||terrain.heightAt,line=map.look?.treeLine??(theme=>theme==='snow'?430:460)(map.theme);
  const R=1500,n=Math.round(((W+2*R)*(D+2*R)-W*D)/1e6*9000*dens);
  for(let i=0;i<n&&trees.length;i++){
   const x=(rnd()-.5)*(W+2*R),z=(rnd()-.5)*(D+2*R);
   if(Math.abs(x)<W/2+20&&Math.abs(z)<D/2+20)continue;
   const k=trees[Math.floor(rnd()*trees.length*.999)],r=rnd();if(r>share(k,x,z))continue;
   const y=lift(x,z),e=6,up=2*e/Math.hypot(lift(x+e,z)-lift(x-e,z),2*e,lift(x,z+e)-lift(x,z-e));
   if(up<.75||y>(map.baseHeight||0)+line*.55+r*40||(terrain.sea&&y<terrain.sea.level+1.5))continue;   // (the foothills: a lone tree high on a mountain face reads as a speck)
   const sz=(k.size[0]+(k.size[1]-k.size[0])*rnd())*1.15;backdrop.push(place(k,x,z,y-1.5,sz,rnd()*6.283,Math.floor(rnd()*k.variants.length*.999),rnd()));
  }
 }
 // ---- one drawing (instanced) per part of each variant: the full model and the simpler one (filled with the trees
 // near you as you move), and the cards (all of them, made once: those near you fold away in the shader)
 const draws=[],color=new THREE.Color();
 const drawOf=(geo,mat,cap,cast,list=true)=>{const im=new THREE.InstancedMesh(geo,mat,Math.max(1,cap));im.count=0;im.frustumCulled=false;im.castShadow=cast;im.receiveShadow=true;scene.add(im);own.push(im);if(list)draws.push(im);return im;};
 const put=(im,it,leaf)=>{if(im.count>=im.instanceMatrix.count)return;const n=im.count++;im.setMatrixAt(n,it.m);const c=(leaf||!it.k?.autumn)&&it.leaf?it.leaf:null;im.setColorAt(n,c?color.setRGB(c[0]*it.shade,c[1]*it.shade,c[2]*it.shade):color.setRGB(it.shade,it.shade,it.shade*.97));};
 const ring=(r,d)=>Math.round(Math.PI*r*r*d/1e6*1.4)+24;   // (how many could stand within r metres, at d to a km²)
 for(const k of all.filter(k=>!k.cover)){
  const mine=big.includes(k)?k.items:[],far=backdrop.filter(it=>it.k===k);if(!mine.length&&!far.length)continue;
  k.draws=k.variants.map((v,vi)=>{
   const n=mine.filter(it=>it.v===vi).length,each=k.dense*dens/k.variants.length;
   const near=mine.length?v.near.map(([g,m])=>drawOf(g,m,Math.min(n,ring(k.rock||!v.far?MID:NEAR,each)),shadows)):null;   // (a kind with no simpler model shows its full one out to MID)
   const mid=mine.length&&v.far?v.far.map(([g,m])=>drawOf(g,m,Math.min(n,ring(MID,each)),false)):null;
   let card=null;
   if(k.card&&renderer){
    const p=photograph(renderer,v.near),c=cards(p),list=[...mine,...far].filter(it=>it.v===vi);made.push(p.rt,c.geo,c.mat);
    card=drawOf(c.geo,c.mat,list.length,false,false);for(const it of list)put(card,it,false);card.instanceMatrix.needsUpdate=true;if(card.instanceColor)card.instanceColor.needsUpdate=true;
   }
   return {near,mid,card};
  });
 }
 // ---- the small plants: in 32 m squares round you, a few squares grown each frame as you come near (where they can
 // grow is worked out once per square on a 4 m grid), forgotten when you're well away
 const cover=kinds.filter(k=>k.cover),CELL=32,cells=new Map(),todo=[],reach=Math.max(0,...cover.map(k=>k.near))*(.6+.4*q);
 for(const k of cover){const each=k.per*q*(k.where==='woods'?1.6:1)/k.variants.length;k.draws=k.variants.map(v=>({near:v.near.map(([g,m])=>drawOf(g,m,ring(k.near*(.6+.4*q),each),false))}));}
 function growCell(cx,cz){
  const ok=new Uint8Array(64);
  for(let j=0;j<8;j++)for(let i=0;i<8;i++){const x=cx*CELL+i*4+2,z=cz*CELL+j*4+2;ok[j*8+i]=built.plantable(x,z,{clear:2.5,slope:.7})?1:0;}
  const list=[];
  for(const k of cover){
   const n=k.per*CELL*CELL/1e6*q*(k.where==='woods'?1.6:1);
   for(let i=0;i<n;i++){
    const h=hash(cx*7+i,cz*13-i,k.id.length*101+seed0),fx=hash(cx,cz+i*3,k.id.length+7),fz=hash(cx+i*5,cz,k.id.length+13);
    if(!ok[Math.floor(fz*8)*8+Math.floor(fx*8)])continue;
    const x=(cx+fx)*CELL,z=(cz+fz)*CELL;
    if(k.where){const f=woods(x,z),keep=k.where==='woods'?.12+.88*f:1-.75*f;if(h>keep)continue;}
    if(terrain.obstacleAt(x,z))continue;
    const sz=k.size[0]+(k.size[1]-k.size[0])*hash(i,cz-cx,17);list.push(place(k,x,z,built.renderHeightAt(x,z),sz,hash(cx-i,cz+i,29)*6.283,Math.floor(hash(cz+i,cx,37)*k.variants.length*.999),hash(i,cx+cz,31)));
   }
  }
  return list;
 }
 // ---- who's where: each time you've moved a few metres, the trees near you go in the list for how far off they are
 const at={x:Infinity,z:Infinity};let dirty=false;
 function refresh(eye){
  for(const im of draws)im.count=0;
  const span=Math.ceil(MID/GRID),gx=Math.floor(eye.x/GRID),gz=Math.floor(eye.z/GRID),near=[];
  for(let x=gx-span;x<=gx+span;x++)for(let z=gz-span;z<=gz+span;z++)for(const it of grid.get(x+','+z)||[]){const d=Math.hypot(it.x-eye.x,it.z-eye.z);if(d<MID)near.push([d,it]);}
  near.sort((a,b)=>a[0]-b[0]);   // (the nearest first: if a list is full, it's the furthest that miss out)
  for(const [d,it] of near){const dr=it.k.draws[it.v];if(d<(it.k.rock?MID:NEAR)||!dr.mid)dr.near?.forEach((im,i)=>put(im,it,i===1));else dr.mid.forEach((im,i)=>put(im,it,i===1));}
  const cg=Math.floor(eye.x/CELL),cz=Math.floor(eye.z/CELL),cs=Math.ceil(reach/CELL);todo.length=0;
  for(let x=cg-cs;x<=cg+cs;x++)for(let z=cz-cs;z<=cz+cs;z++){
   if(Math.hypot(Math.max(x*CELL-eye.x,0,eye.x-x*CELL-CELL),Math.max(z*CELL-eye.z,0,eye.z-z*CELL-CELL))>reach)continue;
   const list=cells.get(x+','+z);if(!list){todo.push([Math.hypot((x+.5)*CELL-eye.x,(z+.5)*CELL-eye.z),x,z]);continue;}
   for(const it of list){if(Math.hypot(it.x-eye.x,it.z-eye.z)<it.k.near*(.6+.4*q))it.k.draws[it.v].near.forEach((m,i)=>put(m,it,i===1||it.k.variants[0].near.length===1));}
  }
  todo.sort((a,b)=>a[0]-b[0]);
  if(cells.size>900)for(const key of cells.keys()){const [x,z]=key.split(',').map(Number);if(Math.hypot(x*CELL-eye.x,z*CELL-eye.z)>reach+200)cells.delete(key);}
  for(const im of draws){im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;}
  at.x=eye.x;at.z=eye.z;
 }
 // the drawn kinds these stand in for stop drawing (rocks stay: the real boulders are as well as them)
 const shown=new Set(big.map(k=>k.like));
 built.hideKinds((map.theme==='desert'?['shrub','deadtree']:map.theme==='snow'?['snowpine']:['pine','broadleaf','shrub']).filter(l=>l==='shrub'||shown.has(l)));
 return {
  count:big.reduce((n,k)=>n+k.items.length,0),solids:solids.length,far:backdrop.length,ms:Math.round(performance.now()-t0),   // (how long planting them all took)
 kinds:Object.fromEntries(big.map(k=>[k.id,k.items.length])),items:id=>big.find(k=>k.id===id)?.items,
  update(eye,dt){
   WIND.uWT.value=(WIND.uWT.value+dt)%1000;
   // (grow two of the squares still to come each frame, then put their plants in)
   if(todo.length){for(const [,x,z] of todo.splice(0,2))cells.set(x+','+z,growCell(x,z));dirty=true;}
   if(dirty&&!todo.length||Math.hypot(eye.x-at.x,eye.z-at.z)>6){dirty=false;refresh(eye);}
  },
  dispose(){for(const im of own){im.removeFromParent();im.dispose();}for(const k of all)for(const m of k.materials)m.dispose();for(const d of made)d.dispose();},
 };
}
