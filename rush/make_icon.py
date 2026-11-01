"""Draws the Lane Rush icon (a cyan arrowhead on a neon highway at dusk) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT = (40, 8, 70), (5, 3, 11)
CYAN, PINK, SUN = (63, 232, 255), (255, 63, 164), (255, 211, 77)
HOR = .46


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    # sun with stripes, sitting on the horizon
    d = ((u - .5) ** 2 + (v - .36) ** 2) ** .5
    if v < HOR and d < .22 and not (v > .36 and int((v - .36) * 60) % 3 == 0):
        t = (v - .14) / .32
        return tuple(round(a + (b - a) * t) for a, b in zip(SUN, PINK))
    if v < HOR:
        return bg
    # road edges converge to the center of the horizon
    t = (v - HOR) / (1 - HOR)
    half = .02 + .5 * t
    for s in (-1, 1):
        if abs(u - (.5 + s * half)) < .012 + .01 * t:
            return CYAN
    # lane dashes
    for s in (-1, 1):
        if abs(u - (.5 + s * half / 3)) < .006 + .006 * t and int(t * 9) % 2 == 0:
            return tuple(round(c * .7) for c in CYAN)
    # the arrowhead ship
    sy0, sy1 = .64, .86
    if sy0 <= v <= sy1:
        k = (v - sy0) / (sy1 - sy0)
        if abs(u - .5) < .16 * k and not (v > .8 and abs(u - .5) < .05):
            return tuple(round(a + (b - a) * k * .6) for a, b in zip((255, 255, 255), CYAN))
    if abs(u - .5) < half and int((v - HOR) * 40) % 2 == 0 and abs(u - .5) > half - .004:
        return PINK
    return (6, 3, 14) if abs(u - .5) < half else tuple(round(c * .6) for c in bg)


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
