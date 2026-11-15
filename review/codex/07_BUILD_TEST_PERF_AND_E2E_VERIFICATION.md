# 07 — Static Analysis, Unit Suites, Production Build & Browser E2E Verification

All automated checks below were executed cleanly **after the final source/test edit** (`e2e/g6-integration-gates.spec.ts`):

| Verification Step | Command | Result Observed | Notes |
|---|---|---|---|
| TypeScript | `npm run typecheck` | Exit `0` (PASS) | Zero TS errors |
| ESLint | `npm run lint` | Exit `0` (PASS) | Zero ESLint errors/warnings |
| Unit & Security Suites | `npm test` (`vitest run`) | Exit `0`: `7` files, `71` tests passed (`9.93s`) | `g1-strict-schemas` (5), `contracts-and-adapters` (33), `g2-g3-recorded-m14-m4` (7), `remediation-gates` (8), `v4-precision-gates` (6), `p1-scientific-integrity` (5), `g4-geocoder-security` (7) |
| Offline UX Invariants | `node scripts/mobile-ux-offline-gates.mjs` | Exit `0`: `9 / 9` PASS | Explicitly documented as static/offline invariant check (not browser E2E) |
| Production Build | `npm run build` | Exit `0`: Next.js `16.4.6` (Turbopack) | Compiled `6.6s`, TS `8.3s`, `11/11` static routes + dynamic/API routes; `3` non-fatal dynamic `fs` trace warnings in `src/server/corpus-integrity.ts` |
| Full Browser E2E | `npx playwright test` | Exit `0`: `41 passed, 1 skipped, 0 failed` (`10.5m`) | Both `desktop-chrome` & `webkit-desktop`; `[webkit-desktop] orbit-ab-benchmark.spec.ts:298` expected CDP FPS skip |
| WCAG AA Accessibility | `@axe-core/playwright` (`axe-*.json`) | `0` critical / `0` serious / `0` total violations | Verified across `8` core routes + `6` Recorded M14/M4 routes on both `desktop-chrome` & `webkit-desktop` |
| Responsive Overflow | `responsive-overflow-matrix.json` | `33 / 33` entries `ok: true` | `320`, `360`, `375`, `390`, `430`, `768`, `820`, `844x390`, `1024`, `1440`, `1920` |
| Python Scripts | `VERIFY_CONTENTS.py`, `verify_review.py`, `m14_replay.py`, `m14_api.py` | `NOT_RUN_NO_PYTHON` | Python interpreter not present on host |
| Clean `npm ci` (in-place) | — | Not re-run in working copy | Clean extract verification uses existing `node_modules` / documents `npm ci` in `README_REPLAY.md` |

## Genuine Performance Benchmark (`review/evidence/perf-benchmark-raw.json`)
Measured via Chromium `PerformanceObserver` + CDP (`orbit-ab-benchmark.spec.ts`):
- **`staticCold`:** median LCP `308 ms`, CLS `0.01`, TBT `127 ms`, transfer `1,128,177` bytes
- **`staticWarm`:** median LCP `152 ms`, CLS `0`, TBT `0 ms`, transfer `18,728.5` bytes
- **`staticCpu4x`:** median LCP `1,164 ms`, CLS `0`, TBT `1,024 ms`
- **`orbit3dCold`:** median LCP `968 ms`, CLS `0`, TBT `949.5 ms`, transfer `4,047,276` bytes, FPS `60.1`, p95 `16.85 ms`
- **`orbit3dWarm`:** median LCP `284 ms`, CLS `0`, TBT `596.5 ms`, FPS `60.1`, p95 `16.8 ms`
- **`orbit3dCpu4x`:** median LCP `1,152 ms`, CLS `0.00055`, TBT `2,579 ms`, FPS `60.1`, p95 `16.7 ms`
*(Static hero remains `/` default due to `~2.92 MB` cold savings and `1.02s` vs `2.58s` 4x-CPU TBT.)*
