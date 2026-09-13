'use client';

import { useEffect, useRef, useState } from 'react';
import IPhoneMockup from './iphone-mockup';
import {
  ArrowRight,
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
import { flights, openSource } from './flight-data';
import { readFlightLink, replaceFlightLink } from '@/lib/flight-links';
import type { BayPhase } from '@/lib/bay-flight';
import AviationLogbook from './aviation-logbook';
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

function StationClock() {
  const [time, setTime] = useState('--:--:--');
  useEffect(() => {
    const update = () => setTime(new Date().toISOString().slice(11, 19));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <div className="station-clock mono" aria-label={`Current UTC time ${time}`}>
      <span className="signal-dot" />
      <time>{time}</time>
      <span>UTC</span>
    </div>
  );
}

export default function TerminalExperience() {
  const live = useAirportLive();
  const [selected, setSelected] = useState(0);
  const [projectOpen, setProjectOpen] = useState(false);
  const projectReturnFocus = useRef<HTMLElement | null>(null);
  const flight = flights[selected];
  const root = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [entry, setEntry] = useState<{ chapter: BayPhase | null } | null>(null);
  useAirspaceDepth(root, !reducedMotion);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    // The tour costs a couple of megabytes; a visitor who asked their browser
    // to save data, or is on a 2G-class link, gets the static sky instead.
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const metered =
      Boolean(connection?.saveData) ||
      /^(slow-)?2g$/.test(connection?.effectiveType ?? '');
    const update = () => setReducedMotion(preference.matches || metered);
    update();
    preference.addEventListener('change', update);
    const restore = () => {
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
    };
    restore();
    addEventListener('popstate', restore);
    return () => {
      preference.removeEventListener('change', update);
      removeEventListener('popstate', restore);
    };
  }, []);
  const selectFlight = (index: number) => {
    setSelected(index);
    recordFlightMetric('project_open', 1);
    replaceFlightLink({ project: flights[index].id });
  };

  return (
    <div className="airport" ref={root} data-motion={!reducedMotion}>
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
          <a href="#logbook">
            <span className="nav-number">02</span> Flight log
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
        <ScrollDeparture
          reducedMotion={reducedMotion}
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
              <fieldset className="flight-list" aria-label="Choose a project">
                {flights.map((item, index) => (
                  <button
                    key={item.id}
                    className={`flight-row ${selected === index ? 'selected' : ''}`}
                    onClick={() => selectFlight(index)}
                    aria-pressed={selected === index}
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
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </fieldset>
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
              <aside
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
                <div className="ticket-body" key={flight.id}>
                  <p className="ticket-flight mono">
                    {flight.code} / {flight.category}
                  </p>
                  <div aria-live="polite" aria-atomic="true">
                    <h3>{flight.name}</h3>
                    <p className="ticket-summary">{flight.summary}</p>
                  </div>
                  <ProjectUpdate
                    item={live.data?.projects?.projects.find(
                      (item) => item.id === flight.id,
                    )}
                    now={live.now}
                  />
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
                  <div>
                    <span className="mono">PASSENGER</span>
                    <strong>The curious ones.</strong>
                  </div>
                  <div className="barcode" aria-hidden="true" />
                </div>
              </aside>
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
                    {flight.url ? (
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
                      >
                        {flight.linkLabel}
                        <ArrowUpRight size={18} />
                      </a>
                    ) : (
                      <p className="hangar-note">
                        <span className="signal-dot" />{' '}
                        {flight.status === 'IN DEVELOPMENT'
                          ? 'In development. More to come.'
                          : 'A personal project, still in the hangar.'}
                      </p>
                    )}
                  </div>
                  {flight.image && (
                    <figure className="briefing-image">
                      <IPhoneMockup
                        src={flight.image}
                        alt="Downshift’s simulated driving dashboard with RPM and shift coaching, running on an iPhone 17 Pro"
                        width={690}
                        height={1500}
                      />
                      <figcaption className="mono">SIMULATOR MODE</figcaption>
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
        <AviationLogbook />
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
          </div>
          <div className="about-story">
            <p>
              I’m Henok. I build apps, connect devices, and make things in 3D.
            </p>
            <p className="about-last">
              Usually chasing a good idea. Occasionally a window seat.
            </p>
            <a className="hangar-link" href="#contact">
              Say hello <ArrowUpRight size={16} />
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
      <footer className="site-footer mono">
        <span>© {new Date().getFullYear()} HENOK ABRAHAM</span>
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
              checks submissions for spam.
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
          <DialogTrigger className="credits-link">Scene credits</DialogTrigger>
          <DialogContent className="credits-dialog">
            <DialogTitle>Scene credits</DialogTitle>
            <DialogDescription>
              Boeing 787-9 and GEnx exterior adapted from the FlightGear
              787-family project, GPL-2.0, with a personal livery. Editable
              aircraft sources, conversion script and license are included.
              Daylight reflections: Greg Zaal and Jarod Guest, Poly Haven, CC0.
              Sky and cloud artwork generated for this portfolio.
            </DialogDescription>
            <a
              href="/credits/dreamliner.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Full sources, licenses and scene notes <ArrowUpRight size={14} />
            </a>
          </DialogContent>
        </Dialog>
      </footer>
    </div>
  );
}
