import type { Object3D, PerspectiveCamera } from 'three';
import { wingLift } from './dreamliner-engine';

/**
 * The wing through the headline. In the opening the caption text hangs in
 * the sky at a fixed distance in front of the lens, and as the 787
 * overtakes, its wing passes through that plane (`cutDepth` in the tour
 * sampler): what lies nearer than the
 * plane covers the letters, what lies beyond goes behind them, with the
 * seam moving across the words as the wing sweeps by. The text stays real
 * DOM text under the renderer's canvas; this module rasterizes its glyphs
 * into a mask (`createTextCut`) that the aircraft's shader uses to hide its
 * own far side where a glyph covers it (`addDepthCut` in airframe-flex).
 * The wing's planform and its projection (`projectWing`) let the tour
 * check assert the wing really does cross the headline on every screen.
 */

/**
 * The port wing's planform in the model's metre axes (nose −X, port +Z,
 * up +Y), read off the shipped GLB by scanning its triangle edges: the
 * leading edge root to tip, then the trailing edge back. Starboard is the
 * mirror. The tip is raked, so the outer stations sit closer together.
 */
export const WING_OUTLINE: [number, number, number][] = [
  [-6.36, 0.31, 4],
  [-2.22, 1.11, 10],
  [0.51, 1.7, 14],
  [4.63, 2.46, 20],
  [8.76, 3.23, 26],
  [10.66, 3.62, 28],
  [12.93, 3.87, 29.5],
  [13.65, 3.85, 29.5],
  [12.29, 3.51, 28],
  [11.21, 3.13, 26],
  [8.61, 2.35, 20],
  [6.09, 1.68, 14],
  [4.84, 1.04, 10],
  [4.47, -0.14, 4],
];

/** Vertices as [x, y, depth]: screen px and the view depth there. */
export type WingPolygon = number[];

// Nearer than this the wing is over the viewer's head; a point nearer the
// lens than the near plane would project mirrored.
const NEAR = 0.4;
const MARGIN = 0.1;

const clip = (
  poly: number[][],
  keep: (v: number[]) => boolean,
  cross: (a: number[], b: number[]) => number[],
) => {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const ka = keep(a),
      kb = keep(b);
    if (ka) out.push(a);
    if (ka !== kb) out.push(cross(a, b));
  }
  return out;
};
const lerp = (a: number[], b: number[], t: number) =>
  a.map((v, i) => v + (b[i] - v) * t);

/**
 * The wings' visible outlines in screen px (origin at the canvas's top
 * left). Points behind the near plane are clipped in view space first, then
 * the projection is clipped to the frame plus a margin. Empty when nothing
 * is in frame.
 */
export function projectWing(
  camera: PerspectiveCamera,
  model: Object3D,
  flex: number,
  width: number,
  height: number,
): WingPolygon[] {
  const mw = model.matrixWorld.elements;
  const vw = camera.matrixWorldInverse.elements;
  const pm = camera.projectionMatrix.elements;
  const x0 = -width * MARGIN,
    x1 = width * (1 + MARGIN),
    y0 = -height * MARGIN,
    y1 = height * (1 + MARGIN);
  const result: WingPolygon[] = [];
  for (const side of [1, -1]) {
    let view: number[][] = WING_OUTLINE.map(([x, y, z]) => {
      const my = y + wingLift(x, z, flex);
      const mz = z * side;
      const wx = mw[0] * x + mw[4] * my + mw[8] * mz + mw[12];
      const wy = mw[1] * x + mw[5] * my + mw[9] * mz + mw[13];
      const wz = mw[2] * x + mw[6] * my + mw[10] * mz + mw[14];
      return [
        vw[0] * wx + vw[4] * wy + vw[8] * wz + vw[12],
        vw[1] * wx + vw[5] * wy + vw[9] * wz + vw[13],
        vw[2] * wx + vw[6] * wy + vw[10] * wz + vw[14],
      ];
    });
    view = clip(
      view,
      (v) => v[2] <= -NEAR,
      (a, b) => lerp(a, b, (-NEAR - a[2]) / (b[2] - a[2])),
    );
    if (view.length < 3) continue;
    let poly = view.map(([x, y, z]) => {
      const cx = pm[0] * x + pm[4] * y + pm[8] * z + pm[12];
      const cy = pm[1] * x + pm[5] * y + pm[9] * z + pm[13];
      const cw = pm[3] * x + pm[7] * y + pm[11] * z + pm[15];
      return [((cx / cw + 1) / 2) * width, ((1 - cy / cw) / 2) * height, -z];
    });
    for (const [keep, cross] of [
      [
        (q: number[]) => q[0] >= x0,
        (a: number[], b: number[]) => lerp(a, b, (x0 - a[0]) / (b[0] - a[0])),
      ],
      [
        (q: number[]) => q[0] <= x1,
        (a: number[], b: number[]) => lerp(a, b, (x1 - a[0]) / (b[0] - a[0])),
      ],
      [
        (q: number[]) => q[1] >= y0,
        (a: number[], b: number[]) => lerp(a, b, (y0 - a[1]) / (b[1] - a[1])),
      ],
      [
        (q: number[]) => q[1] <= y1,
        (a: number[], b: number[]) => lerp(a, b, (y1 - a[1]) / (b[1] - a[1])),
      ],
    ] as const) {
      poly = clip(poly, keep, cross);
      if (poly.length < 3) break;
    }
    if (poly.length >= 3) result.push(poly.flat());
  }
  return result;
}

