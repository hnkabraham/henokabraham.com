// The subset of three.js the garage viewer uses. The scene imports this
// module, not the 'three' namespace, so the bundler ships these classes and
// what the loaders need rather than the whole library.
export {
  ACESFilmicToneMapping,
  CircleGeometry,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
} from 'three';
