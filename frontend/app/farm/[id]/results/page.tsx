'use client';

import React, { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  XOctagon,
  CheckCircle2,
  ArrowRight,
  CalendarRange,
  GitCompare,
  CloudRain,
  FileDown,
  Ban,
} from 'lucide-react';
import {
  EvidenceClassBadge,
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron, formatVolumeWithUnit } from '@/hooks/use-astragron-store';
import { useMessages } from '@/lib/i18n';
import { sortPoliciesByPreference } from '@/adapters/repositories';
import type { ResearchPreference, UserFarmDraft } from '@/domain/contracts';
import { FarmerReportPanel } from '@/components/report/farmer-report-panel';

function FarmerReportWithQuery({ farm }: { farm: UserFarmDraft }) {
  const searchParams = useSearchParams();
  const reportId = searchParams.get('reportId');
  return <FarmerReportPanel farm={farm} requestedReportId={reportId} />;
}

const PREFERENCES: ResearchPreference[] = [
  'STRICT_ALL_SCENARIOS_SERVICE',
  'MINIMIZE_WORST_ET_SHORTFALL',
  'MINIMAX_REGRET',
  'PARETO_FRONTIER',
];

export default function FarmDecisionOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const m = useMessages();
  const {
    getFarmDraft,
    repository,
    datasetMode,
    activePreference,
    setActivePreference,
    unitMode,
    complexityMode,
  } = useAstragron();

  const draft = getFarmDraft(id);
  const decisionEnv = repository.getM14DecisionEvaluation(id, draft);
  const siteRecords = repository.getEvidenceRecordsForSite(id, draft);
  const waterEvidenceId =
    siteRecords.find((r) => r.evidence_id.includes('water'))?.evidence_id ??
    siteRecords[0]?.evidence_id ??
    null;
  const weatherEvidenceId =
    siteRecords.find((r) => r.evidence_id.includes('weather'))?.evidence_id ??
    siteRecords[0]?.evidence_id ??
    null;

  if (!draft) {
    return (
      <FailClosedStatusCard
        status={decisionEnv.status}
        statusReason={decisionEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Decision Overview"
      />
    );
  }

  if (!decisionEnv.data) {
    return (
      <div className="space-y-6">
        <Suspense fallback={null}>
          <FarmerReportWithQuery farm={draft} />
        </Suspense>
        <FailClosedStatusCard
          status={decisionEnv.status}
          statusReason={decisionEnv.statusReason}
          farmId={id}
          datasetMode={datasetMode}
          surfaceTitle="Decision Overview"
        />
      </div>
    );
  }

  const dataset = decisionEnv.data;
  const sorted = sortPoliciesByPreference(dataset, activePreference);
  const summary = dataset.portfolioSummary;
  const refs = dataset.referenceSelections;
  const isRecorded = dataset.datasetMode === 'RECORDED_M14_RESEARCH';
  const sciMeta = dataset.scientificMeta;

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <FarmerReportWithQuery farm={draft} />
      </Suspense>
      {/* =====================================================================
          PRIMARY MISSION DECISION STATEMENT (MANDATORY EXACT HONEST OUTCOME)
         ===================================================================== */}
      <section
        aria-labelledby="decision-statement-heading"
        className="rounded-2xl border-2 border-[#FFCE7B]/60 bg-gradient-to-br from-[#252015] via-[#0D2031] to-[#081728] p-6 shadow-xl space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#FF9299]/60 bg-[#2C141B] px-2.5 py-1 font-mono text-xs font-bold text-[#FF9299]">
              <XOctagon className="w-3.5 h-3.5" />
              {complexityMode === 'SIMPLE'
                ? 'Field Recommendation: Blocked (Not Available)'
                : 'FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#DCC08A]/50 bg-[#252015] px-2.5 py-1 font-mono text-xs text-[#DCC08A]">
              {complexityMode === 'SIMPLE'
                ? `${summary.universalPassPoliciesCount} of ${summary.totalPoliciesTested} plans pass every scenario`
                : `SERVICE_CRITERION_FEASIBILITY: ${summary.universalPassPoliciesCount} / ${summary.totalPoliciesTested} UNIVERSAL PASS`}
            </span>
            {complexityMode === 'SCIENTIFIC' && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#72E4F1]/40 bg-[#081728] px-2.5 py-1 font-mono text-xs text-[#72E4F1]">
                MODE: {dataset.datasetMode}
              </span>
            )}
          </div>
          <ViewEvidenceButton
            evidenceId={waterEvidenceId}
            siteId={id}
            label="Inspect Decision Evidence"
          />
        </div>

        <blockquote
          id="decision-statement-heading"
          className="font-display text-lg sm:text-xl font-bold text-[#F1F7FD] leading-snug border-s-4 border-[#FFCE7B] ps-4"
        >
          &ldquo;{isRecorded ? m.recordedUi.noUniversalPlanBanner : m.banners.abstentionPrimary}&rdquo;
        </blockquote>

        {/* Evidence Status Strip */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#29455A]/80 text-xs">
          <span className="font-mono text-[#90A8BA]">Evidence Lineage:</span>
          {isRecorded ? (
            <>
              <EvidenceClassBadge evidenceClass="DERIVED" />
              <EvidenceClassBadge evidenceClass="REGIONAL_MODEL_EVIDENCE" />
              {sciMeta?.protocolSha256 && (
                <span className="rounded bg-[#0D2322] border border-emerald-400/50 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                  Protocol SHA-256: {sciMeta.protocolSha256.slice(0, 12)}…
                </span>
              )}
            </>
          ) : (
            <EvidenceClassBadge evidenceClass="SYNTHETIC_UI_FIXTURE" />
          )}
          <EvidenceClassBadge evidenceClass="RESEARCH_ASSUMPTION" />
          <EvidenceClassBadge evidenceClass="MISSING_OR_UNQUALIFIED" />
          <span className="font-mono text-[11px] text-[#90A8BA] ms-auto">
            Contract: {dataset.schemaId}
          </span>
        </div>
      </section>

      {/* =====================================================================
          ZONE 1: RESEARCH FEASIBILITY CASE BREAKDOWN
         ===================================================================== */}
      <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
              ZONE 01 · UNIVERSAL SERVICE FEASIBILITY AUDIT
            </span>
            <h2 className="font-display text-lg font-bold text-[#F1F7FD]">
              {complexityMode === 'SIMPLE'
                ? 'What can we say? Why didn’t any plan qualify universally?'
                : `${isRecorded ? 'Recorded M14' : 'Synthetic'} Candidate × Scenario State Matrix (${summary.totalPoliciesTested} Policies × ${summary.totalScenarioStates} States = ${summary.totalPolicyStateCases} Cases)`}
            </h2>
          </div>
          <ViewEvidenceButton evidenceId={weatherEvidenceId} siteId={id} label="2018 Analogue Provenance" />
        </div>

        {complexityMode === 'SIMPLE' && (
          <p className="rounded-xl border border-[#29455A] bg-[#081728]/90 px-4 py-3 text-xs leading-relaxed text-[#E3EFFA]">
            Plain summary: None of the {summary.totalPoliciesTested} studied crop plans avoided irrigation shortfall in every weather year
            (the dry 2018 analogue causes deficits across the 3 fields). Expand below to inspect the full {summary.totalPolicyStateCases}-case research grid.
          </p>
        )}

        <details
          key={`kpi-${complexityMode}`}
          open={complexityMode === 'SCIENTIFIC'}
          data-testid="results-kpi-details"
          className="rounded-xl border border-[#29455A] bg-[#081728]/60 p-3.5"
        >
          <summary className="cursor-pointer font-mono text-xs font-semibold text-[#72E4F1] select-none">
            {complexityMode === 'SIMPLE'
              ? `Show detailed ${summary.totalPolicyStateCases}-case scenario breakdown (Technical KPIs)`
              : `Scenario Evaluation Counts (${summary.totalPoliciesTested} Policies × ${summary.totalScenarioStates} States = ${summary.totalPolicyStateCases} Cases)`}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
              <span className="text-[11px] font-mono text-[#90A8BA] block">TOTAL EVALUATIONS</span>
              <span className="mt-1 font-mono text-xl font-bold text-[#F1F7FD]">
                {summary.totalPolicyStateCases}
              </span>
              <span className="text-[11px] text-[#AEC4D3] block">
                {summary.totalPoliciesTested} policies × {summary.totalScenarioStates} states
              </span>
            </div>

            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
              <span className="text-[11px] font-mono text-[#91B8FF] block">NUMERIC VALID</span>
              <span className="mt-1 font-mono text-xl font-bold text-[#91B8FF]">
                {summary.numericValidCases}
              </span>
              <span className="text-[11px] text-[#AEC4D3] block">
                {summary.comparablePoliciesCount} comparable policies
              </span>
            </div>

            <div className="rounded-xl border border-[#57D9A7]/40 bg-[#0D2B2A]/60 p-3.5">
              <span className="text-[11px] font-mono text-[#57D9A7] block">STATE PASSES</span>
              <span className="mt-1 font-mono text-xl font-bold text-[#57D9A7]">
                {summary.numericPassCases}
              </span>
              <span className="text-[11px] text-[#AEC4D3] block">2006 median & 2012 wet</span>
            </div>

            <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/60 p-3.5">
              <span className="text-[11px] font-mono text-[#FFCE7B] block">STATE FAILURES</span>
              <span className="mt-1 font-mono text-xl font-bold text-[#FFCE7B]">
                {summary.numericFailCases}
              </span>
              <span className="text-[11px] text-[#AEC4D3] block">2018 dry analogue states</span>
            </div>

            <div className="rounded-xl border border-[#FF9299]/40 bg-[#2C141B]/60 p-3.5">
              <span className="text-[11px] font-mono text-[#FF9299] block">CALENDAR INVALID</span>
              <span className="mt-1 font-mono text-xl font-bold text-[#FF9299]">
                {summary.calendarInvalidCases}
              </span>
              <span className="text-[11px] text-[#AEC4D3] block">
                {summary.excludedCalendarPoliciesCount} policy excluded ({summary.calendarInvalidCases} states)
              </span>
            </div>
          </div>
        </details>
      </section>

      {/* =====================================================================
          ZONE 2: ALTERNATIVE RESEARCH STRATEGIES & M14 PREFERENCE SELECTOR
         ===================================================================== */}
      <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#29455A] pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#57D9A7]">
              ZONE 02 · CONDITIONAL RESEARCH PORTFOLIO ORDER
            </span>
            <h2 className="font-display text-lg font-bold text-[#F1F7FD]">
              {complexityMode === 'SIMPLE'
                ? 'What conditional alternatives were studied?'
                : 'Finite Candidate Ranking by Research Preference Objective'}
            </h2>
          </div>

          {/* 4-Mode M14 Preference Selector */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="M14 Research Preference">
            {PREFERENCES.map((pref) => (
              <button
                key={pref}
                type="button"
                onClick={() => setActivePreference(pref)}
                aria-pressed={activePreference === pref}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                  activePreference === pref
                    ? 'bg-[#72E4F1] text-[#081521] font-semibold'
                    : 'border border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:text-[#F1F7FD]'
                }`}
              >
                {m.preferences[pref].label}
              </button>
            ))}
          </div>
        </div>

        {/* Active Preference Outcome Banner */}
        <div className="rounded-xl border border-[#548299]/60 bg-[#081728] p-4 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#72E4F1]">
              ACTIVE MODE: {activePreference} · OUTCOME: {sorted.selectionOutcome}
            </span>
            <span className="font-mono text-[11px] text-[#DCC08A]">
              Finite candidate-set analysis, not global optimization proof
            </span>
          </div>
          <h3 className="font-display text-base font-bold text-[#F1F7FD]">
            {sorted.selectionHeadline}
          </h3>
          <p className="text-xs text-[#AEC4D3] leading-relaxed">{sorted.selectionDetail}</p>
        </div>

        {/* Benchmark Reference Cards (Least Worst Shortfall vs Minimax Regret vs Pareto) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-[#72E4F1]/50 bg-[#081728] p-4 space-y-2.5">
            <div className="flex items-center justify-between font-mono text-[11px] text-[#72E4F1]">
              <span>LOWEST WORST-CASE MODELED ET SHORTFALL</span>
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="font-mono text-sm font-bold text-[#F1F7FD]">
              ID: {refs.leastWorstShortfallPolicyId}
            </div>
            <div className="font-mono text-lg font-bold text-[#72E4F1]">
              {formatVolumeWithUnit(refs.leastWorstShortfallValueM3Eq, unitMode, 2)}
            </div>
            <p className="text-xs text-[#AEC4D3]">
              Aggregate worst-state evapotranspiration shortfall across F1–F3 (24.0 ha). Framed as a
              conditional benchmark within the {summary.comparablePoliciesCount} comparable{' '}
              {isRecorded ? 'recorded M14' : 'synthetic'} policies—never called &ldquo;Best farm plan&rdquo;.
            </p>
          </div>

          <div className="rounded-xl border border-[#57D9A7]/50 bg-[#081728] p-4 space-y-2.5">
            <div className="flex items-center justify-between font-mono text-[11px] text-[#57D9A7]">
              <span>MINIMAX REGRET SELECTION</span>
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="font-mono text-sm font-bold text-[#F1F7FD]">
              ID: {refs.minimaxRegretPolicyId}
            </div>
            <div className="font-mono text-lg font-bold text-[#57D9A7]">
              {formatVolumeWithUnit(refs.minimaxRegretValueM3Eq, unitMode, 2)} max regret
            </div>
            <p className="text-xs text-[#AEC4D3]">
              Largest disadvantage versus the state-best comparable policy. Different mathematical
              function from total ET shortfall; do not compare regret and total shortfall as identical volumes.
            </p>
          </div>

          <div className="rounded-xl border border-[#DCC08A]/50 bg-[#081728] p-4 space-y-2.5">
            <div className="flex items-center justify-between font-mono text-[11px] text-[#DCC08A]">
              <span>PARETO NON-DOMINATED SET</span>
              <GitCompare className="w-4 h-4" />
            </div>
            <div className="font-mono text-sm font-bold text-[#F1F7FD]">
              NO_UNIQUE_WINNER ({sorted.paretoFrontierPolicies.length} Policies)
            </div>
            <div className="font-mono text-xs text-[#DCC08A] break-all">
              {sorted.paretoFrontierPolicies.map((p) => p.policyId).join(' · ')}
            </div>
            <p className="text-xs text-[#AEC4D3]">
              {sorted.paretoFrontierPolicies.length} policies lie on the non-dominated trade-off frontier across worst-state shortfall,
              regret, and mean irrigation withdrawal.
            </p>
          </div>
        </div>

        <details
          key={`table-${complexityMode}`}
          open={complexityMode === 'SCIENTIFIC'}
          data-testid="results-candidates-details"
          className="rounded-xl border border-[#29455A] bg-[#081728]/60 p-3.5 space-y-3"
        >
          <summary className="cursor-pointer font-mono text-xs font-semibold text-[#72E4F1] select-none">
            {complexityMode === 'SIMPLE'
              ? `Show full candidate comparison table & excluded policy details (${summary.comparablePoliciesCount} comparable + ${summary.excludedCalendarPoliciesCount} excluded)`
              : `Ordered Comparable ${isRecorded ? 'Recorded M14' : 'Synthetic'} Candidates & Calendar Exclusions`}
          </summary>

          {/* Top Ordered Comparable Policies Table */}
          <div
            tabIndex={0}
            role="region"
            aria-label="Ordered comparable candidate policies table"
            className="overflow-x-auto pt-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#72E4F1]"
          >
            <table className="w-full min-w-[720px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#29455A] font-mono text-[#90A8BA]">
                  <th className="py-2.5 pe-3">Order</th>
                  <th className="py-2.5 px-3">Policy ID & Summary</th>
                  <th className="py-2.5 px-3">State Pass/Fail</th>
                  <th className="py-2.5 px-3">Worst ET Shortfall</th>
                  <th className="py-2.5 px-3">Max Regret</th>
                  <th className="py-2.5 ps-3">Pareto Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#29455A]/60">
                {sorted.comparablePoliciesOrdered.slice(0, 6).map((pol, idx) => (
                  <tr key={pol.policyId} className="hover:bg-[#132B3F]/60">
                    <td className="py-3 pe-3 font-mono font-bold text-[#72E4F1]">#{idx + 1}</td>
                    <td className="py-3 px-3">
                      <div className="font-mono text-xs font-semibold text-[#F1F7FD]">
                        {pol.policyId}
                      </div>
                      <div className="text-[11px] text-[#AEC4D3]">{pol.shortLabel}</div>
                    </td>
                    <td className="py-3 px-3 font-mono">
                      <span className="text-[#57D9A7]">{pol.statesPassedCount} pass</span> ·{' '}
                      <span className="text-[#FFCE7B]">{pol.statesFailedCount} fail</span>
                    </td>
                    <td className="py-3 px-3 font-mono text-[#F1F7FD]">
                      {formatVolumeWithUnit(pol.worstEtShortfallM3Eq, unitMode, 2)}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#91B8FF]">
                      {formatVolumeWithUnit(pol.maxRegretM3Eq, unitMode, 2)}
                    </td>
                    <td className="py-3 ps-3 font-mono">
                      {pol.isParetoNonDominated ? (
                        <span className="rounded bg-[#0D2B2A] border border-[#57D9A7]/50 px-2 py-0.5 text-[11px] text-[#57D9A7]">
                          PARETO FRONTIER
                        </span>
                      ) : (
                        <span className="text-[#90A8BA]">Dominated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Excluded Calendar-Invalid Policy Callout */}
          {sorted.excludedCalendarPolicies.map((excl) => (
            <div
              key={excl.policyId}
              className="rounded-xl border border-[#FF9299]/40 bg-[#2C141B]/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono font-semibold text-[#FF9299]">
                  <Ban className="w-4 h-4" />
                  <span>
                    EXCLUDED FROM COMPARABLE RANKING: Policy {excl.policyId} ({excl.calendarInvalidCount} invalid states)
                  </span>
                </div>
                <p className="text-[#AEC4D3]">{excl.calendarInvalidReason}</p>
              </div>
              <span className="shrink-0 rounded bg-[#050A12] border border-[#FF9299]/40 px-2.5 py-1 font-mono text-[11px] text-[#FF9299]">
                Shortfall: NULL · Regret: NULL
              </span>
            </div>
          ))}
        </details>
      </section>

      {/* =====================================================================
          ZONE 3: WHY? BINDING CONSTRAINTS, WITNESSES & AUDIT TRAIL
         ===================================================================== */}
      <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#FFCE7B]">
              ZONE 03 · CONSTRAINT WITNESSES & LIMITATIONS
            </span>
            <h2 className="font-display text-lg font-bold text-[#F1F7FD]">
              Why Universal Qualification Failed: Binding Field & Assumption Audit
            </h2>
          </div>
          <ViewEvidenceButton evidenceId={waterEvidenceId} siteId={id} label="Audit Trail" />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
            <span className="font-mono text-[#FFCE7B] block">1. NON-IRRIGABLE FIELD LIMITATION</span>
            <h3 className="text-sm font-semibold text-[#F1F7FD]">
              Field {refs.nonIrrigableFieldId}: {refs.nonIrrigableDryDeficitMm.toFixed(1)} mm Deficit
            </h3>
            <p className="text-[#AEC4D3] leading-relaxed">
              Fields F1 (6.0 ha) and F2 (8.0 ha) have no irrigation infrastructure access (
              <code>irrigationAccess: NO</code>). Under the 2018 dry weather analogue, modeled
              reference deficit reaches <strong>{refs.nonIrrigableDryDeficitMm.toFixed(1)} mm</strong>.
              This is a modeled reference deficit, NOT a recommended irrigation depth.
            </p>
          </div>

          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
            <span className="font-mono text-[#DCC08A] block">2. RESEARCH-ASSUMED THRESHOLD</span>
            <h3 className="text-sm font-semibold text-[#F1F7FD]">
              {refs.assumedServiceThresholdMm.toFixed(1)} mm / Field / Harvest-Year Ceiling
            </h3>
            <p className="text-[#AEC4D3] leading-relaxed">
              The 100.0 mm service criterion is a scenario assumption (
              <code>RESEARCH_ASSUMPTION</code>), not a generally validated biological crop survival
              or harvest failure threshold.
            </p>
          </div>

          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
            <span className="font-mono text-[#91B8FF] block">3. MISSING LOCAL MEASUREMENTS</span>
            <h3 className="text-sm font-semibold text-[#F1F7FD]">
              Unverified Nitrogen, Yield & Water Rights
            </h3>
            <p className="text-[#AEC4D3] leading-relaxed">
              Nitrogen accounting is mass-conserving only (zero field-qualified N case). Economic
              surplus/stress figures belong to a separate frozen financial assumption case and are
              never inferred from ET deficits.
            </p>
          </div>
        </div>

        {sciMeta && (
          <div
            data-testid="recorded-m14-bracket-receipt"
            className="rounded-xl border border-emerald-400/40 bg-[#0D2322]/60 p-4 text-xs space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-emerald-300">
              <span>
                RECORDED M14 SERVICE SENSITIVITY BRACKET ({sciMeta.canonicalSiteId} · Policy{' '}
                {sciMeta.resourceSensitivityBracket.representativePolicyId.slice(0, 12)}…)
              </span>
              <span>
                Bracket: {Number(sciMeta.resourceSensitivityBracket.lastFailingGridMm).toFixed(6)} mm FAIL /{' '}
                {Number(sciMeta.resourceSensitivityBracket.firstPassingGridMm).toFixed(6)} mm PASS
              </span>
            </div>
            <p className="text-[#AEC4D3] leading-relaxed">
              <strong>In-Sample Selection &amp; Environment Caveat:</strong> {sciMeta.inSampleSelectionNote}{' '}
              {sciMeta.crossPlatformCaveat}
            </p>
            <div className="font-mono text-[11px] text-[#90A8BA] break-all">
              Protocol SHA-256: {sciMeta.protocolSha256}
            </div>
          </div>
        )}

        {/* Navigation Links to Deep-Dive Screens */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
          <Link
            href={`/farm/${id}/plans`}
            className="flex items-center justify-between rounded-xl border border-[#548299] bg-[#081728] p-3.5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1]"
          >
            <span className="flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-[#72E4F1]" />
              <span>5-Year Plan Matrix</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={`/farm/${id}/climate`}
            className="flex items-center justify-between rounded-xl border border-[#548299] bg-[#081728] p-3.5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1]"
          >
            <span className="flex items-center gap-2">
              <CloudRain className="w-4 h-4 text-[#91B8FF]" />
              <span>Climate & Water Plots</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={`/farm/${id}/decisions`}
            className="flex items-center justify-between rounded-xl border border-[#548299] bg-[#081728] p-3.5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1]"
          >
            <span className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-[#57D9A7]" />
              <span>Pareto & Regret Explorer</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={`/farm/${id}/reports`}
            className="flex items-center justify-between rounded-xl border border-[#548299] bg-[#081728] p-3.5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1]"
          >
            <span className="flex items-center gap-2">
              <FileDown className="w-4 h-4 text-[#DCC08A]" />
              <span>Export Research Report</span>
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
