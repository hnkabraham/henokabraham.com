import { createHash } from 'node:crypto';
import { readFile, mkdir, cp, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything the airborne tour fetches at runtime. The earlier terrain
// experiment's tiles and scenery live under archive/, outside public/, so a
// build neither copies nor lists them; only these four files are versioned.
export const SCENE_FILES = [
  'models/dreamliner-787-9.glb',
  'scenery/daylight.hdr',
  'draco/draco_wasm_wrapper.js',
  'draco/draco_decoder.wasm',
];

export async function sceneVersion(root) {
  const hash = createHash('sha256');
  for (const path of SCENE_FILES) {
    hash.update(path + '\0');
    hash.update(await readFile(resolve(root, 'public', path)));
  }
  return hash.digest('hex').slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const version = await sceneVersion(root);
  const destination = resolve(root, 'dist/client/scene', version);
  for (const path of SCENE_FILES) {
    await mkdir(resolve(destination, path, '..'), { recursive: true });
    await cp(resolve(root, 'public', path), resolve(destination, path));
  }
  // Vite also copies the plain files; only the versioned paths are cached
  // immutably, and older tabs can still resolve the plain ones.
  await appendFile(
    resolve(root, 'dist/client/_headers'),
    '\n/scene/*\n  Cache-Control: public, max-age=31536000, immutable\n',
  );
  console.log(`Versioned scene assets: ${version}`);
}
