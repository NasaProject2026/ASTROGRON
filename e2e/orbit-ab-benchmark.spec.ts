import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Browser, type Page } from '@playwright/test';

const SHOTS_DIR = path.resolve(process.cwd(), 'review/screenshots');
const EVIDENCE_DIR = path.resolve(process.cwd(), 'review/evidence');

interface PerfSample {
  route: '/' | '/orbit-ab';
  mode: 'cold_unthrottled' | 'warm_unthrottled' | 'cold_cpu_4x';
  trial: number;
  ttfbMs: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  lcpElement: string | null;
  cls: number | null;
  inpMs: number | 'NOT_MEASURABLE';
  longTaskCount: number;
  maxLongTaskMs: number;
  tbtApproxMs: number;
  webglContextsCreated: number;
  totalTransferBytes: number;
  totalEncodedBytes: number;
  jsTransferBytes: number;
  glbTransferBytes: number;
  imageTransferBytes: number;
  orbitStageMetrics: {
    status: string | null;
    webglReady: boolean | null;
    fps: number | null;
    p95FrameMs: number | null;
    droppedFrames: number | null;
    satNdc: string | null;
    satOccluded: boolean | null;
    landsatLoaded: boolean | null;
  } | null;
  webVitalsApi: Record<string, { value: number; rating: string }> | null;
}

const OBSERVER_INIT_SCRIPT = () => {
  const g = window as unknown as {
    __PERF_STATE__?: {
      fcpMs: number | null;
      lcpMs: number | null;
      lcpElement: string | null;
      clsSessionValue: number;
      clsCurrentSession: number;
      clsFirstTs: number;
      clsLastTs: number;
      inpMaxMs: number | null;
      longTasks: number[];
      webglContextsCreated: number;
    };
  };

  g.__PERF_STATE__ = {
    fcpMs: null,
    lcpMs: null,
    lcpElement: null,
    clsSessionValue: 0,
    clsCurrentSession: 0,
    clsFirstTs: 0,
    clsLastTs: 0,
    inpMaxMs: null,
    longTasks: [],
    webglContextsCreated: 0,
  };

  // Count real WebGL context creations
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ) {
    if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') {
      if (g.__PERF_STATE__) g.__PERF_STATE__.webglContextsCreated += 1;
    }
    return origGetContext.apply(this, [contextId, options] as unknown as [string]);
  } as typeof HTMLCanvasElement.prototype.getContext;

  if (typeof PerformanceObserver === 'undefined') return;

  try {
    const paintObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint' && g.__PERF_STATE__) {
          g.__PERF_STATE__.fcpMs = Number(entry.startTime.toFixed(2));
        }
      }
    });
    paintObs.observe({ type: 'paint', buffered: true });
  } catch {
    // Paint observer unsupported
  }

  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & {
        element?: Element | null;
      };
      if (last && g.__PERF_STATE__) {
        g.__PERF_STATE__.lcpMs = Number(last.startTime.toFixed(2));
        g.__PERF_STATE__.lcpElement = last.element?.tagName ?? null;
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // LCP unsupported
  }

  try {
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { hadRecentInput?: boolean; value?: number }
      >) {
        if (!entry.hadRecentInput && typeof entry.value === 'number' && g.__PERF_STATE__) {
          const ts = entry.startTime;
          if (
            g.__PERF_STATE__.clsCurrentSession === 0 ||
            (ts - g.__PERF_STATE__.clsLastTs < 1000 && ts - g.__PERF_STATE__.clsFirstTs < 5000)
          ) {
            if (g.__PERF_STATE__.clsCurrentSession === 0) g.__PERF_STATE__.clsFirstTs = ts;
            g.__PERF_STATE__.clsCurrentSession += entry.value;
          } else {
            g.__PERF_STATE__.clsFirstTs = ts;
            g.__PERF_STATE__.clsCurrentSession = entry.value;
          }
          g.__PERF_STATE__.clsLastTs = ts;
          if (g.__PERF_STATE__.clsCurrentSession > g.__PERF_STATE__.clsSessionValue) {
            g.__PERF_STATE__.clsSessionValue = g.__PERF_STATE__.clsCurrentSession;
          }
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
  } catch {
    // CLS unsupported
  }

  try {
    const evtObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { interactionId?: number; duration: number }
      >) {
        if (entry.interactionId && entry.interactionId > 0 && g.__PERF_STATE__) {
          const prev = g.__PERF_STATE__.inpMaxMs ?? 0;
          if (entry.duration > prev) g.__PERF_STATE__.inpMaxMs = Number(entry.duration.toFixed(2));
        }
      }
    });
    evtObs.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {
    // Event timing unsupported
  }

  try {
    const ltObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (g.__PERF_STATE__) {
          g.__PERF_STATE__.longTasks.push(Number(entry.duration.toFixed(2)));
        }
      }
    });
    ltObs.observe({ type: 'longtask', buffered: true });
  } catch {
    // Longtask unsupported
  }
};

