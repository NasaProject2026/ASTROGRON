import { describe, it, expect } from 'vitest';
import {
  CoverageStatusSchema,
  EvidenceClassSchema,
  ResearchPreferenceSchema,
  DatasetOperatingModeSchema,
  M14DecisionDatasetSchema,
  ClimateWaterDatasetSchema,
  EvidenceRecordSchema,
  validateFieldGeoJson,
  convertDmsToDecimal,
  estimatePolygonAreaHectares,
  validateFarmSetupDraft,
} from '@/domain/schemas';
import { SYNTHETIC_UPPSALA_DECISION_FIXTURE } from '@/fixtures/m14-decision-fixture';
import { SYNTHETIC_UPPSALA_CLIMATE_FIXTURE } from '@/fixtures/climate-water-fixture';
import {
  EVIDENCE_RECORDS_FIXTURE,
  DEFAULT_UPPSALA_FARM_DRAFT,
  DEMO_SEARCH_INDEX,
} from '@/fixtures/sites-and-coverage';
import { NATURAL_EARTH_WORLD_GEOJSON } from '@/fixtures/natural-earth-world';
import {
  sortPoliciesByPreference,
  createRepositoryForMode,
  syntheticDemoRepository,
  buildSiteBoundExportPayload,
  searchLocationsViaAdapter,
} from '@/adapters/repositories';

