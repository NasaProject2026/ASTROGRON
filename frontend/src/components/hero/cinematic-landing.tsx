'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  Database,
  FlaskConical,
  Globe2,
  GitCompare,
  Layers,
  ShieldCheck,
  XOctagon,
} from 'lucide-react';
import {
  CoverageStatusBadge,
  ViewEvidenceButton,
} from '@/components/design-system/primitives';
import { EXPLORER_PRESET_SITES } from '@/fixtures/sites-and-coverage';
import { SYNTHETIC_DECISION_DATASET } from '@/fixtures/m14-decision-fixture';
import { useAstragron } from '@/hooks/use-astragron-store';
import { isBuiltInResearchSite } from '@/adapters/storage-adapters';
import { useMessages } from '@/lib/i18n';

const PREVIEW_SITES = [
  { id: 'uppsala-demo' as const, label: 'Uppsala, Sweden (59.86°N · Synthetic Demo)' },
  { id: 'nyeri-kenya' as const, label: 'Nyeri, Kenya (-0.42°S · Coverage Only)' },
  { id: 'wagga-australia' as const, label: 'Wagga Wagga, Australia (-35.11°S · Coverage Only)' },
];

export function CinematicLanding() {
  const m = useMessages();
  const { reducedMotion, farmDrafts, prefsHydrated } = useAstragron();
  const savedUserFarmCount = prefsHydrated
    ? Object.keys(farmDrafts).filter((id) => !isBuiltInResearchSite(id)).length
    : 0;
  const heroRef = useRef<HTMLElement | null>(null);
  const [heroInView, setHeroInView] = useState(true);
  const [previewSiteKey, setPreviewSiteKey] = useState<'uppsala-demo' | 'nyeri-kenya' | 'wagga-australia'>(
    'uppsala-demo'
  );

  // Pause gentle orbital backdrop drift whenever offscreen to conserve battery & GPU
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry) setHeroInView(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const activePreviewSite = EXPLORER_PRESET_SITES[previewSiteKey] ?? EXPLORER_PRESET_SITES['uppsala-demo']!;
  const synthSummary = SYNTHETIC_DECISION_DATASET.portfolioSummary;
  const shouldAnimateDrift = !reducedMotion && heroInView;

  return (
    <div className="bg-[#030710] text-[#F1F7FD]">
      {/* =======================================================================
          FIRST FOLD: FULL-BLEED ATMOSPHERIC EARTH HORIZON HERO (Zero Boxy Card)
         ======================================================================= */}
      <section
        ref={heroRef}
        aria-labelledby="hero-heading"
        className="relative isolate flex min-h-[calc(100vh-88px)] min-h-[620px] lg:min-h-[760px] w-full items-start md:items-center overflow-hidden bg-[#02050B]"
      >
        {/* Full-Bleed Earth & Observation Spacecraft Art Direction */}
        <div
          data-testid="hero-orbital-centerpiece"
          data-motion-active={shouldAnimateDrift ? 'true' : 'false'}
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <picture className="block h-full w-full">
            <source media="(min-width: 768px)" srcSet="/assets/orbital-earth-horizon-wide.jpg" />
            <img
              src="/assets/orbital-earth-horizon-mobile.jpg"
              alt="Curved Earth horizon illuminated by sunlight along a blue atmospheric limb with an unbranded gold-foil Earth-observation spacecraft in Low Earth Orbit"
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className={`h-full w-full object-cover object-bottom md:object-[72%_center] transition-transform duration-1000 ${
                shouldAnimateDrift ? 'animate-orbital-drift' : ''
              }`}
            />
          </picture>

          {/* The original editorial photograph is the public-facing default.
              The experimental independent orbital scene remains accessible at
              /orbit-lab.html but is intentionally not promoted in the hero until
              visual fidelity and real-device performance are verified. */}
          {/* Subtle Atmospheric Rim Shimmer & Deep-Space Starlight Layer (Pauses Offscreen / Reduced Motion) */}
          <div
            aria-hidden="true"
            className={`absolute inset-0 bg-[radial-gradient(ellipse_at_72%_42%,rgba(114,228,241,0.16),transparent_58%)] ${
              shouldAnimateDrift ? 'animate-limb-glow' : 'opacity-50'
            }`}
          />
          <svg
            aria-hidden="true"
            viewBox="0 0 1440 760"
            preserveAspectRatio="xMidYMid slice"
            className="hidden md:block absolute inset-0 h-full w-full"
          >
            <g className={shouldAnimateDrift ? 'animate-starlight-twinkle' : 'opacity-40'}>
              <circle cx="140" cy="88" r="1.1" fill="#F1F7FD" />
              <circle cx="420" cy="64" r="1.4" fill="#72E4F1" />
              <circle cx="670" cy="110" r="1.0" fill="#F1F7FD" />
              <circle cx="960" cy="54" r="1.3" fill="#DCC08A" />
              <circle cx="1230" cy="92" r="1.1" fill="#F1F7FD" />
              <circle cx="1360" cy="175" r="1.2" fill="#91B8FF" />
            </g>
            <path
              d="M 520 -40 Q 980 210 1480 120"
              fill="none"
              stroke="rgba(114,228,241,0.34)"
              strokeWidth="1.2"
              className={shouldAnimateDrift ? 'animate-orbit-sweep' : 'opacity-30'}
            />
          </svg>

          {/* Natural Deep-Space Scrim (Left Editorial Void on Desktop; Upper Dark Sky on Mobile) */}
          <div
            aria-hidden="true"
            className="absolute inset-0 md:hidden"
            style={{
              background:
                'linear-gradient(180deg, rgba(2,5,11,0.92) 0%, rgba(2,5,11,0.72) 38%, rgba(2,5,11,0.12) 64%, rgba(3,7,16,0.55) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            className="hidden md:block absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, #02050B 0%, rgba(2,5,11,0.92) 27%, rgba(2,5,11,0.58) 46%, rgba(2,5,11,0.10) 68%, transparent 100%)',
            }}
          />
          {/* Seamless bottom atmospheric dissolve into page narrative */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-28"
            style={{
              background: 'linear-gradient(180deg, transparent 0%, #06101D 100%)',
            }}
          />
        </div>

        {/* Left / Upper Editorial Foreground */}
        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 pt-9 pb-52 sm:px-8 sm:pt-14 md:py-20 lg:px-12">
          <div className="max-w-xl space-y-5 sm:space-y-6">
            <p className="font-mono text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[#72E4F1]">
              {m.hero.eyebrow}
            </p>

            <h1
              id="hero-heading"
              className="font-display hero-h1 text-[#F8FBFF] drop-shadow-[0_2px_24px_rgba(2,5,11,0.85)]"
            >
              {m.hero.headline}
            </h1>

            <p className="max-w-lg text-sm sm:text-base md:text-lg leading-relaxed text-[#D8E5F0]">
              {m.hero.subcopy}
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 pt-1">
              <Link
                href={savedUserFarmCount > 0 ? '/farms' : '/farm/new'}
                prefetch={false}
                data-testid="hero-primary-farmer-cta"
                className="inline-flex h-12 sm:h-13 items-center justify-center gap-2.5 rounded-full bg-[#72E4F1] px-7 text-sm sm:text-base font-semibold text-[#061320] shadow-[0_8px_32px_rgba(114,228,241,0.28)] transition hover:bg-[#93EDF7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72E4F1]"
              >
                <span>
                  {savedUserFarmCount > 0
                    ? `Open My Farms (${savedUserFarmCount})`
                    : 'Add a Farm'}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Link>

              <Link
                href="/explore"
                prefetch={false}
                className="inline-flex h-12 sm:h-13 items-center justify-center gap-2 rounded-full border border-[#72E4F1]/50 bg-[#0A1A2B]/80 px-5 text-sm font-medium text-[#F1F7FD] transition hover:border-[#72E4F1] hover:bg-[#102941] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72E4F1]"
              >
                <Globe2 className="w-4 h-4 text-[#72E4F1] shrink-0" />
                <span>{m.hero.ctaPrimary}</span>
              </Link>

              <Link
                href="/research"
                prefetch={false}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-[#D8E5F0] underline-offset-4 transition hover:text-[#72E4F1] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72E4F1]"
              >
                <FlaskConical className="w-4 h-4 text-[#72E4F1] shrink-0" />
                <span>Open Connected Research</span>
              </Link>
            </div>

            <p className="inline-block max-w-md rounded-lg bg-[#050A12]/70 px-2.5 py-1 text-[11px] sm:text-xs font-mono text-[#D5E4EF] backdrop-blur-xs sm:bg-transparent sm:p-0 sm:backdrop-blur-none sm:text-[#A6BCCB]">
              {m.hero.qualifierBadge} ·{' '}
              <Link href="/methodology" prefetch={false} className="text-[#91B8FF] underline underline-offset-4 hover:text-[#72E4F1]">
                Read methodology
              </Link>
              {' '}·{' '}
              <Link href="/research" prefetch={false} className="text-[#72E4F1] underline underline-offset-4 hover:text-[#93EDF7]">
                Public scientific demo &amp; PDF (no login)
              </Link>
            </p>
          </div>
        </div>

        {/* Discreet Atmospheric Art Attribution on Lower Right (Zero Obstructive HUD Overlay) */}
        <div className="pointer-events-none absolute bottom-4 right-5 hidden md:block z-10 max-w-md text-right font-mono text-[10px] tracking-wide text-[#9FB5C7]/85">
          Illustrative Low Earth Orbit scene · Proprietary editorial visual, not a NASA photo or live telemetry
        </div>
      </section>

      {/* =======================================================================
          SECTION 01 · SCIENTIFIC WORKFLOW (EARTH -> EVIDENCE -> DECISION)
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#06101D] py-16 sm:py-24">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 space-y-12">
          <div className="max-w-3xl space-y-3">
            <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
              {m.landing.section1.eyebrow}
            </span>
            <h2 className="font-display text-2xl sm:text-4xl font-bold text-[#F1F7FD]">
              {m.landing.section1.title}
            </h2>
            <p className="text-sm sm:text-base text-[#AEC4D3] leading-relaxed">
              {m.landing.section1.subtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                title: m.landing.section1.step1Title,
                body: m.landing.section1.step1Body,
                Icon: Compass,
                accent: 'text-[#72E4F1]',
              },
              {
                title: m.landing.section1.step2Title,
                body: m.landing.section1.step2Body,
                Icon: Database,
                accent: 'text-[#91B8FF]',
              },
              {
                title: m.landing.section1.step3Title,
                body: m.landing.section1.step3Body,
                Icon: GitCompare,
                accent: 'text-[#57D9A7]',
              },
            ].map(({ title, body, Icon, accent }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/[0.08] bg-[#0A1828]/80 p-7 space-y-4 transition hover:border-[#548299]/70"
              >
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0E2438] ${accent}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-display text-lg font-bold text-[#F1F7FD]">{title}</h3>
                <p className="text-sm text-[#AEC4D3] leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =======================================================================
          SECTION 02 · PLANETARY DATA, LOCAL QUESTIONS (With High-Altitude Swath Art)
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#040B15] py-16 sm:py-24">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 grid grid-cols-1 gap-10 lg:grid-cols-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <span className="font-mono text-xs uppercase tracking-widest text-[#91B8FF]">
                {m.landing.section2.eyebrow}
              </span>
              <h2 className="font-display text-2xl sm:text-4xl font-bold text-[#F1F7FD]">
                {m.landing.section2.title}
              </h2>
              <p className="text-sm sm:text-base text-[#AEC4D3] leading-relaxed">
                {m.landing.section2.subtitle}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/[0.08] bg-[#0A1828] p-5 space-y-2">
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
                  {m.landing.section2.colMacroTitle}
                </h3>
                <p className="text-xs sm:text-sm text-[#AEC4D3] leading-relaxed">
                  {m.landing.section2.colMacroBody}
                </p>
              </div>
              <div className="rounded-2xl border border-[#DCC08A]/25 bg-[#121922] p-5 space-y-2">
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#DCC08A]">
                  {m.landing.section2.colLocalTitle}
                </h3>
                <p className="text-xs sm:text-sm text-[#AEC4D3] leading-relaxed">
                  {m.landing.section2.colLocalBody}
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <figure className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[#081523]">
              <img
                src="/assets/agricultural-watershed-swath.jpg"
                alt="High-altitude Earth horizon overlooking river meanders and irrigated circular agricultural plots"
                className="aspect-[16/10] w-full object-cover"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#040B15]/90 to-transparent"
              />
              <figcaption className="relative z-10 px-5 pb-4 -mt-8 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#AEC4D3]">
                <span>Regional EO Grid (~9–50 km) vs. Field Reality</span>
                <span className="text-[#8EA6B8]">Illustrative Swath · Not Field Surveyed</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* =======================================================================
          SECTION 03 · SITE-BOUND SOURCE COVERAGE PREVIEW (No Extrapolation)
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#06101D] py-16 sm:py-24">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="max-w-3xl space-y-2.5">
              <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
                {m.landing.section3.eyebrow}
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F1F7FD]">
                {m.landing.section3.title}
              </h2>
              <p className="text-sm text-[#AEC4D3]">{m.landing.section3.subtitle}</p>
            </div>

            <Link
              href="/explore"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-[#72E4F1]/50 bg-[#0C2135] px-5 text-xs font-semibold text-[#72E4F1] transition hover:bg-[#13324F]"
            >
              <Layers className="w-4 h-4" />
              <span>{m.landing.section3.openExplorerCta}</span>
            </Link>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="landing-coverage-site" className="text-xs font-mono text-[#AEC4D3]">Explore source coverage for:</label>
            <select
              id="landing-coverage-site"
              value={previewSiteKey}
              onChange={(event) => setPreviewSiteKey(event.target.value as typeof previewSiteKey)}
              className="w-full min-h-[44px] sm:w-auto max-w-full rounded-xl border border-[#548299] bg-[#0D2031] px-3 py-2 text-xs sm:text-sm font-medium text-[#F1F7FD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72E4F1]"
            >
              {PREVIEW_SITES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#0A1828] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[#F1F7FD]">
                  {activePreviewSite.name}
                </h3>
                <p className="text-xs text-[#90A8BA]">{activePreviewSite.subtitle}</p>
              </div>
              <span className="rounded-md border border-white/[0.1] bg-[#050C16] px-2.5 py-1 font-mono text-xs text-[#91B8FF]">
                [{activePreviewSite.coordinates[0].toFixed(4)}°, {activePreviewSite.coordinates[1].toFixed(4)}°] CRS EPSG:4326
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {activePreviewSite.sourceCoverages.slice(0, 3).map((cov) => (
                <div
                  key={cov.source_id}
                  className="rounded-xl border border-white/[0.07] bg-[#06111D] p-4 space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[10px] text-[#72E4F1] break-all">
                      {cov.source_id}
                    </span>
                    <CoverageStatusBadge status={cov.status} size="sm" />
                  </div>
                  <div className="font-semibold text-[#F1F7FD]">{cov.source_title}</div>
                  <p className="text-[#AEC4D3] leading-relaxed">{cov.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =======================================================================
          SECTION 04 · FIVE-YEAR SYNTHETIC RESEARCH MATRIX PREVIEW
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#040B15] py-16 sm:py-24">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 space-y-8">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="max-w-3xl space-y-2.5">
              <span className="font-mono text-xs uppercase tracking-widest text-[#57D9A7]">
                {m.landing.section4.eyebrow}
              </span>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F1F7FD]">
                {m.landing.section4.title}
              </h2>
              <p className="text-sm text-[#AEC4D3]">{m.landing.section4.subtitle}</p>
            </div>

            <Link
              href="/farm/uppsala-demo/plans"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-[#57D9A7]/50 bg-[#0D2B2A] px-5 text-xs font-semibold text-[#57D9A7] transition hover:bg-[#143D3B]"
            >
              <span>{m.landing.section4.openPlansCta}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
            {[
              {
                id: 'SYNTH-POL-01',
                tag: 'Lowest Worst-State ET Shortfall',
                metric: '38,420.50 m³ eq',
                detail: 'Field F1 rainfed (142.50 mm dry deficit breaches 100 mm ceiling; conditional reference only).',
                border: 'border-[#72E4F1]/40',
                accent: 'text-[#72E4F1]',
              },
              {
                id: 'SYNTH-POL-02',
                tag: 'Minimax Regret Leader',
                metric: '640.25 m³ eq max regret',
                detail: 'Smallest disadvantage versus best tested plan in each state across the 11 comparable policies.',
                border: 'border-[#57D9A7]/40',
                accent: 'text-[#57D9A7]',
              },
              {
                id: 'SYNTH-POL-12',
                tag: 'Calendar Overlap Excluded',
                metric: 'Metrics: NULL (9 states)',
                detail: 'Excluded for overlapping sowing/harvest schedule on Field F3 Year 3; zero numeric distortion.',
                border: 'border-[#FF9299]/40',
                accent: 'text-[#FF9299]',
              },
            ].map((card) => (
              <div
                key={card.id}
                className={`rounded-2xl border ${card.border} bg-[#0A1828] p-5 space-y-2`}
              >
                <div className="flex items-center justify-between font-mono">
                  <span className={`font-bold ${card.accent}`}>{card.id}</span>
                  <span className="text-[11px] text-[#90A8BA]">{card.tag}</span>
                </div>
                <div className="font-mono text-base font-bold text-[#F1F7FD]">{card.metric}</div>
                <p className="text-[#AEC4D3] leading-relaxed">{card.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =======================================================================
          SECTION 05 · HONEST ABSTENTION & AUDITABLE EVIDENCE
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#06101D] py-16 sm:py-24">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 grid grid-cols-1 gap-8 lg:grid-cols-12 items-center">
          <div className="lg:col-span-6 space-y-4">
            <span className="font-mono text-xs uppercase tracking-widest text-[#FFCE7B]">
              {m.landing.section5.eyebrow}
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F1F7FD]">
              {m.landing.section5.title}
            </h2>
            <p className="text-sm text-[#AEC4D3] leading-relaxed">{m.landing.section5.subtitle}</p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/farm/uppsala-demo/decisions"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[#72E4F1] px-5 text-xs font-semibold text-[#061320] transition hover:bg-[#93EDF7]"
              >
                <span>{m.landing.section5.openDecisionsCta}</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <ViewEvidenceButton evidenceId="syn-ev-uppsala-water-assumption" siteId="uppsala-demo" />
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-[#FFCE7B]/45 bg-[#0A1828] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[#FF9299]/60 bg-[#2C141B] px-2.5 py-1 font-mono text-xs font-semibold text-[#FF9299]">
                <XOctagon className="w-3.5 h-3.5" />
                FIELD RECOMMENDATION: BLOCKED
              </span>
              <span className="font-mono text-xs text-[#DCC08A]">
                {synthSummary.universalPassPoliciesCount} / {synthSummary.totalPoliciesTested} Pass All{' '}
                {synthSummary.totalScenarioStates} States
              </span>
            </div>
            <p className="border-s-2 border-[#FFCE7B] ps-3.5 text-sm font-medium text-[#F1F7FD]">
              &ldquo;{m.banners.abstentionPrimary}&rdquo;
            </p>
            <div className="text-xs font-mono text-[#90A8BA]">
              {synthSummary.totalPolicyStateCases} synthetic evaluations ({synthSummary.numericPassCases} passes,{' '}
              {synthSummary.numericFailCases} dry-state breaches, {synthSummary.calendarInvalidCases} calendar exclusions)
            </div>
          </div>
        </div>
      </section>

      {/* =======================================================================
          SECTION 06 · BEGIN INVESTIGATION CTA
         ======================================================================= */}
      <section className="border-t border-white/[0.06] bg-[#040B15] py-16">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <span className="font-mono text-xs uppercase tracking-widest text-[#72E4F1]">
              {m.landing.section6.eyebrow}
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F1F7FD]">
              {m.landing.section6.title}
            </h2>
            <p className="text-sm text-[#AEC4D3]">{m.landing.section6.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/explore"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-[#72E4F1] px-6 text-sm font-semibold text-[#061320] transition hover:bg-[#93EDF7]"
            >
              <Globe2 className="w-4 h-4" />
              <span>{m.hero.ctaPrimary}</span>
            </Link>
            <Link
              href="/farm/new"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-[#0A1828] px-6 text-sm font-medium text-[#F1F7FD] transition hover:border-[#72E4F1]"
            >
              <ShieldCheck className="w-4 h-4 text-[#57D9A7]" />
              <span>{m.hero.ctaWizard}</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
