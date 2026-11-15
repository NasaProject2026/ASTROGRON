"""Engine-owner acceptance: fresh actual runs, no presentation-derived science."""
from copy import deepcopy
from decimal import Decimal
import json
import math
import unittest
from unittest.mock import patch
from brain.baseline import ROOT, RELEASE, CORE, verify
from brain.service import ClientDecisionService, validate
from brain import economics, nutrient_response
from common import parse, digest, read
import power_source
import jsonschema

def example(name="supported_soil"):
    return read(ROOT/"examples/engine"/(name+".json"))

class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.p=example()
    def bad(self,mutate):
        mutate(self.p)
        with self.assertRaises((ValueError,TypeError,KeyError)):
            validate(self.p)
    def test_unknown_envelope(self):
        self.bad(lambda p:p.update(secret="x"))
    def test_nan_coordinate(self):
        self.bad(lambda p:p["engine_request"]["location"].update(point_lon_lat=[float("nan"),0]))
    def test_coordinate_range(self):
        self.bad(lambda p:p["engine_request"]["location"].update(point_lon_lat=[181,0]))
    def test_boolean_coordinate(self):
        self.bad(lambda p:p["engine_request"]["location"].update(point_lon_lat=[True,0]))
    def test_explicit_flags(self):
        self.bad(lambda p:p["features"].update(nutrient_response=1))
    def test_feature_extension_mismatch(self):
        self.bad(lambda p:p["features"].update(soil_memory=False))
    def test_duplicate_field(self):
        self.bad(lambda p:p["engine_request"]["fields"].append(deepcopy(p["engine_request"]["fields"][0])))
    def test_non_five_year_scenario(self):
        self.bad(lambda p:p["engine_request"]["scenarios"][0].update(end="2021-12-31"))
    def test_duplicate_json_keys(self):
        with self.assertRaises(ValueError):parse('{"x":1,"x":2}')
    def test_output_scope(self):
        with self.assertRaises(ValueError):ClientDecisionService(ROOT/"outside-runtime")
    def test_explicit_horizon_required(self):
        self.bad(lambda p:p["engine_request"].pop("horizon_years"))
    def test_cross_worktree_output_rejected(self):
        with self.assertRaises(ValueError):
            ClientDecisionService(ROOT.parent/"ASTROGRON_B_EVIDENCE/runtime/agent-b")
    def test_b_local_runtime_is_supported_without_writing_it(self):
        from pathlib import Path
        with patch.object(Path,"mkdir"):
            service=ClientDecisionService(ROOT/"runtime/agent-b")
        self.assertEqual(service.runtime,(ROOT/"runtime/agent-b").resolve())
    def test_source_hash_tamper(self):
        raw,receipt=power_source.load(147.35,-35.05,"2011-01-01","2025-12-31")
        content=(CORE/"source_cache"/(receipt["sha256"]+".raw.json")).read_bytes()
        with self.assertRaises(power_source.Unavailable):
            power_source.verify(receipt,content+b" ",147.35,-35.05,"2011-01-01","2025-12-31")
    def test_receipt_scope_tamper(self):
        _,receipt=power_source.load(147.35,-35.05,"2011-01-01","2025-12-31")
        content=(CORE/"source_cache"/(receipt["sha256"]+".raw.json")).read_bytes()
        with self.assertRaises(power_source.Unavailable):
            power_source.verify(receipt,content,147.36,-35.05,"2011-01-01","2025-12-31")
    def test_baseline_lock_tamper(self):
        from brain import baseline
        original=baseline.sha
        with patch.object(baseline,"sha",side_effect=lambda p:"0"*64 if str(p).endswith("soil_service.py") else original(p)):
            with self.assertRaisesRegex(ValueError,"PROTECTED_BASELINE_INTEGRITY"):verify()
    def test_economics_missing_is_null(self):
        row={"policy_id":"p","scenario_id":"s","field_id":"F1","source_year":2016,"area_ha":4}
        self.assertIsNone(economics.project(None,{},row)["conditional_margin"])
    def test_explicit_economics_recomputable(self):
        d=self.p["engine_request"]
        key=(digest(d["candidates"][0]["choices"])[:20],d["scenarios"][0]["scenario_id"],"F1",2016)
        row=dict(zip(("policy_id","scenario_id","field_id","source_year"),key))
        spec={"currency":"EUR","basis":"FARM_SUPPLIED_ASSUMPTION_UNVERIFIED","source_id":"operator",
              "available_at":d["as_of"],"uncertainty":"Hypothetical arithmetic control, not a farm observation",
              "rows":[dict(row,yield_t_ha=3,price_per_t=200,cost_per_ha=400)]}
        index=economics.validate(spec,d)
        result=economics.project(spec,index,dict(row,area_ha=4))
        self.assertEqual(Decimal(result["conditional_margin"]),Decimal(800))
        self.assertFalse(result["yield_is_model_predicted"])
    def test_economics_negative_or_nonfinite_rejected(self):
        d=self.p["engine_request"]
        key=(digest(d["candidates"][0]["choices"])[:20],d["scenarios"][0]["scenario_id"],"F1",2016)
        row=dict(zip(("policy_id","scenario_id","field_id","source_year"),key),yield_t_ha=-1,price_per_t=200,cost_per_ha=400)
        spec={"currency":"EUR","basis":"FARM_SUPPLIED_ASSUMPTION_UNVERIFIED","source_id":"operator",
              "available_at":d["as_of"],"uncertainty":"Control","rows":[row]}
        with self.assertRaises(ValueError):economics.validate(spec,d)
    def test_no_provider_self_qualification(self):
        r=nutrient_response.evaluate(True)
        self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
        self.assertIsNone(r["yield"])
        self.assertFalse(r["ranking_affected"])

