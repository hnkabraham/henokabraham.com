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
export type LiveFeed = {
  projects: { checkedAt: string; projects: ProjectLive[] } | null;
};
/** The scheduled checks' last snapshot, as /api/live serves it. */
export async function readLiveFeed(store?: LiveStore): Promise<LiveFeed> {
  return {
    projects: store ? await store.get('projects:v1', 'json') : null,
  };
}
const headers = {
  'User-Agent': 'HenokAbraham-Portfolio/1.0 (https://henokabraham.com)',
  Accept: 'application/json',
};
async function json(url: string, sent: Record<string, string>) {
  const r = await fetch(url, {
    headers: sent,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`Upstream HTTP ${r.status}`);
  }
  return r.json();
}
export const repositories = [
  { id: 'wear-bridge', repo: 'wear-ios-bridge' },
  { id: 'obd-engine', repo: 'swift-obd-engine' },
  { id: 'mobile-mode', repo: 'claude-code-mobile-mode' },
  { id: 'ct45-link', repo: 'CT45-Computer-Link' },
];
export async function refreshProjects(store: LiveStore, token?: string) {
  const checkedAt = new Date().toISOString();
  // Without a token GitHub counts every Worker on Cloudflare's shared
  // addresses together against 60 requests an hour, and they run out: the
  // cards' "temporarily unavailable". A token (secret GITHUB_TOKEN, no
  // scopes needed for public repositories) has 5,000 of its own.
  const github: Record<string, string> = token
    ? { ...headers, Authorization: `Bearer ${token}` }
    : headers;
  let previous: ProjectLive[] = [];
  try {
    const saved = await store.get('projects:v1');
    if (saved)
      previous =
        (JSON.parse(saved) as { projects?: ProjectLive[] }).projects ?? [];
  } catch {
    /* No earlier snapshot to fall back on. */
  }
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
          github,
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
          { headers: github, signal: AbortSignal.timeout(8000) },
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
      } catch (error) {
        // Say why (403 is the rate limit), and keep what was last known
        // rather than blanking the card until a check gets through.
        console.warn('project_metadata_unavailable', {
          repo,
          reason: error instanceof Error ? error.message : String(error),
        });
        const known = previous.find(
          (project) => project.id === id && project.metadataAvailable,
        );
        if (known) return { ...known, checkedAt };
      }
      return item;
    }),
  );
  const websites = await Promise.all(
    [
      { id: 'bay-departure', url: 'https://henokabraham.com/' },
      { id: 'flight-tracker', url: 'https://unitedflighttracker.com/' },
      { id: 'routeloads', url: 'https://routeloads.com/' },
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
// The scheduled handler's entry point: the project checks are the only
// feed left (the KSFO weather panel was removed in September 2026).
export async function refreshLiveData(store: LiveStore, token?: string) {
  try {
    return await refreshProjects(store, token);
  } catch {
    console.warn('live_refresh_failed', { feed: 'projects' });
    return null;
  }
}
