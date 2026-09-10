import { checkBayLifecycle } from './check-bay-lifecycle.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as T from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { Geodetic } from '@takram/three-geospatial';
import {
  AerialPerspectiveEffect,
  getSunLightColor,
} from '@takram/three-atmosphere';
import {
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';

const compile = async (name, links = {}) => {
  const js = transpileModule(
    await fs.readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ModuleKind.ESNext } },
  ).outputText.replace(
    /from '([^']+)'/g,
    (_, id) => `from '${links[id] ?? import.meta.resolve(id)}'`,
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  );
};
const { BAY_TO_ECEF, updateAtmosphereOrigin } = await compile('bay-atmosphere');
const { sampleBayFlight } = await compile('bay-flight');
assert.ok(
  Math.abs(BAY_TO_ECEF.determinant() - 1) < 1e-12,
  'ECEF frame must preserve handedness and meter scale',
);
const origin = new Geodetic().setFromECEF(
  new T.Vector3().setFromMatrixPosition(BAY_TO_ECEF),
);
assert.ok(
  Math.abs(T.MathUtils.radToDeg(origin.latitude) - 37.61391813888889) < 1e-8,
);
assert.ok(
  Math.abs(T.MathUtils.radToDeg(origin.longitude) + 122.35805769444444) < 1e-8,
);

const matrix = new T.Matrix4(),
  scratch = new T.Vector3(),
  local = new T.Vector3();
let maxCurveDifference = 0;
for (let i = 0; i <= 1000; i++) {
  const shot = sampleBayFlight(i / 1000);
  local.set(...shot.position).add(new T.Vector3(0, 12.33, 0));
  updateAtmosphereOrigin(matrix, local, scratch);
  const reference = new T.Vector3().setFromMatrixPosition(matrix);
  const height = new Geodetic().setFromECEF(reference).height;
  assert.ok(
    height > 12 && height < 4200,
    'Atmosphere reference must remain above the ellipsoid',
  );
  maxCurveDifference = Math.max(maxCurveDifference, Math.abs(height - local.y));
  const relativeCamera = new T.Vector3(90, 45, 130).applyMatrix4(matrix);
  assert.ok(
    Math.abs(relativeCamera.distanceTo(reference) - Math.hypot(90, 45, 130)) <
      1e-8,
  );
}
assert.ok(
  maxCurveDifference < 55,
  'Flat local scenery should stay within its expected curvature approximation',
);

let totalBytes = 0;
const lookups = {};
for (const [name, width, height] of [
  ['transmittance', 256, 64],
  ['scattering', 256, 128 * 32],
  ['irradiance', 64, 16],
]) {
  const bytes = await fs.readFile(
    new URL(`../public/scenery/atmosphere/${name}.exr`, import.meta.url),
  );
  totalBytes += bytes.byteLength;
  const exr = new EXRLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(exr.width, width);
  assert.equal(exr.height, height);
  assert.equal(exr.type, T.HalfFloatType);
  let nonzero = 0;
  for (let i = 0; i < exr.data.length; i++) {
    const value = T.DataUtils.fromHalfFloat(exr.data[i]);
    assert.ok(Number.isFinite(value), `${name}: finite half-float samples`);
    if (i % 4 !== 3 && value > 0) nonzero++;
    if (name === 'transmittance') assert.ok(value >= 0 && value <= 1.001);
  }
  assert.ok(
    nonzero > (width * height) / 3,
    `${name}: populated lookup texture`,
  );
  lookups[name] = new T.DataTexture(
    exr.data,
    exr.width,
    exr.height,
    T.RGBAFormat,
    T.HalfFloatType,
  );
}

// The scene's directional sun takes this colour, in the sky's own units.
const sunDirection = new T.Vector3(-0.58, 0.58, 0.57)
  .normalize()
  .transformDirection(BAY_TO_ECEF);
const sunColor = getSunLightColor(
  lookups.transmittance,
  new T.Vector3().setFromMatrixPosition(BAY_TO_ECEF),
  sunDirection,
);
assert.ok(
  [sunColor.r, sunColor.g, sunColor.b].every(
    (v) => Number.isFinite(v) && v > 0.5,
  ),
  'Sun colour from the transmittance table must be a bright, finite daylight',
);
assert.ok(
  sunColor.r > sunColor.b,
  'Low-altitude transmittance should warm the sun colour',
);

