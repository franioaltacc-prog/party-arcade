/** Fixed-step mini-races, independent of UI and three.js. Gate zero starts the clock. */
export function createTrial(ground, race) {
 const gates=ground.gatesFor(race.id);
 return {race,gates,next:0,lap:1,time:0,started:false,done:false};
}
export function crossGate(gate,from,to) {
 const nx=Math.sin(gate.heading),nz=Math.cos(gate.heading);
 const a=(from.x-gate.x)*nx+(from.z-gate.z)*nz,b=(to.x-gate.x)*nx+(to.z-gate.z)*nz;
 if(a>=0||b<0)return false;
 const t=-a/(b-a),x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t,y=from.y+(to.y-from.y)*t;
 return Math.hypot(x-gate.x,z-gate.z)<=gate.radius && Math.abs(y-gate.y)<gate.radius;
}
export function stepTrial(trial,from,to,dt) {
 if(trial.done)return null;
 if(trial.started)trial.time+=dt;
 if(!crossGate(trial.gates[trial.next],from,to))return null;
 if(!trial.started)trial.started=true;
 trial.next++;
 if(trial.next===trial.gates.length){
  if(trial.lap<trial.race.laps){trial.lap++;trial.next=1;}
  else {trial.done=true;return 'finish';}
 }
 return 'gate';
}
export const trialBestKey=(worldId,raceId)=>`moto_world_best_v2_${worldId}_${raceId}`;
