"""Shrinks a glTF binary (.glb) for the web: bakes every node's transform into its mesh, keeps each part's
name (the nearest named node above it), then merges vertices that land in the same small grid cell, the same
rough direction and the same rough texture spot (vertex clustering). Materials and textures are kept as they are.
Used for the Stark Varg bike (public/models/moto/stark-varg.glb: 1 017 444 -> 89 765 triangles):
    python3 tools/shrink_glb.py stark_varg_sm.glb public/models/moto/stark-varg.glb 0.04
(the last number is the cell size in the model's own units)."""
import json, struct, sys, math
from array import array

src, dst, cell = sys.argv[1], sys.argv[2], float(sys.argv[3])
b = open(src, 'rb').read()
jl, = struct.unpack('<I', b[12:16])
J = json.loads(b[20:20 + jl])
o = 20 + jl
bl, = struct.unpack('<I', b[o:o + 4])
BIN = b[o + 8:o + 8 + bl]

def view(acc_i):
    a = J['accessors'][acc_i]; v = J['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    ct = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', 0)
    size = struct.calcsize(ct)
    if stride and stride != n * size:
        out = array(ct)
        for k in range(a['count']):
            out.frombytes(BIN[start + k * stride:start + k * stride + n * size])
        return out, n
    out = array(ct); out.frombytes(BIN[start:start + a['count'] * n * size]); return out, n

