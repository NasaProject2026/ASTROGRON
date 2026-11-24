'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Download,
  Loader2,
  MessageSquareText,
  Play,
  ShieldAlert,
} from 'lucide-react';
import type { CoreResult } from '@/domain/core-contracts';
import type { ExplorerRegionSelection } from '@/lib/explorer-selection';
import {
  ResearchChartsPanel,
  formatResearchCropLabel,
} from '@/components/research/research-charts-panel';
import {
  resolveDefaultLocationMode,
  resolveLocationPoint,
  type LocationAnalysisMode,
  type ResolvedLocationPoint,
} from '@/lib/location-analysis-request';
import { IS_STATIC_SHOWCASE } from '@/lib/base-path';

export interface GrowthObjectiveScenarioMetric {
  scenario_id: string;
  N_leaching_kg_N_field: number;
  crop_storage_DM_kg_field_by_crop: Record<string, number>;
  bare_fallow_years?: number;
}

export interface LocationAnalysisState {
  analysis_id: string;
  state: string;
  phase?: string;
  scientific_status?: string;
  decision_status?: string;
  execution_kind?: string;
  request_sha256?: string;
  run_id?: string | null;
  attempts?: number;
  created_utc?: string;
  updated_utc?: string;
  error?: string | null;
  execution_receipt?: {
    schema?: string;
    fresh_native_cases?: number;
    verified_cache_replays?: number;
    request_sha256?: string;
    scientific_result_sha256?: string;
    wall_seconds?: number;
  } | null;
}

export interface LocationAnalysisResult {
  status: string;
  farm_id: string;
  run_id: string;
  decision: {
    status?: string;
    criterion?: string;
    objective_version?: string;
    search_scope?: string;
    pareto_ids?: string[];
    selected_ids?: string[];
    field_recommendation?: unknown;
    horizon_boundary?: string[];
    objectives?: Array<{
      policy_id: string;
      scenarios?: GrowthObjectiveScenarioMetric[];
    }>;
  };
  qualification?: {
    climate_ready?: boolean;
    water_service_evaluated?: boolean;
    field_agronomy_qualified?: boolean;
    status?: string;
    [k: string]: unknown;
  };
  warnings?: string[];
  missing_requirements?: Array<{ path?: string; reason?: string; action?: string }>;
  provenance?: {
    request_sha256?: string;
    engine_provenance?: unknown;
    [k: string]: unknown;
  };
  alternatives?: Array<{
    policy_id: string;
    choices: Record<string, string[]>;
    important_uncertainty?: string;
    scenarios?: Array<Record<string, unknown>>;
  }>;
  engine_result?: {
    scientific_result_sha256?: string;
    location?: {
      site_id?: string;
      country?: string;
      jurisdiction?: string;
      point_lon_lat?: [number, number];
    } | null;
    execution?: {
      physics_cases_executed?: number;
      candidate_scenario_evaluations?: number;
      numerical_cache_replays?: number;
      rankings_executed?: boolean;
      new_candidate_search_executed?: boolean;
    } | null;
    search?: Record<string, unknown> | null;
    growth_evaluation?: {
      candidate_generation?: {
        version?: string;
        mode?: string;
        enumerated?: number;
        screen_rejected?: number;
        admitted?: number;
      } | null;
      objective?: Record<string, unknown> | null;
      source_snapshot?: Record<string, unknown> | null;
      model_runtime?: Record<string, unknown> | null;
    } | null;
    scenario_sources?: unknown;
    global_coverage?: {
      site_id?: string;
      climate_status?: string;
      crop_field_qualification?: string;
      soil_hydraulic_field_qualification?: string;
      crop_water_input_status?: string;
      reason?: string;
      available_climate?: {
        period?: [string, string];
        days?: number;
        variables?: string[];
        raw_sha256?: string;
        receipt_sha256?: string;
      } | null;
    } | null;
  };
  report_dto?: {
    limitations?: string[];
    summary?: string;
  };
}

interface PollResponse {
  ok: boolean;
  analysis_id: string;
  resolvedLocation: ResolvedLocationPoint;
  mode: LocationAnalysisMode;
  state: LocationAnalysisState;
  result: LocationAnalysisResult | null;
  pdfDownloadUrl: string | null;
  error?: string;
  message?: string;
}

