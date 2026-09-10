import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Shows, and with --apply sets, the zone settings that affect the opening's
// load: Bot Fight Mode and JavaScript Detections off, Smart Tiered Cache on,
// Early Hints on. Credentials come from .env.cloudflare.local or the
// environment and are never printed. Usage: node scripts/cloudflare-zone.mjs [--apply]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('Usage: node scripts/cloudflare-zone.mjs [--apply]');
const localFile = resolve(root, '.env.cloudflare.local');
const local = existsSync(localFile)
  ? parseEnv(readFileSync(localFile, 'utf8'))
  : {};
const get = (key) => process.env[key] || local[key];
const headers = { 'Content-Type': 'application/json' };
if (get('CLOUDFLARE_API_KEY') && get('CLOUDFLARE_EMAIL')) {
  headers['X-Auth-Key'] = get('CLOUDFLARE_API_KEY');
  headers['X-Auth-Email'] = get('CLOUDFLARE_EMAIL');
} else if (get('CLOUDFLARE_API_TOKEN')) {
  headers.Authorization = `Bearer ${get('CLOUDFLARE_API_TOKEN')}`;
} else {
  throw new Error(
    'Set CLOUDFLARE_API_KEY with CLOUDFLARE_EMAIL, or CLOUDFLARE_API_TOKEN, in .env.cloudflare.local.',
  );
}
const api = async (path, init = {}) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers,
  });
  const body = await response.json();
  if (!body.success)
    throw new Error(`${path}: ${JSON.stringify(body.errors ?? body)}`);
  return body.result;
};
const zones = await api('/zones?name=henokabraham.com');
if (!zones?.length) throw new Error('Zone henokabraham.com not found');
const zone = zones[0].id;
const show = async (label) => {
  const bots = await api(`/zones/${zone}/bot_management`);
  const tiered = await api(
    `/zones/${zone}/cache/tiered_cache_smart_topology_enable`,
  );
  const hints = await api(`/zones/${zone}/settings/early_hints`);
  console.log(label, {
    botFightMode: bots.fight_mode,
    javascriptDetections: bots.enable_js,
    aiBotsProtection: bots.ai_bots_protection,
    smartTieredCache: tiered.value,
    earlyHints: hints.value,
  });
  return bots;
};
const bots = await show(apply ? 'Before:' : 'Current:');
if (!apply) process.exit(0);
await api(`/zones/${zone}/bot_management`, {
  method: 'PUT',
  body: JSON.stringify({
    fight_mode: false,
    enable_js: false,
    ai_bots_protection: bots.ai_bots_protection ?? 'block',
    crawler_protection: bots.crawler_protection ?? 'disabled',
  }),
});
await api(`/zones/${zone}/cache/tiered_cache_smart_topology_enable`, {
  method: 'PATCH',
  body: JSON.stringify({ value: 'on' }),
});
await api(`/zones/${zone}/settings/early_hints`, {
  method: 'PATCH',
  body: JSON.stringify({ value: 'on' }),
});
await show('After:');
