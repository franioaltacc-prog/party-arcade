/** A motocross track carved into an open world's hillside ("mx" in the world's file), and the rice terraces beside it.
 * No DOM or THREE: terrain.mjs uses it for the ground the bike rides on, so what you see is what you ride.
 *
 * The track is a closed loop through corners [x, z, radius]: straight legs joined by round arcs (a hairpin is two
 * 90° corners twice the radius apart). Its middle line is worked out every metre, and its height follows the hillside
 * under it, smoothed (so the lanes are cut into the slope as flat benches, the hairpins climb from one to the next).
 * On top of that: the jumps and whoops along it (features, each at the point of the track nearest its "at"), and
 * berms: the outside of every tight corner banked up, higher the tighter it is, with a lip of dirt round the top.
 * Between the lanes the hillside is left as it was (grass and palms, out past each edge's shoulder).
 *
 * Terraces ({ center, radius, step }): the ground in a circle stepped into flat paddies with steep little walls
 * between them, following the hill's own contours. tint() colours them (green and gold rice, the odd flooded one),
 * surface() makes them muddy. areas: the rectangles drawn in finer detail than the rest of the world's ground.
 *
 * "closed": false makes it a downhill course instead of a loop: from the first corner to the last (no arc at either
 * end), with its own features for a big mountain line: gaps (a kicker, a pit or a canyon cut right across the hillside,
 * fall in and you crash and get another go from the run-in), road gaps (a kicker and a landing either side of a road),
 * drops (a deck held level while the hill falls away, then off the end), rock gardens (slate bumps all across the
 * line) and anything built of wood ("wood": true: its sides square, so the timber boxes drawn over it fit). */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const hash=(a,b)=>{let h=Math.imul(a|0,374761393)^Math.imul(b|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};

/** The track's middle line: points every metre round the loop { x, z, tx, tz } (tx, tz: which way it goes), starting
    at the point nearest spec.start. */
export function mxLine(spec){
 const C=spec.corners,n=C.length,pts=[],open=spec.closed===false;
 const dir=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);return [dx/l,dz/l,l];};
 // each corner's arc: where it starts (A) and ends (B), its centre and how far round it turns
 const arcs=C.map((P,i)=>{
  if(open&&(i===0||i===n-1))return {A:[P[0],P[1]],B:[P[0],P[1]],r:0,turn:0};   // (a course's two ends)
  const prev=C[(i+n-1)%n],next=C[(i+1)%n],[ix,iz]=dir(prev,P),[ox,oz]=dir(P,next),r=P[2]||0;
  const turn=Math.atan2(ix*oz-iz*ox,ix*ox+iz*oz),t=r*Math.tan(Math.abs(turn)/2);
  const A=[P[0]-ix*t,P[1]-iz*t],B=[P[0]+ox*t,P[1]+oz*t],side=Math.sign(turn)||1;
  return {A,B,r,turn,c:[A[0]-iz*r*side,A[1]+ix*r*side],side};
 });
 const push=(x,z)=>{const q=pts.at(-1);if(!q||Math.hypot(x-q[0],z-q[1])>1e-6)pts.push([x,z]);};
 for(let i=0;i<n;i++){
  const a=arcs[i];
  if(a.r>0&&Math.abs(a.turn)>1e-4){
   const a0=Math.atan2(a.A[1]-a.c[1],a.A[0]-a.c[0]),k=Math.max(2,Math.ceil(Math.abs(a.turn)*a.r/1.5));
   for(let j=0;j<=k;j++){const t=a0+a.turn*j/k;push(a.c[0]+Math.cos(t)*a.r,a.c[1]+Math.sin(t)*a.r);}
  }else push(a.A[0],a.A[1]);
  if(open&&i===n-1)break;
  const b=arcs[(i+1)%n],L=Math.hypot(b.A[0]-a.B[0],b.A[1]-a.B[1]);   // (the straight to the next corner)
  for(let j=1;j<Math.floor(L/6);j++)push(a.B[0]+(b.A[0]-a.B[0])*j/Math.floor(L/6),a.B[1]+(b.A[1]-a.B[1])*j/Math.floor(L/6));
 }
 // resample every metre round the closed loop (or from end to end)
 const out=[];let total=0;const seg=[];
 for(let i=0;i<pts.length-(open?1:0);i++){const a=pts[i],b=pts[(i+1)%pts.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);seg.push([a,b,l,total]);total+=l;}
 const N=Math.round(total)+(open?1:0),per=total/(open?N-1:N);let k=0;
 for(let i=0;i<N;i++){
  const d=i*per;while(k<seg.length-1&&seg[k][3]+seg[k][2]<d)k++;
  const [a,b,l,s0]=seg[k],t=l?Math.min(1,(d-s0)/l):0;out.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t});
 }
 const at=i=>out[open?Math.max(0,Math.min(N-1,i)):(i+N)%N];
 for(let i=0;i<N;i++){const p=at(i-1),q=at(i+1),l=Math.hypot(q.x-p.x,q.z-p.z)||1;out[i].tx=(q.x-p.x)/l;out[i].tz=(q.z-p.z)/l;}
 if(spec.start&&!open){let best=0,bd=Infinity;out.forEach((p,i)=>{const d=Math.hypot(p.x-spec.start[0],p.z-spec.start[1]);if(d<bd){bd=d;best=i;}});out.push(...out.splice(0,best));}
 return out;
}

