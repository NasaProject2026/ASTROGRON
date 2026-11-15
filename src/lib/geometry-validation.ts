import area from '@turf/area';
import length from '@turf/length';
import kinks from '@turf/kinks';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { lineString, multiPolygon, point, polygon as turfPolygon } from '@turf/helpers';

export const MAX_BOUNDARY_IMPORT_BYTES = 262_144; // 256 KB upper cap for GeoJSON/KML/GPX files
export const MAX_VERTEX_COUNT = 2048;

export interface GeodesicMetrics {
  areaM2: number;
  areaHa: number;
  areaAcres: number;
  perimeterMeters: number;
  vertexCount: number;
  ringCount: number;
  hasHoles: boolean;
  isMultiPolygon: boolean;
  centroidLonLat: [number, number];
  bbox: [number, number, number, number];
}

export interface GeometryImportCheck {
  valid: boolean;
  format: 'GEOJSON' | 'KML' | 'GPX' | 'COORDS' | 'UNKNOWN';
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  metrics?: GeodesicMetrics;
  errors: string[];
  warnings: string[];
}

export interface ClippedTileCheck {
  suspectedClipped: boolean;
  reasons: string[];
}

export interface GpsSampleInput {
  lon: number;
  lat: number;
  accuracyMeters: number;
  timestampMs: number;
}

export interface GpsSampleEvaluation {
  accepted: boolean;
  qualityTier: 'HIGH' | 'MODERATE' | 'POOR' | 'REJECTED';
  coord?: [number, number];
  reason?: string;
}

function toGeoFeature(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  return geom.type === 'Polygon'
    ? turfPolygon(geom.coordinates)
    : multiPolygon(geom.coordinates);
}

/**
 * Ensures WGS84 outer/inner rings are explicitly closed ([first] === [last]).
 */
export function ensureClosedRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return [];
  const cleaned: [number, number][] = ring.map(([lon, lat]) => [
    Number(lon.toFixed(7)),
    Number(lat.toFixed(7)),
  ]);
  const first = cleaned[0]!;
  const last = cleaned[cleaned.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned;
}

/**
 * Computes WGS84 geodesic area (ha & acres), perimeter (m), centroid, and bounding box via @turf/turf.
 */
export function computeGeodesicMetrics(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): GeodesicMetrics {
  const feat = toGeoFeature(geom);
  const areaM2 = Math.max(0, area(feat));
  const areaHa = Number((areaM2 / 10_000).toFixed(3));
  const areaAcres = Number((areaHa * 2.4710538).toFixed(3));

  let perimeterMeters = 0;
  let vertexCount = 0;
  let ringCount = 0;
  let hasHoles = false;
  let minLon = 180;
  let maxLon = -180;
  let minLat = 90;
  let maxLat = -90;
  let sumLon = 0;
  let sumLat = 0;
  let outerPts = 0;

  const accumulatePolygon = (rings: number[][][]) => {
    rings.forEach((ring, rIdx) => {
      ringCount += 1;
      if (rIdx > 0) hasHoles = true;
      vertexCount += ring.length;
      if (ring.length >= 2) {
        perimeterMeters += length(lineString(ring), { units: 'meters' });
      }
      if (rIdx === 0) {
        const limit = Math.max(1, ring.length - 1);
        for (let i = 0; i < limit; i += 1) {
          const lon = ring[i]?.[0] ?? 0;
          const lat = ring[i]?.[1] ?? 0;
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          sumLon += lon;
          sumLat += lat;
          outerPts += 1;
        }
      }
    });
  };

  if (geom.type === 'Polygon') {
    accumulatePolygon(geom.coordinates);
  } else {
    for (const poly of geom.coordinates) {
      accumulatePolygon(poly);
    }
  }

  return {
    areaM2: Number(areaM2.toFixed(1)),
    areaHa,
    areaAcres,
    perimeterMeters: Number(perimeterMeters.toFixed(1)),
    vertexCount,
    ringCount,
    hasHoles,
    isMultiPolygon: geom.type === 'MultiPolygon',
    centroidLonLat:
      outerPts > 0
        ? [Number((sumLon / outerPts).toFixed(6)), Number((sumLat / outerPts).toFixed(6))]
        : [0, 0],
    bbox: [
      Number(minLon.toFixed(6)),
      Number(minLat.toFixed(6)),
      Number(maxLon.toFixed(6)),
      Number(maxLat.toFixed(6)),
    ],
  };
}

/**
 * Validates any Polygon/MultiPolygon object for WGS84 range, finite values, non-degenerate area,
 * self-intersections (@turf/kinks), vertex bounds, and preserves holes / MultiPolygons cleanly.
 */
