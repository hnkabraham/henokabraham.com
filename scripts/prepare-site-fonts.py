"""Prepare local Google Sans web fonts: python prepare-site-fonts.py <download folder>.

Requires fonttools[woff]. Keep Latin, extended Latin, combining marks, punctuation
and symbols; other scripts use the browser fallback. Preserve all variable axes.
"""
from hashlib import sha256
from pathlib import Path
import shutil
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

source = Path(sys.argv[1])
output = Path(__file__).resolve().parents[1] / 'public' / 'fonts'
output.mkdir(parents=True, exist_ok=True)
unicodes = subset.parse_unicodes(
    'U+0000-024F,U+02B0-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,'
    'U+20A0-20CF,U+2100-22FF,U+2C60-2C7F,U+A720-A7FF,U+FEFF,U+FFFD'
)
for style, name in [
    ('regular', 'GoogleSans-VariableFont_GRAD,opsz,wght.ttf'),
    ('italic', 'GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf'),
]:
    font = TTFont(source / name, recalcTimestamp=False)
    options = subset.Options()
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.layout_features = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff2'
    temporary = output / f'google-sans-{style}.woff2'
    font.save(temporary)
    digest = sha256(temporary.read_bytes()).hexdigest()[:12]
    target = output / f'google-sans-{style}-{digest}.woff2'
    temporary.replace(target)
    print(f'{target.name}: {target.stat().st_size:,} bytes')
shutil.copyfile(source / 'OFL.txt', output / 'Google-Sans-OFL.txt')
