/** World-space terrain shared by the renderer and the bike (core.js groundTrack). No DOM or THREE dependency.
 * Coordinates are metres; +Y is up, heading 0 is +Z. Rendering is never the collision authority.
 * Instantiate once, then sample heightAt(x,z), surfaceAt(x,z), normalAt(x,z).
 *
 * The height is built in layers:
 *  1. rawHeight: the authored hills, lake and river (the trails follow this, so races stay as authored)
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
 function rawHeight(x,z) {
  let y=world.baseHeight;
  for(const [hx,hz,h,rx,rz] of spec.hills) y+=h*Math.exp(-(((x-hx)/rx)**2+((z-hz)/rz)**2)*1.8);
  y+=spec.noise*(noise(x/spec.scale,z/spec.scale,seed)-.5)*2;
  y+=spec.noise*.22*(noise(x/65,z/65,seed+51)-.5)*2;
  if(river) { const d=riverDist(x,z); y-=river.depth*Math.exp(-((d/river.width)**2)); }
  if(lake) { const d=lakeDist(x,z); y=y*(smooth((d-.7)/.55))+(lake.frozen?lake.level:lake.level-lake.depth)*(1-smooth((d-.7)/.55)); }
  return y;
 }
 /** Mountain ranges round the edge: rideable foothills up to the edge of the world, then the real peaks rising
  * beyond it (where you can't ride, but can see), with ribs and gullies down their faces. */
 const B=world.boundary, rimWidth=B.cliffWidth||300, rimHeight=B.cliffHeight||520;
 function cliffRise(x,z) {
  const edge=Math.min(W/2-Math.abs(x),D/2-Math.abs(z)), t=1-edge/rimWidth;
  if(t<=0) return 0;
  const crest=ridged(x/520,z/520,seed+111,4), ribs=ridged(x/150,z/150,seed+131,2), inside=Math.min(t,1), beyond=Math.max(0,t-1);
  let y=rimHeight*.3*Math.pow(smooth(inside),1.6)*(.7+.6*crest);
  y+=beyond*rimWidth*(.8+.5*crest)*smooth(beyond*2)+rimHeight*.9*crest*crest*smooth(beyond*.9);
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
 for(const pad of [pads[0],pads[Math.min(pads.length-1,2)]]) {
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
    if(!inBounds(ex,ez,rimWidth+70)||routeDist(ex,ez)<42||wet(ex,ez,70)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<95)||pads.some(p=>Math.hypot(ex-p.position[0],ez-p.position[1])<110)||!clearOfFeatures(ex,ez,30)){ok=false;break;}
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
    if(routeDist(ex,ez)<(p.trail??30)||wet(ex,ez,40)||world.spots.some(s=>Math.hypot(ex-s.position[0],ez-s.position[1])<80)||pads.some(q=>Math.hypot(ex-q.position[0],ez-q.position[1])<90)){ok=false;break;}
    const y=rawHeight(ex,ez);lo=Math.min(lo,y);hi=Math.max(hi,y);
   }
   if(ok&&hi-lo<14){ spot={cx,cz,base:(lo+hi)/2}; break search; }
  }
  if(!spot) continue;
  const depth=p.depth||5,pool={id:p.id,kind,pool:true,x:spot.cx,z:spot.cz,cx:spot.cx,cz:spot.cz,rx,rz,turn,c:Math.cos(turn),s:Math.sin(turn),base:spot.base,depth,level:spot.base-(kind==='lava'?1.4:1),reach:reach*1.7};
  pools.push(pool);features.push(pool);
 }
 const featureGrid=new Map(); for(const f of features) insert(featureGrid,f,f.cx-f.reach,f.cx+f.reach,f.cz-f.reach,f.cz+f.reach);
 const FLAT={flat:0,base:0,dy:0,weight:0,hazard:null};
 /** What a gap jump or pool does to the ground at (x, z): flatten it towards base (flat 0..1), then add dy;
     weight = how much it looks like a dirt jump; hazard = the pit's fluid there ({kind, level, retry}) or null. */
 function featureAt(x,z) {
  const list=featureGrid.get(Math.floor(x/cell)+','+Math.floor(z/cell)); if(!list) return FLAT;
  for(const f of list) {
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
  for(let i=0;i<7;i++){ const radius=60+r()*70,c=centre(radius+60); if(c)mesas.push({x:c[0],z:c[1],radius,height:30+r()*45,stretch:1+r()*.5,turn:r()*Math.PI,tiers:1,crag:true}); }
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
 const buildings=world.spots.map(spot=>{
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
 /** A solid thing the bike can't ride through at (x, z): { x, z, r, top } or null. */
 function obstacleAt(x,z){ for(const o of obstacles){ if(Math.abs(x-o.x)<o.r&&Math.abs(z-o.z)<o.r&&Math.hypot(x-o.x,z-o.z)<o.r) return {...o,top:(o.top??=heightAt(o.x,o.z)+o.tall)}; } return null; }

 function heightAt(x,z) {
  let y=rawHeight(x,z); const road=roadAt(x,z); if(road) y+=(road.height-y)*road.weight;
  for(const p of pads) { const d=Math.hypot(x-p.position[0],z-p.position[1]), weight=1-smooth((d-p.radius)/(p.radius*3)); if(weight>0)y+=(p.height-y)*weight; }
  y+=rampAt(x,z).y;
  if(features.length){ const f=featureAt(x,z); if(f.flat>0) y+=(f.base-y)*f.flat+f.dy; }
  const w=wild(x,z); if(w>0) y+=landform(x,z)*w;
  return y+cliffRise(x,z);
 }
 function surfaceAt(x,z) {
  if(features.length&&featureAt(x,z).weight>.5) return {kind:'trail',grip:.96,roll:.01};   // (gap jumps are packed dirt, whatever's round them)
  for(const s of world.surfaceZones) if(Math.hypot(x-s.position[0],z-s.position[1])<s.radius) return {kind:s.surface,grip:s.grip,roll:s.roll};
  const road=roadAt(x,z), jump=road?.trail?0:rampAt(x,z).weight;
  if(jump>.5) return {kind:'trail',grip:.96,roll:.01};
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
 function normalAt(x,z,epsilon=.5) { const nx=heightAt(x-epsilon,z)-heightAt(x+epsilon,z),nz=heightAt(x,z-epsilon)-heightAt(x,z+epsilon),ny=2*epsilon,l=Math.hypot(nx,ny,nz); return {x:nx/l,y:ny/l,z:nz/l}; }
 function inBounds(x,z,margin=0) { return Math.abs(x)<=W/2-margin&&Math.abs(z)<=D/2-margin; }
 function nearestSafePad(x,z) { const pad=pads.reduce((a,b)=>Math.hypot(x-a.position[0],z-a.position[1])<Math.hypot(x-b.position[0],z-b.position[1])?a:b); return {...pad,position:pad.riderPosition||pad.position,heading:roadAt(...(pad.riderPosition||pad.position))?.heading ?? world.spawnHeading}; }
 function gatesFor(raceId,spacing=110) {
  const race=world.races.find(r=>r.id===raceId); if(!race) throw new Error('Unknown race: '+raceId);
  const route=world.routes.find(r=>r.id===race.route),len=routeLength(route),count=Math.ceil(len/spacing),gates=[];
  for(let i=0;i<=count;i++) { const p=routePoint(route,len*i/count); gates.push({...p,y:heightAt(p.x,p.z),radius:race.gateRadius,index:i}); }
  return gates;
 }
 return {world,rawHeight,cliffRise,heightAt,roadAt,rampAt,surfaceAt,normalAt,inBounds,nearestSafePad,gatesFor,wild,ramps,parks,mesas,routeDist,buildings,arches,obstacles,obstacleAt,
  featureAt,hazardAt,boostAt,gaps,pools,boosts};
}
