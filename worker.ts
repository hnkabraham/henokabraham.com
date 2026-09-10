import handler from 'vinext/server/fetch-handler';
import { EmailMessage } from 'cloudflare:email';
import { handleApi, type EdgeEnv } from './server/api';
import { refreshLiveData } from './server/live';
import { pruneMetrics } from './server/metrics';

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
      return handler.fetch(request, env, ctx);
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
