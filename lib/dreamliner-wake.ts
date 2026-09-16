import type { Object3D, PerspectiveCamera } from 'three';
import { wingLift } from './dreamliner-engine';

/**
 * The wing's wake over the story text. As the 787 overtakes, its wing sweeps
 * across (on a phone, straight behind) the headline; the renderer projects
 * the wing's planform to the screen each frame and the letters near it are
 * shoved along with the wing's motion and spring back, buffeted, once it
 * has passed. Two halves: the geometry the scene calls (`projectWing`) and
 * the DOM side (`createWingWake`) that owns the springs.
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

/** Vertices as [x, y, vx, vy]: screen px and the wing's screen velocity there. */
export type WingPolygon = number[];

/** How far from the visible wing the field reaches, in px. */
export const wakeRadius = (width: number, height: number) =>
  0.15 * Math.hypot(width, height);

// Behind this the wing is over the viewer's head; a point nearer the lens
// than the near plane would project mirrored.
const NEAR = 0.4;
// The field also reaches a little past the frame, so letters at an edge
// react to the wing arriving rather than to its sudden appearance.
const MARGIN = 0.1;
const EPSILON = 1 / 60;

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
 * left), each vertex carrying the wing's screen velocity there. `motion` is
 * the aircraft's velocity relative to the lens in world metres per second.
 * Points behind the near plane are clipped in view space first, then the
 * projection is clipped to the frame plus a margin, so the invisible wing
 * overhead never pulls the field. Empty when nothing is in frame.
 */
