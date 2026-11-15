import { NextResponse } from 'next/server';
import {
  CoreProblem,
  coreFetch,
  coreJson,
  readBody,
  requireSameOrigin,
} from '@/server/core-backend';
import type { CoreChatReply, CoreResult, CoreState } from '@/domain/core-contracts';

export const dynamic = 'force-dynamic';

const ALLOWED_SCENARIOS = new Set(['REFERENCE', 'HALF_RAIN', 'LOW_INITIAL_MINERAL_N']);
const READ_ONLY_MUTATION_RE =
  /\b(?:what if|what happens if|re-?run|simulate|submit)\b|^\s*(?:please\s+)?(?:change|decrease|increase|lower|replace|modify)\b|\b(?:less|more)\s+rain\b/i;
const UNRELATED_LOCATION_RE =
  /\b(?:my selected (?:field|location|region|site|coordinates)|selected (?:field|location|region|site|coordinates)|different (?:location|region)|unrelated location|uppsala|nyeri|kenya|wagga|australia|sweden|custom (?:location|coordinates))\b/i;
const EXPLICIT_YEAR_RE =
  /\b(?:201[6-9]|2020)\b|\byear\s+[1-5]\b|\b(?:first|second|third|fourth|fifth)\s+year\b/i;

const publicChatRateWindows = new Map<string, number[]>();

function checkPublicChatRateLimit(request: Request): void {
  const key =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'local';
  const now = Date.now();
  const windowStart = now - 60_000;
  const existing = (publicChatRateWindows.get(key) || []).filter((ts) => ts >= windowStart);
  if (existing.length >= 20) {
    throw new CoreProblem(429, 'PUBLIC_CHAT_RATE_LIMIT');
  }
  existing.push(now);
  if (publicChatRateWindows.size >= 512 && !publicChatRateWindows.has(key)) {
    const oldestKey = publicChatRateWindows.keys().next().value;
    if (oldestKey) publicChatRateWindows.delete(oldestKey);
  }
  publicChatRateWindows.set(key, existing);
}

export function resetPublicDemoRateLimitForTests(): void {
  publicChatRateWindows.clear();
}

function publicHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(extra || {}),
  };
}

function projectPublicResult(raw: Record<string, unknown>): CoreResult {
  const decision = (raw.decision || {}) as Record<string, unknown>;
  const alternatives = Array.isArray(raw.alternatives)
    ? (raw.alternatives as Record<string, unknown>[]).map((alt) => ({
        policy_id: String(alt.policy_id || ''),
        choices: (alt.choices || {}) as Record<string, string[]>,
        important_uncertainty:
          typeof alt.important_uncertainty === 'string' ? alt.important_uncertainty : undefined,
      }))
    : [];
  const engineResult = (raw.engine_result || {}) as Record<string, unknown>;
  const reportDto = (raw.report_dto || {}) as Record<string, unknown>;
  const rawObjectives = Array.isArray(decision.objectives)
    ? (decision.objectives as Record<string, unknown>[]).map((obj) => ({
        policy_id: String(obj.policy_id || ''),
        scenarios: Array.isArray(obj.scenarios)
          ? (obj.scenarios as Record<string, unknown>[]).map((sc) => ({
              scenario_id: String(sc.scenario_id || ''),
              N_leaching_kg_N_field: Number(sc.N_leaching_kg_N_field ?? 0),
              crop_storage_DM_kg_field_by_crop: (sc.crop_storage_DM_kg_field_by_crop ||
                {}) as Record<string, number>,
            }))
          : [],
      }))
    : [];

  return {
    status: String(raw.status || ''),
    farm_id: String(raw.farm_id || ''),
    run_id: String(raw.run_id || ''),
    decision: {
      pareto_ids: Array.isArray(decision.pareto_ids)
        ? decision.pareto_ids.map(String)
        : [],
      selected_ids: Array.isArray(decision.selected_ids)
        ? decision.selected_ids.map(String)
        : [],
      field_recommendation: decision.field_recommendation ?? null,
      horizon_boundary: Array.isArray(decision.horizon_boundary)
        ? decision.horizon_boundary.map(String)
        : undefined,
      comparison_excludes:
        typeof decision.comparison_excludes === 'string'
          ? decision.comparison_excludes
          : undefined,
      objectives: rawObjectives,
    },
    alternatives,
    qualification: (raw.qualification || {}) as Record<string, unknown>,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    missing_requirements: raw.missing_requirements ?? [],
    provenance: (raw.provenance || {}) as Record<string, unknown>,
    engine_result: {
      scientific_result_sha256:
        typeof engineResult.scientific_result_sha256 === 'string'
          ? engineResult.scientific_result_sha256
          : null,
    },
    report_dto: {
      limitations: reportDto.limitations ?? [],
      summary: reportDto.summary ?? null,
    },
  };
}

