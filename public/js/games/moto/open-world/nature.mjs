/** Real nature models for the open worlds (public/models/nature): pine trees made with ez-tree, and Poly Haven's
 * scanned mossy rocks, a tree stump, a fallen log and ferns. loadNature() fetches them once; gauntletScenery() draws
 * a gauntlet's solid trees, rocks, stumps and logs exactly where terrain.mjs put them (with ferns on the ground
 * between), in 30 m slices: the trees in the slices near you are detailed, those further off simpler, and the ones
 * out in the fog aren't drawn. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

let loading=null;
/** The models (a promise, shared): { pines: [{bark, leaves, far: {bark, leaves}}] (geometries), rocks: [geometry], stump, log, ferns: [geometry],
    mats: {bark, needles, rockA, rockB, stump, log, fern}, rockMat: [material of each rock] }. Rocks are centred over the
    origin with the ground at y = 0. */
export function loadNature(){
 return loading||(loading=(async()=>{
  const loader=new GLTFLoader();
  const files=['pines','rocks-moss','rocks-moss2','stump','log','fern'];
  const roots=await Promise.all(files.map(f=>loader.loadAsync('/models/nature/'+f+'.glb').then(g=>g.scene)));
  const meshes=root=>{const out=[];root.traverse(o=>{if(o.isMesh)out.push(o);});return out;};
  const [pines,rocksA,rocksB,stump,log,fern]=roots.map(meshes);
  const pine=name=>pines.find(m=>m.name===name);
  const tree=[0,1,2].map(k=>({bark:pine('pine'+k+'_bark'),leaves:pine('pine'+k+'_leaves'),far:{bark:pine('pine'+k+'_far_bark').geometry,leaves:pine('pine'+k+'_far_leaves').geometry}}));
  const bark=tree[0].bark.material,needles=tree[0].leaves.material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,7);}   // (the bark's texture runs the length of each branch once: repeat it up the trunk)
  needles.side=THREE.DoubleSide;needles.alphaTest=.4;
  const rocks=[...rocksA,...rocksB];
  return {
   pines:tree.map(t=>({bark:t.bark.geometry,leaves:t.leaves.geometry,far:t.far})),
   rocks:rocks.map(m=>m.geometry),rockMat:rocks.map(m=>m.material),
   stump:stump[0].geometry,log:log[0].geometry,ferns:fern.map(m=>m.geometry),
   mats:{bark,needles,stump:stump[0].material,log:log[0].material,fern:fern[0].material},
  };
 })().catch(e=>{loading=null;throw e;}));
}

const SLICE=30;
/** Draws every gauntlet of terrain with the models in nature (from loadNature) into group. Returns update(eye), which
    shows the detailed trees in the slices within near metres of the eye, the simpler ones out to far, and dispose(). */
