"""Packs a rigged character glTF binary (.glb) for the web: drops its animation clips and shape keys (the game
poses the skeleton itself), re-saves every texture as a JPEG no bigger than MAX pixels (with macOS `sips`), and
writes a fresh .glb with only the data still used. The mesh, skin and skeleton are kept as they are.
Used for the motocross rider (public/models/moto/rider.glb):
    python3 tools/pack_rider.py 80s_mystery_biker.glb public/models/moto/rider.glb 512"""
import json, struct, sys, subprocess, tempfile, os

src, dst, MAX = sys.argv[1], sys.argv[2], int(sys.argv[3])
b = open(src, 'rb').read()
jl, = struct.unpack('<I', b[12:16])
J = json.loads(b[20:20 + jl])
o = 20 + jl
bl, = struct.unpack('<I', b[o:o + 4])
BIN = b[o + 8:o + 8 + bl]

J.pop('animations', None)
for m in J['meshes']:
    m.pop('weights', None); m.pop('extras', None)
    for p in m['primitives']:
        p.pop('targets', None); p.pop('extras', None)

def raw(view_i):
    v = J['bufferViews'][view_i]; s = v.get('byteOffset', 0)
    return BIN[s:s + v['byteLength']]

# textures -> JPEG
images = []
with tempfile.TemporaryDirectory() as tmp:
    for k, im in enumerate(J.get('images', [])):
        pin = os.path.join(tmp, f'{k}.png'); pout = os.path.join(tmp, f'{k}.jpg')
        open(pin, 'wb').write(raw(im['bufferView']))
        subprocess.run(['sips', '-Z', str(MAX), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', pin, '--out', pout], check=True, capture_output=True)
        images.append(open(pout, 'rb').read())

# keep the buffer views still used (accessors and images), copy their bytes into a new buffer
used = {a['bufferView'] for a in J['accessors'] if 'bufferView' in a}
acc_used = set()
for m in J['meshes']:
    for p in m['primitives']:
        acc_used.update(p['attributes'].values())
        if 'indices' in p: acc_used.add(p['indices'])
for s in J.get('skins', []):
    if 'inverseBindMatrices' in s: acc_used.add(s['inverseBindMatrices'])
acc_map = {}; accessors = []
for i, a in enumerate(J['accessors']):
    if i in acc_used: acc_map[i] = len(accessors); accessors.append(a)
out = bytearray(); views = []; view_map = {}
def put(data, extra=None):
    while len(out) % 4: out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    if extra: v.update(extra)
    out.extend(data); views.append(v); return len(views) - 1
for a in accessors:
    vi = a['bufferView']
    if vi not in view_map:
        old = J['bufferViews'][vi]
        view_map[vi] = put(raw(vi), {k: old[k] for k in ('byteStride', 'target') if k in old})
    a['bufferView'] = view_map[vi]
for im, data in zip(J.get('images', []), images):
    im['bufferView'] = put(data); im['mimeType'] = 'image/jpeg'; im.pop('name', None)
while len(out) % 4: out.append(0)
J['accessors'] = accessors; J['bufferViews'] = views; J['buffers'] = [{'byteLength': len(out)}]
for m in J['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
        if 'indices' in p: p['indices'] = acc_map[p['indices']]
for s in J.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]

js = json.dumps(J, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(glb)
print(f'{src}: {len(b):,} bytes -> {dst}: {len(glb):,} bytes')
