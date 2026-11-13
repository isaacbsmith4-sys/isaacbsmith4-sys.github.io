"""Draws the Mobility app icon (a lime stick figure in a deep lunge with one arm reaching up) as PNGs, no libraries."""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, FG = (30, 38, 16), (10, 12, 7), (198, 244, 50)
# the world's greatest stretch, in a 0..1 box
SEGS = [((.30, .70), (.50, .52)), ((.50, .52), (.66, .53)), ((.66, .53), (.68, .74)),  # back leg, front thigh and shin
        ((.50, .52), (.62, .34)), ((.62, .34), (.64, .14)), ((.30, .70), (.20, .74))]  # torso, reaching arm, back foot
HEAD, HR, W = (.70, .30), .055, .042


def seg_d(u, v, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(u - ax - t * dx, v - ay - t * dy)


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    if math.hypot(u - HEAD[0], v - HEAD[1]) <= HR or any(seg_d(u, v, a, b) <= W / 2 for a, b in SEGS):
        return FG
    if abs(v - .79) < .008 and .14 < u < .86:
        return (60, 72, 34)
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
    for n, name in [(180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
        png(n, os.path.join(HERE, name))
