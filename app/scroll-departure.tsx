'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  RotateCcw,
  Volume2,
  VolumeX,
  Smartphone,
  Watch,
  Globe2,
  ArrowRight,
} from 'lucide-react';
import { clamp01, type BayPhase } from '@/lib/bay-flight';
import { createBayAudio } from '@/lib/bay-audio';
import DreamlinerScene from './dreamliner-scene';
import { TOUR_CHAPTERS, tourPhase } from '@/lib/dreamliner-tour';
import { recordFlightMetric } from '@/lib/flight-metrics';
import { openingSkyReveal } from '@/lib/bay-performance';
import { replaceFlightLink } from '@/lib/flight-links';
import Image from 'next/image';
import { personalFlights } from './personal-flights';

const copy: Record<BayPhase, [string, string, string]> = {
  preflight: [
    'HENOK ABRAHAM',
    'A different\nperspective.',
    'Developer. Maker. Aviation enthusiast.',
  ],
  roll: ['01 / APPS', 'Downshift.', 'Live car data. Better shifts.'],
  liftoff: [
    '02 / CONNECTED DEVICES',
    'iPhone ↔\nWear OS.',
    'Different ecosystems. Connected.',
  ],
  bay: [
    '03 / AWAY FROM THE KEYBOARD',
    'A few miles\nof memories.',
    'My personal flight log.',
  ],
  cruise: ['04 / KEEP EXPLORING', 'Made with\ncuriosity.', 'Explore the rest.'],
};

function updateOpening(
  section: HTMLElement,
  progress: number,
  staticSky: boolean,
) {
  const reveal = staticSky
    ? 0
    : openingSkyReveal(
        progress * Math.max(1, section.offsetHeight - innerHeight),
      );
  section.style.setProperty('--flight-reveal', String(reveal));
  section.dataset.opening = String(reveal < 1);
  return reveal;
}

