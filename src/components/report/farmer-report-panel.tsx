'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileDown,
  History,
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import type { UserFarmDraft } from '@/domain/contracts';
import type { ReportEnvelope } from '@/domain/farmer-ux-contracts';
import { buildReportEnvelopeFromEvaluation } from '@/adapters/storage-adapters';
import { buildReportPdfBytes } from '@/lib/pdf-report';
import { useSystemCapabilities } from '@/lib/capabilities-client';
import { useAstragron, formatAreaWithUnit } from '@/hooks/use-astragron-store';
import { FarmerReportCharts } from './farmer-report-charts';
import { AskAstragronPanel } from '@/components/chat/ask-astragron-panel';

interface FarmerReportPanelProps {
  farm: UserFarmDraft;
  requestedReportId?: string | null;
}

export function FarmerReportPanel({
  farm,
  requestedReportId = null,
}: FarmerReportPanelProps) {
  const {
    repository,
    datasetMode,
    unitMode,
    getReportsForFarm,
    recordReportSnapshot,
    isReportStale,
  } = useAstragron();
  const { capabilities } = useSystemCapabilities();

  const savedHistory = getReportsForFarm(farm.id);

  // Live deterministic snapshot representing current saved farm state & active datasetMode
  const liveEnvelope = useMemo(
    () =>
      buildReportEnvelopeFromEvaluation({
        farm,
        repository,
        datasetMode,
        jobId: 'live-preview',
      }),
    [farm, repository, datasetMode]
  );

  const [selectedReportId, setSelectedReportId] = useState<string>(
    requestedReportId ?? savedHistory[0]?.reportId ?? 'LIVE'
  );
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    if (requestedReportId) {
      setSelectedReportId(requestedReportId);
    } else if (savedHistory.length > 0 && selectedReportId === 'LIVE') {
      setSelectedReportId(savedHistory[0]!.reportId);
    }
  }, [requestedReportId, savedHistory, selectedReportId]);

  const activeReport: ReportEnvelope = useMemo(() => {
    if (selectedReportId !== 'LIVE') {
      const match = savedHistory.find((r) => r.reportId === selectedReportId);
      if (match) return match;
    }
    return savedHistory[0] ?? liveEnvelope;
  }, [selectedReportId, savedHistory, liveEnvelope]);

  const activeIsSaved = savedHistory.some((r) => r.reportId === activeReport.reportId);
  const activeIsStale = activeIsSaved ? isReportStale(activeReport) : false;

  const handleSaveSnapshot = () => {
    const snap = buildReportEnvelopeFromEvaluation({
      farm,
      repository,
      datasetMode,
      jobId: `snap-${Date.now().toString(36)}`,
    });
    recordReportSnapshot(snap);
    setSelectedReportId(snap.reportId);
    setPdfNotice(`Saved report snapshot (${snap.reportId.slice(0, 14)}…) to this device.`);
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    setPdfNotice(null);
    try {
      const bytes = buildReportPdfBytes(activeReport, unitMode);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `astragron-report-${farm.id}-${activeReport.inputRevision.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPdfNotice(`Downloaded PDF report (${(bytes.byteLength / 1024).toFixed(1)} KB).`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const statusTone =
    activeReport.dataAvailabilityClass === 'VERIFIED_RECORDED_CORPUS'
      ? {
          border: 'border-[#57D9A7]/50',
          bg: 'bg-[#0D2B22]',
          badgeText: 'text-[#7AE6B0]',
          badgeLabel: 'Verified Recorded Research Archive',
        }
      : activeReport.dataAvailabilityClass === 'SYNTHETIC_DEMO_CORPUS'
        ? {
            border: 'border-[#DCC08A]/50',
            bg: 'bg-[#252015]',
            badgeText: 'text-[#DCC08A]',
            badgeLabel: 'Synthetic Research Demonstration',
          }
        : {
            border: 'border-[#FFCE7B]/50',
            bg: 'bg-[#2A1F12]',
            badgeText: 'text-[#FFCE7B]',
            badgeLabel: 'Limited Evidence · No Crop Recommendation',
          };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
      {/* Main Report Summary Column */}
      <div className="lg:col-span-7 space-y-5">
        {/* Stale Report Banner when farm inputs edited since this report snapshot */}
        {activeIsStale && (
          <div
            role="status"
            data-testid="stale-report-warning"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FFCE7B]/60 bg-[#252015] p-4 text-xs"
          >
            <div className="flex items-start gap-2.5 text-[#FFCE7B]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[#F1F7FD]">
                  Previous analysis: inputs have changed
                </div>
                <p className="text-[#AEC4D3]">
                  Your saved farm boundaries or field details changed after this report was created ({new Date(activeReport.createdAt).toLocaleString()}).
                </p>
              </div>
            </div>
            <Link
              href={`/farm/${farm.id}/analysis?autostart=1`}
              prefetch={false}
              className="shrink-0 rounded-xl bg-[#72E4F1] px-3.5 py-2 font-semibold text-[#061320] hover:bg-[#93EDF7]"
            >
              Re-check latest inputs
            </Link>
          </div>
        )}

        {/* First-Fold Plain-English Report Card */}
        <section
          data-testid="farmer-report-hero"
          className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border ${statusTone.border} ${statusTone.bg} px-3 py-1 font-mono text-[11px] ${statusTone.badgeText}`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>{statusTone.badgeLabel}</span>
              </span>
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F1F7FD]">
                {activeReport.headlineStatus}
              </h2>
              <p className="text-xs sm:text-sm text-[#AEC4D3] leading-relaxed">
                {activeReport.recommendationNotice}
              </p>
            </div>
          </div>

          {/* 3-stat plain farm strip */}
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
              <span className="text-[11px] text-[#90A8BA] block">Fields</span>
              <span className="font-mono font-bold text-[#F1F7FD]">{activeReport.fieldCount}</span>
            </div>
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
              <span className="text-[11px] text-[#90A8BA] block">Total Size</span>
              <span className="font-mono font-bold text-[#72E4F1]">
                {formatAreaWithUnit(activeReport.totalAreaHa, unitMode)}
              </span>
            </div>
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
              <span className="text-[11px] text-[#90A8BA] block">Snapshot Rev</span>
              <span className="font-mono text-[#AEC4D3]">{activeReport.inputRevision.slice(0, 12)}</span>
            </div>
          </div>

          {/* 2-3 Key Findings */}
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
            <div className="font-mono text-[11px] uppercase tracking-wider text-[#72E4F1]">
              Key Findings
            </div>
            <ul className="space-y-1.5 text-xs sm:text-sm text-[#F1F7FD]">
              {activeReport.summaryFindings.map((finding, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#72E4F1] shrink-0 mt-0.5" />
                  <span>{finding}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Primary PDF Action + Snapshot Action */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              data-testid="download-pdf-btn"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-[#72E4F1] px-6 py-2.5 text-sm font-semibold text-[#061320] hover:bg-[#93EDF7] disabled:opacity-60 cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
              <span>{downloadingPdf ? 'Preparing PDF…' : 'Download PDF Report'}</span>
            </button>

            <button
              type="button"
              data-testid="save-report-snapshot-btn"
              onClick={handleSaveSnapshot}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#548299] bg-[#081728] px-4 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-[#57D9A7]" />
              <span>Save snapshot to history</span>
            </button>
          </div>

          {pdfNotice && (
            <div role="status" className="text-xs font-mono text-[#57D9A7]">
              {pdfNotice}
            </div>
          )}
        </section>

        {/* Report History Switcher (Appears once 1+ saved snapshots exist) */}
        {savedHistory.length > 0 && (
          <section
            data-testid="report-history-bar"
            className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-[#F1F7FD]">
                <History className="w-4 h-4 text-[#72E4F1]" />
                <span>Saved Report History ({savedHistory.length})</span>
              </span>
              <span className="text-[11px] text-[#90A8BA]">Immutable per input version</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {savedHistory.map((snap, idx) => {
                const isSelected = activeReport.reportId === snap.reportId;
                const stale = isReportStale(snap);
                return (
                  <button
                    key={snap.reportId}
                    type="button"
                    onClick={() => setSelectedReportId(snap.reportId)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                      isSelected
                        ? 'border-[#72E4F1] bg-[#132B3F] text-[#F1F7FD]'
                        : 'border-[#29455A] bg-[#0D2031] text-[#AEC4D3] hover:border-[#548299]'
                    }`}
                  >
                    <div className="font-semibold">
                      {idx === 0 ? 'Latest Snapshot' : `Snapshot #${savedHistory.length - idx}`}
                    </div>
                    <div className="font-mono text-[10px] text-[#90A8BA]">
                      {new Date(snap.createdAt).toLocaleString()} · rev {snap.inputRevision.slice(0, 6)}
                      {stale ? ' · older inputs' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Maximum 2 Crisp Data Visualizations (Never Fabricates Zeros for Missing Data) */}
        <FarmerReportCharts report={activeReport} />

        {/* Plain-Language Breakdown: Know / Missing / Next */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
          <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 space-y-2">
            <h3 className="font-display text-sm font-bold text-[#57D9A7]">What we know</h3>
            <ul className="list-disc ps-4 space-y-1.5 text-[#AEC4D3] leading-relaxed">
              {activeReport.whatWeKnow.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 space-y-2">
            <h3 className="font-display text-sm font-bold text-[#FFCE7B]">What is missing</h3>
            <ul className="list-disc ps-4 space-y-1.5 text-[#AEC4D3] leading-relaxed">
              {activeReport.whatWeDontKnow.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-4 space-y-2">
            <h3 className="font-display text-sm font-bold text-[#72E4F1]">Next practical steps</h3>
            <ul className="list-disc ps-4 space-y-1.5 text-[#AEC4D3] leading-relaxed">
              {activeReport.whatHappensNext.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Prominent Contextual Ask ASTRAGRON Column */}
      <div className="lg:col-span-5 space-y-4">
        <AskAstragronPanel
          farm={farm}
          report={activeReport}
          capabilities={capabilities}
          isStale={activeIsStale}
        />

        <div className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 text-xs text-[#90A8BA] space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-[#F1F7FD]">
            <HelpCircle className="w-4 h-4 text-[#72E4F1]" />
            <span>About this report</span>
          </div>
          <p className="leading-relaxed">
            Every number, limitation, and satellite layer in your PDF matches what appears here.{' '}
            <Link href="/help" prefetch={false} className="text-[#72E4F1] underline">
              Read plain-language glossary
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
