# Deploy to your Cloudflare account

This deployment uses the latest project in `Developer/henokabraham.com`, built with Vinext and the Cloudflare Vite plugin. The Worker is named `henokabraham-com`. The primary hostname is `henokabraham.com`, configured as a Cloudflare Worker Custom Domain. The `henokabraham-com.henok37.workers.dev` address is also enabled.

## Credentials

Create a custom API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account → Workers Scripts → Edit.
- Account → Account Settings → Read.
- Account Resources → Include → only the account that should host this site.

The live services use a dedicated Workers KV namespace. Add Workers KV Storage permissions when managing or seeding it. Turnstile widget management needs Turnstile Edit; the setup of Web Analytics and Email Routing needs their corresponding account/zone permissions. Routine deployment preserves the existing resources and Turnstile secret. Custom hourly performance summaries use a dedicated D1 database (D1 Edit permission for setup); there are no R2 bindings; scenery remains on Workers Static Assets.

Add the token and the account's 32-character ID to `.env.cloudflare.local`. That file is ignored by Git and is created with owner-only file permissions. Do not add the token to source code or Vite public environment variables. The deployment script supplies credentials to Wrangler after building; they are not application secrets or Worker bindings.

```dotenv
CLOUDFLARE_API_TOKEN=your_scoped_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
```

The script also accepts a Global API Key through `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`. Global keys have full account access; user API tokens allow the narrower permissions above. Global keys must not be passed as `CLOUDFLARE_API_TOKEN`. Credentials supplied through the command environment are not saved by the script.

Use a token expiration appropriate to the deployment session. The existing Sites-hosted preview remains available independently.

## Validate without deploying

```sh
npm run check:cloudflare
```

This builds the current source and runs Wrangler's deployment dry run. It requires no API token and does not upload the Worker or assets.

## Deploy

```sh
npm run deploy:cloudflare
```

The command validates credentials, builds the current source, checks the expected Worker name and bindings, then uploads the Worker and static assets. Wrangler prints the resulting URL. Cloudflare's `workers.dev` deployment is publicly reachable; this is the public personal website target, not the private Sites preview.

Before an initial upload, check for an existing Worker with this name in the selected account. After deployment, check the homepage and representative model, tile and atmosphere URLs. `henokabraham.com` is retained in the Cloudflare-target Vite configuration, so subsequent deployments preserve the custom domain. A scoped token used to manage domain routing should also include Zone → Zone → Read and Zone → Workers Routes → Edit, restricted to the `henokabraham.com` zone.

The original `npm run build` command retains Sites support. `npm run build:cloudflare` skips the Sites metadata plugin and enables the direct Cloudflare target; use the deployment command to ensure the correct output is built before upload.

References:

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Live deployment

- Primary URL: https://henokabraham.com
- Workers URL: https://henokabraham-com.henok37.workers.dev
- Worker: `henokabraham-com`
- Cloudflare version: `72473c42-9bbe-445e-8da8-aaf344dcbe7a`
- Verification: homepage and both live-data/config endpoints return HTTP 200; five sampled versioned 3D assets have immutable cache headers and match local SHA-256 hashes. Live origin, Turnstile and metric validation reject invalid requests. Cloudflare confirmed delivery of the test email to the owner inbox. D1 contains live scene readiness and frame-rate summaries; the 15-minute cron is registered.
- Deployment credentials are read from the owner-only, Git-ignored `.env.cloudflare.local`, as requested. They are excluded from the application build and Worker bindings.


## Zone settings that affect the opening

- **Bot Fight Mode and JavaScript Detections: off.** With them on, Cloudflare injects `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into every page; on 2026-09-10 it was the largest main-thread cost before the scene appeared (340 ms of 1.4 s) and it can challenge visitors that look automated. The AI-crawler block injects nothing and stays on.
- **Smart Tiered Cache: on**, so the first visitor at a Cloudflare location is served from an upper-tier cache rather than storage.
- **Early Hints: on.** `worker.ts` adds a `Link: rel=preload` header for the tile manifest to the document response; Cloudflare replays them as 103 responses on later requests for the same URL.

`node scripts/cloudflare-zone.mjs` prints these settings and `node scripts/cloudflare-zone.mjs --apply` sets them, using the credentials in `.env.cloudflare.local` (the Global API Key, or a token with Bot Management, Cache Settings and Zone Settings edit permissions). The same switches are in the dashboard under Security → Bots, Caching → Tiered Cache and Speed → Optimization.

## Live airport services

- `worker.ts` wraps the existing Vinext handler and exposes `/api/live`, `/api/config`, `/api/contact` and `/api/metrics`.
- The Cloudflare target enables `global_fetch_strictly_public`, so scheduled checks of `henokabraham.com` reach the public Worker instead of bypassing it for the zone origin. The deployment guard and scheduled check verify this flag.
- The scheduled handler refreshes KSFO METAR data and the allowlisted public GitHub repositories / deployed projects every 15 minutes. KV namespace `henokabraham-com-live-data` (`8936ecfe40dd4fc9a30d109c058baf60`) stores public snapshots only. Weather failures retain the previous observation; reports over two hours old are labelled and reports over 24 hours old are hidden. Project checks older than 45 minutes are labelled as previous checks. A blocked automated website check is reported as unverified, not an outage.
- Turnstile widget `0x4AAAAAAEulQFo5cYQJ5FfZ` covers the apex and Workers address. `TURNSTILE_SECRET_KEY` is a Cloudflare Worker secret, never a public Vite variable. Verification checks the hostname and `contact` action. The server limits bodies, validates fields and requires same-origin POSTs. Contact rate limit: three attempts per minute per IP at each Cloudflare location.
- `CONTACT_EMAIL` can send only to the verified owner inbox. Messages use `tower@henokabraham.com` as From and the validated visitor address as Reply-To. Email Routing was enabled after confirming the zone had no existing MX/SPF records. Contact text is not saved in KV or analytics. Delivery failures return an error; the UI never claims success on failure.
- Web Analytics site `fd6c9f62f2cb41a382b93bf66fc4cf0c` is installed by the application, with automatic injection disabled. Custom measurements are atomically aggregated in D1 database `henokabraham-flight-stats` (`1ce8af41-87e5-4f67-b06f-76fc50cce697`), binding `FLIGHT_STATS`, table `flight_metrics`. The schema is in `migrations/0001_flight_metrics.sql`. Summaries older than 90 days are pruned hourly. Both are skipped for Do Not Track or Global Privacy Control. The footer explains what is measured.
- Custom data is grouped by UTC hour, event, device class and motion preference. Each row holds count, sum, minimum and maximum; individual events are not stored. Events: `scene_ready_ms` (navigation to scene ready), `scene_fps` (180 visible animated frame intervals, unclamped), `scene_unavailable`, `scene_asset_failure` (up to three reports per visit), `scene_scroll_fps`, `scene_scroll_p95_ms`, `scene_scroll_jank_pct` (one moving-frame window per departure/climb/Bay region, at most three per event per visit), and `project_open` (up to ten selections per visit). These are capped samples, not totals of all errors or clicks. No visitor IDs, IPs, URLs, message text or raw user agents are recorded in these custom events.
- The metrics endpoint accepts only the documented events and bounded numeric values, with 30 requests/minute/IP at each location. Worker logs sample 10% of invocations and do not log contact payloads.

Inspect Web Analytics and Workers logs in the Cloudflare dashboard. Open the D1 console for `henokabraham-flight-stats` to inspect custom summaries, for example:

```sql
SELECT event, device, SUM(samples) AS samples,
  SUM(total) / SUM(samples) AS average_value,
  MIN(minimum) AS minimum, MAX(maximum) AS maximum
