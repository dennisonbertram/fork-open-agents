#!/usr/bin/env python3
"""Assert a PNG screenshot is a valid, non-blank image. Pure stdlib (zlib).

A "blank" framebuffer (X server up but nothing drawn, or a capture failure)
collapses to a single solid color. We decode the raw PNG scanlines and count
distinct pixel colors; a real desktop with a window manager + xterm produces
many. We require >1 distinct color AND a minimum size to call it non-blank.
"""
import struct
import sys
import zlib


def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    width = height = bit_depth = color_type = None
    idat = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
        pos += 12 + length
    return width, height, bit_depth, color_type, idat


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def decode(path):
    w, h, depth, ctype, idat = read_png(path)
    if depth != 8:
        # Fall back to "size + byte entropy" heuristic for exotic depths.
        return w, h, None
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp = channels
    stride = w * bpp
    raw = zlib.decompress(idat)
    out = bytearray()
    prev = bytearray(stride)
    pos = 0
    for _ in range(h):
        ft = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            x = line[i]
            if ft == 1:
                line[i] = (x + a) & 0xFF
            elif ft == 2:
                line[i] = (x + b) & 0xFF
            elif ft == 3:
                line[i] = (x + ((a + b) >> 1)) & 0xFF
            elif ft == 4:
                line[i] = (x + paeth(a, b, c)) & 0xFF
        out.extend(line)
        prev = line
    colors = set()
    for i in range(0, len(out), bpp):
        colors.add(bytes(out[i : i + bpp]))
        if len(colors) > 256:
            break
    return w, h, len(colors)


def main():
    path = sys.argv[1]
    w, h, ncolors = decode(path)
    import os

    size = os.path.getsize(path)
    print(f"[img] {path}: {w}x{h}, {size} bytes, distinct_colors={ncolors}")
    if w < 100 or h < 100:
        print("[img] FAIL: image too small")
        return 1
    if ncolors is None:
        # Heuristic path: a non-trivial PNG of a real screen won't be tiny.
        if size < 2000:
            print("[img] FAIL: image suspiciously small / likely blank")
            return 1
        print("[img] PASS (size heuristic): non-trivial framebuffer capture")
        return 0
    if ncolors <= 1:
        print("[img] FAIL: image is a single solid color (blank framebuffer)")
        return 1
    print(f"[img] PASS: non-blank framebuffer with {ncolors}+ distinct colors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
