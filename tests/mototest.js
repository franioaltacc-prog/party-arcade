/* Motocross without a browser: the bike's physics, the tracks and the robot rider.
   Run:  jsc tests/mototest.js   (from the repo folder; tests/run_all.py runs it too)
   Prints one line per check; a line starting with "FAIL " means something is wrong. */
load('public/js/games/moto/core.js');
const C = globalThis.MotoCore;
const DATA = JSON.parse(readFile('public/js/games/moto/tracks.json'));
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; print((ok ? 'PASS ' : 'FAIL ') + what); };
const kmh = (v) => (v * 3.6).toFixed(0) + ' km/h';
const flat = C.build({ id: 'flat', name: 'Flat', course: ['flat 20', 'start', 'flat 1500', 'finish', 'flat 50'] });

// ---------------------------------------------------------------- the bike
{
  const b = C.newBike(flat);
  const x = b.x;
  for (let i = 0; i < 240; i++) C.step(flat, b, {});
  check(Math.abs(b.x - x) < 0.05 && Math.abs(b.a) < 0.05 && !b.crashed, 'a bike left alone stands still on its suspension');
  check(b.wh[0].c > 0.03 && b.wh[0].c < 0.12 && b.wh[1].c > 0.03 && b.wh[1].c < 0.12, `it sags into its suspension (${b.wh[0].c.toFixed(2)} / ${b.wh[1].c.toFixed(2)} m)`);
  let gears = new Set();
  for (let i = 0; i < 120 * 12; i++) { C.step(flat, b, { gas: 1 }); gears.add(b.gear); }
  const top = Math.hypot(b.vx, b.vy);
  check(top > 85 / 3.6 && top < 110 / 3.6 && !b.crashed, `full gas on the flat: top speed ${kmh(top)}, no crash`);
  check(gears.size === 5, 'it changes up through all 5 gears');
  let stop = b.x;
  const v0 = Math.hypot(b.vx, b.vy);
  for (let i = 0; i < 120 * 8 && Math.hypot(b.vx, b.vy) > 0.3; i++) C.step(flat, b, { brake: 1 });
  check(!b.crashed && b.x - stop < 70, `full brakes from ${kmh(v0)} stop in ${(b.x - stop).toFixed(0)} m without going over the bars`);
}
{
  // lean back on the gas: a wheelie; leaning forward keeps the front down
  const b = C.newBike(flat); let up = 0;
  for (let i = 0; i < 240; i++) { C.step(flat, b, { gas: 1, lean: -1 }); up = Math.max(up, b.a); }
  const c = C.newBike(flat); let up2 = 0;
  for (let i = 0; i < 240; i++) { C.step(flat, c, { gas: 1, lean: 1 }); up2 = Math.max(up2, c.a); }
  check(up > 0.4 && up2 < 0.25 && !b.crashed && !c.crashed, `leaning back pulls a wheelie (${up.toFixed(2)} rad), leaning forward keeps the front down (${up2.toFixed(2)} rad)`);
}
{
  // drop it upside down: that's a crash, and the rider goes flying
  const b = C.newBike(flat);
  b.a = Math.PI; b.y += 1.6; b.ry += 2.4; b.rx = b.x;
  let ev = [];
  for (let i = 0; i < 120; i++) ev = ev.concat(C.step(flat, b, {}));
  check(b.crashed > 0 && ev.some((e) => e[0] === 'crash') && b.rider, 'landing on your head is a crash');
  C.respawn(flat, b);
  check(!b.crashed && Math.abs(b.a) < 0.05 && b.x === flat.start && b.crashes === 1, 'after a crash you go back to the start (or the last checkpoint), upright');
}
{
  // tricks in the air fill the nitro, and nitro makes you faster
  const T = C.build({ id: 'jump', name: 'Jump', course: ['flat 20', 'start', 'flat 60', 'double 11 2.8 18', 'flat 80', 'finish', 'flat 40'] });
  const f = T.features.find((q) => q.kind === 'double');
  check(f.speed > 12 && f.speed < 22, `a big double wants ${kmh(f.speed)} at the lip`);
  // hold lean-back off the lip, let go a bit before a full turn (the robot lands it); try a few let-go points
  let land = null; let b = null;
  for (let stop = 0.6; stop < 2.8 && !land; stop += 0.2) {
    b = C.newBike(T); let flipping = false; let rot = 0;
    for (let i = 0; i < 120 * 20 && !land && !b.crashed; i++) {
      const inp = C.robot(T, b);
      const air = !(b.wh[0].ct || b.wh[1].ct);
      if (air && b.x > f.lip - 1 && b.x < f.lip + 3 && !rot) flipping = true;
      if (flipping) { rot += b.w * C.DT; if (rot > 2 * Math.PI - stop || !air) flipping = false; else inp.lean = -1; }
      for (const [k, d] of C.step(T, b, inp)) if (k === 'land' && d.turns) land = d;
    }
  }
  check(land && land.turns === 1 && land.back && b.nitro >= 0.3, `a backflip landed clean fills the nitro (${b.nitro.toFixed(2)})`);
  const s = C.newBike(flat); const n = C.newBike(flat); n.nitro = 1;
  for (let i = 0; i < 120 * 3; i++) { C.step(flat, s, { gas: 1, lean: 1 }); C.step(flat, n, { gas: 1, lean: 1, nitro: true }); }
  check(n.x > s.x + 2 && n.nitro < 1, `nitro: ${(n.x - s.x).toFixed(1)} m ahead after 3 s`);
}
// ---------------------------------------------------------------- riding in 3D
{
  // steering: A/D turn the bike, the faster you go the less the bars turn
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 3; i++) C.step(flat, b, { gas: 0.6 });
  const h0 = b.h;
  for (let i = 0; i < 120; i++) C.step(flat, b, { gas: 0.4, steer: 1 });
  check(b.h - h0 > 0.4 && !b.crashed, `D turns the bike right (${(b.h - h0).toFixed(2)} rad in 1 s)`);
  const h1 = b.h;
  for (let i = 0; i < 120; i++) C.step(flat, b, { gas: 0.4, steer: -1 });
  check(b.h < h1 - 0.4, 'A turns it left');
  // the ground under the bike is the same ground the 3D world draws
  const gy = C.heightAt(flat, b.s, b.u);
  check(Math.abs(b.wh[1].y - C.P.R[1] - gy) < 0.08, `the wheels sit on the drawn ground (${(b.wh[1].y - C.P.R[1] - gy).toFixed(3)} m)`);
}
{
  // too fast for a tight turn: you slide wide and lose speed instead of turning on the spot
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 6; i++) C.step(flat, b, { gas: 1, lean: 0.5 });
  const v0 = b.vx; let scrub = 0;
  for (let i = 0; i < 60; i++) { C.step(flat, b, { gas: 1, steer: 1 }); scrub = Math.max(scrub, b.scrub); }
  check(scrub > 0.1 && b.vx < v0 && !b.crashed, `a hard turn at ${kmh(v0)} slides wide and scrubs off speed (${kmh(b.vx)})`);
}
{
  // the barrier: you can leave the tape but not cut across the countryside
  const b = C.newBike(flat); let most = 0; let hit = false;
  for (let i = 0; i < 120 * 8; i++) { for (const [k] of C.step(flat, b, { gas: 0.5, steer: i < 120 ? 0.6 : 0 })) if (k === 'fence') hit = true; most = Math.max(most, Math.abs(b.u)); }
  check(hit && most < C.P.FENCE + 0.5 && !b.crashed, `riding off the track ends at the barrier (${most.toFixed(1)} m out)`);
}
{
  // off the track the ground is slower
  const on = C.newBike(flat); const off = C.newBike(flat, flat.start, 8);
  for (let i = 0; i < 120 * 4; i++) { C.step(flat, on, { gas: 1, lean: 0.4 }); C.step(flat, off, { gas: 1, lean: 0.4 }); }
  check(off.off && off.vx < on.vx - 2, `off the track is slower (${kmh(off.vx)} vs ${kmh(on.vx)})`);
}
{
  // stopped with S held you paddle backwards; turned around you're going the wrong way
  const b = C.newBike(flat);
  for (let i = 0; i < 120 * 2; i++) C.step(flat, b, { brake: 1 });
  check(b.vx < -0.8 && !b.crashed, `holding S when stopped backs you up (${b.vx.toFixed(1)} m/s)`);
  const c = C.newBike(flat); let wrong = false;
  for (let i = 0; i < 120 * 8 && !wrong; i++) { C.step(flat, c, { gas: 0.35, steer: 1 }); wrong = c.wrong; }
  check(wrong, 'turning all the way round shows WRONG WAY');
}
{
  let threw = false;
  try { C.build({ id: 'bad', course: ['flat 10', 'start', 'loop 5', 'finish'] }); } catch (e) { threw = /loop/.test(e.message); }
  check(threw, 'an unknown track piece is an error that names it');
}

