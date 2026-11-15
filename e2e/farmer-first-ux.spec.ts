import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const AFTER_SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots/after');
const EVIDENCE_DIR = path.resolve(process.cwd(), 'review/evidence');

test.describe('ASTRAGRON Farmer-First UX Acceptance Suite', () => {
  test.beforeAll(() => {
    fs.mkdirSync(AFTER_SHOTS_DIR, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test('F1/F2: Simplified nav chrome, empty My Farms state, storage disclosure, and protected research examples', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'load' });

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'My Farms' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Explore Map' })).toBeVisible();
    await expect(nav.getByRole('button', { name: /Help \/ More/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Add Farm/i }).first()).toBeVisible();

    await page.goto('/farms', { waitUntil: 'load' });
    await expect(page.getByTestId('my-farms-empty-state')).toBeVisible();
    await expect(page.getByTestId('my-farms-your-section')).toContainText('Your Farms (0)');
    await expect(page.getByTestId('my-farms-examples-section')).toContainText('Research Examples');
    await expect(page.locator('body')).toContainText(/Saved on this device/i);
  });

  test('F3/F4/F5: 3-stage Add Farm -> truthful analysis -> Report PDF download -> Ask ASTRAGRON -> Lifecycle & Backup', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/farm/new', { waitUntil: 'load' });

    // Stage 1: Where is your farm?
    await expect(page.getByRole('heading', { name: /1\. Where is your farm\?/i })).toBeVisible();
    await page.locator('#wizard-farm-name').fill('Oakridge Valley Plots');
    await page.locator('#wizard-place-search').fill('Nyeri');
    await page.getByRole('option', { name: /Nyeri Highland Reference/i }).first().click();
    await page.getByRole('button', { name: /Continue \(1\/3\)/i }).click();

    // Stage 2: Mark your fields
    await expect(page.getByRole('heading', { name: /2\. Mark your fields/i })).toBeVisible();
    await page.getByTestId('wizard-other-boundary-ways').locator('summary').click();
    await page.getByRole('button', { name: /Generate plot outline on map/i }).click();
    await page.getByRole('button', { name: /Continue \(2\/3\)/i }).click();

    // Stage 3: Review & save + optional soil/water disclosure collapsed by default
    await expect(page.getByRole('heading', { name: /3\. Review & save/i })).toBeVisible();
    const optionalAgronomy = page.getByTestId('wizard-optional-agronomy');
    await expect(page.locator('#wizard-sowing-date')).toBeHidden();

    // Verify date chronology validation inside optional disclosure
    await optionalAgronomy.locator('summary').click();
    await expect(page.locator('#wizard-sowing-date')).toBeVisible();
    await page.locator('#wizard-harvest-date').fill('2026-01-01');
    await page.getByTestId('wizard-save-and-analyze-btn').click();
    await expect(page.getByRole('alert', { name: 'Wizard validation error' })).toBeVisible();
    await page.locator('#wizard-harvest-date').fill('2027-08-24');

    // Save farm & run truthful analysis
    await page.getByTestId('wizard-save-and-analyze-btn').click();
    await page.waitForURL(/\/farm\/custom-[^/]+\/analysis/);

    const urlMatch = page.url().match(/\/farm\/(custom-[^/]+)\/analysis/);
    expect(urlMatch).not.toBeNull();
    const customFarmId = urlMatch![1]!;

    const jobCard = page.getByTestId('analysis-job-status');
    await expect(jobCard).toBeVisible({ timeout: 15000 });
    await expect(jobCard).toHaveAttribute('data-analysis-status', 'COMPLETED_LIMITED');
    const persistedJobId = await jobCard.getAttribute('data-job-id');
    expect(persistedJobId).toMatch(/^job-/);
    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_analysis_1440.png') });
    }

    // Verify Job ID survives reload cleanly (UX-033)
    await page.goto(`/farm/${customFarmId}/analysis`, { waitUntil: 'load' });
    await expect(page.getByTestId('analysis-job-status')).toHaveAttribute('data-job-id', persistedJobId!);

    await page.getByTestId('analysis-open-report-link').click();
    await page.waitForURL(/\/farm\/custom-[^/]+\/results/);

    // Verify farmer report, saved history, no fabricated crop recommendation, and valid PDF binary download
    await expect(page.getByTestId('farmer-report-hero')).toBeVisible();
    await expect(page.getByTestId('report-history-bar')).toContainText('Saved Report History (1)');
    expect(await page.getByText('38,420.50').count()).toBe(0);

    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByTestId('download-pdf-btn').click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();
    const pdfBytes = fs.readFileSync(pdfPath!);
    const pdfAscii = pdfBytes.toString('latin1');
    expect(pdfAscii.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfAscii.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdfAscii).toContain('EVIDENCE AVAILABILITY REPORT -- NO CROP RECOMMENDATION AVAILABLE');

    // Ask ASTRAGRON: visibly disabled offline, interactive deterministic Report Guide works cleanly
    await expect(page.getByTestId('ask-astragron-unavailable')).toBeVisible();
    await page.getByRole('button', { name: 'Explain this report' }).click();
    await expect(page.getByTestId('ask-astragron-report-guide')).toBeVisible();

    // Edit inputs on this farm and confirm stale report warning renders on /results
    await page.goto(`/farm/new?from=${customFarmId}`, { waitUntil: 'load' });
    await page.getByRole('button', { name: /3\. Review & save/i }).click();
    await page.getByTestId('wizard-optional-agronomy').locator('summary').click();
    await page.locator('#wizard-sowing-date').fill('2027-05-05');
    await page.getByRole('button', { name: /Open Report View/i }).click();
    await page.waitForURL(/\/farm\/custom-[^/]+\/results/);
    await expect(page.getByTestId('stale-report-warning')).toBeVisible();

    // Returning-user Hero CTA shows Open My Farms (1)
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('hero-primary-farmer-cta')).toContainText(/Open My Farms/i);

    // My Farms lifecycle: Rename -> Duplicate -> Backup export -> Tampered reject -> Delete -> Restore backup
    await page.goto('/farms', { waitUntil: 'networkidle' });
    const card = page.getByTestId(`farm-card-${customFarmId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Oakridge Valley Plots');

    await card.getByRole('button', { name: /Manage Oakridge Valley Plots/i }).click();
    await card.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByRole('textbox', { name: 'New farm name' }).fill('Oakridge Renamed');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(card).toContainText('Oakridge Renamed');

    await card.getByRole('button', { name: /Manage Oakridge Renamed/i }).click();
    await card.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.getByTestId('my-farms-your-section')).toContainText('Your Farms (2)');

    // Export backup JSON
    const backupDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export backup' }).click();
    const backupDownload = await backupDownloadPromise;
    const backupPath = await backupDownload.path();
    const validBackupRaw = fs.readFileSync(backupPath!, 'utf8');

    // Attempt tampered backup import -> must fail closed on checksum
    const tampered = JSON.parse(validBackupRaw) as { farms: Record<string, { name: string }> };
    tampered.farms[customFarmId]!.name = 'Tampered Name';
    const tamperedPath = path.join(EVIDENCE_DIR, `tampered-backup-${testInfo.project.name}.json`);
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
    await page.locator('input[aria-label="Import farm backup JSON"]').setInputFiles(tamperedPath);
    await expect(page.getByTestId('backup-status-notice')).toContainText(/checksum mismatch/i);

    // Confirm delete removes farm cleanly, then valid backup restores it
    await card.getByRole('button', { name: /Manage Oakridge Renamed/i }).click();
    await card.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByTestId(`confirm-delete-${customFarmId}`).click();
    await expect(page.getByTestId(`farm-card-${customFarmId}`)).toHaveCount(0);

    await page.locator('input[aria-label="Import farm backup JSON"]').setInputFiles(backupPath!);
    await expect(page.getByTestId('backup-status-notice')).toContainText(/Restored/i);
    await expect(page.getByTestId(`farm-card-${customFarmId}`)).toBeVisible();

    if (fs.existsSync(tamperedPath)) fs.unlinkSync(tamperedPath);
    expect(pageErrors).toEqual([]);
  });

  test('F4/F5/F6: Recorded Uppsala Report + Ask ASTRAGRON + Axe WCAG AA + Responsive After Screenshots', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/farm/uppsala-demo/results', { waitUntil: 'load' });
    await expect(page.getByTestId('farmer-report-hero')).toBeVisible();

    await page.goto('/farm/uppsala-demo/chat', { waitUntil: 'load' });
    await expect(page.getByTestId('chat-scope-badge')).toContainText('uppsala-demo');
    await expect(page.getByTestId('ask-astragron-unavailable')).toBeVisible();

    if (testInfo.project.name === 'desktop-chrome') {
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_chat_1440.png') });

      await page.goto('/', { waitUntil: 'load' });
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_home_1440.png') });

      await page.goto('/farms', { waitUntil: 'load' });
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_farms_1440.png') });

      await page.goto('/farm/new', { waitUntil: 'load' });
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_wizard_1440.png') });

      await page.goto('/farm/uppsala-demo/results', { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_results_1440.png') });
    }

    // Axe WCAG AA across core farmer-first pages
    const axeRoutes = ['/', '/farms', '/farm/new', '/farm/uppsala-demo/results', '/farm/uppsala-demo/chat'];
    const axeSummary = [];
    for (const route of axeRoutes) {
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const severe = res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      axeSummary.push({
        route,
        criticalSeriousCount: severe.length,
        violations: severe.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      });
      expect(severe, `Axe failure on ${route}`).toEqual([]);
    }
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, `axe-farmer-first-${testInfo.project.name}.json`),
      JSON.stringify({ measuredAt: new Date().toISOString(), project: testInfo.project.name, axeSummary }, null, 2)
    );

    // Zero horizontal overflow across phone/tablet widths + mobile After screenshots
    for (const vp of [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 820, height: 1180 },
    ]) {
      await page.setViewportSize(vp);
      for (const route of ['/', '/farms', '/farm/new', '/farm/uppsala-demo/results', '/farm/uppsala-demo/chat']) {
        await page.goto(route, { waitUntil: 'load' });
        await page.waitForTimeout(100);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1
        );
        expect(overflow, `Overflow at ${vp.width}px on ${route}`).toBe(false);
        if (testInfo.project.name === 'desktop-chrome' && vp.width === 390) {
          if (route === '/') {
            await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_home_390.png') });
          } else if (route === '/farm/uppsala-demo/results') {
            await page.screenshot({ path: path.join(AFTER_SHOTS_DIR, 'after_results_390.png') });
          }
        }
      }
    }
  });
});
