import { env } from 'cloudflare:workers';
import type { Metadata } from 'next';
import type { EdgeEnv } from '@/server/api';
import { readLiveFeed, type LiveFeed } from '@/server/live';
import { flights } from './flight-data';
import TerminalExperience from './terminal-experience';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
// The board row a `?project=` link names, or the first row.
const sharedProject = async (searchParams: SearchParams) => {
  const id = (await searchParams).project;
  return Math.max(
    0,
    flights.findIndex((flight) => flight.id === id),
  );
};

// A shared project link previews as that project, with its own capture where
// it has one; the home page keeps the layout's card.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const id = (await searchParams).project;
  const flight = flights.find((item) => item.id === id);
  if (!flight) return {};
  const title = `${flight.name} — Henok Abraham`;
  const images = flight.preview
    ? [{ url: flight.preview.src, alt: flight.preview.alt }]
    : undefined;
  return {
    title,
    description: flight.story,
    openGraph: {
      title,
      description: flight.summary,
      url: `/?project=${flight.id}`,
      ...(images ? { images } : {}),
    },
    twitter: {
      title,
      description: flight.summary,
      ...(images ? { images } : {}),
    },
  };
}

// The project checks are read with the page rather than fetched after it, so
// the cards above the contact form have their final height when the browser
// aims a link such as /#contact; arriving later, they used to add about 100 px
// above the form mid-scroll and leave it short. The page is rendered on every
// request (nothing caches the document), so the snapshot is the cron's latest.
// What search engines may attach to the name and the site; only facts the
// page states. Here rather than in the layout, so the 404 page doesn't
// describe itself as the home page.
const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Henok Abraham',
    url: 'https://henokabraham.com/',
    description: 'Builds iOS apps, connected devices, and aviation data sites.',
    sameAs: ['https://github.com/hnkabraham'],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Henok Abraham',
    alternateName: 'Personal Airspace',
    url: 'https://henokabraham.com/',
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const initialProject = await sharedProject(searchParams);
  let live: LiveFeed | null = null;
  try {
    live = await readLiveFeed((env as EdgeEnv).LIVE_DATA);
  } catch {
    // The client asks /api/live instead.
  }
  return (
    <>
      <TerminalExperience live={live} initialProject={initialProject} />
      <script
        type="application/ld+json"
        // Structured data is inert: the browser never runs it.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </>
  );
}
