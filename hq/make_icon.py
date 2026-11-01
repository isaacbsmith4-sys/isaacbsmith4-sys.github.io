"""Draws the LIFE HQ icon (four rounded tiles in the core apps' colors) as PNGs, no libraries."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (8, 9, 13)
TILES = [((.22, .22), (143, 134, 255)), ((.53, .22), (255, 106, 61)), ((.22, .53), (63, 211, 255)), ((.53, .53), (255, 126, 182))]


def pixel(u, v):
    # four rounded tiles, one per core app color
    for (x0, y0), col in TILES:
        s, r = .25, .07
        if x0 <= u <= x0 + s and y0 <= v <= y0 + s:
            cx = min(max(u, x0 + r), x0 + s - r); cy = min(max(v, y0 + r), y0 + s - r)
            if (u - cx) ** 2 + (v - cy) ** 2 <= r * r:
                return col
    return BG


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
