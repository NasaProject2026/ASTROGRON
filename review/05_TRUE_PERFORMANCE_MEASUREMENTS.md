# 05 — True Performance Measurements & Methodology

## 1. Real Instrumentation Stack (Zero Fabricated Numbers)
- **Live Client Telemetry (`src/components/telemetry/web-vitals-reporter.tsx`):** Wired into root `app/layout.tsx` using the official **`web-vitals@6.2.3`** package (`onCLS`, `onFCP`, `onINP`, `onLCP`, `onTTFB`), publishing observed entries into `window.__ASTRAGRON_WEB_VITALS__` for runtime verification.
- **Production E2E Benchmark (`e2e/orbit-ab-benchmark.spec.ts` -> `review/evidence/perf-benchmark-raw.json`):** Measured on the production server (`next start --port 3005`) using genuine Chromium `PerformanceObserver` subscriptions (`largest-contentful-paint`, `paint`, `layout-shift`, `longtask`, `event`), `PerformanceNavigationTiming`, and `PerformanceResourceTiming` (`transferSize`).
- **Benchmark Timestamp:** `2026-11-13T12:29:51.159Z` (`desktop-chrome` engine; Chromium CDP used for `4x` CPU slowdown emulation).

---

## 2. True Cold, Warm & 4x CPU Throttle Results (`perf-benchmark-raw.json`)
All values reflect exact raw/median numbers observed in `review/evidence/perf-benchmark-raw.json`:

| Route & Condition | Trials | TTFB (ms) | FCP (ms) | **True LCP (ms)** | **Real CLS** | TBT Approx (ms) | Long Tasks | Transfer Size | Synth Click INP (ms) | WebGL FPS / p95 Frame |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`/` Cold (1x CPU)** | 2 | `6.25` (`5.6–6.9`) | `364` | **`364`** (`340–388`) | `0.01` (`0–0.02762`) | `164` | `2` | `1,083,501 B` | `40` / `56` | N/A (static `<picture>`) |
| **`/` Warm (1x CPU)** | 2 | `3.3` | `174` | **`174`** (`164–184`) | `0` | `0` | `0` | `18,712 B` | `48` / `56` | N/A |
| **`/` Cold (4x CPU)** | 1 | `17.1` | `1,056` | **`1,056`** | `0.02762` | `1,085` | `5` | `1,083,501 B` | `160` | N/A |
| **`/orbit-ab` Cold (1x CPU)** | 2 | `17.75` (`4.4–31.1`) | `296` | **`1,004`** (`812–1196`) | `0.00053–0.00064` | `991` (`613–1369`) | `5` | `4,002,602.5 B` | `48` / `56` | **`60.1 FPS` / `16.95 ms`** |
| **`/orbit-ab` Warm (1x CPU)** | 2 | `4.6` | `174` | **`466`** (`452–480`) | `0.00038–0.0006` | `656` (`583–729`) | `3` | `23,755.5 B` | `32` / `64` | **`60.1 FPS` / `16.85 ms`** |
| **`/orbit-ab` Cold (4x CPU)** | 1 | `3.8` | `356` | **`1,468`** | `0.00032` | `2,053` | `7` | `4,002,602 B` | `40` | **`60.1 FPS` / `16.7 ms`** |

---

## 3. Compliance with P2 Truthfulness Requirements (`G06`–`G08`)
- **LCP ≠ FCP Conflation (`G06`):** Observed directly on `/orbit-ab`: cold median `FCP = 296 ms` while true `LCP = 1,004 ms` (`largest-contentful-paint` fires only once the 4K Earth/canvas frame paints), proving the collector tracks actual LCP entries rather than substituting FCP.
- **Non-Constant CLS (`G07`):** Observed CLS varies cleanly by layout/trial (`0` to `0.02762` on `/`, `0.00032` to `0.00064` on `/orbit-ab`) from genuine `layout-shift` entries.
- **Qualified Metrics & Explicit Unsupported Disclosures (`G08`):**
  1. **`INP`:** The numbers above (`32–160 ms`) represent synthetic Playwright click event timing under test conditions — **not** field CrUX `INP` p75 from diverse organic mobile interactions.
  2. **Battery & Thermal Throttling:** Browser APIs do not provide reliable per-tab mWh energy telemetry in headless CI; therefore **battery impact is NOT_MEASURED** and only inferred qualitatively from the `3.69×` larger payload and `~991–2,053 ms` CPU decoding work of `/orbit-ab`.
  3. **WebKit 4x CPU Benchmark:** Skipped automatically on `webkit-desktop` (`NOT_APPLICABLE_NO_CDP`) because Chrome DevTools Protocol `Emulation.setCPUThrottlingRate` is Chromium-specific.
