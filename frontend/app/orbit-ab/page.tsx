'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, FlaskConical, Globe2, ShieldAlert } from 'lucide-react';
import type { OrbitAbStatus } from '@/components/orbital/orbit-ab-stage';
import { useMessages } from '@/lib/i18n';

const OrbitAbStage = dynamic(
  () => import('@/components/orbital/orbit-ab-stage').then((mod) => mod.OrbitAbStage),
  { ssr: false }
);

export default function OrbitAbEvaluationPage() {
  const m = useMessages();
  const [forceFallback, setForceFallback] = useState(false);
  const [stageStatus, setStageStatus] = useState<OrbitAbStatus>('INITIALIZING');
  const [telemetry, setTelemetry] = useState({
    fps: 0,
    p95FrameMs: 0,
    droppedFrames: 0,
    satOccluded: false,
    landsatLoaded: false,
  });

  return (
    <div className="bg-[#030710] text-[#F1F7FD]">
      <section
        aria-labelledby="orbit-ab-hero-heading"
        className="relative isolate flex min-h-[calc(100vh-88px)] min-h-[620px] lg:min-h-[760px] w-full items-start md:items-center overflow-hidden bg-[#02050B]"
      >
        <OrbitAbStage
          forceFallback={forceFallback}
          onStatusChange={setStageStatus}
          onMetricsUpdate={(next) =>
            setTelemetry({
              fps: next.fps,
              p95FrameMs: next.p95FrameMs,
              droppedFrames: next.droppedFrames,
              satOccluded: next.satOccluded,
              landsatLoaded: next.landsatLoaded,
            })
          }
        />

        {/* Identical Editorial Hero Overlay for Fair A/B Comparison */}
        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 pt-9 pb-52 sm:px-8 sm:pt-14 md:py-20 lg:px-12">
          <div className="max-w-xl space-y-5 sm:space-y-6">
            <p className="font-mono text-[11px] sm:text-xs uppercase tracking-[0.22em] text-[#72E4F1]">
              {m.hero.eyebrow} · 3D A/B CANDIDATE
            </p>

            <h1
              id="orbit-ab-hero-heading"
              className="font-display hero-h1 text-[#F8FBFF] drop-shadow-[0_2px_24px_rgba(2,5,11,0.85)]"
            >
              {m.hero.headline}
            </h1>

            <p className="max-w-lg text-sm sm:text-base md:text-lg leading-relaxed text-[#D8E5F0]">
              {m.hero.subcopy}
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <Link
                href="/explore"
                className="inline-flex h-12 sm:h-13 items-center justify-center gap-2.5 rounded-full bg-[#72E4F1] px-7 text-sm sm:text-base font-semibold text-[#061320] shadow-[0_8px_32px_rgba(114,228,241,0.28)] transition hover:bg-[#93EDF7]"
              >
                <Globe2 className="w-4 h-4 shrink-0" />
                <span>{m.hero.ctaPrimary}</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Link>

              <Link
                href="/"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-[#548299]/70 bg-[#081728]/80 px-4 text-sm font-medium text-[#D8E5F0] transition hover:border-[#72E4F1] hover:text-[#72E4F1]"
              >
                <FlaskConical className="w-4 h-4 text-[#72E4F1] shrink-0" />
                <span>Compare Default Editorial Hero</span>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setForceFallback((v) => !v)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#29455A] bg-[#081728]/85 px-3 py-1.5 font-mono text-xs text-[#AEC4D3] hover:border-[#72E4F1] cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-[#FFCE7B]" />
                <span>
                  {forceFallback ? 'Resume WebGL 3D Stage' : 'Test Fallback to Static Artwork'}
                </span>
              </button>
              <span
                data-testid="orbit-ab-telemetry-pill"
                className="rounded-lg border border-[#29455A] bg-[#081728]/85 px-3 py-2 font-mono text-[11px] text-[#90A8BA]"
              >
                {stageStatus} · {telemetry.fps} FPS · p95 {telemetry.p95FrameMs}ms · Landsat 8 GLB:{' '}
                {telemetry.landsatLoaded ? 'YES' : 'PLACEHOLDER'} · Occluded:{' '}
                {telemetry.satOccluded ? 'YES' : 'NO'}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
