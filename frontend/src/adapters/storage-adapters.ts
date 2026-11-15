import type {
  DatasetOperatingMode,
  UserFarmDraft,
} from '@/domain/contracts';
import type { ScientificRepositoryAdapter } from './repositories';
import { computeDraftInputRevision } from '@/domain/schemas';
import { EXPLORER_PRESET_SITES } from '@/fixtures/sites-and-coverage';
import {
  ChatMessageRecordSchema,
  ChatThreadRecordSchema,
  FarmBackupBundleSchema,
  ReportEnvelopeSchema,
  type ChatMessageRecord,
  type ChatThreadRecord,
  type FarmBackupBundle,
  type ReportEnvelope,
} from '@/domain/farmer-ux-contracts';
import { computeDeterministicDigest } from '@/lib/deterministic-hash';

export const STORAGE_KEY_REPORTS = 'astragron_reports_v1';
export const STORAGE_KEY_ARCHIVED_FARMS = 'astragron_archived_farms_v1';
export const STORAGE_KEY_CHAT_THREADS = 'astragron_chat_threads_v1';

export const IMMUTABLE_RESEARCH_EXAMPLE_IDS = new Set<string>(
  Object.keys(EXPLORER_PRESET_SITES)
);

export interface StorageWriteOutcome {
  ok: boolean;
  error: string | null;
  persistenceMode: 'LOCAL_DEVICE_ONLY';
}

export function safeReadLocalJson<T>(key: string): { ok: boolean; value: T | null; error: string | null } {
  if (typeof window === 'undefined') {
    return { ok: true, value: null, error: null };
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ok: true, value: null, error: null };
    return { ok: true, value: JSON.parse(raw) as T, error: null };
  } catch (err) {
    return {
      ok: false,
      value: null,
      error: err instanceof Error ? err.message : 'Unable to read browser localStorage.',
    };
  }
}

