"""Client v1 orchestrator around the unchanged, authenticated scientific pipeline."""
from copy import deepcopy
from functools import partial
from pathlib import Path
import json
import re
import threading
from unittest.mock import patch
from .baseline import ROOT, RELEASE, CORE, verify, implementation_identity
from . import nutrient_response, economics
from common import digest, read, parse
from contract import normalize, scientific_gate
from soil_service import Service as SoilService
import global_evidence
import power_source

_RUN_LOCK = threading.RLock()

def validate(payload):
    if not isinstance(payload,dict) or set(payload)-{"schema","farm_id","engine_request","features","economics","growth_decision"}:
        raise ValueError("CLIENT_EXACT_ENVELOPE_KEYS")
    raw=json.dumps(payload,allow_nan=False,ensure_ascii=False)
    if len(raw.encode("utf-8")) > 524288:
        raise ValueError("CLIENT_REQUEST_BYTES_LIMIT")
    if payload.get("schema")!="astragron.client-decision.request.v1":
        raise ValueError("CLIENT_SCHEMA_VERSION")
    if not isinstance(payload.get("farm_id"),str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}",payload["farm_id"]):
        raise ValueError("CLIENT_FARM_ID")
    flags=payload.get("features")
    if not isinstance(flags,dict) or set(flags)!={"soil_memory","nutrient_response"} or any(type(v) is not bool for v in flags.values()):
        raise ValueError("CLIENT_EXPLICIT_FEATURE_FLAGS")
    engine=deepcopy(payload.get("engine_request"))
    if not isinstance(engine,dict):
        raise ValueError("ENGINE_REQUEST_REQUIRED")
    required={"schema","mode","research_acknowledged","location","as_of","horizon_years","units","fields","scenarios"}
    if not required.issubset(engine):
        raise ValueError("CLIENT_EXPLICIT_ENGINE_FIELDS_REQUIRED:"+",".join(sorted(required-set(engine))))
    extension=engine.pop("extensions",None)
    if flags["soil_memory"]:
        if not isinstance(extension,dict) or set(extension)!={"soil_memory"} or not isinstance(extension["soil_memory"],dict) or extension["soil_memory"].get("enabled") is not True:
            raise ValueError("EXPLICIT_ENABLED_SOIL_EXTENSION_REQUIRED")
    elif extension is not None:
        raise ValueError("SOIL_EXTENSION_FEATURE_MISMATCH")
    normalized=normalize(engine)
    if "growth_decision" not in payload:
        scientific_gate(normalized)
    if isinstance(payload.get("growth_decision"),dict) and payload["growth_decision"].get("schema")=="astragron.growth-rotation-decision.request.v1":
        from . import growth_scenario_economics
        econ_index=growth_scenario_economics.validate(payload.get("economics"),normalized,payload["growth_decision"])
    else:econ_index=economics.validate(payload.get("economics"),normalized)
    return flags, econ_index

def _first_constraint(case, soil_cases):
    events=[{"kind":(x.get("constraint") or x.get("reason") or "DECLARED_GROWTH_CONSTRAINT") if "growth_years" in case else "DECLARED_WATER_SERVICE","witness":x} for x in case.get("first_violations",[])]
    for s in soil_cases:
        if s.get("first_violation"):
            events.append({"kind":"DECLARED_ELEMENT_BUDGET","witness":s["first_violation"]})
        for x in s.get("constraint_violations",[]):
            events.append({"kind":"DECLARED_SOIL_CONSTRAINT","witness":x})
    events.sort(key=lambda x:str(x["witness"].get("date",x["witness"].get("source_year","9999"))))
    return events[0] if events else None

