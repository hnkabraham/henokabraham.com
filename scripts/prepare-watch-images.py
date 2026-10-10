"""Prepare the watch showcase's images from the Bezel Auth project.

python prepare-watch-images.py "<Garmin Watch Face folder>"

Reads only the store images (auth_faces/store/upload-images: 500-pixel squares
with the 416-pixel screen centred, and 500 x 560 awake/standby captures with a
caption below) and Summit's own ridge artwork (assets/scenery). Writes:

- public/images/watch-faces/<face>.jpg/.avif: each cover's screen, 416 pixels,
  the still that shows before the live face is drawn (and without scripts);
- public/images/watch-faces/summit-ridge.webp: the ridge Summit draws behind
  its clock, at twice the 384 x 128 the watch scales it to;
- public/images/bezel-auth-modes.jpg/.avif: Summit awake above Summit in
  standby, for the Bezel Auth briefing's rail.
Requires Pillow with AVIF support.
"""
from pathlib import Path
import sys
from PIL import Image

FACES = ['summit', 'atelier', 'tactical', 'chrono', 'orbit', 'words']
source = Path(sys.argv[1])
uploads = source / 'auth_faces' / 'store' / 'upload-images'
public = Path(__file__).resolve().parents[1] / 'public' / 'images'
out = public / 'watch-faces'
out.mkdir(parents=True, exist_ok=True)


def save(image, stem, quality=86, avif_quality=64):
    image.save(f'{stem}.jpg', quality=quality, optimize=True, progressive=True)
    image.save(f'{stem}.avif', quality=avif_quality)
    for suffix in ('jpg', 'avif'):
        path = Path(f'{stem}.{suffix}')
        print(f'{path.relative_to(public.parent)}: {image.width}x{image.height}, {path.stat().st_size:,} bytes')


for face in FACES:
    cover = Image.open(uploads / f'{face}-cover.png').convert('RGB')
    save(cover.crop((42, 42, 458, 458)), out / face)

ridge = Image.open(source / 'assets' / 'scenery' / 'summit-alpine.png').convert('RGB')
ridge = ridge.resize((768, 256), Image.LANCZOS)
ridge.save(out / 'summit-ridge.webp', quality=82, method=6)
print(f'images/watch-faces/summit-ridge.webp: 768x256, {(out / "summit-ridge.webp").stat().st_size:,} bytes')

# The awake and standby captures share a frame: the screen sits 6 pixels
# lower than on the cover, above the caption, which is left out here.
size, margin, gap = 640, 25, 30
rail = Image.new('RGB', (size + 2 * margin, 2 * size + 2 * margin + gap), 'black')
for index, mode in enumerate(['awake', 'standby']):
    capture = Image.open(uploads / f'summit-{mode}.png').convert('RGB')
    screen = capture.crop((42, 48, 458, 464)).resize((size, size), Image.LANCZOS)
    rail.paste(screen, (margin, margin + index * (size + gap)))
save(rail, public / 'bezel-auth-modes', quality=84, avif_quality=60)
