import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import type { AsyncBuffer, FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';
import {
  computeGeodesicMetrics,
  detectClippedTileEdgeGeometry,
  polygonContainsPoint,
  validatePolygonGeometry,
} from '@/lib/geometry-validation';
import { sanitizeRemoteText, validateAllowlistedHttpsUrl } from '@/server/ssrf-guard';

export type FtwSourceEdition = 'FTW_V2E_GEOPARQUET' | 'CUSTOM_ENDPOINT';

export interface SuggestedFieldBoundary {
  id: string;
  sourceFeatureId: string;
  sourceEdition: FtwSourceEdition;
  sourceCollection: string;
  determinationMethod: string | null;
  determinationDatetime: string | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  areaHa: number;
  areaAcres: number;
  perimeterMeters: number;
  sourceDataset: string;
  sourceYear: number;
  license: string;
  attribution: string;
  rawModelScore: number | null;
  modelConfidence: number | null;
  scoreSemantics: 'UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100';
  scoreDisclaimer: string;
  geometryPassedLocalChecks: boolean;
  sourceVerifiedComplete: boolean;
  completenessVerified: boolean;
  completenessBasis: string;
  disclaimer: string;
}

export type FtwDetailedSuggestStatus =
  | 'FOUND'
  | 'NO_MATCH_AFTER_COMPLETE_SEARCH'
  | 'SEARCH_INCOMPLETE_LIMIT'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'COVERAGE_UNKNOWN'
  | 'INVALID_RESULT';

export interface FtwBoundarySuggestOutcome {
  ok: boolean;
  httpStatus: number;
  status:
    | 'FOUND'
    | 'NO_RELIABLE_BOUNDARY'
    | 'SEARCH_INCOMPLETE_LIMIT'
    | 'NO_MATCH_AFTER_COMPLETE_SEARCH'
    | 'UPSTREAM_TIMEOUT'
    | 'UPSTREAM_UNAVAILABLE'
    | 'COVERAGE_UNKNOWN'
    | 'INVALID_RESULT'
    | 'UNAVAILABLE'
    | 'ERROR';
  detailedStatus?: FtwDetailedSuggestStatus;
  providerConfigured: boolean;
  sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET' | 'CUSTOM_HTTPS_ENDPOINT' | 'UNCONFIGURED';
  utmZone?: string;
  datasetYear?: number;
  attribution: string;
  disclaimer: string;
  notice: string;
  suggestions: SuggestedFieldBoundary[];
  rejectedFragmentsCount: number;
  queryMeta?: {
    attemptedZones?: string[];
    totalMatchingRowGroups?: number;
    prunedRowGroups: number;
    scannedRowGroups?: number;
    scannedBboxRows: number;
    candidateBboxHits: number;
    scannedCandidates?: number;
    searchExhaustive?: boolean;
    coverageDataExists?: boolean;
    cacheHit?: boolean;
    parquetAreaM2: number | null;
    turfAreaM2: number | null;
    elapsedMs: number;
  };
}

export interface FtwBoundaryConfig {
  endpointUrl?: string;
  allowedHosts?: string[];
  apiKey?: string;
  datasetName?: string;
  datasetYear?: number;
  timeoutMs?: number;
  disableLiveParquet?: boolean;
  parquetBaseUrl?: string;
  parquetAllowedHosts?: string[];
  maxRowGroups?: number;
  maxCandidates?: number;
  fetchImpl?: typeof fetch;
}

export const FTW_2E_CATALOG_INFO = {
  catalogUrl: 'https://data.source.coop/ftw/global-data-2e/catalog.json',
  edition: '2nd Edition (ftw-global-data-2e)',
  supportedYears: [2025, 2024, 2023, 2018] as const,
  license: 'CC BY 4.0',
  crs: 'EPSG:4326',
  scoreSemantics: 'UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100' as const,
};

const DEFAULT_CUSTOM_TIMEOUT_MS = 6500;
const DEFAULT_PARQUET_TIMEOUT_MS = 65_000;
const MAX_PARQUET_RANGE_BYTES = 24 * 1024 * 1024;
const MAX_PRUNED_ROW_GROUPS = 4;
const MAX_GEOMETRY_CANDIDATES = 6;
const MAX_SUGGESTIONS_RETURNED = 3;
const FOOTER_CACHE_TTL_MS = 30 * 60_000;
const RESULT_CACHE_TTL_MS = 10 * 60_000;
const MAX_RESULT_CACHE_ENTRIES = 64;

const DEFAULT_PARQUET_BASE_URL = 'https://data.source.coop/ftw/global-data-2e/vector';
const DEFAULT_PARQUET_ALLOWED_HOSTS = ['data.source.coop'];

const ATTRIBUTION_FTW_2E =
  'Fields of The World (FTW) 2nd Edition / Source Cooperative · Licensed under CC BY 4.0';
const ESTIMATION_DISCLAIMER =
  'Satellite-estimated boundary · inspect against imagery and adjust corners before saving. Not a legal cadastral parcel.';
const SCORE_DISCLAIMER =
  'FTW score is uncalibrated mean model field probability (0–100) — NOT ground-survey accuracy or existence probability.';

const CoordSchema = z.object({
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
  year: z.number().int().min(2015).max(2035).optional(),
});

interface CachedParquetFile {
  url: string;
  file: AsyncBuffer;
  metadata: FileMetaData;
  cachedAt: number;
}

const parquetMetaCache = new Map<string, Promise<CachedParquetFile>>();
const parquetQueryCache = new Map<string, { cachedAt: number; outcome: FtwBoundarySuggestOutcome }>();

export function resetFtwBoundaryCaches(): void {
  parquetMetaCache.clear();
  parquetQueryCache.clear();
}

export function computeUtmZoneForLongitude(lon: number): number {
  const clamped = Math.max(-180, Math.min(179.999999, lon));
  return Math.min(60, Math.max(1, Math.floor((clamped + 180) / 6) + 1));
}

function readDefaultConfig() {
  const endpointUrl = process.env.ASTRAGRON_FTW_SUGGEST_ENDPOINT?.trim() ?? '';
  const allowedHosts = (process.env.ASTRAGRON_FTW_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const apiKey = process.env.ASTRAGRON_FTW_API_KEY?.trim() ?? '';
  const datasetName =
    sanitizeRemoteText(process.env.ASTRAGRON_FTW_DATASET_NAME, 120) ||
    'Fields of The World (FTW) 2nd Edition';
  const yearNum = Number(process.env.ASTRAGRON_FTW_DATASET_YEAR ?? '2025');
  const datasetYear = Number.isInteger(yearNum) && yearNum >= 2015 ? yearNum : 2025;
  const disableLiveParquet = process.env.ASTRAGRON_FTW_DISABLE_LIVE_PARQUET === '1';
  const parquetBaseUrl =
    process.env.ASTRAGRON_FTW_PARQUET_BASE_URL?.trim() || DEFAULT_PARQUET_BASE_URL;
  const parquetAllowedHosts = (process.env.ASTRAGRON_FTW_PARQUET_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    endpointUrl,
    allowedHosts,
    apiKey,
    datasetName,
    datasetYear,
    disableLiveParquet,
    parquetBaseUrl,
    parquetAllowedHosts:
      parquetAllowedHosts.length > 0 ? parquetAllowedHosts : DEFAULT_PARQUET_ALLOWED_HOSTS,
    timeoutMs: endpointUrl ? DEFAULT_CUSTOM_TIMEOUT_MS : DEFAULT_PARQUET_TIMEOUT_MS,
  };
}

function extractRawFeatureArray(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  if (obj.type === 'Feature' && obj.geometry) return [obj];
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
    return obj.features.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'));
  }
  if (Array.isArray(obj.suggestions)) {
    return obj.suggestions.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'));
  }
  if (Array.isArray(obj.features)) {
    return obj.features.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'));
  }
  return [];
}

function normalizeScores(props: Record<string, unknown>): {
  rawModelScore: number | null;
  modelConfidence: number | null;
} {
  const raw = props.score ?? props.confidence ?? props.modelConfidence ?? props.probability;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { rawModelScore: null, modelConfidence: null };
  }
  if (raw > 1 && raw <= 100) {
    return {
      rawModelScore: Math.round(raw),
      modelConfidence: Number((raw / 100).toFixed(3)),
    };
  }
  if (raw >= 0 && raw <= 1) {
    return {
      rawModelScore: Math.round(raw * 100),
      modelConfidence: Number(raw.toFixed(3)),
    };
  }
  return { rawModelScore: null, modelConfidence: null };
}

