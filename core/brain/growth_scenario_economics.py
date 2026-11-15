"""Explicit whole-matrix farm assumptions, independent of simulated crop yield."""
from copy import deepcopy
from decimal import Decimal
from . import economics,growth_rotation

def validate(spec,d,g):
    if spec is None:return {}
    view=deepcopy(d)
    view["candidates"]=growth_rotation.candidates(view,g,ValueError)[0]
    index=economics.validate(spec,view)
    if spec["currency"]!="EUR":raise ValueError("ROTATION_SCENARIO_SINGLE_EUR_CURRENCY_NO_FX_CONVERSION")
    required=len(view["candidates"])*len(view["scenarios"])*len(view["fields"])*5
    if len(index)!=required:raise ValueError("ROTATION_ECONOMICS_REQUIRES_ALL_CANDIDATES_SCENARIOS_FIELDS_AND_FIVE_YEARS")
    choices={__import__("common").digest(c["choices"])[:20]:c["choices"] for c in view["candidates"]}
    for (pid,sid,fid,year),row in index.items():
        if choices[pid][fid][year-2016]==growth_rotation.FALLOW and (row["yield_t_ha"]!=0 or row["price_per_t"]!=0):
            raise ValueError("BARE_FALLOW_HAS_NO_MARKETABLE_CROP_OR_CROP_REVENUE")
    return index

def project(spec,alternatives):
    totals=[]
    for candidate in alternatives:
        for scenario in candidate["scenarios"]:
            rows=scenario["field_years"]
            if len(rows)!=5 or any(x["economics"].get("conditional_margin") is None for x in rows):
                raise ValueError("INCOMPLETE_INDEPENDENT_ECONOMIC_SCENARIO_NO_TOTAL")
            totals.append({"policy_id":candidate["policy_id"],"scenario_id":scenario["scenario_id"],
                "five_year_assumed_operating_margin":str(sum((Decimal(x["economics"]["conditional_margin"]) for x in rows),Decimal(0)))})
    return {"schema":"astragron.rotation-assumption-economics.v1","status":"ASSUMPTION_BASED_SCENARIO_ONLY",
        "currency":spec["currency"],"source_id":spec["source_id"],"available_at":spec["available_at"],
        "uncertainty":spec["uncertainty"],"horizon_source_years":[2016,2017,2018,2019,2020],
        "totals":totals,"ranking_affected":False,"economic_rank":None,"net_profit":None,
        "model_yield_conversion":None,"assumed_yield_is_model_predicted":False,
        "formula":"Sum over ALL fields and years of area_ha * (explicit assumed yield_t_ha * price_per_t - cost_per_ha)",
        "scope":"Unverified farmer-supplied marketable-yield/price/direct-cost scenario; no growth-model conversion, commercial validation, net-profit claim or endorsement of physical feasibility.",
        "valuation_time_basis":"Undiscounted supplied source-year nominal EUR amounts; no inflation, financing, discounting or NPV estimate.",
        "cost_scope":"Only explicit aggregate cost_per_ha. No undisclosed water, fertilizer, labour, finance or overhead defaults."}
