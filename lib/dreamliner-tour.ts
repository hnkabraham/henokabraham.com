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
// Exterior coordinates in metres: nose -X, port +Z, up +Y. The lens stays
// outside the airframe throughout.
export const TOUR_SHOTS: Shot[] = [
  // The lens waits low and outboard of where the port engine will settle,
  // looking up the flight path. The aircraft overtakes from behind the
  // viewer, its flank and wing sweeping past, and pulls ahead into a view
  // straight up the tailpipe of that engine; the lens creeps in behind the
  // exhaust through the hold.
  { at: 0, camera: [21, -3.5, 16.5], target: [-3, -1.3, 9.4], fov: 34 },
  { at: 0.24, camera: [17, -2.9, 14.2], target: [-3, -1.3, 9.4], fov: 34 },
  // Then the aircraft flies on and the lens stays behind, rising out of its
  // wake to look down on the flexed wings from above and behind, and
  // tightening a little as it climbs away. The aim follows the aircraft
  // itself (the departure below); these targets only anchor the portrait
  // pull-back.
  { at: 0.45, camera: [24, 9, 22], target: [-3, -1.3, 9.4], fov: 32 },
  { at: 0.62, camera: [28, 12, 24], target: [-3, -1.3, 9.4], fov: 30 },
  { at: 1, camera: [36, 18, 30], target: [-3, -1.3, 9.4], fov: 24 },
];

// The departure: after the hold the aircraft flies on, RANGE metres in all
// over the rest of the scroll, along a power curve so it leaves from a
// standstill without a jerk, climbing gently and rolling into a shallow
// left turn part-way out that shows the flexed wings from above and behind.
const RANGE = 900;
const TURN = 0.5;
const heading = (departure: number) => TURN * ease((departure - 0.26) / 0.5);

export function sampleDreamlinerTour(progress: number, aspect: number) {
  const p = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < TOUR_SHOTS.length - 2 && TOUR_SHOTS[index + 1].at < p) index++;
  const a = TOUR_SHOTS[index],
    b = TOUR_SHOTS[index + 1];
  const t = ease((p - a.at) / (b.at - a.at));
  let target = point(a.target, b.target, t);
  let camera = point(a.camera, b.camera, t);
  const portrait = Math.max(0, Math.min(1, (1.15 - aspect) / 0.65));
  // On a phone, sit a little further back from the engine.
  const distance = 1 + portrait * 0.3;
  camera = camera.map(
    (v, i) => target[i] + (v - target[i]) * distance,
  ) as TourPoint;
  // The aircraft starts just behind the viewer, nose level with the lens and
  // a little above it, and flies straight past on its own axis: the nacelle
  // passes some five metres to the right, the wing a few metres overhead.
  // It is already at speed when its nose crosses into frame (an ease-out,
  // not the symmetric ease of the lens moves), and decelerates into place
  // as if the viewer had matched its pace.
  const arrival = 1 - (1 - Math.max(0, Math.min(1, (p - 0.025) / 0.17))) ** 3;
  const aircraft: TourPoint = [mix(42, 0, arrival), mix(2.4, 0, arrival), 0];
  // The departure path, integrated along the heading so the turn is flown
  // rather than slid: distance = RANGE * departure^1.5.
  const departure = Math.max(0, Math.min(1, (p - 0.22) / 0.78));
  const steps = 40,
    ds = departure / steps;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * ds;
    const travel = RANGE * 1.5 * Math.sqrt(s) * ds;
    const h = heading(s);
    aircraft[0] -= travel * Math.cos(h);
    aircraft[2] += travel * Math.sin(h);
  }
  aircraft[1] += 30 * departure * departure;
  // After the hold the aim rides with the aircraft, sliding from the port
  // exhaust to the fuselage (a touch to starboard of it, so the whole span
  // sits left of the frame's edge) as the aircraft comes into frame.
  const aim = ease((p - 0.24) / 0.14);
  if (p > 0.24)
    target = aircraft.map(
      (v, i) => v + mix([-3, -1.3, 9.4][i], [0, 1.5, -4][i], aim),
    ) as TourPoint;
  // The bank leads the turn in and trails it out, as a coordinated turn does.
  const bank =
    mix(-0.08, 0.025, arrival) +
    Math.sin(p * Math.PI * 2) * 0.025 +
    0.3 * ease((departure - 0.18) / 0.16) * (1 - ease((departure - 0.7) / 0.2));
  return {
    camera,
    target,
    aircraft,
    heading: heading(departure),
    // Tip lift in metres: a cruise wing is always flexed, and it loads up
    // further as the aircraft climbs away.
    flex: 0.8 + 1.3 * ease((p - 0.22) / 0.4),
    fov: mix(a.fov, b.fov, t),
    offsetX: mix(-0.18, 0, portrait),
    offsetY: mix(-0.035, -0.12, portrait),
    bank,
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
