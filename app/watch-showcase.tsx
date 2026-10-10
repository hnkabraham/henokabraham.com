'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { drawFace, type FaceArt, type FaceId } from '@/lib/watch-faces';
import { LABEL_FONT, NUMERAL_FONT, type Frame } from '@/lib/watch-face-dc';
import { sampleCode } from '@/lib/watch-face-totp';
import { bezelFaces, watchFaces } from './watch-face-data';
import './watch-showcase.css';

// The faces' two fonts, made by scripts/prepare-watch-fonts.py.
const FONTS: [string, string][] = [
  [NUMERAL_FONT, '/fonts/watch-numerals-35784483a52b.woff2'],
  [LABEL_FONT, '/fonts/watch-labels-d55c1c94348a.woff2'],
];

let assets: Promise<FaceArt> | null = null;
// Fonts and Summit's ridge, fetched once, the first time the section nears.
function loadAssets() {
  assets ??= (async () => {
    const ridge = new Image();
    ridge.src = '/images/watch-faces/summit-ridge.webp';
    await Promise.all([
      ...FONTS.map(async ([family, url]) => {
        const face = new FontFace(family, `url(${url}) format('woff2')`);
        document.fonts.add(await face.load());
      }),
      ridge.decode(),
    ]);
    return { mountain: ridge };
  })();
  return assets;
}

// A watch set to the visitor's clock: their time, date and 12- or 24-hour
// habit, which the face reads as the watch's own setting.
const is24Hour = () =>
  ['h23', 'h24'].includes(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
      .hourCycle ?? '',
  );

function frameAt(time: number, codes: Map<number, string>): Frame {
  const date = new Date(time);
  const epoch = Math.floor(time / 1000);
  return {
    hour: date.getHours(),
    min: date.getMinutes(),
    sec: date.getSeconds(),
    epoch,
    day: date.getDate(),
    weekday: date.getDay(),
    month: date.getMonth(),
    is24Hour: is24Hour(),
    code: codes.get(Math.floor(epoch / 30)) ?? null,
  };
}

