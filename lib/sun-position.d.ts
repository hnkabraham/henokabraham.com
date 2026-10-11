export interface SkyPosition {
  /** Compass bearing, degrees: 0 north, 90 east. */
  azimuth: number;
  /** Degrees above the horizon, with refraction. */
  elevation: number;
}

export const PARK_LATITUDE: number;
export const PARK_LONGITUDE: number;

export function solarPosition(
  time: Date | number,
  latitude?: number,
  longitude?: number,
): SkyPosition;

export function lunarPosition(
  time: Date | number,
  latitude?: number,
  longitude?: number,
): SkyPosition & {
  /** Lit fraction of the disc, 0 new to 1 full. */
  illumination: number;
};
