import type * as GeoJSON from 'geojson';

/**
 * M4 Global Evidence Contract (`astragron.global-evidence.v1`)
 * and Scenario Decision Contract (`astragron.m14.response.v1`)
 * Strictly typed frontend domain layer — zero scientific computation in client.
 */

export const M4_SCHEMA_ID = 'astragron.global-evidence.v1' as const;
export const M14_PREFERENCE_SCHEMA_ID = 'astragron.m14.research-preference.v1' as const;
export const M14_DECISION_SCHEMA_ID = 'astragron.m14.decision.v1' as const;
export const M14_RESPONSE_SCHEMA_ID = 'astragron.m14.response.v1' as const;

export type DatasetOperatingMode =
  | 'SYNTHETIC_UI_DEMO'
  | 'RECORDED_M14_RESEARCH'
  | 'REAL_SCIENTIFIC_BACKEND';

export type RepositoryStatusCode =
  | 'OK_SYNTHETIC_DEMO'
  | 'OK_RECORDED_RESEARCH'
  | 'OK_COVERAGE_ONLY'
  | 'MODEL_UNQUALIFIED'
  | 'BACKEND_NOT_CONNECTED'
  | 'SOURCE_NOT_PROVIDED'
  | 'SITE_NOT_FOUND'
  | 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
  | 'NO_EVIDENCE_FOR_SITE';

export interface EvidenceScope {
  siteId: string;
  datasetMode: DatasetOperatingMode;
  layerId?: string | null;
}

export interface ScenarioInputIdentity {
  siteId: string;
  inputRevision: string;
  referenceRevision: string | null;
  inputsModified: boolean;
  derivedFromFixtureId?: string;
  modificationReasons?: string[];
}

export type CoverageStatus =
  | 'AVAILABLE'
  | 'CONDITIONAL'
  | 'INSUFFICIENT_EVIDENCE'
  | 'OUT_OF_COVERAGE'
  | 'TEMPORARILY_UNAVAILABLE';

export type EvidenceClass =
  | 'OBSERVED'
  | 'DERIVED'
  | 'REGIONAL_MODEL_EVIDENCE'
  | 'RESEARCH_ASSUMPTION'
  | 'MISSING_OR_UNQUALIFIED'
  | 'SYNTHETIC_UI_FIXTURE';

export type EvidencePurpose =
  | 'DESCRIPTIVE_CONTEXT'
  | 'FUTURE_CLIMATE_CONTEXT'
  | 'MODEL_INPUT_REVIEW';

export type ResearchPreference =
  | 'STRICT_ALL_SCENARIOS_SERVICE'
  | 'MINIMIZE_WORST_ET_SHORTFALL'
  | 'MINIMAX_REGRET'
  | 'PARETO_FRONTIER';

export type ResultAvailability =
  | 'READY'
  | 'PARTIAL'
  | 'EVIDENCE_INSUFFICIENT'
  | 'MODEL_UNQUALIFIED'
  | 'CALENDAR_INVALID'
  | 'COMPUTE_UNKNOWN'
  | 'UNAVAILABLE';

export type NasaPowerVariableId =
  | 'T2M_MIN'
  | 'T2M_MAX'
  | 'T2M'
  | 'PRECTOTCORR'
  | 'RH2M'
  | 'WS2M'
  | 'ALLSKY_SFC_SW_DWN'
  | 'PS';

export type AreaBasis =
  | 'USER_DECLARED_NOT_SURVEYED'
  | 'GEOMETRY_DERIVED_ESTIMATE';

export type NitrogenChemicalBasis =
  | 'NO3_N_AND_NH4_N_ELEMENTAL'
  | 'ELEMENTAL_N_KG_HA'
  | 'TOTAL_KJELDAHL_N'
  | 'OXIDE_OR_NITRATE_COMPOUND'
  | 'UNSPECIFIED_INVALID';

export interface FieldGeometry {
  point: [number, number]; // [longitude, latitude] in EPSG:4326
  polygon?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  crs: 'EPSG:4326';
  area_ha: number | null;
  area_basis: AreaBasis;
}

