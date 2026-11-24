'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  DatasetOperatingMode,
  EvidenceRecord,
  EvidenceScope,
  ResearchPreference,
  ResearchViewEnvelope,
  UserFarmDraft,
} from '@/domain/contracts';
import {
  computeDraftInputRevision,
  detectDraftModificationReasons,
} from '@/domain/schemas';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  EXPLORER_PRESET_SITES,
  UPPSALA_REFERENCE_INPUT_REVISION,
} from '@/fixtures/sites-and-coverage';
import {
  getRepositoryForMode,
  type AstragronDataRepository,
} from '@/adapters/repositories';
import { IS_STATIC_SHOWCASE } from '@/lib/base-path';
import type {
  ChatMessageRecord,
  ChatThreadRecord,
  FarmBackupBundle,
  ReportEnvelope,
} from '@/domain/farmer-ux-contracts';
import {
  buildDuplicatedFarmDraft,
  ChatStorageAdapter,
  exportFarmBackupBundle,
  isBuiltInResearchSite,
  parseAndValidateBackupBundle,
  ReportStorageAdapter,
  safeReadLocalJson,
  safeWriteLocalJson,
  STORAGE_KEY_ARCHIVED_FARMS,
  STORAGE_KEY_CHAT_THREADS,
  STORAGE_KEY_REPORTS,
} from '@/adapters/storage-adapters';

export type ComplexityMode = 'SIMPLE' | 'SCIENTIFIC';
export type UnitDisplayMode = 'SI_METRIC' | 'SI_WITH_ACRE_GALLON_EQUIV';

interface AstragronContextValue {
  complexityMode: ComplexityMode;
  setComplexityMode: (mode: ComplexityMode) => void;
  unitMode: UnitDisplayMode;
  setUnitMode: (mode: UnitDisplayMode) => void;
  datasetMode: DatasetOperatingMode;
  setDatasetMode: (mode: DatasetOperatingMode) => void;
  prefsHydrated: boolean;
  repository: AstragronDataRepository;
  reducedMotion: boolean;
  setReducedMotion: (val: boolean) => void;
  activePreference: ResearchPreference;
  setActivePreference: (pref: ResearchPreference) => void;
  activeSiteId: string;
  setActiveSiteId: (siteId: string) => void;
  farmDrafts: Record<string, UserFarmDraft>;
  saveFarmDraft: (draft: UserFarmDraft) => UserFarmDraft;
  getFarmDraft: (id: string) => UserFarmDraft | null;
  renameFarmDraft: (farmId: string, nextName: string) => UserFarmDraft | null;
  duplicateFarmDraft: (farmId: string, customName?: string) => UserFarmDraft | null;
  deleteFarmDraft: (farmId: string) => boolean;
  archivedFarmIds: string[];
  archiveFarmDraft: (farmId: string, archived: boolean) => void;
  exportAllFarmsBackup: () => FarmBackupBundle;
  importFarmsBackup: (rawJson: string) => { ok: boolean; importedCount: number; error: string | null };
  storageError: string | null;
  clearStorageError: () => void;
  storageLastSavedAt: string | null;
  persistenceMode: 'LOCAL_DEVICE_ONLY';
  reports: ReportEnvelope[];
  recordReportSnapshot: (report: ReportEnvelope) => void;
  getReportsForFarm: (farmId: string) => ReportEnvelope[];
  ensureFarmSyncedFromServer: (farmId: string) => void;
  isReportStale: (report: ReportEnvelope) => boolean;
  chatThreads: Record<string, ChatThreadRecord>;
  appendChatMessage: (
    context: {
      farmId: string;
      reportId: string;
      inputRevision: string;
      evidenceVersion: string;
    },
    message: ChatMessageRecord
  ) => void;
  clearChatThread: (farmId: string, reportId: string, inputRevision: string) => void;
  resetDemoStorage: () => void;
  activeEvidenceDrawerId: string | null;
  activeEvidenceScope: EvidenceScope | null;
  openEvidenceDrawer: (evidenceId: string, scope?: EvidenceScope) => void;
  closeEvidenceDrawer: () => void;
  activeEvidenceEnvelope: ResearchViewEnvelope<EvidenceRecord> | null;
  activeEvidenceRecord: EvidenceRecord | null;
}

const STORAGE_KEY_DRAFTS = 'astragron_demo_farm_drafts_v2';
const STORAGE_KEY_PREFS = 'astragron_ui_prefs_v2';

