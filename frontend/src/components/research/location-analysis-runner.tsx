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
import type { ExplorerRegionSelection } from '@/lib/explorer-selection';
import {
  resolveDefaultLocationMode,
  resolveLocationPoint,
  type LocationAnalysisMode,
  type ResolvedLocationPoint,
} from '@/lib/location-analysis-request';

export interface WaterScenarioMetric {
  scenario_id?: string;
  status?: string;
  ET_shortfall_m3_equivalent?: string;
  source_withdrawal_m3?: string;
  worst_service_deficit_mm?: string;
  service_pass?: boolean;
  harvest_years?: number;
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
    pareto_ids?: string[];
    selected_ids?: string[];
    field_recommendation?: unknown;
    horizon_boundary?: string[];
    objectives?: Array<{
      policy_id: string;
      worst_ET_m3_equivalent?: string;
      worst_regret_m3_equivalent?: string;
      service_all_requested_scenarios?: boolean;
      worst_ET_scenarios?: string[];
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
    scenarios?: WaterScenarioMetric[];
  }>;
  engine_result?: {
    scientific_result_sha256?: string;
    location?: {
      site_id?: string;
      country?: string;
      jurisdiction?: string;
      point_lon_lat?: [number, number];
    } | null;
    scenario_sources?: unknown;
    global_coverage?: unknown;
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
    siteKey: 'wagga-australia',
    label: 'Wagga Wagga, Australia (AU_WAGGA_REGION)',
    countryCode: 'AU',
    regionName: 'Riverina, NSW, Australia',
    lon: 147.35,
    lat: -35.05,
    recommendedMode: 'conditional_water_counterfactual',
    badge: 'NASA Cache Ready · Conditional Water',
  },
  {
    siteKey: 'nyeri-kenya',
    label: 'Nyeri, Kenya (KE_NYERI_REGION)',
    countryCode: 'KE',
    regionName: 'Nyeri County, Central Kenya',
    lon: 36.95,
    lat: -0.42,
    recommendedMode: 'conditional_water_counterfactual',
    badge: 'NASA Cache Ready · Conditional Water',
  },
  {
    siteKey: 'uppsala-demo',
    label: 'Uppsala, Sweden (SE_UPPSALA)',
    countryCode: 'SE',
    regionName: 'Uppsala County, Sweden',
    lon: 17.65,
    lat: 59.82,
    recommendedMode: 'strict_uncalibrated',
    badge: 'Uncalibrated · Expected EVIDENCE_BLOCKED',
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
  walk(engineResult?.scenario_sources, 0);
  return [...found];
}

function buildLocationQaAnswer(
  question: string,
  response: PollResponse
): { answer: string; citations: string[] } {
  const { state, result, resolvedLocation, mode } = response;
  const rawHashes = result ? extractSourceRawHashes(result.provenance, result.engine_result) : [];
  const engineLoc = result?.engine_result?.location;
  const q = question.toLowerCase();

  if (q.includes('provenance') || q.includes('hash') || q.includes('coordinate')) {
    return {
      answer: [
        `Canonical analysis ${response.analysis_id} executed on D with request_sha256=${state.request_sha256 || result?.provenance?.request_sha256 || 'unavailable'}.`,
        `Submitted coordinates: [${resolvedLocation.pointLonLat[0]}, ${resolvedLocation.pointLonLat[1]}] (${engineLoc?.site_id || resolvedLocation.siteId}, ${engineLoc?.country || resolvedLocation.countryCode}).`,
        `Execution receipt: attempts=${state.attempts ?? 0}, execution_kind=${state.execution_kind ? state.execution_kind : 'live_execution'}, fresh_native_cases=${state.execution_receipt?.fresh_native_cases ?? 0}, verified_cache_replays=${state.execution_receipt?.verified_cache_replays ?? 0}.`,
        rawHashes.length > 0
          ? `NASA POWER offline raw SHA-256: ${rawHashes.join(', ')}.`
          : 'No verified offline NASA POWER raw source hash admitted for this run.',
      ].join('\n'),
      citations: ['state.request_sha256', 'state.execution_receipt', 'result.provenance.engine_provenance', 'result.engine_result.location'],
    };
  }

  if (q.includes('calibrated') || q.includes('recommend') || q.includes('advice')) {
    return {
      answer: [
        `No — field_agronomy_qualified=${String(Boolean(result?.qualification?.field_agronomy_qualified))}.`,
        result?.status === 'EVIDENCE_BLOCKED'
          ? `Canonical D returned EVIDENCE_BLOCKED (${result?.decision?.status || 'ABSTAIN_REQUIRED_EVIDENCE'}) because verified local soil, crop, winter, and hydraulic evidence are absent.`
          : `This ${mode} run evaluated generic uncalibrated FAO56 water-surrogate priors against local NASA POWER forcing and produced ${result?.decision?.status || 'CONDITIONAL_LEAST_VIOLATING'} under ${state.scientific_status || result?.status}. Do not use conditional research surrogates as field agronomic advice.`,
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
          `Status is ${result?.status || state.scientific_status} (${result?.decision?.status || state.decision_status}).`,
          reasons.length > 0 ? `Missing requirements reported by D:\n${reasons.join('\n')}` : 'No itemized missing_requirements returned.',
        ].join('\n'),
        citations: ['result.status', 'result.missing_requirements', 'result.warnings'],
      };
    }
    return {
      answer: `Status is ${result?.status || state.scientific_status} (${result?.decision?.status || state.decision_status}). Conditional warnings: ${(result?.warnings || []).join('; ') || 'see limitations'}.`,
      citations: ['result.status', 'result.decision.status', 'result.warnings'],
    };
  }

