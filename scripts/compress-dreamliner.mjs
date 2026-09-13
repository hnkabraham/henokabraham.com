// Draco-compresses the aircraft that scripts/prepare-dreamliner.py produced.
// Positions keep 16 bits (about a millimetre across the 63 m span, which the
// livery and wing-flex shaders sample in metres), normals 10 and UVs 12. The
// decoder returns floats, so the shaders never see quantised units.
// Usage: node scripts/compress-dreamliner.mjs <input.glb> <output.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    'Usage: node scripts/compress-dreamliner.mjs <input.glb> <output.glb>',
  );
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const document = await io.read(input);
await document.transform(
  draco({
    method: 'edgebreaker',
    quantizePosition: 16,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
  }),
);
await io.write(output, document);
const { size } = await import('node:fs').then((fs) => fs.statSync(output));
console.log(`${output}: ${size.toLocaleString()} bytes`);
