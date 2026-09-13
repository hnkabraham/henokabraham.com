import handler from 'vinext/server/fetch-handler';
import { EmailMessage } from 'cloudflare:email';
import { handleApi, type EdgeEnv } from './server/api';
import { refreshLiveData } from './server/live';
import { pruneMetrics } from './server/metrics';
// The opening sky is useful for every visitor, including reduced motion.
// It is the AVIF (57 KB against the 357 KB JPEG the stylesheet falls back
// to); the type lets a browser without AVIF skip the hint. Aircraft assets
// are fetched by the scene once it decides to run.
const EARLY_HINTS =
  '</images/cruise-sky.avif>; rel=preload; as=image; type=image/avif';
// Static assets take their headers from public/_headers; the document is
// rendered here, so its transport and embedding policy is set here. No
// script or connect directives: the page carries inline framework scripts
// and Cloudflare's Turnstile frame, and this policy must not break either.
const PAGE_HEADERS: [string, string][] = [
  ['Strict-Transport-Security', 'max-age=31536000'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  [
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ],
  [
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ],
];

interface Env extends EdgeEnv {
  CONTACT_EMAIL?: SendEmail;
}
function encodedBody(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return (btoa(binary).match(/.{1,76}/g) ?? []).join('\r\n');
}
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      const api = await handleApi(request, env, {
        sendEmail:
          env.CONTACT_EMAIL && env.CONTACT_TO
            ? async (replyTo, body) => {
                const from = 'tower@henokabraham.com';
                const to = env.CONTACT_TO!;
                const raw = [
                  `From: Personal Airspace <${from}>`,
                  `To: ${to}`,
                  `Reply-To: ${replyTo}`,
                  'Subject: Contact the tower | Henok Abraham',
                  `Date: ${new Date().toUTCString()}`,
                  `Message-ID: <${crypto.randomUUID()}@henokabraham.com>`,
                  'MIME-Version: 1.0',
                  'Content-Type: text/plain; charset=UTF-8',
                  'Content-Transfer-Encoding: base64',
                  '',
                  encodedBody(body),
                  '',
                ].join('\r\n');
                await env.CONTACT_EMAIL!.send(new EmailMessage(from, to, raw));
              }
            : undefined,
      });
      if (api) return api;
      const page = await handler.fetch(request, env, ctx);
      // HEAD must describe the same response GET would send, policy included.
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        !page.headers.get('content-type')?.includes('text/html')
      )
        return page;
      const hinted = new Response(page.body, page);
      hinted.headers.append('Link', EARLY_HINTS);
      for (const [name, value] of PAGE_HEADERS) hinted.headers.set(name, value);
      return hinted;
    } catch {
      console.error('edge_request_failed');
      return Response.json(
        { error: 'Temporarily unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    if (env.LIVE_DATA) ctx.waitUntil(refreshLiveData(env.LIVE_DATA));
    if (
      env.FLIGHT_STATS &&
      new Date(_controller.scheduledTime).getUTCMinutes() === 0
    )
      ctx.waitUntil(pruneMetrics(env.FLIGHT_STATS));
  },
};

export default worker;
