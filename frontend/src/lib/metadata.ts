import type { Metadata } from 'next';

export const siteTitle = 'DigitalADbird CRM';
export const siteDescription = 'Lead distribution & sales CRM for performance marketing teams.';
export const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://digitaladbird.com';
export const siteImage = '/logo.png';

export const defaultMetadata: Metadata = {
  title: {
    default: siteTitle,
    template: '%s · DigitalAdBird CRM',
  },
  description: siteDescription,
  applicationName: siteTitle,
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: siteUrl,
    siteName: siteTitle,
    type: 'website',
    images: [siteImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: [siteImage],
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.svg', sizes: '180x180', type: 'image/svg+xml' }],
  },
  manifest: '/manifest.webmanifest',
  formatDetection: {
    telephone: false,
  },
  themeColor: '#3B82F6',
};

export function pageMetadata(title: string, description: string, path = '/') {
  const titleText = title ? `${title} · DigitalADbird CRM` : siteTitle;
  return {
    title: title
      ? {
          default: title,
          template: '%s · DigitalADbird CRM',
        }
      : defaultMetadata.title,
    description: description || siteDescription,
    openGraph: {
      title: titleText,
      description: description || siteDescription,
      url: new URL(path, siteUrl).toString(),
      siteName: siteTitle,
      type: 'website',
      images: [siteImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: titleText,
      description: description || siteDescription,
      images: [siteImage],
    },
  };
}
