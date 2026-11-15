"""Isolated unchanged PCSE physics + reused v2 lifecycle/accounting instrumentation."""
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import hashlib,json,math,os,shutil,sys

def execute(payload):
    from .baseline import ROOT
    runtime=Path(payload["runtime"]).resolve()
    if not any(runtime.is_relative_to((ROOT/"runtime"/r).resolve()) for r in ("agent-a","agent-b")):
        raise ValueError("ISOLATED_PCSE_RUNTIME_REQUIRED")
    runtime.mkdir(parents=True,exist_ok=True)
    original_expand=os.path.expanduser
    with patch("os.path.expanduser",side_effect=lambda p:str(runtime) if p=="~" else original_expand(p)):
        import pcse
    if pcse.__version__!="6.0.13":raise ValueError("PINNED_PCSE_6_0_13_REQUIRED")
    starter=ROOT/"ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter"
    sys.path.insert(0,str(starter))
    from science.astragron_science import rotation_runtime as rr
    from science.astragron_science import pcse_runtime as pr
    from science.astragron_science.crop_weather import verified_assets
    from science.astragron_science.crop_contracts import CropWeatherDay
    from science.astragron_science.accounting_audit import audit_rotation
    from .growth_source import verify as verify_weather,UNITS
    import numpy as np
    from pcse.util import ea_from_tdew,check_angstromAB
    from pcse.models import Wofost81_NWLP_MLWB_SNOMIN as NativeEngine

    raw_path=Path(payload["raw_path"])
    doc=verify_weather(raw_path.read_bytes(),payload["receipt"])
    manifest,manifest_hash=verified_assets(rr.ROTATION_ROOT)
    source_hash,versions=pr.model_provenance()
    expected=json.loads((starter/"docs/validation/milestone2-results.json").read_text(encoding="utf-8"))["run"]["model_source_sha256"]
    if source_hash!=expected:raise ValueError("PCSE_SOURCE_DIFFERS_FROM_PINNED_ACCEPTED_INSTALLATION")
    data=doc["properties"]["parameter"]
    keys=sorted(data["T2M"])
    ratios=[data["ALLSKY_SFC_SW_DWN"][k]/data["TOA_SW_DWN"][k] for k in keys if data["TOA_SW_DWN"][k]>0]
    if len(ratios)<200:raise ValueError("INSUFFICIENT_RADIATION_FOR_ANGSTROM_ESTIMATION")
    aa=float(np.percentile(ratios,5));ab=float(np.percentile(ratios,98));bb=ab-aa
    check_angstromAB(aa,bb) # Block instead of PCSE provider's default-coefficient fallback.
    forcing=[CropWeatherDay(day=date.fromisoformat(k[:4]+"-"+k[4:6]+"-"+k[6:]),
                  min_temp_C=data["T2M_MIN"][k],max_temp_C=data["T2M_MAX"][k],
                  radiation_MJ_m2_day=data["ALLSKY_SFC_SW_DWN"][k],
                  vapour_pressure_kPa=ea_from_tdew(data["T2MDEW"][k]),
                  wind_2m_m_s=data["WS2M"][k],rain_mm=data["PRECTOTCORR"][k]) for k in keys]
    location={"longitude":5.67,"latitude":51.97,"elevation_m":doc["geometry"]["coordinates"][2],
              "angstrom_a":aa,"angstrom_b":bb}
    request=payload["request"];results=[]
    from . import growth_profiles
    rotation_profile=request["profile_id"]==growth_profiles.ROTATION_PROFILE
    class RequestView(SimpleNamespace):
        def model_dump(self,**kw):return self.serialized
    native_run=rr.run_rotation
    native_weather=rr.make_weather
    def weather_provider(rows,point):
        provider=native_weather(rows,point)
        provider.description=["Authentic NASA POWER UTC gridded forcing; PM ET; no station substitution"]
        return provider
    for variant in request["variants"]:
        directory=runtime/variant["id"];directory.mkdir()
        fixture=directory/"parameters"
        shutil.copytree(rr.ROTATION_ROOT,fixture)
        profile_derivation=growth_profiles.derive(fixture) if rotation_profile else None
        site=json.loads((fixture/"site81.json").read_text(encoding="utf-8"))
        for name in ("NH4I","NO3I"):
            site[name]=[x*variant["initial_mineral_N_factor"] for x in site[name]]
        (fixture/"site81.json").write_text(json.dumps(site,sort_keys=True,indent=2),encoding="utf-8",newline="")
        derived=json.loads((fixture/"manifest.json").read_text(encoding="utf-8"))
        for asset in derived["assets"]:
            if asset["path"]=="site81.json":
                asset["base_sha256"]=asset["sha256"]
                asset["sha256"]=hashlib.sha256((fixture/"site81.json").read_bytes()).hexdigest()
                asset["role"]="DECLARED_INITIAL_MINERAL_N_COUNTERFACTUAL"
        derived["derivation"]={"base_manifest_sha256":manifest_hash,"initial_mineral_N_factor":variant["initial_mineral_N_factor"],
                               "classification":"UNMEASURED_SCENARIO_ASSUMPTION_NOT_FERTILIZER_ADVICE"}
        (fixture/"manifest.json").write_text(json.dumps(derived,sort_keys=True,indent=2),encoding="utf-8",newline="")
        seasons=growth_profiles.seasons(variant["crop_sequence"]) if rotation_profile else [SimpleNamespace(crop=crop,cultivar="Fontane" if crop=="potato" else "Sugarbeet_601",
                                sowing_date=date(year,4,21),harvest_date=date(year,9,24))
                 for year,crop in zip(range(2016,2021),variant["crop_sequence"])]
        serial={"schema":"astragron.pcse-research-calendar.v1","start":"2016-01-01","end":"2020-12-31",
                "seasons":[{"crop":s.crop,"cultivar":s.cultivar,"sowing_date":s.sowing_date.isoformat(),"harvest_date":s.harvest_date.isoformat(),**({"crop_end_type":"harvest"} if rotation_profile else {})} for s in seasons],
                "initial_available_water_mm":300,"rain_multiplier":variant["rain_factor"],"irrigation":[],"fertilizer":[]}
        view=RequestView(start=date(2016,1,1),end=date(2020,12,31),seasons=seasons,
                         initial_available_water_mm=300,rain_multiplier=variant["rain_factor"],irrigation=[],fertilizer=[],serialized=serial)
        trace=[];finishes=[]
        class CaptureEngine(NativeEngine):
            def calc_rates(self,day,drv):
                super().calc_rates(day,drv)
                crop=self.crop;ns=self.soil.nutrientbalance.states
                row={"date":day.isoformat(),"soil_model_available_N_kg_ha":float(ns.NAVAIL),
                     "soil_NO3_kg_N_ha":[float(x)*1e4 for x in ns.NO3],
                     "soil_NH4_kg_N_ha":[float(x)*1e4 for x in ns.NH4],
                     "crop_present":crop is not None}
                if crop is not None:
                    row.update(DVS=float(self.get_variable("DVS")),LAI=float(self.get_variable("LAI")),
                               living_storage_organ_DM_kg_ha=float(self.get_variable("WSO")),
                               crop_cumulative_N_uptake_kg_ha=float(crop.n_crop_dynamics.states.NuptakeTotal),
                               crop_N_uptake_rate_kg_ha_day=None if self.kiosk.get("RNuptake") is None else float(self.kiosk["RNuptake"]),
                               transpiration_mm_day=None if self.kiosk.get("TRA") is None else float(self.kiosk["TRA"])*10,
                               rate_status="PRE_EMERGENCE_OR_NOT_PUBLISHED" if self.kiosk.get("RNuptake") is None else "ACTIVE_NATIVE_PROCESS_RATE")
                if (day.month,day.day) in ((1,1),(12,31)):
                    row["soil_water_state"]=pr.snapshot(self.soil)
                trace.append(row)
            def _finish_cropsimulation(self,day):
                finishes.append(day.isoformat())
                super()._finish_cropsimulation(day)
        def run(req,*,runtime_root):
            return native_run(req,fixture_root=fixture,runtime_root=runtime_root)
        residuals=rr.crop_process_residuals
        def checked_residuals(crop):
            try:return residuals(crop)
            except ValueError as error:
                stocks={k:float(getattr(crop.n_crop_dynamics.states,"Namount"+k)) for k in ("LV","ST","RT","SO")}
                raise ValueError(str(error)+"; date="+(trace[-1]["date"] if trace else "INITIAL")+"; crop="+seasons[min(len(finishes),len(seasons)-1)].crop+"; organ_N_kg_ha="+str(stocks)) from error
        with patch.object(rr,"crop_process_residuals",checked_residuals),patch.object(rr,"parse_cabo_weather",return_value=(forcing,location)),patch.object(rr,"make_weather",weather_provider),patch.object(rr,"run_rotation",run),patch("pcse.models.Wofost81_NWLP_MLWB_SNOMIN",CaptureEngine):
            audited=audit_rotation(view,runtime_root=directory,correct_harvest_boundary=True)
        a=audited["accounting"];r=audited["source_result"]
        if a["N_coupling_status"]!="PASSED" or a["orphaned_soil_uptake_kg_N_ha"]!=0:raise ValueError("CROP_SOIL_N_COUPLING_FAILED")
        if r["audit"]["soil_object_replacements"] or not r["audit"]["all_crop_events_preserve_soil"]:raise ValueError("SOIL_CARRYOVER_FAILED")
        crops=[{"season_index":i+1,"original_weather_year":seasons[i].harvest_date.year,"termination_date":finishes[i],
                "crop":c["crop"],"cultivar":c["cultivar"],
                "modeled_N_uptake_kg_N_ha":c["soil_uptake_kg_N_ha"],
                "modeled_living_organ_DM_kg_ha":c["termination_living_dry_matter_kg_DM_ha"],
                "initial_plant_N_kg_N_ha":c["initial_plant_N_kg_N_ha"],
                "termination_organ_N_kg_N_ha":c["termination_organ_N_kg_N_ha"],
                "unrouted_crop_death_N_kg_N_ha":c["unrouted_crop_death_N_kg_N_ha"],
                "crop_N_residual_kg_N_ha":c["crop_N_residual_kg_N_ha"],
                "marketable_yield":None,"profit":None} for i,c in enumerate(a["crops"])]
        results.append({"id":variant["id"],"intervention":variant,"status":"UNVALIDATED_PROCESS_EXPERIMENT_COMPLETE",
                        "crop_results":crops,"daily_process_trace":trace,"integrated_days":r["integrated_days"],
                        "state_boundary_days":[str(view.start),str(view.end)],
                        "water_budget":r["water_budget"],"soil_initial":r["initial_soil"],"soil_final":r["final_soil"],
                        "continuity":r["audit"],"accounting":a,"original_calendar":serial,
                        "pcse_run":r["run"],"actual_forcing_sha256":r["forcing_sha256"],
                        "historical_station_labels_reused":False,
                        "profile_derivation":profile_derivation,"harvest_slot_crop_sequence":variant["crop_sequence"],"derived_parameter_manifest_sha256":hashlib.sha256((fixture/"manifest.json").read_bytes()).hexdigest()})
    return {"variants":results,"parameter_manifest_sha256":manifest_hash,"pcse_source_sha256":source_hash,
            "versions":versions,"angstrom_estimation":{"method":"Pinned PCSE NASA provider 5th/98th percentiles; default fallback prohibited",
            "a":aa,"b":bb,"records":len(ratios)}}

def main():
    payload=json.load(sys.stdin)
    try:
        with redirect_stdout(sys.stderr):result=execute(payload)
        print(json.dumps({"ok":True,"result":result},allow_nan=False))
    except Exception as e:
        print(json.dumps({"ok":False,"error":type(e).__name__+":"+str(e)}));return 2
    return 0
if __name__=="__main__":raise SystemExit(main())
