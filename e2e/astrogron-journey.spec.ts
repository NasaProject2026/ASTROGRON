import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots');
const VIDEOS_DIR = path.resolve(process.cwd(), 'review/videos');

function ensureArtifactDirs() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

test.describe('ASTROGRON Real Production Browser Verification Suite (G2–G6)', () => {
  test.beforeAll(() => {
    ensureArtifactDirs();
  });

  test('1. Desktop 1440x900: Full-Bleed Orbital Hero -> Live 3D Globe -> Uppsala Results -> Kenya Isolation', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    const tileResponses: Array<{ provider: string; url: string; status: number }> = [];

    const liveTileAudit = process.env.ASTROGRON_LIVE_TILE_AUDIT === '1';
    if (!liveTileAudit) {
      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
        'base64'
      );
      await page.route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng })
      );
    }

    page.on('pageerror', (err) => {
      const msg = err.message;
      if (
        testInfo.project.name === 'webkit-desktop' &&
        (/127\.0\.0\.1:\d+.*due to access control checks\.$/i.test(msg) ||
          /ChunkLoadError: Failed to load chunk \/_next\/static\/chunks\/.*from module/.test(msg))
      ) {
        return;
      }
      pageErrors.push(msg);
    });
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('tiles.openfreemap.org')) {
        tileResponses.push({ provider: 'openfreemap', url, status: res.status() });
      } else if (url.includes('tiles.maps.eox.at')) {
        tileResponses.push({ provider: 'eox-s2cloudless-2016', url, status: res.status() });
      } else if (url.includes('gibs.earthdata.nasa.gov')) {
        tileResponses.push({ provider: 'nasa-gibs-blue-marble', url, status: res.status() });
      }
    });

    // 1. Landing Hero Verification
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const heroImg = page.locator('img[alt*="Earth horizon"]').first();
    await expect(heroImg).toBeVisible();
    const imgMetrics = await heroImg.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { complete: img.complete, naturalWidth: img.naturalWidth, currentSrc: img.currentSrc };
    });
    expect(imgMetrics.complete).toBe(true);
    expect(imgMetrics.naturalWidth).toBeGreaterThan(800);
    expect(imgMetrics.currentSrc).toContain('orbital-earth-horizon-wide.jpg');

    // Confirm zero fake HUD card overlay inside hero & crisp visible CTA
    const heroSection = page.locator('section').first();
    const heroExploreCta = heroSection.getByRole('link', { name: /Explore Earth/i });
    const heroDemoCta = heroSection.getByRole('link', { name: /View a Research Demo/i });
    await expect(heroExploreCta).toBeVisible();
    await expect(heroDemoCta).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '01_landing_desktop_1440.png') });

    // 2. Navigate to /explore -> Real Interactive 3D MapLibre Globe (NO 2D toggle click!)
    await heroExploreCta.click();
    await page.waitForURL('**/explore**');

    const globeContainer = page.getByTestId('maplibre-3d-canvas');
    await expect(globeContainer).toBeVisible();
    await expect(globeContainer).toHaveAttribute('data-webgl-status', 'READY', { timeout: 25000 });
    await expect(globeContainer).toHaveAttribute('data-map-projection', 'globe');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="maplibre-3d-canvas"]');
      return el && Number(el.getAttribute('data-countries-loaded') || '0') >= 170;
    });

    // Wait until NASA GIBS Blue Marble tiles arrive cleanly (and OpenFreeMap when live-auditing CDNs)
    await expect
      .poll(
        () =>
          tileResponses.filter((r) => r.provider === 'nasa-gibs-blue-marble' && r.status === 200).length,
        { timeout: 15000 }
      )
      .toBeGreaterThanOrEqual(4);
    if (liveTileAudit) {
      await expect
        .poll(() => tileResponses.filter((r) => r.provider === 'openfreemap' && r.status === 200).length, {
          timeout: 15000,
        })
        .toBeGreaterThanOrEqual(4);
    }
    await page.waitForTimeout(800);

    // Ensure ZERO duplicate Uppsala preset buttons
    expect(await page.locator('[data-testid^="preset-btn-uppsala"]').count()).toBe(1);
    expect(
      await page
        .getByRole('group', { name: 'Reference site presets' })
        .getByRole('button', { name: /Uppsala/i })
        .count()
    ).toBe(1);

    // Confirm 3D globe sits immediately visible in first desktop viewport
    const globeBox = await globeContainer.boundingBox();
    expect(globeBox).not.toBeNull();
    expect(globeBox!.y).toBeLessThan(260);
    expect(globeBox!.height).toBeGreaterThan(450);

    await page.screenshot({ path: path.join(SHOTS_DIR, '02_explore_globe_orbital_1440.png') });

    // Prove genuine interactive 3D globe panning changes live camera coordinates
    const initialCenter = await globeContainer.getAttribute('data-live-center');
    const canvas = globeContainer.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.54);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.44, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const draggedCenter = await globeContainer.getAttribute('data-live-center');
    expect(draggedCenter).not.toBe(initialCenter);

    // Fly down to Uppsala local satellite imagery (World -> Local parcel level)
    await page.getByTestId('preset-btn-uppsala-demo').click();
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="maplibre-3d-canvas"]');
      return el && Number(el.getAttribute('data-live-zoom') || '0') >= 9.0;
    }, null, { timeout: 15000 });
    await expect
      .poll(
        () =>
          tileResponses.filter((r) => r.provider === 'eox-s2cloudless-2016' && r.status === 200).length,
        { timeout: 15000 }
      )
      .toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS_DIR, '02b_explore_satellite_uppsala_1440.png') });

    // Record live tile network proof JSON
    const tileSummary = {
      capturedAt: new Date().toISOString(),
      mode: liveTileAudit ? 'LIVE_CDN' : 'DETERMINISTIC_MOCK_FIXTURE',
      totalCapturedTileResponses: tileResponses.length,
      http200Count: tileResponses.filter((r) => r.status === 200).length,
      byProvider: {
        openfreemap: tileResponses.filter((r) => r.provider === 'openfreemap' && r.status === 200).length,
        eoxS2Cloudless2016: tileResponses.filter((r) => r.provider === 'eox-s2cloudless-2016' && r.status === 200).length,
        nasaGibsBlueMarble: tileResponses.filter((r) => r.provider === 'nasa-gibs-blue-marble' && r.status === 200).length,
      },
      sampleUrls: tileResponses.filter((r) => r.status === 200).slice(0, 10),
    };
    fs.writeFileSync(path.join(SHOTS_DIR, 'tile-network-proof.json'), JSON.stringify(tileSummary, null, 2));

    // Switch to Nyeri Kenya -> Verify Fail-Closed Isolation Notice
    await page.getByTestId('preset-btn-nyeri-kenya').click();
    await expect(page.getByTestId('explorer-active-site-title')).toContainText(/Nyeri/i);
    await expect(page.getByText(/Fail-Closed Domain Isolation/i)).toBeVisible();

    // Return to Uppsala, test invalid coordinate alert, Boundary & EO layers tabs
    await page.getByTestId('preset-btn-uppsala-demo').click();
    await page.getByTestId('explorer-coord-lon').fill('999');
    await page.getByTestId('explorer-coord-lat').fill('12');
    await page.getByTestId('explorer-apply-coords-btn').click();
    await expect(page.getByTestId('explorer-coord-error')).toBeVisible();

    await page.getByTestId('inspector-tab-layers').click();
    await page.getByText(/NASA POWER/i).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS_DIR, '03_explore_boundary_layers_1440.png') });

    // 3. Wizard Flow
    await page.getByTestId('open-farm-workspace-btn').click();
    await page.waitForURL('**/farm/new**');
    await expect(page.getByRole('heading', { name: /Add or Edit Your Farm|Configure Farm/i })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '04_farm_wizard_1440.png') });

    // 4. Uppsala Research Results (Simple -> Scientific toggle & Provenance Drawer + Escape)
    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'networkidle' });
    await expect(page.getByText(/38,420\.50/i).first()).toBeVisible();
    await expect(page.getByText(/0 of 12/i).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '05_uppsala_results_1440.png') });

    const sciToggle = page.getByRole('button', { name: /Scientific/i }).first();
    if (await sciToggle.isVisible()) {
      await sciToggle.click();
    }

    const evBtn = page.getByRole('button', { name: /Evidence|Provenance/i }).first();
    await evBtn.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '06_provenance_drawer_1440.png') });
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // 5. Plans, Climate, Reports
    await page.goto('/farm/uppsala-demo/plans', { waitUntil: 'networkidle' });
    await expect(page.getByText(/Crop/i).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '07_uppsala_plans_1440.png') });

    await page.goto('/farm/uppsala-demo/climate', { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS_DIR, '08_uppsala_climate_1440.png') });

    await page.goto('/farm/uppsala-demo/reports', { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(SHOTS_DIR, '09_uppsala_reports_1440.png') });

    // 6. Site Isolation (Kenya Blocked) & Unknown Site Fail-Closed
    await page.goto('/farm/nyeri-kenya/results', { waitUntil: 'networkidle' });
    await expect(page.getByText(/OUT_OF_COVERAGE|NOT AVAILABLE|BLOCKED/i).first()).toBeVisible();
    expect(await page.getByText('SYNTH-POL-01').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS_DIR, '10_kenya_isolation_blocked_1440.png') });

    await page.goto('/farm/non-existent-phantom-999/results', { waitUntil: 'networkidle' });
    await expect(page.getByText(/SITE_NOT_FOUND/i).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, '11_unknown_site_not_found_1440.png') });

    expect(pageErrors).toEqual([]);

    // Copy recorded Playwright video into review/videos
    const vid = page.video();
    if (vid) {
      await page.close();
      const srcPath = await vid.path();
      if (srcPath && fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(VIDEOS_DIR, '01_desktop_earth_to_field_journey.webm'));
      }
    }
    void testInfo;
  });

  test('2. Simulated WebGL Failure (?mapFallback=1): Fail-Closed 2D Natural Earth Fallback', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/explore?mapFallback=1', { waitUntil: 'networkidle' });

    const fallback = page.getByTestId('maplibre-2d-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('data-render-status', 'FALLBACK_ONLY');
    await expect(fallback.getByRole('alert')).toContainText(/FALLBACK_ONLY/i);
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="maplibre-2d-fallback"]');
      return el && Number(el.getAttribute('data-countries-loaded') || '0') >= 170;
    });
    await page.screenshot({ path: path.join(SHOTS_DIR, '02c_explore_webgl_fallback_2d.png') });
  });

  test('3. Mobile 390x844, Landscape 844x390, Reduced Motion & 11-Width Zero-Overflow Matrix', async ({
    page,
  }) => {
    // Portrait Mobile 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const mobileSrc = await page.locator('img[alt*="Earth horizon"]').first().evaluate(
      (el) => (el as HTMLImageElement).currentSrc
    );
    expect(mobileSrc).toContain('orbital-earth-horizon-mobile.jpg');
    await page.screenshot({ path: path.join(SHOTS_DIR, '12_landing_mobile_390.png') });

    await page.goto('/explore', { waitUntil: 'networkidle' });
    const globe = page.getByTestId('maplibre-3d-canvas');
    await expect(globe).toHaveAttribute('data-webgl-status', 'READY', { timeout: 25000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    const mobileGlobeBox = (await globe.boundingBox())!;
    expect(mobileGlobeBox.y).toBeLessThan(380);
    await page.screenshot({ path: path.join(SHOTS_DIR, '13_explore_globe_mobile_390.png') });

    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(SHOTS_DIR, '14_uppsala_results_mobile_390.png') });

    // Mobile Landscape 844x390
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/explore', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('maplibre-3d-canvas')).toHaveAttribute('data-webgl-status', 'READY', {
      timeout: 25000,
    });
    await page.waitForTimeout(1200);
    const landscapeOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(landscapeOverflow).toBe(false);
    await page.screenshot({ path: path.join(SHOTS_DIR, '15_explore_landscape_844x390.png') });

    // All 11 required widths overflow audit on / and /explore
    const widths = [320, 360, 375, 390, 430, 768, 820, 1024, 1280, 1440, 1920];
    const overflowMatrix: Array<{ width: number; route: string; scrollWidth: number; innerWidth: number; ok: boolean }> = [];

    for (const width of widths) {
      await page.setViewportSize({ width, height: 840 });
      for (const route of ['/', '/explore', '/farm/uppsala-demo/results']) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        const ok = m.scrollWidth <= m.innerWidth + 1;
        overflowMatrix.push({ width, route, ...m, ok });
        expect(ok, `Overflow on ${route} at ${width}px: ${m.scrollWidth} > ${m.innerWidth}`).toBe(true);
      }
    }
    fs.writeFileSync(
      path.join(SHOTS_DIR, 'responsive-overflow-matrix.json'),
      JSON.stringify(overflowMatrix, null, 2)
    );

    // Reduced motion check
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('section').first().getByRole('link', { name: /Explore Earth/i })).toBeVisible();

    const vid = page.video();
    if (vid) {
      await page.close();
      const srcPath = await vid.path();
      if (srcPath && fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(VIDEOS_DIR, '02_mobile_390_earth_to_results.webm'));
      }
    }
  });

  test('4. Immutable Uppsala Fork, Signed DMS Sync, Multi-Route Fail-Closed & Escape Focus Return', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    const liveTileAudit = process.env.ASTROGRON_LIVE_TILE_AUDIT === '1';
    if (!liveTileAudit) {
      const tinyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
        'base64'
      );
      await page.route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: tinyPng,
        })
      );
    }

    page.on('pageerror', (err) => {
      const msg = err.message;
      // WebKit on Windows emits transient C++ fetch/script cancellation notices during rapid multi-route page.goto transitions
      if (
        testInfo.project.name === 'webkit-desktop' &&
        (/127\.0\.0\.1:\d+.*due to access control checks\.$/i.test(msg) ||
          /ChunkLoadError: Failed to load chunk \/_next\/static\/chunks\/.*from module/.test(msg))
      ) {
        return;
      }
      pageErrors.push(msg);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/explore', { waitUntil: 'networkidle' });

    const globe = page.getByTestId('maplibre-3d-canvas');
    await expect(globe).toHaveAttribute('data-webgl-status', 'READY', { timeout: 25000 });

    // Test signed negative DMS parsing + sign/hemisphere conflict rejection
    await page.getByRole('button', { name: 'DMS', exact: true }).click();
    await page.getByTestId('explorer-dms-lon').fill('-17° 30\' 00"');
    await page.getByTestId('explorer-dms-lat').fill('-12° 20\' 00"');
    await page.getByTestId('explorer-apply-dms-btn').click();
    await expect(page.getByText('-12.3333°, -17.5000°')).toBeVisible();

    await page.getByTestId('explorer-dms-lon').fill('-17° E');
    await page.getByTestId('explorer-apply-dms-btn').click();
    await expect(page.getByTestId('explorer-coord-error')).toBeVisible();

    // Select Uppsala, switch to Boundary tab, modify Vertex 1 longitude -> forks to custom-uppsala-*
    await page.getByTestId('preset-btn-uppsala-demo').click();
    await expect(page.getByTestId('explorer-three-axis-status')).toBeVisible();
    await page.getByTestId('inspector-tab-boundary').click();
    const v1Lon = page.getByLabel('Vertex 1 longitude');
    await v1Lon.fill('17.638');
    await page.getByTestId('open-farm-results-btn').click();

    await page.waitForURL(/\/farm\/custom-uppsala-[^/]+\/results/);
    await page.waitForLoadState('networkidle');
    const forkedUrl = page.url();
    const forkedIdMatch = forkedUrl.match(/\/farm\/(custom-uppsala-[^/]+)\/results/);
    expect(forkedIdMatch).not.toBeNull();
    const forkedId = forkedIdMatch![1]!;

    // Verify fail-closed across /results, /plans, /climate, /decisions, /reports
    await expect(page.getByTestId('fail-closed-status-card')).toHaveAttribute(
      'data-status-code',
      'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
    );
    expect(await page.getByText('SYNTH-POL-01').count()).toBe(0);
    await page.screenshot({ path: path.join(SHOTS_DIR, '16_custom_uppsala_fork_blocked_1440.png') });

    for (const subRoute of ['plans', 'climate', 'decisions', 'reports']) {
      await page.goto(`/farm/${forkedId}/${subRoute}`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('fail-closed-status-card')).toHaveAttribute(
        'data-status-code',
        'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'
      );
      expect(await page.getByText('SYNTH-POL-01').count()).toBe(0);
    }

    // Confirm untouched /farm/uppsala-demo/results remains 100% intact across reload
    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(/38,420\.50/i).first()).toBeVisible();

    // Keyboard Escape focus return on Provenance Drawer
    const evTrigger = page.getByRole('button', { name: /Inspect Decision Evidence/i }).first();
    await evTrigger.focus();
    await evTrigger.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(focusedText).toContain('Inspect Decision Evidence');

    expect(pageErrors).toEqual([]);
  });

  test('5. Real WebGL 3D Tile Outage Fallback & Non-Overlapping Attribution Bar at 1024px', async ({
    page,
  }) => {
    // Abort ALL remote satellite & vector tile hosts WITHOUT setting ?mapFallback=1
    await page.route('**/*tiles.maps.eox.at**', (route) => route.abort('failed'));
    await page.route('**/*tiles.openfreemap.org**', (route) => route.abort('failed'));
    await page.route('**/*gibs.earthdata.nasa.gov**', (route) => route.abort('failed'));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/explore', { waitUntil: 'domcontentloaded' });

    const globe = page.getByTestId('maplibre-3d-canvas');
    await expect(globe).toHaveAttribute('data-webgl-status', 'READY', { timeout: 25000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="maplibre-3d-canvas"]');
      return el && Number(el.getAttribute('data-countries-loaded') || '0') >= 170;
    });

    // Zoom to Uppsala so EOX tile requests also fire and fail loudly into IMAGERY_PROVIDER_BLOCKED
    await page.getByTestId('preset-btn-uppsala-demo').click();
    await expect(globe).toHaveAttribute('data-render-status', 'IMAGERY_PROVIDER_BLOCKED', {
      timeout: 20000,
    });
    // Step out to Basin zoom (z6.5) so Natural Earth 1:110m coastlines + Baltic Sea are clearly visible behind the amber outage alert
    await page.getByTestId('zoom-stop-region').click();
    await page.waitForTimeout(800);
    await expect(globe).toHaveAttribute('data-render-status', 'IMAGERY_PROVIDER_BLOCKED');
    await expect(
      page.getByText(/Remote satellite\/vector tile endpoints blocked or offline/i)
    ).toBeVisible();
    await page.screenshot({
      path: path.join(SHOTS_DIR, '17_webgl_tile_outage_natural_earth_3d_1440.png'),
    });

    // Unroute and verify 1024px bottom toolbar non-collision
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/explore', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('maplibre-3d-canvas')).toHaveAttribute('data-webgl-status', 'READY', {
      timeout: 25000,
    });
    const attrPill = page.getByTestId('globe-attribution-pill');
    const drawBtn = page.getByTestId('map-draw-toggle-btn');
    if (await attrPill.isVisible()) {
      const aBox = (await attrPill.boundingBox())!;
      const dBox = (await drawBtn.boundingBox())!;
      const horizontalOverlap = aBox.x < dBox.x + dBox.width && aBox.x + aBox.width > dBox.x;
      const verticalOverlap = aBox.y < dBox.y + dBox.height && aBox.y + aBox.height > dBox.y;
      expect(horizontalOverlap && verticalOverlap).toBe(false);
    }

    const vid = page.video();
    if (vid) {
      await page.close();
      const srcPath = await vid.path();
      if (srcPath && fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(VIDEOS_DIR, '03_custom_fork_and_outage.webm'));
      }
    }
  });
});
