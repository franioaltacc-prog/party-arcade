/** What stands round a motocross track (a world's "mx", mx.mjs) and along its valley road: the road's asphalt (white
 * edges, a dashed yellow middle), a chequered line across the track at the start, sponsor banners along the start
 * straight and at the two checkpoints, little flags on the outside of every hairpin's berm, and a village of houses
 * by the road (solid: you crash into them). Made from code, a handful of draws. */
import * as THREE from 'three';
import {textTexture} from './buildings.mjs';
import {routeLength,routePoint} from './terrain.mjs';

export function mxScenery(terrain,scene,map,{shadows=false}={}){
 const mx=terrain.mx;if(!mx)return null;
 const group=new THREE.Group();scene.add(group);const disposables=[];
 const H=(x,z)=>terrain.heightAt(x,z);
 const keep=o=>{disposables.push(o);return o;};
 const canvasTex=(w,h,draw)=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return keep(t);};
 const strip=(pts,mat,lift)=>{   // (a ribbon on the ground: pts [{x, z, sx, sz (across, unit), w (half-width), v}])
  const pos=[],uv=[],idx=[];
  pts.forEach((p,i)=>{for(const k of [-1,1]){const x=p.x+p.sx*p.w*k,z=p.z+p.sz*p.w*k;pos.push(x,H(x,z)+lift,z);uv.push(k<0?0:1,p.v);}if(i)idx.push(i*2-2,i*2,i*2-1,i*2-1,i*2,i*2+1);});
  const g=keep(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  if(g.attributes.normal.getY(0)<0){idx.reverse();g.setIndex(idx);g.computeVertexNormals();}
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;m.renderOrder=1;group.add(m);return m;
 };
 // ---------------------------------------------------------------- the valley road's asphalt
 const road=map.routes.find(r=>r.id===map.mx.paved);
 if(road){
  const tex=canvasTex(128,256,(g,w,h)=>{
   g.fillStyle='#46484c';g.fillRect(0,0,w,h);
   for(let i=0;i<2600;i++){const k=Math.random();g.fillStyle=k<.5?`rgba(0,0,0,${.08+k*.1})`:`rgba(255,255,255,${(k-.5)*.12})`;g.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*2,1+Math.random()*2);}
   g.fillStyle='#e8e6dc';g.fillRect(w*.05,0,w*.035,h);g.fillRect(w*.915,0,w*.035,h);
   g.fillStyle='#e8c23a';g.fillRect(w*.49,0,w*.025,h*.5);
  });
  tex.wrapT=THREE.RepeatWrapping;
  const mat=keep(new THREE.MeshStandardMaterial({map:tex,roughness:.86,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
  const len=routeLength(road),pts=[];
  for(let d=0;d<=len;d+=3){const p=routePoint(road,Math.min(d,len)),q=routePoint(road,Math.min(len,d+4)),o=routePoint(road,Math.max(0,d-4)),hd=Math.atan2(q.x-o.x,q.z-o.z);pts.push({x:p.x,z:p.z,sx:Math.cos(hd),sz:-Math.sin(hd),w:3.8,v:d/9});}
  strip(pts,mat,.2);
 }
 // ---------------------------------------------------------------- the start line: a chequered strip across the track
 {
  const tex=canvasTex(64,256,(g,w,h)=>{for(let i=0;i<2;i++)for(let j=0;j<8;j++){g.fillStyle=(i+j)%2?'#111':'#f4f4f4';g.fillRect(i*w/2,j*h/8,w/2,h/8);}});
  const mat=keep(new THREE.MeshStandardMaterial({map:tex,roughness:.7,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
  const p0=mx.point(0,0),fx=Math.sin(p0.heading),fz=Math.cos(p0.heading),pts=[];
  for(let a=-.7;a<=.71;a+=.35)pts.push({x:p0.x+fx*a,z:p0.z+fz*a,sx:fz,sz:-fx,w:mx.hw+.3,v:(a+.7)/1.4});
  // (the strip runs across: swap its uv so the chequers go across the track)
  const m=strip(pts,mat,.07),uv=m.geometry.attributes.uv;for(let i=0;i<uv.count;i++){const u=uv.getX(i),v=uv.getY(i);uv.setXY(i,v,u);}
 }
 // ---------------------------------------------------------------- banners on two posts, facing the track
 const words=[['JUNGLE RIDGE MX','#16181c','#ffffff','#ff7a1a'],['REVVD','#ff7a1a','#16181c',null],['FULL GAS','#ffffff','#16181c','#d61f2c'],['HOLESHOT','#16181c','#ffd21a',null],['SEND IT','#1747c9','#ffffff',null],['BRAAAP','#2a9d4a','#ffffff','#16181c'],['PARTY ARCADE','#d61f2c','#ffffff',null]];
 const bannerMats=words.map(([t,bg,fg,stripe])=>keep(new THREE.MeshStandardMaterial({map:keep(textTexture(t,{bg,fg,stripe})),roughness:.7})));
 const dark=keep(new THREE.MeshStandardMaterial({color:'#2a2c30',roughness:.6})),postGeo=keep(new THREE.CylinderGeometry(.06,.07,2.1,6).translate(0,1.05,0)),boardGeo=keep(new THREE.BoxGeometry(4.4,1,.08));
 const banner=(s,u,mat)=>{
  const p=mx.point(s,u),y=Math.min(H(p.x,p.z),H(p.x+Math.cos(p.heading)*2,p.z-Math.sin(p.heading)*2)),g=new THREE.Group(),c=Math.sin(p.heading),k=Math.cos(p.heading);
  const b=new THREE.Mesh(boardGeo,[dark,dark,dark,dark,mat,mat]);b.position.y=1.55;b.castShadow=shadows;g.add(b);
  for(const x of [-2.1,2.1]){const q=new THREE.Mesh(postGeo,dark);q.position.x=x;g.add(q);}
  g.position.set(p.x,y-.1,p.z);g.rotation.y=p.heading+Math.PI/2;group.add(g);
 };
 const side=hw=>hw+5.2;
 for(let i=0;i<7;i++)banner(-60+i*24,(i%2?1:-1)*side(mx.hw),bannerMats[i%bannerMats.length]);   // (round the start line)
 for(const [n,frac] of [[1,1/3],[2,2/3]]){
  const mat=keep(new THREE.MeshStandardMaterial({map:keep(textTexture('CHECKPOINT '+n,{bg:'#ffd21a',fg:'#16181c',stripe:'#16181c'})),roughness:.7}));
  for(const k of [-1,1])banner(Math.round(mx.length*frac),k*side(mx.hw),mat);
 }
 // ---------------------------------------------------------------- flags round the outside of the hairpins' berms
 const spots=[];
 for(let s=0;s<mx.length;s+=7)if(mx.bank[s]>.6){const o=mx.outside(s),p=mx.point(s,o*(mx.hw+3.6));spots.push([p.x,H(p.x,p.z),p.z,spots.length]);}
 if(spots.length){
  const poleGeo=keep(new THREE.CylinderGeometry(.04,.05,2.6,5).translate(0,1.3,0)),flagGeo=keep(new THREE.PlaneGeometry(.8,.5).translate(.4,2.3,0));
  const poles=new THREE.InstancedMesh(poleGeo,dark,spots.length),cols=['#ff3b3b','#ffd21a','#2a7fff','#ffffff'],m4=new THREE.Matrix4(),q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0);
  spots.forEach(([x,y,z],i)=>poles.setMatrixAt(i,m4.makeTranslation(x,y-.1,z)));group.add(poles);keep(poles);
  cols.forEach((c,ci)=>{const list=spots.filter(f=>f[3]%cols.length===ci);if(!list.length)return;const im=new THREE.InstancedMesh(flagGeo,keep(new THREE.MeshStandardMaterial({color:c,side:THREE.DoubleSide,roughness:.8})),list.length);
   list.forEach(([x,y,z,i],k)=>im.setMatrixAt(k,m4.compose(new THREE.Vector3(x,y-.1,z),q.setFromAxisAngle(up,i*1.7),one)));group.add(im);keep(im);});
 }
 // ---------------------------------------------------------------- a village of houses by the road (solid)
 const village=map.spots?.find(s=>s.id==='village');
 if(road&&village){
  const len=routeLength(road);let best=0,bd=Infinity;for(let d=0;d<len;d+=5){const p=routePoint(road,d),dd=Math.hypot(p.x-village.position[0],p.z-village.position[1]);if(dd<bd){bd=dd;best=d;}}
  const walls=['#f2e6cf','#e9d3b0','#f6f1e4','#d8e3cf','#efd9c4'],roof=keep(new THREE.MeshStandardMaterial({color:'#b5532e',roughness:.75}));
  const wallMats=walls.map(c=>keep(new THREE.MeshStandardMaterial({color:c,roughness:.9}))),body=keep(new THREE.BoxGeometry(6,3,5).translate(0,1.5,0)),top=keep(new THREE.ConeGeometry(4.9,2.4,4).rotateY(Math.PI/4).scale(1.1,1,.95).translate(0,4.2,0));
  const solids=[];let i=0;
  for(let d=best-170;d<=best+170;d+=34,i++){
   const p=routePoint(road,Math.max(0,Math.min(len,d))),k=i%2?1:-1,off=15+(i%3)*4,x=p.x+Math.cos(p.heading)*off*k,z=p.z-Math.sin(p.heading)*off*k;
   if(terrain.roadAt(x,z)?.distance<9||mx.near(x,z))continue;
   const y=Math.min(H(x-3,z-3),H(x+3,z-3),H(x-3,z+3),H(x+3,z+3)),g=new THREE.Group();
   const b=new THREE.Mesh(body,wallMats[i%wallMats.length]),r=new THREE.Mesh(top,roof);b.castShadow=r.castShadow=shadows;b.receiveShadow=true;g.add(b,r);
   g.position.set(x,y-.2,z);g.rotation.y=p.heading;group.add(g);solids.push({x,z,r:3.4,tall:5});
  }
  terrain.addSolids(solids);
 }
 return {dispose(){group.removeFromParent();for(const d of disposables)d.dispose?.();}};
}
