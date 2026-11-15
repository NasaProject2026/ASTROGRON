import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_EXPLORER_PRESETS,
  resolveExplorerPreset,
} from '@/fixtures/sites-and-coverage';
import {
  getRepositoryForMode,
  sortPoliciesByPreference,
} from '@/adapters/repositories';
import { SYNTHETIC_UPPSALA_DECISION_FIXTURE } from '@/fixtures/m14-decision-fixture';
import { buildEarthGlobeStyle, buildEoSpatialSupportGeoJson } from '@/components/maps/map-providers';
import {
  getLocaleDirection,
  formatDate,
  formatPercent,
  formatNumber,
} from '@/lib/i18n';

describe('G3 & G2 Remediation Gate Tests', () => {
  it('deduplicates canonical explorer presets so Uppsala appears exactly once', () => {
    const ids = CANONICAL_EXPLORER_PRESETS.map((p) => p.id);
    const names = CANONICAL_EXPLORER_PRESETS.map((p) => p.name);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(names).size).toBe(6);
    expect(ids).toContain('uppsala-demo');
    expect(ids).toContain('nyeri-kenya');
    expect(ids).toContain('wagga-australia');
    expect(ids).not.toContain('uppsala-m14');
  });

  it('resolves legacy preset aliases cleanly to uppsala-demo', () => {
    const fromAlias = resolveExplorerPreset('uppsala-m14');
    const fromSiteAlias = resolveExplorerPreset('site-se-uppsala-m14');
    const fromCanonical = resolveExplorerPreset('uppsala-demo');
    expect(fromAlias?.id).toBe('uppsala-demo');
    expect(fromSiteAlias?.id).toBe('uppsala-demo');
    expect(fromCanonical?.id).toBe('uppsala-demo');
    expect(resolveExplorerPreset('does-not-exist')).toBeNull();
  });

  it('fails closed in getSiteCoverageContext without Uppsala coordinate fallback', () => {
    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO');
    const customMissing = repo.getSiteCoverageContext('custom-missing-coords');
    const phantomSite = repo.getSiteCoverageContext('unknown-phantom-999');

    expect(customMissing.status).toBe('SITE_NOT_FOUND');
    expect(customMissing.data).toBeNull();
    expect(phantomSite.status).toBe('SITE_NOT_FOUND');
    expect(phantomSite.data).toBeNull();
  });

  it('computes dynamic universal service pass counts in sortPoliciesByPreference()', () => {
    const zeroPass = sortPoliciesByPreference(
      SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      'STRICT_ALL_SCENARIOS_SERVICE'
    );
    expect(zeroPass.selectionOutcome).toBe('ZERO_FEASIBLE_POLICIES');
    expect(zeroPass.selectionHeadline).toContain('0 of 12');

    // Construct synthetic passing 1-policy clone to prove passCount is computed dynamically
    const basePolicy = SYNTHETIC_UPPSALA_DECISION_FIXTURE.policies[0]!;
    const passingDataset = {
      ...SYNTHETIC_UPPSALA_DECISION_FIXTURE,
      portfolioSummary: {
        ...SYNTHETIC_UPPSALA_DECISION_FIXTURE.portfolioSummary,
        totalPolicies: 1,
        totalPoliciesTested: 1,
        policiesPassingAllStates: 1,
        universalPassPoliciesCount: 1,
      },
      policies: [
        {
          ...basePolicy,
          isComparable: true,
          passesAllTestedScenarios: true,
          statesPassedCount: 9,
          statesFailedCount: 0,
        },
      ],
    };

    const onePass = sortPoliciesByPreference(passingDataset, 'STRICT_ALL_SCENARIOS_SERVICE');
    expect(onePass.selectionOutcome).toBe('SINGLE_LEADER_SELECTED');
    expect(onePass.selectedLeaderPolicy?.policyId).toBe(basePolicy.policyId);
    expect(onePass.selectionHeadline).toContain('1 of 1');
    expect(onePass.selectionDetail).toContain('1 tested candidate(s)');
  });

  it('builds a genuine MapLibre 3D globe style and strips remote providers in offline mode', () => {
    const hybrid = buildEarthGlobeStyle({ basemapMode: 'SATELLITE_HYBRID' });
    expect(hybrid.projection).toEqual({ type: 'globe' });
    expect(hybrid.sky).toBeDefined();
    expect(hybrid.sources['nasa-blue-marble']).toBeDefined();
    expect(hybrid.sources['eox-sentinel2']).toBeDefined();
    expect(hybrid.sources['openfreemap']).toBeDefined();
    expect(hybrid.sources['world-countries-fallback']).toBeDefined();

    const offline = buildEarthGlobeStyle({ basemapMode: 'OFFLINE_NATURAL_EARTH' });
    expect(offline.projection).toEqual({ type: 'globe' });
    expect(offline.sources['eox-sentinel2']).toBeUndefined();
    expect(offline.sources['openfreemap']).toBeUndefined();
    expect(offline.sources['world-countries-fallback']).toBeDefined();

    const support = buildEoSpatialSupportGeoJson(17.64, 59.86, 'NASA_POWER_CLIMATE');
    expect(support.features.length).toBe(1);
    expect(support.features[0]?.geometry.type).toBe('Polygon');
  });

  it('verifies assets-manifest.json has honest licenses, existing asset files, and Natural Earth GeoJSON', () => {
    const manifestPath = path.resolve(process.cwd(), 'assets-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(Array.isArray(manifest.assets)).toBe(true);
    for (const asset of manifest.assets) {
      if (typeof asset.path === 'string' && asset.path.startsWith('public/')) {
        const absAssetPath = path.resolve(process.cwd(), asset.path);
        expect(fs.existsSync(absAssetPath)).toBe(true);
      }
      if (typeof asset.path === 'string' && asset.path.startsWith('public/assets/')) {
        expect(String(asset.license).toUpperCase()).toContain('PROPRIETARY');
        expect(String(asset.license).toUpperCase()).not.toContain('CC0 1.0');
      }
    }

    const geodataPath = path.resolve(process.cwd(), 'public/geodata/ne_110m_admin_0_countries.geojson');
    expect(fs.existsSync(geodataPath)).toBe(true);
    const geodata = JSON.parse(fs.readFileSync(geodataPath, 'utf8'));
    expect(Array.isArray(geodata.features)).toBe(true);
    expect(geodata.features.length).toBeGreaterThanOrEqual(170);

    const providerIds = (manifest.externalRuntimeMapProviders ?? []).map((p: { id: string }) => p.id);
    expect(providerIds).toContain('eox-s2cloudless-2016');
    expect(providerIds).toContain('openfreemap-vector');
    expect(providerIds).toContain('nasa-gibs-blue-marble');
  });

  it('exposes future-ready locale direction and formatting helpers while staying en by default', () => {
    expect(getLocaleDirection('en')).toBe('ltr');
    expect(getLocaleDirection('ar')).toBe('rtl');
    expect(formatNumber(1234.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).toBe('1,234.5');
    expect(formatPercent(61.1, 1)).toBe('61.1%');
    expect(formatPercent(0.611, 1, false)).toBe('61.1%');
    expect(formatDate('2026-11-12')).toContain('2026');
  });

  it('preserves locationLabel on validated Uppsala climate series', () => {
    const repo = getRepositoryForMode('SYNTHETIC_UI_DEMO');
    const climateEnv = repo.getClimateWaterSeries('uppsala-demo');
    expect(climateEnv.data?.locationLabel).toBe('Uppsala, Sweden (59.8586°N, 17.6389°E)');
  });
});
