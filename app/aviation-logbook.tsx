'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Plane } from 'lucide-react';
import { personalFlights } from './personal-flights';
import {
  flightLogStats,
  mapPoint,
  routeMiles,
  routePath,
} from '@/lib/personal-flight-log';

const number = (n: number) => n.toLocaleString('en-US');
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const dateLabel = (date: string | null) =>
  date
    ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Date not recorded';

export default function AviationLogbook() {
  const [year, setYear] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let visible = false;
    const update = () => {
      element.dataset.active = String(visible && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const years = useMemo(
    () =>
      [
        ...new Set(
          personalFlights.flatMap((f) => (f.date ? [f.date.slice(0, 4)] : [])),
        ),
      ]
        .sort()
        .reverse(),
    [],
  );
  const flights = useMemo(
    () =>
      personalFlights
        .filter((f) => year === 'all' || f.date?.startsWith(year))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    [year],
  );
  const stats = useMemo(() => flightLogStats(flights), [flights]);
  const routes = useMemo(
    () =>
      [
        ...new Map(
          flights.map((flight) => [
            `${flight.from.code}:${flight.to.code}`,
            flight,
          ]),
        ).values(),
      ].map((flight) => ({ flight, path: routePath(flight) })),
    [flights],
  );
  const airports = useMemo(
    () => [
      ...new Map(
        flights.flatMap((f) => [f.from, f.to]).map((a) => [a.code, a]),
      ).values(),
    ],
    [flights],
  );
  const active = flights.find((f) => f.id === selected) ?? flights[0];
  return (
    <section
      className="aviation-logbook"
      id="logbook"
      ref={root}
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
                setSelected(null);
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
          <Plane size={17} /> PERSONAL AIRSPACE
        </span>
      </div>
      <figure className="logbook-atlas">
        <figcaption className="sr-only">
          {flights.length
            ? `${stats.flights} recorded flights connecting ${stats.airports} airports. Select a flight below to highlight its route.`
            : 'World map. Personal flight routes have not been added yet.'}
        </figcaption>
        <svg viewBox="0 0 1000 500" className="logbook-map" aria-hidden="true">
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
          </defs>
          <rect width="1000" height="500" fill="url(#logbook-grid)" />
          <image
            href="/images/flight-log-world.svg"
            width="1000"
            height="500"
          />
          {routes.map(({ flight, path }) => (
            <path
              key={flight.id}
              d={path}
              className={`logbook-route ${active?.from.code === flight.from.code && active?.to.code === flight.to.code ? 'selected' : ''}`}
            />
          ))}
          {airports.map((airport) => {
            const [x, y] = mapPoint(airport);
            const highlighted =
              active?.from.code === airport.code ||
              active?.to.code === airport.code;
            return (
              <g
                key={airport.code}
                transform={`translate(${x},${y})`}
                className={
                  highlighted ? 'logbook-airport selected' : 'logbook-airport'
                }
              >
                <circle r={highlighted ? 4 : 2} />
                {highlighted && (
                  <text y="-11" textAnchor="middle">
                    {airport.code}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {!flights.length && (
          <div className="logbook-empty">
            <Plane size={28} strokeWidth={1.2} />
            <p>
              Every flight,
              <br />
              <em>a story.</em>
            </p>
            <span>Routes coming soon.</span>
          </div>
        )}
        {active && (
          <div className="logbook-route-caption">
            <span>{active.from.code}</span>
            <span className="logbook-route-dash" />
            <Plane size={17} />
            <span className="logbook-route-dash" />
            <span>{active.to.code}</span>
          </div>
        )}
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
        {[
          ['Flights', stats.flights],
          ['Airports', stats.airports],
          ['Countries', stats.countries],
          ['Est. route miles', stats.miles],
        ].map(([label, value]) => (
          <div key={label}>
            <dd
              title={flights.length ? number(Number(value)) : undefined}
              aria-label={flights.length ? number(Number(value)) : undefined}
            >
              {flights.length
                ? Number(value) >= 10000
                  ? compact.format(Number(value))
                  : number(Number(value))
                : '—'}
            </dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      {active && (
        <div className="logbook-records">
          <fieldset
            className="logbook-flight-list"
            aria-label="Choose a recorded flight"
          >
            {flights.map((flight) => (
              <button
                key={flight.id}
                type="button"
                aria-pressed={active.id === flight.id}
                onClick={() => setSelected(flight.id)}
              >
                <span className="logbook-list-route">
                  {flight.from.code}
                  <Plane size={14} />
                  {flight.to.code}
                </span>
                <time dateTime={flight.date ?? undefined}>
                  {dateLabel(flight.date)}
                </time>
                <span>{flight.flightNumber || flight.airline || 'Flight'}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </fieldset>
          <article
            className="logbook-pass"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="logbook-pass-top">
              <span>FLIGHT LOG</span>
              <Plane size={18} />
            </div>
            <div className="logbook-pass-route">
              <div>
                <strong>{active.from.code}</strong>
                <span>{active.from.name}</span>
              </div>
              <span>→</span>
              <div>
                <strong>{active.to.code}</strong>
                <span>{active.to.name}</span>
              </div>
            </div>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{dateLabel(active.date)}</dd>
              </div>
              {active.airline && (
                <div>
                  <dt>Airline</dt>
                  <dd>{active.airline}</dd>
                </div>
              )}
              {active.aircraft && (
                <div>
                  <dt>Aircraft</dt>
                  <dd>{active.aircraft}</dd>
                </div>
              )}
              <div>
                <dt>Est. distance</dt>
                <dd>{number(Math.round(routeMiles(active)))} mi</dd>
              </div>
            </dl>
            <div className="logbook-pass-stub">
              <span>HENOK ABRAHAM</span>
              <span className="barcode" aria-hidden="true" />
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
