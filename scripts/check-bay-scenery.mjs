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
const moduleURL = async (name, links = {}) =>
  url(
    Object.entries({ './bay-flight': flightURL, ...links }).reduce(
      (js, [from, to]) => js.replaceAll(`from '${from}'`, `from '${to}'`),
      (await compile(name)).replaceAll(
        "from 'three'",
        `from '${import.meta.resolve('three')}'`,
      ),
    ),
  );
const { createAirportBuildings, lonLatToBay } = await import(
  await moduleURL('sfo-buildings')
);
const surfaceURL = await moduleURL('bay-surface');
const { airportUV, addBaySurface, addPavementWear, SFO_BOUNDS, RUNWAY_BOUNDS } =
  await import(surfaceURL);
const cityURL = await moduleURL('bay-city', { './bay-surface': surfaceURL });
const { parseCityBuildings, buildCityGeometry, sampleElevation } =
  await import(cityURL);
const { createTreeMesh } = await import(
  await moduleURL('bay-trees', { './bay-surface': surfaceURL, './bay-city': cityURL })
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
    withDetail
      ? [
          { bounds: SFO_BOUNDS, texture: new T.Texture() },
          { bounds: RUNWAY_BOUNDS, texture: null },
        ]
      : [],
    withDetail
      ? {
          map: new T.Texture(),
          normalMap: new T.Texture(),
          waterNormalMap: new T.Texture(),
        }
      : null,
  );
  assert.equal(controls.lit.value, 0);
  if (withDetail) {
    assert.equal(controls.layers.length, 2);
    assert.equal(controls.layers[0].ready.value, 1, 'loaded layers start visible');
    assert.equal(controls.layers[1].ready.value, 0, 'lazy layers start hidden');
  }
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
    shader.fragmentShader.includes('sampler2D layerMap1'),
    withDetail,
  );
  assert.equal(shader.fragmentShader.includes('bayDetailNormalMap'), withDetail);
  assert.ok(shader.vertexShader.includes('vMercator = mercator'));
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

