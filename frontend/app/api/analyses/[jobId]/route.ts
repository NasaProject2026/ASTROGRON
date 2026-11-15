import { NextRequest, NextResponse } from 'next/server';
import { cancelAnalysisJob, getAnalysisJob } from '@/server/analysis-job-store';

export const dynamic = 'force-dynamic';

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{4,100}$/;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json(
      { ok: false, reason: 'Invalid jobId format.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const job = getAnalysisJob(jobId);
  if (!job) {
    return NextResponse.json(
      {
        ok: false,
        status: 'UNAVAILABLE',
        reason: 'Job record was not found or server instance restarted.',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { ok: true, job },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await context.params;
  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json(
      { ok: false, reason: 'Invalid jobId format.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const cancelled = cancelAnalysisJob(jobId);
  if (!cancelled) {
    return NextResponse.json(
      { ok: false, reason: 'Job not found.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { ok: true, job: cancelled },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