export function validatePolygonGeometry(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon
): { valid: boolean; metrics?: GeodesicMetrics; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const polygons =
    geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

  if (polygons.length === 0) {
    return { valid: false, errors: ['MultiPolygon contains no polygon parts.'], warnings };
  }

  let totalVertices = 0;
  for (let pIdx = 0; pIdx < polygons.length; pIdx += 1) {
    const rings = polygons[pIdx]!;
    if (!Array.isArray(rings) || rings.length === 0) {
      errors.push(`Polygon part ${pIdx + 1} has no coordinate rings.`);
      continue;
    }
    if (rings.length > 1) {
      warnings.push(
        `Part ${pIdx + 1} includes ${rings.length - 1} interior exclusion/hole ring(s); holes are preserved rather than silently flattened.`
      );
    }

    rings.forEach((ring, rIdx) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        errors.push(`Ring ${pIdx + 1}.${rIdx + 1} needs at least 3 distinct corners plus closing point.`);
        return;
      }
      totalVertices += ring.length;
      for (let i = 0; i < ring.length; i += 1) {
        const pt = ring[i];
        if (!Array.isArray(pt) || pt.length < 2) {
          errors.push(`Coordinate ${i + 1} in ring ${pIdx + 1}.${rIdx + 1} is invalid.`);
          return;
        }
        const [lon, lat] = pt;
        if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
          errors.push(`Non-finite coordinate in ring ${pIdx + 1}.${rIdx + 1}.`);
          return;
        }
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          errors.push(`Coordinate [${lon}, ${lat}] is outside WGS84 bounds [-180..180, -90..90].`);
          return;
        }
      }
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) {
        errors.push(`Ring ${pIdx + 1}.${rIdx + 1} is not closed (first and last coordinate must match).`);
      }
    });

    if (errors.length === 0) {
      try {
        const single = turfPolygon(rings);
        const intersections = kinks(single);
        if (intersections.features.length > 0) {
          errors.push(
            `Part ${pIdx + 1} has self-intersecting edges (${intersections.features.length} crossing point${intersections.features.length === 1 ? '' : 's'}). Move or undo crossing corners.`
          );
        }
      } catch (err) {
        errors.push(
          `Geometry topology check failed: ${err instanceof Error ? err.message : 'invalid polygon structure'}.`
        );
      }
    }
  }

  if (totalVertices > MAX_VERTEX_COUNT) {
    errors.push(`Boundary has ${totalVertices} vertices, exceeding maximum ${MAX_VERTEX_COUNT}.`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const metrics = computeGeodesicMetrics(geom);
  if (metrics.areaM2 < 50) {
    errors.push('Field area is less than 50 m² (degenerate or zero-area polygon).');
    return { valid: false, errors, warnings };
  }

  if (geom.type === 'MultiPolygon') {
    warnings.push(
      `MultiPolygon contains ${geom.coordinates.length} separate parcels; all parcels are preserved in total calculated area (${metrics.areaHa.toFixed(2)} ha).`
    );
  }

  return { valid: true, metrics, errors, warnings };
}

/**
 * Detects vector-tile edge clipping artifacts (e.g., straight orthogonal cut edges against a tile/query box).
 * Vector tiles / PMTiles clip polygons on tile seams and MUST NEVER be saved as final unverified full outlines.
 */
export function detectClippedTileEdgeGeometry(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  tileOrRequestBbox?: [number, number, number, number]
): ClippedTileCheck {
  const reasons: string[] = [];
  const rings =
    geom.type === 'Polygon'
      ? [geom.coordinates[0] ?? []]
      : geom.coordinates.map((p) => p[0] ?? []);

  for (const outer of rings) {
    if (outer.length < 4) continue;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const pt of outer) {
      minLon = Math.min(minLon, pt[0] ?? 0);
      maxLon = Math.max(maxLon, pt[0] ?? 0);
      minLat = Math.min(minLat, pt[1] ?? 0);
      maxLat = Math.max(maxLat, pt[1] ?? 0);
    }

    const eps = 1e-6;
    const touchesEdgeCount = outer.slice(0, -1).filter((pt) => {
      const lon = pt[0] ?? 0;
      const lat = pt[1] ?? 0;
      return (
        Math.abs(lon - minLon) < eps ||
        Math.abs(lon - maxLon) < eps ||
        Math.abs(lat - minLat) < eps ||
        Math.abs(lat - maxLat) < eps
      );
    }).length;

    // Exact 4-corner axis-aligned box matching request tile bbox
    if (tileOrRequestBbox) {
      const [tMinX, tMinY, tMaxX, tMaxY] = tileOrRequestBbox;
      const tol = Math.max((tMaxX - tMinX) * 0.005, 1e-5);
      const alignedToTile = outer.slice(0, -1).filter(
        ([x = 0, y = 0]) =>
          Math.abs(x - tMinX) < tol ||
          Math.abs(x - tMaxX) < tol ||
          Math.abs(y - tMinY) < tol ||
          Math.abs(y - tMaxY) < tol
      );
      if (alignedToTile.length >= 3) {
        reasons.push('Boundary vertices align directly with vector-tile clipping boundaries.');
      }
    }

    // Check long collinear edge locked onto global bbox extremes (>= 3 sequential boundary-clamped segments)
    let clampedEdges = 0;
    for (let i = 0; i < outer.length - 1; i += 1) {
      const [x1 = 0, y1 = 0] = outer[i]!;
      const [x2 = 0, y2 = 0] = outer[i + 1]!;
      const sameX = Math.abs(x1 - x2) < eps && (Math.abs(x1 - minLon) < eps || Math.abs(x1 - maxLon) < eps);
      const sameY = Math.abs(y1 - y2) < eps && (Math.abs(y1 - minLat) < eps || Math.abs(y1 - maxLat) < eps);
      if (sameX || sameY) clampedEdges += 1;
    }
    if (tileOrRequestBbox && outer.length > 6 && clampedEdges >= 2 && touchesEdgeCount >= 4) {
      reasons.push('Polygon exhibits multiple orthogonal tile-boundary clipped edges.');
    }
  }

  return {
    suspectedClipped: reasons.length > 0,
    reasons,
  };
}

