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

// Defensive cleanup: unregister any stale service workers and clear all caches
// the first time each browser tab loads. This fixes the Chrome-vs-Edge / mobile
// inconsistency where one browser had a stale SW intercepting fetches and
// serving outdated chunks. Idempotent — safe to run every page load.
const browserCleanupScript = `
(function(){
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs){
        regs.forEach(function(r){ try { r.unregister(); } catch(_){} });
      }).catch(function(){});
    }
    if (typeof caches !== 'undefined' && caches && caches.keys) {
      caches.keys().then(function(keys){
        keys.forEach(function(k){ try { caches.delete(k); } catch(_){} });
      }).catch(function(){});
    }
  } catch(_) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: browserCleanupScript }} />
      </head>
      <body className="font-sans antialiased text-slate-800 bg-slate-50 selection:bg-brand-200 selection:text-brand-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
