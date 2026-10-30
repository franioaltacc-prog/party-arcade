/** Real nature models for the open worlds (public/models/nature): pine trees made with ez-tree, and Poly Haven's
 * scanned mossy rocks, tree stumps, a fallen log, ferns, bushes, dry branches and a lantern. loadNature() fetches them
 * once; gauntletScenery() draws a gauntlet's solid trees, rocks, stumps and logs exactly where terrain.mjs put them
 * (with ferns, bushes and branches on the ground between, and lanterns for a night world), in 30 m slices: the trees
 * and bushes in the slices near you are detailed, those further off simpler, and the ones out in the fog aren't drawn.
 * In a snowy world everything has snow on top. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

let loading=null;
/** The models (a promise, shared): { pines: [{bark, leaves, far: {bark, leaves}}] (geometries), rocks: [geometry], stumps: [geometry],
    log, ferns: [geometry], bushes: [{bark, leaves, far: {bark, leaves}}], branches: [geometry], lantern, mats: {bark, needles,
    stumps: [material], log, fern, twigs, leaves (a bush's), branches, lantern}, rockMat: [material of each rock] }. Each model is centred over the origin with
    the ground at y = 0. */
export function loadNature(){
 return loading||(loading=(async()=>{
  const loader=new GLTFLoader();
  const files=['pines','rocks-moss','rocks-moss2','stump','log','fern','bushes','stump2','branches','lantern'];
  const roots=await Promise.all(files.map(f=>loader.loadAsync('/models/nature/'+f+'.glb').then(g=>g.scene)));
  const meshes=root=>{const out=[];root.traverse(o=>{if(o.isMesh)out.push(o);});return out;};
  const [pines,rocksA,rocksB,stump,log,fern,bushes,stump2,branches,lantern]=roots.map(meshes);
  const pine=name=>pines.find(m=>m.name===name);
  const tree=[0,1,2].map(k=>({bark:pine('pine'+k+'_bark'),leaves:pine('pine'+k+'_leaves'),far:{bark:pine('pine'+k+'_far_bark').geometry,leaves:pine('pine'+k+'_far_leaves').geometry}}));
  const bark=tree[0].bark.material,needles=tree[0].leaves.material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,7);}   // (the bark's texture runs the length of each branch once: repeat it up the trunk)
  needles.side=THREE.DoubleSide;needles.alphaTest=.4;
  const leafy=m=>{m.side=THREE.DoubleSide;m.alphaTest=.5;m.transparent=false;return m;};
  const rocks=[...rocksA,...rocksB],bush=name=>bushes.find(m=>m.name===name).geometry;
  const twigs=bushes[0].material,leaves=bushes.find(m=>m.name==='bush0_leaves').material;
  for(const t of [twigs.map,twigs.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,3);}
  leaves.side=THREE.DoubleSide;leaves.alphaTest=.4;leaves.color.set('#7a9f56');   // (ez-tree's ash leaves are pale: a deeper green than the grass, so a bush stands out from the ground behind it)
  return {
   pines:tree.map(t=>({bark:t.bark.geometry,leaves:t.leaves.geometry,far:t.far})),
   rocks:rocks.map(m=>m.geometry),rockMat:rocks.map(m=>m.material),
   stumps:[stump[0].geometry,stump2[0].geometry],log:log[0].geometry,ferns:fern.map(m=>m.geometry),
   bushes:[0,1,2].map(k=>({bark:bush('bush'+k+'_bark'),leaves:bush('bush'+k+'_leaves'),far:{bark:bush('bush'+k+'_far_bark'),leaves:bush('bush'+k+'_far_leaves')}})),
   branches:branches.map(m=>m.geometry),lantern:lantern[0].geometry,
   mats:{bark,needles,stumps:[stump[0].material,stump2[0].material],log:log[0].material,fern:leafy(fern[0].material),twigs,leaves,branches:branches[0].material,lantern:lantern[0].material},
  };
 })().catch(e=>{loading=null;throw e;}));
}

