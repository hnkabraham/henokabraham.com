"""Resample downloaded Terrarium tiles to the registered ESA texture's grid.

Usage: python3 scripts/prepare-bay-terrain.py /path/to/source-assets
See ASSETS.md for sources and attribution. Output is little-endian uint16,
257 x 257, north-to-south rows, quarter-meter elevations above sea level.
"""
import json
import math
import pathlib
import struct
import sys
from PIL import Image

source = pathlib.Path(sys.argv[1])
registration = json.loads((source / 'sf-bay-georeferencing.json').read_text())
affine = registration['satellitePixelToWebMercatorMatrix']
tiles = {(x, y): Image.open(source / f'terrarium-10-{x}-{y}.png').convert('RGB')
         for x in (163, 164) for y in (395, 396)}
half_world = 20037508.342789244

def height_at(px, py):
    mx = affine[0][0] * px + affine[0][1] * py + affine[0][2]
    my = affine[1][0] * px + affine[1][1] * py + affine[1][2]
    tx = (mx + half_world) / (2 * half_world) * 1024
    ty = (half_world - my) / (2 * half_world) * 1024
    gx, gy = tx * 256 - .5, ty * 256 - .5
    ix, iy = math.floor(gx), math.floor(gy)
    def sample(x, y):
        r, g, b = tiles[(x // 256, y // 256)].getpixel((x % 256, y % 256))
        return r * 256 + g + b / 256 - 32768
    fx, fy = gx - ix, gy - iy
    h = ((1-fx)*sample(ix,iy)+fx*sample(ix+1,iy))*(1-fy) + ((1-fx)*sample(ix,iy+1)+fx*sample(ix+1,iy+1))*fy
    # Flatten the airfield apron so the detailed runway sits on level ground.
    dx, dz = (px - 5666.01015)*10, (py - 8672.84973)*10
    along, across = -.88736*dx - .46108*dz, .46108*dx - .88736*dz
    if -350 < along < 3900 and abs(across) < 340:
        h = 2
    return round(max(0, h) * 4)

heights = [height_at(3500 + x*4800/256, 5200 + y*4800/256)
           for y in range(257) for x in range(257)]
target = pathlib.Path(__file__).resolve().parents[1] / 'public/scenery/bay-elevation.bin'
target.write_bytes(struct.pack('<' + 'H'*len(heights), *heights))
print(f'{target.name}: {len(heights)} elevations; {max(heights)/4:.1f}m maximum')
