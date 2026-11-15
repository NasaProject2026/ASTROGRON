import { NextRequest, NextResponse } from 'next/server';
import { ReportEnvelopeSchema } from '@/domain/farmer-ux-contracts';
import { buildReportPdfBytes, type PdfUnitMode } from '@/lib/pdf-report';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'Invalid JSON body.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const body = (raw ?? {}) as { report?: unknown; unitMode?: unknown };
  const parsed = ReportEnvelopeSchema.safeParse(body.report);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: `Malformed report payload: ${parsed.error.issues[0]?.message ?? 'schema check failed'}` },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const unitMode: PdfUnitMode =
    body.unitMode === 'SI_WITH_ACRE_GALLON_EQUIV' ? 'SI_WITH_ACRE_GALLON_EQUIV' : 'SI_METRIC';

  const pdfBytes = buildReportPdfBytes(parsed.data, unitMode);
  const safeSlug = parsed.data.farmId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40) || 'farm';
  const fileName = `astragron-report-${safeSlug}-${parsed.data.reportId.slice(0, 12)}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(pdfBytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