// ---------------------------------------------------------------- free-ride heightfield adapter
{
  const pad={id:'camp',position:[100,200],heading:Math.PI/2};
  const ground={heightAt:(x,z)=>70+(x-100)*.12, normalAt:()=>({x:-.12/Math.hypot(1,.12),y:1/Math.hypot(1,.12),z:0}),
    surfaceAt:()=>({kind:'trail',grip:1,roll:.01}),inBounds:(x,z)=>Math.abs(x)<5000&&Math.abs(z)<5000,nearestSafePad:()=>pad};
  const T=C.groundTrack(ground,pad),b=C.newBike(T),y=b.y;let events=[];
  check(Math.abs(b.px-100)<.01&&Math.abs(b.pz-200)<.01&&Math.abs(b.h)<.01,'free ride converts only the spawn heading and keeps world coordinates');
  for(let i=0;i<120*5;i++)events=events.concat(C.step(T,b,{gas:1,lean:.1}));
  check(!b.crashed&&b.px>140&&b.y>y+4,'free ride climbs a real world-space hill without the corridor fence');
  check(Math.abs(b.wh[1].y-C.P.R[1]-ground.heightAt(b.px+(b.wh[1].x-b.x)*Math.cos(b.h),b.pz))<.12,'free-ride wheels stay on the sampled heightfield');
  check(!b.wrong&&b.finished===null&&b.cp===-1&&!events.some(e=>['finish','cp','fence'].includes(e[0])),'free ride skips track checkpoints, finish, wrong-way and berm/fence rules');
  C.respawn(T,b);check(Math.abs(b.px-pad.position[0])<.01&&Math.abs(b.pz-pad.position[1])<.01&&!b.crashed&&b.hold===C.P.HOLD_TIME,'free ride respawns upright on nearestSafePad');
  b.px=6000;const ev=C.step(T,b,{});check(b.crashed&&ev.some(e=>e[0]==='bounds'),'leaving world bounds triggers a safe reset rather than endless falling');
}

