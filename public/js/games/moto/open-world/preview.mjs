import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildOpenWorld} from './world.mjs';
import {routeLength,routePoint,clamp} from './terrain.mjs';
const $=id=>document.getElementById(id),renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:true,logarithmicDepthBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,1,12000),controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.minDistance=8;controls.maxDistance=5000;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight('#e5f3ff','#786146',2));const sun=new THREE.DirectionalLight('#fff1d3',3);sun.position.set(-800,1400,600);scene.add(sun);
let current,world,tab='spots',selected=null,tour=null,moving=null,loadToken=0;const keys=new Set(),clock=new THREE.Clock(),mapCanvas=$('map'),ctx=mapCanvas.getContext('2d');
const base='/js/games/moto/open-world/';
async function json(file){const r=await fetch(base+file);if(!r.ok)throw new Error('Could not load '+file);return r.json();}
function overview(){tour=null;moving={from:camera.position.clone(),to:new THREE.Vector3(2500,2400,2800),target:new THREE.Vector3(0,130,0),start:performance.now()};$('tour').textContent='Trail tour';}
function focus(position){tour=null;$('tour').textContent='Trail tour';const [x,z]=position,y=world.terrain.heightAt(x,z);moving={from:camera.position.clone(),to:new THREE.Vector3(x+150,y+130,z+190),target:new THREE.Vector3(x,y+3,z),start:performance.now()};}
function detail(item){
 selected=item;$('details').replaceChildren();const h=document.createElement('h3');h.textContent=item.name;$('details').append(h);
 const p=text=>{const el=document.createElement('p');el.textContent=text;$('details').append(el);};
 if(tab==='spots'){p(item.about);const jobs=current.quests.filter(q=>q.start===item.id);p(jobs.length?jobs.map(q=>q.name).join(' · '):'Explore the connected trails from here.');focus(item.position);}
 else if(tab==='races'){
  const route=current.routes.find(r=>r.id===item.route);p(`${(routeLength(route)/1000).toFixed(2)} km · ${item.laps} lap${item.laps>1?'s':''} · ${item.difficulty} · 1–6 riders`);p(item.type==='hillclimb'?'Work your way up the switchbacks.':item.type==='downhill'?'Drop from the high ground into the valley.':'An embedded race inside the open world.');p('Timed racing is a gameplay hook; this preview follows the course.');
  const b=document.createElement('button');b.textContent='Preview this route';b.onclick=()=>startTour(route);$('details').append(b);focus(route.points[0]);
 } else {
  const spot=current.spots.find(s=>s.id===item.start);p(`Starts at ${spot.name} · ${item.players[0]}–${item.players[1]} riders`);
  for(const [i,step] of item.steps.entries()){
   const target=[...current.spots,...current.interactions,...current.races].find(s=>s.id===step.target);
   const verb={'zone.enter':'Visit','supply.collect':'Collect at','supply.deliver':'Deliver to','relay.activate':'Activate','photo.capture':'Take a group photo at','trick.land':'Land clean tricks at','race.finish':'Finish'}[step.event];
   p(`${i+1}. ${verb} ${target.name}${step.count>1?' × '+step.count:''}${step.withinSeconds?' within '+step.withinSeconds+' seconds':''}${step.distinctPlayers?' with a different rider':''}.`);
  }p('Quest definition only; acceptance, progress and rewards are left for the gameplay integration.');focus(spot.position);
 }
 renderList();
}
function renderList(){
 $('items').replaceChildren();for(const item of current[tab]){const b=document.createElement('button');b.classList.toggle('active',selected?.id===item.id);b.textContent=item.name;const sub=document.createElement('small');sub.textContent=tab==='spots'?item.kind:tab==='races'?item.difficulty+' / '+item.type:item.players[0]>1?'Co-op / '+item.players.join('–')+' riders':'Solo or with friends';b.append(sub);b.onclick=()=>detail(item);$('items').append(b);}
}
function startTour(route=current.routes[0]) {moving=null;tour={route,d:0};$('tour').textContent='Stop tour';}
async function load(id){
 const token=++loadToken;$('loading').style.display='grid';$('loading').textContent='Sculpting trails & summits…';
 try {
  const map=await json(id+'.json');if(token!==loadToken)return;await new Promise(resolve=>requestAnimationFrame(resolve));
  const built=buildOpenWorld(map);if(world){scene.remove(world.group);world.dispose();}current=map;world=built;scene.add(world.group);selected=null;tour=null;
  scene.background=new THREE.Color(map.palette.sky);scene.fog=new THREE.Fog(map.palette.sky,3200,8500);sun.color.set(map.theme==='desert'?'#fff1d3':'#e5f2ff');$('title').textContent=map.name;$('tagline').textContent=map.tagline;
  $('stats').textContent=`${(map.size[0]*map.size[1]/1e6).toFixed(1)} km² to explore / ${Math.round(world.maxHeight-world.minHeight)} m elevation range / 4 mini races / 6 quests`;
  $('details').textContent='Select an activity to inspect it.';
  $('trails').textContent='Trail lines on';$('trails').setAttribute('aria-pressed','true');
  renderList();document.querySelector('aside').scrollTop=0;overview();$('loading').style.display='none';
 }catch(error){$('loading').textContent='Map preview could not load: '+error.message;console.error(error);}
}
const manifest=await json('manifest.json');for(const w of manifest.worlds){const option=document.createElement('option');option.value=w.id;option.textContent=w.name;$('world').append(option);}
$('ground').onclick=()=>{
 tour=null;moving=null;$('tour').textContent='Trail tour';
 const [x,z]=selected?.position||current.spawn,y=world.terrain.heightAt(x,z);
 camera.position.set(x+70,world.terrain.heightAt(x+70,z+60)+7,z+60);controls.target.set(x+130,world.terrain.heightAt(x+130,z+10)+5,z+10);controls.update();
};
$('world').onchange=e=>load(e.target.value);$('overview').onclick=overview;$('tour').onclick=()=>{if(tour){tour=null;$('tour').textContent='Trail tour';}else startTour();};
$('trails').onclick=()=>{world.routes.visible=!world.routes.visible;$('trails').textContent='Trail lines '+(world.routes.visible?'on':'off');$('trails').setAttribute('aria-pressed',world.routes.visible);};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{tab=b.dataset.tab;selected=null;document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el===b));renderList();$('details').textContent='Select an activity to inspect it.';};
controls.addEventListener('start',()=>{tour=null;moving=null;$('tour').textContent='Trail tour';});
window.addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName))return;if(['w','a','s','d','q','e','shift'].includes(e.key.toLowerCase())){keys.add(e.key.toLowerCase());tour=null;moving=null;$('tour').textContent='Trail tour';e.preventDefault();}});window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function mapPoint(x,z){return [(x/current.size[0]+.5)*460,(z/current.size[1]+.5)*460];}
mapCanvas.onclick=e=>{const r=mapCanvas.getBoundingClientRect();focus([(e.clientX-r.left)/r.width*current.size[0]-current.size[0]/2,(e.clientY-r.top)/r.height*current.size[1]-current.size[1]/2]);};
function miniMap(){
 ctx.clearRect(0,0,460,460);ctx.fillStyle=current.theme==='desert'?'#382d25':current.theme==='snow'?'#697f92':'#21352f';ctx.fillRect(0,0,460,460);ctx.strokeStyle='#ffffff10';for(let i=0;i<460;i+=46){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,460);ctx.moveTo(0,i);ctx.lineTo(460,i);ctx.stroke();}
 const lake=current.terrain.lake;if(lake){const [x,z]=mapPoint(...lake.position);ctx.fillStyle=current.palette.water;ctx.beginPath();ctx.ellipse(x,z,lake.radius[0]/current.size[0]*460,lake.radius[1]/current.size[1]*460,0,0,Math.PI*2);ctx.fill();}
 if(current.terrain.river){const r=current.terrain.river;ctx.beginPath();for(let z=-1800;z<=1800;z+=30){const p=mapPoint(r.x+Math.sin(z/r.wavelength)*r.amplitude,z);z===-1800?ctx.moveTo(...p):ctx.lineTo(...p);}ctx.strokeStyle=current.palette.water;ctx.lineWidth=8;ctx.stroke();}
 for(const route of current.routes){ctx.beginPath();route.points.forEach((p,i)=>{const xy=mapPoint(...p);i?ctx.lineTo(...xy):ctx.moveTo(...xy);});ctx.strokeStyle=tour?.route===route?'#fff':current.palette.accent;ctx.lineWidth=tour?.route===route?4:2;ctx.stroke();}
 for(const p of current.spots){const xy=mapPoint(...p.position);ctx.fillStyle=selected?.id===p.id?'#fff':'#f4cc89';ctx.beginPath();ctx.arc(...xy,5,0,Math.PI*2);ctx.fill();}
 const xy=mapPoint(camera.position.x,camera.position.z);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(clamp(xy[0],7,453),clamp(xy[1],7,453),6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffffffb0';ctx.font='18px system-ui';ctx.fillText('N ↑',20,30);ctx.fillText((current.size[0]/1000).toFixed(1)+' km',340,435);
}
function frame(){
 requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);
 if(world){
  if(moving){const t=clamp((performance.now()-moving.start)/1100,0,1),ease=t*t*(3-2*t);camera.position.lerpVectors(moving.from,moving.to,ease);controls.target.lerp(moving.target,.1);if(t===1)moving=null;}
  if(tour){tour.d+=dt*45;const len=routeLength(tour.route);if(tour.d>=len&&!tour.route.closed){tour=null;$('tour').textContent='Trail tour';}else {const p=routePoint(tour.route,tour.d),next=routePoint(tour.route,tour.d+42),y=world.terrain.heightAt(p.x,p.z);camera.position.lerp(new THREE.Vector3(p.x-Math.sin(p.heading)*30,y+24,p.z-Math.cos(p.heading)*30),.08);controls.target.lerp(new THREE.Vector3(next.x,world.terrain.heightAt(next.x,next.z)+4,next.z),.1);}}
  if(keys.size){const f=new THREE.Vector3();camera.getWorldDirection(f);f.y=0;f.normalize();const right=new THREE.Vector3().crossVectors(f,camera.up).normalize(),v=new THREE.Vector3();if(keys.has('w'))v.add(f);if(keys.has('s'))v.sub(f);if(keys.has('d'))v.add(right);if(keys.has('a'))v.sub(right);if(keys.has('e'))v.y++;if(keys.has('q'))v.y--;v.multiplyScalar(dt*(keys.has('shift')?350:90));camera.position.add(v);controls.target.add(v);}
  const x=clamp(camera.position.x,-current.size[0]/2,current.size[0]/2),z=clamp(camera.position.z,-current.size[1]/2,current.size[1]/2);if(camera.position.y<world.terrain.heightAt(x,z)+6)camera.position.y=world.terrain.heightAt(x,z)+6;
  miniMap();
 }
 controls.update();world?.update(camera.position);renderer.render(scene,camera);
}
camera.position.set(2500,2400,2800);controls.target.set(0,130,0);frame();await load('redrock');
