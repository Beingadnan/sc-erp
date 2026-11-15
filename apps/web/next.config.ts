import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Baseline security headers. A nonce-based Content-Security-Policy is added in Phase 2
 * together with authentication (see docs/security/threat-model.md).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@school-erp/validation'],
  // The browser talks to the API through this origin, so session cookies are first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
