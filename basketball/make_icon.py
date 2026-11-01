"""Draws the Basketball app icon (a ball with seams on a hardwood tile) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, BALL, SEAM = (60, 34, 16), (14, 10, 7), (224, 149, 90), (40, 20, 8)
import math


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    dx, dy = u - .5, v - .5
    r = math.hypot(dx, dy)
    if r > .3:
        return bg
    if r > .285:
        return SEAM
    w = .012
    # the seams: one vertical, one horizontal, two side curves
    if abs(dx) < w or abs(dy) < w:
        return SEAM
    for cx in (-.42, .42):
        if abs(math.hypot(u - .5 - cx, dy) - .3) < w:
            return SEAM
    return BALL


def png(n, path, ss=3):
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
