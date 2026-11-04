/** What stands along a one-way downhill course (a world's "mx" with closed: false, mx.mjs): timber planks over every
 * wooden kicker and drop deck (with board sides down to the ground), course tape on posts down both edges, a timber
 * start hut and start arch at the top, banners down the finish chute and a finish arch at the bottom. Made from
 * code, a handful of draws. (mxScenery in jungle.mjs still draws the paved road and the hairpin flags.) */
import * as THREE from 'three';
import {textTexture} from './buildings.mjs';
import {routeLength,routePoint} from './terrain.mjs';

export function dhScenery(terrain,scene,map,{shadows=false}={}){
 const mx=terrain.mx;if(!mx||!mx.open)return null;
 const group=new THREE.Group();scene.add(group);const disposables=[];
 const H=(x,z)=>terrain.heightAt(x,z),hw=mx.hw;
 const keep=o=>{disposables.push(o);return o;};
 const canvasTex=(w,h,draw)=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;t.wrapS=t.wrapT=THREE.RepeatWrapping;return keep(t);};
 const mesh=(pos,uv,idx,mat)=>{const g=keep(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.receiveShadow=true;m.castShadow=shadows;group.add(m);return m;};
 // ---------------------------------------------------------------- timber: planks across the deck, boards down the sides
 const planks=canvasTex(256,64,(g,w,h)=>{
  g.fillStyle='#8a6a44';g.fillRect(0,0,w,h);
  for(let i=0;i<8;i++){const x=i*w/8,c=120+((i*53)%40);g.fillStyle=`rgb(${c},${c*.76|0},${c*.5|0})`;g.fillRect(x+1,0,w/8-2,h);g.fillStyle='rgba(30,20,10,.55)';g.fillRect(x,0,1.5,h);}
  for(let i=0;i<900;i++){g.fillStyle=`rgba(40,26,12,${Math.random()*.18})`;g.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*10,1);}
 });
 const deckMat=keep(new THREE.MeshStandardMaterial({map:planks,roughness:.82,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
 const sideMat=keep(new THREE.MeshStandardMaterial({map:planks,color:'#b9a58a',roughness:.88,side:THREE.DoubleSide}));
 {
  const dp=[],du=[],di=[],sp=[],su=[],si=[],ACROSS=6;
  let run=null;
  const flush=()=>{   // (one wooden run: from metre a to metre b)
   if(!run)return;const [a,b]=run;run=null;if(b-a<2)return;
   const base=dp.length/3,rows=[];
   for(let s=a;s<=b;s++){const p=mx.point(s,0),c=Math.cos(p.heading),n=Math.sin(p.heading),row=[];
    for(let k=0;k<=ACROSS;k++){const u=-hw+2*hw*k/ACROSS,x=p.x-c*u,z=p.z+n*u;dp.push(x,H(x,z)+.06,z);du.push(s/2.2,k/ACROSS*hw/1.1);row.push(x,z);}
    rows.push(row);}
   const W=ACROSS+1;for(let r=1;r<rows.length;r++)for(let k=0;k<ACROSS;k++){const i0=base+(r-1)*W+k,i1=i0+W;di.push(i0,i1,i0+1,i0+1,i1,i1+1);}
   for(const side of [-1,1]){   // (the boards: from the deck's edge down into the ground just outside it)
    const sb=sp.length/3;
    for(let s=a;s<=b;s++){const p=mx.point(s,0),c=Math.cos(p.heading),n=Math.sin(p.heading),u=side*(hw+.02),x=p.x-c*u,z=p.z+n*u;
     const top=H(p.x-c*side*(hw-.1),p.z+n*side*(hw-.1))+.06,gx=p.x-c*side*(hw+1.2),gz=p.z+n*side*(hw+1.2),bot=Math.min(top-.1,H(gx,gz)-.4);
     sp.push(x,top,z,x,bot,z);su.push(s/2.2,0,s/2.2,(top-bot)/1.1);}
    for(let r=1;r<=b-a;r++){const i0=sb+(r-1)*2;si.push(i0,i0+2,i0+1,i0+1,i0+2,i0+3);}
   }
  };
  for(let s=0;s<mx.length;s++){if(mx.wood[s]>.5){if(!run)run=[s,s];else run[1]=s;}else flush();}flush();
  if(di.length)mesh(dp,du,di,deckMat);
  if(si.length)mesh(sp,su,si,sideMat);
 }
 // ---------------------------------------------------------------- course tape: posts down both edges, red and white tape between
 const road=map.routes.find(r=>r.id===map.mx.paved),roadPts=[];
 if(road){const L=routeLength(road);for(let d=0;d<=L;d+=4)roadPts.push(routePoint(road,d));}
 const nearRoad=(x,z,r)=>roadPts.some(p=>(p.x-x)**2+(p.z-z)**2<r*r);
 {
  const tapeTex=canvasTex(64,8,(g,w,h)=>{for(let i=0;i<4;i++){g.fillStyle=i%2?'#f4f4f4':'#d8262c';g.fillRect(i*w/4,0,w/4,h);}});
  const tapeMat=keep(new THREE.MeshStandardMaterial({map:tapeTex,roughness:.6,side:THREE.DoubleSide}));
  const post=keep(new THREE.CylinderGeometry(.03,.035,1.05,5).translate(0,.52,0)),postMat=keep(new THREE.MeshStandardMaterial({color:'#e9e4d8',roughness:.7}));
  const posts=[],tp=[],tu=[],ti=[],STEP=7,U=hw+2.6;
  for(const side of [-1,1]){
   let prev=null;
   for(let s=4;s<mx.length-4;s+=STEP){
    const p=mx.point(s,side*U);
    const bad=mx.hazard(p.x,p.z)||nearRoad(p.x,p.z,6)||mx.wood[s]>.5;   // (no post down a pit, on the road or on a timber deck)
    if(bad){prev=null;continue;}
    const y=H(p.x,p.z);posts.push([p.x,y-.05,p.z]);
    if(prev&&Math.abs(prev[1]-y)<4){const b=tp.length/3,len=Math.hypot(p.x-prev[0],p.z-prev[2]);
     tp.push(prev[0],prev[1]+.88,prev[2],prev[0],prev[1]+.8,prev[2],p.x,y+.88,p.z,p.x,y+.8,p.z);tu.push(0,1,0,0,len/1.2,1,len/1.2,0);ti.push(b,b+1,b+2,b+1,b+3,b+2);}
    prev=[p.x,y,p.z];
   }
  }
  if(posts.length){const im=keep(new THREE.InstancedMesh(post,postMat,posts.length)),m4=new THREE.Matrix4();posts.forEach(([x,y,z],i)=>im.setMatrixAt(i,m4.makeTranslation(x,y,z)));group.add(im);}
  if(ti.length){const m=mesh(tp,tu,ti,tapeMat);m.castShadow=false;}
 }
 // ---------------------------------------------------------------- arches, the start hut and the finish chute's banners
 const dark=keep(new THREE.MeshStandardMaterial({color:'#24272b',roughness:.6})),timber=keep(new THREE.MeshStandardMaterial({map:planks,color:'#a48a6a',roughness:.85}));
 const boardMat=(t,bg,fg,stripe)=>keep(new THREE.MeshStandardMaterial({map:keep(textTexture(t,{bg,fg,stripe})),roughness:.7}));
 const solids=[];
 const arch=(s,mat)=>{   // (two posts either side of the course, a board across the top)
  const p=mx.point(s,0),g=new THREE.Group(),span=2*hw+3.4,y=H(p.x,p.z);
  const postG=keep(new THREE.BoxGeometry(.35,4.6,.35).translate(0,2.3,0)),boardG=keep(new THREE.BoxGeometry(span+.6,1.3,.14));
  for(const k of [-1,1]){const q=new THREE.Mesh(postG,dark),u=k*span/2,x=p.x-Math.cos(p.heading)*u,z=p.z+Math.sin(p.heading)*u;q.position.set(-u,H(x,z)-y-.1,0);q.castShadow=shadows;g.add(q);solids.push({x,z,r:.4,tall:4.6});}
  const b=new THREE.Mesh(boardG,[dark,dark,dark,dark,mat,mat]);b.position.y=4.3;b.castShadow=shadows;g.add(b);
  g.position.set(p.x,y,p.z);g.rotation.y=p.heading;group.add(g);
 };
 const name=(map.races?.[0]?.name||map.name||'').toUpperCase();
 arch(mx.length-6,boardMat('FINISH','#ffb21a','#16181c','#16181c'));
 {  // (the start hut: a timber shed with a pitched roof, just behind the start)
  const p=mx.point(0,0),c=Math.sin(p.heading),k=Math.cos(p.heading),x=p.x-c*9,z=p.z-k*9,g=new THREE.Group();
  const y=Math.min(H(x-3,z-3),H(x+3,z-3),H(x-3,z+3),H(x+3,z+3));
  const body=new THREE.Mesh(keep(new THREE.BoxGeometry(hw*2+2,3.2,4).translate(0,1.6,0)),timber);
  const roof=new THREE.Mesh(keep(new THREE.CylinderGeometry(.1,(hw*2+3)/1.9,2,4,1).rotateY(Math.PI/4).scale(1,1,.55).translate(0,4.1,0)),dark);
  body.castShadow=roof.castShadow=shadows;body.receiveShadow=true;g.add(body,roof);
  g.position.set(x,y-.2,z);g.rotation.y=p.heading;group.add(g);
 }
 {  // (banners down the last stretch, facing the course)
  const words=[[name,'#1d2124','#f2efe6','#ffb21a'],['UNREVVD','#ffb21a','#16181c',null],['HOLD ON','#f2efe6','#1d2124','#d8262c'],['PARTY ARCADE','#d8262c','#ffffff',null],['NO BRAKES','#1d2124','#ffb21a',null],['SEND IT','#2a5bd8','#ffffff',null]];
  const mats=words.map(w=>boardMat(...w)),postG=keep(new THREE.CylinderGeometry(.06,.07,2.1,6).translate(0,1.05,0)),boardG=keep(new THREE.BoxGeometry(4.4,1,.08));
  let i=0;
  for(let s=mx.length-200;s<mx.length-14;s+=17,i++){
   const side=i%2?1:-1,p=mx.point(s,side*(hw+4.2));if(nearRoad(p.x,p.z,8))continue;
   const y=H(p.x,p.z),g=new THREE.Group(),b=new THREE.Mesh(boardG,[dark,dark,dark,dark,mats[i%mats.length],mats[i%mats.length]]);
   b.position.y=1.55;b.castShadow=shadows;g.add(b);for(const x of [-2.1,2.1]){const q=new THREE.Mesh(postG,dark);q.position.x=x;g.add(q);}
   g.position.set(p.x,y-.1,p.z);g.rotation.y=p.heading+Math.PI/2;group.add(g);
  }
 }
 terrain.addSolids(solids);
 return {dispose(){group.removeFromParent();for(const d of disposables)d.dispose?.();}};
}
