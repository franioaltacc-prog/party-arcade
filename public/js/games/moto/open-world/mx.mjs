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
 * surface() makes them muddy. areas: the rectangles drawn in finer detail than the rest of the world's ground. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const hash=(a,b)=>{let h=Math.imul(a|0,374761393)^Math.imul(b|0,668265263);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};

/** The track's middle line: points every metre round the loop { x, z, tx, tz } (tx, tz: which way it goes), starting
    at the point nearest spec.start. */
export function mxLine(spec){
 const C=spec.corners,n=C.length,pts=[];
 const dir=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);return [dx/l,dz/l,l];};
 // each corner's arc: where it starts (A) and ends (B), its centre and how far round it turns
 const arcs=C.map((P,i)=>{
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
  const b=arcs[(i+1)%n],L=Math.hypot(b.A[0]-a.B[0],b.A[1]-a.B[1]);   // (the straight to the next corner)
  for(let j=1;j<Math.floor(L/6);j++)push(a.B[0]+(b.A[0]-a.B[0])*j/Math.floor(L/6),a.B[1]+(b.A[1]-a.B[1])*j/Math.floor(L/6));
 }
 // resample every metre round the closed loop
 const out=[];let total=0;const seg=[];
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);seg.push([a,b,l,total]);total+=l;}
 const N=Math.round(total);let k=0;
 for(let i=0;i<N;i++){
  const d=i*total/N;while(k<seg.length-1&&seg[k][3]+seg[k][2]<d)k++;
  const [a,b,l,s0]=seg[k],t=l?(d-s0)/l:0;out.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t});
 }
 for(let i=0;i<N;i++){const p=out[(i+N-1)%N],q=out[(i+1)%N],l=Math.hypot(q.x-p.x,q.z-p.z)||1;out[i].tx=(q.x-p.x)/l;out[i].tz=(q.z-p.z)/l;}
 if(spec.start){let best=0,bd=Infinity;out.forEach((p,i)=>{const d=Math.hypot(p.x-spec.start[0],p.z-spec.start[1]);if(d<bd){bd=d;best=i;}});out.push(...out.splice(0,best));}
 return out;
}

/** The track's points as a route for the world's file: a closed polyline every few metres (finer in the corners). */
export function mxRoutePoints(line){
 const pts=[];
 for(let i=0;i<line.length;i++){
  const p=line[i],q=line[(i+1)%line.length],bend=Math.abs(p.tx*q.tz-p.tz*q.tx);
  const last=pts.at(-1);if(!last||Math.hypot(p.x-last[0],p.z-last[1])>=(bend>.02?3:8))pts.push([+p.x.toFixed(2),+p.z.toFixed(2)]);
 }
 pts.push(pts[0].slice());
 return pts;
}

/** The shapes along the track: a: metres into the feature; returns how much higher than the bench the track is. */
const SHAPES={
 table:(f,a)=>a<f.up?f.h*Math.pow(a/f.up,1.8):a<f.up+f.top?f.h:f.h*(1-smooth((a-f.up-f.top)/f.down)),
 double:(f,a)=>{const lip=f.up,land=lip+f.gap;
  if(a<lip)return f.h*Math.pow(a/lip,1.8);
  if(a<land)return Math.max(f.h*(1-smooth((a-lip)/4)),f.h*.92*smooth((a-land+3.8)/3.8));   // (a steep back, a gap, a steep face)
  return f.h*.92*(1-smooth((a-land)/f.down));},
 whoops:(f,a)=>f.h*(.5-.5*Math.cos(a/f.gap*Math.PI*2))*smooth(a/f.gap)*smooth((f.len-a)/f.gap),
 step:(f,a)=>a<f.up?f.h*smooth(a/f.up):f.h*(1-smooth((a-f.up-f.top)/f.down)),
};
const LEN={table:f=>f.up+f.top+f.down,double:f=>f.up+f.gap+f.down,whoops:f=>f.len,step:f=>f.up+f.top+f.down};

/** The ground shaper: mxGround(world, landAt) once the world's ground (without the track) can be measured.
    shape(x, z, y): the height there with the track and terraces in it; tint(x, z): colour or null; surface(x, z). */
