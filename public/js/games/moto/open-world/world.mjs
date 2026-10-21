/** Scene builder for an open world: ground, water, scenery, buildings and trail furniture.
 * The terrain sampler (terrain.mjs) is the physics ground too; rendering never changes it.
 * Scenery is instanced in 250 m chunks, each with a detailed and a cheap far model; call update(cameraPosition)
 * every frame so only nearby chunks draw their detailed copies. */
import * as THREE from 'three';
import {buildTerrain,routeLength,routePoint} from './terrain.mjs';
import {terrainMaterial} from './materials.mjs';
import {gridHeight} from './grounding.mjs';
import {makeProps} from '../world.js';
import {buildingGeometry,signGeometry,textTexture,archGeometry,hayGeometry,stakeGeometry,flagGeometry} from './buildings.mjs';

const CHUNK=250;
/** Autumn: turn the green of leaves and grass (vertex colours) gold, orange and red, keeping their light and shade.
 * Neighbouring leaves get the same colour, so a tree turns as a whole rather than in speckles. */
export function autumnize(geo,seed=1){
 const c=geo.attributes.color;if(!c)return geo;
 const p=geo.attributes.position,hues=[[1,.62,.16],[.95,.38,.1],[.78,.16,.08],[1,.82,.28],[.66,.42,.14]];
 for(let i=0;i<c.count;i++){
  const r=c.getX(i),g=c.getY(i),b=c.getZ(i);
  if(!(g>r*1.08&&g>b))continue;   // only the green bits (not bark, rock or flowers)
  const l=(r+g+b)/3*1.9,k=Math.abs(Math.floor(p.getX(i)*.8)*7+Math.floor(p.getY(i)*.8)*13+Math.floor(p.getZ(i)*.8)*5+seed)%hues.length,h=hues[k];
  c.setXYZ(i,h[0]*l,h[1]*l,h[2]*l);
 }
 c.needsUpdate=true;return geo;
}
/** What grows where: attempts per km², size range, steepest slope allowed, clustering (0 = even, 1 = tight
 * groves), how far the detailed model shows, how far anything shows (0 = only near), and how far to sink it. */
const FLORA={
 desert:[
  {kind:'cactus',per:330,size:[.75,1.45],slope:.86,cluster:.15,near:300,far:1700,sink:.15,clear:5},
  {kind:'rock',per:200,size:[.9,4.8],slope:.6,cluster:.35,near:320,far:2200,sink:.35,clear:7},
  {kind:'shrub',per:900,size:[.9,1.8],slope:.8,cluster:.2,near:220,far:0,sink:.05,clear:3},
  {kind:'barrel',per:300,size:[.7,1.3],slope:.85,cluster:.2,near:180,far:0,sink:.05,clear:3},
  {kind:'deadtree',per:30,size:[1,1.8],slope:.85,cluster:0,near:420,far:1500,sink:.2,clear:5},
 ],
 alpine:[
  {kind:'pine',per:4200,size:[.85,1.9],slope:.8,cluster:.55,near:380,far:2700,sink:.25,clear:7},
  {kind:'broadleaf',per:500,size:[.9,1.5],slope:.86,cluster:.3,near:340,far:2200,sink:.2,clear:7},
  {kind:'rock',per:200,size:[.8,3.6],slope:.55,cluster:.4,near:320,far:1800,sink:.35,clear:6},
  {kind:'shrub',per:900,size:[.8,1.6],slope:.75,cluster:.35,near:220,far:0,sink:.05,clear:3},
  {kind:'log',per:60,size:[.8,1.3],slope:.9,cluster:.4,near:220,far:0,sink:.05,clear:4},
 ],
 snow:[
  {kind:'snowpine',per:3000,size:[.85,1.8],slope:.82,cluster:.55,near:400,far:2700,sink:.25,clear:7,treeLine:430},
  {kind:'rock',per:240,size:[1,5],slope:.45,cluster:.45,near:360,far:2200,sink:.4,clear:7},
  {kind:'snowbank',per:220,size:[.8,1.8],slope:.85,cluster:.3,near:300,far:0,sink:.15,clear:4},
 ],
};
const ACCENT={desert:'#ff6a10',alpine:'#2ecc71',snow:'#2a7fff'};

