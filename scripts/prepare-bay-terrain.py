"""Resample Terrarium elevation tiles to the registered ESA texture's grid.

Usage: python3 scripts/prepare-bay-terrain.py /path/to/source-assets [--grid 1025] [--zoom 12]

The source directory must contain `sf-bay-georeferencing.json` (a copy of
public/credits/bay-georeferencing.json). Missing `terrarium-{z}-{x}-{y}.png`
tiles are downloaded there from the public Mapzen/AWS bucket credited in
ASSETS.md. Output is archive/scenery/bay-elevation.webp: a lossless RGB WebP
whose red and green channels hold the high and low bytes of quarter-metre
elevations above sea level, north-to-south rows. Ocean is clamped to zero and
the airfield apron is levelled so the detailed runway sits on flat ground.
"""
import argparse
import io
import json
import math
import pathlib
import urllib.request
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source', type=pathlib.Path)
parser.add_argument('--grid', type=int, default=1025)
parser.add_argument('--zoom', type=int, default=12)
args = parser.parse_args()
source, grid, zoom = args.source, args.grid, args.zoom

registration = json.loads((source / 'sf-bay-georeferencing.json').read_text())
affine = registration['satellitePixelToWebMercatorMatrix']
half_world = 20037508.342789244
tiles_across = 2 ** zoom

def mercator(px, py):
    return (affine[0][0] * px + affine[0][1] * py + affine[0][2],
            affine[1][0] * px + affine[1][1] * py + affine[1][2])

def tile_coordinates(mx, my):
    return ((mx + half_world) / (2 * half_world) * tiles_across,
            (half_world - my) / (2 * half_world) * tiles_across)

corners = [tile_coordinates(*mercator(px, py))
           for px in (3500, 8300) for py in (5200, 10000)]
x0, x1 = math.floor(min(c[0] for c in corners)) - 1, math.floor(max(c[0] for c in corners)) + 1
y0, y1 = math.floor(min(c[1] for c in corners)) - 1, math.floor(max(c[1] for c in corners)) + 1
tiles = {}
for x in range(x0, x1 + 1):
    for y in range(y0, y1 + 1):
        path = source / f'terrarium-{zoom}-{x}-{y}.png'
        if not path.exists():
            url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png'
            path.write_bytes(urllib.request.urlopen(url, timeout=30).read())
        tiles[(x, y)] = Image.open(path).convert('RGB').load()
print(f'{len(tiles)} zoom-{zoom} tiles: x {x0}–{x1}, y {y0}–{y1}')

def sample(gx, gy):
    r, g, b = tiles[(gx // 256, gy // 256)][gx % 256, gy % 256]
    return r * 256 + g + b / 256 - 32768

def height_at(px, py):
    tx, ty = tile_coordinates(*mercator(px, py))
    gx, gy = tx * 256 - .5, ty * 256 - .5
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    h = ((1-fx)*sample(ix,iy)+fx*sample(ix+1,iy))*(1-fy) + ((1-fx)*sample(ix,iy+1)+fx*sample(ix+1,iy+1))*fy
    # Flatten the airfield apron so the detailed runway sits on level ground.
    dx, dz = (px - 5666.01015)*10, (py - 8672.84973)*10
    along, across = -.88736*dx - .46108*dz, .46108*dx - .88736*dz
    if -350 < along < 3900 and abs(across) < 340:
        h = 2
    return min(65535, round(max(0, h) * 4))

heights = [height_at(3500 + x*4800/(grid-1), 5200 + y*4800/(grid-1))
           for y in range(grid) for x in range(grid)]
image = Image.new('RGB', (grid, grid))
image.putdata([(h >> 8, h & 255, 0) for h in heights])
buffer = io.BytesIO()
image.save(buffer, 'WEBP', lossless=True, quality=100, method=6)
decoded = Image.open(io.BytesIO(buffer.getvalue())).convert('RGB').load()
assert all(decoded[x, y][0] * 256 + decoded[x, y][1] == heights[y*grid + x]
           for y in range(0, grid, 13) for x in range(0, grid, 17)), 'lossless round trip failed'
target = pathlib.Path(__file__).resolve().parents[1] / 'archive/scenery/bay-elevation.webp'
target.write_bytes(buffer.getvalue())
print(f'{target.name}: {grid}² elevations, {len(buffer.getvalue()):,} bytes; {max(heights)/4:.1f} m maximum')
