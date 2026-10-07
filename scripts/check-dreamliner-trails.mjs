// The wake behind the 787: the contrails and tip vortices are laid along the
// track the aircraft has flown, so they must start at the live airframe,
// follow its past positions, curve through the turn, rewind with the scroll
// and keep each puff fixed in the air as it drifts aft.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as THREE from 'three';
const moduleURL = async (file, replacements = {}) => {
  let js = transpileModule(
    await fs.readFile(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ModuleKind.ESNext } },
  ).outputText;
  for (const [name, value] of Object.entries(replacements))
    js = js.replaceAll(`from '${name}'`, `from '${value}'`);
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
};
const engineURL = await moduleURL('../lib/dreamliner-engine.ts');
const trackURL = await moduleURL('../lib/dreamliner-track.ts');
const { tourAircraft, sampleDreamlinerTour } = await import(
  await moduleURL('../lib/dreamliner-tour.ts')
);
const { createFlightTrack, AIR_FLOW } = await import(trackURL);
const { createContrails, CONTRAIL_SOURCES } = await import(
  await moduleURL('../lib/dreamliner-contrails.ts', {
    './dreamliner-engine': engineURL,
    './dreamliner-track': trackURL,
  })
);
const { createVortices, VORTEX_SOURCES } = await import(
  await moduleURL('../lib/dreamliner-vortices.ts', {
    './dreamliner-engine': engineURL,
    './dreamliner-track': trackURL,
  })
);

// The lens frames the same flight the wake is laid along.
for (let i = 0; i <= 400; i++) {
  const p = i / 400;
  const pose = tourAircraft(p);
  for (const aspect of [0.46, 1.6, 2.2]) {
    const shot = sampleDreamlinerTour(p, aspect);
    assert.deepEqual(pose.position, shot.aircraft);
    for (const key of ['heading', 'bank', 'pitch', 'flex', 'visible'])
      assert.equal(pose[key], shot[key], `tourAircraft.${key} at ${p}`);
  }
}

// A source's scene position on a pose, the way the scene places the model.
const body = new THREE.Object3D();
body.rotation.order = 'YXZ';
const place = (pose, [x, y, z, lift], flex = pose.flex) => {
  body.position.set(...pose.position);
  body.rotation.set(pose.bank, pose.heading, pose.pitch);
  body.updateMatrixWorld();
  return new THREE.Vector3(x, y + lift * flex, z).applyMatrix4(
    body.matrixWorld,
  );
};
const track = createFlightTrack(tourAircraft);
const COUNT = 64,
  STEP = 674 / 62;
const lay = (p, sources = CONTRAIL_SOURCES) => {
  const pose = tourAircraft(p);
  const live = new Float32Array(sources.length * 3);
  sources.forEach((source, j) => place(pose, source).toArray(live, j * 3));
  const out = new Float32Array(sources.length * COUNT * 4);
  const flown = track.lay(p, sources, live, pose.flex, COUNT, STEP, out);
  const point = (j, k) =>
    new THREE.Vector3().fromArray(out, (j * COUNT + k) * 4);
  return { flown, live, out, point };
};
// The progress at which the aircraft had flown `d` metres.
const when = (d) => {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (track.distance(mid) < d) lo = mid;
    else hi = mid;
  }
  return hi;
};

