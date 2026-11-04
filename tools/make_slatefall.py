"""Builds open-world/slatefall.json (Slatefall Valley and its downhill course) from the corners below and the jumps in
slatefall_features.json. Run: python3 tools/make_slatefall.py"""
import json, math, os, sys
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,'..','public/js/games/moto/open-world/slatefall.json')
FEAT=json.load(open(sys.argv[1] if len(sys.argv)>1 else os.path.join(HERE,'slatefall_features.json')))
start=[-60,-1000]; finish=[10,935]
H=math.atan2(-40-start[0],-900-start[1])
def pads6(p,h):
    c,s=math.cos(h),math.sin(h);out=[]
    for i,(a,b) in enumerate([(-3,0),(0,0),(3,0),(-3,-4),(0,-4),(3,-4)]):
        out.append({"id":f"spawn-{i+1}","position":[round(p[0]+a*c+b*s,1),round(p[1]-a*s+b*c,1)],"heading":round(h,6)})
    return out
corners=[[-60,-1000],[-40,-900,40],[-170,-790,34],[-120,-650,30],[70,-560,34],[50,-400,34],[-110,-290,30],[-90,-110,34],
         [80,0,34],[95,210,36],[-60,360,30],[-40,560,40],[10,700,60],[10,935]]
w={
 "schemaVersion":1,"id":"slatefall","name":"Slatefall Valley","tagline":"Wet slate, big gaps, one way down.","theme":"alpine","seed":9127,
 "size":[1400,2400],"baseHeight":30,"spawn":start,"spawnHeading":round(H,6),
 "palette":{"sky":"#aeb8bd","low":"#2f4a2c","high":"#6d7f5a","trail":"#5a4a3c","water":"#4f6f78","accent":"#ffb21a"},
 "look":{"slate":True,"drizzle":True,"snow":False,"pisteClear":3,"treeLine":700,
   "sky":{"sun":[30,160],"turbidity":9,"rayleigh":2.4,"mie":0.016,"exposure":1.15,"fog":1.5,"fogColor":"#8f9aa0","sunColor":"#d8dde2","sunI":1.0,"hemi":["#9aa6b0","#2a3226",0.62]},
   "grass":[[48,76,38],[104,128,68]],"dirt":[[92,74,56],[142,120,94]],"rock":[[58,62,68],[112,118,124]]},
 "terrain":{"noise":10,"scale":230,"hills":[[0,-1500,600,1000,1900],[-640,-200,170,280,1500],[640,-200,170,280,1500],[0,1100,-20,500,300]],"scarp":{"z":790,"height":48,"edge":150,"amplitude":12,"wavelength":420}},
 "regions":[{"name":"Slatefall Top","position":start},{"name":"Slatefall Bottom","position":finish},{"name":"Quarry Road","position":[0,-560]},{"name":"The Canyon","position":[-100,-180]}],
 "routes":[
  {"id":"dh","name":"Slatefall Line","points":[],"width":8,"shoulder":4,"extras":False},
  {"id":"road","name":"Quarry road","points":[[-560,-640],[-250,-560],[60,-490],[380,-430],[540,-330],[300,300],[60,560],[-250,620],[-560,700]],"width":7,"shoulder":9,"extras":False},
 ],
 "spots":[
  {"id":"top","name":"Slatefall Top","position":start,"kind":"lookout","radius":20,"about":"The start hut at the top of the Slatefall Line."},
  {"id":"bottom","name":"Slatefall Bottom","position":finish,"kind":"checkpoint","radius":24,"about":"The finish at the bottom of the valley."},
 ],
 "races":[{"id":"slatefall-line","name":"Slatefall Line","route":"dh","type":"point","difficulty":"hard","laps":1,"players":[1,6],"gateRadius":16,"countdown":5,"medalSeconds":None,"description":"Top to bottom down the Slatefall Line."}],
 "interactions":[{"id":"board","name":"Start hut race board","position":[-30,-1010],"kind":"race-board","radius":18,"event":"race.offer","about":"Choose a mini race and invite nearby friends.","cooldownSeconds":10}],
 "ramps":[],"surfaceZones":[],
 "quests":[{"id":"slatefall-welcome","name":"Welcome to Slatefall","start":"top","players":[1,6],"steps":[{"event":"zone.enter","target":"bottom","count":1}],"reward":{"type":"cosmetic-token","amount":1},"repeatable":True}],
 "coordinateSystem":{"units":"metres","horizontal":["x","z"],"up":"y","heading":"radians: 0 points +z; positive rotates towards +x"},
 "status":"Made by hand for the Slatefall Line downhill course (mx.mjs builds it from the corners below).",
 "boundary":{"softMargin":100,"policy":"warn-and-respawn","respawn":"last-safe-pad","cliffWidth":220,"cliffHeight":340,"sceneryApron":1600,"rise":1.0},
 "spawnPads":pads6(start,H),
 "safePads":[
  {"id":"top","position":start,"radius":10,"riderPosition":start},
  {"id":"bottom","position":finish,"radius":24,"riderPosition":finish},
 ],
 "features":{},
 "jumpPark":False,
 "hidden":True,"buildings":False,
 "mx":{"route":"dh","closed":False,"width":8,"shoulder":4,"berm":1.5,"smooth":7,"detailStep":1.25,"paved":"road",
  "corners":corners,"features":FEAT},
}
json.dump(w,open(OUT,'w'),indent=1)
print('ok')
