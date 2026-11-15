import { NextRequest, NextResponse } from 'next/server';
import { AnalysisJobTriggerRequestSchema } from '@/domain/farmer-ux-contracts';
import { createAndDispatchAnalysisJob } from '@/server/analysis-job-store';

export const dynamic = 'force-dynamic';

const FARM_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  const { farmId } = await context.params;
  if (!FARM_ID_PATTERN.test(farmId)) {
    return NextResponse.json(
      { ok: false, reason: 'Invalid farmId format.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Request body must be valid JSON.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const parsed = AnalysisJobTriggerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        reason: parsed.error.issues[0]?.message ?? 'Invalid analysis request payload.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (parsed.data.farmId !== farmId) {
    return NextResponse.json(
      { ok: false, reason: 'Body farmId mismatches route farmId.' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const job = await createAndDispatchAnalysisJob(farmId, parsed.data);
  return NextResponse.json(
    { ok: job.status !== 'FAILED', job },
    {
      status: job.status === 'QUEUED' ? 202 : job.status === 'FAILED' ? 502 : 200,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    }
  );
}
