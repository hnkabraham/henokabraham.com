import type { BayPhase } from './bay-flight';

export type TourPoint = [number, number, number];
// Keep the original phase IDs so existing shared links still open a chapter.
export const TOUR_CHAPTERS: { at: number; label: string; phase: BayPhase }[] = [
  { at: 0, label: 'Open sky', phase: 'preflight' },
  { at: 0.37, label: 'Apps', phase: 'roll' },
  { at: 0.59, label: 'Devices', phase: 'liftoff' },
  { at: 0.78, label: 'Flight log', phase: 'bay' },
  { at: 0.97, label: 'Explore', phase: 'cruise' },
];
export function tourPhase(p: number): BayPhase {
  return p < 0.18
    ? 'preflight'
    : p < 0.49
      ? 'roll'
      : p < 0.7
        ? 'liftoff'
        : p < 0.88
          ? 'bay'
          : 'cruise';
}
const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const point = (a: TourPoint, b: TourPoint, t: number) =>
  a.map((v, i) => mix(v, b[i], t)) as TourPoint;
type Shot = { at: number; camera: TourPoint; target: TourPoint; fov: number };
// Exterior coordinates in metres: nose -X, port +Z, up +Y. Each lens stays
// outside the airframe; the pauses are deliberate opportunities to inspect it.
export const TOUR_SHOTS: Shot[] = [
  { at: 0, camera: [-78, 20, 105], target: [0, 1, 0], fov: 34 },
  { at: 0.2, camera: [-68, 15, 86], target: [0, 1, 0], fov: 34 },
  { at: 0.27, camera: [-46, 9, 45], target: [-5, 0, 5], fov: 34 },
  { at: 0.34, camera: [-19, -0.3, 18], target: [-6.6, -0.7, 9.4], fov: 34 },
  { at: 0.4, camera: [-17, 0.2, 17.7], target: [-6.6, -0.7, 9.4], fov: 34 },
  { at: 0.46, camera: [-12, 2, 23], target: [-5, -0.3, 9.4], fov: 34 },
  { at: 0.54, camera: [-5, 16, 36], target: [1, 2.2, 13], fov: 38 },
  { at: 0.63, camera: [13, 18, 48], target: [7, 3, 18], fov: 38 },
  { at: 0.69, camera: [25, 12, 32], target: [18, 4, 8], fov: 36 },
  { at: 0.75, camera: [41, 10, 22], target: [27, 7.8, 0], fov: 34 },
  { at: 0.82, camera: [46, 10, 13], target: [28, 6.5, 0], fov: 34 },
  { at: 0.91, camera: [77, 29, 78], target: [3, 3, 0], fov: 34 },
  { at: 1, camera: [95, 40, 100], target: [3, 3, 0], fov: 34 },
];

export function sampleDreamlinerTour(progress: number, aspect: number) {
  const p = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < TOUR_SHOTS.length - 2 && TOUR_SHOTS[index + 1].at < p) index++;
  const a = TOUR_SHOTS[index],
    b = TOUR_SHOTS[index + 1];
  const t = ease((p - a.at) / (b.at - a.at));
  const target = point(a.target, b.target, t);
  let camera = point(a.camera, b.camera, t);
  const portrait = Math.max(0, Math.min(1, (1.15 - aspect) / 0.65));
  const wideShot = 1 - ease((p - 0.24) / 0.08) + ease((p - 0.84) / 0.13);
  // On a phone, pull back the establishing shot more than the close-ups.
  const engineFocus = ease((p - 0.29) / 0.05) * (1 - ease((p - 0.44) / 0.06));
  const distance = 1 + portrait * (0.3 + wideShot * 0.9);
  camera = camera.map(
    (v, i) => target[i] + (v - target[i]) * distance,
  ) as TourPoint;
  // A narrow frame follows the inlet itself, keeping its lip above the controls.
  target[0] -= 1.8 * portrait * engineFocus;
  target[1] -= 0.4 * portrait * engineFocus;
  const arrival = ease((p - 0.025) / 0.17);
  const aircraft: TourPoint = [
    mix(155, 0, arrival),
    mix(14, 0, arrival),
    mix(-65, 0, arrival),
  ];
  return {
    camera,
    target,
    aircraft,
    fov: mix(a.fov, b.fov, t),
    offsetX: mix(-0.18, 0, portrait),
    offsetY: mix(-0.035, -0.12 + 0.1 * engineFocus, portrait),
    bank: mix(-0.08, 0.025, arrival) + Math.sin(p * Math.PI * 2) * 0.025,
    visible: p > 0.025,
    phase: tourPhase(p),
  };
}

/** Geometry-only rendering leaves room for sharper edges without terrain atlases. */
export function tourPixelRatio(
  width: number,
  height: number,
  dpr: number,
  quality: 0 | 1 | 2,
) {
  const portrait = width < 800;
  const caps = portrait ? [1.15, 1.8, 2.2] : [1, 1.5, 2];
  const budgets = portrait
    ? [650_000, 1_250_000, 1_800_000]
    : [1_300_000, 2_800_000, 4_000_000];
  return Math.min(
    dpr,
    caps[quality],
    Math.sqrt(budgets[quality] / Math.max(1, width * height)),
  );
}