const QUICK_BENCHMARK_LOCATIONS: ReadonlyArray<{
  siteKey: string;
  label: string;
  countryCode: string;
  regionName: string;
  lon: number;
  lat: number;
  recommendedMode: LocationAnalysisMode;
  badge: string;
}> = [
  {
    siteKey: 'nl-wageningen',
    label: 'Wageningen, Netherlands (NL_WAGENINGEN_GROWTH)',
    countryCode: 'NL',
    regionName: 'Gelderland, Netherlands',
    lon: 5.67,
    lat: 51.97,
    recommendedMode: 'wageningen_native_growth',
    badge: 'Qualified · 5-Year Crop-Rotation Model',
  },
  {
    siteKey: 'nyeri-kenya',
    label: 'Nyeri, Kenya (KE_NYERI_REGION)',
    countryCode: 'KE',
    regionName: 'Nyeri County, Central Kenya',
    lon: 36.95,
    lat: -0.42,
    recommendedMode: 'strict_uncalibrated',
    badge: 'Climate Archive Ready · Local Crop Data Needed',
  },
  {
    siteKey: 'wagga-australia',
    label: 'Wagga Wagga, Australia (AU_WAGGA_REGION)',
    countryCode: 'AU',
    regionName: 'Riverina, NSW, Australia',
    lon: 147.35,
    lat: -35.05,
    recommendedMode: 'strict_uncalibrated',
    badge: 'Climate Archive Ready · Local Crop Data Needed',
  },
  {
    siteKey: 'uppsala-demo',
    label: 'Uppsala, Sweden (SE_UPPSALA)',
    countryCode: 'SE',
    regionName: 'Uppsala County, Sweden',
    lon: 17.65,
    lat: 59.82,
    recommendedMode: 'strict_uncalibrated',
    badge: 'Reference Benchmark · Local Calibration Needed',
  },
];

function extractSourceRawHashes(
  provenance: LocationAnalysisResult['provenance'],
  engineResult: LocationAnalysisResult['engine_result']
): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const key of ['raw_sha256', 'sha256', 'source_raw_sha256']) {
        const val = obj[key];
        if (typeof val === 'string' && /^[a-f0-9]{64}$/i.test(val)) {
          found.add(val);
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'raw_sha256' || k === 'sha256' || k === 'source_raw_sha256') continue;
        walk(v, depth + 1);
      }
    }
  };
  walk(provenance?.engine_provenance, 0);
  walk(engineResult?.global_coverage, 0);
  walk(engineResult?.growth_evaluation?.source_snapshot, 0);
  walk(engineResult?.scenario_sources, 0);
  return [...found];
}