  // Default: water metrics & comparison summary
  if (!result || (result.alternatives || []).length === 0) {
    return {
      answer: `No alternative sequences were ranked because status is ${result?.status || state.scientific_status} (${result?.decision?.status || 'ABSTAIN_REQUIRED_EVIDENCE'}).`,
      citations: ['result.status', 'result.alternatives', 'result.missing_requirements'],
    };
  }

  const lines = (result.alternatives || []).map((alt, i) => {
    const obj = result.decision?.objectives?.find((o) => o.policy_id === alt.policy_id);
    const s0 = alt.scenarios?.[0];
    return `Alt ${i + 1} (${alt.policy_id.slice(0, 10)}): worst_ET_m3_eq=${obj?.worst_ET_m3_equivalent ?? s0?.ET_shortfall_m3_equivalent ?? 'n/a'} m3 eq., source_withdrawal=${s0?.source_withdrawal_m3 ?? 'n/a'} m3, service_pass=${String(s0?.service_pass ?? false)}.`;
  });

  return {
    answer: [
      `Computed WaterService counterfactual metrics for ${engineLoc?.site_id || resolvedLocation.siteId} [${resolvedLocation.pointLonLat[0]}, ${resolvedLocation.pointLonLat[1]}]:`,
      ...lines,
    ].join('\n'),
    citations: ['result.decision.objectives', 'result.alternatives[].scenarios', 'result.engine_result.scientific_result_sha256'],
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
  const [qaHistory, setQaHistory] = useState<Array<{ question: string; answer: string; citations: string[] }>>([]);
  const pollAbortRef = useRef<AbortController | null>(null);
  const waterChartRef = useRef<HTMLDivElement | null>(null);

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

  const waterChartRows = useMemo(() => {
    const res = runData?.result;
    if (!res || !Array.isArray(res.alternatives) || res.alternatives.length === 0) return [];
    return res.alternatives.map((alt, idx) => {
      const s0 = alt.scenarios?.[0];
      const obj = res.decision?.objectives?.find((o) => o.policy_id === alt.policy_id);
      const etShortfall = Number(obj?.worst_ET_m3_equivalent ?? s0?.ET_shortfall_m3_equivalent ?? 'NaN');
      const withdrawal = Number(s0?.source_withdrawal_m3 ?? 'NaN');
      return {
        label: `Alt ${idx + 1}`,
        policyId: alt.policy_id,
        etShortfall: Number.isFinite(etShortfall) ? Number(etShortfall.toFixed(2)) : null,
        withdrawal: Number.isFinite(withdrawal) ? Number(withdrawal.toFixed(2)) : null,
        deficitMm: s0?.worst_service_deficit_mm ?? null,
        servicePass: s0?.service_pass ?? false,
      };
    });
  }, [runData]);

  useEffect(() => {
    const el = waterChartRef.current;
    if (!el || waterChartRows.length === 0) return;
    if (waterChartRows.every((r) => r.etShortfall === null && r.withdrawal === null)) return;

    let cancelled = false;
    let chart: import('echarts').ECharts | null = null;
    let ro: ResizeObserver | null = null;

    async function renderChart() {
      try {
        const echarts = await import('echarts');
        if (cancelled || !waterChartRef.current) return;
        chart = echarts.init(waterChartRef.current);
        chart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: '#071524',
            borderColor: '#548299',
            textStyle: { color: '#F1F7FD', fontSize: 12 },
          },
          legend: {
            data: ['Worst ET Shortfall (m³ eq.)', 'Source Withdrawal (m³)'],
            textStyle: { color: '#AEC4D3', fontSize: 11 },
            top: 0,
          },
          grid: { left: 68, right: 16, top: 38, bottom: 32 },
          xAxis: {
            type: 'category',
            data: waterChartRows.map((r) => r.label),
            axisLabel: { color: '#AEC4D3', fontSize: 11 },
            axisLine: { lineStyle: { color: '#29455A' } },
          },
          yAxis: {
            type: 'value',
            name: 'm³',
            nameTextStyle: { color: '#72E4F1', fontSize: 10 },
            axisLabel: { color: '#90A8BA', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(41,69,90,0.45)' } },
          },
          series: [
            {
              name: 'Worst ET Shortfall (m³ eq.)',
              type: 'bar',
              barMaxWidth: 36,
              itemStyle: { color: '#FFCE7B', borderRadius: [5, 5, 0, 0] },
              data: waterChartRows.map((r) => r.etShortfall ?? 0),
            },
            {
              name: 'Source Withdrawal (m³)',
              type: 'bar',
              barMaxWidth: 36,
              itemStyle: { color: '#72E4F1', borderRadius: [5, 5, 0, 0] },
              data: waterChartRows.map((r) => r.withdrawal ?? 0),
            },
          ],
        });

        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => chart?.resize());
          ro.observe(waterChartRef.current);
        }
      } catch {
        // Ignore headless/canvas initialization limitations
      }
    }

    void renderChart();
    return () => {
      cancelled = true;
      ro?.disconnect();
      chart?.dispose();
    };
  }, [waterChartRows]);

  function selectBenchmark(b: (typeof QUICK_BENCHMARK_LOCATIONS)[number]) {
    setSiteKey(b.siteKey);
    setLabel(b.label);
    setCountryCode(b.countryCode);
    setRegionName(b.regionName);
    setLonInput(String(b.lon));
    setLatInput(String(b.lat));
    setMode(b.recommendedMode);
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
    setQaHistory([]);

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

      const deadline = Date.now() + 90_000;
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
          break;
        }
        await new Promise((r) => setTimeout(r, 750));
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Unable to execute location analysis.');
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
            <span>Live Per-Location Canonical Execution (/v1/analyses · Option B)</span>
          </div>
          <h2 id="live-location-runner-heading" className="text-xl font-semibold text-[#F1F7FD]">
            Analyze Selected Coordinates in the Real Scientific Backend
          </h2>
          <p className="max-w-3xl text-xs leading-relaxed text-[#AEC4D3]">
            Every submission sends your chosen coordinates through canonical{' '}
            <code className="font-mono text-[#72E4F1]">POST /v1/analyses</code> with strict offline provenance gates (
            <code className="font-mono text-[#72E4F1]">CACHE_ONLY</code> NASA POWER lookup, bounded 2-candidate research worker, no synthetic fabrication). Uncached or uncalibrated fields abstain honestly with{' '}
            <code className="font-mono text-[#FFCE7B]">EVIDENCE_BLOCKED</code>.
          </p>
        </div>
        <span className="rounded-full border border-[#548299]/60 bg-[#07111F] px-3 py-1 font-mono text-[11px] text-[#57D9A7]">
          Live Worker · execution_kind ≠ replay
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
          <span className="text-[#90A8BA]">Scientific Execution Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as LocationAnalysisMode)}
            data-testid="location-mode-select"
            className="w-full rounded-lg border border-[#29455A] bg-[#0A192A] px-3 py-2 text-xs text-[#F1F7FD]"
          >
            <option value="conditional_water_counterfactual">
              Conditional Water Counterfactual (FAO56 surrogate priors + NASA POWER cache)
            </option>
            <option value="strict_uncalibrated">
              Strict Field Qualification Check (absent soil/crop/supply → expected EVIDENCE_BLOCKED)
            </option>
          </select>
        </label>
      </div>

      {parsedCoords.resolved?.benchmarkNote && (
        <div className="rounded-xl border border-[#29455A] bg-[#07111F]/60 px-3 py-2 text-xs text-[#AEC4D3]">
          <span className="font-semibold text-[#72E4F1]">Coordinate Resolution: </span>
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
              ? 'Submitting /v1/analyses...'
              : polling
              ? 'Running canonical D worker...'
              : 'Run Live Location Analysis (/v1/analyses)'}
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
            <span>Download Real Analysis PDF</span>
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
                  Execution Receipt · {runData.resolvedLocation.siteId} [
                  {runData.resolvedLocation.pointLonLat[0]}, {runData.resolvedLocation.pointLonLat[1]}]
                </span>
              </div>
              <span className="rounded-full border border-[#548299]/60 px-2.5 py-0.5 font-mono text-[11px] text-[#72E4F1]">
                state: {terminalState.state}
              </span>
            </div>

            <div className="grid gap-2 pt-1 font-mono text-[11px] text-[#AEC4D3] sm:grid-cols-2">
              <div>analysis_id: {runData.analysis_id}</div>
              <div>run_id: {terminalState.run_id || 'pending'}</div>
              <div>request_sha256: {terminalState.request_sha256 || 'pending'}</div>
              <div>
                scientific_status: {terminalState.scientific_status || terminalResult?.status || 'pending'}
              </div>
              <div>
                decision_status:{' '}
                {terminalState.decision_status || terminalResult?.decision?.status || 'pending'}
              </div>
              <div>
                execution_kind:{' '}
                {terminalState.execution_kind
                  ? terminalState.execution_kind
                  : 'LIVE_WORKER_EXECUTION (fresh run)'}
              </div>
              <div>
                attempts={terminalState.attempts ?? 0} · fresh_native_cases=
                {terminalState.execution_receipt?.fresh_native_cases ?? 0} · verified_cache_replays=
                {terminalState.execution_receipt?.verified_cache_replays ?? 0}
              </div>
              <div>
                source_raw_sha256: {rawHashes[0] || (isBlocked ? 'none (blocked / uncached)' : 'pending')}
              </div>
            </div>
          </div>

          {/* Blocked Result */}
          {terminalResult && isBlocked && (
            <div
              data-testid="location-analysis-blocked"
              className="rounded-xl border border-[#FFCE7B]/60 bg-[#FFCE7B]/10 p-4 space-y-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#FFCE7B]" />
                <div>
                  <h3 className="text-sm font-semibold text-[#F1F7FD]">
                    EVIDENCE_BLOCKED · {terminalResult.decision?.status || 'ABSTAIN_REQUIRED_EVIDENCE'}
                  </h3>
                  <p className="text-xs text-[#E4CFA3]">
                    Canonical D refused to generate or extrapolate agronomic recommendations for [
                    {runData.resolvedLocation.pointLonLat[0]}, {runData.resolvedLocation.pointLonLat[1]}] without verified local evidence.
                  </p>
                </div>
              </div>

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

          {/* WaterService Results + Chart */}
          {terminalResult && !isBlocked && (terminalResult.alternatives || []).length > 0 && (
            <div data-testid="location-analysis-results" className="space-y-4">
              <div className="rounded-xl border border-[#FFCE7B]/50 bg-[#FFCE7B]/10 px-4 py-3 text-xs text-[#F5D89B]">
                <span className="font-semibold">Conditional Counterfactual Notice (USER_RESEARCH_ASSUMPTION · NOT_LOCALLY_CALIBRATED): </span>
                generic FAO56 water-surrogate crop and soil constants are held fixed while using verified NASA POWER forcing for{' '}
                <span className="font-mono">{terminalResult.engine_result?.location?.site_id || runData.resolvedLocation.siteId}</span>.{' '}
                Decision status: <span className="font-mono font-semibold">{terminalResult.decision?.status}</span>.
              </div>

              {waterChartRows.length > 0 && (
                <div className="rounded-xl border border-[#29455A] bg-[#07111F] p-4">
                  <div className="mb-2 text-xs font-semibold text-[#72E4F1]">
                    Five-Year Water Balance Shortfall &amp; Withdrawal by Counterfactual Alternative
                  </div>
                  <div ref={waterChartRef} className="h-[240px] w-full" />
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-[#29455A] bg-[#07111F]">
                <table className="w-full text-left text-xs text-[#AEC4D3]">
                  <thead className="border-b border-[#29455A] text-[11px] text-[#90A8BA]">
                    <tr>
                      <th className="px-3 py-2">Alternative</th>
                      <th className="px-3 py-2">5-Year Crop Surrogates (F1)</th>
                      <th className="px-3 py-2">Worst ET Shortfall</th>
                      <th className="px-3 py-2">Source Withdrawal</th>
                      <th className="px-3 py-2">Service Pass</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#29455A]/60">
                    {(terminalResult.alternatives || []).map((alt, i) => {
                      const row = waterChartRows[i];
                      const obj = terminalResult.decision?.objectives?.find(
                        (o) => o.policy_id === alt.policy_id
                      );
                      const s0 = alt.scenarios?.[0];
                      return (
                        <tr key={alt.policy_id}>
                          <td className="px-3 py-2 font-mono text-[#72E4F1]">
                            Alt {i + 1} ({alt.policy_id.slice(0, 8)})
                          </td>
                          <td className="px-3 py-2">
                            {(alt.choices?.F1 || []).map((c) => c.split(':').pop()).join(' → ')}
                          </td>
                          <td className="px-3 py-2 font-mono text-[#F1F7FD]">
                            {obj?.worst_ET_m3_equivalent ?? s0?.ET_shortfall_m3_equivalent ?? '—'} m³ eq.
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {s0?.source_withdrawal_m3 ?? '—'} m³
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {row?.servicePass ? 'PASS' : 'FAIL / VIOLATED'}
                          </td>
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
                  'What are the computed water metrics?',
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
