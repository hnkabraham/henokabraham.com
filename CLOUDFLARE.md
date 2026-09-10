# Deploy to your Cloudflare account

This deployment uses the latest project in `Developer/henokabraham.com`, built with Vinext and the Cloudflare Vite plugin. The Worker is named `henokabraham-com`. The primary hostname is `henokabraham.com`, configured as a Cloudflare Worker Custom Domain. The `henokabraham-com.henok37.workers.dev` address is also enabled.

## Credentials

Create a custom API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account → Workers Scripts → Edit.
- Account → Account Settings → Read.
- Account Resources → Include → only the account that should host this site.

The live services use a dedicated Workers KV namespace. Add Workers KV Storage permissions when managing or seeding it. Turnstile widget management needs Turnstile Edit; the setup of Web Analytics and Email Routing needs their corresponding account/zone permissions. Routine deployment preserves the existing resources and Turnstile secret. There are no D1 or R2 bindings; scenery remains on Workers Static Assets.

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
- Cloudflare version: `f8d02e53-6452-40a4-a1f2-5ffd7e8c57af`
- Verification: the live homepage returns HTTP 200; sampled aircraft, terrain manifest, terrain tile, atmosphere lookup and compressed city assets match the local files.
- Authentication for the initial upload was passed through process memory; the Global API Key was not written into the repository or credential file.


## Live airport services

- `worker.ts` wraps the existing Vinext handler and exposes `/api/live`, `/api/config`, `/api/contact` and `/api/metrics`.
- The scheduled handler refreshes KSFO METAR data and the allowlisted public GitHub repositories / deployed projects every 15 minutes. KV namespace `henokabraham-com-live-data` (`8936ecfe40dd4fc9a30d109c058baf60`) stores public snapshots only. Weather failures retain the previous observation; reports over two hours old are labelled and reports over 24 hours old are hidden. Project checks older than 45 minutes are labelled as previous checks. A blocked automated website check is reported as unverified, not an outage.
- Turnstile widget `0x4AAAAAAEulQFo5cYQJ5FfZ` covers the apex and Workers address. `TURNSTILE_SECRET_KEY` is a Cloudflare Worker secret, never a public Vite variable. Verification checks the hostname and `contact` action. The server limits bodies, validates fields and requires same-origin POSTs. Contact rate limit: three attempts per minute per IP at each Cloudflare location.
- `CONTACT_EMAIL` can send only to the verified owner inbox. Messages use `tower@henokabraham.com` as From and the validated visitor address as Reply-To. Email Routing was enabled after confirming the zone had no existing MX/SPF records. Contact text is not saved in KV or analytics. Delivery failures return an error; the UI never claims success on failure.
- Web Analytics site `fd6c9f62f2cb41a382b93bf66fc4cf0c` is installed by the application, with automatic injection disabled. Custom measurements go to Analytics Engine dataset `henokabraham_flight`. Both are skipped for Do Not Track or Global Privacy Control. The footer explains what is measured.
- Custom data has index `portfolio`, `blob1` event, `blob2` device class, `blob3` motion preference, and `double1` value. Events: `scene_ready_ms` (navigation to scene ready), `scene_fps` (180 visible animated frame intervals, unclamped), `scene_unavailable`, `scene_asset_failure` (up to three reports per visit), and `project_open` (up to ten selections per visit). These are capped samples, not totals of all errors or clicks. No visitor IDs, IPs, URLs, message text or raw user agents are recorded in these custom events.
- The metrics endpoint accepts only the documented events and bounded numeric values, with 30 requests/minute/IP at each location. Worker logs sample 10% of invocations and do not log contact payloads.

Inspect Web Analytics and Workers logs in the Cloudflare dashboard. Analytics Engine can be queried through its SQL API, for example:

```sql
SELECT blob1 AS event, blob2 AS device, SUM(_sample_interval) AS samples,
  SUM(double1 * _sample_interval) / SUM(_sample_interval) AS average_value
FROM henokabraham_flight
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY event, device
```

### Verification

```sh
node --experimental-strip-types scripts/check-edge.mjs
node scripts/check-bay-rendering.mjs
node scripts/check-bay-scenery.mjs
npm run check:cloudflare
node scripts/check-scheduled.mjs
```

The scheduled check runs the built Worker directly in local workerd and writes only local KV. This avoids the installed Miniflare static-assets router, whose generic scheduled trigger targets the asset router instead of the application. It requires network access for the public data feeds. `scripts/refresh-live-snapshot.mjs` produces a public-data-only KV bulk payload in the system temporary directory for initial seeding; normal refreshes use the Worker cron.

New bindings are configured only for `DEPLOY_TARGET=cloudflare`. The original Sites build stays available; live services gracefully report unavailable there unless equivalent bindings are configured.