/**
 * Checks whether a geographic query coordinate [lon, lat] falls inside (or immediately touches) a polygon.
 */
export function polygonContainsPoint(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  lonLat: [number, number]
): boolean {
  try {
    const pt = point(lonLat);
    if (geom.type === 'Polygon') {
      return booleanPointInPolygon(pt, turfPolygon(geom.coordinates), { ignoreBoundary: false });
    }
    return geom.coordinates.some((rings) =>
      booleanPointInPolygon(pt, turfPolygon(rings), { ignoreBoundary: false })
    );
  } catch {
    return false;
  }
}

function rejectUnsafeXml(rawText: string): string | null {
  if (!rawText || !rawText.trim()) return 'Uploaded boundary file is empty.';
  const bytes = new TextEncoder().encode(rawText).length;
  if (bytes > MAX_BOUNDARY_IMPORT_BYTES) {
    return `File size (${bytes} bytes) exceeds maximum allowed limit of ${MAX_BOUNDARY_IMPORT_BYTES} bytes.`;
  }
  const lower = rawText.toLowerCase();
  if (
    lower.includes('<!doctype') ||
    lower.includes('<!entity') ||
    lower.includes('<script') ||
    lower.includes('javascript:')
  ) {
    return 'Unsafe XML/script construct blocked for security (DOCTYPE/ENTITY/script tags are disallowed).';
  }
  return null;
}

function parseKmlCoordTupleList(rawCoords: string): [number, number][] {
  const tokens = rawCoords.trim().split(/\s+/);
  const pts: [number, number][] = [];
  for (const tok of tokens) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      pts.push([lon, lat]);
    }
  }
  return ensureClosedRing(pts);
}

/**
 * Safely parses KML <Polygon> (including <outerBoundaryIs> / <innerBoundaryIs> / multiple polygons)
 * using strict tag regex without evaluating external XML entities or DOM script execution.
 */
