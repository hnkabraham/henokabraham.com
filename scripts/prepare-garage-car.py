#!/usr/bin/env python3
"""Represents Henok's 2017 Shelby GT350 (gray, with blue racing stripes)
using a downloaded GT350R model in a merged, Draco-ready GLB
for the site's Garage section.

The source USDZ (2016 Ford Mustang Shelby GT350R by Ddiaz Design, Sketchfab,
CC BY-NC-SA 4.0) is not committed to this repository -- supply your own copy
to reproduce (see .gitignore). Its 550 separate mesh prims are merged into
one primitive per material, with V turned over from USD's bottom-left
texture origin to glTF's top-left; the body paint's flat-color swatch is
repainted from its default scheme to gray-with-blue-stripes; the mirror caps
and exhaust tips, which share UV space with parts that must stay a different
color, are split out into their own materials rather than recolored in
place, and the roof, whose UVs barely cross the swatch's stripe bands, gets
new ones that cross them as the hood's do (see the module-level comments
below for how each region was identified). The rear
wing is removed, and the wheels' GT350R faces give way to the base car's
ten-spoke wheel, built in garage_wheel.py; the remaining R-trim body
geometry is an approximation of the non-R car. This derivative remains
CC BY-NC-SA 4.0: non-commercial use, share-alike, with attribution -- see
public/credits/garage.html.

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
import re
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
import garage_wheel

REPO = Path(__file__).resolve().parent.parent
SOURCE_URL = 'https://sketchfab.com/3d-models/2016-ford-mustang-shelby-gt350r-1d03bb121b6e4371b0978dc584b788d8'
AUTHOR = 'Ddiaz Design (https://sketchfab.com/ddiaz-design)'
LICENSE = 'CC-BY-NC-SA-4.0'

# Photo-sampled from Henok's own car (front 3/4 and side photos he sent):
# clean patches of quarter-panel paint and hood/bumper stripe, picked to
# avoid sky reflections and direct-sun specular blowout on the glossy paint.
BODY_GRAY = (0x5F, 0x65, 0x6B)
STRIPE_BLUE = (0x09, 0x2E, 0x70)
# The mirror caps and the stripes' pinstripe -- a neutral near-black in the
# photos.
CARBON_DARK = (0x1A, 0x1A, 0x1C)
# Satin/chrome-ish metal exhaust tips -- kept apart from CARBON_DARK on
# purpose, real tips are metallic light gray, not black.
EXHAUST_CHROME = (0xB0, 0xB4, 0xB8)
# The base GT350's Ebony Black painted wheel, and its lug nuts.
WHEEL_BLACK = (0x14, 0x15, 0x18)
LUG_METAL = (0x4A, 0x4D, 0x52)
# The base GT350's Shelby snake badges, polished alloy where the GT350R's
# are red.
BADGE_ALLOY = (0xB8, 0xBC, 0xC0)

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


# The grille and trunk badges both sample one cell of the badge atlas, the
# R's red snake (u 0.61-0.98, v 0.02-0.66 from the top; found from their
# triangles' UVs, and no other part's UVs reach into it). Inside that cell
# the red field turns alloy, in proportion to how far red stands above the
# pixel's other channels, so the snake's dark outlines and white scales and
# the antialiased edges between them keep their shading.
_BADGE_CELL = ((0.61, 0.98), (0.02, 0.66))


def recolor_badge(path):
    arr = np.array(Image.open(path).convert('RGB')).astype(np.float64)
    (u0, u1), (v0, v1) = _BADGE_CELL
    h, w = arr.shape[:2]
    cell = arr[round(v0 * h) : round(v1 * h), round(u0 * w) : round(u1 * w)]
    rest = cell[..., 1:].max(axis=-1, keepdims=True)
    red = np.clip((cell[..., :1] - rest) / 190, 0, 1)
    cell[:] = (1 - red) * rest + red * np.array(BADGE_ALLOY, dtype=np.float64)
    return Image.fromarray(arr.round().astype(np.uint8), 'RGB')


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


# The Coloured prim also contains unrelated trim. This box matches only
# its disconnected wing blade and two supports (1,428 triangles), including
# the feet below y=1; the painted trunk deck belongs to PaintA and stays intact.
def _is_rear_wing(cx, cy, cz, u, v):
    return abs(cx) < 0.8 and 0.97 < cy < 1.2 and -2.33 < cz < -1.83


DROP_RULES = {'shFord_ShelbyGT350R_2016Coloured_Material1': _is_rear_wing}


# The wheels. The source's wheel material is 432 prims, the same 108 at each
# corner (polySurface1-108 at the right front, 109-216 left front, 217-324
# right rear, 325-432 left rear), and by their radius from the axle and
# depth they are: the tire (46-67, all outside 245 mm), the brake disc and
# its hat (36, 68-79, inside 205 mm and behind the hub), the rim's lip,
# barrel and inner flange (80-82, and 97, a ring behind the lip), the valve
# stem (41-45), and the GT350R's own face: its seven spokes and their joins
# to the lip (83-96), the hub (98-108), and the lug nuts and centre cap
# (1-35, 37-40). Henok's 2017 GT350 has the base car's cast wheel, so the
# R's face is dropped and garage_wheel.py builds that wheel's face in its
# place, at each corner's own axle and lip; the lip, barrel and flange keep
# their shape and take the face's black paint, and the tire, brake and valve
# keep the wheel atlas, as converted. (It was once brightened toward
# gunmetal, which was for the R's carbon face; with that gone it only made
# the brake discs and tires paler than the photos of the car show.)
WHEEL_MATERIAL = 'shFord_ShelbyGT350RElite_2016_Wheel1A_3D_3DWheel1B_Material1'
_WHEEL_PRIMS_PER_CORNER = 108
_WHEEL_R_FACE = {*range(1, 36), *range(37, 41), *range(83, 97), *range(98, 109)}
_WHEEL_RIM = {80, 81, 82, 97}
_WHEEL_TIRE = set(range(46, 68))
_WHEEL_LIP = 80


def _wheel_prim(name):
    n = int(re.match(r'polySurface(\d+)_', name).group(1))
    return (n - 1) % _WHEEL_PRIMS_PER_CORNER + 1


def _wheel_corners(group):
    """Each corner's axle centre (the middle of its tire's extent), side
    and lip plane (the lip's outermost |x|), for garage_wheel.build."""
    corners = {}
    for m in group:
        n = _wheel_prim(m['name'])
        if n not in _WHEEL_TIRE and n != _WHEEL_LIP:
            continue
        pts = (np.hstack([m['points'], np.ones((len(m['points']), 1))]) @ m['world'])[:, :3]
        key = (float(np.sign(pts[:, 0].mean())), float(np.sign(pts[:, 2].mean())))
        corner = corners.setdefault(key, {'tire': [], 'lip': None})
        if n == _WHEEL_LIP:
            corner['lip'] = pts
        else:
            corner['tire'].append(pts)
    out = []
    for (side, _), corner in sorted(corners.items()):
        tire = np.vstack(corner['tire'])
        out.append(
            {
                'side': side,
                'centre': (
                    (tire[:, 1].min() + tire[:, 1].max()) / 2,
                    (tire[:, 2].min() + tire[:, 2].max()) / 2,
                ),
                'lip_face': np.abs(corner['lip'][:, 0]).max(),
            }
        )
    return out


# The wheel's new parts, by garage_wheel.build's finish names. "Paint" in a
# name gives it the body's clearcoat in the viewer (garage-scene.tsx).
WHEEL_FINISHES = {
    'paint': {'name': 'WheelPaint_face', 'baseColorFactor': WHEEL_BLACK, 'metallic': 0.1, 'roughness': 0.45},
    'lug': {'name': 'LugNut_metal', 'baseColorFactor': LUG_METAL, 'metallic': 0.9, 'roughness': 0.25},
    'chrome': {'name': 'CenterCap_oval', 'baseColorFactor': EXHAUST_CHROME, 'metallic': 0.9, 'roughness': 0.25},
}


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
# artist's own UV layout for this one panel barely crosses the swatch's
# bands. The swatch is horizontal bands (gray, dark pinstripe, stripe, gray
# gap, stripe, pinstripe, gray), and the hood and trunk run v across them at
# about 1.28 per metre of world X (falling as x rises), while the roof's v
# moves 0.04 per metre, so the whole roof samples the stripe cell. Recoloring
# the texture can't fix a per-panel UV choice, so the roof's v is rewritten
# from world X at the hood's and trunk's own rate instead: the same texture,
# finish, gap and pinstripe, in the same place. The rate was read off the
# swatch and the hood and trunk, sampled at their UVs and bucketed by world
# X: the gap's edges (rows 122 and 134 of 256) fall at x = +/-18 mm and the
# stripe's outer edge (row 187) at +/-180 mm on both, either side of v = 0.5,
# the swatch's centre. Past |x| = 0.3 m v is held, in the gray rows; no roof
# triangle that reaches the stripes spans past |x| = 0.264 m, so each of
# those stays exactly linear. An earlier version split the roof into
# flat-color stripe and gray materials, which drew the stripes too narrow and
# without the pinstripe.
_ROOF_Y_MIN = 1.15
_ROOF_Z_RANGE = (-1.15, 0.35)
_ROOF_X_MAX = 0.75
_ROOF_V_PER_METRE = 1.28
_ROOF_V_HELD_BEYOND = 0.3


def _is_roof(cx, cy, cz, u, v):
    return (
        cy > _ROOF_Y_MIN
        and _ROOF_Z_RANGE[0] < cz < _ROOF_Z_RANGE[1]
        and abs(cx) < _ROOF_X_MAX
    )


# Each source material maps to a LIST of split rules, applied in order --
# every rule only ever sees triangles the earlier rules in its list left
# behind, so the predicates don't need to be mutually exclusive by
# construction, only in practice (verified: the mirror caps sit well below
# the roof's y threshold, so the two never compete for the same triangles).
# The roof keeps its material and gets new UVs instead, right after this
# list is applied (see the main loop below), so the mirror caps are matched
# on the roof's original UVs.
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
    WHEEL_MATERIAL: [
        {
            'prims': _WHEEL_RIM,
            'name': 'WheelPaint_rim',
            'baseColorFactor': WHEEL_BLACK,
            'metallic': 0.1,
            'roughness': 0.45,
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
                'transforms baked in, texture V turned over from USD’s origin '
                'to glTF’s. Body paint repainted gray with blue '
                'stripes (Henok’s actual car) from the original flat-color '
                'swatch. Rear wing and supports removed (1,428 triangles); '
                'the wheels’ GT350R faces replaced by the base 2015-2018 '
                'GT350’s ten-spoke wheel, modeled from measurements. The red '
                'snake badges recolored the base car’s polished alloy. Mirror '
                'caps and exhaust tips '
                'split into separate finishes; the roof’s UVs re-mapped onto '
                'the stripe bands the hood samples. Textures re-encoded to '
                'WebP. Represents a 2017 Shelby GT350 (non-R), with remaining '
                'GT350R body geometry retained as a cosmetic approximation.'
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
        source image before WebP encoding (recolor_paint or recolor_badge)."""
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
        # Each triangle's source prim, for the rules that go by prim.
        tri_mesh = np.repeat(np.arange(len(group)), [len(m['indices']) // 3 for m in group])
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
                # USD's st origin is the image's bottom-left corner, glTF's
                # its top-left, so V turns over on the way across.
                uv = m['uvs'].copy()
                uv[:, 1] = 1 - uv[:, 1]
                uvs.append(uv)
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
        tri = indices.reshape(-1, 3)
        drop = np.zeros(len(tri), dtype=bool)
        if predicate := DROP_RULES.get(mat_name):
            centroids = positions[tri].mean(axis=1)
            drop = np.array([predicate(*c, 0, 0) for c in centroids])
            print(f'  dropped {drop.sum()} rear-wing tris from {mat_name}')
        if mat_name == WHEEL_MATERIAL:
            prim = np.array([_wheel_prim(m['name']) for m in group])[tri_mesh]
            drop = np.isin(prim, list(_WHEEL_R_FACE))
            print(f'  dropped {drop.sum()} GT350R wheel-face tris from {mat_name}')
        if drop.any():
            used, indices = np.unique(tri[~drop].reshape(-1), return_inverse=True)
            positions, normals, uvs = positions[used], normals[used], uvs[used]
            indices = indices.astype(np.uint32)
            tri_mesh = tri_mesh[~drop]

        # Applied in order: each rule only sees triangles the earlier rules
        # in this material's list didn't already claim.
        splits = []
        tri = indices.reshape(-1, 3)
        for split_rule in SPLIT_RULES.get(mat_name, []):
            if 'prims' in split_rule:
                prim = np.array([_wheel_prim(m['name']) for m in group])[tri_mesh]
                match = np.isin(prim, list(split_rule['prims']))
            else:
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
            tri_mesh = tri_mesh[~match]
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
            # The roof gets its own copies of its vertices: 44 of them are
            # shared with the window surrounds, whose UVs stay as authored.
            roof_vertices, roof_tri = np.unique(
                tri[roof_mask].reshape(-1), return_inverse=True
            )
            roof_uvs = uvs[roof_vertices].copy()
            roof_uvs[:, 1] = 0.5 - _ROOF_V_PER_METRE * np.clip(
                positions[roof_vertices, 0],
                -_ROOF_V_HELD_BEYOND,
                _ROOF_V_HELD_BEYOND,
            )
            tri = tri.copy()
            tri[roof_mask] = roof_tri.reshape(-1, 3) + len(positions)
            positions = np.vstack([positions, positions[roof_vertices]])
            normals = np.vstack([normals, normals[roof_vertices]])
            uvs = np.vstack([uvs, roof_uvs])
            indices = tri.reshape(-1)
            print(
                f'  remapped {roof_mask.sum()} roof tris ({len(roof_vertices)} '
                f'verts) of {mat_name} onto the hood\'s stripe bands'
            )

        pos_accessor = attr(positions, 'VEC3')
        nrm_accessor = attr(normals, 'VEC3')
        uv_accessor = attr(uvs, 'VEC2')

        def emit_primitive(name, idx_array, pbr, normal_tex=None, alpha_blend=False, attributes=None):
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
                            'attributes': attributes
                            or {
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
                'shFord_ShelbyGT350R_2016BadgeA_Material1': recolor_badge,
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

        if mat_name == WHEEL_MATERIAL:
            corners = _wheel_corners(group)
            for finish, (face_pos, face_nrm, face_idx) in garage_wheel.build(corners).items():
                rule = WHEEL_FINISHES[finish]
                lin = srgb_to_linear(np.array(rule['baseColorFactor'], dtype=np.float64))
                emit_primitive(
                    rule['name'],
                    face_idx,
                    {
                        'baseColorFactor': [*lin.tolist(), 1.0],
                        'metallicFactor': rule['metallic'],
                        'roughnessFactor': rule['roughness'],
                    },
                    attributes={'POSITION': attr(face_pos, 'VEC3'), 'NORMAL': attr(face_nrm, 'VEC3')},
                )
                print(f'  {rule["name"]}: {len(face_idx)//3} tris (built by garage_wheel.py, {len(corners)} corners)')

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
