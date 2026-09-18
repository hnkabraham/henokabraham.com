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
const { projectWing, projectTail, insideWing, createTextCut } = await import(
  await moduleURL('../lib/dreamliner-cut.ts', {
    './dreamliner-engine': await moduleURL('../lib/dreamliner-engine.ts'),
  })
);
const { addDepthCut, addWingFlex } = await import(
  await moduleURL('../lib/airframe-flex.ts', {
    three: import.meta.resolve('three'),
  })
);
// Exercise the actual patch on both aircraft shader families. Evaluate its
// scalar fragment arithmetic below without a GPU; this checks compositing
// and depth gates, not the visual strength of the canvas penumbra.
for (const Material of [T.MeshStandardMaterial, T.MeshPhysicalMaterial]) {
  const material = new Material();
  const cut = {
    mask: { value: new T.Texture() },
    rect: { value: [10, 20, 300, 100] },
    depth: { value: 14 },
    on: { value: 1 },
  };
  addWingFlex(material, { value: 0.45 });
  addDepthCut(material, cut);
  assert.equal(
    material.customProgramCacheKey(),
    'dreamliner-wing-flex-v1|depth-cut-v2',
  );
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  for (const [name, uniform] of Object.entries(cut))
    assert.equal(
      shader.uniforms[`cut${name[0].toUpperCase()}${name.slice(1)}`],
      uniform,
      'The patch shares the live scene uniforms',
    );
  const fragment = shader.fragmentShader;
  assert.equal((fragment.match(/texture2D\(cutMask/g) ?? []).length, 1);
  assert.match(
    fragment,
    /if \(cutOn > 0\.5\)[\s\S]*if \(all\(greaterThan\(cutUv,[\s\S]*all\(lessThan\(cutUv,[\s\S]*texture2D\(cutMask, cutUv\)\.rg/,
    'The one packed lookup stays inside the enabled caption rectangle',
  );
  const scalar = fragment.match(
    /float cover =[\s\S]*?gl_FragColor\.a \*= keep;/,
  )?.[0];
  assert.ok(scalar, 'The cut has scalar compositing arithmetic to exercise');
  // The GLSL runs here as JavaScript, so every builtin it uses has to be
  // passed in: smoothstep, step and max are the set. Reach for another one
  // in the patch and this throws a ReferenceError naming it.
  const scalarModule = `export default (glyph, cutDepth, vViewPosition, smoothstep, step, max) => {
    let rgb = [0.8, 0.6, 0.4], alpha = 1;
    ${scalar
      .replaceAll('float ', 'const ')
      .replace(/gl_FragColor\.rgb \*= (.*);/g, 'rgb = rgb.map(v => v * ($1));')
      .replaceAll('gl_FragColor.a', 'alpha')}
    return { rgb, alpha };
  };`;
  const { default: evaluate } = await import(
    `data:text/javascript;base64,${Buffer.from(scalarModule).toString('base64')}`
  );
  const smoothstep = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const shade = (cover, halo, gap, depth = 14) =>
    evaluate(
      { r: cover, g: halo },
      depth,
      { z: depth + gap },
      smoothstep,
      (edge, v) => Number(v >= edge),
      Math.max,
    );
  const unchanged = { rgb: [0.8, 0.6, 0.4], alpha: 1 };
  assert.deepEqual(shade(0, 1, -1), unchanged, 'No shadow in front');
  assert.deepEqual(shade(0, 1, 12), unchanged, 'No shadow on distant skin');
  assert.deepEqual(shade(0, 1, 1, 0), unchanged, 'No shadow at the lens');
  assert.deepEqual(shade(0, 0, 1), unchanged, 'No shadow outside the halo');
  assert.deepEqual(shade(1, 1, 1), { rgb: [0, 0, 0], alpha: 0 });
  assert.deepEqual(shade(1, 1, 0), { rgb: [0.4, 0.3, 0.2], alpha: 0.5 });
  // The same separation in metres reads differently at the two cuts, and
  // has to: twelve metres past a caption hanging fourteen out is another
  // aircraft's length of sky, and past one a hundred out it is nothing. The
  // shadow fades on the ratio, so the wing tip loses it and the fuselage
  // behind the distant tail keeps it.
  assert.ok(
    shade(0, 1, 12, 100).rgb[0] < 0.8 * 0.8,
    'A distant caption still shadows the skin a few metres behind it',
  );
  const contact = shade(0, 1, 0.5);
  assert.equal(contact.alpha, 1, 'The shadow never changes coverage');
  assert.ok(
    contact.rgb[0] < 0.8 * 0.8 && contact.rgb[0] > 0.8 * 0.6,
    `The shadow at contact darkens the skin by a fifth to two fifths: ${contact.rgb[0].toFixed(3)} of 0.8`,
  );
  assert.ok(
    shade(0, 1, 4).rgb[0] > contact.rgb[0],
    'The shadow is darkest where the skin is closest to the caption',
  );
  for (const gap of [-0.4, 0, 0.4, 0.8, 3, 6]) {
    const half = shade(0.5, 1, gap);
    assert.equal(half.alpha, shade(0.5, 0, gap).alpha);
    assert.deepEqual(
      shade(1, 1, gap),
      shade(1, 0, gap),
      'Covered glyphs receive no shadow',
    );
    assert.ok(half.rgb.every((v) => v >= 0 && v <= half.alpha));
  }
  cut.mask.value.dispose();
  material.dispose();
}

// A recording canvas verifies the packed drawing contract and cache lifetime.
// Font rasterization and the browser's blur kernel still need visual review.
{
  const saved = ['document', 'getComputedStyle'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const draws = [];
  const context = {
    setTransform(...values) {
      this.transform = values;
    },
    fillRect() {
      assert.equal(this.fillStyle, '#000');
      assert.equal(this.globalCompositeOperation, 'source-over');
    },
    measureText() {
      return { fontBoundingBoxAscent: 15 };
    },
    fillText(text, x, y) {
      draws.push({ text, x, y, ...this });
    },
    letterSpacing: '0px',
    wordSpacing: '0px',
  };
  let canvasWidth = 0,
    canvasHeight = 0;
  const reset = () =>
    Object.assign(context, {
      globalCompositeOperation: 'source-over',
      shadowColor: 'transparent',
      shadowBlur: 0,
    });
  const canvas = {
    get width() {
      return canvasWidth;
    },
    set width(value) {
      canvasWidth = value;
      reset();
    },
    get height() {
      return canvasHeight;
    },
    set height(value) {
      canvasHeight = value;
      reset();
    },
    getContext() {
      return context;
    },
  };
  let x = 40.25;
  const y = 60.125;
  const spans = [
    { textContent: 'Wing', spacing: '-4px' },
    { textContent: 'tail', spacing: 'normal' },
  ];
  const story = {
    offsetParent: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
    getBoundingClientRect: () => ({
      left: 10 + x,
      top: 20 + y,
      width: 200.25,
      height: 80.125,
    }),
    querySelectorAll: () => spans,
  };
  try {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => canvas,
        createRange: () => ({
          selectNodeContents() {},
          getBoundingClientRect: () => ({ left: 10 + x, top: 20 + y }),
        }),
      },
    });
    globalThis.getComputedStyle = (span) => ({
      fontStyle: 'normal',
      fontWeight: '400',
      fontSize: '20px',
      fontFamily: 'sans-serif',
      letterSpacing: span.spacing,
      wordSpacing: 'normal',
    });
    const mask = createTextCut();
    assert.equal(mask.refresh(390, 844, 1), null);
    mask.attach(story);
    for (const ratio of [1, 1.25, 2.2]) {
      draws.length = 0;
      const box = mask.refresh(390, 844, ratio);
      assert.equal(box.redrawn, true, 'A renderer ratio change redraws');
      assert.ok(Math.abs(box.width * ratio - canvas.width) < 1e-8);
      assert.ok(Math.abs(box.height * ratio - canvas.height) < 1e-8);
      for (const origin of [box.left, box.top])
        assert.ok(
          Math.abs(origin * ratio - Math.round(origin * ratio)) < 1e-8,
          'Mask origins land on framebuffer pixels',
        );
      assert.equal(draws.length, 4, 'Two word passes, no extra canvas');
      const [coverage, halo, paragraph] = draws;
      assert.equal(coverage.fillStyle, '#f00');
      assert.equal(coverage.shadowColor, 'transparent');
      assert.equal(halo.fillStyle, '#000');
      assert.equal(halo.shadowColor, '#0f0');
      assert.equal(halo.globalCompositeOperation, 'lighter');
      assert.equal(halo.shadowBlur / ratio, 10, 'Halo keeps its CSS size');
      assert.equal(coverage.letterSpacing, '-4px');
      assert.equal(paragraph.letterSpacing, '0px');
      assert.ok(Math.abs(box.left + coverage.x - x) < 1e-8);
      assert.ok(Math.abs(box.top + coverage.y - 15 - y) < 1e-8);
      assert.equal(mask.refresh(390, 844, ratio).redrawn, false);
      assert.equal(draws.length, 4, 'A stable mask does not rerasterize');
      x += 0.01;
      assert.equal(
        mask.refresh(390, 844, ratio).redrawn,
        true,
        'Subpixel caption motion invalidates coverage',
      );
    }
    mask.attach(null);
    assert.equal(mask.refresh(390, 844, 1), null);
    mask.attach(story);
    mask.dispose();
    assert.equal(mask.refresh(390, 844, 1), null);
    canvas.getContext = () => null;
    const unavailable = createTextCut();
    unavailable.attach(story);
    assert.equal(unavailable.refresh(390, 844, 1), null);
  } finally {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
  }
}
console.log(
  'Passed: packed caption mask, framebuffer pixel alignment and cache invalidation; one-lookup depth cut, bounded contact shadow and premultiplied coverage.',
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
  // left elevator fills Apps, and the departing aircraft retains a 5% frame margin
  // at the following stops before leaving at the last.
  for (const [p, part, xyz] of [
    [0.2, 'exhaust', [-2.9, -1.13, 9.41]],
    [0.4, 'left elevator close-up', [31.5, 3, 7]],
    [0.59, 'departing aircraft', [0, 1, 0]],
    [0.78, 'departing aircraft', [0, 1, 0]],
  ]) {
    const c = cameraAt(p),
      v = plane.localToWorld(new T.Vector3(...xyz)).project(c);
    assert.ok(
      Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.9 && v.z > -1 && v.z < 1,
      `${width}x${height} ${String(part)} framing: ${v.toArray().join(',')}`,
    );
  }
  // Once the crossing has taken the aircraft up over the caption it never
  // comes back down the frame: climbing for the tail cut and then sinking
  // again read as a dip rather than a departure.
  {
    // NDC y counts up, so a frame that never dips never falls back from the
    // highest it has reached. A hundredth of that is half a percent of the
    // height, a pixel or two: the swing this replaced gave back a third of it.
    let peak = -Infinity,
      drop = 0,
      droppedAt = 0;
    for (let p = 0.4; p <= 1.0001; p += 0.005) {
      // cameraAt also poses the aircraft, so it has to run first.
      const c = cameraAt(p);
      const v = plane.localToWorld(new T.Vector3(0, 1, 0)).project(c);
      if (peak - v.y > drop) {
        drop = peak - v.y;
        droppedAt = p;
      }
      peak = Math.max(peak, v.y);
    }
    assert.ok(
      drop < 0.01,
      `${width}x${height} aircraft dips ${drop.toFixed(3)} of a half frame at ${droppedAt.toFixed(2)}`,
    );
  }
  // The last chapter is the leaving shot: the aircraft has climbed out of the
  // middle of the sky into the top left of the frame and is crossing its edge,
  // so part of it still has to be in frame while its centre is up and left.
  {
    const c = cameraAt(0.9);
    let seen = 0;
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const attr = mesh.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(attr, i)
          .applyMatrix4(mesh.matrixWorld)
          .project(c);
        if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > -1 && v.z < 1)
          seen++;
      }
    });
    const v = plane.localToWorld(new T.Vector3(0, 1, 0)).project(c);
    assert.ok(
      seen > 200 && v.x < 0.2 && v.y > 0.25 && v.y < 1.1,
      `${width}x${height} leaving shot: ${seen} vertices in frame at ${v.x.toFixed(2)},${v.y.toFixed(2)}`,
    );
  }
  // The wing through the headline: somewhere in the opening (the caption
  // remains until the complete wipe at 34%) the visible wing, clipped to the near plane and the
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
  // The left elevator alone spans the content while the centre of the
  // aircraft stays to its right. A joined tail/cone silhouette cannot pass
  // this framing check by bringing the tail cone over the caption again.
  {
    let reached = false;
    for (let p = 0.34; p <= 0.4801; p += 0.005) {
      const c = cameraAt(p);
      for (const point of [
        [35, 2.6, 0],
        [28, 4, 0],
        [0, 1, 0],
        [-28, 1, 0],
      ]) {
        const v = plane.localToWorld(new T.Vector3(...point)).project(c);
        assert.ok(
          v.x > 1,
          `${width}x${height}: fuselage or tail cone entered the left-elevator shot at ${p}`,
        );
      }
      const polygons = projectTail(c, plane, width, height);
      if (polygons.some((poly) => insideWing(poly, width * 0.2, height * 0.4)))
        reached = true;
    }
    assert.ok(
      reached,
      `${width}x${height}: the left elevator itself must cross the Apps content`,
    );
    // And on either side of the crossing the plane sits at the lens, which
    // puts every letter of the chapter caption in front of the aircraft.
    for (const p of [0.19, 0.28, 0.48])
      assert.equal(
        sampleDreamlinerTour(p, aspect).cutDepth,
        0,
        `${width}x${height} chapter caption is cut at ${p}`,
      );
    assert.equal(
      sampleDreamlinerTour(0.17, aspect).cutDepth,
      0,
      'Opening wipe never punches glyph holes in the aircraft',
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
  // The wide shots hold the whole aircraft on a landscape screen. A portrait
  // one cannot: the aircraft is climbing out of its top left corner by then
  // and spans most of the width, so there it only has to stay centred in
  // frame, cropped at the edge it is leaving by.
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
    const middle = plane.localToWorld(new T.Vector3(0, 1, 0)).project(c);
    if (width > height)
      assert.ok(
        extreme < 1,
        `${width}x${height} wide shot ${p} crops aircraft: ${extreme}`,
      );
    else
      assert.ok(
        Math.abs(middle.x) < 1 && Math.abs(middle.y) < 1,
        `${width}x${height} wide shot ${p} loses the aircraft: ${middle.x.toFixed(2)},${middle.y.toFixed(2)}`,
      );
  }
  // And by the end of the scroll it has climbed out: not one vertex is left
  // inside the frame, on any screen, and it went by the top or the top left
  // corner — never back down or out to the right.
  {
    const c = cameraAt(1);
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
      `${width}x${height} aircraft has not left the frame: ${inside} vertices`,
    );
    const v = plane.localToWorld(new T.Vector3(0, 1, 0)).project(cameraAt(1));
    assert.ok(
      v.y > 0.6 && v.x < 0.3,
      `${width}x${height} aircraft left by the wrong edge: ${v.x.toFixed(2)},${v.y.toFixed(2)}`,
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
assert.match(
  scene,
  /const ratio = r\.getPixelRatio\(\);[\s\S]*cut\.current\.refresh\(width, height, ratio\)/,
  'The mask follows renderer quality changes, not the device pixel ratio',
);
assert.ok(
  scene.includes('r.domElement.height - (box.top + box.height) * ratio'),
  'Caption Y uses the actual integer drawing buffer height',
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
