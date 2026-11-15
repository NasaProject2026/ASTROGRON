'use client';

import React, { useState, use } from 'react';
import {
  GitCompare,
  CheckCircle2,
  XOctagon,
  Ban,
  HelpCircle,
} from 'lucide-react';
import {
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron, formatVolumeWithUnit } from '@/hooks/use-astragron-store';
import { sortPoliciesByPreference } from '@/adapters/repositories';
import { useMessages } from '@/lib/i18n';
import type { ResearchPreference } from '@/domain/contracts';

export default function FarmDecisionExplorerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    getFarmDraft,
    repository,
    datasetMode,
    activePreference,
    setActivePreference,
    unitMode,
    complexityMode,
  } = useAstragron();
  const m = useMessages();
  const [inspectedPolicyId, setInspectedPolicyId] = useState<string>('SYNTH-POL-01');

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

  if (!draft || !decisionEnv.data) {
    return (
      <FailClosedStatusCard
        status={decisionEnv.status}
        statusReason={decisionEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Decision Explorer"
      />
    );
  }

  const dataset = decisionEnv.data;
  const isRecorded = dataset.datasetMode === 'RECORDED_M14_RESEARCH';
  const sorted = sortPoliciesByPreference(dataset, activePreference);
  const inspectedPolicy =
    dataset.policies.find((p) => p.policyId === inspectedPolicyId) ??
    dataset.policies[0]!;
  const refs = dataset.referenceSelections;
  const summary = dataset.portfolioSummary;

  return (
    <div className="space-y-6">
      {/* Header & Pareto / Regret Explanation */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#29455A] pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
              ROBUST DECISION EXPLORER · PARETO, REGRET & WITNESSES · {dataset.datasetMode}
            </span>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD]">
              Multi-Criteria Trade-Offs & Scenario Failure Witnesses
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
              Compare worst-case physical ET shortfall against minimax regret and water source
              withdrawal across all {summary.totalPoliciesTested}{' '}
              {isRecorded ? 'recorded M14' : 'synthetic'} policies.
            </p>
          </div>
          <ViewEvidenceButton evidenceId={waterEvidenceId} siteId={id} />
        </div>

        {/* Tooltip / Plain-English Regret vs Shortfall Explainer */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
          <div className="rounded-xl border border-[#72E4F1]/40 bg-[#081728] p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 font-mono font-semibold text-[#72E4F1]">
              <HelpCircle className="w-4 h-4" />
              <span>What is Worst-Case Modeled ET Shortfall?</span>
            </div>
            <p className="text-[#AEC4D3] leading-relaxed">
              The largest total farm-wide evapotranspiration deficit (<code>m³ equivalent</code>)
              experienced by a policy across the {summary.totalScenarioStates} tested scenario states. Policy{' '}
              <code>{refs.leastWorstShortfallPolicyId}</code> achieves the lowest worst-state shortfall at{' '}
              <strong>{formatVolumeWithUnit(refs.leastWorstShortfallValueM3Eq, unitMode, 2)}</strong>.
            </p>
          </div>

          <div className="rounded-xl border border-[#57D9A7]/40 bg-[#081728] p-4 space-y-1.5">
            <div className="flex items-center gap-1.5 font-mono font-semibold text-[#57D9A7]">
              <HelpCircle className="w-4 h-4" />
              <span>What is Minimax Regret?</span>
            </div>
            <p className="text-[#AEC4D3] leading-relaxed">
              This ranks plans by their largest disadvantage versus the best comparable plan in each
              tested scenario. Policy <code>{refs.minimaxRegretPolicyId}</code> achieves the lowest maximum
              regret at <strong>{formatVolumeWithUnit(refs.minimaxRegretValueM3Eq, unitMode, 2)}</strong>.
              These are different functions and cannot be directly compared as total water volume.
            </p>
          </div>
        </div>
      </div>

      {/* Pareto Non-Dominated Frontier Section (`NO_UNIQUE_WINNER`) */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-[#DCC08A]" />
            <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
              Pareto Non-Dominated Frontier (Outcome: NO_UNIQUE_WINNER)
            </h3>
          </div>
          <span className="font-mono text-xs text-[#DCC08A]">
            {sorted.paretoFrontierPolicies.length} non-dominated policies of {summary.comparablePoliciesCount} comparable
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {sorted.paretoFrontierPolicies.map((pol) => (
            <button
              key={pol.policyId}
              type="button"
              onClick={() => setInspectedPolicyId(pol.policyId)}
              className={`rounded-xl border p-4 text-left transition cursor-pointer space-y-2 ${
                inspectedPolicy.policyId === pol.policyId
                  ? 'border-[#72E4F1] bg-[#132B3F] shadow-md'
                  : 'border-[#29455A] bg-[#081728] hover:border-[#548299]'
              }`}
            >
              <div className="font-mono text-[11px] text-[#72E4F1]">{pol.policyId}</div>
              <div className="font-semibold text-xs text-[#F1F7FD]">{pol.shortLabel}</div>
              <div className="space-y-1 pt-2 border-t border-[#29455A]/60 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-[#90A8BA]">Worst Shortfall:</span>
                  <span className="text-[#F1F7FD]">
                    {pol.worstEtShortfallM3Eq?.toLocaleString('en-US', { maximumFractionDigits: 1 })} m³
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#90A8BA]">Max Regret:</span>
                  <span className="text-[#57D9A7]">
                    {pol.maxRegretM3Eq?.toLocaleString('en-US', { maximumFractionDigits: 1 })} m³
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#90A8BA]">Mean Withdrawal:</span>
                  <span className="text-[#91B8FF]">
                    {pol.meanSourceWithdrawalM3?.toLocaleString('en-US', { maximumFractionDigits: 0 })} m³
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Full Policy Ranking Table + Preference Sort Switcher */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Candidate trade-off comparison table"
        className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 overflow-x-auto space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#72E4F1]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
            Complete {summary.totalPoliciesTested}-Policy {isRecorded ? 'Recorded M14' : 'Synthetic Candidate'} Portfolio (Click any row to inspect {summary.totalScenarioStates}-state witnesses)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                'STRICT_ALL_SCENARIOS_SERVICE',
                'MINIMIZE_WORST_ET_SHORTFALL',
                'MINIMAX_REGRET',
                'PARETO_FRONTIER',
              ] as ResearchPreference[]
            ).map((pref) => (
              <button
                key={pref}
                type="button"
                onClick={() => setActivePreference(pref)}
                className={`min-h-[44px] rounded-lg px-3 py-2 font-mono text-[11px] cursor-pointer ${
                  activePreference === pref
                    ? 'bg-[#72E4F1] text-[#081521] font-bold'
                    : 'bg-[#081728] text-[#AEC4D3]'
                }`}
              >
                {complexityMode === 'SIMPLE' ? m.preferences[pref].label : pref}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full min-w-[820px] text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#29455A] font-mono text-[#90A8BA]">
              <th className="py-2.5 pe-3">Comparable Rank</th>
              <th className="py-2.5 px-3">Policy ID & Rotation</th>
              <th className="py-2.5 px-3">States (Pass/Fail/Invalid)</th>
              <th className="py-2.5 px-3">Worst ET Shortfall (m³ eq)</th>
              <th className="py-2.5 px-3">Max Regret (m³ eq)</th>
              <th className="py-2.5 ps-3">Mean Withdrawal (m³)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#29455A]/60">
            {[...sorted.comparablePoliciesOrdered, ...sorted.excludedCalendarPolicies].map(
              (pol, idx) => {
                const isSelected = inspectedPolicy.policyId === pol.policyId;
                return (
                  <tr
                    key={pol.policyId}
                    onClick={() => setInspectedPolicyId(pol.policyId)}
                    className={`cursor-pointer transition ${
                      isSelected
                        ? 'bg-[#132B3F]'
                        : !pol.isComparable
                        ? 'bg-[#2C141B]/30 hover:bg-[#2C141B]/50'
                        : 'hover:bg-[#132B3F]/50'
                    }`}
                  >
                    <td className="py-3 pe-3 font-mono font-bold">
                      {pol.isComparable ? (
                        <span className="text-[#72E4F1]">#{idx + 1}</span>
                      ) : (
                        <span className="text-[#FF9299] flex items-center gap-1">
                          <Ban className="w-3.5 h-3.5" /> EXCLUDED
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-[#F1F7FD]">{pol.policyId}</div>
                      <div className="text-[11px] text-[#AEC4D3]">{pol.shortLabel}</div>
                    </td>
                    <td className="py-3 px-3 font-mono">
                      {pol.isComparable ? (
                        <span>
                          <span className="text-[#57D9A7]">{pol.statesPassedCount}P</span> /{' '}
                          <span className="text-[#FFCE7B]">{pol.statesFailedCount}F</span> / 0 Inv
                        </span>
                      ) : (
                        <span className="text-[#FF9299]">
                          {pol.statesPassedCount}P / {pol.statesFailedCount}F / {pol.calendarInvalidCount} Calendar-Invalid
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#F1F7FD]">
                      {pol.worstEtShortfallM3Eq === null
                        ? 'NULL'
                        : pol.worstEtShortfallM3Eq.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#57D9A7]">
                      {pol.maxRegretM3Eq === null ? 'NULL' : pol.maxRegretM3Eq.toFixed(2)}
                    </td>
                    <td className="py-3 ps-3 font-mono text-[#91B8FF]">
                      {formatVolumeWithUnit(pol.meanSourceWithdrawalM3, unitMode, 1)}
                    </td>
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </div>

      {/* State Witness Matrix for Selected Policy */}
      <div className="rounded-2xl border border-[#72E4F1]/50 bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
          <div>
            <span className="font-mono text-xs uppercase text-[#72E4F1]">
              SCENARIO WITNESS BREAKDOWN · {summary.totalScenarioStates} {isRecorded ? 'RECORDED' : 'SYNTHETIC'} STATES
            </span>
            <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
              Per-State Evaluation for Policy {inspectedPolicy.policyId} ({inspectedPolicy.shortLabel})
            </h3>
          </div>
          <ViewEvidenceButton evidenceId={weatherEvidenceId} siteId={id} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {inspectedPolicy.scenarioOutcomes.map((st) => (
            <div
              key={st.stateId}
              className={`rounded-xl border p-3.5 text-xs space-y-2 ${
                !st.isNumericValid
                  ? 'border-[#FF9299]/50 bg-[#2C141B]/40'
                  : st.passesServiceCriterion
                  ? 'border-[#29455A] bg-[#081728]'
                  : 'border-[#FFCE7B]/50 bg-[#252015]/50'
              }`}
            >
              <div className="flex items-center justify-between font-mono">
                <span className="font-bold text-[#F1F7FD]">{st.stateId}</span>
                {!st.isNumericValid ? (
                  <span className="text-[#FF9299] flex items-center gap-1">
                    <XOctagon className="w-3.5 h-3.5" /> CALENDAR_INVALID
                  </span>
                ) : st.passesServiceCriterion ? (
                  <span className="text-[#57D9A7] flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                  </span>
                ) : (
                  <span className="text-[#FFCE7B] flex items-center gap-1">
                    <XOctagon className="w-3.5 h-3.5" /> FAIL
                  </span>
                )}
              </div>

              <div className="text-[11px] text-[#AEC4D3]">
                {st.analogueLabel} · {st.calendarVariant}
              </div>

              {!st.isNumericValid ? (
                <p className="text-[11px] text-[#FF9299]">{st.invalidReason}</p>
              ) : (
                <div className="space-y-1 pt-1 border-t border-[#29455A]/60 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#90A8BA]">ET Shortfall:</span>
                    <span className="text-[#F1F7FD]">{st.totalEtShortfallM3Eq?.toFixed(2)} m³ eq</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#90A8BA]">State Regret:</span>
                    <span className="text-[#57D9A7]">{st.regretM3Eq?.toFixed(2)} m³ eq</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#90A8BA]">Binding Field ({st.bindingFieldId}):</span>
                    <span className="text-[#FFCE7B]">{st.bindingFieldDeficitMm} mm</span>
                  </div>
                  {st.earliestFailureDate && (
                    <div className="flex justify-between text-[#FF9299]">
                      <span>First Breach Date:</span>
                      <span>{st.earliestFailureDate}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
