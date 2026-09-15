#!/usr/bin/env python3
"""Parse the Sketchfab GT350R scene.usda into merged-per-material numpy arrays.

USD conventions this relies on (verified by inspection of this specific file):
- Row-vector convention: world_point_row = local_point_row @ xformOp:transform,
  translation lives in the matrix's last ROW. Composing toward the root is
  cumulative = local_matrix @ cumulative_parent.
- A prim may carry `xformOp:transform` (a full 4x4) OR `xformOp:scale` (a
  float3) per its `xformOpOrder` -- never both in this file.
- normals/primvars:st0 on every Mesh here use interpolation="vertex", so they
  align 1:1 with `points` and share `faceVertexIndices` -- no separate
  primvar indexing to resolve.
- faceVertexCounts are uniformly 3 (already triangulated) everywhere.
- material:binding is authored directly on each Mesh prim.
- Stage metersPerUnit = 0.01, and a "Meshes" Xform applies xformOp:scale
  (100,100,100), so the two cancel out -- but rather than reason about which
  node is in which unit, this composes ALL transforms verbatim in the file's
  native units and applies metersPerUnit exactly once, at the very end, to
  the fully merged, fully composed world-space points. That sidesteps any
  ambiguity about intermediate units entirely.
"""
import re
import sys
from pathlib import Path

import numpy as np

FLOAT = r'-?\d+\.?\d*(?:[eE][-+]?\d+)?'


def read_balanced(text, start):
    """From text[start] (a '[' or '('), return (inner_text, end_index_after_close)."""
    open_c = text[start]
    close_c = ']' if open_c == '[' else ')'
    depth = 0
    i = start
    while i < len(text):
        if text[i] == open_c:
            depth += 1
        elif text[i] == close_c:
            depth -= 1
            if depth == 0:
                return text[start + 1 : i], i + 1
        i += 1
    raise ValueError(f'unbalanced {open_c!r} starting at {start}')


def parse_floats(s):
    return [float(x) for x in re.findall(FLOAT, s)]


def parse_vec_list(s):
    """'(a,b,c), (d,e,f), ...' -> Nx3 (or NxK) list of tuples."""
    out = []
    i = 0
    while i < len(s):
        if s[i] == '(':
            inner, i = read_balanced(s, i)
            out.append(parse_floats(inner))
        else:
            i += 1
    return out


def find_attr_value(block, name):
    """Find `name = <value>` (value starts with [ or ( ) at the top level of
    this single-prim block (block already excludes nested child prims'
    braces at this scanning level is NOT guaranteed -- caller passes only the
    prim's own attribute text, see extract_prim_body)."""
    m = re.search(re.escape(name) + r'\s*=\s*([\[\(])', block)
    if not m:
        return None
    start = m.end() - 1
    inner, end = read_balanced(block, start)
    return inner, block[end:]


class Prim:
    __slots__ = ('type', 'name', 'attrs_text', 'children', 'matrix')

    def __init__(self, type_, name):
        self.type = type_
        self.name = name
        self.attrs_text = ''
        self.children = []
        self.matrix = np.eye(4)


def tokenize_prims(text):
    """Recursive-descent split of `def Type "name" ( ... )? { ... }` blocks,
    returning a forest of Prim, each with its own attrs_text (own-level text
    only, children excluded) and nested children."""

    def parse_block(s, i, end):
        prims = []
        while i < end:
            m = re.compile(r'def\s+(\w+)\s+"([^"]+)"').match(s, i)
            if m:
                type_, name = m.group(1), m.group(2)
                j = m.end()
                # skip optional prim metadata ( ... ) before the { body
                while j < end and s[j] in ' \t\r\n':
                    j += 1
                if j < end and s[j] == '(':
                    _, j = read_balanced(s, j)
                    while j < end and s[j] in ' \t\r\n':
                        j += 1
                if j >= end or s[j] != '{':
                    i = j
                    continue
                body_inner, after = read_balanced_brace(s, j)
                prim = Prim(type_, name)
                # own attrs_text = body_inner with nested `def ...{...}` blocks removed
                prim.attrs_text, nested_spans = strip_nested_defs(body_inner)
                prim.children = parse_block(body_inner, 0, len(body_inner))
                prims.append(prim)
                i = after
            else:
                i += 1
        return prims

    return parse_block(text, 0, len(text))


def read_balanced_brace(s, start):
    assert s[start] == '{'
    depth = 0
    i = start
    while i < len(s):
        if s[i] == '{':
            depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0:
                return s[start + 1 : i], i + 1
        i += 1
    raise ValueError('unbalanced brace')


