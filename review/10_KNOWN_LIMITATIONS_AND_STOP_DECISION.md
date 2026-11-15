# 10 — Known Limitations, Disclosed Gaps & Stop Decision

## 1. Explicit Limitations & Untested Targets
1. **Scientific Backend Unconnected (`BACKEND_NOT_CONNECTED`):** This deliverable is strictly the frontend workspace. Choosing `REAL_SCIENTIFIC_BACKEND` fails closed until Codex/backend engineers implement authenticated API endpoints in `src/adapters/repositories.ts`.
2. **Recorded M14 Corpus Absent (`SOURCE_NOT_PROVIDED`):** Raw M14 corpus files are outside this package; `RECORDED_M14_RESEARCH` remains fail-closed by design.
3. **Firefox Browser Engine (`NOT_TESTED`):** Playwright tests ran and passed across both **Chromium (`desktop-chrome`)** and **WebKit (`webkit-desktop`)**, while Firefox was not installed in the verification environment and was not executed.
4. **Physical Mobile/Tablet Devices (`NOT_TESTED`):** All `320px`–`1920px` responsive layouts and touch drawers were verified in production browser emulation (`Chromium` + `WebKit`), not on physical Android/iOS hardware.
5. **4x CPU Throttle Skipped on WebKit (`NOT_APPLICABLE_NO_CDP`):** Chrome DevTools Protocol `Emulation.setCPUThrottlingRate` exists only in Chromium; WebKit skipped `e2e/orbit-ab-benchmark.spec.ts` cleanly (`1` skipped test).
6. **Hardware Battery & Organic CrUX Field `INP` (`NOT_MEASURED`):** Synthetic Playwright click timings (`inpMs` `32–160 ms`) are reported honestly per trial; physical hardware mWh energy draw and real-world CrUX p75 distributions cannot be measured reliably in CI.
7. **Commercial Redistribution of Proprietary Commissioned Images:** The three raster editorial hero/watershed JPEGs (`public/assets/*.jpg`) are commissioned proprietary review visuals rather than CC0 public domain and require explicit creator authorization for public redistribution outside private review (`review/08_ASSET_PROVENANCE_AND_REDISTRIBUTION.md`).
8. **External EO Tile Uptime & Historical Vintage:** Default Sentinel-2 imagery (`EOxCloudless 2016`, `CC BY 4.0`) is strictly a `2016` mosaic (`maxNativeZoom: 14`, no uptime SLA); OpenFreeMap depends on fair-use public endpoints (`ODbL`). Outages fall back locally to Natural Earth `CC0` vector layers.

---

## 2. Legacy Review Files Preserved for Traceability
Existing V4 baseline files in `review/` (`00_FINAL_EXECUTIVE_REPORT_AR.md`–`15_CODEX_REMEDIATION_AND_3D_AB_REPORT_AR.md`, `V3_BASELINE_MANIFEST_SNAPSHOT.json`, `V42_BASELINE_MANIFEST_SNAPSHOT.json`) and older baseline evidence (`review/evidence/eox-license-check.json`, `responsive-overflow-matrix.json`, `tile-network-proof.json`, `unit-and-e2e-summary.json`, `review/videos/04_orbit_ab_3d_benchmark.webm`) remain archived alongside the newly authored V5 suite (`FINAL_V5_IMPLEMENTATION_STATUS_AR.md`, `01_REQUIREMENT_TO_EVIDENCE_MATRIX.csv`–`11_DELIVERY_MANIFEST.json`, `perf-benchmark-raw.json`, `axe-audit-*.json`, `playwright-*.{json,xml}`, `01..03*.webm`). Consult the V5 files (`review/FINAL_V5_IMPLEMENTATION_STATUS_AR.md` and `review/01`–`11`) as authoritative for the final state.

---

## 3. Final Stop Decision

### **`FRONTEND_READY_FOR_CODEX_INTEGRATION_REVIEW`**

- **Rationale:**
  - All `P0` scientific integrity requirements (`G01`–`G04`: canonical `inputRevision` invalidation across navigation/reload, strict `siteId + datasetMode` isolation, 3-axis M4 separation with ocean `OUT_OF_COVERAGE`, honest CSV/JSON provenance export) pass in both Vitest (`52/52`) and multi-engine Playwright E2E.
  - Real `PerformanceObserver` + `web-vitals@6.2.3` instrumentation drives an evidence-backed hero decision keeping `/` fast and responsive (`364 ms` cold LCP) while repairing `/orbit-ab` WebGL/Landsat 8 `GLB` rendering (`60.1 FPS`, `Landsat 8 GLB: YES`, `Occluded: NO`).
  - `/explore` delivers a genuine interactive 3D MapLibre globe (`84` HTTP 200 live tiles verified), GeoJSON upload, geolocation, signed DMS, and HTTP `403` failover/retry recovery.
  - Final production build, typecheck, ESLint (`0` errors/warnings), mobile offline gates (`9/9`), multi-engine E2E (`37` passed, `0` failed, `1` skipped WebKit CDP benchmark), and `@axe-core/playwright` WCAG 2.0/2.1 AA (`0` violations across `8` routes × `2` engines) are verified cleanly.
- **No public deployment performed; stopping upon verified ZIP delivery.**
