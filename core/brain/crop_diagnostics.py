"""Isolated parameter-qualification trace; no public crop admission is granted."""
from contextlib import ExitStack,redirect_stdout
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import argparse,hashlib,json,math,os,re,shutil,sys
from .baseline import ROOT,verify
from . import growth_profiles,growth_worker,root_depth_adapter,growth_source,producing_profiles
from .runtime_paths import diagnostic_runtime,relative_path

BARLEY_SHA="8acf3edf03990039ccc28aad44bf108b1eb5b569c27aa9b01785fb8ab9263a18"

def validate_config(config):
    required={"runtime","crop","cultivar","soil","root_fix","variants"}
    if not isinstance(config,dict) or not required.issubset(config) or set(config)-required-{"earliest","label"}:
        raise ValueError("EXACT_DIAGNOSTIC_CONFIG_KEYS")
    cultivars={"wheat":{"Winter_wheat_101","Arminda"},"barley":{"Spring_barley_301"}}
    if config["crop"] not in cultivars or config["cultivar"] not in cultivars[config["crop"]]:
        raise ValueError("PINNED_DIAGNOSTIC_CROP_CULTIVAR_REQUIRED")
    if config["soil"] not in ("original120","extend125") or type(config["root_fix"]) is not bool or type(config.get("earliest",True)) is not bool:
        raise ValueError("EXPLICIT_DIAGNOSTIC_SOIL_AND_SWITCHES")
    variants=config["variants"]
    if not isinstance(variants,list) or not 1<=len(variants)<=4:raise ValueError("BOUNDED_DIAGNOSTIC_VARIANTS")
    ids=set()
    for v in variants:
        if not isinstance(v,dict) or set(v)!={"id","crop_sequence","initial_mineral_N_factor","rain_factor"}:
            raise ValueError("EXACT_DIAGNOSTIC_VARIANT")
        if not isinstance(v["id"],str) or not re.fullmatch("[A-Za-z0-9_-]{1,40}",v["id"]) or v["id"] in ids:
            raise ValueError("SAFE_DISTINCT_DIAGNOSTIC_ID")
        ids.add(v["id"])
        if not isinstance(v["crop_sequence"],list) or len(v["crop_sequence"])!=5 or set(v["crop_sequence"])-{"potato","sugarbeet",config["crop"]}:
            raise ValueError("EXACT_ADMITTED_DIAGNOSTIC_CROP_SLOTS")
        if v["crop_sequence"][0]=="wheat":raise ValueError("DIAGNOSTIC_CALENDAR_OUTSIDE_FORCING")
        for key,low,high in (("initial_mineral_N_factor",0,1),("rain_factor",.5,1.5)):
            n=v[key]
            if type(n) not in (int,float) or not math.isfinite(n) or not low<=n<=high:raise ValueError("BOUNDED_DIAGNOSTIC_INTERVENTION")
    return config

