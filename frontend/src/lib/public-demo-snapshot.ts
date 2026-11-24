import wageningenRaw from '@/data/generated/wageningen-public-snapshot.json';
import blockedWaggaRaw from '@/data/generated/blocked-wagga-snapshot.json';
import type { CoreResult } from '@/domain/core-contracts';
import { withBasePath } from '@/lib/base-path';

export interface StandalonePublicDemoPayload {
  schema: string;
  readOnly: boolean;
  scope: string;
  notice: string;
  customLocationAnalysisSupported: boolean;
  customLocationStatusReason: string;
  serviceStatus: {
    scientificStatus: string;
    protectedBaselineFiles: number | null;
    pinnedNativeRuntimeVerified: boolean;
    sourceSnapshotPresent: boolean;
    adaptiveEvidence: { enabled: boolean; reason: string };
    chat: {
      available: boolean;
      publicReadOnlyEnabled: boolean;
      liveInferenceVerified: boolean;
      mode: string;
    };
  };
  researchExample: {
    demo_case: string;
    demo_label: string;
    execution_kind: string;
    state: string;
    phase: string;
    scientific_status: string;
    report_available: boolean;
    pdfDownloadUrl: string;
    cachedCaseIdentity: {
      bannerLabel: string;
      farmId: string;
      siteId: string;
      locationLabel: string;
      country: string;
      coordinatesLonLat: number[];
      period: string;
      sourceProvider: string;
      acquisitionMode: string;
      analysisId: string;
      runId: string;
      requestSha256: string | null;
      scientificResultSha256: string | null;
      freshScientificJobs: number;
    };
    result: CoreResult;
  };
  blockedExample: {
    demo_case: string;
    demo_label: string;
    execution_kind: string;
    state: string;
    scientific_status: string;
    status: string;
    farm_id: string;
    siteId: string;
    coordinatesLonLat: number[];
    analysisId: string;
    summary: string | null;
    missing_requirements: { path?: string; reason?: string; action?: string }[];
    warnings: string[];
  };
}

export function getStandalonePublicDemoPayload(): StandalonePublicDemoPayload {
  const result = wageningenRaw.result as unknown as CoreResult;
  return {
    schema: 'astragron.public-demo.v1',
    readOnly: true,
    scope: 'PUBLIC_NASA_JUDGING_DEMONSTRATION',
    notice:
      'Verified five-year Wageningen, Netherlands research study backed by historical 2016–2020 NASA POWER meteorology.',
    customLocationAnalysisSupported: false,
    customLocationStatusReason:
      'Serves the verified five-year Wageningen, Netherlands research study alongside regional evidence readiness checks.',
    serviceStatus: {
      scientificStatus: 'ready',
      protectedBaselineFiles: null,
      pinnedNativeRuntimeVerified: true,
      sourceSnapshotPresent: true,
      adaptiveEvidence: { enabled: false, reason: 'STANDALONE_SHOWCASE' },
      chat: {
        available: true,
        publicReadOnlyEnabled: true,
        liveInferenceVerified: false,
        mode: 'DETERMINISTIC_EVIDENCE_READER',
      },
    },
    researchExample: {
      demo_case: 'research',
      demo_label: 'Verified cached five-year research comparison',
      execution_kind: 'VERIFIED_CACHED_REPLAY',
      state: 'complete_research',
      phase: 'finished',
      scientific_status: 'CONDITIONAL_RESEARCH_COMPLETE',
      report_available: true,
      pdfDownloadUrl: withBasePath('/reports/ASTROGRON_Wageningen_Sample_Scientific_Report.pdf'),
      cachedCaseIdentity: {
        bannerLabel: 'Verified Wageningen Research Study (2016–2020)',
        farmId: result.farm_id,
        siteId: wageningenRaw.siteId,
        locationLabel: 'Wageningen, Netherlands',
        country: wageningenRaw.country,
        coordinatesLonLat: wageningenRaw.coordinatesLonLat,
        period: '2016–2020',
        sourceProvider: wageningenRaw.sourceProvider,
        acquisitionMode: wageningenRaw.acquisitionMode,
        analysisId: wageningenRaw.analysisId,
        runId: wageningenRaw.runId,
        requestSha256: wageningenRaw.requestSha256,
        scientificResultSha256: result.engine_result?.scientific_result_sha256 ?? null,
        freshScientificJobs: 0,
      },
      result,
    },
    blockedExample: {
      demo_case: 'blocked',
      demo_label: 'Verified missing-evidence regional abstention example',
      execution_kind: 'VERIFIED_CACHED_REPLAY',
      state: 'blocked',
      scientific_status: blockedWaggaRaw.status,
      status: blockedWaggaRaw.status,
      farm_id: blockedWaggaRaw.farm_id,
      siteId: blockedWaggaRaw.siteId,
      coordinatesLonLat: blockedWaggaRaw.coordinatesLonLat,
      analysisId: blockedWaggaRaw.analysisId,
      summary: blockedWaggaRaw.summary ?? null,
      missing_requirements: blockedWaggaRaw.missing_requirements,
      warnings: blockedWaggaRaw.warnings,
    },
  };
}
