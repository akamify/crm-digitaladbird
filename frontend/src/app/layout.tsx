import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: {
    default: 'DigitalADbird CRM',
    template: '%s · DigitalADbird CRM',
  },
  description: 'Lead distribution & sales CRM for performance marketing teams.',
  applicationName: 'DigitalADbird CRM',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased text-slate-800 bg-slate-50 selection:bg-brand-200 selection:text-brand-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