// Free-ride speed, turbo and large jumps, independent of race tuning.
{
 const pad={position:[0,0],heading:Math.PI/2};let lip=Infinity;
 const height=x=>{const t=(x-lip)/30;return t>0&&t<2?5*(1-Math.cos(Math.PI*t))/2:0;};
 const ground={heightAt:x=>height(x),normalAt:x=>{const d=height(x+.5)-height(x-.5),n=Math.hypot(d,1);return{x:-d/n,y:1/n,z:0};},surfaceAt:()=>({kind:'trail',grip:1,roll:.01}),inBounds:()=>true,nearestSafePad:()=>pad};
 const T=C.groundTrack(ground,pad),b=C.newBike(T),turbo=C.newBike(T);
 for(let i=0;i<120*20;i++){C.step(T,b,{gas:1});C.step(T,turbo,{gas:1});}
 check(b.vx*3.6>290&&!b.crashed&&b.gear===6,'free ride builds beyond 290 km/h in six gears without crashing');
 const initial=b.vx;
 for(let i=0;i<120*5;i++){C.step(T,b,{gas:1});C.step(T,turbo,{gas:1,nitro:true});}
 check(turbo.vx>b.vx+7&&turbo.vx*3.6>330&&!turbo.crashed,'turbo gives a substantial burst beyond 330 km/h');
 for(let i=0;i<120*4;i++)C.step(T,turbo,{gas:1,nitro:true});
 check(turbo.nitro===0&&!turbo.boost,'holding turbo empty does not pulse or recharge');
 for(let i=0;i<120*3;i++)C.step(T,turbo,{gas:.5});
 check(turbo.nitro>.35,'releasing turbo recharges it for the next run-up');
 for(let i=0;i<120*6;i++)C.step(T,turbo,{brake:1});
 check(turbo.vx<initial*.5&&!turbo.crashed,'braking reliably sheds more than half the high-speed momentum');
 const straight=C.newBike(T),turning=C.newBike(T);
 for(let i=0;i<120*15;i++){C.step(T,straight,{gas:1});C.step(T,turning,{gas:1});}
 const heading=turning.h;
 for(let i=0;i<120*3;i++){C.step(T,straight,{gas:1});C.step(T,turning,{gas:1,steer:1});}
 check(Math.abs(straight.vx-turning.vx)<1e-7&&turning.h>heading+.25&&!turning.crashed,'free-ride steering changes heading without scrubbing speed under throttle');
 const turnBack=turning.h;
 for(let i=0;i<120*3;i++){C.step(T,straight,{});C.step(T,turning,{steer:-1});}
 check(Math.abs(straight.vx-turning.vx)<1e-7&&turning.h<turnBack-.25&&!turning.crashed,'free-ride coasting loses only normal drag, equally in a straight line or a turn');
 lip=b.px+50;let maxY=0,maxAir=0,landed=false;
 for(let i=0;i<120*12;i++){const ev=C.step(T,b,{gas:1});maxY=Math.max(maxY,b.y);maxAir=Math.max(maxAir,b.air);if(ev.some(e=>e[0]==='land'))landed=true;}
 check(maxY>25&&maxAir>4&&landed&&!b.crashed&&b.vx>60,'a high-speed ramp launches a long ballistic jump and absorbs an upright landing');
 const head=C.newBike(T);head.a=Math.PI;head.y+=1.6;head.ry+=2.4;head.rx=head.x;
 for(let i=0;i<120;i++)C.step(T,head,{assist:false});
 check(head.crashes>0,'free-ride landing absorption does not save an upside-down landing');
}