def project(payload, result, identity, econ_index):
    d=result.get("normalized_request",payload["engine_request"])
    soil=result.get("soil_memory")
    nutrient=result.get("growth_response") or nutrient_response.evaluate(payload["features"]["nutrient_response"])
    soil_status=(soil or {}).get("status","DISABLED")
    gaps=list(result.get("missing_requirements",[]))
    if soil:
        gaps += [{"path":"extensions.soil_memory."+x["path"],**{k:v for k,v in x.items() if k!="path"}}
                 for x in soil.get("missing_requirements",[])]
    if nutrient["status"]=="EVIDENCE_BLOCKED":
        gaps += [{"path":"nutrient_response","reason":"NO_QUALIFIED_PROVIDER","action":x}
                 for x in nutrient["missing_requirements"]]
    status="EVIDENCE_BLOCKED"
    if result["status"]=="RESEARCH_COMPARISON_COMPLETE" and soil_status in ("DISABLED","SOIL_MEMORY_CONDITIONAL_COMPLETE") and not gaps:
        status="CONDITIONAL_RESEARCH_COMPLETE"
    elif result["status"]=="RESEARCH_COMPARISON_BOUNDED_PARTIAL" or soil_status=="SOIL_MEMORY_BOUNDED_PARTIAL":
        status="BOUNDED_PARTIAL"
    if nutrient["status"]=="EVIDENCE_BLOCKED":
        status="EVIDENCE_BLOCKED"
    decision=(soil or {}).get("integrated_decision") or result.get("research_decision")
    if status!="CONDITIONAL_RESEARCH_COMPLETE":
        decision={"status":"ABSTAIN_REQUIRED_EVIDENCE" if status=="EVIDENCE_BLOCKED" else "ABSTAIN_INCOMPLETE_COMPARISON","selected_ids":[],"water_only_diagnostic":decision,"global_optimum":False,"field_recommendation":None}
    registry=result.get("candidate_registry",{})
    submitted=d.get("candidates",[])
    baseline_id=digest(submitted[0]["choices"])[:20] if submitted else None
    cases=result.get("cases",[])
    baseline={x["scenario_id"]:x for x in cases if x["policy_id"]==baseline_id}
    alternatives=[]
    report_rows=[]
    scenario_map={s["scenario_id"]:s for s in d.get("scenarios",[])}
    for pid, candidate in registry.items():
        outcomes=[]
        comparisons=[]
        for case in [c for c in cases if c["policy_id"]==pid]:
            sid=case["scenario_id"]
            original=scenario_map[sid]
            soil_cases=[s for s in (soil or {}).get("cases",[]) if s["policy_id"]==pid and s["scenario_id"]==sid and not s["control"]]
            years=[]
            for water in case.get("field_harvest_years",[]):
                year=water["harvest_source_year"]
                fid=water["field_id"]
                annual_soil=[{"uncertainty_scenario":s["uncertainty_scenario"],"case_status":s["status"],**a}
                             for s in soil_cases for a in s["annual"]
                             if a["field_id"]==fid and a["source_year"]==year]
                row={"policy_id":pid,"scenario_id":sid,"field_id":fid,"source_year":year,
                     "planning_year_slot":None if "planning_start_year" not in d else d["planning_start_year"]+year-int(original["start"][:4]),
                     "crop_use_id":water["crop_use_id"],"area_ha":water["area_ha"],"water":deepcopy(water),
                     "water_start_state":case.get("year_start_states_mm",{}).get(str(year),{}).get(fid),
                     "water_end_state":case.get("year_end_states_mm",{}).get(str(year),{}).get(fid),
                     "soil_accounting":annual_soil or None,"plant_available_nutrients":None,
                     "biological_uptake":None,"biomass":None,"predicted_yield":None}
                growth_row=next((x for x in case.get("growth_years",[]) if x["field_id"]==fid and x["source_year"]==year),None)
                if growth_row is not None:
                    row["biological_uptake"]={"value":growth_row["modeled_N_uptake_kg_N_ha"],"unit":"kg N/ha","quality":"NATIVE_PROCESS_MODELED_UNVALIDATED"}
                    row["biomass"]={"living_organs":growth_row["modeled_living_organ_DM_kg_ha"],"unit":"kg DM/ha","marketable_yield":None}
                    row["growth_model"]={"provider":nutrient["provider_id"],"termination_date":growth_row["termination_date"],
                        "soil_N_start":growth_row["soil_N_start_kg_N_ha"],"soil_N_end":growth_row["soil_N_end_kg_N_ha"],
                        "boundary_dates":case["annual_water_state_boundary_dates"][str(year)],
                        "water_state_basis":"NATIVE_TOTAL_LAYER_WATER_MM_NOT_LEGACY_AVAILABLE_WATER",
                        "water_start_total_layer_mm":row["water_start_state"],"water_end_total_layer_mm":row["water_end_state"],"field_validated":False}
                    row["water_start_state"]=None
                    row["water_end_state"]=None
                if growth_row is not None and "calendar_evidence" in growth_row:
                    row["growth_model"]["calendar_evidence"]=deepcopy(growth_row["calendar_evidence"])
                if growth_row is not None and growth_row["crop"]=="bare_fallow":
                    row["biological_uptake"]=None;row["biomass"]=None
                    row["growth_model"]["crop_scope"]="NO_CROP_PRESENT_NATIVE_SOIL_CONTINUES"
                row["economics"]=economics.project(payload.get("economics"),econ_index,row)
                years.append(row)
                report_rows.append(deepcopy(row))
            outcomes.append({"scenario_id":sid,"original_weather_period":case.get("period",[original["start"],original["end"]]),
                "historical_scenario_not_forecast":True,"status":case["status"],
                "worst_service_deficit_mm":case.get("max_field_harvest_deficit_mm"),
                "ET_shortfall_m3_equivalent":case.get("ET_shortfall_m3_equivalent"),
                "source_withdrawal_m3":case.get("source_withdrawal_m3"),"service_pass":case.get("service_pass"),
                "first_violated_constraint":_first_constraint(case,soil_cases),
                "first_binding_resource":case.get("first_binding_resource"),
                "field_years":years,"accounting":case.get("accounting"),"soil_reset_count":case.get("soil_reset_count"),
                "soil_constraint_checks":[{"uncertainty_scenario":s["uncertainty_scenario"],
                    "passes":s["passes_declared_soil_constraints"],"constraint_violations":s["constraint_violations"]} for s in soil_cases]})
            base=baseline.get(sid)
            compared=case.get("ET_shortfall_m3_equivalent") is not None and base and base.get("ET_shortfall_m3_equivalent") is not None
            comparisons.append({"scenario_id":sid,"baseline_policy_id":baseline_id,
                "ET_shortfall_delta_m3":case["ET_shortfall_m3_equivalent"]-base["ET_shortfall_m3_equivalent"] if compared else None,
                "source_withdrawal_delta_m3":case["source_withdrawal_m3"]-base["source_withdrawal_m3"] if compared else None})
        alternatives.append({"policy_id":pid,"choices":candidate["choices"],"origin":candidate.get("origin"),
            "scenarios":outcomes,"baseline_comparison":comparisons,
            "important_uncertainty":"Uncalibrated local crop, soil, winter and water-access assumptions; historical scenarios have no assigned probabilities.",
            "decision_reversal_conditions":["Different authenticated historical weather or declared rain intervention",
                "Changed crop/soil parameters or physical water limits after qualification",
                "Changed preference or explicit declared terminal nutrient inventory constraint"],
            "global_optimum":False})
    warnings=["NO_FIELD_VALIDATION","HISTORICAL_ANALOG_NOT_FORECAST","FINITE_SEARCH_NOT_GLOBAL_OPTIMUM",
              "WATER_RIGHTS_NOT_VERIFIED","YIELD_RESPONSE_NOT_QUALIFIED","REGULATORY_PESTICIDE_NOT_VERIFIED",
              "NUTRIENT_INVENTORY_IS_NOT_PLANT_AVAILABILITY"]
    if payload.get("economics") is None:
        warnings.append("ECONOMICS_UNAVAILABLE")
    coverage=result.get("global_coverage",{})
    qualification={"climate_ready":coverage.get("climate_status")=="CLIMATE_READY",
                   "field_agronomy_qualified":False,"water_rights":"NOT_VERIFIED",
                   "soil_accounting_status":soil_status,"nutrient_response_status":nutrient["status"],
                   "plant_availability":"NOT_MODELED","biological_uptake":"NOT_MODELED",
                   "yield_response":"NOT_QUALIFIED","economic_ranking":"NOT_QUALIFIED",
                   "market_demand_export":"NOT_VERIFIED","regulatory_pesticide":"NOT_VERIFIED"}
    provenance={"baseline":identity,"implementation_sha256":implementation_identity(),
                "request_sha256":digest(payload),"engine_provenance":result.get("provenance"),
                "soil_source_ledger":(soil or {}).get("source_ledger",[]),
                "soil_parameter_id":(soil or {}).get("parameter_id"),
                "soil_ancestry_sha256":(soil or {}).get("daily_ancestry_sha256"),
                "soil_scientific_result_sha256":result.get("soil_result_sha256"),
                "historical_research_provenance_preserved":True}
    summary=("Five-year conditional research comparison completed using authenticated historical NASA forcing. "
             "Local agronomic advice, biological yield and legal clearance remain unqualified."
             if status=="CONDITIONAL_RESEARCH_COMPLETE" else
             "The requested comparison is incomplete or lacks required evidence. Review the listed blockers; no field recommendation is issued.")
    response={"schema":"astragron.client-decision.response.v1","farm_id":payload["farm_id"],"status":status,
              "run_id":"","qualification":qualification,"decision":decision,"alternatives":alternatives,
              "assumptions":d.get("assumptions_manifest",[]),"provenance":provenance,"warnings":warnings,
              "missing_requirements":gaps,"nutrient_response":nutrient,
              "report_dto":{"schema":"astragron.client-report-dto.v1","summary":summary,
                  "five_year_rows":report_rows,"alternative_ids":[a["policy_id"] for a in alternatives],
                  "limitations":warnings,"result_pointers":{"alternatives":"/alternatives","decision":"/decision",
                      "raw_science":"/engine_result","provenance":"/provenance","missing_evidence":"/missing_requirements"}},
              "engine_result":result}
    if "growth_evaluation" in result:
        response["growth_evaluation"]=deepcopy(result["growth_evaluation"])
        response["qualification"].update(plant_availability_N="NATIVE_PROCESS_MODELED_UNVALIDATED" if status=="CONDITIONAL_RESEARCH_COMPLETE" else "EVIDENCE_BLOCKED",
            biological_uptake="NATIVE_PROCESS_MODELED_UNVALIDATED" if status=="CONDITIONAL_RESEARCH_COMPLETE" else "EVIDENCE_BLOCKED",
            plant_availability_P_K="NOT_MODELED_INVENTORY_ONLY")
        if status=="CONDITIONAL_RESEARCH_COMPLETE":
            response["report_dto"]["summary"]="Five-year candidates ranked by native growth responses under an explicit common-potato dry-matter research objective. Marketable yield, profit and field advice remain unqualified."
        if result["growth_evaluation"].get("objective",{}).get("version") in ("FIVE_YEAR_CROP_SERVICE_N_LOSS_VECTOR_V1","FIVE_YEAR_THREE_CROP_SERVICE_N_LOSS_VECTOR_V1"):
            response["report_dto"]["summary"]="Exploratory five-year potato/sugarbeet/bare-fallow process comparison with continuous native soil water/N. Separate all-year crop DM and N-loss vectors support partial Pareto comparison; no overall economic winner or field-approved rotation."
            if result["growth_evaluation"]["objective"]["version"]=="FIVE_YEAR_THREE_CROP_SERVICE_N_LOSS_VECTOR_V1":
                response["report_dto"]["summary"]="Five producing annual crop seasons compare potato, sugarbeet and source-pinned spring barley under a conditional research soil/calendar profile. Separate crop DM and N-loss vectors yield Pareto alternatives; field validation, marketable yield and overall economic value remain unqualified."
            from . import growth_scenario_economics
            response["growth_evaluation"]["economics_link"]={"status":"EVIDENCE_BLOCKED_PROCESS_YIELD_CONVERSION_MISSING",
                "marketable_yield":None,"profit":None,"economic_rank":None,
                "missing":["Qualified crop/site/season marketable-yield conversion or observations","Qualified prices and complete cost scope for any model-linked economic claim"]}
            if payload.get("economics") is not None and status=="CONDITIONAL_RESEARCH_COMPLETE":
                response["growth_evaluation"]["scenario_economics"]=growth_scenario_economics.project(payload["economics"],response["alternatives"])
            response["report_dto"]["research_comparison"]={"schema":"astragron.rotation-report-extension.v1","objective":deepcopy(result["growth_evaluation"]["objective"]),"decision_pointer":"/decision",
                "exclusions":"No crop-year excluded; crop values, opportunity cost, marketable yield and profit remain unqualified.",
                "sequence_qualification":"CONDITIONAL_PRODUCING_RESEARCH_NOT_FIELD_APPROVAL" if result["growth_evaluation"]["objective"]["version"]=="FIVE_YEAR_THREE_CROP_SERVICE_N_LOSS_VECTOR_V1" else "EXPLORATORY_PROCESS_RESEARCH_NOT_AGRONOMIC_APPROVAL"}
        for alternative in response["alternatives"]:
            alternative["important_uncertainty"]="Uncalibrated teaching soil/initial states, fixed CO2/calendar and explicit joint N/rain scenarios; no field-validation or probability claim."
            for comparison in alternative["baseline_comparison"]:
                case=next((c for c in cases if c["policy_id"]==alternative["policy_id"] and c["scenario_id"]==comparison["scenario_id"]),None)
                base=baseline.get(comparison["scenario_id"])
                comparison["target_storage_DM_delta_kg_field"]=None if case is None or base is None else case["target_potato_storage_DM_kg_field"]-base["target_potato_storage_DM_kg_field"] if case.get("target_potato_storage_DM_kg_field") is not None and base.get("target_potato_storage_DM_kg_field") is not None else None
    response["run_id"]=digest({"request":payload,"engine_run_id":result["run_id"],
                               "implementation":provenance["implementation_sha256"],"baseline":identity})
    return response

