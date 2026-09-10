import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { sceneVersion } from './scripts/scene-assets.mjs';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const directCloudflare = process.env.DEPLOY_TARGET === 'cloudflare';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  name: 'henokabraham-com',
  main: directCloudflare ? './worker.ts' : 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    define: {
      __SCENE_VERSION__: JSON.stringify(
        directCloudflare && command === 'build'
          ? await sceneVersion(process.cwd())
          : '',
      ),
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...(directCloudflare ? [] : [sites()]),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: {
          ...localBindingConfig,
          ...(directCloudflare
            ? {
                workers_dev: true,
                kv_namespaces: [
                  {
                    binding: 'LIVE_DATA',
                    id: '8936ecfe40dd4fc9a30d109c058baf60',
                  },
                ],
                d1_databases: [
                  {
                    binding: 'FLIGHT_STATS',
                    database_name: 'henokabraham-flight-stats',
                    database_id: '1ce8af41-87e5-4f67-b06f-76fc50cce697',
                  },
                ],
                ratelimits: [
                  {
                    name: 'CONTACT_LIMITER',
                    namespace_id: '78701',
                    simple: { limit: 3, period: 60 },
                  },
                  {
                    name: 'METRICS_LIMITER',
                    namespace_id: '78702',
                    simple: { limit: 30, period: 60 },
                  },
                ],
                send_email: [
                  {
                    name: 'CONTACT_EMAIL',
                    destination_address: 'REDACTED-EMAIL',
                  },
                ],
                triggers: { crons: ['*/15 * * * *'] },
                observability: { enabled: true, head_sampling_rate: 0.1 },
                vars: {
                  TURNSTILE_SITE_KEY: '0x4AAAAAAEulQFo5cYQJ5FfZ',
                  WEB_ANALYTICS_TOKEN: '17fd51eeb5b141c09edde8089ecda2ca',
                  CONTACT_TO: 'REDACTED-EMAIL',
                },
                preview_urls: false,
                routes: [
                  {
                    pattern: 'henokabraham.com',
                    custom_domain: true,
                    zone_name: 'henokabraham.com',
                  },
                ],
              }
            : {}),
        },
      }),
    ],
  };
});
