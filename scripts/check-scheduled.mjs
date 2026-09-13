// Runs the built Worker's scheduled handler in Miniflare against canned
// upstreams, so the check is deterministic and offline: GitHub's shared
// runner addresses are rate-limited by api.github.com and refused by
// aviationweather.gov. `--live` uses the real feeds instead, for a manual
// end-to-end run.
import { Miniflare } from 'miniflare';
// Pinned to Miniflare's own undici: it accepts only that version's MockAgent.
import { MockAgent } from 'undici';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const live = process.argv.includes('--live');
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

const fetchMock = new MockAgent();
if (!live) {
  fetchMock.disableNetConnect();
  const observed = Math.floor(Date.now() / 1000) - 600;
  fetchMock
    .get('https://aviationweather.gov')
    .intercept({ path: '/api/data/metar?ids=KSFO&format=json' })
    .reply(
      200,
      [
        {
          icaoId: 'KSFO',
          obsTime: observed,
          rawOb: 'METAR KSFO 130356Z 27023G33KT 10SM FEW017 17/13 A2999',
          temp: 16.7,
          wdir: 270,
          wspd: 23,
          wgst: 33,
          visib: '10+',
          fltCat: 'VFR',
          cover: 'FEW',
        },
      ],
      { headers: { 'content-type': 'application/json' } },
    );
  const github = fetchMock.get('https://api.github.com');
  for (const repo of [
    'wear-ios-bridge',
    'swift-obd-engine',
    'claude-code-mobile-mode',
  ]) {
    github
      .intercept({ path: `/repos/hnkabraham/${repo}` })
      .reply(
        200,
        {
          private: false,
          full_name: `hnkabraham/${repo}`,
          pushed_at: '2026-09-02T05:13:34Z',
        },
        { headers: { 'content-type': 'application/json' } },
      );
    // One published release; a 404 is the normal answer for the others.
    const release = github.intercept({
      path: `/repos/hnkabraham/${repo}/releases/latest`,
    });
    if (repo === 'wear-ios-bridge')
      release.reply(
        200,
        {
          tag_name: 'v1.2.0',
          html_url: `https://github.com/hnkabraham/${repo}/releases/tag/v1.2.0`,
          published_at: '2026-08-20T18:00:00Z',
        },
        { headers: { 'content-type': 'application/json' } },
      );
    else release.reply(404, { message: 'Not Found' });
  }
  for (const site of ['https://henokabraham.com', 'https://unitedflighttracker.com'])
    fetchMock.get(site).intercept({ path: '/', method: 'HEAD' }).reply(200, '');
}
const mf = new Miniflare({
  modules,
  modulesRoot: resolve('dist/server'),
  compatibilityDate: config.compatibility_date,
  compatibilityFlags: config.compatibility_flags,
  kvNamespaces: ['LIVE_DATA'],
  ...(live ? {} : { fetchMock }),
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
  if (!live) {
    // Every canned upstream was consumed, and the values passed through.
    fetchMock.assertNoPendingInterceptors();
    assert.deepEqual(
      [weather.temperatureC, weather.windKnots, weather.gustKnots],
      [16.7, 23, 33],
    );
    assert.equal(weather.category, 'VFR');
    const bridge = projects.projects.find((p) => p.id === 'wear-bridge');
    assert.equal(bridge.metadataAvailable, true);
    assert.equal(bridge.updatedAt, '2026-09-02T05:13:34Z');
    assert.equal(bridge.release?.name, 'v1.2.0');
    assert.equal(
      projects.projects.find((p) => p.id === 'obd-engine').release,
      undefined,
    );
    assert.equal(
      projects.projects.find((p) => p.id === 'flight-tracker').reachable,
      true,
    );
  }
  console.log(
    `Built Worker scheduled handler passed (${live ? 'live feeds' : 'canned upstreams'}): KSFO weather and five project records written to local KV.`,
  );
} finally {
  await mf.dispose();
}
