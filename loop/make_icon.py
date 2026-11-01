"""Draws the LOOP icon (a cyan-to-pink glowing ribbon closing a loop around three captured dots) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT = (16, 12, 40), (5, 6, 15)
CYAN, VIOLET, PINK = (73, 242, 255), (180, 107, 255), (255, 79, 216)
DOTS = [(.44, .46, (157, 255, 106)), (.58, .52, (255, 77, 109)), (.49, .62, (255, 166, 64))]


def ribbon(t):
    # a loop that crosses itself near the bottom-left, with a tail trailing off
    a = t * 2 * math.pi * 1.08 - .5
    r = .27 + .02 * math.sin(3 * a)
    return .51 + r * math.cos(a), .53 + r * .92 * math.sin(a)


PTS = [ribbon(i / 400) for i in range(401)]


def mix(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def pixel(u, v):
    c = list(mix(TOP, BOT, v))
    # filled glow inside the loop
    d0 = math.hypot(u - .51, (v - .53) / .92)
    if d0 < .27:
        c = [min(255, x + y * .1) for x, y in zip(c, VIOLET)]
    best, bi = 9, 0
    for i in range(0, 401, 2):
        d = (PTS[i][0] - u) ** 2 + (PTS[i][1] - v) ** 2
        if d < best:
            best, bi = d, i
    d = math.sqrt(best)
    k = bi / 400
    col = mix(PINK, VIOLET, k * 2) if k < .5 else mix(VIOLET, CYAN, (k - .5) * 2)
    w = .008 + .02 * k
    if d < w:
        return tuple(round(x) for x in col)
    if d < w + .05:
        g = (1 - (d - w) / .05) ** 2 * .55
        c = [min(255, x + y * g) for x, y in zip(c, col)]
    # head
    hx, hy = PTS[-1]
    hd = math.hypot(u - hx, v - hy)
    if hd < .03:
        return (255, 255, 255)
    for x, y, col in DOTS:
        dd = math.hypot(u - x, v - y)
        if dd < .035:
            return col
        if dd < .08:
            g = (1 - dd / .08) ** 2 * .4
            c = [min(255, a + b * g) for a, b in zip(c, col)]
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