export function parseKmlToFieldGeometry(rawXml: string): GeometryImportCheck {
  const securityErr = rejectUnsafeXml(rawXml);
  if (securityErr) {
    return { valid: false, format: 'KML', errors: [securityErr], warnings: [] };
  }

  const polygonBlocks = [...rawXml.matchAll(/<(?:\w+:)?Polygon\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Polygon>/gi)];
  if (polygonBlocks.length === 0) {
    return {
      valid: false,
      format: 'KML',
      errors: ['No KML <Polygon> element found. Ensure your KML file contains at least one field polygon boundary.'],
      warnings: [],
    };
  }

  const parsedPolygons: number[][][][] = [];
  for (const blockMatch of polygonBlocks) {
    const body = blockMatch[1] ?? '';
    const outerMatch = body.match(
      /<(?:\w+:)?outerBoundaryIs\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i
    );
    if (!outerMatch) continue;
    const outerRing = parseKmlCoordTupleList(outerMatch[1] ?? '');
    if (outerRing.length < 4) continue;

    const rings: number[][][] = [outerRing];
    const innerMatches = [
      ...body.matchAll(
        /<(?:\w+:)?innerBoundaryIs\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/gi
      ),
    ];
    for (const inner of innerMatches) {
      const hole = parseKmlCoordTupleList(inner[1] ?? '');
      if (hole.length >= 4) rings.push(hole);
    }
    parsedPolygons.push(rings);
  }

  if (parsedPolygons.length === 0) {
    return {
      valid: false,
      format: 'KML',
      errors: ['KML polygons lacked valid WGS84 lon,lat coordinates inside <outerBoundaryIs>.'],
      warnings: [],
    };
  }

  const geom: GeoJSON.Polygon | GeoJSON.MultiPolygon =
    parsedPolygons.length === 1
      ? { type: 'Polygon', coordinates: parsedPolygons[0]! }
      : { type: 'MultiPolygon', coordinates: parsedPolygons };

  const validation = validatePolygonGeometry(geom);
  return {
    valid: validation.valid,
    format: 'KML',
    geometry: validation.valid ? geom : undefined,
    metrics: validation.metrics,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

/**
 * Safely parses GPX tracks (<trkpt lat= lon=>) or routes (<rtept lat= lon=>) into a closed field Polygon.
 */
export function parseGpxToFieldGeometry(rawXml: string): GeometryImportCheck {
  const securityErr = rejectUnsafeXml(rawXml);
  if (securityErr) {
    return { valid: false, format: 'GPX', errors: [securityErr], warnings: [] };
  }

  const pts: [number, number][] = [];
  const ptRegex = /<(?:\w+:)?(?:trkpt|rtept)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = ptRegex.exec(rawXml)) !== null) {
    const attrs = m[1] ?? '';
    const latMatch = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
    const lonMatch = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
    if (!latMatch || !lonMatch) continue;
    const lat = Number(latMatch[1]);
    const lon = Number(lonMatch[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      pts.push([lon, lat]);
    }
  }

  if (pts.length < 3) {
    return {
      valid: false,
      format: 'GPX',
      errors: ['GPX file needs at least 3 track or route coordinates (<trkpt> or <rtept>) to close a field perimeter.'],
      warnings: [],
    };
  }

  const geom: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [ensureClosedRing(pts)],
  };

  const validation = validatePolygonGeometry(geom);
  const warnings = [
    ...validation.warnings,
    'GPX perimeter tracks are automatically closed from end point back to start point; review corners on satellite imagery before saving.',
  ];
  return {
    valid: validation.valid,
    format: 'GPX',
    geometry: validation.valid ? geom : undefined,
    metrics: validation.metrics,
    errors: validation.errors,
    warnings,
  };
}

/**
 * Parses pasted coordinate list lines (`lat, lon` or `lon lat`, >= 3 points) or raw GeoJSON / KML / GPX.
 */