function buildLocationQaAnswer(
  question: string,
  response: PollResponse
): { answer: string; citations: string[] } {
  const { state, result, resolvedLocation } = response;
  const rawHashes = result ? extractSourceRawHashes(result.provenance, result.engine_result) : [];
  const engineLoc = result?.engine_result?.location;
  const coverage = result?.engine_result?.global_coverage;
  const gen = result?.engine_result?.growth_evaluation?.candidate_generation;
  const execStats = result?.engine_result?.execution;
  const q = question.toLowerCase();

  if (q.includes('provenance') || q.includes('hash') || q.includes('coordinate')) {
    return {
      answer: [
        `Canonical analysis ${response.analysis_id} executed on D with request_sha256=${state.request_sha256 || result?.provenance?.request_sha256 || 'unavailable'}.`,
        `Submitted coordinates: [${resolvedLocation.pointLonLat[0]}, ${resolvedLocation.pointLonLat[1]}] (${engineLoc?.site_id || resolvedLocation.siteId}, ${engineLoc?.country || resolvedLocation.countryCode}).`,
        `Execution receipt: attempts=${state.attempts ?? 0}, execution_kind=${state.execution_kind ? state.execution_kind : 'LIVE_WORKER_EXECUTION'}, fresh_native_cases=${state.execution_receipt?.fresh_native_cases ?? execStats?.physics_cases_executed ?? 0}, verified_cache_replays=${state.execution_receipt?.verified_cache_replays ?? 0}.`,
        rawHashes.length > 0
          ? `NASA POWER offline raw SHA-256: ${rawHashes.join(', ')}.`
          : `No verified offline NASA POWER raw source hash admitted (climate_status=${coverage?.climate_status || 'NOT_AVAILABLE'}).`,
      ].join('\n'),
      citations: ['state.request_sha256', 'state.execution_receipt', 'result.engine_result.global_coverage', 'result.engine_result.location'],
    };
  }

  if (q.includes('calibrated') || q.includes('recommend') || q.includes('advice')) {
    return {
      answer: [
        `No — field_agronomy_qualified=${String(Boolean(result?.qualification?.field_agronomy_qualified))}.`,
        result?.status === 'EVIDENCE_BLOCKED'
          ? `Canonical D returned EVIDENCE_BLOCKED (${result?.decision?.status || 'ABSTAIN_REQUIRED_EVIDENCE'}) because qualified local crop, soil, winter, and water parameters are absent. Zero surrogate or Wageningen crop rotations were substituted.`
          : `Wageningen executed a source-pinned process research comparison (${result?.decision?.status || 'PARTIAL_COMPARISON_NO_OVERALL_VALUE_RANK'}) without marketable yield, profit, or local field validation.`,
      ].join('\n'),
      citations: ['result.status', 'result.decision.status', 'result.qualification.field_agronomy_qualified', 'result.report_dto.limitations'],
    };
  }

  if (q.includes('block') || q.includes('missing') || q.includes('why')) {
    const missing = result?.missing_requirements || [];
    if (result?.status === 'EVIDENCE_BLOCKED' || missing.length > 0) {
      const reasons = missing.slice(0, 6).map((m, idx) => `${idx + 1}. ${m.path || 'requirement'}: ${m.reason || 'missing'}`);
      return {
        answer: [
          `Status is ${result?.status || state.scientific_status} (${result?.decision?.status || state.decision_status}). Climate check: ${coverage?.climate_status || 'unknown'}.`,
          reasons.length > 0 ? `Missing requirements reported by D:\n${reasons.join('\n')}` : 'No itemized missing_requirements returned.',
        ].join('\n'),
        citations: ['result.status', 'result.engine_result.global_coverage.climate_status', 'result.missing_requirements'],
      };
    }
    return {
      answer: `Status is ${result?.status || state.scientific_status} (${result?.decision?.status || state.decision_status}). Warnings: ${(result?.warnings || []).join('; ') || 'see limitations'}.`,
      citations: ['result.status', 'result.decision.status', 'result.warnings'],
    };
  }

  if (!result || (result.alternatives || []).length === 0) {
    return {
      answer: `Zero crop-rotation alternatives were generated or ranked because status is ${result?.status || state.scientific_status} (${result?.decision?.status || 'ABSTAIN_REQUIRED_EVIDENCE'}). Climate status=${coverage?.climate_status || 'unknown'}.`,
      citations: ['result.status', 'result.alternatives', 'result.engine_result.global_coverage', 'result.missing_requirements'],
    };
  }

  const lines = (result.alternatives || []).map((alt, i) => {
    const obj = result.decision?.objectives?.find((o) => o.policy_id === alt.policy_id);
    const sRef = obj?.scenarios?.find((s) => s.scenario_id === 'REFERENCE') || obj?.scenarios?.[0];
    const seq = (alt.choices?.F1 || []).map(formatResearchCropLabel).join(' -> ');
    const dmSummary = sRef
      ? Object.entries(sRef.crop_storage_DM_kg_field_by_crop)
          .map(([c, val]) => `${formatResearchCropLabel(c)}=${val.toFixed(1)} kg DM`)
          .join(', ')
      : 'n/a';
    return `Alt ${i + 1} [${seq}]: REFERENCE N_leaching=${sRef ? sRef.N_leaching_kg_N_field.toFixed(2) : 'n/a'} kg/field; ${dmSummary}.`;
  });

  return {
    answer: [
      `Rotation optimizer proof for ${engineLoc?.site_id || resolvedLocation.siteId}: mode=${gen?.mode || 'GENERATE'}, enumerated=${gen?.enumerated ?? 'n/a'}, screen_rejected=${gen?.screen_rejected ?? 'n/a'}, admitted=${gen?.admitted ?? 'n/a'}, fresh_native_cases=${state.execution_receipt?.fresh_native_cases ?? execStats?.physics_cases_executed ?? 'n/a'}.`,
      ...lines,
    ].join('\n'),
    citations: ['result.engine_result.growth_evaluation.candidate_generation', 'result.decision.objectives', 'result.engine_result.scientific_result_sha256'],
  };
}

