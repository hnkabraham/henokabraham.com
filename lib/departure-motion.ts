export const DEPARTURE_SECONDS = 8.8;
export type DeparturePhase =
  | 'preflight'
  | 'roll'
  | 'rotate'
  | 'climb'
  | 'arrival';
const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const shotKeys = [
  { at: 0, camera: [16, 5.5, 22], target: [-6, 0, 0] },
  { at: 0.22, camera: [10, 3.4, 23], target: [0, 0.5, 0] },
  { at: 0.44, camera: [2, 3.5, 24], target: [0, 1, 0] },
  { at: 0.7, camera: [-14, 8, 22], target: [0, 0.8, 0] },
  { at: 1, camera: [-18, 9, 22], target: [0, 0, 0] },
] as const;

/** A continuous takeoff path; world travel and the camera share one clock. */
export function sampleDeparture(progress: number) {
  const t = Math.min(1, Math.max(0, progress));
  const index = Math.max(
    1,
    shotKeys.findIndex((key) => key.at >= t),
  );
  const a = shotKeys[index - 1],
    b = shotKeys[index];
  const f = ease((t - a.at) / (b.at - a.at));
  const distance = 230 * t * t;
  const climb = ease((t - 0.35) / 0.65);
  const altitude = 64 * climb;
  const camera = a.camera.map((v, i) => v + (b.camera[i] - v) * f) as [
    number,
    number,
    number,
  ];
  const target = a.target.map((v, i) => v + (b.target[i] - v) * f) as [
    number,
    number,
    number,
  ];
  camera[1] += altitude;
  camera[2] -= distance;
  target[1] += altitude;
  target[2] -= distance;
  const phase: DeparturePhase =
    t < 0.29 ? 'roll' : t < 0.48 ? 'rotate' : t < 0.83 ? 'climb' : 'arrival';
  return {
    camera,
    target,
    distance,
    altitude,
    climb,
    pitch: Math.sin(ease((t - 0.27) / 0.6) * Math.PI) * 0.18,
    bank: Math.sin(ease((t - 0.49) / 0.51) * Math.PI) * -0.23,
    heading: Math.PI + ease((t - 0.5) / 0.5) * 0.2,
    phase,
  };
}
