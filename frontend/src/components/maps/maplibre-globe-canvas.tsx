'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { withBasePath } from '@/lib/base-path';
import {
  Globe2,
  Map as MapIcon,
  Plus,
  Minus,
  RotateCcw,
  Pencil,
  Check,
  Undo2,
  Trash2,
  AlertTriangle,
  Layers,
  Crosshair,
  ShieldAlert,
  Info,
  X,
} from 'lucide-react';
import { NATURAL_EARTH_WORLD_GEOJSON } from '@/fixtures/natural-earth-world';
import {
  CAPABILITY_OVERLAY_META,
  type AnalysisCapabilityStatus,
} from '@/domain/capability-overlay';
import {
  type MapBasemapMode,
  type MapRenderStatus,
  NATURAL_EARTH_COUNTRIES_PATH,
  EO_OVERLAY_CATALOG,
  buildEarthGlobeStyle,
  buildEoSpatialSupportGeoJson,
} from './map-providers';

export interface CapabilityToastNotice {
  status: AnalysisCapabilityStatus;
  title: string;
  explanation: string;
  reasons: string[];
  alternatives: string[];
}

export interface MapLibreGlobeCanvasProps {
  selectedCoords: [number, number]; // [lon, lat]
  zoomLevel: number;
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  activeLayerId: string;
  isDrawingMode: boolean;
  drawingVertices: Array<[number, number]>;
  selectedVertexIndex?: number;
  onSelectVertexIndex?: (idx: number) => void;
  onUpdateVertexCoord?: (idx: number, nextCoord: [number, number]) => void;
  onInsertVertexAfter?: (edgeIndex: number, midpoint: [number, number]) => void;
  onDeleteVertex?: (vertexIndex: number) => void;
  onSelectPoint: (coords: [number, number]) => void;
  onAddDrawingVertex: (coords: [number, number]) => void;
  onToggleDrawingMode: () => void;
  onCompleteDrawing: () => void;
  onUndoVertex: () => void;
  onClearPolygon: () => void;
  reducedMotion: boolean;
  basemapMode?: MapBasemapMode;
  onBasemapModeChange?: (mode: MapBasemapMode) => void;
  onZoomLevelSync?: (zoom: number) => void;
  onRenderStatusChange?: (status: MapRenderStatus) => void;
  capabilityOverlayEnabled?: boolean;
  onToggleCapabilityOverlay?: () => void;
  capabilityGeoJson?: GeoJSON.FeatureCollection | null;
  capabilityToast?: CapabilityToastNotice | null;
  onDismissCapabilityToast?: () => void;
  onClickCapabilityFeature?: (notice: CapabilityToastNotice) => void;
  fieldPinCoords?: [number, number] | null;
  suggestedBoundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  gpsTrackPoints?: Array<[number, number]>;
  compactMode?: boolean;
  showEoSupportBox?: boolean;
}

type WebGlStatus = 'INITIALIZING' | 'READY' | 'FAILED';
type ProjectionMode = 'globe' | 'mercator';
export type MapProviderStatus =
  | 'LOADING'
  | 'READY'
  | 'PARTIAL'
  | 'OFFLINE'
  | 'PERMISSION_BLOCKED'
  | 'WEBGL_UNAVAILABLE'
  | 'FALLBACK_ONLY';

function probeWebGlAvailability(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mapFallback') === '1') {
      return false;
    }
    const testCanvas = document.createElement('canvas');
    const gl =
      testCanvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
      testCanvas.getContext('webgl', { failIfMajorPerformanceCaveat: false }) ||
      testCanvas.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: false });
    if (!gl) return false;
    // Release the probe context immediately if extension is available
    const loseExt = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    loseExt?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function buildPolygonGeoJson(
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
  drawingVertices: Array<[number, number]>
): GeoJSON.FeatureCollection {
  if (polygon) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { kind: 'committed' }, geometry: polygon }],
    };
  }
  if (drawingVertices.length >= 3) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'draft' },
          geometry: {
            type: 'Polygon',
            coordinates: [[...drawingVertices, drawingVertices[0]!]],
          },
        },
      ],
    };
  }
  if (drawingVertices.length === 2) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'draft-line' },
          geometry: {
            type: 'LineString',
            coordinates: drawingVertices,
          },
        },
      ],
    };
  }
  return { type: 'FeatureCollection', features: [] };
}

function buildVerticesGeoJson(
  drawingVertices: Array<[number, number]>,
  selectedVertexIndex?: number
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: drawingVertices.map((coord, idx) => ({
      type: 'Feature',
      properties: {
        vertexIndex: idx,
        selected: selectedVertexIndex === idx,
      },
      geometry: {
        type: 'Point',
        coordinates: coord,
      },
    })),
  };
}

function buildMidpointsGeoJson(
  drawingVertices: Array<[number, number]>
): GeoJSON.FeatureCollection {
  if (drawingVertices.length < 3) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < drawingVertices.length; i += 1) {
    const a = drawingVertices[i]!;
    const b = drawingVertices[(i + 1) % drawingVertices.length]!;
    const mid: [number, number] = [
      Number(((a[0] + b[0]) / 2).toFixed(6)),
      Number(((a[1] + b[1]) / 2).toFixed(6)),
    ];
    features.push({
      type: 'Feature',
      properties: { edgeIndex: i },
      geometry: { type: 'Point', coordinates: mid },
    });
  }
  return { type: 'FeatureCollection', features };
}

function buildSuggestionGeoJson(
  suggestedBoundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
): GeoJSON.FeatureCollection {
  if (!suggestedBoundary) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { kind: 'ftw-suggestion' }, geometry: suggestedBoundary }],
  };
}

function buildGpsTrackGeoJson(gpsTrackPoints?: Array<[number, number]>): GeoJSON.FeatureCollection {
  if (!gpsTrackPoints || gpsTrackPoints.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'gps-track' },
        geometry: { type: 'LineString', coordinates: gpsTrackPoints },
      },
    ],
  };
}

function buildSitePointGeoJson(
  coords: [number, number],
  fieldPinCoords?: [number, number] | null
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { role: 'active-site' },
      geometry: { type: 'Point', coordinates: coords },
    },
  ];
  if (fieldPinCoords) {
    features.push({
      type: 'Feature',
      properties: { role: 'field-pin' },
      geometry: { type: 'Point', coordinates: fieldPinCoords },
    });
  }
  return {
    type: 'FeatureCollection',
    features,
  };
}

function coordsDiffer(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) > 0.0001 || Math.abs(a[1] - b[1]) > 0.0001;
}

interface SvgFallbackMapProps {
  selectedCoords: [number, number];
  zoomLevel: number;
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  drawingVertices: Array<[number, number]>;
  selectedVertexIndex?: number;
  isDrawingMode: boolean;
  countriesGeoJson: GeoJSON.FeatureCollection;
  activeLayerId: string;
  capabilityOverlayEnabled?: boolean;
  capabilityGeoJson?: GeoJSON.FeatureCollection | null;
  suggestedBoundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  onSelectPoint: (coords: [number, number]) => void;
  onAddDrawingVertex: (coords: [number, number]) => void;
  onSelectVertexIndex?: (idx: number) => void;
  reasonText: string;
  onRetryWebGl?: () => void;
}

