"""Complete, explicitly synthetic farm assumptions cannot become modeled yield."""
from copy import deepcopy
from decimal import Decimal
import unittest
from brain.baseline import ROOT
from brain.service import ClientDecisionService,validate
from brain import growth_rotation as rot,growth_scenario_economics as econ
from common import read,digest
from contract import normalize

def request():return read(ROOT/"examples/engine/growth_rotation.json")
def supplied():
    p=request();d=deepcopy(p["engine_request"]);d.pop("extensions");d=normalize(d)
    candidates=rot.candidates(d,p["growth_decision"],ValueError)[0]
    rows=[]
    for c in candidates:
        for s in d["scenarios"]:
            for i,crop in enumerate(c["choices"]["F1"]):
                rows.append({"policy_id":digest(c["choices"])[:20],"scenario_id":s["scenario_id"],"field_id":"F1","source_year":2016+i,
                    "yield_t_ha":0 if crop==rot.FALLOW else 10,"price_per_t":0 if crop==rot.FALLOW else 100,"cost_per_ha":200})
    p["economics"]={"currency":"EUR","basis":"FARM_SUPPLIED_ASSUMPTION_UNVERIFIED","source_id":"UNIT_TEST_SYNTHETIC_NOT_FIELD",
        "available_at":"2026-11-14T01:09:46+00:00","uncertainty":"Synthetic arithmetic test ONLY; not prices, measured yields, cost estimates or commercial evidence. Explicit aggregate direct cost includes no inferred extras.","rows":rows}
    return p

class ScenarioEconomicTests(unittest.TestCase):
    def test_complete_coverage_null_and_missing_inputs(self):
        p=supplied();self.assertEqual(len(validate(p)[1]),60)
        p["economics"]["rows"].pop()
        with self.assertRaisesRegex(ValueError,"ALL_CANDIDATES_SCENARIOS_FIELDS_AND_FIVE_YEARS"):validate(p)
        p=request();self.assertEqual(validate(p)[1],{})
    def test_fallow_revenue_currency_duplicate_and_nonfinite_rejected(self):
        for kind in ("fallow","currency","duplicate","nonfinite"):
            p=supplied()
            if kind=="fallow":
                rows=p["economics"]["rows"];next(r for r in rows if r["yield_t_ha"]==0)["yield_t_ha"]=1
            elif kind=="currency":p["economics"]["currency"]="USD"
            elif kind=="duplicate":p["economics"]["rows"].append(deepcopy(p["economics"]["rows"][0]))
            else:p["economics"]["rows"][0]["price_per_t"]=float("inf")
            with self.assertRaises(ValueError):validate(p)
    def test_real_primary_decision_and_model_yield_unchanged(self):
        client=ClientDecisionService();base=client.run(request());p=supplied();r=client.run(p)
        self.assertEqual(base["decision"],r["decision"])
        e=r["growth_evaluation"]["scenario_economics"]
        self.assertEqual(e["status"],"ASSUMPTION_BASED_SCENARIO_ONLY");self.assertFalse(e["ranking_affected"])
        self.assertIsNone(e["economic_rank"]);self.assertIsNone(e["net_profit"]);self.assertIsNone(e["model_yield_conversion"])
        for x in e["totals"]:
            rows=next(s["field_years"] for a in r["alternatives"] if a["policy_id"]==x["policy_id"] for s in a["scenarios"] if s["scenario_id"]==x["scenario_id"])
            self.assertEqual(sum((Decimal(z["economics"]["conditional_margin"]) for z in rows),Decimal(0)),Decimal(x["five_year_assumed_operating_margin"]))
        for row in r["report_dto"]["five_year_rows"]:
            self.assertIsNone(row["predicted_yield"]);self.assertFalse(row["economics"]["yield_is_model_predicted"])
        p["economics"]["rows"][0]["cost_per_ha"]=999999
        self.assertEqual(client.run(p)["decision"],base["decision"])
        self.assertEqual(r["growth_evaluation"]["economics_link"]["status"],"EVIDENCE_BLOCKED_PROCESS_YIELD_CONVERSION_MISSING")
if __name__=="__main__":unittest.main()
