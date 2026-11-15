'use client';

import React, { useState, use } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  GitCompare,
  Sprout,
} from 'lucide-react';
import {
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron, formatVolumeWithUnit } from '@/hooks/use-astragron-store';
import type { FieldYearPlanCell } from '@/domain/contracts';

export default function FarmFiveYearPlansPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { getFarmDraft, repository, datasetMode, unitMode, complexityMode } = useAstragron();

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

  const [primaryPolicyId, setPrimaryPolicyId] = useState<string>('SYNTH-POL-01');
  const [comparePolicyId, setComparePolicyId] = useState<string>('SYNTH-POL-02');
  const [showSideBySide, setShowSideBySide] = useState<boolean>(false);
  const [mobileYearFilter, setMobileYearFilter] = useState<number>(2);
  const [selectedCellOverride, setSelectedCellOverride] = useState<FieldYearPlanCell | null>(null);

  if (!draft || !decisionEnv.data) {
    return (
      <FailClosedStatusCard
        status={decisionEnv.status}
        statusReason={decisionEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Five-Year Plan Matrix"
      />
    );
  }

  const dataset = decisionEnv.data;
  const isRecorded = dataset.datasetMode === 'RECORDED_M14_RESEARCH';
  const primaryPolicy =
    dataset.policies.find((p) => p.policyId === primaryPolicyId) ??
    dataset.policies[0]!;
  const comparePolicy =
    dataset.policies.find((p) => p.policyId === comparePolicyId) ??
    dataset.policies[1]!;

  const selectedCell =
    (selectedCellOverride &&
      primaryPolicy.fieldYearMatrix.find(
        (c) =>
          c.fieldId === selectedCellOverride.fieldId &&
          c.harvestYear === selectedCellOverride.harvestYear
      )) ??
    primaryPolicy.fieldYearMatrix[1] ??
    primaryPolicy.fieldYearMatrix[0] ??
    null;

  return (
    <div className="space-y-6">
      {/* Header & Policy Switcher */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#29455A] pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#57D9A7]">
              {complexityMode === 'SIMPLE'
                ? '5-YEAR CROP PLAN · 3 FIELDS × HARVEST YEARS (Y1–Y5)'
                : `FIVE-YEAR RESEARCH MATRIX · 3 FIELDS (F1–F3) × HARVEST YEAR (Y1–Y5) · ${dataset.datasetMode}`}
            </span>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD]">
              {complexityMode === 'SIMPLE'
                ? 'Five-Year Crop Plan & Water-Deficit Check'
                : 'Multi-Year Crop Sequence & Water-Deficit Inspector'}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
              {complexityMode === 'SIMPLE'
                ? 'Tap any field year to inspect planting timing and dry-year irrigation deficit across the 24.0 ha example farm.'
                : `Click any field × year cell to inspect sowing/harvest windows, dry/median/wet analogue deficits, and calendar validity across the 24.0 ha Uppsala ${isRecorded ? 'recorded M14' : 'synthetic'} layout.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSideBySide((v) => !v)}
              aria-pressed={showSideBySide}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
                showSideBySide
                  ? 'border-[#72E4F1] bg-[#72E4F1] text-[#081521]'
                  : 'border-[#548299] bg-[#081728] text-[#F1F7FD] hover:border-[#72E4F1]'
              }`}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>{showSideBySide ? 'Exit Side-by-Side Compare' : 'Compare Two Policies'}</span>
            </button>
            <ViewEvidenceButton evidenceId={waterEvidenceId} siteId={id} />
          </div>
        </div>

        {/* Policy Selector Controls */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
            <label htmlFor="primary-policy-select" className="block font-mono text-xs text-[#72E4F1]">
              {isRecorded ? 'PRIMARY RECORDED M14 POLICY:' : 'PRIMARY SYNTHETIC POLICY:'}
            </label>
            <select
              id="primary-policy-select"
              value={primaryPolicy.policyId}
              onChange={(e) => {
                setPrimaryPolicyId(e.target.value);
                const pol = dataset.policies.find((p) => p.policyId === e.target.value);
                if (pol?.fieldYearMatrix[0]) setSelectedCellOverride(pol.fieldYearMatrix[0]);
              }}
              className="w-full min-h-[44px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-mono text-[#F1F7FD]"
            >
              {dataset.policies.map((p) => (
                <option key={p.policyId} value={p.policyId}>
                  {p.policyId} — {p.shortLabel}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center justify-between text-xs text-[#AEC4D3] pt-1">
              <span>
                Worst Shortfall:{' '}
                <strong className="font-mono text-[#F1F7FD]">
                  {formatVolumeWithUnit(primaryPolicy.worstEtShortfallM3Eq, unitMode, 2)}
                </strong>
              </span>
              <span>
                Max Regret:{' '}
                <strong className="font-mono text-[#91B8FF]">
                  {formatVolumeWithUnit(primaryPolicy.maxRegretM3Eq, unitMode, 2)}
                </strong>
              </span>
            </div>
          </div>

          {showSideBySide && (
            <div className="rounded-xl border border-[#57D9A7]/50 bg-[#081728] p-4 space-y-2">
              <label htmlFor="compare-policy-select" className="block font-mono text-xs text-[#57D9A7]">
                COMPARISON BENCHMARK POLICY:
              </label>
              <select
                id="compare-policy-select"
                value={comparePolicy.policyId}
                onChange={(e) => setComparePolicyId(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-mono text-[#F1F7FD]"
              >
                {dataset.policies.map((p) => (
                  <option key={p.policyId} value={p.policyId}>
                    {p.policyId} — {p.shortLabel}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center justify-between text-xs text-[#AEC4D3] pt-1">
                <span>
                  Worst Shortfall:{' '}
                  <strong className="font-mono text-[#F1F7FD]">
                    {formatVolumeWithUnit(comparePolicy.worstEtShortfallM3Eq, unitMode, 2)}
                  </strong>
                </span>
                <span>
                  Max Regret:{' '}
                  <strong className="font-mono text-[#91B8FF]">
                    {formatVolumeWithUnit(comparePolicy.maxRegretM3Eq, unitMode, 2)}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Selected-Year Switcher (Friendly on 360px-430px screens) */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 md:hidden space-y-3">
        <div className="font-mono text-xs uppercase text-[#72E4F1]">
          Mobile Year Viewer (Tap Year Y1–Y5):
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => setMobileYearFilter(yr)}
              className={`min-h-[44px] rounded-lg py-2 text-xs font-mono font-bold cursor-pointer ${
                mobileYearFilter === yr
                  ? 'bg-[#72E4F1] text-[#081521]'
                  : 'bg-[#081728] text-[#AEC4D3]'
              }`}
            >
              Y{yr}
            </button>
          ))}
        </div>
        <div className="space-y-2.5">
          {primaryPolicy.fieldYearMatrix
            .filter((c) => c.harvestYear === mobileYearFilter)
            .map((cell) => {
              const cmpCell = showSideBySide
                ? comparePolicy.fieldYearMatrix.find(
                    (c) => c.fieldId === cell.fieldId && c.harvestYear === cell.harvestYear
                  )
                : null;
              return (
                <button
                  key={`${cell.fieldId}-${cell.harvestYear}`}
                  type="button"
                  onClick={() => setSelectedCellOverride(cell)}
                  className="w-full min-h-[44px] rounded-xl border border-[#29455A] bg-[#081728] p-3.5 text-left space-y-1.5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#72E4F1]">{cell.fieldId}</span>
                    <span className="font-mono text-[11px] text-[#DCC08A]">{cell.cropCode}</span>
                  </div>
                  <div className="text-sm font-semibold text-[#F1F7FD]">{cell.cropName}</div>
                  <div className="text-xs text-[#AEC4D3]">
                    Dry-State Deficit:{' '}
                    <strong className="font-mono text-[#FFCE7B]">
                      {cell.worstStateDeficitMm === null ? 'NULL (Invalid)' : `${cell.worstStateDeficitMm} mm`}
                    </strong>
                  </div>
                  {showSideBySide && cmpCell && (
                    <div className="mt-2 pt-2 border-t border-[#29455A] text-[11px] font-mono text-[#57D9A7]">
                      vs Compare: {cmpCell.cropName} (
                      {cmpCell.worstStateDeficitMm === null
                        ? 'NULL'
                        : `${cmpCell.worstStateDeficitMm.toFixed(1)} mm`}
                      )
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      </div>

      {/* Desktop & Tablet 5-Year Interactive Matrix Table (390px Mobile Uses Compact Cards Above) */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Five-year field season schedule matrix"
        className="hidden md:block rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 overflow-x-auto space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#72E4F1]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
            Field × Year Plan Matrix ({primaryPolicy.policyId})
          </h3>
          <span className="font-mono text-xs text-[#DCC08A]">
            {isRecorded
              ? 'RECORDED M14 RESEARCH ARTIFACT (READ-ONLY · NOT A FIELD RECOMMENDATION)'
              : 'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS'}
          </span>
        </div>

        <table className="w-full min-w-[780px] text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-[#29455A] font-mono text-[#90A8BA]">
              <th className="sticky left-0 bg-[#0D2031] py-3 pe-4">Field & Irrigation</th>
              {[1, 2, 3, 4, 5].map((yr) => (
                <th key={yr} className="py-3 px-3">
                  Year {yr} (Y{yr})
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#29455A]/60">
            {(['F1', 'F2', 'F3'] as const).map((fId) => {
              const cells = primaryPolicy.fieldYearMatrix.filter((c) => c.fieldId === fId);
              const first = cells[0];
              if (!first) return null;
              return (
                <tr key={fId}>
                  <td className="sticky left-0 bg-[#0D2031] py-3.5 pe-4 align-top">
                    <div className="font-semibold text-[#F1F7FD]">{first.fieldLabel}</div>
                    <div className="mt-1 font-mono text-[10px]">
                      {first.irrigationAccess === 'NO' ? (
                        <span className="rounded bg-[#2C141B] border border-[#FF9299]/50 px-2 py-0.5 text-[#FF9299]">
                          NON-IRRIGABLE
                        </span>
                      ) : (
                        <span className="rounded bg-[#0D2B2A] border border-[#57D9A7]/50 px-2 py-0.5 text-[#57D9A7]">
                          IRRIGABLE (SHARED)
                        </span>
                      )}
                    </div>
                  </td>

                  {cells.map((cell) => {
                    const isSelected =
                      selectedCell?.fieldId === cell.fieldId &&
                      selectedCell?.harvestYear === cell.harvestYear;
                    const cmpCell = showSideBySide
                      ? comparePolicy.fieldYearMatrix.find(
                          (c) => c.fieldId === cell.fieldId && c.harvestYear === cell.harvestYear
                        )
                      : null;

                    return (
                      <td key={cell.harvestYear} className="p-2 align-top">
                        <button
                          type="button"
                          onClick={() => setSelectedCellOverride(cell)}
                          className={`w-full rounded-xl border p-3 text-left transition cursor-pointer space-y-1.5 ${
                            isSelected
                              ? 'border-[#72E4F1] bg-[#132B3F] shadow-md'
                              : !cell.calendarValid
                              ? 'border-[#FF9299]/60 bg-[#2C141B]/50'
                              : cell.passesServiceCriterionAllStates
                              ? 'border-[#29455A] bg-[#081728] hover:border-[#548299]'
                              : 'border-[#FFCE7B]/50 bg-[#252015]/50 hover:border-[#FFCE7B]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                            <span className="rounded bg-[#0D2031] px-1.5 py-0.5 text-[#72E4F1] flex items-center gap-1">
                              <Sprout className="w-3 h-3" />
                              {cell.cropCode}
                            </span>
                            {!cell.calendarValid ? (
                              <span className="text-[#FF9299] flex items-center gap-0.5">
                                <XOctagon className="w-3 h-3" /> INVALID
                              </span>
                            ) : cell.passesServiceCriterionAllStates ? (
                              <span className="text-[#57D9A7] flex items-center gap-0.5">
                                <CheckCircle2 className="w-3 h-3" /> &le;100mm
                              </span>
                            ) : (
                              <span className="text-[#FFCE7B] flex items-center gap-0.5">
                                <AlertTriangle className="w-3 h-3" /> &gt;100mm
                              </span>
                            )}
                          </div>

                          <div className="font-semibold text-xs text-[#F1F7FD]">{cell.cropName}</div>
                          <div className="font-mono text-[10px] text-[#90A8BA]">
                            {cell.plantingWindow}
                          </div>
                          <div className="font-mono text-[11px] text-[#AEC4D3]">
                            Dry Deficit:{' '}
                            <strong className="text-[#F1F7FD]">
                              {cell.worstStateDeficitMm === null
                                ? 'NULL'
                                : `${cell.worstStateDeficitMm.toFixed(1)} mm`}
                            </strong>
                          </div>

                          {showSideBySide && cmpCell && (
                            <div className="mt-2 pt-2 border-t border-[#29455A] text-[10px] font-mono text-[#57D9A7]">
                              vs Compare: {cmpCell.cropName} (
                              {cmpCell.worstStateDeficitMm === null
                                ? 'NULL'
                                : `${cmpCell.worstStateDeficitMm.toFixed(1)} mm`}
                              )
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Selected Cell Detailed Season Inspector */}
      {selectedCell && (
        <div className="rounded-2xl border border-[#72E4F1]/50 bg-[#0D2031] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
            <div>
              <span className="font-mono text-xs uppercase text-[#72E4F1]">
                SEASON CELL INSPECTOR · {selectedCell.fieldId} × {selectedCell.yearLabel}
              </span>
              <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
                {selectedCell.cropName} ({selectedCell.cropCode}) on {selectedCell.fieldLabel}
              </h3>
            </div>
            <ViewEvidenceButton evidenceId={weatherEvidenceId} siteId={id} label="View Weather & Deficit Evidence" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
              <span className="text-[#90A8BA] block">Sowing & Harvest Windows</span>
              <span className="mt-1 font-mono text-xs font-semibold text-[#F1F7FD] block">
                Plant: {selectedCell.plantingWindow}
              </span>
              <span className="font-mono text-xs text-[#AEC4D3] block">
                Harvest: {selectedCell.harvestWindow}
              </span>
            </div>

            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
              <span className="text-[#90A8BA] block">2018 Dry Analogue Deficit</span>
              <span className="mt-1 font-mono text-base font-bold text-[#FFCE7B] block">
                {selectedCell.worstStateDeficitMm === null
                  ? 'NULL (Calendar Invalid)'
                  : `${selectedCell.worstStateDeficitMm} mm`}
              </span>
              <span className="text-[11px] text-[#90A8BA]">
                vs {selectedCell.serviceThresholdMm} mm research ceiling
              </span>
            </div>
          </div>

          <details
            key={`inspector-${complexityMode}`}
            open={complexityMode === 'SCIENTIFIC'}
            data-testid="plans-technical-inspector"
            className="rounded-xl border border-[#29455A] bg-[#081728]/70 p-3.5"
          >
            <summary className="cursor-pointer font-mono text-xs font-semibold text-[#72E4F1] select-none">
              {complexityMode === 'SIMPLE'
                ? 'Show wet/median comparison & first failure witness date'
                : 'Technical Weather Analogue & Failure Witness Details'}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
                <span className="text-[#90A8BA] block">2006 Median / 2012 Wet Deficit</span>
                <span className="mt-1 font-mono text-sm font-semibold text-[#57D9A7] block">
                  Median: {selectedCell.medianStateDeficitMm ?? 'NULL'} mm
                </span>
                <span className="font-mono text-xs text-[#91B8FF] block">
                  Wet: {selectedCell.wetStateDeficitMm ?? 'NULL'} mm
                </span>
              </div>

              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
                <span className="text-[#90A8BA] block">First Failure Witness</span>
                <span className="mt-1 font-mono text-sm font-semibold text-[#F1F7FD] block">
                  {selectedCell.firstFailureDate ?? 'None (Passes Criterion)'}
                </span>
                <span className="text-[11px] text-[#AEC4D3] block">
                  {selectedCell.calendarInvalidReason ??
                    (selectedCell.firstFailureAnalogueYear
                      ? `Analogue Year ${selectedCell.firstFailureAnalogueYear}`
                      : 'Calendar Valid')}
                </span>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
