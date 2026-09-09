#!/usr/bin/env python3
"""Fetch OpenStreetMap building footprints for the Bay departure corridor and
pack them into the compact binary read by lib/bay-city.ts.

  python3 scripts/prepare-city-buildings.py fetch --cache /tmp/osm      # peninsula, OSM
  python3 scripts/prepare-city-buildings.py fetch-sf --cache /tmp/osm   # San Francisco, DataSF
  python3 scripts/prepare-city-buildings.py build --cache /tmp/osm

Peninsula footprints © OpenStreetMap contributors, ODbL 1.0; San Francisco
footprints and LiDAR heights from DataSF (see public/credits).
"""
import argparse
import gzip
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# South San Francisco to the Marin shore: everything the departure looks at.
SOUTH, WEST, NORTH, EAST = 37.60, -122.52, 37.83, -122.35
ROWS, COLS = 10, 8
# overpass-api.de is the reference server but rate-limits to two slots and was
# unreachable during the 2026-09-09 build; the mirrors carry the same data.
MIRRORS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]


# San Francisco itself comes from the city's LiDAR footprint survey below;
# OSM tiles only cover the peninsula cities south of the county line.
SF_COUNTY_LINE = 37.7085
OSM_ROWS = 5
DATASF = 'https://data.sf.gov/resource/ynuv-fyni.json'
DATASF_PAGE = 40000


def tiles():
    dlat = (NORTH - SOUTH) / ROWS
    dlon = (EAST - WEST) / COLS
    for r in range(OSM_ROWS):
        for c in range(COLS):
            yield r, c, (SOUTH + r * dlat, WEST + c * dlon, SOUTH + (r + 1) * dlat, WEST + (c + 1) * dlon)


def wait_for_slot():
    """Blocks until overpass-api.de reports a free slot for this client."""
    import re
    for _ in range(12):
        try:
            with urllib.request.urlopen('https://overpass-api.de/api/status', timeout=15) as response:
                status = response.read().decode()
        except Exception:  # noqa: BLE001
            time.sleep(5)
            continue
        if re.search(r'(\d+) slots? available now', status):
            return
        delay = re.findall(r'in (\d+) seconds', status)
        time.sleep(min(60, min(int(d) for d in delay) + 1) if delay else 5)


def fetch_tile(cache, r, c, bounds, worker):
    s, w, n, e = bounds
    path = os.path.join(cache, f't{ROWS}x{COLS}-{r}-{c}.json.gz')
    if os.path.exists(path):
        return
    query = (
        f'[out:json][timeout:180];'
        f'(way["building"]({s},{w},{n},{e});'
        f'relation["building"]["type"="multipolygon"]({s},{w},{n},{e}););'
        f'out geom;'
    )
    for attempt in range(12):
        mirror = MIRRORS[(attempt + worker) % 2] if attempt < 8 else MIRRORS[2]
        if mirror == MIRRORS[2]:
            wait_for_slot()
        try:
            req = urllib.request.Request(
                mirror,
                data=urllib.parse.urlencode({'data': query}).encode(),
                headers={'User-Agent': 'henokabraham.com scenery build (contact via github.com/hnkabraham)'},
            )
            started = time.time()
            with urllib.request.urlopen(req, timeout=240) as response:
                payload = response.read()
            data = json.loads(payload)
            with gzip.open(path, 'wb') as out:
                out.write(payload)
            print(f'tile {r},{c}: {len(data["elements"])} elements, {len(payload) / 1e6:.1f} MB, {time.time() - started:.0f}s', flush=True)
            return
        except urllib.error.HTTPError as error:
            wait = 20 if error.code == 429 else 10 * (attempt + 1)
            print(f'tile {r},{c} attempt {attempt} ({mirror}) failed: HTTP {error.code}; retrying in {wait}s', flush=True)
            time.sleep(wait)
        except Exception as error:  # noqa: BLE001
            wait = 10 * (attempt + 1)
            print(f'tile {r},{c} attempt {attempt} ({mirror}) failed: {error}; retrying in {wait}s', flush=True)
            time.sleep(wait)
    sys.exit(f'giving up on tile {r},{c}')