// Fixed-step integration gives the same ride across display refresh rates.
{
 const run=(fps)=>{const T=C.build({id:'frames',course:['flat 20','start','flat 500','finish']}),b=C.newBike(T);let acc=0;for(let f=0;f<fps*4;f++){acc+=1/fps;while(acc>=C.DT-1e-10){C.step(T,b,{gas:.7,steer:.05});acc-=C.DT;}}return b;};
 const a=run(30),b=run(144);check(Math.abs(a.px-b.px)<1e-8&&Math.abs(a.pz-b.pz)<1e-8&&a.gear===b.gear,'the same fixed-step inputs ride identically at 30 and 144 fps');
}

// ---------------------------------------------------------------- embedded races (the actual DOM-free runtime)
{
  const api=Function(readFile('public/js/games/moto/open-world/trials.mjs').replace(/export /g,'')+'; return {createTrial,stepTrial,crossGate,trialBestKey};')();
  const gate={x:0,y:0,z:0,heading:Math.PI/2,radius:10};
  check(api.crossGate(gate,{x:-30,y:1,z:0},{x:30,y:1,z:0}),'mini-race gates use swept crossings, including fast passes');
  check(!api.crossGate(gate,{x:3,y:1,z:0},{x:-3,y:1,z:0})&&!api.crossGate(gate,{x:-3,y:50,z:0},{x:3,y:50,z:0})&&!api.crossGate(gate,{x:-3,y:1,z:30},{x:3,y:1,z:30}),'wrong-way, high and outside-radius passes do not count');
  const t=api.createTrial({gatesFor:()=>[gate,{...gate,x:100},gate]},{id:'loop',laps:2});
  const cross=(x)=>api.stepTrial(t,{x:x-1,y:1,z:0},{x:x+1,y:1,z:0},1);
  cross(100);check(t.next===0&&!t.started,'mini races cannot skip the start or advance gates out of order');
  cross(0);cross(100);cross(0);check(t.lap===2&&t.next===1&&!t.done,'closed mini races require every gate on every lap');
  cross(100);const ev=cross(0);check(ev==='finish'&&t.done&&t.time===4,'a mini race finishes once, using fixed-step elapsed time after the start');
  check(api.trialBestKey('redrock','loop')!==api.trialBestKey('pinecrest','loop'),'mini-race best-time keys are scoped to their world');
}

// ---------------------------------------------------------------- every track
for (const def of DATA.tracks) {
  const T = C.build(def);
  check(T.cps.length >= 2 && T.finish > T.start + 500, `${def.name}: ${(T.finish - T.start).toFixed(0)} m, ${T.cps.length} checkpoints`);
  const r = C.simulate(T);
  const r2 = C.simulate(T);
  check(r.time != null && r.crashes === 0, `${def.name}: the robot rides it in ${r.time ? r.time.toFixed(2) + 's' : 'DNF'} with ${r.crashes} crashes`);
  check(r2.time === r.time, `${def.name}: the physics is the same every time`);
  check(def.robot && Math.abs(def.robot - r.time) < 0.05, `${def.name}: tracks.json has the robot's time (${def.robot}; it's ${r.time && r.time.toFixed(2)})`);
  for (let i = 0; i < T.cps.length; i++) {
    const q = C.simulate(T, { from: i });
    check(q.time != null && q.crashes === 0, `${def.name}: from checkpoint ${i + 1} the robot gets to the finish (${q.time ? q.time.toFixed(1) + 's' : 'DNF'}, ${q.crashes} crashes)`);
  }
  const jumps = T.features.filter((f) => f.top != null && f.kind !== 'stepup');
  check(jumps.every((f) => f.speed && f.speed < 21), `${def.name}: every jump can be cleared (${jumps.map((f) => kmh(f.speed)).join(', ')})`);
}
print('FAILED: ' + failed);
