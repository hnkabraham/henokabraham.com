import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
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
const { projectWing, insideWing } = await import(
  await moduleURL('../lib/dreamliner-cut.ts', {
    './dreamliner-engine': await moduleURL('../lib/dreamliner-engine.ts'),
  })
);
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
assert.ok(bytes.length < 1_500_000, 'Aircraft transfer stays under 1.5 MB');
assert.ok(
  metadata.extensionsUsed.includes('KHR_draco_mesh_compression'),
  'The shipped mesh is Draco-compressed',
);
// The browser decodes Draco in workers, which Node lacks. Decode here with the
// reference codec and hand the loader the plain model it would have produced.
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
const decoded = await io.readBinary(new Uint8Array(bytes));
for (const extension of decoded.getRoot().listExtensionsUsed())
  if (extension.extensionName === 'KHR_draco_mesh_compression')
    extension.dispose();
const plain = Buffer.from(await io.writeBinary(decoded));
const loader = new GLTFLoader().register(() => ({
  name: 'EXT_texture_webp',
  loadTexture: () => Promise.resolve(new T.Texture()),
}));
const model = (
  await loader.parseAsync(
    plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength),
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
    plane.rotation.order = 'YXZ';
    plane.rotation.set(shot.bank, shot.heading, 0);
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
  // The exhaust stays in frame through the hold, including on narrow screens
  // (the rest of the aircraft is intentionally cropped there), and the
  // departing aircraft stays in frame at every chapter stop but the last.
  for (const [p, part, xyz] of [
    [0.2, 'exhaust', [-2.9, -1.13, 9.41]],
    [0.37, 'departing aircraft', [0, 1, 0]],
    [0.59, 'departing aircraft', [0, 1, 0]],
    [0.78, 'departing aircraft', [0, 1, 0]],
  ]) {
    const c = cameraAt(p),
      v = plane.localToWorld(new T.Vector3(...xyz)).project(c);
    assert.ok(
      Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85 && v.z > -1 && v.z < 1,
      `${width}x${height} ${String(part)} framing: ${v.toArray().join(',')}`,
    );
  }
  // The last chapter is the leaving shot: the aircraft is out in the right of
  // the frame, crossing its edge but not yet through it.
  {
    const c = cameraAt(0.9),
      v = plane.localToWorld(new T.Vector3(0, 1, 0)).project(c);
    assert.ok(
      v.x > 0.45 && v.x < 1.1 && Math.abs(v.y) < 0.85 && v.z > -1 && v.z < 1,
      `${width}x${height} leaving shot: ${v.toArray().join(',')}`,
    );
  }
  // The wing through the headline: somewhere in the opening (the caption
  // remounts at 18%) the visible wing, clipped to the near plane and the
  // frame, must cover part of the headline on every screen, or the cut
  // would silently vanish if the tour were retuned. The headline box
  // follows the stylesheet: 7% in from the left, below the eyebrow, under
  // half the width on landscape screens and most of it on portrait ones.
  {
    const portrait = width <= 800;
    // A short landscape screen (the phone on its side) sets the caption
    // small and high; the wing crosses less of it, so it only has to touch.
    const short = !portrait && height <= 600;
    const box = portrait
      ? [width * 0.07, Math.max(height * 0.13, 100) + 30, width * 0.88, 130]
      : short
        ? [width * 0.07, 145, width * 0.36, 90]
        : [width * 0.07, Math.max(height * 0.19, 112) + 40, width * 0.36, 190];
    let covered = 0;
    for (let p = 0.05; p <= 0.1751; p += 0.005) {
      const c = cameraAt(p);
      const shot = sampleDreamlinerTour(p, aspect);
      let hits = 0;
      for (const poly of projectWing(c, model, shot.flex, width, height)) {
        assert.ok(poly.length <= 3 * 24 && poly.every(Number.isFinite));
        for (let gx = 0; gx <= 10; gx++)
          for (let gy = 0; gy <= 4; gy++)
            if (
              insideWing(
                poly,
                box[0] + (box[2] * gx) / 10,
                box[1] + (box[3] * gy) / 4,
              )
            )
              hits++;
      }
      covered = Math.max(covered, hits / 55);
    }
    assert.ok(
      covered > (short ? 0 : 0.1),
      `${width}x${height} wing covers at most ${(covered * 100).toFixed(0)}% of the headline in the opening`,
    );
  }
  // The aircraft overtakes from behind the viewer: on the first visible
  // sample nothing of it may already be inside the frame, on any screen (the
  // landscape phone's frame is the widest), or it would pop into view.
  {
    const c = cameraAt(0.026);
    let inside = 0;
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(attr, i)
          .applyMatrix4(mesh.matrixWorld)
          .project(c);
        if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > -1 && v.z < 1)
          inside++;
      }
    });
    assert.equal(
      inside,
      0,
      `${width}x${height} aircraft pops into frame: ${inside} vertices visible at 0.026`,
    );
  }
  // The fly-by passes close. The lens keeps clear of the airframe throughout
  // the pass and the swing around the wing, with room for the wing flex and
  // the bob that the sampler cannot see.
  {
    let nearest = Infinity,
      nearestAt = 0;
    const v = new T.Vector3();
    for (let p = 0.025; p <= 0.36; p += 0.002) {
      const shot = sampleDreamlinerTour(p, aspect);
      plane.position.set(...shot.aircraft);
      plane.rotation.order = 'YXZ';
      plane.rotation.set(shot.bank, shot.heading, 0);
      plane.updateMatrixWorld(true);
      const eye = new T.Vector3(...shot.camera);
      model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const attr = mesh.geometry.attributes.position;
        for (let i = 0; i < attr.count; i++) {
          const d = v
            .fromBufferAttribute(attr, i)
            .applyMatrix4(mesh.matrixWorld)
            .distanceTo(eye);
          if (d < nearest) {
            nearest = d;
            nearestAt = p;
          }
        }
      });
    }
    assert.ok(
      nearest > 2,
      `${width}x${height} lens clears the airframe by ${nearest.toFixed(2)} m at ${nearestAt.toFixed(3)}`,
    );
  }
  for (const p of [0.62, 0.78]) {
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
  // And by the end of the scroll it has gone off the right of the frame: not
  // one vertex is left inside it, on any screen.
  {
    const c = cameraAt(1);
    let leftmost = Infinity;
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(attr, i)
          .applyMatrix4(mesh.matrixWorld)
          .project(c);
        leftmost = Math.min(leftmost, v.x);
      }
    });
    assert.ok(
      leftmost > 1,
      `${width}x${height} aircraft has not left the frame: ${leftmost}`,
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
  `Passed: ${triangles.toLocaleString()} triangles, ${meshes} meshes; camera continuity, fly-by clearance, no pop-in and detail framing on five viewports; whole-aircraft wide shots; old chapter links; quality budgets; source credit archive.`,
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
  worker.includes(
    '</images/cruise-sky.avif>; rel=preload; as=image; type=image/avif',
  ),
  'The universal sky, as AVIF with its type, is the early preload',
);
// The stylesheet falls back from AVIF to the original encodings.
const stylesheet = await fs.readFile(
  new URL('../app/bay-departure.css', import.meta.url),
  'utf8',
);
for (const [modern, fallback] of [
  ['cruise-sky.avif', 'cruise-sky.jpg'],
  ['cloud-sprite.avif', 'cloud-sprite.png'],
]) {
  const rule = stylesheet.indexOf(
    `url('/images/${modern}') type('image/avif')`,
  );
  assert.ok(rule > 0, `${modern} is offered through image-set()`);
  assert.ok(
    stylesheet.lastIndexOf(`background: url('/images/${fallback}')`, rule) > 0,
    `${fallback} stays the plain background before the image-set`,
  );
  const [modernSize, fallbackSize] = await Promise.all(
    [modern, fallback].map(
      async (name) =>
        (await fs.stat(new URL(`../public/images/${name}`, import.meta.url)))
          .size,
    ),
  );
  assert.ok(
    modernSize * 5 < fallbackSize,
    `${modern} is at most a fifth of ${fallback}`,
  );
}

