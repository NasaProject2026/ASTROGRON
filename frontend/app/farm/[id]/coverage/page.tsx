'use client';

import React, { use } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ArrowRight,
  Globe2,
  FlaskConical,
  AlertTriangle,
  Database,
} from 'lucide-react';
import {
  CoverageStatusBadge,
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron } from '@/hooks/use-astragron-store';

export default function FarmCoverageReadinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { getFarmDraft, repository, datasetMode, complexityMode } = useAstragron();
  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND') {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Evidence Readiness & Source Qualification Matrix"
      />
    );
  }

  const preset = siteEnv.data;
  const siteEvidenceRecords = repository.getEvidenceRecordsForSite(id, draft);
  const defaultEvidenceId = siteEvidenceRecords[0]?.evidence_id ?? null;

  if (!preset) {
    return (
      <FailClosedStatusCard
        status={siteEnv.status}
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Evidence Readiness & Source Qualification Matrix"
      />
    );
  }

  const isSimple = complexityMode === 'SIMPLE';
  const isModified = Boolean(draft.inputsModified || draft.isUserCreatedDraft);

  const allOutOfCoverage =
    preset.sourceCoverages.length > 0 &&
    preset.sourceCoverages.every((src) => src.status === 'OUT_OF_COVERAGE');
  const hasAnyOutOfCoverage = preset.sourceCoverages.some(
    (src) => src.status === 'OUT_OF_COVERAGE'
  );

  const sourceCoverageValue = isModified
    ? isSimple
      ? 'Unverified Site Coordinates'
      : 'UNKNOWN (UNVERIFIED COORDINATE)'
    : preset.id === 'polar-svalbard'
      ? isSimple
        ? 'Out of Coverage (High-Latitude Snow/Ice Mask)'
        : 'OUT_OF_COVERAGE / CONDITIONAL High-Latitude Mask'
      : allOutOfCoverage
        ? isSimple
          ? 'Out of Coverage (Outside Terrestrial Band)'
          : 'OUT_OF_COVERAGE (OUTSIDE LAND / VALID BAND)'
        : hasAnyOutOfCoverage
          ? isSimple
            ? 'Partial Coverage (Regional Satellite Context Only)'
            : 'PARTIAL / MIXED CONDITIONAL & OUT_OF_COVERAGE'
          : isSimple
            ? 'Regional Satellite Context Available'
            : 'PARTIAL / GRIDDED REFERENCE';

  const modelQualificationValue = isModified
    ? isSimple
      ? 'Modified Inputs · Analysis Not Run'
      : 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    : preset.id === 'uppsala-demo'
      ? datasetMode === 'RECORDED_M14_RESEARCH'
        ? isSimple
          ? 'Recorded M14 Corpus Only (Read-Only)'
          : 'RECORDED_M14_RESEARCH_READ_ONLY'
        : isSimple
          ? 'Synthetic Demo Showcase Only'
          : 'SYNTHETIC_UI_DEMO_ONLY'
      : isSimple
        ? 'Local Crop Model Not Qualified'
        : 'MODEL_UNQUALIFIED';

  const fieldEligibilityValue = isSimple
    ? 'Blocked (Not Field Advice)'
    : 'BLOCKED';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-xs uppercase tracking-wider text-[#91B8FF] break-words">
              {isSimple
                ? `Evidence Readiness & Satellite Context · ${preset.id}`
                : `M4 GLOBAL EVIDENCE CONTRACT · astragron.global-evidence.v1 · ${preset.id}`}
            </span>
            <h2 className="mt-1 font-display text-xl sm:text-2xl font-bold text-[#F1F7FD] break-words">
              Evidence Readiness & Source Qualification Matrix ({preset.name})
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
              Source availability is evaluated per site × variable × time × purpose. Having NASA
              regional rainfall or temperature context does NOT unlock field-calibrated crop recommendations.
            </p>
          </div>
          <ViewEvidenceButton evidenceId={defaultEvidenceId} siteId={id} label="Open Site Provenance Drawer" />
        </div>

        {/* Separated 3-Dimension Scientific Status Breakdown */}
        <div
          data-testid="coverage-three-axis-matrix"
          className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs"
        >
          <div className="min-w-0 rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] break-words">
              {isSimple ? '1 · Satellite & Gridded Data' : 'SOURCE_DATA_COVERAGE (EO & Gridded)'}
            </span>
            <div className="font-mono font-semibold text-[#72E4F1] break-words">
              {sourceCoverageValue}
            </div>
            <p className="text-[11px] text-[#AEC4D3]">
              NASA POWER (~50 km, 2001–2024), GPM IMERG (0.1°, precip), SMAP L4 (9 km, soil moisture), HLS (30 m optical).
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] break-words">
              {isSimple ? '2 · Local Crop Model Readiness' : 'AGRONOMIC_MODEL_QUALIFICATION'}
            </span>
            <div className="font-mono font-semibold text-[#FFCE7B] break-words">
              {modelQualificationValue}
            </div>
            <p className="text-[11px] text-[#AEC4D3]">
              {preset.id === 'uppsala-demo' && !isModified
                ? 'Scoped exclusively to immutable 3-field (24.0 ha) Uppsala showcase.'
                : 'Local crop, variety, soil-horizon & irrigation model not run or unqualified here.'}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-[#29455A] bg-[#081728] p-3.5 space-y-1">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] break-words">
              {isSimple ? '3 · Real-Farm Advice Eligibility' : 'FIELD_RECOMMENDATION_ELIGIBILITY'}
            </span>
            <div className="font-mono font-semibold text-[#FF9299] break-words">
              {fieldEligibilityValue}
            </div>
            <p className="text-[11px] text-[#AEC4D3]">
              Real-farm irrigation & planting deployment remains blocked across all showcase modes.
            </p>
          </div>
        </div>

        {/* No-Dead-End Action Bar */}
        <div className="rounded-xl border border-[#548299]/60 bg-[#081728] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#AEC4D3]">
            <strong className="text-[#F1F7FD]">Next Actions:</strong> Review available Earth context,
            inspect required local measurements, or proceed to scenario analysis.
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Link
              href="/explore"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#29455A] bg-[#0D2031] px-3.5 py-2 text-xs text-[#AEC4D3] hover:text-[#F1F7FD]"
            >
              <Globe2 className="w-3.5 h-3.5 text-[#72E4F1]" />
              <span>Change Location</span>
            </Link>
            <Link
              href="/farm/uppsala-demo/results"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#548299] bg-[#0D2031] px-3.5 py-2 text-xs text-[#72E4F1] hover:bg-[#17374A]"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>
                {datasetMode === 'RECORDED_M14_RESEARCH'
                  ? 'Open Uppsala Recorded M14 Results'
                  : 'Open Uppsala Synthetic Demo'}
              </span>
            </Link>
            <Link
              href={`/farm/${id}/analysis`}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#72E4F1] px-4 py-2 text-xs font-semibold text-[#081521] hover:bg-[#43C9C1]"
            >
              <span>Proceed to Scenario Setup</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Per-Source M4 Coverage Cards */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#29455A] pb-3">
          <Database className="w-4 h-4 shrink-0 text-[#72E4F1]" />
          <h3 className="font-display text-lg font-bold text-[#F1F7FD] break-words">
            Source Coverage by Variable & Purpose ({preset.name})
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {preset.sourceCoverages.map((cov) => (
            <div
              key={cov.source_id}
              className="min-w-0 rounded-xl border border-[#29455A] bg-[#081728] p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-[#72E4F1] block break-words">{cov.source_id}</span>
                  <h4 className="text-base font-semibold text-[#F1F7FD] break-words">{cov.source_title}</h4>
                  <span className="text-xs text-[#90A8BA]">Publisher: {cov.publisher}</span>
                </div>
                <CoverageStatusBadge status={cov.status} />
              </div>

              <p className="text-xs sm:text-sm text-[#AEC4D3]">{cov.reason}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-[#29455A]/60 text-xs font-mono">
                <div className="min-w-0">
                  <span className="text-[#90A8BA] block text-[10px]">VARIABLES</span>
                  <span className="text-[#91B8FF] break-words">{cov.variable}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[#90A8BA] block text-[10px]">SPATIAL COVERAGE</span>
                  <span className="text-[#F1F7FD] break-words">{cov.spatial_coverage}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[#90A8BA] block text-[10px]">OBSERVATION WINDOW</span>
                  <span className="text-[#F1F7FD] break-words">{cov.observation_period}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-[#90A8BA] block text-[10px]">INFERENCE ELIGIBILITY</span>
                  <span className="text-[#DCC08A] break-words">{cov.inference_eligibility}</span>
                </div>
              </div>

              {cov.why_unavailable_detail && (
                <div className="rounded-lg border border-[#FFCE7B]/35 bg-[#252015]/60 p-3 text-xs text-[#FFCE7B]">
                  <strong>Why is this conditional or unavailable for field decisions?</strong>{' '}
                  <span className="text-[#AEC4D3]">{cov.why_unavailable_detail}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Capability Assessment Cards */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-[#29455A] pb-3">
          <ShieldCheck className="w-4 h-4 shrink-0 text-[#57D9A7]" />
          <h3 className="font-display text-lg font-bold text-[#F1F7FD] break-words">
            Downstream Scientific Capability Assessment ({preset.name})
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {preset.capabilities.map((cap) => (
            <div
              key={cap.capability}
              className="min-w-0 rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] text-[#72E4F1] block break-words">
                    {cap.capability}
                  </span>
                  <h4 className="text-sm font-semibold text-[#F1F7FD] break-words">{cap.capability_label}</h4>
                </div>
                <CoverageStatusBadge status={cap.status} size="sm" />
              </div>
              <p className="text-xs text-[#AEC4D3]">{cap.scientific_scope}</p>
              {cap.requirements_missing.length > 0 && (
                <div className="rounded-lg border border-[#FFCE7B]/40 bg-[#252015]/60 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-mono text-[#FFCE7B] mb-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Required Measurements Missing:</span>
                  </div>
                  <ul className="list-disc ps-4 space-y-1 text-[#AEC4D3]">
                    {cap.requirements_missing.map((mReq, idx) => (
                      <li key={idx}>{mReq}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
