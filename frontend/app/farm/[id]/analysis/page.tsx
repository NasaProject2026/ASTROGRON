'use client';

import React, { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Satellite,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Ban,
  RefreshCw,
  FileDown,
} from 'lucide-react';
import { FailClosedStatusCard } from '@/components/design-system/primitives';
import { FarmPolygonPreview } from '@/components/farms/farm-polygon-preview';
import { computeDraftInputRevision } from '@/domain/schemas';
import type { AnalysisJobRecord, ReportEnvelope } from '@/domain/farmer-ux-contracts';
import type { SiteCapabilityCheckResult } from '@/domain/capability-overlay';
import { buildReportEnvelopeFromEvaluation } from '@/adapters/storage-adapters';
import { useSystemCapabilities } from '@/lib/capabilities-client';
import { buildReportPdfBytes } from '@/lib/pdf-report';
import { useAstragron } from '@/hooks/use-astragron-store';
import { useMessages } from '@/lib/i18n';

export default function FarmAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const autostart = searchParams.get('autostart') === '1';

  const m = useMessages();
  const {
    getFarmDraft,
    repository,
    datasetMode,
    activePreference,
    setActivePreference,
    reducedMotion,
    complexityMode,
    unitMode,
    recordReportSnapshot,
    getReportsForFarm,
  } = useAstragron();
  const { capabilities, loaded: capLoaded } = useSystemCapabilities();

  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);

  const [job, setJob] = useState<AnalysisJobRecord | null>(null);
  const [running, setRunning] = useState(false);
  const [savedReport, setSavedReport] = useState<ReportEnvelope | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [siteCapabilityCheck, setSiteCapabilityCheck] = useState<SiteCapabilityCheckResult | null>(null);
  const autoTriggeredRef = useRef(false);

  const existingReports = getReportsForFarm(id);

  const draftLon = draft?.site.longitude ?? null;
  const draftLat = draft?.site.latitude ?? null;
  const draftGeom = draft?.fields[0]?.geometry ?? null;
  const draftId = draft?.id ?? '';
  const draftInputRevision = draft?.inputRevision;
  const draftInputsModified = Boolean(draft?.inputsModified);
  const draftIsUserCreated = Boolean(draft?.isUserCreatedDraft);

  useEffect(() => {
    if (!draftId || draftLon === null || draftLat === null) return;
    let active = true;
    void fetch('/api/capabilities/site-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [draftLon, draftLat],
        geometry: draftInputsModified || draftIsUserCreated ? draftGeom : null,
        farmId: draftId,
        inputRevision: draftInputRevision,
        isUserModifiedDraft: draftInputsModified,
        isUserCreatedDraft: draftIsUserCreated,
      }),
    })
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as { check?: SiteCapabilityCheckResult } | null;
        return r.ok ? data : null;
      })
      .then((payload: { check?: SiteCapabilityCheckResult } | null) => {
        if (active && payload?.check) setSiteCapabilityCheck(payload.check);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [draftId, draftLon, draftLat, draftGeom, draftInputRevision, draftInputsModified, draftIsUserCreated]);

  // Restore last known job record across reload (UX-033)
  useEffect(() => {
    if (typeof window === 'undefined' || job) return;
    let active = true;
    try {
      const storedRaw = window.sessionStorage.getItem(`astragron_last_job_${id}`);
      if (!storedRaw) return;
      const stored = JSON.parse(storedRaw) as AnalysisJobRecord;
      if (stored?.jobId) {
        void fetch(`/api/analyses/${encodeURIComponent(stored.jobId)}`)
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as {
              ok?: boolean;
              job?: AnalysisJobRecord;
            } | null;
            return res.ok ? data : null;
          })
          .then((data: { ok?: boolean; job?: AnalysisJobRecord } | null) => {
            if (!active) return;
            if (data?.ok && data.job) {
              setJob(data.job);
              if (data.job.reportEnvelope) {
                setSavedReport(data.job.reportEnvelope);
                recordReportSnapshot(data.job.reportEnvelope);
              }
            } else {
              setJob(stored);
              if (stored.reportEnvelope) {
                setSavedReport(stored.reportEnvelope);
              }
            }
          })
          .catch(() => {
            if (active) {
              setJob(stored);
              if (stored.reportEnvelope) {
                setSavedReport(stored.reportEnvelope);
              }
            }
          });
      }
    } catch {
      // Ignore storage read errors
    }
    return () => {
      active = false;
    };
  }, [id, job, recordReportSnapshot]);

  const handleRunAnalysis = useCallback(async () => {
    if (!draft || running) return;
    setRunning(true);
    setRunError(null);
    setSavedReport(null);

    try {
      const inputRevision = computeDraftInputRevision(draft);
      const declaredAreas = draft.fields
        .map((f) => f.declaredAreaHa)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      const totalAreaHa =
        declaredAreas.length > 0
          ? Number(declaredAreas.reduce((sum, val) => sum + val, 0).toFixed(2))
          : null;
      const requestDatasetMode =
        capabilities.liveFarmAnalysis.enabled &&
        (draft.isUserCreatedDraft || draft.inputsModified)
          ? 'REAL_SCIENTIFIC_BACKEND'
          : datasetMode;

      const res = await fetch(`/api/farms/${encodeURIComponent(id)}/analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          farmId: id,
          inputRevision,
          datasetMode: requestDatasetMode,
          coordinates: [draft.site.longitude, draft.site.latitude],
          fieldCount: draft.fields.length,
          inputsModified: Boolean(draft.inputsModified),
          isUserCreatedDraft: Boolean(draft.isUserCreatedDraft),
          farmName: draft.name,
          locationLabel: draft.site.locationLabel,
          totalAreaHa,
          fields: draft.fields.map((fld) => ({
            id: fld.id,
            label: fld.label,
            declaredAreaHa: fld.declaredAreaHa ?? null,
            geometry: fld.geometry ?? null,
            geometrySource: fld.geometrySource ?? null,
            perimeterMeters: fld.perimeterMeters ?? null,
            candidateCrops: fld.candidateCrops ?? [],
            irrigationAccess: fld.irrigationAccess === 'YES',
          })),
        }),
      });
      const json = (await res.json()) as { ok: boolean; job?: AnalysisJobRecord; reason?: string };
      if (json.job) {
        setJob(json.job);
      }
      if (!res.ok || !json.ok || !json.job) {
        setRunError(json.job?.message ?? json.reason ?? 'Could not reach the analysis service cleanly.');
        return;
      }

      const returnedJob = json.job;
      setJob(returnedJob);
      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(`astragron_last_job_${id}`, JSON.stringify(returnedJob));
        }
      } catch {
        // Ignore sessionStorage write errors
      }

      if (
        returnedJob.status === 'COMPLETED_VERIFIED' ||
        returnedJob.status === 'COMPLETED_LIMITED' ||
        returnedJob.status === 'ABSTAINED' ||
        (returnedJob.status === 'UNAVAILABLE' && Boolean(returnedJob.reportEnvelope))
      ) {
        const report =
          returnedJob.reportEnvelope ??
          buildReportEnvelopeFromEvaluation({
            farm: draft,
            repository,
            datasetMode,
            jobId: returnedJob.jobId,
          });
        recordReportSnapshot({ ...report });
        setSavedReport(report);
      }
    } catch {
      setRunError('Unable to reach local analysis endpoint. Try again or export saved report.');
    } finally {
      setRunning(false);
    }
  }, [
    draft,
    running,
    id,
    datasetMode,
    repository,
    recordReportSnapshot,
    capabilities.liveFarmAnalysis.enabled,
  ]);

  useEffect(() => {
    if (autostart && draft && capLoaded && !autoTriggeredRef.current && !running && !job) {
      autoTriggeredRef.current = true;
      void handleRunAnalysis();
    }
  }, [autostart, draft, capLoaded, running, job, handleRunAnalysis]);

  const handleCancelJob = async () => {
    if (!job) {
      setRunning(false);
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${encodeURIComponent(job.jobId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const json = (await res.json()) as { job?: AnalysisJobRecord };
        if (json.job) setJob(json.job);
      }
    } finally {
      setRunning(false);
    }
  };

  const handleDownloadQuickPdf = (report: ReportEnvelope) => {
    const bytes = buildReportPdfBytes(report, unitMode);
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astragron-report-${id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND') {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Farm Data Check & Analysis"
      />
    );
  }

  const reportToOpen = savedReport ?? existingReports[0] ?? null;
  const isSimple = complexityMode === 'SIMPLE';

  return (
    <div className="space-y-6">
      {/* Truthful Analysis & Orbital Scan Card */}
      <section
        aria-busy={running}
        data-testid="analysis-truthful-card"
        className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-6 space-y-6"
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-12 items-center">
          <div className="md:col-span-5 space-y-2">
            <FarmPolygonPreview
              farm={draft}
              animateOrbitalScan={running}
              reducedMotion={reducedMotion}
              className="h-44 w-full"
            />
            <div className="text-[11px] font-mono text-[#90A8BA] flex items-center justify-between">
              <span>{draft.name}</span>
              <span>
                [{draft.site.latitude.toFixed(3)}, {draft.site.longitude.toFixed(3)}]
              </span>
            </div>
          </div>

          <div className="md:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#72E4F1]/40 bg-[#081728] px-3 py-1 font-mono text-[11px] text-[#72E4F1]">
              <Satellite className="w-3.5 h-3.5" />
              <span>
                {capabilities.liveFarmAnalysis.enabled
                  ? 'Live Agronomic Engine Connected'
                  : 'Regional Satellite Coverage & Archive Check'}
              </span>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold text-[#F1F7FD]">
                {running
                  ? 'Checking satellite data and report readiness…'
                  : job
                    ? job.currentStage
                    : 'Check what data is available for this farm'}
              </h2>
              <p className="text-xs sm:text-sm text-[#AEC4D3] leading-relaxed">
                {running
                  ? 'Inspecting regional Earth-observation coverage metadata and model qualification rules. Completion time depends on connection and dataset availability (no fixed percentage estimate).'
                  : job
                    ? job.message
                    : 'Run an honest check of available satellite layers, boundaries, and whether a multi-year crop optimization report is calibrated for your site.'}
              </p>
            </div>

            {/* Honest Capability Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
                <span className="text-[#90A8BA] block text-[11px]">Satellite Coverage Check</span>
                <span className="font-semibold text-[#57D9A7]">
                  {capabilities.coverageLookup.enabled ? 'Available locally' : 'Unavailable'}
                </span>
              </div>
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3">
                <span className="text-[#90A8BA] block text-[11px]">Live Custom Optimization</span>
                <span className="font-semibold text-[#FFCE7B]">
                  {siteCapabilityCheck?.status === 'CONFIRMED_UNSUPPORTED'
                    ? 'Confirmed unsupported here'
                    : capabilities.liveFarmAnalysis.enabled
                      ? 'Connected'
                      : 'Not connected yet'}
                </span>
              </div>
            </div>

            {siteCapabilityCheck?.status === 'CONFIRMED_UNSUPPORTED' && (
              <div
                data-testid="analysis-site-unsupported-notice"
                className="rounded-xl border border-rose-500/40 bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-100"
              >
                <strong className="font-semibold text-rose-200">{siteCapabilityCheck.headline}:</strong>{' '}
                {siteCapabilityCheck.explanation}
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {running ? (
                <button
                  type="button"
                  onClick={handleCancelJob}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#FF9299]/60 bg-[#2C141B] px-5 py-2 text-xs font-semibold text-[#FF9299] cursor-pointer"
                >
                  <Ban className="w-4 h-4" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="analysis-run-btn"
                  onClick={handleRunAnalysis}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-[#72E4F1] px-6 py-2.5 text-sm font-semibold text-[#061320] hover:bg-[#93EDF7] cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{job ? 'Re-check data & save report' : 'Check available data'}</span>
                </button>
              )}

              {reportToOpen && !running && (
                <Link
                  href={`/farm/${id}/results?reportId=${encodeURIComponent(reportToOpen.reportId)}`}
                  prefetch={false}
                  data-testid="analysis-open-report-link"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#57D9A7]/60 bg-[#0D2B2A] px-5 py-2 text-xs font-semibold text-[#57D9A7] hover:bg-[#143D3B]"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Open Report</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}

              {reportToOpen && !running && (
                <button
                  type="button"
                  onClick={() => handleDownloadQuickPdf(reportToOpen)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#548299] bg-[#081728] px-4 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-[#72E4F1]" />
                  <span>PDF</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Truthful Stage Status Strip (Never a 0-100% fake progress bar) */}
        {job && (
          <div
            data-testid="analysis-job-status"
            data-analysis-status={job.status}
            data-job-id={job.jobId}
            className="rounded-xl border border-[#29455A] bg-[#081728] p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="space-y-0.5">
              <div className="font-mono text-[11px] text-[#72E4F1]">
                STATUS: {job.status} · JOB: {job.jobId}
              </div>
              <div className="text-[#AEC4D3]">
                {savedReport
                  ? `Saved immutable report snapshot (${savedReport.reportId.slice(0, 18)}…) on this device.`
                  : job.message}
              </div>
              {job.adaptiveSummary && (() => {
                const summary = job.adaptiveSummary as {
                  statusOutcome?: unknown;
                  capabilityStatuses?: Record<string, unknown>;
                };
                const capMap =
                  summary.capabilityStatuses && typeof summary.capabilityStatuses === 'object'
                    ? summary.capabilityStatuses
                    : {};
                const capEntries = Object.entries(capMap);
                const ready = capEntries.filter(([, v]) => v === 'READY').map(([k]) => k);
                const conditional = capEntries.filter(([, v]) => v === 'CONDITIONAL').map(([k]) => k);
                const blockedCount = capEntries.filter(([, v]) => v === 'BLOCKED').length;
                return (
                  <div
                    data-testid="analysis-adaptive-summary"
                    className="font-mono text-[11px] text-[#8CE7C4]"
                  >
                    C1–C10 Outcome:{' '}
                    {typeof summary.statusOutcome === 'string' ? summary.statusOutcome : 'REPORTED'} ·
                    Ready: {ready.join(', ') || 'none'} · Conditional:{' '}
                    {conditional.join(', ') || 'none'} · Blocked: {blockedCount}
                  </div>
                );
              })()}
            </div>
            {job.failClosedStatus && (
              <span className="rounded-lg border border-[#548299]/50 bg-[#0D2031] px-2.5 py-1 font-mono text-[11px] text-[#FFCE7B]">
                {job.failClosedStatus}
              </span>
            )}
          </div>
        )}

        {runError && (
          <div className="rounded-xl border border-[#FF9299] bg-[#2C141B] p-4 text-xs text-[#FF9299] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{runError}</span>
          </div>
        )}
      </section>

      {/* Collapsible Research Archive Preference Option (Hidden cleanly in Farmer mode by default) */}
      <details
        open={!isSimple}
        className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5"
      >
        <summary className="cursor-pointer text-xs font-semibold text-[#91B8FF] select-none">
          Research archive comparison preference (optional technical setting)
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 border-t border-[#29455A] pt-4">
          {(
            [
              'STRICT_ALL_SCENARIOS_SERVICE',
              'MINIMIZE_WORST_ET_SHORTFALL',
              'MINIMAX_REGRET',
              'PARETO_FRONTIER',
            ] as const
          ).map((prefKey) => {
            const selected = activePreference === prefKey;
            const textObj = m.preferences[prefKey];
            return (
              <button
                key={prefKey}
                type="button"
                onClick={() => setActivePreference(prefKey)}
                className={`rounded-xl border p-4 text-left transition cursor-pointer ${
                  selected
                    ? 'border-[#72E4F1] bg-[#132B3F]'
                    : 'border-[#29455A] bg-[#081728] hover:border-[#548299]'
                }`}
              >
                <div className="font-mono text-xs font-bold text-[#72E4F1]">
                  {textObj.label}
                </div>
                <p className="mt-1 text-xs text-[#AEC4D3]">{textObj.plainExplanation}</p>
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