def strip_nested_defs(body):
    """Remove nested `def Type "name" {...}` sub-blocks from body, returning
    the remaining top-level text (this prim's own attributes)."""
    out = []
    i = 0
    n = len(body)
    pat = re.compile(r'def\s+\w+\s+"[^"]+"')
    while i < n:
        m = pat.match(body, i)
        if m:
            j = m.end()
            while j < n and body[j] in ' \t\r\n':
                j += 1
            if j < n and body[j] == '(':
                _, j = read_balanced(body, j)
                while j < n and body[j] in ' \t\r\n':
                    j += 1
            if j < n and body[j] == '{':
                _, after = read_balanced_brace(body, j)
                i = after
                continue
        out.append(body[i])
        i += 1
    return ''.join(out), None


def matrix_from_prim(prim):
    """Return this prim's own local 4x4 (row-vector convention), or identity."""
    val = find_attr_value(prim.attrs_text, 'matrix4d xformOp:transform')
    if val:
        inner, _ = val
        rows = parse_vec_list(inner)
        assert len(rows) == 4 and all(len(r) == 4 for r in rows), rows
        return np.array(rows, dtype=np.float64)
    val = find_attr_value(prim.attrs_text, 'float3 xformOp:scale')
    if val:
        inner, _ = val
        sx, sy, sz = parse_floats(inner)
        return np.diag([sx, sy, sz, 1.0])
    return np.eye(4)


def material_binding(prim):
    m = re.search(r'rel material:binding = </scene/Materials/([^>]+)>', prim.attrs_text)
    return m.group(1) if m else None


def mesh_data(prim):
    pts = find_attr_value(prim.attrs_text, 'point3f[] points')
    idx = find_attr_value(prim.attrs_text, 'int[] faceVertexIndices')
    nrm = find_attr_value(prim.attrs_text, 'normal3f[] normals')
    uv = find_attr_value(prim.attrs_text, 'texCoord2f[] primvars:st0')
    if not (pts and idx):
        return None
    points = np.array(parse_vec_list(pts[0]), dtype=np.float64)
    indices = np.array(parse_floats(idx[0]), dtype=np.int64)
    normals = np.array(parse_vec_list(nrm[0]), dtype=np.float64) if nrm else None
    uvs = np.array(parse_vec_list(uv[0]), dtype=np.float64) if uv else None
    return points, indices, normals, uvs


def walk(prim, parent_matrix, meshes, xform_count):
    local = matrix_from_prim(prim)
    world = local @ parent_matrix
    if prim.type == 'Mesh':
        data = mesh_data(prim)
        if data:
            points, indices, normals, uvs = data
            mat = material_binding(prim)
            meshes.append(
                {
                    'name': prim.name,
                    'material': mat,
                    'points': points,
                    'indices': indices,
                    'normals': normals,
                    'uvs': uvs,
                    'world': world,
                }
            )
    for child in prim.children:
        walk(child, world, meshes, xform_count)


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('scene.usda')
    text = src.read_text()
    # Parse the whole document into a prim forest (tokenize_prims already
    # correctly skips each prim's optional metadata-parens block, which a
    # simple "up to the first '{'" regex cannot do since that metadata block
    # (assetInfo = {...}) contains braces of its own before the real body).
    top_prims = tokenize_prims(text)
    scene = next((p for p in top_prims if p.type == 'Xform' and p.name == 'scene'), None)
    assert scene, f'root Xform "scene" not found among {[(p.type, p.name) for p in top_prims]}'

    meshes = []
    walk(scene, np.eye(4), meshes, [0])

    total_tris = sum(len(m['indices']) // 3 for m in meshes)
    by_material = {}
    for m in meshes:
        by_material.setdefault(m['material'], []).append(m)

    print(f'meshes found: {len(meshes)}')
    print(f'total triangles: {total_tris}')
    print(f'distinct materials referenced: {len(by_material)}')
    for mat, ms in sorted(by_material.items(), key=lambda kv: -sum(len(x["indices"]) // 3 for x in kv[1])):
        tris = sum(len(x['indices']) // 3 for x in ms)
        print(f'  {mat!r}: {len(ms)} meshes, {tris} tris')

    # bounding box sanity check, in native units (pre metersPerUnit scale)
    all_pts = []
    for m in meshes:
        pts_h = np.hstack([m['points'], np.ones((len(m['points']), 1))])
        world_pts = pts_h @ m['world']
        all_pts.append(world_pts[:, :3])
    all_pts = np.vstack(all_pts)
    mins = all_pts.min(axis=0)
    maxs = all_pts.max(axis=0)
    print('bbox (native units):', mins, maxs, 'size:', maxs - mins)
    print('bbox (meters, x0.01):', (mins * 0.01), (maxs * 0.01), 'size:', (maxs - mins) * 0.01)

    return meshes


if __name__ == '__main__':
    main()
