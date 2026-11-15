/** Static UX invariants. These are NOT substitute for responsive browser tests. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const nav = read('src/components/navigation/app-chrome.tsx');
const landing = read('src/components/hero/cinematic-landing.tsx');
const explorer = read('src/components/maps/earth-explorer-client.tsx');
const cases = [
  ['tablet menu remains available until lg breakpoint', () => {
    assert.match(nav, /className="flex items-center gap-2 lg:hidden"/);
    assert.match(nav, /className="hidden lg:flex items-center gap-3"/);
    assert.match(nav, /className="border-t border-\[#29455A\][^"\n]*lg:hidden/);
  }],
  ['mobile workspace navigation starts collapsed with active stage shown', () => {
    assert.match(nav, /Research navigation/);
    assert.match(nav, /<span className="block truncate">\{activeStage\}<\/span>/);
    assert.match(nav, /<nav aria-label="Farm research workflow stages" className="lg:hidden">[\s\S]*?<details className="group/);
  }],
  ['desktop research sections use semantic disclosures', () => {
    assert.match(nav, /defaultOpen=\{containsActivePage\}/);
    assert.match(nav, /containsActivePage = grp\.items\.some/);
  }],
  ['workflow links retain safe target and focus minimums', () => {
    assert.match(nav, /min-h-\[44px\]/);
    assert.match(nav, /aria-current=\{active \? 'page'/);
    assert.match(nav, /focus-visible:outline-2/);
  }],
  ['original hero image persists for public visitors', () => {
    assert.match(landing, /orbital-earth-horizon-wide\.jpg/);
    assert.match(landing, /orbital-earth-horizon-mobile\.jpg/);
    assert.doesNotMatch(landing, /setOrbitLabEnabled|orbital-motion-study|<iframe/);
  }],
  ['landing uses single primary action and one less prominent demo link', () => {
    assert.match(landing, /href="\/explore"/);
    assert.match(landing, /href="\/farm\/uppsala-demo\/results"/);
    assert.match(landing, /hover:underline/);
  }],
  ['mobile explorer sites consolidated into one select', () => {
    assert.match(explorer, /id="explorer-mobile-site"/);
    assert.match(explorer, /className="hidden sm:flex max-w-full flex-nowrap/);
  }],
  ['map view options collapsed by default on mobile but open on desktop', () => {
    assert.match(explorer, /showMobileMapSettings/);
    assert.match(explorer, /aria-controls="explorer-map-view-settings"/);
    assert.match(explorer, /sm:flex flex-wrap items-center justify-between/);
  }],
  ['site switching uses one labelled native select', () => {
    assert.match(landing, /htmlFor="landing-coverage-site"/);
    assert.match(landing, /<select[\s\S]*?id="landing-coverage-site"/);
    assert.match(landing, /PREVIEW_SITES\.map\(\(item\) => \([\s\S]*?<option/);
  }],
];
let passed = 0;
for (const [name, run] of cases) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}
console.log(`${passed}/${cases.length} offline UI source invariants passed. Not a production browser test.`);
