'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  Footprints,
  Pause,
  Pencil,
  Play,
  Redo2,
  Sparkles,
  Square,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { FieldGeometrySource, UserFieldDraft } from '@/domain/contracts';
import type { SiteCapabilityCheckResult } from '@/domain/capability-overlay';
import { IS_STATIC_SHOWCASE } from '@/lib/base-path';
import {
  computeGeodesicMetrics,
  evaluateGpsPerimeterSample,
  importFieldBoundaryText,
  validatePolygonGeometry,
} from '@/lib/geometry-validation';
import {
  MapLibreGlobeCanvas,
  type CapabilityToastNotice,
} from '@/components/maps/maplibre-globe-canvas';
import type { MapBasemapMode } from '@/components/maps/map-providers';
import type { SuggestedFieldBoundary } from '@/server/ftw-boundary-service';

const SOURCE_LABELS: Record<FieldGeometrySource, string> = {
  USER_DRAWN: 'Manual vertices',
  USER_RECTANGLE_APPROX: 'Approximate rectangle',
  USER_GPS_TRACE: 'Phone GPS walk',
  USER_IMPORT: 'Imported boundary file',
  AI_PREDICTION_FTW: 'FTW satellite outline (confirmed)',
  REFERENCE_PRESET: 'Reference site outline',
};

function getPolygonCentroid(
  geom?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): [number, number] | null {
  if (!geom) return null;
  const ring =
    geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates[0]?.[0]
        : null;
  if (!ring || ring.length < 3) return null;
  const open = ring.length >= 4 ? ring.slice(0, -1) : ring;
  let lonSum = 0;
  let latSum = 0;
  for (const pt of open) {
    lonSum += pt[0] ?? 0;
    latSum += pt[1] ?? 0;
  }
  return [
    Number((lonSum / open.length).toFixed(5)),
    Number((latSum / open.length).toFixed(5)),
  ];
}

interface SmartFieldEditorProps {
  siteCoords: [number, number];
  locationLabel: string;
  locationSelected: boolean;
  farmId: string;
  activeField: UserFieldDraft;
  activeFieldIndex: number;
  unitMode: 'SI_METRIC' | 'SI_WITH_ACRE_GALLON_EQUIV';
  reducedMotion: boolean;
  onSelectSitePoint: (coords: [number, number]) => void;
  onUpdateFieldGeometry: (params: {
    fieldIndex: number;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
    areaHa: number | null;
    perimeterMeters: number | null;
    geometrySource: FieldGeometrySource;
    sourceDataset?: string | null;
    sourceYear?: number | null;
    modelConfidence?: number | null;
    userConfirmed?: boolean;
  }) => void;
  onGenerateApproxRectangle: (fieldIndex: number) => void;
  capabilityOverlayEnabled: boolean;
  onToggleCapabilityOverlay: () => void;
  capabilityGeoJson: GeoJSON.FeatureCollection | null;
  capabilityCheck: SiteCapabilityCheckResult | null;
  capabilityToast: CapabilityToastNotice | null;
  onClickCapabilityFeature?: (notice: CapabilityToastNotice) => void;
  onDismissCapabilityToast: () => void;
  mode: 'LOCATION_PICKER' | 'FIELD_EDITOR';
  mapZoomOverride?: number;
}

