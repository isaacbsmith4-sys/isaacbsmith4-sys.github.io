"""Draws the Focus app icon (a three-quarter timer ring on a navy tile) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, FG, DIM = (20, 36, 72), (7, 10, 18), (106, 168, 255), (40, 56, 90)
import math


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    dx, dy = u - .5, v - .52
    r = math.hypot(dx, dy)
    # a timer ring, three-quarters lit, with a small knob on top
    if .27 <= r <= .34:
        ang = (math.degrees(math.atan2(dx, -dy)) + 360) % 360
        return FG if ang <= 270 else DIM
    if abs(u - .5) <= .045 and .1 <= v <= .17:
        return FG
    return bg


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
