'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Plane,
  PlaneTakeoff,
  CodeXml,
  Check,
  X,
  Compass,
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
  LiveAtSfo,
  ProjectUpdate,
  SourceUpdate,
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
  const flight = flights[selected];
  const root = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [entry, setEntry] = useState<{ chapter: BayPhase | null } | null>(null);
  useAirspaceDepth(root, !reducedMotion);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
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
          <a href="#about">
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
        <ScrollDeparture reducedMotion={reducedMotion} entry={entry} />
        <LiveAtSfo {...live} />
        <section
          className="terminal-section"
          id="departures"
          aria-labelledby="departures-title"
        >
          <div className="terminal-section-top" data-reveal>
            <div className="terminal-section-label">
              <span className="section-marker">01</span>
              <div>
                <p className="eyebrow">CHOOSE YOUR NEXT STOP</p>
                <h2 id="departures-title">Departures</h2>
              </div>
            </div>
            <p className="terminal-caption">
              Every project starts with a little “what if.”
              <br />
              Pick a destination. See where it went.
            </p>
          </div>
          <div className="departure-layout">
            <div
              className="departure-board depth-surface"
              data-depth="board"
              data-reveal
            >
              <div className="board-title">
                <span>
                  <PlaneTakeoff size={20} /> PROJECT DEPARTURES
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
                role="group"
                aria-label="Choose a project"
              >
                {flights.map((item, index) => (
                  <button
                    key={item.id}
                    className={`flight-row ${selected === index ? 'selected' : ''}`}
                    onClick={() => selectFlight(index)}
                    aria-pressed={selected === index}
                    aria-controls="selected-project"
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
              </div>
              <div className="board-bottom mono">
                <span>
                  <span className="signal-dot" /> ALL DEPARTURES ARE PERSONAL
                  PROJECTS
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
                  <span>YOUR NEXT DESTINATION</span>
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
                  <div className="ticket-route">
                    <div>
                      <small className="mono">FROM</small>
                      <strong>IDEA</strong>
                    </div>
                    <div className="ticket-route-line">
                      <span />
                      <Plane size={20} />
                      <span />
                    </div>
                    <div>
                      <small className="mono">GATE</small>
                      <strong>{flight.gate}</strong>
                    </div>
                  </div>
                  <ProjectUpdate
                    item={live.data?.projects?.projects.find(
                      (item) => item.id === flight.id,
                    )}
                    now={live.now}
                  />
                  <DialogTrigger className="ticket-button">
                    Explore this project <ArrowRight size={16} />
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
              <DialogContent className="project-dialog" showCloseButton={false}>
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
                      <img
                        src={flight.image}
                        alt="Downshift’s simulated driving dashboard with RPM and shift coaching"
                        width={414}
                        height={900}
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
        <AviationLogbook
          onProject={(id) => {
            const index = flights.findIndex((item) => item.id === id);
            if (index < 0) return;
            selectFlight(index);
            setProjectOpen(true);
          }}
        />
        <section
          className="open-hangar"
          data-reveal
          id="open-source"
          aria-labelledby="hangar-title"
        >
          <div className="hangar-intro">
            <p className="eyebrow">THE HANGAR DOORS ARE OPEN</p>
            <h2 id="hangar-title">
              Take a look
              <br />
              under the cowling.
            </h2>
            <a
              href="https://github.com/hnkabraham?tab=repositories"
              target="_blank"
              rel="noopener noreferrer"
              className="hangar-link"
            >
              All public repositories <ArrowUpRight size={16} />
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
                  <SourceUpdate
                    item={live.data?.projects?.projects.find(
                      (item) => item.repo === repo.repo,
                    )}
                  />
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
            <p className="eyebrow">
              <span className="section-marker">02</span> THE FLIGHT LOG
            </p>
            <h2 id="about-title">
              Good things happen
              <br />
              when you follow
              <br />
              <em>your curiosity.</em>
            </h2>
            <div className="crew-signature">
              <span className="brand-symbol">
                <Compass size={22} strokeWidth={1.4} />
              </span>
              <span>
                Henok Abraham
                <small>DEVELOPER · BUILDER · AVIATION ENTHUSIAST</small>
              </span>
            </div>
          </div>
          <div className="about-story">
            <p>
              My projects tend to start where things don’t quite connect. A
              watch and a phone from different ecosystems. A car full of data
              that’s hard to use. A 3D model that still needs to become a real
              object.
            </p>
            <p>
              I like getting into those gaps and building something useful. That
              takes me from native iOS apps and Bluetooth protocols to web
              experiences, 3D tools, and the servers that keep them running.
            </p>
            <p className="about-last">
              Aviation is one of the threads connecting it all: complex systems,
              small details, and the possibility of going somewhere new.
            </p>
            <div
              className="flight-process mono"
              aria-label="My process: curiosity, build, test, repeat"
            >
              <span>CURIOSITY</span>
              <ArrowRight size={13} />
              <span>BUILD</span>
              <ArrowRight size={13} />
              <span>TEST</span>
              <ArrowRight size={13} />
              <span>REPEAT</span>
            </div>
          </div>
        </section>
        <section
          className="contact-section"
          data-reveal
          aria-labelledby="contact-title"
        >
          <div className="contact-top mono">
            <span>
              <Radio size={15} /> TOWER, THIS IS HENOK.
            </span>
            <span>OPEN FREQUENCY</span>
          </div>
          <div className="contact-main">
            <div className="contact-intro">
              <h2 id="contact-title">
                The next great thing
                <br />
                starts with a <em>hello.</em>
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
            <span>THANK YOU FOR FLYING THROUGH.</span>
            <a href="#flight">BACK TO THE RUNWAY ↑</a>
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
              anonymous measurements help improve the 3D departure: loading
              time, frame rate, scenery failures, and project selections. Custom
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
              Boeing 787-9 by Nobilis2, CC BY 4.0. Optimized model with added
              animated landing gear. Bay imagery contains modified Copernicus
              Sentinel data (2019), processed by ESA, cropped and resized under
              CC BY-SA 3.0 IGO. Elevation: Mapzen / USGS / NOAA. Daylight: Greg
              Zaal and Jarod Guest, Poly Haven, CC0.
            </DialogDescription>
            <a
              href="/credits/scene-credits.html"
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
