// Renders the Dolores Park scene (scripts/dolores-park/scene.html) to a PNG
// in headless Chromium, serving this repository on a local port for the
// scene's data, assets, three.js and the Garage GLB. The page may only reach
// that local server; every other request is aborted. Writes <out>.png and a
// <out>.json sidecar with the parameters and the scene's own report.
// Usage: node scripts/dolores-park/render.mjs <out.png> [key=value ...]
//   e.g. preset=streetview w=1600 h=1360 (see scripts/dolores-park/README.md)
// Needs Playwright installed globally (npm i -g playwright) and the assets
// fetched first: python3 scripts/dolores-park/fetch.py assets
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

const [out, ...pairs] = process.argv.slice(2);
if (!out)
  throw new Error(
    'Usage: node scripts/dolores-park/render.mjs <out.png> key=value ...',
  );
const params = new URLSearchParams(
  pairs.map((p) => {
    const eq = p.indexOf('=');
    if (eq < 1) throw new Error('Expected key=value: ' + p);
    return [p.slice(0, eq), p.slice(eq + 1)];
  }),
);
const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  const file = path.join(
    root,
    decodeURIComponent(new URL(req.url, 'http://x').pathname),
  );
  try {
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile())
      throw new Error('not a file');
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('missing');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(execSync('npm root -g').toString().trim(), 'playwright'),
);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.protocol === 'data:' ||
      url.protocol === 'blob:' ||
      (url.hostname === '127.0.0.1' && url.port === String(port))
      ? route.continue()
      : route.abort();
  });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (['error', 'warning'].includes(m.type()))
      console.log('console', m.type(), m.text().slice(0, 1200));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const started = Date.now();
  await page.goto(
    `http://127.0.0.1:${port}/scripts/dolores-park/scene.html?${params}`,
  );
  await page.waitForFunction(() => window.done, null, { timeout: 300000 });
  const result = await page.evaluate(() => ({
    png: window.png,
    error: window.error,
    info: window.sceneInfo,
  }));
  if (result.error || errors.length)
    throw new Error([result.error, ...errors].filter(Boolean).join('\n'));
  if (!result.png) throw new Error('Scene finished without a PNG');
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, Buffer.from(result.png.split(',')[1], 'base64'));
  await writeFile(
    out.replace(/\.png$/, '.json'),
    JSON.stringify(
      { params: Object.fromEntries(params), info: result.info },
      null,
      2,
    ),
  );
  console.log('wrote', out, `${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  server.close();
}