function ringToSvgPath(ring: number[][]): string {
  if (!ring.length) return '';
  return (
    ring
      .map((pt, i) => {
        const lon = pt[0] ?? 0;
        const lat = pt[1] ?? 0;
        const x = lon + 180;
        const y = 90 - lat;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ') + ' Z'
  );
}

function geometryToSvgPaths(geom: GeoJSON.Geometry): string[] {
  if (geom.type === 'Polygon') {
    return geom.coordinates.map((ring) => ringToSvgPath(ring)).filter(Boolean);
  }
  if (geom.type === 'MultiPolygon') {
    const out: string[] = [];
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        const p = ringToSvgPath(ring);
        if (p) out.push(p);
      }
    }
    return out;
  }
  return [];
}

function SvgFallbackMap({
  selectedCoords,
  zoomLevel,
  polygon,
  drawingVertices,
  selectedVertexIndex,
  isDrawingMode,
  countriesGeoJson,
  activeLayerId,
  capabilityOverlayEnabled,
  capabilityGeoJson,
  suggestedBoundary,
  onSelectPoint,
  onAddDrawingVertex,
  onSelectVertexIndex,
  reasonText,
  onRetryWebGl,
}: SvgFallbackMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const countryPaths = useMemo(() => {
    const paths: string[] = [];
    for (const feature of countriesGeoJson.features) {
      if (feature.geometry) {
        paths.push(...geometryToSvgPaths(feature.geometry));
      }
    }
    return paths;
  }, [countriesGeoJson]);

  const capabilityPaths = useMemo(() => {
    if (!capabilityOverlayEnabled || !capabilityGeoJson) return [];
    const out: Array<{ d: string; status: string; fillColor: string; fillOpacity: number; strokeColor: string }> = [];
    for (const f of capabilityGeoJson.features) {
      if (!f.geometry) continue;
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const status = String(p.status ?? 'UNKNOWN_UNASSESSED');
      const fillColor = String(p.fillColor ?? '#ef4444');
      const fillOpacity = typeof p.fillOpacity === 'number' ? p.fillOpacity : 0.14;
      const strokeColor = String(p.strokeColor ?? '#f87171');
      for (const d of geometryToSvgPaths(f.geometry)) {
        out.push({ d, status, fillColor, fillOpacity, strokeColor });
      }
    }
    return out;
  }, [capabilityOverlayEnabled, capabilityGeoJson]);

  const eoFootprintPaths = useMemo(() => {
    const fc = buildEoSpatialSupportGeoJson(selectedCoords[0], selectedCoords[1], activeLayerId);
    const out: string[] = [];
    for (const f of fc.features) {
      if (f.geometry) out.push(...geometryToSvgPaths(f.geometry));
    }
    return out;
  }, [selectedCoords, activeLayerId]);

  const suggestedPaths = useMemo(() => {
    if (!suggestedBoundary) return [];
    return geometryToSvgPaths(suggestedBoundary);
  }, [suggestedBoundary]);

  const fieldPaths = useMemo(() => {
    const fc = buildPolygonGeoJson(polygon, drawingVertices);
    const out: string[] = [];
    for (const f of fc.features) {
      if (f.geometry) out.push(...geometryToSvgPaths(f.geometry));
    }
    return out;
  }, [polygon, drawingVertices]);

  // Compute viewBox centered on selectedCoords at zoomed levels (z <= 2.5 shows full world)
  const viewBox = useMemo(() => {
    if (zoomLevel <= 2.6) {
      return '0 0 360 180';
    }
    const spanLon = Math.max(0.25, 360 / Math.pow(2, zoomLevel - 1.5));
    const spanLat = spanLon * 0.5;
    const cx = selectedCoords[0] + 180;
    const cy = 90 - selectedCoords[1];
    const minX = Math.max(0, Math.min(360 - spanLon, cx - spanLon / 2));
    const minY = Math.max(0, Math.min(180 - spanLat, cy - spanLat / 2));
    return `${minX.toFixed(3)} ${minY.toFixed(3)} ${spanLon.toFixed(3)} ${spanLat.toFixed(3)}`;
  }, [selectedCoords, zoomLevel]);

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vbParts = viewBox.split(' ').map(Number);
    const vx = vbParts[0] ?? 0;
    const vy = vbParts[1] ?? 0;
    const vw = vbParts[2] ?? 360;
    const vh = vbParts[3] ?? 180;
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    const lon = Number((vx + normX * vw - 180).toFixed(5));
    const lat = Number((90 - (vy + normY * vh)).toFixed(5));
    const clamped: [number, number] = [
      Math.max(-180, Math.min(180, lon)),
      Math.max(-85, Math.min(85, lat)),
    ];
    if (isDrawingMode) {
      onAddDrawingVertex(clamped);
    } else {
      onSelectPoint(clamped);
    }
  };

  const markerX = selectedCoords[0] + 180;
  const markerY = 90 - selectedCoords[1];
  const radiusFactor = zoomLevel <= 2.6 ? 1 : Math.max(0.03, 1 / Math.pow(2, zoomLevel - 2.2));
  const strokeScale = zoomLevel <= 2.6 ? 0.35 : Math.max(0.015, 0.35 / Math.pow(2, zoomLevel - 2.2));

  return (
    <div
      data-testid="maplibre-2d-fallback"
      data-render-status="FALLBACK_ONLY"
      data-provider-status="FALLBACK_ONLY"
      data-countries-loaded={countriesGeoJson.features.length}
      className="relative flex h-full w-full flex-col overflow-hidden bg-[#030917]"
    >
      <div
        role="alert"
        className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-950/85 px-3 py-2 text-xs text-amber-100"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span>
            <strong className="font-semibold text-amber-200">FALLBACK_ONLY:</strong> {reasonText} (Natural
            Earth 1:110m CC0 · {countriesGeoJson.features.length} countries loaded)
          </span>
        </div>
        {onRetryWebGl && (
          <button
            type="button"
            onClick={onRetryWebGl}
            className="rounded border border-amber-300/40 bg-amber-900/60 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-800/80"
          >
            Attempt 3D WebGL Globe
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleSvgClick}
        className={`h-full w-full flex-1 select-none ${isDrawingMode ? 'cursor-crosshair' : 'cursor-pointer'}`}
        aria-label="Natural Earth 2D fallback map canvas"
      >
        <rect x="0" y="0" width="360" height="180" fill="#041024" />
        {/* Equator & Prime Meridian */}
        <line x1="0" y1="90" x2="360" y2="90" stroke="#163252" strokeWidth={strokeScale} />
        <line x1="180" y1="0" x2="180" y2="180" stroke="#163252" strokeWidth={strokeScale} />

        {countryPaths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="#14323b"
            stroke="#3a6b7c"
            strokeWidth={strokeScale * 1.15}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {capabilityPaths.map((item, i) => (
          <path
            key={`cap-${i}`}
            d={item.d}
            fill={item.fillColor}
            fillOpacity={Math.max(0.14, item.fillOpacity)}
            stroke={item.strokeColor}
            strokeWidth={strokeScale * 1.35}
            strokeDasharray={`${strokeScale * 2.5} ${strokeScale * 2}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {eoFootprintPaths.map((d, i) => (
          <path
            key={`eo-${i}`}
            d={d}
            fill="#38bdf8"
            fillOpacity={0.18}
            stroke="#38bdf8"
            strokeWidth={strokeScale * 2}
            strokeDasharray={`${strokeScale * 4} ${strokeScale * 3}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {suggestedPaths.map((d, i) => (
          <path
            key={`ftw-${i}`}
            d={d}
            fill="#38bdf8"
            fillOpacity={0.2}
            stroke="#38bdf8"
            strokeWidth={strokeScale * 2.4}
            strokeDasharray={`${strokeScale * 3} ${strokeScale * 2}`}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {fieldPaths.map((d, i) => (
          <path
            key={`field-${i}`}
            d={d}
            fill="#34d399"
            fillOpacity={0.32}
            stroke="#6ee7b7"
            strokeWidth={strokeScale * 3}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {drawingVertices.map(([vx, vy], idx) => (
          <circle
            key={`v-${idx}`}
            cx={vx + 180}
            cy={90 - vy}
            r={3.2 * radiusFactor}
            fill={selectedVertexIndex === idx ? '#fbbf24' : '#f472b6'}
            stroke="#ffffff"
            strokeWidth={1.1 * radiusFactor}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelectVertexIndex?.(idx);
            }}
          />
        ))}

        <circle
          cx={markerX}
          cy={markerY}
          r={6 * radiusFactor}
          fill="#38bdf8"
          fillOpacity={0.28}
          stroke="#7dd3fc"
          strokeWidth={1.2 * radiusFactor}
        />
        <circle
          cx={markerX}
          cy={markerY}
          r={2.5 * radiusFactor}
          fill="#f59e0b"
          stroke="#ffffff"
          strokeWidth={0.9 * radiusFactor}
        />
      </svg>
    </div>
  );
}

export function MapLibreGlobeCanvas({
  selectedCoords,
  zoomLevel,
  polygon,
  activeLayerId,
  isDrawingMode,
  drawingVertices,
  selectedVertexIndex,
  onSelectVertexIndex,
  onUpdateVertexCoord,
  onInsertVertexAfter,
  onDeleteVertex,
  onSelectPoint,
  onAddDrawingVertex,
  onToggleDrawingMode,
  onCompleteDrawing,
  onUndoVertex,
  onClearPolygon,
  reducedMotion,
  basemapMode: controlledBasemapMode,
  onZoomLevelSync,
  onRenderStatusChange,
  capabilityOverlayEnabled = false,
  onToggleCapabilityOverlay,
  capabilityGeoJson = null,
  capabilityToast = null,
  onDismissCapabilityToast,
  onClickCapabilityFeature,
  fieldPinCoords = null,
  suggestedBoundary = null,
  gpsTrackPoints,
  compactMode = false,
  showEoSupportBox = true,
}: MapLibreGlobeCanvasProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const basemapMode: MapBasemapMode = controlledBasemapMode ?? 'SATELLITE_HYBRID';

  const [projectionMode, setProjectionMode] = useState<ProjectionMode>('globe');
  const [webglStatus, setWebglStatus] = useState<WebGlStatus>('INITIALIZING');
  const [renderStatus, setRenderStatus] = useState<MapRenderStatus>('REMOTE_LOADING');
  const [providerStatus, setProviderStatus] = useState<MapProviderStatus>('LOADING');
  const [tilesStreaming, setTilesStreaming] = useState<boolean>(false);
  const [isGlobeInView, setIsGlobeInView] = useState<boolean>(true);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(true);
  const [fallbackReason, setFallbackReason] = useState<string>('');
  const [force2DFallback, setForce2DFallback] = useState<boolean>(false);
  const [countriesData, setCountriesData] = useState<GeoJSON.FeatureCollection>(
    NATURAL_EARTH_WORLD_GEOJSON
  );
  const [liveZoom, setLiveZoom] = useState<number>(zoomLevel);
  const [liveCenter, setLiveCenter] = useState<[number, number]>(selectedCoords);
  const [showToastDetails, setShowToastDetails] = useState<boolean>(false);

  // Refs for latest callback & interaction state without re-creating Map instance
  const callbacksRef = useRef({
    onSelectPoint,
    onAddDrawingVertex,
    onSelectVertexIndex,
    onUpdateVertexCoord,
    onInsertVertexAfter,
    onZoomLevelSync,
    onRenderStatusChange,
    onClickCapabilityFeature,
  });
  const latestPropsRef = useRef({
    selectedCoords,
    zoomLevel,
    polygon,
    activeLayerId,
    isDrawingMode,
    drawingVertices,
    selectedVertexIndex,
    reducedMotion,
    basemapMode,
    projectionMode,
    countriesData,
    capabilityOverlayEnabled,
    capabilityGeoJson,
    fieldPinCoords,
    suggestedBoundary,
    gpsTrackPoints,
    showEoSupportBox,
  });
  useEffect(() => {
    callbacksRef.current = {
      onSelectPoint,
      onAddDrawingVertex,
      onSelectVertexIndex,
      onUpdateVertexCoord,
      onInsertVertexAfter,
      onZoomLevelSync,
      onRenderStatusChange,
      onClickCapabilityFeature,
    };
    latestPropsRef.current = {
      selectedCoords,
      zoomLevel,
      polygon,
      activeLayerId,
      isDrawingMode,
      drawingVertices,
      selectedVertexIndex,
      reducedMotion,
      basemapMode,
      projectionMode,
      countriesData,
      capabilityOverlayEnabled,
      capabilityGeoJson,
      fieldPinCoords,
      suggestedBoundary,
      gpsTrackPoints,
      showEoSupportBox,
    };
  });

  const remoteTileFailuresRef = useRef<number>(0);
  const consecutiveTileErrorsRef = useRef<number>(0);
  const remoteTilesLoadedRef = useRef<number>(0);
  const imageryTilesLoadedRef = useRef<number>(0);
  const vectorTilesLoadedRef = useRef<number>(0);
  const vectorTileErrorsRef = useRef<number>(0);
  const draggingVertexIdxRef = useRef<number | null>(null);
  const prevExternalCoordsRef = useRef<[number, number]>(selectedCoords);
  const prevExternalZoomRef = useRef<number>(zoomLevel);
  const isMapLoadedRef = useRef<boolean>(false);
  const renderStatusRef = useRef<MapRenderStatus>('REMOTE_LOADING');

  const updateRenderStatus = useCallback((next: MapRenderStatus) => {
    renderStatusRef.current = next;
    setRenderStatus(next);
    callbacksRef.current.onRenderStatusChange?.(next);
  }, []);

  // Load full Natural Earth 1:110m (177 countries) GeoJSON asynchronously
  useEffect(() => {
    let active = true;
    fetch(NATURAL_EARTH_COUNTRIES_PATH)
      .then((res) => (res.ok ? res.json() : null))
      .then((geojson: GeoJSON.FeatureCollection | null) => {
        if (!active || !geojson || !Array.isArray(geojson.features)) return;
        setCountriesData(geojson);
        const map = mapRef.current;
        if (map && isMapLoadedRef.current) {
          const src = map.getSource('world-countries-fallback') as GeoJSONSource | undefined;
          src?.setData(geojson);
        }
      })
      .catch(() => {
        // Keep synchronous minimal NATURAL_EARTH_WORLD_GEOJSON fallback cleanly
      });
    return () => {
      active = false;
    };
  }, []);

  const syncAllGeoJsonSources = useCallback((map: MapLibreMap) => {
    const p = latestPropsRef.current;
    const countrySrc = map.getSource('world-countries-fallback') as GeoJSONSource | undefined;
    countrySrc?.setData(p.countriesData);

    const capSrc = map.getSource('capability-footprints') as GeoJSONSource | undefined;
    capSrc?.setData(
      p.capabilityOverlayEnabled && p.capabilityGeoJson
        ? p.capabilityGeoJson
        : { type: 'FeatureCollection', features: [] }
    );

    const eoSrc = map.getSource('eo-support-footprint') as GeoJSONSource | undefined;
    eoSrc?.setData(
      p.showEoSupportBox
        ? buildEoSpatialSupportGeoJson(p.selectedCoords[0], p.selectedCoords[1], p.activeLayerId)
        : { type: 'FeatureCollection', features: [] }
    );

    const ftwSrc = map.getSource('ftw-suggestion') as GeoJSONSource | undefined;
    ftwSrc?.setData(buildSuggestionGeoJson(p.suggestedBoundary));

    const gpsSrc = map.getSource('gps-track') as GeoJSONSource | undefined;
    gpsSrc?.setData(buildGpsTrackGeoJson(p.gpsTrackPoints));

    const polySrc = map.getSource('field-polygon') as GeoJSONSource | undefined;
    polySrc?.setData(buildPolygonGeoJson(p.polygon, p.drawingVertices));

    const midSrc = map.getSource('drawing-midpoints') as GeoJSONSource | undefined;
    midSrc?.setData(
      !p.isDrawingMode ? buildMidpointsGeoJson(p.drawingVertices) : { type: 'FeatureCollection', features: [] }
    );

    const vertSrc = map.getSource('drawing-vertices') as GeoJSONSource | undefined;
    vertSrc?.setData(buildVerticesGeoJson(p.drawingVertices, p.selectedVertexIndex));

    const pointSrc = map.getSource('site-point') as GeoJSONSource | undefined;
    pointSrc?.setData(buildSitePointGeoJson(p.selectedCoords, p.fieldPinCoords));
  }, []);

  // Track browser online/offline, tab visibility, and IntersectionObserver cleanly
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (navigator.onLine === false) {
      setProviderStatus('OFFLINE');
      updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
    }
    const handleOnline = () => {
      if (latestPropsRef.current.basemapMode !== 'OFFLINE_NATURAL_EARTH') {
        consecutiveTileErrorsRef.current = 0;
        imageryTilesLoadedRef.current = 0;
        setProviderStatus('LOADING');
        // A network "online" event does not prove tile delivery.
        // Recovery is announced only after a decoded remote tile loads.
        updateRenderStatus('REMOTE_LOADING');
      }
    };
    const handleOffline = () => {
      setTilesStreaming(false);
      setProviderStatus('OFFLINE');
      updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
    };
    const handleVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setIsTabVisible(visible);
      if (!visible) {
        mapRef.current?.stop();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    let obs: IntersectionObserver | null = null;
    const el = mapContainerRef.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      obs = new IntersectionObserver(
        (entries) => {
          const visible = entries[0]?.isIntersecting ?? true;
          setIsGlobeInView(visible);
          if (!visible) {
            mapRef.current?.stop();
          }
        },
        { threshold: 0.05 }
      );
      obs.observe(el);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      obs?.disconnect();
    };
  }, [updateRenderStatus]);

  // Initialize MapLibre v6 3D Globe once
  useEffect(() => {
    if (force2DFallback) {
      setWebglStatus('FAILED');
      setProviderStatus('FALLBACK_ONLY');
      updateRenderStatus('FALLBACK_ONLY');
      return;
    }

    const canUseWebGl = probeWebGlAvailability();
    if (!canUseWebGl) {
      const params = new URLSearchParams(window.location.search);
      const isForcedQuery = params.get('mapFallback') === '1';
      setFallbackReason(
        isForcedQuery
          ? '2D diagnostic fallback mode requested via URL (?mapFallback=1).'
          : 'WebGL 3D hardware context is unavailable in this browser session.'
      );
      setWebglStatus('FAILED');
      setProviderStatus(isForcedQuery ? 'FALLBACK_ONLY' : 'WEBGL_UNAVAILABLE');
      updateRenderStatus('FALLBACK_ONLY');
      return;
    }

    const container = mapContainerRef.current;
    if (!container) return;

    try {
      setWorkerUrl(withBasePath('/workers/maplibre-gl-worker.js'));
    } catch {
      // Safe fallback if already configured
    }

    let map: MapLibreMap;
    try {
      const initialStyle = buildEarthGlobeStyle({
        basemapMode: latestPropsRef.current.basemapMode,
        countriesData: latestPropsRef.current.countriesData,
      });
      map = new MapLibreMap({
        container,
        style: initialStyle,
        center: latestPropsRef.current.selectedCoords,
        zoom: latestPropsRef.current.zoomLevel,
        pitch: 0,
        bearing: 0,
        maxZoom: 18,
        minZoom: 0.4,
        attributionControl: false,
      });
      mapRef.current = map;
    } catch (err) {
      setFallbackReason(
        `Unable to initialize 3D WebGL Earth context (${err instanceof Error ? err.message : 'unknown error'}).`
      );
      setWebglStatus('FAILED');
      setProviderStatus('WEBGL_UNAVAILABLE');
      updateRenderStatus('FALLBACK_ONLY');
      return;
    }

    const handleLoadOrStyleLoad = () => {
      isMapLoadedRef.current = true;
      try {
        map.setProjection({ type: latestPropsRef.current.projectionMode });
        map.setSky({
          'sky-color': '#020611',
          'sky-horizon-blend': 0.72,
          'horizon-color': '#38bdf8',
          'horizon-fog-blend': 0.6,
          'fog-color': '#071a38',
          'fog-ground-blend': 0.48,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1.0, 5.5, 0.72, 7.5, 0],
        });
      } catch {
        // Projection/sky might throw briefly during teardown
      }
      syncAllGeoJsonSources(map);
      setWebglStatus('READY');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setProviderStatus('OFFLINE');
        updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
      } else if (latestPropsRef.current.basemapMode === 'OFFLINE_NATURAL_EARTH') {
        setProviderStatus('READY');
        updateRenderStatus('VECTOR_LOCAL_OFFLINE');
      } else if (
        latestPropsRef.current.basemapMode === 'VECTOR_MAP' &&
        vectorTileErrorsRef.current === 0 &&
        (vectorTilesLoadedRef.current > 0 ||
          (Boolean(map.getSource('openfreemap')) && map.isSourceLoaded('openfreemap')))
      ) {
        setProviderStatus('READY');
        updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
      }
    };

    map.on('load', handleLoadOrStyleLoad);
    map.on('style.load', handleLoadOrStyleLoad);
    map.on('styledata', () => {
      if (
        latestPropsRef.current.basemapMode === 'VECTOR_MAP' &&
        renderStatusRef.current === 'REMOTE_LOADING' &&
        vectorTileErrorsRef.current === 0 &&
        (vectorTilesLoadedRef.current > 0 ||
          (Boolean(map.getSource('openfreemap')) && map.isSourceLoaded('openfreemap')))
      ) {
        setProviderStatus('READY');
        updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
      }
    });

    map.on('dataloading', (ev) => {
      const sourceId = (ev as { sourceId?: string }).sourceId;
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (
        !isOffline &&
        renderStatusRef.current !== 'IMAGERY_PROVIDER_BLOCKED' &&
        latestPropsRef.current.basemapMode !== 'OFFLINE_NATURAL_EARTH' &&
        (sourceId === 'eox-sentinel2' || sourceId === 'nasa-blue-marble' || sourceId === 'openfreemap')
      ) {
        setTilesStreaming(true);
      }
    });

    map.on('idle', () => {
      setTilesStreaming(false);
      if (
        latestPropsRef.current.basemapMode === 'VECTOR_MAP' &&
        renderStatusRef.current === 'REMOTE_LOADING' &&
        consecutiveTileErrorsRef.current === 0 &&
        map.getSource('openfreemap')
      ) {
        setProviderStatus(remoteTileFailuresRef.current > 0 ? 'PARTIAL' : 'READY');
        updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
      }
    });

    map.on('sourcedata', (ev) => {
      const tileState = (ev as { tile?: { state?: string } }).tile?.state;
      const isSourceLoaded = Boolean((ev as { isSourceLoaded?: boolean }).isSourceLoaded);
      const isVectorOnly = latestPropsRef.current.basemapMode === 'VECTOR_MAP';
      if (ev.sourceId === 'openfreemap' && (tileState === 'loaded' || isSourceLoaded)) {
        vectorTilesLoadedRef.current += 1;
        vectorTileErrorsRef.current = 0;
      }
      if (
        (tileState === 'loaded' &&
          (ev.sourceId === 'eox-sentinel2' || ev.sourceId === 'nasa-blue-marble' || ev.sourceId === 'openfreemap')) ||
        (isVectorOnly && ev.sourceId === 'openfreemap' && isSourceLoaded && vectorTileErrorsRef.current === 0)
      ) {
        remoteTilesLoadedRef.current += 1;
        const imageryTile = ev.sourceId === 'eox-sentinel2' || ev.sourceId === 'nasa-blue-marble';
        if (imageryTile) imageryTilesLoadedRef.current += 1;
        // A vector tile must never masquerade as proof that satellite imagery recovered.
        if (imageryTile || (isVectorOnly && ev.sourceId === 'openfreemap')) {
          consecutiveTileErrorsRef.current = 0;
          if (latestPropsRef.current.basemapMode !== 'OFFLINE_NATURAL_EARTH') {
            setProviderStatus(
              isVectorOnly
                ? vectorTileErrorsRef.current > 0
                  ? 'PARTIAL'
                  : 'READY'
                : remoteTileFailuresRef.current > 0
                  ? 'PARTIAL'
                  : 'READY'
            );
            updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
          }
        }
      }
    });

    map.on('error', (ev) => {
      const errEv = ev as { sourceId?: string; error?: { status?: number; message?: string } };
      const sourceId = errEv.sourceId;
      const status = errEv.error?.status;
      const msg = errEv.error?.message?.toLowerCase() ?? '';
      const isRemoteSource =
        sourceId === 'eox-sentinel2' || sourceId === 'nasa-blue-marble' || sourceId === 'openfreemap';
      const isNetworkOrHttpErr =
        isRemoteSource ||
        typeof status === 'number' ||
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('ajax');

      if (!isNetworkOrHttpErr) return;

      if (sourceId === 'openfreemap') {
        vectorTileErrorsRef.current += 1;
        if (latestPropsRef.current.basemapMode === 'VECTOR_MAP' && vectorTileErrorsRef.current >= 2) {
          setTilesStreaming(false);
          setProviderStatus(status === 401 || status === 403 || status === 429 ? 'PERMISSION_BLOCKED' : 'FALLBACK_ONLY');
          updateRenderStatus('VECTOR_LOCAL_OFFLINE');
          return;
        }
      }

      remoteTileFailuresRef.current += 1;
      consecutiveTileErrorsRef.current += 1;
      setTilesStreaming(false);

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setProviderStatus('OFFLINE');
        updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
        return;
      }

      if ((status === 401 || status === 403 || status === 429) && consecutiveTileErrorsRef.current >= 2) {
        setProviderStatus('PERMISSION_BLOCKED');
        updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
        return;
      }

      if (consecutiveTileErrorsRef.current >= 3) {
        setProviderStatus(remoteTilesLoadedRef.current > 0 ? 'PARTIAL' : 'OFFLINE');
        updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
      }
    });

    map.on('webglcontextlost', () => {
      setFallbackReason('WebGL 3D graphics context was lost; switched safely to Natural Earth 2D fallback.');
      setWebglStatus('FAILED');
      setProviderStatus('WEBGL_UNAVAILABLE');
      updateRenderStatus('FALLBACK_ONLY');
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      const z = Number(map.getZoom().toFixed(2));
      const nextCenter: [number, number] = [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))];
      setLiveCenter(nextCenter);
      setLiveZoom(z);
      prevExternalZoomRef.current = z;
      callbacksRef.current.onZoomLevelSync?.(z);
    });

    map.on('zoomend', () => {
      const z = Number(map.getZoom().toFixed(2));
      setLiveZoom(z);
      prevExternalZoomRef.current = z;
      callbacksRef.current.onZoomLevelSync?.(z);
    });

    // Interactive vertex hover, mouse/touch drag, and midpoint insert (active at zoom >= 8)
    const vertexHitLayers = ['drawing-vertices-circles', 'drawing-vertices-touch-target'];

    map.on('mouseenter', 'drawing-vertices-touch-target', () => {
      if (!latestPropsRef.current.isDrawingMode && map.getZoom() >= 8) {
        map.getCanvas().style.cursor = 'grab';
      }
    });

    map.on('mouseleave', 'drawing-vertices-touch-target', () => {
      if (draggingVertexIdxRef.current === null) {
        map.getCanvas().style.cursor = latestPropsRef.current.isDrawingMode ? 'crosshair' : '';
      }
    });

    const beginVertexDrag = (idx: number, prevent: () => void) => {
      prevent();
      draggingVertexIdxRef.current = idx;
      callbacksRef.current.onSelectVertexIndex?.(idx);
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    };

    map.on('mousedown', 'drawing-vertices-touch-target', (ev) => {
      if (latestPropsRef.current.isDrawingMode || map.getZoom() < 8) return;
      const idx = ev.features?.[0]?.properties?.vertexIndex;
      if (typeof idx === 'number') {
        beginVertexDrag(idx, () => ev.preventDefault());
      }
    });

    map.on('touchstart', 'drawing-vertices-touch-target', (ev) => {
      if (latestPropsRef.current.isDrawingMode || map.getZoom() < 8) return;
      const idx = ev.features?.[0]?.properties?.vertexIndex;
      if (typeof idx === 'number') {
        beginVertexDrag(idx, () => ev.preventDefault());
      }
    });

    map.on('mousemove', (ev) => {
      const dragIdx = draggingVertexIdxRef.current;
      if (dragIdx !== null) {
        const nextCoord: [number, number] = [
          Number(ev.lngLat.lng.toFixed(6)),
          Number(ev.lngLat.lat.toFixed(6)),
        ];
        callbacksRef.current.onUpdateVertexCoord?.(dragIdx, nextCoord);
      }
    });

    map.on('touchmove', (ev) => {
      const dragIdx = draggingVertexIdxRef.current;
      if (dragIdx !== null && ev.lngLat) {
        const nextCoord: [number, number] = [
          Number(ev.lngLat.lng.toFixed(6)),
          Number(ev.lngLat.lat.toFixed(6)),
        ];
        callbacksRef.current.onUpdateVertexCoord?.(dragIdx, nextCoord);
      }
    });

    const stopVertexDrag = () => {
      if (draggingVertexIdxRef.current !== null) {
        draggingVertexIdxRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = latestPropsRef.current.isDrawingMode ? 'crosshair' : '';
      }
    };

    map.on('mouseup', stopVertexDrag);
    map.on('touchend', stopVertexDrag);
    window.addEventListener('mouseup', stopVertexDrag);
    window.addEventListener('touchend', stopVertexDrag);

    map.on('click', (ev) => {
      if (draggingVertexIdxRef.current !== null) return;
      if (!latestPropsRef.current.isDrawingMode) {
        // 1. Check if user tapped an existing vertex corner
        const activeVertLayers = vertexHitLayers.filter((id) => Boolean(map.getLayer(id)));
        const vertFeatures =
          activeVertLayers.length > 0
            ? map.queryRenderedFeatures(ev.point, { layers: activeVertLayers })
            : [];
        if (vertFeatures.length > 0) {
          const idx = vertFeatures[0]?.properties?.vertexIndex;
          if (typeof idx === 'number') {
            callbacksRef.current.onSelectVertexIndex?.(idx);
            return;
          }
        }

        // 2. Check if user clicked an edge midpoint handle to insert a new corner
        if (map.getLayer('drawing-midpoints-circles')) {
          const midFeatures = map.queryRenderedFeatures(ev.point, {
            layers: ['drawing-midpoints-circles'],
          });
          if (midFeatures.length > 0) {
            const edgeIdx = midFeatures[0]?.properties?.edgeIndex;
            if (typeof edgeIdx === 'number' && callbacksRef.current.onInsertVertexAfter) {
              callbacksRef.current.onInsertVertexAfter(edgeIdx, [
                Number(ev.lngLat.lng.toFixed(6)),
                Number(ev.lngLat.lat.toFixed(6)),
              ]);
              return;
            }
          }
        }

        // 3. Check if capability overlay benchmark/zone was clicked to show [Why?] explanation (non-blocking)
        if (latestPropsRef.current.capabilityOverlayEnabled && callbacksRef.current.onClickCapabilityFeature) {
          const capLayers = ['capability-footprints-points', 'capability-footprints-fill'].filter((id) =>
            Boolean(map.getLayer(id))
          );
          if (capLayers.length > 0) {
            const capHits = map.queryRenderedFeatures(ev.point, { layers: capLayers });
            const hitProps = capHits[0]?.properties as Record<string, unknown> | undefined;
            if (hitProps?.status) {
              const parseArr = (v: unknown): string[] => {
                if (Array.isArray(v)) return v.map(String);
                if (typeof v === 'string') {
                  try {
                    const p = JSON.parse(v);
                    return Array.isArray(p) ? p.map(String) : [];
                  } catch {
                    return v ? [v] : [];
                  }
                }
                return [];
              };
              callbacksRef.current.onClickCapabilityFeature({
                status: hitProps.status as AnalysisCapabilityStatus,
                title: String(hitProps.title ?? 'Region Capability Notice'),
                explanation: String(
                  hitProps.status === 'CONFIRMED_UNSUPPORTED'
                    ? "This analysis isn't available here yet. You can still select and save your field."
                    : hitProps.title ?? 'Region capability notice'
                ),
                reasons: parseArr(hitProps.reasons),
                alternatives: parseArr(hitProps.alternatives),
              });
            }
          }
        }
      }

      const clicked: [number, number] = [
        Number(ev.lngLat.lng.toFixed(5)),
        Number(ev.lngLat.lat.toFixed(5)),
      ];
      if (latestPropsRef.current.isDrawingMode) {
        callbacksRef.current.onAddDrawingVertex(clicked);
      } else {
        callbacksRef.current.onSelectPoint(clicked);
      }
    });

    return () => {
      window.removeEventListener('mouseup', stopVertexDrag);
      window.removeEventListener('touchend', stopVertexDrag);
      isMapLoadedRef.current = false;
      mapRef.current = null;
      try {
        map.remove();
      } catch {
        // Ignore teardown issues
      }
    };
  }, [force2DFallback, syncAllGeoJsonSources, updateRenderStatus]);

  // Update cursor cleanly on drawing mode toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoadedRef.current) return;
    map.getCanvas().style.cursor = isDrawingMode ? 'crosshair' : '';
  }, [isDrawingMode]);

  // Sync GeoJSON data layers whenever coordinates, polygon, vertices, overlays, or layer changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoadedRef.current) return;
    syncAllGeoJsonSources(map);
  }, [
    selectedCoords,
    fieldPinCoords,
    polygon,
    activeLayerId,
    drawingVertices,
    selectedVertexIndex,
    isDrawingMode,
    countriesData,
    capabilityOverlayEnabled,
    capabilityGeoJson,
    suggestedBoundary,
    gpsTrackPoints,
    showEoSupportBox,
    syncAllGeoJsonSources,
  ]);

  // Respond to external selectedCoords or zoomLevel prop changes with smooth flight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoadedRef.current) return;

    const coordsChanged = coordsDiffer(prevExternalCoordsRef.current, selectedCoords);
    const zoomChanged = Math.abs(prevExternalZoomRef.current - zoomLevel) > 0.15;

    if (!coordsChanged && !zoomChanged) return;

    prevExternalCoordsRef.current = selectedCoords;
    prevExternalZoomRef.current = zoomLevel;
    setLiveCenter(selectedCoords);
    setLiveZoom(zoomLevel);

    if (reducedMotion) {
      map.jumpTo({ center: selectedCoords, zoom: zoomLevel });
    } else {
      map.flyTo({
        center: selectedCoords,
        zoom: zoomLevel,
        speed: 1.45,
        curve: 1.35,
        essential: true,
      });
    }
  }, [selectedCoords, zoomLevel, reducedMotion]);

  // Switch basemap mode cleanly
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoadedRef.current) return;
    remoteTileFailuresRef.current = 0;
    consecutiveTileErrorsRef.current = 0;
    remoteTilesLoadedRef.current = 0;
    imageryTilesLoadedRef.current = 0;

    map.setStyle(
      buildEarthGlobeStyle({
        basemapMode,
        countriesData: latestPropsRef.current.countriesData,
      })
    );
    syncAllGeoJsonSources(map);

    if (basemapMode === 'OFFLINE_NATURAL_EARTH') {
      setTilesStreaming(false);
      setProviderStatus('READY');
      updateRenderStatus('VECTOR_LOCAL_OFFLINE');
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setTilesStreaming(false);
      setProviderStatus('OFFLINE');
      updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
      return;
    }

    if (
      basemapMode === 'VECTOR_MAP' &&
      vectorTileErrorsRef.current === 0 &&
      (vectorTilesLoadedRef.current > 0 ||
        (Boolean(map.getSource('openfreemap')) && map.isSourceLoaded('openfreemap')))
    ) {
      setTilesStreaming(false);
      setProviderStatus('READY');
      updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
      return;
    }

    setProviderStatus('LOADING');
    updateRenderStatus('REMOTE_LOADING');

    if (basemapMode === 'VECTOR_MAP') {
      const fallbackTimer = setTimeout(() => {
        if (latestPropsRef.current.basemapMode !== 'VECTOR_MAP') return;
        if (renderStatusRef.current !== 'REMOTE_LOADING') return;
        if (
          vectorTileErrorsRef.current === 0 &&
          (vectorTilesLoadedRef.current > 0 ||
            (Boolean(map.getSource('openfreemap')) && map.isSourceLoaded('openfreemap')))
        ) {
          setTilesStreaming(false);
          setProviderStatus('READY');
          updateRenderStatus('LIVE_REMOTE_AND_VECTOR');
        } else {
          setTilesStreaming(false);
          setProviderStatus('FALLBACK_ONLY');
          updateRenderStatus('VECTOR_LOCAL_OFFLINE');
        }
      }, 6000);
      return () => clearTimeout(fallbackTimer);
    }
  }, [basemapMode, syncAllGeoJsonSources, updateRenderStatus]);

  // Toggle projection cleanly between 3D Globe & 2D Flat Mercator
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoadedRef.current) return;
    try {
      map.setProjection({ type: projectionMode });
    } catch {
      // Safe fallback
    }
  }, [projectionMode]);

  const handleRetryProvider = () => {
    const map = mapRef.current;
    if (!map) return;
    remoteTileFailuresRef.current = 0;
    consecutiveTileErrorsRef.current = 0;
    remoteTilesLoadedRef.current = 0;
    imageryTilesLoadedRef.current = 0;
    setProviderStatus('LOADING');
    updateRenderStatus('REMOTE_LOADING');
    try {
      map.setStyle(
        buildEarthGlobeStyle({
          basemapMode,
          countriesData: latestPropsRef.current.countriesData,
        })
      );
    } catch {
      updateRenderStatus('IMAGERY_PROVIDER_BLOCKED');
    }
  };

  const handleZoomStep = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const nextZoom = Math.max(1.0, Math.min(18.0, map.getZoom() + delta));
    if (reducedMotion) {
      map.jumpTo({ zoom: nextZoom });
    } else {
      map.easeTo({ zoom: nextZoom, duration: 280 });
    }
  };

  const handleResetOrbit = () => {
    const map = mapRef.current;
    if (!map) return;
    if (reducedMotion) {
      map.jumpTo({ center: [15, 25], zoom: 1.45, pitch: 0, bearing: 0 });
    } else {
      map.flyTo({ center: [15, 25], zoom: 1.45, pitch: 0, bearing: 0, speed: 1.35 });
    }
  };

  const activeLayerSpec = EO_OVERLAY_CATALOG[activeLayerId] ?? EO_OVERLAY_CATALOG.HLS_REFLECTANCE!;

  const statusBadgeText =
    renderStatus === 'IMAGERY_PROVIDER_BLOCKED'
      ? 'Bundled Natural Earth 3D Globe (CC0)'
      : renderStatus === 'REMOTE_LOADING'
        ? 'Loading Earth Observation Layers…'
      : renderStatus === 'VECTOR_LOCAL_OFFLINE'
        ? 'Natural Earth 1:110m Vector Globe (CC0)'
        : renderStatus === 'FALLBACK_ONLY'
          ? 'Interactive 2D Vector Atlas'
          : basemapMode === 'VECTOR_MAP'
            ? 'OpenFreeMap Vector Globe (OSM ODbL)'
            : 'Historical Satellite Mosaic · EOX S2Cloudless 2016 (CC BY 4.0) + NASA GIBS';

  if (webglStatus === 'FAILED' || force2DFallback) {
    return (
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl ${
          compactMode ? 'h-[320px] sm:h-[400px]' : 'h-[350px] sm:h-[460px] lg:h-[580px]'
        }`}
      >
        <SvgFallbackMap
          selectedCoords={selectedCoords}
          zoomLevel={zoomLevel}
          polygon={polygon}
          drawingVertices={drawingVertices}
          selectedVertexIndex={selectedVertexIndex}
          isDrawingMode={isDrawingMode}
          countriesGeoJson={countriesData}
          activeLayerId={activeLayerId}
          capabilityOverlayEnabled={capabilityOverlayEnabled}
          capabilityGeoJson={capabilityGeoJson}
          suggestedBoundary={suggestedBoundary}
          onSelectPoint={onSelectPoint}
          onAddDrawingVertex={onAddDrawingVertex}
          onSelectVertexIndex={onSelectVertexIndex}
          reasonText={
            fallbackReason || '2D diagnostic map view enabled while WebGL globe is bypassed.'
          }
          onRetryWebGl={
            force2DFallback
              ? () => {
                  setForce2DFallback(false);
                  setWebglStatus('INITIALIZING');
                }
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-white/15 bg-[#020611] shadow-[0_24px_80px_-24px_rgba(2,132,199,0.28)] ${
        compactMode ? 'h-[340px] sm:h-[400px]' : 'h-[370px] sm:h-[460px] lg:h-[580px]'
      }`}
      data-testid="maplibre-3d-canvas"
      data-webgl-status={webglStatus}
      data-map-projection={projectionMode}
      data-basemap-mode={basemapMode}
      data-render-status={renderStatus}
      data-provider-status={providerStatus}
      data-tiles-streaming={tilesStreaming ? 'true' : 'false'}
      data-viewport-active={isGlobeInView && isTabVisible ? 'true' : 'false'}
      data-live-zoom={liveZoom.toFixed(2)}
      data-live-center={`${liveCenter[0].toFixed(4)},${liveCenter[1].toFixed(4)}`}
      data-countries-loaded={countriesData.features.length}
    >
      {/* MapLibre GL Canvas Mount */}
      <div
        ref={mapContainerRef}
        role="region"
        className="h-full w-full"
        aria-label="Interactive 3D Planetary Earth Globe powered by MapLibre GL"
      />

      {/* Top-Left Compact Telemetry & Status Pill */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.25rem)] flex-col gap-1.5">
        <div className="pointer-events-auto inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-[#040a18]/80 px-3 py-1 text-[11px] text-slate-200 backdrop-blur-md">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              renderStatus === 'IMAGERY_PROVIDER_BLOCKED'
                ? 'bg-amber-400'
                : webglStatus === 'READY'
                  ? 'bg-emerald-400'
                  : 'bg-sky-400 animate-pulse'
            }`}
          />
          <span className="hidden font-medium text-white sm:inline">{statusBadgeText}</span>
          <span className="font-medium text-white sm:hidden">Interactive 3D Earth</span>
          {tilesStreaming && (renderStatus === 'LIVE_REMOTE_AND_VECTOR' || renderStatus === 'REMOTE_LOADING') && (
            <span className="hidden rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[9px] text-sky-200 md:inline">
              Streaming tiles…
            </span>
          )}
          <span className="text-slate-400">·</span>
          <span className="font-mono text-[10px] text-sky-300">
            z{liveZoom.toFixed(1)} · {liveCenter[1].toFixed(1)}°, {liveCenter[0].toFixed(1)}°
          </span>
        </div>

        {renderStatus === 'IMAGERY_PROVIDER_BLOCKED' && (
          <div
            role="status"
            className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-950/85 px-3 py-1.5 text-[11px] text-amber-100 backdrop-blur-md"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              Using bundled Natural Earth 1:110m 3D globe while remote satellite tiles are unavailable.
            </span>
            <button
              type="button"
              data-testid="globe-retry-provider-btn"
              onClick={handleRetryProvider}
              className="rounded-md border border-amber-300/40 bg-amber-900/70 px-2 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-800/80 cursor-pointer"
            >
              Retry Provider
            </button>
          </div>
        )}
      </div>

      {/* Top-Right Compact Glass Camera & Overlay Controls */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-white/15 bg-[#040a18]/85 text-slate-200 shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={() => handleZoomStep(1.2)}
            aria-label="Zoom in globe"
            title="Zoom in"
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center border-b border-white/10 transition hover:bg-white/10 hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoomStep(-1.2)}
            aria-label="Zoom out globe"
            title="Zoom out"
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center border-b border-white/10 transition hover:bg-white/10 hover:text-white"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetOrbit}
            aria-label="Reset global orbital camera"
            title="Reset orbital view"
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center border-b border-white/10 transition hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            data-testid="toggle-projection-btn"
            onClick={() => setProjectionMode((prev) => (prev === 'globe' ? 'mercator' : 'globe'))}
            aria-label="Switch between 3D Globe and 2D Mercator projection"
            title={projectionMode === 'globe' ? 'Switch to flat Mercator map' : 'Switch to 3D Globe'}
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center transition hover:bg-white/10 hover:text-white"
          >
            {projectionMode === 'globe' ? (
              <MapIcon className="h-3.5 w-3.5 text-sky-300" />
            ) : (
              <Globe2 className="h-3.5 w-3.5 text-emerald-300" />
            )}
          </button>
        </div>

        {onToggleCapabilityOverlay && (
          <button
            type="button"
            data-testid="toggle-capability-overlay-btn"
            aria-pressed={capabilityOverlayEnabled}
            onClick={onToggleCapabilityOverlay}
            title="Toggle regional analysis availability overlay"
            className={`inline-flex min-h-[44px] min-w-[44px] sm:min-h-[36px] items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md transition cursor-pointer ${
              capabilityOverlayEnabled
                ? 'border-rose-400/60 bg-rose-950/85 text-rose-100'
                : 'border-white/15 bg-[#040a18]/85 text-slate-200 hover:bg-white/10'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Analysis availability</span>
          </button>
        )}

        {capabilityOverlayEnabled && (
          <div
            data-testid="capability-overlay-legend"
            className="max-w-[205px] rounded-xl border border-white/15 bg-[#040a18]/90 px-2.5 py-2 text-[10px] text-slate-200 backdrop-blur-md space-y-1 shadow-lg"
          >
            <div className="font-semibold text-white">Analysis Availability</div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-[#f87171] bg-[#ef4444]/35" />
              <span>Confirmed unsupported</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-[#a78bfa] bg-[#8b5cf6]/30" />
              <span>{CAPABILITY_OVERLAY_META.RESEARCH_ONLY.shortLabel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-500 bg-transparent" />
              <span>Unassessed (neutral)</span>
            </div>
          </div>
        )}
      </div>

      {/* Non-blocking Capability Toast when unsupported point/zone is tapped */}
      {capabilityToast && capabilityToast.status === 'CONFIRMED_UNSUPPORTED' && (
        <div
          role="status"
          data-testid="capability-unsupported-toast"
          className="pointer-events-auto absolute left-3 right-14 bottom-20 z-20 max-h-[168px] overflow-y-auto rounded-xl border border-rose-400/50 bg-[#1B0D14]/95 p-3 text-xs text-rose-100 shadow-2xl backdrop-blur-md sm:left-3 sm:right-auto sm:max-w-[min(22rem,calc(100%-12.5rem))] sm:bottom-16"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" />
              <div className="space-y-1">
                <div className="font-semibold text-white">{capabilityToast.explanation}</div>
                <button
                  type="button"
                  data-testid="capability-toast-why-btn"
                  onClick={() => setShowToastDetails((v) => !v)}
                  className="font-semibold text-[#72E4F1] underline cursor-pointer"
                >
                  {showToastDetails ? 'Hide details' : 'Why?'}
                </button>
              </div>
            </div>
            {onDismissCapabilityToast && (
              <button
                type="button"
                aria-label="Dismiss availability notice"
                onClick={onDismissCapabilityToast}
                className="rounded p-1 text-slate-300 hover:bg-white/10 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {showToastDetails && (
            <div className="mt-2 border-t border-rose-400/30 pt-2 text-[11px] text-rose-100/90 space-y-1">
              {capabilityToast.reasons.map((r, i) => (
                <p key={i}>• {r}</p>
              ))}
              {capabilityToast.alternatives[0] && (
                <p className="text-[#72E4F1]">Alternative: {capabilityToast.alternatives[0]}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Unified Non-Overlapping Bottom Overlay Row (Boundary Bar Left + Open Data Attribution Right) */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        <div className="flex max-w-full flex-col gap-1.5 sm:max-w-lg">
          {liveZoom >= 14.2 && basemapMode === 'SATELLITE_HYBRID' && (
            <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-[#040a18]/85 px-2.5 py-1 text-[10px] text-sky-200 backdrop-blur-md">
              <Layers className="h-3 w-3 shrink-0 text-sky-300" />
              <span>
                Zoom z{liveZoom.toFixed(1)}: Sentinel-2 2016 historical mosaic native z14 (cleanly
                upscaled for parcel tracing)
              </span>
            </div>
          )}

          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-white/15 bg-[#040a18]/85 p-1.5 text-xs text-slate-200 backdrop-blur-md">
            <button
              type="button"
              data-testid="map-draw-toggle-btn"
              onClick={onToggleDrawingMode}
              className={`inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition ${
                isDrawingMode
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-white/10 text-white hover:bg-white/15'
              }`}
            >
              {isDrawingMode ? <Crosshair className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              <span>{isDrawingMode ? 'Tap Map Corners' : 'Draw Field Boundary'}</span>
            </button>

            {drawingVertices.length >= 3 && (
              <button
                type="button"
                data-testid="map-complete-polygon-btn"
                onClick={onCompleteDrawing}
                className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1 rounded-lg bg-sky-500/25 px-2.5 py-1.5 font-medium text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/35"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Done ({drawingVertices.length} pts)</span>
              </button>
            )}

            {typeof selectedVertexIndex === 'number' &&
              drawingVertices.length > 3 &&
              onDeleteVertex &&
              !isDrawingMode && (
                <button
                  type="button"
                  data-testid="map-delete-vertex-btn"
                  onClick={() => onDeleteVertex(selectedVertexIndex)}
                  aria-label={`Del #${selectedVertexIndex + 1} (Delete selected corner vertex)`}
                  title="Delete selected corner vertex"
                  className="inline-flex min-h-[44px] sm:min-h-[36px] items-center gap-1 rounded-lg bg-amber-500/20 px-2 py-1.5 text-amber-200 hover:bg-amber-500/30"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  <span>Del #{selectedVertexIndex + 1}</span>
                </button>
              )}

            {drawingVertices.length > 0 && (
              <button
                type="button"
                data-testid="map-undo-vertex-btn"
                onClick={onUndoVertex}
                aria-label="Undo last vertex"
                className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-slate-200 hover:bg-white/15"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            )}

            {(polygon || drawingVertices.length > 0) && (
              <button
                type="button"
                data-testid="map-clear-polygon-btn"
                onClick={onClearPolygon}
                aria-label="Clear field boundary"
                className="inline-flex min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center gap-1 rounded-lg bg-rose-500/20 px-2 py-1.5 text-rose-200 hover:bg-rose-500/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              data-testid="toggle-2d-fallback-btn"
              onClick={() => setForce2DFallback(true)}
              className="hidden rounded-lg px-2 py-1.5 text-[10px] text-slate-400 hover:bg-white/10 hover:text-slate-200 sm:inline-flex"
              title="Switch to 2D SVG accessibility fallback"
            >
              2D Fallback
            </button>
          </div>
        </div>

        {/* Bottom-Right Open Data Attribution Pill (never overlaps boundary toolbar) */}
        <div
          data-testid="globe-attribution-pill"
          className="pointer-events-auto hidden max-w-full rounded-lg border border-white/10 bg-[#040a18]/80 px-2.5 py-1 text-[10px] text-slate-300 backdrop-blur-md xl:block"
        >
          <span>
            {activeLayerSpec.shortLabel} · EOxCloudless 2016 (CC BY 4.0) · Copernicus Sentinel-2 · ©
            OpenFreeMap / OSM · NASA GIBS
          </span>
        </div>
      </div>
    </div>
  );
}
