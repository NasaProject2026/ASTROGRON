'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MapPin,
  Layers,
  CheckCircle2,
  Plus,
  Trash2,
  RotateCcw,
  Save,
  Download,
  ArrowRight,
  ArrowLeft,
  Navigation,
  Upload,
  AlertTriangle,
} from 'lucide-react';
import { CoverageStatusBadge, EvidenceClassBadge } from '@/components/design-system/primitives';
import { FarmPolygonPreview } from '@/components/farms/farm-polygon-preview';
import { PlaceSearchBox, type SelectedPlaceCandidate } from '@/components/maps/place-search-box';
import { SmartFieldEditor } from '@/components/forms/smart-field-editor';
import type { CapabilityToastNotice } from '@/components/maps/maplibre-globe-canvas';
import { useAstragron, formatAreaWithUnit } from '@/hooks/use-astragron-store';
import { useMessages } from '@/lib/i18n';
import type {
  EvidencePurpose,
  FieldGeometrySource,
  NitrogenChemicalBasis,
  ResearchPreference,
  UserFarmDraft,
  UserFieldDraft,
} from '@/domain/contracts';
import type { SiteCapabilityCheckResult } from '@/domain/capability-overlay';
import {
  validateFarmSetupDraft,
  estimatePolygonAreaHectares,
  computeDraftInputRevision,
} from '@/domain/schemas';
import { computeGeodesicMetrics, importFieldBoundaryText } from '@/lib/geometry-validation';
import { slugifyCustomFarmId, computeFarmAreaHa } from '@/adapters/storage-adapters';
import {
  resolveExplorerPreset,
  EXPLORER_PRESET_SITES,
} from '@/fixtures/sites-and-coverage';

const WIZARD_STEPS = [
  { step: 1, title: '1. Where is your farm?', Icon: MapPin },
  { step: 2, title: '2. Mark your fields', Icon: Layers },
  { step: 3, title: '3. Review & save', Icon: CheckCircle2 },
] as const;

function createBlankField(index: number, labelPrefix = 'Field'): UserFieldDraft {
  return {
    id: `F${index}`,
    label: `${labelPrefix} ${index}`,
    geometry: null,
    declaredAreaHa: 5.0,
    areaBasis: 'USER_DECLARED_NOT_SURVEYED',
    irrigationAccess: 'UNKNOWN',
    soilTexture: {
      value: null,
      evidenceClass: 'MISSING_OR_UNQUALIFIED',
      missingReason: 'Optional soil details not entered.',
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
      missingReason: 'No laboratory soil nitrogen measurement entered.',
    },
    nitrogenBasis: 'ELEMENTAL_N_KG_HA',
    initialRootZoneMm: {
      value: null,
      unit: 'mm',
      evidenceClass: 'MISSING_OR_UNQUALIFIED',
    },
    previousCrops: [],
    candidateCrops: [],
    plannedSowingDate: '2027-04-18',
    plannedHarvestDate: '2027-08-24',
  };
}

function createFreshCustomFarmDraft(existingIds: Iterable<string>): UserFarmDraft {
  const now = new Date().toISOString();
  const id = slugifyCustomFarmId('my-farm', existingIds);
  const f1 = createBlankField(1, 'Main Field');
  return {
    id,
    name: 'My Farm',
    createdAt: now,
    updatedAt: now,
    isUserCreatedDraft: true,
    inputsModified: true,
    site: {
      longitude: 0,
      latitude: 15,
      crs: 'EPSG:4326',
      locationLabel: 'No location chosen yet — search a place or tap the globe',
      countryCode: 'UNSELECTED',
      regionName: 'World view',
      spatialPrecisionNote:
        'User-selected coordinates in WGS84 (EPSG:4326). Soil and local permits remain unmeasured unless entered.',
    },
    waterContext: {
      sharedDailyDeliveryM3: {
        value: null,
        unit: 'm3/day',
        evidenceClass: 'MISSING_OR_UNQUALIFIED',
      },
      seasonalQuotaM3: {
        value: null,
        unit: 'm3/yr',
        evidenceClass: 'MISSING_OR_UNQUALIFIED',
      },
      serviceThresholdMm: {
        value: 100,
        unit: 'mm',
        evidenceClass: 'RESEARCH_ASSUMPTION',
      },
      waterSourceType: 'MIXED_UNVERIFIED',
      legalRightsVerified: false,
    },
    fields: [f1],
    selectedPurpose: 'DESCRIPTIVE_CONTEXT',
    selectedPreference: 'MINIMIZE_WORST_ET_SHORTFALL',
    assumptionAcknowledged: true,
  };
}

function generateBoxPolygonNear(
  centerLon: number,
  centerLat: number,
  fieldIndex: number,
  targetAreaHa: number
): GeoJSON.Polygon {
  const sideMeters = Math.sqrt(Math.max(targetAreaHa, 0.25) * 10000);
  const halfLatDeg = sideMeters / 2 / 111320;
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.2);
  const halfLonDeg = sideMeters / 2 / (111320 * cosLat);
  const offsetLon = (fieldIndex % 3) * (halfLonDeg * 2.4);
  const offsetLat = Math.floor(fieldIndex / 3) * (halfLatDeg * 2.4);
  const cLon = centerLon + offsetLon;
  const cLat = centerLat + offsetLat;

  const minLon = Number((cLon - halfLonDeg).toFixed(6));
  const maxLon = Number((cLon + halfLonDeg).toFixed(6));
  const minLat = Number((cLat - halfLatDeg).toFixed(6));
  const maxLat = Number((cLat + halfLatDeg).toFixed(6));

  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

export function FarmSetupWizardClient({ initialFarmId = '' }: { initialFarmId?: string }) {
  const { farmDrafts, getFarmDraft, prefsHydrated } = useAstragron();

  if (!prefsHydrated) {
    return (
      <div className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-12 px-4">
        <div className="mx-auto max-w-[1060px] rounded-2xl border border-[#29455A] bg-[#0D2031] p-8 text-sm text-[#AEC4D3]">
          {initialFarmId ? 'Loading saved farm details...' : 'Loading farm setup studio...'}
        </div>
      </div>
    );
  }

  const resolvedInitialDraft = (() => {
    if (initialFarmId) {
      const found = getFarmDraft(initialFarmId);
      if (found) return structuredClone(found);
    }
    return createFreshCustomFarmDraft(Object.keys(farmDrafts));
  })();

  return (
    <FarmSetupWizardInner
      key={initialFarmId || 'fresh'}
      initialDraft={resolvedInitialDraft}
    />
  );
}

