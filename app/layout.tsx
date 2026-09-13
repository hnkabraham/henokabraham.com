import type { Metadata } from 'next';
import './globals.css';
import './bay-departure.css';
import './airport-services.css';

// The aircraft and its lighting are fetched by the scene itself once it has
// decided to run, so visitors on reduced motion or a metered connection
// download neither. A document preload would fetch them for everyone.
const title = 'Henok Abraham — Personal Airspace';
const summary =
  'iOS apps, flight tracking, connected hardware, and things worth building.';
const card = {
  url: '/images/og-card.jpg',
  width: 1200,
  height: 630,
  alt: 'A Boeing 787-9 in Henok Abraham’s livery above a cloud deck',
};
export const metadata: Metadata = {
  metadataBase: new URL('https://henokabraham.com'),
  alternates: { canonical: '/' },
  // Messages and Safari take the 180 px touch icon for their small previews.
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  title,
  description:
    'Welcome to the personal airspace of Henok Abraham. An aviation-inspired journey through iOS apps, flight tracking, connected hardware, and curious experiments.',
  openGraph: {
    title,
    description: summary,
    siteName: 'Henok Abraham',
    locale: 'en_US',
    type: 'website',
    url: '/',
    images: [card],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description: summary,
    images: [card.url],
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
      <body>{children}</body>
    </html>
  );
}
