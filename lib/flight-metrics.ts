export type EdgeConfig = {
  contactEnabled: boolean;
  turnstileSiteKey: string | null;
  analyticsToken: string | null;
  metricsEnabled: boolean;
};
let configRequest: Promise<EdgeConfig> | undefined;
export function edgeConfig() {
  return (configRequest ??= fetch('/api/config', {
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => {
      if (!r.ok) throw new Error('Services unavailable');
      return r.json() as Promise<EdgeConfig>;
    })
    .catch((error) => {
      configRequest = undefined;
      throw error;
    }));
}
export function measurementAllowed() {
  return (
    typeof window !== 'undefined' &&
    navigator.doNotTrack !== '1' &&
    !(navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl
  );
}
const counts = new Map<string, number>();
export function recordFlightMetric(
  event:
    | 'scene_ready_ms'
    | 'scene_unavailable'
    | 'scene_fps'
    | 'scene_asset_failure'
    | 'project_open',
  value: number,
) {
  if (!measurementAllowed()) return;
  const count = counts.get(event) || 0;
  if (
    count >=
    (event === 'scene_asset_failure' ? 3 : event === 'project_open' ? 10 : 1)
  )
    return;
  counts.set(event, count + 1);
  const body = JSON.stringify({
    event,
    value: Math.round(value * 10) / 10,
    device: innerWidth < 800 ? 'phone' : 'desktop',
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  void edgeConfig()
    .then((config) => {
      if (config.metricsEnabled && measurementAllowed())
        return fetch('/api/metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
    })
    .catch(() => {});
}
