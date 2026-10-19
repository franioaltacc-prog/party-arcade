import * as THREE from 'three';
import {buildOpenWorld} from './world.mjs';
import {terrainMaterial} from './materials.mjs';
import {THEMES,particles} from '../world.js';

/** Adds the runtime scene contract expected by the existing riding camera, dust and HUD. */
export function buildRideWorld(map,quality=1){
 const built=buildOpenWorld(map,{resolution:quality>.7?512:320,scenery:Math.round(2000*quality)});
 const scene=new THREE.Scene();scene.add(built.group);scene.background=new THREE.Color(map.palette.sky);scene.fog=new THREE.Fog(map.palette.sky,1500,6500);
 const theme={...THEMES[map.theme==='alpine'?'forest':map.theme],exposure:1.05};
 scene.add(new THREE.HemisphereLight('#dceeff',map.theme==='desert'?'#8e6747':'#647574',1.9));
 const sun=new THREE.DirectionalLight('#fff1df',2.5);sun.position.set(-700,1300,400);sun.castShadow=quality>.4;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-16,right:16,top:16,bottom:-16,near:1,far:250});sun.shadow.normalBias=.025;scene.add(sun,sun.target);
 const fxRoot=new THREE.Group();scene.add(fxRoot);const fx=particles(fxRoot,theme);
 // A 1 m terrain patch replaces coarse terrain around the rider. Its outer strip meets the
 // actual coarse triangles, rather than floating above them or leaving a visible crack.
 const half=72,n=144,geo=new THREE.PlaneGeometry(half*2,half*2,n,n);geo.rotateX(-Math.PI/2);
 const pos=geo.attributes.position,local=pos.array.slice(),color=new Float32Array(pos.count*3).fill(1),trail=new Float32Array(pos.count);
 geo.setAttribute('color',new THREE.BufferAttribute(color,3));geo.setAttribute('trailWeight',new THREE.BufferAttribute(trail,1));
 const detail=terrainMaterial(map,built.layered.textures),patch=new THREE.Mesh(geo,detail.material);scene.add(patch);patch.receiveShadow=true;
 let cx=Infinity,cz=Infinity;const samples=new Map();
 const coarse=(x,z)=>{
  const resolution=built.ground.geometry.parameters.widthSegments,w=map.size[0],d=map.size[1];
  const gx=Math.max(0,Math.min(resolution-.00001,(x/w+.5)*resolution)),gz=Math.max(0,Math.min(resolution-.00001,(z/d+.5)*resolution));
  const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,p=built.ground.geometry.attributes.position;
  const a=p.getY(iz*(resolution+1)+ix),b=p.getY((iz+1)*(resolution+1)+ix),c=p.getY((iz+1)*(resolution+1)+ix+1),d0=p.getY(iz*(resolution+1)+ix+1);
  return u+v<=1?a+(d0-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d0-c)*(1-v);
 };
 function updatePatch(point){
  const x=Math.round(point.x/24)*24,z=Math.round(point.z/24)*24;if(x===cx&&z===cz)return;cx=x;cz=z;
  for(let i=0;i<pos.count;i++){
   const lx=local[i*3],lz=local[i*3+2],wx=x+lx,wz=z+lz,blend=Math.max(0,Math.min(1,(Math.max(Math.abs(lx),Math.abs(lz))-64)/8));
   const key=wx+','+wz;let sample=samples.get(key);
   if(!sample){sample={x:wx,z:wz,y:built.terrain.heightAt(wx,wz),trail:built.terrain.roadAt(wx,wz)?.weight||0,shade:.91+Math.sin(wx*.037+wz*.013)*.035+Math.cos(wz*.025)*.025};samples.set(key,sample);}
   const y=sample.y;pos.setXYZ(i,wx,y+(coarse(wx,wz)-y)*blend,wz);trail[i]=sample.trail;
   color[i*3]=color[i*3+1]=color[i*3+2]=sample.shade;
  }
  if(samples.size>45000)for(const [key,p]of samples)if(Math.abs(p.x-cx)>half+24||Math.abs(p.z-cz)>half+24)samples.delete(key);
  geo.attributes.color.needsUpdate=true;pos.needsUpdate=true;geo.attributes.trailWeight.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingSphere();built.layered.hole.set(cx,cz,64,1);
 }
 return {
  free:true,scene,theme,fx,gates:[],ground:built.terrain,definition:map,
  update(point,dt,camera){updatePatch(point);sun.position.copy(point).add(new THREE.Vector3(-60,100,40));sun.target.position.copy(point);fx.update(dt,camera);},
  dispose(){
   samples.clear();built.dispose();geo.dispose();detail.dispose();
   const textures=new Set();fxRoot.traverse(o=>{o.geometry?.dispose();if(o.material){for(const u of Object.values(o.material.uniforms||{}))if(u.value?.isTexture)textures.add(u.value);if(o.material.map)textures.add(o.material.map);o.material.dispose();}});textures.forEach(t=>t.dispose());
  }
 };
}