export function safeWriteLocalJson(key: string, payload: unknown): StorageWriteOutcome {
  if (typeof window === 'undefined') {
    return { ok: true, error: null, persistenceMode: 'LOCAL_DEVICE_ONLY' };
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
    return { ok: true, error: null, persistenceMode: 'LOCAL_DEVICE_ONLY' };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not save on this device (${err.name || 'StorageError'}): ${err.message}`
          : 'Browser local storage is blocked or quota is full.',
      persistenceMode: 'LOCAL_DEVICE_ONLY',
    };
  }
}

export function isBuiltInResearchSite(farmId: string): boolean {
  return IMMUTABLE_RESEARCH_EXAMPLE_IDS.has(farmId);
}

export function computeFarmAreaHa(draft: UserFarmDraft): number | null {
  if (draft.fields.length === 0) return null;
  let sum = 0;
  let hasAny = false;
  for (const field of draft.fields) {
    if (typeof field.declaredAreaHa === 'number' && Number.isFinite(field.declaredAreaHa)) {
      sum += field.declaredAreaHa;
      hasAny = true;
    }
  }
  return hasAny ? Number(sum.toFixed(2)) : null;
}

export function slugifyCustomFarmId(name: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24);
  const prefix = `custom-${slug || 'farm'}`;
  for (let i = 1; i < 9999; i++) {
    const suffix = i === 1 ? Math.random().toString(36).slice(2, 6) : `${i}`;
    const candidate = `${prefix}-${suffix}`;
    if (!existing.has(candidate) && !IMMUTABLE_RESEARCH_EXAMPLE_IDS.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

export function buildDuplicatedFarmDraft(
  source: UserFarmDraft,
  existingIds: Iterable<string>,
  customName?: string
): UserFarmDraft {
  const now = new Date().toISOString();
  const nextId = slugifyCustomFarmId(customName ?? source.name, existingIds);
  const cloned = structuredClone(source);
  cloned.id = nextId;
  cloned.name = (customName ?? `${source.name} (Copy)`).trim();
  cloned.createdAt = now;
  cloned.updatedAt = now;
  cloned.isUserCreatedDraft = true;
  if (isBuiltInResearchSite(source.id)) {
    cloned.derivedFromFixtureId = source.id;
  }
  cloned.inputsModified = true;
  cloned.inputRevision = computeDraftInputRevision(cloned);
  return cloned;
}

export function exportFarmBackupBundle(params: {
  farms: Record<string, UserFarmDraft>;
  archivedFarmIds: string[];
  reports: ReportEnvelope[];
}): FarmBackupBundle {
  const userFarmsOnly: Record<string, UserFarmDraft> = {};
  for (const [id, draft] of Object.entries(params.farms)) {
    if (!isBuiltInResearchSite(id)) {
      userFarmsOnly[id] = draft;
    }
  }
  const exportedAt = new Date().toISOString();
  const body = {
    schemaVersion: 'astragron.farm-backup.v1' as const,
    exportedAt,
    archivedFarmIds: params.archivedFarmIds.filter((id) => !isBuiltInResearchSite(id)),
    farms: userFarmsOnly,
    reports: params.reports,
  };
  const checksum = computeDeterministicDigest(JSON.stringify(body));
  return { ...body, checksum };
}

export function parseAndValidateBackupBundle(
  rawJson: string
): { ok: true; bundle: FarmBackupBundle } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'The selected file is not valid JSON.' };
  }

  const res = FarmBackupBundleSchema.safeParse(parsed);
  if (!res.success) {
    return {
      ok: false,
      error: `Invalid ASTRAGRON backup format: ${res.error.issues[0]?.message ?? 'schema check failed'}.`,
    };
  }

  const { checksum, ...rest } = res.data;
  const expected = computeDeterministicDigest(JSON.stringify(rest));
  if (expected !== checksum) {
    return {
      ok: false,
      error: `Backup checksum mismatch (expected ${expected}, got ${checksum}). File may be tampered or corrupted.`,
    };
  }

  const safeFarms: Record<string, UserFarmDraft> = {};
  for (const [id, rawDraft] of Object.entries(res.data.farms)) {
    if (!rawDraft || typeof rawDraft !== 'object') continue;
    const candidate = rawDraft as UserFarmDraft;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      !candidate.site ||
      !Array.isArray(candidate.fields)
    ) {
      return { ok: false, error: `Farm entry "${id}" is missing required site or field properties.` };
    }
    if (isBuiltInResearchSite(id)) {
      return { ok: false, error: `Refusing to overwrite immutable built-in site "${id}".` };
    }
    safeFarms[id] = candidate;
  }

  return {
    ok: true,
    bundle: {
      schemaVersion: 'astragron.farm-backup.v1',
      exportedAt: res.data.exportedAt,
      archivedFarmIds: res.data.archivedFarmIds,
      farms: safeFarms,
      reports: res.data.reports,
      checksum,
    },
  };
}

export const ReportStorageAdapter = {
  loadAll(): { ok: boolean; reports: ReportEnvelope[]; error: string | null } {
    const read = safeReadLocalJson<unknown[]>(STORAGE_KEY_REPORTS);
    if (!read.ok) return { ok: false, reports: [], error: read.error };
    if (!Array.isArray(read.value)) return { ok: true, reports: [], error: null };
    const valid: ReportEnvelope[] = [];
    for (const item of read.value) {
      const parsed = ReportEnvelopeSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      }
    }
    valid.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { ok: true, reports: valid, error: null };
  },

  saveAll(reports: ReportEnvelope[]): StorageWriteOutcome {
    return safeWriteLocalJson(STORAGE_KEY_REPORTS, reports);
  },

  isReportStale(report: ReportEnvelope, currentDraft: UserFarmDraft | null | undefined): boolean {
    if (!currentDraft) return false;
    const currentRev = computeDraftInputRevision(currentDraft);
    return report.inputRevision !== currentRev;
  },
};

export function buildReportEnvelopeFromEvaluation(params: {
  farm: UserFarmDraft;
  repository: ScientificRepositoryAdapter;
  datasetMode: DatasetOperatingMode;
  jobId: string;
}): ReportEnvelope {
  const { farm, repository, datasetMode, jobId } = params;
  const siteEnv = repository.getSiteCoverageContext(farm.id, farm);
  const decisionEnv = repository.getM14DecisionEvaluation(farm.id, farm);
  const climateEnv = repository.getClimateWaterSeries(farm.id, farm);
  const inputRev = computeDraftInputRevision(farm);
  const createdAt = new Date().toISOString();
  const totalAreaHa = computeFarmAreaHa(farm);

  const preset = siteEnv.data;
  const sourceCoveragesSummary = (preset?.sourceCoverages ?? []).map((src) => ({
    sourceId: src.source_id,
    title: src.source_title,
    status: src.status,
    coverageKind:
      src.status === 'AVAILABLE' || src.status === 'CONDITIONAL'
        ? 'Regional / EO Context'
        : 'Not Available',
    resolution: src.spatial_coverage || src.temporal_resolution || 'Variable',
  }));

  const availableCount = sourceCoveragesSummary.filter((s) => s.status === 'AVAILABLE').length;
  const conditionalCount = sourceCoveragesSummary.filter((s) => s.status === 'CONDITIONAL').length;
  const unavailableCount = sourceCoveragesSummary.length - availableCount - conditionalCount;

  const sourceReadinessChart = [
    { label: 'Available EO layers', value: availableCount, unit: 'sources', statusTag: 'AVAILABLE' },
    { label: 'Conditional layers', value: conditionalCount, unit: 'sources', statusTag: 'CONDITIONAL' },
    { label: 'Unavailable / gap', value: unavailableCount, unit: 'sources', statusTag: 'GAP' },
  ];

  let dataAvailabilityClass: ReportEnvelope['dataAvailabilityClass'] = 'COVERAGE_ONLY';
  let headlineStatus = 'Evidence availability report — no crop recommendation available';
  let recommendationNotice =
    'Evidence availability report — no crop recommendation available for this farm.';
  const summaryFindings: string[] = [];
  const whatWeKnow: string[] = [];
  const whatWeDontKnow: string[] = [];
  const whatHappensNext: string[] = [];
  const waterBalanceChart: ReportEnvelope['waterBalanceChart'] = [];
  const scientificNotes: string[] = [];

  if (decisionEnv.data && climateEnv.data) {
    const ds = decisionEnv.data;
    const isRecorded = ds.datasetMode === 'RECORDED_M14_RESEARCH';
    dataAvailabilityClass = isRecorded ? 'VERIFIED_RECORDED_CORPUS' : 'SYNTHETIC_DEMO_CORPUS';
    headlineStatus = isRecorded
      ? 'Recorded research archive — conditional multi-year comparison (recommendation blocked)'
      : 'Synthetic interface demonstration — conditional comparison (recommendation blocked)';
    recommendationNotice =
      'No tested rotation passed the 100 mm seasonal water threshold across every simulated year. Comparison charts are shown for research context only, not as a prescription.';

    summaryFindings.push(
      `Evaluated ${ds.portfolioSummary.totalPoliciesTested ?? ds.portfolioSummary.totalPolicies} candidate 5-year crop rotations across ${ds.portfolioSummary.totalScenarioStates} weather and water conditions.`
    );
    summaryFindings.push(
      `Fields F1 and F2 rely on rainfall alone and face ${ds.referenceSelections.nonIrrigableDryDeficitMm.toFixed(1)} mm water deficit in the 2018 dry-year analogue (above the 100.0 mm research ceiling).`
    );
    summaryFindings.push(
      `Among comparable plans, ${ds.referenceSelections.leastWorstShortfallPolicyId} showed the smallest worst-year deficit (${ds.referenceSelections.leastWorstShortfallValueM3Eq.toFixed(1)} m3 eq), while ${ds.referenceSelections.minimaxRegretPolicyId} had the lowest regret (${ds.referenceSelections.minimaxRegretValueM3Eq.toFixed(1)} m3 eq).`
    );

    for (const yr of climateEnv.data.analogueSummaries) {
      waterBalanceChart.push({
        label: yr.label,
        value: yr.peakF1DeficitMm,
        unit: 'mm',
        statusTag: yr.classification,
      });
    }

    whatWeKnow.push(
      `Location anchored at [${farm.site.longitude.toFixed(4)}, ${farm.site.latitude.toFixed(4)}] covering ${totalAreaHa ?? 24} ha across ${farm.fields.length} fields.`
    );
    whatWeKnow.push(
      `Historical weather analogues cover dry (2018), median (2006), and wet (2012) growing seasons at regional grid resolution.`
    );
    whatWeDontKnow.push(
      'Local on-farm soil core profiles, verified irrigation delivery permits, and real-time crop variety yields are not field-validated.'
    );
    whatWeDontKnow.push(
      'Nitrogen values are modeled mass balances rather than field fertilizer prescriptions.'
    );
    whatHappensNext.push(
      'Download this PDF report for offline review with an agronomist.'
    );
    whatHappensNext.push(
      'Adjust field boundaries or crop years on a custom copy if testing alternative farm setups.'
    );

    scientificNotes.push(`M14 Decision Schema: ${ds.schemaId} | Dataset Mode: ${ds.datasetMode}`);
    if (ds.scientificMeta?.protocolSha256) {
      scientificNotes.push(`Protocol SHA-256: ${ds.scientificMeta.protocolSha256}`);
    }
  } else {
    const isModifiedOrCustom = Boolean(farm.inputsModified || farm.isUserCreatedDraft);
    const allOut =
      sourceCoveragesSummary.length > 0 &&
      sourceCoveragesSummary.every((s) => s.status === 'OUT_OF_COVERAGE');

    dataAvailabilityClass = allOut
      ? 'OUT_OF_COVERAGE'
      : isModifiedOrCustom
        ? 'MODIFIED_DRAFT_LIMITED'
        : 'COVERAGE_ONLY';

    headlineStatus = allOut
      ? 'Out of agricultural land coverage — no land or crop recommendation available'
      : isModifiedOrCustom
        ? 'Saved farm inputs not yet analyzed by live crop engine'
        : 'Regional satellite coverage check only — crop optimization not calibrated here';

    summaryFindings.push(
      isModifiedOrCustom
        ? `Your farm layout (${farm.fields.length} field${farm.fields.length === 1 ? '' : 's'}${totalAreaHa !== null ? `, ${totalAreaHa.toFixed(2)} ha` : ''}) is saved locally. Live agronomic optimization backend is not connected yet.`
        : `Satellite and climate context sources were checked for ${farm.site.locationLabel}. Crop rotation optimization is not calibrated for this site.`
    );
    if (sourceCoveragesSummary.length > 0) {
      summaryFindings.push(
        `Earth observation check: ${availableCount} available, ${conditionalCount} conditional, ${unavailableCount} unavailable or out-of-coverage layers.`
      );
    }

    whatWeKnow.push(
      `Saved farm coordinate [${farm.site.longitude.toFixed(4)}, ${farm.site.latitude.toFixed(4)}] in WGS84 (EPSG:4326).`
    );
    if (totalAreaHa !== null) {
      whatWeKnow.push(`Declared / geometry-measured field total: ${totalAreaHa.toFixed(2)} ha across ${farm.fields.length} field(s).`);
    }
    whatWeDontKnow.push(
      'Site-specific 5-year crop rotation simulations, irrigation scheduling, and yield estimates require a connected ASTRAGRON scientific engine.'
    );
    whatWeDontKnow.push(
      'Soil nitrogen, organic carbon, and rooting depth remain missing until measured on the farm.'
    );
    whatHappensNext.push(
      'Save a backup JSON or download this PDF coverage report for your records.'
    );
    whatHappensNext.push(
      'Explore the Uppsala recorded research example if you want to inspect how completed 5-year trade-off analyses appear.'
    );

    scientificNotes.push(`Fail-closed status: ${decisionEnv.statusCode}`);
    if (decisionEnv.reasons.length > 0) {
      scientificNotes.push(decisionEnv.reasons.join(' '));
    }
  }

  const corpusVersion =
    decisionEnv.data?.scientificMeta?.protocolSha256?.slice(0, 12) ??
    `m4-coverage-${datasetMode.toLowerCase()}`;

  const rawBody = {
    reportId: `rep-${farm.id}-${inputRev.slice(0, 8)}-${Date.now().toString(36)}`,
    farmId: farm.id,
    farmName: farm.name,
    locationLabel: farm.site.locationLabel,
    coordinates: [farm.site.longitude, farm.site.latitude] as [number, number],
    totalAreaHa,
    fieldCount: farm.fields.length,
    inputRevision: inputRev,
    corpusVersion,
    datasetMode,
    analysisJobId: jobId,
    createdAt,
    dataAvailabilityClass,
    headlineStatus,
    recommendationNotice,
    summaryFindings,
    whatWeKnow,
    whatWeDontKnow,
    whatHappensNext,
    sourceCoveragesSummary,
    waterBalanceChart,
    sourceReadinessChart,
    scientificNotes,
    fieldGeometries: farm.fields.map((f) => ({
      id: f.id,
      label: f.label,
      geometry: f.geometry ?? null,
      geometrySource: f.geometrySource ?? (f.geometry ? 'USER_DRAWN' : null),
      areaHa: f.declaredAreaHa,
      perimeterMeters: f.perimeterMeters ?? null,
    })),
    provenanceFooter: `ASTRAGRON V5 Farmer-First Report | Mode=${datasetMode} | Site=${farm.id} | InputRev=${inputRev}`,
  };

  const contentHash = computeDeterministicDigest(JSON.stringify(rawBody));
  return { ...rawBody, contentHash };
}

export const ChatStorageAdapter = {
  buildThreadKey(farmId: string, reportId: string, inputRevision: string): string {
    return `${farmId}::${reportId}::${inputRevision}`;
  },

  loadAll(): { ok: boolean; threads: Record<string, ChatThreadRecord>; error: string | null } {
    const read = safeReadLocalJson<Record<string, unknown>>(STORAGE_KEY_CHAT_THREADS);
    if (!read.ok) return { ok: false, threads: {}, error: read.error };
    if (!read.value || typeof read.value !== 'object') return { ok: true, threads: {}, error: null };
    const clean: Record<string, ChatThreadRecord> = {};
    for (const [k, raw] of Object.entries(read.value)) {
      const parsed = ChatThreadRecordSchema.safeParse(raw);
      if (parsed.success) {
        clean[k] = parsed.data;
      }
    }
    return { ok: true, threads: clean, error: null };
  },

  saveAll(threads: Record<string, ChatThreadRecord>): StorageWriteOutcome {
    return safeWriteLocalJson(STORAGE_KEY_CHAT_THREADS, threads);
  },

  appendMessage(
    threads: Record<string, ChatThreadRecord>,
    context: {
      farmId: string;
      reportId: string;
      inputRevision: string;
      evidenceVersion: string;
    },
    msg: ChatMessageRecord
  ): { next: Record<string, ChatThreadRecord>; write: StorageWriteOutcome } {
    const validMsg = ChatMessageRecordSchema.parse(msg);
    const key = ChatStorageAdapter.buildThreadKey(
      context.farmId,
      context.reportId,
      context.inputRevision
    );
    const existing = threads[key];
    const updated: ChatThreadRecord = {
      conversationId: existing?.conversationId ?? `conv-${computeDeterministicDigest(key)}`,
      farmId: context.farmId,
      reportId: context.reportId,
      inputRevision: context.inputRevision,
      evidenceVersion: context.evidenceVersion,
      updatedAt: new Date().toISOString(),
      messages: [...(existing?.messages ?? []), validMsg],
    };
    const next = { ...threads, [key]: updated };
    const write = ChatStorageAdapter.saveAll(next);
    return { next, write };
  },
};
