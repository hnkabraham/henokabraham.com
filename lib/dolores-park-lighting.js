import { Vector3, MathUtils } from 'three';
export const suns = {
  evening: {
    azimuth: 272,
    elevation: 34,
    color: '#fff0dc',
    intensity: 5.5,
    exposure: 1.15,
    environment: 0.65,
    hemisphere: 0.45,
  },
  winter: {
    azimuth: 225,
    elevation: 28,
    color: '#fff0d8',
    intensity: 6,
    exposure: 1.2,
    environment: 0.45,
    hemisphere: 0.32,
  },
  summer: {
    azimuth: 290,
    elevation: 10,
    color: '#ffe2b7',
    intensity: 5,
    exposure: 1.05,
    environment: 0.65,
    hemisphere: 0.55,
  },
};
export function sunDirection(sun) {
  const a = MathUtils.degToRad(sun.azimuth),
    e = MathUtils.degToRad(sun.elevation);
  return new Vector3(
    Math.sin(a) * Math.cos(e),
    Math.sin(e),
    -Math.cos(a) * Math.cos(e),
  );
}

export function lightingParams(sun) {
  return {
    sunAz: sun.azimuth,
    sunEl: sun.elevation,
    sun: sun.intensity,
    sunColor: sun.color,
    exposure: sun.exposure,
    env: sun.environment,
    hemi: sun.hemisphere,
  };
}
