"""Opt-in five-year candidate evaluator using actual native growth responses."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import hashlib,json,time
from .baseline import ROOT,verify,implementation_identity
from . import growth_experiment as provider,growth_source,growth_pk,growth_profiles,growth_rotation,producing_profiles
from common import digest,read,runtime as runtime_identity
from contract import normalize,scientific_gate
from kernels import R

POTATO="research:NL:potato_Fontane"
BEET="research:NL:sugarbeet_601"
CROPS={POTATO:"potato",BEET:"sugarbeet"}
SCOPE="CONDITIONAL_NATIVE_GROWTH_RESEARCH_NOT_FIELD_ADVICE"
class Blocked(ValueError):pass

def _base(d,reason=None):
    gaps=[] if reason is None else [{"path":"growth_decision","reason":str(reason),"action":"Use the admitted single-field rainfed profile and explicit complete candidate/scenario inputs; unsupported evidence is not filled."}]
    return {"schema":"astragron.growth-backed-engine.response.v1",
        "status":"ABSTAIN" if reason else "RESEARCH_COMPARISON_COMPLETE","reason":reason,
        "run_id":digest({"request":d,"reason":reason,"implementation":implementation_identity()}),
        "normalized_request":d,"global_coverage":{"climate_status":"NOT_EVALUATED","crop_field_qualification":"NOT_ESTABLISHED","water_rights":"NOT_VERIFIED"},
        "cases":[],"candidate_registry":{},"candidate_rejections":[],
        "research_decision":None,"missing_requirements":gaps,
        "growth_response":{"schema":"astragron.nutrient-response.v1","status":"EVIDENCE_BLOCKED" if reason else "CONDITIONAL_PROCESS_RESEARCH_COMPLETE",
            "provider_id":provider.PROFILE,"coupling":"NATIVE_PCSE_TWO_WAY_CROP_WATER_N_RESEARCH_MODEL",
            "ranking_affected":not bool(reason),"field_validated":False,"marketable_yield":None,"profit":None,"missing_requirements":gaps},
        "provenance":{"NO_FIELD_VALIDATION":True,"scope":SCOPE},
        "execution":{"physics_cases_executed":0,"rankings_executed":False},
        "growth_evaluation":{"schema":"astragron.growth-decision.response.v1","status":"EVIDENCE_BLOCKED" if reason else "COMPLETE",
            "field_validated":False,"marketable_yield":None,"profit":None,"scope":SCOPE}}

def admit(payload,d):
    if not isinstance(d.get("assumptions_manifest"),list) or not d["assumptions_manifest"]:raise Blocked("EXPLICIT_RESEARCH_ASSUMPTION_MANIFEST_REQUIRED")
    scientific_gate(d) # Validate supplied source manifests; missing legacy Kc inputs are replaced only by the admitted native capsule.
    g=payload["growth_decision"]
    rotation=isinstance(g,dict) and g.get("schema")==growth_rotation.SCHEMA
    if not isinstance(g,dict) or set(g)!=({"schema","profile_id","objective","scenarios","constraints","pk_scope"}|({"rotation"} if rotation else set())):
        raise ValueError("EXACT_GROWTH_DECISION_KEYS_REQUIRED")
    if not rotation and g["schema"]!="astragron.growth-decision.request.v1":raise ValueError("GROWTH_DECISION_SCHEMA")
    if g["profile_id"] not in ((growth_profiles.ROTATION_PROFILE,producing_profiles.PROFILE) if rotation else (provider.PROFILE,)) or d["location"]["point_lon_lat"]!=growth_source.POINT or d["location"]["country"]!="NL":
        raise Blocked("UNSUPPORTED_CROP_SITE_PROFILE")
    if d["mode"]!="RESEARCH_SCENARIO" or d["research_acknowledged"] is not True or payload["features"]["nutrient_response"] is not True:
        raise Blocked("EXPLICIT_CONDITIONAL_GROWTH_RESEARCH_ACK_REQUIRED")
    if d.get("require_N") or d.get("require_yield"):
        raise Blocked("LEGACY_FIELD_N_OR_YIELD_QUALIFICATION_IS_NOT_GRANTED_BY_RESEARCH_BRIDGE")
    if (not rotation and payload.get("economics") is not None) or d.get("economic_sidecar") is not None:
        raise Blocked("GROWTH_ECONOMICS_BLOCKED_NO_QUALIFIED_MARKETABLE_YIELD_CONVERSION_PRICE_COST")
    if len(d["fields"])!=1:raise Blocked("ONLY_ONE_EXPLICIT_RAINFED_FIELD_ADMITTED")
    f=d["fields"][0]
    if f["irrigation_access"] or (not rotation and (f["history"] or f.get("rotation_constraints"))):
        raise Blocked("IRRIGATION_PRE_PERIOD_HISTORY_OR_ADDITIONAL_ROTATION_CONSTRAINT_NOT_SUPPORTED")
    if set(f["crop_candidates"])-set(producing_profiles.CROPS if g["profile_id"]==producing_profiles.PROFILE else growth_rotation.CROPS if rotation else CROPS):raise Blocked("UNSUPPORTED_CROP_CULTIVAR")
    if d.get("crop_profiles") not in (None,{}) or d.get("winter") is not None:
        raise Blocked("EXTERNAL_LEGACY_COEFFICIENT_OR_WINTER_OVERRIDE_NOT_ADMITTED")
    if f.get("soil",{}).get("layer_thickness_m")!=[.25,.15,.2,.6] or set(f.get("soil",{}))-{"layer_thickness_m"}:
        raise Blocked("NATIVE_FOUR_LAYER_TEACHING_PROFILE_REQUIRED_NO_FIELD_HYDRAULIC_OVERRIDE")
    s=d.get("supply")
    if not isinstance(s,dict) or set(s)!={"annual_farm_source_m3","source_daily_m3","pump_daily_m3","rights_basis"} or any(type(s[k]) not in (int,float) or s[k]!=0 for k in ("annual_farm_source_m3","source_daily_m3","pump_daily_m3")) or s["rights_basis"]!="ASSUMED_NOT_VERIFIED":
        raise Blocked("EXPLICIT_RAINFED_ZERO_ABSTRACTION_SCOPE_REQUIRED")
    if d.get("preference") is not None:raise Blocked("PREFERENCE_MUST_USE_EXPLICIT_VERSIONED_GROWTH_OBJECTIVE")
    if rotation:
        try:admitted,rejected,search=growth_rotation.candidates(d,g,Blocked)
        except ValueError as error:raise Blocked(str(error)) from error
        d["candidates"]=admitted
        g=deepcopy(g);g["_rotation_search"]=search;g["_rotation_rejections"]=rejected
    elif not 2<=len(d["candidates"])<=4 or d["search"]["max_generated"]!=0:
        raise Blocked("TWO_TO_FOUR_EXPLICIT_CANDIDATES_NO_UNQUALIFIED_GENERATION")
    if d["search"]["max_candidates"]<len(d["candidates"]) or d["search"]["max_evaluations"]<len(d["candidates"])*len(d["scenarios"]):
        raise Blocked("BUDGET_CANNOT_COVER_COMPLETE_CANDIDATE_SCENARIO_MATRIX")
    if d["search"]["max_cpu_seconds"]<d["search"]["max_wall_seconds"]:raise Blocked("SEPARATE_TIGHTER_CPU_CAP_NOT_METERED_BY_GROWTH_BRIDGE")
    if len(d["scenarios"])>3:raise Blocked("ONE_TO_THREE_EXPLICIT_JOINT_UNCERTAINTY_SCENARIOS")
    if d["source"].get("provider")!="NASA_POWER_GLOBAL" or not d["source"].get("enabled") or [d["source"].get("historical_start"),d["source"].get("historical_end")]!=[growth_source.START,growth_source.END]:
        raise Blocked("COMPLETE_FIXED_NATIVE_NASA_PROFILE_REQUIRED_NO_SOURCE_ABLATION_FALLBACK")
    if any([s["start"],s["end"]]!=[growth_source.START,growth_source.END] or s["supply_overrides"] or not .5<=s["rain_factor"]<=1 for s in d["scenarios"]):
        raise Blocked("EXACT_2016_2020_ANALOG_AND_DECLARED_RAIN_INTERVENTION_REQUIRED")
    ns=g["scenarios"]
    if not isinstance(ns,list) or any(not isinstance(x,dict) or set(x)!={"scenario_id","initial_mineral_N_factor"} for x in ns):
        raise ValueError("EXPLICIT_N_SCENARIO_KEYS")
    if len(ns)!=len(d["scenarios"]) or len({x["scenario_id"] for x in ns})!=len(ns) or {x["scenario_id"] for x in ns}!={x["scenario_id"] for x in d["scenarios"]}:
        raise Blocked("EXACT_MATCHED_N_AND_WEATHER_SCENARIOS_REQUIRED")
    for x in ns:
        n=x["initial_mineral_N_factor"]
        if type(n) not in (int,float) or not 0<=n<=1:raise ValueError("INITIAL_MINERAL_N_FACTOR_0_TO_1")
    objective=g["objective"]
    if not isinstance(objective,dict) or set(objective)!={"version","criterion","target_years","acknowledgment"}:
        raise ValueError("EXACT_GROWTH_OBJECTIVE_KEYS")
    if not rotation:
        if objective["version"]!="FOLLOW_ON_POTATO_STORAGE_DM_V1" or objective["criterion"] not in ("maximin","minimax_regret") or objective["acknowledgment"]!="MODELED_DRY_MATTER_NOT_MARKETABLE_YIELD_OR_PROFIT":
            raise Blocked("EXPLICIT_COMPARABLE_DRY_MATTER_RESEARCH_OBJECTIVE_REQUIRED")
        years=objective["target_years"]
        if not isinstance(years,list) or not years or len(set(years))!=len(years) or any(type(y) is not int or y not in range(2017,2021) for y in years):
            raise Blocked("COMMON_FOLLOW_ON_POTATO_YEARS_2017_TO_2020_REQUIRED")
        for c in d["candidates"]:
            if any(c["choices"][f["field_id"]][y-2016]!=POTATO for y in years):
                raise Blocked("CROSS_CROP_DRY_MATTER_NOT_A_COMPARABLE_VALUE_OBJECTIVE")
    constraints=g["constraints"]
    if not isinstance(constraints,dict) or set(constraints)!={"max_modeled_N_leaching"}:raise ValueError("EXACT_GROWTH_CONSTRAINT_KEYS")
    cap=constraints["max_modeled_N_leaching"]
    if cap is not None:
        if not isinstance(cap,dict) or set(cap)!={"value","unit","basis"} or cap["unit"]!="kg N/ha" or cap["basis"]!="EXPLICIT_RESEARCH_CONSTRAINT_NOT_REGULATION":
            raise ValueError("N_LEACHING_CONSTRAINT_UNIT_BASIS")
        if type(cap["value"]) not in (int,float) or not 0<=cap["value"]<=10000:raise ValueError("FINITE_N_LEACHING_RESEARCH_CAP")
    if g["pk_scope"]!="DECLARED_P_K_ONLY_NATIVE_N_FROM_PCSE":raise Blocked("EXPLICIT_PK_AND_NATIVE_N_SCOPE_REQUIRED")
    if payload["features"]["soil_memory"]:
        ext=payload["engine_request"]["extensions"]["soil_memory"]
        gaps=growth_pk.admission(ext,d)
        if gaps:raise Blocked(str(gaps))
        required=len(d["candidates"])*len(d["scenarios"])*len(ext["uncertainty_scenarios"])*5
        if ext["max_daily_steps"]<required:raise Blocked("PK_ACCOUNTING_STEP_BUDGET_INCOMPLETE")
    return g

def rank(rows,policy_ids,scenario_ids,objective):
    if objective["version"] in (growth_rotation.OBJECTIVE,producing_profiles.OBJECTIVE):return growth_rotation.rank(rows,policy_ids,scenario_ids,objective)
    # Same original quantization/tie helper as the accepted decision kernels.
    index={(r["policy_id"],r["scenario_id"]):r for r in rows}
    if len(index)!=len(rows) or any((p,s) not in index for p in policy_ids for s in scenario_ids):
        return {"status":"ABSTAIN_INCOMPLETE_GROWTH_MATRIX","selected_ids":[],"global_optimum":False}
    feasible=[p for p in policy_ids if all(index[p,s]["growth_constraints_pass"] for s in scenario_ids)]
    if not feasible:return {"status":"ABSTAIN_NO_FEASIBLE_TESTED_GROWTH_PLAN","selected_ids":[],"global_optimum":False}
    values={(p,s):R.q(index[p,s]["target_potato_storage_DM_kg_field"],6) for p in feasible for s in scenario_ids}
    worst={p:min(values[p,s] for s in scenario_ids) for p in feasible}
    best={s:max(values[p,s] for p in feasible) for s in scenario_ids}
    regret={p:max(best[s]-values[p,s] for s in scenario_ids) for p in feasible}
    selected=R.tie_min({p:-worst[p] for p in feasible})["policy_ids"] if objective["criterion"]=="maximin" else R.tie_min(regret)["policy_ids"]
    vectors={p:tuple(-values[p,s] for s in scenario_ids) for p in feasible}
    return {"status":"CONDITIONAL_NATIVE_GROWTH_RESEARCH_SELECTION","objective_version":objective["version"],
        "criterion":objective["criterion"],"selected_ids":selected,"common_comparison_ids":policy_ids,
        "feasible_ids":feasible,"pareto_ids":R.front(vectors),"global_optimum":False,
        "field_recommendation":None,"target_years":objective["target_years"],
        "objectives":[{"policy_id":p,"worst_target_storage_DM_kg_field":str(worst[p]),
            "maximum_regret_storage_DM_kg_field":str(regret[p])} for p in feasible],
        "units":{"objective":"kg modeled living potato storage-organ DM per field, summed only over declared common years"},
        "uncertainty":"Explicit matched joint scenarios, not probabilities or a calibrated complete uncertainty enclosure",
        "precision_kg_DM":"0.000001 numerical ranking quantization; not predictive precision",
        "search_scope":"FINITE_SUBMITTED_CANDIDATE_SET_NOT_GLOBAL_OPTIMUM"}

def _context(runtime,d):
    lock=read(ROOT/"coordination/GROWTH_INPUT_LOCK.json")
    for n,h in lock["files"].items():
        if not (ROOT/n).is_file() or hashlib.sha256((ROOT/n).read_bytes()).hexdigest()!=h:raise Blocked("GROWTH_INPUT_SOURCE_HASH_CHANGED:"+n)
    cache=runtime/"provider"
    source_cache=cache/"source_cache";source_cache.mkdir(parents=True,exist_ok=True)
    role=runtime.relative_to(ROOT/"runtime").parts[0]
    seeds=[ROOT/"runtime"/role/"growth/source_cache",ROOT/"runtime"/role/"growth-decision/provider/source_cache"]
    seed=next((p for p in seeds if (p/"growth-weather.receipt.json").is_file()),seeds[0])
    if not (source_cache/"growth-weather.receipt.json").exists() and (seed/"growth-weather.receipt.json").is_file():
        receipt=read(seed/"growth-weather.receipt.json")
        raw=(seed/(receipt["raw_sha256"]+".raw.json")).read_bytes()
        growth_source.verify(raw,receipt)
        if any(receipt.get(k)!=v for k,v in lock["NASA"].items()):raise Blocked("SEED_SNAPSHOT_NOT_ADMITTED")
        for target,content in ((source_cache/(receipt["raw_sha256"]+".raw.json"),raw),
                (source_cache/"growth-weather.receipt.json",(seed/"growth-weather.receipt.json").read_bytes())):
            if not target.exists():
                with target.open("xb") as stream:stream.write(content)
    try:doc,receipt=growth_source.acquire(source_cache,fetch=d["source"]["acquisition"]=="FETCH_ALLOWED")
    except (ValueError,OSError,KeyError) as error:raise Blocked("COMPLETE_NATIVE_SOURCE_UNAVAILABLE:"+str(error))
    if any(receipt.get(k)!=v for k,v in lock["NASA"].items()):raise Blocked("NATIVE_SOURCE_SNAPSHOT_CHANGED")
    from kernels import P
    if d["source"]["snapshot_policy"]=="REQUEST_CUTOFF" and P.instant(receipt["retrieved_at"])>P.instant(d["as_of"]):raise Blocked("NASA_SNAPSHOT_POSTDATES_REQUEST_CUTOFF")
    identity={"input_lock_sha256":hashlib.sha256((ROOT/"coordination/GROWTH_INPUT_LOCK.json").read_bytes()).hexdigest(),
              "NASA":lock["NASA"],"model_source_sha256":lock["pcse_source_sha256"],
              "provider_sources":{n:hashlib.sha256((ROOT/"brain"/n).read_bytes()).hexdigest() for n in ("growth_worker.py","growth_source.py","growth_experiment.py","growth_profiles.py","runtime_paths.py")}}
    return cache,receipt,identity

def _load_case(path,key):
    try:
        entry=read(path);core={k:v for k,v in entry.items() if k!="integrity"}
        if entry.get("key")!=key or entry.get("integrity")!=digest(core):return None
        v=entry["variant"]
        if len(v["crop_results"])!=sum(c!="bare_fallow" for c in v.get("harvest_slot_crop_sequence",["crop"]*5)) or v["integrated_days"]!=1826 or v["accounting"]["N_coupling_status"]!="PASSED":return None
        if v["accounting"]["orphaned_soil_uptake_kg_N_ha"]!=0 or abs(v["accounting"]["model_domain_N_residual_kg_N_ha"])>1e-6:return None
        return entry
    except (OSError,ValueError,KeyError,TypeError):return None

def evaluate(payload,runtime_dir):
    raw=deepcopy(payload["engine_request"]);ext=raw.pop("extensions",None)
    d=normalize(raw);result=_base(d);runtime=Path(runtime_dir)/"growth-decision";runtime.mkdir(parents=True,exist_ok=True)
    started=time.monotonic();budget=d["search"]["max_wall_seconds"]
    try:
        g=admit(payload,d)
        provider_runtime,receipt,identity=_context(runtime,d)
        rotation=g["schema"]==growth_rotation.SCHEMA
        identity["profile_id"]=g["profile_id"]
        producing=g["profile_id"]==producing_profiles.PROFILE
        if producing:
            try:identity["producing_parameters"]=producing_profiles.verify_sources()
            except ValueError as error:raise Blocked(str(error)) from error
            identity["producing_sources"]={n:hashlib.sha256((ROOT/"brain"/n).read_bytes()).hexdigest() for n in ("producing_worker.py","producing_profiles.py","root_depth_adapter.py")}
        result["global_coverage"]={"climate_status":"CLIMATE_READY","crop_field_qualification":"NOT_ESTABLISHED",
            "water_rights":"NOT_VERIFIED","available_climate":receipt["qualification"]}
        result["provenance"].update(native_source=receipt,growth_input_identity=identity)
        field=d["fields"][0];fid=field["field_id"]
        registry={digest(c["choices"])[:20]:{"policy_id":digest(c["choices"])[:20],"choices":c["choices"],"origin":c.get("origin","USER_SUBMITTED"),"label":c.get("label")} for c in d["candidates"]}
        result["candidate_registry"]=registry
        if rotation:
            result["candidate_rejections"]=g["_rotation_rejections"]
            result["growth_evaluation"]["candidate_generation"]=g["_rotation_search"]
            result["growth_response"]["provider_id"]=g["profile_id"]
        n_by={s["scenario_id"]:s["initial_mineral_N_factor"] for s in g["scenarios"]}
        specs={};links={};case_dir=runtime/"scientific_case_cache";case_dir.mkdir(exist_ok=True)
        for pid,c in registry.items():
            for s in d["scenarios"]:
                spec={"initial_mineral_N_factor":n_by[s["scenario_id"]],"rain_factor":s["rain_factor"],
                      "crop_sequence":[(producing_profiles.CROPS if producing else growth_rotation.CROPS if rotation else CROPS)[x] for x in c["choices"][fid]]}
                key=digest({"spec":spec,"context":identity});specs[key]=dict(spec,id="C"+key[:20]);links[pid,s["scenario_id"]]=key
        computed={};hits=0;misses=[]
        for key in specs:
            entry=_load_case(case_dir/(key+".json"),key)
            if entry is None:misses.append(key)
            else:computed[key]=entry;hits+=1
        for i in range(0,len(misses),4):
            remaining=budget-(time.monotonic()-started)
            if remaining<=0:raise Blocked("GROWTH_COMPUTE_BUDGET_EXHAUSTED_NO_COMPLETE_RANKING")
            keys=misses[i:i+4]
            request={"schema":"astragron.growth-experiment.request.v1","profile_id":g["profile_id"],
                "point_lon_lat":growth_source.POINT,"period":[growth_source.START,growth_source.END],
                "research_acknowledged":True,"acquisition":"CACHE_ONLY","variants":[specs[k] for k in keys]}
            run=provider.run(request,runtime_dir=provider_runtime,timeout_seconds=min(180,remaining))
            if run["status"]!="UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE":raise Blocked("NATIVE_GROWTH_CASE_FAILED:"+str(run["missing_requirements"]))
            for key,v in zip(keys,run["variants"]):
                if v["id"]!=specs[key]["id"]:raise Blocked("NATIVE_CASE_MAPPING_MISMATCH")
                entry={"key":key,"variant":v,"provider_provenance":run["provenance"]}
                entry["integrity"]=digest(entry);computed[key]=entry
                (case_dir/(key+".json")).write_text(json.dumps(entry)+"\n",encoding="utf-8")
        if time.monotonic()-started>budget:raise Blocked("GROWTH_COMPUTE_BUDGET_EXHAUSTED_NO_COMPLETE_RANKING")
        if len({digest(x["provider_provenance"]["versions"]) for x in computed.values()})!=1:raise Blocked("MIXED_MODEL_RUNTIME_COMPARISONS_NOT_ADMITTED")
        pk_cases=[];native_cases=[];cap=g["constraints"]["max_modeled_N_leaching"]
        for pid,c in registry.items():
            for s in d["scenarios"]:
                key=links[pid,s["scenario_id"]];entry=computed[key];native=entry["variant"]
                annual=[];growth_years=[];ystart={};yend={};boundaries={}
                calendar=growth_rotation.calendar_evidence(native,c["choices"][fid]) if rotation else {}
                trace_by={x["date"]:x for x in native["daily_process_trace"]}
                for cr in (growth_profiles.annual_results(native) if rotation else native["crop_results"]):
                    y=cr["original_weather_year"];a=str(y)+"-01-01";b=str(y+1)+"-01-01" if y<2020 else "2020-12-31"
                    ystart[str(y)]={fid:trace_by[a]["soil_water_state"]["layer_water_mm"]}
                    yend[str(y)]={fid:trace_by[b]["soil_water_state"]["layer_water_mm"]}
                    boundaries[str(y)]={"start":a,"end":b,"end_is_terminal_start_of_day":y==2020}
                    annual.append({"field_id":fid,"harvest_source_year":y,"crop_use_id":c["choices"][fid][y-2016],"area_ha":field["area_ha"],
                        "crop_ET_deficit_mm":None,"ET_actual_mm":None,"ET_potential_mm":None,"source_withdrawal_m3":0,"first_service_violation":None})
                    growth_years.append({"field_id":fid,"source_year":y,**cr,**({"calendar_evidence":calendar[str(y)]} if rotation else {}),
                        "soil_N_start_kg_N_ha":{"NO3":trace_by[a]["soil_NO3_kg_N_ha"],"NH4":trace_by[a]["soil_NH4_kg_N_ha"]},
                        "soil_N_end_kg_N_ha":{"NO3":trace_by[b]["soil_NO3_kg_N_ha"],"NH4":trace_by[b]["soil_NH4_kg_N_ha"]}})
                pk=[]
                if payload["features"]["soil_memory"]:
                    pk=growth_pk.evaluate(ext["soil_memory"],d,pid,s,c["choices"],native);pk_cases+=pk
                violations=[]
                if cap is not None and native["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"]>cap["value"]:
                    violations.append({"date":"2020-12-31","constraint":"DECLARED_NATIVE_N_LEACHING_RESEARCH_CAP",
                        "actual":native["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"],"limit":cap["value"],"unit":"kg N/ha","not_a_legal_or_field_threshold":True})
                if any(not x["passes_declared_soil_constraints"] for x in pk):
                    violations += [v for x in pk for v in x["constraint_violations"]]
                target=None if rotation else sum(x["modeled_living_organ_DM_kg_ha"]["SO"] for x in native["crop_results"] if x["original_weather_year"] in g["objective"]["target_years"])*field["area_ha"]
                services=growth_rotation.metric(native,field["area_ha"]) if rotation else None
                result["cases"].append({"policy_id":pid,"scenario_id":s["scenario_id"],
                    "status":"valid_research_comparison" if not violations else "evaluated_but_declared_constraint_violated",
                    "target_potato_storage_DM_kg_field":target,**({"five_year_services":services} if rotation else {}),"growth_constraints_pass":not violations,
                    "growth_constraint_violations":violations,"growth_years":growth_years,"field_harvest_years":annual,
                    "year_start_states_mm":ystart,"year_end_states_mm":yend,"annual_water_state_boundary_dates":boundaries,
                    "soil_reset_count":0,"source_withdrawal_m3":0,"service_pass":None if rotation else not violations,
                    **({"modeled_research_constraints_pass":not violations,"water_service_status":"NOT_COMPUTED_NATIVE_ET_SERVICE_METRIC_UNAVAILABLE",
                    "no_crop_integrated_days":sum(not x["crop_present"] for x in native["daily_process_trace"] if x["date"]<"2020-12-31"),
                    "source_fallow_count_scope":"Original native audit fallow_integrated_days counts only inter-crop phases; no_crop_integrated_days also includes pre/post crop years."} if rotation else {}),
                    "ET_shortfall_m3_equivalent":None,"max_field_harvest_deficit_mm":None,
                    "first_violations":violations,"first_binding_resource":None,"period":[s["start"],s["end"]],
                    "accounting":native["accounting"],"water_budget":native["water_budget"],
                    "growth_case_key":key,"model_scope":SCOPE,
                    "legacy_ET_service_metrics":"NOT_COMPUTED_BY_NATIVE_GROWTH_MODEL"})
                native_cases.append({"policy_id":pid,"scenario_id":s["scenario_id"],"case_key":key,"result":native,
                    "execution":"VERIFIED_CONTENT_BOUND_CACHE_REPLAY" if key not in misses else "FRESH_NATIVE_MODEL_EXECUTION"})
        decision=rank(result["cases"],list(registry),[s["scenario_id"] for s in d["scenarios"]],g["objective"])
        if time.monotonic()-started>budget:raise Blocked("GROWTH_COMPUTE_BUDGET_EXHAUSTED_NO_COMPLETE_RANKING")
        result["research_decision"]=decision
        result["execution"]={"physics_cases_executed":len(misses),"candidate_scenario_evaluations":len(result["cases"]),"numerical_cache_replays":hits,"rankings_executed":True}
        result["search"]={"status":"COMPLETE_FINITE_REQUESTED_MATRIX","global_optimum":False,"candidate_count":len(registry),
            "scenario_count":len(d["scenarios"]),"complete_requested_candidate_domain":True,"compute_wall_seconds":time.monotonic()-started}
        if payload["features"]["soil_memory"]:
            result["soil_memory"]={"schema":"astragron.pk-memory.response.v1","status":"SOIL_MEMORY_CONDITIONAL_COMPLETE",
                "scope":"P_K_ONLY; N_FROM_NATIVE_SNOMIN","cases":pk_cases,"missing_requirements":[],
                "source_ledger":ext["soil_memory"]["sources"],"parameter_id":ext["soil_memory"]["parameter_id"],
                "integrated_decision":decision,"field_validated":False,"ranking_effect":"DECLARED_PK_FEASIBILITY_FILTER_THEN_NATIVE_GROWTH_OBJECTIVE"}
        result["growth_evaluation"].update(objective=g["objective"],constraints=g["constraints"],
            scenarios=g["scenarios"],candidate_scenario_cases=native_cases,input_identity=identity,
            primary_decision_pointer="/decision",growth_responses_influence_primary_ranking=True,
            first_year_crop_value_excluded="No crop-year is excluded from the vector; all crop value and fallow opportunity cost remain unpriced." if rotation else "Target years compare potato Fontane only; predecessor crop revenue/value is not estimated.",
            P_K="Declared inventory constraints only; no P/K availability or growth response model.",
            N="Native modeled availability/uptake; auxiliary N budget placeholders never enter crop physiology.",
            harvest_residue_fate="HARVEST_RESIDUE_FATE_NOT_QUALIFIED",
            uncertainty="Explicit joint source-bound counterfactuals; no probabilities or calibrated uncertainty envelope",
            limitations=[x for x in provider.LIMITATIONS if "does not rescale Kc" not in x and (not rotation or "April21/September24" not in x)]+(producing_profiles.LIMITATIONS if producing else growth_profiles.LIMITATIONS if rotation else ["The explicit growth bridge ranks only the declared comparable potato dry-matter objective; predecessor value and marketable yield are not scored."]),
            source_snapshot=receipt,model_runtime=next(iter(computed.values()))["provider_provenance"]["versions"])
        result["growth_response"].update({"biological_uptake":"NATIVE_PROCESS_MODELED_UNVALIDATED","biomass":"LIVING_ORGAN_DRY_MATTER_MODELED",
            "yield":None,"profit":None,"ranking_affected":True,"missing_requirements":[]})
        result["run_id"]=digest({"payload":payload,"inputs":identity,"implementation":implementation_identity()})
        scientific=deepcopy({k:v for k,v in result.items() if k not in ("search","execution")})
        for item in scientific["growth_evaluation"]["candidate_scenario_cases"]:item.pop("execution",None)
        result["scientific_result_sha256"]=digest(scientific)
        return result
    except Blocked as error:
        blocked=_base(d,str(error))
        blocked["global_coverage"]=result["global_coverage"]
        blocked["provenance"]=result["provenance"]
        blocked["growth_evaluation"]["evaluated_cases_retained"]=result.get("cases",[])
        return blocked
