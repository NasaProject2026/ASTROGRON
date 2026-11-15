'use client';

import React, { useState } from 'react';
import { RotateCcw, CheckCircle2, Eye, Ruler, Sparkles } from 'lucide-react';
import {
  useAstragron,
  type ComplexityMode,
  type UnitDisplayMode,
} from '@/hooks/use-astragron-store';

export default function SettingsPage() {
  const {
    complexityMode,
    setComplexityMode,
    unitMode,
    setUnitMode,
    reducedMotion,
    setReducedMotion,
    resetDemoStorage,
  } = useAstragron();

  const [resetSuccess, setResetSuccess] = useState(false);

  const handleReset = () => {
    resetDemoStorage();
    setResetSuccess(true);
  };

  return (
    <main className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-12">
      <div className="mx-auto max-w-[920px] px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="border-b border-[#29455A] pb-5">
          <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
            PLATFORM PREFERENCES & PRIVACY CONTROLS
          </span>
          <h1 className="mt-1 font-display text-3xl font-bold text-[#F1F7FD]">
            Settings: Units, Motion, View Mode & Local Data Reset
          </h1>
        </div>

        {/* 1. Information Complexity Mode */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#72E4F1]">
            <Sparkles className="w-4 h-4" />
            <span>DEFAULT INFORMATION COMPLEXITY</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                {
                  id: 'SIMPLE' as ComplexityMode,
                  title: 'Simple View (Recommended Default)',
                  desc: 'Prioritizes plain-English questions: "What can we say?", "What is missing?", and "Why didn’t any plan qualify?"',
                },
                {
                  id: 'SCIENTIFIC' as ComplexityMode,
                  title: 'Scientific View (Opt-In)',
                  desc: 'Displays full M4/M14 schema IDs, ET0/ETc/ETa terms, SHA-256 hashes, and scenario state formulas.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setComplexityMode(opt.id)}
                className={`rounded-xl border p-4 text-left transition cursor-pointer ${
                  complexityMode === opt.id
                    ? 'border-[#72E4F1] bg-[#132B3F]'
                    : 'border-[#29455A] bg-[#081728]'
                }`}
              >
                <div className="font-semibold text-sm text-[#F1F7FD]">{opt.title}</div>
                <p className="mt-1 text-xs text-[#AEC4D3]">{opt.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* 2. Unit Display Mode */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#57D9A7]">
            <Ruler className="w-4 h-4" />
            <span>UNIT DISPLAY & CONVERSION RULES</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                {
                  id: 'SI_METRIC' as UnitDisplayMode,
                  title: 'SI Metric Only (ha, mm, m³ eq, °C)',
                  desc: 'Matches native M4/M14 scientific contract units without secondary conversions.',
                },
                {
                  id: 'SI_WITH_ACRE_GALLON_EQUIV' as UnitDisplayMode,
                  title: 'SI Metric + Acre / Acre-Foot Equivalents',
                  desc: 'Appends converted hints (1 ha = 2.47105 acres; 1 ac-ft = 1,233.48 m³) alongside primary SI values.',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setUnitMode(opt.id)}
                className={`rounded-xl border p-4 text-left transition cursor-pointer ${
                  unitMode === opt.id
                    ? 'border-[#72E4F1] bg-[#132B3F]'
                    : 'border-[#29455A] bg-[#081728]'
                }`}
              >
                <div className="font-semibold text-sm text-[#F1F7FD]">{opt.title}</div>
                <p className="mt-1 text-xs text-[#AEC4D3]">{opt.desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* 3. Reduced Motion Override */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#91B8FF]">
              <Eye className="w-4 h-4 shrink-0" />
              <span>MOTION & ORBITAL DRIFT CONTROL</span>
            </div>
            <h2 className="font-display text-base font-bold text-[#F1F7FD]">
              Prefer Reduced Motion (Disable Hero Drift & Instant Camera Jumps)
            </h2>
            <p className="text-xs text-[#AEC4D3]">
              Automatically honors <code>prefers-reduced-motion: reduce</code> and can be toggled manually here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReducedMotion(!reducedMotion)}
            aria-pressed={reducedMotion}
            className={`min-h-[44px] shrink-0 rounded-xl px-4 py-2.5 text-xs font-mono font-bold cursor-pointer ${
              reducedMotion
                ? 'bg-[#72E4F1] text-[#081521]'
                : 'border border-[#29455A] bg-[#081728] text-[#AEC4D3]'
            }`}
          >
            {reducedMotion ? 'REDUCED MOTION: ON' : 'REDUCED MOTION: OFF'}
          </button>
        </section>

        {/* 4. Reset Local Demo Data */}
        <section className="rounded-2xl border border-[#FF9299]/40 bg-[#0D2031] p-6 space-y-4">
          <div className="space-y-1">
            <span className="font-mono text-xs uppercase text-[#FF9299]">
              LOCAL STORAGE & PRIVACY RESET
            </span>
            <h2 className="font-display text-base font-bold text-[#F1F7FD]">
              Clear Local Farm Drafts & Restore Default M14 Reference State
            </h2>
            <p className="text-xs text-[#AEC4D3]">
              Deletes all locally saved farm drafts and UI preferences from your browser’s{' '}
              <code>localStorage</code>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#FF9299] px-4 py-2.5 text-xs font-semibold text-[#081521] hover:opacity-90 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Delete Local Drafts & Reset Demo</span>
            </button>
            {resetSuccess && (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-[#57D9A7]">
                <CheckCircle2 className="w-4 h-4" />
                Local demo storage cleared and restored to defaults.
              </span>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
