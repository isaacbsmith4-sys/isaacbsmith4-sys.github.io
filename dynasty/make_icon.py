"""Draws the Dynasty icon (an orange basketball over a dark court with a gold star) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG_TOP, BG_BOT = (24, 26, 34), (8, 9, 13)
BALL, SEAM, GOLD = (240, 138, 36), (60, 28, 8), (255, 211, 77)


def star(u, v, cx, cy, R, r):
    a = math.atan2(v - cy, u - cx) + math.pi / 2
    d = math.hypot(u - cx, v - cy)
    k = (a % (2 * math.pi / 5)) / (2 * math.pi / 5)
    edge = r + (R - r) * abs(1 - 2 * k)
    return d < edge


def pixel(u, v):
    c = [a + (b - a) * v for a, b in zip(BG_TOP, BG_BOT)]
    # court arc
    if abs(math.hypot(u - .5, v - 1.05) - .48) < .008:
        c = [x + 40 for x in c]
    cx, cy, R = .5, .52, .3
    d = math.hypot(u - cx, v - cy)
    if d < R:
        shade = 1 - .35 * ((u - cx + .1) ** 2 + (v - cy + .1) ** 2) / (R * R)
        col = [x * shade for x in BALL]
        x, y = (u - cx) / R, (v - cy) / R
        seams = abs(x) < .035 or abs(y) < .035 or abs(math.hypot(x - 1.25, y) - .95) < .035 or abs(math.hypot(x + 1.25, y) - .95) < .035
        return tuple(round(t) for t in (SEAM if seams else col))
    if d < R + .05:
        g = (1 - (d - R) / .05) ** 2 * .35
        c = [min(255, a + b * g) for a, b in zip(c, BALL)]
    if star(u, v, .78, .2, .09, .037):
        return GOLD
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
