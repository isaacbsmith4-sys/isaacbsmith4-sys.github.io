"""Draws the BASE launcher icon (the five suite colors as tiles on a dark ground) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG_TOP, BG_BOT = (28, 30, 44), (10, 11, 16)
# INBOX, TALK / DON'T FORGET, LINK VAULT, with QUEUE as the dot in the middle
TILES = [((.20, .20, .47, .47), (139, 123, 255)), ((.53, .20, .80, .47), (255, 122, 89)),
         ((.20, .53, .47, .80), (255, 176, 32)), ((.53, .53, .80, .80), (46, 211, 183))]
DOT, DOT_C = (.5, .5, .085), (255, 95, 162)


def in_round(u, v, x0, y0, x1, y1, r=.06):
    cx, cy = min(max(u, x0 + r), x1 - r), min(max(v, y0 + r), y1 - r)
    return x0 <= u <= x1 and y0 <= v <= y1 and (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def pixel(u, v):
    if (u - DOT[0]) ** 2 + (v - DOT[1]) ** 2 <= DOT[2] ** 2:
        return DOT_C
    if (u - DOT[0]) ** 2 + (v - DOT[1]) ** 2 <= (DOT[2] + .03) ** 2:
        return BG_BOT
    for box, c in TILES:
        if in_round(u, v, *box):
            return c
    return tuple(round(a + (b - a) * v) for a, b in zip(BG_TOP, BG_BOT))


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
