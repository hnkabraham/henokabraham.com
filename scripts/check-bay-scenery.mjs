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
const { RUNWAY_HEADING } = await import(flightURL);
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
const { createGoldenGateBridge, goldenGateFrame } = await import(
  await moduleURL('bay-bridge', { './bay-surface': surfaceURL, './bay-city': cityURL })
);
const { createKeyWatcher, createClickWatcher, EGG_MESSAGES, AIRBORNE_PROGRESS } = await import(
  await moduleURL('bay-easter-eggs')
);
const { createChaseCar } = await import(await moduleURL('bay-chase-car'));
const { createGateFog } = await import(await moduleURL('bay-fog'));
const { createAirfield } = await import(
  await moduleURL('sfo-airfield', { './bay-city': cityURL })
);
const { addLivery, LIVERY_REGIONS, LIVERY_ATLAS } = await import(
  await moduleURL('bay-livery', { './airframe-flex': await moduleURL('airframe-flex') })
);
const { GOLDEN_GATE, mercatorToLocal, mercator } = await import(surfaceURL);
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

// Golden Gate Bridge: the Mercator inverse round-trips the registration,
// the deck frame points north, the towers rise 227 m over the strait, the
// cables sag to just above the roadway, and the terrain shader carries the
// mask that hides the photographed deck.
{
  const [mx, my] = mercator(5666.01015, 8672.84973);
  const back = mercatorToLocal(mx, my);
  assert.ok(Math.hypot(...back) < 0.05, 'mercatorToLocal inverts mercator at the runway threshold');
  const frame = goldenGateFrame();
  assert.ok(frame.axis[1] < -0.99 && Math.abs(frame.axis[0]) < 0.12, 'Deck axis points north, slightly west');
  assert.ok(Math.abs(frame.axis[0] * frame.perp[0] + frame.axis[1] * frame.perp[1]) < 1e-9);
  assert.ok(frame.perp[0] > 0.99, 'Across axis points east');
  // The strait is at sea level; a synthetic grid with the water at 0 and the
  // land rising toward the row edges exercises the ramps and viaduct bents.
  const grid = new Uint16Array(1025 * 1025);
  const [south, north] = GOLDEN_GATE.towers;
  const elevation = { grid, size: 1025 };
  const material = new T.MeshStandardMaterial();
  const layers = [{ bounds: SFO_BOUNDS, texture: null, shade: null }];
  const surface = addBaySurface(material, layers, null);
  const bridge = createGoldenGateBridge(elevation, layers, surface);
  assert.equal(bridge.group.children.length, 5, 'Steel, road, concrete, cables and hangers');
  let triangles = 0;
  for (const mesh of bridge.group.children) {
    const p = mesh.geometry.attributes.position;
    triangles += mesh.geometry.index.count / 3;
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
  }
  assert.ok(triangles > 3000 && triangles < 60000, `Bridge stays light (${triangles} triangles)`);
  const steel = bridge.group.children.find((m) => m.name === 'golden-gate-steel');
  const top = steel.geometry.boundingSphere;
  assert.ok(top, 'Bounding spheres are computed for culling');
  const positions = steel.geometry.attributes.position;
  let highest = -Infinity;
  for (let i = 0; i < positions.count; i++) highest = Math.max(highest, positions.getY(i));
  assert.ok(Math.abs(highest - 227) < 0.01, `Tower tops at 227 m (${highest})`);
  const mid = (south + north) / 2;
  assert.ok(bridge.deckTop(mid) > bridge.deckTop(south) + 3, 'Roadway cambers up at midspan');
  assert.ok(bridge.cableTop(mid) - bridge.deckTop(mid) > 2 && bridge.cableTop(mid) - bridge.deckTop(mid) < 6, 'Cables meet the deck at midspan');
  assert.ok(Math.abs(bridge.cableTop(south) - 227) < 0.01 && Math.abs(bridge.cableTop(north) - 227) < 0.01, 'Cables leave the tower tops');
  assert.ok(bridge.cableTop(south - 343) < 110, 'Side spans descend to the pylons');
  assert.ok(bridge.deckTop(-1420) < 3, 'South approach settles onto the ground');
  const hangers = bridge.group.children.find((m) => m.name === 'golden-gate-hangers');
  assert.equal(hangers.geometry.attributes.along.itemSize, 1, 'Hanger curtains carry the along attribute');
  const local = mercatorToLocal(GOLDEN_GATE.centre[0], GOLDEN_GATE.centre[1]);
  const centre = at(frame, 0, 0);
  assert.ok(Math.hypot(centre[0] - local[0], centre[1] - local[1]) < 0.01);
  function at(f, along, across) {
    return [f.origin[0] + f.axis[0] * along + f.perp[0] * across, f.origin[1] + f.axis[1] * along + f.perp[1] * across];
  }
  const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('bayBridgeBand()') && shader.fragmentShader.includes('bayBridgeWater()'), 'Terrain hides the photographed deck');
  assert.ok(shader.fragmentShader.includes('baySampleAt = vMercator;'), 'Shade maps are read at the true position again');
  for (const mesh of bridge.group.children) {
    const s2 = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
    mesh.material.onBeforeCompile(s2, {});
    assert.ok(!s2.fragmentShader.includes('vMercator - bounds'), 'Every draped material samples through baySampleAt');
  }
  console.log(`bridge check: ${triangles.toLocaleString()} triangles, towers at ${highest} m, deck ${bridge.deckTop(mid).toFixed(1)} m at midspan`);
}

