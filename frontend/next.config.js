// Stable, deterministic build ID — when the source changes, this changes;
// when nothing changes, identical chunk URLs come out and existing caches stay valid.
// Falls back to a timestamped ID for local dev builds without git.
function deterministicBuildId() {
  try {
    const { execSync } = require('child_process');
    const sha = execSync('git rev-parse HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (sha) return sha.slice(0, 12);
  } catch (_) { /* fall through */ }
  return `build-${Date.now()}`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  generateBuildId: () => deterministicBuildId(),
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
      // Default: all HTML pages must always re-validate so a deploy is picked up
      // immediately across Chrome / Edge / Safari / mobile. Without this, browsers
      // use heuristic caching that differs per vendor and shows stale UI.
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      // Fingerprinted static chunks — safe to cache forever (filename changes with build ID).
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
      // API responses are dynamic.
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
      // Service-worker kill script: never let any browser cache this — it must be
      // re-fetched fresh so the unregister logic runs.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
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
