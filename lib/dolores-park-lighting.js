import { Color, Vector3, MathUtils } from 'three';
import { solarPosition, lunarPosition } from './sun-position.js';
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

// ---- The real sky over the park, from the clock ----
// The astronomy is three-free (lib/sun-position.js), so the Garage section
// can choose its poster without loading three.
export {
  PARK_LATITUDE,
  PARK_LONGITUDE,
  solarPosition,
  lunarPosition,
} from './sun-position.js';
// Key frames by sun elevation, in degrees. Colours are display sRGB. The
// 25° frame is the tuned `evening` daylight; below it the light warms and
// dims, the sky passes through sunset and twilight to an SF night (a dark
// sky with warm skyglow at the horizon), and the exposure opens up the way
// eyes adjust, so the street stays legible under its lamps.
// prettier-ignore
const FRAMES = [
  { el: -18, zenith: '#0a1426', horizon: '#2b2930', glow: '#2b2930', belt: '#2b2930', sunColor: '#ff8a50', light: 0, exposure: 2.9, environment: 0.95, hemiSky: '#46557a', hemiGround: '#2a2a2b', hemisphere: 0.42, band: '#ffffff', lamps: 1, windows: 1 },
  { el: -12, zenith: '#0d1a35', horizon: '#302f40', glow: '#3a3038', belt: '#2e2f40', sunColor: '#ff8a50', light: 0, exposure: 2.8, environment: 0.9, hemiSky: '#46557a', hemiGround: '#2a2a2b', hemisphere: 0.4, band: '#ffffff', lamps: 1, windows: 1 },
  { el: -8, zenith: '#172a52', horizon: '#4f4d64', glow: '#7a4c48', belt: '#46485e', sunColor: '#ff8a50', light: 0, exposure: 2.4, environment: 0.85, hemiSky: '#56607e', hemiGround: '#302f2e', hemisphere: 0.36, band: '#4a5068', lamps: 1, windows: 0.9 },
  { el: -5, zenith: '#2a4a80', horizon: '#9a8290', glow: '#c97452', belt: '#7a7590', sunColor: '#ff8a50', light: 0, exposure: 1.7, environment: 0.75, hemiSky: '#7f88a8', hemiGround: '#3a3634', hemisphere: 0.36, band: '#5c6078', lamps: 0.85, windows: 0.75 },
  { el: -2, zenith: '#3f6aa6', horizon: '#d4a68f', glow: '#ee915c', belt: '#b89aa8', sunColor: '#ff8a50', light: 0, exposure: 1.45, environment: 0.65, hemiSky: '#a8a8bc', hemiGround: '#54483e', hemisphere: 0.4, band: '#9c96a0', lamps: 0.45, windows: 0.45 },
  { el: 0, zenith: '#4f7dbb', horizon: '#e6bb98', glow: '#f6a46a', belt: '#d8b8b8', sunColor: '#ff9a5c', light: 1.4, exposure: 1.32, environment: 0.6, hemiSky: '#c8bcb8', hemiGround: '#625448', hemisphere: 0.42, band: '#e8c8b4', lamps: 0.15, windows: 0.25 },
  { el: 3, zenith: '#6194d2', horizon: '#e2cfb6', glow: '#f8c48e', belt: '#dcd2c8', sunColor: '#ffb57c', light: 3, exposure: 1.24, environment: 0.6, hemiSky: '#d6cbbf', hemiGround: '#6f6152', hemisphere: 0.43, band: '#f4dcc6', lamps: 0, windows: 0.1 },
  { el: 8, zenith: '#6ea6e4', horizon: '#d8dcd8', glow: '#f6dcb8', belt: '#d4dade', sunColor: '#ffd3a2', light: 4.4, exposure: 1.18, environment: 0.62, hemiSky: '#d8d8d2', hemiGround: '#746a5c', hemisphere: 0.44, band: '#fcf0e2', lamps: 0, windows: 0 },
  { el: 15, zenith: '#76b0ee', horizon: '#d0dee8', glow: '#eee8dc', belt: '#cedde8', sunColor: '#ffe6c6', light: 5.2, exposure: 1.15, environment: 0.64, hemiSky: '#dcdedc', hemiGround: '#746b5e', hemisphere: 0.45, band: '#ffffff', lamps: 0, windows: 0 },
  { el: 25, zenith: '#79b5f3', horizon: '#cadde9', glow: '#cadde9', belt: '#cadde9', sunColor: '#fff0dc', light: 5.5, exposure: 1.15, environment: 0.65, hemiSky: '#dce0df', hemiGround: '#746c5f', hemisphere: 0.45, band: '#ffffff', lamps: 0, windows: 0 },
];
const COLOR_KEYS = [
  'zenith',
  'horizon',
  'glow',
  'belt',
  'sunColor',
  'hemiSky',
  'hemiGround',
  'band',
];
const NUMBER_KEYS = [
  'light',
  'exposure',
  'environment',
  'hemisphere',
  'lamps',
  'windows',
];
function frameAt(elevation) {
  const i = FRAMES.findIndex((f) => f.el >= elevation);
  if (i === 0) return { ...FRAMES[0] };
  if (i < 0) return { ...FRAMES.at(-1) };
  const a = FRAMES[i - 1],
    b = FRAMES[i],
    t = (elevation - a.el) / (b.el - a.el);
  const out = {};
  for (const k of COLOR_KEYS)
    out[k] = new Color(a[k]).lerp(new Color(b[k]), t).getHexString();
  for (const k of NUMBER_KEYS) out[k] = MathUtils.lerp(a[k], b[k], t);
  for (const k of COLOR_KEYS) out[k] = '#' + out[k];
  return out;
}
// Day backdrops are baked under one of these suns, the nearest in bearing
// is used; below `nightBelow` the night backdrop, with its lit windows.
export const backdrops = {
  morning: { azimuth: 115, elevation: 30 },
  midday: { azimuth: 180, elevation: 50 },
  afternoon: { azimuth: 245, elevation: 30 },
  night: { azimuth: 245, elevation: -20, night: true },
};
const NIGHT_BELOW = -4;
export function backdropFor(sun) {
  if (sun.elevation < NIGHT_BELOW) return 'night';
  let best = 'midday',
    gap = Infinity;
  for (const [name, b] of Object.entries(backdrops)) {
    if (b.night) continue;
    const d = Math.abs(((sun.azimuth - b.azimuth + 540) % 360) - 180);
    if (d < gap) [best, gap] = [name, d];
  }
  return best;
}
// Everything the viewer needs for one moment. `input` is either a time
// (Date or ms), for the real sky over the park, or a fixed {azimuth,
// elevation} sun such as one of `suns`, with no moon.
export function doloresSky(input) {
  const timed = !(input && typeof input === 'object' && 'azimuth' in input);
  const sun = timed ? solarPosition(input) : { ...input };
  const moon = timed
    ? lunarPosition(input)
    : { azimuth: 0, elevation: -90, illumination: 0 };
  const frame = frameAt(sun.elevation);
  // The tuned fixed suns keep their own colour, strength and exposure.
  if (!timed && input.intensity !== undefined)
    Object.assign(frame, {
      sunColor: input.color,
      light: input.intensity,
      exposure: input.exposure,
      environment: input.environment,
      hemisphere: input.hemisphere,
    });
  const toSun = sunDirection(sun),
    toMoon = sunDirection(moon);
  // Below the horizon the shadow-casting light becomes the Moon, when it is
  // up: faint, cool, and scaled by its phase.
  let key = { direction: toSun, color: frame.sunColor, intensity: frame.light };
  if (frame.light <= 0 && moon.elevation > 0)
    key = {
      direction: toMoon,
      color: '#b8c6ea',
      intensity:
        0.55 *
        moon.illumination *
        MathUtils.smoothstep(moon.elevation, 0, 12) *
        MathUtils.smoothstep(-sun.elevation, 2, 8),
    };
  return {
    time: timed ? new Date(+input).toISOString() : null,
    sun,
    moon,
    toSun,
    toMoon,
    key,
    backdrop: backdropFor(sun),
    ...frame,
    el: undefined,
  };
}
