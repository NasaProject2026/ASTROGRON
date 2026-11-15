'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  MapPin,
  Layers,
  ShieldAlert,
  ArrowRight,
  Compass,
  PenTool,
  AlertCircle,
  Globe2,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  CoverageStatusBadge,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron, formatAreaWithUnit } from '@/hooks/use-astragron-store';
import {
  CANONICAL_EXPLORER_PRESETS,
  DEFAULT_UPPSALA_FARM_DRAFT,
  resolveExplorerPreset,
  type ExplorerPresetSite,
} from '@/fixtures/sites-and-coverage';
import {
  validateFieldGeoJson,
  estimatePolygonAreaHectares,
  parseDmsCoordinateString,
} from '@/domain/schemas';
import { searchLocationsViaAdapter } from '@/adapters/repositories';
import {
  defaultGeocodingProvider,
  type RemoteGeocodePlace,
} from '@/adapters/geocoding-provider';
import { useMessages } from '@/lib/i18n';
import type { UserFarmDraft } from '@/domain/contracts';
import type { SiteCapabilityCheckResult } from '@/domain/capability-overlay';
import { validatePolygonGeometry } from '@/lib/geometry-validation';
import { MapLibreGlobeCanvas, type CapabilityToastNotice } from './maplibre-globe-canvas';
import {
  EO_OVERLAY_CATALOG,
  type MapBasemapMode,
  type MapRenderStatus,
} from './map-providers';

type InspectorTab = 'COORDS' | 'BOUNDARY' | 'LAYERS';
type CoordEntryMode = 'DECIMAL' | 'DMS' | 'GEOJSON';

const ZOOM_JOURNEY_STOPS = [
  { id: 'orbit', label: 'Orbit', zoom: 1.45 },
  { id: 'region', label: 'Basin', zoom: 6.5 },
  { id: 'local', label: 'Local', zoom: 11.8 },
  { id: 'field', label: 'Field', zoom: 15.0 },
] as const;

function slugifySiteId(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 28);
  return `custom-${base || 'site'}`;
}

const VERTEX_EDIT_MIN_ZOOM = 8.0;

function formatDecimalToDms(decimal: number, axis: 'LON' | 'LAT'): string {
  const abs = Math.abs(decimal);
  let deg = Math.floor(abs);
  const remMin = (abs - deg) * 60;
  let min = Math.floor(remMin);
  let sec = Number(((remMin - min) * 60).toFixed(1));
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const hemi = axis === 'LON' ? (decimal < 0 ? 'W' : 'E') : (decimal < 0 ? 'S' : 'N');
  return `${deg}° ${String(min).padStart(2, '0')}' ${sec.toFixed(1)}" ${hemi}`;
}

