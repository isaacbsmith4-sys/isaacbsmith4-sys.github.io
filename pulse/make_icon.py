"""Draws the Pulse icon (a white core firing a cyan shockwave that scatters red enemy shards) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT = (22, 14, 48), (3, 3, 8)
CYAN, RED, VIOLET = (124, 247, 255), (255, 77, 94), (182, 124, 255)
# enemies flung outward by the wave: (x, y, size, color)
FOES = [(.17, .22, .055, RED), (.84, .30, .045, (255, 170, 60)), (.80, .82, .07, VIOLET), (.18, .78, .05, RED)]


def tri(u, v, cx, cy, s, rot):
    # inside a rotated triangle centered on (cx, cy)
    pts = [(cx + s * math.cos(rot + k * 2.094), cy + s * math.sin(rot + k * 2.094)) for k in range(3)]
    def side(a, b): return (b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])
    d = [side(pts[i], pts[(i + 1) % 3]) for i in range(3)]
    return all(x >= 0 for x in d) or all(x <= 0 for x in d)


def pixel(u, v):
    c = [a + (b - a) * v for a, b in zip(TOP, BOT)]
    d = math.hypot(u - .5, v - .5)
    # two shockwave rings
    for r, w, k in ((.33, .022, 1.0), (.22, .014, .55)):
        e = abs(d - r)
        if e < w * 2.5:
            f = max(0, 1 - e / (w * 2.5)) ** 1.6 * k
            c = [min(255, a + b * f) for a, b in zip(c, CYAN)]
    # core glow + core
    if d < .2:
        f = (1 - d / .2) ** 2 * .7
        c = [min(255, a + b * f) for a, b in zip(c, (170, 250, 255))]
    if d < .075:
        return (255, 255, 255)
    for x, y, s, col in FOES:
        if tri(u, v, x, y, s, math.atan2(y - .5, x - .5)):
            return col
        g = math.hypot(u - x, v - y)
        if g < s * 2.4:
            f = (1 - g / (s * 2.4)) ** 2 * .45
            c = [min(255, a + b * f) for a, b in zip(c, col)]
    return tuple(round(x) for x in c)


def png(n, path, ss=2):
    rows = b""
    for y in range(n):
        row = bytearray([0])
        for x in range(n):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = pixel((x + (sx + .5) / ss) / n, (y + (sy + .5) / ss) / n)
                    for i in range(3):
                        acc[i] += c[i]
            row += bytes(round(a / ss / ss) for a in acc)
        rows += bytes(row)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    for n, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        png(n, os.path.join(HERE, name))