export default function ScrollDeparture({
  reducedMotion,
  entry,
  onProject,
  paused = false,
}: {
  reducedMotion: boolean;
  entry: { chapter: BayPhase | null } | null;
  onProject: (id: string) => void;
  paused?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const reveal = useRef(0);
  const audio = useRef<ReturnType<typeof createBayAudio> | null>(null);
  const [phase, setPhase] = useState<BayPhase>('preflight');
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(
    'loading',
  );
  const [sound, setSound] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  useLayoutEffect(() => {
    const section = root.current;
    if (!section || !entry) return;
    const chapter = TOUR_CHAPTERS.find((item) => item.phase === entry.chapter);
    if (chapter && !reducedMotion) {
      progress.current = chapter.at;
      const top = scrollY + section.getBoundingClientRect().top;
      scrollTo({
        top: top + chapter.at * Math.max(0, section.offsetHeight - innerHeight),
        behavior: 'instant',
      });
    } else {
      progress.current = reducedMotion
        ? 1
        : clamp01(
            -section.getBoundingClientRect().top /
              Math.max(1, section.offsetHeight - innerHeight),
          );
    }
    reveal.current = updateOpening(section, progress.current, reducedMotion);
    setPhase(tourPhase(progress.current));
    // Mount the renderer only after the shared chapter has seeded its ref.
    setSceneReady(true);
  }, [entry, reducedMotion]);
  useEffect(() => () => audio.current?.dispose(), []);
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
  // The scene announces found easter eggs; show each for a few seconds.
  useEffect(() => {
    let timer = 0;
    const onEgg = (event: Event) => {
      const { message } = (event as CustomEvent<{ message: string }>).detail;
      setToast(message);
      clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 4200);
    };
    addEventListener('bay-easter-egg', onEgg);
    return () => {
      clearTimeout(timer);
      removeEventListener('bay-easter-egg', onEgg);
    };
  }, []);
  const toggleSound = () => {
    if (audio.current) {
      audio.current.dispose();
      audio.current = null;
      setSound(false);
    } else {
      try {
        audio.current = createBayAudio();
        setSound(true);
      } catch {
        setSound(false);
      }
    }
  };
  useEffect(() => {
    const section = root.current;
    if (!section || !sceneReady) return;
    let frame = 0;
    const update = () => {
      const rect = section.getBoundingClientRect();
      progress.current =
        reducedMotion || status === 'unavailable'
          ? 1
          : clamp01(
              -rect.top / Math.max(1, section.offsetHeight - innerHeight),
            );
      section.style.setProperty('--flight-progress', String(progress.current));
      reveal.current = updateOpening(
        section,
        progress.current,
        reducedMotion || status === 'unavailable',
      );
      const currentPhase = tourPhase(progress.current);
      setPhase(currentPhase);
      if (
        !reducedMotion &&
        status !== 'unavailable' &&
        rect.top <= 1 &&
        rect.bottom > innerHeight
      )
        replaceFlightLink({ chapter: currentPhase });
      frame = 0;
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
  const jump = (position: number) => {
    const section = root.current;
    if (!section) return;
    const top = scrollY + section.getBoundingClientRect().top;
    scrollTo({
      top: top + position * (section.offsetHeight - innerHeight),
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  };
  const [eyebrow, heading, description] = copy[phase];
  return (
    <section
      className="bay-journey dreamliner-journey"
      ref={root}
      id="flight"
      data-phase={phase}
      data-reduced={reducedMotion}
      data-status={status}
      aria-label="Explore Henok’s work through a scrolling Boeing 787 journey"
    >
      <div className="bay-sticky">
        {sceneReady && (
          <DreamlinerScene
            progress={progress}
            reducedMotion={reducedMotion}
            paused={paused}
            audio={audio}
            onStatus={(value) => {
              setStatus(value);
              if (value === 'ready')
                recordFlightMetric('scene_ready_ms', performance.now());
              if (value === 'unavailable')
                recordFlightMetric('scene_unavailable', 1);
            }}
          />
        )}
        <div className="bay-opening-sky" aria-hidden="true">
          <div className="bay-poster" />
          <div className="bay-opening-cloud bay-opening-cloud-far" />
          <div className="bay-opening-cloud bay-opening-cloud-near" />
        </div>
        <div className="bay-scrim" />
        <div className="bay-flight-label mono">
          <span className="bay-live-dot" /> H.A / BOEING 787–9{' '}
          <span>SAN FRANCISCO, CA</span>
        </div>
        <a className="bay-skip" href="#departures">
          Skip to projects <ArrowUpRight size={15} />
        </a>
        <div className="bay-story" key={phase}>
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="welcome-title">{heading}</h1>
          <p className="bay-description">{description}</p>
          {phase === 'preflight' && (
            <p className="bay-start-hint">
              <ArrowDown size={15} /> Scroll to explore
            </p>
          )}
          {phase === 'roll' && (
            <button
              className="tour-preview"
              onClick={() => onProject('downshift')}
            >
              <span className="tour-preview-art">
                <Image
                  src="/images/downshift-dashboard.jpg"
                  alt="Downshift driving dashboard"
                  width={92}
                  height={108}
                  loading="lazy"
                  unoptimized
                />
              </span>
              <span>
                Take a look<small>iOS · OBD-II</small>
              </span>
              <ArrowUpRight size={21} />
            </button>
          )}
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
                See the bridge<small>Swift · Kotlin · Bluetooth</small>
              </span>
              <ArrowUpRight size={21} />
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
                  {personalFlights.length
                    ? `${personalFlights.length} recorded flights`
                    : 'Routes coming soon'}
                </small>
              </span>
              <ArrowUpRight size={21} />
            </a>
          )}
          {phase === 'cruise' && (
            <div className="tour-destinations">
              <a href="#departures">
                All projects <ArrowRight size={17} />
              </a>
              <a href="#contact">
                Say hello <ArrowUpRight size={17} />
              </a>
            </div>
          )}
        </div>
        <nav className="bay-chapters" aria-label="Flight chapters">
          {TOUR_CHAPTERS.map((chapter, index) => (
            <button
              key={chapter.phase}
              className="mono"
              onClick={() => jump(chapter.at)}
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
            {status === 'loading' && (
              <output className="bay-loading mono">Loading 787</output>
            )}
            <button
              className="mono"
              disabled={status !== 'ready'}
              aria-pressed={sound}
              onClick={toggleSound}
            >
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />} SOUND{' '}
              {sound ? 'ON' : 'OFF'}
            </button>
            <button
              className="mono"
              disabled={reducedMotion || status === 'unavailable'}
              onClick={() => jump(0)}
              aria-label="Return to the open sky"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
        <output className="bay-toast mono" hidden={!toast} aria-live="polite">
          {toast}
        </output>
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
    </section>
  );
}
