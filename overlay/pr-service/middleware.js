import { NextResponse } from 'next/server';
import { resolveCorsOrigin } from './lib/extensions.js';

/**
 * CORS for the API.
 *
 * The allowlist is built from ALLOWED_EXTENSION_IDS. Requests from an origin
 * that is not on it get no Access-Control-Allow-Origin header, so the browser
 * discards the response — previously every origin was allowed via '*'.
 */
export function middleware(request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = resolveCorsOrigin(origin);

  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (request.method === 'OPTIONS') {
    // Preflight from a disallowed origin: answer without the allow header so
    // the browser blocks the real request.
    return new NextResponse(null, { status: allowedOrigin ? 204 : 403, headers });
  }

  const response = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
