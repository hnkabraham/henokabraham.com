# Packs the Dolores Park scene's data into scene.json (local metres, x east,
# y north): buildings (DataSF LiDAR footprints, OSM where DataSF has none),
# downtown towers, street trees, roads, and the terrain grid as a float32 file.
# Usage: python3 scripts/dolores-park/bundle.py /path/to/cache [out dir]
# The cache is what `fetch.py data` downloads; the output defaults to
# archive/scenery/dolores/. Needs numpy, pillow and matplotlib.
import sys, json, math
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from geo import local, DEM_BBOX

d = sys.argv[1]
o = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parents[2] / 'archive/scenery/dolores')
dem = np.array(Image.open(f'{d}/data/dem.tif')).astype(np.float32)
H, W = dem.shape
gx0, gy1 = local(DEM_BBOX[0], DEM_BBOX[3]); gx1, gy0 = local(DEM_BBOX[2], DEM_BBOX[1])
def ground(x, y):
    c = np.clip(((np.asarray(x) - gx0) / (gx1 - gx0) * W).astype(int), 0, W - 1)
    r = np.clip(((gy1 - np.asarray(y)) / (gy1 - gy0) * H).astype(int), 0, H - 1)
    return dem[r, c]

def ring_area(xy):
    x, y = xy[:, 0], xy[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))

def clean(xy):
    xy = np.asarray(xy, dtype=np.float64)
    if np.allclose(xy[0], xy[-1]): xy = xy[:-1]
    if ring_area(xy) < 0: xy = xy[::-1]          # counter-clockwise
    return xy

buildings = []
def add(xy, base, height, src):
    if len(xy) < 3 or abs(ring_area(xy)) < 6: return
    buildings.append({'p': np.round(xy, 2).tolist(), 'b': round(float(base), 2), 'h': round(float(height), 2), 's': src})

for b in json.load(open(f'{d}/data/bldg-near.json')):
    h = float(b.get('hgt_median_m') or 0)
    if h < 2: continue
    for poly in b['shape']['coordinates']:
        ring = np.array(poly[0]); x, y = local(ring[:, 0], ring[:, 1])
        xy = clean(np.stack([x, y], 1))
        base = float(b.get('gnd_min_m') or ground(*xy.mean(0)))
        add(xy, base, h, 'sf')

# OSM fills blocks DataSF leaves empty: keep an OSM outline only if no DataSF
# footprint centroid falls inside it and its centroid sits in no DataSF one.
from matplotlib.path import Path as MPath
sf_paths = [MPath(np.array(b['p'])) for b in buildings]
sf_cent = np.array([np.mean(b['p'], 0) for b in buildings])
osm = json.load(open(f'{d}/data/osm.json'))['elements']
filled = 0
for e in osm:
    t = e.get('tags', {})
    if 'building' not in t or 'geometry' not in e: continue
    g = e['geometry']; x, y = local([p['lon'] for p in g], [p['lat'] for p in g])
    xy = clean(np.stack([x, y], 1))
    if len(xy) < 3: continue
    c = xy.mean(0)
    near = np.nonzero(np.hypot(*(sf_cent - c).T) < 60)[0]
    path = MPath(xy)
    if any(sf_paths[i].contains_point(c) for i in near) or any(path.contains_point(sf_cent[i]) for i in near):
        continue
    try:
        h = float(str(t.get('height', '')).split()[0])
    except (ValueError, IndexError):
        levels = str(t.get('building:levels', ''))
        h = float(levels) * 3.3 if levels.replace('.', '').isdigit() else 10.0
    add(xy, float(ground(xy[:, 0], xy[:, 1]).min()), h, 'osm'); filled += 1

