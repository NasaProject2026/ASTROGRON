import { z } from 'zod';
import type { UserFarmDraft } from './contracts';

export const DatasetOperatingModeSchema = z.enum([
  'SYNTHETIC_UI_DEMO',
  'RECORDED_M14_RESEARCH',
  'REAL_SCIENTIFIC_BACKEND',
]);

export const RepositoryStatusCodeSchema = z.enum([
  'OK_SYNTHETIC_DEMO',
  'OK_RECORDED_RESEARCH',
  'OK_COVERAGE_ONLY',
  'MODEL_UNQUALIFIED',
  'BACKEND_NOT_CONNECTED',
  'SOURCE_NOT_PROVIDED',
  'SITE_NOT_FOUND',
  'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION',
  'NO_EVIDENCE_FOR_SITE',
]);

export const CoverageStatusSchema = z.enum([
  'AVAILABLE',
  'CONDITIONAL',
  'INSUFFICIENT_EVIDENCE',
  'OUT_OF_COVERAGE',
  'TEMPORARILY_UNAVAILABLE',
]);

export const EvidenceClassSchema = z.enum([
  'OBSERVED',
  'DERIVED',
  'REGIONAL_MODEL_EVIDENCE',
  'RESEARCH_ASSUMPTION',
  'MISSING_OR_UNQUALIFIED',
  'SYNTHETIC_UI_FIXTURE',
]);

export const EvidencePurposeSchema = z.enum([
  'DESCRIPTIVE_CONTEXT',
  'FUTURE_CLIMATE_CONTEXT',
  'MODEL_INPUT_REVIEW',
]);

export const ResearchPreferenceSchema = z.enum([
  'STRICT_ALL_SCENARIOS_SERVICE',
  'MINIMIZE_WORST_ET_SHORTFALL',
  'MINIMAX_REGRET',
  'PARETO_FRONTIER',
]);

export const ResultAvailabilitySchema = z.enum([
  'READY',
  'PARTIAL',
  'EVIDENCE_INSUFFICIENT',
  'MODEL_UNQUALIFIED',
  'CALENDAR_INVALID',
  'COMPUTE_UNKNOWN',
  'UNAVAILABLE',
]);

export const CoordinatePairSchema = z.tuple([
  z.number().finite().min(-180, 'Longitude must be >= -180°').max(180, 'Longitude must be <= 180°'),
  z.number().finite().min(-90, 'Latitude must be >= -90°').max(90, 'Latitude must be <= 90°'),
]);

export const EvidenceRecordSchema = z.object({
  evidence_id: z.string().min(1),
  site_id: z.string().min(1),
  dataset_mode: DatasetOperatingModeSchema,
  source: z.string().min(1),
  product_version: z.string().min(1),
  variable: z.string().min(1),
  variable_label: z.string().min(1),
  evidence_class: EvidenceClassSchema,
  spatial_support: z.string().min(1),
  period: z.string().min(1),
  timezone: z.string().min(1),
  available_at: z.string().min(1),
  units: z.string().min(1),
  quality: z.string().min(1),
  missingness_summary: z.string().min(1),
  uncertainty: z.string().min(1),
  license: z.string().min(1),
  source_sha256: z.string().nullable(),
  extraction_recipe: z.string().min(1),
  samples: z.array(
    z.object({
      date: z.string().min(1),
      value: z.number().finite().nullable(),
    })
  ),
  limitations: z.array(z.string()),
  supports_components: z.array(z.string()),
}).superRefine((record, ctx) => {
  if (
    record.dataset_mode === 'RECORDED_M14_RESEARCH' &&
    record.evidence_class !== 'MISSING_OR_UNQUALIFIED' &&
    record.evidence_class !== 'RESEARCH_ASSUMPTION' &&
    (!record.source_sha256 || !/^[a-f0-9]{64}$/i.test(record.source_sha256))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['source_sha256'],
      message: 'Verified recorded evidence records must supply a 64-char SHA-256 source digest.',
    });
  }
});

export const FieldYearPlanCellSchema = z
  .object({
    fieldId: z.string().min(1),
    fieldLabel: z.string().min(1),
    irrigationAccess: z.enum(['YES', 'NO', 'UNKNOWN']),
    harvestYear: z.number().int().min(1).max(5),
    yearLabel: z.string().min(1),
    cropCode: z.string().min(1),
    cropName: z.string().min(1),
    plantingWindow: z.string().min(1),
    harvestWindow: z.string().min(1),
    calendarValid: z.boolean(),
    calendarInvalidReason: z.string().min(1).optional(),
    worstStateDeficitMm: z.number().finite().nonnegative().nullable(),
    medianStateDeficitMm: z.number().finite().nonnegative().nullable(),
    wetStateDeficitMm: z.number().finite().nonnegative().nullable(),
    serviceThresholdMm: z.number().finite().positive(),
    passesServiceCriterionAllStates: z.boolean().nullable(),
    firstFailureDate: z.string().nullable().optional(),
    firstFailureAnalogueYear: z.number().int().nullable().optional(),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((cell, ctx) => {
    if (!cell.calendarValid) {
      if (
        cell.worstStateDeficitMm !== null ||
        cell.medianStateDeficitMm !== null ||
        cell.wetStateDeficitMm !== null ||
        cell.passesServiceCriterionAllStates !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Calendar-invalid FieldYearPlanCell must never carry numeric deficit or PASS/FAIL status.',
        });
      }
    }
  });

