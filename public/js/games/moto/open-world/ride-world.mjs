import * as THREE from 'three';
import {buildOpenWorld} from './world.mjs';
import {terrainMaterial} from './materials.mjs';
import {renderPolicy} from './render-policy.mjs';
import {THEMES,particles} from '../world.js';

/** Distance-cullable ground/scenery and a budgeted detailed patch around the rider. */
export function buildRideWorld(map,quality=1){
 const policy=renderPolicy(quality);
 const built=buildOpenWorld(map,{resolution:policy.resolution,chunkSegments:policy.chunkSegments,scenery:policy.scenery,detailed:false});
 const scene=new THREE.Scene();scene.add(built.group);scene.background=new THREE.Color(map.palette.sky);scene.fog=new THREE.Fog(map.palette.sky,1200,6000);
 const theme={...THEMES[map.theme==='alpine'?'forest':map.theme],exposure:1.05};
 scene.add(new THREE.HemisphereLight('#dceeff',map.theme==='desert'?'#8e6747':'#647574',1.9));
 const sun=new THREE.DirectionalLight('#fff1df',2.5);sun.position.set(-700,1300,400);scene.add(sun);
 const fxRoot=new THREE.Group();scene.add(fxRoot);const fx=particles(fxRoot,theme,null,quality);
 const half=policy.half,n=policy.segments,inner=half-12;
 const geo=new THREE.PlaneGeometry(half*2,half*2,n,n);geo.rotateX(-Math.PI/2);
 const pos=geo.attributes.position,local=pos.array.slice(),color=new Float32Array(pos.count*3).fill(1),trail=new Float32Array(pos.count);
 geo.setAttribute('color',new THREE.BufferAttribute(color,3));geo.setAttribute('trailWeight',new THREE.BufferAttribute(trail,1));
 const detail=terrainMaterial(map,built.layered.textures,true),patch=new THREE.Mesh(geo,detail.material);scene.add(patch);
 let cx=Infinity,cz=Infinity,job=null;const samples=new Map();
 const backPos=new Float32Array(pos.array.length),backColor=new Float32Array(color.length),backTrail=new Float32Array(trail.length);
 const coarse=(x,z)=>{
  const resolution=policy.resolution,w=map.size[0],d=map.size[1];
  const gx=Math.max(0,Math.min(resolution-.00001,(x/w+.5)*resolution)),gz=Math.max(0,Math.min(resolution-.00001,(z/d+.5)*resolution));
  const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,p=built.ground.geometry.attributes.position;
  const a=p.getY(iz*(resolution+1)+ix),b=p.getY((iz+1)*(resolution+1)+ix),c=p.getY((iz+1)*(resolution+1)+ix+1),d0=p.getY(iz*(resolution+1)+ix+1);
  return u+v<=1?a+(d0-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d0-c)*(1-v);
 };
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
   if(!sample){sample={x:wx,z:wz,y:built.terrain.heightAt(wx,wz),trail:built.terrain.roadAt(wx,wz)?.weight||0,shade:.91+Math.sin(wx*.037+wz*.013)*.035+Math.cos(wz*.025)*.025};samples.set(key,sample);}
   const y=sample.y+(coarse(wx,wz)-sample.y)*blend;backPos[i*3]=wx;backPos[i*3+1]=y;backPos[i*3+2]=wz;backTrail[i]=sample.trail;
   backColor[i*3]=backColor[i*3+1]=backColor[i*3+2]=sample.shade;job.min=Math.min(job.min,y);job.max=Math.max(job.max,y);
  }
  if(job.i<pos.count)return;
  cx=job.x;cz=job.z;pos.array.set(backPos);color.set(backColor);trail.set(backTrail);
  geo.attributes.color.needsUpdate=true;pos.needsUpdate=true;geo.attributes.trailWeight.needsUpdate=true;geo.computeVertexNormals();
  geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(cx,(job.min+job.max)/2,cz),Math.hypot(half,half,(job.max-job.min)/2));
  built.layered.hole.set(cx,cz,inner,1);job=null;
  if(samples.size>45000)for(const [key,p]of samples)if(Math.abs(p.x-cx)>half+32||Math.abs(p.z-cz)>half+32)samples.delete(key);
 }
 // Soft contact shadow replaces a full second scene render for a moving shadow map.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,3,32,32,32);gradient.addColorStop(0,'#000b');gradient.addColorStop(1,'#0000');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 const shadowTex=new THREE.CanvasTexture(canvas),shadowGeo=new THREE.PlaneGeometry(3.5,2.2);shadowGeo.rotateX(-Math.PI/2);
 const shadowMat=new THREE.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false,opacity:.3,polygonOffset:true,polygonOffsetFactor:-2});
 const contact=new THREE.Mesh(shadowGeo,shadowMat);scene.add(contact);const up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3();
 return {
  free:true,scene,theme,fx,gates:[],ground:built.terrain,definition:map,policy,
  update(point,dt,camera){
   updatePatch(point);fx.update(dt,camera);
   const y=built.terrain.heightAt(point.x,point.z),n=built.terrain.normalAt(point.x,point.z);
   contact.position.set(point.x,y+.045,point.z);contact.quaternion.setFromUnitVectors(up,normal.set(n.x,n.y,n.z));shadowMat.opacity=.3*Math.max(0,1-Math.max(0,point.y-y-.65)/7);
  },
  dispose(){
   samples.clear();built.dispose();geo.dispose();detail.dispose();shadowGeo.dispose();shadowMat.dispose();shadowTex.dispose();
   const textures=new Set();fxRoot.traverse(o=>{o.geometry?.dispose();if(o.material){for(const u of Object.values(o.material.uniforms||{}))if(u.value?.isTexture)textures.add(u.value);if(o.material.map)textures.add(o.material.map);o.material.dispose();}});textures.forEach(t=>t.dispose());
  }
 };
}
