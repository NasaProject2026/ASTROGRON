"""Tightly budgeted actual-provider review. No raw secrets or farmer transcripts are saved."""
import argparse
from dataclasses import replace
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import time
from .codec import canonical,strict_loads,digest
from .config import Settings
from .credentials import user_secret
from .jury_cli import setup,assertion,percentile
from .remote import ProviderRouter,RemoteError

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/"assistant_brain/unified"
LEDGER=ROOT/"runtime/agent-c/unified-live-budget.json"

class ReviewBudget:
    def __init__(self):
        LEDGER.parent.mkdir(parents=True,exist_ok=True)
        if LEDGER.exists():self.data=strict_loads(LEDGER.read_bytes())
        else:
            self.data={"review":"unified-user-keys-2026-11-14","events":[
                {"provider":"gemini","kind":"model_list","model":None,"phase":"native preflight","status":200},
                {"provider":"groq","kind":"model_list","model":None,"phase":"initial urllib diagnostic","status":403},
                {"provider":"groq","kind":"model_list","model":None,"phase":"application User-Agent diagnostic","status":200}]}
            self.save()
    def save(self):
        LEDGER.write_text(canonical(self.data)+"\n",encoding="utf-8")
        (FOLDER/"LIVE_USAGE_LEDGER.json").write_text(json.dumps(self.data,indent=2)+"\n",encoding="utf-8")
    def wrap(self,provider,phase):
        actual=provider.transport
        def transport(req,timeout):
            body=strict_loads(req.data) if req.data else {}
            model=body.get("model",provider.model);kind="inference" if req.method=="POST" else "model_list"
            events=self.data["events"]
            same=[e for e in events if e["provider"]==provider.name]
            same_model=[e for e in same if e["kind"]=="inference" and e["model"]==model]
            cap=3 if model==provider.settings.gemini_advanced_model else 6
            # Groq includes its two diagnostic GETs; no more than six physical requests in this review.
            if (provider.name=="groq" and len(same)>=6) or len(same_model)>=cap or (provider.name=="gemini" and len(same)>=10):
                raise RemoteError("REVIEW_TOTAL_BUDGET_EXHAUSTED")
            event={"provider":provider.name,"kind":kind,"model":model,"phase":phase,"timestamp_utc":datetime.now(timezone.utc).isoformat()}
            events.append(event);self.save()
            started=time.monotonic()
            try:
                status,headers,data=actual(req,timeout)
                event["status"]=status
                return status,headers,data
            except RemoteError as error:
                event["reason_code"]=error.code;raise
            finally:
                event["elapsed_ms"]=round((time.monotonic()-started)*1000,3);self.save()
        provider.transport=transport

def run_turn(service,p,aid,sid,text,quality="standard"):
    # Wait on known local reservations instead of spending another API attempt on a predictable cap.
    candidates=service.provider.providers if hasattr(service.provider,"providers") else []
    if quality=="advanced" and getattr(service.provider,"advanced",None):candidates=[service.provider.advanced]
    for provider in candidates:
        if not provider.available():continue
        until=time.monotonic()+65
        estimated=provider.settings.remote_context_bytes+1600+(provider.settings.groq_output_tokens if provider.name=="groq" else provider.settings.remote_output_tokens)
        while time.monotonic()<until:
            try:
                provider.quota.check(estimated)
                if provider.project_quota:provider.project_quota.check(estimated)
                break
            except Exception:
                time.sleep(1)
    result=service.send(p,sid,text,quality_mode=quality)
    row=assertion(service,result)
    row["input_sha256"]=digest(text)
    row["quality_mode"]=quality
    row["scope"]=result["scope"]
    # Count retrieval criterion witnesses; this is not an agronomic quality score.
    row["criterion_witnesses"]=sum(c["pointer"] in {"/decision/preference","/decision/criterion","/engine_result/soil_memory/ranking_effect"} for c in result["claims"])
    print(canonical({"mode":row["mode"],"model":row["model"],"reason_code":row["reason_code"],"claims_verified":row["claims_verified"],"latency_ms":row["provider_latency_ms"]}),flush=True)
    return row

