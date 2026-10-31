"""Packs pine trees made with ez-tree (github.com/dgreenheck/ez-tree, MIT) into one .glb for the open worlds.
The trees are generated in a browser (ez-tree's Tree with its 'Pine Medium' preset, a few seeds and fewer sections and
needles so a forest stays light) and saved as JSON: [{bark: {p, n, uv, i}, leaves: {p, n, uv, i}}, ...]. This scales
them to metres and writes meshes pine<k>_bark and pine<k>_leaves with ez-tree's pine bark (colour and normal map,
JPEG) and pine needle texture (PNG with its see-through parts), shrunk to MAX pixels with macOS `sips`. Six trees:
three, then far-away versions of the same three (pine<k>_far_bark / _leaves: simpler branches, fewer bigger needles).
    python3 tools/pack_trees.py trees.json eztree-assets/ public/models/nature/pines.glb 0.34 512
Bushes the same way (ez-tree's Bush presets with ash leaves and oak bark; meshes bush<k>[_far]_bark / _leaves):
    python3 tools/pack_trees.py bushes.json eztree-assets/ public/models/nature/bushes.glb 0.055 512 bush
And aspens (ez-tree's Aspen Medium: birch bark, aspen leaves; meshes aspen<k>[_far]_bark / _leaves):
    python3 tools/pack_trees.py aspens.json eztree-assets/ public/models/nature/aspens.glb 0.26 512 aspen
And the open worlds' leafy trees (ez-tree's Oak Medium, Oak Large and Ash Medium, all with oak bark and leaves; meshes
oak<k>[_far]_bark / _leaves; tools/eztree_gen.html makes the JSON):
    python3 tools/pack_trees.py oaks.json eztree-assets/ public/models/nature/oaks.glb 0.16 512 oak"""
import json, os, struct, subprocess, sys, tempfile
from array import array

src, assets, dst, scale, MAX = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), int(sys.argv[5])
KIND = sys.argv[6] if len(sys.argv) > 6 else 'pine'
TEX = {'pine': ('pine_color_1k.jpg', 'pine_normal_1k.jpg', 'pine_color.png'), 'bush': ('oak_color_1k.jpg', 'oak_normal_1k.jpg', 'ash_color.png'),
       'aspen': ('birch_color_1k.jpg', 'birch_normal_1k.jpg', 'aspen_color.png'), 'oak': ('oak_color_1k.jpg', 'oak_normal_1k.jpg', 'oak_color.png')}[KIND]
trees = json.load(open(src))
images = {}
with tempfile.TemporaryDirectory() as tmp:
    for k, (name, fmt) in {'bark': (TEX[0], 'jpeg'), 'barkN': (TEX[1], 'jpeg'), 'leaf': (TEX[2], 'png')}.items():
        o = os.path.join(tmp, k + '.' + ('jpg' if fmt == 'jpeg' else 'png'))
        subprocess.run(['sips', '-Z', str(MAX), '-s', 'format', fmt] + (['-s', 'formatOptions', '80'] if fmt == 'jpeg' else []) + [os.path.join(assets, name), '--out', o], check=True, capture_output=True)
        images[k] = (open(o, 'rb').read(), 'image/' + fmt)

out = bytearray(); views = []; accessors = []


def put(data, target=None):
    while len(out) % 4: out.append(0)
    v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
    if target: v['target'] = target
    out.extend(data); views.append(v); return len(views) - 1


def acc(values, n, ctype, kind, target, mm=False):
    arr = array('f' if ctype == 5126 else ('H' if ctype == 5123 else 'I'), values)
    a = {'bufferView': put(arr.tobytes(), target), 'componentType': ctype, 'count': len(values) // n, 'type': kind}
    if mm: a['min'] = [min(values[i::n]) for i in range(n)]; a['max'] = [max(values[i::n]) for i in range(n)]
    accessors.append(a); return len(accessors) - 1


G = {'asset': {'version': '2.0', 'generator': 'party-arcade pack_trees.py (trees by ez-tree)'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
     'images': [], 'textures': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]}
tex = {}
for k, (data, mime) in images.items():
    G['images'].append({'bufferView': put(data), 'mimeType': mime}); G['textures'].append({'source': len(G['images']) - 1, 'sampler': 0}); tex[k] = len(G['textures']) - 1
G['materials'] = [
    {'name': 'bark', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex['bark']}, 'metallicFactor': 0, 'roughnessFactor': 0.95}, 'normalTexture': {'index': tex['barkN']}},
    {'name': 'needles' if KIND == 'pine' else 'leaves', 'pbrMetallicRoughness': {'baseColorTexture': {'index': tex['leaf']}, 'metallicFactor': 0, 'roughnessFactor': 0.85}, 'alphaMode': 'MASK', 'alphaCutoff': 0.4, 'doubleSided': True},
]
for k, t in enumerate(trees):
    for part, mat in (('bark', 0), ('leaves', 1)):
        g = t[part]
        pos = [v * scale for v in g['p']]
        n = len(pos) // 3
        prim = {'attributes': {'POSITION': acc(pos, 3, 5126, 'VEC3', 34962, True), 'NORMAL': acc(g['n'], 3, 5126, 'VEC3', 34962), 'TEXCOORD_0': acc(g['uv'], 2, 5126, 'VEC2', 34962)},
                'indices': acc(g['i'], 1, 5123 if n < 65536 else 5125, 'SCALAR', 34963), 'material': mat}
        name = f'{KIND}{k % 3}{"_far" if k >= 3 else ""}_{part}'   # (trees 3-5: the far versions of 0-2)
        G['meshes'].append({'name': name, 'primitives': [prim]})
        G['nodes'].append({'name': name, 'mesh': len(G['meshes']) - 1}); G['scenes'][0]['nodes'].append(len(G['nodes']) - 1)
        print(f'{name}: {len(g["i"]) // 3} triangles, height {max(pos[1::3]):.1f} m')
while len(out) % 4: out.append(0)
G['bufferViews'] = views; G['accessors'] = accessors; G['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(G, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(glb)
print(f'-> {dst}: {len(glb):,} bytes')
