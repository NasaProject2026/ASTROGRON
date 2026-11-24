'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Compass,
  Clock,
  FileSearch,
  Database,
  Cpu,
  FlaskConical,
  HelpCircle,
  Sparkles,
  SlidersHorizontal,
  ShieldAlert,
  Globe2,
  ArrowRight,
  Lock,
} from 'lucide-react';
import type {
  CoverageStatus,
  DatasetOperatingMode,
  EvidenceClass,
  RepositoryStatusCode,
} from '@/domain/contracts';
import { useMessages } from '@/lib/i18n';
import { useSystemCapabilities } from '@/lib/capabilities-client';
import { useAstragron } from '@/hooks/use-astragron-store';
import { recordedM14Repository } from '@/adapters/repositories';

export function AstragronMark({ className = 'w-7 h-7' }: { className?: string }) {
  // Original ASTRAGRON glyph: orbital arc + terraced field horizon geometry (distinct from any NASA trademark)
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="16" stroke="#29455A" strokeWidth="1.25" />
      <path
        d="M5.5 21.5C9.5 11.5 21.5 6.5 31.5 10.5"
        stroke="#72E4F1"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M8.5 25.5C13.5 22 22.5 22 27.5 25.5"
        stroke="#57D9A7"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M11.5 29C15.5 27 20.5 27 24.5 29"
        stroke="#DCC08A"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="26.5" cy="11.2" r="2.6" fill="#72E4F1" />
    </svg>
  );
}

export function CoverageStatusBadge({
  status,
  size = 'md',
}: {
  status: CoverageStatus;
  size?: 'sm' | 'md';
}) {
  const m = useMessages();
  const info = m.coverageStatuses[status];

  const config: Record<
    CoverageStatus,
    { bg: string; border: string; text: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    AVAILABLE: {
      bg: 'bg-[#0D2B2A]',
      border: 'border-[#57D9A7]/50',
      text: 'text-[#57D9A7]',
      Icon: CheckCircle2,
    },
    CONDITIONAL: {
      bg: 'bg-[#10253A]',
      border: 'border-[#91B8FF]/50',
      text: 'text-[#91B8FF]',
      Icon: AlertTriangle,
    },
    INSUFFICIENT_EVIDENCE: {
      bg: 'bg-[#2B2212]',
      border: 'border-[#FFCE7B]/50',
      text: 'text-[#FFCE7B]',
      Icon: HelpCircle,
    },
    OUT_OF_COVERAGE: {
      bg: 'bg-[#2C141B]',
      border: 'border-[#FF9299]/50',
      text: 'text-[#FF9299]',
      Icon: XOctagon,
    },
    TEMPORARILY_UNAVAILABLE: {
      bg: 'bg-[#132B3F]',
      border: 'border-[#548299]/50',
      text: 'text-[#AEC4D3]',
      Icon: Clock,
    },
  };

  const { bg, border, text, Icon } = config[status];
  const pad = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium tracking-wide ${bg} ${border} ${text} ${pad}`}
      title={info.shortDesc}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{status}</span>
      <span className="sr-only">({info.label})</span>
    </span>
  );
}

export function EvidenceClassBadge({
  evidenceClass,
}: {
  evidenceClass: EvidenceClass;
}) {
  const m = useMessages();
  const info = m.evidenceClasses[evidenceClass];

  const config: Record<
    EvidenceClass,
    { border: string; text: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    OBSERVED: {
      border: 'border-[#72E4F1]/45 bg-[#0A2536]',
      text: 'text-[#72E4F1]',
      Icon: Compass,
    },
    DERIVED: {
      border: 'border-[#43C9C1]/45 bg-[#0B262C]',
      text: 'text-[#43C9C1]',
      Icon: Cpu,
    },
    REGIONAL_MODEL_EVIDENCE: {
      border: 'border-[#91B8FF]/45 bg-[#0F2238]',
      text: 'text-[#91B8FF]',
      Icon: Database,
    },
    RESEARCH_ASSUMPTION: {
      border: 'border-[#DCC08A]/50 bg-[#252015]',
      text: 'text-[#DCC08A]',
      Icon: FlaskConical,
    },
    SYNTHETIC_UI_FIXTURE: {
      border: 'border-[#DCC08A]/65 bg-[#252015]',
      text: 'text-[#DCC08A]',
      Icon: FlaskConical,
    },
    MISSING_OR_UNQUALIFIED: {
      border: 'border-[#FFCE7B]/50 bg-[#2A1F12]',
      text: 'text-[#FFCE7B]',
      Icon: AlertTriangle,
    },
  };

  const { border, text, Icon } = config[evidenceClass];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-mono ${border} ${text}`}
      title={info.description}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{info.label}</span>
    </span>
  );
}

