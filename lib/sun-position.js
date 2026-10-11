// The Sun and Moon over the Dolores Park scene, from the clock alone: no
// three.js, so the Garage section can pick its poster without loading it.
// The park frame's origin (scripts/dolores-park/README.md). Azimuths are
// compass bearings, 0 north and 90 east, as sunDirection() in
// dolores-park-lighting.js takes them.
export const PARK_LATITUDE = 37.7596;
export const PARK_LONGITUDE = -122.427;
const RAD = Math.PI / 180;
const wrap = (degrees) => ((degrees % 360) + 360) % 360;
// Bennett's formula, in degrees, for the bending near the horizon: the sun
// is still up for a few minutes after its geometric centre has set.
const refraction = (h) =>
  h < -1.5 ? 0 : 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
function horizontal(rightAscension, declination, time, lat, lon) {
  const days = +time / 86400000 + 2440587.5 - 2451545;
  const sidereal = wrap(280.46061837 + 360.98564736629 * days + lon);
  const hour = (sidereal - rightAscension) * RAD,
    phi = lat * RAD,
    delta = declination * RAD;
  const elevation =
    Math.asin(
      Math.sin(phi) * Math.sin(delta) +
        Math.cos(phi) * Math.cos(delta) * Math.cos(hour),
    ) / RAD;
  const azimuth = wrap(
    Math.atan2(
      Math.sin(hour),
      Math.cos(hour) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi),
    ) /
      RAD +
      180,
  );
  return { azimuth, elevation };
}
// NOAA's solar position equations (Meeus' low-accuracy series), good to a
// few hundredths of a degree this century. Elevation includes refraction.
export function solarPosition(time, lat = PARK_LATITUDE, lon = PARK_LONGITUDE) {
  const T = (+time / 86400000 + 2440587.5 - 2451545) / 36525;
  const L0 = wrap(280.46646 + T * (36000.76983 + T * 0.0003032)),
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T,
    longitude = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliquity =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 +
    0.00256 * Math.cos(omega * RAD);
  const l = longitude * RAD,
    e = obliquity * RAD;
  const position = horizontal(
    Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD,
    Math.asin(Math.sin(e) * Math.sin(l)) / RAD,
    time,
    lat,
    lon,
  );
  position.elevation += refraction(position.elevation);
  return position;
}
// The Moon from the largest terms of Meeus ch. 47 (about a quarter of a
// degree), with the topocentric parallax that lowers it by up to 0.95°.
// `illumination` is the lit fraction of the disc, 0 new to 1 full.
export function lunarPosition(time, lat = PARK_LATITUDE, lon = PARK_LONGITUDE) {
  const d = +time / 86400000 + 2440587.5 - 2451545;
  const L = 218.3164 + 13.17639648 * d,
    D = (297.8502 + 12.19074912 * d) * RAD,
    M = (357.5291 + 0.98560028 * d) * RAD,
    Mm = (134.9634 + 13.06499295 * d) * RAD,
    F = (93.272 + 13.22935024 * d) * RAD;
  const longitude =
    L +
    6.289 * Math.sin(Mm) +
    1.274 * Math.sin(2 * D - Mm) +
    0.658 * Math.sin(2 * D) +
    0.214 * Math.sin(2 * Mm) -
    0.186 * Math.sin(M) -
    0.114 * Math.sin(2 * F);
  const latitude =
    5.128 * Math.sin(F) +
    0.281 * Math.sin(Mm + F) +
    0.278 * Math.sin(Mm - F) +
    0.173 * Math.sin(2 * D - F);
  const l = longitude * RAD,
    b = latitude * RAD,
    e = (23.4393 - 3.563e-7 * d) * RAD;
  const position = horizontal(
    Math.atan2(
      Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
      Math.cos(l),
    ) / RAD,
    Math.asin(
      Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l),
    ) / RAD,
    time,
    lat,
    lon,
  );
  position.elevation -= 0.9507 * Math.cos(position.elevation * RAD);
  position.elevation += refraction(position.elevation);
  // Phase angle from the elongation (Meeus 48.4, the simple form).
  const phase =
    180 -
    D / RAD -
    6.289 * Math.sin(Mm) +
    2.1 * Math.sin(M) -
    1.274 * Math.sin(2 * D - Mm) -
    0.658 * Math.sin(2 * D) -
    0.214 * Math.sin(2 * Mm) -
    0.11 * Math.sin(D);
  position.illumination = (1 + Math.cos(phase * RAD)) / 2;
  return position;
}
