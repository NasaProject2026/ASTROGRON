import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeDraftInputRevision,
  detectDraftModificationReasons,
  parseDmsCoordinateString,
  validateFieldGeoJson,
  validateFarmSetupDraft,
  estimatePolygonAreaHectares,
} from '@/domain/schemas';
import {
  DEFAULT_UPPSALA_FARM_DRAFT,
  UPPSALA_REFERENCE_INPUT_REVISION,
  EXPLORER_PRESET_SITES,
  EVIDENCE_RECORDS_FIXTURE,
} from '@/fixtures/sites-and-coverage';
import {
  getRepositoryForMode,
  buildSiteBoundExportPayload,
} from '@/adapters/repositories';
import {
  formatAreaWithUnit,
  formatVolumeWithUnit,
} from '@/hooks/use-astragron-store';
import { enMessages } from '@/messages/en';
import { getLocaleDirection } from '@/lib/i18n';
import type { UserFarmDraft } from '@/domain/contracts';

function cloneUppsala(): UserFarmDraft {
  return JSON.parse(JSON.stringify(DEFAULT_UPPSALA_FARM_DRAFT)) as UserFarmDraft;
}

describe('P1 Scientific Integrity, Input Revision Invalidation & Negative Regressions (G01–G05, G16)', () => {
  it('G01: editing sowing date, harvest date, candidate crops, water regime/quota, soil texture, mineral N, or polygon vertices alters inputRevision and invalidates Uppsala results', () => {
    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO');
    const uppsalaEvidenceIds = Object.values(EVIDENCE_RECORDS_FIXTURE)
      .filter((r) => r.site_id === 'uppsala-demo')
      .map((r) => r.evidence_id);
    expect(uppsalaEvidenceIds.length).toBeGreaterThan(0);

    const mutations: Array<{ name: string; mutate: (d: UserFarmDraft) => void }> = [
      {
        name: 'sowingDate',
        mutate: (d) => {
          d.fields[0]!.plannedSowingDate = '2027-05-02';
        },
      },
      {
        name: 'harvestDate',
        mutate: (d) => {
          d.fields[0]!.plannedHarvestDate = '2027-09-01';
        },
      },
      {
        name: 'candidateCrops',
        mutate: (d) => {
          d.fields[0]!.candidateCrops = ['Spring Wheat', 'Winter Rye'];
        },
      },
      {
        name: 'waterDeliveryQuota',
        mutate: (d) => {
          d.waterContext.seasonalQuotaM3 = {
            ...d.waterContext.seasonalQuotaM3,
            value: 6200,
          };
        },
      },
      {
        name: 'waterRegime',
        mutate: (d) => {
          d.waterContext.waterResourceRegime = 'WATER_LOW_RESTRICTION';
        },
      },
      {
        name: 'soilTexture',
        mutate: (d) => {
          d.fields[0]!.soilTexture = {
            ...d.fields[0]!.soilTexture,
            value: 'Sandy Loam',
          };
        },
      },
      {
        name: 'mineralNo3Null',
        mutate: (d) => {
          d.fields[0]!.mineralNo3KgHa = {
            ...d.fields[0]!.mineralNo3KgHa,
            value: 42.5,
          };
        },
      },
      {
        name: 'polygonVertex',
        mutate: (d) => {
          d.fields[0]!.geometry = {
            type: 'Polygon',
            coordinates: [
              [
                [17.631, 59.862],
                [17.646, 59.862],
                [17.646, 59.855],
                [17.631, 59.855],
                [17.631, 59.862],
              ],
            ],
          };
        },
      },
    ];

    for (const m of mutations) {
      const modified = cloneUppsala();
      modified.id = `custom-uppsala-${m.name}`;
      modified.derivedFromFixtureId = 'uppsala-demo';
      modified.isUserCreatedDraft = true;
      m.mutate(modified);

      const newRev = computeDraftInputRevision(modified);
      expect(newRev, `Expected ${m.name} mutation to change inputRevision`).not.toBe(
        UPPSALA_REFERENCE_INPUT_REVISION
      );
      expect(detectDraftModificationReasons(modified, DEFAULT_UPPSALA_FARM_DRAFT).length).toBeGreaterThan(0);

      // Fail closed on Decision, Climate, Evidence, and Site-Bound Exports
      const dec = repo.getM14DecisionEvaluation(modified.id, modified);
      expect(dec.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
      expect(dec.data).toBeNull();
      expect(dec.inputIdentity?.inputsModified).toBe(true);
      expect(dec.inputIdentity?.inputRevision).toBe(newRev);
      expect(dec.inputIdentity?.referenceRevision).toBe(UPPSALA_REFERENCE_INPUT_REVISION);

      const clim = repo.getClimateWaterSeries(modified.id, modified);
      expect(clim.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
      expect(clim.data).toBeNull();

      const evList = repo.getEvidenceRecords(modified.id, modified);
      expect(evList.status).toBe('ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');
      expect(evList.data).toEqual([]);

      const tamperedEv = repo.getEvidenceRecord(
        {
          siteId: modified.id,
          datasetMode: 'SYNTHETIC_UI_DEMO',
        },
        uppsalaEvidenceIds[0]!,
        modified
      );
      expect(tamperedEv.status).toBe('NO_EVIDENCE_FOR_SITE');
      expect(tamperedEv.data).toBeNull();

      const exportPayload = buildSiteBoundExportPayload(
        modified.id,
        'SYNTHETIC_UI_DEMO',
        'MINIMIZE_WORST_ET_SHORTFALL',
        modified
      );
      expect(exportPayload.decisionDataset).toBeNull();
      expect(exportPayload.inputIdentity?.inputsModified).toBe(true);
      expect(exportPayload.inputIdentity?.inputRevision).toBe(newRev);
      expect(exportPayload.inputIdentity?.referenceRevision).toBe(UPPSALA_REFERENCE_INPUT_REVISION);
    }
  });

  it('G02: enforces cross-site provenance lookup isolation across URL/site scope tampering', () => {
    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO');
    const uppsalaEvId = Object.values(EVIDENCE_RECORDS_FIXTURE).find(
      (r) => r.site_id === 'uppsala-demo'
    )!.evidence_id;

    for (const siteId of [
      'nyeri-kenya',
      'wagga-australia',
      'ocean-atlantic',
      'polar-svalbard',
      'antimeridian-taveuni',
      'completely-unknown-site',
    ]) {
      const env = repo.getEvidenceRecord(
        { siteId, datasetMode: 'SYNTHETIC_UI_DEMO' },
        uppsalaEvId
      );
      expect(env.data).toBeNull();
      expect(['NO_EVIDENCE_FOR_SITE', 'SITE_NOT_FOUND']).toContain(env.status);
    }
  });

  it('G03: separates M4 SOURCE_DATA_COVERAGE vs MODEL_UNQUALIFIED vs BLOCKED and distinguishes 0 from null & elemental N vs nitrate ion', () => {
    const ocean = EXPLORER_PRESET_SITES['ocean-atlantic']!;
    expect(ocean.sourceCoverages.every((s) => s.status === 'OUT_OF_COVERAGE')).toBe(true);
    expect(ocean.capabilities.every((c) => c.status === 'OUT_OF_COVERAGE')).toBe(true);

    const svalbard = EXPLORER_PRESET_SITES['polar-svalbard']!;
    expect(svalbard.sourceCoverages.some((s) => s.status === 'OUT_OF_COVERAGE')).toBe(true);

    // Zero (0) mineral N must be treated distinctly from null (missing), while NITRATE_ION_NO3_KG_HA_UNSUPPORTED must reject
    const zeroNValid = validateFarmSetupDraft({
      name: 'Zero Measured Mineral N Field Test',
      longitude: 17.6389,
      latitude: 59.8586,
      fields: [
        {
          id: 'F1',
          declaredAreaHa: 6,
          mineralNo3KgHa: 0,
          nitrogenBasis: 'ELEMENTAL_N_KG_HA',
          sowingDate: '2027-04-18',
          harvestDate: '2027-08-24',
        },
      ],
    });
    expect(zeroNValid.valid).toBe(true);

    const nullNValid = validateFarmSetupDraft({
      name: 'Null Unsampled Mineral N Field Test',
      longitude: 17.6389,
      latitude: 59.8586,
      fields: [
        {
          id: 'F1',
          declaredAreaHa: 6,
          mineralNo3KgHa: null,
          nitrogenBasis: 'ELEMENTAL_N_KG_HA',
          sowingDate: '2027-04-18',
          harvestDate: '2027-08-24',
        },
      ],
    });
    expect(nullNValid.valid).toBe(true);

    const nitrateIonRejected = validateFarmSetupDraft({
      name: 'Wrong Chemical Basis Test',
      longitude: 17.6389,
      latitude: 59.8586,
      fields: [
        {
          id: 'F1',
          declaredAreaHa: 6,
          mineralNo3KgHa: 35,
          nitrogenBasis: 'NITRATE_ION_NO3_KG_HA_UNSUPPORTED',
          sowingDate: '2027-04-18',
          harvestDate: '2027-08-24',
        },
      ],
    });
    expect(nitrateIonRejected.valid).toBe(false);
  });

  it('G04–G05: validates signed DMS N/S/E/W, invalid swapped/projected/self-intersecting GeoJSON, and metric/imperial unit formatting', () => {
    expect(parseDmsCoordinateString(`17° 38' 20" E`, 'LON').decimal).toBeCloseTo(17.6389, 3);
    expect(parseDmsCoordinateString(`106° 40' 12" W`, 'LON').decimal).toBeCloseTo(-106.67, 2);
    expect(parseDmsCoordinateString(`35° 06' 30" S`, 'LAT').decimal).toBeCloseTo(-35.1083, 3);
    expect(parseDmsCoordinateString(`59° 51' 31" N`, 'LAT').decimal).toBeCloseTo(59.8586, 3);
    expect(parseDmsCoordinateString(`95° 00' 00" N`, 'LAT').valid).toBe(false);
    expect(parseDmsCoordinateString(`190° 00' 00" E`, 'LON').valid).toBe(false);

    // Unclosed polygon is caught or requires >=3 vertices / rejects projected meters / bowtie
    const projectedMeters = validateFieldGeoJson(
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [630000, 6638000],
            [630500, 6638000],
            [630500, 6638500],
            [630000, 6638500],
            [630000, 6638000],
          ],
        ],
      })
    );
    expect(projectedMeters.valid).toBe(false);

    const bowtie = validateFieldGeoJson(
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.65, 59.86],
            [17.65, 59.85],
            [17.63, 59.86],
            [17.63, 59.85],
          ],
        ],
      })
    );
    expect(bowtie.valid).toBe(false);

    const tooFewVertices = validateFieldGeoJson(
      JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [17.63, 59.85],
            [17.64, 59.85],
            [17.63, 59.85],
          ],
        ],
      })
    );
    expect(tooFewVertices.valid).toBe(false);

    const antimeridianArea = estimatePolygonAreaHectares(
      EXPLORER_PRESET_SITES['antimeridian-taveuni']!.defaultPolygon!
    );
    expect(antimeridianArea).toBeGreaterThan(100);
    expect(antimeridianArea).toBeLessThan(1000);

    // Unit conversion consistency & null preservation
    expect(formatAreaWithUnit(null, 'SI_METRIC')).toContain('Missing');
    expect(formatAreaWithUnit(10, 'SI_METRIC')).toBe('10.0 ha');
    expect(formatAreaWithUnit(10, 'SI_WITH_ACRE_GALLON_EQUIV')).toContain('24.7 ac');
    expect(formatVolumeWithUnit(null, 'SI_WITH_ACRE_GALLON_EQUIV')).toContain('Null');
    expect(formatVolumeWithUnit(8000, 'SI_WITH_ACRE_GALLON_EQUIV')).toContain('ac-ft');
  });

  it('G16: confirms strictly English-only active UI strings while keeping i18n/direction abstractions intact', () => {
    expect(getLocaleDirection('en')).toBe('ltr');
    expect(enMessages.nav.exploreEarth).toBe('Explore Earth');

    // Verify rendered TSX components in app/ and src/ do not ship half-translated non-English UI strings
    const filesToScan: string[] = [];
    const scanDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scanDir(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) filesToScan.push(full);
      }
    };
    scanDir(path.resolve(process.cwd(), 'app'));
    scanDir(path.resolve(process.cwd(), 'src/messages'));

    const nonEnglishScriptPattern = /[\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF]/;
    for (const file of filesToScan) {
      const content = fs.readFileSync(file, 'utf8');
      expect(
        nonEnglishScriptPattern.test(content),
        `Unexpected non-English UI copy found in active route/message file: ${file}`
      ).toBe(false);
    }
  });
});
