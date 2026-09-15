#!/usr/bin/env python3
"""Represents Henok's 2017 Shelby GT350 (gray, with blue racing stripes)
using a downloaded GT350R model in a merged, Draco-ready GLB
for the site's Garage section.

The source USDZ (2016 Ford Mustang Shelby GT350R by Ddiaz Design, Sketchfab,
CC BY-NC-SA 4.0) is not committed to this repository -- supply your own copy
to reproduce (see .gitignore). Its 550 separate mesh prims are merged into
one primitive per material; the body paint's flat-color swatch is repainted
from its default scheme to gray-with-blue-stripes; two small trim regions in
a second flat-color swatch (the front splitter/rocker skirts/rear wing, and
a stray washer-nozzle wire that rendered as a bright sliver) which rendered
plain white/gold in the source model are repainted carbon-dark; the mirror
caps and exhaust tips, which share UV space with parts that must stay a
different color, are split out into their own materials rather than
recolored in place (see the module-level comments below for how each region
was identified). The rear wing is removed and the detailed wheel atlas is
brightened toward gunmetal; the remaining R-trim body and wheel geometry
are an approximation of the non-R car. This derivative remains CC BY-NC-SA 4.0: non-commercial
use, share-alike, with attribution -- see public/credits/garage.html.

Geometry: world-space points already come out in real meters (see
garage_usda_parser.py's docstring -- the file's own xformOp:scale(100,100,100)
node plus metersPerUnit=0.01 cancel out; verified against the real GT350R's
published dimensions, so no further unit scale is applied here).

Normals: transformed by the inverse-transpose of each mesh's local 3x3
(needed because several meshes carry non-uniform/mirrored scale, e.g. the
-0.8-ish factors on shared wheel prims), then renormalized. Triangle winding
is flipped wherever a mesh's 3x3 has a negative determinant (mirrored), so
backface culling and the flipped normals stay consistent.

Usage:
  python3 scripts/prepare-garage-car.py <path-to-usdz>
  node scripts/compress-dreamliner.mjs \\
    public/models/garage-gt350r-raw.glb public/models/garage-gt350r.glb

Requires usdcat (ships with Apple's USD tooling; /usr/bin/usdcat on a Mac
with Xcode installed) to turn the USDZ's binary scene.usdc into text.
"""
import argparse
import io
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from garage_usda_parser import (
    tokenize_prims,
    walk,
    read_balanced,
    read_balanced_brace,
    find_attr_value,
)

REPO = Path(__file__).resolve().parent.parent
SOURCE_URL = 'https://sketchfab.com/3d-models/2016-ford-mustang-shelby-gt350r-1d03bb121b6e4371b0978dc584b788d8'
AUTHOR = 'Ddiaz Design (https://sketchfab.com/ddiaz-design)'
LICENSE = 'CC-BY-NC-SA-4.0'

# Photo-sampled from Henok's own car (front 3/4 and side photos he sent):
# clean patches of quarter-panel paint and hood/bumper stripe, picked to
# avoid sky reflections and direct-sun specular blowout on the glossy paint.
BODY_GRAY = (0x5F, 0x65, 0x6B)
STRIPE_BLUE = (0x09, 0x2E, 0x70)
# Matte carbon-composite aero trim (splitter/rockers/wing) and mirror caps --
# both read as a neutral near-black in the photos.
CARBON_DARK = (0x1A, 0x1A, 0x1C)
# Satin/chrome-ish metal exhaust tips -- kept apart from CARBON_DARK on
# purpose, real tips are metallic light gray, not black.
EXHAUST_CHROME = (0xB0, 0xB4, 0xB8)

