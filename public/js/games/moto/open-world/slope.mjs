/** A floodlit ski run and its lodge (a world with "look": {"floodlights": {"every": metres}} and "features": {"lodge"}).
 * Lamp posts down both edges of every marked piste (staggered, one every `every` metres on each side), their lamps
 * glowing, a warm pool of light on the snow under each one (all of them baked into one sheet over the run, so they
 * cost nothing to draw), and a few real lights that follow you from lamp to lamp to light you and the trees close by.
 * The lodge: a tall hotel with its windows lit, a lower wing and some chalets round it (solid: you ride round them). */
import * as THREE from 'three';
import {routeLength,routePoint} from './terrain.mjs';

const WARM=new THREE.Color('#ffc98a');

/** A glow (a soft round light) for the lamps. */
function glowTexture(){
 const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),grd=g.createRadialGradient(32,32,0,32,32,32);
 grd.addColorStop(0,'rgba(255,248,230,1)');grd.addColorStop(.14,'rgba(255,214,150,.85)');grd.addColorStop(.42,'rgba(255,170,90,.2)');grd.addColorStop(1,'rgba(255,150,70,0)');
 g.fillStyle=grd;g.fillRect(0,0,64,64);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
/** A hotel's wall: cols × floors windows, some lit; returns the wall picture and the glow of the lit windows. */
function facade(cols,floors,seed){
 const W=cols*32,H=floors*40+24,wall=document.createElement('canvas'),glow=document.createElement('canvas');wall.width=glow.width=W;wall.height=glow.height=H;
 const a=wall.getContext('2d'),b=glow.getContext('2d');let s=seed;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 a.fillStyle='#cbbfae';a.fillRect(0,0,W,H);b.fillStyle='#000';b.fillRect(0,0,W,H);
 a.fillStyle='#8e8274';for(let f=0;f<=floors;f++)a.fillRect(0,H-24-f*40,W,3);   // (the floors' lines)
 for(let f=0;f<floors;f++)for(let i=0;i<cols;i++){
  const x=i*32+7,y=H-24-(f+1)*40+9,lit=r()<.62,warm=r();
  a.fillStyle=lit?'#ffd9a0':'#2b3344';a.fillRect(x,y,18,24);
  if(lit){b.fillStyle=warm<.7?'#ffcf8a':'#fff0d0';b.fillRect(x,y,18,24);b.fillStyle='rgba(0,0,0,.35)';b.fillRect(x+8,y,2,24);}
 }
 // the door and the lit lobby along the bottom
 a.fillStyle='#3a2c22';a.fillRect(W/2-20,H-24,40,24);b.fillStyle='#ffcf8a';b.fillRect(W/2-16,H-22,32,20);
 const tex=c=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;};
 return {map:tex(wall),emissiveMap:tex(glow)};
}

