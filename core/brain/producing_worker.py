"""New-profile-only root consistency repair; native biological N equations unchanged."""
from contextlib import ExitStack,redirect_stdout
from pathlib import Path
from unittest.mock import patch
import hashlib,json,os,sys
from . import growth_worker,growth_profiles,producing_profiles as profile,root_depth_adapter
from .baseline import ROOT

def execute(payload):
    if payload["request"]["profile_id"]!=profile.PROFILE:raise ValueError("PRODUCING_WORKER_PROFILE_MISMATCH")
    runtime=Path(payload["runtime"]).resolve()
    if not runtime.is_relative_to((ROOT/"runtime/agent-a").resolve()) and not runtime.is_relative_to((ROOT/"runtime/agent-b").resolve()):raise ValueError("ISOLATED_RUNTIME")
    runtime.mkdir(parents=True,exist_ok=True);profile.verify_sources();expand=os.path.expanduser
    with patch("os.path.expanduser",side_effect=lambda p:str(runtime) if p=="~" else expand(p)):
        import pcse
    from pcse.input import YAMLCropDataProvider
    from pcse.models import Wofost81_NWLP_MLWB_SNOMIN as Engine
    from pcse.soil.multilayer_waterbalance import WaterBalanceLayered
    sys.path.insert(0,str(ROOT/"ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/starter"))
    from science.astragron_science import rotation_runtime as rr
    native_run=rr.run_rotation;native_management=rr.make_rotation_management;native_calc=Engine.calc_rates
    audits={};order=[]
    def run(request,**kw):
        request.serialized["schema"]="astragron.pcse-producing-calendar.v1"
        request.serialized["root_setup_adapter"]=root_depth_adapter.VERSION
        for s in request.serialized["seasons"]:s["crop_end_type"]="earliest" if s["crop"]=="barley" else "harvest"
        return native_run(request,**kw)
    def management(request):
        rows=native_management(request)
        for campaign in rows:
            for body in campaign.values():
                if body and body["CropCalendar"]["crop_name"]=="barley":body["CropCalendar"]["crop_end_type"]="earliest"
        return rows
    def provider(*a,**kw):
        import shutil
        shutil.copyfile(profile.ROOT/profile.SOURCE_FILE,Path(kw["fpath"])/"barley.yaml")
        return YAMLCropDataProvider(*a,**kw)
    def calc(self,day,drv):
        native_calc(self,day,drv)
        if id(self) not in audits:
            checks={"daily_active_checks":0,"maximum_root_depth_disagreement_cm":0.,"minimum_organ_N_kg_ha":0.,"root_settings":[]}
            audits[id(self)]=(self,checks);order.append(checks)
        checks=audits[id(self)][1]
        if self.crop is not None:
            expected=float(self.crop.ro_dynamics.states.RDM);actual=float(self.soil.waterbalance._RDM)
            setting={"published_RDMCR_cm":float(self.crop.ro_dynamics.params.RDMCR),"soil_RDMSOL_cm":float(self.crop.ro_dynamics.params.RDMSOL),"native_RDM_cm":expected,"water_balance_RDM_cm":actual}
            if setting not in checks["root_settings"]:checks["root_settings"].append(setting)
            delta=abs(expected-actual);checks["daily_active_checks"]+=1
            checks["maximum_root_depth_disagreement_cm"]=max(checks["maximum_root_depth_disagreement_cm"],delta)
            if delta>1e-9:raise ValueError("WATER_ROOT_MODEL_DEPTH_DISAGREEMENT")
            checks["minimum_organ_N_kg_ha"]=min(checks["minimum_organ_N_kg_ha"],*(float(getattr(self.crop.n_crop_dynamics.states,"Namount"+o)) for o in ("LV","ST","RT","SO")))
    with ExitStack() as stack:
        for obj,key,val in [(growth_profiles,"ROTATION_PROFILE",profile.PROFILE),(growth_profiles,"derive",profile.derive),(growth_profiles,"seasons",profile.seasons),(rr,"run_rotation",run),(rr,"make_rotation_management",management),(pcse.input,"YAMLCropDataProvider",provider),(WaterBalanceLayered,"_setup_new_crop",root_depth_adapter.setup_new_crop),(Engine,"calc_rates",calc)]:
            stack.enter_context(patch.object(obj,key,val))
        result=growth_worker.execute(payload)
    if len(order)!=len(result["variants"]):raise ValueError("INCOMPLETE_ROOT_AUDIT_MATRIX")
    for variant,checks in zip(result["variants"],order):variant["root_depth_validation"]=checks
    result["producing_model"]={"base_pcse":"6.0.13","adapter":root_depth_adapter.VERSION,
        "adapter_sha256":hashlib.sha256((ROOT/"brain/root_depth_adapter.py").read_bytes()).hexdigest(),"native_biology_equations_changed":False}
    return result

def main():
    try:
        with redirect_stdout(sys.stderr):result=execute(json.load(sys.stdin))
        print(json.dumps({"ok":True,"result":result},allow_nan=False))
    except Exception as e:
        print(json.dumps({"ok":False,"error":type(e).__name__+":"+str(e)}));return 2
    return 0
if __name__=="__main__":raise SystemExit(main())