# The city between the park and downtown: every footprint over 4 m from the
# two mid boxes and the towers over 22 m beyond them, deduplicated. Two
# landmarks the 2016 survey caught unfinished or flattened are modelled in
# the scene instead (their footprints are dropped here).
LANDMARKS = {'salesforce': (-122.39693, 37.78975), 'transamerica': (-122.40279, 37.79516)}
marks = {k: local(*v) for k, v in LANDMARKS.items()}
city, seen = [], set()
import glob
for path in sorted(glob.glob(f'{d}/data/mid-*.json')) + [f'{d}/data/bldg-far.json']:
    for b in json.load(open(path)):
        h = float(b.get('hgt_median_m') or 0)
        if h < 4: continue
        for poly in b['shape']['coordinates']:
            ring = np.array(poly[0]); x, y = local(ring[:, 0], ring[:, 1])
            xy = clean(np.stack([x, y], 1))
            if abs(ring_area(xy)) < 20: continue
            c = xy.mean(0)
            key = (round(c[0]), round(c[1]))
            if key in seen: continue
            seen.add(key)
            if any(np.hypot(c[0] - mx, c[1] - my) < 45 for mx, my in marks.values()): continue
            city.append({'p': np.round(xy, 1).tolist(), 'b': round(float(b.get('gnd_min_m') or 5), 1), 'h': round(h, 1)})
towers = city

trees = []
for t in json.load(open(f'{d}/data/trees.json')):
    if 'latitude' not in t: continue
    x, y = local(float(t['longitude']), float(t['latitude']))
    sp = t.get('species', '')
    kind = 'palm' if 'Phoenix' in sp else ('palm2' if ('Washingtonia' in sp or 'Syagrus' in sp) else 'tree')
    try: dbh = float(t.get('dbh') or t.get('mapdbh') or 8)
    except ValueError: dbh = 8
    trees.append({'x': round(float(x), 2), 'y': round(float(y), 2), 'z': round(float(ground(x, y)), 2), 'k': kind, 'd': min(dbh, 60)})

# Canopies the street-tree list doesn't hold (the park's own trees and
# back gardens), from the NAIP photo: dark green 2 m cells outside
# buildings, packed greedily.
from matplotlib.path import Path as MP2
naip = np.asarray(Image.open(f'{d}/ortho/naip.png').convert('RGB')).astype(np.float64)
NX0, NY1, KX, KY = -650, 950, 4000 / 1400, 3173 / 1400
r_, g_, b_ = naip[..., 0], naip[..., 1], naip[..., 2]
lum = (r_ + g_ + b_) / 3
# This NAIP pass runs cool (lawn reads bluer than green), so canopy is just
# darker than the lawn with a strict green excess (reject blue house shadows).
canopy = (g_ > r_ + 10) & (lum < 100) & (lum > 25) & (g_ > b_ - 25)
cell = 2.0
cx = np.arange(-640, 660, cell); cy = np.arange(-440, 700, cell)
CX, CY = np.meshgrid(cx, cy)
# fraction of canopy pixels per cell (sample a 5x5 lattice in each)
frac = np.zeros(CX.shape)
for ox in np.linspace(-0.8, 0.8, 5):
    for oy in np.linspace(-0.8, 0.8, 5):
        col = np.clip(((CX + ox - NX0) * KX).astype(int), 0, 3999)
        row = np.clip(((NY1 - (CY + oy)) * KY).astype(int), 0, 3172)
        frac += canopy[row, col]
frac /= 25
pts = np.stack([CX.ravel(), CY.ravel()], 1)
inside = np.zeros(len(pts), bool)
for bd in buildings:
    P = np.array(bd['p']); lo, hi = P.min(0) - 1, P.max(0) + 1
    m = np.nonzero((pts[:, 0] > lo[0]) & (pts[:, 0] < hi[0]) & (pts[:, 1] > lo[1]) & (pts[:, 1] < hi[1]))[0]
    if len(m): inside[m[MP2(P).contains_points(pts[m])]] = True
