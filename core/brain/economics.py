"""Farm-supplied scenario arithmetic, never a water-derived yield prediction."""
from datetime import datetime
from decimal import Decimal
import math
import re

def validate(value, engine):
    if value is None:
        return {}
    required = {"currency","basis","source_id","available_at","uncertainty","rows"}
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("EXPLICIT_ECONOMIC_SOURCE_AND_ROWS_REQUIRED")
    if value["basis"] != "FARM_SUPPLIED_ASSUMPTION_UNVERIFIED":
        raise ValueError("CALLER_CANNOT_QUALIFY_ECONOMICS")
    if not isinstance(value["currency"], str) or not re.fullmatch("[A-Z]{3}", value["currency"]):
        raise ValueError("ECONOMIC_CURRENCY_REQUIRED")
    for k, limit in (("source_id",120),("uncertainty",2000)):
        if not isinstance(value[k],str) or not 0 < len(value[k]) <= limit:
            raise ValueError("ECONOMIC_SOURCE_UNCERTAINTY_REQUIRED")
    at = datetime.fromisoformat(value["available_at"].replace("Z","+00:00"))
    cutoff = datetime.fromisoformat(engine["as_of"].replace("Z","+00:00"))
    if at.tzinfo is None or at > cutoff:
        raise ValueError("ECONOMICS_DATE_OUTSIDE_REQUEST_CUTOFF")
    rows = value["rows"]
    if not isinstance(rows,list) or len(rows)>4320:
        raise ValueError("ECONOMIC_ROW_LIMIT")
    allowed = { (p,s["scenario_id"],f["field_id"],y)
                for p in [__import__("common").digest(c["choices"])[:20] for c in engine.get("candidates",[])]
                for s in engine["scenarios"] for f in engine["fields"]
                for y in range(int(s["start"][:4]),int(s["end"][:4])+1) }
    index = {}
    keys = {"policy_id","scenario_id","field_id","source_year","yield_t_ha","price_per_t","cost_per_ha"}
    for row in rows:
        if not isinstance(row,dict) or set(row)!=keys or type(row["source_year"]) is not int:
            raise ValueError("ECONOMIC_EXACT_ROW_KEYS")
        key = tuple(row[k] for k in ("policy_id","scenario_id","field_id","source_year"))
        if key not in allowed or key in index:
            raise ValueError("ECONOMIC_SCOPE_OR_DUPLICATE")
        for k, upper in (("yield_t_ha",1000),("price_per_t",1e9),("cost_per_ha",1e9)):
            v = row[k]
            if type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=upper:
                raise ValueError("FINITE_NONNEGATIVE_ECONOMIC_INPUT:"+k)
        index[key]=row
    return index

def project(spec, index, row):
    key = tuple(row[k] for k in ("policy_id","scenario_id","field_id","source_year"))
    supplied = index.get(key)
    if supplied is None:
        return {"status":"UNAVAILABLE_MISSING_FARM_INPUTS","currency":None if spec is None else spec["currency"],
                "assumed_yield_t_ha":None,"conditional_margin":None,
                "missing":["Farm-supplied yield_t_ha, price_per_t and cost_per_ha for this exact policy/scenario/field/year"]}
    margin = Decimal(str(row["area_ha"])) * (Decimal(str(supplied["yield_t_ha"])) *
             Decimal(str(supplied["price_per_t"])) - Decimal(str(supplied["cost_per_ha"])))
    return {"status":"FARM_SUPPLIED_ASSUMPTION_UNVERIFIED","currency":spec["currency"],
            "assumed_yield_t_ha":supplied["yield_t_ha"],"conditional_margin":str(margin),
            "source_id":spec["source_id"],"available_at":spec["available_at"],
            "uncertainty":spec["uncertainty"],"inputs":supplied,"ranking_affected":False,
            "yield_is_model_predicted":False}
