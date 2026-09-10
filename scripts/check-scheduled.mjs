import { Miniflare } from 'miniflare';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
const paths = await readdir(resolve('dist/server'), { recursive: true });
const modules = [
  'index.js',
  ...paths.filter((p) => p.endsWith('.js') && p !== 'index.js'),
].map((path) => ({ type: 'ESModule', path: resolve('dist/server', path) }));
const mf = new Miniflare({
  modules,
  modulesRoot: resolve('dist/server'),
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
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
  console.log(
    'Built Worker scheduled handler passed: KSFO weather and five project records written to local KV.',
  );
} finally {
  await mf.dispose();
}
