import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, cp, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sceneVersion(root) {
  const hash = createHash('sha256');
  async function visit(folder) {
    const entries = await readdir(resolve(root, 'public', folder), {
      withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        hash.update(path + '\0');
        hash.update(await readFile(resolve(root, 'public', path)));
      }
    }
  }
  for (const folder of ['models', 'scenery', 'tiles']) await visit(folder);
  return hash.digest('hex').slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const version = await sceneVersion(root);
  const destination = resolve(root, 'dist/client/scene', version);
  await mkdir(destination, { recursive: true });
  for (const folder of ['models', 'scenery', 'tiles']) {
    await cp(resolve(root, 'public', folder), resolve(destination, folder), {
      recursive: true,
    });
  }
  // Plain URLs stay available for older tabs and existing links. Only paths
  // containing the content version receive immutable browser caching.
  await appendFile(
    resolve(root, 'dist/client/_headers'),
    '\n/scene/*\n  Cache-Control: public, max-age=31536000, immutable\n',
  );
  console.log(`Versioned scene assets: ${version}`);
}