export function importFieldBoundaryText(
  rawText: string,
  fileNameHint?: string
): GeometryImportCheck {
  const trimmed = rawText.trim();
  const hint = (fileNameHint ?? '').toLowerCase();

  if (hint.endsWith('.kml') || trimmed.startsWith('<?xml') && /<kml/i.test(trimmed) || /<(?:\w+:)?kml\b/i.test(trimmed)) {
    return parseKmlToFieldGeometry(rawText);
  }
  if (hint.endsWith('.gpx') || /<(?:\w+:)?gpx\b/i.test(trimmed)) {
    return parseGpxToFieldGeometry(rawText);
  }

  if (trimmed.startsWith('{') || hint.endsWith('.json') || hint.endsWith('.geojson')) {
    const byteLen = new TextEncoder().encode(rawText).length;
    if (byteLen > MAX_BOUNDARY_IMPORT_BYTES) {
      return {
        valid: false,
        format: 'GEOJSON',
        errors: [`GeoJSON exceeds ${MAX_BOUNDARY_IMPORT_BYTES} bytes.`],
        warnings: [],
      };
    }
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      let geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
      const warnings: string[] = [];
      if (obj?.type === 'Polygon' || obj?.type === 'MultiPolygon') {
        geom = obj as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      } else if (obj?.type === 'Feature' && obj.geometry && typeof obj.geometry === 'object') {
        const g = obj.geometry as Record<string, unknown>;
        if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
          geom = g as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        }
      } else if (obj?.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        const polyFeatures = (obj.features as Array<Record<string, unknown>>).filter((f) => {
          const g = f?.geometry as Record<string, unknown> | undefined;
          return g?.type === 'Polygon' || g?.type === 'MultiPolygon';
        });
        if (polyFeatures.length === 1) {
          geom = polyFeatures[0]!.geometry as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        } else if (polyFeatures.length > 1) {
          const allPolys: number[][][][] = [];
          for (const pf of polyFeatures) {
            const g = pf.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
            if (g.type === 'Polygon') allPolys.push(g.coordinates);
            else allPolys.push(...g.coordinates);
          }
          geom = { type: 'MultiPolygon', coordinates: allPolys };
          warnings.push(
            `Imported ${polyFeatures.length} polygon features from FeatureCollection combined as MultiPolygon.`
          );
        }
      }

      if (!geom) {
        return {
          valid: false,
          format: 'GEOJSON',
          errors: ['GeoJSON must contain a Polygon, MultiPolygon, Feature, or FeatureCollection with polygon geometries.'],
          warnings,
        };
      }
      const res = validatePolygonGeometry(geom);
      return {
        valid: res.valid,
        format: 'GEOJSON',
        geometry: res.valid ? geom : undefined,
        metrics: res.metrics,
        errors: res.errors,
        warnings: [...warnings, ...res.warnings],
      };
    } catch {
      return {
        valid: false,
        format: 'GEOJSON',
        errors: ['Invalid JSON syntax in GeoJSON input.'],
        warnings: [],
      };
    }
  }

  // Fallback: raw coordinate pair lines (`lat, lon` or `lon, lat` auto-disambiguated when possible or [lon, lat] standard)
  const lines = trimmed
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 3) {
    const pts: [number, number][] = [];
    for (const line of lines) {
      const nums = line
        .replace(/[[\]()]/g, ' ')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
        pts.push([nums[0]!, nums[1]!]);
      }
    }
    if (pts.length >= 3) {
      const geom: GeoJSON.Polygon = { type: 'Polygon', coordinates: [ensureClosedRing(pts)] };
      const res = validatePolygonGeometry(geom);
      return {
        valid: res.valid,
        format: 'COORDS',
        geometry: res.valid ? geom : undefined,
        metrics: res.metrics,
        errors: res.errors,
        warnings: [
          ...res.warnings,
          'Parsed raw coordinates in [longitude, latitude] WGS84 order.',
        ],
      };
    }
  }

  return {
    valid: false,
    format: 'UNKNOWN',
    errors: ['Unrecognized boundary format. Upload or paste valid GeoJSON, KML, GPX, or at least 3 [longitude, latitude] coordinate pairs.'],
    warnings: [],
  };
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Evaluates a smartphone GPS sample for perimeter walking: flags accuracy quality,
 * suppresses stationary jitter (< 2.5 m), and blocks extreme GPS teleport spikes (> 80 m/s).
 */
export function evaluateGpsPerimeterSample(
  existing: Array<{ coord: [number, number]; timestampMs: number }>,
  sample: GpsSampleInput
): GpsSampleEvaluation {
  if (
    !Number.isFinite(sample.lon) ||
    !Number.isFinite(sample.lat) ||
    sample.lon < -180 ||
    sample.lon > 180 ||
    sample.lat < -90 ||
    sample.lat > 90
  ) {
    return { accepted: false, qualityTier: 'REJECTED', reason: 'Invalid GPS coordinates.' };
  }

  const acc = Number.isFinite(sample.accuracyMeters) ? sample.accuracyMeters : 999;
  const qualityTier: GpsSampleEvaluation['qualityTier'] =
    acc <= 10 ? 'HIGH' : acc <= 30 ? 'MODERATE' : acc <= 80 ? 'POOR' : 'REJECTED';

  if (acc > 80) {
    return {
      accepted: false,
      qualityTier: 'REJECTED',
      reason: `GPS signal too coarse (±${Math.round(acc)} m > 80 m limit). Move to open sky or tap corner manually.`,
    };
  }

  const coord: [number, number] = [Number(sample.lon.toFixed(6)), Number(sample.lat.toFixed(6))];
  const last = existing[existing.length - 1];
  if (last) {
    const distM = haversineMeters(last.coord, coord);
    if (distM < 2.5) {
      return {
        accepted: false,
        qualityTier,
        reason: `Stationary jitter suppressed (${distM.toFixed(1)} m < 2.5 m minimum step).`,
      };
    }
    const dtSec = Math.max(0.25, (sample.timestampMs - last.timestampMs) / 1000);
    if (distM / dtSec > 80 && distM > 200) {
      return {
        accepted: false,
        qualityTier: 'REJECTED',
        reason: `Rejected implausible GPS jump (${Math.round(distM)} m in ${dtSec.toFixed(1)}s).`,
      };
    }
  }

  return { accepted: true, qualityTier, coord };
}
