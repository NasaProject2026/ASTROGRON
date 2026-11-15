import { NextResponse } from 'next/server';
import {
  CoreProblem,
  coreFetch,
  coreJson,
  requireSameOrigin,
} from '@/server/core-backend';
import {
  buildLocationAnalysisRequest,
  isValidLonLat,
  type LocationAnalysisMode,
  type ResolvedLocationPoint,
} from '@/lib/location-analysis-request';

export const dynamic = 'force-dynamic';

interface TrackedPublicAnalysis {
  analysisId: string;
  createdAtMs: number;
  resolvedLocation: ResolvedLocationPoint;
  mode: LocationAnalysisMode;
}

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 12;
const MAX_TRACKED_ANALYSES = 200;
const MAX_PUBLIC_PENDING_QUEUE = 3;
const ANALYSIS_ID_RE = /^[a-f0-9]{32}$/;

const globalStore = globalThis as typeof globalThis & {
  __astragronPublicLocationRateLog?: Map<string, number[]>;
  __astragronPublicLocationRegistry?: Map<string, TrackedPublicAnalysis>;
};

function getRateLog(): Map<string, number[]> {
  if (!globalStore.__astragronPublicLocationRateLog) {
    globalStore.__astragronPublicLocationRateLog = new Map<string, number[]>();
  }
  return globalStore.__astragronPublicLocationRateLog;
}

function getRegistry(): Map<string, TrackedPublicAnalysis> {
  if (!globalStore.__astragronPublicLocationRegistry) {
    globalStore.__astragronPublicLocationRegistry = new Map<string, TrackedPublicAnalysis>();
  }
  return globalStore.__astragronPublicLocationRegistry;
}

export function resetPublicLocationStateForTests() {
  getRateLog().clear();
  getRegistry().clear();
}

export function registerPublicLocationAnalysisForTests(entry: TrackedPublicAnalysis) {
  trackPublicAnalysis(entry);
}

function trackPublicAnalysis(entry: TrackedPublicAnalysis) {
  const reg = getRegistry();
  reg.set(entry.analysisId, entry);
  while (reg.size > MAX_TRACKED_ANALYSES) {
    const oldestKey = reg.keys().next().value;
    if (!oldestKey) break;
    reg.delete(oldestKey);
  }
}

function jsonNoStore(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'local';
}

function enforceRateLimit(ip: string): NextResponse | null {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const log = getRateLog();
  const timestamps = (log.get(ip) ?? []).filter((ts) => ts >= cutoff);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    log.set(ip, timestamps);
    return jsonNoStore(
      {
        error: 'PUBLIC_LOCATION_RATE_LIMIT',
        message: 'Public location simulation limit reached. Please wait a few minutes before submitting another run.',
      },
      429
    );
  }
  timestamps.push(now);
  log.set(ip, timestamps);
  return null;
}

function mapCoreProblem(err: unknown) {
  if (err instanceof CoreProblem) {
    return jsonNoStore(
      {
        error: err.code || 'CORE_BACKEND_ERROR',
        message: err.message,
      },
      err.status || 502
    );
  }
  return jsonNoStore(
    {
      error: 'CORE_BACKEND_UNREACHABLE',
      message: err instanceof Error ? err.message : 'Unable to reach canonical D backend.',
    },
    502
  );
}