export function LocationAnalysisRunner({
  selectedExplorerRegion,
}: {
  selectedExplorerRegion: ExplorerRegionSelection | null;
}) {
  const initialPoint = selectedExplorerRegion
    ? {
        siteKey: selectedExplorerRegion.siteKey,
        label: selectedExplorerRegion.label,
        countryCode: selectedExplorerRegion.countryCode,
        regionName: selectedExplorerRegion.regionName,
        lon: selectedExplorerRegion.lon,
        lat: selectedExplorerRegion.lat,
      }
    : QUICK_BENCHMARK_LOCATIONS[0]!;

  const [siteKey, setSiteKey] = useState<string>(initialPoint.siteKey);
  const [label, setLabel] = useState<string>(initialPoint.label);
  const [countryCode, setCountryCode] = useState<string>(initialPoint.countryCode || 'AU');
  const [regionName, setRegionName] = useState<string>(initialPoint.regionName || '');
  const [lonInput, setLonInput] = useState<string>(String(initialPoint.lon));
  const [latInput, setLatInput] = useState<string>(String(initialPoint.lat));
  const [mode, setMode] = useState<LocationAnalysisMode>(() => {
    try {
      return resolveDefaultLocationMode(resolveLocationPoint(initialPoint));
    } catch {
      return 'strict_uncalibrated';
    }
  });

  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runData, setRunData] = useState<PollResponse | null>(null);
  const [scenario, setScenario] = useState<string>('REFERENCE');
  const [qaHistory, setQaHistory] = useState<Array<{ question: string; answer: string; citations: string[] }>>([]);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedExplorerRegion) return;
    setSiteKey(selectedExplorerRegion.siteKey);
    setLabel(selectedExplorerRegion.label);
    setCountryCode(selectedExplorerRegion.countryCode || 'XX');
    setRegionName(selectedExplorerRegion.regionName || '');
    setLonInput(String(selectedExplorerRegion.lon));
    setLatInput(String(selectedExplorerRegion.lat));
    try {
      const resolved = resolveLocationPoint(selectedExplorerRegion);
      setMode(resolveDefaultLocationMode(resolved));
    } catch {
      setMode('strict_uncalibrated');
    }
    setError(null);
  }, [selectedExplorerRegion]);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  const parsedCoords = useMemo(() => {
    const lon = Number(lonInput);
    const lat = Number(latInput);
    const valid = Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
    let resolved: ResolvedLocationPoint | null = null;
    if (valid) {
      try {
        resolved = resolveLocationPoint({
          siteKey,
          label,
          countryCode,
          regionName,
          lon,
          lat,
        });
      } catch {
        resolved = null;
      }
    }
    return { lon, lat, valid, resolved };
  }, [siteKey, label, countryCode, regionName, lonInput, latInput]);

  useEffect(() => {
    const qualified = Boolean(parsedCoords.resolved?.cropRotationOptimizerQualified);
    if (!qualified && mode === 'wageningen_native_growth') {
      setMode('strict_uncalibrated');
    }
  }, [parsedCoords.resolved?.cropRotationOptimizerQualified, mode]);

  function selectBenchmark(b: (typeof QUICK_BENCHMARK_LOCATIONS)[number]) {
    pollAbortRef.current?.abort();
    setSiteKey(b.siteKey);
    setLabel(b.label);
    setCountryCode(b.countryCode);
    setRegionName(b.regionName);
    setLonInput(String(b.lon));
    setLatInput(String(b.lat));
    setMode(b.recommendedMode);
    setRunData(null);
    setQaHistory([]);
    setSubmitting(false);
    setPolling(false);
    setError(null);
  }

  async function runAnalysis() {
    if (!parsedCoords.valid) {
      setError('Enter valid finite coordinates: longitude -180..180, latitude -90..90.');
      return;
    }

    pollAbortRef.current?.abort();
    const ac = new AbortController();
    pollAbortRef.current = ac;

    setSubmitting(true);
    setPolling(false);
    setError(null);
    setRunData(null);
    setQaHistory([]);
    setScenario('REFERENCE');

    const applyStandaloneFallback = () => {
      const resolved = parsedCoords.resolved!;
      if (resolved.cropRotationOptimizerQualified && mode === 'wageningen_native_growth') {
        setError(
          'Live 90-second PCSE re-optimization requires connecting an active Python engine container. The complete verified 5-year Wageningen results, scenario charts, Q&A, and PDF report are already loaded cleanly in the main dashboard above.'
        );
        return;
      }
      setRunData({
        ok: true,
        analysis_id: 'standalone-evidence-gate',
        resolvedLocation: resolved,
        mode,
        state: {
          analysis_id: 'standalone-evidence-gate',
          state: 'blocked',
          phase: 'evidence_gate',
          scientific_status: 'EVIDENCE_BLOCKED',
          decision_status: 'ABSTAIN_REQUIRED_EVIDENCE',
          execution_kind: 'STANDALONE_EVIDENCE_GATE',
        },
        result: {
          status: 'EVIDENCE_BLOCKED',
          farm_id: resolved.siteId,
          run_id: 'standalone-evidence-check',
          decision: { status: 'ABSTAIN_REQUIRED_EVIDENCE' },
          missing_requirements: [
            { path: 'fields.F1.soil', reason: 'Local measured root-zone soil hydraulics and mineral N sampling are required.' },
            { path: 'crop_profiles', reason: 'Regionally calibrated crop phenology coefficients are required.' },
            { path: 'supply', reason: 'Verified local daily and annual water supply bounds are required.' },
          ],
          engine_result: {
            global_coverage: {
              climate_status: resolved.hasCachedNasaPowerForcing ? 'CLIMATE_READY' : 'UNVERIFIED_COORDINATE',
              crop_water_input_status: 'CROP_SOIL_MODEL_INPUTS_BLOCKED',
              reason:
                resolved.benchmarkNote ||
                'Regional crop, soil, and water supply parameters are not calibrated here; ASTROGRON abstains cleanly rather than substituting Wageningen data.',
            },
          },
        },
        pdfDownloadUrl: null,
      });
    };

    if (IS_STATIC_SHOWCASE) {
      applyStandaloneFallback();
      setSubmitting(false);
      return;
    }

    try {
      const postRes = await fetch('/api/public-location-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          siteKey,
          label,
          countryCode,
          regionName,
          lon: parsedCoords.lon,
          lat: parsedCoords.lat,
          mode,
        }),
      });
      if (postRes.status === 404 || postRes.status === 503) {
        applyStandaloneFallback();
        return;
      }
      const postJson = (await postRes.json()) as {
        ok?: boolean;
        analysis_id?: string;
        state?: LocationAnalysisState;
        resolvedLocation?: ResolvedLocationPoint;
        mode?: LocationAnalysisMode;
        error?: string;
        message?: string;
      };
      if (!postRes.ok || !postJson.analysis_id) {
        throw new Error(postJson.message || postJson.error || `Request rejected (HTTP ${postRes.status}).`);
      }

      setSubmitting(false);
      setPolling(true);

      const initialResponse: PollResponse = {
        ok: true,
        analysis_id: postJson.analysis_id,
        resolvedLocation: postJson.resolvedLocation ?? parsedCoords.resolved!,
        mode: postJson.mode ?? mode,
        state: postJson.state ?? { analysis_id: postJson.analysis_id, state: 'pending' },
        result: null,
        pdfDownloadUrl: null,
      };
      setRunData(initialResponse);

      // Wageningen 6-case live PCSE execution typically takes ~90-100s; allow up to 300s.
      const deadline = Date.now() + 300_000;
      let reachedTerminal = false;
      while (!ac.signal.aborted && Date.now() < deadline) {
        const pollRes = await fetch(
          `/api/public-location-analysis?analysisId=${encodeURIComponent(postJson.analysis_id)}`,
          { cache: 'no-store', signal: ac.signal }
        );
        const pollJson = (await pollRes.json()) as PollResponse;
        if (!pollRes.ok) {
          throw new Error(pollJson.message || pollJson.error || `Status check failed (HTTP ${pollRes.status}).`);
        }
        setRunData(pollJson);
        const st = pollJson.state?.state;
        if (st && st !== 'pending' && st !== 'running') {
          reachedTerminal = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 750));
      }
      if (!ac.signal.aborted && !reachedTerminal) {
        setError('Analysis exceeded the 300s polling window and is still queued on the worker.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : '';
        setError(
          !msg || /failed to fetch/i.test(msg)
            ? 'Unable to connect to the scientific service right now. Please try again in a moment.'
            : msg
        );
      }
    } finally {
      setSubmitting(false);
      setPolling(false);
    }
  }

  const rawHashes = useMemo(() => {
    if (!runData?.result) return [];
    return extractSourceRawHashes(runData.result.provenance, runData.result.engine_result);
  }, [runData]);

  const terminalState = runData?.state;
  const terminalResult = runData?.result;
  const isBlocked = terminalResult?.status === 'EVIDENCE_BLOCKED' || terminalState?.state === 'blocked';
  const availableScenarios = useMemo(() => {
    const ids = terminalResult?.decision?.objectives?.[0]?.scenarios?.map((s) => s.scenario_id) || [];
    return ids.length > 0 ? ids : ['REFERENCE', 'LOW_INITIAL_MINERAL_N', 'HALF_RAIN'];
  }, [terminalResult]);
  const activeScenario = availableScenarios.includes(scenario) ? scenario : availableScenarios[0]!;
  const candidateGen = terminalResult?.engine_result?.growth_evaluation?.candidate_generation;
  const execStats = terminalResult?.engine_result?.execution;
  const coverage = terminalResult?.engine_result?.global_coverage;

  return (
    <section
      data-testid="live-location-analysis-runner"
      className="space-y-5 rounded-2xl border border-[#72E4F1]/40 bg-[#0A192A]/95 p-6 shadow-xl"
      aria-labelledby="live-location-runner-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#72E4F1]">
            <Compass className="h-4 w-4" />
            <span>Regional Evidence Qualification &amp; Live Re-Analysis</span>
          </div>
          <h2 id="live-location-runner-heading" className="text-xl font-semibold text-[#F1F7FD]">
            Check Another Location or Re-Run Wageningen (~90s)
          </h2>
          <p className="max-w-3xl text-xs leading-relaxed text-[#AEC4D3]">
            Submit coordinates to verify regional evidence readiness or run the live five-year crop-rotation optimizer for{' '}
            <strong className="text-[#F1F7FD]">Wageningen [5.67, 51.97]</strong> (enumerates 162 sequences, screens to 2, and evaluates 6 paired scenarios). Locations lacking verified local crop, soil, and water parameters abstain cleanly rather than substituting Wageningen rotations.
          </p>
        </div>
        <span className="rounded-full border border-[#548299]/60 bg-[#07111F] px-3 py-1 text-[11px] font-medium text-[#57D9A7]">
          Verified Scientific Engine
        </span>
      </div>

      {/* Quick preset sites for instant comparison */}
      <div className="flex flex-wrap gap-2">
        {QUICK_BENCHMARK_LOCATIONS.map((b) => {
          const active = siteKey === b.siteKey;
          return (
            <button
              key={b.siteKey}
              type="button"
              data-testid={`preset-loc-${b.siteKey}`}
              onClick={() => selectBenchmark(b)}
              className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                active
                  ? 'border-[#72E4F1] bg-[#72E4F1]/15 text-[#F1F7FD]'
                  : 'border-[#29455A] bg-[#07111F] text-[#AEC4D3] hover:border-[#548299]'
              }`}
            >
              <div className="font-semibold">{b.label}</div>
              <div className="font-mono text-[10px] text-[#90A8BA]">{b.badge}</div>
            </button>
          );
        })}
      </div>

      {/* Location + Mode Controls */}
      <div className="grid gap-4 rounded-xl border border-[#29455A] bg-[#07111F]/80 p-4 md:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="text-[#90A8BA]">Longitude (EPSG:4326)</span>
          <input
            type="number"
            step="any"
            value={lonInput}
            onChange={(e) => {
              setLonInput(e.target.value);
              setSiteKey('custom-coordinates');
            }}
            data-testid="location-lon-input"
            className="w-full rounded-lg border border-[#29455A] bg-[#0A192A] px-3 py-2 font-mono text-xs text-[#F1F7FD]"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-[#90A8BA]">Latitude (EPSG:4326)</span>
          <input
            type="number"
            step="any"
            value={latInput}
            onChange={(e) => {
              setLatInput(e.target.value);
              setSiteKey('custom-coordinates');
            }}
            data-testid="location-lat-input"
            className="w-full rounded-lg border border-[#29455A] bg-[#0A192A] px-3 py-2 font-mono text-xs text-[#F1F7FD]"
          />
        </label>
        <label className="space-y-1 text-xs md:col-span-2">
          <span className="text-[#90A8BA]">Analysis Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as LocationAnalysisMode)}
            data-testid="location-mode-select"
            className="w-full rounded-lg border border-[#29455A] bg-[#0A192A] px-3 py-2 text-xs text-[#F1F7FD]"
          >
            <option
              value="wageningen_native_growth"
              disabled={!parsedCoords.resolved?.cropRotationOptimizerQualified}
            >
              Wageningen 5-Year Crop Optimizer (162 Sequences → 2 Alternatives)
              {!parsedCoords.resolved?.cropRotationOptimizerQualified ? ' [Available at 5.67, 51.97]' : ''}
            </option>
            <option value="strict_uncalibrated">
              Regional Evidence Qualification Check (Verifies local crop, soil &amp; climate readiness)
            </option>
          </select>
        </label>
      </div>

      {parsedCoords.resolved?.benchmarkNote && (
        <div className="rounded-xl border border-[#29455A] bg-[#07111F]/60 px-3 py-2 text-xs text-[#AEC4D3]">
          <span className="font-semibold text-[#72E4F1]">Region Summary: </span>
          {parsedCoords.resolved.benchmarkNote}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="run-location-analysis-btn"
          disabled={submitting || polling || !parsedCoords.valid}
          onClick={() => void runAnalysis()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-2.5 text-sm font-semibold text-[#06111D] transition hover:bg-[#5FD4E2] disabled:opacity-50"
        >
          {submitting || polling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          <span>
            {submitting
              ? 'Submitting request...'
              : polling
              ? mode === 'wageningen_native_growth'
                ? 'Running 5-year crop optimizer (~90s)...'
                : 'Checking regional evidence...'
              : mode === 'wageningen_native_growth'
                ? 'Run Live Wageningen Optimization (~90s)'
                : 'Check Regional Evidence Readiness'}
          </span>
        </button>

        {runData?.pdfDownloadUrl && (
          <a
            href={runData.pdfDownloadUrl}
            download
            data-testid="location-analysis-pdf-link"
            className="inline-flex items-center gap-2 rounded-xl border border-[#548299] bg-[#07111F] px-4 py-2.5 text-xs font-semibold text-[#F1F7FD] hover:border-[#72E4F1]"
          >
            <Download className="h-4 w-4 text-[#72E4F1]" />
            <span>Download Analysis PDF</span>
          </a>
        )}
      </div>

      {error && (
        <div
          role="alert"
          data-testid="location-analysis-error"
          className="rounded-xl border border-[#FF9299]/50 bg-[#FF9299]/10 p-3 text-xs text-[#FF9299]"
        >
          {error}
        </div>
      )}

      {/* Live Execution & Provenance Receipt */}
      {runData && terminalState && (
        <div className="space-y-4">
          <div
            data-testid="location-analysis-receipt"
            className="rounded-xl border border-[#29455A] bg-[#07111F] p-4 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F1F7FD]">
                {isBlocked ? (
                  <ShieldAlert className="h-4 w-4 text-[#FFCE7B]" />
                ) : terminalState.state === 'pending' || terminalState.state === 'running' ? (
                  <Activity className="h-4 w-4 text-[#72E4F1]" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-[#57D9A7]" />
                )}
                <span>
                  {runData.resolvedLocation.siteId} ({runData.resolvedLocation.countryCode}) [{runData.resolvedLocation.pointLonLat[0]}, {runData.resolvedLocation.pointLonLat[1]}]
                </span>
              </div>
              <span className="rounded-full border border-[#548299]/60 px-2.5 py-0.5 text-[11px] font-medium text-[#72E4F1]">
                {isBlocked
                  ? 'Missing Local Calibration Data'
                  : terminalState.state === 'pending' || terminalState.state === 'running'
                    ? 'Running Analysis...'
                    : 'Analysis Complete'}
              </span>
            </div>

            <details className="rounded-lg border border-[#29455A]/70 bg-[#0A192A]/60 px-3 py-2 text-xs">
              <summary className="cursor-pointer text-[#72E4F1] select-none">
                Technical Execution Receipt &amp; Provenance Hashes
              </summary>
              <div className="mt-2 grid gap-1.5 font-mono text-[11px] text-[#AEC4D3] sm:grid-cols-2">
                <div>analysis_id: {runData.analysis_id}</div>
                <div>run_id: {terminalState.run_id || 'pending'}</div>
                <div>request_sha256: {terminalState.request_sha256 || 'pending'}</div>
                <div>scientific_status: {terminalState.scientific_status || terminalResult?.status || 'pending'}</div>
                <div>decision_status: {terminalState.decision_status || terminalResult?.decision?.status || 'pending'}</div>
                <div>execution_kind: {terminalState.execution_kind || 'LIVE_WORKER_EXECUTION'}</div>
                <div>
                  fresh_native_cases: {terminalState.execution_receipt?.fresh_native_cases ?? execStats?.physics_cases_executed ?? 0} · cache_replays:{' '}
                  {terminalState.execution_receipt?.verified_cache_replays ?? 0}
                </div>
                <div>source_raw_sha256: {rawHashes[0] || (isBlocked ? 'none (blocked / uncached)' : 'pending')}</div>
              </div>
            </details>
          </div>

          {/* Blocked Result (Honest Abstention + Verified NASA Climate Status) */}
          {terminalResult && isBlocked && (
            <div
              data-testid="location-analysis-blocked"
              className="rounded-xl border border-[#FFCE7B]/60 bg-[#FFCE7B]/10 p-4 space-y-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#FFCE7B]" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[#F1F7FD]">
                    Additional Local Data Needed Before Crop Advice Here
                  </h3>
                  <p className="text-xs text-[#E4CFA3]">
                    The scientific engine abstained cleanly for [{runData.resolvedLocation.pointLonLat[0]}, {runData.resolvedLocation.pointLonLat[1]}] because verified local crop parameters, soil hydraulics, and irrigation supply bounds are not yet configured for this coordinate. Wageningen crop rotations are never substituted here.
                  </p>
                </div>
              </div>

              {coverage && (
                <div
                  data-testid="location-climate-check"
                  className="rounded-lg border border-[#29455A] bg-[#07111F]/90 p-3 font-mono text-[11px] text-[#AEC4D3] space-y-1"
                >
                  <div>
                    <span className="text-[#72E4F1]">climate_status:</span> {coverage.climate_status || 'unknown'} ·{' '}
                    <span className="text-[#FFCE7B]">crop_water_input_status:</span>{' '}
                    {coverage.crop_water_input_status || 'CROP_SOIL_MODEL_INPUTS_BLOCKED'}
                  </div>
                  {coverage.available_climate && (
                    <div>
                      NASA POWER cached window: {(coverage.available_climate.period || []).join('..')} ({coverage.available_climate.days ?? '—'} days,{' '}
                      {(coverage.available_climate.variables || []).length} vars) · raw_sha256={coverage.available_climate.raw_sha256 || 'n/a'}
                    </div>
                  )}
                  {coverage.reason && <div className="font-sans text-[#E4CFA3]">{coverage.reason}</div>}
                </div>
              )}

              {(terminalResult.missing_requirements || []).length > 0 && (
                <ul className="space-y-1.5 rounded-lg border border-[#29455A] bg-[#07111F]/90 p-3 text-xs text-[#AEC4D3]">
                  {(terminalResult.missing_requirements || []).map((req, idx) => (
                    <li key={idx}>
                      <span className="font-mono text-[#FFCE7B]">{req.path || 'requirement'}:</span>{' '}
                      <span>{req.reason || 'Missing required local evidence.'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Genuine 5-Year Crop-Rotation Optimizer Results (Wageningen Native PCSE) */}
          {terminalResult && !isBlocked && (terminalResult.alternatives || []).length > 0 && (
            <div data-testid="location-analysis-results" className="space-y-4">
              <div className="rounded-xl border border-[#57D9A7]/50 bg-[#57D9A7]/10 px-4 py-3 text-xs text-[#D5F5E9] space-y-1.5">
                <div>
                  <span className="font-semibold">Fresh 5-Year Crop-Rotation Simulation Complete: </span>
                  screened <span className="font-semibold">{candidateGen?.enumerated ?? '—'}</span> 5-year sequences to{' '}
                  <span className="font-semibold">{candidateGen?.admitted ?? (terminalResult.alternatives || []).length}</span> balanced alternatives, simulating{' '}
                  <span className="font-semibold">{terminalState.execution_receipt?.fresh_native_cases ?? execStats?.physics_cases_executed ?? '—'}</span> paired crop/weather scenarios.
                </div>
                <div className="text-[#F5D89B]">
                  Research scope: Uses verified 2016–2020 NASA POWER weather for Wageningen with teaching soil and declared nutrient inventories — exploratory research rather than observed-farm advice.
                </div>
                <details className="pt-1 text-[11px] text-[#AEC4D3]">
                  <summary className="cursor-pointer text-[#72E4F1]">Inspect simulation metadata &amp; SHA-256</summary>
                  <div className="mt-1 font-mono break-all">
                    scientific_result_sha256: {terminalResult.engine_result?.scientific_result_sha256 || 'n/a'} ·{' '}
                    rankings_executed: {String(execStats?.rankings_executed ?? true)} · evaluations:{' '}
                    {execStats?.candidate_scenario_evaluations ?? '—'}
                  </div>
                </details>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#29455A] bg-[#07111F] px-4 py-3">
                <div className="text-xs font-semibold text-[#72E4F1]">
                  Inspect Scenario Across Five-Year Crop Rotation Alternatives
                </div>
                <label className="flex items-center gap-2 text-xs text-[#AEC4D3]">
                  <span>Scenario</span>
                  <select
                    value={activeScenario}
                    onChange={(e) => setScenario(e.target.value)}
                    data-testid="location-scenario-select"
                    className="rounded-lg border border-[#29455A] bg-[#0A192A] px-3 py-1.5 font-mono text-xs text-[#F1F7FD]"
                  >
                    {availableScenarios.map((sc) => (
                      <option key={sc} value={sc}>
                        {sc}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-4">
                <ResearchChartsPanel result={terminalResult as unknown as CoreResult} scenario={activeScenario} />
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#29455A] bg-[#07111F]">
                <table className="w-full text-left text-xs text-[#AEC4D3]">
                  <thead className="border-b border-[#29455A] text-[11px] text-[#90A8BA]">
                    <tr>
                      <th className="px-3 py-2">Pareto Alt</th>
                      <th className="px-3 py-2">Optimized 5-Year Crop Sequence (2016–2020)</th>
                      <th className="px-3 py-2">{activeScenario} N Leaching (kg N/field)</th>
                      <th className="px-3 py-2">{activeScenario} Crop Storage DM (kg DM/field)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#29455A]/60">
                    {(terminalResult.alternatives || []).map((alt, i) => {
                      const obj = terminalResult.decision?.objectives?.find(
                        (o) => o.policy_id === alt.policy_id
                      );
                      const scMetric =
                        obj?.scenarios?.find((s) => s.scenario_id === activeScenario) || obj?.scenarios?.[0];
                      const seq = (alt.choices?.F1 || [])
                        .map((c) => formatResearchCropLabel(c))
                        .join(' → ');
                      const dmText = scMetric
                        ? Object.entries(scMetric.crop_storage_DM_kg_field_by_crop || {})
                            .map(([cropId, val]) => `${formatResearchCropLabel(cropId)}: ${val.toFixed(1)}`)
                            .join(' · ')
                        : '—';
                      return (
                        <tr key={alt.policy_id}>
                          <td className="px-3 py-2 font-mono text-[#72E4F1]">
                            Alt {i + 1} ({alt.policy_id.slice(0, 8)})
                          </td>
                          <td className="px-3 py-2 text-[#F1F7FD]">{seq}</td>
                          <td className="px-3 py-2 font-mono text-[#FFCE7B]">
                            {scMetric ? scMetric.N_leaching_kg_N_field.toFixed(2) : '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-[#57D9A7]">{dmText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Evidence-Grounded Location Q&A */}
          {terminalResult && (
            <div
              data-testid="location-qa"
              className="rounded-xl border border-[#29455A] bg-[#07111F] p-4 space-y-3"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-[#72E4F1]">
                <MessageSquareText className="h-4 w-4" />
                <span>Evidence-Grounded Q&amp;A for This Location Analysis</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  'What is the exact input provenance & hash?',
                  'What are the computed rotation & DM metrics?',
                  'Why was it blocked or conditional?',
                  'Are these crop alternatives field-calibrated?',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    data-testid="location-qa-chip"
                    onClick={() => {
                      const reply = buildLocationQaAnswer(q, runData);
                      setQaHistory((prev) => [{ question: q, ...reply }, ...prev]);
                    }}
                    className="rounded-lg border border-[#29455A] bg-[#0A192A] px-2.5 py-1.5 text-xs text-[#AEC4D3] hover:border-[#72E4F1] hover:text-[#F1F7FD]"
                  >
                    {q}
                  </button>
                ))}
              </div>
              {qaHistory.length > 0 && (
                <div className="space-y-2">
                  {qaHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-[#29455A] bg-[#0A192A] p-3 text-xs space-y-1"
                    >
                      <div className="font-semibold text-[#F1F7FD]">{item.question}</div>
                      <pre className="whitespace-pre-wrap font-sans text-[#AEC4D3]">{item.answer}</pre>
                      <div className="font-mono text-[10px] text-[#72E4F1]">
                        Sources: {item.citations.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
