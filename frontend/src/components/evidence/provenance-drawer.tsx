'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { X, ShieldAlert, Database, Hash, Clock, Layers, Scale, CheckCircle2 } from 'lucide-react';
import { useAstragron } from '@/hooks/use-astragron-store';
import { EvidenceClassBadge } from '@/components/design-system/primitives';

export function ScientificProvenanceDrawer() {
  const pathname = usePathname();
  const {
    activeEvidenceDrawerId,
    activeEvidenceScope,
    activeEvidenceEnvelope,
    activeEvidenceRecord,
    openEvidenceDrawer,
    closeEvidenceDrawer,
    repository,
    activeSiteId,
    datasetMode,
    getFarmDraft,
  } = useAstragron();

  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const prevPathRef = useRef<string>(pathname);

  // Extract active farmId from route if inside /farm/[id]
  const routeFarmMatch = pathname.match(/^\/farm\/([^/]+)/);
  const routeSiteId =
    routeFarmMatch && routeFarmMatch[1] !== 'new' ? routeFarmMatch[1] : null;

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      if (activeEvidenceDrawerId) {
        closeEvidenceDrawer();
      }
    }
  }, [pathname, activeEvidenceDrawerId, closeEvidenceDrawer]);

  useEffect(() => {
    if (!activeEvidenceDrawerId) return;

    // Focus close button on open
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEvidenceDrawer();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeEvidenceDrawerId, closeEvidenceDrawer]);

  if (!activeEvidenceDrawerId) {
    return null;
  }

  const effectiveSiteId = routeSiteId ?? activeEvidenceScope?.siteId ?? activeSiteId;
  const scopedDraft = getFarmDraft(effectiveSiteId);
  const siteScopedRecords = repository.getEvidenceRecordsForSite(effectiveSiteId, scopedDraft);

  const normalizedRouteSite =
    routeSiteId === 'uppsala-m14' ? 'uppsala-demo' : routeSiteId;
  const normalizedEffectiveSite =
    effectiveSiteId === 'uppsala-m14' ? 'uppsala-demo' : effectiveSiteId;

  const isCrossSiteViolation =
    Boolean(activeEvidenceRecord) &&
    ((normalizedRouteSite && activeEvidenceRecord!.site_id !== normalizedRouteSite) ||
      activeEvidenceRecord!.site_id !== normalizedEffectiveSite);

  const safeRecord = isCrossSiteViolation ? null : activeEvidenceRecord;
  const failStatusCode = activeEvidenceEnvelope?.statusCode ?? 'NO_EVIDENCE_FOR_SITE';
  const failReasons = activeEvidenceEnvelope?.reasons ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#050A12]/75 backdrop-blur-xs no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provenance-drawer-title"
    >
      <div
        className="fixed inset-0"
        onClick={closeEvidenceDrawer}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className="relative z-10 flex h-full w-full max-w-xl flex-col border-s border-[#29455A] bg-[#0D2031] text-[#F1F7FD] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#29455A] bg-[#081728] p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
              <Database className="w-4 h-4" />
              <span>M4 / M14 Scientific Provenance Inspector</span>
              <span className="rounded bg-[#0C1D2E] border border-[#548299]/50 px-1.5 py-0.5 text-[10px] text-[#72E4F1]">
                {effectiveSiteId}
              </span>
              <span className="rounded bg-[#252015] border border-[#DCC08A]/50 px-1.5 py-0.5 text-[10px] text-[#DCC08A]">
                {safeRecord?.dataset_mode ?? datasetMode}
              </span>
            </div>
            <h2 id="provenance-drawer-title" className="mt-1 text-lg font-semibold text-[#F1F7FD]">
              {safeRecord
                ? safeRecord.variable_label
                : 'Source Provenance Not Provided'}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeEvidenceDrawer}
            aria-label="Close evidence drawer"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#29455A] bg-[#132B3F] text-[#AEC4D3] transition hover:border-[#72E4F1] hover:text-[#F1F7FD] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Record Switcher Bar */}
        <div className="border-b border-[#29455A] bg-[#07111F] px-5 py-3">
          <label htmlFor="evidence-record-select" className="block text-[11px] font-mono uppercase text-[#90A8BA] mb-1.5">
            Switch Evidence Lineage Record ({siteScopedRecords.length} scoped to {effectiveSiteId}):
          </label>
          {siteScopedRecords.length > 0 ? (
            <select
              id="evidence-record-select"
              value={siteScopedRecords.some((r) => r.evidence_id === activeEvidenceDrawerId) ? activeEvidenceDrawerId : ''}
              onChange={(e) => {
                if (e.target.value) {
                  openEvidenceDrawer(e.target.value, { siteId: effectiveSiteId, datasetMode });
                }
              }}
              className="w-full rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-mono text-[#F1F7FD]"
            >
              {!siteScopedRecords.some((r) => r.evidence_id === activeEvidenceDrawerId) && (
                <option value="">-- Select scoped record ({effectiveSiteId}) --</option>
              )}
              {siteScopedRecords.map((rec) => (
                <option key={rec.evidence_id} value={rec.evidence_id}>
                  [{rec.site_id}] {rec.evidence_id} — {rec.variable_label}
                </option>
              ))}
            </select>
          ) : (
            <div
              data-testid="drawer-no-scoped-records"
              className="rounded-lg border border-[#29455A] bg-[#0D2031] px-3 py-2 text-xs font-mono text-[#90A8BA]"
            >
              0 evidence records bundled for {effectiveSiteId} ({datasetMode}).
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!safeRecord ? (
            <div
              data-testid="drawer-fail-closed-notice"
              data-status-code={failStatusCode}
              className="rounded-2xl border border-[#FFCE7B]/40 bg-[#252015] p-5 text-sm text-[#FFCE7B] space-y-2"
            >
              <div className="font-mono text-xs uppercase tracking-wider">
                Status: {failStatusCode} · Site: {effectiveSiteId} · Mode: {datasetMode}
              </div>
              <p className="font-semibold">
                {isCrossSiteViolation
                  ? `Cross-site evidence blocked for ID: ${activeEvidenceDrawerId} on site ${effectiveSiteId}`
                  : `No site-scoped evidence loaded for ID: ${activeEvidenceDrawerId} (${effectiveSiteId})`}
              </p>
              <p className="text-xs text-[#AEC4D3]">
                {failReasons[0] ??
                  'ASTRAGRON never fabricates synthetic provenance hashes or leaks evidence records across distinct geographic sites.'}
              </p>
            </div>
          ) : (
            <>
              {/* Classification & IDs */}
              <div className="rounded-2xl border border-[#29455A] bg-[#132B3F]/80 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-[#90A8BA]">
                    ID: <strong className="text-[#F1F7FD]">{safeRecord.evidence_id}</strong> · Site:{' '}
                    <strong className="text-[#72E4F1]">{safeRecord.site_id}</strong>
                  </span>
                  <EvidenceClassBadge evidenceClass={safeRecord.evidence_class} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#29455A]/70 text-xs">
                  <div>
                    <span className="text-[#90A8BA] block">Publisher & Archive</span>
                    <span className="text-[#F1F7FD] font-medium">{safeRecord.source}</span>
                  </div>
                  <div>
                    <span className="text-[#90A8BA] block">Product Version</span>
                    <span className="font-mono text-[#91B8FF]">{safeRecord.product_version}</span>
                  </div>
                  <div>
                    <span className="text-[#90A8BA] block">M4 Variable Codes</span>
                    <span className="font-mono text-[#72E4F1]">{safeRecord.variable}</span>
                  </div>
                  <div>
                    <span className="text-[#90A8BA] block">Physical Units</span>
                    <span className="font-mono text-[#57D9A7]">{safeRecord.units}</span>
                  </div>
                </div>
              </div>

              {/* Spatiotemporal & Hash Metadata */}
              <div className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 space-y-3 text-xs">
                <h3 className="font-mono uppercase tracking-wider text-[#91B8FF] flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span>Spatial Support, Window & Cryptographic Lineage</span>
                </h3>
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-4 border-b border-[#29455A]/50 pb-2">
                    <span className="text-[#90A8BA]">Dataset Operating Mode</span>
                    <span className="text-end font-mono text-[#DCC08A]">{safeRecord.dataset_mode}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4 border-b border-[#29455A]/50 pb-2">
                    <span className="text-[#90A8BA]">Native Spatial Support</span>
                    <span className="text-end font-mono text-[#F1F7FD]">{safeRecord.spatial_support}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4 border-b border-[#29455A]/50 pb-2">
                    <span className="text-[#90A8BA] flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Temporal Window
                    </span>
                    <span className="text-end font-mono text-[#F1F7FD]">
                      {safeRecord.period} ({safeRecord.timezone})
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4 border-b border-[#29455A]/50 pb-2">
                    <span className="text-[#90A8BA]">Extraction Recipe</span>
                    <span className="text-end font-mono text-[#AEC4D3]">{safeRecord.extraction_recipe}</span>
                  </div>
                  <div className="flex items-start justify-between gap-4 border-b border-[#29455A]/50 pb-2">
                    <span className="text-[#90A8BA]">Missingness & Quality</span>
                    <span className="text-end text-[#57D9A7]">{safeRecord.missingness_summary}</span>
                  </div>
                  <div>
                    <span className="text-[#90A8BA] flex items-center gap-1 mb-1">
                      <Hash className="w-3.5 h-3.5" /> Upstream Source SHA-256
                    </span>
                    <code className="block break-all rounded bg-[#050A12] border border-[#29455A] p-2 font-mono text-[11px] text-[#91B8FF]">
                      {safeRecord.source_sha256 ??
                        'Null — Synthetic UI fixture record (no upstream binary file hash claimed)'}
                    </code>
                  </div>
                </div>
              </div>

              {/* Uncertainty & Limitations */}
              <div className="rounded-2xl border border-[#FFCE7B]/40 bg-[#252015]/70 p-4 space-y-2.5 text-xs">
                <h3 className="font-mono uppercase tracking-wider text-[#FFCE7B] flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Scientific Uncertainty & Scope Limitations</span>
                </h3>
                <p className="text-[#F1F7FD] leading-relaxed">{safeRecord.uncertainty}</p>
                <ul className="list-disc ps-5 space-y-1 text-[#AEC4D3]">
                  {safeRecord.limitations.map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>

              {/* Sample Values */}
              <div className="rounded-2xl border border-[#29455A] bg-[#081728] p-4 space-y-2.5 text-xs">
                <h3 className="font-mono uppercase tracking-wider text-[#72E4F1]">
                  Synthetic Sample Checkpoints ({safeRecord.units})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {safeRecord.samples.map((s, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-[#29455A] bg-[#0D2031] p-2 font-mono"
                    >
                      <div className="text-[11px] text-[#90A8BA]">{s.date}</div>
                      <div className="text-sm font-semibold text-[#F1F7FD]">
                        {s.value === null ? 'NULL' : s.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Supported Calculations & License */}
              <div className="rounded-2xl border border-[#29455A] bg-[#132B3F]/60 p-4 space-y-3 text-xs">
                <div>
                  <span className="font-mono uppercase text-[#90A8BA] block mb-1.5">
                    Supports Scenarios & Calculations:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {safeRecord.supports_components.map((comp, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-md border border-[#29455A] bg-[#081728] px-2.5 py-1 text-[#AEC4D3]"
                      >
                        <CheckCircle2 className="w-3 h-3 text-[#57D9A7]" />
                        {comp}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="pt-2 border-t border-[#29455A]/60 flex items-center justify-between gap-2 text-[#90A8BA]">
                  <span className="flex items-center gap-1">
                    <Scale className="w-3.5 h-3.5" /> License / Attribution:
                  </span>
                  <span className="text-[#F1F7FD] text-end">{safeRecord.license}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#29455A] bg-[#081728] p-4 flex items-center justify-between text-xs text-[#90A8BA]">
          <span>Schema: astragron.global-evidence.v1</span>
          <button
            type="button"
            onClick={closeEvidenceDrawer}
            className="rounded-xl bg-[#72E4F1] px-4 py-2 font-semibold text-[#081521] transition hover:bg-[#43C9C1] cursor-pointer"
          >
            Done Inspecting
          </button>
        </div>
      </aside>
    </div>
  );
}