def matmul(A, B):  # column-major 4x4
    return [sum(A[r + 4 * k] * B[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]
def local(n):
    if 'matrix' in n: return n['matrix']
    t = n.get('translation', [0, 0, 0]); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
    for c in range(3):
        for r in range(3): R[r + 4 * c] *= s[c]
    R[12], R[13], R[14] = t
    return R
I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
worlds = []
def walk(i, M, label):
    n = J['nodes'][i]; W = matmul(M, local(n))
    nm = n.get('name') or ''
    if nm and not nm.startswith('Object_'): label = nm
    if 'mesh' in n: worlds.append((n['mesh'], W, label))
    for c in n.get('children', []): walk(c, W, label)
for r in J['scenes'][J.get('scene', 0)]['nodes']: walk(r, I4, '')

out_bin = bytearray(); views = []; accs = []; meshes = []; nodes = []
def add_view(data, target):
    while len(out_bin) % 4: out_bin.append(0)
    views.append({'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data), **({'target': target} if target else {})})
    out_bin.extend(data); return len(views) - 1
tot_in = tot_out = 0
for mi, W, name in worlds:
    prims = []
    for p in J['meshes'][mi]['primitives']:
        pos, _ = view(p['attributes']['POSITION'])
        nor = view(p['attributes']['NORMAL'])[0] if 'NORMAL' in p['attributes'] else None
        uv = view(p['attributes']['TEXCOORD_0'])[0] if 'TEXCOORD_0' in p['attributes'] else None
        idx = view(p['indices'])[0] if 'indices' in p else array('I', range(len(pos) // 3))
        nv = len(pos) // 3
        # bake the transform
        P = [0.0] * (nv * 3); N = [0.0] * (nv * 3) if nor else None
        for k in range(nv):
            x, y, z = pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]
            P[3 * k] = W[0] * x + W[4] * y + W[8] * z + W[12]
            P[3 * k + 1] = W[1] * x + W[5] * y + W[9] * z + W[13]
            P[3 * k + 2] = W[2] * x + W[6] * y + W[10] * z + W[14]
            if nor:
                a, bb, c = nor[3 * k], nor[3 * k + 1], nor[3 * k + 2]
                nx = W[0] * a + W[4] * bb + W[8] * c; ny = W[1] * a + W[5] * bb + W[9] * c; nz = W[2] * a + W[6] * bb + W[10] * c
                l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
                N[3 * k], N[3 * k + 1], N[3 * k + 2] = nx / l, ny / l, nz / l
        # cluster: same cell, roughly the same way round, roughly the same texture spot
        key_of = {}; remap = [0] * nv; acc = []
        for k in range(nv):
            key = (math.floor(P[3 * k] / cell), math.floor(P[3 * k + 1] / cell), math.floor(P[3 * k + 2] / cell))
            if N: key += (round(N[3 * k] * 0.7), round(N[3 * k + 1] * 0.7), round(N[3 * k + 2] * 0.7))
            if uv: key += (round(uv[2 * k] * 3), round(uv[2 * k + 1] * 3))
            j = key_of.get(key)
            if j is None:
                j = len(acc); key_of[key] = j; acc.append([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0])
            s = acc[j]; s[0] += P[3 * k]; s[1] += P[3 * k + 1]; s[2] += P[3 * k + 2]
            if N: s[3] += N[3 * k]; s[4] += N[3 * k + 1]; s[5] += N[3 * k + 2]
            if uv: s[6] += uv[2 * k]; s[7] += uv[2 * k + 1]
            s[8] += 1; remap[k] = j
        tris = array('I'); seen = set()
        for t in range(0, len(idx) - 2, 3):
            a, bb, c = remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]
            if a == bb or bb == c or a == c: continue
            kk = (a, bb, c)
            if kk in seen: continue
            seen.add(kk); tris.extend(kk)
        tot_in += len(idx) // 3; tot_out += len(tris) // 3
        if not len(tris): continue
        # keep only used vertices
        used = {}; P2 = array('f'); N2 = array('f'); U2 = array('f'); T2 = array('I')
        for v in tris:
            u = used.get(v)
            if u is None:
                u = len(used); used[v] = u; s = acc[v]; n = s[8]
                P2.extend((s[0] / n, s[1] / n, s[2] / n))
                if N:
                    l = math.sqrt(s[3] ** 2 + s[4] ** 2 + s[5] ** 2) or 1
                    N2.extend((s[3] / l, s[4] / l, s[5] / l))
                if uv: U2.extend((s[6] / n, s[7] / n))
            T2.append(u)
        cnt = len(used)
        mn = [min(P2[i::3]) for i in range(3)]; mx = [max(P2[i::3]) for i in range(3)]
        attrs = {}
        attrs['POSITION'] = len(accs); accs.append({'bufferView': add_view(P2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC3', 'min': mn, 'max': mx})
        if N: attrs['NORMAL'] = len(accs); accs.append({'bufferView': add_view(N2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC3'})
        if uv: attrs['TEXCOORD_0'] = len(accs); accs.append({'bufferView': add_view(U2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC2'})
        if cnt < 65536:
            ib = array('H', T2).tobytes(); ct = 5123
        else:
            ib = T2.tobytes(); ct = 5125
        ia = len(accs); accs.append({'bufferView': add_view(ib, 34963), 'componentType': ct, 'count': len(T2), 'type': 'SCALAR'})
        prim = {'attributes': attrs, 'indices': ia}
        if 'material' in p: prim['material'] = p['material']
        prims.append(prim)
    if prims:
        meshes.append({'name': name or f'part{mi}', 'primitives': prims})
        nodes.append({'name': name or f'part{mi}', 'mesh': len(meshes) - 1})
# images: copy their bytes over
images = []
for im in J.get('images', []):
    v = J['bufferViews'][im['bufferView']]
    data = BIN[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    images.append({'mimeType': im['mimeType'], 'bufferView': add_view(data, None)})
while len(out_bin) % 4: out_bin.append(0)
out = {'asset': {'version': '2.0', 'generator': 'party-arcade decimate.py', 'extras': J['asset'].get('extras', {})},
       'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
       'materials': J.get('materials', []), 'textures': J.get('textures', []), 'samplers': J.get('samplers', []), 'images': images,
       'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(out_bin)}]}
if 'extensionsUsed' in J: out['extensionsUsed'] = J['extensionsUsed']
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out_bin)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out_bin), b'BIN\0') + bytes(out_bin)
open(dst, 'wb').write(glb)
print(f'triangles {tot_in} -> {tot_out}, file {len(glb) / 1e6:.2f} MB, parts {len(nodes)}')
