"""Versioned process-research sidecar; does not qualify Client API v1 field decisions."""
from pathlib import Path
import argparse,json,math,subprocess,sys,tempfile,hashlib
from .baseline import ROOT,verify,implementation_identity
from . import growth_source as source,growth_profiles,producing_profiles,runtime_paths
from common import parse,digest

PROFILE="wageningen-pcse81-nasa-research-v1"
LIMITATIONS=[
 "Published crop parameters plus teaching-example soil, initial water/N, CO2=400 ppm and declared April21/September24 calendars; no local calibration or held-out field validation.",
 "Model available N and modeled crop uptake are process calculations, not measured plant availability or the prior declared inventory withdrawals.",
 "Living storage-organ dry matter is not marketable fresh yield; no yield improvement or profitability claim.",
 "Native coupled crop/water/N equations run inside PCSE; this diagnostic does not rescale Kc or feed the accepted planner ranking.",
 "No automatic crop residue return, P/K response, snow/frozen soil, groundwater, pest benefit or legume credit.",
 "Model-domain N closure names unrouted death and deleted crop stocks; it is not a physical whole-field harvest/residue budget.",
 "Historical NASA weather is gridded evidence, not a forecast or field observation."
]
def validate(request):
    if not isinstance(request,dict) or set(request)!={"schema","profile_id","point_lon_lat","period","research_acknowledged","acquisition","variants"}:
        raise ValueError("EXACT_GROWTH_REQUEST_KEYS_REQUIRED")
    json.dumps(request,allow_nan=False)
    if request["schema"]!="astragron.growth-experiment.request.v1":raise ValueError("GROWTH_SCHEMA_VERSION")
    if request["profile_id"] not in (PROFILE,growth_profiles.ROTATION_PROFILE,producing_profiles.PROFILE) or request["point_lon_lat"]!=source.POINT or request["period"]!=[source.START,source.END]:
        raise source.SourceBlocked("CROP_SITE_PERIOD_OUTSIDE_ADMITTED_RESEARCH_PROFILE")
    if request["research_acknowledged"] is not True:raise source.SourceBlocked("EXPLICIT_UNVALIDATED_RESEARCH_ACKNOWLEDGEMENT_REQUIRED")
    if request["acquisition"] not in ("CACHE_ONLY","FETCH_ALLOWED"):raise ValueError("EXPLICIT_SOURCE_ACQUISITION_REQUIRED")
    variants=request["variants"]
    if not isinstance(variants,list) or not 1<=len(variants)<=4:raise ValueError("ONE_TO_FOUR_BOUNDED_VARIANTS")
    seen=set()
    for v in variants:
        if not isinstance(v,dict) or set(v)!={"id","initial_mineral_N_factor","rain_factor","crop_sequence"}:raise ValueError("EXACT_VARIANT_KEYS")
        if not isinstance(v["id"],str) or not __import__("re").fullmatch("[A-Za-z0-9_-]{1,40}",v["id"]) or v["id"] in seen:raise ValueError("DISTINCT_SAFE_VARIANT_ID")
        seen.add(v["id"])
        for key,lo,hi in (("initial_mineral_N_factor",0,1),("rain_factor",.5,1.5)):
            val=v[key]
            if type(val) not in (int,float) or not math.isfinite(val) or not lo<=val<=hi:raise ValueError("BOUNDED_SCENARIO_INTERVENTION:"+key)
        if not isinstance(v["crop_sequence"],list) or len(v["crop_sequence"])!=5 or any(x not in (producing_profiles.CULTIVARS if request["profile_id"]==producing_profiles.PROFILE else tuple(growth_profiles.CULTIVARS)+("bare_fallow",) if request["profile_id"]==growth_profiles.ROTATION_PROFILE else ("potato","sugarbeet")) for x in v["crop_sequence"]):
            raise source.SourceBlocked("FIVE_PUBLISHED_PARAMETER_CROP_CHOICES_REQUIRED")
        if request["profile_id"]==producing_profiles.PROFILE:
            try:producing_profiles.seasons(v["crop_sequence"]);producing_profiles.verify_sources()
            except ValueError as e:raise source.SourceBlocked(str(e))
        if request["profile_id"]==growth_profiles.ROTATION_PROFILE:
            try:growth_profiles.seasons(v["crop_sequence"])
            except ValueError as e:raise source.SourceBlocked(str(e))
    return request

def blocked(reason):
    return {"schema":"astragron.growth-experiment.response.v1","status":"EVIDENCE_BLOCKED",
            "variants":[],"missing_requirements":[{"code":reason,"action":"Supply the exact admitted, source-verified research inputs or qualified replacement evidence; no geographic or model fallback."}],
            "field_validated":False,"planner_ranking_affected":False,"marketable_yield":None,"profit":None,"limitations":LIMITATIONS}

