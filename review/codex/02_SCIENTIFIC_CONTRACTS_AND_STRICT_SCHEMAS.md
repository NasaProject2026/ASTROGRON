# 02 — Scientific Contracts, Zod Strict Schemas & Tamper Fail-Closed Protection

## 1. Strict Schema Validation (`src/domain/native-schemas.ts`, `src/domain/schemas.ts`)
- Replaced permissive/untyped trust paths with strict Zod schemas for M14 & M4 JSON payloads (`NativeComparisonDomainSchema`, `NativeOutputReceiptSchema`, `NativeScientificAcceptanceSchema`, `NativeCandidateAuditRecordSchema`, `NativeResourceFrontiersSchema`, `NativePreferenceDecisionsSchema`, `NativePowerSeriesSchema`, `NativeM4CoverageManifestSchema`, `NativeGeoQuantitativeResultsSchema`).
- Enforced finite bounds (`Number.isFinite`), non-negativity on physical deficits/shortfalls, explicit nullability for missing/unmodeled metrics, and calendar-eligibility enum constraints.

## 2. Runtime SHA-256 Integrity Gate (`src/server/corpus-integrity.ts`)
- Before serving `/api/research/m14` or `/api/research/m4-coverage`, the server verifies every file digest against:
  - `src/data/m14-recorded/OUTPUT_RECEIPT.json` (`9` pinned output files)
  - `src/data/m4-global/DELIVERY_MANIFEST.json`
- **Protocol Anchor (`COMPARISON_DOMAIN.json`):** `5bd02acc67a56003acd1994cc1dd50b597dc3f9c7681b07548c278d0081a669b`
- **Tamper Resistance:** `tests/g2-g3-recorded-m14-m4.test.ts` mutates `candidate_audit.json` and `GLOBAL_COVERAGE_MANIFEST.json` by 1 byte on isolated temp copies and confirms immediate fail-closed `SOURCE_NOT_PROVIDED` rejection.

## 3. UI/Scientific Revision Separation
- Client form edits compute lightweight UI revision fingerprints (`data-revision`) to invalidate stale UI exports when users fork/modify inputs (`e2e/v5-acceptance-gates.spec.ts`), strictly separate from M14 SHA-256 artifact hashes.
- Both `tests/g1-strict-schemas.test.ts` (`5/5`) and `tests/contracts-and-adapters.test.ts` (`33/33`) pass post-final-edit.
