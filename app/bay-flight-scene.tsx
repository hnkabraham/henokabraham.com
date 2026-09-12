'use client';
import { sceneAsset } from '@/lib/scene-assets';
import { recordFlightMetric } from '@/lib/flight-metrics';
import {
  createFlightPerformance,
  createScrollPerformance,
  flightPixelRatio,
  followFlightProgress,
} from '@/lib/bay-performance';

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
import { addCloudShade, addSkinDetail, addWingFlex } from '@/lib/airframe-flex';
import {
  buildCityGeometry,
  createCityMesh,
  loadCityBuildings,
} from '@/lib/bay-city';
import { createGoldenGateBridge } from '@/lib/bay-bridge';
import { createChaseCar } from '@/lib/bay-chase-car';
import {
  AIRBORNE_PROGRESS,
  EGG_MESSAGES,
  watchEasterEggs,
  type EasterEgg,
} from '@/lib/bay-easter-eggs';
import { createGateFog } from '@/lib/bay-fog';
import { addLivery, createLiveryTexture } from '@/lib/bay-livery';
import { createAirfield, type Airfield } from '@/lib/sfo-airfield';
import { createTraffic, type RoadNetwork } from '@/lib/bay-traffic';
import { createTileStreamer, type TileManifest } from '@/lib/bay-tiles';
import {
  HeatHazeEffect,
  createWingtipVortices,
  thrustSetting,
  vortexSetting,
} from '@/lib/bay-thrust';
import { createTreeMesh, loadTreeCanopies } from '@/lib/bay-trees';
import {
  MARIN_BOUNDS,
  MERCATOR_ORIGIN,
  NORTH_BOUNDS,
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
  reveal: RefObject<number>;
  reducedMotion: boolean;
  audio: RefObject<ReturnType<typeof createBayAudio> | null>;
  onStatus: (value: 'loading' | 'ready' | 'unavailable') => void;
};

