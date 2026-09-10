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
  new URL('../public/scenery/bay-elevation.webp', import.meta.url),
);
// Lossless WebP (VP8L): RIFF header, then a 14-bit width-1 and height-1.
assert.equal(elevation.toString('latin1', 0, 4), 'RIFF');
assert.equal(elevation.toString('latin1', 8, 16), 'WEBPVP8L');
assert.equal(elevation[20], 0x2f, 'VP8L signature');
const bits = elevation.readUInt32LE(21);
const gridWidth = (bits & 0x3fff) + 1,
  gridHeight = ((bits >> 14) & 0x3fff) + 1;
assert.equal(gridWidth, 1025);
assert.equal(gridHeight, 1025);
assert.ok(Math.abs(RUNWAY_HEADING - Math.atan2(320.4, 166.45)) < 0.000001);
console.log(
  `Passed: ${meshCount} aircraft meshes; chapter positions; 2,000 continuous route samples; gear; camera clipping; elevation grid.`,
);

// Portfolio state and annotation schedules use the same authored flight data.
{
  const flightURL = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  const importSource = async (path, links = {}) => {
    let text = transpileModule(
      await fs.readFile(new URL(path, import.meta.url), 'utf8'),
      {
        compilerOptions: { module: ModuleKind.ESNext },
      },
    ).outputText;
    for (const [from, to] of Object.entries(links))
      text = text.replaceAll(`from '${from}'`, `from '${to}'`);
    return import(
      `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
    );
  };
  const { flights } = await importSource('../app/flight-data.ts');
  const { aviationLogbook } = await importSource(
    '../app/aviation-logbook-data.ts',
  );
  const { readFlightLink, flightLink, replaceFlightLink } = await importSource(
    '../lib/flight-links.ts',
    { './bay-flight': flightURL },
  );
  const { DEPARTURE_ANNOTATIONS, departureAnnotationAt } = await importSource(
    '../lib/bay-annotations.ts',
  );
  const ids = flights.map((item) => item.id);
  assert.equal(new Set(ids).size, flights.length);
  const manifest = JSON.parse(
    await fs.readFile(
      new URL('../public/tiles/manifest.json', import.meta.url),
    ),
  );
  const featured = flights.find((item) => item.id === 'bay-departure');
  assert.ok(
    featured && !featured.image,
    'The scene is featured without new imagery',
  );
  assert.ok(
    featured.features
      .join(' ')
      .includes(manifest.tiles.toLocaleString('en-US')),
  );
  assert.ok(
    featured.features
      .join(' ')
      .includes(manifest.bytes.toLocaleString('en-US')),
  );
  for (const slots of [24, 15]) {
    const edge = slots * (manifest.tile + 2 * manifest.border);
    assert.ok(
      featured.features.join(' ').includes(edge.toLocaleString('en-US')),
    );
    assert.ok(
      featured.features
        .join(' ')
        .includes(((edge * edge * 4) / 2 ** 20).toFixed(1)),
    );
  }
  assert.ok(featured.features.join(' ').includes('15 of the 16'));
  for (const project of ids)
    for (const chapter of BAY_CHAPTERS) {
      const path = flightLink(new URL('https://example.test/?keep=1#flight'), {
        project,
        chapter: chapter.phase,
      });
      const url = new URL(path, 'https://example.test');
      assert.deepEqual(readFlightLink(url, ids), {
        project,
        chapter: chapter.phase,
      });
      assert.equal(url.searchParams.get('keep'), '1');
      assert.equal(url.hash, '');
      assert.equal(
        sampleBayFlight(chapter.at).phase,
        chapter.phase,
        'Shared chapter restores to its own phase',
      );
    }
  assert.deepEqual(
    readFlightLink(
      new URL('https://example.test/?project=unknown&chapter=bogus'),
      ids,
    ),
    { project: null, chapter: null },
  );
  assert.equal(
    new URL(
      flightLink(new URL('https://example.test/?chapter=bay#about'), {
        project: ids[0],
      }),
      'https://example.test',
    ).hash,
    '#about',
  );
  const saved = {
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history,
  };
  try {
    const url = new URL('https://example.test/?chapter=bay');
    globalThis.window = { location: url };
    globalThis.location = url;
    let replaces = 0;
    globalThis.history = {
      state: { framework: 'retained' },
      replaceState(state, _unused, path) {
        assert.deepEqual(state, { framework: 'retained' });
        replaces++;
        url.href = new URL(path, url).href;
      },
      pushState() {
        assert.fail('Scrolling and selection must not add history entries');
      },
    };
    replaceFlightLink({ project: ids[1] });
    replaceFlightLink({ project: ids[1] });
    replaceFlightLink({ chapter: 'cruise' });
    assert.equal(replaces, 2, 'Unchanged URLs do not write history');
    assert.equal(
      readFlightLink(url, ids).project,
      ids[1],
      'Chapter changes retain project selection',
    );
  } finally {
    Object.assign(globalThis, saved);
  }
  for (let i = 0; i < DEPARTURE_ANNOTATIONS.length; i++) {
    const item = DEPARTURE_ANNOTATIONS[i];
    assert.ok(item.from >= 0 && item.until <= 1 && item.from < item.until);
    assert.ok(
      i === 0 || DEPARTURE_ANNOTATIONS[i - 1].until < item.from,
      'Callouts never overlap',
    );
    assert.equal(departureAnnotationAt(item.from)?.id, item.id);
    assert.equal(departureAnnotationAt(item.until), null);
  }
  assert.equal(departureAnnotationAt(0), null);
  assert.equal(departureAnnotationAt(1), null);
  const gearNote = DEPARTURE_ANNOTATIONS.find((item) => item.id === 'gear');
  assert.ok(
    sampleBayFlight(gearNote.from).gear < 1 &&
      sampleBayFlight(gearNote.until).gear > 0,
  );
  assert.ok(aviationLogbook.length >= 2);
  for (const entry of aviationLogbook) {
    assert.equal(
      entry.kind,
      'site-reference',
      'Seeds describe repository facts, never invented personal history',
    );
    assert.equal(entry.date, null, 'No invented flight dates');
    assert.equal(entry.photos.length, 0, 'No photographs seeded');
    assert.ok(entry.source && ids.includes(entry.projectId));
  }
  const scroll = await fs.readFile(
    new URL('../app/scroll-departure.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    scroll.includes('sceneReady &&') &&
      scroll.includes('progress.current = chapter.at;'),
    'Scene mounting waits for restored progress',
  );
  const logbook = await fs.readFile(
    new URL('../app/aviation-logbook.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    logbook.includes('loading="lazy"') &&
      logbook.includes('width={photo.width}') &&
      logbook.includes('height={photo.height}'),
  );
  const css = await fs.readFile(
    new URL('../app/bay-departure.css', import.meta.url),
    'utf8',
  );
  assert.ok(
    css.replace(/\s+/g, ' ').includes(
      '(max-width: 1100px), (max-height: 700px), (prefers-reduced-motion: reduce)',
    ),
  );
  console.log(
    'content check: measured project budgets, every project/chapter URL round trip, replace-only history, sparse scene annotations and honest logbook seeds',
  );
}