let aspensLoading=null;
/** The Autumn Chute's aspens (ez-tree, birch bark and aspen leaves; a promise, shared): { trees: [{bark, leaves, far:
    {bark, leaves}}], mats: {bark, leaves} }. Only loaded for a world that has aspens. */
export function loadAspens(){
 return aspensLoading||(aspensLoading=new GLTFLoader().loadAsync('/models/nature/aspens.glb').then(g=>{
  const ms=[];g.scene.traverse(o=>{if(o.isMesh)ms.push(o);});
  const geo=name=>ms.find(m=>m.name===name).geometry,bark=ms.find(m=>m.name==='aspen0_bark').material,leaves=ms.find(m=>m.name==='aspen0_leaves').material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,4);}
  leaves.side=THREE.DoubleSide;leaves.alphaTest=.4;
  return {trees:[0,1,2].map(k=>({bark:geo('aspen'+k+'_bark'),leaves:geo('aspen'+k+'_leaves'),far:{bark:geo('aspen'+k+'_far_bark'),leaves:geo('aspen'+k+'_far_leaves')}})),mats:{bark,leaves}};
 }).catch(e=>{aspensLoading=null;throw e;}));
}

const SLICE=30;
/** A copy of a leaf material in autumn colours: each instance's colour (see AUTUMN) is the leaf's colour, the texture
    only gives its light and shade. */
function autumnal(material){
 const m=material.clone();
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
 diffuseColor.rgb=vec3(dot(diffuseColor.rgb,vec3(.299,.587,.114)))*2.3*vColor;
#endif`);};
 m.customProgramCacheKey=()=>'autumn';return m;
}
const AUTUMN=[[.95,.62,.12],[.92,.42,.08],[.75,.22,.07],[.98,.8,.2],[.85,.5,.1]];   // (gold, orange, red, yellow, amber)
/** A copy of material with snow lying on everything that faces up (more on pine needles: base is how white they are
    all over), for a winter world. */
function snowy(material,base=0){
 const m=material.clone();
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_fragment>',`{
  vec3 snowN=inverseTransformDirection(normal,viewMatrix);
  float snow=max(smoothstep(.15,.6,snowN.y),${base.toFixed(2)});
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.86,.9,.96),snow);roughnessFactor=mix(roughnessFactor,.75,snow);
 }
#include <lights_physical_fragment>`);};
 m.customProgramCacheKey=()=>'snowy'+base;return m;
}
/** Draws every gauntlet of terrain with the models in nature (from loadNature) into group. snow: snow on everything (and
    no ferns); autumn: the leaves turn gold, orange and red, and nature.aspens (loadAspens) draws the aspens; night: the lanterns light up (a few real lights, on the lanterns nearest you); quality (0..1): fewer bushes
    when it's lower. Returns update(eye), which
    shows the detailed trees in the slices within near metres of the eye, the simpler ones out to far, and dispose(),
    and the lanterns and bushes ([{x, z, ...}]: you ride through bushes, and can pick lanterns up). */
