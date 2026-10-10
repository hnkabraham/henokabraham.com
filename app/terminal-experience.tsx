'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Plane,
  PlaneTakeoff,
  CodeXml,
  Check,
  X,
  Radio,
} from 'lucide-react';
import { useAirspaceDepth } from './use-airspace-depth';
import ScrollDeparture from './scroll-departure';
import { flights, liveSites, openSource } from './flight-data';
import ProjectPreview from './project-preview';
import { useViewPreference } from './use-view-preference';
import {
  boardingLink,
  readFlightLink,
  replaceFlightLink,
} from '@/lib/flight-links';
import { boardingCode, boardingCodePath } from '@/lib/boarding-code';
import type { BayPhase } from '@/lib/bay-flight';
import type { LiveFeed } from '@/server/live';
import AviationLogbook from './aviation-logbook';
import GarageSection from './garage-section';
import WatchShowcase from './watch-showcase';
import {
  useAirportLive,
  ProjectUpdate,
  ContactTower,
  FlightMeasurements,
} from './airport-services';
import { recordFlightMetric } from '@/lib/flight-metrics';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';

// The briefing rail draws its capture about 175 px wide; each capture comes
// in three widths and two formats (scripts/prepare-rail-images.py).
const RAIL_SIZES = '175px';
const railSources = (src: string, format: 'avif' | 'jpg') => {
  const base = src.replace(/\.jpg$/, '');
  return `${base}-360.${format} 360w, ${base}-525.${format} 525w, ${base}.${format} 690w`;
};

// Each pass's code, made once: the same on the server and in the browser.
const boardingCodes = Object.fromEntries(
  flights.map((item) => [
    item.id,
    boardingCodePath(boardingCode(boardingLink(item.id))),
  ]),
);

/** A stub field's characters, each turning over like a split-flap display
 * when the pass changes; read as one word. The fields are codes and gates,
 * plain ASCII, so splitting by UTF-16 unit is splitting by character. */
function Flap({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="flap" aria-hidden="true">
        {text.split('').map((character, index) => (
          <span key={index} style={{ animationDelay: `${index * 45}ms` }}>
            {character === ' ' ? '\u00a0' : character}
          </span>
        ))}
      </span>
    </>
  );
}

// The breakpoint where the departures layout becomes one column (globals.css).
const singleColumn = () => matchMedia('(max-width: 800px)').matches;

const liveSiteCount =
  ['No', 'One', 'Two', 'Three', 'Four'][liveSites.length] ??
  String(liveSites.length);

