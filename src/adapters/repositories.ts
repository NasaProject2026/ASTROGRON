import {
  M4_SCHEMA_ID,
  M14_RESPONSE_SCHEMA_ID,
  type CandidatePolicyResult,
  type ClimateWaterDataset,
  type DatasetOperatingMode,
  type EvidenceRecord,
  type M14DecisionDataset,
  type RepositoryStatusCode,
  type ResearchPreference,
  type ResearchViewEnvelope,
  type ResultAvailability,
  type UserFarmDraft,
} from '@/domain/contracts';
import type { EvidenceScope, ScenarioInputIdentity } from '@/domain/contracts';
import {
  M14DecisionDatasetSchema,
  ClimateWaterDatasetSchema,
  EvidenceRecordSchema,
  computeDraftInputRevision,
  detectDraftModificationReasons,
} from '@/domain/schemas';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  UPPSALA_REFERENCE_INPUT_REVISION,
  DEMO_SEARCH_INDEX,
  EVIDENCE_RECORDS_FIXTURE,
  EXPLORER_PRESET_SITES,
  type ExplorerPresetSite,
  type LocalGazetteerEntry,
} from '@/fixtures/sites-and-coverage';
import { SYNTHETIC_DECISION_DATASET } from '@/fixtures/m14-decision-fixture';
import { SYNTHETIC_UPPSALA_CLIMATE_FIXTURE } from '@/fixtures/climate-water-fixture';
import rawVerifiedSnapshot from '@/data/generated/verified-m14-m4-snapshot.json';

interface VerifiedRecordedBundle {
  valid: boolean;
  reason?: string;
  protocolSha256?: string;
  snapshotSha256?: string;
  decisionDataset?: M14DecisionDataset;
  climateDataset?: ClimateWaterDataset;
  m14EvidenceRecords?: EvidenceRecord[];
  m4Sites?: Record<string, {
    canonicalSiteId: string;
    siteContext: ExplorerPresetSite['siteContext'];
    capabilities: ExplorerPresetSite['capabilities'];
    sourceCoverages: ExplorerPresetSite['sourceCoverages'];
    evidenceRecords: EvidenceRecord[];
  }>;
  soilUnitConflictNote?: string;
  projectionControlNote?: string;
}

let cachedVerifiedBundle: VerifiedRecordedBundle | null = null;