PAINT_REFS = {
    'blue_field': (0, 85, 220),
    'black_band': (26, 26, 28),
    'red_edge': (224, 0, 0),
}
PAINT_TARGETS = {
    'blue_field': BODY_GRAY,
    'black_band': STRIPE_BLUE,
    # The real car's stripe has a crisp near-black pinstripe right at the
    # blue/body edge (Henok's photo), not a blue-to-gray blend -- keep the
    # swatch's thin red edge line dark instead of folding it into the stripe.
    'red_edge': CARBON_DARK,
}
# The "Coloured" atlas is a small flat-color-cell swatch too (verified by
# sampling every pixel it's actually UV-sampled at: only 3 colors are ever
# used). Its big light-gray cell (183,183,183) is what the front splitter,
# rocker/side skirts and rear wing sample -- rendering plain white/light
# instead of the real car's black carbon-look aero pieces. A second, much
# smaller gold/brown cell (112,88,40) turned out to be a thin washer-nozzle
# wire on the hood that read as a stray bright sliver in the render; same
# fix. A third, dark-navy cell (11,17,31) is already correctly dark (window
# seals) and is left alone.
COLOURED_REFS = {
    'light_gray': (183, 183, 183),
    'gold_brown': (112, 88, 40),
}
COLOURED_TARGETS = {'light_gray': CARBON_DARK, 'gold_brown': CARBON_DARK}
COLOURED_MATCH_DIST = 30  # only remap pixels close to a known ref; leave the rest (e.g. the dark-navy seal cell) untouched


def recolor_paint(path):
    im = Image.open(path).convert('RGB')
    arr = np.array(im).astype(np.float64)
    names = list(PAINT_REFS.keys())
    refs = np.array([PAINT_REFS[n] for n in names], dtype=np.float64)
    targets = np.array([PAINT_TARGETS[n] for n in names], dtype=np.uint8)
    flat = arr.reshape(-1, 3)
    dists = np.linalg.norm(flat[:, None, :] - refs[None, :, :], axis=2)
    nearest = np.argmin(dists, axis=1)
    out = targets[nearest].reshape(arr.shape).astype(np.uint8)
    return Image.fromarray(out, 'RGB')


def recolor_coloured(path):
    """Unlike recolor_paint (every pixel reassigned to its nearest of a few
    references), this only remaps pixels that are CLOSE to a known ref cell
    and leaves everything else (other legitimate trim colors in this atlas)
    exactly as authored."""
    im = Image.open(path).convert('RGB')
    arr = np.array(im).astype(np.float64)
    out = arr.copy()
    flat = arr.reshape(-1, 3)
    out_flat = out.reshape(-1, 3)
    for name, ref in COLOURED_REFS.items():
        dist = np.linalg.norm(flat - np.array(ref, dtype=np.float64), axis=1)
        mask = dist < COLOURED_MATCH_DIST
        out_flat[mask] = COLOURED_TARGETS[name]
    return Image.fromarray(out.astype(np.uint8), 'RGB')


def recolor_wheels(path):
    # This atlas is a straight-on photo-style capture of the wheel face, so
    # (verified by sampling radial profiles from its own center at eight
    # angles, not assumed) it's concentric rings in pixel space: hub, vented
    # disk, a recessed channel, the rim's outer lip, then tire -- and that
    # last transition is sharp and consistent by angle, always by r=200 of
    # 256. The tire tread's own molded block pattern is already in the
    # unmodified source (present with brightening disabled entirely); a
    # levels curve strong enough to lift the rim to gunmetal blows that
    # pattern out into a harsh checkerboard if it also touches the tire, so
    # the tire radius is masked out of the recolor rather than toned down --
    # anything scaled down to look fine on the tire is too weak on the rim.
    im = Image.open(path).convert('RGB')
    levels = np.interp(
        np.arange(256), [0, 8, 60, 129, 255], [0, 8, 138, 208, 255]
    ).round().astype(np.uint8)
    recolored = im.point(levels.tolist() * 3)
    w, h = im.size
    yy, xx = np.mgrid[0:h, 0:w]
    radius = np.hypot(xx - w / 2, yy - h / 2)
    wheel_weight = np.clip((200 - radius) / (200 - 193) * 255, 0, 255).astype(
        np.uint8
    )
    mask = Image.fromarray(wheel_weight, 'L')
    return Image.composite(recolored, im, mask)


# The Coloured prim also contains unrelated trim. This box matches only
# its disconnected wing blade and two supports (1,428 triangles), including
# the feet below y=1; the painted trunk deck belongs to PaintA and stays intact.
def _is_rear_wing(cx, cy, cz, u, v):
    return abs(cx) < 0.8 and 0.97 < cy < 1.2 and -2.33 < cz < -1.83


