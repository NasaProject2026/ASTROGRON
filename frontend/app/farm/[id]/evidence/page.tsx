'use client';

import React, { use } from 'react';
import {
  Database,
  Hash,
  ShieldAlert,
  Scale,
  CheckCircle2,
} from 'lucide-react';
import {
  EvidenceClassBadge,
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { useAstragron } from '@/hooks/use-astragron-store';

export default function FarmProvenanceCenterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { getFarmDraft, repository, datasetMode } = useAstragron();

  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);
  const evidenceEnv = repository.getEvidenceRecords(id, draft);
  const records = evidenceEnv.data ?? [];

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND') {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Provenance Center"
      />
    );
  }

  if (records.length === 0) {
    return (
      <FailClosedStatusCard
        status={evidenceEnv.status}
        statusReason={evidenceEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Provenance Center"
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-3">
        <span className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
          SCIENTIFIC PROVENANCE CENTER · astragron.global-evidence.v1 · SITE: {id.toUpperCase()}
        </span>
        <h2 className="font-display text-2xl font-bold text-[#F1F7FD]">
          Site-Scoped Evidence Lineage, Source Hashes & Limitations ({draft.name})
        </h2>
        <p className="text-xs sm:text-sm text-[#AEC4D3]">
          Every metric in ASTRAGRON traces to an explicit evidence classification and site scope (
          <code className="text-[#72E4F1]">{id}</code>).{' '}
          {datasetMode === 'RECORDED_M14_RESEARCH' ? (
            <>
              In <code className="text-emerald-300">RECORDED_M14_RESEARCH</code> mode, every staged artifact
              displays its verified cryptographic SHA-256 digest checked against immutable{' '}
              <code>OUTPUT_RECEIPT.json</code> and <code>DELIVERY_MANIFEST.json</code> records.
            </>
          ) : (
            <>
              Because the interface is currently operating in{' '}
              <code className="text-[#DCC08A]">{datasetMode}</code> mode without external binary extracts,
              cryptographic file hashes are explicitly reported as <code className="text-[#FFCE7B]">null</code>{' '}
              rather than inventing synthetic SHA-256 digests.
            </>
          )}
        </p>
      </div>

      <div className="space-y-4">
        {records.map((rec) => (
          <div
            key={rec.evidence_id}
            className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#29455A] pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#72E4F1]">
                  <Database className="w-3.5 h-3.5" />
                  <span>{rec.evidence_id}</span>
                  <span className="rounded bg-[#081728] border border-[#29455A] px-2 py-0.5 text-[10px] text-[#AEC4D3]">
                    site_id: {rec.site_id}
                  </span>
                  <span className="rounded bg-[#252015] border border-[#DCC08A]/50 px-2 py-0.5 text-[10px] text-[#DCC08A]">
                    {rec.dataset_mode}
                  </span>
                </div>
                <h3 className="mt-1 font-display text-lg font-bold text-[#F1F7FD]">
                  {rec.variable_label}
                </h3>
                <p className="text-xs text-[#AEC4D3]">
                  {rec.source} · <span className="font-mono text-[#91B8FF]">{rec.product_version}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <EvidenceClassBadge evidenceClass={rec.evidence_class} />
                <ViewEvidenceButton evidenceId={rec.evidence_id} label="Inspect in Drawer" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
                <span className="text-[#90A8BA] block font-mono text-[10px]">VARIABLE & UNITS</span>
                <span className="font-mono text-[#72E4F1] block mt-0.5">{rec.variable}</span>
                <span className="text-[#57D9A7] font-mono text-[11px]">{rec.units}</span>
              </div>
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
                <span className="text-[#90A8BA] block font-mono text-[10px]">SPATIAL & TEMPORAL SUPPORT</span>
                <span className="text-[#F1F7FD] block mt-0.5">{rec.spatial_support}</span>
                <span className="text-[#AEC4D3] font-mono text-[11px]">{rec.period}</span>
              </div>
              <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
                <span className="text-[#90A8BA] block font-mono text-[10px]">QUALITY & MISSINGNESS</span>
                <span className="text-[#57D9A7] block mt-0.5">{rec.missingness_summary}</span>
                <span className="text-[#AEC4D3] text-[11px]">{rec.quality}</span>
              </div>
            </div>

            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-mono text-[#91B8FF]">
                <Hash className="w-3.5 h-3.5" />
                <span>SHA-256 Digest & Extraction Recipe:</span>
              </div>
              <code className="block break-all font-mono text-[11px] text-[#F1F7FD]">
                {rec.source_sha256 ?? 'NULL (Synthetic UI fixture record — no upstream binary file hash claimed)'}
              </code>
              <div className="text-[#90A8BA] font-mono text-[11px]">
                Recipe: {rec.extraction_recipe}
              </div>
            </div>

            <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/60 p-4 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-mono text-[#FFCE7B]">
                <ShieldAlert className="w-4 h-4" />
                <span>Uncertainty & Limitations:</span>
              </div>
              <p className="text-[#F1F7FD]">{rec.uncertainty}</p>
              <ul className="list-disc ps-5 space-y-1 text-[#AEC4D3]">
                {rec.limitations.map((lim, i) => (
                  <li key={i}>{lim}</li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#90A8BA] pt-1">
              <div className="flex flex-wrap gap-1.5">
                {rec.supports_components.map((c, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded bg-[#081728] border border-[#29455A] px-2 py-0.5 text-[#AEC4D3]"
                  >
                    <CheckCircle2 className="w-3 h-3 text-[#57D9A7]" />
                    {c}
                  </span>
                ))}
              </div>
              <span className="flex items-center gap-1 font-mono text-[11px]">
                <Scale className="w-3.5 h-3.5" /> {rec.license}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
