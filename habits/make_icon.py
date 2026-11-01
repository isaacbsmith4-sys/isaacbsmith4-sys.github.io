"""Draws the Habits app icon (a pink checkmark on a plum tile) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
TOP, BOT, FG = (70, 22, 48), (13, 10, 15), (255, 126, 182)


def seg(u, v, ax, ay, bx, by, w):
    # distance from (u, v) to the segment a-b, compared with half the stroke width
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)))
    return (u - ax - t * dx) ** 2 + (v - ay - t * dy) ** 2 <= w * w


def pixel(u, v):
    bg = tuple(round(a + (b - a) * v) for a, b in zip(TOP, BOT))
    # a bold checkmark
    if seg(u, v, .27, .52, .43, .68, .065) or seg(u, v, .43, .68, .74, .34, .065):
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
