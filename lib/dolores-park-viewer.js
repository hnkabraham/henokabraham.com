import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { restoreDoloresMaterials } from './dolores-park-materials.js';
import { createParkCar } from './dolores-park-car.js';
import { suns, sunDirection } from './dolores-park-lighting.js';

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
// One viewer per container. Everything is fetched and parsed before the
// WebGL context exists, so an abort (the section unmounting mid-load) has
// nothing GPU-side to release. Paths passed to `load` are public-root
// relative ('/models/…', '/scenery/…'); the caller maps them to URLs.
export async function createDoloresViewer(container, options = {}) {
  const {
    phone = false,
    sun: sunName = 'winter',
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
  if (!suns[sunName]) throw Error(`Unknown sun: ${sunName}`);
  const light = { ...suns[sunName] },
    toSun = sunDirection(light);
  if (pose.length !== 6 || !pose.every(Number.isFinite))
    throw Error('pose requires x,y,h,lookx,looky,lookh');
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const suffix = phone ? '-phone' : '';
  const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map(
    (face) =>
      `/scenery/dolores-sky${sunName === 'summer' ? '-summer' : ''}${suffix}-${face}.webp`,
  );
  let glbBytes = 0,
    backdropBytes = 0;
  let park, carModel, images;
  try {
    [park, carModel, images] = await Promise.all([
      load(`/models/dolores-park${suffix}.glb`).then((b) => {
        glbBytes = b.byteLength;
        return loader.parseAsync(b, '');
      }),
      load('/models/garage-gt350r.glb').then((b) => loader.parseAsync(b, '')),
      Promise.all(
        faces.map(async (path) => {
          const b = await load(path);
          backdropBytes += b.byteLength;
          return createImageBitmap(new Blob([b], { type: 'image/webp' }));
        }),
      ),
    ]);
  } finally {
    draco.dispose();
  }
  let data;
  park.scene.traverse((o) => {
    if (o.userData.dolores) data = o.userData.dolores;
  });
  if (signal?.aborted || !data) {
    disposeLoaded(park.scene);
    disposeLoaded(carModel.scene);
    images.forEach((i) => i.close());
    throw signal?.aborted
      ? abortError()
      : Error('Missing Dolores placement metadata');
  }
  const renderer = new T.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = light.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  container.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.FogExp2('#e4f3fb', 0.00009);
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
  const backdrop = new T.CubeTexture(images);
  backdrop.colorSpace = T.SRGBColorSpace;
  backdrop.generateMipmaps = true;
  backdrop.minFilter = T.LinearMipmapLinearFilter;
  backdrop.needsUpdate = true;
  scene.background = backdrop;
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
  const patched = restoreDoloresMaterials(park.scene, { toSun });
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
  const sun = new T.DirectionalLight(light.color, light.intensity);
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
  scene.add(
    sun,
    sun.target,
    new T.HemisphereLight(0xbcd2ee, 0x5a5048, light.hemisphere),
  );
  const pmrem = new T.PMREMGenerator(renderer);
  // The background only contains the far field. This one-time probe includes
  // all near geometry but hides the car and its contact shadow.
  const cubeTarget = new T.WebGLCubeRenderTarget(phone ? 64 : 128, {
    type: T.HalfFloatType,
    generateMipmaps: true,
    minFilter: T.LinearMipmapLinearFilter,
  });
  const probe = new T.CubeCamera(0.15, 2000, cubeTarget);
  probe.position.copy(V(car.x, car.y, roadZ + 1.05));
  // The original HDRI has a pale, broad sky fill. A small lighting-only cube
  // approximates that fill; the unmodified city cube remains the background.
  const envFaces = images.map((img) => {
    const c = document.createElement('canvas');
    c.width = c.height = phone ? 64 : 128;
    const ctx = c.getContext('2d');
    ctx.filter = 'saturate(25%) brightness(130%)';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  });
  const envBackdrop = new T.CubeTexture(envFaces);
  envBackdrop.colorSpace = T.SRGBColorSpace;
  envBackdrop.needsUpdate = true;
  const initialEnv = pmrem.fromCubemap(envBackdrop);
  scene.background = envBackdrop;
  scene.environment = initialEnv.texture;
  scene.environmentIntensity = light.environment;
  holder.visible = false;
  probe.update(renderer, scene);
  holder.visible = true;
  scene.background = backdrop;
  envBackdrop.dispose();
  const localEnv = pmrem.fromCubemap(cubeTarget.texture);
  holder.traverse((o) => {
    if (o.isMesh && o.material.isMeshStandardMaterial) {
      o.material.envMap = localEnv.texture;
      o.material.envMapIntensity = 1.4;
    }
  });
  park.scene.traverse((o) => {
    if (o.isMesh && o.material.name.includes('Window glass')) {
      o.material.envMap = localEnv.texture;
      o.material.envMapIntensity = 0.85;
    }
  });
  cubeTarget.dispose();
  pmrem.dispose();
  renderer.shadowMap.needsUpdate = true;
  camera.position.copy(
    V(pose[0], pose[1], groundAt(pose[0], pose[1]) + pose[2]),
  );
  controls.target.copy(V(pose[3], pose[4], roadZ + pose[5]));
  camera.lookAt(controls.target);
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
    textures.add(backdrop);
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
    sun: light,
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
    pixelRatio,
    viewport: renderer.getSize(new T.Vector2()).toArray(),
    orbit: { min: 4, max: 9, groundClearance: 0.45, obstacles },
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
    backdrop.dispose();
    images.forEach((i) => i.close());
    initialEnv.dispose();
    localEnv.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
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