class ClientDecisionService:
    def __init__(self, runtime_dir=None):
        self.runtime=Path(runtime_dir or ROOT/"runtime/agent-a").resolve()
        if not any(self.runtime.is_relative_to((ROOT/"runtime"/role).resolve()) for role in ("agent-a","agent-b")):
            raise ValueError("ISOLATED_AGENT_RUNTIME_SCOPE")
        self.runtime.mkdir(parents=True,exist_ok=True)
        self.source_cache=self.runtime/"source_cache"
        self.engine=SoilService(self.runtime/"engine_cache")

    def run(self,payload,*,use_cache=False):
        flags,econ_index=validate(payload)
        if "growth_decision" in payload:
            from .growth_decision import evaluate
            with _RUN_LOCK:
                result=evaluate(payload,self.runtime)
                return project(payload,result,verify(),econ_index)
        with _RUN_LOCK:
            identity=verify()
            # Seed immutable authentic receipts into A's private cache.
            for receipt_path in sorted((CORE/"source_cache").glob("*.receipt.json")):
                receipt=read(receipt_path)
                raw=(CORE/"source_cache"/(receipt["sha256"]+".raw.json")).read_bytes()
                power_source.verify(receipt,raw,*receipt["point_lon_lat"],*receipt["period"])
                power_source.store(raw,receipt,self.source_cache)
            # The accepted adapter has a fixed default cache location. Override only
            # its source I/O bindings while holding the process-wide orchestration lock.
            with patch.object(global_evidence,"load",partial(power_source.load,cache=self.source_cache)), \
                 patch.object(global_evidence,"acquire",partial(power_source.acquire,cache=self.source_cache)):
                result=self.engine.run(deepcopy(payload["engine_request"]),use_cache=use_cache)
            return project(payload,result,identity,econ_index)