def execute(config):
    validate_config(config)
    config=dict(config);runtime=diagnostic_runtime(config["runtime"])
    config["runtime"]=relative_path(runtime)
    runtime.mkdir(parents=True,exist_ok=True);verify()
    lock=json.loads((ROOT/"coordination/GROWTH_INPUT_LOCK.json").read_text(encoding="utf-8"))
    if any(hashlib.sha256((ROOT/n).read_bytes()).hexdigest()!=h for n,h in lock["files"].items()):raise ValueError("SOURCE_LOCK_CHANGED")
    expand=os.path.expanduser
    with patch("os.path.expanduser",side_effect=lambda p:str(runtime) if p=="~" else expand(p)):
        import pcse
    if pcse.__version__!="6.0.13":raise ValueError("PINNED_MODEL_REQUIRED")
    from pcse.input import YAMLCropDataProvider
    from pcse.models import Wofost81_NWLP_MLWB_SNOMIN as Engine
    from pcse.soil.multilayer_waterbalance import WaterBalanceLayered
    from pcse.crop.n_dynamics import N_Crop_Dynamics
    from pcse.decorators import prepare_rates,prepare_states
    sys.path.insert(0,str(ROOT/"ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter"))
    from science.astragron_science import rotation_runtime as rr,pcse_runtime as pr
    crop=config["crop"];cultivar=config["cultivar"];profile="ISOLATED_DIAGNOSTIC_NOT_ADMITTED"
    base_manifest=json.loads((rr.ROTATION_ROOT/"manifest.json").read_text(encoding="utf-8"))
    source_path=rr.ROTATION_ROOT/"derivation/wheat-unsupported.yaml" if crop=="wheat" else ROOT/producing_profiles.SOURCE_FILE
    source_sha=hashlib.sha256(source_path.read_bytes()).hexdigest()
    if crop=="barley" and source_sha!=BARLEY_SHA:raise ValueError("BARLEY_SOURCE_CHANGED")
    def derive(fixture):
        if config["soil"]=="extend125":
            soil=json.loads((fixture/"soil81.json").read_text(encoding="utf-8"));extra=dict(soil["SoilProfileDescription"]["SoilLayers"][-1]);extra["Thickness"]=5.;soil["SoilProfileDescription"]["SoilLayers"].append(extra);soil["RDMSOL"]=125.
            (fixture/"soil81.json").write_text(json.dumps(soil),encoding="utf-8",newline="")
            site=json.loads((fixture/"site81.json").read_text(encoding="utf-8"))
            for k in ("NH4I","NO3I"):site[k].append(0.)
            (fixture/"site81.json").write_text(json.dumps(site),encoding="utf-8",newline="")
        shutil.copyfile(source_path,fixture/"crop"/(crop+".yaml"))
        (fixture/"crop/crops.yaml").write_text("available_crops: [potato, sugarbeet, "+crop+"]\n",encoding="utf-8",newline="")
        m=json.loads((fixture/"manifest.json").read_text(encoding="utf-8"))
        m["assets"].append({"path":"crop/"+crop+".yaml","sha256":source_sha,"role":"EXACT_UPSTREAM_DIAGNOSTIC_PARAMETERS"})
        for a in m["assets"]:
            a["sha256"]=hashlib.sha256((fixture/a["path"]).read_bytes()).hexdigest()
        (fixture/"manifest.json").write_text(json.dumps(m),encoding="utf-8",newline="")
        return {"diagnostic":True,"crop":crop,"cultivar":cultivar,"source_sha256":source_sha,"soil":config["soil"],"root_fix":config["root_fix"]}
    def seasons(sequence):
        out=[]
        for y,c in zip(range(2016,2021),sequence):
            sow=date(y-1,11,1) if c=="wheat" else date(y,3,15) if c=="barley" else date(y,4,15 if c=="sugarbeet" else 21)
            end=date(y,8,15) if c in ("wheat","barley") else date(y,10,15) if c=="sugarbeet" else date(y,9,24)
            out.append(SimpleNamespace(crop=c,cultivar=cultivar if c==crop else "Fontane" if c=="potato" else "Sugarbeet_601",sowing_date=sow,harvest_date=end))
        return out
    native_management=rr.make_rotation_management
    def management(request):
        rows=native_management(request)
        for campaign in rows:
            for body in campaign.values():
                if body and body["CropCalendar"]["crop_name"]==crop:body["CropCalendar"]["crop_end_type"]="earliest" if config.get("earliest",True) else "harvest"
        return rows
    def provider(*a,**kw):
        fixture=Path(kw["fpath"]).parent/"parameters"
        shutil.copyfile(fixture/"crop"/(crop+".yaml"),Path(kw["fpath"])/(crop+".yaml"))
        return YAMLCropDataProvider(*a,**kw)
    trace_path=runtime/"native_complete_trace.jsonl";stream=trace_path.open("w",encoding="utf-8",newline="")
    events=[];last_rates={};counts={"soil":0,"N_rates":0,"N_integrated":0}
    def emit(kind,day,data):
        counts[kind]+=1;stream.write(json.dumps({"kind":kind,"date":day.isoformat(),**data},allow_nan=False)+"\n")
    ncalc=N_Crop_Dynamics.__dict__["calc_rates"].f;nint=N_Crop_Dynamics.__dict__["integrate"].f;ecalc=Engine.calc_rates
    def calc(self,day,drv):
        ncalc(self,day,drv);k=self.kiosk
        row={"stocks":{o:float(getattr(self.states,"Namount"+o)) for o in ("LV","ST","RT","SO")},
             "rates":{o:float(getattr(self.rates,"RNamount"+o)) for o in ("LV","ST","RT","SO")},
             "N_death":{o:float(getattr(self.rates,"RNdeath"+o)) for o in ("LV","ST","RT")},
             "published":{x:float(k[x]) if x in k else None for x in ("DVS","WLV","DRLV","RD","RDM","RNuptakeLV","RNtranslocationLV","RNuptake","NAVAIL")}}
        emit("N_rates",day,row);last_rates[id(self)]=row
        predicted=row["stocks"]["LV"]+row["rates"]["LV"]
        if predicted < -1e-6:events.append({"rate_day":day.isoformat(),"predicted_N_LV_kg_ha":predicted,**row})
    def integrate(self,day,delt=1.):
        nint(self,day,delt);emit("N_integrated",day,{"stocks":{o:float(getattr(self.states,"Namount"+o)) for o in ("LV","ST","RT","SO")},"prior_rates":last_rates.get(id(self))})
    def engine_calc(self,day,drv):
        ecalc(self,day,drv)
        emit("soil",day,{"crop_present":self.crop is not None,"soil":pr.snapshot(self.soil),
            "water_balance_RDM_cm":float(self.soil.waterbalance._RDM),"native_crop_RDM_cm":None if self.crop is None else float(self.get_variable("RDM"))})
    calc.__name__="calc_rates";integrate.__name__="integrate"
    calc=prepare_rates(calc);integrate=prepare_states(integrate)
    lock_NASA=lock["NASA"];source_cache=None
    for candidate in (ROOT/"runtime/agent-a/growth/source_cache",ROOT/"runtime/agent-a/growth-decision/provider/source_cache"):
        if (candidate/"growth-weather.receipt.json").is_file():
            _,receipt=growth_source.acquire(candidate,fetch=False)
            if any(receipt.get(k)!=v for k,v in lock_NASA.items()):raise ValueError("NASA_SNAPSHOT_DIFFERS_FROM_PIN")
            source_cache=candidate;break
    if source_cache is None:raise ValueError("PINNED_DIAGNOSTIC_NASA_CACHE_REQUIRED")
    request={"profile_id":profile,"variants":config["variants"]}
    payload={"runtime":str(runtime),"request":request,"receipt":receipt,"raw_path":str(source_cache/(receipt["raw_sha256"]+".raw.json"))}
    try:
        with ExitStack() as stack:
            for obj,key,val in [(growth_profiles,"ROTATION_PROFILE",profile),(growth_profiles,"derive",derive),(growth_profiles,"seasons",seasons),(rr,"make_rotation_management",management),(pcse.input,"YAMLCropDataProvider",provider),(N_Crop_Dynamics,"calc_rates",calc),(N_Crop_Dynamics,"integrate",integrate),(Engine,"calc_rates",engine_calc)]:
                stack.enter_context(patch.object(obj,key,val))
            if config["root_fix"]:stack.enter_context(patch.object(WaterBalanceLayered,"_setup_new_crop",root_depth_adapter.setup_new_crop))
            result=growth_worker.execute(payload)
        outcome={"status":"DIAGNOSTIC_COMPLETE_NOT_ADMISSION","result":result}
    except Exception as error:
        outcome={"status":"EVIDENCE_BLOCKED" if isinstance(error,(ValueError,pcse.exceptions.PCSEError)) else "DIAGNOSTIC_ERROR","error":type(error).__name__+":"+str(error)}
    finally:stream.close()
    outcome.update(config=config,trace_counts=counts,organ_N_overdraw_events=events,trace_sha256=hashlib.sha256(trace_path.read_bytes()).hexdigest(),parameter_source_sha256=source_sha)
    (runtime/"result.json").write_text(json.dumps(outcome),encoding="utf-8",newline="")
    return {k:v for k,v in outcome.items() if k!="result"}
def main():
    parser=argparse.ArgumentParser();parser.add_argument("config",type=Path,nargs="?")
    parser.add_argument("--runtime",help="Explicit repository-relative A diagnostic destination")
    args=parser.parse_args()
    config=json.loads(args.config.read_text(encoding="utf-8-sig")) if args.config else json.load(sys.stdin)
    if args.runtime is not None:config["runtime"]=args.runtime
    with redirect_stdout(sys.stderr):result=execute(config)
    print(json.dumps(result))
if __name__=="__main__":main()
