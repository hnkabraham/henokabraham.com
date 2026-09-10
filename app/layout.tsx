import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './bay-departure.css';
import './airport-services.css';
import { sceneAsset } from '@/lib/scene-assets';

// The opening scene's first fetches start with the document instead of
// after the module chain has run, at low priority so they fill the bandwidth
// the module scripts leave rather than delaying them. Visitors who get the
// static view (reduced motion) skip them through the media query.
const OPENING_ASSETS: [string, 'fetch' | 'image'][] = [
  ['/models/boeing-787-9.glb', 'fetch'],
  ['/scenery/bay-elevation.webp', 'fetch'],
  ['/tiles/manifest.json', 'fetch'],
  ['/scenery/sfo-buildings.json', 'fetch'],
  ['/scenery/sfo-airfield.json', 'fetch'],
  ['/scenery/sf-bay-mobile.webp', 'image'],
  ['/scenery/runway-color.webp', 'image'],
  ['/scenery/runway-normal.webp', 'image'],
  ['/scenery/runway-roughness.webp', 'image'],
];
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