export function SmartFieldEditor({
  siteCoords,
  locationLabel,
  locationSelected,
  farmId: _farmId,
  activeField,
  activeFieldIndex,
  reducedMotion,
  onSelectSitePoint,
  onUpdateFieldGeometry,
  onGenerateApproxRectangle,
  capabilityOverlayEnabled,
  onToggleCapabilityOverlay,
  capabilityGeoJson,
  capabilityCheck,
  capabilityToast,
  onClickCapabilityFeature,
  onDismissCapabilityToast,
  mode,
  mapZoomOverride,
}: SmartFieldEditorProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(() =>
    mapZoomOverride ?? (locationSelected ? (mode === 'FIELD_EDITOR' ? 14.5 : 10.5) : 1.8)
  );
  const [basemapMode, setBasemapMode] = useState<MapBasemapMode>('SATELLITE_HYBRID');
  const [isDrawingMode, setIsDrawingMode] = useState(false);

  const initialVertices = useMemo(() => {
    const geom = activeField.geometry;
    if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
      return geom.coordinates[0].slice(0, -1).map((c) => [c[0]!, c[1]!] as [number, number]);
    }
    return [] as [number, number][];
  }, [activeField.geometry]);

  const [drawingVertices, setDrawingVertices] = useState<[number, number][]>(initialVertices);
  const [undoStack, setUndoStack] = useState<[number, number][][]>([]);
  const [redoStack, setRedoStack] = useState<[number, number][][]>([]);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | undefined>(
    initialVertices.length > 0 ? 0 : undefined
  );

  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);

  // Independent field-query pin (never shifts farm location center)
  const [fieldInteriorPin, setFieldInteriorPin] = useState<[number, number] | null>(() =>
    getPolygonCentroid(activeField.geometry)
  );

  // FTW boundary suggestion state
  const [ftwBusy, setFtwBusy] = useState(false);
  const [ftwSuggestion, setFtwSuggestion] = useState<SuggestedFieldBoundary | null>(null);
  const [ftwMessage, setFtwMessage] = useState<string | null>(null);

  // Phone GPS perimeter trace state
  const [gpsWalking, setGpsWalking] = useState(false);
  const [gpsPaused, setGpsPaused] = useState(false);
  const [gpsSamples, setGpsSamples] = useState<Array<{ coord: [number, number]; timestampMs: number }>>([]);
  const [gpsLastAccuracy, setGpsLastAccuracy] = useState<number | null>(null);
  const [gpsStatusText, setGpsStatusText] = useState<string | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);

  // Import file / paste state
  const [importPasteText, setImportPasteText] = useState('');
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Synchronize vertices only when switching fields or when geometry changes externally
  const lastInternalGeomKeyRef = useRef<string>(JSON.stringify(activeField.geometry ?? null));
  const lastFieldIdRef = useRef<string>(activeField.id);
  useEffect(() => {
    const geomKey = JSON.stringify(activeField.geometry ?? null);
    if (lastFieldIdRef.current !== activeField.id || lastInternalGeomKeyRef.current !== geomKey) {
      const switchedField = lastFieldIdRef.current !== activeField.id;
      lastFieldIdRef.current = activeField.id;
      lastInternalGeomKeyRef.current = geomKey;
      setDrawingVertices(initialVertices);
      setSelectedVertexIndex(initialVertices.length > 0 ? 0 : undefined);
      setUndoStack([]);
      setRedoStack([]);
      if (switchedField) {
        setFieldInteriorPin(getPolygonCentroid(activeField.geometry));
      }
    }
  }, [activeField.id, activeField.geometry, initialVertices]);

  const siteLon = siteCoords[0];
  const siteLat = siteCoords[1];
  useEffect(() => {
    if (locationSelected) {
      setZoomLevel(mapZoomOverride ?? (mode === 'FIELD_EDITOR' ? 14.5 : 11.5));
    }
  }, [siteLon, siteLat, locationSelected, mode, mapZoomOverride]);

  useEffect(() => {
    return () => {
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  const pushVertexHistory = (prevVerts: [number, number][]) => {
    setUndoStack((s) => [...s.slice(-24), prevVerts]);
    setRedoStack([]);
  };

  const commitVerticesAsPolygon = (
    verts: [number, number][],
    geomSource: FieldGeometrySource = 'USER_DRAWN',
    meta?: { dataset?: string | null; year?: number | null; confidence?: number | null; confirmed?: boolean }
  ) => {
    if (verts.length < 3) {
      setEditorError('Add at least 3 corners to form a closed field polygon.');
      return false;
    }
    const poly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[...verts, verts[0]!]],
    };
    const check = validatePolygonGeometry(poly);
    if (!check.valid || !check.metrics) {
      setEditorError(check.errors.join(' '));
      return false;
    }
    setEditorError(null);
    lastInternalGeomKeyRef.current = JSON.stringify(poly);
    onUpdateFieldGeometry({
      fieldIndex: activeFieldIndex,
      geometry: poly,
      areaHa: check.metrics.areaHa,
      perimeterMeters: check.metrics.perimeterMeters,
      geometrySource: geomSource,
      sourceDataset: meta?.dataset ?? SOURCE_LABELS[geomSource],
      sourceYear: meta?.year ?? null,
      modelConfidence: meta?.confidence ?? null,
      userConfirmed: meta?.confirmed ?? true,
    });
    if (check.warnings.length > 0) {
      setEditorNotice(check.warnings.join(' '));
    }
    return true;
  };

  const ftwAbortRef = useRef<AbortController | null>(null);

  const handleCancelFtwSuggestion = () => {
    if (ftwAbortRef.current) {
      ftwAbortRef.current.abort();
      ftwAbortRef.current = null;
    }
    setFtwBusy(false);
    setFtwMessage('Field-boundary search canceled. You can draw corners manually or try again.');
  };

  const handleToggleDraw = () => {
    if (ftwAbortRef.current) {
      ftwAbortRef.current.abort();
      ftwAbortRef.current = null;
      setFtwBusy(false);
    }
    setEditorError(null);
    if (!isDrawingMode) {
      if (zoomLevel < 11.0) {
        setZoomLevel(14.5);
      }
      setIsDrawingMode(true);
      setEditorNotice('Tap or click each field corner on the satellite map, then click Done.');
    } else {
      setIsDrawingMode(false);
    }
  };

  const handleAddVertex = (coord: [number, number]) => {
    if (zoomLevel < 8.0) {
      setEditorError('Zoom in closer before placing field corners.');
      return;
    }
    setEditorError(null);
    pushVertexHistory(drawingVertices);
    const next = [...drawingVertices, coord];
    setDrawingVertices(next);
    setSelectedVertexIndex(next.length - 1);
  };

  const handleUpdateVertex = (idx: number, nextCoord: [number, number]) => {
    setDrawingVertices((prev) => {
      const updated = prev.map((pt, i) => (i === idx ? nextCoord : pt));
      if (activeField.geometry?.type === 'Polygon' && updated.length >= 3) {
        const poly: GeoJSON.Polygon = {
          type: 'Polygon',
          coordinates: [[...updated, updated[0]!]],
        };
        const topo = validatePolygonGeometry(poly);
        if (topo.valid && topo.metrics) {
          setEditorError(null);
          lastInternalGeomKeyRef.current = JSON.stringify(poly);
          onUpdateFieldGeometry({
            fieldIndex: activeFieldIndex,
            geometry: poly,
            areaHa: topo.metrics.areaHa,
            perimeterMeters: topo.metrics.perimeterMeters,
            geometrySource: 'USER_DRAWN',
            userConfirmed: true,
          });
        } else {
          setEditorError(topo.errors[0] ?? 'Edges cross cleanly undo or move corner.');
        }
      }
      return updated;
    });
  };

  const handleInsertVertexAfter = (edgeIdx: number, midpoint: [number, number]) => {
    if (drawingVertices.length < 3) return;
    pushVertexHistory(drawingVertices);
    const next = [
      ...drawingVertices.slice(0, edgeIdx + 1),
      midpoint,
      ...drawingVertices.slice(edgeIdx + 1),
    ];
    setDrawingVertices(next);
    setSelectedVertexIndex(edgeIdx + 1);
    commitVerticesAsPolygon(next, 'USER_DRAWN');
  };

  const handleDeleteVertex = (vertexIdx: number) => {
    if (drawingVertices.length <= 3) {
      setEditorError('A closed field boundary requires at least 3 corners.');
      return;
    }
    pushVertexHistory(drawingVertices);
    const next = drawingVertices.filter((_, i) => i !== vertexIdx);
    setDrawingVertices(next);
    setSelectedVertexIndex(Math.max(0, vertexIdx - 1));
    commitVerticesAsPolygon(next, 'USER_DRAWN');
  };

  const handleUndo = () => {
    if (undoStack.length > 0) {
      const prev = undoStack[undoStack.length - 1]!;
      setRedoStack((r) => [...r, drawingVertices]);
      setUndoStack((u) => u.slice(0, -1));
      setDrawingVertices(prev);
      if (prev.length >= 3 && activeField.geometry) {
        commitVerticesAsPolygon(prev, 'USER_DRAWN');
      }
      return;
    }
    if (drawingVertices.length > 0) {
      const next = drawingVertices.slice(0, -1);
      setRedoStack((r) => [...r, drawingVertices]);
      setDrawingVertices(next);
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1]!;
    setUndoStack((u) => [...u, drawingVertices]);
    setRedoStack((r) => r.slice(0, -1));
    setDrawingVertices(next);
    if (next.length >= 3 && activeField.geometry) {
      commitVerticesAsPolygon(next, 'USER_DRAWN');
    }
  };

  const handleClearBoundary = () => {
    pushVertexHistory(drawingVertices);
    setDrawingVertices([]);
    setSelectedVertexIndex(undefined);
    setIsDrawingMode(false);
    setFtwSuggestion(null);
    setFieldInteriorPin(null);
    setEditorError(null);
    lastInternalGeomKeyRef.current = 'null';
    onUpdateFieldGeometry({
      fieldIndex: activeFieldIndex,
      geometry: null,
      areaHa: activeField.declaredAreaHa,
      perimeterMeters: null,
      geometrySource: 'USER_DRAWN',
      userConfirmed: false,
    });
  };

  const handleSuggestFtwBoundary = async () => {
    if (!locationSelected) {
      setFtwMessage('Select your farm location on Step 1 first so we know where to search.');
      return;
    }
    if (IS_STATIC_SHOWCASE) {
      setFtwMessage('Automatic satellite boundary lookup requires a backend proxy — tap the map or draw field corners manually below.');
      return;
    }
    if (ftwAbortRef.current) {
      ftwAbortRef.current.abort();
    }
    const controller = new AbortController();
    ftwAbortRef.current = controller;

    const targetCoords = fieldInteriorPin ?? getPolygonCentroid(activeField.geometry) ?? siteCoords;
    setFtwBusy(true);
    setFtwMessage(
      'Checking UTM zone partition & scanning FTW 2nd Edition GeoParquet row groups (indeterminate HTTP Range scan)…'
    );
    setFtwSuggestion(null);
    try {
      const res = await fetch(
        `/api/field-boundaries/suggest?lon=${encodeURIComponent(targetCoords[0])}&lat=${encodeURIComponent(targetCoords[1])}&source=FTW&year=2025`,
        { signal: controller.signal }
      );
      const body = (await res.json()) as {
        status?: string;
        detailedStatus?: string;
        notice?: string;
        suggestions?: SuggestedFieldBoundary[];
      };
      if (body.status === 'FOUND' && body.suggestions && body.suggestions.length > 0) {
        const first = body.suggestions[0]!;
        setFtwSuggestion(first);
        setFtwMessage(first.disclaimer);
        setZoomLevel(15.2);
      } else if (
        body.status === 'SEARCH_INCOMPLETE_LIMIT' ||
        body.detailedStatus === 'SEARCH_INCOMPLETE_LIMIT'
      ) {
        setFtwMessage(
          body.notice ||
            'Partial FTW boundary scan reached the query budget before all row groups could be checked. Tap directly inside your field or draw corners manually.'
        );
      } else {
        setFtwMessage(
          body.notice ||
            'No reliable field polygon found at this point yet. Tap directly inside a visible parcel or draw corners manually.'
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setFtwMessage(
        'Could not reach field-boundary suggestion service. Draw your field corners manually below.'
      );
    } finally {
      if (ftwAbortRef.current === controller) {
        ftwAbortRef.current = null;
        setFtwBusy(false);
      }
    }
  };

  const handleAcceptFtwSuggestion = () => {
    if (!ftwSuggestion) return;
    const geom = ftwSuggestion.geometry;
    if (geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
      setDrawingVertices(geom.coordinates[0].slice(0, -1).map((c) => [c[0]!, c[1]!]));
      setSelectedVertexIndex(0);
    }
    onUpdateFieldGeometry({
      fieldIndex: activeFieldIndex,
      geometry: geom,
      areaHa: ftwSuggestion.areaHa,
      perimeterMeters: ftwSuggestion.perimeterMeters,
      geometrySource: 'AI_PREDICTION_FTW',
      sourceDataset: ftwSuggestion.attribution,
      sourceYear: ftwSuggestion.sourceYear,
      modelConfidence: ftwSuggestion.modelConfidence,
      userConfirmed: true,
    });
    setEditorNotice(
      `Accepted satellite-estimated outline (${ftwSuggestion.areaHa.toFixed(2)} ha). Drag any corner handle to adjust it.`
    );
    setFtwSuggestion(null);
  };

  // Phone GPS perimeter trace controls
  const startOrResumeGpsWalk = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatusText('Device GPS is not available in this browser.');
      return;
    }
    setGpsWalking(true);
    setGpsPaused(false);
    setGpsStatusText('Listening for live GPS fixes along your field edge…');
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        setGpsLastAccuracy(Math.round(acc));
        setGpsSamples((prev) => {
          const check = evaluateGpsPerimeterSample(prev, {
            lon: pos.coords.longitude,
            lat: pos.coords.latitude,
            accuracyMeters: acc,
            timestampMs: pos.timestamp || Date.now(),
          });
          if (!check.accepted || !check.coord) {
            if (check.reason) setGpsStatusText(check.reason);
            return prev;
          }
          setGpsStatusText(
            `Recorded corner #${prev.length + 1} (±${Math.round(acc)} m accuracy · ${check.qualityTier})`
          );
          return [...prev, { coord: check.coord, timestampMs: pos.timestamp || Date.now() }];
        });
      },
      (err) => {
        setGpsStatusText(`GPS paused/unavailable: ${err.message}`);
        setGpsWalking(false);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  };

  const pauseGpsWalk = () => {
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setGpsPaused(true);
    setGpsWalking(false);
    setGpsStatusText(`Paused GPS perimeter walk (${gpsSamples.length} recorded points).`);
  };

  const finishGpsWalk = () => {
    pauseGpsWalk();
    const coords = gpsSamples.map((s) => s.coord);
    if (coords.length < 3) {
      setEditorError(
        `GPS walk has only ${coords.length} point(s); need at least 3 distinct points to form a boundary without inventing edges.`
      );
      return;
    }
    setDrawingVertices(coords);
    setSelectedVertexIndex(0);
    if (commitVerticesAsPolygon(coords, 'USER_GPS_TRACE')) {
      setEditorNotice(
        `Closed GPS walk boundary (${coords.length} points). Inspect and drag any corner to refine.`
      );
      setGpsSamples([]);
    }
  };

  const handleImportBoundary = (rawText: string, fileNameHint?: string) => {
    const res = importFieldBoundaryText(rawText, fileNameHint);
    if (!res.valid || !res.geometry || !res.metrics) {
      setEditorError(res.errors.join(' '));
      return;
    }
    setEditorError(null);
    if (res.geometry.type === 'Polygon' && Array.isArray(res.geometry.coordinates[0])) {
      setDrawingVertices(res.geometry.coordinates[0].slice(0, -1).map((c) => [c[0]!, c[1]!]));
      setSelectedVertexIndex(0);
    }
    onUpdateFieldGeometry({
      fieldIndex: activeFieldIndex,
      geometry: res.geometry,
      areaHa: res.metrics.areaHa,
      perimeterMeters: res.metrics.perimeterMeters,
      geometrySource: 'USER_IMPORT',
      sourceDataset: `Imported ${res.format}`,
      userConfirmed: true,
    });
    setZoomLevel(14.5);
    setEditorNotice(
      `Imported ${res.format} boundary (${res.metrics.areaHa.toFixed(2)} ha · ${Math.round(res.metrics.perimeterMeters)} m perimeter).${
        res.warnings.length ? ' ' + res.warnings.join(' ') : ''
      }`
    );
  };

  const handleImportFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    const text = await file.text();
    setImportPasteText(text);
    handleImportBoundary(text, file.name);
  };

  const liveMetrics = useMemo(() => {
    if (!activeField.geometry) return null;
    return computeGeodesicMetrics(activeField.geometry);
  }, [activeField.geometry]);

  const gpsPolylinePoints = useMemo(() => gpsSamples.map((s) => s.coord), [gpsSamples]);

  return (
    <div className="space-y-3" data-testid="smart-field-editor">
      {/* Live Basemap Switcher Bar above Map */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-medium text-[#AEC4D3]">
          {locationSelected ? locationLabel : 'Tap globe or search a town to center map'}
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[#29455A] bg-[#081728] p-0.5 text-[11px]">
          {(
            [
              { id: 'SATELLITE_HYBRID', label: 'Satellite' },
              { id: 'VECTOR_MAP', label: 'Vector' },
              { id: 'OFFLINE_NATURAL_EARTH', label: 'Natural Earth' },
            ] as const
          ).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBasemapMode(b.id)}
              className={`rounded-lg px-2.5 py-1 transition cursor-pointer ${
                basemapMode === b.id
                  ? 'bg-[#173954] text-[#72E4F1] font-semibold'
                  : 'text-[#90A8BA] hover:text-white'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Shared MapLibre 3D Globe / Satellite Parcel Canvas */}
      <MapLibreGlobeCanvas
        compactMode
        showEoSupportBox={false}
        selectedCoords={siteCoords}
        fieldPinCoords={mode === 'FIELD_EDITOR' ? fieldInteriorPin : null}
        zoomLevel={zoomLevel}
        polygon={activeField.geometry ?? null}
        activeLayerId="HLS_REFLECTANCE"
        isDrawingMode={isDrawingMode}
        drawingVertices={drawingVertices}
        selectedVertexIndex={selectedVertexIndex}
        onSelectVertexIndex={setSelectedVertexIndex}
        onUpdateVertexCoord={handleUpdateVertex}
        onInsertVertexAfter={handleInsertVertexAfter}
        onDeleteVertex={handleDeleteVertex}
        onSelectPoint={(coords) => {
          if (mode === 'LOCATION_PICKER') {
            onSelectSitePoint(coords);
          } else {
            setFieldInteriorPin(coords);
            setEditorNotice(
              `Field pin placed at ${coords[1].toFixed(4)}°, ${coords[0].toFixed(4)}° (farm center unchanged). Tap Suggest Field to check this parcel.`
            );
          }
        }}
        onAddDrawingVertex={handleAddVertex}
        onToggleDrawingMode={handleToggleDraw}
        onCompleteDrawing={() => {
          if (commitVerticesAsPolygon(drawingVertices, 'USER_DRAWN')) {
            setIsDrawingMode(false);
          }
        }}
        onUndoVertex={handleUndo}
        onClearPolygon={handleClearBoundary}
        reducedMotion={reducedMotion}
        basemapMode={basemapMode}
        onZoomLevelSync={setZoomLevel}
        capabilityOverlayEnabled={capabilityOverlayEnabled}
        onToggleCapabilityOverlay={onToggleCapabilityOverlay}
        capabilityGeoJson={capabilityGeoJson}
        capabilityToast={capabilityToast}
        onClickCapabilityFeature={onClickCapabilityFeature}
        onDismissCapabilityToast={onDismissCapabilityToast}
        suggestedBoundary={ftwSuggestion?.geometry ?? null}
        gpsTrackPoints={gpsPolylinePoints}
      />

      {mode === 'FIELD_EDITOR' && (
        <div className="space-y-3">
          {/* Primary Simple Farmer Toolbar (Max 2 clear primary buttons + Done/Undo/Redo when active) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="suggest-ftw-boundary-btn"
              onClick={() => void handleSuggestFtwBoundary()}
              disabled={ftwBusy}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#72E4F1]/60 bg-[#081728] px-4 py-2 text-xs font-semibold text-[#72E4F1] hover:bg-[#132B3F] disabled:opacity-60 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{ftwBusy ? 'Searching field…' : 'Suggest Field'}</span>
            </button>

            {ftwBusy && (
              <button
                type="button"
                data-testid="cancel-ftw-suggestion-btn"
                onClick={handleCancelFtwSuggestion}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#F5B95F]/60 bg-[#1B1408] px-3 py-2 text-xs font-semibold text-[#F5B95F] hover:bg-[#2A1F0D] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel Search</span>
              </button>
            )}

            <button
              type="button"
              data-testid="draw-field-corners-btn"
              onClick={handleToggleDraw}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                isDrawingMode
                  ? 'bg-[#57D9A7] text-[#061320]'
                  : 'border border-[#548299] bg-[#0D2031] text-[#F1F7FD] hover:border-[#72E4F1]'
              }`}
            >
              {isDrawingMode ? <Crosshair className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              <span>{isDrawingMode ? 'Drawing corners (tap Done)' : 'Draw Manually'}</span>
            </button>

            {isDrawingMode && drawingVertices.length >= 3 && (
              <button
                type="button"
                data-testid="complete-drawn-polygon-btn"
                onClick={() => {
                  if (commitVerticesAsPolygon(drawingVertices, 'USER_DRAWN')) {
                    setIsDrawingMode(false);
                  }
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#72E4F1] px-4 py-2 text-xs font-semibold text-[#061320] cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Done ({drawingVertices.length} corners)</span>
              </button>
            )}

            {(undoStack.length > 0 || redoStack.length > 0 || drawingVertices.length > 0) && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button
                  type="button"
                  onClick={handleUndo}
                  aria-label="Undo corner change"
                  disabled={undoStack.length === 0 && drawingVertices.length === 0}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  aria-label="Redo corner change"
                  disabled={redoStack.length === 0}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* FTW Satellite Suggestion Preview Card */}
          {ftwSuggestion && (
            <div
              data-testid="ftw-suggestion-card"
              className="rounded-xl border border-[#38BDF8]/60 bg-[#0A2236] p-3.5 text-xs space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[#F1F7FD]">
                  Suggested field outline (~{ftwSuggestion.areaHa.toFixed(2)} ha · {ftwSuggestion.areaAcres.toFixed(2)} ac)
                </div>
                <span className="font-mono text-[10px] text-[#72E4F1]">
                  {ftwSuggestion.attribution}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] font-mono text-[#AEC4D3]">
                {ftwSuggestion.sourceFeatureId && (
                  <span className="rounded border border-[#29455A] bg-[#081728] px-2 py-0.5">
                    ID: {ftwSuggestion.sourceFeatureId}
                  </span>
                )}
                {ftwSuggestion.license && (
                  <span className="rounded border border-[#29455A] bg-[#081728] px-2 py-0.5">
                    License: {ftwSuggestion.license}
                  </span>
                )}
                <span className="rounded border border-[#29455A] bg-[#081728] px-2 py-0.5">
                  Source verified complete:{' '}
                  {ftwSuggestion.sourceVerifiedComplete ? 'Yes' : 'No (partial/tile check only)'}
                </span>
                {(() => {
                  const scoreDisplay =
                    typeof ftwSuggestion.rawModelScore === 'number'
                      ? ftwSuggestion.rawModelScore
                      : typeof ftwSuggestion.modelConfidence === 'number'
                        ? Math.round(
                            ftwSuggestion.modelConfidence <= 1
                              ? ftwSuggestion.modelConfidence * 100
                              : ftwSuggestion.modelConfidence
                          )
                        : null;
                  if (scoreDisplay === null) return null;
                  return (
                    <span className="rounded border border-amber-400/35 bg-amber-950/35 px-2 py-0.5 text-amber-200">
                      Raw model score: {scoreDisplay}/100 (uncalibrated)
                    </span>
                  );
                })()}
              </div>
              <p className="text-[11px] text-[#AEC4D3]">
                {ftwSuggestion.disclaimer} Not a legal cadastral/land-registry boundary; inspect and
                drag corners to match your physical plot.
              </p>
              {ftwSuggestion.scoreDisclaimer && (
                <p className="text-[10px] text-[#90A8BA]">{ftwSuggestion.scoreDisclaimer}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="accept-ftw-suggestion-btn"
                  onClick={handleAcceptFtwSuggestion}
                  className="min-h-[44px] rounded-lg bg-[#72E4F1] px-4 py-1.5 font-semibold text-[#061320] hover:bg-[#93EDF7] cursor-pointer"
                >
                  Use &amp; adjust corners
                </button>
                <button
                  type="button"
                  onClick={() => setFtwSuggestion(null)}
                  className="min-h-[44px] rounded-lg border border-[#29455A] bg-[#081728] px-3 py-1.5 text-[#AEC4D3] hover:text-white cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {ftwMessage && !ftwSuggestion && (
            <div
              data-testid="ftw-status-notice"
              className="rounded-xl border border-[#29455A] bg-[#081728] px-3.5 py-2 text-xs text-[#AEC4D3]"
            >
              {ftwMessage}
            </div>
          )}

          {editorError && (
            <div
              role="alert"
              data-testid="field-geometry-error"
              className="rounded-xl border border-[#FF9299] bg-[#2C141B] px-3.5 py-2 text-xs text-[#FF9299]"
            >
              {editorError}
            </div>
          )}

          {editorNotice && !editorError && (
            <div
              role="status"
              className="rounded-xl border border-[#57D9A7]/40 bg-[#0D2B2A]/60 px-3.5 py-2 text-xs text-[#57D9A7]"
            >
              {editorNotice}
            </div>
          )}

          {/* Measured Field Area + Perimeter + Capability Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#29455A] bg-[#081728] px-3.5 py-2.5 text-xs">
            <div>
              <span className="text-[#90A8BA]">Boundary measure: </span>
              {liveMetrics ? (
                <span className="font-mono font-semibold text-[#57D9A7]">
                  {liveMetrics.areaHa.toFixed(2)} ha ({liveMetrics.areaAcres.toFixed(2)} ac) ·{' '}
                  {Math.round(liveMetrics.perimeterMeters)} m perimeter
                </span>
              ) : (
                <span className="text-[#AEC4D3]">No closed boundary yet</span>
              )}
            </div>
            <span className="font-mono text-[10px] text-[#72E4F1]">
              {activeField.geometrySource ? SOURCE_LABELS[activeField.geometrySource] : 'User estimate'}
            </span>
          </div>

          {/* Secondary / Advanced Methods Accordion ("More options") */}
          <details
            data-testid="wizard-other-boundary-ways"
            className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 text-xs"
          >
            <summary className="cursor-pointer font-semibold text-[#91B8FF] select-none min-h-[44px] flex flex-wrap items-center gap-1.5">
              <span>More options</span>
              <span className="font-normal text-[#90A8BA]">
                (editable rectangle, GPS walk, import GeoJSON / KML / GPX)
              </span>
            </summary>

            <div className="mt-4 space-y-4 border-t border-[#29455A]/70 pt-3">
              {/* Option A: Walk boundary with phone GPS */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-[#F1F7FD] flex items-center gap-1.5">
                    <Footprints className="w-4 h-4 text-[#72E4F1]" />
                    <span>Walk boundary with phone GPS</span>
                  </div>
                  {gpsLastAccuracy !== null && (
                    <span
                      className={`font-mono text-[10px] rounded px-2 py-0.5 border ${
                        gpsLastAccuracy <= 10
                          ? 'border-emerald-400/50 text-emerald-300'
                          : gpsLastAccuracy <= 30
                            ? 'border-amber-400/50 text-amber-300'
                            : 'border-rose-400/50 text-rose-300'
                      }`}
                    >
                      GPS ±{gpsLastAccuracy} m
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#90A8BA]">
                  Works best in open sky: phone GPS accuracy can degrade under dense tree canopy, near metal structures, or in weak signal.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!gpsWalking ? (
                    <button
                      type="button"
                      data-testid="gps-walk-start-btn"
                      onClick={startOrResumeGpsWalk}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3 py-1.5 text-xs text-[#72E4F1] hover:border-[#72E4F1] cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{gpsPaused ? 'Resume GPS walk' : 'Start GPS walk'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="gps-walk-pause-btn"
                      onClick={pauseGpsWalk}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-950/60 px-3 py-1.5 text-xs text-amber-200 cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause walk ({gpsSamples.length} pts)</span>
                    </button>
                  )}

                  {gpsSamples.length > 0 && (
                    <button
                      type="button"
                      data-testid="gps-walk-finish-btn"
                      onClick={finishGpsWalk}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#57D9A7] px-3 py-1.5 text-xs font-semibold text-[#061320] cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Finish &amp; review ({gpsSamples.length} pts)</span>
                    </button>
                  )}
                </div>
                {gpsStatusText && <p className="text-[11px] text-[#90A8BA]">{gpsStatusText}</p>}
              </div>

              {/* Option B: Quick approximate rectangle */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#29455A]/60 pt-3">
                <div>
                  <div className="font-semibold text-[#F1F7FD]">Quick approximate outline</div>
                  <p className="text-[11px] text-[#90A8BA]">
                    Places an approximate box sized to your declared hectares (drag corners to refine).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onGenerateApproxRectangle(activeFieldIndex)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3 py-1.5 text-xs font-medium text-[#72E4F1] hover:bg-[#132B3F] cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>
                    {activeField.geometry
                      ? 'Refresh plot outline near pin'
                      : 'Generate plot outline on map'}
                  </span>
                </button>
              </div>

              {/* Option C: Import GeoJSON / KML / GPX / coordinate pairs */}
              <div className="space-y-2 border-t border-[#29455A]/60 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#F1F7FD]">
                    Import boundary file (GeoJSON, KML, GPX) or paste coordinates
                  </span>
                  <button
                    type="button"
                    data-testid="import-boundary-file-btn"
                    onClick={() => importFileInputRef.current?.click()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3 py-1.5 text-xs text-[#72E4F1] cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload GeoJSON / KML / GPX</span>
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".json,.geojson,.kml,.gpx,application/geo+json,application/json,application/vnd.google-earth.kml+xml,application/gpx+xml"
                    onChange={handleImportFileChange}
                    className="sr-only"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    rows={2}
                    data-testid="import-boundary-textarea"
                    value={importPasteText}
                    onChange={(e) => setImportPasteText(e.target.value)}
                    placeholder='Paste GeoJSON Polygon, KML/GPX, or [lon, lat] lines...'
                    className="flex-1 rounded-lg border border-[#29455A] bg-[#0D2031] p-2 font-mono text-[11px] text-[#F1F7FD]"
                  />
                  <button
                    type="button"
                    data-testid="apply-imported-boundary-btn"
                    onClick={() => handleImportBoundary(importPasteText)}
                    className="min-h-[40px] self-end rounded-lg bg-[#548299] px-4 py-2 text-xs font-semibold text-[#061320] hover:bg-[#72E4F1] cursor-pointer"
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>
          </details>

          <details
            data-testid="evidence-and-limitations"
            className="rounded-xl border border-[#29455A]/80 bg-[#071321] px-3.5 py-2 text-[11px]"
          >
            <summary className="cursor-pointer font-medium text-[#90A8BA] hover:text-[#AEC4D3] select-none min-h-[36px] flex items-center justify-between">
              <span>Evidence &amp; limitations</span>
              <span className="font-mono text-[10px] text-[#72E4F1]">
                {capabilityCheck ? `Saving enabled · ${capabilityCheck.status}` : 'Planning estimate only'}
              </span>
            </summary>
            <div className="mt-2 space-y-1.5 border-t border-[#29455A]/60 pt-2 text-[#AEC4D3]">
              {capabilityCheck && (
                <p>
                  <strong className="text-white">Regional check:</strong> {capabilityCheck.headline}{' '}
                  ({capabilityCheck.explanation})
                </p>
              )}
              <p>
                <strong className="text-white">Non-cadastral notice:</strong> Drawn shapes, GPS walks, and
                satellite-suggested outlines are agronomic planning estimates only — not legal land-registry
                or cadastral surveys.
              </p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
