import * as THREE from 'three';
import {Sky} from 'three/addons/objects/Sky.js';
import {buildOpenWorld,autumnize} from './world.mjs';
import {gauntletScenery} from './nature.mjs';
import {terrainMaterial} from './materials.mjs';
import {renderPolicy} from './render-policy.mjs';
import {gridHeight} from './grounding.mjs';
import {routeLength,routePoint} from './terrain.mjs';
import {THEMES,particles,makeProps} from '../world.js';

/** The free-ride scene: sky and sun like the race tracks, distance-cullable ground and scenery, a budgeted
 * detailed patch of ground round the rider and grass and pebbles scattered on it. nature: the real tree and rock
 * models (nature.mjs loadNature), for a gauntlet's solid trees and rocks (without them they're the scenery models).
 * A world with "look": {"night": true} is dark: no sun, stars, faint moonlight, thick black fog, and a lamp on the
 * bike (the returned lamp: the game points it where the bike goes). */
export function buildRideWorld(map,quality=1,renderer=null,shadows=false,nature=null){
 const policy=renderPolicy(quality);
 const built=buildOpenWorld(map,{resolution:policy.resolution,chunkSegments:policy.chunkSegments,scenery:policy.scenery,detailed:false,solidProps:!nature});
 built.routes.visible=false; // The textured trails and stakes already mark roads; preview lines can float above coarse hills.
 const scene=new THREE.Scene();scene.add(built.group);
 // The race tracks' skies, tuned for big daytime views: higher sun, clearer air, thinner haze.
 const OPEN={desert:{exposure:1.12,fog:.42},alpine:{sun:[38,205],turbidity:4,rayleigh:1.5,mie:.006,exposure:1.5,fog:.24,fogColor:'#b9c8cf'},snow:{sun:[24,232],turbidity:3,rayleigh:1.3,mie:.005,exposure:1.25,fog:.3,fogColor:'#c9d3e6'}};
 const base=THEMES[map.theme==='alpine'?'forest':map.theme]||THEMES.desert,o={...(OPEN[map.theme]||OPEN.desert),...(map.look?.sky||{})};   // (a world can set its own sun and haze)
 const theme={...base,...o,exposure:base.exposure*o.exposure,fog:o.fogColor||base.fog,fogD:base.fogD*o.fog};
 const night=!!map.look?.night;

 // ---------------------------------------------------------------- sky, sun, haze
 const sky=new Sky();sky.scale.setScalar(20000);const su=sky.material.uniforms;
 su.turbidity.value=theme.turbidity;su.rayleigh.value=theme.rayleigh;su.mieCoefficient.value=theme.mie;su.mieDirectionalG.value=theme.mieG;
 const sunDir=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-Math.max(theme.sun[0],14)),THREE.MathUtils.degToRad(theme.sun[1]));
 // (the light never comes from lower than 14°, for sensible shadows, but the sky can show a real sunset)
 su.sunPosition.value.setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-theme.sun[0]),THREE.MathUtils.degToRad(theme.sun[1]));
 if(night)scene.background=new THREE.Color(theme.fog);else scene.add(sky);
 let env=null;
 if(renderer&&!night){
  const pm=new THREE.PMREMGenerator(renderer),skyScene=new THREE.Scene(),sky2=new Sky();sky2.scale.setScalar(1000);
  for(const k of ['turbidity','rayleigh','mieCoefficient','mieDirectionalG','sunPosition'])sky2.material.uniforms[k].value=su[k].value;
  skyScene.add(sky2);env=pm.fromScene(skyScene,.02).texture;scene.environment=env;scene.environmentIntensity=theme.envI;pm.dispose();sky2.material.dispose();sky2.geometry.dispose();
 }
 scene.fog=new THREE.FogExp2(theme.fog,theme.fogD);
 const sun=new THREE.DirectionalLight(theme.sunColor,theme.sunI);
 if(shadows){
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  const sc=sun.shadow.camera;sc.left=-42;sc.right=42;sc.top=42;sc.bottom=-42;sc.near=1;sc.far=500;
  sun.shadow.bias=-.0005;sun.shadow.normalBias=.05;
 }
 scene.add(sun,sun.target);
 scene.add(new THREE.HemisphereLight(theme.hemi[0],theme.hemi[1],theme.hemi[2]));
 // clouds drifting high over the map
 const cloudCanvas=document.createElement('canvas');cloudCanvas.width=256;cloudCanvas.height=128;{
  const g=cloudCanvas.getContext('2d');let s=map.seed;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  for(let i=0;i<18;i++){const x=256*(.2+r()*.6),y=128*(.45+r()*.2),rad=20+r()*34,grd=g.createRadialGradient(x,y,0,x,y,rad);grd.addColorStop(0,'rgba(255,255,255,.55)');grd.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grd;g.fillRect(0,0,256,128);}
 }
 const cloudTex=new THREE.CanvasTexture(cloudCanvas);cloudTex.colorSpace=THREE.SRGBColorSpace;
 const cloudMat=new THREE.SpriteMaterial({map:cloudTex,color:map.theme==='snow'?'#ffe2ec':'#ffffff',transparent:true,opacity:.75,fog:false,depthWrite:false});
 if(!night){let s=map.seed*7;const r=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  for(let i=0;i<(map.theme==='desert'?16:30);i++){const c=new THREE.Sprite(cloudMat),a=r()*Math.PI*2,d=r()*map.size[0]*.9;c.position.set(Math.cos(a)*d,map.baseHeight+700+r()*500,Math.sin(a)*d);c.scale.set(700+r()*600,240+r()*140,1);scene.add(c);}}
 // a night sky full of stars (beyond the fog)
 let stars=null;
 if(night){
  const n=1800,p=new Float32Array(n*3);let ss=map.seed*13;const r=()=>{ss=(Math.imul(ss,1664525)+1013904223)>>>0;return ss/4294967296;};
  for(let i=0;i<n;i++){const a=r()*Math.PI*2,y=.08+r()*.92,c=Math.sqrt(1-y*y);p.set([Math.cos(a)*c*4000,y*4000,Math.sin(a)*c*4000],i*3);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
  stars=new THREE.Points(g,new THREE.PointsMaterial({color:'#dfe8ff',size:1.6,sizeAttenuation:false,fog:false,transparent:true,opacity:.85,depthWrite:false}));stars.frustumCulled=false;scene.add(stars);
 }
 // the lamp on the bike, and a little light round the rider so you can see your hands and the bars
 let lamp=null;
 if(night){
  const spot=new THREE.SpotLight('#fff3dc',map.look.lamp??260,85,.52,.55,1.7),glow=new THREE.PointLight('#ffe9c8',3.5,5,2);
  spot.castShadow=!!shadows;if(shadows){spot.shadow.mapSize.set(1024,1024);spot.shadow.camera.near=.5;spot.shadow.bias=-.0004;}
  scene.add(spot,spot.target,glow);lamp={spot,glow};
 }
 const fxRoot=new THREE.Group();scene.add(fxRoot);const fx=particles(fxRoot,theme,null,quality);
 const forest=nature&&built.terrain.gauntlets.length?gauntletScenery(built.terrain,nature,scene,{shadows,snow:map.theme==='snow',night,quality}):null;

 // ---------------------------------------------------------------- detailed ground round the rider
 const half=policy.half,n=policy.segments,inner=half-12;
 const geo=new THREE.PlaneGeometry(half*2,half*2,n,n);geo.rotateX(-Math.PI/2);
 const pos=geo.attributes.position,local=pos.array.slice(),color=new Float32Array(pos.count*3).fill(1),trail=new Float32Array(pos.count);
 geo.setAttribute('color',new THREE.BufferAttribute(color,3));geo.setAttribute('trailWeight',new THREE.BufferAttribute(trail,1));
 const detail=terrainMaterial(map,built.layered.textures,true),patch=new THREE.Mesh(geo,detail.material);patch.receiveShadow=true;scene.add(patch);
 let cx=Infinity,cz=Infinity,job=null;const samples=new Map();
 const backPos=new Float32Array(pos.array.length),backColor=new Float32Array(color.length),backTrail=new Float32Array(trail.length);
 const coarse=built.renderHeightAt;
 const visibleHeight=(x,z)=>{
  const distance=Math.max(Math.abs(x-cx),Math.abs(z-cz)),far=coarse(x,z);
  if(distance>=half)return far;
  const near=gridHeight(pos.array,half*2,half*2,n,x-cx,z-cz);
  return distance<inner?near:Math.max(near,far);
 };

 // ---------------------------------------------------------------- grass tufts and pebbles on the detailed ground
 let cs=map.seed+99;const crand=()=>{cs=(Math.imul(cs,1664525)+1013904223)>>>0;return cs/4294967296;};
 const props=makeProps(map.theme==='alpine'?'forest':map.theme,crand,1),pebbleProps=makeProps(map.theme==='alpine'?'forest':map.theme,crand,0);
 const coverKinds=[
  map.theme!=='snow'&&{geo:map.look?.autumn?autumnize(props.PROPS.grass(),map.seed):props.PROPS.grass(),mat:props.leafMat,max:Math.round((map.theme==='desert'?1500:3200)*Math.min(1,quality+.15)),every:map.theme==='desert'?.2:.5,size:[.8,1.5],sink:.04},
  {geo:pebbleProps.PROPS.rock(),mat:props.propMat,max:Math.round(500*Math.min(1,quality+.2)),every:.05,size:[.12,.45],sink:.06},
  map.theme==='alpine'&&{geo:map.look?.autumn?autumnize(props.PROPS.shrub(),map.seed):props.PROPS.shrub(),mat:props.propMat,max:Math.round(260*quality),every:.025,size:[.5,.9],sink:.05},
 ].filter(Boolean).map(k=>{const im=new THREE.InstancedMesh(k.geo,k.mat,k.max);im.count=0;im.receiveShadow=true;im.frustumCulled=false;scene.add(im);return {...k,im};});
 const cHash=(x,z,s)=>{let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^s;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const cm=new THREE.Matrix4(),cq=new THREE.Quaternion(),cv=new THREE.Vector3(),cscale=new THREE.Vector3(),cup=new THREE.Vector3(0,1,0),ctint=new THREE.Color();
 function scatterCover(){
  const lake=map.terrain.lake,river=map.terrain.river,stepM=2;
  for(const k of coverKinds)k.im.count=0;
  for(let gz=Math.ceil((cz-inner)/stepM);gz<=Math.floor((cz+inner)/stepM);gz++)for(let gx=Math.ceil((cx-inner)/stepM);gx<=Math.floor((cx+inner)/stepM);gx++){
   const r0=cHash(gx,gz,map.seed),clump=.5+.5*Math.sin(gx*.19+Math.sin(gz*.11)*2)*Math.cos(gz*.17-gx*.05);
   let acc=0,kind=null;for(const k of coverKinds){acc+=k.every*(k.every>.1?clump*1.4:1);if(r0<acc){kind=k;break;}}
   if(!kind||kind.im.count>=kind.max)continue;
   const x=gx*stepM+(cHash(gx,gz,7)-.5)*1.8,z=gz*stepM+(cHash(gx,gz,13)-.5)*1.8;
   const sample=samples.get(Math.round(x/policy.patchStep)*policy.patchStep+','+Math.round(z/policy.patchStep)*policy.patchStep);
   if(!sample||sample.trail>.12)continue;
   if(lake&&Math.hypot((x-lake.position[0])/lake.radius[0],(z-lake.position[1])/lake.radius[1])<1.08)continue;
   if(river&&Math.abs(x-river.x-Math.sin(z/river.wavelength)*river.amplitude)<river.width*.62)continue;
   if(built.terrain.featureAt(x,z).flat>.02)continue;
   if(kind.every<.1&&kind.size[1]>.6&&built.terrain.gauntletIn(x,z,40))continue;   // (no bushes in a gauntlet: everything big there is solid)
   const y=gridHeight(pos.array,half*2,half*2,n,x-cx,z-cz),s=kind.size[0]+(kind.size[1]-kind.size[0])*cHash(gx,gz,21);
   cq.setFromAxisAngle(cup,cHash(gx,gz,31)*6.283);cm.compose(cv.set(x,y-kind.sink,z),cq,cscale.set(s,s*(.8+cHash(gx,gz,41)*.5),s));
   kind.im.setMatrixAt(kind.im.count,cm);const t=.85+cHash(gx,gz,51)*.3;kind.im.setColorAt(kind.im.count,ctint.setRGB(t,t,t*.97));kind.im.count++;
  }
  for(const k of coverKinds){k.im.instanceMatrix.needsUpdate=true;if(k.im.instanceColor)k.im.instanceColor.needsUpdate=true;}
 }

 function updatePatch(point){
  const x=Math.round(point.x/policy.stride)*policy.stride,z=Math.round(point.z/policy.stride)*policy.stride;
  const teleport=!Number.isFinite(cx)||Math.hypot(point.x-cx,point.z-cz)>half*1.5;
  if(teleport||(!job&&(x!==cx||z!==cz)))job={x,z,i:0,min:Infinity,max:-Infinity};
  if(!job)return;
  const end=teleport?pos.count:Math.min(pos.count,job.i+policy.patchVerticesPerFrame),deadline=performance.now()+policy.patchBudgetMs;
  for(;job.i<end;job.i++){
   if(!teleport&&job.i%64===0&&performance.now()>deadline)break;
   const i=job.i,lx=local[i*3],lz=local[i*3+2],wx=job.x+lx,wz=job.z+lz,blend=Math.max(0,Math.min(1,(Math.max(Math.abs(lx),Math.abs(lz))-inner)/(half-inner)));
   const key=wx+','+wz;let sample=samples.get(key);
   if(!sample){sample={x:wx,z:wz,y:built.terrain.heightAt(wx,wz),trail:Math.max(built.terrain.roadAt(wx,wz)?.weight||0,built.terrain.rampAt(wx,wz).weight),shade:.91+Math.sin(wx*.037+wz*.013)*.035+Math.cos(wz*.025)*.025};sample.tint=built.terrain.tintAt(wx,wz,sample.y);samples.set(key,sample);}
   const y=sample.y+(coarse(wx,wz)-sample.y)*blend;backPos[i*3]=wx;backPos[i*3+1]=y;backPos[i*3+2]=wz;backTrail[i]=sample.trail;
   const tn=sample.tint;backColor[i*3]=sample.shade*(tn?tn[0]:1);backColor[i*3+1]=sample.shade*(tn?tn[1]:1);backColor[i*3+2]=sample.shade*(tn?tn[2]:1);job.min=Math.min(job.min,y);job.max=Math.max(job.max,y);
  }
  if(job.i<pos.count)return;
  const old={x0:cx-half-2,x1:cx+half+2,z0:cz-half-2,z1:cz+half+2};
  cx=job.x;cz=job.z;pos.array.set(backPos);color.set(backColor);trail.set(backTrail);
  geo.attributes.color.needsUpdate=true;pos.needsUpdate=true;geo.attributes.trailWeight.needsUpdate=true;geo.computeVertexNormals();
  geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(cx,(job.min+job.max)/2,cz),Math.hypot(half,half,(job.max-job.min)/2));
  built.layered.hole.set(cx,cz,inner,1);job=null;
  // trees and rocks that were on the old patch go back to the coarse ground; those on the new one sit on it
  if(Number.isFinite(old.x0))built.syncScenery(visibleHeight,old);
  built.syncScenery(visibleHeight,{x0:cx-half-2,x1:cx+half+2,z0:cz-half-2,z1:cz+half+2});
  scatterCover();
  if(samples.size>45000)for(const [key,p]of samples)if(Math.abs(p.x-cx)>half+32||Math.abs(p.z-cz)>half+32)samples.delete(key);
 }
 // ---------------------------------------------------------------- gold coins to collect
 // Along every trail (2 each) and up in the air over every jump (5 each: you have to fly to get them).
 // A collected coin comes back after a while.
 const coins=[],ground=built.terrain;
 for(const r of map.routes){const len=routeLength(r);for(let d=60,i=0;d<len-20;d+=105,i++){const p=routePoint(r,d),o=((i*7)%5-2)*1.6;const x=p.x+Math.cos(p.heading)*o,z=p.z-Math.sin(p.heading)*o;if(ground.rampAt(x,z).weight>0)continue;coins.push({x,y:ground.heightAt(x,z)+1.3,z,value:2,back:0});}}
 for(const ramp of ground.ramps){const s=Math.sin(ramp.heading),c=Math.cos(ramp.heading);for(const [t,up] of [[.15,4.5],[.35,6],[.55,4.5]]){const along=(t-.5)*ramp.length*1.6,x=ramp.position[0]+s*along,z=ramp.position[1]+c*along;coins.push({x,y:ground.heightAt(x,z)+up+ramp.height*.25,z,value:5,back:0});}}
 // and a trail of them over every gap jump
 for(const g of ground.gaps)for(const t of [.2,.5,.8]){const along=g.gap*t,x=g.x+g.s*along,z=g.z+g.c*along;coins.push({x,y:g.base+g.tilt*along+g.height+2+6*4*t*(1-t),z,value:5,back:0});}
 const coinGeo=new THREE.CylinderGeometry(.8,.8,.16,24);coinGeo.rotateX(Math.PI/2);
 const coinMat=new THREE.MeshStandardMaterial({color:'#ffcf3a',metalness:.85,roughness:.28,emissive:'#8a5a00',emissiveIntensity:.45});
 const coinMesh=new THREE.InstancedMesh(coinGeo,coinMat,Math.max(1,coins.length));coinMesh.count=coins.length;coinMesh.frustumCulled=false;coinMesh.castShadow=false;scene.add(coinMesh);
 const cm4=new THREE.Matrix4(),cq4=new THREE.Quaternion(),cy=new THREE.Vector3(0,1,0),cpos=new THREE.Vector3(),cone=new THREE.Vector3(1,1,1),czero=new THREE.Vector3(0,0,0);
 function drawCoins(now){
  const spin=now/1000*2.6;
  coins.forEach((k,i)=>{cq4.setFromAxisAngle(cy,spin+i*.7);cm4.compose(cpos.set(k.x,k.y+Math.sin(now/400+i)*.18,k.z),cq4,k.back>now?czero:cone);coinMesh.setMatrixAt(i,cm4);});
  coinMesh.instanceMatrix.needsUpdate=true;
 }
 // ---------------------------------------------------------------- hoops to fly through (15 coins each)
 // Over every gap jump and the two biggest jumps of each send-it park.
 const hoops=[];
 for(const g of ground.gaps)hoops.push({x:g.x+g.s*g.gap*.55,y:g.base+g.tilt*g.gap*.55+g.height+8.5,z:g.z+g.c*g.gap*.55,heading:g.heading,back:0});
 for(const park of ground.parks)for(const r of [park.ramps[2],park.ramps[4]]){const[x,z]=r.position;hoops.push({x,y:ground.heightAt(x,z)+6.5,z,heading:r.heading,back:0});}
 const hoopGeo=new THREE.TorusGeometry(4.4,.32,10,40),hoopMat=new THREE.MeshStandardMaterial({color:'#ff5fd2',emissive:'#ff2fb8',emissiveIntensity:.9,metalness:.3,roughness:.35});
 const hoopMesh=new THREE.InstancedMesh(hoopGeo,hoopMat,Math.max(1,hoops.length));hoopMesh.count=hoops.length;hoopMesh.frustumCulled=false;scene.add(hoopMesh);
 const hq=new THREE.Quaternion(),hs=new THREE.Vector3();
 function drawHoops(now){
  hoops.forEach((k,i)=>{hq.setFromAxisAngle(cy,k.heading);const pulse=1+Math.sin(now/260+i)*.04;cm4.compose(cpos.set(k.x,k.y,k.z),hq,k.back>now?czero:hs.set(pulse,pulse,pulse));hoopMesh.setMatrixAt(i,cm4);});
  hoopMesh.instanceMatrix.needsUpdate=true;
 }
 /** Coins the bike at (x, y, z) is touching now: each is taken (and comes back in 2 minutes). Returns the value
     collected; onHoop() is called for each hoop flown through. */
 function collect(x,y,z,now,onHoop){
  let got=0;
  for(const k of hoops){if(k.back>now||Math.abs(k.x-x)>4.6||Math.abs(k.z-z)>4.6||Math.abs(k.y-y)>4.6)continue;if(Math.hypot(k.x-x,k.y-y,k.z-z)>4.4)continue;k.back=now+90000;got+=15;onHoop?.();}
  for(const k of coins){if(k.back>now||Math.abs(k.x-x)>3.2||Math.abs(k.z-z)>3.2||Math.abs(k.y-y)>3.4)continue;if(Math.hypot(k.x-x,k.z-z)>3.2)continue;k.back=now+120000;got+=k.value;}
  return got;
 }
 // A soft contact shadow under the bike when there is no shadow map.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,3,32,32,32);gradient.addColorStop(0,'#000b');gradient.addColorStop(1,'#0000');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 const shadowTex=new THREE.CanvasTexture(canvas),shadowGeo=new THREE.PlaneGeometry(3.5,2.2);shadowGeo.rotateX(-Math.PI/2);
 const shadowMat=new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,opacity:.3,polygonOffset:true,polygonOffsetFactor:-2});
 const contact=new THREE.Mesh(shadowGeo,shadowMat);contact.visible=!shadows;scene.add(contact);const up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3();
 return {
  free:true,scene,theme,fx,gates:[],ground:built.terrain,definition:map,policy,sun,coins,collect,lamp,night,
  /** ahead: where to centre the detailed ground (a little ahead of a fast bike, so the ground it's riding into is ready). */
  update(point,dt,camera,ahead=point){
   updatePatch(ahead);fx.update(dt,camera);built.update(camera.position);forest?.update(camera.position);drawCoins(performance.now());drawHoops(performance.now());
   sun.position.copy(point).addScaledVector(sunDir,220);sun.target.position.copy(point);
   if(!shadows){
    const y=built.terrain.heightAt(point.x,point.z),nn=built.terrain.normalAt(point.x,point.z);
    contact.position.set(point.x,y+.045,point.z);contact.quaternion.setFromUnitVectors(up,normal.set(nn.x,nn.y,nn.z));shadowMat.opacity=.3*Math.max(0,1-Math.max(0,point.y-y-.65)/7);
   }
  },
  dispose(){
   samples.clear();built.dispose();forest?.dispose();geo.dispose();detail.dispose();shadowGeo.dispose();shadowMat.dispose();shadowTex.dispose();
   for(const k of coverKinds){k.im.dispose();k.geo.dispose();}for(const m of [props.propMat,props.leafMat,props.cactusMat,pebbleProps.propMat,pebbleProps.leafMat,pebbleProps.cactusMat])m.dispose();
   cloudTex.dispose();cloudMat.dispose();if(stars){stars.geometry.dispose();stars.material.dispose();}if(lamp){lamp.spot.dispose();lamp.glow.dispose();}coinMesh.dispose();coinGeo.dispose();coinMat.dispose();hoopMesh.dispose();hoopGeo.dispose();hoopMat.dispose();sky.geometry.dispose();sky.material.dispose();env?.dispose();
   const textures=new Set();fxRoot.traverse(o=>{o.geometry?.dispose();if(o.material){for(const u of Object.values(o.material.uniforms||{}))if(u.value?.isTexture)textures.add(u.value);if(o.material.map)textures.add(o.material.map);o.material.dispose();}});textures.forEach(t=>t.dispose());
  }
 };
}
