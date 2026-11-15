"""Reproducible file API; no UI, credentials or listening port."""
import argparse
import json
from pathlib import Path
from .baseline import ROOT
from common import parse
from .service import ClientDecisionService

def main():
    p=argparse.ArgumentParser()
    p.add_argument("request",type=Path)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    target=args.output.resolve()
    roles=[role for role in ("agent-a","agent-b") if target.is_relative_to((ROOT/"runtime"/role).resolve())]
    if not roles:
        p.error("output must be under this worktree's isolated runtime/agent-a or runtime/agent-b")
    if args.request.stat().st_size>524288:
        p.error("request exceeds 524288 bytes")
    try:
        result=ClientDecisionService(ROOT/"runtime"/roles[0]).run(parse(args.request.read_text(encoding="utf-8-sig")))
    except (ValueError,TypeError,KeyError) as e:
        print(json.dumps({"status":"INVALID_REQUEST","reason":str(e)}))
        return 2
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    print(json.dumps({"status":result["status"],"run_id":result["run_id"],"alternatives":len(result["alternatives"]),"output":str(target)}))
    return 0 if result["status"]=="CONDITIONAL_RESEARCH_COMPLETE" else 3

if __name__=="__main__":
    raise SystemExit(main())
