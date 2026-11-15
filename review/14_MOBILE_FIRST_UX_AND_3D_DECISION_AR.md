# ASTRAGRON V4.1 — Mobile-First UX / Orbital 3D Decision — 13 Nov 2026

**Verdict:** `SOURCE_CHANGES_COMPLETED / RUNTIME_DEVICE_VALIDATION_PENDING`.
**Scope:** Presentation/navigation layer only. Protected scientific solver not included or modified.

## 1. Why these changes

A prior **390 × 844** Chromium screenshot showed the research route navigation occupying roughly the entire space before the main result. The global header also had a genuine tablet breakpoint gap: primary desktop links were `hidden lg:flex`, but the mobile menu was `md:hidden`, leaving 768–1023px without those direct links.

The Earth Explorer showed a horizontal row of multiple reference-site buttons and seven always-visible map view options, plus a contextual drawing toolbar. This made the page look complicated before the user needed those features.

## 2. Implemented modifications

| Area | Source-level modification | User experience |
|---|---|---|
| Global header tablet | Align hamburger and desktop utilities at `lg` rather than `md` | 768–1023px retains a visible menu button |
| Research workspace mobile | One closed `<details>` summary with active section name | Main results begin much sooner; destinations remain one tap away |
| Research workspace desktop | Four collapsible section groups with current group expanded | Scientific complexity remains available without showing all 10+ links at once |
| Landing primary actions | Explore retains prominent CTA; demo becomes less prominent text-link | Clear primary action |
| Hero motion | Experimental motion removed from public hero; original static high-quality image retained | No quality downgrade from 2D illustration; prototype is available at `/orbit-lab.html` |
| Landing location preview | Three pill buttons replaced with labeled `<select>` | One site chooser |
| Earth Explorer mobile | Site presets replaced with labeled native selection; all featured and edge sites remain available | No horizontal row of site buttons |
| Earth Explorer mobile | Satellite/vector/zoom options initially hidden behind Map view disclosure | Map and one useful setting first |
| Map attribution | Kept always visible below the map view disclosure | Scientific licensing and provider attribution remain legible |

**Not done:** Replacing the existing hero JPEG with a 3D scene. The image remains default because no photorealistic alternative has yet been independently rendered and compared on real phones/tablets/desktops.

## 3. 3D eligibility and acceptance gates

NASA maintains a public 3D collection (https://www.nasa.gov/3d-resources/), including some GLB models. NASA media reuse must follow https://www.nasa.gov/nasa-brand-center/images-and-media/ and any third-party notices. Assets must be source-verified before shipping.

A replacement candidate must pass all of these **before launch**, not just look attractive in one screenshot:

1. Separate rotating Earth and independently moving satellite, credible geometry/materials and occlusion, no baked two-object photo pretending to rotate separately.
2. Side-by-side screenshot/video comparison against current editorial images on 390px, 820px, 1440px, and representative real Android/Safari devices; no visual downgrade.
3. Bounded resolution/device pixel ratio, paused animation when offscreen/background, respect reduced-motion and save-data, no extra hidden WebGL contexts.
4. Test loss of WebGL, slow CPU/network, delayed GLB loading, low-memory conditions; always fall back to the trusted hero photograph without layout shift.
5. Record provenance/license of each 3D model and earth texture, show no implication of NASA endorsement or live orbital telemetry.

Until those are objectively verified, the photographic hero is the **approved** option. Experimental Canvas prototype is explicitly not accepted as photorealistic 3D.

## 4. Quality status: 65 / 100 (estimate; not a passing-test percentage)

| Area | Weight | Estimated achieved | Evidence & limitations |
|---|---:|---:|---|
| Visual / editorial fidelity | 20 | 18 | Existing reference screenshots; original art preserved |
| Simple progressive interaction | 20 | 15 | Code modifications & static checks; not yet browser-verified |
| Responsive layout completeness | 20 | 14 | Prior 33-width archived screenshot matrix plus untested breakpoint corrections |
| Mobile performance & accessibility | 20 | 8 | Reduced-motion exists, but no real-device GPU/power/a11y audit for this version |
| Full build / runtime / e2e verification | 20 | 10 | Static syntax/offline invariants passed; full reinstall/build/e2e not run after modifications |
| **Total** | **100** | **65** | **Quality estimate of standalone frontend only** |

This is an **engineering readiness estimate**, not a scientifically established or automated percentage and not the completion percentage of the protected agricultural backend. The scientific backend is still **not connected in this ZIP**.

## 5. Validation explicitly achieved vs not achieved

- Offline UI source invariants: run `node scripts/mobile-ux-offline-gates.mjs`; the newest script checks tablet/mobile layout, element discoverability and disclosures, preservation of hero art, and the source-attribution policy.
- TypeScript/TSX parse: syntax AST parse via installed global TypeScript; this does **not** type-check external package APIs.
- Independently provided previous `scripts/review-regression.mjs`: verify safety and file integrity after regenerating the SHA-256 manifest.
- Updated/added Playwright cases in `e2e/v4-review-regressions.spec.ts` for navigation, tablet accessibility, single site chooser, and Explorer mobile map settings — **AUTHORED, NOT EXECUTED**.
- NOT independently re-run in this environment: `npm ci`, strict `tsc --noEmit`, ESLint, Vitest, `next build`, Playwright runtime, real Android Chrome/iOS Safari, GPU FPS/p95 frame timings, battery, screen-reader testing.

## 6. Next strict release gates

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` in an online environment; fix **actual** errors, no suppression.
2. `npm run test:e2e` and capture new (not historical) screenshots/video at 320, 360, 390, 430, 768, 820, 1024, 1440, and 1920; check viewport overflow and clickable links when hidden sections are opened.
3. Browser test React hydration, accessibility roles/labels, all preserved links and interaction on touch devices.
4. Profile mobile scrolling, imagery tile load, WebGL contexts, frame time under thermal throttling; plan fidelity/performance tradeoffs from observed measurements.
5. Ship revised release only when core scientific fail-closed truth boundaries and remote-tile failure modes remain correct.

### Evidence from the final packaging pass

- `node scripts/verify-manifest.mjs`: **142 / 142 source and asset digests verified**; the manifest file itself is intentionally excluded from self-hashing.
- `node scripts/review-regression.mjs`: **11 / 11 offline archive and security regression cases PASS**.
- `node scripts/mobile-ux-offline-gates.mjs`: **9 / 9 static interface invariants PASS**.
- TypeScript compiler AST parsing: **42 / 42 TS/TSX files parsed with 0 syntax errors**, but module/type resolution was not performed.
- Local Chromium browser attempt to capture the Canvas preview: **timed out after 15 seconds** with no screenshot; therefore no runtime performance claim is made.
- The `.zip` release is a **portable source package pending online build and real-device validation**, not a production deployment acceptance certificate.