function normalizeDeclaredLicense(rawLicense: unknown): string {
  const text = sanitizeRemoteText(rawLicense, 80);
  if (!text) return 'UNSPECIFIED_CUSTOM_SOURCE';
  if (/^cc[-\s]?by[-\s]?4(\.0)?$/i.test(text)) return 'CC BY 4.0';
  return text;
}

/**
 * Fallback ISO WKB parser (Polygon & MultiPolygon, 2D or Z/M) in case a Parquet source
 * exposes raw WKB bytes instead of pre-decoded GeoJSON geometry objects.
 */
export function decodeWkbGeometry(raw: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!raw || typeof raw !== 'object') return null;
  if ('type' in raw && 'coordinates' in raw) {
    const candidate = raw as { type?: unknown };
    if (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') {
      return raw as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }
    return null;
  }
  if (!(raw instanceof Uint8Array)) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let offset = 0;

  const readRing = (littleEndian: boolean, stride: number): number[][] => {
    const numPoints = view.getUint32(offset, littleEndian);
    offset += 4;
    if (numPoints > 4096) throw new Error('WKB ring exceeds vertex safety limit.');
    const ring: number[][] = [];
    for (let i = 0; i < numPoints; i += 1) {
      const x = view.getFloat64(offset, littleEndian);
      const y = view.getFloat64(offset + 8, littleEndian);
      offset += stride;
      ring.push([x, y]);
    }
    return ring;
  };

  const readGeometry = (): GeoJSON.Polygon | GeoJSON.MultiPolygon | null => {
    if (offset + 5 > view.byteLength) return null;
    const byteOrder = view.getUint8(offset);
    offset += 1;
    const littleEndian = byteOrder === 1;
    const rawType = view.getUint32(offset, littleEndian);
    offset += 4;

    const hasSrid = (rawType & 0x20000000) !== 0;
    const hasZ = (rawType & 0x80000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) === 1 || Math.floor((rawType & 0xffff) / 1000) === 3;
    const hasM = (rawType & 0x40000000) !== 0 || Math.floor((rawType & 0xffff) / 1000) === 2 || Math.floor((rawType & 0xffff) / 1000) === 3;
    if (hasSrid) offset += 4;
    const baseType = rawType % 1000;
    const stride = 16 + (hasZ ? 8 : 0) + (hasM ? 8 : 0);

    if (baseType === 3) {
      const numRings = view.getUint32(offset, littleEndian);
      offset += 4;
      if (numRings > 64) throw new Error('WKB polygon exceeds ring safety limit.');
      const rings: number[][][] = [];
      for (let r = 0; r < numRings; r += 1) {
        rings.push(readRing(littleEndian, stride));
      }
      return { type: 'Polygon', coordinates: rings };
    }

    if (baseType === 6) {
      const numPolys = view.getUint32(offset, littleEndian);
      offset += 4;
      if (numPolys > 64) throw new Error('WKB MultiPolygon exceeds part limit.');
      const polys: number[][][][] = [];
      for (let p = 0; p < numPolys; p += 1) {
        const sub = readGeometry();
        if (sub?.type === 'Polygon') polys.push(sub.coordinates);
      }
      return { type: 'MultiPolygon', coordinates: polys };
    }
    return null;
  };

  try {
    return readGeometry();
  } catch {
    return null;
  }
}

