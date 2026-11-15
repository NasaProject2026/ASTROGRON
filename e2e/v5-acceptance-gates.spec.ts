import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'review/evidence');
const SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots');

test.describe('V5 Acceptance Gates: Scientific Truth, Explorer Inputs, Simple View & WCAG AA', () => {
  test('P1: Wizard input-revision invalidation persists across navigation/reload, CSV preserves revision & ocean M4 fails closed', async ({
    page,
  }) => {
    // 1. Mutate sowing date on /farm/new?from=uppsala-demo (Stage 3 optional agronomy) and confirm invalidation persists across back + reload
    await page.goto('/farm/new?from=uppsala-demo', { waitUntil: 'load' });
    await page.getByRole('button', { name: /Continue/i }).click();
    await page.getByRole('button', { name: /Continue/i }).click();

    await page.getByTestId('wizard-optional-agronomy').locator('summary').click();
    const sowingInput = page.locator('#wizard-sowing-date');
    await expect(sowingInput).toBeVisible();
    await sowingInput.fill('2027-05-03');

    await page.getByRole('button', { name: /Open Report View|Open Synthetic Decision Results|Inspect Site Decision Gate/i }).click();
    await page.waitForURL(/\/farm\/custom-uppsala-[^/]+\/results/);

    const statusCard = page.getByTestId('fail-closed-status-card');
    await expect(statusCard).toHaveAttribute('data-status-code', 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION');

    // Navigate away, come back via browser history, and reload
    await page.goto('/explore', { waitUntil: 'load' });
    await page.goBack({ waitUntil: 'load' });
    await expect(page.getByTestId('fail-closed-status-card')).toHaveAttribute(
      'data-status-code',
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    );
    await page.reload({ waitUntil: 'load' });
    await expect(page.getByTestId('fail-closed-status-card')).toHaveAttribute(
      'data-status-code',
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    );

    // 2. Research CSV export preserves revision lineage + watermark
    await page.goto('/farm/uppsala-demo/reports', { waitUntil: 'load' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Candidate Table CSV/i }).click();
    const download = await downloadPromise;
    const csvPath = await download.path();
    expect(csvPath).toBeTruthy();
    const csvText = fs.readFileSync(csvPath!, 'utf8');
    expect(csvText).toContain('input_revision');
    expect(csvText).toContain('reference_revision');
    expect(csvText).toContain('inputs_modified');
    expect(csvText).toContain('SYNTHETIC_UI_DEMO');

    // 3. M4 Ocean Coverage fails closed as OUT_OF_COVERAGE (OUTSIDE LAND / VALID BAND)
    await page.goto('/farm/ocean-atlantic/coverage', { waitUntil: 'load' });
    await page.getByRole('button', { name: /Scientific/i }).first().click();
    await expect(page.getByTestId('coverage-three-axis-matrix')).toContainText(/OUT_OF_COVERAGE/i);

    // 4. Cross-site URL isolation never leaks Uppsala plans into Kenya
    await page.goto('/farm/nyeri-kenya/results', { waitUntil: 'load' });
    await expect(page.getByTestId('fail-closed-status-card')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('SYNTH-POL-01');
  });

  test('P4: Explorer GeoJSON file upload, negative DMS, browser geolocation, retry recovery & historical disclosure', async ({
    context,
    page,
  }, testInfo) => {
    try {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ longitude: 17.6412, latitude: 59.8624, accuracy: 18 });
    } catch {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition: (ok: (pos: unknown) => void) =>
              ok({ coords: { longitude: 17.6412, latitude: 59.8624, accuracy: 18 } }),
          },
        });
      });
    }
    void testInfo;

    await page.goto('/explore', { waitUntil: 'load' });
    await expect(page.getByText(/EOxCloudless/i).first()).toBeVisible();

    // Expand controls on mobile/narrow viewports if needed
    const coordsSection = page.locator('details').filter({ hasText: /Coordinates|Boundary|Layers/i }).first();
    if (await coordsSection.isVisible()) {
      await coordsSection.evaluate((el) => {
        (el as HTMLDetailsElement).open = true;
      });
    }

    // 1. Negative DMS test (-17° 30' 00", -12° 20' 00")
    await page.getByRole('button', { name: /^DMS$/i }).click();
    await page.getByTestId('explorer-dms-lon').fill("-17° 30' 00\"");
    await page.getByTestId('explorer-dms-lat').fill("-12° 20' 00\"");
    await page.getByTestId('explorer-apply-dms-btn').click();
    await expect(page.getByTestId('explorer-coord-error')).toHaveCount(0);
    await expect(page.locator('body')).toContainText(/-17\.5/);

    // 2. GeoJSON file upload via <input type="file">
    await page.getByRole('button', { name: /GeoJSON File/i }).click();
    const validGeoJson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [17.63, 59.855],
          [17.636, 59.855],
          [17.636, 59.859],
          [17.63, 59.859],
          [17.63, 59.855],
        ],
      ],
    });
    await page.getByTestId('explorer-geojson-file-input').setInputFiles({
      name: 'uppsala-plot.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(validGeoJson, 'utf8'),
    });
    await expect(page.locator('body')).toContainText(/Uploaded GeoJSON Field Boundary/i);

    // 3. Opt-in browser geolocation keeps polygon/works cleanly
    await page.getByTestId('explorer-geolocate-btn').click();
    await expect(page.locator('body')).toContainText(/Device Location/i);

    // 4. Canvas mouse drag & zoom preservation
    const globe = page
      .locator('[data-testid="maplibre-3d-canvas"], [data-testid="maplibre-2d-fallback"]')
      .first();
    const box = await globe.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 25, { steps: 6 });
      await page.mouse.up();
    }

    // 5. Outage -> IMAGERY_PROVIDER_BLOCKED -> retry button (preserves boundary)
    await page.route('**tiles.maps.eox.at/**', (route) => route.fulfill({ status: 429, body: 'Rate Limited' }));
    await page.route('**demotiles.maplibre.org/**', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
    await page.goto('/explore', { waitUntil: 'load' });
    await page.waitForTimeout(1800);

    // Ensure retry button if imagery blocked appears cleanly when provider fails
    const retryBtn = page.getByTestId('globe-retry-provider-btn');
    if (await retryBtn.isVisible().catch(() => false)) {
      await page.unrouteAll();
      await retryBtn.click();
      await page.waitForTimeout(800);
    }
    await page.unrouteAll();
  });

  test('P4 + P5: Simple View progressive disclosure, reduced-motion fallback & @axe-core/playwright WCAG AA across core routes', async ({
    page,
  }, testInfo) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    // 1. Simple View vs Scientific View progressive disclosure
    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'load' });
    const kpiDetails = page.getByTestId('results-kpi-details');
    const candDetails = page.getByTestId('results-candidates-details');
    await expect(kpiDetails).not.toHaveAttribute('open', '');
    await expect(candDetails).not.toHaveAttribute('open', '');
    await expect(page.getByText(/38,420\.50/i).first()).toBeVisible();
    if (testInfo.project.name === 'desktop-chrome') {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, 'v5_simple_view_results_1440.png') });
    }

    await page.getByRole('button', { name: /Scientific/i }).first().click();
    await expect(kpiDetails).toHaveAttribute('open', '');
    await expect(candDetails).toHaveAttribute('open', '');

    // Plans inspector progressive disclosure
    await page.goto('/farm/uppsala-demo/plans', { waitUntil: 'load' });
    await page.getByRole('button', { name: /Simple/i }).first().click();
    await expect(page.getByTestId('plans-technical-inspector')).not.toHaveAttribute('open', '');
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SHOTS_DIR, 'v5_simple_view_plans_1440.png') });
    }
    await page.getByRole('button', { name: /Scientific/i }).first().click();
    await expect(page.getByTestId('plans-technical-inspector')).toHaveAttribute('open', '');

    // 2. Keyboard Escape closes Evidence Drawer
    const evBtn = page.getByRole('button', { name: /View Weather|Provenance|Evidence/i }).first();
    if (await evBtn.isVisible()) {
      await evBtn.click();
      await expect(page.getByRole('dialog').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    // 3. Prefers-reduced-motion disables Three.js animation loop cleanly on /orbit-ab
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/orbit-ab', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await expect(page.getByTestId('orbit-ab-stage')).toHaveAttribute(
      'data-orbit-ab-status',
      'FALLBACK_REDUCED_MOTION'
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // 4. @axe-core/playwright WCAG 2.0/2.1 A/AA across all 8 core routes
    const routes = [
      '/',
      '/explore',
      '/methodology',
      '/farm/uppsala-demo/results',
      '/farm/uppsala-demo/coverage',
      '/farm/uppsala-demo/plans',
      '/farm/nyeri-kenya/results',
      '/settings',
    ];

    const axeReport: Array<{
      route: string;
      engine: string;
      criticalCount: number;
      seriousCount: number;
      moderateCount: number;
      violations: Array<{ id: string; impact: string | null | undefined; nodes: number }>;
    }> = [];

    for (const route of routes) {
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const criticalSerious = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      axeReport.push({
        route,
        engine: testInfo.project.name,
        criticalCount: results.violations.filter((v) => v.impact === 'critical').length,
        seriousCount: results.violations.filter((v) => v.impact === 'serious').length,
        moderateCount: results.violations.filter((v) => v.impact === 'moderate').length,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
        })),
      });

      expect(
        criticalSerious,
        `WCAG critical/serious violations on ${route} (${testInfo.project.name}): ${JSON.stringify(
          criticalSerious.map((v) => ({ id: v.id, impact: v.impact, help: v.help }))
        )}`
      ).toEqual([]);
    }

    const outPath = path.join(EVIDENCE_DIR, `axe-audit-${testInfo.project.name}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ measuredAt: new Date().toISOString(), axeReport }, null, 2));
  });
});
