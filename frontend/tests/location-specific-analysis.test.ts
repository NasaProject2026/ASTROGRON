import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLocationAnalysisRequest,
  resolveDefaultLocationMode,
  resolveLocationPoint,
} from '@/lib/location-analysis-request';
import { buildResearchChartModel } from '@/components/research/research-charts-panel';
import type { CoreResult } from '@/domain/core-contracts';
import {
  GET as publicLocationGet,
  POST as publicLocationPost,
  registerPublicLocationAnalysisForTests,
  resetPublicLocationStateForTests,
} from '../app/api/public-location-analysis/route';

function makePostRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3002/api/public-location-analysis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: '127.0.0.1:3002',
      Origin: 'http://127.0.0.1:3002',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('Location-specific canonical request builder', () => {
  it('resolves Wagga Wagga and Nyeri presets to verified NASA cache grid centers without leaking fake data', () => {
    const wagga = resolveLocationPoint({
      siteKey: 'wagga-australia',
      label: 'Wagga Wagga, Australia',
      countryCode: 'AU',
      lon: 147.3598,
      lat: -35.1082,
    });
    expect(wagga.siteId).toBe('AU_WAGGA_REGION');
    expect(wagga.pointLonLat).toEqual([147.35, -35.05]);
    expect(wagga.usedCanonicalBenchmarkCenter).toBe(true);
    expect(wagga.hasCachedNasaPowerForcing).toBe(true);
    expect(resolveDefaultLocationMode(wagga)).toBe('conditional_water_counterfactual');

    const nyeri = resolveLocationPoint({
      siteKey: 'nyeri-kenya',
      label: 'Nyeri, Kenya',
      countryCode: 'KE',
      lon: 36.9476,
      lat: -0.4201,
    });
    expect(nyeri.siteId).toBe('KE_NYERI_REGION');
    expect(nyeri.pointLonLat).toEqual([36.95, -0.42]);
    expect(nyeri.hasCachedNasaPowerForcing).toBe(true);

    const builtAu = buildLocationAnalysisRequest({
      siteKey: 'wagga-australia',
      lon: 147.3598,
      lat: -35.1082,
    });
    const builtKe = buildLocationAnalysisRequest({
      siteKey: 'nyeri-kenya',
      lon: 36.9476,
      lat: -0.4201,
    });
    expect(builtAu.payload.farm_id).toBe('engineering-research-example');
    expect(builtKe.payload.farm_id).toBe('engineering-research-example');
    expect(JSON.stringify(builtAu.payload)).not.toBe(JSON.stringify(builtKe.payload));
  });

  it('preserves exact coordinates and defaults to strict_uncalibrated for Uppsala & custom locations', () => {
    const uppsala = buildLocationAnalysisRequest({
      siteKey: 'SE_UPPSALA',
      label: 'Uppsala <script>alert(1)</script>',
      countryCode: 'SE',
      lon: 17.65,
      lat: 59.82,
    });
    expect(uppsala.mode).toBe('strict_uncalibrated');
    expect(uppsala.resolvedLocation.pointLonLat).toEqual([17.65, 59.82]);
    const engineReq = uppsala.payload.engine_request as Record<string, unknown>;
    expect(engineReq.supply).toBeNull();
    expect(engineReq.crop_profiles).toEqual({});
    expect((engineReq.source as Record<string, unknown>).acquisition).toBe('CACHE_ONLY');

    const custom = buildLocationAnalysisRequest({
      label: 'Beauce <France>',
      countryCode: 'FR',
      lon: 1.489,
      lat: 48.4469,
    });
    expect(custom.resolvedLocation.pointLonLat).toEqual([1.489, 48.4469]);
    expect(JSON.stringify(custom.payload)).not.toContain('<');
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(() => resolveLocationPoint({ lon: 185, lat: 10 })).toThrow('INVALID_COORDINATES');
    expect(() => resolveLocationPoint({ lon: Number.NaN, lat: 10 })).toThrow('INVALID_COORDINATES');
  });
});

