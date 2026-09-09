#!/usr/bin/env python3
"""Pack SFO's airfield layout from OpenStreetMap for the departure scene.

  python3 scripts/prepare-sfo-airfield.py fetch --cache /path/to/cache
  python3 scripts/prepare-sfo-airfield.py build --cache /path/to/cache

`fetch` asks Overpass for the airport's runways, taxiways, stand lead-in
lines (aeroway=parking_position) and windsocks; `build` projects them into
the scene's local metres (see lib/sfo-buildings.ts lonLatToBay) and writes
public/scenery/sfo-airfield.json: runway ends, taxiway centrelines, stands
with their stop point and nose heading, the runway holding positions where
taxiways enter 28R, a few taxiway spots for aircraft on the move, and the
windsock. The output is a derived database of OpenStreetMap data (ODbL).
"""
import argparse
import json
import math
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/scenery/sfo-airfield.json'
BBOX = (37.605, -122.405, 37.64, -122.36)
MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]
QUERY = """[out:json][timeout:90];
(
  way["aeroway"="runway"]({s},{w},{n},{e});
  way["aeroway"="taxiway"]({s},{w},{n},{e});
  way["aeroway"="parking_position"]({s},{w},{n},{e});
  node["aeroway"="windsock"]({s},{w},{n},{e});
);
out body geom;"""
BAY_ORIGIN = (5666.01015, 8672.84973)
R = 6378137.0


def local(lon, lat):
    mx = R * math.radians(lon)
    my = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    px = 0.07915772966115583 * mx - 0.0004519390553973489 * my + 1085905.55448784
    py = -0.0004973835512757917 * mx - 0.0788309597692652 * my + 358610.37375675904
    return ((px - BAY_ORIGIN[0]) * 10, (py - BAY_ORIGIN[1]) * 10)


def fetch(cache):
    s, w, n, e = BBOX
    query = QUERY.format(s=s, w=w, n=n, e=e)
    for mirror in MIRRORS:
        try:
            request = urllib.request.Request(mirror, data=urllib.parse.urlencode({'data': query}).encode())
            data = urllib.request.urlopen(request, timeout=180).read()
            json.loads(data)
            (cache / 'sfo-airfield-osm.json').write_bytes(data)
            print(f'fetched {len(data):,} bytes from {mirror}')
            return
        except Exception as error:  # noqa: BLE001 - try the next mirror
            print('mirror failed', mirror, str(error)[:100], flush=True)
            time.sleep(3)
    raise SystemExit('every Overpass mirror failed')


def polyline(way):
    return [local(p['lon'], p['lat']) for p in way['geometry']]


def length(points):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))


def simplify(points, tolerance=0.5):
    """Douglas-Peucker, keeps the ends."""
    if len(points) < 3:
        return points
    (x0, z0), (x1, z1) = points[0], points[-1]
    dx, dz = x1 - x0, z1 - z0
    norm = math.hypot(dx, dz) or 1
    best, at = 0, 0
    for i in range(1, len(points) - 1):
        d = abs((points[i][0] - x0) * dz - (points[i][1] - z0) * dx) / norm
        if d > best:
            best, at = d, i
    if best <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:at + 1], tolerance)[:-1] + simplify(points[at:], tolerance)


def round2(points):
    return [[round(x, 1), round(z, 1)] for x, z in points]


