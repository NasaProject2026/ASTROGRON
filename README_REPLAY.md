# ASTRAGRON V5 Safe Integration — Independent Replay & Verification Runbook

This portable review archive contains the corrected ASTRAGRON Next.js frontend and read-only M4/M14 verification bridges, prepared from `UNPACKED_FRONTEND_V5_SLIM` with all V5 design assets preserved and zero modifications to the original scientific core (`UNPACKED_M14_REVIEW`, `UNPACKED_M14_FORENSIC`, `UNPACKED_M1_M4_REVIEW`, `UNPACKED_FRONTEND_V5_SLIM`).

---

## 1. Observed Runtime Environment (Reference Build)

- **OS:** Windows 10 (`10.0.19045.0`)
- **Node.js:** `v22.14.0`
- **npm:** `10.9.2`
- **Python:** Not present on verification host (`VERIFY_CONTENTS.py`, `verify_review.py`, `m14_replay.py`, and `m14_api.py` were **not** executed via Python; documented as `NOT_RUN_NO_PYTHON`)
- **`D:\ASTROGRON` live local tree:** Not present on verification host (`D_ASTROGRON_EXISTS=False`); integration uses the staged read-only corpora under `src/data/m14-recorded/` and `src/data/m4-global/` with full SHA-256 verification at runtime and build time.

---

## 2. Clean Replay From Extracted ZIP Directory

Run inside `<extracted-root>`:

```bash
# 1. Verify archive integrity before installing dependencies
node scripts/verify-manifest.mjs

# 2. Verify review regression invariants (links, asset provenance, disclosure strings)
node scripts/review-regression.mjs

# 3. Install exact pinned dependencies
npm ci

# 4. Install Playwright browser binaries if running browser E2E locally
npx playwright install chromium webkit

# 5. Static analysis, Vitest unit/security/schema tests, offline UX gates, production build
npm run typecheck
npm run lint
npm test
node scripts/mobile-ux-offline-gates.mjs
npm run build

# 6. Start production server (or run Playwright, which starts the production server automatically)
npx playwright test
```

### Expected Honest Outputs

- `node scripts/verify-manifest.mjs`: exits `0` with zero missing files, zero modified hashes, and zero forbidden extras.
- `npm run typecheck` & `npm run lint`: exit `0`.
- `npm test`: `7` test files, `71` tests passed (`g1-strict-schemas`, `contracts-and-adapters`, `g2-g3-recorded-m14-m4`, `remediation-gates`, `v4-precision-gates`, `p1-scientific-integrity`, `g4-geocoder-security`).
- `node scripts/mobile-ux-offline-gates.mjs`: `9/9` offline invariants pass (explicitly not a replacement for browser tests).
- `npx playwright test`: `41 passed, 1 skipped, 0 failed` (`orbit-ab-benchmark.spec.ts` skips on `webkit-desktop` because WebKit lacks Chrome DevTools Protocol FPS profiling).
- Running Playwright regenerates screenshots and `.webm` journey recordings locally (the heavy `.webm` videos and redundant pre-G7 PNGs are omitted from this `< 20 MB` archive and inventoried with SHA-256 digests in `review/OMITTED_HEAVY_MEDIA_INVENTORY.json`).

---

## 3. Environment & Geocoder Configuration (Fail-Closed by Default)

No live third-party geocoding secret is shipped in this archive:

- Default behavior (`/api/geocode`): returns HTTP `503` with `status: "GEOCODER_NOT_CONFIGURED"` and never contacts public `nominatim.openstreetmap.org`.
- To enable an authorized server-side geocoder for testing, copy `.env.example` to `.env.local` and supply:
  - `ASTRAGRON_GEOCODER_BASE_URL` (HTTPS provider URL matching configured provider)
  - `ASTRAGRON_GEOCODER_PROVIDER` (`OPENCAGE` | `LOCATIONIQ` | `PHOTON_SELF_HOSTED`)
  - `ASTRAGRON_GEOCODER_API_KEY` (required for OpenCage / LocationIQ)
  - `ASTRAGRON_GEOCODER_USER_AGENT` (explicit contact identifier)

---

## 4. Scientific & Integrity Guardrails

- **Allowed Dataset Modes:**
  - `SYNTHETIC_UI_DEMO` (explicitly watermarked `SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS`)
  - `RECORDED_M14_RESEARCH` (read-only staged M14 `SE_UPPSALA` 16-policy / 144-case fixed experiment + staged M4 multi-site coverage `OK_COVERAGE_ONLY`; **no live field recommendation**, `FIELD_RECOMMENDATION_ELIGIBILITY = BLOCKED`)
- **`REAL_SCIENTIFIC_BACKEND`:** Fails closed (`BACKEND_NOT_CONNECTED`). No client-side crop/N/yield/optimization solver exists.
- **`src/server/corpus-integrity.ts`:** Verifies SHA-256 digests against `src/data/m14-recorded/OUTPUT_RECEIPT.json` (`9` pinned files) and `src/data/m4-global/DELIVERY_MANIFEST.json`. Any 1-byte tamper triggers `SOURCE_NOT_PROVIDED` fail-closed rejection.

---

## 5. Safe Rollback Instructions

This directory was built cleanly on top of `UNPACKED_FRONTEND_V5_SLIM` without overwriting the read-only V5 slim baseline or the M1/M4/M14 bundles:

1. **Per-file rollback:** Consult `review/DIFF_MANIFEST.json` (`22` modified files, `38` added files including `README_REPLAY.md`, `0` deleted files). Every modified entry lists exact `before_sha256` and rollback instructions; every added non-baseline file can be safely removed without breaking V5 baselines.
2. **Full rollback to `UNPACKED_FRONTEND_V5_SLIM`:** Copy `<package-root>/UNPACKED_FRONTEND_V5_SLIM/` to a clean directory, run `npm ci`, and start clean without any Codex G1-G7 files.
3. **Snapshot regeneration (after verifying staged corpora only):** Run `node scripts/build-verified-snapshot.mjs` to rebuild `src/data/generated/verified-m14-m4-snapshot.json` directly from `src/data/m14-recorded/` and `src/data/m4-global/`.