/**
 * Serves strictly read-only, non-sensitive verified cached research examples
 * and the sample PDF for public NASA judging evaluation without exposing
 * private workspaces, job submission, tokens, or operator endpoints.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const paramNames = [...url.searchParams.keys()];
    if (paramNames.some((key) => key !== 'download')) {
      return NextResponse.json(
        { error: 'INVALID_PUBLIC_DEMO_QUERY' },
        { status: 400, headers: publicHeaders() }
      );
    }

    const download = url.searchParams.get('download');
    if (download !== null && download !== 'pdf') {
      return NextResponse.json(
        { error: 'INVALID_PUBLIC_DEMO_QUERY' },
        { status: 400, headers: publicHeaders() }
      );
    }

    const catalog = (await coreJson('/v1/demo/catalog')) as {
      analyses?: (CoreState & { run_id?: string | null; request_sha256?: string | null })[];
    };
    const analyses = Array.isArray(catalog.analyses) ? catalog.analyses : [];
    const researchJob = analyses.find(
      (item) =>
        item.demo_case === 'research' &&
        item.execution_kind === 'VERIFIED_CACHED_REPLAY'
    );

    if (!researchJob) {
      return NextResponse.json(
        { error: 'PUBLIC_DEMO_NOT_AVAILABLE' },
        { status: 503, headers: publicHeaders() }
      );
    }

    if (download === 'pdf') {
      if (researchJob.report_error) {
        return NextResponse.json(
          { error: 'SAMPLE_PDF_UNAVAILABLE' },
          { status: 503, headers: publicHeaders() }
        );
      }
      const pdfRes = await coreFetch(
        `/v1/analyses/${encodeURIComponent(researchJob.analysis_id)}/pdf`
      );
      if (!pdfRes.ok) {
        return NextResponse.json(
          { error: 'SAMPLE_PDF_UNAVAILABLE' },
          { status: pdfRes.status, headers: publicHeaders() }
        );
      }
      const bytes = await pdfRes.arrayBuffer();
      return new NextResponse(bytes, {
        status: 200,
        headers: publicHeaders({
          'Content-Type': 'application/pdf',
          'Content-Disposition':
            'attachment; filename="ASTROGRON_Wageningen_Sample_Scientific_Report.pdf"',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        }),
      });
    }

    const blockedJob = analyses.find(
      (item) =>
        item.demo_case === 'blocked' &&
        item.execution_kind === 'VERIFIED_CACHED_REPLAY'
    );

    const [readyRes, researchRaw, researchReqRaw, blockedRaw, blockedReqRaw] = await Promise.all([
      coreFetch('/ready').catch(() => null),
      coreJson(`/v1/analyses/${encodeURIComponent(researchJob.analysis_id)}/result`),
      coreJson('/v1/demo/requests/research').catch(() => null),
      blockedJob
        ? coreJson(`/v1/analyses/${encodeURIComponent(blockedJob.analysis_id)}/result`).catch(
            () => null
          )
        : Promise.resolve(null),
      blockedJob ? coreJson('/v1/demo/requests/blocked').catch(() => null) : Promise.resolve(null),
    ]);

    const readyJson = readyRes
      ? ((await readyRes.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

    const globalEvidence = (readyJson?.global_evidence || {}) as Record<string, unknown>;
    const chatStatus = (readyJson?.chat || {}) as Record<string, unknown>;

    const researchRawObj = researchRaw as Record<string, unknown>;
    const researchEngineReq = ((researchReqRaw as Record<string, unknown> | null)?.engine_request ||
      {}) as Record<string, unknown>;
    const researchLoc = (researchEngineReq.location || {}) as Record<string, unknown>;
    const researchSource = (researchEngineReq.source || {}) as Record<string, unknown>;
    const projectedResearch = projectPublicResult(researchRawObj);

    const blockedData = blockedRaw as Record<string, unknown> | null;
    const blockedReportDto = (blockedData?.report_dto || {}) as Record<string, unknown>;
    const blockedEngineReq = ((blockedReqRaw as Record<string, unknown> | null)?.engine_request ||
      {}) as Record<string, unknown>;
    const blockedLoc = (blockedEngineReq.location || {}) as Record<string, unknown>;

    return NextResponse.json(
      {
        schema: 'astragron.public-demo.v1',
        readOnly: true,
        scope: 'PUBLIC_NASA_JUDGING_DEMONSTRATION',
        notice:
          'Verified Cached Research Example — Not an Analysis of Your Selected Field. Private farms, custom per-location simulations, operator job submission, and backend credentials remain protected; read-only offline evidence-grounded Q&A queries only the cached Wageningen dataset.',
        customLocationAnalysisSupported: false,
        customLocationStatusReason:
          'Public demonstration serves an immutable VERIFIED_CACHED_REPLAY for Wageningen, Netherlands (CACHE_ONLY; fresh_scientific_jobs=0). Selected Earth Explorer coordinates are NOT submitted to or analyzed by this endpoint.',
        serviceStatus: {
          scientificStatus:
            typeof readyJson?.status === 'string' ? readyJson.status : 'unknown',
          protectedBaselineFiles:
            typeof readyJson?.protected === 'number' ? readyJson.protected : null,
          pinnedNativeRuntimeVerified: Boolean(readyJson?.pinned_native_runtime_verified),
          sourceSnapshotPresent: Boolean(readyJson?.source_snapshot_present),
          adaptiveEvidence: {
            enabled: Boolean(globalEvidence.enabled),
            reason:
              typeof globalEvidence.reason === 'string'
                ? globalEvidence.reason
                : 'UPSTREAM_LOCK_MISMATCH',
          },
          chat: {
            available: Boolean(chatStatus.available),
            publicReadOnlyEnabled: Boolean(chatStatus.available),
            liveInferenceVerified: Boolean(chatStatus.live_inference_verified),
            mode: 'OFFLINE_EVIDENCE_GROUNDED_FALLBACK',
          },
        },
        researchExample: {
          demo_case: researchJob.demo_case,
          demo_label:
            researchJob.demo_label || 'Verified cached five-year research comparison',
          execution_kind: researchJob.execution_kind,
          state: researchJob.state,
          phase: researchJob.phase,
          scientific_status: researchJob.scientific_status,
          report_available: !researchJob.report_error,
          pdfDownloadUrl: '/api/public-demo?download=pdf',
          cachedCaseIdentity: {
            bannerLabel:
              'Verified Cached Research Example — Not an Analysis of Your Selected Field.',
            farmId: String(researchRawObj.farm_id || researchJob.farm_id || ''),
            siteId: typeof researchLoc.site_id === 'string' ? researchLoc.site_id : 'NL_WAGENINGEN_GROWTH',
            locationLabel: 'Wageningen, Netherlands',
            country: typeof researchLoc.country === 'string' ? researchLoc.country : 'NL',
            coordinatesLonLat: Array.isArray(researchLoc.point_lon_lat)
              ? researchLoc.point_lon_lat.map(Number)
              : [5.67, 51.97],
            period: '2016–2020',
            sourceProvider:
              typeof researchSource.provider === 'string'
                ? researchSource.provider
                : 'NASA_POWER_GLOBAL',
            acquisitionMode:
              typeof researchSource.acquisition === 'string'
                ? researchSource.acquisition
                : 'CACHE_ONLY',
            analysisId: researchJob.analysis_id,
            runId: String(researchRawObj.run_id || researchJob.run_id || ''),
            requestSha256:
              typeof researchJob.request_sha256 === 'string' ? researchJob.request_sha256 : null,
            scientificResultSha256: projectedResearch.engine_result.scientific_result_sha256,
            freshScientificJobs: 0,
          },
          result: projectedResearch,
        },
        blockedExample:
          blockedJob && blockedData
            ? {
                demo_case: blockedJob.demo_case,
                demo_label:
                  blockedJob.demo_label || 'Verified cached missing-evidence abstention',
                execution_kind: blockedJob.execution_kind,
                state: blockedJob.state,
                scientific_status: blockedJob.scientific_status,
                status: String(blockedData.status || 'EVIDENCE_BLOCKED'),
                farm_id: String(blockedData.farm_id || ''),
                siteId: typeof blockedLoc.site_id === 'string' ? blockedLoc.site_id : 'AU_WAGGA_REGION',
                coordinatesLonLat: Array.isArray(blockedLoc.point_lon_lat)
                  ? blockedLoc.point_lon_lat.map(Number)
                  : [147.35, -35.05],
                analysisId: blockedJob.analysis_id,
                summary:
                  typeof blockedReportDto.summary === 'string'
                    ? blockedReportDto.summary
                    : null,
                missing_requirements: Array.isArray(blockedData.missing_requirements)
                  ? blockedData.missing_requirements
                  : [],
                warnings: Array.isArray(blockedData.warnings) ? blockedData.warnings : [],
              }
            : null,
      },
      { status: 200, headers: publicHeaders() }
    );
  } catch (error) {
    const status = error instanceof CoreProblem ? error.status : 503;
    const code = error instanceof CoreProblem ? error.code : 'PUBLIC_DEMO_UNAVAILABLE';
    return NextResponse.json({ error: code }, { status, headers: publicHeaders() });
  }
}

/**
 * Public read-only evidence-grounded Q&A endpoint bounded strictly to the immutable
 * cached Wageningen research demonstration. Rejects coordinate inputs and blocks
 * 'what-if' job submission so public traffic can never enqueue backend simulations.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    checkPublicChatRateLimit(request);

    const body = await readBody(request);
    const keys = Object.keys(body);
    if (keys.some((k) => k !== 'question' && k !== 'scenario')) {
      throw new CoreProblem(422, 'PUBLIC_DEMO_FIXED_CASE_ONLY');
    }

    const rawQuestion = body.question;
    if (typeof rawQuestion !== 'string') {
      throw new CoreProblem(422, 'INVALID_CHAT_QUESTION');
    }
    const trimmedQuestion = rawQuestion.trim();
    if (!trimmedQuestion || trimmedQuestion.length > 500) {
      throw new CoreProblem(422, 'INVALID_CHAT_QUESTION');
    }

    const rawScenario = body.scenario;
    const safeScenario =
      typeof rawScenario === 'string' && ALLOWED_SCENARIOS.has(rawScenario)
        ? rawScenario
        : 'REFERENCE';

    const cachedCaseReference =
      'NL_WAGENINGEN_GROWTH (Wageningen, Netherlands · 5.67°E, 51.97°N · farm NL_THREE_CROP_PRODUCING_RESEARCH · 2016–2020)';

    if (READ_ONLY_MUTATION_RE.test(trimmedQuestion)) {
      return NextResponse.json(
        {
          ok: true,
          readOnly: true,
          scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
          scenario: safeScenario,
          cachedCaseReference,
          mode: 'READ_ONLY_PUBLIC_DEMO_GUARD',
          reason_code: 'PUBLIC_JOB_SUBMISSION_DISABLED',
          answer:
            'Public demonstration mode is strictly read-only and cannot run new or modified simulation jobs (such as what-if rainfall changes). Ask about the verified cached Wageningen analysis (water balance, nitrogen leaching, Pareto alternatives, crop storage dry matter, or missing evidence).',
          claims: [],
        },
        { status: 200, headers: publicHeaders() }
      );
    }

    if (UNRELATED_LOCATION_RE.test(trimmedQuestion)) {
      return NextResponse.json(
        {
          ok: true,
          readOnly: true,
          scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
          scenario: safeScenario,
          cachedCaseReference,
          mode: 'PUBLIC_DEMO_CACHED_CASE_SCOPE_NOTICE',
          reason_code: 'UNRELATED_SELECTED_LOCATION',
          answer:
            `This public demonstration and Q&A assistant cover ONLY the verified cached Wageningen, Netherlands research case (${cachedCaseReference}). Selected Earth Explorer coordinates or other regions (such as Uppsala, Nyeri, or Wagga Wagga) are not modeled here because custom per-location simulations and field-specific soil/crop calibrations are unavailable in public demo mode (CACHE_ONLY, fresh_scientific_jobs = 0). Ask specifically about water balance, nitrogen leaching, Pareto alternatives, crop dry matter, or missing evidence for the Wageningen cached case.`,
          claims: [],
        },
        { status: 200, headers: publicHeaders() }
      );
    }

    const catalog = (await coreJson('/v1/demo/catalog')) as {
      analyses?: (CoreState & { run_id?: string | null; request_sha256?: string | null })[];
    };
    const analyses = Array.isArray(catalog.analyses) ? catalog.analyses : [];
    const researchJob = analyses.find(
      (item) =>
        item.demo_case === 'research' &&
        item.execution_kind === 'VERIFIED_CACHED_REPLAY'
    );
    if (!researchJob) {
      throw new CoreProblem(503, 'PUBLIC_DEMO_NOT_AVAILABLE');
    }

    const conversation = (await coreJson('/v1/conversations', 'POST', {
      analysis_id: researchJob.analysis_id,
      locale: 'en',
    })) as { session_id: string };
    const sid = conversation.session_id;

    try {
      const explicitYear = EXPLICIT_YEAR_RE.test(trimmedQuestion);
      const scope = explicitYear
        ? { field_id: 'F1', scenario_id: safeScenario }
        : { field_id: 'F1', source_year: 2017, scenario_id: safeScenario };

      const msgRes = await coreFetch(`/v1/conversations/${encodeURIComponent(sid)}/messages`, 'POST', {
        message: trimmedQuestion,
        scope,
      });
      const reply = (await msgRes.json().catch(() => null)) as CoreChatReply | null;

      if (!msgRes.ok || !reply) {
        const code =
          reply && typeof (reply as { error?: unknown }).error === 'string'
            ? (reply as { error: string }).error
            : 'CHAT_UNAVAILABLE';
        throw new CoreProblem(msgRes.status || 503, code);
      }

      if (msgRes.status === 202 || reply.analysis_job) {
        return NextResponse.json(
          {
            ok: true,
            readOnly: true,
            scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
            scenario: safeScenario,
            cachedCaseReference,
            mode: 'READ_ONLY_PUBLIC_DEMO_GUARD',
            reason_code: 'PUBLIC_JOB_SUBMISSION_DISABLED',
            answer:
              'Custom scenario job submission is disabled in public read-only mode. Please ask about the existing verified cached Wageningen analysis results.',
            claims: [],
          },
          { status: 200, headers: publicHeaders() }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          readOnly: true,
          scope: 'PUBLIC_CACHED_WAGENINGEN_DEMO',
          scenario: safeScenario,
          cachedCaseReference,
          mode: typeof reply.mode === 'string' ? reply.mode : 'DETERMINISTIC_FALLBACK',
          reason_code: typeof reply.reason_code === 'string' ? reply.reason_code : null,
          answer: String(reply.answer || reply.text || ''),
          claims: Array.isArray(reply.claims) ? reply.claims.slice(0, 20) : [],
        },
        { status: 200, headers: publicHeaders() }
      );
    } finally {
      await coreFetch(`/v1/conversations/${encodeURIComponent(sid)}`, 'DELETE').catch(() => null);
    }
  } catch (error) {
    const status = error instanceof CoreProblem ? error.status : 503;
    const code = error instanceof CoreProblem ? error.code : 'PUBLIC_CHAT_UNAVAILABLE';
    return NextResponse.json({ ok: false, error: code }, { status, headers: publicHeaders() });
  }
}
