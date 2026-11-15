import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import { performServerGeocodeSearch, resetGeocodeRateLimiter } from '@/server/geocode-service';
import { querySuggestedFieldBoundaries, resetFtwBoundaryCaches } from '@/server/ftw-boundary-service';
import { evaluateSiteCapabilityCheck } from '@/server/capability-overlay-service';

const EVIDENCE_DIR = path.join(process.cwd(), 'review', 'evidence');

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

describe('LIVE Unmocked Provider Verification (G6 / G7)', () => {
  it('verifies real worldwide /api/geocode queries unmocked (cities, villages, postal code, street address, negative query) and saves evidence', async () => {
    ensureEvidenceDir();
    resetGeocodeRateLimiter();

    const commercialKeysConfigured = {
      geoapify: Boolean(process.env.GEOAPIFY_API_KEY?.trim()),
      maptiler: Boolean(process.env.MAPTILER_API_KEY?.trim()),
      genericGeocoder: Boolean(
        process.env.ASTRAGRON_GEOCODER_URL?.trim() && process.env.ASTRAGRON_GEOCODER_API_KEY?.trim()
      ),
    };

    const queries = [
      { label: 'city_heilbronn', q: 'Heilbronn' },
      { label: 'city_hamburg', q: 'Hamburg' },
      { label: 'city_damascus', q: 'Damascus' },
      { label: 'city_uppsala', q: 'Uppsala' },
      { label: 'rural_village_altenbach', q: 'Altenbach' },
      { label: 'rural_town_karatina', q: 'Karatina' },
      { label: 'postal_code_74072_heilbronn', q: '74072 Heilbronn' },
      { label: 'street_address_untereisesheimer', q: 'Untereisesheimer Strasse Heilbronn' },
    ];

    const records: Array<Record<string, unknown>> = [];

    for (let i = 0; i < queries.length; i += 1) {
      const entry = queries[i]!;
      const outcome = await performServerGeocodeSearch(entry.q, `live-audit-${i}`);
      expect(outcome.ok, `Query "${entry.q}" failed: ${outcome.notice}`).toBe(true);
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.status).toBe('OK');
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(outcome.providerHost).not.toContain('nominatim.openstreetmap.org');

      const top = outcome.results[0]!;
      expect(Number.isFinite(top.lon)).toBe(true);
      expect(Number.isFinite(top.lat)).toBe(true);
      expect(top.lon).toBeGreaterThanOrEqual(-180);
      expect(top.lon).toBeLessThanOrEqual(180);
      expect(top.lat).toBeGreaterThanOrEqual(-90);
      expect(top.lat).toBeLessThanOrEqual(90);
      expect(typeof top.zoomHint).toBe('number');
      expect(top.zoomHint).toBeGreaterThanOrEqual(3);
      expect(top.zoomHint).toBeLessThanOrEqual(18);
      expect(top.label).not.toMatch(/[<>]/);
      expect(['LICENSED_SERVER_KEY', 'NON_COMMERCIAL_OR_COMMUNITY']).toContain(outcome.providerTier);

      records.push({
        label: entry.label,
        query: entry.q,
        testedAt: new Date().toISOString(),
        ok: outcome.ok,
        status: outcome.status,
        httpStatus: outcome.httpStatus,
        providerHost: outcome.providerHost,
        providerKind: outcome.providerKind,
        providerTier: outcome.providerTier,
        attribution: outcome.attribution,
        resultCount: outcome.results.length,
        topResult: {
          id: top.id,
          shortName: top.shortName,
          region: top.region,
          country: top.country,
          countryCode: top.countryCode,
          label: top.label,
          lon: top.lon,
          lat: top.lat,
          zoomHint: top.zoomHint,
          bbox: top.bbox,
          source: top.source,
          attribution: top.attribution,
        },
      });
    }

    // Genuine live zero-result check
    const noResultOutcome = await performServerGeocodeSearch(
      'zzxxyyqq998877nonexistentplace4455',
      'live-audit-neg'
    );
    expect(noResultOutcome.httpStatus).toBe(200);
    expect(noResultOutcome.results).toEqual([]);
    expect(noResultOutcome.status).toBe('OK');

    const proof = {
      verificationType: 'LIVE_UNMOCKED',
      verifiedAt: new Date().toISOString(),
      commercialKeysConfigured,
      keylessFallbackUsedWhenNoCommercialKey:
        !commercialKeysConfigured.geoapify &&
        !commercialKeysConfigured.maptiler &&
        !commercialKeysConfigured.genericGeocoder,
      nominatimBlocked: true,
      queryCount: records.length,
      negativeEmptyQuery: {
        query: 'zzxxyyqq998877nonexistentplace4455',
        status: noResultOutcome.status,
        httpStatus: noResultOutcome.httpStatus,
        resultCount: noResultOutcome.results.length,
        providerHost: noResultOutcome.providerHost,
        notice: noResultOutcome.notice,
      },
      records,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'live-geocode-proof.json'),
      `${JSON.stringify(proof, null, 2)}\n`,
      'utf8'
    );
  });

  it('verifies real unmocked FTW 2nd Edition HTTP Range GeoParquet point-in-field lookup & ocean negative case and saves evidence', async () => {
    ensureEvidenceDir();
    resetFtwBoundaryCaches();

    // Primary Germany Neckar-Valley farmland interior coordinate (UTM 32 · 32UNV_0_0-139038)
    const primaryLon = 9.14156;
    const primaryLat = 48.98443;
    const primaryOutcome = await querySuggestedFieldBoundaries(primaryLon, primaryLat);

    expect(primaryOutcome.ok, `Primary FTW lookup failed: ${primaryOutcome.notice}`).toBe(true);
    expect(primaryOutcome.status, `Notice: ${primaryOutcome.notice} | Meta: ${JSON.stringify(primaryOutcome.queryMeta)} | Rejected: ${primaryOutcome.rejectedFragmentsCount}`).toBe('FOUND');
    expect(primaryOutcome.httpStatus).toBe(200);
    expect(primaryOutcome.sourceMode).toBe('FTW_2E_HTTP_RANGE_PARQUET');
    expect(primaryOutcome.suggestions.length).toBeGreaterThan(0);

    const best = primaryOutcome.suggestions[0]!;
    expect(best.sourceDataset).toContain('Fields of The World');
    expect(best.license).toBe('CC BY 4.0');
    expect(best.geometryPassedLocalChecks).toBe(true);
    expect(best.sourceVerifiedComplete).toBe(true);
    expect(best.areaHa).toBeGreaterThan(0.1);
    expect(best.sourceFeatureId).toBeTruthy();
    expect(best.scoreSemantics).toBe('UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100');

    const isInside = turf.booleanPointInPolygon(turf.point([primaryLon, primaryLat]), best.geometry);
    expect(isInside).toBe(true);

    // Secondary farmland probes (adjacent Neckar parcel 32UNV_0_0-139037)
    const secondaryProbes = [
      { label: 'neckar_adjacent_parcel_32UNV_0_0_139037', lon: 9.14015, lat: 48.9844 },
    ];
    const probeResults: Array<Record<string, unknown>> = [];
    for (const p of secondaryProbes) {
      const res = await querySuggestedFieldBoundaries(p.lon, p.lat);
      probeResults.push({
        label: p.label,
        lon: p.lon,
        lat: p.lat,
        status: res.status,
        httpStatus: res.httpStatus,
        utmZone: res.utmZone,
        datasetYear: res.datasetYear,
        suggestionCount: res.suggestions.length,
        sourceDataset: res.suggestions[0]?.sourceDataset ?? null,
        sourceYear: res.suggestions[0]?.sourceYear ?? null,
        sourceFeatureId: res.suggestions[0]?.sourceFeatureId ?? null,
        areaHa: res.suggestions[0]?.areaHa ?? null,
        rawModelScore: res.suggestions[0]?.rawModelScore ?? null,
        queryMeta: res.queryMeta ?? null,
      });
    }

    // Negative high-Arctic ocean coordinate (86° N > 84° UTM limit) must return clean COVERAGE_UNKNOWN / NO_RELIABLE_BOUNDARY without fabricating geometry
    const oceanLon = 9.0;
    const oceanLat = 86.0;
    const oceanOutcome = await querySuggestedFieldBoundaries(oceanLon, oceanLat);
    expect(oceanOutcome.suggestions).toEqual([]);
    expect(['NO_RELIABLE_BOUNDARY', 'COVERAGE_UNKNOWN', 'UNAVAILABLE']).toContain(
      oceanOutcome.status
    );

    // Check unassessed scientific capability neutrality on the real Heilbronn coordinate
    const siteCheck = await evaluateSiteCapabilityCheck({
      coordinates: [primaryLon, primaryLat],
      geometry: best.geometry,
    });
    expect(siteCheck.status).toBe('UNKNOWN_UNASSESSED');
    expect(siteCheck.matrix.m4EarthDataCoverage).toBe('UNKNOWN_UNASSESSED');
    expect(siteCheck.matrix.fieldCropOptimization).toBe('UNKNOWN_UNASSESSED');
    expect(siteCheck.matrix.descriptiveEvidence).toBe('LIMITED');
    expect(siteCheck.allowsFarmSave).toBe(true);
    expect(siteCheck.allowsAnalysisAction).toBe(false);

    const ftwProof = {
      verificationType: 'LIVE_UNMOCKED',
      verifiedAt: new Date().toISOString(),
      protocol: 'HTTP Range selective Parquet row-group read via hyparquet against data.source.coop',
      primaryHit: {
        queryPoint: { lon: primaryLon, lat: primaryLat },
        status: primaryOutcome.status,
        httpStatus: primaryOutcome.httpStatus,
        sourceMode: primaryOutcome.sourceMode,
        utmZone: primaryOutcome.utmZone,
        datasetYear: primaryOutcome.datasetYear,
        attribution: primaryOutcome.attribution,
        queryMeta: primaryOutcome.queryMeta,
        suggestionCount: primaryOutcome.suggestions.length,
        selectedParcel: best,
        pointVerifiedInsidePolygon: isInside,
      },
      additionalProbes: probeResults,
      negativeOceanCheck: {
        queryPoint: { lon: oceanLon, lat: oceanLat },
        status: oceanOutcome.status,
        httpStatus: oceanOutcome.httpStatus,
        suggestionCount: oceanOutcome.suggestions.length,
        notice: oceanOutcome.notice,
      },
      scientificNeutralityAtPrimaryPoint: siteCheck,
    };

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'live-ftw-geoparquet-proof.json'),
      `${JSON.stringify(ftwProof, null, 2)}\n`,
      'utf8'
    );
  });
});
