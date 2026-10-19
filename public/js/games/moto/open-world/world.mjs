/** Scene builder only. The returned sampler must also supply the future physics ground. */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildTerrain,routeLength,routePoint} from './terrain.mjs';
import {terrainMaterial} from './materials.mjs';
export function buildOpenWorld(map,{resolution=512,scenery=2400}={}) {
 const terrain=buildTerrain(map), group=new THREE.Group(), disposables=[];
 const mats={}; const mat=(id,color)=>mats[id]||(mats[id]=new THREE.MeshStandardMaterial({color,roughness:.92}));
 const groundGeo=new THREE.PlaneGeometry(...map.size,resolution,resolution); groundGeo.rotateX(-Math.PI/2);
 const pos=groundGeo.attributes.position, colors=new Float32Array(pos.count*3),trailWeights=new Float32Array(pos.count);
 const low=new THREE.Color(map.palette.low),high=new THREE.Color(map.palette.high),trail=new THREE.Color(map.palette.trail),color=new THREE.Color();
 let minHeight=Infinity,maxHeight=-Infinity;
 for(let i=0;i<pos.count;i++) {
  const x=pos.getX(i),z=pos.getZ(i),h=terrain.heightAt(x,z); pos.setY(i,h); minHeight=Math.min(minHeight,h);maxHeight=Math.max(maxHeight,h);
  color.setRGB(1,1,1);
  const road=terrain.roadAt(x,z); if(road)trailWeights[i]=road.weight;
  color.multiplyScalar(.91+Math.sin(x*.037+z*.013)*.035+Math.cos(z*.025)*.025); color.toArray(colors,i*3);
 }
 groundGeo.setAttribute('color',new THREE.BufferAttribute(colors,3));groundGeo.setAttribute('trailWeight',new THREE.BufferAttribute(trailWeights,1));groundGeo.computeVertexNormals();
 const layered=terrainMaterial(map),groundMat=layered.material;
 const ground=new THREE.Mesh(groundGeo,groundMat);ground.receiveShadow=true;group.add(ground);disposables.push(groundGeo,layered);
 function mesh(geo,material,x,y,z,ry=0) { const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.rotation.y=ry;m.castShadow=true;m.receiveShadow=true;group.add(m);disposables.push(geo);return m; }
 function box(w,h,d,x,z,color,dy=0,ry=0) { return mesh(new THREE.BoxGeometry(w,h,d),mat(color,color),x,terrain.heightAt(x,z)+h/2+dy,z,ry); }
 function label(text,x,z,dy=20) {
  const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(12,22,27,.85)';ctx.beginPath();ctx.roundRect(0,0,512,96,18);ctx.fill();ctx.font='600 30px system-ui';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,48,480);
  const texture=new THREE.CanvasTexture(c),material=new THREE.SpriteMaterial({map:texture,depthTest:false});const sprite=new THREE.Sprite(material);sprite.position.set(x,terrain.heightAt(x,z)+dy,z);sprite.scale.set(100,18.75,1);group.add(sprite);disposables.push(texture,material);return sprite;
 }
 // Lakes and the canyon river are actual water surfaces. Land above water naturally occludes them.
 const waterMat=new THREE.MeshStandardMaterial({color:map.palette.water,roughness:map.terrain.lake?.frozen ? .52 : .25,metalness:.25,transparent:true,opacity:.87});disposables.push(waterMat);
 if(map.terrain.lake) {const l=map.terrain.lake;const g=new THREE.CircleGeometry(1,96);g.rotateX(-Math.PI/2);const w=mesh(g,waterMat,...[l.position[0],l.level+(l.frozen ? .12 : 0),l.position[1]]);w.scale.set(l.radius[0]*1.03,1,l.radius[1]*1.03);}
 if(map.terrain.river) {
  const r=map.terrain.river,vertices=[],indices=[];for(let i=0;i<=180;i++) {const z=-map.size[1]/2+map.size[1]*i/180,cx=r.x+Math.sin(z/r.wavelength)*r.amplitude;vertices.push(cx-r.width*.45,r.level,z,cx+r.width*.45,r.level,z);if(i<180){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();mesh(g,waterMat,0,0,0);
 }
 // Instanced scenery keeps thousands of trees/rocks to a handful of draw calls.
 let seed=map.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const pine=map.theme!=='desert',rockGeo=new THREE.DodecahedronGeometry(1,1),trunkGeo=new THREE.CylinderGeometry(.13,.18,2,8);
 const foliage=[];
 if(pine){
  for(const [radius,height,y]of [[1,1.6,-.6],[.79,1.5,.1],[.56,1.45,.75]]){const g=new THREE.ConeGeometry(radius,height,10);g.translate(0,y,0);foliage.push(g);}
 }else{
  const stem=new THREE.CylinderGeometry(.23,.29,2.7,8);foliage.push(stem);
  for(const sign of [-1,1]){const arm=new THREE.CylinderGeometry(.14,.18,1.2,7);arm.rotateZ(Math.PI/2);arm.translate(sign*.55,.15,0);foliage.push(arm);const tip=new THREE.CylinderGeometry(.13,.16,.9,7);tip.translate(sign*1,.55,0);foliage.push(tip);}
 }
 const treeGeo=mergeGeometries(foliage);foliage.forEach(g=>g.dispose());
 const rocks=new THREE.InstancedMesh(rockGeo,mat('rocks',pine?'#7f8c87':'#a86f4e'),scenery),trees=new THREE.InstancedMesh(treeGeo,mat('trees',map.theme==='snow'?'#a6b9bd':pine?'#254b3d':'#657547'),scenery),trunks=new THREE.InstancedMesh(trunkGeo,mat('trunks','#68503a'),scenery);
 let nr=0,nt=0;const dummy=new THREE.Object3D();
 for(let i=0;i<scenery*3;i++) {
  const x=(random()-.5)*(map.size[0]-100),z=(random()-.5)*(map.size[1]-100),y=terrain.heightAt(x,z),road=terrain.roadAt(x,z);
  if(road&&road.distance<36 || map.safePads.some(p=>Math.hypot(x-p.position[0],z-p.position[1])<65) || map.interactions.some(p=>Math.hypot(x-p.position[0],z-p.position[1])<35))continue;
  const lake=map.terrain.lake;if(lake&&Math.hypot((x-lake.position[0])/lake.radius[0],(z-lake.position[1])/lake.radius[1])<1.12)continue;
  const river=map.terrain.river;if(river&&Math.abs(x-river.x-Math.sin(z/river.wavelength)*river.amplitude)<75)continue;
  const size=2+random()*5;
  if((!pine||random()<.25||y>(map.theme==='snow'?650:450))&&nr<scenery){dummy.position.set(x,y+size*.3,z);dummy.scale.set(size,size*(.6+random()),size);dummy.rotation.set(random(),random()*6,random());dummy.updateMatrix();rocks.setMatrixAt(nr++,dummy.matrix);}
  else if(nt<scenery){const h=7+random()*12;dummy.rotation.set(0,random()*6,0);dummy.position.set(x,y+h*.6,z);dummy.scale.set(h*.26,h*.43,h*.26);dummy.updateMatrix();trees.setMatrixAt(nt,dummy.matrix);dummy.position.y=y+h*.15;dummy.scale.set(h*.2,h*.25,h*.2);dummy.updateMatrix();trunks.setMatrixAt(nt++,dummy.matrix);}
 }
 rocks.count=nr;trees.count=trunks.count=nt;group.add(rocks,trees,trunks);disposables.push(rockGeo,treeGeo,trunkGeo);
 // Six distinct destinations: camps, towers, yards, cabins, jetty and lookout decks.
 for(const p of map.spots) {
  const [x,z]=p.position;
  if(p.kind==='tower') {box(16,5,12,x,z,'#d8d6c1');box(2,38,2,x+12,z,'#444b4d');box(12,2,2,x+12,z,'#a4afb1',32);}
  else if(p.kind==='camp') {box(22,7,14,x,z,'#d3bc8e');box(26,2,18,x,z,'#465955',7);for(let i=0;i<4;i++)box(4,3,8,x-30+i*12,z+25,['#f2a54a','#d26545','#b9d6cc','#8da7b2'][i]);}
  else if(p.kind==='yard') {for(let i=0;i<4;i++){box(14,5,6,x-30+i*20,z+20,i%2?'#b9885e':'#757e7e');}box(8,12,8,x+30,z-20,'#d1b68d');}
  else if(p.kind==='cabin'||p.kind==='ruin'){box(17,8,12,x,z,'#83684c');const roof=mesh(new THREE.ConeGeometry(16,7,4),mat('roof','#465955'),x,terrain.heightAt(x,z)+11,z,Math.PI/4);roof.scale.z=.8;}
  else {box(24,1.2,12,x,z,'#a9926b',1);for(const dx of [-10,10])box(1,8,1,x+dx,z,'#d5c6a5');}
  label(p.name,x,z,52);
 }
 for(const it of map.interactions) {
  const [x,z]=it.position,y=terrain.heightAt(x,z),color=it.kind==='race-board'?'#ffce73':map.palette.accent;
  const ring=mesh(new THREE.TorusGeometry(it.radius,.65,6,40),mat('beacon'+color,color),x,y+1,z);ring.rotation.x=Math.PI/2;
  if(it.kind==='pickup')box(3,3,3,x,z,'#d7a154');
  else if(it.kind==='relay'||it.kind==='switch')box(2,6,2,x,z,'#a6c9bc');
 }
 const routes=new THREE.Group();group.add(routes);
 for(const r of map.routes){const points=[],len=routeLength(r);for(let d=0;d<=len;d+=16){const p=routePoint(r,d);points.push(new THREE.Vector3(p.x,terrain.heightAt(p.x,p.z)+1,p.z));}const p=routePoint(r,len);points.push(new THREE.Vector3(p.x,terrain.heightAt(p.x,p.z)+1,p.z));const geo=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineBasicMaterial({color:map.palette.accent,transparent:true,opacity:.55});routes.add(new THREE.Line(geo,material));disposables.push(geo,material);}
 for(const race of map.races){const gate=terrain.gatesFor(race.id)[0],right={x:Math.cos(gate.heading)*12,z:-Math.sin(gate.heading)*12};for(const sign of [-1,1])box(1.4,12,1.4,gate.x+right.x*sign,gate.z+right.z*sign,'#efc56d');box(26,2,1.5,gate.x,gate.z,'#263635',12,gate.heading);}
 // Shared-start pads and a clear boundary, rather than invisible race-corridor barriers.
 for(const p of map.spawnPads) {const [x,z]=p.position;box(3,.12,5,x,z,'#e6dec9',.2,p.heading);}
 // Continuous mountain apron attaches to the exact terrain boundary; the void is hidden behind
 // kilometres of textured rock. The inner cliff face is also in the authoritative height sampler.
 const ringPositions=[],ringColors=[],ringTrails=[],ringIndices=[],perSide=resolution,perimeter=perSide*4;
 const rings=[0,60,170,330,580,900,1250,map.boundary.sceneryApron||1600];
 for(let ring=0;ring<rings.length;ring++)for(let i=0;i<perimeter;i++){
  const side=Math.floor(i/perSide),t=(i%perSide)/perSide,a=map.size[0]/2+rings[ring],b=map.size[1]/2+rings[ring];
  const x=side===0?-a+2*a*t:side===1?a:side===2?a-2*a*t:-a;
  const z=side===0?-b:side===1?-b+2*b*t:side===2?b:b-2*b*t;
  ringPositions.push(x,terrain.heightAt(x,z),z);ringColors.push(1,1,1);ringTrails.push(0);
  if(ring<rings.length-1){const j=ring*perimeter+i,k=ring*perimeter+(i+1)%perimeter;ringIndices.push(j,k,j+perimeter,k,k+perimeter,j+perimeter);}
 }
 const apron=new THREE.BufferGeometry();apron.setAttribute('position',new THREE.Float32BufferAttribute(ringPositions,3));apron.setAttribute('color',new THREE.Float32BufferAttribute(ringColors,3));apron.setAttribute('trailWeight',new THREE.Float32BufferAttribute(ringTrails,1));apron.setIndex(ringIndices);apron.computeVertexNormals();const mountainRim=new THREE.Mesh(apron,groundMat);mountainRim.receiveShadow=true;group.add(mountainRim);disposables.push(apron);
 return {group,terrain,routes,minHeight,maxHeight,dispose(){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const d of [...disposables,...Object.values(mats)])d.dispose();}};
}
