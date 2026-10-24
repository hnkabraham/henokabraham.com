// Records the share video, `public/video/share-flyover.mp4`: the opening at
// the share card's 1200 x 630, drawn at device ratio 2, from the 787's wing
// sweeping in across the headline to the aircraft banking away and climbing
// off on its contrails. Messages plays it in place of the card.
//
// The page's clock is faked and paused, so time moves only when the recorder
// steps it: each video frame advances the scene by the same number of
// animation frames however long they take to draw and capture, and the lens
// drift, the fan and the scroll easing keep their pace. (Left running, as
// install() leaves it, fake time keeps up with the real clock between steps,
// so every half-second screenshot added half a second to the scene and the
// lens drift jerked along many times too fast: the aircraft shook.) The CSS
// animations, the sky's drift and the opening's clouds, run on the
// compositor's own clock, so each is paused and set to the fake one before
// every capture. The fake clock runs animation frames on a 16 ms grid, so
// the scene plays at 96% speed in a 60 fps video (one frame each) or a 30 fps
// one (two). The controls and the later chapters'
// captions are hidden and the card's name line is set along the bottom, as on
// `og-card.jpg`. A 0.6 s crossfade blends the tail back into the head, so the
// loop doesn't jump.
//
// The tour itself slows in places, where a visitor reads (the wing hanging
// over the headline as it wipes it away, the aircraft settling beside the
// lens before it flies on). A video has no reader, so the recorder first
// reads where the airframe sits on screen along the flight, as the tour
// places it (`__tourAircraftAt`, development only), and spends its frames
// so the aircraft crosses the frame at one steady speed. Measuring the drawn
// frames instead counts the lens's sway, which near the hold is as large as
// the aircraft's own motion; measuring how much the picture changes misses
// the hold over the headline, where the wipe changes the picture while the
// aircraft barely moves. The clip ends at 0.42, just before the lens's slow
// pan takes over from the climb and turns the aircraft's course upward
// within a frame.
// Usage: node scripts/record-share-video.mjs [out.mp4]
//   [--seconds=11] [--from=0.045] [--to=0.42] [--fps=60] [--crf=18]
//   [--url=http://localhost:3000/]
// Needs the dev server (`npm run dev`), whose page addresses and holds the
// tour by flight position, and ffmpeg on the PATH. Uses the globally
// installed Playwright and its bundled Chromium, like record-apps-tour.mjs.
import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transpileModule, ModuleKind } from 'typescript';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const options = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('=')),
);
const [video = 'public/video/share-flyover.mp4'] = positional;
const seconds = Number(options.seconds ?? 11);
const from = Number(options.from ?? 0.045);
const to = Number(options.to ?? 0.42);
const url = options.url ?? 'http://localhost:3000/';
const fps = Number(options.fps ?? 60);
if (fps !== 60 && fps !== 30) throw new Error('--fps is 60 or 30');
const fade = 0.6;
const frames = Math.round(seconds * fps);

// The scene's easing of its flight position, from its own source.
const { followFlightProgress } = await import(
  `data:text/javascript;base64,${Buffer.from(
    transpileModule(
      await readFile(
        new URL('../lib/bay-performance.ts', import.meta.url),
        'utf8',
      ),
      { compilerOptions: { module: ModuleKind.ESNext } },
    ).outputText,
  ).toString('base64')}`
);

const require = createRequire(import.meta.url);
const { chromium } = require(
  join(execSync('npm root -g').toString().trim(), 'playwright'),
);
const out = await mkdtemp(join(tmpdir(), 'share-flyover-'));
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
});
// Device ratio 2 is as sharp as the scene draws on a wide screen
// (tourPixelRatio), and it sets the page's text to match.
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
// Global Privacy Control keeps the page's analytics out of the recording.
await context.addInitScript(() =>
  Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
    get: () => true,
  }),
);
const page = await context.newPage();
await page.clock.install();
await page.goto(url, { waitUntil: 'load' });
await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
// One animation frame each.
const tick = async (n) => {
  for (let i = 0; i < n; i++) await page.clock.runFor(16);
};
// The CSS animations, moved on by the fake clock's time since the last
// capture, while the stylesheet has them running (the opening's clouds stop
// once the opening has played out).
const settle = () =>
  page.evaluate(() => {
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (!animation.recorded) {
        animation.pause();
        animation.recorded = { time: animation.currentTime ?? 0, at: now };
      }
      const { target } = animation.effect ?? {};
      const running =
        !(animation instanceof CSSAnimation) ||
        !target ||
        getComputedStyle(target).animationPlayState.includes('running');
      if (running) animation.recorded.time += now - animation.recorded.at;
      animation.recorded.at = now;
      animation.currentTime = animation.recorded.time;
    }
  });
