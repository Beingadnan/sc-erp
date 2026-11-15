import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * In production the API is a separate Vercel project. Requests to /api/* are forwarded to it
 * from here (same origin for the browser, so session cookies stay first-party), together with
 * the visitor's IP and a shared secret, so the API's rate limits and audit log see the real
 * visitor instead of this server. Without PROXY_SHARED_SECRET (local dev) the plain rewrite in
 * next.config.ts is used.
 */
export function proxy(request: NextRequest) {
  const secret = process.env.PROXY_SHARED_SECRET;
  const apiUrl = process.env.API_URL;
  if (!secret || !apiUrl) return NextResponse.next();

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, apiUrl);
  const headers = new Headers(request.headers);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('x-erp-client-ip', ip);
  headers.set('x-erp-proxy-secret', secret);
  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = { matcher: '/api/:path*' };
