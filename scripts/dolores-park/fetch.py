# Downloads what the Dolores Park scene needs but this repository doesn't
# carry.
#
#   python3 scripts/dolores-park/fetch.py assets
#       The CC0 textures, sky, tree and car models listed in assets.json
#       (about 130 MB, most of it the tree's 95 MB buffer) into
#       archive/scenery/dolores/assets/, which is gitignored. Every file is
#       checked against its SHA-256; files already present and matching are
#       skipped. Needed before scripts/dolores-park/render.mjs.
#
#   python3 scripts/dolores-park/fetch.py data /path/to/cache
#       The raw public data that bundle.py packs into scene.json and
#       terrain.f32 (DataSF footprints and street trees, the USGS 1 m DEM,
#       a NAIP export and OpenStreetMap ways), as retrieved on 2026-10-10.
#       Only needed to rebuild the bundle: the committed
#       archive/scenery/dolores/ already holds its output. The services
#       update over time, so a fresh download won't reproduce those files
#       byte for byte.
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
AGENT = 'henokabraham.com-scene-build/1.0 (https://henokabraham.com)'


def get(url, data=None):
    request = urllib.request.Request(url, data=data, headers={'User-Agent': AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def assets():
    out = ROOT / 'archive/scenery/dolores/assets'
    for entry in json.loads((HERE / 'assets.json').read_text()):
        for f in entry['files']:
            path = out / f['path']
            if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == f['sha256']:
                continue
            print('fetching', f['url'])
            body = get(f['url'])
            digest = hashlib.sha256(body).hexdigest()
            if digest != f['sha256']:
                raise SystemExit(f"{f['path']}: SHA-256 {digest}, expected {f['sha256']}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
    print('assets complete in', out)


SODA = 'https://data.sf.gov/resource/'
FOOTPRINTS = SODA + 'ynuv-fyni.json'
EXPORT = 'https://{}.nationalmap.gov/arcgis/rest/services/{}/ImageServer/exportImage'
BOX = '37.7555,-122.4344,37.7682,-122.4185'
OVERPASS = (
    '[out:json][timeout:120];('
    + ''.join(f'way[{t}]({BOX});' for t in ('"building"', '"highway"', '"leisure"="park"', '"railway"'))
    + ');out geom tags;'
)


def soda(url, **query):
    return get(url + '?' + urllib.parse.urlencode({'$' + k: v for k, v in query.items()}))


def export(host, service, bbox, size, **extra):
    query = {'bbox': bbox, 'bboxSR': 4326, 'imageSR': 4326, 'size': size,
             'interpolation': 'RSP_BilinearInterpolation', 'f': 'image', **extra}
    return get(EXPORT.format(host, service) + '?' + urllib.parse.urlencode(query))


def data(cache):
    (cache / 'data').mkdir(parents=True, exist_ok=True)
    (cache / 'ortho').mkdir(exist_ok=True)
    files = {
        # Footprints within ~1 km of the park, with LiDAR heights.
        'data/bldg-near.json': lambda: soda(
            FOOTPRINTS, select='sf16_bldgid,hgt_median_m,peak_1st_m,gnd_min_m,shape',
            where='within_box(shape, 37.7660, -122.4345, 37.7520, -122.4195)', limit=50000),
        # The city between the park and downtown, in two boxes, over 4 m.
        'data/mid-377950.json': lambda: soda(
            FOOTPRINTS, select='hgt_median_m,gnd_min_m,shape',
            where='within_box(shape, 37.7950, -122.4300, 37.7800, -122.3880) AND hgt_median_m::number > 4',
            limit=60000),
        'data/mid-377800.json': lambda: soda(
            FOOTPRINTS, select='hgt_median_m,gnd_min_m,shape',
            where='within_box(shape, 37.7800, -122.4300, 37.7660, -122.3880) AND hgt_median_m::number > 4',
            limit=60000),
        # Downtown's towers beyond them, over 22 m.
        'data/bldg-far.json': lambda: soda(
            FOOTPRINTS, select='hgt_median_m,gnd_min_m,shape',
            where='within_box(shape, 37.8100, -122.4400, 37.7660, -122.3850) AND hgt_median_m::number > 22',
            limit=60000),
        'data/trees.json': lambda: soda(
            SODA + 'tkzw-k3nq.json', limit=50000,
            where='latitude between 37.7520 and 37.7660 AND longitude between -122.4345 and -122.4195'),
        # 1 m DEM, sized in proportion to the bbox so the service doesn't pad it.
        'data/dem.tif': lambda: export(
            'elevation', '3DEPElevation', '-122.4345,37.7520,-122.4195,37.7660', '1500,1400',
            format='tiff', pixelType='F32'),
        'ortho/naip.png': lambda: export(
            'imagery', 'USGSNAIPImagery', '-122.434386,37.755544,-122.418478,37.768162', '4000,3173',
            format='png'),
        'data/osm.json': lambda: get(
            'https://overpass-api.de/api/interpreter',
            urllib.parse.urlencode({'data': OVERPASS}).encode()),
    }
    for name, fetch in files.items():
        path = cache / name
        if path.exists():
            continue
        print('fetching', name)
        path.write_bytes(fetch())
    print('data complete in', cache, '- now: python3 scripts/dolores-park/bundle.py', cache)


if __name__ == '__main__':
    if sys.argv[1:2] == ['assets']:
        assets()
    elif sys.argv[1:2] == ['data'] and len(sys.argv) == 3:
        data(Path(sys.argv[2]))
    else:
        raise SystemExit('Usage: fetch.py assets | fetch.py data /path/to/cache')
