import { sceneAsset } from '@/lib/scene-assets';
import {
  AerialPerspectiveEffect,
  PrecomputedTexturesGenerator,
  SkyMaterial,
  getSunLightColor,
  type PrecomputedTextures,
} from '@takram/three-atmosphere';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import {
  Color,
  CubeCamera,
  Data3DTexture,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  NoToneMapping,
  PlaneGeometry,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  Vector3,
  WebGLCubeRenderTarget,
  type DirectionalLight,
  type PerspectiveCamera,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { BAY_TO_ECEF, updateAtmosphereOrigin } from './bay-atmosphere';

/**
 * AgX exposure once the scene is lit in the atmosphere's relative-luminance
 * units: a sunlit white surface sits near 1.0 before the AgX shoulder, the
 * zenith stays a deep blue and the horizon brightens physically.
 */
export const ATMOSPHERE_EXPOSURE = 2.1;

/** Sky lighting changes slowly over distance and never needs a stationary refresh. */
export const skyEnvironmentMoved = (position: Vector3, previous: Vector3) =>
  position.distanceToSquared(previous) >= 150 * 150;

/**
 * A renderer that cannot render to half-float targets reads back zeros, or
 * NaN/Inf where the fallback formats overflow; such tables must not be used.
 */
function validTables(tables: PrecomputedTextures) {
  return [tables.transmittanceTexture, tables.irradianceTexture].every(
    (texture) => {
      const data = texture.userData.imageData;
      if (!(data instanceof Uint16Array) || data.length === 0) return false;
      let nonzero = false;
      for (let i = 0; i < data.length; i++) {
        if ((data[i] & 0x7c00) === 0x7c00) return false;
        if (data[i] !== 0) nonzero = true;
      }
      return nonzero;
    },
  );
}

/**
 * The shipped EXR tables, fetched at low priority so they never delay the
 * opening's other assets, and abortable once the GPU has produced its own.
 */
async function fetchTables(
  base: string,
  signal: AbortSignal,
  progress: (received: number, total: number) => void,
) {
  const parse = async (name: string) => {
    const response = await fetch(`${base}/${name}.exr`, {
      signal,
      priority: 'low',
    });
    if (!response.ok || !response.body)
      throw new Error(`${name} table unavailable`);
    // The scattering table is 99% of the bytes; its arrival rate decides
    // whether the GPU should start computing instead.
    if (name !== 'scattering')
      return new EXRLoader().parse(await response.arrayBuffer());
    const total = Number(response.headers.get('content-length')) || 4094331;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      progress(received, total);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new EXRLoader().parse(bytes.buffer);
  };
  const [transmittance, scattering, irradiance] = await Promise.all([
    parse('transmittance'),
    parse('scattering'),
    parse('irradiance'),
  ]);
  const table = <T extends DataTexture | Data3DTexture>(
    texture: T,
    exr: ReturnType<EXRLoader['parse']>,
  ) => {
    texture.type = exr.type ?? HalfFloatType;
    texture.format = exr.format ?? RGBAFormat;
    texture.colorSpace = exr.colorSpace ?? NoColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    return texture;
  };
  const tables: PrecomputedTextures = {
    transmittanceTexture: table(
      new DataTexture(transmittance.data, 256, 64),
      transmittance,
    ),
    scatteringTexture: table(
      new Data3DTexture(scattering.data, 256, 128, 32),
      scattering,
    ),
    irradianceTexture: table(
      new DataTexture(irradiance.data, 64, 16),
      irradiance,
    ),
  };
  return tables;
}

export function createBayRendering(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  sun: DirectionalLight,
  sunlight: Vector3,
  mobile: boolean,
  effects: Effect[] = [],
) {
  // Keep the existing direct renderer on devices without float render targets.
  if (!renderer.extensions.has('EXT_color_buffer_float')) return undefined;

  let disposed = false;
  const composer = new EffectComposer(renderer, {
    frameBufferType: HalfFloatType,
    multisampling: Math.min(renderer.capabilities.maxSamples, mobile ? 2 : 4),
  });
  renderer.toneMapping = NoToneMapping;
  composer.addPass(new RenderPass(scene, camera));

  const occlusion = new N8AOPostPass(scene, camera);
  occlusion.setQualityMode(mobile ? 'Low' : 'Medium');
  Object.assign(occlusion.configuration, {
    aoRadius: 2.8,
    distanceFalloff: 1,
    intensity: 2,
    color: new Color(0x203345),
    gammaCorrection: false,
    halfRes: mobile,
    depthAwareUpsampling: true,
    // Gear, fans and wings move even while the camera is stationary.
    accumulate: false,
  });
  // N8AO 2.0.1's intermediate beauty target defaults to 8-bit. Preserve HDR
  // reflections here so they reach bloom and the single final tone mapper.
  occlusion.outputTargetInternal.texture.type = HalfFloatType;
  occlusion.outputTargetInternal.texture.colorSpace = LinearSRGBColorSpace;
  composer.addPass(occlusion);
  // Scene-space effects that distort the lit image (the engines' heat haze)
  // run before aerial perspective and bloom so the haze inherits both.
  if (effects.length) composer.addPass(new EffectPass(camera, ...effects));

  const sunDirection = sunlight.clone().transformDirection(BAY_TO_ECEF);
  const atmosphere = new AerialPerspectiveEffect(camera, {
    sky: true,
    sun: true,
    moon: false,
    // Meshes are lit by the sun light and sky environment below, in the same
    // units, so the effect only adds transmittance, inscatter and the sky.
    sunLight: false,
    skyLight: false,
    correctGeometricError: false,
    sunDirection,
  });
  atmosphere.worldToECEFMatrix.copy(BAY_TO_ECEF);
  const atmospherePass = new EffectPass(camera, atmosphere);
  atmospherePass.enabled = false;
  composer.addPass(atmospherePass);

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD,
    mipmapBlur: true,
    intensity: 0.12,
    luminanceThreshold: 1.5,
    luminanceSmoothing: 0.5,
    levels: mobile ? 5 : 6,
  });
  const finish = new EffectPass(
    camera,
    bloom,
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    // AgX desaturates the sky and land it compresses; restore a little.
    new HueSaturationEffect({ saturation: 0.12 }),
  );
  finish.dithering = true;
  composer.addPass(finish);

  // The same scattering tables light the meshes: the sky is rendered into a
  // small cubemap around the aircraft for image-based diffuse and specular
  // light, and the sun light takes its colour from the transmittance table.
  const skyMaterial = new SkyMaterial({
    sun: false,
    moon: false,
    ground: true,
    groundAlbedo: new Color(0.2, 0.21, 0.18),
    sunDirection,
  });
  skyMaterial.worldToECEFMatrix.copy(BAY_TO_ECEF);
  const skyMesh = new Mesh(new PlaneGeometry(2, 2), skyMaterial);
  skyMesh.frustumCulled = false;
  const skyScene = new Scene();
  skyScene.add(skyMesh);
  const skyTarget = new WebGLCubeRenderTarget(mobile ? 64 : 128, {
    type: HalfFloatType,
  });
  const skyCamera = new CubeCamera(1, 1e6, skyTarget);
  const pmrem = new PMREMGenerator(renderer);
  let environment: WebGLRenderTarget | null = null;
  let environmentFrozen = false;
  const environmentPosition = new Vector3(Infinity, Infinity, Infinity);
  const sunColor = new Color();
  const sunPosition = new Vector3();

  // The Bruneton tables come from whichever source lands first: a
  // low-priority download of the shipped EXR tables, or the GPU generator
  // (a few dozen small passes over idle callbacks, no download) started when
  // the download is slow. Fast connections finish the 4 MB before the GPU
  // would; slow ones no longer wait for it.
  let lookupTextures: PrecomputedTextures | undefined;
  let generator: PrecomputedTexturesGenerator | undefined;
  const download = new AbortController();
  const disposeTables = (tables: PrecomputedTextures) =>
    Object.values(tables).forEach((texture) => texture?.dispose());
  const applyTables = (tables: PrecomputedTextures) => {
    lookupTextures = tables;
    Object.assign(atmosphere, tables);
    Object.assign(skyMaterial, tables);
    atmospherePass.enabled = true;
    pmrem.compileCubemapShader();
  };
  const generateTables = async () => {
    try {
      generator = new PrecomputedTexturesGenerator(renderer, {
        type: HalfFloatType,
        higherOrderScattering: false,
      });
      const tables = await generator.update();
      if (!validTables(tables)) throw new Error('Atmosphere tables invalid');
      return tables;
    } catch {
      generator?.dispose();
      generator = undefined;
      return null;
    }
  };
  const ready = (async () => {
    performance.mark('bay-atmosphere-start');
    const startedAt = performance.now();
    let received = 0;
    let total = Infinity;
    const downloaded = fetchTables(
      sceneAsset('/scenery/atmosphere'),
      download.signal,
      (bytes, size) => {
        received = bytes;
        total = size;
      },
    ).then(
      (tables) => tables,
      () => null,
    );
    // Generation starts only when the download is projected to take longer
    // than the GPU would (checked at 400 ms from its arrival rate, and
    // unconditionally at 900 ms), or when it fails, so fast connections
    // never spend GPU time and shader compiles on tables about to arrive.
    let generation: Promise<PrecomputedTextures | null> | undefined;
    const startGeneration = () => (generation ??= generateTables());
    const projected = () =>
      received > 0
        ? ((performance.now() - startedAt) * total) / received
        : Infinity;
    const generated = new Promise<PrecomputedTextures | null>((resolve) => {
      const early = setTimeout(() => {
        if (!generation && projected() > 900) resolve(startGeneration());
      }, 400);
      const late = setTimeout(() => {
        if (!generation) resolve(startGeneration());
      }, 900);
      void downloaded.then((tables) => {
        if (!tables) resolve(startGeneration());
        else if (!generation) {
          clearTimeout(early);
          clearTimeout(late);
          resolve(null);
        }
      });
    });
    const candidates = [
      generated.then(
        (tables) => tables && { tables, source: 'generated' as const },
      ),
      downloaded.then(
        (tables) => tables && { tables, source: 'downloaded' as const },
      ),
    ];
    type Candidate = Awaited<(typeof candidates)[number]>;
    const winner = await new Promise<Candidate>((resolve) => {
      let failures = 0;
      for (const candidate of candidates)
        void candidate.then((result) => {
          if (result) resolve(result);
          else if (++failures === candidates.length) resolve(null);
        });
    });
    // The loser is discarded whenever it lands (or never, once aborted).
    for (const candidate of candidates)
      void candidate.then((result) => {
        if (result && result !== winner) disposeTables(result.tables);
      });
    if (!winner || disposed) {
      download.abort();
      generator?.dispose();
      generator = undefined;
      if (winner) disposeTables(winner.tables);
      return false;
    }
    if (winner.source === 'generated') download.abort();
    else {
      // A still-running generator disposes itself once its update settles.
      generator?.dispose();
      generator = undefined;
    }
    applyTables(winner.tables);
    performance.mark(`bay-atmosphere-${winner.source}`);
    return true;
  })();
  const scratch = new Vector3();
  const observerPosition = new Vector3();

  function updateLighting(localPosition: Vector3) {
    if (!atmospherePass.enabled || !lookupTextures) return;
    sunPosition.setFromMatrixPosition(atmosphere.worldToECEFMatrix);
    getSunLightColor(
      lookupTextures.transmittanceTexture,
      sunPosition,
      sunDirection,
      sunColor,
    );
    sun.color.copy(sunColor);
    sun.intensity = 1;
    if (
      environment &&
      (environmentFrozen ||
        !skyEnvironmentMoved(localPosition, environmentPosition))
    )
      return;
    environmentPosition.copy(localPosition);
    updateAtmosphereOrigin(
      skyMaterial.worldToECEFMatrix,
      localPosition,
      scratch,
    );
    skyCamera.updateMatrixWorld(true);
    skyCamera.update(renderer, skyScene);
    environment = pmrem.fromCubemap(skyTarget.texture, environment);
    if (scene.environment !== environment.texture) {
      scene.environment = environment.texture;
      scene.environmentIntensity = 1;
    }
  }

  return {
    ready,
    /** Development-only switches for isolating passes in browser probes. */
    debug: {
      occlusion,
      atmospherePass,
      finish,
      bloom,
      freezeEnvironment(frozen: boolean) {
        environmentFrozen = frozen;
      },
    },
    resize(width: number, height: number) {
      composer.setSize(width, height);
    },
    render(localPosition: Vector3, dt: number) {
      updateAtmosphereOrigin(
        atmosphere.worldToECEFMatrix,
        localPosition,
        scratch,
      );
      observerPosition.copy(localPosition).add(camera.position);
      updateLighting(observerPosition);
      composer.render(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // N8AO owns fullscreen triangle wrappers that Pass.dispose does not
      // recognize. Dispose those as well as its render targets/materials.
      for (const [key, value] of Object.entries(occlusion)) {
        if (key.endsWith('Quad')) value?.dispose?.();
      }
      composer.dispose();
      skyMesh.geometry.dispose();
      skyMaterial.dispose();
      skyTarget.dispose();
      environment?.dispose();
      pmrem.dispose();
      download.abort();
      // Generated tables belong to the generator's render targets.
      if (generator) generator.dispose();
      else if (lookupTextures) disposeTables(lookupTextures);
    },
  };
}