// City massing: a rectangle and an L-shape packed the way the script writes
// them, extruded on a level grid. Every wall must face outward and every roof
// triangle must face up, in the counter-clockwise ring convention.
{
  const rings = [
    { center: [100, -200], height: 12, ring: [[-5, -8], [5, -8], [5, 8], [-5, 8]], triangles: [] },
    {
      center: [-300, 50],
      height: 30,
      ring: [[-10, -10], [10, -10], [10, 0], [0, 0], [0, 10], [-10, 10]],
      triangles: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]],
    },
  ];
  const vertexCount = rings.reduce((n, b) => n + b.ring.length, 0);
  const triangleCount = rings.reduce((n, b) => n + b.triangles.length, 0);
  // The rectangle uses byte offsets, the L-shape the wide (short) encoding.
  const vertexBytes = rings[0].ring.length * 2 + rings[1].ring.length * 4;
  const buffer = new ArrayBuffer(22 + rings.length * 16 + vertexBytes + triangleCount * 3);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set([66, 65, 89, 66]);
  view.setUint16(4, 2, true);
  view.setUint32(6, rings.length, true);
  view.setUint32(10, vertexCount, true);
  view.setUint32(14, vertexBytes, true);
  view.setUint32(18, triangleCount, true);
  let record = 22,
    vertex = 22 + rings.length * 16,
    triangle = vertex + vertexBytes;
  rings.forEach((b, kind) => {
    const wide = kind === 1;
    view.setInt32(record, b.center[0] * 2, true);
    view.setInt32(record + 4, b.center[1] * 2, true);
    view.setUint16(record + 8, b.height * 10, true);
    view.setUint8(record + 10, 180);
    view.setUint8(record + 11, 170);
    view.setUint8(record + 12, 160);
    view.setUint8(record + 13, kind | (wide ? 0x80 : 0));
    view.setUint8(record + 14, b.ring.length);
    view.setUint8(record + 15, b.triangles.length);
    record += 16;
    for (const [x, z] of b.ring) {
      if (wide) {
        view.setInt16(vertex, x * 2, true);
        view.setInt16(vertex + 2, z * 2, true);
        vertex += 4;
      } else {
        view.setInt8(vertex, x * 2);
        view.setInt8(vertex + 1, z * 2);
        vertex += 2;
      }
    }
    for (const tri of b.triangles) {
      new Uint8Array(buffer, triangle, 3).set(tri);
      triangle += 3;
    }
  });
  const city = parseCityBuildings(buffer);
  assert.equal(city.count, 2);
  const level = { grid: elevations, size: 1025 };
  assert.equal(sampleElevation(level, 0, 0), 2, 'Level apron sits 2 m up');
  const geometry = await buildCityGeometry(city, level);
  const p = geometry.attributes.position;
  assert.equal(p.count, vertexCount * 2);
  assert.equal(geometry.index.count, vertexCount * 9 - rings.length * 6);
  assert.equal(geometry.attributes.color.itemSize, 4, 'Glazing rides in vertex alpha');
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), normal = new T.Vector3();
  let walls = 0, roofs = 0;
  for (let i = 0; i < geometry.index.count; i += 3) {
    a.fromBufferAttribute(p, geometry.index.getX(i));
    b.fromBufferAttribute(p, geometry.index.getX(i + 1));
    c.fromBufferAttribute(p, geometry.index.getX(i + 2));
    normal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const centroid = a.clone().add(b).add(c).divideScalar(3);
    const building = rings.find((r) => Math.hypot(centroid.x - r.center[0], centroid.z - r.center[1]) < 40);
    if (Math.abs(normal.y) > 0.99) {
      roofs++;
      assert.ok(normal.y > 0, 'Roof triangles must face up');
      assert.ok(Math.abs(a.y - (2 + building.height)) < 0.001, 'Roofs sit at ground plus height');
    } else {
      walls++;
      assert.ok(Math.abs(normal.y) < 0.001, 'Walls are vertical');
      // Outward: away from the building centre, except on the L's inner corner
      // where the wall faces the notch; both point away from the wall's own
      // interior side, so check against the ring centroid with the notch excluded.
      const outward = new T.Vector3(centroid.x - building.center[0], 0, centroid.z - building.center[1]);
      if (building.triangles.length === 0 || Math.abs(normal.dot(outward)) > 0.5 * outward.length())
        assert.ok(normal.dot(outward) > 0, 'Walls must face outward');
    }
  }
  assert.equal(walls, vertexCount * 2, 'Two triangles per wall');
  assert.equal(roofs, vertexCount - rings.length * 2, 'A fan or ear-clipped roof per building');
  console.log(`city check: ${walls} wall and ${roofs} roof triangles face the right way`);
}

// Tree canopies: three packed records become one instanced mesh standing on
// the terrain, coloured from the photograph.
{
  const buffer = new ArrayBuffer(4 + 3 * 8);
  const view = new DataView(buffer);
  view.setUint32(0, 3, true);
  [[100, -200, 80, 60, 90, 40], [-1500, 300, 120, 50, 80, 30], [40, 40, 55, 70, 100, 50]].forEach((t, i) => {
    const at = 4 + i * 8;
    view.setInt16(at, t[0], true);
    view.setInt16(at + 2, t[1], true);
    view.setUint8(at + 4, t[2]);
    view.setUint8(at + 5, t[3]);
    view.setUint8(at + 6, t[4]);
    view.setUint8(at + 7, t[5]);
  });
  const trees = { count: 3, records: new DataView(buffer, 4, 24) };
  const material = new T.MeshStandardMaterial();
  const surface = addBaySurface(material, [{ bounds: SFO_BOUNDS, texture: null, shade: null }], null);
  const built = await createTreeMesh(trees, { grid: elevations, size: 1025 }, [{ bounds: SFO_BOUNDS, texture: null, shade: null }], surface);
  assert.equal(built.mesh.count, 3);
  const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), sc = new T.Vector3();
  built.mesh.getMatrixAt(1, m);
  m.decompose(p, q, sc);
  assert.ok(Math.abs(p.x + 1500) < 0.001 && Math.abs(p.z - 300) < 0.001, 'Trees stand where the file puts them');
  assert.ok(Math.abs(p.y - (2 + 12 * 0.42)) < 0.001, 'Canopies sit on the terrain at their own radius');
  assert.ok(Math.abs(sc.x - 12) < 0.001, 'Diameter drives the instance scale');
  assert.ok(built.mesh.instanceColor, 'Per-tree colours are uploaded');
  console.log('tree check: 3 canopies placed, scaled and coloured');
}
