#!/usr/bin/env python3
"""Cut the Bay base map from the ESA Sentinel-2 mosaic credited in ASSETS.md.

  python3 scripts/prepare-bay-basemap.py /path/to/San_Francisco_Bay.jpg

The source is ESA's 10,980 x 14,367 HI-RES JPG of the January 25, 2019
Sentinel-2 mosaic (CC BY-SA 3.0 IGO; contains modified Copernicus Sentinel
data (2019), processed by ESA). Crop and resize are the only edits, so the
scene's registration to the source's 10 m pixels still holds.

Two derivatives are written into archive/scenery:

  sf-bay.webp         4096 square, 11.7 m/px, desktop, loaded after the opening
  sf-bay-mobile.webp  2048 square, 23.4 m/px, every device, in the opening set

The base map is what the terrain falls back to wherever no NAIP corridor or
streamed tile covers the ground, which from progress 0.9 is most of what the
camera sees. At 23 m/px the ESA composite's dark hillsides magnify into
smeared shadow over Marin; the 4096 cut is within the resolution those
altitudes ask for.
"""
import pathlib
import sys

from PIL import Image

# The registered crop, in source pixels. Changing it invalidates
# public/credits/bay-georeferencing.json and the scene's origin.
CROP = (3500, 5200, 8300, 10000)
SIZES = {'sf-bay': (4096, 82), 'sf-bay-mobile': (2048, 84)}

Image.MAX_IMAGE_PIXELS = None
source = pathlib.Path(sys.argv[1])
target = pathlib.Path(__file__).resolve().parents[1] / 'archive/scenery'
image = Image.open(source).convert('RGB')
if image.size != (10980, 14367):
    raise SystemExit(f'unexpected source size {image.size}; expected the HI-RES JPG')
crop = image.crop(CROP)

for name, (size, quality) in SIZES.items():
    path = target / f'{name}.webp'
    crop.resize((size, size), Image.LANCZOS).save(
        path, 'WEBP', quality=quality, method=6)
    print(f'{path.name}: {size}², {(CROP[2] - CROP[0]) * 10 / size:.1f} m/px, '
          f'{path.stat().st_size:,} bytes')