function FarmSetupWizardInner({ initialDraft }: { initialDraft: UserFarmDraft }) {
  const router = useRouter();
  const m = useMessages();
  const { farmDrafts, getFarmDraft, saveFarmDraft, unitMode, setActivePreference, reducedMotion } =
    useAstragron();

  const [step, setStep] = useState<number>(1);
  const [draft, setDraft] = useState<UserFarmDraft>(() => initialDraft);
  const [locationSelected, setLocationSelected] = useState<boolean>(
    () =>
      initialDraft.site.countryCode !== 'UNSELECTED' &&
      !initialDraft.site.locationLabel.startsWith('No location chosen yet')
  );
  const [activeFieldIndex, setActiveFieldIndex] = useState<number>(0);
  const [placeZoomHint, setPlaceZoomHint] = useState<number | undefined>(undefined);

  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [geojsonPaste, setGeojsonPaste] = useState('');
  const geoFileInputRef = useRef<HTMLInputElement | null>(null);

  const [capabilityOverlayEnabled, setCapabilityOverlayEnabled] = useState(false);
  const [capabilityGeoJson, setCapabilityGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [capabilityCheck, setCapabilityCheck] = useState<SiteCapabilityCheckResult | null>(null);
  const [capabilityToast, setCapabilityToast] = useState<CapabilityToastNotice | null>(null);

  const [sowingDate, setSowingDate] = useState<string>(
    () => draft.fields[0]?.plannedSowingDate ?? '2027-04-18'
  );
  const [harvestDate, setHarvestDate] = useState<string>(
    () => draft.fields[0]?.plannedHarvestDate ?? '2027-08-24'
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const safeFieldIndex = Math.min(activeFieldIndex, Math.max(0, draft.fields.length - 1));
  const activeField = draft.fields[safeFieldIndex] ?? draft.fields[0]!;
  const activeFieldGeometry = activeField?.geometry ?? null;

  React.useEffect(() => {
    if (!capabilityOverlayEnabled || capabilityGeoJson) return;
    let active = true;
    const ac = new AbortController();
    void fetch('/api/capabilities/footprints', { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { featureCollection?: GeoJSON.FeatureCollection } | null) => {
        if (active && data?.featureCollection) {
          setCapabilityGeoJson(data.featureCollection);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      ac.abort();
    };
  }, [capabilityOverlayEnabled, capabilityGeoJson]);

  React.useEffect(() => {
    if (!locationSelected) {
      setCapabilityCheck(null);
      setCapabilityToast(null);
      return;
    }
    let active = true;
    const ac = new AbortController();
    void fetch('/api/capabilities/site-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [draft.site.longitude, draft.site.latitude],
        geometry: draft.inputsModified || draft.isUserCreatedDraft ? activeFieldGeometry : null,
        farmId: draft.id,
        inputRevision: draft.inputRevision,
        isUserModifiedDraft: Boolean(draft.inputsModified),
        isUserCreatedDraft: Boolean(draft.isUserCreatedDraft),
      }),
      signal: ac.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { check?: SiteCapabilityCheckResult } | null) => {
        const data = payload?.check;
        if (!active || !data) return;
        setCapabilityCheck(data);
        if (
          data.status === 'CONFIRMED_UNSUPPORTED' ||
          data.status === 'PARTIAL_OR_CONDITIONAL'
        ) {
          setCapabilityToast({
            status: data.status,
            title: "This analysis isn't available here yet. You can still select and save your field.",
            explanation: `${data.headline} ${data.explanation}`,
            reasons: data.reasons,
            alternatives: data.alternatives,
          });
        } else {
          setCapabilityToast(null);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      ac.abort();
    };
  }, [
    locationSelected,
    draft.site.longitude,
    draft.site.latitude,
    draft.id,
    draft.inputRevision,
    draft.inputsModified,
    draft.isUserCreatedDraft,
    activeFieldGeometry,
  ]);

  const validateCurrentDraft = () => {
    return validateFarmSetupDraft({
      name: draft.name,
      longitude: draft.site.longitude,
      latitude: draft.site.latitude,
      fields: draft.fields.map((f) => ({
        id: f.id,
        declaredAreaHa: f.declaredAreaHa,
        mineralNo3KgHa: f.mineralNo3KgHa.value,
        nitrogenBasis: f.nitrogenBasis ?? 'ELEMENTAL_N_KG_HA',
        sowingDate,
        harvestDate,
      })),
    });
  };

  const handleLoadSiteTemplate = (presetKey: 'uppsala-demo' | 'nyeri-kenya' | 'wagga-australia') => {
    const nextDraft = getFarmDraft(presetKey);
    if (nextDraft) {
      const cloned = structuredClone(nextDraft);
      setDraft(cloned);
      setLocationSelected(true);
      setPlaceZoomHint(undefined);
      setActiveFieldIndex(0);
      setSowingDate(cloned.fields[0]?.plannedSowingDate ?? '2027-04-18');
      setHarvestDate(cloned.fields[0]?.plannedHarvestDate ?? '2027-08-24');
      setValidationError(null);
      setSavedNotice(`Loaded ${presetKey} location & reference boundary template.`);
    }
  };

  const handleUseGpsLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoMessage('Browser location is not available on this device. Enter coordinates or pick a town below.');
      return;
    }
    setGeoMessage('Checking browser GPS coordinates...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lon = Number(pos.coords.longitude.toFixed(5));
        const lat = Number(pos.coords.latitude.toFixed(5));
        setDraft((prev) => ({
          ...prev,
          site: {
            ...prev.site,
            longitude: lon,
            latitude: lat,
            locationLabel: `Device GPS pin [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
            countryCode: 'GPS',
            regionName: 'GPS Location',
          },
        }));
        setLocationSelected(true);
        setValidationError(null);
        setGeoMessage(`Updated pin from device GPS (${lat.toFixed(4)}, ${lon.toFixed(4)}).`);
      },
      () => {
        setGeoMessage('Location permission was denied or unavailable. Select a reference region or type coordinates.');
      },
      { timeout: 8000 }
    );
  };

  const handleImportGeoJson = (raw: string, fileNameHint?: string) => {
    const check = importFieldBoundaryText(raw, fileNameHint);
    if (!check.valid || !check.geometry || !check.metrics) {
      setValidationError(check.errors.join(' ') || 'Invalid boundary file.');
      return;
    }
    const geom = check.geometry;
    const areaHa = check.metrics.areaHa;
    const perimeterMeters = check.metrics.perimeterMeters;
    const firstCoord =
      geom.type === 'Polygon'
        ? geom.coordinates[0]?.[0]
        : geom.coordinates[0]?.[0]?.[0];

    setDraft((prev) => {
      const updatedFields = [...prev.fields];
      const target = updatedFields[0] ?? createBlankField(1, 'Field');
      updatedFields[0] = {
        ...target,
        geometry: geom,
        declaredAreaHa: Number(areaHa.toFixed(2)),
        perimeterMeters,
        areaBasis: 'GEOMETRY_DERIVED_ESTIMATE',
        geometrySource: 'USER_IMPORT',
        sourceDataset: `Imported ${check.format}`,
        userConfirmed: true,
      };
      return {
        ...prev,
        fields: updatedFields,
        site:
          firstCoord && typeof firstCoord[0] === 'number' && typeof firstCoord[1] === 'number'
            ? {
                ...prev.site,
                longitude: Number(firstCoord[0].toFixed(5)),
                latitude: Number(firstCoord[1].toFixed(5)),
                countryCode: prev.site.countryCode === 'UNSELECTED' ? 'CUSTOM' : prev.site.countryCode,
                locationLabel:
                  prev.site.locationLabel.startsWith('No location chosen yet')
                    ? `Imported ${check.format} boundary [${firstCoord[1].toFixed(4)}, ${firstCoord[0].toFixed(4)}]`
                    : prev.site.locationLabel,
              }
            : prev.site,
      };
    });
    setLocationSelected(true);
    setValidationError(null);
    setGeoMessage(
      `Imported ${check.format} boundary (~${areaHa.toFixed(2)} ha · ${Math.round(perimeterMeters)} m perimeter).`
    );
  };

  const handleGeoFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setGeojsonPaste(text);
    handleImportGeoJson(text, file.name);
  };

  const handleSaveDraftLocally = () => {
    const check = validateCurrentDraft();
    if (!check.valid) {
      setValidationError(check.errors.join(' '));
      return;
    }
    setValidationError(null);
    const saved = saveFarmDraft(draft);
    if (saved.id !== draft.id) {
      setDraft(saved);
    }
    setSavedNotice(
      `Saved "${saved.name}" on this device (${new Date().toLocaleTimeString()}).`
    );
  };

  const handleResetToBlank = () => {
    const fresh = createFreshCustomFarmDraft(Object.keys(farmDrafts));
    setDraft(fresh);
    setLocationSelected(false);
    setActiveFieldIndex(0);
    setCapabilityCheck(null);
    setCapabilityToast(null);
    setSowingDate('2027-04-18');
    setHarvestDate('2027-08-24');
    setValidationError(null);
    setSavedNotice('Started a fresh blank farm setup.');
  };

  const handleExportDraftJson = () => {
    const payload = {
      exportKind: 'USER_AUTHORED_FARM_INPUT_DRAFT',
      disclaimer: 'USER INPUT DRAFT SAVED ON DEVICE — NOT A SCIENTIFIC RECOMMENDATION',
      exportedAt: new Date().toISOString(),
      draft,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astragron-farm-${draft.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddField = () => {
    const nextIdx = draft.fields.length + 1;
    setDraft((prev) => ({
      ...prev,
      fields: [...prev.fields, createBlankField(nextIdx, 'Field')],
    }));
    setActiveFieldIndex(draft.fields.length);
  };

  const handleRemoveField = (fieldId: string) => {
    if (draft.fields.length <= 1) {
      setValidationError('Your farm needs at least 1 field.');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.filter((f) => f.id !== fieldId),
    }));
    setActiveFieldIndex((idx) => Math.max(0, idx - 1));
  };

  const handleSelectSitePoint = (coords: [number, number]) => {
    const lon = Number(coords[0].toFixed(5));
    const lat = Number(coords[1].toFixed(5));
    setDraft((prev) => ({
      ...prev,
      site: {
        ...prev.site,
        longitude: lon,
        latitude: lat,
        locationLabel: `Selected map pin [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
        countryCode: prev.site.countryCode === 'UNSELECTED' ? 'CUSTOM' : prev.site.countryCode,
        regionName: prev.site.regionName === 'World view' ? 'User Selected Map Pin' : prev.site.regionName,
      },
    }));
    setLocationSelected(true);
    setValidationError(null);
    setGeoMessage(`Pin placed at ${lat.toFixed(4)}°, ${lon.toFixed(4)}°.`);
  };

  const handleUpdateFieldGeometry = (params: {
    fieldIndex: number;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
    areaHa: number | null;
    perimeterMeters: number | null;
    geometrySource: FieldGeometrySource;
    sourceDataset?: string | null;
    sourceYear?: number | null;
    modelConfidence?: number | null;
    userConfirmed?: boolean;
  }) => {
    setDraft((prev) => {
      const updated = [...prev.fields];
      const target = updated[params.fieldIndex];
      if (!target) return prev;
      updated[params.fieldIndex] = {
        ...target,
        geometry: params.geometry,
        declaredAreaHa: params.areaHa !== null ? Number(params.areaHa.toFixed(2)) : target.declaredAreaHa,
        perimeterMeters: params.perimeterMeters,
        areaBasis: params.geometry ? 'GEOMETRY_DERIVED_ESTIMATE' : 'USER_DECLARED_NOT_SURVEYED',
        geometrySource: params.geometry ? params.geometrySource : undefined,
        sourceDataset: params.geometry ? (params.sourceDataset ?? null) : null,
        sourceYear: params.geometry ? (params.sourceYear ?? null) : null,
        modelConfidence: params.geometry ? (params.modelConfidence ?? null) : null,
        geometryTimestamp: params.geometry ? new Date().toISOString() : undefined,
        userConfirmed: params.userConfirmed ?? false,
      };
      return { ...prev, fields: updated };
    });
  };

  const handleDrawBoxForField = (idx: number) => {
    setDraft((prev) => {
      const updated = [...prev.fields];
      const field = updated[idx];
      if (!field) return prev;
      const requestedHa = field.declaredAreaHa ?? 5.0;
      const poly = generateBoxPolygonNear(
        prev.site.longitude,
        prev.site.latitude,
        idx,
        requestedHa
      );
      const metrics = computeGeodesicMetrics(poly);
      const geodesicHa = metrics?.areaHa ?? estimatePolygonAreaHectares(poly);
      updated[idx] = {
        ...field,
        geometry: poly,
        declaredAreaHa: geodesicHa !== null ? Number(geodesicHa.toFixed(2)) : requestedHa,
        perimeterMeters: metrics?.perimeterMeters ?? null,
        areaBasis: 'GEOMETRY_DERIVED_ESTIMATE',
        geometrySource: 'USER_RECTANGLE_APPROX',
        sourceDataset: 'Approximate rectangle sized to declared hectares',
        geometryTimestamp: new Date().toISOString(),
        userConfirmed: false,
      };
      return { ...prev, fields: updated };
    });
  };

  const handleNextStep = () => {
    if (step === 1 && !locationSelected) {
      setValidationError(
        'Pick your farm location first — search your town, tap anywhere on the globe, use GPS, or select a reference example.'
      );
      return;
    }
    const check = validateCurrentDraft();
    if (!check.valid) {
      setValidationError(check.errors.join(' '));
      return;
    }
    setValidationError(null);
    const saved = saveFarmDraft(draft);
    if (saved.id !== draft.id) {
      setDraft(saved);
    }
    setStep((s) => Math.min(3, s + 1));
  };

  const handleFinishWizard = (
    destination: 'ANALYSIS' | 'RESULTS' | 'COVERAGE' | 'OVERVIEW'
  ) => {
    const check = validateCurrentDraft();
    if (!check.valid) {
      setValidationError(check.errors.join(' '));
      return;
    }
    const saved = saveFarmDraft(draft);
    if (saved.id !== draft.id) {
      setDraft(saved);
    }
    setActivePreference(saved.selectedPreference);
    const targetId = saved.id;
    if (destination === 'ANALYSIS') {
      router.push(`/farm/${targetId}/analysis?autostart=1`);
    } else if (destination === 'RESULTS') {
      router.push(`/farm/${targetId}/results`);
    } else if (destination === 'COVERAGE') {
      router.push(`/farm/${targetId}/coverage`);
    } else {
      router.push(`/farm/${targetId}`);
    }
  };

  const presetSiteObj =
    resolveExplorerPreset(draft.fixturePresetId ?? 'uppsala-demo') ??
    EXPLORER_PRESET_SITES['uppsala-demo']!;

  const totalAreaHa = computeFarmAreaHa(draft);
  const currentRev = computeDraftInputRevision(draft);

  return (
    <div className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-4 sm:py-8">
      <div className="mx-auto max-w-[1060px] px-4 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">
        {/* Clean Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#29455A] pb-3 sm:pb-5">
          <div>
            <Link
              href="/farms"
              className="text-xs font-mono text-[#72E4F1] hover:underline"
            >
              &larr; Back to My Farms
            </Link>
            <h1 className="mt-1 sm:mt-2 font-display text-xl sm:text-3xl font-bold text-[#F1F7FD]">
              Add or Edit Your Farm
            </h1>
            <p className="hidden sm:block mt-1 text-sm text-[#AEC4D3]">
              Set your farm location and fields in three quick steps. Unmeasured soil details stay empty until you know them.
            </p>
          </div>

          <details
            data-testid="wizard-header-more-options"
            className="relative"
          >
            <summary className="inline-flex min-h-[44px] list-none items-center gap-1.5 rounded-xl border border-[#29455A] bg-[#0D2031] px-3.5 py-2 text-xs font-medium text-[#AEC4D3] hover:border-[#548299] hover:text-[#F1F7FD] cursor-pointer select-none">
              <span>More options</span>
            </summary>
            <div className="mt-2 flex flex-wrap sm:flex-nowrap sm:absolute sm:right-0 sm:top-full sm:z-30 sm:w-max items-center gap-2 rounded-xl border border-[#29455A] bg-[#081728] p-2 shadow-xl">
              <button
                type="button"
                onClick={handleSaveDraftLocally}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3.5 py-2 text-xs font-medium text-[#72E4F1] hover:bg-[#17374A] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Draft</span>
              </button>
              <button
                type="button"
                onClick={handleExportDraftJson}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-medium text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>
              <button
                type="button"
                onClick={handleResetToBlank}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-medium text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Start Blank</span>
              </button>
            </div>
          </details>
        </div>

        {savedNotice && (
          <div className="rounded-xl border border-[#57D9A7]/50 bg-[#0D2B2A] px-4 py-2.5 text-xs text-[#57D9A7] flex items-center justify-between">
            <span>{savedNotice}</span>
            <button type="button" onClick={() => setSavedNotice(null)} className="underline cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {/* 3-Stage Compact Single-Row Stepper */}
        <nav aria-label="Farm setup progress" className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
          {WIZARD_STEPS.map((s) => {
            const isCurrent = step === s.step;
            const isCompleted = step > s.step;
            const shortMobile =
              s.step === 1 ? '1. Location' : s.step === 2 ? '2. Fields' : '3. Save';
            return (
              <button
                key={s.step}
                type="button"
                onClick={() => setStep(s.step)}
                className={`flex min-h-[44px] items-center justify-center sm:justify-start gap-1.5 sm:gap-2.5 rounded-xl border px-2 py-2 sm:p-3.5 text-center sm:text-left transition cursor-pointer ${
                  isCurrent
                    ? 'border-[#72E4F1] bg-[#132B3F] text-[#F1F7FD]'
                    : isCompleted
                    ? 'border-[#57D9A7]/50 bg-[#0D2031] text-[#57D9A7]'
                    : 'border-[#29455A] bg-[#081728] text-[#90A8BA]'
                }`}
              >
                <s.Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="text-[11px] font-semibold sm:hidden">{shortMobile}</span>
                <span className="hidden sm:inline text-sm font-semibold">{s.title}</span>
              </button>
            );
          })}
        </nav>

        {validationError && (
          <div
            role="alert"
            aria-label="Wizard validation error"
            className="rounded-xl border border-[#FF9299] bg-[#2C141B] p-4 text-xs font-medium text-[#FF9299]"
          >
            {validationError}
          </div>
        )}

        {/* STAGE 1: WHERE IS YOUR FARM? */}
        {step === 1 && (
          <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
              <div>
                <h2 className="font-display text-lg sm:text-xl font-bold text-[#F1F7FD]">
                  1. Where is your farm?
                </h2>
                <p className="hidden sm:block text-xs text-[#AEC4D3]">
                  Name your farm and search any place worldwide, paste coordinates, use GPS, or tap anywhere on the globe.
                </p>
              </div>
              <button
                type="button"
                onClick={handleUseGpsLocation}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#72E4F1]/60 bg-[#081728] px-3 py-2 text-xs font-medium text-[#72E4F1] hover:bg-[#132B3F] cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Use my location</span>
              </button>
            </div>

            {geoMessage && (
              <div className="rounded-xl border border-[#548299]/60 bg-[#081728] px-4 py-2 text-xs text-[#AEC4D3]">
                {geoMessage}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:grid-rows-[auto_1fr] items-start">
              {/* Mobile Top & Desktop Top-Left: Farm Name + Search immediately paired above Map */}
              <div className="lg:col-span-5 space-y-3">
                <div>
                  <label htmlFor="wizard-farm-name" className="block text-xs font-medium text-[#AEC4D3] mb-1">
                    Farm name
                  </label>
                  <input
                    id="wizard-farm-name"
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g., North River Plots"
                    className="w-full min-h-[44px] rounded-xl border border-[#29455A] bg-[#081728] px-3.5 py-2 text-sm text-[#F1F7FD]"
                  />
                </div>

                <PlaceSearchBox
                  inputId="wizard-place-search"
                  testId="wizard-place-search-box"
                  label="Search town, village, region, or paste coordinates"
                  placeholder="Type town, postcode, street, or lat, lon (e.g. Heilbronn, Damascus)..."
                  onSelectPlace={(place: SelectedPlaceCandidate) => {
                    setDraft((prev) => ({
                      ...prev,
                      site: {
                        ...prev.site,
                        longitude: place.coordinates[0],
                        latitude: place.coordinates[1],
                        locationLabel: place.label,
                        countryCode: place.countryCode,
                        regionName: place.region,
                      },
                    }));
                    setPlaceZoomHint(place.zoomHint);
                    setLocationSelected(true);
                    setValidationError(null);
                    setGeoMessage(`Pin moved to ${place.label}.`);
                  }}
                />
              </div>

              {/* Mobile Second (visible above fold) & Desktop Right: Interactive 3D Globe / Satellite Picker */}
              <div className="lg:col-span-7 lg:row-span-2">
                <SmartFieldEditor
                  mode="LOCATION_PICKER"
                  siteCoords={[draft.site.longitude, draft.site.latitude]}
                  locationLabel={draft.site.locationLabel}
                  locationSelected={locationSelected}
                  farmId={draft.id}
                  activeField={activeField}
                  activeFieldIndex={safeFieldIndex}
                  unitMode={unitMode}
                  reducedMotion={reducedMotion}
                  onSelectSitePoint={(coords) => {
                    setPlaceZoomHint(undefined);
                    handleSelectSitePoint(coords);
                  }}
                  onUpdateFieldGeometry={handleUpdateFieldGeometry}
                  onGenerateApproxRectangle={handleDrawBoxForField}
                  capabilityOverlayEnabled={capabilityOverlayEnabled}
                  onToggleCapabilityOverlay={() => setCapabilityOverlayEnabled((v) => !v)}
                  capabilityGeoJson={capabilityGeoJson}
                  capabilityCheck={capabilityCheck}
                  capabilityToast={capabilityToast}
                  onClickCapabilityFeature={setCapabilityToast}
                  onDismissCapabilityToast={() => setCapabilityToast(null)}
                  mapZoomOverride={placeZoomHint}
                />
              </div>

              {/* Mobile Third & Desktop Bottom-Left: Pin Readout + Secondary Reference Starter Farms */}
              <div className="lg:col-span-5 space-y-3">
                <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 text-xs space-y-1">
                  <div className="font-medium text-[#F1F7FD]">
                    {locationSelected ? draft.site.locationLabel : 'No location selected yet'}
                  </div>
                  <div className="font-mono text-[11px] text-[#72E4F1]">
                    {locationSelected
                      ? `Pin: ${draft.site.latitude.toFixed(4)}° N/S, ${draft.site.longitude.toFixed(4)}° E/W`
                      : 'Search a place, enter coordinates, or tap the interactive globe'}
                  </div>
                  <p className="text-[11px] text-[#90A8BA]">
                    Regional satellite grids span 9–50 km. Adding your field outline in Step 2 keeps local boundaries exact.
                  </p>
                </div>

                <details className="rounded-xl border border-[#29455A]/80 bg-[#081728] p-3 text-xs">
                  <summary className="cursor-pointer font-medium text-[#90A8BA] hover:text-[#AEC4D3] select-none min-h-[36px] flex items-center justify-between">
                    <span>Reference starter farms (optional)</span>
                    <span className="font-mono text-[10px] text-[#72E4F1]">3 presets</span>
                  </summary>
                  <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[#29455A]/60 pt-2.5">
                    <button
                      type="button"
                      onClick={() => handleLoadSiteTemplate('uppsala-demo')}
                      className="min-h-[40px] rounded-lg border border-[#72E4F1]/50 bg-[#0D2031] px-3 py-1.5 text-xs text-[#72E4F1] hover:bg-[#132B3F] cursor-pointer"
                    >
                      Uppsala (Sweden · 24 ha)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadSiteTemplate('nyeri-kenya')}
                      className="min-h-[40px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 text-xs text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
                    >
                      Nyeri (Kenya)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadSiteTemplate('wagga-australia')}
                      className="min-h-[40px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 text-xs text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
                    >
                      Wagga Wagga (Australia)
                    </button>
                  </div>
                </details>
              </div>
            </div>

            <details
              data-testid="wizard-manual-coords"
              className="rounded-xl border border-[#29455A] bg-[#081728] p-4"
            >
              <summary className="cursor-pointer text-xs font-semibold text-[#91B8FF] select-none">
                Enter coordinates or upload a map file (optional)
              </summary>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="wizard-lon" className="block text-xs text-[#AEC4D3] mb-1">
                    Longitude (-180° to +180°)
                  </label>
                  <input
                    id="wizard-lon"
                    type="number"
                    step="0.0001"
                    value={draft.site.longitude}
                    onChange={(e) => {
                      setLocationSelected(true);
                      setDraft({
                        ...draft,
                        site: { ...draft.site, longitude: Number(e.target.value), countryCode: draft.site.countryCode === 'UNSELECTED' ? 'CUSTOM' : draft.site.countryCode },
                      });
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-[#29455A] bg-[#0D2031] px-3 py-2 font-mono text-sm text-[#F1F7FD]"
                  />
                </div>
                <div>
                  <label htmlFor="wizard-lat" className="block text-xs text-[#AEC4D3] mb-1">
                    Latitude (-90° to +90°)
                  </label>
                  <input
                    id="wizard-lat"
                    type="number"
                    step="0.0001"
                    value={draft.site.latitude}
                    onChange={(e) => {
                      setLocationSelected(true);
                      setDraft({
                        ...draft,
                        site: { ...draft.site, latitude: Number(e.target.value), countryCode: draft.site.countryCode === 'UNSELECTED' ? 'CUSTOM' : draft.site.countryCode },
                      });
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-[#29455A] bg-[#0D2031] px-3 py-2 font-mono text-sm text-[#F1F7FD]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="wizard-loc-label" className="block text-xs text-[#AEC4D3] mb-1">
                    Region / locality name
                  </label>
                  <input
                    id="wizard-loc-label"
                    type="text"
                    value={draft.site.locationLabel}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        site: { ...draft.site, locationLabel: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-[#29455A] bg-[#0D2031] px-3 py-2 text-sm text-[#F1F7FD]"
                  />
                </div>
                <div className="sm:col-span-2 space-y-2 border-t border-[#29455A] pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[#AEC4D3]">Import WGS84 GeoJSON, KML, or GPX field boundary</span>
                    <button
                      type="button"
                      onClick={() => geoFileInputRef.current?.click()}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3 py-1.5 text-xs text-[#72E4F1] cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload GeoJSON / KML / GPX file</span>
                    </button>
                    <input
                      ref={geoFileInputRef}
                      type="file"
                      accept=".json,.geojson,.kml,.gpx,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/gpx+xml"
                      onChange={handleGeoFileUpload}
                      className="sr-only"
                    />
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={geojsonPaste}
                      onChange={(e) => setGeojsonPaste(e.target.value)}
                      placeholder='{"type":"Polygon","coordinates":[[[17.63,59.85],[17.64,59.85],[17.64,59.86],[17.63,59.86],[17.63,59.85]]]}'
                      className="flex-1 rounded-lg border border-[#29455A] bg-[#0D2031] p-2 font-mono text-[11px] text-[#F1F7FD]"
                    />
                    <button
                      type="button"
                      onClick={() => handleImportGeoJson(geojsonPaste)}
                      className="self-end rounded-lg bg-[#548299] px-3 py-2 text-xs font-semibold text-[#061320] hover:bg-[#72E4F1] cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}

        {/* STAGE 2: MARK YOUR FIELDS */}
        {step === 2 && (
          <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#29455A] pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
                  2. Mark your fields
                </h2>
                <p className="text-xs text-[#AEC4D3]">
                  Select a field on the left, then click Suggest Field, Draw Manually, or open More options.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddField}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#72E4F1] px-4 py-2 text-xs font-semibold text-[#081521] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add field</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
              <div className="lg:col-span-5 space-y-3">
                {draft.fields.map((field, idx) => {
                  const geomArea = field.geometry ? estimatePolygonAreaHectares(field.geometry) : null;
                  const isActive = idx === safeFieldIndex;
                  return (
                    <div
                      key={field.id}
                      onClick={() => setActiveFieldIndex(idx)}
                      className={`rounded-xl border p-4 space-y-3 transition ${
                        isActive
                          ? 'border-[#72E4F1] bg-[#0E2438]'
                          : 'border-[#29455A] bg-[#081728] hover:border-[#548299]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-[#132B3F] border border-[#548299] px-2.5 py-0.5 font-mono text-xs font-bold text-[#72E4F1]">
                            {field.id}
                          </span>
                          <input
                            type="text"
                            aria-label={`Field ${field.id} label`}
                            value={field.label}
                            onChange={(e) => {
                              const updated = [...draft.fields];
                              updated[idx] = { ...field, label: e.target.value };
                              setDraft({ ...draft, fields: updated });
                            }}
                            className="min-h-[38px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 text-sm font-semibold text-[#F1F7FD]"
                          />
                        </div>
                        {draft.fields.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveField(field.id);
                            }}
                            className="inline-flex min-h-[36px] items-center gap-1 text-xs text-[#FF9299] hover:underline cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                        <div>
                          <label className="block text-[#90A8BA] mb-1">
                            Size (ha) · {formatAreaWithUnit(field.declaredAreaHa, unitMode)}
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={field.declaredAreaHa ?? ''}
                            onChange={(e) => {
                              const updated = [...draft.fields];
                              updated[idx] = {
                                ...field,
                                declaredAreaHa: e.target.value ? Number(e.target.value) : null,
                                areaBasis: field.geometry
                                  ? 'GEOMETRY_DERIVED_ESTIMATE'
                                  : 'USER_DECLARED_NOT_SURVEYED',
                              };
                              setDraft({ ...draft, fields: updated });
                            }}
                            className="w-full min-h-[40px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 font-mono text-[#F1F7FD]"
                          />
                        </div>

                        <div>
                          <label className="block text-[#90A8BA] mb-1">Irrigation water access</label>
                          <select
                            value={field.irrigationAccess}
                            onChange={(e) => {
                              const updated = [...draft.fields];
                              updated[idx] = {
                                ...field,
                                irrigationAccess: e.target.value as 'YES' | 'NO' | 'UNKNOWN',
                              };
                              setDraft({ ...draft, fields: updated });
                            }}
                            className="w-full min-h-[40px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-[#F1F7FD]"
                          >
                            <option value="YES">Yes — irrigated</option>
                            <option value="NO">No — rainfall only</option>
                            <option value="UNKNOWN">Not sure yet</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#29455A]/60 pt-2 text-[11px]">
                        <span className={geomArea !== null ? 'font-mono text-[#57D9A7]' : 'text-[#90A8BA]'}>
                          {geomArea !== null ? `Measured outline: ${geomArea.toFixed(2)} ha` : 'No map outline yet'}
                        </span>
                        <span className="font-mono text-[10px] text-[#72E4F1]">
                          {isActive ? 'Editing on map →' : 'Tap to edit'}
                        </span>
                      </div>
                    </div>
                  );
                })}

                <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-1.5 text-xs">
                  <div className="font-semibold text-[#F1F7FD]">
                    Summary: {draft.fields.length} field{draft.fields.length === 1 ? '' : 's'}
                  </div>
                  <div className="font-mono text-sm text-[#72E4F1]">
                    Total: {formatAreaWithUnit(totalAreaHa, unitMode)}
                  </div>
                  <p className="text-[11px] text-[#90A8BA]">
                    Need full-screen satellite inspection? Open{' '}
                    <Link href="/explore" className="text-[#91B8FF] underline">
                      Explore Map
                    </Link>
                    .
                  </p>
                </div>
              </div>

              <div className="lg:col-span-7">
                <SmartFieldEditor
                  mode="FIELD_EDITOR"
                  siteCoords={[draft.site.longitude, draft.site.latitude]}
                  locationLabel={`${draft.site.locationLabel} · ${activeField.label}`}
                  locationSelected={locationSelected}
                  farmId={draft.id}
                  activeField={activeField}
                  activeFieldIndex={safeFieldIndex}
                  unitMode={unitMode}
                  reducedMotion={reducedMotion}
                  onSelectSitePoint={handleSelectSitePoint}
                  onUpdateFieldGeometry={handleUpdateFieldGeometry}
                  onGenerateApproxRectangle={handleDrawBoxForField}
                  capabilityOverlayEnabled={capabilityOverlayEnabled}
                  onToggleCapabilityOverlay={() => setCapabilityOverlayEnabled((v) => !v)}
                  capabilityGeoJson={capabilityGeoJson}
                  capabilityCheck={capabilityCheck}
                  capabilityToast={capabilityToast}
                  onClickCapabilityFeature={setCapabilityToast}
                  onDismissCapabilityToast={() => setCapabilityToast(null)}
                />
              </div>
            </div>
          </div>
        )}

        {/* STAGE 3: REVIEW & SAVE + COLLAPSED OPTIONAL DETAILS */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-6 space-y-6">
              <div className="border-b border-[#29455A] pb-4">
                <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
                  3. Review &amp; save
                </h2>
                <p className="text-xs text-[#AEC4D3]">
                  Confirm your farm summary below, add optional local soil/water details if measured, and check available satellite data.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-12 items-center">
                <div className="md:col-span-5">
                  <FarmPolygonPreview farm={draft} className="h-44 w-full" />
                </div>
                <div className="md:col-span-7 space-y-3 text-xs">
                  <div>
                    <div className="font-display text-lg font-bold text-[#F1F7FD]">{draft.name}</div>
                    <div className="text-[#AEC4D3]">{draft.site.locationLabel}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
                      <span className="text-[11px] text-[#90A8BA] block">Fields &amp; Total Size</span>
                      <span className="font-mono text-sm font-bold text-[#72E4F1]">
                        {draft.fields.length} field{draft.fields.length === 1 ? '' : 's'} · {formatAreaWithUnit(totalAreaHa, unitMode)}
                      </span>
                    </div>
                    <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
                      <span className="text-[11px] text-[#90A8BA] block">Coordinates (WGS84)</span>
                      <span className="font-mono text-xs text-[#F1F7FD]">
                        [{draft.site.longitude.toFixed(4)}, {draft.site.latitude.toFixed(4)}]
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/70 p-3 flex items-start gap-2 text-[#FFCE7B]">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="text-[#AEC4D3]">
                      Saved privately on this device (<code className="text-[#72E4F1]">rev {currentRev.slice(0, 8)}</code>). Custom farms check regional Earth-observation coverage honestly; full crop prescriptions require connecting the live engine.
                      {capabilityCheck?.status === 'CONFIRMED_UNSUPPORTED' &&
                        ' Full crop analysis is confirmed unsupported here yet, and your farm boundary is still safely stored.'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Primary CTA + Quiet Secondary Actions */}
              <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 pt-2 border-t border-[#29455A]">
                <button
                  type="button"
                  data-testid="wizard-save-and-analyze-btn"
                  onClick={() => handleFinishWizard('ANALYSIS')}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-[#72E4F1] px-6 py-2.5 text-sm font-semibold text-[#061320] hover:bg-[#93EDF7] cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save farm &amp; check data</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFinishWizard('RESULTS')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-[#548299] bg-[#081728] px-5 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer"
                >
                  <span>Open Report View</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleFinishWizard('COVERAGE')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-[#29455A] bg-[#081728] px-5 py-2 text-xs font-medium text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
                >
                  <span>Review M4 Evidence Readiness</span>
                </button>
              </div>
            </div>

            {/* Collapsed Optional Soil, Water & Crop Details (Preserves all scientific fields & null defaults!) */}
            <details
              data-testid="wizard-optional-agronomy"
              className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5"
            >
              <summary className="cursor-pointer text-sm font-semibold text-[#72E4F1] select-none flex items-center justify-between gap-2">
                <span>Add soil, water, and crop information (optional)</span>
                <span className="text-xs font-normal text-[#90A8BA]">
                  Unmeasured values remain empty (null)
                </span>
              </summary>

              <div className="mt-5 space-y-5 border-t border-[#29455A] pt-5 text-xs">
                {/* Sowing / Harvest & Water */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1.5">
                    <label htmlFor="wizard-sowing-date" className="block text-[#90A8BA]">
                      Sowing Date
                    </label>
                    <input
                      id="wizard-sowing-date"
                      type="date"
                      value={sowingDate}
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        setSowingDate(nextDate);
                        setDraft((prev) => ({
                          ...prev,
                          fields: prev.fields.map((f) => ({ ...f, plannedSowingDate: nextDate })),
                        }));
                      }}
                      className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                    />
                  </div>
                  <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1.5">
                    <label htmlFor="wizard-harvest-date" className="block text-[#90A8BA]">
                      Harvest Date (After Sowing)
                    </label>
                    <input
                      id="wizard-harvest-date"
                      type="date"
                      value={harvestDate}
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        setHarvestDate(nextDate);
                        setDraft((prev) => ({
                          ...prev,
                          fields: prev.fields.map((f) => ({ ...f, plannedHarvestDate: nextDate })),
                        }));
                      }}
                      className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                    />
                  </div>
                  <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[#90A8BA]">Daily Water Cap (m³/day)</span>
                      <EvidenceClassBadge evidenceClass={draft.waterContext.sharedDailyDeliveryM3.evidenceClass} />
                    </div>
                    <input
                      type="number"
                      placeholder="Null (Unknown)"
                      value={draft.waterContext.sharedDailyDeliveryM3.value ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          waterContext: {
                            ...draft.waterContext,
                            sharedDailyDeliveryM3: {
                              ...draft.waterContext.sharedDailyDeliveryM3,
                              value: e.target.value === '' ? null : Number(e.target.value),
                            },
                          },
                        })
                      }
                      className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                    />
                  </div>
                  <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[#90A8BA]">Annual Allocation (m³/yr)</span>
                      <EvidenceClassBadge evidenceClass={draft.waterContext.seasonalQuotaM3.evidenceClass} />
                    </div>
                    <input
                      type="number"
                      placeholder="Null (Unknown)"
                      value={draft.waterContext.seasonalQuotaM3.value ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          waterContext: {
                            ...draft.waterContext,
                            seasonalQuotaM3: {
                              ...draft.waterContext.seasonalQuotaM3,
                              value: e.target.value === '' ? null : Number(e.target.value),
                            },
                          },
                        })
                      }
                      className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                    />
                  </div>
                </div>

                {/* Per-field Mineral N & Crops */}
                <div className="space-y-3">
                  {draft.fields.map((f, idx) => (
                    <div
                      key={f.id}
                      className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[#AEC4D3]">
                            {f.id} Mineral N (kg N/ha)
                          </span>
                          <EvidenceClassBadge evidenceClass={f.mineralNo3KgHa.evidenceClass} />
                        </div>
                        <input
                          type="number"
                          placeholder="Null (Unmeasured)"
                          value={f.mineralNo3KgHa.value ?? ''}
                          onChange={(e) => {
                            const updated = [...draft.fields];
                            updated[idx] = {
                              ...f,
                              mineralNo3KgHa: {
                                ...f.mineralNo3KgHa,
                                value: e.target.value === '' ? null : Number(e.target.value),
                              },
                            };
                            setDraft({ ...draft, fields: updated });
                          }}
                          className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                        />
                      </div>
                      <div>
                        <label className="block text-[#90A8BA] mb-1">Nitrogen Chemical Basis</label>
                        <select
                          value={f.nitrogenBasis ?? 'ELEMENTAL_N_KG_HA'}
                          onChange={(e) => {
                            const updated = [...draft.fields];
                            updated[idx] = {
                              ...f,
                              nitrogenBasis: e.target.value as NitrogenChemicalBasis,
                            };
                            setDraft({ ...draft, fields: updated });
                          }}
                          className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                        >
                          <option value="ELEMENTAL_N_KG_HA">ELEMENTAL_N_KG_HA (kg N/ha)</option>
                          <option value="NITRATE_ION_NO3_KG_HA_UNSUPPORTED">
                            NITRATE_ION_NO3_KG_HA_UNSUPPORTED
                          </option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`wizard-candidate-crops-${f.id}`} className="block text-[#90A8BA] mb-1">
                          Candidate Crops
                        </label>
                        <input
                          id={`wizard-candidate-crops-${f.id}`}
                          type="text"
                          value={(f.candidateCrops ?? []).join(', ')}
                          onChange={(e) => {
                            const parsed = e.target.value
                              .split(',')
                              .map((item) => item.trim())
                              .filter(Boolean);
                            const updated = [...draft.fields];
                            updated[idx] = { ...f, candidateCrops: parsed };
                            setDraft({ ...draft, fields: updated });
                          }}
                          className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-1.5 font-mono text-[#F1F7FD]"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Research Purpose & Preference + Site Capabilities Snapshot */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[#90A8BA] mb-1">Research Purpose</label>
                    <select
                      value={draft.selectedPurpose}
                      onChange={(e) =>
                        setDraft({ ...draft, selectedPurpose: e.target.value as EvidencePurpose })
                      }
                      className="w-full rounded-lg border border-[#29455A] bg-[#081728] px-3 py-2 font-mono text-[#F1F7FD]"
                    >
                      <option value="DESCRIPTIVE_CONTEXT">DESCRIPTIVE_CONTEXT</option>
                      <option value="MODEL_INPUT_REVIEW">MODEL_INPUT_REVIEW</option>
                      <option value="FUTURE_CLIMATE_CONTEXT">FUTURE_CLIMATE_CONTEXT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#90A8BA] mb-1">Scenario Preference Order</label>
                    <select
                      value={draft.selectedPreference}
                      onChange={(e) =>
                        setDraft({ ...draft, selectedPreference: e.target.value as ResearchPreference })
                      }
                      className="w-full rounded-lg border border-[#29455A] bg-[#081728] px-3 py-2 font-mono text-[#F1F7FD]"
                    >
                      {(
                        [
                          'STRICT_ALL_SCENARIOS_SERVICE',
                          'MINIMIZE_WORST_ET_SHORTFALL',
                          'MINIMAX_REGRET',
                          'PARETO_FRONTIER',
                        ] as const
                      ).map((prefKey) => (
                        <option key={prefKey} value={prefKey}>
                          {m.preferences[prefKey].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {draft.fixturePresetId && resolveExplorerPreset(draft.fixturePresetId) ? (
                    presetSiteObj.capabilities.slice(0, 2).map((cap) => (
                      <div
                        key={cap.capability}
                        className="rounded-xl border border-[#29455A] bg-[#081728] p-3 flex items-center justify-between gap-2"
                      >
                        <span className="text-[#AEC4D3]">{cap.capability_label}</span>
                        <CoverageStatusBadge status={cap.status} size="sm" />
                      </div>
                    ))
                  ) : capabilityCheck ? (
                    <>
                      <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3 flex items-center justify-between gap-2">
                        <span className="text-[#AEC4D3]">M4 Earth data coverage</span>
                        <span className="font-mono text-[11px] text-[#72E4F1]">
                          {capabilityCheck.matrix.m4EarthDataCoverage}
                        </span>
                      </div>
                      <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3 flex items-center justify-between gap-2">
                        <span className="text-[#AEC4D3]">Site capability assessment</span>
                        <span className="font-mono text-[11px] text-[#72E4F1]">
                          {capabilityCheck.status}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2 rounded-xl border border-[#29455A] bg-[#081728] p-3 text-[#AEC4D3]">
                      Unassessed custom location: site capability remains neutral until explicitly checked against verified footprints.
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>
        )}

        {/* Back / Next Navigation Footer */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#29455A] bg-[#0D2031] px-4 text-xs font-semibold text-[#F1F7FD] disabled:opacity-40 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          {step < 3 && (
            <button
              type="button"
              onClick={handleNextStep}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#72E4F1] px-5 text-xs font-semibold text-[#081521] hover:bg-[#43C9C1] cursor-pointer"
            >
              <span>Continue ({step}/3)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
