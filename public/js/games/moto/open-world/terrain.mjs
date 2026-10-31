/** World-space terrain shared by the renderer and the bike (core.js groundTrack). No DOM or THREE dependency.
 * Coordinates are metres; +Y is up, heading 0 is +Z. Rendering is never the collision authority.
 * Instantiate once, then sample heightAt(x,z), surfaceAt(x,z), normalAt(x,z).
 *
 * The height is built in layers:
 *  1. rawHeight: the authored hills, lake, river and cliff wall (the trails follow this, so races stay as authored)
 *  2. trails, safe pads and jumps are blended in
 *  3. theme landforms (mesas and dunes, forested ridges, alpine crags) are added only well away from
 *     trails, pads, buildings, jumps and water (the "wild" mask)
 *  4. mountain ranges rise around the edge of the world
 */
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = t => { t=clamp(t,0,1); return t*t*(3-2*t); };
function hash(x,z,seed) { let n=Math.imul(x,374761393)^Math.imul(z,668265263)^seed; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295; }
function noise(x,z,seed) {
 const a=Math.floor(x), b=Math.floor(z), u=smooth(x-a), v=smooth(z-b);
 const p=hash(a,b,seed),q=hash(a+1,b,seed),r=hash(a,b+1,seed),s=hash(a+1,b+1,seed);
 return p+(q-p)*u+(r-p)*v+(p-q-r+s)*u*v;
}
/** Sharp-crested noise for mountain ridges: 1 on the crests, 0 in the gullies. */
function ridged(x,z,seed,oct=3) { let s=0,a=.5,f=1,t=0; for(let i=0;i<oct;i++){ const n=1-Math.abs(noise(x*f,z*f,seed+i*17)*2-1); s+=a*n*n; t+=a; a*=.5; f*=2.03; } return s/t; }
function fbm(x,z,seed,oct=3) { let s=0,a=.5,f=1,t=0; for(let i=0;i<oct;i++){ s+=a*noise(x*f,z*f,seed+i*29); t+=a; a*=.5; f*=2.07; } return s/t; }
function rng(seed) { let s=seed>>>0; return () => { s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }
const segDist=(x,z,a,b)=>{ const dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,t=clamp(((x-a[0])*dx+(z-a[1])*dz)/l2,0,1); return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t); };