# Road corridors from OSM (house shadows on the street read as canopy).
WIDTHS = {'primary': 20, 'secondary': 16, 'tertiary': 14, 'residential': 11, 'service': 5, 'living_street': 6,
          'unclassified': 11, 'primary_link': 10, 'secondary_link': 8, 'tertiary_link': 7,
          'footway': 2, 'path': 2, 'pedestrian': 4, 'cycleway': 2, 'steps': 2, 'track': 3}
def road_width(tags):
    # OSM width is metres unless explicitly suffixed. Prefer surveyed widths.
    try:
        value = str(tags.get('width', '')).strip().removesuffix('m').strip()
        width = float(value)
        if 0 < width < 100: return width
    except ValueError:
        pass
    return WIDTHS.get(tags.get('highway'), 11)
segs = []
for e in osm:
    hw = e.get('tags', {}).get('highway')
    if not hw or 'geometry' not in e: continue
    gx_, gy_ = local([q['lon'] for q in e['geometry']], [q['lat'] for q in e['geometry']])
    for i in range(len(gx_) - 1):
        segs.append((gx_[i], gy_[i], gx_[i + 1], gy_[i + 1], road_width(e['tags']) / 2 + 1.0))
segs = np.array(segs).reshape(-1, 5)
def on_road(x, y):
    if not len(segs): return False
    ax, ay, bx, by, hw = segs.T
    dx, dy = bx - ax, by - ay
    t = np.clip(((x - ax) * dx + (y - ay) * dy) / np.maximum(dx * dx + dy * dy, 1e-9), 0, 1)
    return bool((np.hypot(ax + t * dx - x, ay + t * dy - y) < hw).any())
order = np.argsort(-frac.ravel())
taken = np.zeros(len(pts), bool)
street = np.array([(t['x'], t['y']) for t in trees])
rng = np.random.default_rng(7)
extra = 0
for i in order:
    f = frac.ravel()[i]
    if f < 0.55: break
    if taken[i] or inside[i]: continue
    x, y = pts[i]
    if len(street) and np.min(np.hypot(*(street - (x, y)).T)) < 4: continue
    if on_road(x, y): continue
    rad = rng.uniform(2.2, 3.8)
    near = np.hypot(pts[:, 0] - x, pts[:, 1] - y) < rad * 1.1
    taken |= near
    trees.append({'x': round(float(x), 2), 'y': round(float(y), 2), 'z': round(float(ground(x, y)), 2), 'k': 'canopy', 'd': round(rad, 2)})
    extra += 1
print('canopies from NAIP', extra)

roads = []
WIDTH = {'primary': 20, 'secondary': 16, 'tertiary': 14, 'residential': 11, 'service': 5, 'living_street': 6}
for e in osm:
    t = e.get('tags', {}); hw = t.get('highway')
    if hw not in WIDTH or 'geometry' not in e: continue
    g = e['geometry']; x, y = local([p['lon'] for p in g], [p['lat'] for p in g])
    roads.append({'p': np.round(np.stack([x, y], 1), 2).tolist(), 'w': road_width(t), 'n': t.get('name', ''), 'k': hw, 'o': t.get('oneway', '')})

# Terrain: the DEM at 2 m, north-up rows.
# 1500 x 1400 px over the bbox: 1.0 m east-west, 1.11 m north-south.
step = 2
grid = dem[::step, ::step]
grid.astype('<f4').tofile(f'{o}/terrain.f32')
out = {
    'terrain': {'w': grid.shape[1], 'h': grid.shape[0], 'x0': gx0, 'x1': gx1, 'y0': gy0, 'y1': gy1},
    'buildings': buildings, 'towers': towers, 'trees': trees, 'roads': roads,
    'landmarks': {k: [round(float(v[0]), 1), round(float(v[1]), 1)] for k, v in marks.items()},
}
json.dump(out, open(f'{o}/scene.json', 'w'))
print('buildings', len(buildings), '(osm fill', filled, ') towers', len(towers), 'trees', len(trees),
      'palms', sum(t['k'] == 'palm' for t in trees), 'roads', len(roads), 'terrain', grid.shape)
