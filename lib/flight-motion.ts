/** Camera and aircraft keyframes for the portfolio's nine-second scenic flight. */
export type Triple = readonly [number, number, number];
export type FlightPose = {
  camera: Triple;
  position: Triple;
  heading: number;
  bank: number;
  scale: number;
};
export const FLIGHT_DURATION = 9;
export const CRUISE_CAMERA: Triple = [0, 4.5, 16.8];
const frames: readonly (FlightPose & { at: number })[] = [
  {
    at: 0,
    camera: CRUISE_CAMERA,
    position: [0, 0, 0],
    heading: 2.12,
    bank: -0.055,
    scale: 1,
  },
  {
    at: 0.23,
    camera: [9, 5.7, 14.5],
    position: [-1, 0.65, 0],
    heading: 2.55,
    bank: -0.31,
    scale: 1.08,
  },
  {
    at: 0.52,
    camera: [-10, 3.6, 13.5],
    position: [0.85, 1.25, -0.7],
    heading: 1.72,
    bank: 0.27,
    scale: 1.12,
  },
  {
    at: 0.76,
    camera: [-4.5, 12, 13],
    position: [0.35, 0.6, -0.3],
    heading: 1.95,
    bank: 0.13,
    scale: 1.04,
  },
  {
    at: 1,
    camera: CRUISE_CAMERA,
    position: [0, 0, 0],
    heading: 2.12,
    bank: -0.055,
    scale: 1,
  },
];
export const smoothFlightEase = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function sampleFlight(progress: number): FlightPose {
  const t = Math.max(0, Math.min(1, progress));
  const end = frames.findIndex((frame) => frame.at >= t);
  const right = frames[Math.max(1, end)];
  const left = frames[Math.max(0, end - 1)];
  const mix = smoothFlightEase((t - left.at) / (right.at - left.at));
  const lerp = (a: number, b: number) => a + (b - a) * mix;
  const vector = (a: Triple, b: Triple): Triple => [
    lerp(a[0], b[0]),
    lerp(a[1], b[1]),
    lerp(a[2], b[2]),
  ];
  return {
    camera: vector(left.camera, right.camera),
    position: vector(left.position, right.position),
    heading: lerp(left.heading, right.heading),
    bank: lerp(left.bank, right.bank),
    scale: lerp(left.scale, right.scale),
  };
}
