#!/usr/bin/env python3
"""Build the phone variant of the Draco aircraft: identical geometry, textures
halved to 2048². A narrow viewport never resolves the 4096² maps, and the
three textures are 889 KB of the 1,279 KB model on the wire.

The Draco buffers are copied byte for byte, so the phone mesh is the desktop
mesh; only the image bufferViews change and the binary chunk is re-packed.

Usage: python3 scripts/prepare-dreamliner-phone.py [input.glb] [output.glb]
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

SIZE = 2048
QUALITY = 88
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'public/models/dreamliner-787-9.glb'
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'public/models/dreamliner-787-9-phone.glb'
    raw = src.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw, 0)
    assert magic == 0x46546C67 and version == 2 and length == len(raw), 'not a GLB 2 file'
    json_len, json_type = struct.unpack_from('<II', raw, 12)
    assert json_type == JSON_CHUNK
    doc = json.loads(raw[20:20 + json_len])
    bin_len, bin_type = struct.unpack_from('<II', raw, 20 + json_len)
    assert bin_type == BIN_CHUNK
    bin_start = 28 + json_len
    binary = raw[bin_start:bin_start + bin_len]
    assert len(doc['buffers']) == 1 and 'uri' not in doc['buffers'][0]

    replacements: dict[int, bytes] = {}
    for image in doc.get('images', []):
        view = doc['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        data = binary[start:start + view['byteLength']]
        im = Image.open(io.BytesIO(data))
        assert image['mimeType'] == 'image/webp' and im.size == (4096, 4096), (image.get('name'), im.size)
        small = im.resize((SIZE, SIZE), Image.LANCZOS)
        out = io.BytesIO()
        small.save(out, 'WEBP', quality=QUALITY, method=6)
        replacements[image['bufferView']] = out.getvalue()
        print(f"{image.get('name')}: {len(data):,} -> {len(out.getvalue()):,} bytes")

    # Re-pack every bufferView in its original order, 4-byte aligned.
    order = sorted(range(len(doc['bufferViews'])), key=lambda i: doc['bufferViews'][i].get('byteOffset', 0))
    packed = bytearray()
    for index in order:
        view = doc['bufferViews'][index]
        start = view.get('byteOffset', 0)
        data = replacements.get(index, binary[start:start + view['byteLength']])
        packed += b'\0' * (-len(packed) % 4)
        view['byteOffset'] = len(packed)
        view['byteLength'] = len(data)
        packed += data
    doc['buffers'][0]['byteLength'] = len(packed)

    json_bytes = pad(json.dumps(doc, separators=(',', ':')).encode(), b' ')
    bin_bytes = pad(bytes(packed), b'\0')
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = bytearray(struct.pack('<III', magic, version, total))
    out += struct.pack('<II', len(json_bytes), JSON_CHUNK) + json_bytes
    out += struct.pack('<II', len(bin_bytes), BIN_CHUNK) + bin_bytes
    dst.write_bytes(out)
    print(f'{dst.relative_to(root)}: {len(out):,} bytes (desktop {len(raw):,})')


if __name__ == '__main__':
    main()
