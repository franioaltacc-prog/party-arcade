"""Packs a scanned nature model (a Poly Haven .gltf with its .bin and textures beside it) into one small .glb for the
open worlds: each mesh in the scene becomes its own mesh (named after its node), moved so its middle is over the
origin (the ground stays at y = 0), scaled to metres, and made much lighter by merging the vertices that land in the
same small cell (the cell is the mesh's longest side / DETAIL; vertices on either side of a texture seam stay apart).
The colour and normal textures are kept (shrunk to MAX pixels, saved as JPEG with macOS `sips`): they carry the detail.
    python3 tools/pack_nature.py rock_moss_set_01/main.gltf public/models/nature/rocks-moss.glb 1 24 512
    (args: source .gltf, output .glb, scale to metres, DETAIL, MAX; optional: comma-separated node names to keep)"""
import json, math, os, struct, subprocess, sys, tempfile
from array import array

src, dst, scale, detail, MAX = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
keep = set(sys.argv[6].split(',')) if len(sys.argv) > 6 else None
base = os.path.dirname(src)
J = json.load(open(src))
BUF = [open(os.path.join(base, b['uri']), 'rb').read() for b in J['buffers']]


def view(acc_i):
    a = J['accessors'][acc_i]; v = J['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    ct = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
    data = BUF[v['buffer']]; start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = struct.calcsize(ct); stride = v.get('byteStride', 0) or n * size
    out = array(ct)
    if stride != n * size:
        for k in range(a['count']): out.frombytes(data[start + k * stride:start + k * stride + n * size])
    else: out.frombytes(data[start:start + a['count'] * n * size])
    return out, n


def node_scale(n):
    s = n.get('scale', [1, 1, 1]); return s


meshes = []   # (name, positions, uvs, indices)
for n in J['nodes']:
    if 'mesh' not in n or (keep and n.get('name') not in keep): continue
    sx, sy, sz = node_scale(n)
    for p in J['meshes'][n['mesh']]['primitives']:
        P, _ = view(p['attributes']['POSITION']); UV, _ = view(p['attributes']['TEXCOORD_0']); I, _ = view(p['indices'])
        pts = [(P[i] * sx * scale, P[i + 1] * sy * scale, P[i + 2] * sz * scale) for i in range(0, len(P), 3)]
        meshes.append((n.get('name', 'mesh'), pts, [(UV[i], UV[i + 1]) for i in range(0, len(UV), 2)], list(I)))

out_meshes = []
for name, pts, uvs, idx in meshes:
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    side = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)); cell = side / detail
    # merge vertices that share a cell (and a patch of texture: a seam's two sides keep their own texture spots)
    key_of, groups = {}, []
    remap = []
    for p, uv in zip(pts, uvs):
        k = (math.floor(p[0] / cell), math.floor(p[1] / cell), math.floor(p[2] / cell), math.floor(uv[0] * detail / 2), math.floor(uv[1] * detail / 2))
        g = key_of.get(k)
        if g is None:
            g = key_of[k] = len(groups); groups.append([0, 0, 0, 0, 0, 0, k[:3]])
        acc = groups[g]; acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; acc[3] += uv[0]; acc[4] += uv[1]; acc[5] += 1
        remap.append(g)
    V = [((a[0] / a[5]) - cx, a[1] / a[5], (a[2] / a[5]) - cz) for a in groups]
    T = [(a[3] / a[5], a[4] / a[5]) for a in groups]
    tris, seen = [], set()
    for i in range(0, len(idx), 3):
        a, b, c = remap[idx[i]], remap[idx[i + 1]], remap[idx[i + 2]]
        if a == b or b == c or a == c: continue
        k = tuple(sorted((a, b, c)))
        if k in seen: continue
        seen.add(k); tris.append((a, b, c))
    # smooth normals, shared across texture seams (by position cell)
    acc_n = {}
    for a, b, c in tris:
        A, B, Cc = V[a], V[b], V[c]
        u = (B[0] - A[0], B[1] - A[1], B[2] - A[2]); v = (Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        for g in (a, b, c):
            s = acc_n.setdefault(groups[g][6], [0, 0, 0]); s[0] += n[0]; s[1] += n[1]; s[2] += n[2]
    N = []
    for g in groups:
        s = acc_n.get(g[6], [0, 1, 0]); l = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2) or 1
        N.append((s[0] / l, s[1] / l, s[2] / l))
    out_meshes.append((name, V, N, T, tris))
    print(f'{name}: {len(idx) // 3} -> {len(tris)} triangles, {len(V)} vertices, size {side:.2f} m')

# textures: the first material's colour and normal maps
mat = J['materials'][0]; pbr = mat.get('pbrMetallicRoughness', {})
tex_uri = lambda t: J['images'][J['textures'][t['index']]['source']]['uri']
maps = {'color': tex_uri(pbr['baseColorTexture'])}
if 'normalTexture' in mat: maps['normal'] = tex_uri(mat['normalTexture'])
images = {}
with tempfile.TemporaryDirectory() as tmp:
    for k, uri in maps.items():
        o = os.path.join(tmp, k + '.jpg')
        subprocess.run(['sips', '-Z', str(MAX), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', os.path.join(base, uri), '--out', o], check=True, capture_output=True)
        images[k] = open(o, 'rb').read()

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


G = {'asset': {'version': '2.0', 'generator': 'party-arcade pack_nature.py'}, 'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': []}
img_i = {}
G['images'] = []; G['textures'] = []; G['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
for k, data in images.items():
    G['images'].append({'bufferView': put(data), 'mimeType': 'image/jpeg'}); G['textures'].append({'source': len(G['images']) - 1, 'sampler': 0}); img_i[k] = len(G['textures']) - 1
m = {'name': mat.get('name', 'nature'), 'pbrMetallicRoughness': {'baseColorTexture': {'index': img_i['color']}, 'metallicFactor': 0, 'roughnessFactor': 0.9}}
if 'normal' in img_i: m['normalTexture'] = {'index': img_i['normal']}
if mat.get('doubleSided'): m['doubleSided'] = True
if mat.get('alphaMode'): m['alphaMode'] = mat['alphaMode']; m['alphaCutoff'] = mat.get('alphaCutoff', 0.5)
G['materials'] = [m]
for name, V, N, T, tris in out_meshes:
    pos = [c for p in V for c in p]; nor = [c for p in N for c in p]; uv = [c for p in T for c in p]; ind = [i for t in tris for i in t]
    prim = {'attributes': {'POSITION': acc(pos, 3, 5126, 'VEC3', 34962, True), 'NORMAL': acc(nor, 3, 5126, 'VEC3', 34962), 'TEXCOORD_0': acc(uv, 2, 5126, 'VEC2', 34962)},
            'indices': acc(ind, 1, 5123 if len(V) < 65536 else 5125, 'SCALAR', 34963), 'material': 0}
    G['meshes'].append({'name': name, 'primitives': [prim]})
    G['nodes'].append({'name': name, 'mesh': len(G['meshes']) - 1}); G['scenes'][0]['nodes'].append(len(G['nodes']) - 1)
while len(out) % 4: out.append(0)
G['bufferViews'] = views; G['accessors'] = accessors; G['buffers'] = [{'byteLength': len(out)}]
js = json.dumps(G, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
open(dst, 'wb').write(glb)
print(f'-> {dst}: {len(glb):,} bytes')
