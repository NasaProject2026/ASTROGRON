"""Source-pinned producing research rotations; no field or market qualification."""
from datetime import date
from types import SimpleNamespace
from pathlib import Path
import hashlib,json,shutil
from .baseline import ROOT
PROFILE="wageningen-three-crop-producing-research-v1"
ACK="SOURCE_PINNED_THREE_CROP_RESEARCH_NOT_FIELD_VALIDATION"
OBJECTIVE="FIVE_YEAR_THREE_CROP_SERVICE_N_LOSS_VECTOR_V1"
BARLEY="research:NL:spring_barley_301"
CROPS={"research:NL:potato_Fontane":"potato","research:NL:sugarbeet_601":"sugarbeet",BARLEY:"barley"}
CULTIVARS={"potato":"Fontane","sugarbeet":"Sugarbeet_601","barley":"Spring_barley_301"}
SOURCE_FILE="brain/parameters/barley_1ca91d7.yaml"
SOURCE_SHA="8acf3edf03990039ccc28aad44bf108b1eb5b569c27aa9b01785fb8ab9263a18"
LIMITATIONS=[
 "Three producing crop species with one crop in each of five annual slots are conditional process research on the original unmeasured 120 cm teaching soil; no local field calibration.",
 "Spring barley March15 to earlier of native maturity or August15 is a declared research calendar within WUR CGN spring-cereal month windows. These are not farm-observed dates.",
 "The opt-in root-setup adapter uses the pinned native root rule max(RDI,min(RDMCR,RDMSOL)); published RDMCR and every soil layer remain unchanged.",
 "Root return gaps and cereal spacing are explicit conservative eligibility screens, not a complete crop-family/pathogen or farm suitability assessment.",
 "No new crop residue, P/K physiological response, irrigation, fertilizer, yield conversion, crop-price or profit assumption is introduced by the growth model.",
 "Wheat remains EVIDENCE_BLOCKED because reproduced native leaf death plus translocation overdrew crop N."
]
def verify_sources():
    if hashlib.sha256((ROOT/SOURCE_FILE).read_bytes()).hexdigest()!=SOURCE_SHA:raise ValueError("PINNED_BARLEY_PARAMETER_SOURCE_CHANGED")
    return {SOURCE_FILE:SOURCE_SHA}
def seasons(sequence):
    if not isinstance(sequence,list) or len(sequence)!=5 or set(sequence)-set(CULTIVARS):raise ValueError("FIVE_ADMITTED_PRODUCING_CROP_SLOTS")
    return [SimpleNamespace(crop=c,cultivar=CULTIVARS[c],sowing_date=date(y,3,15) if c=="barley" else date(y,4,15 if c=="sugarbeet" else 21),
        harvest_date=date(y,8,15) if c=="barley" else date(y,10,15) if c=="sugarbeet" else date(y,9,24)) for y,c in zip(range(2016,2021),sequence)]
def derive(fixture):
    verify_sources();shutil.copyfile(ROOT/SOURCE_FILE,fixture/"crop/barley.yaml")
    (fixture/"crop/crops.yaml").write_text("available_crops: [potato, sugarbeet, barley]\n",encoding="utf-8",newline="")
    m=json.loads((fixture/"manifest.json").read_text(encoding="utf-8"))
    for a in m["assets"]:
        if a["path"]=="crop/crops.yaml":a.update(base_sha256=a["sha256"],sha256=hashlib.sha256((fixture/a["path"]).read_bytes()).hexdigest(),role="EXPLICIT_THREE_CROP_CATALOG")
    m["assets"].append({"path":"crop/barley.yaml","sha256":SOURCE_SHA,"role":"EXACT_UPSTREAM_ESTIMATED_CROP_PARAMETERS","source_url":"https://raw.githubusercontent.com/ajwdewit/WOFOST_crop_parameters/1ca91d7dbb5aaf6b41462162de03a8254812d3a5/barley.yaml","license":"EUPL-1.2-or-later"})
    (fixture/"manifest.json").write_text(json.dumps(m,sort_keys=True,indent=2),encoding="utf-8",newline="")
    return {"id":PROFILE,"barley_source_sha256":SOURCE_SHA,"soil_geometry_changed":False,"crop_coefficients_changed":False,
        "root_setup_adapter":"ROOT_SOIL_LIMIT_SETUP_V1","field_validated":False,"assumptions":LIMITATIONS}
