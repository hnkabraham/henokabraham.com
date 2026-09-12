import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
if (process.argv.slice(2).some((arg) => arg !== '--dry-run')) {
  throw new Error('Usage: node scripts/deploy-cloudflare.mjs [--dry-run]');
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const localFile = resolve(root, '.env.cloudflare.local');
let credentials;
if (!dryRun) {
  const local = existsSync(localFile)
    ? parseEnv(readFileSync(localFile, 'utf8'))
    : {};
  const token = process.env.CLOUDFLARE_API_TOKEN || local.CLOUDFLARE_API_TOKEN;
  const apiKey = process.env.CLOUDFLARE_API_KEY || local.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL || local.CLOUDFLARE_EMAIL;
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID || local.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '')) {
    throw new Error(
      'Set a 32-character CLOUDFLARE_ACCOUNT_ID before deploying.',
    );
  }
  if (token?.startsWith('cfk_')) {
    throw new Error(
      'Global API Keys use CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL, not CLOUDFLARE_API_TOKEN.',
    );
  }
  if (token) {
    credentials = {
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: accountId,
    };
  } else if (apiKey && email) {
    credentials = {
      CLOUDFLARE_API_KEY: apiKey,
      CLOUDFLARE_EMAIL: email,
      CLOUDFLARE_ACCOUNT_ID: accountId,
    };
  } else {
    throw new Error(
      'Set CLOUDFLARE_API_TOKEN, or CLOUDFLARE_API_KEY together with CLOUDFLARE_EMAIL, before deploying.',
    );
  }
}

// Deployment credentials are only supplied to Wrangler, never to the build.
const buildEnv = {
  ...process.env,
  DEPLOY_TARGET: 'cloudflare',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: resolve(root, '.wrangler/logs'),
};
for (const key of [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_TOKEN',
  'CF_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CF_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
]) {
  delete buildEnv[key];
}
run('npm', ['run', 'build:cloudflare'], buildEnv);

const configPath = resolve(root, 'dist/server/wrangler.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (
  config.name !== 'henokabraham-com' ||
  config.workers_dev !== true ||
  !config.compatibility_flags?.includes('global_fetch_strictly_public') ||
  !config.assets?.directory
) {
  throw new Error('Unexpected Worker build target. Deployment stopped.');
}
if (
  config.d1_databases?.length !== 1 ||
  config.d1_databases[0].database_id !==
    '1ce8af41-87e5-4f67-b06f-76fc50cce697' ||
  config.d1_databases[0].binding !== 'FLIGHT_STATS' ||
  config.r2_buckets?.length
) {
  throw new Error(
    'Unexpected database or object storage binding. Deployment stopped.',
  );
}
if (
  config.kv_namespaces?.length !== 1 ||
  config.kv_namespaces[0].id !== '8936ecfe40dd4fc9a30d109c058baf60' ||
  config.kv_namespaces[0].binding !== 'LIVE_DATA'
)
  throw new Error('Unexpected live-data namespace.');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const args = [wrangler, 'deploy', '--config', configPath];
if (dryRun) args.push('--dry-run');
run(process.execPath, args, { ...buildEnv, ...credentials });
