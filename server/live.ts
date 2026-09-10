export type Weather = {
  station: string;
  observedAt: string;
  fetchedAt: string;
  temperatureC: number | null;
  windDegrees: number | null;
  windKnots: number | null;
  gustKnots: number | null;
  visibilityMiles: string | null;
  category: string | null;
  clouds: string | null;
  raw: string;
};
export type ProjectLive = {
  id: string;
  repo?: string;
  checkedAt: string;
  reachable?: boolean | null;
  updatedAt?: string;
  release?: { name: string; url: string; publishedAt: string };
  metadataAvailable?: boolean;
};
export type LiveStore = Pick<KVNamespace, 'get' | 'put'>;
const headers = {
  'User-Agent': 'HenokAbraham-Portfolio/1.0 (https://henokabraham.com)',
  Accept: 'application/json',
};
const finite = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parseWeather(data: unknown, now = new Date()): Weather {
  const r = Array.isArray(data) ? data.find((v) => v?.icaoId === 'KSFO') : null;
  if (!r || !Number.isFinite(r.obsTime) || !r.rawOb)
    throw new Error('Missing KSFO observation');
  const observedAt = new Date(r.obsTime * 1000);
  if (observedAt.getTime() > now.getTime() + 10 * 60000)
    throw new Error('Future observation');
  return {
    station: 'KSFO',
    observedAt: observedAt.toISOString(),
    fetchedAt: now.toISOString(),
    temperatureC: finite(r.temp),
    windDegrees: finite(r.wdir),
    windKnots: finite(r.wspd),
    gustKnots: finite(r.wgst),
    visibilityMiles:
      typeof r.visib === 'string' || typeof r.visib === 'number'
        ? String(r.visib)
        : null,
    category: ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(r.fltCat)
      ? r.fltCat
      : null,
    clouds: typeof r.cover === 'string' ? r.cover : null,
    raw: String(r.rawOb).slice(0, 1200),
  };
}
async function json(url: string) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`Upstream HTTP ${r.status}`);
  }
  return r.json();
}
export async function refreshWeather(store: LiveStore) {
  const weather = parseWeather(
    await json(
      'https://aviationweather.gov/api/data/metar?ids=KSFO&format=json',
    ),
  );
  await store.put('weather:v1', JSON.stringify(weather), {
    expirationTtl: 86400,
  });
  return weather;
}
export const repositories = [
  { id: 'wear-bridge', repo: 'wear-ios-bridge' },
  { id: 'obd-engine', repo: 'swift-obd-engine' },
  { id: 'mobile-mode', repo: 'claude-code-mobile-mode' },
];
export async function refreshProjects(store: LiveStore) {
  const checkedAt = new Date().toISOString();
  const projects: ProjectLive[] = await Promise.all(
    repositories.map(async ({ id, repo }) => {
      const item: ProjectLive = {
        id,
        repo,
        checkedAt,
        metadataAvailable: false,
      };
      try {
        const r = (await json(
          `https://api.github.com/repos/hnkabraham/${repo}`,
        )) as Record<string, unknown>;
        if (r.private !== false || r.full_name !== `hnkabraham/${repo}`)
          return item;
        if (
          typeof r.pushed_at === 'string' &&
          Number.isFinite(Date.parse(r.pushed_at))
        )
          item.updatedAt = r.pushed_at;
        item.metadataAvailable = true;
        // 404 is normal for a public repository with no published release.
        const releaseResponse = await fetch(
          `https://api.github.com/repos/hnkabraham/${repo}/releases/latest`,
          { headers, signal: AbortSignal.timeout(8000) },
        );
        if (releaseResponse.ok) {
          const release = (await releaseResponse.json()) as Record<
            string,
            unknown
          >;
          if (
            typeof release.html_url === 'string' &&
            release.html_url.startsWith(
              `https://github.com/hnkabraham/${repo}/releases/`,
            ) &&
            typeof release.published_at === 'string'
          ) {
            item.release = {
              name: String(release.tag_name).slice(0, 80),
              url: release.html_url,
              publishedAt: release.published_at,
            };
          }
        } else await releaseResponse.body?.cancel();
      } catch {
        /* Preserve the authored project even when GitHub is unavailable. */
      }
      return item;
    }),
  );
  const websites = await Promise.all(
    [
      { id: 'bay-departure', url: 'https://henokabraham.com/' },
      { id: 'flight-tracker', url: 'https://unitedflighttracker.com/' },
    ].map(async ({ id, url }) => {
      let reachable: boolean | null = null;
      try {
        const r = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': headers['User-Agent'] },
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        // A blocked automated check does not establish that a site is down.
        reachable = r.ok ? true : r.status >= 500 ? false : null;
        await r.body?.cancel();
      } catch {
        reachable = null;
      }
      return { id, checkedAt, reachable };
    }),
  );
  const snapshot = { checkedAt, projects: [...projects, ...websites] };
  await store.put('projects:v1', JSON.stringify(snapshot), {
    expirationTtl: 7 * 86400,
  });
  return snapshot;
}
export async function refreshLiveData(store: LiveStore) {
  const results = await Promise.allSettled([
    refreshWeather(store),
    refreshProjects(store),
  ]);
  results.forEach((result, i) => {
    if (result.status === 'rejected')
      console.warn('live_refresh_failed', {
        feed: i === 0 ? 'weather' : 'projects',
      });
  });
  return results;
}