class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p=example()
        cls.service=ClientDecisionService(ROOT/"runtime/agent-a/engine-acceptance")
        cls.base=cls.service.run(cls.p)
        rain=deepcopy(cls.p)
        for scenario in rain["engine_request"]["scenarios"]:scenario["rain_factor"]=0
        cls.rain=cls.service.run(rain)
        missing=example("missing_evidence")
        cls.missing=cls.service.run(missing)
        source=deepcopy(cls.p);source["engine_request"]["source"]["enabled"]=False
        cls.ablated=cls.service.run(source)
        water=example("water_only")
        cls.water=cls.service.run(water)
        enabled=deepcopy(water);enabled["features"]["nutrient_response"]=True
        cls.response_blocked=cls.service.run(enabled,use_cache=True)
        output=ROOT/"runtime/agent-a/engine-acceptance"
        for name,result in (("valid",cls.base),("rain_zero",cls.rain),("blocked",cls.missing),
                            ("source_ablated",cls.ablated),("water_only",cls.water),("response_blocked",cls.response_blocked)):
            (output/(name+".response.json")).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    def test_schema_request_and_actual_responses(self):
        req=read(ROOT/"contracts/client_decision_request_v1.schema.json")
        res=read(ROOT/"contracts/client_decision_response_v1.schema.json")
        jsonschema.validate(self.p,req)
        for r in (self.base,self.rain,self.missing,self.ablated,self.water,self.response_blocked):
            jsonschema.validate(r,res)
    def test_five_original_years_per_field_per_alternative(self):
        self.assertEqual(self.base["status"],"CONDITIONAL_RESEARCH_COMPLETE")
        self.assertEqual(len(self.base["alternatives"]),2)
        for alternative in self.base["alternatives"]:
            for scenario in alternative["scenarios"]:
                rows=scenario["field_years"]
                self.assertEqual([r["source_year"] for r in rows],list(range(2016,2021)))
                self.assertTrue(all(r["water_start_state"] is not None and r["water_end_state"] is not None for r in rows))
                self.assertTrue(all(r["predicted_yield"] is None for r in rows))
    def test_precipitation_changes_physics(self):
        before={c["policy_id"]:c["ET_shortfall_m3_equivalent"] for c in self.base["engine_result"]["cases"]}
        after={c["policy_id"]:c["ET_shortfall_m3_equivalent"] for c in self.rain["engine_result"]["cases"]}
        self.assertEqual(set(before),set(after))
        self.assertTrue(all(after[p]>before[p]+1 for p in before))
        self.assertNotEqual(self.base["run_id"],self.rain["run_id"])
    def test_source_ablation_is_blocked_not_zero_rain(self):
        self.assertEqual(self.ablated["status"],"EVIDENCE_BLOCKED")
        self.assertEqual(self.ablated["engine_result"]["status"],"SOURCE_ABLATED")
        self.assertEqual(self.ablated["alternatives"],[])
        self.assertEqual(self.rain["status"],"CONDITIONAL_RESEARCH_COMPLETE")
    def test_past_crop_changes_next_year_inventory(self):
        soil=self.base["engine_result"]["soil_memory"]
        cases=[c for c in soil["cases"] if not c["control"] and c["uncertainty_scenario"]=="POINT"]
        a,b=cases
        first_a=a["annual"][0];first_b=b["annual"][0]
        self.assertNotEqual(first_a["end_pools_kg_element_per_ha"],first_b["end_pools_kg_element_per_ha"])
        self.assertEqual(a["annual"][1]["start_state_id"],first_a["end_state_id"])
        self.assertEqual(b["annual"][1]["start_state_id"],first_b["end_state_id"])
        self.assertNotEqual(a["annual"][1]["start_pools_kg_element_per_ha"],b["annual"][1]["start_pools_kg_element_per_ha"])
    def test_annual_mass_balances_independent_decimal_recalculation(self):
        count=0
        for case in self.base["engine_result"]["soil_memory"]["cases"]:
            for year in case["annual"]:
                for balance in year["balance"].values():
                    self.assertEqual(Decimal(balance["initial_total"])+Decimal(balance["external_inputs"])-Decimal(balance["external_outputs"]),Decimal(balance["ending_total"]))
                    self.assertEqual(Decimal(balance["mass_residual"]),0)
                    count+=1
        self.assertEqual(count,105)
    def test_water_year_seams_never_reset(self):
        for case in self.base["engine_result"]["cases"]:
            self.assertEqual(case["soil_reset_count"],0)
            years=sorted(case["year_start_states_mm"])
            for a,b in zip(years,years[1:]):
                self.assertEqual(case["year_end_states_mm"][a],case["year_start_states_mm"][b])
    def test_no_response_preserves_water_rankings(self):
        self.assertEqual(self.water["decision"],self.water["engine_result"]["research_decision"])
        self.assertEqual(self.water["nutrient_response"]["status"],"DISABLED")
        self.assertFalse(self.water["nutrient_response"]["ranking_affected"])
        self.assertEqual(self.response_blocked["engine_result"]["research_decision"],self.water["engine_result"]["research_decision"])
        self.assertEqual(self.response_blocked["decision"]["selected_ids"],[])
    def test_missing_local_evidence_returns_specific_gaps(self):
        self.assertEqual(self.missing["status"],"EVIDENCE_BLOCKED")
        self.assertTrue(self.missing["qualification"]["climate_ready"])
        self.assertFalse(self.missing["qualification"]["field_agronomy_qualified"])
        self.assertTrue(self.missing["missing_requirements"])
        self.assertEqual(self.missing["decision"]["selected_ids"],[])
    def test_report_dto_is_exact_scientific_projection(self):
        rows=[r for a in self.base["alternatives"] for s in a["scenarios"] for r in s["field_years"]]
        self.assertEqual(rows,self.base["report_dto"]["five_year_rows"])
        self.assertTrue(all(r["economics"]["conditional_margin"] is None for r in rows))
    def test_finite_alternatives_have_actual_baseline_deltas(self):
        for alternative in self.base["alternatives"]:
            self.assertFalse(alternative["global_optimum"])
            self.assertTrue(alternative["decision_reversal_conditions"])
            for comparison in alternative["baseline_comparison"]:
                self.assertIsNotNone(comparison["ET_shortfall_delta_m3"])
    def test_synthetic_no_action_control_is_not_biology(self):
        controls=[x for x in self.base["engine_result"]["soil_memory"]["cases"] if x["control"]]
        self.assertEqual(len(controls),1)
        self.assertFalse(controls[0]["field_validated"])
        for year in controls[0]["annual"]:
            self.assertEqual(year["start_pools_kg_element_per_ha"],year["end_pools_kg_element_per_ha"])
    def test_protected_source_after_pipeline(self):
        self.assertEqual(verify()["files_verified"],301)

