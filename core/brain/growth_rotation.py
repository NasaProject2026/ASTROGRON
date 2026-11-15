"""Finite, screened research rotations and non-commensurated five-year objectives."""
from collections import Counter
from copy import deepcopy
from itertools import product
import math
from . import growth_profiles as profiles,producing_profiles
from common import digest
from kernels import R

SCHEMA="astragron.growth-rotation-decision.request.v1"
POTATO="research:NL:potato_Fontane"
BEET="research:NL:sugarbeet_601"
FALLOW="research:bare_fallow"
CROPS={POTATO:"potato",BEET:"sugarbeet",FALLOW:"bare_fallow"}
PRODUCING_CROPS={POTATO:"potato",BEET:"sugarbeet"}
OBJECTIVE="FIVE_YEAR_CROP_SERVICE_N_LOSS_VECTOR_V1"
ACK="SEPARATE_CROP_DRY_MATTER_SERVICES_AND_N_LOSS_NOT_OVERALL_FARM_VALUE"
YEARS=list(range(2016,2021))
SOURCE="https://doi.org/10.3389/fagro.2024.1470598"
RULES_SCOPE="Conservative declared research screen; Dutch experiment uses potato/beet 1-in-4. Bare fallow is only an explicit process comparator. No universal agronomic or legal rule or field clearance."

def check_config(g,field):
    cfg=g["rotation"];producing=g["profile_id"]==producing_profiles.PROFILE
    crops=producing_profiles.CROPS if producing else PRODUCING_CROPS
    if not isinstance(cfg,dict) or set(cfg)!={"version","mode","year_options","minimum_crop_slots","profile_acknowledgment"}:
        raise ValueError("EXACT_ROTATION_CONFIGURATION_KEYS")
    if cfg["version"]!=("BOUNDED_THREE_CROP_PRODUCTION_SCREEN_V1" if producing else "BOUNDED_TWO_CROP_FALLOW_SCREEN_V1") or cfg["mode"] not in ("GENERATE","SUBMITTED"):
        raise ValueError("VERSIONED_ROTATION_SEARCH_MODE")
    if cfg["profile_acknowledgment"]!=(producing_profiles.ACK if producing else profiles.SOIL_ACK):raise ValueError("EXPLICIT_FALLOW_AND_CALENDAR_ACKNOWLEDGMENT")
    options=cfg["year_options"]
    if not isinstance(options,list) or len(options)!=5 or any(not isinstance(a,list) or not a or len(a)!=len(set(a)) or set(a)-set(field["crop_candidates"]) for a in options):
        raise ValueError("FIVE_EXPLICIT_DISTINCT_YEAR_OPTION_SETS")
    counts=cfg["minimum_crop_slots"]
    if not isinstance(counts,dict) or set(counts)!=set(crops) or any(type(n) is not int or not 1<=n<=5 for n in counts.values()) or sum(counts.values())>5:
        raise ValueError("TWO_CROP_MINIMUM_SLOT_COUNTS")
    gaps=field.get("rotation_constraints",{}).get("minimum_return_gap_slots",{})
    required=((POTATO,3),(BEET,3),(producing_profiles.BARLEY,1)) if producing else ((POTATO,3),(BEET,3))
    if set(gaps)!=set(crops) or any(gaps[c]<n for c,n in required):
        raise ValueError("EXPLICIT_CONSERVATIVE_ROOT_RETURN_GAPS_REQUIRED")
    if set(field["history"])-set(producing_profiles.CROPS if producing else CROPS):raise ValueError("UNSUPPORTED_PRE_PERIOD_CROP_ID")
    o=g["objective"]
    if producing and set(options[0])-{POTATO,BEET}:raise ValueError("PRODUCTION_PROFILE_STARTS_WITH_ROOT_CROP")
    if o!={"version":producing_profiles.OBJECTIVE if producing else OBJECTIVE,"criterion":"pareto","target_years":YEARS,"acknowledgment":ACK}:
        raise ValueError("FULL_HORIZON_SEPARATE_CROP_SERVICE_VECTOR_REQUIRED")
    return cfg

