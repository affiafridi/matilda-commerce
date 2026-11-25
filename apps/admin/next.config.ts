import type { NextConfig } from 'next';

/** Server-side address of the API (never exposed to the browser). */
const API_ORIGIN = (process.env.API_INTERNAL_URL?.trim() || 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The end-to-end run uses its own build folder so it can run beside `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Same-origin proxy (decision D2-02): the browser only talks to the admin's own origin, so the
  // session cookie stays host-only and the API's Origin allow-list still sees the admin origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/((?!_next/static|_next/image).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
