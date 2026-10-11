'use client';
import { lazy, Suspense, useState } from 'react';
import SceneBoundary from './scene-boundary';
import './garage.css';

const GarageScene = lazy(() => import('./garage-scene'));

type Status = 'loading' | 'ready' | 'unavailable';
type View = 'studio' | 'park';

// The park view is a still: the scene it comes from (scripts/dolores-park/)
// is far too heavy to run live, so the 3D car stays in the studio.
const PARK_SIZES = '(max-width: 800px) 100vw, 950px';

export default function GarageSection({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [view, setView] = useState<View>('studio');
  // Mounted on first selection, so visitors who never switch don't download
  // it, then kept so switching back and forth doesn't reload it.
  const [parkMounted, setParkMounted] = useState(false);
  const showScene = !reducedMotion && status !== 'unavailable';
  const choose = (next: View) => {
    setView(next);
    if (next === 'park') setParkMounted(true);
  };
  return (
    <section
      className="terminal-section"
      id="garage"
      aria-labelledby="garage-title"
    >
      <div className="terminal-section-top" data-reveal>
        <div className="terminal-section-label">
          <span className="section-marker">04</span>
          <div>
            <p className="eyebrow">PERSONAL FLEET</p>
            <h2 id="garage-title">Garage</h2>
          </div>
        </div>
        {showScene && status === 'ready' && view === 'studio' && (
          <p className="terminal-caption">Drag to look around.</p>
        )}
      </div>
      <div className="garage-layout" data-reveal>
        <div
          className="garage-viewer-frame"
          data-status={reducedMotion ? 'reduced-motion' : status}
          data-view={view}
        >
          <picture className="garage-poster">
            <source srcSet="/images/garage-gt350r.avif" type="image/avif" />
            <img
              src="/images/garage-gt350r.png"
              alt="2017 Shelby GT350, gray with blue racing stripes, three-quarter view"
              loading="lazy"
            />
          </picture>
          {showScene && (
            <SceneBoundary onError={() => setStatus('unavailable')}>
              <Suspense fallback={null}>
                <GarageScene
                  reducedMotion={reducedMotion}
                  onStatus={setStatus}
                />
              </Suspense>
            </SceneBoundary>
          )}
          {parkMounted && (
            <picture className="garage-park" hidden={view !== 'park'}>
              <source
                srcSet="/images/garage-dolores-960.avif 960w, /images/garage-dolores.avif 1920w"
                sizes={PARK_SIZES}
                type="image/avif"
              />
              <img
                src="/images/garage-dolores.jpg"
                srcSet="/images/garage-dolores-960.jpg 960w, /images/garage-dolores.jpg 1920w"
                sizes={PARK_SIZES}
                width={1920}
                height={1200}
                decoding="async"
                alt="A render of the gray GT350 with blue stripes parked on 20th Street at the top of Dolores Park, with palms and the downtown San Francisco skyline behind it"
              />
            </picture>
          )}
        </div>
        <div className="garage-details">
          <h3>2017 Shelby GT350</h3>
          <fieldset className="garage-view mono" aria-label="Setting">
            <button
              type="button"
              aria-pressed={view === 'studio'}
              onClick={() => choose('studio')}
            >
              Studio
            </button>
            <button
              type="button"
              aria-pressed={view === 'park'}
              onClick={() => choose('park')}
            >
              Dolores Park
            </button>
          </fieldset>
          <p className="garage-caption">
            {view === 'park'
              ? 'Rendered parked on 20th Street at the top of Dolores Park, San Francisco.'
              : 'Gray, with blue racing stripes.'}
          </p>
          <a
            className="garage-credits"
            href="/credits/garage.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Model and scene credits
          </a>
        </div>
      </div>
    </section>
  );
}
