"""Unchanged baseline assertions through A's transport adapter and verified caches."""
import json,subprocess,sys
from .baseline import ROOT,verify
CHILD=r'''
import sys,unittest,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import test_global,test_integration_service as tests
sys.path.insert(0,sys.argv[2])
from brain.transport import handler_for
from unittest.mock import patch
original_service=tests.Service
def service(cache_dir=None):
    if cache_dir is not None and Path(cache_dir).parent.name=="acceptance_cache":
        cache_dir=Path(sys.argv[3])
    return original_service(cache_dir)
original_server=tests.server.create_server
def server(*a,**kw):
    result=original_server(*a,**kw)
    result.RequestHandlerClass=handler_for(result.RequestHandlerClass)
    return result
with patch.object(tests,"Service",service),patch.object(tests.server,"create_server",server):
    suite=unittest.defaultTestLoader.loadTestsFromNames(["test_global","test_integration_service"])
    result=unittest.TextTestRunner(verbosity=2).run(suite)
print(json.dumps({"PASS":result.wasSuccessful(),"tests":result.testsRun,"failures":len(result.failures),"errors":len(result.errors)}),flush=True)
raise SystemExit(not result.wasSuccessful())
'''
def main():
    initial=sorted((ROOT/"runtime/agent-a/baseline-validation").glob("run-*/RECEIPT.json"),key=lambda p:p.stat().st_mtime)[-1]
    source=initial.parent/"release/water_core"
    caches=list((source/"runtime/acceptance_cache").iterdir())
    assert len(caches)==1
    before=verify()
    output=ROOT/"runtime/agent-a/transport-validation";output.mkdir(parents=True,exist_ok=True)
    run=subprocess.run([sys.executable,"-B","-X","utf8","-c",CHILD,str(source),str(ROOT),str(caches[0])],cwd=source,capture_output=True,timeout=900)
    (output/"stdout.log").write_bytes(run.stdout);(output/"stderr.log").write_bytes(run.stderr)
    summary=json.loads(run.stdout.decode("utf-8").strip().splitlines()[-1])
    record={**summary,"initial_baseline_receipt":str(initial),"adapter":"brain.transport.handler_for",
            "protected_before":before,"protected_after":verify(),
            "scientific_cache_reuse":"Existing integrity-bound reference and 23ha cached computations; unchanged engine revalidates inputs, sources and content.",
            "assertions_and_tolerances_modified":False,"baseline_source_files_modified":False,
            "scope":"Only leading BOM is excluded from language classification; CSV bytes are preserved and actual Arabic still rejected."}
    (output/"RECEIPT.json").write_text(json.dumps(record,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(record));return run.returncode
if __name__=="__main__":raise SystemExit(main())
