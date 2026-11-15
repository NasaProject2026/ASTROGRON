"""Actual canonical consumer pointers and invariants; no report-side science."""
import unittest
from brain.baseline import ROOT
from brain.service import ClientDecisionService
from common import read

def pointer(value,path):
    for key in path.strip("/").split("/"):
        key=key.replace("~1","/").replace("~0","~")
        value=value[int(key)] if isinstance(value,list) else value[key]
    return value

class ConsumerContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=read(ROOT/"contracts/SCIENTIFIC_BRAIN_INTEGRATION_V1.json")
        cls.request=read(ROOT/cls.contract["example_request"]);cls.response=ClientDecisionService().run(cls.request)
        if cls.response["status"]!="CONDITIONAL_RESEARCH_COMPLETE":raise AssertionError(cls.response["missing_requirements"])
    def test_all_documented_consumer_pointers_are_actual_outputs(self):
        for path in self.contract["required_pointers"]:
            with self.subTest(pointer=path):self.assertIsNotNone(pointer(self.response,path))
        self.assertEqual(self.response["schema"],self.contract["response_schema"])
        self.assertEqual(self.response["report_dto"]["schema"],self.contract["report_schema"])
    def test_partial_pareto_is_success_without_fabricated_economic_winner(self):
        r=self.response;self.assertEqual(r["decision"]["selected_ids"],[])
        self.assertEqual(len(r["decision"]["pareto_ids"]),2)
        self.assertFalse(r["qualification"]["field_agronomy_qualified"])
        rows=r["report_dto"]["five_year_rows"];self.assertEqual(len(rows),30)
        keys=[tuple(row[k] for k in self.contract["agent_b"]["row_key"]) for row in rows]
        self.assertEqual(len(keys),len(set(keys)))
        for row in rows:
            self.assertIsNone(row["predicted_yield"]);self.assertIsNone(row["biomass"]["marketable_yield"])
            self.assertIsNone(row["economics"]["conditional_margin"])
            self.assertIsNone(row["water_start_state"])
            self.assertEqual(len(row["growth_model"]["water_start_total_layer_mm"]),4)
if __name__=="__main__":unittest.main()
