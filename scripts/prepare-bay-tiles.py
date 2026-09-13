#!/usr/bin/env python3
"""Schedule and cut the streamed ground tiles for the Bay flight.

  python3 scripts/prepare-bay-tiles.py schedule
  python3 scripts/prepare-bay-tiles.py build --cache /path/to/chunk-cache

The camera is locked to the scroll path, so the ground every frame will
look at is known in advance. `schedule` replays the flight's own camera
composition (a port of sampleBayFlight/sampleBayCamera in lib/bay-flight.ts)
for every scroll bucket and several viewport aspects, marches a grid of
view rays against the terrain grid, and records which tile of a six-level
pyramid (0.30 to 9.6 Web Mercator metres per texel, 256 px
tiles on a 256 × 256 page grid) each ground hit needs for about one texel
per screen pixel. Ancestors are added so a coarser lookup always finds a
page. The coarsest level over the whole region (with the next level along the
corridor) is a permanent floor, and the 2.4 m level over the airport square
is wanted while the aircraft is low, so the ground never falls back to the
10 m base map. The result is
archive/tiles/manifest.json: per bucket, the tile ids to have resident,
coarse first, plus the floor and airport sets.

`build` fetches the two finest levels from San Mateo County's 2022
orthoimagery service (0.5 ft source, reprojected by the service) in blocks
of 15 × 15 tiles with a border margin, fills the county's coverage gaps
and takes the two coarser levels from USGS NAIP, matches the county tone
to the NAIP corridor layer with one per-channel linear fit, and writes
archive/tiles/<level>-<x>-<y>.webp with 4 px borders for filtering.
"""
import argparse
import io
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
TILES = ROOT / 'public' / 'tiles'
SCENERY = ROOT / 'public' / 'scenery'

# ---- the pyramid ------------------------------------------------------------
PAGES = 256          # page grid at level 0
TILE = 256           # pixels per tile
BORDER = 4           # filtering border on every side
LEVELS = 6
RES0 = 0.3           # Web Mercator metres per texel at level 0
PAGE = TILE * RES0   # 76.8 m per level-0 page
# Page grid origin (south-west), chosen so the airport, the roll and the
# climb-out sit inside 256 × 256 pages (19.66 km).
WEST, SOUTH = -13632500.0, 4521200.0
EAST, NORTH = WEST + PAGES * PAGE, SOUTH + PAGES * PAGE
STEP = 0.005         # scroll progress per bucket
LOD_BIAS = 0.15      # a little blur tolerance saves a lot of tiles
MERC_SCALE = 1.262   # Web Mercator metres per real metre at 37.6° N
# Reference viewports: width, height in device pixels (a 1.5× laptop).
VIEWPORTS = [(2160, 1215), (1620, 1215), (2835, 1215), (900, 1600)]

# ---- the flight, ported from lib/bay-flight.ts --------------------------------
BAY_ORIGIN = (5666.01015, 8672.84973)
KEYS = [
    (0.0, (0, 0, 0), (0, 0, 0), (-95, -3, 110)),
    (0.15, (0, 0, 0), (0, 0, 0), (-75, -4, 115)),
    (0.37, (-2440, 0, -1268), (-14500, 0, -7535), (-30, 1, 135)),
    (0.49, (-3860, 190, -2200), (-6500, 3500, -16000), (90, 45, 130)),
    (0.68, (-4650, 1300, -9500), (-2000, 8200, -49000), (130, 95, 105)),
    (0.84, (-4800, 2700, -19000), (-6000, 9000, -48000), (110, 100, 130)),
    (1.0, (-7200, 4100, -24000), (-15000, 6000, -26000), (-120, 90, 130)),
]


def clamp01(v):
    return min(1.0, max(0.0, v))


def smooth(v):
    t = clamp01(v)
    return t * t * (3 - 2 * t)


def sample_flight(p):
    p = clamp01(p)
    i = max(1, next(k for k, key in enumerate(KEYS) if key[0] >= p))
    a, b = KEYS[i - 1], KEYS[i]
    duration = b[0] - a[0]
    t = clamp01((p - a[0]) / duration)
    t2, t3 = t * t, t * t * t
    position = [
        (2 * t3 - 3 * t2 + 1) * a[1][j] + (t3 - 2 * t2 + t) * duration * a[2][j]
        + (-2 * t3 + 3 * t2) * b[1][j] + (t3 - t2) * duration * b[2][j]
        for j in range(3)
    ]
    camera = [a[3][j] + (b[3][j] - a[3][j]) * smooth(t) for j in range(3)]
    return position, camera


