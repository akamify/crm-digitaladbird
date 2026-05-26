/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    typedRoutes: false,
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'date-fns',
      '@tanstack/react-query',
      'react-hot-toast',
      'socket.io-client',
    ],
    serverComponentsExternalPackages: ['ws'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ 'bufferutil': 'bufferutil', 'utf-8-validate': 'utf-8-validate' });
    }
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    return config;
  },
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
  },
};
module.exports = nextConfig;