// The phone variant carries the desktop Draco mesh under 2048² textures.
const phoneBytes = await fs.readFile(
  new URL('../public/models/dreamliner-787-9-phone.glb', import.meta.url),
);
const phoneMetadata = JSON.parse(
  phoneBytes.toString('utf8', 20, 20 + phoneBytes.readUInt32LE(12)),
);
assert.ok(phoneBytes.length < 700_000, 'Phone aircraft stays under 700 KB');
assert.equal(phoneMetadata.extras.license, metadata.extras.license);
assert.deepEqual(phoneMetadata.meshes, metadata.meshes);
assert.deepEqual(phoneMetadata.materials, metadata.materials);
assert.deepEqual(phoneMetadata.accessors, metadata.accessors);
const phoneDocument = await io.readBinary(new Uint8Array(phoneBytes));
const phoneTextures = phoneDocument.getRoot().listTextures();
assert.equal(phoneTextures.length, decoded.getRoot().listTextures().length);
for (const texture of phoneTextures)
  assert.deepEqual(texture.getSize(), [2048, 2048], texture.getName());
for (const texture of decoded.getRoot().listTextures())
  assert.deepEqual(texture.getSize(), [4096, 4096], texture.getName());
const scene = await fs.readFile(
  new URL('../app/dreamliner-scene.tsx', import.meta.url),
  'utf8',
);
assert.ok(
  scene.includes(
    "width < 800\n          ? '/models/dreamliner-787-9-phone.glb'",
  ),
  'Narrow viewports fetch the phone aircraft',
);
// The Golden Gate landmark: a small sprite anchored to the sky photograph
// inside the poster, on the home page and the 404 page alike.
const landmark = await Promise.all(
  ['golden-gate.avif', 'golden-gate.png'].map(
    async (name) =>
      (await fs.stat(new URL(`../public/images/${name}`, import.meta.url)))
        .size,
  ),
);
assert.ok(landmark[0] < 40_000, 'The landmark AVIF stays under 40 KB');
assert.ok(
  landmark[1] < 160_000,
  'The landmark PNG fallback stays under 160 KB',
);
assert.ok(
  stylesheet.includes("url('/images/golden-gate.avif') type('image/avif')"),
  'The landmark is offered as AVIF through image-set()',
);
assert.match(stylesheet, /\.bay-poster \{[^}]*container-type: size/);
assert.match(stylesheet, /\.bay-landmark \{[^}]*--landmark-x: 0\.17/);
assert.match(stylesheet, /\.bay-landmark \{[^}]*--landmark-y: 0\.9/);
assert.match(stylesheet, /\.bay-landmark \{[^}]*--landmark-h: 0\.33/);
// Portrait swaps in a sprite rendered from just above the tower tops and
// pins its eye level to the photo's horizon, so both towers stand on the
// cloud deck instead of the far one floating above it.
const portrait = await Promise.all(
  ['golden-gate-portrait.avif', 'golden-gate-portrait.png'].map(
    async (name) =>
      (await fs.stat(new URL(`../public/images/${name}`, import.meta.url)))
        .size,
  ),
);
assert.ok(portrait[0] < 45_000, 'The portrait landmark AVIF stays under 45 KB');
assert.ok(
  portrait[1] < 200_000,
  'The portrait landmark PNG stays under 200 KB',
);
const portraitRule = stylesheet.match(
  /@media \(max-width: 800px\) \{\s*\.bay-landmark \{([^}]*)\}/,
)?.[1];
assert.ok(portraitRule, 'Portrait restyles the landmark');
for (const declaration of [
  '--landmark-y: 0.56',
  '--landmark-anchor: -0.074',
  '--landmark-ratio: 616 / 796',
  "url('/images/golden-gate-portrait.avif') type('image/avif')",
])
  assert.ok(portraitRule.includes(declaration), `Portrait sets ${declaration}`);
