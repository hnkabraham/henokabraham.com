#!/usr/bin/env python3
"""Pack the freeways around the climb-out into local scene metres.

  python3 scripts/prepare-bay-traffic.py fetch --cache /path/to/cache
  python3 scripts/prepare-bay-traffic.py build --cache /path/to/cache

`fetch` asks OpenStreetMap's Overpass API for every motorway and motorway
link inside the climb-out box (US 101, I-380 and I-280 between the airport
and San Bruno Mountain) and caches the raw answer; `build` writes
public/scenery/bay-roads.json with each carriageway as a polyline in local
scene metres (X east, Z south, origin at the 28R threshold), its lane count
and a short reference, simplified to 1 m. lib/bay-traffic.ts drives the
vehicles along these at runtime. Data © OpenStreetMap contributors, ODbL.
"""
import argparse
import importlib.util
import json
import math
import pathlib
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BBOX = (37.598, -122.462, 37.662, -122.381)  # south, west, north, east
MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
QUERY = """[out:json][timeout:90];
(
  way["highway"~"^(motorway|motorway_link)$"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""
DEFAULT_LANES = {'motorway': 4, 'motorway_link': 1}


def airfield_tools():
    """Reuse the airfield script's projection and simplification."""
    path = ROOT / 'scripts' / 'prepare-sfo-airfield.py'
    spec = importlib.util.spec_from_file_location('sfo_airfield', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch(cache):
    s, w, n, e = BBOX
    query = QUERY.format(s=s, w=w, n=n, e=e)
    for mirror in MIRRORS:
        try:
            request = urllib.request.Request(
                mirror, data=urllib.parse.urlencode({'data': query}).encode())
            data = urllib.request.urlopen(request, timeout=180).read()
            parsed = json.loads(data)
            if parsed.get('elements'):
                (cache / 'bay-roads-osm.json').write_bytes(data)
                print(f'{mirror}: {len(parsed["elements"])} elements')
                return
        except Exception as error:  # noqa: BLE001 - try the next mirror
            print(f'{mirror}: {str(error)[:120]}')
    raise SystemExit('every Overpass mirror failed')


def build(cache):
    tools = airfield_tools()
    data = json.loads((cache / 'bay-roads-osm.json').read_text())
    nodes = {e['id']: e for e in data['elements'] if e['type'] == 'node'}
    ways = []
    total = 0.0
    for way in data['elements']:
        if way['type'] != 'way':
            continue
        tags = way.get('tags', {})
        kind = tags.get('highway')
        if kind not in DEFAULT_LANES or tags.get('oneway', 'yes') == 'no':
            continue
        points = [tools.local(nodes[n]['lon'], nodes[n]['lat'])
                  for n in way['nodes'] if n in nodes]
        points = tools.simplify(points, 1.0)
        if len(points) < 2:
            continue
        try:
            lanes = max(1, min(6, int(tags.get('lanes', DEFAULT_LANES[kind]))))
        except ValueError:
            lanes = DEFAULT_LANES[kind]
        length = tools.length(points)
        if length < 30:
            continue
        total += length
        ways.append({
            'ref': tags.get('ref', ''),
            'kind': 'link' if kind == 'motorway_link' else 'motorway',
            'lanes': lanes,
            'points': tools.round2(points),
        })
    out = ROOT / 'public' / 'scenery' / 'bay-roads.json'
    out.write_text(json.dumps({
        'source': 'OpenStreetMap contributors, ODbL 1.0',
        'bbox': BBOX,
        'ways': ways,
    }, separators=(',', ':')))
    print(f'{len(ways)} carriageways, {total / 1000:.1f} km, {out.stat().st_size:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['fetch', 'build'])
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    (fetch if args.command == 'fetch' else build)(cache)
