import { createHash } from 'node:crypto';
import { readFile, mkdir, cp, rm, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything the airborne tour fetches at runtime, and nothing else. The
// earlier terrain experiment's tiles and scenery stay in the repository for
// its scripts and checks, but no page requests them, so the build drops them
// from dist rather than upload 145 MB of unused imagery with every deploy.
export const SCENE_FILES = [
  'models/dreamliner-787-9.glb',
  'scenery/daylight.hdr',
  'draco/draco_wasm_wrapper.js',
  'draco/draco_decoder.wasm',
];
const PUBLIC_FOLDERS = ['models', 'scenery', 'tiles', 'draco'];

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
  // Vite copies all of public/; the plain copies are not referenced by the
  // built page, whose asset URLs all carry the content version.
  for (const folder of PUBLIC_FOLDERS)
    await rm(resolve(root, 'dist/client', folder), {
      recursive: true,
      force: true,
    });
  await appendFile(
    resolve(root, 'dist/client/_headers'),
    '\n/scene/*\n  Cache-Control: public, max-age=31536000, immutable\n',
  );
  console.log(`Versioned scene assets: ${version}`);
}
