import { NextRequest, NextResponse } from 'next/server';
import { performServerGeocodeSearch } from '@/server/geocode-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? '';
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local-client';
  const outcome = await performServerGeocodeSearch(query, forwardedFor);

  return NextResponse.json(
    {
      ok: outcome.ok,
      status: outcome.status,
      providerHost: outcome.providerHost,
      providerKind: outcome.providerKind,
      providerTier: outcome.providerTier,
      attribution: outcome.attribution,
      results: outcome.results,
      notice: outcome.notice,
    },
    {
      status: outcome.httpStatus,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