def main():
    parser=argparse.ArgumentParser();parser.add_argument("phase",choices=["smoke","groq-repair","complete","advanced","advanced-repair","advanced-native"])
    parser.add_argument("--confirm-free-tier-gemini",action="store_true");parser.add_argument("--confirm-free-tier-groq",action="store_true")
    args=parser.parse_args();FOLDER.mkdir(exist_ok=True)
    # Explicit user instruction in this review: read newly configured Windows User credentials.
    for name in ("GEMINI_API_KEY","GROQ_API_KEY"):
        value=user_secret(name)
        if value:os.environ[name]=value
    cfg=Settings.from_env()
    cfg=replace(cfg,provider="auto",discover_before_inference=False,remote_timeout_seconds=30 if args.phase.startswith("advanced") else 20,
                groq_tpm=7000,gemini_free_tier_confirmed=args.confirm_free_tier_gemini,
                groq_free_tier_confirmed=args.confirm_free_tier_groq,advanced_enabled=args.phase.startswith("advanced"))
    # Exact canonical model IDs were independently returned by the real catalogs immediately before this review.
    discovery=strict_loads((FOLDER/"CREDENTIALS_AND_MODEL_DISCOVERY.json").read_bytes())
    assert cfg.gemini_model in {r["id"] for r in discovery["providers"]["gemini"].get("models",[])}
    groq_discovery=strict_loads((FOLDER/"GROQ_MODEL_DIAGNOSTIC.json").read_bytes())
    assert groq_discovery["status"]=="MODEL_LIST_VERIFIED"
    budget=ReviewBudget();router=ProviderRouter(cfg)
    for provider in router.providers:budget.wrap(provider,args.phase)
    budget.wrap(router.advanced,args.phase)
    service,p,aid,sid=setup(cfg,provider=router)
    report={"phase":args.phase,"timestamp_utc":datetime.now(timezone.utc).isoformat(),"actual_remote":True,"turns":[],
            "privacy":"Only prevalidated public research facts, no raw farmer message or credentials sent", "catalog_evidence":["CREDENTIALS_AND_MODEL_DISCOVERY.json","GROQ_MODEL_DIAGNOSTIC.json"]}
    if args.phase=="smoke":
        # Independently exercise both vendors; a backup success cannot establish Gemini success.
        for provider in router.providers:
            selected=ProviderRouter(cfg,providers=[provider]);service.provider=selected
            row=run_turn(service,p,aid,sid,"Explain water for field F1 year 2")
            row["expected_provider"]=provider.name;row["health"]=provider.health();report["turns"].append(row)
    elif args.phase=="groq-repair":
        provider=router.providers[1];service.provider=ProviderRouter(cfg,providers=[provider])
        row=run_turn(service,p,aid,sid,"Explain water for field F1 year 2")
        row["expected_provider"]="groq";row["health"]=provider.health();report["turns"].append(row)
    elif args.phase=="complete":
        service.provider=ProviderRouter(cfg,providers=[router.providers[0]])
        for text in ["Why was this sequence preferred?","And what about the third year?"]:
            report["turns"].append(run_turn(service,p,aid,sid,text))
        service.provider=ProviderRouter(cfg,providers=[router.providers[1]])
        if sum(e["provider"]=="groq" for e in budget.data["events"])<5:
            report["turns"].append(run_turn(service,p,aid,sid,"Explain nitrogen phosphorus potassium for field F1 year 2"))
        # Controlled local primary cooldown, then a genuine remote Groq inference. No fake upstream 429.
        router.providers[0].until=time.time()+300;router.providers[0].reason="CONTROLLED_PRIMARY_COOLDOWN"
        service.provider=router
        row=run_turn(service,p,aid,sid,"Explain water for field F1 year 2")
        row["failover_scope"]="Local primary cooldown injected; backup inference and grounding are actually remote. No real outage/429 was induced."
        report["turns"].append(row)
        report["controlled_failover_live_verified"]=row["mode"]=="LIVE_GROQ" and row["grounding_validated"]
    else:
        router.providers=[provider for provider in router.providers if provider.name=="gemini"]
        service.provider=router
        report["turns"].append(run_turn(service,p,aid,sid,"Why was this sequence preferred?","advanced"))
        report["advanced_auto_promotion"]=False
        report["quality_increment_not_assumed"]="Connectivity/grounding only; advanced stays opt-in and is not an automatic fallback or recommendation authority."
    report["provider_health"]=router.health();report["usage_ledger"]=budget.data
    (FOLDER/("LIVE_"+args.phase.upper()+".json")).write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    budget.save()

if __name__=="__main__":main()