export function mxGround(world,landAt){
 const spec=world.mx,line=spec?mxLine(spec):[],N=line.length,hw=(spec?.width||9)/2,shoulder=spec?.shoulder??4.5,bermH=spec?.berm??1.7;
 // ---- the bench: the hillside's height under the middle line, smoothed along it (a box filter, three times round)
 let base=line.map(p=>landAt(p.x,p.z));
 for(let pass=0;pass<3;pass++){const W=12,out=new Array(N);let sum=0;for(let j=-W;j<=W;j++)sum+=base[(j+N)%N];for(let i=0;i<N;i++){out[i]=sum/(2*W+1);sum+=base[(i+W+1)%N]-base[(i-W+N)%N];}base=out;}
 // ---- how tight each bit is (for the berms) and which side the outside is
 const bank=new Float32Array(N),outside=new Int8Array(N);
 for(let i=0;i<N;i++){
  const p=line[(i+N-3)%N],q=line[(i+3)%N],c=line[i];
  const k=(p.tx*q.tz-p.tz*q.tx)/6;   // (turning, per metre; its sign: which way)
  bank[i]=smooth((Math.abs(k)-.018)/.045);
  const nx=c.tz,nz=-c.tx,dt=(q.tx-p.tx)*nx+(q.tz-p.tz)*nz;outside[i]=dt>0?-1:1;   // (the outside, in the "n" direction)
 }
 {const W=6,b=Float32Array.from(bank);for(let i=0;i<N;i++){let s=0;for(let j=-W;j<=W;j++)s+=b[(i+j+N)%N];bank[i]=s/(2*W+1);}}
 // ---- the jumps and whoops: each starts at the point of the track nearest its "at"
 const prof=new Float32Array(N);
 const nearestIndex=(x,z)=>{let best=0,bd=Infinity;for(let i=0;i<N;i++){const d=(line[i].x-x)**2+(line[i].z-z)**2;if(d<bd){bd=d;best=i;}}return best;};
 const features=(spec?.features||[]).map(f0=>{
  const f={up:6,top:8,down:10,gap:5.5,h:1.8,len:40,...f0},s0=nearestIndex(...f.at),len=LEN[f.kind](f);
  for(let a=0;a<=len;a++)prof[(s0+a)%N]=Math.max(prof[(s0+a)%N],SHAPES[f.kind](f,a));
  return {...f,s0,len};
 });
 // ---- finding the nearest point of the middle line fast: the points by 8 m square
 const G=8,grid=new Map();
 line.forEach((p,i)=>{const key=Math.floor(p.x/G)+','+Math.floor(p.z/G);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});
 const reach=hw+shoulder+2.6;
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const p of line){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
 /** The track near (x, z): { s (metres round, fractional), u (metres off the middle line, + the "n" side), i } or null. */
 function near(x,z){
  if(!N||x<minX-reach||x>maxX+reach||z<minZ-reach||z>maxZ+reach)return null;
  const gx=Math.floor(x/G),gz=Math.floor(z/G),r=Math.ceil(reach/G);let best=-1,bd=reach*reach;
  for(let a=gx-r;a<=gx+r;a++)for(let b=gz-r;b<=gz+r;b++)for(const i of grid.get(a+','+b)||[]){const d=(line[i].x-x)**2+(line[i].z-z)**2;if(d<bd){bd=d;best=i;}}
  if(best<0)return null;
  const p=line[best],dx=x-p.x,dz=z-p.z,along=dx*p.tx+dz*p.tz;
  return {i:best,s:best+along,u:dx*p.tz-dz*p.tx};
 }
 const lerp=(arr,s)=>{const i=Math.floor(s),t=s-i,a=arr[((i%N)+N)%N],b=arr[(((i+1)%N)+N)%N];return a+(b-a)*t;};
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
  const {s,u,i}=at,o=u*outside[i],b=lerp(bank,s),B=bermH*b;
  const cross=1-smooth((Math.abs(u)-hw+1.2)/2.4);
  let top=lerp(base,s)+lerp(prof,s)*cross;
  if(B>0)top+=o<-hw?0:o<hw?B*((o+hw)/(2*hw))**2:B+.35*b*smooth((o-hw)/1.2);   // (the banked outside, and its lip)
  const edge=hw+(o>0?2.4*b:0),w=1-smooth((Math.abs(u)-edge)/shoulder);
  return y+(top-y)*w;
 }
 /** Colour multipliers for the ground at (x, z): the paddies' rice and water, the darker walls between them. */
 function tint(x,z,y,heightAt){
  const tr=terraced(x,z);if(!tr)return null;
  const {t,d}=tr,k=1-smooth((d-t.radius*.72)/(t.radius*.2));if(k<=0)return null;
  const g=Math.hypot(heightAt(x+1,z)-heightAt(x-1,z),heightAt(x,z+1)-heightAt(x,z-1))/2;
  const fl=Math.floor((y+.4)/t.step),r=hash(fl,Math.round(t.center[0]+t.center[1])),wall=smooth((g-.12)/.25);
  const paddy=r<.2?[.5,.78,1.12]:r<.5?[1.32,1.62,.5]:r<.78?[.92,1.36,.6]:[1.85,1.6,.46];   // (flooded, bright green, deep green, ripening gold)
  const c=[0,1,2].map(j=>paddy[j]*(1-wall)+[.62,.6,.44][j]*wall);
  return c.map(v=>1+(v-1)*k);
 }
 const surface=(x,z)=>{const tr=terraced(x,z);return tr&&tr.d<tr.t.radius*.75?{kind:'mud',grip:.7,roll:.03}:null;};
 // ---- the areas drawn in finer detail: the track (and its hillside), each terrace, and any paved road
 const areas=[];
 if(N)areas.push({x:(minX+maxX)/2,z:minZ-16,s:0,c:1,a0:0,a1:maxZ-minZ+32,w:(maxX-minX)/2+16,step:spec.detailStep||1.5});
 for(const t of T)areas.push({x:t.center[0],z:t.center[1]-t.radius,s:0,c:1,a0:0,a1:t.radius*2,w:t.radius,step:t.detailStep||2.5});
 const road=spec?.paved&&world.routes.find(r=>r.id===spec.paved);
 if(road)for(let i=1;i<road.points.length;i++){const [ax,az]=road.points[i-1],[bx,bz]=road.points[i],L=Math.hypot(bx-ax,bz-az);areas.push({x:ax,z:az,s:(bx-ax)/L,c:(bz-az)/L,a0:-4,a1:L+4,w:road.width/2+6,step:4});}
 return {line,base,bank,prof,features,hw,near,shape,tint,surface,areas,length:N,
  /** Which side is the outside of the bend at s (+1: u > 0), and the point u metres across the track there. */
  outside:s=>outside[((Math.floor(s)%N)+N)%N],
  point(s,u=0){const p=line[((Math.floor(s)%N)+N)%N];return {x:p.x+p.tz*u,z:p.z-p.tx*u,heading:Math.atan2(p.tx,p.tz)};},
  /** The track's middle at s metres round: { x, z, y, heading }. */
  at(s){const i=((Math.floor(s)%N)+N)%N,p=line[i];return {x:p.x,z:p.z,y:base[i]+prof[i],heading:Math.atan2(p.tx,p.tz)};}};
}