const ALLOWED_POST_KEYS = new Set([
  'siteKey',
  'label',
  'countryCode',
  'regionName',
  'lon',
  'lat',
  'mode',
]);

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
  } catch (err) {
    return mapCoreProblem(err);
  }

  const rateLimited = enforceRateLimit(clientIp(request));
  if (rateLimited) return rateLimited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore(
      {
        error: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
      },
      400
    );
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return jsonNoStore(
      {
        error: 'INVALID_BODY',
        message: 'Request body must be a JSON object.',
      },
      400
    );
  }

  const body = rawBody as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_POST_KEYS.has(key)) {
      return jsonNoStore(
        {
          error: 'PUBLIC_LOCATION_FIXED_ENVELOPE',
          message: `Field '${key}' cannot be overridden on the bounded public location endpoint.`,
        },
        422
      );
    }
  }

  const lon = typeof body.lon === 'number' ? body.lon : Number(body.lon);
  const lat = typeof body.lat === 'number' ? body.lat : Number(body.lat);
  if (!isValidLonLat(lon, lat)) {
    return jsonNoStore(
      {
        error: 'INVALID_COORDINATES',
        message: 'Finite longitude (-180..180) and latitude (-90..90) are required.',
      },
      400
    );
  }

  let mode: LocationAnalysisMode | undefined;
  if (body.mode !== undefined) {
    if (body.mode !== 'conditional_water_counterfactual' && body.mode !== 'strict_uncalibrated') {
      return jsonNoStore(
        {
          error: 'INVALID_ANALYSIS_MODE',
          message: "mode must be 'conditional_water_counterfactual' or 'strict_uncalibrated'.",
        },
        422
      );
    }
    mode = body.mode;
  }

  const strOpt = (value: unknown, maxLen = 96): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLen) : undefined;

  const built = buildLocationAnalysisRequest({
    siteKey: strOpt(body.siteKey, 64),
    label: strOpt(body.label, 96),
    countryCode: strOpt(body.countryCode, 16),
    regionName: strOpt(body.regionName, 96),
    lon,
    lat,
    mode,
  });

  try {
    const queue = (await coreJson('/v1/analyses', 'GET')) as { analyses?: Array<{ state?: string }> };
    const activePending = Array.isArray(queue?.analyses)
      ? queue.analyses.filter((item) => item?.state === 'pending' || item?.state === 'running').length
      : 0;
    if (activePending >= MAX_PUBLIC_PENDING_QUEUE) {
      return jsonNoStore(
        {
          error: 'PUBLIC_QUEUE_BUSY',
          message: 'Scientific queue is currently busy. Please wait a few seconds and retry.',
        },
        429
      );
    }

    const state = (await coreJson('/v1/analyses', 'POST', built.payload)) as Record<string, unknown>;
    const analysisId = typeof state.analysis_id === 'string' ? state.analysis_id : '';
    if (!ANALYSIS_ID_RE.test(analysisId)) {
      return jsonNoStore(
        {
          error: 'CORE_INVALID_STATE',
          message: 'Canonical D did not return a valid analysis_id.',
        },
        502
      );
    }

    trackPublicAnalysis({
      analysisId,
      createdAtMs: Date.now(),
      resolvedLocation: built.resolvedLocation,
      mode: built.mode,
    });

    return jsonNoStore(
      {
        ok: true,
        analysis_id: analysisId,
        state,
        resolvedLocation: built.resolvedLocation,
        mode: built.mode,
        submittedRequestSummary: {
          farm_id: built.payload.farm_id,
          site_id: built.resolvedLocation.siteId,
          point_lon_lat: built.resolvedLocation.pointLonLat,
          acquisition: 'CACHE_ONLY',
          provider: 'NASA_POWER_GLOBAL',
          historical_start: '2011-01-01',
          historical_end: '2025-12-31',
          scenario_id: 'MEDIAN_5Y_TOTAL_2021',
          scenario_window: '2021-01-01..2025-12-31',
          max_candidates: 2,
          max_evaluations: 2,
          max_wall_seconds: 60,
        },
      },
      202
    );
  } catch (err) {
    return mapCoreProblem(err);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const analysisId = (url.searchParams.get('analysisId') || '').trim();
  const download = (url.searchParams.get('download') || '').trim().toLowerCase();

  if (!ANALYSIS_ID_RE.test(analysisId)) {
    return jsonNoStore(
      {
        error: 'INVALID_ANALYSIS_ID',
        message: 'A valid 32-character hexadecimal analysisId query parameter is required.',
      },
      400
    );
  }

  const tracked = getRegistry().get(analysisId);
  if (!tracked) {
    return jsonNoStore(
      {
        error: 'PUBLIC_ANALYSIS_NOT_FOUND',
        message: 'Only analyses submitted via the public location runner in this session can be read here.',
      },
      404
    );
  }

  try {
    if (download === 'pdf') {
      const upstream = await coreFetch(`/v1/analyses/${analysisId}/pdf`, 'GET');
      if (!upstream.ok) {
        return jsonNoStore(
          {
            error: 'PDF_UNAVAILABLE',
            message: `PDF report is not ready (HTTP ${upstream.status}).`,
          },
          upstream.status === 409 ? 409 : 404
        );
      }
      const pdfBytes = await upstream.arrayBuffer();
      const safeSite = tracked.resolvedLocation.siteId.replace(/[^A-Za-z0-9_-]+/g, '_');
      return new NextResponse(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="astrogron-${safeSite}-${analysisId.slice(0, 8)}.pdf"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const state = (await coreJson(`/v1/analyses/${analysisId}`, 'GET')) as Record<string, unknown>;
    const currentState = typeof state.state === 'string' ? state.state : 'unknown';

    let projectedResult: Record<string, unknown> | null = null;
    if (currentState !== 'pending' && currentState !== 'running' && currentState !== 'failed') {
      try {
        const result = (await coreJson(`/v1/analyses/${analysisId}/result`, 'GET')) as Record<string, unknown>;
        const engineResult = (result.engine_result ?? {}) as Record<string, unknown>;
        const normalizedRequest = (engineResult.normalized_request ?? {}) as Record<string, unknown>;
        const alts = Array.isArray(result.alternatives) ? result.alternatives : [];
        const reportDto = (result.report_dto ?? {}) as Record<string, unknown>;

        projectedResult = {
          status: result.status,
          farm_id: result.farm_id,
          run_id: result.run_id,
          decision: result.decision,
          qualification: result.qualification,
          warnings: result.warnings,
          missing_requirements: result.missing_requirements,
          provenance: result.provenance,
          alternatives: alts.map((a: {
            policy_id?: string;
            choices?: unknown;
            important_uncertainty?: string;
            scenarios?: Array<{
              scenario_id?: string;
              status?: string;
              ET_shortfall_m3_equivalent?: string;
              source_withdrawal_m3?: string;
              worst_service_deficit_mm?: string;
              service_pass?: boolean;
              harvest_years?: number;
            }>;
          }) => ({
            policy_id: a.policy_id,
            choices: a.choices,
            important_uncertainty: a.important_uncertainty,
            ...(Array.isArray(a.scenarios)
              ? {
                  scenarios: a.scenarios.map((s) => ({
                    scenario_id: s.scenario_id,
                    status: s.status,
                    ET_shortfall_m3_equivalent: s.ET_shortfall_m3_equivalent,
                    source_withdrawal_m3: s.source_withdrawal_m3,
                    worst_service_deficit_mm: s.worst_service_deficit_mm,
                    service_pass: s.service_pass,
                    harvest_years: s.harvest_years,
                  })),
                }
              : {}),
          })),
          engine_result: {
            scientific_result_sha256: engineResult.scientific_result_sha256,
            location: normalizedRequest.location ?? null,
            scenario_sources: engineResult.scenario_sources ?? null,
            global_coverage: engineResult.global_coverage ?? null,
          },
          report_dto: {
            limitations: reportDto.limitations,
            summary: reportDto.summary,
          },
        };
      } catch (err) {
        if (!(err instanceof CoreProblem && err.status === 409)) {
          throw err;
        }
      }
    }

    return jsonNoStore({
      ok: true,
      analysis_id: analysisId,
      resolvedLocation: tracked.resolvedLocation,
      mode: tracked.mode,
      state,
      result: projectedResult,
      pdfDownloadUrl: projectedResult
        ? `/api/public-location-analysis?analysisId=${analysisId}&download=pdf`
        : null,
    });
  } catch (err) {
    return mapCoreProblem(err);
  }
}
