import { NextRequest, NextResponse } from 'next/server';
import { querySuggestedFieldBoundaries } from '@/server/ftw-boundary-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lonRaw = sp.get('lon');
  const latRaw = sp.get('lat');
  const yearRaw = sp.get('year');

  const lon = lonRaw !== null ? Number(lonRaw) : NaN;
  const lat = latRaw !== null ? Number(latRaw) : NaN;
  const year = yearRaw !== null && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;

  const outcome = await querySuggestedFieldBoundaries(lon, lat, year);
  return NextResponse.json(outcome, {
    status: outcome.httpStatus,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
