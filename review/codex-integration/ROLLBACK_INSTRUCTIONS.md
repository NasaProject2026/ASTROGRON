# ASTRAGRON V7 Codex Safe Integration — Rollback & Recovery Instructions (Gate G0)

## 1. Preserved Baseline Anchors

1. **Unmodified Inner V7 Source Archive (`G0.1`):**
   - Path: `C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_codex_v7_safe_handoff/SOURCE/ASTRAGRON_FRONTEND_V7_CLOSURE_CODEX_READY.zip`
   - Size: `13,603,803` bytes
   - SHA-256: `8ab271899a75cd710eb13bd6660f09928a8572d36498cb6f3dfe29014c134918`
   - Clean Extraction Copy: `C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_codex_v7_safe_handoff/FRONTEND_V7_EXTRACTED`

2. **Preserved Gemini V7 Baseline Worktree (`G0.2`):**
   - Worktree Path: `C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_farmer_first/GEMINI_V7_BASELINE_WORKTREE`
   - Branch: `feat/v7-final-release-closure`
   - Commit: `21b8bfa`

3. **Isolated Codex Safe Integration Branch:**
   - Worktree Path: `C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_farmer_first/FARMER_FIRST_WORK`
   - Branch: `feat/v7-codex-safe-integration` (branched from `21b8bfa`)

---

## 2. Deterministic Rollback Procedure

### Option A — Instant Git Branch Rollback to Pre-Codex V7 Closure (`21b8bfa`)
```powershell
Set-Location "C:\Users\HP\.gemini\antigravity\brain\3ac899d3-46e0-4094-ad7f-0b55172ca787\scratch\astragron_farmer_first\FARMER_FIRST_WORK"
git checkout feat/v7-final-release-closure
node scripts/verify-protected-files.mjs
node scripts/verify-manifest.mjs
```

### Option B — Full File-Level Restore from the Immutable V7 Closure ZIP
```powershell
Expand-Archive -Path "C:\Users\HP\.gemini\antigravity\brain\3ac899d3-46e0-4094-ad7f-0b55172ca787\scratch\astragron_codex_v7_safe_handoff\SOURCE\ASTRAGRON_FRONTEND_V7_CLOSURE_CODEX_READY.zip" -DestinationPath "C:\path\to\clean_restore" -Force
Set-Location "C:\path\to\clean_restore"
node scripts/verify-manifest.mjs
node scripts/verify-protected-files.mjs
```

---

## 3. Protected 28 Scientific & Visual Files Verification
Run at any time to confirm all 28 protected M14/M4 and visual hero assets match their frozen SHA-256 digests:
```powershell
node scripts/verify-protected-files.mjs
# Expected output: Protected files verified: 28/28 PASS
```