function getVerifiedRecordedBundle(): VerifiedRecordedBundle {
  if (cachedVerifiedBundle) return cachedVerifiedBundle;
  try {
    const snap = rawVerifiedSnapshot as unknown as {
      verified?: boolean;
      m14ProtocolSha256?: string;
      snapshotSha256?: string;
      decisionDataset?: unknown;
      climateDataset?: unknown;
      m14EvidenceRecords?: unknown[];
      m4Catalog?: {
        sites?: Record<
          string,
          {
            canonicalSiteId: string;
            siteContext: ExplorerPresetSite['siteContext'];
            capabilities: ExplorerPresetSite['capabilities'];
            sourceCoverages: ExplorerPresetSite['sourceCoverages'];
            evidenceRecords: unknown[];
          }
        >;
        soilUnitConflictNote?: string;
        projectionControlNote?: string;
      };
    };

    if (!snap?.verified || !snap.decisionDataset || !snap.climateDataset || !snap.m4Catalog?.sites) {
      cachedVerifiedBundle = {
        valid: false,
        reason: 'Verified recorded M14/M4 snapshot metadata missing or marked unverified.',
      };
      return cachedVerifiedBundle;
    }

    const decisionDataset = M14DecisionDatasetSchema.parse(snap.decisionDataset) as M14DecisionDataset;
    const climateDataset = ClimateWaterDatasetSchema.parse(snap.climateDataset) as ClimateWaterDataset;
    const m14EvidenceRecords = (snap.m14EvidenceRecords ?? []).map(
      (r) => EvidenceRecordSchema.parse(r) as EvidenceRecord
    );

    const m4Sites: VerifiedRecordedBundle['m4Sites'] = {};
    for (const [uiId, siteBundle] of Object.entries(snap.m4Catalog.sites)) {
      m4Sites[uiId] = {
        canonicalSiteId: siteBundle.canonicalSiteId,
        siteContext: siteBundle.siteContext,
        capabilities: siteBundle.capabilities,
        sourceCoverages: siteBundle.sourceCoverages,
        evidenceRecords: siteBundle.evidenceRecords.map(
          (r) => EvidenceRecordSchema.parse(r) as EvidenceRecord
        ),
      };
    }

    cachedVerifiedBundle = {
      valid: true,
      protocolSha256: snap.m14ProtocolSha256,
      snapshotSha256: snap.snapshotSha256,
      decisionDataset,
      climateDataset,
      m14EvidenceRecords,
      m4Sites,
      soilUnitConflictNote: snap.m4Catalog.soilUnitConflictNote,
      projectionControlNote: snap.m4Catalog.projectionControlNote,
    };
    return cachedVerifiedBundle;
  } catch (err) {
    cachedVerifiedBundle = {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
    return cachedVerifiedBundle;
  }
}

export interface PreferenceSortedPortfolio {
  preference: ResearchPreference;
  selectionOutcome:
    | 'ZERO_FEASIBLE_POLICIES'
    | 'SINGLE_LEADER_SELECTED'
    | 'CONDITIONAL_SINGLE_LEADER'
    | 'NO_UNIQUE_WINNER';
  selectedLeaderPolicy: CandidatePolicyResult | null;
  paretoFrontierPolicies: CandidatePolicyResult[];
  comparablePoliciesOrdered: CandidatePolicyResult[];
  excludedCalendarPolicies: CandidatePolicyResult[];
  selectionHeadline: string;
  selectionDetail: string;
}

/**
 * Pure presentation sorting of candidate policies by declared preference.
 * Performs ZERO agronomic or hydrological calculation and never manufactures qualification.
 */
export function sortPoliciesByPreference(
  dataset: M14DecisionDataset,
  preference: ResearchPreference
): PreferenceSortedPortfolio {
  const comparable = dataset.policies.filter((p) => p.isComparable);
  const excluded = dataset.policies.filter((p) => !p.isComparable);
  const paretoSet = comparable.filter((p) => p.isParetoNonDominated);
  const isRecorded = dataset.datasetMode === 'RECORDED_M14_RESEARCH';
  const corpusLabel = isRecorded ? 'recorded M14 corpus' : 'synthetic UI set';
  const policyNoun = isRecorded ? 'tested recorded policies' : 'tested synthetic policies';

  if (preference === 'STRICT_ALL_SCENARIOS_SERVICE') {
    const passing = comparable.filter((p) => p.passesAllTestedScenarios);
    const ordered = [...comparable].sort(
      (a, b) => (a.rankByWorstShortfall ?? 999) - (b.rankByWorstShortfall ?? 999)
    );
    const passCount = passing.length;
    const totalCount = dataset.portfolioSummary.totalPolicies;
    const stateCount = dataset.portfolioSummary.totalScenarioStates;

    return {
      preference,
      selectionOutcome: passCount === 0 ? 'ZERO_FEASIBLE_POLICIES' : 'SINGLE_LEADER_SELECTED',
      selectedLeaderPolicy: passing[0] ?? null,
      paretoFrontierPolicies: paretoSet,
      comparablePoliciesOrdered: ordered,
      excludedCalendarPolicies: excluded,
      selectionHeadline:
        passCount === 0
          ? `0 of ${totalCount} ${policyNoun} pass the water-service criterion across all ${stateCount} scenario states.`
          : `${passCount} of ${totalCount} ${policyNoun} pass the water-service criterion across all ${stateCount} scenario states (${passing[0]!.policyId} leads by lowest worst-case ET shortfall).`,
      selectionDetail:
        passCount === 0
          ? dataset.fieldRecommendationBlockedReasons.join(' ') ||
            `Under STRICT_ALL_SCENARIOS_SERVICE ("Meets every tested scenario"), universal feasibility FAILS across all ${stateCount} scenario states.`
          : `Under STRICT_ALL_SCENARIOS_SERVICE, ${passCount} tested candidate(s) satisfy every modeled scenario state threshold within the bounded candidate set; external field validation still governs live deployment.`,
    };
  }

  if (preference === 'MINIMIZE_WORST_ET_SHORTFALL') {
    const ordered = [...comparable].sort(
      (a, b) => (a.rankByWorstShortfall ?? 999) - (b.rankByWorstShortfall ?? 999)
    );
    const leader = ordered[0] ?? null;
    return {
      preference,
      selectionOutcome: isRecorded ? 'CONDITIONAL_SINGLE_LEADER' : 'SINGLE_LEADER_SELECTED',
      selectedLeaderPolicy: leader,
      paretoFrontierPolicies: paretoSet,
      comparablePoliciesOrdered: ordered,
      excludedCalendarPolicies: excluded,
      selectionHeadline: leader
        ? `Lowest worst-case modeled ET shortfall in ${corpusLabel}: ${leader.policyId} (${leader.worstEtShortfallM3Eq?.toLocaleString('en-US', { maximumFractionDigits: 6 })} m³ eq).`
        : 'No comparable policy available.',
      selectionDetail: isRecorded
        ? 'Conditional least-violating selection from the frozen SE_UPPSALA in-sample M14 corpus (15 comparable policies; 0 pass <=100 mm in all states). Not a field-validated farm recommendation.'
        : 'Orders comparable synthetic policies by their worst-state aggregate evapotranspiration shortfall (m³ equivalent). This is a conditional comparison within a synthetic UI demo set, NOT a field-validated farm recommendation.',
    };
  }

  if (preference === 'MINIMAX_REGRET') {
    const ordered = [...comparable].sort(
      (a, b) => (a.rankByMinimaxRegret ?? 999) - (b.rankByMinimaxRegret ?? 999)
    );
    const leader = ordered[0] ?? null;
    return {
      preference,
      selectionOutcome: isRecorded ? 'CONDITIONAL_SINGLE_LEADER' : 'SINGLE_LEADER_SELECTED',
      selectedLeaderPolicy: leader,
      paretoFrontierPolicies: paretoSet,
      comparablePoliciesOrdered: ordered,
      excludedCalendarPolicies: excluded,
      selectionHeadline: leader
        ? `Lowest maximum regret in ${corpusLabel}: ${leader.policyId} (${leader.maxRegretM3Eq?.toLocaleString('en-US', { maximumFractionDigits: 6 })} m³ eq max regret).`
        : 'No comparable policy available.',
      selectionDetail:
        'Orders comparable policies across the identical fixed hard-admissible comparator pool by largest regret versus the per-state best policy. Regret and worst-state shortfall select distinct conditional candidates and do not confer field qualification.',
    };
  }

  // PARETO_FRONTIER
  const ordered = [...comparable].sort((a, b) => {
    if (a.isParetoNonDominated !== b.isParetoNonDominated) {
      return a.isParetoNonDominated ? -1 : 1;
    }
    return (a.rankByWorstShortfall ?? 999) - (b.rankByWorstShortfall ?? 999);
  });

  return {
    preference: 'PARETO_FRONTIER',
    selectionOutcome: 'NO_UNIQUE_WINNER',
    selectedLeaderPolicy: null,
    paretoFrontierPolicies: paretoSet,
    comparablePoliciesOrdered: ordered,
    excludedCalendarPolicies: excluded,
    selectionHeadline: `NO_UNIQUE_WINNER — ${paretoSet.length} Pareto non-dominated ${isRecorded ? 'recorded policies' : 'synthetic policies'} identified across trade-off dimensions.`,
    selectionDetail:
      'Surfaces all comparable policies where no other tested policy achieves simultaneously lower worst-case breach count, lower ET shortfall, and lower source withdrawal without scalar weights.',
  };
}

export interface ScientificRepositoryAdapter {
  readonly mode: DatasetOperatingMode;
  readonly adapterId: DatasetOperatingMode;
  readonly isLiveBackendConnected: boolean;

  getFarmDraft(siteId: string): ResearchViewEnvelope<UserFarmDraft>;
  getSiteCoverageContext(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<ExplorerPresetSite>;
  getSiteCoverage(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<ExplorerPresetSite>;
  getCoverageReport(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<ExplorerPresetSite>;
  getM14DecisionEvaluation(farmId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<M14DecisionDataset>;
  getDecisionEvaluation(farmId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<M14DecisionDataset>;
  getClimateWaterSeries(farmId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<ClimateWaterDataset>;
  getEvidenceRecordsForSite(siteId: string, draft?: UserFarmDraft | null): EvidenceRecord[];
  getEvidenceRecords(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<EvidenceRecord[]>;
  getEvidenceRecord(
    scope: EvidenceScope,
    evidenceId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<EvidenceRecord>;
  submitCustomFarmEvaluation(draft: UserFarmDraft): {
    accepted: boolean;
    statusCode: RepositoryStatusCode;
    reason: string;
  };
}

export type AstragronDataRepository = ScientificRepositoryAdapter;

function normalizeCanonicalSiteId(siteId: string): string {
  if (siteId === 'uppsala-m14' || siteId === 'uppsala-demo' || siteId === 'site-se-uppsala-m14') {
    return 'uppsala-demo';
  }
  return siteId;
}

function isCustomDraftId(siteId: string, customIds: string[] = []): boolean {
  return (
    siteId === 'custom-site-draft' ||
    siteId.startsWith('draft-') ||
    siteId.startsWith('custom-') ||
    (customIds.includes(siteId) &&
      siteId !== 'uppsala-demo' &&
      siteId !== 'uppsala-m14' &&
      !EXPLORER_PRESET_SITES[siteId])
  );
}

function makeEnvelope<T>(params: {
  datasetMode: DatasetOperatingMode;
  statusCode: RepositoryStatusCode;
  siteId: string;
  fixtureKind:
    | 'SYNTHETIC_UI_DEMO'
    | 'RECORDED_M14_RESEARCH'
    | 'RECORDED_M14_RESEARCH_DISABLED'
    | 'M4_GLOBAL_COVERAGE_RECORD'
    | 'BACKEND_NOT_CONNECTED';
  availability: ResultAvailability;
  data: T | null;
  reasons: string[];
  missingRequirements?: string[];
  upstreamSchema?: string;
  scientificReceipt?: ResearchViewEnvelope<T>['scientificReceipt'];
  provenance?: Array<{ sourceId: string; evidenceId?: string; asOf?: string }>;
  inputIdentity?: ScenarioInputIdentity;
}): ResearchViewEnvelope<T> {
  return {
    uiSchemaVersion: '2.0.0',
    datasetMode: params.datasetMode,
    status: params.statusCode,
    statusCode: params.statusCode,
    statusReason: params.reasons.join(' '),
    siteId: params.siteId,
    fixtureKind: params.fixtureKind,
    availability: params.availability,
    fieldValidated: false,
    data: params.data,
    reasons: params.reasons,
    missingRequirements: params.missingRequirements ?? [],
    upstreamSchema: params.upstreamSchema,
    scientificReceipt: params.scientificReceipt,
    provenance: params.provenance ?? [],
    inputIdentity: params.inputIdentity,
  };
}

function checkModifiedOrCustomIdentityHelper(
  farmId: string,
  draft?: UserFarmDraft | null,
  customDraftIds: string[] = []
): { blocked: true; statusCode: RepositoryStatusCode; identity: ScenarioInputIdentity; reasons: string[] } | { blocked: false } {
  const canonicalId = normalizeCanonicalSiteId(farmId);
  const isCustomId = isCustomDraftId(farmId, customDraftIds);

  if (draft) {
    const actualRev = computeDraftInputRevision(draft);
    const isUppsalaBase = canonicalId === 'uppsala-demo' || draft.derivedFromFixtureId === 'uppsala-demo';
    const modReasons = isUppsalaBase
      ? detectDraftModificationReasons(draft, DEFAULT_UPPSALA_FARM_DRAFT)
      : [];
    const isModified =
      Boolean(draft.inputsModified) ||
      Boolean(draft.derivedFromFixtureId) ||
      (isUppsalaBase &&
        (actualRev !== UPPSALA_REFERENCE_INPUT_REVISION ||
          (draft.inputRevision !== undefined &&
            draft.inputRevision !== UPPSALA_REFERENCE_INPUT_REVISION) ||
          Boolean(draft.isUserCreatedDraft)));

    if (isModified || isCustomId || draft.isUserCreatedDraft) {
      const useRevisionStatus =
        Boolean(draft.inputsModified) ||
        draft.derivedFromFixtureId === 'uppsala-demo' ||
        (canonicalId === 'uppsala-demo' && actualRev !== UPPSALA_REFERENCE_INPUT_REVISION);
      const statusCode: RepositoryStatusCode = useRevisionStatus
        ? 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
        : 'BACKEND_NOT_CONNECTED';
      return {
        blocked: true,
        statusCode,
        identity: {
          siteId: farmId,
          inputRevision: actualRev,
          referenceRevision: isUppsalaBase ? UPPSALA_REFERENCE_INPUT_REVISION : null,
          inputsModified: true,
          derivedFromFixtureId: draft.derivedFromFixtureId ?? (isUppsalaBase ? 'uppsala-demo' : undefined),
          modificationReasons:
            modReasons.length > 0 ? modReasons : draft.modificationReasons ?? ['User-modified or custom scenario inputs'],
        },
        reasons: [
          `Your field changes are saved (${farmId}). The frozen benchmark has not analyzed your updated farm.`,
          `${statusCode}: Recomputing field-specific agronomic results requires connecting to the ASTRAGRON scientific backend (BACKEND_NOT_CONNECTED).`,
          ...(modReasons.length > 0 ? [`Modified inputs: ${modReasons.join('; ')}.`] : []),
        ],
      };
    }
  } else if (isCustomId) {
    const isUppsalaCustom = farmId.startsWith('custom-uppsala-');
    return {
      blocked: true,
      statusCode: isUppsalaCustom ? 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION' : 'BACKEND_NOT_CONNECTED',
      identity: {
        siteId: farmId,
        inputRevision: 'custom-unhashed',
        referenceRevision: isUppsalaCustom ? UPPSALA_REFERENCE_INPUT_REVISION : null,
        inputsModified: true,
      },
      reasons: [
        `Your field changes are saved (${farmId}). ${isUppsalaCustom ? 'The benchmark has not analyzed your updated farm.' : 'Live multi-year optimization requires connecting the scientific backend.'}`,
        'Frozen Uppsala scenarios and recorded plans are never assigned to user-created or modified farms.',
      ],
    };
  }

  return { blocked: false };
}

/**
 * Operational Synthetic UI Demo Repository (`SYNTHETIC_UI_DEMO`)
 * Enforces strict site isolation, Zod contract validation, and zero mixing with authentic M14 claims.
 */
export class SyntheticDemoRepository implements ScientificRepositoryAdapter {
  readonly mode = 'SYNTHETIC_UI_DEMO' as const;
  readonly adapterId = 'SYNTHETIC_UI_DEMO' as const;
  readonly isLiveBackendConnected = false;
  private customDraftIds: string[];

  constructor(customDraftIds: string[] = []) {
    this.customDraftIds = customDraftIds;
  }

  getFarmDraft(siteId: string): ResearchViewEnvelope<UserFarmDraft> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    if (canonicalId === 'uppsala-demo') {
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'OK_SYNTHETIC_DEMO',
        siteId: 'uppsala-demo',
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'READY',
        data: DEFAULT_UPPSALA_FARM_DRAFT,
        reasons: ['Loaded Uppsala 3-field (24.0 ha) synthetic farm draft.'],
      });
    }
    const preset = EXPLORER_PRESET_SITES[canonicalId];
    if (preset) {
      const draft: UserFarmDraft = {
        id: canonicalId,
        name: `${preset.name} — Coverage Inspection Draft`,
        createdAt: '2026-11-11T08:00:00Z',
        updatedAt: '2026-11-11T08:00:00Z',
        fixturePresetId: preset.id,
        datasetMode: 'SYNTHETIC_UI_DEMO',
        site: {
          longitude: preset.coordinates[0],
          latitude: preset.coordinates[1],
          crs: 'EPSG:4326',
          locationLabel: preset.siteContext.location_label,
          countryCode: preset.countryCode,
          regionName: preset.regionName,
          spatialPrecisionNote: `WGS84 (EPSG:4326) coordinate [${preset.coordinates[0]}, ${preset.coordinates[1]}]. Source coverage UX fixture only.`,
        },
        waterContext: {
          sharedDailyDeliveryM3: { value: null, unit: 'm³/day', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
          seasonalQuotaM3: { value: null, unit: 'm³/season', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
          serviceThresholdMm: { value: 100.0, unit: 'mm / field / harvest-year', evidenceClass: 'RESEARCH_ASSUMPTION' },
          waterResourceRegime: 'BASE',
          waterSourceType: 'RAINFED_ONLY',
          legalRightsVerified: false,
        },
        fields: [
          {
            id: 'F1',
            label: `Primary Reference Parcel (${preset.name})`,
            geometry: preset.defaultPolygon,
            declaredAreaHa: preset.siteContext.geometry.area_ha ?? 50.0,
            areaBasis: preset.siteContext.geometry.area_basis,
            irrigationAccess: 'UNKNOWN',
            soilTexture: { value: null, evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            soilDepthMm: { value: null, unit: 'mm', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            organicCarbonPct: { value: null, unit: '%', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            soilPh: { value: null, unit: 'pH', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            mineralNo3KgHa: { value: null, unit: 'kg N/ha (elemental N)', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            nitrogenBasis: 'ELEMENTAL_N_KG_HA',
            initialRootZoneMm: { value: null, unit: 'mm', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
            previousCrops: [],
            candidateCrops: [],
          },
        ],
        selectedPurpose: 'DESCRIPTIVE_CONTEXT',
        selectedPreference: 'MINIMIZE_WORST_ET_SHORTFALL',
        assumptionAcknowledged: true,
      };
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'OK_COVERAGE_ONLY',
        siteId: canonicalId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'MODEL_UNQUALIFIED',
        data: draft,
        reasons: [`Loaded coverage-only draft for ${preset.name}.`],
      });
    }

    return makeEnvelope<UserFarmDraft>({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: 'SITE_NOT_FOUND',
      siteId,
      fixtureKind: 'SYNTHETIC_UI_DEMO',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [`SITE_NOT_FOUND: Unknown farm identifier "${siteId}". Never falls back to Uppsala.`],
    });
  }

  getSiteCoverageContext(
    siteId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<ExplorerPresetSite> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const preset = EXPLORER_PRESET_SITES[canonicalId];

    if (preset) {
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: preset.hasSyntheticScenarioDemo ? 'OK_SYNTHETIC_DEMO' : 'OK_COVERAGE_ONLY',
        siteId: preset.id,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: preset.hasSyntheticScenarioDemo ? 'READY' : 'MODEL_UNQUALIFIED',
        data: preset,
        reasons: preset.hasSyntheticScenarioDemo
          ? [
              'SYNTHETIC_UI_DEMO: Loaded synthetic 3-field (24.0 ha) demonstration domain for Uppsala.',
              'Not a recorded M14 research output or live NASA feed.',
            ]
          : [
              `Loaded M4 source coverage metadata for ${preset.name}.`,
              'Agronomic crop-decision and multi-year rotation models are NOT calibrated or available for this region.',
            ],
        missingRequirements: preset.capabilities.flatMap((c) => c.requirements_missing),
        upstreamSchema: M4_SCHEMA_ID,
        provenance: preset.sourceCoverages.map((sc) => ({
          sourceId: sc.source_id,
          asOf: preset.siteContext.as_of,
        })),
      });
    }

    if (draft || isCustomDraftId(siteId, this.customDraftIds)) {
      const lon = draft?.site?.longitude;
      const lat = draft?.site?.latitude;
      if (
        !draft ||
        typeof lon !== 'number' ||
        typeof lat !== 'number' ||
        !Number.isFinite(lon) ||
        !Number.isFinite(lat)
      ) {
        return makeEnvelope<ExplorerPresetSite>({
          datasetMode: 'SYNTHETIC_UI_DEMO',
          statusCode: 'SITE_NOT_FOUND',
          siteId,
          fixtureKind: 'BACKEND_NOT_CONNECTED',
          availability: 'UNAVAILABLE',
          data: null,
          reasons: [
            `SITE_NOT_FOUND: No verified coordinate draft is registered for "${siteId}". Silent fallback to Uppsala [17.64, 59.86] is strictly prohibited.`,
          ],
          missingRequirements: ['Explicit valid [longitude, latitude] draft registration'],
          upstreamSchema: M4_SCHEMA_ID,
        });
      }
      const name = draft.name || `Custom Site Draft (${siteId})`;
      const syntheticCustomPreset: ExplorerPresetSite = {
        id: siteId,
        name,
        subtitle: 'User-Configured Farm Draft — Live Scientific Backend Not Connected',
        countryCode: draft?.site.countryCode || 'CUSTOM',
        regionName: draft?.site.regionName || 'User Coordinates',
        hemisphere: lat >= 0 ? 'NORTHERN' : 'SOUTHERN',
        coordinates: [lon, lat],
        zoomLevel: 12,
        badgeText: 'USER DRAFT · BACKEND NOT CONNECTED',
        hasSyntheticScenarioDemo: false,
        coverageEvaluated: false,
        defaultPolygon: {
          type: 'Polygon',
          coordinates: [
            [
              [lon - 0.005, lat + 0.004],
              [lon + 0.005, lat + 0.004],
              [lon + 0.005, lat - 0.004],
              [lon - 0.005, lat - 0.004],
              [lon - 0.005, lat + 0.004],
            ],
          ],
        },
        siteContext: {
          site_id: siteId,
          geometry: {
            point: [lon, lat],
            polygon: draft?.fields[0]?.geometry ?? null,
            crs: 'EPSG:4326',
            area_ha: draft?.fields.reduce((acc, f) => acc + (f.declaredAreaHa ?? 0), 0) || null,
            area_basis: draft?.fields[0]?.areaBasis ?? 'USER_DECLARED_NOT_SURVEYED',
          },
          as_of: draft?.updatedAt ?? '2026-11-12T00:00:00Z',
          purpose: draft?.selectedPurpose ?? 'DESCRIPTIVE_CONTEXT',
          location_label: draft?.site.locationLabel ?? name,
          country_code: draft?.site.countryCode ?? 'CUSTOM',
          region_name: draft?.site.regionName ?? 'Custom Region',
          hemisphere: lat >= 0 ? 'NORTHERN' : 'SOUTHERN',
        },
        sourceCoverages: [
          {
            source_id: 'M4_LIVE_EXTRACTION_SERVICE',
            source_title: 'Site-Specific M4 Earth Observation Archive Extraction',
            publisher: 'ASTRAGRON M4 Backend Service',
            variable: 'NASA_POWER, GPM_IMERG, SMAP_L4, HLS',
            variable_label: 'Custom Coordinate Evidence Extraction',
            status: 'TEMPORARILY_UNAVAILABLE',
            spatial_coverage: `Custom point [${lon}, ${lat}]`,
            temporal_resolution: 'Daily',
            acquisition_status: 'BACKEND_NOT_CONNECTED',
            inference_eligibility: 'BLOCKED_FOR_FIELD_DECISION',
            reason:
              'Standalone frontend does not query live NASA archives or run browser-side agronomic solvers for custom farms.',
            site_id: siteId,
            requested_point: [lon, lat],
            observation_period: 'Not connected',
            purpose: draft?.selectedPurpose ?? 'DESCRIPTIVE_CONTEXT',
          },
        ],
        capabilities: [
          {
            capability: 'M14_FINITE_PORTFOLIO_EVALUATION',
            capability_label: 'Live Agronomic Scenario Solver',
            status: 'TEMPORARILY_UNAVAILABLE',
            evidence_ids: [],
            requirements_missing: [
              'Connection to ASTRAGRON scientific backend (BACKEND_NOT_CONNECTED)',
              'Site-specific M4 climate & soil qualification',
            ],
            scientific_scope: 'Blocked until the live scientific backend is connected.',
          },
        ],
      };

      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'BACKEND_NOT_CONNECTED',
        siteId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: syntheticCustomPreset,
        reasons: [
          'User-created farm draft saved locally, but the live scientific backend is not connected.',
          'Synthetic Uppsala demo results are never assigned to user-created farms.',
        ],
        missingRequirements: [
          'Live M4/M14 scientific backend connection',
          'Regional crop phenology & soil hydraulic calibration',
        ],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === siteId);
    if (gaz) {
      const gazPreset: ExplorerPresetSite = {
        id: gaz.id,
        name: gaz.shortName,
        subtitle: `${gaz.region}, ${gaz.country} — Gazetteer Reference Coordinate`,
        countryCode: gaz.countryCode,
        regionName: gaz.region,
        hemisphere: gaz.coordinates[1] >= 0 ? 'NORTHERN' : 'SOUTHERN',
        coordinates: gaz.coordinates,
        zoomLevel: 10,
        badgeText: 'GAZETTEER COORDINATE · BACKEND NOT CONNECTED',
        hasSyntheticScenarioDemo: false,
        coverageEvaluated: false,
        defaultPolygon: {
          type: 'Polygon',
          coordinates: [
            [
              [gaz.coordinates[0] - 0.01, gaz.coordinates[1] + 0.01],
              [gaz.coordinates[0] + 0.01, gaz.coordinates[1] + 0.01],
              [gaz.coordinates[0] + 0.01, gaz.coordinates[1] - 0.01],
              [gaz.coordinates[0] - 0.01, gaz.coordinates[1] - 0.01],
              [gaz.coordinates[0] - 0.01, gaz.coordinates[1] + 0.01],
            ],
          ],
        },
        siteContext: {
          site_id: gaz.id,
          geometry: {
            point: gaz.coordinates,
            polygon: null,
            crs: 'EPSG:4326',
            area_ha: null,
            area_basis: 'USER_DECLARED_NOT_SURVEYED',
          },
          as_of: '2026-11-12T00:00:00Z',
          purpose: 'DESCRIPTIVE_CONTEXT',
          location_label: gaz.label,
          country_code: gaz.countryCode,
          region_name: gaz.region,
          hemisphere: gaz.coordinates[1] >= 0 ? 'NORTHERN' : 'SOUTHERN',
        },
        sourceCoverages: [],
        capabilities: [],
      };

      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'MODEL_UNQUALIFIED',
        siteId: gaz.id,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'MODEL_UNQUALIFIED',
        data: gazPreset,
        reasons: [`${gaz.shortName} is a gazetteer coordinate reference; crop scenario evaluation is not qualified.`],
        missingRequirements: ['Site-specific M4 extraction and regional crop calibration'],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope<ExplorerPresetSite>({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: 'SITE_NOT_FOUND',
      siteId,
      fixtureKind: 'SYNTHETIC_UI_DEMO',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [
        `SITE_NOT_FOUND: Unknown farm or site identifier "${siteId}".`,
        'ASTRAGRON never falls back to Uppsala data when an unknown or invalid farm ID is requested.',
      ],
      missingRequirements: ['Valid registered site_id or saved local farm draft'],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getSiteCoverage(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }

  getCoverageReport(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }

  private checkModifiedOrCustomIdentity(
    farmId: string,
    draft?: UserFarmDraft | null
  ): { blocked: true; statusCode: RepositoryStatusCode; identity: ScenarioInputIdentity; reasons: string[] } | { blocked: false } {
    return checkModifiedOrCustomIdentityHelper(farmId, draft, this.customDraftIds);
  }

  getM14DecisionEvaluation(
    farmId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<M14DecisionDataset> {
    const canonicalId = normalizeCanonicalSiteId(farmId);

    const modifiedCheck = this.checkModifiedOrCustomIdentity(farmId, draft);
    if (modifiedCheck.blocked) {
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: modifiedCheck.statusCode,
        siteId: farmId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: modifiedCheck.reasons,
        missingRequirements: [
          'Live connection to ASTRAGRON CP-SAT / scenario simulation backend',
          'Site-specific M4 meteorology and soil hydraulic verification for updated inputs',
        ],
        upstreamSchema: M14_RESPONSE_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }

    if (canonicalId === 'uppsala-demo') {
      const validated = M14DecisionDatasetSchema.parse(SYNTHETIC_DECISION_DATASET) as M14DecisionDataset;
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'OK_SYNTHETIC_DEMO',
        siteId: 'uppsala-demo',
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'READY',
        data: validated,
        reasons: [
          'SYNTHETIC_UI_DEMO: Loaded self-contained synthetic 12-policy × 9-state demonstration matrix for Uppsala.',
          'Universal water-service feasibility: 0 of 12 synthetic policies pass all 9 states; FIELD_RECOMMENDATION_ELIGIBILITY is BLOCKED.',
        ],
        missingRequirements: validated.fieldRecommendationBlockedReasons,
        upstreamSchema: M14_RESPONSE_SCHEMA_ID,
        provenance: [
          { sourceId: 'SYNTHETIC_DEMO_WEATHER_2018', evidenceId: 'syn-ev-uppsala-weather-2018', asOf: '2026-11-12T00:00:00Z' },
          { sourceId: 'SYNTHETIC_DEMO_WEATHER_2006', evidenceId: 'syn-ev-uppsala-weather-2006', asOf: '2026-11-12T00:00:00Z' },
          { sourceId: 'SYNTHETIC_DEMO_WEATHER_2012', evidenceId: 'syn-ev-uppsala-weather-2012', asOf: '2026-11-12T00:00:00Z' },
          { sourceId: 'SYNTHETIC_DEMO_WATER_ASSUMPTION', evidenceId: 'syn-ev-uppsala-water-assumption', asOf: '2026-11-12T00:00:00Z' },
        ],
        inputIdentity: {
          siteId: 'uppsala-demo',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          referenceRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          inputsModified: false,
        },
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (preset || gaz) {
      const siteName = preset?.name ?? gaz?.label ?? canonicalId;
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'MODEL_UNQUALIFIED',
        siteId: canonicalId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'MODEL_UNQUALIFIED',
        data: null,
        reasons: [
          `MODEL_UNQUALIFIED: Multi-year crop scenario and decision evaluation is NOT calibrated or qualified for ${siteName}.`,
          'ASTRAGRON strictly isolates each site and never extrapolates Uppsala synthetic crop calendars, deficits, or policies to other regions.',
        ],
        missingRequirements: [
          `Regionally calibrated crop phenology & KC curves for ${siteName}`,
          'Local soil horizon hydraulic parameters and verified water delivery constraints',
        ],
        upstreamSchema: M14_RESPONSE_SCHEMA_ID,
      });
    }

    return makeEnvelope<M14DecisionDataset>({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: 'SITE_NOT_FOUND',
      siteId: farmId,
      fixtureKind: 'SYNTHETIC_UI_DEMO',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [
        `SITE_NOT_FOUND: Unknown farm identifier "${farmId}".`,
        'No decision evaluation, crop matrix, or fallback data is returned for unknown identifiers.',
      ],
      missingRequirements: ['Valid registered site_id'],
      upstreamSchema: M14_RESPONSE_SCHEMA_ID,
    });
  }

  getDecisionEvaluation(farmId: string, draft?: UserFarmDraft | null) {
    return this.getM14DecisionEvaluation(farmId, draft);
  }

  getClimateWaterSeries(
    farmId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<ClimateWaterDataset> {
    const canonicalId = normalizeCanonicalSiteId(farmId);

    const modifiedCheck = this.checkModifiedOrCustomIdentity(farmId, draft);
    if (modifiedCheck.blocked) {
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: modifiedCheck.statusCode,
        siteId: farmId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: modifiedCheck.reasons,
        missingRequirements: ['Live M4 meteorology extraction and root-zone water balance service'],
        upstreamSchema: M4_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }

    if (canonicalId === 'uppsala-demo') {
      const validated = ClimateWaterDatasetSchema.parse(SYNTHETIC_UPPSALA_CLIMATE_FIXTURE) as ClimateWaterDataset;
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'OK_SYNTHETIC_DEMO',
        siteId: 'uppsala-demo',
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'READY',
        data: validated,
        reasons: [
          'SYNTHETIC_UI_DEMO: Loaded illustrative boreal weather analogue series (2018 dry, 2006 median with null gap, 2012 wet) for Uppsala.',
        ],
        missingRequirements: ['On-farm rain gauge and multi-depth capacitance soil moisture sensors'],
        upstreamSchema: M4_SCHEMA_ID,
        inputIdentity: {
          siteId: 'uppsala-demo',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          referenceRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          inputsModified: false,
        },
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (preset || gaz) {
      const siteName = preset?.name ?? gaz?.label ?? canonicalId;
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'MODEL_UNQUALIFIED',
        siteId: canonicalId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'MODEL_UNQUALIFIED',
        data: null,
        reasons: [
          `MODEL_UNQUALIFIED: Daily evapotranspiration (ET0/ETc/ETa) and root-zone deficit series are not bundled or calibrated for ${siteName}.`,
          'Uppsala boreal climate series are never displayed under non-Uppsala routes.',
        ],
        missingRequirements: [
          `Site-specific M4 daily meteorology extraction for ${siteName}`,
          'Locally calibrated root-zone water balance model',
        ],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope<ClimateWaterDataset>({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: 'SITE_NOT_FOUND',
      siteId: farmId,
      fixtureKind: 'SYNTHETIC_UI_DEMO',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [`SITE_NOT_FOUND: Unknown farm identifier "${farmId}".`],
      missingRequirements: ['Valid registered site_id'],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getEvidenceRecordsForSite(siteId: string, draft?: UserFarmDraft | null): EvidenceRecord[] {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const modifiedCheck = this.checkModifiedOrCustomIdentity(siteId, draft);
    if (modifiedCheck.blocked) {
      return [];
    }
    const preset = EXPLORER_PRESET_SITES[canonicalId];
    if (!preset) {
      return [];
    }
    const list: EvidenceRecord[] = [];
    for (const rec of Object.values(EVIDENCE_RECORDS_FIXTURE)) {
      if (rec.site_id === canonicalId && rec.dataset_mode === this.mode) {
        list.push(EvidenceRecordSchema.parse(rec) as EvidenceRecord);
      }
    }
    return list;
  }

  getEvidenceRecord(
    scope: EvidenceScope,
    evidenceId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<EvidenceRecord> {
    if (scope.datasetMode !== this.mode) {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: this.mode,
        statusCode: scope.datasetMode === 'RECORDED_M14_RESEARCH' ? 'SOURCE_NOT_PROVIDED' : 'BACKEND_NOT_CONNECTED',
        siteId: scope.siteId,
        fixtureKind: scope.datasetMode === 'RECORDED_M14_RESEARCH' ? 'RECORDED_M14_RESEARCH_DISABLED' : 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [`Scope datasetMode "${scope.datasetMode}" does not match active repository "${this.mode}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const canonicalId = normalizeCanonicalSiteId(scope.siteId);
    const scopedRecords = this.getEvidenceRecordsForSite(scope.siteId, draft);
    const matched = scopedRecords.find((r) => r.evidence_id === evidenceId);

    if (matched && matched.site_id === canonicalId && matched.dataset_mode === scope.datasetMode) {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: canonicalId === 'uppsala-demo' ? 'OK_SYNTHETIC_DEMO' : 'OK_COVERAGE_ONLY',
        siteId: canonicalId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'READY',
        data: matched,
        reasons: [`Loaded site-scoped evidence record "${evidenceId}" for "${canonicalId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (!preset && !gaz && !draft && !isCustomDraftId(scope.siteId, this.customDraftIds)) {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'SITE_NOT_FOUND',
        siteId: scope.siteId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [`SITE_NOT_FOUND: Unknown site "${scope.siteId}" cannot access provenance records.`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope<EvidenceRecord>({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: 'NO_EVIDENCE_FOR_SITE',
      siteId: scope.siteId,
      fixtureKind: draft?.inputsModified || isCustomDraftId(scope.siteId, this.customDraftIds) ? 'BACKEND_NOT_CONNECTED' : 'SYNTHETIC_UI_DEMO',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [
        `NO_EVIDENCE_FOR_SITE: Evidence record "${evidenceId}" is unavailable or blocked under site scope "${scope.siteId}" (${scope.datasetMode}).`,
        'Cross-site provenance lookup from Uppsala or other domains is strictly blocked.',
      ],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getEvidenceRecords(
    siteId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<EvidenceRecord[]> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const modifiedCheck = this.checkModifiedOrCustomIdentity(siteId, draft);
    if (modifiedCheck.blocked) {
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: modifiedCheck.statusCode,
        siteId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: modifiedCheck.reasons,
        upstreamSchema: M4_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }
    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (!preset && !gaz) {
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'SITE_NOT_FOUND',
        siteId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: [`SITE_NOT_FOUND: Unknown site identifier "${siteId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    const records = this.getEvidenceRecordsForSite(siteId, draft);
    if (records.length === 0) {
      return makeEnvelope({
        datasetMode: 'SYNTHETIC_UI_DEMO',
        statusCode: 'NO_EVIDENCE_FOR_SITE',
        siteId: canonicalId,
        fixtureKind: 'SYNTHETIC_UI_DEMO',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: [
          `NO_EVIDENCE_FOR_SITE: No provenance records are bundled for "${preset?.name ?? gaz?.shortName ?? canonicalId}".`,
          'ASTRAGRON never displays Uppsala provenance records under another site scope.',
        ],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    return makeEnvelope({
      datasetMode: 'SYNTHETIC_UI_DEMO',
      statusCode: canonicalId === 'uppsala-demo' ? 'OK_SYNTHETIC_DEMO' : 'OK_COVERAGE_ONLY',
      siteId: canonicalId,
      fixtureKind: 'SYNTHETIC_UI_DEMO',
      availability: 'READY',
      data: records,
      reasons: [`Loaded ${records.length} site-bound provenance record(s) for ${preset?.name ?? canonicalId}.`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  submitCustomFarmEvaluation(_draft: UserFarmDraft) {
    return {
      accepted: false,
      statusCode: 'BACKEND_NOT_CONNECTED' as const,
      reason: 'Protected scientific backend is not connected in standalone frontend mode.',
    };
  }
}

function buildVerifiedSitePresetOverlay(
  uiSiteId: string,
  bundle: NonNullable<VerifiedRecordedBundle['m4Sites']>[string]
): ExplorerPresetSite | null {
  const basePreset = EXPLORER_PRESET_SITES[uiSiteId];
  if (!basePreset) return null;
  return {
    ...basePreset,
    siteContext: bundle.siteContext,
    capabilities: bundle.capabilities,
    sourceCoverages: bundle.sourceCoverages,
    badgeText:
      uiSiteId === 'uppsala-demo'
        ? 'SE_UPPSALA · RECORDED M14 + M4 VERIFIED (FIELD BLOCKED)'
        : `${bundle.canonicalSiteId} · M4 COVERAGE VERIFIED (MODEL UNQUALIFIED)`,
  };
}

/**
 * M4 Global Evidence Source-Coverage Repository (`astragron.global-evidence.v1`)
 * Narrowly scoped to Sweden (`SE_UPPSALA`), Kenya (`KE_NYERI_REGION`), and Australia (`AU_WAGGA_REGION`).
 * Never authorizes crop-decision simulation or falls back to Uppsala on unknown locations.
 */
export class M4SourceCoverageRepository implements ScientificRepositoryAdapter {
  readonly mode = 'RECORDED_M14_RESEARCH' as const;
  readonly adapterId = 'RECORDED_M14_RESEARCH' as const;
  readonly isLiveBackendConnected = false;

  constructor(private readonly customDraftIds: string[] = []) {}

  getFarmDraft(siteId: string): ResearchViewEnvelope<UserFarmDraft> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const bundle = getVerifiedRecordedBundle();
    if (!bundle.valid || !bundle.m4Sites) {
      return makeEnvelope<UserFarmDraft>({
        datasetMode: this.mode,
        statusCode: 'SOURCE_NOT_PROVIDED',
        siteId,
        fixtureKind: 'RECORDED_M14_RESEARCH_DISABLED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [bundle.reason ?? 'Verified M4 coverage manifest unavailable.'],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    if (canonicalId === 'uppsala-demo') {
      return makeEnvelope<UserFarmDraft>({
        datasetMode: this.mode,
        statusCode: 'OK_COVERAGE_ONLY',
        siteId: canonicalId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'READY',
        data: DEFAULT_UPPSALA_FARM_DRAFT,
        reasons: ['Loaded M4 SE_UPPSALA inspection domain (fixed read-only reference draft).'],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    return makeEnvelope<UserFarmDraft>({
      datasetMode: this.mode,
      statusCode: bundle.m4Sites[canonicalId] ? 'MODEL_UNQUALIFIED' : 'SITE_NOT_FOUND',
      siteId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: bundle.m4Sites[canonicalId] ? 'MODEL_UNQUALIFIED' : 'UNAVAILABLE',
      data: null,
      reasons: [
        bundle.m4Sites[canonicalId]
          ? `M4 coverage site ${canonicalId} has no M14 agronomic crop-decision draft.`
          : `SITE_NOT_FOUND: No M4 coverage record exists for "${siteId}".`,
      ],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getSiteCoverageContext(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<ExplorerPresetSite> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const bundle = getVerifiedRecordedBundle();
    if (!bundle.valid || !bundle.m4Sites) {
      return makeEnvelope<ExplorerPresetSite>({
        datasetMode: this.mode,
        statusCode: 'SOURCE_NOT_PROVIDED',
        siteId,
        fixtureKind: 'RECORDED_M14_RESEARCH_DISABLED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [bundle.reason ?? 'M4 Global Coverage Manifest failed SHA-256 or Zod validation.'],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const m4Site = bundle.m4Sites[canonicalId];
    if (m4Site) {
      const overlaid = buildVerifiedSitePresetOverlay(canonicalId, m4Site);
      if (overlaid) {
        return makeEnvelope({
          datasetMode: this.mode,
          statusCode: 'OK_COVERAGE_ONLY',
          siteId: canonicalId,
          fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
          availability: canonicalId === 'uppsala-demo' ? 'READY' : 'MODEL_UNQUALIFIED',
          data: overlaid,
          reasons: [
            `Verified M4 GLOBAL_COVERAGE_MANIFEST.json entry for ${m4Site.canonicalSiteId} (${canonicalId}).`,
            'climate_history: AVAILABLE (NASA POWER UTC); soil_characterization, nitrogen, growth_yield, and field_calibrated_recommendation remain INSUFFICIENT_EVIDENCE.',
            bundle.soilUnitConflictNote ?? '',
          ].filter(Boolean),
          missingRequirements: m4Site.capabilities.flatMap((c) => c.requirements_missing),
          upstreamSchema: M4_SCHEMA_ID,
          scientificReceipt: {
            schema: M4_SCHEMA_ID,
            protocolSha256: bundle.protocolSha256,
            receiptSha256: bundle.snapshotSha256,
            canonicalSiteId: m4Site.canonicalSiteId,
          },
          provenance: m4Site.sourceCoverages.map((sc) => ({
            sourceId: sc.source_id,
            asOf: m4Site.siteContext.as_of,
          })),
        });
      }
    }

    // Fallback cleanly for explicit negative/control presets (e.g. polar-svalbard, ocean-atlantic, antimeridian) or custom drafts
    const preset = EXPLORER_PRESET_SITES[canonicalId];
    if (preset) {
      return makeEnvelope({
        datasetMode: this.mode,
        statusCode: 'OK_COVERAGE_ONLY',
        siteId: canonicalId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'MODEL_UNQUALIFIED',
        data: preset,
        reasons: [
          `Loaded boundary/control M4 disclosure for ${preset.name} (${canonicalId}).`,
          'Agronomic crop recommendation models are unqualified everywhere in M4.',
        ],
        missingRequirements: preset.capabilities.flatMap((c) => c.requirements_missing),
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    if (draft || isCustomDraftId(siteId, this.customDraftIds)) {
      return syntheticDemoRepository.getSiteCoverageContext(siteId, draft);
    }

    return makeEnvelope<ExplorerPresetSite>({
      datasetMode: this.mode,
      statusCode: 'SITE_NOT_FOUND',
      siteId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [
        `SITE_NOT_FOUND: Unknown coordinate or site identifier "${siteId}" in verified M4 manifest.`,
        'Unknown locations never fall back to SE_UPPSALA or synthetic coverage tiles.',
      ],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getSiteCoverage(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }
  getCoverageReport(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }
  getM14DecisionEvaluation(farmId: string): ResearchViewEnvelope<M14DecisionDataset> {
    return makeEnvelope<M14DecisionDataset>({
      datasetMode: this.mode,
      statusCode: 'MODEL_UNQUALIFIED',
      siteId: farmId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'MODEL_UNQUALIFIED',
      data: null,
      reasons: ['MODEL_UNQUALIFIED: M4 Global Evidence layer establishes meteorological source coverage only and has zero crop-optimizer coupling (NONE).'],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }
  getDecisionEvaluation(farmId: string) {
    return this.getM14DecisionEvaluation(farmId);
  }
  getClimateWaterSeries(farmId: string): ResearchViewEnvelope<ClimateWaterDataset> {
    return makeEnvelope<ClimateWaterDataset>({
      datasetMode: this.mode,
      statusCode: 'MODEL_UNQUALIFIED',
      siteId: farmId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'MODEL_UNQUALIFIED',
      data: null,
      reasons: ['MODEL_UNQUALIFIED: M4 coverage repository does not supply crop evapotranspiration water-balance series.'],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }
  getEvidenceRecordsForSite(siteId: string): EvidenceRecord[] {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const bundle = getVerifiedRecordedBundle();
    if (!bundle.valid || !bundle.m4Sites?.[canonicalId]) return [];
    return bundle.m4Sites[canonicalId].evidenceRecords;
  }
  getEvidenceRecords(siteId: string): ResearchViewEnvelope<EvidenceRecord[]> {
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const bundle = getVerifiedRecordedBundle();
    const m4Site = bundle.valid ? bundle.m4Sites?.[canonicalId] : undefined;
    if (!m4Site) {
      return makeEnvelope({
        datasetMode: this.mode,
        statusCode: EXPLORER_PRESET_SITES[canonicalId] ? 'NO_EVIDENCE_FOR_SITE' : 'SITE_NOT_FOUND',
        siteId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: [`No verified M4 evidence records exist for "${siteId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    return makeEnvelope({
      datasetMode: this.mode,
      statusCode: 'OK_COVERAGE_ONLY',
      siteId: canonicalId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'READY',
      data: m4Site.evidenceRecords,
      reasons: [`Loaded ${m4Site.evidenceRecords.length} SHA-256 verified M4 records for ${m4Site.canonicalSiteId}.`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }
  getEvidenceRecord(scope: EvidenceScope, evidenceId: string): ResearchViewEnvelope<EvidenceRecord> {
    const canonicalId = normalizeCanonicalSiteId(scope.siteId);
    const records = this.getEvidenceRecordsForSite(canonicalId);
    const hit = records.find((r) => r.evidence_id === evidenceId && r.site_id === canonicalId);
    if (!hit) {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: this.mode,
        statusCode: 'NO_EVIDENCE_FOR_SITE',
        siteId: scope.siteId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [`Evidence "${evidenceId}" is not scoped to M4 site "${scope.siteId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }
    return makeEnvelope({
      datasetMode: this.mode,
      statusCode: 'OK_COVERAGE_ONLY',
      siteId: canonicalId,
      fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'READY',
      data: hit,
      reasons: [`Loaded verified M4 evidence "${evidenceId}" for ${canonicalId}.`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }
  submitCustomFarmEvaluation() {
    return {
      accepted: false,
      statusCode: 'BACKEND_NOT_CONNECTED' as const,
      reason: 'M4 coverage catalog is read-only metadata without an optimization solver.',
    };
  }
}

/**
 * Source-Backed Read-Only Recorded M14 Research Repository (`RECORDED_M14_RESEARCH`)
 * Serves Zod-validated, SHA-256-verified M14 outputs strictly for the immutable `uppsala-demo <-> SE_UPPSALA` case,
 * connects M4 coverage (`SE_UPPSALA`, `KE_NYERI_REGION`, `AU_WAGGA_REGION`), and fails closed with
 * `SOURCE_NOT_PROVIDED` if the corpus is unavailable/corrupt, or `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION` on edits.
 */
export class RecordedM14ResearchRepository implements ScientificRepositoryAdapter {
  readonly mode = 'RECORDED_M14_RESEARCH' as const;
  readonly adapterId = 'RECORDED_M14_RESEARCH' as const;
  readonly isLiveBackendConnected = false;
  private readonly corpusAvailable: boolean;
  private readonly customDraftIds: string[];
  private readonly m4Helper: M4SourceCoverageRepository;

  constructor(options?: { corpusAvailable?: boolean; customDraftIds?: string[] }) {
    this.corpusAvailable = options?.corpusAvailable ?? true;
    this.customDraftIds = options?.customDraftIds ?? [];
    this.m4Helper = new M4SourceCoverageRepository(this.customDraftIds);
  }

  private getVerifiedOrFail(): VerifiedRecordedBundle | null {
    if (!this.corpusAvailable) return null;
    const bundle = getVerifiedRecordedBundle();
    return bundle.valid ? bundle : null;
  }

  private failClosed<T>(siteId: string, schemaId: string, emptyData: T | null = null): ResearchViewEnvelope<T> {
    const bundle = getVerifiedRecordedBundle();
    return makeEnvelope({
      datasetMode: 'RECORDED_M14_RESEARCH',
      statusCode: 'SOURCE_NOT_PROVIDED',
      siteId,
      fixtureKind: 'RECORDED_M14_RESEARCH_DISABLED',
      availability: 'UNAVAILABLE',
      data: emptyData,
      reasons: [
        this.corpusAvailable && bundle.reason
          ? `SOURCE_NOT_PROVIDED: ${bundle.reason}`
          : 'SOURCE_NOT_PROVIDED: Authorized raw M14 research corpus (candidate_audit.json / OUTPUT_RECEIPT.json) is missing or failed integrity verification.',
        'Per scientific integrity rules, ASTRAGRON never substitutes synthetic demo data when verified recorded sources are unavailable.',
      ],
      missingRequirements: ['Authorized raw M14 research corpus with valid SHA-256 OUTPUT_RECEIPT.json'],
      upstreamSchema: schemaId,
    });
  }

  getFarmDraft(siteId: string): ResearchViewEnvelope<UserFarmDraft> {
    const bundle = this.getVerifiedOrFail();
    if (!bundle) return this.failClosed<UserFarmDraft>(siteId, M4_SCHEMA_ID);

    const canonicalId = normalizeCanonicalSiteId(siteId);
    if (canonicalId === 'uppsala-demo') {
      return makeEnvelope({
        datasetMode: this.mode,
        statusCode: 'OK_RECORDED_RESEARCH',
        siteId: 'uppsala-demo',
        fixtureKind: 'RECORDED_M14_RESEARCH',
        availability: 'READY',
        data: DEFAULT_UPPSALA_FARM_DRAFT,
        reasons: [
          'Loaded fixed SE_UPPSALA research case baseline draft (F1=6 ha rainfed, F2=8 ha rainfed, F3=10 ha irrigable).',
          'Editing any parameter forks a separate custom draft that cannot reuse the recorded M14 output.',
        ],
        upstreamSchema: M4_SCHEMA_ID,
        scientificReceipt: {
          schema: 'astragron.m14.candidate-audit.v1',
          protocolSha256: bundle.protocolSha256,
          receiptSha256: bundle.snapshotSha256,
          canonicalSiteId: 'SE_UPPSALA',
        },
        inputIdentity: {
          siteId: 'uppsala-demo',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          referenceRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          inputsModified: false,
        },
      });
    }
    return this.m4Helper.getFarmDraft(siteId);
  }

  getSiteCoverageContext(siteId: string, draft?: UserFarmDraft | null) {
    if (!this.getVerifiedOrFail()) return this.failClosed<ExplorerPresetSite>(siteId, M4_SCHEMA_ID);
    return this.m4Helper.getSiteCoverageContext(siteId, draft);
  }
  getSiteCoverage(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }
  getCoverageReport(siteId: string, draft?: UserFarmDraft | null) {
    return this.getSiteCoverageContext(siteId, draft);
  }

  getM14DecisionEvaluation(
    farmId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<M14DecisionDataset> {
    const bundle = this.getVerifiedOrFail();
    if (!bundle || !bundle.decisionDataset) {
      return this.failClosed<M14DecisionDataset>(farmId, M14_RESPONSE_SCHEMA_ID);
    }

    const modifiedCheck = checkModifiedOrCustomIdentityHelper(farmId, draft, this.customDraftIds);
    if (modifiedCheck.blocked) {
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: modifiedCheck.statusCode,
        siteId: farmId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [
          ...modifiedCheck.reasons,
          'RECORDED_M14_RESEARCH is strictly bound to unmodified SE_UPPSALA inputs and never re-evaluates modified farms.',
        ],
        missingRequirements: [
          'Live REAL_SCIENTIFIC_BACKEND connection for re-optimizing custom or modified farm definitions',
        ],
        upstreamSchema: M14_RESPONSE_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }

    const canonicalId = normalizeCanonicalSiteId(farmId);
    if (canonicalId === 'uppsala-demo') {
      const ds = bundle.decisionDataset;
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'OK_RECORDED_RESEARCH',
        siteId: 'uppsala-demo',
        fixtureKind: 'RECORDED_M14_RESEARCH',
        availability: 'READY',
        data: ds,
        reasons: [
          `RECORDED_M14_RESEARCH: Loaded SHA-256 verified M14 corpus (${ds.portfolioSummary.totalPolicies} policies × ${ds.portfolioSummary.totalScenarioStates} states = ${ds.portfolioSummary.totalPolicyStateCases} cases: ${ds.portfolioSummary.numericPassCases} PASS / ${ds.portfolioSummary.numericFailCases} FAIL / ${ds.portfolioSummary.calendarInvalidCases} INVALID_CALENDAR).`,
          '0 of 16 policies pass all 9 states; FIELD_RECOMMENDATION_ELIGIBILITY = BLOCKED.',
        ],
        missingRequirements: ds.fieldRecommendationBlockedReasons,
        upstreamSchema: ds.scientificMeta?.sourceSchema ?? M14_RESPONSE_SCHEMA_ID,
        scientificReceipt: ds.scientificMeta
          ? {
              schema: ds.scientificMeta.sourceSchema,
              protocolSha256: ds.scientificMeta.protocolSha256,
              receiptSha256: bundle.snapshotSha256,
              canonicalSiteId: 'SE_UPPSALA',
              generatedInEnvironment: ds.scientificMeta.environmentNote,
              crossPlatformCaveat: ds.scientificMeta.crossPlatformCaveat,
              selectionBiasNote: ds.scientificMeta.inSampleSelectionNote,
            }
          : undefined,
        provenance: [
          { sourceId: 'M14_CANDIDATE_AUDIT', evidenceId: 'm14-ev-candidate-audit-uppsala', asOf: ds.evaluatedAt },
          { sourceId: 'M14_RESOURCE_FRONTIERS', evidenceId: 'm14-ev-resource-frontiers-uppsala', asOf: ds.evaluatedAt },
          { sourceId: 'NASA_POWER_2006_2025', evidenceId: 'm14-ev-power-2006-2025-uppsala', asOf: ds.evaluatedAt },
        ],
        inputIdentity: {
          siteId: 'uppsala-demo',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          referenceRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          inputsModified: false,
        },
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (preset || gaz) {
      const siteName = preset?.name ?? gaz?.label ?? canonicalId;
      return makeEnvelope<M14DecisionDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'MODEL_UNQUALIFIED',
        siteId: canonicalId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'MODEL_UNQUALIFIED',
        data: null,
        reasons: [
          `MODEL_UNQUALIFIED: Recorded M14 crop-decision corpus is strictly scoped to SE_UPPSALA (Uppsala, Sweden) and is NOT qualified for ${siteName}.`,
          'ASTRAGRON never extrapolates Swedish 5-year policy tables to Kenya, Australia, or other sites.',
        ],
        missingRequirements: [
          `Site-calibrated agronomic water-balance model and legal rights registry for ${siteName}`,
        ],
        upstreamSchema: M14_RESPONSE_SCHEMA_ID,
      });
    }

    return makeEnvelope<M14DecisionDataset>({
      datasetMode: 'RECORDED_M14_RESEARCH',
      statusCode: 'SITE_NOT_FOUND',
      siteId: farmId,
      fixtureKind: 'RECORDED_M14_RESEARCH',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [`SITE_NOT_FOUND: Unknown farm identifier "${farmId}".`],
      missingRequirements: ['Valid registered site_id'],
      upstreamSchema: M14_RESPONSE_SCHEMA_ID,
    });
  }

  getDecisionEvaluation(farmId: string, draft?: UserFarmDraft | null) {
    return this.getM14DecisionEvaluation(farmId, draft);
  }

  getClimateWaterSeries(
    farmId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<ClimateWaterDataset> {
    const bundle = this.getVerifiedOrFail();
    if (!bundle || !bundle.climateDataset) {
      return this.failClosed<ClimateWaterDataset>(farmId, M4_SCHEMA_ID);
    }

    const modifiedCheck = checkModifiedOrCustomIdentityHelper(farmId, draft, this.customDraftIds);
    if (modifiedCheck.blocked) {
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: modifiedCheck.statusCode,
        siteId: farmId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: modifiedCheck.reasons,
        missingRequirements: ['Live M4 meteorology extraction and water-balance service'],
        upstreamSchema: M4_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }

    const canonicalId = normalizeCanonicalSiteId(farmId);
    if (canonicalId === 'uppsala-demo') {
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'OK_RECORDED_RESEARCH',
        siteId: 'uppsala-demo',
        fixtureKind: 'RECORDED_M14_RESEARCH',
        availability: 'READY',
        data: bundle.climateDataset,
        reasons: [
          'Loaded verified daily NASA POWER PRECTOTCORR/T2M_MIN/T2M_MAX (POWER_2006_2025.json) for SE_UPPSALA across historical anchors 2018, 2006, and 2012.',
        ],
        upstreamSchema: M4_SCHEMA_ID,
        provenance: [
          {
            sourceId: 'NASA_POWER_2006_2025',
            evidenceId: 'm14-ev-power-2006-2025-uppsala',
            asOf: bundle.decisionDataset?.evaluatedAt,
          },
        ],
        inputIdentity: {
          siteId: 'uppsala-demo',
          inputRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          referenceRevision: UPPSALA_REFERENCE_INPUT_REVISION,
          inputsModified: false,
        },
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (preset || gaz) {
      return makeEnvelope<ClimateWaterDataset>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'MODEL_UNQUALIFIED',
        siteId: canonicalId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'MODEL_UNQUALIFIED',
        data: null,
        reasons: [
          `MODEL_UNQUALIFIED: SE_UPPSALA 2006–2025 water-balance historical anchor series cannot be mapped to "${canonicalId}".`,
          'Inspect M4 Coverage & Evidence tabs for site-scoped NASA POWER 2023–2024 diagnostic samples.',
        ],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope<ClimateWaterDataset>({
      datasetMode: 'RECORDED_M14_RESEARCH',
      statusCode: 'SITE_NOT_FOUND',
      siteId: farmId,
      fixtureKind: 'RECORDED_M14_RESEARCH',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [`SITE_NOT_FOUND: Unknown farm identifier "${farmId}".`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getEvidenceRecordsForSite(siteId: string, draft?: UserFarmDraft | null): EvidenceRecord[] {
    const bundle = this.getVerifiedOrFail();
    if (!bundle) return [];
    const modifiedCheck = checkModifiedOrCustomIdentityHelper(siteId, draft, this.customDraftIds);
    if (modifiedCheck.blocked) return [];
    const canonicalId = normalizeCanonicalSiteId(siteId);
    const m4Recs = bundle.m4Sites?.[canonicalId]?.evidenceRecords ?? [];
    if (canonicalId === 'uppsala-demo') {
      return [...(bundle.m14EvidenceRecords ?? []), ...m4Recs];
    }
    return m4Recs;
  }

  getEvidenceRecords(siteId: string, draft?: UserFarmDraft | null): ResearchViewEnvelope<EvidenceRecord[]> {
    const bundle = this.getVerifiedOrFail();
    if (!bundle) return this.failClosed<EvidenceRecord[]>(siteId, M4_SCHEMA_ID, []);

    const modifiedCheck = checkModifiedOrCustomIdentityHelper(siteId, draft, this.customDraftIds);
    if (modifiedCheck.blocked) {
      return makeEnvelope({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: modifiedCheck.statusCode,
        siteId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: modifiedCheck.reasons,
        upstreamSchema: M4_SCHEMA_ID,
        inputIdentity: modifiedCheck.identity,
      });
    }

    const canonicalId = normalizeCanonicalSiteId(siteId);
    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (!preset && !gaz) {
      return makeEnvelope({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'SITE_NOT_FOUND',
        siteId,
        fixtureKind: 'RECORDED_M14_RESEARCH',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: [`SITE_NOT_FOUND: Unknown site identifier "${siteId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const recs = this.getEvidenceRecordsForSite(canonicalId, draft);
    if (recs.length === 0) {
      return makeEnvelope({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'NO_EVIDENCE_FOR_SITE',
        siteId: canonicalId,
        fixtureKind: 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'UNAVAILABLE',
        data: [],
        reasons: [`NO_EVIDENCE_FOR_SITE: No verified recorded M4/M14 artifacts bundled for "${canonicalId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope({
      datasetMode: 'RECORDED_M14_RESEARCH',
      statusCode: canonicalId === 'uppsala-demo' ? 'OK_RECORDED_RESEARCH' : 'OK_COVERAGE_ONLY',
      siteId: canonicalId,
      fixtureKind: canonicalId === 'uppsala-demo' ? 'RECORDED_M14_RESEARCH' : 'M4_GLOBAL_COVERAGE_RECORD',
      availability: 'READY',
      data: recs,
      reasons: [`Loaded ${recs.length} SHA-256 verified M4/M14 provenance record(s) for "${canonicalId}".`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  getEvidenceRecord(
    scope: EvidenceScope,
    evidenceId: string,
    draft?: UserFarmDraft | null
  ): ResearchViewEnvelope<EvidenceRecord> {
    const bundle = this.getVerifiedOrFail();
    if (!bundle) return this.failClosed<EvidenceRecord>(scope.siteId, M4_SCHEMA_ID, null);

    if (scope.datasetMode !== 'RECORDED_M14_RESEARCH') {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'BACKEND_NOT_CONNECTED',
        siteId: scope.siteId,
        fixtureKind: 'BACKEND_NOT_CONNECTED',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [`Scope datasetMode "${scope.datasetMode}" does not match RECORDED_M14_RESEARCH.`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const canonicalId = normalizeCanonicalSiteId(scope.siteId);
    const recs = this.getEvidenceRecordsForSite(canonicalId, draft);
    const hit = recs.find(
      (r) => r.evidence_id === evidenceId && r.site_id === canonicalId && r.dataset_mode === 'RECORDED_M14_RESEARCH'
    );

    if (hit) {
      return makeEnvelope({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: canonicalId === 'uppsala-demo' ? 'OK_RECORDED_RESEARCH' : 'OK_COVERAGE_ONLY',
        siteId: canonicalId,
        fixtureKind: canonicalId === 'uppsala-demo' ? 'RECORDED_M14_RESEARCH' : 'M4_GLOBAL_COVERAGE_RECORD',
        availability: 'READY',
        data: hit,
        reasons: [`Loaded site-scoped verified provenance "${evidenceId}" for "${canonicalId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    const preset = EXPLORER_PRESET_SITES[canonicalId];
    const gaz = DEMO_SEARCH_INDEX.find((g) => g.id === canonicalId);
    if (!preset && !gaz && !draft && !isCustomDraftId(scope.siteId, this.customDraftIds)) {
      return makeEnvelope<EvidenceRecord>({
        datasetMode: 'RECORDED_M14_RESEARCH',
        statusCode: 'SITE_NOT_FOUND',
        siteId: scope.siteId,
        fixtureKind: 'RECORDED_M14_RESEARCH',
        availability: 'UNAVAILABLE',
        data: null,
        reasons: [`SITE_NOT_FOUND: Unknown site "${scope.siteId}".`],
        upstreamSchema: M4_SCHEMA_ID,
      });
    }

    return makeEnvelope<EvidenceRecord>({
      datasetMode: 'RECORDED_M14_RESEARCH',
      statusCode: 'NO_EVIDENCE_FOR_SITE',
      siteId: scope.siteId,
      fixtureKind: 'RECORDED_M14_RESEARCH',
      availability: 'UNAVAILABLE',
      data: null,
      reasons: [`NO_EVIDENCE_FOR_SITE: Evidence "${evidenceId}" is unavailable under site scope "${scope.siteId}".`],
      upstreamSchema: M4_SCHEMA_ID,
    });
  }

  submitCustomFarmEvaluation(_draft: UserFarmDraft) {
    return {
      accepted: false,
      statusCode: 'BACKEND_NOT_CONNECTED' as const,
      reason: 'Recorded M14 mode is read-only for SE_UPPSALA; evaluating a custom farm requires REAL_SCIENTIFIC_BACKEND.',
    };
  }
}

/**
 * Disabled-by-default Real Scientific Repository stub (`REAL_SCIENTIFIC_BACKEND`)
 * Fails closed with `BACKEND_NOT_CONNECTED`.
 */
export class RealScientificRepositoryStub implements ScientificRepositoryAdapter {
  readonly mode = 'REAL_SCIENTIFIC_BACKEND' as const;
  readonly adapterId = 'REAL_SCIENTIFIC_BACKEND' as const;
  readonly isLiveBackendConnected = false;

  private failClosed<T>(siteId: string, schemaId: string, emptyData: T | null = null): ResearchViewEnvelope<T> {
    return makeEnvelope({
      datasetMode: 'REAL_SCIENTIFIC_BACKEND',
      statusCode: 'BACKEND_NOT_CONNECTED',
      siteId,
      fixtureKind: 'BACKEND_NOT_CONNECTED',
      availability: 'UNAVAILABLE',
      data: emptyData,
      reasons: [
        'BACKEND_NOT_CONNECTED: No live M4/M14 scientific backend endpoint is connected in this standalone frontend build.',
        'Frontend does not execute browser-side agronomic simulation or unauthenticated remote API calls.',
      ],
      missingRequirements: ['Authenticated M4/M14 scientific backend service connection'],
      upstreamSchema: schemaId,
    });
  }

  getFarmDraft(siteId: string) {
    return this.failClosed<UserFarmDraft>(siteId, M4_SCHEMA_ID);
  }
  getSiteCoverageContext(siteId: string) {
    return this.failClosed<ExplorerPresetSite>(siteId, M4_SCHEMA_ID);
  }
  getSiteCoverage(siteId: string) {
    return this.failClosed<ExplorerPresetSite>(siteId, M4_SCHEMA_ID);
  }
  getCoverageReport(siteId: string) {
    return this.failClosed<ExplorerPresetSite>(siteId, M4_SCHEMA_ID);
  }
  getM14DecisionEvaluation(farmId: string) {
    return this.failClosed<M14DecisionDataset>(farmId, M14_RESPONSE_SCHEMA_ID);
  }
  getDecisionEvaluation(farmId: string) {
    return this.failClosed<M14DecisionDataset>(farmId, M14_RESPONSE_SCHEMA_ID);
  }
  getClimateWaterSeries(farmId: string) {
    return this.failClosed<ClimateWaterDataset>(farmId, M4_SCHEMA_ID);
  }
  getEvidenceRecordsForSite(_siteId: string): EvidenceRecord[] {
    return [];
  }
  getEvidenceRecords(siteId: string) {
    return this.failClosed<EvidenceRecord[]>(siteId, M4_SCHEMA_ID, []);
  }
  getEvidenceRecord(scope: EvidenceScope, _evidenceId: string) {
    return this.failClosed<EvidenceRecord>(scope.siteId, M4_SCHEMA_ID, null);
  }
  submitCustomFarmEvaluation(_draft: UserFarmDraft) {
    return {
      accepted: false,
      statusCode: 'BACKEND_NOT_CONNECTED' as const,
      reason: 'Live scientific backend is not connected.',
    };
  }
}

export const syntheticDemoRepository = new SyntheticDemoRepository();
export const m4SourceCoverageRepository = new M4SourceCoverageRepository();
export const recordedM14Repository = new RecordedM14ResearchRepository();
export const realRepositoryStub = new RealScientificRepositoryStub();
export const demoRepository = syntheticDemoRepository;

export function getRepositoryForMode(
  mode: DatasetOperatingMode = 'SYNTHETIC_UI_DEMO',
  customDraftIds: string[] = [],
  options?: { corpusAvailable?: boolean }
): ScientificRepositoryAdapter {
  if (mode === 'RECORDED_M14_RESEARCH') {
    if (options?.corpusAvailable === false || customDraftIds.length > 0) {
      return new RecordedM14ResearchRepository({
        corpusAvailable: options?.corpusAvailable,
        customDraftIds,
      });
    }
    return recordedM14Repository;
  }
  if (mode === 'REAL_SCIENTIFIC_BACKEND') return realRepositoryStub;
  if (customDraftIds.length > 0) {
    return new SyntheticDemoRepository(customDraftIds);
  }
  return syntheticDemoRepository;
}

export const createRepositoryForMode = getRepositoryForMode;

/**
 * Builds a strictly site-bound, mode-labeled export payload for `/farm/[id]/reports` and tests.
 * Never leaks Uppsala synthetic policies or climate series into other sites or unknown IDs.
 */
export function buildSiteBoundExportPayload(
  farmId: string,
  arg2?: string | DatasetOperatingMode | UserFarmDraft | null,
  arg3?: [number, number] | ResearchPreference | UserFarmDraft | null,
  arg4?: ResearchPreference | DatasetOperatingMode | UserFarmDraft | null,
  arg5?: ScientificRepositoryAdapter | DatasetOperatingMode | UserFarmDraft | null,
  arg6?: UserFarmDraft | null
) {
  let mode: DatasetOperatingMode = 'SYNTHETIC_UI_DEMO';
  let preference: ResearchPreference = 'MINIMIZE_WORST_ET_SHORTFALL';
  let repo: ScientificRepositoryAdapter = syntheticDemoRepository;
  let draft: UserFarmDraft | null = arg6 ?? null;

  for (const candidate of [arg2, arg3, arg4, arg5, arg6]) {
    if (candidate && typeof candidate === 'object' && 'fields' in candidate) {
      draft = candidate as UserFarmDraft;
    }
  }

  if (
    arg2 === 'SYNTHETIC_UI_DEMO' ||
    arg2 === 'RECORDED_M14_RESEARCH' ||
    arg2 === 'REAL_SCIENTIFIC_BACKEND'
  ) {
    mode = arg2;
    repo = getRepositoryForMode(mode);
  } else if (typeof arg5 === 'object' && arg5 !== null && 'mode' in arg5) {
    repo = arg5;
    mode = arg5.mode;
  } else if (
    arg5 === 'SYNTHETIC_UI_DEMO' ||
    arg5 === 'RECORDED_M14_RESEARCH' ||
    arg5 === 'REAL_SCIENTIFIC_BACKEND'
  ) {
    mode = arg5;
    repo = getRepositoryForMode(mode);
  }

  if (
    arg4 === 'STRICT_ALL_SCENARIOS_SERVICE' ||
    arg4 === 'MINIMIZE_WORST_ET_SHORTFALL' ||
    arg4 === 'MINIMAX_REGRET' ||
    arg4 === 'PARETO_FRONTIER'
  ) {
    preference = arg4;
  } else if (
    arg3 === 'STRICT_ALL_SCENARIOS_SERVICE' ||
    arg3 === 'MINIMIZE_WORST_ET_SHORTFALL' ||
    arg3 === 'MINIMAX_REGRET' ||
    arg3 === 'PARETO_FRONTIER'
  ) {
    preference = arg3;
  }

  const coverageEnv = repo.getSiteCoverageContext(farmId, draft);
  const decisionEnv = repo.getM14DecisionEvaluation(farmId, draft);
  const climateEnv = repo.getClimateWaterSeries(farmId, draft);
  const evidenceRecords = repo.getEvidenceRecordsForSite(farmId, draft);

  const exportStatus: RepositoryStatusCode =
    coverageEnv.statusCode === 'SITE_NOT_FOUND'
      ? 'SITE_NOT_FOUND'
      : decisionEnv.statusCode === 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
      ? 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
      : decisionEnv.statusCode === 'OK_RECORDED_RESEARCH'
      ? 'OK_RECORDED_RESEARCH'
      : decisionEnv.statusCode === 'OK_SYNTHETIC_DEMO'
      ? 'OK_SYNTHETIC_DEMO'
      : coverageEnv.statusCode;

  const watermark =
    mode === 'RECORDED_M14_RESEARCH'
      ? 'RECORDED M14 SCIENTIFIC RESEARCH ARTIFACT (READ-ONLY) — VERIFIED SE_UPPSALA CORPUS — NOT A FIELD RECOMMENDATION'
      : mode === 'REAL_SCIENTIFIC_BACKEND'
      ? 'BACKEND_NOT_CONNECTED — NO LIVE SCIENTIFIC OUTPUT AVAILABLE'
      : 'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS — NOT A FARM RECOMMENDATION';

  return {
    exportAllowed: coverageEnv.statusCode !== 'SITE_NOT_FOUND',
    exportStatus,
    siteId: coverageEnv.siteId,
    inputIdentity: decisionEnv.inputIdentity ?? (draft ? {
      siteId: farmId,
      inputRevision: computeDraftInputRevision(draft),
      referenceRevision: null,
      inputsModified: Boolean(draft.inputsModified || draft.isUserCreatedDraft),
    } : undefined),
    watermark,
    datasetMode: mode,
    fieldValidated: false,
    preference,
    coverageReport: coverageEnv.data,
    decisionDataset: decisionEnv.data,
    climateDataset: climateEnv.data,
    evidenceRecords,
    reasons: [...coverageEnv.reasons, ...decisionEnv.reasons],
  };
}

/**
 * Configurable Geocoder Adapter (`P1-F`)
 * Reads NEXT_PUBLIC_GEOCODER_ENDPOINT if configured; otherwise searches the local 16-site gazetteer without external scraping.
 */
export interface GeocoderSearchResult {
  adapterMode: 'OFFLINE_LOCAL_GAZETTEER' | 'CONFIGURED_REMOTE_ENDPOINT';
  mode: 'OFFLINE_LOCAL_GAZETTEER' | 'CONFIGURED_REMOTE_ENDPOINT';
  configuredEndpoint: string | null;
  results: LocalGazetteerEntry[];
  notice: string;
}

export function searchLocationsViaAdapter(query: string): GeocoderSearchResult {
  const configuredEndpoint =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GEOCODER_ENDPOINT
      ? process.env.NEXT_PUBLIC_GEOCODER_ENDPOINT.trim()
      : '';

  const q = query.trim().toLowerCase();
  const localMatches = !q
    ? DEMO_SEARCH_INDEX
    : DEMO_SEARCH_INDEX.filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.shortName.toLowerCase().includes(q) ||
          item.country.toLowerCase().includes(q) ||
          item.region.toLowerCase().includes(q) ||
          item.countryCode.toLowerCase().includes(q)
      );

  const adapterMode = configuredEndpoint ? 'CONFIGURED_REMOTE_ENDPOINT' : 'OFFLINE_LOCAL_GAZETTEER';

  return {
    adapterMode,
    mode: adapterMode,
    configuredEndpoint: configuredEndpoint || null,
    results: localMatches,
    notice: configuredEndpoint
      ? `External geocoder endpoint (${configuredEndpoint}) configured; using local gazetteer fallback.`
      : 'Offline Local Gazetteer active (16 reference localities). No external Nominatim/third-party requests are sent.',
  };
}

export { DEFAULT_UPPSALA_FARM_DRAFT };
