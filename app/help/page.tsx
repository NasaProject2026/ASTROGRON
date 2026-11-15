'use client';

import React from 'react';
import Link from 'next/link';
import { HelpCircle, Lock, AlertTriangle } from 'lucide-react';

const GLOSSARY_TERMS = [
  {
    term: 'ET0 / ETc / ETa (Evapotranspiration)',
    definition:
      'ET0 is reference atmospheric evaporative demand (mm/day); ETc is crop-stage water demand under non-stressed conditions; ETa is actual modeled evapotranspiration given available root-zone moisture.',
  },
  {
    term: 'Minimax Regret (MINIMAX_REGRET)',
    definition:
      'Ranks plans by their largest disadvantage versus the best comparable plan in each tested scenario. In the synthetic UI demonstration, Policy SYNTH-POL-02 has 640.25 m³ equivalent maximum regret.',
  },
  {
    term: 'Worst-Case Modeled ET Shortfall (MINIMIZE_WORST_ET_SHORTFALL)',
    definition:
      'Ranks comparable plans by their highest aggregate evapotranspiration deficit across all tested scenario states. In the synthetic UI demonstration, Policy SYNTH-POL-01 has 38,420.50 m³ equivalent worst-state shortfall.',
  },
  {
    term: 'Pareto Frontier (PARETO_FRONTIER / NO_UNIQUE_WINNER)',
    definition:
      'The subset of comparable plans where no other candidate is simultaneously better on every criterion (shortfall, regret, and mean water withdrawal). Returns NO_UNIQUE_WINNER by design.',
  },
  {
    term: 'Calendar-Invalid Policy Exclusion',
    definition:
      'If a policy schedules a sowing window before the preceding crop’s harvest window finishes (e.g., Policy SYNTH-POL-12 on Field F3 Year 3), it is excluded from comparable numeric ranking and its shortfall/regret remain NULL.',
  },
  {
    term: 'WGS84 (EPSG:4326) Coordinate Order',
    definition:
      'The M4 evidence contract specifies coordinates strictly as [longitude, latitude] in decimal degrees.',
  },
];

export default function HelpFaqPage() {
  return (
    <main className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-12">
      <div className="mx-auto max-w-[1140px] px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="border-b border-[#29455A] pb-6 space-y-2">
          <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
            HELP, GLOSSARY & QUALIFICATION FAQ
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#F1F7FD]">
            Scientific Glossary, Error States & Privacy Guide
          </h1>
          <p className="text-sm text-[#AEC4D3] max-w-3xl">
            Plain-language definitions for agronomic terms, why certain regions or models are
            marked unqualified, and how your local browser data is handled.
          </p>
        </div>

        {/* Glossary Grid */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#72E4F1]">
            <HelpCircle className="w-4 h-4" />
            <span>SCIENTIFIC & DECISION GLOSSARY</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {GLOSSARY_TERMS.map((item) => (
              <div
                key={item.term}
                className="rounded-xl border border-[#29455A] bg-[#081728] p-4 space-y-1.5"
              >
                <h2 className="font-display text-sm font-bold text-[#72E4F1]">{item.term}</h2>
                <p className="text-xs text-[#AEC4D3] leading-relaxed">{item.definition}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Common Error & Abstention Explanations */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase text-[#FFCE7B]">
            <AlertTriangle className="w-4 h-4" />
            <span>UNDERSTANDING ABSTENTION & FAIL-CLOSED STATES</span>
          </div>
          <div className="space-y-3 text-xs text-[#AEC4D3]">
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4">
              <strong className="text-[#F1F7FD] block mb-1">
                Why does the Decision Overview say &ldquo;FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED&rdquo;?
              </strong>
              In the Uppsala synthetic demonstration (3 fields, 24.0 ha), non-irrigable Field F1 (6.0 ha)
              and Field F2 (8.0 ha) experience deficits exceeding the research-assumed 100.0 mm service
              threshold during the 2018 dry weather analogue. Across 16 tested policies × 9 scenarios (144 matrix cases, 4 calendar-invalid), 0 of 12 comparable policies pass all 9 states.
            </div>
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-4">
              <strong className="text-[#F1F7FD] block mb-1">
                Why do Kenya (Nyeri) and Australia (Wagga Wagga) return &ldquo;MODEL_UNQUALIFIED&rdquo; on Decision, Plan, and Climate pages?
              </strong>
              While NASA satellites observe rainfall and surface reflectance globally, crop phenology
              and water-service models must be calibrated for local agro-ecologies. ASTRAGRON enforces
              strict cross-site isolation and never leaks Swedish crops, climate series, or policy tables
              onto non-Uppsala sites.
            </div>
          </div>
        </section>

        {/* Privacy & Local Demo Storage */}
        <section className="rounded-2xl border border-[#29455A] bg-[#0D2031] p-6 space-y-3 text-xs text-[#AEC4D3]">
          <div className="flex items-center gap-2 font-mono uppercase text-[#57D9A7]">
            <Lock className="w-4 h-4" />
            <span>PRIVACY, GEOLOCATION & LOCAL DEMO STORAGE</span>
          </div>
          <p>
            • <strong>No Covert Cloud Upload:</strong> Farm polygons, coordinates, and wizard inputs
            are stored strictly in your browser’s <code>localStorage</code> and can be wiped at any
            time on the <Link href="/settings" className="text-[#72E4F1] underline">Settings</Link> page.
          </p>
          <p>
            • <strong>Consent-First Geolocation:</strong> The browser geolocation API is never invoked
            automatically—only when you explicitly click &ldquo;Use My Location&rdquo; on the Earth Explorer.
          </p>
          <p>
            • <strong>No NASA Endorsement:</strong> ASTRAGRON references public NASA Earth-observation
            products with proper source attribution and makes zero claim of NASA endorsement or certification.
          </p>
        </section>
      </div>
    </main>
  );
}