// Build-time public default; persisted user preference can override it.
// Selecting a non-demo mode must NEVER make a missing backend appear connected.
const configuredMode = process.env.NEXT_PUBLIC_ASTRAGRON_ADAPTER_MODE;
const INITIAL_DATASET_MODE: DatasetOperatingMode =
  configuredMode === 'RECORDED_M14_RESEARCH' || configuredMode === 'REAL_SCIENTIFIC_BACKEND'
    ? configuredMode
    : 'SYNTHETIC_UI_DEMO';

let forkSequence = 0;

function normalizeDraftForPersistence(draft: UserFarmDraft): UserFarmDraft {
  const nowIso = new Date().toISOString();
  const rev = computeDraftInputRevision(draft);
  const isUppsalaTarget = draft.id === 'uppsala-demo' || draft.id === 'uppsala-m14';
  const isDerivedFromUppsala =
    draft.derivedFromFixtureId === 'uppsala-demo' || draft.fixturePresetId === 'uppsala-demo';
  const matchesReferenceUppsala = rev === UPPSALA_REFERENCE_INPUT_REVISION;

  if (isUppsalaTarget && (!matchesReferenceUppsala || draft.inputsModified === true)) {
    forkSequence += 1;
    const customId = `custom-uppsala-${rev.slice(0, 8)}-${Date.now().toString(36)}-${forkSequence}`;
    const reasons = detectDraftModificationReasons(draft, DEFAULT_UPPSALA_FARM_DRAFT);
    return {
      ...draft,
      id: customId,
      derivedFromFixtureId: 'uppsala-demo',
      isUserCreatedDraft: true,
      inputsModified: true,
      inputRevision: rev,
      modificationReasons:
        reasons.length > 0 ? reasons : ['Edited draft forked from immutable uppsala-demo fixture.'],
      updatedAt: nowIso,
    };
  }

  if (isUppsalaTarget && matchesReferenceUppsala) {
    return {
      ...DEFAULT_UPPSALA_FARM_DRAFT,
      updatedAt: draft.updatedAt || DEFAULT_UPPSALA_FARM_DRAFT.updatedAt,
    };
  }

  const reasons = isDerivedFromUppsala
    ? detectDraftModificationReasons(draft, DEFAULT_UPPSALA_FARM_DRAFT)
    : draft.modificationReasons;
  const inputsModified = isDerivedFromUppsala
    ? !matchesReferenceUppsala || Boolean(draft.inputsModified)
    : Boolean(draft.inputsModified || draft.isUserCreatedDraft);

  return {
    ...draft,
    inputRevision: rev,
    inputsModified,
    modificationReasons: reasons,
    updatedAt: nowIso,
  };
}

function sanitizeStoredDrafts(
  parsed: Record<string, UserFarmDraft>
): Record<string, UserFarmDraft> {
  const sanitized: Record<string, UserFarmDraft> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue;
    if (key === 'uppsala-demo' || entry.id === 'uppsala-demo' || entry.id === 'uppsala-m14') {
      const normalized = normalizeDraftForPersistence({ ...entry, id: 'uppsala-demo' });
      if (normalized.id !== 'uppsala-demo') {
        sanitized[normalized.id] = normalized;
      }
      continue;
    }
    sanitized[key] = normalizeDraftForPersistence(entry);
  }
  sanitized['uppsala-demo'] = DEFAULT_UPPSALA_FARM_DRAFT;
  return sanitized;
}

function syncFarmDraftToServer(draft: UserFarmDraft): void {
  if (IS_STATIC_SHOWCASE || typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (isBuiltInResearchSite(draft.id)) return;
  void fetch('/api/farms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ farm: draft }),
  })
    .then((res) => res.text().catch(() => undefined))
    .catch(() => undefined);
}

function deleteFarmOnServer(farmId: string): void {
  if (IS_STATIC_SHOWCASE || typeof window === 'undefined' || typeof fetch !== 'function') return;
  if (isBuiltInResearchSite(farmId)) return;
  void fetch(`/api/farms?farmId=${encodeURIComponent(farmId)}`, {
    method: 'DELETE',
  })
    .then((res) => res.text().catch(() => undefined))
    .catch(() => undefined);
}

