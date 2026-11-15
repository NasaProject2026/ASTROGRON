# ASTRAGRON Smart Fields & Globe Coverage — Safe Rollback Guide

**Feature Branch:** `feat/smart-fields-coverage`  
**Verified Baseline Tag / Commit:** `6d9285e` (`feat/farmer-first-ux` — Farmer-First UX baseline)

Use this procedure if you need to inspect or revert cleanly back to the verified pre-Smart-Fields Farmer-First release without altering any protected M1–M14 scientific data files or hero media.

---

## 1. Non-Destructive Comparison & Inspection

```bash
# Inspect Smart Fields commits relative to baseline
git log --oneline 6d9285e..feat/smart-fields-coverage

# View summary of changed files since Farmer-First baseline
git diff --stat 6d9285e..feat/smart-fields-coverage
```

---

## 2. Create a Safety Tag & Roll Back Branch Pointer

```bash
# 1. Preserve current work before switching
git tag smart-fields-archive HEAD

# 2. Switch cleanly to verified baseline branch / commit
git checkout -b rollback/farmer-first-baseline 6d9285e
```

---

## 3. Clean Rebuild & Post-Rollback Verification

```bash
npm run typecheck
npm run lint
node scripts/mobile-ux-offline-gates.mjs
npx vitest run
npm run build
```

All `28` protected files listed in `review/SMART_FIELD_PROTECTED_HASHES.json` remain byte-identical across both branches (`PROTECTED_HASHES: 28, MATCH: 28, BAD: 0`).
