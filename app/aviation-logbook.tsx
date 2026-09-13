'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Plane } from 'lucide-react';
import { personalFlights, flightLogImport } from './personal-flights';
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
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLFieldSetElement>(null);
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
  const pageSize = 20;
  const pageCount = Math.ceil(flights.length / pageSize);
  const changePage = (next: number) => {
    const index = Math.max(0, Math.min(pageCount - 1, next));
    setPage(index);
    setSelected(flights[index * pageSize]?.id ?? null);
    list.current?.scrollTo({ top: 0 });
  };
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
                setPage(0);
                setSelected(null);
                list.current?.scrollTo({ top: 0 });
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
          ['Countries / regions', stats.countries],
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
      {flightLogImport.canceled > 0 && (
        <p className="logbook-data-note">
          Full log excludes {flightLogImport.canceled} cancellations. Distances
          are estimated between airports.
        </p>
      )}
      {active && (
        <div className="logbook-records">
          <div className="logbook-history">
            <fieldset
              className="logbook-flight-list"
              ref={list}
              aria-label="Choose a recorded flight"
            >
              {flights
                .slice(page * pageSize, (page + 1) * pageSize)
                .map((flight) => (
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
                    <span>
                      {flight.flightNumber || flight.airline || 'Flight'}
                      {flight.scheduledTo && (
                        <small className="logbook-diverted-label">
                          Diverted
                        </small>
                      )}
                    </span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </fieldset>
            {pageCount > 1 && (
              <nav
                className="logbook-pagination"
                aria-label="Flight history pages"
              >
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => changePage(page - 1)}
                >
                  ← Newer
                </button>
                <span aria-live="polite">
                  {page + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page === pageCount - 1}
                  onClick={() => changePage(page + 1)}
                >
                  Older →
                </button>
              </nav>
            )}
          </div>
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
                <span title={active.from.name}>
                  {active.from.city || active.from.name}
                </span>
              </div>
              <span>→</span>
              <div>
                <strong>{active.to.code}</strong>
                <span title={active.to.name}>
                  {active.to.city || active.to.name}
                </span>
              </div>
            </div>
            {active.scheduledTo && (
              <p className="logbook-diversion">
                {active.from.code === active.to.code
                  ? `Returned to ${active.to.code}`
                  : `Diverted to ${active.to.code}`}{' '}
                · scheduled for {active.scheduledTo.code}
              </p>
            )}
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
                <dd>
                  {active.from.code === active.to.code
                    ? 'Not available'
                    : `${number(Math.round(routeMiles(active)))} mi`}
                </dd>
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
