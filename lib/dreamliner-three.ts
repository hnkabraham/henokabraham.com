// The subset of three.js the airborne tour uses. The scene imports this
// module, not the 'three' namespace, so the bundler ships these classes and
// what the loaders need rather than the whole library.
export {
  AgXToneMapping,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  RGBADepthPacking,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
