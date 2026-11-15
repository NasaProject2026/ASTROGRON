import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ClimateWaterDatasetSchema,
  EvidenceRecordSchema,
  M14DecisionDatasetSchema,
} from '@/domain/schemas';
import {
  NativeM14CandidateAuditSchema,
  NativeM14ComparisonDomainSchema,
  NativeM14OutputReceiptSchema,
  NativeM14PreferenceDecisionsSchema,
  NativeM14ResourceFrontiersSchema,
  NativeM4GlobalCoverageManifestSchema,
} from '@/domain/native-schemas';
import { SYNTHETIC_DECISION_DATASET } from '@/fixtures/m14-decision-fixture';
import { SYNTHETIC_UPPSALA_CLIMATE_FIXTURE } from '@/fixtures/climate-water-fixture';

const PACKAGE_ROOT = path.resolve(process.cwd(), '..');
const M14_DIR = fs.existsSync(path.join(PACKAGE_ROOT, 'UNPACKED_M14_REVIEW'))
  ? path.join(PACKAGE_ROOT, 'UNPACKED_M14_REVIEW')
  : path.join(process.cwd(), 'src/data/m14-recorded');
const M4_DIR = fs.existsSync(path.join(PACKAGE_ROOT, 'UNPACKED_M1_M4_REVIEW/ASTRAGRON_REVIEW/M4'))
  ? path.join(PACKAGE_ROOT, 'UNPACKED_M1_M4_REVIEW/ASTRAGRON_REVIEW/M4')
  : path.join(process.cwd(), 'src/data/m4-global');

