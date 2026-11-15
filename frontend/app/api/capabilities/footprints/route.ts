import { NextResponse } from 'next/server';
import { getVerifiedCapabilityFootprints } from '@/server/capability-overlay-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const payload = await getVerifiedCapabilityFootprints();
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