DROP_RULES = {'shFord_ShelbyGT350R_2016Coloured_Material1': _is_rear_wing}


# Geometric splits: some triangles of a merged material need a DIFFERENT
# output material entirely, not just a texture recolor, because they share
# UV space with parts that must stay a different color -- see the comments
# on each predicate below for how it was identified. Predicate receives a
# triangle's world-space centroid (cx,cy,cz) and its average UV (u,v).
#
# The mirror caps are NOT spatially separable from the body: the mesh is
# topologically continuous across the mirror-to-fender/A-pillar boundary (no
# gap in 3D to bound), so a position-only box either misses the cap or also
# grabs the roof/fender it's attached to. What IS distinctive is that the
# mirror caps' UV unwrap happens to land inside the hood/roof stripe's V
# band (u doesn't matter -- the stripe bands are horizontal and repeat, full
# width) purely by coincidence of the unwrap, which is exactly why they
# render stripe-blue instead of body color. Combining a coarse "near the
# outer edge" position bound (the actual stripe never reaches this far out
# in X) with "UV falls in a stripe band" isolates just the mirrors -- 404
# triangles, verified bimodal at the car's two outer-X extremes only, none
# in between.
_STRIPE_V_BANDS = [(0.28, 0.47), (0.53, 0.72)]


def _in_stripe_band(v):
    return any(lo < v < hi for lo, hi in _STRIPE_V_BANDS)


def _is_mirror_cap(cx, cy, cz, u, v):
    return abs(cx) > 0.6 and _in_stripe_band(v)


def _is_exhaust_tip(cx, cy, cz, u, v):
    return 0.45 < abs(cx) < 0.85 and 0.2 < cy < 0.4 and -2.3 < cz < -2.0


# The roof skin is the opposite problem from the mirror caps: it's not that
# its UV unwrap accidentally lands in the wrong swatch cell, it's that the
# artist's own UV layout for this one panel gives the "stripe" cell nearly
# the whole panel (verified by sampling the source PaintA texture at the
# roof's actual UVs, bucketed by world X: black_band -- our stripe target --
# covers roughly |x|<0.5 of a roof that's only 0.72 half-width). Recoloring
# the texture can't fix a per-panel UV authoring choice, so the roof is
# instead re-split completely by world position into a narrow stripe and
# gray on either side -- not by whole-triangle classification (see
# split_at_plane below), because parts of this panel's own triangulation are
# coarse, elongated fan shapes several centimetres wide; classifying whole
# triangles by centroid at any boundary that cuts through that fan produces
# a jagged sawtooth edge, not a straight line, and picking a boundary wide
# enough to dodge the fan entirely (the first fix this session shipped)
# leaves the stripe looking like a solid two-tone panel next to the hood's
# and trunk's much narrower double stripe. `split_at_plane` clips the
# straddling triangles themselves at the exact x boundary, so the edge is
# clean regardless of the source mesh's local resolution.
_ROOF_Y_MIN = 1.15
_ROOF_Z_RANGE = (-1.15, 0.35)
_ROOF_X_MAX = 0.75
_ROOF_STRIPE_OUTER = 0.11  # each stripe's outer edge
_ROOF_STRIPE_INNER = 0.02  # gray gap between the two stripes


def _is_roof(cx, cy, cz, u, v):
    return (
        cy > _ROOF_Y_MIN
        and _ROOF_Z_RANGE[0] < cz < _ROOF_Z_RANGE[1]
        and abs(cx) < _ROOF_X_MAX
    )


def _clip_polygon(idx3, keep):
    """Sutherland-Hodgman clip of one triangle (3 vertex indices, in their
    original cyclic order, so winding is preserved) against a half-space:
    `keep(vertex_index) -> bool`. Returns the output polygon (3 or 4
    entries) as a list of either an existing vertex index, or a ('cut', a,
    b) marker for a new vertex on edge a->b yet to be created."""
    out = []
    for i in range(3):
        cur, nxt = idx3[i], idx3[(i + 1) % 3]
        cur_in, nxt_in = keep(cur), keep(nxt)
        if cur_in:
            out.append(cur)
            if not nxt_in:
                out.append(('cut', cur, nxt))
        elif nxt_in:
            out.append(('cut', cur, nxt))
    return out


