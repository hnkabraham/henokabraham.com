"""Prepare the Bezel Auth briefing's rail from the Bezel Auth project.

python prepare-watch-images.py "<Garmin Watch Face folder>"

Reads only Summit's awake and standby store captures
(auth_faces/store/upload-images: 500 x 560, the 416-pixel screen above a
caption) and writes public/images/bezel-auth-modes.jpg/.avif: Summit awake
above Summit in standby. The showcase's stills are drawn by the ports
themselves (scripts/render-watch-stills.mjs). Requires Pillow with AVIF
support.
"""
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
uploads = source / 'auth_faces' / 'store' / 'upload-images'
public = Path(__file__).resolve().parents[1] / 'public' / 'images'


def save(image, stem, quality=86, avif_quality=64):
    image.save(f'{stem}.jpg', quality=quality, optimize=True, progressive=True)
    image.save(f'{stem}.avif', quality=avif_quality)
    for suffix in ('jpg', 'avif'):
        path = Path(f'{stem}.{suffix}')
        print(f'{path.relative_to(public.parent)}: {image.width}x{image.height}, {path.stat().st_size:,} bytes')


# The screen sits 6 pixels lower than on a store cover, above the caption,
# which is left out here.
size, margin, gap = 640, 25, 30
rail = Image.new('RGB', (size + 2 * margin, 2 * size + 2 * margin + gap), 'black')
for index, mode in enumerate(['awake', 'standby']):
    capture = Image.open(uploads / f'summit-{mode}.png').convert('RGB')
    screen = capture.crop((42, 48, 458, 464)).resize((size, size), Image.LANCZOS)
    rail.paste(screen, (margin, margin + index * (size + gap)))
save(rail, public / 'bezel-auth-modes', quality=84, avif_quality=60)