// Easter eggs: the Konami code and typed words trigger once, a click waves
// and three quick clicks roll, and the props build finite geometry.
{
  const keys = createKeyWatcher();
  const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  const results = konami.map((k) => keys(k));
  assert.deepEqual(results.slice(0, -1).filter(Boolean), [], 'Nothing fires before the sequence completes');
  assert.equal(results[results.length - 1], 'roll');
  assert.equal(keys('a'), null, 'The sequence resets after firing');
  for (const [word, egg] of [['roll', 'roll'], ['gt350', 'chase'], ['shelby', 'chase'], ['karl', 'fog'], ['wave', 'wave']]) {
    const watcher = createKeyWatcher();
    let fired = null;
    for (const ch of 'x' + word) fired = watcher(ch) ?? fired;
    assert.equal(fired, egg, `typing ${word}`);
  }
  const clicks = createClickWatcher(650);
  assert.equal(clicks(0), 'wave');
  assert.equal(clicks(200), 'wave');
  assert.equal(clicks(400), 'roll', 'Three quick clicks roll');
  assert.equal(clicks(2000), 'wave', 'A later click starts over');
  for (const egg of ['wave', 'roll', 'chase', 'fog', 'grounded']) assert.ok(EGG_MESSAGES[egg](true).length > 8);
  assert.ok(AIRBORNE_PROGRESS > 0.47 && AIRBORNE_PROGRESS < 0.6, 'Stunts wait for the gear to be up');
  const car = createChaseCar();
  assert.ok(car.group.children.length > 12 && car.wheels.length === 8);
  car.group.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(car.group);
  assert.ok(box.min.y > -0.01 && box.max.y < 1.5 && box.max.z - box.min.z < 5.2, 'Car-sized, wheels on the ground');
  const fog = createGateFog(goldenGateFrame());
  assert.equal(fog.group.children.length, 7);
  assert.equal(fog.group.visible, false, 'Fog starts hidden');
  const fogShader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  fog.materials[0].onBeforeCompile(fogShader, {});
  assert.ok(fogShader.fragmentShader.includes('fogField(') && fogShader.uniforms.fogOpacity === fog.opacity);
  console.log('easter egg check: Konami, typed words, click cadence, chase car and fog sheets');
}

