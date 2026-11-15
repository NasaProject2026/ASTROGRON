"""Qualification controls for the opt-in producing profile; no field validation."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import gzip,hashlib,json,math,unittest
from unittest.mock import patch
import jsonschema
from brain.baseline import ROOT,verify
from brain.service import ClientDecisionService
from brain import producing_profiles as prod,growth_rotation as rot,root_depth_adapter as root,producing_worker,growth_decision as bridge
from common import read,digest
from brain.runtime_paths import repository_path
from soil_memory.contracts import seal

def request():return read(ROOT/"examples/engine/growth_producing.json")
class Soil:
    def get_max_rootable_depth(self):return 120
    def validate_max_rooting_depth(self,d):
        if d not in (25,40,60,120):raise ValueError("BOUNDARY")
class RootTests(unittest.TestCase):
    def test_native_root_limit_without_parameter_mutation(self):
        for crop,expected in ((60,60),(120,120),(125,120)):
            p={"RDI":10,"RDMCR":crop,"RDMSOL":120};before=deepcopy(p)
            self.assertEqual(root.effective_depth(p,Soil()),expected);self.assertEqual(p,before)
    def test_incompatible_or_nonfinite_depth_stays_blocked(self):
        for value in (75,float("nan"),float("inf"),-1):
            with self.assertRaises(ValueError):root.effective_depth({"RDI":10,"RDMCR":value,"RDMSOL":120},Soil())
    def test_immutable_barley_source_and_schema(self):
        self.assertEqual(hashlib.sha256((ROOT/prod.SOURCE_FILE).read_bytes()).hexdigest(),prod.SOURCE_SHA)
        jsonschema.validate(request()["growth_decision"],read(ROOT/"contracts/growth_producing_request_v1.schema.json"))
        self.assertEqual(verify()["files_verified"],301)
    def test_actual_root_negative_control_and_wheat_failure_after_repair(self):
        cases=read(ROOT/"tests/engine/fixtures/producing/qualification.json")["negative_controls"]
        self.assertIn("125.000000",cases[0]["error"]);self.assertEqual(cases[0]["status"],"EVIDENCE_BLOCKED")
        self.assertIn("Negative crop nitrogen stock",cases[1]["error"]);self.assertTrue(cases[1]["overdraw_events"])
    def test_two_complete_native_wheat_traces_explain_N_overdraw(self):
        proof=read(ROOT/"tests/engine/fixtures/producing/qualification.json")
        self.assertEqual(len(proof["diagnoses"]),2)
        for case in proof["diagnoses"]:
            x=case["first_failing_transition"]
            value=x["leaf_N_before_kg_ha"]+x["leaf_N_uptake_kg_ha_day"]-x["leaf_N_translocation_kg_ha_day"]-x["leaf_N_death_kg_ha_day"]
            self.assertAlmostEqual(value,x["native_leaf_N_after"],delta=1e-15)
            self.assertLess(value,-1e-6)
            self.assertEqual(hashlib.sha256(gzip.decompress(repository_path(case["trace_file"]).read_bytes())).hexdigest(),case["trace_sha256"])

class ProducingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/"runtime/agent-a/overnight/phase1").mkdir(parents=True,exist_ok=True)
        (ROOT/"runtime/agent-a/producing-rotation").mkdir(parents=True,exist_ok=True)
        cls.client=ClientDecisionService();cls.base=cls.client.run(request())
        if cls.base["status"]!="CONDITIONAL_RESEARCH_COMPLETE":raise AssertionError(cls.base["missing_requirements"])
        registry=cls.base["engine_result"]["candidate_registry"]
        cls.first={pid:c["choices"]["F1"][0] for pid,c in registry.items()}
        cls.rows=cls.base["engine_result"]["cases"]
        (ROOT/"runtime/agent-a/producing-rotation/verified.response.json").write_text(json.dumps(cls.base),encoding="utf-8")
    def test_two_full_producing_rotations_and_complete_primary_matrix(self):
        self.assertEqual(len(self.rows),6);self.assertEqual(len(self.base["report_dto"]["five_year_rows"]),30)
        self.assertEqual(self.base["decision"],self.base["engine_result"]["research_decision"])
        self.assertEqual(len(self.base["decision"]["pareto_ids"]),2);self.assertEqual(self.base["decision"]["selected_ids"],[])
        self.assertIsNone(self.base["decision"]["aggregate_value"])
        search=self.base["growth_evaluation"]["candidate_generation"]
        self.assertEqual((search["enumerated"],search["screen_rejected"],search["admitted"]),(162,160,2))
        for c in self.rows:
            self.assertEqual(len(c["growth_years"]),5);self.assertEqual(c["five_year_services"]["bare_fallow_years"],0)
            self.assertEqual({y["crop"] for y in c["growth_years"]},{"potato","sugarbeet","barley"})
            self.assertTrue(all(y["modeled_living_organ_DM_kg_ha"]["SO"]>0 for y in c["growth_years"]))
    def test_root_limits_and_calendars_are_actual_native_evidence(self):
        for c in self.base["growth_evaluation"]["candidate_scenario_cases"]:
            v=c["result"];a=v["root_depth_validation"]
            self.assertGreater(a["daily_active_checks"],0);self.assertEqual(a["maximum_root_depth_disagreement_cm"],0)
            self.assertIn({"published_RDMCR_cm":125.,"soil_RDMSOL_cm":120.,"native_RDM_cm":120.,"water_balance_RDM_cm":120.},a["root_settings"])
            self.assertEqual(len(v["soil_initial"]["layer_water_mm"]),4)
            for y in v["original_calendar"]["seasons"]:
                if y["crop"]=="barley":self.assertEqual(y["crop_end_type"],"earliest");self.assertTrue(y["sowing_date"].endswith("-03-15"))
    def test_full_horizon_each_cultivar_DM_and_N_recomputed(self):
        natives={(x["policy_id"],x["scenario_id"]):x["result"] for x in self.base["growth_evaluation"]["candidate_scenario_cases"]}
        for c in self.rows:
            n=natives[c["policy_id"],c["scenario_id"]]
            self.assertEqual(set(c["five_year_services"]["crop_storage_DM_kg_field_by_crop"]),set(prod.CROPS))
            for cid,crop in prod.CROPS.items():
                self.assertAlmostEqual(math.fsum(y["modeled_living_organ_DM_kg_ha"]["SO"] for y in n["crop_results"] if y["crop"]==crop),c["five_year_services"]["crop_storage_DM_kg_field_by_crop"][cid],delta=1e-6)
            self.assertEqual(n["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"],c["five_year_services"]["N_leaching_kg_N_field"])
    def test_common_following_barley_changes_with_real_predecessor(self):
        by={self.first[c["policy_id"]]:c for c in self.rows if c["scenario_id"]=="REFERENCE"}
        a=by[rot.POTATO]["growth_years"][1];b=by[rot.BEET]["growth_years"][1]
        self.assertEqual((a["crop"],a["cultivar"],a["source_year"]),(b["crop"],b["cultivar"],b["source_year"]))
        for k in ("soil_N_start_kg_N_ha","modeled_N_uptake_kg_N_ha","modeled_living_organ_DM_kg_ha"):self.assertNotEqual(a[k],b[k])
    def test_matched_N_changes_common_barley_service_order_without_economic_claim(self):
        sums={(self.first[c["policy_id"]],c["scenario_id"]):c["five_year_services"]["crop_storage_DM_kg_field_by_crop"][prod.BARLEY] for c in self.rows}
        self.assertGreater(sums[rot.POTATO,"REFERENCE"],sums[rot.BEET,"REFERENCE"])
        self.assertLess(sums[rot.POTATO,"LOW_INITIAL_MINERAL_N"],sums[rot.BEET,"LOW_INITIAL_MINERAL_N"])
        self.assertNotEqual(sums[rot.POTATO,"REFERENCE"],sums[rot.POTATO,"HALF_RAIN"])
    def test_native_N_water_continuity_and_balances(self):
        for c in self.rows:
            self.assertEqual(c["soil_reset_count"],0)
            for y in range(2016,2020):
                self.assertEqual(c["year_end_states_mm"][str(y)],c["year_start_states_mm"][str(y+1)])
                self.assertEqual(c["growth_years"][y-2016]["soil_N_end_kg_N_ha"],c["growth_years"][y-2015]["soil_N_start_kg_N_ha"])
            self.assertLess(abs(c["water_budget"]["residual_mm"]),1e-7)
            self.assertLess(abs(c["accounting"]["model_domain_N_residual_kg_N_ha"]),1e-6)
            self.assertEqual(c["accounting"]["orphaned_soil_uptake_kg_N_ha"],0)
            self.assertIsNone(c["service_pass"])
    def test_declared_PK_ancestry_balances_and_overdraw(self):
        count=0
        for c in self.base["engine_result"]["soil_memory"]["cases"]:
            for i,y in enumerate(c["annual"]):
                if i:self.assertEqual(y["start_state_id"],c["annual"][i-1]["end_state_id"])
                for b in y["balance"].values():
                    self.assertEqual(Decimal(b["initial_total"])+Decimal(b["external_inputs"])-Decimal(b["external_outputs"]),Decimal(b["ending_total"]));count+=1
        self.assertEqual(count,60)
        p=request();e=p["engine_request"]["extensions"]["soil_memory"]
        for scenario in e["initial_states"].values():
            for layer in scenario["F1"]:
                q=layer["pools"]["P_INVENTORY"];q["value"]="0";q["uncertainty"].update(low="0",high="0")
        seal(e);out=self.client.run(p);self.assertEqual(out["decision"]["status"],"ABSTAIN_NO_FEASIBLE_TESTED_GROWTH_PLAN")
    def test_unsupported_or_missing_evidence_and_budget_do_not_rank(self):
        for kind in ("site","wheat","scenario","budget","NASA"):
            p=request()
            if kind=="site":p["engine_request"]["location"]["point_lon_lat"]=[0,0]
            elif kind=="wheat":p["engine_request"]["fields"][0]["crop_candidates"].append("research:NL:wheat_Arminda")
            elif kind=="scenario":p["growth_decision"]["scenarios"].pop()
            elif kind=="budget":p["engine_request"]["search"]["max_evaluations"]=5
            else:p["engine_request"]["source"]["enabled"]=False
            out=self.client.run(p);self.assertEqual(out["status"],"EVIDENCE_BLOCKED");self.assertEqual(out["decision"]["selected_ids"],[])
        with patch.object(prod,"verify_sources",side_effect=ValueError("TEST_SOURCE_CHANGED")):
            self.assertEqual(self.client.run(request())["status"],"EVIDENCE_BLOCKED")
    def test_history_screen_changes_eligibility_not_assumed_initial_biology(self):
        p=request();p["engine_request"]["fields"][0]["history"]=[rot.POTATO,prod.BARLEY,prod.BARLEY]
        out=self.client.run(p);self.assertEqual(len(out["alternatives"]),1)
        self.assertEqual(out["alternatives"][0]["choices"]["F1"][0],rot.BEET)
    def test_no_commercial_yield_or_profit_and_optional_contract(self):
        jsonschema.validate(self.base,read(ROOT/"contracts/client_decision_response_v1.schema.json"))
        self.assertFalse(self.base["qualification"]["field_agronomy_qualified"])
        for y in self.base["report_dto"]["five_year_rows"]:
            self.assertIsNone(y["predicted_yield"]);self.assertIsNone(y["biomass"]["marketable_yield"]);self.assertIsNone(y["economics"]["conditional_margin"])
    def test_ties_missing_matrix_and_cache_integrity(self):
        ids=list(self.first);scenarios=[s["scenario_id"] for s in request()["engine_request"]["scenarios"]]
        self.assertEqual(rot.rank(self.rows[:-1],ids,scenarios,request()["growth_decision"]["objective"])["status"],"ABSTAIN_INCOMPLETE_GROWTH_MATRIX")
        a=deepcopy(self.rows[0]);b=deepcopy(a);a.update(policy_id="a",scenario_id="s");b.update(policy_id="b",scenario_id="s")
        self.assertEqual(rot.rank([a,b],["b","a"],["s"],request()["growth_decision"]["objective"])["pareto_ids"],["a","b"])
        key=self.rows[0]["growth_case_key"];path=ROOT/"runtime/agent-a/growth-decision/scientific_case_cache"/(key+".json")
        self.assertIsNotNone(bridge._load_case(path,key))
        entry=read(path);entry["variant"]["root_depth_validation"]["maximum_root_depth_disagreement_cm"]=1
        self.assertNotEqual(entry["integrity"],digest({k:v for k,v in entry.items() if k!="integrity"}))

if __name__=="__main__":unittest.main()
