import { NextRequest, NextResponse } from 'next/server';
import { ReportEnvelopeSchema } from '@/domain/farmer-ux-contracts';
import {
  getPersistedReport,
  listPersistedReports,
  upsertPersistedReport,
} from '@/server/persisted-runtime-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const reportId = params.get('reportId')?.trim();
  if (reportId) {
    const report = getPersistedReport(reportId);
    if (!report) {
      return NextResponse.json(
        { ok: false, reason: 'Report not found.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: true, report },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const farmId = params.get('farmId')?.trim() || undefined;
  const reports = listPersistedReports(farmId);
  return NextResponse.json(
    { ok: true, reports },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Request body must be valid JSON.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const candidate =
    raw && typeof raw === 'object' && 'report' in (raw as Record<string, unknown>)
      ? (raw as { report: unknown }).report
      : raw;

  const parsed = ReportEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: parsed.error.issues[0]?.message ?? 'Invalid report envelope.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const saved = upsertPersistedReport(parsed.data);
  return NextResponse.json(
    { ok: true, report: saved },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}
