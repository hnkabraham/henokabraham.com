import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: 'Henok Abraham — Built from curiosity',
  description:
    'The personal workshop of Henok Abraham. iOS apps, flight tracking, connected hardware, and software built from curiosity.',
  openGraph: {
    title: 'Henok Abraham — Built from curiosity',
    description:
      'iOS apps, flight tracking, connected hardware, and things worth building.',
    type: 'website',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
