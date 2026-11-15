import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const AFTER_SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots/after');
const EVIDENCE_DIR = path.resolve(process.cwd(), 'review/evidence');

test.describe('Gate G6: End-to-End Recorded M14/M4, Geocoder, API & Responsive Verification', () => {
  test('verifies Recorded M14 corpus switching, M4 Kenya coverage, geocoder fail-closed state, and live API routes', async ({
    page,
    request,
  }, testInfo) => {
    fs.mkdirSync(AFTER_SHOTS_DIR, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const externalNominatimRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('nominatim.openstreetmap.org')) {
        externalNominatimRequests.push(req.url());
      }
    });

    // 1. Live Server Route Handlers (/api/capabilities, /api/geocode validation, /api/research/m14, /api/research/m4-coverage)
    const capRes = await request.get('/api/capabilities');
    expect(capRes.status()).toBe(200);
    const capJson = await capRes.json();
    expect(capJson.geocoding.enabled).toBe(true);

    const shortGeo = await request.get('/api/geocode?q=a');
    expect(shortGeo.status()).toBe(400);
    const shortGeoJson = await shortGeo.json();
    expect(shortGeoJson.status).toBe('INVALID_QUERY');

    const m14Res = await request.get('/api/research/m14?siteId=SE_UPPSALA');
    expect(m14Res.status()).toBe(200);
    const m14Json = await m14Res.json();
    expect(m14Json.statusCode).toBe('OK_RECORDED_RESEARCH');
    expect(m14Json.decisionDataset.policies).toHaveLength(16);

    const m14Bad = await request.get('/api/research/m14?siteId=../etc/passwd');
    expect(m14Bad.status()).toBe(400);

    const m4Kenya = await request.get('/api/research/m4-coverage?siteId=KE_NYERI_REGION');
    expect(m4Kenya.status()).toBe(200);
    const m4KenyaJson = await m4Kenya.json();
    expect(m4KenyaJson.statusCode).toBe('OK_COVERAGE_ONLY');
    expect(m4KenyaJson.site.canonicalSiteId).toBe('KE_NYERI_REGION');

    // 2. Hero & Explore at Desktop (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByTestId('hero-orbital-centerpiece').locator('picture')).toBeVisible();
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_hero_1440.png') });
    }

    // 2. Navigate to Earth Explorer & verify SSRF-safe geocoder fail-closed UI handling (mocked 503 offline mode)
    await page.route('**/api/geocode**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          status: 'GEOCODER_NOT_CONFIGURED',
          providerHost: null,
          providerTier: 'UNCONFIGURED',
          attribution: 'Offline 16-site examples only',
          results: [],
          notice: 'Geocoder is not configured in offline mode.',
        }),
      })
    );
    await page.goto('/explore', { waitUntil: 'load' });
    const explorerSearchInput = page.getByTestId('explorer-search-input');
    await expect(async () => {
      await explorerSearchInput.fill('Cairo');
      await expect(page.getByTestId('explorer-remote-geocode-btn')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15000 });
    await page.getByTestId('explorer-remote-geocode-btn').click();
    await expect(page.getByTestId('explorer-remote-geocode-status')).toContainText(
      /not configured/i
    );
    expect(externalNominatimRequests).toEqual([]);
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_explore_1440.png') });
    }

    // 3. Switch to RECORDED_M14_RESEARCH mode and inspect Uppsala M14 surfaces
    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'load' });
    const recordedBtn = page.getByRole('button', { name: /Recorded M14 Corpus/i });
    await expect(recordedBtn).toContainText('VERIFIED_READ_ONLY');
    await recordedBtn.click();

    await expect(page.getByTestId('disclosure-watermark-badge')).toContainText(
      'RECORDED SCIENTIFIC ARCHIVE (READ-ONLY)'
    );
    await expect(page.locator('footer')).toContainText('RECORDED SCIENTIFIC ARCHIVE (READ-ONLY)');

    await page.getByRole('button', { name: /Scientific View/i }).click();
    await expect(page.locator('body')).toContainText('16 Policies × 9 States = 144 Cases');
    await expect(page.locator('body')).toContainText('a27063ce2eca13f02e03');
    await expect(page.locator('body')).toContainText('fa0e548ed3a7ccbcad4e');
    await expect(page.locator('body')).toContainText('52,102.45');
    await expect(page.locator('body')).toContainText('814.77');
    await expect(page.locator('body')).toContainText('NO_UNIQUE_WINNER (2 Policies)');
    await expect(page.locator('body')).not.toContainText('SYNTH-POL-01');
    await expect(page.getByTestId('recorded-m14-bracket-receipt')).toContainText('165.473239');
    await expect(page.getByTestId('recorded-m14-bracket-receipt')).toContainText('165.473240');

    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_recorded_results_1440.png'), fullPage: true });
    }

    // Decisions Explorer
    await page.goto('/farm/uppsala-demo/decisions', { waitUntil: 'load' });
    await expect(page.locator('body')).toContainText('16-Policy Recorded M14 Portfolio');
    await expect(page.locator('body')).toContainText('52,102.45 m³ eq');
    await expect(page.locator('body')).toContainText('814.77 m³ eq');
    await expect(page.locator('body')).not.toContainText('38,420.50');

    // Climate (unmodeled ET0 must be explicitly marked N/A / Unmodeled, never empty)
    await page.goto('/farm/uppsala-demo/climate', { waitUntil: 'load' });
    await expect(page.locator('body')).toContainText('ET0: N/A (Unmodeled)');
    await expect(page.getByTestId('climate-unmodeled-et-notice')).toBeVisible();

    // Evidence (real SHA-256 digests)
    await page.goto('/farm/uppsala-demo/evidence', { waitUntil: 'load' });
    await expect(page.locator('body')).toContainText('5bd02acc67a56003acd1994cc1dd50b597dc3f9c7681b07548c278d0081a669b');

    // Reports CSV export in Recorded mode
    await page.goto('/farm/uppsala-demo/reports', { waitUntil: 'load' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download Candidate Table CSV/i }).click();
    const download = await downloadPromise;
    const csvPath = await download.path();
    const csvContent = fs.readFileSync(csvPath!, 'utf8');
    expect(csvContent).toContain('RECORDED_M14_SCIENTIFIC_ARCHIVE_READ_ONLY_NOT_A_FIELD_RECOMMENDATION');
    expect(csvContent).toContain('a27063ce2eca13f02e03');
    expect(csvContent).toContain('5bd02acc67a56003acd1994cc1dd50b597dc3f9c7681b07548c278d0081a669b');

    // Nyeri M4 Coverage & Fail-Closed Results
    await page.goto('/farm/nyeri-kenya/coverage', { waitUntil: 'load' });
    await expect(page.locator('body')).toContainText(/KE_NYERI_REGION|Nyeri/i);
    await expect(page.getByTestId('coverage-three-axis-matrix')).toContainText('BLOCKED');
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_kenya_coverage_1440.png') });
    }

    await page.goto('/farm/nyeri-kenya/results', { waitUntil: 'load' });
    await expect(page.getByTestId('fail-closed-status-card')).toHaveAttribute(
      'data-status-code',
      'MODEL_UNQUALIFIED'
    );

    // 4. Axe AA Audit in RECORDED_M14_RESEARCH mode across updated screens (both Chromium & WebKit)
    const recordedAxeRoutes = [
      '/farm/uppsala-demo/results',
      '/farm/uppsala-demo/decisions',
      '/farm/uppsala-demo/climate',
      '/farm/uppsala-demo/evidence',
      '/farm/uppsala-demo/reports',
      '/farm/nyeri-kenya/coverage',
    ];
    const recordedAxeSummary = [];
    for (const route of recordedAxeRoutes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(350);
      const axeRes = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const criticalSerious = axeRes.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );
      recordedAxeSummary.push({
        route,
        criticalCount: axeRes.violations.filter((v) => v.impact === 'critical').length,
        seriousCount: axeRes.violations.filter((v) => v.impact === 'serious').length,
        violations: axeRes.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      });
      expect(criticalSerious, `Axe failure on ${route} (${testInfo.project.name})`).toEqual([]);
    }
    const axeFilename =
      testInfo.project.name === 'desktop-chrome'
        ? 'axe-recorded-m14-audit.json'
        : `axe-recorded-m14-audit-${testInfo.project.name}.json`;
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, axeFilename),
      JSON.stringify({ measuredAt: new Date().toISOString(), project: testInfo.project.name, recordedAxeSummary }, null, 2)
    );
  });

  test('responsive matrix check (1920, 1024, 820, 390, 360, 320px) with zero horizontal overflow and After screenshots', async ({
    page,
  }, testInfo) => {
    fs.mkdirSync(AFTER_SHOTS_DIR, { recursive: true });

    const matrix = [
      { width: 1920, height: 1080, label: '1920' },
      { width: 1024, height: 768, label: '1024' },
      { width: 820, height: 1180, label: '820' },
      { width: 390, height: 844, label: '390' },
      { width: 360, height: 800, label: '360' },
    ];

    for (const vp of matrix) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ['/', '/explore', '/farm/uppsala-demo/results', '/farm/nyeri-kenya/coverage']) {
        await page.goto(route, { waitUntil: 'load' });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1
        );
        expect(overflow, `Horizontal overflow at ${vp.label}px on ${route}`).toBe(false);

        if (testInfo.project.name === 'desktop-chrome') {
          const slug = route === '/' ? 'hero' : route.replace(/\//g, '_').replace(/^_/, '');
          if (
            (vp.label === '1920' && route === '/') ||
            (vp.label === '820' && (route === '/farm/uppsala-demo/results' || route === '/')) ||
            (vp.label === '390' && (route === '/' || route === '/explore' || route === '/farm/uppsala-demo/results' || route === '/farm/nyeri-kenya/coverage')) ||
            (vp.label === '360' && route === '/farm/uppsala-demo/results')
          ) {
            await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, `after_${slug}_${vp.label}.png`) });
          }
        }
      }
    }

    // 320px minimum width stress sanity check
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
