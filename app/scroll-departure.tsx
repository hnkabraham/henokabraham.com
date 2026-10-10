'use client';
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowDown,
  ArrowRight,
  Globe2,
  LayoutGrid,
  Check,
  Maximize2,
  Minimize2,
  RotateCcw,
  Smartphone,
  Watch,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { BayPhase } from '@/lib/bay-flight';
import SceneBoundary from './scene-boundary';
// The renderer, its shader helpers and their slice of three.js arrive in a
// chunk of their own, fetched only once a motion visit mounts the scene.
const DreamlinerScene = lazy(() => import('./dreamliner-scene'));

// A browser never hides its own bars for a page; a tap into the Fullscreen
// API does (iPhone Safari since 16.4, with the webkit names), and a Home
// Screen launch has none to hide, so the control stays out of the way there.
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};
const subscribeFullscreen = (notify: () => void) => {
  document.addEventListener('fullscreenchange', notify);
  document.addEventListener('webkitfullscreenchange', notify);
  return () => {
    document.removeEventListener('fullscreenchange', notify);
    document.removeEventListener('webkitfullscreenchange', notify);
  };
};
const readImmersive = () => {
  const d = document as FullscreenDocument;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
};
// What the Immersive control can do here: enter fullscreen where the API
// exists (desktop, Android, iPad), or on an iPhone, where WebKit has never
// let a page fill the screen (WebKit bug 206854), explain the one route
// that does, a Home Screen launch. From the Home Screen there is nothing
// left to hide.
type ImmersiveMode = 'none' | 'fullscreen' | 'install';
const readImmersiveMode = (): ImmersiveMode => {
  const d = document as FullscreenDocument;
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'none';
  if (d.fullscreenEnabled || d.webkitFullscreenEnabled) return 'fullscreen';
  return /iPhone|iPod/.test(navigator.userAgent) ? 'install' : 'none';
};
const never = () => false;
const noMode = (): ImmersiveMode => 'none';
function toggleImmersive() {
  const d = document as FullscreenDocument;
  const root = document.documentElement as FullscreenRoot;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    if (d.exitFullscreen) void d.exitFullscreen().catch(() => {});
    else d.webkitExitFullscreen?.();
  } else if (root.requestFullscreen) {
    void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } else root.webkitRequestFullscreen?.();
}
import {
  TOUR_CHAPTERS,
  applyTourPreset,
  appsPacing,
  chapterLanding,
  tourPhase,
} from '@/lib/dreamliner-tour';
import {
  tourScrollLayout,
  tourProgressAt,
  tourScrollAt,
  type TourScroll,
} from '@/lib/tour-scroll';
import { recordFlightMetric } from '@/lib/flight-metrics';
import { openingSkyReveal } from '@/lib/bay-performance';
import { createOpeningWipe, type OpeningWipe } from '@/lib/opening-wipe';
import { flightAtlas } from './flight-atlas';

const copy: Record<BayPhase, [string, string, string]> = {
  preflight: [
    'NOW BOARDING',
    'A different\nperspective.',
    'Developer. Maker. Aviation enthusiast.',
  ],
  roll: ['LEG 1 / APPS', 'Downshift.', 'Live car data. Better shifts.'],
  liftoff: [
    'LEG 2 / CONNECTED DEVICES',
    'iPhone ↔\nWear OS.',
    'Different ecosystems. Connected.',
  ],
  bay: [
    'LEG 3 / AWAY FROM THE KEYBOARD',
    'A few miles\nof memories.',
    'My personal flight log.',
  ],
  cruise: [
    'LEG 4 / KEEP EXPLORING',
    'Made with\ncuriosity.',
    'Explore the rest.',
  ],
};

