import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { restoreDoloresMaterials } from './dolores-park-materials.js';
import { createParkCar } from './dolores-park-car.js';
import { suns, doloresSky } from './dolores-park-lighting.js';

// The car's paint, the windows and the lantern glow, and how the car's
// reflection probe sees the sky. Settled by rendering the default view and
// the orbit by day, at dusk and at night; change them the same way.
const LOOK = {
  reflection: {
    // Independent of the unchanged display sky and pale lighting-only cube.
    saturationDay: 0.35,
    saturationNight: 0.7,
    gainDay: 1.5, // Linear radiance, not the lighting cube's display-space gain.
    gainNight: 1.25,
    nightElevation: -6,
    dayElevation: 6,
    highlightKnee: 1, // Leave lower luminance alone; roll highlights off smoothly.
    highlightLimit: 4, // Asymptotic linear luminance ceiling, not a hard clip.
  },
  bodyPaint: {
    roughness: 0.33,
    metalness: 0.1,
    clearcoat: 0.75,
    clearcoatRoughness: 0.15,
  },
  windows: {
    // Only the colour baked into the glass changes: sharper or more
    // specular glass brought back the pink bay's sun glint (README pass 6).
    tintSaturation: 0.35, // Keep a hint of the blue baked into COLOR_0.
    tintGain: 1,
  },
  lantern: {
    corePower: 90, // Higher power narrows the bright centre on the same sphere.
    coreGain: 1.8,
    haloPower: 6,
    haloGain: 0.1,
  },
};