def split_at_plane(tri_flat, positions, normals, uvs, boundary_x):
    """Splits triangles (flat vertex-index array) at the plane x =
    boundary_x into an inside set (x < boundary_x) and an outside set (x >=
    boundary_x), clipping any triangle whose vertices straddle the plane
    into 1-2 new sub-triangles with linearly interpolated normals/UVs at the
    cut, rather than assigning whole triangles by centroid. Returns
    (inside_flat, outside_flat, positions, normals, uvs); the attribute
    arrays gain one new vertex per cut edge and are returned since the
    caller's accessors are built from them afterwards."""
    tri = tri_flat.reshape(-1, 3)
    new_pos, new_nrm, new_uv = [], [], []
    next_index = len(positions)
    cut_cache = {}

    def cut_vertex(a, b):
        nonlocal next_index
        key = (a, b) if a < b else (b, a)
        if key in cut_cache:
            return cut_cache[key]
        t = (boundary_x - positions[a, 0]) / (positions[b, 0] - positions[a, 0])
        new_pos.append(positions[a] + (positions[b] - positions[a]) * t)
        new_nrm.append(normals[a] + (normals[b] - normals[a]) * t)
        new_uv.append(uvs[a] + (uvs[b] - uvs[a]) * t)
        cut_cache[key] = next_index
        next_index += 1
        return cut_cache[key]

    def resolve(handle):
        return cut_vertex(handle[1], handle[2]) if isinstance(handle, tuple) else handle

    def fan(poly):
        return [(poly[0], poly[i], poly[i + 1]) for i in range(1, len(poly) - 1)]

    def is_inside(i):
        return positions[i, 0] < boundary_x

    inside_tris, outside_tris = [], []
    for a, b, c in tri:
        idx3 = (a, b, c)
        flags = [is_inside(i) for i in idx3]
        if all(flags):
            inside_tris.append(idx3)
        elif not any(flags):
            outside_tris.append(idx3)
        else:
            inside_tris.extend(fan([resolve(h) for h in _clip_polygon(idx3, is_inside)]))
            outside_tris.extend(fan([resolve(h) for h in _clip_polygon(idx3, lambda i: not is_inside(i))]))

    if new_pos:
        positions = np.vstack([positions, np.array(new_pos)])
        normals = np.vstack([normals, np.array(new_nrm)])
        uvs = np.vstack([uvs, np.array(new_uv)])
    to_flat = lambda tris: np.array(tris, dtype=np.uint32).reshape(-1) if tris else np.zeros(0, dtype=np.uint32)
    return to_flat(inside_tris), to_flat(outside_tris), positions, normals, uvs


def split_bands(tri_flat, positions, normals, uvs, boundaries):
    """Splits triangles into len(boundaries)+1 consecutive x-bands (ordered
    most-negative to most-positive) via repeated split_at_plane calls."""
    remaining = tri_flat
    bands = []
    for boundary in boundaries:
        band, remaining, positions, normals, uvs = split_at_plane(
            remaining, positions, normals, uvs, boundary
        )
        bands.append(band)
    bands.append(remaining)
    return bands, positions, normals, uvs


# Each source material maps to a LIST of split rules, applied in order --
# every rule only ever sees triangles the earlier rules in its list left
# behind, so the predicates don't need to be mutually exclusive by
# construction, only in practice (verified: the mirror caps sit well below
# the roof's y threshold, so the two never compete for the same triangles).
# The roof's own gray/stripe split is handled separately, by exact clipping,
# right after this list is applied (see the main loop below) -- it isn't a
# predicate rule because it needs to create new vertices along the cut,
# which these simple whole-triangle rules don't.
SPLIT_RULES = {
    'shFord_ShelbyGT350R_2016PaintA_Material1': [
        {
            'predicate': _is_mirror_cap,
            'name': 'MirrorCap_black',
            'baseColorFactor': CARBON_DARK,
            'metallic': 0.3,
            'roughness': 0.35,
        },
    ],
    'shFord_ShelbyGT350R_2016Coloured_Material1': [
        {
            'predicate': _is_exhaust_tip,
            'name': 'ExhaustTip_chrome',
            'baseColorFactor': EXHAUST_CHROME,
            'metallic': 0.9,
            'roughness': 0.25,
        },
    ],
}