export const ScenarioStateOutcomeSchema = z
  .object({
    stateId: z.string().min(1),
    analogueYear: z.union([z.literal(2018), z.literal(2006), z.literal(2012)]),
    analogueLabel: z.string().min(1),
    waterResourceRegime: z.enum(['BASE_ALLOCATION', 'WATER_LOW_RESTRICTION', 'WATER_HIGH_BUFFER']),
    nativeVariant: z.enum(['BASE', 'WATER_LOW', 'WATER_HIGH']).optional(),
    calendarVariant: z.string().min(1),
    isNumericValid: z.boolean(),
    invalidReason: z.string().min(1).optional(),
    passesServiceCriterion: z.boolean().nullable(),
    totalEtShortfallM3Eq: z.number().finite().nonnegative().nullable(),
    regretM3Eq: z.number().finite().nonnegative().nullable(),
    sourceWithdrawalM3: z.number().finite().nonnegative().nullable(),
    bindingFieldId: z.string().nullable(),
    bindingFieldDeficitMm: z.number().finite().nonnegative().nullable(),
    earliestFailureDate: z.string().nullable(),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if (!outcome.isNumericValid) {
      if (
        outcome.passesServiceCriterion !== null ||
        outcome.totalEtShortfallM3Eq !== null ||
        outcome.regretM3Eq !== null ||
        outcome.sourceWithdrawalM3 !== null ||
        outcome.bindingFieldDeficitMm !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid-calendar or non-numeric ScenarioStateOutcome must preserve null metrics and null pass flag.',
        });
      }
    }
  });

export const CandidatePolicyResultSchema = z
  .object({
    policyId: z.string().min(1),
    shortLabel: z.string().min(1),
    rotationSummary: z.string().min(1),
    isComparable: z.boolean(),
    calendarInvalidCount: z.number().int().nonnegative(),
    calendarInvalidReason: z.string().min(1).optional(),
    numericStatesEvaluated: z.number().int().nonnegative(),
    statesPassedCount: z.number().int().nonnegative(),
    statesFailedCount: z.number().int().nonnegative(),
    passesAllTestedScenarios: z.boolean(),
    worstEtShortfallM3Eq: z.number().finite().nonnegative().nullable(),
    maxRegretM3Eq: z.number().finite().nonnegative().nullable(),
    meanSourceWithdrawalM3: z.number().finite().nonnegative().nullable(),
    isParetoNonDominated: z.boolean(),
    rankByWorstShortfall: z.number().int().positive().nullable(),
    rankByMinimaxRegret: z.number().int().positive().nullable(),
    highlightTag: z
      .enum(['LEAST_WORST_SHORTFALL', 'MINIMAX_REGRET_SELECTION', 'PARETO_ALTERNATIVE', 'CALENDAR_EXCLUDED'])
      .optional(),
    fieldYearMatrix: z.array(FieldYearPlanCellSchema).min(1),
    scenarioOutcomes: z.array(ScenarioStateOutcomeSchema).min(1),
    evidenceIds: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.statesPassedCount + policy.statesFailedCount !== policy.numericStatesEvaluated) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numericStatesEvaluated'],
        message: 'statesPassedCount + statesFailedCount must equal numericStatesEvaluated.',
      });
    }
    if (!policy.isComparable) {
      if (
        policy.worstEtShortfallM3Eq !== null ||
        policy.maxRegretM3Eq !== null ||
        policy.meanSourceWithdrawalM3 !== null ||
        policy.rankByWorstShortfall !== null ||
        policy.rankByMinimaxRegret !== null ||
        policy.passesAllTestedScenarios
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Calendar-invalid policy must never receive numeric scores, ranks, or passing eligibility.',
        });
      }
      if (!policy.scenarioOutcomes.some((s) => !s.isNumericValid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenarioOutcomes'],
          message: 'Non-comparable policy must retain explicit invalid scenario witnesses.',
        });
      }
    } else if (
      policy.worstEtShortfallM3Eq === null ||
      policy.maxRegretM3Eq === null ||
      policy.meanSourceWithdrawalM3 === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Comparable policy must report finite non-negative objective metrics.',
      });
    }
    if (policy.passesAllTestedScenarios && policy.statesFailedCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['passesAllTestedScenarios'],
        message: 'Policy with failing scenarios cannot pass all tested scenarios.',
      });
    }
  });