// Airfield: the packed OpenStreetMap layout registers to the runway the
// flight uses, and every prop it places is finite and on the ground.
{
  const airfield = JSON.parse(
    await fs.readFile(new URL('../public/scenery/sfo-airfield.json', import.meta.url)),
  );
  const main = airfield.runways.find((r) => r.ref === '10L/28R');
  assert.ok(main, '28R is in the data');
  assert.ok(Math.hypot(...main.ends[0]) < 10, '28R starts at the registered threshold');
  const span = Math.hypot(main.ends[1][0] - main.ends[0][0], main.ends[1][1] - main.ends[0][1]);
  assert.ok(span > 3400 && span < 3700, `28R is about 3.5 km long (${span.toFixed(0)})`);
  const forward = [(main.ends[1][0] - main.ends[0][0]) / span, (main.ends[1][1] - main.ends[0][1]) / span];
  const scene = [-Math.sin(RUNWAY_HEADING), -Math.cos(RUNWAY_HEADING)];
  assert.ok(forward[0] * scene[0] + forward[1] * scene[1] > 0.9999, 'Runway direction matches the flight heading');
  assert.ok(airfield.stands.length > 250 && airfield.taxiways.length > 200 && airfield.holdings.length >= 4);
  for (const stand of airfield.stands)
    assert.ok(Math.abs(Math.hypot(...stand.heading) - 1) < 0.01, 'Stand headings are unit vectors');
  const built = createAirfield(airfield, { grid: elevations, size: 1025 });
  assert.ok(built.counts.aircraft > 120 && built.counts.aircraft < 260, `Parked fleet (${built.counts.aircraft})`);
  assert.ok(built.counts.lights > 3000 && built.counts.flashers >= 20 && built.counts.piles > 80);
  let meshes = 0;
  built.group.traverse((node) => {
    if (!node.isMesh) return;
    meshes++;
    const p = node.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
    if (node.isInstancedMesh) {
      const m = new T.Matrix4(), v = new T.Vector3();
      for (let i = 0; i < node.count; i++) {
        node.getMatrixAt(i, m);
        v.setFromMatrixPosition(m);
        assert.ok(Number.isFinite(v.x + v.y + v.z) && v.y > 1 && v.y < 30, 'Instances sit on the field');
      }
    }
  });
  built.update(1234);
  console.log(`airfield check: ${meshes} meshes, ${built.counts.aircraft} aircraft, ${built.counts.lights.toLocaleString()} lights, ${built.counts.flashers} flashers`);
}

// Livery: the atlas regions tile the canvas without overlap, and the shader
// patch lands on the standard chunk anchors of the physical material.
{
  const regions = Object.entries(LIVERY_REGIONS);
  for (const [name, [x0, y0, x1, y1]] of regions) {
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= LIVERY_ATLAS && y1 <= LIVERY_ATLAS && x1 > x0 && y1 > y0, `Region ${name} fits the atlas`);
    for (const [other, [a0, b0, a1, b1]] of regions)
      if (other !== name)
        assert.ok(x1 <= a0 || a1 <= x0 || y1 <= b0 || b1 <= y0, `Regions ${name} and ${other} do not overlap`);
  }
  const material = new T.MeshPhysicalMaterial();
  addLivery(material, new T.Texture());
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderChunk.meshphysical_vert,
    fragmentShader: T.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.liveryMap, 'Livery atlas bound as a uniform');
  assert.ok(shader.vertexShader.includes('vLiveryPoint = position;'), 'Model-space point passed to the fragment stage');
  for (const needle of ['liverySweep(', 'liverySweepSlope(', 'LIV_FIN_PORT', 'LIV_TITLES', 'LIV_REGISTRATION', 'LIV_URL', 'LIV_NACELLE', 'diffuseColor.rgb = col;'])
    assert.ok(shader.fragmentShader.includes(needle), `Livery fragment carries ${needle}`);
  assert.ok(material.customProgramCacheKey().includes('livery-v5'), 'Livery patch keyed');
  // The wave's edge is continuous with a matching slope where the fuselage
  // curve hands over to the fin curve at x = 20.
  const fuselage = (x) => -6.6 + 6.6 * ((x - 2.5) / 17.5) ** 2;
  const fin = (x) => 0.754 * (x - 20) - 0.019 * (x - 20) ** 2;
  assert.ok(Math.abs(fuselage(20) - fin(20)) < 1e-9, 'Wave edge continuous at the fin root');
  assert.ok(Math.abs((fuselage(20) - fuselage(19.999)) / 0.001 - (fin(20.001) - fin(20)) / 0.001) < 0.01, 'Wave edge slope continuous at the fin root');
  console.log(`livery check: ${regions.length} atlas regions, patch applied to meshphysical`);
}