/** The track's points as a route for the world's file: a closed polyline every few metres (finer in the corners). */
export function mxRoutePoints(line,closed=true){
 const pts=[];
 for(let i=0;i<line.length;i++){
  const p=line[i],q=line[(i+1)%line.length],bend=Math.abs(p.tx*q.tz-p.tz*q.tx);
  const last=pts.at(-1);if(!last||Math.hypot(p.x-last[0],p.z-last[1])>=(bend>.02?3:8)||(!closed&&i===line.length-1))pts.push([+p.x.toFixed(2),+p.z.toFixed(2)]);
 }
 if(closed)pts.push(pts[0].slice());
 return pts;
}

/** The shapes along the track (and LEN: how long each is; a drop's is worked out with the bench, in mxGround): a: metres into the feature; returns how much higher than the bench the track is. */
const SHAPES={
 table:(f,a)=>a<f.up?f.h*Math.pow(a/f.up,1.8):a<f.up+f.top?f.h:f.h*(1-smooth((a-f.up-f.top)/f.down)),
 double:(f,a)=>{const lip=f.up,land=lip+f.gap;
  if(a<lip)return f.h*Math.pow(a/lip,1.8);
  if(a<land)return Math.max(f.h*(1-smooth((a-lip)/4)),f.h*.92*smooth((a-land+3.8)/3.8));   // (a steep back, a gap, a steep face)
  return f.h*.92*(1-smooth((a-land)/f.down));},
 whoops:(f,a)=>f.h*(.5-.5*Math.cos(a/f.gap*Math.PI*2))*smooth(a/f.gap)*smooth((f.len-a)/f.gap),
 step:(f,a)=>a<f.up?f.h*smooth(a/f.up):f.h*(1-smooth((a-f.up-f.top)/f.down)),
 // a gap: a kicker (curving up to its lip), then nothing (the pit is cut separately: see pit), then the landing's
 // face (land: how high it stands; 0, straight onto the hill), easing back down to the bench over "down"
 gap:(f,a)=>{const lip=f.up,end=lip+f.gap;
  if(a<lip)return f.h*Math.pow(a/lip,1.6);
  if(a<end)return Math.max(f.h*(1-smooth((a-lip)/1.2)),f.land*smooth((a-end+2.2)/2.2));
  return f.land*(1-smooth((a-end)/f.down));},
 rocks:()=>0,
};
const LEN={table:f=>f.up+f.top+f.down,double:f=>f.up+f.gap+f.down,whoops:f=>f.len,step:f=>f.up+f.top+f.down,gap:f=>f.up+f.gap+f.down,drop:f=>f.up+f.top+f.down,rocks:f=>f.len};
/** Bumpy slate: 0 between the rocks, up to 1 on top of one (a few metres across, sharp-edged). */
function slate(x,z){
 const cell=(a,b,s)=>{const i=Math.floor(a/s),j=Math.floor(b/s),u=smooth(a/s-i),v=smooth(b/s-j),p=hash(i,j),q=hash(i+1,j),r=hash(i,j+1),t=hash(i+1,j+1);return p+(q-p)*u+(r-p)*v+(p-q-r+t)*u*v;};
 const n=cell(x+z*.35,z-x*.35,2.6)*.65+cell(x*1.7+40,z*1.7-13,2.6)*.35;
 return smooth((n-.42)/.22);
}

/** The ground shaper: mxGround(world, landAt) once the world's ground (without the track) can be measured.
    shape(x, z, y): the height there with the track and terraces in it; tint(x, z): colour or null; surface(x, z);
    hazard(x, z): the pit of a gap under (x, z) ({ kind, level, retry }) or null. */
