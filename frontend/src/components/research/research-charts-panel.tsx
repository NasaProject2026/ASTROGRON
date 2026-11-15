'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import type { CoreResult } from '@/domain/core-contracts';

export function formatResearchCropLabel(rawCrop: string): string {
  return rawCrop
    .replace('research:NL:', '')
    .replace('sugarbeet_601', 'Sugar beet')
    .replace('potato_Fontane', 'Potato (Fontane)')
    .replace('spring_barley_301', 'Spring barley');
}

export interface ResearchChartModel {
  scenarios: string[];
  activeScenario: string;
  alternativeLabels: string[];
  leachingSeries: { name: string; values: { value: number | null; isSelectedScenario: boolean }[] }[];
  cropLabels: string[];
  cropDmSeries: { name: string; values: (number | null)[] }[];
  activeLeachingSummary: { label: string; valueKg: number | null }[];
}

/**
 * Pure projection from canonical D Pareto decision objectives into two visual comparison series.
 * Crops always remain separate categories and are never summed into marketable yield or profit.
 */
export function buildResearchChartModel(
  result: CoreResult,
  requestedScenario: string
): ResearchChartModel {
  const objectives = result.decision.objectives || [];
  const scenarios = [...new Set(objectives.flatMap((o) => o.scenarios.map((s) => s.scenario_id)))];
  const activeScenario = scenarios.includes(requestedScenario)
    ? requestedScenario
    : scenarios[0] || 'REFERENCE';

  const alternativeLabels = objectives.map((_, idx) => `Alternative ${idx + 1}`);

  const leachingSeries = objectives.map((obj, idx) => ({
    name: `Alternative ${idx + 1}`,
    values: scenarios.map((sc) => {
      const match = obj.scenarios.find((s) => s.scenario_id === sc);
      return {
        value: typeof match?.N_leaching_kg_N_field === 'number' ? Number(match.N_leaching_kg_N_field.toFixed(2)) : null,
        isSelectedScenario: sc === activeScenario,
      };
    }),
  }));

  const cropKeys = [
    ...new Set(
      objectives.flatMap((obj) => {
        const match = obj.scenarios.find((s) => s.scenario_id === activeScenario);
        return match ? Object.keys(match.crop_storage_DM_kg_field_by_crop) : [];
      })
    ),
  ];

  const cropLabels = cropKeys.map(formatResearchCropLabel);

  const cropDmSeries = objectives.map((obj, idx) => {
    const match = obj.scenarios.find((s) => s.scenario_id === activeScenario);
    return {
      name: `Alternative ${idx + 1}`,
      values: cropKeys.map((cropKey) => {
        const val = match?.crop_storage_DM_kg_field_by_crop?.[cropKey];
        return typeof val === 'number' ? Number(val.toFixed(2)) : null;
      }),
    };
  });

  const activeLeachingSummary = objectives.map((obj, idx) => {
    const match = obj.scenarios.find((s) => s.scenario_id === activeScenario);
    return {
      label: `Alt ${idx + 1}`,
      valueKg:
        typeof match?.N_leaching_kg_N_field === 'number'
          ? Number(match.N_leaching_kg_N_field.toFixed(2))
          : null,
    };
  });

  return {
    scenarios,
    activeScenario,
    alternativeLabels,
    leachingSeries,
    cropLabels,
    cropDmSeries,
    activeLeachingSummary,
  };
}

const SERIES_PALETTE = ['#72E4F1', '#57D9A7', '#FFCE7B', '#91B8FF'] as const;