export const M14DecisionDatasetSchema = z
  .object({
    schemaId: z.literal('astragron.m14.response.v1'),
    datasetMode: DatasetOperatingModeSchema,
    syntheticDisclosure: z.string().min(10),
    fieldValidated: z.literal(false),
    caseId: z.string().min(1),
    caseTitle: z.string().min(1),
    siteId: z.string().min(1),
    evaluatedAt: z.string().min(1),
    serviceCriterionFeasibility: z.enum([
      'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION',
      'FEASIBLE_SUBSET',
      'NOT_EVALUATED',
    ]),
    fieldRecommendationEligibility: z.literal('BLOCKED'),
    fieldRecommendationBlockedReasons: z.array(z.string().min(1)).min(1),
    portfolioSummary: z.object({
      totalPolicies: z.number().int().positive(),
      totalPoliciesTested: z.number().int().positive().optional(),
      totalScenarioStates: z.number().int().positive(),
      totalPolicyStateCases: z.number().int().positive(),
      numericValidCases: z.number().int().nonnegative(),
      calendarInvalidCases: z.number().int().nonnegative(),
      numericPassCases: z.number().int().nonnegative(),
      numericFailCases: z.number().int().nonnegative(),
      policiesPassingAllStates: z.number().int().nonnegative(),
      universalPassPoliciesCount: z.number().int().nonnegative().optional(),
      comparablePoliciesCount: z.number().int().nonnegative(),
      excludedCalendarPoliciesCount: z.number().int().nonnegative(),
    }),
    referenceSelections: z.object({
      leastWorstShortfallPolicyId: z.string().min(1),
      leastWorstShortfallValueM3Eq: z.number().finite().nonnegative(),
      minimaxRegretPolicyId: z.string().min(1),
      minimaxRegretValueM3Eq: z.number().finite().nonnegative(),
      nonIrrigableFieldId: z.string().min(1),
      nonIrrigableDryDeficitMm: z.number().finite().nonnegative(),
      assumedServiceThresholdMm: z.number().finite().positive(),
    }),
    scientificMeta: z
      .object({
        sourceSchema: z.string().min(1),
        protocolSha256: z.string().regex(/^[a-f0-9]{64}$/i),
        receiptFilesSha256: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/i)),
        canonicalSiteId: z.literal('SE_UPPSALA'),
        paretoFrontierIds: z.array(z.string().min(1)).min(1),
        resourceSensitivityBracket: z.object({
          representativePolicyId: z.string().min(1),
          lastFailingGridMm: z.string().min(1),
          firstPassingGridMm: z.string().min(1),
          rawMaxModelDeficitMm: z.number().finite().nonnegative(),
          finiteDeliveryGridM3Day: z.array(z.number().finite().positive()).min(1),
          serviceLimitMm: z.string().min(1),
        }),
        inSampleSelectionNote: z.string().min(1),
        crossPlatformCaveat: z.string().min(1),
        environmentNote: z.string().min(1),
      })
      .optional(),
    policies: z.array(CandidatePolicyResultSchema).min(1),
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const seen = new Set<string>();
    for (const pol of dataset.policies) {
      if (seen.has(pol.policyId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['policies'],
          message: `Duplicate policyId rejected: ${pol.policyId}`,
        });
      }
      seen.add(pol.policyId);
    }

    const s = dataset.portfolioSummary;
    if (s.totalPolicies !== dataset.policies.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portfolioSummary', 'totalPolicies'],
        message: 'portfolioSummary.totalPolicies must match policies.length.',
      });
    }
    if (s.comparablePoliciesCount + s.excludedCalendarPoliciesCount !== s.totalPolicies) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portfolioSummary', 'comparablePoliciesCount'],
        message: 'comparable + excluded policies must equal totalPolicies.',
      });
    }
    if (s.numericValidCases + s.calendarInvalidCases !== s.totalPolicyStateCases) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portfolioSummary', 'totalPolicyStateCases'],
        message: 'numericValidCases + calendarInvalidCases must equal totalPolicyStateCases.',
      });
    }
    if (s.numericPassCases + s.numericFailCases !== s.numericValidCases) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['portfolioSummary', 'numericValidCases'],
        message: 'numericPassCases + numericFailCases must equal numericValidCases.',
      });
    }
    if (
      dataset.serviceCriterionFeasibility === 'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION' &&
      (s.policiesPassingAllStates !== 0 || dataset.policies.some((p) => p.passesAllTestedScenarios))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceCriterionFeasibility'],
        message: 'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION cannot report a passing policy.',
      });
    }
    if (dataset.datasetMode === 'RECORDED_M14_RESEARCH' && !dataset.scientificMeta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scientificMeta'],
        message: 'RECORDED_M14_RESEARCH dataset must include SHA-verified scientificMeta.',
      });
    }
  });

export const DailyClimateSeriesPointSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayOfYear: z.number().int().min(1).max(366),
    analogueYear: z.union([z.literal(2018), z.literal(2006), z.literal(2012)]),
    precipMm: z.number().finite().nonnegative().nullable(),
    t2mMinC: z.number().finite().min(-80).max(65).nullable(),
    t2mMaxC: z.number().finite().min(-80).max(65).nullable(),
    et0Mm: z.number().finite().nonnegative().nullable(),
    etcMm: z.number().finite().nonnegative().nullable(),
    etaMm: z.number().finite().nonnegative().nullable(),
    rootZoneDeficitMm: z.number().finite().nonnegative().nullable(),
    deliveredIrrigationMm: z.number().finite().nonnegative().nullable(),
    qualityFlag: z.enum(['OK', 'MISSING_NULL', 'INTERPOLATED']).optional(),
  })
  .strict()
  .superRefine((pt, ctx) => {
    if (pt.t2mMinC !== null && pt.t2mMaxC !== null && pt.t2mMinC > pt.t2mMaxC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['t2mMinC'],
        message: 't2mMinC cannot exceed t2mMaxC.',
      });
    }
  });

export const ClimateAnalogueSummarySchema = z
  .object({
    analogueYear: z.union([z.literal(2018), z.literal(2006), z.literal(2012)]),
    classification: z.enum(['DRY_ANALOGUE', 'MEDIAN_ANALOGUE', 'WET_ANALOGUE']),
    label: z.string().min(1),
    seasonalPrecipMm: z.number().finite().nonnegative(),
    seasonalEt0Mm: z.number().finite().nonnegative().nullable(),
    peakF1DeficitMm: z.number().finite().nonnegative(),
    firstThresholdBreachDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    meanTempC: z.number().finite().min(-60).max(60),
    evidenceId: z.string().min(1),
  })
  .strict();

