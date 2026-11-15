import { NextResponse, type NextRequest } from 'next/server';
import { configuredPublicOrigin, sessionId } from '@/server/core-backend';

// The public tunnel terminates at Next.js only. Protect legacy V7 API routes too;
// the D gateway additionally enforces per-session ownership and same-origin POSTs.
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (['/', '/explore', '/research', '/help', '/methodology', '/api/core/session', '/api/public-demo'].includes(pathname)) return NextResponse.next();
  try {
    sessionId(request);
    if (process.env.ASTRAGRON_BACKEND_PROTOCOL === 'D_V1' &&
        ['/api/farms', '/api/analyses', '/api/reports'].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) {
      return NextResponse.json({ error: 'LEGACY_SHARED_STORAGE_DISABLED',
        reason: 'Farm drafts stay on this device. Use Research Workspace for session-owned scientific analyses and reports.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/') || pathname.startsWith('/v1/') || pathname === '/ready') {
      return NextResponse.json({ error: 'LOCAL_ACCESS_REQUIRED' }, { status: 401,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const publicOrigin = configuredPublicOrigin();
    const throughTunnel = request.headers.has('cf-connecting-ip') && request.headers.get('x-forwarded-proto') === 'https';
    const origin = throughTunnel && publicOrigin ? publicOrigin : new URL(request.url).origin;
    const response = NextResponse.redirect(new URL('/research', origin), 307);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|assets/|geodata/|workers/|orbit-ab-assets/|icon.svg|favicon.ico).*)'],
};
