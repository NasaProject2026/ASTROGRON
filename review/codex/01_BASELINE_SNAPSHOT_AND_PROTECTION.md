# 01 — Baseline Snapshot, Protection & Source Availability Matrix

## 1. Protected Read-Only Baselines Verified Untouched
All protected baseline trees inside `<package-root>` remained byte-for-byte unchanged throughout Gates G0–G7, verified by Node SHA-256 verification (`verify_protected_hashes.mjs` exit `0`):

| Protected Tree / Manifest | Verified Entries | Status |
|---|---|---|
| Root `DELIVERY_MANIFEST.json` | `20 / 20` | PASS (Unchanged) |
| `UNPACKED_FRONTEND_V5_SLIM` | `141 / 141` | PASS (Unchanged) |
| `UNPACKED_M14_REVIEW/OUTPUT_RECEIPT.json` | `9 / 9` | PASS (Unchanged) |
| `UNPACKED_M14_REVIEW/DELIVERY_MANIFEST.json` | `135 / 135` | PASS (Unchanged) |
| `UNPACKED_M1_M4_REVIEW/ASTRAGRON_REVIEW/REVIEW_MANIFEST.json` | `65 / 65` | PASS (Unchanged) |
| `UNPACKED_M14_FORENSIC` | `87 / 87` | PASS (Unchanged) |

> **Pre-existing upstream note (preserved verbatim):** As documented inside `UNPACKED_M1_M4_REVIEW`, M3/M4 stage markdown notes carry a pre-existing upstream status mismatch relative to the compact bundle; all shipped manifest hashes inside `REVIEW_MANIFEST.json` (`65/65`) match cleanly.

## 2. Host Availability Matrix (G0 Baseline)

| Capability / Source | Host Availability | Status in Integration |
|---|---|---|
| `UNPACKED_FRONTEND_V5_SLIM` (`97` non-review project files) | Present & verified | Authoritative UI baseline copied into `INTEGRATION_V5_WORK_20261113/` |
| `UNPACKED_M14_REVIEW` staged scientific files | Present & verified | Copied byte-identical into `src/data/m14-recorded/` |
| `UNPACKED_M1_M4_REVIEW` M4 global coverage files | Present & verified | Copied byte-identical into `src/data/m4-global/` |
| `D:\ASTROGRON` live workspace | `D_ASTROGRON_EXISTS=False` | Not present on host; staged read-only corpora used |
| Python runtime (`VERIFY_CONTENTS.py`, `m14_replay.py`, `m14_api.py`, `verify_review.py`) | `PYTHON=NOT_FOUND` | Explicitly logged `NOT_RUN_NO_PYTHON`; Node SHA-256 + Zod verification used instead |
| Node.js `v22.14.0` & npm `10.9.2` | Present | Executed `tsc`, `eslint`, `vitest`, `next build`, and `playwright` |