/** Whether a screen point lies inside a projected wing polygon. */
export function insideWing(poly: WingPolygon, px: number, py: number) {
  const n = poly.length / 3;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[i * 3],
      ay = poly[i * 3 + 1],
      bx = poly[j * 3],
      by = poly[j * 3 + 1];
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

/** The mask's placement: the caption's box in CSS px from the canvas's top left. */
export type CutBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  redrawn: boolean;
};

export type TextCut = {
  /** The glyph mask, white on transparent; null where canvas 2D is missing. */
  canvas: HTMLCanvasElement | null;
  /** Follow the `[data-cut]` spans under a story element (null: none). */
  attach: (story: HTMLElement | null) => void;
  /**
   * Re-measure the caption and redraw the mask if its layout changed.
   * Returns where the mask sits, or null when there is nothing to cut.
   */
  refresh: (width: number, height: number) => CutBox | null;
  dispose: () => void;
};

// Around the caption's box, so glyph halos and rounding stay inside.
const PAD = 8;

/**
 * Draws every letter of the caption, in its own font and at its measured
 * position, into a canvas the renderer samples as a texture. The text node's
 * box gives the content area, whose top is the font's ascent above the
 * baseline, the same metric canvas reports, so the glyphs land where the
 * page draws them.
 */
export function createTextCut(): TextCut {
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
  } catch {
    canvas = null;
  }
  const context = canvas?.getContext('2d') ?? null;
  let story: HTMLElement | null = null;
  let key = '';
  let settledAt = 0;
  const attach = (next: HTMLElement | null) => {
    story = next;
    key = '';
    // The caption's entrance slides it up over 0.65 s; measure again after.
    settledAt = next ? performance.now() + 750 : 0;
  };
  const refresh = (width: number, height: number): CutBox | null => {
    if (!story || !canvas || !context) return null;
    const host = (story.offsetParent as HTMLElement | null) ?? story;
    const frame = host.getBoundingClientRect();
    const box = story.getBoundingClientRect();
    const ratio = Math.min(2, devicePixelRatio || 1);
    const left = Math.floor(box.left - frame.left) - PAD;
    const top = Math.floor(box.top - frame.top) - PAD;
    const w = Math.ceil(box.width) + PAD * 2;
    const h = Math.ceil(box.height) + PAD * 2;
    if (w <= PAD * 2 || h <= PAD * 2) return null;
    const settled = settledAt && performance.now() > settledAt;
    const next = `${width}x${height}@${ratio}:${left},${top},${w},${h}:${settled ? 1 : 0}`;
    const redrawn = next !== key;
    if (redrawn) {
      key = next;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, w, h);
      context.fillStyle = '#fff';
      context.textBaseline = 'alphabetic';
      const range = document.createRange();
      for (const span of story.querySelectorAll<HTMLElement>('[data-cut]')) {
        const text = span.textContent;
        if (!text || !text.trim()) continue;
        const style = getComputedStyle(span);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        range.selectNodeContents(span);
        const glyph = range.getBoundingClientRect();
        const ascent = context.measureText(text).fontBoundingBoxAscent;
        context.fillText(
          text,
          glyph.left - frame.left - left,
          glyph.top - frame.top - top + ascent,
        );
      }
    }
    return { left, top, width: w, height: h, redrawn };
  };
  const dispose = () => {
    story = null;
    key = '';
  };
  return { canvas, attach, refresh, dispose };
}