export interface SiteContext {
  site_id: string;
  geometry: FieldGeometry;
  as_of: string;
  purpose: EvidencePurpose;
  location_label: string;
  country_code: string;
  region_name: string;
  hemisphere: 'NORTHERN' | 'SOUTHERN';
}

export interface SeasonWindow {
  start: string;
  end: string;
  time_standard: string;
  basis: string;
}

export interface SourceCoverage {
  source_id: string;
  source_title: string;
  publisher: string;
  variable: string;
  variable_label: string;
  status: CoverageStatus;
  spatial_coverage: string;
  temporal_resolution: string;
  acquisition_status: string;
  inference_eligibility: 'ELIGIBLE_DESCRIPTIVE_ONLY' | 'CONDITIONAL_RESEARCH' | 'BLOCKED_FOR_FIELD_DECISION';
  reason: string;
  why_unavailable_detail?: string;
  site_id: string;
  requested_point: [number, number];
  observation_period: string;
  purpose: EvidencePurpose;
}

export interface EvidenceRecord {
  evidence_id: string;
  site_id: string;
  dataset_mode: DatasetOperatingMode;
  source: string;
  product_version: string;
  variable: string;
  variable_label: string;
  evidence_class: EvidenceClass;
  spatial_support: string;
  period: string;
  timezone: string;
  available_at: string;
  units: string;
  quality: string;
  missingness_summary: string;
  uncertainty: string;
  license: string;
  source_sha256: string | null;
  extraction_recipe: string;
  samples: Array<{ date: string; value: number | null }>;
  limitations: string[];
  supports_components: string[];
}

export interface CapabilityAssessment {
  capability: string;
  capability_label: string;
  status: CoverageStatus;
  evidence_ids: string[];
  requirements_missing: string[];
  scientific_scope: string;
}

export interface EvidenceAwareInput<T> {
  value: T | null;
  unit?: string;
  evidenceClass: EvidenceClass;
  measuredAt?: string;
  sourceId?: string;
  method?: string;
  missingReason?: string;
}

export type FieldGeometrySource =
  | 'USER_DRAWN'
  | 'USER_RECTANGLE_APPROX'
  | 'USER_GPS_TRACE'
  | 'USER_IMPORT'
  | 'AI_PREDICTION_FTW'
  | 'REFERENCE_PRESET';

export interface UserFieldDraft {
  id: string;
  label: string;
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  geometrySource?: FieldGeometrySource;
  sourceDataset?: string | null;
  sourceYear?: number | null;
  modelConfidence?: number | null;
  geometryTimestamp?: string | null;
  userConfirmed?: boolean;
  perimeterMeters?: number | null;
  declaredAreaHa: number | null;
  areaBasis: AreaBasis;
  irrigationAccess: 'YES' | 'NO' | 'UNKNOWN';
  soilTexture: EvidenceAwareInput<string>;
  soilDepthMm: EvidenceAwareInput<number>;
  organicCarbonPct: EvidenceAwareInput<number>;
  soilPh: EvidenceAwareInput<number>;
  mineralNo3KgHa: EvidenceAwareInput<number>;
  nitrogenBasis?: NitrogenChemicalBasis;
  initialRootZoneMm: EvidenceAwareInput<number>;
  previousCrops: string[];
  candidateCrops: string[];
  plannedSowingDate?: string;
  plannedHarvestDate?: string;
  notes?: string;
}

