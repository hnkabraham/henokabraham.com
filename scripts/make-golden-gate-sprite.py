#!/usr/bin/env python3
"""Turns the rendered bridge into the landmark sprite behind the tour: hides
everything below the fog top with a soft band, thickens the haze with
distance, crops, and writes PNG and AVIF into public/images. Heights are
model metres (the deck is at 6); the render's data pass supplies height and
camera distance per pixel.

Usage: python3 scripts/make-golden-gate-sprite.py [render base] [fog top] [fog bottom] [near haze] [far haze] [scale]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parent.parent
options = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--'))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
base = Path(args[0]) if len(args) > 0 else root / 'archive/models/golden-gate/render'
fog_top = float(args[1]) if len(args) > 1 else 66
fog_bottom = float(args[2]) if len(args) > 2 else 40
haze_near = float(args[3]) if len(args) > 3 else 0.2
haze_far = float(args[4]) if len(args) > 4 else 0.55
scale = float(args[5]) if len(args) > 5 else 0.8  # the render oversamples the largest display size
name = options.get('out', 'golden-gate')  # --out=golden-gate-portrait for the phone sprite
out_dir = Path(options.get('dir', root / 'public/images'))
raw = np.array(Image.open(f'{base}.png').convert('RGBA')).astype(np.float32)
data = np.array(Image.open(f'{base}-data.png').convert('RGBA')).astype(np.float32)
height = data[..., 0] / 255 * 400 - 100
distance = data[..., 1] / 255 * 4000
# Fog: fully hidden below the bottom, clear above the top, smooth between.
t = np.clip((height - fog_bottom) / (fog_top - fog_bottom), 0, 1)
raw[..., 3] *= t * t * (3 - 2 * t)
# Haze: distant paint loses saturation and contrast toward the horizon tone.
near, far = 900.0, 1900.0
haze = haze_near + (haze_far - haze_near) * np.clip((distance - near) / (far - near), 0, 1)
raw[..., :3] = raw[..., :3] * (1 - haze[..., None]) + np.array([218, 220, 219], np.float32) * haze[..., None]
out = Image.fromarray(np.clip(raw, 0, 255).astype(np.uint8), 'RGBA')
bb = out.getbbox()
out = out.crop((bb[0] - 6, bb[1] - 6, bb[2] + 6, bb[3] + 6))
out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.3))
out.save(out_dir / f'{name}.png', optimize=True)
out.save(out_dir / f'{name}.avif', quality=68, speed=2)
print(name, 'sprite', out.size,
      'png', (out_dir / f'{name}.png').stat().st_size,
      'avif', (out_dir / f'{name}.avif').stat().st_size)
# The camera's eye level as a fraction of the sprite's height (negative when
# it lies above the crop): the stylesheet pins that row to the sky's horizon.
meta = Path(f'{base}.json')
if meta.exists():
    shot = json.loads(meta.read_text())
    top, height = bb[1] - 6, bb[3] - bb[1] + 12
    print('horizon at', round((shot['horizon'] - top) / height, 4), 'of the sprite height;',
          'tower tops at', [round((t['top']['y'] - top) / height, 3) for t in shot['towers']],
          'x', [round((t['top']['x'] - bb[0] + 6) / (bb[2] - bb[0] + 12), 3) for t in shot['towers']])
