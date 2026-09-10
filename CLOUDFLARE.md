# Deploy to your Cloudflare account

This deployment uses the latest project in `Developer/henokabraham.com`, built with Vinext and the Cloudflare Vite plugin. The Worker is named `henokabraham-com`. The initial destination is the account's `workers.dev` subdomain; this configuration does not change custom-domain DNS.

## Credentials

Create a custom API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account → Workers Scripts → Edit.
- Account → Account Settings → Read.
- Account Resources → Include → only the account that should host this site.

The current site has no D1, KV or R2 bindings, so storage permissions are unnecessary. Its imagery, models and streamed terrain tiles use Workers Static Assets.

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

Before an initial upload, check for an existing Worker with this name in the selected account. After deployment, check the homepage and representative model, tile and atmosphere URLs. Connecting `henokabraham.com` is a separate custom-domain step and may need zone-scoped access depending on the zone's current setup.

The original `npm run build` command retains Sites support. `npm run build:cloudflare` skips the Sites metadata plugin and enables the direct Cloudflare target; use the deployment command to ensure the correct output is built before upload.

References:

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Live deployment

- URL: https://henokabraham-com.henok37.workers.dev
- Worker: `henokabraham-com`
- Cloudflare version: `f8d02e53-6452-40a4-a1f2-5ffd7e8c57af`
- Verification: the live homepage returns HTTP 200; sampled aircraft, terrain manifest, terrain tile, atmosphere lookup and compressed city assets match the local files.
- Authentication for the initial upload was passed through process memory; the Global API Key was not written into the repository or credential file.
