// Renders the Golden Gate's towers and cables from the buffers that
// scripts/prepare-golden-gate.swift wrote, against a transparent background,
// with a three-quarter aerial camera and the sky's warm upper-right light.
// Only meshes that rise above the fog floor are loaded; the deck, piers and
// landscape never show. Writes <out>.png, <out>-data.png (height and
// distance per pixel for the sprite's fog and haze) and <out>.json (camera,
// horizon row and tower rows, so the sprite can be pinned to a horizon).
// Usage: node scripts/render-golden-gate.mjs <buffers dir> <out base>
//   [--camera=x,y,z] [--target=x,y,z] [--fov=30] [--size=1400x2000]
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, resolve, extname } from 'node:path';
import { build } from 'esbuild';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const options = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')),
);
const [dir = 'archive/models/golden-gate', out = 'archive/models/golden-gate/render'] = positional;
const numbers = (text, fallback) => (text ? text.split(/[,x]/).map(Number) : fallback);
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
  const camera = new T.PerspectiveCamera(opts.fov ?? 30, W / H, 5, 40000);
  camera.position.set(...opts.camera); camera.lookAt(...opts.target);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  r.render(stage, camera);
  const beauty = canvas.toDataURL('image/png');
  // Data pass: world height in red (metres, -100..300) and distance from
  // the camera in green (0..4000 m), so the sprite step can fade the fog
  // and thicken the haze per pixel whatever the camera angle.
  const mesh = stage.children[0];
  mesh.material = new T.ShaderMaterial({
    side: T.DoubleSide,
    vertexShader: 'varying vec3 vWorld; void main() { vWorld = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vWorld; uniform vec3 eye; void main() { gl_FragColor = vec4(clamp((vWorld.y + 100.0) / 400.0, 0.0, 1.0), clamp(distance(vWorld, eye) / 4000.0, 0.0, 1.0), 0.0, 1.0); }',
    uniforms: { eye: { value: camera.position.clone() } },
  });
  r.toneMapping = T.NoToneMapping; r.outputColorSpace = T.LinearSRGBColorSpace;
  r.render(stage, camera);
  // Where the eye level (the horizon of this camera) and the tower tops
  // land in the image, so the sprite can be anchored to the sky's horizon.
  const project = (x, y, z) => { const v = new T.Vector3(x, y, z).project(camera); return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H }; };
  const flat = new T.Vector3(...opts.target).sub(camera.position); flat.y = 0;
  flat.normalize().multiplyScalar(1e6).add(camera.position);
  const horizon = project(flat.x, flat.y, flat.z).y;
  const towers = [453, -476].map((x) => ({ x, top: project(x, 165, 0), fog: project(x, opts.fogTop, 0) }));
  return { png: beauty, data: canvas.toDataURL('image/png'), meshes: keep.length, triangles: total / 3, horizon, towers };
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
// 165; towers at x -476 and 453. The camera sits beyond the north end,
// 330 m up and a little to the ocean side, looking down the span, so the
// near tower stands large at the bottom and the bridge recedes upward.
// Options override the aerial defaults: --camera=x,y,z --target=x,y,z
// --fov=30 --size=1400x2000. The portrait sprite uses a camera below the
// tower tops so the towers rise above the horizon.
const [width, height] = numbers(options.size, [1400, 2000]);
const shot = {
  width, height, minTop: 45, fov: Number(options.fov ?? 30), fogTop: 66,
  camera: numbers(options.camera, [1350, 330, -100]),
  target: numbers(options.target, [-150, 90, 0]),
};
const result = await page.evaluate((o) => window.renderModelBridge(o), shot);
await writeFile(`${out}.json`, JSON.stringify({ ...shot, horizon: result.horizon, towers: result.towers }, null, 1));
await writeFile(`${out}.png`, Buffer.from(result.png.split(',')[1], 'base64'));
await writeFile(`${out}-data.png`, Buffer.from(result.data.split(',')[1], 'base64'));
console.log(`${out}.png: ${result.meshes} meshes, ${result.triangles.toLocaleString()} triangles`);
await browser.close();
server.close();