export interface UserFarmDraft {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  fixturePresetId?: string;
  datasetMode?: DatasetOperatingMode;
  isUserCreatedDraft?: boolean;
  inputRevision?: string;
  inputsModified?: boolean;
  derivedFromFixtureId?: string;
  modificationReasons?: string[];
  site: {
    longitude: number;
    latitude: number;
    crs: 'EPSG:4326';
    locationLabel: string;
    countryCode: string;
    regionName: string;
    spatialPrecisionNote: string;
  };
  waterContext: {
    sharedDailyDeliveryM3: EvidenceAwareInput<number>;
    seasonalQuotaM3: EvidenceAwareInput<number>;
    serviceThresholdMm: EvidenceAwareInput<number>;
    waterResourceRegime?: 'BASE' | 'WATER_LOW' | 'WATER_HIGH' | 'BASE_ALLOCATION' | 'WATER_LOW_RESTRICTION' | 'WATER_HIGH_BUFFER';
    waterSourceType: 'SURFACE_CANAL' | 'GROUNDWATER_WELL' | 'RAINFED_ONLY' | 'MIXED_UNVERIFIED';
    legalRightsVerified: false; // Always false — legal eligibility is not established
  };
  fields: UserFieldDraft[];
  selectedPurpose: EvidencePurpose;
  selectedPreference: ResearchPreference;
  assumptionAcknowledged: boolean;
}

export interface FieldYearPlanCell {
  fieldId: string;
  fieldLabel: string;
  irrigationAccess: 'YES' | 'NO' | 'UNKNOWN';
  harvestYear: number; // 1..5
  yearLabel: string;
  cropCode: string;
  cropName: string;
  plantingWindow: string;
  harvestWindow: string;
  calendarValid: boolean;
  calendarInvalidReason?: string;
  worstStateDeficitMm: number | null; // null if calendar invalid
  medianStateDeficitMm: number | null;
  wetStateDeficitMm: number | null;
  serviceThresholdMm: number;
  passesServiceCriterionAllStates: boolean | null;
  firstFailureDate?: string | null;
  firstFailureAnalogueYear?: number | null;
  evidenceIds: string[];
}

export interface ScenarioStateOutcome {
  stateId: string;
  analogueYear: 2018 | 2006 | 2012;
  analogueLabel: string;
  waterResourceRegime: 'BASE_ALLOCATION' | 'WATER_LOW_RESTRICTION' | 'WATER_HIGH_BUFFER';
  nativeVariant?: 'BASE' | 'WATER_LOW' | 'WATER_HIGH';
  calendarVariant: string;
  isNumericValid: boolean;
  invalidReason?: string;
  passesServiceCriterion: boolean | null;
  totalEtShortfallM3Eq: number | null;
  regretM3Eq: number | null;
  sourceWithdrawalM3: number | null;
  bindingFieldId: string | null;
  bindingFieldDeficitMm: number | null;
  earliestFailureDate: string | null;
}

export interface CandidatePolicyResult {
  policyId: string;
  shortLabel: string;
  rotationSummary: string;
  isComparable: boolean;
  calendarInvalidCount: number;
  calendarInvalidReason?: string;
  numericStatesEvaluated: number;
  statesPassedCount: number;
  statesFailedCount: number;
  passesAllTestedScenarios: boolean;
  worstEtShortfallM3Eq: number | null;
  maxRegretM3Eq: number | null;
  meanSourceWithdrawalM3: number | null;
  isParetoNonDominated: boolean;
  rankByWorstShortfall: number | null;
  rankByMinimaxRegret: number | null;
  highlightTag?: 'LEAST_WORST_SHORTFALL' | 'MINIMAX_REGRET_SELECTION' | 'PARETO_ALTERNATIVE' | 'CALENDAR_EXCLUDED';
  fieldYearMatrix: FieldYearPlanCell[];
  scenarioOutcomes: ScenarioStateOutcome[];
  evidenceIds: string[];
}

