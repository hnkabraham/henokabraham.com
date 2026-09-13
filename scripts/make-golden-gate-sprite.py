#!/usr/bin/env python3
"""Turns the rendered bridge into the landmark sprite behind the tour: hides
everything below the fog top with a soft band (heights in model metres, the
deck is at 6), tints toward the horizon haze of the sky photograph, crops,
and writes PNG and AVIF into public/images.

Usage: python3 scripts/make-golden-gate-sprite.py [render base] [fog top] [fog bottom] [haze]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
base = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'archive/models/golden-gate/render'
fog_top = float(sys.argv[2]) if len(sys.argv) > 2 else 66
fog_bottom = float(sys.argv[3]) if len(sys.argv) > 3 else 40
haze = float(sys.argv[4]) if len(sys.argv) > 4 else 0.34
raw = Image.open(f'{base}.png').convert('RGBA')
refs = json.load(open(f'{base}.json'))
a = np.array(raw).astype(np.float32)
H, W = a.shape[:2]


def row_of(tower, h):
    """Screen row of world height h at a tower, from the render's references."""
    heights = sorted(int(k) for k in tower)
    for lo, hi in zip(heights, heights[1:]):
        if lo <= h <= hi:
            f = (h - lo) / (hi - lo)
            return tower[str(lo)]['y'] + (tower[str(hi)]['y'] - tower[str(lo)]['y']) * f
    return tower[str(heights[-1])]['y']


south, north = refs['south'], refs['north']
xs = np.arange(W)[None, :].repeat(H, 0)
ys = np.arange(H)[:, None].repeat(W, 1)
# Between the towers the fog line runs straight; beyond them it continues.
f = np.clip((xs - south['150']['x']) / (north['150']['x'] - south['150']['x']), -0.6, 1.6)
top = row_of(south, fog_top) + (row_of(north, fog_top) - row_of(south, fog_top)) * f
bottom = row_of(south, fog_bottom) + (row_of(north, fog_bottom) - row_of(south, fog_bottom)) * f
t = np.clip((ys - top) / (bottom - top), 0, 1)
a[..., 3] *= 1 - t * t * (3 - 2 * t)
# Distant paint loses saturation and contrast toward the horizon tone.
a[..., :3] = a[..., :3] * (1 - haze) + np.array([218, 220, 219], np.float32) * haze
out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
bb = out.getbbox()
out = out.crop((bb[0] - 6, bb[1] - 6, bb[2] + 6, bb[3] + 6)).filter(ImageFilter.GaussianBlur(0.35))
out.save(root / 'public/images/golden-gate.png', optimize=True)
out.save(root / 'public/images/golden-gate.avif', quality=68, speed=2)
print('golden-gate sprite', out.size,
      'png', (root / 'public/images/golden-gate.png').stat().st_size,
      'avif', (root / 'public/images/golden-gate.avif').stat().st_size)
