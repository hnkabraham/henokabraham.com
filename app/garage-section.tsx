'use client';
import { lazy, Suspense, useState } from 'react';
import './garage.css';

const GarageScene = lazy(() => import('./garage-scene'));

type Status = 'loading' | 'ready' | 'unavailable';

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
            <source srcSet="/images/garage-gt350r.avif" type="image/avif" />
            <img
              src="/images/garage-gt350r.png"
              alt="2017 Shelby GT350, gray with blue racing stripes, three-quarter view"
              loading="lazy"
            />
          </picture>
          {showScene && (
            <Suspense fallback={null}>
              <GarageScene reducedMotion={reducedMotion} onStatus={setStatus} />
            </Suspense>
          )}
        </div>
        <div className="garage-details">
          <h3>2017 Shelby GT350</h3>
          <p className="garage-caption">Gray, with blue racing stripes.</p>
          <a
            className="garage-credits"
            href="/credits/garage.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Model credits
          </a>
        </div>
      </div>
    </section>
  );
}