for (const p of [0.2, 0.34, 0.45, 0.59, 0.78, 0.9, 1]) {
  const wake = lay(p);
  for (let j = 0; j < 2; j++) {
    assert.ok(
      wake
        .point(j, 0)
        .distanceTo(new THREE.Vector3().fromArray(wake.live, j * 3)) < 1e-4,
      'Each trail starts at its nozzle',
    );
    // Every point lies where the nozzle was when the aircraft had flown
    // that much less, or straight back along the tail before the tour.
    for (let k = 1; k < COUNT; k++) {
      const d = wake.flown - k * STEP;
      const at =
        d > 0 ? place(tourAircraft(when(d)), CONTRAIL_SOURCES[j]) : null;
      if (at)
        assert.ok(
          wake.point(j, k).distanceTo(at) < 0.25,
          `Trail point ${k} at ${p} lies on the flown track`,
        );
      const gap = wake.point(j, k).distanceTo(wake.point(j, k - 1));
      assert.ok(
        gap > STEP * 0.9 && gap < STEP * 1.1,
        `Trail points are a step apart (${gap.toFixed(2)} m at ${p})`,
      );
    }
  }
}
// Before the departure the trail runs straight back along the tail.
{
  const { point } = lay(0.2);
  const far = point(0, COUNT - 1);
  assert.ok(far.x > 600 && Math.abs(far.z - 9.41) < 0.2 && Math.abs(far.y) < 3);
}
// Through the turn it curves away behind the aircraft, which a trail fixed
// to the airframe never did.
const bend = (p) => {
  const { point } = lay(p);
  const first = point(0, 2).sub(point(0, 1)).normalize();
  const last = point(0, COUNT - 1)
    .sub(point(0, COUNT - 2))
    .normalize();
  return Math.acos(Math.min(1, first.dot(last)));
};
assert.ok(bend(0.78) > 0.25, `The trail bends through the turn: ${bend(0.78)}`);
// Before the departure only the arrival separates the trail from a straight
// line: its settling descent (2.4 m in 42 m) and the bank it rolls out of.
assert.ok(
  bend(0.2) < 0.1,
  `Before the turn the trail is straight: ${bend(0.2)}`,
);
// Scrolling back rewinds: the wake depends on the scroll, not on history.
{
  const fresh = lay(0.5).out.slice();
  lay(0.9);
  assert.deepEqual(lay(0.5).out, fresh, 'A rewound wake matches a fresh one');
}

// The contrails: each puff is numbered in the air, so the air's drift moves
// the puffs aft without reshuffling them.
const contrails = createContrails(THREE);
const vortices = createVortices(THREE);
const nozzles = new Float32Array(6),
  tips = new Float32Array(6);
{
  const pose = tourAircraft(0.6);
  CONTRAIL_SOURCES.forEach((s, j) => place(pose, s).toArray(nozzles, j * 3));
  VORTEX_SOURCES.forEach((s, j) => place(pose, s).toArray(tips, j * 3));
  contrails.update(track, 0.6, nozzles, pose.flex, 10);
  const layers = contrails.uniforms.layers.value.slice();
  assert.equal(
    contrails.uniforms.air.value,
    track.distance(0.6) + 10 * AIR_FLOW,
  );
  for (let set = 0; set < 3; set++) {
    const [, spacing, fraction] = layers.slice(set * 4, set * 4 + 4);
    assert.ok(fraction >= 0 && fraction < 1);
    // One spacing more of drift: the same fraction, the next puff number.
    contrails.update(track, 0.6, nozzles, pose.flex, 10 + spacing / AIR_FLOW);
    const next = contrails.uniforms.layers.value;
    assert.ok(Math.abs(next[set * 4 + 2] - fraction) < 1e-3);
    assert.equal(next[set * 4 + 3], layers[set * 4 + 3] + 1);
  }
  assert.ok(contrails.count > 1000 && contrails.count < 1400);
  vortices.update(track, 0.6, tips, pose.flex, 10, 1800);
  assert.equal(vortices.uniforms.pixels.value, 1800);
  const path = vortices.uniforms.path.value;
  assert.ok(
    path.every(Number.isFinite),
    'The vortex tracks are finite numbers',
  );
  // The threads start at the raked tips, a span apart.
  const span = Math.hypot(
    path[0] - path[48 * 4],
    path[1] - path[48 * 4 + 1],
    path[2] - path[48 * 4 + 2],
  );
  assert.ok(Math.abs(span - 59.4) < 0.5, `Tip to tip ${span.toFixed(2)} m`);
}
for (const part of [contrails, vortices]) {
  assert.ok(part.mesh.frustumCulled === false);
  assert.ok(part.material.transparent && !part.material.depthWrite);
  part.geometry.dispose();
  part.material.dispose();
}
contrails.noise.dispose();
console.log(
  `Passed: the wake starts at the airframe, follows the flown track to within 25 cm, bends ${bend(0.78).toFixed(2)} rad through the turn, rewinds with the scroll, and its puffs keep their numbers as the air drifts; ${contrails.count} contrail puffs.`,
);