export function buildOpenWorld(map,{resolution=512,scenery=2400,chunkSegments=0,detailed=true}={}) {
 const terrain=buildTerrain(map), group=new THREE.Group(), disposables=[], theme=map.theme, W=map.size[0], D=map.size[1];
 const mats={}; const mat=(id,make)=>mats[id]||(mats[id]=make());
 // ---------------------------------------------------------------- the ground
 const groundGeo=new THREE.PlaneGeometry(W,D,resolution,resolution); groundGeo.rotateX(-Math.PI/2);
 const pos=groundGeo.attributes.position, colors=new Float32Array(pos.count*3),trailWeights=new Float32Array(pos.count);
 let minHeight=Infinity,maxHeight=-Infinity;
 for(let i=0;i<pos.count;i++) {
  const x=pos.getX(i),z=pos.getZ(i),h=terrain.heightAt(x,z); pos.setY(i,h); minHeight=Math.min(minHeight,h);maxHeight=Math.max(maxHeight,h);
  trailWeights[i]=Math.max(terrain.roadAt(x,z)?.weight||0,terrain.rampAt(x,z).weight);
  const k=.91+Math.sin(x*.037+z*.013)*.035+Math.cos(z*.025)*.025; colors[i*3]=colors[i*3+1]=colors[i*3+2]=k;
 }
 groundGeo.setAttribute('color',new THREE.BufferAttribute(colors,3));groundGeo.setAttribute('trailWeight',new THREE.BufferAttribute(trailWeights,1));groundGeo.computeVertexNormals();
 const layered=terrainMaterial(map,null,detailed),groundMat=layered.material;
 const ground=new THREE.Mesh(groundGeo,groundMat);ground.receiveShadow=true;
 if(!chunkSegments)group.add(ground);
 else{
  // Bounded tiles let the renderer reject ground behind the camera instead of drawing the whole map.
  const normal=groundGeo.attributes.normal;
  for(let row=0;row<resolution;row+=chunkSegments)for(let col=0;col<resolution;col+=chunkSegments){
   const nx=Math.min(chunkSegments,resolution-col),nz=Math.min(chunkSegments,resolution-row),p=[],c=[],t=[],normals=[],indices=[];
   for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const i=(row+z)*(resolution+1)+col+x;p.push(pos.getX(i),pos.getY(i),pos.getZ(i));c.push(colors[i*3],colors[i*3+1],colors[i*3+2]);t.push(trailWeights[i]);normals.push(normal.getX(i),normal.getY(i),normal.getZ(i));if(z<nz&&x<nx){const a=z*(nx+1)+x;indices.push(a,a+nx+1,a+1,a+nx+1,a+nx+2,a+1);}}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('trailWeight',new THREE.Float32BufferAttribute(t,1));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);g.computeBoundingSphere();
   const tile=new THREE.Mesh(g,groundMat);tile.receiveShadow=true;group.add(tile);disposables.push(g);
  }
 }
 disposables.push(groundGeo,layered);
 const renderHeightAt=(x,z)=>gridHeight(pos.array,W,D,resolution,x,z);
 const coarseUp=(x,z)=>{const e=6,hx=renderHeightAt(x+e,z)-renderHeightAt(x-e,z),hz=renderHeightAt(x,z+e)-renderHeightAt(x,z-e);return 2*e/Math.hypot(hx,2*e,hz);};
 const trueUp=(x,z)=>terrain.normalAt(x,z,1.5).y;

 // ---------------------------------------------------------------- water
 const lake=map.terrain.lake, river=map.terrain.river;
 const waterMat=new THREE.MeshStandardMaterial({color:map.palette.water,roughness:lake?.frozen ? .35 : .08,metalness:lake?.frozen ? .1 : .35,transparent:true,opacity:lake?.frozen ? .95 : .82});disposables.push(waterMat);
 if(lake) {const g=new THREE.CircleGeometry(1,96);g.rotateX(-Math.PI/2);const w=new THREE.Mesh(g,waterMat);w.position.set(lake.position[0],lake.level+(lake.frozen ? .12 : 0),lake.position[1]);w.scale.set(lake.radius[0]*1.03,1,lake.radius[1]*1.03);w.receiveShadow=true;group.add(w);disposables.push(g);}
 if(river) {
  const vertices=[],indices=[];for(let i=0;i<=180;i++) {const z=-D/2+D*i/180,cx=river.x+Math.sin(z/river.wavelength)*river.amplitude;vertices.push(cx-river.width*.45,river.level,z,cx+river.width*.45,river.level,z);if(i<180){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();group.add(new THREE.Mesh(g,waterMat));disposables.push(g);
 }
 const lakeDist=(x,z)=>lake?Math.hypot((x-lake.position[0])/lake.radius[0],(z-lake.position[1])/lake.radius[1]):Infinity;
 const riverDist=(x,z)=>river?Math.abs(x-river.x-Math.sin(z/river.wavelength)*river.amplitude):Infinity;

 // ---------------------------------------------------------------- scenery: trees, rocks, cacti, shrubs
 let seed=map.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const density=Math.max(.2,scenery/1700);
 const near=makeProps(theme==='alpine'?'forest':theme,random,1), far=makeProps(theme==='alpine'?'forest':theme,random,0);
 const keepOut=[...map.safePads.map(p=>[p.position,48]),...map.spots.map(s=>[s.position,40]),...(map.spawnPads||[]).map(p=>[p.position,20])];
 const chunks=new Map(), dummy=new THREE.Object3D(), tint=new THREE.Color();
 const cluster=(x,z,k)=>{let n=0,a=.5,f=1/380,t=0;for(let i=0;i<3;i++){const s=Math.sin(x*f*1.7+z*f*.6+k*5.1+i*2.3)*Math.cos(z*f*1.3-x*f*.4+k*3.7+i*1.1);n+=a*s;t+=a;a*=.5;f*=2.1;}return .5+.5*n/t;};
 for(const spec of FLORA[theme]||FLORA.alpine) {
  const attempts=Math.round(spec.per*W*D/1e6*density*(spec.far?1:.8));
  for(let i=0;i<attempts;i++) {
   const x=(random()-.5)*W,z=(random()-.5)*D,r1=random(),r2=random(),r3=random(),r4=random();
   if(spec.cluster&&cluster(x,z,spec.kind.length)<spec.cluster*.9+r1*.18)continue;
   if(terrain.cliffRise(x,z)>(spec.kind==='rock'?260:90))continue;
   const road=terrain.roadAt(x,z);if(road&&road.distance<9+spec.clear)continue;
   if(terrain.rampAt(x,z).weight>0)continue;
   if(keepOut.some(([p,r])=>Math.hypot(x-p[0],z-p[1])<r))continue;
   if(lakeDist(x,z)<1.1||riverDist(x,z)<(river?river.width*.62:0))continue;
   const y=renderHeightAt(x,z);if(spec.treeLine&&y>map.baseHeight+spec.treeLine+r2*80)continue;
   if(coarseUp(x,z)<spec.slope)continue;
   const s=spec.size[0]+(spec.size[1]-spec.size[0])*Math.pow(r2,1.6);
   const key=Math.floor(x/CHUNK)+','+Math.floor(z/CHUNK);
   if(!chunks.has(key))chunks.set(key,{x0:Math.floor(x/CHUNK)*CHUNK,z0:Math.floor(z/CHUNK)*CHUNK,lists:new Map(),meshes:[]});
   const list=chunks.get(key).lists;if(!list.has(spec))list.set(spec,[]);
   const tilt=spec.kind==='rock'?(r3-.5)*.6:spec.kind==='log'?0:(r3-.5)*.1;
   list.get(spec).push({x,z,sink:spec.sink*s+(spec.kind==='rock'?s*.12:0),rot:r4*Math.PI*2,tilt,s,sy:s*(spec.kind==='rock'?.7+r1*.6:1),shade:.84+r3*.3});
  }
 }
 const geos=new Map();
 for(const spec of FLORA[theme]||FLORA.alpine){const g={near:near.PROPS[spec.kind](),far:spec.far?far.PROPS[spec.kind]():null,mat:near.MATS[spec.kind]||near.propMat};geos.set(spec,g);disposables.push(g.near);if(g.far)disposables.push(g.far);
  if(map.look?.autumn&&(spec.kind==='broadleaf'||spec.kind==='shrub')){autumnize(g.near,map.seed);if(g.far)autumnize(g.far,map.seed);}}
 for(const m of [near.propMat,near.leafMat,near.cactusMat,far.propMat,far.leafMat,far.cactusMat])disposables.push(m);
 const place=(item,y,matrix)=>{dummy.position.set(item.x,y-item.sink,item.z);dummy.rotation.set(item.tilt,item.rot,item.tilt*.5);dummy.scale.set(item.s,item.sy,item.s);dummy.updateMatrix();matrix.copy(dummy.matrix);};
 const tmpM=new THREE.Matrix4(),hidden=new THREE.Matrix4().makeScale(0,0,0);
 // Far copies live in big 1 km blocks (few draw calls); while a 250 m chunk is close, its own detailed
 // copies draw instead and its far copies are shrunk to nothing.
 const BLOCK=1000,blocks=new Map();
 for(const chunk of chunks.values()) for(const [spec,items] of chunk.lists) {
  const g=geos.get(spec),pair={spec,items,close:false,near:new THREE.InstancedMesh(g.near,g.mat,items.length),far:null};
  if(g.far){
   const key=spec.kind+':'+Math.floor(chunk.x0/BLOCK)+','+Math.floor(chunk.z0/BLOCK);
   if(!blocks.has(key))blocks.set(key,{spec,geo:g.far,mat:g.mat,items:[],x0:Math.floor(chunk.x0/BLOCK)*BLOCK,z0:Math.floor(chunk.z0/BLOCK)*BLOCK});
   pair.far=blocks.get(key);
   for(const item of items){item.block=pair.far;item.farIndex=pair.far.items.length;pair.far.items.push(item);}
  }
  items.forEach((item,i)=>{
   place(item,renderHeightAt(item.x,item.z),tmpM);item.matrix=tmpM.clone();pair.near.setMatrixAt(i,tmpM);
   const k=item.shade;item.tint=tint.setRGB(k*(.96+((i*37)%9)/100),k,k*(.96+((i*53)%9)/100)).clone();pair.near.setColorAt(i,item.tint);
  });
  pair.near.computeBoundingSphere();pair.near.castShadow=spec.kind!=='snowbank';pair.near.receiveShadow=true;pair.near.visible=false;group.add(pair.near);
  chunk.meshes.push(pair);
 }
 for(const b of blocks.values()){
  b.mesh=new THREE.InstancedMesh(b.geo,b.mat,b.items.length);
  b.items.forEach((item,i)=>{b.mesh.setMatrixAt(i,item.matrix);b.mesh.setColorAt(i,item.tint);});
  b.mesh.computeBoundingSphere();b.mesh.castShadow=false;b.mesh.receiveShadow=true;group.add(b.mesh);
 }
 /** Re-seat the scenery inside a rectangle on whatever ground is being drawn there now. */
 function syncScenery(heightAt=renderHeightAt,region=null){
  for(const chunk of chunks.values()){
   if(region&&(chunk.x0>region.x1||chunk.x0+CHUNK<region.x0||chunk.z0>region.z1||chunk.z0+CHUNK<region.z0))continue;
   for(const pair of chunk.meshes){
    let dirty=false;
    pair.items.forEach((item,i)=>{
     if(region&&(item.x<region.x0||item.x>region.x1||item.z<region.z0||item.z>region.z1))return;
     place(item,heightAt(item.x,item.z),tmpM);pair.near.setMatrixAt(i,tmpM);dirty=true;
    });
    if(dirty)pair.near.instanceMatrix.needsUpdate=true;
   }
  }
 }
 /** Detailed models nearby, cheap ones further out, nothing past the fog. */
 const dist=(x0,z0,size,eye)=>Math.hypot(Math.max(x0-eye.x,0,eye.x-x0-size),Math.max(z0-eye.z,0,eye.z-z0-size));
 function update(eye){
  const touched=new Set();
  for(const chunk of chunks.values()){
   const d=dist(chunk.x0,chunk.z0,CHUNK,eye);
   for(const pair of chunk.meshes){
    const close=d<pair.spec.near;if(close===pair.close)continue;
    pair.close=close;pair.near.visible=close;
    if(pair.far){for(const item of pair.items)pair.far.mesh.setMatrixAt(item.farIndex,close?hidden:item.matrix);touched.add(pair.far.mesh);}
   }
  }
  for(const m of touched)m.instanceMatrix.needsUpdate=true;
  for(const b of blocks.values())b.mesh.visible=dist(b.x0,b.z0,BLOCK,eye)<b.spec.far;
 }

 // ---------------------------------------------------------------- buildings, signs and arches
 const buildMat=mat('build',()=>new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82}));
 const solid=(geo,x,y,z,ry=0)=>{const m=new THREE.Mesh(geo,buildMat);m.position.set(x,y,z);m.rotation.y=ry;m.castShadow=true;m.receiveShadow=true;group.add(m);disposables.push(geo);return m;};
 const signGeo=signGeometry(theme);disposables.push(signGeo);
 for(const b of terrain.buildings) {
  const {spot,x,z,ry,trail,away:[ax,az]}=b;
  solid(buildingGeometry(spot.kind,theme,(map.seed+spot.id.length*977)>>>0,b.clear),x,terrain.heightAt(x,z),z,ry);
  // a sign by the trail with the place's name
  const sx=trail.x+ax*(trail.width/2+5),sz=trail.z+az*(trail.width/2+5);
  const sign=solid(signGeo,sx,terrain.heightAt(sx,sz)-.15,sz,ry);
  const tex=textTexture(spot.name,{bg:'#3b2a1c',fg:'#f7ecd6'}),signMat=new THREE.MeshStandardMaterial({map:tex,roughness:.8});disposables.push(tex,signMat);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(5.7,1.35),signMat);face.position.set(0,2.3,-0.03);sign.add(face);disposables.push(face.geometry);
 }
 const accent=ACCENT[theme]||'#ff6a10';
 for(const a of terrain.arches){
  const right={x:Math.cos(a.heading)*a.width/2,z:-Math.sin(a.heading)*a.width/2};
  const y=Math.min(terrain.heightAt(a.x+right.x,a.z+right.z),terrain.heightAt(a.x-right.x,a.z-right.z))-.3;
  const arch=solid(archGeometry(a.width,accent),a.x,y,a.z,a.heading);
  const tex=textTexture(a.label,{bg:'#16181c',fg:'#ffffff',stripe:accent}),banner=new THREE.MeshStandardMaterial({map:tex,roughness:.6});disposables.push(tex,banner);
  for(const side of [-1,1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(a.width+1.3,1.75),banner);p.position.set(0,8.9,side*.67);p.rotation.y=side>0?0:Math.PI;arch.add(p);disposables.push(p.geometry);}
 }

 // ---------------------------------------------------------------- trail stakes, jump parks
 const stakes=[],hay=[],flags=[];
 for(const r of map.routes){const len=routeLength(r);for(let d=20,i=0;d<len;d+=42,i++){const p=routePoint(r,d),side=i%2?1:-1,o=r.width/2+2.6;const x=p.x+Math.cos(p.heading)*o*side,z=p.z-Math.sin(p.heading)*o*side;if(terrain.rampAt(x,z).weight<.05&&lakeDist(x,z)>1.05&&riverDist(x,z)>(river?river.width*.5:0))stakes.push([x,z,0]);}}
 for(const ramp of terrain.ramps){
  const s=Math.sin(ramp.heading),c=Math.cos(ramp.heading),side=(along,across)=>[ramp.position[0]+s*along+c*across,ramp.position[1]+c*along-s*across];
  for(const k of [-1,1]){hay.push([...side(-ramp.length/2-3,k*(ramp.width*.5+1.5)),ramp.heading+Math.PI/2]);hay.push([...side(-ramp.length/2-3,k*(ramp.width*.5+3)),ramp.heading+Math.PI/2]);}
  if(ramp.park)for(const k of [-1,1])for(const t of [-.15,.25])flags.push([...side(ramp.length*t,k*(ramp.width*.75)),k]);
 }
 for(const park of terrain.parks){
  const x=park.start[0]+Math.cos(park.heading)*16,z=park.start[1]-Math.sin(park.heading)*16,sign=solid(signGeo,x,terrain.heightAt(x,z)-.15,z,park.heading+Math.PI);
  const tex=textTexture('Send-it park',{bg:accent,fg:'#ffffff'}),m=new THREE.MeshStandardMaterial({map:tex,roughness:.7});disposables.push(tex,m);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(5.7,1.35),m);face.position.set(0,2.3,-0.03);sign.add(face);disposables.push(face.geometry);
 }
 const instanced=(geo,material,list,matrixFor)=>{if(!list.length)return;const im=new THREE.InstancedMesh(geo,material,list.length);list.forEach((it,i)=>{matrixFor(it);dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);});im.computeBoundingSphere();im.castShadow=true;im.receiveShadow=true;group.add(im);disposables.push(geo);};
 dummy.scale.set(1,1,1);dummy.rotation.set(0,0,0);
 instanced(stakeGeometry(accent),buildMat,stakes,([x,z])=>{dummy.position.set(x,terrain.heightAt(x,z)-.3,z);dummy.rotation.set(0,0,0);});
 instanced(hayGeometry(),buildMat,hay,([x,z,h])=>{dummy.position.set(x,terrain.heightAt(x,z)-.1,z);dummy.rotation.set(0,h,0);});
 instanced(flagGeometry(accent),buildMat,flags,([x,z,k])=>{dummy.position.set(x,terrain.heightAt(x,z)-.3,z);dummy.rotation.set(0,k>0?0:Math.PI,0);});

 // Route preview lines (the /games/moto-worlds inspector shows them; free ride hides them).
 const routes=new THREE.Group();group.add(routes);
 for(const r of map.routes){const points=[],len=routeLength(r);for(let d=0;d<=len;d+=16){const p=routePoint(r,d);points.push(new THREE.Vector3(p.x,terrain.heightAt(p.x,p.z)+.5,p.z));}const geo=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineBasicMaterial({color:map.palette.accent,transparent:true,opacity:.55});routes.add(new THREE.Line(geo,material));disposables.push(geo,material);}

 // ---------------------------------------------------------------- the mountain apron outside the edge
 // Continuous rings of terrain out past the boundary, so the horizon is mountains rather than a void.
 const ringPositions=[],ringColors=[],ringTrails=[],ringIndices=[],perSide=Math.min(resolution,160),perimeter=perSide*4;
 const rings=[0,90,220,380,580,830,1150,map.boundary.sceneryApron||1600];
 for(let ring=0;ring<rings.length;ring++)for(let i=0;i<perimeter;i++){
  const side=Math.floor(i/perSide),t=(i%perSide)/perSide,a=W/2+rings[ring],b=D/2+rings[ring];
  const x=side===0?-a+2*a*t:side===1?a:side===2?a-2*a*t:-a;
  const z=side===0?-b:side===1?-b+2*b*t:side===2?b:b-2*b*t;
  ringPositions.push(x,ring?terrain.heightAt(x,z):renderHeightAt(x,z),z);ringColors.push(1,1,1);ringTrails.push(0);
  if(ring<rings.length-1){const j=ring*perimeter+i,k=ring*perimeter+(i+1)%perimeter;ringIndices.push(j,k,j+perimeter,k,k+perimeter,j+perimeter);}
 }
 const apron=new THREE.BufferGeometry();apron.setAttribute('position',new THREE.Float32BufferAttribute(ringPositions,3));apron.setAttribute('color',new THREE.Float32BufferAttribute(ringColors,3));apron.setAttribute('trailWeight',new THREE.Float32BufferAttribute(ringTrails,1));apron.setIndex(ringIndices);apron.computeVertexNormals();const mountainRim=new THREE.Mesh(apron,groundMat);mountainRim.receiveShadow=true;group.add(mountainRim);disposables.push(apron);
 update({x:map.spawn[0],z:map.spawn[1]});
 return {group,terrain,routes,minHeight,maxHeight,ground,layered,renderHeightAt,syncScenery,update,trueUp,dispose(){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});for(const d of [...new Set(disposables),...Object.values(mats)])d.dispose();}};
}
