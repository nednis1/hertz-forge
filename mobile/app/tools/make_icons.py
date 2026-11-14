#!/usr/bin/env python3
"""Generate the PWA icons (flat dark tile + teal sine waves).

Usage:  python tools/make_icons.py
Writes icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png
"""
import math
import os
import struct
import zlib

BG = (12, 12, 24)
WAVE = (92, 240, 200)
WAVE_DIM = (26, 106, 74)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "icons")


def write_png(path, width, height, pixels):
    raw = b"".join(
        b"\x00" + pixels[y * width * 4:(y + 1) * width * 4]
        for y in range(height)
    )

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def blend(dst, src, a):
    return tuple(int(round(d + (s - d) * a)) for d, s in zip(dst, src))


def render(size, rounded=True, inset=0.0):
    """Rounded tile with two sine waves and a soft glow."""
    px = bytearray(size * size * 4)
    radius = size * 0.22 if rounded else 0.0
    margin = size * inset
    usable = size - 2 * margin

    waves = [
        # (amplitude, cycles, colour, stroke, vertical offset)
        (0.16, 1.35, WAVE, 0.030, 0.0),
        (0.10, 2.10, WAVE_DIM, 0.022, 0.16),
    ]

    for y in range(size):
        for x in range(size):
            fx = (x + 0.5) / size
            fy = (y + 0.5) / size
            colour = BG
            alpha = 1.0

            if rounded:
                cx = max(radius - fx * size, 0.0, fx * size - (size - radius))
                cy = max(radius - fy * size, 0.0, fy * size - (size - radius))
                if cx > 0 and cy > 0 and math.hypot(cx, cy) > radius:
                    colour, alpha = (0, 0, 0), 0.0

            if alpha > 0:
                for amp, cycles, wave_colour, stroke, offset in waves:
                    t = (fx - margin / size) / (usable / size)
                    if t < -0.05 or t > 1.05:
                        continue
                    wy = 0.5 + offset * 0.5 + amp * math.sin((t - 0.05) * cycles * 2 * math.pi)
                    target = margin / size + (0.5 + offset * 0.25) * (usable / size) - 0.5 * (usable / size) * 0
                    y_of_wave = (margin + 0.5 * usable) + (wy - 0.5) * usable
                    dist = abs(fy * size - y_of_wave)
                    width = stroke * size
                    if dist < width * 3.0:
                        a = max(0.0, 1.0 - dist / (width * 0.5)) if dist < width * 0.5 else 0.0
                        glow = 0.22 * max(0.0, 1.0 - dist / (width * 3.0))
                        colour = blend(colour, wave_colour, min(1.0, a + glow))

            i = (y * size + x) * 4
            px[i] = colour[0]
            px[i + 1] = colour[1]
            px[i + 2] = colour[2]
            px[i + 3] = int(alpha * 255)

    return px


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, True, 0.0),
        ("icon-512.png", 512, True, 0.0),
        ("icon-maskable-512.png", 512, False, 0.14),
    ]
    for name, size, rounded, inset in jobs:
        path = os.path.join(OUT, name)
        write_png(path, size, size, render(size, rounded, inset))
        print("wrote", path)


if __name__ == "__main__":
    main()