describe('ASTRAGRON Repaired Scientific Contracts, Cross-Site Isolation & Adversarial Suite (33 Tests)', () => {
  // =========================================================================
  // 1. Contract Enum & Zod Schema Validation
  // =========================================================================
  it('1. validates all M4 coverage statuses, evidence classes (including SYNTHETIC_UI_FIXTURE), and dataset modes', () => {
    const statuses = [
      'AVAILABLE',
      'CONDITIONAL',
      'INSUFFICIENT_EVIDENCE',
      'OUT_OF_COVERAGE',
      'TEMPORARILY_UNAVAILABLE',
    ];
    statuses.forEach((s) => {
      expect(CoverageStatusSchema.safeParse(s).success).toBe(true);
    });

    const classes = [
      'OBSERVED',
      'DERIVED',
      'REGIONAL_MODEL_EVIDENCE',
      'RESEARCH_ASSUMPTION',
      'SYNTHETIC_UI_FIXTURE',
      'MISSING_OR_UNQUALIFIED',
    ];
    classes.forEach((c) => {
      expect(EvidenceClassSchema.safeParse(c).success).toBe(true);
    });

    const modes = ['SYNTHETIC_UI_DEMO', 'RECORDED_M14_RESEARCH', 'REAL_SCIENTIFIC_BACKEND'];
    modes.forEach((m) => {
      expect(DatasetOperatingModeSchema.safeParse(m).success).toBe(true);
    });
  });

  it('2. validates SYNTHETIC_UPPSALA_DECISION_FIXTURE against strict M14DecisionDatasetSchema', () => {
    const parsed = M14DecisionDatasetSchema.safeParse(SYNTHETIC_UPPSALA_DECISION_FIXTURE);
    expect(parsed.success).toBe(true);
  });

  it('3. validates SYNTHETIC_UPPSALA_CLIMATE_FIXTURE against strict ClimateWaterDatasetSchema', () => {
    const parsed = ClimateWaterDatasetSchema.safeParse(SYNTHETIC_UPPSALA_CLIMATE_FIXTURE);
    expect(parsed.success).toBe(true);
  });

  it('4. validates all EVIDENCE_RECORDS_FIXTURE items against EvidenceRecordSchema', () => {
    const records = Object.values(EVIDENCE_RECORDS_FIXTURE);
    expect(records.length).toBeGreaterThanOrEqual(6);
    records.forEach((rec) => {
      const parsed = EvidenceRecordSchema.safeParse(rec);
      expect(parsed.success).toBe(true);
      expect(rec.source_sha256).toBeNull();
    });
  });

  // =========================================================================
  // 2. Truth Separation & Synthetic UI Demo Mode Invariants (P0-A)
  // =========================================================================
  it('5. enforces 100% synthetic policy IDs (SYNTH-POL-01..SYNTH-POL-12) and forbids real M14 hashes', () => {
    const ds = SYNTHETIC_UPPSALA_DECISION_FIXTURE;
    expect(ds.datasetMode).toBe('SYNTHETIC_UI_DEMO');
    expect(ds.fieldValidated).toBe(false);
    expect(ds.policies).toHaveLength(12);

    ds.policies.forEach((p, idx) => {
      const expectedId = `SYNTH-POL-${String(idx + 1).padStart(2, '0')}`;
      expect(p.policyId).toBe(expectedId);
      expect(p.policyId).not.toBe('a27063ce2eca13f02e03');
      expect(p.policyId).not.toBe('fa0e548ed3a7ccbcad4e');
    });
  });

  it('6. verifies synthetic portfolio summary arithmetic (12 policies x 9 states = 108 state evaluations)', () => {
    const summary = SYNTHETIC_UPPSALA_DECISION_FIXTURE.portfolioSummary;
    expect(summary.totalPolicies).toBe(12);
    expect(summary.totalScenarioStates).toBe(9);
    expect(summary.totalPolicyStateCases).toBe(108);
    expect(summary.numericValidCases).toBe(99);
    expect(summary.calendarInvalidCases).toBe(9);
    expect(summary.numericPassCases).toBe(66);
    expect(summary.numericFailCases).toBe(33);
    expect(summary.policiesPassingAllStates).toBe(0);
    expect(summary.comparablePoliciesCount).toBe(11);
    expect(summary.excludedCalendarPoliciesCount).toBe(1);
    expect(SYNTHETIC_UPPSALA_DECISION_FIXTURE.fieldRecommendationEligibility).toBe('BLOCKED');
  });

  it('7. verifies Uppsala synthetic farm draft has 3 fields (F1=6ha, F2=8ha, F3=10ha; total 24ha) and BASE 8,000 m3/yr water regime', () => {
    const uppsala = DEFAULT_UPPSALA_FARM_DRAFT;
    expect(uppsala).toBeDefined();
    expect(uppsala.fields).toHaveLength(3);
    const totalHa = uppsala.fields.reduce((acc, f) => acc + (f.declaredAreaHa ?? 0), 0);
    expect(totalHa).toBe(24.0);
    expect(uppsala.waterContext.seasonalQuotaM3.value).toBe(8000);
    expect(uppsala.waterContext.sharedDailyDeliveryM3.value).toBe(80);
  });

  // =========================================================================
  // 3. Operating Mode Fail-Closed Behavior (RECORDED_M14_RESEARCH & REAL_SCIENTIFIC_BACKEND)
  // =========================================================================
  it('8. fails closed with SOURCE_NOT_PROVIDED in RECORDED_M14_RESEARCH mode when raw M14 JSON corpus is absent', async () => {
    const repo = createRepositoryForMode('RECORDED_M14_RESEARCH', [], { corpusAvailable: false });
    expect(repo.mode).toBe('RECORDED_M14_RESEARCH');

    const dec = await repo.getDecisionEvaluation('uppsala-demo');
    expect(dec.statusCode).toBe('SOURCE_NOT_PROVIDED');
    expect(dec.data).toBeNull();

    const clim = await repo.getClimateWaterSeries('uppsala-demo');
    expect(clim.statusCode).toBe('SOURCE_NOT_PROVIDED');
    expect(clim.data).toBeNull();

    const ev = await repo.getEvidenceRecords('uppsala-demo');
    expect(ev.statusCode).toBe('SOURCE_NOT_PROVIDED');
    expect(ev.data).toEqual([]);
  });

  it('9. fails closed with BACKEND_NOT_CONNECTED in REAL_SCIENTIFIC_BACKEND mode', async () => {
    const repo = createRepositoryForMode('REAL_SCIENTIFIC_BACKEND');
    expect(repo.mode).toBe('REAL_SCIENTIFIC_BACKEND');

    const dec = await repo.getDecisionEvaluation('uppsala-demo');
    expect(dec.statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(dec.data).toBeNull();

    const clim = await repo.getClimateWaterSeries('uppsala-demo');
    expect(clim.statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(clim.data).toBeNull();

    const sub = repo.submitCustomFarmEvaluation(DEFAULT_UPPSALA_FARM_DRAFT);
    expect(sub.statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(sub.accepted).toBe(false);
  });

  // =========================================================================
  // 4. Unknown Farm ID Fail-Closed Behavior (P0-B)
  // =========================================================================
  it('10. returns SITE_NOT_FOUND for unknown farm IDs across all repository methods and never falls back to Uppsala', async () => {
    const unknownId = 'does-not-exist-999';

    const draftRes = await syntheticDemoRepository.getFarmDraft(unknownId);
    expect(draftRes.statusCode).toBe('SITE_NOT_FOUND');
    expect(draftRes.data).toBeNull();

    const covRes = await syntheticDemoRepository.getCoverageReport(unknownId);
    expect(covRes.statusCode).toBe('SITE_NOT_FOUND');
    expect(covRes.data).toBeNull();

    const decRes = await syntheticDemoRepository.getDecisionEvaluation(unknownId);
    expect(decRes.statusCode).toBe('SITE_NOT_FOUND');
    expect(decRes.data).toBeNull();

    const climRes = await syntheticDemoRepository.getClimateWaterSeries(unknownId);
    expect(climRes.statusCode).toBe('SITE_NOT_FOUND');
    expect(climRes.data).toBeNull();

    const evRes = await syntheticDemoRepository.getEvidenceRecords(unknownId);
    expect(evRes.statusCode).toBe('SITE_NOT_FOUND');
    expect(evRes.data).toEqual([]);
  });

  // =========================================================================
  // 5. Strict Cross-Site Isolation: Nyeri, Kenya & Wagga Wagga, Australia (P0-B & P1-E)
  // =========================================================================
  it('11. isolates Nyeri, Kenya (nyeri-kenya): returns OK_COVERAGE_ONLY on coverage and MODEL_UNQUALIFIED on decision/climate', async () => {
    const covRes = await syntheticDemoRepository.getCoverageReport('nyeri-kenya');
    expect(covRes.statusCode).toBe('OK_COVERAGE_ONLY');
    expect(covRes.data?.id).toBe('nyeri-kenya');
    expect(covRes.data?.coordinates[1]).toBeCloseTo(-0.4201, 2);

    const decRes = await syntheticDemoRepository.getDecisionEvaluation('nyeri-kenya');
    expect(decRes.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(decRes.data).toBeNull();

    const climRes = await syntheticDemoRepository.getClimateWaterSeries('nyeri-kenya');
    expect(climRes.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(climRes.data).toBeNull();
  });

  it('12. isolates Nyeri, Kenya evidence records: returns only nyeri-kenya records and zero Uppsala records', async () => {
    const evRes = await syntheticDemoRepository.getEvidenceRecords('nyeri-kenya');
    expect(evRes.statusCode).toBe('OK_COVERAGE_ONLY');
    const list = evRes.data ?? [];
    expect(list.length).toBeGreaterThan(0);
    list.forEach((rec) => {
      expect(rec.site_id).toBe('nyeri-kenya');
      expect(rec.evidence_id).not.toContain('uppsala');
    });
  });

  it('13. isolates Wagga Wagga, Australia (wagga-australia): returns OK_COVERAGE_ONLY on coverage and MODEL_UNQUALIFIED on decision/climate', async () => {
    const covRes = await syntheticDemoRepository.getCoverageReport('wagga-australia');
    expect(covRes.statusCode).toBe('OK_COVERAGE_ONLY');
    expect(covRes.data?.id).toBe('wagga-australia');
    expect(covRes.data?.coordinates[1]).toBeCloseTo(-35.1082, 3);

    const decRes = await syntheticDemoRepository.getDecisionEvaluation('wagga-australia');
    expect(decRes.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(decRes.data).toBeNull();

    const climRes = await syntheticDemoRepository.getClimateWaterSeries('wagga-australia');
    expect(climRes.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(climRes.data).toBeNull();
  });

  it('14. isolates Wagga Wagga, Australia evidence records: returns only wagga-australia records and zero Uppsala records', async () => {
    const evRes = await syntheticDemoRepository.getEvidenceRecords('wagga-australia');
    expect(evRes.statusCode).toBe('OK_COVERAGE_ONLY');
    const list = evRes.data ?? [];
    expect(list.length).toBeGreaterThan(0);
    list.forEach((rec) => {
      expect(rec.site_id).toBe('wagga-australia');
    });
  });

  it('15. guarantees zero state contamination across sequential Uppsala -> Kenya -> Australia -> Uppsala repository transitions', async () => {
    const step1 = await syntheticDemoRepository.getDecisionEvaluation('uppsala-demo');
    expect(step1.statusCode).toBe('OK_SYNTHETIC_DEMO');
    expect(step1.data?.siteId).toBe('uppsala-demo');

    const step2 = await syntheticDemoRepository.getDecisionEvaluation('nyeri-kenya');
    expect(step2.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(step2.data).toBeNull();

    const step3 = await syntheticDemoRepository.getClimateWaterSeries('wagga-australia');
    expect(step3.statusCode).toBe('MODEL_UNQUALIFIED');
    expect(step3.data).toBeNull();

    const step4 = await syntheticDemoRepository.getDecisionEvaluation('uppsala-demo');
    expect(step4.statusCode).toBe('OK_SYNTHETIC_DEMO');
    expect(step4.data?.siteId).toBe('uppsala-demo');
    expect(step4.data?.policies[0]?.policyId).toBe('SYNTH-POL-01');
  });

  it('16. blocks custom user-created farm drafts (custom-site-draft) with BACKEND_NOT_CONNECTED on decision and climate endpoints', async () => {
    const decRes = await syntheticDemoRepository.getDecisionEvaluation('custom-site-draft');
    expect(decRes.statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(decRes.data).toBeNull();

    const climRes = await syntheticDemoRepository.getClimateWaterSeries('custom-site-draft');
    expect(climRes.statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(climRes.data).toBeNull();
  });

  // =========================================================================
  // 6. Decision Preference Sorting & Calendar Overlap Exclusion
  // =========================================================================
  it('17. sorts synthetic policies accurately across STRICT_ALL_SCENARIOS_SERVICE (zero feasible abstention)', () => {
    const strictResult = sortPoliciesByPreference(
      SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      'STRICT_ALL_SCENARIOS_SERVICE'
    );
    expect(strictResult.selectionOutcome).toBe('ZERO_FEASIBLE_POLICIES');
    expect(strictResult.selectedLeaderPolicy).toBeNull();
    expect(strictResult.excludedCalendarPolicies).toHaveLength(1);
    expect(strictResult.excludedCalendarPolicies[0]?.policyId).toBe('SYNTH-POL-12');
  });

  it('18. selects SYNTH-POL-01 under MINIMIZE_WORST_ET_SHORTFALL (38,420.50 m3 eq)', () => {
    const shortfallResult = sortPoliciesByPreference(
      SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      'MINIMIZE_WORST_ET_SHORTFALL'
    );
    expect(shortfallResult.selectionOutcome).toBe('SINGLE_LEADER_SELECTED');
    expect(shortfallResult.selectedLeaderPolicy?.policyId).toBe('SYNTH-POL-01');
    expect(shortfallResult.selectedLeaderPolicy?.worstEtShortfallM3Eq).toBeCloseTo(38420.5, 2);
  });

  it('19. selects SYNTH-POL-02 under MINIMAX_REGRET (640.25 m3 eq)', () => {
    const regretResult = sortPoliciesByPreference(
      SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      'MINIMAX_REGRET'
    );
    expect(regretResult.selectionOutcome).toBe('SINGLE_LEADER_SELECTED');
    expect(regretResult.selectedLeaderPolicy?.policyId).toBe('SYNTH-POL-02');
    expect(regretResult.selectedLeaderPolicy?.maxRegretM3Eq).toBeCloseTo(640.25, 2);
  });

  it('20. returns NO_UNIQUE_WINNER and non-dominated Pareto set under PARETO_FRONTIER', () => {
    const paretoResult = sortPoliciesByPreference(
      SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      'PARETO_FRONTIER'
    );
    expect(paretoResult.selectionOutcome).toBe('NO_UNIQUE_WINNER');
    expect(paretoResult.selectedLeaderPolicy).toBeNull();
    expect(paretoResult.paretoFrontierPolicies.length).toBeGreaterThanOrEqual(4);
  });

  it('21. preserves NULL metrics (never zero) on calendar-invalid policy SYNTH-POL-12 (CALENDAR_OVERLAP:F3:Y3)', () => {
    const excluded = SYNTHETIC_UPPSALA_DECISION_FIXTURE.policies.find(
      (p) => p.policyId === 'SYNTH-POL-12'
    )!;
    expect(excluded).toBeDefined();
    expect(excluded.isComparable).toBe(false);
    expect(excluded.calendarInvalidReason).toContain('CALENDAR_OVERLAP:F3:Y3');
    expect(excluded.worstEtShortfallM3Eq).toBeNull();
    expect(excluded.maxRegretM3Eq).toBeNull();
    expect(excluded.meanSourceWithdrawalM3).toBeNull();
    excluded.scenarioOutcomes.forEach((ev) => {
      expect(ev.isNumericValid).toBe(false);
      expect(ev.totalEtShortfallM3Eq).toBeNull();
      expect(ev.regretM3Eq).toBeNull();
      expect(ev.bindingFieldDeficitMm).toBeNull();
    });
  });

  // =========================================================================
  // 7. Climate & Water Series Null-Not-Zero Invariant
  // =========================================================================
  it('22. preserves explicit null gaps on 2006-08-05 in climate series without substituting fake zeros', () => {
    const series2006 = SYNTHETIC_UPPSALA_CLIMATE_FIXTURE.seriesByAnalogue['2006'];
    const nullPoint = series2006.find((pt) => pt.date === '2006-08-05');
    expect(nullPoint).toBeDefined();
    expect(nullPoint?.et0Mm).toBeNull();
    expect(nullPoint?.precipMm).toBeNull();
    expect(nullPoint?.rootZoneDeficitMm).toBeNull();
  });

  // =========================================================================
  // 8. Geometry Validation: Geodesic Area, Bowtie Self-Intersection, EPSG:3857 & Antimeridian
  // =========================================================================
  it('23. validates closed WGS84 GeoJSON polygon and computes positive geodesic area in hectares', () => {
    const validGeoJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [17.628, 59.862],
          [17.651, 59.862],
          [17.651, 59.853],
          [17.628, 59.853],
          [17.628, 59.862],
        ],
      ],
    });
    const res = validateFieldGeoJson(validGeoJson);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.selfIntersecting).toBe(false);
    expect(res.estimatedAreaHectares).toBeGreaterThan(50);
  });

  it('24. rejects self-intersecting bowtie polygons cleanly', () => {
    const bowtieGeoJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [17.63, 59.85],
          [17.65, 59.87],
          [17.65, 59.85],
          [17.63, 59.87],
          [17.63, 59.85],
        ],
      ],
    });
    const res = validateFieldGeoJson(bowtieGeoJson);
    expect(res.valid).toBe(false);
    expect(res.selfIntersecting).toBe(true);
    expect(res.errors.some((e) => e.toLowerCase().includes('self-intersection'))).toBe(true);
  });

  it('25. rejects Web Mercator (EPSG:3857) meter coordinates with explicit CRS guidance', () => {
    const mercatorGeoJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [1963500, 8368200],
          [1964500, 8368200],
          [1964500, 8367200],
          [1963500, 8367200],
          [1963500, 8368200],
        ],
      ],
    });
    const res = validateFieldGeoJson(mercatorGeoJson);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('EPSG:3857') || e.includes('EPSG:4326'))).toBe(true);
  });

  it('26. detects antimeridian (+/-180 deg) crossing and warns without crashing', () => {
    const antimeridianGeoJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [179.991, -16.835],
          [-179.992, -16.835],
          [-179.992, -16.846],
          [179.991, -16.846],
          [179.991, -16.835],
        ],
      ],
    });
    const res = validateFieldGeoJson(antimeridianGeoJson);
    expect(res.valid).toBe(true);
    expect(res.crossesAntimeridian).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('27. rejects malformed JSON and polygons with fewer than 4 ring positions', () => {
    expect(validateFieldGeoJson('{not-valid-json').valid).toBe(false);
    const tooFewVertices = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[17.63, 59.85], [17.64, 59.85], [17.63, 59.85]]],
    });
    expect(validateFieldGeoJson(tooFewVertices).valid).toBe(false);
  });

  // =========================================================================
  // 9. Coordinate Conversion & Farm Setup Wizard Validation
  // =========================================================================
  it('28. converts DMS coordinates to decimal degrees and rejects out-of-range degrees/minutes/seconds', () => {
    const lat = convertDmsToDecimal({ degrees: 59, minutes: 51, seconds: 31, direction: 'N' });
    expect(lat.valid).toBe(true);
    expect(lat.decimal).toBeCloseTo(59.858611, 4);

    const badLat = convertDmsToDecimal({ degrees: 95, minutes: 0, seconds: 0, direction: 'S' });
    expect(badLat.valid).toBe(false);

    const badMin = convertDmsToDecimal({ degrees: 45, minutes: 65, seconds: 0, direction: 'N' });
    expect(badMin.valid).toBe(false);
  });

  it('29. validates complete FarmSetupDraft and catches invalid sowing >= harvest dates or negative area', () => {
    const validDraft = DEFAULT_UPPSALA_FARM_DRAFT;
    const checkValid = validateFarmSetupDraft(validDraft);
    expect(checkValid.valid).toBe(true);
    expect(checkValid.errors).toHaveLength(0);

    const invalidDraft = {
      name: 'Invalid Test Draft',
      longitude: 17.6389,
      latitude: 59.8586,
      fields: [
        {
          id: 'F1',
          declaredAreaHa: -5,
          mineralNo3KgHa: 30,
          nitrogenBasis: 'ELEMENTAL_N_KG_HA',
          sowingDate: '2027-09-15',
          harvestDate: '2027-04-10',
        },
      ],
    };
    const checkInvalid = validateFarmSetupDraft(invalidDraft);
    expect(checkInvalid.valid).toBe(false);
    expect(checkInvalid.errors.length).toBeGreaterThanOrEqual(2);
  });

  // =========================================================================
  // 10. Site-Bound Export Payloads, Location Search Adapter & Natural Earth Cartography
  // =========================================================================
  it('30. builds site-bound export payload for Uppsala with synthetic watermark and blocks cross-site export for Kenya', () => {
    const uppsalaExport = buildSiteBoundExportPayload('uppsala-demo', 'SYNTHETIC_UI_DEMO');
    expect(uppsalaExport.exportStatus).toBe('OK_SYNTHETIC_DEMO');
    expect(uppsalaExport.siteId).toBe('uppsala-demo');
    expect(uppsalaExport.watermark).toContain('SYNTHETIC INTERFACE DEMONSTRATION');
    expect(uppsalaExport.decisionDataset?.policies).toHaveLength(12);
    expect(uppsalaExport.evidenceRecords.every((r) => r.site_id === 'uppsala-demo')).toBe(true);

    const kenyaExport = buildSiteBoundExportPayload('nyeri-kenya', 'SYNTHETIC_UI_DEMO');
    expect(kenyaExport.exportStatus).toBe('OK_COVERAGE_ONLY');
    expect(kenyaExport.siteId).toBe('nyeri-kenya');
    expect(kenyaExport.decisionDataset).toBeNull();
    expect(kenyaExport.climateDataset).toBeNull();
    expect(kenyaExport.evidenceRecords.every((r) => r.site_id === 'nyeri-kenya')).toBe(true);
  });

  it('31. searches global reference localities via adapter (16 global agricultural sites)', () => {
    expect(DEMO_SEARCH_INDEX.length).toBeGreaterThanOrEqual(16);
    const swedenHits = searchLocationsViaAdapter('Uppsala');
    expect(swedenHits.results.length).toBeGreaterThanOrEqual(1);
    expect(swedenHits.results[0]?.id).toBe('uppsala-demo');

    const franceHits = searchLocationsViaAdapter('Beauce');
    expect(franceHits.results.length).toBeGreaterThanOrEqual(1);

    const iowaHits = searchLocationsViaAdapter('Ames');
    expect(iowaHits.results.length).toBeGreaterThanOrEqual(1);
  });

  it('32. verifies bundled Natural Earth 1:110m vector GeoJSON contains multi-vertex landmass features (not rectangular boxes)', () => {
    expect(NATURAL_EARTH_WORLD_GEOJSON.type).toBe('FeatureCollection');
    expect(NATURAL_EARTH_WORLD_GEOJSON.features.length).toBeGreaterThanOrEqual(12);
    NATURAL_EARTH_WORLD_GEOJSON.features.forEach((f) => {
      if (f.geometry.type === 'Polygon') {
        const ring = f.geometry.coordinates[0]!;
        expect(ring.length).toBeGreaterThanOrEqual(7);
      }
    });
  });

  it('33. computes geodesic polygon area in hectares accurately via spherical excess formula', () => {
    const ring: [number, number][] = [
      [17.632, 59.861],
      [17.638, 59.861],
      [17.638, 59.858],
      [17.632, 59.858],
      [17.632, 59.861],
    ];
    const ha = estimatePolygonAreaHectares(ring);
    expect(ha).toBeGreaterThan(8);
    expect(ha).toBeLessThan(20);
  });
});