async function collectSample(
  page: Page,
  route: '/' | '/orbit-ab',
  mode: PerfSample['mode'],
  trial: number
): Promise<PerfSample> {
  // Perform real lightweight pointer + button focus interaction to measure event timing
  const heading = page.locator('h1').first();
  if (await heading.isVisible()) {
    await heading.click({ force: true }).catch(() => {});
  }
  await page.waitForTimeout(route === '/orbit-ab' ? 2400 : 1200);

  const collected = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const g = (
      window as unknown as {
        __PERF_STATE__?: {
          fcpMs: number | null;
          lcpMs: number | null;
          lcpElement: string | null;
          clsSessionValue: number;
          inpMaxMs: number | null;
          longTasks: number[];
          webglContextsCreated: number;
        };
        __ASTRAGRON_WEB_VITALS__?: Record<string, { value: number; rating: string }>;
      }
    );

    const ps = g.__PERF_STATE__;
    const wv = g.__ASTRAGRON_WEB_VITALS__ ?? null;

    let totalTransfer = 0;
    let totalEncoded = 0;
    let jsBytes = 0;
    let glbBytes = 0;
    let imgBytes = 0;
    for (const r of resources) {
      const t = r.transferSize ?? 0;
      const e = r.encodedBodySize ?? 0;
      totalTransfer += t;
      totalEncoded += e;
      if (r.name.endsWith('.js') || r.initiatorType === 'script') jsBytes += t || e;
      else if (r.name.includes('.glb')) glbBytes += t || e;
      else if (/\.(jpg|jpeg|png|webp|svg)/i.test(r.name) || r.initiatorType === 'img') {
        imgBytes += t || e;
      }
    }

    const paintFcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    const lcpMs = ps?.lcpMs ?? wv?.LCP?.value ?? null;
    const fcpMs = ps?.fcpMs ?? (paintFcp !== undefined ? Number(paintFcp.toFixed(2)) : wv?.FCP?.value ?? null);
    const clsVal = ps ? Number(ps.clsSessionValue.toFixed(5)) : wv?.CLS?.value ?? null;
    const inpVal = ps?.inpMaxMs ?? wv?.INP?.value ?? null;
    const longTasks = ps?.longTasks ?? [];
    const tbtApproxMs = longTasks.reduce((acc, d) => acc + Math.max(0, d - 50), 0);

    const stage = document.querySelector('[data-testid="orbit-ab-stage"]');
    const orbitStageMetrics = stage
      ? {
          status: stage.getAttribute('data-orbit-ab-status'),
          webglReady: stage.getAttribute('data-webgl-ready') === 'true',
          fps: Number(stage.getAttribute('data-fps') ?? '0'),
          p95FrameMs: Number(stage.getAttribute('data-p95-frame-ms') ?? '0'),
          droppedFrames: Number(stage.getAttribute('data-dropped-frames') ?? '0'),
          satNdc: stage.getAttribute('data-sat-ndc'),
          satOccluded: stage.getAttribute('data-sat-occluded') === 'true',
          landsatLoaded: stage.getAttribute('data-landsat-loaded') === 'true',
        }
      : null;

    return {
      ttfbMs: nav ? Number((nav.responseStart - nav.requestStart).toFixed(2)) : null,
      fcpMs,
      lcpMs,
      lcpElement: ps?.lcpElement ?? null,
      cls: clsVal,
      inpMs: inpVal !== null ? Number(inpVal.toFixed(2)) : ('NOT_MEASURABLE' as const),
      longTaskCount: longTasks.length,
      maxLongTaskMs: longTasks.length > 0 ? Math.max(...longTasks) : 0,
      tbtApproxMs: Number(tbtApproxMs.toFixed(2)),
      webglContextsCreated: ps?.webglContextsCreated ?? 0,
      totalTransferBytes: totalTransfer,
      totalEncodedBytes: totalEncoded,
      jsTransferBytes: jsBytes,
      glbTransferBytes: glbBytes,
      imageTransferBytes: imgBytes,
      orbitStageMetrics,
      webVitalsApi: wv,
    };
  });

  return { route, mode, trial, ...collected };
}

