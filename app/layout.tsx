import type { Metadata } from 'next';
import './globals.css';
import './bay-departure.css';
import './airport-services.css';

// The aircraft and its lighting are fetched by the scene itself once it has
// decided to run, so visitors on reduced motion or a metered connection
// download neither. A document preload would fetch them for everyone.
const title = 'Henok Abraham — Personal Airspace';
// Sampled from the opening sky under the header, so Safari's tab bar and
// Android's toolbar continue the sky instead of framing it in white.
const skyColor = '#6398cf';
// Edge to edge on phones: the page extends under the notch and the home
// indicator (the stylesheets keep controls inside the safe areas), and from
// the Home Screen it opens without browser chrome behind a translucent
// status bar.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: skyColor,
};
// What search engines may attach to the name; only facts the page states.
const person = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Henok Abraham',
  url: 'https://henokabraham.com/',
  description: 'I build apps, connect devices, and make things in 3D.',
  sameAs: ['https://github.com/hnkabraham'],
};
const summary =
  'iOS apps, flight tracking, connected hardware, and things worth building.';
const card = {
  url: '/images/og-card.jpg',
  width: 1200,
  height: 630,
  alt: 'Looking up the tailpipe of a Boeing 787-9 engine as it passes above a cloud deck',
};
export const metadata: Metadata = {
  metadataBase: new URL('https://henokabraham.com'),
  alternates: { canonical: '/' },
  // Messages and Safari take the 180 px touch icon for their small previews.
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
  manifest: '/site.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Henok Abraham',
    statusBarStyle: 'black-translucent',
  },
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
      {/* The framework writes the standard name; iOS still reads this one. */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <link
        rel="preload"
        href="/fonts/google-sans-regular-7d5c767caf2d.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <body>
        {children}
        <script
          type="application/ld+json"
          // Structured data is inert: the browser never runs it.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(person) }}
        />
      </body>
    </html>
  );
}
