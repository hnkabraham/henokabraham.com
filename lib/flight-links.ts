import { BAY_CHAPTERS, type BayPhase } from './bay-flight';

export function readFlightLink(url: URL, projectIds: string[]) {
  const project = url.searchParams.get('project');
  const chapter = BAY_CHAPTERS.find(
    (item) => item.phase === url.searchParams.get('chapter'),
  );
  return {
    project: project && projectIds.includes(project) ? project : null,
    chapter: chapter?.phase ?? null,
  };
}

export function flightLink(
  url: URL,
  values: { project?: string; chapter?: BayPhase },
) {
  const next = new URL(url);
  if (values.project) next.searchParams.set('project', values.project);
  if (values.chapter) next.searchParams.set('chapter', values.chapter);
  // Section anchors are useful for native navigation but redundant in a
  // shared chapter link. Keep unrelated query parameters and anchors intact.
  if (next.hash === '#flight' || next.hash === '#departures') next.hash = '';
  return `${next.pathname}${next.search}${next.hash}`;
}

export function replaceFlightLink(values: {
  project?: string;
  chapter?: BayPhase;
}) {
  const next = flightLink(new URL(window.location.href), values);
  if (next !== `${location.pathname}${location.search}${location.hash}`)
    history.replaceState(history.state, '', next);
}
