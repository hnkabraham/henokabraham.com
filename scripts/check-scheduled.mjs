import { Miniflare } from 'miniflare';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
assert.ok(
  config.compatibility_flags.includes('global_fetch_strictly_public'),
  'Homepage monitoring must use public routing',
);
const paths = await readdir(resolve('dist/server'), { recursive: true });
const modules = [
  'index.js',
  ...paths.filter((p) => p.endsWith('.js') && p !== 'index.js'),
].map((path) => ({ type: 'ESModule', path: resolve('dist/server', path) }));
const mf = new Miniflare({
  modules,
  modulesRoot: resolve('dist/server'),
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  kvNamespaces: ['LIVE_DATA'],
});
try {
  const worker = await mf.getWorker();
  const result = await worker.scheduled({ cron: '*/15 * * * *' });
  assert.equal(result.outcome, 'ok');
  const kv = await mf.getKVNamespace('LIVE_DATA');
  const weather = await kv.get('weather:v1', 'json');
  const projects = await kv.get('projects:v1', 'json');
  assert.equal(weather?.station, 'KSFO');
  assert.equal(projects?.projects.length, 5);
  assert.equal(
    projects.projects.find((project) => project.id === 'bay-departure')
      ?.reachable,
    true,
  );
  console.log(
    'Built Worker scheduled handler passed: KSFO weather and five project records written to local KV.',
  );
} finally {
  await mf.dispose();
}
