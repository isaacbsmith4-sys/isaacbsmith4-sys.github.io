"""Draws the GAME DAY icon (orange ball with seams on dark) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (6, 8, 12)
BALL = (255, 91, 31)
SEAM = (6, 8, 12)


def pixel(u, v):
    x, y = u - .5, v - .5
    r = (x * x + y * y) ** .5
    if r > .34:
        return BG
    w = .018
    if abs(x) < w or abs(y) < w:                       # cross seams
        return SEAM
    for cx in (-.42, .42):                              # side curves
        if abs(((x - cx) ** 2 + y * y) ** .5 - .3) < w:
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
