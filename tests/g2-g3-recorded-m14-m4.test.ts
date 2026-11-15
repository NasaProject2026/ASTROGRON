import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { loadAndVerifyStagedCorpora } from '@/server/corpus-integrity';
import {
  getRepositoryForMode,
  m4SourceCoverageRepository,
  recordedM14Repository,
  sortPoliciesByPreference,
  buildSiteBoundExportPayload,
} from '@/adapters/repositories';
import { DEFAULT_UPPSALA_FARM_DRAFT } from '@/fixtures/sites-and-coverage';
import { GET as getM14Route } from '../app/api/research/m14/route';
import { GET as getM4Route } from '../app/api/research/m4-coverage/route';

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

describe('Gate G2 & G3: Source-Backed Recorded M14 & M4 Global Coverage Integration', () => {
  const m14Dir = path.join(process.cwd(), 'src', 'data', 'm14-recorded');
  const m4Dir = path.join(process.cwd(), 'src', 'data', 'm4-global');

  it('verifies all staged M14 & M4 JSON/CSV files against OUTPUT_RECEIPT.json & DELIVERY_MANIFEST.json SHA-256 hashes', () => {
    const verification = loadAndVerifyStagedCorpora();
    expect(verification.verified).toBe(true);
    expect(verification.statusCode).toBe('OK_VERIFIED_RECORDED');
    expect(verification.m14ProtocolSha256).toBe(
      '0b677fc34246faf4ec247c23df3b0abb95f80c80c2c983ef0070b20ca42c2b30'
    );
    expect(verification.decisionDataset?.policies).toHaveLength(16);
    expect(verification.decisionDataset?.portfolioSummary.totalPolicyStateCases).toBe(144);
    expect(verification.decisionDataset?.portfolioSummary.numericPassCases).toBe(90);
    expect(verification.decisionDataset?.portfolioSummary.numericFailCases).toBe(45);
    expect(verification.decisionDataset?.portfolioSummary.calendarInvalidCases).toBe(9);
  });

  it('fails closed with SOURCE_NOT_PROVIDED if staged M14 candidate_audit.json or M4 manifest is tampered by 1 byte or missing', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrogron-tamper-'));
    try {
      const tmpM14 = path.join(tmpRoot, 'm14');
      const tmpM4 = path.join(tmpRoot, 'm4');
      copyDirRecursive(m14Dir, tmpM14);
      copyDirRecursive(m4Dir, tmpM4);

      const candidatePath = path.join(tmpM14, 'candidate_audit.json');
      fs.writeFileSync(candidatePath, `${fs.readFileSync(candidatePath, 'utf8')}\n`, 'utf8');

      const tamperedM14 = loadAndVerifyStagedCorpora({ m14Dir: tmpM14, m4Dir: tmpM4 });
      expect(tamperedM14.verified).toBe(false);
      expect(tamperedM14.statusCode).toBe('SOURCE_NOT_PROVIDED');
      expect(tamperedM14.decisionDataset).toBeNull();
      expect(tamperedM14.reason).toContain('SHA-256 mismatch');

      // Restore M14, tamper M4 GLOBAL_COVERAGE_MANIFEST.json
      fs.copyFileSync(path.join(m14Dir, 'candidate_audit.json'), candidatePath);
      const covPath = path.join(tmpM4, 'GLOBAL_COVERAGE_MANIFEST.json');
      fs.writeFileSync(covPath, `${fs.readFileSync(covPath, 'utf8')} `, 'utf8');

      const tamperedM4 = loadAndVerifyStagedCorpora({ m14Dir: tmpM14, m4Dir: tmpM4 });
      expect(tamperedM4.verified).toBe(false);
      expect(tamperedM4.statusCode).toBe('SOURCE_NOT_PROVIDED');
      expect(tamperedM4.m4Catalog).toBeNull();

      const missingCorpus = loadAndVerifyStagedCorpora({ corpusAvailable: false });
      expect(missingCorpus.verified).toBe(false);
      expect(missingCorpus.statusCode).toBe('SOURCE_NOT_PROVIDED');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('preserves exact M14 SE_UPPSALA scientific numbers, distinct preference winners, Pareto frontier, and BLOCKED status', () => {
    const repo = getRepositoryForMode('RECORDED_M14_RESEARCH');
    const decEnv = repo.getM14DecisionEvaluation('uppsala-demo');
    expect(decEnv.statusCode).toBe('OK_RECORDED_RESEARCH');
    expect(decEnv.fixtureKind).toBe('RECORDED_M14_RESEARCH');
    const dataset = decEnv.data!;
    expect(dataset.datasetMode).toBe('RECORDED_M14_RESEARCH');
    expect(dataset.scientificMeta?.canonicalSiteId).toBe('SE_UPPSALA');
    expect(dataset.fieldRecommendationEligibility).toBe('BLOCKED');
    expect(dataset.portfolioSummary.policiesPassingAllStates).toBe(0);
    expect(dataset.policies).toHaveLength(16);
    expect(dataset.scientificMeta?.resourceSensitivityBracket.firstPassingGridMm).toBeCloseTo(165.47324, 6);
    expect(dataset.scientificMeta?.resourceSensitivityBracket.lastFailingGridMm).toBeCloseTo(165.473239, 6);

    const strictSorted = sortPoliciesByPreference(dataset, 'STRICT_ALL_SCENARIOS_SERVICE');
    expect(strictSorted.selectionOutcome).toBe('ZERO_FEASIBLE_POLICIES');
    expect(strictSorted.selectedLeaderPolicy).toBeNull();

    const leastWorstSorted = sortPoliciesByPreference(dataset, 'MINIMIZE_WORST_ET_SHORTFALL');
    expect(leastWorstSorted.selectionOutcome).toBe('CONDITIONAL_SINGLE_LEADER');
    expect(leastWorstSorted.selectedLeaderPolicy?.policyId).toBe('a27063ce2eca13f02e03');
    expect(leastWorstSorted.selectedLeaderPolicy?.worstEtShortfallM3Eq).toBeCloseTo(52102.446821, 5);

    const regretSorted = sortPoliciesByPreference(dataset, 'MINIMAX_REGRET');
    expect(regretSorted.selectionOutcome).toBe('CONDITIONAL_SINGLE_LEADER');
    expect(regretSorted.selectedLeaderPolicy?.policyId).toBe('fa0e548ed3a7ccbcad4e');
    expect(regretSorted.selectedLeaderPolicy?.maxRegretM3Eq).toBeCloseTo(814.768106, 5);
    expect(regretSorted.selectedLeaderPolicy?.policyId).not.toBe(
      leastWorstSorted.selectedLeaderPolicy?.policyId
    );

    const paretoSorted = sortPoliciesByPreference(dataset, 'PARETO_FRONTIER');
    expect(paretoSorted.selectionOutcome).toBe('NO_UNIQUE_WINNER');
    expect(paretoSorted.selectedLeaderPolicy).toBeNull();
    expect(paretoSorted.paretoFrontierPolicies.map((p) => p.policyId).sort()).toEqual([
      'a27063ce2eca13f02e03',
      'fa0e548ed3a7ccbcad4e',
    ]);
    expect(paretoSorted.excludedCalendarPolicies).toHaveLength(1);
    expect(paretoSorted.excludedCalendarPolicies[0]?.worstEtShortfallM3Eq).toBeNull();
    expect(paretoSorted.excludedCalendarPolicies[0]?.maxRegretM3Eq).toBeNull();
  });

  it('serves verified NASA POWER 2006/2012/2018 historical climate window with null unmodeled ET0', () => {
    const cliEnv = recordedM14Repository.getClimateWaterSeries('uppsala-demo');
    expect(cliEnv.statusCode).toBe('OK_RECORDED_RESEARCH');
    const cli = cliEnv.data!;
    expect(cli.datasetMode).toBe('RECORDED_M14_RESEARCH');
    expect(cli.analogueSummaries).toHaveLength(3);

    const byYear = new Map(cli.analogueSummaries.map((s) => [s.analogueYear, s]));
    expect(byYear.get(2006)?.seasonalPrecipMm).toBeCloseTo(365.25, 2);
    expect(byYear.get(2012)?.seasonalPrecipMm).toBeCloseTo(514.82, 2);
    expect(byYear.get(2018)?.seasonalPrecipMm).toBeCloseTo(233.55, 2);
    for (const summary of cli.analogueSummaries) {
      expect(summary.seasonalEt0Mm).toBeNull();
      const series = cli.seriesByAnalogue[String(summary.analogueYear) as '2006' | '2012' | '2018'];
      expect(series.length).toBeGreaterThan(160);
      expect(
        series.every(
          (r) =>
            r.et0Mm === null &&
            r.etcMm === null &&
            r.etaMm === null &&
            r.rootZoneDeficitMm === null &&
            r.deliveredIrrigationMm === null
        )
      ).toBe(true);
    }
  });

  it('enforces M4 global coverage across SE_UPPSALA, KE_NYERI_REGION, and AU_WAGGA_REGION without crop qualification', () => {
    for (const siteId of ['uppsala-demo', 'nyeri-kenya', 'wagga-australia'] as const) {
      const cov = m4SourceCoverageRepository.getSiteCoverageContext(siteId);
      expect(cov.statusCode).toBe('OK_COVERAGE_ONLY');
      expect(cov.fixtureKind).toBe('M4_GLOBAL_COVERAGE_RECORD');
      expect(cov.data?.capabilities).toHaveLength(9);

      const climateCap = cov.data!.capabilities.find((c) => c.capability === 'climate_history');
      expect(climateCap?.status).toBe('AVAILABLE');
      const blockedCaps = cov.data!.capabilities.filter((c) => c.capability !== 'climate_history');
      expect(blockedCaps.every((c) => c.status === 'INSUFFICIENT_EVIDENCE')).toBe(true);

      // M4 repository never fabricates M14 decision or ET water-balance series
      expect(m4SourceCoverageRepository.getM14DecisionEvaluation(siteId).statusCode).toBe('MODEL_UNQUALIFIED');
      expect(m4SourceCoverageRepository.getClimateWaterSeries(siteId).statusCode).toBe('MODEL_UNQUALIFIED');
    }

    // In RECORDED_M14_RESEARCH, Kenya & Wagga stay MODEL_UNQUALIFIED on decision/climate while keeping OK_COVERAGE_ONLY
    expect(recordedM14Repository.getM14DecisionEvaluation('nyeri-kenya').statusCode).toBe('MODEL_UNQUALIFIED');
    expect(recordedM14Repository.getM14DecisionEvaluation('wagga-australia').statusCode).toBe('MODEL_UNQUALIFIED');
    expect(recordedM14Repository.getSiteCoverageContext('nyeri-kenya').statusCode).toBe('OK_COVERAGE_ONLY');
  });

  it('fails closed on modified Uppsala drafts, custom farms, unknown sites, cross-site evidence, and REAL_SCIENTIFIC_BACKEND', () => {
    const editedDraft = {
      ...DEFAULT_UPPSALA_FARM_DRAFT,
      totalWaterBudgetMm: 220,
      inputsModified: true,
    };
    expect(recordedM14Repository.getM14DecisionEvaluation('uppsala-demo', editedDraft).statusCode).toBe(
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    );
    expect(recordedM14Repository.getClimateWaterSeries('uppsala-demo', editedDraft).statusCode).toBe(
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    );

    const repoWithCustom = getRepositoryForMode('RECORDED_M14_RESEARCH', ['custom-kenya-1']);
    expect(repoWithCustom.getM14DecisionEvaluation('custom-kenya-1').statusCode).toBe('BACKEND_NOT_CONNECTED');
    expect(recordedM14Repository.getM14DecisionEvaluation('unknown-planet-site').statusCode).toBe('SITE_NOT_FOUND');

    // Cross-site evidence isolation
    const crossSiteEnv = recordedM14Repository.getEvidenceRecord(
      { siteId: 'nyeri-kenya', datasetMode: 'RECORDED_M14_RESEARCH' },
      'm14-ev-power-2006-2025-uppsala'
    );
    expect(crossSiteEnv.statusCode).toBe('NO_EVIDENCE_FOR_SITE');
    expect(crossSiteEnv.data).toBeNull();

    // REAL_SCIENTIFIC_BACKEND remains disconnected
    const realRepo = getRepositoryForMode('REAL_SCIENTIFIC_BACKEND');
    expect(realRepo.getM14DecisionEvaluation('uppsala-demo').statusCode).toBe('BACKEND_NOT_CONNECTED');

    // Export payload carries recorded watermark + OK_RECORDED_RESEARCH for Uppsala, MODEL_UNQUALIFIED for Kenya
    const uppsalaExport = buildSiteBoundExportPayload('uppsala-demo', 'RECORDED_M14_RESEARCH');
    expect(uppsalaExport.exportStatus).toBe('OK_RECORDED_RESEARCH');
    expect(uppsalaExport.watermark).toContain('RECORDED M14 SCIENTIFIC RESEARCH ARTIFACT');
    expect(uppsalaExport.decisionDataset?.policies).toHaveLength(16);
  });

  it('serves read-only /api/research/m14 and /api/research/m4-coverage Route Handlers with strict site allowlist', async () => {
    const resOk = await getM14Route(new NextRequest('http://localhost:3000/api/research/m14?siteId=SE_UPPSALA'));
    expect(resOk.status).toBe(200);
    const bodyOk = await resOk.json();
    expect(bodyOk.statusCode).toBe('OK_RECORDED_RESEARCH');
    expect(bodyOk.decisionDataset.policies).toHaveLength(16);

    const resUnq = await getM14Route(new NextRequest('http://localhost:3000/api/research/m14?siteId=nyeri-kenya'));
    expect(resUnq.status).toBe(200);
    expect((await resUnq.json()).statusCode).toBe('MODEL_UNQUALIFIED');

    const resBad = await getM14Route(new NextRequest('http://localhost:3000/api/research/m14?siteId=../etc/passwd'));
    expect(resBad.status).toBe(400);

    const resM4All = await getM4Route(new NextRequest('http://localhost:3000/api/research/m4-coverage'));
    expect(resM4All.status).toBe(200);
    const m4AllJson = await resM4All.json();
    expect(Object.keys(m4AllJson.sites).sort()).toEqual(['nyeri-kenya', 'uppsala-demo', 'wagga-australia']);

    const resM4Unknown = await getM4Route(new NextRequest('http://localhost:3000/api/research/m4-coverage?siteId=mars'));
    expect(resM4Unknown.status).toBe(404);
  });
});
