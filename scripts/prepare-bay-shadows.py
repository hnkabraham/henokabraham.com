#!/usr/bin/env python3
"""Bake sun shadows and sky visibility for the Bay flight's imagery layers.

  python3 scripts/prepare-bay-shadows.py --cache /path/to/city-cache [layer ...]

For each imagery layer a height field is built from the terrain grid plus
every building footprint (the corridor city and the airport set), then the
scene's fixed sun direction is marched through it. The result is written as
archive/scenery/shade-<layer>.webp: red is the direct-sun factor, green the
fraction of sky visible, sampled by lib/bay-surface.ts through the same
Web Mercator projection as the imagery. Building masks for the tree scatter
are left in the cache.
"""
import argparse
import importlib.util
import json
import math
import os
import pathlib
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('city', ROOT / 'scripts/prepare-city-buildings.py')
city = importlib.util.module_from_spec(spec)
spec.loader.exec_module(city)

# Bounds must match lib/bay-surface.ts and scripts/prepare-naip-layers.py.
LAYERS = {
    'sfo': [-13626825.603526574, 4521217.699661355, -13618619.768127132, 4529423.535060797],
    'south': [-13631947.74, 4525293.17, -13615947.74, 4541293.17],
    'north': [-13636902.989, 4542449.687, -13620902.989, 4558449.687],
}
SIZE = 4096
# The scene's sun: local east/up/south components (app/bay-flight-scene.tsx).
SUN = np.array([-0.66, 0.44, 0.61])
SUN /= np.linalg.norm(SUN)
ELEVATION_GRID = ROOT / 'archive/scenery/bay-elevation.webp'
SFO_BUILDINGS = ROOT / 'archive/scenery/sfo-buildings.json'


def terrain_grid():
    image = np.asarray(Image.open(ELEVATION_GRID).convert('RGB'))
    return (image[..., 0].astype(np.float32) * 256 + image[..., 1]) / 4


def terrain_heights(bounds, size, grid):
    """Bilinear terrain height for every pixel centre of a layer."""
    x0, y0, x1, y1 = bounds
    cols = x0 + (np.arange(size) + 0.5) / size * (x1 - x0)
    rows = y1 - (np.arange(size) + 0.5) / size * (y1 - y0)
    mx, my = np.meshgrid(cols, rows)
    # Mercator to registered source pixels, then to local metres (see lonLatToBay).
    px = 0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784
    py = -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904
    last = grid.shape[0] - 1
    gc = np.clip((px - 3500) / 4800 * last, 0, last - 1.001)
    gr = np.clip((py - 5200) / 4800 * last, 0, last - 1.001)
    c0 = gc.astype(np.int32)
    r0 = gr.astype(np.int32)
    fx = gc - c0
    fy = gr - r0
    return (
        (grid[r0, c0] * (1 - fx) + grid[r0, c0 + 1] * fx) * (1 - fy)
        + (grid[r0 + 1, c0] * (1 - fx) + grid[r0 + 1, c0 + 1] * fx) * fy
    ).astype(np.float32)


def airport_footprints():
    data = json.load(open(SFO_BUILDINGS))
    for feature in data['features']:
        props = feature['properties']
        if props.get('building:part') and props.get('aeroway') != 'tower':
            continue
        height = props.get('height_m') or (
            props['levels'] * 3.2 if props.get('levels') else 15 if props.get('building') == 'hangar' else 8
        )
        polygons = [feature['geometry']['coordinates']] if feature['geometry']['type'] == 'Polygon' else feature['geometry']['coordinates']
        for polygon in polygons:
            yield [tuple(p) for p in polygon[0]], float(height)


def rasterize(bounds, size, footprints):
    """Building height (m) per pixel and a building mask."""
    x0, y0, x1, y1 = bounds
    heights = Image.new('I', (size, size), 0)
    draw = ImageDraw.Draw(heights)
    count = 0
    for lonlat, height in footprints:
        xy = []
        for lon, lat in lonlat:
            mx, my = city.mercator(lon, lat)
            xy.append(((mx - x0) / (x1 - x0) * size, (y1 - my) / (y1 - y0) * size))
        xs = [p[0] for p in xy]
        ys = [p[1] for p in xy]
        if max(xs) < 0 or min(xs) > size or max(ys) < 0 or min(ys) > size:
            continue
        draw.polygon(xy, fill=int(round(height * 100)))
        count += 1
    building = np.asarray(heights, dtype=np.float32) / 100
    return building, count


