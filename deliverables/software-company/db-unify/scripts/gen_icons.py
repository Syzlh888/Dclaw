"""Generate DBeaver-style app icons for DClaw."""
import struct, zlib, os
from xml.dom import minidom

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <rect x="38" y="160" width="180" height="64" rx="24" fill="#2DA0D0"/>
  <rect x="38" y="152" width="180" height="24" rx="12" fill="#4DB8E6"/>
  <rect x="48" y="96" width="160" height="64" rx="24" fill="#3CA8D8"/>
  <rect x="48" y="88" width="160" height="24" rx="12" fill="#5CC2F0"/>
  <rect x="58" y="32" width="140" height="64" rx="24" fill="#4DB8E6"/>
  <rect x="58" y="24" width="140" height="24" rx="12" fill="#6CC8F0"/>
  <rect x="66" y="40" width="24" height="16" rx="8" fill="rgba(255,255,255,0.4)"/>
  <rect x="66" y="104" width="24" height="16" rx="8" fill="rgba(255,255,255,0.35)"/>
  <rect x="66" y="168" width="24" height="16" rx="8" fill="rgba(255,255,255,0.3)"/>
</svg>'''

def parse_fill(s):
    s = s.strip()
    if s.startswith('rgba'):
        p = s.replace('rgba(','').replace(')','').split(',')
        return (int(float(p[0])), int(float(p[1])), int(float(p[2])), float(p[3]))
    s = s.lstrip('#')
    r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    return (r, g, b, 1.0)

def render(size):
    doc = minidom.parseString(SVG)
    buf = [0.0] * (size * size * 4)
    rects = doc.getElementsByTagName('rect')
    s = size / 256.0
    for rect in rects:
        x = float(rect.getAttribute('x')) * s
        y = float(rect.getAttribute('y')) * s
        w = float(rect.getAttribute('width')) * s
        h = float(rect.getAttribute('height')) * s
        rx = float(rect.getAttribute('rx') or '0') * s
        r, g, b, a = parse_fill(rect.getAttribute('fill'))
        x0, x1 = int(max(0, x)), int(min(size, x + w))
        y0, y1 = int(max(0, y)), int(min(size, y + h))
        rr = int(round(rx))
        if rr < 0: rr = 0
        for py in range(y0, y1):
            for px in range(x0, x1):
                if rr > 0:
                    dl = px - x0 < rr
                    dr = x1 - px - 1 < rr
                    dt = py - y0 < rr
                    db = y1 - py - 1 < rr
                    if (dl and dt) or (dr and dt) or (dl and db) or (dr and db):
                        cx = x0 + rr - 0.5 if dl else (x1 - rr - 0.5 if dr else px)
                        cy = y0 + rr - 0.5 if dt else (y1 - rr - 0.5 if db else py)
                        dx = px - cx
                        dy = py - cy
                        if dx * dx + dy * dy > rr * rr:
                            continue
                idx = (py * size + px) * 4
                pr, pg, pb, pa = buf[idx:idx+4]
                na = a + pa * (1.0 - a)
                if na > 1e-6:
                    buf[idx+0] = (r * a + pr * pa * (1.0 - a)) / na
                    buf[idx+1] = (g * a + pg * pa * (1.0 - a)) / na
                    buf[idx+2] = (b * a + pb * pa * (1.0 - a)) / na
                    buf[idx+3] = na
    doc.unlink()
    # Convert to BGRA bytes
    data = bytearray()
    row_pad = (4 - (size * 4) % 4) % 4
    for y in range(size - 1, -1, -1):
        for x in range(size):
            idx = (y * size + x) * 4
            # Clamp values safely
            rr = max(0, min(255, int(buf[idx+2] + 0.5)))
            gg = max(0, min(255, int(buf[idx+1] + 0.5)))
            bb = max(0, min(255, int(buf[idx+0] + 0.5)))
            aa = max(0, min(255, int(buf[idx+3] * 255.0 + 0.5)))
            data.extend([rr, gg, bb, aa])
        data.extend(b'\x00' * row_pad)
    return bytes(data)

def make_ico(sizes):
    header = struct.pack('<HHH', 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b''
    bodies = b''
    for sz in sizes:
        pixels = render(sz)
        # ICO entry: BYTE for width/height, 0 means 256
        ico_sz = 0 if sz >= 256 else sz
        bih = struct.pack('<IiiHHIIiiII', 40, sz, sz*2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
        blob = bih + pixels
        entries += struct.pack('<BBBBHHII', ico_sz, ico_sz, 0, 0, 1, 32, len(blob), offset)
        bodies += blob
        offset += len(blob)
    return header + entries + bodies

def make_png(size):
    pixels = render(size)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter none
        row_start = (size - 1 - y) * size * 4
        for x in range(size):
            i = row_start + x * 4
            raw.extend([
                pixels[i+2],  # R
                pixels[i+1],  # G
                pixels[i+0],  # B
                pixels[i+3],  # A
            ])

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw)))
            + chunk(b'IEND', b''))

BASE = r'D:\Work Space\DClaw\deliverables\software-company\db-unify\build'
os.makedirs(BASE, exist_ok=True)

ico = make_ico([16, 24, 32, 48, 64, 128, 256])
with open(os.path.join(BASE, 'icon.ico'), 'wb') as f:
    f.write(ico)
print(f'icon.ico: {len(ico)} bytes')

png = make_png(256)
with open(os.path.join(BASE, 'icon.png'), 'wb') as f:
    f.write(png)
print(f'icon.png: {len(png)} bytes')

print('ALL DONE')
