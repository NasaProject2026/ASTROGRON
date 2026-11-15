"""Native rotation evidence, independent component recomputation and negative controls."""
from copy import deepcopy
from decimal import Decimal
import itertools,json,unittest
from unittest.mock import patch
import jsonschema
from brain.baseline import ROOT,verify
from brain import growth_rotation as rot,growth_profiles as profile,growth_decision as bridge,growth_experiment as provider
from brain.service import ClientDecisionService
from common import read
from contract import normalize
from soil_memory.contracts import seal

def request():return read(ROOT/"examples/engine/growth_rotation.json")
def norm(p):
    d=deepcopy(p["engine_request"]);d.pop("extensions",None);return normalize(d)
def names(r):
    return {pid:"".join({"potato":"P","sugarbeet":"B","bare_fallow":"F"}[rot.CROPS[c]] for c in a["choices"]["F1"]) for pid,a in r["engine_result"]["candidate_registry"].items()}

class AdmissionTests(unittest.TestCase):
    def test_enumeration_and_stable_order(self):
        p=request();d=norm(p);a,b,s=rot.candidates(d,p["growth_decision"],bridge.Blocked)
        self.assertEqual((s["enumerated"],len(a),len(b)),(8,4,4))
        for c in a:self.assertIsNone(rot.witness(c["choices"]["F1"],d["fields"][0],p["growth_decision"]["rotation"]))
        p["growth_decision"]["rotation"]["year_options"]=[list(reversed(x)) for x in p["growth_decision"]["rotation"]["year_options"]]
        self.assertEqual(a,rot.candidates(norm(p),p["growth_decision"],bridge.Blocked)[0])
    def test_calendar_and_unsafe_return_witness(self):
        p=request();d=norm(p);g=p["growth_decision"]["rotation"];g["year_options"]=[list(rot.CROPS)]*5
        w=rot.witness([rot.POTATO,rot.POTATO,rot.BEET,rot.FALLOW,rot.FALLOW],d["fields"][0],g)
        self.assertEqual(w["reason"],"DECLARED_CROP_RETURN_GAP");self.assertEqual(w["intervening_slots"],0)
        s=profile.seasons(["potato","sugarbeet","bare_fallow","bare_fallow","potato"])
        self.assertEqual([x.harvest_date.isoformat() for x in s],["2016-09-24","2017-10-15","2020-09-24"])
        for seq in (["wheat"]*5,["potato"]*4,["bare_fallow"]*5):
            with self.assertRaises(ValueError):profile.seasons(seq)
    def test_budget_and_schema(self):
        p=request();jsonschema.validate(p["growth_decision"],read(ROOT/"contracts/growth_rotation_request_v1.schema.json"))
        d=norm(p);d["search"]["max_generated"]=3
        with self.assertRaisesRegex(bridge.Blocked,"NO_PARTIAL_RANKING"):rot.candidates(d,p["growth_decision"],bridge.Blocked)
        p["growth_decision"]["objective"]["target_years"]=[2017]
        with self.assertRaises(ValueError):rot.check_config(p["growth_decision"],d["fields"][0])
    def test_original_profile_still_blocks_wheat_and_fallow(self):
        p=read(ROOT/"examples/engine/growth_research.json")
        for crop in ("wheat","bare_fallow"):
            q=deepcopy(p);q["variants"][0]["crop_sequence"][0]=crop
            self.assertEqual(provider.run(q)["status"],"EVIDENCE_BLOCKED")

