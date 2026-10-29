"""Gets a bicycle model file (.glb) ready for the game: bakes every node's transform into its mesh, turns it so the
bike points along +Z with Y up, and splits it into the parts that move: each loose piece of the mesh (everything
joined to it) goes to the first part whose circle (seen from the side, in the turned model's units) it fits
(its outline fits in the circle's square): the front wheel, the rear wheel or the cranks; anything else stays with the frame ("Body"). A model that
already has named parts keeps them (the rules only sort its unnamed pieces). Then, like shrink_glb.py, vertices
that land in the same small cell are merged, so the file is smaller. Textures are kept as they are (pack the
result with pack_rider.py to shrink them).
Used for the Unrevvd mountain bikes (public/models/mtb/):
    python3 tools/split_bike.py mtb_mongoose_tyax.glb tyax-split.glb 0.35 '{"turn": 90, "Wheel_F": [0, 0, 46],
        "Wheel_R": [-141.3, 0, 46], "Crank": [-86.1, -5.3, 30]}'
  (turn: degrees round Y; each rule: [z, y, radius] of a circle seen from the side, after turning)
    python3 tools/split_bike.py low-_poly_bicycle__5.glb downhill-split.glb 0.004 '{"turn": 0}'"""
import json, struct, sys, math
from array import array

src, dst, cell = sys.argv[1], sys.argv[2], float(sys.argv[3])
opts = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
turn = math.radians(opts.pop('turn', 0))
rules = list(opts.items())   # [(name, [z, y, r])]
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
    out = array(ct)
    if stride and stride != n * size:
        for k in range(a['count']):
            out.frombytes(BIN[start + k * stride:start + k * stride + n * size])
        return out
    out.frombytes(BIN[start:start + a['count'] * n * size]); return out


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


c, s = math.cos(turn), math.sin(turn)
TURN = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]   # round Y
worlds = []


def walk(i, M, label):
    n = J['nodes'][i]; W = matmul(M, local(n))
    nm = n.get('name') or ''
    if nm and not nm.startswith('Object_'): label = nm
    if 'mesh' in n: worlds.append((n['mesh'], W, label))
    for ch in n.get('children', []): walk(ch, W, label)


for r in J['scenes'][J.get('scene', 0)]['nodes']: walk(r, TURN, '')
named = {lab for _, _, lab in worlds}

