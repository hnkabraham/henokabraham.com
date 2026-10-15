'use client';
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { solarPosition } from '@/lib/sun-position';
import SceneBoundary from './scene-boundary';
import './garage.css';

const GarageParkScene = lazy(() => import('./garage-park-scene'));

type Status = 'loading' | 'ready' | 'unavailable';

// The poster is the live viewer's own default view, rendered at the frame's
// two shapes: 16:10, and 4:3 at 800 px and below, where the viewer keeps its
// horizontal field of view and so shows more sky and road than a cropped
// wide frame would. Above 800 px the frame runs the window's full width and
// is often wider than 16:10; the viewer then shows the middle band of the
// same view, which is what covering the frame with the poster shows, so the
// crossfade lands on the same picture either way.
const PHONE = '(max-width: 800px)';
const WIDE_SIZES = '100vw';

// The live view is lit for the hour at the park, so the poster it fades
// into is too: daylight, dusk (from 3° above the horizon until the sun is
// 6° below) or night. The server renders daylight; the client swaps before
// the lazy image is near the viewport.
const POSTERS = {
  day: { file: 'garage-park', when: '' },
  dusk: { file: 'garage-park-dusk', when: ' at dusk' },
  night: { file: 'garage-park-night', when: ' at night' },
};
type Poster = keyof typeof POSTERS;
const posterNow = (): Poster => {
  const { elevation } = solarPosition(Date.now());
  return elevation > 3 ? 'day' : elevation > -6 ? 'dusk' : 'night';
};
const noSubscription = () => () => {};

export default function GarageSection({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const poster =
    POSTERS[
      useSyncExternalStore(noSubscription, posterNow, () => 'day' as const)
    ];
  const showScene = !reducedMotion && status !== 'unavailable';
  return (
    <section
      className="terminal-section garage-section"
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
              srcSet={`/images/${poster.file}-phone.avif`}
              type="image/avif"
            />
            <source
              media={PHONE}
              srcSet={`/images/${poster.file}-phone.jpg`}
              type="image/jpeg"
            />
            <source
              srcSet={`/images/${poster.file}-960.avif 960w, /images/${poster.file}.avif 1920w, /images/${poster.file}-2880.avif 2880w`}
              sizes={WIDE_SIZES}
              type="image/avif"
            />
            <img
              src={`/images/${poster.file}.jpg`}
              srcSet={`/images/${poster.file}-960.jpg 960w, /images/${poster.file}.jpg 1920w, /images/${poster.file}-2880.jpg 2880w`}
              sizes={WIDE_SIZES}
              width={1920}
              height={1200}
              loading="lazy"
              decoding="async"
              alt={`A 3D render of the gray GT350 with blue stripes parked on 20th Street at the top of Dolores Park${poster.when}, with palms and the downtown San Francisco skyline behind it`}
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
          <div>
            <h3>2017 Shelby GT350</h3>
            <p className="garage-caption">
              Gray, with blue racing stripes, parked on 20th Street at the top
              of Dolores Park, San Francisco.
            </p>
          </div>
          <div className="garage-sources">
            <a
              className="garage-credits"
              href="/credits/garage"
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
      </div>
    </section>
  );
}
