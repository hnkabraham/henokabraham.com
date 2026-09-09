import {
  ArrowDown,
  ArrowUpRight,
  CodeXml,
  Plus,
  Box,
  Scan,
  Bluetooth,
  Terminal,
  Gauge,
} from 'lucide-react';

function ProjectMap() {
  return (
    <div className="project-map">
      <svg
        className="map-svg"
        viewBox="0 0 560 560"
        role="group"
        aria-labelledby="map-title map-desc"
      >
        <title id="map-title">A map of my projects</title>
        <desc id="map-desc">
          Explore Downshift, United Flight Tracker, and my open-source hardware
          bridge.
        </desc>
        <g className="map-grid">
          <circle cx="280" cy="280" r="224" />
          <circle cx="280" cy="280" r="170" />
          <circle cx="280" cy="280" r="107" />
          <path
            className="map-faint"
            d="M280 25V535M25 280H535M100 100L460 460M100 460L460 100"
          />
        </g>
        <g className="orbit-motion">
          <circle className="map-track" cx="280" cy="280" r="201" />
          <circle className="map-point" cx="280" cy="79" r="3" />
          <circle fill="#647c43" cx="280" cy="481" r="3" />
        </g>
        <path
          className="map-track"
          d="M280 280L171 160M280 280L428 250M280 280L206 430"
        />
        <circle className="map-core" cx="280" cy="280" r="45" />
        <text className="map-core-label" x="278" y="291" textAnchor="middle">
          h.a
        </text>
        <text className="map-small" x="280" y="351" textAnchor="middle">
          ALWAYS CONNECTING DOTS
        </text>
        <a
          href="#downshift"
          className="map-link"
          aria-label="Explore Downshift"
        >
          <rect
            className="map-node"
            x="106"
            y="136"
            width="130"
            height="47"
            rx="24"
          />
          <circle cx="125" cy="160" r="3" fill="#d4fa82" />
          <text className="map-label" x="139" y="165">
            Downshift
          </text>
        </a>
        <a
          href="#flight-tracker"
          className="map-link"
          aria-label="Explore United Flight Tracker"
        >
          <rect
            className="map-node"
            x="350"
            y="225"
            width="156"
            height="47"
            rx="24"
          />
          <circle cx="369" cy="249" r="3" fill="#9dbcea" />
          <text className="map-label" x="382" y="254">
            Flight tracker
          </text>
        </a>
        <a
          href="#open-source"
          className="map-link"
          aria-label="Explore the iPhone and Wear OS bridge"
        >
          <rect
            className="map-node"
            x="128"
            y="406"
            width="158"
            height="47"
            rx="24"
          />
          <circle cx="147" cy="430" r="3" fill="#c5a0df" />
          <text className="map-label" x="160" y="435">
            iOS ↔ Wear OS
          </text>
        </a>
        <path
          className="map-cross"
          d="M277 56H283M280 53V59M501 280H507M504 277V283M53 280H59M56 277V283M277 504H283M280 501V507"
        />
        <text className="map-small" x="280" y="35" textAnchor="middle">
          IDEAS → EXPERIMENTS → REAL THINGS
        </text>
      </svg>
    </div>
  );
}

function FlightRoutes() {
  return (
    <div className="project-visual flight-visual">
      <span className="visual-corner mono">
        AN INDEPENDENT AVIATION PROJECT
      </span>
      <span className="project-number mono">/ 02</span>
      <div className="flight-title">
        A world
        <br />
        in motion.
        <ArrowUpRight size={38} strokeWidth={1} />
      </div>
      <svg
        className="flight-routes"
        viewBox="0 0 480 165"
        role="img"
        aria-label="A schematic connecting United hubs San Francisco, Denver, and Newark"
      >
        <g fill="none" stroke="#344650" strokeWidth="1">
          <path
            d="M0 140H480M0 90H480M0 40H480M40 0V165M120 0V165M200 0V165M280 0V165M360 0V165M440 0V165"
            opacity=".4"
          />
          <path
            d="M45 113Q140 4 237 90T429 62"
            stroke="#799fac"
            strokeDasharray="3 5"
          />
          <path d="M45 113Q227 -40 429 62" stroke="#617a85" />
        </g>
        <g fill="#b8d8db" stroke="#172c34" strokeWidth="5">
          <circle cx="45" cy="113" r="6" />
          <circle cx="237" cy="90" r="6" />
          <circle cx="429" cy="62" r="6" />
        </g>
        <g fill="#c0d5d7" fontSize="12" fontFamily="monospace">
          <text x="45" y="142" textAnchor="middle">
            SFO
          </text>
          <text x="237" y="119" textAnchor="middle">
            DEN
          </text>
          <text x="429" y="91" textAnchor="middle">
            EWR
          </text>
        </g>
      </svg>
      <span className="route-caption mono">HUB CONNECTIONS / SCHEMATIC</span>
    </div>
  );
}