def fetch_sf(cache):
    """Pages the DataSF building footprints (LiDAR heights) into the cache."""
    os.makedirs(cache, exist_ok=True)
    page = 0
    while True:
        path = os.path.join(cache, f'datasf-{page}.json.gz')
        if os.path.exists(path):
            with gzip.open(path) as handle:
                count = len(json.load(handle))
        else:
            params = urllib.parse.urlencode({
                '$select': 'sf16_bldgid,hgt_median_m,peak_1st_m,gnd_min_m,shape',
                '$order': 'sf16_bldgid',
                '$limit': DATASF_PAGE,
                '$offset': page * DATASF_PAGE,
            })
            for attempt in range(5):
                try:
                    started = time.time()
                    with urllib.request.urlopen(f'{DATASF}?{params}', timeout=600) as response:
                        payload = response.read()
                    rows = json.loads(payload)
                    with gzip.open(path, 'wb') as out:
                        out.write(payload)
                    count = len(rows)
                    print(f'datasf page {page}: {count} footprints, {len(payload) / 1e6:.1f} MB, {time.time() - started:.0f}s', flush=True)
                    break
                except Exception as error:  # noqa: BLE001
                    print(f'datasf page {page} attempt {attempt} failed: {error}', flush=True)
                    time.sleep(20 * (attempt + 1))
            else:
                sys.exit('giving up on DataSF')
        if count < DATASF_PAGE:
            return
        page += 1


def fetch(cache):
    from concurrent.futures import ThreadPoolExecutor
    os.makedirs(cache, exist_ok=True)
    jobs = list(tiles())
    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(fetch_tile, cache, r, c, bounds, i % 2) for i, (r, c, bounds) in enumerate(jobs)]
        for future in futures:
            future.result()


# --- build ------------------------------------------------------------------

# Registered scenery frame (see lib/sfo-buildings.ts): EPSG:3857 metres to
# source-image pixels, then to local metres from the 28R threshold.
BAY_ORIGIN = (5666.01015, 8672.84973)
# The two NAIP corridor layers, EPSG:3857 bounds of 4096-pixel images.
LAYERS = {
    'naip-south.webp': (-13631947.74, 4525293.17, -13615947.74, 4541293.17),
    'naip-north.webp': (-13636902.989, 4542449.687, -13620902.989, 4558449.687),
}
# The airport itself is modelled separately from sfo-buildings.json.
SFO_BOX = (37.607, -122.401, 37.641, -122.373)
KINDS = {
    'residential': 0, 'house': 0, 'detached': 0, 'semidetached_house': 0, 'terrace': 0,
    'apartments': 0, 'bungalow': 0, 'dormitory': 0, 'cabin': 0,
    'commercial': 1, 'office': 1, 'retail': 1, 'hotel': 1, 'supermarket': 1, 'kiosk': 1,
    'civic': 1, 'public': 1, 'government': 1, 'hospital': 1, 'university': 1, 'college': 1,
    'school': 1, 'church': 1, 'cathedral': 1, 'train_station': 1, 'transportation': 1,
    'museum': 1, 'theatre': 1, 'library': 1, 'stadium': 1, 'sports_centre': 1,
    'industrial': 2, 'warehouse': 2, 'manufacture': 2, 'service': 2, 'garage': 2,
    'garages': 2, 'shed': 2, 'hangar': 2, 'parking': 2, 'storage_tank': 2, 'roof': 2,
    'greenhouse': 2, 'carport': 2, 'boathouse': 2, 'construction': 2,
}
DEFAULT_HEIGHTS = {
    'house': 7.5, 'detached': 7.5, 'bungalow': 5, 'cabin': 4, 'semidetached_house': 9,
    'terrace': 9, 'residential': 9, 'apartments': 13, 'dormitory': 12,
    'office': 14, 'commercial': 8, 'retail': 6, 'hotel': 15, 'supermarket': 7,
    'kiosk': 3, 'civic': 10, 'public': 10, 'government': 12, 'hospital': 16,
    'university': 12, 'college': 10, 'school': 7, 'church': 12, 'cathedral': 25,
    'train_station': 10, 'transportation': 8, 'museum': 12, 'theatre': 14,
    'library': 9, 'stadium': 25, 'sports_centre': 10,
    'industrial': 8, 'warehouse': 9, 'manufacture': 8, 'service': 4, 'garage': 3.5,
    'garages': 3.5, 'shed': 3, 'hangar': 14, 'parking': 12, 'storage_tank': 8,
    'roof': 4, 'greenhouse': 4, 'carport': 3, 'boathouse': 5, 'construction': 6,
}


