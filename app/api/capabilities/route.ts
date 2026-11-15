import { NextResponse } from 'next/server';
import { resolveServerCapabilities } from '@/server/capabilities-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const payload = await resolveServerCapabilities();
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
