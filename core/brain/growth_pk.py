"""Reuse sealed elemental contracts and atomic transfers for P/K only.

Native SNOMIN owns nitrogen. P/K are declared inventories and transfers, never
plant availability or predicted physiological removal. No N ledger is joined.
"""
from copy import deepcopy
from decimal import Decimal,ROUND_HALF_EVEN
from .baseline import ROOT
from . import growth_profiles
from common import digest
from soil_memory.contracts import validate as validate_extension,ELEMENT,dec
from soil_memory.state_adapter import initial_state,step,event,amount,KG,AccountingBlocked

PK=("P","K")
def admission(ext,d):
    # Bare fallow is absence of a crop, not an invented crop budget. Validate the
    # unchanged sealed extension against producing crops; field/soil/scenario
    # scope and every quantity/source hash remain the actual submitted values.
    gate_view=deepcopy(d)
    for field in gate_view["fields"]:
        field["crop_candidates"]=[c for c in field["crop_candidates"] if c!="research:bare_fallow"]
    gate=validate_extension(ext,gate_view)
    if gate["status"]!="READY_CONDITIONAL_ELEMENT_BUDGET":
        return gate["gaps"]
    if "research:bare_fallow" in ext["crop_budgets"]:
        return [{"path":"extensions.soil_memory.crop_budgets","reason":"BARE_FALLOW_HAS_NO_CROP_BUDGET","action":"Remove the no-crop budget; fallow advances inventories with no crop transfers."}]
    if ext["management_events"]:
        return [{"path":"extensions.soil_memory.management_events","reason":"PK_MANAGEMENT_NOT_ADMITTED_IN_GROWTH_BRIDGE_V1","action":"Use the unchanged legacy accounting path or a separately qualified P/K event adapter."}]
    if any(p not in ("P_INVENTORY","K_INVENTORY") for p in (ext.get("constraint") or {}).get("minimum_terminal",{})):
        return [{"path":"extensions.soil_memory.constraint","reason":"NATIVE_SNOMIN_OWNS_N_CONSTRAINTS","action":"Use the explicit native N-leaching research constraint; legacy N inventory is not process N."}]
    for budget in ext["crop_budgets"].values():
        if any(dec(budget["uptake"][p]["uncertainty"][b])!=0 for p in ("NO3_N","NH4_N") for b in ("low","high")):
            return [{"path":"extensions.soil_memory.crop_budgets","reason":"LEGACY_N_WITHDRAWAL_MUST_BE_DISABLED_FOR_NATIVE_N","action":"Set auxiliary N withdrawals explicitly to zero as unused placeholders; native modeled uptake is reported separately."}]
    return []

def pools(state):
    return {p:KG(sum(z[p] for z in state["stocks_micro_kg_element_per_ha"].values()))
            for p,e in ELEMENT.items() if e in PK}
def total(state,element):
    return sum(v for z in state["stocks_micro_kg_element_per_ha"].values() for p,v in z.items() if ELEMENT[p]==element)

def evaluate(ext,d,pid,scenario,choices,native):
    field=d["fields"][0];fid=field["field_id"];cases=[]
    for bound in ext["uncertainty_scenarios"]:
        state=initial_state(field,ext["initial_states"][scenario["scenario_id"]][fid],ext,scenario,bound)
        years=[];violations=[];status="ASSUMPTION_CONDITIONAL_COMPLETE"
        for crop_row in (growth_profiles.annual_results(native) if "bare_fallow" in native.get("harvest_slot_crop_sequence",[]) else native["crop_results"]):
            year=crop_row["original_weather_year"];crop_id=choices[fid][year-2016]
            budget=ext["crop_budgets"].get(crop_id);before=state
            day=crop_row["termination_date"] or str(year)+"-12-31";events=[]
            for element in (PK if budget is not None else ()):
                pool=element+"_INVENTORY";q=budget["uptake"][pool];u=amount(q,bound)
                frac=Decimal(amount(budget["export_fraction"][element],bound))/Decimal(1000000)
                exported=int((Decimal(u)*frac).to_integral_value(rounding=ROUND_HALF_EVEN))
                anchor=f"{pid}:{scenario['scenario_id']}:{bound}:{year}:{element}"
                for suffix,a,b,n,order in (("withdraw",pool,"CROP_"+element,u,1),("export","CROP_"+element,"EXTERNAL",exported,2),("retain","CROP_"+element,"RESIDUE_"+element,u-exported,3)):
                    events.append(event(anchor+":"+suffix,day,fid,budget["layer_id"],a,b,
                        "DECLARED_PK_BUDGET",n,q["source_id"],ext["parameter_id"],order=order,
                        quantity_scope="Declared elemental transfer, not predicted uptake or biological residue return"))
            water_ref={"date":day,"field_id":fid,"native_forcing_id":native["actual_forcing_sha256"],
                "weather_evidence_id":native["actual_forcing_sha256"],
                "transition_evidence_id":digest({"date":day,"native_case":native["pcse_run"]["run_id"]}),
                "allocation_evidence_id":"RAIN_FED_NO_WITHDRAWAL"}
            try:state,ledger=step(state,water_ref,{"crop_id":crop_id,"scope":"NATIVE_MODEL_TERMINATION_DATE"},sorted(events,key=lambda x:x["order"]),ext)
            except AccountingBlocked as error:
                violations.append({"date":day,"reason":str(error),"field_id":fid});status="DECLARED_BUDGET_INFEASIBLE";break
            balance={}
            for e in PK:
                f=ledger["fluxes"][e]
                residual=total(before,e)+f["external_inputs_micro"]-f["external_outputs_micro"]-total(state,e)
                if residual:raise AccountingBlocked("PK_ELEMENT_BALANCE_FAILURE")
                balance[e]={"unit":"kg "+e+"/ha","initial_total":KG(total(before,e)),
                    "external_inputs":KG(f["external_inputs_micro"]),"external_outputs":KG(f["external_outputs_micro"]),
                    "ending_total":KG(total(state,e)),"mass_residual":"0"}
            years.append({"field_id":fid,"source_year":year,"policy_id":pid,"scenario_id":scenario["scenario_id"],
                "uncertainty_scenario":bound,"control":False,"start_state_id":before["state_id"],"end_state_id":state["state_id"],
                "start_pools_kg_element_per_ha":pools(before),"end_pools_kg_element_per_ha":pools(state),
                "balance":balance,"last_date":day,"complete_crop_budget_year":budget is not None,"complete_inventory_year":True,
                "N_accounting_scope":"Native SNOMIN only; auxiliary N pools are not emitted or joined."})
        constraint=ext.get("constraint") or {}
        if status=="ASSUMPTION_CONDITIONAL_COMPLETE" and constraint.get("enabled"):
            for pool,q in constraint["minimum_terminal"].items():
                remaining=sum(z[pool] for z in state["stocks_micro_kg_element_per_ha"].values())
                if remaining<amount(q,bound):
                    violations.append({"date":"2020-12-31","pool":pool,"remaining":KG(remaining),
                        "minimum":KG(amount(q,bound)),"unit":q["unit"],"reason":"DECLARED_TERMINAL_PK_CONSTRAINT"})
        cases.append({"policy_id":pid,"scenario_id":scenario["scenario_id"],"uncertainty_scenario":bound,
            "control":False,"status":status,"annual":years,"first_violation":violations[0] if violations else None,
            "constraint_violations":violations,"passes_declared_soil_constraints":not violations,
            "soil_resets":0,"scope":"P_K_DECLARED_INVENTORY_ONLY","field_validated":False})
    return cases