export const ClimateWaterDatasetSchema = z
  .object({
    siteId: z.string().min(1),
    locationLabel: z.string().optional(),
    datasetMode: DatasetOperatingModeSchema,
    syntheticDisclosure: z.string().min(10),
    analogueYearsNote: z.string().min(1),
    timeWindowLabel: z.string().min(1),
    units: z
      .object({
        precipitation: z.literal('mm/day'),
        temperature: z.literal('°C'),
        evapotranspiration: z.literal('mm/day'),
        deficit: z.literal('mm'),
        volume: z.literal('m³ equivalent'),
      })
      .strict(),
    analogueSummaries: z.array(ClimateAnalogueSummarySchema).min(1),
    seriesByAnalogue: z
      .object({
        '2018': z.array(DailyClimateSeriesPointSchema),
        '2006': z.array(DailyClimateSeriesPointSchema),
        '2012': z.array(DailyClimateSeriesPointSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((ds, ctx) => {
    const years = new Set<number>();
    for (const s of ds.analogueSummaries) {
      if (years.has(s.analogueYear)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['analogueSummaries'],
          message: `Duplicate analogueYear summary: ${s.analogueYear}`,
        });
      }
      years.add(s.analogueYear);
    }
  });

function fnv1aHexPair(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `rev-${part1}${part2}`;
}

function roundCoordPair(pair: [number, number]): [number, number] {
  return [Number(pair[0].toFixed(6)), Number(pair[1].toFixed(6))];
}

function canonicalizeGeometry(
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): unknown {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((pt) => roundCoordPair([pt[0] ?? 0, pt[1] ?? 0]))
      ),
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((poly) =>
      poly.map((ring) => ring.map((pt) => roundCoordPair([pt[0] ?? 0, pt[1] ?? 0])))
    ),
  };
}

export function canonicalizeFarmDraftInputs(draft: UserFarmDraft): unknown {
  return {
    site: {
      longitude: Number(draft.site.longitude.toFixed(6)),
      latitude: Number(draft.site.latitude.toFixed(6)),
      crs: draft.site.crs,
    },
    waterContext: {
      sharedDailyDeliveryM3: draft.waterContext.sharedDailyDeliveryM3.value ?? null,
      seasonalQuotaM3: draft.waterContext.seasonalQuotaM3.value ?? null,
      serviceThresholdMm: draft.waterContext.serviceThresholdMm.value ?? null,
      waterResourceRegime: draft.waterContext.waterResourceRegime ?? 'BASE',
      waterSourceType: draft.waterContext.waterSourceType,
      legalRightsVerified: Boolean(draft.waterContext.legalRightsVerified),
    },
    fields: draft.fields.map((f) => ({
      id: f.id,
      declaredAreaHa: f.declaredAreaHa === null ? null : Number(f.declaredAreaHa.toFixed(4)),
      areaBasis: f.areaBasis,
      irrigationAccess: f.irrigationAccess,
      soilTexture: f.soilTexture.value ?? null,
      soilDepthMm: f.soilDepthMm.value ?? null,
      organicCarbonPct: f.organicCarbonPct.value ?? null,
      soilPh: f.soilPh.value ?? null,
      mineralNo3KgHa: f.mineralNo3KgHa.value ?? null,
      nitrogenBasis: f.nitrogenBasis,
      initialRootZoneMm: f.initialRootZoneMm.value ?? null,
      previousCrops: [...(f.previousCrops ?? [])],
      candidateCrops: [...(f.candidateCrops ?? [])],
      plannedSowingDate: f.plannedSowingDate ?? null,
      plannedHarvestDate: f.plannedHarvestDate ?? null,
      geometry: canonicalizeGeometry(f.geometry),
    })),
  };
}

/**
 * Computes a deterministic canonical revision fingerprint over physical & agronomic
 * scenario inputs so any change to site coordinates, polygon vertices, field areas,
 * crop rotations, soil assays, or water constraints invalidates cached static outputs.
 */
export function computeDraftInputRevision(draft: UserFarmDraft): string {
  return fnv1aHexPair(JSON.stringify(canonicalizeFarmDraftInputs(draft)));
}

export function detectDraftModificationReasons(
  draft: UserFarmDraft,
  referenceDraft: UserFarmDraft
): string[] {
  const reasons: string[] = [];
  if (
    Math.abs(draft.site.longitude - referenceDraft.site.longitude) > 1e-5 ||
    Math.abs(draft.site.latitude - referenceDraft.site.latitude) > 1e-5
  ) {
    reasons.push('Site coordinates changed from reference fixture');
  }
  const refArea = referenceDraft.fields.reduce((s, f) => s + (f.declaredAreaHa ?? 0), 0);
  const curArea = draft.fields.reduce((s, f) => s + (f.declaredAreaHa ?? 0), 0);
  if (draft.fields.length !== referenceDraft.fields.length) {
    reasons.push(`Field count changed (${referenceDraft.fields.length} -> ${draft.fields.length})`);
  } else if (Math.abs(curArea - refArea) > 0.01) {
    reasons.push(`Declared farm area changed (${refArea.toFixed(1)} ha -> ${curArea.toFixed(1)} ha)`);
  }
  const hasGeometryEdit = draft.fields.some(
    (f, idx) =>
      JSON.stringify(canonicalizeGeometry(f.geometry)) !==
      JSON.stringify(canonicalizeGeometry(referenceDraft.fields[idx]?.geometry))
  );
  if (hasGeometryEdit) {
    reasons.push('Field polygon geometry edited from reference specification');
  }
  if (
    draft.waterContext.seasonalQuotaM3.value !== referenceDraft.waterContext.seasonalQuotaM3.value ||
    draft.waterContext.sharedDailyDeliveryM3.value !==
      referenceDraft.waterContext.sharedDailyDeliveryM3.value ||
    draft.waterContext.serviceThresholdMm.value !== referenceDraft.waterContext.serviceThresholdMm.value ||
    (draft.waterContext.waterResourceRegime ?? 'BASE') !==
      (referenceDraft.waterContext.waterResourceRegime ?? 'BASE') ||
    draft.waterContext.legalRightsVerified !== referenceDraft.waterContext.legalRightsVerified
  ) {
    reasons.push('Water allocation, regime, or service threshold modified');
  }
  const hasFieldParamEdit = draft.fields.some((f, idx) => {
    const refF = referenceDraft.fields[idx];
    if (!refF) return true;
    return (
      f.irrigationAccess !== refF.irrigationAccess ||
      f.soilTexture.value !== refF.soilTexture.value ||
      f.mineralNo3KgHa.value !== refF.mineralNo3KgHa.value ||
      f.plannedSowingDate !== refF.plannedSowingDate ||
      f.plannedHarvestDate !== refF.plannedHarvestDate ||
      JSON.stringify(f.candidateCrops) !== JSON.stringify(refF.candidateCrops) ||
      JSON.stringify(f.previousCrops) !== JSON.stringify(refF.previousCrops)
    );
  });
  if (hasFieldParamEdit && !hasGeometryEdit && draft.fields.length === referenceDraft.fields.length) {
    reasons.push('Field soil, crop, irrigation, or sowing/harvest parameters modified');
  }
  if (reasons.length === 0 && computeDraftInputRevision(draft) !== computeDraftInputRevision(referenceDraft)) {
    reasons.push('Draft input revision differs from canonical reference fixture');
  }
  return reasons;
}

export interface ParsedDmsResult {
  valid: boolean;
  decimal: number | null;
  direction?: 'N' | 'S' | 'E' | 'W';
  degrees?: number;
  minutes?: number;
  seconds?: number;
  error?: string;
}

/**
 * Strict signed-DMS / decimal coordinate parser.
 * Supports `-17° 30' 00"`, `-12° 20' 00"`, `59° 51' 31" N`, `-0° 30' 00"`,
 * leading/trailing hemisphere letters, comma or dot decimal separators, and plain decimals.
 * Rejects sign/hemisphere conflicts (e.g. `-17° E` or `+17° W`), wrong axis letters,
 * out-of-range degrees/minutes/seconds, and multi-sign strings.
 */
export function parseDmsCoordinateString(
  rawInput: string,
  axis: 'LON' | 'LAT'
): ParsedDmsResult {
  const raw = rawInput.trim();
  if (!raw) {
    return { valid: false, decimal: null, error: 'Coordinate input cannot be empty.' };
  }

  const normalized = raw
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/,/g, '.')
    .toUpperCase();

  // Extract explicit hemisphere letters (reject multiple conflicting letters)
  const dirMatches = normalized.match(/[NSEW]/g) ?? [];
  if (dirMatches.length > 1) {
    return {
      valid: false,
      decimal: null,
      error: 'Multiple hemisphere indicators found; supply a single N/S or E/W letter.',
    };
  }
  const explicitDir = dirMatches[0] as 'N' | 'S' | 'E' | 'W' | undefined;
  if (explicitDir) {
    if (axis === 'LAT' && (explicitDir === 'E' || explicitDir === 'W')) {
      return {
        valid: false,
        decimal: null,
        error: `Latitude cannot use '${explicitDir}' hemisphere (expected N/S or signed numeric).`,
      };
    }
    if (axis === 'LON' && (explicitDir === 'N' || explicitDir === 'S')) {
      return {
        valid: false,
        decimal: null,
        error: `Longitude cannot use '${explicitDir}' hemisphere (expected E/W or signed numeric).`,
      };
    }
  }

  // Detect all explicit +/- signs
  const signMatches = normalized.match(/[+-]/g) ?? [];
  if (signMatches.length > 1) {
    return {
      valid: false,
      decimal: null,
      error: 'Multiple +/- signs found in coordinate string.',
    };
  }
  const strippedLeading = normalized.replace(/^[NSEW]\s*/, '');
  const hasMinus = strippedLeading.startsWith('-') || normalized.includes('-');
  const hasPlus = strippedLeading.startsWith('+') || normalized.includes('+');

  if (hasMinus && !normalized.match(/^\s*(?:[NSEW]\s*)?-/)) {
    return {
      valid: false,
      decimal: null,
      error: 'Minus sign may only precede degrees, not minutes or seconds.',
    };
  }
  if (hasPlus && !normalized.match(/^\s*(?:[NSEW]\s*)?\+/)) {
    return {
      valid: false,
      decimal: null,
      error: 'Plus sign may only precede degrees.',
    };
  }

  if (hasMinus && (explicitDir === 'N' || explicitDir === 'E')) {
    return {
      valid: false,
      decimal: null,
      error: `Conflicting sign and hemisphere: cannot combine '-' with '${explicitDir}'.`,
    };
  }
  if (hasPlus && (explicitDir === 'S' || explicitDir === 'W')) {
    return {
      valid: false,
      decimal: null,
      error: `Conflicting sign and hemisphere: cannot combine '+' with '${explicitDir}'.`,
    };
  }

  const bodyWithoutLetters = normalized.replace(/[NSEW]/g, '').replace(/[°'"′″`dmsDMS:]/g, ' ');
  if (/[^0-9.+\-\s]/.test(bodyWithoutLetters)) {
    return {
      valid: false,
      decimal: null,
      error: 'Coordinate contains unsupported characters.',
    };
  }

  const parts = bodyWithoutLetters
    .replace(/^[+-]\s*/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0 || parts.length > 3) {
    return {
      valid: false,
      decimal: null,
      error: 'Enter decimal degrees or up to 3 numeric DMS parts (deg min sec).',
    };
  }

  const deg = Number(parts[0]);
  const min = parts.length >= 2 ? Number(parts[1]) : 0;
  const sec = parts.length === 3 ? Number(parts[2]) : 0;

  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) {
    return { valid: false, decimal: null, error: 'Non-numeric degree/minute/second value.' };
  }
  if (parts.length > 1 && (!Number.isInteger(deg) || (parts.length === 3 && !Number.isInteger(min)))) {
    return {
      valid: false,
      decimal: null,
      error: 'Degrees (and minutes when seconds are present) must be whole integers in DMS notation.',
    };
  }
  if (min < 0 || min >= 60) {
    return { valid: false, decimal: null, error: 'Minutes must be in [0, 60).' };
  }
  if (sec < 0 || sec >= 60) {
    return { valid: false, decimal: null, error: 'Seconds must be in [0, 60).' };
  }

  const absDec = deg + min / 60 + sec / 3600;
  const maxAbs = axis === 'LAT' ? 90 : 180;
  if (absDec > maxAbs) {
    return {
      valid: false,
      decimal: null,
      error: `${axis === 'LAT' ? 'Latitude' : 'Longitude'} magnitude exceeds ±${maxAbs}°.`,
    };
  }

  const isNegative = hasMinus || explicitDir === 'S' || explicitDir === 'W';
  const signedDec = absDec === 0 ? 0 : isNegative ? -absDec : absDec;
  const resolvedDir: 'N' | 'S' | 'E' | 'W' =
    explicitDir ??
    (axis === 'LAT' ? (hasMinus ? 'S' : 'N') : hasMinus ? 'W' : 'E');

  return {
    valid: true,
    decimal: Number(signedDec.toFixed(6)) === 0 ? 0 : Number(signedDec.toFixed(6)),
    direction: resolvedDir,
    degrees: deg,
    minutes: min,
    seconds: sec,
  };
}

/**
 * Validates external URLs for safe href usage (blocks javascript:, data:, vbscript:, relative protocol-less tricks).
 */
export function isSafeExternalUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export const M4_MAX_VERTICES = 2048;
export const M4_MAX_PAYLOAD_BYTES = 65536;

export interface GeoJsonValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  vertexCount: number;
  crossesAntimeridian: boolean;
  selfIntersecting?: boolean;
  estimatedAreaHa?: number;
  estimatedAreaHectares?: number;
  normalizedGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/**
 * Checks if two 2D line segments (p1-p2) and (p3-p4) properly intersect.
 */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  const ccw = (a: [number, number], b: [number, number], c: [number, number]) =>
    (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
    ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

/**
 * Spherical cosine-latitude planar approximation for polygon area in hectares.
 * Explicitly labeled GEOMETRY_DERIVED_ESTIMATE (uncertified).
 */
export function estimatePolygonAreaHectares(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | [number, number][]
): number {
  const unwrapRing = (ring: number[][]): number[][] => {
    if (ring.length === 0) return [];
    const unwrapped: number[][] = [[ring[0]![0] ?? 0, ring[0]![1] ?? 0]];
    for (let i = 1; i < ring.length; i++) {
      const prevLon = unwrapped[i - 1]![0]!;
      let lon = ring[i]![0] ?? 0;
      const lat = ring[i]![1] ?? 0;
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
      unwrapped.push([lon, lat]);
    }
    return unwrapped;
  };

  const calcRingHa = (ring: number[][]): number => {
    if (ring.length < 4) return 0;
    const norm = unwrapRing(ring);
    const meanLatRad =
      (norm.reduce((acc, pt) => acc + (pt[1] ?? 0), 0) / norm.length) *
      (Math.PI / 180);
    const metersPerDegLat = 111132.92;
    const metersPerDegLon = 111412.84 * Math.cos(meanLatRad);
    let areaM2 = 0;
    for (let i = 0; i < norm.length - 1; i++) {
      const x1 = (norm[i]![0] ?? 0) * metersPerDegLon;
      const y1 = (norm[i]![1] ?? 0) * metersPerDegLat;
      const x2 = (norm[i + 1]![0] ?? 0) * metersPerDegLon;
      const y2 = (norm[i + 1]![1] ?? 0) * metersPerDegLat;
      areaM2 += x1 * y2 - x2 * y1;
    }
    return Math.abs(areaM2) / 20000; // 1 ha = 10,000 m²
  };

  const calcPolyHa = (coords: number[][][]): number => {
    if (!coords[0]) return 0;
    let total = calcRingHa(coords[0]);
    for (let h = 1; h < coords.length; h++) {
      total -= calcRingHa(coords[h]!);
    }
    return Math.max(0, total);
  };

  if (Array.isArray(geom)) {
    return Number(calcRingHa(geom).toFixed(2));
  }

  if (geom.type === 'Polygon') {
    return Number(calcPolyHa(geom.coordinates).toFixed(2));
  }
  let total = 0;
  for (const poly of geom.coordinates) {
    total += calcPolyHa(poly);
  }
  return Number(total.toFixed(2));
}

export function validateFieldGeoJson(rawText: string): GeoJsonValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawText || !rawText.trim()) {
    return { valid: false, errors: ['GeoJSON input is empty.'], warnings, vertexCount: 0, crossesAntimeridian: false };
  }

  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength > M4_MAX_PAYLOAD_BYTES) {
    return {
      valid: false,
      errors: [`GeoJSON payload exceeds M4 adapter bound of ${M4_MAX_PAYLOAD_BYTES} bytes (received ${byteLength} bytes).`],
      warnings,
      vertexCount: 0,
      crossesAntimeridian: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      errors: ['Malformed JSON syntax. Verify brackets, quotes, and coordinate arrays.'],
      warnings,
      vertexCount: 0,
      crossesAntimeridian: false,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, errors: ['Root GeoJSON must be a JSON object.'], warnings, vertexCount: 0, crossesAntimeridian: false };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.crs && typeof obj.crs === 'object') {
    const crsName = JSON.stringify(obj.crs);
    if (!crsName.includes('4326') && !crsName.includes('CRS84')) {
      errors.push(`Unsupported Coordinate Reference System (${crsName}). Only WGS84 (EPSG:4326) is accepted.`);
    }
  }

  let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;

  if (obj.type === 'Polygon' || obj.type === 'MultiPolygon') {
    geometry = obj as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  } else if (obj.type === 'Feature' && obj.geometry && typeof obj.geometry === 'object') {
    const geom = obj.geometry as Record<string, unknown>;
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      geometry = geom as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    } else {
      errors.push(`Unsupported Feature geometry type "${String(geom.type)}". Only Polygon or MultiPolygon is accepted.`);
    }
  } else if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    if (obj.features.length === 0) {
      errors.push('FeatureCollection contains zero features.');
    } else {
      const firstFeature = obj.features[0] as Record<string, unknown>;
      if (firstFeature?.geometry && typeof firstFeature.geometry === 'object') {
        const geom = firstFeature.geometry as Record<string, unknown>;
        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
          geometry = geom as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
          if (obj.features.length > 1) {
            warnings.push(`FeatureCollection contains ${obj.features.length} features; M4 adapter evaluates 1 field boundary per query (selected first feature).`);
          }
        } else {
          errors.push(`Unsupported FeatureCollection geometry type "${String(geom.type)}".`);
        }
      } else {
        errors.push('First feature in FeatureCollection is missing a valid geometry object.');
      }
    }
  } else {
    errors.push('GeoJSON must be a Polygon, MultiPolygon, Feature, or FeatureCollection.');
  }

  if (!geometry || errors.length > 0) {
    return { valid: false, errors, warnings, vertexCount: 0, crossesAntimeridian: false };
  }

  let vertexCount = 0;
  let crossesAntimeridian = false;
  let selfIntersecting = false;

  const validateRing = (ring: unknown, ringLabel: string) => {
    if (!Array.isArray(ring)) {
      errors.push(`${ringLabel} must be an array of [longitude, latitude] coordinate pairs.`);
      return;
    }
    if (ring.length < 4) {
      errors.push(`${ringLabel} must have at least 4 positions (3 distinct vertices plus closing vertex).`);
      return;
    }
    let prevLon: number | null = null;
    const validPts: [number, number][] = [];

    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      if (!Array.isArray(pt) || pt.length < 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
        errors.push(`${ringLabel} vertex ${i} is not a numeric [longitude, latitude] pair.`);
        continue;
      }
      const [lon, lat] = pt;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        errors.push(`${ringLabel} vertex ${i} contains non-finite numbers.`);
        continue;
      }
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        if (Math.abs(lon) > 1000 || Math.abs(lat) > 1000) {
          errors.push(
            `${ringLabel} vertex ${i} [${lon}, ${lat}] appears to be in projected meters (e.g., EPSG:3857 Web Mercator) rather than WGS84 decimal degrees (EPSG:4326).`
          );
        } else {
          if (lon < -180 || lon > 180) {
            errors.push(`${ringLabel} vertex ${i} longitude ${lon} is outside [-180, 180] (ensure [longitude, latitude] order).`);
          }
          if (lat < -90 || lat > 90) {
            errors.push(`${ringLabel} vertex ${i} latitude ${lat} is outside [-90, 90] (ensure [longitude, latitude] order).`);
          }
        }
      }
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        crossesAntimeridian = true;
      }
      prevLon = lon;
      validPts.push([lon, lat]);
      vertexCount++;
    }

    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Array.isArray(first) && Array.isArray(last)) {
      if (first[0] !== last[0] || first[1] !== last[1]) {
        errors.push(`${ringLabel} is not closed: first coordinate [${first[0]}, ${first[1]}] must equal last coordinate [${last[0]}, ${last[1]}].`);
      }
    }

    // Check for self-intersecting edges (bowtie polygons)
    const segCount = validPts.length - 1;
    if (segCount >= 4 && errors.length === 0) {
      for (let i = 0; i < segCount; i++) {
        for (let j = i + 2; j < segCount; j++) {
          if (i === 0 && j === segCount - 1) continue; // adjacent at closing vertex
          if (
            segmentsIntersect(
              validPts[i]!,
              validPts[i + 1]!,
              validPts[j]!,
              validPts[j + 1]!
            )
          ) {
            selfIntersecting = true;
            errors.push(`${ringLabel} has self-intersecting edges (self-intersection) between segment ${i + 1} and segment ${j + 1}. Repair bowtie topology before importing.`);
            break;
          }
        }
      }
    }
  };

  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      errors.push('Polygon coordinates array is empty.');
    } else {
      geometry.coordinates.forEach((ring, idx) => validateRing(ring, `Polygon ring ${idx + 1}`));
    }
  } else if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      errors.push('MultiPolygon coordinates array is empty.');
    } else {
      geometry.coordinates.forEach((poly, pIdx) => {
        if (!Array.isArray(poly) || poly.length === 0) {
          errors.push(`MultiPolygon part ${pIdx + 1} is empty.`);
        } else {
          poly.forEach((ring, rIdx) => validateRing(ring, `MultiPolygon ${pIdx + 1} ring ${rIdx + 1}`));
        }
      });
    }
  }

  if (vertexCount > M4_MAX_VERTICES) {
    errors.push(`Geometry has ${vertexCount} vertices, exceeding the M4 adapter limit of ${M4_MAX_VERTICES}.`);
  }

  let estimatedAreaHa = 0;
  if (errors.length === 0) {
    estimatedAreaHa = estimatePolygonAreaHectares(geometry);
    if (estimatedAreaHa <= 0) {
      errors.push('Polygon has zero or degenerate geodesic area. Ensure vertices are distinct and non-collinear.');
    }
  }

  if (crossesAntimeridian) {
    warnings.push('Geometry crosses the ±180° antimeridian. Geodesic area is only an uncertified browser estimate; verify split rings before backend submission.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    vertexCount,
    crossesAntimeridian,
    selfIntersecting,
    estimatedAreaHa: errors.length === 0 ? estimatedAreaHa : undefined,
    estimatedAreaHectares: errors.length === 0 ? estimatedAreaHa : undefined,
    normalizedGeometry: errors.length === 0 ? geometry : undefined,
  };
}

