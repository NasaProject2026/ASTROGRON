'use client';

import React, { useEffect, useRef } from 'react';
import type { ReportEnvelope } from '@/domain/farmer-ux-contracts';

export function FarmerReportCharts({ report }: { report: ReportEnvelope }) {
  const waterRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);

  const hasWaterValues = report.waterBalanceChart.some((d) => d.value !== null);
  const hasSources = report.sourceReadinessChart.some((d) => (d.value ?? 0) > 0);

  useEffect(() => {
    let waterChart: ReturnType<typeof import('echarts').init> | null = null;
    let sourceChart: ReturnType<typeof import('echarts').init> | null = null;
    let cancelled = false;
    let ro: ResizeObserver | null = null;

    async function mountCharts() {
      const echarts = await import('echarts');
      if (cancelled) return;

      if (waterRef.current && hasWaterValues) {
        waterChart = echarts.init(waterRef.current);
        waterChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#071524',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          grid: { left: 52, right: 20, top: 36, bottom: 38 },
          xAxis: {
            type: 'category',
            data: report.waterBalanceChart.map((d) => d.label),
            axisLabel: { color: '#AEC4D3', fontSize: 11 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: {
            type: 'value',
            name: 'mm',
            nameTextStyle: { color: '#72E4F1', fontSize: 11 },
            axisLabel: { color: '#90A8BA', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(41,69,90,0.45)' } },
          },
          series: [
            {
              name: 'Peak F1 Water Deficit (mm)',
              type: 'bar',
              barMaxWidth: 48,
              data: report.waterBalanceChart.map((d) => ({
                value: d.value,
                itemStyle: {
                  color: (d.value ?? 0) > 100 ? '#FFCE7B' : '#72E4F1',
                  borderRadius: [6, 6, 0, 0],
                },
              })),
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#FF9299', type: 'dashed', width: 1.5 },
                label: {
                  formatter: '100 mm ceiling',
                  color: '#FF9299',
                  fontSize: 10,
                },
                data: [{ yAxis: 100 }],
              },
            },
          ],
        });
      }

      if (sourceRef.current && hasSources) {
        sourceChart = echarts.init(sourceRef.current);
        sourceChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'item',
            backgroundColor: '#071524',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          grid: { left: 115, right: 24, top: 20, bottom: 28 },
          xAxis: {
            type: 'value',
            minInterval: 1,
            name: 'layers',
            nameTextStyle: { color: '#90A8BA', fontSize: 10 },
            axisLabel: { color: '#90A8BA', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(41,69,90,0.45)' } },
          },
          yAxis: {
            type: 'category',
            data: report.sourceReadinessChart.map((d) => d.label),
            axisLabel: { color: '#AEC4D3', fontSize: 11 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          series: [
            {
              name: 'Satellite / EO Layers',
              type: 'bar',
              barMaxWidth: 24,
              data: report.sourceReadinessChart.map((d, i) => ({
                value: d.value ?? 0,
                itemStyle: {
                  color: i === 0 ? '#57D9A7' : i === 1 ? '#FFCE7B' : '#FF9299',
                  borderRadius: [0, 6, 6, 0],
                },
              })),
            },
          ],
        });
      }

      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          waterChart?.resize();
          sourceChart?.resize();
        });
        if (waterRef.current) ro.observe(waterRef.current);
        if (sourceRef.current) ro.observe(sourceRef.current);
      }
    }

    void mountCharts();

    return () => {
      cancelled = true;
      ro?.disconnect();
      waterChart?.dispose();
      sourceChart?.dispose();
    };
  }, [report, hasWaterValues, hasSources]);

  if (!hasWaterValues && !hasSources) {
    return null;
  }

  return (
    <div
      data-testid="farmer-report-charts"
      className={`grid grid-cols-1 gap-4 ${hasWaterValues && hasSources ? 'md:grid-cols-2' : ''}`}
    >
      {hasWaterValues && (
        <figure className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
          <figcaption className="space-y-0.5">
            <div className="font-display text-sm font-bold text-[#F1F7FD]">
              Dry vs. Normal vs. Wet Season Deficit (mm)
            </div>
            <p className="text-[11px] text-[#90A8BA]">
              Simulated root-zone moisture deficit across weather years relative to the 100 mm assumption.
            </p>
          </figcaption>
          <div
            ref={waterRef}
            role="img"
            aria-label="Bar chart of peak seasonal water deficit in millimeters across dry, median, and wet weather years"
            className="h-56 w-full"
          />
        </figure>
      )}

      {hasSources && (
        <figure className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
          <figcaption className="space-y-0.5">
            <div className="font-display text-sm font-bold text-[#F1F7FD]">
              Satellite &amp; Climate Source Availability
            </div>
            <p className="text-[11px] text-[#90A8BA]">
              Count of checked Earth-observation feeds classified by coverage at this location.
            </p>
          </figcaption>
          <div
            ref={sourceRef}
            role="img"
            aria-label="Horizontal bar chart summarizing available, conditional, and missing satellite sources"
            className="h-56 w-full"
          />
        </figure>
      )}
    </div>
  );
}
