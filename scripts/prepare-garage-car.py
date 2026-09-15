#!/usr/bin/env python3
"""Composites Henok's actual 2016 Shelby GT350R (gray, with blue racing
stripes) from a downloaded Sketchfab model into a merged, Draco-ready GLB
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
was identified). This derivative remains CC BY-NC-SA 4.0: non-commercial
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


SPLIT_RULES = {
    'shFord_ShelbyGT350R_2016PaintA_Material1': {
        'predicate': _is_mirror_cap,
        'name': 'MirrorCap_black',
        'baseColorFactor': CARBON_DARK,
        'metallic': 0.3,
        'roughness': 0.35,
    },
    'shFord_ShelbyGT350R_2016Coloured_Material1': {
        'predicate': _is_exhaust_tip,
        'name': 'ExhaustTip_chrome',
        'baseColorFactor': EXHAUST_CHROME,
        'metallic': 0.9,
        'roughness': 0.25,
    },
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
                'swatch. Textures re-encoded to WebP. Geometry/UV otherwise '
                'unchanged from the Sketchfab source.'
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
        total_out_tris += len(indices) // 3

        split_rule = SPLIT_RULES.get(mat_name)
        split_indices = None
        if split_rule:
            tri = indices.reshape(-1, 3)
            centroids = positions[tri].mean(axis=1)
            tri_uv = uvs[tri].mean(axis=1)
            match = np.array(
                [
                    split_rule['predicate'](c[0], c[1], c[2], u[0], u[1])
                    for c, u in zip(centroids, tri_uv)
                ]
            )
            split_indices = tri[match].reshape(-1)
            indices = tri[~match].reshape(-1)
            print(
                f'  split {match.sum()} tris out of {mat_name} -> {split_rule["name"]}'
            )

        pos_accessor = attr(positions, 'VEC3')
        nrm_accessor = attr(normals, 'VEC3')
        uv_accessor = attr(uvs, 'VEC2')

        def emit_primitive(name, idx_array, pbr, normal_tex=None, alpha_blend=False):
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

        if split_rule is not None and len(split_indices):
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
    target = out_dir / "garage-gt350r-raw.glb"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(
        struct.pack('<4sII', b'glTF', 2, 28 + len(meta) + len(binary))
        + struct.pack('<II', len(meta), 0x4E4F534A)
        + meta
        + struct.pack('<II', len(binary), 0x004E4942)
        + binary
    )
    print(f'wrote {target} ({target.stat().st_size:,} bytes), {total_out_tris} total tris, {len(by_mat)} materials')


if __name__ == '__main__':
    main()
