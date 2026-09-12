import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const moduleURL = async (file, replacements = {}) => {
  let js = transpileModule(
    await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ModuleKind.ESNext } },
  ).outputText;
  for (const [name, value] of Object.entries(replacements))
    js = js.replaceAll(`from '${name}'`, `from '${value}'`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
};
const tourURL = await moduleURL('../lib/dreamliner-tour.ts');
const { sampleDreamlinerTour, tourPhase, TOUR_CHAPTERS, tourPixelRatio } =
  await import(tourURL);
const { flightLink, readFlightLink } = await import(
  await moduleURL('../lib/flight-links.ts', { './dreamliner-tour': tourURL })
);
const bytes = await fs.readFile(
  new URL('../public/models/dreamliner-787-9.glb', import.meta.url),
);
const metadata = JSON.parse(
  bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
);
assert.match(metadata.extras.license, /GPL-2.0/);
assert.ok(bytes.length < 6_000_000, 'Aircraft transfer stays under 6 MB');
const loader = new GLTFLoader().register(() => ({
  name: 'EXT_texture_webp',
  loadTexture: () => Promise.resolve(new T.Texture()),
}));
const model = (
  await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  )
).scene;
const plane = new T.Group();
plane.add(model);
const bounds = new T.Box3().setFromObject(model);
assert.ok(bounds.max.x - bounds.min.x > 62 && bounds.max.x - bounds.min.x < 64);
assert.ok(bounds.max.z - bounds.min.z > 59 && bounds.max.z - bounds.min.z < 61);
let triangles = 0,
  meshes = 0;
model.traverse((mesh) => {
  if (!mesh.isMesh) return;
  meshes++;
  triangles += mesh.geometry.index.count / 3;
  for (const value of mesh.geometry.attributes.normal.array)
    assert.ok(Number.isFinite(value));
});
assert.equal(meshes, 10, 'Merged exterior has ten main draw calls');
assert.ok(triangles > 90_000 && triangles < 110_000);
for (const name of ['fan-port', 'fan-starboard']) {
  const fan = model.getObjectByName(name);
  assert.ok(
    fan.geometry.index.count / 3 > 10_000,
    'Close-up fans retain actual blade geometry',
  );
}
for (const chapter of TOUR_CHAPTERS) {
  assert.equal(tourPhase(chapter.at), chapter.phase);
  const url = new URL(
    flightLink(new URL('https://example.test/?keep=1#flight'), {
      chapter: chapter.phase,
      project: 'bay-departure',
    }),
    'https://example.test',
  );
  assert.deepEqual(readFlightLink(url, ['bay-departure']), {
    chapter: chapter.phase,
    project: 'bay-departure',
  });
  assert.equal(url.searchParams.get('keep'), '1');
}
assert.equal(sampleDreamlinerTour(0, 1.6).visible, false);
assert.equal(sampleDreamlinerTour(0.025, 1.6).visible, false);
assert.equal(sampleDreamlinerTour(0.2, 1.6).visible, true);
for (const [width, height] of [
  [1589, 952],
  [1920, 1080],
  [390, 844],
  [375, 812],
  [844, 390],
]) {
  const aspect = width / height;
  let last = sampleDreamlinerTour(0, aspect);
  for (let i = 1; i <= 10000; i++) {
    const shot = sampleDreamlinerTour(i / 10000, aspect);
    for (const x of [
      ...shot.camera,
      ...shot.target,
      ...shot.aircraft,
      shot.fov,
    ])
      assert.ok(Number.isFinite(x));
    assert.ok(
      new T.Vector3(...shot.camera).distanceTo(new T.Vector3(...last.camera)) <
        0.65,
      'Camera is continuous',
    );
    assert.ok(
      new T.Vector3(...shot.camera).distanceTo(new T.Vector3(...shot.target)) >
        8,
      'Lens retains exterior clearance',
    );
    last = shot;
  }
  const cameraAt = (p) => {
    const shot = sampleDreamlinerTour(p, aspect);
    plane.position.set(...shot.aircraft);
    plane.rotation.x = shot.bank;
    plane.updateMatrixWorld(true);
    const c = new T.PerspectiveCamera(shot.fov, aspect, 0.15, 1200);
    c.position.set(...shot.camera);
    c.lookAt(...shot.target);
    c.setViewOffset(
      width,
      height,
      width * shot.offsetX,
      height * shot.offsetY,
      width,
      height,
    );
    c.updateMatrixWorld(true);
    return c;
  };
  // Each named part stays visible, including on narrow screens. The remainder
  // of the aircraft is intentionally cropped during these detail passes.
  for (const [p, part, xyz] of [
    [0.37, 'inlet', [-8.65, -1.1, 9.41]],
    [0.59, 'wing', [7, 3, 18]],
    [0.78, 'tail', [28, 8, 0]],
  ]) {
    const c = cameraAt(p),
      v = plane.localToWorld(new T.Vector3(...xyz)).project(c);
    assert.ok(
      Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85 && v.z > -1 && v.z < 1,
      `${width}x${height} ${String(part)} framing: ${v.toArray().join(',')}`,
    );
  }
  for (const p of [0.2, 0.97]) {
    const c = cameraAt(p);
    let extreme = 0;
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(attr, i)
          .applyMatrix4(mesh.matrixWorld)
          .project(c);
        extreme = Math.max(extreme, Math.abs(v.x), Math.abs(v.y));
      }
    });
    assert.ok(
      extreme < 1,
      `${width}x${height} wide shot ${p} crops aircraft: ${extreme}`,
    );
  }
  const ratios = [0, 1, 2].map((q) => tourPixelRatio(width, height, 3, q));
  assert.ok(ratios[0] < ratios[1] && ratios[1] < ratios[2]);
}
const layout = await fs.readFile(
  new URL('../app/layout.tsx', import.meta.url),
  'utf8',
);
assert.ok(
  !layout.includes('/tiles/') && !layout.includes('elevation.webp'),
  'Ground data is no longer preloaded',
);
const credits = await fs.readFile(
  new URL('../public/credits/dreamliner.html', import.meta.url),
  'utf8',
);
assert.match(credits, /dreamliner-source.zip/);
assert.ok(
  (
    await fs.stat(
      new URL('../public/credits/dreamliner-source.zip', import.meta.url),
    )
  ).size > 5_000_000,
);
console.log(
  `Passed: ${triangles.toLocaleString()} triangles, ${meshes} meshes; camera continuity and detail framing on five viewports; whole-aircraft wide shots; old chapter links; quality budgets; source credit archive.`,
);

const worker = await fs.readFile(
  new URL('../worker.ts', import.meta.url),
  'utf8',
);
assert.ok(
  !worker.includes('/tiles/'),
  'Early Hints must not preload old terrain',
);
assert.ok(
  worker.includes('</images/cruise-sky.jpg>; rel=preload; as=image'),
  'The universal sky is the early preload',
);