// Loading runs on the page's timers too, so time moves while it waits.
const started = Date.now();
while (!(await page.$('.bay-canvas canvas.is-ready'))) {
  if (Date.now() - started > 90_000) throw new Error('The 787 never loaded');
  await tick(6);
  await new Promise((resolve) => setTimeout(resolve, 50));
}
await page.waitForFunction(() => typeof window.__tourScrollAt === 'function');
await page.addStyleTag({
  content: `
    html { scroll-behavior: auto !important }
    .terminal-header, .bay-flight-label, .bay-skip, .bay-chapters,
    .bay-bottom, .bay-source-note, .bay-progress { visibility: hidden !important }
    /* Later chapters' captions; the headline is the only one in frame. */
    .bay-story:not(:has(h2[aria-label^="A different"])) { display: none !important }
    .share-name {
      position: absolute; left: 85px; bottom: 44px; z-index: 5;
      font: 500 17px/1 'Google Sans', sans-serif; letter-spacing: .16em;
      text-transform: uppercase; color: var(--share-ink);
    }`,
});
// The name line, in the headline's ink.
await page.evaluate(() => {
  const name = document.createElement('div');
  name.className = 'share-name';
  name.textContent = 'Henok Abraham · henokabraham.com';
  name.style.setProperty(
    '--share-ink',
    getComputedStyle(document.querySelector('#welcome-title')).color,
  );
  document.querySelector('.bay-sticky').append(name);
});
// Every frame reaches the page's scroll handler before the clock ticks: the
// browser's own scroll events follow its real frames, not the fake clock,
// so on their own they land every few frames and the aircraft lurches after
// them. The exact position is held for the handler (`__tourHold`), since
// the browser rounds scrolling to whole pixels.
const fly = (p) =>
  page.evaluate((v) => {
    const top = window.__tourScrollAt(v);
    window.__tourHold = top;
    scrollTo({ top, behavior: 'instant' });
    dispatchEvent(new Event('scroll'));
  }, p);
const ratio = () =>
  page.evaluate(
    () => document.querySelector('[data-pixel-ratio]')?.dataset.pixelRatio,
  );

// The scene starts at its middle quality and steps up after twenty seconds
// of smooth frames, which the fake clock always gives it. Hold the aircraft
// in view until it draws at the full ratio.
await fly(0.2);
for (let i = 0; i < 40 && (await ratio()) !== '2.00'; i++) await tick(60);
console.log(`Drawing at ratio ${await ratio()}`);