def witness(seq,field,cfg):
    for i,c in enumerate(seq):
        if c not in cfg["year_options"][i]:
            return {"reason":"CROP_EXCLUDED_FROM_DECLARED_YEAR_OPTIONS","year":2016+i,"crop_use_id":c}
    counts=Counter(seq)
    for c,n in cfg["minimum_crop_slots"].items():
        if counts[c]<n:return {"reason":"DECLARED_MINIMUM_CROP_SLOTS","crop_use_id":c,"actual":counts[c],"minimum":n}
    history=field["history"];prior=list(history)
    gaps=field["rotation_constraints"]["minimum_return_gap_slots"]
    for i,c in enumerate(seq):
        for back,p in enumerate(reversed(prior),1):
            if c==FALLOW:break
            if p==c:
                if back-1<gaps[c]:
                    return {"reason":"DECLARED_CROP_RETURN_GAP","year":2016+i,"crop_use_id":c,
                        "preceding_crop_year":2016+i-back,"intervening_slots":back-1,"minimum":gaps[c],
                        "source":SOURCE,"scope":RULES_SCOPE}
                break
        prior.append(c)
    producing=cfg["version"]=="BOUNDED_THREE_CROP_PRODUCTION_SCREEN_V1"
    try:(producing_profiles if producing else profiles).seasons([(producing_profiles.CROPS if producing else CROPS)[c] for c in seq])
    except ValueError as error:return {"reason":str(error),"scope":"Only non-overlapping admitted root crop seasons and explicit bare fallow"}
    return None

def candidates(d,g,blocked):
    field=d["fields"][0];fid=field["field_id"];cfg=check_config(g,field)
    submitted=d["candidates"]
    if cfg["mode"]=="GENERATE":
        if submitted:raise blocked("DO_NOT_MIX_GENERATED_AND_SUBMITTED_ROTATIONS")
        enumerated=[list(x) for x in product(*[sorted(a) for a in cfg["year_options"]])]
        if len(enumerated)>243:raise blocked("ENUMERATION_DOMAIN_EXCEEDS_243")
        origin="BOUNDED_GENERATED"
    else:
        if d["search"]["max_generated"]!=0:raise blocked("SUBMITTED_MODE_REQUIRES_ZERO_GENERATION_BUDGET")
        if not submitted:raise blocked("EXPLICIT_ROTATION_CANDIDATES_REQUIRED")
        enumerated=[c["choices"][fid] for c in submitted];origin="USER_SUBMITTED"
    admitted=[];rejected=[]
    for seq in enumerated:
        choices={fid:seq};pid=digest(choices)[:20];why=witness(seq,field,cfg)
        if why:rejected.append({"policy_id":pid,"choices":choices,"stage":"SCREEN_REJECTED","witness":why})
        else:
            label=next((c.get("label") for c in submitted if c["choices"]==choices),None)
            admitted.append({"choices":choices,"label":label,"origin":origin})
    admitted.sort(key=lambda c:digest(c["choices"]))
    # No silent prefix sampling. A budget too small for the admitted domain abstains.
    count=len(admitted);b=d["search"]
    if count>b["max_candidates"] or count*len(d["scenarios"])>b["max_evaluations"] or (origin=="BOUNDED_GENERATED" and count>b["max_generated"]):
        raise blocked("BUDGET_CANNOT_COVER_ALL_ADMITTED_ROTATIONS_NO_PARTIAL_RANKING")
    if not admitted:raise blocked("NO_CALENDAR_AND_ROTATION_ADMISSIBLE_CANDIDATE")
    return admitted,rejected,{"version":cfg["version"],"mode":cfg["mode"],"enumerated":len(enumerated),
        "screen_rejected":len(rejected),"admitted":count,"source":SOURCE,"restriction_scope":("Root return gap >=3 intervening slots is source-illustrated; cereal gap >=1 is an explicit research diversity screen, not universal crop-family or plant-health clearance." if g["profile_id"]==producing_profiles.PROFILE else RULES_SCOPE),
        "history_scope":"Declared harvest-slot eligibility only. Pre-period biology is not simulated; initial native soil remains the explicit unmeasured profile.",
        "global_optimum":False,"exhaustive_only_within_declared_options_and_screen":True}

