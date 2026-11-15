// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { CoreResult } from '@/domain/core-contracts';
import {
  buildResearchDemoHref,
  parseResearchSelectionFromUrl,
} from '@/lib/explorer-selection';
import {
  buildResearchChartModel,
  formatResearchCropLabel,
} from '@/components/research/research-charts-panel';
import {
  GET,
  POST,
  resetPublicDemoRateLimitForTests,
} from '../app/api/public-demo/route';

function makeSampleResearchResult(): CoreResult {
  return {
    status: 'COMPLETE_RESEARCH',
    farm_id: 'NL_THREE_CROP_PRODUCING_RESEARCH',
    run_id: 'b19df865f997d535390558c6d707be37c530d83171509dd73a2997c57305820e',
    decision: {
      pareto_ids: ['P01', 'P02'],
      selected_ids: ['P01'],
      field_recommendation: null,
      objectives: [
        {
          policy_id: 'P01',
          scenarios: [
            {
              scenario_id: 'REFERENCE',
              N_leaching_kg_N_field: 38.9,
              crop_storage_DM_kg_field_by_crop: {
                'research:NL:potato_Fontane': 18500,
                'research:NL:sugarbeet_601': 24200,
                'research:NL:spring_barley_301': 6100,
              },
            },
            {
              scenario_id: 'HALF_RAIN',
              N_leaching_kg_N_field: 14.2,
              crop_storage_DM_kg_field_by_crop: {
                'research:NL:potato_Fontane': 14200,
                'research:NL:sugarbeet_601': 19800,
                'research:NL:spring_barley_301': 4950,
              },
            },
          ],
        },
        {
          policy_id: 'P02',
          scenarios: [
            {
              scenario_id: 'REFERENCE',
              N_leaching_kg_N_field: 37.48,
              crop_storage_DM_kg_field_by_crop: {
                'research:NL:potato_Fontane': 18100,
                'research:NL:sugarbeet_601': 24600,
                'research:NL:spring_barley_301': 6050,
              },
            },
            {
              scenario_id: 'HALF_RAIN',
              N_leaching_kg_N_field: 13.7,
              crop_storage_DM_kg_field_by_crop: {
                'research:NL:potato_Fontane': 13900,
                'research:NL:sugarbeet_601': 20100,
                'research:NL:spring_barley_301': 4900,
              },
            },
          ],
        },
      ],
    },
    alternatives: [],
    qualification: {},
    warnings: [],
    missing_requirements: [],
    provenance: {},
    engine_result: {
      scientific_result_sha256:
        'f812c32e72693cbf8b8da6e08f6f6a50d4a5de936133c85d999fa976edc44b08',
    },
    report_dto: { limitations: [], summary: null },
  };
}

function makePublicDemoPost(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request('http://127.0.0.1:3001/api/public-demo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: '127.0.0.1:3001',
      Origin: 'http://127.0.0.1:3001',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('Research dashboard charts & Explorer selection helpers', () => {
  it('keeps crops separated in buildResearchChartModel and updates values on scenario switch', () => {
    const sample = makeSampleResearchResult();

    const refModel = buildResearchChartModel(sample, 'REFERENCE');
    expect(refModel.activeScenario).toBe('REFERENCE');
    expect(refModel.scenarios).toEqual(['REFERENCE', 'HALF_RAIN']);
    expect(refModel.cropLabels).toEqual(['Potato (Fontane)', 'Sugar beet', 'Spring barley']);
    expect(refModel.cropDmSeries[0]?.values).toEqual([18500, 24200, 6100]);
    expect(refModel.activeLeachingSummary).toEqual([
      { label: 'Alt 1', valueKg: 38.9 },
      { label: 'Alt 2', valueKg: 37.48 },
    ]);

    const halfRainModel = buildResearchChartModel(sample, 'HALF_RAIN');
    expect(halfRainModel.activeScenario).toBe('HALF_RAIN');
    expect(halfRainModel.cropDmSeries[0]?.values).toEqual([14200, 19800, 4950]);
    expect(halfRainModel.activeLeachingSummary).toEqual([
      { label: 'Alt 1', valueKg: 14.2 },
      { label: 'Alt 2', valueKg: 13.7 },
    ]);
    expect(formatResearchCropLabel('research:NL:sugarbeet_601')).toBe('Sugar beet');
  });

  it('round-trips Explorer location context without accepting out-of-range coordinates', () => {
    const href = buildResearchDemoHref({
      siteKey: 'nyeri-kenya',
      label: 'Nyeri Highland Smallholder Benchmark',
      lon: 36.9476,
      lat: -0.4201,
      countryCode: 'KE',
      regionName: 'Central Highlands, Kenya',
    });
    const parsed = parseResearchSelectionFromUrl(href.split('?')[1] || '');
    expect(parsed).not.toBeNull();
    expect(parsed?.siteKey).toBe('nyeri-kenya');
    expect(parsed?.countryCode).toBe('KE');
    expect(parsed?.lon).toBeCloseTo(36.9476, 4);
    expect(parsed?.lat).toBeCloseTo(-0.4201, 4);

    expect(parseResearchSelectionFromUrl('selectedSite=bad&label=X&lon=199&lat=0')).toBeNull();
    expect(parseResearchSelectionFromUrl('selectedSite=bad&label=X&lon=0&lat=-95')).toBeNull();
  });
});

describe('Public demo API route fail-closed guards', () => {
  beforeEach(() => {
    resetPublicDemoRateLimitForTests();
  });

  it('rejects arbitrary query parameters on GET /api/public-demo', async () => {
    const res = await GET(new Request('http://127.0.0.1:3001/api/public-demo?lat=59.8&lon=17.6'));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('INVALID_PUBLIC_DEMO_QUERY');
  });

  it('enforces same-origin on POST /api/public-demo', async () => {
    const res = await POST(
      makePublicDemoPost(
        { question: 'Explain water' },
        { Origin: 'https://untrusted.example' }
      )
    );
    expect(res.status).toBe(403);
  });

  it('rejects location/farm overrides with 422 PUBLIC_DEMO_FIXED_CASE_ONLY', async () => {
    const res = await POST(
      makePublicDemoPost({
        question: 'Explain water',
        lon: 36.95,
        lat: -0.42,
      })
    );
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('PUBLIC_DEMO_FIXED_CASE_ONLY');
  });

  it('blocks what-if job creation in read-only public chat', async () => {
    const res = await POST(
      makePublicDemoPost({
        question: 'What if rainfall decreases by 20%?',
        scenario: 'REFERENCE',
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { mode?: string; reason_code?: string; readOnly?: boolean };
    expect(json.readOnly).toBe(true);
    expect(json.mode).toBe('READ_ONLY_PUBLIC_DEMO_GUARD');
    expect(json.reason_code).toBe('PUBLIC_JOB_SUBMISSION_DISABLED');
  });

  it('refuses to misattribute cached Wageningen results to unrelated selected locations', async () => {
    const res = await POST(
      makePublicDemoPost({
        question: 'Does this analysis apply to my selected location in Nyeri, Kenya?',
        scenario: 'REFERENCE',
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      mode?: string;
      reason_code?: string;
      answer?: string;
    };
    expect(json.mode).toBe('PUBLIC_DEMO_CACHED_CASE_SCOPE_NOTICE');
    expect(json.reason_code).toBe('UNRELATED_SELECTED_LOCATION');
    expect(json.answer).toContain('Wageningen');
  });
});
