"""Draws the Echo icon (a white light trailed by three colored echo loops) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT = (24, 14, 46), (4, 4, 10)
# three echo rings, offset like a light caught in a stutter
RINGS = [((.40, .58), .25, (60, 220, 255)), ((.50, .52), .25, (157, 140, 255)), ((.60, .46), .25, (255, 70, 170))]


def pixel(u, v):
    c = [a + (b - a) * v for a, b in zip(TOP, BOT)]
    for (cx, cy), r, col in RINGS:
        d = abs(math.hypot(u - cx, v - cy) - r)
        if d < .03:
            k = (1 - d / .03) ** 1.5
            c = [min(255, a + b * k) for a, b in zip(c, col)]
    # the player: a white dot with a soft halo, on the last ring
    d = math.hypot(u - .60, v - .46)
    if d < .075:
        return (255, 255, 255)
    if d < .16:
        k = (1 - (d - .075) / .085) ** 2 * .6
        c = [min(255, a + 255 * k) for a in c]
    return tuple(round(x) for x in c)


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
