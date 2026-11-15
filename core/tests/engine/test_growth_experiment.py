"""Numerical process controls; these tests do not qualify field prediction."""
from copy import deepcopy
from pathlib import Path
import hashlib,json,math,subprocess,unittest
from unittest.mock import patch
from brain.baseline import ROOT,verify
from brain import growth_experiment as growth,growth_source as source
from common import digest,read

def request():
    r=read(ROOT/"examples/engine/growth_research.json")
    r["acquisition"]="CACHE_ONLY"
    return r

class BoundaryTests(unittest.TestCase):
    def test_other_site_blocks_without_acquisition(self):
        r=request();r["point_lon_lat"]=[147.35,-35.05]
        with patch.object(source,"acquire",side_effect=AssertionError("NO_FALLBACK")):
            out=growth.run(r)
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED")
        self.assertEqual(out["variants"],[])
    def test_explicit_research_acknowledgement(self):
        r=request();r["research_acknowledged"]=False
        self.assertEqual(growth.run(r)["status"],"EVIDENCE_BLOCKED")
    def test_unknown_crop_blocks(self):
        r=request();r["variants"][0]["crop_sequence"][0]="wheat"
        self.assertEqual(growth.run(r)["status"],"EVIDENCE_BLOCKED")
    def test_exact_five_year_sequence(self):
        r=request();r["variants"][0]["crop_sequence"].pop()
        self.assertEqual(growth.run(r)["status"],"EVIDENCE_BLOCKED")
    def test_nonfinite_and_boolean_interventions_rejected(self):
        for value in (True,float("nan"),float("inf"),-1,2):
            r=request();r["variants"][0]["initial_mineral_N_factor"]=value
            with self.assertRaises(ValueError):growth.validate(r)
    def test_duplicate_ids_rejected(self):
        r=request();r["variants"][1]["id"]=r["variants"][0]["id"]
        with self.assertRaises(ValueError):growth.validate(r)
    def test_unknown_key_rejected(self):
        r=request();r["fertilizer_prescription"]=100
        with self.assertRaises(ValueError):growth.validate(r)
    def test_external_runtime_rejected(self):
        with self.assertRaises(ValueError):growth.run(request(),runtime_dir=ROOT/"not-runtime")
    def test_missing_pcse_runtime_abstains(self):
        out=growth.run(request(),python_path=ROOT/"runtime/agent-a/missing-python")
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED")
        self.assertIsNone(out["profit"])
        self.assertIn("PINNED_PCSE_RUNTIME_UNAVAILABLE",str(out["missing_requirements"]))
    def test_changed_input_source_blocks_without_edits(self):
        original=Path.read_bytes
        def altered(p):
            return b"tampered" if str(p).endswith("harvest_boundary_v2.py") else original(p)
        with patch.object(Path,"read_bytes",altered):
            out=growth.run(request())
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED")
        self.assertIn("PINNED_GROWTH_INPUT_CHANGED",str(out["missing_requirements"]))
    def test_changed_nasa_snapshot_blocks(self):
        doc,receipt=source.acquire(ROOT/"runtime/agent-a/growth/source_cache")
        fake=deepcopy(receipt);fake["raw_sha256"]="0"*64
        with patch.object(source,"acquire",return_value=(doc,fake)):
            out=growth.run(request())
        self.assertEqual(out["status"],"EVIDENCE_BLOCKED")
        self.assertIn("NASA_SNAPSHOT_DIFFERS",str(out["missing_requirements"]))

class SourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc,cls.receipt=source.acquire(ROOT/"runtime/agent-a/growth/source_cache")
        cls.raw=(ROOT/"runtime/agent-a/growth/source_cache"/(cls.receipt["raw_sha256"]+".raw.json")).read_bytes()
    def invalid(self,change):
        d=deepcopy(self.doc);change(d)
        with self.assertRaises(source.SourceBlocked):source.qualify(json.dumps(d).encode())
    def test_complete_1827_days_and_two_leap_days(self):
        d,q=source.qualify(self.raw)
        self.assertEqual(q["days"],1827)
        for day in ("20160229","20200229"):self.assertIn(day,d["properties"]["parameter"]["T2M"])
        self.assertIn("SYN1DEG",q["sources"])
    def test_no_missing_radiation_imputation(self):
        self.invalid(lambda d:d["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"].pop("20160101"))
    def test_no_missing_wind_imputation(self):
        self.invalid(lambda d:d["properties"]["parameter"]["WS2M"].update({"20160101":-999}))
    def test_units_are_not_guessed(self):
        self.invalid(lambda d:d["parameters"]["ALLSKY_SFC_SW_DWN"].update(units="kW-hr/m^2/day"))
    def test_utc_and_scope(self):
        self.invalid(lambda d:d["header"].update(time_standard="LST"))
        self.invalid(lambda d:d["geometry"].update(coordinates=[5.47,52.52,0]))
    def test_source_integrity(self):
        with self.assertRaises(source.SourceBlocked):source.verify(self.raw+b" ",self.receipt)
    def test_bad_document_shape(self):
        with self.assertRaises(source.SourceBlocked):source.qualify(b"[]")

class ProcessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result=growth.run(request())
        if cls.result["status"]!="UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE":
            raise AssertionError(cls.result)
        out=ROOT/"runtime/agent-a/growth"
        (out/"verified.response.json").write_text(json.dumps(cls.result,indent=2)+"\n",encoding="utf-8")
        cls.variants={x["id"]:x for x in cls.result["variants"]}
    def test_native_uptake_is_not_declared_inventory_budget(self):
        base=self.variants["reference"]
        active=[d for d in base["daily_process_trace"] if d.get("rate_status")=="ACTIVE_NATIVE_PROCESS_RATE"]
        self.assertTrue(active)
        self.assertTrue(any(d["crop_N_uptake_rate_kg_ha_day"]>0 for d in active))
        self.assertTrue(any(d["soil_model_available_N_kg_ha"]<sum(d["soil_NO3_kg_N_ha"]+d["soil_NH4_kg_N_ha"])-.01 for d in active))
    def test_initial_mineral_N_changes_uptake_and_growth(self):
        a=self.variants["reference"]["crop_results"][0]
        b=self.variants["zero_initial_mineral_N"]["crop_results"][0]
        self.assertGreater(a["modeled_N_uptake_kg_N_ha"]-b["modeled_N_uptake_kg_N_ha"],1)
        self.assertGreater(a["modeled_living_organ_DM_kg_ha"]["SO"]-b["modeled_living_organ_DM_kg_ha"]["SO"],100)
    def test_actual_weather_intervention_changes_growth(self):
        a=self.variants["reference"];b=self.variants["half_rain"]
        self.assertAlmostEqual(b["water_budget"]["precipitation_mm"],a["water_budget"]["precipitation_mm"]*.5,places=8)
        self.assertNotEqual(a["crop_results"][0]["modeled_living_organ_DM_kg_ha"]["SO"],b["crop_results"][0]["modeled_living_organ_DM_kg_ha"]["SO"])
    def test_crop_sequence_carries_different_soil_into_year_two(self):
        a=self.variants["reference"];b=self.variants["sugarbeet_first"]
        def next_start(v):
            return next(t["before"] for t in v["continuity"]["transitions"] if t["event"]=="CROP_START" and t["day"].startswith("2017"))
        self.assertEqual(a["soil_initial"],b["soil_initial"])
        self.assertNotEqual(next_start(a)["nitrate_kg_N_ha"],next_start(b)["nitrate_kg_N_ha"])
        self.assertNotEqual(a["crop_results"][1]["modeled_living_organ_DM_kg_ha"]["SO"],b["crop_results"][1]["modeled_living_organ_DM_kg_ha"]["SO"])
    def test_whole_run_crop_soil_N_and_water_closure(self):
        for v in self.variants.values():
            a=v["accounting"]
            uptake=math.fsum(c["modeled_N_uptake_kg_N_ha"] for c in v["crop_results"])
            self.assertAlmostEqual(uptake,a["soil_N"]["crop_uptake_kg_N_ha"],delta=1e-6)
            residual=math.fsum([a["soil_N"]["initial_kg_N_ha"],a["soil_N"]["amendment_kg_N_ha"],a["soil_N"]["deposition_kg_N_ha"],-a["soil_N"]["final_kg_N_ha"],-a["soil_N"]["bottom_leaching_kg_N_ha"],-a["soil_N"]["denitrification_kg_N_ha"],
                *[c["initial_plant_N_kg_N_ha"]+c["fixation_kg_N_ha"]-sum(c["termination_organ_N_kg_N_ha"].values())-c["unrouted_crop_death_N_kg_N_ha"] for c in a["crops"]]])
            self.assertLessEqual(abs(residual),1e-6)
            self.assertLessEqual(abs(v["water_budget"]["residual_mm"]),1e-7)
            self.assertEqual(a["N_coupling_status"],"PASSED")
            self.assertEqual(a["orphaned_soil_uptake_kg_N_ha"],0)
    def test_five_original_weather_years_and_no_soil_reset(self):
        for v in self.variants.values():
            self.assertEqual(v["integrated_days"],1826)
            self.assertEqual([c["original_weather_year"] for c in v["crop_results"]],list(range(2016,2021)))
            self.assertEqual(v["continuity"]["soil_object_replacements"],0)
            self.assertTrue(v["continuity"]["all_crop_events_preserve_soil"])
            self.assertEqual(len({d["date"] for d in v["daily_process_trace"]}),1827)
    def test_no_market_yield_profit_or_planner_promotion(self):
        r=self.result
        self.assertFalse(r["field_validated"]);self.assertFalse(r["planner_ranking_affected"])
        self.assertIsNone(r["marketable_yield"]);self.assertIsNone(r["profit"])
        for v in r["variants"]:
            self.assertEqual(v["accounting"]["whole_field_N_status"],"UNSUPPORTED_RESIDUE_AND_HARVEST_FATES_UNKNOWN")
            self.assertTrue(all(c["marketable_yield"] is None and c["profit"] is None for c in v["crop_results"]))
    def test_pre_emergence_rates_stay_null(self):
        rows=self.variants["reference"]["daily_process_trace"]
        pre=[d for d in rows if d.get("rate_status")=="PRE_EMERGENCE_OR_NOT_PUBLISHED"]
        self.assertTrue(pre)
        self.assertTrue(all(d["crop_N_uptake_rate_kg_ha_day"] is None for d in pre))
    def test_deterministic_single_variant_replay(self):
        p=request();p["variants"]=p["variants"][:1]
        replay=growth.run(p)
        self.assertEqual(replay["status"],"UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE")
        self.assertEqual(replay["variants"][0],self.variants["reference"])
    def test_schema_and_source_pins(self):
        import jsonschema
        jsonschema.validate(request(),read(ROOT/"contracts/growth_experiment_request_v1.schema.json"))
        jsonschema.validate(self.result,read(ROOT/"contracts/growth_experiment_response_v1.schema.json"))
        self.assertEqual(self.result["provenance"]["pcse_source_sha256"],read(ROOT/"coordination/GROWTH_INPUT_LOCK.json")["pcse_source_sha256"])
        self.assertEqual(verify()["files_verified"],301)
        self.assertEqual(self.result["provenance"]["input_lock_sha256"],hashlib.sha256((ROOT/"coordination/GROWTH_INPUT_LOCK.json").read_bytes()).hexdigest())

if __name__=="__main__":unittest.main()
