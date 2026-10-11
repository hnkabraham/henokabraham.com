'use client';
import { useEffect, useRef } from 'react';
import type { DoloresViewer } from '@/lib/dolores-park-viewer';
import { sceneAsset } from '@/lib/scene-assets';
import { withTimeout } from '@/lib/abort';

type Props = {
  reducedMotion: boolean;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

// The park model is the largest file on the page (about 4.1 MB, 2.8 MB on a
// phone), so a slow connection gets longer than the car alone needed. A
// stalled request still ends in the poster rather than a spinner.
const fetchAsset = async (path: string, signal: AbortSignal) => {
  const response = await fetch(sceneAsset(path), {
    signal: withTimeout(signal, 60000),
  });
  if (!response.ok) throw new Error('Garage asset unavailable');
  return response.arrayBuffer();
};

/**
 * The GT350 parked on 20th Street at Dolores Park, orbitable. The scene and
 * its whole lifecycle (render on demand, its own visibility and
 * document.hidden gates, disposal) live in lib/dolores-park-viewer.js, which
 * the reference page scripts/dolores-park/live.html runs too; this component
 * decides when to start it and reports its status to the section.
 */
export default function GarageParkScene({ reducedMotion, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef(onStatus);
  useEffect(() => {
    status.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    if (reducedMotion) {
      status.current('ready');
      return;
    }
    status.current('loading');
    const controller = new AbortController();
    let disposed = false,
      started = false;
    let viewer: DoloresViewer | undefined;
    const fail = () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      viewer?.dispose();
      viewer = undefined;
      status.current('unavailable');
    };
    const start = async () => {
      if (started) return;
      started = true;
      const { createDoloresViewer } = await import('@/lib/dolores-park-viewer');
      if (disposed) return;
      const created = await createDoloresViewer(element, {
        // The same test the tour uses for its phone aircraft: width alone
        // would send a phone held sideways the desktop model.
        phone: innerWidth < 800 || innerHeight < 500,
        sun: 'evening',
        load: (path) => fetchAsset(path, controller.signal),
        dracoPath: sceneAsset('/draco/'),
        scrollFriendly: true,
        signal: controller.signal,
        // A lost context comes back empty; the poster is the fallback
        // rather than rebuilding a 4 MB scene mid-scroll.
        onContextLost: fail,
      });
      if (disposed) {
        created.dispose();
        return;
      }
      viewer = created;
      // The viewer resolves after its shadow pass, reflection capture and
      // first frame, so the poster crossfades onto a finished picture.
      status.current('ready');
    };
    // Nothing is fetched until the section is near the viewport: it sits
    // below the fold, under the tour's own canvas and render budget. Once
    // started, the viewer's own IntersectionObserver stops its rendering
    // whenever it scrolls away.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void start().catch(fail);
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      controller.abort();
      viewer?.dispose();
      viewer = undefined;
    };
  }, [reducedMotion]);
  return <div className="garage-canvas" ref={host} />;
}