export function routeLength(route) { let d=0; for(let i=1;i<route.points.length;i++) d+=Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1]); return d; }
export function routePoint(route,distance) {
 const len=routeLength(route); let d=route.closed?((distance%len)+len)%len:clamp(distance,0,len);
 for(let i=1;i<route.points.length;i++) {
  const a=route.points[i-1], b=route.points[i], l=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(d<=l || i===route.points.length-1) { const t=clamp(d/l,0,1); return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],b[1]-a[1])}; } d-=l;
 }
}
export function buildTerrain(world) {
 const spec=world.terrain, cell=160, grid=new Map(), W=world.size[0], D=world.size[1], seed=world.seed, theme=world.theme;
 const lake=spec.lake, river=spec.river;
 const riverDist=(x,z)=>river?Math.abs(x-river.x-Math.sin(z/river.wavelength)*river.amplitude):Infinity;
 const lakeDist=(x,z)=>lake?Math.hypot((x-lake.position[0])/lake.radius[0],(z-lake.position[1])/lake.radius[1]):Infinity;
 // a scarp: a wall of cliff running east to west along z = scarp.z (waving by amplitude over wavelength), the high
 // ground to the north (smaller z); edge = how wide its face is (metres), scarpDist < 0 on the high side
 const scarp=spec.scarp, scarpDist=(x,z)=>z-scarp.z-Math.sin(x/scarp.wavelength)*scarp.amplitude+8*(noise(x/160,z/160,seed+61)-.5);
 function rawHeight(x,z) {
  let y=world.baseHeight;
  for(const [hx,hz,h,rx,rz] of spec.hills) y+=h*Math.exp(-(((x-hx)/rx)**2+((z-hz)/rz)**2)*1.8);
  y+=spec.noise*(noise(x/spec.scale,z/spec.scale,seed)-.5)*2;
  y+=spec.noise*.22*(noise(x/65,z/65,seed+51)-.5)*2;
  if(river) { const d=riverDist(x,z); y-=river.depth*Math.exp(-((d/river.width)**2)); }
  if(scarp) y+=scarp.height*(1-smooth((scarpDist(x,z)+scarp.edge/2)/scarp.edge));
  if(lake) { const d=lakeDist(x,z); y=y*(smooth((d-.7)/.55))+(lake.frozen?lake.level:lake.level-lake.depth)*(1-smooth((d-.7)/.55));
   // a real shore: the water is the lowest thing round it, so just outside the shoreline the ground is above it
   // (no riding along below the water's surface beside a lake); the rule fades out further away
   if(!lake.frozen&&d>.95&&d<1.6) y=Math.max(y,lake.level-.5+2.1*smooth((d-.95)/.15)-60*smooth((d-1.4)/.2)); }
  return y;
 }
 /** Mountain ranges round the edge: rideable foothills up to the edge of the world, then the real peaks rising
  * beyond it (where you can't ride, but can see), with ribs and gullies down their faces. */
 const B=world.boundary, rimWidth=B.cliffWidth||300, rimHeight=B.cliffHeight||520, rise=B.rise??1;   // (rise: how steeply the mountains beyond climb; under 1, gentler and further off)
 function cliffRise(x,z) {
  const edge=Math.min(W/2-Math.abs(x),D/2-Math.abs(z)), t=1-edge/rimWidth;
  if(t<=0) return 0;
  const crest=ridged(x/520,z/520,seed+111,4), ribs=ridged(x/150,z/150,seed+131,2), inside=Math.min(t,1), beyond=Math.max(0,t-1);
  let y=rimHeight*.3*Math.pow(smooth(inside),1.6)*(.7+.6*crest);
  y+=(beyond*rimWidth*(.8+.5*crest)*smooth(beyond*2)+rimHeight*.9*crest*crest*smooth(beyond*.9))*rise;
  y+=smooth(t*.9)*(28+40*smooth(beyond))*ribs+smooth(t*1.4)*12*fbm(x/60,z/60,seed+903);
  return y*(.2+.8*sampleMask(trailMask,x,z));   // (trails near the edge run up valleys instead of over the ridges)
 }
 function dryHeight(x,z) {
  const raw=rawHeight(x,z);
  if(river&&riverDist(x,z)<river.width*1.5)return Math.max(raw,river.level+7);
  if(lake&&lakeDist(x,z)<1.3)return Math.max(raw,lake.level+7);
  return raw;
 }
 function insert(g,item,minX,maxX,minZ,maxZ,size=cell) { for(let x=Math.floor(minX/size);x<=Math.floor(maxX/size);x++) for(let z=Math.floor(minZ/size);z<=Math.floor(maxZ/size);z++) { const key=x+','+z; if(!g.has(key)) g.set(key,[]); g.get(key).push(item); } }
 const segments=[];
 for(const route of world.routes) for(let i=1;i<route.points.length;i++) {
  const a=route.points[i-1],b=route.points[i], reach=route.width/2+route.shoulder;
  const item={a,b,width:route.width/2,shoulder:route.shoulder,dx:b[0]-a[0],dz:b[1]-a[1]};
  item.l2=item.dx**2+item.dz**2; segments.push(item);
  insert(grid,item,Math.min(a[0],b[0])-reach,Math.max(a[0],b[0])+reach,Math.min(a[1],b[1])-reach,Math.max(a[1],b[1])+reach);
 }
 function roadAt(x,z) {
  let nearest=null, min=Infinity, sum=0, total=0, blend=0;
  for(const seg of grid.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]) {
   const t=clamp(((x-seg.a[0])*seg.dx+(z-seg.a[1])*seg.dz)/seg.l2,0,1);
   const d=Math.hypot(x-seg.a[0]-seg.dx*t,z-seg.a[1]-seg.dz*t);
   const weight=1-smooth((d-seg.width)/seg.shoulder), influence=weight/(d*d+36);
   if(weight>0){ sum+=dryHeight(seg.a[0]+seg.dx*t,seg.a[1]+seg.dz*t)*influence; total+=influence; blend=Math.max(blend,weight); }
   if(d<min) { min=d; nearest={distance:d,trail:d<seg.width,heading:Math.atan2(seg.dx,seg.dz)}; }
  } return nearest ? {...nearest,height:total?sum/total:0,weight:blend} : null;
 }
 /** Distance to the nearest trail edge (any distance; slower than roadAt, used while building). */
 const routeDist=(x,z)=>{ let m=Infinity; for(const s of segments) m=Math.min(m,segDist(x,z,s.a,s.b)-s.width); return m; };
 const pads=world.safePads.map(p=>({...p,height:dryHeight(...p.position)}));

 // ---------------------------------------------------------------- jumps
 // Authored ramps, small tabletops along the trails and a "send it" jump park beside the camp.
 const ramps=world.ramps.map(r=>({...r,kind:r.kind||'table',park:false}));
 const nearThings=(x,z,r)=>world.spots.some(s=>Math.hypot(x-s.position[0],z-s.position[1])<r)||pads.some(p=>Math.hypot(x-p.position[0],z-p.position[1])<r)||ramps.some(q=>Math.hypot(x-q.position[0],z-q.position[1])<q.length/2+r*.5);
 const wet=(x,z,margin=0)=>lakeDist(x,z)<1.35+margin/200||riverDist(x,z)<(river?river.width*1.6+margin:0);
 for(const route of world.routes) {
  const len=routeLength(route);
  for(let d=150;d<len-150;d+=320) {
   const p=routePoint(route,d),q=routePoint(route,d+40),o=routePoint(route,d-40);
   if(Math.abs(Math.atan2(Math.sin(q.heading-o.heading),Math.cos(q.heading-o.heading)))>.25)continue;   // (only on straights)
   if(nearThings(p.x,p.z,110)||wet(p.x,p.z,40)||!inBounds(p.x,p.z,rimWidth*.7))continue;
   if(Math.abs(dryHeight(q.x,q.z)-dryHeight(o.x,o.z))/80>.1)continue;   // (not on steep climbs)
   ramps.push({id:route.id+'-table-'+ramps.length,position:[p.x,p.z],heading:p.heading,length:34,width:route.width+6,height:2.6+hash(Math.round(p.x),Math.round(p.z),seed)*1.4,kind:'table',park:false});
  }
 }
 const parks=[];
 for(const pad of world.sea?[]:[pads[0],pads[Math.min(pads.length-1,2)]]) {   // (none on a sea: they'd be under the water)
  const [px,pz]=pad.position,toward=Math.atan2(-px,-pz);
  for(const k of [0,1,-1,2,-2,3,-3,4,-4,5,-5,6,-6]) {
   const h=toward+k*.32,sx=Math.sin(h),sz=Math.cos(h),line=[];
   let d=170,ok=true;
   for(const [height,length] of [[3,38],[4.5,46],[6,56],[8,66],[10,80]]) {
    const x=px+sx*(d+length/2),z=pz+sz*(d+length/2);
    for(let e=-length/2-20;e<=length/2+20&&ok;e+=12)for(const side of [-14,0,14]){const ex=x+sx*e+sz*side,ez=z+sz*e-sx*side;if(!inBounds(ex,ez,rimWidth+60)||routeDist(ex,ez)<34||wet(ex,ez,60)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<70)){ok=false;break;}}
    if(!ok)break;
    line.push({position:[x,z],heading:h,length,width:20,height,kind:'table',park:true});
    d+=length+55;
   }
   if(ok&&line.length===5){ line.forEach((r,i)=>ramps.push({...r,id:'park-'+parks.length+'-'+i})); parks.push({pad:pad.id,start:[px+sx*150,pz+sz*150],heading:h,ramps:line}); break; }
  }
 }
 // ---------------------------------------------------------------- gauntlets: a steep run through the trees
 // A corridor (from -> to, width wide, with a fringe of trees either side) packed with trees you crash into (their
 // trunks: gap = the closest two trunks get), rocks and stumps you crash into unless you jump them, fallen logs and
 // small kickers down the middle. All of it is solid (obstacleAt) and drawn by the renderer exactly here (k picks
 // which model).
 const gauntlets=[];
 for(const gs of world.gauntlets||[]) {
  const r=rng(seed*7+gauntlets.length*131+17),[ax,az]=gs.from,[bx,bz]=gs.to,L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L,half=gs.width/2,fringe=gs.fringe??18,gap=gs.gap??8.5;
  const at=(along,across)=>[ax+ux*along+uz*across,az+uz*along-ux*across];
  const g={id:gs.id,from:gs.from,to:gs.to,ux,uz,L,half,fringe,trees:[],rocks:[],stumps:[],logs:[],ferns:gs.ferns||0,bushes:gs.bushes||0,branches:gs.branches||0,lanterns:gs.lanterns||0};   // (ferns, bushes, branches and lanterns: only drawn, nothing to crash into)
  for(let k=0;k<(gs.jumps||0);k++){ const [x,z]=at(L*(k+1)/(gs.jumps+1)+(r()-.5)*18,(r()-.5)*half*.9); ramps.push({id:gs.id+'-kick-'+k,position:[x,z],heading:Math.atan2(ux,uz),length:11,width:8,height:1.1+r()*.7,kind:'table',park:false,gauntlet:true}); }
  const onJump=(x,z,m)=>ramps.some(q=>q.gauntlet&&Math.hypot(x-q.position[0],z-q.position[1])<q.length/2+m);
  const all=()=>[...g.trees,...g.rocks,...g.stumps,...g.logs.flatMap(l=>l.parts)];
  const free=(x,z,d)=>!all().some(t=>Math.hypot(t.x-x,t.z-z)<d+(t.r||0)*.5);
  const clearStart=(along,across)=>along<30&&Math.abs(across)<10;   // (room to start)
  const ok=(x,z,m)=>routeDist(x,z)>=m&&!onJump(x,z,m)&&!pads.some(p=>p.radius<20?Math.hypot(x-p.position[0],z-p.position[1])<p.radius+4:Math.hypot(x-p.position[0],z-p.position[1])<40);
  for(let tries=0;g.trees.length<(gs.trees||0)&&tries<gs.trees*40;tries++) {
   const along=r()*L,across=(r()*2-1)*(half+fringe),[x,z]=at(along,across);
   if(clearStart(along,across)||!ok(x,z,6)||!free(x,z,gap))continue;
   const sc=.75+r()*.4,aspen=gs.aspens&&r()<gs.aspens;   // (aspens: "aspens" is their share; slimmer trunks)
   g.trees.push({x,z,s:sc,r:(aspen?.22:.42)*sc,tall:16,rot:r()*6.28,k:Math.floor(r()*3),...(aspen?{sp:'aspen'}:{})});   // (r: the trunk)
  }
  for(let tries=0;g.rocks.length<(gs.rocks||0)&&tries<gs.rocks*40;tries++) {
   const along=30+r()*(L-30),across=(r()*2-1)*(half+fringe*.5),[x,z]=at(along,across);
   if(!ok(x,z,5)||!free(x,z,3.5))continue;
   const sc=.6+r()*.6; g.rocks.push({x,z,s:sc,r:1.15*sc,tall:.95*sc,rot:r()*6.28,k:Math.floor(r()*13)});
  }
  for(let tries=0;g.stumps.length<(gs.stumps||0)&&tries<gs.stumps*40;tries++) {
   const along=30+r()*(L-30),across=(r()*2-1)*(half+fringe),[x,z]=at(along,across);
   if(!ok(x,z,4)||!free(x,z,3))continue;
   const sc=.8+r()*.4; g.stumps.push({x,z,s:sc,r:.55*sc,tall:.55*sc,rot:r()*6.28});
  }
  for(let tries=0;g.logs.length<(gs.logs||0)&&tries<gs.logs*40;tries++) {
   const along=40+r()*(L-50),across=(r()*2-1)*(half+fringe),[x,z]=at(along,across),rot=r()*6.28,sc=.9+r()*.5,c=Math.cos(rot),s=Math.sin(rot);
   const parts=[-1.1,-.37,.37,1.1].map(d=>({x:x+c*d*sc,z:z-s*d*sc,r:.4*sc,tall:.35*sc}));
   if(!parts.every(p=>ok(p.x,p.z,4)&&free(p.x,p.z,2.2)))continue;
   g.logs.push({x,z,s:sc,rot,parts});
  }
  gauntlets.push(g);
 }
 /** Whether (x, z) is in a gauntlet's corridor or its fringe of trees (or within margin of them). */
 const gauntletIn=(x,z,margin=0)=>gauntlets.some(g=>{ const dx=x-g.from[0],dz=z-g.from[1],along=dx*g.ux+dz*g.uz,across=Math.abs(dx*g.uz-dz*g.ux); return along>-margin&&along<g.L+margin&&across<g.half+g.fringe+margin; });

 // ---------------------------------------------------------------- gap jumps, pools and boost pads
 // A gap jump: a run-in, a kicker, a pit (lava, water, a freezing crevasse or a bottomless chasm) and a landing
 // ramp on the far side. Fall in and you crash (and get another go from the run-in). Each one is placed near its
 // anchor (beside a trail) on the nearest clear, flattish ground. Pools are open lava, tar or water.
 const F=world.features||{}, features=[], gaps=[], pools=[], boosts=[];
 const anchorOf=a=>{ if(a.near)return a.near; const route=world.routes.find(r=>r.id===a.route),p=routePoint(route,routeLength(route)*a.at),side=a.side||1; return [p.x+Math.cos(p.heading)*80*side,p.z-Math.sin(p.heading)*80*side]; };
 const headingNear=(x,z)=>{ let best=null,min=Infinity; for(const s of segments){ const d=segDist(x,z,s.a,s.b); if(d<min){min=d;best=Math.atan2(s.dx,s.dz);} } return best??0; };
 const GAP={lava:{depth:7,fluid:2.2},water:{depth:7,fluid:1.8},ice:{depth:9,fluid:2.6},chasm:{depth:30,fluid:9}};
 const clearOfFeatures=(x,z,r)=>!features.some(f=>Math.hypot(x-f.cx,z-f.cz)<f.reach+r)&&!ramps.some(q=>Math.hypot(x-q.position[0],z-q.position[1])<q.length/2+r);
 for(const g of F.gaps||[]) {
  const kind=GAP[g.kind]?g.kind:'lava',G=g.gap||28,H=g.height||3.2,W=g.width||24,run=g.run||110,K=H*4.8,deck=6,L=82,end=G+deck+L,[ax,az]=anchorOf(g),along0=headingNear(ax,az);
  let placed=null;
  // (it may run gently up or down hill: the ground is fitted with a straight slope along the jump)
  search: for(let d=0;d<=540;d+=30) for(let k=0;k<(d?16:1);k++) for(const turn of [0,Math.PI,.4,-.4,Math.PI+.4,Math.PI-.4]) {
   const h=along0+turn,sx=Math.sin(h),sz=Math.cos(h),cx=ax+Math.cos(k*.3927)*d,cz=az+Math.sin(k*.3927)*d;
   // (cx, cz) is the middle of the footprint; the lip is (end - run) / 2 before it
   const mid=(end-run)/2,lx=cx-sx*mid,lz=cz-sz*mid,pts=[];let ok=true;
   for(let e=-run-12;e<=end+12&&ok;e+=8) for(const side of [-W/2-8,0,W/2+8]) {
    const ex=lx+sx*e+sz*side,ez=lz+sz*e-sx*side;
    if(!inBounds(ex,ez,rimWidth+70)||routeDist(ex,ez)<42||wet(ex,ez,70)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<95)||pads.some(p=>Math.hypot(ex-p.position[0],ez-p.position[1])<110)||!clearOfFeatures(ex,ez,30)||gauntletIn(ex,ez,30)){ok=false;break;}
    pts.push([e,rawHeight(ex,ez)]);
   }
   if(!ok)continue;
   const n=pts.length,me=pts.reduce((a,p)=>a+p[0],0)/n,my=pts.reduce((a,p)=>a+p[1],0)/n,tilt=pts.reduce((a,p)=>a+(p[0]-me)*(p[1]-my),0)/pts.reduce((a,p)=>a+(p[0]-me)**2,0),base=my-tilt*me;
   if(Math.abs(tilt)<.1&&pts.every(p=>Math.abs(p[1]-base-tilt*p[0])<7)){ placed={lx,lz,h,sx,sz,base,tilt,cx,cz}; break search; }
  }
  if(!placed) continue;
  const spec=GAP[kind],gap={id:g.id,kind,x:placed.lx,z:placed.lz,heading:placed.h,s:placed.sx,c:placed.sz,base:placed.base,tilt:placed.tilt,gap:G,height:H,width:W,run,K,deck,L,end,land:H*.8,depth:spec.depth,
   level:placed.base+placed.tilt*G/2-spec.fluid,cx:placed.cx,cz:placed.cz,reach:Math.hypot((end+run)/2,W/2)+24,
   retry:{position:[placed.lx-placed.sx*(run-6),placed.lz-placed.sz*(run-6)],heading:placed.h}};
  gaps.push(gap);features.push(gap);
 }
 for(const p of F.pools||[]) {
  const [rx,rz]=p.radius,turn=p.turn||0,kind=p.kind||'lava',reach=Math.max(rx,rz);let spot=null;
  search: for(let d=0;d<=300;d+=25) for(let k=0;k<(d?12:1);k++) {
   const cx=p.position[0]+Math.cos(k*.5236)*d,cz=p.position[1]+Math.sin(k*.5236)*d;let lo=Infinity,hi=-Infinity,ok=inBounds(cx,cz,rimWidth+reach+40)&&clearOfFeatures(cx,cz,reach+20);
   for(let a=0;a<6.28&&ok;a+=.52) for(const f of [0,.6,1.25]) {
    const ex=cx+Math.cos(a)*rx*f*1.2,ez=cz+Math.sin(a)*rz*f*1.2;
    if(routeDist(ex,ez)<(p.trail??30)||wet(ex,ez,40)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<80)||pads.some(q=>Math.hypot(ex-q.position[0],ez-q.position[1])<90)||gauntletIn(ex,ez,30)){ok=false;break;}
    const y=rawHeight(ex,ez);lo=Math.min(lo,y);hi=Math.max(hi,y);
   }
   if(ok&&hi-lo<14){ spot={cx,cz,base:(lo+hi)/2}; break search; }
  }
  if(!spot) continue;
  const depth=p.depth||5,pool={id:p.id,kind,pool:true,x:spot.cx,z:spot.cz,cx:spot.cx,cz:spot.cz,rx,rz,turn,c:Math.cos(turn),s:Math.sin(turn),base:spot.base,depth,level:spot.base-(kind==='lava'?1.4:1),reach:reach*1.7};
  pools.push(pool);features.push(pool);
 }
 // ---------------------------------------------------------------- parks
 // A halfpipe and a rail garden (Carvvd), a pump track and a line of dirt jumps (Unrevvd), a hill climb and a freestyle
 // arena (Revvd). Each is shaped into the ground on the nearest clear ground to its anchor (a halfpipe on a slope, so a
 // board keeps its speed; the rest on the level): local "along" (a) and "across" (c) metres from its start. Rails and
 // boxes are solid only to ride on (railAt): the renderer draws them, the ground under them stays as it is.
 const PARK={
  halfpipe:{len:130,half:23,run:26,tail:24,tilt:[.07,.3],dev:6},
  rails:{len:64,half:16,run:18,tail:14,tilt:[.04,.18],dev:5},
  pump:{len:76,half:26,run:4,tail:4,tilt:[0,.06],dev:6},
  jumps:{len:96,half:10,run:34,tail:24,tilt:[0,.08],dev:5},
  climb:{len:350,half:86,run:20,tail:10,tilt:[0,.08],dev:14},
  arena:{len:160,half:46,run:6,tail:6,tilt:[0,.04],dev:7},
 };
 const parks2=[];
 for(const p of F.parks||[]) {
  const K=PARK[p.kind]; if(!K) continue;
  const [ax,az]=anchorOf(p),along0=p.heading??headingNear(ax,az),a0=-K.run,a1=K.len+K.tail;
  let placed=null;
  search: for(let d=0;d<=600;d+=30) for(let k=0;k<(d?16:1);k++) for(const turn of [0,Math.PI,Math.PI/2,-Math.PI/2,.5,-.5,Math.PI+.5,Math.PI-.5]) {
   const h=along0+turn,sx=Math.sin(h),sz=Math.cos(h),cx=ax+Math.cos(k*.3927)*d,cz=az+Math.sin(k*.3927)*d;
   const mid=(a0+a1)/2,lx=cx-sx*mid,lz=cz-sz*mid,pts=[];let ok=true;
   for(let e=a0-10;e<=a1+10&&ok;e+=8) for(const side of [-K.half-8,-K.half/2,0,K.half/2,K.half+8]) {
    const ex=lx+sx*e+sz*side,ez=lz+sz*e-sx*side;
    if(!inBounds(ex,ez,rimWidth+70)||routeDist(ex,ez)<(p.trail??20)||wet(ex,ez,50)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<60)||pads.some(q=>Math.hypot(ex-q.position[0],ez-q.position[1])<(q.riderPosition?70:40))||!clearOfFeatures(ex,ez,24)||gauntletIn(ex,ez,30)){ok=false;break;}
    pts.push([e,rawHeight(ex,ez)]);
   }
   if(!ok)continue;
   const n=pts.length,me=pts.reduce((a,q)=>a+q[0],0)/n,my=pts.reduce((a,q)=>a+q[1],0)/n,tilt=pts.reduce((a,q)=>a+(q[0]-me)*(q[1]-my),0)/pts.reduce((a,q)=>a+(q[0]-me)**2,0),base=my-tilt*me;
   const down=p.kind==='halfpipe'||p.kind==='rails'?-tilt:Math.abs(tilt);   // (a halfpipe and a rail garden run downhill: a board has no pedals)
   if(down>=K.tilt[0]&&down<=K.tilt[1]&&pts.every(q=>Math.abs(q[1]-base-tilt*q[0])<K.dev)){ placed={lx,lz,h,sx,sz,base,tilt,cx,cz}; break search; }
  }
  if(!placed){ console.warn('park: no room for',p.id); continue; }
  const P0=placed,f={id:p.id,park:p.kind,name:p.name||p.kind,x:P0.lx,z:P0.lz,heading:P0.h,s:P0.sx,c:P0.sz,base:P0.base,tilt:P0.tilt,len:K.len,half:K.half,run:K.run,tail:K.tail,cx:P0.cx,cz:P0.cz,reach:Math.hypot((a1-a0)/2,K.half)+20};
  f.at=(a,c)=>[f.x+f.s*a+f.c*c,f.z+f.c*a-f.s*c];
  f.go=(a,c=0,turn=0)=>({position:f.at(a,c),heading:f.heading+turn});
  f.start=f.go(-K.run+6);
  if(p.kind==='rails') f.items=[{c:-8,a:6,len:10,h:.55,w:.9},{c:0,a:10,len:12,h:.75,w:.14,rail:true},{c:8,a:6,len:9,h:.55,w:.9},{c:-8,a:36,len:12,h:.75,w:.14,rail:true},{c:0,a:38,len:11,h:.6,w:.9},{c:8,a:36,len:14,h:.8,w:.14,rail:true}];
  if(p.kind==='pump') Object.assign(f,{c0:16,S:40,R:12,tw:4.4,laps:p.laps||3,start:f.go(16+3,12)});
  if(p.kind==='arena') Object.assign(f,{c0:34,S:90,R:24,tw:10,start:f.go(34+4,24)});
  if(f.c0!=null){ f.loopLen=2*f.S+2*Math.PI*f.R; f.loop=(x,z)=>{const dx=x-f.x,dz=z-f.z;return stadium(dx*f.s+dz*f.c,dx*f.c-dz*f.s,f);}; }   // (where you are round its loop)
  if(p.kind==='climb') Object.assign(f,{H:p.height||110,L:170,top:f.at(179,0),start:f.go(-10)});
  parks2.push(f);features.push(f);
 }
 /** The nearest point on a stadium-shaped loop (two straights S long, ends round centres c0 and c0 + S, radius R):
     t = metres round it (the top straight first, along +a), d = how far outside the line. */
 function stadium(a,c,f){
  const {c0,S,R}=f;
  if(a>=c0&&a<=c0+S) return c>=0?{t:a-c0,d:c-R,bend:false,u:(a-c0)/S}:{t:S+Math.PI*R+(c0+S-a),d:-c-R,bend:false,u:(c0+S-a)/S};
  const ox=a<c0?c0:c0+S,ang=Math.atan2(c,a-ox),r=Math.hypot(a-ox,c);
  if(a>c0+S) return {t:S+(Math.PI/2-ang)*R,d:r-R,bend:true,u:(Math.PI/2-ang)/Math.PI};
  const a2=ang<0?ang+2*Math.PI:ang; return {t:2*S+Math.PI*R+(3*Math.PI/2-a2)*R,d:r-R,bend:true,u:(3*Math.PI/2-a2)/Math.PI};   // (u: 0..1 along this straight or bend)
 }
 /** What a park does to the ground at its local (a, c): { dy, weight } (weight: packed, the look of a trail). */
 function parkShape(f,a,c){
  const ac=Math.abs(c);
  if(f.park==='halfpipe'){
   if(a<0) return {dy:8*Math.pow(-a/f.run,1.5)*(1-smooth((ac-5)/4)),weight:ac<6?1:0};   // (a steep drop-in at the top, for speed)
   if(a>f.len) return {dy:0,weight:ac<5?1:0};
   const fw=4.5,R=5,deck=3,k=smooth(a/14)*(1-smooth((a-f.len+14)/14));
   let h=ac<fw?0:ac<fw+R*.97?R-Math.sqrt(Math.max(0,R*R-(ac-fw)**2)):ac<fw+R+deck?R:Math.max(0,R-(ac-fw-R-deck)*.75);
   return {dy:h*k,weight:ac<fw+R+deck?1:0};
  }
  if(f.park==='rails'){
   let dy=0;
   for(const it of f.items){ const u=a-(it.a-4),across=Math.abs(c-it.c); if(u>0&&u<4&&across<(it.rail?1.1:1.4)) dy=Math.max(dy,(it.h-.04)*smooth(u/4)*(1-smooth((across-(it.rail?.6:.9))/.5))); }
   return {dy,weight:ac<12?1:0};
  }
  if(f.park==='jumps'){
   if(ac>6) return {dy:0,weight:0};
   const side=1-smooth((ac-3.5)/2.5);let dy=0;
   for(const j of [8,30,52,74]){ const u=a-j; if(u>0&&u<6) dy=1.9*Math.pow(u/6,1.6); else if(u>=11&&u<19) dy=1.9*(1-smooth((u-11)/8)); }
   return {dy:dy*side,weight:ac<5?1:0};
  }
  if(f.park==='climb'){
   const {H,L}=f,u=a/L;let h=a<0?0:a<L?H*(.25*u+.75*u*u):a<L+18?H:Math.max(0,H*(1-smooth((a-L-18)/160)));   // (steep from the start, and steeper: about 48° at the top)
   h=Math.max(0,h-Math.max(0,ac-8)*1.4);
   return {dy:h,weight:ac<8&&a>-20&&a<f.L+18?1:0};
  }
  if(f.park==='pump'||f.park==='arena'){
   const L=stadium(a,c,f),hw=f.tw/2,ad=Math.abs(L.d);let top=0;
   const ends=smooth(L.u/.3)*smooth((1-L.u)/.3);   // (the banking and the rollers fade in and out at each end, so they join up)
   if(f.park==='pump') top=L.bend?.35+clamp((L.d+hw)/f.tw,0,1)*2.2*ends:.35+.45*(1-Math.cos(L.u*f.S/7.5*Math.PI*2))/2*ends;
   else if(L.bend) top=.2+clamp((L.d+hw)/f.tw,0,1)*1.9*ends;
   else { const u=L.t<f.S?L.t:L.t-f.S-Math.PI*f.R; top=u>14&&u<26?3.6*Math.pow((u-14)/12,1.5):u>=44&&u<56?3.6*(1-smooth((u-44)/12)):0; }   // (a big double on each straight)
   return {dy:ad<hw?top:top*(1-smooth((ad-hw)/3)),weight:ad<hw+1?1:0};
  }
  return {dy:0,weight:0};
 }
 const featureGrid=new Map(); for(const f of features) insert(featureGrid,f,f.cx-f.reach,f.cx+f.reach,f.cz-f.reach,f.cz+f.reach);
 const FLAT={flat:0,base:0,dy:0,weight:0,hazard:null};
 /** What a gap jump or pool does to the ground at (x, z): flatten it towards base (flat 0..1), then add dy;
     weight = how much it looks like a dirt jump; hazard = the pit's fluid there ({kind, level, retry}) or null. */
 function featureAt(x,z) {
  const list=featureGrid.get(Math.floor(x/cell)+','+Math.floor(z/cell)); if(!list) return FLAT;
  for(const f of list) {
   if(f.park) {
    const dx=x-f.x,dz=z-f.z,a=dx*f.s+dz*f.c,c=dx*f.c-dz*f.s,out=Math.max(-f.run-a,a-f.len-f.tail,0),side=Math.max(0,Math.abs(c)-f.half);
    if(out>16||side>16) continue;
    const flat=(1-smooth(out/14))*(1-smooth(side/14)),sh=out>0||side>0?{dy:0,weight:0}:parkShape(f,a,c);
    return {flat,base:f.base+f.tilt*clamp(a,-f.run,f.len+f.tail),dy:sh.dy,weight:sh.weight,hazard:null};
   }
   if(f.pool) {
    const dx=x-f.x,dz=z-f.z,a=(dx*f.c-dz*f.s)/f.rx,b=(dx*f.s+dz*f.c)/f.rz,d=Math.hypot(a,b); if(d>1.7) continue;
    const wob=d*(1+.08*(noise(x/14,z/14,seed+401)-.5));
    let dy=-f.depth*(1-smooth((wob-.78)/.24));
    if(f.kind==='lava') dy+=1.1*Math.exp(-(((wob-1.07)/.09)**2));   // (a cooled crust round the edge)
    return {flat:1-smooth((d-1.15)/.5),base:f.base,dy,weight:0,hazard:wob<.9?{kind:f.kind,level:f.level,id:f.id}:null};
   }
   const dx=x-f.x,dz=z-f.z,along=dx*f.s+dz*f.c,across=Math.abs(dx*f.c-dz*f.s);
   const out=Math.max(-f.run-along,along-f.end,0); if(out>18||across>f.width/2+22) continue;
   const flat=(1-smooth((across-f.width/2-4)/16))*(1-smooth(out/16)),base=f.base+f.tilt*clamp(along,-f.run,f.end);
   const side=1-smooth((across-f.width/2+3)/3);
   let dy=0,weight=0,hazard=null;
   if(along>-f.K&&along<=0){ const t=(along+f.K)/f.K; dy=f.height*t*t*side; weight=side; }                               // the kicker
   else if(along>0&&along<f.gap){                                                                                          // the pit
    const near=smooth(along/1.6),far=smooth((along-f.gap+1.6)/1.6);   // (steep walls: down from the lip, up to the landing)
    dy=(f.height+(-f.depth-f.height)*near+(f.land+f.depth)*far)*side;
    if(across<f.width/2-1&&along>.4&&along<f.gap-.4) hazard={kind:f.kind,level:f.level,id:f.id,retry:f.retry};
   }
   else if(along>=f.gap&&along<f.gap+f.deck){ dy=f.land*side; weight=side; }                                              // the landing deck
   else if(along>=f.gap+f.deck&&along<f.end){ dy=f.land*(1-smooth((along-f.gap-f.deck)/f.L))*side; weight=side; }         // and its long downslope
   else if(along>-f.run&&along<=-f.K) weight=side*.85;                                                                   // the run-in track
   return {flat,base,dy,weight,hazard};
  }
  return FLAT;
 }
 // Boost pads: glowing strips on the straights of the trails that kick you forward.
 for(const route of world.routes) {
  const len=routeLength(route);
  for(let d=420;d<len-200;d+=720) {
   const p=routePoint(route,d),q=routePoint(route,d+30),o=routePoint(route,d-30);
   if(Math.abs(Math.atan2(Math.sin(q.heading-o.heading),Math.cos(q.heading-o.heading)))>.2||wet(p.x,p.z,30)||!inBounds(p.x,p.z,rimWidth*.7))continue;
   if(ramps.some(r=>Math.hypot(p.x-r.position[0],p.z-r.position[1])<r.length/2+40))continue;
   boosts.push({x:p.x,z:p.z,heading:p.heading,s:Math.sin(p.heading),c:Math.cos(p.heading),length:12,width:Math.min(8,route.width-2)});
  }
 }
 /** The boost pad under (x, z) (its heading, as sin s and cos c) or null. */
 function boostAt(x,z){ for(const p of boosts){ const dx=x-p.x,dz=z-p.z; if(Math.abs(dx)>10||Math.abs(dz)>10)continue; if(Math.abs(dx*p.s+dz*p.c)<p.length/2&&Math.abs(dx*p.c-dz*p.s)<p.width/2)return p; } return null; }

 const rampGrid=new Map();
 for(const r of ramps){ r.s=Math.sin(r.heading); r.c=Math.cos(r.heading); const reach=r.length/2+r.width; insert(rampGrid,r,r.position[0]-reach,r.position[0]+reach,r.position[1]-reach,r.position[1]+reach); }
 /** How much ramp is under (x, z): its height and a 0..1 "this is a dirt jump" weight. */
 function rampAt(x,z) {
  let y=0,weight=0;
  for(const ramp of rampGrid.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]) {
   const dx=x-ramp.position[0],dz=z-ramp.position[1], along=dx*ramp.s+dz*ramp.c, across=dx*ramp.c-dz*ramp.s;
   // Continuous tabletop: smooth takeoff, broad deck, smooth landing, shoulder falloff.
   const t=along/ramp.length+.5;
   if(t>0&&t<1&&Math.abs(across)<ramp.width) {
    const side=1-smooth((Math.abs(across)-ramp.width*.5)/(ramp.width*.5)), k=smooth(t/.3)*(1-smooth((t-.6)/.4));
    y+=ramp.height*k*side; weight=Math.max(weight,Math.min(1,k*3)*side);
   }
  }
  if(features.length) weight=Math.max(weight,featureAt(x,z).weight);
  return {y,weight};
 }

 // ---------------------------------------------------------------- the wild: where landforms may rise
 // A 10 m raster: 0 on and near trails, pads, buildings, jumps and water, 1 out in open country.
 const step=10, nx=Math.ceil(W/step)+1, nz=Math.ceil(D/step)+1, mask=new Float32Array(nx*nz), trailMask=new Float32Array(nx*nz);
 const wideGrid=new Map(), wideCell=200;
 for(const s of segments) insert(wideGrid,s,Math.min(s.a[0],s.b[0])-200,Math.max(s.a[0],s.b[0])+200,Math.min(s.a[1],s.b[1])-200,Math.max(s.a[1],s.b[1])+200,wideCell);
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const x=-W/2+i*step,z=-D/2+j*step;
  let m=1,dr=Infinity;
  for(const s of wideGrid.get(Math.floor(x/wideCell)+','+Math.floor(z/wideCell))||[]) dr=Math.min(dr,segDist(x,z,s.a,s.b)-s.width-s.shoulder);
  m=Math.min(m,smooth((dr-14)/90)); trailMask[j*nx+i]=m;
  for(const p of pads) m=Math.min(m,smooth((Math.hypot(x-p.position[0],z-p.position[1])-140)/110));
  for(const s of world.spots) m=Math.min(m,smooth((Math.hypot(x-s.position[0],z-s.position[1])-110)/90));
  if(m>0)for(const r of ramps) m=Math.min(m,smooth((Math.hypot(x-r.position[0],z-r.position[1])-r.length/2-24)/60));
  if(m>0)for(const f of features) m=Math.min(m,smooth((Math.hypot(x-f.cx,z-f.cz)-f.reach)/60));
  if(lake) m=Math.min(m,smooth((lakeDist(x,z)-1.35)/.55));
  if(river) m=Math.min(m,smooth((riverDist(x,z)-river.width*1.6)/120));
  if(m>0&&gauntletIn(x,z,60)) m=Math.min(m,gauntletIn(x,z,10)?0:.4);
  mask[j*nx+i]=m;
 }
 function sampleMask(m,x,z) {
  const gx=clamp((x+W/2)/step,0,nx-1.0001),gz=clamp((z+D/2)/step,0,nz-1.0001),i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j,k=j*nx+i;
  return m[k]*(1-u)*(1-v)+m[k+1]*u*(1-v)+m[k+nx]*(1-u)*v+m[k+nx+1]*u*v;
 }
 const wild=(x,z)=>sampleMask(mask,x,z);

 // ---------------------------------------------------------------- landforms for each theme
 const r=rng(seed*31+7), mesas=[], dunes=[];
 const centre=(min)=>{ for(let tries=0;tries<400;tries++){ const x=(r()-.5)*(W-2*rimWidth-200),z=(r()-.5)*(D-2*rimWidth-200); if(routeDist(x,z)>min&&!wet(x,z,min*.5)&&!nearThings(x,z,min+60))return [x,z]; } return null; };
 if(theme==='desert') {
  for(let i=0;i<11;i++){ const radius=70+r()*95,c=centre(radius+70); if(c)mesas.push({x:c[0],z:c[1],radius,height:38+r()*70,stretch:1+r()*.7,turn:r()*Math.PI,tiers:r()<.5?2:1}); }
  for(const z of world.surfaceZones.filter(s=>s.surface==='sand')) dunes.push({x:z.position[0],z:z.position[1],radius:z.radius*1.9,height:7.5});
  const extra=centre(160); if(extra)dunes.push({x:extra[0],z:extra[1],radius:330,height:9});
 } else if(theme==='snow') {
  for(let i=0;i<(spec.crags===false?0:7);i++){ const radius=60+r()*70,c=centre(radius+60); if(c)mesas.push({x:c[0],z:c[1],radius,height:30+r()*45,stretch:1+r()*.5,turn:r()*Math.PI,tiers:1,crag:true}); }   // ("crags": false: a smooth wooded hill)
 } else {
  for(let i=0;i<8;i++){ const radius=45+r()*60,c=centre(radius+60); if(c)mesas.push({x:c[0],z:c[1],radius,height:16+r()*26,stretch:1+r()*.6,turn:r()*Math.PI,tiers:1,crag:true}); }
 }
 const mesaGrid=new Map(); for(const m of mesas){ const reach=m.radius*m.stretch*1.6; insert(mesaGrid,m,m.x-reach,m.x+reach,m.z-reach,m.z+reach); }
 function landform(x,z) {
  let y=0;
  // rolling ground and low rises everywhere off the trails
  if(theme==='desert') y+=14*(fbm(x/300,z/300,seed+71)-.5)+2.2*(noise(x/70,z/70,seed+77)-.5);
  else if(theme==='snow') y+=26*(fbm(x/330,z/330,seed+71)-.5)+60*ridged(x/460,z/460,seed+79)*smooth((rawHeight(x,z)-world.baseHeight-120)/260);
  else y+=24*(fbm(x/260,z/260,seed+71)-.45)+5*(noise(x/80,z/80,seed+77)-.5);
  // mesas, buttes and crags: steep sides, flat (or broken) tops, a skirt of scree round the foot
  for(const m of mesaGrid.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]) {
   const dx=x-m.x,dz=z-m.z,c=Math.cos(m.turn),s=Math.sin(m.turn),a=(dx*c-dz*s)/m.stretch,b=dx*s+dz*c;
   let d=Math.hypot(a,b)/m.radius; if(d>1.6)continue;
   d*=1+.22*(fbm(x/60,z/60,seed+5)-.5);
   const cliff=1-smooth((d-.84)/.16), scree=.22*(1-smooth((d-1)/.5));
   let h=m.height*Math.max(cliff*(m.tiers>1?(.6+.4*(1-smooth((d-.5)/.1))):1),scree);
   if(m.crag) h*=.75+.5*ridged(x/45,z/45,seed+13);
   y+=h;
  }
  // dune fields: long gentle windward slopes and steep slip faces
  for(const f of dunes) {
   const reach=1-smooth((Math.hypot(x-f.x,z-f.z)-f.radius*.55)/(f.radius*.45)); if(reach<=0)continue;
   const u=(x*.8+z*.6)/115+.35*fbm(x/180,z/180,seed+21), s=u-Math.floor(u);
   const shape=s<.72?smooth(s/.72):1-smooth((s-.72)/.28);
   y+=f.height*reach*shape*(.6+.6*noise(x/240,z/240,seed+23));
  }
  // powder moguls
  for(const zone of world.surfaceZones) if(zone.surface==='powder') { const k=1-smooth((Math.hypot(x-zone.position[0],z-zone.position[1])-zone.radius*.6)/(zone.radius*.4)); if(k>0)y+=1.6*k*Math.sin(x/7)*Math.sin(z/7.5); }
  return y;
 }

 // ---------------------------------------------------------------- where the buildings and start arches stand
 // (here rather than in the renderer, because the solid ones are obstacles for the bike)
 const nearestTrail=(x,z)=>{let best={d:Infinity};for(const r of world.routes){const len=routeLength(r);for(let d=0;d<=len;d+=6){const p=routePoint(r,d),dd=Math.hypot(p.x-x,p.z-z);if(dd<best.d)best={d:dd,x:p.x,z:p.z,width:r.width};}}return best;};
 const blocked=(x,z,r)=>{const road=roadAt(x,z);return (road&&road.distance<10+r)||rampAt(x,z).weight>0||pads.some(p=>p.riderPosition&&Math.hypot(x-p.riderPosition[0],z-p.riderPosition[1])<r+7);};
 const FOOT={cabin:[9,6.2,9],tower:[6,4.6,23],camp:[16],yard:[16],ruin:[11],dock:[7],checkpoint:[9],lookout:[7,5.2,3]};   // [clear radius, solid radius, solid height]
 const buildings=world.buildings===false?[]:world.spots.map(spot=>{   // (a world can have none: the forest chute)
  // the nearest clear ground beside the trails for the whole place, facing the nearest trail
  const [R,solid,tall]=FOOT[spot.kind]||FOOT.lookout,fits=(x,z)=>!blocked(x,z,R*.5)&&[0,1,2,3,4,5,6,7].every(k=>!blocked(x+Math.cos(k*.785)*R*.8,z+Math.sin(k*.785)*R*.8,1));
  let [x,z]=spot.position;
  search: for(let d=0;d<=84;d+=12)for(let k=0;k<(d?16:1);k++){const cx=spot.position[0]+Math.cos(k*.3927)*d,cz=spot.position[1]+Math.sin(k*.3927)*d;if(inBounds(cx,cz,200)&&lakeDist(cx,cz)>1.15&&fits(cx,cz)){x=cx;z=cz;break search;}}
  const trail=nearestTrail(x,z);let ax=x-trail.x,az=z-trail.z;const al=Math.hypot(ax,az);
  if(al<1){ax=1;az=0;}else{ax/=al;az/=al;}
  return {spot,x,z,ry:Math.atan2(-ax,-az),trail,away:[ax,az],solid:solid||0,tall:tall||0,clear:(lx,lz,r)=>{const c=Math.cos(Math.atan2(-ax,-az)),s=Math.sin(Math.atan2(-ax,-az));return !blocked(x+lx*c+lz*s,z-lx*s+lz*c,r);}};
 });
 const arches=[];
 for(const race of world.races){
  const route=world.routes.find(r=>r.id===race.route),p=routePoint(route,0);
  const shared=world.races.filter(o=>{const q=routePoint(world.routes.find(r=>r.id===o.route),0);return Math.hypot(q.x-p.x,q.z-p.z)<30;});
  if(arches.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<30))continue;   // (races that start together share one arch)
  arches.push({x:p.x,z:p.z,heading:p.heading,width:route.width+7,label:shared.length>1?'Mini races start':race.name});
 }
 const obstacles=[];
 for(const b of buildings)if(b.solid)obstacles.push({x:b.x,z:b.z,r:b.solid,tall:b.tall});
 for(const a of arches)for(const side of [-1,1])obstacles.push({x:a.x+Math.cos(a.heading)*a.width/2*side,z:a.z-Math.sin(a.heading)*a.width/2*side,r:1.1,tall:10});
 // ---------------------------------------------------------------- a ski run's forest: real trees either side
 // features.forest: { clear (metres past the run's edge before the first trees), loose: [depth, spacing] (a thin
 // fringe you can weave through), dense: [depth, spacing] (a wall of them), outer: spacing (the rest of the hillside
 // out to the mountains, with a few clearings), cuts: [[x, z, radius]] (clearings: the top, the lodge) }. The
 // chairlifts' lines are cut through. Every tree is solid, and drawn exactly here (nature.mjs forestScenery).
 const forestTrees=[],FS=world.features?.forest;
 const forestReach=FS?(FS.clear??3)+FS.loose[0]+FS.dense[0]:0;
 if(FS){
  const r=rng(seed*11+5),lines=(world.features.lifts||[]).map(L=>[L.from,L.to]),c0=FS.clear??3;
  const bands=[[FS.loose[1],c0,c0+FS.loose[0],.7],[FS.dense[1],c0+FS.loose[0],forestReach,.92]];if(FS.outer)bands.push([FS.outer,forestReach,Infinity,.88]);
  for(const [gap,lo,hi,fill] of bands)   // (scattered on a grid, each one somewhere in its square)
   for(let gx=-W/2;gx<W/2;gx+=gap)for(let gz=-D/2;gz<D/2;gz+=gap){
    const keep=r()<fill,x=gx+r()*gap,z=gz+r()*gap,sc=.8+r()*.55,rot=r()*6.28,k=Math.floor(r()*3);
    if(!keep||cliffRise(x,z)>30)continue;
    const d=routeDist(x,z);if(d<lo||d>=hi)continue;
    if(hi===Infinity&&noise(x/110,z/110,seed+71)<.3)continue;   // (the odd clearing out in the woods)
    if(lines.some(([a,b])=>segDist(x,z,a,b)<9||Math.hypot(x-a[0],z-a[1])<26||Math.hypot(x-b[0],z-b[1])<26))continue;   // (the line, and room round each station to get on and off)
    if((FS.cuts||[]).some(([cx,cz,cr])=>Math.hypot(x-cx,z-cz)<cr))continue;
    forestTrees.push({x,z,s:sc,r:.42*sc,tall:16,rot,k});
   }
 }
 /** The nearest point on any trail's middle line to (x, z): { x, z, heading (along the trail), distance (past its
     edge), half (its half-width) }. */
 function trailNearest(x,z){
  let best=null;
  for(const s of segments){const t=clamp(((x-s.a[0])*s.dx+(z-s.a[1])*s.dz)/s.l2,0,1),px=s.a[0]+s.dx*t,pz=s.a[1]+s.dz*t,d=Math.hypot(x-px,z-pz)-s.width;if(!best||d<best.distance)best={x:px,z:pz,heading:Math.atan2(s.dx,s.dz),distance:d,half:s.width};}
  return best;
 }
 const solidGrid=new Map(); for(const g of gauntlets) for(const o of [...g.trees,...g.rocks,...g.stumps,...g.logs.flatMap(l=>l.parts)]) insert(solidGrid,o,o.x-o.r,o.x+o.r,o.z-o.r,o.z+o.r,20);
 for(const o of forestTrees) insert(solidGrid,o,o.x-o.r,o.x+o.r,o.z-o.r,o.z+o.r,20);
 /** A solid thing the bike can't ride through at (x, z): { x, z, r, top } or null (a building, an arch post, or a
     gauntlet's tree, rock, stump or log: jump high enough and you clear the low ones). */
 function obstacleAt(x,z){
  for(const o of obstacles){ if(Math.abs(x-o.x)<o.r&&Math.abs(z-o.z)<o.r&&Math.hypot(x-o.x,z-o.z)<o.r) return {...o,top:(o.top??=heightAt(o.x,o.z)+o.tall)}; }
  if(solidGrid.size) for(const o of solidGrid.get(Math.floor(x/20)+','+Math.floor(z/20))||[]) if(Math.hypot(x-o.x,z-o.z)<o.r) return {...o,top:(o.top??=heightAt(o.x,o.z)+o.tall)};
  return null;
 }
 /** More solid things ({ x, z, r, tall }): a resort's forest, from the renderer once it has placed the trees. */
 function addSolids(list){ for(const o of list) insert(solidGrid,o,o.x-o.r,o.x+o.r,o.z-o.r,o.z+o.r,20); }
 /** The solid things (trees, rocks, stumps, logs) whose middles are within range metres of (x, z). */
 function obstaclesNear(x,z,range){
  const out=[];if(!solidGrid.size)return out;const seen=new Set();
  for(let gx=Math.floor((x-range)/20);gx<=Math.floor((x+range)/20);gx++)for(let gz=Math.floor((z-range)/20);gz<=Math.floor((z+range)/20);gz++)
   for(const o of solidGrid.get(gx+','+gz)||[])if(!seen.has(o)&&Math.hypot(x-o.x,z-o.z)<range){seen.add(o);out.push(o);}
  return out;
 }

 /** Water's edge: the ground right next to a lake or river is never lower than its water (or you could ride along
     beneath the surface, and see the water's edge hanging in the air). Lava, deep in its crater or channel, too. */
 function shore(x,z,y) {
  if(lake&&!lake.frozen){ const d=lakeDist(x,z); if(d>.95&&d<1.75) y=Math.max(y,lake.level-.5+2.1*smooth((d-.95)/.15)-60*smooth((d-1.5)/.25)); }
  if(river){ const d=riverDist(x,z),w=river.width; if(d>w*.42&&d<w*1.6) y=Math.max(y,river.level-.5+2.1*smooth((d-w*.42)/(w*.12))-60*smooth((d-w*1.3)/(w*.3))); }
  return y;
 }
 /** The ground itself (under the sea, the seabed). */
 function landAt(x,z) {
  let y=rawHeight(x,z); const road=roadAt(x,z); if(road) y+=(road.height-y)*road.weight;
  for(const p of pads) { const d=Math.hypot(x-p.position[0],z-p.position[1]), weight=1-smooth((d-p.radius)/(p.radius*3)); if(weight>0)y+=(p.height-y)*weight; }
  y+=rampAt(x,z).y;
  if(features.length){ const f=featureAt(x,z); if(f.flat>0) y+=(f.base-y)*f.flat+f.dy; }
  const w=wild(x,z); if(w>0) y+=landform(x,z)*w;
  return shore(x,z,y+cliffRise(x,z));
 }
 // ---------------------------------------------------------------- the sea ("sea": { level, waves, swell })
 // A sea world is water up to level: the ground under it is the seabed (bedAt), heightAt is the calm surface (where
 // things float and riders are put back), and rideAt follows the waves. The waves are Gerstner waves (water moving in
 // little circles, so the crests are sharp and the troughs wide), each [wavelength m, height m, direction °]; they die
 // down over the last few metres to a beach, and swell: [z from, z to, times] makes them bigger out to sea. The same
 // sums are worked out on the graphics card for the water you see (ocean.mjs), from the same clock (waveTime: the
 // wall clock, so everyone's waves match).
 const sea=world.sea||null;
 const WAVES=(sea?.waves||[]).map(([L,A,deg])=>{const k=2*Math.PI/L,a=deg*Math.PI/180;return {k,A,dx:Math.cos(a),dz:Math.sin(a),w:Math.sqrt(9.81*k)};});
 const steep=sea?.steep??.75;for(const w of WAVES)w.Q=steep/(w.k*w.A*Math.max(1,WAVES.length));
 const waveTime=()=>(Date.now()%1e7)/1000;
 /** How big the waves are at (x, z) (0..swell): calm in the shallows, bigger out to sea. */
 function waveScale(x,z,bed=landAt(x,z)){
  const depth=sea.level-bed,sw=sea.swell;
  return smooth((depth-.3)/3.2)*(sw?1+(sw[2]-1)*smooth((z-sw[0])/(sw[1]-sw[0])):1);
 }
 /** The sea's surface height at (x, z) at time t (the point of the moving water that's over (x, z) now). */
 function waveAt(x,z,t=waveTime()){
  if(!WAVES.length) return sea.level;
  const bed=landAt(x,z),f=waveScale(x,z,bed);if(f<=0) return sea.level;
  let qx=x,qz=z;
  for(let it=0;it<3;it++){let ox=0,oz=0;for(const w of WAVES){const c=Math.cos(w.k*(w.dx*qx+w.dz*qz)-w.w*t)*w.Q*w.A*f;ox+=w.dx*c;oz+=w.dz*c;}qx=x-ox;qz=z-oz;}
  let y=0;for(const w of WAVES)y+=w.A*Math.sin(w.k*(w.dx*qx+w.dz*qz)-w.w*t);
  return sea.level+y*f;
 }
 /** heightAt: the ground, or the calm sea over it. */
 function heightAt(x,z){ const y=landAt(x,z); return sea&&y<sea.level?sea.level:y; }
 /** A rail or box under (x, z) to ride on: { y: its top, item, park } or null. */
 const railParks=parks2.filter(f=>f.park==='rails');
 function railAt(x,z){
  for(const f of railParks){
   const dx=x-f.x,dz=z-f.z,a=dx*f.s+dz*f.c; if(a<-5||a>f.len+5) continue;
   const c=dx*f.c-dz*f.s;
   for(const it of f.items) if(a>=it.a&&a<=it.a+it.len&&Math.abs(c-it.c)<(it.rail?.32:it.w/2+.08)) return {y:f.base+f.tilt*a+it.h,item:it,park:f,a,c};
  }
  return null;
 }
 /** The height you ride on: the ground, or the top of a rail or box. */
 function rideAt(x,z){
  if(sea){ const y=landAt(x,z); return y<sea.level+2?Math.max(y,waveAt(x,z)):y; }   // (on the sea: the waves)
  const y=heightAt(x,z); if(!railParks.length) return y; const r=railAt(x,z); return r&&r.y>y?r.y:y;
 }
 function surfaceAt(x,z) {
  if(sea) return landAt(x,z)<sea.level-.12?{kind:'water',grip:.62,roll:.004}:{kind:'sand',grip:.55,roll:.24};   // (run aground and you grind to a stop)
  if(features.length&&featureAt(x,z).weight>.5) return {kind:'trail',grip:.96,roll:.01};   // (gap jumps are packed dirt, whatever's round them)
  for(const s of world.surfaceZones) if(Math.hypot(x-s.position[0],z-s.position[1])<s.radius) return {kind:s.surface,grip:s.grip,roll:s.roll};
  const road=roadAt(x,z), jump=road?.trail?0:rampAt(x,z).weight;
  if(jump>.5) return {kind:'trail',grip:.96,roll:.01};
  if(world.look?.mud&&!road?.trail) return {kind:'mud',grip:.64,roll:.035};   // (a storm's soaked ground: slippery and draggy)
  return {kind:road?.trail?'trail':theme==='desert'?'sand':theme==='snow'?'snow':'grass',grip:road?.trail ? .96 : .82,roll:road?.trail ? .01 : .02};
 }
 /** The fluid (or drop) the bike is over at (x, z): { kind: lava | water | ice | chasm, level, retry? } or null.
     Lakes and rivers count too (deep water only: you can splash through the shallows). */
 function hazardAt(x,z) {
  if(features.length){ const h=featureAt(x,z).hazard; if(h) return h; }
  if(lake&&!lake.frozen&&lakeDist(x,z)<1) return {kind:lake.lava?'lava':'water',level:lake.lava?lake.level:lake.level-.9};
  if(river&&riverDist(x,z)<river.width*.45) return {kind:river.lava?'lava':'water',level:river.lava?river.level:river.level-.9};
  return null;
 }
 /** How the ground looks under water at (x, z) and height y: colour multipliers [r, g, b] (deeper is bluer), or null. */
 function tintAt(x,z,y) {
  if(sea){ const d=sea.level-y; if(d<-2.2) return null; if(d<0){ const k=1-(-d)/2.2; return [1+.12*k,1+.04*k,1-.18*k]; }   // (a sandy beach just above the water)
   const k=Math.min(1,d/9); return [1.08-.5*k,1.02-.22*k,.86-.02*k]; }   // (pale sand in the shallows, darker deeper down)
  let depth=0;
  if(lake&&!lake.frozen&&!lake.lava&&lakeDist(x,z)<1.05) depth=lake.level-y;
  if(river&&!river.lava&&riverDist(x,z)<river.width*.6) depth=Math.max(depth,river.level-y);
  if(depth<=0) return null;
  const k=Math.min(1,.25+depth/5); return [1-.55*k,1-.32*k,1-.12*k];
 }
 function normalAt(x,z,epsilon=.5) { const nx=heightAt(x-epsilon,z)-heightAt(x+epsilon,z),nz=heightAt(x,z-epsilon)-heightAt(x,z+epsilon),ny=2*epsilon,l=Math.hypot(nx,ny,nz); return {x:nx/l,y:ny/l,z:nz/l}; }
 function inBounds(x,z,margin=0) { return Math.abs(x)<=W/2-margin&&Math.abs(z)<=D/2-margin; }
 function nearestSafePad(x,z) { const pad=pads.reduce((a,b)=>Math.hypot(x-a.position[0],z-a.position[1])<Math.hypot(x-b.position[0],z-b.position[1])?a:b); return {...pad,position:pad.riderPosition||pad.position,heading:roadAt(...(pad.riderPosition||pad.position))?.heading ?? world.spawnHeading}; }
 function gatesFor(raceId,spacing=110) {
  const race=world.races.find(r=>r.id===raceId); if(!race) throw new Error('Unknown race: '+raceId);
  const route=world.routes.find(r=>r.id===race.route),len=routeLength(route),count=Math.ceil(len/spacing),gates=[];
  for(let i=0;i<=count;i++) { const p=routePoint(route,len*i/count); gates.push({...p,y:heightAt(p.x,p.z),radius:race.gateRadius,index:i}); }
  return gates;
 }
 return {world,rawHeight,cliffRise,heightAt,bedAt:landAt,sea,waves:WAVES,waveAt,waveScale,waveTime,roadAt,rampAt,surfaceAt,normalAt,inBounds,nearestSafePad,gatesFor,wild,ramps,parks,mesas,routeDist,buildings,arches,obstacles,obstacleAt,obstaclesNear,
  featureAt,hazardAt,boostAt,tintAt,gaps,pools,boosts,gauntlets,gauntletIn,parkList:parks2,railAt,rideAt,addSolids,forestTrees,forestReach,trailNearest};
}