export function ResearchChartsPanel({
  result,
  scenario,
}: {
  result: CoreResult;
  scenario: string;
}) {
  const leachingRef = useRef<HTMLDivElement | null>(null);
  const cropDmRef = useRef<HTMLDivElement | null>(null);

  const model = useMemo(() => buildResearchChartModel(result, scenario), [result, scenario]);
  const hasLeachingData = model.leachingSeries.some((s) =>
    s.values.some((pt) => pt.value !== null)
  );
  const hasCropDmData = model.cropDmSeries.some((s) => s.values.some((v) => v !== null));

  useEffect(() => {
    if (!hasLeachingData && !hasCropDmData) return;
    let leachingChart: ReturnType<typeof import('echarts').init> | null = null;
    let cropDmChart: ReturnType<typeof import('echarts').init> | null = null;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    async function mount() {
      const echarts = await import('echarts');
      if (cancelled) return;

      if (leachingRef.current && hasLeachingData) {
        const narrow = leachingRef.current.clientWidth < 480;
        leachingChart = echarts.init(leachingRef.current);
        leachingChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: '#071524',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          legend: {
            data: model.alternativeLabels,
            textStyle: { color: '#AEC4D3', fontSize: 11 },
            top: 0,
          },
          grid: { left: narrow ? 46 : 56, right: 16, top: 38, bottom: narrow ? 48 : 36 },
          xAxis: {
            type: 'category',
            data: model.scenarios.map((sc) =>
              sc === model.activeScenario ? `${sc} *` : sc.replaceAll('_', '\n')
            ),
            axisLabel: {
              color: '#AEC4D3',
              fontSize: narrow ? 9 : 10,
              interval: 0,
            },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: {
            type: 'value',
            name: 'kg N/field',
            nameTextStyle: { color: '#72E4F1', fontSize: 10 },
            axisLabel: { color: '#90A8BA', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(41,69,90,0.45)' } },
          },
          series: model.leachingSeries.map((ser, sIdx) => ({
            name: ser.name,
            type: 'bar',
            barMaxWidth: 32,
            data: ser.values.map((pt) => ({
              value: pt.value,
              itemStyle: {
                color: SERIES_PALETTE[sIdx % SERIES_PALETTE.length],
                opacity: pt.isSelectedScenario ? 1 : 0.45,
                borderColor: pt.isSelectedScenario ? '#F1F7FD' : 'transparent',
                borderWidth: pt.isSelectedScenario ? 1.5 : 0,
                borderRadius: [5, 5, 0, 0],
              },
            })),
          })),
        });
      }

      if (cropDmRef.current && hasCropDmData) {
        const narrow = cropDmRef.current.clientWidth < 480;
        cropDmChart = echarts.init(cropDmRef.current);
        cropDmChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: '#071524',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          legend: {
            data: model.alternativeLabels,
            textStyle: { color: '#AEC4D3', fontSize: 11 },
            top: 0,
          },
          grid: { left: narrow ? 54 : 64, right: 16, top: 38, bottom: 38 },
          xAxis: {
            type: 'category',
            data: model.cropLabels,
            axisLabel: { color: '#AEC4D3', fontSize: narrow ? 10 : 11, interval: 0 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: {
            type: 'value',
            name: 'kg DM/field',
            nameTextStyle: { color: '#57D9A7', fontSize: 10 },
            axisLabel: {
              color: '#90A8BA',
              fontSize: 10,
              formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`),
            },
            splitLine: { lineStyle: { color: 'rgba(41,69,90,0.45)' } },
          },
          series: model.cropDmSeries.map((ser, sIdx) => ({
            name: ser.name,
            type: 'bar',
            barMaxWidth: 34,
            itemStyle: {
              color: SERIES_PALETTE[sIdx % SERIES_PALETTE.length],
              borderRadius: [5, 5, 0, 0],
            },
            data: ser.values,
          })),
        });
      }

      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          leachingChart?.resize();
          cropDmChart?.resize();
        });
        if (leachingRef.current) ro.observe(leachingRef.current);
        if (cropDmRef.current) ro.observe(cropDmRef.current);
      }
    }

    void mount();

    return () => {
      cancelled = true;
      ro?.disconnect();
      leachingChart?.dispose();
      cropDmChart?.dispose();
    };
  }, [model, hasLeachingData, hasCropDmData]);

  const horizonText =
    result.decision.horizon_boundary && result.decision.horizon_boundary.length === 2
      ? `${result.decision.horizon_boundary[0]?.slice(0, 4)}–${result.decision.horizon_boundary[1]?.slice(0, 4)}`
      : '5-year horizon';

  return (
    <div className="space-y-4" data-testid="research-dashboard-visuals">
      {/* Compact Dashboard KPI Summary Strip */}
      <div
        data-testid="research-dashboard-kpis"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 text-xs"
      >
        <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-3.5 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] block">
            Scientific Outcome
          </span>
          <strong className="mt-1 block font-mono text-sm text-[#57D9A7] break-words">
            {result.status}
          </strong>
          <span className="mt-0.5 block text-[11px] text-[#AEC4D3]">
            {horizonText} · Read-only replay
          </span>
        </div>

        <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-3.5 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] block">
            Pareto Frontier
          </span>
          <strong className="mt-1 block font-mono text-sm text-[#FFCE7B]">
            {result.decision.pareto_ids.length} alternatives · 0 selected
          </strong>
          <span className="mt-0.5 block text-[11px] text-[#AEC4D3]">
            No single economic winner
          </span>
        </div>

        <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-3.5 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] block">
            Active Scenario
          </span>
          <strong className="mt-1 block font-mono text-sm text-[#72E4F1] break-words">
            {model.activeScenario}
          </strong>
          <span className="mt-0.5 block text-[11px] text-[#AEC4D3]">
            {model.scenarios.length} sensitivity cases tested
          </span>
        </div>

        <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-3.5 min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#90A8BA] block">
            N Leaching ({model.activeScenario})
          </span>
          <strong className="mt-1 block font-mono text-sm text-[#F1F7FD]">
            {model.activeLeachingSummary.length > 0
              ? model.activeLeachingSummary
                  .map((s) => `${s.label}: ${s.valueKg !== null ? `${s.valueKg} kg` : 'N/A'}`)
                  .join(' · ')
              : 'N/A'}
          </strong>
          <span className="mt-0.5 block text-[11px] text-[#AEC4D3]">
            Marketable yield &amp; profit unavailable
          </span>
        </div>
      </div>

      {/* ECharts Scientific Trade-off Comparison */}
      {(hasLeachingData || hasCropDmData) && (
        <div
          data-testid="research-charts-grid"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          {hasLeachingData && (
            <figure
              data-testid="research-n-leaching-chart"
              className="min-w-0 overflow-hidden rounded-xl border border-[#29455A] bg-[#07111F] p-4 space-y-2"
            >
              <figcaption className="space-y-0.5">
                <div className="font-display text-sm font-bold text-[#F1F7FD]">
                  5-Year Nitrogen Leaching Across Scenarios (kg N / field)
                </div>
                <p className="text-[11px] text-[#AEC4D3]">
                  Highlighted bars (*) show the active <code className="text-[#72E4F1]">{model.activeScenario}</code> scenario alongside paired sensitivity cases.
                </p>
              </figcaption>
              <div
                ref={leachingRef}
                role="img"
                aria-label="Bar chart comparing five-year nitrogen leaching in kg N per field between Pareto Alternative 1 and Alternative 2 across scenarios"
                className="h-64 sm:h-72 w-full"
              />
            </figure>
          )}

          {hasCropDmData && (
            <figure
              data-testid="research-crop-dm-chart"
              className="min-w-0 overflow-hidden rounded-xl border border-[#29455A] bg-[#07111F] p-4 space-y-2"
            >
              <figcaption className="space-y-0.5">
                <div className="font-display text-sm font-bold text-[#F1F7FD]">
                  Crop Storage Dry Matter by Cultivar — {model.activeScenario} (kg DM / field)
                </div>
                <p className="text-[11px] text-[#AEC4D3]">
                  Cultivars remain strictly separate (never summed across crops; not marketable yield or profit).
                </p>
              </figcaption>
              <div
                ref={cropDmRef}
                role="img"
                aria-label={`Bar chart comparing crop storage dry matter by cultivar in kg DM per field under ${model.activeScenario}`}
                className="h-64 sm:h-72 w-full"
              />
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