export interface DmsInput {
  degrees: number;
  minutes: number;
  seconds: number;
  direction: 'N' | 'S' | 'E' | 'W';
}

export function convertDmsToDecimal(dms: DmsInput): { valid: boolean; decimal: number | null; error?: string } {
  const { degrees, minutes, seconds, direction } = dms;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return { valid: false, decimal: null, error: 'Degrees, minutes, and seconds must be finite numbers.' };
  }
  if (degrees < 0 || !Number.isInteger(degrees)) {
    return { valid: false, decimal: null, error: 'Degrees must be a non-negative integer.' };
  }
  if (minutes < 0 || minutes >= 60) {
    return { valid: false, decimal: null, error: 'Minutes must be between 0 and 59.' };
  }
  if (seconds < 0 || seconds >= 60) {
    return { valid: false, decimal: null, error: 'Seconds must be between 0 and < 60.' };
  }
  const absVal = degrees + minutes / 60 + seconds / 3600;
  const maxAllowed = direction === 'N' || direction === 'S' ? 90 : 180;
  if (absVal > maxAllowed) {
    return {
      valid: false,
      decimal: null,
      error: `${direction === 'N' || direction === 'S' ? 'Latitude' : 'Longitude'} magnitude cannot exceed ${maxAllowed}°.`,
    };
  }
  const sign = direction === 'S' || direction === 'W' ? -1 : 1;
  return { valid: true, decimal: Number((absVal * sign).toFixed(6)) };
}

