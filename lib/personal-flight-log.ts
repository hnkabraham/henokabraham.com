export type LogAirport = {
  code: string;
  name: string;
  city?: string;
  country: string;
  latitude: number;
  longitude: number;
};

/** Public flight details only; booking references and seat details stay out. */
export type PersonalFlight = {
  id: string;
  date: string | null;
  from: LogAirport;
  to: LogAirport;
  /** Original destination when the recorded flight diverted elsewhere. */
  scheduledTo?: LogAirport;
  airline?: string;
  flightNumber?: string;
  aircraft?: string;
};

export const mapPoint = (airport: LogAirport): [number, number] => [
  ((airport.longitude + 180) / 360) * 1000,
  ((90 - airport.latitude) / 180) * 500,
];

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const vector = (a: LogAirport) => {
  const lat = radians(a.latitude),
    lon = radians(a.longitude);
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
};
const angle = (a: LogAirport, b: LogAirport) => {
  const av = vector(a),
    bv = vector(b);
  return Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        av.reduce((sum, v, i) => sum + v * bv[i], 0),
      ),
    ),
  );
};

/** Great-circle estimate, not the distance of the actual flown track. */
export const routeMiles = (flight: Pick<PersonalFlight, 'from' | 'to'>) =>
  angle(flight.from, flight.to) * 3958.7613;

/** Split date-line crossings instead of drawing an incorrect line across the map. */
export function routePath(flight: Pick<PersonalFlight, 'from' | 'to'>) {
  const a = vector(flight.from),
    b = vector(flight.to);
  const omega = angle(flight.from, flight.to);
  if (omega < 0.000001) return '';
  const sin = Math.sin(omega);
  // An antipodal pair has no unique shortest arc. Choose a stable perpendicular.
  const axis = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const perpendicular = [
    a[1] * axis[2] - a[2] * axis[1],
    a[2] * axis[0] - a[0] * axis[2],
    a[0] * axis[1] - a[1] * axis[0],
  ];
  const norm = Math.hypot(...perpendicular);
  let previousX: number | null = null;
  const segments: string[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const v =
      Math.abs(sin) < 0.000001
        ? a.map(
            (n, j) =>
              n * Math.cos(t * Math.PI) +
              (perpendicular[j] / norm) * Math.sin(t * Math.PI),
          )
        : a.map(
            (n, j) =>
              (n * Math.sin((1 - t) * omega) + b[j] * Math.sin(t * omega)) /
              sin,
          );
    const lon = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
    const lat = (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI;
    const x = ((lon + 180) / 360) * 1000,
      y = ((90 - lat) / 180) * 500;
    const command =
      previousX === null || Math.abs(x - previousX) > 500 ? 'M' : 'L';
    segments.push(`${command}${x.toFixed(2)},${y.toFixed(2)}`);
    previousX = x;
  }
  return segments.join(' ');
}

export function flightLogStats(flights: PersonalFlight[]) {
  const airports = new Set<string>(),
    countries = new Set<string>();
  let miles = 0;
  for (const flight of flights) {
    for (const airport of [flight.from, flight.to]) {
      airports.add(airport.code);
      countries.add(airport.country);
    }
    miles += routeMiles(flight);
  }
  return {
    flights: flights.length,
    airports: airports.size,
    countries: countries.size,
    miles: Math.round(miles),
  };
}
