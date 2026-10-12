'use client';
import { useEffect, useRef } from 'react';
import type { DoloresViewer } from '@/lib/dolores-park-viewer';
import { sceneAsset } from '@/lib/scene-assets';
import { withTimeout } from '@/lib/abort';

type Props = {
  reducedMotion: boolean;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

// The park model is the largest file on the page (about 4.5 MB, 2.8 MB on a
// phone), so a slow connection gets longer than the car alone needed. A
// stalled request still ends in the poster rather than a spinner.
const fetchAsset = async (
  path: string,
  signal: AbortSignal,
  priority?: RequestPriority,
) => {
  const response = await fetch(sceneAsset(path), {
    signal: withTimeout(signal, 60000),
    priority,
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
    const options = {
      // The same test the tour uses for its phone aircraft: width alone
      // would send a phone held sideways the desktop model.
      phone: innerWidth < 800 || innerHeight < 500,
      // The real sun and Moon over the park, kept current while it's open.
      sun: 'live',
    } as const;
    // Prefetches still under way; the viewer waits on those rather than
    // requesting the same file again. Once one lands it is the browser's
    // cache that serves it (scene files are cached immutably).
    const early = new Map<string, Promise<ArrayBuffer>>();
    const load = (path: string) =>
      early.get(path)?.catch(() => fetchAsset(path, controller.signal)) ??
      fetchAsset(path, controller.signal);
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
        ...options,
        load,
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
    // The section sits far below the fold, under the tour's own canvas and
    // render budget. The viewer starts about a screen and a half ahead of
    // it, so a visitor scrolling down finds it built; the build itself only
    // holds the page for 100 ms or so at a time. Once started, the viewer's
    // own IntersectionObserver stops its rendering whenever it scrolls away.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void start().catch(fail);
      },
      { rootMargin: '1200px 0px' },
    );
    observer.observe(element);
    // The download is most of the wait on an ordinary connection, so a
    // desktop visit fetches the files ahead (about 6.1 MB), a few seconds
    // after the page and the tour have loaded, at low priority. Phones
    // (3.9 MB) wait for the section instead, as does a visitor saving data
    // who has chosen the full view (by default they get the simple one).
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    let prefetchTimer = 0;
    const prefetch = async () => {
      const { doloresViewerFiles } = await import('@/lib/dolores-park-viewer');
      if (started || disposed) return;
      for (const path of doloresViewerFiles(options)) {
        const request = fetchAsset(path, controller.signal, 'low');
        early.set(path, request);
        void request
          .catch(() => {
            // The viewer requests it again itself.
          })
          .finally(() => early.delete(path));
      }
    };
    const schedulePrefetch = () => {
      prefetchTimer = window.setTimeout(() => {
        if (!started && !disposed) void prefetch().catch(() => {});
      }, 3000);
    };
    if (!options.phone && !connection?.saveData) {
      if (document.readyState === 'complete') schedulePrefetch();
      else addEventListener('load', schedulePrefetch, { once: true });
    }
    return () => {
      disposed = true;
      removeEventListener('load', schedulePrefetch);
      clearTimeout(prefetchTimer);
      observer.disconnect();
      controller.abort();
      viewer?.dispose();
      viewer = undefined;
    };
  }, [reducedMotion]);
  return <div className="garage-canvas" ref={host} />;
}
