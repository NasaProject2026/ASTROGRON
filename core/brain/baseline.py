"""Locate and verify the accepted release without writing beside it."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release"
CORE = RELEASE / "water_core"
for path in (CORE, RELEASE):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def verify():
    lock = json.loads((ROOT / "coordination/BASELINE_LOCK.json").read_text(encoding="utf-8"))
    mismatches = [name for name, expected in lock["files"].items()
                  if not (ROOT/name).is_file() or sha(ROOT/name) != expected]
    if mismatches:
        raise ValueError("PROTECTED_BASELINE_INTEGRITY:" + ",".join(mismatches[:8]))
    return {"commit": lock["baseline_commit"], "files_verified": len(lock["files"]),
            "lock_sha256": sha(ROOT/"coordination/BASELINE_LOCK.json")}

def implementation_identity():
    return {p.relative_to(ROOT).as_posix(): sha(p)
            for folder in ("brain", "contracts")
            for p in sorted((ROOT/folder).glob("*"))
            if p.suffix in (".py", ".json", ".md")}
