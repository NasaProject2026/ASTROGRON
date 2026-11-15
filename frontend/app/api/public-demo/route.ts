import { NextResponse } from 'next/server';
import { CoreProblem, coreFetch, coreJson } from '@/server/core-backend';
import type { CoreResult, CoreState } from '@/domain/core-contracts';

export const dynamic = 'force-dynamic';

function publicHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
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

    const catalog = (await coreJson('/v1/demo/catalog')) as { analyses?: CoreState[] };
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

    const [readyRes, researchRaw, blockedRaw] = await Promise.all([
      coreFetch('/ready').catch(() => null),
      coreJson(`/v1/analyses/${encodeURIComponent(researchJob.analysis_id)}/result`),
      blockedJob
        ? coreJson(`/v1/analyses/${encodeURIComponent(blockedJob.analysis_id)}/result`).catch(
            () => null
          )
        : Promise.resolve(null),
    ]);

    const readyJson = readyRes
      ? ((await readyRes.json().catch(() => null)) as Record<string, unknown> | null)
      : null;

    const globalEvidence = (readyJson?.global_evidence || {}) as Record<string, unknown>;
    const chatStatus = (readyJson?.chat || {}) as Record<string, unknown>;

    const blockedData = blockedRaw as Record<string, unknown> | null;
    const blockedReportDto = (blockedData?.report_dto || {}) as Record<string, unknown>;

    return NextResponse.json(
      {
        schema: 'astragron.public-demo.v1',
        readOnly: true,
        scope: 'PUBLIC_NASA_JUDGING_DEMONSTRATION',
        notice:
          'Public read-only demonstration of verified cached ASTROGRON five-year research outputs. Private farms, operator job submission, AI Q&A, and backend credentials remain access-protected.',
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
          result: projectPublicResult(researchRaw as Record<string, unknown>),
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