describe('ResearchChartsPanel model compatibility with WaterService & blocked results', () => {
  it('handles WaterService objectives missing scenarios arrays without throwing', () => {
    const waterResult: CoreResult = {
      status: 'CONDITIONAL_RESEARCH_COMPLETE',
      farm_id: 'engineering-research-example',
      run_id: 'run_water_1',
      decision: {
        status: 'CONDITIONAL_LEAST_VIOLATING',
        pareto_ids: ['p1', 'p2'],
        selected_ids: ['p1'],
        field_recommendation: null,
        objectives: [
          { policy_id: 'p1', worst_ET_m3_equivalent: '6485.07' },
          { policy_id: 'p2', worst_ET_m3_equivalent: '6485.07' },
        ],
      },
      alternatives: [
        { policy_id: 'p1', choices: { F1: ['c1', 'c1', 'c1', 'c1', 'c1'] } },
        { policy_id: 'p2', choices: { F1: ['c2', 'c1', 'c1', 'c1', 'c1'] } },
      ],
      qualification: {},
      warnings: [],
      missing_requirements: [],
      provenance: {},
      engine_result: { scientific_result_sha256: 'abc' },
      report_dto: { limitations: [], summary: '' },
    };

    const model = buildResearchChartModel(waterResult, '');
    expect(model.scenarios).toEqual([]);
    expect(model.cropLabels).toEqual([]);
    expect(model.leachingSeries.every((s) => s.values.length === 0)).toBe(true);
  });
});

describe('Public location analysis API security & isolation guards', () => {
  const originalFetch = global.fetch;
  let tokenFilePath = '';

  beforeAll(() => {
    tokenFilePath = path.join(os.tmpdir(), `astrogron-test-token-${process.pid}.txt`);
    fs.writeFileSync(tokenFilePath, 'test-operator-token-24-chars-long', 'utf8');
  });

  afterAll(() => {
    if (tokenFilePath) {
      fs.rmSync(tokenFilePath, { force: true });
    }
  });

  beforeEach(() => {
    resetPublicLocationStateForTests();
    process.env.ASTRAGRON_BACKEND_URL = 'http://127.0.0.1:8791';
    process.env.ASTRAGRON_BACKEND_ALLOWED_HOSTS = '127.0.0.1';
    process.env.ASTRAGRON_BACKEND_TOKEN_FILE = tokenFilePath;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects cross-origin POST, unknown override keys, and bad coordinates', async () => {
    const xOrigin = await publicLocationPost(
      makePostRequest({ lon: 147.35, lat: -35.05 }, { Origin: 'https://evil.example' })
    );
    expect(xOrigin.status).toBe(403);

    const extraKey = await publicLocationPost(
      makePostRequest({ lon: 147.35, lat: -35.05, farm_id: 'private-farm' })
    );
    expect(extraKey.status).toBe(422);
    expect(((await extraKey.json()) as { error: string }).error).toBe('PUBLIC_LOCATION_FIXED_ENVELOPE');

    const badCoord = await publicLocationPost(makePostRequest({ lon: -200, lat: 10 }));
    expect(badCoord.status).toBe(400);
    expect(((await badCoord.json()) as { error: string }).error).toBe('INVALID_COORDINATES');
  });

  it('denies reading arbitrary unregistered analysis IDs on GET', async () => {
    const res = await publicLocationGet(
      new Request('http://127.0.0.1:3002/api/public-location-analysis?analysisId=' + 'a'.repeat(32))
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('PUBLIC_ANALYSIS_NOT_FOUND');
  });

  it('enforces queue busy guard, submits canonical /v1/analyses, and streams registered PDF', async () => {
    // 1) Busy queue rejection
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          analyses: [{ state: 'pending' }, { state: 'running' }, { state: 'pending' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;

    const busyRes = await publicLocationPost(
      makePostRequest({ siteKey: 'wagga-australia', lon: 147.35, lat: -35.05 })
    );
    expect(busyRes.status).toBe(429);
    expect(((await busyRes.json()) as { error: string }).error).toBe('PUBLIC_QUEUE_BUSY');

    // 2) Successful submission + PDF streaming for registered analysis
    const aid = '1234567890abcdef1234567890abcdef';
    const pdfMock = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
    registerPublicLocationAnalysisForTests({
      analysisId: aid,
      createdAtMs: Date.now(),
      resolvedLocation: resolveLocationPoint({ siteKey: 'wagga-australia', lon: 147.35, lat: -35.05 }),
      mode: 'conditional_water_counterfactual',
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/pdf')) {
        return new Response(pdfMock, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
      }
      return new Response(JSON.stringify({ analyses: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const pdfRes = await publicLocationGet(
      new Request(`http://127.0.0.1:3002/api/public-location-analysis?analysisId=${aid}&download=pdf`)
    );
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('Content-Type')).toBe('application/pdf');
    expect(new Uint8Array(await pdfRes.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('enforces per-IP rate limit on repeated public submissions', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/v1/analyses')) {
        return new Response(
          JSON.stringify({ analysis_id: 'f'.repeat(32), state: 'pending' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ analyses: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) {
      const res = await publicLocationPost(
        makePostRequest(
          { lon: 147.35, lat: -35.05 },
          { 'x-forwarded-for': '203.0.113.55' }
        )
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 12).every((s) => s === 202)).toBe(true);
    expect(statuses[12]).toBe(429);
  });
});