class PartialRunTests(unittest.TestCase):
    def test_partial_soil_abstains_primary_ranking(self):
        from soil_memory.contracts import seal
        p=example()
        p["engine_request"]["extensions"]["soil_memory"]["max_daily_steps"]=1
        seal(p["engine_request"]["extensions"]["soil_memory"])
        result=ClientDecisionService(ROOT/"runtime/agent-a/partial-soil").run(p)
        self.assertEqual(result["status"],"BOUNDED_PARTIAL")
        self.assertEqual(result["decision"]["selected_ids"],[])
        self.assertEqual(result["decision"]["status"],"ABSTAIN_INCOMPLETE_COMPARISON")
        self.assertIsNotNone(result["decision"]["water_only_diagnostic"])
        self.assertEqual(result["engine_result"]["soil_memory"]["status"],"SOIL_MEMORY_BOUNDED_PARTIAL")
    def test_partial_water_abstains_primary_ranking(self):
        p=example("water_only")
        p["engine_request"]["search"].update(max_candidates=2,max_evaluations=1,max_generated=0)
        result=ClientDecisionService(ROOT/"runtime/agent-a/partial-water").run(p)
        self.assertEqual(result["status"],"BOUNDED_PARTIAL")
        self.assertEqual(result["decision"]["selected_ids"],[])
        self.assertEqual(result["decision"]["status"],"ABSTAIN_INCOMPLETE_COMPARISON")


class TransportTests(unittest.TestCase):
    def test_bom_is_not_arabic(self):
        from brain.transport import contains_arabic
        from english_surface import ARABIC
        self.assertFalse(contains_arabic("\ufefffield,value\nF1,1\n",ARABIC))
        self.assertTrue(contains_arabic("\ufeff\u0627",ARABIC))
        self.assertTrue(contains_arabic("x\ufeff",ARABIC))
    def test_http_csv_preserves_bom_and_rejects_arabic(self):
        import threading,urllib.request,urllib.error
        from brain.transport import create_server
        class Stub:
            value="\ufefffield,value\nF1,1\n"
            def export(self,*args):return self.value
        stub=Stub()
        server=create_server(0,ROOT/"runtime/agent-a/transport-test")
        server.application=stub
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url="http://127.0.0.1:"+str(server.server_port)+"/api/v1/research-decision/results/"+"0"*64+".csv"
        try:
            with urllib.request.urlopen(url,timeout=10) as response:
                self.assertEqual(response.status,200)
                self.assertEqual(response.read(),stub.value.encode("utf-8"))
            stub.value="\ufeff\u0627"
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url,timeout=10)
            self.assertEqual(error.exception.code,409)
            error.exception.close()
        finally:
            server.shutdown();server.server_close();thread.join(10)

if __name__=="__main__":
    unittest.main()
