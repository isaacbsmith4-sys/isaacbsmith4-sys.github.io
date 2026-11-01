"""Draws the Fuse icon (a copper wire bending through a dark tile grid, lit by a spark, into a TNT block) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG, PLATE = (7, 6, 10), (23, 20, 26)
COPPER, LIT, TNT = (201, 138, 82), (255, 176, 70), (150, 24, 24)
N = 4                      # 4x4 tiles
# the wire runs up from the bottom, turns right, then up into the TNT tile (row 0, col 3)
SEGS = [((1.5, 4.0), (1.5, 2.5)), ((1.5, 2.5), (3.5, 2.5)), ((3.5, 2.5), (3.5, 0.5))]
SPARK = (1.5, 2.9)


def seg_d(px, py, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    k = max(0, min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - a[0] - vx * k, py - a[1] - vy * k)


def pixel(u, v):
    x, y = u * N, v * N
    fx, fy = x % 1, y % 1
    inside = .06 < fx < .94 and .06 < fy < .94
    c = list(PLATE if inside else BG)
    if inside and int(x) == 3 and int(y) == 0:
        c = list(TNT)
    d = min(seg_d(x, y, a, b) for a, b in SEGS)
    # lit up to the spark: the part of the wire below SPARK on the first segment
    lit = seg_d(x, y, (1.5, 4.0), SPARK) < .12
    if d < .12:
        c = list(LIT if lit else COPPER)
    # spark glow
    sd = math.hypot(x - SPARK[0], y - SPARK[1])
    if sd < .9:
        k = (1 - sd / .9) ** 2
        c = [min(255, a + b * k) for a, b in zip(c, (255, 190, 90))]
    if sd < .16:
        return (255, 255, 235)
    return tuple(round(t) for t in c)


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