def metric(native,area):
    crops=producing_profiles.CROPS if (native.get("profile_derivation") or {}).get("id")==producing_profiles.PROFILE else PRODUCING_CROPS
    crop_dm={c:math.fsum(x["modeled_living_organ_DM_kg_ha"]["SO"] for x in native["crop_results"] if x["crop"]==name)*area for c,name in crops.items()}
    return {"crop_storage_DM_kg_field_by_crop":crop_dm,
        "bare_fallow_years":native["harvest_slot_crop_sequence"].count("bare_fallow"),
        "N_leaching_kg_N_field":native["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"]*area}

def rank(rows,policy_ids,scenario_ids,objective):
    crops=producing_profiles.CROPS if objective["version"]==producing_profiles.OBJECTIVE else PRODUCING_CROPS
    index={(r["policy_id"],r["scenario_id"]):r for r in rows}
    if len(index)!=len(rows) or set(index)!={(p,s) for p in policy_ids for s in scenario_ids}:
        return {"status":"ABSTAIN_INCOMPLETE_GROWTH_MATRIX","selected_ids":[],"global_optimum":False}
    feasible=[p for p in policy_ids if all(index[p,s]["growth_constraints_pass"] for s in scenario_ids)]
    if not feasible:return {"status":"ABSTAIN_NO_FEASIBLE_TESTED_GROWTH_PLAN","selected_ids":[],"global_optimum":False}
    # A component for EVERY matched scenario and crop, plus N loss. No component sum,
    # crop weighting, probability weighting, or cherry-picked annual window.
    vectors={p:tuple(v for s in scenario_ids for v in
        tuple(-R.q(index[p,s]["five_year_services"]["crop_storage_DM_kg_field_by_crop"][c],6) for c in sorted(crops))+
        (R.q(index[p,s]["five_year_services"]["N_leaching_kg_N_field"],6),)) for p in feasible}
    front=R.front(vectors)
    return {"status":"PARTIAL_COMPARISON_NO_OVERALL_VALUE_RANK","objective_version":objective["version"],
        "criterion":"pareto","selected_ids":[],"pareto_ids":front,"feasible_ids":feasible,
        "common_comparison_ids":policy_ids,"target_years":YEARS,"horizon_boundary":["2016-01-01","2020-12-31"],
        "terminal_boundary":"2020-12-31 start of day; 1826 integrated intervals",
        "field_recommendation":None,"global_optimum":False,"aggregate_value":None,
        "objectives":[{"policy_id":p,"scenarios":[{"scenario_id":s,**deepcopy(index[p,s]["five_year_services"])} for s in scenario_ids]} for p in feasible],
        "units":{"crop_service":"kg modeled living storage-organ DM per field, separately for each named cultivar over ALL five crop years",
            "N_loss":"kg N per field, bottom leaching over the continuous five-year modeled domain"},
        "comparison_excludes":"No overall crop value, marketable yield, profit, opportunity-cost valuation or soil-terminal asset value. No sum across unlike crop DM components.",
        "uncertainty":"Scenario-wise Pareto dominance on all paired N/rain cases; no calibrated probabilities.",
        "numerical_quantization":"0.000001 kg per component; not predictive precision",
        "search_scope":"ONLY_DECLARED_OPTIONS_SCREEN_AND_MATCHED_COMPLETE_SCENARIOS"}


def calendar_evidence(native,sequence):
    calendar={s["harvest_date"][:4]:s for s in native["original_calendar"]["seasons"]}
    transitions={t["day"]:t["before"] for t in native["continuity"]["transitions"] if t["event"]=="CROP_START"}
    rows={}
    for i,c in enumerate(sequence):
        year=str(2016+i);season=calendar.get(year)
        rows[year]={"harvest_slot_crop_use_id":c,
            "preceding_harvest_slot_crop_use_id":sequence[i-1] if i else None,
            "pre_horizon_history_scope":"Not simulated; separate history entries affect eligibility only",
            "sowing_date":season["sowing_date"] if season else None,
            "declared_harvest_date":season["harvest_date"] if season else None,
            "native_soil_at_sowing":transitions[season["sowing_date"]] if season else None}
    return rows
