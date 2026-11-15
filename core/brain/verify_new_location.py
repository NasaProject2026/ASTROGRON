"""Verify real acquired NASA evidence and cache-only new-location abstention."""
from copy import deepcopy
import json
from unittest.mock import patch
from .baseline import ROOT, verify
from .service import ClientDecisionService
from common import read, digest
import power_source

def main():
    output=ROOT/"runtime/agent-a"
    request=read(ROOT/"examples/engine/new_location.json")
    request["engine_request"]["source"]["acquisition"]="CACHE_ONLY"
    service=ClientDecisionService()
    with patch.object(power_source,"build_opener",side_effect=AssertionError("OFFLINE_REPLAY_MUST_NOT_NETWORK")):
        result=service.run(request)
    assert result["qualification"]["climate_ready"], result["engine_result"].get("global_coverage")
    assert result["status"]=="EVIDENCE_BLOCKED" and result["alternatives"]==[]
    assert not result["qualification"]["field_agronomy_qualified"]
    assert result["engine_result"]["execution"]["physics_cases_executed"]==0
    assert result["missing_requirements"]
    doc,receipt=power_source.load(5.47,52.52,"2016-01-01","2020-12-31",cache=service.source_cache)
    assert receipt["http_status"]==200 and receipt["qualification"]["days"]==1827
    assert all(x["missing_or_invalid"]==0 for x in receipt["qualification"]["missingness"].values())
    assert "20160229" in doc["properties"]["parameter"]["T2M"]
    (output/"new_location.offline.response.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    checks=[
        "Authenticated original NASA raw/receipt hashes and coordinate/time/units scope",
        "1827 complete native daily records including 2016 leap day",
        "No missing-value imputation or geographic fallback",
        "Cache-only replay performs no network",
        "Climate ready does not qualify absent local crop/soil inputs",
        "No agronomic physics or ranking when local inputs are missing",
    ]
    record={"PASS":True,"checks":checks,"point_lon_lat":receipt["point_lon_lat"],
            "raw_sha256":receipt["sha256"],"receipt_sha256":receipt["receipt_sha256"],
            "retrieved_at":receipt["retrieved_at"],"request_key":receipt["request_key"],
            "status":result["status"],"missing_requirements":result["missing_requirements"],
            "protected_after":verify(),"raw_data_path":str(service.source_cache/(receipt["sha256"]+".raw.json")),
            "receipt_path":str(service.source_cache/(receipt["request_key"]+".receipt.json"))}
    (output/"NEW_LOCATION_VERIFICATION.json").write_text(json.dumps(record,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"PASS":True,"checks":len(checks),"status":result["status"],"raw_sha256":receipt["sha256"]}))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
