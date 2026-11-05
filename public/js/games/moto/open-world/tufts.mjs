import * as THREE from 'three';

/** Tufts of grass made of real blades (not pictures of grass): each a handful of thin blades, curved and tapering, dark
 * at the root and straw or olive at the tip, sprung from one spot and leaning out a little. Lit like the field they
 * stand in (their normals lean up), swaying in the wind, a touch of sun shining through them.
 * tuftKit(): { geos (three different tufts), mat, time (the wind's clock: add the seconds to time.value) }.
 * tuftField(): a field of them round the rider, rebuilt a few thousand at a time as the rider moves. */
export function tuftKit({quality=1,color='#ffffff',seed=1,lawn=false,tips=null,root=null}={}){   // (lawn: short fine turf, more blades, greener)
 // tips: the blades' tip colours [most, some, a few] (default straw / olive / pale dead, or for a lawn olive / yellow-green /
 // straw); root: the colour at the root
 const time={value:0};
 const tuftGeo=(blades,seedT)=>{
  let ts=seedT>>>0;const r=()=>{ts=(Math.imul(ts,1664525)+1013904223)>>>0;return ts/4294967296;};
  const P=[],C=[],Nn=[],I=[];
  for(let b=0;b<blades;b++){
   const a=r()*6.283,lean=lawn?.03+r()*.14:.04+r()*.22,h=.45+r()*.55,w=lawn?.007+r()*.006:.01+r()*.009,dry=r(),bend=.08+r()*.3;
   const dx=Math.cos(a),dz=Math.sin(a),pa=a+(r()-.5)*1.2,px=-Math.sin(pa),pz=Math.cos(pa);
   // (a tip colour: most blades straw-yellow, some olive green, a few pale and dead)
   const T=tips||(lawn?[[.5,.58,.22],[.66,.66,.3],[.84,.78,.48]]:[[.84,.76,.42],[.56,.62,.26],[.88,.84,.64]]),tip=lawn?(dry<.6?T[0]:dry<.9?T[1]:T[2]):dry<.4?T[0]:dry<.85?T[1]:T[2],rt=root||(lawn?[.2,.25,.09]:[.3,.3,.14]);
   const ox=(r()-.5)*(lawn?.22:.16),oz=(r()-.5)*(lawn?.22:.16);
   const base=P.length/3;
   for(let k=0;k<3;k++){   // (three rows up the blade: root, middle, tip)
    const t=k/2,y=h*t*(1-.25*bend*t*t),out=(lean*t+bend*t*t)*h*.55,half=w*(1-t*.82)*(k===2?0:1);
    const cx=ox+dx*out,cz=oz+dz*out,c=[0,1,2].map(q=>rt[q]+(tip[q]-rt[q])*Math.pow(t,.8));
    for(const sgn of k===2?[0]:[-1,1]){P.push(cx+px*half*sgn,y,cz+pz*half*sgn);C.push(...c);Nn.push(dx*.35,1,dz*.35);}
   }
   I.push(base,base+1,base+2, base+1,base+3,base+2, base+2,base+3,base+4);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(Nn,3));g.setIndex(I);g.normalizeNormals();return g;
 };
 const blades=lawn?(quality>.8?16:quality>.4?10:6):quality>.8?12:quality>.4?7:5;
 const geos=[0,1,2].map(i=>tuftGeo(blades,(seed||1)*31+i*977));
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.9,color});
 mat.onBeforeCompile=sh=>{sh.uniforms.uT=time;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nuniform float uT;').replace('#include <begin_vertex>',`#include <begin_vertex>
#ifdef USE_INSTANCING
{ vec3 r=instanceMatrix[3].xyz;float gust=.55+.45*sin(uT*.8-r.x*.05-r.z*.035);
  float sw=(sin(uT*2.1+r.x*.4+r.z*.31)+.4*sin(uT*3.7+r.x*.9-r.z*.5))*gust;
  float h=max(0.0,transformed.y);transformed.xz+=vec2(.8,.5)*(sw*.35+gust*.25)*h*h; }
#endif`)
   // (the sun through a blade seen against it: a little warm light from behind)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.10,.09,.03)*smoothstep(.0,.6,vColor.r);');};
 mat.customProgramCacheKey=()=>'mx-tuft-wind';
 return {geos,mat,time,dispose(){geos.forEach(g=>g.dispose());mat.dispose();}};
}

