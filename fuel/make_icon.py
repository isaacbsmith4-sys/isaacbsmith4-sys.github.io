"""Draws the Fuel app icon (a two-tone flame on a charcoal tile) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, OUT, IN = (58, 22, 12), (15, 11, 9), (255, 106, 61), (255, 196, 92)


def flame(u, v, s):
    # a teardrop: round base plus a pointed top, scaled by s around the base center
    cx, cy, r = .5, .62, .2 * s
    if (u - cx) ** 2 + (v - cy) ** 2 < r * r:
        return True
    top = cy - .44 * s
    if top <= v <= cy:
        half = r * (v - top) / (cy - top)
        return abs(u - cx + .04 * s * (cy - v) / (cy - top)) < half
    return False


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    if flame(u, v + .06, .55):
        return IN
    if flame(u, v, 1):
        return OUT
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
