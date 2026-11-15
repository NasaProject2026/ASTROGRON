'use client';

import React from 'react';
import {
  AstragronMark,
  CoverageStatusBadge,
  EvidenceClassBadge,
  ComplexityModeSwitch,
  DatasetModeSwitch,
} from '@/components/design-system/primitives';

const COLOR_TOKENS = [
  { name: '--space-void', hex: '#050A12', usage: 'Opening space background' },
  { name: '--bg-main', hex: '#07111F', usage: 'Primary application background' },
  { name: '--bg-nav', hex: '#081728', usage: 'Navigation & elevated dark bars' },
  { name: '--surface-1', hex: '#0D2031', usage: 'Primary panel surface' },
  { name: '--surface-2', hex: '#132B3F', usage: 'Active/secondary card surface' },
  { name: '--surface-hover', hex: '#17374A', usage: 'Interactive hover state' },
  { name: '--border-subtle', hex: '#29455A', usage: '1px structural card border' },
  { name: '--border-highlight', hex: '#548299', usage: 'Emphasized border accent' },
  { name: '--cyan-primary', hex: '#72E4F1', usage: 'Primary action signal' },
  { name: '--cyan-technical', hex: '#43C9C1', usage: 'Technical hover & derived accent' },
  { name: '--green-agri', hex: '#57D9A7', usage: 'Scenario pass / agricultural context' },
  { name: '--gold-soft', hex: '#DCC08A', usage: 'Restrained luxury / orbital marker' },
  { name: '--blue-evidence', hex: '#91B8FF', usage: 'Observed / regional evidence signal' },
  { name: '--amber-warning', hex: '#FFCE7B', usage: 'Uncertainty / missing requirements' },
  { name: '--coral-critical', hex: '#FF9299', usage: 'Blocked / calendar-invalid / destructive' },
];

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-12">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="border-b border-[#29455A] pb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
              ORBITAL INTELLIGENCE / ASTRAGRON · DESIGN SYSTEM SPECIFICATION
            </span>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#F1F7FD]">
              Centralized Theme Tokens, Typography & Scientific Status Primitives
            </h1>
          </div>
          <AstragronMark className="w-12 h-12" />
        </div>

        {/* Creative Exploration Summary */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Phase 1 Creative Exploration: Three Evaluated Directions
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
              <span className="font-mono text-[#90A8BA]">VARIATION A · NADIR TELEMETRY HUD</span>
              <p className="text-[#AEC4D3]">
                Full-bleed top-down satellite grid with dense HUD corner brackets. Rejected because
                dense sci-fi chrome competed with serious numeric legibility on mobile screens.
              </p>
            </div>
            <div className="rounded-xl border border-[#72E4F1] bg-[#132B3F] p-4 space-y-2">
              <span className="font-mono font-bold text-[#72E4F1]">
                VARIATION B (SELECTED) · ASYMMETRIC ORBITAL LIMB + CALM MISSION CONTROL
              </span>
              <p className="text-[#F1F7FD]">
                Deep space (#050A12) on the left 42% for pristine editorial typography, photorealistic
                Earth limb + EO satellite on the right 58%, transitioning into disciplined deep-navy
                (#07111F / #0D2031) utilitarian research panels. Best balance of emotional awe and clarity.
              </p>
            </div>
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-2">
              <span className="font-mono text-[#90A8BA]">VARIATION C · SPLIT GLOBE WORKBENCH</span>
              <p className="text-[#AEC4D3]">
                Immediate 50/50 split screen on `/`. Rejected for the landing route because first-time
                visitors needed a 5-second human proposition before entering the geospatial workbench.
              </p>
            </div>
          </div>
        </section>

        {/* Color Tokens */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Exact CSS Color Tokens
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {COLOR_TOKENS.map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-[#29455A] bg-[#081728] p-3 space-y-2"
              >
                <div
                  className="h-12 w-full rounded-lg border border-white/10"
                  style={{ backgroundColor: t.hex }}
                />
                <div className="font-mono text-xs font-semibold text-[#F1F7FD]">{t.name}</div>
                <div className="font-mono text-[11px] text-[#72E4F1]">{t.hex}</div>
                <div className="text-[11px] text-[#90A8BA]">{t.usage}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Status & Evidence Badges (Non-Color-Only) */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-5">
          <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
            Non-Color-Only Scientific Status & Evidence Primitives
          </h2>
          <div className="space-y-3">
            <div className="font-mono text-xs text-[#90A8BA]">M4 Coverage Statuses:</div>
            <div className="flex flex-wrap gap-2.5">
              <CoverageStatusBadge status="AVAILABLE" />
              <CoverageStatusBadge status="CONDITIONAL" />
              <CoverageStatusBadge status="INSUFFICIENT_EVIDENCE" />
              <CoverageStatusBadge status="OUT_OF_COVERAGE" />
              <CoverageStatusBadge status="TEMPORARILY_UNAVAILABLE" />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="font-mono text-xs text-[#90A8BA]">M4 Evidence Classifications:</div>
            <div className="flex flex-wrap gap-2.5">
              <EvidenceClassBadge evidenceClass="OBSERVED" />
              <EvidenceClassBadge evidenceClass="DERIVED" />
              <EvidenceClassBadge evidenceClass="REGIONAL_MODEL_EVIDENCE" />
              <EvidenceClassBadge evidenceClass="RESEARCH_ASSUMPTION" />
              <EvidenceClassBadge evidenceClass="SYNTHETIC_UI_FIXTURE" />
              <EvidenceClassBadge evidenceClass="MISSING_OR_UNQUALIFIED" />
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <div className="font-mono text-xs text-[#90A8BA]">Two-Layer Complexity & Dataset Operating Mode Switches:</div>
            <div className="flex flex-wrap gap-3">
              <ComplexityModeSwitch />
              <DatasetModeSwitch />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