describe('Gate G1: Strict Zod Schemas, Native M14/M4 Validation & Adversarial Rejection', () => {
  it('validates existing synthetic UI fixtures without regression under strict nested schemas (no z.any)', () => {
    expect(() => M14DecisionDatasetSchema.parse(SYNTHETIC_DECISION_DATASET)).not.toThrow();
    expect(() => ClimateWaterDatasetSchema.parse(SYNTHETIC_UPPSALA_CLIMATE_FIXTURE)).not.toThrow();
  });

  it('validates unmodified native M14 & M4 JSON artifacts against strict native schemas', () => {
    const receipt = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'OUTPUT_RECEIPT.json'), 'utf8'));
    const domain = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'COMPARISON_DOMAIN.json'), 'utf8'));
    const audit = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'candidate_audit.json'), 'utf8'));
    const decisions = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'preference_decisions.json'), 'utf8'));
    const frontiers = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'resource_frontiers.json'), 'utf8'));
    const m4Manifest = JSON.parse(fs.readFileSync(path.join(M4_DIR, 'GLOBAL_COVERAGE_MANIFEST.json'), 'utf8'));

    expect(() => NativeM14OutputReceiptSchema.parse(receipt)).not.toThrow();
    expect(() => NativeM14ComparisonDomainSchema.parse(domain)).not.toThrow();
    const parsedAudit = NativeM14CandidateAuditSchema.parse(audit);
    expect(parsedAudit.policies).toHaveLength(16);
    expect(parsedAudit.cases).toHaveLength(144);
    expect(() => NativeM14PreferenceDecisionsSchema.parse(decisions)).not.toThrow();
    expect(() => NativeM14ResourceFrontiersSchema.parse(frontiers)).not.toThrow();

    const parsedM4 = NativeM4GlobalCoverageManifestSchema.parse(m4Manifest);
    expect(parsedM4.sites.map((s) => s.site.site_id)).toEqual([
      'SE_UPPSALA',
      'KE_NYERI_REGION',
      'AU_WAGGA_REGION',
    ]);
  });

  it('rejects adversarial NaN, Infinity, negative quantities, and swapped min/max temperature', () => {
    const cloneDecision = structuredClone(SYNTHETIC_DECISION_DATASET) as unknown as Record<
      string,
      unknown
    > & {
      policies: Array<Record<string, unknown>>;
    };
    cloneDecision.policies[0]!.worstEtShortfallM3Eq = Number.NaN;
    expect(() => M14DecisionDatasetSchema.parse(cloneDecision)).toThrow();

    cloneDecision.policies[0]!.worstEtShortfallM3Eq = Number.POSITIVE_INFINITY;
    expect(() => M14DecisionDatasetSchema.parse(cloneDecision)).toThrow();

    cloneDecision.policies[0]!.worstEtShortfallM3Eq = -12.5;
    expect(() => M14DecisionDatasetSchema.parse(cloneDecision)).toThrow();

    const cloneClimate = structuredClone(SYNTHETIC_UPPSALA_CLIMATE_FIXTURE);
    cloneClimate.seriesByAnalogue['2018'][0]!.precipMm = -0.1;
    expect(() => ClimateWaterDatasetSchema.parse(cloneClimate)).toThrow();

    const swappedTemp = structuredClone(SYNTHETIC_UPPSALA_CLIMATE_FIXTURE);
    swappedTemp.seriesByAnalogue['2018'][0]!.t2mMinC = 22.0;
    swappedTemp.seriesByAnalogue['2018'][0]!.t2mMaxC = 14.0;
    expect(() => ClimateWaterDatasetSchema.parse(swappedTemp)).toThrow();
  });

  it('rejects calendar-invalid policy with numeric score/rank and rejects all-fail falsely marked qualified', () => {
    const calLeak = structuredClone(SYNTHETIC_DECISION_DATASET);
    const invalidPol = calLeak.policies.find((p) => !p.isComparable)!;
    invalidPol.worstEtShortfallM3Eq = 0;
    expect(() => M14DecisionDatasetSchema.parse(calLeak)).toThrow();

    const passLeak = structuredClone(SYNTHETIC_DECISION_DATASET);
    passLeak.policies[0]!.passesAllTestedScenarios = true;
    expect(() => M14DecisionDatasetSchema.parse(passLeak)).toThrow();

    const nativeAudit = JSON.parse(fs.readFileSync(path.join(M14_DIR, 'candidate_audit.json'), 'utf8'));
    nativeAudit.cases[0].status = 'CALENDAR_INELIGIBLE';
    nativeAudit.cases[0].ET_shortfall_m3_equivalent = 0;
    expect(() => NativeM14CandidateAuditSchema.parse(nativeAudit)).toThrow();
  });

  it('rejects duplicate policy IDs, portfolio count mismatch, missing schema/sha256 in recorded mode, and M4 cross-site leakage', () => {
    const dup = structuredClone(SYNTHETIC_DECISION_DATASET);
    dup.policies[1]!.policyId = dup.policies[0]!.policyId;
    expect(() => M14DecisionDatasetSchema.parse(dup)).toThrow();

    const countMismatch = structuredClone(SYNTHETIC_DECISION_DATASET);
    countMismatch.portfolioSummary.numericPassCases = 999;
    expect(() => M14DecisionDatasetSchema.parse(countMismatch)).toThrow();

    const recordedWithoutMeta = structuredClone(SYNTHETIC_DECISION_DATASET);
    recordedWithoutMeta.datasetMode = 'RECORDED_M14_RESEARCH';
    expect(() => M14DecisionDatasetSchema.parse(recordedWithoutMeta)).toThrow();

    expect(() =>
      EvidenceRecordSchema.parse({
        evidence_id: 'a'.repeat(64),
        site_id: 'uppsala-demo',
        dataset_mode: 'RECORDED_M14_RESEARCH',
        source: 'NASA_POWER',
        product_version: 'v2.10.3',
        variable: 'PRECTOTCORR',
        variable_label: 'Precipitation',
        evidence_class: 'REGIONAL_MODEL_EVIDENCE',
        spatial_support: '0.625x0.5 deg',
        period: '2018-01-01..2022-12-31',
        timezone: 'UTC',
        available_at: '2026-11-06T21:03:33Z',
        units: 'mm/day',
        quality: 'COMPLETE',
        missingness_summary: '0 missing',
        uncertainty: 'regional',
        license: 'NASA POWER public',
        source_sha256: null,
        extraction_recipe: 'direct',
        samples: [],
        limitations: [],
        supports_components: ['results'],
      })
    ).toThrow();

    const m4 = JSON.parse(fs.readFileSync(path.join(M4_DIR, 'GLOBAL_COVERAGE_MANIFEST.json'), 'utf8'));
    m4.sites[1].source_coverage[0].site_id = 'SE_UPPSALA';
    expect(() => NativeM4GlobalCoverageManifestSchema.parse(m4)).toThrow();
  });
});