def mercator(lon, lat):
    mx = 6378137 * lon * math.pi / 180
    my = 6378137 * math.log(math.tan(math.pi / 4 + lat * math.pi / 360))
    return mx, my


def local(lon, lat):
    mx, my = mercator(lon, lat)
    px = 0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784
    py = -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904
    return (px - BAY_ORIGIN[0]) * 10, (py - BAY_ORIGIN[1]) * 10


def parse_length(value):
    if value is None:
        return None
    text = value.strip().lower().replace(',', '.')
    if ';' in text:
        text = text.split(';')[0]
    factor = 1.0
    for unit, scale in (("'", 0.3048), ('ft', 0.3048), ('feet', 0.3048), ('m', 1.0)):
        if text.endswith(unit):
            text = text[: -len(unit)].strip()
            factor = scale
            break
    try:
        return float(text) * factor
    except ValueError:
        return None


def hash01(value):
    x = (value * 2654435761) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 0x5BD1E995) & 0xFFFFFFFF
    return ((x ^ (x >> 15)) & 0xFFFF) / 65535


def area2(ring):
    total = 0.0
    for i in range(len(ring)):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % len(ring)]
        total += x0 * z1 - x1 * z0
    return total


def simplify(ring, tolerance):
    """Douglas-Peucker on a closed ring, keeping it closed."""
    if len(ring) <= 4:
        return ring

    def dp(points):
        if len(points) < 3:
            return points
        (x0, z0), (x1, z1) = points[0], points[-1]
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz) or 1e-9
        best, index = 0.0, 0
        for i in range(1, len(points) - 1):
            x, z = points[i]
            distance = abs(dx * (z0 - z) - (x0 - x) * dz) / length
            if distance > best:
                best, index = distance, i
        if best > tolerance:
            return dp(points[: index + 1])[:-1] + dp(points[index:])
        return [points[0], points[-1]]

    # Anchor the split at the two most distant vertices so the ring survives.
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
    first = dp(ring[: far + 1])
    second = dp(ring[far:] + [ring[0]])
    return first[:-1] + second[:-1]


def clean(ring):
    out = []
    for point in ring:
        if not out or math.hypot(point[0] - out[-1][0], point[1] - out[-1][1]) > 0.3:
            out.append(point)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 0.3:
        out.pop()
    return out


def convex(ring):
    """True when a fan from vertex 0 covers the ring; concavities shallower
    than about half a metre are tolerated, they are invisible from the air."""
    for i in range(len(ring)):
        (x0, z0), (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % len(ring)], ring[(i + 2) % len(ring)]
        cross = (x1 - x0) * (z2 - z1) - (z1 - z0) * (x2 - x1)
        if cross < 0:
            # Depth of the concave vertex below the chord between its neighbours.
            chord = math.hypot(x2 - x0, z2 - z0) or 1e-9
            if -cross / chord > 0.5:
                return False
    return True


def earcut(ring):
    """Ear clipping for a simple counter-clockwise ring; fan fallback."""
    n = len(ring)
    indices = list(range(n))
    triangles = []

    def inside(p, a, b, c):
        def side(u, v, w):
            return (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0])
        return side(a, b, p) >= 0 and side(b, c, p) >= 0 and side(c, a, p) >= 0

    guard = 0
    while len(indices) > 3 and guard < n * n:
        guard += 1
        clipped = False
        for k in range(len(indices)):
            i0, i1, i2 = indices[k - 1], indices[k], indices[(k + 1) % len(indices)]
            a, b, c = ring[i0], ring[i1], ring[i2]
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if cross <= 1e-9:
                continue
            if any(inside(ring[j], a, b, c) for j in indices if j not in (i0, i1, i2)):
                continue
            triangles.append((i0, i1, i2))
            del indices[k]
            clipped = True
            break
        if not clipped:
            break
    if len(indices) == 3:
        triangles.append(tuple(indices))
    if len(triangles) != n - 2:
        return [(0, i, i + 1) for i in range(1, n - 1)]
    return triangles


def classify(tags, area):
    building = tags.get('building', 'yes')
    if building == 'yes':
        building = 'warehouse' if area > 900 else 'residential'
    kind = KINDS.get(building, 0)
    return building, kind


