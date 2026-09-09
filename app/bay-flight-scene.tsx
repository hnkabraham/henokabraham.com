'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { Material, Mesh, Texture, Group } from 'three';
import {
  BAY_ORIGIN,
  RUNWAY_HEADING,
  sampleBayFlight,
  sampleBayCamera,
  smooth,
} from '@/lib/bay-flight';
import {
  createAirportBuildings,
  type AirportBuildings,
} from '@/lib/sfo-buildings';
import { addWingFlex, addSkinDetail } from '@/lib/airframe-flex';
import {
  buildCityGeometry,
  createCityMesh,
  loadCityBuildings,
} from '@/lib/bay-city';
import {
  MERCATOR_ORIGIN,
  NORTH_BOUNDS,
  RUNWAY_BOUNDS,
  SFO_BOUNDS,
  SOUTH_BOUNDS,
  addBaySurface,
  addPavementWear,
  mercator,
  type SurfaceLayer,
} from '@/lib/bay-surface';
import type { createBayAudio } from '@/lib/bay-audio';

type Props = {
  progress: RefObject<number>;
  reducedMotion: boolean;
  audio: RefObject<ReturnType<typeof createBayAudio> | null>;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

/** Quarter-metre elevations, stored as the high and low bytes of a lossless WebP. */
async function loadElevation(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Terrain unavailable');
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const size = bitmap.width;
  if (size !== bitmap.height || size < 2) throw new Error('Invalid terrain grid');
  const canvas =
    typeof OffscreenCanvas === 'undefined'
      ? Object.assign(document.createElement('canvas'), {
          width: size,
          height: size,
        })
      : new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('Terrain decoder unavailable');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, size, size);
  const grid = new Uint16Array(size * size);
  for (let i = 0; i < grid.length; i++)
    grid[i] = data[i * 4] * 256 + data[i * 4 + 1];
  return { grid, size };
}