function syncReportToServer(report: ReportEnvelope): void {
  if (IS_STATIC_SHOWCASE || typeof window === 'undefined' || typeof fetch !== 'function') return;
  void fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report }),
  })
    .then((res) => res.text().catch(() => undefined))
    .catch(() => undefined);
}

const AstragronContext = createContext<AstragronContextValue | null>(null);

export function createPresetDraftForSite(siteId: string): UserFarmDraft | null {
  if (siteId === 'uppsala-demo' || siteId === 'uppsala-m14') {
    return DEFAULT_UPPSALA_FARM_DRAFT;
  }
  const preset = EXPLORER_PRESET_SITES[siteId];
  if (!preset) {
    return null;
  }
  return {
    id: siteId,
    name: `${preset.name} — Coverage Inspection Draft`,
    createdAt: '2026-11-11T08:00:00Z',
    updatedAt: '2026-11-11T08:00:00Z',
    fixturePresetId: preset.id,
    site: {
      longitude: preset.coordinates[0],
      latitude: preset.coordinates[1],
      crs: 'EPSG:4326',
      locationLabel: preset.siteContext.location_label,
      countryCode: preset.countryCode,
      regionName: preset.regionName,
      spatialPrecisionNote: `WGS84 (EPSG:4326) coordinate [${preset.coordinates[0]}, ${preset.coordinates[1]}]. Source coverage UX fixture only; Swedish crop parameters are not applied.`,
    },
    waterContext: {
      sharedDailyDeliveryM3: {
        value: null,
        unit: 'm³/day',
        evidenceClass: 'MISSING_OR_UNQUALIFIED',
        missingReason: 'No local hydraulic delivery verification for this reference site.',
      },
      seasonalQuotaM3: {
        value: null,
        unit: 'm³/season',
        evidenceClass: 'MISSING_OR_UNQUALIFIED',
        missingReason: 'Legal water quota unverified.',
      },
      serviceThresholdMm: {
        value: 100.0,
        unit: 'mm / field / harvest-year',
        evidenceClass: 'RESEARCH_ASSUMPTION',
      },
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
        soilTexture: {
          value: null,
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
          missingReason: 'Local soil horizon sampling required.',
        },
        soilDepthMm: {
          value: null,
          unit: 'mm',
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
        },
        organicCarbonPct: {
          value: null,
          unit: '%',
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
        },
        soilPh: {
          value: null,
          unit: 'pH',
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
        },
        mineralNo3KgHa: {
          value: null,
          unit: 'kg N/ha (elemental N)',
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
        },
        nitrogenBasis: 'ELEMENTAL_N_KG_HA',
        initialRootZoneMm: {
          value: null,
          unit: 'mm',
          evidenceClass: 'MISSING_OR_UNQUALIFIED',
        },
        previousCrops: [],
        candidateCrops: [],
        notes: 'Source coverage inspection parcel. Agronomic crop suitability is not qualified for this site.',
      },
    ],
    selectedPurpose: 'DESCRIPTIVE_CONTEXT',
    selectedPreference: 'MINIMIZE_WORST_ET_SHORTFALL',
    assumptionAcknowledged: true,
  };
}

