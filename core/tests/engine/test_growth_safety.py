"""Fresh independent native replay and failure-safety controls for the new path."""
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import json,tempfile,unittest
from unittest.mock import patch
from brain.baseline import ROOT
from brain.service import ClientDecisionService
from brain import growth_rotation as rot,growth_decision as bridge,growth_experiment as provider,growth_source
from common import read
from soil_memory.contracts import seal

def request():return read(ROOT/"examples/engine/growth_rotation.json")
def submitted():
    p=request();p["growth_decision"]["rotation"]["mode"]="SUBMITTED"
    sequences=[[rot.POTATO,rot.BEET,rot.FALLOW,rot.FALLOW,rot.POTATO],[rot.FALLOW,rot.BEET,rot.POTATO,rot.FALLOW,rot.FALLOW]]
    p["engine_request"]["candidates"]=[{"choices":{"F1":s}} for s in sequences]
    p["engine_request"]["search"].update(max_generated=0,max_candidates=2,max_evaluations=2)
    p["engine_request"]["scenarios"]=[s for s in p["engine_request"]["scenarios"] if s["scenario_id"]=="REFERENCE"]
    p["growth_decision"]["scenarios"]=[s for s in p["growth_decision"]["scenarios"] if s["scenario_id"]=="REFERENCE"]
    return p

class FreshSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT/"runtime/agent-a/overnight/phase1").mkdir(parents=True,exist_ok=True)
        (ROOT/"runtime/agent-a/producing-rotation").mkdir(parents=True,exist_ok=True)
        cls.directory=Path(tempfile.mkdtemp(prefix="fresh-rotation-",dir=ROOT/"runtime/agent-a/overnight"))
        cls.client=ClientDecisionService(cls.directory);cls.p=submitted();cls.fresh=cls.client.run(cls.p);cls.replay=cls.client.run(cls.p)
        if cls.fresh["status"]!="CONDITIONAL_RESEARCH_COMPLETE":raise AssertionError(cls.fresh["missing_requirements"])
        for label,result in (("fresh",cls.fresh),("replay",cls.replay)):
            (ROOT/"runtime/agent-a/overnight/phase1"/(label+"_two_sequence.response.json")).write_text(json.dumps(result),encoding="utf-8")
    def test_fresh_native_and_cached_replay_exact(self):
        self.assertEqual(self.fresh["engine_result"]["execution"]["physics_cases_executed"],2)
        self.assertEqual(self.replay["engine_result"]["execution"]["numerical_cache_replays"],2)
        self.assertEqual(self.fresh["decision"],self.replay["decision"])
        self.assertEqual(self.fresh["engine_result"]["scientific_result_sha256"],self.replay["engine_result"]["scientific_result_sha256"])
        reference=ClientDecisionService().run(self.p)
        for a,b in zip(self.fresh["engine_result"]["cases"],reference["engine_result"]["cases"]):
            self.assertEqual(a["growth_years"],b["growth_years"]);self.assertEqual(a["five_year_services"],b["five_year_services"])
    def test_tampered_cache_failed_recompute_abstains(self):
        path=next((self.directory/"growth-decision/scientific_case_cache").glob("*.json"));original=path.read_bytes()
        changed=json.loads(original);changed["variant"]["crop_results"][0]["modeled_N_uptake_kg_N_ha"]+=10
        try:
            path.write_text(json.dumps(changed),encoding="utf-8")
            with patch.object(provider,"run",return_value=provider.blocked("TEST_NATIVE_RESOURCE_UNAVAILABLE")):
                out=self.client.run(self.p)
            self.assertEqual(out["status"],"EVIDENCE_BLOCKED");self.assertEqual(out["decision"]["selected_ids"],[])
        finally:path.write_bytes(original)
    def test_missing_source_with_warm_cache_abstains(self):
        with patch.object(growth_source,"acquire",side_effect=growth_source.SourceBlocked("TEST_MISSING_OR_INVALID_DAY")):
            out=self.client.run(self.p)
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED");self.assertEqual(out["decision"]["selected_ids"],[])
    def test_actual_sowing_evidence_and_no_false_water_service(self):
        for c in self.fresh["engine_result"]["cases"]:
            self.assertIsNone(c["service_pass"]);self.assertTrue(c["modeled_research_constraints_pass"])
            self.assertGreater(c["no_crop_integrated_days"],700)
            for y in c["growth_years"]:
                evidence=y["calendar_evidence"]
                self.assertEqual(evidence["harvest_slot_crop_use_id"],rot.FALLOW if y["crop"]=="bare_fallow" else next(k for k,v in rot.PRODUCING_CROPS.items() if v==y["crop"]))
                if y["crop"]=="bare_fallow":self.assertIsNone(evidence["native_soil_at_sowing"])
                else:self.assertEqual(len(evidence["native_soil_at_sowing"]["nitrate_kg_N_ha"]),4)
    def test_PK_overdraw_gives_actual_infeasibility_witness(self):
        p=deepcopy(self.p);e=p["engine_request"]["extensions"]["soil_memory"]
        for scenario in e["initial_states"].values():
            for layer in scenario["F1"]:
                q=layer["pools"]["P_INVENTORY"];q["value"]="0";q["uncertainty"].update(low="0",high="0")
        seal(e);out=self.client.run(p)
        self.assertEqual(out["decision"]["status"],"ABSTAIN_NO_FEASIBLE_TESTED_GROWTH_PLAN")
        self.assertTrue(all(c["growth_constraint_violations"] for c in out["engine_result"]["cases"]))
    def test_budget_and_calendar_override_cannot_publish_rank(self):
        p=deepcopy(self.p);p["growth_decision"]["calendar_override"]={"sowing":"2015-01-01"}
        with self.assertRaises(ValueError):self.client.run(p)
        clock=iter([0,0,1000,1000])
        with patch.object(bridge,"time",SimpleNamespace(monotonic=lambda:next(clock))):
            out=self.client.run(self.p)
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED");self.assertEqual(out["decision"]["selected_ids"],[])
    def test_extra_unmatched_matrix_member_abstains(self):
        rows=deepcopy(self.fresh["engine_result"]["cases"]);extra=deepcopy(rows[0]);extra["scenario_id"]="UNREQUESTED";rows.append(extra)
        out=rot.rank(rows,list(self.fresh["engine_result"]["candidate_registry"]),["REFERENCE"],self.p["growth_decision"]["objective"])
        self.assertEqual(out["status"],"ABSTAIN_INCOMPLETE_GROWTH_MATRIX")

if __name__=="__main__":unittest.main()
