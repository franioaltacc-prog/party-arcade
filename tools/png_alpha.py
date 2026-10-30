"""Joins a colour texture and a separate see-through mask (Poly Haven ships leaves this way: a _diff and an _alpha
image) into one PNG with transparency, shrunk to SIZE pixels square, for leaf and bush models (pack_nature.py keeps a
PNG colour texture's transparency). Pure Python: reads 8- or 16-bit grey, RGB or RGBA PNGs.
    python3 tools/png_alpha.py shrub_02_diff_1k.png shrub_02_alpha_1k.png shrub_02_leaves.png 512"""
import struct, sys, zlib


def read_png(path):
    data = open(path, 'rb').read(); assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    i, idat = 8, b''
    while i < len(data):
        n, kind = struct.unpack('>I4s', data[i:i + 8]); body = data[i + 8:i + 8 + n]; i += 12 + n
        if kind == b'IHDR': w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT': idat += body
    assert interlace == 0 and depth in (8, 16), (path, depth, interlace)
    chans = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]; bpp = chans * depth // 8; stride = w * bpp
    raw = zlib.decompress(idat); rows = []; prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride): line[x] = (line[x] + ((line[x - bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line[0::2] if depth == 16 else line); prev = line   # (16-bit: keep the high byte of each sample)
    return w, h, chans, rows


def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    chunk = lambda k, b: struct.pack('>I', len(b)) + k + b + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


color, alpha, dst, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
w, h, cc, crow = read_png(color); aw, ah, ac, arow = read_png(alpha)
assert (w, h) == (aw, ah) and w % size == 0
k = w // size; out = []
for y in range(size):
    line = bytearray(size * 4)
    for x in range(size):
        r = g = b = a = cov = 0
        for dy in range(k):
            cr, ar = crow[y * k + dy], arow[y * k + dy]
            for dx in range(k):
                px = x * k + dx; av = ar[px * ac]
                r += cr[px * cc] * av; g += cr[px * cc + 1] * av; b += cr[px * cc + 2] * av; a += av   # (colour weighted by coverage: no dark fringes)
        n = k * k
        if a: line[x * 4:x * 4 + 3] = bytes((r // a, g // a, b // a))
        line[x * 4 + 3] = a // n
    out.append(line)
# the see-through pixels take their nearest leaf's colour, so a blurry mip level doesn't fade the edges to black
for _ in range(4):
    for y in range(size):
        line = out[y]
        for x in range(size):
            if line[x * 4 + 3] or (line[x * 4] | line[x * 4 + 1] | line[x * 4 + 2]): continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < size and 0 <= ny < size and (out[ny][nx * 4] | out[ny][nx * 4 + 1] | out[ny][nx * 4 + 2]):
                    line[x * 4:x * 4 + 3] = out[ny][nx * 4:nx * 4 + 3]; break
write_png(dst, size, size, out)
print(f'-> {dst}: {size}x{size}')
