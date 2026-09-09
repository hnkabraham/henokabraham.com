export type BayPhase = 'preflight' | 'roll' | 'liftoff' | 'bay' | 'cruise';
export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
export const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
export const BAY_CHAPTERS = [
  { at: 0, label: 'Preflight', phase: 'preflight' },
  { at: 0.25, label: 'Takeoff', phase: 'roll' },
  { at: 0.46, label: 'Liftoff', phase: 'liftoff' },
  { at: 0.72, label: 'The Bay', phase: 'bay' },
  { at: 0.97, label: 'Clear skies', phase: 'cruise' },
] as const;

// Local meters: source image right = +X, south = +Z, up = +Y.
// Origin is the approximately registered 28R threshold in ESA's image.
export const BAY_ORIGIN = [5666.01015, 8672.84973] as const;
export const RUNWAY_HEADING = Math.atan2(320.4, 166.45);
const keys = [
  { at: 0, position: [0, 0, 0], velocity: [0, 0, 0], camera: [-95, -3, 110] },
  {
    at: 0.15,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    camera: [-75, -4, 115],
  },
  {
    at: 0.37,
    position: [-2440, 0, -1268],
    velocity: [-14500, 0, -7535],
    camera: [-30, 1, 135],
  },
  {
    at: 0.49,
    position: [-3860, 190, -2200],
    velocity: [-6500, 3500, -16000],
    camera: [90, 45, 130],
  },
  {
    at: 0.68,
    position: [-4650, 1300, -9500],
    velocity: [-2000, 8200, -49000],
    camera: [130, 95, 105],
  },
  {
    at: 0.84,
    position: [-4800, 2700, -19000],
    velocity: [-6000, 9000, -48000],
    camera: [110, 100, 130],
  },
  {
    at: 1,
    position: [-7200, 4100, -24000],
    velocity: [-15000, 6000, -26000],
    camera: [-120, 90, 130],
  },
] as const;

export function sampleBayFlight(progress: number) {
  const p = clamp01(progress);
  const i = Math.max(
    1,
    keys.findIndex((key) => key.at >= p),
  );
  const a = keys[i - 1],
    b = keys[i];
  const duration = b.at - a.at;
  const t = clamp01((p - a.at) / duration),
    t2 = t * t,
    t3 = t2 * t;
  const position = [0, 1, 2].map(
    (j) =>
      (2 * t3 - 3 * t2 + 1) * a.position[j] +
      (t3 - 2 * t2 + t) * duration * a.velocity[j] +
      (-2 * t3 + 3 * t2) * b.position[j] +
      (t3 - t2) * duration * b.velocity[j],
  ) as [number, number, number];
  const velocity = [0, 1, 2].map(
    (j) =>
      ((6 * t2 - 6 * t) * a.position[j]) / duration +
      (3 * t2 - 4 * t + 1) * a.velocity[j] +
      ((-6 * t2 + 6 * t) * b.position[j]) / duration +
      (3 * t2 - 2 * t) * b.velocity[j],
  );
  const heading =
    p <= 0.15 ? RUNWAY_HEADING : Math.atan2(-velocity[0], -velocity[2]);
  const camera = a.camera.map((v, j) => v + (b.camera[j] - v) * smooth(t)) as [
    number,
    number,
    number,
  ];
  const climb = smooth((p - 0.35) / 0.65);
  const gear = 1 - smooth((p - 0.47) / 0.1);
  const phase: BayPhase =
    p < 0.19
      ? 'preflight'
      : p < 0.37
        ? 'roll'
        : p < 0.58
          ? 'liftoff'
          : p < 0.87
            ? 'bay'
            : 'cruise';
  return {
    position,
    camera,
    heading,
    gear,
    climb,
    phase,
    pitch:
      Math.sin(smooth((p - 0.34) / 0.33) * Math.PI) * 0.14 +
      smooth((p - 0.45) / 0.3) * 0.025,
    bank: Math.sin(smooth((p - 0.47) / 0.4) * Math.PI) * -0.13,
  };
}

/** Shot composition shared by the renderer and the camera-bound checks. */
export function sampleBayCamera(progress: number, aspect: number) {
  const shot = sampleBayFlight(progress);
  const portrait = aspect < 1;
  const bookend =
    1 - smooth((progress - 0.16) / 0.15) + smooth((progress - 0.86) / 0.1);
  const fov = 29 + 8 * smooth((progress - 0.4) / 0.34);
  const lensDistance =
    Math.tan((39 * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
  return {
    position: shot.camera.map(
      (n) => n * (portrait ? 1.85 : 1) * lensDistance,
    ) as [number, number, number],
    offsetX: portrait ? 0 : -0.18,
    offsetY: portrait ? -0.18 * bookend : 0.08 - 0.095 * bookend,
    fov,
  };
}
