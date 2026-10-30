"""Packs a rigged character (a .glb, e.g. one of Quaternius's CC0 characters) for the game's riders: its animations are
dropped (the game poses the bones itself, every frame) and the file is rewritten with only the data its meshes, skins and
images use. Everything else (the skeleton, materials, skinning) is kept as it is.
    python3 tools/pack_character.py casual.glb public/models/riders/bmx.glb"""
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
n = struct.unpack('<I', data[12:16])[0]
G = json.loads(data[20:20 + n])
bin_start = 20 + n + 8
BIN = data[bin_start:bin_start + struct.unpack('<I', data[20 + n:24 + n])[0]]

G.pop('animations', None)
# the accessors and buffer views still in use
used_acc = set()
for m in G['meshes']:
    for p in m['primitives']:
        used_acc.update(p['attributes'].values())
        if 'indices' in p: used_acc.add(p['indices'])
        for t in p.get('targets', []): used_acc.update(t.values())
for s in G.get('skins', []):
    if 'inverseBindMatrices' in s: used_acc.add(s['inverseBindMatrices'])
used_views = {G['accessors'][a]['bufferView'] for a in used_acc if 'bufferView' in G['accessors'][a]}
used_views |= {im['bufferView'] for im in G.get('images', []) if 'bufferView' in im}

out = bytearray(); view_map = {}; views = []
for i, v in enumerate(G['bufferViews']):
    if i not in used_views: continue
    while len(out) % 4: out.append(0)
    start = v.get('byteOffset', 0)
    nv = {k: x for k, x in v.items() if k != 'byteOffset'}; nv['byteOffset'] = len(out)
    out.extend(BIN[start:start + v['byteLength']])
    view_map[i] = len(views); views.append(nv)
acc_map = {}; accessors = []
for i, a in enumerate(G['accessors']):
    if i not in used_acc: continue
    na = dict(a)
    if 'bufferView' in na: na['bufferView'] = view_map[na['bufferView']]
    acc_map[i] = len(accessors); accessors.append(na)
for m in G['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: acc_map[x] for k, x in p['attributes'].items()}
        if 'indices' in p: p['indices'] = acc_map[p['indices']]
        if 'targets' in p: p['targets'] = [{k: acc_map[x] for k, x in t.items()} for t in p['targets']]
for s in G.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]
for im in G.get('images', []):
    if 'bufferView' in im: im['bufferView'] = view_map[im['bufferView']]
while len(out) % 4: out.append(0)
G['bufferViews'] = views; G['accessors'] = accessors; G['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(G, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(glb)
print(f'{src} -> {dst}: {len(data):,} -> {len(glb):,} bytes')
