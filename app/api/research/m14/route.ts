import { NextRequest, NextResponse } from 'next/server';
import { loadAndVerifyStagedCorpora } from '@/server/corpus-integrity';

export const dynamic = 'force-dynamic';

const SITE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CANONICAL_ALIAS_MAP: Record<string, string> = {
  SE_UPPSALA: 'uppsala-demo',
  KE_NYERI_REGION: 'nyeri-kenya',
  AU_WAGGA_REGION: 'wagga-australia',
};

export async function GET(request: NextRequest) {
  const rawSiteId = request.nextUrl.searchParams.get('siteId') ?? 'uppsala-demo';
  if (!SITE_ID_PATTERN.test(rawSiteId)) {
    return NextResponse.json(
      {
        statusCode: 'SITE_NOT_FOUND',
        verified: false,
        reason: 'Invalid siteId format. Expected alphanumeric, underscore, or hyphen identifier.',
        data: null,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const normalizedSiteId = CANONICAL_ALIAS_MAP[rawSiteId] ?? rawSiteId;
  const corpus = loadAndVerifyStagedCorpora();
  if (!corpus.verified || !corpus.decisionDataset || !corpus.climateDataset) {
    return NextResponse.json(
      {
        statusCode: 'SOURCE_NOT_PROVIDED',
        verified: false,
        reason: corpus.reason,
        data: null,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (normalizedSiteId !== 'uppsala-demo') {
    const isKnownM4Site = Boolean(
      corpus.m4Catalog?.sites &&
        Object.prototype.hasOwnProperty.call(corpus.m4Catalog.sites, normalizedSiteId)
    );
    return NextResponse.json(
      {
        statusCode: isKnownM4Site ? 'MODEL_UNQUALIFIED' : 'SITE_NOT_FOUND',
        verified: true,
        siteId: normalizedSiteId,
        reason: isKnownM4Site
          ? `MODEL_UNQUALIFIED: M14 optimization results belong strictly to SE_UPPSALA and are not qualified for ${normalizedSiteId}.`
          : `SITE_NOT_FOUND: Unknown siteId "${rawSiteId}".`,
        decisionDataset: null,
        climateDataset: null,
        evidenceRecords: [],
      },
      { status: isKnownM4Site ? 200 : 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    {
      statusCode: 'OK_RECORDED_RESEARCH',
      verified: true,
      siteId: 'uppsala-demo',
      canonicalSiteId: 'SE_UPPSALA',
      m14ProtocolSha256: corpus.m14ProtocolSha256,
      verifiedFileHashes: corpus.verifiedFileHashes,
      decisionDataset: corpus.decisionDataset,
      climateDataset: corpus.climateDataset,
      evidenceRecords: corpus.m14EvidenceRecords,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
