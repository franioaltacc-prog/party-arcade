/** What the parks have on top of their shaped ground (terrain.mjs's parkList), and the chairlifts.
 * Rails and boxes in the rail garden (the ground under them is plain: terrain.railAt makes them solid to ride on),
 * a banner over each park's start, flags along the halfpipe and the hill climb, the arena's grandstands (a crowd, light
 * towers and banners), a finish flag at the top of the climb; and each chairlift: towers, the cable, the stations at
 * both ends and its chairs going round. lifts[i].at(d) is where a chair is d metres up the line (for riding it). */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {textTexture} from './buildings.mjs';
import {routeLength,routePoint} from './terrain.mjs';
const cm=new THREE.Matrix4(),cq=new THREE.Quaternion(),yAxis=new THREE.Vector3(0,1,0),unit=new THREE.Vector3(1,1,1),fp=new THREE.Vector3();

export function parkScenery(terrain,scene,map,{shadows=false}={}){
 const group=new THREE.Group();scene.add(group);const disposables=[];
 const mat=(o)=>{const m=new THREE.MeshStandardMaterial(o);disposables.push(m);return m;};
 const geo=(g)=>{disposables.push(g);return g;};
 const add=(g,m,x,y,z,ry=0)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.rotation.y=ry;o.castShadow=shadows;o.receiveShadow=true;group.add(o);return o;};
 const H=(x,z)=>terrain.heightAt(x,z);
 const accent=map.palette?.accent||'#ff6a10';
 const metal=mat({color:'#c9ced6',metalness:.85,roughness:.25}),dark=mat({color:'#24272e',roughness:.7}),pole=mat({color:'#3a3f48',metalness:.5,roughness:.45});
 const boxTop=mat({color:'#f3f5f8',roughness:.35}),boxSide=mat({color:accent,roughness:.5});
 const flagMats=['#ff3b3b','#2a7fff','#ffd23a','#2ecc71','#b44dff'].map(c=>mat({color:c,roughness:.8,side:THREE.DoubleSide}));
 const flagGeo=geo(new THREE.PlaneGeometry(.9,.6).translate(.45,0,0)),poleGeo=geo(new THREE.CylinderGeometry(.05,.06,3.2,6).translate(0,1.6,0));
 const flags=[],flagSpots=[];   // (flags: ones drawn on their own; flagSpots: the many little ones, drawn together below)
 const flag=(x,z,i)=>{flagSpots.push({x,y:H(x,z),z,i,phase:i*.7});};
 /** A banner on two posts across a park's start: w wide, facing along heading. */
 const banner=(x,z,heading,w,text,color=accent)=>{
  const tex=textTexture(text,{bg:'#16181c',fg:'#ffffff',stripe:color});disposables.push(tex);
  const y=H(x,z),c=Math.cos(heading),s=Math.sin(heading),postGeo=geo(new THREE.CylinderGeometry(.18,.22,6,8).translate(0,3,0));
  for(const k of [-1,1])add(postGeo,dark,x+c*w/2*k,H(x+c*w/2*k,z-s*w/2*k),z-s*w/2*k);
  const b=add(geo(new THREE.BoxGeometry(w,1.6,.2)),[dark,dark,dark,dark,mat({map:tex,roughness:.6}),mat({map:tex,roughness:.6})],x,y+5.4,z,heading);return b;
 };
 // ---------------------------------------------------------------- the parks
 for(const f of terrain.parkList||[]){
  const at=(a,c)=>f.at(a,c),turn=f.heading,base=(a)=>f.base+f.tilt*a;
  if(f.park==='rails'){
   for(const it of f.items){
    const [x,z]=at(it.a+it.len/2,it.c),y=base(it.a+it.len/2);
    if(it.rail){
     const r=add(geo(new THREE.CylinderGeometry(.06,.06,it.len,10).rotateX(Math.PI/2)),metal,x,y+it.h-.06,z);r.rotation.set(-Math.atan(f.tilt),turn,0,'YXZ');
     for(const u of [.08,.5,.92]){const [px,pz]=at(it.a+it.len*u,it.c),py=base(it.a+it.len*u);add(geo(new THREE.CylinderGeometry(.05,.05,it.h+.4,6)),pole,px,py+(it.h-.4)/2-.2,pz);}
    }else{
     const b=add(geo(new THREE.BoxGeometry(it.w,it.h+.3,it.len)),[boxSide,boxSide,boxTop,boxSide,boxSide,boxSide],x,y+(it.h-.3)/2,z);b.rotation.set(-Math.atan(f.tilt),turn,0,'YXZ');
    }
   }
   const [bx,bz]=at(-8,0);banner(bx,bz,turn,26,'RAIL GARDEN');
  }else if(f.park==='halfpipe'){
   for(let a=10,i=0;a<=f.len-10;a+=20,i++)for(const k of [-1,1]){const [x,z]=at(a,k*14.2);flag(x,z,i*2+(k>0));}
   const [bx,bz]=at(-12,0);banner(bx,bz,turn,30,'HALFPIPE');
  }else if(f.park==='climb'){
   for(let a=20,i=0;a<f.L;a+=22,i++)for(const k of [-1,1]){const [x,z]=at(a,k*9.5);flag(x,z,i);}
   const [bx,bz]=at(-6,0);banner(bx,bz,turn,22,'HILL CLIMB','#ff3b3b');
   // the finish at the top: a tall chequered flag
   const [tx,tz]=f.top,ty=H(tx,tz),chk=document.createElement('canvas');chk.width=chk.height=64;const g=chk.getContext('2d');
   for(let i=0;i<8;i++)for(let j=0;j<8;j++){g.fillStyle=(i+j)%2?'#111':'#fff';g.fillRect(i*8,j*8,8,8);}
   const ct=new THREE.CanvasTexture(chk);disposables.push(ct);ct.magFilter=THREE.NearestFilter;
   add(geo(new THREE.CylinderGeometry(.1,.12,7,8).translate(0,3.5,0)),pole,tx+5,ty,tz);
   const fl=add(geo(new THREE.PlaneGeometry(2.6,1.7).translate(1.3,0,0)),mat({map:ct,side:THREE.DoubleSide,roughness:.8}),tx+5,ty+6.1,tz);fl.userData.phase=1;flags.push(fl);
  }else if(f.park==='pump'||f.park==='jumps'){
   const [bx,bz]=at(f.park==='pump'?2:-6,f.park==='pump'?12:0);banner(bx,bz,turn,f.park==='pump'?10:14,f.park==='pump'?'PUMP TRACK':'DIRT JUMPS');
  }else if(f.park==='arena'){
   // grandstands all round outside the track, a crowd in them, light towers at the corners
   const crowdCols=['#e74c3c','#3498db','#f1c40f','#2ecc71','#ecf0f1','#9b59b6','#e67e22','#1abc9c'];
   const seat=mat({color:'#5a6170',roughness:.8}),people=[];
   const stand=(a,c,len,facing)=>{
    const [x,z]=at(a,c),y=base(a);
    for(let r=0;r<5;r++){
     const [rx,rz]=at(a,c+facing*r*1.4);add(geo(new THREE.BoxGeometry(1.4,.8+r*.8,len)),seat,rx,y+(.8+r*.8)/2,rz,turn);
     for(let k=0;k<len/1.2;k++)if(Math.random()<.8){const [px,pz]=at(a-len/2+.6+k*1.2,c+facing*r*1.4);people.push([px,y+.8+r*.8+.45,pz]);}
    }
    return [x,z];
   };
   for(const k of [-1,1])stand(f.c0+f.S/2,k*(f.R+f.tw/2+5),f.S,k);
   const pg=geo(new THREE.CapsuleGeometry(.22,.45,2,6)),crowd=new THREE.InstancedMesh(pg,mat({roughness:.9}),people.length);
   const m4=new THREE.Matrix4(),col=new THREE.Color();people.forEach((p,i)=>{crowd.setMatrixAt(i,m4.makeTranslation(p[0],p[1],p[2]));crowd.setColorAt(i,col.set(crowdCols[i%crowdCols.length]));});
   crowd.userData.base=people;group.add(crowd);f.crowd=crowd;
   for(const [a,c] of [[f.c0-f.R-10,-f.R-10],[f.c0-f.R-10,f.R+10],[f.c0+f.S+f.R+10,-f.R-10],[f.c0+f.S+f.R+10,f.R+10]]){
    const [x,z]=at(a,c),y=H(x,z);add(geo(new THREE.CylinderGeometry(.3,.45,22,8).translate(0,11,0)),pole,x,y,z);
    add(geo(new THREE.BoxGeometry(3.2,1.6,.6)),mat({color:'#fffbe0',emissive:'#fff3b0',emissiveIntensity:1.2}),x,y+22,z,turn);
   }
   const [bx,bz]=at(f.c0+f.S/2,0);const t=textTexture('FREESTYLE ARENA',{bg:'#16181c',fg:'#ffffff',stripe:accent});disposables.push(t);
   const board=add(geo(new THREE.BoxGeometry(16,3,.3)),[dark,dark,dark,dark,mat({map:t}),mat({map:t})],bx,base(f.c0+f.S/2)+1.6,bz,turn);board.rotation.y=turn;
  }
 }
 // the little flags: their poles in one draw, the flags in one draw per colour
 let flagIms=[];
 if(flagSpots.length){
  const poles=new THREE.InstancedMesh(poleGeo,pole,flagSpots.length);flagSpots.forEach((f,k)=>poles.setMatrixAt(k,cm.makeTranslation(f.x,f.y,f.z)));group.add(poles);disposables.push(poles);
  flagIms=flagMats.map((m,c)=>{const list=flagSpots.filter(f=>f.i%flagMats.length===c);if(!list.length)return null;const im=new THREE.InstancedMesh(flagGeo,m,list.length);im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);im.userData.list=list;group.add(im);disposables.push(im);return im;}).filter(Boolean);
 }
 // ---------------------------------------------------------------- a resort's piste markers
 // Poles down both edges of each ski run, in its colour (green, blue, red, black), every 30 m: one draw per colour.
 const PISTE={green:'#2ecc71',blue:'#2a7fff',red:'#ff3b3b',black:'#16181c'},stakes={};
 for(const r of map.routes||[]){
  if(!PISTE[r.piste])continue;const len=routeLength(r),list=stakes[r.piste]||(stakes[r.piste]=[]);
  for(let d=10;d<len-10;d+=30){const p=routePoint(r,d),c=Math.cos(p.heading),sn=Math.sin(p.heading);for(const k of [-1,1]){const x=p.x+c*(r.width/2+1.5)*k,z=p.z-sn*(r.width/2+1.5)*k;list.push([x,H(x,z),z]);}}
 }
 const stakeGeo=geo(new THREE.CylinderGeometry(.06,.06,1.8,6).translate(0,.9,0));
 for(const [kind,list] of Object.entries(stakes)){const im=new THREE.InstancedMesh(stakeGeo,mat({color:PISTE[kind],roughness:.5}),list.length);list.forEach((p,i)=>im.setMatrixAt(i,cm.makeTranslation(p[0],p[1]-.1,p[2])));group.add(im);disposables.push(im);}
 // ---------------------------------------------------------------- chairlifts
 const lifts=[];
 for(const L of map.features?.lifts||[]){
  const [x0,z0]=L.from,[x1,z1]=L.to,dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len,heading=Math.atan2(ux,uz);
  const span=45,n=Math.ceil(len/span),towers=[];
  for(let i=0;i<=n;i++){const x=x0+ux*len*i/n,z=z0+uz*len*i/n;towers.push({x,z,y:H(x,z)+11});}
  // (the cable over a hump: lift the towers either side so it clears the ground in between)
  for(let pass=0;pass<3;pass++)for(let i=0;i<n;i++){const a=towers[i],b=towers[i+1];for(let k=1;k<4;k++){const t=k/4,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,clear=a.y+(b.y-a.y)*t-H(x,z);if(clear<6){a.y+=6-clear;b.y+=6-clear;}}}
  // (the towers and their arms: one draw each for the whole line)
  const towerG=geo(new THREE.CylinderGeometry(.35,.5,1,8).translate(0,.5,0)),armG=geo(new THREE.BoxGeometry(5.5,.35,.35));
  const towerIm=new THREE.InstancedMesh(towerG,pole,towers.length),armIm=new THREE.InstancedMesh(armG,pole,towers.length),tq=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading+Math.PI/2),one=new THREE.Quaternion(),tm=new THREE.Matrix4();
  towers.forEach((t,i)=>{const g=H(t.x,t.z);towerIm.setMatrixAt(i,tm.compose(new THREE.Vector3(t.x,g,t.z),one,new THREE.Vector3(1,t.y-g+.5,1)));armIm.setMatrixAt(i,tm.compose(new THREE.Vector3(t.x,t.y+.4,t.z),tq,new THREE.Vector3(1,1,1)));});
  for(const im of [towerIm,armIm]){im.castShadow=shadows;group.add(im);disposables.push(im);}
  // the cable: one line up and one down, 2.2 m apart
  const side=[uz,-ux];
  const at=(d,lane=1)=>{const i=Math.min(n-1,Math.max(0,Math.floor(d/len*n))),t=(d/len*n)-i,a=towers[i],b=towers[i+1],sag=Math.sin(Math.max(0,Math.min(1,t))*Math.PI)*1.2;
   return new THREE.Vector3(a.x+(b.x-a.x)*t+side[0]*1.1*lane,a.y+(b.y-a.y)*t-sag,a.z+(b.z-a.z)*t+side[1]*1.1*lane);};
  for(const lane of [-1,1]){const pts=[];for(let d=0;d<=len;d+=len/(n*6))pts.push(at(d,lane));const lg=geo(new THREE.BufferGeometry().setFromPoints(pts));group.add(new THREE.Line(lg,mat({color:'#1b1d22'})));}
  // stations: a shed and the big wheel at each end
  for(const [x,z,turn] of [[x0,z0,heading],[x1,z1,heading+Math.PI]]){
   const y=H(x,z);add(geo(new THREE.BoxGeometry(7,4.2,6)),mat({color:'#6e4b31',roughness:.85}),x-ux*4*(turn===heading?1:-1),y+2.1,z-uz*4*(turn===heading?1:-1),heading);
   const w=add(geo(new THREE.TorusGeometry(1.4,.15,6,20)),pole,x,y+5.6,z,heading);w.rotation.x=Math.PI/2;
  }
  const [lx,lz]=[x0-ux*2+side[0]*5,z0-uz*2+side[1]*5];banner(lx,lz,heading+Math.PI/2,8,'CHAIRLIFT','#2a7fff');
  // the chairs: a bench on a hanger, going round (one draw for all of them: a chair is one merged shape, moved each frame)
  const chairG=geo(mergeGeometries([new THREE.BoxGeometry(1.5,.12,.6).translate(0,-2.1,0),new THREE.BoxGeometry(1.5,.6,.1).translate(0,-1.8,-.3),new THREE.CylinderGeometry(.04,.04,2.1,4).translate(0,-1.05,0)].map(g=>g.index?g.toNonIndexed():g)));
  const chairMat=mat({color:'#d33f2f',roughness:.6}),count=Math.round(len*2/26);
  const chairIm=new THREE.InstancedMesh(chairG,chairMat,count);chairIm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);chairIm.frustumCulled=false;group.add(chairIm);disposables.push(chairIm);
  // (chairs[i]: where chair i is; update() writes them into the instances)
  const chairs=[...Array(count)].map(()=>({position:new THREE.Vector3(),rotation:{y:0}}));
  const lift={id:L.id,name:L.name||'Chairlift',len,heading,bottom:[x0,z0],top:[x1,z1],exit:{position:[x1+side[0]*9-ux*6,z1+side[1]*9-uz*6],heading:heading+Math.PI},line:at,chairs,chairIm,t:0,speed:L.speed||5,
   /** Where the chair you're riding is (d metres up), facing up the line. */
   seat(d){const p=at(d,1);p.y-=2.0;return p;}};
  lifts.push(lift);
 }
 function update(dt,now=performance.now()/1000){
  for(const f of flags)f.rotation.y=Math.sin(now*2.2+f.userData.phase)*.35;
  for(const im of flagIms){im.userData.list.forEach((f,k)=>im.setMatrixAt(k,cm.compose(fp.set(f.x,f.y+2.85,f.z),cq.setFromAxisAngle(yAxis,Math.sin(now*2.2+f.phase)*.35),unit)));im.instanceMatrix.needsUpdate=true;}
  for(const L of lifts){
   L.t+=dt*L.speed;const n=L.chairs.length,loop=L.len*2;
   L.chairs.forEach((c,i)=>{if(i===0&&L.mine)return;let d=(L.t+i*loop/n)%loop;const up=d<L.len;if(!up)d=loop-d;const p=L.line(d,up?1:-1);c.position.copy(p);c.rotation.y=L.heading+(up?0:Math.PI);});
   L.chairs.forEach((c,i)=>L.chairIm.setMatrixAt(i,cm.compose(c.position,cq.setFromAxisAngle(yAxis,c.rotation.y),unit)));L.chairIm.instanceMatrix.needsUpdate=true;
  }
 }
 return {lifts,update,dispose(){group.removeFromParent();disposables.forEach(d=>d.dispose());}};
}