# ---------------------------------------------------------------- bake, sort the loose pieces into parts
parts = {}   # name -> list of (P, N, uv, triangles, material)
for mi, W, label in worlds:
    for p in J['meshes'][mi]['primitives']:
        pos = view(p['attributes']['POSITION'])
        nor = view(p['attributes']['NORMAL']) if 'NORMAL' in p['attributes'] else None
        uv = view(p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else None
        idx = view(p['indices']) if 'indices' in p else array('I', range(len(pos) // 3))
        nv = len(pos) // 3
        P = [0.0] * (nv * 3); N = [0.0] * (nv * 3) if nor else None
        for k in range(nv):
            x, y, z = pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]
            P[3 * k] = W[0] * x + W[4] * y + W[8] * z + W[12]
            P[3 * k + 1] = W[1] * x + W[5] * y + W[9] * z + W[13]
            P[3 * k + 2] = W[2] * x + W[6] * y + W[10] * z + W[14]
            if nor:
                a, bb, cc = nor[3 * k], nor[3 * k + 1], nor[3 * k + 2]
                nx = W[0] * a + W[4] * bb + W[8] * cc; ny = W[1] * a + W[5] * bb + W[9] * cc; nz = W[2] * a + W[6] * bb + W[10] * cc
                l = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
                N[3 * k], N[3 * k + 1], N[3 * k + 2] = nx / l, ny / l, nz / l
        # loose pieces: vertices joined by a triangle, or sitting on the same spot (texture seams split them)
        par = list(range(nv))

        def find(v):
            while par[v] != v:
                par[v] = par[par[v]]; v = par[v]
            return v
        spot = {}
        for k in range(nv):
            key = (round(P[3 * k], 3), round(P[3 * k + 1], 3), round(P[3 * k + 2], 3))
            if key in spot: par[find(k)] = find(spot[key])
            else: spot[key] = k
        for t in range(0, len(idx) - 2, 3):
            a = find(idx[t]); par[find(idx[t + 1])] = a; par[find(idx[t + 2])] = a
        box = {}
        for v in range(nv):
            r = find(v); bx = box.setdefault(r, [1e18, 1e18, -1e18, -1e18])
            bx[0] = min(bx[0], P[3 * v + 2]); bx[1] = min(bx[1], P[3 * v + 1]); bx[2] = max(bx[2], P[3 * v + 2]); bx[3] = max(bx[3], P[3 * v + 1])

        def part_of(r):
            if label in named and label not in ('', 'RootNode') and not rules: return label
            z0, y0, z1, y1 = box[r]
            for name, (cz, cy, rad) in rules:
                if max(abs(z0 - cz), abs(z1 - cz), abs(y0 - cy), abs(y1 - cy)) <= rad: return name
            return 'Body' if rules else (label or 'Body')
        by_part = {}
        for t in range(0, len(idx) - 2, 3):
            by_part.setdefault(part_of(find(idx[t])), array('I')).extend(idx[t:t + 3])
        for name, tris in by_part.items():
            parts.setdefault(name, []).append((P, N, uv, tris, p.get('material')))

# ---------------------------------------------------------------- merge close vertices, write the parts
out_bin = bytearray(); views = []; accs = []; meshes = []; nodes = []


def add_view(data, target):
    while len(out_bin) % 4: out_bin.append(0)
    views.append({'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data), **({'target': target} if target else {})})
    out_bin.extend(data); return len(views) - 1


tot_in = tot_out = 0
for name, chunks in parts.items():
    prims = []
    for P, N, uv, idx, material in chunks:
        key_of = {}; remap = {}; acc = []
        for k in set(idx):
            key = (math.floor(P[3 * k] / cell), math.floor(P[3 * k + 1] / cell), math.floor(P[3 * k + 2] / cell))
            if N: key += (round(N[3 * k] * 0.7), round(N[3 * k + 1] * 0.7), round(N[3 * k + 2] * 0.7))
            if uv: key += (round(uv[2 * k] * 3), round(uv[2 * k + 1] * 3))
            j = key_of.get(key)
            if j is None:
                j = len(acc); key_of[key] = j; acc.append([0.0] * 8 + [0])
            sm = acc[j]; sm[0] += P[3 * k]; sm[1] += P[3 * k + 1]; sm[2] += P[3 * k + 2]
            if N: sm[3] += N[3 * k]; sm[4] += N[3 * k + 1]; sm[5] += N[3 * k + 2]
            if uv: sm[6] += uv[2 * k]; sm[7] += uv[2 * k + 1]
            sm[8] += 1; remap[k] = j
        tris = array('I'); seen = set()
        for t in range(0, len(idx) - 2, 3):
            a, bb, cc = remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]
            if a == bb or bb == cc or a == cc or (a, bb, cc) in seen: continue
            seen.add((a, bb, cc)); tris.extend((a, bb, cc))
        tot_in += len(idx) // 3; tot_out += len(tris) // 3
        if not len(tris): continue
        used = {}; P2 = array('f'); N2 = array('f'); U2 = array('f'); T2 = array('I')
        for v in tris:
            u = used.get(v)
            if u is None:
                u = len(used); used[v] = u; sm = acc[v]; n = sm[8]
                P2.extend((sm[0] / n, sm[1] / n, sm[2] / n))
                if N:
                    l = math.sqrt(sm[3] ** 2 + sm[4] ** 2 + sm[5] ** 2) or 1
                    N2.extend((sm[3] / l, sm[4] / l, sm[5] / l))
                if uv: U2.extend((sm[6] / n, sm[7] / n))
            T2.append(u)
        cnt = len(used)
        attrs = {'POSITION': len(accs)}
        accs.append({'bufferView': add_view(P2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC3',
                     'min': [min(P2[i::3]) for i in range(3)], 'max': [max(P2[i::3]) for i in range(3)]})
        if N: attrs['NORMAL'] = len(accs); accs.append({'bufferView': add_view(N2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC3'})
        if uv: attrs['TEXCOORD_0'] = len(accs); accs.append({'bufferView': add_view(U2.tobytes(), 34962), 'componentType': 5126, 'count': cnt, 'type': 'VEC2'})
        ib, ct = (array('H', T2).tobytes(), 5123) if cnt < 65536 else (T2.tobytes(), 5125)
        ia = len(accs); accs.append({'bufferView': add_view(ib, 34963), 'componentType': ct, 'count': len(T2), 'type': 'SCALAR'})
        prims.append({'attributes': attrs, 'indices': ia, **({'material': material} if material is not None else {})})
    if prims:
        meshes.append({'name': name, 'primitives': prims}); nodes.append({'name': name, 'mesh': len(meshes) - 1})
images = []
for im in J.get('images', []):
    v = J['bufferViews'][im['bufferView']]
    images.append({'mimeType': im['mimeType'], 'bufferView': add_view(BIN[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']], None)})
while len(out_bin) % 4: out_bin.append(0)
out = {'asset': {'version': '2.0', 'generator': 'party-arcade split_bike.py', 'extras': J['asset'].get('extras', {})},
       'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
       'materials': J.get('materials', []), 'textures': J.get('textures', []), 'samplers': J.get('samplers', []), 'images': images,
       'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(out_bin)}]}
if 'extensionsUsed' in J: out['extensionsUsed'] = J['extensionsUsed']
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out_bin)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(out_bin), b'BIN\0') + bytes(out_bin)
open(dst, 'wb').write(glb)
print(f'triangles {tot_in} -> {tot_out}, file {len(glb) / 1e6:.2f} MB')
for nd, m in zip(nodes, meshes):
    a = [accs[p['attributes']['POSITION']] for p in m['primitives']]
    print(f"  {nd['name']:12s} x {min(x['min'][0] for x in a):8.2f}..{max(x['max'][0] for x in a):8.2f}  y {min(x['min'][1] for x in a):8.2f}..{max(x['max'][1] for x in a):8.2f}  z {min(x['min'][2] for x in a):8.2f}..{max(x['max'][2] for x in a):8.2f}  tris {sum(accs[p['indices']]['count'] for p in m['primitives']) // 3}")
