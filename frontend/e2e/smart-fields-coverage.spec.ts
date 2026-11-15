import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SMART_AFTER_DIR = path.resolve(process.cwd(), 'review/screenshots/smart_after');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64'
);

test.describe('ASTRAGRON Smart Fields & Globe Coverage Acceptance Suite', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SMART_AFTER_DIR, { recursive: true });
  });

  test('SF-1: Neutral start on Add Farm, worldwide mocked geocoding, direct coordinates, and Explorer capability toggle', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov|due to access control checks/i.test(e.message)) {
        pageErrors.push(e.message);
      }
    });

    await page.context().route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: TINY_PNG,
      })
    );

    await page.route('**/api/geocode**', async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      if (q.includes('heilbronn')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            status: 'OK',
            providerConfigured: true,
            notice: 'Found 1 matching location.',
            results: [
              {
                id: 'geo-heilbronn',
                label: 'Heilbronn, Baden-Württemberg, Germany',
                shortName: 'Heilbronn',
                country: 'Germany',
                countryCode: 'DE',
                region: 'Baden-Württemberg',
                placeType: 'city',
                lon: 9.2206,
                lat: 49.1427,
                bbox: [9.14, 49.09, 9.28, 49.19],
              },
            ],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          status: 'OK',
          providerConfigured: true,
          notice: 'No results.',
          results: [],
        }),
      });
    });

    // 1. Explore Map: Search Heilbronn -> Neutral status + Toggle Analysis Availability overlay
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/explore', { waitUntil: 'load' });
    await expect(page.getByTestId('maplibre-3d-canvas')).toHaveAttribute('data-webgl-status', 'READY', {
      timeout: 25000,
    });

    await page.getByTestId('explorer-search-input').fill('Heilbronn');
    await page.getByRole('button', { name: /Heilbronn, Baden-Württemberg/i }).first().click();
    await expect(page.getByTestId('explorer-capability-status')).toContainText(/UNKNOWN_UNASSESSED|Unassessed/i);

    await page.getByTestId('toggle-capability-overlay-btn').click();
    await expect(page.getByTestId('capability-overlay-legend')).toBeVisible();
    await page.waitForTimeout(900);
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'explore_overlay.png') });
    }

    // 2. Add Farm: Verify neutral world start (NOT Uppsala), location requirement, and PlaceSearchBox autocomplete
    await page.goto('/farm/new', { waitUntil: 'load' });
    await expect(page.locator('body')).toContainText('No location selected yet');
    await page.getByRole('button', { name: /Continue \(1\/3\)/i }).click();
    await expect(page.getByRole('alert', { name: 'Wizard validation error' })).toBeVisible();

    await page.locator('#wizard-place-search').fill('Heilbronn');
    const heilOption = page.getByRole('option', { name: /Heilbronn, Baden-Württemberg/i }).first();
    await expect(heilOption).toBeVisible({ timeout: 10000 });
    await heilOption.click();
    await expect(page.locator('body')).toContainText('49.1427°');

    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'wizard_search.png') });
    }

    // Also prove instant offline direct decimal coordinate entry jumps accurately
    await page.locator('#wizard-place-search').fill('33.5102, 36.2913');
    const coordOpt = page.getByRole('option', { name: /Jump to exact coordinates/i });
    await expect(coordOpt).toBeVisible();
    await coordOpt.click();
    await expect(page.locator('body')).toContainText('33.5102°');

    expect(pageErrors).toEqual([]);
  });

  test('SF-2: FTW boundary suggestion preview/accept, manual draw/undo/redo, KML/GPX/XXE import, and GPS walk', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov|due to access control checks/i.test(e.message)) {
        pageErrors.push(e.message);
      }
    });

    await page.context().route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: TINY_PNG,
      })
    );

    // Inject deterministic browser GPS walk emitter + high-accuracy fix for Stage 2 GPS perimeter test
    await page.addInitScript(() => {
      const walkCoords = [
        [9.2185, 49.1415],
        [9.2215, 49.1415],
        [9.2215, 49.1438],
        [9.2185, 49.1438],
      ];
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (cb: PositionCallback) => {
            cb({
              coords: {
                latitude: 49.1427,
                longitude: 9.2206,
                accuracy: 8,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
                toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            });
          },
          watchPosition: (cb: PositionCallback) => {
            walkCoords.forEach(([lon, lat], idx) => {
              setTimeout(() => {
                cb({
                  coords: {
                    latitude: lat,
                    longitude: lon,
                    accuracy: 6,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null,
                    toJSON: () => ({}),
                  },
                  timestamp: Date.now() + idx * 60_000,
                  toJSON: () => ({}),
                });
              }, (idx + 1) * 90);
            });
            return 42;
          },
          clearWatch: () => {},
        },
      });
    });

    await page.route('**/api/field-boundaries/suggest**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          httpStatus: 200,
          status: 'FOUND',
          providerConfigured: true,
          attribution: 'Fields of The World (FTW) / Source Cooperative · CC BY 4.0',
          disclaimer: 'Satellite-estimated boundary · inspect against imagery and adjust corners before saving.',
          notice: 'Found 1 complete parcel.',
          rejectedFragmentsCount: 0,
          suggestions: [
            {
              id: 'ftw-mock-parcel-1',
              sourceFeatureId: 'ftw-mock-parcel-1',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [9.218, 49.141],
                    [9.223, 49.1412],
                    [9.2232, 49.1439],
                    [9.2195, 49.1444],
                    [9.2178, 49.1427],
                    [9.218, 49.141],
                  ],
                ],
              },
              areaHa: 12.64,
              areaAcres: 31.23,
              perimeterMeters: 1440,
              sourceDataset: 'Fields of The World (FTW)',
              sourceYear: 2025,
              license: 'CC BY 4.0',
              attribution: 'Fields of The World (FTW) (2025) · CC BY 4.0',
              rawModelScore: 92,
              modelConfidence: 0.92,
              scoreSemantics: 'UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100',
              scoreDisclaimer:
                'Raw model score is uncalibrated and reflects the upstream FTW segmentation output, not legal parcel accuracy.',
              sourceVerifiedComplete: false,
              geometryPassedLocalChecks: true,
              disclaimer:
                'Satellite-estimated boundary · inspect against imagery and adjust corners before saving.',
            },
          ],
        }),
      })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/farm/new', { waitUntil: 'load' });
    await page.locator('#wizard-farm-name').fill('Neckar Valley Irregular Field');
    await page.getByRole('button', { name: /Use my location/i }).first().click();
    await expect(page.locator('body')).toContainText('49.1427°');
    await page.getByRole('button', { name: /Continue \(1\/3\)/i }).click();

    // Stage 2: Draw irregular 5-corner field manually FIRST on clean canvas, verify Undo & polygon close
    await expect(page.getByRole('heading', { name: /2\. Mark your fields/i })).toBeVisible();
    await page.getByTestId('draw-field-corners-btn').click();
    await expect(page.getByTestId('map-draw-toggle-btn')).toContainText('Tap Map Corners');
    const mapCanvas = page.getByTestId('maplibre-3d-canvas').locator('canvas').first();
    await mapCanvas.scrollIntoViewIfNeeded();
    const cBox = (await mapCanvas.boundingBox())!;
    const offsets: Array<[number, number]> = [
      [0.35, 0.35],
      [0.65, 0.35],
      [0.65, 0.58],
      [0.45, 0.58],
      [0.35, 0.46],
    ];
    for (const [ox, oy] of offsets) {
      await page.mouse.click(cBox.x + cBox.width * ox, cBox.y + cBox.height * oy);
      await page.waitForTimeout(80);
    }
    await expect(page.getByTestId('complete-drawn-polygon-btn')).toBeVisible();
    await page.getByTestId('complete-drawn-polygon-btn').click();
    await expect(page.getByTestId('smart-field-editor')).toContainText('Manual vertices');
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'wizard_polygon_draw.png') });
    }

    // Also test Undo / Redo buttons remain enabled & interactive
    await page.getByRole('button', { name: 'Undo corner change' }).click();
    await page.getByRole('button', { name: 'Redo corner change' }).click();

    // Now test FTW Satellite Suggestion -> inspect CC BY 4.0 + uncalibrated score caveats -> accept
    await page.getByTestId('suggest-ftw-boundary-btn').click();
    await expect(page.getByTestId('ftw-suggestion-card')).toContainText('CC BY 4.0');
    await expect(page.getByTestId('ftw-suggestion-card')).toContainText(/uncalibrated/i);
    await page.getByTestId('accept-ftw-suggestion-btn').click();
    await expect(page.getByTestId('smart-field-editor')).toContainText('12.64 ha');
    await expect(page.getByTestId('evidence-and-limitations')).toContainText('Evidence & limitations');

    // Open More options: verify GPS tree canopy disclosure, KML import, XXE rejection, and simulated GPS perimeter walk
    await page.getByTestId('wizard-other-boundary-ways').locator('summary').click();
    await expect(page.getByTestId('wizard-other-boundary-ways')).toContainText(/tree canopy/i);
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'wizard_other_ways.png') });
    }

    await page.getByTestId('import-boundary-textarea').fill(
      '<kml><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>9.218,49.141,0 9.222,49.141,0 9.222,49.144,0 9.218,49.144,0 9.218,49.141,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>'
    );
    await page.getByTestId('apply-imported-boundary-btn').click();
    await expect(page.getByTestId('smart-field-editor')).toContainText('Imported KML boundary');

    // XXE attack string must fail closed with error
    await page.getByTestId('import-boundary-textarea').fill('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><kml/>');
    await page.getByTestId('apply-imported-boundary-btn').click();
    await expect(page.getByTestId('field-geometry-error')).toBeVisible();

    // GPS walk
    await page.getByTestId('gps-walk-start-btn').click();
    const gpsFinish = page.getByTestId('gps-walk-finish-btn');
    await expect(gpsFinish).toContainText('4 pts', { timeout: 5000 });
    await gpsFinish.click();
    await expect(page.getByTestId('smart-field-editor')).toContainText('Closed GPS walk boundary');

    expect(pageErrors).toEqual([]);
  });

  test('SF-3: Confirmed-unsupported region red toast with [Why?], non-blocking save, reload, and 390px mobile responsiveness', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov|due to access control checks/i.test(e.message)) {
        pageErrors.push(e.message);
      }
    });

    await page.context().route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: TINY_PNG,
      })
    );

    await page.setViewportSize({ width: 1440, height: 900 });

    // Gate G2 proof: custom farm at exact Svalbard benchmark coordinates returns UNKNOWN_UNASSESSED unless backed by a registered benchmark ID or verified capability polygon
    const g2CustomCheckRes = await page.request.post('/api/capabilities/site-check', {
      data: {
        coordinates: [15.6397, 78.2232],
        farmId: 'custom-svalbard-draft',
        isUserCreatedDraft: true,
      },
    });
    expect(g2CustomCheckRes.ok()).toBe(true);
    const g2CustomCheckBody = await g2CustomCheckRes.json();
    expect(g2CustomCheckBody.check.status).toBe('UNKNOWN_UNASSESSED');

    // Route UI site-check in this test to inspect the registered SJ_SVALBARD_POLAR unsupported capability record so the non-blocking unsupported UX is verified end-to-end
    await page.route('**/api/capabilities/site-check', async (route) => {
      const upstream = await page.request.post('/api/capabilities/site-check', {
        data: {
          coordinates: [15.6397, 78.2232],
          farmId: 'polar-svalbard',
          isUserModifiedDraft: false,
          isUserCreatedDraft: false,
          geometry: null,
        },
      });
      const json = await upstream.json();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(json),
      });
    });

    await page.goto('/farm/new', { waitUntil: 'load' });

    // Select Svalbard exact reference benchmark (78.2232° N, 15.6397° E) via manual coords -> triggers CONFIRMED_UNSUPPORTED toast
    await page.locator('#wizard-farm-name').fill('Svalbard Research Parcel');
    await page.getByTestId('wizard-manual-coords').locator('summary').click();
    await page.locator('#wizard-lon').fill('15.6397');
    await page.locator('#wizard-lat').fill('78.2232');

    const toast = page.getByTestId('capability-unsupported-toast');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText("This analysis isn't available here yet. You can still select and save your field.");
    await page.getByTestId('capability-toast-why-btn').click();
    await expect(toast).toContainText(/permafrost|High-Arctic|coverage/i);

    await page.getByTestId('toggle-capability-overlay-btn').click();
    await expect(page.getByTestId('capability-overlay-legend')).toBeVisible();
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'unsupported_toast_save.png') });
    }

    // Saving is NEVER blocked! Advance through Stage 2 -> Stage 3 -> Save
    await page.getByRole('button', { name: /Continue \(1\/3\)/i }).click();
    await page.getByTestId('wizard-other-boundary-ways').locator('summary').click();
    await page.getByRole('button', { name: /Generate plot outline on map/i }).click();
    await page.getByRole('button', { name: /Continue \(2\/3\)/i }).click();
    await expect(page.locator('body')).toContainText(/Saving is still safely|confirmed unsupported/i);

    await page.getByTestId('wizard-save-and-analyze-btn').click();
    await page.waitForURL(/\/farm\/custom-[^/]+\/analysis/);
    await expect(page.getByTestId('analysis-site-unsupported-notice')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('analysis-job-status')).toBeVisible({ timeout: 10000 });

    // Responsive 8-viewport check (320..1920px) + 390px screenshot & Axe accessibility scan
    await page.goto('/farm/new', { waitUntil: 'load' });
    const matrixViewports = [
      { width: 320, height: 640 },
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 820, height: 1180 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ];
    for (const vp of matrixViewports) {
      await page.setViewportSize(vp);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, `Overflow at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(1);
      if (vp.width === 390 && testInfo.project.name === 'desktop-chrome') {
        const searchBox = await page.locator('#wizard-place-search').boundingBox();
        const globeBox = await page.getByTestId('maplibre-3d-canvas').boundingBox();
        expect(searchBox).not.toBeNull();
        expect(globeBox).not.toBeNull();
        expect((searchBox?.y ?? 999) + (searchBox?.height ?? 0)).toBeLessThan(844);
        expect(globeBox?.y ?? 999).toBeLessThan(700);
        await page.screenshot({ path: path.join(SMART_AFTER_DIR, 'mobile_390.png') });
      }
    }

    // Axe accessibility check on /farm/new
    await page.setViewportSize({ width: 1280, height: 800 });
    const axe = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
    const critical = axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toEqual([]);

    expect(pageErrors).toEqual([]);
  });
});
