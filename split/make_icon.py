"""Draws the Split Second icon (a dashed path dodging a saw toward a green exit, half frozen blue, half live red) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ICE, HOT, GO = (111, 208, 255), (255, 61, 110), (77, 255, 166)


def bez(t):
    # the drawn path: from bottom-left dot, curving around the saw, up to the exit
    p0, p1, p2, p3 = (.26, .80), (.16, .52), (.28, .20), (.62, .22)
    u = 1 - t
    return (u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1])


PATH = [bez(i / 120) for i in range(121)]


def pixel(u, v):
    frozen = u + v < 1.0                       # diagonal split: top-left frozen, bottom-right live
    c = [6, 14, 30] if frozen else [16, 4, 14]
    gs = 1 / 8
    if min(u % gs, v % gs) < .006:
        c = [x + 14 for x in c] if frozen else [x + 8 for x in c]
    # saw
    sx, sy, sr = .58, .52, .13
    d = math.hypot(u - sx, v - sy)
    a = math.atan2(v - sy, u - sx)
    teeth = sr * (.82 + .18 * (1 if math.sin(a * 10) > 0 else 0))
    if d < .04:
        return (11, 34, 54) if frozen else (42, 6, 18)
    if d < teeth:
        return (159, 216, 255) if frozen else HOT
    if d < sr * 1.6:
        k = (1 - (d - teeth) / (sr * 1.6 - teeth)) * .35
        col = ICE if frozen else HOT
        c = [min(255, x + y * k) for x, y in zip(c, col)]
    # exit ring
    ex, ey = .70, .22
    de = abs(math.hypot(u - ex, v - ey) - .085)
    if de < .016:
        return GO
    # dashed path
    best = min(range(len(PATH)), key=lambda i: (PATH[i][0] - u) ** 2 + (PATH[i][1] - v) ** 2)
    pd = math.hypot(PATH[best][0] - u, PATH[best][1] - v)
    if pd < .014 and (best // 7) % 2 == 0:
        return (210, 240, 255)
    # player dot
    if math.hypot(u - .26, v - .80) < .045:
        return (255, 255, 255)
    return tuple(round(x) for x in c)


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
