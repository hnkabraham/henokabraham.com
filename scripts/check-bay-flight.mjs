import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const source = await fs.readFile(
  new URL('../lib/bay-flight.ts', import.meta.url),
  'utf8',
);
const js = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext },
}).outputText;
const { sampleBayFlight, sampleBayCamera, BAY_CHAPTERS, RUNWAY_HEADING } =
  await import(
    `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  );
const bytes = await fs.readFile(
  new URL('../public/models/boeing-787-9.glb', import.meta.url),
);
// Only image decoding is stubbed: geometry, hierarchy, materials and axes parse normally.
const loader = new GLTFLoader().register(() => ({
  name: 'EXT_texture_webp',
  loadTexture: () => Promise.resolve(new T.Texture()),
}));
const gltf = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const bounds = new T.Box3().setFromObject(gltf.scene);
assert.ok(
  bounds.max.x - bounds.min.x > 60 && bounds.max.z - bounds.min.z > 59,
  'Expected meter-scale Dreamliner geometry',
);
const pivot = new T.Group();
pivot.rotation.y = -Math.PI / 2;
pivot.add(gltf.scene);
const plane = new T.Group();
plane.add(pivot);
plane.updateMatrixWorld(true);
let meshCount = 0,
  fanCount = 0;
gltf.scene.traverse((n) => {
  if (n.isMesh) {
    meshCount++;
    if (/Object_(5|7|9|11)_/.test(n.name)) fanCount++;
  }
});
assert.equal(
  fanCount,
  4,
  'Fan node names must match the actual optimized airframe',
);
for (const chapter of BAY_CHAPTERS)
  assert.equal(sampleBayFlight(chapter.at).phase, chapter.phase);
assert.equal(sampleBayFlight(-1).phase, 'preflight');
assert.equal(sampleBayFlight(2).phase, 'cruise');
assert.equal(sampleBayFlight(0).gear, 1);
assert.equal(sampleBayFlight(0.58).gear, 0);
let last = sampleBayFlight(0),
  minClearance = Infinity;
for (let i = 1; i <= 2000; i++) {
  const p = i / 2000,
    shot = sampleBayFlight(p);
  for (const value of [...shot.position, shot.heading, shot.pitch, shot.bank])
    assert.ok(Number.isFinite(value));
  assert.ok(
    shot.position[1] >= last.position[1] - 0.001,
    'Altitude must not decrease',
  );
  assert.ok(
    Math.abs(shot.heading - last.heading) < 0.025,
    `Heading jump near ${p}`,
  );
  assert.ok(
    Math.hypot(...shot.position.map((v, j) => v - last.position[j])) < 40,
    'Continuous travel',
  );
  if (p < 0.34)
    assert.equal(
      shot.position[1],
      0,
      'Aircraft stays on the runway before rotation',
    );
  minClearance = Math.min(minClearance, shot.position[1]);
  last = shot;
}
for (const [width, height] of [
  [1440, 900],
  [1920, 1080],
  [375, 812],
  [390, 844],
  [844, 390],
]) {
  let extremes = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i <= 100; i++) {
    const p = i / 100,
      shot = sampleBayFlight(p),
      comp = sampleBayCamera(p, width / height);
    plane.rotation.set(shot.pitch, shot.heading, shot.bank, 'YXZ');
    plane.updateMatrixWorld(true);
    const camera = new T.PerspectiveCamera(comp.fov, width / height, 1, 250000);
    camera.position.set(...comp.position);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(
      width,
      height,
      width * comp.offsetX,
      height * comp.offsetY,
      width,
      height,
    );
    camera.updateMatrixWorld(true);
    gltf.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let k = 0; k < attr.count; k++) {
        const v = new T.Vector3()
          .fromBufferAttribute(attr, k)
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);
        extremes = [
          Math.min(extremes[0], v.x),
          Math.max(extremes[1], v.x),
          Math.min(extremes[2], v.y),
          Math.max(extremes[3], v.y),
        ];
        assert.ok(
          v.z > -1 && v.z < 1,
          'Aircraft must lie between camera clipping planes',
        );
        assert.ok(
          Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98,
          `Aircraft cropped at ${width}x${height}, progress ${p}: ${v.x}, ${v.y}`,
        );
      }
    });
  }
  console.log(
    `${width}×${height} aircraft framing: ${extremes.map((n) => n.toFixed(2)).join(', ')}`,
  );
}
const elevation = await fs.readFile(
  new URL('../public/scenery/bay-elevation.bin', import.meta.url),
);
assert.equal(elevation.length, 257 * 257 * 2);
assert.ok(Math.abs(RUNWAY_HEADING - Math.atan2(320.4, 166.45)) < 0.000001);
console.log(
  `Passed: ${meshCount} aircraft meshes; chapter positions; 2,000 continuous route samples; gear; camera clipping; elevation grid.`,
);
