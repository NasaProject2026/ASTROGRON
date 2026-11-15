"""Parameter-qualified two-crop/bare-fallow process subset, not farm rotation approval."""
from datetime import date
from types import SimpleNamespace

ROTATION_PROFILE="wageningen-pcse81-two-crop-fallow-research-v1"
SOIL_ACK="EXPLORATORY_BARE_FALLOW_AND_DECLARED_CROP_CALENDARS_NOT_FARM_APPROVAL"
THICKNESS_M=[.25,.15,.2,.6]
CULTIVARS={"potato":"Fontane","sugarbeet":"Sugarbeet_601"}
LIMITATIONS=[
 "Only the original unchanged 120 cm teaching soil and published potato Fontane/sugarbeet Sugarbeet_601 parameters are admitted. Wheat remains blocked.",
 "Bare-fallow calendar years have no crop, no cover-crop, fertilizer, irrigation or residue additions. Native soil water/N continue throughout; fallow is an explicit experimental comparator, not farm advice.",
 "Potato April21-September24 and sugarbeet April15-October15 reuse existing declared research calendars; no observed field-calendar qualification.",
 "Root-crop 1-in-4 return is a conservative declared research screen illustrated by a Dutch experiment, not a universal or sufficient agronomic/plant-health rule.",
 "Separate full-horizon crop dry-matter services and nitrogen loss have no scalar combined value; unpriced opportunity cost, marketable yield and profit remain unavailable."
]

def seasons(sequence):
    if not isinstance(sequence,list) or len(sequence)!=5:raise ValueError("EXACT_FIVE_HARVEST_SLOTS")
    out=[]
    for year,crop in zip(range(2016,2021),sequence):
        if crop=="bare_fallow":continue
        if crop not in CULTIVARS:raise ValueError("UNSUPPORTED_ROTATION_CROP")
        sow=date(year,4,15 if crop=="sugarbeet" else 21)
        end=date(year,10,15) if crop=="sugarbeet" else date(year,9,24)
        if (out and sow<=out[-1].harvest_date):raise ValueError("CALENDAR_OVERLAP")
        out.append(SimpleNamespace(crop=crop,cultivar=CULTIVARS[crop],sowing_date=sow,harvest_date=end))
    if len(out)<2:raise ValueError("AT_LEAST_TWO_ACTUAL_CROP_SEASONS")
    return out

def derive(fixture):
    return {"id":ROTATION_PROFILE,"acknowledgment":SOIL_ACK,"assumptions":LIMITATIONS,
        "soil_geometry_changed":False,"crop_coefficients_changed":False,
        "wheat_status":"EVIDENCE_BLOCKED_GEOMETRY_AND_NATIVE_NEGATIVE_N_STOCK"}

def annual_results(native):
    crops={c["original_weather_year"]:c for c in native["crop_results"]}
    return [crops.get(y) or {"season_index":None,"original_weather_year":y,
        "termination_date":None,"crop":"bare_fallow","cultivar":None,
        "modeled_N_uptake_kg_N_ha":None,"modeled_living_organ_DM_kg_ha":None,
        "marketable_yield":None,"profit":None,"scope":"NO_CROP_PRESENT_NATIVE_SOIL_CONTINUES"}
        for y in range(2016,2021)]