export function EarthExplorerClient() {
  const router = useRouter();
  const {
    reducedMotion,
    unitMode,
    datasetMode,
    complexityMode,
    repository,
    saveFarmDraft,
    setActiveSiteId,
    getFarmDraft,
  } = useAstragron();

  const initialPreset = resolveExplorerPreset('uppsala-demo') ?? CANONICAL_EXPLORER_PRESETS[0]!;
  const initialPoly = initialPreset.defaultPolygon;
  const initialRing = initialPoly?.coordinates[0]?.slice(0, -1) ?? [];

  const [selectedSiteKey, setSelectedSiteKey] = useState<string>(initialPreset.id);
  const [siteTitle, setSiteTitle] = useState<string>(initialPreset.name);
  const [countryCode, setCountryCode] = useState<string>(initialPreset.countryCode);
  const [regionName, setRegionName] = useState<string>(initialPreset.regionName);
  const [selectedCoords, setSelectedCoords] = useState<[number, number]>(initialPreset.coordinates);
  // Open at planetary orbital altitude so users first experience Earth as a 3D globe in space
  const [zoomLevel, setZoomLevel] = useState<number>(1.45);
  const [basemapMode, setBasemapMode] = useState<MapBasemapMode>('SATELLITE_HYBRID');
  const [mapRenderStatus, setMapRenderStatus] = useState<MapRenderStatus>('REMOTE_LOADING');

  const [activeLayerId, setActiveLayerId] = useState<string>('HLS_REFLECTANCE');
  const [polygon, setPolygon] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(initialPoly);
  const [isDrawingMode, setIsDrawingMode] = useState<boolean>(false);
  const [drawingVertices, setDrawingVertices] = useState<Array<[number, number]>>(
    initialRing.map((c) => [c[0]!, c[1]!])
  );
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | undefined>(0);

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('COORDS');
  const [showMobileMapSettings, setShowMobileMapSettings] = useState(false);
  const [coordEntryMode, setCoordEntryMode] = useState<CoordEntryMode>('DECIMAL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lonInput, setLonInput] = useState<string>(String(initialPreset.coordinates[0]));
  const [latInput, setLatInput] = useState<string>(String(initialPreset.coordinates[1]));
  const [dmsLonInput, setDmsLonInput] = useState<string>(
    formatDecimalToDms(initialPreset.coordinates[0], 'LON')
  );
  const [dmsLatInput, setDmsLatInput] = useState<string>(
    formatDecimalToDms(initialPreset.coordinates[1], 'LAT')
  );
  const [hasUserEditedGeometry, setHasUserEditedGeometry] = useState<boolean>(false);
  const [geoJsonInput, setGeoJsonInput] = useState<string>('');
  const [coordError, setCoordError] = useState<string | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [capabilityOverlayEnabled, setCapabilityOverlayEnabled] = useState<boolean>(false);
  const [capabilityGeoJson, setCapabilityGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [capabilityCheck, setCapabilityCheck] = useState<SiteCapabilityCheckResult | null>(null);
  const [capabilityToast, setCapabilityToast] = useState<CapabilityToastNotice | null>(null);

  const runSiteCapabilityCheck = async (
    coords: [number, number],
    geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
    siteId?: string,
    isEdited?: boolean
  ) => {
    try {
      const res = await fetch('/api/capabilities/site-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinates: coords,
          geometry: geom,
          farmId: siteId,
          isUserModifiedDraft: Boolean(isEdited),
        }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { ok?: boolean; check?: SiteCapabilityCheckResult };
      if (body.ok && body.check) {
        setCapabilityCheck(body.check);
        if (body.check.status === 'CONFIRMED_UNSUPPORTED') {
          setCapabilityToast({
            status: body.check.status,
            title: body.check.headline,
            explanation: body.check.explanation,
            reasons: body.check.reasons,
            alternatives: body.check.alternatives,
          });
        } else {
          setCapabilityToast(null);
        }
      }
    } catch {
      // Non-blocking diagnostic check
    }
  };

  useEffect(() => {
    let active = true;
    const ac = new AbortController();
    fetch('/api/capabilities/footprints', { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; featureCollection?: GeoJSON.FeatureCollection } | null) => {
        if (!active || !data?.ok || !data.featureCollection) return;
        setCapabilityGeoJson(data.featureCollection);
      })
      .catch(() => {
        // Safe offline neutral default
      });
    return () => {
      active = false;
      ac.abort();
    };
  }, []);

  const activePreset: ExplorerPresetSite | null = useMemo(
    () => resolveExplorerPreset(selectedSiteKey),
    [selectedSiteKey]
  );

  const searchResponse = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    return searchLocationsViaAdapter(q);
  }, [searchQuery]);
  const searchResults = searchResponse?.results ?? [];

  const enMsgs = useMessages();
  const [remoteResults, setRemoteResults] = useState<RemoteGeocodePlace[]>([]);
  const [remoteStatusNotice, setRemoteStatusNotice] = useState<string | null>(null);
  const [isRemoteSearching, setIsRemoteSearching] = useState(false);
  const remoteAbortRef = useRef<AbortController | null>(null);

  const handleRemoteGeocodeLookup = React.useCallback(async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    remoteAbortRef.current?.abort();
    const ac = new AbortController();
    remoteAbortRef.current = ac;
    setIsRemoteSearching(true);
    setRemoteStatusNotice(enMsgs.explorerSearch.remoteLookupPending);
    const res = await defaultGeocodingProvider.searchRemoteLocations(q, ac.signal);
    if (ac.signal.aborted || res.status === 'ABORTED') return;
    setIsRemoteSearching(false);
    setRemoteResults(res.results);
    setRemoteStatusNotice(
      res.status === 'GEOCODER_NOT_CONFIGURED'
        ? enMsgs.explorerSearch.notConfigured
        : res.notice
    );
  }, [searchQuery, enMsgs.explorerSearch.notConfigured, enMsgs.explorerSearch.remoteLookupPending]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || q.length < 2) {
      remoteAbortRef.current?.abort();
      setRemoteResults([]);
      setRemoteStatusNotice(null);
      setIsRemoteSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      void handleRemoteGeocodeLookup();
    }, 320);
    return () => {
      clearTimeout(timer);
      remoteAbortRef.current?.abort();
    };
  }, [searchQuery, handleRemoteGeocodeLookup]);

  const estimatedAreaHa = useMemo(() => {
    if (polygon) {
      return estimatePolygonAreaHectares(polygon);
    }
    if (drawingVertices.length >= 3) {
      const closed: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[...drawingVertices, drawingVertices[0]!]],
      };
      return estimatePolygonAreaHectares(closed);
    }
    return null;
  }, [polygon, drawingVertices]);

  const isUppsalaDomain = selectedSiteKey === 'uppsala-demo' && !hasUserEditedGeometry;

  const activeEvidenceId = useMemo(() => {
    if (hasUserEditedGeometry && selectedSiteKey === 'uppsala-demo') {
      return null;
    }
    const scoped = repository.getEvidenceRecordsForSite(selectedSiteKey, getFarmDraft(selectedSiteKey));
    return scoped[0]?.evidence_id ?? null;
  }, [repository, selectedSiteKey, getFarmDraft, hasUserEditedGeometry]);

  const syncCoordInputs = (coords: [number, number]) => {
    setSelectedCoords(coords);
    setLonInput(coords[0].toFixed(5));
    setLatInput(coords[1].toFixed(5));
    setDmsLonInput(formatDecimalToDms(coords[0], 'LON'));
    setDmsLatInput(formatDecimalToDms(coords[1], 'LAT'));
  };

  const applyPreset = (preset: ExplorerPresetSite, targetZoom = 11.4) => {
    setSelectedSiteKey(preset.id);
    setActiveSiteId(preset.id);
    setSiteTitle(preset.name);
    setCountryCode(preset.countryCode);
    setRegionName(preset.regionName);
    syncCoordInputs(preset.coordinates);
    setPolygon(preset.defaultPolygon);
    const ring = preset.defaultPolygon?.coordinates[0]?.slice(0, -1) ?? [];
    setDrawingVertices(ring.map((c) => [c[0]!, c[1]!]));
    setSelectedVertexIndex(0);
    setHasUserEditedGeometry(false);
    setIsDrawingMode(false);
    setZoomLevel(targetZoom);
    setCoordError(null);
    setBoundaryError(null);
    setActionNotice(null);
    void runSiteCapabilityCheck(preset.coordinates, preset.defaultPolygon, preset.id, false);
  };

  const handleSelectCustomPoint = (coords: [number, number], label?: string) => {
    const [lon, lat] = coords;
    const customId = label ? slugifySiteId(label) : `custom-${lon.toFixed(2)}-${lat.toFixed(2)}`;
    setSelectedSiteKey(customId);
    setActiveSiteId(customId);
    setSiteTitle(label ?? `Custom Inspection Point (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`);
    setCountryCode('INTL');
    setRegionName('User-Selected WGS84 Location');
    syncCoordInputs([Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
    setPolygon(null);
    setDrawingVertices([]);
    setSelectedVertexIndex(undefined);
    setHasUserEditedGeometry(false);
    setCoordError(null);
    setBoundaryError(null);
    setActionNotice(
      'Custom coordinate selected. Unassessed areas remain neutral until analyzed; M14 Swedish demo outputs remain isolated.'
    );
    void runSiteCapabilityCheck([lon, lat], null, customId, true);
  };

  const handleApplyDecimalCoords = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLon = lonInput.trim();
    const trimmedLat = latInput.trim();
    const lon = Number(trimmedLon);
    const lat = Number(trimmedLat);
    if (
      !trimmedLon ||
      !trimmedLat ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) {
      setCoordError(
        'Invalid WGS84 coordinate. Longitude must be between -180 and 180, Latitude between -90 and 90.'
      );
      return;
    }
    setCoordError(null);
    handleSelectCustomPoint([lon, lat]);
    setZoomLevel((prev) => Math.max(prev, 9.5));
  };

  const handleApplyDmsCoords = (e: React.FormEvent) => {
    e.preventDefault();
    const lonRes = parseDmsCoordinateString(dmsLonInput, 'LON');
    const latRes = parseDmsCoordinateString(dmsLatInput, 'LAT');
    if (!lonRes.valid || lonRes.decimal === null || !latRes.valid || latRes.decimal === null) {
      setCoordError(
        lonRes.error ||
          latRes.error ||
          'Invalid DMS string. Example: -17° 30\' 00" or 17° 38\' 24" E and 59° 51\' 36" N.'
      );
      return;
    }
    setCoordError(null);
    handleSelectCustomPoint([lonRes.decimal, latRes.decimal]);
    setZoomLevel((prev) => Math.max(prev, 9.5));
  };

  const handleApplyGeoJson = (e: React.FormEvent) => {
    e.preventDefault();
    applyValidatedGeoJsonString(geoJsonInput);
  };

  const applyValidatedGeoJsonString = (rawText: string) => {
    const result = validateFieldGeoJson(rawText);
    if (!result.valid || !result.normalizedGeometry) {
      setBoundaryError(result.errors.join(' ') || 'GeoJSON could not be validated.');
      return;
    }
    const geom = result.normalizedGeometry;
    setBoundaryError(null);
    setPolygon(geom);
    setHasUserEditedGeometry(true);
    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0]?.slice(0, -1) ?? [];
      setDrawingVertices(ring.map((c: number[]) => [c[0] ?? 0, c[1] ?? 0]));
      if (ring.length > 0) {
        const avgLon = ring.reduce((acc: number, c: number[]) => acc + (c[0] ?? 0), 0) / ring.length;
        const avgLat = ring.reduce((acc: number, c: number[]) => acc + (c[1] ?? 0), 0) / ring.length;
        setSelectedCoords([Number(avgLon.toFixed(6)), Number(avgLat.toFixed(6))]);
        syncCoordInputs([avgLon, avgLat]);
        setSelectedSiteKey('custom-site-draft');
        setSiteTitle('Uploaded GeoJSON Field Boundary');
        setCountryCode('CUSTOM');
        setRegionName('User-Defined Field Polygon (WGS84)');
        setZoomLevel(13.2);
      }
    }
  };

  const handleGeoJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      setGeoJsonInput(rawText);
      applyValidatedGeoJsonString(rawText);
    } catch {
      setBoundaryError(`Could not read "${file.name}". Ensure it is a valid UTF-8 .geojson or .json file.`);
    }
  };

  const handleUseBrowserLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setCoordError('Browser geolocation API is unavailable in this environment. Enter coordinates manually.');
      return;
    }
    setCoordError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lon = Number(pos.coords.longitude.toFixed(5));
        const lat = Number(pos.coords.latitude.toFixed(5));
        const acc = Math.round(pos.coords.accuracy);
        handleSelectCustomPoint([lon, lat]);
        setSiteTitle(`Device Location (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`);
        setRegionName(`Browser Geolocation (±${acc} m accuracy)`);
        setZoomLevel(12.2);
        setActionNotice(`Centered globe at browser location [${lon.toFixed(4)}, ${lat.toFixed(4)}] (±${acc} m reported accuracy).`);
      },
      (err) => {
        setCoordError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission declined by user. Enter coordinates manually or choose a site preset.'
            : `Geolocation unavailable: ${err.message}`
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleAddDrawingVertex = (coord: [number, number]) => {
    if (zoomLevel < VERTEX_EDIT_MIN_ZOOM) {
      setBoundaryError(
        `Zoom to >= z${VERTEX_EDIT_MIN_ZOOM.toFixed(1)} (currently z${zoomLevel.toFixed(1)}) before placing accurate field vertices.`
      );
      return;
    }
    setHasUserEditedGeometry(true);
    setDrawingVertices((prev) => {
      const next = [...prev, coord];
      setSelectedVertexIndex(next.length - 1);
      return next;
    });
    setPolygon(null);
    setBoundaryError(null);
  };

  const handleCompleteDrawing = () => {
    if (drawingVertices.length < 3) {
      setBoundaryError('At least 3 vertices are required to close a field boundary polygon.');
      return;
    }
    const closedPoly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[...drawingVertices, drawingVertices[0]!]],
    };
    const check = validateFieldGeoJson(JSON.stringify(closedPoly));
    const topo = validatePolygonGeometry(closedPoly);
    if (!check.valid || !check.normalizedGeometry || !topo.valid) {
      const msg = [...check.errors, ...topo.errors].filter(Boolean).join(' ');
      setBoundaryError(msg || 'Polygon geometry validation failed.');
      return;
    }
    setPolygon(check.normalizedGeometry);
    setHasUserEditedGeometry(true);
    setIsDrawingMode(false);
    setBoundaryError(null);
    void runSiteCapabilityCheck(selectedCoords, check.normalizedGeometry, selectedSiteKey, true);
  };

  const handleInsertVertexAfter = (edgeIndex: number, midpoint: [number, number]) => {
    setHasUserEditedGeometry(true);
    setDrawingVertices((prev) => {
      if (prev.length < 3 || edgeIndex < 0 || edgeIndex >= prev.length) return prev;
      const next = [...prev.slice(0, edgeIndex + 1), midpoint, ...prev.slice(edgeIndex + 1)];
      setSelectedVertexIndex(edgeIndex + 1);
      if (polygon?.type === 'Polygon') {
        const updatedPoly: GeoJSON.Polygon = {
          type: 'Polygon',
          coordinates: [[...next, next[0]!]],
        };
        setPolygon(updatedPoly);
        void runSiteCapabilityCheck(selectedCoords, updatedPoly, selectedSiteKey, true);
      }
      return next;
    });
  };

  const handleDeleteVertex = (vertexIdx: number) => {
    setHasUserEditedGeometry(true);
    setDrawingVertices((prev) => {
      if (prev.length <= 3 || vertexIdx < 0 || vertexIdx >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== vertexIdx);
      setSelectedVertexIndex(Math.max(0, vertexIdx - 1));
      if (polygon?.type === 'Polygon') {
        const updatedPoly: GeoJSON.Polygon = {
          type: 'Polygon',
          coordinates: [[...next, next[0]!]],
        };
        setPolygon(updatedPoly);
        void runSiteCapabilityCheck(selectedCoords, updatedPoly, selectedSiteKey, true);
      }
      return next;
    });
  };

  const handleUndoVertex = () => {
    setHasUserEditedGeometry(true);
    setDrawingVertices((prev) => prev.slice(0, -1));
    setPolygon(null);
  };

  const handleClearPolygon = () => {
    setHasUserEditedGeometry(true);
    setDrawingVertices([]);
    setPolygon(null);
    setSelectedVertexIndex(undefined);
    setIsDrawingMode(false);
    setBoundaryError(null);
  };

  const handleUpdateVertexCoord = (idx: number, nextCoord: [number, number]) => {
    setHasUserEditedGeometry(true);
    setDrawingVertices((prev) => {
      const updated = prev.map((c, i) => (i === idx ? nextCoord : c));
      if (polygon?.type === 'Polygon' && updated.length >= 3) {
        setPolygon({
          type: 'Polygon',
          coordinates: [[...updated, updated[0]!]],
        });
      }
      return updated;
    });
  };

  const persistActiveSiteDraft = (): string => {
    const existing = getFarmDraft(selectedSiteKey);
    if (existing && selectedSiteKey === 'uppsala-demo') {
      if (!hasUserEditedGeometry) {
        setActiveSiteId('uppsala-demo');
        return 'uppsala-demo';
      }
      const updatedUppsala: UserFarmDraft = {
        ...DEFAULT_UPPSALA_FARM_DRAFT,
        id: 'uppsala-demo',
        name: `${DEFAULT_UPPSALA_FARM_DRAFT.name} (Modified Boundary)`,
        updatedAt: new Date().toISOString(),
        inputsModified: true,
        isUserCreatedDraft: true,
        derivedFromFixtureId: 'uppsala-demo',
        fields: DEFAULT_UPPSALA_FARM_DRAFT.fields.map((f, i) =>
          i === 0
            ? {
                ...f,
                geometry: polygon,
                declaredAreaHa: estimatedAreaHa ?? f.declaredAreaHa,
                areaBasis: polygon ? 'GEOMETRY_DERIVED_ESTIMATE' : f.areaBasis,
              }
            : f
        ),
      };
      const saved = saveFarmDraft(updatedUppsala);
      setActiveSiteId(saved.id);
      return saved.id;
    }

    const activeAreaHa = estimatedAreaHa ?? existing?.fields[0]?.declaredAreaHa ?? 25.0;
    const customDraft: UserFarmDraft = existing
      ? {
          ...existing,
          inputsModified: hasUserEditedGeometry || existing.inputsModified || !activePreset,
          updatedAt: new Date().toISOString(),
          site: {
            ...existing.site,
            longitude: selectedCoords[0],
            latitude: selectedCoords[1],
          },
          fields: existing.fields.map((f, i) =>
            i === 0
              ? {
                  ...f,
                  geometry: hasUserEditedGeometry ? polygon : f.geometry,
                  declaredAreaHa: activeAreaHa,
                }
              : f
          ),
        }
      : {
          id: selectedSiteKey,
          name: `${siteTitle} — Site Workspace`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          fixturePresetId: activePreset?.id,
          inputsModified: true,
          isUserCreatedDraft: !activePreset,
          site: {
            longitude: selectedCoords[0],
            latitude: selectedCoords[1],
            crs: 'EPSG:4326',
            locationLabel: siteTitle,
            countryCode,
            regionName,
            spatialPrecisionNote: `WGS84 coordinate [${selectedCoords[0].toFixed(4)}, ${selectedCoords[1].toFixed(4)}]. Exploratory coverage inspection only; no local crop/water model active.`,
          },
          waterContext: {
            sharedDailyDeliveryM3: {
              value: null,
              unit: 'm³/day',
              evidenceClass: 'MISSING_OR_UNQUALIFIED',
              missingReason: 'No local hydraulic delivery verification.',
            },
            seasonalQuotaM3: {
              value: null,
              unit: 'm³/season',
              evidenceClass: 'MISSING_OR_UNQUALIFIED',
              missingReason: 'No verified seasonal allocation.',
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
              label: `${siteTitle} Primary Parcel`,
              geometry: polygon,
              declaredAreaHa: activeAreaHa,
              areaBasis: polygon ? 'GEOMETRY_DERIVED_ESTIMATE' : 'USER_DECLARED_NOT_SURVEYED',
              irrigationAccess: 'UNKNOWN',
              soilTexture: { value: null, evidenceClass: 'MISSING_OR_UNQUALIFIED' },
              soilDepthMm: { value: null, unit: 'mm', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
              organicCarbonPct: { value: null, unit: '%', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
              soilPh: { value: null, unit: 'pH', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
              mineralNo3KgHa: {
                value: null,
                unit: 'kg N/ha (elemental N)',
                evidenceClass: 'MISSING_OR_UNQUALIFIED',
              },
              nitrogenBasis: 'ELEMENTAL_N_KG_HA',
              initialRootZoneMm: { value: null, unit: 'mm', evidenceClass: 'MISSING_OR_UNQUALIFIED' },
              previousCrops: [],
              candidateCrops: [],
              notes: 'Exploratory geographic site isolated from Swedish demo results.',
            },
          ],
          selectedPurpose: 'DESCRIPTIVE_CONTEXT',
          selectedPreference: 'MINIMIZE_WORST_ET_SHORTFALL',
          assumptionAcknowledged: true,
        };

    const saved = saveFarmDraft(customDraft);
    setActiveSiteId(saved.id);
    return saved.id;
  };

  const handleOpenResultsWorkspace = () => {
    const targetId = persistActiveSiteDraft();
    router.push(`/farm/${targetId}/results`);
  };

  const handleOpenSetupWizard = () => {
    const targetId = persistActiveSiteDraft();
    router.push(`/farm/new?from=${encodeURIComponent(targetId)}`);
  };

  const activeLayerSpec = EO_OVERLAY_CATALOG[activeLayerId] ?? EO_OVERLAY_CATALOG.HLS_REFLECTANCE!;

  const primaryPresets = CANONICAL_EXPLORER_PRESETS.filter((p) =>
    ['uppsala-demo', 'nyeri-kenya', 'wagga-australia'].includes(p.id)
  );
  const edgePresets = CANONICAL_EXPLORER_PRESETS.filter(
    (p) => !['uppsala-demo', 'nyeri-kenya', 'wagga-australia'].includes(p.id)
  );

  return (
    <main className="min-h-screen bg-[#020611] text-slate-100">
      <div className="mx-auto max-w-[1480px] px-3 py-3 sm:px-5 lg:px-8 lg:py-4">
        {/* Compact Single-Row Top Bar: Title + Search + Primary Presets + Edge Test Selector */}
        <header className="mb-3 flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-[#071120]/90 px-3.5 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="shrink-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">
              Orbital Globe · Site & Boundary Workspace
            </p>
            <h1 className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap sm:text-xl">
              Interactive 3D Earth Explorer
            </h1>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="relative w-full sm:w-52 lg:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                data-testid="explorer-search-input"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setRemoteResults([]);
                  setRemoteStatusNotice(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchResults.length === 0 && searchQuery.trim().length >= 2) {
                    e.preventDefault();
                    void handleRemoteGeocodeLookup();
                  }
                }}
                placeholder="Search site or lon, lat..."
                aria-label="Search site name or coordinates"
                className="w-full rounded-xl border border-white/15 bg-[#030816] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
              />
              {(searchResults.length > 0 || remoteResults.length > 0 || searchQuery.trim().length >= 2) && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-xl border border-white/15 bg-[#071326] p-1 shadow-2xl space-y-1"
                >
                  {searchResults.map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        const match = resolveExplorerPreset(res.presetKey ?? res.id);
                        if (match) {
                          applyPreset(match);
                        } else {
                          handleSelectCustomPoint(res.coordinates, `${res.label}, ${res.country}`);
                          setZoomLevel(12.6);
                        }
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-sky-500/20"
                    >
                      <span className="font-medium text-white">{res.label}</span>
                      <span className="font-mono text-[10px] text-sky-300">{res.country}</span>
                    </button>
                  ))}
                  {remoteResults.length > 0 && (
                    <div className="border-t border-white/10 pt-1">
                      <p className="px-2 py-0.5 font-mono text-[10px] uppercase text-sky-300">
                        {enMsgs.explorerSearch.remoteSectionHeading}
                      </p>
                      {remoteResults.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            handleSelectCustomPoint([r.lon, r.lat], r.label);
                            setZoomLevel(
                              typeof r.zoomHint === 'number'
                                ? Math.min(15.5, Math.max(11.5, r.zoomHint))
                                : 12.8
                            );
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-sky-500/20"
                        >
                          <span className="font-medium text-white truncate">{r.label}</span>
                          <span className="shrink-0 pl-2 font-mono text-[10px] text-emerald-300">
                            {r.attribution || r.country || 'WGS84'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {searchQuery.trim().length >= 2 && (
                    <div className="border-t border-white/10 pt-1 px-1 pb-0.5 space-y-1">
                      <button
                        type="button"
                        data-testid="explorer-remote-geocode-btn"
                        disabled={isRemoteSearching}
                        onClick={() => void handleRemoteGeocodeLookup()}
                        className="flex w-full items-center justify-between rounded-lg border border-sky-400/25 bg-sky-500/10 px-2.5 py-1.5 text-left text-[11px] font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
                      >
                        <span>{enMsgs.explorerSearch.remoteLookupAction}</span>
                        <span className="font-mono text-[10px] text-sky-300">/api/geocode</span>
                      </button>
                      {remoteStatusNotice && (
                        <p
                          data-testid="explorer-remote-geocode-status"
                          className="px-1.5 py-1 text-[10px] leading-snug text-amber-200"
                        >
                          {remoteStatusNotice}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile: one familiar selector; desktop: visible reference-site shortcuts.
                This keeps all sites accessible without horizontal control clutter. */}
            <div className="sm:hidden flex items-center gap-2">
              <label htmlFor="explorer-mobile-site" className="shrink-0 text-xs font-mono text-slate-300">Location</label>
              <select
                id="explorer-mobile-site"
                data-testid="explorer-mobile-site-select"
                value={CANONICAL_EXPLORER_PRESETS.some((p) => p.id === selectedSiteKey) ? selectedSiteKey : ''}
                onChange={(event) => {
                  const preset = resolveExplorerPreset(event.target.value);
                  if (preset) applyPreset(preset, 11.4);
                }}
                className="min-w-0 min-h-[44px] w-full rounded-xl border border-white/20 bg-[#030816] px-3 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                <option value="" disabled>Custom inspection point</option>
                <optgroup label="Featured regions">
                  {primaryPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Other reference locations">
                  {edgePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div
              className="hidden sm:flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5"
              role="group"
              aria-label="Reference site presets"
            >
              {primaryPresets.map((preset) => {
                const isSelected = selectedSiteKey === preset.id;
                const shortLabel =
                  preset.id === 'uppsala-demo'
                    ? 'Uppsala Demo (SE)'
                    : preset.id === 'nyeri-kenya'
                      ? 'Nyeri (KE)'
                      : 'Wagga (AU)';
                return (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`preset-btn-${preset.id}`}
                    title={preset.name}
                    onClick={() => applyPreset(preset, 11.4)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                      isSelected
                        ? 'border-sky-400 bg-sky-500/20 text-white'
                        : 'border-white/15 bg-[#030816] text-slate-300 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    <MapPin className="h-3 w-3 text-sky-300" />
                    <span>{shortLabel}</span>
                  </button>
                );
              })}

              <select
                aria-label="Global boundary edge-case test sites"
                data-testid="explorer-edge-preset-select"
                value={edgePresets.some((p) => p.id === selectedSiteKey) ? selectedSiteKey : ''}
                onChange={(e) => {
                  const chosen = resolveExplorerPreset(e.target.value);
                  if (chosen) applyPreset(chosen, 6.2);
                }}
                className="shrink-0 rounded-xl border border-white/15 bg-[#030816] px-2 py-1.5 text-xs text-slate-300 focus:border-sky-400 focus:outline-none"
              >
                <option value="">Edge Test Sites...</option>
                {edgePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </header>

        {/* Map-First 12-Col Layout: 3D Globe Left (Always Visible Above the Fold on Mobile & Desktop), Inspector Right */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {/* Left 8 Cols: True 3D Globe + Zoom Scale & Basemap Controls */}
          <section className="space-y-2.5 lg:col-span-8" aria-label="Interactive 3D Earth viewport">
            <MapLibreGlobeCanvas
              selectedCoords={selectedCoords}
              zoomLevel={zoomLevel}
              polygon={polygon}
              activeLayerId={activeLayerId}
              isDrawingMode={isDrawingMode}
              drawingVertices={drawingVertices}
              selectedVertexIndex={selectedVertexIndex}
              onSelectVertexIndex={setSelectedVertexIndex}
              onUpdateVertexCoord={handleUpdateVertexCoord}
              onInsertVertexAfter={handleInsertVertexAfter}
              onDeleteVertex={handleDeleteVertex}
              onSelectPoint={(coords) => handleSelectCustomPoint(coords)}
              onAddDrawingVertex={handleAddDrawingVertex}
              onToggleDrawingMode={() => {
                if (!isDrawingMode && zoomLevel < VERTEX_EDIT_MIN_ZOOM) {
                  setInspectorTab('BOUNDARY');
                  setBoundaryError(
                    `Zoom to field scale (>= z${VERTEX_EDIT_MIN_ZOOM.toFixed(1)}, currently z${zoomLevel.toFixed(1)}) before drawing boundaries.`
                  );
                  return;
                }
                setBoundaryError(null);
                setIsDrawingMode((prev) => !prev);
              }}
              onCompleteDrawing={handleCompleteDrawing}
              onUndoVertex={handleUndoVertex}
              onClearPolygon={handleClearPolygon}
              reducedMotion={reducedMotion}
              basemapMode={basemapMode}
              onBasemapModeChange={setBasemapMode}
              onZoomLevelSync={setZoomLevel}
              onRenderStatusChange={setMapRenderStatus}
              capabilityOverlayEnabled={capabilityOverlayEnabled}
              onToggleCapabilityOverlay={() => setCapabilityOverlayEnabled((v) => !v)}
              capabilityGeoJson={capabilityGeoJson}
              capabilityToast={capabilityToast}
              onDismissCapabilityToast={() => setCapabilityToast(null)}
            />

            {/* Mobile shows one concise visual-settings disclosure. Desktop retains
                direct zoom and layer controls for power users. */}
            <div className="rounded-2xl border border-white/10 bg-[#071120]/90 px-3 py-2 text-xs">
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs text-sky-100 sm:hidden focus-visible:outline-2 focus-visible:outline-sky-400"
                aria-expanded={showMobileMapSettings}
                aria-controls="explorer-map-view-settings"
                onClick={() => setShowMobileMapSettings((previous) => !previous)}
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-sky-300" />
                  Map view · {basemapMode === 'SATELLITE_HYBRID' ? 'Satellite' : basemapMode === 'VECTOR_MAP' ? 'Vector' : 'Offline'} · z{zoomLevel.toFixed(1)}
                </span>
                <span className="font-mono text-sky-300">{showMobileMapSettings ? 'Hide' : 'Adjust'}</span>
              </button>
              <div id="explorer-map-view-settings" className={`${showMobileMapSettings ? 'flex' : 'hidden'} sm:flex flex-wrap items-center justify-between gap-2`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  <Globe2 className="h-3.5 w-3.5 text-sky-400" />
                  Scale:
                </span>
                {ZOOM_JOURNEY_STOPS.map((stop) => {
                  const active = Math.abs(zoomLevel - stop.zoom) < 1.6;
                  return (
                    <button
                      key={stop.id}
                      type="button"
                      data-testid={`zoom-stop-${stop.id}`}
                      onClick={() => setZoomLevel(stop.zoom)}
                      className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                        active
                          ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {stop.label} (z{stop.zoom})
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#030816] p-0.5 text-[11px]">
                  {(
                    [
                      { id: 'SATELLITE_HYBRID', label: 'Satellite' },
                      { id: 'VECTOR_MAP', label: 'Vector' },
                      { id: 'OFFLINE_NATURAL_EARTH', label: 'Offline CC0' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`basemap-${item.id.toLowerCase()}-btn`}
                      onClick={() => setBasemapMode(item.id)}
                      className={`rounded-lg px-2 py-1 font-medium transition ${
                        basemapMode === item.id
                          ? 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-400/50'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="hidden font-mono text-[10px] text-sky-300 xl:inline">
                  {mapRenderStatus}
                </span>
              </div>
              </div>
              {/* Attribution must remain visible even when optional controls are collapsed. */}
              <p className="mt-1 w-full text-[10px] text-slate-400 xl:hidden">
                Historical Imagery: EOxCloudless 2016 (CC BY 4.0 mosaic) · Copernicus Sentinel-2 · © OpenFreeMap / OSM · NASA GIBS · Natural Earth (CC0) — not live today&apos;s pixels
              </p>
            </div>
          </section>

          {/* Right 4 Cols: Site Scope, Coordinates, Boundary Vertex Editor, EO Layers */}
          <aside className="space-y-3 lg:col-span-4" aria-label="Site inspection controls">
            {/* Active Site Summary & Truthful Isolation Banner */}
            <div className="rounded-2xl border border-white/10 bg-[#071120]/95 p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    {countryCode} · {regionName}
                  </span>
                  <h2 className="text-base font-bold text-white" data-testid="explorer-active-site-title">
                    {siteTitle}
                  </h2>
                </div>
                <CoverageStatusBadge
                  status={
                    selectedSiteKey === 'uppsala-demo'
                      ? hasUserEditedGeometry
                        ? 'INSUFFICIENT_EVIDENCE'
                        : 'CONDITIONAL'
                      : activePreset && ['nyeri-kenya', 'wagga-australia'].includes(activePreset.id)
                        ? 'CONDITIONAL'
                        : 'INSUFFICIENT_EVIDENCE'
                  }
                />
              </div>

              {/* Explicit 3-Axis Scientific Separation: Source Coverage vs Agronomic Model vs Field Eligibility */}
              {capabilityCheck && (
                <div
                  data-testid="explorer-capability-status"
                  className="rounded-xl border border-white/15 bg-[#030816] px-3 py-2 text-[11px] flex items-center justify-between gap-2"
                >
                  <span className="text-slate-300 font-medium">{capabilityCheck.headline}</span>
                  <span className="font-mono text-[10px] text-sky-300 shrink-0">{capabilityCheck.status}</span>
                </div>
              )}

              <div
                data-testid="explorer-three-axis-status"
                className="rounded-xl border border-white/10 bg-[#030816] p-3 space-y-2 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono uppercase tracking-wider text-slate-400">
                    {complexityMode === 'SIMPLE' ? 'Satellite & Weather Sources' : 'SOURCE_DATA_COVERAGE'}
                  </span>
                  <span className="font-mono font-semibold text-sky-300">
                    {selectedSiteKey === 'uppsala-demo' && !hasUserEditedGeometry
                      ? complexityMode === 'SIMPLE'
                        ? 'Synthetic Demo Series'
                        : 'SYNTHETIC_DEMO_REPRESENTATION'
                      : activePreset && ['nyeri-kenya', 'wagga-australia'].includes(activePreset.id)
                        ? complexityMode === 'SIMPLE'
                          ? 'Gridded Context Only'
                          : 'PARTIAL (POWER · IMERG · SMAP · HLS)'
                        : selectedSiteKey === 'polar-svalbard'
                          ? complexityMode === 'SIMPLE'
                            ? 'Polar Optical Gap (>60°N)'
                            : 'CONDITIONAL / UNKNOWN_WINTER_HLS'
                          : complexityMode === 'SIMPLE'
                            ? 'Not Yet Evaluated Here'
                            : 'UNKNOWN (UNVERIFIED_COORDINATE)'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5">
                  <span className="font-mono uppercase tracking-wider text-slate-400">
                    {complexityMode === 'SIMPLE' ? 'Crop & Water Simulation' : 'AGRONOMIC_MODEL_QUALIFICATION'}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      isUppsalaDomain ? 'text-amber-300' : 'text-rose-300'
                    }`}
                  >
                    {selectedSiteKey === 'uppsala-demo'
                      ? hasUserEditedGeometry
                        ? 'ANALYSIS_NOT_RUN (EDITED)'
                        : complexityMode === 'SIMPLE'
                          ? 'Demo Preview (Uppsala)'
                          : 'SYNTHETIC_UI_DEMO_ONLY'
                      : complexityMode === 'SIMPLE'
                        ? 'Not Qualified Here'
                        : 'MODEL_UNQUALIFIED'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5">
                  <span className="font-mono uppercase tracking-wider text-slate-400">
                    {complexityMode === 'SIMPLE' ? 'Real Farm Advice' : 'FIELD_RECOMMENDATION_ELIGIBILITY'}
                  </span>
                  <span className="font-mono font-semibold text-rose-300">
                    {complexityMode === 'SIMPLE' ? 'Blocked (Showcase Only)' : 'BLOCKED'}
                  </span>
                </div>
              </div>

              {!isUppsalaDomain && (
                <div
                  role="note"
                  className="flex items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-950/40 p-2.5 text-xs text-amber-100"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>
                    <strong className="font-semibold">
                      {hasUserEditedGeometry && selectedSiteKey === 'uppsala-demo'
                        ? 'Modified Boundary Isolation:'
                        : 'Fail-Closed Domain Isolation:'}
                    </strong>{' '}
                    {hasUserEditedGeometry && selectedSiteKey === 'uppsala-demo'
                      ? 'You modified the Uppsala field boundary. Saving opens an isolated custom draft with Uppsala demo results blocked until backend analysis runs.'
                      : `Global EO channels here inspect regional metadata only (or mark unevaluated coordinates UNKNOWN). Swedish M14 decision metrics are strictly isolated from ${siteTitle}.`}
                  </span>
                </div>
              )}

              {isUppsalaDomain && (
                <div className="flex items-start gap-2 rounded-xl border border-sky-400/30 bg-sky-950/35 p-2.5 text-xs text-sky-100">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                  <span>
                    {complexityMode === 'SIMPLE'
                      ? 'Uppsala showcase active (F1–F3 = 24.0 ha modeled parcels). Preview box on map (~34.2 ha) is an illustrative domain footprint.'
                      : `Uppsala reference domain active in ${datasetMode} mode (16 tested policies × 9 scenarios = 144 cases; 0 of 12 comparable pass all 9 states across F1–F3 = 24.0 ha).`}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-[#030816] px-2.5 py-2">
                  <div className="text-[10px] uppercase text-slate-400">WGS84 Center</div>
                  <div className="font-mono text-white">
                    {selectedCoords[1].toFixed(4)}°, {selectedCoords[0].toFixed(4)}°
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#030816] px-2.5 py-2">
                  <div className="text-[10px] uppercase text-slate-400">
                    {isUppsalaDomain ? 'Preview Box Area' : 'Estimated Field Area'}
                  </div>
                  <div className="font-mono text-emerald-300">
                    {estimatedAreaHa !== null ? formatAreaWithUnit(estimatedAreaHa, unitMode) : 'Point only'}
                  </div>
                  {isUppsalaDomain && (
                    <div className="text-[10px] text-amber-200/90 mt-0.5">
                      Model parcels F1–F3 = 24.0 ha
                    </div>
                  )}
                </div>
              </div>

              {/* Inspector Tabs */}
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#030816] p-1 text-xs">
                {(
                  [
                    { id: 'COORDS', label: 'Coordinates', Icon: Compass },
                    { id: 'BOUNDARY', label: 'Boundary', Icon: PenTool },
                    { id: 'LAYERS', label: 'EO Layers', Icon: Layers },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`inspector-tab-${id.toLowerCase()}`}
                    onClick={() => setInspectorTab(id)}
                    className={`flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-medium transition ${
                      inspectorTab === id
                        ? 'bg-sky-500/25 text-white ring-1 ring-sky-400/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Tab 1: Coordinates / DMS / GeoJSON */}
              {inspectorTab === 'COORDS' && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                    <div className="flex flex-wrap gap-1.5">
                      {(['DECIMAL', 'DMS', 'GEOJSON'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCoordEntryMode(mode)}
                          className={`rounded-lg px-2.5 py-1 font-medium transition ${
                            coordEntryMode === mode
                              ? 'bg-white/15 text-white'
                              : 'bg-white/5 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {mode === 'DECIMAL' ? 'Decimal Lon/Lat' : mode === 'DMS' ? 'DMS' : 'GeoJSON File / Paste'}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      data-testid="explorer-geolocate-btn"
                      onClick={handleUseBrowserLocation}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/20"
                      title="Center globe on your device GPS/network coordinates (user opt-in)"
                    >
                      <Compass className="h-3 w-3" />
                      <span>Use My Location</span>
                    </button>
                  </div>

                  {coordEntryMode === 'DECIMAL' && (
                    <form onSubmit={handleApplyDecimalCoords} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1 text-[11px] text-slate-300">
                          <span>Longitude [-180, 180]</span>
                          <input
                            type="text"
                            data-testid="explorer-coord-lon"
                            value={lonInput}
                            onChange={(e) => setLonInput(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-[#030816] px-2.5 py-1.5 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                        <label className="block space-y-1 text-[11px] text-slate-300">
                          <span>Latitude [-90, 90]</span>
                          <input
                            type="text"
                            data-testid="explorer-coord-lat"
                            value={latInput}
                            onChange={(e) => setLatInput(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-[#030816] px-2.5 py-1.5 font-mono text-xs text-white focus:border-sky-400 focus:outline-none"
                          />
                        </label>
                      </div>
                      <button
                        type="submit"
                        data-testid="explorer-apply-coords-btn"
                        className="w-full rounded-xl bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/40 transition hover:bg-sky-500/30"
                      >
                        Fly Globe to Coordinate
                      </button>
                    </form>
                  )}

                  {coordEntryMode === 'DMS' && (
                    <form onSubmit={handleApplyDmsCoords} className="space-y-2.5">
                      <label className="block space-y-1 text-[11px] text-slate-300">
                        <span>Longitude DMS</span>
                        <input
                          type="text"
                          data-testid="explorer-dms-lon"
                          value={dmsLonInput}
                          onChange={(e) => setDmsLonInput(e.target.value)}
                          placeholder='-17° 30&#39; 00" or 17° 38&#39; 24" E'
                          className="w-full rounded-lg border border-white/15 bg-[#030816] px-2.5 py-1.5 font-mono text-xs text-white"
                        />
                      </label>
                      <label className="block space-y-1 text-[11px] text-slate-300">
                        <span>Latitude DMS</span>
                        <input
                          type="text"
                          data-testid="explorer-dms-lat"
                          value={dmsLatInput}
                          onChange={(e) => setDmsLatInput(e.target.value)}
                          placeholder='-12° 20&#39; 00" or 59° 51&#39; 36" N'
                          className="w-full rounded-lg border border-white/15 bg-[#030816] px-2.5 py-1.5 font-mono text-xs text-white"
                        />
                      </label>
                      <button
                        type="submit"
                        data-testid="explorer-apply-dms-btn"
                        className="w-full rounded-xl bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/30"
                      >
                        Convert DMS & Fly Globe
                      </button>
                    </form>
                  )}

                  {coordEntryMode === 'GEOJSON' && (
                    <form onSubmit={handleApplyGeoJson} className="space-y-2.5">
                      <label className="block space-y-1 text-[11px] text-slate-300">
                        <span>Upload Local GeoJSON File (.geojson / .json)</span>
                        <input
                          type="file"
                          accept=".geojson,.json,application/geo+json,application/json"
                          data-testid="explorer-geojson-file-input"
                          onChange={handleGeoJsonFileUpload}
                          className="block w-full rounded-lg border border-dashed border-white/25 bg-[#030816] px-2.5 py-2 text-[11px] text-slate-300 file:mr-2.5 file:rounded-md file:border-0 file:bg-sky-500/20 file:px-2.5 file:py-1 file:text-[11px] file:font-semibold file:text-sky-200 hover:file:bg-sky-500/30"
                        />
                      </label>
                      <textarea
                        rows={4}
                        data-testid="explorer-geojson-input"
                        value={geoJsonInput}
                        onChange={(e) => setGeoJsonInput(e.target.value)}
                        placeholder='{"type":"Polygon","coordinates":[[[17.63,59.85],[17.65,59.85],[17.65,59.86],[17.63,59.86],[17.63,59.85]]]}'
                        className="w-full rounded-lg border border-white/15 bg-[#030816] p-2 font-mono text-[11px] text-white"
                      />
                      <button
                        type="submit"
                        data-testid="explorer-apply-geojson-btn"
                        className="w-full rounded-xl bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/40 hover:bg-emerald-500/30"
                      >
                        Validate & Load GeoJSON Polygon
                      </button>
                    </form>
                  )}

                  {coordError && (
                    <div
                      role="alert"
                      data-testid="explorer-coord-error"
                      className="flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-950/60 p-2.5 text-xs text-rose-100"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                      <span>{coordError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Field Boundary & Accessible Vertex Coordinates */}
              {inspectorTab === 'BOUNDARY' && (
                <div className="space-y-2.5 pt-1 text-xs">
                  <p className="text-slate-300">
                    Click <strong className="text-white">Draw Field Boundary</strong> on the map at local
                    zoom (&ge; z{VERTEX_EDIT_MIN_ZOOM}), drag existing vertices, or edit corner coordinates below:
                  </p>
                  {zoomLevel < VERTEX_EDIT_MIN_ZOOM && (
                    <div
                      data-testid="explorer-zoom-lock-notice"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/35 bg-amber-950/40 p-2.5 text-[11px] text-amber-100"
                    >
                      <span>
                        Map click-drawing is locked at orbital scale (z{zoomLevel.toFixed(1)} &lt; z
                        {VERTEX_EDIT_MIN_ZOOM}).
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setZoomLevel(12.5);
                          setBoundaryError(null);
                        }}
                        className="rounded-lg bg-amber-400 px-2.5 py-1 font-semibold text-slate-950 hover:bg-amber-300"
                      >
                        Zoom to Field Level
                      </button>
                    </div>
                  )}
                  {drawingVertices.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-[#030816] p-3 text-center text-slate-400">
                      No parcel polygon active. Click Draw Field Boundary on the map to trace a boundary.
                    </div>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                      {drawingVertices.map(([vx, vy], idx) => (
                        <div
                          key={idx}
                          className={`grid grid-cols-[auto_1fr_1fr] items-center gap-1.5 rounded-lg border p-1.5 ${
                            selectedVertexIndex === idx
                              ? 'border-amber-400/50 bg-amber-950/20'
                              : 'border-white/10 bg-[#030816]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedVertexIndex(idx)}
                            className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-200"
                          >
                            V{idx + 1}
                          </button>
                          <input
                            type="number"
                            step="0.0001"
                            aria-label={`Vertex ${idx + 1} longitude`}
                            value={Number(vx.toFixed(5))}
                            onChange={(e) => {
                              const nextLon = Number(e.target.value);
                              if (Number.isFinite(nextLon) && nextLon >= -180 && nextLon <= 180) {
                                handleUpdateVertexCoord(idx, [nextLon, vy]);
                              }
                            }}
                            className="w-full rounded border border-white/10 bg-[#071120] px-1.5 py-1 font-mono text-[11px] text-white"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            aria-label={`Vertex ${idx + 1} latitude`}
                            value={Number(vy.toFixed(5))}
                            onChange={(e) => {
                              const nextLat = Number(e.target.value);
                              if (Number.isFinite(nextLat) && nextLat >= -90 && nextLat <= 90) {
                                handleUpdateVertexCoord(idx, [vx, nextLat]);
                              }
                            }}
                            className="w-full rounded border border-white/10 bg-[#071120] px-1.5 py-1 font-mono text-[11px] text-white"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {boundaryError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl border border-rose-400/40 bg-rose-950/60 p-2 text-xs text-rose-100"
                    >
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
                      <span>{boundaryError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Honest EO Overlay & Source Evidence */}
              {inspectorTab === 'LAYERS' && (
                <div className="space-y-2.5 pt-1 text-xs">
                  <div className="space-y-1.5">
                    {Object.values(EO_OVERLAY_CATALOG).map((layer) => {
                      const active = activeLayerId === layer.id;
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          onClick={() => setActiveLayerId(layer.id)}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                            active
                              ? 'border-sky-400 bg-sky-500/15 text-white'
                              : 'border-white/10 bg-[#030816] text-slate-300 hover:border-white/25'
                          }`}
                        >
                          <div>
                            <div className="font-medium">{layer.shortLabel}</div>
                            <div className="text-[10px] text-slate-400">{layer.spatialResolution}</div>
                          </div>
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: layer.accentHex }}
                          />
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-[#030816] p-2.5 text-[11px] leading-relaxed text-slate-300">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-white">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-sky-300" />
                      <span>Spatial Support Disclosure</span>
                    </div>
                    <p>{activeLayerSpec.disclosure}</p>
                    <div className="mt-2">
                      <ViewEvidenceButton evidenceId={activeEvidenceId} siteId={selectedSiteKey} />
                    </div>
                  </div>
                </div>
              )}

              {actionNotice && (
                <p className="text-[11px] leading-relaxed text-slate-300">{actionNotice}</p>
              )}

              {/* Workspace Action Buttons */}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-1">
                <button
                  type="button"
                  data-testid="open-farm-results-btn"
                  onClick={handleOpenResultsWorkspace}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-sky-300"
                >
                  <span>{isUppsalaDomain ? 'Open Uppsala Research Results' : 'Inspect Site Coverage & Isolation'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="open-farm-workspace-btn"
                  onClick={handleOpenSetupWizard}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
                >
                  <span>Edit 5-Step Field Setup</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
