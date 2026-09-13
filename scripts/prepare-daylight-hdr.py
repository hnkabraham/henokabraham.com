#!/usr/bin/env python3
"""Halve a Radiance RGBE (.hdr) equirectangular map, preserving its range.

The scene uses public/scenery/daylight.hdr only as the source of a prefiltered
environment map for reflections, which the renderer reduces to a small cube
map anyway. 512 x 256 is indistinguishable in that role and a quarter of the
transfer. Averaging happens in linear float, then re-encodes as RGBE with
run-length scanlines.

Usage: python3 scripts/prepare-daylight-hdr.py <in.hdr> <out.hdr> [--factor 2]
"""
import argparse
import numpy as np


def read_hdr(path):
    with open(path, 'rb') as f:
        data = f.read()
    pos = 0
    header = []
    while True:
        end = data.index(b'\n', pos)
        line = data[pos:end]
        pos = end + 1
        if line == b'':
            break
        header.append(line)
    end = data.index(b'\n', pos)
    tokens = data[pos:end].split()
    pos = end + 1
    assert tokens[0] == b'-Y' and tokens[2] == b'+X', tokens
    height, width = int(tokens[1]), int(tokens[3])
    out = np.zeros((height, width, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(height):
        if buf[pos] == 2 and buf[pos + 1] == 2 and (int(buf[pos + 2]) << 8 | int(buf[pos + 3])) == width:
            pos += 4
            for c in range(4):
                x = 0
                while x < width:
                    n = int(buf[pos])
                    pos += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = buf[pos]
                        pos += 1
                    else:
                        out[y, x:x + n, c] = buf[pos:pos + n]
                        pos += n
                    x += n
        else:
            out[y] = buf[pos:pos + width * 4].reshape(width, 4)
            pos += width * 4
    return out


def to_float(rgbe):
    e = rgbe[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return rgbe[..., :3].astype(np.float64) * scale[..., None]


def to_rgbe(rgb):
    peak = rgb.max(axis=-1)
    mantissa, exponent = np.frexp(peak)
    scale = np.where(peak > 1e-32, mantissa * 256.0 / np.maximum(peak, 1e-32), 0.0)
    out = np.zeros(rgb.shape[:-1] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(peak > 1e-32, exponent + 128, 0).astype(np.uint8)
    return out


def rle_channel(values):
    out = bytearray()
    x, n = 0, len(values)
    while x < n:
        run = 1
        while x + run < n and run < 127 and values[x + run] == values[x]:
            run += 1
        if run >= 4:
            out += bytes((128 + run, values[x]))
            x += run
            continue
        start = x
        while x < n and x - start < 128:
            ahead = 1
            while x + ahead < n and ahead < 4 and values[x + ahead] == values[x]:
                ahead += 1
            if ahead >= 4:
                break
            x += 1
        out += bytes((x - start,)) + bytes(values[start:x])
    return out


def write_hdr(path, rgbe):
    height, width = rgbe.shape[:2]
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {height} +X {width}\n'.encode())
        for y in range(height):
            f.write(bytes((2, 2, width >> 8, width & 255)))
            for c in range(4):
                f.write(rle_channel(rgbe[y, :, c].tolist()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--factor', type=int, default=2)
    args = parser.parse_args()
    rgb = to_float(read_hdr(args.input))
    k = args.factor
    h, w = (rgb.shape[0] // k) * k, (rgb.shape[1] // k) * k
    small = rgb[:h, :w].reshape(h // k, k, w // k, k, 3).mean(axis=(1, 3))
    write_hdr(args.output, to_rgbe(small))
    check = to_float(read_hdr(args.output))
    print(
        f'{args.output}: {small.shape[1]}x{small.shape[0]}, '
        f'peak {small.max():.2f} -> {check.max():.2f}, mean {small.mean():.4f} -> {check.mean():.4f}'
    )


if __name__ == '__main__':
    main()
