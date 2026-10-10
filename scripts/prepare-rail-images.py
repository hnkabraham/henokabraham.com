#!/usr/bin/env python3
"""Encodes the briefing rail's tall captures at the widths the rail draws them.

The rail is about 175 CSS px wide, so a 2x screen wants 350 px and a 3x one
525 px; the 690 px masters stay as the largest step. Each width is written as
JPEG and AVIF beside its master, which the briefing offers through <picture>
and srcset (app/terminal-experience.tsx, railSources). Masters are the
committed `<name>.jpg` files; their own AVIF is regenerated too.

Usage: python3 scripts/prepare-rail-images.py [name ...]
"""
import sys
from pathlib import Path

from PIL import Image

IMAGES = Path(__file__).resolve().parent.parent / 'public' / 'images'
RAIL = [
    'flight-tracker-phone',
    'routeloads-hero',
    'downshift-dashboard',
    'ct45-handheld',
    'bezel-auth-modes',
]
WIDTHS = [360, 525]


def encode(image, stem):
    image.save(IMAGES / f'{stem}.avif', quality=60, speed=4)


for name in sys.argv[1:] or RAIL:
    master = Image.open(IMAGES / f'{name}.jpg').convert('RGB')
    if master.width != 690:
        raise SystemExit(f'{name}.jpg is {master.width} px wide, not 690')
    encode(master, name)
    for width in WIDTHS:
        height = round(master.height * width / master.width)
        step = master.resize((width, height), Image.LANCZOS)
        step.save(IMAGES / f'{name}-{width}.jpg', quality=82, optimize=True, progressive=True)
        encode(step, f'{name}-{width}')
    print(name, master.size)
