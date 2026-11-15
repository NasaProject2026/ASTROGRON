'use client';

import React, { use } from 'react';
import {
  Printer,
  FileDown,
  FileJson,
  FileSpreadsheet,
  ShieldAlert,
} from 'lucide-react';
import { FailClosedStatusCard } from '@/components/design-system/primitives';
import { useAstragron } from '@/hooks/use-astragron-store';
import {
  buildSiteBoundExportPayload,
  sortPoliciesByPreference,
} from '@/adapters/repositories';
import { buildReportEnvelopeFromEvaluation } from '@/adapters/storage-adapters';
import { buildReportPdfBytes } from '@/lib/pdf-report';

export default function FarmReportsExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    getFarmDraft,
    getReportsForFarm,
    repository,
    datasetMode,
    unitMode,
    activePreference,
    prefsHydrated,
  } = useAstragron();

  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);
  const decisionEnv = repository.getM14DecisionEvaluation(id, draft);
  const siteEvidenceRecords = repository.getEvidenceRecordsForSite(id, draft);

  if (!prefsHydrated && !draft) {
    return (
      <div className="rounded-3xl border border-[#29455A] bg-[#0D2031] p-6 text-sm text-[#AEC4D3]">
        Loading farm report workspace from local device storage…
      </div>
    );
  }

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND') {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Reports & Export"
      />
    );
  }

  const handleDownloadSiteBoundJson = () => {
    const payload = buildSiteBoundExportPayload(
      id,
      draft.name,
      [draft.site.longitude, draft.site.latitude],
      activePreference,
      repository,
      draft
    );

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astragron-site-report-${id}-${datasetMode.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdfReport = () => {
    const latestSaved = getReportsForFarm(id)[0];
    const envelope =
      latestSaved ??
      buildReportEnvelopeFromEvaluation({
        farm: draft,
        repository,
        datasetMode,
        jobId: 'export-pdf',
      });
    const bytes = buildReportPdfBytes(envelope, unitMode);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astragron-farm-report-${draft.id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!decisionEnv.data) {
    return (
      <div className="space-y-6">
        <FailClosedStatusCard
          status={decisionEnv.status}
          statusReason={decisionEnv.statusReason}
          farmId={id}
          datasetMode={datasetMode}
          surfaceTitle="Reports & Export"
        />

        <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <span className="font-mono text-xs uppercase tracking-wider text-[#91B8FF]">
            SITE-SCOPED COVERAGE & PROVENANCE EXPORT ({id.toUpperCase()})
          </span>
          <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
            Download Site-Bound Coverage & Fail-Closed Status JSON
          </h3>
          <p className="text-xs text-[#AEC4D3]">
            Because crop decision optimization is not qualified for <code className="text-[#72E4F1]">{id}</code>{' '}
            (<code className="text-[#FFCE7B]">{decisionEnv.status}</code>), policy CSV export is disabled so
            Uppsala policies can never be exported under this site’s name. You may still export this site’s
            isolated coverage and provenance envelope.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!prefsHydrated}
              onClick={handleDownloadPdfReport}
              data-testid="reports-download-pdf-btn"
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#72E4F1] px-5 text-xs font-semibold text-[#081521] hover:bg-[#43C9C1] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              <FileDown className="w-4 h-4" />
              <span>Download PDF Report ({id})</span>
            </button>

            <button
              type="button"
              disabled={!prefsHydrated}
              data-dataset-mode={datasetMode}
              data-prefs-hydrated={prefsHydrated ? 'true' : 'false'}
              onClick={handleDownloadSiteBoundJson}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#548299] bg-[#081728] px-5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              <FileJson className="w-4 h-4" />
              <span>Download Site-Bound JSON ({id})</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const dataset = decisionEnv.data;
  const isRecorded = dataset.datasetMode === 'RECORDED_M14_RESEARCH';
  const sorted = sortPoliciesByPreference(dataset, activePreference);

  const inputRev =
    decisionEnv.inputIdentity?.inputRevision ?? draft.inputRevision ?? 'unknown-revision';
  const refRev = decisionEnv.inputIdentity?.referenceRevision ?? '';
  const inputsMod = decisionEnv.inputIdentity?.inputsModified ? 'true' : 'false';

  const handleDownloadResearchCsv = () => {
    const headers = [
      'watermark',
      'dataset_mode',
      'schema_id',
      'protocol_sha256',
      'site_id',
      'input_revision',
      'reference_revision',
      'inputs_modified',
      'crs',
      'preference_mode',
      'policy_id',
      'short_label',
      'is_comparable',
      'states_passed',
      'states_failed',
      'calendar_invalid_states',
      'worst_et_shortfall_m3_eq',
      'max_regret_m3_eq',
      'mean_withdrawal_m3',
      'is_pareto_nondominated',
      'field_recommendation_eligibility',
    ];

    const csvWatermark = isRecorded
      ? 'RECORDED_M14_SCIENTIFIC_ARCHIVE_READ_ONLY_NOT_A_FIELD_RECOMMENDATION'
      : 'SYNTHETIC_INTERFACE_DEMONSTRATION_NOT_RECORDED_SCIENTIFIC_RESULTS';
    const protoHash = dataset.scientificMeta?.protocolSha256 ?? 'NULL';

    const rows = [
      ...sorted.comparablePoliciesOrdered,
      ...sorted.excludedCalendarPolicies,
    ].map((p) => [
      `"${csvWatermark}"`,
      `"${dataset.datasetMode}"`,
      `"${dataset.schemaId}"`,
      `"${protoHash}"`,
      `"${dataset.siteId}"`,
      `"${inputRev}"`,
      `"${refRev}"`,
      inputsMod,
      '"EPSG:4326"',
      `"${activePreference}"`,
      `"${p.policyId}"`,
      `"${p.shortLabel.replace(/"/g, '""')}"`,
      p.isComparable ? 'true' : 'false',
      p.statesPassedCount,
      p.statesFailedCount,
      p.calendarInvalidCount,
      p.worstEtShortfallM3Eq === null ? 'NULL' : p.worstEtShortfallM3Eq.toFixed(2),
      p.maxRegretM3Eq === null ? 'NULL' : p.maxRegretM3Eq.toFixed(2),
      p.meanSourceWithdrawalM3 === null ? 'NULL' : p.meanSourceWithdrawalM3.toFixed(2),
      p.isParetoNonDominated ? 'true' : 'false',
      '"BLOCKED"',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isRecorded
      ? `astragron-recorded-m14-policies-${draft.id}.csv`
      : `astragron-synthetic-policies-${draft.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintReport = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="space-y-6">
      {/* Interactive Export Bar (Hidden when printing) */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4 no-print">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#29455A] pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#DCC08A]">
              RESEARCH EXPORTS & PRINTABLE DOSSIER · {dataset.datasetMode}
            </span>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD]">
              {isRecorded
                ? 'Export Recorded M14 Research Results & SHA-256 Provenance Report'
                : 'Export Synthetic Demonstration Results & Provenance Report'}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
              Download JSON or CSV of the currently displayed site evaluation with explicit{' '}
              <code className="text-[#DCC08A]">{dataset.datasetMode}</code> watermarks, units,
              and null preservation, or print the high-legibility HTML report below.
            </p>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-3"
          data-dataset-mode={dataset.datasetMode}
          data-prefs-hydrated={prefsHydrated ? 'true' : 'false'}
        >
          <button
            type="button"
            disabled={!prefsHydrated}
            onClick={handleDownloadPdfReport}
            data-testid="reports-download-pdf-btn"
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#57D9A7] px-5 text-xs sm:text-sm font-semibold text-[#071B15] hover:bg-[#43C9C1] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <FileDown className="w-4 h-4" />
            <span>Download Farmer PDF Report</span>
          </button>

          <button
            type="button"
            disabled={!prefsHydrated}
            onClick={handleDownloadSiteBoundJson}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#72E4F1] px-5 text-xs sm:text-sm font-semibold text-[#081521] hover:bg-[#43C9C1] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <FileJson className="w-4 h-4" />
            <span>Download Site-Bound JSON ({id})</span>
          </button>

          <button
            type="button"
            disabled={!prefsHydrated}
            onClick={handleDownloadResearchCsv}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#548299] bg-[#081728] px-5 text-xs sm:text-sm font-semibold text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#57D9A7]" />
            <span>Download Candidate Table CSV (Preserves NULLs)</span>
          </button>

          <button
            type="button"
            onClick={handlePrintReport}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-[#29455A] bg-[#081728] px-5 text-xs sm:text-sm font-semibold text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#DCC08A]" />
            <span>Print HTML Research Dossier</span>
          </button>
        </div>
      </div>

      {/* Printable Research Dossier Surface (Light-print friendly via .print-surface) */}
      <article className="print-surface rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 sm:p-8 space-y-6">
        <div className="border-b border-[#29455A] pb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs font-bold uppercase text-[#DCC08A] print-text-dark">
              {isRecorded
                ? 'RECORDED M14 SCIENTIFIC RESEARCH ARTIFACT — READ-ONLY ARCHIVE (BLOCKED FOR FIELD ADVICE)'
                : 'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS'}
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD] print-text-dark">
              ASTRAGRON {isRecorded ? 'Recorded Research' : 'Synthetic Demonstration'} Dossier: {draft.name}
            </h1>
            <p className="text-xs text-[#AEC4D3] print-text-dark">
              Site: {draft.site.locationLabel} · Coordinates: [{draft.site.longitude.toFixed(4)},{' '}
              {draft.site.latitude.toFixed(4)}] ({draft.site.crs}) · Mode: {dataset.datasetMode}
            </p>
          </div>
          <div className="font-mono text-xs text-end text-[#90A8BA] print-text-dark">
            <div>M4: astragron.global-evidence.v1</div>
            <div>M14: astragron.m14.response.v1</div>
            {dataset.scientificMeta?.protocolSha256 && (
              <div>Protocol SHA: {dataset.scientificMeta.protocolSha256.slice(0, 12)}…</div>
            )}
            <div>Input Rev: {inputRev}</div>
            <div>Inputs Modified: {inputsMod}</div>
          </div>
        </div>

        {/* Section 1: Abstention & Eligibility */}
        <div className="rounded-xl border border-[#FFCE7B]/50 bg-[#081728] p-4 space-y-2 print-surface">
          <div className="flex items-center gap-2 font-mono text-xs font-bold text-[#FFCE7B] print-text-dark">
            <ShieldAlert className="w-4 h-4" />
            <span>
              PRIMARY OUTCOME · FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED
            </span>
          </div>
          <p className="text-sm font-semibold text-[#F1F7FD] print-text-dark">
            No tested policy meets the declared water-service criterion across all {dataset.portfolioSummary.totalScenarioStates} scenario states in
            this {isRecorded ? 'recorded M14 corpus' : 'synthetic demonstration'}. You can still compare conditional research alternatives, but a
            field recommendation is not available.
          </p>
          <ul className="list-disc ps-5 text-xs text-[#AEC4D3] print-text-dark space-y-1">
            {dataset.fieldRecommendationBlockedReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>

        {/* Section 2: Key Reference Numbers */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 print-surface">
            <span className="font-mono text-[#90A8BA] print-text-dark block">
              CASE MATRIX SUMMARY
            </span>
            <div className="mt-1 font-mono text-sm font-bold text-[#F1F7FD] print-text-dark">
              {dataset.portfolioSummary.totalPoliciesTested} Policies × {dataset.portfolioSummary.totalScenarioStates} States = {dataset.portfolioSummary.totalPolicyStateCases} Cases
            </div>
            <div className="text-[#AEC4D3] print-text-dark mt-0.5">
              {dataset.portfolioSummary.numericValidCases} numeric ({dataset.portfolioSummary.numericPassCases} pass, {dataset.portfolioSummary.numericFailCases} fail) · {dataset.portfolioSummary.calendarInvalidCases} calendar-invalid · 0 universal pass
            </div>
          </div>

          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 print-surface">
            <span className="font-mono text-[#90A8BA] print-text-dark block">
              LEAST WORST ET SHORTFALL
            </span>
            <div className="mt-1 font-mono text-sm font-bold text-[#72E4F1] print-text-dark">
              {dataset.referenceSelections.leastWorstShortfallPolicyId}
            </div>
            <div className="text-[#AEC4D3] print-text-dark mt-0.5">
              {dataset.referenceSelections.leastWorstShortfallValueM3Eq.toFixed(2)} m³ equivalent in worst state
            </div>
          </div>

          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 print-surface">
            <span className="font-mono text-[#90A8BA] print-text-dark block">
              MINIMAX REGRET SELECTION
            </span>
            <div className="mt-1 font-mono text-sm font-bold text-[#57D9A7] print-text-dark">
              {dataset.referenceSelections.minimaxRegretPolicyId}
            </div>
            <div className="text-[#AEC4D3] print-text-dark mt-0.5">
              {dataset.referenceSelections.minimaxRegretValueM3Eq.toFixed(2)} m³ equivalent maximum regret
            </div>
          </div>
        </div>

        {/* Section 3: Provenance Table */}
        <div className="space-y-2">
          <h3 className="font-display text-base font-bold text-[#F1F7FD] print-text-dark break-words">
            Site-Scoped Evidence Lineage & Source Attribution ({id})
          </h3>
          <div
            tabIndex={0}
            role="region"
            aria-label="Site-scoped evidence lineage table"
            className="overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#72E4F1]"
          >
            <table className="w-full min-w-[540px] text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#29455A] text-[#90A8BA] print-text-dark">
                  <th className="py-2 pe-3">Evidence ID</th>
                  <th className="py-2 px-3">Class</th>
                  <th className="py-2 px-3">Source & Version</th>
                  <th className="py-2 ps-3">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#29455A]/60">
                {siteEvidenceRecords.map((ev) => (
                  <tr key={ev.evidence_id} className="text-[#F1F7FD] print-text-dark">
                    <td className="py-2 pe-3">{ev.evidence_id}</td>
                    <td className="py-2 px-3">{ev.evidence_class}</td>
                    <td className="py-2 px-3">{ev.source}</td>
                    <td className="py-2 ps-3">{ev.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  );
}
