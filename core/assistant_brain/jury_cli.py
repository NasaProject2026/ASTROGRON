"""Operator preflight, offline/actual-science demo, and tightly budgeted live verification."""
import argparse
from dataclasses import replace
from datetime import datetime,timezone
import math
from pathlib import Path
import time
from .codec import canonical,strict_loads,digest
from .config import Settings
from .errors import ChatError
from .providers import build_provider
from .remote import ProviderRouter,RemoteError
from .service import ConversationService,Principal
from .tools import EngineBackend
from .validation import validate_response

ROOT=Path(__file__).resolve().parents[1]
QUESTIONS=["Why is this five-year rotation conditional?","Explain water for field F1 year 1",
           "And the second year?","Explain nitrogen balances for field F1 year 2","What measurements improve the evidence?"]

def setup(settings,provider=None,simulate=False):
    data=strict_loads((ROOT/"assistant_brain/fixtures/valid.response.json").read_bytes())
    original=strict_loads((ROOT/"assistant_brain/examples/supported.request.json").read_bytes())
    principal=Principal("synthetic-demo",frozenset({data["farm_id"]}),"operator-demo")
    service=ConversationService(settings,provider=provider,backend=EngineBackend(ROOT,settings.simulation_timeout) if simulate else None)
    aid=service.register_analysis(principal,data,original,public_research=True)
    sid=service.create_session(principal,aid)["session_id"]
    return service,principal,aid,sid

def assertion(service,answer):
    ids={answer["analysis_id"]}|{f["analysis_id"] for f in answer["claims"]}
    validate_response(answer,[service.analyses[aid].context for aid in ids])
    return {"mode":answer["mode"],"provider":answer["provider"],"model":answer["model"],
            "scientific_status":answer["scientific_status"],"reason_code":answer["reason_code"],
            "claims_verified":len(answer["claims"]),"evidence_ids":answer["citations"],
            "field_qualified":answer["field_agronomy_qualified"],"grounding_validated":True,
            "provider_latency_ms":answer["provider_latency_ms"]}

