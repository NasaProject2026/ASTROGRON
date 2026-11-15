"""Run unchanged accepted suites in a disposable A-owned runtime copy."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from .baseline import ROOT, RELEASE, verify

def main():
    parent=ROOT/"runtime/agent-a/baseline-validation"
    parent.mkdir(parents=True,exist_ok=True)
    out=Path(tempfile.mkdtemp(prefix="run-",dir=parent))
    target=out/"release"
    before=verify()
    shutil.copytree(RELEASE,target,ignore=shutil.ignore_patterns("runtime","__pycache__"))
    suites=[
        ("soil_and_controls",target,[sys.executable,"-B","-X","utf8","-m","unittest","test_soil_memory","test_reference_comparison","-q"]),
        ("global_integration",target/"water_core",[sys.executable,"-B","-X","utf8","-m","unittest","test_global","test_integration_service","-q"]),
    ]
    runs=[]
    for name,cwd,cmd in suites:
        start=time.monotonic()
        run=subprocess.run(cmd,cwd=cwd,capture_output=True,timeout=900)
        (out/(name+".stdout.log")).write_bytes(run.stdout)
        (out/(name+".stderr.log")).write_bytes(run.stderr)
        runs.append({"suite":name,"returncode":run.returncode,"elapsed_seconds":time.monotonic()-start,
                     "stdout":str(out/(name+".stdout.log")),"stderr":str(out/(name+".stderr.log"))})
        print(json.dumps(runs[-1]),flush=True)
    receipt={"PASS":all(r["returncode"]==0 for r in runs),"runs":runs,"protected_before":before,"protected_after":verify(),
             "scope":"Unchanged accepted release Soil Memory controls and global water integration; historical 1242-test R&D tree is not imported or rerun.",
             "prior_broad_receipt":"1241/1242 passing, one pre-existing Windows HTTP oversized-body error; no assertion or tolerance changed."}
    (out/"RECEIPT.json").write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"PASS":receipt["PASS"],"receipt":str(out/"RECEIPT.json")}))
    return 0 if receipt["PASS"] else 1

if __name__=="__main__":
    raise SystemExit(main())
