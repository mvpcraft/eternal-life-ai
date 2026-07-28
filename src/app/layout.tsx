import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Eternal Life AI - chat in their voice',
  description:
    'Upload chat screenshots and talk to an AI that writes the way they did.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
