'use client';
import { lazy, Suspense, useState } from 'react';
import SceneBoundary from './scene-boundary';
import './garage.css';

const GarageParkScene = lazy(() => import('./garage-park-scene'));

type Status = 'loading' | 'ready' | 'unavailable';

// The poster is the live viewer's own default view, rendered at the frame's
// two shapes: 16:10, and 4:3 at 800 px and below, where the viewer keeps its
// horizontal field of view and so shows more sky and road than a cropped
// wide frame would. The crossfade lands on the same picture either way.
const PHONE = '(max-width: 800px)';
const WIDE_SIZES = '950px';

export default function GarageSection({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const showScene = !reducedMotion && status !== 'unavailable';
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
        {showScene && status === 'ready' && (
          <p className="terminal-caption">Drag to look around.</p>
        )}
      </div>
      <div className="garage-layout" data-reveal>
        <div
          className="garage-viewer-frame"
          data-status={reducedMotion ? 'reduced-motion' : status}
        >
          <picture className="garage-poster">
            <source
              media={PHONE}
              srcSet="/images/garage-park-phone.avif"
              type="image/avif"
            />
            <source
              media={PHONE}
              srcSet="/images/garage-park-phone.jpg"
              type="image/jpeg"
            />
            <source
              srcSet="/images/garage-park-960.avif 960w, /images/garage-park.avif 1920w"
              sizes={WIDE_SIZES}
              type="image/avif"
            />
            <img
              src="/images/garage-park.jpg"
              srcSet="/images/garage-park-960.jpg 960w, /images/garage-park.jpg 1920w"
              sizes={WIDE_SIZES}
              width={1920}
              height={1200}
              loading="lazy"
              decoding="async"
              alt="A 3D render of the gray GT350 with blue stripes parked on 20th Street at the top of Dolores Park, with palms and the downtown San Francisco skyline behind it"
            />
          </picture>
          {showScene && (
            <SceneBoundary onError={() => setStatus('unavailable')}>
              <Suspense fallback={null}>
                <GarageParkScene
                  reducedMotion={reducedMotion}
                  onStatus={setStatus}
                />
              </Suspense>
            </SceneBoundary>
          )}
        </div>
        <div className="garage-details">
          <h3>2017 Shelby GT350</h3>
          <p className="garage-caption">
            Gray, with blue racing stripes, parked on 20th Street at the top of
            Dolores Park, San Francisco.
          </p>
          <a
            className="garage-credits"
            href="/credits/garage.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Model and scene credits
          </a>
          <p className="garage-attribution">
            Map data ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