export interface FarmDraftValidationInput {
  name?: string;
  longitude?: number;
  latitude?: number;
  site?: {
    longitude: number;
    latitude: number;
  };
  fields: Array<{
    id: string;
    label?: string;
    declaredAreaHa?: number | null;
    areaHectares?: number | null;
    mineralNo3KgHa?: number | null | { value: number | null };
    nitrogenBasis?: string;
    sowingDate?: string;
    harvestDate?: string;
    plannedSowingDate?: string;
    plannedHarvestDate?: string;
    sowingMonthDay?: string;
    harvestMonthDay?: string;
  }>;
}

/**
 * Validates a UserFarmDraft or wizard summary input for coordinate bounds, positive field area,
 * valid nitrogen chemical basis, and valid sowing/harvest calendar dates.
 */
export function validateFarmSetupDraft(draft: FarmDraftValidationInput | UserFarmDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const lon = 'site' in draft && draft.site ? draft.site.longitude : (draft as FarmDraftValidationInput).longitude ?? 0;
  const lat = 'site' in draft && draft.site ? draft.site.latitude : (draft as FarmDraftValidationInput).latitude ?? 0;

  const coordCheck = CoordinatePairSchema.safeParse([lon, lat]);
  if (!coordCheck.success) {
    errors.push(...coordCheck.error.issues.map((i) => i.message));
  }
  if (!draft.fields || draft.fields.length === 0) {
    errors.push('At least one field parcel is required.');
  }
  for (const field of draft.fields) {
    const label = field.label ?? field.id;
    const area =
      field.declaredAreaHa !== undefined
        ? field.declaredAreaHa
        : (field as { areaHectares?: number | null }).areaHectares ?? null;
    if (area !== null && area <= 0) {
      errors.push(`Field "${label}" area must be greater than 0 ha.`);
    }
    const rawN = field.mineralNo3KgHa;
    const nVal =
      typeof rawN === 'object' && rawN !== null && 'value' in rawN
        ? rawN.value
        : (rawN as number | null | undefined) ?? null;

    if (nVal !== null && nVal < 0) {
      errors.push(`Field "${label}" mineral nitrogen cannot be negative.`);
    }
    if (
      field.nitrogenBasis === 'NITRATE_ION_NO3_KG_HA_UNSUPPORTED' ||
      (nVal !== null &&
        (field.nitrogenBasis === 'UNSPECIFIED_INVALID' ||
          field.nitrogenBasis === 'OXIDE_OR_NITRATE_COMPOUND'))
    ) {
      errors.push(
        `Field "${label}" uses an unsupported/unconverted nitrogen chemical basis (${field.nitrogenBasis}). Select elemental NO3-N / NH4-N (kg N/ha).`
      );
    }
    const sowStr =
      (field as { sowingDate?: string }).sowingDate ??
      field.plannedSowingDate ??
      ((field as { sowingMonthDay?: string }).sowingMonthDay
        ? `2027-${(field as { sowingMonthDay?: string }).sowingMonthDay}`
        : undefined);
    const harvStr =
      (field as { harvestDate?: string }).harvestDate ??
      field.plannedHarvestDate ??
      ((field as { harvestMonthDay?: string }).harvestMonthDay
        ? `2027-${(field as { harvestMonthDay?: string }).harvestMonthDay}`
        : undefined);

    if (sowStr && harvStr) {
      const sow = Date.parse(sowStr);
      const harv = Date.parse(harvStr);
      if (Number.isNaN(sow) || Number.isNaN(harv)) {
        errors.push(`Field "${label}" contains an invalid ISO date string.`);
      } else if (harv <= sow) {
        errors.push(
          `Field "${label}" harvest date (${harvStr}) must be after sowing date (${sowStr}).`
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
