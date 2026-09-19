// Records a constant-speed scroll through the Apps chapter of the running
// dev server, one frame per scroll step, so the pacing of a tour preset
// (lib/dreamliner-tour.ts, selected with `?tour=<preset>` in development)
// can be compared with another's side by side. Frames go to <out dir> and,
// when ffmpeg is on the PATH, an MP4 of the same name beside it.
// Usage: node scripts/record-apps-tour.mjs [preset] [out dir]
//   [--size=1600x950] [--frames=72] [--from=0.27] [--to=0.45] [--url=http://localhost:3000/]
// Uses the globally installed Playwright and its bundled Chromium, like
// render-golden-gate.mjs; headless Metal rendering works on this machine.
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const options = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('=')),
);
// Frames land outside the repository unless a directory is given.
const [preset = 'still', out = join(tmpdir(), `apps-tour-${preset}`)] =
  positional;
const [width, height] = (options.size ?? '1600x950').split('x').map(Number);
const frames = Number(options.frames ?? 72);
const phone = width <= 800;
// The phone caption enters earlier, so its clip starts earlier too.
const from = Number(options.from ?? (phone ? 0.2 : 0.27));
const to = Number(options.to ?? (phone ? 0.44 : 0.45));
const url = new URL(options.url ?? 'http://localhost:3000/');
url.searchParams.set('tour', preset);

const require = createRequire(import.meta.url);
const { chromium } = require(
  join(execSync('npm root -g').toString().trim(), 'playwright'),
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
await page.goto(url.href, { waitUntil: 'networkidle' });
await page.addStyleTag({
  content:
    'html{scroll-behavior:auto!important} .bay-scroll-cue,.bay-source-note{visibility:hidden}',
});
await page.waitForSelector('.bay-canvas canvas.is-ready', { timeout: 60000 });
// scroll-departure.tsx exposes the page's own flight-position map in development.
await page.waitForFunction(() => typeof window.__tourScrollAt === 'function');
const [start, end] = await page.evaluate(
  ([a, b]) => [window.__tourScrollAt(a), window.__tourScrollAt(b)],
  [from, to],
);
console.log(
  `${preset} ${width}x${height}: ${start.toFixed(0)} -> ${end.toFixed(0)} px over ${frames} frames`,
);
const scroll = (y) =>
  page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
await scroll(start);
// Let the eased follower settle on the first position.
await page.waitForTimeout(2500);
for (let i = 0; i < frames; i++) {
  await scroll(start + ((end - start) * i) / (frames - 1));
  await page.waitForTimeout(280);
  await page.screenshot({
    path: join(out, `f${String(i).padStart(3, '0')}.jpg`),
    type: 'jpeg',
    quality: 85,
  });
}
await browser.close();
const video = `${out}.mp4`;
const encoded = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '18',
    '-i',
    join(out, 'f%03d.jpg'),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '22',
    video,
  ],
  { stdio: 'inherit' },
);
console.log(
  encoded.status === 0
    ? `Wrote ${video}`
    : `Frames in ${out}; no ffmpeg on the PATH, so no video`,
);