export function AstragronProvider({ children }: { children: React.ReactNode }) {
  const [complexityMode, setComplexityMode] = useState<ComplexityMode>('SIMPLE');
  const [unitMode, setUnitMode] = useState<UnitDisplayMode>('SI_METRIC');
  const [datasetMode, setDatasetMode] = useState<DatasetOperatingMode>(INITIAL_DATASET_MODE);
  const [prefsHydrated, setPrefsHydrated] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [activePreference, setActivePreference] = useState<ResearchPreference>('MINIMIZE_WORST_ET_SHORTFALL');
  const [activeSiteId, setActiveSiteId] = useState<string>('uppsala-demo');
  const [farmDrafts, setFarmDrafts] = useState<Record<string, UserFarmDraft>>(() => {
    const nyeri = createPresetDraftForSite('nyeri-kenya');
    const wagga = createPresetDraftForSite('wagga-australia');
    return {
      'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT,
      ...(nyeri ? { 'nyeri-kenya': nyeri } : {}),
      ...(wagga ? { 'wagga-australia': wagga } : {}),
    };
  });
  const [activeEvidenceDrawerId, setActiveEvidenceDrawerId] = useState<string | null>(null);
  const [activeEvidenceScope, setActiveEvidenceScope] = useState<EvidenceScope | null>(null);
  const drawerRestoreFocusRef = useRef<HTMLElement | null>(null);

  const [archivedFarmIds, setArchivedFarmIds] = useState<string[]>([]);
  const [reports, setReports] = useState<ReportEnvelope[]>([]);
  const [chatThreads, setChatThreads] = useState<Record<string, ChatThreadRecord>>({});
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageLastSavedAt, setStorageLastSavedAt] = useState<string | null>(null);

  const farmDraftsRef = useRef(farmDrafts);
  const archivedRef = useRef(archivedFarmIds);
  const reportsRef = useRef(reports);
  const chatThreadsRef = useRef(chatThreads);
  const syncedFarmsRef = useRef<Set<string>>(new Set());
  const prefsRef = useRef({
    complexityMode,
    unitMode,
    datasetMode,
    reducedMotion,
  });

  useEffect(() => {
    farmDraftsRef.current = farmDrafts;
    archivedRef.current = archivedFarmIds;
    reportsRef.current = reports;
    chatThreadsRef.current = chatThreads;
  }, [farmDrafts, archivedFarmIds, reports, chatThreads]);

  useEffect(() => {
    prefsRef.current = {
      complexityMode,
      unitMode,
      datasetMode,
      reducedMotion,
    };
  }, [complexityMode, unitMode, datasetMode, reducedMotion]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mediaQuery.matches) {
          setReducedMotion(true);
        }
        const storedDrafts = window.localStorage.getItem(STORAGE_KEY_DRAFTS);
        if (storedDrafts) {
          const parsed = JSON.parse(storedDrafts) as Record<string, UserFarmDraft>;
          const sanitized = sanitizeStoredDrafts(parsed);
          setFarmDrafts((prev) => ({
            ...prev,
            ...sanitized,
            'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT,
          }));
        }
        const storedPrefs = window.localStorage.getItem(STORAGE_KEY_PREFS);
        if (storedPrefs) {
          const p = JSON.parse(storedPrefs);
          if (p.complexityMode === 'SIMPLE' || p.complexityMode === 'SCIENTIFIC') {
            prefsRef.current.complexityMode = p.complexityMode;
            setComplexityMode(p.complexityMode);
          }
          if (p.unitMode === 'SI_METRIC' || p.unitMode === 'SI_WITH_ACRE_GALLON_EQUIV') {
            prefsRef.current.unitMode = p.unitMode;
            setUnitMode(p.unitMode);
          }
          if (
            p.datasetMode === 'SYNTHETIC_UI_DEMO' ||
            p.datasetMode === 'RECORDED_M14_RESEARCH' ||
            p.datasetMode === 'REAL_SCIENTIFIC_BACKEND'
          ) {
            prefsRef.current.datasetMode = p.datasetMode;
            setDatasetMode(p.datasetMode);
          }
          if (typeof p.reducedMotion === 'boolean') {
            prefsRef.current.reducedMotion = p.reducedMotion;
            setReducedMotion(p.reducedMotion);
          }
        }
        const archRead = safeReadLocalJson<string[]>(STORAGE_KEY_ARCHIVED_FARMS);
        if (!archRead.ok && archRead.error) setStorageError(archRead.error);
        if (Array.isArray(archRead.value)) {
          setArchivedFarmIds(archRead.value.filter((x) => typeof x === 'string' && !isBuiltInResearchSite(x)));
        }
        const repRead = ReportStorageAdapter.loadAll();
        if (!repRead.ok && repRead.error) setStorageError(repRead.error);
        setReports(repRead.reports);
        const chatRead = ChatStorageAdapter.loadAll();
        if (!chatRead.ok && chatRead.error) setStorageError(chatRead.error);
        setChatThreads(chatRead.threads);
      }
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? `Local device storage could not be read cleanly: ${err.message}`
          : 'Local device storage could not be accessed.'
      );
    } finally {
      setPrefsHydrated(true);
    }
  }, []);

  const persistPrefs = useCallback(
    (next: {
      complexityMode?: ComplexityMode;
      unitMode?: UnitDisplayMode;
      datasetMode?: DatasetOperatingMode;
      reducedMotion?: boolean;
    }) => {
      try {
        if (typeof window !== 'undefined') {
          let existing: Record<string, unknown> = {};
          try {
            const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
            if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            // Ignore malformed existing prefs
          }
          const current = {
            complexityMode:
              next.complexityMode ??
              (existing.complexityMode as ComplexityMode | undefined) ??
              prefsRef.current.complexityMode,
            unitMode:
              next.unitMode ??
              (existing.unitMode as UnitDisplayMode | undefined) ??
              prefsRef.current.unitMode,
            datasetMode:
              next.datasetMode ??
              (existing.datasetMode as DatasetOperatingMode | undefined) ??
              prefsRef.current.datasetMode,
            reducedMotion:
              next.reducedMotion ??
              (typeof existing.reducedMotion === 'boolean'
                ? existing.reducedMotion
                : prefsRef.current.reducedMotion),
          };
          prefsRef.current = current;
          window.localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(current));
        }
      } catch {
        // Ignore storage error
      }
    },
    []
  );

  const handleSetComplexityMode = useCallback(
    (mode: ComplexityMode) => {
      setComplexityMode(mode);
      persistPrefs({ complexityMode: mode });
    },
    [persistPrefs]
  );

  const handleSetUnitMode = useCallback(
    (mode: UnitDisplayMode) => {
      setUnitMode(mode);
      persistPrefs({ unitMode: mode });
    },
    [persistPrefs]
  );

  const handleSetDatasetMode = useCallback(
    (mode: DatasetOperatingMode) => {
      setDatasetMode(mode);
      setActiveEvidenceDrawerId(null);
      setActiveEvidenceScope(null);
      persistPrefs({ datasetMode: mode });
    },
    [persistPrefs]
  );

  const handleSetActiveSiteId = useCallback((siteId: string) => {
    setActiveSiteId(siteId);
    setActiveEvidenceDrawerId(null);
    setActiveEvidenceScope(null);
  }, []);

  useEffect(() => {
    setActiveEvidenceDrawerId(null);
    setActiveEvidenceScope(null);
  }, [activeSiteId, datasetMode]);

  const handleSetReducedMotion = useCallback(
    (val: boolean) => {
      setReducedMotion(val);
      persistPrefs({ reducedMotion: val });
    },
    [persistPrefs]
  );

  const persistDraftsMap = useCallback((next: Record<string, UserFarmDraft>) => {
    const safeMap: Record<string, UserFarmDraft> = {
      ...next,
      'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT,
    };
    farmDraftsRef.current = safeMap;
    setFarmDrafts(safeMap);
    const write = safeWriteLocalJson(STORAGE_KEY_DRAFTS, safeMap);
    if (!write.ok) {
      setStorageError(write.error);
    } else {
      setStorageError(null);
      setStorageLastSavedAt(new Date().toISOString());
    }
  }, []);

  const saveFarmDraft = useCallback(
    (draft: UserFarmDraft): UserFarmDraft => {
      const persisted = normalizeDraftForPersistence(draft);
      persistDraftsMap({
        ...farmDraftsRef.current,
        [persisted.id]: persisted,
      });
      syncFarmDraftToServer(persisted);
      return persisted;
    },
    [persistDraftsMap]
  );

  const getFarmDraft = useCallback(
    (id: string): UserFarmDraft | null => {
      if (farmDrafts[id]) {
        return farmDrafts[id]!;
      }
      if (id === 'uppsala-demo' || id === 'uppsala-m14') {
        return DEFAULT_UPPSALA_FARM_DRAFT;
      }
      if (EXPLORER_PRESET_SITES[id]) {
        return createPresetDraftForSite(id);
      }
      // Fail-closed: NEVER return DEFAULT_UPPSALA_FARM_DRAFT for an unknown ID
      return null;
    },
    [farmDrafts]
  );

  const renameFarmDraft = useCallback(
    (farmId: string, nextName: string): UserFarmDraft | null => {
      const trimmed = nextName.trim();
      if (!trimmed || isBuiltInResearchSite(farmId)) return null;
      const existing = farmDraftsRef.current[farmId];
      if (!existing) return null;
      const updated = normalizeDraftForPersistence({
        ...existing,
        name: trimmed,
        updatedAt: new Date().toISOString(),
      });
      persistDraftsMap({
        ...farmDraftsRef.current,
        [updated.id]: updated,
      });
      syncFarmDraftToServer(updated);
      return updated;
    },
    [persistDraftsMap]
  );

  const duplicateFarmDraft = useCallback(
    (farmId: string, customName?: string): UserFarmDraft | null => {
      const source = getFarmDraft(farmId);
      if (!source) return null;
      const duplicated = buildDuplicatedFarmDraft(
        source,
        Object.keys(farmDraftsRef.current),
        customName
      );
      persistDraftsMap({
        ...farmDraftsRef.current,
        [duplicated.id]: duplicated,
      });
      syncFarmDraftToServer(duplicated);
      return duplicated;
    },
    [getFarmDraft, persistDraftsMap]
  );

  const archiveFarmDraft = useCallback((farmId: string, archived: boolean) => {
    if (isBuiltInResearchSite(farmId)) return;
    const prev = archivedRef.current;
    const next = archived
      ? Array.from(new Set([...prev, farmId]))
      : prev.filter((id) => id !== farmId);
    archivedRef.current = next;
    setArchivedFarmIds(next);
    const write = safeWriteLocalJson(STORAGE_KEY_ARCHIVED_FARMS, next);
    if (!write.ok) setStorageError(write.error);
  }, []);

  const deleteFarmDraft = useCallback(
    (farmId: string): boolean => {
      if (isBuiltInResearchSite(farmId)) return false;
      const nextDrafts = { ...farmDraftsRef.current };
      if (!nextDrafts[farmId]) return false;
      delete nextDrafts[farmId];
      persistDraftsMap(nextDrafts);
      archiveFarmDraft(farmId, false);
      const nextReports = reportsRef.current.filter((r) => r.farmId !== farmId);
      reportsRef.current = nextReports;
      setReports(nextReports);
      const repWrite = ReportStorageAdapter.saveAll(nextReports);
      if (!repWrite.ok) setStorageError(repWrite.error);
      deleteFarmOnServer(farmId);
      return true;
    },
    [archiveFarmDraft, persistDraftsMap]
  );

  const recordReportSnapshot = useCallback((report: ReportEnvelope) => {
    const next = [report, ...reportsRef.current.filter((r) => r.reportId !== report.reportId)];
    reportsRef.current = next;
    setReports(next);
    const write = ReportStorageAdapter.saveAll(next);
    if (!write.ok) {
      setStorageError(write.error);
    } else {
      setStorageLastSavedAt(new Date().toISOString());
    }
    syncReportToServer(report);
  }, []);

  const ensureFarmSyncedFromServer = useCallback(
    (farmId: string) => {
      if (IS_STATIC_SHOWCASE || typeof window === 'undefined' || typeof fetch !== 'function') return;
      if (!farmId || isBuiltInResearchSite(farmId)) return;
      if (syncedFarmsRef.current.has(farmId)) return;
      syncedFarmsRef.current.add(farmId);

      if (!farmDraftsRef.current[farmId]) {
        void fetch(`/api/farms?farmId=${encodeURIComponent(farmId)}`)
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as {
              ok?: boolean;
              farm?: UserFarmDraft;
            } | null;
            return res.ok ? data : null;
          })
          .then((data: { ok?: boolean; farm?: UserFarmDraft } | null) => {
            if (!data?.ok || !data.farm || data.farm.id !== farmId) return;
            if (farmDraftsRef.current[farmId]) return;
            const restored = normalizeDraftForPersistence(data.farm);
            persistDraftsMap({
              ...farmDraftsRef.current,
              [restored.id]: restored,
            });
          })
          .catch(() => undefined);
      }

      void fetch(`/api/reports?farmId=${encodeURIComponent(farmId)}`)
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as {
            ok?: boolean;
            reports?: ReportEnvelope[];
          } | null;
          return res.ok ? data : null;
        })
        .then((data: { ok?: boolean; reports?: ReportEnvelope[] } | null) => {
          if (!data?.ok || !Array.isArray(data.reports) || data.reports.length === 0) return;
          const existingIds = new Set(reportsRef.current.map((r) => r.reportId));
          const missing = data.reports.filter((r) => r && typeof r.reportId === 'string' && !existingIds.has(r.reportId));
          if (missing.length === 0) return;
          const next = [...missing, ...reportsRef.current];
          reportsRef.current = next;
          setReports(next);
          ReportStorageAdapter.saveAll(next);
        })
        .catch(() => undefined);
    },
    [persistDraftsMap]
  );

  const getReportsForFarm = useCallback(
    (farmId: string) => reports.filter((r) => r.farmId === farmId),
    [reports]
  );

  const isReportStale = useCallback(
    (report: ReportEnvelope) => {
      const draft = getFarmDraft(report.farmId);
      return ReportStorageAdapter.isReportStale(report, draft);
    },
    [getFarmDraft]
  );

  const appendChatMessage = useCallback(
    (
      context: {
        farmId: string;
        reportId: string;
        inputRevision: string;
        evidenceVersion: string;
      },
      message: ChatMessageRecord
    ) => {
      const res = ChatStorageAdapter.appendMessage(chatThreadsRef.current, context, message);
      chatThreadsRef.current = res.next;
      setChatThreads(res.next);
      if (!res.write.ok) setStorageError(res.write.error);
    },
    []
  );

  const clearChatThread = useCallback(
    (farmId: string, reportId: string, inputRevision: string) => {
      const key = ChatStorageAdapter.buildThreadKey(farmId, reportId, inputRevision);
      const next = { ...chatThreadsRef.current };
      delete next[key];
      chatThreadsRef.current = next;
      setChatThreads(next);
      const write = ChatStorageAdapter.saveAll(next);
      if (!write.ok) setStorageError(write.error);
    },
    []
  );

  const exportAllFarmsBackup = useCallback((): FarmBackupBundle => {
    return exportFarmBackupBundle({
      farms: farmDraftsRef.current,
      archivedFarmIds: archivedRef.current,
      reports: reportsRef.current,
    });
  }, []);

  const importFarmsBackup = useCallback(
    (rawJson: string): { ok: boolean; importedCount: number; error: string | null } => {
      const res = parseAndValidateBackupBundle(rawJson);
      if (!res.ok) {
        return { ok: false, importedCount: 0, error: res.error };
      }
      const nextDrafts: Record<string, UserFarmDraft> = {
        ...farmDraftsRef.current,
      };
      let importedCount = 0;
      for (const [id, draft] of Object.entries(res.bundle.farms)) {
        if (!isBuiltInResearchSite(id)) {
          nextDrafts[id] = normalizeDraftForPersistence(draft);
          importedCount += 1;
        }
      }
      persistDraftsMap(nextDrafts);
      const mergedArch = Array.from(
        new Set([...archivedRef.current, ...res.bundle.archivedFarmIds.filter((id) => !isBuiltInResearchSite(id))])
      );
      archivedRef.current = mergedArch;
      setArchivedFarmIds(mergedArch);
      const archWrite = safeWriteLocalJson(STORAGE_KEY_ARCHIVED_FARMS, mergedArch);
      if (!archWrite.ok) setStorageError(archWrite.error);

      const seenReports = new Map<string, ReportEnvelope>();
      for (const rep of [...res.bundle.reports, ...reportsRef.current]) {
        if (!seenReports.has(rep.reportId)) seenReports.set(rep.reportId, rep);
      }
      const mergedReports = Array.from(seenReports.values()).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      reportsRef.current = mergedReports;
      setReports(mergedReports);
      const repWrite = ReportStorageAdapter.saveAll(mergedReports);
      if (!repWrite.ok) setStorageError(repWrite.error);

      return { ok: true, importedCount, error: null };
    },
    [persistDraftsMap]
  );

  const repository = useMemo(() => {
    return getRepositoryForMode(datasetMode, Object.keys(farmDrafts));
  }, [datasetMode, farmDrafts]);

  const resetDemoStorage = useCallback(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY_DRAFTS);
        window.localStorage.removeItem(STORAGE_KEY_PREFS);
        window.localStorage.removeItem(STORAGE_KEY_ARCHIVED_FARMS);
        window.localStorage.removeItem(STORAGE_KEY_CHAT_THREADS);
        window.localStorage.removeItem(STORAGE_KEY_REPORTS);
      }
    } catch {
      // Ignore
    }
    const nyeri = createPresetDraftForSite('nyeri-kenya');
    const wagga = createPresetDraftForSite('wagga-australia');
    const baseDrafts = {
      'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT,
      ...(nyeri ? { 'nyeri-kenya': nyeri } : {}),
      ...(wagga ? { 'wagga-australia': wagga } : {}),
    };
    farmDraftsRef.current = baseDrafts;
    setFarmDrafts(baseDrafts);
    setArchivedFarmIds([]);
    archivedRef.current = [];
    setReports([]);
    reportsRef.current = [];
    setChatThreads({});
    chatThreadsRef.current = {};
    setStorageError(null);
    setStorageLastSavedAt(null);
    setComplexityMode('SIMPLE');
    setUnitMode('SI_METRIC');
    setDatasetMode(INITIAL_DATASET_MODE);
    setActivePreference('MINIMIZE_WORST_ET_SHORTFALL');
    setActiveSiteId('uppsala-demo');
  }, []);

  const openEvidenceDrawer = useCallback(
    (evidenceId: string, scope?: EvidenceScope) => {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        drawerRestoreFocusRef.current = document.activeElement;
      }
      setActiveEvidenceScope(scope ?? { siteId: activeSiteId, datasetMode });
      setActiveEvidenceDrawerId(evidenceId);
    },
    [activeSiteId, datasetMode]
  );

  const closeEvidenceDrawer = useCallback(() => {
    setActiveEvidenceDrawerId(null);
    setActiveEvidenceScope(null);
    const el = drawerRestoreFocusRef.current;
    drawerRestoreFocusRef.current = null;
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus());
    }
  }, []);

  const effectiveScope: EvidenceScope = useMemo(
    () => activeEvidenceScope ?? { siteId: activeSiteId, datasetMode },
    [activeEvidenceScope, activeSiteId, datasetMode]
  );

  const activeEvidenceEnvelope = useMemo(() => {
    if (!activeEvidenceDrawerId) return null;
    const scopedDraft = getFarmDraft(effectiveScope.siteId);
    return repository.getEvidenceRecord(effectiveScope, activeEvidenceDrawerId, scopedDraft);
  }, [activeEvidenceDrawerId, effectiveScope, getFarmDraft, repository]);

  const activeEvidenceRecord = activeEvidenceEnvelope?.data ?? null;

  return (
    <AstragronContext.Provider
      value={{
        complexityMode,
        setComplexityMode: handleSetComplexityMode,
        unitMode,
        setUnitMode: handleSetUnitMode,
        datasetMode,
        setDatasetMode: handleSetDatasetMode,
        prefsHydrated,
        repository,
        reducedMotion,
        setReducedMotion: handleSetReducedMotion,
        activePreference,
        setActivePreference,
        activeSiteId,
        setActiveSiteId: handleSetActiveSiteId,
        farmDrafts,
        saveFarmDraft,
        getFarmDraft,
        renameFarmDraft,
        duplicateFarmDraft,
        deleteFarmDraft,
        archivedFarmIds,
        archiveFarmDraft,
        exportAllFarmsBackup,
        importFarmsBackup,
        storageError,
        clearStorageError: () => setStorageError(null),
        storageLastSavedAt,
        persistenceMode: 'LOCAL_DEVICE_ONLY',
        reports,
        recordReportSnapshot,
        getReportsForFarm,
        ensureFarmSyncedFromServer,
        isReportStale,
        chatThreads,
        appendChatMessage,
        clearChatThread,
        resetDemoStorage,
        activeEvidenceDrawerId,
        activeEvidenceScope,
        openEvidenceDrawer,
        closeEvidenceDrawer,
        activeEvidenceEnvelope,
        activeEvidenceRecord,
      }}
    >
      {children}
    </AstragronContext.Provider>
  );
}

