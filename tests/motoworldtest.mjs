// Run with Node: node tests/motoworldtest.mjs. No browser or network needed.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildTerrain,routeLength,routePoint} from '../public/js/games/moto/open-world/terrain.mjs';
import {renderPolicy} from '../public/js/games/moto/open-world/render-policy.mjs';
await import('../public/js/games/moto/core.js');
const C=globalThis.MotoCore;
const base=new URL('../public/js/games/moto/open-world/',import.meta.url);
const read=f=>JSON.parse(readFileSync(new URL(f,base),'utf8'));
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('riding terrain stays under 120k triangles with detail around the bike at every quality',()=>{
 let previous=0;
 for(const q of [.35,.65,1]){
  const p=renderPolicy(q),triangles=2*p.resolution**2+2*p.segments**2+56*p.resolution;
  assert(triangles<120000);assert(triangles>=previous);previous=triangles;
  assert(p.half*2/p.segments<=2);assert(p.chunkSegments<=32);
  assert(p.patchBudgetMs<=2);assert(p.patchVerticesPerFrame<(p.segments+1)**2);
 }
});
for(const entry of read('manifest.json').worlds){
 const w=read(entry.file),t=buildTerrain(w),ids=new Set([...w.spots,...w.interactions,...w.races].map(x=>x.id));
 check(w.id+': large map and six safe multiplayer spawns',()=>{assert(w.size[0]*w.size[1]>=1e7);assert.equal(w.spawnPads.length,6);for(const p of w.spawnPads){assert(t.inBounds(...p.position,100));assert(Number.isFinite(t.heightAt(...p.position)));}});
 check(w.id+': unique IDs and valid quest references',()=>{assert.equal(ids.size,w.spots.length+w.interactions.length+w.races.length);for(const q of w.quests){assert(w.spots.some(p=>p.id===q.start));for(const s of q.steps)assert(ids.has(s.target),s.target);}});
 check(w.id+': finite deterministic terrain, normalized normals and real hills',()=>{let min=Infinity,max=-Infinity;const again=buildTerrain(w);for(let x=-w.size[0]/2;x<=w.size[0]/2;x+=53)for(let z=-w.size[1]/2;z<=w.size[1]/2;z+=53){const h=t.heightAt(x,z);assert(Number.isFinite(h));assert.equal(h,again.heightAt(x,z));min=Math.min(h,min);max=Math.max(h,max);const n=t.normalAt(x,z);assert(Math.abs(Math.hypot(n.x,n.y,n.z)-1)<1e-10);}assert(max-min>200);console.log('  Elevation range: '+Math.round(max-min)+' m');});
 check(w.id+': all routes stay inside the world, finish in order and have safe water crossings',()=>{for(const r of w.routes){const len=routeLength(r);assert(len>200);if(r.closed)assert.deepEqual(r.points[0],r.points.at(-1));for(let d=0;d<=len;d+=10){const p=routePoint(r,d);assert(t.inBounds(p.x,p.z,45));const h=t.heightAt(p.x,p.z);if(w.terrain.lake){const l=w.terrain.lake;if(!l.frozen&&Math.hypot((p.x-l.position[0])/l.radius[0],(p.z-l.position[1])/l.radius[1])<1)assert(h>l.level+1,r.id+' submerged');}if(w.terrain.river){const a=w.terrain.river;if(Math.abs(p.x-a.x-Math.sin(p.z/a.wavelength)*a.amplitude)<a.width*.45)assert(h>a.level+1,r.id+' submerged');}}}});
 check(w.id+': trail grades avoid abrupt terrain walls',()=>{for(const r of w.routes){for(let d=1;d<routeLength(r);d+=2){const a=routePoint(r,d-1),b=routePoint(r,d+1),grade=Math.abs(t.heightAt(b.x,b.z)-t.heightAt(a.x,a.z))/2;assert(grade<.9,r.id+' excessive trail grade '+grade);}}});
 check(w.id+': gates match the terrain and ordered race routes',()=>{for(const race of w.races){const gates=t.gatesFor(race.id);assert(gates.length>3);const route=w.routes.find(r=>r.id===race.route);assert.deepEqual([gates[0].x,gates[0].z],route.points[0]);gates.forEach((g,i)=>{assert.equal(g.index,i);assert.equal(g.y,t.heightAt(g.x,g.z));assert(g.radius>=15);});}});
 check(w.id+': destinations and activities are reached by trails',()=>{for(const p of [...w.spots,...w.interactions,...w.spawnPads]){assert(t.inBounds(...p.position,40));assert((t.roadAt(...p.position)?.distance??Infinity)<100,p.id+' too far from a trail');}});
 check(w.id+': route network connects every destination to camp',()=>{const routes=w.routes,seen=new Set([0]);let changed=true;while(changed){changed=false;for(let i=0;i<routes.length;i++)if(!seen.has(i)){for(const j of seen){if(routes[i].points.some(p=>routes[j].points.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<100))){seen.add(i);changed=true;break;}}}}assert.equal(seen.size,routes.length);});
 check(w.id+': continuous tall cliff perimeter and mountain apron',()=>{
  for(let side=0;side<4;side++)for(let i=0;i<=160;i++){
   const u=(i/160-.5),x=side===0?-w.size[0]/2:side===1?w.size[0]/2:u*w.size[0],z=side===2?-w.size[1]/2:side===3?w.size[1]/2:u*w.size[1];
   assert(t.cliffRise(x,z)>w.boundary.cliffHeight*.8);
   const x2=x*(1+500/(w.size[0]/2)),z2=z*(1+500/(w.size[1]/2));assert(Number.isFinite(t.heightAt(x2,z2)));assert(t.cliffRise(x2,z2)>500);
  }
  if(w.terrain.lake?.frozen)assert(Math.abs(t.heightAt(...w.terrain.lake.position)-w.terrain.lake.level)<.01);
 });
 check(w.id+': actual bike rides the world ground and respawns off the buildings',()=>{
  const track=C.groundTrack(t,w.spawnPads[0]),bike=C.newBike(track),start=[bike.px,bike.pz];
  for(let i=0;i<360;i++)C.step(track,bike,{gas:.6,lean:.1});
  assert(!bike.crashed);assert(Math.hypot(bike.px-start[0],bike.pz-start[1])>10);assert.equal(bike.finished,null);
  C.respawn(track,bike);const pad=t.nearestSafePad(bike.px,bike.pz);assert(Math.hypot(bike.px-pad.position[0],bike.pz-pad.position[1])<.01);
 });
 check(w.id+': safe-pad lookup and outer boundary policy',()=>{assert(!t.inBounds(w.size[0],0));const pad=t.nearestSafePad(...w.spawn);assert.equal(pad.id,w.safePads[0].id);for(const pad of w.safePads){const h=t.heightAt(...pad.position);assert(Math.abs(t.heightAt(pad.position[0]+5,pad.position[1])-h)<.01);}});
}
console.log(checks+' checks passed.');
