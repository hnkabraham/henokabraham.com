// Draws the watch showcase's stills with the ports themselves: each face
// awake at its store fixture's clock, 416 pixels, in headless Chromium with
// the site's watch fonts, encoded by Pillow as JPEG quality 86 and AVIF
// quality 64 into public/images/watch-faces/<face>.jpg/.avif. The still
// holds the place until the live face's first frame, and stays for visitors
// without scripts, so it never shows an authenticator code.
// Usage: node scripts/render-watch-stills.mjs
// Needs Playwright installed globally (npm i -g playwright) and python3 with
// Pillow's AVIF support.
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
);
// Weekday 0 is Sunday and month 0 January, as Date gives them.
const STILLS = {
  // The Bezel Auth store images: 12:12 on Friday 2 October 2026.
  nightwatch: { hour: 0, min: 12, sec: 30, weekday: 5, day: 2, month: 9 },
  // The Gallery preview clock: 10:12:38 on Thursday 5 November 2026.
  arcfield: { hour: 10, min: 12, sec: 38, weekday: 4, day: 5, month: 10 },
  // The Studio preview clock: 10:08:38 on Saturday 3 October 2026.
  meridian: { hour: 10, min: 8, sec: 38, weekday: 6, day: 3, month: 9 },
};

const transpile = async (file) =>
  ts
    .transpileModule(await readFile(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(/from '\.\/(watch-face[a-z-]*)'/g, "from '/lib/$1.js'");

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    let match = pathname.match(/^\/lib\/(watch-face[a-z-]*)\.js$/);
    if (pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><canvas></canvas>');
    } else if (match) {
      response.setHeader('content-type', 'text/javascript');
      response.end(await transpile(path.join(root, 'lib', `${match[1]}.ts`)));
    } else if (
      (match = pathname.match(/^\/fonts\/(watch-[a-z0-9-]+\.woff2)$/))
    ) {
      response.setHeader('content-type', 'font/woff2');
      response.end(await readFile(path.join(root, 'public/fonts', match[1])));
    } else {
      response.statusCode = 404;
      response.end();
    }
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();

// The showcase's own font list, so the stills use what the page loads.
const showcase = await readFile(
  path.join(root, 'app/watch-showcase.tsx'),
  'utf8',
);
const fonts = [
  ...showcase.matchAll(/\[(\w+), '\/fonts\/(watch-[a-z0-9-]+\.woff2)'\]/g),
].map(([, constant, file]) => ({ constant, file }));
if (fonts.length !== 3)
  throw new Error('Expected the showcase to load three fonts');

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(execSync('npm root -g').toString().trim(), 'playwright'),
);
const browser = await chromium.launch({ headless: true });
const scratch = await mkdtemp(path.join(os.tmpdir(), 'watch-stills-'));
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`);
  for (const [id, clock] of Object.entries(STILLS)) {
    const frame = {
      ...clock,
      is24Hour: false,
      epoch: (clock.hour * 60 + clock.min) * 60 + clock.sec,
    };
    const png = await page.evaluate(
      async ({ id, frame, fonts }) => {
        const dc = await import('/lib/watch-face-dc.js');
        const { drawFace } = await import('/lib/watch-faces.js');
        for (const { constant, file } of fonts)
          document.fonts.add(
            await new FontFace(dc[constant], `url(/fonts/${file})`).load(),
          );
        const canvas = document.querySelector('canvas');
        canvas.width = canvas.height = 416;
        drawFace(canvas.getContext('2d'), id, frame, false);
        return canvas.toDataURL('image/png');
      },
      { id, frame, fonts },
    );
    await writeFile(
      path.join(scratch, `${id}.png`),
      Buffer.from(png.split(',')[1], 'base64'),
    );
  }
  if (errors.length) throw new Error(errors.join('\n'));
  execFileSync(
    'python3',
    [
      '-I',
      '-c',
      `import sys, pathlib
from PIL import Image
scratch, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for png in sorted(scratch.glob('*.png')):
    image = Image.open(png).convert('RGB')
    image.save(out / f'{png.stem}.jpg', quality=86, optimize=True, progressive=True)
    image.save(out / f'{png.stem}.avif', quality=64)
    for suffix in ('jpg', 'avif'):
        print(f'images/watch-faces/{png.stem}.{suffix}:', (out / f'{png.stem}.{suffix}').stat().st_size, 'bytes')`,
      scratch,
      path.join(root, 'public/images/watch-faces'),
    ],
    { stdio: 'inherit' },
  );
  console.log((await readdir(scratch)).length, 'stills drawn');
} finally {
  await browser.close();
  server.close();
  await rm(scratch, { recursive: true, force: true });
}
