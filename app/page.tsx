import { env } from 'cloudflare:workers';
import type { EdgeEnv } from '@/server/api';
import { readLiveFeed, type LiveFeed } from '@/server/live';
import TerminalExperience from './terminal-experience';

// The project checks are read with the page rather than fetched after it, so
// the cards above the contact form have their final height when the browser
// aims a link such as /#contact; arriving later, they used to add about 100 px
// above the form mid-scroll and leave it short. The page is rendered on every
// request (nothing caches the document), so the snapshot is the cron's latest.
export default async function Home() {
  let live: LiveFeed | null = null;
  try {
    live = await readLiveFeed((env as EdgeEnv).LIVE_DATA);
  } catch {
    // The client asks /api/live instead.
  }
  return <TerminalExperience live={live} />;
}
