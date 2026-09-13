import type { Metadata } from 'next';
import './globals.css';
import './bay-departure.css';
import './airport-services.css';
import { sceneAsset } from '@/lib/scene-assets';

// The opening scene's first fetches start with the document instead of
// after the module chain has run, at low priority so they fill the bandwidth
// the module scripts leave rather than delaying them. Visitors who get the
// static view (reduced motion) skip them through the media query.
const OPENING_ASSETS: [string, 'fetch' | 'image'][] = [
  ['/models/dreamliner-787-9.glb', 'fetch'],
  ['/scenery/daylight.hdr', 'fetch'],
];
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: 'Henok Abraham — Personal Airspace',
  description:
    'Welcome to the personal airspace of Henok Abraham. An aviation-inspired journey through iOS apps, flight tracking, connected hardware, and curious experiments.',
  openGraph: {
    title: 'Henok Abraham — Personal Airspace',
    description:
      'iOS apps, flight tracking, connected hardware, and things worth building.',
    type: 'website',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <link
        rel="preload"
        href="/fonts/google-sans-regular-7d5c767caf2d.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      {OPENING_ASSETS.map(([path, as]) => (
        <link
          key={path}
          rel="preload"
          href={sceneAsset(path)}
          as={as}
          crossOrigin="anonymous"
          fetchPriority="low"
          media="(prefers-reduced-motion: no-preference)"
        />
      ))}
      <body>{children}</body>
    </html>
  );
}