// The story text a word to a box, so the renderer can rasterize each word
// where the page draws it and let the aircraft pass through it. A word is
// the smallest unit that still shapes the way the page does: split further,
// to a box a letter, and a ligature (the "tt" of "Better", the "ff" of
// "different") collapses one span to nothing and its glyph never reaches
// the mask. Spaces and line breaks stay as text, so the lines wrap as they
// did, and screen readers get the plain text — the heading's label, a hidden
// copy in the paragraphs.
function cutText(text: string) {
  return text.split('\n').map((line, l) => (
    <span key={l}>
      {l > 0 && '\n'}
      {line.split(' ').map((word, w) => (
        <Fragment key={w}>
          {w > 0 && ' '}
          <span className="cut-word" data-cut="">
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  ));
}

// The stylesheet's phone breakpoint, which places the Apps preview lower.
const phoneLayout = () => matchMedia('(max-width: 800px)').matches;
// The CSS adds scroll distance only to Apps. Cache its resolved pacing until
// the section or browser viewport changes, not on every scroll event.
function measureScroll(section: HTMLElement, previous: TourScroll | null) {
  const height = section.offsetHeight;
  if (
    previous?.height === height &&
    previous.viewport === innerHeight &&
    previous.width === innerWidth
  )
    return previous;
  const style = getComputedStyle(section);
  return tourScrollLayout(
    height,
    innerHeight,
    parseFloat(style.getPropertyValue('--apps-read-scroll')) || 0,
    parseFloat(style.getPropertyValue('--apps-sweep-scroll')) || 0,
    appsPacing(innerWidth / innerHeight, phoneLayout()),
    innerWidth,
  );
}

// In development `?tour=<preset>` tries an Apps pacing/wipe variant; the
// production build has one tour. Applied before any layout is measured.
const devPreset =
  process.env.NODE_ENV !== 'production'
    ? () => applyTourPreset(new URLSearchParams(location.search).get('tour'))
    : () => {};

function updateOpening(
  section: HTMLElement,
  scroll: number,
  staticSky: boolean,
) {
  const reveal = staticSky ? 0 : openingSkyReveal(scroll);
  section.style.setProperty('--flight-reveal', String(reveal));
  section.dataset.opening = String(reveal < 1);
  return reveal;
}

export default function ScrollDeparture({
  reducedMotion,
  viewReady,
  onToggleView,
  entry,
  onProject,
  paused = false,
}: {
  reducedMotion: boolean;
  viewReady: boolean;
  onToggleView: () => void;
  entry: { chapter: BayPhase | null } | null;
  onProject: (id: string) => void;
  paused?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const story = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const scrollLayout = useRef<TourScroll | null>(null);
  const reveal = useRef(0);
  const tailWipe = useRef<OpeningWipe | null>(null);
  const openingWipe = useRef<OpeningWipe | null>(null);
  const renderedPhase = useRef<BayPhase>('preflight');
  const [phase, setPhase] = useState<BayPhase>('preflight');
  const [rendererStatus, setStatus] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  // Reduced motion never mounts the renderer; the static sky is ready at once.
  const status = reducedMotion ? 'ready' : rendererStatus;
  const [sceneReady, setSceneReady] = useState(false);
  // A lost WebGL context mounts a fresh scene under a new key; a real
  // failure collapses the tour to its static sky, and `place` keeps the
  // visitor where they were across that change in page height.
  const [sceneKey, setSceneKey] = useState(0);
  const losses = useRef(0);
  const resume = useRef<(() => void) | null>(null);
  const place = useRef<{ id: string; top: number } | null>(null);
  const immersive = useSyncExternalStore(
    subscribeFullscreen,
    readImmersive,
    never,
  );
  const immersiveMode = useSyncExternalStore(
    subscribeFullscreen,
    readImmersiveMode,
    noMode,
  );
  useLayoutEffect(devPreset, []);
  useLayoutEffect(() => {
    const section = root.current;
    if (!section || !entry) return;
    const layout = measureScroll(section, scrollLayout.current);
    scrollLayout.current = layout;
    const rect = section.getBoundingClientRect();
    const chapter = TOUR_CHAPTERS.find((item) => item.phase === entry.chapter);
    let offset = Math.max(0, Math.min(layout.travel, -rect.top));
    if (chapter && !reducedMotion) {
      offset = tourScrollAt(
        chapterLanding(chapter, innerWidth / innerHeight, phoneLayout()),
        layout,
      );
      scrollTo({ top: scrollY + rect.top + offset, behavior: 'instant' });
    }
    progress.current = reducedMotion ? 0 : tourProgressAt(offset, layout);
    reveal.current = updateOpening(section, offset, reducedMotion);
    renderedPhase.current = tourPhase(
      progress.current,
      innerWidth / innerHeight,
    );
    setPhase(renderedPhase.current);
    // Mount the renderer only after the shared chapter has seeded its ref.
    setSceneReady(true);
  }, [entry, reducedMotion]);
  useLayoutEffect(() => {
    const tail = createOpeningWipe('up');
    const wipe = createOpeningWipe();
    tailWipe.current = tail;
    openingWipe.current = wipe;
    return () => {
      tail.dispose();
      wipe.dispose();
      tailWipe.current = null;
      openingWipe.current = null;
    };
  }, []);
  // Both captions stay erased behind their passing surface. No glyph-depth
  // mask: erased letters must never leave ghost holes in the aircraft.
  useLayoutEffect(() => {
    tailWipe.current?.attach(
      phase === 'roll' && !reducedMotion && status !== 'unavailable'
        ? story.current
        : null,
    );
    openingWipe.current?.attach(
      phase === 'preflight' && !reducedMotion && status !== 'unavailable'
        ? story.current
        : null,
    );
  }, [phase, sceneReady, status, reducedMotion]);
  useEffect(() => {
    const section = root.current;
    if (!section) return;
    let visible = true;
    const activity = () => {
      section.dataset.skyActive = String(
        visible && !document.hidden && !paused,
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      activity();
    });
    observer.observe(section);
    document.addEventListener('visibilitychange', activity);
    activity();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', activity);
    };
  }, [paused]);
  useEffect(() => {
    const section = root.current;
    if (!section || !sceneReady) return;
    let frame = 0;
    const update = () => {
      // Read geometry before writing the reveal/progress styles.
      const rect = section.getBoundingClientRect();
      const layout = measureScroll(section, scrollLayout.current);
      scrollLayout.current = layout;
      const offset = Math.max(0, Math.min(layout.travel, -rect.top));
      const staticSky = reducedMotion || status === 'unavailable';
      progress.current = staticSky ? 0 : tourProgressAt(offset, layout);
      section.style.setProperty(
        '--flight-progress',
        String(offset / layout.travel),
      );
      reveal.current = updateOpening(section, offset, staticSky);
      // The animated caption follows the renderer's eased position. Static
      // fallbacks can use the scroll position directly. Scrolling never
      // writes a chapter URL; existing shared links still seed the tour.
      if (staticSky)
        setPhase(tourPhase(progress.current, innerWidth / innerHeight));
      frame = 0;
      if (process.env.NODE_ENV !== 'production')
        // Lets a screenshot harness address the page by flight position.
        (
          window as Window & { __tourScrollAt?: (p: number) => number }
        ).__tourScrollAt = (p) => scrollY + rect.top + tourScrollAt(p, layout);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    update();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
    };
  }, [reducedMotion, status, sceneReady]);
  const jump = (chapter: (typeof TOUR_CHAPTERS)[number]) => {
    const section = root.current;
    if (!section) return;
    const top = scrollY + section.getBoundingClientRect().top;
    const layout = measureScroll(section, scrollLayout.current);
    scrollLayout.current = layout;
    scrollTo({
      top:
        top +
        tourScrollAt(
          chapterLanding(chapter, innerWidth / innerHeight, phoneLayout()),
          layout,
        ),
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  };
  // The static sky is one screen where the flight was several. Before the
  // tour gives up that height, note what the visitor is looking at: inside
  // the flight they return to its opening, as the Simple view switch does,
  // and anything below it keeps its place on screen.
  const keepPlace = () => {
    const section = root.current;
    if (!section) return;
    if (section.getBoundingClientRect().bottom > 0) {
      place.current = { id: section.id, top: 0 };
      return;
    }
    const next = [
      ...document.querySelectorAll<HTMLElement>('main > section[id], footer'),
    ].find((element) => element.getBoundingClientRect().bottom > 0);
    if (next?.id)
      place.current = { id: next.id, top: next.getBoundingClientRect().top };
  };
  useLayoutEffect(() => {
    const saved = place.current;
    place.current = null;
    if (!saved || status !== 'unavailable') return;
    const element = document.getElementById(saved.id);
    if (element)
      scrollTo({
        top: scrollY + element.getBoundingClientRect().top - saved.top,
        behavior: 'instant',
      });
  }, [status]);
  useEffect(
    () => () => {
      if (resume.current)
        document.removeEventListener('visibilitychange', resume.current);
    },
    [],
  );
  const report = (value: 'loading' | 'ready' | 'unavailable') => {
    if (value === 'unavailable') keepPlace();
    setStatus(value);
    if (value === 'ready')
      recordFlightMetric('scene_ready_ms', performance.now());
    if (value === 'unavailable') recordFlightMetric('scene_unavailable', 1);
  };
  // A lost context is the browser reclaiming memory or resetting its GPU,
  // not a broken download: keep the tour as it is, show it loading, and
  // mount a fresh scene once the page is in view again. A third loss in one
  // visit gives up to the static sky.
  const lost = () => {
    losses.current += 1;
    if (losses.current > 2) return report('unavailable');
    setStatus('loading');
    const remount = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', remount);
      resume.current = null;
      setSceneKey((key) => key + 1);
    };
    if (!document.hidden) return remount();
    resume.current = remount;
    document.addEventListener('visibilitychange', remount);
  };
  const [eyebrow, heading, description] = copy[phase];
  // The way on to the projects. The server cannot know the view, so it sends
  // these too; the stylesheet keeps them out of a full journey's opening and
  // shows them with scripting off or Simple view already marked.
  const destinations =
    phase === 'cruise' || reducedMotion || status === 'unavailable';
  return (
    <section
      className="bay-journey dreamliner-journey"
      ref={root}
      id="flight"
      data-phase={phase}
      data-status={status}
      aria-label="Explore Henok’s work through a scrolling Boeing 787 journey"
    >
      {/* What Safari tints its bars from while the sky is on screen; a real
          element because it samples neither pseudo-elements nor anything
          transparent. It carries no height of its own (bay-departure.css). */}
      <div className="bay-bar-tint" aria-hidden="true" />
      <div className="bay-sticky">
        {sceneReady && !reducedMotion && (
          <SceneBoundary onError={() => report('unavailable')}>
            <Suspense fallback={null}>
              <DreamlinerScene
                key={sceneKey}
                progress={progress}
                reducedMotion={reducedMotion}
                paused={paused}
                onFrame={(value, front, width, height, tail) => {
                  const next = tourPhase(value, width / height);
                  if (renderedPhase.current !== next) {
                    renderedPhase.current = next;
                    setPhase(next);
                  }
                  tailWipe.current?.update(
                    tail,
                    width,
                    height,
                    root.current?.dataset.opening,
                  );
                  openingWipe.current?.update(
                    front,
                    width,
                    height,
                    root.current?.dataset.opening,
                  );
                }}
                onStatus={report}
                onLost={lost}
              />
            </Suspense>
          </SceneBoundary>
        )}
        <div className="bay-opening-sky" aria-hidden="true">
          <div className="bay-poster">
            <div className="bay-landmark" />
          </div>
          <div className="bay-opening-cloud bay-opening-cloud-far" />
          <div className="bay-opening-cloud bay-opening-cloud-near" />
        </div>
        <div className="bay-scrim" />
        <div className="bay-flight-label mono">
          <span className="bay-live-dot" /> HA 001 / BOEING 787-9 / N787HA{' '}
          <span>SAN FRANCISCO, CA</span>
        </div>
        <a className="bay-skip" href="#departures">
          Skip to projects <ArrowDown size={15} />
        </a>
        <div className="bay-story" key={phase} ref={story}>
          <p className="eyebrow">
            <span className="sr-only">{eyebrow}</span>
            <span aria-hidden="true">{cutText(eyebrow)}</span>
          </p>
          <h1 id="welcome-title" aria-label={heading.replace('\n', ' ')}>
            <span aria-hidden="true">{cutText(heading)}</span>
          </h1>
          <p className="bay-description">
            <span className="sr-only">{description}</span>
            <span aria-hidden="true">{cutText(description)}</span>
          </p>
          {phase === 'preflight' &&
            !reducedMotion &&
            status !== 'unavailable' && (
              <p className="bay-start-hint">
                <ArrowDown size={15} /> Scroll to explore
              </p>
            )}
          {phase === 'roll' &&
            (reducedMotion ? (
              <picture className="tour-mockup">
                <source
                  srcSet="/images/downshift-mockup-static.avif"
                  type="image/avif"
                />
                <img
                  src="/images/downshift-mockup-static.png"
                  alt="Downshift’s dashboard, performance, and settings screens on three iPhones"
                  loading="lazy"
                />
              </picture>
            ) : (
              <button
                className="tour-mockup tour-project-button"
                onClick={() => onProject('downshift')}
                aria-label="Explore Downshift"
              >
                <picture>
                  <source
                    srcSet="/images/downshift-mockup.avif"
                    type="image/avif"
                  />
                  <img
                    src="/images/downshift-mockup.png"
                    alt="Downshift’s performance and settings screens, each on its own iPhone"
                    loading="lazy"
                  />
                </picture>
                <span
                  className="tour-mockup-video"
                  style={{
                    left: '10.23%',
                    top: '15.96%',
                    width: '35.6%',
                    height: '79.35%',
                    transform: 'rotate(-14.06deg)',
                  }}
                >
                  <video
                    src="/video/downshift-dashboard-loop.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    aria-label="Downshift’s dashboard running live"
                  />
                </span>
                <span className="tour-project-action">
                  Explore Downshift <ArrowRight size={15} />
                </span>
              </button>
            ))}
          {phase === 'liftoff' && (
            <button
              className="tour-preview"
              onClick={() => onProject('wear-bridge')}
            >
              <span className="tour-preview-art tour-devices">
                <Smartphone size={31} strokeWidth={1.3} />
                <span>↔</span>
                <Watch size={25} strokeWidth={1.3} />
              </span>
              <span>
                See the bridge<small>Swift · Kotlin · Bluetooth LE</small>
              </span>
              <ArrowRight size={21} />
            </button>
          )}
          {phase === 'bay' && (
            <a className="tour-preview" href="#logbook">
              <span className="tour-preview-art tour-atlas">
                <Globe2 size={43} strokeWidth={1} />
              </span>
              <span>
                Open the logbook
                <small>
                  {flightAtlas.periods.all.stats.flights
                    ? `${flightAtlas.periods.all.stats.flights} recorded flights`
                    : 'Routes coming soon'}
                </small>
              </span>
              <ArrowDown size={21} />
            </a>
          )}
          {(destinations || !viewReady) && (
            <div
              className={
                destinations
                  ? 'tour-destinations'
                  : 'tour-destinations until-ready'
              }
            >
              <a href="#departures">
                All projects <ArrowDown size={17} />
              </a>
              <a href="#contact">
                Say hello <ArrowDown size={17} />
              </a>
            </div>
          )}
        </div>
        <nav className="bay-chapters" aria-label="Flight chapters">
          {TOUR_CHAPTERS.map((chapter, index) => (
            <button
              key={chapter.phase}
              className="mono"
              onClick={() => jump(chapter)}
              aria-label={chapter.label}
              aria-current={phase === chapter.phase ? 'step' : undefined}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span>{chapter.label}</span>
              <i />
            </button>
          ))}
        </nav>
        <div className="bay-bottom">
          <div className="bay-scroll-cue">
            <span className="bay-scroll-track">
              <i />
            </span>
            <span className="mono">
              {reducedMotion || status === 'unavailable'
                ? 'WELCOME'
                : phase === 'cruise'
                  ? 'MORE BELOW'
                  : 'SCROLL TO EXPLORE'}
            </span>
          </div>
          <div className="bay-utilities">
            <button
              className="bay-view-toggle"
              aria-pressed={reducedMotion}
              disabled={!viewReady}
              onClick={onToggleView}
              title="Use a static sky and browse without 3D animation"
            >
              {reducedMotion ? <Check size={15} /> : <LayoutGrid size={15} />}
              <span>Simple view</span>
            </button>
            {status === 'loading' && (
              <output className="bay-loading mono">Loading 787</output>
            )}
            {immersiveMode === 'fullscreen' && (
              <button
                className="mono bay-immersive"
                aria-pressed={immersive}
                aria-label={
                  immersive
                    ? 'Leave the immersive view'
                    : 'Immersive view: fill the screen'
                }
                onClick={toggleImmersive}
              >
                {immersive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                <span>{immersive ? 'Exit' : 'Immersive'}</span>
              </button>
            )}
            {immersiveMode === 'install' && (
              <Dialog>
                <DialogTrigger
                  className="mono bay-immersive"
                  aria-label="Immersive view: how to fill the screen"
                >
                  <Maximize2 size={15} />
                  <span>Immersive</span>
                </DialogTrigger>
                <DialogContent
                  className="immersive-dialog"
                  showCloseButton={false}
                >
                  <div className="immersive-dialog-top mono">
                    <span>
                      <Maximize2 size={15} /> IMMERSIVE VIEW
                    </span>
                    <DialogClose className="close-briefing" aria-label="Close">
                      <X size={18} />
                    </DialogClose>
                  </div>
                  <DialogTitle className="immersive-title">
                    Fill the screen from your Home Screen.
                  </DialogTitle>
                  <DialogDescription className="immersive-description">
                    Safari on iPhone keeps its own bars around every page, and
                    no page can hide them; they only shrink as you scroll. For
                    the full view, open the Share menu, choose{' '}
                    <strong>Add to Home Screen</strong>, and open the site from
                    there. It launches edge to edge with no browser controls.
                  </DialogDescription>
                  <p className="immersive-note">
                    Added it before? Remove that icon and add it again to pick
                    up the full-screen launch.
                  </p>
                </DialogContent>
              </Dialog>
            )}
            <button
              className="mono"
              disabled={reducedMotion || status === 'unavailable'}
              onClick={() => jump(TOUR_CHAPTERS[0])}
              aria-label="Return to the open sky"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
        <div className="bay-source-note">
          <a
            href="/credits/dreamliner.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Aircraft & sky credits
          </a>
        </div>
        <div className="bay-progress" aria-hidden="true">
          <i />
        </div>
      </div>
      {/* The same candidate for the bar at the other end. It has to start its
          life at the journey's own bottom to stay pinned there for the whole
          scroll, which is what the frame around it arranges. */}
      <div className="bay-bar-tint-frame" aria-hidden="true">
        <div className="bay-bar-tint bay-bar-tint-bottom" />
      </div>
    </section>
  );
}