def height_of(tags, building, osm_id):
    height = parse_length(tags.get('height'))
    if height is None:
        levels = parse_length(tags.get('building:levels'))
        if levels:
            height = levels * 3.3 + (parse_length(tags.get('roof:levels')) or 0) * 2.5
    if height is None:
        height = DEFAULT_HEIGHTS.get(building, 8) * (0.88 + 0.24 * hash01(osm_id))
    return max(2.5, min(400, height))


def load_layers():
    from PIL import Image
    images = []
    for name, bounds in LAYERS.items():
        path = os.path.join('public', 'scenery', name)
        image = Image.open(path).convert('RGB')
        image.load()
        images.append((bounds, image))
    return images


def roof_colour(images, lon, lat):
    mx, my = mercator(lon, lat)
    for (x0, y0, x1, y1), image in images:
        if x0 <= mx < x1 and y0 <= my < y1:
            w, h = image.size
            col = int((mx - x0) / (x1 - x0) * w)
            row = int((y1 - my) / (y1 - y0) * h)
            box = (max(0, col - 1), max(0, row - 1), min(w, col + 2), min(h, row + 2))
            pixels = list(image.crop(box).getdata())
            return tuple(sum(p[i] for p in pixels) // len(pixels) for i in range(3))
    return (152, 150, 146)


def rings_of(element):
    if element['type'] == 'way':
        geometry = element.get('geometry')
        return [geometry] if geometry else []
    rings = []
    for member in element.get('members', []):
        if member.get('role') == 'outer' and member.get('geometry'):
            rings.append(member['geometry'])
    return rings


def footprint(points, lon, lat, height, kind, images, stats):
    """Cleans, simplifies and triangulates one ring; None if it is dropped."""
    points = clean(points)
    if len(points) < 3:
        return None
    if area2(points) < 0:
        points.reverse()
    points = clean(simplify(points, 1.0))
    if len(points) < 3 or len(points) > 250:
        stats['skipped'] += 1
        return None
    area = area2(points) / 2
    # Sheds and garages carry nothing from the air.
    if area < 30 and height < 12:
        stats['skipped'] += 1
        return None
    if height >= 45:
        kind = 3
    triangles = [] if convex(points) else earcut(points)
    if triangles:
        stats['nonconvex'] += 1
    cx = sum(p[0] for p in points) / len(points)
    cz = sum(p[1] for p in points) / len(points)
    return {
        'center': (cx, cz), 'points': points, 'height': height, 'kind': kind,
        'colour': roof_colour(images, lon, lat), 'triangles': triangles, 'area': area,
    }


def iterate_footprints(cache, stats=None):
    """Yields (lon/lat ring, height, kind, tags-or-None) for every footprint of
    both sources after the airport, county-line and underground filters."""
    import glob
    stats = stats if stats is not None else {}
    seen = set()
    for path in sorted(glob.glob(os.path.join(cache, f't{ROWS}x{COLS}-*.json.gz'))):
        with gzip.open(path) as handle:
            data = json.load(handle)
        for element in data['elements']:
            key = (element['type'], element['id'])
            if key in seen:
                continue
            seen.add(key)
            stats['elements'] = stats.get('elements', 0) + 1
            tags = element.get('tags', {})
            if tags.get('building') in ('no', None) or tags.get('location') == 'underground':
                continue
            try:
                if int(tags.get('layer', '0')) < 0:
                    continue
            except ValueError:
                pass
            for ring in rings_of(element):
                if len(ring) < 4:
                    continue
                closed = ring[:-1] if ring[0] == ring[-1] else ring
                lon = sum(p['lon'] for p in closed) / len(closed)
                lat = sum(p['lat'] for p in closed) / len(closed)
                if SFO_BOX[0] <= lat <= SFO_BOX[2] and SFO_BOX[1] <= lon <= SFO_BOX[3]:
                    continue
                if lat >= SF_COUNTY_LINE:
                    continue
                lonlat = [(p['lon'], p['lat']) for p in closed]
                points = [local(*p) for p in lonlat]
                area = abs(area2(clean(points))) / 2 if len(clean(points)) >= 3 else 0
                building, kind = classify(tags, area)
                height = height_of(tags, building, element['id'])
                if 'height' not in tags and 'building:levels' not in tags:
                    stats['defaults'] = stats.get('defaults', 0) + 1
                yield lonlat, height, kind, tags
    for path in sorted(glob.glob(os.path.join(cache, 'datasf-*.json.gz'))):
        with gzip.open(path) as handle:
            rows = json.load(handle)
        for row in rows:
            shape = row.get('shape') or {}
            polygons = shape.get('coordinates', []) if shape.get('type') == 'MultiPolygon' else [shape.get('coordinates', [])]
            try:
                height = float(row.get('hgt_median_m') or 0)
                peak = float(row.get('peak_1st_m') or 0) - float(row.get('gnd_min_m') or 0)
            except ValueError:
                continue
            # Median first-return height is robust; pitched roofs and towers
            # read low, so let a plausible peak raise them a little.
            height = max(2.5, min(400, max(height, min(peak, height * 1.35))))
            for polygon in polygons:
                if not polygon:
                    continue
                ring = polygon[0]
                closed = ring[:-1] if ring[0] == ring[-1] else ring
                if len(closed) < 3:
                    continue
                lonlat = [(p[0], p[1]) for p in closed]
                points = [local(*p) for p in lonlat]
                area = abs(area2(clean(points))) / 2 if len(clean(points)) >= 3 else 0
                kind = 1 if height >= 20 else 2 if area > 1500 and height < 15 else 0
                stats['datasf'] = stats.get('datasf', 0) + 1
                yield lonlat, height, kind, None


def build(cache, out):
    images = load_layers()
    buildings = []
    stats = {'elements': 0, 'skipped': 0, 'defaults': 0, 'nonconvex': 0, 'datasf': 0}
    for lonlat, height, kind, _tags in iterate_footprints(cache, stats):
        lon = sum(p[0] for p in lonlat) / len(lonlat)
        lat = sum(p[1] for p in lonlat) / len(lonlat)
        points = [local(*p) for p in lonlat]
        entry = footprint(points, lon, lat, height, kind, images, stats)
        if entry:
            buildings.append(entry)
    print(f'{stats}, kept {len(buildings)}', flush=True)
    write(buildings, out)
    mobile = [b for b in buildings if b['height'] >= 12 or b['area'] >= 500]
    write(mobile, out.replace('.bin.gz', '-mobile.bin.gz'))


def write(buildings, out):
    """Format v2, little-endian (read by lib/bay-city.ts):
    header  'BAYB' u16 version=2, u32 count, u32 vertices, u32 vertexBytes, u32 triangles
    record  i32 cx, i32 cz (0.5 m), u16 height (0.1 m), u8 r g b, u8 kind (bit 7: wide), u8 vertices, u8 triangles
    then per building its ring as i8 pairs (0.5 m from the centre) or i16 pairs when wide,
    then all roof triangles as u8 index triples. Written gzip-compressed."""
    records, vertices, triangles = [], [], []
    for b in buildings:
        cx, cz = b['center']
        qx, qz = round(cx * 2), round(cz * 2)
        offsets = [(round(x * 2) - qx, round(z * 2) - qz) for x, z in b['points']]
        wide = any(abs(dx) > 127 or abs(dz) > 127 for dx, dz in offsets)
        records.append(struct.pack('<iiHBBBBBB', qx, qz, min(65535, round(b['height'] * 10)), *b['colour'], b['kind'] | (0x80 if wide else 0), len(offsets), len(b['triangles'])))
        for dx, dz in offsets:
            vertices.append(struct.pack('<hh' if wide else '<bb', max(-32768, min(32767, dx)), max(-32768, min(32767, dz))))
        for tri in b['triangles']:
            triangles.append(struct.pack('<BBB', *tri))
    vertex_bytes = b''.join(vertices)
    header = struct.pack('<4sHIIII', b'BAYB', 2, len(buildings), sum(len(b['points']) for b in buildings), len(vertex_bytes), sum(len(b['triangles']) for b in buildings))
    payload = header + b''.join(records) + vertex_bytes + b''.join(triangles)
    with gzip.open(out, 'wb', compresslevel=9) as handle:
        handle.write(payload)
    print(f'{out}: {len(buildings)} buildings, {sum(len(b["points"]) for b in buildings)} vertices, {len(payload) / 1e6:.2f} MB raw, {os.path.getsize(out) / 1e6:.2f} MB gzip', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['fetch', 'fetch-sf', 'build'])
    parser.add_argument('--cache', required=True)
    parser.add_argument('--out', default='public/scenery/bay-buildings.bin.gz')
    args = parser.parse_args()
    if args.command == 'fetch':
        fetch(args.cache)
    elif args.command == 'fetch-sf':
        fetch_sf(args.cache)
    else:
        build(args.cache, args.out)
