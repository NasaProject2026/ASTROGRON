import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const HEILBRONN_POLYGON = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [9.218, 49.138],
      [9.222, 49.138],
      [9.222, 49.142],
      [9.218, 49.142],
      [9.218, 49.138],
    ],
  ],
});

test.describe('ASTRAGRON Live Next.js + Python E2E Scientific Integration', () => {
  test('Capabilities endpoint, custom field analysis with real Python C1-C10 output, persistence across storage reset, and PDF export', async ({
    page,
  }) => {
    // 1. Confirm live Python scientific backend is actually connected to Next.js
    const capRes = await page.request.get('/api/capabilities');
    expect(capRes.ok()).toBe(true);
    const capJson = (await capRes.json()) as {
      liveFarmAnalysis: { enabled: boolean; mode: string };
      reportGroundedChat: { enabled: boolean; mode: string };
    };
    expect(capJson.liveFarmAnalysis.enabled).toBe(true);
    expect(capJson.liveFarmAnalysis.mode).toBe('BACKEND_CONNECTED');
    expect(capJson.reportGroundedChat.enabled).toBe(false);
    expect(capJson.reportGroundedChat.mode).toBe('NOT_CONNECTED');

    // 2. Create custom Heilbronn farm with matching WGS84 GeoJSON parcel
    await page.goto('/farm/new', { waitUntil: 'load' });
    await page.locator('#wizard-farm-name').fill('Kraichgau Live E2E Farm');

    const manualCoords = page.getByTestId('wizard-manual-coords');
    await manualCoords.locator('summary').click();
    await manualCoords.locator('textarea').fill(HEILBRONN_POLYGON);
    await manualCoords.getByRole('button', { name: 'Apply' }).click();

    await expect(page.locator('#wizard-lon')).toHaveValue(/^9\.218/);
    await expect(page.locator('#wizard-lat')).toHaveValue(/^49\.138/);
    // Center the site coordinate inside the parcel polygon at the exact Heilbronn reference point
    await page.locator('#wizard-lon').fill('9.22');
    await page.locator('#wizard-lat').fill('49.14');

    // 3. Save & run live scientific analysis via /farm/[id]/analysis
    await page.getByRole('button', { name: /3\.\s*Review/i }).click();
    await page.getByTestId('wizard-save-and-analyze-btn').click();
    await page.waitForURL(/\/farm\/(custom-[^/]+)\/analysis/);

    const match = page.url().match(/\/farm\/(custom-[^/]+)\/analysis/);
    expect(match).toBeTruthy();
    const customFarmId = match![1]!;

    const statusStrip = page.getByTestId('analysis-job-status');
    await expect(statusStrip).toBeVisible({ timeout: 30000 });
    await expect(statusStrip).toHaveAttribute('data-analysis-status', 'COMPLETED_LIMITED', {
      timeout: 30000,
    });
    const jobIdAttr = await statusStrip.getAttribute('data-job-id');
    expect(jobIdAttr).toMatch(/^job-py-/);
    await expect(statusStrip).toContainText('OK_COVERAGE_ONLY');

    const adaptiveSummary = page.getByTestId('analysis-adaptive-summary');
    await expect(adaptiveSummary).toBeVisible();
    await expect(adaptiveSummary).toContainText('REGIONAL_SCREENING_ONLY');

    // 4. Open server-generated report on /results and confirm scientific charts & honest caveats render
    await page.getByTestId('analysis-open-report-link').click();
    await page.waitForURL(new RegExp(`/farm/${customFarmId}/results`));
    await expect(page.getByTestId('farmer-report-hero')).toBeVisible();
    await expect(page.getByTestId('farmer-report-hero')).toContainText(
      /NASA POWER|SoilGrids|no crop recommendation/i
    );

    // 5. Simulate browser storage wipe (fresh sessionStorage + localStorage) and reopen /results & /reports
    // Verifies Next.js server persistence hydration via /api/farms & /api/reports
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('farmer-report-hero')).toBeVisible({ timeout: 15000 });

    // 6. Download binary PDF report from /reports using the server-persisted ReportEnvelope
    await page.goto(`/farm/${customFarmId}/reports`, { waitUntil: 'networkidle' });
    const pdfBtn = page.getByTestId('reports-download-pdf-btn');
    await expect(pdfBtn).toBeVisible({ timeout: 15000 });
    const pdfPromise = page.waitForEvent('download');
    await pdfBtn.click();
    const pdfDownload = await pdfPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();
    const pdfAscii = fs.readFileSync(pdfPath!).toString('latin1');
    expect(pdfAscii.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfAscii.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdfAscii).toContain('EVIDENCE AVAILABILITY REPORT -- NO CROP RECOMMENDATION AVAILABLE');
  });
});