export function gauntletScenery(terrain,nature,group,{shadows=false,near=40,far=330,snow=false,night=false,autumn=false,quality=1}={}){
 const slices=new Map(),dummy=new THREE.Object3D(),tint=new THREE.Color(),own=[],made=[];
 const M=snow?Object.fromEntries(Object.entries(nature.mats).map(([k,m])=>[k,Array.isArray(m)?m.map(x=>snowy(x)):snowy(m,k==='needles'?.3:k==='leaves'?.4:0)])):{...nature.mats};
 const rockMat=snow?nature.rockMat.map(m=>snowy(m)):nature.rockMat;
 if(snow)made.push(...Object.values(M).flat(),...rockMat);
 const A=nature.aspens?{bark:nature.aspens.mats.bark,leaves:autumn?autumnal(nature.aspens.mats.leaves):nature.aspens.mats.leaves}:null;
 if(autumn){M.leaves=autumnal(M.leaves);M.fern=autumnal(M.fern);made.push(M.leaves,M.fern);if(A)made.push(A.leaves);}
 const fall=()=>AUTUMN[Math.floor(rnd()*AUTUMN.length)];
 const sliceOf=z=>{const k=Math.floor(z/SLICE);if(!slices.has(k))slices.set(k,{z0:k*SLICE,lists:new Map(),meshes:[]});return slices.get(k);};
 const add=(z,geo,mat,item,lod=null)=>{const lists=sliceOf(z).lists,key=geo.uuid+mat.uuid;if(!lists.has(key))lists.set(key,{geo,mat,lod,items:[]});lists.get(key).items.push(item);};   // (lod: 'near' or 'far' copies of a tree, 'bush' or 'bushfar' of a bush)
 const box=geo=>{if(!geo.boundingBox)geo.computeBoundingBox();return geo.boundingBox;};
 let seed=9173;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const lanterns=[],bushes=[];
 for(const g of terrain.gauntlets){
  for(const t of g.trees){
   if(t.sp==='aspen'&&A){const p=nature.aspens.trees[t.k%3],item={x:t.x,y:terrain.heightAt(t.x,t.z)-.1*t.s,z:t.z,rot:t.rot,sx:t.s,sy:t.s,sz:t.s,shade:.9+(t.rot%1)*.15},leaf={...item,color:autumn?fall():null};
    add(t.z,p.bark,A.bark,item,'near');add(t.z,p.leaves,A.leaves,leaf,'near');add(t.z,p.far.bark,A.bark,item,'far');add(t.z,p.far.leaves,A.leaves,leaf,'far');continue;}
   const p=nature.pines[t.k%nature.pines.length],y=terrain.heightAt(t.x,t.z)-.15*t.s;
   const item={x:t.x,y,z:t.z,rot:t.rot,sx:t.s,sy:t.s,sz:t.s,shade:.86+(t.rot%1)*.24};
   for(const [geo,mat] of [[p.bark,M.bark],[p.leaves,M.needles]])add(t.z,geo,mat,item,'near');
   for(const [geo,mat] of [[p.far.bark,M.bark],[p.far.leaves,M.needles]])add(t.z,geo,mat,item,'far');}
  for(const r of g.rocks){const k=r.k%nature.rocks.length,geo=nature.rocks[k],b=box(geo),half=Math.max(-b.min.x,b.max.x,-b.min.z,b.max.z),sxz=r.r*1.05/half;
   // (as wide as the rock is solid, and as tall: half of a rock's height is below its scan's ground, so it sits in the dirt)
   add(r.z,geo,rockMat[k],{x:r.x,y:terrain.heightAt(r.x,r.z)-.08,z:r.z,rot:r.rot,sx:sxz,sy:r.tall/b.max.y,sz:sxz,shade:.9+(r.rot%1)*.2});}
  for(const s of g.stumps){const k=Math.floor(s.rot*10)%2;   // (two kinds of stump)
   if(k===0)add(s.z,nature.stumps[0],M.stumps[0],{x:s.x,y:terrain.heightAt(s.x,s.z)-.05,z:s.z,rot:s.rot,sx:s.s*.95,sy:s.s*1.5,sz:s.s*.95,shade:1});
   else{const b=box(nature.stumps[1]),half=Math.max(-b.min.x,b.max.x,-b.min.z,b.max.z),sxz=s.r*1.15/half;add(s.z,nature.stumps[1],M.stumps[1],{x:s.x,y:terrain.heightAt(s.x,s.z)-.04,z:s.z,rot:s.rot,sx:sxz,sy:s.tall*1.2/b.max.y,sz:sxz,shade:1});}}
  for(const l of g.logs){const y=Math.min(...l.parts.map(p=>terrain.heightAt(p.x,p.z)));add(l.z,nature.log,M.log,{x:l.x,y:y+.02,z:l.z,rot:l.rot,sx:l.s*.95,sy:l.s*1.3,sz:l.s*1.3,shade:1});}
  // only for looks (you ride through them): ferns and dry branches on the forest floor, bushes round the foot of the trees
  const spot=(spread=1)=>{const along=rnd()*g.L,across=(rnd()*2-1)*(g.half+g.fringe)*spread;return [g.from[0]+g.ux*along+g.uz*across,g.from[1]+g.uz*along-g.ux*across];};
  const clear=(x,z,m=0)=>terrain.rampAt(x,z).weight<=0&&!terrain.obstacleAt(x,z)&&(!m||!terrain.obstacleAt(x+m,z)&&!terrain.obstacleAt(x-m,z)&&!terrain.obstacleAt(x,z+m)&&!terrain.obstacleAt(x,z-m));
  for(let i=0;i<(snow?0:g.ferns);i++){
   const [x,z]=spot();if(!clear(x,z))continue;
   const k=Math.floor(rnd()*nature.ferns.length),s=1+rnd()*.8;
   add(z,nature.ferns[k],M.fern,{x,y:terrain.heightAt(x,z)-.03,z,rot:rnd()*6.28,sx:s,sy:s,sz:s,shade:.85+rnd()*.3,color:autumn?[.62,.34,.1]:null},'mid');
  }
  for(let i=0;i<g.branches;i++){
   const [x,z]=spot();if(!clear(x,z,.6))continue;
   const k=Math.floor(rnd()*nature.branches.length),s=.9+rnd()*.6;
   add(z,nature.branches[k],M.branches,{x,y:terrain.heightAt(x,z)-.06,z,rot:rnd()*6.28,sx:s,sy:s,sz:s,shade:.8+rnd()*.3},'mid');
  }
  for(let i=0;i<Math.round(g.bushes*quality)&&g.trees.length;i++){
   // (a thicket of one to three round the foot of a tree, so a bush never hides a gap you could ride through)
   const t=g.trees[Math.floor(rnd()*g.trees.length)],n=1+Math.floor(rnd()*rnd()*3.2);
   for(let j=0;j<n;j++){
    const a=rnd()*6.28,d=t.r+.5+rnd()*1.1,x=t.x+Math.cos(a)*d,z=t.z+Math.sin(a)*d;
    if(terrain.rampAt(x,z).weight>0)continue;
    // (more of the lighter bush)
    const b=nature.bushes[[0,1,1,2,1][Math.floor(rnd()*5)]],s=.8+rnd()*.6,item={x,y:terrain.heightAt(x,z)-.08,z,rot:rnd()*6.28,sx:s,sy:s*(.85+rnd()*.3),sz:s,shade:.7+rnd()*.35},leaf={...item,color:autumn?fall():null};
    bushes.push({x,z,r:.75*s});
    add(z,b.bark,M.twigs,item,'bush');add(z,b.leaves,M.leaves,leaf,'bush');add(z,b.far.leaves,M.leaves,leaf,'bushfar');   // (further off, the leaves hide the twigs)
   }
  }
  for(let i=0;i<g.lanterns&&g.trees.length;i++){
   // (at the foot of a tree, down the run)
   const along=(i+.5)/g.lanterns*g.L,best=g.trees.reduce((b,t)=>{const dx=t.x-g.from[0],dz=t.z-g.from[1],d=Math.abs(dx*g.ux+dz*g.uz-along)+Math.abs(dx*g.uz-dz*g.ux)*.35;return !b||d<b.d?{t,d}:b;},null).t;
   const a=rnd()*6.28,x=best.x+Math.cos(a)*(best.r+.45),z=best.z+Math.sin(a)*(best.r+.45);
   lanterns.push({x,y:terrain.heightAt(x,z)-.02,z,rot:rnd()*6.28});
  }
 }
 const LANTERN=1.7;   // (a bit bigger than life, to find them in the dark)
 for(const l of lanterns)add(l.z,nature.lantern,M.lantern,{x:l.x,y:l.y,z:l.z,rot:l.rot,sx:LANTERN,sy:LANTERN,sz:LANTERN,shade:night?.55:1},'mid');
 for(const slice of slices.values())for(const {geo,mat,lod,items} of slice.lists.values()){
  const im=new THREE.InstancedMesh(geo,mat,items.length);
  items.forEach((it,i)=>{dummy.position.set(it.x,it.y,it.z);dummy.rotation.set(0,it.rot,0);dummy.scale.set(it.sx,it.sy,it.sz);dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);im.setColorAt(i,it.color?tint.setRGB(it.color[0]*it.shade,it.color[1]*it.shade,it.color[2]*it.shade):tint.setRGB(it.shade,it.shade,it.shade));});
  im.computeBoundingSphere();im.castShadow=shadows&&mat!==M.fern&&mat!==M.branches&&lod!=='far'&&lod!=='bushfar';im.receiveShadow=true;im.userData.lod=lod;group.add(im);slice.meshes.push(im);own.push(im);
 }
 // ---- the lanterns' flames: a glow you can see from far off in the dark, and real light from the nearest few
 let glow=null;const lights=[];
 if(night&&lanterns.length){
  const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),grd=x.createRadialGradient(32,32,0,32,32,32);
  grd.addColorStop(0,'rgba(255,236,190,1)');grd.addColorStop(.18,'rgba(255,190,90,.75)');grd.addColorStop(.5,'rgba(255,140,40,.18)');grd.addColorStop(1,'rgba(255,120,30,0)');x.fillStyle=grd;x.fillRect(0,0,64,64);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.SpriteMaterial({map:tex,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,toneMapped:false});
  glow=new THREE.Group();for(const l of lanterns){const sp=new THREE.Sprite(mat);sp.position.set(l.x,l.y+.2*LANTERN,l.z);sp.scale.setScalar(3.2);glow.add(sp);}
  group.add(glow);made.push(mat,tex);
  for(let i=0;i<4;i++){const p=new THREE.PointLight('#ffb35c',9,22,1.6);group.add(p);lights.push(p);}
 }
 return {
  lanterns,bushes,
  /** Put a lantern out (picked up in the Lantern Hunt), or all of them back on (out = false). */
  lanternOut(l,out=true){if(l)l.out=out;else for(const x of lanterns)x.out=out;},
  update(eye){
   for(const s of slices.values()){const d=Math.max(s.z0-eye.z,0,eye.z-s.z0-SLICE),close=d<near;for(const m of s.meshes){const lod=m.userData.lod;m.visible=d<far&&(lod==='near'?close:lod==='far'?!close:lod==='bush'?d<25:lod==='bushfar'?d>=25&&d<far*.32:d<far*.6);}}
   if(glow){
    // (a lantern glows from up to 150 m off; the nearest four light up the ground round them)
    for(let i=0;i<lanterns.length;i++){const l=lanterns[i],d=Math.hypot(l.x-eye.x,l.z-eye.z);glow.children[i].visible=d<150&&!l.out;}
    const near4=lanterns.filter(l=>!l.out).map(l=>[Math.hypot(l.x-eye.x,l.z-eye.z),l]).sort((a,b)=>a[0]-b[0]).slice(0,lights.length);
    lights.forEach((p,i)=>{const l=near4[i]?.[1];p.visible=!!l;if(l)p.position.set(l.x,l.y+.25*LANTERN,l.z);});
   }
  },
  dispose(){for(const m of own){m.removeFromParent();m.dispose();}glow?.removeFromParent();for(const p of lights){p.removeFromParent();p.dispose();}for(const m of made)m.dispose();},
 };
}

/** The same rock and log models for any world's scattered scenery: a rock geometry (k) scaled to fit inside a unit
    sphere's footprint and stand about 0.7 tall, like the drawn rocks it stands in for. */
export function unitRock(nature,k){
 const geo=nature.rocks[k%nature.rocks.length].clone();geo.computeBoundingBox();const b=geo.boundingBox,half=Math.max(-b.min.x,b.max.x,-b.min.z,b.max.z);
 geo.scale(1/half,.7/b.max.y,1/half);return geo;
}
