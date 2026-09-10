import { sceneAsset } from '@/lib/scene-assets';
import {
  AerialPerspectiveEffect,
  PrecomputedTexturesLoader,
  SkyMaterial,
  getSunLightColor,
} from '@takram/three-atmosphere';
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
  HalfFloatType,
  LinearSRGBColorSpace,
  Mesh,
  NoToneMapping,
  PlaneGeometry,
  PMREMGenerator,
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

  // Ship compressed LUTs from Takram's reference asset revision. No external
  // requests, credentials, or expensive multi-frame GPU precomputation.
  let lookupTextures: ReturnType<PrecomputedTexturesLoader['load']>;
  const ready = new Promise<boolean>((resolve) => {
    lookupTextures = new PrecomputedTexturesLoader({
      type: HalfFloatType,
      higherOrderScattering: false,
    }).load(
      sceneAsset('/scenery/atmosphere'),
      () => {
        if (disposed) {
          Object.values(lookupTextures).forEach((texture) =>
            texture?.dispose(),
          );
          resolve(false);
          return;
        }
        Object.assign(atmosphere, lookupTextures);
        Object.assign(skyMaterial, lookupTextures);
        atmospherePass.enabled = true;
        pmrem.compileCubemapShader();
        resolve(true);
      },
      undefined,
      () => resolve(false),
    );
  });
  const scratch = new Vector3();
  const observerPosition = new Vector3();

  function updateLighting(localPosition: Vector3) {
    if (!atmospherePass.enabled) return;
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
      Object.values(lookupTextures).forEach((texture) => texture?.dispose());
    },
  };
}