// The measuring: how far the airframe moves on screen from each flight
// position to the next, as the tour places it, every 0.0002 (the median over
// the sampled points in frame at both). Where too little of it is in frame
// to tell, the nearest measured step stands in.
const step = 0.0002;
const span = Math.round((to - from) / step);
const moved = await page.evaluate(
  ({ from, step, span }) => {
    const inFrame = (x, y) =>
      x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
    let before = globalThis.__tourAircraftAt(from);
    const moved = [];
    for (let i = 1; i <= span; i++) {
      const now = globalThis.__tourAircraftAt(from + i * step);
      const steps = [];
      for (let k = 0; k < now.length; k += 2)
        if (inFrame(before[k], before[k + 1]) && inFrame(now[k], now[k + 1]))
          steps.push(
            Math.hypot(now[k] - before[k], now[k + 1] - before[k + 1]),
          );
      steps.sort((a, b) => a - b);
      moved.push(steps.length >= 12 ? steps[steps.length >> 1] : NaN);
      before = now;
    }
    return moved;
  },
  { from, step, span },
);
const known = moved.flatMap((v, i) => (Number.isNaN(v) ? [] : [i]));
if (!known.length) throw new Error('The aircraft never came into frame');
const filled = moved.map((v, i) =>
  Number.isNaN(v)
    ? moved[known.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a))]
    : v,
);
// Eased over a few steps, so the set of points in frame changing doesn't
// jog the pace.
const distance = filled.map((_, i) => {
  let sum = 0;
  let total = 0;
  for (let j = Math.max(0, i - 9); j <= Math.min(span - 1, i + 9); j++) {
    const w = Math.exp(-(((i - j) / 3) ** 2) / 2);
    sum += w * filled[j];
    total += w;
  }
  return sum / total;
});
// The recording spends its frames so the aircraft covers the same distance
// in each. Where it barely moves, settling beside the lens before it flies
// on, the flight runs as fast as the scene follows it: its easing
// (followFlightProgress) moves the flight at most 0.8 a second, and this
// keeps under three quarters of that.
const fastest = 0.6 * 0.016 * (60 / fps);
let slowest = 0;
let reach;
for (let pass = 0; pass < 3; pass++) {
  reach = [0];
  for (const d of distance) reach.push(reach.at(-1) + Math.max(slowest, d));
  slowest = (reach.at(-1) / (frames - 1)) * (step / fastest);
}
const total = reach.at(-1);
console.log(
  `The aircraft crosses the card at ${((total / (frames - 1)) * fps).toFixed(0)} px a second`,
);
const plan = Array.from({ length: frames }, (_, n) => {
  const goal = (n / (frames - 1)) * total;
  let i = 1;
  while (i < span && reach[i] < goal) i++;
  return (
    from + step * (i - 1 + (goal - reach[i - 1]) / (reach[i] - reach[i - 1]))
  );
});

// The recording. The scene eases its flight position toward the scroll's,
// keeping `lag` of the gap after each video frame, so each frame's scroll
// leads the plan by just enough that the eased position lands on it.
const lag = Math.exp(-14 * 0.016 * (60 / fps));
await fly(plan[0]);
await tick(180);
let flown = plan[0];
for (let i = 0; i < frames; i++) {
  const target = i ? (plan[i] - flown * lag) / (1 - lag) : flown;
  await fly(target);
  await tick(60 / fps);
  for (let j = 0; j < 60 / fps; j++)
    flown = followFlightProgress(flown, target, 0.016);
  if (Math.abs(flown - plan[i]) > 1e-6)
    throw new Error(`The scene can't keep up with the plan at frame ${i}`);
  await settle();
  await page.screenshot({
    path: join(out, `f${String(i).padStart(3, '0')}.png`),
  });
}
// A quality change mid-recording would resize the canvas between frames.
if ((await ratio()) !== '2.00')
  throw new Error(`The scene dropped to ratio ${await ratio()}`);
await browser.close();

// The clip from `fade` on, its last `fade` seconds blended into its first:
// it ends on the frame it starts with.
await mkdir(join(video, '..'), { recursive: true });
const encoded = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    join(out, 'f%03d.png'),
    '-filter_complex',
    [
      // Screenshots are RGB; video players expect BT.709 at TV range.
      `[0]scale=out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,split[a][b]`,
      `[a]trim=start=${fade},setpts=PTS-STARTPTS[body]`,
      `[b]trim=duration=${fade},setpts=PTS-STARTPTS[head]`,
      `[body][head]xfade=transition=fade:duration=${fade}:offset=${seconds - 2 * fade},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
    ].join(';'),
    '-an',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level',
    '5.1',
    '-preset',
    'veryslow',
    '-crf',
    options.crf ?? '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ],
  { stdio: 'inherit' },
);
if (encoded.status !== 0) throw new Error(`ffmpeg failed; frames in ${out}`);
console.log(
  `Wrote ${video}, ${((await stat(video)).size / 1e6).toFixed(2)} MB; frames in ${out}`,
);