def sample_camera(p, aspect):
    position, camera = sample_flight(p)
    portrait = aspect < 1
    bookend = 1 - smooth((p - 0.16) / 0.15) + smooth((p - 0.86) / 0.1)
    fov = 29 + 8 * smooth((p - 0.4) / 0.34)
    lens = math.tan(math.radians(39) / 2) / math.tan(math.radians(fov) / 2)
    offset = [n * (1.85 if portrait else 1) * lens for n in camera]
    return {
        'plane': (position[0], position[1] + 12.33, position[2]),
        'offset': offset,
        'offsetX': 0 if portrait else -0.18,
        'offsetY': -0.18 * bookend if portrait else 0.08 - 0.095 * bookend,
        'fov': fov,
    }


def mercator(sx, sy):
    return (12.632550004563015 * sx - 0.072422595551702 * sy - 13691784.723241135,
            -0.07970501185485107 * sx - 12.68491441838439 * sy + 4635494.015743029)


def local_to_mercator(x, z):
    return mercator(x / 10 + BAY_ORIGIN[0], z / 10 + BAY_ORIGIN[1])


class Terrain:
    def __init__(self):
        image = Image.open(SCENERY / 'bay-elevation.webp').convert('RGBA')
        a = np.asarray(image).astype(np.float32)
        self.grid = (a[..., 0] * 256 + a[..., 1]) / 4.0
        self.size = image.width

    def sample(self, x, z):
        last = self.size - 1
        col = np.clip((x / 10 + BAY_ORIGIN[0] - 3500) / 4800 * last, 0, last - 1)
        row = np.clip((z / 10 + BAY_ORIGIN[1] - 5200) / 4800 * last, 0, last - 1)
        c0 = np.floor(col).astype(int)
        r0 = np.floor(row).astype(int)
        fx, fz = col - c0, row - r0
        g = self.grid
        return ((g[r0, c0] * (1 - fx) + g[r0, c0 + 1] * fx) * (1 - fz)
                + (g[r0 + 1, c0] * (1 - fx) + g[r0 + 1, c0 + 1] * fx) * fz)


def tile_id(level, x, y):
    return (level << 16) | (y << 8) | x


def march(terrain, camera, width, height, stride=6):
    """Ground hits and their required pyramid level for one composition."""
    plane = np.array(camera['plane'])
    origin = plane + np.array(camera['offset'])
    forward = plane - origin
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    half = math.tan(math.radians(camera['fov']) / 2)
    aspect = width / height
    xs = (np.arange(0, width, stride) + 0.5) / width + camera['offsetX']
    ys = (np.arange(0, height, stride) + 0.5) / height + camera['offsetY']
    sx, sy = np.meshgrid(xs * 2 - 1, 1 - ys * 2)
    sx, sy = sx.ravel(), sy.ravel()
    dirs = (forward[None, :] + (sx * half * aspect)[:, None] * right[None, :]
            + (sy * half)[:, None] * up[None, :])
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    # Only rays that can reach the ground.
    keep = dirs[:, 1] < -0.002
    dirs = dirs[keep]
    n = len(dirs)
    t = np.full(n, 2.0)
    hit = np.zeros(n, dtype=bool)
    t_hit = np.zeros(n)
    active = np.ones(n, dtype=bool)
    for _ in range(400):
        if not active.any():
            break
        p = origin[None, :] + dirs * t[:, None]
        ground = terrain.sample(p[:, 0], p[:, 2])
        below = (p[:, 1] < ground) & active
        # Refine the crossing between the previous and current step.
        if below.any():
            lo = t[below] / 1.04 - 3
            hi = t[below]
            d = dirs[below]
            for _ in range(6):
                mid = (lo + hi) / 2
                pm = origin[None, :] + d * mid[:, None]
                inside = pm[:, 1] < terrain.sample(pm[:, 0], pm[:, 2])
                hi = np.where(inside, mid, hi)
                lo = np.where(inside, lo, mid)
            t_hit[below] = (lo + hi) / 2
            hit |= below
            active &= ~below
        t = np.where(active, t * 1.04 + 3, t)
        active &= t < 40000
    if not hit.any():
        return []
    d = dirs[hit]
    dist = t_hit[hit]
    p = origin[None, :] + d * dist[:, None]
    pixel = 2 * half / height
    grazing = np.clip(-d[:, 1], 0.06, 1.0)
    footprint = pixel * dist / grazing * MERC_SCALE  # along-view, Mercator metres
    level = np.floor(np.log2(footprint / RES0) + LOD_BIAS).astype(int)
    mx = 12.632550004563015 * (p[:, 0] / 10 + BAY_ORIGIN[0]) - 0.072422595551702 * (p[:, 2] / 10 + BAY_ORIGIN[1]) - 13691784.723241135
    my = -0.07970501185485107 * (p[:, 0] / 10 + BAY_ORIGIN[0]) - 12.68491441838439 * (p[:, 2] / 10 + BAY_ORIGIN[1]) + 4635494.015743029
    ok = (level < LEVELS) & (mx >= WEST) & (mx < EAST) & (my >= SOUTH) & (my < NORTH)
    level = np.clip(level[ok], 0, LEVELS - 1)
    px = ((mx[ok] - WEST) / PAGE).astype(int) >> level
    py = ((my[ok] - SOUTH) / PAGE).astype(int) >> level
    return set(zip(level.tolist(), px.tolist(), py.tolist()))


