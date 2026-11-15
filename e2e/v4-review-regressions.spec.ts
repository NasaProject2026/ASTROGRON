import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

test('hero stays cinematic and does not display an experimental motion control', async ({ page }) => {
  await page.goto('/');
  const hero = page.getByTestId('hero-orbital-centerpiece');
  await expect(hero.locator('picture')).toBeVisible();
  await expect(page.getByTestId('orbital-motion-study')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview moving Earth and satellite illustration' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Explore Earth/i }).first()).toBeVisible();
  // Development-only reference stays accessible for quality comparison.
  const res = await page.request.get('/orbit-lab.html');
  expect(res.ok()).toBe(true);
});

test('390px workspace opens its navigation on demand, without clipped labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/farm/uppsala-demo/results');
  const workflow = page.getByRole('navigation', { name: 'Farm research workflow stages' });
  const expand = workflow.locator('summary');
  await expect(expand).toContainText(/Report|Decision Overview/);
  await expect(workflow.getByRole('link', { name: 'Provenance Center' })).toBeHidden();
  await expand.click();
  const link = workflow.getByRole('link', { name: 'Provenance Center' });
  await expect(link).toBeVisible();
  const metrics = await link.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const textBounds = node.querySelector('span')!.getBoundingClientRect();
    return { right: bounds.right, textRight: textBounds.right, width: innerWidth };
  });
  expect(metrics.right).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.textRight).toBeLessThanOrEqual(metrics.right + 1);
});

test('tablet 820px has an accessible navigation menu and Explore link', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Toggle navigation menu' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: /Explore Map|Explore Earth/ })).toBeVisible();
});

test('coverage preview is selectable using one labelled control', async ({ page }) => {
  await page.goto('/');
  const selection = page.getByRole('combobox', { name: 'Explore source coverage for:' });
  await selection.selectOption('nyeri-kenya');
  await expect(page.getByRole('heading', { name: 'Nyeri Highland Reference (Kenya)' })).toBeVisible();
});

test('390px Explorer keeps presets and basemap options accessible without default clutter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  const site = page.getByTestId('explorer-mobile-site-select');
  await expect(site).toBeVisible();
  await site.selectOption('nyeri-kenya');
  await expect(page.getByTestId('explorer-active-site-title')).toContainText(/Nyeri/i);

  const visualSettings = page.getByRole('button', { name: /Map view/ });
  await expect(visualSettings).toBeVisible();
  await expect(visualSettings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('basemap-vector_map-btn')).toBeHidden();
  await visualSettings.click();
  await expect(visualSettings).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('basemap-vector_map-btn')).toBeVisible();
  await expect(page.getByText('Imagery: EOxCloudless 2016', { exact: false })).toBeVisible();

  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(bodyOverflow).toBe(false);
});

test('restored /coverage route reachable from Overview, FailClosedStatusCard, and Wizard Step 5', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  // 1. From Farm Overview -> Full M4 Coverage Matrix
  await page.goto('/farm/uppsala-demo', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /Full M4 Coverage Matrix/i }).click();
  await page.waitForURL('**/farm/uppsala-demo/coverage**');
  const matrix = page.getByTestId('coverage-three-axis-matrix');
  await expect(matrix).toBeVisible();

  // Simple <-> Scientific mode switch reconciles labels on /coverage
  await page.getByRole('button', { name: /Scientific/i }).first().click();
  await expect(matrix).toContainText(/SOURCE_DATA_COVERAGE/i);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_coverage_uppsala_1280.png') });

  // 2. From FailClosedStatusCard on Nyeri Kenya Results -> /farm/nyeri-kenya/coverage
  await page.goto('/farm/nyeri-kenya/results', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /Inspect M4 Source Coverage for nyeri-kenya/i }).click();
  await page.waitForURL('**/farm/nyeri-kenya/coverage**');
  await expect(page.getByTestId('coverage-three-axis-matrix')).toBeVisible();
  await expect(page.getByText(/OUT_OF_COVERAGE/i).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_coverage_nyeri_1280.png') });

  // 3. From Setup Wizard Step 3 -> Review M4 Evidence Readiness
  await page.goto('/farm/new', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /3\. Review & save/i }).click();
  await page.getByRole('button', { name: /Review M4 Evidence Readiness/i }).click();
  await page.waitForURL('**/farm/*/coverage**');
  await expect(page.getByTestId('coverage-three-axis-matrix')).toBeVisible();
});

test('390px Plans Compare Two Policies parity renders comparison strip inside mobile cards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/farm/uppsala-demo/plans', { waitUntil: 'domcontentloaded' });
  const compareBtn = page.getByRole('button', { name: /Compare Two Policies/i });
  await expect(compareBtn).toBeVisible();
  await compareBtn.click();
  await expect(page.getByText(/vs Compare:/i).first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_plans_compare_mobile_390.png') });
});