export interface M14DecisionDataset {
  schemaId: typeof M14_RESPONSE_SCHEMA_ID;
  datasetMode: DatasetOperatingMode;
  syntheticDisclosure: string;
  fieldValidated: false;
  caseId: string;
  caseTitle: string;
  siteId: string;
  evaluatedAt: string;
  serviceCriterionFeasibility: 'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION' | 'FEASIBLE_SUBSET' | 'NOT_EVALUATED';
  fieldRecommendationEligibility: 'BLOCKED';
  fieldRecommendationBlockedReasons: string[];
  portfolioSummary: {
    totalPolicies: number;
    totalPoliciesTested?: number;
    totalScenarioStates: number;
    totalPolicyStateCases: number;
    numericValidCases: number;
    calendarInvalidCases: number;
    numericPassCases: number;
    numericFailCases: number;
    policiesPassingAllStates: number;
    universalPassPoliciesCount?: number;
    comparablePoliciesCount: number;
    excludedCalendarPoliciesCount: number;
  };
  referenceSelections: {
    leastWorstShortfallPolicyId: string;
    leastWorstShortfallValueM3Eq: number;
    minimaxRegretPolicyId: string;
    minimaxRegretValueM3Eq: number;
    nonIrrigableFieldId: string;
    nonIrrigableDryDeficitMm: number;
    assumedServiceThresholdMm: number;
  };
  scientificMeta?: {
    sourceSchema: string;
    protocolSha256: string;
    receiptFilesSha256: Record<string, string>;
    canonicalSiteId: 'SE_UPPSALA';
    paretoFrontierIds: string[];
    resourceSensitivityBracket: {
      representativePolicyId: string;
      lastFailingGridMm: string;
      firstPassingGridMm: string;
      rawMaxModelDeficitMm: number;
      finiteDeliveryGridM3Day: number[];
      serviceLimitMm: string;
    };
    inSampleSelectionNote: string;
    crossPlatformCaveat: string;
    environmentNote: string;
  };
  policies: CandidatePolicyResult[];
}

export interface DailyClimateSeriesPoint {
  date: string;
  dayOfYear: number;
  analogueYear: 2018 | 2006 | 2012;
  precipMm: number | null;
  t2mMinC: number | null;
  t2mMaxC: number | null;
  et0Mm: number | null;
  etcMm: number | null;
  etaMm: number | null;
  rootZoneDeficitMm: number | null;
  deliveredIrrigationMm: number | null;
  qualityFlag?: 'OK' | 'MISSING_NULL' | 'INTERPOLATED';
}

export interface ClimateWaterDataset {
  siteId: string;
  locationLabel?: string;
  datasetMode: DatasetOperatingMode;
  syntheticDisclosure: string;
  analogueYearsNote: string;
  timeWindowLabel: string;
  units: {
    precipitation: 'mm/day';
    temperature: '°C';
    evapotranspiration: 'mm/day';
    deficit: 'mm';
    volume: 'm³ equivalent';
  };
  analogueSummaries: Array<{
    analogueYear: 2018 | 2006 | 2012;
    classification: 'DRY_ANALOGUE' | 'MEDIAN_ANALOGUE' | 'WET_ANALOGUE';
    label: string;
    seasonalPrecipMm: number;
    seasonalEt0Mm: number | null;
    peakF1DeficitMm: number;
    firstThresholdBreachDate: string | null;
    meanTempC: number;
    evidenceId: string;
  }>;
  seriesByAnalogue: Record<'2018' | '2006' | '2012', DailyClimateSeriesPoint[]>;
}

export interface ResearchViewEnvelope<T> {
  uiSchemaVersion: string;
  datasetMode: DatasetOperatingMode;
  status: RepositoryStatusCode;
  statusCode: RepositoryStatusCode;
  statusReason: string;
  siteId: string;
  fixtureKind:
    | 'SYNTHETIC_UI_DEMO'
    | 'RECORDED_M14_RESEARCH'
    | 'RECORDED_M14_RESEARCH_DISABLED'
    | 'M4_GLOBAL_COVERAGE_RECORD'
    | 'BACKEND_NOT_CONNECTED';
  availability: ResultAvailability;
  fieldValidated: false;
  data: T | null;
  reasons: string[];
  missingRequirements: string[];
  upstreamSchema?: string;
  scientificReceipt?: {
    schema: string;
    protocolSha256?: string;
    receiptSha256?: string;
    canonicalSiteId?: string;
    generatedInEnvironment?: string;
    crossPlatformCaveat?: string;
    selectionBiasNote?: string;
  };
  provenance: Array<{
    sourceId: string;
    evidenceId?: string;
    asOf?: string;
  }>;
  inputIdentity?: ScenarioInputIdentity;
}