FROM flight_metrics
WHERE hour >= strftime('%Y-%m-%dT%H:00:00Z', 'now', '-1 day')
GROUP BY event, device;
```

### Verification

```sh
node --experimental-strip-types scripts/check-edge.mjs
node --experimental-strip-types scripts/check-metric-storage.mjs
node scripts/check-bay-rendering.mjs
node scripts/check-bay-scenery.mjs
npm run check:cloudflare
node scripts/check-scheduled.mjs
```

The scheduled check runs the built Worker directly in local workerd and writes only local KV. This avoids the installed Miniflare static-assets router, whose generic scheduled trigger targets the asset router instead of the application. It requires network access for the public data feeds. `scripts/refresh-live-snapshot.mjs` produces a public-data-only KV bulk payload in the system temporary directory for initial seeding; normal refreshes use the Worker cron.

New bindings are configured only for `DEPLOY_TARGET=cloudflare`. The original Sites build stays available; live services gracefully report unavailable there unless equivalent bindings are configured.

Analytics Engine activation was attempted in the dashboard, but the upload API continued rejecting the entitlement (10089). The final Worker uses D1 for its custom measurements, so it does not depend on that service. Web Analytics remains enabled separately.


To initialize the same schema in a newly provisioned metrics database, first update the dedicated database ID in `vite.config.ts` and the deployment guard, build, then apply the idempotent schema:

```sh
npx wrangler d1 execute FLIGHT_STATS --remote --config dist/server/wrangler.json --file migrations/0001_flight_metrics.sql
```

The production schema was applied before the first D1-backed deployment. Do not run database initialization against an unrelated database.

## Review fixes deployed

Source commit `3bbe137` fixes whole-image/shade bitmap orientation, gives chapter navigation an opaque high-contrast surface with visible focus and active states, restores the sampler-budget check, and makes self-monitoring use public routing. Desktop and 390 × 844 browser checks, TypeScript, rendering/scenery/flight checks, edge/metric checks, the deployment dry run, and the built scheduled handler passed. The public-routing flag was read back from the deployed Worker; a fresh public project check was published to KV to clear the older error immediately. No database schema or runtime secret changed.

## Adaptive flight performance deployed

Source commit `742f298` adds sustained frame-time quality adjustment, compact desktop scenery, half-resolution AO, bounded lighting refreshes, and faster scroll following. Desktop terrain/building triangles fall 76.5%; the tested full-route easing settles within 1.6 seconds at 30/60/120 Hz. TypeScript, lint, performance/rendering/lifecycle/scenery/flight checks, edge/metric checks, and the Cloudflare dry run passed. Local 1280 × 720 and 390 × 844 browser checks rendered without console warnings or errors, with roughly 120 FPS in sampled settled opening/climb/Bay windows on the test computer. Phone-sized viewport checks are not physical-phone benchmarks or a controlled before/after FPS comparison. The live homepage and APIs returned 200; both changed application/rendering chunks matched local SHA-256 hashes after deployment. New moving-frame telemetry uses the existing D1 schema.

## Drifting blue-sky opening deployed

Source commit `8ae9181` keeps the existing blue sky visible after the scene is ready, moves the photograph and two cloud layers gently, and reveals the flight over 180 px after the first 48 px of scrolling within the hero. The 3D animation and lazy scenery wait while covered. Desktop and 390 × 844 browser checks confirmed the sky at rest, moving cloud positions, the aircraft after scrolling, and the restored sky on return. TypeScript, performance/rendering/lifecycle checks and the Cloudflare build passed. Reduced-motion visitors keep a static sky.
