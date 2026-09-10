#!/usr/bin/env python3
"""Generate the PWA icon set.

The mark is drawn once in the palette named by DEFAULT_THEME and written to
icons/, which is what index.html and manifest.webmanifest point at.

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
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(ROOT, "icons")

# Only DEFAULT_THEME is written out. The others are kept because switching the
# app's icon is a one-line change here — the artwork is the same mark either way.
DEFAULT_THEME = "classic"

# One mark, five palettes. `paper` is the calendar card, `ink` the day dots on
# it, `accent` the header band, `note` the page tucked behind and `rule` its
# lines. `theme` is what the manifest advertises to the OS.
THEMES = {
    "classic": {
        "label": "Classic",
        "top": (0x4F, 0x6B, 0xF6), "bottom": (0x7C, 0x4D, 0xF0),
        "paper": (0xFF, 0xFF, 0xFF), "ink": (0x1E, 0x22, 0x3A),
        "accent": (0xFF, 0x8A, 0x3D),
        "note": (0xE7, 0xEC, 0xFF), "rule": (0x9A, 0xA6, 0xD8),
        "theme": "#4f6bf6",
    },
    "midnight": {
        "label": "Midnight",
        "top": (0x24, 0x2E, 0x52), "bottom": (0x0B, 0x0E, 0x1C),
        "paper": (0xF2, 0xF5, 0xFF), "ink": (0x16, 0x1B, 0x2E),
        "accent": (0x35, 0xD0, 0xC5),
        "note": (0x33, 0x3E, 0x66), "rule": (0x7C, 0x8A, 0xBD),
        "theme": "#141a2e",
    },
    "sunrise": {
        "label": "Sunrise",
        "top": (0xFF, 0x9A, 0x3D), "bottom": (0xE8, 0x3E, 0x8C),
        "paper": (0xFF, 0xFB, 0xF5), "ink": (0x4A, 0x1C, 0x3A),
        "accent": (0xFF, 0xC8, 0x4B),
        "note": (0xFF, 0xE0, 0xCC), "rule": (0xD1, 0x84, 0x73),
        "theme": "#f4632f",
    },
    "forest": {
        "label": "Forest",
        "top": (0x35, 0x9B, 0x74), "bottom": (0x12, 0x44, 0x39),
        "paper": (0xFC, 0xFA, 0xF0), "ink": (0x1B, 0x33, 0x2B),
        "accent": (0xF2, 0xB1, 0x3C),
        "note": (0xD5, 0xEC, 0xDD), "rule": (0x76, 0xA3, 0x8C),
        "theme": "#22715a",
    },
    "mono": {
        "label": "Mono",
        "top": (0xFA, 0xFB, 0xFF), "bottom": (0xDF, 0xE3, 0xEE),
        "paper": (0x1C, 0x20, 0x33), "ink": (0xEE, 0xF0, 0xF8),
        "accent": (0xE5, 0x3D, 0x3D),
        "note": (0xC9, 0xD0, 0xE3), "rule": (0xFF, 0xFF, 0xFF),
        "theme": "#e9ebf2",
    },
}


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


def draw(canvas, palette, inset):
    """Draw the calendar-and-note mark in `palette`. `inset` shrinks the artwork
    so maskable icons keep their content inside the safe zone."""
    n = canvas.size
    canvas.vertical_gradient(palette["top"], palette["bottom"])

    art = n * (1 - 2 * inset)
    ox = oy = n * inset

    def ux(v):
        return ox + art * v

    def uy(v):
        return oy + art * v

    paper = palette["paper"]
    ink = palette["ink"]
    accent = palette["accent"]

    # Note page, tucked behind and to the right.
    canvas.rounded_rect(ux(0.42), uy(0.30), art * 0.40, art * 0.52, art * 0.06, palette["note"])
    for i in range(4):
        canvas.rounded_rect(
            ux(0.50), uy(0.42 + i * 0.10), art * 0.24, art * 0.035, art * 0.018, palette["rule"]
        )

    # Calendar body.
    canvas.rounded_rect(ux(0.14), uy(0.22), art * 0.46, art * 0.60, art * 0.08, paper)
    # Header band.
    canvas.rounded_rect(ux(0.14), uy(0.22), art * 0.46, art * 0.16, art * 0.08, accent)
    canvas.rounded_rect(ux(0.14), uy(0.32), art * 0.46, art * 0.06, 0, accent)

    # Binding rings.
    for cx in (0.25, 0.49):
        canvas.rounded_rect(ux(cx), uy(0.14), art * 0.045, art * 0.14, art * 0.022, paper)

    # Day dots.
    for row in range(3):
        for col in range(3):
            canvas.circle(
                ux(0.225 + col * 0.115),
                uy(0.475 + row * 0.115),
                art * 0.030,
                ink if (row, col) != (1, 1) else accent,
            )


# name -> (maskable?, pixel size)
TARGETS = [
    ("icon-512.png", False, 512),
    ("icon-192.png", False, 192),
    ("apple-touch-icon.png", False, 180),
    ("favicon-32.png", False, 32),
    ("icon-maskable-512.png", True, 512),
    ("icon-maskable-192.png", True, 192),
]

MANIFEST = """{
  "name": "Calendar & Notes",
  "short_name": "Cal+Notes",
  "description": "A calendar and a notepad in one app, stored on your device and usable offline.",
  "id": "./",
  "start_url": ".",
  "scope": ".",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone"],
  "orientation": "any",
  "background_color": "#f4f5fb",
  "theme_color": "%(theme)s",
  "categories": ["productivity", "utilities"],
  "icons": [
    { "src": "%(dir)sicon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "%(dir)sicon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "%(dir)sicon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "%(dir)sicon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Calendar", "url": "index.html#calendar", "icons": [{ "src": "%(dir)sicon-192.png", "sizes": "192x192" }] },
    { "name": "Notes", "url": "index.html#notes", "icons": [{ "src": "%(dir)sicon-192.png", "sizes": "192x192" }] }
  ]
}
"""


def write_set(palette, out_dir, icon_dir_for_manifest, manifest_path):
    os.makedirs(out_dir, exist_ok=True)

    rendered = {}
    for maskable in (False, True):
        canvas = Canvas(MASTER)
        draw(canvas, palette, inset=0.16 if maskable else 0.055)
        rendered[maskable] = canvas

    for name, maskable, size in TARGETS:
        path = os.path.join(out_dir, name)
        write_png(path, rendered[maskable].resized(size))
        print("wrote", os.path.relpath(path, ROOT))

    with open(manifest_path, "w", encoding="utf-8") as handle:
        handle.write(MANIFEST % {"theme": palette["theme"], "dir": icon_dir_for_manifest})
    print("wrote", os.path.relpath(manifest_path, ROOT))


def main():
    write_set(
        THEMES[DEFAULT_THEME],
        OUT_DIR,
        "icons/",
        os.path.join(ROOT, "manifest.webmanifest"),
    )


if __name__ == "__main__":
    main()