/** Tileable value-noise normal map: skin waviness on paint, wind ripples on water. */
function createNoiseNormal(
  T: typeof import('three'),
  options: { size: number; octaves: [number, number][]; slope: number; seed: number },
) {
  const { size, slope } = options;
  const height = new Float32Array(size * size);
  let seed = options.seed;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (const [cells, amplitude] of options.octaves) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    const at = (x: number, y: number) =>
      lattice[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells,
          gy = (y / size) * cells;
        const x0 = Math.floor(gx),
          y0 = Math.floor(gy);
        const fx = fade(gx - x0),
          fy = fade(gy - y0);
        height[y * size + x] +=
          amplitude *
          ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
            (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy);
      }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx =
        height[y * size + ((x + 1) % size)] -
        height[y * size + ((x + size - 1) % size)];
      const dy =
        height[((y + 1) % size) * size + x] -
        height[((y + size - 1) % size) * size + x];
      const length = Math.hypot(dx * slope, dy * slope, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx * slope) / length) * 127.5 + 127.5;
      data[i + 1] = ((-dy * slope) / length) * 127.5 + 127.5;
      data[i + 2] = (1 / length) * 127.5 + 127.5;
      data[i + 3] = 255;
    }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export default function BayFlightScene(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  }, [props]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const abort = new AbortController();
    async function setup() {
      const [
        T,
        { GLTFLoader },
        { HDRLoader },
        { Sky },
        { createBayRendering, ATMOSPHERE_EXPOSURE },
      ] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/HDRLoader.js'),
        import('three/addons/objects/Sky.js'),
        import('@/lib/bay-rendering'),
      ]);
      if (disposed || !container) return;
      const mobile = container.clientWidth < 800;
      const renderer = new T.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.4 : 1.7));
      renderer.toneMapping = T.AgXToneMapping;
      renderer.toneMappingExposure = 0.94;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);
      const scene = new T.Scene();
      scene.background = new T.Color(0xb8d1e2);
      scene.fog = new T.FogExp2(0xb8d1e2, 0.000034);
      const camera = new T.PerspectiveCamera(39, 1, 1, 250000);
      const sky = new Sky();
      sky.scale.setScalar(180000);
      sky.material.uniforms.turbidity.value = 2.8;
      sky.material.uniforms.rayleigh.value = 1.35;
      sky.material.uniforms.mieCoefficient.value = 0.003;
      sky.material.uniforms.mieDirectionalG.value = 0.8;
      const sunlight = new T.Vector3(-0.66, 0.44, 0.61).normalize();
      sky.material.uniforms.sunPosition.value.copy(sunlight);
      scene.add(sky);
      // Fallback lighting for the simple sky; the atmosphere replaces both.
      const skylight = new T.HemisphereLight(0xcfe7ff, 0x526056, 0.38);
      scene.add(skylight);
      const sun = new T.DirectionalLight(0xfff2df, 3.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
      Object.assign(sun.shadow.camera, {
        left: -65,
        right: 65,
        top: 65,
        bottom: -65,
        near: 1,
        // Deep enough to reach the ground through most of the climb; the
        // shadow fades with altitude below instead of cutting off.
        far: 8000,
      });
      sun.shadow.normalBias = 0.045;
      sun.shadow.radius = 2;
      sun.shadow.bias = -0.0000225;
      scene.add(sun, sun.target);
      const world = new T.Group();
      scene.add(world);
      let rendering: ReturnType<typeof createBayRendering> = undefined;
      const aircraft = new T.Group();
      scene.add(aircraft);
      const orientedAirframe = new T.Group();
      orientedAirframe.rotation.y = -Math.PI / 2;
      aircraft.add(orientedAirframe);
      const geometries = new Set<InstanceType<typeof T.BufferGeometry>>();
      const materials = new Set<Material>();
      const textures = new Set<Texture>();
      let environment: InstanceType<typeof T.WebGLRenderTarget> | undefined;
      let frame = 0,
        visible = true,
        ready = false,
        lastTime = 0,
        previousP = -1;
      let currentP = latest.current.reducedMotion
        ? 1
        : latest.current.progress.current;
      const fans: Mesh[] = [];
      const gearGroups: Group[] = [];
      let width = 1,
        height = 1;
      const ownTexture = (texture: Texture) => {
        textures.add(texture);
        return texture;
      };
      function disposeObject(object: InstanceType<typeof T.Object3D>) {
        object.traverse((node) => {
          const mesh = node as Mesh;
          if (!mesh.isMesh) return;
          geometries.add(mesh.geometry);
          const list = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          list.forEach((material) => {
            materials.add(material);
            Object.values(material).forEach((value) => {
              if (value instanceof T.Texture) textures.add(value);
            });
          });
        });
      }
      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (!visible) latest.current.audio.current?.update(currentP, false);
        },
        { threshold: 0 },
      );
      observer.observe(container);
      const visibilityChange = () =>
        latest.current.audio.current?.update(
          currentP,
          visible && !document.hidden && ready,
        );
      document.addEventListener('visibilitychange', visibilityChange);
      const resize = () => {
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        // Bound HDR buffers on Retina/4K screens without changing composition.
        renderer.setPixelRatio(
          Math.min(
            devicePixelRatio,
            mobile ? 1.4 : 1.7,
            Math.sqrt((mobile ? 1_250_000 : 4_000_000) / (width * height)),
          ),
        );
        renderer.setSize(width, height);
        rendering?.resize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        previousP = -1;
      };
      const sizeObserver = new ResizeObserver(resize);
      sizeObserver.observe(container);
      resize();
      const contextLost = (event: Event) => {
        event.preventDefault();
        latest.current.onStatus('unavailable');
        latest.current.audio.current?.update(0, false);
        cleanup?.();
      };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      cleanup = () => {
        if (disposed) return;
        disposed = true;
        abort.abort();
        cancelAnimationFrame(frame);
        observer.disconnect();
        document.removeEventListener('visibilitychange', visibilityChange);
        latest.current.audio.current?.update(0, false);
        sizeObserver.disconnect();
        renderer.domElement.removeEventListener(
          'webglcontextlost',
          contextLost,
        );
        disposeObject(scene);
        rendering?.dispose();
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        textures.forEach((t) => t.dispose());
        environment?.dispose();
        sun.shadow.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };

      rendering = createBayRendering(
        renderer,
        scene,
        camera,
        sun,
        sunlight,
        mobile,
      );
      const atmosphereReady = rendering?.ready ?? Promise.resolve(false);
      if (process.env.NODE_ENV !== 'production')
        (window as unknown as { __bayDebug?: unknown }).__bayDebug = {
          rendering,
          renderer,
          scene,
          sun,
        };
      // The HDR is only image-based light for the fallback sky.
      const daylight = atmosphereReady.then((enabled) =>
        enabled || disposed
          ? null
          : new HDRLoader().loadAsync('/scenery/daylight.hdr'),
      );

      // Actual terrain, registered to the satellite texture, in meter-scale space.
      const segments = mobile ? 512 : 1024;
      const terrainGeometry = new T.PlaneGeometry(
        48000,
        48000,
        segments,
        segments,
      );
      geometries.add(terrainGeometry);
      terrainGeometry.rotateX(-Math.PI / 2);
      const sea = new T.Mesh(
        new T.PlaneGeometry(400000, 400000),
        new T.MeshStandardMaterial({
          color: 0x527e8e,
          roughness: 0.5,
          metalness: 0.1,
        }),
      );
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -0.5;
      world.add(sea);
      const textureLoader = new T.TextureLoader();
      const resources = await Promise.allSettled([
        new GLTFLoader().loadAsync('/models/boeing-787-9.glb'),
        textureLoader.loadAsync(
          mobile ? '/scenery/sf-bay-mobile.webp' : '/scenery/sf-bay.webp',
        ),
        loadElevation('/scenery/bay-elevation.webp', abort.signal),
        textureLoader.loadAsync(
          mobile
            ? '/scenery/sfo-detail-mobile.webp'
            : '/scenery/sfo-detail.webp',
        ),
        textureLoader.loadAsync(
          mobile
            ? '/scenery/naip-runway-mobile.webp'
            : '/scenery/naip-runway.webp',
        ),
        textureLoader.loadAsync('/scenery/runway-color.webp'),
        textureLoader.loadAsync('/scenery/runway-normal.webp'),
        textureLoader.loadAsync('/scenery/runway-roughness.webp'),
        fetch('/scenery/sfo-buildings.json', { signal: abort.signal }).then(
          (r) => {
            if (!r.ok) throw new Error('Buildings unavailable');
            return r.json() as Promise<AirportBuildings>;
          },
        ),
      ]);
      const [
        modelResult,
        mapResult,
        elevationResult,
        airportResult,
        runwayAreaResult,
        asphaltResult,
        normalResult,
        roughnessResult,
        buildingsResult,
      ] = resources;
      for (const result of [
        airportResult,
        runwayAreaResult,
        asphaltResult,
        normalResult,
        roughnessResult,
      ])
        if (result.status === 'fulfilled') ownTexture(result.value);
      // GLTF and texture loaders can finish after React unmounts.
      if (
        disposed ||
        modelResult.status === 'rejected' ||
        mapResult.status === 'rejected' ||
        elevationResult.status === 'rejected'
      ) {
        if (modelResult.status === 'fulfilled')
          disposeObject(modelResult.value.scene);
        if (mapResult.status === 'fulfilled') mapResult.value.dispose();
        void daylight.then((texture) => texture?.dispose());
        terrainGeometry.dispose();
        if (!disposed) {
          latest.current.onStatus('unavailable');
          cleanup?.();
        } else {
          geometries.forEach((g) => g.dispose());
          materials.forEach((m) => m.dispose());
          textures.forEach((t) => t.dispose());
        }
        return;
      }
      const model = modelResult.value.scene;
      disposeObject(model);
      const map = ownTexture(mapResult.value);
      map.colorSpace = T.SRGBColorSpace;
      map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      const { grid: elevation, size: gridSize } = elevationResult.value;
      const gridStep = (gridSize - 1) / segments;
      if (!Number.isInteger(gridStep) || gridStep < 1)
        throw new Error('Invalid terrain grid');
      const position = terrainGeometry.attributes.position;
      for (let row = 0; row <= segments; row++)
        for (let col = 0; col <= segments; col++) {
          position.setY(
            row * (segments + 1) + col,
            elevation[row * gridStep * gridSize + col * gridStep] / 4,
          );
        }
      // Web Mercator per vertex, relative to a nearby origin, so any number of
      // north-up imagery layers can be placed from one registration.
      const mercatorCoordinates = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        const [mx, my] = mercator(
          position.getX(i) / 10 + 5900,
          position.getZ(i) / 10 + 7600,
        );
        mercatorCoordinates[i * 2] = mx - MERCATOR_ORIGIN[0];
        mercatorCoordinates[i * 2 + 1] = my - MERCATOR_ORIGIN[1];
      }
      terrainGeometry.setAttribute(
        'mercator',
        new T.BufferAttribute(mercatorCoordinates, 2),
      );
      terrainGeometry.computeVertexNormals();
      const terrainMaterial = new T.MeshStandardMaterial({
        map,
        roughness: 0.96,
        metalness: 0,
        color: 0xe7edf0,
      });
      const imagery = (texture: Texture) => {
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = Math.min(
          16,
          renderer.capabilities.getMaxAnisotropy(),
        );
        return texture;
      };
      // Coarse to fine. The corridor layers arrive after the first frame.
      const layers: SurfaceLayer[] = [
        { bounds: SOUTH_BOUNDS, texture: null, feather: 0.05 },
        { bounds: NORTH_BOUNDS, texture: null, feather: 0.05 },
        {
          bounds: SFO_BOUNDS,
          texture:
            airportResult.status === 'fulfilled'
              ? imagery(airportResult.value)
              : null,
        },
        {
          bounds: RUNWAY_BOUNDS,
          texture:
            runwayAreaResult.status === 'fulfilled'
              ? imagery(runwayAreaResult.value)
              : null,
          feather: 0.06,
        },
      ];
      const lazyLayers: [number, string][] = [
        [0, mobile ? '/scenery/naip-south-mobile.webp' : '/scenery/naip-south.webp'],
        [1, mobile ? '/scenery/naip-north-mobile.webp' : '/scenery/naip-north.webp'],
      ];
      const pavementMaps = [asphaltResult, normalResult, roughnessResult].map(
        (result) => (result.status === 'fulfilled' ? result.value : null),
      );
      for (const texture of pavementMaps)
        if (texture) {
          texture.wrapS = texture.wrapT = T.RepeatWrapping;
          texture.anisotropy = Math.min(
            16,
            renderer.capabilities.getMaxAnisotropy(),
          );
        }
      if (pavementMaps[0]) pavementMaps[0].colorSpace = T.SRGBColorSpace;
      const waterNormal = ownTexture(
        createNoiseNormal(T, {
          size: 256,
          octaves: [
            [6, 1],
            [12, 0.5],
            [24, 0.25],
            [48, 0.125],
          ],
          slope: 2.5,
          seed: 3,
        }),
      );
      const surface = addBaySurface(
        terrainMaterial,
        layers.filter((layer) => layer.texture || lazyLayers.some(([i]) => layers[i] === layer)),
        pavementMaps[0] && pavementMaps[1]
          ? {
              map: pavementMaps[0],
              normalMap: pavementMaps[1],
              waterNormalMap: waterNormal,
            }
          : null,
      );
      const fadingLayers = new Set<number>();
      let city: ReturnType<typeof createCityMesh> | null = null;
      let cityAge = 0;
      const terrain = new T.Mesh(terrainGeometry, terrainMaterial);
      terrain.position.set(
        (5900 - BAY_ORIGIN[0]) * 10,
        0,
        (7600 - BAY_ORIGIN[1]) * 10,
      );
      terrain.receiveShadow = true;
      world.add(terrain);
      if (buildingsResult.status === 'fulfilled')
        world.add(createAirportBuildings(buildingsResult.value, elevation));

      // A detailed runway overlays the correct runway in the satellite image.
      const runway = new T.Group();
      runway.rotation.y = RUNWAY_HEADING;
      world.add(runway);
      const runwayRepeat = [62 / 3, 3690 / 3] as const;
      const pavement = new T.MeshStandardMaterial({
        color: pavementMaps[0] ? 0xb4b6b8 : 0x606366,
        map: pavementMaps[0],
        normalMap: pavementMaps[1],
        roughnessMap: pavementMaps[2],
        normalScale: new T.Vector2(0.35, 0.35),
        roughness: 0.95,
      });
      for (const texture of pavementMaps)
        texture?.repeat.set(runwayRepeat[0], runwayRepeat[1]);
      if (pavementMaps[0]) addPavementWear(pavement, runwayRepeat, 62);
      const white = new T.MeshStandardMaterial({
        color: 0xf1eddf,
        roughness: 0.85,
      });
      function surfaceMesh(
        w: number,
        length: number,
        x: number,
        z: number,
        y: number,
        material: Material,
      ) {
        const mesh = new T.Mesh(new T.PlaneGeometry(w, length), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, z);
        mesh.receiveShadow = true;
        runway.add(mesh);
        return mesh;
      }
      surfaceMesh(62, 3690, 0, -1675, 3, pavement);

      for (const side of [-1, 1])
        surfaceMesh(0.9, 3510, side * 28.5, -1675, 3.05, white);
      const stripeGeometry = new T.PlaneGeometry(0.9, 30);
      const stripes = new T.InstancedMesh(stripeGeometry, white, 55);
      const transform = new T.Object3D();
      transform.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 55; i++) {
        transform.position.set(0, 3.075, -60 - i * 61);
        transform.updateMatrix();
        stripes.setMatrixAt(i, transform.matrix);
      }
      runway.add(stripes);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++)
          surfaceMesh(1.8, 32, side * (4 + i * 3.8), 32, 3.08, white);
        surfaceMesh(6, 45, side * 17, -305, 3.08, white);
      }
      const lights = new T.InstancedMesh(
        new T.CylinderGeometry(0.16, 0.25, 0.7, 6),
        new T.MeshStandardMaterial({
          color: 0xf7eed3,
          emissive: 0xffeed0,
          emissiveIntensity: 0.8,
        }),
        120,
      );
      transform.rotation.set(0, 0, 0);
      for (let i = 0; i < 120; i++) {
        transform.position.set(
          i % 2 === 0 ? -31 : 31,
          3.5,
          75 - Math.floor(i / 2) * 60,
        );
        transform.updateMatrix();
        lights.setMatrixAt(i, transform.matrix);
      }
      runway.add(lights);

      const wingFlex = { value: 0 };
      const wingDepth = new T.MeshDepthMaterial({
        depthPacking: T.RGBADepthPacking,
        side: T.DoubleSide,
      });
      addWingFlex(wingDepth, wingFlex);
      materials.add(wingDepth);
      const skinNormal = ownTexture(
        createNoiseNormal(T, {
          size: 128,
          octaves: [
            [8, 1],
            [16, 0.5],
            [32, 0.25],
          ],
          slope: 3,
          seed: 7,
        }),
      );
      skinNormal.repeat.set(36, 36);
      const finishes = new Map<Material, Material>();
      model.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = wingDepth;
        const list = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        const upgraded = list.map((original) => {
          if (!(original instanceof T.MeshStandardMaterial)) return original;
          if (finishes.has(original)) return finishes.get(original)!;
          const finish = new T.MeshPhysicalMaterial();
          T.MeshStandardMaterial.prototype.copy.call(finish, original);
          finish.defines = { STANDARD: '', PHYSICAL: '' };
          const paint = !!original.map;
          const dark = original.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.18;
          finish.roughness = paint ? 0.34 : dark ? 0.42 : 0.3;
          finish.metalness = paint || dark ? 0 : 0.65;
          finish.clearcoat = paint ? 0.7 : 0.12;
          finish.clearcoatRoughness = paint ? 0.14 : 0.22;
          finish.envMapIntensity = 1.0;
          if (paint) {
            // Real skins have faint waviness between frames; it keeps the
            // clearcoat reflections from reading as a perfect mirror.
            finish.normalMap = skinNormal;
            finish.normalScale = new T.Vector2(0.12, 0.12);
          }
          if (finish.map)
            finish.map.anisotropy = Math.min(
              16,
              renderer.capabilities.getMaxAnisotropy(),
            );
          addWingFlex(finish, wingFlex);
          if (paint) addSkinDetail(finish);
          finishes.set(original, finish);
          return finish;
        });
        mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
        if (/Object_(5|7|9|11)_/.test(node.name)) {
          mesh.geometry = mesh.geometry.clone();
          mesh.geometry.computeBoundingBox();
          const center = mesh.geometry.boundingBox!.getCenter(new T.Vector3());
          mesh.geometry.translate(-center.x, -center.y, -center.z);
          mesh.position.copy(center);
          fans.push(mesh);
        }
      });
      orientedAirframe.add(model);
      // Retractable gear is added to the optimized airframe in its original axes.
      const tire = new T.MeshStandardMaterial({
        color: 0x15191e,
        roughness: 0.9,
      });
      const steel = new T.MeshStandardMaterial({
        color: 0xa8b0b7,
        metalness: 0.8,
        roughness: 0.26,
      });
      function gear(x: number, z: number, nose: boolean) {
        const group = new T.Group();
        group.position.set(x, -5.9, z);
        group.userData = { nose, side: Math.sign(z) };
        orientedAirframe.add(group);
        gearGroups.push(group);
        const strut = new T.Mesh(
          new T.CylinderGeometry(
            nose ? 0.14 : 0.22,
            nose ? 0.18 : 0.3,
            2.5,
            10,
          ),
          steel,
        );
        strut.position.y = -1.25;
        strut.castShadow = true;
        group.add(strut);
        const axle = new T.Mesh(
          new T.BoxGeometry(nose ? 0.45 : 3.1, 0.25, nose ? 1.0 : 1.75),
          steel,
        );
        axle.position.y = -2.65;
        axle.castShadow = true;
        group.add(axle);
        for (const offset of nose ? [0] : [-1.05, 0, 1.05])
          for (const side of [-1, 1]) {
            const radius = nose ? 0.52 : 0.68;
            const wheel = new T.Mesh(
              new T.TorusGeometry(radius * 0.76, radius * 0.24, 10, 28),
              tire,
            );

            wheel.position.set(offset, -2.75, side * (nose ? 0.43 : 0.8));
            wheel.castShadow = true;
            group.add(wheel);
            const hub = new T.Mesh(
              new T.CylinderGeometry(
                radius * 0.45,
                radius * 0.45,
                nose ? 0.315 : 0.475,
                12,
              ),
              steel,
            );
            hub.position.copy(wheel.position);
            hub.rotation.x = Math.PI / 2;
            group.add(hub);
          }
      }
      gear(-23, 0, true);
      gear(2.5, -4.9, false);
      gear(2.5, 4.9, false);

      // A clear sky makes the Bay and curved atmospheric horizon readable.
      const atmosphere = await atmosphereReady;
      const daylightTexture = await daylight;
      if (disposed) {
        daylightTexture?.dispose();
        return;
      }
      if (atmosphere) {
        // Sun colour and the sky environment now come from the same
        // scattering tables as the visible atmosphere, in one set of units.
        sky.visible = false;
        scene.fog = null;
        skylight.intensity = 0;
        renderer.toneMappingExposure = ATMOSPHERE_EXPOSURE;
        surface.lit.value = 1;
        terrainMaterial.color.set(0xffffff);
      } else if (daylightTexture) {
        const pmrem = new T.PMREMGenerator(renderer);
        environment = pmrem.fromEquirectangular(daylightTexture);
        scene.environment = environment.texture as Texture;
        scene.environmentIntensity = 0.95;
        daylightTexture.dispose();
        pmrem.dispose();
      }
      const cameraOffset = new T.Vector3();
      const target = new T.Vector3();
      const planePosition = new T.Vector3();
      function update(now: number, dt: number) {
        const reduced = latest.current.reducedMotion;
        const desired = reduced ? 1 : latest.current.progress.current;
        // Follow the scroll with a short lag, but never faster than the flight
        // can be watched: a flick through the page still flies for a few
        // seconds, so ground detail, runway lights and the sky refresh never
        // strobe past the camera.
        const eased = currentP + (desired - currentP) * (1 - Math.exp(-dt * 8));
        const step = Math.min(Math.abs(eased - currentP), dt * 0.22);
        currentP = reduced ? 1 : currentP + Math.sign(eased - currentP) * step;
        if (Math.abs(desired - currentP) < 0.000001) currentP = desired;
        surface.time.value = reduced ? 0 : now * 0.001;
        for (const index of fadingLayers) {
          const control = surface.layers[index];
          control.ready.value = Math.min(1, control.ready.value + dt / 1.2);
          if (control.ready.value >= 1) fadingLayers.delete(index);
        }
        if (city && city.rise.value < 1) {
          cityAge += dt;
          city.rise.value = reduced ? 1 : smooth(cityAge / 1.8);
        }
        const shot = sampleBayFlight(currentP);
        wingFlex.value = 2.1 * smooth((currentP - 0.35) / 0.24);
        // A floating origin keeps runway shadows stable as the flight travels kilometers.
        planePosition.set(
          shot.position[0],
          shot.position[1] + 12.33,
          shot.position[2],
        );
        world.position.copy(planePosition).multiplyScalar(-1);
        aircraft.rotation.set(shot.pitch, shot.heading, shot.bank, 'YXZ');
        const composition = sampleBayCamera(currentP, width / height);
        cameraOffset.set(...composition.position);
        camera.position.copy(cameraOffset);
        camera.fov = composition.fov;
        target.set(0, 0, 0);
        camera.lookAt(target);
        camera.setViewOffset(
          width,
          height,
          width * composition.offsetX,
          height * composition.offsetY,
          width,
          height,
        );
        sun.position.copy(sunlight).multiplyScalar(550);
        sun.target.position.set(0, 0, 0);
        // A 787's shadow softens into a faint blur by a couple of kilometres up.
        sun.shadow.intensity = 1 - smooth((shot.position[1] - 900) / 1400);
        for (const group of gearGroups) {
          const folded = 1 - shot.gear;
          group.rotation.x = group.userData.nose
            ? 0
            : group.userData.side * folded * 1.45;
          group.rotation.z = group.userData.nose ? -folded * 1.5 : 0;
          group.position.y = -5.9 + folded * 1.15;
          group.visible = shot.gear > 0.02;
        }
        for (const fan of fans)
          fan.rotation.x = reduced ? 0 : now * 0.006 + currentP * 200;
      }
      function draw(dt: number) {
        if (rendering) rendering.render(planePosition, dt);
        else renderer.render(scene, camera);
      }
      // Compile every program and draw one frame while the canvas is still
      // transparent, so the fade-in never shows a shader-compilation stall.
      update(performance.now(), 0);
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      draw(0);
      ready = true;
      latest.current.onStatus('ready');
      renderer.domElement.classList.add('is-ready');
      for (const [index, url] of lazyLayers)
        void textureLoader.loadAsync(url).then(
          (texture) => {
            if (disposed) {
              texture.dispose();
              return;
            }
            surface.layers[index].texture.value = imagery(ownTexture(texture));
            fadingLayers.add(index);
          },
          () => {},
        );
      // The city's massing arrives after the first frame and rises out of
      // the imagery over a second or two. Geometry is built in short slices
      // between frames so the flight never stalls.
      void loadCityBuildings(
        mobile
          ? '/scenery/bay-buildings-mobile.bin.gz'
          : '/scenery/bay-buildings.bin.gz',
        abort.signal,
      )
        .then(async (buildings) => {
          if (disposed) return;
          const geometry = await buildCityGeometry(
            buildings,
            { grid: elevation, size: gridSize },
            () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
          );
          if (disposed) {
            geometry.dispose();
            return;
          }
          geometries.add(geometry);
          city = createCityMesh(geometry, layers, surface);
          materials.add(city.material);
          world.add(city.mesh);
        })
        .catch(() => {});
      function animate(now: number) {
        if (disposed) return;
        frame = requestAnimationFrame(animate);
        const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
        lastTime = now;
        const isVisible = visible && !document.hidden;
        const reduced = latest.current.reducedMotion;
        update(now, dt);
        latest.current.audio.current?.update(currentP, isVisible && ready);
        if (!isVisible || (reduced && previousP === currentP)) return;
        previousP = currentP;
        draw(dt);
      }
      frame = requestAnimationFrame(animate);
    }
    void setup().catch(() => {
      if (!disposed) latest.current.onStatus('unavailable');
      cleanup?.();
    });
    return () => {
      if (cleanup) cleanup();
      else {
        disposed = true;
        abort.abort();
      }
    };
  }, []);
  return (
    <div className="bay-canvas" ref={host} aria-hidden="true">
      <div className="bay-poster" />
    </div>
  );
}