class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=ClientDecisionService();cls.base=cls.client.run(request())
        if cls.base["status"]!="CONDITIONAL_RESEARCH_COMPLETE":raise AssertionError(cls.base["missing_requirements"])
        cls.names=names(cls.base);cls.ids={v:k for k,v in cls.names.items()}
    def test_matrix_and_primary_partial_decision(self):
        r=self.base;self.assertEqual(set(self.names.values()),{"PBFFP","PBFFF","FBPFF","FBFFP"})
        self.assertEqual(len(r["engine_result"]["cases"]),12);self.assertEqual(len(r["report_dto"]["five_year_rows"]),60)
        self.assertEqual(r["decision"],r["engine_result"]["research_decision"])
        self.assertEqual(len(r["decision"]["pareto_ids"]),3);self.assertEqual(r["decision"]["selected_ids"],[])
        self.assertIsNone(r["decision"]["aggregate_value"])
    def test_full_horizon_components_recomputed(self):
        ns={(c["policy_id"],c["scenario_id"]):c["result"] for c in self.base["growth_evaluation"]["candidate_scenario_cases"]}
        for c in self.base["engine_result"]["cases"]:
            n=ns[c["policy_id"],c["scenario_id"]];v=c["five_year_services"]
            for cid,crop in rot.PRODUCING_CROPS.items():
                self.assertAlmostEqual(sum(x["modeled_living_organ_DM_kg_ha"]["SO"] for x in n["crop_results"] if x["crop"]==crop),v["crop_storage_DM_kg_field_by_crop"][cid],delta=1e-6)
            self.assertEqual(v["N_leaching_kg_N_field"],n["accounting"]["soil_N"]["bottom_leaching_kg_N_ha"])
            self.assertIsNone(c["target_potato_storage_DM_kg_field"])
        self.assertEqual(self.base["decision"]["target_years"],[2016,2017,2018,2019,2020])
    def test_predecessor_and_paired_N_rain_effects(self):
        rows=self.base["engine_result"]["cases"]
        ref={self.names[c["policy_id"]]:c for c in rows if c["scenario_id"]=="REFERENCE"}
        a=ref["PBFFP"]["growth_years"][1];b=ref["FBPFF"]["growth_years"][1]
        self.assertEqual((a["crop"],a["cultivar"]),(b["crop"],b["cultivar"]))
        for k in ("soil_N_start_kg_N_ha","modeled_N_uptake_kg_N_ha","modeled_living_organ_DM_kg_ha"):self.assertNotEqual(a[k],b[k])
        by={c["scenario_id"]:c for c in rows if c["policy_id"]==self.ids["PBFFP"]}
        for sid in ("HALF_RAIN","LOW_INITIAL_MINERAL_N"):self.assertNotEqual(by["REFERENCE"]["five_year_services"],by[sid]["five_year_services"])
    def test_future_crop_change_cannot_cause_prior_year_growth(self):
        rows={self.names[c["policy_id"]]:c for c in self.base["engine_result"]["cases"] if c["scenario_id"]=="REFERENCE"}
        for a,b in (("PBFFP","PBFFF"),("FBPFF","FBFFP")):
            self.assertEqual(rows[a]["growth_years"][1],rows[b]["growth_years"][1])
    def test_field_area_scales_crop_services_and_N_loss_not_physiology(self):
        p=request();p["engine_request"]["fields"][0]["area_ha"]=2
        other=self.client.run(p)
        for a,b in zip(self.base["engine_result"]["cases"],other["engine_result"]["cases"]):
            self.assertEqual(a["growth_years"],b["growth_years"])
            for c in rot.PRODUCING_CROPS:
                self.assertEqual(2*a["five_year_services"]["crop_storage_DM_kg_field_by_crop"][c],b["five_year_services"]["crop_storage_DM_kg_field_by_crop"][c])
            self.assertEqual(2*a["five_year_services"]["N_leaching_kg_N_field"],b["five_year_services"]["N_leaching_kg_N_field"])
    def test_water_N_continuity_and_domain_balances(self):
        for c in self.base["engine_result"]["cases"]:
            self.assertEqual(c["soil_reset_count"],0)
            for y in range(2016,2020):
                self.assertEqual(c["year_end_states_mm"][str(y)],c["year_start_states_mm"][str(y+1)])
                self.assertEqual(c["growth_years"][y-2016]["soil_N_end_kg_N_ha"],c["growth_years"][y-2015]["soil_N_start_kg_N_ha"])
            self.assertLess(abs(c["accounting"]["model_domain_N_residual_kg_N_ha"]),1e-6)
            self.assertEqual(c["accounting"]["orphaned_soil_uptake_kg_N_ha"],0)
    def test_PK_all_years_and_fallow_conservation(self):
        count=0
        for c in self.base["engine_result"]["soil_memory"]["cases"]:
            self.assertEqual(len(c["annual"]),5)
            for i,a in enumerate(c["annual"]):
                if i:self.assertEqual(a["start_state_id"],c["annual"][i-1]["end_state_id"])
                for b in a["balance"].values():
                    self.assertEqual(Decimal(b["initial_total"])+Decimal(b["external_inputs"])-Decimal(b["external_outputs"]),Decimal(b["ending_total"]));count+=1
                if self.names[c["policy_id"]][i]=="F":self.assertEqual(a["start_pools_kg_element_per_ha"],a["end_pools_kg_element_per_ha"])
        self.assertEqual(count,120)
    def test_history_changes_Pareto_eligibility_without_fake_initial_soil(self):
        p=request();p["engine_request"]["fields"][0]["history"]=[rot.POTATO];r=self.client.run(p)
        self.assertEqual(set(names(r).values()),{"FBFFP"})
        self.assertNotEqual(r["decision"]["pareto_ids"],self.base["decision"]["pareto_ids"])
        self.assertIn("Pre-period biology is not simulated",r["growth_evaluation"]["candidate_generation"]["history_scope"])
        (ROOT/"runtime/agent-a/overnight/phase1/history_screen.response.json").write_text(json.dumps(r),encoding="utf-8")
    def test_negative_source_site_scenario_budget_and_crop(self):
        for kind in ("source","site","scenario","budget","crop"):
            p=request()
            if kind=="source":p["engine_request"]["source"]["enabled"]=False
            elif kind=="site":p["engine_request"]["location"]["point_lon_lat"]=[0,0]
            elif kind=="scenario":p["growth_decision"]["scenarios"].pop()
            elif kind=="budget":p["engine_request"]["search"]["max_evaluations"]=11
            else:p["engine_request"]["fields"][0]["crop_candidates"].append("research:NL:wheat_Arminda")
            r=self.client.run(p);self.assertEqual(r["status"],"EVIDENCE_BLOCKED");self.assertEqual(r["decision"]["selected_ids"],[])
    def test_incomplete_matrix_and_equal_vectors(self):
        rows=self.base["engine_result"]["cases"];ids=list(self.names);sids=[s["scenario_id"] for s in request()["engine_request"]["scenarios"]]
        self.assertEqual(rot.rank(rows[:-1],ids,sids,request()["growth_decision"]["objective"])["status"],"ABSTAIN_INCOMPLETE_GROWTH_MATRIX")
        a=deepcopy(rows[0]);b=deepcopy(a);a.update(policy_id="a",scenario_id="s");b.update(policy_id="b",scenario_id="s")
        r=rot.rank([a,b],["b","a"],["s"],request()["growth_decision"]["objective"]);self.assertEqual(r["pareto_ids"],["a","b"]);self.assertEqual(r["selected_ids"],[])
    def test_no_fabricated_fallow_plant_output_yield_profit(self):
        jsonschema.validate(self.base,read(ROOT/"contracts/client_decision_response_v1.schema.json"))
        for row in self.base["report_dto"]["five_year_rows"]:
            self.assertIsNone(row["predicted_yield"]);self.assertIsNone(row["economics"]["conditional_margin"])
            if row["crop_use_id"]==rot.FALLOW:self.assertIsNone(row["biomass"]);self.assertIsNone(row["biological_uptake"])
        self.assertFalse(self.base["growth_evaluation"]["field_validated"])
        self.assertEqual(verify()["files_verified"],301)

if __name__=="__main__":unittest.main()
