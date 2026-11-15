"""No-quota operator preflight and standalone local HTTP process smoke.
Never probes a remote API; historical successful inference is reported separately.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import queue
import secrets
import subprocess
import sys
import threading
import time
from .codec import canonical, digest, strict_loads
from .config import Settings
from .credentials import read_secret
from .providers import OfflineProvider
from .service import ConversationService, Principal

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/"assistant_brain/final_chat"


def preflight():
    previous=strict_loads((ROOT/"assistant_brain/unified/TEST_RECEIPT.json").read_bytes())
    files=["remote.py","providers.py","quota.py","credentials.py","config.py"]
    unchanged=all(hashlib.sha256((ROOT/"assistant_brain"/name).read_bytes()).hexdigest()==previous["implementation_sha256"]["assistant_brain/"+name] for name in files)
    d=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes())
    req=strict_loads((ROOT/"assistant_brain/examples/supported.request.json").read_bytes())
    s=ConversationService(provider=OfflineProvider());p=Principal("preflight",frozenset({d["farm_id"]}));a=s.register_analysis(p,d,req,public_research=True)
    return {"schema":"astragron.chat-operator-preflight.v1","generated_at_utc":datetime.now(timezone.utc).isoformat(),
      "remote_requests_this_run":0,"local_core_loadable":True,"approved_research_dataset_attached":bool(a),
      "dataset_scope":"Temporary preflight core; this does not attest a deployed backend or frontend attachment",
      "standalone_http_smoke_receipt_present":(FOLDER/"HTTP_PROCESS_SMOKE.json").exists(),
      "service_running_claimed":False,
      "provider_protocol_unchanged_since_live_receipts":unchanged,
      "gemini":{"credential_configured":bool(read_secret("GEMINI_API_KEY")),"model":Settings().gemini_model,"prior_live_verified":bool(previous["verdict"]["LIVE_GEMINI_LITE_VERIFIED"] and unchanged),"available_now":"UNTESTED_NO_NEW_API_CALL","free_tier_operator_flag":Settings.from_env().gemini_free_tier_confirmed},
      "groq":{"credential_configured":bool(read_secret("GROQ_API_KEY")),"model":Settings().groq_model,"prior_live_verified":bool(previous["verdict"]["LIVE_GROQ_VERIFIED"] and unchanged),"available_now":"UNTESTED_NO_NEW_API_CALL","free_tier_operator_flag":Settings.from_env().groq_free_tier_confirmed},
      "advanced":{"enabled":False,"new_calls":0,"live_verified":False},
      "scientific_what_if":{"supported_operation":"rain_factor","original_request_bound":True,"engine_source_present":(ROOT/"brain/service.py").is_file(),"actual_http_receipt_present":(FOLDER/"HTTP_REAL_RAIN_RECEIPT.json").exists(),"runtime_requires":"--enable-simulation; accepted water profile and immutable original request"},
      "frontend_wired":False,"production_identity_tls_proxy":"AGENT_D_PENDING","persistence":"Single process, memory only; absolute session TTL 3600 seconds, last eight answers; restarts lose state"}


def smoke(simulate=False):
    token=secrets.token_urlsafe(32)
    d=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes())
    env=dict(os.environ);env["ASTRAGRON_CHAT_PROVIDER"]="offline"
    env["ASTRAGRON_CHAT_AUTH_TOKENS"]=canonical({token:{"tenant_id":"demo-tenant","subject_id":"local-smoke","farm_ids":[d["farm_id"]],"diagnostics":True}})
    args=[sys.executable,"-B","-X","utf8","-m","assistant_brain.http_api","--catalog","assistant_brain/catalog.example.json","--port","0"]
    if simulate:args.append("--enable-simulation")
    proc=subprocess.Popen(args,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    startup=queue.Queue();threading.Thread(target=lambda:startup.put(proc.stdout.readline()),daemon=True).start()
    started=time.monotonic()
    try:
        try:line=startup.get(timeout=15)
        except queue.Empty:raise RuntimeError("HTTP_STARTUP_TIMEOUT") from None
        if not line.startswith("ASTRAGRON conversational API listening on 127.0.0.1 "):raise RuntimeError("HTTP_STARTUP_FAILED")
        port=int(line.rsplit(" ",1)[1])
        def call(method,path,body=None,auth=True):
            h={"Authorization":"Bearer "+token} if auth else {}
            if body is not None:h["Content-Type"]="application/json"
            conn=http.client.HTTPConnection("127.0.0.1",port,timeout=150)
            conn.request(method,path,canonical(body).encode() if body is not None else None,h)
            r=conn.getresponse();status=r.status;data=strict_loads(r.read());conn.close();return status,data
        checks=[]
        def check(name,status,expected):
            if status!=expected:raise RuntimeError("HTTP_SMOKE_"+name)
            checks.append({"check":name,"status":status})
        check("public_health",call("GET","/health",auth=False)[0],200)
        check("authentication",call("GET","/v1/analyses",auth=False)[0],401)
        status,data=call("GET","/v1/analyses");check("analysis_list",status,200);aid=data["analyses"][0]["analysis_id"]
        status,data=call("POST","/v1/conversations",{"analysis_id":aid});check("session_create",status,201);base="/v1/conversations/"+data["session_id"]
        status,r=call("POST",base+"/messages",{"message":"Explain water for field F1 year two"});check("message",status,200)
        if "32.115994595373905 mm" not in r["text"] or r["mode"]!="DETERMINISTIC_FALLBACK":raise RuntimeError("HTTP_SMOKE_SEMANTICS")
        f=r["claims"][-1];status,e=call("GET",base+"/evidence/"+f["evidence_id"]);check("evidence",status,200)
        if canonical(f)!=canonical(e):raise RuntimeError("HTTP_SMOKE_EVIDENCE")
        check("report",call("GET",r["report_reference"]["href"])[0],200)
        check("operator_status",call("GET","/v1/status")[0],200)
        check("history",call("GET",base)[0],200)
        check("attach",call("POST",base+"/analysis",{"analysis_id":aid})[0],200)
        check("unknown_evidence",call("GET",base+"/evidence/ev_"+"0"*24)[0],404)
        if simulate:
            status,child=call("POST",base+"/messages",{"message":"What if rainfall decreases by 20%?"});check("actual_rain_simulation",status,200)
            if child.get("tool",{}).get("status")!="NEW_ANALYSIS_CREATED":raise RuntimeError("HTTP_SMOKE_RECOMPUTATION")
            status,comp=call("POST",base+"/messages",{"message":"Compare with my original"});check("child_followup_compare",status,200)
            if len({f["analysis_id"] for f in comp["claims"]})!=2:raise RuntimeError("HTTP_SMOKE_COMPARISON")
        check("delete",call("DELETE",base)[0],200)
        check("deleted_history",call("GET",base)[0],404)
        return {"schema":"astragron.http-process-smoke.v1","generated_at_utc":datetime.now(timezone.utc).isoformat(),"actual_standalone_server":True,"loopback_only":True,"actual_http_checks":checks,"scientific_semantics_checked":True,"provider_mode":"DETERMINISTIC_FALLBACK","new_remote_calls":0,"actual_scientific_engine_enabled":simulate,"sample_answer":r["text"],"elapsed_seconds":time.monotonic()-started,"server_stopped_on_exit":True}
    finally:
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
        proc.stdout.close();proc.stderr.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=["preflight","smoke"])
    parser.add_argument("--simulate",action="store_true",help="Explicit actual engine recomputation; no LLM API calls")
    parser.add_argument("--output")
    args=parser.parse_args();result=preflight() if args.command=="preflight" else smoke(args.simulate)
    if args.output:
        target=(ROOT/args.output).resolve()
        if not any(target.is_relative_to((ROOT/p).resolve()) for p in ("assistant_brain/final_chat","runtime/agent-c")):parser.error("Output must remain in C review or private runtime directory")
        target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(canonical(result))

if __name__=="__main__":main()
