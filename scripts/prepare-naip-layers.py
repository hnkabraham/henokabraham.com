"""Export the public-domain NAIP imagery layers used around the Bay flight.

Usage: python3 scripts/prepare-naip-layers.py /path/to/tile-cache [layer ...]

Each layer is requested from the USGS NAIP ImageServer credited in ASSETS.md as
a 4 × 4 mosaic of 2048² tiles at twice the target resolution (the service caps
single exports at 4000 px), downsampled with Lanczos to 4096² and 2048² and
saved as WebP into public/scenery. Tiles are cached in the given directory.
Bounds are EPSG:3857 metres and must match lib/bay-surface.ts.
"""
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from PIL import Image

SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
# name: (bounds, output size, tile size, grid). The climb layer is a 6 × 6
# mosaic of 2048² tiles downsampled 2× to 6144² (1.46 m/px) over the
# climb-out area where the aircraft is lowest.
LAYERS = {
    'runway': ([-13623646.065, 4524879.257, -13621046.065, 4527479.257], 4096, 2048, 4),
    'south': ([-13631947.74, 4525293.17, -13615947.74, 4541293.17], 4096, 2048, 4),
    'north': ([-13636902.989, 4542449.687, -13620902.989, 4558449.687], 4096, 2048, 4),
    'city': ([-13636000.0, 4545000.0, -13623712.0, 4557288.0], 8192, 2048, 4),
    'climb': ([-13632500.0, 4526800.0, -13623500.0, 4535800.0], 6144, 2048, 6),
}
only = set(sys.argv[2:])
cache = pathlib.Path(sys.argv[1])
cache.mkdir(parents=True, exist_ok=True)
target = pathlib.Path(__file__).resolve().parents[1] / 'public/scenery'

def fetch(bbox, path, tile):
    if path.exists() and path.stat().st_size > 1000:
        return
    query = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=3857, imageSR=3857,
                 size=f'{tile},{tile}', format='png', bandIds='0,1,2',
                 interpolation='RSP_CubicConvolution', f='image')
    url = SERVICE + '?' + urllib.parse.urlencode(query)
    for attempt in range(5):
        try:
            data = urllib.request.urlopen(url, timeout=180).read()
            if not data.startswith(b'\x89PNG'):
                raise RuntimeError(data[:200])
            path.write_bytes(data)
            return
        except Exception as error:  # noqa: BLE001 - retry any transport error
            print('retry', path.name, attempt, str(error)[:120], flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f'failed {path}')

for name, ((x0, y0, x1, y1), size, TILE, GRID) in LAYERS.items():
    if only and name not in only:
        continue
    width, height = (x1 - x0) / GRID, (y1 - y0) / GRID
    mosaic = Image.new('RGB', (TILE * GRID, TILE * GRID))
    for row in range(GRID):
        for column in range(GRID):
            bbox = [x0 + column * width, y1 - (row + 1) * height,
                    x0 + (column + 1) * width, y1 - row * height]
            path = cache / f'naip-{name}-{row}-{column}.png'
            fetch(bbox, path, TILE)
            tile = Image.open(path).convert('RGB')
            assert tile.size == (TILE, TILE), tile.size
            mosaic.paste(tile, (column * TILE, row * TILE))
            print(f'{name} tile {row},{column}', flush=True)
    full = mosaic.resize((size, size), Image.LANCZOS)
    full.save(target / f'naip-{name}.webp', 'WEBP', quality=80 if size > 4096 else 84, method=6)
    if size <= 4096:
        full.resize((2048, 2048), Image.LANCZOS).save(
            target / f'naip-{name}-mobile.webp', 'WEBP', quality=82, method=6)
    print(f'naip-{name}.webp: {(x1 - x0) / size:.2f} m/px, '
          f'{(target / f"naip-{name}.webp").stat().st_size:,} bytes', flush=True)
