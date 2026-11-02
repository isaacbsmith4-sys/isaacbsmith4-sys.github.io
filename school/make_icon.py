"""Draws the School app icon (an open gold book on an ink tile) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, FG, PAGE = (64, 50, 14), (12, 11, 7), (242, 193, 78), (36, 32, 20)


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    # an open book: two pages meeting at a spine, with three text lines on each
    if .2 <= u <= .8 and .3 <= v <= .72:
        side = u - .5
        if abs(side) < .012:
            return FG
        top = .3 + .04 * abs(side) / .3
        if v >= top:
            for ly in (.42, .52, .62):
                if abs(v - ly) < .012 and .06 < abs(side) < .25:
                    return FG
            return PAGE
    if .2 <= u <= .8 and .72 < v <= .75:
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
