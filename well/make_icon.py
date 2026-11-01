"""Draws the Gravity Well icon (a black hole with an orange accretion disk and a curving comet) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT = (18, 12, 40), (3, 4, 10)
CX, CY = .5, .5


def pixel(u, v):
    c = [a + (b - a) * v for a, b in zip(TOP, BOT)]
    # a few stars
    for sx, sy in ((.15, .2), (.82, .14), (.9, .62), (.1, .78), (.7, .88), (.3, .1)):
        if math.hypot(u - sx, v - sy) < .008:
            return (220, 225, 255)
    dx, dy = u - CX, v - CY
    # tilted disk: an ellipse band around the hole
    t = -.35
    ex = dx * math.cos(t) + dy * math.sin(t)
    ey = -dx * math.sin(t) + dy * math.cos(t)
    e = math.hypot(ex / .36, ey / .13)
    if .62 < e < 1.0:
        k = max(0, 1 - abs(e - .8) / .2)
        col = (255, 170 - 60 * (e - .62) / .38, 70)
        c = [min(255, a + b * k ** 1.3) for a, b in zip(c, col)]
    # glow halo
    d = math.hypot(dx, dy)
    if d < .3:
        k = (1 - d / .3) ** 2 * .5
        c = [min(255, a + b * k) for a, b in zip(c, (255, 140, 60))]
    # event horizon (drawn over the back half of the disk only where the disk is behind)
    if d < .145 and not (.62 < e < 1.0 and ey > 0):
        return (0, 0, 0) if d < .13 else (255, 190, 110)
    # a comet curving around the hole
    ang = math.atan2(dy, dx)
    rr = .36 - .05 * math.sin(ang * 1.0)
    if -2.6 < ang < -0.2 and abs(d - rr) < .012 + .012 * (ang + 2.6) / 2.4:
        k = (ang + 2.6) / 2.4
        c = [min(255, a + b * k) for a, b in zip(c, (95, 216, 255))]
    hx, hy = CX + .34 * math.cos(-.2), CY + .34 * math.sin(-.2)
    if math.hypot(u - hx, v - hy) < .03:
        return (240, 252, 255)
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