function resolveRgBboxStats(
  rg: FileMetaData['row_groups'][number],
  lon: number,
  lat: number
): boolean {
  const statsByPath = new Map<string, { min?: number; max?: number }>();
  for (const col of rg.columns) {
    const p = col.meta_data?.path_in_schema?.join('.');
    if (!p) continue;
    const s = col.meta_data?.statistics;
    if (!s) continue;
    const minVal = typeof s.min_value === 'number' ? s.min_value : typeof s.min === 'number' ? s.min : undefined;
    const maxVal = typeof s.max_value === 'number' ? s.max_value : typeof s.max === 'number' ? s.max : undefined;
    if (minVal !== undefined || maxVal !== undefined) {
      statsByPath.set(p, { min: minVal, max: maxVal });
    }
  }

  const xmin = statsByPath.get('bbox.xmin');
  const xmax = statsByPath.get('bbox.xmax');
  const ymin = statsByPath.get('bbox.ymin');
  const ymax = statsByPath.get('bbox.ymax');

  if (xmin?.min !== undefined && xmin.min > lon) return false;
  if (xmax?.max !== undefined && xmax.max < lon) return false;
  if (ymin?.min !== undefined && ymin.min > lat) return false;
  if (ymax?.max !== undefined && ymax.max < lat) return false;
  return true;
}