def build(cache):
    raw = json.loads((cache / 'sfo-airfield-osm.json').read_text())['elements']
    runways, taxiways, stands, windsocks = [], [], [], []
    for element in raw:
        tags = element.get('tags', {})
        kind = tags.get('aeroway')
        if kind == 'windsock':
            windsocks.append(round2([local(element['lon'], element['lat'])])[0])
        elif element['type'] != 'way':
            continue
        elif kind == 'runway':
            points = polyline(element)
            runways.append({'ref': tags.get('ref', ''), 'ends': round2([points[0], points[-1]]),
                            'width': float(tags.get('width', 61))})
        elif kind == 'taxiway':
            taxiways.append({'ref': tags.get('ref') or '', 'points': round2(simplify(polyline(element)))})
        elif kind == 'parking_position':
            points = polyline(element)
            if len(points) < 2:
                continue
            (ax, az), (bx, bz) = points[-2], points[-1]
            norm = math.hypot(bx - ax, bz - az)
            if norm < 1:
                continue
            stands.append({'ref': tags.get('ref') or '', 'stop': round2([points[-1]])[0],
                           'heading': [round((bx - ax) / norm, 4), round((bz - az) / norm, 4)]})
    # Runway 28R's frame: along (metres from the 28R threshold toward 10L) and
    # across (metres north of the centreline) for the holding positions.
    main = next(r for r in runways if r['ref'] == '10L/28R')
    (ox, oz), (ex, ez) = main['ends']
    span = math.hypot(ex - ox, ez - oz)
    fwd = ((ex - ox) / span, (ez - oz) / span)
    left = (fwd[1], -fwd[0])
    def frame(p):
        return ((p[0] - ox) * fwd[0] + (p[1] - oz) * fwd[1], (p[0] - ox) * left[0] + (p[1] - oz) * left[1])
    holdings = []
    for taxiway in taxiways:
        pts = taxiway['points']
        for p, q in zip(pts, pts[1:]):
            # A segment that crosses the 75 m holding line heading for the
            # runway, whichever way the taxiway happens to be drawn.
            for a, b in ((p, q), (q, p)):
                (sa, ca), (sb, cb) = frame(a), frame(b)
                if abs(ca) > 75 >= abs(cb) and -60 < sa < span + 60 and abs(ca - cb) > 10:
                    t = (abs(ca) - 75) / (abs(ca) - abs(cb))
                    x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    dx, dz = b[0] - a[0], b[1] - a[1]
                    norm = math.hypot(dx, dz)
                    if all(math.hypot(x - h['at'][0], z - h['at'][1]) > 30 for h in holdings):
                        holdings.append({'ref': taxiway['ref'], 'at': [round(x, 1), round(z, 1)],
                                         'heading': [round(dx / norm, 4), round(dz / norm, 4)]})
    # Aircraft on the move: three spots on named taxiways north of 28R (the
    # side the roll is watched across), between the parallel and the crossing
    # runways, spread along the roll. `left` points south, so north is negative.
    movers = []
    for taxiway in taxiways:
        if not taxiway['ref']:
            continue
        pts = taxiway['points']
        for a, b in zip(pts, pts[1:]):
            (sa, ca), (sb, cb) = frame(a), frame(b)
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            sm, cm = frame(mid)
            if -600 < cm < -140 and 500 < sm < 2900 and math.hypot(b[0] - a[0], b[1] - a[1]) > 40:
                if all(math.hypot(mid[0] - m['at'][0], mid[1] - m['at'][1]) > 450 for m in movers):
                    dx, dz = b[0] - a[0], b[1] - a[1]
                    norm = math.hypot(dx, dz)
                    movers.append({'ref': taxiway['ref'], 'at': [round(mid[0], 1), round(mid[1], 1)],
                                   'heading': [round(dx / norm, 4), round(dz / norm, 4)]})
    movers = movers[:3]
    data = {
        'source': 'OpenStreetMap contributors, ODbL 1.0, retrieved 2026-09-09',
        'runways': runways, 'taxiways': taxiways, 'stands': stands,
        'holdings': holdings, 'movers': movers, 'windsocks': windsocks,
    }
    OUTPUT.write_text(json.dumps(data, separators=(',', ':')))
    print(f'{OUTPUT.name}: {len(runways)} runway ways, {len(taxiways)} taxiways '
          f'({sum(length(t["points"]) for t in taxiways) / 1000:.1f} km), {len(stands)} stands, '
          f'{len(holdings)} holding positions, {len(movers)} movers, {len(windsocks)} windsocks, '
          f'{OUTPUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['fetch', 'build'])
    parser.add_argument('--cache', required=True)
    args = parser.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    if args.command == 'fetch':
        fetch(cache)
    else:
        build(cache)
    sys.exit(0)