const repositories = [
  {
    name: 'iPhone ↔ Wear OS',
    repo: 'wear-ios-bridge',
    description:
      'An encrypted Bluetooth bridge for notifications, health, and music across platforms.',
    language: 'Swift / Kotlin',
    icon: Bluetooth,
  },
  {
    name: 'OBDEngine',
    repo: 'swift-obd-engine',
    description:
      'A Swift package for talking to real vehicles, with diagnostics and a built-in simulator.',
    language: 'Swift',
    icon: Gauge,
  },
  {
    name: 'Mobile Mode',
    repo: 'claude-code-mobile-mode',
    description:
      'Tappable choices and push notifications for phone-driven Claude Code sessions.',
    language: 'Developer tooling',
    icon: Terminal,
  },
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="header">
          <a className="brand" href="#" aria-label="Henok Abraham, home">
            <span className="brand-mark" aria-hidden="true">
              h.a
            </span>
            Henok Abraham
          </a>
          <nav className="nav" aria-label="Main navigation">
            <a href="#work">Work</a>
            <a href="#about">About</a>
            <a
              className="github-link external"
              href="https://github.com/hnkabraham"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Henok Abraham on GitHub, opens in a new tab"
            >
              <CodeXml size={15} />
              <span className="github-label">GitHub</span>
              <ArrowUpRight size={14} />
            </a>
          </nav>
        </header>
        <main id="main">
          <section className="hero" aria-labelledby="hero-heading">
            <div className="hero-copy">
              <p className="eyebrow hero-kicker">
                <span className="status-dot" />A personal workshop
              </p>
              <h1 id="hero-heading">
                Built from
                <br />
                <span>curiosity.</span>
              </h1>
              <p className="hero-description">
                I’m <strong>Henok</strong>. I build apps, connect unlikely
                things, and follow interesting problems wherever they lead.
              </p>
              <a className="primary-link" href="#work">
                Explore my work <ArrowDown />
              </a>
            </div>
            <ProjectMap />
            <span className="hero-index mono">01 — A FEW CONNECTED DOTS</span>
          </section>
          <div className="interest-strip mono" aria-label="Areas I build in">
            <span className="eyebrow strip-label">Currently in my orbit</span>
            <span className="interest">iOS & SWIFT</span>
            <span className="plus">+</span>
            <span className="interest">AVIATION</span>
            <span className="plus">+</span>
            <span className="interest">CONNECTED HARDWARE</span>
            <span className="plus">+</span>
            <span className="interest">3D & MAKING</span>
          </div>
          <section
            className="work-section"
            id="work"
            aria-labelledby="work-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">01 / Selected work</p>
                <h2 id="work-heading">Ideas, out in the world.</h2>
              </div>
              <p className="section-note">
                A few things I’ve been turning
                <br />
                from “what if” into working software.
              </p>
            </div>
            <div className="project-grid">
              <article className="project-card" id="downshift">
                <div className="project-visual downshift-visual">
                  <span className="visual-corner mono">
                    A BETTER FEEL FOR THE DRIVE
                  </span>
                  <span className="project-number mono">/ 01</span>
                  <div className="downshift-wordmark">
                    Downshift<small>Find your next gear.</small>
                  </div>
                  <img
                    className="phone-shot"
                    src="/images/downshift-dashboard.jpg"
                    alt="Downshift iOS dashboard showing simulated RPM, shift lights, and gear coaching"
                    width="414"
                    height="900"
                  />
                </div>
                <div className="project-info">
                  <div className="project-meta">
                    <span className="project-type mono">iOS / AUTOMOTIVE</span>
                    <span className="project-status mono">
                      Personal project
                    </span>
                  </div>
                  <h3>Downshift</h3>
                  <p>
                    A driving companion that turns live vehicle data into shift
                    coaching, diagnostics, and performance telemetry.
                  </p>
                  <details className="project-details">
                    <summary>
                      Under the hood <Plus size={16} />
                    </summary>
                    <p>
                      Built with SwiftUI and OBD-II connectivity. Includes shift
                      quality scoring, session recording, lap timing, and a
                      simulator for exploring the app without a car. The image
                      above shows that simulator.
                    </p>
                  </details>
                </div>
              </article>
              <article className="project-card" id="flight-tracker">
                <FlightRoutes />
                <div className="project-info">
                  <div className="project-meta">
                    <span className="project-type mono">WEB / AVIATION</span>
                    <span className="project-status mono">
                      <span className="status-dot" />
                      Public website
                    </span>
                  </div>
                  <h3>United Flight Tracker</h3>
                  <p>
                    A live view of an airline network, with a 3D globe, flight
                    tracking, fleet insights, and airport operations.
                  </p>
                  <a
                    className="project-link"
                    href="https://unitedflighttracker.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Explore the live project <ArrowUpRight size={17} />
                  </a>
                </div>
              </article>
            </div>
            <div className="workbench-heading">
              <span className="eyebrow">Also on the workbench</span>
              <span className="workbench-line" />
            </div>
            <div className="workbench-grid">
              <article className="experiment">
                <div className="experiment-icon violet">
                  <Box size={25} strokeWidth={1.5} />
                </div>
                <div className="experiment-copy">
                  <div className="experiment-title">
                    <h3>SpoolBrush</h3>
                    <span className="mini-tag mono">ALPHA</span>
                  </div>
                  <p>
                    From bare 3D meshes to multicolor print plans. A local
                    workbench for assigning surfaces to the filament you
                    actually own.
                  </p>
                  <span className="experiment-stack mono">
                    Python · Three.js · 3MF
                  </span>
                </div>
              </article>
              <article className="experiment">
                <div className="experiment-icon peach">
                  <Scan size={25} strokeWidth={1.5} />
                </div>
                <div className="experiment-copy">
                  <div className="experiment-title">
                    <h3>SpatialScanner</h3>
                    <span className="mini-tag mono">IN DEVELOPMENT</span>
                  </div>
                  <p>
                    Exploring the space between the physical and digital, with
                    iPhone capture, 3D reconstruction, and local model exports.
                  </p>
                  <span className="experiment-stack mono">
                    Flutter · ARKit · Metal
                  </span>
                </div>
              </article>
            </div>
          </section>
          <section
            className="source-section"
            id="open-source"
            aria-labelledby="source-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / Out in the open</p>
                <h2 id="source-heading">Built to be pulled apart.</h2>
              </div>
              <a
                className="text-link external"
                href="https://github.com/hnkabraham?tab=repositories"
                target="_blank"
                rel="noopener noreferrer"
              >
                All public repositories <ArrowUpRight size={16} />
              </a>
            </div>
            <div className="repo-list">
              {repositories.map(
                ({ name, repo, description, language, icon: Icon }, index) => (
                  <a
                    className="repo-row"
                    key={repo}
                    href={`https://github.com/hnkabraham/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="repo-index mono">0{index + 1}</span>
                    <div className="repo-icon">
                      <Icon size={23} strokeWidth={1.5} />
                    </div>
                    <div className="repo-copy">
                      <h3>{name}</h3>
                      <p>{description}</p>
                    </div>
                    <span className="repo-language mono">{language}</span>
                    <ArrowUpRight
                      className="repo-arrow"
                      size={21}
                      strokeWidth={1.5}
                    />
                  </a>
                ),
              )}
            </div>
          </section>
          <section
            className="about-section"
            id="about"
            aria-labelledby="about-heading"
          >
            <div className="about-intro">
              <p className="eyebrow">03 / The person behind the projects</p>
              <h2 id="about-heading">
                A little software.
                <br />A little hardware.
                <br />
                <span>A lot of curiosity.</span>
              </h2>
              <div className="about-signature">
                <span className="brand-mark" aria-hidden="true">
                  h.a
                </span>
                <span>Henok Abraham</span>
              </div>
            </div>
            <div className="about-copy">
              <p>
                My projects tend to start where things don’t quite connect. A
                watch and a phone from different ecosystems. A car full of data
                that’s hard to use. A 3D model that still needs to become a real
                object.
              </p>
              <p>
                I like getting into those gaps and building something useful.
                That takes me from native iOS apps and Bluetooth protocols to
                web experiences, 3D tools, and the servers that keep them
                running.
              </p>
              <p className="about-closing">
                This is my corner of the internet to put those things together.
              </p>
              <div className="about-tags">
                <span>Native apps</span>
                <span>Useful experiments</span>
                <span>Self-hosted things</span>
              </div>
            </div>
          </section>
        </main>
        <footer className="footer">
          <div className="footer-main">
            <div>
              <p className="eyebrow">
                There’s always another interesting problem.
              </p>
              <a
                className="footer-link"
                href="https://github.com/hnkabraham"
                target="_blank"
                rel="noopener noreferrer"
              >
                Let’s connect.
                <ArrowUpRight strokeWidth={1.2} />
              </a>
            </div>
            <a
              className="footer-github external"
              href="https://github.com/hnkabraham"
              target="_blank"
              rel="noopener noreferrer"
            >
              <CodeXml size={18} />
              Find me on GitHub
              <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="footer-bottom mono">
            <span>© {new Date().getFullYear()} Henok Abraham</span>
            <span className="footer-domain">henokabraham.com</span>
            <a href="#">Back to top ↑</a>
          </div>
        </footer>
      </div>
    </>
  );
}
