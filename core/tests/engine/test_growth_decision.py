"""Growth responses must change the public primary decision, not a sidecar."""
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
import json,math,tempfile,unittest
from unittest.mock import patch
from brain.baseline import ROOT,verify
from brain.service import ClientDecisionService
from brain import growth_decision as bridge,growth_experiment as provider
from common import read,digest
from soil_memory.contracts import seal

def request():return read(ROOT/"examples/engine/growth_decision.json")
def reseal(p):seal(p["engine_request"]["extensions"]["soil_memory"])

class GrowthDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=ClientDecisionService()
        cls.base=cls.client.run(request())
        if cls.base["status"]!="CONDITIONAL_RESEARCH_COMPLETE":raise AssertionError(cls.base["missing_requirements"])
        cls.pid_p=digest(request()["engine_request"]["candidates"][0]["choices"])[:20]
        cls.pid_b=digest(request()["engine_request"]["candidates"][1]["choices"])[:20]
        out=ROOT/"runtime/agent-a/growth-decision"
        (out/"verified.response.json").write_text(json.dumps(cls.base,indent=2)+"\n",encoding="utf-8")
    def test_actual_two_five_year_sequences_in_primary_candidate_matrix(self):
        r=self.base
        self.assertEqual(len(r["alternatives"]),2)
        self.assertEqual(len(r["engine_result"]["cases"]),6)
        self.assertEqual(len(r["report_dto"]["five_year_rows"]),30)
        self.assertEqual(r["decision"],r["engine_result"]["research_decision"])
        self.assertTrue(r["growth_evaluation"]["growth_responses_influence_primary_ranking"])
        self.assertEqual(r["decision"]["selected_ids"],[self.pid_p])
    def test_rank_objectives_independently_recomputed_from_native_growth(self):
        rows=self.base["growth_evaluation"]["candidate_scenario_cases"];area=request()["engine_request"]["fields"][0]["area_ha"]
        by={}
        for c in rows:
            value=math.fsum(x["modeled_living_organ_DM_kg_ha"]["SO"] for x in c["result"]["crop_results"] if x["original_weather_year"] in (2017,2018,2019,2020))*area
            by.setdefault(c["policy_id"],[]).append(value)
            engine=next(x for x in self.base["engine_result"]["cases"] if x["policy_id"]==c["policy_id"] and x["scenario_id"]==c["scenario_id"])
            self.assertAlmostEqual(value,engine["target_potato_storage_DM_kg_field"],delta=1e-6)
        for objective in self.base["decision"]["objectives"]:
            self.assertAlmostEqual(float(objective["worst_target_storage_DM_kg_field"]),min(by[objective["policy_id"]]),delta=1e-6)
    def test_predecessor_changes_next_crop_and_followon_plan_output(self):
        cases=self.base["growth_evaluation"]["candidate_scenario_cases"]
        a=next(x["result"] for x in cases if x["policy_id"]==self.pid_p and x["scenario_id"]=="REFERENCE")
        b=next(x["result"] for x in cases if x["policy_id"]==self.pid_b and x["scenario_id"]=="REFERENCE")
        self.assertEqual(a["soil_initial"],b["soil_initial"])
        self.assertNotEqual(a["crop_results"][1]["modeled_N_uptake_kg_N_ha"],b["crop_results"][1]["modeled_N_uptake_kg_N_ha"])
        self.assertNotEqual(a["crop_results"][1]["modeled_living_organ_DM_kg_ha"]["SO"],b["crop_results"][1]["modeled_living_organ_DM_kg_ha"]["SO"])
    def test_water_and_N_change_evaluated_growth_scores(self):
        cases={x["scenario_id"]:x for x in self.base["engine_result"]["cases"] if x["policy_id"]==self.pid_p}
        ref=cases["REFERENCE"];low=cases["LOW_INITIAL_MINERAL_N"];dry=cases["HALF_RAIN"]
        self.assertNotEqual(ref["target_potato_storage_DM_kg_field"],low["target_potato_storage_DM_kg_field"])
        self.assertGreater(ref["target_potato_storage_DM_kg_field"],dry["target_potato_storage_DM_kg_field"])
        self.assertGreater(ref["growth_years"][0]["modeled_N_uptake_kg_N_ha"],low["growth_years"][0]["modeled_N_uptake_kg_N_ha"])
    def test_native_N_loss_constraint_reverses_primary_selected_plan(self):
        p=request();p["growth_decision"]["constraints"]["max_modeled_N_leaching"]={"value":116,"unit":"kg N/ha","basis":"EXPLICIT_RESEARCH_CONSTRAINT_NOT_REGULATION"}
        r=self.client.run(p)
        self.assertEqual(r["decision"]["selected_ids"],[self.pid_b])
        self.assertNotEqual(r["decision"]["selected_ids"],self.base["decision"]["selected_ids"])
        witness=next(c for c in r["engine_result"]["cases"] if c["policy_id"]==self.pid_p and c["scenario_id"]=="REFERENCE")
        self.assertGreater(witness["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"],116)
        (ROOT/"runtime/agent-a/growth-decision/constraint_reversal.response.json").write_text(json.dumps(r,indent=2)+"\n",encoding="utf-8")
    def test_changed_initial_N_reverses_plan_at_fixed_research_constraint(self):
        outputs={}
        for sid in ("REFERENCE","LOW_INITIAL_MINERAL_N"):
            p=request()
            p["engine_request"]["scenarios"]=[s for s in p["engine_request"]["scenarios"] if s["scenario_id"]==sid]
            p["growth_decision"]["scenarios"]=[s for s in p["growth_decision"]["scenarios"] if s["scenario_id"]==sid]
            p["growth_decision"]["constraints"]["max_modeled_N_leaching"]={"value":116,"unit":"kg N/ha","basis":"EXPLICIT_RESEARCH_CONSTRAINT_NOT_REGULATION"}
            outputs[sid]=self.client.run(p)
            (ROOT/"runtime/agent-a/growth-decision"/(sid.lower()+"_fixed_N_cap.response.json")).write_text(json.dumps(outputs[sid],indent=2)+"\n",encoding="utf-8")
        self.assertEqual(outputs["REFERENCE"]["decision"]["selected_ids"],[self.pid_b])
        self.assertEqual(outputs["LOW_INITIAL_MINERAL_N"]["decision"]["selected_ids"],[self.pid_p])
        self.assertEqual(outputs["REFERENCE"]["growth_evaluation"]["constraints"],outputs["LOW_INITIAL_MINERAL_N"]["growth_evaluation"]["constraints"])

    def test_native_water_and_N_year_seams_are_exact(self):
        for c in self.base["engine_result"]["cases"]:
            self.assertEqual(c["soil_reset_count"],0)
            for y in range(2016,2020):
                self.assertEqual(c["year_end_states_mm"][str(y)],c["year_start_states_mm"][str(y+1)])
                self.assertEqual(c["growth_years"][y-2016]["soil_N_end_kg_N_ha"],c["growth_years"][y-2016+1]["soil_N_start_kg_N_ha"])
            self.assertEqual(c["annual_water_state_boundary_dates"]["2020"]["end"],"2020-12-31")
    def test_P_K_balances_and_inventory_ancestry_preserved(self):
        checks=0
        for c in self.base["engine_result"]["soil_memory"]["cases"]:
            for i,a in enumerate(c["annual"]):
                self.assertEqual(set(a["end_pools_kg_element_per_ha"]),{"P_INVENTORY","K_INVENTORY","CROP_P","CROP_K","RESIDUE_P","RESIDUE_K"})
                if i:self.assertEqual(a["start_state_id"],c["annual"][i-1]["end_state_id"])
                for e,b in a["balance"].items():
                    self.assertIn(e,("P","K"))
                    self.assertEqual(Decimal(b["initial_total"])+Decimal(b["external_inputs"])-Decimal(b["external_outputs"]),Decimal(b["ending_total"]))
                    self.assertEqual(b["mass_residual"],"0");checks+=1
        self.assertEqual(checks,60)
    def test_PK_terminal_constraint_can_abstain_all_tested_plans(self):
        p=request();e=p["engine_request"]["extensions"]["soil_memory"]
        q=deepcopy(e["initial_states"]["REFERENCE"]["F1"][0]["pools"]["P_INVENTORY"])
        q.update(value="1",layer_id="PROFILE",depth_mm=[0,1200]);q["uncertainty"].update(low="1",high="1")
        e["constraint"].update(enabled=True,minimum_terminal={"P_INVENTORY":q});reseal(p)
        r=self.client.run(p)
        self.assertEqual(r["decision"]["selected_ids"],[])
        self.assertEqual(r["decision"]["status"],"ABSTAIN_NO_FEASIBLE_TESTED_GROWTH_PLAN")
    def test_PK_unknown_never_becomes_zero(self):
        p=request();q=p["engine_request"]["extensions"]["soil_memory"]["initial_states"]["REFERENCE"]["F1"][0]["pools"]["P_INVENTORY"]
        q.update(value=None,blocker="Missing initial P inventory");reseal(p)
        r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED");self.assertEqual(r["decision"]["selected_ids"],[])
    def test_unsupported_site_and_crop_abstain(self):
        for kind in ("site","crop"):
            p=request()
            if kind=="site":p["engine_request"]["location"]["point_lon_lat"]=[147.35,-35.05]
            else:
                c="research:ZZ:wheat";p["engine_request"]["fields"][0]["crop_candidates"].append(c);p["engine_request"]["candidates"][0]["choices"]["F1"][0]=c
            r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED");self.assertEqual(r["decision"]["selected_ids"],[])
    def test_incomparable_cross_crop_DM_objective_abstains(self):
        p=request();p["engine_request"]["candidates"][1]["choices"]["F1"][1]=bridge.BEET
        r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
        self.assertIn("CROSS_CROP",str(r["missing_requirements"]))
    def test_missing_matched_scenarios_and_budget_abstain(self):
        for kind in ("scenario","budget"):
            p=request()
            if kind=="scenario":p["growth_decision"]["scenarios"].pop()
            else:p["engine_request"]["search"]["max_evaluations"]=5
            r=self.client.run(p);self.assertEqual(r["decision"]["selected_ids"],[])
            self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
    def test_source_ablation_no_warm_cache_fallback(self):
        p=request();p["engine_request"]["source"]["enabled"]=False
        r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED");self.assertEqual(r["decision"]["selected_ids"],[])
    def test_unqualified_growth_economics_blocked(self):
        p=request();p["engine_request"]["economic_sidecar"]={"operating_surplus_EUR":1000,"basis":"USER_RESEARCH_ASSUMPTION","manifest_id":"native_process_research"}
        r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
        self.assertIn("ECONOMICS_BLOCKED",str(r["missing_requirements"]))
    def test_DM_is_never_validated_marketable_yield_or_profit(self):
        for row in self.base["report_dto"]["five_year_rows"]:
            self.assertIsNone(row["predicted_yield"])
            self.assertIsNone(row["biomass"]["marketable_yield"])
            self.assertIsNone(row["economics"]["conditional_margin"])
            self.assertEqual(row["biomass"]["unit"],"kg DM/ha")
        self.assertFalse(self.base["qualification"]["field_agronomy_qualified"])
        self.assertIsNone(self.base["growth_evaluation"]["marketable_yield"])
    def test_minimax_regret_uses_complete_growth_matrix(self):
        p=request();p["growth_decision"]["objective"]["criterion"]="minimax_regret"
        r=self.client.run(p)
        self.assertEqual(r["decision"]["criterion"],"minimax_regret")
        self.assertEqual(r["decision"]["selected_ids"],[self.pid_p])
        self.assertFalse(r["decision"]["global_optimum"])
    def test_area_changes_actual_objective_without_changing_per_ha_physiology(self):
        p=request();p["engine_request"]["fields"][0]["area_ha"]=2
        r=self.client.run(p)
        for a,b in zip(self.base["engine_result"]["cases"],r["engine_result"]["cases"]):
            self.assertAlmostEqual(b["target_potato_storage_DM_kg_field"],2*a["target_potato_storage_DM_kg_field"],places=6)
            self.assertEqual(a["growth_years"],b["growth_years"])
    def test_missing_growth_case_cannot_rank(self):
        rows=self.base["engine_result"]["cases"][:-1]
        r=bridge.rank(rows,[self.pid_p,self.pid_b],["HALF_RAIN","LOW_INITIAL_MINERAL_N","REFERENCE"],request()["growth_decision"]["objective"])
        self.assertEqual(r["selected_ids"],[]);self.assertEqual(r["status"],"ABSTAIN_INCOMPLETE_GROWTH_MATRIX")
    def test_fresh_and_cached_science_are_identical_and_tampered_cache_abstains(self):
        p=request()
        p["engine_request"]["scenarios"]=[s for s in p["engine_request"]["scenarios"] if s["scenario_id"]=="REFERENCE"]
        p["growth_decision"]["scenarios"]=[s for s in p["growth_decision"]["scenarios"] if s["scenario_id"]=="REFERENCE"]
        directory=Path(tempfile.mkdtemp(prefix="bridge-test-",dir=ROOT/"runtime/agent-a"))
        client=ClientDecisionService(directory)
        a=client.run(p);b=client.run(p)
        self.assertEqual(a["status"],"CONDITIONAL_RESEARCH_COMPLETE")
        self.assertEqual(a["engine_result"]["execution"]["physics_cases_executed"],2)
        self.assertEqual(b["engine_result"]["execution"]["numerical_cache_replays"],2)
        self.assertEqual(a["decision"],b["decision"])
        self.assertEqual(a["engine_result"]["scientific_result_sha256"],b["engine_result"]["scientific_result_sha256"])
        path=next((directory/"growth-decision/scientific_case_cache").glob("*.json"))
        data=read(path);data["variant"]["crop_results"][0]["modeled_living_organ_DM_kg_ha"]["SO"]+=1000
        path.write_text(json.dumps(data),encoding="utf-8")
        with patch.object(provider,"run",return_value=provider.blocked("FORCED_RECOMPUTATION_FAILURE")):
            c=client.run(p)
        self.assertEqual(c["status"],"EVIDENCE_BLOCKED");self.assertEqual(c["decision"]["selected_ids"],[])
    def test_tighter_unmetered_CPU_budget_abstains(self):
        p=request();p["engine_request"]["search"]["max_cpu_seconds"]=1
        r=self.client.run(p)
        self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
        self.assertEqual(r["decision"]["selected_ids"],[])
        self.assertIn("CPU_CAP",str(r["missing_requirements"]))
    def test_budget_exhausted_after_matrix_never_publishes_selection(self):
        from types import SimpleNamespace
        clock=iter([0,0,1000,1000])
        with patch.object(bridge,"time",SimpleNamespace(monotonic=lambda:next(clock))):
            r=self.client.run(request())
        self.assertEqual(r["status"],"EVIDENCE_BLOCKED")
        self.assertEqual(r["decision"]["selected_ids"],[])
        self.assertIn("BUDGET_EXHAUSTED",str(r["missing_requirements"]))

    def test_contracts_and_protected_science(self):
        import jsonschema
        jsonschema.validate(request(),read(ROOT/"contracts/client_decision_request_v1.schema.json"))
        jsonschema.validate(request()["growth_decision"],read(ROOT/"contracts/growth_decision_request_v1.schema.json"))
        jsonschema.validate(self.base,read(ROOT/"contracts/client_decision_response_v1.schema.json"))
        self.assertEqual(verify()["files_verified"],301)

if __name__=="__main__":unittest.main()