const V = (x, y, h) => new T.Vector3(x, h, -y);
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
// The sky, drawn live for the moment's sun and moon, with the far field
// (everything beyond 180 m) composited over it from six baked faces. The
// faces are premultiplied and carry the fog the bake would have added as
// transparency, so distant hills melt into this sky rather than into the
// bake's own haze (export.mjs bandFace). Six 2D samplers rather than a
// cube, because a WebGL cube needs equal faces and the phone spends its
// pixels on downtown (east / north) instead of blank sky. All the arithmetic
// is in display sRGB, the space the palette in dolores-park-lighting.js is
// written in. `mode` 1 retains the original desaturated, brightened, clipped
// lighting-only fill. `mode` 2 treats reflections separately in linear HDR;
// both are uniform branches of the same program as the unchanged display sky.
function createSkyBackdrop(images) {
  const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const textures = images.map((img, i) => {
    const t = new T.Texture(img);
    t.name = 'Dolores background ' + names[i];
    t.colorSpace = T.NoColorSpace;
    t.flipY = false;
    t.generateMipmaps = false;
    t.minFilter = T.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
  const uniforms = {
    ...Object.fromEntries(
      names.map((name, i) => [name, { value: textures[i] }]),
    ),
    zenith: { value: new T.Vector3() },
    horizon: { value: new T.Vector3() },
    glow: { value: new T.Vector3() },
    belt: { value: new T.Vector3() },
    sunColor: { value: new T.Vector3() },
    bandTint: { value: new T.Vector3(1, 1, 1) },
    sunDir: { value: new T.Vector3(0, 1, 0) },
    moonDir: { value: new T.Vector3(0, -1, 0) },
    moonLit: { value: 0 },
    stars: { value: 0 },
    halo: { value: 0 },
    mode: { value: 0 },
    saturation: { value: 1 },
    gain: { value: 1 },
    linearGain: { value: 1 },
    reflectionSaturation: { value: LOOK.reflection.saturationDay },
    reflectionGain: { value: LOOK.reflection.gainDay },
    reflectionKnee: { value: LOOK.reflection.highlightKnee },
    reflectionLimit: { value: LOOK.reflection.highlightLimit },
  };
  const material = new T.ShaderMaterial({
    uniforms,
    side: T.BackSide,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `varying vec3 direction;
      void main() {
        direction = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: `uniform sampler2D px, nx, py, ny, pz, nz;
      uniform vec3 zenith, horizon, glow, belt, sunColor, bandTint, sunDir, moonDir;
      uniform float moonLit, stars, halo, mode, saturation, gain, linearGain;
      uniform float reflectionSaturation, reflectionGain, reflectionKnee, reflectionLimit;
      varying vec3 direction;
      vec4 band(vec3 direction) {
        // Match Three's image-cubemap handedness and WebGL face coordinates.
        vec3 d = vec3(-direction.x, direction.yz);
        vec3 a = abs(d);
        if (a.x >= a.y && a.x >= a.z) {
          if (d.x > 0.0) return texture2D(px, vec2(-d.z,-d.y)/a.x*.5+.5);
          return texture2D(nx, vec2(d.z,-d.y)/a.x*.5+.5);
        } else if (a.y >= a.z) {
          if (d.y > 0.0) return texture2D(py, vec2(d.x,d.z)/a.y*.5+.5);
          return texture2D(ny, vec2(d.x,-d.z)/a.y*.5+.5);
        }
        if (d.z > 0.0) return texture2D(pz, vec2(d.x,-d.y)/a.z*.5+.5);
        return texture2D(nz, vec2(-d.x,-d.y)/a.z*.5+.5);
      }
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      vec3 sky(vec3 d) {
        // The horizon warms towards the sun and turns pink opposite it as the
        // sun sets; the gradient above is the daytime one throughout.
        vec2 toSun = normalize(sunDir.xz + vec2(1e-4, 0.0));
        float facing = dot(normalize(d.xz + vec2(1e-4, 0.0)), toSun);
        vec3 h = mix(horizon, glow, pow(0.5 + 0.5 * facing, 3.0));
        h = mix(h, belt, pow(0.5 - 0.5 * facing, 3.0));
        float s = max(d.y, 0.0);
        vec3 c = mix(h, zenith, smoothstep(0.0, 0.44, s));
        float up = smoothstep(-0.035, 0.01, sunDir.y), cosSun = dot(d, sunDir);
        c += sunColor * halo * up * (pow(max(cosSun, 0.0), 24.0) * 0.16 +
          pow(max(cosSun, 0.0), 700.0) * 0.5);
        c = mix(c, vec3(1.0, 0.98, 0.93), smoothstep(0.999955, 0.999985, cosSun) * up);
        // The Moon, about 1.6 times its true size, lit from the true sun
        // direction, which gives its phase and the tilt of its bright limb.
        float cosMoon = dot(d, moonDir);
        if (cosMoon > 0.9999) {
          vec3 right = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
          vec3 above = cross(right, moonDir);
          vec3 offset = (d - moonDir * cosMoon) / 0.0075;
          float x = dot(offset, right), y = dot(offset, above), r2 = x * x + y * y;
          if (r2 < 1.0) {
            vec3 n = x * right + y * above - sqrt(1.0 - r2) * moonDir;
            float lit = smoothstep(-0.05, 0.25, dot(n, sunDir));
            float edge = smoothstep(1.0, 0.8, r2) * smoothstep(-0.02, 0.01, moonDir.y);
            vec3 moon = vec3(0.92, 0.9, 0.84) * (0.03 + 0.97 * lit);
            c = mix(c, max(c, moon), edge * moonLit);
          }
        }
        // A few stars through the city's skyglow, none near the horizon.
        if (stars > 0.0 && d.y > 0.08) {
          vec3 p = d * 260.0, cell = floor(p);
          float h1 = hash(cell);
          if (h1 > 0.9965) {
            vec3 centre = cell + 0.5 + (vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) - 0.5) * 0.6;
            float star = smoothstep(0.22, 0.0, length(p - centre)) * (0.35 + 0.65 * hash(cell + 9.1));
            c += vec3(0.85, 0.88, 1.0) * star * stars * smoothstep(0.08, 0.35, d.y);
          }
        }
        return c;
      }
      void main() {
        vec3 d = normalize(direction);
        vec4 b = band(d);
        vec3 c = sky(d) * (1.0 - b.a) + min(b.rgb, vec3(b.a)) * bandTint;
        if (mode > 0.5 && mode < 1.5) {
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = min(mix(vec3(l), c, saturation) * gain, 1.0);
        }
        vec3 radiance = sRGBTransferEOTF(vec4(c, 1.0)).rgb * linearGain;
        if (mode > 1.5) {
          // Linear-sRGB luminance: desaturation preserves sky contrast and
          // the highlight shoulder scales RGB together to retain its hue.
          float l = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
          radiance = mix(vec3(l), radiance, reflectionSaturation) * reflectionGain;
          l *= reflectionGain;
          if (l > reflectionKnee) {
            float range = reflectionLimit - reflectionKnee;
            float excess = l - reflectionKnee;
            float compressed = reflectionKnee + range * excess / (range + excess);
            radiance *= compressed / l;
          }
        }
        gl_FragColor = vec4(radiance, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new T.Mesh(new T.BoxGeometry(2, 2, 2), material);
  mesh.name = 'Dolores sky and far field';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, textures, uniforms };
}
// A random number per window, as a vertex attribute, for which panes are lit
// after dark. Panes are found as connected pieces (welded by position, as
// box faces do not share vertices) and hashed by where their centre falls
// in 1.6 m columns and 3.2 m storeys, so a window's sashes usually agree.
function seedWindows(geometry) {
  const position = geometry.attributes.position,
    n = position.count;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map((v) => Math.round(v * 500))
      .join();
    if (seen.has(key)) join(i, seen.get(key));
    else seen.set(key, i);
  }
  const index = geometry.index;
  if (index)
    for (let t = 0; t < index.count; t += 3) {
      join(index.getX(t), index.getX(t + 1));
      join(index.getX(t), index.getX(t + 2));
    }
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i),
      sum = sums.get(root) ?? [0, 0, 0, 0];
    sum[0] += position.getX(i);
    sum[1] += position.getY(i);
    sum[2] += position.getZ(i);
    sum[3]++;
    sums.set(root, sum);
  }
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z, count] = sums.get(find(i));
    const h =
      Math.sin(
        Math.floor(x / count / 1.6) * 12.9898 +
          Math.floor(y / count / 3.2) * 78.233 +
          Math.floor(z / count / 1.6) * 37.719,
      ) * 43758.5453;
    seeds[i] = h - Math.floor(h);
  }
  geometry.setAttribute('windowSeed', new T.BufferAttribute(seeds, 1));
}
function gridHeight(tile, x, y) {
  const fx = T.MathUtils.clamp((x - tile.x0) / tile.step, 0, tile.w - 1),
    fy = T.MathUtils.clamp((y - tile.y0) / tile.step, 0, tile.h - 1);
  const ix = Math.min(tile.w - 2, Math.floor(fx)),
    iy = Math.min(tile.h - 2, Math.floor(fy));
  const a = tile.heights[iy * tile.w + ix],
    b = tile.heights[iy * tile.w + ix + 1],
    c = tile.heights[(iy + 1) * tile.w + ix],
    d = tile.heights[(iy + 1) * tile.w + ix + 1];
  return T.MathUtils.lerp(
    T.MathUtils.lerp(a, b, fx - ix),
    T.MathUtils.lerp(c, d, fx - ix),
    fy - iy,
  );
}
// Keep the export's tight facade cells for culling, but submit visible cells
// sharing a material in one draw. Only the index buffer changes at cell edges.
// This keeps the phone draw-call budget while retaining default-pose culling.
function batchHouseDraws(root) {
  root.updateMatrixWorld(true);
  const groups = new Map(),
    retired = new Set(),
    batches = [];
  root.traverse((o) => {
    if (
      !o.isMesh ||
      o.isInstancedMesh ||
      Array.isArray(o.material) ||
      !/Painted wood|Stone, brick|Window glass|Subtle runoff/.test(
        o.material.name,
      )
    )
      return;
    const key = `${o.material.uuid}/${o.castShadow}/${o.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const parts = [],
      cells = [];
    let offset = 0;
    for (const o of meshes) {
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (!g.index)
        g.setIndex(
          Array.from({ length: g.attributes.position.count }, (_, i) => i),
        );
      g.computeBoundingBox();
      cells.push({
        box: g.boundingBox.clone(),
        center: g.boundingBox.getCenter(new T.Vector3()),
        offset,
        count: g.index.count,
      });
      offset += g.index.count;
      parts.push(g);
      retired.add(o.geometry);
      o.removeFromParent();
    }
    const geometry = mergeGeometries(parts),
      mesh = new T.Mesh(geometry, meshes[0].material);
    parts.forEach((g) => g.dispose());
    mesh.name = meshes[0].material.name + ' / visible facade cells';
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    mesh.frustumCulled = false;
    root.add(mesh);
    geometry.index.setUsage(T.DynamicDrawUsage);
    batches.push({
      mesh,
      cells,
      indices: geometry.index.array.slice(),
      key: null,
    });
  }
  root.traverse((o) => {
    if (o.isMesh) retired.delete(o.geometry);
  });
  retired.forEach((g) => g.dispose());
  return batches;
}
export const DEFAULT_POSE = [8, -161, 1.2, 12.9, -154.63, 1.05];
// Drawing-buffer pixels at most: what the widest side-column frame drew on a
// 2560-wide Retina window. Beyond it the pixel ratio drops below the
// display's, so a 5K or ultrawide window costs no more than that did.
const PIXEL_BUDGET = 8e6;
const abortError = () => new DOMException('Viewer load aborted', 'AbortError');
function disposeLoaded(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
// What a viewer fetches: the park for its profile, the car, and the six
// faces of one far-field bake.
function viewerFiles(phone, backdrop) {
  const suffix = phone ? '-phone' : '';
  return {
    park: `/models/dolores-park${suffix}.glb`,
    car: '/models/garage-gt350r.glb',
    faces: ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map(
      (face) => `/scenery/dolores-band-${backdrop}${suffix}-${face}.webp`,
    ),
  };
}
// The paths a viewer made now with these options would fetch, so that a
// page can request them ahead of it.
export function doloresViewerFiles({ phone = false, sun = 'live', time } = {}) {
  if (sun !== 'live' && !suns[sun]) throw Error(`Unknown sun: ${sun}`);
  const sky = doloresSky(sun === 'live' ? (time ?? Date.now()) : suns[sun]);
  const { park, car, faces } = viewerFiles(phone, sky.backdrop);
  return [park, car, ...faces];
}
// One viewer per container. Everything is fetched and parsed before the
// WebGL context exists. After that it waits only for its shaders and one
// turn for the page, and releases what it built if the caller aborts
// meanwhile (the section unmounting mid-load). Paths passed to `load` are
// public-root relative ('/models/…', '/scenery/…'); the caller maps them
// to URLs.
export async function createDoloresViewer(container, options = {}) {
  const {
    phone = false,
    sun: sunName = 'live',
    time,
    load = async (path) => {
      const response = await fetch(path, { signal: options.signal });
      if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    dracoPath = '/draco/',
    pixelRatio = Math.min(devicePixelRatio, 2),
    fov: horizontalFov = 52,
    pose = DEFAULT_POSE,
    size,
    preserveDrawingBuffer = false,
    scrollFriendly = false,
    signal,
    onContextLost,
    onContextRestored,
  } = options;
  const started = performance.now();
  const live = sunName === 'live';
  if (!live && !suns[sunName]) throw Error(`Unknown sun: ${sunName}`);
  // 'live' is the real sky over the park at `time`, or, without one, now,
  // kept current while the viewer is open (`following` below).
  let sky = doloresSky(live ? (time ?? Date.now()) : suns[sunName]);
  // The leaves' and fronds' back-light patches scale with the sun.
  const toSun = sky.toSun.clone(),
    translucency = { value: 0 };
  if (pose.length !== 6 || !pose.every(Number.isFinite))
    throw Error('pose requires x,y,h,lookx,looky,lookh');
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  // One far-field bake per visit, chosen for the sun at load: the nearest
  // daytime bearing, or the night bake with its lit windows.
  const backdropName = sky.backdrop;
  const files = viewerFiles(phone, backdropName);
  let glbBytes = 0,
    backdropBytes = 0;
  let settled;
  try {
    settled = await Promise.allSettled([
      load(files.park).then((b) => {
        glbBytes = b.byteLength;
        return loader.parseAsync(b, '');
      }),
      load(files.car).then((b) => loader.parseAsync(b, '')),
      Promise.all(
        files.faces.map(async (path) => {
          const b = await load(path);
          backdropBytes += b.byteLength;
          // The faces are stored premultiplied already (export.mjs).
          return createImageBitmap(new Blob([b], { type: 'image/webp' }), {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          });
        }),
      ),
    ]);
  } finally {
    draco.dispose();
  }
  const [park, carModel, images] = settled.map((r) => r.value);
  let data;
  park?.scene.traverse((o) => {
    if (o.userData.dolores) data = o.userData.dolores;
  });
  // Whichever loads did finish are released if another failed or the
  // caller gave up meanwhile.
  let failed = settled.find((r) => r.status === 'rejected');
  if (data?.ground.heightsGzip) {
    try {
      const zipped = Uint8Array.from(atob(data.ground.heightsGzip), (c) =>
        c.charCodeAt(0),
      );
      const stream = new Blob([zipped])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      const packed = new DataView(await new Response(stream).arrayBuffer());
      const count = data.ground.w * data.ground.h;
      if (packed.byteLength !== count * 4) throw Error('Invalid ground tile');
      data.ground.heights = Array.from(
        { length: count },
        (_, i) => packed.getInt32(i * 4, true) / 10000,
      );
      delete data.ground.heightsGzip;
    } catch (reason) {
      failed = { reason };
    }
  }
  if (failed || signal?.aborted || !data) {
    if (park) disposeLoaded(park.scene);
    if (carModel) disposeLoaded(carModel.scene);
    images?.forEach((i) => i.close());
    throw signal?.aborted
      ? abortError()
      : (failed?.reason ?? Error('Missing Dolores placement metadata'));
  }
  const renderer = new T.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer,
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  container.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.FogExp2(0xffffff, 0.00009); // coloured by applySky()
  const camera = new T.PerspectiveCamera(35, 1, 0.15, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 4;
  controls.maxDistance = 9;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI * 0.52;
  if (scrollFriendly) {
    // Embedded in a scrolling page: zoom would swallow wheel and trackpad
    // scrolls that cross the canvas, and OrbitControls' own
    // `touch-action: none` would turn a vertical swipe into an orbit
    // instead of a page scroll. Sideways drags still orbit.
    controls.enableZoom = false;
    renderer.domElement.style.touchAction = 'pan-y';
  }
  const backdrop = createSkyBackdrop(images);
  scene.add(backdrop.mesh);
  const { car, roadZ } = data;
  const groundAt = (x, y) => gridHeight(data.ground, x, y);
  const roadHeight = (x) => {
    const samples = data.roadSamples,
      f = (x - samples[0][0]) / 0.5,
      i = T.MathUtils.clamp(Math.floor(f), 0, samples.length - 2);
    return T.MathUtils.lerp(
      samples[i][1],
      samples[i + 1][1],
      T.MathUtils.clamp(f - i, 0, 1),
    );
  };
  const patched = restoreDoloresMaterials(park.scene, {
    toSun,
    translucency,
  });
  park.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.userData.shadows?.cast ?? true;
    o.receiveShadow = o.userData.shadows?.receive ?? true;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.alphaTest > 0) m.alphaToCoverage = true;
      for (const value of Object.values(m))
        if (value?.isTexture) value.anisotropy = phone ? 4 : 8;
    }
  });
  scene.add(park.scene);
  const houseBatches = batchHouseDraws(park.scene);
  const holder = createParkCar({
    root: carModel.scene,
    car,
    roadHeight,
    canvasTexture,
    bodyPaint: LOOK.bodyPaint,
  });
  const contactParts = [],
    contactMaterials = [];
  for (const o of holder.children.slice())
    if (o.isMesh && o.material.isMeshBasicMaterial) {
      o.updateMatrix();
      const g = o.geometry.clone().applyMatrix4(o.matrix);
      const colors = new Float32Array(g.attributes.position.count * 4);
      for (let i = 0; i < colors.length; i += 4)
        colors.set([1, 1, 1, o.material.opacity], i);
      g.setAttribute('color', new T.Float32BufferAttribute(colors, 4));
      contactParts.push(g);
      contactMaterials.push(o.material);
      holder.remove(o);
      o.geometry.dispose();
    }
  const contactMaterial = contactMaterials[0].clone();
  contactMaterial.opacity = 1;
  contactMaterial.vertexColors = true;
  const contact = new T.Mesh(mergeGeometries(contactParts), contactMaterial);
  contact.name = 'Merged contact shadow';
  holder.add(contact);
  contactParts.forEach((g) => g.dispose());
  contactMaterials.forEach((m) => m.dispose());
  scene.add(holder);
  const sun = new T.DirectionalLight();
  sun.position.copy(V(car.x, car.y, roadZ)).addScaledVector(toSun, 400);
  sun.target.position.copy(V(car.x, car.y, roadZ));
  sun.castShadow = true;
  const shadowSize = phone ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
    near: 200,
    far: 700,
  });
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 0.04;
  const hemisphere = new T.HemisphereLight();
  scene.add(sun, sun.target, hemisphere);
  // After dark: the row's two cast-iron lanterns (houses.js puts them 6.15 m
  // south of the road line, 4.6 m up) light the street, each with a soft
  // glow (one additive draw for both), and some of the houses' windows are
  // lit. They join the scene the first time they are needed, so daytime
  // shaders carry no extra lights.
  const roadY = (x) => -159.9724 + x * 0.07615;
  const lanterns = [-17, 43].map((x) =>
    V(x, roadY(x) - 6.15, roadHeight(x) + 0.12 + 4.6),
  );
  const lamps = lanterns.map((p) => {
    const lamp = new T.PointLight('#ffe0bc', 0, 0, 2);
    lamp.position.copy(p);
    return lamp;
  });
  const glow = new T.Mesh(
    mergeGeometries(
      lanterns.map((p) =>
        new T.SphereGeometry(1.2, 16, 12).translate(p.x, p.y, p.z),
      ),
    ),
    new T.ShaderMaterial({
      uniforms: {
        strength: { value: 0 },
        color: { value: new T.Color('#ffd9a8') },
        core: {
          value: new T.Vector2(LOOK.lantern.corePower, LOOK.lantern.coreGain),
        },
        halo: {
          value: new T.Vector2(LOOK.lantern.haloPower, LOOK.lantern.haloGain),
        },
      },
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      toneMapped: false,
      vertexShader: `varying vec3 vNormal, vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalMatrix * normal;
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float strength; uniform vec3 color;
        uniform vec2 core, halo;
        varying vec3 vNormal, vView;
        void main() {
          float f = max(dot(normalize(vNormal), normalize(vView)), 0.0);
          gl_FragColor = vec4(color * strength * (pow(f, halo.x) * halo.y + pow(f, core.x) * core.y), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  glow.name = 'Lantern glow';
  glow.frustumCulled = false;
  const windowLight = { value: 0 };
  park.scene.traverse((o) => {
    if (!o.isMesh || !o.material.name.includes('Window glass')) return;
    const { tintSaturation, tintGain } = LOOK.windows;
    // append() baked the blue glass into COLOR_0. Neutralize that colour
    // in place, keeping vertex colours enabled (and the same shader variant).
    const colors = o.geometry.attributes.color;
    if (colors) {
      for (let i = 0; i < colors.count; i++) {
        const r = colors.getX(i),
          g = colors.getY(i),
          b = colors.getZ(i),
          l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        colors.setXYZ(
          i,
          T.MathUtils.lerp(l, r, tintSaturation) * tintGain,
          T.MathUtils.lerp(l, g, tintSaturation) * tintGain,
          T.MathUtils.lerp(l, b, tintSaturation) * tintGain,
        );
      }
      colors.needsUpdate = true;
    }
    seedWindows(o.geometry);
    o.material.onBeforeCompile = (shader) => {
      shader.uniforms.windowLight = windowLight;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float windowSeed;\nvarying float vWindowSeed;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWindowSeed = windowSeed;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float windowLight;\nvarying float vWindowSeed;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float lit = step(0.45, vWindowSeed) * windowLight;
          vec3 lamp = mix(vec3(1.0, 0.6, 0.28), vec3(1.0, 0.78, 0.5), fract(vWindowSeed * 7.0));
          totalEmissiveRadiance += lamp * lit * (0.35 + 0.65 * fract(vWindowSeed * 13.0)) * 0.5;`,
        );
    };
    o.material.customProgramCacheKey = () => 'dolores-window-glass/v1';
    o.material.needsUpdate = true;
  });
  let nightShown = false;
  // Display-sRGB components of a palette colour, as the sky shader takes them.
  const display = (hex, target) => {
    const c = new T.Color(hex).getRGB({}, T.SRGBColorSpace);
    return target.set(c.r, c.g, c.b);
  };
  function applySky() {
    const u = backdrop.uniforms,
      el = sky.sun.elevation,
      dark = 1 - T.MathUtils.smoothstep(el, -12, -3);
    display(sky.zenith, u.zenith.value);
    display(sky.horizon, u.horizon.value);
    display(sky.glow, u.glow.value);
    display(sky.belt, u.belt.value);
    display(sky.sunColor, u.sunColor.value);
    // The band tint darkens a daytime bake through dusk; the night bake is
    // already dark, with its windows lit.
    display(backdropName === 'night' ? '#ffffff' : sky.band, u.bandTint.value);
    u.sunDir.value.copy(sky.toSun);
    u.moonDir.value.copy(sky.toMoon);
    u.moonLit.value = T.MathUtils.lerp(0.4, 1, dark);
    u.stars.value = dark;
    u.halo.value = T.MathUtils.lerp(1, 0.35, T.MathUtils.smoothstep(el, 4, 30));
    toSun.copy(sky.toSun);
    renderer.toneMappingExposure = sky.exposure;
    sun.color.set(sky.key.color);
    sun.intensity = sky.key.intensity;
    sun.position
      .copy(sun.target.position)
      .addScaledVector(sky.key.direction, 400);
    hemisphere.color.set(sky.hemiSky);
    hemisphere.groundColor.set(sky.hemiGround);
    hemisphere.intensity = sky.hemisphere;
    scene.environmentIntensity = sky.environment;
    // Fog mixes in display space; this is the horizon's colour there.
    const fog = new T.Color(sky.horizon).getRGB({}, T.SRGBColorSpace);
    scene.fog.color.setRGB(fog.r, fog.g, fog.b, T.LinearSRGBColorSpace);
    translucency.value = T.MathUtils.clamp(sky.light / 5.5, 0, 1);
    windowLight.value = sky.windows;
    lamps.forEach((lamp) => (lamp.intensity = 280 * sky.lamps));
    glow.material.uniforms.strength.value = sky.lamps;
    if (!nightShown && (sky.lamps > 0 || sky.windows > 0)) {
      nightShown = true;
      scene.add(glow, ...lamps);
    }
    glow.visible = sky.lamps > 0;
  }
  // Lighting and reflections, captured for the current sky. The background
  // only contains the far field; the probe also holds all near geometry,
  // but not the car and its contact shadow. Rerun when the sky changes.
  let initialEnv, localEnv;
  const probeSize = phone ? 128 : 256;
  // The probe's map is the car's environment, and the windows'.
  const probed = [];
  holder.traverse((o) => {
    if (o.isMesh && o.material.isMeshStandardMaterial)
      probed.push([o.material, 1.45]);
  });
  park.scene.traverse((o) => {
    if (o.isMesh && o.material.name.includes('Window glass'))
      probed.push([o.material, 0.85]);
  });
  function capture() {
    captureSky();
    captureProbe();
  }
  function captureSky() {
    const pmrem = new T.PMREMGenerator(renderer),
      u = backdrop.uniforms,
      el = sky.sun.elevation;
    const envTarget = new T.WebGLCubeRenderTarget(phone ? 64 : 128, {
      type: T.HalfFloatType,
    });
    // The original HDRI has a pale, broad sky fill. A small lighting-only
    // cube approximates it by day; after dark the sky keeps its colour.
    const day = T.MathUtils.smoothstep(el, -6, 6);
    u.mode.value = 1;
    u.saturation.value = T.MathUtils.lerp(0.7, 0.1, day);
    u.gain.value = T.MathUtils.lerp(1.15, 1.45, day);
    u.linearGain.value = 1;
    park.scene.visible = holder.visible = glow.visible = false;
    new T.CubeCamera(0.1, 10, envTarget).update(renderer, scene);
    park.scene.visible = true;
    glow.visible = sky.lamps > 0;
    initialEnv?.dispose();
    initialEnv = pmrem.fromCubemap(envTarget.texture);
    envTarget.dispose();
    pmrem.dispose();
    scene.environment = initialEnv.texture;
  }
  function captureProbe() {
    const pmrem = new T.PMREMGenerator(renderer),
      u = backdrop.uniforms;
    const cubeTarget = new T.WebGLCubeRenderTarget(probeSize, {
      type: T.HalfFloatType,
      generateMipmaps: true,
      minFilter: T.LinearMipmapLinearFilter,
    });
    const probe = new T.CubeCamera(0.15, 2000, cubeTarget);
    probe.position.copy(V(car.x, car.y, roadZ + 1.35));
    const day = T.MathUtils.smoothstep(
      sky.sun.elevation,
      LOOK.reflection.nightElevation,
      LOOK.reflection.dayElevation,
    );
    u.mode.value = 2;
    u.linearGain.value = 1;
    u.reflectionSaturation.value = T.MathUtils.lerp(
      LOOK.reflection.saturationNight,
      LOOK.reflection.saturationDay,
      day,
    );
    u.reflectionGain.value = T.MathUtils.lerp(
      LOOK.reflection.gainNight,
      LOOK.reflection.gainDay,
      day,
    );
    probe.update(renderer, scene);
    holder.visible = true;
    u.mode.value = 0;
    u.linearGain.value = 1;
    localEnv?.dispose();
    localEnv = pmrem.fromCubemap(cubeTarget.texture);
    cubeTarget.dispose();
    pmrem.dispose();
    for (const [material, intensity] of probed) {
      material.envMap = localEnv.texture;
      material.envMapIntensity = intensity;
    }
    renderer.shadowMap.needsUpdate = true;
  }
  // The first frame needs some 56 shader programs: the park's surfaces once
  // for the probe (a render target, so linear and without tone mapping) and
  // again for the screen, and the car's. Linked one at a time inside the
  // first render they held the main thread for half a second or more.
  // Compiled here instead, all at once, they link off the main thread, in
  // parallel where the driver can (KHR_parallel_shader_compile), while this
  // polls for them. A program depends on the shape of each environment
  // map, so this runs once the sky's map exists; the car and the windows
  // wear a stand-in the probe's size until the probe itself is captured.
  async function compileShaders() {
    // The stand-in first: its blur shader is sized for the probe, and would
    // otherwise queue behind all the others.
    const pmrem = new T.PMREMGenerator(renderer),
      blank = new T.WebGLCubeRenderTarget(probeSize, { type: T.HalfFloatType }),
      standIn = pmrem.fromCubemap(blank.texture);
    blank.dispose();
    pmrem.dispose();
    const probeTarget = new T.WebGLCubeRenderTarget(16, {
      type: T.HalfFloatType,
    });
    renderer.setRenderTarget(probeTarget);
    renderer.compile(park.scene, camera, scene);
    // The additive glow also appears in night probes. Its linear-target
    // program must join the wait along with its screen program below.
    if (glow.parent) renderer.compile(glow, camera, scene);
    renderer.setRenderTarget(null);
    probeTarget.dispose();
    for (const [material] of probed) material.envMap = standIn.texture;
    renderer.compile(scene, camera);
    for (const [material] of probed) material.envMap = null;
    standIn.dispose();
    const giveUp = performance.now() + 10000,
      waiting = new Set(renderer.info.programs);
    let backlog = false;
    while (waiting.size && !stopping() && performance.now() < giveUp) {
      await new Promise((resolve) => setTimeout(resolve, backlog ? 0 : 8));
      // A finished program's first use reads back its uniforms, a round
      // trip to the GPU process each. Done here, about 10 ms of them per
      // turn, that stays out of the first render too.
      const until = performance.now() + 10;
      backlog = false;
      for (const program of waiting) {
        if (performance.now() > until) {
          backlog = true;
          break;
        }
        if (program.isReady()) {
          program.getUniforms();
          waiting.delete(program);
        }
      }
    }
  }
  // After each wait: the caller may have given up meanwhile (the section
  // unmounting), or the context been lost before the viewer listens for
  // that; either way what was built is released, and the caller keeps its
  // poster.
  function stopping() {
    return signal?.aborted || renderer.getContext().isContextLost();
  }
  function releaseIfStopping() {
    if (!stopping()) return;
    controls.dispose();
    release();
    throw signal?.aborted ? abortError() : Error('WebGL context lost');
  }
  applySky();
  captureSky();
  await compileShaders();
  releaseIfStopping();
  captureProbe();
  // A turn for the page between the probe and the first frame.
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseIfStopping();
  renderer.shadowMap.needsUpdate = true;
  camera.position.copy(
    V(pose[0], pose[1], groundAt(pose[0], pose[1]) + pose[2]),
  );
  controls.target.copy(V(pose[3], pose[4], roadZ + pose[5]));
  camera.lookAt(controls.target);
  // The park side of the car is crowded. Measured at the default pose's 8 m
  // orbit, from about 172° to 255° round from the default view a bench fills
  // the foreground, then the keep-outs pull the camera in until the car's
  // nose leaves a 4:3 frame, then the leaning trunk fills one side. The orbit
  // stops either side of that arc instead. The bearings are the world's,
  // taken from the default pose, so they hold for any pose about the car.
  const defaultBearing = Math.atan2(
    DEFAULT_POSE[0] - DEFAULT_POSE[3],
    DEFAULT_POSE[4] - DEFAULT_POSE[1],
  );
  controls.minAzimuthAngle = defaultBearing + T.MathUtils.degToRad(255 - 360);
  controls.maxAzimuthAngle = defaultBearing + T.MathUtils.degToRad(172);
  // Horizontal circular footprints conservatively enclose the two trunks,
  // both benches, the two row lamps, and the three sidewalk trees.
  const obstacles = data.obstacles || [
    { name: 'hero trunk', x: 10.6, y: -148.5, r: 0.95, top: 15 },
    { name: 'leaning trunk', x: 7.8, y: -149.4, r: 1.2, top: 15 },
    { name: 'bench 1', x: 15.8, y: -148.9994, r: 1.4, top: 1.55 },
    { name: 'bench 2', x: 19, y: -148.7556, r: 1.4, top: 1.55 },
    ...[-17, 43].map((x) => ({
      name: 'lamp',
      x,
      y: -159.9724 + x * 0.07615 - 6.55,
      r: 0.5,
      top: 5.1,
    })),
    ...[18, 37, 61].map((x) => ({
      name: 'street tree',
      x,
      y: -159.9724 + x * 0.07615 - 6.55,
      r: 0.5,
      top: 5.5,
    })),
  ];
  function constrainCamera() {
    const offset = camera.position.clone().sub(controls.target),
      length = offset.length();
    if (length > 9 || length < 4)
      offset.multiplyScalar(T.MathUtils.clamp(length, 4, 9) / length);
    const horizontal = Math.hypot(offset.x, offset.z),
      dx = offset.x / horizontal,
      dz = offset.z / horizontal;
    let allowed = horizontal;
    for (const o of obstacles) {
      if (camera.position.y > groundAt(o.x, o.y) + o.top) continue;
      const ox = o.x - controls.target.x,
        oz = -o.y - controls.target.z,
        along = ox * dx + oz * dz,
        perp2 = ox * ox + oz * oz - along * along;
      if (along > 0 && perp2 < o.r * o.r)
        allowed = Math.min(
          allowed,
          along - Math.sqrt(o.r * o.r - perp2) - 0.25,
        );
    }
    if (allowed < horizontal)
      offset.multiplyScalar(
        Math.max(4 / offset.length(), allowed / horizontal),
      );
    camera.position.copy(controls.target).add(offset);
    camera.position.y = Math.max(
      camera.position.y,
      groundAt(camera.position.x, -camera.position.z) + 0.45,
    );
    // Clamp against sampled woody capsules as well as footprint sectors.
    const ray = camera.position.clone().sub(controls.target),
      distance = ray.length();
    ray.normalize();
    let safe = distance;
    for (const sphere of data.cameraSpheres || []) {
      const relative = new T.Vector3(sphere[0], sphere[1], sphere[2]).sub(
        controls.target,
      );
      const along = relative.dot(ray),
        perp2 = relative.lengthSq() - along * along,
        r = sphere[3];
      if (along > 0 && perp2 < r * r)
        safe = Math.min(safe, along - Math.sqrt(r * r - perp2));
    }
    if (safe < distance)
      camera.position
        .copy(controls.target)
        .addScaledVector(ray, Math.max(4, safe));
    // Re-project onto the 9 m sphere after the sloping-ground lift.
    for (let i = 0; i < 3; i++) {
      camera.position.y = Math.max(
        camera.position.y,
        groundAt(camera.position.x, -camera.position.z) + 0.45,
      );
      const dy = camera.position.y - controls.target.y,
        dx = camera.position.x - controls.target.x,
        dz = camera.position.z - controls.target.z;
      const cap = Math.sqrt(Math.max(0, 81 - dy * dy)),
        horizontal = Math.hypot(dx, dz);
      if (horizontal > cap) {
        camera.position.x = controls.target.x + (dx * cap) / horizontal;
        camera.position.z = controls.target.z + (dz * cap) / horizontal;
      }
    }
    camera.lookAt(controls.target);
  }
  function resize() {
    const width = size?.[0] ?? Math.max(1, container.clientWidth),
      height = size?.[1] ?? Math.max(1, container.clientHeight);
    // The Garage frame runs the window's full width, so a large high-DPI
    // window would otherwise fill four times the pixels the old column did.
    renderer.setPixelRatio(
      Math.min(pixelRatio, Math.sqrt(PIXEL_BUDGET / (width * height))),
    );
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = T.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(T.MathUtils.degToRad(horizontalFov) / 2) / camera.aspect,
        ),
    );
    camera.updateProjectionMatrix();
    invalidate();
  }
  let raf = 0,
    disposed = false,
    paused = false,
    inView = true,
    renderedFrames = 0;
  const cullMeshes = [];
  scene.updateMatrixWorld(true);
  park.scene.traverse((o) => {
    if (o.isMesh && !houseBatches.some((b) => b.mesh === o)) {
      const box = new T.Box3().setFromObject(o, true);
      cullMeshes.push({ o, box });
    }
  });
  const frustum = new T.Frustum(),
    projection = new T.Matrix4();
  let startupFrame;
  function cullHouseBatches(view) {
    for (const batch of houseBatches) {
      const visible = batch.cells.filter(
        (cell) => !view || view.intersectsBox(cell.box),
      );
      if (batch.mesh.material.transparent)
        visible.sort(
          (a, b) =>
            b.center.distanceToSquared(camera.position) -
            a.center.distanceToSquared(camera.position),
        );
      const key = visible.map((cell) => cell.offset).join(',');
      batch.mesh.visible = visible.length > 0;
      if (batch.key === key) continue;
      batch.key = key;
      const geometry = batch.mesh.geometry;
      let offset = 0;
      for (const cell of visible) {
        geometry.index.array.set(
          batch.indices.subarray(cell.offset, cell.offset + cell.count),
          offset,
        );
        offset += cell.count;
      }
      geometry.index.clearUpdateRanges();
      geometry.index.addUpdateRange(0, offset);
      geometry.index.needsUpdate = true;
      geometry.setDrawRange(0, offset);
    }
  }
  function render() {
    constrainCamera();
    camera.updateMatrixWorld();
    if (renderer.shadowMap.needsUpdate) {
      cullHouseBatches(null);
      cullMeshes.forEach(({ o }) => {
        o.visible = true;
      });
      renderer.render(scene, camera);
      startupFrame = {
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
      };
    }
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    cullMeshes.forEach(({ o, box }) => {
      o.visible = frustum.intersectsBox(box);
    });
    cullHouseBatches(frustum);
    renderer.render(scene, camera);
    renderedFrames++;
  }
  function frame() {
    raf = 0;
    if (disposed || paused || document.hidden || !inView) return;
    const changing = controls.update();
    render();
    if (changing) invalidate();
  }
  function invalidate() {
    if (!raf && !disposed && !paused && !document.hidden && inView)
      raf = requestAnimationFrame(frame);
  }
  controls.addEventListener('change', invalidate);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const intersection = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    if (inView) invalidate();
  });
  intersection.observe(renderer.domElement);
  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else invalidate();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (e) => {
    e.preventDefault();
    paused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    onContextLost?.();
  };
  // The restored context has none of the uploaded GPU state, so the caller
  // disposes this viewer and builds a fresh one rather than re-uploading.
  const onRestored = () => onContextRestored?.();
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);
  resize();
  controls.update();
  render();
  // Count all unique GPU texture allocations, mip chains, shadow colour/depth,
  // and the two retained PMREM targets. WebP decodes to RGBA8 on the GPU.
  function textureReport() {
    const textures = new Set();
    scene.traverse((o) => {
      if (o.isMesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    });
    backdrop.textures.forEach((t) => textures.add(t));
    textures.add(initialEnv.texture);
    textures.add(localEnv.texture);
    let bytes = shadowSize * shadowSize * 8;
    const details = [];
    for (const t of textures) {
      const imgs = t.isCubeTexture ? t.image : [t.image];
      let n = 0;
      for (const img of imgs || [])
        if (img)
          n +=
            (img.width || img.image?.width || 0) *
            (img.height || img.image?.height || 0) *
            (t.type === T.HalfFloatType ? 8 : 4) *
            (t.generateMipmaps ? 4 / 3 : 1);
      bytes += n;
      details.push({
        name: t.name,
        width: imgs?.[0]?.width,
        height: imgs?.[0]?.height,
        bytes: Math.ceil(n),
      });
    }
    return {
      count: textures.size,
      bytes: Math.ceil(bytes),
      details,
      includesShadow: true,
    };
  }
  render();
  const info = {
    startupFrame,
    phone,
    sun: describeSky(),
    triangles: renderer.info.render.triangles,
    drawCalls: renderer.info.render.calls,
    textures: textureReport(),
    glbBytes,
    backdropBytes,
    downloadBytes: glbBytes + backdropBytes,
    loadTimeMs: performance.now() - started,
    shadowMap: shadowSize,
    patchedMaterials: patched,
    frameTimeMs: null,
    pixelRatio: renderer.getPixelRatio(),
    viewport: renderer.getSize(new T.Vector2()).toArray(),
    orbit: {
      min: 4,
      max: 9,
      groundClearance: 0.45,
      azimuth: [controls.minAzimuthAngle, controls.maxAzimuthAngle],
      obstacles,
    },
    car: {
      ...car,
      position: holder.position.toArray(),
      rotation: holder.rotation.toArray(),
    },
    camera: camera.position.toArray(),
  };
  async function benchmark() {
    paused = true;
    cancelAnimationFrame(raf);
    raf = 0;
    const saved = camera.position.clone(),
      target = controls.target.clone(),
      gl = renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      queries = [],
      times = [];
    let maxDrawCalls = 0,
      maxTriangles = 0;
    // Compile/warm every azimuth before recording; the static shadow map is
    // cached exactly as it is during interactive orbiting.
    for (let i = -24; i < 120; i++) {
      const angle = (i / 120) * Math.PI * 2;
      camera.position
        .copy(target)
        .add(new T.Vector3(Math.sin(angle) * 8, 2.8, -Math.cos(angle) * 8));
      let query;
      if (i >= 0 && ext) {
        query = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      }
      const start = performance.now();
      render();
      if (query) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queries.push(query);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      if (i >= 0) {
        times.push(performance.now() - start);
        maxDrawCalls = Math.max(maxDrawCalls, renderer.info.render.calls);
        maxTriangles = Math.max(maxTriangles, renderer.info.render.triangles);
      }
      if (i % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const gpu = [];
    for (const query of queries) {
      if (
        gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) &&
        !gl.getParameter(ext.GPU_DISJOINT_EXT)
      )
        gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
    const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    info.frameTimeMs = median(times);
    info.gpuFrameTimeMs = gpu.length === 120 ? median(gpu) : null;
    info.benchmarkFrames = 120;
    info.orbitMaxDrawCalls = maxDrawCalls;
    info.orbitMaxTriangles = maxTriangles;
    info.benchmarkMethod =
      'CPU submit + synchronous 1-pixel readback (completed GPU), 24 warmup frames, 120 orbit frames';
    camera.position.copy(saved);
    controls.target.copy(target);
    render();
    paused = false;
    return info;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    intersection.disconnect();
    controls.dispose();
    document.removeEventListener('visibilitychange', onVisibility);
    renderer.domElement.removeEventListener('webglcontextlost', onLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
    clearInterval(following);
    release();
  }
  // Everything the scene holds on the GPU, and the decoded images.
  function release() {
    const geometries = new Set(),
      materials = new Set(),
      textures = new Set();
    scene.traverse((o) => {
      if (o.isMesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
    for (const m of materials) {
      for (const t of Object.values(m)) if (t?.isTexture) textures.add(t);
      m.dispose();
    }
    geometries.forEach((g) => g.dispose());
    const decodedImages = new Set();
    textures.forEach((t) => {
      if (t.image?.close) decodedImages.add(t.image);
      t.dispose();
    });
    decodedImages.forEach((img) => img.close());
    if (!nightShown) {
      glow.geometry.dispose();
      glow.material.dispose();
    }
    backdrop.textures.forEach((t) => t.dispose());
    images.forEach((i) => i.close());
    initialEnv.dispose();
    localEnv?.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  // What the frame was lit for: a fixed sun, or the time and the sun and
  // Moon the clock gave, and the far-field bake that was loaded.
  function describeSky() {
    const round = (v) => Math.round(v * 100) / 100;
    return {
      mode: sunName,
      time: sky.time,
      azimuth: round(sky.sun.azimuth),
      elevation: round(sky.sun.elevation),
      moon: {
        azimuth: round(sky.moon.azimuth),
        elevation: round(sky.moon.elevation),
        illumination: round(sky.moon.illumination),
      },
      backdrop: backdropName,
      key: { color: sky.key.color, intensity: round(sky.key.intensity) },
      exposure: round(sky.exposure),
      lamps: round(sky.lamps),
    };
  }
  function setSky(next) {
    sky = next;
    applySky();
    capture();
    info.sun = describeSky();
    invalidate();
  }
  // A live sky with no fixed time follows the clock: once a minute, and
  // only while the canvas is on screen, it relights when the sun or Moon has
  // moved half a degree (every two minutes or so), redrawing the shadow
  // map and the reflection probe. The far-field bake stays the one loaded.
  // A sun past astronomical twilight, or a Moon below the horizon, lights
  // nothing, so its motion is ignored.
  const moved = (a, b, below) =>
    (a.elevation > below || b.elevation > below) &&
    (Math.abs(a.elevation - b.elevation) > 0.5 ||
      Math.abs(((a.azimuth - b.azimuth + 540) % 360) - 180) > 0.5);
  // Not mid-drag, either: a relight costs a frame or two.
  let dragging = false;
  controls.addEventListener('start', () => (dragging = true));
  controls.addEventListener('end', () => (dragging = false));
  const following =
    live && time === undefined
      ? setInterval(() => {
          if (disposed || paused || dragging || !inView || document.hidden)
            return;
          const next = doloresSky(Date.now());
          if (moved(next.sun, sky.sun, -18) || moved(next.moon, sky.moon, -1))
            setSky(next);
        }, 60000)
      : 0;
  return {
    info,
    scene,
    camera,
    controls,
    renderer,
    render,
    invalidate,
    benchmark,
    dispose,
    /** Relights a 'live' viewer for another moment (Date or ms). */
    setTime(next) {
      if (!live) throw Error('setTime needs sun: live');
      setSky(doloresSky(+next));
    },
    groundAt,
    constrainCamera,
    // Stops the loop and returns the current pose as a PNG data URL.
    snapshot() {
      paused = true;
      cancelAnimationFrame(raf);
      raf = 0;
      render();
      return renderer.domElement.toDataURL('image/png');
    },
    get renderedFrames() {
      return renderedFrames;
    },
  };
}