export function slopeScenery(terrain,scene,map){
 const group=new THREE.Group();scene.add(group);const disposables=[],H=(x,z)=>terrain.heightAt(x,z);
 const keep=(...o)=>{disposables.push(...o);return o[0];};
 const lamps=[],every=map.look?.floodlights?.every||0;
 // ---------------------------------------------------------------- floodlights down the runs
 const runs=every?(map.routes||[]).filter(r=>r.piste):[];
 for(const r of runs){
  const len=routeLength(r),half=r.width/2;
  for(const side of [-1,1])for(let d=side>0?20:20+every/2;d<len-10;d+=every){
   const p=routePoint(r,d),cx=Math.cos(p.heading),sx=-Math.sin(p.heading),x=p.x+cx*(half+3)*side,z=p.z+sx*(half+3)*side;
   const y=H(x,z),head=new THREE.Vector3(x-cx*side*1.2,y+12.5,z-sx*side*1.2);
   lamps.push({run:r,d,side,x,y,z,head,aim:[p.x+cx*(half-13)*side,p.z+sx*(half-13)*side],face:Math.atan2(-cx*side,-sx*side)});
  }
 }
 if(lamps.length){
  const poleGeo=keep(new THREE.CylinderGeometry(.11,.17,12.6,6).translate(0,6.3,0)),poleMat=keep(new THREE.MeshStandardMaterial({color:'#2c3038',metalness:.6,roughness:.5}));
  const headGeo=keep(new THREE.BoxGeometry(1.7,.42,.5)),headMat=keep(new THREE.MeshBasicMaterial({color:'#fff1d6',toneMapped:false}));
  const poles=new THREE.InstancedMesh(poleGeo,poleMat,lamps.length),heads=new THREE.InstancedMesh(headGeo,headMat,lamps.length),m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),one=new THREE.Vector3(1,1,1);
  lamps.forEach((l,i)=>{poles.setMatrixAt(i,m.makeTranslation(l.x,l.y-.2,l.z));heads.setMatrixAt(i,m.compose(l.head,q.setFromEuler(e.set(.5,l.face,0,'YXZ')),one));});
  poles.computeBoundingSphere();heads.computeBoundingSphere();group.add(poles,heads);keep(poles,heads);
  // the glow round each lamp (seen all the way down the hill)
  const glowTex=keep(glowTexture()),gp=new Float32Array(lamps.length*3);lamps.forEach((l,i)=>gp.set([l.head.x,l.head.y-.2,l.head.z],i*3));
  const gg=keep(new THREE.BufferGeometry());gg.setAttribute('position',new THREE.BufferAttribute(gp,3));
  const glowMat=keep(new THREE.PointsMaterial({map:glowTex,size:9,color:'#ffffff',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false,toneMapped:false}));
  const glow=new THREE.Points(gg,glowMat);glow.frustumCulled=false;group.add(glow);
  // the pools of light on the snow: one sheet draped over each run and a little past its edges, lit where the lamps
  // point (it adds light, so it brightens the snow under it; it fades into the haze like everything else)
  const poolMat=keep(new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-6,toneMapped:false}));
  poolMat.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <fog_fragment>',`#ifdef USE_FOG
 gl_FragColor.rgb*=exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
