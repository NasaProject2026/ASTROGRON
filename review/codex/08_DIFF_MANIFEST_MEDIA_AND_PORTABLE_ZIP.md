# 08 — Diff Accounting, Media Pruning & Protected Provenance

## 1. Diff Summary Against `UNPACKED_FRONTEND_V5_SLIM`
- Exact machine-generated diff stored in `review/DIFF_MANIFEST.json` (`unchanged=75`, `modified=22`, `added=38` including `README_REPLAY.md` and `22` staged M14/M4 artifacts + adapters/routes/tests, `deleted=0` excluding `review/`).
- Protected M1–M14 scientific directories and V5 slim baseline remained completely read-only (`0` files altered).

## 2. `< 20 MB` Portable Packaging & Media Inventory
To meet the `00_START_COMPACT_EN.md` portable archive constraint (`< 20 MB`) without removing any source code, staged scientific file, test suite, JSON verification receipt, or fresh G6 `review/screenshots/after/` image:
- Moved `28` redundant/bulky legacy `.webm` videos (`3` files) and heavy superseded/A/B `.png` images (`25` files, totaling `35,393,666` bytes) into a separate host archive outside the shipped project.
- Logged every omitted file's exact relative path, byte size, lowercase SHA-256 hash, and regeneration command (`npx playwright test`) in `review/OMITTED_HEAVY_MEDIA_INVENTORY.json`.
- Retained inside `review/screenshots/`: all `12` fresh G6 `after/*.png` captures, `16` unique state/failure-mode `.png` proofs (WebGL fallback, 403 vector recovery, tile outage, blocked custom fork, blocked Kenya isolation, 404 unknown site, provenance drawer, Simple View, 320px/390px cards), plus `orbit-ab-benchmark.json`, `responsive-overflow-matrix.json`, and `tile-network-proof.json`.
