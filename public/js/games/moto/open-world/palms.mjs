/** Coconut palms and banana plants for the jungle, made from code at load time (no model files): a palm is a tall,
 * gently curving ringed trunk with a crown of long arching fronds (each a strip folded down either side of its midrib,
 * its leaflets cut out of a picture painted here), a few coconuts and an old brown frond or two hanging under the
 * crown. A banana plant is a short stem with big paddle leaves, torn here and there. Each comes as a full model and a
 * simpler one for further off, in the same shape wilds.mjs gives its scanned plants. */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

let made=null;
const rng=seed=>{let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};};
function canvas(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
/** A frond's picture: the midrib up the middle (v 0 at its foot, 1 at its tip) and the leaflets slanting out to both
    edges, longest in the middle; see-through round them. */
function frondPicture(){
 return canvas(128,512,(g,w,h)=>{
  const r=rng(7);g.clearRect(0,0,w,h);g.lineCap='round';
  for(let y=h-6;y>4;y-=4.2){
   const t=1-y/h,len=(w/2-3)*Math.pow(Math.sin(Math.PI*Math.min(1,t*1.08)),.55)*(.86+r()*.14);
   for(const side of [-1,1]){
    if(r()<.06)continue;   // (a gap here and there)
    const k=.75+r()*.35,c=[Math.round(52*k+t*20),Math.round(112*k+t*28),Math.round(36*k)];
    g.strokeStyle=`rgb(${c})`;g.lineWidth=3.2-t*1.4;g.beginPath();g.moveTo(w/2,y);g.quadraticCurveTo(w/2+side*len*.5,y-10,w/2+side*len,y-22-r()*6);g.stroke();
   }
  }
  g.strokeStyle='#b9b25a';g.lineWidth=5;g.beginPath();g.moveTo(w/2,h);g.lineTo(w/2,0);g.stroke();
 });
}
/** A banana leaf's picture: a broad paddle with a pale midrib, side veins, and a few tears in from the edges. */
function bananaPicture(){
 return canvas(128,512,(g,w,h)=>{
  const r=rng(11);g.clearRect(0,0,w,h);
  g.fillStyle='#3e7428';g.beginPath();g.moveTo(w/2,h);
  for(let y=h;y>=0;y-=8){const t=1-y/h,half=(w/2-4)*Math.pow(Math.sin(Math.PI*Math.min(1,t*1.02+.02)),.4);g.lineTo(w/2+half,y);}
  for(let y=0;y<=h;y+=8){const t=1-y/h,half=(w/2-4)*Math.pow(Math.sin(Math.PI*Math.min(1,t*1.02+.02)),.4);g.lineTo(w/2-half,y);}
  g.fill();
  const grd=g.createLinearGradient(0,0,w,0);grd.addColorStop(0,'rgba(20,40,10,.35)');grd.addColorStop(.5,'rgba(255,255,200,.08)');grd.addColorStop(1,'rgba(20,40,10,.35)');g.fillStyle=grd;g.globalCompositeOperation='source-atop';g.fillRect(0,0,w,h);
  g.strokeStyle='rgba(30,60,20,.35)';g.lineWidth=1;for(let y=h-10;y>10;y-=7){g.beginPath();g.moveTo(w/2,y);g.lineTo(0,y-20);g.moveTo(w/2,y);g.lineTo(w,y-20);g.stroke();}
  g.globalCompositeOperation='destination-out';g.lineWidth=2.5;g.strokeStyle='#000';
  for(let i=0;i<9;i++){const y=60+r()*(h-120),side=r()<.5?-1:1;g.beginPath();g.moveTo(w/2+side*w/2,y);g.lineTo(w/2+side*(6+r()*14),y-14);g.stroke();}
  g.globalCompositeOperation='source-over';g.strokeStyle='#9fb86a';g.lineWidth=3;g.beginPath();g.moveTo(w/2,h);g.lineTo(w/2,4);g.stroke();
 });
}
/** The trunk's bark: grey-brown rings (the scars of old fronds) going round. */
function barkPicture(){
 return canvas(64,128,(g,w,h)=>{
  const r=rng(3);g.fillStyle='#857462';g.fillRect(0,0,w,h);
  for(let i=0;i<1400;i++){g.fillStyle=r()<.5?'rgba(40,30,20,.12)':'rgba(255,240,220,.1)';g.fillRect(r()*w,r()*h,1+r()*3,1);}
  for(let y=0;y<h;y+=16){g.fillStyle='rgba(50,38,28,.55)';g.fillRect(0,y,w,3);g.fillStyle='rgba(200,185,160,.35)';g.fillRect(0,y+3,w,2);}
 });
}
/** A strip along a midrib (points: [{p, side (unit, across), down (unit)}], width(u) each side, fold: how far the two
    halves droop) with uv 0..1 across and along: one leaf or frond. */
function strip(points,width,fold,color){
 const pos=[],uv=[],col=[],idx=[],n=points.length;
 points.forEach(({p,side,down},i)=>{
  const u=i/(n-1),w=width(u);
  for(const [k,a] of [[-1,0],[0,.5],[1,1]]){const q=p.clone().addScaledVector(side,k*w*Math.cos(fold)).addScaledVector(down,Math.abs(k)*w*Math.sin(fold));pos.push(q.x,q.y,q.z);uv.push(a,u);col.push(...color);}
  if(i<n-1){const a=i*3;idx.push(a,a+3,a+1,a+1,a+3,a+4,a+1,a+4,a+2,a+2,a+4,a+5);}
 });
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);g.computeVertexNormals();
 // (lit more like a leafy mass than a flat strip: the normals lean up)
 const nm=g.attributes.normal;for(let i=0;i<nm.count;i++){const x=nm.getX(i),y=Math.abs(nm.getY(i)),z=nm.getZ(i),l=Math.hypot(x*.5,y+.6,z*.5);nm.setXYZ(i,x*.5/l,(y+.6)/l,z*.5/l);}
 return g;
}
const up=new THREE.Vector3(0,1,0);
/** A bent leaf from a point: it sets off at elevation e (radians) towards azimuth a and droops by its length. */
function leaf(base,a,e,L,droop,segs,width,fold,color){
 const dir=new THREE.Vector3(Math.cos(a),0,Math.sin(a)),side=new THREE.Vector3(-Math.sin(a),0,Math.cos(a)),pts=[];
 for(let i=0;i<=segs;i++){
  const u=i/segs,p=base.clone().addScaledVector(dir,L*u*Math.cos(e)).addScaledVector(up,L*u*Math.sin(e)-droop*L*u*u);
  const t=dir.clone().multiplyScalar(Math.cos(e)).addScaledVector(up,Math.sin(e)-2*droop*u).normalize(),down=new THREE.Vector3().crossVectors(side,t).normalize().negate();
  if(down.y>0)down.negate();
  pts.push({p,side,down});
 }
 return strip(pts,width,fold,color);
}
/** One palm: [trunk geometry, crown geometry] at detail 1 (close) or 0 (further off). */
function palm(seed,detail){
 const r=rng(seed*977+13),H=7.5+r()*4.5,lean=(r()-.3)*.22,la=r()*6.283,curve=[];
 for(let i=0;i<=8;i++){const t=i/8,off=lean*H*Math.pow(t,1.7);curve.push(new THREE.Vector3(Math.cos(la)*off,t*H,Math.sin(la)*off));}
 const path=new THREE.CatmullRomCurve3(curve),segs=detail?18:7,radial=detail?8:5;
 const trunk=new THREE.TubeGeometry(path,segs,1,radial,false),tp=trunk.attributes.position,tn=trunk.attributes.normal;
 for(let i=0;i<tp.count;i++){   // (thick at the foot, slimmer up top)
  const ring=Math.floor(i/(radial+1)),t=ring/segs,c=path.getPointAt(t),rad=.2*(1-.3*t)+.16*Math.pow(1-t,7);
  tp.setXYZ(i,c.x+tn.getX(i)*rad,c.y+tn.getY(i)*rad,c.z+tn.getZ(i)*rad);
 }
 const uvs=trunk.attributes.uv;for(let i=0;i<uvs.count;i++)uvs.setY(i,uvs.getY(i)*H/1.1);
 trunk.computeVertexNormals();trunk.deleteAttribute('tangent');
 const top=path.getPointAt(1),parts=[],n=detail?15:9,G=2.39996;
 for(let k=0;k<n;k++){
  const age=k/(n-1),a=k*G+r()*.3,e=.95-age*1.25+(r()-.5)*.15,L=(4.2+r()*1.2)*(1-.12*Math.abs(age-.5));
  parts.push(leaf(top.clone().add(new THREE.Vector3(Math.cos(a)*.15,-age*.25,Math.sin(a)*.15)),a,e,L,.42+age*.25,detail?9:4,u=>1.15*Math.pow(Math.sin(Math.PI*Math.min(1,u*1.05+.04)),.6),.6,[1,1,1]));
 }
 for(let k=0;k<(detail?2:1);k++){   // (an old brown frond hanging down)
  const a=r()*6.283;parts.push(leaf(top.clone().add(new THREE.Vector3(0,-.35,0)),a,-1.15,3.2,.1,detail?5:3,u=>.7*Math.sin(Math.PI*Math.min(1,u+.05)),.25,[.62,.45,.26]));
 }
 // the crown's heart, and coconuts under it
 const heart=new THREE.IcosahedronGeometry(.32,detail?1:0).scale(1,1.3,1).translate(top.x,top.y-.25,top.z);
 const nuts=detail?[0,1,2,3,4].map(i=>new THREE.IcosahedronGeometry(.13,1).translate(top.x+Math.cos(i*1.3)*.24,top.y-.42-(i%2)*.12,top.z+Math.sin(i*1.3)*.24)):[];
 for(const g of [heart,...nuts]){const c=[],u=[];for(let i=0;i<g.attributes.position.count;i++){c.push(...(g===heart?[.55,.6,.3]:[.42,.5,.18]));u.push(.5,.02);}g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));}
 const all=[...parts,heart,...nuts].map(g=>g.index?g.toNonIndexed():g);
 return [trunk,mergeGeometries(all)];
}
/** One banana plant: its paddle leaves round a short stem (stem and leaves in one geometry). */
function banana(seed,detail){
 // a clump: a few stems of different heights from one root, each with its own crown of paddle leaves (the young ones
 // upright and fresh, the old ones drooping and yellowing), and dead brown leaves hanging down the stems
 const r=rng(seed*331+5),parts=[],stems=2+Math.floor(r()*2.99);
 const colour=(g,c)=>{const cc=[],uu=[];for(let i=0;i<g.attributes.position.count;i++){const y=g.attributes.position.getY(i);const k=Math.min(1,y/1.2);cc.push(c[0]*(.7+.3*k),c[1]*(.7+.3*k),c[2]*(.7+.3*k));uu.push(.5,.02);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(cc,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uu,2));return g;};
 for(let s=0;s<stems;s++){
  const H=s===0?2.1+r()*.5:1.3+r()*.8,ox=s?(r()-.5)*.7:0,oz=s?(r()-.5)*.7:0,lean=(r()-.5)*.12;
  const stem=new THREE.CylinderGeometry(.05+H*.012,.08+H*.02,H,detail?7:4).translate(0,H/2,0);stem.rotateZ(lean);stem.translate(ox,0,oz);
  parts.push(colour(stem,[.95,.92,.68]));
  const top=new THREE.Vector3(ox-Math.sin(lean)*H,H*.97,oz),n=detail?(s===0?7:5):3;
  for(let k=0;k<n;k++){
   const age=k/(n-1||1),a=k*2.4+r()*.5+s,e=1.15-age*1.25+(r()-.5)*.2,L=(1.3+r()*.8)*(.75+.25*H/2.4);
   const tint=age>.7&&r()<.6?[1.05,.92,.55]:[.92+r()*.12,.95+r()*.1,.85];   // (an old leaf low down: yellowing)
   parts.push(leaf(top.clone().add(new THREE.Vector3(0,-age*.12,0)),a,e,L,.3+age*.3,detail?7:3,u=>.34*Math.pow(Math.sin(Math.PI*Math.min(1,u*1.02+.02)),.4),.18,tint));
  }
  if(detail)for(let d=0;d<2;d++){   // (dead leaves hanging down the stem, brown and narrow)
   const a=r()*6.283;parts.push(leaf(top.clone().add(new THREE.Vector3(0,-.25-d*.35,0)),a,-1.25,.9+r()*.5,.05,4,u=>.16*Math.sin(Math.PI*Math.min(1,u+.05)),.3,[.62,.47,.28]));
  }
 }
 return mergeGeometries(parts.map(g=>g.index?g.toNonIndexed():g));
}
/** The palms and banana plants: { palms: [{near: [[geo, mat]...], far}], bananas: [...], mats } (made once). */
export function jungleModels(){
 if(made)return made;
 const bark=barkPicture();bark.wrapS=bark.wrapT=THREE.RepeatWrapping;
 const trunkMat=new THREE.MeshStandardMaterial({map:bark,roughness:.92});
 const frondMat=new THREE.MeshStandardMaterial({map:frondPicture(),vertexColors:true,alphaTest:.45,side:THREE.DoubleSide,roughness:.8});
 const bananaMat=new THREE.MeshStandardMaterial({map:bananaPicture(),vertexColors:true,alphaTest:.45,side:THREE.DoubleSide,roughness:.86});
 const palms=[0,1,2,3].map(i=>{const near=palm(i,1),far=palm(i,0);return {near:[[{geo:near[0],mat:trunkMat},0],[{geo:near[1],mat:frondMat},1]],far:[[{geo:far[0],mat:trunkMat},0],[{geo:far[1],mat:frondMat},1]]};});
 const bananas=[0,1,2].map(i=>({near:[[{geo:banana(i,1),mat:bananaMat},0]]}));
 return made={palms,bananas,mats:{trunkMat,frondMat,bananaMat}};
}