export function gauntletScenery(terrain,nature,group,{shadows=false,near=40,far=330}={}){
 const slices=new Map(),dummy=new THREE.Object3D(),tint=new THREE.Color(),own=[];
 const sliceOf=z=>{const k=Math.floor(z/SLICE);if(!slices.has(k))slices.set(k,{z0:k*SLICE,lists:new Map(),meshes:[]});return slices.get(k);};
 const add=(z,geo,mat,item,lod=null)=>{const lists=sliceOf(z).lists,key=geo.uuid+mat.uuid;if(!lists.has(key))lists.set(key,{geo,mat,lod,items:[]});lists.get(key).items.push(item);};   // (lod: 'near' or 'far' copies of a tree)
 const box=geo=>{if(!geo.boundingBox)geo.computeBoundingBox();return geo.boundingBox;};
 let seed=9173;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(const g of terrain.gauntlets){
  for(const t of g.trees){const p=nature.pines[t.k%nature.pines.length],y=terrain.heightAt(t.x,t.z)-.15*t.s;
   const item={x:t.x,y,z:t.z,rot:t.rot,sx:t.s,sy:t.s,sz:t.s,shade:.86+(t.rot%1)*.24};
   for(const [geo,mat] of [[p.bark,nature.mats.bark],[p.leaves,nature.mats.needles]])add(t.z,geo,mat,item,'near');
   for(const [geo,mat] of [[p.far.bark,nature.mats.bark],[p.far.leaves,nature.mats.needles]])add(t.z,geo,mat,item,'far');}
  for(const r of g.rocks){const k=r.k%nature.rocks.length,geo=nature.rocks[k],b=box(geo),half=Math.max(-b.min.x,b.max.x,-b.min.z,b.max.z),sxz=r.r*1.05/half;
   // (as wide as the rock is solid, and as tall: half of a rock's height is below its scan's ground, so it sits in the dirt)
   add(r.z,geo,nature.rockMat[k],{x:r.x,y:terrain.heightAt(r.x,r.z)-.08,z:r.z,rot:r.rot,sx:sxz,sy:r.tall/b.max.y,sz:sxz,shade:.9+(r.rot%1)*.2});}
  for(const s of g.stumps)add(s.z,nature.stump,nature.mats.stump,{x:s.x,y:terrain.heightAt(s.x,s.z)-.05,z:s.z,rot:s.rot,sx:s.s*.95,sy:s.s*1.5,sz:s.s*.95,shade:1});
  for(const l of g.logs){const y=Math.min(...l.parts.map(p=>terrain.heightAt(p.x,p.z)));add(l.z,nature.log,nature.mats.log,{x:l.x,y:y+.02,z:l.z,rot:l.rot,sx:l.s*.95,sy:l.s*1.3,sz:l.s*1.3,shade:1});}
  // ferns on the forest floor (only for looks: you ride through them)
  for(let i=0;i<g.ferns;i++){
   const along=rnd()*g.L,across=(rnd()*2-1)*(g.half+g.fringe),x=g.from[0]+g.ux*along+g.uz*across,z=g.from[1]+g.uz*along-g.ux*across;
   if(terrain.rampAt(x,z).weight>0||terrain.obstacleAt(x,z))continue;
   const k=Math.floor(rnd()*nature.ferns.length),s=1+rnd()*.8;
   add(z,nature.ferns[k],nature.mats.fern,{x,y:terrain.heightAt(x,z)-.03,z,rot:rnd()*6.28,sx:s,sy:s,sz:s,shade:.85+rnd()*.3});
  }
 }
 for(const slice of slices.values())for(const {geo,mat,lod,items} of slice.lists.values()){
  const im=new THREE.InstancedMesh(geo,mat,items.length);
  items.forEach((it,i)=>{dummy.position.set(it.x,it.y,it.z);dummy.rotation.set(0,it.rot,0);dummy.scale.set(it.sx,it.sy,it.sz);dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);im.setColorAt(i,tint.setRGB(it.shade,it.shade,it.shade));});
  im.computeBoundingSphere();im.castShadow=shadows&&mat!==nature.mats.fern&&lod!=='far';im.receiveShadow=true;im.userData.lod=lod;group.add(im);slice.meshes.push(im);own.push(im);
 }
 return {
  update(eye){for(const s of slices.values()){const d=Math.max(s.z0-eye.z,0,eye.z-s.z0-SLICE),close=d<near;for(const m of s.meshes)m.visible=d<far&&(m.userData.lod==='near'?close:m.userData.lod==='far'?!close:d<far*.6);}},
  dispose(){for(const m of own){m.removeFromParent();m.dispose();}},
 };
}

/** The same rock and log models for any world's scattered scenery: a rock geometry (k) scaled to fit inside a unit
    sphere's footprint and stand about 0.7 tall, like the drawn rocks it stands in for. */
export function unitRock(nature,k){
 const geo=nature.rocks[k%nature.rocks.length].clone();geo.computeBoundingBox();const b=geo.boundingBox,half=Math.max(-b.min.x,b.max.x,-b.min.z,b.max.z);
 geo.scale(1/half,.7/b.max.y,1/half);return geo;
}
