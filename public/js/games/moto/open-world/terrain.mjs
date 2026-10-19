/** World-space terrain shared by a renderer and a future bike adapter. No DOM or THREE dependency.
 * Coordinates are metres; +Y is up, heading 0 is +Z. Rendering is never the collision authority.
 * Instantiate once, then sample heightAt(x,z), surfaceAt(x,z), normalAt(x,z).
 */
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = t => { t=clamp(t,0,1); return t*t*(3-2*t); };
function hash(x,z,seed) { let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295; }
function noise(x,z,seed) {
 const a=Math.floor(x), b=Math.floor(z), u=smooth(x-a), v=smooth(z-b);
 const p=hash(a,b,seed),q=hash(a+1,b,seed),r=hash(a,b+1,seed),s=hash(a+1,b+1,seed);
 return p+(q-p)*u+(r-p)*v+(p-q-r+s)*u*v;
}
export function routeLength(route) { let d=0; for(let i=1;i<route.points.length;i++) d+=Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]); return d; }
export function routePoint(route,distance) {
 const len=routeLength(route); let d=route.closed?((distance%len)+len)%len:clamp(distance,0,len);
 for(let i=1;i<route.points.length;i++) {
  const a=route.points[i-1], b=route.points[i], l=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(d<=l || i===route.points.length-1) { const t=clamp(d/l,0,1); return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],b[1]-a[1])}; } d-=l;
 }
}
export function buildTerrain(world) {
 const spec=world.terrain, cell=160, grid=new Map();
 function rawHeight(x,z) {
  let y=world.baseHeight;
  for(const [hx,hz,h,rx,rz] of spec.hills) y+=h*Math.exp(-(((x-hx)/rx)**2+((z-hz)/rz)**2)*1.8);
  y+=spec.noise*(noise(x/spec.scale,z/spec.scale,world.seed)-.5)*2;
  y+=spec.noise*.22*(noise(x/65,z/65,world.seed+51)-.5)*2;
  if(spec.river) { const r=spec.river, d=Math.abs(x-r.x-Math.sin(z/r.wavelength)*r.amplitude); y-=r.depth*Math.exp(-((d/r.width)**2)); }
  if(spec.lake) { const l=spec.lake, d=Math.hypot((x-l.position[0])/l.radius[0],(z-l.position[1])/l.radius[1]); y=y*(smooth((d-.7)/.55))+(l.frozen?l.level:l.level-l.depth)*(1-smooth((d-.7)/.55)); }
  return y;
 }
 function cliffRise(x,z) {
  const edge=Math.min(world.size[0]/2-Math.abs(x),world.size[1]/2-Math.abs(z));
  const width=world.boundary.cliffWidth||95, height=world.boundary.cliffHeight||680;
  const wall=smooth(1-edge/width);
  const strata=.84+.16*noise(x/90,z/90,world.seed+903);
  const peaks=110*noise(x/260,z/260,world.seed+111);
  return wall*(height*strata+peaks);
 }
 function dryHeight(x,z) {
  const raw=rawHeight(x,z),r=spec.river,l=spec.lake;
  if(r&&Math.abs(x-r.x-Math.sin(z/r.wavelength)*r.amplitude)<r.width*1.5)return Math.max(raw,r.level+7);
  if(l&&Math.hypot((x-l.position[0])/l.radius[0],(z-l.position[1])/l.radius[1])<1.3)return Math.max(raw,l.level+7);
  return raw;
 }
 function insert(item,minX,maxX,minZ,maxZ) { for(let x=Math.floor(minX/cell);x<=Math.floor(maxX/cell);x++) for(let z=Math.floor(minZ/cell);z<=Math.floor(maxZ/cell);z++) { const key=x+','+z; if(!grid.has(key)) grid.set(key,[]); grid.get(key).push(item); } }
 for(const route of world.routes) for(let i=1;i<route.points.length;i++) {
  const a=route.points[i-1],b=route.points[i], reach=route.width/2+route.shoulder;
  const item={a,b,width:route.width/2,shoulder:route.shoulder,dx:b[0]-a[0],dz:b[1]-a[1]};
  item.l2=item.dx**2+item.dz**2;
  insert(item,Math.min(a[0],b[0])-reach,Math.max(a[0],b[0])+reach,Math.min(a[1],b[1])-reach,Math.max(a[1],b[1])+reach);
 }
 function roadAt(x,z) {
  let nearest=null, min=Infinity, sum=0, total=0, blend=0;
  for(const seg of grid.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]) {
   const t=clamp(((x-seg.a[0])*seg.dx+(z-seg.a[1])*seg.dz)/seg.l2,0,1);
   const d=Math.hypot(x-seg.a[0]-seg.dx*t,z-seg.a[1]-seg.dz*t);
   const weight=1-smooth((d-seg.width)/seg.shoulder), influence=weight/(d*d+36);
   sum+=dryHeight(seg.a[0]+seg.dx*t,seg.a[1]+seg.dz*t)*influence; total+=influence; blend=Math.max(blend,weight);
   if(d<min) { min=d; nearest={distance:d,trail:d<seg.width,heading:Math.atan2(seg.dx,seg.dz)}; }
  } return nearest ? {...nearest,height:total?sum/total:0,weight:blend} : null;
 }
 const pads=world.safePads.map(p=>({...p,height:dryHeight(...p.position)}));
 function heightAt(x,z) {
  let y=rawHeight(x,z); const road=roadAt(x,z); if(road) y+=(road.height-y)*road.weight;
  for(const p of pads) { const d=Math.hypot(x-p.position[0],z-p.position[1]), weight=1-smooth((d-p.radius)/(p.radius*3)); if(weight>0)y+=(p.height-y)*weight; }
  for(const ramp of world.ramps) {
   const dx=x-ramp.position[0],dz=z-ramp.position[1], along=dx*Math.sin(ramp.heading)+dz*Math.cos(ramp.heading), across=dx*Math.cos(ramp.heading)-dz*Math.sin(ramp.heading);
   // Continuous tabletop: smooth takeoff, broad deck, smooth landing, shoulder falloff.
   const t=along/ramp.length+.5;
   if(t>0&&t<1&&Math.abs(across)<ramp.width) y+=ramp.height*smooth(t/.3)*(1-smooth((t-.6)/.4))*(1-smooth((Math.abs(across)-ramp.width*.5)/(ramp.width*.5)));
  }
  return y+cliffRise(x,z);
 }
 function surfaceAt(x,z) {
  for(const s of world.surfaceZones) if(Math.hypot(x-s.position[0],z-s.position[1])<s.radius) return {kind:s.surface,grip:s.grip,roll:s.roll};
  const road=roadAt(x,z); return {kind:road?.trail?'trail':world.theme==='desert'?'sand':world.theme==='snow'?'snow':'grass',grip:road?.trail ? .96 : .82,roll:road?.trail ? .01 : .02};
 }
 function normalAt(x,z,epsilon=.5) { const nx=heightAt(x-epsilon,z)-heightAt(x+epsilon,z),nz=heightAt(x,z-epsilon)-heightAt(x,z+epsilon),ny=2*epsilon,l=Math.hypot(nx,ny,nz); return {x:nx/l,y:ny/l,z:nz/l}; }
 function inBounds(x,z,margin=0) { return Math.abs(x)<=world.size[0]/2-margin&&Math.abs(z)<=world.size[1]/2-margin; }
 function nearestSafePad(x,z) { const pad=pads.reduce((a,b)=>Math.hypot(x-a.position[0],z-a.position[1])<Math.hypot(x-b.position[0],z-b.position[1])?a:b); return {...pad,position:pad.riderPosition||pad.position,heading:roadAt(...(pad.riderPosition||pad.position))?.heading ?? world.spawnHeading}; }
 function gatesFor(raceId,spacing=110) {
  const race=world.races.find(r=>r.id===raceId); if(!race) throw new Error('Unknown race: '+raceId);
  const route=world.routes.find(r=>r.id===race.route),len=routeLength(route),count=Math.ceil(len/spacing),gates=[];
  for(let i=0;i<=count;i++) { const p=routePoint(route,len*i/count); gates.push({...p,y:heightAt(p.x,p.z),radius:race.gateRadius,index:i}); }
  return gates;
 }
 return {world,rawHeight,cliffRise,heightAt,roadAt,surfaceAt,normalAt,inBounds,nearestSafePad,gatesFor};
}