export function useAstragron() {
  const ctx = useContext(AstragronContext);
  if (!ctx) {
    throw new Error('useAstragron must be used within an AstragronProvider');
  }
  return ctx;
}

export function formatAreaWithUnit(
  areaHa: number | null | undefined,
  unitMode: UnitDisplayMode
): string {
  if (areaHa === null || areaHa === undefined || Number.isNaN(areaHa)) {
    return 'Missing / Unspecified';
  }
  if (unitMode === 'SI_WITH_ACRE_GALLON_EQUIV') {
    const acres = areaHa * 2.47105;
    return `${areaHa.toFixed(1)} ha (${acres.toFixed(1)} ac)`;
  }
  return `${areaHa.toFixed(1)} ha`;
}

export function formatVolumeWithUnit(
  m3: number | null | undefined,
  unitMode: UnitDisplayMode,
  fractionDigits = 2
): string {
  if (m3 === null || m3 === undefined || Number.isNaN(m3)) {
    return 'Null / Excluded';
  }
  const formattedM3 = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(m3);

  if (unitMode === 'SI_WITH_ACRE_GALLON_EQUIV') {
    const acFt = m3 / 1233.48;
    return `${formattedM3} m³ eq (${acFt.toFixed(1)} ac-ft)`;
  }
  return `${formattedM3} m³ eq`;
}
