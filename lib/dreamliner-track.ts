/**
 * Where the 787's wake lies: the track the aircraft has flown, as seen from
 * the tour's lens. The tour is a function of scroll, not of time, and its
 * lens hangs in the air while the aircraft flies away from it, so the air is
 * the scene's own frame. A trail laid into that air stays where it was laid:
 * through the climb and the turn it curves away behind the aircraft along
 * the path actually flown, rather than swinging with every bank like a rod
 * bolted to the tailpipe. Scrolling back rewinds the flight, and the trail
 * with it.
 *
 * Positions are in scene metres; the model's own axes are nose −X, port +Z,
 * up +Y, and a pose turns them heading (Y), then bank (X), then pitch (Z),
 * the order the scene gives the aircraft group.
 */
export type TrackPose = {
  position: readonly number[];
  heading: number;
  bank: number;
  pitch: number;
  flex: number;
};

/**
 * A point on the airframe where a wake begins, in model metres, and how far
 * the wing's flex lifts it per metre of tip lift (the flex is linear).
 */
export type TrackSource = readonly [
  x: number,
  y: number,
  z: number,
  lift: number,
];

/**
 * How fast the air streams aft past the aircraft while the scroll rests, in
 * metres a second. The resting lens keeps pace with the aircraft, so the
 * wake drifts back past both; the true airspeed would be a blur.
 */
export const AIR_FLOW = 16;

/** Track samples per unit of tour progress. */
const RESOLUTION = 1000;

/**
 * Bakes the flight once, then lays wakes behind the aircraft at any point in
 * the tour. Each wake is `count` points `step` metres apart along the track,
 * from the source's live position (the render loop's sway included, so the
 * trail never detaches from the airframe) back the way the aircraft came;
 * each point is x, y, z and the wing's flex where it was laid. Before the
 * tour begins the aircraft is already flying, so a wake longer than the
 * flight so far runs on straight along the way it arrived.
 */
export function createFlightTrack(pose: (progress: number) => TrackPose) {
  const poses = Array.from({ length: RESOLUTION + 1 }, (_, i) =>
    pose(i / RESOLUTION),
  );
  // Distance flown, by the aircraft's own reference point, at each sample.
  const flown = new Float64Array(RESOLUTION + 1);
  for (let i = 1; i <= RESOLUTION; i++) {
    const [x0, y0, z0] = poses[i - 1].position,
      [x1, y1, z1] = poses[i].position;
    flown[i] = flown[i - 1] + Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  }
  // Until the flown distance first grows the aircraft waits off screen,
  // behind the lens. Before that it was cruising, so the track runs straight
  // back along its tail (+X), not along the arrival's settling descent.
  let first = 0;
  while (first < RESOLUTION && flown[first + 1] === 0) first++;
  const start = poses[first];
  const behind = [
    Math.cos(start.heading) * Math.cos(start.pitch),
    Math.sin(start.pitch),
    -Math.sin(start.heading) * Math.cos(start.pitch),
  ];
  const past = {
    position: [0, 0, 0],
    heading: 0,
    bank: 0,
    pitch: 0,
    flex: 0,
  };
  /** The pose where the flown distance was `d`, into `past`. */
  const at = (d: number) => {
    if (d <= 0) {
      for (let k = 0; k < 3; k++)
        past.position[k] = start.position[k] - behind[k] * d;
      past.heading = start.heading;
      past.bank = start.bank;
      past.pitch = start.pitch;
      past.flex = start.flex;
      return past;
    }
    let lo = first,
      hi = RESOLUTION;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (flown[mid] < d) lo = mid;
      else hi = mid;
    }
    const span = flown[hi] - flown[lo];
    const f = span > 0 ? Math.min(1, (d - flown[lo]) / span) : 0;
    const a = poses[lo],
      b = poses[hi];
    for (let k = 0; k < 3; k++)
      past.position[k] = a.position[k] + (b.position[k] - a.position[k]) * f;
    past.heading = a.heading + (b.heading - a.heading) * f;
    past.bank = a.bank + (b.bank - a.bank) * f;
    past.pitch = a.pitch + (b.pitch - a.pitch) * f;
    past.flex = a.flex + (b.flex - a.flex) * f;
    return past;
  };
  /** The distance flown by tour progress `p`. */
  const distance = (p: number) => {
    const x = Math.max(0, Math.min(1, p)) * RESOLUTION;
    const i = Math.min(RESOLUTION - 1, Math.floor(x));
    return flown[i] + (flown[i + 1] - flown[i]) * (x - i);
  };
  return {
    distance,
    /**
     * Lay each source's wake into `out`, `count` × 4 floats per source in
     * order: `live` holds each source's current scene position (x, y, z per
     * source) and `flex` is the wing's live flex. Returns the distance flown.
     */
    lay(
      progress: number,
      sources: readonly TrackSource[],
      live: ArrayLike<number>,
      flex: number,
      count: number,
      step: number,
      out: Float32Array,
    ) {
      const now = distance(progress);
      for (let j = 0; j < sources.length; j++) {
        const o = j * count * 4;
        out[o] = live[j * 3];
        out[o + 1] = live[j * 3 + 1];
        out[o + 2] = live[j * 3 + 2];
        out[o + 3] = flex;
      }
      for (let k = 1; k < count; k++) {
        const pose = at(now - k * step);
        // Model to scene, as three's 'YXZ' Euler builds the rotation.
        const a = Math.cos(pose.bank),
          b = Math.sin(pose.bank),
          c = Math.cos(pose.heading),
          d = Math.sin(pose.heading),
          e = Math.cos(pose.pitch),
          f = Math.sin(pose.pitch);
        const ce = c * e,
          cf = c * f,
          de = d * e,
          df = d * f;
        const [px, py, pz] = pose.position;
        for (let j = 0; j < sources.length; j++) {
          const [x, y0, z, lift] = sources[j];
          const y = y0 + lift * pose.flex;
          const o = (j * count + k) * 4;
          out[o] = px + (ce + df * b) * x + (de * b - cf) * y + a * d * z;
          out[o + 1] = py + a * f * x + a * e * y - b * z;
          out[o + 2] = pz + (cf * b - de) * x + (df + ce * b) * y + a * c * z;
          out[o + 3] = pose.flex;
        }
      }
      return now;
    },
  };
}