// Safari 26 on iPhone tints its bars from the sticky frame's colour.
assert.match(stylesheet, /\.bay-sticky \{[^}]*background-color: #6398cf/);
for (const file of ['../app/scroll-departure.tsx', '../app/not-found.tsx'])
  assert.ok(
    (await fs.readFile(new URL(file, import.meta.url), 'utf8')).includes(
      '<div className="bay-landmark" />',
    ),
    `${file} places the landmark inside the poster`,
  );
// The Immersive control: fullscreen where the API exists, the Home Screen
// card on an iPhone (WebKit has no element fullscreen there), nothing once
// launched from the Home Screen.
const departure = await fs.readFile(
  new URL('../app/scroll-departure.tsx', import.meta.url),
  'utf8',
);
for (const line of [
  "if (standalone) return 'none';",
  "if (d.fullscreenEnabled || d.webkitFullscreenEnabled) return 'fullscreen';",
  "return /iPhone|iPod/.test(navigator.userAgent) ? 'install' : 'none';",
  "{immersiveMode === 'install' && (",
  '<strong>Add to Home Screen</strong>',
])
  assert.ok(departure.includes(line), `The Immersive control handles: ${line}`);
console.log(
  `Passed: phone aircraft ${phoneBytes.length.toLocaleString()} bytes with the desktop mesh; AVIF sky and cloud with fallbacks; Golden Gate landmark ${landmark[0].toLocaleString()} bytes.`,
);