/** Patches: smooth noise (two scales) for how thick and how tall the grass grows at (x, z), about 0..1. */
export function tuftPatch(x,z){
 const f=(a,b)=>Math.sin(a*1.7+Math.sin(b*1.3))*Math.cos(b*1.9-Math.sin(a*.7));
 return .5+.3*f(x*.045,z*.045)+.2*f(x*.17+3,z*.17-1);
}

/** A field of tufts round a moving centre. ok(x, z): can grass grow there; height(x, z): the ground as drawn.
 * radius: how far out it grows; spacing: the grid it's scattered on (one tuft a cell at most, fewer further out and
 * where the patch is thin). rebuild(x, z) starts growing it round a new centre; step() does a few thousand cells a
 * frame and swaps the new field in when it's done (the old one stays up till then). */
export function tuftField(scene,kit,{radius=40,spacing=.5,ok,height,tint=[1,1,1],lawn=false,density=1}){   // (tint: times the blades' own colour; lawn: an even close carpet of short turf)
 const span=Math.ceil(radius/spacing),max=Math.ceil(Math.PI*span*span*(lawn?1:.75)/3)+64;
 const meshes=kit.geos.map(g=>{const im=new THREE.InstancedMesh(g,kit.mat,max);im.count=0;im.frustumCulled=false;im.receiveShadow=true;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);im.setColorAt(0,new THREE.Color(1,1,1));scene.add(im);return im;});
 const back=kit.geos.map(()=>({m:new Float32Array(max*16),c:new Float32Array(max*3),n:0}));
 const hash=(x,z,s)=>{let h=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^s;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
 let job=null;
 return {
  meshes,
  get busy(){return !!job;},
  centre:null,
  rebuild(x,z){this.centre={x,z};job={cx:x,cz:z,gx:Math.floor(x/spacing)-span,gz:Math.floor(z/spacing)-span,ix:0,iz:0};for(const b of back)b.n=0;},
  step(budget=5000){
   if(!job)return;
   const n=span*2+1;
   for(let k=0;k<budget&&job.iz<n;k++){
    const gx=job.gx+job.ix,gz=job.gz+job.iz;if(++job.ix>=n){job.ix=0;job.iz++;}
    const x=(gx+hash(gx,gz,7))*spacing,z=(gz+hash(gx,gz,13))*spacing,dx=x-job.cx,dz=z-job.cz,d2=dx*dx+dz*dz;
    if(d2>radius*radius)continue;
    const d=tuftPatch(x,z),near=1-Math.sqrt(d2)/radius;   // (thinner further out: each tuft is a few pixels there)
    if(hash(gx,gz,21)>density*(lawn?(.8+.2*d)*Math.min(1,near*2.6):Math.min(1,d*1.1+.15)*(.3+.7*Math.min(1,near*2.2))))continue;   // (a carpet, thinning further out)
    if(!ok(x,z))continue;
    const vi=Math.floor(hash(gx,gz,31)*3*.9999),b=back[vi];if(b.n>=max)continue;
    const lush=lawn?0:Math.max(0,Math.min(1,(d-.55)*2.8)),tall=lawn?.13+.09*hash(gx,gz,43)+.07*d:.08+.08*hash(gx,gz,43)+.4*Math.pow(lush,1.5)*(.6+hash(gx,gz,41)*.8),wide=.7+hash(gx,gz,51)*.6;   // (short turf mostly, tall dry grass in the lush patches)
    q.setFromAxisAngle(up,hash(gx,gz,61)*6.283);m4.compose(v.set(x,height(x,z)-.03,z),q,sc.set(wide*(.7+tall),tall,wide*(.7+tall)));
    // (short turf greener, the tall patches drier and straw-coloured)
    m4.toArray(b.m,b.n*16);const t=.8+hash(gx,gz,71)*.32,g=.92+hash(gx,gz,81)*.16,green=1-lush*.8;
    b.c.set([t*(1-.4*green)*tint[0],t*g*tint[1],t*(.85+hash(gx,gz,91)*.15)*(1-.5*green)*tint[2]],b.n*3);b.n++;
   }
   if(job.iz>=n){   // (done: the new field goes in)
    meshes.forEach((im,i)=>{const b=back[i];im.instanceMatrix.array.set(b.m.subarray(0,b.n*16));im.instanceColor.array.set(b.c.subarray(0,b.n*3));im.count=b.n;
     im.instanceMatrix.needsUpdate=true;im.instanceColor.needsUpdate=true;});
    job=null;
   }
  },
  dispose(){for(const im of meshes){scene.remove(im);im.dispose();}},
 };
}
