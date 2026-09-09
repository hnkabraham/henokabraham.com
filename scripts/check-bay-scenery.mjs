import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transpileModule, ModuleKind } from 'typescript';
import * as T from 'three';
const compile = async (name) =>
  transpileModule(
    await fs.readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ModuleKind.ESNext } },
  ).outputText;
const url = (js) =>
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
const flightURL = url(await compile('bay-flight'));
const moduleURL = async (name) =>
  url(
    (await compile(name))
      .replaceAll("from 'three'", `from '${import.meta.resolve('three')}'`)
      .replaceAll("from './bay-flight'", `from '${flightURL}'`),
  );
const { createAirportBuildings, lonLatToBay } = await import(
  await moduleURL('sfo-buildings')
);
const { airportUV, addBaySurface, addPavementWear } = await import(
  await moduleURL('bay-surface')
);
const { addWingFlex } = await import(await moduleURL('airframe-flex'));
const data = JSON.parse(
  await fs.readFile(
    new URL('../public/scenery/sfo-buildings.json', import.meta.url),
  ),
);
// Elevation is decoded from a lossless WebP in the browser; the batching is
// validated here on a level 1025-point apron grid (2 m, quarter-metre units).
const elevations = new Uint16Array(1025 * 1025).fill(8);
const airport = createAirportBuildings(data, elevations);
assert.equal(
  airport.children.length,
  2,
  'Airport geometry must be batched into two renderable surfaces',
);
let vertices = 0;
for (const mesh of airport.children) {
  const p = mesh.geometry.attributes.position,
    n = mesh.geometry.attributes.normal;
  vertices += p.count;
  assert.ok(p.count > 1000);
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
    assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 0.01);
  }
}
const origin = lonLatToBay(-122.35805769444444, 37.61391813888889);
assert.ok(
  Math.hypot(...origin) < 0.01,
  'Airport footprints must use exactly the same registered origin as the plane',
);
const uv = airportUV(5666.01015, 8672.84973);
assert.ok(
  Math.abs(uv[0] - 0.7298375) < 0.00001 &&
    Math.abs(uv[1] - 0.4643464) < 0.00001,
  'NAIP texture must align to the runway threshold',
);
for (const withDetail of [true, false]) {
  const material = new T.MeshStandardMaterial();
  const controls = addBaySurface(
    material,
    withDetail ? new T.Texture() : null,
    withDetail ? { map: new T.Texture(), normalMap: new T.Texture() } : null,
  );
  assert.equal(controls.lit.value, 0);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.vertexShader.includes('vTerrainPoint = position'));
  assert.ok(shader.fragmentShader.includes('roughnessFactor = mix'));
  assert.ok(shader.fragmentShader.includes('outgoingLight = mix'));
  assert.equal(
    shader.fragmentShader.includes('sampler2D airportMap'),
    withDetail,
  );
  assert.equal(shader.fragmentShader.includes('bayDetailNormalMap'), withDetail);
}
{
  const material = new T.MeshStandardMaterial();
  addPavementWear(material, [62 / 3, 3690 / 3], 62);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('bayRubber'));
  assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'));
}
for (const shaderName of ['physical', 'depth']) {
  const material = new T.Material(),
    amount = { value: 2.1 };
  addWingFlex(material, amount);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib[shaderName].vertexShader,
    fragmentShader: T.ShaderLib[shaderName].fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.ok(
    shader.vertexShader.includes('transformed.y += wingLift(position)'),
  );
  assert.equal(shader.uniforms.wingFlex, amount);
}
console.log(
  `Passed: ${data.features.length} source footprints → ${vertices.toLocaleString()} batched vertices; finite geometry/normals; runway registration; land/water and wing/depth shader integration.`,
);
