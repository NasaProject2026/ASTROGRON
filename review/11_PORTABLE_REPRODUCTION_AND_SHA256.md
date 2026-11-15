# Portable Reproduction Guide & SHA-256 Verification (`G8` / `P01`, `P04`)

## 1. Extract & Verify File Integrity Across OS (Windows & POSIX)
After unpacking `ASTRAGRON_FRONTEND_V4_PRECISION_REPAIRED_REVIEW.zip` into a clean directory:

```bash
# 1. Verify every packaged file byte-for-byte against review/12_HASHES_AND_DELIVERY_MANIFEST.json
node scripts/verify-manifest.mjs
```

- `scripts/verify-manifest.mjs` normalizes path separators cleanly, rejects `..` traversal segments, rejects leading `/` or Windows drive letters (`C:\`), rejects symbolic links (`lstatSync`), rejects duplicate normalized entries, and checks exact `size_bytes` + `sha256` digests for every archived file listed in `review/12_HASHES_AND_DELIVERY_MANIFEST.json`.
- Expected exit code: **`0`** with zero mismatches and zero missing/extra paths.

## 2. Clean Install, Static Gates & Unit Tests (`Offline-Safe Core Verification`)
```bash
npm ci
npm run typecheck
npm run lint
npm test
```

## 3. Production Build & Browser E2E Replay
```bash
npm run build
npx playwright test --reporter=list
```

- **Note on External Tile Tests:** Playwright Tests 1 and 5 require outbound HTTPS access to `tiles.maps.eox.at`, `tiles.openfreemap.org`, and `gibs.earthdata.nasa.gov` for live tile verification (`94` tiles verified in capture run); inside air-gapped networks, Tests 2 (WebGL `?mapFallback=1`) and unit/contract tests (`npm test`, `47/47`) operate cleanly offline, and Test 5 verifies real tile outage failover explicitly.

## 4. Packaged Archive Exclusions
Excluded cleanly from the portable ZIP and SHA-256 manifest:
- `node_modules/`
- `.next/`
- `.git/`
- `test-results/`, `playwright-report/`
- `tsconfig.tsbuildinfo`
- `.env*` files, private host paths/secrets, and protected `M1–M14` scientific backend source/data.