/** Quarter-metre elevations, stored as the high and low bytes of a lossless WebP. */
async function loadElevation(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Terrain unavailable');
  // Read as an ArrayBuffer: Chromium fails Response.blob() on slow or
  // preload-matched bodies with a bare "Failed to fetch".
  const bitmap = await createImageBitmap(
    new Blob([await response.arrayBuffer()]),
    { premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
  );
  const size = bitmap.width;
  if (size !== bitmap.height || size < 2)
    throw new Error('Invalid terrain grid');
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
  options: {
    size: number;
    octaves: [number, number][];
    slope: number;
    seed: number;
  },
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

/** Tileable value noise for cloud cover, kept on the CPU for the aircraft. */
function createCloudField(T: typeof import('three'), size = 256, seed = 11) {
  const field = new Float32Array(size * size);
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  let peak = 0;
  for (const [cells, amplitude] of [
    [4, 1],
    [8, 0.5],
    [16, 0.25],
    [32, 0.125],
  ]) {
    const lattice = Float32Array.from({ length: cells * cells }, random);
    const at = (x: number, y: number) =>
      lattice[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells,
          gy = (y / size) * cells;
        const x0 = Math.floor(gx),
          y0 = Math.floor(gy);
        const tx = fade(gx - x0),
          ty = fade(gy - y0);
        const value =
          (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
          (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
        field[y * size + x] += value * amplitude;
      }
    peak += amplitude;
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < field.length; i++) {
    field[i] /= peak;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = field[i] * 255;
    data[i * 4 + 3] = 255;
  }
  const texture = new T.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const sample = (u: number, v: number) => {
    const fx = (((u % 1) + 1) % 1) * size,
      fy = (((v % 1) + 1) % 1) * size;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const at = (x: number, y: number) => field[(y % size) * size + (x % size)];
    return (
      (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
      (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
    );
  };
  return { texture, sample };
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
      const performanceControl = createFlightPerformance();
      const scrollPerformance = createScrollPerformance();
      const renderer = new T.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(1);
      renderer.toneMapping = T.AgXToneMapping;
      renderer.toneMappingExposure = 0.94;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
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
      sun.shadow.mapSize.set(1024, 1024);
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
      const instances = new Set<InstanceType<typeof T.InstancedMesh>>();
      let tiles: ReturnType<typeof createTileStreamer> | null = null;
      let lazyTimer: ReturnType<typeof setTimeout> | undefined = undefined;
      let renderDirty = true;
      // Decoded lazy textures wait here for their one-per-frame upload.
      const pendingUploads: {
        texture: Texture;
        bitmap: ImageBitmap;
        assign: (texture: Texture) => void;
      }[] = [];
      let environment: InstanceType<typeof T.WebGLRenderTarget> | undefined;
      const eggs: { stop?: () => void } = {};
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
          if (node instanceof T.InstancedMesh) instances.add(node);
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
          tiles?.setActive(visible && !document.hidden);
          renderDirty = true;
          if (!visible) latest.current.audio.current?.update(currentP, false);
        },
        { threshold: 0 },
      );
      observer.observe(container);
      const visibilityChange = () => {
        tiles?.setActive(visible && !document.hidden);
        renderDirty = true;
        latest.current.audio.current?.update(
          currentP,
          visible && !document.hidden && ready,
        );
      };
      document.addEventListener('visibilitychange', visibilityChange);
      const resize = () => {
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        // Bound HDR buffers on Retina/4K screens without changing composition.
        renderer.setPixelRatio(
          flightPixelRatio(
            width,
            height,
            devicePixelRatio,
            mobile,
            performanceControl.quality,
          ),
        );
        renderer.setSize(width, height);
        rendering?.resize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderDirty = true;
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
        clearTimeout(lazyTimer);
        cancelAnimationFrame(frame);
        eggs.stop?.();
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
        instances.forEach((mesh) => mesh.dispose());
        geometries.forEach((g) => g.dispose());
        materials.forEach((m) => m.dispose());
        textures.forEach((t) => t.dispose());
        pendingUploads.splice(0).forEach(({ bitmap }) => bitmap.close());
        environment?.dispose();
        sun.shadow.dispose();
        tiles?.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };

      const heatHaze = new HeatHazeEffect();
      rendering = createBayRendering(
        renderer,
        scene,
        camera,
        sun,
        sunlight,
        mobile,
        [heatHaze],
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
          : new HDRLoader().loadAsync(sceneAsset('/scenery/daylight.hdr')),
      );

      // Actual terrain, registered to the satellite texture, in meter-scale space.
      // A 94 m elevation mesh is sufficient beneath the high-resolution imagery.
      const segments = 512;
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
        new GLTFLoader().loadAsync(sceneAsset('/models/boeing-787-9.glb')),
        // The corridors carry the detail; the wide satellite image only
        // shows in the far distance, so one 2048² version serves every device.
        textureLoader.loadAsync(sceneAsset('/scenery/sf-bay-mobile.webp')),
        loadElevation(sceneAsset('/scenery/bay-elevation.webp'), abort.signal),
        // The airport and the climb-out stream as tiles along the scroll path.
        fetch(sceneAsset('/tiles/manifest.json'), {
          signal: abort.signal,
        }).then((r) => {
          if (!r.ok) throw new Error('Tile manifest unavailable');
          return r.json() as Promise<TileManifest>;
        }),
        textureLoader.loadAsync(sceneAsset('/scenery/runway-color.webp')),
        textureLoader.loadAsync(sceneAsset('/scenery/runway-normal.webp')),
        textureLoader.loadAsync(sceneAsset('/scenery/runway-roughness.webp')),
        fetch(sceneAsset('/scenery/sfo-buildings.json'), {
          signal: abort.signal,
        }).then((r) => {
          if (!r.ok) throw new Error('Buildings unavailable');
          return r.json() as Promise<AirportBuildings>;
        }),
        fetch(sceneAsset('/scenery/sfo-airfield.json'), {
          signal: abort.signal,
        }).then((r) => {
          if (!r.ok) throw new Error('Airfield unavailable');
          return r.json() as Promise<Airfield>;
        }),
      ]);
      const [
        modelResult,
        mapResult,
        elevationResult,
        tilesResult,
        asphaltResult,
        normalResult,
        roughnessResult,
        buildingsResult,
        airfieldResult,
      ] = resources;
      for (const result of [asphaltResult, normalResult, roughnessResult])
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
          // The fallback hides the cause; name it for whoever is debugging.
          for (const [name, result] of [
            ['model', modelResult],
            ['base map', mapResult],
            ['elevation', elevationResult],
          ] as const)
            if (result.status === 'rejected')
              console.warn(`Bay opening asset failed: ${name}`, result.reason);
          latest.current.onStatus('unavailable');
          cleanup?.();
        } else {
          instances.forEach((mesh) => mesh.dispose());
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
      tiles =
        tilesResult.status === 'fulfilled'
          ? createTileStreamer(renderer, tilesResult.value, {
              minLevel: mobile ? 1 : 0,
              atlasTiles: mobile ? 15 : 24,
              uploadBudget: mobile ? 2 : 4,
            })
          : null;
      tiles?.setActive(visible && !document.hidden);
      // Coarse to fine. The three corridor layers, the desktop base map and
      // every baked shadow map arrive after the first frame.
      const layers: SurfaceLayer[] = [
        { bounds: SOUTH_BOUNDS, texture: null, feather: 0.05, shade: null },
        { bounds: NORTH_BOUNDS, texture: null, feather: 0.05, shade: null },
        // The north bay above the corridor's edge. No baked shade: it would
        // want the seventeenth texture unit, one past the WebGL2 minimum.
        { bounds: MARIN_BOUNDS, texture: null, feather: 0.05 },
        // The airport's baked shade keeps its box; the imagery under it and
        // the runway now stream as tiles scheduled along the scroll path.
        { bounds: SFO_BOUNDS, shade: null },
        ...(tiles ? [tiles.layer] : []),
      ];
      // The tile layer is conditional, so read slots back rather than count.
      const slotFor = (bounds: SurfaceLayer['bounds']) =>
        layers.findIndex((layer) => layer.bounds === bounds);
      const variant = mobile ? '-mobile' : '';
      const lazyLayers: [number, string][] = [
        [
          slotFor(SOUTH_BOUNDS),
          sceneAsset(`/scenery/naip-south${variant}.webp`),
        ],
        [
          slotFor(NORTH_BOUNDS),
          sceneAsset(`/scenery/naip-north${variant}.webp`),
        ],
        [
          slotFor(MARIN_BOUNDS),
          sceneAsset(`/scenery/naip-marin${variant}.webp`),
        ],
      ];
      const lazyShades: [number, string][] = [
        [
          slotFor(SOUTH_BOUNDS),
          sceneAsset(`/scenery/shade-south${variant}.webp`),
        ],
        [
          slotFor(NORTH_BOUNDS),
          sceneAsset(`/scenery/shade-north${variant}.webp`),
        ],
        [slotFor(SFO_BOUNDS), sceneAsset(`/scenery/shade-sfo${variant}.webp`)],
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
        layers,
        pavementMaps[0] && pavementMaps[1]
          ? {
              map: pavementMaps[0],
              normalMap: pavementMaps[1],
              waterNormalMap: waterNormal,
            }
          : null,
      );
      const fadingLayers = new Set<number>();
      const fadingShades = new Set<number>();
      let city: ReturnType<typeof createCityMesh> | null = null;
      let traffic: ReturnType<typeof createTraffic> | null = null;
      let cityAge = 0;
      let trees: Awaited<ReturnType<typeof createTreeMesh>> | null = null;
      let treeAge = 0;
      let bridge: ReturnType<typeof createGoldenGateBridge> | null = null;
      // Easter eggs: a wing wave or aileron roll layered over the flight
      // path, a chase car on the runway and a fog bank through the Gate.
      let stunt: { kind: 'wave' | 'roll'; start: number } | null = null;
      let chaseCar: ReturnType<typeof createChaseCar> | null = null;
      let gateFog: ReturnType<typeof createGateFog> | null = null;
      const remembered = (key: string) => {
        try {
          return localStorage.getItem(key) === '1';
        } catch {
          return false;
        }
      };
      const remember = (key: string, on: boolean) => {
        try {
          localStorage.setItem(key, on ? '1' : '0');
        } catch {
          // Private browsing only forgets the setting.
        }
      };
      let chaseOn = remembered('bay-egg-chase');
      let fogOn = remembered('bay-egg-fog');
      const clouds = createCloudField(T);
      ownTexture(clouds.texture);
      surface.cloud.value = clouds.texture;
      // Development probes can park the camera anywhere in local metres.
      const debugView: {
        position?: [number, number, number];
        target?: [number, number, number];
        fov?: number;
      } = {};
      if (process.env.NODE_ENV !== 'production')
        Object.assign(
          (window as unknown as { __bayDebug: Record<string, unknown> })
            .__bayDebug,
          {
            surface,
            clouds,
            camera,
            world,
            debugView,
            aircraft,
            heatHaze,
            tiles,
          },
        );
      const shadeTexture = (texture: Texture) => {
        texture.colorSpace = T.NoColorSpace;
        texture.anisotropy = 4;
        return texture;
      };
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
      // Approach light piers, field lighting, signs, markings and the parked
      // fleet, placed from OpenStreetMap's airfield layout.
      let airfield: ReturnType<typeof createAirfield> | null = null;
      if (airfieldResult.status === 'fulfilled') {
        airfield = createAirfield(airfieldResult.value, {
          grid: elevation,
          size: gridSize,
        });
        airfield.geometries.forEach((geometry) => geometries.add(geometry));
        airfield.materials.forEach((material) => materials.add(material));
        airfield.textures.forEach(ownTexture);
        world.add(airfield.group);
      }

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
      // Edge lights are knee-high fixtures 3 m outside the pavement, 61 m apart.
      const lights = new T.InstancedMesh(
        new T.CylinderGeometry(0.11, 0.15, 0.36, 6),
        new T.MeshStandardMaterial({
          color: 0xf7eed3,
          emissive: 0xffeed0,
          emissiveIntensity: 1.2,
        }),
        120,
      );
      transform.rotation.set(0, 0, 0);
      for (let i = 0; i < 120; i++) {
        transform.position.set(
          i % 2 === 0 ? -34 : 34,
          3.18,
          75 - Math.floor(i / 2) * 61,
        );
        transform.updateMatrix();
        lights.setMatrixAt(i, transform.matrix);
      }
      runway.add(lights);

      const wingFlex = { value: 0 };

      // Cloud cover over the aircraft, sampled on the CPU from the same noise.

      const aircraftCloudFactor = { value: 1 };
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
      const livery = createLiveryTexture();
      if (livery) ownTexture(livery);
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
            finish.normalScale = new T.Vector2(0.06, 0.06);
          }
          if (finish.map)
            finish.map.anisotropy = Math.min(
              16,
              renderer.capabilities.getMaxAnisotropy(),
            );
          addWingFlex(finish, wingFlex);
          if (paint) addSkinDetail(finish);
          if (paint && livery) addLivery(finish, livery);
          addCloudShade(finish, aircraftCloudFactor);
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
      const vortices = createWingtipVortices();
      geometries.add(vortices.geometry);
      materials.add(vortices.material);
      orientedAirframe.add(vortices.mesh);
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
      let lastTrafficUpdate = 0;
      function update(now: number, dt: number) {
        const reduced = latest.current.reducedMotion;
        const desired = reduced ? 1 : latest.current.progress.current;
        currentP = reduced ? 1 : followFlightProgress(currentP, desired, dt);
        surface.time.value = reduced ? 0 : now * 0.001;
        for (const index of fadingLayers) {
          const control = surface.layers[index];
          control.ready.value = reduced
            ? 1
            : Math.min(1, control.ready.value + dt / 1.2);
          if (control.ready.value >= 1) fadingLayers.delete(index);
        }
        for (const index of fadingShades) {
          const control = surface.layers[index];
          control.shadeReady.value = reduced
            ? 1
            : Math.min(1, control.shadeReady.value + dt / 1.5);
          if (control.shadeReady.value >= 1) fadingShades.delete(index);
        }
        if (city && city.rise.value < 1) {
          cityAge += dt;
          city.rise.value = reduced ? 1 : smooth(cityAge / 1.8);
        }
        if (trees && trees.grow.value < 1) {
          treeAge += dt;
          trees.grow.value = reduced ? 1 : smooth(treeAge / 1.5);
        }
        const shot = sampleBayFlight(currentP);
        wingFlex.value = 2.1 * smooth((currentP - 0.35) / 0.24);
        let stuntRoll = 0,
          stuntPitch = 0;
        if (stunt && !reduced) {
          const length = stunt.kind === 'roll' ? 3.6 : 2.6;
          const t = (now - stunt.start) / 1000 / length;
          if (t >= 1) stunt = null;
          else if (stunt.kind === 'roll') {
            // A full aileron roll that starts and stops smoothly, with a
            // little pitch-up on entry and the wings loading through it.
            stuntRoll =
              2 * Math.PI * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
            stuntPitch = 0.07 * Math.sin(Math.PI * t);
            wingFlex.value += 0.9 * Math.sin(Math.PI * t);
          } else {
            const envelope = Math.sin(Math.PI * t);
            stuntRoll = 0.24 * envelope * Math.sin(4 * Math.PI * t);
            wingFlex.value += 0.5 * envelope;
          }
        }
        // A floating origin keeps runway shadows stable as the flight travels kilometers.
        planePosition.set(
          shot.position[0],
          shot.position[1] + 12.33,
          shot.position[2],
        );
        world.position.copy(planePosition).multiplyScalar(-1);
        aircraft.rotation.set(
          shot.pitch + stuntPitch,
          shot.heading,
          shot.bank + stuntRoll,
          'YXZ',
        );
        if (chaseCar) {
          // Drag-racing the Dreamliner down 28R from the runway shoulder:
          // ahead off the line, then steadily dropped as the jet accelerates.
          const forward = [
            -Math.sin(RUNWAY_HEADING),
            -Math.cos(RUNWAY_HEADING),
          ];
          const along =
            shot.position[0] * forward[0] + shot.position[2] * forward[1];
          const carAlong =
            32 + along * (1 - 0.25 * smooth((along - 300) / 2400));
          chaseCar.group.visible = chaseOn && currentP < 0.46;
          chaseCar.group.position.set(
            forward[0] * carAlong + forward[1] * 46,
            3.02,
            forward[1] * carAlong - forward[0] * 46,
          );
          chaseCar.group.rotation.y = RUNWAY_HEADING;
          for (const wheel of chaseCar.wheels)
            wheel.rotation.x = -carAlong / 0.34;
        }
        airfield?.update(now);
        if (gateFog) {
          const target = fogOn ? 1 : 0;
          const value = gateFog.opacity.value;
          gateFog.opacity.value = reduced
            ? target
            : value +
              Math.sign(target - value) *
                Math.min(Math.abs(target - value), dt / 2.5);
          gateFog.time.value = surface.time.value;
          gateFog.group.visible = gateFog.opacity.value > 0.001;
        }
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
        if (debugView.position && debugView.target) {
          camera.position.set(...debugView.position).sub(planePosition);
          camera.fov = debugView.fov ?? 39;
          camera.lookAt(target.set(...debugView.target).sub(planePosition));
          camera.clearViewOffset();
        }
        sun.position.copy(sunlight).multiplyScalar(550);
        sun.target.position.set(0, 0, 0);
        // A 787's shadow softens into a faint blur by a couple of kilometres up.
        sun.shadow.intensity = 1 - smooth((shot.position[1] - 900) / 1400);
        {
          // Same drifting cloud field as the shaders, at the aircraft's position.
          const [mx, my] = mercator(
            planePosition.x / 10 + BAY_ORIGIN[0],
            planePosition.z / 10 + BAY_ORIGIN[1],
          );
          const time = surface.time.value;
          const noise = clouds.sample(
            (mx - MERCATOR_ORIGIN[0]) * 0.00028 + time * 0.0018,
            (my - MERCATOR_ORIGIN[1]) * 0.00028 + time * 0.0011,
          );
          const cover = smooth((noise - 0.56) / 0.26);
          aircraftCloudFactor.value = 1 - 0.45 * cover;
        }
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
        // Visible thrust: exhaust haze at the engines' power setting, and
        // vapour off the tips while the wing is loaded (or through a stunt).
        heatHaze.place(
          orientedAirframe,
          camera,
          reduced ? 0 : thrustSetting(currentP),
          now * 0.001,
        );
        vortices.update(
          reduced ? 0 : Math.max(vortexSetting(currentP), stunt ? 1 : 0),
          now * 0.001,
        );
        // Distant cars do not need thousands of matrix writes at display refresh rate.
        if (traffic && !reduced && now - lastTrafficUpdate >= 1000 / 30) {
          traffic.update(now);
          lastTrafficUpdate = now;
        }
      }
      function draw(dt: number) {
        if (rendering) rendering.render(planePosition, dt);
        else renderer.render(scene, camera);
      }
      // Compile every program and draw one frame while the canvas is still
      // transparent, so the fade-in never shows a shader-compilation stall.
      if (visible && !document.hidden) update(performance.now(), 0);
      // Priming uses the same bounded frame uploads, including before the
      // first draw. Cleanup owns this RAF even if unmount happens mid-prime.
      const opening = tiles?.prime(currentP, 12000);
      const primeFrame = (now: number) => {
        if (disposed) return;
        if (visible && !document.hidden) {
          tiles?.update(currentP, now);
          tiles?.flush(now);
        }
        frame = requestAnimationFrame(primeFrame);
      };
      frame = requestAnimationFrame(primeFrame);
      await opening;
      cancelAnimationFrame(frame);
      if (disposed) return;
      await renderer.compileAsync(scene, camera);
      if (disposed) return;
      if (visible && !document.hidden) {
        update(performance.now(), 0);
        draw(0);
      }
      ready = true;
      latest.current.onStatus('ready');
      renderer.domElement.classList.add('is-ready');
      const announce = (egg: EasterEgg | 'grounded', on = true) =>
        window.dispatchEvent(
          new CustomEvent('bay-easter-egg', {
            detail: { egg, message: EGG_MESSAGES[egg](on) },
          }),
        );
      const enableChase = () => {
        if (chaseCar) return;
        const built = createChaseCar();
        built.geometries.forEach((geometry) => geometries.add(geometry));
        built.materials.forEach((material) => materials.add(material));
        chaseCar = built;
        void renderer.compileAsync(built.group, camera, scene).then(() => {
          if (!disposed) {
            world.add(built.group);
            renderDirty = true;
          }
        });
      };
      const enableFog = () => {
        if (gateFog || !bridge) return;
        const built = createGateFog(bridge.frame);
        geometries.add(built.geometry);
        built.materials.forEach((material) => materials.add(material));
        gateFog = built;
        void renderer.compileAsync(built.group, camera, scene).then(() => {
          if (!disposed) {
            world.add(built.group);
            renderDirty = true;
          }
        });
      };
      if (chaseOn) enableChase();
      const aircraftSphere = new T.Sphere(new T.Vector3(0, -3, 0), 36);
      const raycaster = new T.Raycaster();
      const pointer = new T.Vector2();
      const stopEggs = watchEasterEggs(
        renderer.domElement,
        (x, y) => {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.set(
            ((x - rect.left) / rect.width) * 2 - 1,
            -((y - rect.top) / rect.height) * 2 + 1,
          );
          raycaster.setFromCamera(pointer, camera);
          return raycaster.ray.intersectsSphere(aircraftSphere);
        },
        (egg) => {
          if (egg === 'wave' || egg === 'roll') {
            if (latest.current.reducedMotion) return;
            if (stunt?.kind === 'roll') return;
            if (currentP < AIRBORNE_PROGRESS) {
              announce('grounded');
              return;
            }
            stunt = { kind: egg, start: performance.now() };
            announce(egg);
          } else if (egg === 'chase') {
            chaseOn = !chaseOn;
            remember('bay-egg-chase', chaseOn);
            if (chaseOn) enableChase();
            renderDirty = true;
            announce(egg, chaseOn);
          } else {
            fogOn = !fogOn;
            remember('bay-egg-fog', fogOn);
            if (fogOn) enableFog();
            renderDirty = true;
            announce(egg, fogOn);
          }
        },
      );
      eggs.stop = stopEggs;
      if (process.env.NODE_ENV !== 'production')
        Object.assign(
          (window as unknown as { __bayDebug: Record<string, unknown> })
            .__bayDebug,
          { egg: (name: EasterEgg) => announce(name) },
        );
      console.log(
        '%c✈ N787HA %cflight deck extras: click the aircraft to wave, ↑↑↓↓←→←→BA (or type roll) for an aileron roll, type gt350 for a chase car, karl for the fog.',
        'font-weight:700;color:#db4f24',
        'color:#47677a',
      );
      // The compact city keeps the skyline and large footprints; imagery
      // supplies the smaller rooftops. Never enable 4.1M building triangles
      // based on an opening measured before those buildings existed.
      let lazyStarted = false;
      const measuredFrames: number[] = [];
      let priorMeasuredFrame = 0;
      const yieldNow = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 0));
      // Lazy layers decode off the main thread and upload one per visible
      // frame, so imagery and city arriving together cannot stall a scroll.
      const loadLazyTexture = (
        url: string,
        prepare: (texture: Texture) => Texture,
        assign: (texture: Texture) => void,
      ) =>
        void fetch(url, { signal: abort.signal })
          .then((response) => {
            if (!response.ok) throw new Error('Texture unavailable');
            return response.arrayBuffer();
          })
          .then((buffer) =>
            createImageBitmap(new Blob([buffer]), {
              // Match TextureLoader's north-up UVs. ImageBitmap ignores
              // Texture.flipY, so imagery and baked shade must flip here.
              imageOrientation: 'flipY',
              premultiplyAlpha: 'none',
              colorSpaceConversion: 'none',
            }),
          )
          .then(
            (bitmap) => {
              if (disposed) {
                bitmap.close();
                return;
              }
              const texture = prepare(ownTexture(new T.Texture(bitmap)));
              texture.needsUpdate = true;
              pendingUploads.push({ texture, bitmap, assign });
              renderDirty = true;
            },
            () => {
              if (!disposed) recordFlightMetric('scene_asset_failure', 1);
            },
          );
      function uploadPendingTexture() {
        const next = pendingUploads.shift();
        if (!next) return false;
        renderer.initTexture(next.texture);
        next.bitmap.close();
        next.assign(next.texture);
        return true;
      }
      function startLazyLoads() {
        if (lazyStarted || disposed) return;
        lazyStarted = true;
        for (const [index, url] of lazyLayers)
          loadLazyTexture(url, imagery, (texture) => {
            surface.layers[index].texture.value = texture;
            fadingLayers.add(index);
          });
        // The 4096² base map: 11.7 m/px under everything the corridors and
        // tiles miss, which from progress 0.9 is most of the frame.
        if (!mobile)
          loadLazyTexture(
            sceneAsset('/scenery/sf-bay.webp'),
            imagery,
            (texture) => {
              const previous = terrainMaterial.map;
              terrainMaterial.map = texture;
              previous?.dispose();
              renderDirty = true;
            },
          );
        // Freeway traffic under the climb-out, from OpenStreetMap carriageways.
        void fetch(sceneAsset('/scenery/bay-roads.json'), {
          signal: abort.signal,
        })
          .then((response) => {
            if (!response.ok) throw new Error('Roads unavailable');
            return response.json() as Promise<RoadNetwork>;
          })
          .then((roads) => {
            if (disposed) return;
            const built = createTraffic(
              roads,
              { grid: elevation, size: gridSize },
              { density: mobile ? 0.45 : 0.65 },
            );
            geometries.add(built.geometry);
            materials.add(built.material);
            world.add(built.mesh);
            renderDirty = true;
            traffic = built;
          })
          .catch(() => {
            // The climb-out simply stays without traffic.
          });
        for (const [index, url] of lazyShades)
          loadLazyTexture(url, shadeTexture, (texture) => {
            surface.layers[index].shade.value = texture;
            fadingShades.add(index);
          });
        const detail = '-mobile';
        void loadCityBuildings(
          sceneAsset(`/scenery/bay-buildings${detail}.bin.gz`),
          abort.signal,
        )
          .then(async (buildings) => {
            if (disposed) return;
            const geometry = await buildCityGeometry(
              buildings,
              { grid: elevation, size: gridSize },
              yieldNow,
            );
            if (disposed) {
              geometry.dispose();
              return;
            }
            geometries.add(geometry);
            city = createCityMesh(geometry, layers, surface);
            materials.add(city.material);
            world.add(city.mesh);
            renderDirty = true;
          })
          .catch(() => {
            if (!disposed) recordFlightMetric('scene_asset_failure', 1);
          });
        // The Golden Gate is procedural: no download, one compile.
        try {
          const built = createGoldenGateBridge(
            { grid: elevation, size: gridSize },
            layers,
            surface,
          );
          built.geometries.forEach((geometry) => geometries.add(geometry));
          built.materials.forEach((material) => materials.add(material));
          if (built.texture) ownTexture(built.texture);
          void renderer.compileAsync(built.group, camera, scene).then(() => {
            if (disposed) return;
            renderDirty = true;
            bridge = built;
            world.add(built.group);
            if (fogOn) enableFog();
          });
        } catch {
          // A malformed elevation grid only costs the bridge.
        }
        void loadTreeCanopies(
          sceneAsset(`/scenery/bay-trees${detail}.bin.gz`),
          abort.signal,
        )
          .then(async (canopies) => {
            if (disposed) return;
            const built = await createTreeMesh(
              canopies,
              { grid: elevation, size: gridSize },
              layers,
              surface,
              yieldNow,
            );
            if (disposed) {
              built.mesh.dispose();
              built.geometry.dispose();
              built.material.dispose();
              return;
            }
            geometries.add(built.geometry);
            materials.add(built.material);
            trees = built;
            world.add(built.mesh);
            renderDirty = true;
          })
          .catch(() => {
            if (!disposed) recordFlightMetric('scene_asset_failure', 1);
          });
      }
      // A tab hidden through the measurement window starts its lazy loads
      // once visible again.
      let lazyDue = false;
      lazyTimer = setTimeout(() => {
        lazyDue = true;
        renderDirty = true;
      }, 500);
      function animate(now: number) {
        if (disposed) return;
        frame = requestAnimationFrame(animate);
        const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
        lastTime = now;
        const isVisible = visible && !document.hidden;
        const reduced = latest.current.reducedMotion;
        const revealed = latest.current.reveal.current > 0;
        if (!isVisible || reduced || !revealed) {
          priorMeasuredFrame = 0;
          performanceControl.reset();
          scrollPerformance.reset();
        }
        if (!isVisible || !revealed) {
          if (!revealed) latest.current.audio.current?.update(currentP, false);
          return;
        }
        if (lazyDue && !lazyStarted) startLazyLoads();
        if (ready && !reduced) {
          const sample = performanceControl.sample(now);
          if (sample?.changed) {
            rendering?.setQuality(sample.quality);
            const shadowSize = sample.quality === 0 ? 512 : 1024;
            if (sun.shadow.mapSize.x !== shadowSize) {
              sun.shadow.map?.dispose();
              sun.shadow.map = null;
              sun.shadow.mapSize.set(shadowSize, shadowSize);
            }
            resize();
          }
          if (sample && container && process.env.NODE_ENV !== 'production') {
            container.dataset.flightPerformance = JSON.stringify({
              ...sample,
              progress: currentP,
              pixelRatio: renderer.getPixelRatio(),
              width: renderer.domElement.width,
              height: renderer.domElement.height,
            });
          }
          const scrollSample = scrollPerformance.sample(
            now,
            currentP,
            Math.abs(latest.current.progress.current - currentP) > 0.0001,
          );
          if (scrollSample) {
            recordFlightMetric('scene_scroll_fps', scrollSample.fps);
            recordFlightMetric('scene_scroll_p95_ms', scrollSample.p95);
            recordFlightMetric('scene_scroll_jank_pct', scrollSample.jank);
          }
        }
        tiles?.update(currentP, now);
        if (tiles?.flush(now)) renderDirty = true;
        if (uploadPendingTexture()) renderDirty = true;
        if (reduced && previousP === currentP && !renderDirty) return;
        update(now, dt);
        latest.current.audio.current?.update(currentP, ready);
        previousP = currentP;
        renderDirty = false;
        draw(dt);
        if (ready && !reduced && measuredFrames.length < 180) {
          if (priorMeasuredFrame && now > priorMeasuredFrame)
            measuredFrames.push(now - priorMeasuredFrame);
          priorMeasuredFrame = now;
          if (measuredFrames.length === 180)
            recordFlightMetric(
              'scene_fps',
              (1000 * measuredFrames.length) /
                measuredFrames.reduce((a, b) => a + b, 0),
            );
        }
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
  return <div className="bay-canvas" ref={host} aria-hidden="true" />;
}
