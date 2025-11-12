import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scharade Posts',
  description: 'Blog detail pages served by Next.js'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