export function projectWing(
  camera: PerspectiveCamera,
  model: Object3D,
  flex: number,
  width: number,
  height: number,
  motion: [number, number, number],
): WingPolygon[] {
  const mw = model.matrixWorld.elements;
  const vw = camera.matrixWorldInverse.elements;
  const pm = camera.projectionMatrix.elements;
  // The relative motion, rotated into view space.
  const mv = [
    vw[0] * motion[0] + vw[4] * motion[1] + vw[8] * motion[2],
    vw[1] * motion[0] + vw[5] * motion[1] + vw[9] * motion[2],
    vw[2] * motion[0] + vw[6] * motion[1] + vw[10] * motion[2],
  ];
  const toScreen = (x: number, y: number, z: number) => {
    const cx = pm[0] * x + pm[4] * y + pm[8] * z + pm[12];
    const cy = pm[1] * x + pm[5] * y + pm[9] * z + pm[13];
    const cw = pm[3] * x + pm[7] * y + pm[11] * z + pm[15];
    return [((cx / cw + 1) / 2) * width, ((1 - cy / cw) / 2) * height];
  };
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
      const at = toScreen(x, y, z);
      const next = toScreen(
        x + mv[0] * EPSILON,
        y + mv[1] * EPSILON,
        z + mv[2] * EPSILON,
      );
      return [
        at[0],
        at[1],
        (next[0] - at[0]) / EPSILON,
        (next[1] - at[1]) / EPSILON,
      ];
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

/**
 * Signed distance from a point to a polygon's edge, negative inside, and
 * the wing's screen velocity at the nearest point of that edge.
 */
export function nearestOnWing(
  poly: WingPolygon,
  px: number,
  py: number,
  out: { distance: number; vx: number; vy: number },
) {
  const n = poly.length / 4;
  let best = Infinity,
    inside = false,
    vx = 0,
    vy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = poly[i * 4],
      ay = poly[i * 4 + 1],
      bx = poly[j * 4],
      by = poly[j * 4 + 1];
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    if (d < best) {
      best = d;
      vx = poly[i * 4 + 2] + (poly[j * 4 + 2] - poly[i * 4 + 2]) * t;
      vy = poly[i * 4 + 3] + (poly[j * 4 + 3] - poly[i * 4 + 3]) * t;
    }
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  out.distance = inside ? -best : best;
  out.vx = vx;
  out.vy = vy;
  return out;
}

export type WingWake = {
  /** Collect the `[data-wake]` spans under a story element (null clears). */
  attach: (story: HTMLElement | null) => void;
  /**
   * Advance the springs one frame; `polys` null when no aircraft is shown,
   * `strength` how much of the wake reaches the viewer (1 through the
   * pass, 0 once the aircraft has flown off, so the chapter captions read
   * still). True while any letter is still moving, so the caller keeps its
   * frame loop running until the text has settled.
   */
  update: (
    polys: WingPolygon[] | null,
    dt: number,
    strength?: number,
  ) => boolean;
  dispose: () => void;
};

type Target = {
  element: HTMLElement;
  seed: number;
  /** Letters differ a little in how hard the same gust moves them. */
  gain: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  field: number;
  lit: boolean;
  resting: boolean;
};

// A stiff, lightly damped spring: a letter shoved by the wing swings back
// through its rest a couple of times in about a second.
const STIFFNESS = 170;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.3;
// px/s of wing motion that saturates the push, and the push per unit of it
// (px/s² on a headline-sized letter with the wing's edge right over it).
const WING_SPEED = 2600;
const PUSH = 4.5;
const TURBULENCE = 1400;
const near = { distance: 0, vx: 0, vy: 0 };

export function createWingWake(): WingWake {
  let story: HTMLElement | null = null;
  let targets: Target[] = [];
  let live = false;
  let time = 0;
  const setLive = (value: boolean) => {
    if (value === live) return;
    live = value;
    story?.classList.toggle('wake-live', value);
  };
  // The halo only changes in visible steps, so a wing parked beside a letter
  // (the hold, on a wide screen) costs no style writes.
  const light = (t: Target, field: number) => {
    const lit = field > 0.04;
    if (lit && Math.abs(field - t.field) >= 0.05) {
      t.field = field;
      t.element.style.setProperty('--wake', field.toFixed(2));
    }
    if (lit !== t.lit) {
      t.lit = lit;
      t.element.classList.toggle('is-wake', lit);
      if (!lit) {
        t.field = 0;
        t.element.style.removeProperty('--wake');
      }
    }
  };
  const rest = (t: Target) => {
    t.x = t.y = t.vx = t.vy = 0;
    if (!t.resting) {
      t.resting = true;
      t.element.style.transform = '';
    }
  };
  const settle = (t: Target) => {
    rest(t);
    light(t, 0);
  };
  const attach = (next: HTMLElement | null) => {
    for (const t of targets) settle(t);
    setLive(false);
    story = next;
    targets = next
      ? [...next.querySelectorAll<HTMLElement>('[data-wake]')].map(
          (element, i) => ({
            element,
            seed: i * 1.7,
            gain: 0.75 + 0.5 * ((i * 0.61) % 1),
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            field: 0,
            lit: false,
            resting: true,
          }),
        )
      : [];
  };
  const update = (polys: WingPolygon[] | null, dt: number, strength = 1) => {
    if (!story || !targets.length) return false;
    const step = Math.min(0.05, Math.max(0.001, dt));
    time += step;
    const host = story.offsetParent as HTMLElement | null;
    const frame = (host ?? story).getBoundingClientRect();
    const radius = wakeRadius(frame.width, frame.height);
    let reach = false;
    if (polys && polys.length && strength > 0) {
      const box = story.getBoundingClientRect();
      for (const poly of polys) {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (let i = 0; i < poly.length; i += 4) {
          minX = Math.min(minX, poly[i]);
          maxX = Math.max(maxX, poly[i]);
          minY = Math.min(minY, poly[i + 1]);
          maxY = Math.max(maxY, poly[i + 1]);
        }
        if (
          maxX + radius > box.left - frame.left &&
          minX - radius < box.right - frame.left &&
          maxY + radius > box.top - frame.top &&
          minY - radius < box.bottom - frame.top
        )
          reach = true;
      }
    }
    let moving = false;
    for (const t of targets) {
      // A resting letter still needs one pass to lose its halo once the
      // wing has gone.
      if (!reach && t.resting && !t.lit) continue;
      let field = 0,
        wx = 0,
        wy = 0;
      // All reads first: the box, less the letter's own displacement, is
      // its rest position, so the entrance animation is followed as well.
      const rect = t.element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2 - frame.left - t.x;
      const cy = rect.top + rect.height / 2 - frame.top - t.y;
      const size = Math.max(0.3, Math.min(1.2, rect.height / 90));
      const limit = 0.55 * rect.height;
      // The field is strongest along the wing's edges, inside or out: a
      // letter is kicked as the leading edge reaches it and again as the
      // trailing edge leaves it, so the pass travels through the headline
      // rather than shifting it whole.
      if (reach && polys)
        for (const poly of polys) {
          nearestOnWing(poly, cx, cy, near);
          const w =
            1 - Math.max(0, Math.min(1, Math.abs(near.distance) / radius));
          const smooth = w * w * (3 - 2 * w) * strength;
          if (smooth > field) {
            field = smooth;
            wx = near.vx;
            wy = near.vy;
          }
        }
      const speed = Math.hypot(wx, wy);
      // A creeping wing still stirs the letters; a flung one saturates.
      const gust = Math.sqrt(Math.min(1, speed / WING_SPEED));
      const scale = field * size * t.gain;
      // The push follows the wing's motion and eases off as the letter nears
      // its limit; the turbulence only stirs while the wing is moving.
      const room = Math.max(0, 1 - (Math.hypot(t.x, t.y) / limit) ** 2);
      const stir = scale * Math.min(1, speed / 600) * TURBULENCE;
      const ax =
        -STIFFNESS * t.x -
        DAMPING * t.vx +
        scale * PUSH * WING_SPEED * gust * (wx / (speed || 1)) * room +
        stir * Math.sin(time * 21 + t.seed);
      const ay =
        -STIFFNESS * t.y -
        DAMPING * t.vy +
        scale * PUSH * WING_SPEED * gust * (wy / (speed || 1)) * room +
        stir * Math.cos(time * 15 + t.seed * 1.3);
      t.vx += ax * step;
      t.vy += ay * step;
      t.x += t.vx * step;
      t.y += t.vy * step;
      light(t, field);
      const still =
        speed < 30 &&
        Math.abs(t.x) < 0.05 &&
        Math.abs(t.y) < 0.05 &&
        Math.abs(t.vx) < 2 &&
        Math.abs(t.vy) < 2;
      if (still) {
        rest(t);
        continue;
      }
      t.resting = false;
      moving = true;
      const lean = Math.max(-10, Math.min(10, t.vx * 0.012));
      const tilt = Math.max(-18, Math.min(18, t.vy * 0.03));
      t.element.style.transform = `translate3d(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px, 0) rotate(${lean.toFixed(2)}deg) rotateX(${tilt.toFixed(2)}deg)`;
    }
    setLive(moving);
    return moving;
  };
  const dispose = () => attach(null);
  return { attach, update, dispose };
}