#endif`);};
  for(const r of runs){
   const len=routeLength(r),half=r.width/2+16,step=3,nu=Math.ceil(len/step),nv=Math.ceil(half*2/step),p=[],c=[],idx=[];
   const mine=lamps.filter(l=>l.run===r),sig2=2*15*15;
   for(let i=0;i<=nu;i++){
    const d=Math.min(len,i*step),q=routePoint(r,d),cx=Math.cos(q.heading),sx=-Math.sin(q.heading),near=mine.filter(l=>Math.abs(l.d-d)<60);
    for(let j=0;j<=nv;j++){
     const a=-half+2*half*j/nv,x=q.x+cx*a,z=q.z+sx*a;let k=0;
     for(const l of near){const dx=x-l.aim[0],dz=z-l.aim[1],dd=dx*dx+dz*dz;k+=Math.exp(-dd/sig2)*.75+Math.exp(-dd/(2*30*30))*.18;}   // (a bright pool and a wider spill)
     const edge=Math.min(1,(half-Math.abs(a))/10);k=Math.min(1.1,k)*edge*.6;
     p.push(x,H(x,z)+.1,z);c.push(WARM.r*k,WARM.g*k,WARM.b*k);
     if(i<nu&&j<nv){const o=i*(nv+1)+j;idx.push(o,o+1,o+nv+1,o+1,o+nv+2,o+nv+1);}
    }
   }
   const g=keep(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setIndex(idx);g.computeBoundingSphere();
   const sheet=new THREE.Mesh(g,poolMat);sheet.renderOrder=1;group.add(sheet);
  }
 }
 // ---------------------------------------------------------------- the lodge: a hotel, a wing and chalets
 const L=map.features?.lodge;
 if(L){
  const [lx,lz]=L.position,turn=L.heading||0,floors=L.floors||5,c=Math.cos(turn),s=Math.sin(turn),solids=[];
  const at=(ax,az)=>[lx+ax*c+az*s,lz-ax*s+az*c];   // (the lodge's own across and along to the world)
  const base=Math.min(...[[-20,-9],[20,-9],[-20,9],[20,9]].map(([a,b])=>H(...at(a,b))));
  const glowWin=new THREE.Color('#ffd7a0'),roofMat=keep(new THREE.MeshStandardMaterial({color:'#eef2f8',roughness:.8})),plain=keep(new THREE.MeshStandardMaterial({color:'#b8ab98',roughness:.9}));
  const block=(w,d,h,ax,az,seed)=>{
   const front=facade(Math.round(w/3),Math.round((h-1)/3.1),seed),side=facade(Math.round(d/3),Math.round((h-1)/3.1),seed+9);keep(front.map,front.emissiveMap,side.map,side.emissiveMap);
   const f=keep(new THREE.MeshStandardMaterial({...front,emissive:glowWin,emissiveIntensity:1.3,roughness:.85})),sd=keep(new THREE.MeshStandardMaterial({...side,emissive:glowWin,emissiveIntensity:1.3,roughness:.85}));
   const [x,z]=at(ax,az),body=new THREE.Mesh(keep(new THREE.BoxGeometry(w,h,d)),[sd,sd,plain,plain,f,f]);body.position.set(x,base+h/2-.5,z);body.rotation.y=turn;group.add(body);
   const roof=new THREE.Mesh(keep(new THREE.BoxGeometry(w+1.2,.7,d+1.2)),roofMat);roof.position.set(x,base+h-.15,z);roof.rotation.y=turn;group.add(roof);   // (snow on the flat roof)
   for(let k=-w/2+d/2;k<=w/2-d/2+.1;k+=d*.8){const [px,pz]=at(ax+k,az);solids.push({x:px,z:pz,r:d*.62,tall:h});}
  };
  block(36,14,floors*3.1+1,0,0,L.seed||5);
  block(20,12,7.2,-26,6,(L.seed||5)+31);
  // chalets: wooden walls, a steep snowy roof, a lit window or two
  const wood=keep(new THREE.MeshStandardMaterial({color:'#6b4a32',roughness:.9})),win=keep(new THREE.MeshBasicMaterial({color:'#ffcf8a',toneMapped:false}));
  const walls=keep(new THREE.BoxGeometry(8,4.4,7)),roofG=keep(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-4.7,0),new THREE.Vector2(4.7,0),new THREE.Vector2(0,3.3)]),{depth:8.2,bevelEnabled:false}).translate(0,0,-4.1)),pane=keep(new THREE.PlaneGeometry(1.3,1.5));
  for(const [ax,az,ry] of [[30,-14,.3],[34,6,-.2],[-12,-26,.1],[8,-30,-.35],[-40,-16,.25]]){
   const [x,z]=at(ax,az),y=H(x,z),h=new THREE.Group();h.position.set(x,y-.3,z);h.rotation.y=turn+ry;group.add(h);
   const w=new THREE.Mesh(walls,wood);w.position.y=2.2;const rf=new THREE.Mesh(roofG,roofMat);rf.position.y=4.35;h.add(w,rf);
   for(const k of [-2,2]){const p=new THREE.Mesh(pane,win);p.position.set(k,2.4,3.52);h.add(p);}
   solids.push({x,z,r:4.6,tall:7});
  }
  terrain.addSolids(solids);
 }
 // ---------------------------------------------------------------- real light from the lamps nearest you
 const lights=[];
 if(lamps.length)for(let i=0;i<4;i++){const p=new THREE.PointLight('#ffcf94',260,75,2);group.add(p);lights.push(p);}
 const order=lamps.map(l=>({l,d:0}));
 return {
  lamps,
  update(eye){
   if(!lights.length)return;
   for(const o of order)o.d=(o.l.x-eye.x)**2+(o.l.z-eye.z)**2;
   order.sort((a,b)=>a.d-b.d);
   lights.forEach((p,i)=>{const l=order[i].l;p.position.set(l.head.x,l.head.y-.6,l.head.z);});
  },
  dispose(){group.removeFromParent();for(const p of lights)p.dispose();for(const d of new Set(disposables))d.dispose();},
 };
}