function StationClock() {
  const [clock, setClock] = useState({ time: '--:--:--', zone: 'PT' });
  useEffect(() => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    const update = () => {
      const parts = formatter.formatToParts(new Date());
      setClock({
        time: parts
          .filter((part) => part.type !== 'timeZoneName')
          .map((part) => part.value)
          .join('')
          .trim(),
        zone: parts.find((part) => part.type === 'timeZoneName')?.value ?? 'PT',
      });
    };
    // Each tick waits for the next whole second, so the display turns over
    // with the second itself rather than wherever in it the page mounted.
    let timer = 0;
    const tick = () => {
      update();
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className="station-clock mono"
      aria-label={`Current Pacific time ${clock.time} ${clock.zone}`}
    >
      <span className="signal-dot" />
      <time>{clock.time}</time>
      <span>{clock.zone}</span>
    </div>
  );
}

export default function TerminalExperience({
  live: rendered,
  initialProject,
}: {
  live: LiveFeed | null;
  /** The board row a shared `?project=` link names, rendered selected. */
  initialProject: number;
}) {
  const live = useAirportLive(rendered);
  const [selected, setSelected] = useState(initialProject);
  const [projectOpen, setProjectOpen] = useState(false);
  const projectReturnFocus = useRef<HTMLElement | null>(null);
  const flight = flights[selected];
  const flightLive = live.data?.projects?.projects.find(
    (item) => item.id === flight.id,
  );
  const root = useRef<HTMLDivElement>(null);
  const {
    simple: reducedMotion,
    ready: viewReady,
    toggle: toggleView,
  } = useViewPreference();
  const [entry, setEntry] = useState<{ chapter: BayPhase | null } | null>(null);
  useAirspaceDepth(root, viewReady && !reducedMotion);
  const briefingOpen = useRef(false);
  // An open briefing adds a history entry of its own, so Back closes it
  // rather than leaving the page. Closing it any other way (its button,
  // Escape, a click outside) steps back over that entry, and the popstate
  // that causes is ours to ignore.
  const briefingEntry = useRef(false);
  const ownPopstate = useRef(false);
  // Something to do once that step back has landed: "Return to the open sky".
  const afterClose = useRef<(() => void) | null>(null);
  useEffect(() => {
    briefingOpen.current = projectOpen;
    if (projectOpen && !briefingEntry.current) {
      briefingEntry.current = true;
      // vinext restores a traversal's scroll from these keys; record where
      // the page is, so Back returns exactly here.
      history.replaceState(
        {
          ...history.state,
          __vinext_scrollX: scrollX,
          __vinext_scrollY: scrollY,
        },
        '',
      );
      history.pushState(
        { ...history.state, briefing: true },
        '',
        location.href,
      );
    } else if (!projectOpen && briefingEntry.current) {
      briefingEntry.current = false;
      if (history.state?.briefing) {
        ownPopstate.current = true;
        history.back();
      }
    }
  }, [projectOpen]);
  // The query this page last applied or wrote itself.
  const appliedQuery = useRef<string | null>(null);
  useEffect(() => {
    let first = true;
    const restore = () => {
      if (ownPopstate.current) {
        ownPopstate.current = false;
        const action = afterClose.current;
        afterClose.current = null;
        // After vinext's own scroll restore for the step back, which runs
        // over the next frame or two.
        if (action)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(action)),
          );
        return;
      }
      // Back with a briefing open closes it, rather than swapping the project
      // inside it for whichever one the older history entry names.
      if (briefingOpen.current) {
        briefingEntry.current = false;
        appliedQuery.current = location.search;
        setProjectOpen(false);
        return;
      }
      // Anchor links are navigations too, and fire popstate. Only the query
      // (a shared project or chapter) is ours to restore, so "Say hello"
      // after a chapter link no longer replays that chapter's landing.
      if (location.search === appliedQuery.current) return;
      appliedQuery.current = location.search;
      const link = readFlightLink(
        new URL(location.href),
        flights.map((item) => item.id),
      );
      setSelected(
        Math.max(
          0,
          flights.findIndex((item) => item.id === link.project),
        ),
      );
      setEntry({ chapter: link.chapter });
      // A shared project link opens on its ticket, not the tour's first
      // screen. Only on arrival: a reload or Back keeps its own place.
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (
        first &&
        link.project &&
        !link.chapter &&
        (!navigation || navigation.type === 'navigate')
      )
        requestAnimationFrame(() =>
          document
            .getElementById(singleColumn() ? 'selected-project' : 'departures')
            ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
      first = false;
    };
    restore();
    addEventListener('popstate', restore);
    return () => {
      removeEventListener('popstate', restore);
    };
  }, []);
  const selectFlight = (index: number) => {
    setSelected(index);
    recordFlightMetric('project_open', 1);
    replaceFlightLink({ project: flights[index].id });
    appliedQuery.current = location.search;
  };
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  // One stop in the Tab order for the whole board; the arrow keys move
  // between rows and select as they go, as in any radio group.
  const moveSelection = (event: KeyboardEvent, index: number) => {
    const last = flights.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    selectFlight(next);
    rows.current[next]?.focus();
  };
  useEffect(() => {
    // For anyone who opens the console: the aircraft's registration, and
    // where the code that draws it lives.
    console.log(
      '%c✈ N787HA%c  Personal Airspace is open source: https://github.com/hnkabraham/henokabraham.com',
      'font-weight:600;color:#d34d26',
      'color:inherit',
    );
  }, []);

  return (
    <div className="airport" ref={root}>
      <a className="skip-link" href="#departures">
        Skip to projects
      </a>
      <header className="terminal-header">
        <a href="#flight" className="brand" aria-label="Henok Abraham, home">
          <span className="brand-symbol" aria-hidden="true">
            <Plane size={21} strokeWidth={1.6} />
          </span>
          <span>
            HENOK ABRAHAM<small>PERSONAL AIRSPACE</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#departures">
            <span className="nav-number">01</span> Departures
          </a>
          <a href="#in-service">
            <span className="nav-number">02</span> In service
          </a>
          <a href="#logbook">
            <span className="nav-number">03</span> Flight log
          </a>
          <a href="#garage">
            <span className="nav-number">04</span> Garage
          </a>
          <a
            href="https://github.com/hnkabraham"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <ArrowUpRight size={15} />
          </a>
        </nav>
        <StationClock />
      </header>
      <FlightMeasurements />
      <main>
        {/* The tour's captions change as it plays, so the page's one
            first-level heading is this, and they are second-level. */}
        <h1 className="sr-only">Henok Abraham — Personal Airspace</h1>
        <ScrollDeparture
          reducedMotion={reducedMotion}
          viewReady={viewReady}
          onToggleView={toggleView}
          entry={entry}
          paused={projectOpen}
          onProject={(id) => {
            const index = flights.findIndex((item) => item.id === id);
            if (index < 0) return;
            projectReturnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            selectFlight(index);
            setProjectOpen(true);
          }}
        />
        <section
          className="terminal-section"
          id="departures"
          aria-labelledby="departures-title"
        >
          <div className="terminal-section-top" data-reveal>
            <div className="terminal-section-label">
              <span className="section-marker">01</span>
              <div>
                <p className="eyebrow">SELECTED WORK</p>
                <h2 id="departures-title">Departures</h2>
              </div>
            </div>
          </div>
          <div className="departure-layout">
            <div
              className="departure-board depth-surface"
              data-depth="board"
              data-reveal
            >
              <div className="board-title">
                <span>
                  <PlaneTakeoff size={20} /> PROJECTS
                </span>
                <span className="mono">{flights.length} DESTINATIONS</span>
              </div>
              <div className="board-columns mono" aria-hidden="true">
                <span>FLIGHT</span>
                <span>DESTINATION / PROJECT</span>
                <span>GATE</span>
                <span>STATUS</span>
              </div>
              <div
                className="flight-list"
                role="radiogroup"
                aria-label="Choose a project"
              >
                {flights.map((item, index) => (
                  <button
                    key={item.id}
                    ref={(row) => {
                      rows.current[index] = row;
                    }}
                    className={`flight-row ${selected === index ? 'selected' : ''}`}
                    // A button, not an input: Enter opens the briefing, and a
                    // tap on a phone does too.
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                    role="radio"
                    aria-checked={selected === index}
                    tabIndex={selected === index ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        projectReturnFocus.current = event.currentTarget;
                        setProjectOpen(true);
                      } else moveSelection(event, index);
                    }}
                    onClick={(event) => {
                      selectFlight(index);
                      // In one column the ticket sits below the whole board,
                      // so a tap there would change something out of sight:
                      // open the briefing instead.
                      if (singleColumn()) {
                        projectReturnFocus.current = event.currentTarget;
                        setProjectOpen(true);
                      }
                    }}
                    aria-controls="selected-project"
                    aria-label={`${item.code}, ${item.name}, ${item.destination.toLowerCase()}, gate ${item.gate}, ${item.status.toLowerCase()}`}
                  >
                    <span className="flight-code mono">{item.code}</span>
                    <span className="flight-destination">
                      <strong>{item.name}</strong>
                      <small className="mono">{item.destination}</small>
                    </span>
                    <span className="flight-gate mono">{item.gate}</span>
                    <span
                      className={`flight-status mono ${item.open ? 'available' : ''}`}
                    >
                      {item.status}
                      <ArrowRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="board-bottom mono">
                <span>
                  <span className="signal-dot" /> BUILT BY HENOK
                </span>
                <span>SELECT A ROW →</span>
              </div>
            </div>
            <Dialog
              open={projectOpen}
              onOpenChange={(open) => {
                setProjectOpen(open);
              }}
            >
              <section
                className="boarding-pass depth-surface"
                data-depth="ticket"
                data-reveal
                id="selected-project"
                aria-label="Selected project"
              >
                <div className="ticket-heading mono">
                  <span>PROJECT PREVIEW</span>
                  <Plane size={18} />
                </div>
                {/* Outside the keyed body, which is replaced on every
                    selection: a live region inserted afresh is not read. */}
                <p className="sr-only" aria-live="polite" aria-atomic="true">
                  {`${flight.name}. ${flight.summary}`}
                </p>
                <div className="ticket-body" key={flight.id}>
                  <DialogTrigger
                    className="ticket-visual-button"
                    aria-label={`Explore ${flight.name}`}
                    onClick={(event) => {
                      projectReturnFocus.current = event.currentTarget;
                    }}
                  >
                    <ProjectPreview flight={flight} />
                    <span className="preview-open">
                      <ArrowRight size={17} />
                    </span>
                  </DialogTrigger>
                  <p className="ticket-flight mono">
                    {flight.code} / {flight.category}
                  </p>
                  <h3>{flight.name}</h3>
                  <p className="ticket-summary">{flight.summary}</p>
                  {flightLive ? (
                    <ProjectUpdate
                      item={flightLive}
                      now={live.now}
                      failed={live.failed}
                    />
                  ) : (
                    // Projects the scheduled check doesn't follow still fill
                    // the same block, so the ticket keeps its height as the
                    // selection moves.
                    <div className="project-live-update">
                      <p className="mono">STATUS · {flight.status}</p>
                      {flight.note && <span>{flight.note}</span>}
                    </div>
                  )}
                  <DialogTrigger
                    className="ticket-button"
                    onClick={(event) => {
                      projectReturnFocus.current = event.currentTarget;
                    }}
                  >
                    View project <ArrowRight size={16} />
                  </DialogTrigger>
                </div>
                <div className="ticket-tear" />
                <div className="ticket-stub">
                  <div className="stub-details">
                    <dl className="stub-fields" key={flight.id}>
                      <div>
                        <dt className="mono">FLIGHT</dt>
                        <dd>
                          <Flap text={flight.code} />
                        </dd>
                      </div>
                      <div>
                        <dt className="mono">GATE</dt>
                        <dd>
                          <Flap text={flight.gate} />
                        </dd>
                      </div>
                      <div>
                        {/* Always a window seat, as the About section says. */}
                        <dt className="mono">SEAT</dt>
                        <dd>
                          <Flap text="1A" />
                        </dd>
                      </div>
                    </dl>
                    <div className="stub-passenger">
                      <span className="mono">PASSENGER</span>
                      <strong>The curious ones.</strong>
                    </div>
                  </div>
                  {/* A real code: a phone camera held up to it opens this
                      project's link. The page around it says the same, so
                      it is hidden from screen readers. */}
                  <svg
                    className="boarding-code"
                    viewBox="-4 -4 41 41"
                    aria-hidden="true"
                    shapeRendering="crispEdges"
                  >
                    <title>{boardingLink(flight.id)}</title>
                    <path d={boardingCodes[flight.id]} />
                  </svg>
                </div>
              </section>
              <DialogContent
                className="project-dialog"
                showCloseButton={false}
                finalFocus={() => {
                  if (projectReturnFocus.current?.isConnected)
                    projectReturnFocus.current.focus({ preventScroll: true });
                  return false;
                }}
              >
                <div className="project-dialog-top mono">
                  <span>
                    <PlaneTakeoff size={17} /> PROJECT BRIEFING
                  </span>
                  <DialogClose
                    className="close-briefing"
                    aria-label="Close project briefing"
                  >
                    <X size={20} />
                  </DialogClose>
                </div>
                <div
                  className={`briefing-body ${flight.image ? 'with-image' : ''}`}
                >
                  <div>
                    <p className="eyebrow briefing-code">
                      {flight.code} / {flight.destination} / GATE {flight.gate}
                    </p>
                    <DialogTitle className="briefing-title">
                      {flight.name}
                    </DialogTitle>
                    <DialogDescription className="briefing-description">
                      {flight.story}
                    </DialogDescription>
                    <ul className="briefing-features">
                      {flight.features.map((feature) => (
                        <li key={feature}>
                          <Check size={16} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <div className="briefing-stack">
                      {flight.stack.map((tech) => (
                        <span className="mono" key={tech}>
                          {tech}
                        </span>
                      ))}
                    </div>
                    {flight.url && (
                      <div className="briefing-actions">
                        <a
                          className="briefing-link"
                          href={flight.url}
                          target={
                            flight.url.startsWith('https://')
                              ? '_blank'
                              : undefined
                          }
                          rel={
                            flight.url.startsWith('https://')
                              ? 'noopener noreferrer'
                              : undefined
                          }
                          onClick={
                            flight.url.startsWith('https://')
                              ? undefined
                              : (event) => {
                                  // The tour is on this page: fly back to it
                                  // rather than reload it. The link stays for
                                  // a new tab, or a page without scripts.
                                  if (event.metaKey || event.ctrlKey) return;
                                  event.preventDefault();
                                  projectReturnFocus.current =
                                    document.querySelector<HTMLElement>(
                                      '.brand',
                                    );
                                  afterClose.current = () =>
                                    scrollTo({
                                      top: 0,
                                      behavior: reducedMotion
                                        ? 'instant'
                                        : 'smooth',
                                    });
                                  setProjectOpen(false);
                                }
                          }
                        >
                          {flight.linkLabel}
                          {flight.url.startsWith('https://') ? (
                            <ArrowUpRight size={18} />
                          ) : (
                            <ArrowUp size={18} />
                          )}
                        </a>
                        {flight.source && (
                          <a
                            className="briefing-source"
                            href={flight.source}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View the source
                            <ArrowUpRight size={18} />
                          </a>
                        )}
                      </div>
                    )}
                    {flight.note && (
                      <p className="hangar-note">
                        <span className="signal-dot" /> {flight.note}
                      </p>
                    )}
                  </div>
                  {flight.image && (
                    <figure
                      className={`briefing-image${flight.image.unframed ? ' unframed' : ''}`}
                    >
                      <picture>
                        <source
                          type="image/avif"
                          srcSet={railSources(flight.image.src, 'avif')}
                          sizes={RAIL_SIZES}
                        />
                        {/* oxlint-disable-next-line next/no-img-element */}
                        <img
                          src={flight.image.src}
                          srcSet={railSources(flight.image.src, 'jpg')}
                          sizes={RAIL_SIZES}
                          loading="lazy"
                          decoding="async"
                          alt={flight.image.alt}
                          width={flight.image.width}
                          height={flight.image.height}
                        />
                      </picture>
                      <figcaption className="mono">
                        {flight.image.caption}
                      </figcaption>
                    </figure>
                  )}
                </div>
                <div className="briefing-footer mono">
                  <span>HENOK ABRAHAM / PERSONAL AIRSPACE</span>
                  <span>{flight.code}</span>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </section>
        {/* The two projects on the board that are not models or repositories
            but sites a visitor can open, so they get their own screenshots
            rather than the briefing's thumbnail rail. */}
        <section
          className="terminal-section"
          id="in-service"
          aria-labelledby="in-service-title"
        >
          <div className="terminal-section-top" data-reveal>
            <div className="terminal-section-label">
              <span className="section-marker">02</span>
              <div>
                <p className="eyebrow">IN SERVICE</p>
                <h2 id="in-service-title">Live on the web.</h2>
              </div>
            </div>
            <p className="terminal-caption">
              {liveSiteCount} aviation data sites, open to anyone.
            </p>
          </div>
          <div className="service-pair" data-reveal>
            {liveSites.map((site) => (
              <article className="service-card" key={site.id}>
                {/* The heading carries the only link, so the card does not
                    repeat the same destination twice for a screen reader. */}
                <picture className="service-shot">
                  <source srcSet={`${site.image}.avif`} type="image/avif" />
                  <img
                    src={`${site.image}.jpg`}
                    alt={site.alt}
                    width={1440}
                    height={665}
                    loading="lazy"
                  />
                </picture>
                <div className="service-body">
                  <h3>
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {site.name}
                      <ArrowUpRight size={18} />
                    </a>
                  </h3>
                  <p className="service-host mono">{site.host}</p>
                  <p className="service-detail">{site.detail}</p>
                  <ProjectUpdate
                    item={live.data?.projects?.projects.find(
                      (item) => item.id === site.id,
                    )}
                    now={live.now}
                    failed={live.failed}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
        <WatchShowcase />
        <AviationLogbook />
        {/* Its scene, like the flight's, waits for the browser's answer. */}
        <GarageSection reducedMotion={reducedMotion || !viewReady} />
        <section
          className="open-hangar"
          data-reveal
          id="open-source"
          aria-labelledby="hangar-title"
        >
          <div className="hangar-intro">
            <p className="eyebrow">OPEN SOURCE</p>
            <h2 id="hangar-title">In the open.</h2>
            <a
              href="https://github.com/hnkabraham?tab=repositories"
              target="_blank"
              rel="noopener noreferrer"
              className="hangar-link"
            >
              GitHub <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="source-list">
            {openSource.map((repo, index) => (
              <a
                href={`https://github.com/hnkabraham/${repo.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="source-row"
                key={repo.repo}
              >
                <span className="source-number mono">0{index + 1}</span>
                <div>
                  <h3>{repo.name}</h3>
                  <p>{repo.detail}</p>
                  <span className="source-stack mono">{repo.stack}</span>
                </div>
                <ArrowUpRight size={21} strokeWidth={1.4} />
              </a>
            ))}
          </div>
        </section>
        <section
          id="about"
          className="about-section"
          data-reveal
          aria-labelledby="about-title"
        >
          <div className="about-heading">
            <p className="eyebrow">ABOUT ME</p>
            <h2 id="about-title">Curiosity, put to work.</h2>
            <figure className="about-window">
              <picture>
                <source srcSet="/images/cruise-sky.avif" type="image/avif" />
                <img
                  src="/images/cruise-sky.jpg"
                  alt="Blue sky above a sunlit cloud deck"
                  width={960}
                  height={640}
                  loading="lazy"
                  decoding="async"
                />
              </picture>
              <figcaption className="mono">
                ALWAYS A WINDOW SEAT <Plane size={16} />
              </figcaption>
            </figure>
          </div>
          <div className="about-story">
            <p>
              I’m Henok. I build iOS apps, wire up the devices around me, and
              put aviation data on the web.
            </p>
            <p className="about-last">
              The best ones started as something I just wanted to look up.
            </p>
            <button
              className="currently-building"
              onClick={(event) => {
                projectReturnFocus.current = event.currentTarget;
                selectFlight(
                  flights.findIndex((item) => item.id === 'downshift'),
                );
                setProjectOpen(true);
              }}
            >
              <span className="eyebrow">
                <span className="signal-dot" />
                CURRENTLY BUILDING
              </span>
              <strong>
                Downshift <ArrowRight size={18} />
              </strong>
              <span>
                An iOS driving companion for live car data and better shifts.
              </span>
            </button>
            <a className="hangar-link" href="#contact">
              Say hello <ArrowDown size={16} />
            </a>
          </div>
        </section>
        <section
          className="contact-section"
          id="contact"
          data-reveal
          aria-labelledby="contact-title"
        >
          <div className="contact-top mono">
            <span>
              <Radio size={15} /> GET IN TOUCH
            </span>
            <span>OPEN FREQUENCY</span>
          </div>
          <div className="contact-main">
            <div className="contact-intro">
              <h2 id="contact-title">
                Say <em>hello.</em>
              </h2>
              <a
                className="contact-link"
                href="https://github.com/hnkabraham"
                target="_blank"
                rel="noopener noreferrer"
              >
                <CodeXml size={20} />
                <span>
                  Find me on GitHub<small>@hnkabraham</small>
                </span>
                <ArrowUpRight size={24} />
              </a>
            </div>
            <ContactTower />
          </div>
          <div className="contact-bottom mono">
            <span>THANKS FOR STOPPING BY.</span>
            <a href="#flight">BACK TO TOP ↑</a>
          </div>
        </section>
      </main>
      <footer className="site-footer mono" id="footer">
        <button
          className="credits-link"
          onClick={toggleView}
          aria-pressed={reducedMotion}
          disabled={!viewReady}
        >
          Simple view {reducedMotion ? 'on' : 'off'}
        </button>
        {/* The server renders in UTC; the browser's own year differs from it
            for a few hours around New Year, and the mismatch would make React
            discard the server's HTML. */}
        <span>© {new Date().getUTCFullYear()} HENOK ABRAHAM</span>
        <span>HENOKABRAHAM.COM</span>
        <Dialog>
          <DialogTrigger className="credits-link">
            Privacy &amp; performance
          </DialogTrigger>
          <DialogContent className="credits-dialog">
            <DialogTitle>Privacy &amp; performance</DialogTitle>
            <DialogDescription>
              Cloudflare Web Analytics measures page performance. A few
              anonymous measurements help improve the 3D aircraft tour: loading
              time, frame rate, asset failures, and project selections. Custom
              measurements contain no visitor identifier, IP address, or message
              text. These measurements respect Do Not Track and Global Privacy
              Control. Contact details are sent only to Henok’s inbox; Turnstile
              checks submissions for spam. Your Simple view preference stays in
              this browser.
            </DialogDescription>
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Cloudflare’s privacy policy <ArrowUpRight size={14} />
            </a>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger className="credits-link">
            Aircraft &amp; sky credits
          </DialogTrigger>
          <DialogContent className="credits-dialog">
            <DialogTitle>Aircraft &amp; sky credits</DialogTitle>
            <DialogDescription>
              Boeing 787-9 and GEnx exterior adapted from the FlightGear
              787-family project, GPL-2.0, with a personal livery. Editable
              aircraft sources, conversion script, and license are included.
              Daylight reflections: Greg Zaal and Jarod Guest, Poly Haven, CC0.
              Sky and cloud artwork generated for this portfolio.
            </DialogDescription>
            <a
              href="/credits/dreamliner"
              target="_blank"
              rel="noopener noreferrer"
            >
              Full sources, licenses, and scene notes <ArrowUpRight size={14} />
            </a>
          </DialogContent>
        </Dialog>
      </footer>
    </div>
  );
}
