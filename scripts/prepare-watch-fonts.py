"""Prepare the watch showcase's two web fonts: python prepare-watch-fonts.py <download folder>.

The folder holds Google Fonts' Barlow-Bold.ttf and RobotoCondensed[wght].ttf
with their OFL.txt files (saved as Barlow-OFL.txt and RobotoCondensed-OFL.txt).
Requires fonttools[woff]. Roboto Condensed Bold is the watch's own label face;
Barlow Bold stands in for the numerals, whose device font is Garmin's and stays
on the watch. Both are cut down to what the faces draw: printable ASCII, the
degree sign and the middle dot.
"""
from hashlib import sha256
from pathlib import Path
import shutil
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

source = Path(sys.argv[1])
output = Path(__file__).resolve().parents[1] / 'public' / 'fonts'
output.mkdir(parents=True, exist_ok=True)
unicodes = subset.parse_unicodes('U+0020-007E,U+00B0,U+00B7')
for name, file, axes in [
    ('watch-numerals', 'Barlow-Bold.ttf', None),
    ('watch-labels', 'RobotoCondensed[wght].ttf', {'wght': 700}),
]:
    font = TTFont(source / file, recalcTimestamp=False)
    if axes:
        font = instancer.instantiateVariableFont(font, axes)
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.layout_features = ['kern', 'tnum']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff2'
    temporary = output / f'{name}.woff2'
    font.save(temporary)
    digest = sha256(temporary.read_bytes()).hexdigest()[:12]
    target = output / f'{name}-{digest}.woff2'
    temporary.replace(target)
    print(f'{target.name}: {target.stat().st_size:,} bytes')
shutil.copyfile(source / 'Barlow-OFL.txt', output / 'Barlow-OFL.txt')
shutil.copyfile(source / 'RobotoCondensed-OFL.txt', output / 'Roboto-Condensed-OFL.txt')