def shifted(field, dc, dr):
    """field[p + (dc, dr)] with edges padded by the field's own edge."""
    out = np.empty_like(field)
    n = field.shape[0]
    src_r = slice(max(0, dr), min(n, n + dr))
    dst_r = slice(max(0, -dr), min(n, n - dr))
    src_c = slice(max(0, dc), min(n, n + dc))
    dst_c = slice(max(0, -dc), min(n, n - dc))
    out[:] = field
    out[dst_r, dst_c] = field[src_r, src_c]
    return out


def sun_shadow(height, pixel, max_height):
    """1 where sunlit, 0 in shadow, after marching towards the sun."""
    # Toward the sun in pixel space: columns run east, rows run south.
    horizontal = np.hypot(SUN[0], SUN[2])
    dcol, drow = SUN[0] / horizontal, SUN[2] / horizontal
    rise = pixel * SUN[1] / horizontal
    steps = int(math.ceil((max_height * horizontal / SUN[1] + 40) / pixel))
    depth = np.zeros_like(height)
    for k in range(1, steps + 1):
        step = k if k <= 24 else 24 + (k - 24) * 2
        if step * pixel > (max_height * horizontal / SUN[1] + 40):
            break
        dc, dr = int(round(step * dcol)), int(round(step * drow))
        occluder = shifted(height, dc, dr) - (height + step * rise + 0.4)
        np.maximum(depth, occluder, out=depth)
    lit = 1 - np.clip(depth / 1.5, 0, 1)
    return lit


def sky_visibility(height, pixel):
    """Cosine-weighted fraction of the sky visible above each pixel."""
    total = np.zeros_like(height)
    directions = 8
    for d in range(directions):
        angle = 2 * math.pi * d / directions
        dcol, drow = math.cos(angle), math.sin(angle)
        tangent = np.zeros_like(height)
        for k in range(1, 25):
            dc, dr = int(round(k * dcol)), int(round(k * drow))
            rise = (shifted(height, dc, dr) - height) / (k * pixel)
            np.maximum(tangent, rise, out=tangent)
        total += np.sin(np.arctan(tangent))
    return 1 - total / directions


def bake(name, bounds, cache, grid, footprints):
    started = time.time()
    pixel = (bounds[2] - bounds[0]) / SIZE
    terrain = terrain_heights(bounds, SIZE, grid)
    building, count = rasterize(bounds, SIZE, footprints)
    height = terrain + building
    lit = sun_shadow(height, pixel, float(building.max()))
    sky = sky_visibility(height, pixel)
    image = np.stack([lit, sky, np.full_like(lit, 0.5)], axis=-1)
    image = Image.fromarray((np.clip(image, 0, 1) * 255).astype(np.uint8), 'RGB')
    image = image.filter(ImageFilter.GaussianBlur(0.8))
    target = ROOT / 'archive/scenery'
    image.save(target / f'shade-{name}.webp', 'WEBP', quality=60, method=6)
    image.resize((2048, 2048), Image.LANCZOS).save(target / f'shade-{name}-mobile.webp', 'WEBP', quality=58, method=6)
    Image.fromarray((building > 0).astype(np.uint8) * 255, 'L').save(pathlib.Path(cache) / f'buildings-{name}.png')
    print(
        f'shade-{name}.webp: {count} footprints, {pixel:.2f} m/px, lit {lit.mean():.3f}, sky {sky.mean():.3f}, '
        f'{(target / f"shade-{name}.webp").stat().st_size:,} bytes, {time.time() - started:.0f}s',
        flush=True,
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', required=True)
    parser.add_argument('layers', nargs='*')
    args = parser.parse_args()
    grid = terrain_grid()
    corridor = [(lonlat, height) for lonlat, height, _kind, _tags in city.iterate_footprints(args.cache)]
    airport = list(airport_footprints())
    print(f'{len(corridor)} corridor and {len(airport)} airport footprints', flush=True)
    for name, bounds in LAYERS.items():
        if args.layers and name not in args.layers:
            continue
        bake(name, bounds, args.cache, grid, corridor + airport)