export function ViewEvidenceButton({
  evidenceId,
  siteId,
  label = 'View evidence',
  className = '',
}: {
  evidenceId: string | null | undefined;
  siteId?: string;
  label?: string;
  className?: string;
}) {
  const { openEvidenceDrawer, activeSiteId, datasetMode } = useAstragron();
  const params = useParams<{ id?: string | string[] }>();
  const routeSiteId = typeof params?.id === 'string' ? params.id : undefined;
  const resolvedSiteId = siteId ?? routeSiteId ?? activeSiteId;

  if (!evidenceId) {
    return (
      <span
        data-testid="view-evidence-disabled"
        className={`inline-flex items-center gap-1.5 rounded-lg border border-[#29455A]/60 bg-[#081728]/70 px-2.5 py-1.5 text-xs font-medium text-[#7F99AA] min-h-[34px] cursor-not-allowed ${className}`}
      >
        <Lock className="w-3.5 h-3.5 shrink-0 text-[#7F99AA]" />
        <span>No evidence bundled for site</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        openEvidenceDrawer(evidenceId, {
          siteId: resolvedSiteId,
          datasetMode,
        })
      }
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[#29455A] bg-[#0D2031] px-2.5 py-1.5 text-xs font-medium text-[#91B8FF] transition hover:border-[#72E4F1] hover:bg-[#17374A] hover:text-[#F1F7FD] min-h-[34px] cursor-pointer ${className}`}
    >
      <FileSearch className="w-3.5 h-3.5 shrink-0 text-[#72E4F1]" />
      <span>{label}</span>
    </button>
  );
}

export function ComplexityModeSwitch() {
  const { complexityMode, setComplexityMode } = useAstragron();

  return (
    <div
      className="inline-flex shrink-0 items-center rounded-xl border border-[#29455A] bg-[#081728] p-1"
      role="group"
      aria-label="Information complexity mode"
    >
      <button
        type="button"
        onClick={() => setComplexityMode('SIMPLE')}
        aria-pressed={complexityMode === 'SIMPLE'}
        aria-label="Simple View"
        className={`inline-flex items-center gap-1 xl:gap-1.5 whitespace-nowrap rounded-lg px-2 xl:px-3 py-1.5 text-xs font-medium transition-none cursor-pointer min-h-[38px] ${
          complexityMode === 'SIMPLE'
            ? 'bg-[#72E4F1] text-[#081521] font-semibold shadow-sm'
            : 'text-[#AEC4D3] hover:text-[#F1F7FD]'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0 hidden xl:block" />
        <span>
          Simple<span className="hidden xl:inline"> View</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setComplexityMode('SCIENTIFIC')}
        aria-pressed={complexityMode === 'SCIENTIFIC'}
        aria-label="Scientific View"
        className={`inline-flex items-center gap-1 xl:gap-1.5 whitespace-nowrap rounded-lg px-2 xl:px-3 py-1.5 text-xs font-medium transition-none cursor-pointer min-h-[38px] ${
          complexityMode === 'SCIENTIFIC'
            ? 'bg-[#72E4F1] text-[#081521] font-semibold shadow-sm'
            : 'text-[#AEC4D3] hover:text-[#F1F7FD]'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 shrink-0 hidden xl:block" />
        <span>
          Scientific<span className="hidden xl:inline"> View</span>
        </span>
      </button>
    </div>
  );
}

export function DatasetModeSwitch() {
  const { datasetMode, setDatasetMode } = useAstragron();
  const { capabilities } = useSystemCapabilities();
  const m = useMessages();
  const isRecordedVerified =
    recordedM14Repository.getM14DecisionEvaluation('uppsala-demo').statusCode ===
    'OK_RECORDED_RESEARCH';
  const liveConnected = capabilities.liveFarmAnalysis.enabled;

  const modes: {
    id: DatasetOperatingMode;
    label: string;
    badge: string;
    activeColor: string;
  }[] = [
    {
      id: 'SYNTHETIC_UI_DEMO',
      label: 'Synthetic UI Demo',
      badge: datasetMode === 'SYNTHETIC_UI_DEMO' ? 'ACTIVE' : m.recordedUi.fixtureBadge,
      activeColor: 'border-[#DCC08A] bg-[#252015] text-[#DCC08A]',
    },
    {
      id: 'RECORDED_M14_RESEARCH',
      label: 'Recorded M14 Corpus',
      badge: isRecordedVerified
        ? datasetMode === 'RECORDED_M14_RESEARCH'
          ? m.recordedUi.activeReadOnlyBadge
          : m.recordedUi.activeBadge
        : m.recordedUi.unavailableBadge,
      activeColor: isRecordedVerified
        ? 'border-emerald-400 bg-[#0D2322] text-emerald-300'
        : 'border-[#FFCE7B] bg-[#2A1F12] text-[#FFCE7B]',
    },
    {
      id: 'REAL_SCIENTIFIC_BACKEND',
      label: 'Live Scientific Engine',
      badge: liveConnected ? 'BACKEND_CONNECTED' : 'BACKEND_NOT_CONNECTED',
      activeColor: liveConnected
        ? 'border-emerald-400 bg-[#0D2322] text-emerald-300'
        : 'border-[#FF9299] bg-[#2C141B] text-[#FF9299]',
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#29455A] bg-[#081728] p-1.5"
      role="group"
      aria-label="Dataset operating mode"
    >
      <span className="px-2 font-mono text-[10px] uppercase tracking-wider text-[#90A8BA]">
        Data Mode:
      </span>
      {modes.map((m) => {
        const selected = datasetMode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setDatasetMode(m.id)}
            aria-pressed={selected}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-mono transition-none cursor-pointer min-h-[32px] ${
              selected
                ? m.activeColor
                : 'border-transparent bg-[#0D2031] text-[#AEC4D3] hover:border-[#29455A] hover:text-[#F1F7FD]'
            }`}
          >
            {m.id !== 'SYNTHETIC_UI_DEMO' && <Lock className="w-3 h-3 shrink-0" />}
            <span>{m.label}</span>
            <span className="rounded bg-[#050A12]/80 px-1.5 py-0.5 text-[10px] opacity-90">
              {m.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FailClosedStatusCard({
  status,
  statusReason,
  farmId,
  datasetMode,
  surfaceTitle,
}: {
  status: RepositoryStatusCode;
  statusReason: string;
  farmId: string;
  datasetMode: DatasetOperatingMode;
  surfaceTitle: string;
}) {
  const m = useMessages();
  const { setDatasetMode, complexityMode } = useAstragron();

  const statusStyles: Record<
    RepositoryStatusCode,
    { colorClass: string; badgeClass: string }
  > = {
    SITE_NOT_FOUND: {
      colorClass: 'border-[#FF9299]/60 bg-[#2C141B]/85',
      badgeClass: 'border-[#FF9299]/60 bg-[#050A12] text-[#FF9299]',
    },
    MODEL_UNQUALIFIED: {
      colorClass: 'border-[#FFCE7B]/60 bg-[#2A1F12]/85',
      badgeClass: 'border-[#FFCE7B]/60 bg-[#050A12] text-[#FFCE7B]',
    },
    BACKEND_NOT_CONNECTED: {
      colorClass: 'border-[#FF9299]/60 bg-[#2C141B]/85',
      badgeClass: 'border-[#FF9299]/60 bg-[#050A12] text-[#FF9299]',
    },
    SOURCE_NOT_PROVIDED: {
      colorClass: 'border-[#FFCE7B]/60 bg-[#252015]/90',
      badgeClass: 'border-[#FFCE7B]/60 bg-[#050A12] text-[#FFCE7B]',
    },
    ANALYSIS_NOT_RUN_FOR_INPUT_REVISION: {
      colorClass: 'border-[#FFCE7B]/60 bg-[#2A1F12]/85',
      badgeClass: 'border-[#FFCE7B]/60 bg-[#050A12] text-[#FFCE7B]',
    },
    NO_EVIDENCE_FOR_SITE: {
      colorClass: 'border-[#91B8FF]/60 bg-[#102033]/90',
      badgeClass: 'border-[#91B8FF]/60 bg-[#050A12] text-[#91B8FF]',
    },
    OK_COVERAGE_ONLY: {
      colorClass: 'border-[#91B8FF]/50 bg-[#0F2238]/85',
      badgeClass: 'border-[#91B8FF]/50 bg-[#050A12] text-[#91B8FF]',
    },
    OK_SYNTHETIC_DEMO: {
      colorClass: 'border-[#DCC08A]/50 bg-[#252015]/85',
      badgeClass: 'border-[#DCC08A]/50 bg-[#050A12] text-[#DCC08A]',
    },
    OK_RECORDED_RESEARCH: {
      colorClass: 'border-emerald-400/50 bg-[#0D2322]/85',
      badgeClass: 'border-emerald-400/50 bg-[#050A12] text-emerald-300',
    },
  };

  const meta = statusStyles[status];
  const copy = m.statusCards[status];
  const headingText = complexityMode === 'SIMPLE' ? copy.simpleTitle : copy.title;

  return (
    <section
      aria-label={`Fail-closed scientific boundary for ${surfaceTitle}`}
      data-testid="fail-closed-status-card"
      data-status-code={status}
      className={`rounded-3xl border p-6 sm:p-8 shadow-xl space-y-5 ${meta.colorClass}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 font-semibold ${meta.badgeClass}`}>
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{status}</span>
          </span>
          <span className="rounded-lg border border-[#29455A] bg-[#081728] px-2.5 py-1 text-[#AEC4D3]">
            Site ID: <strong className="text-[#F1F7FD]">{farmId}</strong>
          </span>
          <span className="rounded-lg border border-[#29455A] bg-[#081728] px-2.5 py-1 text-[#AEC4D3]">
            Dataset Mode: <strong className="text-[#72E4F1]">{datasetMode}</strong>
          </span>
        </div>
        <span className="font-mono text-xs uppercase tracking-wider text-[#DCC08A]">
          Cross-Site Data Isolation Enforced
        </span>
      </div>

      <div>
        <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F1F7FD]">
          {headingText}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[#F1F7FD]/90 max-w-3xl">
          {statusReason}
        </p>
      </div>

      <div className="rounded-2xl border border-[#29455A] bg-[#081728]/90 p-4 text-xs text-[#AEC4D3] space-y-1.5">
        <div className="font-mono uppercase tracking-wider text-[#72E4F1]">
          Scientific Integrity & Non-Extrapolation Guarantee
        </div>
        <p>
          ASTRAGRON never substitutes unchanged Uppsala (Sweden) crops, weather series, or policy
          rankings when evaluating a modified farm revision, an unknown site, a source-coverage-only
          reference site (such as Nyeri or Wagga Wagga), or an unconnected backend mode. Zero stale
          or cross-site data leakage has occurred on{' '}
          <strong className="text-[#F1F7FD]">{surfaceTitle}</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {(status === 'SOURCE_NOT_PROVIDED' || status === 'BACKEND_NOT_CONNECTED') &&
          datasetMode !== 'SYNTHETIC_UI_DEMO' && (
            <button
              type="button"
              onClick={() => setDatasetMode('SYNTHETIC_UI_DEMO')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-2.5 text-xs font-semibold text-[#081521] transition hover:bg-[#43C9C1] cursor-pointer"
            >
              <span>Switch Back to Synthetic UI Demo (SYNTHETIC_UI_DEMO)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}

        {(status === 'MODEL_UNQUALIFIED' || status === 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION') && (
          <>
            <Link
              href={`/farm/${farmId}/coverage`}
              className="inline-flex items-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-2.5 text-xs font-semibold text-[#081521] transition hover:bg-[#43C9C1]"
            >
              <span>Inspect M4 Source Coverage for {farmId}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href={`/farm/${farmId}/evidence`}
              className="inline-flex items-center gap-2 rounded-xl border border-[#548299] bg-[#132B3F] px-4 py-2.5 text-xs font-semibold text-[#F1F7FD] transition hover:border-[#72E4F1]"
            >
              <span>Inspect Site-Scoped Provenance</span>
            </Link>
          </>
        )}

        <Link
          href="/farm/uppsala-demo/results"
          className="inline-flex items-center gap-2 rounded-xl border border-[#29455A] bg-[#0D2031] px-4 py-2.5 text-xs font-medium text-[#AEC4D3] transition hover:border-[#72E4F1] hover:text-[#F1F7FD]"
        >
          <span>
            {status === 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
              ? 'View reference Uppsala demonstration'
              : 'Open Uppsala Synthetic Demo (uppsala-demo)'}
          </span>
        </Link>

        <Link
          href="/explore"
          className="inline-flex items-center gap-2 rounded-xl border border-[#29455A] bg-[#081728] px-4 py-2.5 text-xs font-medium text-[#AEC4D3] transition hover:border-[#72E4F1] hover:text-[#F1F7FD]"
        >
          <Globe2 className="w-3.5 h-3.5 text-[#72E4F1]" />
          <span>Return to Earth Explorer</span>
        </Link>
      </div>
    </section>
  );
}

export function DemoDisclosureStrip({ connectedResearch = false }: { connectedResearch?: boolean }) {
  const m = useMessages();
  const { datasetMode } = useAstragron();
  const [expandedMobile, setExpandedMobile] = React.useState(false);

  const displayMode = connectedResearch ? 'Research Workspace' : datasetMode === 'RECORDED_M14_RESEARCH' ? 'Recorded M14' : datasetMode === 'REAL_SCIENTIFIC_BACKEND' ? 'Live Engine' : 'Research Preview';
  const watermarkText = connectedResearch
    ? 'Wageningen 5-Year Study · NASA POWER Weather (2016–2020)'
    : datasetMode === 'RECORDED_M14_RESEARCH'
      ? 'Recorded M14 Research Archive'
      : datasetMode === 'REAL_SCIENTIFIC_BACKEND'
        ? 'Connected Scientific Engine'
        : 'ASTRAGRON Earth & Agricultural Research';

  const qualifierText = connectedResearch
    ? 'Five-year crop-rotation alternatives and provenance documented per study · Not field-validated advice'
    : 'Using NASA Earth-observation concepts · Exploratory research workspace';

  const watermarkPillClass =
    datasetMode === 'RECORDED_M14_RESEARCH' || connectedResearch
      ? 'border-emerald-400/35 bg-[#0D2322]/90 text-emerald-200'
      : datasetMode === 'REAL_SCIENTIFIC_BACKEND'
        ? 'border-sky-400/35 bg-[#0C1D2E]/90 text-sky-200'
        : 'border-[#548299]/40 bg-[#0A192A]/90 text-[#9FDCE8]';

  return (
    <div className="w-full border-b border-white/[0.06] bg-[#040912]/90 px-3 sm:px-6 py-1 text-[11px] text-[#AEC4D3] no-print">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            data-testid="disclosure-watermark-badge"
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium tracking-wide ${watermarkPillClass}`}
          >
            {watermarkText}
          </span>
          <span className="hidden xl:inline text-[#8CA6B8]">{qualifierText}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden lg:inline text-[10px] text-[#8EA6B8]">
            {m.banners.nasaDisclaimer}
          </span>
          <button
            type="button"
            onClick={() => setExpandedMobile((v) => !v)}
            aria-expanded={expandedMobile}
            className="lg:hidden text-[10px] text-[#91B8FF] underline underline-offset-2 cursor-pointer"
          >
            {expandedMobile ? 'Hide details' : `${displayMode} · Info`}
          </button>
        </div>
      </div>

      {expandedMobile && (
        <div className="mx-auto mt-1.5 max-w-[1440px] border-t border-white/[0.06] pt-1.5 text-[10px] text-[#8EA6B8] lg:hidden space-y-0.5">
          <div>{qualifierText}</div>
          <div>{m.banners.nasaDisclaimer}</div>
        </div>
      )}
    </div>
  );
}
