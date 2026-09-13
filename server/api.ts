import { writeMetric } from './metrics.ts';
import type { LiveStore } from './live.ts';
export interface EdgeEnv {
  LIVE_DATA?: LiveStore;
  FLIGHT_STATS?: D1Database;
  CONTACT_LIMITER?: RateLimit;
  METRICS_LIMITER?: RateLimit;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  WEB_ANALYTICS_TOKEN?: string;
  CONTACT_TO?: string;
}
type Services = {
  sendEmail?: (replyTo: string, body: string) => Promise<void>;
};
const reply = (data: unknown, status = 200, cache = 'no-store') =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
  });
export async function boundedJson(request: Request, limit: number) {
  if (
    !request.headers
      .get('Content-Type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new Error('Content type');
  if (Number(request.headers.get('Content-Length')) > limit)
    throw new Error('Too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('No body');
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('Too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
export function validContact(
  b: unknown,
): b is { name: string; email: string; message: string; token: string } {
  if (!b || typeof b !== 'object') return false;
  const v = b as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    v.name.trim().length >= 1 &&
    v.name.length <= 100 &&
    typeof v.email === 'string' &&
    v.email.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(
      v.email,
    ) &&
    typeof v.message === 'string' &&
    v.message.trim().length >= 10 &&
    v.message.length <= 5000 &&
    typeof v.token === 'string' &&
    v.token.length > 0 &&
    v.token.length <= 2048
  );
}
export async function handleApi(
  request: Request,
  env: EdgeEnv,
  services: Services = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  const path = url.pathname;
  if (['/api/live', '/api/config'].includes(path)) {
    if (request.method !== 'GET')
      return reply({ error: 'Method not allowed' }, 405);
    if (path === '/api/config')
      return reply(
        {
          contactEnabled: Boolean(
            env.TURNSTILE_SITE_KEY &&
            env.TURNSTILE_SECRET_KEY &&
            services.sendEmail &&
            env.CONTACT_LIMITER,
          ),
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
          analyticsToken: env.WEB_ANALYTICS_TOKEN || null,
          metricsEnabled: Boolean(env.FLIGHT_STATS && env.METRICS_LIMITER),
        },
        200,
        'public, max-age=60',
      );
    const projects = env.LIVE_DATA
      ? await env.LIVE_DATA.get('projects:v1', 'json')
      : null;
    return reply({ projects }, 200, 'public, max-age=60');
  }
  if (!['/api/contact', '/api/metrics'].includes(path))
    return reply({ error: 'Not found' }, 404);
  if (request.method !== 'POST')
    return reply({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== url.origin)
    return reply({ error: 'Origin not allowed' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const limiter =
    path === '/api/contact' ? env.CONTACT_LIMITER : env.METRICS_LIMITER;
  if (!limiter) return reply({ error: 'Temporarily unavailable' }, 503);
  if (!(await limiter.limit({ key: ip })).success)
    return reply({ error: 'Please wait a minute before trying again.' }, 429);
  let body;
  try {
    body = await boundedJson(request, path === '/api/contact' ? 30000 : 4096);
  } catch {
    return reply({ error: 'Invalid submission' }, 400);
  }
  if (path === '/api/metrics') {
    if (!env.FLIGHT_STATS)
      return reply({ error: 'Temporarily unavailable' }, 503);
    if (
      request.headers.get('DNT') === '1' ||
      request.headers.get('Sec-GPC') === '1'
    )
      return new Response(null, { status: 204 });
    const events = [
      'scene_ready_ms',
      'scene_unavailable',
      'scene_fps',
      'scene_scroll_fps',
      'scene_scroll_p95_ms',
      'scene_scroll_jank_pct',
      'scene_asset_failure',
      'project_open',
    ];
    if (
      !body ||
      !events.includes(body.event) ||
      typeof body.value !== 'number' ||
      !Number.isFinite(body.value) ||
      body.value < 0 ||
      body.value > 3600000 ||
      !['phone', 'desktop'].includes(body.device) ||
      typeof body.reduced !== 'boolean'
    )
      return reply({ error: 'Invalid measurement' }, 400);
    // No IP, identifier, query string, contact text or raw user agent is stored.
    await writeMetric(
      env.FLIGHT_STATS,
      body.event,
      body.device,
      body.reduced,
      body.value,
    );
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!env.TURNSTILE_SECRET_KEY || !services.sendEmail)
    return reply(
      {
        error: 'The tower is temporarily unavailable. Please try again later.',
      },
      503,
    );
  if (!validContact(body))
    return reply(
      {
        error:
          'Enter your name, a valid email, a message of 10–5,000 characters, and complete verification.',
      },
      400,
    );
  try {
    const validation = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: body.token,
          remoteip: ip,
        }),
      },
    );
    const verdict = (await validation.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      !validation.ok ||
      !verdict.success ||
      verdict.hostname !== url.hostname ||
      verdict.action !== 'contact'
    )
      return reply(
        { error: 'Verification expired or failed. Please complete it again.' },
        400,
      );
    const reference = crypto.randomUUID();
    await services.sendEmail(
      body.email,
      `New message from henokabraham.com\n\nName: ${body.name.trim()}\nEmail: ${body.email}\nReference: ${reference}\n\n${body.message.trim()}\n`,
    );
    return reply({ ok: true, reference });
  } catch {
    console.warn('contact_delivery_failed');
    return reply(
      {
        error:
          'Your message could not be confirmed as sent. Please try again later.',
      },
      503,
    );
  }
}
