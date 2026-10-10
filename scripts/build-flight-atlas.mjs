import { readFile, writeFile } from 'node:fs/promises';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const load = async (path) => {
  const code = transpileModule(
    await readFile(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
};
// The default sort's code-unit order, made explicit so the generated module
// stays byte-identical and the intent is visible.
const codeUnits = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const { personalFlights } = await load('./data/personal-flights.ts');
const { flightLogStats } = await load('../lib/personal-flight-log.ts');
// OurAirports' municipality names, where a visitor would look for another:
// the accent it drops, the city an airport serves rather than its suburb, and
// the en dash between two cities.
const cityNames = {
  BOG: 'Bogotá',
  DFW: 'Dallas–Fort Worth',
  EZE: 'Buenos Aires',
  IAD: 'Washington Dulles',
  NRT: 'Tokyo',
};
const airports = Object.fromEntries(
  [
    ...new Map(
      personalFlights
        .flatMap((f) => [f.from, f.to])
        .map((a) => [
          a.code,
          cityNames[a.code] ? { ...a, city: cityNames[a.code] } : a,
        ]),
    ).entries(),
  ].sort(codeUnits),
);
// The day the Flighty export was imported, as the data notice records it,
// so the logbook can say how current it is. Published only as the label the
// mark prints, day-month-year as aviation writes it (13 SEP 2026): the
// published data carries no ISO dates at all (check-flight-log-view.mjs).
const importDate = (
  await readFile(
    new URL('../public/credits/flight-log-data.txt', import.meta.url),
    'utf8',
  )
).match(/imported (\d{4})-(\d{2})-(\d{2})/);
if (!importDate) throw new Error('The flight log notice has no import date');
const imported = `${Number(importDate[3])} ${'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[importDate[2] - 1]} ${importDate[1]}`;
const years = [
  ...new Set(
    personalFlights.flatMap((f) => (f.date ? [f.date.slice(0, 4)] : [])),
  ),
]
  .sort(codeUnits)
  .reverse();
const airlines = {};
for (const flight of personalFlights) {
  const code = flight.flightNumber?.slice(0, 2);
  if (!code || !flight.airline)
    throw new Error('Airline identification is missing');
  airlines[code] = {
    // Wingo flies under Aero República's code; it is the name on the aircraft.
    name: code === 'P5' ? 'Wingo' : flight.airline,
    logo: `/images/airlines/${code.toLowerCase()}.${code === 'P5' ? 'png' : 'svg'}`,
  };
}
const periods = {};
for (const period of ['all', ...years]) {
  const flights = personalFlights.filter(
    (f) => period === 'all' || f.date?.startsWith(period),
  );
  periods[period] = {
    stats: flightLogStats(flights),
    airlines: Object.entries(
      flights.reduce((counts, flight) => {
        const code = flight.flightNumber.slice(0, 2);
        counts[code] = (counts[code] || 0) + 1;
        return counts;
      }, {}),
    )
      .map(([code, flights]) => ({ code, flights }))
      .sort((a, b) => b.flights - a.flights || a.code.localeCompare(b.code)),
    countryCodes: [
      ...new Set(
        [...flights]
          .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
          .flatMap((f) => [f.from.country, f.to.country]),
      ),
    ],
    airportCodes: [
      ...new Set(flights.flatMap((f) => [f.from.code, f.to.code])),
    ].sort(codeUnits),
    routes: [...new Set(flights.map((f) => `${f.from.code}:${f.to.code}`))]
      .sort(codeUnits)
      .map((route) => route.split(':')),
  };
}
// Only totals, visited airports and unique routes leave the import source.
const output = `import type { FlightAtlas } from '@/lib/flight-atlas';\n\n// Generated summary only. No individual flight records are sent to visitors.\nexport const flightAtlas: FlightAtlas = ${JSON.stringify({ imported, airports, airlines, years, periods }, null, 2)};\n`;
const destination = new URL('../app/flight-atlas.ts', import.meta.url);
const previous = await readFile(destination, 'utf8').catch(() => '');
if (previous !== output) await writeFile(destination, output);
console.log(
  `Flight atlas: ${periods.all.stats.flights} flights summarized across ${years.length} years; no dates or flight identifiers.`,
);
