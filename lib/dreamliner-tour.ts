import type { BayPhase } from './bay-flight';

export type TourPoint = [number, number, number];
// Keep the original phase IDs so existing shared links still open a chapter.
export const TOUR_CHAPTERS: {
  at: number;
  label: string;
  phase: BayPhase;
}[] = [
  { at: 0, label: 'Open sky', phase: 'preflight' },
  { at: 0.34, label: 'Apps', phase: 'roll' },
  { at: 0.59, label: 'Devices', phase: 'liftoff' },
  { at: 0.78, label: 'Flight log', phase: 'bay' },
  // The last stop sits where the aircraft is crossing out of the top, not
  // after it has gone: the rest of the scroll clears the sky and hands over.
  { at: 0.9, label: 'Explore', phase: 'cruise' },
];
/** How far from landscape (0) to portrait (1) a screen's shape is. */
const portraitAt = (aspect: number) =>
  Math.max(0, Math.min(1, (1.15 - aspect) / 0.65));
// The wing clears the opening sooner in portrait. Reveal Apps in that
// empty sky, before the reading glide and the wipe that follows it. Keep
// the wider framing long enough to finish erasing the opening.
const appsEntrance = (aspect: number) => 0.3 - 0.06 * portraitAt(aspect);
export function tourPhase(p: number, aspect = 16 / 9): BayPhase {
  return p < appsEntrance(aspect)
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

/**
 * The Apps chapter's pacing and its caption wipe, kept in one place so
 * variants can be tried side by side: in development `?tour=<preset>`
 * selects one before anything is baked (scroll-departure.tsx).
 */
export type TourTuning = {
  /** What erases the Downshift caption: the airframe less its wings (so
   * the phones still go with the elevator when the tail passes close), the
   * whole silhouette, wings included (for a lens that lets the aircraft
   * recede, where the port wing reaches furthest), or the elevators alone. */
  wiper: 'airframe' | 'whole' | 'elevators';
  /** The reading zone as [wide, phone layout]: the flight glides from
   * `slowStart` to `slowEnd` across the extra Apps scroll instead of
   * stopping. Equal values pin it, which is the pause this replaced. The
   * zone ends where the airframe would first touch the caption, which the
   * phone layout reaches sooner: its preview sits lower and the aircraft
   * rises into it from below. */
  slowStart: [number, number];
  slowEnd: [number, number];
  /**
   * `chase`: the lens lunges forward alongside the tail for the wipe and
   * falls back after it. `still`: the lens keeps its slow drift and the
   * aircraft's own flight carries it across the caption. The sky behind is
   * a still photograph, so every lens move reads as the aircraft moving;
   * a lunge that swings behind the tail reads as the aircraft yawing.
   */
  camera: 'chase' | 'still';
  /** Where the lens begins easing in toward the tail, [landscape, portrait]. */
  closeStart: [number, number];
  /** Where the caption wipe's silhouette bake begins. */
  wipeStart: number;
  /**
   * For the whole-silhouette wiper, where the wings join it, [wide, phone
   * layout]: not before the reading zone has ended, since the port wing
   * root passes under the phone preview while the tail is still far off.
   */
  wingsFrom: [number, number];
};
export const TOUR_PRESETS: Record<string, TourTuning> = {
  // The aircraft keeps flying, slowly, while the preview is read; then
  // the lens lunges after the tail so its outline sweeps the caption away.
  glide: {
    wiper: 'airframe',
    camera: 'chase',
    slowStart: [0.31, 0.25],
    slowEnd: [0.342, 0.3],
    closeStart: [0.33, 0.29],
    wipeStart: 0.24,
    wingsFrom: [Infinity, Infinity],
  },
  // The shipped tour: the same glide, but the lens never lunges after the
  // tail. The aircraft recedes, climbs and banks away as one flight, and
  // its whole silhouette sweeps the caption on the way past.
  still: {
    wiper: 'whole',
    camera: 'still',
    slowStart: [0.31, 0.25],
    slowEnd: [0.342, 0.3],
    closeStart: [0.33, 0.29],
    wipeStart: 0.24,
    wingsFrom: [0.345, 0.305],
  },
  // The same glide, wiped by the elevators only (text sits over the fin).
  elevators: {
    wiper: 'elevators',
    camera: 'chase',
    slowStart: [0.31, 0.25],
    slowEnd: [0.342, 0.3],
    closeStart: [0.33, 0.29],
    wipeStart: 0.24,
    wingsFrom: [Infinity, Infinity],
  },
  // The previous behaviour: a dead stop at 34%, then the elevator wipe.
  hold: {
    wiper: 'elevators',
    camera: 'chase',
    slowStart: [0.34, 0.34],
    slowEnd: [0.34, 0.34],
    closeStart: [0.34, 0.34],
    wipeStart: 0.34,
    wingsFrom: [Infinity, Infinity],
  },
};
export const tuning: TourTuning = { ...TOUR_PRESETS.still };
/** Select a preset by name; anything unknown is the default. */
export function applyTourPreset(name: string | null | undefined) {
  Object.assign(tuning, TOUR_PRESETS[name ?? ''] ?? TOUR_PRESETS.still);
}
/** A key for caches baked from the tuning, such as the caption wipes. */
export const tuningKey = () => JSON.stringify(tuning);
/**
 * The reading zone's bounds in flight position for this screen. The phone
 * layout (the stylesheet's 800 px breakpoint) has its own pair; its zone
 * never starts before the caption has entered, which is by aspect.
 */
export function appsPacing(aspect: number, phone: boolean) {
  // Landscape phones reveal Apps at the same flight position as desktop.
  // Their portrait interval ends before that entrance and would collapse.
  const side = phone && aspect < 1 ? 1 : 0;
  // In the short phone layout, finish reading just before the fin reaches
  // the last line of copy. Keep the development-only hold preset pinned.
  const slowEnd =
    tuning.slowEnd[side] -
    (phone && side === 0 && tuning.slowEnd[side] > tuning.slowStart[side]
      ? 0.006
      : 0);
  return {
    slowStart: Math.max(
      tuning.slowStart[side],
      Math.min(slowEnd, appsEntrance(aspect) + 0.012),
    ),
    slowEnd,
  };
}
/** Where a chapter button lands: Apps a quarter into its reading zone. */
export function chapterLanding(
  chapter: (typeof TOUR_CHAPTERS)[number],
  aspect: number,
  phone: boolean,
) {
  if (chapter.phase !== 'roll') return chapter.at;
  const { slowStart, slowEnd } = appsPacing(aspect, phone);
  return slowStart + (slowEnd - slowStart) * 0.25;
}
const point = (a: TourPoint, b: TourPoint, t: number) =>
  a.map((v, i) => mix(v, b[i], t)) as TourPoint;
type Shot = {
  at: number;
  camera: TourPoint;
  target: TourPoint;
  fov: number;
};
// Exterior coordinates in metres: nose -X, port +Z, up +Y. The lens stays
// outside the airframe throughout.
export const TOUR_SHOTS: Shot[] = [
  // The lens waits low and outboard of where the port engine will settle,
  // looking up the flight path. The aircraft overtakes from behind the
  // viewer, its flank and wing sweeping past, and pulls ahead into a view
  // straight up the tailpipe of that engine; the lens creeps in behind the
  // exhaust through the hold.
  { at: 0, camera: [21, -3.5, 16.5], target: [-3, 1, 9.4], fov: 34 },
  { at: 0.24, camera: [18, -2.4, 14.2], target: [-3, 1, 9.4], fov: 34 },
  // Then the aircraft flies on and the lens stays behind, rising out of its
  // wake to look down on the flexed wings from above and behind, and
  // tightening a little as it climbs away. That rise is worth spending while
  // the aircraft is still near: at 25 m a metre of lens is 2 degrees of view,
  // at 300 m it is a fifth of one, so the climb out of the wake is flown by
  // a third of the scroll and what follows is a drift. The aim follows the
  // aircraft itself (the departure below); these targets only anchor the
  // portrait pull-back.
  { at: 0.33, camera: [23, 8, 20.5], target: [-3, -0.4, 9.4], fov: 33 },
  { at: 0.45, camera: [24, 9, 22], target: [-3, -1.3, 9.4], fov: 32 },
  { at: 0.62, camera: [28, 12, 24], target: [-3, -1.3, 9.4], fov: 30 },
  { at: 1, camera: [36, 18, 30], target: [-3, -1.3, 9.4], fov: 24 },
];

// The departure: after the hold the aircraft flies on, RANGE metres in all
// over the rest of the scroll, along a power curve so it leaves from a
// standstill without a jerk, climbing gently and rolling into a shallow
// left turn part-way out that shows the flexed wings from above and behind.
// The turn is held to the end: it is the aircraft's own track, up and to the
// left of the lens, that carries it out of the top of frame rather than the
// middle of the sky (where, on a phone, the Golden Gate stands and the two
// looked set to meet).
const RANGE = 900;
const TURN = 0.5;
const heading = (departure: number) => TURN * ease((departure - 0.26) / 0.5);
// How far the aim falls behind the aircraft once it is running away, in half
// frames. The climb is the whole of it; the slip only carries the aircraft
// out of the corner the crossing already left it in, which a tall frame
// needs and a wide one barely does.
const climb = (departure: number) => {
  const u = Math.max(0, Math.min(1, (departure - 0.28) / 0.72));
  return 0.5 * u + 0.5 * u * u * u;
};
const slip = (departure: number) => {
  const u = Math.max(0, Math.min(1, (departure - 0.5) / 0.5));
  return u * u * u;
};

export function sampleDreamlinerTour(progress: number, aspect: number) {
  const p = Math.max(0, Math.min(1, progress));
  let index = 0;
  while (index < TOUR_SHOTS.length - 2 && TOUR_SHOTS[index + 1].at < p) index++;
  const a = TOUR_SHOTS[index],
    b = TOUR_SHOTS[index + 1];
  const t = ease((p - a.at) / (b.at - a.at));
  let target = point(a.target, b.target, t);
  let camera = point(a.camera, b.camera, t);
  const portrait = portraitAt(aspect);
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
  const steady = tuning.camera === 'still' ? 1 : 0;
  // The climb: a shallow drift-up, and for the lens that holds a real
  // climb-out on top of it, so the aircraft's rise on screen is mostly its
  // own and its nose-up attitude is earned. It begins only once the wing
  // pass has erased the opening, which the pass's own geometry depends on.
  const climbOut = Math.max(0, departure - 0.15) / 0.85;
  aircraft[1] += 30 * departure * departure + steady * 60 * climbOut ** 1.5;
  // After the hold the aim rides with the aircraft, sliding from the port
  // exhaust to the fuselage (a touch to starboard of it, so the whole span
  // sits left of the frame's edge) as the aircraft comes into frame.
  const aim = ease((p - 0.24) / 0.14);
  const fov = mix(a.fov, b.fov, t);
  if (p > 0.24)
    target = aircraft.map(
      (v, i) => v + mix([-3, 1, 9.4][i], [0, 1.5, -4][i], aim),
    ) as TourPoint;
  // Look a little above the passing wing before following the departure.
  // This carries its lower edge across the whole opening caption, including
  // the subtitle and scroll hint. The original departure aim resumes at .34.
  const wipeLook = ease((p - 0.2) / 0.085) * (1 - ease((p - 0.285) / 0.055));
  if (wipeLook) {
    const range = Math.hypot(...target.map((v, i) => v - camera[i]));
    target[1] += Math.tan((fov * Math.PI) / 360) * range * 0.4 * wipeLook;
  }
  // Two aim moves, both in half frames, both applied along the lens's own
  // axes so they mean the same thing on every screen.
  //
  // The crossing: as the aircraft turns away the lens stops correcting for
  // the turn, so the aircraft rides up and across to the left of frame and
  // its horizontal stabilizer sweeps through the chapter caption. None of
  // that is given back. Where the aircraft ends up at the cut is where it
  // goes on from, and from there it only climbs: coming back down read as a
  // dip, and coming back across read as the aircraft changing its mind.
  const swing = ease((departure - 0.05) / 0.18);
  // So the run-out is the climb, with only enough drift left in it to carry
  // the aircraft out of the corner it is already in. A narrow frame needs the
  // larger share of that, since the aircraft spans more of it; a wide one has
  // the height to leave through the top instead.
  const departureUp =
    swing * mix(0.52, 0.9, portrait) +
    climb(departure) * mix(0.72, 0.3, portrait);
  // Keep the tail close for its second sweep, then carry that height into
  // the departure until the original climb catches up (never dip back down).
  const wide = Math.max(0, Math.min(1, (aspect - 1.85) / 0.65));
  const chase = tuning.camera === 'chase' ? 1 : 0;
  const tailRise = mix(0.97, 1.1, portrait) + 0.24 * wide;
  // The held lens pans once, slowly and in one direction, carrying the
  // aircraft up and across to where the later chapters keep it. Along with
  // its nose-up attitude and real climb this reads as climbing away, where
  // the chase's lunge behind the tail read as a yaw.
  // A short, wide screen has less height to spare above the caption, so
  // its pan completes sooner rather than reaching higher.
  const carry = steady * ease((p - 0.34) / mix(0.16, 0.12, wide));
  const up = Math.max(
    departureUp,
    chase * tailRise * ease((p - 0.37) / 0.06),
    carry * (mix(0.95, 1.08, portrait) + 0.12 * wide),
  );
  const right = -(
    swing * mix(0.86, 0.56, portrait) +
    chase *
      0.09 *
      (1 - portrait) *
      ease((p - 0.34) / 0.035) *
      (1 - ease((p - 0.85) / 0.15)) +
    carry * mix(0.14, 0.06, portrait) +
    slip(departure) * mix(0.35, 0.8, portrait)
  );
  if (right || up) {
    const fx = target[0] - camera[0],
      fy = target[1] - camera[1],
      fz = target[2] - camera[2];
    const range = Math.hypot(fx, fy, fz);
    const flat = Math.hypot(fx, fz) || 1;
    // A half frame at the target's range; the aim moves the other way, so
    // that the aircraft moves as named.
    const half = Math.tan((fov * Math.PI) / 360) * range;
    // right = normalize(forward × up) = (-fz, 0, fx) / flat
    const step = (right * half * aspect) / flat;
    target = [
      target[0] + fz * step,
      target[1] - up * half,
      target[2] - fx * step,
    ];
  }
  const yaw = heading(departure);
  // Briefly track the aft fuselage so the elevators still span the caption
  // while climbing past it. The lens starts easing in during the reading
  // zone, so the glide has a gentle push-in rather than a zoom that begins
  // the moment reading ends, and releases smoothly into the wide shot.
  const closeStart = mix(tuning.closeStart[0], tuning.closeStart[1], portrait);
  const closePass =
    1 +
    chase *
      0.85 *
      ease((p - closeStart) / (0.39 - closeStart)) *
      (1 - ease((p - 0.44) / 0.1));
  const tailAnchor: TourPoint = [
    aircraft[0] + 28 * Math.cos(yaw),
    aircraft[1] + 2.6,
    aircraft[2] - 28 * Math.sin(yaw),
  ];
  camera = camera.map(
    (v, i) => tailAnchor[i] + (v - tailAnchor[i]) / closePass,
  ) as TourPoint;
  target = target.map(
    (v, i) => tailAnchor[i] + (v - tailAnchor[i]) / closePass,
  ) as TourPoint;
  // A short, wide screen needs extra room above the climbing tail after
  // the close pass. Pull back around the aircraft without lowering it.
  const wideRelease =
    1 + 0.75 * wide * ease((p - 0.49) / 0.11) * (1 - ease((p - 0.8) / 0.1));
  const pivot: TourPoint = [aircraft[0], aircraft[1] + 1, aircraft[2]];
  camera = camera.map(
    (v, i) => pivot[i] + (v - pivot[i]) * wideRelease,
  ) as TourPoint;
  target = target.map(
    (v, i) => pivot[i] + (v - pivot[i]) * wideRelease,
  ) as TourPoint;
  const fx = target[0] - camera[0],
    fy = target[1] - camera[1],
    fz = target[2] - camera[2];
  const axis = Math.hypot(fx, fy, fz) || 1;
  // Optional depth anchor for shader-based captions. The current wing/tail
  // DOM wipes do not bind a glyph mask.
  const tailDepth =
    ((aircraft[0] + 28 * Math.cos(yaw) - camera[0]) * fx +
      (aircraft[1] + 2.6 - camera[1]) * fy +
      (aircraft[2] - 28 * Math.sin(yaw) - camera[2]) * fz) /
    axis;
  // The bank leads the turn in and trails it out, as a coordinated turn does.
  const bank =
    mix(-0.08, 0.025, arrival) +
    Math.sin(p * Math.PI * 2) * 0.025 +
    0.3 * ease((departure - 0.18) / 0.16) * (1 - ease((departure - 0.7) / 0.2));
  // Nose-up through the climb-out (a negative Z rotation raises the nose),
  // easing back toward level as the turn is held.
  const pitch =
    -steady *
    0.16 *
    ease((departure - 0.15) / 0.25) *
    (1 - 0.6 * ease((departure - 0.7) / 0.3));
  return {
    camera,
    target,
    aircraft,
    heading: yaw,
    pitch,
    // Tip lift in metres: a cruise wing is always flexed, and it loads up
    // further as the aircraft climbs away.
    flex: 0.8 + 1.3 * ease((p - 0.22) / 0.4),
    fov,
    offsetX: mix(-0.18, 0, portrait),
    offsetY: mix(-0.035, -0.12, portrait),
    bank,
    // Retain the optional shader depth for scenes that interleave glyphs
    // with the airframe; the portfolio uses lasting silhouette wipes.
    cutDepth:
      Math.max(0, tailDepth) *
      ease((p - 0.3) / 0.045) *
      (1 - ease((p - 0.43) / 0.04)),
    visible: p > 0.025,
    phase: tourPhase(p, aspect),
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
