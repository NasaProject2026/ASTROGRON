'use client';

import React, { useState, use } from 'react';
import { CloudRain, AlertTriangle, Table2 } from 'lucide-react';
import {
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { ClimateEChartsPanel } from '@/components/charts/climate-echarts';
import { useAstragron } from '@/hooks/use-astragron-store';
import { useMessages } from '@/lib/i18n';

export default function FarmClimateWaterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { getFarmDraft, repository, datasetMode } = useAstragron();
  const m = useMessages();
  const [selectedAnalogue, setSelectedAnalogue] = useState<'2018' | '2006' | '2012'>('2018');
  const [showCompanionTable, setShowCompanionTable] = useState<boolean>(true);

  const draft = getFarmDraft(id);
  const climateEnv = repository.getClimateWaterSeries(id, draft);

  if (!draft || !climateEnv.data) {
    return (
      <FailClosedStatusCard
        status={climateEnv.status}
        statusReason={climateEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Climate & Water Series"
      />
    );
  }

  const climateData = climateEnv.data;
  const series = climateData.seriesByAnalogue[selectedAnalogue];
  const activeSummary =
    climateData.analogueSummaries.find((a) => String(a.analogueYear) === selectedAnalogue) ??
    climateData.analogueSummaries[0]!;

  return (
    <div className="space-y-6">
      {/* Header & Historical Analogue Notice */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#29455A] pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[#91B8FF]">
              CLIMATE & WATER-BALANCE ANALYTICS · {climateData.datasetMode}
            </span>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD]">
              Historical Weather Analogues &amp; Evapotranspiration Dynamics
              {climateData.locationLabel ? ` (${climateData.locationLabel})` : ''}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
              {climateData.analogueYearsNote}
            </p>
          </div>
          <ViewEvidenceButton
            evidenceId={activeSummary.evidenceId}
            label={`View ${selectedAnalogue} Provenance`}
          />
        </div>

        {/* Analogue Year Selector */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {climateData.analogueSummaries.map((item) => {
            const isSelected = String(item.analogueYear) === selectedAnalogue;
            return (
              <button
                key={item.analogueYear}
                type="button"
                onClick={() => setSelectedAnalogue(String(item.analogueYear) as '2018' | '2006' | '2012')}
                aria-pressed={isSelected}
                className={`rounded-xl border p-4 text-left transition cursor-pointer space-y-2 ${
                  isSelected
                    ? 'border-[#72E4F1] bg-[#132B3F] shadow-md'
                    : 'border-[#29455A] bg-[#081728] hover:border-[#548299]'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-[#72E4F1]">{item.classification}</span>
                  <span className="text-[#DCC08A]">Analogue Year {item.analogueYear}</span>
                </div>
                <div className="font-semibold text-sm text-[#F1F7FD]">{item.label}</div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-mono text-[#AEC4D3]">
                  <div>Rain: {item.seasonalPrecipMm} mm</div>
                  <div>
                    ET0: {item.seasonalEt0Mm === null ? 'N/A (Unmodeled)' : `${item.seasonalEt0Mm} mm`}
                  </div>
                  <div className="col-span-2 text-[#FFCE7B]">
                    Peak F1 Deficit: {item.peakF1DeficitMm} mm
                    {item.firstThresholdBreachDate
                      ? ` (Breach: ${item.firstThresholdBreachDate})`
                      : ' (≤ 100 mm)'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/60 p-3.5 text-xs text-[#FFCE7B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>Non-Forecast Rule:</strong> Analogue years 2018 (dry), 2006 (median), and 2012 (wet)
            are historical stress-test benchmarks in this{' '}
            {climateData.datasetMode === 'RECORDED_M14_RESEARCH'
              ? 'recorded M14 / NASA POWER archive'
              : 'synthetic UI fixture'}
            , NOT forecasts or probabilistic confidence intervals for 2027–2031.{' '}
            {climateData.datasetMode === 'RECORDED_M14_RESEARCH' ? m.recordedUi.noModeledEtNote : ''}
          </span>
        </div>
      </div>

      {/* ECharts Plots */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CloudRain className="w-4 h-4 text-[#72E4F1]" />
            <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
              Interactive ECharts Series ({activeSummary.label})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowCompanionTable((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#29455A] bg-[#081728] px-3 py-1.5 text-xs font-mono text-[#91B8FF] cursor-pointer"
          >
            <Table2 className="w-3.5 h-3.5" />
            <span>{showCompanionTable ? 'Hide Companion Table' : 'Show Accessible Companion Table'}</span>
          </button>
        </div>

        <ClimateEChartsPanel
          series={series}
          analogueYear={Number(selectedAnalogue) as 2018 | 2006 | 2012}
          isRecorded={climateData.datasetMode === 'RECORDED_M14_RESEARCH'}
        />
      </div>

      {/* Accessible Screen-Reader & Exportable Companion HTML Data Table */}
      {showCompanionTable && (
        <div
        tabIndex={0}
        role="region"
        aria-label="Annual historical climate analogue summary table"
        className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 overflow-x-auto space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#72E4F1]"
      >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-[#F1F7FD]">
              Accessible Companion Data Table — {selectedAnalogue} Series (Explicit Units & Null Preservation)
            </h3>
            <span className="font-mono text-xs text-[#90A8BA]">
              Window: {climateData.timeWindowLabel}
            </span>
          </div>

          <table className="w-full min-w-[760px] text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-[#29455A] text-[#90A8BA]">
                <th className="py-2.5 pe-3">Date (UTC)</th>
                <th className="py-2.5 px-3">Precip (mm/d)</th>
                <th className="py-2.5 px-3">T2M Min/Max (°C)</th>
                <th className="py-2.5 px-3">ET0 (mm/d)</th>
                <th className="py-2.5 px-3">ETc (mm/d)</th>
                <th className="py-2.5 px-3">ETa (mm/d)</th>
                <th className="py-2.5 px-3">F1 Deficit (mm)</th>
                <th className="py-2.5 ps-3">F3 Irrig (mm/d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#29455A]/60">
              {series.map((pt) => {
                const isNullRow = pt.et0Mm === null || pt.rootZoneDeficitMm === null;
                return (
                  <tr
                    key={pt.date}
                    className={
                      isNullRow
                        ? 'bg-[#252015]/50 text-[#FFCE7B]'
                        : 'hover:bg-[#132B3F]/60 text-[#F1F7FD]'
                    }
                  >
                    <td className="py-2 pe-3">{pt.date}</td>
                    <td className="py-2 px-3">
                      {pt.precipMm === null ? 'NULL (Gap)' : pt.precipMm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      {pt.t2mMinC?.toFixed(1)} / {pt.t2mMaxC?.toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      {pt.et0Mm === null ? 'NULL (Gap)' : pt.et0Mm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      {pt.etcMm === null ? 'NULL (Gap)' : pt.etcMm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3">
                      {pt.etaMm === null ? 'NULL (Gap)' : pt.etaMm.toFixed(1)}
                    </td>
                    <td className="py-2 px-3 font-semibold">
                      {pt.rootZoneDeficitMm === null
                        ? 'NULL (Gap)'
                        : `${pt.rootZoneDeficitMm.toFixed(2)} mm`}
                    </td>
                    <td className="py-2 ps-3">
                      {pt.deliveredIrrigationMm === null
                        ? 'NULL'
                        : pt.deliveredIrrigationMm.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