def find_float(block, name, default=None):
    m = __import__('re').search(
        __import__('re').escape(name) + r'\s*=\s*(-?\d+\.?\d*(?:[eE][-+]?\d+)?)', block
    )
    return float(m.group(1)) if m else default


def find_color3(block, name):
    val = find_attr_value(block, name)
    if not val:
        return None
    inner, _ = val
    nums = [float(x) for x in __import__('re').findall(r'-?\d+\.?\d*(?:[eE][-+]?\d+)?', inner)]
    return tuple(nums[:3]) if len(nums) >= 3 else None


def find_texfile(block, shader_name):
    """Find `color3f inputs:X.connect = </.../shader_name.outputs:rgb>` then
    the referenced Shader's asset inputs:file, within this same material
    block's text."""
    import re

    m = re.search(re.escape(shader_name) + r'\.outputs:rgb', block)
    if not m:
        return None
    # find the nearest preceding `def Shader "shader_name"` and read forward
    # to its own inputs:file
    shader_def = re.search(r'def Shader "' + re.escape(shader_name) + r'"\s*\{', block)
    if not shader_def:
        return None
    body, _ = read_balanced_brace(block, shader_def.end() - 1)
    fm = re.search(r'asset inputs:file = @([^@]+)@', body)
    return fm.group(1) if fm else None


def parse_materials(text):
    """Return {material_name: {baseColorTexture, baseColorFactor, metallic,
    roughness, metallicTexture, roughnessTexture, normalTexture, opacity}},
    by a flat scan for `def Material "name" { ... }` blocks (materials in
    this file are never nested inside one another, so no need for the full
    prim-tree walk here)."""
    import re

    mats = {}
    idx = 0
    while True:
        m = re.compile(r'def Material "([^"]+)"\s*\{').search(text, idx)
        if not m:
            break
        name = m.group(1)
        body, after = read_balanced_brace(text, m.end() - 1)
        idx = after
        info = {
            'baseColorFactor': find_color3(body, 'color3f inputs:diffuseColor'),
            'baseColorTexture': find_texfile(body, 'tex_base'),
            'metallic': find_float(body, 'float inputs:metallic', 0.0),
            'roughness': find_float(body, 'float inputs:roughness', 0.5),
            'metallicTexture': find_texfile(body, 'tex_metallic'),
            'roughnessTexture': find_texfile(body, 'tex_roughness'),
            'normalTexture': find_texfile(body, 'tex_normal'),
            'opacity': find_float(body, 'float inputs:opacity', None),
        }
        mats[name] = info
    return mats