export function mxGround(world,landAt){
 const spec=world.mx,open=spec?.closed===false,line=spec?mxLine(spec):[],N=line.length,hw=(spec?.width||9)/2,shoulder=spec?.shoulder??4.5,bermH=spec?.berm??1.7;
 const I=open?i=>Math.max(0,Math.min(N-1,i)):i=>((i%N)+N)%N;   // (a loop goes round; a course stops at its ends)
 // ---- the bench: the hillside's height under the middle line, smoothed along it (a box filter, three times)
 let base=line.map(p=>landAt(p.x,p.z));
 const W0=spec?.smooth??12;
 for(let pass=0;pass<3;pass++){const out=new Array(N);for(let i=0;i<N;i++){let sum=0;for(let j=-W0;j<=W0;j++)sum+=base[I(i+j)];out[i]=sum/(2*W0+1);}base=out;}
 // ---- how tight each bit is (for the berms) and which side the outside is
 const bank=new Float32Array(N),outside=new Int8Array(N);
 for(let i=0;i<N;i++){
  const p=line[I(i-3)],q=line[I(i+3)],c=line[i];
  const k=(p.tx*q.tz-p.tz*q.tx)/6;   // (turning, per metre; its sign: which way)
  bank[i]=smooth((Math.abs(k)-.018)/.045);
  const nx=c.tz,nz=-c.tx,dt=(q.tx-p.tx)*nx+(q.tz-p.tz)*nz;outside[i]=dt>0?-1:1;   // (the outside, in the "n" direction)
 }
 {const W=6,b=Float32Array.from(bank);for(let i=0;i<N;i++){let s=0;for(let j=-W;j<=W;j++)s+=b[I(i+j)];bank[i]=s/(2*W+1);}}
 // ---- the features: each starts at the point of the track nearest its "at"
 const prof=new Float32Array(N),pit=new Float32Array(N),wide=new Float32Array(N),wood=new Float32Array(N),rock=new Float32Array(N),hazards=[];
 const nearestIndex=(x,z)=>{let best=0,bd=Infinity;for(let i=0;i<N;i++){const d=(line[i].x-x)**2+(line[i].z-z)**2;if(d<bd){bd=d;best=i;}}return best;};
 const features=(spec?.features||[]).map(f0=>{
  const f={up:6,top:8,down:10,gap:5.5,h:1.8,len:40,land:0,depth:0,wide:12,flat:.7,...f0},s0=f.s!=null?Math.round(f.s):nearestIndex(...f.at),len=LEN[f.kind](f);   // (at a point, or s metres along)
  for(let a=0;a<=len;a++){
   const i=open?s0+a:(s0+a)%N;if(i>=N)break;
   let v;
   if(f.kind==='drop'){   // (a deck: up onto it, held level (flat 0..1) while the hill falls away, then straight off the end)
    const keep=f.flat*(base[I(s0+f.up)]-base[I(s0+Math.min(a,f.up+f.top))]);
    v=a<f.up?f.h*smooth(a/f.up):a<f.up+f.top?f.h+keep:(f.h+keep)*(1-smooth((a-f.up-f.top)/f.down));
    if(f.wood&&a<f.up+f.top+f.down*.5)wood[i]=1;
   }else{
    v=SHAPES[f.kind](f,a);
    if(f.wood&&(f.kind!=='gap'||a<f.up+.5))wood[i]=1;   // (a gap's kicker is the timber part)
   }
   prof[i]=Math.max(prof[i],v);
   if(f.kind==='gap'&&a>f.up&&a<f.up+f.gap&&f.depth>0){
    const t=a-f.up;pit[i]=Math.max(pit[i],f.depth*smooth((t-.2)/1.4)*(1-smooth((t-f.gap+1.6)/1.4)));wide[i]=Math.max(wide[i],f.wide);
   }
   if(f.kind==='rocks')rock[i]=Math.max(rock[i],f.h*smooth(a/6)*smooth((len-a)/6));
  }
  if(f.kind==='gap'){   // (fall in and you get another go from "run" metres before the kicker)
   const r=I(s0-(f.run||60)),p=line[r];
   hazards.push({kick:s0,s0:s0+f.up+.6,s1:s0+f.up+f.gap-.6,half:f.depth>0?hw+f.wide:hw+.6,road:f.depth<=0,id:f.id||('gap-'+hazards.length),
    retry:{position:[p.x,p.z],heading:Math.atan2(p.tx,p.tz)}});
  }
  return {...f,s0,len};
 });
 const maxWide=Math.max(0,...wide);
 // ---- finding the nearest point of the middle line fast: the points by 8 m square
 const G=8,grid=new Map();
 line.forEach((p,i)=>{const key=Math.floor(p.x/G)+','+Math.floor(p.z/G);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});
 const reach=hw+Math.max(shoulder+2.6,maxWide?maxWide+5:0);
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const p of line){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
 /** The track near (x, z): { s (metres round, fractional), u (metres off the middle line, + the "n" side), i } or null. */
 function near(x,z){
  if(!N||x<minX-reach||x>maxX+reach||z<minZ-reach||z>maxZ+reach)return null;
  const gx=Math.floor(x/G),gz=Math.floor(z/G),r=Math.ceil(reach/G);let best=-1,bd=reach*reach;
  for(let a=gx-r;a<=gx+r;a++)for(let b=gz-r;b<=gz+r;b++)for(const i of grid.get(a+','+b)||[]){const d=(line[i].x-x)**2+(line[i].z-z)**2;if(d<bd){bd=d;best=i;}}
  if(best<0)return null;
  const p=line[best],dx=x-p.x,dz=z-p.z,along=dx*p.tx+dz*p.tz;
  if(open&&((best===0&&along<-.5)||(best===N-1&&along>.5)))return null;   // (past either end of a course: the hillside)
  return {i:best,s:best+along,u:dx*p.tz-dz*p.tx};
 }
 const lerp=(arr,s)=>{const i=Math.floor(s),t=s-i,a=arr[I(i)],b=arr[I(i+1)];return a+(b-a)*t;};
 // ---- the terraces
 const T=spec?.terraces||[];
 const terraced=(x,z)=>{for(const t of T){const d=Math.hypot(x-t.center[0],z-t.center[1]);if(d<t.radius)return {t,d};}return null;};
 function shape(x,z,y){
  for(const t of T){
   const d=Math.hypot(x-t.center[0],z-t.center[1]);if(d>=t.radius)continue;
   const v=y/t.step,fl=Math.floor(v),q=(fl+smooth((v-fl-.8)/.2))*t.step,k=1-smooth((d-t.radius*.78)/(t.radius*.22));
   y+=(q-y)*k;
  }
  const at=near(x,z);if(!at)return y;
  const {s,u,i}=at,o=u*outside[i],b=lerp(bank,s),B=bermH*b,au=Math.abs(u),wd=lerp(wood,s);
  const cross=(1-smooth((au-hw+1.2)/2.4))*(1-wd)+(1-smooth((au-hw+.05)/.5))*wd;   // (timber: square sides)
  const bed=lerp(base,s);let top=bed+lerp(prof,s)*cross;
  const rk=lerp(rock,s);if(rk>0)top+=rk*slate(x,z)*(1-smooth((au-hw-1)/2));
  if(B>0)top+=o<-hw?0:o<hw?B*((o+hw)/(2*hw))**2:B+.35*b*smooth((o-hw)/1.2);   // (the banked outside, and its lip)
  const edge=hw+(o>0?2.4*b:0),w=1-smooth((au-edge)/shoulder);
  y+=(top-y)*w;
  const pd=lerp(pit,s);   // (a gap's pit: cut right across, out to "wide" metres past each edge)
  if(pd>0){const k=1-smooth((au-hw-lerp(wide,s))/4),floor=bed-pd;if(y>floor)y+=(floor-y)*k;}
  return y;
 }
 /** Colour multipliers for the ground at (x, z): the paddies' rice and water, the darker walls between them. */
 const SLATE=spec?.slate||[.74,.9,1.18];
 function tint(x,z,y,heightAt){
  if(open){   // (a course: its rock gardens' slate, and the bare rock down the walls of every pit)
   const at=near(x,z);if(!at)return null;
   const rk=lerp(rock,at.s),pd=lerp(pit,at.s);let k=0;
   if(rk>0)k=Math.min(1,rk*2)*slate(x,z)*(1-smooth((Math.abs(at.u)-hw-1)/2));
   if(pd>0)k=Math.max(k,smooth((lerp(base,at.s)-y-.6)/1.5)*(1-smooth((Math.abs(at.u)-hw-lerp(wide,at.s)-2)/3)));
   return k>0?SLATE.map(v=>1+(v-1)*k):null;
  }
  const tr=terraced(x,z);if(!tr)return null;
  const {t,d}=tr,k=1-smooth((d-t.radius*.72)/(t.radius*.2));if(k<=0)return null;
  const g=Math.hypot(heightAt(x+1,z)-heightAt(x-1,z),heightAt(x,z+1)-heightAt(x,z-1))/2;
  const fl=Math.floor((y+.4)/t.step),r=hash(fl,Math.round(t.center[0]+t.center[1])),wall=smooth((g-.12)/.25);
  const paddy=r<.2?[.5,.78,1.12]:r<.5?[1.32,1.62,.5]:r<.78?[.92,1.36,.6]:[1.85,1.6,.46];   // (flooded, bright green, deep green, ripening gold)
  const c=[0,1,2].map(j=>paddy[j]*(1-wall)+[.62,.6,.44][j]*wall);
  return c.map(v=>1+(v-1)*k);
 }
 const surface=(x,z)=>{const tr=terraced(x,z);return tr&&tr.d<tr.t.radius*.75?{kind:'mud',grip:.7,roll:.03}:null;};
 /** The pit of a gap at (x, z), if that's where you are: { kind (chasm, or gap over a road), level (below it you've
     fallen in), retry (the run-in: where you have another go) }. */
 function hazard(x,z){
  if(!hazards.length)return null;
  const at=near(x,z);if(!at)return null;
  for(const h of hazards)if(at.s>h.s0&&at.s<h.s1&&Math.abs(at.u)<h.half)
   return {kind:h.road?'gap':'chasm',level:lerp(base,at.s)+(h.road?1.5:-1.2),retry:h.retry,id:h.id};
  return null;
 }
 /** On a jump or drop, or the last bit of run-in to a gap: not a place to be put back after a crash. */
 function busy(x,z){
  const at=near(x,z);if(!at)return false;
  return lerp(prof,at.s)>.25||lerp(pit,at.s)>0||hazards.some(h=>at.s>h.kick-30&&at.s<h.s1+3);
 }
 // ---- the areas drawn in finer detail: the track (and its hillside), each terrace, and any paved road
 const areas=[];
 if(N&&!open)areas.push({x:(minX+maxX)/2,z:minZ-16,s:0,c:1,a0:0,a1:maxZ-minZ+32,w:(maxX-minX)/2+16,step:spec.detailStep||1.5});
 if(N&&open)for(let a=0;a<N-1;a+=90){   // (a course: strips along it, each as wide as the course wanders plus its pits)
  const b=Math.min(N-1,a+90),A=line[a],B=line[b],L=Math.hypot(B.x-A.x,B.z-A.z)||1,sx=(B.x-A.x)/L,sz=(B.z-A.z)/L;let off=0;
  for(let i=a;i<=b;i++)off=Math.max(off,Math.abs((line[i].x-A.x)*sz-(line[i].z-A.z)*sx));
  areas.push({x:A.x,z:A.z,s:sx,c:sz,a0:-14,a1:L+14,w:off+reach+8,step:spec.detailStep||1.5});
 }
 for(const t of T)areas.push({x:t.center[0],z:t.center[1]-t.radius,s:0,c:1,a0:0,a1:t.radius*2,w:t.radius,step:t.detailStep||2.5});
 const road=spec?.paved&&world.routes.find(r=>r.id===spec.paved);
 if(road)for(let i=1;i<road.points.length;i++){const [ax,az]=road.points[i-1],[bx,bz]=road.points[i],L=Math.hypot(bx-ax,bz-az);areas.push({x:ax,z:az,s:(bx-ax)/L,c:(bz-az)/L,a0:-4,a1:L+4,w:road.width/2+6,step:4});}
 return {line,base,bank,prof,pit,wood,rock,features,hazards,hw,open,near,shape,tint,surface,hazard,busy,areas,length:N,
  /** Which side is the outside of the bend at s (+1: u > 0), and the point u metres across the track there. */
  outside:s=>outside[I(Math.floor(s))],
  point(s,u=0){const p=line[I(Math.floor(s))];return {x:p.x+p.tz*u,z:p.z-p.tx*u,heading:Math.atan2(p.tx,p.tz)};},
  /** The track's middle at s metres round: { x, z, y, heading }. */
  at(s){const i=I(Math.floor(s)),p=line[i];return {x:p.x,z:p.z,y:base[i]+prof[i]-pit[i],heading:Math.atan2(p.tx,p.tz)};}};
}
