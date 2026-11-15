# 03 — Hero A/B Comparison & Visual Architecture Decision

## 1. Objective Evaluation Method
We evaluated the editorial `<picture>` landing hero (`/`) against the upgraded interactive WebGL Three.js + NASA Landsat 8 `GLB` candidate (`/orbit-ab`) under identical production server builds (`next start --port 3005`) using:
- Real Chromium `PerformanceObserver` cold, warm, and `4x` CPU throttle captures (`e2e/orbit-ab-benchmark.spec.ts` -> `review/evidence/perf-benchmark-raw.json`)
- Multi-viewport visual inspection at 7 resolutions (`1440x900`, `1920x1080`, `820x1180`, `1180x820`, `390x844`, `360x800`, `320x640`).

---

## 2. Visual Upgrades Delivered to the 3D WebGL Candidate (`/orbit-ab`)
In V4.2, the isolated Three.js `/orbit-ab` prototype suffered from failed asset/decoder paths (`/draco/` instead of `/orbit-ab-assets/draco/` and wrong night texture filename), causing Landsat 8 to fail loading in production screenshots. In V5 (`src/components/orbital/orbit-ab-stage.tsx`), all root causes were resolved:
1. **Draco & Texture Resolution Fixed:** `DRACOLoader` pointed to `/orbit-ab-assets/draco/`; night texture corrected to `/orbit-ab-assets/earth_night_4096.jpg` alongside `earth_day_4096.jpg` and `earth_bump_roughness_clouds_4096.jpg`.
2. **Spacecraft Scale, Orientation & Lighting:** Landsat 8 `GLB` mesh centroid recentered and uniformly normalized (`targetSpan = 0.58`), illuminated with procedural Earthshine + solar `PMREMGenerator` environment lighting so sunlit foil and deep-blue solar array panels read cleanly instead of flat dark silhouettes.
3. **Guaranteed Orbital Clearance (`Occluded: NO`):** Camera framing, Earth radius (`3.65`), and minimum orbital altitude clamp (`minOrbitR = earthRadius * 1.15`) keep the spacecraft clearly separated above the blue atmospheric limb across all 7 desktop, tablet, and mobile viewports (`satClearedTextArea: true` in `visualChecks`).
4. **Honest Runtime Readiness Telemetry:** `webglReadyMarked` transitions strictly after textures load and the first real WebGL frame swaps, eliminating React 19 `react-hooks/refs` warnings.

---

## 3. Quantitative A/B Benchmark Results (`perf-benchmark-raw.json`, `desktop-chrome`)
| Metric (Median of Cold/Warm Trials; 1 Trial on 4x CPU) | Editorial Hero (`/`) | 3D WebGL Hero (`/orbit-ab`) | Winner / Delta |
| --- | --- | --- | --- |
| **Cold Unthrottled LCP** | **364 ms** (`340–388 ms`) | `1004 ms` (`812–1196 ms`) | `/` is **2.76x faster** |
| **Cold Unthrottled FCP** | `364 ms` | `296 ms` | Comparable (`webgl` canvas mounts earlier; bitmap texture finish delays LCP) |
| **Cold Unthrottled TBT (Approx)** | **164 ms** (`2` long tasks) | `991 ms` (`5` long tasks) | `/` has **6.0x lower blocking** |
| **Cold Transfer Payload** | **1,083,501 B (~1.03 MiB)** | `4,002,602.5 B (~3.82 MiB)` | `/` is **3.69x smaller** |
| **Warm Cached LCP** | **174 ms** | `466 ms` | `/` is **2.68x faster** |
| **Warm TBT (Approx)** | **0 ms** (`0` long tasks) | `656 ms` (`3` long tasks) | `/` eliminates main-thread JS parse/decode work |
| **4x CPU Throttle LCP** | **1,056 ms** | `1,468 ms` | `/` (`-412 ms`) |
| **4x CPU Throttle TBT** | **1,085 ms** | `2,053 ms` | `/` (`-968 ms` blocking) |
| **Steady-State WebGL Frame Rate** | N/A (Static `<picture>`) | **60.1 FPS** (`p95 16.7–17.1 ms`) | Smooth `60 Hz` once active |
| **Horizontal Overflow (All 7 Viewports)** | **0 px** | **0 px** | Tie |

---

## 4. Final Architectural Decision (Keep `/` Editorial; Keep `/orbit-ab` Isolated)
Based on hard browser measurements rather than subjective bias:
- **Production Landing (`/`):** Retains the lightweight responsive `<picture>` orbital hero (`public/assets/orbital-earth-horizon-wide.jpg` and `orbital-earth-horizon-mobile.jpg`). This protects mobile and CPU-constrained users from `~3.82 MiB` cold transfers, `~991–2,053 ms` main-thread blocking during Draco WASM + 4K texture decode, and battery wakeups on a purely orientational landing banner, while investing real WebGL GPU cycles where genuine scientific exploration occurs (`/explore` interactive MapLibre 3D globe).
- **A/B Showcase (`/orbit-ab`):** Retained cleanly as a dedicated, working route (`Landsat 8 GLB: YES`, `Occluded: NO`, `60.1 FPS`) linked from `/explore` and `/design-system` for stakeholder comparison and future progressive enhancement once compressed KTX2/Basis textures or worker-decoded geometry are introduced.
- **Visual Comparison Pairs Inspected:** `review/screenshots/ab_01_desktop_1440_static.png` vs `ab_01_desktop_1440_orbit3d.png`, `ab_03_tablet_portrait_820_static.png` vs `ab_03_tablet_portrait_820_orbit3d.png`, `ab_05_mobile_390_static.png` vs `ab_05_mobile_390_orbit3d.png`, `ab_06_mobile_360_*`, `ab_07_mobile_320_*`.
