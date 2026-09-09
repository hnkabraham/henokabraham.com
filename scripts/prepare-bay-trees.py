#!/usr/bin/env python3
"""Scatter tree canopies over the corridor from the NAIP imagery.

  python3 scripts/prepare-bay-trees.py --cache /path/to/city-cache

Dark green pixels of the south and north corridor layers that are not
buildings (masks left by scripts/prepare-bay-shadows.py) and not water
(the terrain grid is at sea level, which also excludes the Golden Gate's
shadow on the strait) become canopy instances, thinned to a density the
page can draw. Each tree is written to
public/scenery/bay-trees.bin.gz as local metres, size and the photograph's
colour, read by lib/bay-trees.ts.
"""
import argparse
import gzip
import os
import pathlib
import importlib.util
import struct

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]


def shadow_tools():
    """The terrain helpers of prepare-bay-shadows.py (hyphenated, so loaded by path)."""
    spec = importlib.util.spec_from_file_location(
        'prepare_bay_shadows', pathlib.Path(__file__).resolve().parent / 'prepare-bay-shadows.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.terrain_grid, module.terrain_heights

LAYERS = {
    'south': [-13631947.74, 4525293.17, -13615947.74, 4541293.17],
    'north': [-13636902.989, 4542449.687, -13620902.989, 4558449.687],
}
BAY_ORIGIN = (5666.01015, 8672.84973)
DENSITY = 0.42
MOBILE_DENSITY = 0.07


def local_from_mercator(mx, my):
    px = 0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784
    py = -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904
    return (px - BAY_ORIGIN[0]) * 10, (py - BAY_ORIGIN[1]) * 10


def canopy(name, bounds, cache, rng, grid):
    x0, y0, x1, y1 = bounds
    photo = np.asarray(Image.open(ROOT / f'public/scenery/naip-{name}.webp').convert('RGB'), dtype=np.float32) / 255
    size = photo.shape[0]
    mask = np.asarray(Image.open(pathlib.Path(cache) / f'buildings-{name}.png').resize((size, size), Image.NEAREST)) > 0
    # Nothing grows on the water; the terrain grid is clamped to sea level there.
    mask |= shadow_tools()[1](bounds, size, grid) < 0.3
    r, g, b = photo[..., 0], photo[..., 1], photo[..., 2]
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    greenness = (g - r) / (g + r + 0.05)
    # Tree canopy is green and dark; lawns are green and bright; roofs are masked.
    trees = (greenness > 0.05) & (luminance < 0.4) & (g > b * 1.08) & ~mask
    # Keep canopy away from building edges so nothing pokes through walls.
    from PIL import ImageFilter
    grown = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
    trees &= ~grown
    rows, cols = np.nonzero(trees)
    keep = rng.random(len(rows)) < DENSITY
    rows, cols = rows[keep], cols[keep]
    pixel = (x1 - x0) / size
    mx = x0 + (cols + rng.random(len(cols))) * pixel
    my = y1 - (rows + rng.random(len(rows))) * pixel
    lx, lz = local_from_mercator(mx, my)
    colour = photo[rows, cols]
    # Canopies read a little darker and greener than the flattened photograph.
    colour = np.clip(colour * np.array([0.78, 0.9, 0.7]), 0, 1)
    # Darker pixels tend to be bigger, older canopies.
    diameter = 5 + (0.42 - luminance[rows, cols]) / 0.42 * 6 + rng.random(len(rows)) * 3
    print(f'{name}: {trees.sum()} canopy pixels of {size * size}, {len(rows)} trees kept', flush=True)
    return lx, lz, diameter, colour


def write(path, lx, lz, diameter, colour):
    records = [struct.pack('<I', len(lx))]
    for x, z, d, c in zip(lx, lz, diameter, colour):
        records.append(struct.pack('<hhBBBB', int(round(x)), int(round(z)), int(round(d * 10)), *[int(v * 255) for v in c]))
    payload = b''.join(records)
    with gzip.open(path, 'wb', compresslevel=9) as handle:
        handle.write(payload)
    print(f'{path.name}: {len(lx)} trees, {len(payload) / 1e6:.2f} MB raw, {os.path.getsize(path) / 1e6:.2f} MB gzip', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    rng = np.random.default_rng(7)
    grid = shadow_tools()[0]()
    parts = [canopy(name, bounds, args.cache, rng, grid) for name, bounds in LAYERS.items()]
    lx = np.concatenate([p[0] for p in parts])
    lz = np.concatenate([p[1] for p in parts])
    diameter = np.concatenate([p[2] for p in parts])
    colour = np.concatenate([p[3] for p in parts])
    assert np.abs(lx).max() < 32000 and np.abs(lz).max() < 32000
    write(ROOT / 'public/scenery/bay-trees.bin.gz', lx, lz, diameter, colour)
    subset = rng.random(len(lx)) < MOBILE_DENSITY / DENSITY
    write(ROOT / 'public/scenery/bay-trees-mobile.bin.gz', lx[subset], lz[subset], diameter[subset], colour[subset])
