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
/** Grass blades on a see-through card: straw at the tips, greener at the base. */
function grassTexture(){
 const W=256,H=256,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
 let s=7;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 for(let i=0;i<90;i++){
  const x=12+r()*(W-24),h=H*(.35+r()*.65),lean=(r()-.5)*80,w=1.5+r()*3.5;
  const grd=g.createLinearGradient(0,H,0,H-h),k=r();
  grd.addColorStop(0,`rgb(${110+k*30},${128+k*25},${52+k*10})`);grd.addColorStop(.5,`rgb(${140+k*50},${160+k*30},${62+k*15})`);grd.addColorStop(1,`rgb(${205+k*35},${192+k*30},${110+k*30})`);
  g.fillStyle=grd;g.beginPath();g.moveTo(x-w,H);g.quadraticCurveTo(x+lean*.3,H-h*.55,x+lean,H-h);g.quadraticCurveTo(x+lean*.3+w*.3,H-h*.5,x+w,H);g.closePath();g.fill();
 }
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}

export function mxDress(terrain,scene,map,{quality=1,shadows=false}={}){
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
 // ------------------------------------------------------------- grass on the banks
 const gTex=k(grassTexture());
 const blade=new THREE.PlaneGeometry(1.3,.9,1,3).translate(0,.45,0),parts=[];
 for(let i=0;i<3;i++)parts.push(blade.clone().rotateY(i*Math.PI/3));
 const clump=k(mergeAll(parts));blade.dispose();parts.forEach(p=>p.dispose());
 // (the cards' normals point up-ish: grass is lit like the field it stands in, not like flat boards)
 {const n=clump.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,n.getX(i)*.35,1,n.getZ(i)*.35);clump.normalizeNormals?.();}
 const gMat=k(new THREE.MeshStandardMaterial({map:gTex,alphaTest:.42,alphaToCoverage:true,side:THREE.DoubleSide,roughness:.92,color:'#f2f0c4'}));
 gMat.onBeforeCompile=sh=>{sh.uniforms.uT=wind.uT;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
{ vec3 r=instanceMatrix[3].xyz;float gust=.55+.45*sin(uT*.8-r.x*.05-r.z*.035);
  float sw=(sin(uT*2.1+r.x*.4+r.z*.31)+.4*sin(uT*3.7+r.x*.9-r.z*.5))*gust;
  float h=max(0.0,transformed.y);transformed.xz+=vec2(.8,.5)*(sw*.13+gust*.1)*h*h; }
#endif`);};
 gMat.customProgramCacheKey=()=>'mx-grass-wind';
 const per=Math.round(5*quality+1);   // (clumps per metre of track, both banks together)
 const batch=60,m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),col=new THREE.Color();
 for(let s0=0;s0<N;s0+=batch){
  const list=[];
  for(let s=s0;s<Math.min(N,s0+batch);s+=1)for(let j=0;j<per;j++){
   const side=rnd()<.5?-1:1,si=s%N,outside=mx.outside(si)===side,b=mx.bank[si];
   const u=side*(mx.hw+1.4+(outside?3.6*b:0)+Math.pow(rnd(),1.6)*10),p=mx.point(si,u),x=p.x+(rnd()-.5)*1.2,z=p.z+(rnd()-.5)*1.2;
   const at=mx.near(x,z);if(at&&Math.abs(at.u)<mx.hw+.9)continue;   // (not on the track)
   const nn=terrain.normalAt(x,z);if(nn.y<.72)continue;   // (not on the steep cut banks: bare earth there)
   list.push([x,H(x,z),z]);
  }
  if(!list.length)continue;
  const im=k(new THREE.InstancedMesh(clump,gMat,list.length));
  list.forEach(([x,y,z],i)=>{const s=.55+rnd()*.85;q.setFromAxisAngle(up,rnd()*6.283);im.setMatrixAt(i,m4.compose(v.set(x,y-.05,z),q,sc.set(s,s*(.7+rnd()*.7),s)));const t=.82+rnd()*.36;im.setColorAt(i,col.setRGB(t*(.95+rnd()*.15),t,t*.9));});
  im.receiveShadow=true;im.computeBoundingSphere();group.add(im);
 }
 // ------------------------------------------------------------- clods of dirt on the track
 // thrown-up lumps of soil, more toward the edges and on the berms (where the wheels throw them): small lumpy stones in
 // the soil's own colours. Only drawn (the bike rides over them as before)
 const clodGeo=k(new THREE.IcosahedronGeometry(1,2));
 {const p=clodGeo.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=.75+.5*Math.abs(Math.sin(x*5.1+y*3.7)*Math.cos(z*4.3-x*2.2));p.setXYZ(i,x*n,y*n*.62,z*n);}clodGeo.deleteAttribute('normal');clodGeo.computeVertexNormals();}
 const clodMat=k(new THREE.MeshStandardMaterial({color:'#9a4a30',roughness:.96}));
 const clodN=Math.round((1800+6500*quality)*Math.min(1.6,N/1300)),clods=new THREE.InstancedMesh(clodGeo,clodMat,clodN);k(clods);
 {const soilCol=[[.86,.4,.26],[.74,.33,.22],[.95,.48,.32],[.64,.3,.2]];let n=0;
  for(let i=0;i<clodN*3&&n<clodN;i++){
   const s=Math.floor(rnd()*N),edge=rnd()<.6,u=(edge?(rnd()<.5?-1:1)*(mx.hw-rnd()*1.6):(rnd()*2-1)*mx.hw*.8),p=mx.point(s,u),x=p.x+(rnd()-.5),z=p.z+(rnd()-.5);
   const sz=(.025+Math.pow(rnd(),3)*.1)*(edge?1.15:.8);
   q.setFromEuler(new THREE.Euler(rnd()*.6,rnd()*6.28,rnd()*.6));clods.setMatrixAt(n,m4.compose(v.set(x,H(x,z)+sz*.18,z),q,sc.set(sz*(.8+rnd()*.5),sz,sz*(.8+rnd()*.5))));
   const c=soilCol[Math.floor(rnd()*soilCol.length)],t=.85+rnd()*.3;clods.setColorAt(n,col.setRGB(c[0]*t,c[1]*t,c[2]*t));n++;}
  clods.count=n;}
 clods.castShadow=shadows&&quality>.7;clods.receiveShadow=true;clods.computeBoundingSphere();group.add(clods);
 // ------------------------------------------------------------- lone trees on the ridges
 let treesGone=false;const solids=[];
 const want=Math.round(16+34*quality),near=quality>.7;
 const spots=[];
 {
  // high ground near the track: a spot scores by how far it stands above the ground round it
  const cands=[];
  for(let i=0;i<1400;i++){
   const s=Math.floor(rnd()*N),side=rnd()<.5?-1:1,u=side*(mx.hw+18+rnd()*150),p=mx.point(s,u);
   if(mx.near(p.x,p.z))continue;if(terrain.roadAt(p.x,p.z)?.distance<10)continue;
   let dmin=Infinity;for(let j=0;j<N;j+=3){const L=mx.line[j];dmin=Math.min(dmin,(L.x-p.x)**2+(L.z-p.z)**2);}if(dmin<26*26)continue;   // (up on the ridge, not between the lanes)
   const y=H(p.x,p.z);let ring=0;for(let a=0;a<6;a++){ring+=H(p.x+Math.cos(a)*24,p.z+Math.sin(a)*24);}
   const nn=terrain.normalAt(p.x,p.z);if(nn.y<.8)continue;
   cands.push({x:p.x,z:p.z,y,score:y-ring/6+rnd()*2});
  }
  cands.sort((a,b)=>b.score-a.score);
  for(const c of cands){if(spots.length>=want)break;if(spots.some(o=>Math.hypot(o.x-c.x,o.z-c.z)<28))continue;spots.push(c);}
 }
 new GLTFLoader().load('/models/nature/oaks.glb',({scene:src})=>{
  const ms={};src.traverse(o=>{if(o.isMesh)ms[o.name]=o;});
  const release=()=>{const gs=new Set(),mats=new Set(),tx=new Set();src.traverse(o=>{if(o.isMesh){gs.add(o.geometry);mats.add(o.material);for(const vv of Object.values(o.material))if(vv?.isTexture)tx.add(vv);}});return {gs,mats,tx};};
  if(treesGone){const {gs,mats,tx}=release();gs.forEach(x=>x.dispose());mats.forEach(x=>x.dispose());tx.forEach(x=>x.dispose());return;}
  const bark=ms.oak0_bark.material,leaves=ms.oak0_leaves.material;
  for(const t of [bark.map,bark.normalMap])if(t){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,6);}
  leaves.side=THREE.DoubleSide;leaves.alphaTest=.45;leaves.transparent=false;leaves.color?.multiplyScalar(.95);
  // leaves sway (gusts, the crown's edge most)
  leaves.onBeforeCompile=sh=>{sh.uniforms.uT=wind.uT;sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
{ vec3 r=instanceMatrix[3].xyz;float g=.6+.4*sin(uT*.6-r.x*.02);transformed.xz+=vec2(.7,.4)*sin(uT*1.3+r.x*.1+transformed.y*.3)*g*.06*max(0.0,transformed.y-2.0); }
#endif`);};
  leaves.customProgramCacheKey=()=>'mx-acacia-leaves';
  const variants=[0,1,2].map(i=>[ms['oak'+i+(near?'':'_far')+'_bark'],ms['oak'+i+(near?'':'_far')+'_leaves']]);
  const per3=[[],[],[]];spots.forEach((p,i)=>per3[i%3].push(p));
  variants.forEach(([b,l],vi)=>{
   const list=per3[vi];if(!list.length||!b||!l)return;
   const box=new THREE.Box3().setFromObject(l).union(new THREE.Box3().setFromObject(b)),hgt=box.max.y-box.min.y;
   for(const [mesh,mat] of [[b,bark],[l,leaves]]){
    const geo=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);k(geo);
    const im=k(new THREE.InstancedMesh(geo,mat,list.length));
    list.forEach((p,i)=>{
     // wide and low: an acacia's flat crown (the model a touch squashed and spread), each one its own size and turn
     const s=(11+rnd()*6)/hgt,wide=1.45+rnd()*.35;
     q.setFromAxisAngle(up,rnd()*6.283);im.setMatrixAt(i,m4.compose(v.set(p.x,p.y-.3,p.z),q,sc.set(s*wide,s*.82,s*wide)));
    });
    im.castShadow=shadows;im.receiveShadow=true;im.computeBoundingSphere();group.add(im);
   }
   for(const p of list)solids.push({x:p.x,z:p.z,r:.7,tall:9});
  });
  terrain.addSolids(solids);keep.push(bark,leaves);
  // (the source file's other meshes aren't used: their buffers can go; the textures used are kept with the materials)
  const used=new Set([bark.map,bark.normalMap,leaves.map,leaves.normalMap,leaves.alphaMap].filter(Boolean));
  const {gs,mats,tx}=release();gs.forEach(x=>x.dispose());mats.forEach(m=>{if(m!==bark&&m!==leaves)m.dispose();});tx.forEach(t=>{if(used.has(t))keep.push(t);else t.dispose();});
 },undefined,e=>console.warn('ridge trees',e));
 return {
  group,
  update(dt){wind.uT.value=(wind.uT.value+dt)%600;},
  dispose(){treesGone=true;group.removeFromParent();for(const o of keep)o.dispose?.();}
 };
}
function mergeAll(geos){
 // (a few plain geometries with the same attributes into one)
 const out=new THREE.BufferGeometry(),names=['position','normal','uv'];let total=0;for(const g of geos)total+=g.attributes.position.count;
 for(const n of names){const size=geos[0].attributes[n].itemSize,arr=new Float32Array(total*size);let o=0;for(const g of geos){arr.set(g.attributes[n].array,o);o+=g.attributes[n].array.length;}out.setAttribute(n,new THREE.BufferAttribute(arr,size));}
 const idx=[];let base=0;for(const g of geos){for(const i of g.index.array)idx.push(i+base);base+=g.attributes.position.count;}out.setIndex(idx);
 return out;
}
