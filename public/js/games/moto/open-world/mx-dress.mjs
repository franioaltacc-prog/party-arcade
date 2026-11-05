/** The dressing round a motocross track (a world with "mx" and "look": {"dress": true}), to look like a real
 * pro track on TV:
 * - sponsor banner fences: long runs of fabric along both edges, on yellow stakes. The sponsors are made up (Revvd,
 *   Party Arcade and invented brands), drawn here in code: no real company's name or logo;
 * - grass: thick yellow-green clumps on the banks either side of the track, swaying in the wind (instanced, in
 *   batches along the track so the ones out of view aren't drawn);
 * - lone broad trees with wide flat crowns (acacia-like) up on the ridges overlooking the track, silhouetted against
 *   the sky: the game's leafy tree models (oaks.glb, ez-tree, MIT) spread wide and low. Solid: you crash into a trunk.
 * Decoration only: the ground you ride on is unchanged. quality (0..1): how much grass and how many trees. */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {soilTextures,LOOK,addRim} from '../look.js';
import {tuftKit,tuftPatch} from './tufts.mjs';

const SPONSORS=[
 // [text, small line under it]
 ['REVVD','RACING'],['PARTY ARCADE','PLAY · RACE · WIN'],['BERM BROS.','DIRT WORKS'],['FULL GAS CO.','FUEL & OIL'],['JUNGLE RIDGE','MOTOCROSS'],['HOLESHOT HQ','RACE GEAR'],
];
/** A long banner: logo after logo along it. colourway: [background, text, accent]. */
function bannerTexture([bg,fg,accent],seed){
 const W=2048,H=192,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
 g.fillStyle=bg;g.fillRect(0,0,W,H);
 // a faint weave and a darker hem along the top and bottom
 g.fillStyle='rgba(0,0,0,.18)';g.fillRect(0,0,W,10);g.fillRect(0,H-10,W,10);
 for(let x=0;x<W;x+=3){g.fillStyle=`rgba(255,255,255,${.012+(x%7)*.002})`;g.fillRect(x,0,1,H);}
 const n=4,slot=W/n;
 for(let i=0;i<n;i++){
  const [t,sub]=SPONSORS[(i+seed)%SPONSORS.length],cx=slot*i+slot/2;
  // the logo: a little emblem (a ring with a slash through it, or a chevron) and the name
  g.save();g.translate(cx-slot*.36,H*.5);g.strokeStyle=fg;g.fillStyle=fg;g.lineWidth=9;
  if((i+seed)%2){g.beginPath();g.arc(0,0,34,0,Math.PI*2);g.stroke();g.beginPath();g.moveTo(-22,20);g.lineTo(22,-20);g.stroke();}
  else{g.beginPath();g.moveTo(-30,24);g.lineTo(0,-26);g.lineTo(30,24);g.lineTo(14,24);g.lineTo(0,0);g.lineTo(-14,24);g.closePath();g.fill();}
  g.restore();
  g.fillStyle=fg;g.textAlign='left';g.textBaseline='middle';
  let size=78;g.font=`italic 900 ${size}px "Arial Black", Impact, sans-serif`;
  while(g.measureText(t).width>slot*.66&&size>30){size-=4;g.font=`italic 900 ${size}px "Arial Black", Impact, sans-serif`;}
  g.fillText(t,cx-slot*.27,H*.44);
  g.font='700 26px Arial, sans-serif';g.fillStyle=accent;g.fillText(sub,cx-slot*.27+4,H*.8);
 }
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=THREE.RepeatWrapping;tex.anisotropy=8;return tex;
}
export function mxDress(terrain,scene,map,{quality=1,shadows=false,tufts=null}={}){   // (tufts: a tuftKit to share)
 const mx=terrain.mx;if(!mx)return null;
 const group=new THREE.Group();scene.add(group);const keep=[];const k=o=>{keep.push(o);return o;};
 const H=(x,z)=>terrain.heightAt(x,z),N=mx.length;
 let seed=(map.seed||1)*97;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const wind={uT:{value:0}};
 // ------------------------------------------------------------- banner fences
 // runs of 24–60 m along each edge, beyond the berm's lip on the outside of a bend, with gaps between them
 const ways=[['#1b2f9e','#ffffff','#ffd21a'],['#16181c','#ff7a1a','#ffffff'],['#1b2f9e','#ffffff','#9fd3ff']];
 const banMats=ways.map((w,i)=>k(new THREE.MeshStandardMaterial({map:k(bannerTexture(w,i*2)),roughness:.82,side:THREE.DoubleSide})));
 const stakeMat=k(new THREE.MeshStandardMaterial({color:'#ffd21a',roughness:.55})),stakeGeo=k(new THREE.CylinderGeometry(.035,.04,1.2,6).translate(0,.6,0));
 const stakes=[];const runs=[[],[],[]];
 for(const side of [-1,1]){
  let s=rnd()*30;
  while(s<N-10){
   const len=40+rnd()*60,way=Math.floor(rnd()*ways.length),pos=[],uv=[],idx=[];let v=0,last=null;
   for(let d=0;d<=len;d+=1.5){
    const si=Math.floor(s+d)%N,b=mx.bank[si],outside=mx.outside(si)===side;
    const u=side*(mx.hw+1.1+(outside?2.4*b+1.2*b:0)),p=mx.point(si,u),y=H(p.x,p.z);
    if(last)v+=Math.hypot(p.x-last.x,p.z-last.z)/7.5;last=p;
    pos.push(p.x,y+.06,p.z,p.x,y+.92,p.z);uv.push(v,0,v,1);
    const i=pos.length/3-2;if(i>0)idx.push(i-2,i,i-1,i-1,i,i+1);
    if(Math.round(d/1.5)%2===0)stakes.push([p.x,y,p.z]);
   }
   if(idx.length){const g=k(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();runs[way].push(g);}
   s+=len+5+rnd()*16;
  }
 }
 runs.forEach((list,i)=>list.forEach(g=>{const m=new THREE.Mesh(g,banMats[i]);m.castShadow=shadows;m.receiveShadow=true;g.computeBoundingSphere();group.add(m);}));
 if(stakes.length){const im=k(new THREE.InstancedMesh(stakeGeo,stakeMat,stakes.length)),m4=new THREE.Matrix4();stakes.forEach(([x,y,z],i)=>im.setMatrixAt(i,m4.makeTranslation(x,y-.08,z)));im.castShadow=shadows;im.computeBoundingSphere();group.add(im);}
 // ------------------------------------------------------------- grass round the track
 // real tufts of grass, not pictures of it: each a dozen thin blades, curved and tapering, dark at the root and straw
 // or olive at the tip, sprung from one spot and leaning out. They grow in patches (taller dry grass in some, short
 // turf in others, bare earth showing between), all over the grassy ground near the track, and are only drawn within
 // reach of the camera (further off the ground's own scanned grass carries it). Lit like the field they stand in.
 const bankTint=new THREE.Color(map.look?.dressGrass||'#ffffff');   // (the banks' grass: drier, straw)
 const kit=tufts||tuftKit({quality,seed:map.seed}),tuftGeos=kit.geos,gMat=kit.mat;if(!tufts)keep.push(kit);
 // patches: smooth noise (two scales) for how thick and how tall the grass grows
 const pn=tuftPatch;
 const per=Math.round(quality>.8?125:40*quality);   // (tufts tried per metre of track)
 const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),col=new THREE.Color();
 const grassBatches=[];
 for(let s0=0;s0<N;s0+=20){
  const lists=[[],[],[]];
  for(let s=s0;s<Math.min(N,s0+20);s+=1)for(let j=0;j<per;j++){
   const side=rnd()<.5?-1:1,si=s%N,outside=mx.outside(si)===side,b=mx.bank[si];
   const u=side*(mx.hw+1.1+(outside?3.6*b:0)+Math.pow(rnd(),1.9)*24),p=mx.point(si,u),x=p.x+(rnd()-.5)*1.4,z=p.z+(rnd()-.5)*1.4;
   const at=mx.near(x,z);if(at&&Math.abs(at.u)<mx.hw+.7)continue;   // (not on the track)
   const nn=terrain.normalAt(x,z);if(nn.y<.74)continue;   // (not on the steep cut banks: bare earth there)
   const d=pn(x,z);if(rnd()>d*1.35-.15)continue;   // (thin and bare where the patch is low)
   lists[Math.floor(rnd()*3)].push([x,H(x,z),z,d]);
   if(d>.55&&rnd()<.6){const x2=x+(rnd()-.5)*.7,z2=z+(rnd()-.5)*.7;lists[Math.floor(rnd()*3)].push([x2,H(x2,z2),z2,d]);}   // (grass grows in clumps)
  }
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;const ims=[];
  lists.forEach((list,vi)=>{
   if(!list.length)return;
   for(let i=list.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[list[i],list[j]]=[list[j],list[i]];}   // (mixed up: drawing only the first part of the list thins the patch evenly)
   const im=k(new THREE.InstancedMesh(tuftGeos[vi],gMat,list.length));im.userData.all=list.length;
   list.forEach(([x,y,z,d],i)=>{
    x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);
    const tall=.16+.42*Math.pow(d,1.4)*(.6+rnd()*.8),wide=.8+rnd()*.6;   // (taller, thicker grass where the patch is lush)
    q.setFromAxisAngle(up,rnd()*6.283);im.setMatrixAt(i,m4.compose(v.set(x,y-.03,z),q,sc.set(wide*(.7+tall),tall,wide*(.7+tall))));
    const t=.8+rnd()*.32,g=.92+rnd()*.16;im.setColorAt(i,col.setRGB(t,t*g,t*(.85+rnd()*.15)).multiply(bankTint));
   });
   im.receiveShadow=true;im.computeBoundingSphere();group.add(im);ims.push(im);
  });
  if(ims.length)grassBatches.push({ims,x0,x1,z0,z1});
 }
 const grassReach=quality>.8?95:50;
 // ------------------------------------------------------------- crumbs of soil on the track
 // thousands of little crumbs and pebbles thrown up by the wheels, half sunk in the dirt: made of the very same scanned
 // soil as the ground under them (its colour picked from where each one lies), so they read as the ground's own
 // texture standing up in the sun, more of them toward the edges and the berms. Only drawn (the bike rides as before)
 const soil=soilTextures(null,{hi:LOOK.hi}),soilTint=new THREE.Vector3(...(map.look?.soil?.tint||[1,1,1]));
 const crumbGeo=k(new THREE.IcosahedronGeometry(1,0));
 {const p=crumbGeo.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=.8+.4*Math.abs(Math.sin(x*7.1+y*3.3+z*5.7));p.setXYZ(i,x*n,y*n*.7,z*n);}crumbGeo.computeVertexNormals();}
 const crumbMat=k(new THREE.MeshStandardMaterial({color:'#a24e30',roughness:.95}));
 crumbMat.onBeforeCompile=sh=>{
  if(!soil.loaded)return;
  Object.assign(sh.uniforms,{soilC:{value:soil.color},soilTint:{value:soilTint}});
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vCrumbW;').replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nvCrumbW=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;\n#endif');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vCrumbW;uniform sampler2D soilC;uniform vec3 soilTint;').replace('#include <color_fragment>',`#include <color_fragment>
   // (the soil's colour where the crumb lies, a touch lighter on top: it's a lump of the same ground catching the light)
   diffuseColor.rgb=pow(texture2D(soilC,vCrumbW.xz/2.4).rgb*soilTint,vec3(2.2))*vColor.rgb*1.3;`);
 };
 crumbMat.vertexColors=false;crumbMat.customProgramCacheKey=()=>'mx-crumb-'+soil.loaded;
 if(!soil.loaded)soil.ready.then(()=>{crumbMat.needsUpdate=true;}).catch(()=>{});
 const crumbPer=Math.round(8+22*quality),crumbBatches=[];   // (per metre of track; in short runs, each drawn only while it's on the
 // detailed ground round the rider: further off the coarse ground is a few centimetres lower and they'd float)
 for(let s0=0;s0<N;s0+=10){
  const list=[];
  for(let s=s0;s<Math.min(N,s0+10);s++)for(let j=0;j<crumbPer;j++){
   const edge=rnd()<.55,u=edge?(rnd()<.5?-1:1)*(mx.hw-Math.pow(rnd(),1.5)*2.2):(rnd()*2-1)*mx.hw*.85,p=mx.point(s,u),x=p.x+(rnd()-.5),z=p.z+(rnd()-.5);
   const sz=(.01+Math.pow(rnd(),3)*.036)*(edge?1.15:.85);list.push([x,z,sz]);
  }
  const im=k(new THREE.InstancedMesh(crumbGeo,crumbMat,list.length));
  const keep=list.map(([x,z,sz])=>({x,z,sz,q:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rnd()*6.28).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),(rnd()-.5)*.5)),sx:sz*(.8+rnd()*.6),sy:sz*(.45+rnd()*.25),sz2:sz*(.8+rnd()*.6)}));
  const seat=(hAt)=>{keep.forEach((c,i)=>im.setMatrixAt(i,m4.compose(v.set(c.x,hAt(c.x,c.z)-c.sy*.35,c.z),c.q,sc.set(c.sx,c.sy,c.sz2))));im.instanceMatrix.needsUpdate=true;};
  seat(H);list.forEach((_,i)=>{const t=.82+rnd()*.3;im.setColorAt(i,col.setRGB(t,t,t));});
  im.receiveShadow=true;im.computeBoundingSphere();im.visible=false;group.add(im);
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(const [x,z] of list){x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
  crumbBatches.push({im,x0,x1,z0,z1,seat,stamp:-1});
 }
 // ------------------------------------------------------------- lone trees on the ridges
 let treesGone=false;const solids=[];
 const want=Math.round(14+16*quality);   // (lone trees: a few, well apart)
 const spots=[];
 {
  // high ground near the track: a spot scores by how far it stands above the ground round it
  const cands=[];let top=-Infinity;for(let j=0;j<N;j+=5)top=Math.max(top,H(mx.line[j].x,mx.line[j].z));
  for(let i=0;i<1400;i++){
   const s=Math.floor(rnd()*N),side=rnd()<.5?-1:1,u=side*(mx.hw+18+rnd()*230),p=mx.point(s,u);
   if(mx.near(p.x,p.z))continue;if(terrain.roadAt(p.x,p.z)?.distance<10)continue;
   let dmin=Infinity;for(let j=0;j<N;j+=3){const L=mx.line[j];dmin=Math.min(dmin,(L.x-p.x)**2+(L.z-p.z)**2);}if(dmin<26*26)continue;   // (up on the ridge, not between the lanes)
   const y=H(p.x,p.z);let ring=0;for(let a=0;a<6;a++){ring+=H(p.x+Math.cos(a)*24,p.z+Math.sin(a)*24);}
   const nn=terrain.normalAt(p.x,p.z);if(nn.y<.8)continue;
   cands.push({x:p.x,z:p.z,y,score:y-ring/6+Math.max(0,y-top)*.12+rnd()*2});   // (crests, and the higher the better: against the sky)
  }
  cands.sort((a,b)=>b.score-a.score);
  for(const c of cands){if(spots.length>=want)break;if(spots.some(o=>Math.hypot(o.x-c.x,o.z-c.z)<42))continue;spots.push(c);}
 }
 // the trees: acacia-style umbrella trees (acacias.glb), a detailed and a simple version of each of three; each tree
 // shows its detailed one within lodD of the camera, the simple one further off (the lists are sorted out as the
 // camera moves: update())
 const lodD=quality>.8?150:quality>.4?90:0,trees=[],lod={near:[],far:[],at:{x:Infinity,z:Infinity}};
 new GLTFLoader().load('/models/nature/acacias.glb',({scene:src})=>{
  const ms={};src.traverse(o=>{if(o.isMesh)ms[o.name]=o;});
  const release=()=>{const gs=new Set(),mats=new Set(),tx=new Set();src.traverse(o=>{if(o.isMesh){gs.add(o.geometry);mats.add(o.material);for(const vv of Object.values(o.material))if(vv?.isTexture)tx.add(vv);}});return {gs,mats,tx};};
  if(treesGone){const {gs,mats,tx}=release();gs.forEach(x=>x.dispose());mats.forEach(x=>x.dispose());tx.forEach(x=>x.dispose());return;}
  const bark=ms.acacia0_bark.material,leaves=ms.acacia0_leaves.material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,6);}
  leaves.side=THREE.DoubleSide;leaves.alphaTest=.45;leaves.transparent=false;if(map.look?.canopyTint)leaves.color?.setRGB(...map.look.canopyTint);else leaves.color?.multiplyScalar(.95);
  // leaves sway (gusts, the crown's edge most)
  leaves.onBeforeCompile=sh=>{sh.uniforms.uT=wind.uT;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
{ vec3 r=instanceMatrix[3].xyz;float g=.6+.4*sin(uT*.6-r.x*.02);transformed.xz+=vec2(.7,.4)*sin(uT*1.3+r.x*.1+transformed.y*.3)*g*.05*max(0.0,transformed.y-4.0); }
#endif`);};
  leaves.customProgramCacheKey=()=>'mx-acacia-leaves';
  addRim([bark]);
  const per3=[[],[],[]];spots.forEach((p,i)=>per3[i%3].push(p));
  for(let vi=0;vi<3;vi++){
   const list=per3[vi];if(!list.length)continue;
   const sizes=list.map(()=>({h:12+rnd()*5,wide:1+rnd()*.18,turn:rnd()*6.283}));
   for(const [kind,key] of [['near',''],['far','_far']]){
    const b=ms['acacia'+vi+key+'_bark'],l=ms['acacia'+vi+key+'_leaves'];if(!b||!l)continue;
    const box=new THREE.Box3().setFromObject(l).union(new THREE.Box3().setFromObject(b)),hgt=box.max.y-box.min.y;
    const mats=list.map((p,i)=>{const z=sizes[i],s=z.h/hgt;q.setFromAxisAngle(up,z.turn);return m4.compose(v.set(p.x,p.y-.3,p.z),q,sc.set(s*z.wide,s,s*z.wide)).clone();});
    for(const [mesh,mat] of [[b,bark],[l,leaves]]){
     const geo=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);k(geo);
     const im=k(new THREE.InstancedMesh(geo,mat,list.length));im.count=0;
     im.castShadow=shadows;im.receiveShadow=true;im.frustumCulled=false;group.add(im);
     lod[kind].push({im,list,mats});
    }
   }
   for(const p of list)solids.push({x:p.x,z:p.z,r:.7,tall:9});
  }
  lod.at.x=Infinity;   // (sort them out on the next update)
  terrain.addSolids(solids);keep.push(bark,leaves);
  // (the source file's other meshes aren't used: their buffers can go; the textures used are kept with the materials)
  const used=new Set([bark.map,bark.normalMap,leaves.map,leaves.normalMap,leaves.alphaMap].filter(Boolean));
  const {gs,mats,tx}=release();gs.forEach(x=>x.dispose());mats.forEach(m=>{if(m!==bark&&m!==leaves)m.dispose();});tx.forEach(t=>{if(used.has(t))keep.push(t);else t.dispose();});
 },undefined,e=>console.warn('ridge trees',e));
 const sortTrees=cam=>{
  if(Math.hypot(cam.x-lod.at.x,cam.z-lod.at.z)<4)return;lod.at.x=cam.x;lod.at.z=cam.z;
  for(const kind of ['near','far'])for(const d of lod[kind]){
   d.im.count=0;
   d.list.forEach((p,i)=>{const close=Math.hypot(p.x-cam.x,p.z-cam.z)<lodD;if(close===(kind==='near'))d.im.setMatrixAt(d.im.count++,d.mats[i]);});
   d.im.instanceMatrix.needsUpdate=true;
  }
 };
 return {
  group,
  /** px,pz: the centre of the detailed ground, reach: how far it's exact from there, hAt: the height of the ground as
      drawn (the crumbs sit on that, not on the true height a little above the drawn one on a crest). */
  update(dt,px,pz,reach=50,hAt=H,cam=null){wind.uT.value=(wind.uT.value+dt)%600;if(!tufts)kit.time.value=wind.uT.value;
   if(cam)sortTrees(cam);
   if(cam)for(const b of grassBatches){const dx=Math.max(b.x0-cam.x,0,cam.x-b.x1),dz=Math.max(b.z0-cam.z,0,cam.z-b.z1),on=dx*dx+dz*dz<grassReach*grassReach;for(const im of b.ims){im.visible=on;if(on){const d=Math.sqrt(dx*dx+dz*dz);im.count=Math.max(1,Math.round(im.userData.all*Math.min(1,Math.max(.25,1-(d-25)/70))));}}}   // (further off, fewer tufts: each is a few pixels there)
   if(px===undefined||!Number.isFinite(px))return;const stamp=px*7919+pz;
   for(const b of crumbBatches){b.im.visible=b.x0>px-reach&&b.x1<px+reach&&b.z0>pz-reach&&b.z1<pz+reach;if(b.im.visible&&b.stamp!==stamp){b.stamp=stamp;b.seat(hAt);}}},
  dispose(){treesGone=true;group.removeFromParent();for(const o of keep)o.dispose?.();}
 };
}