function summarize(values: Array<number | null>) {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return { min: null, median: null, max: null, samples: 0 };
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 === 1 ? nums[mid]! : Number(((nums[mid - 1]! + nums[mid]!) / 2).toFixed(2));
  return { min: nums[0]!, median, max: nums[nums.length - 1]!, samples: nums.length };
}

async function waitForOrbitStageSettled(page: Page) {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="orbit-ab-stage"]');
        if (!el) return false;
        const st = el.getAttribute('data-orbit-ab-status') ?? '';
        if (st.startsWith('FALLBACK_')) return true;
        return (
          st === 'WEBGL_ACTIVE' &&
          el.getAttribute('data-webgl-ready') === 'true' &&
          el.getAttribute('data-landsat-loaded') === 'true'
        );
      },
      undefined,
      { timeout: 12000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1600);
}

test('P2 + P3 Genuine PerformanceObserver Benchmark & Multi-Viewport Visual A/B Capture', async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '4x CPU throttle + full benchmark runs on Chromium engine');
  test.setTimeout(300000);

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const origin = baseURL ?? 'http://127.0.0.1:3005';
  const samples: PerfSample[] = [];

  // 1. Unthrottled Cold (Fresh Context) + Warm Reload across 2 trials per route
  for (const route of ['/', '/orbit-ab'] as const) {
    for (let trial = 1; trial <= 2; trial++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(OBSERVER_INIT_SCRIPT);
      const page = await ctx.newPage();

      await page.goto(`${origin}${route}`, { waitUntil: 'load' });
      if (route === '/orbit-ab') await waitForOrbitStageSettled(page);
      samples.push(await collectSample(page, route, 'cold_unthrottled', trial));

      await page.reload({ waitUntil: 'load' });
      if (route === '/orbit-ab') await waitForOrbitStageSettled(page);
      samples.push(await collectSample(page, route, 'warm_unthrottled', trial));

      await ctx.close();
    }
  }

  // 2. Chromium CDP 4x CPU Throttled Cold Benchmark
  for (const route of ['/', '/orbit-ab'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(OBSERVER_INIT_SCRIPT);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.goto(`${origin}${route}`, { waitUntil: 'load' });
    if (route === '/orbit-ab') await waitForOrbitStageSettled(page);
    samples.push(await collectSample(page, route, 'cold_cpu_4x', 1));
    await ctx.close();
  }

  // 3. Multi-Viewport A/B Visual Capture & Zero-Intersection Check
  const viewports = [
    { key: '01_desktop_1440', w: 1440, h: 900 },
    { key: '02_desktop_1920', w: 1920, h: 1080 },
    { key: '03_tablet_portrait_820', w: 820, h: 1180 },
    { key: '04_tablet_landscape_1180', w: 1180, h: 820 },
    { key: '05_mobile_390', w: 390, h: 844 },
    { key: '06_mobile_360', w: 360, h: 800 },
    { key: '07_mobile_320', w: 320, h: 640 },
  ];

  const visualChecks: Array<{
    key: string;
    viewport: string;
    staticOverflowPx: number;
    orbit3dOverflowPx: number;
    orbitStatus: string | null;
    orbitWebglReady: boolean;
    landsatLoaded: boolean;
    satNdc: string | null;
    satClearedTextArea: boolean;
    staticShot: string;
    orbit3dShot: string;
  }> = [];

  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();

    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.waitForTimeout(550);
    const staticOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    const staticFile = `ab_${vp.key}_static.png`;
    await page.screenshot({ path: path.join(SHOTS_DIR, staticFile) });

    await page.goto(`${origin}/orbit-ab`, { waitUntil: 'load' });
    await waitForOrbitStageSettled(page);
    const orbitInfo = await page.evaluate(() => {
      const overflowPx = document.documentElement.scrollWidth - window.innerWidth;
      const stage = document.querySelector('[data-testid="orbit-ab-stage"]');
      const h1 = document.querySelector('#orbit-ab-hero-heading')?.getBoundingClientRect();
      const satNdcRaw = stage?.getAttribute('data-sat-ndc') ?? null;
      let satCleared = true;
      if (satNdcRaw && h1) {
        const [nxStr, nyStr] = satNdcRaw.split(',');
        const nx = Number(nxStr);
        const ny = Number(nyStr);
        if (Number.isFinite(nx) && Number.isFinite(ny) && (nx !== 0 || ny !== 0)) {
          const sx = ((nx + 1) * 0.5) * window.innerWidth;
          const sy = ((1 - ny) * 0.5) * window.innerHeight;
          const margin = 48;
          const hitsHeading =
            sx >= h1.left - margin &&
            sx <= h1.right + margin &&
            sy >= h1.top - margin &&
            sy <= h1.bottom + margin;
          satCleared = !hitsHeading;
        }
      }
      return {
        overflowPx,
        status: stage?.getAttribute('data-orbit-ab-status') ?? null,
        webglReady: stage?.getAttribute('data-webgl-ready') === 'true',
        landsatLoaded: stage?.getAttribute('data-landsat-loaded') === 'true',
        satNdc: satNdcRaw,
        satClearedTextArea: satCleared,
      };
    });
    const orbitFile = `ab_${vp.key}_orbit3d.png`;
    await page.screenshot({ path: path.join(SHOTS_DIR, orbitFile) });

    expect(staticOverflow).toBeLessThanOrEqual(0);
    expect(orbitInfo.overflowPx).toBeLessThanOrEqual(0);
    expect(orbitInfo.satClearedTextArea).toBe(true);

    visualChecks.push({
      key: vp.key,
      viewport: `${vp.w}x${vp.h}`,
      staticOverflowPx: staticOverflow,
      orbit3dOverflowPx: orbitInfo.overflowPx,
      orbitStatus: orbitInfo.status,
      orbitWebglReady: orbitInfo.webglReady,
      landsatLoaded: orbitInfo.landsatLoaded,
      satNdc: orbitInfo.satNdc,
      satClearedTextArea: orbitInfo.satClearedTextArea,
      staticShot: staticFile,
      orbit3dShot: orbitFile,
    });
    await ctx.close();
  }

  const groupSummary = (route: '/' | '/orbit-ab', mode: PerfSample['mode']) => {
    const rows = samples.filter((s) => s.route === route && s.mode === mode);
    return {
      trials: rows.length,
      ttfbMs: summarize(rows.map((r) => r.ttfbMs)),
      fcpMs: summarize(rows.map((r) => r.fcpMs)),
      lcpMs: summarize(rows.map((r) => r.lcpMs)),
      cls: summarize(rows.map((r) => r.cls)),
      tbtApproxMs: summarize(rows.map((r) => r.tbtApproxMs)),
      longTaskCount: summarize(rows.map((r) => r.longTaskCount)),
      totalTransferBytes: summarize(rows.map((r) => r.totalTransferBytes)),
      fps: summarize(rows.map((r) => r.orbitStageMetrics?.fps ?? null)),
      p95FrameMs: summarize(rows.map((r) => r.orbitStageMetrics?.p95FrameMs ?? null)),
    };
  };

  const report = {
    measuredAt: new Date().toISOString(),
    environment: {
      browserEngine: testInfo.project.name,
      cpuThrottleModes: ['1x (unthrottled cold & warm)', '4x (Chromium CDP Emulation)'],
      webglRendererTested: samples.some((s) => (s.webglContextsCreated ?? 0) > 0),
    },
    summaries: {
      staticCold: groupSummary('/', 'cold_unthrottled'),
      staticWarm: groupSummary('/', 'warm_unthrottled'),
      staticCpu4x: groupSummary('/', 'cold_cpu_4x'),
      orbit3dCold: groupSummary('/orbit-ab', 'cold_unthrottled'),
      orbit3dWarm: groupSummary('/orbit-ab', 'warm_unthrottled'),
      orbit3dCpu4x: groupSummary('/orbit-ab', 'cold_cpu_4x'),
    },
    visualChecks,
    rawSamples: samples,
  };

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'perf-benchmark-raw.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(SHOTS_DIR, 'orbit-ab-benchmark.json'), JSON.stringify(report, null, 2));

  // Verify core measurement sanity without hardcoded metrics
  expect(report.summaries.staticCold.lcpMs.samples).toBeGreaterThan(0);
  expect(report.summaries.orbit3dCold.lcpMs.samples).toBeGreaterThan(0);
});