test('HTTP 403 imagery tile block fails closed transparently and VECTOR_MAP recovers via OpenFreeMap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.route(/tiles\.maps\.eox\.at|gibs\.earthdata\.nasa\.gov/, (route) =>
    route.fulfill({ status: 403, contentType: 'text/plain', body: 'Forbidden' })
  );

  await page.goto('/explore', { waitUntil: 'domcontentloaded' });
  const canvasWrap = page.getByTestId('maplibre-3d-canvas');
  await expect(canvasWrap).toBeVisible();
  await expect(canvasWrap).toHaveAttribute('data-render-status', 'IMAGERY_PROVIDER_BLOCKED', {
    timeout: 20000,
  });
  await expect(canvasWrap).toHaveAttribute('data-provider-status', 'PERMISSION_BLOCKED');

  // Switch to Vector Map (OpenFreeMap) -> recovers cleanly to LIVE_REMOTE_AND_VECTOR
  await page.getByTestId('basemap-vector_map-btn').click();
  await expect(canvasWrap).toHaveAttribute('data-basemap-mode', 'VECTOR_MAP');
  await expect(canvasWrap).toHaveAttribute('data-render-status', 'LIVE_REMOTE_AND_VECTOR', {
    timeout: 20000,
  });
  await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_explore_403_recovery_1280.png') });
});

const AUDIT_ROUTES = [
  '/',
  '/explore',
  '/farm/uppsala-demo',
  '/farm/uppsala-demo/coverage',
  '/farm/uppsala-demo/results',
  '/farm/uppsala-demo/plans',
  '/farm/uppsala-demo/climate',
  '/farm/uppsala-demo/decisions',
  '/farm/uppsala-demo/reports',
  '/farm/new',
  '/methodology',
  '/help',
  '/settings',
];

test('responsive zero-overflow across phone widths (320, 360, 375, 390, 430, 844x390)', async ({
  page,
}) => {
  const viewports = [
    { width: 320, height: 640 },
    { width: 360, height: 780 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize(vp);
    for (const route of AUDIT_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1, h2');
      await page.waitForTimeout(80);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflow, `Horizontal overflow on ${route} at ${vp.width}x${vp.height}`).toBe(false);
      if (vp.width === 320 && route === '/farm/uppsala-demo/reports') {
        await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_reports_320.png') });
      }
    }
  }
});

test('responsive zero-overflow and crisp header layout across tablet & desktop (768, 820, 1024, 1440, 1920)', async ({
  page,
}) => {
  for (const vp of [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(vp);
    for (const route of AUDIT_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h1, h2');
      await page.waitForTimeout(80);
      const metrics = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
        const headerLinks = Array.from(
          document.querySelectorAll('header nav[aria-label="Main navigation"] a, header nav[aria-label="Main navigation"] button')
        ).map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent?.trim() ?? '', height: r.height, top: r.top, right: r.right };
        });
        const navRight = Math.max(0, ...headerLinks.map((l) => l.right));
        const complexityRect = document
          .querySelector('header [role="group"][aria-label="Information complexity mode"]')
          ?.getBoundingClientRect();
        return {
          overflow,
          headerLinks,
          navRight,
          complexityLeft: complexityRect?.left ?? 9999,
          complexityHeight: complexityRect?.height ?? 0,
          innerWidth: window.innerWidth,
        };
      });
      expect(metrics.overflow, `Horizontal overflow on ${route} at ${vp.width}x${vp.height}`).toBe(
        false
      );
      if (vp.width >= 1024) {
        expect(
          metrics.navRight,
          `Header nav overlaps right controls on ${route} at ${vp.width}`
        ).toBeLessThanOrEqual(metrics.complexityLeft);
        expect(
          metrics.complexityHeight,
          `Wrapped complexity switch on ${route} at ${vp.width}`
        ).toBeLessThanOrEqual(52);
        for (const link of metrics.headerLinks) {
          expect(
            link.height,
            `Wrapped/tall header item "${link.text}" on ${route} at ${vp.width}`
          ).toBeLessThanOrEqual(52);
          expect(
            link.right,
            `Clipped header item "${link.text}" on ${route} at ${vp.width}`
          ).toBeLessThanOrEqual(metrics.innerWidth + 1);
        }
        if (vp.width === 1024 && route === '/') {
          await page.screenshot({ path: path.join(SHOTS_DIR, 'v42_header_1024.png') });
        }
      }
    }
  }
});
