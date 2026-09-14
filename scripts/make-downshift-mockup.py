#!/usr/bin/env python3
"""Composites the Downshift/RevMatch screenshots into a free MockupNest
iPhone 18 Pro PSD (Burgundy colourway), one screen per phone in its
three-phone fan. The PSD's "Change Design" smart objects are placed as
plain axis-aligned rectangles internally; the fan comes from a 2D rotation
baked into each layer's mask, so each screenshot is scaled, rotated by the
angle recovered from that mask (via OpenCV's minAreaRect) and stencilled
through the mask's own alpha (which already handles the rounded corners,
the Dynamic Island notch and inter-phone occlusion) rather than attempting
to reproduce Photoshop's placement transform directly.

The PSD itself is a free-tier, personal-use-only download (mockupnest.com)
and is not committed to this repository; supply your own copy to reproduce.
The composited output is local-only for the same reason (see ASSETS.md).
The three source screenshots are my own (from RevMatchApp), staged at
archive/downshift-screens/ — also local-only, since they only exist to feed
this script (see .gitignore).

Usage:
  python3 scripts/make-downshift-mockup.py <path-to-psd> [--hue-shift DEG] [--out NAME]
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage

REPO = Path(__file__).resolve().parent.parent
SCREENS_DIR = REPO / "archive" / "downshift-screens"
SCREENS = [
    SCREENS_DIR / "downshift-dashboard.png",
    SCREENS_DIR / "downshift-performance.png",
    SCREENS_DIR / "downshift-settings.png",
]
# The settings screenshot's tab bar has a capture glitch (a garbled
# translucent frame bleeding through); flatten it to the app's own
# background colour rather than ship the artifact.
SETTINGS_GLITCH_Y = 1595
APP_BACKGROUND = (10, 10, 20)


def soft_light(base_rgb, blend_rgb, opacity):
    base = base_rgb.astype(np.float64) / 255.0
    blend = blend_rgb.astype(np.float64) / 255.0
    d = np.where(base <= 0.25, ((16 * base - 12) * base + 4) * base, np.sqrt(base))
    result = np.where(
        blend <= 0.5,
        base - (1 - 2 * blend) * base * (1 - base),
        base + (2 * blend - 1) * (d - base),
    )
    out = base * (1 - opacity) + result * opacity
    return np.clip(out * 255, 0, 255).astype(np.uint8)


def mask_geometry(alpha):
    mask = (alpha > 128).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(contours, key=cv2.contourArea)
    (cx, cy), (w, h), angle = cv2.minAreaRect(c)
    if w > h:
        w, h = h, w
        angle += 90
    return cx, cy, w, h, angle


def load_screen(path):
    img = Image.open(path).convert("RGBA")
    if path.name == "downshift-settings.png":
        arr = np.array(img)
        arr[SETTINGS_GLITCH_Y:, :, :3] = APP_BACKGROUND
        arr[SETTINGS_GLITCH_Y:, :, 3] = 255
        img = Image.fromarray(arr, "RGBA")
    return img


def place_screen(comp, screen_path):
    arr = np.array(comp)
    alpha = arr[..., 3]
    cx, cy, w, h, angle = mask_geometry(alpha)
    shot = load_screen(screen_path)
    sw, sh = shot.size
    scale = max(w / sw, h / sh) * 1.02
    resized = shot.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    # PIL's rotate() turns counter-clockwise for a positive angle; the mask's
    # angle (from cv2.minAreaRect, y-down image coordinates) is measured the
    # other way around, so matching the frame's true tilt needs the negation.
    rotated = resized.rotate(-angle, expand=True, resample=Image.BICUBIC)
    rw, rh = rotated.size
    out = Image.new("RGBA", comp.size, (0, 0, 0, 0))
    out.alpha_composite(rotated, (round(cx - rw / 2), round(cy - rh / 2)))
    out_arr = np.array(out)
    out_arr[..., 3] = alpha
    return Image.fromarray(out_arr, "RGBA")


def hue_shift(rgb_img, degrees):
    if not degrees:
        return rgb_img
    arr = np.array(rgb_img.convert("RGB")).astype(np.float64) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    maxc = np.max(arr, axis=-1)
    minc = np.min(arr, axis=-1)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc == 0, 0, delta / np.where(maxc == 0, 1, maxc))
    rc = np.where(delta == 0, 0, (maxc - r) / np.where(delta == 0, 1, delta))
    gc = np.where(delta == 0, 0, (maxc - g) / np.where(delta == 0, 1, delta))
    bc = np.where(delta == 0, 0, (maxc - b) / np.where(delta == 0, 1, delta))
    h = np.select(
        [maxc == r, maxc == g, maxc == b],
        [(bc - gc), 2.0 + (rc - bc), 4.0 + (gc - rc)],
        default=0.0,
    )
    h = (h / 6.0) % 1.0
    h = (h + degrees / 360.0) % 1.0
    hsv_img = Image.fromarray((np.stack([h, s, v], axis=-1) * 255).astype(np.uint8), "HSV")
    return hsv_img.convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("psd", type=Path)
    parser.add_argument("--hue-shift", type=float, default=0.0, help="degrees added to the phone body's hue (~41 turns this PSD's Burgundy into orange)")
    parser.add_argument("--out", default="downshift-mockup", help="output filename stem, written under public/images/")
    parser.add_argument("--video-slot", type=int, default=None, help="leave this screen index (0-based) transparent in the background image, and export its flat mask + placement geometry for a <video> overlay instead of a static screenshot")
    args = parser.parse_args()

    psd = PSDImage.open(args.psd)
    layers = [l for l in psd if type(l).__name__ == "SmartObjectLayer"]
    if len(layers) != len(SCREENS):
        sys.exit(f"expected {len(SCREENS)} smart object layers, found {len(layers)}")
    mockup = next(l for l in psd if l.name == "Mockup")
    noise_group = next(l for l in psd if l.name == "Noice Texture")
    noise_layer = next(iter(noise_group))

    canvas = Image.new("RGBA", psd.size, (0, 0, 0, 0))
    body = mockup.composite().convert("RGBA")
    if args.hue_shift:
        body_rgb = hue_shift(body, args.hue_shift)
        body = Image.merge("RGBA", (*body_rgb.split(), body.split()[3]))
    left, top, *_ = mockup.bbox
    canvas.alpha_composite(body, (left, top))

    video_slot_geometry = None
    for index, (layer, screen_path) in enumerate(zip(layers, SCREENS)):
        comp = layer.composite().convert("RGBA")
        if index == args.video_slot:
            # Skip pasting a static screen here; record where the video
            # overlay needs to sit instead (computed below, once the
            # final crop/scale is known).
            comp_alpha = np.array(comp)[..., 3]
            video_slot_geometry = (mask_geometry(comp_alpha), comp, layer.bbox)
            continue
        placed = place_screen(comp, screen_path)
        lb = layer.bbox
        canvas.alpha_composite(placed, (lb[0], lb[1]))

    noise_img = noise_layer.composite().convert("RGB")
    nb = noise_layer.bbox
    noise_full = Image.new("RGB", psd.size, (128, 128, 128))
    noise_full.paste(noise_img, (nb[0], nb[1]))
    base_arr = np.array(canvas.convert("RGB"))
    blended = soft_light(base_arr, np.array(noise_full), noise_layer.opacity / 255.0)
    alpha_chan = np.array(canvas)[..., 3]
    final_img = Image.fromarray(np.dstack([blended, alpha_chan]), "RGBA")

    arr = np.array(final_img)
    ys, xs = np.where(arr[..., 3] > 5)
    pad = 40
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + pad)
    cropped = final_img.crop((x0, y0, x1, y1))

    target_w = 1100
    scale = target_w / cropped.width
    resized = cropped.resize((target_w, round(cropped.height * scale)), Image.LANCZOS)

    out_dir = REPO / "public" / "images"
    out_dir.mkdir(parents=True, exist_ok=True)
    png_path = out_dir / f"{args.out}.png"
    resized.save(png_path, optimize=True)
    avif_path = out_dir / f"{args.out}.avif"
    try:
        resized.save(avif_path, quality=68)
    except Exception as exc:
        print(f"AVIF export unavailable ({exc}); PNG only")
        avif_path = None

    print(f"wrote {png_path} ({png_path.stat().st_size} bytes) size={resized.size}")
    if avif_path:
        print(f"wrote {avif_path} ({avif_path.stat().st_size} bytes)")

    if video_slot_geometry:
        (cx, cy, w, h, angle), comp, lb = video_slot_geometry
        # Flat (unrotated) screen shape: undo the mask's own rotation so it
        # can be used as a CSS mask on an unrotated <video>, which then gets
        # the same rotate() transform the content would have received.
        comp_alpha = Image.fromarray((np.array(comp)[..., 3] > 128).astype(np.uint8) * 255)
        flat = comp_alpha.rotate(angle, expand=True, resample=Image.BICUBIC, center=(cx, cy))
        farr = np.array(flat)
        fys, fxs = np.where(farr > 128)
        fx0, fx1 = fxs.min(), fxs.max()
        fy0, fy1 = fys.min(), fys.max()
        flat_mask = flat.crop((fx0, fy0, fx1 + 1, fy1 + 1))
        mask_path = out_dir / f"{args.out}-video-mask.png"
        flat_mask.save(mask_path, optimize=True)

        # cx, cy are in the *pre-crop* canvas; convert to the final
        # cropped+scaled image's own percentage coordinates. Use the flat
        # mask's own tight crop for width/height (not the minAreaRect w/h
        # used above), so the overlay box's aspect ratio exactly matches
        # the mask image it's paired with.
        final_cx = (lb[0] + cx - x0) * scale
        final_cy = (lb[1] + cy - y0) * scale
        final_w = flat_mask.width * scale
        final_h = flat_mask.height * scale
        canvas_w, canvas_h = resized.size
        geometry = {
            "leftPct": (final_cx - final_w / 2) / canvas_w * 100,
            "topPct": (final_cy - final_h / 2) / canvas_h * 100,
            "widthPct": final_w / canvas_w * 100,
            "heightPct": final_h / canvas_h * 100,
            # PIL rotate() turns counter-clockwise for +θ; CSS rotate()
            # turns clockwise for +θ. place_screen() uses PIL rotate(-angle)
            # to match the frame, so the equivalent CSS transform is the
            # unnegated angle (verify visually; this sign is easy to flip).
            "angleDeg": angle,
            "maskAspect": flat_mask.width / flat_mask.height,
        }
        print(f"wrote {mask_path} size={flat_mask.size}")
        print("video overlay geometry:", geometry)


if __name__ == "__main__":
    main()
