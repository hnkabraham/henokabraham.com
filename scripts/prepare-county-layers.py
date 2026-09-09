#!/usr/bin/env python3
"""Export San Mateo County 2022 orthoimagery (0.5 ft) into the flight's layer frames.

  python3 scripts/prepare-county-layers.py /path/to/tile-cache [layer ...]

The county's ArcGIS ImageServer reprojects on request, so each layer is
asked for as a grid of Web Mercator tiles at about twice the target
resolution, mosaicked, Lanczos-downsampled, colour-matched to the NAIP layer
that already covers the same box (a per-channel linear fit on low-passed
copies, so the county's warmer, contrastier flight takes on NAIP's tone at
the seams without losing its detail) and written as WebP into
public/scenery. Bounds are EPSG:3857 metres and must match lib/bay-surface.ts.
Tiles are cached in the given directory.

Data: San Mateo County GIS, 2022 orthoimagery. No licence text is published
by the county; confirm terms with countygis@smcgov.org before shipping.
"""
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

SERVICE = ('https://gis.smcgov.org/image/rest/services/'
           'SanMateoCounty_Imagery2022/ImageServer/exportImage')
# name: (bounds, output size, tile size, grid, NAIP layer to match)
LAYERS = {
    'runway': ([-13623646.065, 4524879.257, -13621046.065, 4527479.257],
               8192, 4096, 4, 'naip-runway.webp'),
}
cache = pathlib.Path(sys.argv[1])
cache.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[2:])
target = pathlib.Path(__file__).resolve().parents[1] / 'public/scenery'


def fetch(bbox, path, tile):
    if path.exists() and path.stat().st_size > 1000:
        return
    query = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=3857,
                 imageSR=3857, size=f'{tile},{tile}', format='png', f='image',
                 interpolation='RSP_BilinearInterpolation')
    url = SERVICE + '?' + urllib.parse.urlencode(query)
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(url, timeout=300).read()
            if not data.startswith(b'\x89PNG'):
                raise RuntimeError(data[:200])
            path.write_bytes(data)
            return
        except Exception as error:  # noqa: BLE001 - retry any transport error
            print('retry', path.name, attempt, str(error)[:120], flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f'failed {path}')


def match_tone(image, reference):
    """Per-channel gain and offset fitted on 256² low-pass copies."""
    a = np.asarray(image.resize((256, 256), Image.BOX)).astype(np.float64)
    b = np.asarray(reference.convert('RGB').resize((256, 256), Image.BOX)).astype(np.float64)
    full = np.asarray(image).astype(np.float32)
    for channel in range(3):
        x, y = a[..., channel].ravel(), b[..., channel].ravel()
        gain, offset = np.polyfit(x, y, 1)
        # Keep a little of the county's contrast rather than matching the haze fully.
        gain = 0.75 * gain + 0.25
        offset = 0.75 * offset
        full[..., channel] = full[..., channel] * gain + offset
        print(f'  channel {channel}: gain {gain:.3f} offset {offset:+.1f}', flush=True)
    return Image.fromarray(np.clip(full, 0, 255).astype(np.uint8), 'RGB')


for name, ((x0, y0, x1, y1), size, TILE, GRID, reference) in LAYERS.items():
    if only and name not in only:
        continue
    width, height = (x1 - x0) / GRID, (y1 - y0) / GRID
    mosaic = Image.new('RGB', (TILE * GRID, TILE * GRID))
    for row in range(GRID):
        for column in range(GRID):
            bbox = [x0 + column * width, y1 - (row + 1) * height,
                    x0 + (column + 1) * width, y1 - row * height]
            path = cache / f'county-{name}-{row}-{column}.png'
            fetch(bbox, path, TILE)
            tile = Image.open(path).convert('RGB')
            assert tile.size == (TILE, TILE), tile.size
            mosaic.paste(tile, (column * TILE, row * TILE))
            print(f'{name} tile {row},{column}', flush=True)
    full = mosaic.resize((size, size), Image.LANCZOS)
    del mosaic
    print('matching tone to', reference, flush=True)
    full = match_tone(full, Image.open(target / reference))
    out = target / f'county-{name}.webp'
    full.save(out, 'WEBP', quality=80, method=6)
    print(f'{out.name}: {(x1 - x0) / size:.2f} m/px, {out.stat().st_size:,} bytes', flush=True)
