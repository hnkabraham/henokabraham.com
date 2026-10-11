// Structural checks for the Garage: the GT350 model, the Dolores Park scene
// it's parked in, and the viewer that shows them. This doesn't re-run the
// full mocked-hooks lifecycle harness scripts/check-dreamliner-lifecycle.mjs
// does for the aircraft (scripts/dolores-park/verify-live.mjs drives the
// viewer itself in a real browser: budgets, orbit limits, idle rendering,
// disposal and context recovery), but it does guard the regressions most
// likely from editing this feature: a missing or oversized asset, a lost
// licence notice, a backdrop the build doesn't version, or someone deleting
// the disposal/visibility code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { GARAGE_SUN, SCENE_FILES } from './scene-assets.mjs';

const glbPath = new URL('../public/models/garage-gt350r.glb', import.meta.url);
const bytes = await fs.readFile(glbPath);
assert.equal(
  bytes.toString('ascii', 0, 4),
  'glTF',
  'garage-gt350r.glb is a valid GLB container',
);
const metadata = JSON.parse(
  bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)),
);
assert.match(
  metadata.asset?.copyright ?? '',
  /CC-BY-NC-SA-4\.0/i,
  'the GLB carries its licence in asset.copyright',
);
assert.match(
  metadata.extras?.license ?? '',
  /CC-BY-NC-SA-4\.0/i,
  "the GLB carries its licence in the top-level extras (matching the aircraft GLB's convention)",
);
assert.match(
  metadata.extras?.source ?? '',
  /sketchfab\.com/,
  'the GLB records its Sketchfab source URL in extras',
);
assert.ok(
  bytes.length < 2_000_000,
  `garage-gt350r.glb (${bytes.length.toLocaleString()} bytes) stays under a 2 MB budget`,
);
assert.ok(
  metadata.extensionsUsed?.includes('KHR_draco_mesh_compression'),
  'the shipped mesh is Draco-compressed',
);
assert.ok(
  (metadata.materials?.length ?? 0) > 0,
  'the merge left at least one material',
);

// The park: OSM-derived geometry is ODbL, so each GLB carries the licence
// summary and source, and the shipped download (model plus the one sun's six
// backdrop faces) holds to the budgets the viewer was built against.
const readGlb = async (path) => {
  const data = await fs.readFile(new URL(`../public/${path}`, import.meta.url));
  assert.equal(data.toString('ascii', 0, 4), 'glTF', `${path} is a GLB`);
  return {
    data,
    json: JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))),
  };
};
const parkSun = (
  await fs.readFile(
    new URL('../app/garage-park-scene.tsx', import.meta.url),
    'utf8',
  )
).match(/sun: '(\w+)'/)?.[1];
assert.equal(
  parkSun,
  GARAGE_SUN,
  `the viewer's sun ('${parkSun}') is the one scene-assets.mjs versions ('${GARAGE_SUN}')`,
);
const park = {};
for (const [profile, budget] of [
  ['', 6_000_000],
  ['-phone', 3_000_000],
]) {
  const path = `models/dolores-park${profile}.glb`;
  const { data, json } = await readGlb(path);
  assert.match(
    json.asset?.copyright ?? '',
    /CC0.*PDDL.*public domain.*ODbL/s,
    `${path} summarises its sources' licences in asset.copyright`,
  );
  assert.match(
    json.extras?.license ?? '',
    /ODbL-1\.0/,
    `${path} extras.license`,
  );
  assert.match(
    json.extras?.source ?? '',
    /openstreetmap/,
    `${path} extras.source`,
  );
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_texture_webp'])
    assert.ok(
      json.extensionsUsed?.includes(extension),
      `${path} uses ${extension}`,
    );
  const sky = SCENE_FILES.filter(
    (file) =>
      new RegExp(
        `^scenery/dolores-sky(-[a-z]+)?${profile}-[pn][xyz]\\.webp$`,
      ).test(file) &&
      (profile || !file.includes('-phone-')),
  );
  assert.equal(
    sky.length,
    6,
    `six versioned backdrop faces for '${profile || 'desktop'}'`,
  );
  let total = data.length;
  for (const face of sky)
    total += (await fs.stat(new URL(`../public/${face}`, import.meta.url)))
      .size;
  assert.ok(
    total <= budget,
    `${path} plus its backdrop (${total.toLocaleString()} bytes) stays within ${budget.toLocaleString()}`,
  );
  assert.ok(SCENE_FILES.includes(path), `${path} is versioned`);
  park[profile ? 'phone' : 'desktop'] = total;
}

const credits = await fs.readFile(
  new URL('../public/credits/garage.html', import.meta.url),
  'utf8',
);
assert.match(credits, /Ddiaz Design/, 'credits page names the author');
assert.match(credits, /CC BY-NC-SA 4\.0/, 'credits page names the licence');
assert.match(
  credits,
  /sketchfab\.com\/3d-models\/2016-ford-mustang-shelby-gt350r/,
  'credits page links the source model',
);
assert.match(credits, /OpenStreetMap/, 'credits page credits OpenStreetMap');
assert.match(credits, /ODbL/, 'credits page names the ODbL');

const section = await fs.readFile(
  new URL('../app/garage-section.tsx', import.meta.url),
  'utf8',
);
assert.match(
  section,
  /href="https:\/\/www\.openstreetmap\.org\/copyright"/,
  'the section shows OpenStreetMap attribution beside the scene',
);
for (const [, image] of section.matchAll(
  /"?(\/images\/garage-[\w-]+\.(?:avif|jpg))/g,
))
  await fs
    .access(new URL(`../public${image}`, import.meta.url))
    .catch(() =>
      assert.fail(`the section's poster ${image} exists in public/`),
    );

// The viewer's lifecycle lives in the shared library; the component adds
// the lazy start and the reduced-motion path.
const viewer = [
  await fs.readFile(
    new URL('../app/garage-park-scene.tsx', import.meta.url),
    'utf8',
  ),
  await fs.readFile(
    new URL('../lib/dolores-park-viewer.js', import.meta.url),
    'utf8',
  ),
].join('\n');
for (const pattern of [
  /webglcontextlost/,
  /IntersectionObserver/,
  /rootMargin/,
  /document\.hidden/,
  /reducedMotion/,
  /renderer\.dispose\(\)/,
  /geometries\.forEach\(\(g\) => g\.dispose\(\)\)/,
  /enableZoom = false/,
  /touchAction = 'pan-y'/,
  /scrollFriendly: true/,
])
  assert.match(
    viewer,
    pattern,
    `the Garage viewer keeps its lifecycle-safety pattern: ${pattern}`,
  );

console.log(
  `Passed: garage GLB (${bytes.length.toLocaleString()} bytes, ${metadata.materials.length} materials, Draco-compressed), the park scene (${park.desktop.toLocaleString()} bytes desktop, ${park.phone.toLocaleString()} phone, with the '${GARAGE_SUN}' backdrop), licence notices in the GLBs, the credits page and the section, and the viewer's lifecycle-safety patterns are all present.`,
);
