'use client';

import React from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Database,
  GitCompare,
  ShieldAlert,
  ArrowRight,
  Layers,
} from 'lucide-react';
import {
  CoverageStatusBadge,
  EvidenceClassBadge,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-12">
      <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8 space-y-10">
        {/* Header */}
        <div className="border-b border-[#29455A] pb-6 space-y-3">
          <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
            SCIENTIFIC METHODOLOGY & GOVERNANCE · M4 & M14 CONTRACTS
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#F1F7FD]">
            How ASTRAGRON Works: Plain Language & Scientific Foundations
          </h1>
          <p className="text-base text-[#AEC4D3] max-w-3xl leading-relaxed">
            ASTRAGRON connects macro-scale Earth observations with local farm research questions
            while enforcing strict scientific truth boundaries. Here is how satellite observations,
            local evidence, and multi-scenario evaluations fit together.
          </p>
        </div>

        {/* Section 1: Plain-Language Overview */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#72E4F1]">
            <BookOpen className="w-4 h-4" />
            <span>01 · PLAIN-LANGUAGE EXPLANATION FOR FARMERS & PLANNERS</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-[#F1F7FD]">
            Why satellite data alone cannot tell you what crop to plant tomorrow
          </h2>
          <p className="text-sm text-[#AEC4D3] leading-relaxed">
            Earth-observing satellites (such as NASA POWER, GPM IMERG, SMAP, and Harmonized Landsat
            Sentinel-2) provide valuable regional context: historical rainfall patterns, temperature
            swings, regional soil moisture trends, and canopy greenness. However, a satellite pixel
            covering 10 to 50 kilometers cannot see whether your specific north field has a working
            irrigation pipe, how much plant-available nitrate is in your subsoil, or what your legal
            water extraction permit allows.
          </p>
          <p className="text-sm text-[#AEC4D3] leading-relaxed">
            Instead of pretending to be an oracle that outputs a single &ldquo;best farm plan,&rdquo;
            ASTRAGRON tests a finite set of candidate 5-year crop rotations against historical
            dry, median, and wet weather analogues—and clearly reports when <strong>zero</strong>{' '}
            plans meet every water-service requirement.
          </p>
        </section>

        {/* Section 2: M4 Global Evidence Taxonomy */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 sm:p-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#91B8FF]">
              <Database className="w-4 h-4" />
              <span>02 · M4 GLOBAL EVIDENCE CONTRACT (astragron.global-evidence.v1)</span>
            </div>
            <ViewEvidenceButton evidenceId="syn-ev-uppsala-weather-2018" siteId="uppsala-demo" />
          </div>

          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Source Coverage Statuses & Evidence Classifications
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-3">
              <h3 className="font-mono uppercase text-[#72E4F1]">Five M4 Coverage Statuses</h3>
              <div className="space-y-2">
                {(
                  [
                    'AVAILABLE',
                    'CONDITIONAL',
                    'INSUFFICIENT_EVIDENCE',
                    'OUT_OF_COVERAGE',
                    'TEMPORARILY_UNAVAILABLE',
                  ] as const
                ).map((st) => (
                  <div key={st} className="flex items-center justify-between gap-2">
                    <CoverageStatusBadge status={st} size="sm" />
                    <span className="text-[#AEC4D3] text-end">Site × Variable × Time × Purpose</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-3">
              <h3 className="font-mono uppercase text-[#91B8FF]">Six Evidence Classifications</h3>
              <div className="space-y-2">
                {(
                  [
                    'OBSERVED',
                    'DERIVED',
                    'REGIONAL_MODEL_EVIDENCE',
                    'RESEARCH_ASSUMPTION',
                    'SYNTHETIC_UI_FIXTURE',
                    'MISSING_OR_UNQUALIFIED',
                  ] as const
                ).map((ec) => (
                  <div key={ec} className="flex items-center justify-between gap-2">
                    <EvidenceClassBadge evidenceClass={ec} />
                    <span className="text-[#AEC4D3] text-end">Explicit Lineage Tag</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 text-xs text-[#AEC4D3] space-y-1.5">
            <strong className="text-[#F1F7FD] font-mono block">
              Tested NASA POWER Variables & EO Scope Boundaries:
            </strong>
            <p>
              M4 reference NASA POWER variables: <code>T2M_MIN</code>, <code>T2M_MAX</code>,{' '}
              <code>T2M</code>, <code>PRECTOTCORR</code>, <code>RH2M</code>, <code>WS2M</code>,{' '}
              <code>ALLSKY_SFC_SW_DWN</code>, and <code>PS</code>. HLS (~30 m) provides surface
              reflectance context (never crop disease diagnosis); SMAP L4 (~9 km) provides regional
              modeled root-zone soil moisture (never direct field sensor measurement); GPM IMERG
              (~0.1°) provides regional precipitation estimates (never legal irrigation rights).
            </p>
          </div>
        </section>

        {/* Section 3: M14 Decision Contract & Separation of Concerns */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#57D9A7]">
            <GitCompare className="w-4 h-4" />
            <span>03 · M14 DECISION CONTRACT & DATASET MODE SEPARATION</span>
          </div>

          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Synthetic UI Demonstration vs. Recorded M14 Corpus vs. Live Scientific Backend
          </h2>

          <p className="text-sm text-[#AEC4D3] leading-relaxed">
            To guarantee zero scientific misrepresentation, ASTRAGRON separates three operating modes:
            (1) <code>SYNTHETIC_UI_DEMO</code> (active default, evaluating <strong>12 synthetic policies × 9 scenario states = 108 cases</strong>{' '}
            across 3 fields totaling <strong>24.0 ha</strong>: F1=6.0 ha non-irrigable, F2=8.0 ha non-irrigable,
            F3=10.0 ha irrigable); (2) <code>RECORDED_M14_RESEARCH</code> (SHA-256 verified read-only M14 corpus
            spanning <strong>16 recorded policies × 9 states = 144 cases</strong> for Uppsala{' '}
            <code>SE_UPPSALA</code> plus M4 source-coverage records, failing closed with{' '}
            <code>SOURCE_NOT_PROVIDED</code> whenever integrity verification fails); and
            (3) <code>REAL_SCIENTIFIC_BACKEND</code> (which fails closed with{' '}
            <code>BACKEND_NOT_CONNECTED</code> when the protected scientific backend is offline).
          </p>

          <div className="rounded-xl border border-[#FFCE7B]/40 bg-[#252015]/60 p-4 text-xs text-[#AEC4D3] space-y-2">
            <div className="flex items-center gap-1.5 font-mono font-semibold text-[#FFCE7B]">
              <ShieldAlert className="w-4 h-4" />
              <span>Separation of Nitrogen & Frozen Economic Cases</span>
            </div>
            <p>
              <strong>Nitrogen:</strong> Mass-conserving accounting only; zero field-qualified N
              calibration exists and N-enabled crop ranking is not established.
            </p>
            <p>
              <strong>Frozen Financial Reference (Kept Strictly Separate):</strong> A separate frozen
              assumption-based economic study modeled a five-year operating surplus of €21,005.20 and
              a price-stress outcome of −€20,779.12. Those financial figures are never mixed into
              NASA-driven water scenario results, never presented as realized farm profits, and
              ET deficits are never used to infer crop yield or financial return.
            </p>
          </div>
        </section>

        {/* Bottom CTA */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#548299] bg-[#081728] p-6">
          <div>
            <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
              Ready to inspect the platform?
            </h3>
            <p className="text-xs text-[#AEC4D3]">
              Explore global coverage on the globe or jump directly into the Uppsala Synthetic Decision Overview.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-xl border border-[#548299] bg-[#0D2031] px-4 py-2.5 text-xs font-semibold text-[#F1F7FD]"
            >
              <Layers className="w-4 h-4 text-[#72E4F1]" />
              <span>Explore Earth</span>
            </Link>
            <Link
              href="/farm/uppsala-demo/results"
              className="inline-flex items-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-2.5 text-xs font-semibold text-[#081521]"
            >
              <span>Open Synthetic Decision Overview</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
