import assert from 'node:assert/strict';
import { handleApi, boundedJson, validContact } from '../server/api.ts';
import { parseWeather, refreshLiveData } from '../server/live.ts';
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
  FLIGHT_METRICS: { writeDataPoint: (point) => points.push(point) },
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
  assert.deepEqual(points[0], {
    indexes: ['portfolio'],
    blobs: ['scene_fps', 'phone', 'full'],
    doubles: [58.6],
  });
  assert.equal(
    (await handleApi(request('/api/metrics', metric, { 'Sec-GPC': '1' }), env))
      .status,
    204,
  );
  assert.equal(points.length, 1);
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
  const now = new Date('2026-09-10T03:00:00Z');
  const weather = parseWeather(
    [
      {
        icaoId: 'KSFO',
        obsTime: now.getTime() / 1000,
        rawOb: 'KSFO TEST',
        temp: 0,
        wdir: 'VRB',
        wspd: 0,
        visib: '10+',
        fltCat: 'VFR',
      },
    ],
    now,
  );
  assert.equal(weather.temperatureC, 0);
  assert.equal(weather.windKnots, 0);
  assert.equal(weather.windDegrees, null);
  assert.throws(() =>
    parseWeather(
      [{ icaoId: 'KLAX', obsTime: 10, rawOb: 'wrong station' }],
      now,
    ),
  );
  const cache = new Map([['weather:v1', JSON.stringify(weather)]]);
  globalThis.fetch = async () => {
    throw new Error('Upstream unavailable');
  };
  await refreshLiveData({
    get: async (key) => cache.get(key),
    put: async (key, value) => cache.set(key, value),
  });
  assert.equal(
    cache.get('weather:v1'),
    JSON.stringify(weather),
    'A failed refresh preserves the previous weather observation',
  );
  assert.ok(
    JSON.parse(cache.get('projects:v1')).projects.every(
      (p) => p.reachable !== false,
    ),
    'An unsuccessful automated check cannot claim that a project is down',
  );
  console.log(
    'Edge checks passed: request limits, origins, Turnstile, delivery failures, metric privacy, stale feeds.',
  );
} finally {
  globalThis.fetch = realFetch;
}
