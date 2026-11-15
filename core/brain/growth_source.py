"""Complete NASA POWER forcing for a bounded PCSE research experiment."""
from datetime import date,timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,build_opener
import hashlib,math,re
from .baseline import ROOT
from common import parse,digest,now
from power_source import NoRedirect

UNITS={"TOA_SW_DWN":"MJ/m^2/day","ALLSKY_SFC_SW_DWN":"MJ/m^2/day","T2M":"C",
       "T2M_MIN":"C","T2M_MAX":"C","T2MDEW":"C","WS2M":"m/s","PRECTOTCORR":"mm/day"}
LIMITS={k:(-100,80) if u=="C" else (0,1000) for k,u in UNITS.items()}
POINT=[5.67,51.97]
START="2016-01-01"
END="2020-12-31"
class SourceBlocked(ValueError):pass
def days():
    a,b=date.fromisoformat(START),date.fromisoformat(END)
    return [(a+timedelta(days=i)).strftime("%Y%m%d") for i in range((b-a).days+1)]
def url():
    return "https://power.larc.nasa.gov/api/temporal/daily/point?"+urlencode({
        "parameters":",".join(UNITS),"community":"AG","longitude":POINT[0],"latitude":POINT[1],
        "start":START.replace("-",""),"end":END.replace("-",""),"format":"JSON","time-standard":"UTC"})
def qualify(raw):
    if len(raw)>2_000_000:raise SourceBlocked("NASA_PAYLOAD_LIMIT")
    doc=parse(raw.decode("utf-8-sig"))
    if not isinstance(doc,dict) or not isinstance(doc.get("header"),dict) or not isinstance(doc.get("geometry"),dict) or not isinstance(doc["geometry"].get("coordinates"),list) or len(doc["geometry"]["coordinates"])!=3:
        raise SourceBlocked("NASA_DOCUMENT_SHAPE")
    if doc.get("header",{}).get("time_standard")!="UTC" or doc.get("geometry",{}).get("type")!="Point" or doc["geometry"]["coordinates"][:2]!=POINT:
        raise SourceBlocked("NASA_POINT_TIME_SCOPE")
    if doc["header"].get("fill_value")!=-999:raise SourceBlocked("NASA_FILL_VALUE_CONTRACT")
    elevation=doc["geometry"]["coordinates"][2]
    if type(elevation) not in (int,float) or not math.isfinite(elevation) or not -500<=elevation<=9000:
        raise SourceBlocked("NASA_GRID_ELEVATION_REQUIRED")
    expected=set(days());series=doc.get("properties",{}).get("parameter",{})
    for name,unit in UNITS.items():
        if doc.get("parameters",{}).get(name,{}).get("units")!=unit:raise SourceBlocked("NASA_UNIT:"+name)
        values=series.get(name,{})
        lo,hi=LIMITS[name]
        if not isinstance(values,dict) or set(values)!=expected or any(type(v) not in (int,float) or not math.isfinite(v) or not lo<=v<=hi for v in values.values()):
            raise SourceBlocked("NASA_MISSING_INVALID_NO_IMPUTATION:"+name)
    if any(not series["T2M_MIN"][k]<=series["T2M"][k]<=series["T2M_MAX"][k] for k in expected):
        raise SourceBlocked("NASA_TEMPERATURE_ORDER")
    sources=doc["header"].get("sources",[])
    if not isinstance(sources,list) or "MERRA2" not in sources or "SYN1DEG" not in sources or any(x not in ("MERRA2","SYN1DEG","POWER") for x in sources):
        raise SourceBlocked("NASA_SOURCE_FAMILY_NOT_REVIEWED:"+str(sources))
    return doc,{"days":len(expected),"variables":UNITS,"point_lon_lat":POINT,"period":[START,END],
                "time_standard":"UTC","elevation_m":elevation,"sources":sources,
                "spatial_scope":"NASA POWER point extraction; MERRA2 meteorology (0.625 x 0.5 degree nominal grid) and CERES SYN1deg solar (1 x 1 degree nominal grid). No field measurement or downscaling.",
                "solar_source_reference":"https://power.larc.nasa.gov/docs/methodology/data/sources_fluxes/",
                "fill_or_imputed_days":0}
def verify(raw,receipt):
    doc,q=qualify(raw)
    if receipt.get("raw_sha256")!=hashlib.sha256(raw).hexdigest() or receipt.get("receipt_sha256")!=digest({k:v for k,v in receipt.items() if k!="receipt_sha256"}):
        raise SourceBlocked("NASA_RECEIPT_INTEGRITY")
    if receipt.get("url")!=url() or receipt.get("qualification")!=q:raise SourceBlocked("NASA_RECEIPT_SCOPE")
    return doc
def acquire(cache,*,fetch=False):
    cache=Path(cache);cache.mkdir(parents=True,exist_ok=True)
    receipt_path=cache/"growth-weather.receipt.json"
    if receipt_path.exists():
        receipt=parse(receipt_path.read_text(encoding="utf-8"))
        if not isinstance(receipt,dict) or not isinstance(receipt.get("raw_sha256"),str) or not re.fullmatch("[a-f0-9]{64}",receipt["raw_sha256"]):
            raise SourceBlocked("NASA_RECEIPT_HASH_FORMAT")
        raw=(cache/(receipt["raw_sha256"]+".raw.json")).read_bytes()
        return verify(raw,receipt),receipt
    if not fetch:raise SourceBlocked("COMPLETE_PCSE_NASA_FORCING_NOT_CACHED")
    request=Request(url(),headers={"User-Agent":"ASTRAGRON-scientific-research/1.0","Accept":"application/json"})
    with build_opener(NoRedirect).open(request,timeout=30) as response:
        if response.status!=200 or "json" not in response.headers.get("Content-Type",""):raise SourceBlocked("NASA_HTTP_CONTENT")
        raw=response.read(2_000_001);headers={n:response.headers.get(n) for n in ("Date","ETag","Last-Modified","Content-Type")}
    doc,q=qualify(raw)
    receipt={"schema":"astragron.pcse-nasa-source.v1","url":url(),"retrieved_at":now(),"http_status":200,
             "response_headers":headers,"raw_sha256":hashlib.sha256(raw).hexdigest(),"qualification":q,
             "license":"NASA POWER public data with attribution to NASA Langley POWER and the named meteorology/radiation providers",
             "authenticity":"Verified HTTPS retrieval; hashes verify replay integrity, not a NASA digital signature"}
    receipt["receipt_sha256"]=digest(receipt)
    raw_target=cache/(receipt["raw_sha256"]+".raw.json")
    try:
        with raw_target.open("xb") as stream:stream.write(raw)
    except FileExistsError:
        if raw_target.read_bytes()!=raw:raise SourceBlocked("NASA_IMMUTABLE_RAW_CONFLICT")
    try:
        with receipt_path.open("x",encoding="utf-8") as stream:stream.write(__import__("json").dumps(receipt,indent=2)+"\n")
    except FileExistsError:
        return acquire(cache,fetch=False)
    return doc,receipt
