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
  const rawSiteId = request.nextUrl.searchParams.get('siteId');
  if (rawSiteId !== null && !SITE_ID_PATTERN.test(rawSiteId)) {
    return NextResponse.json(
      {
        statusCode: 'SITE_NOT_FOUND',
        verified: false,
        reason: 'Invalid siteId format. Expected alphanumeric, underscore, or hyphen identifier.',
        site: null,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const corpus = loadAndVerifyStagedCorpora();
  if (!corpus.verified || !corpus.m4Catalog) {
    return NextResponse.json(
      {
        statusCode: 'SOURCE_NOT_PROVIDED',
        verified: false,
        reason: corpus.reason,
        site: null,
        sites: null,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!rawSiteId) {
    return NextResponse.json(
      {
        statusCode: 'OK_COVERAGE_ONLY',
        verified: true,
        schema: corpus.m4Catalog.schema,
        asOf: corpus.m4Catalog.asOf,
        purpose: corpus.m4Catalog.purpose,
        soilUnitConflictNote: corpus.m4Catalog.soilUnitConflictNote,
        projectionControlNote: corpus.m4Catalog.projectionControlNote,
        sites: corpus.m4Catalog.sites,
        verifiedFileHashes: corpus.verifiedFileHashes,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const normalizedSiteId = CANONICAL_ALIAS_MAP[rawSiteId] ?? rawSiteId;
  const siteBundle =
    corpus.m4Catalog.sites[normalizedSiteId as keyof typeof corpus.m4Catalog.sites] ?? null;

  if (!siteBundle) {
    return NextResponse.json(
      {
        statusCode: 'SITE_NOT_FOUND',
        verified: true,
        siteId: rawSiteId,
        reason: `SITE_NOT_FOUND: No M4 coverage record exists for "${rawSiteId}".`,
        site: null,
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    {
      statusCode: 'OK_COVERAGE_ONLY',
      verified: true,
      schema: corpus.m4Catalog.schema,
      asOf: corpus.m4Catalog.asOf,
      site: siteBundle,
      soilUnitConflictNote: corpus.m4Catalog.soilUnitConflictNote,
      projectionControlNote: corpus.m4Catalog.projectionControlNote,
      verifiedFileHashes: corpus.verifiedFileHashes,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
