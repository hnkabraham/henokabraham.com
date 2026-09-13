'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Plane } from 'lucide-react';
import { flightAtlas } from './flight-atlas';
import { mapPoint, routePath } from '@/lib/personal-flight-log';
import { countryFlag, countryName } from '@/lib/flight-atlas';

const number = (n: number) => n.toLocaleString('en-US');
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export default function AviationLogbook() {
  const [year, setYear] = useState('all');
  const [country, setCountry] = useState<string | null>(null);
  const { years } = flightAtlas;
  const period = flightAtlas.periods[year] ?? flightAtlas.periods.all;
  const { stats } = period;
  const airports = useMemo(
    () => period.airportCodes.map((code) => flightAtlas.airports[code]),
    [period],
  );
  const countries = period.countryCodes;
  const routes = useMemo(
    () =>
      period.routes.map(([from, to]) => {
        const route = {
          from: flightAtlas.airports[from],
          to: flightAtlas.airports[to],
        };
        return { ...route, key: `${from}:${to}`, path: routePath(route) };
      }),
    [period],
  );
  // Stagger nearby international labels, keeping the dense Europe cluster legible.
  const labels = useMemo(() => {
    const occupied: { x: number; y: number }[] = [];
    return airports
      .filter((a) => a.country !== 'US')
      .sort((a, b) => b.latitude - a.latitude)
      .map((airport) => {
        const [x, y] = mapPoint(airport);
        const candidates = [
          [12, -32],
          [-82, -32],
          [12, 10],
          [-82, 10],
          [-35, -65],
          [12, 44],
          [-82, 44],
          [47, -65],
          [-117, -65],
          [47, -98],
          [-117, -98],
        ];
        const spots = candidates.map(([dx, dy]) => ({
          x: Math.max(2, Math.min(928, x + dx)),
          y: Math.max(2, Math.min(468, y + dy)),
        }));
        const spot =
          spots.find((p) =>
            occupied.every(
              (o) => Math.abs(p.x - o.x) >= 76 || Math.abs(p.y - o.y) >= 34,
            ),
          ) ?? spots[0];
        occupied.push(spot);
        return { airport, x, y, labelX: spot.x, labelY: spot.y };
      });
  }, [airports]);
  return (
    <section
      className="aviation-logbook"
      id="logbook"
      aria-labelledby="logbook-title"
    >
      <div className="logbook-heading">
        <div>
          <p className="eyebrow">AWAY FROM THE KEYBOARD</p>
          <h2 id="logbook-title">My flight log.</h2>
        </div>
        {years.length > 1 && (
          <label className="logbook-filter">
            Year{' '}
            <select
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setCountry(null);
              }}
            >
              <option value="all">All flights</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="logbook-mark">
          <Plane size={17} /> FLIGHTY · {years.at(-1)}–{years[0]}
        </span>
      </div>
      <figure className="logbook-atlas">
        <figcaption className="sr-only">
          {stats.flights} flights connecting {stats.airports} airports across{' '}
          {stats.countries} countries and regions. International airports are
          labeled with their country flags.
        </figcaption>
        <svg
          viewBox="0 0 1000 500"
          className="logbook-map"
          role="img"
          aria-label="Travel route map with international destination flags"
        >
          <defs>
            <pattern
              id="logbook-grid"
              width="83.333"
              height="83.333"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M83.333 0H0V83.333"
                fill="none"
                stroke="#c0dbea"
                strokeOpacity=".07"
                strokeWidth=".7"
              />
            </pattern>
            <clipPath id="logbook-flag-circle">
              <circle cx="14" cy="14" r="13" />
            </clipPath>
          </defs>
          <rect width="1000" height="500" fill="url(#logbook-grid)" />
          <image
            href="/images/flight-log-world.svg"
            width="1000"
            height="500"
          />
          {routes.map((route) => (
            <path
              key={route.key}
              d={route.path}
              className={`logbook-route${country ? (route.from.country === country || route.to.country === country ? ' selected' : ' muted') : ''}`}
            />
          ))}
          {airports.map((airport) => {
            const [x, y] = mapPoint(airport);
            return (
              <g
                key={airport.code}
                transform={`translate(${x},${y})`}
                className={`logbook-airport${country === airport.country ? ' selected' : ''}`}
              >
                <title>{`${airport.code} · ${airport.city || airport.name} · ${countryName(airport.country)}`}</title>
                <circle r={country === airport.country ? 4 : 2.6} />
              </g>
            );
          })}
          {labels.map(({ airport, x, y, labelX, labelY }) => (
            <g
              key={airport.code}
              className={`logbook-destination${country && country !== airport.country ? ' muted' : ''}`}
            >
              <title>{`${airport.code} · ${airport.city || airport.name} · ${countryName(airport.country)}`}</title>
              <path
                d={`M${x},${y}L${labelX + 14},${labelY + 14}`}
                className="logbook-label-line"
              />
              <g transform={`translate(${labelX},${labelY})`}>
                <circle cx="14" cy="14" r="14" fill="#102c3e" />
                <image
                  href={countryFlag(airport.country)}
                  width="28"
                  height="28"
                  clipPath="url(#logbook-flag-circle)"
                />
                <text x="33" y="19">
                  {airport.code}
                </text>
              </g>
            </g>
          ))}
        </svg>
        <a
          className="logbook-map-credit"
          href="https://www.naturalearthdata.com/about/terms-of-use/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Natural Earth <ArrowUpRight size={10} />
        </a>
      </figure>
      <dl className="logbook-stats">
        {(
          [
            ['Flights', stats.flights],
            ['Airports', stats.airports],
            ['Countries / regions', stats.countries],
            ['Est. route miles', stats.miles],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dd title={number(value)} aria-label={number(value)}>
              {value >= 10000 ? compact.format(value) : number(value)}
            </dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      <div className="logbook-passport">
        <ul
          className="logbook-flags"
          aria-label="Visited countries and regions"
        >
          {countries.map((code) => (
            <li key={code}>
              <button
                type="button"
                className="logbook-country"
                aria-label={countryName(code)}
                aria-pressed={country === code}
                title={countryName(code)}
                onClick={() => setCountry(country === code ? null : code)}
              >
                <img
                  src={countryFlag(code)}
                  alt=""
                  width="44"
                  height="44"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            </li>
          ))}
        </ul>
        <p className="logbook-country-name" aria-live="polite">
          {country ? countryName(country) : '\u00a0'}
        </p>
      </div>
    </section>
  );
}
