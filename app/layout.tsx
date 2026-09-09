import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './departure.css';
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
