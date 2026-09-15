// Structural checks for the Garage car model and viewer: this doesn't
// re-run the full mocked-hooks lifecycle harness scripts/check-dreamliner-
// lifecycle.mjs does for the aircraft — that's a real gap, worth closing if
// this viewer gets load-bearing — but it does guard the regressions most
// likely from editing this feature: a missing or oversized asset, a lost
// license notice, or someone deleting the disposal/visibility code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

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

const scene = await fs.readFile(
  new URL('../app/garage-scene.tsx', import.meta.url),
  'utf8',
);
for (const pattern of [
  /webglcontextlost/,
  /IntersectionObserver/,
  /document\.hidden/,
  /reducedMotion/,
  /renderer\.dispose\(\)/,
  /geometries\.forEach\(\(g\) => g\.dispose\(\)\)/,
])
  assert.match(
    scene,
    pattern,
    `garage-scene.tsx keeps its lifecycle-safety pattern: ${pattern}`,
  );

console.log(
  `Passed: garage GLB (${bytes.length.toLocaleString()} bytes, ${metadata.materials.length} materials, Draco-compressed), licence notices in the GLB and the credits page, and the viewer's lifecycle-safety patterns are all present.`,
);