def srgb_to_linear(c255):
    """glTF's baseColorFactor is linear, not sRGB -- unlike a baseColorTexture
    image (sRGB bytes, which GLTFLoader/three.js convert on sampling
    automatically), a flat factor needs this conversion done ourselves or a
    picked-by-eye hex value renders visibly darker than intended."""
    c = c255 / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def webp_bytes(im, quality=90):
    buf = io.BytesIO()
    im.save(buf, format='WEBP', quality=quality, method=6)
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('usdz', type=Path, help="path to Ddiaz Design's GT350R .usdz")
    parser.add_argument(
        '--out-dir',
        type=Path,
        default=REPO / 'public' / 'models',
        help='directory for the raw GLB (default: public/models)',
    )
    args = parser.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix='garage-car-'))
    try:
        with zipfile.ZipFile(args.usdz) as z:
            z.extractall(workdir)
        scene_usda = workdir / 'scene.usda'
        with scene_usda.open('w') as f:
            subprocess.run(
                ['usdcat', str(workdir / 'scene.usdc')], stdout=f, check=True
            )
        tex_src = workdir  # textures live under workdir/0/..., same as the USDZ zip layout
        text = scene_usda.read_text()
        _run(text, tex_src, args.out_dir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _run(text, tex_src, out_dir):
    top_prims = tokenize_prims(text)
    scene = next(p for p in top_prims if p.type == 'Xform' and p.name == 'scene')
    meshes = []
    walk(scene, np.eye(4), meshes, [0])
    print(f'parsed {len(meshes)} meshes, {sum(len(m["indices"])//3 for m in meshes)} tris')

    materials = parse_materials(text)
    print(f'parsed {len(materials)} materials')

    by_mat = {}
    for m in meshes:
        by_mat.setdefault(m['material'], []).append(m)

    gltf = {
        'asset': {
            'version': '2.0',
            'generator': 'prepare-garage-car.py',
            'copyright': f'{AUTHOR}; {LICENSE}; see /credits/garage.html',
        },
        'extras': {
            'source': SOURCE_URL,
            'author': AUTHOR,
            'license': LICENSE,
            'modifications': (
                'Merged 550 mesh prims into one primitive per material, world '
                'transforms baked in. Body paint repainted gray with blue '
                'stripes (Henok’s actual car) from the original flat-color '
                'swatch. Rear wing and supports removed (1,428 triangles); '
                'wheel atlas brightened toward gunmetal with a continuous '
                'levels curve. Trim recolored; mirror caps and exhaust tips '
                'split into separate finishes; roof stripes geometrically '
                'clipped. Textures re-encoded to WebP. Represents a 2017 '
                'Shelby GT350 (non-R), with remaining GT350R body and wheel '
                'geometry retained as a cosmetic approximation.'
            ),
        },
        'scenes': [{'nodes': []}],
        'scene': 0,
        'nodes': [],
        'meshes': [],
        'materials': [],
        'textures': [],
        'images': [],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': [],
        'bufferViews': [],
        'buffers': [],
        'extensionsUsed': ['EXT_texture_webp'],
        'extensionsRequired': ['EXT_texture_webp'],
    }
    binary = bytearray()

    def view(data, target=None):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)
        v = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            v['target'] = target
        gltf['bufferViews'].append(v)
        return len(gltf['bufferViews']) - 1

    def attr(data, typ, component=5126):
        arr = np.asarray(data, dtype='<f4' if component == 5126 else '<u4')
        v = view(arr.tobytes(), 34963 if component == 5125 else 34962)
        info = {'bufferView': v, 'componentType': component, 'count': len(data), 'type': typ}
        if typ in ('VEC3', 'VEC2'):
            info.update(min=arr.min(0).tolist(), max=arr.max(0).tolist())
        gltf['accessors'].append(info)
        return len(gltf['accessors']) - 1

    texture_cache = {}

    def texture_index(image_relpath, recolor_fn=None, is_data=False, gray_pack=None):
        """image_relpath is the USD @0/....jpg@ path. gray_pack, if given, is
        a second grayscale texture path to pack into the blue channel
        (metallic) while image_relpath becomes green (roughness) -- glTF
        metallicRoughness convention. recolor_fn, if given, is applied to the
        source image before WebP encoding (recolor_paint or recolor_coloured)."""
        key = (image_relpath, recolor_fn, gray_pack)
        if key in texture_cache:
            return texture_cache[key]
        src_path = tex_src / image_relpath
        if gray_pack:
            rough = Image.open(src_path).convert('L')
            metal = Image.open(tex_src / gray_pack).convert('L')
            if metal.size != rough.size:
                metal = metal.resize(rough.size)
            packed = Image.merge(
                'RGB',
                (
                    Image.new('L', rough.size, 255),
                    rough,
                    metal,
                ),
            )
            data = webp_bytes(packed)
        elif recolor_fn:
            data = webp_bytes(recolor_fn(src_path))
        else:
            im = Image.open(src_path).convert('RGB')
            data = webp_bytes(im)
        gltf['images'].append({'bufferView': view(data), 'mimeType': 'image/webp', 'name': image_relpath})
        gltf['textures'].append(
            {'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(gltf['images']) - 1}}}
        )
        idx = len(gltf['textures']) - 1
        texture_cache[key] = idx
        return idx

    total_out_tris = 0
    for mat_name, group in by_mat.items():
        info = materials.get(mat_name, {})
        positions, normals, uvs, indices = [], [], [], []
        offset = 0
        for m in group:
            world = m['world']
            R = world[:3, :3]
            det = np.linalg.det(R)
            pts_h = np.hstack([m['points'], np.ones((len(m['points']), 1))])
            world_pts = (pts_h @ world)[:, :3]
            positions.append(world_pts)
            if m['normals'] is not None:
                normal_matrix = np.linalg.inv(R).T
                n = m['normals'] @ normal_matrix
                n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
                normals.append(n)
            else:
                normals.append(np.zeros_like(world_pts))
            if m['uvs'] is not None:
                uvs.append(m['uvs'])
            else:
                uvs.append(np.zeros((len(world_pts), 2)))
            idx = m['indices'].copy()
            if det < 0:
                idx = idx.reshape(-1, 3)[:, ::-1].reshape(-1)
            indices.append(idx + offset)
            offset += len(world_pts)
        positions = np.vstack(positions)
        normals = np.vstack(normals)
        uvs = np.vstack(uvs)
        indices = np.concatenate(indices)
        if predicate := DROP_RULES.get(mat_name):
            tri = indices.reshape(-1, 3)
            centroids = positions[tri].mean(axis=1)
            drop = np.array([predicate(*c, 0, 0) for c in centroids])
            print(f'  dropped {drop.sum()} rear-wing tris from {mat_name}')
            used, indices = np.unique(tri[~drop].reshape(-1), return_inverse=True)
            positions, normals, uvs = positions[used], normals[used], uvs[used]
            indices = indices.astype(np.uint32)

        # Applied in order: each rule only sees triangles the earlier rules
        # in this material's list didn't already claim.
        splits = []
        tri = indices.reshape(-1, 3)
        for split_rule in SPLIT_RULES.get(mat_name, []):
            centroids = positions[tri].mean(axis=1)
            tri_uv = uvs[tri].mean(axis=1)
            match = np.array(
                [
                    split_rule['predicate'](c[0], c[1], c[2], u[0], u[1])
                    for c, u in zip(centroids, tri_uv)
                ]
            )
            split_tri = tri[match]
            tri = tri[~match]
            print(
                f'  split {match.sum()} tris out of {mat_name} -> {split_rule["name"]}'
            )
            if len(split_tri):
                splits.append((split_rule, split_tri.reshape(-1)))
        indices = tri.reshape(-1)

        if mat_name == 'shFord_ShelbyGT350R_2016PaintA_Material1':
            centroids = positions[tri].mean(axis=1)
            roof_mask = np.array(
                [_is_roof(c[0], c[1], c[2], 0, 0) for c in centroids]
            )
            roof_tri = tri[roof_mask].reshape(-1)
            indices = tri[~roof_mask].reshape(-1)
            boundaries = sorted(
                [
                    -_ROOF_STRIPE_OUTER,
                    -_ROOF_STRIPE_INNER,
                    _ROOF_STRIPE_INNER,
                    _ROOF_STRIPE_OUTER,
                ]
            )
            bands, positions, normals, uvs = split_bands(
                roof_tri, positions, normals, uvs, boundaries
            )
            roof_gray = np.concatenate([bands[0], bands[2], bands[4]])
            roof_stripe = np.concatenate([bands[1], bands[3]])
            print(
                f'  split {len(roof_tri)//3} roof tris out of {mat_name} '
                f'-> RoofPaint_stripe ({len(roof_stripe)//3}) / RoofPaint_gray ({len(roof_gray)//3})'
            )
            if len(roof_stripe):
                splits.append(
                    (
                        {
                            'name': 'RoofPaint_stripe',
                            'baseColorFactor': STRIPE_BLUE,
                            'metallic': 0.0,
                            'roughness': 0.5,
                        },
                        roof_stripe,
                    )
                )
            if len(roof_gray):
                splits.append(
                    (
                        {
                            'name': 'RoofPaint_gray',
                            'baseColorFactor': BODY_GRAY,
                            'metallic': 0.0,
                            'roughness': 0.5,
                        },
                        roof_gray,
                    )
                )

        pos_accessor = attr(positions, 'VEC3')
        nrm_accessor = attr(normals, 'VEC3')
        uv_accessor = attr(uvs, 'VEC2')

        def emit_primitive(name, idx_array, pbr, normal_tex=None, alpha_blend=False):
            nonlocal total_out_tris
            total_out_tris += len(idx_array) // 3
            material_entry = {'name': name, 'doubleSided': True, 'pbrMetallicRoughness': pbr}
            if normal_tex is not None:
                material_entry['normalTexture'] = {'index': normal_tex}
            if alpha_blend:
                material_entry['alphaMode'] = 'BLEND'
            gltf['materials'].append(material_entry)
            gltf['meshes'].append(
                {
                    'name': name,
                    'primitives': [
                        {
                            'attributes': {
                                'POSITION': pos_accessor,
                                'NORMAL': nrm_accessor,
                                'TEXCOORD_0': uv_accessor,
                            },
                            'indices': attr(idx_array, 'SCALAR', 5125),
                            'material': len(gltf['materials']) - 1,
                        }
                    ],
                }
            )
            gltf['nodes'].append({'name': name, 'mesh': len(gltf['meshes']) - 1})
            gltf['scenes'][0]['nodes'].append(len(gltf['nodes']) - 1)

        pbr = {'metallicFactor': info.get('metallic', 0.0) or 0.0, 'roughnessFactor': info.get('roughness', 0.5) or 0.5}
        normal_tex = None
        alpha_blend = bool(info.get('opacity') is not None and info.get('opacity') < 1.0)
        if info.get('baseColorTexture'):
            recolor_fn = {
                'shFord_ShelbyGT350R_2016PaintA_Material1': recolor_paint,
                'shFord_ShelbyGT350R_2016Coloured_Material1': recolor_coloured,
                'shFord_ShelbyGT350RElite_2016_Wheel1A_3D_3DWheel1B_Material1': recolor_wheels,
            }.get(mat_name)
            gray_pack = None
            if info.get('roughnessTexture') and info.get('metallicTexture'):
                gray_pack = info['metallicTexture']
                metallic_rough_tex = texture_index(
                    info['roughnessTexture'], gray_pack=gray_pack
                )
                pbr['metallicRoughnessTexture'] = {'index': metallic_rough_tex}
                pbr['metallicFactor'] = 1.0
                pbr['roughnessFactor'] = 1.0
            pbr['baseColorTexture'] = {'index': texture_index(info['baseColorTexture'], recolor_fn=recolor_fn)}
        elif info.get('baseColorFactor'):
            r, g, b = info['baseColorFactor']
            a = info.get('opacity')
            pbr['baseColorFactor'] = [r, g, b, a if a is not None else 1.0]
        if info.get('normalTexture'):
            normal_tex = texture_index(info['normalTexture'])

        emit_primitive(mat_name, indices, pbr, normal_tex, alpha_blend)
        print(f'  {mat_name}: {len(positions)} verts, {len(indices)//3} tris, texture={bool(info.get("baseColorTexture"))}')

        for split_rule, split_indices in splits:
            lin = srgb_to_linear(np.array(split_rule['baseColorFactor'], dtype=np.float64))
            split_pbr = {
                'baseColorFactor': [*lin.tolist(), 1.0],
                'metallicFactor': split_rule['metallic'],
                'roughnessFactor': split_rule['roughness'],
            }
            emit_primitive(split_rule['name'], split_indices, split_pbr)
            print(f'  {split_rule["name"]}: {len(split_indices)//3} tris (split from {mat_name})')

    while len(binary) % 4:
        binary.append(0)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    meta = json.dumps(gltf, separators=(',', ':')).encode()
    meta += b' ' * ((-len(meta)) % 4)
    target = out_dir / 'garage-gt350r-raw.glb'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(
        struct.pack('<4sII', b'glTF', 2, 28 + len(meta) + len(binary))
        + struct.pack('<II', len(meta), 0x4E4F534A)
        + meta
        + struct.pack('<II', len(binary), 0x004E4942)
        + binary
    )
    print(f'wrote {target} ({target.stat().st_size:,} bytes), {total_out_tris} total tris, {len(gltf["materials"])} materials')


if __name__ == '__main__':
    main()