// Exercise the actual installed library's shader assembler and camera update.
// This is a CPU integration check; it does not claim a browser/GPU visual test.
const camera = new T.PerspectiveCamera(35, 1.6, 1, 250000);
camera.position.set(90, 45, 130);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const effect = new AerialPerspectiveEffect(camera, {
  sky: true,
  moon: false,
  correctGeometricError: false,
});
effect.worldToECEFMatrix.copy(matrix);
effect.sunDirection
  .set(-0.58, 0.58, 0.57)
  .normalize()
  .transformDirection(BAY_TO_ECEF);
const atmospherePass = new EffectPass(camera, effect);
atmospherePass.recompile();
effect.update({}, {}, 1 / 60);
assert.ok(atmospherePass.needsDepthTexture);
assert.ok(
  atmospherePass.fullscreenMaterial.fragmentShader.includes('sampler3D'),
);
assert.ok([...effect.defines.keys()].includes('SKY'));
assert.ok(
  !effect.defines.has('SUN_LIGHT') && !effect.defines.has('SKY_LIGHT'),
  'Existing PBR lighting must not be applied twice',
);
for (const key of ['worldToECEFMatrix', 'altitudeCorrection']) {
  const value = effect.uniforms.get(key).value;
  assert.ok((value.elements ?? value.toArray()).every(Number.isFinite));
}
const finish = new EffectPass(
  camera,
  new BloomEffect({ mipmapBlur: true }),
  new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
);
finish.recompile();
assert.ok(
  finish.fullscreenMaterial.fragmentShader.includes('toneMappingExposure'),
);
// That shader multiplies by the renderer's exposure, so the scene has to set
// it: leaving it at 1 halves the image, and nothing else would say so.
{
  const scene = await fs.readFile(
    new URL('../app/bay-flight-scene.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    scene.includes('renderer.toneMappingExposure = ATMOSPHERE_EXPOSURE'),
    'The atmosphere path sets the exposure AgX multiplies by',
  );
}
atmospherePass.dispose();
finish.dispose();
console.log(
  `Passed: 1,001 floating-origin transforms; ${totalBytes.toLocaleString()} bytes of valid atmosphere LUTs; sun colour ${[sunColor.r, sunColor.g, sunColor.b].map((v) => v.toFixed(2)).join('/')}; atmospheric depth, sky and HDR shader assembly.`,
);

const atmosphereSource = transpileModule(
  await fs.readFile(
    new URL('../lib/bay-atmosphere.ts', import.meta.url),
    'utf8',
  ),
  { compilerOptions: { module: ModuleKind.ESNext } },
).outputText.replace(
  /from '([^']+)'/g,
  (_, id) => `from '${import.meta.resolve(id)}'`,
);
const atmosphereURL = `data:text/javascript;base64,${Buffer.from(atmosphereSource).toString('base64')}`;
const { skyEnvironmentMoved } = await compile('bay-rendering', {
  './bay-atmosphere': atmosphereURL,
  '@/lib/scene-assets': `data:text/javascript;base64,${Buffer.from(transpileModule(await fs.readFile(new URL('../lib/scene-assets.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ModuleKind.ESNext } }).outputText).toString('base64')}`,
});
const renderingSource = await fs.readFile(
  new URL('../lib/bay-rendering.ts', import.meta.url),
  'utf8',
);
assert.ok(
  renderingSource.includes('new PrecomputedTexturesGenerator(') &&
    renderingSource.includes("priority: 'low'") &&
    renderingSource.includes('download.abort()'),
  'Atmosphere tables race GPU generation against a low-priority, abortable download',
);
assert.ok(
  renderingSource.includes('brightness: GRADE.brightness') &&
    renderingSource.includes('contrast: GRADE.contrast') &&
    renderingSource.includes('saturation: GRADE.saturation'),
  'The display grade comes from the calibrated constants',
);
assert.ok(
  renderingSource.includes('performance.mark(`bay-atmosphere-${winner.source}`)'),
  'The winning source is marked for measurement',
);
assert.equal(
  skyEnvironmentMoved(new T.Vector3(), new T.Vector3()),
  false,
  'Stationary sky never refreshes',
);
assert.equal(
  skyEnvironmentMoved(new T.Vector3(149, 0, 0), new T.Vector3()),
  false,
);
assert.equal(
  skyEnvironmentMoved(new T.Vector3(150, 0, 0), new T.Vector3()),
  true,
);
assert.equal(
  skyEnvironmentMoved(
    new T.Vector3(),
    new T.Vector3(Infinity, Infinity, Infinity),
  ),
  true,
  'First environment refreshes',
);
await checkBayLifecycle();
