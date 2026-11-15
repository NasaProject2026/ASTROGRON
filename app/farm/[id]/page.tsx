'use client';

import React, { use } from 'react';
import Link from 'next/link';
import {
  Layers,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  PlusCircle,
} from 'lucide-react';
import {
  CoverageStatusBadge,
  EvidenceClassBadge,
  FailClosedStatusCard,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { FarmPolygonPreview } from '@/components/farms/farm-polygon-preview';
import { isBuiltInResearchSite } from '@/adapters/storage-adapters';
import { useAstragron, formatAreaWithUnit } from '@/hooks/use-astragron-store';

export default function FarmOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    getFarmDraft,
    repository,
    datasetMode,
    unitMode,
    complexityMode,
    getReportsForFarm,
    isReportStale,
  } = useAstragron();
  const draft = getFarmDraft(id);
  const siteEnv = repository.getSiteCoverageContext(id, draft);

  if (!draft || siteEnv.status === 'SITE_NOT_FOUND') {
    return (
      <FailClosedStatusCard
        status="SITE_NOT_FOUND"
        statusReason={siteEnv.statusReason}
        farmId={id}
        datasetMode={datasetMode}
        surfaceTitle="Farm Workspace Overview"
      />
    );
  }

  const preset = siteEnv.data;
  const siteEvidenceRecords = repository.getEvidenceRecordsForSite(id, draft);
  const defaultEvidenceId = siteEvidenceRecords[0]?.evidence_id ?? null;
  const totalAreaHa = draft.fields.reduce((acc, f) => acc + (f.declaredAreaHa ?? 0), 0);
  const farmReports = getReportsForFarm(id);
  const latestReport = farmReports[0] ?? null;
  const latestIsFresh = latestReport ? !isReportStale(latestReport) : false;
  const isUppsalaBenchmark = id === 'uppsala-demo' && !draft.inputsModified;
  const isSimple = complexityMode === 'SIMPLE';
  const isBuiltIn = isBuiltInResearchSite(id);

  const primaryHref =
    isUppsalaBenchmark || latestIsFresh
      ? `/farm/${id}/results`
      : `/farm/${id}/analysis?autostart=1`;
  const primaryLabel = isUppsalaBenchmark
    ? 'Open Research Report'
    : latestIsFresh
      ? 'View Latest Report'
      : 'Check available satellite data';

  return (
    <div className="space-y-6">
      {/* Top Overview Banner with Contextual Primary CTA */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12 items-center">
          <div className="md:col-span-4">
            <FarmPolygonPreview farm={draft} className="h-36 w-full" />
          </div>
          <div className="md:col-span-8 space-y-3">
            <div>
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#72E4F1]">
                {isBuiltIn ? 'Research Example' : 'Saved on this device'} · {draft.fields.length} field
                {draft.fields.length === 1 ? '' : 's'}
              </span>
              <h2 className="mt-1 font-display text-2xl font-bold text-[#F1F7FD]">
                {draft.name}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-[#AEC4D3]">
                {isSimple
                  ? 'Review your field layout, run an honest Earth-observation data check, or open your saved report dossier.'
                  : draft.site.spatialPrecisionNote}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href={primaryHref}
                data-testid="farm-overview-primary-cta"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#72E4F1] px-5 py-2.5 text-sm font-semibold text-[#061320] hover:bg-[#93EDF7]"
              >
                <BarChart3 className="w-4 h-4" />
                <span>{primaryLabel}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href={`/farm/new?from=${id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#548299] bg-[#081728] px-4 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1]"
              >
                <PlusCircle className="w-3.5 h-3.5 text-[#72E4F1]" />
                <span>Edit fields</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2 border-t border-[#29455A]/70">
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
            <span className="text-xs text-[#90A8BA] block">Defined Fields</span>
            <span className="mt-0.5 font-mono text-lg font-bold text-[#F1F7FD]">
              {draft.fields.length} Parcel{draft.fields.length === 1 ? '' : 's'}
            </span>
            <span className="text-[11px] text-[#AEC4D3] block">
              {draft.fields.filter((f) => f.irrigationAccess === 'NO').length} rainfed only
            </span>
          </div>
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
            <span className="text-xs text-[#90A8BA] block">Total Area</span>
            <span className="mt-0.5 font-mono text-lg font-bold text-[#57D9A7]">
              {formatAreaWithUnit(totalAreaHa, unitMode)}
            </span>
            <span className="text-[11px] text-[#AEC4D3] block">
              {draft.fields.some((f) => f.areaBasis === 'GEOMETRY_DERIVED_ESTIMATE')
                ? 'Includes map geometry'
                : 'Farmer estimate'}
            </span>
          </div>
          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3.5">
            <span className="text-xs text-[#90A8BA] block">Saved Reports</span>
            <span className="mt-0.5 font-mono text-lg font-bold text-[#91B8FF]">
              {farmReports.length}
            </span>
            <span className="text-[11px] text-[#AEC4D3] block">
              {latestReport
                ? latestIsFresh
                  ? 'Matches current fields'
                  : 'Older input version'
                : 'None generated yet'}
            </span>
          </div>
          <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/70 p-3.5">
            <span className="text-xs text-[#DCC08A] block">Crop Advice</span>
            <span className="mt-0.5 font-mono text-lg font-bold text-[#FFCE7B]">
              BLOCKED
            </span>
            <span className="text-[11px] text-[#AEC4D3] block">Not field-validated</span>
          </div>
        </div>
      </div>

      {/* Field Parcels Inventory */}
      <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#29455A] pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#72E4F1]" />
            <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
              Declared Field Parcels & Resource Constraints ({draft.name})
            </h3>
          </div>
          <ViewEvidenceButton evidenceId={defaultEvidenceId} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {draft.fields.map((field) => (
            <div
              key={field.id}
              className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-xs text-[#72E4F1]">{field.id}</span>
                  <h4 className="text-sm font-semibold text-[#F1F7FD]">{field.label}</h4>
                </div>
                <span
                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                    field.irrigationAccess === 'NO'
                      ? 'border-[#FF9299]/50 bg-[#2C141B] text-[#FF9299]'
                      : field.irrigationAccess === 'YES'
                      ? 'border-[#57D9A7]/50 bg-[#0D2B2A] text-[#57D9A7]'
                      : 'border-[#FFCE7B]/50 bg-[#252015] text-[#FFCE7B]'
                  }`}
                >
                  IRRIGATION: {field.irrigationAccess}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[#90A8BA] block">Declared Area</span>
                  <span className="font-mono text-[#F1F7FD]">
                    {formatAreaWithUnit(field.declaredAreaHa, unitMode)}
                  </span>
                </div>
                <div>
                  <span className="text-[#90A8BA] block">Area Basis</span>
                  <span className="font-mono text-[11px] text-[#DCC08A]">{field.areaBasis}</span>
                </div>
                <div>
                  <span className="text-[#90A8BA] block">Soil Texture</span>
                  <span className="text-[#F1F7FD]">{field.soilTexture.value ?? 'Null / Missing'}</span>
                </div>
                <div>
                  <span className="text-[#90A8BA] block">Mineral N (Elemental)</span>
                  <span className="font-mono text-[#FFCE7B]">
                    {field.mineralNo3KgHa.value === null
                      ? 'NULL (Unmeasured)'
                      : `${field.mineralNo3KgHa.value} kg N/ha`}
                  </span>
                </div>
              </div>

              {complexityMode === 'SCIENTIFIC' && (
                <div className="pt-2 border-t border-[#29455A]/60 flex flex-wrap gap-2">
                  <EvidenceClassBadge evidenceClass={field.soilTexture.evidenceClass} />
                  <EvidenceClassBadge evidenceClass={field.mineralNo3KgHa.evidenceClass} />
                </div>
              )}

              {field.notes && <p className="text-xs text-[#AEC4D3]">{field.notes}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Capability Readiness Summary */}
      {preset && (
        <div className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#29455A] pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#91B8FF]" />
              <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
                Site Capability Readiness ({preset.name})
              </h3>
            </div>
            <Link
              href={`/farm/${id}/coverage`}
              className="inline-flex min-h-[44px] items-center text-xs font-semibold text-[#72E4F1] hover:underline"
            >
              Full M4 Coverage Matrix &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {preset.capabilities.map((cap) => (
              <div
                key={cap.capability}
                className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#F1F7FD]">{cap.capability_label}</span>
                  <CoverageStatusBadge status={cap.status} size="sm" />
                </div>
                <p className="text-xs text-[#AEC4D3]">{cap.scientific_scope}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
