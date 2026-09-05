#!/usr/bin/env python3
"""Generate the PWA icon set.

No third-party imaging libraries are available, so this draws the icon into a
plain RGB buffer and writes the PNGs with zlib + struct. Everything is rendered
once at 1024px and area-averaged down, which gives clean anti-aliased edges at
every size.

Usage: python3 tools/make_icons.py
"""

import math
import os
import struct
import zlib

MASTER = 1024
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

BG_TOP = (0x4F, 0x6B, 0xF6)
BG_BOTTOM = (0x7C, 0x4D, 0xF0)
PAPER = (0xFF, 0xFF, 0xFF)
INK = (0x1E, 0x22, 0x3A)
ACCENT = (0xFF, 0x8A, 0x3D)


class Canvas:
    def __init__(self, size):
        self.size = size
        self.px = [[(0, 0, 0)] * size for _ in range(size)]

    def vertical_gradient(self, top, bottom):
        n = self.size
        for y in range(n):
            t = y / (n - 1)
            colour = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
            self.px[y] = [colour] * n

    def _blend(self, x, y, colour, alpha):
        if alpha <= 0:
            return
        if alpha >= 1:
            self.px[y][x] = colour
            return
        old = self.px[y][x]
        self.px[y][x] = tuple(round(old[i] + (colour[i] - old[i]) * alpha) for i in range(3))

    def rounded_rect(self, x, y, w, h, r, colour, samples=4):
        """Filled rounded rectangle, anti-aliased by sub-sampling edge pixels."""
        x0, y0, x1, y1 = x, y, x + w, y + h
        r = min(r, w / 2, h / 2)
        for py in range(max(0, int(y0) - 1), min(self.size, int(y1) + 2)):
            for px in range(max(0, int(x0) - 1), min(self.size, int(x1) + 2)):
                hits = 0
                for sy in range(samples):
                    cy = py + (sy + 0.5) / samples
                    for sx in range(samples):
                        cx = px + (sx + 0.5) / samples
                        if cx < x0 or cx > x1 or cy < y0 or cy > y1:
                            continue
                        # Only the four corner boxes need a radius test.
                        nx = min(max(cx, x0 + r), x1 - r)
                        ny = min(max(cy, y0 + r), y1 - r)
                        if (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r:
                            hits += 1
                self._blend(px, py, colour, hits / (samples * samples))

    def circle(self, cx, cy, r, colour, samples=4):
        for py in range(max(0, int(cy - r) - 1), min(self.size, int(cy + r) + 2)):
            for px in range(max(0, int(cx - r) - 1), min(self.size, int(cx + r) + 2)):
                hits = 0
                for sy in range(samples):
                    sy_c = py + (sy + 0.5) / samples
                    for sx in range(samples):
                        sx_c = px + (sx + 0.5) / samples
                        if (sx_c - cx) ** 2 + (sy_c - cy) ** 2 <= r * r:
                            hits += 1
                self._blend(px, py, colour, hits / (samples * samples))

    def resized(self, size):
        """Area-average down to `size` (works for non-integer ratios)."""
        src = self.size
        scale = src / size
        out = []
        for y in range(size):
            y0, y1 = y * scale, (y + 1) * scale
            row = []
            for x in range(size):
                x0, x1 = x * scale, (x + 1) * scale
                acc = [0.0, 0.0, 0.0]
                total = 0.0
                for sy in range(int(y0), min(src, int(math.ceil(y1)))):
                    cy = min(y1, sy + 1) - max(y0, sy)
                    if cy <= 0:
                        continue
                    srow = self.px[sy]
                    for sx in range(int(x0), min(src, int(math.ceil(x1)))):
                        cx = min(x1, sx + 1) - max(x0, sx)
                        if cx <= 0:
                            continue
                        weight = cx * cy
                        pixel = srow[sx]
                        acc[0] += pixel[0] * weight
                        acc[1] += pixel[1] * weight
                        acc[2] += pixel[2] * weight
                        total += weight
                row.append(tuple(round(c / total) for c in acc))
            out.append(row)
        return out


def write_png(path, rows):
    height = len(rows)
    width = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0
        for pixel in row:
            raw.extend(pixel)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


def draw(canvas, inset):
    """Draw the calendar-and-note mark. `inset` shrinks the artwork so maskable
    icons keep their content inside the safe zone."""
    n = canvas.size
    canvas.vertical_gradient(BG_TOP, BG_BOTTOM)

    art = n * (1 - 2 * inset)
    ox = oy = n * inset

    def u(v):
        return ox + art * v, oy + art * v

    def ux(v):
        return ox + art * v

    def uy(v):
        return oy + art * v

    # Note page, tucked behind and to the right.
    canvas.rounded_rect(ux(0.42), uy(0.30), art * 0.40, art * 0.52, art * 0.06, (0xE7, 0xEC, 0xFF))
    for i in range(4):
        canvas.rounded_rect(
            ux(0.50), uy(0.42 + i * 0.10), art * 0.24, art * 0.035, art * 0.018, (0x9A, 0xA6, 0xD8)
        )

    # Calendar body.
    canvas.rounded_rect(ux(0.14), uy(0.22), art * 0.46, art * 0.60, art * 0.08, PAPER)
    # Header band.
    canvas.rounded_rect(ux(0.14), uy(0.22), art * 0.46, art * 0.16, art * 0.08, ACCENT)
    canvas.rounded_rect(ux(0.14), uy(0.32), art * 0.46, art * 0.06, 0, ACCENT)

    # Binding rings.
    for cx in (0.25, 0.49):
        canvas.rounded_rect(ux(cx), uy(0.14), art * 0.045, art * 0.14, art * 0.022, PAPER)

    # Day dots.
    for row in range(3):
        for col in range(3):
            canvas.circle(
                ux(0.225 + col * 0.115),
                uy(0.475 + row * 0.115),
                art * 0.030,
                INK if (row, col) != (1, 1) else ACCENT,
            )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    standard = Canvas(MASTER)
    draw(standard, inset=0.055)
    maskable = Canvas(MASTER)
    draw(maskable, inset=0.16)

    targets = [
        (standard, "icon-512.png", 512),
        (standard, "icon-192.png", 192),
        (standard, "apple-touch-icon.png", 180),
        (standard, "favicon-32.png", 32),
        (maskable, "icon-maskable-512.png", 512),
        (maskable, "icon-maskable-192.png", 192),
    ]
    for canvas, name, size in targets:
        path = os.path.join(OUT_DIR, name)
        write_png(path, canvas.resized(size))
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
