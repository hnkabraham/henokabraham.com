import assert from 'node:assert/strict';
import { handleApi, boundedJson, validContact } from '../server/api.ts';
import { refreshLiveData } from '../server/live.ts';
const origin = 'https://henokabraham.com';
const realFetch = globalThis.fetch;
const request = (path, body, extra = {}) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
const valid = {
  name: 'Test Pilot',
  email: 'pilot@example.com',
  message: 'Testing a complete contact message.',
  token: 'test-token',
};
const points = [],
  sent = [];
const env = {
  TURNSTILE_SITE_KEY: 'public',
  TURNSTILE_SECRET_KEY: 'test-secret',
  CONTACT_TO: 'owner@example.com',
  CONTACT_LIMITER: { limit: async () => ({ success: true }) },
  METRICS_LIMITER: { limit: async () => ({ success: true }) },
  FLIGHT_STATS: {
    prepare: () => ({
      bind: (...values) => ({ run: async () => points.push(values) }),
    }),
  },
};
const services = { sendEmail: async (to, text) => sent.push({ to, text }) };
try {
  assert.equal(
    validContact({
      ...valid,
      email: 'pilot@example.com\r\nBcc: victim@example.com',
    }),
    false,
  );
  assert.equal(validContact({ ...valid, message: '   ' }), false);
  assert.equal(validContact({ ...valid, token: 'a'.repeat(2049) }), false);
  assert.equal(
    (
      await handleApi(
        request('/api/contact', valid, { Origin: 'https://evil.example' }),
        env,
        services,
      )
    ).status,
    403,
  );
  assert.equal(
    (await handleApi(new Request(origin + '/api/contact'), env, services))
      .status,
    405,
  );
  assert.equal(
    (
      await handleApi(
        request('/api/contact', valid),
        {
          ...env,
          CONTACT_LIMITER: { limit: async () => ({ success: false }) },
        },
        services,
      )
    ).status,
    429,
  );
  assert.equal(
    (
      await handleApi(
        request('/api/contact', valid),
        { ...env, TURNSTILE_SECRET_KEY: undefined },
        services,
      )
    ).status,
    503,
  );
  const wrongVerdicts = [
    { success: false },
    { success: true, hostname: 'evil.example', action: 'contact' },
    { success: true, hostname: 'henokabraham.com', action: 'login' },
  ];
  for (const verdict of wrongVerdicts) {
    globalThis.fetch = async () => Response.json(verdict);
    assert.equal(
      (await handleApi(request('/api/contact', valid), env, services)).status,
      400,
    );
  }
  assert.equal(sent.length, 0, 'No message is sent until validation succeeds');
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      hostname: 'henokabraham.com',
      action: 'contact',
    });
  const success = await handleApi(
    request('/api/contact', valid),
    env,
    services,
  );
  assert.equal(success.status, 200);
  assert.match((await success.json()).reference, /^[a-f0-9-]{36}$/);
  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].to,
    valid.email,
    'The visitor address is used only as Reply-To',
  );
  assert.ok(sent[0].text.includes(valid.message));
  assert.equal(
    (
      await handleApi(request('/api/contact', valid), env, {
        sendEmail: async () => {
          throw Error('Delivery failed');
        },
      })
    ).status,
    503,
  );
  const metric = {
    event: 'scene_fps',
    value: 58.6,
    device: 'phone',
    reduced: false,
    email: 'not-stored@example.com',
    url: '/?private=never-store',
  };
  assert.equal(
    (await handleApi(request('/api/metrics', metric), env)).status,
    204,
  );
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].slice(1), ['scene_fps', 'phone', 'full', 58.6]);
  assert.match(points[0][0], /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  assert.equal(
    (await handleApi(request('/api/metrics', metric, { 'Sec-GPC': '1' }), env))
      .status,
    204,
  );
  assert.equal(points.length, 1);
  for (const event of [
    'scene_scroll_fps',
    'scene_scroll_p95_ms',
    'scene_scroll_jank_pct',
  ]) {
    assert.equal(
      (await handleApi(request('/api/metrics', { ...metric, event }), env))
        .status,
      204,
    );
    assert.equal(points.at(-1)[1], event);
  }
  assert.equal(
    (
      await handleApi(
        request('/api/metrics', { ...metric, event: 'arbitrary' }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (await handleApi(request('/api/metrics', { ...metric, value: -1 }), env))
      .status,
    400,
  );
  await assert.rejects(() =>
    boundedJson(request('/api/contact', { text: 'x'.repeat(10000) }), 1000),
  );
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5000));
      controller.close();
    },
  });
  await assert.rejects(() =>
    boundedJson(
      new Request(origin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      }),
      1000,
    ),
  );
  const cache = new Map();
  globalThis.fetch = async () => {
    throw new Error('Upstream unavailable');
  };
  await refreshLiveData({
    get: async (key) => cache.get(key),
    put: async (key, value) => cache.set(key, value),
  });
  assert.ok(
    JSON.parse(cache.get('projects:v1')).projects.every(
      (p) => p.reachable !== false,
    ),
    'An unsuccessful automated check cannot claim that a project is down',
  );
  // With a token, GitHub requests carry it and nothing else does; when
  // GitHub refuses (403 is the shared rate limit), the card keeps what was
  // last known instead of going blank.
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = typeof url === 'string' ? url : url.href;
    requests.push({ url: target, auth: init.headers?.Authorization });
    if (target.includes('api.github.com'))
      return new Response('{}', { status: 403 });
    return new Response(null, { status: 200 });
  };
  cache.set(
    'projects:v1',
    JSON.stringify({
      checkedAt: '2026-10-01T00:00:00.000Z',
      projects: [
        {
          id: 'wear-bridge',
          repo: 'wear-ios-bridge',
          checkedAt: '2026-10-01T00:00:00.000Z',
          metadataAvailable: true,
          updatedAt: '2026-09-30T12:00:00Z',
        },
      ],
    }),
  );
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await refreshLiveData(
      {
        get: async (key) => cache.get(key),
        put: async (key, value) => cache.set(key, value),
      },
      'test-token',
    );
  } finally {
    console.warn = warn;
  }
  assert.ok(
    requests
      .filter((request) => request.url.includes('api.github.com'))
      .every((request) => request.auth === 'Bearer test-token'),
    'GitHub requests carry the token',
  );
  assert.ok(
    requests
      .filter((request) => !request.url.includes('api.github.com'))
      .every((request) => request.auth === undefined),
    'Website checks never carry it',
  );
  const kept = JSON.parse(cache.get('projects:v1')).projects;
  assert.equal(
    kept.find((p) => p.id === 'wear-bridge').updatedAt,
    '2026-09-30T12:00:00Z',
    'A refused check keeps the last known update',
  );
  assert.equal(
    kept.find((p) => p.id === 'obd-engine').metadataAvailable,
    false,
    'Nothing is invented for a repository never seen',
  );
  assert.ok(
    warnings.some(
      ([event, detail]) =>
        event === 'project_metadata_unavailable' &&
        detail.reason === 'Upstream HTTP 403',
    ),
    'The log says why a check failed',
  );
  console.log(
    'Edge checks passed: request limits, origins, Turnstile, delivery failures, metric privacy, unverified project checks, the GitHub token and last-known project data.',
  );
} finally {
  globalThis.fetch = realFetch;
}