def percentile(values,p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("command",choices=["preflight","smoke-demo","live-test"])
    parser.add_argument("--output",default="runtime/agent-c/jury-command.json")
    parser.add_argument("--simulate",action="store_true")
    parser.add_argument("--turns",type=int,default=5)
    parser.add_argument("--confirm-free-tier-gemini",action="store_true")
    parser.add_argument("--confirm-free-tier-groq",action="store_true")
    args=parser.parse_args()
    if not 1<=args.turns<=5:parser.error("Live review is capped at five turns per provider; do not expand implicitly")
    output=(ROOT/args.output).resolve()
    if not any(output.is_relative_to(p) for p in [(ROOT/"runtime/agent-c").resolve(),(ROOT/"assistant_brain/jury").resolve(),(ROOT/"assistant_brain/unified").resolve()]):
        parser.error("Output must remain in C's jury or private runtime directory")
    output.parent.mkdir(parents=True,exist_ok=True)
    settings=Settings.from_env()
    settings=replace(settings,gemini_free_tier_confirmed=settings.gemini_free_tier_confirmed or args.confirm_free_tier_gemini,
                     groq_free_tier_confirmed=settings.groq_free_tier_confirmed or args.confirm_free_tier_groq)
    started=time.monotonic()
    receipt={"timestamp_utc":datetime.now(timezone.utc).isoformat(),"command":args.command,
             "LIVE_GEMINI_VERIFIED":False,"LIVE_GROQ_VERIFIED":False,"FAILOVER_VERIFIED_LIVE":False,
             "actual_inference_calls":{"gemini":0,"groq":0},"actual_model_list_gets":{"gemini":0,"groq":0},
             "remote_account_quotas":None,"quota_source":"Conservative configuration estimates until observed; operator attestation is not account quota observation",
             "turn_assertions":[],"cold_start_remote":"NOT_TESTED","small_sample_limit":"p50/p95 from a small sample are descriptive, not a latency guarantee"}
    if args.command=="preflight":
        router=ProviderRouter(settings)
        receipt["health"]=router.health()
        receipt["evidence_fixtures_present"]=all((ROOT/"assistant_brain/fixtures"/f"{n}.response.json").is_file() for n in ["valid","blocked","response_blocked"])
        receipt["scientific_tool_available"]= (ROOT/"brain/service.py").is_file()
        receipt["scientific_tool_preflight_rerun"]=False
    elif args.command=="smoke-demo":
        service,p,aid,sid=setup(replace(Settings(),demo_mode=True),simulate=args.simulate)
        before=digest(service.analyses[aid].context.document)
        turns=[]
        for text in [QUESTIONS[0],"Why was this sequence selected?","Compare sequences",QUESTIONS[1],QUESTIONS[2]]:
            answer=service.send(p,sid,text);turns.append({"user":text,"assistant":answer});receipt["turn_assertions"].append(assertion(service,answer))
        answer=service.send(p,sid,"What if rainfall falls by 20%?");turns.append({"user":"What if rainfall falls by 20%?","assistant":answer})
        receipt["turn_assertions"].append(assertion(service,answer))
        recomputed=answer.get("tool",{}).get("status")=="NEW_ANALYSIS_CREATED"
        receipt["WHAT_IF_SCIENTIFIC_RECOMPUTATION_VERIFIED"]=recomputed
        receipt["original_preserved"]=before==digest(service.analyses[aid].context.document)
        if recomputed:
            child=answer["analysis_id"]
            actual=service.analyses[child].context.document
            (output.parent/"jury-rain-080.response.json").write_text(canonical(actual)+"\n",encoding="utf-8")
            receipt["new_scenario_ids"]=answer["scenario_reference"]["scenario_ids"]
            receipt["scientific_result_sha256"]=digest(actual)
            comparison=service.compare(p,sid,[aid,child]);turns.append({"user":"Compare the original and changed scientific results","assistant":comparison})
            receipt["turn_assertions"].append(assertion(service,comparison))
        blocked=strict_loads((ROOT/"assistant_brain/fixtures/blocked.response.json").read_bytes())
        bp=Principal("synthetic-demo",frozenset({blocked["farm_id"]}),"operator-demo")
        bid=service.register_analysis(bp,blocked,public_research=True);bsid=service.create_session(bp,bid)["session_id"]
        for text in ["What inputs are missing?","What measurements improve the evidence?"]:
            answer=service.send(bp,bsid,text);turns.append({"user":text,"assistant":answer});receipt["turn_assertions"].append(assertion(service,answer))
        receipt["flows"]=turns
    else:
        # Each provider is exercised independently; fallback to the other vendor cannot fake verification.
        for vendor in ("gemini","groq"):
            config=replace(settings,provider=vendor)
            router=build_provider(config);provider=router.providers[0]
            if not provider.key or not getattr(config,vendor+"_free_tier_confirmed"):
                receipt.setdefault("skipped",{})[vendor]="AUTH_MISSING" if not provider.key else "FREE_TIER_UNVERIFIED"
                continue
            service,p,aid,sid=setup(config,provider=router)
            latencies=[]
            for text in QUESTIONS[:args.turns]:
                # Pace locally without spending a provider attempt on a predictable local cap.
                while provider.quota.snapshot()["requests_last_minute"]>=provider.quota.limits.rpm:
                    time.sleep(1)
                answer=service.send(p,sid,text)
                row=assertion(service,answer);receipt["turn_assertions"].append(row)
                if answer["mode"]=="LIVE_"+vendor.upper():latencies.append(answer["provider_latency_ms"])
                print(vendor,row["mode"],row["reason_code"] or "validated",flush=True)
                if answer["mode"]=="DETERMINISTIC_FALLBACK":break
            receipt["LIVE_"+vendor.upper()+"_VERIFIED"]=bool(latencies)
            receipt["actual_model_list_gets"][vendor]=provider.discovery_calls
            receipt["actual_inference_calls"][vendor]=provider.quota.total_calls-provider.discovery_calls
            receipt.setdefault("latency_ms",{})[vendor]={"n":len(latencies),"p50":percentile(latencies,.5),"p95":percentile(latencies,.95)}
            receipt.setdefault("health",{})[vendor]=provider.health()
    receipt["elapsed_seconds"]=time.monotonic()-started
    output.write_text(canonical(receipt)+"\n",encoding="utf-8")
    print(canonical({k:receipt[k] for k in ["command","LIVE_GEMINI_VERIFIED","LIVE_GROQ_VERIFIED","actual_inference_calls","actual_model_list_gets","elapsed_seconds"]}))
    print("Saved sanitized receipt:",output)

if __name__=="__main__":main()
