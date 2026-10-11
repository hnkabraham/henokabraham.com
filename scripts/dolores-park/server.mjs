import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export async function startServer() {
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
    '.webp': 'image/webp',
  };
  const server = createServer(async (req, res) => {
    const file = path.join(
      root,
      decodeURIComponent(new URL(req.url, 'http://x').pathname),
    );
    try {
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile())
        throw Error('missing');
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
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
export async function launchBrowser() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(
    path.join(execSync('npm root -g').toString().trim(), 'playwright'),
  );
  return chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
}
export async function localPage(browser, origin, options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    ...options,
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['data:', 'blob:'].includes(url.protocol) || url.origin === origin
      ? route.continue()
      : route.abort();
  });
  page.on('pageerror', (e) => console.error(e));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  return page;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await startServer();
  console.log(`${origin}/scripts/dolores-park/live.html`);
}