def with_ancestors(tiles):
    out = set(tiles)
    for level, x, y in tiles:
        while level < LEVELS - 1:
            level, x, y = level + 1, x >> 1, y >> 1
            out.add((level, x, y))
    return out


def schedule():
    terrain = Terrain()
    buckets = []
    everything = set()
    started = time.time()
    count = int(round(1 / STEP))
    for b in range(count + 1):
        needed = set()
        for sub in (0.0, 0.5, 1.0):
            p = min(1.0, (b + sub) * STEP)
            for width, height in VIEWPORTS:
                needed |= march(terrain, sample_camera(p, width / height), width, height)
        needed = with_ancestors(needed)
        everything |= needed
        ordered = sorted(needed, key=lambda t: (-t[0], t[2], t[1]))
        buckets.append([tile_id(*t) for t in ordered])
        if b % 20 == 0:
            print(f'bucket {b}/{count}: {len(needed)} tiles, {len(everything)} unique so far, {time.time() - started:.0f}s', flush=True)
    # Floor: the coarsest level over the whole page grid (64 tiles at 9.6 m),
    # plus the next level wherever anything finer was scheduled.
    floor = set()
    n = PAGES >> (LEVELS - 1)
    for y in range(n):
        for x in range(n):
            floor.add((LEVELS - 1, x, y))
    floor |= {t for t in everything if t[0] == LEVELS - 2}
    # The airport square at 2.4 m whenever the aircraft is low.
    airport = set()
    sfo = (-13626825.603526574, 4521217.699661355, -13618619.768127132, 4529423.535060797)
    L = 3
    span = PAGE * (1 << L)
    for y in range(int((sfo[1] - SOUTH) / span), int((sfo[3] - SOUTH) / span) + 1):
        for x in range(int((sfo[0] - WEST) / span), int((sfo[2] - WEST) / span) + 1):
            if 0 <= x < (PAGES >> L) and 0 <= y < (PAGES >> L):
                airport.add((L, x, y))
    airport = with_ancestors(airport)
    floor |= {t for t in airport if t[0] == LEVELS - 2}
    everything |= floor | airport
    per_level = {L: sum(1 for t in everything if t[0] == L) for L in range(LEVELS)}
    TILES.mkdir(parents=True, exist_ok=True)
    manifest = {
        'version': 1,
        'source': 'San Mateo County GIS 2022 orthoimagery; USGS NAIP where the county has no coverage',
        'bounds': [WEST, SOUTH, EAST, NORTH],
        'pages': PAGES, 'tile': TILE, 'border': BORDER, 'levels': LEVELS,
        'resolution': RES0, 'step': STEP, 'lodBias': LOD_BIAS,
        'tiles': len(everything),
        'perLevel': per_level,
        'floor': [tile_id(*t) for t in sorted(floor, key=lambda t: (-t[0], t[2], t[1]))],
        'airport': {'until': 0.46, 'tiles': [tile_id(*t) for t in sorted(airport, key=lambda t: (-t[0], t[2], t[1]))]},
        'buckets': buckets,
    }
    (TILES / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    print(f'{len(everything)} tiles scheduled, per level {per_level}; '
          f'largest bucket {max(len(b) for b in buckets)}, mean {sum(len(b) for b in buckets) / len(buckets):.0f}')


# ---- imagery ------------------------------------------------------------------
COUNTY = ('https://gis.smcgov.org/image/rest/services/'
          'SanMateoCounty_Imagery2022/ImageServer/exportImage')
NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
BLOCK = 15  # tiles per block edge; 15 × 256 + 2 × 4 = 3848 px stays under the county's 4100 cap


def export(service, bbox, size, path):
    if path.exists() and path.stat().st_size > 1000:
        return Image.open(path).convert('RGB')
    query = dict(bbox=','.join(f'{v:.3f}' for v in bbox), bboxSR=3857, imageSR=3857,
                 size=f'{size},{size}', format='png', f='image',
                 interpolation='RSP_BilinearInterpolation')
    if service == NAIP:
        query['bandIds'] = '0,1,2'  # natural colour; the default can be the infrared composite
    url = service + '?' + urllib.parse.urlencode(query)
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(url, timeout=300).read()
            if not data.startswith(b'\x89PNG'):
                raise RuntimeError(data[:120])
            path.write_bytes(data)
            return Image.open(io.BytesIO(data)).convert('RGB')
        except Exception as error:  # noqa: BLE001 - retry any transport error
            print('retry', path.name, attempt, str(error)[:100], flush=True)
            time.sleep(6 * (attempt + 1))
    raise SystemExit(f'failed {path}')


def block_bbox(level, bx, by):
    res = RES0 * (1 << level)
    span = BLOCK * TILE * res
    x0 = WEST + bx * span - BORDER * res
    y0 = SOUTH + by * span - BORDER * res
    return [x0, y0, x0 + span + 2 * BORDER * res, y0 + span + 2 * BORDER * res]


# The county service only answers usefully near its native scale: at the
# two coarsest levels it returns near-white overviews, so those come from
# NAIP (0.6 m source, plenty for 1.2 and 2.4 m texels).
COUNTY_LEVELS = {0, 1}


def fetch_block(level, bx, by, cache):
    bbox = block_bbox(level, bx, by)
    size = BLOCK * TILE + 2 * BORDER
    if level not in COUNTY_LEVELS:
        return export(NAIP, bbox, size, cache / f'naip-{level}-{bx}-{by}.png'), bbox
    image = export(COUNTY, bbox, size, cache / f'county-{level}-{bx}-{by}.png')
    a = np.asarray(image)
    # Outside its coverage the county service returns black (or white at
    # coarse scales); NAIP fills those pixels, dilated a little so the seam
    # is not a hairline.
    nodata = (a.max(axis=2) < 8) | (a.min(axis=2) > 250)
    if nodata.mean() > 0.002:
        print(f'  block {level}/{bx}/{by}: {nodata.mean() * 100:.1f}% outside the county, filling from NAIP', flush=True)
        naip = np.asarray(export(NAIP, bbox, size, cache / f'naip-{level}-{bx}-{by}.png'))
        mask = Image.fromarray((nodata * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(5))
        m = (np.asarray(mask) > 0)[..., None]
        image = Image.fromarray(np.where(m, naip, a).astype(np.uint8), 'RGB')
    return image, bbox


def fit_tone(samples):
    """Per-channel gain and offset from (county, naip) low-pass pairs."""
    fits = []
    county = np.concatenate([s[0] for s in samples]).reshape(-1, 3).astype(np.float64)
    naip = np.concatenate([s[1] for s in samples]).reshape(-1, 3).astype(np.float64)
    # Only pixels both sources actually cover.
    valid = (county.max(axis=1) > 12) & (naip.max(axis=1) > 12)
    county, naip = county[valid], naip[valid]
    assert len(county) > 2000, 'too few overlapping pixels for the tone fit'
    for channel in range(3):
        gain, offset = np.polyfit(county[:, channel], naip[:, channel], 1)
        assert 0.35 < gain < 1.6, f'implausible tone gain {gain:.3f}'
        # A full match: the coarser levels are NAIP, and a level boundary
        # must not read as a tone boundary.
        fits.append((gain, offset))
    return fits


def build(cache):
    manifest = json.loads((TILES / 'manifest.json').read_text())
    ids = set(manifest['floor']) | set(manifest['airport']['tiles'])
    for bucket in manifest['buckets']:
        ids |= set(bucket)
    needed = sorted((i >> 16, i & 255, (i >> 8) & 255) for i in ids)
    south = Image.open(SCENERY / 'naip-south.webp').convert('RGB')
    sw, ss, se, sn = -13631947.74, 4525293.17, -13615947.74, 4541293.17
    blocks = {}
    for level, x, y in needed:
        blocks.setdefault((level, x // BLOCK, y // BLOCK), []).append((x, y))
    print(f'{len(needed)} tiles in {len(blocks)} blocks', flush=True)
    # Fetch everything first so the tone fit sees the whole set.
    images = {}
    samples = []
    for key in sorted(blocks, key=lambda k: (-k[0], k[1], k[2])):
        level, bx, by = key
        image, bbox = fetch_block(level, bx, by, cache)
        images[key] = (image, bbox)
        # Compare the part of each coarsest block that the NAIP corridor
        # layer also covers, both resampled to 64² low-pass copies.
        overlap = [max(bbox[0], sw), max(bbox[1], ss), min(bbox[2], se), min(bbox[3], sn)]
        if level == max(COUNTY_LEVELS) and overlap[2] - overlap[0] > 1500 and overlap[3] - overlap[1] > 1500:
            px = lambda v: (v - sw) / (se - sw) * south.width
            py = lambda v: (sn - v) / (sn - ss) * south.height
            naip_crop = south.crop((int(px(overlap[0])), int(py(overlap[3])), int(px(overlap[2])), int(py(overlap[1]))))
            bx0 = lambda v: (v - bbox[0]) / (bbox[2] - bbox[0]) * image.width
            by0 = lambda v: (bbox[3] - v) / (bbox[3] - bbox[1]) * image.height
            county_crop = image.crop((int(bx0(overlap[0])), int(by0(overlap[3])), int(bx0(overlap[2])), int(by0(overlap[1]))))
            samples.append((np.asarray(county_crop.resize((64, 64), Image.BOX)), np.asarray(naip_crop.resize((64, 64), Image.BOX))))
        print(f'  fetched {level}/{bx}/{by} ({len(images)}/{len(blocks)})', flush=True)
    fits = fit_tone(samples)
    print('tone fit', [(round(g, 3), round(o, 1)) for g, o in fits], flush=True)
    TILES.mkdir(parents=True, exist_ok=True)
    total = 0
    written = 0
    for key, pages in blocks.items():
        level, bx, by = key
        image, _ = images[key]
        if level in COUNTY_LEVELS:
            a = np.asarray(image).astype(np.float32)
            for channel, (gain, offset) in enumerate(fits):
                a[..., channel] = a[..., channel] * gain + offset
            block = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB')
        else:
            block = image
        for x, y in pages:
            left = (x - bx * BLOCK) * TILE
            top = (by * BLOCK + BLOCK - 1 - y) * TILE
            tile = block.crop((left, top, left + TILE + 2 * BORDER, top + TILE + 2 * BORDER))
            out = TILES / f'{level}-{x}-{y}.webp'
            tile.save(out, 'WEBP', quality=80, method=4)
            total += out.stat().st_size
            written += 1
    manifest['bytes'] = total
    (TILES / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    print(f'{written} tiles, {total / 1e6:.1f} MB', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['schedule', 'build'])
    parser.add_argument('--cache')
    args = parser.parse_args()
    if args.command == 'schedule':
        schedule()
    else:
        if not args.cache:
            sys.exit('--cache is required for build')
        cache = pathlib.Path(args.cache)
        cache.mkdir(parents=True, exist_ok=True)
        build(cache)
