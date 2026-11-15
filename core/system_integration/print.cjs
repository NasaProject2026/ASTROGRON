// Private offline browser export. Never launch a provider or fetch a remote asset.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(process.argv[2]);
const {chromium} = require(path.join(process.env.ASTRAGRON_NODE_MODULES, 'playwright'));
(async () => {
  const browser = await chromium.launch({executablePath: process.env.ASTRAGRON_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, args: ['--no-first-run', '--disable-extensions']});
  const blocked = [];
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 960}});
    await page.route('**/*', r => /^https?:/.test(r.request().url()) ? (blocked.push(r.request().url()), r.abort()) : r.continue());
    await page.goto(pathToFileURL(path.join(root, 'Farm_Decision_Summary.html')).href, {waitUntil: 'load', timeout: 15000});
    await page.evaluate(() => document.fonts.ready);
    const checks = [];
    for (const width of [1280, 390]) {
      await page.setViewportSize({width, height: 960});
      const state = await page.evaluate(() => ({lang: document.documentElement.lang, dir: document.documentElement.dir,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        overflowingCells: [...document.querySelectorAll('td,th')].filter(x => x.scrollWidth > x.clientWidth + 2).length,
        arabic: /[\u0600-\u06ff]/.test(document.body.innerText),
        numericBindings: [...document.querySelectorAll('.numeric')].map(x => ({pointer: x.dataset.source, raw: JSON.parse(x.dataset.value), display: x.innerText})),
        pagesDesigned: document.querySelectorAll('.page').length}));
      if (state.lang !== 'en' || state.dir !== 'ltr' || state.horizontalOverflow || state.overflowingCells || state.arabic) throw Error('REPORT_LAYOUT_FAILED');
      checks.push({width, ...state});
      await page.screenshot({path: path.join(root, width === 390 ? 'Mobile_Preview.png' : 'Desktop_Preview.png'), fullPage: true});
    }
    await page.emulateMedia({media: 'print'});
    await page.pdf({path: path.join(root, 'Farm_Decision_Summary_Mobile_Print.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true});
    await page.setViewportSize({width: 1280, height: 960});
    await page.pdf({path: path.join(root, 'Farm_Decision_Summary.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: '<div style="font:8px Arial;width:100%;text-align:center;color:#52676d">ASTRAGRON | Research comparison | <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
    fs.writeFileSync(path.join(root, 'Browser_Print_Receipt.json'), JSON.stringify({browser: await browser.version(), checks, blockedExternalRequests: blocked, generatedAt: new Date().toISOString()}, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(() => { console.error('REPORT_EXPORT_FAILED'); process.exitCode = 1; });