function buildBoundedFetch(fetchImpl: typeof fetch, timeoutMs: number): typeof fetch {
  let activeCount = 0;
  const queue: Array<() => void> = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (activeCount < 2) {
        activeCount += 1;
        resolve();
      } else {
        queue.push(() => {
          activeCount += 1;
          resolve();
        });
      }
    });
  const release = () => {
    activeCount = Math.max(0, activeCount - 1);
    const next = queue.shift();
    if (next) next();
  };

  return async (input, init) => {
    await acquire();
    try {
      const method = (init?.method ?? 'GET').toUpperCase();
      const mergedHeaders = new Headers(init?.headers);
      if (!mergedHeaders.has('User-Agent')) {
        mergedHeaders.set('User-Agent', 'ASTRAGRON-Research-UI/1.0');
      }

      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        if (init?.signal) {
          init.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        try {
          const res = await fetchImpl(input, {
            ...init,
            headers: mergedHeaders,
            signal: controller.signal,
          });
          if (method !== 'HEAD') {
            const len = Number(res.headers.get('content-length') ?? '0');
            if (len > MAX_PARQUET_RANGE_BYTES) {
              controller.abort();
              throw new Error(
                `Parquet chunk (${len} bytes) exceeds ${MAX_PARQUET_RANGE_BYTES}-byte safety cap.`
              );
            }
          }
          return res;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('safety cap') || init?.signal?.aborted) {
            throw err;
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastErr;
    } finally {
      release();
    }
  };
}

async function openCachedParquetFile(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<CachedParquetFile> {
  const existing = parquetMetaCache.get(url);
  if (existing) {
    try {
      const resolved = await existing;
      if (Date.now() - resolved.cachedAt < FOOTER_CACHE_TTL_MS) {
        return resolved;
      }
    } catch {
      parquetMetaCache.delete(url);
    }
  }

  const promise = (async (): Promise<CachedParquetFile> => {
    const boundedFetch = buildBoundedFetch(fetchImpl, timeoutMs);
    const rawFile = await asyncBufferFromUrl({ url, fetch: boundedFetch });
    const sliceCache = new Map<string, Promise<ArrayBuffer>>();
    const file: AsyncBuffer = {
      byteLength: rawFile.byteLength,
      slice(start: number, end?: number): Promise<ArrayBuffer> {
        const normEnd = end ?? rawFile.byteLength;
        const len = normEnd - start;
        if (len > 0 && len <= MAX_PARQUET_RANGE_BYTES) {
          const key = `${start}:${normEnd}`;
          const hit = sliceCache.get(key);
          if (hit) return hit;
          const reqPromise = Promise.resolve(rawFile.slice(start, normEnd)).catch((err) => {
            sliceCache.delete(key);
            throw err;
          });
          if (sliceCache.size >= 16) {
            const oldestKey = sliceCache.keys().next().value;
            if (oldestKey) sliceCache.delete(oldestKey);
          }
          sliceCache.set(key, reqPromise);
          return reqPromise;
        }
        return Promise.resolve(rawFile.slice(start, normEnd));
      },
    };
    const metadata = await parquetMetadataAsync(file);
    return { url, file, metadata, cachedAt: Date.now() };
  })();

  parquetMetaCache.set(url, promise);
  try {
    return await promise;
  } catch (err) {
    parquetMetaCache.delete(url);
    throw err;
  }
}

async function queryFtw2eParquetZone(params: {
  lon: number;
  lat: number;
  zoneNum: number;
  year: number;
  parquetBaseUrl: string;
  parquetAllowedHosts: string[];
  timeoutMs: number;
  maxRowGroups?: number;
  maxCandidates?: number;
  fetchImpl: typeof fetch;
}): Promise<{
  suggestions: SuggestedFieldBoundary[];
  rejectedFragmentsCount: number;
  totalMatchingRowGroups: number;
  prunedRowGroups: number;
  scannedRowGroups: number;
  scannedBboxRows: number;
  candidateBboxHits: number;
  scannedCandidates: number;
  searchExhaustive: boolean;
  coverageDataExists: boolean;
  nearestCenterHit: boolean;
  parquetAreaM2: number | null;
  turfAreaM2: number | null;
}> {
  const {
    lon,
    lat,
    zoneNum,
    year,
    parquetBaseUrl,
    parquetAllowedHosts,
    timeoutMs,
    maxRowGroups = MAX_PRUNED_ROW_GROUPS,
    maxCandidates = MAX_GEOMETRY_CANDIDATES,
    fetchImpl,
  } = params;

  const zoneStr = String(zoneNum).padStart(2, '0');
  const cleanBase = parquetBaseUrl.replace(/\/+$/, '');
  const parquetUrl = `${cleanBase}/${year}/zone=${zoneStr}/utm${zoneStr}.parquet`;

  const urlCheck = validateAllowlistedHttpsUrl(
    parquetUrl,
    parquetAllowedHosts,
    'FTW 2e GeoParquet dataset',
    { blockPublicOsmNominatim: true }
  );
  if (!urlCheck.valid) {
    throw new Error(urlCheck.reason);
  }

  const { file, metadata } = await openCachedParquetFile(urlCheck.url.toString(), fetchImpl, timeoutMs);

  // Locate all row groups whose bbox min/max statistics can contain [lon, lat]
  const allMatchingRgs: Array<{ rgIndex: number; rowStart: number; rowEnd: number }> = [];
  let rowOffset = 0;
  for (let i = 0; i < metadata.row_groups.length; i += 1) {
    const rg = metadata.row_groups[i]!;
    const count = Number(rg.num_rows);
    const rowStart = rowOffset;
    const rowEnd = rowOffset + count;
    rowOffset = rowEnd;
    if (resolveRgBboxStats(rg, lon, lat)) {
      allMatchingRgs.push({ rgIndex: i, rowStart, rowEnd });
    }
  }
  const totalMatchingRowGroups = allMatchingRgs.length;
  const matchedRgs = allMatchingRgs.slice(0, Math.max(1, maxRowGroups));

  let scannedRowGroups = 0;
  let scannedBboxRows = 0;
  let totalCandidateBboxHits = 0;
  let scannedCandidates = 0;
  let nearestCenterHit = false;
  const tolDeg = 0.00045; // ~50m diagnostic tolerance (never accepted as PiP hit)

  const suggestions: SuggestedFieldBoundary[] = [];
  let rejectedFragmentsCount = 0;
  let lastParquetAreaM2: number | null = null;
  let lastTurfAreaM2: number | null = null;

  for (const rgInfo of matchedRgs) {
    scannedRowGroups += 1;
    const bboxRows = await parquetReadObjects({
      file,
      metadata,
      compressors,
      rowStart: rgInfo.rowStart,
      rowEnd: rgInfo.rowEnd,
      columns: ['bbox'],
    });
    scannedBboxRows += bboxRows.length;

    const rgExactHits: Array<{
      globalRow: number;
      rgIndex: number;
      bboxSpan: number;
    }> = [];

    for (let rel = 0; rel < bboxRows.length; rel += 1) {
      const r = bboxRows[rel] as {
        bbox?: { xmin?: number; ymin?: number; xmax?: number; ymax?: number };
      };
      const b = r?.bbox;
      if (
        !b ||
        typeof b.xmin !== 'number' ||
        typeof b.ymin !== 'number' ||
        typeof b.xmax !== 'number' ||
        typeof b.ymax !== 'number'
      ) {
        continue;
      }
      if (b.xmin <= lon && lon <= b.xmax && b.ymin <= lat && lat <= b.ymax) {
        const bboxSpan = Math.max(1e-12, (b.xmax - b.xmin) * (b.ymax - b.ymin));
        rgExactHits.push({
          globalRow: rgInfo.rowStart + rel,
          rgIndex: rgInfo.rgIndex,
          bboxSpan,
        });
      } else if (
        b.xmin - tolDeg <= lon &&
        lon <= b.xmax + tolDeg &&
        b.ymin - tolDeg <= lat &&
        lat <= b.ymax + tolDeg
      ) {
        nearestCenterHit = true;
      }
    }

    totalCandidateBboxHits += rgExactHits.length;
    if (rgExactHits.length === 0) continue;

    rgExactHits.sort((a, b) => a.bboxSpan - b.bboxSpan);
    const topCandidates = rgExactHits.slice(0, Math.max(1, maxCandidates));
    scannedCandidates += topCandidates.length;

    for (const c of topCandidates) {
      const singleRows = await parquetReadObjects({
        file,
        metadata,
        compressors,
        rowStart: c.globalRow,
        rowEnd: c.globalRow + 1,
        columns: ['id', 'geometry', 'metrics:area', 'score'],
      });

      const row = singleRows[0] as Record<string, unknown> | undefined;
      if (!row) continue;

      const geom = decodeWkbGeometry(row.geometry);
      if (!geom) {
        rejectedFragmentsCount += 1;
        continue;
      }

      const topo = validatePolygonGeometry(geom);
      if (!topo.valid) {
        rejectedFragmentsCount += 1;
        continue;
      }

      const clippedCheck = detectClippedTileEdgeGeometry(geom);
      if (clippedCheck.suspectedClipped) {
        rejectedFragmentsCount += 1;
        continue;
      }

      if (!polygonContainsPoint(geom, [lon, lat])) {
        continue;
      }

      const metrics = computeGeodesicMetrics(geom);
      const parquetArea =
        typeof row['metrics:area'] === 'number' && Number.isFinite(row['metrics:area'])
          ? Number(row['metrics:area'])
          : null;
      lastParquetAreaM2 = parquetArea;
      lastTurfAreaM2 = metrics.areaM2;

      const sourceFeatureId =
        sanitizeRemoteText(row.id, 120) || `ftw2e-${c.globalRow}`;
      const sourceCollection =
        sanitizeRemoteText(row.collection, 80) || `ftw-s2-${year}`;
      const detMethod = sanitizeRemoteText(row['determination:method'], 64) || null;
      const dtRaw = row['determination:datetime'];
      const detDatetime =
        dtRaw instanceof Date
          ? dtRaw.toISOString()
          : typeof dtRaw === 'string'
            ? sanitizeRemoteText(dtRaw, 48) || null
            : null;
      const scores = normalizeScores({ score: row.score });

      suggestions.push({
        id: sourceFeatureId,
        sourceFeatureId,
        sourceEdition: 'FTW_V2E_GEOPARQUET',
        sourceCollection,
        determinationMethod: detMethod,
        determinationDatetime: detDatetime,
        geometry: geom,
        areaHa: metrics.areaHa,
        areaAcres: metrics.areaAcres,
        perimeterMeters: metrics.perimeterMeters,
        sourceDataset: `Fields of The World (FTW) 2nd Edition · UTM ${zoneStr}`,
        sourceYear: year,
        license: 'CC BY 4.0',
        attribution: `${FTW_2E_CATALOG_INFO.edition} (${year}, ${sourceCollection}) · CC BY 4.0`,
        rawModelScore: scores.rawModelScore,
        modelConfidence: scores.modelConfidence,
        scoreSemantics: FTW_2E_CATALOG_INFO.scoreSemantics,
        scoreDisclaimer: SCORE_DISCLAIMER,
        geometryPassedLocalChecks: true,
        sourceVerifiedComplete: true,
        completenessVerified: true,
        completenessBasis: `Full uncut GeoParquet record from ${sourceCollection} (HTTP Range UTM ${zoneStr}); validated with Turf PiP and topology checks.`,
        disclaimer: ESTIMATION_DISCLAIMER,
      });

      if (suggestions.length >= MAX_SUGGESTIONS_RETURNED) break;
    }

    if (suggestions.length > 0) break;
  }

  suggestions.sort((a, b) => {
    const scoreA = a.rawModelScore ?? -1;
    const scoreB = b.rawModelScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.areaHa - b.areaHa;
  });

  const searchExhaustive =
    scannedRowGroups === totalMatchingRowGroups &&
    scannedCandidates === totalCandidateBboxHits;

  return {
    suggestions,
    rejectedFragmentsCount,
    totalMatchingRowGroups,
    prunedRowGroups: matchedRgs.length,
    scannedRowGroups,
    scannedBboxRows,
    candidateBboxHits: totalCandidateBboxHits,
    scannedCandidates,
    searchExhaustive,
    coverageDataExists: metadata.row_groups.length > 0,
    nearestCenterHit,
    parquetAreaM2: lastParquetAreaM2,
    turfAreaM2: lastTurfAreaM2,
  };
}

async function queryCustomFtwEndpoint(params: {
  lon: number;
  lat: number;
  year: number;
  endpointUrl: string;
  allowedHosts: string[];
  apiKey: string;
  datasetName: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<FtwBoundarySuggestOutcome> {
  const {
    lon,
    lat,
    year,
    endpointUrl,
    allowedHosts,
    apiKey,
    datasetName,
    timeoutMs,
    fetchImpl,
  } = params;

  const urlCheck = validateAllowlistedHttpsUrl(endpointUrl, allowedHosts, 'FTW boundary service', {
    blockPublicOsmNominatim: true,
  });
  if (!urlCheck.valid) {
    return {
      ok: false,
      httpStatus: 403,
      status: 'ERROR',
      detailedStatus: 'UPSTREAM_UNAVAILABLE',
      providerConfigured: false,
      sourceMode: 'CUSTOM_HTTPS_ENDPOINT',
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: urlCheck.reason,
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  }

  const requestUrl = new URL(urlCheck.url.toString());
  requestUrl.searchParams.set('lon', String(lon));
  requestUrl.searchParams.set('lat', String(lat));
  requestUrl.searchParams.set('year', String(year));

  const delta = 0.008;
  const requestBbox: [number, number, number, number] = [
    lon - delta,
    lat - delta,
    lon + delta,
    lat + delta,
  ];

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(requestUrl.toString(), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: 502,
        status: 'ERROR',
        detailedStatus: 'UPSTREAM_UNAVAILABLE',
        providerConfigured: true,
        sourceMode: 'CUSTOM_HTTPS_ENDPOINT',
        attribution: ATTRIBUTION_FTW_2E,
        disclaimer: ESTIMATION_DISCLAIMER,
        notice: `FTW boundary upstream returned HTTP ${res.status}.`,
        suggestions: [],
        rejectedFragmentsCount: 0,
      };
    }

    const payload: unknown = await res.json();
    const payloadObj =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const tileBbox = Array.isArray(payloadObj.tileBbox) && payloadObj.tileBbox.length === 4
      ? (payloadObj.tileBbox.map(Number) as [number, number, number, number])
      : requestBbox;
    const rawFeatures = extractRawFeatureArray(payload).slice(0, 16);

    const verified: SuggestedFieldBoundary[] = [];
    let rejectedFragmentsCount = 0;

    for (let i = 0; i < rawFeatures.length; i += 1) {
      const f = rawFeatures[i]!;
      const geomRaw = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
      if (!geomRaw || (geomRaw.type !== 'Polygon' && geomRaw.type !== 'MultiPolygon')) {
        continue;
      }

      const topo = validatePolygonGeometry(geomRaw);
      if (!topo.valid) {
        rejectedFragmentsCount += 1;
        continue;
      }

      const props = (f.properties && typeof f.properties === 'object' ? f.properties : f) as Record<
        string,
        unknown
      >;
      if (props.clipped === true || props.tileClipped === true || props.complete === false) {
        rejectedFragmentsCount += 1;
        continue;
      }

      const clippedCheck = detectClippedTileEdgeGeometry(geomRaw, tileBbox);
      if (clippedCheck.suspectedClipped) {
        rejectedFragmentsCount += 1;
        continue;
      }

      if (!polygonContainsPoint(geomRaw, [lon, lat])) {
        continue;
      }

      const metrics = computeGeodesicMetrics(geomRaw);
      const id =
        sanitizeRemoteText(f.id ?? props.id ?? props.field_id ?? `ftw-${i}`, 120) || `ftw-${i}`;
      const sourceDataset =
        sanitizeRemoteText(props.dataset ?? props.sourceDataset, 120) || datasetName;
      const yr =
        typeof props.year === 'number' && Number.isInteger(props.year) ? props.year : year;
      const license = normalizeDeclaredLicense(
        props.license ?? payloadObj.license
      );
      const sourceVerifiedComplete =
        props.complete === true ||
        props.completeness_verified === true ||
        props.sourceCompletenessVerified === true ||
        payloadObj.sourceCompletenessVerified === true;
      const scores = normalizeScores(props);

      verified.push({
        id,
        sourceFeatureId: id,
        sourceEdition: 'CUSTOM_ENDPOINT',
        sourceCollection: sanitizeRemoteText(props.collection, 80) || sourceDataset,
        determinationMethod: sanitizeRemoteText(props['determination:method'] ?? props.method, 64) || null,
        determinationDatetime: sanitizeRemoteText(props['determination:datetime'] ?? props.datetime, 48) || null,
        geometry: geomRaw,
        areaHa: metrics.areaHa,
        areaAcres: metrics.areaAcres,
        perimeterMeters: metrics.perimeterMeters,
        sourceDataset,
        sourceYear: yr,
        license,
        attribution: `${sourceDataset} (${yr}) · ${license}`,
        rawModelScore: scores.rawModelScore,
        modelConfidence: scores.modelConfidence,
        scoreSemantics: FTW_2E_CATALOG_INFO.scoreSemantics,
        scoreDisclaimer: SCORE_DISCLAIMER,
        geometryPassedLocalChecks: true,
        sourceVerifiedComplete,
        completenessVerified: sourceVerifiedComplete,
        completenessBasis: sourceVerifiedComplete
          ? 'Upstream declared complete full-feature source record and passed local topology & tile-edge checks.'
          : 'Passed local closed-ring and tile-edge geometry checks only; upstream response did not certify full-source completeness.',
        disclaimer: ESTIMATION_DISCLAIMER,
      });
    }

    if (verified.length === 0) {
      return {
        ok: true,
        httpStatus: 200,
        status: 'NO_RELIABLE_BOUNDARY',
        detailedStatus: rejectedFragmentsCount > 0 ? 'INVALID_RESULT' : 'NO_MATCH_AFTER_COMPLETE_SEARCH',
        providerConfigured: true,
        sourceMode: 'CUSTOM_HTTPS_ENDPOINT',
        attribution: ATTRIBUTION_FTW_2E,
        disclaimer: ESTIMATION_DISCLAIMER,
        notice:
          rejectedFragmentsCount > 0
            ? 'Only incomplete or tile-clipped boundary fragments were returned and rejected to protect parcel accuracy. Draw your field boundary manually.'
            : 'No verified complete field polygon matched this pin. Tap inside the field or draw corners manually.',
        suggestions: [],
        rejectedFragmentsCount,
      };
    }

    return {
      ok: true,
      httpStatus: 200,
      status: 'FOUND',
      detailedStatus: 'FOUND',
      providerConfigured: true,
      sourceMode: 'CUSTOM_HTTPS_ENDPOINT',
      attribution: verified[0]!.attribution,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: `Found ${verified.length} boundary candidate(s). Inspect against satellite imagery before accepting.`,
      suggestions: verified,
      rejectedFragmentsCount,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      httpStatus: timedOut ? 504 : 502,
      status: 'ERROR',
      detailedStatus: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      providerConfigured: true,
      sourceMode: 'CUSTOM_HTTPS_ENDPOINT',
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: timedOut
        ? `FTW boundary service timed out after ${timeoutMs} ms.`
        : 'Could not reach the configured FTW boundary service.',
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function querySuggestedFieldBoundaries(
  lon: number,
  lat: number,
  year?: number,
  overrides?: FtwBoundaryConfig
): Promise<FtwBoundarySuggestOutcome> {
  const startedAt = Date.now();
  const parsedCoords = CoordSchema.safeParse({ lon, lat, year });
  if (!parsedCoords.success) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'ERROR',
      detailedStatus: 'INVALID_RESULT',
      providerConfigured: false,
      sourceMode: 'UNCONFIGURED',
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: 'Invalid coordinates for boundary lookup.',
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  }

  const defaults = readDefaultConfig();
  const endpointUrl = overrides?.endpointUrl ?? defaults.endpointUrl;
  const allowedHosts = overrides?.allowedHosts ?? defaults.allowedHosts;
  const apiKey = overrides?.apiKey ?? defaults.apiKey;
  const datasetName = overrides?.datasetName ?? defaults.datasetName;
  const targetYear = parsedCoords.data.year ?? overrides?.datasetYear ?? defaults.datasetYear;
  const disableLiveParquet = overrides?.disableLiveParquet ?? defaults.disableLiveParquet;
  const parquetBaseUrl = overrides?.parquetBaseUrl ?? defaults.parquetBaseUrl;
  const parquetAllowedHosts = overrides?.parquetAllowedHosts ?? defaults.parquetAllowedHosts;
  const timeoutMs = overrides?.timeoutMs ?? defaults.timeoutMs;
  const maxRowGroups = overrides?.maxRowGroups;
  const maxCandidates = overrides?.maxCandidates;
  const fetchFn = overrides?.fetchImpl ?? fetch;

  // Path 1: Explicit enterprise/custom FTW endpoint (or mocked test fetch)
  if (endpointUrl) {
    return queryCustomFtwEndpoint({
      lon: parsedCoords.data.lon,
      lat: parsedCoords.data.lat,
      year: targetYear,
      endpointUrl,
      allowedHosts,
      apiKey,
      datasetName,
      timeoutMs,
      fetchImpl: fetchFn,
    });
  }

  if (disableLiveParquet) {
    return {
      ok: false,
      httpStatus: 200,
      status: 'UNAVAILABLE',
      detailedStatus: 'UPSTREAM_UNAVAILABLE',
      providerConfigured: false,
      sourceMode: 'UNCONFIGURED',
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice:
        'Automatic field-boundary lookup is disabled in offline/strict mode. Draw corners on the map, use a quick rectangle, trace by GPS, or upload GeoJSON/KML/GPX.',
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  }

  // Supported FTW 2nd Edition partition years check
  const supportedFtw2eYears = [2025, 2024, 2023, 2018];
  if (!supportedFtw2eYears.includes(targetYear)) {
    return {
      ok: true,
      httpStatus: 200,
      status: 'COVERAGE_UNKNOWN',
      detailedStatus: 'COVERAGE_UNKNOWN',
      providerConfigured: true,
      sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
      datasetYear: targetYear,
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: `FTW 2nd Edition partition coverage for year ${targetYear} is not available in the standard archive (supported years: ${supportedFtw2eYears.join(', ')}). Draw corners manually or select a supported year.`,
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  }

  // Path 2: Real keyless HTTP Range GeoParquet query against Fields of The World 2nd Edition (data.source.coop)
  if (parsedCoords.data.lat < -60 || parsedCoords.data.lat > 84) {
    return {
      ok: true,
      httpStatus: 200,
      status: 'COVERAGE_UNKNOWN',
      detailedStatus: 'COVERAGE_UNKNOWN',
      providerConfigured: true,
      sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
      datasetYear: targetYear,
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: 'Point is outside standard UTM cropland zone coverage (-60° to +84°). Draw manually if needed.',
      suggestions: [],
      rejectedFragmentsCount: 0,
      queryMeta: {
        prunedRowGroups: 0,
        totalMatchingRowGroups: 0,
        scannedRowGroups: 0,
        scannedBboxRows: 0,
        candidateBboxHits: 0,
        scannedCandidates: 0,
        searchExhaustive: true,
        attemptedZones: [],
        parquetAreaM2: null,
        turfAreaM2: null,
        elapsedMs: Date.now() - startedAt,
        coverageDataExists: false,
        cacheHit: false,
      },
    };
  }

  const cacheKey = `${parsedCoords.data.lon.toFixed(5)}:${parsedCoords.data.lat.toFixed(5)}:${targetYear}`;
  if (!overrides?.fetchImpl && maxRowGroups === undefined && maxCandidates === undefined) {
    const cached = parquetQueryCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < RESULT_CACHE_TTL_MS) {
      return {
        ...cached.outcome,
        queryMeta: cached.outcome.queryMeta
          ? { ...cached.outcome.queryMeta, cacheHit: true }
          : undefined,
      };
    }
  }

  const primaryZone = computeUtmZoneForLongitude(parsedCoords.data.lon);
  const zoneStr = String(primaryZone).padStart(2, '0');
  const attemptedZones: string[] = [zoneStr];

  try {
    let zoneResult = await queryFtw2eParquetZone({
      lon: parsedCoords.data.lon,
      lat: parsedCoords.data.lat,
      zoneNum: primaryZone,
      year: targetYear,
      parquetBaseUrl,
      parquetAllowedHosts,
      timeoutMs,
      maxRowGroups,
      maxCandidates,
      fetchImpl: fetchFn,
    });

    // If right near a 6-degree UTM zone meridian, check adjacent zone before giving up
    if (zoneResult.suggestions.length === 0) {
      const modDeg = ((parsedCoords.data.lon + 180) % 6 + 6) % 6;
      const neighborZone =
        modDeg < 0.08
          ? ((primaryZone - 2 + 60) % 60) + 1
          : modDeg > 5.92
            ? (primaryZone % 60) + 1
            : null;
      if (neighborZone && neighborZone !== primaryZone) {
        attemptedZones.push(String(neighborZone).padStart(2, '0'));
        const adj = await queryFtw2eParquetZone({
          lon: parsedCoords.data.lon,
          lat: parsedCoords.data.lat,
          zoneNum: neighborZone,
          year: targetYear,
          parquetBaseUrl,
          parquetAllowedHosts,
          timeoutMs,
          maxRowGroups,
          maxCandidates,
          fetchImpl: fetchFn,
        });
        if (adj.suggestions.length > 0) {
          zoneResult = adj;
        }
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const isSearchIncomplete = zoneResult.suggestions.length === 0 && !zoneResult.searchExhaustive;
    const detailedStatus: FtwDetailedSuggestStatus =
      zoneResult.suggestions.length > 0
        ? 'FOUND'
        : isSearchIncomplete
          ? 'SEARCH_INCOMPLETE_LIMIT'
          : zoneResult.rejectedFragmentsCount > 0
            ? 'INVALID_RESULT'
            : 'NO_MATCH_AFTER_COMPLETE_SEARCH';

    const outcome: FtwBoundarySuggestOutcome =
      zoneResult.suggestions.length > 0
        ? {
            ok: true,
            httpStatus: 200,
            status: 'FOUND',
            detailedStatus: 'FOUND',
            providerConfigured: true,
            sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
            utmZone: zoneStr,
            datasetYear: targetYear,
            attribution: zoneResult.suggestions[0]!.attribution,
            disclaimer: ESTIMATION_DISCLAIMER,
            notice: `Retrieved ${zoneResult.suggestions.length} uncut GeoParquet boundary (${zoneResult.suggestions[0]!.sourceFeatureId}) from FTW 2nd Edition UTM ${zoneStr}. Inspect against imagery before saving.`,
            suggestions: zoneResult.suggestions,
            rejectedFragmentsCount: zoneResult.rejectedFragmentsCount,
            queryMeta: {
              prunedRowGroups: zoneResult.prunedRowGroups,
              totalMatchingRowGroups: zoneResult.totalMatchingRowGroups,
              scannedRowGroups: zoneResult.scannedRowGroups,
              scannedBboxRows: zoneResult.scannedBboxRows,
              candidateBboxHits: zoneResult.candidateBboxHits,
              scannedCandidates: zoneResult.scannedCandidates,
              searchExhaustive: zoneResult.searchExhaustive,
              attemptedZones,
              parquetAreaM2: zoneResult.parquetAreaM2,
              turfAreaM2: zoneResult.turfAreaM2,
              elapsedMs,
              coverageDataExists: true,
              cacheHit: false,
            },
          }
        : isSearchIncomplete
          ? {
              ok: true,
              httpStatus: 200,
              status: 'SEARCH_INCOMPLETE_LIMIT',
              detailedStatus: 'SEARCH_INCOMPLETE_LIMIT',
              providerConfigured: true,
              sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
              utmZone: zoneStr,
              datasetYear: targetYear,
              attribution: ATTRIBUTION_FTW_2E,
              disclaimer: ESTIMATION_DISCLAIMER,
              notice: `Partial FTW GeoParquet scan completed (${zoneResult.scannedRowGroups}/${zoneResult.totalMatchingRowGroups} matching row groups, ${zoneResult.scannedCandidates}/${zoneResult.candidateBboxHits} candidate parcels inspected within ${elapsedMs} ms budget). Could not exhaustively rule out a boundary match — tap directly inside your field parcel or draw corners manually.`,
              suggestions: [],
              rejectedFragmentsCount: zoneResult.rejectedFragmentsCount,
              queryMeta: {
                prunedRowGroups: zoneResult.prunedRowGroups,
                totalMatchingRowGroups: zoneResult.totalMatchingRowGroups,
                scannedRowGroups: zoneResult.scannedRowGroups,
                scannedBboxRows: zoneResult.scannedBboxRows,
                candidateBboxHits: zoneResult.candidateBboxHits,
                scannedCandidates: zoneResult.scannedCandidates,
                searchExhaustive: false,
                attemptedZones,
                parquetAreaM2: null,
                turfAreaM2: null,
                elapsedMs,
                coverageDataExists: true,
                cacheHit: false,
              },
            }
          : {
              ok: true,
              httpStatus: 200,
              status: 'NO_RELIABLE_BOUNDARY',
              detailedStatus,
              providerConfigured: true,
              sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
              utmZone: zoneStr,
              datasetYear: targetYear,
              attribution: ATTRIBUTION_FTW_2E,
              disclaimer: ESTIMATION_DISCLAIMER,
              notice: zoneResult.nearestCenterHit
                ? 'No FTW parcel strictly encloses that exact point (a cataloged parcel lies nearby). Tap inside the dark green crop parcel on satellite imagery or draw manually.'
                : 'No FTW 2nd Edition agricultural parcel matched those coordinates after an exhaustive zone scan. Tap inside a visible field on the map or draw corners manually.',
              suggestions: [],
              rejectedFragmentsCount: zoneResult.rejectedFragmentsCount,
              queryMeta: {
                prunedRowGroups: zoneResult.prunedRowGroups,
                totalMatchingRowGroups: zoneResult.totalMatchingRowGroups,
                scannedRowGroups: zoneResult.scannedRowGroups,
                scannedBboxRows: zoneResult.scannedBboxRows,
                candidateBboxHits: zoneResult.candidateBboxHits,
                scannedCandidates: zoneResult.scannedCandidates,
                searchExhaustive: true,
                attemptedZones,
                parquetAreaM2: null,
                turfAreaM2: null,
                elapsedMs,
                coverageDataExists: true,
                cacheHit: false,
              },
            };

    if (!overrides?.fetchImpl && maxRowGroups === undefined && maxCandidates === undefined) {
      if (parquetQueryCache.size >= MAX_RESULT_CACHE_ENTRIES) {
        const oldest = parquetQueryCache.keys().next().value;
        if (oldest) parquetQueryCache.delete(oldest);
      }
      parquetQueryCache.set(cacheKey, { cachedAt: Date.now(), outcome });
    }
    return outcome;
  } catch (err) {
    const timedOut =
      (err instanceof Error && err.name === 'AbortError') ||
      (err instanceof Error && /abort|timed?\s*out/i.test(err.message));
    return {
      ok: false,
      httpStatus: timedOut ? 504 : 502,
      status: 'ERROR',
      detailedStatus: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      providerConfigured: true,
      sourceMode: 'FTW_2E_HTTP_RANGE_PARQUET',
      utmZone: zoneStr,
      datasetYear: targetYear,
      attribution: ATTRIBUTION_FTW_2E,
      disclaimer: ESTIMATION_DISCLAIMER,
      notice: timedOut
        ? `FTW GeoParquet range query timed out after ${timeoutMs} ms. Draw your field corners manually.`
        : `Could not retrieve FTW GeoParquet boundary (${err instanceof Error ? err.message : 'network error'}). Draw corners manually instead.`,
      suggestions: [],
      rejectedFragmentsCount: 0,
    };
  }
}