def run(request,*,runtime_dir=None,python_path=None,timeout_seconds=180):
    try:validate(request)
    except source.SourceBlocked as e:return blocked(str(e))
    runtime=Path(runtime_dir or ROOT/"runtime/agent-a/growth").resolve()
    if not any(runtime.is_relative_to((ROOT/"runtime"/r).resolve()) for r in ("agent-a","agent-b")):raise ValueError("ISOLATED_AGENT_RUNTIME_SCOPE")
    runtime.mkdir(parents=True,exist_ok=True)
    if type(timeout_seconds) not in (int,float) or not 0<timeout_seconds<=180:raise ValueError("BOUNDED_WORKER_TIMEOUT_REQUIRED")
    protected=verify()
    lock_path=ROOT/"coordination/GROWTH_INPUT_LOCK.json"
    lock=json.loads(lock_path.read_text(encoding="utf-8"))
    lock_hash=hashlib.sha256(lock_path.read_bytes()).hexdigest()
    mismatch=[n for n,h in lock["files"].items() if not (ROOT/n).is_file() or hashlib.sha256((ROOT/n).read_bytes()).hexdigest()!=h]
    if mismatch:return blocked("PINNED_GROWTH_INPUT_CHANGED:"+mismatch[0])
    try:doc,receipt=source.acquire(runtime/"source_cache",fetch=request["acquisition"]=="FETCH_ALLOWED")
    except (ValueError,OSError,KeyError) as e:return blocked("NASA_COMPLETE_FORCING_UNAVAILABLE:"+str(e))
    if any(receipt.get(k)!=v for k,v in lock["NASA"].items()):return blocked("NASA_SNAPSHOT_DIFFERS_FROM_REVIEWED_PROFILE")
    try:python_path=runtime_paths.pcse_python(python_path)
    except ValueError as error:return blocked("PINNED_PCSE_RUNTIME_UNAVAILABLE:"+str(error))
    if python_path is None or not python_path.is_file():return blocked("PINNED_PCSE_RUNTIME_UNAVAILABLE")
    worker=Path(tempfile.mkdtemp(prefix="experiment-",dir=runtime))
    payload={"runtime":str(worker),"request":request,"receipt":receipt,
             "raw_path":str(runtime/"source_cache"/(receipt["raw_sha256"]+".raw.json"))}
    try:
        proc=subprocess.run([str(python_path),"-B","-X","utf8","-m","brain.producing_worker" if request["profile_id"]==producing_profiles.PROFILE else "brain.growth_worker"],cwd=ROOT,
                            input=json.dumps(payload).encode(),capture_output=True,timeout=timeout_seconds)
        (worker/"worker.stderr.log").write_bytes(proc.stderr)
        result=parse(proc.stdout.decode("utf-8"))
        if not isinstance(result,dict) or proc.returncode or not result.get("ok"):return blocked("PCSE_PROCESS_NOT_ADMITTED:"+(result.get("error","INVALID_WORKER_RESULT") if isinstance(result,dict) else "INVALID_WORKER_RESULT"))
    except (OSError,ValueError,subprocess.TimeoutExpired) as e:return blocked("PCSE_EXECUTION_UNAVAILABLE:"+str(e))
    result=result.get("result")
    if not isinstance(result,dict) or not isinstance(result.get("variants"),list) or len(result["variants"])!=len(request["variants"]):return blocked("PCSE_INCOMPLETE_WORKER_RESULT")
    response={"schema":"astragron.growth-experiment.response.v1","status":"UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE",
              "run_id":digest({"request":request,"receipt":receipt,"implementation":implementation_identity(),
                               "model":result["pcse_source_sha256"],"parameters":result["parameter_manifest_sha256"],"input_lock_sha256":lock_hash}),
              "request":request,"field_validated":False,"planner_ranking_affected":False,
              "coupling":"NATIVE_PCSE_TWO_WAY_CROP_WATER_N_RESEARCH_MODEL",
              "marketable_yield":None,"profit":None,"economics_status":"EVIDENCE_BLOCKED_MARKETABLE_YIELD_PRICE_COST_MISSING",
              "variants":result["variants"],"provenance":{"NASA":receipt,"parameter_manifest_sha256":result["parameter_manifest_sha256"],
              "pcse_source_sha256":result["pcse_source_sha256"],"input_lock_sha256":lock_hash,"versions":result["versions"],
              "angstrom_estimation":result["angstrom_estimation"],"implementation":implementation_identity(),"protected":protected},
              "missing_requirements":["Held-out crop/site/season observations and local soil/initial N qualification",
                  "Physical crop residue and harvest fate model","Marketable yield conversion and qualified price/cost inputs"],
              "limitations":LIMITATIONS+(producing_profiles.LIMITATIONS if request["profile_id"]==producing_profiles.PROFILE else growth_profiles.LIMITATIONS if request["profile_id"]==growth_profiles.ROTATION_PROFILE else [])}
    if "producing_model" in result:response["provenance"]["producing_model"]=result["producing_model"]
    response["scientific_result_sha256"]=digest(response)
    return response

def main():
    p=argparse.ArgumentParser();p.add_argument("request",type=Path);p.add_argument("--output",type=Path,required=True);p.add_argument("--pcse-python",type=Path)
    args=p.parse_args();target=args.output.resolve()
    roles=[r for r in ("agent-a","agent-b") if target.is_relative_to((ROOT/"runtime"/r).resolve())]
    if not roles:p.error("output must stay inside this worktree's agent runtime")
    if args.request.stat().st_size>32768:p.error("request exceeds 32768 bytes")
    response=run(parse(args.request.read_text(encoding="utf-8-sig")),runtime_dir=ROOT/"runtime"/roles[0]/"growth",python_path=args.pcse_python)
    target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(response,indent=2,allow_nan=False)+"\n",encoding="utf-8")
    print(json.dumps({"status":response["status"],"variants":len(response["variants"]),"output":str(target),
                      "blockers":response.get("missing_requirements") if response["status"]=="EVIDENCE_BLOCKED" else None}))
    return 0 if response["status"]=="UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE" else 3
if __name__=="__main__":raise SystemExit(main())
