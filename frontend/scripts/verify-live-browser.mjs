import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const LIVE_SHOTS_DIR = path.join(ROOT, 'review', 'screenshots', 'live_after');
const RECORDINGS_DIR = path.join(ROOT, 'review', 'recordings');
const EVIDENCE_DIR = path.join(ROOT, 'review', 'evidence');
const PORT = 3006;
const BASE_URL = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(LIVE_SHOTS_DIR, { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/capabilities`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`Timed out waiting for production server at ${url}`);
}

async function main() {
  console.log('[LIVE-BROWSER] Starting production Next.js server on port', PORT);
  const serverProc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'start', '--port', String(PORT)],
    {
      cwd: ROOT,
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: 'production' },
    }
  );

  const networkLog = [];
  let browser;

  try {
    await waitForServer(BASE_URL);
    console.log('[LIVE-BROWSER] Production server ready at', BASE_URL);

    browser = await chromium.launch({ channel: 'msedge', headless: true });

    // Context 1: Recorded live desktop journey (Search Heilbronn -> FTW GeoParquet Parcel -> Accept -> Save -> Explore Damascus)
    const tempVideoDir = path.join(RECORDINGS_DIR, '_tmp_video');
    fs.mkdirSync(tempVideoDir, { recursive: true });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: {
        dir: tempVideoDir,
        size: { width: 960, height: 600 },
      },
    });

    const page = await context.newPage();

    page.on('response', async (res) => {
      const url = res.url();
      if (
        url.includes('/api/geocode') ||
        url.includes('/api/field-boundaries/suggest') ||
        url.includes('/api/capabilities')
      ) {
        let bodySnippet = null;
        try {
          bodySnippet = await res.json();
        } catch {
          // ignore non-json
        }
        networkLog.push({
          timestamp: new Date().toISOString(),
          url,
          status: res.status(),
          headers: {
            contentType: res.headers()['content-type'] ?? null,
            cacheControl: res.headers()['cache-control'] ?? null,
          },
          summary: bodySnippet
            ? {
                ok: bodySnippet.ok,
                status: bodySnippet.status,
                providerHost: bodySnippet.providerHost ?? bodySnippet.provider ?? null,
                resultCount: Array.isArray(bodySnippet.results)
                  ? bodySnippet.results.length
                  : Array.isArray(bodySnippet.suggestions)
                    ? bodySnippet.suggestions.length
                    : undefined,
                firstId:
                  bodySnippet.results?.[0]?.shortName ??
                  bodySnippet.suggestions?.[0]?.sourceFeatureId ??
                  bodySnippet.status ??
                  null,
              }
            : null,
        });
      }
    });

    // 1. Mobile 390x844 above-the-fold proof first (before desktop flow)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/farm/new`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '05_live_mobile_390_wizard.png'),
    });

    // 2. Desktop 1440x900 Live Search "Heilbronn" (100% UNMOCKED)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/farm/new`, { waitUntil: 'load' });
    await page.locator('#wizard-farm-name').fill('Neckar Live FTW Farm');
    const searchInput = page.locator('#wizard-place-search');
    await searchInput.click();
    await searchInput.fill('Heilbronn');

    const heilbronnOption = page.getByRole('option', { name: /Heilbronn/i }).first();
    await heilbronnOption.waitFor({ state: 'visible', timeout: 20000 });
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '01_live_wizard_search_heilbronn_1440.png'),
    });
    await heilbronnOption.click();
    await page.waitForTimeout(1200);

    // Also set exact Neckar farmland coordinate (9.14156, 48.98443) via coordinate search so Step 2 opens directly over the verified FTW parcel
    await searchInput.click();
    await searchInput.fill('48.98443, 9.14156');
    const exactCoordOpt = page.getByRole('option', { name: /Jump to exact coordinates/i });
    await exactCoordOpt.waitFor({ state: 'visible', timeout: 10000 });
    await exactCoordOpt.click();
    await page.waitForTimeout(900);

    // Advance to Step 2: Mark your fields
    await page.getByRole('button', { name: /Continue \(1\/3\)/i }).click();
    await page.getByRole('heading', { name: /2\. Mark your fields/i }).waitFor({ state: 'visible' });

    // Click "Suggest Field" -> hits real /api/field-boundaries/suggest -> HTTP Range GeoParquet from data.source.coop
    const suggestBtn = page.getByTestId('suggest-ftw-boundary-btn');
    await suggestBtn.click();

    const suggestionCard = page.getByTestId('ftw-suggestion-card');
    await suggestionCard.waitFor({ state: 'visible', timeout: 150000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '02_live_ftw_suggestion_preview_1440.png'),
    });

    // Confirm / Use & adjust corners
    await page.getByTestId('accept-ftw-suggestion-btn').click();
    await page.waitForTimeout(800);
    // Open Evidence & limitations disclosure for visual proof
    await page.getByTestId('evidence-and-limitations').locator('summary').click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '03_live_ftw_confirmed_and_edited_1440.png'),
    });

    // Advance to Step 3: Review & save
    await page.getByRole('button', { name: /Continue \(2\/3\)/i }).click();
    await page.getByRole('heading', { name: /3\. Review & save/i }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '04_live_step3_saved_farm_1440.png'),
    });

    // Save Farm & View Available Data
    await page.getByTestId('wizard-save-and-analyze-btn').click();
    await page.waitForURL(/\/farm\//, { timeout: 15000 });
    await page.waitForTimeout(800);

    // 3. Navigate to /explore -> Real unmocked search for "Damascus" + Toggle Analysis Availability
    await page.goto(`${BASE_URL}/explore`, { waitUntil: 'load' });
    const expSearch = page.getByTestId('explorer-search-input');
    await expSearch.click();
    await expSearch.fill('Damascus');
    const damascusHit = page.getByRole('button', { name: /Damascus/i }).first();
    await damascusHit.waitFor({ state: 'visible', timeout: 20000 });
    await damascusHit.click();
    await page.waitForTimeout(1200);
    await page.getByTestId('toggle-capability-overlay-btn').click();
    await page.getByTestId('capability-overlay-legend').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(LIVE_SHOTS_DIR, '06_live_explore_damascus_overlay_1440.png'),
    });

    const videoObj = page.video();
    await context.close();

    if (videoObj) {
      const recordedPath = await videoObj.path();
      const targetWebm = path.join(RECORDINGS_DIR, 'live_smart_fields_flow.webm');
      fs.copyFileSync(recordedPath, targetWebm);
      fs.rmSync(tempVideoDir, { recursive: true, force: true });
      console.log('[LIVE-BROWSER] Saved live recording:', targetWebm, fs.statSync(targetWebm).size, 'bytes');
    }

    // Build a compact 2x3 JPEG contact sheet using a clean page canvas
    const sheetCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const sheetPage = await sheetCtx.newPage();
    const shotFiles = [
      { file: '01_live_wizard_search_heilbronn_1440.png', title: '1. Live Unmocked Search: Heilbronn (/farm/new)' },
      { file: '02_live_ftw_suggestion_preview_1440.png', title: '2. Live FTW 2e GeoParquet Suggestion Preview' },
      { file: '03_live_ftw_confirmed_and_edited_1440.png', title: '3. Confirmed FTW Outline + Evidence & Limitations' },
      { file: '04_live_step3_saved_farm_1440.png', title: '4. Step 3 Neutral Capability + Non-Blocking Save' },
      { file: '05_live_mobile_390_wizard.png', title: '5. Mobile 390px: Search & Map Above Fold' },
      { file: '06_live_explore_damascus_overlay_1440.png', title: '6. Live Damascus Search + Honest Capability Overlay' },
    ];
    const cardsHtml = shotFiles
      .map((s) => {
        const b64 = fs.readFileSync(path.join(LIVE_SHOTS_DIR, s.file)).toString('base64');
        return `<div style="background:#0B1B2B;border:1px solid #29455A;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px;">
          <div style="font:600 13px system-ui,sans-serif;color:#72E4F1;">${s.title}</div>
          <img src="data:image/png;base64,${b64}" style="width:100%;height:390px;object-fit:contain;background:#040D17;border-radius:6px;" />
        </div>`;
      })
      .join('');
    await sheetPage.setContent(`<!doctype html><html><body style="margin:0;padding:18px;background:#050E1A;color:#F1F7FD;font-family:system-ui,sans-serif;">
      <h1 style="margin:0 0 12px;font-size:18px;color:#F1F7FD;">ASTRAGRON — Live Unmocked Smart Fields, GeoParquet Parcel & Scientific Coverage Proof</h1>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">${cardsHtml}</div>
    </body></html>`);
    await sheetPage.waitForTimeout(300);
    await sheetPage.screenshot({
      path: path.join(LIVE_SHOTS_DIR, 'LIVE_CONTACT_SHEET.jpg'),
      type: 'jpeg',
      quality: 80,
      fullPage: true,
    });
    await sheetCtx.close();

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'live-browser-network-log.json'),
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          baseUrl: BASE_URL,
          browserChannel: 'msedge (Chromium)',
          mockedRoutes: 0,
          capturedRequestsCount: networkLog.length,
          requests: networkLog,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    console.log('[LIVE-BROWSER] Completed live browser verification with', networkLog.length, 'captured API calls.');
  } finally {
    if (browser) await browser.close();
    serverProc.kill();
  }
}

main().catch((err) => {
  console.error('[LIVE-BROWSER] FAILED:', err);
  process.exit(1);
});
