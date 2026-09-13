// Renders the Golden Gate's towers and cables from the buffers that
// scripts/prepare-golden-gate.swift wrote, against a transparent background,
// with a three-quarter aerial camera and the sky's warm upper-right light.
// Only meshes that rise above the fog floor are loaded; the deck, piers and
// landscape never show. Writes <out>.png and <out>.json (screen rows of
// world heights at each tower, which the sprite script uses for the fog).
// Usage: node scripts/render-golden-gate.mjs <buffers dir> <out base>
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, resolve, extname } from 'node:path';
import { build } from 'esbuild';

const [dir = 'archive/models/golden-gate', out = 'archive/models/golden-gate/render'] =
  process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(
  join(execSync('npm root -g').toString().trim(), 'playwright'),
);
const three = await build({
  stdin: { contents: "import * as THREE from 'three'; window.THREE = THREE;", resolveDir: process.cwd() },
  bundle: true, format: 'iife', write: false, logLevel: 'error',
});
const scene = `
window.renderModelBridge = async function (opts) {
  const T = window.THREE, W = opts.width, H = opts.height;
  const [pos, idx, meta] = await Promise.all([
    fetch('/golden-gate-positions.bin').then((r) => r.arrayBuffer()),
    fetch('/golden-gate-indices.bin').then((r) => r.arrayBuffer()),
    fetch('/golden-gate-meshes.json').then((r) => r.json()),
  ]);
  const positions = new Float32Array(pos), all = new Uint32Array(idx);
  const keep = meta.meshes.filter((m) => m.max[1] > opts.minTop && !/Landscape/.test(m.name));
  let total = 0; for (const m of keep) total += m.indexCount;
  const indices = new Uint32Array(total);
  let o = 0; for (const m of keep) { indices.set(all.subarray(m.indexStart, m.indexStart + m.indexCount), o); o += m.indexCount; }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
  const r = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(1); r.setSize(W, H, false); r.setClearColor(0x000000, 0);
  r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.AgXToneMapping; r.toneMappingExposure = 1.05;
  const stage = new T.Scene();
  stage.add(new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0xc0362c, roughness: 0.62, metalness: 0.12, side: T.DoubleSide })));
  stage.add(new T.HemisphereLight(0xcfe3f5, 0xdad8d0, 1.3));
  const sun = new T.DirectionalLight(0xfff1dc, 2.6); sun.position.set(0.4, 0.75, 0.55).multiplyScalar(1000); stage.add(sun);
  const camera = new T.PerspectiveCamera(24, W / H, 5, 40000);
  camera.position.set(...opts.camera); camera.lookAt(...opts.target);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  r.render(stage, camera);
  const project = (x, y) => { const v = new T.Vector3(x, y, 0).project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; };
  const refs = {};
  for (const [name, x] of Object.entries(opts.towers)) { refs[name] = {}; for (let h = -20; h <= 180; h += 5) refs[name][h] = project(x, h); }
  return { png: canvas.toDataURL('image/png'), refs, meshes: keep.length, triangles: total / 3 };
};`;
const types = { '.bin': 'application/octet-stream', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(`<canvas id="c"></canvas><script>${three.outputFiles[0].text}</script><script>${scene}</script>`);
  }
  try {
    const body = await readFile(resolve(dir, '.' + path));
    res.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (error) => console.error('page:', String(error).slice(0, 300)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
// The model's units are metres with the deck at y 6 and the tower tops at
// 165; towers at x -476 and 453. The camera looks from 2.5 km out and 380 m
// up, from the north-east, so the portals show and the span recedes.
const result = await page.evaluate((o) => window.renderModelBridge(o), {
  width: 2400, height: 1000, minTop: 45,
  camera: [2000, 380, 1450], target: [-10, 95, 0],
  towers: { south: -476, north: 453 },
});
await writeFile(`${out}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
await writeFile(`${out}.json`, JSON.stringify(result.refs));
console.log(`${out}.png: ${result.meshes} meshes, ${result.triangles.toLocaleString()} triangles`);
await browser.close();
server.close();