export default function WatchShowcase() {
  const [alwaysOn, setAlwaysOn] = useState(false);
  const grid = useRef<HTMLUListElement>(null);
  const mode = useRef(alwaysOn);
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    mode.current = alwaysOn;
    redraw.current?.();
  }, [alwaysOn]);

  useEffect(() => {
    const list = grid.current;
    if (!list) return;
    const canvases = [
      ...list.querySelectorAll<HTMLCanvasElement>('canvas[data-face]'),
    ];
    const visible = new Set<HTMLCanvasElement>();
    const codes = new Map<number, string>();
    let art: FaceArt | null = null;
    let timer = 0;
    let frameRequest = 0;
    let stopped = false;

    // The sample code for this half-minute and the next, so a frame never
    // waits on the hash.
    const prepareCodes = async (time: number) => {
      const current = Math.floor(time / 30_000);
      for (const step of [current, current + 1])
        if (!codes.has(step)) codes.set(step, await sampleCode(step * 30));
      for (const key of codes.keys()) if (key < current) codes.delete(key);
    };

    const draw = (canvas: HTMLCanvasElement, time: number) => {
      if (!art) return;
      const size = canvas.clientWidth;
      if (!size) return;
      const pixels = Math.round(size * Math.min(window.devicePixelRatio, 3));
      if (canvas.width !== pixels) {
        canvas.width = pixels;
        canvas.height = pixels;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(pixels / 416, 0, 0, pixels / 416, 0, 0);
      drawFace(
        ctx,
        canvas.dataset.face as FaceId,
        frameAt(time, codes),
        mode.current,
        art,
      );
      canvas.dataset.drawn = 'true';
    };

    // Awake, a face redraws on each second, as the watch does; always-on, on
    // each minute. Only faces on screen are drawn, and nothing while the
    // page is hidden.
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || document.hidden || !visible.size || !art) return;
      const period = mode.current ? 60_000 : 1000;
      const delay = period - (Date.now() % period) + 4;
      timer = window.setTimeout(() => {
        frameRequest = requestAnimationFrame(() => {
          const now = Date.now();
          visible.forEach((canvas) => draw(canvas, now));
          void prepareCodes(now).then(schedule);
        });
      }, delay);
    };

    const drawVisible = () => {
      const now = Date.now();
      visible.forEach((canvas) => draw(canvas, now));
      schedule();
    };
    // A change of mode reaches every face, on screen or not.
    const drawAll = () => {
      const now = Date.now();
      canvases.forEach((canvas) => draw(canvas, now));
      schedule();
    };
    redraw.current = drawAll;

    const start = async () => {
      const [loaded] = await Promise.all([
        loadAssets(),
        prepareCodes(Date.now()),
      ]);
      if (stopped) return;
      art = loaded;
      // Every face gets a first frame now, so none shows the store's time
      // as it scrolls in; from then on only those on screen are redrawn.
      drawAll();
    };

    const onScreen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const canvas = entry.target as HTMLCanvasElement;
        if (entry.isIntersecting) {
          visible.add(canvas);
          draw(canvas, Date.now());
        } else visible.delete(canvas);
      }
      schedule();
    });
    // Fetch the fonts a little before the faces come into view.
    const approach = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        approach.disconnect();
        void start().catch(() => {
          // The store stills stay in place.
        });
      },
      { rootMargin: '600px 0px' },
    );
    approach.observe(list);
    canvases.forEach((canvas) => onScreen.observe(canvas));
    const resize = new ResizeObserver(() => drawVisible());
    resize.observe(list);
    document.addEventListener('visibilitychange', drawVisible);
    return () => {
      stopped = true;
      redraw.current = null;
      window.clearTimeout(timer);
      cancelAnimationFrame(frameRequest);
      approach.disconnect();
      onScreen.disconnect();
      resize.disconnect();
      document.removeEventListener('visibilitychange', drawVisible);
    };
  }, []);

  return (
    <section
      className="wrist-section"
      id="watch-faces"
      aria-labelledby="wrist-title"
      data-mode={alwaysOn ? 'always-on' : 'awake'}
    >
      <div className="wrist-top" data-reveal>
        <div>
          <p className="eyebrow">BEZEL AUTH / ON THE WRIST</p>
          <h2 id="wrist-title">On your time.</h2>
          <p className="wrist-caption">
            Six of the {bezelFaces.inWords} free faces I made for the Garmin
            epix (Gen 2), drawn here by a port of their own code.
          </p>
        </div>
        <fieldset className="wrist-mode mono" aria-label="Display">
          <button
            type="button"
            aria-pressed={!alwaysOn}
            onClick={() => setAlwaysOn(false)}
          >
            Awake
          </button>
          <button
            type="button"
            aria-pressed={alwaysOn}
            onClick={() => setAlwaysOn(true)}
          >
            Always on
          </button>
        </fieldset>
      </div>
      <ul className="wrist-grid" ref={grid} data-reveal>
        {watchFaces.map((face) => (
          <li key={face.id}>
            <a
              className="wrist-face"
              href={face.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="wrist-dial">
                {/* The store image holds the place, and stays for visitors
                    without scripts, until the live face's first frame. */}
                <picture>
                  <source
                    srcSet={`/images/watch-faces/${face.id}.avif`}
                    type="image/avif"
                  />
                  <img
                    src={`/images/watch-faces/${face.id}.jpg`}
                    alt=""
                    width={416}
                    height={416}
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
                <canvas data-face={face.id} aria-hidden="true" />
              </span>
              <span className="wrist-name">
                {face.name}
                <ArrowUpRight size={16} />
              </span>
              <span className="wrist-line">{face.line}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="wrist-foot" data-reveal>
        <p className="mono">
          The time and date are yours. Everything else is sample data; the code
          comes from the TOTP standard’s published test key.
        </p>
        <a href={bezelFaces.page} target="_blank" rel="noopener noreferrer">
          See all {bezelFaces.inWords} on Connect IQ
          <ArrowUpRight size={16} />
        </a>
      </div>
    </section>
  );
}
