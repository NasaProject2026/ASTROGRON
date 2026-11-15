'use client';

import React, { useEffect, useRef } from 'react';
import type { DailyClimateSeriesPoint } from '@/domain/contracts';

export function ClimateEChartsPanel({
  series,
  analogueYear,
  isRecorded = false,
}: {
  series: DailyClimateSeriesPoint[];
  analogueYear: 2018 | 2006 | 2012;
  isRecorded?: boolean;
}) {
  const etDeficitChartRef = useRef<HTMLDivElement | null>(null);
  const metTempPrecipChartRef = useRef<HTMLDivElement | null>(null);
  const hasModeledEtTrace = series.some(
    (p) => p.et0Mm !== null || p.etcMm !== null || p.rootZoneDeficitMm !== null
  );

  useEffect(() => {
    let etChart: any = null;
    let metChart: any = null;
    let cancelled = false;

    async function renderCharts() {
      const echarts = await import('echarts');
      if (cancelled) return;

      const dates = series.map((pt) => pt.date);

      if (etDeficitChartRef.current && hasModeledEtTrace) {
        const isNarrow = etDeficitChartRef.current.clientWidth < 560;
        etChart = echarts.init(etDeficitChartRef.current);
        etChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#081728',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          legend: {
            type: 'scroll',
            pageIconColor: '#72E4F1',
            pageIconInactiveColor: '#548299',
            pageTextStyle: { color: '#AEC4D3' },
            data: [
              'Reference ET0 (mm/day)',
              'Crop ETc (mm/day)',
              'Actual ETa (mm/day)',
              'F1 Root-Zone Deficit (mm)',
              'Assumed 100 mm Service Ceiling',
            ],
            textStyle: { color: '#AEC4D3', fontSize: isNarrow ? 10 : 11 },
            top: 0,
          },
          grid: {
            left: isNarrow ? 44 : 58,
            right: isNarrow ? 44 : 68,
            top: isNarrow ? 50 : 72,
            bottom: 38,
          },
          xAxis: {
            type: 'category',
            data: dates,
            axisLabel: { color: '#90A8BA', fontSize: 10 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: [
            {
              type: 'value',
              name: isNarrow ? 'ET' : 'ET (mm/day)',
              nameTextStyle: { color: '#72E4F1', fontSize: isNarrow ? 10 : 11 },
              axisLabel: {
                color: '#90A8BA',
                fontSize: isNarrow ? 10 : 11,
                formatter: isNarrow ? '{value}' : '{value} mm/d',
              },
              splitLine: { lineStyle: { color: '#17374A' } },
            },
            {
              type: 'value',
              name: isNarrow ? 'Deficit' : 'Cumulative Deficit (mm)',
              max: 190,
              nameTextStyle: { color: '#FFCE7B', fontSize: isNarrow ? 10 : 11 },
              axisLabel: {
                color: '#FFCE7B',
                fontSize: isNarrow ? 10 : 11,
                formatter: isNarrow ? '{value}' : '{value} mm',
              },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: 'Reference ET0 (mm/day)',
              type: 'line',
              connectNulls: false,
              data: series.map((p) => p.et0Mm),
              itemStyle: { color: '#91B8FF' },
              lineStyle: { width: 2 },
            },
            {
              name: 'Crop ETc (mm/day)',
              type: 'line',
              connectNulls: false,
              data: series.map((p) => p.etcMm),
              itemStyle: { color: '#72E4F1' },
              lineStyle: { width: 2 },
            },
            {
              name: 'Actual ETa (mm/day)',
              type: 'line',
              connectNulls: false,
              data: series.map((p) => p.etaMm),
              itemStyle: { color: '#57D9A7' },
              lineStyle: { width: 2 },
            },
            {
              name: 'F1 Root-Zone Deficit (mm)',
              type: 'line',
              yAxisIndex: 1,
              connectNulls: false,
              data: series.map((p) => p.rootZoneDeficitMm),
              itemStyle: { color: '#FFCE7B' },
              lineStyle: { width: 2.5, type: 'solid' },
              areaStyle: { color: 'rgba(255, 206, 123, 0.12)' },
            },
            {
              name: 'Assumed 100 mm Service Ceiling',
              type: 'line',
              yAxisIndex: 1,
              data: series.map(() => 100.0),
              itemStyle: { color: '#FF9299' },
              lineStyle: { width: 1.5, type: 'dashed' },
              symbol: 'none',
            },
          ],
        });
      }

      if (metTempPrecipChartRef.current) {
        const isNarrow = metTempPrecipChartRef.current.clientWidth < 560;
        metChart = echarts.init(metTempPrecipChartRef.current);
        metChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#081728',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          legend: {
            type: 'scroll',
            pageIconColor: '#72E4F1',
            pageIconInactiveColor: '#548299',
            pageTextStyle: { color: '#AEC4D3' },
            data: [
              'Precipitation PRECTOTCORR (mm/day)',
              'Delivered Irrigation F2–F4 (mm/day)',
              'Max Temp T2M_MAX (°C)',
              'Min Temp T2M_MIN (°C)',
            ],
            textStyle: { color: '#AEC4D3', fontSize: isNarrow ? 10 : 11 },
            top: 0,
          },
          grid: {
            left: isNarrow ? 44 : 58,
            right: isNarrow ? 44 : 68,
            top: isNarrow ? 50 : 72,
            bottom: 38,
          },
          xAxis: {
            type: 'category',
            data: dates,
            axisLabel: { color: '#90A8BA', fontSize: 10 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: [
            {
              type: 'value',
              name: isNarrow ? 'Flux' : 'Water Flux (mm/day)',
              nameTextStyle: { color: '#72E4F1', fontSize: isNarrow ? 10 : 11 },
              axisLabel: {
                color: '#90A8BA',
                fontSize: isNarrow ? 10 : 11,
                formatter: isNarrow ? '{value}' : '{value} mm',
              },
              splitLine: { lineStyle: { color: '#17374A' } },
            },
            {
              type: 'value',
              name: isNarrow ? 'Temp' : 'Temperature (°C)',
              nameTextStyle: { color: '#DCC08A', fontSize: isNarrow ? 10 : 11 },
              axisLabel: {
                color: '#DCC08A',
                fontSize: isNarrow ? 10 : 11,
                formatter: isNarrow ? '{value}°' : '{value} °C',
              },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: 'Precipitation PRECTOTCORR (mm/day)',
              type: 'bar',
              data: series.map((p) => p.precipMm),
              itemStyle: { color: '#72E4F1', borderRadius: [3, 3, 0, 0] },
            },
            {
              name: 'Delivered Irrigation F2–F4 (mm/day)',
              type: 'bar',
              data: series.map((p) => p.deliveredIrrigationMm),
              itemStyle: { color: '#57D9A7', borderRadius: [3, 3, 0, 0] },
            },
            {
              name: 'Max Temp T2M_MAX (°C)',
              type: 'line',
              yAxisIndex: 1,
              connectNulls: false,
              data: series.map((p) => p.t2mMaxC),
              itemStyle: { color: '#FF9299' },
            },
            {
              name: 'Min Temp T2M_MIN (°C)',
              type: 'line',
              yAxisIndex: 1,
              connectNulls: false,
              data: series.map((p) => p.t2mMinC),
              itemStyle: { color: '#91B8FF' },
            },
          ],
        });
      }
    }

    renderCharts();

    const handleResize = () => {
      etChart?.resize();
      metChart?.resize();
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    if (resizeObserver) {
      if (etDeficitChartRef.current) resizeObserver.observe(etDeficitChartRef.current);
      if (metTempPrecipChartRef.current) resizeObserver.observe(metTempPrecipChartRef.current);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      etChart?.dispose();
      metChart?.dispose();
    };
  }, [series, analogueYear, hasModeledEtTrace]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#29455A] bg-[#081728] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#AEC4D3]">
          <span className="break-words">
            PLOT 01 · ET0 / ETc / ETa (mm/day) &amp; Non-Irrigable Field F1 Root-Zone Deficit (mm) —{' '}
            {isRecorded ? `Recorded POWER ${analogueYear}` : `Synthetic ${analogueYear}`} Analogue
          </span>
          <span className="text-[#DCC08A]">Nulls rendered as gaps, never fake zeros</span>
        </div>
        {hasModeledEtTrace ? (
          <div
            ref={etDeficitChartRef}
            className="h-[320px] w-full"
            role="img"
            aria-label={`Evapotranspiration and root-zone deficit plot for analogue year ${analogueYear}`}
          />
        ) : (
          <div
            data-testid="climate-unmodeled-et-notice"
            className="rounded-xl border border-dashed border-[#FFCE7B]/40 bg-[#252015]/40 p-6 text-xs text-[#FFCE7B] space-y-1.5"
          >
            <div className="font-mono font-semibold uppercase">
              Daily ET0 / ETc / Root-Zone Deficit Trace Unavailable in Read-Only Archive ({analogueYear})
            </div>
            <p className="text-[#AEC4D3] leading-relaxed">
              The verified M14 corpus preserves harvest-year peak field deficits and observed NASA POWER daily
              precipitation &amp; temperature (<code>POWER_2006_2025.json</code>) without storing intermediate
              daily ET0/deficit series. All unbundled daily ET fields remain explicit <code>null</code> (never interpolated or zero-filled).
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#29455A] bg-[#081728] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#AEC4D3]">
          <span className="break-words">
            PLOT 02 · Precipitation (PRECTOTCORR), Delivered Irrigation (mm/day) &amp; Temperature Range (°C) —{' '}
            {isRecorded ? `Recorded ${analogueYear} Archive` : `Analogue ${analogueYear}`}
          </span>
          <span className="text-[#91B8FF]">Source: NASA POWER (M4 / POWER_2006_2025)</span>
        </div>
        <div
          ref={metTempPrecipChartRef}
          className="h-[300px] w-full"
          role="img"
          aria-label={`Precipitation, delivered irrigation, and temperature range plot for analogue year ${analogueYear}`}
        />
      </div>
    </div>
  );
}
