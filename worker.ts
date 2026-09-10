import handler from 'vinext/server/fetch-handler';
import { EmailMessage } from 'cloudflare:email';
import { handleApi, type EdgeEnv } from './server/api';
import { refreshLiveData } from './server/live';
import { pruneMetrics } from './server/metrics';
import { sceneAsset } from './lib/scene-assets';

// The two small fetches that gate the opening's CPU work (terrain build and
// tile priming) are announced on the document response, so browsers start
// them before the body arrives and Cloudflare can repeat them as 103 Early
// Hints ahead of the Worker on later requests. Larger assets stay in the
// document's low-priority preloads so they cannot delay the scripts.
const EARLY_HINTS = ['/scenery/bay-elevation.webp', '/tiles/manifest.json']
  .map(
    (path) =>
      `<${sceneAsset(path)}>; rel=preload; as=fetch; crossorigin=anonymous`,
  )
  .join(', ');

interface Env extends EdgeEnv {
  CONTACT_EMAIL?: SendEmail;
}
function encodedBody(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .match(/.{1,76}/g)!
    .join('\r\n');
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
      if (
        request.method !== 'GET' ||
        !page.headers.get('content-type')?.includes('text/html')
      )
        return page;
      const hinted = new Response(page.body, page);
      hinted.headers.append('Link', EARLY_HINTS);
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
