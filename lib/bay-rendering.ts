import {
  AerialPerspectiveEffect,
  PrecomputedTexturesLoader,
} from '@takram/three-atmosphere';
import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import {
  Color,
  HalfFloatType,
  LinearSRGBColorSpace,
  NoToneMapping,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { BAY_TO_ECEF, updateAtmosphereOrigin } from './bay-atmosphere';

export function createBayRendering(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  sunlight: Vector3,
  mobile: boolean,
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

  const atmosphere = new AerialPerspectiveEffect(camera, {
    sky: true,
    sun: true,
    moon: false,
    // The airframe already has PBR lighting; apply scattering only.
    sunLight: false,
    skyLight: false,
    correctGeometricError: false,
    sunDirection: sunlight.clone().transformDirection(BAY_TO_ECEF),
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
  );
  finish.dithering = true;
  composer.addPass(finish);

  // Ship compressed LUTs from Takram's reference asset revision. No external
  // requests, credentials, or expensive multi-frame GPU precomputation.
  let lookupTextures: ReturnType<PrecomputedTexturesLoader['load']>;
  const ready = new Promise<boolean>((resolve) => {
    lookupTextures = new PrecomputedTexturesLoader({
      type: HalfFloatType,
      higherOrderScattering: false,
    }).load(
      '/scenery/atmosphere',
      () => {
        if (disposed) {
          Object.values(lookupTextures).forEach((texture) =>
            texture?.dispose(),
          );
          resolve(false);
          return;
        }
        Object.assign(atmosphere, lookupTextures);
        atmospherePass.enabled = true;
        resolve(true);
      },
      undefined,
      () => resolve(false),
    );
  });
  const scratch = new Vector3();

  return {
    ready,
    resize(width: number, height: number) {
      composer.setSize(width, height);
    },
    render(localPosition: Vector3, dt: number) {
      updateAtmosphereOrigin(
        atmosphere.worldToECEFMatrix,
        localPosition,
        scratch,
      );
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
      Object.values(lookupTextures).forEach((texture) => texture?.dispose());
    },
  };
}
