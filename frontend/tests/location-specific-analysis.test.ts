import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLocationAnalysisRequest,
  resolveDefaultLocationMode,
  resolveLocationPoint,
  type LocationAnalysisMode,
} from '@/lib/location-analysis-request';
import { buildWageningenProducingPayload } from '@/lib/wageningen-growth-request';
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
  it('routes Wageningen to the native growth_decision 5-year optimizer and matches canonical producing structure', () => {
    const wageningen = resolveLocationPoint({
      siteKey: 'nl-wageningen',
      label: 'Wageningen, Netherlands',
      countryCode: 'NL',
      lon: 5.67,
      lat: 51.97,
    });
    expect(wageningen.siteId).toBe('NL_WAGENINGEN_GROWTH');
    expect(wageningen.pointLonLat).toEqual([5.67, 51.97]);
    expect(wageningen.hasCachedNasaPowerForcing).toBe(true);
    expect(wageningen.cropRotationOptimizerQualified).toBe(true);
    expect(resolveDefaultLocationMode(wageningen)).toBe('wageningen_native_growth');

    const builtW = buildLocationAnalysisRequest({
      siteKey: 'nl-wageningen',
      lon: 5.67,
      lat: 51.97,
    });
    expect(builtW.mode).toBe('wageningen_native_growth');
    expect(builtW.payload.farm_id).toBe('NL_THREE_CROP_PRODUCING_RESEARCH');
    const engineReq = builtW.payload.engine_request as Record<string, unknown>;
    const growthDecision = builtW.payload.growth_decision as Record<string, unknown>;
    expect(growthDecision.profile_id).toBe('wageningen-three-crop-producing-research-v1');
    expect((growthDecision.rotation as Record<string, unknown>).mode).toBe('GENERATE');
    const soilMem = (engineReq.extensions as Record<string, unknown>).soil_memory as Record<string, unknown>;
    expect(soilMem.parameter_id).toBe('c0b5d4a67e48bdc6d8e3cb718147e2cec6f993aab10ce1e987aeb81312c4fae2');

    const growthFixturePath = path.resolve(
      'C:\\ASTROGRON\\ASTROGRON_TEAM_HANDOFF\\app\\core\\examples\\engine\\growth_producing.json'
    );
    if (fs.existsSync(growthFixturePath)) {
      const fixture = JSON.parse(fs.readFileSync(growthFixturePath, 'utf8')) as {
        farm_id: string;
        engine_request: { as_of: string };
      };
      expect(
        buildWageningenProducingPayload({
          farmId: fixture.farm_id,
          asOf: fixture.engine_request.as_of,
        })
      ).toEqual(fixture);
    }
  });

  it('resolves Wagga Wagga and Nyeri to verified NASA grid centers and defaults to strict_uncalibrated with zero surrogate fabrication', () => {
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
    expect(wagga.cropRotationOptimizerQualified).toBe(false);
    expect(resolveDefaultLocationMode(wagga)).toBe('strict_uncalibrated');

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
    expect(nyeri.cropRotationOptimizerQualified).toBe(false);
    expect(resolveDefaultLocationMode(nyeri)).toBe('strict_uncalibrated');

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
    expect(builtAu.mode).toBe('strict_uncalibrated');
    expect(builtKe.mode).toBe('strict_uncalibrated');

    const auEngine = builtAu.payload.engine_request as Record<string, unknown>;
    const keEngine = builtKe.payload.engine_request as Record<string, unknown>;
    for (const er of [auEngine, keEngine]) {
      expect(er.supply).toBeNull();
      expect(er.winter).toBeNull();
      expect(er.crop_profiles).toEqual({});
      expect(er.candidates).toEqual([]);
      expect(er.growth_decision).toBeUndefined();
      const f1 = (er.fields as Array<Record<string, unknown>>)[0];
      expect(f1?.soil).toBeNull();
    }
    expect(JSON.stringify(builtAu.payload)).not.toBe(JSON.stringify(builtKe.payload));
  });

  it('rejects forcing wageningen_native_growth outside Wageningen and rejects legacy surrogate mode', () => {
    expect(() =>
      buildLocationAnalysisRequest({
        lon: 36.95,
        lat: -0.42,
        mode: 'wageningen_native_growth',
      })
    ).toThrow('UNSUPPORTED_CROP_ROTATION_LOCATION');

    expect(() =>
      buildLocationAnalysisRequest({
        lon: 147.35,
        lat: -35.05,
        mode: 'wageningen_native_growth',
      })
    ).toThrow('UNSUPPORTED_CROP_ROTATION_LOCATION');

    expect(() =>
      buildLocationAnalysisRequest({
        lon: 147.35,
        lat: -35.05,
        mode: 'conditional_water_counterfactual' as unknown as LocationAnalysisMode,
      })
    ).toThrow('INVALID_ANALYSIS_MODE');
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
  it('handles growth_evaluation Pareto objectives cleanly in ResearchChartsPanel model builder', () => {
    const growthResult: CoreResult = {
      status: 'CONDITIONAL_RESEARCH_COMPLETE',
      farm_id: 'NL_THREE_CROP_PRODUCING_RESEARCH',
      run_id: 'run_growth_1',
      decision: {
        status: 'PARTIAL_COMPARISON_NO_OVERALL_VALUE_RANK',
        pareto_ids: ['p1', 'p2'],
        selected_ids: [],
        field_recommendation: null,
        objectives: [
          {
            policy_id: 'p1',
            scenarios: [
              {
                scenario_id: 'REFERENCE',
                N_leaching_kg_N_field: 50.83,
                crop_storage_DM_kg_field_by_crop: {
                  'research:NL:potato_Fontane': 18523.1,
                  'research:NL:spring_barley_301': 11859.9,
                  'research:NL:sugarbeet_601': 33131.6,
                },
              },
            ],
          },
        ],
      },
      alternatives: [
        {
          policy_id: 'p1',
          choices: {
            F1: [
              'research:NL:sugarbeet_601',
              'research:NL:spring_barley_301',
              'research:NL:potato_Fontane',
              'research:NL:spring_barley_301',
              'research:NL:sugarbeet_601',
            ],
          },
        },
      ],
      qualification: {},
      warnings: [],
      missing_requirements: [],
      provenance: {},
      engine_result: { scientific_result_sha256: 'abc' },
      report_dto: { limitations: [], summary: '' },
    };

    const model = buildResearchChartModel(growthResult, 'REFERENCE');
    expect(model.scenarios).toEqual(['REFERENCE']);
    expect(model.cropLabels.length).toBe(3);
    expect(model.leachingSeries[0]?.values[0]?.value).toBeCloseTo(50.83, 2);
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

  it('rejects cross-origin POST, unknown override keys, bad coordinates, unsupported crop rotation mode, and legacy surrogate mode', async () => {
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

    const unsupportedGrowth = await publicLocationPost(
      makePostRequest({ lon: 36.95, lat: -0.42, mode: 'wageningen_native_growth' })
    );
    expect(unsupportedGrowth.status).toBe(422);
    expect(((await unsupportedGrowth.json()) as { error: string }).error).toBe('UNSUPPORTED_CROP_ROTATION_LOCATION');

    const legacySurrogate = await publicLocationPost(
      makePostRequest({ lon: 147.35, lat: -35.05, mode: 'conditional_water_counterfactual' })
    );
    expect(legacySurrogate.status).toBe(422);
    expect(((await legacySurrogate.json()) as { error: string }).error).toBe('INVALID_ANALYSIS_MODE');
  });

  it('denies reading arbitrary unregistered analysis IDs on GET', async () => {
    const res = await publicLocationGet(
      new Request('http://127.0.0.1:3002/api/public-location-analysis?analysisId=' + 'a'.repeat(32))
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('PUBLIC_ANALYSIS_NOT_FOUND');
  });

  it('enforces queue busy guard, submits canonical /v1/analyses, projects growth_evaluation metrics, and streams registered PDF', async () => {
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

    // 2) Successful GET growth projection + PDF streaming for registered analysis
    const aid = '1234567890abcdef1234567890abcdef';
    const pdfMock = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4
    registerPublicLocationAnalysisForTests({
      analysisId: aid,
      createdAtMs: Date.now(),
      resolvedLocation: resolveLocationPoint({ siteKey: 'nl-wageningen', lon: 5.67, lat: 51.97 }),
      mode: 'wageningen_native_growth',
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/pdf')) {
        return new Response(pdfMock, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
      }
      if (url.endsWith('/result')) {
        return new Response(
          JSON.stringify({
            status: 'CONDITIONAL_RESEARCH_COMPLETE',
            farm_id: 'NL_THREE_CROP_PRODUCING_RESEARCH',
            run_id: 'run_w1',
            decision: {
              status: 'PARTIAL_COMPARISON_NO_OVERALL_VALUE_RANK',
              objectives: [{ policy_id: 'p1', scenarios: [{ scenario_id: 'REFERENCE', N_leaching_kg_N_field: 50.8 }] }],
            },
            alternatives: [{ policy_id: 'p1', choices: { F1: ['research:NL:potato_Fontane'] } }],
            engine_result: {
              scientific_result_sha256: 'hash1',
              execution: { physics_cases_executed: 6, rankings_executed: true },
              growth_evaluation: {
                candidate_generation: { mode: 'GENERATE', enumerated: 162, screen_rejected: 160, admitted: 2 },
              },
            },
            report_dto: { limitations: [], summary: 'ok' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ analysis_id: aid, state: 'complete' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const getRes = await publicLocationGet(
      new Request(`http://127.0.0.1:3002/api/public-location-analysis?analysisId=${aid}`)
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      result: {
        engine_result: {
          execution: { physics_cases_executed: number };
          growth_evaluation: { candidate_generation: { enumerated: number; admitted: number } };
        };
      };
    };
    expect(getBody.result.engine_result.execution.physics_cases_executed).toBe(6);
    expect(getBody.result.engine_result.growth_evaluation.candidate_generation.enumerated).toBe(162);
    expect(getBody.result.engine_result.growth_evaluation.candidate_generation.admitted).toBe(2);

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
